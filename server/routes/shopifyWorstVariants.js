/**
 * GET /api/shopify-worst-variants?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10
 * Returns worst-performing variants by traffic with zero orders (Shopify Orders + Products API).
 *
 * Notes:
 * - Uses `orders_shopify_line_items` (persisted facts) for truth orders/revenue.
 * - Sessions (clicks) come from product landing sessions (human-only).
 * - Only includes variants with zero orders, ordered by highest clicks then lowest revenue.
 */
const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const fx = require('../fx');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];
const MIN_LANDINGS = 3;
const MAX_CANDIDATE_HANDLES = 200;
const MAX_CANDIDATE_VARIANTS = 2000;
const GRAPHQL_API_VERSION = '2024-01';
const PRODUCT_HANDLE_BATCH_SIZE = 10;

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

function normalizeTitle(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || 'Unknown';
}

function extractGidId(gid, type) {
  const s = gid != null ? String(gid).trim() : '';
  if (!s) return null;
  const re = new RegExp(`/${type}/(\\d+)$`);
  const m = s.match(re);
  if (m) return m[1];
  if (/^\\d+$/.test(s)) return s;
  return null;
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

function handleFromSessionRow(row) {
  return (
    handleFromPath(row && row.first_path) ||
    normalizeHandle(row && row.first_product_handle) ||
    handleFromUrl(row && row.entry_url)
  );
}

async function fetchProductsByHandleBatch(shop, token, handles) {
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
    fields.push(
      `p${i}: productByHandle(handle: $${v}) { id legacyResourceId handle title featuredImage { url } variants(first: 100) { nodes { id legacyResourceId title } } }`
    );
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
    const productId =
      (node.legacyResourceId != null ? String(node.legacyResourceId).trim() : '') ||
      extractGidId(node.id, 'Product');
    const handleOut = normalizeHandle(node.handle) || handle;
    const title = normalizeTitle(node.title);
    const thumb = node.featuredImage && node.featuredImage.url ? String(node.featuredImage.url).trim() : null;
    const variantsRaw = node.variants && Array.isArray(node.variants.nodes) ? node.variants.nodes : [];
    const variants = [];
    for (const v of variantsRaw) {
      const vid =
        (v && v.legacyResourceId != null ? String(v.legacyResourceId).trim() : '') ||
        extractGidId(v && v.id, 'ProductVariant');
      if (!vid) continue;
      variants.push({ variant_id: vid, variant_title: v && v.title != null ? String(v.title) : null });
    }
    out.set(handle, {
      product_id: productId || null,
      handle: handleOut || null,
      title,
      thumb_url: thumb || null,
      variants,
    });
  }
  return out;
}

async function fetchProductsByHandle(shop, token, handles) {
  const list = Array.isArray(handles) ? handles : [];
  const out = new Map();
  for (let i = 0; i < list.length; i += PRODUCT_HANDLE_BATCH_SIZE) {
    const batch = list.slice(i, i + PRODUCT_HANDLE_BATCH_SIZE);
    const res = await fetchProductsByHandleBatch(shop, token, batch);
    for (const h of batch) out.set(h, res && res.has(h) ? res.get(h) : null);
  }
  return out;
}

