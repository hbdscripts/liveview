/**
 * GET /api/worst-products?range=today|yesterday|3d|7d&traffic=all|human&page=1&pageSize=10
 * "Worst products": products with meaningful traffic that have the lowest conversion
 * (underperformers: lots of landings, few or no sales).
 *
 * Implementation notes:
 * - Clicks are sessions that *started* on a product page (first_path /products/... or first_product_handle).
 * - Conversion is session-level (has_purchased=1) for those sessions.
 * - Only products with at least MIN_CLICKS landings are included (avoids noise).
 * - Sort: worst conversion first, then most clicks (so high-traffic poor converters appear first).
 */

const config = require('../config');
const store = require('../store');
const { getDb } = require('../db');
const fx = require('../fx');

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

function trafficToMode(traffic) {
  const t = (traffic || '').toString().trim().toLowerCase();
  if (t === 'human') return 'human_only';
  if (t === 'all') return 'all';
  return config.trafficMode || 'all';
}

async function getWorstProducts(req, res) {
  let range = (req.query.range || 'today').toString().trim().toLowerCase();
  if (!RANGE_KEYS.includes(range)) range = 'today';

  const pageSize = clampInt(req.query.pageSize ?? req.query.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const trafficMode = trafficToMode(req.query.traffic);

  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  const db = getDb();
  const botFilterSql = trafficMode === 'human_only' ? ' AND (cf_known_bot IS NULL OR cf_known_bot = 0)' : '';

  // Use the minimal set of columns needed to build the report.
  const rows = await db.all(`
    SELECT first_path, first_product_handle, has_purchased, order_total, order_currency
    FROM sessions
    WHERE started_at >= ? AND started_at < ?
      ${botFilterSql}
      AND (
        first_path LIKE '/products/%'
        OR (first_product_handle IS NOT NULL AND TRIM(COALESCE(first_product_handle, '')) != '')
      )
  `, [start, end]);

  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map(); // handle -> { handle, clicks, converted, revenue }
  for (const r of rows || []) {
    const handle = handleFromPath(r.first_path) || normalizeHandle(r.first_product_handle);
    if (!handle) continue;
    let entry = map.get(handle);
    if (!entry) {
      entry = { handle, clicks: 0, converted: 0, revenue: 0 };
      map.set(handle, entry);
    }
    entry.clicks += 1;

    const purchased = Number(r.has_purchased) === 1 || r.has_purchased === true;
    if (purchased) {
      entry.converted += 1;
      const ot = r.order_total != null ? Number(r.order_total) : NaN;
      if (!Number.isNaN(ot) && Number.isFinite(ot)) {
        const cur = fx.normalizeCurrency(r.order_currency) || 'GBP';
        const gbp = fx.convertToGbp(ot, cur, ratesToGbp);
        if (typeof gbp === 'number' && Number.isFinite(gbp)) entry.revenue += gbp;
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

  // Cache: worst-products is relatively expensive; allow 15 min caching.
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Vary', 'Cookie');
  res.json({
    range,
    trafficMode,
    page,
    pageSize,
    totalCount,
    worstProducts: pageItems,
  });
}

module.exports = { getWorstProducts };

