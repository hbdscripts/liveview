const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const fx = require('../fx');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];

function normalizeFinishKey(variantTitle) {
  const raw = typeof variantTitle === 'string' ? variantTitle.trim().toLowerCase() : '';
  if (!raw) return null;

  const s = raw.replace(/\s+/g, ' ').slice(0, 256);
  const clean = (' ' + s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ');

  if (clean.includes(' solid silver ')) return 'solid_silver';
  if (clean.includes(' gold vermeil ') || clean.includes(' vermeil ')) return 'vermeil';
  if (
    clean.includes(' 925 sterling silver ') ||
    clean.includes(' 925 silver ') ||
    clean.includes(' sterling silver ') ||
    clean.includes(' silver ')
  ) return 'silver';
  if (
    clean.includes(' 14ct gold ') ||
    clean.includes(' 18ct gold ') ||
    clean.includes(' gold ')
  ) return 'gold';

  return null;
}

function labelForFinishKey(key) {
  if (key === 'gold') return 'Gold';
  if (key === 'silver') return 'Silver';
  if (key === 'vermeil') return 'Vermeil';
  if (key === 'solid_silver') return 'Solid Silver';
  return key;
}

async function getShopifyFinishes(req, res) {
  const rawShop = (req.query.shop || '').trim().toLowerCase();
  const shop = salesTruth.resolveShopForSales(rawShop) || salesTruth.resolveShopForSales('') || rawShop;
  let range = (req.query.range || 'today').toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(range);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(range);
  if (!RANGE_KEYS.includes(range) && !isDayKey && !isRangeKey) range = 'today';
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  try {
    const db = getDb();
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'shopify-finishes',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: {},
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        try {
          await salesTruth.ensureReconciled(shop, start, end, `products_${range}`);
        } catch (_) {}

        const rows = config.dbUrl
          ? await db.all(
            `
              SELECT
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                variant_title,
                COALESCE(SUM(line_revenue), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = $1 AND order_created_at >= $2 AND order_created_at < $3
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
                COALESCE(SUM(line_revenue), 0) AS revenue
              FROM orders_shopify_line_items
              WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
                AND (order_test IS NULL OR order_test = 0)
                AND order_cancelled_at IS NULL
                AND order_financial_status = 'paid'
                AND variant_title IS NOT NULL AND TRIM(variant_title) != ''
              GROUP BY currency, variant_title
            `,
            [shop, start, end]
          );

        const ratesToGbp = await fx.getRatesToGbp();
        const byFinish = new Map();
        for (const r of rows || []) {
          const finish = normalizeFinishKey(r && r.variant_title != null ? String(r.variant_title) : '');
          if (!finish) continue;
          const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
          const rev = r && r.revenue != null ? Number(r.revenue) : 0;
          const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp);
          const amt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
          byFinish.set(finish, (byFinish.get(finish) || 0) + amt);
        }

        const order = ['gold', 'silver', 'vermeil', 'solid_silver'];
        const finishes = order.map((k) => ({
          key: k,
          label: labelForFinishKey(k),
          revenueGbp: Math.round(((byFinish.get(k) || 0) * 100)) / 100,
        }));

        return { ok: true, finishes };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { ok: true, finishes: [] });
  } catch (err) {
    console.error('[shopify-finishes]', err);
    return res.status(500).json({ error: 'Failed to fetch finishes' });
  }
}

module.exports = { getShopifyFinishes };
