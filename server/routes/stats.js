/**
 * GET /api/stats – sales + conversion ranges (UK midnight) and country stats.
 * Human-only (exclude cf_known_bot=1); bots are blocked at the edge.
 */

const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');

const STATS_MEMO_TTL_MS = 30 * 1000;
const statsMemoByKey = new Map(); // rangeKey -> { at, data, inflight }

const STATS_MEMO_MAX_KEYS = 500;
const STATS_MEMO_DROP_AFTER_MS = 10 * 60 * 1000;
const STATS_MEMO_PRUNE_MIN_INTERVAL_MS = 60 * 1000;
let lastStatsMemoPruneAt = 0;

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return '';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (ALLOWED_RANGE.has(r) || isDayKey || isRangeKey) return r;
  return '';
}

function maybePruneStatsMemo(now) {
  if (!statsMemoByKey.size) return;
  if ((now - lastStatsMemoPruneAt) < STATS_MEMO_PRUNE_MIN_INTERVAL_MS && statsMemoByKey.size <= STATS_MEMO_MAX_KEYS) return;
  lastStatsMemoPruneAt = now;
  try {
    for (const [k, v] of statsMemoByKey) {
      if (v && v.inflight) continue;
      const at = v && v.at != null ? Number(v.at) : 0;
      if (at && (now - at) > STATS_MEMO_DROP_AFTER_MS) statsMemoByKey.delete(k);
    }
    if (statsMemoByKey.size > STATS_MEMO_MAX_KEYS) {
      const entries = Array.from(statsMemoByKey.entries());
      entries.sort((a, b) => (a[1]?.at || 0) - (b[1]?.at || 0));
      let toDrop = statsMemoByKey.size - STATS_MEMO_MAX_KEYS;
      for (let i = 0; i < entries.length && toDrop > 0; i++) {
        const [k, v] = entries[i];
        if (v && v.inflight) continue;
        statsMemoByKey.delete(k);
        toDrop -= 1;
      }
      if (toDrop > 0) {
        for (let i = 0; i < entries.length && toDrop > 0; i++) {
          statsMemoByKey.delete(entries[i][0]);
          toDrop -= 1;
        }
      }
    }
  } catch (_) {}
}

function getStats(req, res, next) {
  Sentry.addBreadcrumb({ category: 'api', message: 'stats.get', data: { range: req?.query?.range, force: !!req?.query?.force } });
  const trafficMode = 'human_only';
  // Stats refresh cadence: manual or every 15 minutes (client). Match with 15 min private cache.
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Vary', 'Cookie');

  const rangeKeyRaw = req && req.query && typeof req.query.range === 'string' ? req.query.range : '';
  const rangeKey = normalizeRangeKey(rangeKeyRaw);
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const timing = !!(req && req.query && (req.query.timing === '1' || req.query.timing === 'true'));
  const now = Date.now();
  maybePruneStatsMemo(now);
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
        Sentry.captureException(err, { extra: { route: 'stats', rangeKey } });
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
      });
    return;
  }

  const timeZone = store.resolveAdminTimeZone();
  const boundsKey = rangeKey || 'today';
  const bounds = store.getRangeBounds(boundsKey, now, timeZone);
  const cacheStart = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : now;
  const cacheEnd = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : now;

  const inflight = reportCache.getOrComputeJson(
    {
      shop: '',
      endpoint: 'stats',
      rangeKey: rangeKey || 'default',
      rangeStartTs: cacheStart,
      rangeEndTs: cacheEnd,
      params: { trafficMode, rangeKey: rangeKey || null },
      ttlMs: 15 * 60 * 1000,
      force,
    },
    () => {
      const t0 = Date.now();
      return store.getStats({ trafficMode, rangeKey: rangeKey || undefined }).then((data) => {
        const totalMs = Date.now() - t0;
        if (timing || totalMs > 2000) {
          console.log('[stats] range=%s ms_total=%s', rangeKey || 'default', totalMs);
        }
        return data;
      });
    }
  )
    .then((r) => {
      if (timing) console.log('[stats] range=%s cacheHit=%s', rangeKey || 'default', r && r.cacheHit ? 1 : 0);
      return r && r.ok ? r.data : null;
    })
    .then((data) => {
      if (!data) throw new Error('stats_cache_failed');
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
      Sentry.captureException(err, { extra: { route: 'stats', rangeKey } });
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { getStats };
