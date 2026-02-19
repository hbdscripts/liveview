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

const SNAPSHOT_MODE_SET = new Set(['yearly', 'monthly', 'range']);
const SNAPSHOT_PRESET_SET = new Set([
  'this_month',
  'last_month',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'last_6_months',
  'ytd',
  'custom',
]);
const SNAPSHOT_MIN_YEAR = 2025;
const SNAPSHOT_MIN_MONTH = '2025-01';
const SNAPSHOT_MIN_START_YMD = '2025-01-01';

const SHOPIFY_ADMIN_API_VERSION = '2024-01';
const SHOPIFY_PAYMENTS_API_VERSION = '2025-10';
const VARIANT_COST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SHOP_NAME_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const COGS_RANGE_CACHE_TTL_MS = 10 * 60 * 1000;
const ADS_SPEND_CACHE_TTL_MS = 5 * 60 * 1000;
const SHOPIFY_BALANCE_COSTS_CACHE_TTL_MS = 5 * 60 * 1000;

const variantCostCache = new Map(); // key -> { amount, currency, expiresAt }
const shopNameCache = new Map(); // shop -> { name, expiresAt }
const cogsRangeCache = new Map(); // key -> { value, expiresAt }
const adsSpendCache = new Map(); // key -> { totalGbp, byYmdObj, expiresAt }
const shopifyBalanceCostsCache = new Map(); // key -> { value, expiresAt }

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

async function shopifyGraphqlWithRetry(shop, accessToken, query, variables, { maxRetries = 6, apiVersion = SHOPIFY_ADMIN_API_VERSION } = {}) {
  const safeVersion = String(apiVersion || SHOPIFY_ADMIN_API_VERSION).trim() || SHOPIFY_ADMIN_API_VERSION;
  const url = `https://${shop}/admin/api/${safeVersion}/graphql.json`;
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

async function readCogsAuditGbpFromLineItems(shop, accessToken, startMs, endMs) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const start = Number(startMs);
  const end = Number(endMs);
  if (!safeShop || !accessToken || !Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;

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
  if (!variantIds.length) return { totalGbp: 0, lines: [] };

  const ratesToGbp = await fx.getRatesToGbp();
  const costMap = await fetchVariantUnitCosts(safeShop, accessToken, variantIds);
  const lines = [];
  let total = 0;
  for (const row of (rows || [])) {
    const vid = parseLegacyVariantId(row && row.variant_id);
    const qty = row && row.qty != null ? Number(row.qty) : NaN;
    const fallbackCur = fx.normalizeCurrency(row && row.currency) || 'GBP';
    const cost = vid ? costMap.get(vid) : null;
    const unitCost = cost && cost.amount != null ? Number(cost.amount) : null;
    const currency = fx.normalizeCurrency(cost && cost.currency) || fallbackCur || 'GBP';
    const fxRate = currency === 'GBP' ? 1 : (ratesToGbp && typeof ratesToGbp === 'object' ? ratesToGbp[currency] : null);
    let lineTotalGbp = null;
    if (vid && Number.isFinite(qty) && qty > 0 && Number.isFinite(unitCost) && unitCost >= 0 && Number.isFinite(Number(fxRate)) && Number(fxRate) > 0) {
      lineTotalGbp = round2(unitCost * qty * Number(fxRate));
      if (lineTotalGbp != null) total += lineTotalGbp;
    }
    lines.push({
      variant_id: vid ? String(vid) : '',
      qty: Number.isFinite(qty) ? qty : 0,
      unit_cost: Number.isFinite(unitCost) ? unitCost : null,
      currency,
      fx_rate: Number.isFinite(Number(fxRate)) ? Number(fxRate) : null,
      line_total_gbp: lineTotalGbp,
    });
  }
  return { totalGbp: round2(total) || 0, lines };
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
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { totalGbp: 0, byYmd: new Map(), totalClicks: 0, clicksByYmd: new Map() };
  }
  const tz = typeof timeZone === 'string' ? timeZone : 'UTC';
  const cacheKey = `ga:${start}:${end}:${tz}`;
  const now = Date.now();
  const cached = adsSpendCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    const byYmd = new Map(Object.entries(cached.byYmdObj || {}));
    const clicksByYmd = new Map(Object.entries(cached.clicksByYmdObj || {}));
    return {
      totalGbp: Number(cached.totalGbp) || 0,
      byYmd,
      totalClicks: Number(cached.totalClicks) || 0,
      clicksByYmd,
    };
  }

  const adsDb = getAdsDb();
  if (!adsDb) return { totalGbp: 0, byYmd: new Map(), totalClicks: 0, clicksByYmd: new Map() };
  let rows = [];
  try {
    rows = await adsDb.all(
      `
        SELECT
          (EXTRACT(EPOCH FROM DATE_TRUNC('day', hour_ts)) * 1000)::BIGINT AS day_ms,
          COALESCE(SUM(spend_gbp), 0) AS spend_gbp,
          COALESCE(SUM(clicks), 0) AS clicks
        FROM google_ads_spend_hourly
        WHERE provider = 'google_ads'
          AND hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
        GROUP BY day_ms
        ORDER BY day_ms ASC
      `,
      [start, end]
    );
  } catch (_) {
    return { totalGbp: 0, byYmd: new Map(), totalClicks: 0, clicksByYmd: new Map() };
  }

  const byYmd = new Map();
  const clicksByYmd = new Map();
  let total = 0;
  let totalClicks = 0;
  for (const r of rows || []) {
    const ms = r && r.day_ms != null ? Number(r.day_ms) : NaN;
    const spend = r && r.spend_gbp != null ? Number(r.spend_gbp) : 0;
    const clicks = r && r.clicks != null ? Number(r.clicks) : 0;
    if (!Number.isFinite(ms)) continue;
    const ymd = ymdInTimeZone(ms, tz) || null;
    if (!ymd) continue;
    const v = Number.isFinite(spend) ? spend : 0;
    const c = Number.isFinite(clicks) ? clicks : 0;
    total += v;
    totalClicks += c;
    byYmd.set(ymd, (byYmd.get(ymd) || 0) + v);
    clicksByYmd.set(ymd, (clicksByYmd.get(ymd) || 0) + c);
  }

  const byYmdObj = {};
  for (const [k, v] of byYmd.entries()) byYmdObj[k] = round2(v) || 0;
  const clicksByYmdObj = {};
  for (const [k, v] of clicksByYmd.entries()) clicksByYmdObj[k] = Math.max(0, Math.round(v));
  adsSpendCache.set(cacheKey, {
    totalGbp: round2(total) || 0,
    byYmdObj,
    totalClicks: Math.max(0, Math.round(totalClicks)),
    clicksByYmdObj,
    expiresAt: now + ADS_SPEND_CACHE_TTL_MS,
  });
  cleanupCache(adsSpendCache, 250);
  return {
    totalGbp: round2(total) || 0,
    byYmd,
    totalClicks: Math.max(0, Math.round(totalClicks)),
    clicksByYmd,
  };
}

function firstGraphqlErrorMessage(json) {
  if (!json || typeof json !== 'object') return '';
  const errors = Array.isArray(json.errors) ? json.errors : [];
  if (!errors.length) return '';
  const first = errors[0];
  if (first && typeof first.message === 'string' && first.message.trim()) {
    return first.message.trim();
  }
  return 'GraphQL error';
}

function addAmountToMap(map, key, amount) {
  if (!map || !map.set) return;
  const k = String(key || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return;
  map.set(k, (Number(map.get(k) || 0) || 0) + n);
}

function sumAmountMap(map) {
  if (!map || !map.entries) return 0;
  let total = 0;
  for (const [, raw] of map.entries()) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
  }
  return total;
}

function mapToRoundedObject(map) {
  const obj = {};
  if (!map || !map.entries) return obj;
  for (const [k, raw] of map.entries()) {
    const key = String(k || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    obj[key] = round2(n) || 0;
  }
  return obj;
}

function roundedObjectToMap(obj) {
  const out = new Map();
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, raw] of Object.entries(obj)) {
    const key = String(k || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    out.set(key, n);
  }
  return out;
}

function subtractAmountMapsNonNegative(primary, subtractor) {
  const out = new Map();
  const a = primary && primary.entries ? primary : new Map();
  const b = subtractor && subtractor.entries ? subtractor : new Map();
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    const base = Number(a.get(key) || 0) || 0;
    const sub = Number(b.get(key) || 0) || 0;
    const next = Math.max(0, base - sub);
    if (next > 0) out.set(key, next);
  }
  return out;
}

function addCountToMap(map, key, increment = 1) {
  const m = map instanceof Map ? map : null;
  if (!m) return;
  const k = String(key == null ? '' : key).trim() || '(none)';
  const inc = Number(increment) || 0;
  if (!inc) return;
  const prev = Number(m.get(k) || 0) || 0;
  m.set(k, prev + inc);
}

function mapTopCounts(map, limit = 8) {
  const m = map instanceof Map ? map : new Map();
  const rows = [];
  for (const [key, countRaw] of m.entries()) {
    const count = Number(countRaw) || 0;
    if (count <= 0) continue;
    rows.push({ key: String(key), count: Math.round(count) });
  }
  rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return rows.slice(0, Math.max(1, Number(limit) || 8));
}

function mapTopAmounts(map, limit = 8) {
  const m = map instanceof Map ? map : new Map();
  const rows = [];
  for (const [key, amountRaw] of m.entries()) {
    const amount = round2(amountRaw) || 0;
    if (amount <= 0) continue;
    rows.push({ key: String(key), amountGbp: amount });
  }
  rows.sort((a, b) => b.amountGbp - a.amountGbp || a.key.localeCompare(b.key));
  return rows.slice(0, Math.max(1, Number(limit) || 8));
}

function normalizeTxToken(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function moneyV2ToGbp(money, ratesToGbp) {
  if (!money || typeof money !== 'object') return 0;
  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) return 0;
  const currency = fx.normalizeCurrency(money.currencyCode) || 'GBP';
  const gbp = fx.convertToGbp(amount, currency, ratesToGbp);
  return Number.isFinite(Number(gbp)) ? Number(gbp) : 0;
}

function isoToYmdInTimeZone(iso, timeZone) {
  const raw = typeof iso === 'string' ? iso.trim() : '';
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return ymdInTimeZone(ms, timeZone) || null;
}

function isChargeOrRefundType(typeToken) {
  const t = normalizeTxToken(typeToken);
  return t === 'charge' || t === 'refund' || t === 'charge_adjustment' || t === 'refund_adjustment';
}

function isPaymentFeeTransaction(tx) {
  return isChargeOrRefundType(tx && tx.type);
}

function isLikelyAppBillTransaction(tx) {
  const type = normalizeTxToken(tx && tx.type);
  const sourceType = normalizeTxToken(tx && tx.sourceType);
  const reason = normalizeTxToken(tx && tx.adjustmentReason);
  if (type.includes('application_fee')) return true;
  if (type.includes('billing_debit') || type.includes('billing_credit')) return true;
  if (sourceType.includes('app')) return true;
  if (reason.includes('app') || reason.includes('subscription') || reason.includes('billing')) return true;
  return false;
}

function isLikelyShopifyFeeTransaction(tx) {
  const type = normalizeTxToken(tx && tx.type);
  const sourceType = normalizeTxToken(tx && tx.sourceType);
  const reason = normalizeTxToken(tx && tx.adjustmentReason);
  if (isChargeOrRefundType(type)) return false;
  if (type.includes('fee')) return true;
  if (type.includes('billing')) return true;
  if (type.includes('tax_adjustment')) return true;
  if (type.includes('shopify_source_debit')) return true;
  if ((sourceType === 'adjustment' || sourceType === 'system_adjustment' || sourceType === 'adjustment_reversal')
      && (reason.includes('fee') || reason.includes('billing') || reason.includes('subscription') || reason.includes('app') || reason.includes('tax'))) {
    return true;
  }
  if (reason.includes('fee') || reason.includes('billing') || reason.includes('subscription') || reason.includes('app')) return true;
  return false;
}

async function runShopifyAdminGraphql(shop, accessToken, query, variables, { apiVersion } = {}) {
  try {
    const res = await shopifyGraphqlWithRetry(shop, accessToken, query, variables, { maxRetries: 6, apiVersion });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    if (!res.ok) {
      const msg = firstGraphqlErrorMessage(json) || `HTTP ${res.status}`;
      return { ok: false, data: null, error: String(msg).slice(0, 240) };
    }
    const gqlErr = firstGraphqlErrorMessage(json);
    if (gqlErr) return { ok: false, data: null, error: String(gqlErr).slice(0, 240) };
    return { ok: true, data: json && json.data ? json.data : null, error: '' };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'GraphQL request failed';
    return { ok: false, data: null, error: msg.slice(0, 240) };
  }
}

async function fetchShopifyPaymentsBalanceTransactions(shop, accessToken, searchQuery) {
  if (!shop || !accessToken) return { ok: false, rows: [], error: 'Missing shop/token' };
  const gql = `
    query SnapshotBalanceTransactions($first: Int!, $after: String, $query: String) {
      shopifyPaymentsAccount {
        balanceTransactions(
          first: $first
          after: $after
          query: $query
          sortKey: PROCESSED_AT
          hideTransfers: true
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            transactionDate
            type
            sourceType
            adjustmentReason
            amount { amount currencyCode }
            fee { amount currencyCode }
            net { amount currencyCode }
          }
        }
      }
    }
  `;
  const rows = [];
  let after = null;
  let pages = 0;
  while (pages < 40) {
    const rsp = await runShopifyAdminGraphql(shop, accessToken, gql, {
      first: 250,
      after,
      query: searchQuery || null,
    }, { apiVersion: SHOPIFY_PAYMENTS_API_VERSION });
    if (!rsp.ok) return { ok: false, rows: [], error: rsp.error || 'Shopify Payments query failed' };
    const account = rsp.data && rsp.data.shopifyPaymentsAccount ? rsp.data.shopifyPaymentsAccount : null;
    if (!account || !account.balanceTransactions) return { ok: false, rows: [], error: 'Shopify Payments account unavailable' };
    const conn = account.balanceTransactions;
    const nodes = Array.isArray(conn.nodes) ? conn.nodes : [];
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      rows.push(node);
    }
    const pageInfo = conn.pageInfo && typeof conn.pageInfo === 'object' ? conn.pageInfo : null;
    const hasNext = !!(pageInfo && pageInfo.hasNextPage === true && pageInfo.endCursor);
    if (!hasNext) break;
    after = String(pageInfo.endCursor);
    pages += 1;
  }
  return { ok: true, rows, error: '' };
}

