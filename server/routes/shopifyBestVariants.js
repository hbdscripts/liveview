/**
 * GET /api/shopify-best-variants?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10
 * Returns best selling variants by revenue for the date range (Shopify Orders + Products API).
 */
const { getDb } = require('../db');
const store = require('../store');

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
  const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
  if (!row || !row.access_token) {
    return res.status(401).json({
      error: 'No access token for this store. Install the app (complete OAuth) first.',
    });
  }

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const createdMin = new Date(start).toISOString();
  const createdMax = new Date(end).toISOString();

  const token = row.access_token;
  const variantMap = new Map(); // variant_id -> { variant_id, product_id, title, variant_title, orderIds: Set<order_id>, revenue }
  let totalOrders = 0;

  try {
    let nextPageUrl = `https://${shop}/admin/api/${API_VERSION}/orders.json?status=any&created_at_min=${encodeURIComponent(createdMin)}&created_at_max=${encodeURIComponent(createdMax)}&limit=250`;

    while (nextPageUrl) {
      const orderRes = await fetch(nextPageUrl, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      if (!orderRes.ok) {
        const errText = await orderRes.text();
        console.error('[shopify-best-variants] Orders API error:', orderRes.status, errText);
        let message = 'Shopify API error';
        try {
          const errJson = errText ? JSON.parse(errText) : null;
          const first = errJson?.errors && (errJson.errors[0] || errJson.errors);
          if (typeof first === 'string') message = first;
          else if (first?.message) message = first.message;
        } catch (_) {}
        return res.status(502).json({
          error: message,
          shopifyStatus: orderRes.status,
          hint: orderRes.status === 401 || orderRes.status === 403
            ? 'Token may be missing or lack read_orders scope. Reinstall the app from Shopify Admin.'
            : orderRes.status === 429
              ? 'Shopify rate limit. Try again in a few minutes.'
              : undefined,
        });
      }
      const data = await orderRes.json();
      const orders = data.orders || [];
      for (const order of orders) {
        totalOrders += 1;
        const orderId = order.id;
        const lineItems = order.line_items || [];
        for (const li of lineItems) {
          const variantId = li.variant_id;
          const productId = li.product_id;
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
          entry.orderIds.add(orderId);
          entry.revenue += lineTotal;
        }
      }

      const link = orderRes.headers.get('link');
      nextPageUrl = null;
      if (link && (link.includes('rel=\"next\"') || link.includes('rel=next'))) {
        const match = link.match(/<([^>]+)>;\s*rel=\"?next\"?/);
        if (match) nextPageUrl = match[1];
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

