/**
 * POST /api/ingest – pixel events.
 * CORS permissive (Origin: null), INGEST_SECRET auth, validate, rate limit, store, broadcast.
 */

const config = require('../config');
const store = require('../store');
const rateLimit = require('../rateLimit');
const sse = require('../sse');

const ALLOWED_TYPES = store.ALLOWED_EVENT_TYPES;

function ingestRouter(req, res, next) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Ingest-Secret');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.sendStatus(204);
  }

  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');

  const secret = req.headers['x-ingest-secret'] || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  if (!config.ingestSecret || secret !== config.ingestSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (_) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const raw = JSON.stringify(body);
  if (raw.length > config.maxEventPayloadBytes) {
    return res.status(413).json({ error: 'Payload too large' });
  }

  const eventType = body.event_type;
  if (!eventType || !ALLOWED_TYPES.has(eventType)) {
    return res.status(400).json({ error: 'Invalid event_type' });
  }

  const visitorId = body.visitor_id;
  const sessionId = body.session_id;
  if (!visitorId || !sessionId) {
    return res.status(400).json({ error: 'Missing visitor_id or session_id' });
  }

  if (!rateLimit.consume(`v:${visitorId}`) || !rateLimit.consume(`s:${sessionId}`)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  store.isTrackingEnabled().then(enabled => {
    if (!enabled) {
      return res.status(204).end();
    }

    const payload = store.sanitize(body);
    const ts = payload.ts || Date.now();

    return Promise.all([
      store.upsertVisitor(payload),
      store.upsertSession(payload),
    ])
      .then(() => store.insertEvent(sessionId, payload))
      .then(() => Promise.all([store.getSession(sessionId), store.getVisitor(visitorId)]))
      .then(([sessionRow, visitor]) => {
        if (sessionRow) {
          const countryCode = visitor?.last_country || 'XX';
          sse.broadcast({
            type: 'session_update',
            session: {
              ...sessionRow,
              country_code: countryCode,
              is_returning: sessionRow.is_returning ?? 0,
            },
          });
        }
        res.status(200).json({ ok: true });
      })
      .catch(err => {
        console.error('Ingest error:', err);
        res.status(500).json({ error: 'Internal error' });
      });
  }).catch(err => {
    console.error('Ingest error:', err);
    res.status(500).json({ error: 'Internal error' });
  });
}

module.exports = ingestRouter;
