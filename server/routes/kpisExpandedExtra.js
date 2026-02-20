/**
 * GET /api/kpis-expanded-extra?range=... (&shop=... optional)
 *
 * Extra KPIs that are only needed when the expanded KPI grid is shown.
 *
 * - itemsSold: from orders_shopify_line_items (DB) for reliable historical data
 * - ordersFulfilled, returns: from Shopify Orders API (orders updated in range)
 * - cogs: from local line items + cached variant costs (independent of the Shopify updated-orders scan)
 */
const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const reportCache = require('../reportCache');
const salesTruth = require('../salesTruth');
const fx = require('../fx');
const { normalizeRangeKey } = require('../rangeKey');

const SHOPIFY_API_VERSION = '2024-01';
const VARIANT_COST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const variantCostCache = new Map();

function sleep(ms) {
  const n = Number(ms) || 0;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, n)));
}

function parseNextPageUrl(linkHeader) {
  if (!linkHeader || typeof linkHeader !== 'string') return null;
  if (!(linkHeader.includes('rel=\"next\"') || linkHeader.includes('rel=next'))) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel=\"?next\"?/);
  return match ? match[1] : null;
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

function parseMs(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parseMoneyAmount(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function chunkArray(arr, size) {
  const out = [];
  const n = Math.max(1, Number(size) || 1);
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
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

function ymdFromMsInTz(ms, timeZone) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '';
  try {
    // en-CA yields YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(n));
  } catch (_) {
    try {
      return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(n));
    } catch (_) {
      return '';
    }
  }
}

function ymdAddDays(ymd, deltaDays) {
  const s = String(ymd || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const y = parseInt(s.slice(0, 4), 10);
  const m = parseInt(s.slice(5, 7), 10);
  const d = parseInt(s.slice(8, 10), 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + (Number(deltaDays) || 0));
  return dt.toISOString().slice(0, 10);
}

function buildDayBounds(bounds, nowMs, timeZone) {
  const start = bounds && bounds.start != null ? Number(bounds.start) : NaN;
  const end = bounds && bounds.end != null ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const startYmd = ymdFromMsInTz(start, timeZone);
  const endYmd = ymdFromMsInTz(Math.max(start, end - 1), timeZone);
  if (!startYmd || !endYmd) return [];

  const out = [];
  let cur = startYmd;
  let guard = 0;
  while (cur && cur <= endYmd) {
    guard += 1;
    if (guard > 120) break; // safety guard
    let day = null;
    try { day = store.getRangeBounds('d:' + cur, nowMs, timeZone); } catch (_) { day = null; }
    if (day && Number.isFinite(Number(day.start)) && Number.isFinite(Number(day.end))) {
      const s = Math.max(Number(day.start), start);
      const e = Math.min(Number(day.end), end);
      if (e > s) out.push({ start: s, end: e });
    }
    if (cur === endYmd) break;
    cur = ymdAddDays(cur, 1);
  }
  return out;
}

function buildWeekBounds(dayBounds) {
  const days = Array.isArray(dayBounds) ? dayBounds : [];
  const out = [];
  for (let i = 0; i < days.length; i += 7) {
    const first = days[i];
    const last = days[Math.min(days.length - 1, i + 6)];
    const s = first && first.start != null ? Number(first.start) : NaN;
    const e = last && last.end != null ? Number(last.end) : NaN;
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ start: s, end: e });
  }
  return out;
}

function buildHourBounds(startMs, endMs, bucketMinutes) {
  const start = Number(startMs);
  const end = Number(endMs);
  const mins = Math.max(1, Math.trunc(Number(bucketMinutes) || 60));
  const step = mins * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(step) || step <= 0) return [];
  const out = [];
  let t = start;
  let guard = 0;
  while (t < end) {
    guard += 1;
    if (guard > 400) break; // safety guard
    const next = Math.min(end, t + step);
    if (next > t) out.push({ start: t, end: next });
    t = next;
  }
  return out;
}

function bucketMinutesForSingleDay(startMs, endMs) {
  const start = Number(startMs);
  const end = Number(endMs);
  const elapsedHours = (Number.isFinite(start) && Number.isFinite(end) && end > start) ? ((end - start) / (60 * 60 * 1000)) : 0;
  if (elapsedHours > 0 && elapsedHours < 4) return 15;
  if (elapsedHours >= 4 && elapsedHours < 8) return 30;
  return 60;
}

