/**
 * POST /api/ingest – pixel events.
 * CORS permissive (Origin: null), INGEST_SECRET auth, validate, rate limit, store, broadcast.
 * Visitor country: prefer Cloudflare CF-IPCountry when the request goes through CF; otherwise
 * derive from client IP (geoip-lite). Shopify Web Pixels API does not expose visitor country.
 */

const Sentry = require('@sentry/node');
const config = require('../config');
const store = require('../store');
const salesEvidence = require('../salesEvidence');
const rateLimit = require('../rateLimit');
const sse = require('../sse');
const affiliateAttribution = require('../fraud/affiliateAttribution');
const fraudService = require('../fraud/service');

let _lastIngestAuthCaptureAt = 0;
let _lastIngestErrorCaptureAt = 0;

function captureIngestAuthMisconfigOnce(msg, extra) {
  const now = Date.now();
  if (_lastIngestAuthCaptureAt && (now - _lastIngestAuthCaptureAt) < 5 * 60 * 1000) return;
  _lastIngestAuthCaptureAt = now;
  try {
    Sentry.captureMessage(msg, { level: 'error', extra: extra && typeof extra === 'object' ? extra : {} });
  } catch (_) {}
}

function captureIngestErrorOnce(err, extra) {
  const now = Date.now();
  if (_lastIngestErrorCaptureAt && (now - _lastIngestErrorCaptureAt) < 30 * 1000) return;
  _lastIngestErrorCaptureAt = now;
  try {
    Sentry.captureException(err, { extra: extra && typeof extra === 'object' ? extra : {} });
  } catch (_) {}
}

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

function normalizeCountryCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  if (c.length !== 2 || c === 'T1' || c === 'XX') return null;
  return c;
}

/** Country from Cloudflare header (when app/ingest is behind CF). CF-IPCountry is two-letter ISO, or "T1" for Tor. */
function countryFromCloudflare(req) {
  return normalizeCountryCode(req.get('cf-ipcountry'));
}

/** Country from Cloudflare Worker headers (x-cf-country). */
function countryFromWorker(req) {
  return normalizeCountryCode(req.get('x-cf-country'));
}

function countryFromIp(ip) {
  if (!geoip || !ip || ip === '::1' || ip === '127.0.0.1') return null;
  const geo = geoip.lookup(ip);
  return geo && typeof geo.country === 'string' && geo.country.length === 2 ? geo.country : null;
}

function cityFromIp(ip) {
  if (!geoip || !ip || ip === '::1' || ip === '127.0.0.1') return null;
  const geo = geoip.lookup(ip);
  const city = geo && typeof geo.city === 'string' ? geo.city.trim() : '';
  if (!city) return null;
  return city.length <= 96 ? city : city.slice(0, 96);
}

function getVisitorCountry(req) {
  const worker = countryFromWorker(req);
  if (worker) return worker;
  const cf = countryFromCloudflare(req);
  if (cf) return cf;
  return countryFromIp(getClientIp(req));
}

/** Parse User-Agent to a short device/OS label (iOS, Android, Windows, Mac, etc.) for the table. */
function parseDeviceFromUserAgent(req) {
  const ua = (req.get('user-agent') || req.get('User-Agent') || '').trim();
  if (!ua) return null;
  const s = ua.toLowerCase();
  // iPadOS can present as "Macintosh" but still includes "Mobile".
  if (/\bmacintosh\b/.test(s) && /\bmobile\b/.test(s) && !/\biphone\b/.test(s) && !/\bipod\b/.test(s)) return 'iOS';
  if (/iphone|ipad|ipod/.test(s)) return 'iOS';
  if (/android/.test(s)) return 'Android';
  if (/windows phone|windows mobile/.test(s)) return 'Windows Phone';
  if (/windows/.test(s)) return 'Windows';
  if (/macintosh|mac os/.test(s)) return 'Mac';
  if (/cros/.test(s)) return 'Chrome OS';
  if (/linux|ubuntu|fedora/.test(s)) return 'Linux';
  return null;
}

/**
 * Parse User-Agent to stable, storage-friendly traffic type fields for sessions.
 * - ua_device_type: desktop | mobile | tablet
 * - ua_platform: windows | mac | ios | android | chromeos | linux | other
 * - ua_model: iphone | ipad | (optional)
 */
