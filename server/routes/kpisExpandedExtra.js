/**
 * GET /api/kpis-expanded-extra?range=...
 * Extra KPIs that are only needed when the expanded KPI grid is shown.
 *
 * Note: These are not polled frequently; keep cached but accurate per range.
 */
const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const reportCache = require('../reportCache');
const salesTruth = require('../salesTruth');

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (ALLOWED_RANGE.has(r) || isDayKey || isRangeKey) return r;
  return 'today';
}

async function computeExpandedExtras(bounds, timeZone) {
  const db = getDb();
  const start = bounds.start;
  const end = bounds.end;
  const shop = salesTruth.resolveShopForSales('');

  // Items sold: sum of line-item quantities for paid, non-cancelled, non-test orders.
  let itemsSold = 0;
  try {
    const row = config.dbUrl
      ? await db.get(
        `SELECT COALESCE(SUM(quantity), 0) AS units
         FROM orders_shopify_line_items
         WHERE shop = $1 AND order_created_at >= $2 AND order_created_at < $3
           AND (order_test IS NULL OR order_test = 0)
           AND order_cancelled_at IS NULL
           AND order_financial_status = 'paid'`,
        [shop, start, end]
      )
      : await db.get(
        `SELECT COALESCE(SUM(quantity), 0) AS units
         FROM orders_shopify_line_items
         WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
           AND (order_test IS NULL OR order_test = 0)
           AND order_cancelled_at IS NULL
           AND order_financial_status = 'paid'`,
        [shop, start, end]
      );
    const u = row && row.units != null ? Number(row.units) : 0;
    itemsSold = Number.isFinite(u) ? Math.trunc(u) : 0;
  } catch (_) {
    itemsSold = 0;
  }

  // Fulfilled + returns: fetched from Shopify (cached), since we don't store fulfillment/refund status in DB yet.
  let ordersFulfilled = null;
  let returns = null;
  try {
    if (shop) {
      const r = await salesTruth.fetchShopifyFulfillmentAndReturnsCounts(shop, start, end);
      if (r && r.ok) {
        ordersFulfilled = typeof r.ordersFulfilled === 'number' ? r.ordersFulfilled : null;
        returns = typeof r.returns === 'number' ? r.returns : null;
      }
    }
  } catch (_) {}

  return {
    itemsSold,
    ordersFulfilled,
    returns,
  };
}

async function getKpisExpandedExtra(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');

  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '');
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  try {
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'kpisExpandedExtra',
        rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: { rangeKey, timeZone },
        ttlMs: 5 * 60 * 1000,
        force,
      },
      async () => {
        // Compare bounds: previous-period comparison (same duration).
        const periodLengthMs = bounds.end - bounds.start;
        let compareStart = bounds.start - periodLengthMs;
        let compareEnd = bounds.start;
        if (rangeKey === 'today') {
          const yb = store.getRangeBounds('yesterday', now, timeZone);
          compareStart = yb.start;
          compareEnd = Math.min(yb.end, compareStart + periodLengthMs);
        }
        if (compareStart < 0) compareStart = 0;
        if (compareEnd < 0) compareEnd = 0;

        const current = await computeExpandedExtras(bounds, timeZone);
        const compare = (compareEnd > compareStart)
          ? await computeExpandedExtras({ start: compareStart, end: compareEnd }, timeZone)
          : null;
        return {
          ...current,
          compare: compare ? {
            itemsSold: typeof compare.itemsSold === 'number' ? compare.itemsSold : null,
            ordersFulfilled: typeof compare.ordersFulfilled === 'number' ? compare.ordersFulfilled : null,
            returns: typeof compare.returns === 'number' ? compare.returns : null,
          } : null,
        };
      }
    );
    res.json(cached && cached.ok ? cached.data : null);
  } catch (err) {
    console.error('[kpisExpandedExtra]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { getKpisExpandedExtra };