async function readShopifyBalanceCostsGbp(shop, accessToken, sinceYmd, untilYmd, timeZone, options = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const since = normalizeYmd(sinceYmd, '');
  const until = normalizeYmd(untilYmd, '');
  const audit = !!(options && options.audit === true);
  if (!safeShop || !accessToken || !since || !until || since > until) {
    return {
      available: false,
      error: 'missing_shop_or_token_or_range',
      paymentFeesTotalGbp: 0,
      shopifyFeesTotalGbp: 0,
      klarnaFeesTotalGbp: 0,
      appBillsTotalGbp: 0,
      paymentFeesByYmd: new Map(),
      shopifyFeesByYmd: new Map(),
      klarnaFeesByYmd: new Map(),
      appBillsByYmd: new Map(),
      diagnostics: null,
      ...(audit ? { audit_rows: [], audit_query: null } : {}),
    };
  }
  const tz = typeof timeZone === 'string' && timeZone ? timeZone : 'UTC';
  const cacheKey = `${safeShop}:${since}:${until}:${tz}`;
  const now = Date.now();
  const cached = shopifyBalanceCostsCache.get(cacheKey);
  if (!audit && cached && cached.expiresAt > now && cached.value) {
    const value = cached.value;
    const shopifyFeesByYmdObj = value.shopifyFeesByYmdObj || value.klarnaFeesByYmdObj || null;
    return {
      available: !!value.available,
      error: value.error || '',
      paymentFeesTotalGbp: Number(value.paymentFeesTotalGbp) || 0,
      shopifyFeesTotalGbp: Number(value.shopifyFeesTotalGbp != null ? value.shopifyFeesTotalGbp : value.klarnaFeesTotalGbp) || 0,
      klarnaFeesTotalGbp: Number(value.shopifyFeesTotalGbp != null ? value.shopifyFeesTotalGbp : value.klarnaFeesTotalGbp) || 0,
      appBillsTotalGbp: Number(value.appBillsTotalGbp) || 0,
      paymentFeesByYmd: roundedObjectToMap(value.paymentFeesByYmdObj),
      shopifyFeesByYmd: roundedObjectToMap(shopifyFeesByYmdObj),
      klarnaFeesByYmd: roundedObjectToMap(shopifyFeesByYmdObj),
      appBillsByYmd: roundedObjectToMap(value.appBillsByYmdObj),
      diagnostics: value.diagnostics && typeof value.diagnostics === 'object' ? value.diagnostics : null,
    };
  }

  const empty = {
    available: false,
    error: '',
    paymentFeesTotalGbp: 0,
    shopifyFeesTotalGbp: 0,
    klarnaFeesTotalGbp: 0,
    appBillsTotalGbp: 0,
    paymentFeesByYmd: new Map(),
    shopifyFeesByYmd: new Map(),
    klarnaFeesByYmd: new Map(),
    appBillsByYmd: new Map(),
    diagnostics: null,
    ...(audit ? { audit_rows: [], audit_query: null } : {}),
  };

  const untilExclusive = normalizeYmd(ymdAddDays(until, 1), '');
  const searchBase = untilExclusive
    ? `processed_at:>=${since} processed_at:<${untilExclusive}`
    : `processed_at:>=${since} processed_at:<=${until}`;
  const [allResp, ratesToGbp] = await Promise.all([
    fetchShopifyPaymentsBalanceTransactions(safeShop, accessToken, searchBase),
    fx.getRatesToGbp().catch(() => ({})),
  ]);
  const diagnosticsMessages = [];

  if (!allResp.ok) {
    empty.error = allResp.error || 'shopify_payments_lookup_failed';
    return empty;
  }

  const paymentAllByYmd = new Map();
  const shopifyFeesAllByYmd = new Map();
  const appBillsByYmd = new Map();
  const typeCounts = new Map();
  const sourceTypeCounts = new Map();
  const reasonCounts = new Map();
  const feeByType = new Map();
  const debitByType = new Map();
  const auditRows = audit ? [] : null;
  for (const tx of allResp.rows) {
    if (!tx || typeof tx !== 'object') continue;
    const ymd = isoToYmdInTimeZone(tx.transactionDate, tz);
    if (!ymd || ymd < since || ymd > until) continue;
    const typeKey = String(tx.type || '').trim() || '(none)';
    const sourceTypeKey = String(tx.sourceType || '').trim() || '(none)';
    const reasonKey = String(tx.adjustmentReason || '').trim() || '(none)';
    addCountToMap(typeCounts, typeKey, 1);
    addCountToMap(sourceTypeCounts, sourceTypeKey, 1);
    addCountToMap(reasonCounts, reasonKey, 1);
    const amountGbp = moneyV2ToGbp(tx.amount, ratesToGbp);
    const feeGbp = moneyV2ToGbp(tx.fee, ratesToGbp);
    if (feeGbp > 0) addAmountToMap(feeByType, typeKey, feeGbp);
    const netGbp = moneyV2ToGbp(tx.net, ratesToGbp);
    if (netGbp < 0) addAmountToMap(debitByType, typeKey, Math.abs(netGbp));
    const isPaymentFee = isPaymentFeeTransaction(tx);
    const isAppBill = netGbp < 0 && isLikelyAppBillTransaction(tx);
    const isShopifyFeeLike = netGbp < 0 && isLikelyShopifyFeeTransaction(tx);
    if (isPaymentFee) {
      if (feeGbp > 0) addAmountToMap(paymentAllByYmd, ymd, feeGbp);
    }
    if (isAppBill) {
      addAmountToMap(appBillsByYmd, ymd, Math.abs(netGbp));
    }
    if (isShopifyFeeLike) {
      addAmountToMap(shopifyFeesAllByYmd, ymd, Math.abs(netGbp));
    }
    if (auditRows) {
      const countedAs = [];
      if (isPaymentFee && feeGbp > 0) countedAs.push('payment_fee');
      if (isAppBill && netGbp < 0) countedAs.push('app_bill');
      if (isShopifyFeeLike && netGbp < 0) countedAs.push('shopify_fee_like');
      const txId = [
        String(tx.transactionDate || ''),
        String(tx.type || ''),
        String(tx.sourceType || ''),
        String(tx.adjustmentReason || ''),
        String(round2(amountGbp) || 0),
        String(round2(feeGbp) || 0),
        String(round2(netGbp) || 0),
      ].join('|');
      auditRows.push({
        tx_id: txId.slice(0, 240),
        processed_at: tx.transactionDate ? String(tx.transactionDate) : null,
        classification: countedAs.length ? countedAs.join('+') : 'ignored',
        amount_gbp: round2(amountGbp) || 0,
        fee_gbp: round2(feeGbp) || 0,
        net_gbp: round2(netGbp) || 0,
      });
    }
  }

  const shopifyFeesByYmd = subtractAmountMapsNonNegative(shopifyFeesAllByYmd, appBillsByYmd);
  if (shopifyFeesByYmd.size === 0) diagnosticsMessages.push('no_shopify_fee_like_adjustments_in_range');
  if (appBillsByYmd.size === 0) diagnosticsMessages.push('no_app_bill_like_adjustments_in_range');
  const paymentFeesByYmd = paymentAllByYmd;
  const paymentFeesTotalGbp = round2(sumAmountMap(paymentFeesByYmd)) || 0;
  const shopifyFeesTotalGbp = round2(sumAmountMap(shopifyFeesByYmd)) || 0;
  const appBillsTotalGbp = round2(sumAmountMap(appBillsByYmd)) || 0;
  const diagnostics = {
    rows: Array.isArray(allResp.rows) ? allResp.rows.length : 0,
    topTypes: mapTopCounts(typeCounts, 8),
    topSourceTypes: mapTopCounts(sourceTypeCounts, 8),
    topAdjustmentReasons: mapTopCounts(reasonCounts, 8).filter((row) => row.key !== '(none)'),
    topFeeTypes: mapTopAmounts(feeByType, 8),
    topDebitTypes: mapTopAmounts(debitByType, 8),
  };
  const value = {
    available: true,
    error: diagnosticsMessages.join(' | '),
    paymentFeesTotalGbp,
    shopifyFeesTotalGbp,
    klarnaFeesTotalGbp: shopifyFeesTotalGbp,
    appBillsTotalGbp,
    paymentFeesByYmdObj: mapToRoundedObject(paymentFeesByYmd),
    shopifyFeesByYmdObj: mapToRoundedObject(shopifyFeesByYmd),
    klarnaFeesByYmdObj: mapToRoundedObject(shopifyFeesByYmd),
    appBillsByYmdObj: mapToRoundedObject(appBillsByYmd),
    diagnostics,
  };
  shopifyBalanceCostsCache.set(cacheKey, { value, expiresAt: now + SHOPIFY_BALANCE_COSTS_CACHE_TTL_MS });
  cleanupCache(shopifyBalanceCostsCache, 400);
  return {
    available: true,
    error: value.error,
    paymentFeesTotalGbp,
    shopifyFeesTotalGbp,
    klarnaFeesTotalGbp: shopifyFeesTotalGbp,
    appBillsTotalGbp,
    paymentFeesByYmd,
    shopifyFeesByYmd,
    klarnaFeesByYmd: shopifyFeesByYmd,
    appBillsByYmd,
    diagnostics,
    ...(audit ? { audit_rows: auditRows || [], audit_query: { since, until, untilExclusive: untilExclusive || null, search: searchBase } } : {}),
  };
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

function hourKeyInTimeZone(ms, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(new Date(ms));
    const map = {};
    for (const part of parts) map[part.type] = part.value;
    if (!map.year || !map.month || !map.day || map.hour == null) return null;
    return `${map.year}-${map.month}-${map.day} ${map.hour}:00`;
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

function normalizeSnapshotPreset(raw) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase();
  return SNAPSHOT_PRESET_SET.has(s) ? s : '';
}

function normalizeYmd(raw, fallbackYmd = '') {
  const s = String(raw || '').trim().slice(0, 10);
  const parts = parseYmdParts(s);
  if (!parts) return fallbackYmd || '';
  const maxDay = daysInMonth(parts.year, parts.month);
  if (parts.day < 1 || parts.day > maxDay) return fallbackYmd || '';
  return formatYmd(parts.year, parts.month, parts.day);
}

function ymdAddMonths(ymd, deltaMonths) {
  const parts = parseYmdParts(ymd);
  if (!parts) return String(ymd || '');
  const dMonths = Number(deltaMonths);
  if (!Number.isFinite(dMonths)) return formatYmd(parts.year, parts.month, parts.day);
  const whole = Math.trunc(dMonths);
  const targetMonthIndex = (parts.year * 12 + (parts.month - 1)) + whole;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12 + 12) % 12 + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(parts.day, maxDay);
  return formatYmd(targetYear, targetMonth, targetDay);
}

function ymdMonthStart(ymd) {
  const parts = parseYmdParts(ymd);
  if (!parts) return String(ymd || '');
  return formatYmd(parts.year, parts.month, 1);
}

function ymdMonthEnd(ymd) {
  const parts = parseYmdParts(ymd);
  if (!parts) return String(ymd || '');
  return formatYmd(parts.year, parts.month, daysInMonth(parts.year, parts.month));
}

function ymdDaysInclusive(startYmd, endYmd) {
  const a = normalizeYmd(startYmd, '');
  const b = normalizeYmd(endYmd, '');
  if (!a || !b || a > b) return 0;
  const out = listYmdRange(a, b, 4000);
  return out.length;
}

function sanitizeRangeWindow(startYmd, endYmd, nowYmd) {
  const safeNow = normalizeYmd(nowYmd, '');
  let start = normalizeYmd(startYmd, safeNow || SNAPSHOT_MIN_START_YMD);
  let end = normalizeYmd(endYmd, safeNow || start);
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }
  if (start < SNAPSHOT_MIN_START_YMD) start = SNAPSHOT_MIN_START_YMD;
  if (safeNow && end > safeNow) end = safeNow;
  if (safeNow && start > safeNow) start = safeNow;
  if (start > end) start = end;
  return { startYmd: start, endYmd: end };
}

function buildPresetCurrentRangeWindow(preset, nowYmd) {
  const now = normalizeYmd(nowYmd, '');
  if (!now) return null;
  if (preset === 'this_month') {
    return { startYmd: ymdMonthStart(now), endYmd: now };
  }
  if (preset === 'last_month') {
    const prevMonthDay = ymdAddMonths(ymdMonthStart(now), -1);
    return { startYmd: ymdMonthStart(prevMonthDay), endYmd: ymdMonthEnd(prevMonthDay) };
  }
  if (preset === 'last_7_days') {
    return { startYmd: ymdAddDays(now, -6), endYmd: now };
  }
  if (preset === 'last_30_days') {
    return { startYmd: ymdAddDays(now, -29), endYmd: now };
  }
  if (preset === 'last_90_days') {
    return { startYmd: ymdAddDays(now, -89), endYmd: now };
  }
  if (preset === 'last_6_months') {
    // Rolling 6-month window ending today.
    return { startYmd: ymdAddDays(ymdAddMonths(now, -6), 1), endYmd: now };
  }
  if (preset === 'ytd') {
    const p = parseYmdParts(now);
    if (!p) return null;
    return { startYmd: formatYmd(p.year, 1, 1), endYmd: now };
  }
  return null;
}

function buildPresetCompareRangeWindow(preset, currentWindow, nowYmd) {
  const current = currentWindow && currentWindow.startYmd && currentWindow.endYmd ? currentWindow : null;
  if (!current) return null;
  const safeCurrent = sanitizeRangeWindow(current.startYmd, current.endYmd, nowYmd);
  if (preset === 'this_month') {
    const prevMonthDate = ymdAddMonths(safeCurrent.startYmd, -1);
    const prevParts = parseYmdParts(prevMonthDate);
    const nowEndParts = parseYmdParts(safeCurrent.endYmd);
    if (!prevParts || !nowEndParts) return null;
    const startYmd = formatYmd(prevParts.year, prevParts.month, 1);
    const endDay = Math.min(nowEndParts.day, daysInMonth(prevParts.year, prevParts.month));
    return { startYmd, endYmd: formatYmd(prevParts.year, prevParts.month, endDay) };
  }
  if (preset === 'last_month') {
    const prevMonthDate = ymdAddMonths(safeCurrent.startYmd, -1);
    return { startYmd: ymdMonthStart(prevMonthDate), endYmd: ymdMonthEnd(prevMonthDate) };
  }
  if (preset === 'ytd') {
    const nowEndParts = parseYmdParts(safeCurrent.endYmd);
    if (!nowEndParts) return null;
    const prevYear = nowEndParts.year - 1;
    const endDay = Math.min(nowEndParts.day, daysInMonth(prevYear, nowEndParts.month));
    return {
      startYmd: formatYmd(prevYear, 1, 1),
      endYmd: formatYmd(prevYear, nowEndParts.month, endDay),
    };
  }
  // Rolling/custom presets: previous immediately preceding period of equal length.
  const len = Math.max(1, ymdDaysInclusive(safeCurrent.startYmd, safeCurrent.endYmd));
  const endYmd = ymdAddDays(safeCurrent.startYmd, -1);
  const startYmd = ymdAddDays(endYmd, -(len - 1));
  return { startYmd, endYmd };
}

function dateLabelFromYmd(ymd) {
  const parts = parseYmdParts(ymd);
  if (!parts) return String(ymd || '');
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
  try {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  } catch (_) {
    return String(ymd || '');
  }
}

