const Sentry = require('@sentry/node');
const { getDb } = require('../db');
const store = require('../store');
const fx = require('../fx');
const { normalizeRangeKey } = require('../rangeKey');
const { percentOrNull, ratioOrNull } = require('../metrics');

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }

function safeRangeKey(raw) {
  // Keep consistent with other insights endpoints.
  const allowed = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
  return normalizeRangeKey(raw, { defaultKey: 'today', allowed, allowCustomDay: true, allowCustomRange: true, allowFriendlyDays: true });
}

function dayKeyUtc(ms) {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return null;
  try { return new Date(n).toISOString().slice(0, 10); } catch (_) { return null; }
}

function dayStartUtcMs(ms) {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return null;
  try {
    const d = new Date(n);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  } catch (_) {
    return null;
  }
}

function buildDayCategories(startMs, endMs) {
  const start = dayStartUtcMs(startMs);
  const end = dayStartUtcMs(endMs);
  if (start == null || end == null) return [];
  const out = [];
  // end is exclusive; include the start day, stop before end day.
  for (let t = start; t < end; t += 24 * 60 * 60 * 1000) {
    const k = dayKeyUtc(t);
    if (k) out.push(k);
  }
  // Ensure at least one bucket for very small ranges.
  if (!out.length) {
    const k = dayKeyUtc(startMs);
    if (k) out.push(k);
  }
  return out;
}

function normalizeGatewayKey(raw) {
  const out = s(raw).trim().toLowerCase();
  if (!out) return 'unknown';
  if (out.length > 64) return out.slice(0, 64);
  return out;
}

async function getPaymentTypesTable(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'payment-types.table', data: { range: req?.query?.range } });
  const range = safeRangeKey(req.query && req.query.range);
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const db = getDb();

  try {
    const [ratesToGbp, rowsCounts, rowsCarts, rowsRevenue] = await Promise.all([
      fx.getRatesToGbp().catch(() => null),
      db.all(
        `
        SELECT
          COALESCE(NULLIF(TRIM(payment_gateway), ''), 'unknown') AS payment_gateway,
          COUNT(DISTINCT purchase_key) AS orders,
          COUNT(DISTINCT session_id) AS sessions
        FROM purchases
        WHERE purchased_at >= ? AND purchased_at < ?
        GROUP BY 1
        `.trim(),
        [start, end]
      ),
      db.all(
        `
        SELECT
          COALESCE(NULLIF(TRIM(p.payment_gateway), ''), 'unknown') AS payment_gateway,
          COUNT(DISTINCT CASE WHEN (COALESCE(s.cart_qty, 0) > 0 OR COALESCE(s.cart_value, 0) > 0) THEN p.session_id ELSE NULL END) AS carts
        FROM purchases p
        LEFT JOIN sessions s ON s.session_id = p.session_id
        WHERE p.purchased_at >= ? AND p.purchased_at < ?
        GROUP BY 1
        `.trim(),
        [start, end]
      ),
      db.all(
        `
        SELECT
          COALESCE(NULLIF(TRIM(payment_gateway), ''), 'unknown') AS payment_gateway,
          COALESCE(NULLIF(TRIM(order_currency), ''), 'GBP') AS order_currency,
          SUM(order_total) AS revenue
        FROM purchases
        WHERE purchased_at >= ? AND purchased_at < ? AND order_total IS NOT NULL
        GROUP BY 1, 2
        `.trim(),
        [start, end]
      ),
    ]);

    const cartsByGateway = new Map();
    for (const r of rowsCarts || []) {
      const k = normalizeGatewayKey(r.payment_gateway);
      const n = r && r.carts != null ? Number(r.carts) : 0;
      cartsByGateway.set(k, Number.isFinite(n) ? n : 0);
    }

    const revenueByGateway = new Map();
    for (const r of rowsRevenue || []) {
      const k = normalizeGatewayKey(r.payment_gateway);
      const cur = s(r.order_currency).trim().toUpperCase() || 'GBP';
      const amt = r && r.revenue != null ? Number(r.revenue) : null;
      if (!Number.isFinite(amt)) continue;
      const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
      if (gbp == null) continue;
      revenueByGateway.set(k, (revenueByGateway.get(k) || 0) + gbp);
    }

    const out = [];
    for (const r of rowsCounts || []) {
      const k = normalizeGatewayKey(r.payment_gateway);
      const orders = r && r.orders != null ? Number(r.orders) : 0;
      const sessions = r && r.sessions != null ? Number(r.sessions) : 0;
      const revenue = revenueByGateway.get(k) || 0;
      const carts = cartsByGateway.get(k) || 0;
      const cr = percentOrNull(orders, sessions, { decimals: 1 });
      const vpv = ratioOrNull(revenue, sessions, { decimals: 2 });
      const aov = ratioOrNull(revenue, orders, { decimals: 2 });
      out.push({
        payment_gateway: k,
        sessions: Number.isFinite(sessions) ? sessions : 0,
        carts: Number.isFinite(carts) ? carts : 0,
        orders: Number.isFinite(orders) ? orders : 0,
        cr,
        vpv,
        revenue: Number.isFinite(revenue) ? revenue : 0,
        aov,
      });
    }

    out.sort((a, b) => {
      const ar = typeof a.revenue === 'number' ? a.revenue : 0;
      const br = typeof b.revenue === 'number' ? b.revenue : 0;
      if (br !== ar) return br - ar;
      const bo = (b.orders || 0) - (a.orders || 0);
      if (bo) return bo;
      return (b.sessions || 0) - (a.sessions || 0);
    });

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    return res.json({
      ok: true,
      range,
      start,
      end,
      currency: 'GBP',
      rows: out.slice(0, 40),
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'payment-types.table', range } });
    console.error('[payment-types.table]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load payment types table' });
  }
}

