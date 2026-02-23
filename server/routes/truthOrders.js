/**
 * GET /api/truth-orders?range=today|yesterday|3d|7d|14d|30d|month|1h|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD
 *
 * Lists Shopify "truth" paid orders (orders_shopify) for the selected range using
 * sale time = COALESCE(processed_at, created_at) so it matches KPI semantics.
 *
 * Includes best-effort attribution/evidence status from purchase_events so UI can
 * explain gaps between "Shopify paid" and "tracked sessions".
 */
const { getDb, isPostgres } = require('../db');
const store = require('../store');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const { normalizeRangeKey } = require('../rangeKey');

function safeStr(v, maxLen = 512) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCountry(v) {
  const s = safeStr(v, 4).toUpperCase();
  if (!s) return 'XX';
  const code = s.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(code)) return 'XX';
  return code;
}

function parseCountryFromOrderRawJson(rawJson) {
  if (!rawJson || typeof rawJson !== 'string') return 'XX';
  let order = null;
  try {
    order = JSON.parse(rawJson);
  } catch (_) {
    order = null;
  }
  const ship = (order && (order.shipping_address || order.shippingAddress)) || null;
  const bill = (order && (order.billing_address || order.billingAddress)) || null;
  const candidates = [
    ship && (ship.country_code || ship.countryCode),
    bill && (bill.country_code || bill.countryCode),
  ];
  for (const c of candidates) {
    const cc = normalizeCountry(c);
    if (cc && cc !== 'XX') return cc;
  }
  return 'XX';
}

function parseTopProductTitle(rawJson) {
  if (!rawJson || typeof rawJson !== 'string') return '';
  let order = null;
  try {
    order = JSON.parse(rawJson);
  } catch (_) {
    order = null;
  }
  const items = order && Array.isArray(order.line_items) ? order.line_items : [];
  let best = null;
  for (const li of items) {
    const title = safeStr(li && li.title, 256);
    if (!title) continue;
    const qtyRaw = li && li.quantity != null ? li.quantity : 1;
    const qty = (() => {
      const n = typeof qtyRaw === 'number' ? qtyRaw : parseInt(String(qtyRaw), 10);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
    })();
    const priceRaw =
      (li && li.price != null ? li.price : null) ??
      li?.price_set?.shop_money?.amount ??
      li?.priceSet?.shopMoney?.amount ??
      null;
    const unit = numOrNull(priceRaw) ?? 0;
    const lineTotal = unit * qty;
    if (!Number.isFinite(lineTotal)) continue;
    if (!best || lineTotal > best.lineTotal || (lineTotal === best.lineTotal && unit > best.unit)) {
      best = { title, unit, qty, lineTotal };
    }
  }
  return best && best.title ? best.title : '';
}

function chunk(list, size) {
  const out = [];
  const n = Array.isArray(list) ? list.length : 0;
  const sz = Math.max(1, Math.trunc(Number(size) || 1));
  for (let i = 0; i < n; i += sz) out.push(list.slice(i, i + sz));
  return out;
}

