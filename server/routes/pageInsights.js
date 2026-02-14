/**
 * GET /api/page-insights?url=https://... (or ?path=/collections/necklaces)&kind=entry|exit&range=...
 *
 * Used by the shared modal when clicking Entry/Exit links in the sessions table.
 * This is intentionally a "what we know locally" report:
 * - sessions: from `sessions` table (human-only)
 * - page views: from `events` table (type='page_viewed') (human-only)
 * - purchases: from `sessions` (has_purchased + order_total/order_currency) as a best-effort local signal
 *
 * NOTE: product pages should generally use /api/product-insights (Shopify truth line items + meta).
 */
const { getDb, isPostgres } = require('../db');
const store = require('../store');
const fx = require('../fx');
const { normalizeRangeKey } = require('../rangeKey');

function normalizeKind(raw) {
  const k = raw != null ? String(raw).trim().toLowerCase() : '';
  return k === 'exit' ? 'exit' : 'entry';
}

function normalizePath(rawPath) {
  if (!rawPath) return '';
  let p = String(rawPath).trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname || '';
  } catch (_) {}
  p = p.split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+$/, '');
  if (p === '') p = '/';
  return p.toLowerCase().slice(0, 512);
}

function bucketExpr(tsCol) {
  // bi = floor((ts - start)/bucketMs)
  if (isPostgres()) return `FLOOR((${tsCol} - ?)/(?::double precision))::bigint`;
  return `CAST((${tsCol} - ?)/? AS INTEGER)`;
}

