const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const fx = require('../fx');
const { normalizeRangeKey } = require('../rangeKey');

const BOT_FILTER_SQL = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';

function normalizeChainStyle(variantTitle) {
  const raw = typeof variantTitle === 'string' ? variantTitle.trim().toLowerCase() : '';
  if (!raw) return null;

  const s = raw.replace(/\s+/g, ' ').slice(0, 256);
  const clean = (' ' + s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ');

  if (clean.includes(' cable chain ') || clean.includes(' cable ')) return 'cable';
  if (clean.includes(' belcher chain ') || clean.includes(' belcher ')) return 'belcher';
  if (clean.includes(' curb chain ') || clean.includes(' curb ')) return 'curb';
  if (clean.includes(' box chain ') || clean.includes(' box ')) return 'box';
  if (clean.includes(' figaro chain ') || clean.includes(' figaro ')) return 'figaro';
  if (clean.includes(' rope chain ') || clean.includes(' rope ')) return 'rope';
  if (clean.includes(' snake chain ') || clean.includes(' snake ')) return 'snake';
  if (clean.includes(' paperclip chain ') || clean.includes(' paperclip ')) return 'paperclip';
  if (clean.includes(' satellite chain ') || clean.includes(' satellite ')) return 'satellite';
  if (clean.includes(' trace chain ') || clean.includes(' trace ')) return 'trace';

  return null;
}

function labelForChainStyle(key) {
  if (key === 'cable') return 'Cable Chain';
  if (key === 'belcher') return 'Belcher Chain';
  if (key === 'curb') return 'Curb Chain';
  if (key === 'box') return 'Box Chain';
  if (key === 'figaro') return 'Figaro Chain';
  if (key === 'rope') return 'Rope Chain';
  if (key === 'snake') return 'Snake Chain';
  if (key === 'paperclip') return 'Paperclip Chain';
  if (key === 'satellite') return 'Satellite Chain';
  if (key === 'trace') return 'Trace Chain';
  return key;
}

async function getProductLandingSessionsCount(db, start, end) {
  const row = config.dbUrl
    ? await db.get(
      `
        SELECT COUNT(*) AS n
        FROM sessions s
        WHERE s.started_at >= $1 AND s.started_at < $2
          ${BOT_FILTER_SQL}
          AND (
            (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
            OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
            OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
          )
      `,
      [start, end]
    )
    : await db.get(
      `
        SELECT COUNT(*) AS n
        FROM sessions s
        WHERE s.started_at >= ? AND s.started_at < ?
          ${BOT_FILTER_SQL}
          AND (
            (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
            OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
            OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
          )
      `,
      [start, end]
    );
  return row && row.n != null ? Number(row.n) || 0 : 0;
}

async function getShopifyChainStyles(req, res) {
  const rawShop = (req.query.shop || '').trim().toLowerCase();
  const shop = salesTruth.resolveShopForSales(rawShop) || salesTruth.resolveShopForSales('') || rawShop;
  const range = normalizeRangeKey(req.query.range, { defaultKey: 'today' });

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  try {
    const db = getDb();
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'shopify-chain-styles',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: {},
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        try {
          const truthScope = salesTruth.scopeForRangeKey(range, 'range');
          if (range === 'today') {
            await salesTruth.ensureReconciled(shop, start, end, truthScope);
          } else {
            salesTruth.ensureReconciled(shop, start, end, truthScope).catch(() => {});
          }
        } catch (_) {}

        const sessions = await getProductLandingSessionsCount(db, start, end);
        const rows = config.dbUrl
          ? await db.all(
            `
              SELECT
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                variant_title,
                COUNT(DISTINCT order_id) AS orders,
                COALESCE(SUM(COALESCE(line_net, line_revenue)), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = $1 AND (COALESCE(order_processed_at, order_created_at) >= $2 AND COALESCE(order_processed_at, order_created_at) < $3)
                AND (order_test IS NULL OR order_test = 0)
                AND order_cancelled_at IS NULL
                AND order_financial_status = 'paid'
                AND variant_title IS NOT NULL AND TRIM(variant_title) != ''
              GROUP BY currency, variant_title
            `,
            [shop, start, end]
          )
          : await db.all(
            `
              SELECT
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                variant_title,
                COUNT(DISTINCT order_id) AS orders,
                COALESCE(SUM(COALESCE(line_net, line_revenue)), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = ? AND (COALESCE(order_processed_at, order_created_at) >= ? AND COALESCE(order_processed_at, order_created_at) < ?)
                AND (order_test IS NULL OR order_test = 0)
                AND order_cancelled_at IS NULL
                AND order_financial_status = 'paid'
                AND variant_title IS NOT NULL AND TRIM(variant_title) != ''
              GROUP BY currency, variant_title
            `,
            [shop, start, end]
          );

        const ratesToGbp = await fx.getRatesToGbp();
        const byStyle = new Map();
        const ordersByStyle = new Map();

        for (const r of rows || []) {
          const style = normalizeChainStyle(r && r.variant_title != null ? String(r.variant_title) : '');
          if (!style) continue;
          const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
          const rev = r && r.revenue != null ? Number(r.revenue) : 0;
          const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp);
          const amt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
          byStyle.set(style, (byStyle.get(style) || 0) + amt);
          const oRaw = r && r.orders != null ? Number(r.orders) : 0;
          const o = Number.isFinite(oRaw) ? Math.trunc(oRaw) : 0;
          ordersByStyle.set(style, (ordersByStyle.get(style) || 0) + o);
        }

        // Debug: log sample variant_titles and match stats
        const sampleTitles = (rows || []).slice(0, 10).map(r => r && r.variant_title ? String(r.variant_title).trim() : '');
        console.log('[shopify-chain-styles] rows=%d matched=%d sample_titles=%s', (rows || []).length, byStyle.size, JSON.stringify(sampleTitles));

        const allKeys = Array.from(new Set([...byStyle.keys(), ...ordersByStyle.keys()]));
        allKeys.sort((a, b) => (byStyle.get(b) || 0) - (byStyle.get(a) || 0));

        const chainStyles = allKeys.map((k) => {
          const orders = ordersByStyle.get(k) || 0;
          const cr = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null;
          return {
            key: k,
            label: labelForChainStyle(k),
            revenueGbp: Math.round(((byStyle.get(k) || 0) * 100)) / 100,
            orders,
            sessions,
            cr,
          };
        });

        return { ok: true, chainStyles };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { ok: true, chainStyles: [] });
  } catch (err) {
    console.error('[shopify-chain-styles]', err);
    return res.status(500).json({ error: 'Failed to fetch chain styles' });
  }
}

module.exports = { getShopifyChainStyles };