function uniqNonEmpty(list, maxLen = 256) {
  const seen = new Set();
  const out = [];
  for (const v of (Array.isArray(list) ? list : [])) {
    const s = safeStr(v, maxLen);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getTruthOrders(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');

    const rangeAllowed = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month', '1h']);
    const rangeKey = normalizeRangeKey(req?.query?.range, { defaultKey: 'today', allowed: rangeAllowed });
    const force = !!(req?.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

    const timeZone = store.resolveAdminTimeZone();
    const bounds = store.getRangeBounds(rangeKey, Date.now(), timeZone);
    const start = Number(bounds.start);
    const end = Number(bounds.end);

    const shop = salesTruth.resolveShopForSales(req?.query?.shop || '');
    if (!shop) {
      return res.json({
        ok: true,
        shop: '',
        range: { key: rangeKey, start, end, timeZone },
        orders: [],
        total: 0,
        note: 'No shop configured for Shopify truth.',
      });
    }

    // For "today"/"1h" views, block on reconcile so the page can reach 100% of Shopify quickly.
    // Other ranges can be expensive; default to best-effort unless force=1.
    const shouldBlockReconcile = force || rangeKey === 'today' || rangeKey === '1h';
    if (shouldBlockReconcile) {
      try {
        const scope = salesTruth.scopeForRangeKey(rangeKey, 'truth_orders');
        await salesTruth.ensureReconciled(shop, start, end, scope);
      } catch (_) {}
    } else {
      try {
        const scope = salesTruth.scopeForRangeKey(rangeKey, 'truth_orders');
        salesTruth.ensureReconciled(shop, start, end, scope).catch(() => {});
      } catch (_) {}
    }

    const db = getDb();
    const limit = clampInt(req?.query?.limit, 25, 1, 100);
    const offset = clampInt(req?.query?.offset, 0, 0, 1000000);

    const wherePaid =
      `shop = ${isPostgres() ? '$1' : '?'} AND ` +
      `(COALESCE(processed_at, created_at) >= ${isPostgres() ? '$2' : '?'} AND COALESCE(processed_at, created_at) < ${isPostgres() ? '$3' : '?'}) ` +
      `AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`;
    const params = [shop, start, end];

    const countSql = `SELECT COUNT(*) AS n FROM orders_shopify WHERE ${wherePaid}`;
    const countRow = await db.get(countSql, params);
    const total = countRow && countRow.n != null ? Number(countRow.n) || 0 : 0;

    const rows = await db.all(
      `SELECT
         order_id,
         order_name,
         created_at,
         processed_at,
         COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
         total_price,
         checkout_token,
         raw_json
       FROM orders_shopify
       WHERE ${wherePaid}
       ORDER BY COALESCE(processed_at, created_at) DESC
       LIMIT ${isPostgres() ? '$4' : '?'} OFFSET ${isPostgres() ? '$5' : '?'}`,
      [...params, limit, offset]
    );

    const orderIds = uniqNonEmpty((rows || []).map(r => (r && r.order_id != null ? r.order_id : '')), 64);
    const checkoutTokens = uniqNonEmpty((rows || []).map(r => (r && r.checkout_token != null ? r.checkout_token : '')), 128);

    // Evidence lookup: for each order, try to find the most recent purchase_events row that either:
    // - is already linked to this truth order (linked_order_id), or
    // - contains the order_id / checkout_token (unlinked evidence).
    const evidenceByOrderId = new Map(); // order_id -> { kind, sessionId, occurredAt, linkReason }
    const evidenceByToken = new Map(); // checkout_token -> { kind, sessionId, occurredAt, linkReason, linkedOrderId }

    async function loadEvidenceByLinkedOrderId(ids) {
      if (!ids.length) return;
      for (const chunkIds of chunk(ids, 500)) {
        const placeholders = chunkIds.map((_, i) => (isPostgres() ? `$${2 + i}` : '?')).join(', ');
        const sql = isPostgres()
          ? `SELECT linked_order_id, session_id, occurred_at, link_reason
             FROM purchase_events
             WHERE shop = $1
               AND event_type IN ('checkout_completed', 'checkout_started')
               AND linked_order_id IN (${placeholders})
             ORDER BY occurred_at DESC`
          : `SELECT linked_order_id, session_id, occurred_at, link_reason
             FROM purchase_events
             WHERE shop = ?
               AND event_type IN ('checkout_completed', 'checkout_started')
               AND linked_order_id IN (${placeholders})
             ORDER BY occurred_at DESC`;
        const evRows = await db.all(sql, [shop, ...chunkIds]);
        for (const r of evRows || []) {
          const oid = safeStr(r && r.linked_order_id, 64);
          if (!oid) continue;
          if (evidenceByOrderId.has(oid)) continue; // keep most recent (DESC)
          evidenceByOrderId.set(oid, {
            kind: 'linked_order_id',
            sessionId: safeStr(r && r.session_id, 128) || null,
            occurredAt: r && r.occurred_at != null ? Number(r.occurred_at) : null,
            linkReason: safeStr(r && r.link_reason, 64) || null,
          });
        }
      }
    }

    async function loadEvidenceByOrderId(ids) {
      if (!ids.length) return;
      for (const chunkIds of chunk(ids, 500)) {
        const placeholders = chunkIds.map((_, i) => (isPostgres() ? `$${2 + i}` : '?')).join(', ');
        const sql = isPostgres()
          ? `SELECT order_id, session_id, occurred_at, linked_order_id, link_reason
             FROM purchase_events
             WHERE shop = $1
               AND event_type IN ('checkout_completed', 'checkout_started')
               AND order_id IN (${placeholders})
             ORDER BY occurred_at DESC`
          : `SELECT order_id, session_id, occurred_at, linked_order_id, link_reason
             FROM purchase_events
             WHERE shop = ?
               AND event_type IN ('checkout_completed', 'checkout_started')
               AND order_id IN (${placeholders})
             ORDER BY occurred_at DESC`;
        const evRows = await db.all(sql, [shop, ...chunkIds]);
        for (const r of evRows || []) {
          const oid = safeStr(r && r.order_id, 64);
          if (!oid) continue;
          if (evidenceByOrderId.has(oid)) continue; // linked already wins (we load linked first)
          evidenceByOrderId.set(oid, {
            kind: 'order_id',
            sessionId: safeStr(r && r.session_id, 128) || null,
            occurredAt: r && r.occurred_at != null ? Number(r.occurred_at) : null,
            linkReason: safeStr(r && r.link_reason, 64) || null,
            linkedOrderId: safeStr(r && r.linked_order_id, 64) || null,
          });
        }
      }
    }

    async function loadEvidenceByCheckoutToken(tokens) {
      if (!tokens.length) return;
      for (const chunkTokens of chunk(tokens, 500)) {
        const placeholders = chunkTokens.map((_, i) => (isPostgres() ? `$${2 + i}` : '?')).join(', ');
        const sql = isPostgres()
          ? `SELECT checkout_token, session_id, occurred_at, linked_order_id, link_reason
             FROM purchase_events
             WHERE shop = $1
               AND event_type IN ('checkout_completed', 'checkout_started')
               AND checkout_token IN (${placeholders})
             ORDER BY occurred_at DESC`
          : `SELECT checkout_token, session_id, occurred_at, linked_order_id, link_reason
             FROM purchase_events
             WHERE shop = ?
               AND event_type IN ('checkout_completed', 'checkout_started')
               AND checkout_token IN (${placeholders})
             ORDER BY occurred_at DESC`;
        const evRows = await db.all(sql, [shop, ...chunkTokens]);
        for (const r of evRows || []) {
          const tk = safeStr(r && r.checkout_token, 128);
          if (!tk) continue;
          if (evidenceByToken.has(tk)) continue;
          evidenceByToken.set(tk, {
            kind: 'checkout_token',
            sessionId: safeStr(r && r.session_id, 128) || null,
            occurredAt: r && r.occurred_at != null ? Number(r.occurred_at) : null,
            linkReason: safeStr(r && r.link_reason, 64) || null,
            linkedOrderId: safeStr(r && r.linked_order_id, 64) || null,
          });
        }
      }
    }

    await loadEvidenceByLinkedOrderId(orderIds);
    await loadEvidenceByOrderId(orderIds);
    await loadEvidenceByCheckoutToken(checkoutTokens);

    const ratesToGbp = await fx.getRatesToGbp();
    const orders = (rows || []).map((r) => {
      const orderId = safeStr(r && r.order_id, 64) || null;
      const orderName = safeStr(r && r.order_name, 64) || null;
      const createdAt = r && r.created_at != null ? Number(r.created_at) : null;
      const processedAt = r && r.processed_at != null ? Number(r.processed_at) : null;
      const saleAt = (processedAt != null && Number.isFinite(processedAt)) ? processedAt : (createdAt != null && Number.isFinite(createdAt) ? createdAt : null);
      const currency = safeStr(r && r.currency ? r.currency : 'GBP', 16).toUpperCase() || 'GBP';
      const totalPrice = numOrNull(r && r.total_price != null ? r.total_price : null);
      const gbpVal = (totalPrice != null) ? fx.convertToGbp(totalPrice, currency, ratesToGbp) : null;
      const totalGbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? Math.round(gbpVal * 100) / 100 : null;
      const checkoutToken = safeStr(r && r.checkout_token, 128) || null;
      const rawJson = r && r.raw_json != null ? String(r.raw_json) : '';

      const byOrder = orderId ? evidenceByOrderId.get(orderId) : null;
      const byToken = checkoutToken ? evidenceByToken.get(checkoutToken) : null;

      const hasCheckoutToken = !!(checkoutToken && checkoutToken.trim());
      const hasEvidence = !!(byOrder || byToken);
      const isLinked = !!(byOrder && byOrder.kind === 'linked_order_id');
      const sessionId = (byOrder && byOrder.sessionId) ? byOrder.sessionId : (byToken && byToken.sessionId ? byToken.sessionId : null);
      const evidenceOccurredAt = (byOrder && byOrder.occurredAt != null) ? byOrder.occurredAt : (byToken && byToken.occurredAt != null ? byToken.occurredAt : null);
      const linkReason = (byOrder && byOrder.linkReason) ? byOrder.linkReason : (byToken && byToken.linkReason ? byToken.linkReason : null);

      const evidenceStatus = !hasCheckoutToken
        ? 'non_checkout_channel'
        : isLinked
          ? 'linked'
          : hasEvidence
            ? 'evidence_unlinked'
            : 'no_evidence';

      return {
        orderId,
        orderName,
        createdAt: createdAt != null && Number.isFinite(createdAt) ? createdAt : null,
        processedAt: processedAt != null && Number.isFinite(processedAt) ? processedAt : null,
        saleAt,
        currency,
        totalPrice,
        totalGbp,
        checkoutToken: checkoutToken || null,
        countryCode: parseCountryFromOrderRawJson(rawJson),
        topProductTitle: parseTopProductTitle(rawJson),
        evidence: {
          status: evidenceStatus,
          hasEvidence,
          isLinked,
          sessionId,
          occurredAt: evidenceOccurredAt != null && Number.isFinite(evidenceOccurredAt) ? evidenceOccurredAt : null,
          linkReason,
        },
      };
    });

    res.json({
      ok: true,
      shop,
      range: { key: rangeKey, start, end, timeZone },
      orders,
      total,
    });
  } catch (err) {
    console.error('[truth-orders]', err);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { getTruthOrders };

