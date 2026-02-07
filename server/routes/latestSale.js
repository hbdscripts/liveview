/**
 * GET /api/latest-sale
 *
 * Returns latest paid Shopify order (truth) we can attribute to a session, plus a best-effort
 * "top product" (most expensive line item) for UI notifications.
 *
 * Guardrail: never fall back to pixel-derived purchases (sales must never exceed Shopify truth).
 */
const store = require('../store');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const productMetaCache = require('../shopifyProductMetaCache');
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

function parseTopProduct(rawJson) {
  if (!rawJson || typeof rawJson !== 'string') return { title: '', productId: null };
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
      const productIdRaw = (li && li.product_id != null ? li.product_id : null) ?? li?.productId ?? null;
      const productId = productIdRaw != null ? safeStr(productIdRaw, 64) : '';
      best = { title, unit, qty, lineTotal, productId: productId || null };
    }
  }
  return best ? { title: best.title, productId: best.productId || null } : { title: '', productId: null };
}

async function getLatestSale(req, res) {
  try {
    const db = getDb();
    const shop = salesTruth.resolveShopForSales(req.query && req.query.shop ? req.query.shop : '');
    const tz = store.resolveAdminTimeZone();
    const nowMs = Date.now();
    const bounds = store.getRangeBounds('today', nowMs, tz);

    // Always use chronologically latest order (truth) so footer "last sale" time and toast content match.
    // Session link can lag; if we preferred "latest with purchase_events" we could return 2nd-latest.
    let row = null;
    let source = null;
    if (shop) {
      try { await salesTruth.ensureReconciled(shop, bounds.start, bounds.end, 'latest_sale_today'); } catch (_) {}

      row = await db.get(
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
        LIMIT 1
        `,
        [shop, bounds.start, bounds.end]
      );
      if (row) {
        source = 'orders_shopify';
        // Enrich country from purchase_events + sessions when evidence exists (may lag for newest order).
        const linkRow = await db.get(
          `
          SELECT COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(pe.cf_country), ''), 'XX') AS country_code
          FROM purchase_events pe
          LEFT JOIN sessions s ON s.session_id = pe.session_id
          WHERE pe.shop = ? AND pe.linked_order_id = ? AND pe.event_type IN ('checkout_completed', 'checkout_started')
          LIMIT 1
          `,
          [shop, row.order_id]
        );
        const evidenceCc = linkRow && linkRow.country_code ? linkRow.country_code : 'XX';
        const normalizedEvidence = normalizeCountry(evidenceCc);
        const rawJsonCc = normalizedEvidence === 'XX' ? parseCountryFromOrderRawJson(row.raw_json) : 'XX';
        row.country_code = rawJsonCc && rawJsonCc !== 'XX' ? rawJsonCc : normalizedEvidence;
      }
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

    const topProduct = parseTopProduct(row.raw_json);
    const countryCode = normalizeCountry(row.country_code);
    const sale = {
      source: source || null,
      orderId: safeStr(row.order_id, 64) || null,
      orderName: safeStr(row.order_name, 64) || null,
      createdAt: row.created_at != null ? Number(row.created_at) : null,
      countryCode,
      amountGbp: gbp != null && Number.isFinite(gbp) ? Math.round(gbp * 100) / 100 : null,
      productTitle: topProduct && topProduct.title ? topProduct.title : '',
    };

    const productId = topProduct && topProduct.productId ? safeStr(topProduct.productId, 64) : '';
    if (shop && productId) {
      try {
        const tokenRow = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
        const token = tokenRow && tokenRow.access_token ? String(tokenRow.access_token).trim() : '';
        if (token) {
          const meta = await productMetaCache.getProductMeta(shop, token, productId);
          if (meta && meta.ok) {
            const handle = safeStr(meta.handle, 128) || null;
            const thumbUrl = safeStr(meta.thumb_url, 1024) || null;
            if (handle) sale.productHandle = handle;
            if (thumbUrl) sale.productThumbUrl = thumbUrl;
          }
        }
      } catch (_) {
        // best-effort: skip meta when unavailable
      }
    }

    res.json({ ok: true, sale, shop, range: { key: 'today', start: bounds.start, end: bounds.end, timeZone: tz } });
  } catch (err) {
    console.error('[latest-sale]', err);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { getLatestSale };

