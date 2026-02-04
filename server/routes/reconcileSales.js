/**
 * POST/GET /api/reconcile-sales?shop=xxx.myshopify.com&range=today|yesterday|3d|7d|month
 *
 * Forces a reconciliation run for the given range (Shopify → orders_shopify).
 * Writes audit_log entries via salesTruth.
 */
const store = require('../store');
const salesTruth = require('../salesTruth');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d', 'month', '1h'];

function clampRange(v) {
  const key = (v || 'today').toString().trim().toLowerCase();
  return RANGE_KEYS.includes(key) ? key : 'today';
}

async function reconcileSales(req, res) {
  const shop = salesTruth.resolveShopForSales((req.query.shop || (req.body && req.body.shop) || ''));
  if (!shop) return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  const rangeKey = clampRange(req.query.range || (req.body && req.body.range) || 'today');
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
  const scope = `manual_${rangeKey}`;
  const result = await salesTruth.reconcileRange(shop, bounds.start, bounds.end, scope);
  const health = await salesTruth.getTruthHealth(shop, 'today');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({ shop, range: { key: rangeKey, start: bounds.start, end: bounds.end }, result, health });
}

module.exports = { reconcileSales };

