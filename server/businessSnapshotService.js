const { getDb } = require('./db');
const store = require('./store');
const salesTruth = require('./salesTruth');
const fx = require('./fx');
const shopifyQl = require('./shopifyQl');
const {
  PROFIT_RULES_V1_KEY,
  PROFIT_RULE_TYPES,
  defaultProfitRulesConfigV1,
  normalizeCountryCode,
  normalizeProfitRulesConfigV1,
  hasEnabledProfitRules,
} = require('./profitRulesConfig');

const YEAR_SET = new Set(['2026', '2025', '2024', 'all']);
const ALL_TIME_START_YMD = '2025-02-01';

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = toNumber(value);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

function round1(value) {
  const n = toNumber(value);
  if (n == null) return null;
  return Math.round(n * 10) / 10;
}

function safePercent(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  if (n == null || d == null || d <= 0) return null;
  return round1((n / d) * 100);
}

function ymdInTimeZone(ms, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = fmt.formatToParts(new Date(ms));
    const map = {};
    for (const part of parts) map[part.type] = part.value;
    if (!map.year || !map.month || !map.day) return null;
    return `${map.year}-${map.month}-${map.day}`;
  } catch (_) {
    return null;
  }
}

function normalizeSnapshotYear(raw) {
  const year = raw == null ? '' : String(raw).trim().toLowerCase();
  if (YEAR_SET.has(year)) return year;
  return 'all';
}

function snapshotRangeKeyForYear(year, nowMs, timeZone) {
  if (year === 'all') {
    const todayYmd = ymdInTimeZone(nowMs, timeZone) || '2099-12-31';
    return `r:${ALL_TIME_START_YMD}:${todayYmd}`;
  }
  return `r:${year}-01-01:${year}-12-31`;
}

function normalizeCountryOrUnknown(value) {
  const code = normalizeCountryCode(value);
  return code || 'XX';
}

function orderCountryFromRawJson(rawJson) {
  const raw = safeJsonParse(rawJson);
  if (!raw || typeof raw !== 'object') return 'XX';
  const shipping =
    raw?.shipping_address?.country_code ??
    raw?.shipping_address?.countryCode ??
    raw?.shippingAddress?.countryCode ??
    raw?.shippingAddress?.country_code ??
    null;
  const billing =
    raw?.billing_address?.country_code ??
    raw?.billing_address?.countryCode ??
    raw?.billingAddress?.countryCode ??
    raw?.billingAddress?.country_code ??
    null;
  return normalizeCountryOrUnknown(shipping || billing);
}

function isPaidOrderWhereClause(alias) {
  const p = alias ? String(alias).trim() + '.' : '';
  return `(${p}test IS NULL OR ${p}test = 0)
    AND ${p}cancelled_at IS NULL
    AND ${p}financial_status = 'paid'`;
}

async function readProfitRulesConfig() {
  try {
    const raw = await store.getSetting(PROFIT_RULES_V1_KEY);
    return normalizeProfitRulesConfigV1(raw);
  } catch (_) {
    return defaultProfitRulesConfigV1();
  }
}

async function readDistinctCustomerCount(shop, startMs, endMs) {
  if (!shop) return 0;
  const db = getDb();
  const row = await db.get(
    `
      SELECT COUNT(DISTINCT customer_id) AS n
      FROM orders_shopify
      WHERE shop = ?
        AND created_at >= ? AND created_at < ?
        AND ${isPaidOrderWhereClause('')}
        AND checkout_token IS NOT NULL
        AND TRIM(checkout_token) != ''
        AND customer_id IS NOT NULL
        AND TRIM(customer_id) != ''
    `,
    [shop, startMs, endMs]
  );
  return row && row.n != null ? Number(row.n) || 0 : 0;
}

