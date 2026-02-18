/**
 * Cloudflare Worker: Kexo ingest edge proxy.
 * Enriches ingest requests with CF metadata, blocks bots + junk at the edge,
 * fire-and-forgets to origin so the shopper is never blocked.
 *
 * ========================= LIVE ON CLOUDFLARE =========================
 * Worker name: liveview-ingest-enrich
 * Live version id: 9da4afd5 (as of Feb 18, 2026)
 * Routes/hosts:
 * - ingest.kexo.io/api/ingest*
 * - lv-ingest.hbdjewellery.com/api/ingest*
 * Env vars:
 * - ORIGIN_URL
 * - BLOCK_KNOWN_BOTS
 * - INGEST_SECRET
 * Transform rule note: sets x-lv-client-bot=1 when cf.client.bot eq true
 *
 * Keep this file in sync with live Worker behaviour when you deploy changes.
 *
 * Changelog:
 * - Feb 18, 2026: log edge blocks (blocked-only) to origin /api/edge-blocked.
 * ======================================================================
 *
 * Env vars (set in Worker Settings → Variables):
 * - ORIGIN_URL (required): e.g. https://app.kexo.io
 * - BLOCK_KNOWN_BOTS (optional): "1" to drop verified bots at the edge.
 * - INGEST_SECRET (optional): same as app's INGEST_SECRET; used for /api/bot-blocked counter.
 *
 * Also add a Cloudflare Request Header Transform Rule on the zone:
 *   Set x-lv-client-bot = 1  when  cf.client.bot eq true
 *   (scope to path /api/ingest if desired)
 */

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }
function isTruthy(v) { const t = s(v).trim().toLowerCase(); return t === '1' || t === 'true' || t === 'yes'; }

const ALLOWED_HOSTS = ['ingest.kexo.io', 'lv-ingest.hbdjewellery.com'];
const EXPOSE = 'x-lv-edge-result,x-lv-blocked,x-cf-known-bot,x-cf-country,x-cf-city,x-cf-region,x-cf-timezone,x-cf-colo,x-cf-asn,x-cf-verified-bot-category,cf-ray';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    const host = (u.hostname || '').toLowerCase();
    if (u.protocol !== 'https:') return false;
    // Kexo domains
    if (host === 'kexo.io' || host === 'www.kexo.io') return true;
    if (host.endsWith('.kexo.io')) return true;
    // Client store domains
    if (host === 'hbdjewellery.com' || host === 'www.hbdjewellery.com') return true;
    if (host.endsWith('.hbdjewellery.com')) return true;
    if (host === 'heybigday.com' || host === 'www.heybigday.com') return true;
    if (host.endsWith('.heybigday.com')) return true;
    // Shopify domains (pixel runs in sandbox on these)
    if (host.endsWith('.myshopify.com')) return true;
    if (host === 'checkout.shopify.com' || host.endsWith('.shopify.com')) return true;
    return false;
  } catch (_) { return false; }
}

