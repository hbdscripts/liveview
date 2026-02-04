/**
 * GET /api/stats – sales + conversion ranges (UK midnight) and country stats.
 * Human-only (exclude cf_known_bot=1); bots are blocked at the edge.
 */

const store = require('../store');

const STATS_MEMO_TTL_MS = 30 * 1000;
const statsMemoByKey = new Map(); // rangeKey -> { at, data, inflight }

function getStats(req, res, next) {
  const trafficMode = 'human_only';
  // Stats refresh cadence: manual or every 15 minutes (client). Match with 15 min private cache.
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Vary', 'Cookie');

  const rangeKeyRaw = req && req.query && typeof req.query.range === 'string' ? req.query.range : '';
  const rangeKey = rangeKeyRaw ? String(rangeKeyRaw).trim().toLowerCase() : '';
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const now = Date.now();
  const memoKey = rangeKey || '';
  const memo = statsMemoByKey.get(memoKey) || { at: 0, data: null, inflight: null };
  if (!force && memo.data && (now - (memo.at || 0)) < STATS_MEMO_TTL_MS) {
    res.json(memo.data);
    return;
  }
  if (!force && memo.inflight) {
    memo.inflight
      .then((data) => res.json(data))
      .catch((err) => {
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
      });
    return;
  }

  const inflight = store.getStats({ trafficMode, rangeKey: rangeKey || undefined })
    .then((data) => {
      statsMemoByKey.set(memoKey, { at: Date.now(), data, inflight: null });
      return data;
    })
    .catch((err) => {
      const cur = statsMemoByKey.get(memoKey) || memo;
      statsMemoByKey.set(memoKey, { ...cur, inflight: null });
      throw err;
    });

  statsMemoByKey.set(memoKey, { at: memo.at || 0, data: memo.data || null, inflight });

  inflight
    .then((data) => res.json(data))
    .catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { getStats };
