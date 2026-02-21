/**
 * GET /api/sales-diagnostics?shop=xxx.myshopify.com&range=today|yesterday|1h
 *
 * Shows drift between:
 * - Shopify truth (orders_shopify)
 * - Pixel evidence (purchase_events checkout_completed)
 *
 * Fail-open: if truth isn't synced, we still return DB truth + health state.
 */
const store = require('../store');
const salesTruth = require('../salesTruth');
const { getDb } = require('../db');

const RANGE_KEYS = ['today', 'yesterday', '1h', '3d', '7d', 'month'];

function clampRange(v) {
  const key = (v || 'today').toString().trim().toLowerCase();
  return RANGE_KEYS.includes(key) ? key : 'today';
}

async function getSalesDiagnostics(req, res) {
  const db = getDb();
  const shop = salesTruth.resolveShopForSales(req.query.shop || '');
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const rangeKey = clampRange(req.query.range || 'today');
  const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));

  // Best-effort: keep truth cache fresh for today.
  if (shop && rangeKey === 'today') {
    try {
      await salesTruth.ensureReconciled(shop, bounds.start, bounds.end, 'today');
    } catch (_) {}
  }

  const truthOrderCount = shop ? await salesTruth.getTruthOrderCount(shop, bounds.start, bounds.end) : 0;
  const truthRevenueGbp = shop ? await salesTruth.getTruthSalesTotalGbp(shop, bounds.start, bounds.end) : 0;
  const healthScope = rangeKey === 'today'
    ? 'today'
    : salesTruth.scopeForRangeKey(rangeKey, 'range');
  const health = await salesTruth.getTruthHealth(shop || '', healthScope);

  // Pixel-derived totals (purchases, deduped in query).
  let pixelOrderCount = null;
  let pixelRevenueGbp = null;
  try {
    const s = await store.getPixelSalesSummary(bounds.start, bounds.end);
    pixelOrderCount = typeof s.orderCount === 'number' ? s.orderCount : null;
    pixelRevenueGbp = typeof s.revenueGbp === 'number' ? s.revenueGbp : null;
  } catch (_) {}

  // Evidence counts (append-only).
  let evidenceTotal = 0;
  let evidenceLinked = 0;
  let evidenceUnlinked = 0;
  if (shop) {
    const row = await db.get(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN linked_order_id IS NOT NULL THEN 1 ELSE 0 END) AS linked,
        SUM(CASE WHEN linked_order_id IS NULL THEN 1 ELSE 0 END) AS unlinked
      FROM purchase_events
      WHERE shop = ? AND event_type = 'checkout_completed'
        AND occurred_at >= ? AND occurred_at < ?
      `,
      [shop, bounds.start, bounds.end]
    );
    evidenceTotal = row?.total != null ? Number(row.total) || 0 : 0;
    evidenceLinked = row?.linked != null ? Number(row.linked) || 0 : 0;
    evidenceUnlinked = row?.unlinked != null ? Number(row.unlinked) || 0 : 0;
  }

  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  res.json({
    shop,
    timeZone,
    range: { key: rangeKey, start: bounds.start, end: bounds.end },
    reporting,
    truth: { orderCount: truthOrderCount, revenueGbp: truthRevenueGbp },
    pixel: { orderCount: pixelOrderCount, revenueGbp: pixelRevenueGbp, label: 'pixel-derived (purchases)' },
    evidence: { checkoutCompleted: evidenceTotal, linked: evidenceLinked, unlinked: evidenceUnlinked },
    health,
    drift: {
      pixelVsTruthOrders: (typeof pixelOrderCount === 'number') ? (pixelOrderCount - truthOrderCount) : null,
      pixelVsTruthRevenueGbp: (typeof pixelRevenueGbp === 'number') ? Math.round((pixelRevenueGbp - truthRevenueGbp) * 100) / 100 : null,
      evidenceVsTruthOrders: (evidenceTotal != null) ? (evidenceTotal - truthOrderCount) : null,
    },
  });
}

module.exports = { getSalesDiagnostics };