function cors(req, mode) {
  const origin = s(req.headers.get('origin')).trim();
  const allowOrigin = isAllowedOrigin(origin) ? origin : '*';
  const h = { 'access-control-allow-origin': allowOrigin, 'access-control-expose-headers': EXPOSE, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (mode === 'preflight') {
    const acrh = s(req.headers.get('access-control-request-headers')).trim();
    h['access-control-allow-methods'] = 'POST, OPTIONS';
    h['access-control-allow-headers'] = acrh ? acrh : 'content-type';
    h['access-control-max-age'] = '86400';
    h['vary'] = 'origin, access-control-request-method, access-control-request-headers';
  } else {
    h['vary'] = 'origin';
  }
  return h;
}

function cfDbg(request) {
  const cf = request.cf || {};
  const bm = cf.botManagement || {};
  const verifiedBot = bm && bm.verifiedBot === true;
  const verifiedBotCategory = s(cf.verifiedBotCategory || bm.verifiedBotCategory).trim();
  const country = s(cf.country).trim();
  const city = s(cf.city).trim();
  const region = s(cf.region).trim();
  const timezone = s(cf.timezone).trim();
  const colo = s(cf.colo).trim();
  const asn = s(cf.asn).trim();
  return {
    verifiedBot,
    verifiedBotCategory,
    country: country.length === 2 ? country.toUpperCase() : '',
    city: city ? city.slice(0, 96) : '',
    region: region ? region.slice(0, 96) : '',
    timezone: timezone ? timezone.slice(0, 64) : '',
    colo: colo ? colo.slice(0, 32) : '',
    asn: asn ? asn.slice(0, 32) : ''
  };
}

function isToolUa(ua) {
  const u = ua.toLowerCase();
  return u.includes('curl') || u.includes('wget') || u.includes('python-requests') || u.includes('python/') || u.includes('requests/') || u.includes('postman') || u.includes('insomnia') || u.includes('httpie') || u.includes('powershell') || u.includes('go-http-client') || u.includes('node-fetch') || u.includes('undici') || u.includes('okhttp');
}

function withDbgHeaders(base, dbg) {
  const h = new Headers(base);
  for (const [k, v] of Object.entries(dbg || {})) h.set(k, s(v));
  return h;
}

async function postToOrigin(url, headers, bodyBuf) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    return await fetch(url, { method: 'POST', headers, body: bodyBuf, signal: ac.signal, duplex: 'half' });
  } finally {
    clearTimeout(t);
  }
}

function truncate(v, maxLen) {
  const out = s(v).trim();
  if (!out) return '';
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function ipv4Prefix(ip) {
  const m = s(ip).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return '';
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3]), d = Number(m[4]);
  if (![a, b, c, d].every(n => Number.isFinite(n) && n >= 0 && n <= 255)) return '';
  return String(a) + '.' + String(b) + '.' + String(c) + '.0/24';
}

function ipv6Prefix(ip) {
  const raw = s(ip).trim();
  if (!raw || raw.indexOf(':') === -1) return '';
  const parts = raw.split(':').filter(Boolean);
  if (parts.length < 4) return '';
  const head = parts.slice(0, 4).join(':');
  return head + '::/64';
}

function ipPrefixFromIp(ip) {
  const raw = s(ip).trim();
  if (!raw) return '';
  return raw.indexOf(':') !== -1 ? ipv6Prefix(raw) : ipv4Prefix(raw);
}

async function sha256Hex(input) {
  const enc = new TextEncoder().encode(s(input));
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function sample(rate) {
  const r = typeof rate === 'number' && isFinite(rate) ? rate : 0;
  if (r >= 1) return true;
  if (r <= 0) return false;
  try { return Math.random() < r; } catch (_) { return false; }
}

function sampleRateFor(edgeResult, blockedReason) {
  const er = s(edgeResult).trim().toLowerCase();
  const br = s(blockedReason).trim().toLowerCase();
  if (er === 'dropped_bot' || br === 'bot') return 1;
  if (er === 'host_denied' || er === 'bad_path' || er === 'bad_method') return 1;
  if (br === 'host' || br === 'path' || br === 'method') return 1;
  if (br === 'no_ua' || br === 'ua' || br === 'origin' || br === 'payload_too_large') return 0.1;
  return 0.25;
}

function scheduleEdgeBlockedLog(ctx, env, request, details) {
  try {
    const ingestSecret = s(env.INGEST_SECRET).trim();
    if (!ingestSecret) return;
    const originUrl = s(env.ORIGIN_URL).trim();
    if (!originUrl) return;
    const url = new URL(request.url);
    const reqHost = (url.hostname || '').toLowerCase();
    let originHost = '';
    try { originHost = (new URL(originUrl)).hostname.toLowerCase(); } catch (_) { originHost = ''; }
    // Guard against recursion (Worker calling itself).
    if (originHost && originHost === reqHost) return;

    const edgeResult = s(details.edge_result).trim();
    const blockedReason = s(details.blocked_reason).trim();
    const rate = sampleRateFor(edgeResult, blockedReason);
    if (!sample(rate)) return;

    const method = s(details.http_method).trim();
    const path = s(details.path).trim();
    const host = s(details.host).trim();
    const ua = truncate(details.ua, 512);
    const origin = truncate(details.origin, 512);
    const referer = truncate(details.referer, 512);

    const d = details.cf || {};
    const rayId = truncate(details.ray_id, 96);
    const ip = s(details.ip).trim();
    const ipPrefix = ip ? ipPrefixFromIp(ip) : '';
    const tenantKey = host || reqHost || '';

    const postUrl = originUrl.replace(/\/$/, '') + '/api/edge-blocked';

    ctx.waitUntil((async () => {
      try {
        const ipHash = ip ? (await sha256Hex(ingestSecret + '|' + ip)).slice(0, 64) : '';
        const payload = {
          edge_result: edgeResult,
          blocked_reason: blockedReason,
          http_method: method,
          host: host || reqHost,
          path,
          ray_id: rayId,
          country: s(d.country || '').trim(),
          colo: s(d.colo || '').trim(),
          asn: s(d.asn || '').trim(),
          known_bot: s(d.knownBot || '') ? d.knownBot : (details.known_bot ? 1 : 0),
          verified_bot_category: s(d.verifiedBotCategory || '').trim(),
          ua,
          origin,
          referer,
          ip_prefix: ipPrefix,
          ip_hash: ipHash,
          tenant_key: tenantKey
        };
        await fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': ingestSecret },
          body: JSON.stringify(payload)
        }).catch(() => {});
      } catch (_) {}
    })());
  } catch (_) {}
}

