const { getDb } = require('./db');
const store = require('./store');
const salesTruth = require('./salesTruth');
const fx = require('./fx');
const shopifyQl = require('./shopifyQl');
const { getAdsDb } = require('./ads/adsDb');
const {
  PROFIT_RULES_V1_KEY,
  PROFIT_RULE_TYPES,
  defaultProfitRulesConfigV1,
  normalizeCountryCode,
  normalizeProfitRulesConfigV1,
  hasEnabledProfitRules,
} = require('./profitRulesConfig');

const SNAPSHOT_MODE_SET = new Set(['yearly', 'monthly']);
const SNAPSHOT_MIN_YEAR = 2025;
const SNAPSHOT_MIN_MONTH = '2025-01';
const SNAPSHOT_MIN_START_YMD = '2025-01-01';

const SHOPIFY_ADMIN_API_VERSION = '2024-01';
const VARIANT_COST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SHOP_NAME_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const COGS_RANGE_CACHE_TTL_MS = 10 * 60 * 1000;
const ADS_SPEND_CACHE_TTL_MS = 5 * 60 * 1000;

const variantCostCache = new Map(); // key -> { amount, currency, expiresAt }
const shopNameCache = new Map(); // shop -> { name, expiresAt }
const cogsRangeCache = new Map(); // key -> { value, expiresAt }
const adsSpendCache = new Map(); // key -> { totalGbp, byYmdObj, expiresAt }

function sleep(ms) {
  const n = Number(ms) || 0;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, n)));
}

function chunkArray(arr, size) {
  const out = [];
  const src = Array.isArray(arr) ? arr : [];
  const n = Math.max(1, Number(size) || 1);
  for (let i = 0; i < src.length; i += n) out.push(src.slice(i, i + n));
  return out;
}

function parseLegacyVariantId(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(\d+)(?:\D.*)?$/);
  return m && m[1] ? m[1] : '';
}

async function shopifyFetchWithRetry(url, accessToken, { maxRetries = 6 } = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': accessToken } });
    if (res.status !== 429) return res;
    if (attempt >= maxRetries) return res;
    const retryAfter = res.headers.get('retry-after');
    const waitSeconds = retryAfter ? parseInt(String(retryAfter), 10) : NaN;
    const waitMs = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : 1000;
    await sleep(Math.min(waitMs, 10000));
  }
}

