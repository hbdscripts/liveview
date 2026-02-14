/**
 * GET /api/kpis?range=today|yesterday|3d|7d|14d|30d|month|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD
 * Lightweight KPIs for the top grid (polled frequently).
 */
const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');

async function getKpis(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'kpis.get', data: { range: req?.query?.range } });
  const trafficMode = 'human_only';
  // Polled frequently; keep it cheap and cacheable.
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('Vary', 'Cookie');

  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '', { defaultKey: 'today' });
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
        ttlMs: 120 * 1000,
        force,
      },
      async () => store.getKpis({ trafficMode, rangeKey, force })
    );
    const totalMs = Date.now() - t0;
    if (timing || totalMs > 1200) {
      console.log('[kpis] range=%s ms_total=%s cacheHit=%s', rangeKey, totalMs, cached && cached.cacheHit ? 1 : 0);
    }
    res.json(cached && cached.ok ? cached.data : null);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'kpis', rangeKey } });
    console.error('[kpis]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { getKpis };

