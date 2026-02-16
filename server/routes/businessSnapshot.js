const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');
const businessSnapshotService = require('../businessSnapshotService');
const { PROFIT_RULES_V1_KEY, normalizeProfitRulesConfigV1 } = require('../profitRulesConfig');

const SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;

function ymdInTimeZone(ts, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const ymd = fmt.format(new Date(Number(ts) || Date.now()));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  } catch (_) {}
  try {
    return new Date(Number(ts) || Date.now()).toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

async function readProfitRulesFingerprint() {
  try {
    const raw = await store.getSetting(PROFIT_RULES_V1_KEY);
    const normalized = normalizeProfitRulesConfigV1(raw);
    return reportCache.hashParams(normalized);
  } catch (_) {
    return reportCache.hashParams({});
  }
}

async function getBusinessSnapshot(req, res) {
  const modeRaw = req && req.query && req.query.mode != null ? String(req.query.mode) : '';
  const yearRaw = req && req.query && req.query.year != null ? String(req.query.year) : '';
  const monthRaw = req && req.query && req.query.month != null ? String(req.query.month) : '';
  const sinceRaw = req && req.query && req.query.since != null ? String(req.query.since) : '';
  const untilRaw = req && req.query && req.query.until != null ? String(req.query.until) : '';
  const presetRaw = req && req.query && req.query.preset != null ? String(req.query.preset) : '';
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  try {
    const now = Date.now();
    const timeZone = store.resolveAdminTimeZone();
    const nowYmd = ymdInTimeZone(now, timeZone) || new Date(now).toISOString().slice(0, 10);
    const resolved = businessSnapshotService.resolveSnapshotWindows({
      mode: modeRaw,
      year: yearRaw,
      month: monthRaw,
      since: sinceRaw,
      until: untilRaw,
      preset: presetRaw,
    }, nowYmd);

    const rangeKey = `r:${resolved.currentWindow.startYmd}:${resolved.currentWindow.endYmd}`;
    const compareRangeKey = `r:${resolved.previousWindow.startYmd}:${resolved.previousWindow.endYmd}`;
    const bounds = store.getRangeBounds(rangeKey, now, timeZone);
    const compareBounds = store.getRangeBounds(compareRangeKey, now, timeZone);
    const profitRulesFingerprint = await readProfitRulesFingerprint();
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'business-snapshot',
        rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: {
          mode: resolved.mode,
          year: resolved.selectedYear,
          month: resolved.selectedMonth,
          preset: resolved.preset || null,
          since: resolved.currentWindow.startYmd,
          until: resolved.currentWindow.endYmd,
          compareSince: resolved.previousWindow.startYmd,
          compareUntil: resolved.previousWindow.endYmd,
          compareRangeStartTs: compareBounds.start,
          compareRangeEndTs: compareBounds.end,
          profitRulesFingerprint,
          snapshotUiVersion: 'snapshot-page-v3',
        },
        ttlMs: SNAPSHOT_CACHE_TTL_MS,
        force,
      },
      async () => businessSnapshotService.getBusinessSnapshot({
        mode: resolved.mode,
        year: resolved.selectedYear,
        month: resolved.selectedMonth,
        since: resolved.currentWindow.startYmd,
        until: resolved.currentWindow.endYmd,
        preset: resolved.preset || '',
      })
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    res.json(cached && cached.ok ? cached.data : null);
  } catch (err) {
    Sentry.captureException(err, {
      extra: {
        route: 'businessSnapshot',
        mode: modeRaw,
        year: yearRaw,
        month: monthRaw,
        since: sinceRaw,
        until: untilRaw,
        preset: presetRaw,
      },
    });
    res.status(500).json({ ok: false, error: 'Failed to load business snapshot' });
  }
}

module.exports = {
  getBusinessSnapshot,
};