function parseTrafficTypeFromUserAgent(req) {
  const ua = (req.get('user-agent') || req.get('User-Agent') || '').trim();
  if (!ua) return null;
  const s = ua.toLowerCase();

  const isIphone = /\biphone\b/.test(s) || /\bipod\b/.test(s);
  // iPadOS can present as "Macintosh" but still includes "Mobile".
  const isIpad = /\bipad\b/.test(s) || (/\bmacintosh\b/.test(s) && /\bmobile\b/.test(s) && !isIphone);
  const isAndroid = /\bandroid\b/.test(s);

  // Form factor heuristics
  let uaDeviceType = 'desktop';
  if (isIpad || /\btablet\b/.test(s) || (isAndroid && !/\bmobile\b/.test(s))) {
    uaDeviceType = 'tablet';
  } else if (/\bmobi\b/.test(s) || isIphone || isAndroid) {
    uaDeviceType = 'mobile';
  }

  // Platform/OS heuristics
  let uaPlatform = 'other';
  if (isIphone || isIpad || /\bipod\b/.test(s)) uaPlatform = 'ios';
  else if (isAndroid) uaPlatform = 'android';
  else if (/\bwindows\b/.test(s)) uaPlatform = 'windows';
  else if (/\bmacintosh\b|\bmac os\b|\bmac os x\b/.test(s)) uaPlatform = 'mac';
  else if (/\bcros\b/.test(s)) uaPlatform = 'chromeos';
  else if (/\blinux\b|\bubuntu\b|\bfedora\b/.test(s)) uaPlatform = 'linux';

  let uaModel = null;
  if (isIphone) uaModel = 'iphone';
  else if (isIpad) uaModel = 'ipad';

  return { uaDeviceType, uaPlatform, uaModel };
}

