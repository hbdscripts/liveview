/**
 * GET /api/shopify-leaderboard?shop=xxx.myshopify.com&range=today|yesterday|3d|7d|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD
 *
 * Leaderboard (truth line items), grouped two ways:
 * - byTitle: top products (image + revenue + orders + sessions + CR)
 * - byType: top product types (e.g. Necklace, Bracelet) + revenue + orders + sessions + CR
 *
 * Definitions:
 * - Orders: sum(line-item quantity) from Shopify truth orders
 * - Sessions: product landings from our sessions table (human-only)
 * - CR%: Orders / Sessions × 100
 *
 * Notes:
 * - Uses orders_shopify_line_items (paid, non-test, not cancelled) and converts revenue to GBP.
 * - Product meta (handle/thumb/product_type) is fetched from Shopify when a token is available, and cached in-memory.
 */
const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const fx = require('../fx');
const productMetaCache = require('../shopifyProductMetaCache');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];
const MAX_META_PRODUCTS = 200;

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

function round2(n) {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function normalizeTypeLabel(raw) {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { key: 'unknown', label: 'Unknown' };
  const label = s.replace(/\s+/g, ' ').trim().slice(0, 80);
  const key = label.toLowerCase();
  return { key: key || 'unknown', label: label || 'Unknown' };
}

async function fetchProductMetaBatch(shop, token, productIds, { concurrency = 8 } = {}) {
  const ids = Array.from(new Set((productIds || []).map((v) => (v != null ? String(v).trim() : '')).filter(Boolean)));
  const out = new Map();
  if (!shop || !token || ids.length === 0) return out;

  const c = clampInt(concurrency, 8, 1, 12);
  for (let i = 0; i < ids.length; i += c) {
    const slice = ids.slice(i, i + c);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      slice.map(async (pid) => {
        try {
          const meta = await productMetaCache.getProductMeta(shop, token, pid);
          if (meta && meta.ok) out.set(pid, meta);
        } catch (_) {}
      })
    );
  }
  return out;
}

