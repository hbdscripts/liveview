/**
 * GET /api/worst-products?range=today|yesterday|3d|7d&page=1&pageSize=10
 * "Worst products": products with meaningful traffic that have the lowest conversion
 * (underperformers: lots of landings, few or no sales).
 *
 * Implementation notes:
 * - We only *include* products with at least MIN_LANDINGS product landings (avoids noise).
 * - The Sessions column is product landings (sessions that started on that product).
 * - Conversion rate is Orders / Sessions × 100 (product landing conversion).
 * - Sort: worst conversion first, then most landings (so high-traffic poor converters appear first).
 */

const store = require('../store');
const { getDb } = require('../db');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 10;
/** Minimum landing sessions to include; avoids one-off visits dominating "worst" list. */
const MIN_LANDINGS = 3;
/** Cap handles processed to avoid excessive Admin API calls. */
const MAX_CANDIDATE_HANDLES = 200;

const GRAPHQL_API_VERSION = '2024-01';
const PRODUCT_BY_HANDLE_TTL_MS = 6 * 60 * 60 * 1000;
const productByHandleCache = new Map(); // key -> { fetchedAt, ttlMs, inflight, productId }
const PRODUCT_HANDLE_BATCH_SIZE = 20;

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHandle(v) {
  if (typeof v !== 'string') return null;
  const h = v.trim().toLowerCase();
  if (!h) return null;
  return h.slice(0, 128);
}

function handleFromPath(path) {
  if (typeof path !== 'string') return null;
  const m = path.match(/^\/products\/([^/?#]+)/i);
  return m ? normalizeHandle(m[1]) : null;
}

function handleFromUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return handleFromPath(u.pathname || '');
  } catch (_) {
    return handleFromPath(raw);
  }
}

function cacheKeyForProductHandle(shop, handle) {
  const s = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const h = typeof handle === 'string' ? handle.trim().toLowerCase() : '';
  return s + '|' + h;
}

async function fetchProductIdByHandle(shop, token, handle) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const h = typeof handle === 'string' ? handle.trim().toLowerCase() : '';
  if (!safeShop || !token || !h) return null;
  const url = `https://${safeShop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({
      query: `query($handle: String!) { productByHandle(handle: $handle) { id legacyResourceId handle } }`,
      variables: { handle: h },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const prod = json && json.data && json.data.productByHandle ? json.data.productByHandle : null;
  const legacy = prod && prod.legacyResourceId != null ? String(prod.legacyResourceId).trim() : '';
  if (legacy) return legacy;
  const gid = prod && prod.id != null ? prod.id : null;
  const s = gid != null ? String(gid).trim() : '';
  const m = s.match(/\/Product\/(\d+)$/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

async function fetchProductIdsByHandleBatch(shop, token, handles) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const list = Array.isArray(handles) ? handles.map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : '')).filter(Boolean) : [];
  const out = new Map();
  for (const h of list) out.set(h, null);
  if (!safeShop || !token || !list.length) return out;

  const vars = {};
  const varDecls = [];
  const fields = [];
  for (let i = 0; i < list.length; i++) {
    const v = 'h' + i;
    vars[v] = list[i];
    varDecls.push(`$${v}: String!`);
    fields.push(`p${i}: productByHandle(handle: $${v}) { id legacyResourceId handle }`);
  }
  const query = `query(${varDecls.join(', ')}) {\n${fields.join('\n')}\n}`;
  const url = `https://${safeShop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`;
  let json = null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables: vars }),
    });
    json = await res.json().catch(() => null);
    if (!res.ok) return out;
    if (json && Array.isArray(json.errors) && json.errors.length) return out;
  } catch (_) {
    return out;
  }
  const data = json && json.data ? json.data : null;
  if (!data || typeof data !== 'object') return out;
  for (let i = 0; i < list.length; i++) {
    const handle = list[i];
    const node = data['p' + i] || null;
    if (!node) continue;
    const legacy = node.legacyResourceId != null ? String(node.legacyResourceId).trim() : '';
    if (legacy) {
      out.set(handle, legacy);
      continue;
    }
    const gid = node.id != null ? String(node.id).trim() : '';
    const m = gid.match(/\/Product\/(\d+)$/);
    if (m) out.set(handle, m[1]);
  }
  return out;
}