async function shopifyGraphqlWithRetry(shop, accessToken, query, variables, { maxRetries = 6 } = {}) {
  const url = `https://${shop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status !== 429) return res;
    if (attempt >= maxRetries) return res;
    const retryAfter = res.headers.get('retry-after');
    const waitSeconds = retryAfter ? parseInt(String(retryAfter), 10) : NaN;
    const waitMs = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : 1000;
    await sleep(Math.min(waitMs, 10000));
  }
}

function cleanupCache(map, maxSize) {
  const m = map instanceof Map ? map : null;
  const limit = Number(maxSize) || 0;
  if (!m || limit <= 0) return;
  if (m.size <= limit) return;
  const entries = Array.from(m.entries());
  entries.sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0));
  const toDrop = Math.max(1, m.size - limit);
  for (let i = 0; i < toDrop; i += 1) m.delete(entries[i][0]);
}

async function fetchVariantUnitCosts(shop, accessToken, variantIds) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop || !accessToken || !Array.isArray(variantIds) || !variantIds.length) return new Map();
  const normalizedIds = Array.from(new Set(variantIds.map(parseLegacyVariantId).filter(Boolean)));
  const result = new Map();
  const missing = [];
  const now = Date.now();
  for (const vid of normalizedIds) {
    const key = `${safeShop}:${vid}`;
    const cached = variantCostCache.get(key);
    if (cached && cached.expiresAt > now && Number.isFinite(Number(cached.amount))) {
      result.set(vid, { amount: Number(cached.amount), currency: cached.currency || 'GBP' });
    } else {
      missing.push(vid);
    }
  }
  if (!missing.length) return result;

  const chunks = chunkArray(missing, 75);
  const query = `
    query VariantUnitCosts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          legacyResourceId
          inventoryItem {
            unitCost {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;
  for (const part of chunks) {
    const gqlIds = part.map((id) => `gid://shopify/ProductVariant/${id}`);
    try {
      const res = await shopifyGraphqlWithRetry(safeShop, accessToken, query, { ids: gqlIds }, { maxRetries: 6 });
      const text = await res.text();
      if (!res.ok) continue;
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      const nodes = json && json.data && Array.isArray(json.data.nodes) ? json.data.nodes : [];
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        const vid = parseLegacyVariantId(n.legacyResourceId || n.id);
        if (!vid) continue;
        const unitCost = n.inventoryItem && n.inventoryItem.unitCost ? n.inventoryItem.unitCost : null;
        const amount = unitCost && unitCost.amount != null ? Number(unitCost.amount) : NaN;
        const currency = unitCost && unitCost.currencyCode ? String(unitCost.currencyCode).toUpperCase() : 'GBP';
        if (!Number.isFinite(amount)) continue;
        result.set(vid, { amount, currency });
        variantCostCache.set(`${safeShop}:${vid}`, {
          amount,
          currency,
          expiresAt: Date.now() + VARIANT_COST_CACHE_TTL_MS,
        });
      }
      cleanupCache(variantCostCache, 5000);
    } catch (_) {}
  }
  return result;
}

async function readCogsTotalGbpFromLineItems(shop, accessToken, startMs, endMs) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const start = Number(startMs);
  const end = Number(endMs);
  if (!safeShop || !accessToken || !Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;

  const cacheKey = `${safeShop}:${start}:${end}`;
  const cached = cogsRangeCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  let rows = [];
  try {
    rows = await getDb().all(
      `
        SELECT TRIM(COALESCE(variant_id, '')) AS variant_id,
               UPPER(COALESCE(currency, 'GBP')) AS currency,
               COALESCE(SUM(quantity), 0) AS qty
        FROM orders_shopify_line_items
        WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
        GROUP BY TRIM(COALESCE(variant_id, '')), UPPER(COALESCE(currency, 'GBP'))
      `,
      [safeShop, start, end]
    );
  } catch (_) {
    return null;
  }

  const variantIds = Array.from(new Set((rows || []).map((r) => parseLegacyVariantId(r && r.variant_id)).filter(Boolean)));
  if (!variantIds.length) {
    cogsRangeCache.set(cacheKey, { value: 0, expiresAt: now + COGS_RANGE_CACHE_TTL_MS });
    cleanupCache(cogsRangeCache, 400);
    return 0;
  }

  const ratesToGbp = await fx.getRatesToGbp();
  const costMap = await fetchVariantUnitCosts(safeShop, accessToken, variantIds);
  let total = 0;
  let matchedQty = 0;
  for (const row of (rows || [])) {
    const vid = parseLegacyVariantId(row && row.variant_id);
    const qty = row && row.qty != null ? Number(row.qty) : NaN;
    if (!vid || !Number.isFinite(qty) || qty <= 0) continue;
    const cost = costMap.get(vid);
    if (!cost || !Number.isFinite(Number(cost.amount))) continue;
    const raw = Number(cost.amount) * qty;
    const currency = fx.normalizeCurrency(cost.currency) || fx.normalizeCurrency(row && row.currency) || 'GBP';
    const gbp = fx.convertToGbp(raw, currency, ratesToGbp);
    if (!Number.isFinite(gbp)) continue;
    total += gbp;
    matchedQty += qty;
  }
  if (matchedQty <= 0) return null;
  const rounded = round2(total);
  cogsRangeCache.set(cacheKey, { value: rounded, expiresAt: now + COGS_RANGE_CACHE_TTL_MS });
  cleanupCache(cogsRangeCache, 400);
  return rounded;
}

async function readShopName(shop, accessToken) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop || !accessToken) return null;
  const cached = shopNameCache.get(safeShop);
  const now = Date.now();
  if (cached && cached.expiresAt > now && cached.name) return cached.name;
  try {
    const res = await shopifyFetchWithRetry(`https://${safeShop}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/shop.json`, accessToken, { maxRetries: 6 });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const name = json && json.shop && json.shop.name ? String(json.shop.name).trim() : '';
    if (!name) return null;
    shopNameCache.set(safeShop, { name, expiresAt: now + SHOP_NAME_CACHE_TTL_MS });
    cleanupCache(shopNameCache, 50);
    return name;
  } catch (_) {
    return null;
  }
}

async function readGoogleAdsSpendDailyGbp(startMs, endMs, timeZone) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { totalGbp: 0, byYmd: new Map() };
  const tz = typeof timeZone === 'string' ? timeZone : 'UTC';
  const cacheKey = `ga:${start}:${end}:${tz}`;
  const now = Date.now();
  const cached = adsSpendCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const byYmd = new Map(Object.entries(cached.byYmdObj || {}));
    return { totalGbp: Number(cached.totalGbp) || 0, byYmd };
  }

  const adsDb = getAdsDb();
  if (!adsDb) return { totalGbp: 0, byYmd: new Map() };
  let rows = [];
  try {
    rows = await adsDb.all(
      `
        SELECT
          (EXTRACT(EPOCH FROM DATE_TRUNC('day', hour_ts)) * 1000)::BIGINT AS day_ms,
          COALESCE(SUM(spend_gbp), 0) AS spend_gbp
        FROM google_ads_spend_hourly
        WHERE provider = 'google_ads'
          AND hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
        GROUP BY day_ms
        ORDER BY day_ms ASC
      `,
      [start, end]
    );
  } catch (_) {
    return { totalGbp: 0, byYmd: new Map() };
  }

  const byYmd = new Map();
  let total = 0;
  for (const r of rows || []) {
    const ms = r && r.day_ms != null ? Number(r.day_ms) : NaN;
    const spend = r && r.spend_gbp != null ? Number(r.spend_gbp) : 0;
    if (!Number.isFinite(ms)) continue;
    const ymd = ymdInTimeZone(ms, tz) || null;
    if (!ymd) continue;
    const v = Number.isFinite(spend) ? spend : 0;
    total += v;
    byYmd.set(ymd, (byYmd.get(ymd) || 0) + v);
  }

  const byYmdObj = {};
  for (const [k, v] of byYmd.entries()) byYmdObj[k] = round2(v) || 0;
  adsSpendCache.set(cacheKey, { totalGbp: round2(total) || 0, byYmdObj, expiresAt: now + ADS_SPEND_CACHE_TTL_MS });
  cleanupCache(adsSpendCache, 250);
  return { totalGbp: round2(total) || 0, byYmd };
}

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

