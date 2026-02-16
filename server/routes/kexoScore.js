/**
 * GET /api/kexo-score?range=today|yesterday|3d|7d|14d|30d|month|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD
 * Kexo Score 0-100 + component breakdown for dashboard ring + modal.
 */
const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');

async function getKexoScore(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'kexo-score.get', data: { range: req?.query?.range } });
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('Vary', 'Cookie');

  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '', { defaultKey: 'today' });
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  try {
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'kexo-score',
        rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: { rangeKey },
        ttlMs: 120 * 1000,
        force,
      },
      async () => store.getKexoScore({ rangeKey, force })
    );
    res.json(cached && cached.ok ? cached.data : null);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'kexo-score', rangeKey } });
    console.error('[kexo-score]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { getKexoScore };
