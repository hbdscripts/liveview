/**
 * GET /api/shopify-best-sellers?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10&sort=rev|orders&dir=asc|desc
 * Returns best-performing *landing products* for the date range:
 * - Sessions: product landings (sessions whose first page was that product)
 * - Orders/Rev: attributed orders/revenue for those sessions (pixel or truth evidence)
 * - CR%: Orders / Sessions × 100
 *
 * Why this differs from "Shopify best sellers":
 * - Product-level conversion only makes sense when numerator + denominator share the same cohort.
 * - Breakdown tables attribute orders to session cohorts; Products uses the same approach per product landing handle.
 */

const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getShopifyBestSellers(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  let range = (req.query.range || 'today').toLowerCase();
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = 'today';
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const db = getDb();
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  const trafficMode = 'human_only';

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  try {
    const sort = (req.query.sort || 'rev').toString().trim().toLowerCase();
    const dir = (req.query.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
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

        // Truth mode needs a shop domain; keep the truth cache warm for this range.
        if (resolvedShop && reporting.ordersSource === 'orders_shopify') {
          const tReconcile0 = Date.now();
          try { await salesTruth.ensureReconciled(resolvedShop, start, end, `best_products_${range}`); } catch (_) {}
          msReconcile = Date.now() - tReconcile0;
        }

        const tCount0 = Date.now();
        const countRow = (reporting.ordersSource === 'pixel') ? await db.get(
          `
            SELECT COUNT(DISTINCT LOWER(TRIM(s.first_product_handle))) AS n
            FROM sessions s
            INNER JOIN purchases p ON p.session_id = s.session_id
            WHERE s.started_at >= ? AND s.started_at < ?
              ${botFilterSql}
              AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
              AND p.purchased_at >= ? AND p.purchased_at < ?
              ${store.purchaseFilterExcludeDuplicateH('p')}
          `,
          [start, end, start, end]
        ) : (resolvedShop ? await db.get(
          `
            SELECT COUNT(DISTINCT LOWER(TRIM(s.first_product_handle))) AS n
            FROM sessions s
            INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = ?
            INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
            WHERE s.started_at >= ? AND s.started_at < ?
              ${botFilterSql}
              AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
              AND pe.event_type IN ('checkout_completed', 'checkout_started')
              AND pe.linked_order_id IS NOT NULL AND TRIM(pe.linked_order_id) != ''
              AND o.created_at >= ? AND o.created_at < ?
              AND (o.test IS NULL OR o.test = 0)
              AND o.cancelled_at IS NULL
              AND o.financial_status = 'paid'
          `,
          [resolvedShop, start, end, start, end]
        ) : { n: 0 });
        msDbCount = Date.now() - tCount0;
        const totalCount = countRow && countRow.n != null ? Number(countRow.n) || 0 : 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const page = clampInt(req.query.page, 1, 1, totalPages);
        const offset = (page - 1) * pageSize;

        // Orders + revenue attributed to landing sessions for each handle.
        // We aggregate in SQL to avoid pulling all sessions into Node.
        const orderBy =
          sort === 'orders'
            ? `orders ${dir.toUpperCase()}, revenue ${dir.toUpperCase()}`
            : `revenue ${dir.toUpperCase()}, orders ${dir.toUpperCase()}`;

        const tAgg0 = Date.now();
        const rows = (reporting.ordersSource === 'pixel') ? await db.all(
          `
            WITH landings AS (
              SELECT LOWER(TRIM(s.first_product_handle)) AS handle, COUNT(*) AS landings
              FROM sessions s
              WHERE s.started_at >= ? AND s.started_at < ?
                ${botFilterSql}
                AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
              GROUP BY LOWER(TRIM(s.first_product_handle))
            ),
            orders_by_handle AS (
              SELECT
                LOWER(TRIM(s.first_product_handle)) AS handle,
                COUNT(DISTINCT ${store.purchaseDedupeKeySql('p')}) AS orders,
                COALESCE(SUM(p.order_total), 0) AS revenue
              FROM sessions s
              INNER JOIN purchases p ON p.session_id = s.session_id
              WHERE s.started_at >= ? AND s.started_at < ?
                ${botFilterSql}
                AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
                AND p.purchased_at >= ? AND p.purchased_at < ?
                ${store.purchaseFilterExcludeDuplicateH('p')}
              GROUP BY LOWER(TRIM(s.first_product_handle))
            )
            SELECT
              l.handle AS handle,
              l.landings AS landings,
              COALESCE(o.orders, 0) AS orders,
              COALESCE(o.revenue, 0) AS revenue
            FROM landings l
            LEFT JOIN orders_by_handle o ON o.handle = l.handle
            WHERE COALESCE(o.orders, 0) > 0
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
          `,
          [start, end, start, end, start, end, pageSize, offset]
        ) : (resolvedShop ? await db.all(
          `
            WITH landings AS (
              SELECT LOWER(TRIM(s.first_product_handle)) AS handle, COUNT(*) AS landings
              FROM sessions s
              WHERE s.started_at >= ? AND s.started_at < ?
                ${botFilterSql}
                AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
              GROUP BY LOWER(TRIM(s.first_product_handle))
            ),
            orders_dedup AS (
              SELECT DISTINCT
                LOWER(TRIM(s.first_product_handle)) AS handle,
                pe.linked_order_id AS order_id
              FROM sessions s
              INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = ?
              WHERE s.started_at >= ? AND s.started_at < ?
                ${botFilterSql}
                AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
                AND pe.event_type IN ('checkout_completed', 'checkout_started')
                AND pe.linked_order_id IS NOT NULL AND TRIM(pe.linked_order_id) != ''
            ),
            orders_by_handle AS (
              SELECT
                od.handle AS handle,
                COUNT(DISTINCT o.order_id) AS orders,
                COALESCE(SUM(o.total_price), 0) AS revenue
              FROM orders_dedup od
              INNER JOIN orders_shopify o ON o.shop = ? AND o.order_id = od.order_id
              WHERE o.created_at >= ? AND o.created_at < ?
                AND (o.test IS NULL OR o.test = 0)
                AND o.cancelled_at IS NULL
                AND o.financial_status = 'paid'
              GROUP BY od.handle
            )
            SELECT
              l.handle AS handle,
              l.landings AS landings,
              COALESCE(o.orders, 0) AS orders,
              COALESCE(o.revenue, 0) AS revenue
            FROM landings l
            LEFT JOIN orders_by_handle o ON o.handle = l.handle
            WHERE COALESCE(o.orders, 0) > 0
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
          `,
          [start, end, resolvedShop, start, end, resolvedShop, start, end, pageSize, offset]
        ) : []);
        msDbAgg = Date.now() - tAgg0;

        function titleFromHandle(handle) {
          const h = String(handle || '').trim().toLowerCase();
          if (!h) return '—';
          return h
            .replace(/[-_]+/g, ' ')
            .split(' ')
            .filter(Boolean)
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
        }

        const bestSellers = (rows || []).map((r) => {
          const handle = r && r.handle != null ? String(r.handle).trim().toLowerCase() : '';
          const clicks = r && r.landings != null ? Number(r.landings) || 0 : 0;
          const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
          const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
          const revenue = Number.isFinite(revRaw) ? Math.round(revRaw * 100) / 100 : 0;
          const cr = clicks > 0 ? Math.round((orders / clicks) * 1000) / 10 : null;
          return {
            product_id: null,
            title: titleFromHandle(handle),
            handle: handle || null,
            thumb_url: null,
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
            '[shopify-best-sellers] range=%s sort=%s dir=%s page=%s ms_total=%s ms_reconcile=%s ms_db_count=%s ms_db_agg=%s',
            range,
            sort,
            dir,
            page,
            totalMs,
            msReconcile,
            msDbCount,
            msDbAgg
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