export default { async fetch(request, env, ctx) {
  const originUrl = s(env.ORIGIN_URL).trim();
  if (!originUrl) return new Response('ORIGIN_URL not configured', { status: 500 });

  const ingestSecret = s(env.INGEST_SECRET).trim();
  const url = new URL(request.url);
  const host = (url.hostname || '').toLowerCase();
  const path = url.pathname || '';
  const method = (request.method || 'GET').toUpperCase();
  const referer = s(request.headers.get('referer')).trim();
  const rayId = s(request.headers.get('cf-ray')).trim();
  const clientIp = s(request.headers.get('cf-connecting-ip')).trim();

  // Kill workers.dev + wrong-host bypass
  if (ALLOWED_HOSTS.indexOf(host) === -1) {
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'host_denied',
      blocked_reason: 'host',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua: s(request.headers.get('user-agent')).trim(),
      origin: s(request.headers.get('origin')).trim(),
      referer,
      ip: clientIp,
      cf: cfDbg(request),
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'host_denied', 'x-lv-blocked': 'host', 'x-cf-known-bot': '0', 'x-cf-country': '', 'x-cf-colo': '', 'x-cf-asn': '', 'x-cf-verified-bot-category': '' });
    return new Response(null, { status: 404, headers: h });
  }

  // Strict ingest path only
  const isIngest = (path === '/api/ingest' || path.startsWith('/api/ingest/'));
  if (!isIngest) {
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'bad_path',
      blocked_reason: 'path',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua: s(request.headers.get('user-agent')).trim(),
      origin: s(request.headers.get('origin')).trim(),
      referer,
      ip: clientIp,
      cf: cfDbg(request),
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'bad_path', 'x-lv-blocked': 'path', 'x-cf-known-bot': '0', 'x-cf-country': '', 'x-cf-colo': '', 'x-cf-asn': '', 'x-cf-verified-bot-category': '' });
    return new Response(null, { status: 404, headers: h });
  }

  // Preflight
  if (method === 'OPTIONS') {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'preflight'), { 'x-lv-edge-result': 'preflight', 'x-lv-blocked': '', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 204, headers: h });
  }

  // POST only
  if (method !== 'POST') {
    const d = cfDbg(request);
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'bad_method',
      blocked_reason: 'method',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua: s(request.headers.get('user-agent')).trim(),
      origin: s(request.headers.get('origin')).trim(),
      referer,
      ip: clientIp,
      cf: d,
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'bad_method', 'x-lv-blocked': 'method', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 405, headers: h });
  }

  // Junk gating
  const ua = s(request.headers.get('user-agent')).trim();
  if (!ua) {
    const d = cfDbg(request);
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'dropped_junk',
      blocked_reason: 'no_ua',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua: '',
      origin: s(request.headers.get('origin')).trim(),
      referer,
      ip: clientIp,
      cf: d,
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_junk', 'x-lv-blocked': 'no_ua', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 403, headers: h });
  }
  if (isToolUa(ua)) {
    const d = cfDbg(request);
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'dropped_junk',
      blocked_reason: 'ua',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua,
      origin: s(request.headers.get('origin')).trim(),
      referer,
      ip: clientIp,
      cf: d,
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_junk', 'x-lv-blocked': 'ua', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 403, headers: h });
  }

  // Offsite gate only when Origin exists (fail-open)
  const origin = s(request.headers.get('origin')).trim();
  if (origin && !isAllowedOrigin(origin)) {
    const d = cfDbg(request);
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'dropped_offsite',
      blocked_reason: 'origin',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua,
      origin,
      referer,
      ip: clientIp,
      cf: d,
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_offsite', 'x-lv-blocked': 'origin', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 403, headers: h });
  }

  // Size cap
  const cl = parseInt(s(request.headers.get('content-length')).trim(), 10);
  if (Number.isFinite(cl) && cl > 256 * 1024) {
    const d = cfDbg(request);
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'dropped_junk',
      blocked_reason: 'payload_too_large',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua,
      origin,
      referer,
      ip: clientIp,
      cf: d,
      known_bot: 0
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_junk', 'x-lv-blocked': 'payload_too_large', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 413, headers: h });
  }

  // Bot signal (fail-open)
  const d = cfDbg(request);
  const clientBot = isTruthy(request.headers.get('x-lv-client-bot'));
  const knownBot = clientBot || d.verifiedBot || !!d.verifiedBotCategory;

  // Bot drop at edge
  if (isTruthy(env.BLOCK_KNOWN_BOTS) && knownBot) {
    if (ingestSecret) {
      ctx.waitUntil(fetch(originUrl.replace(/\/$/, '') + '/api/bot-blocked', { method: 'POST', headers: { 'X-Internal-Secret': ingestSecret } }).catch(() => {}));
    }
    scheduleEdgeBlockedLog(ctx, env, request, {
      edge_result: 'dropped_bot',
      blocked_reason: 'bot',
      http_method: method,
      host,
      path,
      ray_id: rayId,
      ua,
      origin,
      referer,
      ip: clientIp,
      cf: d,
      known_bot: 1
    });
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_bot', 'x-lv-blocked': 'bot', 'x-cf-known-bot': '1', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 202, headers: h });
  }

  // Read body once so we can send it in background
  let bodyBuf;
  try {
    bodyBuf = await request.arrayBuffer();
  } catch (_) {
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'accepted_body_read_error', 'x-lv-blocked': '', 'x-cf-known-bot': knownBot ? '1' : '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 200, headers: h });
  }

  // Build origin request headers (auth + enrichment)
  const upstreamUrl = originUrl.replace(/\/$/, '') + path + url.search;
  const newHeaders = new Headers(request.headers);
  newHeaders.delete('host');
  newHeaders.set('x-cf-known-bot', knownBot ? '1' : '0');
  if (d.verifiedBotCategory) newHeaders.set('x-cf-verified-bot-category', d.verifiedBotCategory);
  if (d.country) newHeaders.set('x-cf-country', d.country);
  if (d.city) newHeaders.set('x-cf-city', d.city);
  if (d.region) newHeaders.set('x-cf-region', d.region);
  if (d.timezone) newHeaders.set('x-cf-timezone', d.timezone);
  if (d.colo) newHeaders.set('x-cf-colo', d.colo);
  if (d.asn) newHeaders.set('x-cf-asn', d.asn);
  if (ingestSecret) newHeaders.set('X-Internal-Secret', ingestSecret);

  // Fire-and-forget to origin; never block the shopper
  ctx.waitUntil((async () => {
    try {
      const r = await postToOrigin(upstreamUrl, newHeaders, bodyBuf);
      void r;
    } catch (_) {}
  })());

  // Immediate success response to browser
  const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'accepted', 'x-lv-blocked': '', 'x-cf-known-bot': knownBot ? '1' : '0', 'x-cf-country': d.country, 'x-cf-city': d.city, 'x-cf-region': d.region, 'x-cf-timezone': d.timezone, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
  return new Response(null, { status: 200, headers: h });
} };
