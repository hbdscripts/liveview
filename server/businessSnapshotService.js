const { getDb } = require('./db');
const store = require('./store');
const salesTruth = require('./salesTruth');
const fx = require('./fx');
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
        AND customer_id IS NOT NULL
        AND TRIM(customer_id) != ''
    `,
    [shop, startMs, endMs]
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
            AND customer_id IS NOT NULL
            AND TRIM(customer_id) != ''
          GROUP BY customer_id
        ) c ON c.customer_id = o.customer_id
        WHERE o.shop = ?
          AND ${isPaidOrderWhereClause('o')}
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

  const kpis = await store.getKpis({
    trafficMode: 'human_only',
    rangeKey,
  });
  const compare = kpis && kpis.compare && typeof kpis.compare === 'object' ? kpis.compare : null;

  const revenue = fromMap(kpis && kpis.sales, rangeKey);
  const orders = fromMap(kpis && kpis.convertedCount, rangeKey);
  const aov = fromMap(kpis && kpis.aov, rangeKey);
  const conversionRate = fromMap(kpis && kpis.conversion, rangeKey);
  const trafficMain = kpis && kpis.trafficBreakdown && kpis.trafficBreakdown[rangeKey];
  const sessions = trafficMain && trafficMain.human_sessions != null ? toNumber(trafficMain.human_sessions) : null;

  const revenuePrev = compare ? toNumber(compare.sales) : null;
  const ordersPrev = compare ? toNumber(compare.convertedCount) : null;
  const aovPrev = compare ? toNumber(compare.aov) : null;
  const conversionRatePrev = compare ? toNumber(compare.conversion) : null;
  const sessionsPrev = compare && compare.trafficBreakdown ? toNumber(compare.trafficBreakdown.human_sessions) : null;

  const [distinctCustomers, ltvValue] = await Promise.all([
    readDistinctCustomerCount(shop, bounds.start, bounds.end),
    year === 'all' ? readLtvAllTime(shop) : readLtvForYearCohort(shop, year),
  ]);

  const returningCustomers = fromMap(kpis && kpis.returningCustomerCount, rangeKey);
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
      sessions: metric(sessions, sessionsPrev),
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
  };
}

module.exports = {
  getBusinessSnapshot,
};
