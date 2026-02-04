/**
 * GET /api/sessions?filter=today|active|recent|abandoned|all
 * GET /api/sessions/:id/events?limit=20
 */

const store = require('../store');

function list(req, res, next) {
  const range = req.query.range;
  const rangeAllowed = ['today', 'yesterday', '3d', '7d'];
  if (range != null && range !== '') {
    if (!rangeAllowed.includes(range)) {
      return res.status(400).json({ error: 'Invalid range' });
    }
    const timezone = req.query.timezone || req.query.timeZone || '';
    const limit = req.query.limit || '25';
    const offset = req.query.offset || '0';
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    store.listSessionsByRange(range, timezone || undefined, limit, offset)
      .then(({ sessions, total }) => res.json({ sessions, total }))
      .catch(err => {
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
    return store.getActiveSessionCount()
      .then(count => res.json({ count }))
      .catch(err => {
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
      });
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  store.listSessions(filter)
    .then(rows => res.json({ sessions: rows }))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

function events(req, res, next) {
  const sessionId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  store.getSessionEvents(sessionId, limit)
    .then(rows => res.json({ events: rows }))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { list, events };
