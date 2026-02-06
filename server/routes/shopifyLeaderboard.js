/**
 * GET /api/shopify-leaderboard?shop=xxx.myshopify.com
 *
 * Rolling 7-day leaderboard (truth line items):
 * - byTitle: top products (image + revenue) – no names required by UI, but title included for accessibility
 * - byType: top product types (e.g. Necklace, Bracelet) + revenue
 *
 * Notes:
 * - Uses orders_shopify_line_items (paid, non-test, not cancelled) and converts revenue to GBP.
 * - Product meta (thumb + product_type) is fetched from Shopify when a token is available, and cached in-memory.
 */
const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const fx = require('../fx');
const productMetaCache = require('../shopifyProductMetaCache');

const RANGE_KEY = '7d';
const MAX_META_PRODUCTS = 200;

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const topProducts = clampInt(req.query.topProducts, 10, 1, 20);
  const topTypes = clampInt(req.query.topTypes, 10, 1, 20);

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(RANGE_KEY, nowMs, timeZone);

  try {
    const db = getDb();
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'shopify-leaderboard',
        rangeKey: RANGE_KEY,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { topProducts, topTypes },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        try {
          await salesTruth.ensureReconciled(shop, start, end, `products_${RANGE_KEY}`);
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
        const byProduct = new Map(); // product_id -> { product_id, title, revenueGbp }

        for (const r of rows || []) {
          const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
          if (!pid) continue;
          const title = r && r.title != null ? String(r.title).trim() : '';
          const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
          const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
          const rev = Number.isFinite(revRaw) ? revRaw : 0;
          const gbp = fx.convertToGbp(rev, cur, ratesToGbp);
          const amt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;

          const prev = byProduct.get(pid) || { product_id: pid, title: '', revenueGbp: 0 };
          prev.revenueGbp += amt;
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
          return {
            product_id: pid || null,
            title: p && p.title ? String(p.title) : null,
            thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
            revenueGbp: round2(p && p.revenueGbp),
          };
        });

        const byTypeMap = new Map(); // key -> { key, label, revenueGbp }
        for (const p of products) {
          const pid = p && p.product_id ? String(p.product_id) : '';
          const meta = pid && metaByProductId.has(pid) ? metaByProductId.get(pid) : null;
          const t = normalizeTypeLabel(meta && meta.product_type ? String(meta.product_type) : '');
          const prev = byTypeMap.get(t.key) || { key: t.key, label: t.label, revenueGbp: 0 };
          prev.revenueGbp += (p && typeof p.revenueGbp === 'number' && Number.isFinite(p.revenueGbp)) ? p.revenueGbp : 0;
          if (!prev.label && t.label) prev.label = t.label;
          byTypeMap.set(t.key, prev);
        }

        const byType = Array.from(byTypeMap.values())
          .map((t) => ({ ...t, revenueGbp: round2(t.revenueGbp) }))
          .sort((a, b) => (b.revenueGbp || 0) - (a.revenueGbp || 0))
          .slice(0, topTypes);

        return {
          ok: true,
          range: { key: RANGE_KEY, start, end },
          byTitle,
          byType,
        };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Vary', 'Cookie');
    return res.json(
      cached && cached.ok
        ? cached.data
        : { ok: true, range: { key: RANGE_KEY, start, end }, byTitle: [], byType: [] }
    );
  } catch (err) {
    console.error('[shopify-leaderboard]', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}

module.exports = { getShopifyLeaderboard };