async function getProductIdByHandleCached(shop, token, handle, { ttlMs = PRODUCT_BY_HANDLE_TTL_MS, force = false } = {}) {
  const ttl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) ? Math.max(60 * 1000, Math.min(48 * 60 * 60 * 1000, Math.trunc(ttlMs))) : PRODUCT_BY_HANDLE_TTL_MS;
  const k = cacheKeyForProductHandle(shop, handle);
  const now = Date.now();
  const entry = productByHandleCache.get(k);
  if (!force && entry && entry.productId && (now - (entry.fetchedAt || 0)) < ttl) return entry.productId;
  if (!force && entry && entry.inflight) return entry.inflight;

  const inflight = fetchProductIdByHandle(shop, token, handle)
    .then((pid) => {
      const safePid = pid != null && String(pid).trim() ? String(pid).trim() : null;
      productByHandleCache.set(k, { fetchedAt: Date.now(), ttlMs: ttl, inflight: null, productId: safePid });
      return safePid;
    })
    .catch(() => {
      const cur = productByHandleCache.get(k);
      if (cur && cur.productId) return cur.productId;
      return null;
    })
    .finally(() => {
      const cur = productByHandleCache.get(k);
      if (cur && cur.inflight === inflight) productByHandleCache.set(k, { ...cur, inflight: null });
    });

  productByHandleCache.set(k, { fetchedAt: entry ? entry.fetchedAt : 0, ttlMs: ttl, inflight, productId: entry ? entry.productId : null });
  return inflight;
}

async function getProductIdsByHandleCached(shop, token, handles, { ttlMs = PRODUCT_BY_HANDLE_TTL_MS } = {}) {
  const ttl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) ? Math.max(60 * 1000, Math.min(48 * 60 * 60 * 1000, Math.trunc(ttlMs))) : PRODUCT_BY_HANDLE_TTL_MS;
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const list = Array.isArray(handles) ? handles.map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : '')).filter(Boolean) : [];
  const out = new Map();
  const missing = [];
  const now = Date.now();

  for (const h of list) {
    const ck = cacheKeyForProductHandle(safeShop, h);
    const entry = productByHandleCache.get(ck);
    const fetchedAt = entry && entry.fetchedAt ? Number(entry.fetchedAt) : 0;
    const fresh = fetchedAt && (now - fetchedAt) < ttl;
    if (fresh && entry && Object.prototype.hasOwnProperty.call(entry, 'productId')) {
      out.set(h, entry.productId != null ? String(entry.productId).trim() : null);
    } else {
      missing.push(h);
    }
  }

  if (!safeShop || !token || !missing.length) {
    for (const h of list) if (!out.has(h)) out.set(h, null);
    return out;
  }

  for (let i = 0; i < missing.length; i += PRODUCT_HANDLE_BATCH_SIZE) {
    const batch = missing.slice(i, i + PRODUCT_HANDLE_BATCH_SIZE);
    const res = await fetchProductIdsByHandleBatch(safeShop, token, batch);
    for (const h of batch) {
      const pid = res && res.has(h) ? res.get(h) : null;
      const ck = cacheKeyForProductHandle(safeShop, h);
      productByHandleCache.set(ck, { fetchedAt: Date.now(), ttlMs: ttl, inflight: null, productId: pid != null ? String(pid).trim() : null });
      out.set(h, pid != null ? String(pid).trim() : null);
    }
  }

  for (const h of list) if (!out.has(h)) out.set(h, null);
  return out;
}

