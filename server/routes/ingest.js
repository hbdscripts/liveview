/**
 * POST /api/ingest – pixel events.
 * CORS permissive (Origin: null), INGEST_SECRET auth, validate, rate limit, store, broadcast.
 * Visitor country: prefer Cloudflare CF-IPCountry when the request goes through CF; otherwise
 * derive from client IP (geoip-lite). Shopify Web Pixels API does not expose visitor country.
 */

const config = require('../config');
const store = require('../store');
const rateLimit = require('../rateLimit');
const sse = require('../sse');

let geoip;
try {
  geoip = require('geoip-lite');
} catch (_) {
  geoip = null;
}

function getClientIp(req) {
  const cfIp = req.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

/** Country from Cloudflare header (when app/ingest is behind CF). CF-IPCountry is two-letter ISO, or "T1" for Tor. */
function countryFromCloudflare(req) {
  const cc = req.get('cf-ipcountry');
  if (!cc || typeof cc !== 'string') return null;
  const c = cc.trim().toUpperCase();
  if (c.length !== 2 || c === 'T1' || c === 'XX') return null;
  return c;
}

function countryFromIp(ip) {
  if (!geoip || !ip || ip === '::1' || ip === '127.0.0.1') return null;
  const geo = geoip.lookup(ip);
  return geo && typeof geo.country === 'string' && geo.country.length === 2 ? geo.country : null;
}

function getVisitorCountry(req) {
  const cf = countryFromCloudflare(req);
  if (cf) return cf;
  return countryFromIp(getClientIp(req));
}

/** Parse User-Agent to a short device/OS label (iOS, Android, Windows, Mac, etc.) for the table. */
function parseDeviceFromUserAgent(req) {
  const ua = (req.get('user-agent') || req.get('User-Agent') || '').trim();
  if (!ua) return null;
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return 'iOS';
  if (/android/.test(s)) return 'Android';
  if (/windows phone|windows mobile/.test(s)) return 'Windows Phone';
  if (/windows/.test(s)) return 'Windows';
  if (/macintosh|mac os/.test(s)) return 'Mac';
  if (/cros/.test(s)) return 'Chrome OS';
  if (/linux|ubuntu|fedora/.test(s)) return 'Linux';
  return null;
}

/** Build CF context from Worker-added headers (Phase 2). Keys match parseCfContext in store. */
function getCfContextFromRequest(req) {
  const knownBot = req.get('x-cf-known-bot');
  const category = req.get('x-cf-verified-bot-category');
  const country = req.get('x-cf-country');
  const colo = req.get('x-cf-colo');
  const asn = req.get('x-cf-asn');
  if (knownBot === undefined && category === undefined && country === undefined && colo === undefined && asn === undefined) {
    return null;
  }
  return {
    cf_known_bot: knownBot,
    cf_verified_bot_category: category,
    cf_country: country,
    cf_colo: colo,
    cf_asn: asn,
  };
}

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
    const country = getVisitorCountry(req);
    if (country) payload.country_code = country;
    const deviceFromUA = parseDeviceFromUserAgent(req);
    if (deviceFromUA) payload.device = deviceFromUA;
    // Fallback referrer from CF/Worker (request Referer) when pixel referrer is stripped (e.g. by Shopify).
    if (!payload.referrer || !String(payload.referrer).trim()) {
      const cfReferer = (req.get('x-request-referer') || '').trim().slice(0, 2048);
      if (cfReferer) payload.referrer = cfReferer;
    }
    const ts = payload.ts || Date.now();

    const cfContext = getCfContextFromRequest(req);
    return store.upsertVisitor(payload)
      .then(() => store.upsertSession(payload, undefined, cfContext))
      .then(() => {
        if (payload.checkout_completed) {
          return store.insertPurchase(payload, sessionId, payload.country_code);
        }
      })
      .then(() => store.insertEvent(sessionId, payload))
      .then(() => Promise.all([store.getSession(sessionId), store.getVisitor(visitorId)]))
      .then(([sessionRow, visitor]) => {
        if (sessionRow) {
          const countryCode = sessionRow.country_code || visitor?.last_country || 'XX';
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
