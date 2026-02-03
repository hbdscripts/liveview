/**
 * GET /api/shopify-best-sellers?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10&sort=rev|orders&dir=asc|desc
 * Returns best selling products by revenue for the date range (Shopify Orders + Products API).
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

async function getShopifyBestSellers(req, res) {
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
  const productMap = new Map(); // product_id -> { product_id, title, orders: Set<order_id>, revenue }
  let totalOrders = 0;

  try {
    let nextPageUrl = `https://${shop}/admin/api/${API_VERSION}/orders.json?status=any&created_at_min=${encodeURIComponent(createdMin)}&created_at_max=${encodeURIComponent(createdMax)}&limit=250`;

    while (nextPageUrl) {
      const orderRes = await fetch(nextPageUrl, {
        headers: { 'X-Shopify-Access-Token': token },
      });
      if (!orderRes.ok) {
        const errText = await orderRes.text();
        console.error('[shopify-best-sellers] Orders API error:', orderRes.status, errText);
        return res.status(502).json({ error: 'Shopify API error', details: orderRes.status });
      }
      const data = await orderRes.json();
      const orders = data.orders || [];
      for (const order of orders) {
        totalOrders += 1;
        const orderId = order.id;
        const lineItems = order.line_items || [];
        for (const li of lineItems) {
          const productId = li.product_id;
          if (!productId) continue;
          const qty = Math.max(0, parseInt(li.quantity, 10) || 0);
          const price = parseFloat(li.price) || 0;
          const lineTotal = qty * price;
          const title = (li.title || '').trim() || 'Unknown';
          let entry = productMap.get(productId);
          if (!entry) {
            entry = { product_id: productId, title, orderIds: new Set(), revenue: 0 };
            productMap.set(productId, entry);
          }
          entry.orderIds.add(orderId);
          entry.revenue += lineTotal;
        }
      }
      const link = orderRes.headers.get('link');
      nextPageUrl = null;
      if (link && (link.includes('rel="next"') || link.includes('rel=next'))) {
        const match = link.match(/<([^>]+)>;\s*rel="?next"?/);
        if (match) nextPageUrl = match[1];
      }
    }

    const list = Array.from(productMap.values())
      .map((e) => ({
        product_id: e.product_id,
        title: e.title,
        orders: e.orderIds.size,
        revenue: Math.round(e.revenue * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const sort = (req.query.sort || 'rev').toString().trim().toLowerCase();
    const dir = (req.query.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    const mult = dir === 'asc' ? 1 : -1;
    if (sort === 'orders') {
      list.sort((a, b) => (mult * ((a.orders || 0) - (b.orders || 0))) || (mult * ((a.revenue || 0) - (b.revenue || 0))));
    } else {
      // default: rev
      list.sort((a, b) => (mult * ((a.revenue || 0) - (b.revenue || 0))) || (mult * ((a.orders || 0) - (b.orders || 0))));
    }

    const pageSize = clampInt(req.query.pageSize, 10, 1, 10);
    const totalCount = list.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = clampInt(req.query.page, 1, 1, totalPages);
    const startIdx = (page - 1) * pageSize;
    const pageItems = list.slice(startIdx, startIdx + pageSize);

    for (const p of pageItems) {
      try {
        const prodRes = await fetch(
          `https://${shop}/admin/api/${API_VERSION}/products/${p.product_id}.json`,
          { headers: { 'X-Shopify-Access-Token': token } }
        );
        if (prodRes.ok) {
          const prodData = await prodRes.json();
          const prod = prodData.product || {};
          const img = prod.image || (Array.isArray(prod.images) && prod.images[0]) || null;
          p.thumb_url = img && (img.src || img.url) ? (img.src || img.url) : null;
          p.handle = (prod.handle && String(prod.handle).trim()) || null;
        }
      } catch (_) {
        p.thumb_url = null;
        p.handle = null;
      }
    }

    const conversionRate = totalOrders > 0 ? (p) => Math.round((p.orders / totalOrders) * 1000) / 10 : () => null;
    const bestSellers = pageItems.map((p) => ({
      product_id: p.product_id,
      title: p.title,
      handle: p.handle || null,
      thumb_url: p.thumb_url || null,
      orders: p.orders,
      revenue: p.revenue,
      cr: conversionRate(p),
    }));

    return res.json({ bestSellers, totalOrders, page, pageSize, totalCount, sort, dir });
  } catch (err) {
    console.error('[shopify-best-sellers]', err);
    return res.status(500).json({ error: 'Failed to fetch best sellers' });
  }
}

module.exports = { getShopifyBestSellers };
