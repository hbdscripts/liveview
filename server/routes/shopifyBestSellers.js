/**
 * GET /api/shopify-best-sellers?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10&sort=rev|orders&dir=asc|desc
 * Returns best selling products by revenue for the date range (Shopify Orders + Products API).
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

async function getShopifyBestSellers(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  let range = (req.query.range || 'today').toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey) range = 'today';
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
    const sort = (req.query.sort || 'rev').toString().trim().toLowerCase();
    const dir = (req.query.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    const pageSize = clampInt(req.query.pageSize, 10, 1, 10);
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
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
        // Ensure Shopify truth cache is populated for this range (throttled).
        await salesTruth.ensureReconciled(shop, start, end, `best_sellers_${range}`);

        const totalOrders = await salesTruth.getTruthOrderCount(shop, start, end);

        const countRow = await db.get(
          `
            SELECT COUNT(DISTINCT product_id) AS n
            FROM orders_shopify_line_items
            WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND product_id IS NOT NULL AND TRIM(product_id) != ''
          `,
          [shop, start, end]
        );
        const totalCount = countRow && countRow.n != null ? Number(countRow.n) || 0 : 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
        const page = clampInt(req.query.page, 1, 1, totalPages);
        const offset = (page - 1) * pageSize;

        const orderBy =
          sort === 'orders'
            ? `orders ${dir.toUpperCase()}, revenue ${dir.toUpperCase()}`
            : `revenue ${dir.toUpperCase()}, orders ${dir.toUpperCase()}`;

        const rows = await db.all(
          `
            SELECT
              product_id,
              MAX(title) AS title,
              COUNT(DISTINCT order_id) AS orders,
              COALESCE(SUM(line_revenue), 0) AS revenue
            FROM orders_shopify_line_items
            WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND product_id IS NOT NULL AND TRIM(product_id) != ''
            GROUP BY product_id
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
          `,
          [shop, start, end, pageSize, offset]
        );

        const pageItems = (rows || []).map((r) => ({
          product_id: r && r.product_id != null ? String(r.product_id) : '',
          title: r && r.title != null ? String(r.title) : 'Unknown',
          orders: r && r.orders != null ? Number(r.orders) || 0 : 0,
          revenue: Math.round(((r && r.revenue != null ? Number(r.revenue) : 0) || 0) * 100) / 100,
        }));

        await Promise.all(
          pageItems.map(async (p) => {
            try {
              const meta = await productMetaCache.getProductMeta(shop, token, p.product_id);
              p.thumb_url = meta && meta.ok ? (meta.thumb_url || null) : null;
              p.handle = meta && meta.ok ? (meta.handle || null) : null;
            } catch (_) {
              p.thumb_url = null;
              p.handle = null;
            }
          })
        );

        const conversionRate = totalOrders > 0 ? (p) => Math.round((p.orders / totalOrders) * 1000) / 10 : () => null;
        const bestSellers = pageItems.map((p) => ({
          product_id: p.product_id,
          title: p.title,
          handle: p.handle || null,
          thumb_url: p.thumb_url || null,
          orders: p.orders,
          revenue: p.revenue,
          cr: conversionRate(p),
        }));

        const t1 = Date.now();
        if (req.query && (req.query.timing === '1' || (t1 - t0) > 1500)) {
          console.log('[shopify-best-sellers] range=%s sort=%s dir=%s page=%s ms=%s', range, sort, dir, page, (t1 - t0));
        }

        return { bestSellers, totalOrders, page, pageSize, totalCount, sort, dir };
      }
    );

    // Cache: Shopify-derived report; allow 15 min caching to reduce API load.
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { bestSellers: [], totalOrders: 0, page: 1, pageSize, totalCount: 0, sort, dir });
  } catch (err) {
    console.error('[shopify-best-sellers]', err);
    return res.status(500).json({ error: 'Failed to fetch best sellers' });
  }
}

module.exports = { getShopifyBestSellers };
