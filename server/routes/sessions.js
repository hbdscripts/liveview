/**
 * GET /api/sessions?filter=today|active|recent|abandoned|all
 * GET /api/sessions/:id/events?limit=20
 */

const store = require('../store');

function list(req, res, next) {
  const filter = req.query.filter || 'active';
  const allowed = ['today', 'active', 'recent', 'abandoned', 'all'];
  if (!allowed.includes(filter)) {
    return res.status(400).json({ error: 'Invalid filter' });
  }
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
