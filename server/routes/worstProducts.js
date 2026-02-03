/**
 * GET /api/worst-products?range=today|yesterday|3d|7d&traffic=all|human&limit=10
 * "Worst products": high product landing clicks with low conversion.
 *
 * Implementation notes:
 * - Clicks are sessions that *started* on a product page (first_path /products/...) OR have first_product_handle set.
 * - Conversion is session-level (has_purchased=1) for those sessions.
 *   This is an approximation but aligns with how the dashboard tracks sessions.
 */

const config = require('../config');
const store = require('../store');
const { getDb } = require('../db');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d'];
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

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

  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const trafficMode = trafficToMode(req.query.traffic);

  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  const db = getDb();
  const botFilterSql = trafficMode === 'human_only' ? ' AND (cf_known_bot IS NULL OR cf_known_bot = 0)' : '';

  // Use the minimal set of columns needed to build the report.
  const rows = await db.all(`
    SELECT first_path, first_product_handle, has_purchased, order_total
    FROM sessions
    WHERE started_at >= ? AND started_at < ?
      ${botFilterSql}
      AND (
        first_path LIKE '/products/%'
        OR (first_product_handle IS NOT NULL AND TRIM(COALESCE(first_product_handle, '')) != '')
      )
  `, [start, end]);

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
      if (!Number.isNaN(ot) && Number.isFinite(ot)) entry.revenue += ot;
    }
  }

  const list = Array.from(map.values()).map((e) => {
    const cr = e.clicks > 0 ? Math.round((e.converted / e.clicks) * 1000) / 10 : null;
    return {
      handle: e.handle,
      clicks: e.clicks,
      converted: e.converted,
      conversion: cr,
      revenue: Math.round(e.revenue * 100) / 100,
    };
  });

  // Sort: highest clicks first, then lowest CR.
  list.sort((a, b) => {
    if (b.clicks !== a.clicks) return b.clicks - a.clicks;
    const acr = a.conversion == null ? 999 : a.conversion;
    const bcr = b.conversion == null ? 999 : b.conversion;
    if (acr !== bcr) return acr - bcr;
    return (b.converted - a.converted) || (b.revenue - a.revenue);
  });

  res.json({
    range,
    trafficMode,
    worstProducts: list.slice(0, limit),
  });
}

module.exports = { getWorstProducts };

