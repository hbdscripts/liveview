/**
 * GET /api/sessions?filter=today|active|recent|abandoned|all
 * GET /api/sessions/online-series?minutes=60&stepMinutes=5
 * GET /api/sessions/:id/events?limit=20
 */

const Sentry = require('@sentry/node');
const store = require('../store');

function list(req, res, next) {
  const range = req.query.range;
  const rangeAllowed = ['today', 'yesterday', '3d', '7d', '14d', '30d', '1h', 'sales'];
  const isDayKey = (v) => typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
  const isRangeKey = (v) => typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
  if (range != null && range !== '') {
    if (!rangeAllowed.includes(range) && !isDayKey(range) && !isRangeKey(range)) {
      return res.status(400).json({ error: 'Invalid range' });
    }
    const timezone = req.query.timezone || req.query.timeZone || '';
    const limit = req.query.limit || '25';
    const offset = req.query.offset || '0';
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    Sentry.addBreadcrumb({ category: 'api', message: 'sessions.listByRange', data: { range } });
    store.listSessionsByRange(range, timezone || undefined, limit, offset)
      .then(({ sessions, total }) => res.json({ sessions, total }))
      .catch(err => {
        Sentry.captureException(err, { extra: { route: 'sessions', filter: 'range' } });
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
      });
    return;
  }
  const filter = req.query.filter || 'active';
  const countOnly = req.query.countOnly === '1' || req.query.countOnly === 'true';
  const allowed = ['today', 'active', 'recent', 'abandoned', 'converted', 'all'];
  if (!allowed.includes(filter)) {
    return res.status(400).json({ error: 'Invalid filter' });
  }
  if (filter === 'active' && countOnly) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    Sentry.addBreadcrumb({ category: 'api', message: 'sessions.activeCount' });
    return store.getActiveSessionCount()
      .then(count => res.json({ count }))
      .catch(err => {
        Sentry.captureException(err, { extra: { route: 'sessions', filter: 'active' } });
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
      });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  Sentry.addBreadcrumb({ category: 'api', message: 'sessions.list', data: { filter } });
  store.listSessions(filter)
    .then(rows => res.json({ sessions: rows }))
    .catch(err => {
      Sentry.captureException(err, { extra: { route: 'sessions', filter } });
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

function events(req, res, next) {
  const sessionId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  Sentry.addBreadcrumb({ category: 'api', message: 'sessions.events', data: { sessionId } });
  store.getSessionEvents(sessionId, limit)
    .then(rows => res.json({ events: rows }))
    .catch(err => {
      Sentry.captureException(err, { extra: { route: 'sessions.events', sessionId } });
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

function onlineSeries(req, res) {
  const minutesRaw = req && req.query ? req.query.minutes : null;
  const stepRaw = req && req.query ? req.query.stepMinutes : null;
  const stepMinutes = Math.max(1, Math.min(15, parseInt(String(stepRaw || 1), 10) || 1));
  const minutes = Math.max(stepMinutes * 2, Math.min(60, parseInt(String(minutesRaw || 10), 10) || 10));
  res.setHeader('Cache-Control', 'private, max-age=15');
  res.setHeader('Vary', 'Cookie');
  Sentry.addBreadcrumb({ category: 'api', message: 'sessions.onlineSeries', data: { minutes } });
  store.getActiveSessionSeries(minutes, stepMinutes)
    .then((points) => {
      res.json({
        minutes,
        stepMinutes,
        generatedAt: Date.now(),
        points: Array.isArray(points) ? points : [],
      });
    })
    .catch((err) => {
      Sentry.captureException(err, { extra: { route: 'sessions.onlineSeries', minutes } });
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

function latestSales(req, res) {
  const limitRaw = req && req.query ? req.query.limit : null;
  const limit = Math.max(1, Math.min(20, parseInt(String(limitRaw || 5), 10) || 5));
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  Sentry.addBreadcrumb({ category: 'api', message: 'sessions.latestSales', data: { limit } });
  return store.listLatestSales(limit)
    .then((sales) => res.json({ sales: Array.isArray(sales) ? sales : [] }))
    .catch((err) => {
      Sentry.captureException(err, { extra: { route: 'sessions.latestSales' } });
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { list, onlineSeries, events, latestSales };