function parseBrowserFromUserAgent(req) {
  const ua = (req.get('user-agent') || req.get('User-Agent') || '').trim();
  if (!ua) return null;
  const s = ua;

  function m(re) {
    const out = s.match(re);
    return out && out[1] ? String(out[1]).trim() : '';
  }

  // Order matters: many browsers include "Safari" tokens.
  const edge = m(/\bEdgA?iOS?\/([0-9.]+)/) || m(/\bEdg\/([0-9.]+)/);
  if (edge) return { uaBrowser: 'edge', uaBrowserVersion: edge };

  const opera = m(/\bOPR\/([0-9.]+)/) || m(/\bOpera\/([0-9.]+)/);
  if (opera) return { uaBrowser: 'opera', uaBrowserVersion: opera };

  const firefox = m(/\bFxiOS\/([0-9.]+)/) || m(/\bFirefox\/([0-9.]+)/);
  if (firefox) return { uaBrowser: 'firefox', uaBrowserVersion: firefox };

  const samsung = m(/\bSamsungBrowser\/([0-9.]+)/);
  if (samsung) return { uaBrowser: 'samsung', uaBrowserVersion: samsung };

  const chrome = m(/\bCriOS\/([0-9.]+)/) || m(/\bChrome\/([0-9.]+)/);
  if (chrome) return { uaBrowser: 'chrome', uaBrowserVersion: chrome };

  const ie = m(/\bMSIE\s+([0-9.]+)/) || m(/\brv:([0-9.]+)\)\s+like Gecko/i);
  if (ie) return { uaBrowser: 'ie', uaBrowserVersion: ie };

  const safari = m(/\bVersion\/([0-9.]+).*Safari\//);
  if (safari) return { uaBrowser: 'safari', uaBrowserVersion: safari };

  // Best-effort: presence-only (no reliable version token).
  if (/\bSafari\//.test(s)) return { uaBrowser: 'safari', uaBrowserVersion: '' };

  return null;
}

/** Build CF context from Worker-added headers (Phase 2). Keys match parseCfContext in store. */
function getCfContextFromRequest(req) {
  const knownBot = req.get('x-cf-known-bot');
  const category = req.get('x-cf-verified-bot-category');
  const country = req.get('x-cf-country');
  const city = req.get('x-cf-city');
  const colo = req.get('x-cf-colo');
  const asn = req.get('x-cf-asn');
  if (knownBot === undefined && category === undefined && country === undefined && city === undefined && colo === undefined && asn === undefined) {
    return null;
  }
  return {
    cf_known_bot: knownBot,
    cf_verified_bot_category: category,
    cf_country: country,
    cf_city: city,
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
    if (!config.ingestSecret) {
      captureIngestAuthMisconfigOnce('Ingest misconfigured: INGEST_SECRET missing', {
        route: 'ingest',
        path: req && req.path ? String(req.path) : '',
      });
    }
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

  const payload = store.sanitize(body);
  const country = getVisitorCountry(req);
  if (country) payload.country_code = country;
  const deviceFromUA = parseDeviceFromUserAgent(req);
  if (deviceFromUA) payload.device = deviceFromUA;
  const trafficType = parseTrafficTypeFromUserAgent(req);
  if (trafficType) {
    payload.ua_device_type = trafficType.uaDeviceType;
    payload.ua_platform = trafficType.uaPlatform;
    if (trafficType.uaModel) payload.ua_model = trafficType.uaModel;
  }
  const browser = parseBrowserFromUserAgent(req);
  if (browser) {
    payload.ua_browser = browser.uaBrowser;
    if (browser.uaBrowserVersion) payload.ua_browser_version = browser.uaBrowserVersion;
  }
  // Capture Cloudflare/Worker "Referer" (the page URL that triggered ingest) on entry.
  const requestReferer = (req.get('x-request-referer') || req.get('referer') || '').trim().slice(0, 2048);
  // IMPORTANT: do not overwrite the pixel-provided entry_url.
  // Browsers commonly send only the origin (no path/query) as Referer on cross-origin requests,
  // which would drop tracking params like bs_campaign_id / gclid and break ads attribution.
  if ((!payload.entry_url || !String(payload.entry_url).trim()) && requestReferer) {
    payload.entry_url = requestReferer;
  }
  // Fallback referrer from CF/Worker (request Referer) when pixel referrer is stripped (e.g. by Shopify).
  if ((!payload.referrer || !String(payload.referrer).trim()) && requestReferer) {
    payload.referrer = requestReferer;
  }

  const cfContext = getCfContextFromRequest(req);
  if ((!cfContext || !cfContext.cf_city || !String(cfContext.cf_city).trim()) && !payload.city) {
    const ipCity = cityFromIp(getClientIp(req));
    if (ipCity) payload.city = ipCity;
  }
  store.upsertVisitor(payload)
    .then(({ isReturning } = {}) => store.upsertSession(payload, isReturning, cfContext))
    .then(() => {
      // Capture affiliate/paid attribution evidence (fail-open, rate-limited updates).
      const type = payload && typeof payload.event_type === 'string' ? payload.event_type : '';
      const isPageViewed = type === 'page_viewed';
      const isCheckoutCompleted =
        payload &&
        (payload.event_type === 'checkout_completed' ||
          payload.checkout_completed === true ||
          payload.checkout_completed === 1 ||
          payload.checkout_completed === '1');
      const isCheckoutStarted =
        payload &&
        (payload.event_type === 'checkout_started' ||
          payload.checkout_started === true ||
          payload.checkout_started === 1 ||
          payload.checkout_started === '1');
      const shouldCapture = isPageViewed || isCheckoutStarted || isCheckoutCompleted;
      if (!shouldCapture) return null;
      const clientIp = getClientIp(req);
      const ua = (req.get('user-agent') || req.get('User-Agent') || '').trim();
      affiliateAttribution
        .upsertFromIngest({
          sessionId,
          visitorId,
          payload,
          requestUrl: requestReferer,
          clientIp,
          userAgent: ua,
          nowMs: Date.now(),
        })
        .catch(() => null);
      return null;
    })
    .then(() => {
      // On checkout_* events we write purchase_events (append-only evidence) so Shopify truth orders
      // can be attributed to sessions even when checkout_completed is missed.
      //
      // On checkout_completed we ALSO write purchases (order-level dedupe used when ordersSource=pixel).
      const isCheckoutCompleted =
        payload &&
        (payload.event_type === 'checkout_completed' ||
          payload.checkout_completed === true ||
          payload.checkout_completed === 1 ||
          payload.checkout_completed === '1');
      const isCheckoutStarted =
        payload &&
        (payload.event_type === 'checkout_started' ||
          payload.checkout_started === true ||
          payload.checkout_started === 1 ||
          payload.checkout_started === '1');
      if (!isCheckoutCompleted && !isCheckoutStarted) return null;
      const receivedAtMs = Date.now();

      if (!isCheckoutCompleted) {
        return salesEvidence.insertPurchaseEvent(payload, { receivedAtMs, cfContext }).catch(() => null);
      }
      return salesEvidence
        .insertPurchaseEvent(payload, { receivedAtMs, cfContext })
        .catch(() => null)
        .then(() => store.insertPurchase(payload, sessionId, payload.country_code || 'XX'))
        .then(() => {
          // Fraud evaluation (fail-open; never blocks ingest response).
          fraudService.evaluateCheckoutCompleted({ sessionId, payload, receivedAtMs }).catch(() => null);
          return null;
        });
    })
    .then(() => store.insertEvent(sessionId, payload))
    .then(() => Promise.all([store.getSession(sessionId), store.getVisitor(visitorId)]))
    .then(([sessionRow, visitor]) => {
      if (sessionRow) {
        const countryCode =
          normalizeCountryCode(sessionRow.country_code) ||
          normalizeCountryCode(sessionRow.cf_country) ||
          normalizeCountryCode(visitor?.last_country) ||
          normalizeCountryCode(cfContext && cfContext.cf_country) ||
          'XX';
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
      captureIngestErrorOnce(err, {
        route: 'ingest',
        sessionId,
        visitorId,
        eventType: payload && payload.event_type ? String(payload.event_type) : '',
        hasEntryUrl: !!(payload && payload.entry_url),
        hasReferrer: !!(payload && payload.referrer),
      });
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = ingestRouter;