async function readReturningCustomerCountBeforeStart(shop, startMs, endMs) {
  if (!shop) return 0;
  const db = getDb();
  const row = await db.get(
    `
      SELECT COUNT(DISTINCT o.customer_id) AS n
      FROM orders_shopify o
      WHERE o.shop = ?
        AND o.created_at >= ? AND o.created_at < ?
        AND ${isPaidOrderWhereClause('o')}
        AND o.checkout_token IS NOT NULL
        AND TRIM(o.checkout_token) != ''
        AND o.customer_id IS NOT NULL
        AND TRIM(o.customer_id) != ''
        AND EXISTS (
          SELECT 1
          FROM orders_shopify p
          WHERE p.shop = o.shop
            AND p.customer_id = o.customer_id
            AND ${isPaidOrderWhereClause('p')}
            AND p.checkout_token IS NOT NULL
            AND TRIM(p.checkout_token) != ''
            AND p.created_at < ?
        )
    `,
    [shop, startMs, endMs, startMs]
  );
  return row && row.n != null ? Number(row.n) || 0 : 0;
}

async function readRepeatCustomerCountInRange(shop, startMs, endMs) {
  if (!shop) return 0;
  const db = getDb();
  const row = await db.get(
    `
      SELECT COUNT(*) AS n
      FROM (
        SELECT o.customer_id
        FROM orders_shopify o
        WHERE o.shop = ?
          AND o.created_at >= ? AND o.created_at < ?
          AND ${isPaidOrderWhereClause('o')}
          AND o.checkout_token IS NOT NULL
          AND TRIM(o.checkout_token) != ''
          AND o.customer_id IS NOT NULL
          AND TRIM(o.customer_id) != ''
        GROUP BY o.customer_id
        HAVING COUNT(*) >= 2
      ) t
    `,
    [shop, startMs, endMs]
  );
  return row && row.n != null ? Number(row.n) || 0 : 0;
}

async function readConvertedSessionCount(shop, startMs, endMs, { trafficMode = 'human_only' } = {}) {
  if (!shop) return 0;
  const db = getDb();
  const trafficSql = trafficMode === 'human_only' ? ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)' : '';
  const row = await db.get(
    `
      SELECT COUNT(*) AS n FROM (
        SELECT DISTINCT s.session_id AS session_id
        FROM sessions s
        INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = ?
        INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
        WHERE s.started_at >= ? AND s.started_at < ?
          ${trafficSql}
          AND pe.event_type IN ('checkout_completed', 'checkout_started')
          AND pe.occurred_at >= ? AND pe.occurred_at < ?
          AND o.created_at >= ? AND o.created_at < ?
          AND ${isPaidOrderWhereClause('o')}
      ) t
    `,
    [shop, startMs, endMs, startMs, endMs, startMs, endMs]
  );
  return row && row.n != null ? Number(row.n) || 0 : 0;
}

async function readRevenueRowsByCurrency(shop, startMs, endMs) {
  if (!shop) return [];
  const db = getDb();
  return db.all(
    `
      SELECT COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, COALESCE(SUM(total_price), 0) AS total
      FROM orders_shopify
      WHERE shop = ?
        AND created_at >= ? AND created_at < ?
        AND ${isPaidOrderWhereClause('')}
        AND checkout_token IS NOT NULL
        AND TRIM(checkout_token) != ''
      GROUP BY COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
    `,
    [shop, startMs, endMs]
  );
}

async function convertRevenueRowsToGbp(rows) {
  const ratesToGbp = await fx.getRatesToGbp();
  let total = 0;
  for (const row of rows || []) {
    const currency = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const amount = row && row.total != null ? Number(row.total) : 0;
    if (!Number.isFinite(amount) || amount === 0) continue;
    const gbp = fx.convertToGbp(amount, currency, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) total += gbp;
  }
  return round2(total) || 0;
}

