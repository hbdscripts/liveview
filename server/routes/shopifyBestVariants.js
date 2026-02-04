/**
 * GET /api/shopify-best-variants?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10
 * Returns best selling variants by revenue for the date range (Shopify Orders + Products API).
 */
const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');

const API_VERSION = '2024-01';
const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getShopifyBestVariants(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  let range = (req.query.range || 'today').toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }
  if (!RANGE_KEYS.includes(range)) range = 'today';

  const db = getDb();
  const row = await db.get('SELECT access_token, scope FROM shop_sessions WHERE shop = ?', [shop]);
  if (!row || !row.access_token) {
    return res.status(401).json({
      error: 'No access token for this store. Install the app (complete OAuth) first.',
    });
  }

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  const token = row.access_token;
  const variantMap = new Map(); // variant_id -> { variant_id, product_id, title, variant_title, orderIds: Set<order_id>, revenue }
  let totalOrders = 0;

  try {
    // Ensure Shopify truth cache is populated for this range (throttled).
    await salesTruth.ensureReconciled(shop, start, end, `best_variants_${range}`);

    const orderRows = await db.all(
      `
        SELECT order_id, raw_json
        FROM orders_shopify
        WHERE shop = ? AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    );

    totalOrders = Array.isArray(orderRows) ? orderRows.length : 0;
    for (const r of orderRows || []) {
      let order = null;
      try {
        order = r && r.raw_json ? JSON.parse(r.raw_json) : null;
      } catch (_) {
        order = null;
      }
      const orderId = r && r.order_id ? r.order_id : (order && order.id ? String(order.id) : null);
      const lineItems = order && Array.isArray(order.line_items) ? order.line_items : [];
      for (const li of lineItems) {
        const variantId = li && li.variant_id ? li.variant_id : null;
        const productId = li && li.product_id ? li.product_id : null;
        if (!variantId || !productId) continue;
        const qty = Math.max(0, parseInt(li.quantity, 10) || 0);
        const price = parseFloat(li.price) || 0;
        const lineTotal = qty * price;
        const title = (li.title || '').trim() || 'Unknown';
        const variantTitle = (li.variant_title || '').trim();

        let entry = variantMap.get(variantId);
        if (!entry) {
          entry = {
            variant_id: variantId,
            product_id: productId,
            title,
            variant_title: variantTitle && variantTitle.toLowerCase() !== 'default title' ? variantTitle : null,
            orderIds: new Set(),
            revenue: 0,
          };
          variantMap.set(variantId, entry);
        }
        if (orderId) entry.orderIds.add(orderId);
        entry.revenue += lineTotal;
      }
    }

    const list = Array.from(variantMap.values())
      .map((e) => ({
        variant_id: e.variant_id,
        product_id: e.product_id,
        title: e.title,
        variant_title: e.variant_title,
        orders: e.orderIds.size,
        revenue: Math.round(e.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const pageSize = clampInt(req.query.pageSize, 10, 1, 10);
    const totalCount = list.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = clampInt(req.query.page, 1, 1, totalPages);
    const startIdx = (page - 1) * pageSize;
    const pageItems = list.slice(startIdx, startIdx + pageSize);

    const productCache = new Map(); // product_id -> { handle, thumb_url }
    for (const v of pageItems) {
      const cached = productCache.get(v.product_id);
      if (cached) {
        v.handle = cached.handle;
        v.thumb_url = cached.thumb_url;
        continue;
      }
      try {
        const prodRes = await fetch(
          `https://${shop}/admin/api/${API_VERSION}/products/${v.product_id}.json`,
          { headers: { 'X-Shopify-Access-Token': token } }
        );
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          const prod = prodData.product || {};
          const img = prod.image || (Array.isArray(prod.images) && prod.images[0]) || null;
          const thumbUrl = img && (img.src || img.url) ? (img.src || img.url) : null;
          const handle = (prod.handle && String(prod.handle).trim()) || null;
          productCache.set(v.product_id, { handle, thumb_url: thumbUrl });
          v.handle = handle;
          v.thumb_url = thumbUrl;
        } else {
          productCache.set(v.product_id, { handle: null, thumb_url: null });
          v.handle = null;
          v.thumb_url = null;
        }
      } catch (_) {
        productCache.set(v.product_id, { handle: null, thumb_url: null });
        v.handle = null;
        v.thumb_url = null;
      }
    }

    // Cache: Shopify-derived report; allow 15 min caching to reduce API load.
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Vary', 'Cookie');
    return res.json({ bestVariants: pageItems, totalOrders, page, pageSize, totalCount });
  } catch (err) {
    console.error('[shopify-best-variants]', err);
    return res.status(500).json({ error: 'Failed to fetch best variants' });
  }
}

module.exports = { getShopifyBestVariants };

