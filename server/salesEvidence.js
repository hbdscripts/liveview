/**
 * Pixel purchase evidence (append-only).
 *
 * On checkout_completed we always insert purchase_events for observability.
 * We attempt to link evidence -> orders_shopify by (order_id) then (checkout_token).
 */
const crypto = require('crypto');
const config = require('./config');
const { getDb } = require('./db');
const salesTruth = require('./salesTruth');

function trimStr(v, maxLen = 2048) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function resolveShopForEvent(payload) {
  const fromPayload = payload && typeof payload.shop === 'string' ? payload.shop.trim().toLowerCase() : '';
  const shop = salesTruth.resolveShopForSales(fromPayload);
  if (shop) return shop;
  return salesTruth.resolveShopForSales('');
}

function computeEventGroupKey(payload, occurredAtMs) {
  const token = trimStr(payload?.checkout_token, 128);
  const orderId = salesTruth.extractNumericId(payload?.order_id);
  if (token) return 'token:' + token;
  if (orderId) return 'order:' + orderId;
  const ts = typeof occurredAtMs === 'number' && Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now();
  const bucket15 = Math.floor(ts / 900000);
  const cur = trimStr(payload?.order_currency, 16) || '';
  const tot = payload?.order_total != null ? String(payload.order_total) : '';
  const sid = trimStr(payload?.session_id, 64) || '';
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + bucket15 + '|' + sid).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function findOrderToLink(shop, orderId, checkoutToken) {
  const db = getDb();
  if (orderId) {
    const row = await db.get('SELECT order_id FROM orders_shopify WHERE shop = ? AND order_id = ? LIMIT 1', [shop, orderId]);
    if (row && row.order_id) return { linkedOrderId: String(row.order_id), reason: 'order_id' };
  }
  if (checkoutToken) {
    const row = await db.get(
      'SELECT order_id FROM orders_shopify WHERE shop = ? AND checkout_token = ? LIMIT 1',
      [shop, checkoutToken]
    );
    if (row && row.order_id) return { linkedOrderId: String(row.order_id), reason: 'checkout_token' };
  }
  return { linkedOrderId: null, reason: null };
}

async function insertPurchaseEvent(payload, { receivedAtMs = Date.now(), cfContext = null } = {}) {
  const db = getDb();
  const shop = resolveShopForEvent(payload);
  const occurredAt = (payload && payload.ts != null) ? Number(payload.ts) : null;
  const occurredAtMs = (occurredAt != null && Number.isFinite(occurredAt)) ? occurredAt : receivedAtMs;

  const eventType = trimStr(payload?.event_type, 64) || 'checkout_completed';
  const visitorId = trimStr(payload?.visitor_id, 64);
  const sessionId = trimStr(payload?.session_id, 64);
  const pageUrl = trimStr(payload?.entry_url, 2048) || trimStr(payload?.path, 2048);
  const referrer = trimStr(payload?.referrer, 2048);

  const checkoutToken = trimStr(payload?.checkout_token, 128);
  const orderId = salesTruth.extractNumericId(payload?.order_id);
  const currency = trimStr(payload?.order_currency, 16);
  const totalPrice = numOrNull(payload?.order_total);

  const eventGroupKey = computeEventGroupKey(payload, occurredAtMs);

  const cfKnownBot = cfContext && (cfContext.cf_known_bot != null ? (String(cfContext.cf_known_bot) === '1' ? 1 : (String(cfContext.cf_known_bot) === '0' ? 0 : null)) : null);
  const cfCountry = cfContext ? trimStr(cfContext.cf_country, 2) : null;
  const cfAsn = cfContext ? trimStr(cfContext.cf_asn, 32) : null;
  const cfColo = cfContext ? trimStr(cfContext.cf_colo, 32) : null;
  const cfVerifiedBotCategory = cfContext ? trimStr(cfContext.cf_verified_bot_category, 128) : null;

  const link = await findOrderToLink(shop, orderId, checkoutToken);

  let rawJson = null;
  try { rawJson = JSON.stringify(payload); } catch (_) { rawJson = null; }

  await db.run(
    `
    INSERT INTO purchase_events
      (shop, occurred_at, received_at, event_type, visitor_id, session_id, page_url, referrer,
       checkout_token, order_id, currency, total_price,
       cf_known_bot, cf_country, cf_asn, cf_colo, cf_verified_bot_category,
       event_group_key, linked_order_id, link_reason, raw_json)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?)
    `,
    [
      shop,
      occurredAtMs,
      receivedAtMs,
      eventType,
      visitorId,
      sessionId,
      pageUrl,
      referrer,
      checkoutToken,
      orderId,
      currency,
      totalPrice,
      cfKnownBot,
      cfCountry,
      cfAsn,
      cfColo,
      cfVerifiedBotCategory,
      eventGroupKey,
      link.linkedOrderId,
      link.reason,
      rawJson,
    ]
  );

  return { ok: true, shop, linkedOrderId: link.linkedOrderId, linkReason: link.reason };
}

/**
 * After orders are reconciled, link previously unlinked evidence by order_id/checkout_token.
 * This is best-effort and safe (no deletes; only sets linked_order_id when null).
 */
async function backfillEvidenceLinksForOrder(shop, orderId, checkoutToken) {
  const db = getDb();
  if (!shop || !orderId) return { linked: 0 };
  let linked = 0;
  try {
    if (orderId) {
      const r1 = await db.run(
        `UPDATE purchase_events SET linked_order_id = ?, link_reason = COALESCE(link_reason, 'order_id_late')
         WHERE shop = ? AND linked_order_id IS NULL AND order_id = ?`,
        [orderId, shop, orderId]
      );
      linked += r1 && r1.changes ? Number(r1.changes) : 0;
    }
    if (checkoutToken) {
      const r2 = await db.run(
        `UPDATE purchase_events SET linked_order_id = ?, link_reason = COALESCE(link_reason, 'checkout_token_late')
         WHERE shop = ? AND linked_order_id IS NULL AND checkout_token = ?`,
        [orderId, shop, checkoutToken]
      );
      linked += r2 && r2.changes ? Number(r2.changes) : 0;
    }
  } catch (_) {}
  return { linked };
}

module.exports = {
  insertPurchaseEvent,
  backfillEvidenceLinksForOrder,
};

