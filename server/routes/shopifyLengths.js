const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const fx = require('../fx');
const { normalizeRangeKey } = require('../rangeKey');

const LENGTH_INCHES = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const BOT_FILTER_SQL = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';

function normalizeLengthInches(variantTitle) {
  const raw = typeof variantTitle === 'string' ? variantTitle.trim().toLowerCase() : '';
  if (!raw) return null;

  // Normalize spacing + common unicode quotes.
  const s = raw
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .slice(0, 256);

  // Keep digits/letters/quotes, turn other punctuation into spaces for stable matching.
  const clean = (' ' + s.replace(/[^0-9a-z"]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ');

  // Prefer explicit inch markers so we don't accidentally match other numbers.
  // Examples: `15" Inches`, `15 inches`, `15 in`, `15"`.
  const withQuote = clean.match(/(?:^|\s)(12|13|14|15|16|17|18|19|20|21)\s*"\s*(?:inches|inch|in)?(?:\s|$)/i);
  if (withQuote && withQuote[1]) return Number(withQuote[1]);
  const withWord = clean.match(/(?:^|\s)(12|13|14|15|16|17|18|19|20|21)\s*(?:inches|inch|in)(?:\s|$)/i);
  if (withWord && withWord[1]) return Number(withWord[1]);

  return null;
}

function labelForLengthInches(inches) {
  const n = Number(inches);
  if (!Number.isFinite(n)) return '';
  return `${n}"`;
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

async function getShopifyLengths(req, res) {
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
        endpoint: 'shopify-lengths',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: {},
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        const truthScope = salesTruth.scopeForRangeKey(range, 'range');
        if (range === 'today') {
          try { await salesTruth.ensureReconciled(shop, start, end, truthScope); } catch (_) {}
        } else {
          salesTruth.ensureReconciled(shop, start, end, truthScope).catch(() => {});
        }

        const sessions = await getProductLandingSessionsCount(db, start, end);
        const rows = config.dbUrl
          ? await db.all(
            `
              SELECT
                COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
                variant_title,
                COUNT(DISTINCT order_id) AS orders,
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
                COUNT(DISTINCT order_id) AS orders,
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
        const byLen = new Map();
        const ordersByLen = new Map();

        for (const r of rows || []) {
          const inches = normalizeLengthInches(r && r.variant_title != null ? String(r.variant_title) : '');
          if (inches == null) continue;
          if (!LENGTH_INCHES.includes(inches)) continue;
          const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
          const rev = r && r.revenue != null ? Number(r.revenue) : 0;
          const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp);
          const amt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
          byLen.set(inches, (byLen.get(inches) || 0) + amt);
          const oRaw = r && r.orders != null ? Number(r.orders) : 0;
          const o = Number.isFinite(oRaw) ? Math.trunc(oRaw) : 0;
          ordersByLen.set(inches, (ordersByLen.get(inches) || 0) + o);
        }

        const lengths = LENGTH_INCHES.map((n) => {
          const orders = ordersByLen.get(n) || 0;
          const cr = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null;
          return {
            key: String(n),
            inches: n,
            label: labelForLengthInches(n),
            revenueGbp: Math.round(((byLen.get(n) || 0) * 100)) / 100,
            orders,
            sessions,
            cr,
          };
        });

        return { ok: true, lengths };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { ok: true, lengths: [] });
  } catch (err) {
    console.error('[shopify-lengths]', err);
    return res.status(500).json({ error: 'Failed to fetch lengths' });
  }
}

module.exports = { getShopifyLengths };
