/**
 * One-off backfill: create missing rows in `purchases` from `purchase_events` evidence.
 *
 * Why:
 * - Diagnostics "Birdseye" column reads from `purchases`.
 * - A previous ingest path wrote only `purchase_events` (evidence) on checkout_completed.
 *
 * Safety:
 * - Append-only into `purchases` with conflict ignored (safe to re-run).
 * - Does NOT delete or modify `purchase_events` / `orders_shopify`.
 *
 * Window:
 * - Uses the same "today" bounds as the dashboard (admin timezone) via store.getRangeBounds('today', ...).
 */

const crypto = require('crypto');
const store = require('../server/store');
const { getDb, isPostgres } = require('../server/db');

function trimStr(v, maxLen = 2048) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeJsonParse(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const c = value.trim().toUpperCase();
  if (c.length !== 2 || c === 'XX' || c === 'T1') return null;
  return c;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function computePurchaseKeyFromParts({ checkoutToken, orderId, orderCurrency, orderTotalRaw, tsMs, sessionId } = {}) {
  const token = trimStr(checkoutToken, 128);
  const oid = trimStr(orderId, 128);
  if (token) return 'token:' + token;
  if (oid) return 'order:' + oid;

  const ts = typeof tsMs === 'number' && Number.isFinite(tsMs) ? tsMs : Date.now();
  const bucket15 = Math.floor(ts / (15 * 60 * 1000));
  const cur = trimStr(orderCurrency, 16) || '';
  const tot = orderTotalRaw != null ? String(orderTotalRaw) : '';
  const sid = trimStr(sessionId, 64) || '';
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + bucket15 + '|' + sid).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function main() {
  const db = getDb();
  const tz = store.resolveAdminTimeZone();
  const now = Date.now();
  const bounds = store.getRangeBounds('today', now, tz);
  const pg = isPostgres();

  console.log('[backfill-purchases] tz=%s start=%s end=%s', tz, bounds.start, bounds.end);

  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT
          pe.session_id AS session_id,
          pe.visitor_id AS visitor_id,
          pe.occurred_at AS occurred_at,
          pe.checkout_token AS checkout_token,
          pe.order_id AS order_id,
          pe.currency AS currency,
          pe.total_price AS total_price,
          pe.raw_json AS raw_json,
          s.country_code AS session_country
        FROM purchase_events pe
        LEFT JOIN sessions s ON s.session_id = pe.session_id
        WHERE pe.event_type = ?
          AND pe.occurred_at >= ? AND pe.occurred_at < ?
        ORDER BY pe.occurred_at ASC
      `,
      ['checkout_completed', bounds.start, bounds.end]
    );
  } catch (err) {
    console.error('[backfill-purchases] failed to read purchase_events:', err && err.message ? err.message : err);
    process.exitCode = 1;
    return;
  }

  console.log('[backfill-purchases] evidence_rows=%s', rows.length);

  let inserted = 0;
  let already = 0;
  let skipped = 0;

  for (const r of rows) {
    const sessionId = trimStr(r && r.session_id != null ? String(r.session_id) : null, 64);
    if (!sessionId) { skipped++; continue; }

    const raw = safeJsonParse(r && r.raw_json ? String(r.raw_json) : '') || {};

    const checkoutToken = trimStr(r && r.checkout_token != null ? String(r.checkout_token) : null, 128) || trimStr(raw.checkout_token, 128);
    const orderId = trimStr(r && r.order_id != null ? String(r.order_id) : null, 128) || trimStr(raw.order_id, 128);
    const currency = trimStr(r && r.currency != null ? String(r.currency) : null, 16) || trimStr(raw.order_currency, 16);
    const orderTotalRaw = (raw && raw.order_total != null) ? raw.order_total : (r && r.total_price != null ? r.total_price : null);
    const occurredAt = (r && r.occurred_at != null) ? Number(r.occurred_at) : null;
    const purchasedAt = (occurredAt != null && Number.isFinite(occurredAt)) ? occurredAt : now;

    const purchaseKey = computePurchaseKeyFromParts({
      checkoutToken,
      orderId,
      orderCurrency: currency,
      orderTotalRaw,
      tsMs: purchasedAt,
      sessionId,
    });

    const visitorId = trimStr(r && r.visitor_id != null ? String(r.visitor_id) : null, 64) || trimStr(raw.visitor_id, 64) || null;
    const orderTotal = numOrNull(orderTotalRaw);
    const country = normalizeCountry(raw.country_code) || normalizeCountry(r && r.session_country != null ? String(r.session_country) : null) || null;

    const params = [
      purchaseKey,
      sessionId,
      visitorId,
      purchasedAt,
      orderTotal,
      currency || null,
      orderId || null,
      checkoutToken || null,
      country,
    ];

    try {
      const q = pg
        ? `INSERT INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (purchase_key) DO NOTHING`
        : `INSERT OR IGNORE INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const res = await db.run(q, params);
      const changes = res && typeof res.changes === 'number' ? res.changes : 0;
      if (changes > 0) inserted += 1;
      else already += 1;
    } catch (err) {
      console.error('[backfill-purchases] insert failed:', err && err.message ? err.message : err);
      skipped += 1;
    }
  }

  console.log('[backfill-purchases] inserted=%s already_present=%s skipped=%s', inserted, already, skipped);
}

main().catch((err) => {
  console.error('[backfill-purchases] fatal:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