function dateSpanLabel(startYmd, endYmd) {
  const a = dateLabelFromYmd(startYmd);
  const b = dateLabelFromYmd(endYmd);
  if (!a && !b) return '';
  if (a === b) return a;
  return `${a} - ${b}`;
}

function presetLabel(preset) {
  if (preset === 'this_month') return 'This month';
  if (preset === 'last_month') return 'Last month';
  if (preset === 'last_7_days') return 'Last 7 days';
  if (preset === 'last_30_days') return 'Last 30 days';
  if (preset === 'last_90_days') return 'Last 90 days';
  if (preset === 'last_6_months') return 'Last 6 months';
  if (preset === 'ytd') return 'Year to date';
  if (preset === 'custom') return 'Custom range';
  return 'Range';
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

function resolveSnapshotWindows(options = {}, nowYmd) {
  const safeNowYmd = normalizeYmd(nowYmd, normalizeYmd(new Date().toISOString().slice(0, 10), SNAPSHOT_MIN_START_YMD));
  const nowParts = parseYmdParts(safeNowYmd) || { year: SNAPSHOT_MIN_YEAR, month: 1, day: 1 };

  let mode = normalizeSnapshotMode(options.mode);
  let selectedYear = normalizeSnapshotYear(options.year, String(nowParts.year));
  let selectedMonth = normalizeSnapshotMonth(options.month, `${nowParts.year}-${pad2(nowParts.month)}`);
  let preset = normalizeSnapshotPreset(options.preset);
  let periodLabel = '';
  let compareLabel = '';
  let compareYear = null;
  let currentWindow = null;
  let previousWindow = null;

  // Backwards compatibility with old query shape (?year=all)
  if (String(options.year || '').trim().toLowerCase() === 'all') {
    mode = 'yearly';
    selectedYear = String(nowParts.year);
  }

  if (mode === 'range') {
    if (!preset) preset = 'custom';
    const presetWindow = buildPresetCurrentRangeWindow(preset, safeNowYmd);
    const fromParams = sanitizeRangeWindow(
      normalizeYmd(options.since, presetWindow && presetWindow.startYmd ? presetWindow.startYmd : safeNowYmd),
      normalizeYmd(options.until, presetWindow && presetWindow.endYmd ? presetWindow.endYmd : safeNowYmd),
      safeNowYmd
    );
    currentWindow = fromParams || presetWindow || sanitizeRangeWindow(safeNowYmd, safeNowYmd, safeNowYmd);
    previousWindow = buildPresetCompareRangeWindow(preset, currentWindow, safeNowYmd);
    if (!previousWindow) previousWindow = buildPresetCompareRangeWindow('custom', currentWindow, safeNowYmd);
    previousWindow = sanitizeRangeWindow(previousWindow.startYmd, previousWindow.endYmd, safeNowYmd);
    periodLabel = `${presetLabel(preset)} · ${dateSpanLabel(currentWindow.startYmd, currentWindow.endYmd)}`;
    compareLabel = dateSpanLabel(previousWindow.startYmd, previousWindow.endYmd);
  } else if (mode === 'monthly') {
    const m = selectedMonth.match(/^(\d{4})-(\d{2})$/);
    const year = m ? Number(m[1]) : nowParts.year;
    const month = m ? Number(m[2]) : nowParts.month;
    const isCurrentMonth = year === nowParts.year && month === nowParts.month;
    currentWindow = buildMonthlyWindow(selectedMonth, safeNowYmd);
    const prevYear = year - 1;
    compareYear = prevYear;
    const prevNowDay = isCurrentMonth ? Math.min(nowParts.day, daysInMonth(prevYear, month)) : daysInMonth(prevYear, month);
    const prevNowYmd = formatYmd(prevYear, month, prevNowDay);
    previousWindow = buildMonthlyWindow(`${String(prevYear)}-${pad2(month)}`, prevNowYmd);
    periodLabel = `Monthly Reports · ${monthLabel(selectedMonth)}`;
    compareLabel = `${monthLabel(`${String(prevYear)}-${pad2(month)}`)}`;
  } else {
    mode = 'yearly';
    currentWindow = buildYearlyWindow(selectedYear, safeNowYmd);
    const prevYear = Number(selectedYear) - 1;
    compareYear = prevYear;
    const prevNowYmd = formatYmd(prevYear, nowParts.month, Math.min(nowParts.day, daysInMonth(prevYear, nowParts.month)));
    previousWindow = buildYearlyWindow(String(prevYear), prevNowYmd);
    periodLabel = `Yearly Reports · ${selectedYear}`;
    compareLabel = String(prevYear);
  }

  if (!currentWindow || !previousWindow) {
    throw new Error('Could not resolve business snapshot windows');
  }

  currentWindow = sanitizeRangeWindow(currentWindow.startYmd, currentWindow.endYmd, safeNowYmd);
  previousWindow = sanitizeRangeWindow(previousWindow.startYmd, previousWindow.endYmd, safeNowYmd);

  return {
    mode,
    preset: preset || '',
    selectedYear,
    selectedMonth,
    compareYear,
    periodLabel,
    compareLabel,
    nowYmd: safeNowYmd,
    currentWindow,
    previousWindow,
  };
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

function computeShippingCostFromSummary(summary, shippingConfig) {
  if (!shippingConfig || shippingConfig.enabled !== true || !summary || !summary.byCountry || !summary.byCountry.size) return 0;
  const defaultGbp = Math.max(0, Number(shippingConfig.worldwideDefaultGbp) || 0);
  const overrides = Array.isArray(shippingConfig.overrides) ? shippingConfig.overrides : [];
  let total = 0;
  for (const [countryCode, data] of summary.byCountry) {
    const orders = Number(data && data.orders) || 0;
    if (orders <= 0) continue;
    const code = normalizeCountryCode(countryCode) || countryCode;
    let priceGbp = defaultGbp;
    for (const o of overrides) {
      if (!o || o.enabled === false) continue;
      const countries = Array.isArray(o.countries) ? o.countries : [];
      if (countries.includes(code)) {
        priceGbp = Math.max(0, Number(o.priceGbp) || 0);
        break;
      }
    }
    total += orders * priceGbp;
  }
  return round2(total) || 0;
}

function computeShippingCostAuditFromSummary(summary, shippingConfig, { assertSingleSource } = {}) {
  const res = { totalGbp: 0, lines: [] };
  if (!shippingConfig || shippingConfig.enabled !== true || !summary || !summary.byCountry || !summary.byCountry.size) return res;
  const defaultGbp = Math.max(0, Number(shippingConfig.worldwideDefaultGbp) || 0);
  const overrides = Array.isArray(shippingConfig.overrides) ? shippingConfig.overrides : [];
  let total = 0;
  for (const [countryCode, data] of summary.byCountry) {
    const orders = Number(data && data.orders) || 0;
    if (orders <= 0) continue;
    const code = normalizeCountryCode(countryCode) || String(countryCode || '').trim().toUpperCase().slice(0, 2) || 'XX';
    let usedPriceGbp = defaultGbp;
    let priceSource = 'worldwide_default';
    for (const o of overrides) {
      if (!o || o.enabled === false) continue;
      const countries = Array.isArray(o.countries) ? o.countries : [];
      if (countries.includes(code)) {
        usedPriceGbp = Math.max(0, Number(o.priceGbp) || 0);
        priceSource = 'override';
        break;
      }
    }
    if (assertSingleSource) {
      const sources = priceSource === 'override' ? ['override'] : ['worldwide_default'];
      if (sources.length !== 1) {
        throw new Error('shipping_audit_dual_source country=' + code + ' sources=' + JSON.stringify(sources));
      }
    }
    const subtotal = round2(orders * usedPriceGbp) || 0;
    total += subtotal;
    res.lines.push({
      country: code,
      orders,
      used_price_gbp: round2(usedPriceGbp) || 0,
      price_source: priceSource,
      subtotal_gbp: subtotal,
    });
  }
  res.totalGbp = round2(total) || 0;
  return res;
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

function computeProfitDeductionsAudit(summary, config) {
  const normalized = normalizeProfitRulesConfigV1(config);
  const allRules = Array.isArray(normalized.rules) ? normalized.rules : [];
  const rules = allRules.filter((rule) => rule && rule.enabled === true);
  const lines = [];
  let total = 0;
  for (const rule of rules) {
    const scoped = selectedScopeTotals(summary, rule.appliesTo);
    const value = Number(rule.value) || 0;
    let deduction = 0;
    if (rule.type === PROFIT_RULE_TYPES.percentRevenue) deduction = scoped.revenueGbp * (value / 100);
    else if (rule.type === PROFIT_RULE_TYPES.fixedPerOrder) deduction = scoped.orders * value;
    else if (rule.type === PROFIT_RULE_TYPES.fixedPerPeriod) deduction = value;
    if (!Number.isFinite(deduction) || deduction <= 0) continue;
    const rounded = round2(deduction) || 0;
    total += rounded;
    lines.push({
      id: rule.id ? String(rule.id) : '',
      label: rule.name ? String(rule.name) : 'Expense',
      enabled: rule.enabled === true,
      applies_to: rule.appliesTo && rule.appliesTo.mode === 'countries' ? (rule.appliesTo.countries || []) : 'ALL',
      type: rule.type ? String(rule.type) : '',
      value,
      scoped_revenue_gbp: round2(scoped.revenueGbp) || 0,
      scoped_orders: Number(scoped.orders) || 0,
      computed_deduction_gbp: rounded,
    });
  }
  return { totalGbp: round2(total) || 0, lines };
}

function computeProfitDeductions(summary, config) {
  return computeProfitDeductionsDetailed(summary, config).total;
}

function computeCostBreakdownTotals(items) {
  const list = Array.isArray(items) ? items : [];
  let activeTotal = 0;
  let inactiveTotal = 0;
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    if (it.is_detail === true || it.parent_key != null) continue;
    const amt = Number(it.amount) || 0;
    if (it.active === true) activeTotal += amt;
    else inactiveTotal += amt;
  }
  return { activeTotal, inactiveTotal };
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
  if (labels.length <= 56) {
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
  const out = new Map(); // ymd -> { orders, revenueGbp, taxGbp }
  if (!shop) return out;
  const db = getDb();
  const rows = await db.all(
    `
      SELECT created_at, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, total_tax
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
    const taxAmount = row && row.total_tax != null ? Number(row.total_tax) : 0;
    const taxGbp = (Number.isFinite(taxAmount) && taxAmount > 0)
      ? fx.convertToGbp(taxAmount, currency, ratesToGbp)
      : 0;
    const current = out.get(ymd) || { orders: 0, revenueGbp: 0, taxGbp: 0 };
    current.orders += 1;
    current.revenueGbp += gbp;
    if (typeof taxGbp === 'number' && Number.isFinite(taxGbp) && taxGbp > 0) current.taxGbp += taxGbp;
    out.set(ymd, current);
  }
  return out;
}

async function readTruthCheckoutTaxTotalGbp(shop, startMs, endMs) {
  if (!shop) return 0;
  const db = getDb();
  const rows = await db.all(
    `
      SELECT COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_tax
      FROM orders_shopify
      WHERE shop = ?
        AND created_at >= ? AND created_at < ?
        AND ${isPaidOrderWhereClause('')}
        AND checkout_token IS NOT NULL
        AND TRIM(checkout_token) != ''
        AND total_tax IS NOT NULL
    `,
    [shop, startMs, endMs]
  );
  if (!rows || !rows.length) return 0;
  const ratesToGbp = await fx.getRatesToGbp();
  let total = 0;
  for (const row of rows) {
    const amount = row && row.total_tax != null ? Number(row.total_tax) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const gbp = fx.convertToGbp(amount, currency, ratesToGbp);
    if (typeof gbp !== 'number' || !Number.isFinite(gbp)) continue;
    total += gbp;
  }
  return round2(total) || 0;
}

async function readTruthCheckoutTaxAuditGbp(shop, startMs, endMs) {
  if (!shop) return { totalGbp: 0, rows: [] };
  const db = getDb();
  const rows = await db.all(
    `
      SELECT order_id, created_at, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_tax
      FROM orders_shopify
      WHERE shop = ?
        AND created_at >= ? AND created_at < ?
        AND ${isPaidOrderWhereClause('')}
        AND checkout_token IS NOT NULL
        AND TRIM(checkout_token) != ''
        AND total_tax IS NOT NULL
    `,
    [shop, startMs, endMs]
  );
  if (!rows || !rows.length) return { totalGbp: 0, rows: [] };
  const ratesToGbp = await fx.getRatesToGbp();
  const outRows = [];
  let total = 0;
  for (const row of rows) {
    const orderId = row && row.order_id != null ? String(row.order_id) : '';
    const ts = row && row.created_at != null ? Number(row.created_at) : null;
    const amount = row && row.total_tax != null ? Number(row.total_tax) : NaN;
    const currency = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const fxRate = currency === 'GBP' ? 1 : (ratesToGbp && typeof ratesToGbp === 'object' ? ratesToGbp[currency] : null);
    const taxGbp = (Number.isFinite(amount) && amount > 0 && Number.isFinite(Number(fxRate)) && Number(fxRate) > 0)
      ? (round2(amount * Number(fxRate)) || 0)
      : 0;
    if (taxGbp > 0) total += taxGbp;
    outRows.push({
      order_id: orderId,
      created_at: Number.isFinite(ts) ? ts : null,
      currency,
      total_tax: Number.isFinite(amount) ? amount : 0,
      fx_rate: Number.isFinite(Number(fxRate)) ? Number(fxRate) : null,
      tax_gbp: taxGbp,
    });
  }
  return { totalGbp: round2(total) || 0, rows: outRows };
}

function listHourKeysForBounds(startMs, endMs, timeZone) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const out = [];
  const seen = new Set();
  const STEP_MS = 60 * 60 * 1000;
  let ts = start;
  for (let guard = 0; guard < 72 && ts < end; guard += 1) {
    const key = hourKeyInTimeZone(ts, timeZone);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
    ts += STEP_MS;
  }
  const tailKey = hourKeyInTimeZone(Math.max(start, end - 1), timeZone);
  if (tailKey && !seen.has(tailKey)) out.push(tailKey);
  return out;
}

async function readCheckoutOrdersHourlyTimeseries(shop, startMs, endMs, timeZone) {
  const labelsHour = listHourKeysForBounds(startMs, endMs, timeZone);
  const byHour = new Map();
  for (const key of labelsHour) byHour.set(key, { orders: 0, revenueGbp: 0 });
  if (!shop) return { labelsHour, byHour };
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
  if (!rows || !rows.length) return { labelsHour, byHour };
  const ratesToGbp = await fx.getRatesToGbp();
  for (const row of rows) {
    const ts = row && row.created_at != null ? Number(row.created_at) : NaN;
    if (!Number.isFinite(ts)) continue;
    const key = hourKeyInTimeZone(ts, timeZone);
    if (!key) continue;
    const amount = row && row.total_price != null ? Number(row.total_price) : NaN;
    if (!Number.isFinite(amount)) continue;
    const currency = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const gbp = fx.convertToGbp(amount, currency, ratesToGbp);
    if (typeof gbp !== 'number' || !Number.isFinite(gbp)) continue;
    const current = byHour.get(key) || { orders: 0, revenueGbp: 0 };
    current.orders += 1;
    current.revenueGbp += gbp;
    byHour.set(key, current);
  }
  for (const key of byHour.keys()) {
    if (labelsHour.indexOf(key) < 0) labelsHour.push(key);
  }
  return { labelsHour, byHour };
}

function distributeDailySeriesToHourly(dayLabels, dayValues, hourLabels, hourlyRevenue, hourlyOrders) {
  const days = Array.isArray(dayLabels) ? dayLabels : [];
  const values = Array.isArray(dayValues) ? dayValues : [];
  const labels = Array.isArray(hourLabels) ? hourLabels : [];
  const revenue = Array.isArray(hourlyRevenue) ? hourlyRevenue : [];
  const orders = Array.isArray(hourlyOrders) ? hourlyOrders : [];
  const out = new Array(labels.length).fill(null);
  const dayToIdx = new Map();
  for (let i = 0; i < labels.length; i += 1) {
    const key = String(labels[i] || '');
    const ymd = key.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
    if (!dayToIdx.has(ymd)) dayToIdx.set(ymd, []);
    dayToIdx.get(ymd).push(i);
  }
  for (let d = 0; d < days.length; d += 1) {
    const ymd = String(days[d] || '');
    const total = toNumber(values[d]);
    if (total == null) continue;
    const idxs = dayToIdx.get(ymd) || [];
    if (!idxs.length) continue;
    let revSum = 0;
    let ordSum = 0;
    for (const i of idxs) {
      revSum += Math.max(0, Number(revenue[i]) || 0);
      ordSum += Math.max(0, Number(orders[i]) || 0);
    }
    for (const i of idxs) {
      let w = 1;
      let denom = idxs.length;
      if (revSum > 0) {
        w = Math.max(0, Number(revenue[i]) || 0);
        denom = revSum;
      } else if (ordSum > 0) {
        w = Math.max(0, Number(orders[i]) || 0);
        denom = ordSum;
      }
      const next = (Number(out[i]) || 0) + ((Number(total) || 0) * (w / Math.max(1e-9, denom)));
      out[i] = next;
    }
  }
  return out.map((v) => (toNumber(v) != null ? round2(v) : null));
}

async function readCustomerTypeTimeseries(shop, startMs, endMs, timeZone) {
  const out = new Map(); // ymd -> { newCustomers, returningCustomers }
  if (!shop) return out;
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;
  const db = getDb();
  let rows = [];
  try {
    rows = await db.all(
      `
        WITH paid AS (
          SELECT customer_id, created_at, COALESCE(NULLIF(TRIM(order_id), ''), CAST(created_at AS TEXT)) AS order_key
          FROM orders_shopify
          WHERE shop = ?
            AND created_at < ?
            AND ${isPaidOrderWhereClause('')}
            AND checkout_token IS NOT NULL
            AND TRIM(checkout_token) != ''
            AND customer_id IS NOT NULL
            AND TRIM(customer_id) != ''
        ),
        ranked AS (
          SELECT
            customer_id,
            created_at,
            ROW_NUMBER() OVER (
              PARTITION BY customer_id
              ORDER BY created_at ASC, order_key ASC
            ) AS order_seq
          FROM paid
        )
        SELECT customer_id, created_at, order_seq
        FROM ranked
        WHERE created_at >= ? AND created_at < ?
      `,
      [shop, end, start, end]
    );
  } catch (_) {
    return out;
  }
  if (!rows || !rows.length) return out;

  const daySets = new Map(); // ymd -> { newCustomers:Set, returningCustomers:Set }
  for (const row of rows) {
    const ts = row && row.created_at != null ? Number(row.created_at) : NaN;
    const customerId = row && row.customer_id != null ? String(row.customer_id).trim() : '';
    const orderSeq = row && row.order_seq != null ? Number(row.order_seq) : NaN;
    if (!Number.isFinite(ts) || !customerId || !Number.isFinite(orderSeq)) continue;
    const ymd = ymdInTimeZone(ts, timeZone);
    if (!ymd) continue;
    const current = daySets.get(ymd) || { newCustomers: new Set(), returningCustomers: new Set() };
    if (orderSeq <= 1) current.newCustomers.add(customerId);
    else current.returningCustomers.add(customerId);
    daySets.set(ymd, current);
  }

  for (const [ymd, item] of daySets.entries()) {
    out.set(ymd, {
      newCustomers: item && item.newCustomers ? item.newCustomers.size : 0,
      returningCustomers: item && item.returningCustomers ? item.returningCustomers.size : 0,
    });
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

  const requestedYear = normalizeSnapshotYear(options.year, availableYears[0] || String(nowParts.year));
  const requestedMonth = normalizeSnapshotMonth(options.month, availableMonths[0] || `${nowParts.year}-${pad2(nowParts.month)}`);
  let resolved = resolveSnapshotWindows(
    {
      mode: options.mode,
      year: requestedYear,
      month: requestedMonth,
      since: options.since,
      until: options.until,
      preset: options.preset,
    },
    nowYmd
  );
  if (resolved.mode === 'yearly' && !availableYears.includes(resolved.selectedYear)) {
    resolved = resolveSnapshotWindows({ ...options, mode: 'yearly', year: availableYears[0] || String(nowParts.year) }, nowYmd);
  }
  if (resolved.mode === 'monthly' && !availableMonths.includes(resolved.selectedMonth)) {
    resolved = resolveSnapshotWindows({ ...options, mode: 'monthly', month: availableMonths[0] || `${nowParts.year}-${pad2(nowParts.month)}` }, nowYmd);
  }

  const mode = resolved.mode;
  const preset = resolved.preset || '';
  const requestedGranularity = String(options.granularity || '').trim().toLowerCase();
  const selectedYear = resolved.selectedYear;
  const selectedMonth = resolved.selectedMonth;
  const periodLabel = resolved.periodLabel;
  const compareLabel = resolved.compareLabel;
  const compareYear = resolved.compareYear;
  const currentWindow = resolved.currentWindow;
  const previousWindow = resolved.previousWindow;
  const isSingleDayRange = !!(currentWindow && currentWindow.startYmd && currentWindow.endYmd && currentWindow.startYmd === currentWindow.endYmd);
  const useHourlySeries = requestedGranularity === 'hour' && isSingleDayRange;

  const rangeKey = rangeKeyFromYmd(currentWindow.startYmd, currentWindow.endYmd);
  const compareRangeKey = rangeKeyFromYmd(previousWindow.startYmd, previousWindow.endYmd);
  const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
  let compareBounds = store.getRangeBounds(compareRangeKey, nowMs, timeZone);
  try {
    // Match KPI behavior: when viewing "Today" (partial day), compare to yesterday for the
    // same time-of-day window (not the full previous day).
    const safeNowYmd = (resolved && resolved.nowYmd) ? String(resolved.nowYmd).slice(0, 10) : String(nowYmd || '').slice(0, 10);
    const yesterdayYmd = safeNowYmd ? ymdAddDays(safeNowYmd, -1) : '';
    const isTodaySingleDay =
      !!(currentWindow && currentWindow.startYmd && currentWindow.endYmd && currentWindow.startYmd === currentWindow.endYmd && currentWindow.endYmd === safeNowYmd);
    const isYesterdaySingleDay =
      !!(previousWindow && previousWindow.startYmd && previousWindow.endYmd && previousWindow.startYmd === previousWindow.endYmd && previousWindow.endYmd === yesterdayYmd);
    const shouldAlignSameTime =
      (rangeKey === 'today' && compareRangeKey === 'yesterday') || (isTodaySingleDay && isYesterdaySingleDay);

    if (shouldAlignSameTime && compareBounds && bounds) {
      const dur = Number(bounds.end) - Number(bounds.start);
      if (Number.isFinite(dur) && dur > 0) {
        const desiredEnd = Number(compareBounds.start) + dur;
        const clampedEnd = Math.max(Number(compareBounds.start), Math.min(desiredEnd, Number(compareBounds.end)));
        if (Number.isFinite(clampedEnd) && clampedEnd > Number(compareBounds.start)) {
          compareBounds = { start: Number(compareBounds.start), end: clampedEnd };
        }
      }
    }
  } catch (_) {}

  const startYmd = ymdInTimeZone(bounds.start, timeZone);
  const endYmd = ymdInTimeZone(Math.max(bounds.start, bounds.end - 1), timeZone);
  const compareStartYmd = ymdInTimeZone(compareBounds.start, timeZone);
  const compareEndYmd = ymdInTimeZone(Math.max(compareBounds.start, compareBounds.end - 1), timeZone);

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

  function mapSessionsTimeseries(ts) {
    const sessionsByDay = new Map();
    const convByDay = new Map();
    try {
      const labels = Array.isArray(ts && ts.labelsYmd) ? ts.labelsYmd : [];
      const sArr = Array.isArray(ts && ts.sessions) ? ts.sessions : [];
      const cArr = Array.isArray(ts && ts.conversionRate) ? ts.conversionRate : [];
      for (let i = 0; i < labels.length; i += 1) {
        const ymd = String(labels[i] || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
        const sv = toNumber(sArr[i]);
        const cv = toNumber(cArr[i]);
        if (sv != null) sessionsByDay.set(ymd, sv);
        if (cv != null) convByDay.set(ymd, cv);
      }
    } catch (_) {}
    return { sessionsByDay, convByDay };
  }

  function buildCostDailySeries({
    chartDays,
    revenueDaily,
    ordersDaily,
    taxDaily,
    cogsTotal,
    deductionsDetailed,
    adsByYmd,
    appBillsByYmd,
    paymentFeesByYmd,
    klarnaFeesByYmd,
    includeAds,
    includeAppBills,
    includePaymentFees,
    includeKlarnaFees,
    shippingTotal,
    includeShipping,
    includeTax,
  }) {
    const days = Array.isArray(chartDays) ? chartDays : [];
    const rev = Array.isArray(revenueDaily) ? revenueDaily : [];
    const ord = Array.isArray(ordersDaily) ? ordersDaily : [];
    const revTotalDaily = sumNumeric(rev);
    const ordTotalDaily = sumNumeric(ord);
    const daysCount = Math.max(1, days.length || 1);
    const cogsDaily = (toNumber(cogsTotal) != null && revTotalDaily > 0)
      ? rev.map((r) => {
        const rr = Number(r) || 0;
        return round2((Number(cogsTotal) * rr) / revTotalDaily) || 0;
      })
      : rev.map(() => 0);
    const expensesDaily = rev.map(() => 0);
    if (deductionsDetailed && Array.isArray(deductionsDetailed.lines) && deductionsDetailed.lines.length) {
      for (const line of deductionsDetailed.lines) {
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
            const w = ordTotalDaily > 0 ? (Number(ord[i]) || 0) : 1;
            expensesDaily[i] += (amt * w) / denom;
          }
        } else {
          const denom = revTotalDaily > 0 ? revTotalDaily : daysCount;
          for (let i = 0; i < expensesDaily.length; i += 1) {
            const w = revTotalDaily > 0 ? (Number(rev[i]) || 0) : 1;
            expensesDaily[i] += (amt * w) / denom;
          }
        }
      }
    }
    const adsDaily = includeAds
      ? days.map((ymd) => {
        const v = adsByYmd && adsByYmd.get ? Number(adsByYmd.get(ymd) || 0) : 0;
        return round2(v) || 0;
      })
      : days.map(() => 0);
    const appBillsDaily = includeAppBills
      ? days.map((ymd) => {
        const v = appBillsByYmd && appBillsByYmd.get ? Number(appBillsByYmd.get(ymd) || 0) : 0;
        return round2(v) || 0;
      })
      : days.map(() => 0);
    const paymentFeesDaily = includePaymentFees
      ? days.map((ymd) => {
        const v = paymentFeesByYmd && paymentFeesByYmd.get ? Number(paymentFeesByYmd.get(ymd) || 0) : 0;
        return round2(v) || 0;
      })
      : days.map(() => 0);
    const klarnaFeesDaily = includeKlarnaFees
      ? days.map((ymd) => {
        const v = klarnaFeesByYmd && klarnaFeesByYmd.get ? Number(klarnaFeesByYmd.get(ymd) || 0) : 0;
        return round2(v) || 0;
      })
      : days.map(() => 0);
    const shippingDaily = includeShipping && Number(shippingTotal) > 0 && ordTotalDaily > 0
      ? ord.map((w) => round2((Number(shippingTotal) * (Number(w) || 0)) / ordTotalDaily) || 0)
      : days.map(() => 0);
    const taxPerDay = includeTax
      ? (Array.isArray(taxDaily) ? taxDaily : []).map((v) => {
        const n = Number(v) || 0;
        return round2(n) || 0;
      })
      : days.map(() => 0);
    const costDaily = days.map((_, i) => {
      const a = Number(cogsDaily[i]) || 0;
      const b = Number(expensesDaily[i]) || 0;
      const cVal = Number(adsDaily[i]) || 0;
      const dVal = Number(appBillsDaily[i]) || 0;
      const eVal = Number(paymentFeesDaily[i]) || 0;
      const fVal = Number(klarnaFeesDaily[i]) || 0;
      const gVal = Number(shippingDaily[i]) || 0;
      const hVal = Number(taxPerDay[i]) || 0;
      return round2(a + b + cVal + dVal + eVal + fVal + gVal + hVal) || 0;
    });
    return {
      costDaily,
      adsDaily,
      appBillsDaily,
      paymentFeesDaily,
      klarnaFeesDaily,
    };
  }

  const profitRules = await readProfitRulesConfig();
  const rulesEnabled = hasEnabledProfitRules(profitRules);
  const includeGoogleAdsSpend = !!(profitRules && profitRules.integrations && profitRules.integrations.includeGoogleAdsSpend === true);
  const includeShopifyAppBills = !!(profitRules && profitRules.integrations && profitRules.integrations.includeShopifyAppBills === true);
  const includePaymentFees = !!(profitRules && profitRules.integrations && profitRules.integrations.includePaymentFees === true);
  const includeKlarnaFees = !!(profitRules && profitRules.integrations && profitRules.integrations.includeKlarnaFees === true);
  const shippingEnabled = !!(profitRules && profitRules.shipping && profitRules.shipping.enabled === true);
  const includeShopifyTaxes = !!(profitRules && profitRules.integrations && profitRules.integrations.includeShopifyTaxes === true);
  const anyCostSourceEnabled = includeGoogleAdsSpend || includeShopifyAppBills || includePaymentFees || includeKlarnaFees || includeShopifyTaxes || shippingEnabled;
  const profitConfigured = !!(profitRules && profitRules.enabled === true && (rulesEnabled || anyCostSourceEnabled));

  const [
    sessionsNowTs,
    sessionsPrevTs,
    revenue,
    orders,
    revenuePrev,
    ordersPrev,
    ordersTsMap,
    ordersPrevTsMap,
    customerNowTsMap,
    customerPrevTsMap,
    shopName,
    summaryNow,
    summaryPrev,
    cogsNowRaw,
    cogsPrevRaw,
    adsNow,
    adsPrev,
    shopifyCostsNow,
    shopifyCostsPrev,
  ] = await Promise.all([
    shopifySessionsTimeseriesForBounds(bounds),
    shopifySessionsTimeseriesForBounds(compareBounds),
    shop ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, bounds.start, bounds.end) : Promise.resolve(0),
    shop ? salesTruth.getTruthCheckoutOrderCount(shop, bounds.start, bounds.end) : Promise.resolve(0),
    shop ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    shop ? salesTruth.getTruthCheckoutOrderCount(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    readCheckoutOrdersTimeseries(shop, bounds.start, bounds.end, timeZone).catch(() => new Map()),
    readCheckoutOrdersTimeseries(shop, compareBounds.start, compareBounds.end, timeZone).catch(() => new Map()),
    readCustomerTypeTimeseries(shop, bounds.start, bounds.end, timeZone).catch(() => new Map()),
    readCustomerTypeTimeseries(shop, compareBounds.start, compareBounds.end, timeZone).catch(() => new Map()),
    readShopName(shop, token).catch(() => null),
    (rulesEnabled || shippingEnabled) ? readOrderCountrySummary(shop, bounds.start, bounds.end) : Promise.resolve(null),
    (rulesEnabled || shippingEnabled) ? readOrderCountrySummary(shop, compareBounds.start, compareBounds.end) : Promise.resolve(null),
    readCogsTotalGbpFromLineItems(shop, token, bounds.start, bounds.end).catch(() => null),
    readCogsTotalGbpFromLineItems(shop, token, compareBounds.start, compareBounds.end).catch(() => null),
    readGoogleAdsSpendDailyGbp(bounds.start, bounds.end, timeZone).catch(() => ({ totalGbp: 0, byYmd: new Map(), totalClicks: 0, clicksByYmd: new Map() })),
    readGoogleAdsSpendDailyGbp(compareBounds.start, compareBounds.end, timeZone).catch(() => ({ totalGbp: 0, byYmd: new Map(), totalClicks: 0, clicksByYmd: new Map() })),
    readShopifyBalanceCostsGbp(shop, token, startYmd, endYmd, timeZone).catch(() => ({
      available: false,
      error: 'shopify_cost_lookup_failed',
      paymentFeesTotalGbp: 0,
      shopifyFeesTotalGbp: 0,
      klarnaFeesTotalGbp: 0,
      appBillsTotalGbp: 0,
      paymentFeesByYmd: new Map(),
      shopifyFeesByYmd: new Map(),
      klarnaFeesByYmd: new Map(),
      appBillsByYmd: new Map(),
      diagnostics: null,
    })),
    readShopifyBalanceCostsGbp(shop, token, compareStartYmd, compareEndYmd, timeZone).catch(() => ({
      available: false,
      error: 'shopify_cost_lookup_failed',
      paymentFeesTotalGbp: 0,
      shopifyFeesTotalGbp: 0,
      klarnaFeesTotalGbp: 0,
      appBillsTotalGbp: 0,
      paymentFeesByYmd: new Map(),
      shopifyFeesByYmd: new Map(),
      klarnaFeesByYmd: new Map(),
      appBillsByYmd: new Map(),
      diagnostics: null,
    })),
  ]);

  let sessionsNowMetrics = summarizeSessionsTimeseries(sessionsNowTs);
  if (sessionsNowMetrics.sessions == null && sessionsNowMetrics.conversionRate == null) {
    sessionsNowMetrics = await shopifySessionsForBounds(bounds);
  }
  let sessionsPrevMetrics = summarizeSessionsTimeseries(sessionsPrevTs);
  if (sessionsPrevMetrics.sessions == null && sessionsPrevMetrics.conversionRate == null) {
    sessionsPrevMetrics = await shopifySessionsForBounds(compareBounds);
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

  const chartDays = listYmdRange(startYmd, endYmd);
  const chartDaysPrev = listYmdRange(compareStartYmd, compareEndYmd);
  const nowSessionsMap = mapSessionsTimeseries(sessionsNowTs);
  const prevSessionsMap = mapSessionsTimeseries(sessionsPrevTs);
  const adsNowByYmd = adsNow && adsNow.byYmd && adsNow.byYmd.get ? adsNow.byYmd : new Map();
  const adsPrevByYmd = adsPrev && adsPrev.byYmd && adsPrev.byYmd.get ? adsPrev.byYmd : new Map();
  const adsNowClicksByYmd = adsNow && adsNow.clicksByYmd && adsNow.clicksByYmd.get ? adsNow.clicksByYmd : new Map();
  const adsPrevClicksByYmd = adsPrev && adsPrev.clicksByYmd && adsPrev.clicksByYmd.get ? adsPrev.clicksByYmd : new Map();

  function buildDailySeries(days, ordersMap, sessionMap, convMap, customerMap, spendMap, clicksMap) {
    const revenueGbp = [];
    const ordersArr = [];
    const taxGbp = [];
    const sessionsArr = [];
    const conversionRateArr = [];
    const aovArr = [];
    const newCustomersArr = [];
    const returningCustomersArr = [];
    const clicksArr = [];
    const roasArr = [];
    for (const ymd of days || []) {
      const orderRow = ordersMap && ordersMap.get ? ordersMap.get(ymd) : null;
      const rev = orderRow && orderRow.revenueGbp != null ? Number(orderRow.revenueGbp) : 0;
      const tax = orderRow && orderRow.taxGbp != null ? Number(orderRow.taxGbp) : 0;
      const ord = orderRow && orderRow.orders != null ? Number(orderRow.orders) : 0;
      const ses = sessionMap && sessionMap.has && sessionMap.has(ymd) ? toNumber(sessionMap.get(ymd)) : null;
      const conv = convMap && convMap.has && convMap.has(ymd) ? toNumber(convMap.get(ymd)) : null;
      const customerRow = customerMap && customerMap.get ? customerMap.get(ymd) : null;
      const newCustomers = customerRow && customerRow.newCustomers != null ? Number(customerRow.newCustomers) : 0;
      const returningCustomers = customerRow && customerRow.returningCustomers != null ? Number(customerRow.returningCustomers) : 0;
      const spend = spendMap && spendMap.get ? Number(spendMap.get(ymd) || 0) : 0;
      const clicks = clicksMap && clicksMap.get ? Number(clicksMap.get(ymd) || 0) : 0;
      const revSafe = round2(rev) || 0;
      const taxSafe = (Number.isFinite(tax) && tax > 0) ? (round2(tax) || 0) : 0;
      const ordSafe = Number.isFinite(ord) ? ord : 0;
      revenueGbp.push(revSafe);
      ordersArr.push(ordSafe);
      taxGbp.push(taxSafe);
      sessionsArr.push(ses);
      conversionRateArr.push(conv);
      aovArr.push(ordSafe > 0 ? (round2(revSafe / ordSafe) || 0) : null);
      newCustomersArr.push(Number.isFinite(newCustomers) ? newCustomers : 0);
      returningCustomersArr.push(Number.isFinite(returningCustomers) ? returningCustomers : 0);
      clicksArr.push(Number.isFinite(clicks) ? Math.max(0, Math.round(clicks)) : 0);
      roasArr.push(Number.isFinite(spend) && spend > 0 ? (round2(revSafe / spend) || 0) : null);
    }
    return {
      revenueGbp,
      orders: ordersArr,
      taxGbp,
      sessions: sessionsArr,
      conversionRate: conversionRateArr,
      aov: aovArr,
      newCustomers: newCustomersArr,
      returningCustomers: returningCustomersArr,
      clicks: clicksArr,
      roas: roasArr,
    };
  }

  const dailyNow = buildDailySeries(
    chartDays,
    ordersTsMap,
    nowSessionsMap.sessionsByDay,
    nowSessionsMap.convByDay,
    customerNowTsMap,
    adsNowByYmd,
    adsNowClicksByYmd
  );
  const dailyPrev = buildDailySeries(
    chartDaysPrev,
    ordersPrevTsMap,
    prevSessionsMap.sessionsByDay,
    prevSessionsMap.convByDay,
    customerPrevTsMap,
    adsPrevByYmd,
    adsPrevClicksByYmd
  );

  const deductionsNowDetailed = (rulesEnabled && summaryNow) ? computeProfitDeductionsDetailed(summaryNow, profitRules) : { total: 0, lines: [] };
  const deductionsPrevDetailed = (rulesEnabled && summaryPrev) ? computeProfitDeductionsDetailed(summaryPrev, profitRules) : { total: 0, lines: [] };

  const cogsNow = toNumber(cogsNowRaw);
  const cogsPrev = toNumber(cogsPrevRaw);
  const adsSpendNowAll = Number(adsNow && adsNow.totalGbp) || 0;
  const adsSpendPrevAll = Number(adsPrev && adsPrev.totalGbp) || 0;
  const appBillsNowAll = Number(shopifyCostsNow && shopifyCostsNow.appBillsTotalGbp) || 0;
  const appBillsPrevAll = Number(shopifyCostsPrev && shopifyCostsPrev.appBillsTotalGbp) || 0;
  const paymentFeesNowAll = Number(shopifyCostsNow && shopifyCostsNow.paymentFeesTotalGbp) || 0;
  const paymentFeesPrevAll = Number(shopifyCostsPrev && shopifyCostsPrev.paymentFeesTotalGbp) || 0;
  const shopifyFeesNowAll = Number(
    shopifyCostsNow && (shopifyCostsNow.shopifyFeesTotalGbp != null ? shopifyCostsNow.shopifyFeesTotalGbp : shopifyCostsNow.klarnaFeesTotalGbp)
  ) || 0;
  const shopifyFeesPrevAll = Number(
    shopifyCostsPrev && (shopifyCostsPrev.shopifyFeesTotalGbp != null ? shopifyCostsPrev.shopifyFeesTotalGbp : shopifyCostsPrev.klarnaFeesTotalGbp)
  ) || 0;
  const appBillsNowByYmd = shopifyCostsNow && shopifyCostsNow.appBillsByYmd && shopifyCostsNow.appBillsByYmd.get
    ? shopifyCostsNow.appBillsByYmd
    : new Map();
  const appBillsPrevByYmd = shopifyCostsPrev && shopifyCostsPrev.appBillsByYmd && shopifyCostsPrev.appBillsByYmd.get
    ? shopifyCostsPrev.appBillsByYmd
    : new Map();
  const paymentFeesNowByYmd = shopifyCostsNow && shopifyCostsNow.paymentFeesByYmd && shopifyCostsNow.paymentFeesByYmd.get
    ? shopifyCostsNow.paymentFeesByYmd
    : new Map();
  const paymentFeesPrevByYmd = shopifyCostsPrev && shopifyCostsPrev.paymentFeesByYmd && shopifyCostsPrev.paymentFeesByYmd.get
    ? shopifyCostsPrev.paymentFeesByYmd
    : new Map();
  const shopifyFeesNowByYmd = shopifyCostsNow
    && ((shopifyCostsNow.shopifyFeesByYmd && shopifyCostsNow.shopifyFeesByYmd.get) || (shopifyCostsNow.klarnaFeesByYmd && shopifyCostsNow.klarnaFeesByYmd.get))
    ? (shopifyCostsNow.shopifyFeesByYmd && shopifyCostsNow.shopifyFeesByYmd.get ? shopifyCostsNow.shopifyFeesByYmd : shopifyCostsNow.klarnaFeesByYmd)
    : new Map();
  const shopifyFeesPrevByYmd = shopifyCostsPrev
    && ((shopifyCostsPrev.shopifyFeesByYmd && shopifyCostsPrev.shopifyFeesByYmd.get) || (shopifyCostsPrev.klarnaFeesByYmd && shopifyCostsPrev.klarnaFeesByYmd.get))
    ? (shopifyCostsPrev.shopifyFeesByYmd && shopifyCostsPrev.shopifyFeesByYmd.get ? shopifyCostsPrev.shopifyFeesByYmd : shopifyCostsPrev.klarnaFeesByYmd)
    : new Map();
  const adsClicksNow = Math.max(0, Math.round(Number(adsNow && adsNow.totalClicks) || 0));
  const adsClicksPrev = Math.max(0, Math.round(Number(adsPrev && adsPrev.totalClicks) || 0));
  const customExpensesNow = rulesEnabled ? (Number(deductionsNowDetailed.total) || 0) : 0;
  const customExpensesPrev = rulesEnabled ? (Number(deductionsPrevDetailed.total) || 0) : 0;
  const adsSpendNowCost = includeGoogleAdsSpend ? adsSpendNowAll : 0;
  const adsSpendPrevCost = includeGoogleAdsSpend ? adsSpendPrevAll : 0;
  const appBillsNowCost = includeShopifyAppBills ? appBillsNowAll : 0;
  const appBillsPrevCost = includeShopifyAppBills ? appBillsPrevAll : 0;
  const paymentFeesNowCost = includePaymentFees ? paymentFeesNowAll : 0;
  const paymentFeesPrevCost = includePaymentFees ? paymentFeesPrevAll : 0;
  const shopifyFeesNowCost = includeKlarnaFees ? shopifyFeesNowAll : 0;
  const shopifyFeesPrevCost = includeKlarnaFees ? shopifyFeesPrevAll : 0;
  const shippingNowCost = shippingEnabled && summaryNow ? computeShippingCostFromSummary(summaryNow, profitRules.shipping) : 0;
  const shippingPrevCost = shippingEnabled && summaryPrev ? computeShippingCostFromSummary(summaryPrev, profitRules.shipping) : 0;
  const taxesNowAll = sumNumeric(dailyNow.taxGbp);
  const taxesPrevAll = sumNumeric(dailyPrev.taxGbp);
  const taxesNowCost = includeShopifyTaxes ? taxesNowAll : 0;
  const taxesPrevCost = includeShopifyTaxes ? taxesPrevAll : 0;
  const costNow = (cogsNow != null || customExpensesNow > 0 || adsSpendNowCost > 0 || appBillsNowCost > 0 || paymentFeesNowCost > 0 || shopifyFeesNowCost > 0 || shippingNowCost > 0 || taxesNowCost > 0)
    ? round2((cogsNow || 0) + customExpensesNow + adsSpendNowCost + appBillsNowCost + paymentFeesNowCost + shopifyFeesNowCost + shippingNowCost + taxesNowCost)
    : null;
  const costPrev = (cogsPrev != null || customExpensesPrev > 0 || adsSpendPrevCost > 0 || appBillsPrevCost > 0 || paymentFeesPrevCost > 0 || shopifyFeesPrevCost > 0 || shippingPrevCost > 0 || taxesPrevCost > 0)
    ? round2((cogsPrev || 0) + customExpensesPrev + adsSpendPrevCost + appBillsPrevCost + paymentFeesPrevCost + shopifyFeesPrevCost + shippingPrevCost + taxesPrevCost)
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
  if (includeGoogleAdsSpend || adsSpendNowCost > 0) costBreakdownNow.push({ label: 'Google Ads spend', amountGbp: round2(adsSpendNowCost) || 0 });
  if (appBillsNowCost > 0) costBreakdownNow.push({ label: 'Shopify app bills', amountGbp: round2(appBillsNowCost) || 0 });
  if (includePaymentFees || paymentFeesNowCost > 0) costBreakdownNow.push({ label: 'Transaction Fees', amountGbp: round2(paymentFeesNowCost) || 0 });
  if (shopifyFeesNowCost > 0) costBreakdownNow.push({ label: 'Shopify Fees', amountGbp: round2(shopifyFeesNowCost) || 0 });
  if (shippingNowCost > 0) costBreakdownNow.push({ label: 'Shipping', amountGbp: round2(shippingNowCost) || 0 });
  if (includeShopifyTaxes || taxesNowAll > 0) costBreakdownNow.push({ label: 'Tax', amountGbp: round2(taxesNowCost) || 0 });

  const costBreakdownPrevious = [];
  if (cogsPrev != null) costBreakdownPrevious.push({ label: 'Cost of Goods', amountGbp: round2(cogsPrev) || 0 });
  if (rulesEnabled) {
    for (const line of (deductionsPrevDetailed.lines || [])) {
      if (!line || !line.label) continue;
      const amt = Number(line.amountGbp) || 0;
      if (amt <= 0) continue;
      costBreakdownPrevious.push({ label: String(line.label), amountGbp: round2(amt) || 0 });
    }
  }
  if (includeGoogleAdsSpend || adsSpendPrevCost > 0) costBreakdownPrevious.push({ label: 'Google Ads spend', amountGbp: round2(adsSpendPrevCost) || 0 });
  if (appBillsPrevCost > 0) costBreakdownPrevious.push({ label: 'Shopify app bills', amountGbp: round2(appBillsPrevCost) || 0 });
  if (includePaymentFees || paymentFeesPrevCost > 0) costBreakdownPrevious.push({ label: 'Transaction Fees', amountGbp: round2(paymentFeesPrevCost) || 0 });
  if (shopifyFeesPrevCost > 0) costBreakdownPrevious.push({ label: 'Shopify Fees', amountGbp: round2(shopifyFeesPrevCost) || 0 });
  if (shippingPrevCost > 0) costBreakdownPrevious.push({ label: 'Shipping', amountGbp: round2(shippingPrevCost) || 0 });
  if (includeShopifyTaxes || taxesPrevAll > 0) costBreakdownPrevious.push({ label: 'Tax', amountGbp: round2(taxesPrevCost) || 0 });

  const nowCostSeries = buildCostDailySeries({
    chartDays,
    revenueDaily: dailyNow.revenueGbp,
    ordersDaily: dailyNow.orders,
    taxDaily: dailyNow.taxGbp,
    cogsTotal: cogsNow,
    deductionsDetailed: rulesEnabled ? deductionsNowDetailed : { lines: [] },
    adsByYmd: adsNowByYmd,
    appBillsByYmd: appBillsNowByYmd,
    paymentFeesByYmd: paymentFeesNowByYmd,
    klarnaFeesByYmd: shopifyFeesNowByYmd,
    includeAds: includeGoogleAdsSpend,
    includeAppBills: includeShopifyAppBills,
    includePaymentFees,
    includeKlarnaFees,
    shippingTotal: shippingNowCost,
    includeShipping: shippingEnabled,
    includeTax: includeShopifyTaxes,
  });
  const prevCostSeries = buildCostDailySeries({
    chartDays: chartDaysPrev,
    revenueDaily: dailyPrev.revenueGbp,
    ordersDaily: dailyPrev.orders,
    taxDaily: dailyPrev.taxGbp,
    cogsTotal: cogsPrev,
    deductionsDetailed: rulesEnabled ? deductionsPrevDetailed : { lines: [] },
    adsByYmd: adsPrevByYmd,
    appBillsByYmd: appBillsPrevByYmd,
    paymentFeesByYmd: paymentFeesPrevByYmd,
    klarnaFeesByYmd: shopifyFeesPrevByYmd,
    includeAds: includeGoogleAdsSpend,
    includeAppBills: includeShopifyAppBills,
    includePaymentFees,
    includeKlarnaFees,
    shippingTotal: shippingPrevCost,
    includeShipping: shippingEnabled,
    includeTax: includeShopifyTaxes,
  });
  dailyNow.costGbp = nowCostSeries.costDaily;
  dailyPrev.costGbp = prevCostSeries.costDaily;

  let series = downsampleWeekly({
    labelsYmd: chartDays,
    revenueGbp: dailyNow.revenueGbp,
    costGbp: dailyNow.costGbp,
    orders: dailyNow.orders,
    sessions: dailyNow.sessions,
    conversionRate: dailyNow.conversionRate,
  });
  let seriesPrevious = downsampleWeekly({
    labelsYmd: chartDaysPrev,
    revenueGbp: dailyPrev.revenueGbp,
    costGbp: dailyPrev.costGbp,
    orders: dailyPrev.orders,
    sessions: dailyPrev.sessions,
    conversionRate: dailyPrev.conversionRate,
  });

  if (useHourlySeries) {
    const [hourlyNowRaw, hourlyPrevRaw] = await Promise.all([
      readCheckoutOrdersHourlyTimeseries(shop, bounds.start, bounds.end, timeZone).catch(() => ({
        labelsHour: listHourKeysForBounds(bounds.start, bounds.end, timeZone),
        byHour: new Map(),
      })),
      readCheckoutOrdersHourlyTimeseries(shop, compareBounds.start, compareBounds.end, timeZone).catch(() => ({
        labelsHour: listHourKeysForBounds(compareBounds.start, compareBounds.end, timeZone),
        byHour: new Map(),
      })),
    ]);

    const buildHourlySeries = function buildHourlySeries({
      labelsHour,
      byHour,
      dayLabels,
      dailyCost,
      dailySessions,
    }) {
      const labels = Array.isArray(labelsHour) ? labelsHour : [];
      const hourMap = byHour && byHour.get ? byHour : new Map();
      const revenueGbp = labels.map((key) => round2(Number((hourMap.get(key) || {}).revenueGbp) || 0) || 0);
      const ordersArr = labels.map((key) => {
        const n = Number((hourMap.get(key) || {}).orders) || 0;
        return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
      });
      const costDistributed = distributeDailySeriesToHourly(
        dayLabels,
        dailyCost,
        labels,
        revenueGbp,
        ordersArr
      );
      const sessionsDistributed = distributeDailySeriesToHourly(
        dayLabels,
        dailySessions,
        labels,
        revenueGbp,
        ordersArr
      );
      const costGbp = costDistributed.map((v) => (toNumber(v) != null ? round2(v) || 0 : 0));
      const sessionsArr = sessionsDistributed.map((v) => toNumber(v));
      const conversionRate = labels.map((_, i) => safePercent(ordersArr[i], sessionsArr[i]));
      const aov = labels.map((_, i) => {
        const ord = Number(ordersArr[i]) || 0;
        const rev = Number(revenueGbp[i]) || 0;
        return ord > 0 ? round2(rev / ord) : null;
      });
      return {
        granularity: 'hour',
        labelsYmd: labels,
        revenueGbp,
        costGbp,
        orders: ordersArr,
        sessions: sessionsArr,
        conversionRate,
        aov,
      };
    };

    if (hourlyNowRaw && Array.isArray(hourlyNowRaw.labelsHour) && hourlyNowRaw.labelsHour.length) {
      series = buildHourlySeries({
        labelsHour: hourlyNowRaw.labelsHour,
        byHour: hourlyNowRaw.byHour,
        dayLabels: chartDays,
        dailyCost: dailyNow.costGbp,
        dailySessions: dailyNow.sessions,
      });
    }
    if (hourlyPrevRaw && Array.isArray(hourlyPrevRaw.labelsHour) && hourlyPrevRaw.labelsHour.length) {
      seriesPrevious = buildHourlySeries({
        labelsHour: hourlyPrevRaw.labelsHour,
        byHour: hourlyPrevRaw.byHour,
        dayLabels: chartDaysPrev,
        dailyCost: dailyPrev.costGbp,
        dailySessions: dailyPrev.sessions,
      });
    }
  }

  const [distinctCustomers, distinctCustomersPrev, ltvValue, ltvPrevValue, returningRaw, returningPrevRaw] = await Promise.all([
    readDistinctCustomerCount(shop, bounds.start, bounds.end),
    readDistinctCustomerCount(shop, compareBounds.start, compareBounds.end),
    mode === 'yearly' ? readLtvForYearCohort(shop, selectedYear) : readLtvForCohortRange(shop, bounds.start, bounds.end),
    mode === 'yearly'
      ? readLtvForYearCohort(shop, String(Number.isFinite(compareYear) ? compareYear : (Number(selectedYear) - 1)))
      : readLtvForCohortRange(shop, compareBounds.start, compareBounds.end),
    readReturningCustomerCountByEnd(shop, bounds.start, bounds.end),
    readReturningCustomerCountByEnd(shop, compareBounds.start, compareBounds.end),
  ]);

  const returningCustomers = toNumber(returningRaw);
  const returningCustomersPrev = toNumber(returningPrevRaw);
  const newCustomers = (toNumber(distinctCustomers) != null && returningCustomers != null)
    ? Math.max(0, (Number(distinctCustomers) || 0) - (Number(returningCustomers) || 0))
    : null;
  const newCustomersPrev = (toNumber(distinctCustomersPrev) != null && returningCustomersPrev != null)
    ? Math.max(0, (Number(distinctCustomersPrev) || 0) - (Number(returningCustomersPrev) || 0))
    : null;
  const repeatPurchaseRate = safePercent(returningCustomers, distinctCustomers);
  const repeatPurchaseRatePrev = safePercent(returningCustomersPrev, distinctCustomersPrev);

  const hasAdsMetricData = adsSpendNowAll > 0 || adsSpendPrevAll > 0 || adsClicksNow > 0 || adsClicksPrev > 0;
  const roasNow = hasAdsMetricData && adsSpendNowAll > 0 ? (round2((Number(revenue) || 0) / adsSpendNowAll) || 0) : null;
  const roasPrev = hasAdsMetricData && adsSpendPrevAll > 0 ? (round2((Number(revenuePrev) || 0) / adsSpendPrevAll) || 0) : null;

  let profitSection = {
    enabled: false,
    hasEnabledRules: false,
    hasEnabledIntegration: false,
    visible: false,
    unavailable: false,
    estimatedProfit: metric(null, null),
    netProfit: metric(null, null),
    marginPct: metric(null, null),
    deductions: metric(null, null),
  };
  try {
    profitSection.enabled = !!(profitRules && profitRules.enabled === true);
    profitSection.hasEnabledRules = rulesEnabled;
    profitSection.hasEnabledIntegration = anyCostSourceEnabled;
    if (profitConfigured) {
      const deductionsNow = (rulesEnabled ? (Number(deductionsNowDetailed.total) || 0) : 0)
        + (includeGoogleAdsSpend ? adsSpendNowAll : 0)
        + (includeShopifyAppBills ? appBillsNowAll : 0)
        + (includePaymentFees ? paymentFeesNowAll : 0)
        + (includeKlarnaFees ? shopifyFeesNowAll : 0)
        + (includeShopifyTaxes ? taxesNowAll : 0)
        + (shippingEnabled ? shippingNowCost : 0);
      const deductionsPrev = (rulesEnabled ? (Number(deductionsPrevDetailed.total) || 0) : 0)
        + (includeGoogleAdsSpend ? adsSpendPrevAll : 0)
        + (includeShopifyAppBills ? appBillsPrevAll : 0)
        + (includePaymentFees ? paymentFeesPrevAll : 0)
        + (includeKlarnaFees ? shopifyFeesPrevAll : 0)
        + (includeShopifyTaxes ? taxesPrevAll : 0)
        + (shippingEnabled ? shippingPrevCost : 0);
      const cogsNowForProfit = cogsNow != null ? (Number(cogsNow) || 0) : 0;
      const cogsPrevForProfit = cogsPrev != null ? (Number(cogsPrev) || 0) : 0;
      const totalCostNowForProfit = toNumber(costNow) != null ? (Number(costNow) || 0) : (cogsNowForProfit + deductionsNow);
      const totalCostPrevForProfit = toNumber(costPrev) != null ? (Number(costPrev) || 0) : (cogsPrevForProfit + deductionsPrev);
      const revNow = Number(revenue) || 0;
      const revPrev = Number(revenuePrev) || 0;
      const estNow = round2(revNow - totalCostNowForProfit);
      const estPrev = round2(revPrev - totalCostPrevForProfit);
      const marginNow = revNow > 0 ? round1((Number(estNow) / revNow) * 100) : null;
      const marginPrev = revPrev > 0 ? round1((Number(estPrev) / revPrev) * 100) : null;
      profitSection.visible = true;
      profitSection.unavailable = false;
      profitSection.estimatedProfit = metric(estNow, estPrev);
      // Net rules are not separate yet, so net mirrors estimated gross for now.
      profitSection.netProfit = metric(estNow, estPrev);
      profitSection.marginPct = metric(marginNow, marginPrev);
      profitSection.deductions = metric(totalCostNowForProfit, totalCostPrevForProfit);
    }
  } catch (_) {
    profitSection.unavailable = true;
  }

  const previousPeriodHasData = (
    ((toNumber(ordersPrev) || 0) > 0) ||
    ((toNumber(sessionsPrevSafe) || 0) > 0) ||
    ((toNumber(distinctCustomersPrev) || 0) > 0) ||
    ((toNumber(revenuePrev) || 0) > 0)
  );
  const prevOrNull = previousPeriodHasData
    ? function keepPrevious(value) { return toNumber(value); }
    : function clearPrevious() { return null; };
  const profitPrev = {
    estimatedProfit: prevOrNull(profitSection && profitSection.estimatedProfit && profitSection.estimatedProfit.previous),
    netProfit: prevOrNull(profitSection && profitSection.netProfit && profitSection.netProfit.previous),
    marginPct: prevOrNull(profitSection && profitSection.marginPct && profitSection.marginPct.previous),
    deductions: prevOrNull(profitSection && profitSection.deductions && profitSection.deductions.previous),
  };

  return {
    ok: true,
    shopName: shopName || null,
    mode,
    preset: preset || null,
    year: selectedYear,
    month: selectedMonth,
    periodLabel,
    compareLabel,
    rangeKey,
    series,
    seriesPrevious,
    seriesComparison: {
      granularity: series && series.granularity ? series.granularity : 'day',
      current: {
        labelsYmd: Array.isArray(series && series.labelsYmd) ? series.labelsYmd : chartDays,
        revenueGbp: Array.isArray(series && series.revenueGbp) ? series.revenueGbp : dailyNow.revenueGbp,
        costGbp: Array.isArray(series && series.costGbp) ? series.costGbp : dailyNow.costGbp,
        orders: Array.isArray(series && series.orders) ? series.orders : dailyNow.orders,
        sessions: Array.isArray(series && series.sessions) ? series.sessions : dailyNow.sessions,
        conversionRate: Array.isArray(series && series.conversionRate) ? series.conversionRate : dailyNow.conversionRate,
        aov: Array.isArray(series && series.aov) ? series.aov : dailyNow.aov,
        newCustomers: dailyNow.newCustomers,
        returningCustomers: dailyNow.returningCustomers,
        clicks: dailyNow.clicks,
        roas: dailyNow.roas,
      },
      previous: {
        labelsYmd: Array.isArray(seriesPrevious && seriesPrevious.labelsYmd) ? seriesPrevious.labelsYmd : chartDaysPrev,
        revenueGbp: Array.isArray(seriesPrevious && seriesPrevious.revenueGbp) ? seriesPrevious.revenueGbp : dailyPrev.revenueGbp,
        costGbp: Array.isArray(seriesPrevious && seriesPrevious.costGbp) ? seriesPrevious.costGbp : dailyPrev.costGbp,
        orders: Array.isArray(seriesPrevious && seriesPrevious.orders) ? seriesPrevious.orders : dailyPrev.orders,
        sessions: Array.isArray(seriesPrevious && seriesPrevious.sessions) ? seriesPrevious.sessions : dailyPrev.sessions,
        conversionRate: Array.isArray(seriesPrevious && seriesPrevious.conversionRate) ? seriesPrevious.conversionRate : dailyPrev.conversionRate,
        aov: Array.isArray(seriesPrevious && seriesPrevious.aov) ? seriesPrevious.aov : dailyPrev.aov,
        newCustomers: dailyPrev.newCustomers,
        returningCustomers: dailyPrev.returningCustomers,
        clicks: dailyPrev.clicks,
        roas: dailyPrev.roas,
      },
    },
    availableYears,
    availableMonths: availableMonthOptions,
    range: {
      start: bounds.start,
      end: bounds.end,
    },
    financial: {
      revenue: metric(revenue, prevOrNull(revenuePrev)),
      cost: metric(costNow, prevOrNull(costPrev)),
      costBreakdownNow,
      costBreakdownPrevious,
      orders: metric(orders, prevOrNull(ordersPrev)),
      aov: metric(aov, prevOrNull(aovPrev)),
      conversionRate: metric(conversionRate, prevOrNull(conversionRatePrev)),
      profit: {
        ...profitSection,
        estimatedProfit: metric(
          profitSection && profitSection.estimatedProfit && profitSection.estimatedProfit.value,
          profitPrev.estimatedProfit
        ),
        netProfit: metric(
          profitSection && profitSection.netProfit && profitSection.netProfit.value,
          profitPrev.netProfit
        ),
        marginPct: metric(
          profitSection && profitSection.marginPct && profitSection.marginPct.value,
          profitPrev.marginPct
        ),
        deductions: metric(
          profitSection && profitSection.deductions && profitSection.deductions.value,
          profitPrev.deductions
        ),
      },
    },
    performance: {
      sessions: metric(sessionsSafe, prevOrNull(sessionsPrevSafe)),
      orders: metric(orders, prevOrNull(ordersPrev)),
      conversionRate: metric(conversionRate, prevOrNull(conversionRatePrev)),
      aov: metric(aov, prevOrNull(aovPrev)),
      clicks: metric(hasAdsMetricData ? adsClicksNow : null, hasAdsMetricData ? prevOrNull(adsClicksPrev) : null),
      roas: metric(roasNow, prevOrNull(roasPrev)),
    },
    customers: {
      newCustomers: metric(newCustomers, prevOrNull(newCustomersPrev)),
      returningCustomers: metric(returningCustomers, prevOrNull(returningCustomersPrev)),
      repeatPurchaseRate: metric(repeatPurchaseRate, prevOrNull(repeatPurchaseRatePrev)),
      ltv: metric(ltvValue, prevOrNull(ltvPrevValue)),
    },
    comparison: {
      previousPeriodHasData,
    },
    sources: {
      sales: 'shopify_orders_api (orders_shopify, checkout_token only)',
      sessions: 'shopifyql (sessions)',
      costs: 'COGS + enabled profit deductions + optional integrations (Google Ads, Transaction Fees, Shopify Fees)',
      shopifyPayments: (shopifyCostsNow && shopifyCostsNow.available) || (shopifyCostsPrev && shopifyCostsPrev.available)
        ? 'shopifyPaymentsAccount.balanceTransactions'
        : 'unavailable_or_scope_missing',
      shopifyPaymentsDetail: {
        current: {
          available: !!(shopifyCostsNow && shopifyCostsNow.available),
          error: shopifyCostsNow && shopifyCostsNow.error ? String(shopifyCostsNow.error) : null,
          diagnostics: shopifyCostsNow && shopifyCostsNow.diagnostics && typeof shopifyCostsNow.diagnostics === 'object'
            ? shopifyCostsNow.diagnostics
            : null,
        },
        previous: {
          available: !!(shopifyCostsPrev && shopifyCostsPrev.available),
          error: shopifyCostsPrev && shopifyCostsPrev.error ? String(shopifyCostsPrev.error) : null,
          diagnostics: shopifyCostsPrev && shopifyCostsPrev.diagnostics && typeof shopifyCostsPrev.diagnostics === 'object'
            ? shopifyCostsPrev.diagnostics
            : null,
        },
      },
      timeZone,
      rangeYmd: { since: startYmd || null, until: endYmd || null },
      compareRangeYmd: { since: compareStartYmd || null, until: compareEndYmd || null },
    },
  };
}

async function getCostBreakdown({ rangeKey, audit } = {}) {
  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const rawRange = rangeKey != null ? String(rangeKey).trim().toLowerCase() : '';
  const safeRange = (rawRange === 'today' || rawRange === 'yesterday' || rawRange === '7d' || rawRange === '30d') ? rawRange : '7d';
  const bounds = store.getRangeBounds(safeRange, nowMs, timeZone);
  const startTs = bounds && bounds.start != null ? Number(bounds.start) : nowMs;
  const endTs = bounds && bounds.end != null ? Number(bounds.end) : nowMs;
  const auditEnabled = audit === true;

  const shop = salesTruth.resolveShopForSales('');
  const token = shop ? await salesTruth.getAccessToken(shop) : '';
  const startYmd = ymdInTimeZone(startTs, timeZone) || new Date(startTs).toISOString().slice(0, 10);
  const endYmd = ymdInTimeZone(Math.max(startTs, endTs - 1), timeZone) || new Date(Math.max(startTs, endTs - 1)).toISOString().slice(0, 10);

  const profitRules = await readProfitRulesConfig();
  const rulesList = Array.isArray(profitRules && profitRules.rules) ? profitRules.rules : [];
  const enabledRulesCount = rulesList.filter((r) => r && r.enabled === true).length;
  const rulesConfigured = rulesList.length > 0;
  const rulesWouldApply = enabledRulesCount > 0;

  const shippingCfg = profitRules && profitRules.shipping && typeof profitRules.shipping === 'object'
    ? profitRules.shipping
    : { enabled: false, worldwideDefaultGbp: 0, overrides: [] };
  const overrides = Array.isArray(shippingCfg.overrides) ? shippingCfg.overrides : [];
  const shippingConfigured = (Number(shippingCfg.worldwideDefaultGbp) || 0) > 0 || overrides.length > 0;

  const includeGoogleAdsSpend = !!(profitRules && profitRules.integrations && profitRules.integrations.includeGoogleAdsSpend === true);
  const includePaymentFees = !!(profitRules && profitRules.integrations && profitRules.integrations.includePaymentFees === true);
  const includeShopifyAppBills = !!(profitRules && profitRules.integrations && profitRules.integrations.includeShopifyAppBills === true);
  const includeShopifyTaxes = !!(profitRules && profitRules.integrations && profitRules.integrations.includeShopifyTaxes === true);
  const shippingActive = !!(shippingCfg && shippingCfg.enabled === true);
  const rulesActive = !!(profitRules && profitRules.enabled === true);

  const needsOrderSummary = !!shop && (rulesWouldApply || shippingConfigured);
  const summaryPromise = needsOrderSummary
    ? readOrderCountrySummary(shop, startTs, endTs).catch(() => null)
    : Promise.resolve(null);

  const cogsPromise = (shop && token)
    ? (auditEnabled
      ? readCogsAuditGbpFromLineItems(shop, token, startTs, endTs).catch(() => null)
      : readCogsTotalGbpFromLineItems(shop, token, startTs, endTs).catch(() => null))
    : Promise.resolve(null);

  const adsPromise = readGoogleAdsSpendDailyGbp(startTs, endTs, timeZone).catch(() => ({
    totalGbp: 0,
    byYmd: new Map(),
    totalClicks: 0,
    clicksByYmd: new Map(),
  }));

  const shopifyCostsPromise = (shop && token)
    ? readShopifyBalanceCostsGbp(shop, token, startYmd, endYmd, timeZone, auditEnabled ? { audit: true } : undefined).catch(() => ({
      available: false,
      error: 'shopify_cost_lookup_failed',
      paymentFeesTotalGbp: 0,
      shopifyFeesTotalGbp: 0,
      klarnaFeesTotalGbp: 0,
      appBillsTotalGbp: 0,
      paymentFeesByYmd: new Map(),
      shopifyFeesByYmd: new Map(),
      klarnaFeesByYmd: new Map(),
      appBillsByYmd: new Map(),
      diagnostics: null,
      ...(auditEnabled ? { audit_rows: [], audit_query: null } : {}),
    }))
    : Promise.resolve({
      available: false,
      error: 'missing_shop_or_token',
      paymentFeesTotalGbp: 0,
      shopifyFeesTotalGbp: 0,
      klarnaFeesTotalGbp: 0,
      appBillsTotalGbp: 0,
      paymentFeesByYmd: new Map(),
      shopifyFeesByYmd: new Map(),
      klarnaFeesByYmd: new Map(),
      appBillsByYmd: new Map(),
      diagnostics: null,
      ...(auditEnabled ? { audit_rows: [], audit_query: null } : {}),
    });

  const taxPromise = shop
    ? (auditEnabled
      ? readTruthCheckoutTaxAuditGbp(shop, startTs, endTs).catch(() => ({ totalGbp: 0, rows: [] }))
      : readTruthCheckoutTaxTotalGbp(shop, startTs, endTs).catch(() => 0))
    : Promise.resolve(auditEnabled ? { totalGbp: 0, rows: [] } : 0);

  const [summary, cogsRaw, ads, shopifyCosts, taxAmountRaw] = await Promise.all([
    summaryPromise,
    cogsPromise,
    adsPromise,
    shopifyCostsPromise,
    taxPromise,
  ]);

  const cogsAmount = auditEnabled
    ? (cogsRaw && typeof cogsRaw === 'object' && Number.isFinite(Number(cogsRaw.totalGbp)) ? (round2(Number(cogsRaw.totalGbp)) || 0) : null)
    : ((cogsRaw != null && Number.isFinite(Number(cogsRaw))) ? (round2(Number(cogsRaw)) || 0) : null);
  const adsAmount = round2(Number(ads && ads.totalGbp) || 0) || 0;
  const paymentFeesAmount = round2(Number(shopifyCosts && shopifyCosts.paymentFeesTotalGbp) || 0) || 0;
  const appBillsAmount = round2(Number(shopifyCosts && shopifyCosts.appBillsTotalGbp) || 0) || 0;
  const taxAmount = auditEnabled
    ? (taxAmountRaw && typeof taxAmountRaw === 'object' ? (round2(Number(taxAmountRaw.totalGbp) || 0) || 0) : 0)
    : (round2(Number(taxAmountRaw) || 0) || 0);

  const rulesDetailed = (summary && rulesWouldApply) ? computeProfitDeductionsDetailed(summary, profitRules) : { total: 0, lines: [] };
  const rulesAmount = round2(Number(rulesDetailed && rulesDetailed.total) || 0) || 0;

  const shippingAmount = (summary && shippingConfigured)
    ? computeShippingCostFromSummary(summary, { ...shippingCfg, enabled: true })
    : 0;

  const shippingDetails = [];
  if (summary && shippingConfigured) {
    const defaultGbp = Math.max(0, Number(shippingCfg.worldwideDefaultGbp) || 0);
    const enabledOverrides = (Array.isArray(overrides) ? overrides : [])
      .filter((o) => o && o.enabled !== false)
      .map((o, idx) => {
        const countries = Array.isArray(o.countries) ? o.countries : [];
        const normalized = countries.map((c) => normalizeCountryCode(c)).filter(Boolean);
        return {
          idx,
          priceGbp: Math.max(0, Number(o.priceGbp) || 0),
          countries: new Set(normalized),
          countriesLabel: normalized.join(', '),
          orders: 0,
          amountGbp: 0,
        };
      });
    const defaultBucket = { orders: 0, amountGbp: 0 };
    for (const [countryCode, data] of (summary.byCountry || new Map())) {
      const orders = Number(data && data.orders) || 0;
      if (orders <= 0) continue;
      const code = normalizeCountryCode(countryCode) || String(countryCode || '').trim().toUpperCase().slice(0, 2);
      if (!code) continue;
      let matched = null;
      for (const ov of enabledOverrides) {
        if (ov && ov.countries && ov.countries.has(code)) { matched = ov; break; }
      }
      if (matched) {
        matched.orders += orders;
        matched.amountGbp += orders * matched.priceGbp;
      } else {
        defaultBucket.orders += orders;
        defaultBucket.amountGbp += orders * defaultGbp;
      }
    }
    enabledOverrides.forEach((ov, n) => {
      const amt = round2(Number(ov.amountGbp) || 0) || 0;
      const countriesLabel = ov.countriesLabel || '';
      const label = countriesLabel ? ('Override: ' + countriesLabel) : ('Override #' + (n + 1));
      const notes = (countriesLabel ? (countriesLabel + ' · ') : '')
        + (ov.orders || 0) + ' orders × £' + (Number(ov.priceGbp) || 0).toFixed(2);
      shippingDetails.push({
        key: 'shipping_override_' + String(n + 1),
        parent_key: 'shipping',
        is_detail: true,
        label,
        configured: true,
        active: shippingActive,
        amount: amt,
        currency: 'GBP',
        notes,
      });
    });
    if (defaultBucket.orders > 0 || defaultGbp > 0) {
      const amt = round2(Number(defaultBucket.amountGbp) || 0) || 0;
      const notes = defaultBucket.orders + ' orders × £' + defaultGbp.toFixed(2);
      shippingDetails.push({
        key: 'shipping_default',
        parent_key: 'shipping',
        is_detail: true,
        label: 'Worldwide default',
        configured: defaultGbp > 0,
        active: shippingActive,
        amount: amt,
        currency: 'GBP',
        notes,
      });
    }
  }

  const ruleDetails = [];
  if (summary && rulesConfigured) {
    const normalized = normalizeProfitRulesConfigV1(profitRules);
    const list = Array.isArray(normalized && normalized.rules) ? normalized.rules : [];
    for (const rule of list) {
      if (!rule || rule.enabled !== true) continue;
      const scoped = selectedScopeTotals(summary, rule.appliesTo);
      const value = Number(rule.value) || 0;
      let deduction = 0;
      if (rule.type === PROFIT_RULE_TYPES.percentRevenue) deduction = scoped.revenueGbp * (value / 100);
      else if (rule.type === PROFIT_RULE_TYPES.fixedPerOrder) deduction = scoped.orders * value;
      else if (rule.type === PROFIT_RULE_TYPES.fixedPerPeriod) deduction = value;
      if (!Number.isFinite(deduction) || deduction < 0) deduction = 0;
      const scopeLabel = (rule.appliesTo && rule.appliesTo.mode === 'countries' && Array.isArray(rule.appliesTo.countries) && rule.appliesTo.countries.length)
        ? rule.appliesTo.countries.join(', ')
        : 'ALL';
      const typeLabel = rule.type === PROFIT_RULE_TYPES.fixedPerOrder
        ? 'Fixed per order'
        : rule.type === PROFIT_RULE_TYPES.fixedPerPeriod
          ? 'Fixed per period'
          : '% of revenue';
      const valueLabel = rule.type === PROFIT_RULE_TYPES.percentRevenue
        ? (value.toFixed(2).replace(/\.00$/, '') + '%')
        : ('£' + value.toFixed(2));
      ruleDetails.push({
        key: 'rule_' + (rule.id ? String(rule.id).slice(0, 64) : String(ruleDetails.length + 1)),
        parent_key: 'rules',
        is_detail: true,
        label: rule.name ? String(rule.name) : 'Expense',
        configured: true,
        active: rulesActive,
        amount: round2(deduction) || 0,
        currency: 'GBP',
        notes: scopeLabel + ' · ' + typeLabel + ' · ' + valueLabel,
      });
      if (ruleDetails.length >= 100) break;
    }
  }

  const shopifyBalanceAvailable = !!(shopifyCosts && shopifyCosts.available === true);
  const shopifyNote = shopifyBalanceAvailable ? '' : (shopifyCosts && shopifyCosts.error ? String(shopifyCosts.error) : 'Unavailable');

  const items = [];
  items.push({
    key: 'cogs',
    label: 'Cost of Goods',
    configured: cogsAmount != null,
    active: cogsAmount != null,
    amount: cogsAmount != null ? cogsAmount : 0,
    currency: 'GBP',
    notes: cogsAmount == null ? 'Unavailable for this range' : '',
  });
  items.push({
    key: 'google_ads',
    label: 'Google Ads spend',
    configured: includeGoogleAdsSpend || adsAmount > 0,
    active: includeGoogleAdsSpend,
    amount: adsAmount,
    currency: 'GBP',
    notes: adsAmount > 0 ? '' : 'No spend data for range',
  });
  items.push({
    key: 'transaction_fees',
    label: 'Transaction Fees',
    configured: shopifyBalanceAvailable,
    active: includePaymentFees,
    amount: paymentFeesAmount,
    currency: 'GBP',
    notes: shopifyBalanceAvailable ? (paymentFeesAmount > 0 ? '' : 'No fees in range') : shopifyNote,
  });
  items.push({
    key: 'shopify_app_bills',
    label: 'Shopify app bills',
    configured: shopifyBalanceAvailable,
    active: includeShopifyAppBills,
    amount: appBillsAmount,
    currency: 'GBP',
    notes: shopifyBalanceAvailable ? (appBillsAmount > 0 ? '' : 'No bills in range') : shopifyNote,
  });
  items.push({
    key: 'tax',
    label: 'Tax',
    configured: !!shop,
    active: includeShopifyTaxes,
    amount: taxAmount,
    currency: 'GBP',
    notes: shop ? (taxAmount > 0 ? '' : 'No tax in range') : 'Unavailable',
  });
  items.push({
    key: 'shipping',
    label: 'Shipping costs',
    configured: shippingConfigured,
    active: shippingActive,
    amount: round2(Number(shippingAmount) || 0) || 0,
    currency: 'GBP',
    notes: shippingConfigured
      ? ((Number(shippingCfg.worldwideDefaultGbp) || 0) > 0 ? 'Using worldwide default' : (overrides.length ? 'Using country overrides' : ''))
      : 'Not configured',
  });
  shippingDetails.forEach((d) => items.push(d));
  items.push({
    key: 'rules',
    label: 'Rules & adjustments',
    configured: rulesConfigured,
    active: rulesActive,
    amount: rulesAmount,
    currency: 'GBP',
    notes: rulesConfigured ? (enabledRulesCount > 0 ? (enabledRulesCount + ' rule(s) enabled') : 'No enabled rules') : 'No rules defined',
  });
  ruleDetails.forEach((d) => items.push(d));

  const parentTotals = computeCostBreakdownTotals(items);
  const activeTotal = parentTotals.activeTotal;
  const inactiveTotal = parentTotals.inactiveTotal;

  const auditDebug = auditEnabled ? (() => {
    const shippingAudit = (summary && shippingConfigured)
      ? computeShippingCostAuditFromSummary(summary, { ...shippingCfg, enabled: true }, { assertSingleSource: true })
      : { totalGbp: 0, lines: [] };
    const rulesAudit = (summary && rulesConfigured)
      ? computeProfitDeductionsAudit(summary, profitRules)
      : { totalGbp: 0, lines: [] };

    const adsDays = [];
    const adsBy = ads && ads.byYmd && ads.byYmd.entries ? ads.byYmd : new Map();
    const clicksBy = ads && ads.clicksByYmd && ads.clicksByYmd.entries ? ads.clicksByYmd : new Map();
    for (const [day, spend] of adsBy.entries()) {
      adsDays.push({
        day: String(day),
        spend_gbp: round2(spend) || 0,
        clicks: Math.max(0, Math.round(Number(clicksBy.get(day) || 0) || 0)),
        daily_total: round2(spend) || 0,
      });
    }
    adsDays.sort((a, b) => a.day.localeCompare(b.day));

    const oldTotalsIncludingDetails = (() => {
      let a = 0;
      let i = 0;
      for (const it of items) {
        const amt = Number(it && it.amount) || 0;
        if (it && it.active === true) a += amt;
        else i += amt;
      }
      return { activeTotal: round2(a) || 0, inactiveTotal: round2(i) || 0 };
    })();

    const cogsLines = (cogsRaw && typeof cogsRaw === 'object' && Array.isArray(cogsRaw.lines)) ? cogsRaw.lines : [];
    const taxRows = (taxAmountRaw && typeof taxAmountRaw === 'object' && Array.isArray(taxAmountRaw.rows)) ? taxAmountRaw.rows : [];
    const txRows = (shopifyCosts && Array.isArray(shopifyCosts.audit_rows)) ? shopifyCosts.audit_rows : [];

    const sumRows = (rows, field, predicate) => {
      const list = Array.isArray(rows) ? rows : [];
      let total = 0;
      for (const r of list) {
        if (predicate && !predicate(r)) continue;
        const n = Number(r && r[field]);
        if (!Number.isFinite(n)) continue;
        total += n;
      }
      return round2(total) || 0;
    };

    const truth = {
      cogs_gbp: sumRows(cogsLines, 'line_total_gbp'),
      ads_gbp: sumRows(adsDays, 'spend_gbp'),
      payment_fees_gbp: sumRows(txRows, 'fee_gbp', (r) => String(r && r.classification || '').includes('payment_fee')),
      app_bills_gbp: (() => {
        let total = 0;
        for (const r of txRows) {
          if (!String(r && r.classification || '').includes('app_bill')) continue;
          const n = Number(r && r.net_gbp);
          if (!Number.isFinite(n) || n === 0) continue;
          total += Math.abs(n);
        }
        return round2(total) || 0;
      })(),
      tax_gbp: sumRows(taxRows, 'tax_gbp'),
      shipping_gbp: sumRows(shippingAudit.lines, 'subtotal_gbp'),
      rules_gbp: sumRows(rulesAudit.lines, 'computed_deduction_gbp'),
    };

    const existing = {
      cogs_gbp: cogsAmount != null ? (round2(cogsAmount) || 0) : null,
      ads_gbp: adsAmount,
      payment_fees_gbp: paymentFeesAmount,
      app_bills_gbp: appBillsAmount,
      tax_gbp: taxAmount,
      shipping_gbp: round2(Number(shippingAmount) || 0) || 0,
      rules_gbp: rulesAmount,
    };

    const truthChecks = {};
    const mismatches = [];
    for (const key of Object.keys(truth)) {
      const ex = existing[key];
      const tr = truth[key];
      const delta = (ex == null) ? null : (round2(tr - ex) || 0);
      truthChecks[key] = { existing_gbp: ex, recomputed_gbp: tr, delta_gbp: delta };
      if (delta != null && Math.abs(delta) > 0.01) {
        mismatches.push({ key, existing_gbp: ex, recomputed_gbp: tr, delta_gbp: delta });
      }
    }

    return {
      meta: {
        range_key: safeRange,
        start_ts: startTs,
        end_ts: endTs,
        window: '[start_ts, end_ts)',
        time_zone: timeZone,
        start_ymd: startYmd,
        end_ymd: endYmd,
      },
      sources: {
        cogs: 'orders_shopify_line_items(order_created_at) + Shopify GraphQL variant inventoryItem.unitCost',
        ads: 'google_ads_spend_hourly(hour_ts)',
        payment_fees_and_app_bills: 'Shopify Payments balanceTransactions(query processed_at)',
        tax: 'orders_shopify(created_at,total_tax)',
        shipping: 'orders_shopify(created_at,total_price,raw_json country) + profitRules.shipping config',
        rules: 'orders_shopify(created_at,total_price,raw_json country) + profitRules.rules config',
      },
      cogs: cogsRaw && typeof cogsRaw === 'object'
        ? { lines: cogsLines }
        : { lines: [] },
      ads: { days: adsDays },
      payment_fees_and_app_bills: {
        query: shopifyCosts && shopifyCosts.audit_query ? shopifyCosts.audit_query : null,
        tx: txRows,
      },
      tax: taxAmountRaw && typeof taxAmountRaw === 'object'
        ? { rows: taxRows }
        : { rows: [] },
      shipping: {
        worldwide_default_gbp: round2(Number(shippingCfg.worldwideDefaultGbp) || 0) || 0,
        overrides_enabled: (Array.isArray(shippingCfg.overrides) ? shippingCfg.overrides : [])
          .filter((o) => o && o.enabled !== false)
          .map((o) => ({
            price_gbp: round2(Number(o.priceGbp) || 0) || 0,
            countries: Array.isArray(o.countries) ? o.countries.map((c) => normalizeCountryCode(c)).filter(Boolean) : [],
          })),
        per_country: shippingAudit.lines,
      },
      rules: { lines: rulesAudit.lines },
      totals_proof: {
        active_total_parent_only: round2(activeTotal) || 0,
        inactive_total_parent_only: round2(inactiveTotal) || 0,
        active_total_including_details: oldTotalsIncludingDetails.activeTotal,
        inactive_total_including_details: oldTotalsIncludingDetails.inactiveTotal,
      },
      truth_checks: truthChecks,
      mismatches,
    };
  })() : null;

  return {
    ok: true,
    range: {
      key: safeRange,
      start_ts: startTs,
      end_ts: endTs,
    },
    items,
    totals: {
      active_total: round2(activeTotal) || 0,
      inactive_total: round2(inactiveTotal) || 0,
      currency: 'GBP',
    },
    ...(auditEnabled ? { audit_debug: auditDebug } : {}),
  };
}

/**
 * Revenue and cost totals for a time window using Google Ads profit deduction toggles only.
 * Used for postback profit allocation: profit = order_revenue - (order_revenue / revenueGbp) * costGbp.
 * Does not mutate profit_rules_v1; reads profit_rules only for shipping/rules calculation (read-only).
 * @param {string} shop
 * @param {number} startMs
 * @param {number} endMs
 * @param {object} deductionToggles - { includeGoogleAdsSpend, includePaymentFees, includeShopifyTaxes, includeShopifyAppBills, includeShipping, includeRules }
 * @returns {Promise<{ revenueGbp: number, costGbp: number }>}
 */
async function getRevenueAndCostForGoogleAdsPostback(shop, startMs, endMs, deductionToggles) {
  const toggles = deductionToggles && typeof deductionToggles === 'object' ? deductionToggles : {};
  const timeZone = store.resolveAdminTimeZone();
  const startYmd = ymdInTimeZone(Number(startMs), timeZone) || new Date(Number(startMs)).toISOString().slice(0, 10);
  const endYmd = ymdInTimeZone(Math.max(Number(startMs), Number(endMs) - 1), timeZone) || new Date(Math.max(Number(startMs), Number(endMs) - 1)).toISOString().slice(0, 10);
  const token = shop ? await salesTruth.getAccessToken(shop) : '';

  const needsSummary = !!(toggles.includeShipping || toggles.includeRules);
  const [revenueGbp, ads, shopifyCosts, taxGbp, summary, profitRules] = await Promise.all([
    shop ? salesTruth.getTruthCheckoutSalesTotalGbp(shop, startMs, endMs) : 0,
    readGoogleAdsSpendDailyGbp(startMs, endMs, timeZone).catch(() => ({ totalGbp: 0 })),
    (shop && token) ? readShopifyBalanceCostsGbp(shop, token, startYmd, endYmd, timeZone).catch(() => ({
      paymentFeesTotalGbp: 0, appBillsTotalGbp: 0,
    })) : { paymentFeesTotalGbp: 0, appBillsTotalGbp: 0 },
    shop ? readTruthCheckoutTaxTotalGbp(shop, startMs, endMs).catch(() => 0) : 0,
    needsSummary && shop ? readOrderCountrySummary(shop, startMs, endMs).catch(() => null) : null,
    readProfitRulesConfig().catch(() => null),
  ]);

  const rev = round2(Number(revenueGbp) || 0) || 0;
  let costGbp = 0;
  if (toggles.includeGoogleAdsSpend) costGbp += round2(Number(ads && ads.totalGbp) || 0) || 0;
  if (toggles.includePaymentFees) costGbp += round2(Number(shopifyCosts && shopifyCosts.paymentFeesTotalGbp) || 0) || 0;
  if (toggles.includeShopifyTaxes) costGbp += round2(Number(taxGbp) || 0) || 0;
  if (toggles.includeShopifyAppBills) costGbp += round2(Number(shopifyCosts && shopifyCosts.appBillsTotalGbp) || 0) || 0;
  if (toggles.includeShipping && summary && profitRules && profitRules.shipping) {
    costGbp += round2(computeShippingCostFromSummary(summary, { ...profitRules.shipping, enabled: true }) || 0) || 0;
  }
  if (toggles.includeRules && summary && profitRules && hasEnabledProfitRules(profitRules)) {
    const rulesDetailed = computeProfitDeductionsDetailed(summary, profitRules);
    costGbp += round2(Number(rulesDetailed && rulesDetailed.total) || 0) || 0;
  }
  return { revenueGbp: rev, costGbp: round2(costGbp) || 0 };
}

module.exports = {
  getBusinessSnapshot,
  getCostBreakdown,
  getRevenueAndCostForGoogleAdsPostback,
  resolveSnapshotWindows,
  readShopifyBalanceCostsGbp,
  // Exposed for unit tests / audits.
  computeShippingCostFromSummary,
  computeCostBreakdownTotals,
};