function parseYmdParts(ymd) {
  const s = typeof ymd === 'string' ? ymd.trim() : '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

function pad2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '00';
  return String(Math.trunc(v)).padStart(2, '0');
}

function formatYmd(year, month, day) {
  return `${String(year)}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function normalizeSnapshotMode(raw) {
  const mode = raw == null ? '' : String(raw).trim().toLowerCase();
  return SNAPSHOT_MODE_SET.has(mode) ? mode : 'yearly';
}

function normalizeSnapshotYear(raw, fallbackYear) {
  const y = Number(raw);
  if (!Number.isFinite(y) || y < SNAPSHOT_MIN_YEAR || y > 3000) return String(fallbackYear);
  return String(Math.trunc(y));
}

function normalizeSnapshotMonth(raw, fallbackMonth) {
  const s = raw == null ? '' : String(raw).trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return fallbackMonth;
  if (s < SNAPSHOT_MIN_MONTH) return fallbackMonth;
  return s;
}

function buildYearlyWindow(yearStr, nowYmd) {
  const y = Number(yearStr);
  const nowParts = parseYmdParts(nowYmd);
  if (!Number.isFinite(y) || !nowParts) return null;
  const endDay = Math.min(nowParts.day, daysInMonth(y, nowParts.month));
  const startYmd = `${yearStr}-01-01`;
  const endYmd = formatYmd(y, nowParts.month, endDay);
  return { startYmd, endYmd };
}

function buildMonthlyWindow(monthStr, nowYmd) {
  const m = String(monthStr || '');
  const parsed = m.match(/^(\d{4})-(\d{2})$/);
  const nowParts = parseYmdParts(nowYmd);
  if (!parsed || !nowParts) return null;
  const year = Number(parsed[1]);
  const month = Number(parsed[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  const startYmd = `${parsed[1]}-${parsed[2]}-01`;
  const endDayFull = daysInMonth(year, month);
  const isCurrentMonth = year === nowParts.year && month === nowParts.month;
  const endDay = isCurrentMonth ? Math.min(nowParts.day, endDayFull) : endDayFull;
  const endYmd = formatYmd(year, month, endDay);
  return { startYmd, endYmd };
}

function rangeKeyFromYmd(startYmd, endYmd) {
  return `r:${startYmd}:${endYmd}`;
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

async function readReturningCustomerCountByEnd(shop, startMs, endMs) {
  if (!shop) return 0;
  const db = getDb();
  const row = await db.get(
    `
      SELECT COUNT(*) AS n
      FROM (
        SELECT customer_id
        FROM orders_shopify
        WHERE shop = ?
          AND created_at < ?
          AND ${isPaidOrderWhereClause('')}
          AND checkout_token IS NOT NULL
          AND TRIM(checkout_token) != ''
          AND customer_id IS NOT NULL
          AND TRIM(customer_id) != ''
        GROUP BY customer_id
        HAVING COUNT(*) >= 2
          AND SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) >= 1
      ) t
    `,
    [shop, endMs, startMs, endMs]
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

async function readLtvForCohortRange(shop, startUtc, endUtc) {
  if (!shop) return null;
  if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc) || endUtc <= startUtc) return null;
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

async function readLtvForYearCohort(shop, year) {
  if (!shop) return null;
  const y = Number(year);
  if (!Number.isFinite(y) || y < 2000 || y > 3000) return null;
  const startUtc = Date.UTC(y, 0, 1, 0, 0, 0);
  const endUtc = Date.UTC(y + 1, 0, 1, 0, 0, 0);
  return readLtvForCohortRange(shop, startUtc, endUtc);
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

function computeProfitDeductionsDetailed(summary, config) {
  const normalized = normalizeProfitRulesConfigV1(config);
  const allRules = Array.isArray(normalized.rules) ? normalized.rules : [];
  const rules = allRules.filter((rule) => rule && rule.enabled === true);
  let totalDeductions = 0;
  const lines = [];

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
    lines.push({
      id: rule.id ? String(rule.id) : '',
      label: rule.name ? String(rule.name) : 'Expense',
      type: rule.type ? String(rule.type) : '',
      amountGbp: round2(deduction) || 0,
    });
  }
  return {
    total: round2(totalDeductions) || 0,
    lines,
  };
}

function computeProfitDeductions(summary, config) {
  return computeProfitDeductionsDetailed(summary, config).total;
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

async function readCheckoutOrderBounds(shop, timeZone) {
  if (!shop) return { minYear: SNAPSHOT_MIN_YEAR, maxYear: SNAPSHOT_MIN_YEAR, maxYmd: null };
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
    const minYmd = (minTs != null && Number.isFinite(minTs)) ? ymdInTimeZone(minTs, timeZone) : null;
    const maxYmd = (maxTs != null && Number.isFinite(maxTs)) ? ymdInTimeZone(maxTs, timeZone) : null;
    const minYear = minYmd ? parseInt(minYmd.slice(0, 4), 10) : SNAPSHOT_MIN_YEAR;
    const maxYear = maxYmd ? parseInt(maxYmd.slice(0, 4), 10) : SNAPSHOT_MIN_YEAR;
    return {
      minYear: Number.isFinite(minYear) ? minYear : SNAPSHOT_MIN_YEAR,
      maxYear: Number.isFinite(maxYear) ? maxYear : SNAPSHOT_MIN_YEAR,
      maxYmd: maxYmd || null,
    };
  } catch (_) {
    return { minYear: SNAPSHOT_MIN_YEAR, maxYear: SNAPSHOT_MIN_YEAR, maxYmd: null };
  }
}

function buildAvailableYears(currentYear, minYear) {
  const safeCurrent = Number.isFinite(currentYear) ? currentYear : SNAPSHOT_MIN_YEAR;
  const safeMin = Number.isFinite(minYear) ? Math.max(SNAPSHOT_MIN_YEAR, minYear) : SNAPSHOT_MIN_YEAR;
  const out = [];
  for (let y = safeCurrent; y >= safeMin; y -= 1) out.push(String(y));
  return out;
}

function buildAvailableMonths(currentYear, currentMonth) {
  const out = [];
  let y = Number.isFinite(currentYear) ? currentYear : SNAPSHOT_MIN_YEAR;
  let m = Number.isFinite(currentMonth) ? (currentMonth - 1) : 1;
  if (m < 1) {
    y -= 1;
    m = 12;
  }
  if (m < 1 || m > 12) m = 1;
  while (y > SNAPSHOT_MIN_YEAR || (y === SNAPSHOT_MIN_YEAR && m >= 1)) {
    out.push(`${String(y)}-${pad2(m)}`);
    m -= 1;
    if (m < 1) {
      y -= 1;
      m = 12;
    }
  }
  return out;
}

function monthLabel(monthValue) {
  const parsed = String(monthValue || '').match(/^(\d{4})-(\d{2})$/);
  if (!parsed) return String(monthValue || '');
  const y = Number(parsed[1]);
  const m = Number(parsed[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return String(monthValue || '');
  const d = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  const yy = String(y).slice(-2);
  return `${mon} ${yy}`;
}

function ymdAddDays(ymd, deltaDays) {
  const parts = parseYmdParts(ymd);
  if (!parts) return ymd;
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + (Number(deltaDays) || 0));
  return formatYmd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function listYmdRange(startYmd, endYmd, maxDays = 800) {
  const aRaw = String(startYmd || '').slice(0, 10);
  const bRaw = String(endYmd || '').slice(0, 10);
  const a = /^\d{4}-\d{2}-\d{2}$/.test(aRaw) ? aRaw : null;
  const b = /^\d{4}-\d{2}-\d{2}$/.test(bRaw) ? bRaw : null;
  if (!a || !b) return [];
  if (a > b) return [];
  const out = [];
  let cur = a;
  for (let i = 0; i < maxDays; i += 1) {
    out.push(cur);
    if (cur === b) break;
    cur = ymdAddDays(cur, 1);
  }
  return out;
}

function sumNumeric(arr) {
  let t = 0;
  for (const v of arr || []) {
    const n = Number(v);
    if (Number.isFinite(n)) t += n;
  }
  return t;
}

function weightedAvg(values, weights) {
  let sum = 0;
  let wSum = 0;
  const vs = Array.isArray(values) ? values : [];
  const ws = Array.isArray(weights) ? weights : [];
  const len = Math.min(vs.length, ws.length);
  for (let i = 0; i < len; i += 1) {
    if (vs[i] == null || ws[i] == null) continue;
    const v = Number(vs[i]);
    const w = Number(ws[i]);
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    sum += v * w;
    wSum += w;
  }
  if (wSum <= 0) return null;
  return sum / wSum;
}

function downsampleWeekly({ labelsYmd, revenueGbp, costGbp, orders, sessions, conversionRate } = {}) {
  const labels = Array.isArray(labelsYmd) ? labelsYmd : [];
  if (labels.length <= 120) {
    const aov = (Array.isArray(revenueGbp) && Array.isArray(orders))
      ? revenueGbp.map((r, i) => {
        const o = Number(orders[i]);
        const rr = Number(r);
        if (!Number.isFinite(rr) || !Number.isFinite(o) || o <= 0) return null;
        return round2(rr / o);
      })
      : [];
    return {
      granularity: 'day',
      labelsYmd: labels,
      revenueGbp: Array.isArray(revenueGbp) ? revenueGbp : [],
      costGbp: Array.isArray(costGbp) ? costGbp : [],
      orders: Array.isArray(orders) ? orders : [],
      sessions: Array.isArray(sessions) ? sessions : [],
      conversionRate: Array.isArray(conversionRate) ? conversionRate : [],
      aov,
    };
  }

  const outLabels = [];
  const outRevenue = [];
  const outCost = [];
  const outOrders = [];
  const outSessions = [];
  const outConv = [];
  const outAov = [];

  for (let i = 0; i < labels.length; i += 7) {
    const end = Math.min(labels.length, i + 7);
    const sliceLabels = labels.slice(i, end);
    const sliceRevenue = Array.isArray(revenueGbp) ? revenueGbp.slice(i, end) : [];
    const sliceCost = Array.isArray(costGbp) ? costGbp.slice(i, end) : [];
    const sliceOrders = Array.isArray(orders) ? orders.slice(i, end) : [];
    const sliceSessions = Array.isArray(sessions) ? sessions.slice(i, end) : [];
    const sliceConv = Array.isArray(conversionRate) ? conversionRate.slice(i, end) : [];

    const revSum = sumNumeric(sliceRevenue);
    const costSum = sumNumeric(sliceCost);
    const ordSum = sumNumeric(sliceOrders);
    const sesSum = sumNumeric(sliceSessions);
    const conv = weightedAvg(sliceConv, sliceSessions);
    const aov = ordSum > 0 ? round2(revSum / ordSum) : null;

    outLabels.push(sliceLabels[0] || labels[i]);
    outRevenue.push(round2(revSum) || 0);
    outCost.push(round2(costSum) || 0);
    outOrders.push(ordSum || 0);
    outSessions.push(sesSum || 0);
    outConv.push(conv != null ? round1(conv) : null);
    outAov.push(aov);
  }

  return {
    granularity: 'week',
    labelsYmd: outLabels,
    revenueGbp: outRevenue,
    costGbp: outCost,
    orders: outOrders,
    sessions: outSessions,
    conversionRate: outConv,
    aov: outAov,
  };
}

async function readCheckoutOrdersTimeseries(shop, startMs, endMs, timeZone) {
  const out = new Map(); // ymd -> { orders, revenueGbp }
  if (!shop) return out;
  const db = getDb();
  const rows = await db.all(
    `
      SELECT created_at, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price
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
    const ts = row && row.created_at != null ? Number(row.created_at) : NaN;
    if (!Number.isFinite(ts)) continue;
    const ymd = ymdInTimeZone(ts, timeZone);
    if (!ymd) continue;
    const amount = row && row.total_price != null ? Number(row.total_price) : NaN;
    if (!Number.isFinite(amount)) continue;
    const currency = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const gbp = fx.convertToGbp(amount, currency, ratesToGbp);
    if (typeof gbp !== 'number' || !Number.isFinite(gbp)) continue;
    const current = out.get(ymd) || { orders: 0, revenueGbp: 0 };
    current.orders += 1;
    current.revenueGbp += gbp;
    out.set(ymd, current);
  }
  return out;
}