async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const lim = typeof limit === 'number' && Number.isFinite(limit) ? Math.max(1, Math.min(25, Math.floor(limit))) : 10;
  const out = new Array(list.length);
  let i = 0;
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= list.length) return;
      out[idx] = await fn(list[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(lim, list.length) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function getWorstProducts(req, res) {
  let range = (req.query.range || 'today').toString().trim().toLowerCase();
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = 'today';

  const pageSize = clampInt(req.query.pageSize ?? req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const trafficMode = 'human_only';

  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  const db = getDb();
  const botFilterSql = trafficMode === 'human_only' ? ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)' : '';

  const shop = salesTruth.resolveShopForSales('');
  const cached = await reportCache.getOrComputeJson(
    {
      shop: shop || '',
      endpoint: 'worst-products',
      rangeKey: range,
      rangeStartTs: start,
      rangeEndTs: end,
      params: { page: req.query.page, pageSize, trafficMode },
      ttlMs: 10 * 60 * 1000,
      force,
    },
    async () => {
      const t0 = Date.now();
      let msReconcile = 0;
      let msRows = 0;
      let msAgg = 0;
      if (shop) {
        // Best-effort: keep truth cache warm for this range (throttled).
        const tReconcile0 = Date.now();
        try { await salesTruth.ensureReconciled(shop, start, end, `worst_products_${range}`); } catch (_) {}
        msReconcile = Date.now() - tReconcile0;
      }

      // Session landings (human-only). We'll derive conversion from Shopify truth line items per product handle.
      const tRows0 = Date.now();
      const sessionRows = await db.all(
        `
          SELECT s.first_path, s.first_product_handle, s.entry_url
          FROM sessions s
          WHERE s.started_at >= ? AND s.started_at < ?
            ${botFilterSql}
            AND (
              (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
              OR (s.first_product_handle IS NOT NULL AND TRIM(COALESCE(s.first_product_handle, '')) != '')
              OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
            )
        `,
        [start, end]
      );
      msRows = Date.now() - tRows0;

      const tAgg0 = Date.now();
      const landingsByHandle = new Map(); // handle -> landings
      for (const r of sessionRows || []) {
        const handle =
          handleFromPath(r && r.first_path) ||
          normalizeHandle(r && r.first_product_handle) ||
          handleFromUrl(r && r.entry_url);
        if (!handle) continue;
        landingsByHandle.set(handle, (landingsByHandle.get(handle) || 0) + 1);
      }

      const handles = Array.from(landingsByHandle.entries())
        .filter(([_, landings]) => (Number(landings) || 0) >= MIN_LANDINGS)
        .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
        .slice(0, MAX_CANDIDATE_HANDLES)
        .map(([h]) => h);

      if (!handles.length || !shop) {
        msAgg = Date.now() - tAgg0;
        return {
          range,
          trafficMode,
          page: 1,
          pageSize,
          totalCount: 0,
          worstProducts: [],
        };
      }

      const token = await salesTruth.getAccessToken(shop);
      const handleToProductId = new Map(); // handle -> product_id|null
      if (token) {
        const cached = await getProductIdsByHandleCached(shop, token, handles);
        for (const h of handles) {
          handleToProductId.set(h, cached && cached.has(h) ? cached.get(h) : null);
        }
      } else {
        for (const h of handles) handleToProductId.set(h, null);
      }

      const productIds = Array.from(new Set(Array.from(handleToProductId.values()).filter(Boolean)));
      const salesByProductId = new Map(); // product_id -> { orders, revenueGbp }
      if (productIds.length) {
        const inSql = productIds.map(() => '?').join(', ');
        const liRows = await db.all(
          `
            SELECT
              TRIM(product_id) AS product_id,
              COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
              COUNT(DISTINCT order_id) AS orders,
              COALESCE(SUM(line_revenue), 0) AS revenue
            FROM orders_shopify_line_items
            WHERE shop = ?
              AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND product_id IS NOT NULL AND TRIM(product_id) IN (${inSql})
            GROUP BY TRIM(product_id), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
          `,
          [shop, start, end, ...productIds]
        );
        const ratesToGbp = await fx.getRatesToGbp();
        for (const r of liRows || []) {
          const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
          if (!pid) continue;
          const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
          const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
          const revenue = Number.isFinite(revRaw) ? revRaw : 0;
          const cur = fx.normalizeCurrency(r && r.currency) || 'GBP';
          const gbp = fx.convertToGbp(revenue, cur, ratesToGbp);
          const gbpAmt = typeof gbp === 'number' && Number.isFinite(gbp) ? gbp : 0;
          const prev = salesByProductId.get(pid) || { orders: 0, revenueGbp: 0 };
          prev.orders += orders;
          prev.revenueGbp += gbpAmt;
          salesByProductId.set(pid, prev);
        }
      }

      const list = handles.map((h) => {
        const landings = landingsByHandle.get(h) || 0;
        const pid = handleToProductId.get(h) || null;
        const sales = pid && salesByProductId.has(pid) ? salesByProductId.get(pid) : { orders: 0, revenueGbp: 0 };
        const converted = Number(sales.orders) || 0;
        const revenue = Math.round((Number(sales.revenueGbp) || 0) * 100) / 100;
        const cr = landings > 0 ? Math.round((converted / landings) * 1000) / 10 : null;
        return {
          handle: h,
          landings,
          clicks: landings,
          converted,
          conversion: cr,
          revenue,
        };
      });

      // Sort: worst conversion first, then most landings (high-traffic underperformers at top).
      list.sort((a, b) => {
        const acr = a.conversion == null ? 0 : a.conversion;
        const bcr = b.conversion == null ? 0 : b.conversion;
        if (acr !== bcr) return acr - bcr;
        if ((b.landings || 0) !== (a.landings || 0)) return (b.landings || 0) - (a.landings || 0);
        const ar = a.revenue == null ? 0 : a.revenue;
        const br = b.revenue == null ? 0 : b.revenue;
        if (ar !== br) return ar - br;
        return (a.converted - b.converted) || (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);
      });

      const totalCount = list.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      const page = clampInt(req.query.page, 1, 1, totalPages);
      const startIdx = (page - 1) * pageSize;
      const pageItems = list.slice(startIdx, startIdx + pageSize);
      msAgg = Date.now() - tAgg0;

      const t1 = Date.now();
      const totalMs = t1 - t0;
      if (req.query && (req.query.timing === '1' || totalMs > 1500)) {
        console.log(
          '[worst-products] range=%s page=%s ms_total=%s ms_reconcile=%s ms_rows=%s ms_agg=%s',
          range,
          page,
          totalMs,
          msReconcile,
          msRows,
          msAgg
        );
      }

      return {
        range,
        trafficMode,
        page,
        pageSize,
        totalCount,
        worstProducts: pageItems,
      };
    }
  );

  // Cache: worst-products is relatively expensive; allow 15 min caching.
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Vary', 'Cookie');
  res.json(cached && cached.ok ? cached.data : {
    range,
    trafficMode,
    page: 1,
    pageSize,
    totalCount: 0,
    worstProducts: [],
  });
}

module.exports = { getWorstProducts };

