/**
 * GET /api/shopify-sales?shop=xxx.myshopify.com
 * Returns today's total sales and order count from Shopify Orders API (since midnight in ADMIN_TIMEZONE).
 * Uses financial_status=paid only so figures match Shopify dashboard Total sales and Orders.
 */

const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');

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
  // Keep truth cache warm (throttled). Fail-open: if Shopify fails, return last-synced DB truth.
  try {
    await salesTruth.ensureReconciled(shop, start, end, 'today');
  } catch (_) {}

  const [salesToday, orderCountToday, health] = await Promise.all([
    salesTruth.getTruthSalesTotalGbp(shop, start, end),
    salesTruth.getTruthOrderCount(shop, start, end),
    salesTruth.getTruthHealth(shop, 'today'),
  ]);

  return res.json({
    source: 'orders_shopify',
    salesToday,
    orderCountToday,
    health,
  });
}

module.exports = { getShopifySalesToday };
