/**
 * GET /api/latest-sale
 *
 * Returns latest paid Shopify order (truth) we can attribute to a session, plus a best-effort
 * "top product" (most expensive line item) for UI notifications.
 *
 * Fail-open: if truth isn't configured/linked, falls back to most recent purchase row.
 */
const store = require('../store');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const { getDb } = require('../db');

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
  return best ? best.title : '';
}

async function getLatestSale(req, res) {
  try {
    const db = getDb();
    const shop = salesTruth.resolveShopForSales(req.query && req.query.shop ? req.query.shop : '');
    const tz = store.resolveAdminTimeZone();
    const nowMs = Date.now();
    const bounds = store.getRangeBounds('today', nowMs, tz);

    let row = null;
    if (shop) {
      // Prefer orders that are linked to a session via evidence so we can show a country flag.
      row = await db.get(
        `
        SELECT
          o.order_id AS order_id,
          o.order_name AS order_name,
          o.created_at AS created_at,
          COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency,
          o.total_price AS total_price,
          o.raw_json AS raw_json,
          COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(pe.cf_country), ''), 'XX') AS country_code
        FROM purchase_events pe
        INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
        LEFT JOIN sessions s ON s.session_id = pe.session_id
        WHERE pe.shop = ?
          AND pe.event_type = 'checkout_completed'
          AND o.created_at >= ? AND o.created_at < ?
          AND (o.test IS NULL OR o.test = 0)
          AND o.cancelled_at IS NULL
          AND o.financial_status = 'paid'
        ORDER BY o.created_at DESC
        LIMIT 1
        `,
        [shop, bounds.start, bounds.end]
      );

      // Fall back to truth-only when we have no linked evidence yet.
      if (!row) {
        row = await db.get(
          `
          SELECT
            order_id AS order_id,
            order_name AS order_name,
            created_at AS created_at,
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
            total_price AS total_price,
            raw_json AS raw_json,
            'XX' AS country_code
          FROM orders_shopify
          WHERE shop = ?
            AND created_at >= ? AND created_at < ?
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [shop, bounds.start, bounds.end]
        );
      }
    }

    // Last-resort fallback: pixel purchases table (no line items).
    if (!row) {
      row = await db.get(
        `
        SELECT
          order_id AS order_id,
          NULL AS order_name,
          purchased_at AS created_at,
          COALESCE(NULLIF(TRIM(order_currency), ''), 'GBP') AS currency,
          order_total AS total_price,
          NULL AS raw_json,
          COALESCE(NULLIF(TRIM(country_code), ''), 'XX') AS country_code
        FROM purchases
        WHERE purchased_at >= ? AND purchased_at < ?
        ORDER BY purchased_at DESC
        LIMIT 1
        `,
        [bounds.start, bounds.end]
      );
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');

    if (!row) {
      return res.json({ ok: true, sale: null });
    }

    const currency = safeStr(row.currency || 'GBP', 16).toUpperCase() || 'GBP';
    const total = numOrNull(row.total_price);
    const ratesToGbp = await fx.getRatesToGbp();
    const gbp = total == null ? null : fx.convertToGbp(total, currency, ratesToGbp);

    const sale = {
      orderId: safeStr(row.order_id, 64) || null,
      orderName: safeStr(row.order_name, 64) || null,
      createdAt: row.created_at != null ? Number(row.created_at) : null,
      countryCode: normalizeCountry(row.country_code),
      amountGbp: gbp != null && Number.isFinite(gbp) ? Math.round(gbp * 100) / 100 : null,
      productTitle: parseTopProductTitle(row.raw_json),
    };

    res.json({ ok: true, sale, shop, range: { key: 'today', start: bounds.start, end: bounds.end, timeZone: tz } });
  } catch (err) {
    console.error('[latest-sale]', err);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { getLatestSale };

