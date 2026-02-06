/**
 * GET /api/shopify-best-sellers?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10
 * Returns best-performing products for the date range:
 * - Sessions: product landings (sessions whose first page was that product) from our sessions table (human-only)
 * - Orders/Rev: Shopify truth orders (100%) via orders_shopify_line_items (paid, not cancelled/test)
 * - CR%: Orders / Sessions × 100
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

async function getShopifyBestSellers(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  let range = (req.query.range || 'today').toLowerCase();
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = 'today';
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const db = getDb();
  const trafficMode = 'human_only';

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  try {
    const sort = 'rev';
    const dir = 'desc';
    const pageSize = clampInt(req.query.pageSize, 10, 1, 10);
    const resolvedShop = salesTruth.resolveShopForSales(shop);
    const botFilterSql = trafficMode === 'human_only' ? ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)' : '';
    const cached = await reportCache.getOrComputeJson(
      {
        shop: resolvedShop || shop || '',
        endpoint: 'shopify-best-sellers',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { page: req.query.page, pageSize, sort, dir },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        const t0 = Date.now();
        let msReconcile = 0;
        let msDbCount = 0;
        let msDbAgg = 0;
        let msMeta = 0;
        let msLandings = 0;

        // Keep the truth cache warm for this range (throttled inside salesTruth).
        if (resolvedShop) {
          const tReconcile0 = Date.now();
          try { await salesTruth.ensureReconciled(resolvedShop, start, end, `best_products_${range}`); } catch (_) {}
          msReconcile = Date.now() - tReconcile0;
        }
        const token = resolvedShop ? await salesTruth.getAccessToken(resolvedShop) : null;

        const tCount0 = Date.now();
        const countRow = resolvedShop ? await db.get(
          `
            SELECT COUNT(DISTINCT TRIM(product_id)) AS n
            FROM orders_shopify_line_items
            WHERE shop = ?
              AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND product_id IS NOT NULL AND TRIM(product_id) != ''
          `,
          [resolvedShop, start, end]
        ) : { n: 0 };
        msDbCount = Date.now() - tCount0;
        const totalCount = countRow && countRow.n != null ? Number(countRow.n) || 0 : 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const page = clampInt(req.query.page, 1, 1, totalPages);
        const offset = (page - 1) * pageSize;

        // Orders + revenue from Shopify truth (line items). Sessions are computed separately from our sessions table.
        const orderBy = `revenue DESC, orders DESC`;

        const tAgg0 = Date.now();
        const rows = resolvedShop ? await db.all(
          `
            SELECT
              TRIM(product_id) AS product_id,
              MAX(title) AS title,
              COUNT(DISTINCT order_id) AS orders,
              COALESCE(SUM(line_revenue), 0) AS revenue
            FROM orders_shopify_line_items
            WHERE shop = ?
              AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND product_id IS NOT NULL AND TRIM(product_id) != ''
              AND title IS NOT NULL AND TRIM(title) != ''
            GROUP BY TRIM(product_id)
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
          `,
          [resolvedShop, start, end, pageSize, offset]
        ) : [];
        msDbAgg = Date.now() - tAgg0;

        const productIds = Array.from(new Set((rows || []).map((r) => (r && r.product_id != null ? String(r.product_id).trim() : '')).filter(Boolean)));
        const metaByProductId = new Map();
        const handleByProductId = new Map();
        const thumbByProductId = new Map();
        if (resolvedShop && token && productIds.length) {
          const tMeta0 = Date.now();
          await Promise.all(
            productIds.map(async (pid) => {
              try {
                const meta = await productMetaCache.getProductMeta(resolvedShop, token, pid);
                if (meta && meta.ok) {
                  metaByProductId.set(pid, meta);
                  if (meta.handle) handleByProductId.set(pid, String(meta.handle).trim().toLowerCase());
                  if (meta.thumb_url) thumbByProductId.set(pid, String(meta.thumb_url).trim());
                }
              } catch (_) {}
            })
          );
          msMeta = Date.now() - tMeta0;
        }

        // Landings (sessions) by handle for the products we’re returning.
        const handles = Array.from(new Set(productIds.map((pid) => handleByProductId.get(pid)).filter(Boolean)));
        const handleSet = new Set(handles.map((h) => normalizeHandle(String(h || ''))).filter(Boolean));
        const clicksByHandle = new Map();
        if (handleSet.size) {
          const tLand0 = Date.now();
          const landRows = await db.all(
            `
              SELECT s.first_path, s.first_product_handle, s.entry_url
              FROM sessions s
              WHERE s.started_at >= ? AND s.started_at < ?
                ${botFilterSql}
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
          msLandings = Date.now() - tLand0;
        }

        const bestSellers = (rows || []).map((r) => {
          const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
          const title = r && r.title != null ? String(r.title).trim() : '';
          const handle = pid && handleByProductId.has(pid) ? handleByProductId.get(pid) : '';
          const thumbUrl = pid && thumbByProductId.has(pid) ? thumbByProductId.get(pid) : '';
          const clicks = handle ? (clicksByHandle.get(handle) || 0) : 0;
          const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
          const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
          const revenue = Number.isFinite(revRaw) ? Math.round(revRaw * 100) / 100 : 0;
          const cr = clicks > 0 ? Math.round((orders / clicks) * 1000) / 10 : null;
          return {
            product_id: pid || null,
            title: title || null,
            handle: handle || null,
            thumb_url: thumbUrl || null,
            orders,
            clicks,
            revenue,
            cr,
          };
        });

        const t1 = Date.now();
        const totalMs = t1 - t0;
        if (req.query && (req.query.timing === '1' || totalMs > 1500)) {
          console.log(
            '[shopify-best-sellers] range=%s sort=%s dir=%s page=%s ms_total=%s ms_reconcile=%s ms_db_count=%s ms_db_agg=%s ms_meta=%s ms_landings=%s',
            range,
            sort,
            dir,
            page,
            totalMs,
            msReconcile,
            msDbCount,
            msDbAgg,
            msMeta,
            msLandings
          );
        }

        return { bestSellers, page, pageSize, totalCount, sort, dir };
      }
    );

    // Cache: Shopify-derived report; allow 15 min caching to reduce API load.
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { bestSellers: [], page: 1, pageSize, totalCount: 0, sort, dir });
  } catch (err) {
    console.error('[shopify-best-sellers]', err);
    return res.status(500).json({ error: 'Failed to fetch best sellers' });
  }
}

module.exports = { getShopifyBestSellers };