async function getShopifyWorstVariants(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  let range = (req.query.range || 'today').toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = 'today';
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const db = getDb();
  const row = await db.get('SELECT access_token, scope FROM shop_sessions WHERE shop = ?', [shop]);
  if (!row || !row.access_token) {
    return res.status(401).json({
      error: 'No access token for this store. Install the app (complete OAuth) first.',
    });
  }

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  const token = row.access_token;

  try {
    const pageSize = clampInt(req.query.pageSize, 10, 1, 10);
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'shopify-worst-variants',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { page: req.query.page, pageSize },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        const t0 = Date.now();
        let msReconcile = 0;
        let msRows = 0;
        let msAgg = 0;
        let msMeta = 0;

        // Ensure Shopify truth cache is populated for this range (throttled).
        const tReconcile0 = Date.now();
        await salesTruth.ensureReconciled(shop, start, end, `products_${range}`);
        msReconcile = Date.now() - tReconcile0;

        const tRows0 = Date.now();
        const sessionRows = await db.all(
          `
            SELECT s.first_path, s.first_product_handle, s.entry_url
            FROM sessions s
            WHERE s.started_at >= ? AND s.started_at < ?
              AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)
              AND (
                (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
                OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
                OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
              )
          `,
          [start, end]
        );
        msRows = Date.now() - tRows0;

        const landingsByHandle = new Map();
        for (const r of sessionRows || []) {
          const h = handleFromSessionRow(r);
          if (!h) continue;
          landingsByHandle.set(h, (landingsByHandle.get(h) || 0) + 1);
        }

        const handles = Array.from(landingsByHandle.entries())
          .filter(([_, landings]) => (Number(landings) || 0) >= MIN_LANDINGS)
          .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
          .slice(0, MAX_CANDIDATE_HANDLES)
          .map(([h]) => h);

        if (!handles.length) {
          return { worstVariants: [], page: 1, pageSize, totalCount: 0 };
        }

        const tMeta0 = Date.now();
        const productsByHandle = await fetchProductsByHandle(shop, token, handles);
        msMeta = Date.now() - tMeta0;

        const tAgg0 = Date.now();
        const variantCandidates = [];
        for (const h of handles) {
          const product = productsByHandle.get(h);
          if (!product || !Array.isArray(product.variants) || !product.variants.length) continue;
          const clicks = landingsByHandle.get(h) || 0;
          for (const v of product.variants) {
            if (variantCandidates.length >= MAX_CANDIDATE_VARIANTS) break;
            if (!v || !v.variant_id) continue;
            variantCandidates.push({
              variant_id: v.variant_id,
              product_id: product.product_id || null,
              title: product.title || 'Unknown',
              variant_title: v.variant_title != null ? String(v.variant_title) : null,
              handle: product.handle || h,
              thumb_url: product.thumb_url || null,
              clicks,
            });
          }
          if (variantCandidates.length >= MAX_CANDIDATE_VARIANTS) break;
        }

        if (!variantCandidates.length) {
          return { worstVariants: [], page: 1, pageSize, totalCount: 0 };
        }

        const variantIds = Array.from(
          new Set(variantCandidates.map((v) => (v && v.variant_id ? String(v.variant_id).trim() : '')).filter(Boolean))
        );
        const salesByVariantId = new Map();
        if (variantIds.length) {
          const inSql = variantIds.map(() => '?').join(', ');
          const liRows = await db.all(
            `
              SELECT
                TRIM(variant_id) AS variant_id,
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                COUNT(DISTINCT order_id) AS orders,
                COALESCE(SUM(line_revenue), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
                AND (order_test IS NULL OR order_test = 0)
                AND order_cancelled_at IS NULL
                AND order_financial_status = 'paid'
                AND variant_id IS NOT NULL AND TRIM(variant_id) IN (${inSql})
              GROUP BY TRIM(variant_id), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
            `,
            [shop, start, end, ...variantIds]
          );
          const ratesToGbp = await fx.getRatesToGbp();
          for (const r of liRows || []) {
            const vid = r && r.variant_id != null ? String(r.variant_id).trim() : '';
            if (!vid) continue;
            const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
            const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
            const gbp = fx.convertToGbp(Number.isFinite(revRaw) ? revRaw : 0, cur, ratesToGbp);
            const amt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
            const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
            const prev = salesByVariantId.get(vid) || { orders: 0, revenueGbp: 0 };
            prev.orders += orders;
            prev.revenueGbp += amt;
            salesByVariantId.set(vid, prev);
          }
        }

        const list = variantCandidates.map((v) => {
          const vid = v && v.variant_id != null ? String(v.variant_id).trim() : '';
          const sales = vid && salesByVariantId.has(vid) ? salesByVariantId.get(vid) : { orders: 0, revenueGbp: 0 };
          const orders = sales && sales.orders != null ? Number(sales.orders) || 0 : 0;
          const revenue = Math.round((sales && sales.revenueGbp != null ? Number(sales.revenueGbp) : 0) * 100) / 100;
          const clicks = v && v.clicks != null ? Number(v.clicks) || 0 : 0;
          const cr = clicks > 0 ? Math.round((orders / clicks) * 1000) / 10 : null;
          return {
            variant_id: vid,
            product_id: v && v.product_id != null ? String(v.product_id) : '',
            title: v && v.title != null ? String(v.title) : 'Unknown',
            variant_title: v && v.variant_title != null ? String(v.variant_title) : null,
            handle: v && v.handle != null ? String(v.handle) : null,
            thumb_url: v && v.thumb_url != null ? String(v.thumb_url) : null,
            orders,
            revenue,
            clicks,
            cr,
          };
        });

        const zeroOrders = list.filter((row) => (row.orders || 0) === 0);

        zeroOrders.sort((a, b) => {
          const ac = a.clicks || 0;
          const bc = b.clicks || 0;
          if (ac !== bc) return bc - ac;
          const ar = a.revenue == null ? 0 : a.revenue;
          const br = b.revenue == null ? 0 : b.revenue;
          if (ar !== br) return ar - br;
          const at = a.title || '';
          const bt = b.title || '';
          if (at !== bt) return at.localeCompare(bt);
          const avt = a.variant_title || '';
          const bvt = b.variant_title || '';
          if (avt !== bvt) return avt.localeCompare(bvt);
          return String(a.variant_id || '').localeCompare(String(b.variant_id || ''));
        });

        const totalCount = zeroOrders.length;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const page = clampInt(req.query.page, 1, 1, totalPages);
        const startIdx = (page - 1) * pageSize;
        const pageItems = zeroOrders.slice(startIdx, startIdx + pageSize);
        msAgg = Date.now() - tAgg0;

        const t1 = Date.now();
        const totalMs = t1 - t0;
        if (req.query && (req.query.timing === '1' || totalMs > 1500)) {
          console.log(
            '[shopify-worst-variants] range=%s page=%s ms_total=%s ms_reconcile=%s ms_rows=%s ms_meta=%s ms_agg=%s',
            range,
            page,
            totalMs,
            msReconcile,
            msRows,
            msMeta,
            msAgg
          );
        }

        return { worstVariants: pageItems, page, pageSize, totalCount };
      }
    );

    // Cache: Shopify-derived report; allow 15 min caching to reduce API load.
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { worstVariants: [], page: 1, pageSize, totalCount: 0 });
  } catch (err) {
    console.error('[shopify-worst-variants]', err);
    return res.status(500).json({ error: 'Failed to fetch worst variants' });
  }
}

module.exports = { getShopifyWorstVariants };

