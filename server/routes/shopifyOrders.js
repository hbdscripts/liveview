const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');

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

async function getShopifyOrders(req, res) {
  try {
    const shop = (req.query.shop || '').trim().toLowerCase();
    if (!shop || !shop.endsWith('.myshopify.com')) {
      return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
    }

    const db = getDb();
    const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
    if (!row || !row.access_token) {
      return res.status(401).json({
        error: 'No access token for this store. Install the app (complete OAuth) first.',
      });
    }

    const timeZone = (req.query.timezone || '').trim() || store.resolveAdminTimeZone();
    const nowMs = Date.now();
    const { start, end } = store.getRangeBounds('today', nowMs, timeZone);

    try {
      await salesTruth.ensureReconciled(shop, start, end, 'orders_today');
    } catch (_) {}

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const countRow = await db.get(
      `
        SELECT COUNT(*) AS n
        FROM orders_shopify
        WHERE shop = ?
          AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    );
    const total = countRow && countRow.n != null ? Number(countRow.n) : 0;

    const rows = await db.all(
      `
        SELECT
          order_id AS order_id,
          order_name AS order_name,
          created_at AS created_at,
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          total_price AS total_price,
          raw_json AS raw_json
        FROM orders_shopify
        WHERE shop = ?
          AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      [shop, start, end, limit, offset]
    );

    const orders = (rows || []).map((r) => {
      const rawJson = r && r.raw_json != null ? String(r.raw_json) : '';
      const createdAt = r && r.created_at != null ? Number(r.created_at) : null;
      const currency = safeStr(r && r.currency ? r.currency : 'GBP', 16).toUpperCase() || 'GBP';
      const totalPrice = numOrNull(r && r.total_price != null ? r.total_price : null);
      return {
        orderId: safeStr(r && r.order_id, 64) || null,
        orderName: safeStr(r && r.order_name, 64) || null,
        createdAt: createdAt != null && Number.isFinite(createdAt) ? createdAt : null,
        currency,
        totalPrice,
        countryCode: parseCountryFromOrderRawJson(rawJson),
        topProductTitle: parseTopProductTitle(rawJson),
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    return res.json({ ok: true, source: 'orders_shopify', range: { key: 'today', start, end, timeZone }, orders, total });
  } catch (err) {
    console.error('[shopify-orders]', err);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { getShopifyOrders };
