/**
 * GET /api/worst-products?range=today|yesterday|3d|7d&page=1&pageSize=10
 * "Worst products": products with meaningful traffic that have the lowest conversion
 * (underperformers: lots of landings, few or no sales).
 *
 * Implementation notes:
 * - Clicks are sessions that *started* on a product page (first_path /products/... or first_product_handle).
 * - Conversion is session-level (has_purchased=1) for those sessions.
 * - Only products with at least MIN_CLICKS landings are included (avoids noise).
 * - Sort: worst conversion first, then most clicks (so high-traffic poor converters appear first).
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
const MIN_CLICKS = 3;

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

async function getWorstProducts(req, res) {
  let range = (req.query.range || 'today').toString().trim().toLowerCase();
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey) range = 'today';

  const pageSize = clampInt(req.query.pageSize ?? req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const trafficMode = 'human_only';
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));

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
      params: { page: req.query.page, pageSize, trafficMode, reporting },
      ttlMs: 10 * 60 * 1000,
      force,
    },
    async () => {
      const t0 = Date.now();
      let msReconcile = 0;
      let msRows = 0;
      let msAgg = 0;
      if (shop && reporting.ordersSource === 'orders_shopify') {
        // Best-effort: keep truth cache warm for this range (throttled).
        const tReconcile0 = Date.now();
        try { await salesTruth.ensureReconciled(shop, start, end, `worst_products_${range}`); } catch (_) {}
        msReconcile = Date.now() - tReconcile0;
      }

      // Session landings, with optional linked truth orders for attribution (sum(revenue) <= truth total).
      const tRows0 = Date.now();
      const rows = (reporting.ordersSource === 'pixel') ? await db.all(
        `
          SELECT
            s.session_id,
            s.first_path,
            s.first_product_handle,
            p.order_key AS order_id,
            p.currency AS currency,
            p.total_price AS total_price
          FROM sessions s
          LEFT JOIN (
            SELECT
              session_id,
              COALESCE(NULLIF(TRIM(order_currency), ''), 'GBP') AS currency,
              ${store.purchaseDedupeKeySql('p')} AS order_key,
              order_total AS total_price
            FROM purchases p
            WHERE purchased_at >= ? AND purchased_at < ?
              ${store.purchaseFilterExcludeDuplicateH('p')}
          ) p ON p.session_id = s.session_id
          WHERE s.started_at >= ? AND s.started_at < ?
            ${botFilterSql}
            AND (
              s.first_path LIKE '/products/%'
              OR (s.first_product_handle IS NOT NULL AND TRIM(COALESCE(s.first_product_handle, '')) != '')
            )
        `,
        [start, end, start, end]
      ) : (shop ? await db.all(
        `
          SELECT
            s.session_id,
            s.first_path,
            s.first_product_handle,
            p.order_id AS order_id,
            p.currency AS currency,
            p.total_price AS total_price
          FROM sessions s
          LEFT JOIN (
            SELECT
              x.session_id AS session_id,
              li.order_id AS order_id,
              COALESCE(NULLIF(TRIM(li.currency), ''), 'GBP') AS currency,
              COALESCE(SUM(li.line_revenue), 0) AS total_price
            FROM (
              SELECT DISTINCT
                pe.session_id AS session_id,
                pe.shop AS shop,
                pe.linked_order_id AS order_id
              FROM purchase_events pe
              WHERE pe.shop = ?
                AND pe.event_type = 'checkout_completed'
                AND pe.linked_order_id IS NOT NULL AND TRIM(pe.linked_order_id) != ''
            ) x
            INNER JOIN orders_shopify_line_items li ON li.shop = x.shop AND li.order_id = x.order_id
            WHERE li.order_created_at >= ? AND li.order_created_at < ?
              AND (li.order_test IS NULL OR li.order_test = 0)
              AND li.order_cancelled_at IS NULL
              AND li.order_financial_status = 'paid'
            GROUP BY x.session_id, li.order_id, COALESCE(NULLIF(TRIM(li.currency), ''), 'GBP')
          ) p ON p.session_id = s.session_id
          WHERE s.started_at >= ? AND s.started_at < ?
            ${botFilterSql}
            AND (
              s.first_path LIKE '/products/%'
              OR (s.first_product_handle IS NOT NULL AND TRIM(COALESCE(s.first_product_handle, '')) != '')
            )
        `,
        [shop, start, end, start, end]
      ) : await db.all(
        `
          SELECT s.session_id, s.first_path, s.first_product_handle, NULL AS order_id, NULL AS currency, NULL AS total_price
          FROM sessions s
          WHERE s.started_at >= ? AND s.started_at < ?
            ${botFilterSql}
            AND (
              s.first_path LIKE '/products/%'
              OR (s.first_product_handle IS NOT NULL AND TRIM(COALESCE(s.first_product_handle, '')) != '')
            )
        `,
        [start, end]
      ));
      msRows = Date.now() - tRows0;

      const tAgg0 = Date.now();
      const ratesToGbp = await fx.getRatesToGbp();
      const map = new Map(); // handle -> { handle, clicks, orderIds:Set, converted, revenue }
      for (const r of rows || []) {
        const handle = handleFromPath(r.first_path) || normalizeHandle(r.first_product_handle);
        if (!handle) continue;
        let entry = map.get(handle);
        if (!entry) {
          entry = { handle, clicks: 0, orderIds: new Set(), converted: 0, revenue: 0 };
          map.set(handle, entry);
        }
        entry.clicks += 1;

        const oid = r.order_id != null ? String(r.order_id) : '';
        if (oid) {
          if (!entry.orderIds.has(oid)) {
            entry.orderIds.add(oid);
            entry.converted += 1;
            const amt = r.total_price != null ? Number(r.total_price) : NaN;
            if (Number.isFinite(amt)) {
              const cur = fx.normalizeCurrency(r.currency) || 'GBP';
              const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
              if (typeof gbp === 'number' && Number.isFinite(gbp)) entry.revenue += gbp;
            }
          }
        }
      }

      const list = Array.from(map.values())
        .filter((e) => e.clicks >= MIN_CLICKS)
        .map((e) => {
          const cr = e.clicks > 0 ? Math.round((e.converted / e.clicks) * 1000) / 10 : null;
          return {
            handle: e.handle,
            clicks: e.clicks,
            converted: e.converted,
            conversion: cr,
            revenue: Math.round(e.revenue * 100) / 100,
          };
        });

      // Sort: worst conversion first, then most clicks (high-traffic underperformers at top).
      list.sort((a, b) => {
        const acr = a.conversion == null ? 0 : a.conversion;
        const bcr = b.conversion == null ? 0 : b.conversion;
        if (acr !== bcr) return acr - bcr;
        if (b.clicks !== a.clicks) return b.clicks - a.clicks;
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
        reporting,
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
    reporting,
    page: 1,
    pageSize,
    totalCount: 0,
    worstProducts: [],
  });
}

module.exports = { getWorstProducts };

