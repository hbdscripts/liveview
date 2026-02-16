/**
 * GET /api/kexo-score-summary?range=today|yesterday|3d|7d|...&force=0|1
 * Returns Kexo Score summary (deterministic context + optional AI narrative) for the modal.
 * Cached per range (TTL 2–5 min); fail-open to deterministic when AI disabled/unavailable.
 */
const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');
const kexoScoreSummary = require('../kexoScoreSummary');
const kexoScoreAiNarrative = require('../kexoScoreAiNarrative');

const SUMMARY_TTL_MS = 3 * 60 * 1000; // 3 minutes

async function getKexoScoreSummary(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'kexo-score-summary.get', data: { range: req?.query?.range } });
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
        endpoint: 'kexo-score-summary',
        rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: { rangeKey },
        ttlMs: SUMMARY_TTL_MS,
        force,
      },
      async () => {
        const built = await kexoScoreSummary.buildSummaryContext({ rangeKey, force });
        if (!built.ok) {
          return { ok: false, error: built.error || 'build failed' };
        }
        const narrative = await kexoScoreAiNarrative.generateAiNarrative({
          context: built.context,
          drivers: built.drivers,
        });
        return {
          ok: true,
          rangeKey,
          summary: narrative.summary,
          key_drivers: narrative.key_drivers || [],
          recommendation: narrative.recommendation,
          links: narrative.links || [],
          context: built.context,
          drivers: built.drivers,
          ai_model: narrative.ai_model || null,
          note: narrative.note || null,
        };
      }
    );

    if (!cached || !cached.ok) {
      return res.status(cached && cached.data && cached.data.error ? 500 : 200).json(cached && cached.data ? cached.data : { ok: false });
    }
    res.json(cached.data);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'kexo-score-summary', rangeKey } });
    console.error('[kexo-score-summary]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = { getKexoScoreSummary };