function buildBucketBounds(bounds, nowMs, timeZone) {
  const days = buildDayBounds(bounds, nowMs, timeZone);
  if (!days.length) return { bucket: 'day', bucketBounds: [] };

  const start = bounds && bounds.start != null ? Number(bounds.start) : NaN;
  const end = bounds && bounds.end != null ? Number(bounds.end) : NaN;
  const singleDay = days.length === 1 && Number.isFinite(start) && Number.isFinite(end) && end > start;

  let bucket = singleDay ? 'hour' : 'day';
  if (bucket === 'day' && days.length >= 56) bucket = 'week';

  let bucketBounds = days.slice();
  if (bucket === 'hour') {
    const mins = bucketMinutesForSingleDay(start, end);
    const hours = buildHourBounds(start, end, mins);
    if (hours.length >= 2) bucketBounds = hours;
    else bucketBounds = days.slice();
  } else if (bucket === 'week') {
    const weeks = buildWeekBounds(days);
    if (weeks.length >= 2) bucketBounds = weeks;
    else {
      bucket = 'day';
      bucketBounds = days.slice();
    }
  }

  return { bucket, bucketBounds };
}

function bucketIndexForMs(ms, bucketBounds) {
  const n = Number(ms);
  const arr = Array.isArray(bucketBounds) ? bucketBounds : [];
  if (!Number.isFinite(n) || !arr.length) return -1;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = arr[mid];
    const s = b && b.start != null ? Number(b.start) : NaN;
    const e = b && b.end != null ? Number(b.end) : NaN;
    if (!Number.isFinite(s) || !Number.isFinite(e)) return -1;
    if (n < s) hi = mid - 1;
    else if (n >= e) lo = mid + 1;
    else return mid;
  }
  return -1;
}

async function shopifyGraphqlWithRetry(shop, accessToken, query, variables, { maxRetries = 6 } = {}) {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
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

async function fetchVariantUnitCosts(shop, accessToken, variantIds) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop || !accessToken || !Array.isArray(variantIds) || !variantIds.length) return new Map();
  const normalizedIds = Array.from(new Set(
    variantIds.map(parseLegacyVariantId).filter(Boolean)
  ));
  const result = new Map();
  const missing = [];
  const now = Date.now();
  for (const vid of normalizedIds) {
    const key = `${safeShop}:${vid}`;
    const cached = variantCostCache.get(key);
    if (cached && cached.expiresAt > now && Number.isFinite(cached.amount)) {
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
    } catch (_) {}
  }
  return result;
}

