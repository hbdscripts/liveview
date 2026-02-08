/**
 * Cloudflare Worker: Kexo ingest edge proxy.
 * Enriches ingest requests with CF metadata, blocks bots + junk at the edge,
 * fire-and-forgets to origin so the shopper is never blocked.
 *
 * Deploy on the ingest hostname (e.g. ingest.kexo.io) in the kexo.io CF zone.
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

const ALLOWED_HOSTS = ['ingest.kexo.io'];
const EXPOSE = 'x-lv-edge-result,x-lv-blocked,x-cf-known-bot,x-cf-country,x-cf-colo,x-cf-asn,x-cf-verified-bot-category';

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
  const colo = s(cf.colo).trim();
  const asn = s(cf.asn).trim();
  return { verifiedBot, verifiedBotCategory, country: country.length === 2 ? country.toUpperCase() : '', colo: colo ? colo.slice(0, 32) : '', asn: asn ? asn.slice(0, 32) : '' };
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

export default { async fetch(request, env, ctx) {
  const originUrl = s(env.ORIGIN_URL).trim();
  if (!originUrl) return new Response('ORIGIN_URL not configured', { status: 500 });

  const ingestSecret = s(env.INGEST_SECRET).trim();
  const url = new URL(request.url);
  const host = (url.hostname || '').toLowerCase();
  const path = url.pathname || '';
  const method = (request.method || 'GET').toUpperCase();

  // Kill workers.dev + wrong-host bypass
  if (ALLOWED_HOSTS.indexOf(host) === -1) {
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'host_denied', 'x-lv-blocked': 'host', 'x-cf-known-bot': '0', 'x-cf-country': '', 'x-cf-colo': '', 'x-cf-asn': '', 'x-cf-verified-bot-category': '' });
    return new Response(null, { status: 404, headers: h });
  }

  // Strict ingest path only
  const isIngest = (path === '/api/ingest' || path.startsWith('/api/ingest/'));
  if (!isIngest) {
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'bad_path', 'x-lv-blocked': 'path', 'x-cf-known-bot': '0', 'x-cf-country': '', 'x-cf-colo': '', 'x-cf-asn': '', 'x-cf-verified-bot-category': '' });
    return new Response(null, { status: 404, headers: h });
  }

  // Preflight
  if (method === 'OPTIONS') {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'preflight'), { 'x-lv-edge-result': 'preflight', 'x-lv-blocked': '', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 204, headers: h });
  }

  // POST only
  if (method !== 'POST') {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'bad_method', 'x-lv-blocked': 'method', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 405, headers: h });
  }

  // Junk gating
  const ua = s(request.headers.get('user-agent')).trim();
  if (!ua) {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_junk', 'x-lv-blocked': 'no_ua', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 403, headers: h });
  }
  if (isToolUa(ua)) {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_junk', 'x-lv-blocked': 'ua', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 403, headers: h });
  }

  // Offsite gate only when Origin exists (fail-open)
  const origin = s(request.headers.get('origin')).trim();
  if (origin && !isAllowedOrigin(origin)) {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_offsite', 'x-lv-blocked': 'origin', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
    return new Response(null, { status: 403, headers: h });
  }

  // Size cap
  const cl = parseInt(s(request.headers.get('content-length')).trim(), 10);
  if (Number.isFinite(cl) && cl > 256 * 1024) {
    const d = cfDbg(request);
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_junk', 'x-lv-blocked': 'payload_too_large', 'x-cf-known-bot': '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
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
    const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'dropped_bot', 'x-lv-blocked': 'bot', 'x-cf-known-bot': '1', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
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
  const h = withDbgHeaders(cors(request, 'normal'), { 'x-lv-edge-result': 'accepted', 'x-lv-blocked': '', 'x-cf-known-bot': knownBot ? '1' : '0', 'x-cf-country': d.country, 'x-cf-colo': d.colo, 'x-cf-asn': d.asn, 'x-cf-verified-bot-category': d.verifiedBotCategory || '' });
  return new Response(null, { status: 200, headers: h });
} };
