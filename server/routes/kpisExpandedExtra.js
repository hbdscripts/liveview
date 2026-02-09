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
const store = require('../store');
const reportCache = require('../reportCache');
const salesTruth = require('../salesTruth');

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
const SHOPIFY_API_VERSION = '2024-01';

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (ALLOWED_RANGE.has(r) || isDayKey || isRangeKey) return r;
  return 'today';
}

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

async function fetchExtrasFromShopifyOrdersApi(shop, accessToken, startMs, endMs) {
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

  return {
    ok: true,
    fetched,
    itemsSold: Math.trunc(itemsSold),
    ordersFulfilled: fulfilledOrderIds.size,
    returns,
  };
}

async function computeExpandedExtras(bounds, shop, accessToken) {
  const start = bounds && bounds.start != null ? Number(bounds.start) : NaN;
  const end = bounds && bounds.end != null ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { itemsSold: null, ordersFulfilled: null, returns: null };
  }

  try {
    const r = await fetchExtrasFromShopifyOrdersApi(shop, accessToken, start, end);
    if (r && r.ok) {
      return {
        itemsSold: typeof r.itemsSold === 'number' ? r.itemsSold : null,
        ordersFulfilled: typeof r.ordersFulfilled === 'number' ? r.ordersFulfilled : null,
        returns: typeof r.returns === 'number' ? r.returns : null,
      };
    }
  } catch (err) {
    // Keep logs short; callers already cache and retry.
    console.warn('[kpisExpandedExtra] Shopify fetch failed:', err && err.message ? String(err.message) : 'error');
  }

  // Fail-open: show "—" rather than misleading zeros.
  return { itemsSold: null, ordersFulfilled: null, returns: null };
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

