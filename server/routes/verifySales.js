/**
 * GET /api/verify-sales?shop=xxx.myshopify.com
 *
 * Verifies (Shopify fetched) vs (DB truth orders_shopify) for:
 * 1) Today so far (Europe/London midnight → now)
 * 2) Last 1 hour
 * 3) Yesterday (full day Europe/London)
 *
 * Writes results into audit_log. Fail-open: if Shopify fetch fails, returns error indicators.
 */
const store = require('../store');
const salesTruth = require('../salesTruth');
const { writeAudit } = require('../audit');

function round2(n) {
  const x = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

async function verifySales(req, res) {
  const shop = salesTruth.resolveShopForSales(req.query.shop || '');
  if (!shop) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const ranges = [
    { key: 'today', label: 'today', bounds: store.getRangeBounds('today', nowMs, timeZone) },
    { key: '1h', label: 'last_1h', bounds: store.getRangeBounds('1h', nowMs, timeZone) },
    { key: 'yesterday', label: 'yesterday', bounds: store.getRangeBounds('yesterday', nowMs, timeZone) },
  ];

  const results = [];
  for (const r of ranges) {
    const start = r.bounds.start;
    const end = r.bounds.end;
    let shopify = null;
    let dbTruth = null;
    let diff = null;
    let reconcile = null;
    let error = null;
    try {
      reconcile = await salesTruth.reconcileRange(shop, start, end, `verify_${r.label}`);
      if (reconcile && reconcile.ok === false && reconcile.error) {
        error = String(reconcile.error);
      }
      shopify = reconcile && reconcile.shopify ? reconcile.shopify : null;
      const orderCount = await salesTruth.getTruthOrderCount(shop, start, end);
      const revenueGbp = await salesTruth.getTruthSalesTotalGbp(shop, start, end);
      const returningCustomerCount = await salesTruth.getTruthReturningCustomerCount(shop, start, end);
      const returningRevenueGbp = await salesTruth.getTruthReturningRevenueGbp(shop, start, end);
      dbTruth = { orderCount, revenueGbp, returningCustomerCount, returningRevenueGbp };
      if (shopify && dbTruth) {
        const shopifyReturningCustomers = shopify?.returning?.customerCount != null ? Number(shopify.returning.customerCount) : null;
        const shopifyReturningRevenueGbp = shopify?.returning?.revenueGbp != null ? Number(shopify.returning.revenueGbp) : null;
        diff = {
          orderCount: (dbTruth.orderCount || 0) - (shopify.orderCount || 0),
          revenueGbp: round2((dbTruth.revenueGbp || 0) - (shopify.revenueGbp || 0)),
          returningCustomerCount: (dbTruth.returningCustomerCount || 0) - (shopifyReturningCustomers || 0),
          returningRevenueGbp: round2((dbTruth.returningRevenueGbp || 0) - (shopifyReturningRevenueGbp || 0)),
        };
      }
    } catch (e) {
      error = e && e.message ? String(e.message) : 'verify_failed';
    }
    results.push({
      range: { key: r.key, start, end },
      shopify,
      dbTruth,
      diff,
      ok: !!(diff && diff.orderCount === 0 && diff.revenueGbp === 0 && diff.returningCustomerCount === 0 && diff.returningRevenueGbp === 0),
      error,
    });
  }

  await writeAudit('system', 'verify_sales', {
    shop,
    timeZone,
    nowMs,
    results,
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({ shop, timeZone, nowMs, results });
}

module.exports = { verifySales };

