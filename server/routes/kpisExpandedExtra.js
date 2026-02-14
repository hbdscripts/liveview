/**
 * GET /api/kpis-expanded-extra?range=... (&shop=... optional)
 *
 * Extra KPIs that are only needed when the expanded KPI grid is shown.
 *
 * IMPORTANT: These map directly to Shopify truth (Orders API), not KEXO tables:
 * - itemsSold: Shopify "Items ordered" (sum of line-item quantities for orders CREATED in range)
 * - ordersFulfilled: Shopify "Orders fulfilled" (distinct orders with fulfillments CREATED in range)
 * - returns: Shopify "Returns" value (refund transactions CREATED in range; returned as positive amount)
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

async function computeCogsFromLineItems(db, shop, accessToken, startMs, endMs) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const start = Number(startMs);
  const end = Number(endMs);
  if (!safeShop || !accessToken || !Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
  let rows = [];
  try {
    rows = await db.all(
      config.dbUrl
        ? `SELECT TRIM(COALESCE(variant_id, '')) AS variant_id,
                  UPPER(COALESCE(currency, 'GBP')) AS currency,
                  COALESCE(SUM(quantity), 0) AS qty
           FROM orders_shopify_line_items
           WHERE shop = $1 AND order_created_at >= $2 AND order_created_at < $3
             AND (order_test IS NULL OR order_test = 0) AND order_cancelled_at IS NULL AND order_financial_status = 'paid'
             AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
           GROUP BY TRIM(COALESCE(variant_id, '')), UPPER(COALESCE(currency, 'GBP'))`
        : `SELECT TRIM(COALESCE(variant_id, '')) AS variant_id,
                  UPPER(COALESCE(currency, 'GBP')) AS currency,
                  COALESCE(SUM(quantity), 0) AS qty
           FROM orders_shopify_line_items
           WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
             AND (order_test IS NULL OR order_test = 0) AND order_cancelled_at IS NULL AND order_financial_status = 'paid'
             AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
           GROUP BY TRIM(COALESCE(variant_id, '')), UPPER(COALESCE(currency, 'GBP'))`,
      [safeShop, start, end]
    );
  } catch (_) {
    return null;
  }
  const variantIds = Array.from(new Set((rows || []).map((r) => parseLegacyVariantId(r && r.variant_id)).filter(Boolean)));
  if (!variantIds.length) return 0;
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
  return Math.round(total * 100) / 100;
}

function ordersUpdatedApiUrl(shop, updatedMinIso, updatedMaxIso) {
  const params = new URLSearchParams();
  params.set('status', 'any');
  params.set('limit', '250');
  params.set('updated_at_min', updatedMinIso);
  params.set('updated_at_max', updatedMaxIso);
  // Pull only what we need (still includes nested data under these keys).
  params.set('fields', 'id,created_at,cancelled_at,test,line_items,fulfillments,refunds,currency');
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

async function fetchExtrasFromShopifyOrdersApi(db, shop, accessToken, startMs, endMs) {
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
  let itemsSold = 0;
  let returnsAmount = 0;
  const fulfilledOrderIds = new Set();

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

      // Items ordered: sum line-item quantities for orders CREATED within the selected range.
      const createdMs = parseMs(order && order.created_at);
      const cancelledAt = order && order.cancelled_at != null ? String(order.cancelled_at).trim() : '';
      const isCancelled = !!cancelledAt;
      if (!isCancelled && createdMs != null && createdMs >= start && createdMs < end) {
        itemsSold += sumLineItemQuantity(order && order.line_items);
      }

      // Orders fulfilled: count DISTINCT orders that had a fulfillment created in the selected range.
      const fulfills = Array.isArray(order && order.fulfillments) ? order.fulfillments : [];
      for (const f of fulfills) {
        const fCreated = parseMs(f && f.created_at);
        if (fCreated == null || fCreated < start || fCreated >= end) continue;
        const fStatus = f && f.status != null ? String(f.status).trim().toLowerCase() : '';
        if (fStatus === 'cancelled') continue;
        if (order && order.id != null) fulfilledOrderIds.add(String(order.id));
        break;
      }

      // Returns value: sum refund amounts for refunds CREATED in the selected range.
      const refunds = Array.isArray(order && order.refunds) ? order.refunds : [];
      for (const refund of refunds) {
        const rCreated = parseMs(refund && refund.created_at);
        if (rCreated == null || rCreated < start || rCreated >= end) continue;
        returnsAmount += sumRefundAmount(refund);
      }
    }

    nextUrl = parseNextPageUrl(res.headers.get('link'));
  }

  if (!Number.isFinite(itemsSold)) itemsSold = 0;
  if (!Number.isFinite(returnsAmount)) returnsAmount = 0;

  // Shopify UI shows Returns as negative currency; return positive amount so the UI can render "-£X".
  const returns = Math.round(Math.abs(returnsAmount) * 100) / 100;

  const cogs = await computeCogsFromLineItems(db, safeShop, accessToken, start, end);

  return {
    ok: true,
    fetched,
    itemsSold: Math.trunc(itemsSold),
    ordersFulfilled: fulfilledOrderIds.size,
    returns,
    cogs: (typeof cogs === 'number' && Number.isFinite(cogs)) ? cogs : null,
  };
}

async function computeExpandedExtras(bounds, shop, accessToken) {
  const start = bounds && bounds.start != null ? Number(bounds.start) : NaN;
  const end = bounds && bounds.end != null ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { itemsSold: null, ordersFulfilled: null, returns: null, cogs: null };
  }

  try {
    const r = await fetchExtrasFromShopifyOrdersApi(getDb(), shop, accessToken, start, end);
    if (r && r.ok) {
      return {
        itemsSold: typeof r.itemsSold === 'number' ? r.itemsSold : null,
        ordersFulfilled: typeof r.ordersFulfilled === 'number' ? r.ordersFulfilled : null,
        returns: typeof r.returns === 'number' ? r.returns : null,
        cogs: typeof r.cogs === 'number' ? r.cogs : null,
      };
    }
  } catch (err) {
    // Keep logs short; callers already cache and retry.
    console.warn('[kpisExpandedExtra] Shopify fetch failed:', err && err.message ? String(err.message) : 'error');
  }

  // Fail-open: show "—" rather than misleading zeros.
  return { itemsSold: null, ordersFulfilled: null, returns: null, cogs: null };
}

async function getKpisExpandedExtra(req, res) {
  // Not polled frequently; OK to keep cached longer.
  res.setHeader('Cache-Control', 'private, max-age=600');
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
        ttlMs: 10 * 60 * 1000,
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

        const current = await computeExpandedExtras(bounds, shop, accessToken);
        const compare = (compareEnd > compareStart)
          ? await computeExpandedExtras({ start: compareStart, end: compareEnd }, shop, accessToken)
          : null;

        return {
          ...current,
          compare: compare ? {
            itemsSold: typeof compare.itemsSold === 'number' ? compare.itemsSold : null,
            ordersFulfilled: typeof compare.ordersFulfilled === 'number' ? compare.ordersFulfilled : null,
            returns: typeof compare.returns === 'number' ? compare.returns : null,
            cogs: typeof compare.cogs === 'number' ? compare.cogs : null,
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

