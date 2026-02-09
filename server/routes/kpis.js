/**
 * GET /api/kpis?range=today|yesterday|3d|7d|14d|30d|month|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD
 * Lightweight KPIs for the top grid (polled frequently).
 */
const store = require('../store');
const reportCache = require('../reportCache');

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (ALLOWED_RANGE.has(r) || isDayKey || isRangeKey) return r;
  return 'today';
}

async function getKpis(req, res) {
  const trafficMode = 'human_only';
  // Polled every minute; keep it cheap and cacheable.
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');

  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '');
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const timing = !!(req && req.query && (req.query.timing === '1' || req.query.timing === 'true'));

  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  try {
    const t0 = Date.now();
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'kpis',
        rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: { trafficMode, rangeKey },
        ttlMs: 60 * 1000,
        force,
      },
      async () => store.getKpis({ trafficMode, rangeKey })
    );
    const totalMs = Date.now() - t0;
    if (timing || totalMs > 1200) {
      console.log('[kpis] range=%s ms_total=%s cacheHit=%s', rangeKey, totalMs, cached && cached.cacheHit ? 1 : 0);
    }
    res.json(cached && cached.ok ? cached.data : null);
  } catch (err) {
    console.error('[kpis]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { getKpis };

