/**
 * Persist Shopify OAuth login attribution per staff identity (shop + email).
 */
const { getDb, isPostgres } = require('./db');

function normalizeShop(shop) {
  return shop != null ? String(shop).trim().toLowerCase() : '';
}

function normalizeEmail(email) {
  return email != null ? String(email).trim().toLowerCase() : '';
}

async function upsertIdentity({ shop, email, shopifyUserId, now = Date.now() }) {
  const shopNorm = normalizeShop(shop);
  const emailNorm = normalizeEmail(email);
  if (!shopNorm || !emailNorm) return { ok: false, error: 'invalid' };
  const db = getDb();
  const uid = shopifyUserId != null && Number.isFinite(Number(shopifyUserId)) ? Number(shopifyUserId) : null;
  const ts = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  try {
    if (isPostgres()) {
      await db.run(
        `
          INSERT INTO shop_oauth_identities
            (shop, email, shopify_user_id, first_oauth_at, last_oauth_at, login_count, updated_at)
          VALUES
            (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT (shop, email) DO UPDATE SET
            shopify_user_id = COALESCE(EXCLUDED.shopify_user_id, shop_oauth_identities.shopify_user_id),
            first_oauth_at = LEAST(shop_oauth_identities.first_oauth_at, EXCLUDED.first_oauth_at),
            last_oauth_at = GREATEST(shop_oauth_identities.last_oauth_at, EXCLUDED.last_oauth_at),
            login_count = shop_oauth_identities.login_count + 1,
            updated_at = EXCLUDED.updated_at
        `,
        [shopNorm, emailNorm, uid, ts, ts, ts]
      );
    } else {
      await db.run(
        'INSERT OR IGNORE INTO shop_oauth_identities (shop, email, shopify_user_id, first_oauth_at, last_oauth_at, login_count, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [shopNorm, emailNorm, uid, ts, ts, ts]
      );
      await db.run(
        `
          UPDATE shop_oauth_identities SET
            shopify_user_id = COALESCE(?, shopify_user_id),
            first_oauth_at = COALESCE(first_oauth_at, ?),
            last_oauth_at = ?,
            login_count = COALESCE(login_count, 0) + 1,
            updated_at = ?
          WHERE shop = ? AND email = ?
        `,
        [uid, ts, ts, ts, shopNorm, emailNorm]
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'db_error' };
  }
}

module.exports = { upsertIdentity };