async function computeCogsSeriesFromLineItems(db, shop, accessToken, bucketBounds) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const buckets = Array.isArray(bucketBounds) ? bucketBounds : [];
  if (!safeShop || !accessToken || !buckets.length) return { series: [], total: null };
  const n = buckets.length;
  const overallStart = Number(buckets[0] && buckets[0].start);
  const overallEnd = Number(buckets[n - 1] && buckets[n - 1].end);
  if (!Number.isFinite(overallStart) || !Number.isFinite(overallEnd) || overallEnd <= overallStart) {
    return { series: new Array(n).fill(0), total: null };
  }

  // Assign line items to a bucket index via CASE and group by (bucket_idx, variant_id, currency).
  const whens = buckets.map(function(b, idx) {
    return 'WHEN li.order_created_at >= ? AND li.order_created_at < ? THEN ' + String(idx);
  }).join(' ');
  const sql =
    'SELECT ' +
      '(CASE ' + whens + ' ELSE NULL END) AS bucket_idx, ' +
      'TRIM(COALESCE(li.variant_id, \'\')) AS variant_id, ' +
      'UPPER(COALESCE(li.currency, \'GBP\')) AS currency, ' +
      'COALESCE(SUM(li.quantity), 0) AS qty ' +
    'FROM orders_shopify_line_items li ' +
    'WHERE li.shop = ? AND li.order_created_at >= ? AND li.order_created_at < ? ' +
      'AND (li.order_test IS NULL OR li.order_test = 0) ' +
      'AND li.order_cancelled_at IS NULL ' +
      'AND li.order_financial_status = \'paid\' ' +
      'AND li.variant_id IS NOT NULL AND TRIM(li.variant_id) != \'\' ' +
    'GROUP BY 1, 2, 3';

  const params = [];
  for (const b of buckets) {
    params.push(Number(b.start), Number(b.end));
  }
  params.push(safeShop, overallStart, overallEnd);

  let rows = [];
  try {
    rows = await db.all(sql, params);
  } catch (_) {
    return { series: new Array(n).fill(0), total: null };
  }

  const variantIds = Array.from(new Set((rows || []).map(function(r) { return parseLegacyVariantId(r && r.variant_id); }).filter(Boolean)));
  if (!variantIds.length) return { series: new Array(n).fill(0), total: 0 };

  const ratesToGbp = await fx.getRatesToGbp();
  const costMap = await fetchVariantUnitCosts(safeShop, accessToken, variantIds);
  const series = new Array(n).fill(0);
  let total = 0;
  let matchedQty = 0;

  for (const row of (rows || [])) {
    const bucketIdx = row && row.bucket_idx != null ? parseInt(String(row.bucket_idx), 10) : NaN;
    if (!Number.isFinite(bucketIdx) || bucketIdx < 0 || bucketIdx >= n) continue;
    const vid = parseLegacyVariantId(row && row.variant_id);
    const qty = row && row.qty != null ? Number(row.qty) : NaN;
    if (!vid || !Number.isFinite(qty) || qty <= 0) continue;
    const cost = costMap.get(vid);
    if (!cost || !Number.isFinite(Number(cost.amount))) continue;
    const raw = Number(cost.amount) * qty;
    const currency = fx.normalizeCurrency(cost.currency) || fx.normalizeCurrency(row && row.currency) || 'GBP';
    const gbp = fx.convertToGbp(raw, currency, ratesToGbp);
    if (!Number.isFinite(gbp)) continue;
    series[bucketIdx] += gbp;
    total += gbp;
    matchedQty += qty;
  }

  // Keep the same semantics as the KPI total: if we couldn't match any unit costs, return null.
  if (matchedQty <= 0) return { series: series.map(() => 0), total: null };
  const seriesRounded = series.map(function(v) { return Math.round((Number(v) || 0) * 100) / 100; });
  const totalRounded = Math.round(total * 100) / 100;
  return { series: seriesRounded, total: totalRounded };
}

function ordersUpdatedApiUrl(shop, updatedMinIso, updatedMaxIso) {
  const params = new URLSearchParams();
  params.set('status', 'any');
  params.set('limit', '250');
  params.set('updated_at_min', updatedMinIso);
  params.set('updated_at_max', updatedMaxIso);
  // Pull only what we need (still includes nested data under these keys).
  // NOTE: Items ordered is DB-derived; avoid fetching `line_items` (huge payload) here.
  params.set('fields', 'id,cancelled_at,test,fulfillments,refunds');
  return `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/orders.json?` + params.toString();
}

function sumLineItemQuantity(lineItems) {
  if (!Array.isArray(lineItems) || !lineItems.length) return 0;
  let total = 0;
  for (const li of lineItems) {
    const q = li && li.quantity != null ? parseInt(String(li.quantity), 10) : NaN;
    if (Number.isFinite(q) && q > 0) total += q;
  }
  return total;
}

function sumRefundAmount(refund) {
  if (!refund || typeof refund !== 'object') return 0;
  const txs = Array.isArray(refund.transactions) ? refund.transactions : [];
  let total = 0;
  for (const tx of txs) {
    const kind = tx && tx.kind != null ? String(tx.kind).trim().toLowerCase() : '';
    const status = tx && tx.status != null ? String(tx.status).trim().toLowerCase() : '';
    if (kind !== 'refund') continue;
    if (status && status !== 'success') continue;
    const amt = parseMoneyAmount(tx && tx.amount != null ? tx.amount : null);
    if (amt != null) total += amt;
  }
  return total;
}