async function getShopifyLeaderboard(req, res) {
  const rawShop = (req.query.shop || '').trim().toLowerCase();
  const shop = salesTruth.resolveShopForSales(rawShop) || salesTruth.resolveShopForSales('') || rawShop;
  let range = (req.query.range || '7d').toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = '7d';

  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const topProducts = clampInt(req.query.topProducts, 10, 1, 20);
  const topTypes = clampInt(req.query.topTypes, 10, 1, 20);

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  try {
    const db = getDb();
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'shopify-leaderboard',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { topProducts, topTypes },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        try {
          await salesTruth.ensureReconciled(shop, start, end, `products_${range}`);
        } catch (_) {}

        let token = null;
        try { token = await salesTruth.getAccessToken(shop); } catch (_) { token = null; }

        const rows = config.dbUrl
          ? await db.all(
            `
              SELECT
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                TRIM(product_id) AS product_id,
                MAX(title) AS title,
                COALESCE(SUM(quantity), 0) AS orders,
                COALESCE(SUM(line_revenue), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = $1 AND order_created_at >= $2 AND order_created_at < $3
                AND (order_test IS NULL OR order_test = 0)
                AND order_cancelled_at IS NULL
                AND order_financial_status = 'paid'
                AND product_id IS NOT NULL AND TRIM(product_id) != ''
              GROUP BY currency, TRIM(product_id)
            `,
            [shop, start, end]
          )
          : await db.all(
            `
              SELECT
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                TRIM(product_id) AS product_id,
                MAX(title) AS title,
                COALESCE(SUM(quantity), 0) AS orders,
                COALESCE(SUM(line_revenue), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
                AND (order_test IS NULL OR order_test = 0)
                AND order_cancelled_at IS NULL
                AND order_financial_status = 'paid'
                AND product_id IS NOT NULL AND TRIM(product_id) != ''
              GROUP BY currency, TRIM(product_id)
            `,
            [shop, start, end]
          );

        const ratesToGbp = await fx.getRatesToGbp();
        const byProduct = new Map(); // product_id -> { product_id, title, revenueGbp, orders }

        for (const r of rows || []) {
          const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
          if (!pid) continue;
          const title = r && r.title != null ? String(r.title).trim() : '';
          const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
          const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
          const rev = Number.isFinite(revRaw) ? revRaw : 0;
          const gbp = fx.convertToGbp(rev, cur, ratesToGbp);
          const amt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
          const ordersRaw = r && r.orders != null ? Number(r.orders) : 0;
          const orders = Number.isFinite(ordersRaw) ? Math.trunc(ordersRaw) : 0;

          const prev = byProduct.get(pid) || { product_id: pid, title: '', revenueGbp: 0, orders: 0 };
          prev.revenueGbp += amt;
          prev.orders += orders;
          if (!prev.title && title) prev.title = title;
          byProduct.set(pid, prev);
        }

        const products = Array.from(byProduct.values());
        products.sort((a, b) => (b.revenueGbp || 0) - (a.revenueGbp || 0));

        const metaProductIds = token
          ? products.slice(0, Math.min(products.length, MAX_META_PRODUCTS)).map((p) => p.product_id)
          : [];
        const metaByProductId = await fetchProductMetaBatch(shop, token, metaProductIds);

        const byTitle = products.slice(0, topProducts).map((p) => {
          const pid = p && p.product_id ? String(p.product_id) : '';
          const meta = pid && metaByProductId.has(pid) ? metaByProductId.get(pid) : null;
          const handle = meta && meta.handle ? normalizeHandle(String(meta.handle)) : null;
          return {
            product_id: pid || null,
            title: p && p.title ? String(p.title) : null,
            handle,
            thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
            revenueGbp: round2(p && p.revenueGbp),
            orders: p && typeof p.orders === 'number' && Number.isFinite(p.orders) ? Math.trunc(p.orders) : 0,
          };
        });

        const byTypeMap = new Map(); // key -> { key, label, revenueGbp }
        for (const p of products) {
          const pid = p && p.product_id ? String(p.product_id) : '';
          const meta = pid && metaByProductId.has(pid) ? metaByProductId.get(pid) : null;
          const t = normalizeTypeLabel(meta && meta.product_type ? String(meta.product_type) : '');
          const prev = byTypeMap.get(t.key) || { key: t.key, label: t.label, revenueGbp: 0, orders: 0 };
          prev.revenueGbp += (p && typeof p.revenueGbp === 'number' && Number.isFinite(p.revenueGbp)) ? p.revenueGbp : 0;
          prev.orders += (p && typeof p.orders === 'number' && Number.isFinite(p.orders)) ? Math.trunc(p.orders) : 0;
          if (!prev.label && t.label) prev.label = t.label;
          byTypeMap.set(t.key, prev);
        }

        const byType = Array.from(byTypeMap.values())
          .map((t) => ({ ...t, revenueGbp: round2(t.revenueGbp), orders: Math.trunc(Number(t.orders) || 0) }))
          .sort((a, b) => (b.revenueGbp || 0) - (a.revenueGbp || 0))
          .slice(0, topTypes);

        // Sessions (product landings) for the products/types we’re returning.
        const handleSet = new Set();
        const typeByHandle = new Map(); // handle -> typeKey
        for (const [pid, meta] of metaByProductId.entries()) {
          const handle = meta && meta.handle ? normalizeHandle(String(meta.handle)) : null;
          if (!handle) continue;
          handleSet.add(handle);
          const t = normalizeTypeLabel(meta && meta.product_type ? String(meta.product_type) : '');
          if (t && t.key) typeByHandle.set(handle, t.key);
        }
        const sessionsByHandle = new Map();
        const sessionsByType = new Map();
        if (handleSet.size) {
          const botFilterSql = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';
          const landRows = config.dbUrl
            ? await db.all(
              `
                SELECT s.first_path, s.first_product_handle, s.entry_url
                FROM sessions s
                WHERE s.started_at >= $1 AND s.started_at < $2
                  ${botFilterSql}
                  AND (
                    (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
                    OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
                    OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
                  )
              `,
              [start, end]
            )
            : await db.all(
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
            sessionsByHandle.set(h, (sessionsByHandle.get(h) || 0) + 1);
            const typeKey = typeByHandle.get(h) || null;
            if (typeKey) sessionsByType.set(typeKey, (sessionsByType.get(typeKey) || 0) + 1);
          }
        }

        // Build productsByType: map of typeKey -> array of individual products
        const productsByTypeMap = new Map();
        for (const p of products) {
          const pid = p && p.product_id ? String(p.product_id) : '';
          const meta = pid && metaByProductId.has(pid) ? metaByProductId.get(pid) : null;
          const t = normalizeTypeLabel(meta && meta.product_type ? String(meta.product_type) : '');
          const handle = meta && meta.handle ? normalizeHandle(String(meta.handle)) : null;
          const sessions = handle ? (sessionsByHandle.get(handle) || 0) : 0;
          const orders = p && typeof p.orders === 'number' && Number.isFinite(p.orders) ? Math.trunc(p.orders) : 0;
          const cr = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null;
          const item = {
            product_id: pid || null,
            title: p && p.title ? String(p.title) : null,
            handle,
            thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
            revenueGbp: round2(p && p.revenueGbp),
            orders,
            sessions,
            cr,
          };
          if (!productsByTypeMap.has(t.key)) productsByTypeMap.set(t.key, []);
          productsByTypeMap.get(t.key).push(item);
        }
        const productsByType = {};
        for (const [key, items] of productsByTypeMap.entries()) {
          productsByType[key] = items.sort((a, b) => (b.revenueGbp || 0) - (a.revenueGbp || 0));
        }

        return {
          ok: true,
          range: { key: range, start, end },
          byTitle: byTitle.map((row) => {
            const handle = row && row.handle ? normalizeHandle(String(row.handle)) : null;
            const sessions = handle ? (sessionsByHandle.get(handle) || 0) : 0;
            const orders = row && typeof row.orders === 'number' && Number.isFinite(row.orders) ? Math.trunc(row.orders) : 0;
            const cr = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null;
            return { ...row, sessions, cr };
          }),
          byType: byType.map((row) => {
            const key = row && row.key ? String(row.key) : '';
            const sessions = key ? (sessionsByType.get(key) || 0) : 0;
            const orders = row && typeof row.orders === 'number' && Number.isFinite(row.orders) ? Math.trunc(row.orders) : 0;
            const cr = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null;
            return { ...row, sessions, cr };
          }),
          productsByType,
        };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Vary', 'Cookie');
    return res.json(
      cached && cached.ok
        ? cached.data
        : { ok: true, range: { key: range, start, end }, byTitle: [], byType: [] }
    );
  } catch (err) {
    console.error('[shopify-leaderboard]', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}

module.exports = { getShopifyLeaderboard };