async function readLtvAllTime(shop) {
  if (!shop) return null;
  const db = getDb();
  const [revenueRows, customerRow] = await Promise.all([
    db.all(
      `
        SELECT COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, COALESCE(SUM(total_price), 0) AS total
        FROM orders_shopify
        WHERE shop = ?
          AND ${isPaidOrderWhereClause('')}
          AND checkout_token IS NOT NULL
          AND TRIM(checkout_token) != ''
          AND customer_id IS NOT NULL
          AND TRIM(customer_id) != ''
        GROUP BY COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
      `,
      [shop]
    ),
    db.get(
      `
        SELECT COUNT(DISTINCT customer_id) AS n
        FROM orders_shopify
        WHERE shop = ?
          AND ${isPaidOrderWhereClause('')}
          AND checkout_token IS NOT NULL
          AND TRIM(checkout_token) != ''
          AND customer_id IS NOT NULL
          AND TRIM(customer_id) != ''
      `,
      [shop]
    ),
  ]);
  const customerCount = customerRow && customerRow.n != null ? Number(customerRow.n) || 0 : 0;
  if (customerCount <= 0) return null;
  const revenue = await convertRevenueRowsToGbp(revenueRows);
  if (!Number.isFinite(revenue)) return null;
  return round2(revenue / customerCount);
}

async function readLtvForYearCohort(shop, year) {
  if (!shop) return null;
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 3000) return null;
  const startUtc = Date.UTC(y, 0, 1, 0, 0, 0);
  const endUtc = Date.UTC(y + 1, 0, 1, 0, 0, 0);
  const db = getDb();
  const [cohortCountRow, cohortRevenueRows] = await Promise.all([
    db.get(
      `
        SELECT COUNT(*) AS n
        FROM (
          SELECT customer_id, MIN(created_at) AS first_paid_at
          FROM orders_shopify
          WHERE shop = ?
            AND ${isPaidOrderWhereClause('')}
            AND checkout_token IS NOT NULL
            AND TRIM(checkout_token) != ''
            AND customer_id IS NOT NULL
            AND TRIM(customer_id) != ''
          GROUP BY customer_id
        ) c
        WHERE c.first_paid_at >= ? AND c.first_paid_at < ?
      `,
      [shop, startUtc, endUtc]
    ),
    db.all(
      `
        SELECT COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency, COALESCE(SUM(o.total_price), 0) AS total
        FROM orders_shopify o
        JOIN (
          SELECT customer_id, MIN(created_at) AS first_paid_at
          FROM orders_shopify
          WHERE shop = ?
            AND ${isPaidOrderWhereClause('')}
            AND checkout_token IS NOT NULL
            AND TRIM(checkout_token) != ''
            AND customer_id IS NOT NULL
            AND TRIM(customer_id) != ''
          GROUP BY customer_id
        ) c ON c.customer_id = o.customer_id
        WHERE o.shop = ?
          AND ${isPaidOrderWhereClause('o')}
          AND o.checkout_token IS NOT NULL
          AND TRIM(o.checkout_token) != ''
          AND c.first_paid_at >= ?
          AND c.first_paid_at < ?
        GROUP BY COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP')
      `,
      [shop, shop, startUtc, endUtc]
    ),
  ]);
  const cohortCount = cohortCountRow && cohortCountRow.n != null ? Number(cohortCountRow.n) || 0 : 0;
  if (cohortCount <= 0) return null;
  const revenue = await convertRevenueRowsToGbp(cohortRevenueRows);
  if (!Number.isFinite(revenue)) return null;
  return round2(revenue / cohortCount);
}

async function readOrderCountrySummary(shop, startMs, endMs) {
  const out = {
    revenueGbp: 0,
    orders: 0,
    byCountry: new Map(), // CC -> { revenueGbp, orders }
  };
  if (!shop) return out;
  const db = getDb();
  const rows = await db.all(
    `
      SELECT COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json
      FROM orders_shopify
      WHERE shop = ?
        AND created_at >= ? AND created_at < ?
        AND ${isPaidOrderWhereClause('')}
        AND checkout_token IS NOT NULL
        AND TRIM(checkout_token) != ''
        AND total_price IS NOT NULL
    `,
    [shop, startMs, endMs]
  );
  if (!rows || !rows.length) return out;

  const ratesToGbp = await fx.getRatesToGbp();
  for (const row of rows) {
    const amount = row && row.total_price != null ? Number(row.total_price) : 0;
    if (!Number.isFinite(amount)) continue;
    const currency = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const revenueGbp = fx.convertToGbp(amount, currency, ratesToGbp);
    if (typeof revenueGbp !== 'number' || !Number.isFinite(revenueGbp)) continue;
    const country = orderCountryFromRawJson(row && row.raw_json != null ? String(row.raw_json) : '');
    out.revenueGbp += revenueGbp;
    out.orders += 1;
    const current = out.byCountry.get(country) || { revenueGbp: 0, orders: 0 };
    current.revenueGbp += revenueGbp;
    current.orders += 1;
    out.byCountry.set(country, current);
  }
  out.revenueGbp = round2(out.revenueGbp) || 0;
  return out;
}