async function fetchExtrasFromShopifyOrdersApi(shop, accessToken, startMs, endMs, bucketBounds) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return { ok: false, error: 'missing_shop' };
  if (!accessToken) return { ok: false, error: 'missing_token' };
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false, error: 'invalid_bounds' };

  const updatedMinIso = new Date(start).toISOString();
  const updatedMaxIso = new Date(end).toISOString();

  let nextUrl = ordersUpdatedApiUrl(safeShop, updatedMinIso, updatedMaxIso);
  let fetched = 0;
  let returnsAmount = 0;
  const fulfilledOrderIds = new Set();
  const useBuckets = Array.isArray(bucketBounds) && bucketBounds.length > 0;
  const fulfilledSpark = useBuckets ? new Array(bucketBounds.length).fill(0) : null;
  const returnsSpark = useBuckets ? new Array(bucketBounds.length).fill(0) : null;

  while (nextUrl) {
    const res = await shopifyFetchWithRetry(nextUrl, accessToken, { maxRetries: 6 });
    const text = await res.text();
    if (!res.ok) {
      const err = { status: res.status, body: text ? String(text).slice(0, 300) : '' };
      return { ok: false, error: `Shopify Orders API error (HTTP ${res.status})`, details: err };
    }
    let json;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    const orders = json && Array.isArray(json.orders) ? json.orders : [];

    for (const order of orders) {
      fetched += 1;
      const isTest = !!(order && (order.test === true || order.test === 1));
      if (isTest) continue;

      const cancelledAt = order && order.cancelled_at != null ? String(order.cancelled_at).trim() : '';
      const isCancelled = !!cancelledAt;
      if (isCancelled) continue;

      // Orders fulfilled: count DISTINCT orders that had a fulfillment created in the selected range.
      const fulfills = Array.isArray(order && order.fulfillments) ? order.fulfillments : [];
      let firstFulfillMs = null;
      for (const f of fulfills) {
        const fCreated = parseMs(f && f.created_at);
        if (fCreated == null || fCreated < start || fCreated >= end) continue;
        const fStatus = f && f.status != null ? String(f.status).trim().toLowerCase() : '';
        if (fStatus === 'cancelled') continue;
        if (firstFulfillMs == null || fCreated < firstFulfillMs) firstFulfillMs = fCreated;
      }
      if (firstFulfillMs != null && order && order.id != null) {
        const oid = String(order.id);
        if (!fulfilledOrderIds.has(oid)) {
          fulfilledOrderIds.add(oid);
          if (fulfilledSpark) {
            const idx = bucketIndexForMs(firstFulfillMs, bucketBounds);
            if (idx >= 0) fulfilledSpark[idx] += 1;
          }
        }
      }

      // Returns value: sum refund amounts for refunds CREATED in the selected range.
      const refunds = Array.isArray(order && order.refunds) ? order.refunds : [];
      for (const refund of refunds) {
        const rCreated = parseMs(refund && refund.created_at);
        if (rCreated == null || rCreated < start || rCreated >= end) continue;
        const amt = sumRefundAmount(refund);
        returnsAmount += amt;
        if (returnsSpark) {
          const idx = bucketIndexForMs(rCreated, bucketBounds);
          if (idx >= 0) returnsSpark[idx] += amt;
        }
      }
    }

    nextUrl = parseNextPageUrl(res.headers.get('link'));
  }

  if (!Number.isFinite(returnsAmount)) returnsAmount = 0;

  // Shopify UI shows Returns as negative currency; return positive amount so the UI can render "-£X".
  const returns = Math.round(Math.abs(returnsAmount) * 100) / 100;
  const returnsSparkOut = returnsSpark
    ? returnsSpark.map(function(v) { return Math.round(Math.abs(Number(v) || 0) * 100) / 100; })
    : null;

  return {
    ok: true,
    fetched,
    ordersFulfilled: fulfilledOrderIds.size,
    returns,
    fulfilledSpark: fulfilledSpark,
    returnsSpark: returnsSparkOut,
  };
}

