/**
 * GET /api/kpis?range=today|yesterday|3d|7d|14d|30d|month|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD
 * Lightweight KPIs for the top grid (polled frequently).
 */
const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');
const businessSnapshotService = require('../businessSnapshotService');

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

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round2(v) {
  const n = numOrNull(v);
  if (n == null) return null;
  return Math.round(n * 100) / 100;
}

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
    const payload = cached && cached.ok ? cached.data : null;
    if (payload && typeof payload === 'object') {
      try {
        const sinceYmd = ymdInTimeZone(bounds.start, timeZone);
        const untilYmd = ymdInTimeZone(Math.max(bounds.start, bounds.end - 1), timeZone);
        if (sinceYmd && untilYmd) {
          const profitCached = await reportCache.getOrComputeJson(
            {
              shop: '',
              endpoint: 'kpis_profit',
              rangeKey,
              rangeStartTs: bounds.start,
              rangeEndTs: bounds.end,
              params: { rangeKey, since: sinceYmd, until: untilYmd },
              ttlMs: 120 * 1000,
              force,
            },
            async () => {
              const singleDay = sinceYmd === untilYmd;
              const snapshot = await businessSnapshotService.getBusinessSnapshot({
                mode: 'range',
                since: sinceYmd,
                until: untilYmd,
                granularity: singleDay ? 'hour' : 'day',
              });
              const fin = snapshot && snapshot.financial && typeof snapshot.financial === 'object'
                ? snapshot.financial
                : null;
              const profitMeta = fin && fin.profit && typeof fin.profit === 'object'
                ? fin.profit
                : null;
              const costMetric = fin && fin.cost && typeof fin.cost === 'object'
                ? fin.cost
                : null;
              const revenueMetric = fin && fin.revenue && typeof fin.revenue === 'object'
                ? fin.revenue
                : null;

              const costNow = numOrNull(costMetric && costMetric.value);
              const costPrev = numOrNull(costMetric && costMetric.previous);
              const revNow = numOrNull(revenueMetric && revenueMetric.value);
              const revPrev = numOrNull(revenueMetric && revenueMetric.previous);

              const profitEnabled = !!(profitMeta && profitMeta.enabled === true);
              const profitKpiAllowed = profitEnabled;
              const profitNow = (revNow != null && costNow != null) ? round2(revNow - costNow) : null;
              const profitPrev = (revPrev != null && costPrev != null) ? round2(revPrev - costPrev) : null;

              let profitSparkline = null;
              try {
                const series = snapshot && snapshot.series && typeof snapshot.series === 'object' ? snapshot.series : null;
                const revSeries = Array.isArray(series && series.revenueGbp) ? series.revenueGbp : null;
                const costSeries = Array.isArray(series && series.costGbp) ? series.costGbp : null;
                if (revSeries && costSeries) {
                  const n = Math.min(revSeries.length, costSeries.length);
                  if (n >= 2) {
                    const out = [];
                    for (let i = 0; i < n; i += 1) {
                      const r = numOrNull(revSeries[i]);
                      const c = numOrNull(costSeries[i]);
                      out.push((r != null && c != null) ? round2(r - c) : null);
                    }
                    profitSparkline = out;
                  }
                }
              } catch (_) {}

              return {
                profitKpiAllowed,
                profitNow: profitKpiAllowed ? profitNow : null,
                profitPrev: profitKpiAllowed ? profitPrev : null,
                costNow: profitKpiAllowed ? costNow : null,
                costPrev: profitKpiAllowed ? costPrev : null,
                profitSparkline: profitKpiAllowed ? profitSparkline : null,
              };
            }
          );
          const profitData = profitCached && profitCached.ok ? profitCached.data : null;
          const safeProfitData = profitData && typeof profitData === 'object' ? profitData : null;
          const profitKpiAllowed = !!(safeProfitData && safeProfitData.profitKpiAllowed === true);

          payload.profitKpiAllowed = profitKpiAllowed;
          payload.profit = { [rangeKey]: safeProfitData ? safeProfitData.profitNow : null };
          payload.cost = { [rangeKey]: safeProfitData ? safeProfitData.costNow : null };
          if (!payload.compare || typeof payload.compare !== 'object') payload.compare = {};
          payload.compare.profit = safeProfitData ? safeProfitData.profitPrev : null;
          payload.compare.cost = safeProfitData ? safeProfitData.costPrev : null;
          payload.profitSparkline = (profitKpiAllowed && safeProfitData && Array.isArray(safeProfitData.profitSparkline))
            ? safeProfitData.profitSparkline
            : null;
        }
      } catch (_) {}
    }
    res.json(payload);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'kpis', rangeKey } });
    console.error('[kpis]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

module.exports = { getKpis };