function selectedScopeTotals(summary, appliesTo) {
  const fallback = { revenueGbp: 0, orders: 0 };
  if (!summary || typeof summary !== 'object') return fallback;
  if (!appliesTo || appliesTo.mode === 'all') {
    return {
      revenueGbp: Number(summary.revenueGbp) || 0,
      orders: Number(summary.orders) || 0,
    };
  }
  const countries = Array.isArray(appliesTo.countries) ? appliesTo.countries : [];
  if (!countries.length) return fallback;
  let revenueGbp = 0;
  let orders = 0;
  for (const raw of countries) {
    const code = normalizeCountryCode(raw);
    if (!code || code === 'XX') continue;
    const found = summary.byCountry && summary.byCountry.get(code);
    if (!found) continue;
    revenueGbp += Number(found.revenueGbp) || 0;
    orders += Number(found.orders) || 0;
  }
  return { revenueGbp, orders };
}

function computeProfitDeductions(summary, config) {
  const normalized = normalizeProfitRulesConfigV1(config);
  const allRules = Array.isArray(normalized.rules) ? normalized.rules : [];
  const rules = allRules.filter((rule) => rule && rule.enabled === true);
  let totalDeductions = 0;

  // Estimated profit model:
  // - Percent rules subtract a % of selected revenue scope.
  // - Fixed per order rules subtract fixed cost * selected order count scope.
  // - Fixed per period rules subtract once per selected period.
  // Rules are applied in deterministic sort order (already normalized).
  for (const rule of rules) {
    const scoped = selectedScopeTotals(summary, rule.appliesTo);
    const value = Number(rule.value) || 0;
    let deduction = 0;
    if (rule.type === PROFIT_RULE_TYPES.percentRevenue) {
      deduction = scoped.revenueGbp * (value / 100);
    } else if (rule.type === PROFIT_RULE_TYPES.fixedPerOrder) {
      deduction = scoped.orders * value;
    } else if (rule.type === PROFIT_RULE_TYPES.fixedPerPeriod) {
      deduction = value;
    }
    if (!Number.isFinite(deduction) || deduction <= 0) continue;
    totalDeductions += deduction;
  }
  return round2(totalDeductions) || 0;
}

function metric(value, previous) {
  return {
    value: toNumber(value),
    previous: toNumber(previous),
  };
}

function fromMap(container, key) {
  if (!container || typeof container !== 'object') return null;
  return toNumber(container[key]);
}

