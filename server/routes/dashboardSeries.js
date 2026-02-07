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

function sessionFilterForTraffic(trafficMode) {
  if (trafficMode === 'human_only') {
    return config.dbUrl
      ? { sql: ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)', params: [] }
      : { sql: ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)', params: [] };
  }
  return { sql: '', params: [] };
}

async function getDashboardSeries(req, res) {
  const daysRaw = parseInt(req.query.days, 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90 ? daysRaw : 7;
  const force = !!(req.query.force === '1' || req.query.force === 'true' || req.query._);
  const trafficMode = 'human_only';

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Vary', 'Cookie');

  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const todayBounds = store.getRangeBounds('today', now, timeZone);

  try {
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'dashboard-series',
        rangeKey: 'days_' + days,
        rangeStartTs: todayBounds.start,
        rangeEndTs: now,
        params: { trafficMode, days },
        ttlMs: 5 * 60 * 1000,
        force,
      },
      () => computeDashboardSeries(days, now, timeZone, trafficMode)
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
    const startMs = zonedTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
    let endMs;
    if (i === 0) {
      endMs = nowMs; // today: up to now
    } else {
      const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      next.setUTCDate(next.getUTCDate() + 1);
      endMs = zonedTimeToUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, timeZone);
    }
    const label = String(parts.year).padStart(4, '0') + '-' +
      String(parts.month).padStart(2, '0') + '-' +
      String(parts.day).padStart(2, '0');
    dayBounds.push({ label, start: startMs, end: endMs });
  }

  const overallStart = dayBounds[0].start;
  const overallEnd = dayBounds[dayBounds.length - 1].end;

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

  // Build series
  const series = dayBounds.map(function(db_day) {
    const sessions = sessionsPerDay[db_day.label] || 0;
    const orders = ordersPerDay[db_day.label] || 0;
    const revenue = Math.round((revenuePerDay[db_day.label] || 0) * 100) / 100;
    const convRate = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : 0;
    const aov = orders > 0 ? Math.round((revenue / orders) * 100) / 100 : 0;
    const bounced = bouncePerDay[db_day.label] || 0;
    const bounceRate = sessions > 0 ? Math.round((bounced / sessions) * 1000) / 10 : 0;
    return {
      date: db_day.label,
      revenue,
      orders,
      sessions,
      convRate,
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
          ? `SELECT li.product_title, SUM(li.price_gbp * li.quantity) AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             JOIN orders_shopify o ON o.order_id = li.order_id AND o.shop = li.shop
             WHERE li.shop = $1 AND o.created_at >= $2 AND o.created_at < $3
               AND (o.test IS NULL OR o.test = 0) AND o.cancelled_at IS NULL AND o.financial_status = 'paid'
             GROUP BY li.product_title
             ORDER BY revenue DESC
             LIMIT 5`
          : `SELECT li.product_title, SUM(li.price_gbp * li.quantity) AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             JOIN orders_shopify o ON o.order_id = li.order_id AND o.shop = li.shop
             WHERE li.shop = ? AND o.created_at >= ? AND o.created_at < ?
               AND (o.test IS NULL OR o.test = 0) AND o.cancelled_at IS NULL AND o.financial_status = 'paid'
             GROUP BY li.product_title
             ORDER BY revenue DESC
             LIMIT 5`,
        [shop, overallStart, overallEnd]
      );
      topProducts = productRows.map(function(r) {
        return {
          title: r.product_title || 'Unknown',
          revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
          orders: Number(r.orders) || 0,
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
    if (adsDb && typeof adsDb.getPool === 'function') {
      const pool = adsDb.getPool();
      if (pool) {
        const spendRows = await pool.query(
          `SELECT date, SUM(cost_micros) AS cost_micros
           FROM google_ads_spend
           WHERE date >= $1 AND date <= $2
           GROUP BY date
           ORDER BY date`,
          [dayBounds[0].label, dayBounds[dayBounds.length - 1].label]
        );
        if (spendRows && spendRows.rows) {
          for (const r of spendRows.rows) {
            const micros = Number(r.cost_micros) || 0;
            adSpendPerDay[r.date] = Math.round((micros / 1000000) * 100) / 100;
          }
        }
      }
    }
  } catch (_) {}

  // Merge ad spend into series
  for (const s of series) {
    s.adSpend = adSpendPerDay[s.date] || 0;
  }

  // Summary totals
  let totalRevenue = 0, totalOrders = 0, totalSessions = 0, totalAdSpend = 0;
  for (const s of series) {
    totalRevenue += s.revenue;
    totalOrders += s.orders;
    totalSessions += s.sessions;
    totalAdSpend += s.adSpend;
  }
  const avgConvRate = totalSessions > 0 ? Math.round((totalOrders / totalSessions) * 1000) / 10 : 0;
  const avgAov = totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0;
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
      adSpend: Math.round(totalAdSpend * 100) / 100,
      roas,
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