async function getBusinessSnapshot(options = {}) {
  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const shop = salesTruth.resolveShopForSales('');
  const token = shop ? await salesTruth.getAccessToken(shop) : '';

  const nowYmd = ymdInTimeZone(nowMs, timeZone) || `${new Date(nowMs).getUTCFullYear()}-01-01`;
  const nowParts = parseYmdParts(nowYmd) || { year: SNAPSHOT_MIN_YEAR, month: 1, day: 1 };

  const checkoutBounds = await readCheckoutOrderBounds(shop, timeZone);
  const availableYears = buildAvailableYears(nowParts.year, checkoutBounds.minYear);
  const availableMonths = buildAvailableMonths(nowParts.year, nowParts.month);
  const availableMonthOptions = availableMonths.map((value) => ({ value, label: monthLabel(value) }));

  let mode = normalizeSnapshotMode(options.mode);
  let selectedYear = normalizeSnapshotYear(options.year, availableYears[0] || String(nowParts.year));
  if (!availableYears.includes(selectedYear)) selectedYear = availableYears[0] || String(nowParts.year);
  let selectedMonth = normalizeSnapshotMonth(options.month, availableMonths[0] || `${nowParts.year}-${pad2(nowParts.month)}`);
  if (!availableMonths.includes(selectedMonth)) selectedMonth = availableMonths[0] || `${nowParts.year}-${pad2(nowParts.month)}`;

  // Backwards compatibility with old query shape (?year=all)
  if (String(options.year || '').trim().toLowerCase() === 'all') {
    mode = 'yearly';
    selectedYear = availableYears[0] || String(nowParts.year);
  }

  let currentWindow = null;
  let previousWindow = null;
  let periodLabel = '';
  let compareLabel = '';

  if (mode === 'monthly') {
    const m = selectedMonth.match(/^(\d{4})-(\d{2})$/);
    const year = m ? Number(m[1]) : nowParts.year;
    const month = m ? Number(m[2]) : nowParts.month;
    const isCurrentMonth = year === nowParts.year && month === nowParts.month;
    currentWindow = buildMonthlyWindow(selectedMonth, nowYmd);
    const prevYear = year - 1;
    const prevNowDay = isCurrentMonth ? Math.min(nowParts.day, daysInMonth(prevYear, month)) : daysInMonth(prevYear, month);
    const prevNowYmd = formatYmd(prevYear, month, prevNowDay);
    previousWindow = buildMonthlyWindow(`${String(prevYear)}-${pad2(month)}`, prevNowYmd);
    periodLabel = `Monthly Reports · ${monthLabel(selectedMonth)}`;
    compareLabel = `${monthLabel(`${String(prevYear)}-${pad2(month)}`)}`;
  } else {
    currentWindow = buildYearlyWindow(selectedYear, nowYmd);
    const prevYear = Number(selectedYear) - 1;
    const prevNowYmd = formatYmd(prevYear, nowParts.month, Math.min(nowParts.day, daysInMonth(prevYear, nowParts.month)));
    previousWindow = buildYearlyWindow(String(prevYear), prevNowYmd);
    periodLabel = `Yearly Reports · ${selectedYear}`;
    compareLabel = String(prevYear);
  }

  if (!currentWindow || !previousWindow) {
    throw new Error('Could not resolve business snapshot windows');
  }

  const rangeKey = rangeKeyFromYmd(currentWindow.startYmd, currentWindow.endYmd);
  const compareRangeKey = rangeKeyFromYmd(previousWindow.startYmd, previousWindow.endYmd);
  const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
  const compareBounds = store.getRangeBounds(compareRangeKey, nowMs, timeZone);

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

  async function shopifySessionsTimeseriesForBounds(b) {
    if (!shop || !token) return { labelsYmd: [], sessions: [], conversionRate: [], error: 'No token' };
    const sYmd = ymdInTimeZone(b.start, timeZone);
    const eYmd = ymdInTimeZone(Math.max(b.start, b.end - 1), timeZone);
    if (!sYmd || !eYmd) return { labelsYmd: [], sessions: [], conversionRate: [], error: 'Invalid bounds' };
    return shopifyQl.fetchShopifySessionsTimeseriesRange(shop, token, { sinceYmd: sYmd, untilYmd: eYmd, timeZone });
  }

  function summarizeSessionsTimeseries(ts) {
    const sessionsArr = Array.isArray(ts && ts.sessions) ? ts.sessions : [];
    const convArr = Array.isArray(ts && ts.conversionRate) ? ts.conversionRate : [];
    const totalSessions = sessionsArr.length ? sumNumeric(sessionsArr) : null;
    const conv = weightedAvg(convArr, sessionsArr);
    return {
      sessions: totalSessions != null ? totalSessions : null,
      conversionRate: conv != null ? conv : null,
    };
  }

  const [sessionsNowTs, sessionsPrevMetrics, revenue, orders, revenuePrev, ordersPrev, ordersTsMap] = await Promise.all([
    shopifySessionsTimeseriesForBounds(bounds),
    shopifySessionsForBounds(compareBounds),
    shop ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, bounds.start, bounds.end) : Promise.resolve(0),
    shop ? salesTruth.getTruthCheckoutOrderCount(shop, bounds.start, bounds.end) : Promise.resolve(0),
    shop ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    shop ? salesTruth.getTruthCheckoutOrderCount(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    readCheckoutOrdersTimeseries(shop, bounds.start, bounds.end, timeZone).catch(() => new Map()),
  ]);

  let sessionsNowMetrics = summarizeSessionsTimeseries(sessionsNowTs);
  if (sessionsNowMetrics.sessions == null && sessionsNowMetrics.conversionRate == null) {
    sessionsNowMetrics = await shopifySessionsForBounds(bounds);
  }

  const sessions = toNumber(sessionsNowMetrics && sessionsNowMetrics.sessions);
  const sessionsPrev = toNumber(sessionsPrevMetrics && sessionsPrevMetrics.sessions);
  let conversionRate = toNumber(sessionsNowMetrics && sessionsNowMetrics.conversionRate);
  let conversionRatePrev = toNumber(sessionsPrevMetrics && sessionsPrevMetrics.conversionRate);

  // Data integrity guardrails:
  // - Never show Sessions=0 when Orders>0.
  // - If conversion_rate is missing/zero but sessions exist, derive a best-effort ratio.
  let sessionsSafe = sessions;
  let sessionsPrevSafe = sessionsPrev;
  const ordersNowN = toNumber(orders);
  const ordersPrevN = toNumber(ordersPrev);
  if (sessionsSafe != null && sessionsSafe <= 0 && ordersNowN != null && ordersNowN > 0) sessionsSafe = null;
  if (sessionsPrevSafe != null && sessionsPrevSafe <= 0 && ordersPrevN != null && ordersPrevN > 0) sessionsPrevSafe = null;
  if (sessionsSafe == null) conversionRate = null;
  if (sessionsPrevSafe == null) conversionRatePrev = null;
  if ((conversionRate == null || conversionRate <= 0) && sessionsSafe != null && ordersNowN != null) {
    conversionRate = safePercent(ordersNowN, sessionsSafe);
  }
  if ((conversionRatePrev == null || conversionRatePrev <= 0) && sessionsPrevSafe != null && ordersPrevN != null) {
    conversionRatePrev = safePercent(ordersPrevN, sessionsPrevSafe);
  }

  const aov = (toNumber(revenue) != null && toNumber(orders) != null && Number(orders) > 0) ? round2(Number(revenue) / Number(orders)) : null;
  const aovPrev = (toNumber(revenuePrev) != null && toNumber(ordersPrev) != null && Number(ordersPrev) > 0) ? round2(Number(revenuePrev) / Number(ordersPrev)) : null;

  // --- Chart series (Apex) ---
  const chartDays = listYmdRange(startYmd, endYmd);
  const revenueDaily = [];
  const ordersDaily = [];
  const sessionsDaily = [];
  const convDaily = [];

  const sessionsByDay = new Map();
  const convByDay = new Map();
  try {
    const labels = Array.isArray(sessionsNowTs && sessionsNowTs.labelsYmd) ? sessionsNowTs.labelsYmd : [];
    const sArr = Array.isArray(sessionsNowTs && sessionsNowTs.sessions) ? sessionsNowTs.sessions : [];
    const cArr = Array.isArray(sessionsNowTs && sessionsNowTs.conversionRate) ? sessionsNowTs.conversionRate : [];
    for (let i = 0; i < labels.length; i += 1) {
      const ymd = String(labels[i] || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      const sv = toNumber(sArr[i]);
      const cv = toNumber(cArr[i]);
      if (sv != null) sessionsByDay.set(ymd, sv);
      if (cv != null) convByDay.set(ymd, cv);
    }
  } catch (_) {}

  for (const ymd of chartDays) {
    const row = ordersTsMap && ordersTsMap.get ? ordersTsMap.get(ymd) : null;
    const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
    const ord = row && row.orders != null ? Number(row.orders) : 0;
    revenueDaily.push(round2(rev) || 0);
    ordersDaily.push(Number.isFinite(ord) ? ord : 0);
    sessionsDaily.push(sessionsByDay.has(ymd) ? sessionsByDay.get(ymd) : null);
    convDaily.push(convByDay.has(ymd) ? convByDay.get(ymd) : null);
  }

  const profitRules = await readProfitRulesConfig();
  const rulesEnabled = hasEnabledProfitRules(profitRules);
  const includeGoogleAdsSpend = !!(profitRules && profitRules.integrations && profitRules.integrations.includeGoogleAdsSpend === true);

  const [
    shopName,
    summaryNow,
    summaryPrev,
    cogsNowRaw,
    cogsPrevRaw,
    adsNow,
    adsPrev,
  ] = await Promise.all([
    readShopName(shop, token).catch(() => null),
    rulesEnabled ? readOrderCountrySummary(shop, bounds.start, bounds.end) : Promise.resolve(null),
    rulesEnabled ? readOrderCountrySummary(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    readCogsTotalGbpFromLineItems(shop, token, bounds.start, bounds.end).catch(() => null),
    readCogsTotalGbpFromLineItems(shop, token, compareBounds.start, compareBounds.end).catch(() => null),
    includeGoogleAdsSpend ? readGoogleAdsSpendDailyGbp(bounds.start, bounds.end, timeZone) : Promise.resolve({ totalGbp: 0, byYmd: new Map() }),
    includeGoogleAdsSpend ? readGoogleAdsSpendDailyGbp(compareBounds.start, compareBounds.end, timeZone) : Promise.resolve({ totalGbp: 0, byYmd: new Map() }),
  ]);

  const deductionsNowDetailed = (rulesEnabled && summaryNow) ? computeProfitDeductionsDetailed(summaryNow, profitRules) : { total: 0, lines: [] };
  const deductionsPrevDetailed = (rulesEnabled && summaryPrev) ? computeProfitDeductionsDetailed(summaryPrev, profitRules) : { total: 0, lines: [] };

  // Profit section (existing behaviour): only visible when rules are enabled.
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
    profitSection.enabled = !!profitRules.enabled;
    profitSection.hasEnabledRules = rulesEnabled;
    if (rulesEnabled && summaryNow && summaryPrev) {
      const deductionsNow = Number(deductionsNowDetailed.total) || 0;
      const deductionsPrev = Number(deductionsPrevDetailed.total) || 0;

      const estNow = round2((Number(summaryNow.revenueGbp) || 0) - deductionsNow);
      const estPrev = round2((Number(summaryPrev.revenueGbp) || 0) - deductionsPrev);
      const marginNow = (Number(summaryNow.revenueGbp) || 0) > 0 ? round1((Number(estNow) / Number(summaryNow.revenueGbp)) * 100) : null;
      const marginPrev = (Number(summaryPrev.revenueGbp) || 0) > 0 ? round1((Number(estPrev) / Number(summaryPrev.revenueGbp)) * 100) : null;

      profitSection.visible = true;
      profitSection.unavailable = false;
      profitSection.estimatedProfit = metric(estNow, estPrev);
      // Net rules are not separate yet, so net mirrors estimated gross for now.
      profitSection.netProfit = metric(estNow, estPrev);
      profitSection.marginPct = metric(marginNow, marginPrev);
      profitSection.deductions = metric(deductionsNow, deductionsPrev);
    }
  } catch (_) {
    profitSection.unavailable = true;
  }

  // Cost totals + breakdown (used by Revenue & Cost chart tooltip)
  const cogsNow = toNumber(cogsNowRaw);
  const cogsPrev = toNumber(cogsPrevRaw);
  const customExpensesNow = rulesEnabled ? (Number(deductionsNowDetailed.total) || 0) : 0;
  const customExpensesPrev = rulesEnabled ? (Number(deductionsPrevDetailed.total) || 0) : 0;
  const adsSpendNow = includeGoogleAdsSpend ? (Number(adsNow && adsNow.totalGbp) || 0) : 0;
  const adsSpendPrev = includeGoogleAdsSpend ? (Number(adsPrev && adsPrev.totalGbp) || 0) : 0;
  const costNow = (cogsNow != null || customExpensesNow > 0 || adsSpendNow > 0)
    ? round2((cogsNow || 0) + customExpensesNow + adsSpendNow)
    : null;
  const costPrev = (cogsPrev != null || customExpensesPrev > 0 || adsSpendPrev > 0)
    ? round2((cogsPrev || 0) + customExpensesPrev + adsSpendPrev)
    : null;

  const costBreakdownNow = [];
  if (cogsNow != null) costBreakdownNow.push({ label: 'Cost of Goods', amountGbp: round2(cogsNow) || 0 });
  if (rulesEnabled) {
    for (const line of (deductionsNowDetailed.lines || [])) {
      if (!line || !line.label) continue;
      const amt = Number(line.amountGbp) || 0;
      if (amt <= 0) continue;
      costBreakdownNow.push({ label: String(line.label), amountGbp: round2(amt) || 0 });
    }
  }
  if (adsSpendNow > 0) costBreakdownNow.push({ label: 'Google Ads spend', amountGbp: round2(adsSpendNow) || 0 });

  // --- Cost series (daily) ---
  const revTotalDaily = sumNumeric(revenueDaily);
  const ordTotalDaily = sumNumeric(ordersDaily);
  const daysCount = Math.max(1, chartDays.length || 1);

  const cogsDaily = (cogsNow != null && revTotalDaily > 0)
    ? revenueDaily.map((r) => {
      const rr = Number(r) || 0;
      return round2((cogsNow * rr) / revTotalDaily) || 0;
    })
    : revenueDaily.map(() => 0);

  const expensesDaily = revenueDaily.map(() => 0);
  if (rulesEnabled && deductionsNowDetailed && Array.isArray(deductionsNowDetailed.lines) && deductionsNowDetailed.lines.length) {
    for (const line of deductionsNowDetailed.lines) {
      if (!line) continue;
      const amt = Number(line.amountGbp) || 0;
      if (!Number.isFinite(amt) || amt <= 0) continue;
      const t = line.type ? String(line.type) : '';
      if (t === PROFIT_RULE_TYPES.fixedPerPeriod) {
        const perDay = amt / daysCount;
        for (let i = 0; i < expensesDaily.length; i += 1) expensesDaily[i] += perDay;
      } else if (t === PROFIT_RULE_TYPES.fixedPerOrder) {
        const denom = ordTotalDaily > 0 ? ordTotalDaily : daysCount;
        for (let i = 0; i < expensesDaily.length; i += 1) {
          const w = ordTotalDaily > 0 ? (Number(ordersDaily[i]) || 0) : 1;
          expensesDaily[i] += (amt * w) / denom;
        }
      } else {
        const denom = revTotalDaily > 0 ? revTotalDaily : daysCount;
        for (let i = 0; i < expensesDaily.length; i += 1) {
          const w = revTotalDaily > 0 ? (Number(revenueDaily[i]) || 0) : 1;
          expensesDaily[i] += (amt * w) / denom;
        }
      }
    }
  }

  const adsDaily = includeGoogleAdsSpend
    ? chartDays.map((ymd) => {
      const v = adsNow && adsNow.byYmd && adsNow.byYmd.get ? Number(adsNow.byYmd.get(ymd) || 0) : 0;
      return round2(v) || 0;
    })
    : chartDays.map(() => 0);

  const costDaily = chartDays.map((_, i) => {
    const a = Number(cogsDaily[i]) || 0;
    const b = Number(expensesDaily[i]) || 0;
    const cVal = Number(adsDaily[i]) || 0;
    return round2(a + b + cVal) || 0;
  });

  const series = downsampleWeekly({
    labelsYmd: chartDays,
    revenueGbp: revenueDaily,
    costGbp: costDaily,
    orders: ordersDaily,
    sessions: sessionsDaily,
    conversionRate: convDaily,
  });

  const [distinctCustomers, ltvValue, returningRaw] = await Promise.all([
    readDistinctCustomerCount(shop, bounds.start, bounds.end),
    mode === 'yearly' ? readLtvForYearCohort(shop, selectedYear) : readLtvForCohortRange(shop, bounds.start, bounds.end),
    readReturningCustomerCountByEnd(shop, bounds.start, bounds.end),
  ]);

  const returningCustomers = toNumber(returningRaw);
  const newCustomers = (toNumber(distinctCustomers) != null && returningCustomers != null)
    ? Math.max(0, (Number(distinctCustomers) || 0) - (Number(returningCustomers) || 0))
    : null;
  const repeatPurchaseRate = safePercent(returningCustomers, distinctCustomers);

  return {
    ok: true,
    shopName: shopName || null,
    mode,
    year: selectedYear,
    month: selectedMonth,
    periodLabel,
    compareLabel,
    rangeKey,
    series,
    availableYears,
    availableMonths: availableMonthOptions,
    range: {
      start: bounds.start,
      end: bounds.end,
    },
    financial: {
      revenue: metric(revenue, revenuePrev),
      cost: metric(costNow, costPrev),
      costBreakdownNow,
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
      compareRangeYmd: { since: previousWindow.startYmd, until: previousWindow.endYmd },
    },
  };
}

module.exports = {
  getBusinessSnapshot,
};
