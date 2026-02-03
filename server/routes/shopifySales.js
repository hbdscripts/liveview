/**
 * GET /api/shopify-sales?shop=xxx.myshopify.com
 * Returns today's total sales and order count from Shopify Orders API (since midnight in ADMIN_TIMEZONE)
 * so the dashboard Sales figure matches Shopify.
 */

const config = require('../config');
const { getDb } = require('../db');
const store = require('../store');

const API_VERSION = '2024-01';

async function getShopifySalesToday(req, res) {
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

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds('today', nowMs, timeZone);
  const createdMin = new Date(start).toISOString();
  const createdMax = new Date(end).toISOString();

  let totalSales = 0;
  let orderCount = 0;
  let nextPageUrl = `https://${shop}/admin/api/${API_VERSION}/orders.json?status=any&created_at_min=${encodeURIComponent(createdMin)}&created_at_max=${encodeURIComponent(createdMax)}&limit=250`;

  try {
    while (nextPageUrl) {
      const orderRes = await fetch(nextPageUrl, {
        headers: { 'X-Shopify-Access-Token': row.access_token },
      });
      if (!orderRes.ok) {
        const errText = await orderRes.text();
        console.error('[shopify-sales] Orders API error:', orderRes.status, errText);
        return res.status(502).json({ error: 'Shopify API error', details: orderRes.status });
      }
      const data = await orderRes.json();
      const orders = data.orders || [];
      for (const order of orders) {
        const price = order.total_price != null ? parseFloat(String(order.total_price)) : 0;
        if (!Number.isNaN(price)) {
          totalSales += price;
          orderCount += 1;
        }
      }
      const link = orderRes.headers.get('link');
      nextPageUrl = null;
      if (link && (link.includes('rel="next"') || link.includes('rel=next'))) {
        const match = link.match(/<([^>]+)>;\s*rel="?next"?/);
        if (match) nextPageUrl = match[1];
      }
    }
    return res.json({ salesToday: Math.round(totalSales * 100) / 100, orderCountToday: orderCount });
  } catch (err) {
    console.error('[shopify-sales]', err);
    return res.status(500).json({ error: 'Failed to fetch Shopify sales' });
  }
}

module.exports = { getShopifySalesToday };