async function getPaymentTypesSeries(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'payment-types.series', data: { range: req?.query?.range } });
  const range = safeRangeKey(req.query && req.query.range);
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const db = getDb();

  try {
    const [ratesToGbp, rows] = await Promise.all([
      fx.getRatesToGbp().catch(() => null),
      db.all(
        `
        SELECT
          purchased_at,
          COALESCE(NULLIF(TRIM(payment_gateway), ''), 'unknown') AS payment_gateway,
          COALESCE(NULLIF(TRIM(order_currency), ''), 'GBP') AS order_currency,
          order_total
        FROM purchases
        WHERE purchased_at >= ? AND purchased_at < ? AND order_total IS NOT NULL
        `.trim(),
        [start, end]
      ),
    ]);

    const categories = buildDayCategories(start, end);
    const idxByDay = new Map();
    categories.forEach((k, i) => idxByDay.set(k, i));

    const totals = new Map(); // gateway -> total revenue gbp
    const seriesMap = new Map(); // gateway -> data[]

    function ensureSeries(key) {
      if (seriesMap.has(key)) return seriesMap.get(key);
      const arr = new Array(categories.length).fill(0);
      seriesMap.set(key, arr);
      return arr;
    }

    for (const r of rows || []) {
      const gateway = normalizeGatewayKey(r.payment_gateway);
      const ts = r && r.purchased_at != null ? Number(r.purchased_at) : NaN;
      if (!Number.isFinite(ts)) continue;
      const day = dayKeyUtc(ts);
      if (!day || !idxByDay.has(day)) continue;
      const amt = r && r.order_total != null ? Number(r.order_total) : NaN;
      if (!Number.isFinite(amt)) continue;
      const cur = s(r.order_currency).trim().toUpperCase() || 'GBP';
      const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
      if (gbp == null) continue;
      const arr = ensureSeries(gateway);
      const i = idxByDay.get(day);
      arr[i] += gbp;
      totals.set(gateway, (totals.get(gateway) || 0) + gbp);
    }

    const gateways = Array.from(totals.entries())
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 8)
      .map(([k]) => k);

    const series = gateways.map((k) => ({
      key: k,
      name: k,
      data: ensureSeries(k).map((v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
      }),
    }));

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    return res.json({
      ok: true,
      range,
      start,
      end,
      currency: 'GBP',
      categories,
      series,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'payment-types.series', range } });
    console.error('[payment-types.series]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load payment types series' });
  }
}

module.exports = { getPaymentTypesTable, getPaymentTypesSeries };

