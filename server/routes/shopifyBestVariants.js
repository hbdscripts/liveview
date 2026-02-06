/**
 * GET /api/shopify-best-variants?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10
 * Returns best selling variants by revenue for the date range (Shopify Orders + Products API).
 */
const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');
const productMetaCache = require('../shopifyProductMetaCache');
const reportCache = require('../reportCache');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];

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

function handleFromSessionRow(row) {
  return (
    handleFromPath(row && row.first_path) ||
    normalizeHandle(row && row.first_product_handle) ||
    handleFromUrl(row && row.entry_url)
  );
}

async function getShopifyBestVariants(req, res) {
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
        endpoint: 'shopify-best-variants',
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
        let msDbCount = 0;
        let msDbAgg = 0;
        let msMeta = 0;
        // Ensure Shopify truth cache is populated for this range (throttled).
        const tReconcile0 = Date.now();
        await salesTruth.ensureReconciled(shop, start, end, `best_variants_${range}`);
        msReconcile = Date.now() - tReconcile0;

        const tCount0 = Date.now();
        const countRow = await db.get(
          `
            SELECT COUNT(DISTINCT variant_id) AS n
            FROM orders_shopify_line_items
            WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
          `,
          [shop, start, end]
        );
        msDbCount = Date.now() - tCount0;
        const totalCount = countRow && countRow.n != null ? Number(countRow.n) || 0 : 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const page = clampInt(req.query.page, 1, 1, totalPages);
        const offset = (page - 1) * pageSize;

        const tAgg0 = Date.now();
        const rows = await db.all(
          `
            SELECT
              variant_id,
              MAX(product_id) AS product_id,
              MAX(title) AS title,
              MAX(variant_title) AS variant_title,
              COALESCE(SUM(quantity), 0) AS orders,
              COALESCE(SUM(line_revenue), 0) AS revenue
            FROM orders_shopify_line_items
            WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
            GROUP BY variant_id
            ORDER BY revenue DESC, orders DESC
            LIMIT ? OFFSET ?
          `,
          [shop, start, end, pageSize, offset]
        );
        msDbAgg = Date.now() - tAgg0;

        const pageItems = (rows || []).map((r) => ({
          variant_id: r && r.variant_id != null ? String(r.variant_id) : '',
          product_id: r && r.product_id != null ? String(r.product_id) : '',
          title: r && r.title != null ? String(r.title) : 'Unknown',
          variant_title: r && r.variant_title != null ? String(r.variant_title) : null,
          orders: r && r.orders != null ? Number(r.orders) || 0 : 0,
          revenue: Math.round(((r && r.revenue != null ? Number(r.revenue) : 0) || 0) * 100) / 100,
        }));

        const tMeta0 = Date.now();
        await Promise.all(
          pageItems.map(async (v) => {
            try {
              const meta = await productMetaCache.getProductMeta(shop, token, v.product_id);
              v.handle = meta && meta.ok ? (meta.handle || null) : null;
              v.thumb_url = meta && meta.ok ? (meta.thumb_url || null) : null;
            } catch (_) {
              v.handle = null;
              v.thumb_url = null;
            }
          })
        );
        msMeta = Date.now() - tMeta0;

        // Sessions (denominator): product landings for the parent product handle (human-only).
        // Orders/Rev: Shopify truth (line items) for the variant (100% of paid orders).
        const uniqHandles = Array.from(new Set(pageItems.map((v) => (v && v.handle ? String(v.handle).trim().toLowerCase() : '')).filter(Boolean)));
        const handleSet = new Set(uniqHandles.map((h) => normalizeHandle(String(h || ''))).filter(Boolean));
        const clicksByHandle = new Map();
        if (handleSet.size) {
          const landRows = await db.all(
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
          for (const r of landRows || []) {
            const h = handleFromSessionRow(r);
            if (!h || !handleSet.has(h)) continue;
            clicksByHandle.set(h, (clicksByHandle.get(h) || 0) + 1);
          }
        }

        for (const v of pageItems) {
          const handle = v && v.handle ? String(v.handle).trim().toLowerCase() : '';
          const clicks = handle ? (clicksByHandle.get(handle) || 0) : 0;
          const orders = v && v.orders != null ? Number(v.orders) || 0 : 0;
          v.clicks = clicks;
          v.cr = clicks > 0 ? Math.round((orders / clicks) * 1000) / 10 : null;
        }

        const t1 = Date.now();
        const totalMs = t1 - t0;
        if (req.query && (req.query.timing === '1' || totalMs > 1500)) {
          console.log(
            '[shopify-best-variants] range=%s page=%s ms_total=%s ms_reconcile=%s ms_db_count=%s ms_db_agg=%s ms_meta=%s',
            range,
            page,
            totalMs,
            msReconcile,
            msDbCount,
            msDbAgg,
            msMeta
          );
        }

        return { bestVariants: pageItems, page, pageSize, totalCount };
      }
    );

    // Cache: Shopify-derived report; allow 15 min caching to reduce API load.
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { bestVariants: [], page: 1, pageSize, totalCount: 0 });
  } catch (err) {
    console.error('[shopify-best-variants]', err);
    return res.status(500).json({ error: 'Failed to fetch best variants' });
  }
}

module.exports = { getShopifyBestVariants };