async function getPageInsights(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=10');
  res.setHeader('Vary', 'Cookie');

  const kind = normalizeKind(req.query && req.query.kind ? req.query.kind : 'entry');
  const rangeKey = normalizeRangeKey(req.query && req.query.range ? req.query.range : 'today', { defaultKey: 'today' });
  const timeZone = store.resolveAdminTimeZone();
  const { start, end } = store.getRangeBounds(rangeKey, Date.now(), timeZone);

  const urlRaw = req.query && req.query.url ? String(req.query.url) : '';
  const pathRaw = req.query && req.query.path ? String(req.query.path) : '';
  const url = (urlRaw && urlRaw.trim()) ? urlRaw.trim().slice(0, 2048) : '';
  const path = normalizePath(pathRaw || url);
  if (!path) return res.status(400).json({ ok: false, error: 'Missing path/url' });

  // Pick a "time axis" depending on context:
  // - entry: when sessions started on this page
  // - exit: when sessions last saw this page
  const axisCol = kind === 'exit' ? 's.last_seen' : 's.started_at';
  const botFilterSql = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';

  const db = getDb();
  const likePath = path === '/' ? '/%' : (path + '%');
  const likeUrl = '%' + path + '%';

  function matchSql(col) {
    // Normalize: compare lower(trim(col)) and allow prefix match for nested paths.
    return `(${col} IS NOT NULL AND (LOWER(TRIM(${col})) = ? OR LOWER(TRIM(${col})) LIKE ?))`;
  }

  // Aggregate sessions
  let sessions = 0;
  let purchasedSessions = 0;
  let checkoutStartedSessions = 0;
  let revenueGbpApprox = 0;
  try {
    const row = await db.get(
      `
        SELECT
          COUNT(*) AS sessions,
          COALESCE(SUM(CASE WHEN s.checkout_started_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS checkout_started_sessions,
          COALESCE(SUM(CASE WHEN s.has_purchased = 1 THEN 1 ELSE 0 END), 0) AS purchased_sessions
        FROM sessions s
        WHERE ${axisCol} >= ? AND ${axisCol} < ?
          ${botFilterSql}
          AND (${matchSql(kind === 'exit' ? 's.last_path' : 's.first_path')} OR ${matchSql('s.entry_url')})
      `,
      [start, end, path, likePath, path, likePath, likeUrl, likeUrl]
    );
    sessions = row && row.sessions != null ? Number(row.sessions) || 0 : 0;
    checkoutStartedSessions = row && row.checkout_started_sessions != null ? Number(row.checkout_started_sessions) || 0 : 0;
    purchasedSessions = row && row.purchased_sessions != null ? Number(row.purchased_sessions) || 0 : 0;
  } catch (_) {}

  // Approx revenue (local): sum session order_total converted to GBP for sessions with purchased_at in range
  try {
    const rows = await db.all(
      `
        SELECT
          COALESCE(NULLIF(TRIM(s.order_currency), ''), 'GBP') AS currency,
          COALESCE(SUM(s.order_total), 0) AS revenue
        FROM sessions s
        WHERE s.purchased_at IS NOT NULL AND s.purchased_at >= ? AND s.purchased_at < ?
          ${botFilterSql}
          AND (${matchSql(kind === 'exit' ? 's.last_path' : 's.first_path')} OR ${matchSql('s.entry_url')})
          AND s.order_total IS NOT NULL
        GROUP BY COALESCE(NULLIF(TRIM(s.order_currency), ''), 'GBP')
      `,
      [start, end, path, likePath, path, likePath, likeUrl, likeUrl]
    );
    const ratesToGbp = await fx.getRatesToGbp();
    for (const r of rows || []) {
      const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
      const rev = r && r.revenue != null ? Number(r.revenue) : 0;
      const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp);
      revenueGbpApprox += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
    }
    revenueGbpApprox = Math.round(revenueGbpApprox * 100) / 100;
  } catch (_) {
    revenueGbpApprox = 0;
  }

  // Page views (events)
  let pageViews = 0;
  try {
    const row = await db.get(
      `
        SELECT COUNT(*) AS c
        FROM events e
        INNER JOIN sessions s ON s.session_id = e.session_id
        WHERE e.ts >= ? AND e.ts < ?
          ${botFilterSql}
          AND e.type = 'page_viewed'
          AND e.path IS NOT NULL
          AND (LOWER(TRIM(e.path)) = ? OR LOWER(TRIM(e.path)) LIKE ?)
      `,
      [start, end, path, likePath]
    );
    pageViews = row && row.c != null ? Number(row.c) || 0 : 0;
  } catch (_) {
    pageViews = 0;
  }

  // Series buckets
  const isHourly = rangeKey === 'today' || rangeKey === 'yesterday' || rangeKey.startsWith('d:');
  const bucketMs = isHourly ? 3600000 : 86400000;
  const maxBuckets = isHourly ? 48 : 60;
  const bucketCount = Math.max(1, Math.min(maxBuckets, Math.ceil((end - start) / bucketMs)));
  const points = [];
  for (let i = 0; i < bucketCount; i++) {
    points.push({
      ts: start + i * bucketMs,
      revenueGbp: 0,
      orders: 0,
      clicks: 0,      // sessions count for this page (axis)
      views: 0,       // page_viewed events
      addToCart: 0,   // not available at page-level (kept for chart compatibility)
    });
  }

  // Sessions per bucket
  try {
    const rows = await db.all(
      `
        SELECT ${bucketExpr(axisCol)} AS bi, COUNT(*) AS c
        FROM sessions s
        WHERE ${axisCol} >= ? AND ${axisCol} < ?
          ${botFilterSql}
          AND (${matchSql(kind === 'exit' ? 's.last_path' : 's.first_path')} OR ${matchSql('s.entry_url')})
        GROUP BY bi
      `,
      [start, bucketMs, start, end, path, likePath, path, likePath, likeUrl, likeUrl]
    );
    for (const r of rows || []) {
      const bi = r && r.bi != null ? Number(r.bi) : null;
      if (bi == null || !Number.isFinite(bi) || bi < 0 || bi >= points.length) continue;
      const n = r && r.c != null ? Number(r.c) : 0;
      points[bi].clicks += Number.isFinite(n) ? Math.trunc(n) : 0;
    }
  } catch (_) {}

  // Revenue per bucket (approx): group by purchased_at
  try {
    const rows = await db.all(
      `
        SELECT ${bucketExpr('s.purchased_at')} AS bi,
               COALESCE(NULLIF(TRIM(s.order_currency), ''), 'GBP') AS currency,
               COALESCE(SUM(s.order_total), 0) AS revenue,
               COALESCE(SUM(CASE WHEN s.has_purchased = 1 THEN 1 ELSE 0 END), 0) AS orders
        FROM sessions s
        WHERE s.purchased_at IS NOT NULL AND s.purchased_at >= ? AND s.purchased_at < ?
          ${botFilterSql}
          AND (${matchSql(kind === 'exit' ? 's.last_path' : 's.first_path')} OR ${matchSql('s.entry_url')})
          AND s.order_total IS NOT NULL
        GROUP BY bi, COALESCE(NULLIF(TRIM(s.order_currency), ''), 'GBP')
      `,
      [start, bucketMs, start, end, path, likePath, path, likePath, likeUrl, likeUrl]
    );
    const ratesToGbp = await fx.getRatesToGbp();
    for (const r of rows || []) {
      const bi = r && r.bi != null ? Number(r.bi) : null;
      if (bi == null || !Number.isFinite(bi) || bi < 0 || bi >= points.length) continue;
      const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
      const rev = r && r.revenue != null ? Number(r.revenue) : 0;
      const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp);
      points[bi].revenueGbp += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
      const o = r && r.orders != null ? Number(r.orders) : 0;
      points[bi].orders += Number.isFinite(o) ? Math.trunc(o) : 0;
    }
    for (const p of points) p.revenueGbp = Math.round((Number(p.revenueGbp) || 0) * 100) / 100;
  } catch (_) {}

  // Page views per bucket
  try {
    const rows = await db.all(
      `
        SELECT ${bucketExpr('e.ts')} AS bi, COUNT(*) AS c
        FROM events e
        INNER JOIN sessions s ON s.session_id = e.session_id
        WHERE e.ts >= ? AND e.ts < ?
          ${botFilterSql}
          AND e.type = 'page_viewed'
          AND e.path IS NOT NULL
          AND (LOWER(TRIM(e.path)) = ? OR LOWER(TRIM(e.path)) LIKE ?)
        GROUP BY bi
      `,
      [start, bucketMs, start, end, path, likePath]
    );
    for (const r of rows || []) {
      const bi = r && r.bi != null ? Number(r.bi) : null;
      if (bi == null || !Number.isFinite(bi) || bi < 0 || bi >= points.length) continue;
      const n = r && r.c != null ? Number(r.c) : 0;
      points[bi].views += Number.isFinite(n) ? Math.trunc(n) : 0;
    }
  } catch (_) {}

  const cr = sessions > 0 ? Math.round((purchasedSessions / sessions) * 10000) / 100 : null;
  const revPerSession = sessions > 0 ? Math.round((revenueGbpApprox / sessions) * 100) / 100 : null;

  return res.json({
    ok: true,
    kind: 'page',
    page: { url: url || null, path, landingKind: kind },
    rangeKey,
    rangeStartTs: start,
    rangeEndTs: end,
    timeZone,
    currency: 'GBP',
    metrics: {
      sessions,
      pageViews,
      checkoutStartedSessions,
      purchasedSessions,
      revenueGbp: revenueGbpApprox,
      cr,
      revPerSession,
    },
    series: { isHourly, bucketMs, points },
  });
}

module.exports = { getPageInsights };