async function getBusinessSnapshot(options = {}) {
  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const year = normalizeSnapshotYear(options.year);
  const rangeKey = snapshotRangeKeyForYear(year, nowMs, timeZone);
  const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
  const shop = salesTruth.resolveShopForSales('');

  const token = shop ? await salesTruth.getAccessToken(shop) : '';
  const startYmd = ymdInTimeZone(bounds.start, timeZone);
  const endYmd = ymdInTimeZone(Math.max(bounds.start, bounds.end - 1), timeZone);

  async function shopifySessionsForBounds(b) {
    if (!shop || !token) return { sessions: null, conversionRate: null };
    const sYmd = ymdInTimeZone(b.start, timeZone);
    const eYmd = ymdInTimeZone(Math.max(b.start, b.end - 1), timeZone);
    if (!sYmd || !eYmd) return { sessions: null, conversionRate: null };
    const metrics = await shopifyQl.fetchShopifySessionsMetricsRange(shop, token, { sinceYmd: sYmd, untilYmd: eYmd, timeZone });
    return {
      sessions: toNumber(metrics && metrics.sessions),
      conversionRate: toNumber(metrics && metrics.conversionRate),
    };
  }

  let compareBounds = null;
  if (year !== 'all') {
    const y = Number(year);
    if (Number.isFinite(y) && y > 2000) {
      const prevYear = String(y - 1);
      const prevRangeKey = `r:${prevYear}-01-01:${prevYear}-12-31`;
      compareBounds = store.getRangeBounds(prevRangeKey, nowMs, timeZone);
    }
  }

  const [sessionsNowMetrics, sessionsPrevMetrics, revenue, orders, revenuePrev, ordersPrev] = await Promise.all([
    shopifySessionsForBounds(bounds),
    compareBounds ? shopifySessionsForBounds(compareBounds) : Promise.resolve({ sessions: null, conversionRate: null }),
    shop ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, bounds.start, bounds.end) : Promise.resolve(0),
    shop ? salesTruth.getTruthCheckoutOrderCount(shop, bounds.start, bounds.end) : Promise.resolve(0),
    (shop && compareBounds) ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    (shop && compareBounds) ? salesTruth.getTruthCheckoutOrderCount(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
  ]);

  const sessions = toNumber(sessionsNowMetrics && sessionsNowMetrics.sessions);
  const sessionsPrev = toNumber(sessionsPrevMetrics && sessionsPrevMetrics.sessions);
  let conversionRate = toNumber(sessionsNowMetrics && sessionsNowMetrics.conversionRate);
  let conversionRatePrev = toNumber(sessionsPrevMetrics && sessionsPrevMetrics.conversionRate);

  // Data integrity guardrails:
  // - If Shopify sessions are unavailable/zero but we have checkout orders, do not show misleading 0% values.
  // - If conversion_rate is missing but sessions exist, compute a best-effort proxy from checkout orders.
  let sessionsSafe = sessions;
  let sessionsPrevSafe = sessionsPrev;
  const ordersNowN = toNumber(orders);
  const ordersPrevN = toNumber(ordersPrev);
  if (sessionsSafe != null && sessionsSafe <= 0 && ordersNowN != null && ordersNowN > 0) sessionsSafe = null;
  if (sessionsPrevSafe != null && sessionsPrevSafe <= 0 && ordersPrevN != null && ordersPrevN > 0) sessionsPrevSafe = null;
  if (conversionRate == null && sessionsSafe != null && ordersNowN != null) {
    conversionRate = safePercent(ordersNowN, sessionsSafe);
  }
  if (conversionRatePrev == null && sessionsPrevSafe != null && ordersPrevN != null) {
    conversionRatePrev = safePercent(ordersPrevN, sessionsPrevSafe);
  }

  const aov = (toNumber(revenue) != null && toNumber(orders) != null && Number(orders) > 0) ? round2(Number(revenue) / Number(orders)) : null;
  const aovPrev = (toNumber(revenuePrev) != null && toNumber(ordersPrev) != null && Number(ordersPrev) > 0) ? round2(Number(revenuePrev) / Number(ordersPrev)) : null;

  const [distinctCustomers, ltvValue, customerRepeatOrReturning] = await Promise.all([
    readDistinctCustomerCount(shop, bounds.start, bounds.end),
    year === 'all' ? readLtvAllTime(shop) : readLtvForYearCohort(shop, year),
    year === 'all'
      ? readRepeatCustomerCountInRange(shop, bounds.start, bounds.end)
      : readReturningCustomerCountBeforeStart(shop, bounds.start, bounds.end),
  ]);

  const returningCustomers = toNumber(customerRepeatOrReturning);
  const newCustomers = (toNumber(distinctCustomers) != null && returningCustomers != null)
    ? Math.max(0, (Number(distinctCustomers) || 0) - (Number(returningCustomers) || 0))
    : null;
  const repeatPurchaseRate = safePercent(returningCustomers, distinctCustomers);

  let profitSection = {
    enabled: false,
    hasEnabledRules: false,
    visible: false,
    unavailable: false,
    estimatedProfit: metric(null, null),
    netProfit: metric(null, null),
    marginPct: metric(null, null),
    deductions: metric(null, null),
  };
  try {
    const profitRules = await readProfitRulesConfig();
    const rulesEnabled = hasEnabledProfitRules(profitRules);
    profitSection.enabled = !!profitRules.enabled;
    profitSection.hasEnabledRules = rulesEnabled;
    if (rulesEnabled) {
      const summaryNow = await readOrderCountrySummary(shop, bounds.start, bounds.end);
      const deductionsNow = computeProfitDeductions(summaryNow, profitRules);
      const estNow = round2((summaryNow.revenueGbp || 0) - deductionsNow);
      const marginNow = summaryNow.revenueGbp > 0 ? round1((estNow / summaryNow.revenueGbp) * 100) : null;

      let deductionsPrev = null;
      let estPrev = null;
      let marginPrev = null;
      if (compare && compare.range && Number.isFinite(compare.range.start) && Number.isFinite(compare.range.end)) {
        const summaryPrev = await readOrderCountrySummary(shop, compare.range.start, compare.range.end);
        deductionsPrev = computeProfitDeductions(summaryPrev, profitRules);
        estPrev = round2((summaryPrev.revenueGbp || 0) - deductionsPrev);
        marginPrev = summaryPrev.revenueGbp > 0 ? round1((estPrev / summaryPrev.revenueGbp) * 100) : null;
      }

      profitSection.visible = true;
      profitSection.unavailable = false;
      profitSection.estimatedProfit = metric(estNow, estPrev);
      // Net rules are not separate yet, so net mirrors estimated gross for now.
      profitSection.netProfit = metric(estNow, estPrev);
      profitSection.marginPct = metric(marginNow, marginPrev);
      profitSection.deductions = metric(deductionsNow, deductionsPrev);
    }
  } catch (_) {
    // Fail-open: if rules fail, keep non-profit KPIs available.
    profitSection.unavailable = true;
  }

  return {
    ok: true,
    year,
    rangeKey,
    availableYears: await (async function() {
      if (!shop) return [];
      try {
        const db = getDb();
        const row = await db.get(
          `
            SELECT MIN(created_at) AS min_ts, MAX(created_at) AS max_ts
            FROM orders_shopify
            WHERE shop = ?
              AND created_at IS NOT NULL
              AND ${isPaidOrderWhereClause('')}
              AND checkout_token IS NOT NULL
              AND TRIM(checkout_token) != ''
          `,
          [shop]
        );
        const minTs = row && row.min_ts != null ? Number(row.min_ts) : null;
        const maxTs = row && row.max_ts != null ? Number(row.max_ts) : null;
        if (minTs == null || maxTs == null || !Number.isFinite(minTs) || !Number.isFinite(maxTs)) return [];
        const minYmd = ymdInTimeZone(minTs, timeZone);
        const maxYmd = ymdInTimeZone(maxTs, timeZone);
        const minYear = minYmd ? parseInt(minYmd.slice(0, 4), 10) : null;
        const maxYear = maxYmd ? parseInt(maxYmd.slice(0, 4), 10) : null;
        if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) return [];
        const years = [];
        for (let y = maxYear; y >= minYear; y--) {
          years.push(String(y));
        }
        return years;
      } catch (_) {
        return [];
      }
    })(),
    range: {
      start: bounds.start,
      end: bounds.end,
    },
    financial: {
      revenue: metric(revenue, revenuePrev),
      orders: metric(orders, ordersPrev),
      aov: metric(aov, aovPrev),
      conversionRate: metric(conversionRate, conversionRatePrev),
      profit: profitSection,
    },
    performance: {
      sessions: metric(sessionsSafe, sessionsPrevSafe),
      orders: metric(orders, ordersPrev),
      conversionRate: metric(conversionRate, conversionRatePrev),
      aov: metric(aov, aovPrev),
    },
    customers: {
      newCustomers: metric(newCustomers, null),
      returningCustomers: metric(returningCustomers, null),
      repeatPurchaseRate: metric(repeatPurchaseRate, null),
      ltv: metric(ltvValue, null),
    },
    sources: {
      sales: 'shopify_orders_api (orders_shopify, checkout_token only)',
      sessions: 'shopifyql (sessions)',
      timeZone,
      rangeYmd: { since: startYmd || null, until: endYmd || null },
    },
  };
}

module.exports = {
  getBusinessSnapshot,
};