/** Returns total and sparkline from orders_shopify_refunds when available; attribution: processing_date (refund_created_at) or original_sale_date (order_processed_at). */
async function getReturnsFromDb(db, shop, startMs, endMs, bucketBounds, attribution) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  const useSaleDate = attribution === 'original_sale_date';
  const tsCol = useSaleDate ? 'order_processed_at' : 'refund_created_at';
  const buckets = Array.isArray(bucketBounds) ? bucketBounds : [];
  try {
    const sql = config.dbUrl
      ? `SELECT ${tsCol} AS ts, amount FROM orders_shopify_refunds WHERE shop = $1 AND ${tsCol} IS NOT NULL AND ${tsCol} >= $2 AND ${tsCol} < $3`
      : `SELECT ${tsCol} AS ts, amount FROM orders_shopify_refunds WHERE shop = ? AND ${tsCol} IS NOT NULL AND ${tsCol} >= ? AND ${tsCol} < ?`;
    const rows = await db.all(sql, [safeShop, startMs, endMs]);
    let total = 0;
    const spark = buckets.length ? new Array(buckets.length).fill(0) : null;
    for (const r of rows || []) {
      const amt = parseMoneyAmount(r && r.amount);
      if (amt != null) total += amt;
      if (spark && r && Number.isFinite(Number(r.ts))) {
        const idx = bucketIndexForMs(Number(r.ts), bucketBounds);
        if (idx >= 0) spark[idx] += amt || 0;
      }
    }
    const totalRounded = Math.round(Math.abs(total) * 100) / 100;
    const sparkOut = spark ? spark.map((v) => Math.round(Math.abs(Number(v) || 0) * 100) / 100) : null;
    return { total: totalRounded, spark: sparkOut };
  } catch (_) {
    return null;
  }
}

function parseReturnsRefundsAttributionFromKpiConfig(rawKpiConfig) {
  if (!rawKpiConfig || typeof rawKpiConfig !== 'string') return 'processing_date';
  try {
    const obj = JSON.parse(rawKpiConfig);
    const v = obj && obj.options && obj.options.general && obj.options.general.returnsRefundsAttribution;
    if (v === 'original_sale_date' || v === 'processing_date') return v;
  } catch (_) {}
  return 'processing_date';
}

async function getItemsSoldFromDb(db, shop, startMs, endMs) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
  try {
    const row = await db.get(
      config.dbUrl
        ? `SELECT COALESCE(SUM(li.quantity), 0) AS total
           FROM orders_shopify_line_items li
           WHERE li.shop = $1 AND li.order_created_at >= $2 AND li.order_created_at < $3
             AND (li.order_test IS NULL OR li.order_test = 0)
             AND li.order_cancelled_at IS NULL
             AND li.order_financial_status = 'paid'`
        : `SELECT COALESCE(SUM(li.quantity), 0) AS total
           FROM orders_shopify_line_items li
           WHERE li.shop = ? AND li.order_created_at >= ? AND li.order_created_at < ?
             AND (li.order_test IS NULL OR li.order_test = 0)
             AND li.order_cancelled_at IS NULL
             AND li.order_financial_status = 'paid'`,
      config.dbUrl ? [safeShop, startMs, endMs] : [safeShop, startMs, endMs]
    );
    const v = row ? Number(row.total) : 0;
    return Number.isFinite(v) ? Math.trunc(v) : null;
  } catch (_) {
    return null;
  }
}

