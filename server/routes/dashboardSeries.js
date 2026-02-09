/**
 * GET /api/dashboard-series?days=7|14|30|90
 * Returns daily time-series data for the dashboard overview charts.
 * Each day includes: revenue, orders, sessions, convRate, aov, bounceRate.
 */
const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const salesTruth = require('../salesTruth');
const fx = require('../fx');
const reportCache = require('../reportCache');
const productMetaCache = require('../shopifyProductMetaCache');

function sessionFilterForTraffic(trafficMode) {
  if (trafficMode === 'human_only') {
    return config.dbUrl
      ? { sql: ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)', params: [] }
      : { sql: ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)', params: [] };
  }
  return { sql: '', params: [] };
}

async function getDashboardSeries(req, res) {
  const rangeRaw = (typeof req.query.range === 'string' ? req.query.range : '').trim().toLowerCase();
  const normalizeRange = (rk) => {
    const r = (rk == null ? '' : String(rk)).trim().toLowerCase();
    if (r === '7days') return '7d';
    if (r === '14days') return '14d';
    if (r === '30days') return '30d';
    return r;
  };
  const requestedRange = normalizeRange(rangeRaw);
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedRange = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month', '1h']);
  const rangeKey = (allowedRange.has(requestedRange) || isDayKey || isRangeKey) ? requestedRange : '';

  const daysRaw = parseInt(req.query.days, 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90 ? daysRaw : 7;
  const force = !!(req.query.force === '1' || req.query.force === 'true' || req.query._);
  const trafficMode = 'human_only';

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Vary', 'Cookie');

  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const todayBounds = store.getRangeBounds('today', now, timeZone);
  const bounds = rangeKey ? store.getRangeBounds(rangeKey, now, timeZone) : null;

  try {
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'dashboard-series',
        rangeKey: rangeKey ? ('range_' + rangeKey) : ('days_' + days),
        rangeStartTs: rangeKey ? bounds.start : todayBounds.start,
        rangeEndTs: rangeKey ? bounds.end : now,
        params: rangeKey ? { trafficMode, rangeKey } : { trafficMode, days },
        ttlMs: 5 * 60 * 1000,
        force,
      },
      () => rangeKey
        ? computeDashboardSeriesForBounds(bounds, now, timeZone, trafficMode)
        : computeDashboardSeries(days, now, timeZone, trafficMode)
    );
    res.json(cached && cached.ok ? cached.data : { series: [], topProducts: [], topCountries: [] });
  } catch (err) {
    console.error('[dashboard-series]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

async function computeDashboardSeries(days, nowMs, timeZone, trafficMode) {
  const db = getDb();
  const shop = salesTruth.resolveShopForSales('');
  const filter = sessionFilterForTraffic(trafficMode);

  // Platform start date: never show data before Feb 1 2025
  const PLATFORM_START = '2025-02-01';

  // Build day boundaries
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayParts = parseDateParts(fmt.format(new Date(nowMs)));
  const dayBounds = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
    d.setUTCDate(d.getUTCDate() - i);
    const parts = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const label = String(parts.year).padStart(4, '0') + '-' +
      String(parts.month).padStart(2, '0') + '-' +
      String(parts.day).padStart(2, '0');
    if (label < PLATFORM_START) continue; // skip dates before platform start
    const startMs = zonedTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
    let endMs;
    if (i === 0) {
      endMs = nowMs; // today: up to now
    } else {
      const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      next.setUTCDate(next.getUTCDate() + 1);
      endMs = zonedTimeToUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, timeZone);
    }
    dayBounds.push({ label, start: startMs, end: endMs });
  }

  const overallStart = dayBounds[0].start;
  const overallEnd = dayBounds[dayBounds.length - 1].end;

  // Best-effort guardrail: ensure truth cache is fresh for this range so dashboard-series
  // doesn't drift from /api/kpis (which reconciles before reporting).
  if (shop) {
    try {
      await salesTruth.ensureReconciled(shop, overallStart, overallEnd, 'dashboard_series');
    } catch (_) {}
  }

  // Fetch sessions + bounce per day
  const sessionsPerDay = {};
  const bouncePerDay = {};
  const filterAliased = filter.sql.replace(/sessions\./g, 's.');
  for (const db_day of dayBounds) {
    const ph = config.dbUrl ? ['$1', '$2'] : ['?', '?'];
    const sessRow = await db.get(
      'SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filterAliased,
      [db_day.start, db_day.end, ...filter.params]
    );
    sessionsPerDay[db_day.label] = sessRow ? Number(sessRow.n) || 0 : 0;

    const bounceRow = await db.get(
      'SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filterAliased +
      ' AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = \'page_viewed\') = 1',
      [db_day.start, db_day.end, ...filter.params]
    );
    bouncePerDay[db_day.label] = bounceRow ? Number(bounceRow.n) || 0 : 0;
  }

  // Fetch orders + revenue per day from Shopify truth
  const ratesToGbp = await fx.getRatesToGbp();
  const revenuePerDay = {};
  const ordersPerDay = {};
  if (shop) {
    const orderRows = await db.all(
      config.dbUrl
        ? `SELECT order_id, total_price, currency, created_at, raw_json
           FROM orders_shopify
           WHERE shop = $1 AND created_at >= $2 AND created_at < $3
             AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
        : `SELECT order_id, total_price, currency, created_at, raw_json
           FROM orders_shopify
           WHERE shop = ? AND created_at >= ? AND created_at < ?
             AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`,
      [shop, overallStart, overallEnd]
    );
    for (const row of orderRows) {
      const createdAt = Number(row.created_at);
      // Find which day this order belongs to
      let dayLabel = null;
      for (const db_day of dayBounds) {
        if (createdAt >= db_day.start && createdAt < db_day.end) {
          dayLabel = db_day.label;
          break;
        }
      }
      if (!dayLabel) continue;
      const price = parseFloat(row.total_price);
      const currency = (row.currency || 'GBP').toUpperCase();
      const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
      const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
      revenuePerDay[dayLabel] = (revenuePerDay[dayLabel] || 0) + gbp;
      ordersPerDay[dayLabel] = (ordersPerDay[dayLabel] || 0) + 1;
    }
  }

  // Fetch Shopify sessions per day (from shopify_sessions_snapshots)
  const shopifySessionsPerDay = {};
  if (shop) {
    try {
      const dayLabels = dayBounds.map(d => d.label);
      const shopifyRows = await db.all(
        config.dbUrl
          ? `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = $1 AND day_ymd >= $2 AND day_ymd <= $3
             GROUP BY day_ymd`
          : `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = ? AND day_ymd >= ? AND day_ymd <= ?`,
        [shop, dayLabels[0], dayLabels[dayLabels.length - 1]]
      );
      for (const r of shopifyRows) {
        shopifySessionsPerDay[r.day_ymd] = Number(r.sessions_count) || 0;
      }
    } catch (_) {}
  }

  // Build series
  const series = dayBounds.map(function(db_day) {
    const sessions = sessionsPerDay[db_day.label] || 0;
    const orders = ordersPerDay[db_day.label] || 0;
    const revenue = Math.round((revenuePerDay[db_day.label] || 0) * 100) / 100;
    const rawConv = sessions > 0 ? (orders / sessions) * 100 : 0;
    const convRate = Math.round(Math.min(rawConv, 100) * 10) / 10;
    const shopifySessions = shopifySessionsPerDay[db_day.label] || 0;
    const rawShopifyConv = shopifySessions > 0 ? (orders / shopifySessions) * 100 : null;
    const shopifyConvRate = rawShopifyConv != null ? Math.round(Math.min(rawShopifyConv, 100) * 10) / 10 : null;
    const aov = orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0;
    const bounced = bouncePerDay[db_day.label] || 0;
    const bounceRate = sessions > 0 ? Math.round((bounced / sessions) * 1000) / 10 : 0;
    return {
      date: db_day.label,
      revenue,
      orders,
      sessions,
      convRate,
      shopifyConvRate,
      aov,
      bounceRate,
    };
  });

  // Top products (last N days)
  let topProducts = [];
  if (shop) {
    try {
      const productRows = await db.all(
        config.dbUrl
          ? `SELECT TRIM(li.product_id) AS product_id, MAX(li.title) AS title, COALESCE(SUM(li.line_revenue), 0) AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = $1 AND li.order_created_at >= $2 AND li.order_created_at < $3
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status = 'paid'
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT 5`
          : `SELECT TRIM(li.product_id) AS product_id, MAX(li.title) AS title, COALESCE(SUM(li.line_revenue), 0) AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = ? AND li.order_created_at >= ? AND li.order_created_at < ?
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status = 'paid'
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT 5`,
        [shop, overallStart, overallEnd]
      );
      // Fetch product thumbnails
      let token = null;
      try { token = await salesTruth.getAccessToken(shop); } catch (_) {}
      const productIds = token ? productRows.map(r => r.product_id).filter(Boolean) : [];
      const metaMap = new Map();
      for (const pid of productIds) {
        try {
          const meta = await productMetaCache.getProductMeta(shop, token, pid);
          if (meta && meta.ok) metaMap.set(String(pid), meta);
        } catch (_) {}
      }
      topProducts = productRows.map(function(r) {
        const pid = r.product_id ? String(r.product_id) : '';
        const meta = metaMap.get(pid);
        return {
          title: r.title || 'Unknown',
          revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
          orders: Number(r.orders) || 0,
          thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
        };
      });
    } catch (_) {}
  }

  // Top countries by revenue
  let topCountries = [];
  if (shop) {
    try {
      const countryRows = await db.all(
        config.dbUrl
          ? `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = $1 AND created_at >= $2 AND created_at < $3
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
          : `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = ? AND created_at >= ? AND created_at < ?
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`,
        [shop, overallStart, overallEnd]
      );
      const countryMap = {};
      for (const r of countryRows) {
        let cc = 'XX';
        try {
          const json = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json;
          cc = (json && json.shipping_address && json.shipping_address.country_code) ||
               (json && json.billing_address && json.billing_address.country_code) || 'XX';
        } catch (_) {}
        cc = String(cc).toUpperCase().slice(0, 2) || 'XX';
        const price = parseFloat(r.total_price);
        const currency = (r.currency || 'GBP').toUpperCase();
        const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
        const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
        if (!countryMap[cc]) countryMap[cc] = { revenue: 0, orders: 0 };
        countryMap[cc].revenue += gbp;
        countryMap[cc].orders += 1;
      }
      topCountries = Object.entries(countryMap)
        .map(function(entry) {
          return { country: entry[0], revenue: Math.round(entry[1].revenue * 100) / 100, orders: entry[1].orders };
        })
        .sort(function(a, b) { return b.revenue - a.revenue; })
        .slice(0, 5);
    } catch (_) {}
  }

  // Ad spend per day (if ads DB available)
  let adSpendPerDay = {};
  try {
    const adsDb = require('../ads/adsDb');
    if (adsDb && typeof adsDb.getAdsPool === 'function') {
      const pool = adsDb.getAdsPool();
      if (pool) {
        const spendRows = await pool.query(
          `SELECT (hour_ts AT TIME ZONE 'UTC')::date::text AS day, COALESCE(SUM(spend_gbp), 0) AS spend_gbp
           FROM google_ads_spend_hourly
           WHERE (hour_ts AT TIME ZONE 'UTC')::date >= $1::date AND (hour_ts AT TIME ZONE 'UTC')::date <= $2::date
           GROUP BY (hour_ts AT TIME ZONE 'UTC')::date
           ORDER BY day`,
          [dayBounds[0].label, dayBounds[dayBounds.length - 1].label]
        );
        if (spendRows && spendRows.rows) {
          for (const r of spendRows.rows) {
            adSpendPerDay[r.day] = Math.round((Number(r.spend_gbp) || 0) * 100) / 100;
          }
        }
      }
    }
  } catch (_) {}

  // Merge ad spend into series
  for (const s of series) {
    s.adSpend = adSpendPerDay[s.date] || 0;
  }

  // Device breakdown (desktop vs mobile vs tablet)
  let desktopSessions = 0, mobileSessions = 0;
  try {
    const ph = config.dbUrl ? ['$1', '$2'] : ['?', '?'];
    const deviceRows = await db.all(
      'SELECT LOWER(COALESCE(s.ua_device_type, \'unknown\')) AS device, COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filter.sql.replace(/sessions\./g, 's.') + ' GROUP BY LOWER(COALESCE(s.ua_device_type, \'unknown\'))',
      [overallStart, overallEnd, ...filter.params]
    );
    for (const r of deviceRows) {
      const d = (r.device || '').trim();
      if (d === 'desktop') desktopSessions += Number(r.n) || 0;
      else if (d === 'mobile' || d === 'tablet') mobileSessions += Number(r.n) || 0;
    }
  } catch (_) {}

  // Returning vs new customer orders
  let newCustomerOrders = 0, returningCustomerOrders = 0;
  if (shop) {
    try {
      const ph = config.dbUrl ? ['$1', '$2', '$3'] : ['?', '?', '?'];
      const retRows = await db.all(
        config.dbUrl
          ? `SELECT CASE WHEN COALESCE(customer_orders_count, 1) > 1 THEN 'returning' ELSE 'new' END AS ctype, COUNT(*) AS n
             FROM orders_shopify
             WHERE shop = $1 AND created_at >= $2 AND created_at < $3
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'
             GROUP BY ctype`
          : `SELECT CASE WHEN COALESCE(customer_orders_count, 1) > 1 THEN 'returning' ELSE 'new' END AS ctype, COUNT(*) AS n
             FROM orders_shopify
             WHERE shop = ? AND created_at >= ? AND created_at < ?
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'
             GROUP BY ctype`,
        [shop, overallStart, overallEnd]
      );
      for (const r of retRows) {
        if (r.ctype === 'returning') returningCustomerOrders = Number(r.n) || 0;
        else newCustomerOrders = Number(r.n) || 0;
      }
    } catch (_) {}
  }

  // Summary totals
  let totalRevenue = 0, totalOrders = 0, totalSessions = 0, totalAdSpend = 0, totalBounced = 0;
  let aovHigh = 0, aovLow = Infinity;
  for (const s of series) {
    totalRevenue += s.revenue;
    totalOrders += s.orders;
    totalSessions += s.sessions;
    totalAdSpend += s.adSpend;
    totalBounced += (bouncePerDay[s.date] || 0);
    if (s.orders > 0) {
      if (s.aov > aovHigh) aovHigh = s.aov;
      if (s.aov < aovLow) aovLow = s.aov;
    }
  }
  if (!Number.isFinite(aovLow) || aovLow === Infinity) aovLow = 0;
  const avgConvRate = totalSessions > 0 ? Math.round(Math.min((totalOrders / totalSessions) * 100, 100) * 10) / 10 : 0;
  const avgAov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;
  const bounceRate = totalSessions > 0 ? Math.round((totalBounced / totalSessions) * 1000) / 10 : 0;
  const roas = totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : null;

  return {
    days,
    series,
    topProducts,
    topCountries,
    summary: {
      revenue: Math.round(totalRevenue * 100) / 100,
      orders: totalOrders,
      sessions: totalSessions,
      convRate: avgConvRate,
      aov: avgAov,
      aovHigh: Math.round(aovHigh * 100) / 100,
      aovLow: Math.round(aovLow * 100) / 100,
      bounceRate,
      adSpend: Math.round(totalAdSpend * 100) / 100,
      roas,
      desktopSessions,
      mobileSessions,
      newCustomerOrders,
      returningCustomerOrders,
    },
  };
}

function ymdFromMsInTz(ms, timeZone) {
  // en-GB: DD/MM/YYYY
  const s = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const parts = parseDateParts(s);
  return String(parts.year).padStart(4, '0') + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
}

function partsFromYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

function addDaysToParts(parts, deltaDays) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function ymdFromParts(parts) {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function computeDashboardSeriesForBounds(bounds, nowMs, timeZone, trafficMode) {
  const db = getDb();
  const shop = salesTruth.resolveShopForSales('');
  const filter = sessionFilterForTraffic(trafficMode);

  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : nowMs;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : nowMs;
  if (!(end > start)) {
    return { days: 0, series: [], topProducts: [], topCountries: [], summary: {} };
  }

  const startYmd = ymdFromMsInTz(start, timeZone);
  const endYmd = ymdFromMsInTz(Math.max(start, end - 1), timeZone);
  const startParts = partsFromYmd(startYmd);
  const endParts = partsFromYmd(endYmd);
  if (!startParts || !endParts) {
    return { days: 0, series: [], topProducts: [], topCountries: [], summary: {} };
  }

  const dayBounds = [];
  let cur = { year: startParts.year, month: startParts.month, day: startParts.day };
  const lastYmd = endYmd;
  while (true) {
    const label = ymdFromParts(cur);
    const startMsFull = zonedTimeToUtcMs(cur.year, cur.month, cur.day, 0, 0, 0, timeZone);
    const next = addDaysToParts(cur, 1);
    const endMsFull = zonedTimeToUtcMs(next.year, next.month, next.day, 0, 0, 0, timeZone);
    const dayStart = Math.max(startMsFull, start);
    const dayEnd = Math.min(endMsFull, end);
    if (dayEnd > dayStart) {
      dayBounds.push({ label, start: dayStart, end: dayEnd });
    }
    if (label === lastYmd) break;
    cur = next;
  }

  if (!dayBounds.length) {
    return { days: 0, series: [], topProducts: [], topCountries: [], summary: {} };
  }

  const overallStart = start;
  const overallEnd = end;

  // Best-effort guardrail: ensure truth cache is fresh for this range so dashboard-series
  // doesn't drift from /api/kpis (which reconciles before reporting).
  if (shop) {
    try {
      const scopeKey = ('dashboard_series_' + String(bounds && bounds.key ? bounds.key : '')).slice(0, 64) || 'dashboard_series';
      await salesTruth.ensureReconciled(shop, overallStart, overallEnd, scopeKey);
    } catch (_) {}
  }

  // Fetch sessions + bounce per day
  const sessionsPerDay = {};
  const bouncePerDay = {};
  const filterAliased = filter.sql.replace(/sessions\./g, 's.');
  for (const db_day of dayBounds) {
    const ph = config.dbUrl ? ['$1', '$2'] : ['?', '?'];
    const sessRow = await db.get(
      'SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filterAliased,
      [db_day.start, db_day.end, ...filter.params]
    );
    sessionsPerDay[db_day.label] = sessRow ? Number(sessRow.n) || 0 : 0;

    const bounceRow = await db.get(
      'SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filterAliased +
      ' AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = \'page_viewed\') = 1',
      [db_day.start, db_day.end, ...filter.params]
    );
    bouncePerDay[db_day.label] = bounceRow ? Number(bounceRow.n) || 0 : 0;
  }

  // Fetch orders + revenue per day from Shopify truth
  const ratesToGbp = await fx.getRatesToGbp();
  const revenuePerDay = {};
  const ordersPerDay = {};
  if (shop) {
    const orderRows = await db.all(
      config.dbUrl
        ? `SELECT order_id, total_price, currency, created_at, raw_json
           FROM orders_shopify
           WHERE shop = $1 AND created_at >= $2 AND created_at < $3
             AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
        : `SELECT order_id, total_price, currency, created_at, raw_json
           FROM orders_shopify
           WHERE shop = ? AND created_at >= ? AND created_at < ?
             AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`,
      [shop, overallStart, overallEnd]
    );
    for (const row of orderRows) {
      const createdAt = Number(row.created_at);
      let dayLabel = null;
      for (const db_day of dayBounds) {
        if (createdAt >= db_day.start && createdAt < db_day.end) {
          dayLabel = db_day.label;
          break;
        }
      }
      if (!dayLabel) continue;
      const price = parseFloat(row.total_price);
      const currency = (row.currency || 'GBP').toUpperCase();
      const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
      const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
      revenuePerDay[dayLabel] = (revenuePerDay[dayLabel] || 0) + gbp;
      ordersPerDay[dayLabel] = (ordersPerDay[dayLabel] || 0) + 1;
    }
  }

  // Fetch Shopify sessions per day (from shopify_sessions_snapshots)
  const shopifySessionsPerDay = {};
  if (shop) {
    try {
      const dayLabels = dayBounds.map(d => d.label);
      const shopifyRows = await db.all(
        config.dbUrl
          ? `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = $1 AND day_ymd >= $2 AND day_ymd <= $3
             GROUP BY day_ymd`
          : `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = ? AND day_ymd >= ? AND day_ymd <= ?`,
        [shop, dayLabels[0], dayLabels[dayLabels.length - 1]]
      );
      for (const r of shopifyRows) {
        shopifySessionsPerDay[r.day_ymd] = Number(r.sessions_count) || 0;
      }
    } catch (_) {}
  }

  const series = dayBounds.map(function(db_day) {
    const sessions = sessionsPerDay[db_day.label] || 0;
    const orders = ordersPerDay[db_day.label] || 0;
    const revenue = Math.round((revenuePerDay[db_day.label] || 0) * 100) / 100;
    const rawConv = sessions > 0 ? (orders / sessions) * 100 : 0;
    const convRate = Math.round(Math.min(rawConv, 100) * 10) / 10;
    const shopifySessions = shopifySessionsPerDay[db_day.label] || 0;
    const rawShopifyConv = shopifySessions > 0 ? (orders / shopifySessions) * 100 : null;
    const shopifyConvRate = rawShopifyConv != null ? Math.round(Math.min(rawShopifyConv, 100) * 10) / 10 : null;
    const aov = orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0;
    const bounced = bouncePerDay[db_day.label] || 0;
    const bounceRate = sessions > 0 ? Math.round((bounced / sessions) * 1000) / 10 : 0;
    return {
      date: db_day.label,
      revenue,
      orders,
      sessions,
      convRate,
      shopifyConvRate,
      aov,
      bounceRate,
    };
  });

  // Top products (range)
  let topProducts = [];
  if (shop) {
    try {
      const productRows = await db.all(
        config.dbUrl
          ? `SELECT TRIM(li.product_id) AS product_id, MAX(li.title) AS title, COALESCE(SUM(li.line_revenue), 0) AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = $1 AND li.order_created_at >= $2 AND li.order_created_at < $3
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status = 'paid'
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT 5`
          : `SELECT TRIM(li.product_id) AS product_id, MAX(li.title) AS title, COALESCE(SUM(li.line_revenue), 0) AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = ? AND li.order_created_at >= ? AND li.order_created_at < ?
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status = 'paid'
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT 5`,
        [shop, overallStart, overallEnd]
      );
      let token = null;
      try { token = await salesTruth.getAccessToken(shop); } catch (_) {}
      const productIds = token ? productRows.map(r => r.product_id).filter(Boolean) : [];
      const metaMap = new Map();
      for (const pid of productIds) {
        try {
          const meta = await productMetaCache.getProductMeta(shop, token, pid);
          if (meta && meta.ok) metaMap.set(String(pid), meta);
        } catch (_) {}
      }
      topProducts = productRows.map(function(r) {
        const pid = r.product_id ? String(r.product_id) : '';
        const meta = metaMap.get(pid);
        return {
          title: r.title || 'Unknown',
          revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
          orders: Number(r.orders) || 0,
          thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
        };
      });
    } catch (_) {}
  }

  // Top countries by revenue (range)
  let topCountries = [];
  if (shop) {
    try {
      const countryRows = await db.all(
        config.dbUrl
          ? `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = $1 AND created_at >= $2 AND created_at < $3
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
          : `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = ? AND created_at >= ? AND created_at < ?
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`,
        [shop, overallStart, overallEnd]
      );
      const countryMap = {};
      for (const r of countryRows) {
        let cc = 'XX';
        try {
          const json = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json;
          cc = (json && json.shipping_address && json.shipping_address.country_code) ||
               (json && json.billing_address && json.billing_address.country_code) || 'XX';
        } catch (_) {}
        cc = String(cc).toUpperCase().slice(0, 2) || 'XX';
        const price = parseFloat(r.total_price);
        const currency = (r.currency || 'GBP').toUpperCase();
        const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
        const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
        if (!countryMap[cc]) countryMap[cc] = { revenue: 0, orders: 0 };
        countryMap[cc].revenue += gbp;
        countryMap[cc].orders += 1;
      }
      topCountries = Object.entries(countryMap)
        .map(function(entry) {
          return { country: entry[0], revenue: Math.round(entry[1].revenue * 100) / 100, orders: entry[1].orders };
        })
        .sort(function(a, b) { return b.revenue - a.revenue; })
        .slice(0, 5);
    } catch (_) {}
  }

  // Ad spend per day (if ads DB available) — only on Postgres ads DB
  let adSpendPerDay = {};
  try {
    const adsDb = require('../ads/adsDb');
    if (adsDb && typeof adsDb.getAdsPool === 'function') {
      const pool = adsDb.getAdsPool();
      if (pool) {
        const spendRows = await pool.query(
          `SELECT (hour_ts AT TIME ZONE 'UTC')::date::text AS day, COALESCE(SUM(spend_gbp), 0) AS spend_gbp
           FROM google_ads_spend_hourly
           WHERE (hour_ts AT TIME ZONE 'UTC')::date >= $1::date AND (hour_ts AT TIME ZONE 'UTC')::date <= $2::date
           GROUP BY (hour_ts AT TIME ZONE 'UTC')::date
           ORDER BY day`,
          [dayBounds[0].label, dayBounds[dayBounds.length - 1].label]
        );
        if (spendRows && spendRows.rows) {
          for (const r of spendRows.rows) {
            adSpendPerDay[r.day] = Math.round((Number(r.spend_gbp) || 0) * 100) / 100;
          }
        }
      }
    }
  } catch (_) {}
  for (const s of series) {
    s.adSpend = adSpendPerDay[s.date] || 0;
  }

  // Device breakdown (desktop vs mobile vs tablet)
  let desktopSessions = 0, mobileSessions = 0;
  try {
    const ph = config.dbUrl ? ['$1', '$2'] : ['?', '?'];
    const deviceRows = await db.all(
      'SELECT LOWER(COALESCE(s.ua_device_type, \'unknown\')) AS device, COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filter.sql.replace(/sessions\./g, 's.') + ' GROUP BY LOWER(COALESCE(s.ua_device_type, \'unknown\'))',
      [overallStart, overallEnd, ...filter.params]
    );
    for (const r of deviceRows) {
      const d = (r.device || '').trim();
      if (d === 'desktop') desktopSessions += Number(r.n) || 0;
      else if (d === 'mobile' || d === 'tablet') mobileSessions += Number(r.n) || 0;
    }
  } catch (_) {}

  // Returning vs new customer orders
  let newCustomerOrders = 0, returningCustomerOrders = 0;
  if (shop) {
    try {
      const retRows = await db.all(
        config.dbUrl
          ? `SELECT CASE WHEN COALESCE(customer_orders_count, 1) > 1 THEN 'returning' ELSE 'new' END AS ctype, COUNT(*) AS n
             FROM orders_shopify
             WHERE shop = $1 AND created_at >= $2 AND created_at < $3
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'
             GROUP BY ctype`
          : `SELECT CASE WHEN COALESCE(customer_orders_count, 1) > 1 THEN 'returning' ELSE 'new' END AS ctype, COUNT(*) AS n
             FROM orders_shopify
             WHERE shop = ? AND created_at >= ? AND created_at < ?
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'
             GROUP BY ctype`,
        [shop, overallStart, overallEnd]
      );
      for (const r of retRows) {
        if (r.ctype === 'returning') returningCustomerOrders = Number(r.n) || 0;
        else newCustomerOrders = Number(r.n) || 0;
      }
    } catch (_) {}
  }

  // Summary totals
  let totalRevenue = 0, totalOrders = 0, totalSessions = 0, totalAdSpend = 0, totalBounced = 0;
  let aovHigh = 0, aovLow = Infinity;
  for (const s of series) {
    totalRevenue += s.revenue;
    totalOrders += s.orders;
    totalSessions += s.sessions;
    totalAdSpend += s.adSpend;
    totalBounced += (bouncePerDay[s.date] || 0);
    if (s.orders > 0) {
      if (s.aov > aovHigh) aovHigh = s.aov;
      if (s.aov < aovLow) aovLow = s.aov;
    }
  }
  if (!Number.isFinite(aovLow) || aovLow === Infinity) aovLow = 0;
  const avgConvRate = totalSessions > 0 ? Math.round(Math.min((totalOrders / totalSessions) * 100, 100) * 10) / 10 : 0;
  const avgAov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;
  const bounceRate = totalSessions > 0 ? Math.round((totalBounced / totalSessions) * 1000) / 10 : 0;
  const roas = totalAdSpend > 0 ? Math.round((totalRevenue / totalAdSpend) * 100) / 100 : null;

  return {
    days: dayBounds.length,
    series,
    topProducts,
    topCountries,
    summary: {
      revenue: Math.round(totalRevenue * 100) / 100,
      orders: totalOrders,
      sessions: totalSessions,
      convRate: avgConvRate,
      aov: avgAov,
      aovHigh: Math.round(aovHigh * 100) / 100,
      aovLow: Math.round(aovLow * 100) / 100,
      bounceRate,
      adSpend: Math.round(totalAdSpend * 100) / 100,
      roas,
      desktopSessions,
      mobileSessions,
      newCustomerOrders,
      returningCustomerOrders,
    },
  };
}

function parseDateParts(formatted) {
  // en-GB: DD/MM/YYYY
  const parts = formatted.split('/');
  return {
    day: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    year: parseInt(parts[2], 10),
  };
}

function getTimeZoneOffsetMs(timeZone, date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hourCycle: 'h23' });
  const tzStr = date.toLocaleString('en-US', { timeZone, hourCycle: 'h23' });
  const utc = new Date(utcStr);
  const tz = new Date(tzStr);
  return utc - tz;
}

function zonedTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  return utcGuess.getTime() - offset;
}

module.exports = { getDashboardSeries };
