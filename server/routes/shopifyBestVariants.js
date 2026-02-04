/**
 * GET /api/shopify-best-variants?shop=xxx.myshopify.com&range=today|yesterday|3d|7d&page=1&pageSize=10
 * Returns best selling variants by revenue for the date range (Shopify Orders + Products API).
 */
const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');
const productAggCache = require('../productAggCache');
const productMetaCache = require('../shopifyProductMetaCache');

const API_VERSION = '2024-01';
const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getShopifyBestVariants(req, res) {
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
    // Ensure Shopify truth cache is populated for this range (throttled).
    await salesTruth.ensureReconciled(shop, start, end, `best_variants_${range}`);
    const agg = await productAggCache.getAgg(shop, start, end, { ttlMs: 15 * 60 * 1000, force });
    const totalOrders = agg && typeof agg.totalOrders === 'number' ? agg.totalOrders : 0;
    const list = Array.isArray(agg && agg.variants) ? agg.variants.slice() : [];
    list.sort((a, b) => (b.revenue || 0) - (a.revenue || 0));

    const pageSize = clampInt(req.query.pageSize, 10, 1, 10);
    const totalCount = list.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const page = clampInt(req.query.page, 1, 1, totalPages);
    const startIdx = (page - 1) * pageSize;
    const pageItems = list.slice(startIdx, startIdx + pageSize);

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

    // Cache: Shopify-derived report; allow 15 min caching to reduce API load.
    res.setHeader('Cache-Control', 'private, max-age=900');
    res.setHeader('Vary', 'Cookie');
    return res.json({ bestVariants: pageItems, totalOrders, page, pageSize, totalCount });
  } catch (err) {
    console.error('[shopify-best-variants]', err);
    return res.status(500).json({ error: 'Failed to fetch best variants' });
  }
}

module.exports = { getShopifyBestVariants };