async function computeExpandedExtras(bounds, shop, accessToken, options = {}) {
  const start = bounds && bounds.start != null ? Number(bounds.start) : NaN;
  const end = bounds && bounds.end != null ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { itemsSold: null, ordersFulfilled: null, returns: null, cogs: null, spark: null };
  }

  const db = getDb();
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const itemsSold = safeShop ? await getItemsSoldFromDb(db, safeShop, start, end) : null;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const timeZone = options && typeof options.timeZone === 'string' && options.timeZone ? options.timeZone : store.resolveAdminTimeZone();
  const bucketInfo = buildBucketBounds({ start, end }, nowMs, timeZone);
  const bucketBounds = bucketInfo && Array.isArray(bucketInfo.bucketBounds) ? bucketInfo.bucketBounds : [];

  // COGS sparkline + total from local line items (independent of Shopify updated-orders scan).
  let cogs = null;
  let cogsSpark = null;
  try {
    const r = (safeShop && bucketBounds.length) ? await computeCogsSeriesFromLineItems(db, safeShop, accessToken, bucketBounds) : { series: [], total: null };
    cogs = (typeof r.total === 'number' && Number.isFinite(r.total)) ? r.total : null;
    cogsSpark = Array.isArray(r.series) ? r.series : null;
  } catch (_) {
    cogs = null;
    cogsSpark = null;
  }

  let ordersFulfilled = null;
  let returns = null;
  let fulfilledSpark = null;
  let returnsSpark = null;
  const rawKpi = await store.getSetting('kpi_ui_config_v1');
  const returnsRefundsAttribution = parseReturnsRefundsAttributionFromKpiConfig(rawKpi);
  let returnsFromDb = null;
  try {
    returnsFromDb = await getReturnsFromDb(db, safeShop, start, end, bucketBounds, returnsRefundsAttribution);
  } catch (_) {}
  try {
    const r = await fetchExtrasFromShopifyOrdersApi(safeShop, accessToken, start, end, bucketBounds);
    if (r && r.ok) {
      ordersFulfilled = typeof r.ordersFulfilled === 'number' ? r.ordersFulfilled : null;
      fulfilledSpark = Array.isArray(r.fulfilledSpark) ? r.fulfilledSpark : null;
      returns = returnsFromDb != null && typeof returnsFromDb.total === 'number' ? returnsFromDb.total : (typeof r.returns === 'number' ? r.returns : null);
      returnsSpark = returnsFromDb != null && Array.isArray(returnsFromDb.spark) ? returnsFromDb.spark : (Array.isArray(r.returnsSpark) ? r.returnsSpark : null);
    }
  } catch (err) {
    console.warn('[kpisExpandedExtra] Shopify fetch failed:', err && err.message ? String(err.message) : 'error');
  }
  if (returns === null && returnsFromDb != null) returns = typeof returnsFromDb.total === 'number' ? returnsFromDb.total : null;
  if (returnsSpark === null && returnsFromDb != null && Array.isArray(returnsFromDb.spark)) returnsSpark = returnsFromDb.spark;

  const spark = bucketBounds.length
    ? {
        bucket: bucketInfo && bucketInfo.bucket ? String(bucketInfo.bucket) : 'day',
        cogs: Array.isArray(cogsSpark) ? cogsSpark : null,
        fulfilled: Array.isArray(fulfilledSpark) ? fulfilledSpark : null,
        returns: Array.isArray(returnsSpark) ? returnsSpark : null,
      }
    : null;

  return {
    itemsSold: typeof itemsSold === 'number' ? itemsSold : null,
    ordersFulfilled,
    returns,
    cogs,
    spark,
  };
}

async function getKpisExpandedExtra(req, res) {
  // Not polled frequently; OK to keep cached longer.
  res.setHeader('Cache-Control', 'private, max-age=1800');
  res.setHeader('Vary', 'Cookie');

  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '');
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  const shop = salesTruth.resolveShopForSales(req && req.query ? (req.query.shop || '') : '');
  let accessToken = '';
  if (shop) {
    try {
      const row = await getDb().get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
      accessToken = row && row.access_token ? String(row.access_token) : '';
    } catch (_) {
      accessToken = '';
    }
  }

  try {
    const cached = await reportCache.getOrComputeJson(
      {
        shop: shop || '',
        endpoint: 'kpisExpandedExtra',
        rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: { rangeKey, timeZone, shop: shop || '' },
        ttlMs: 30 * 60 * 1000,
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

        const current = await computeExpandedExtras(bounds, shop, accessToken, { nowMs: now, timeZone });
        const compare = (compareEnd > compareStart)
          ? await computeExpandedExtras({ start: compareStart, end: compareEnd }, shop, accessToken, { nowMs: now, timeZone })
          : null;

        return {
          ...current,
          compare: compare ? {
            itemsSold: typeof compare.itemsSold === 'number' ? compare.itemsSold : null,
            ordersFulfilled: typeof compare.ordersFulfilled === 'number' ? compare.ordersFulfilled : null,
            returns: typeof compare.returns === 'number' ? compare.returns : null,
            cogs: typeof compare.cogs === 'number' ? compare.cogs : null,
            spark: compare && compare.spark && typeof compare.spark === 'object' ? compare.spark : null,
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

