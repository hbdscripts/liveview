const Sentry = require('@sentry/node');
const { getDb } = require('../db');
const store = require('../store');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const { normalizeRangeKey } = require('../rangeKey');
const { percentOrNull, ratioOrNull } = require('../metrics');

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }

function safeRangeKey(raw) {
  const allowed = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
  return normalizeRangeKey(raw, {
    defaultKey: 'today',
    allowed,
    allowCustomDay: true,
    allowCustomRange: true,
    allowFriendlyDays: true,
  });
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
  for (let t = start; t < end; t += 24 * 60 * 60 * 1000) {
    const k = dayKeyUtc(t);
    if (k) out.push(k);
  }
  if (!out.length) {
    const k = dayKeyUtc(startMs);
    if (k) out.push(k);
  }
  return out;
}

function normalizeBrowserKey(raw) {
  let out = s(raw).trim().toLowerCase();
  if (!out) return 'unknown';
  out = out.replace(/\s+/g, ' ');
  if (out.length > 64) out = out.slice(0, 64);
  return out;
}

function browserKeyFromUserAgent(uaRaw) {
  const ua = s(uaRaw).trim().toLowerCase();
  if (!ua) return 'unknown';
  // Order matters.
  if (ua.includes('edg/')) return 'edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'opera';
  if (ua.includes('firefox')) return 'firefox';
  if (ua.includes('samsungbrowser')) return 'samsung';
  // Chrome UA strings often include "safari" too.
  if (ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('edg/') && !ua.includes('opr/')) return 'chrome';
  if (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium')) return 'safari';
  return 'other';
}

function extractOrderUserAgent(orderRow) {
  const raw = orderRow && orderRow.raw_json != null ? String(orderRow.raw_json) : '';
  if (!raw) return '';
  try {
    const o = JSON.parse(raw);
    return (
      (o && o.client_details && o.client_details.user_agent) ||
      (o && o.clientDetails && o.clientDetails.userAgent) ||
      ''
    );
  } catch (_) {
    return '';
  }
}

function revenueAmountFromOrderRow(orderRow) {
  const sub = orderRow && orderRow.subtotal_price != null ? Number(orderRow.subtotal_price) : NaN;
  const tot = orderRow && orderRow.total_price != null ? Number(orderRow.total_price) : NaN;
  if (Number.isFinite(sub)) return sub;
  if (Number.isFinite(tot)) return tot;
  return NaN;
}

async function getBrowsersTable(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'browsers.table', data: { range: req?.query?.range } });
  const range = safeRangeKey(req.query && req.query.range);
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const db = getDb();

  try {
    const shop = salesTruth.resolveShopForSales('');
    const [ratesToGbp, rowsSessions, rowsOrders, rowsPurchases] = await Promise.all([
      fx.getRatesToGbp().catch(() => null),
      db.all(
        `
        SELECT
          COALESCE(NULLIF(TRIM(ua_browser), ''), 'unknown') AS ua_browser,
          COUNT(*) AS sessions,
          SUM(CASE WHEN (COALESCE(cart_qty, 0) > 0 OR COALESCE(cart_value, 0) > 0) THEN 1 ELSE 0 END) AS carts
        FROM sessions
        WHERE started_at >= ? AND started_at < ?
          AND (cf_known_bot IS NULL OR cf_known_bot = 0)
        GROUP BY 1
        `.trim(),
        [start, end]
      ),
      shop
        ? db.all(
          `
          SELECT
            raw_json,
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
            subtotal_price,
            total_price
          FROM orders_shopify
          WHERE shop = ?
            AND created_at >= ? AND created_at < ?
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
          `.trim(),
          [shop, start, end]
        )
        : Promise.resolve([]),
      // Fallback for local/unconfigured installs: purchases-derived revenue
      db.all(
        `
        SELECT
          COALESCE(NULLIF(TRIM(s.ua_browser), ''), 'unknown') AS ua_browser,
          COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS order_currency,
          COUNT(DISTINCT p.purchase_key) AS orders,
          SUM(p.order_total) AS revenue
        FROM purchases p
        LEFT JOIN sessions s ON s.session_id = p.session_id
        WHERE p.purchased_at >= ? AND p.purchased_at < ? AND p.order_total IS NOT NULL
          ${store.purchaseFilterExcludeDuplicateH('p')}
          ${store.purchaseFilterExcludeTokenWhenOrderExists('p')}
        GROUP BY 1, 2
        `.trim(),
        [start, end]
      ),
    ]);

    const sessionsByBrowser = new Map();
    const cartsByBrowser = new Map();
    for (const r of rowsSessions || []) {
      const k = normalizeBrowserKey(r.ua_browser);
      const sessions = r && r.sessions != null ? Number(r.sessions) : 0;
      const carts = r && r.carts != null ? Number(r.carts) : 0;
      sessionsByBrowser.set(k, Number.isFinite(sessions) ? sessions : 0);
      cartsByBrowser.set(k, Number.isFinite(carts) ? carts : 0);
    }

    const ordersByBrowser = new Map();
    const revenueByBrowser = new Map();
    if (rowsOrders && rowsOrders.length) {
      for (const r of rowsOrders || []) {
        const ua = extractOrderUserAgent(r);
        const k = normalizeBrowserKey(browserKeyFromUserAgent(ua));
        const cur = s(r.currency).trim().toUpperCase() || 'GBP';
        const amt = revenueAmountFromOrderRow(r);
        if (!Number.isFinite(amt)) continue;
        ordersByBrowser.set(k, (ordersByBrowser.get(k) || 0) + 1);
        const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
        if (gbp == null) continue;
        revenueByBrowser.set(k, (revenueByBrowser.get(k) || 0) + gbp);
      }
    } else {
      for (const r of rowsPurchases || []) {
        const k = normalizeBrowserKey(r.ua_browser);
        const cur = s(r.order_currency).trim().toUpperCase() || 'GBP';
        const orders = r && r.orders != null ? Number(r.orders) : 0;
        const rev = r && r.revenue != null ? Number(r.revenue) : null;
        if (Number.isFinite(orders) && orders > 0) ordersByBrowser.set(k, (ordersByBrowser.get(k) || 0) + orders);
        if (!Number.isFinite(rev)) continue;
        const gbp = fx.convertToGbp(rev, cur, ratesToGbp);
        if (gbp == null) continue;
        revenueByBrowser.set(k, (revenueByBrowser.get(k) || 0) + gbp);
      }
    }

    const keys = new Set([
      ...Array.from(sessionsByBrowser.keys()),
      ...Array.from(ordersByBrowser.keys()),
      ...Array.from(revenueByBrowser.keys()),
      ...Array.from(cartsByBrowser.keys()),
    ]);

    const out = [];
    for (const k of keys) {
      const sessions = sessionsByBrowser.get(k) || 0;
      const carts = cartsByBrowser.get(k) || 0;
      const orders = ordersByBrowser.get(k) || 0;
      const revenue = Math.round(((revenueByBrowser.get(k) || 0) * 100)) / 100;
      out.push({
        ua_browser: k,
        sessions,
        carts,
        orders,
        cr: percentOrNull(orders, sessions),
        vpv: ratioOrNull(revenue, sessions),
        revenue,
        aov: ratioOrNull(revenue, orders),
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
    Sentry.captureException(err, { extra: { route: 'browsers.table', range } });
    console.error('[browsers.table]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load browsers table' });
  }
}

async function getBrowsersSeries(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'browsers.series', data: { range: req?.query?.range } });
  const range = safeRangeKey(req.query && req.query.range);
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const db = getDb();

  try {
    const shop = salesTruth.resolveShopForSales('');
    const [ratesToGbp, rowsOrders, rows] = await Promise.all([
      fx.getRatesToGbp().catch(() => null),
      shop
        ? db.all(
          `
          SELECT
            created_at,
            raw_json,
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
            subtotal_price,
            total_price
          FROM orders_shopify
          WHERE shop = ?
            AND created_at >= ? AND created_at < ?
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
          `.trim(),
          [shop, start, end]
        )
        : Promise.resolve([]),
      // Fallback for local/unconfigured installs
      db.all(
        `
        SELECT
          p.purchased_at,
          COALESCE(NULLIF(TRIM(s.ua_browser), ''), 'unknown') AS ua_browser,
          COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS order_currency,
          p.order_total
        FROM purchases p
        LEFT JOIN sessions s ON s.session_id = p.session_id
        WHERE p.purchased_at >= ? AND p.purchased_at < ? AND p.order_total IS NOT NULL
          ${store.purchaseFilterExcludeDuplicateH('p')}
          ${store.purchaseFilterExcludeTokenWhenOrderExists('p')}
        `.trim(),
        [start, end]
      ),
    ]);

    const categories = buildDayCategories(start, end);
    const idxByDay = new Map();
    categories.forEach((k, i) => idxByDay.set(k, i));

    const totals = new Map(); // browser -> total revenue gbp
    const seriesMap = new Map(); // browser -> data[]

    function ensureSeries(key) {
      if (seriesMap.has(key)) return seriesMap.get(key);
      const arr = new Array(categories.length).fill(0);
      seriesMap.set(key, arr);
      return arr;
    }

    if (rowsOrders && rowsOrders.length) {
      for (const r of rowsOrders || []) {
        const ua = extractOrderUserAgent(r);
        const key = normalizeBrowserKey(browserKeyFromUserAgent(ua));
        const ts = r && r.created_at != null ? Number(r.created_at) : NaN;
        if (!Number.isFinite(ts)) continue;
        const day = dayKeyUtc(ts);
        if (!day || !idxByDay.has(day)) continue;
        const amt = revenueAmountFromOrderRow(r);
        if (!Number.isFinite(amt)) continue;
        const cur = s(r.currency).trim().toUpperCase() || 'GBP';
        const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
        if (gbp == null) continue;
        const arr = ensureSeries(key);
        const i = idxByDay.get(day);
        arr[i] += gbp;
        totals.set(key, (totals.get(key) || 0) + gbp);
      }
    } else {
      for (const r of rows || []) {
        const key = normalizeBrowserKey(r.ua_browser);
        const ts = r && r.purchased_at != null ? Number(r.purchased_at) : NaN;
        if (!Number.isFinite(ts)) continue;
        const day = dayKeyUtc(ts);
        if (!day || !idxByDay.has(day)) continue;
        const amt = r && r.order_total != null ? Number(r.order_total) : NaN;
        if (!Number.isFinite(amt)) continue;
        const cur = s(r.order_currency).trim().toUpperCase() || 'GBP';
        const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
        if (gbp == null) continue;
        const arr = ensureSeries(key);
        const i = idxByDay.get(day);
        arr[i] += gbp;
        totals.set(key, (totals.get(key) || 0) + gbp);
      }
    }

    const browsers = Array.from(totals.entries())
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 8)
      .map(([k]) => k);

    const series = browsers.map((k) => ({
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
    Sentry.captureException(err, { extra: { route: 'browsers.series', range } });
    console.error('[browsers.series]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load browsers series' });
  }
}

module.exports = { getBrowsersTable, getBrowsersSeries };

