/**
 * Cloudflare Worker: enrich ingest requests with CF metadata; optionally block all known bots at the edge.
 * Deploy on the ingest hostname/path so POST /api/ingest goes through CF.
 *
 * Env vars:
 * - ORIGIN_URL (required): e.g. https://your-app.up.railway.app
 * - BLOCK_KNOWN_BOTS (optional): "1" to block known/verified bots (Google, Bing, Merchant Center, etc.) at the edge so they never reach your app or DB.
 *
 * To filter all bots you must also add a Cloudflare Request Header Transform Rule that sets
 * x-lv-client-bot = 1 when cf.client.bot eq true (and optionally scope to path /api/ingest).
 * Without that rule, request.cf.botManagement may be empty on some plans. See docs/CLOUDFLARE_INGEST_SETUP.md.
 *
 * Bot signal (in order of use):
 * 1. Header x-lv-client-bot (set by Transform Rule from cf.client.bot) – covers verified crawlers.
 * 2. request.cf.botManagement.verifiedBot and verifiedBotCategory – best-effort, may be empty.
 */

function str(v) {
  try { return v == null ? '' : String(v); } catch (_) { return ''; }
}
function truthyHeader(v) {
  const s = str(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes';
}

export default {
  async fetch(request, env, ctx) {
    const originUrl = str(env.ORIGIN_URL).trim();
    if (!originUrl) return new Response('ORIGIN_URL not configured', { status: 500 });

    const url = new URL(request.url);
    const path = url.pathname;
    const ingestPath = '/api/ingest';
    const isIngest = path === ingestPath || path.endsWith(ingestPath);

    // Forward anything not ingest as-is (strip Host header).
    if (!isIngest) {
      const origin = originUrl.replace(/\/$/, '') + path + url.search;
      const initHeaders = new Headers(request.headers);
      initHeaders.delete('host');

      const init = { method: request.method, headers: initHeaders };
      if (request.body != null && request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = request.body;
        init.duplex = 'half';
      }
      return fetch(new Request(origin, init));
    }

    // Handle preflight at the edge to avoid silent pixel failures.
    if (request.method === 'OPTIONS') {
      const reqHdrs = request.headers.get('access-control-request-headers') || 'content-type';
      const reqMeth = request.headers.get('access-control-request-method') || 'POST';
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': `${reqMeth}, OPTIONS`,
          'access-control-allow-headers': reqHdrs,
          'access-control-max-age': '86400',
          'vary': 'origin, access-control-request-method, access-control-request-headers',
        },
      });
    }

    // Build CF enrichment headers (fail-open).
    let enrich = {};
    let knownBot = false;

    try {
      // Preferred bot signal - injected by a Cloudflare Request Header Transform Rule from cf.client.bot.
      // CF does not allow setting x-cf-* or cf-* headers, so the rule uses x-lv-client-bot (see CLOUDFLARE_INGEST_SETUP.md).
      const clientBotHeader =
        request.headers.get('x-lv-client-bot') ||
        request.headers.get('x-cf-client-bot') ||
        request.headers.get('cf-client-bot') ||
        '';

      const clientBot = truthyHeader(clientBotHeader);

      // Secondary best-effort signal (may be empty on your plan):
      const cf = request.cf || {};
      const botManagement = cf.botManagement || {};
      const verifiedBot = botManagement && botManagement.verifiedBot === true;
      const verifiedBotCategory = str(cf.verifiedBotCategory || botManagement.verifiedBotCategory).trim();

      knownBot = clientBot || verifiedBot || !!verifiedBotCategory;

      const country = str(cf.country).trim();
      const colo = str(cf.colo).trim();
      const asn = str(cf.asn).trim();

      enrich = {
        'x-cf-client-bot': clientBotHeader ? (truthyHeader(clientBotHeader) ? '1' : '0') : '',
        'x-cf-known-bot': knownBot ? '1' : '0',
        'x-cf-verified-bot-category': verifiedBotCategory || '',
        'x-cf-country': country.length === 2 ? country.toUpperCase() : '',
        'x-cf-colo': colo ? colo.slice(0, 32) : '',
        'x-cf-asn': asn ? asn.slice(0, 32) : '',
      };
    } catch (_) {
      enrich = { 'x-cf-known-bot': '0' };
      knownBot = false;
    }

    // Optional: block known bots at ingest so they never enter your DB.
    if (str(env.BLOCK_KNOWN_BOTS).trim() === '1' && knownBot) {
      const botBlockSecret = str(env.INGEST_SECRET).trim();
      if (botBlockSecret) {
        ctx.waitUntil(
          fetch(originUrl.replace(/\/$/, '') + '/api/bot-blocked', {
            method: 'POST',
            headers: { 'X-Internal-Secret': botBlockSecret },
          }).catch(() => {})
        );
      }
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'vary': 'origin',
          'x-lv-blocked': 'bot', // visible in Workers Logs / Tail so you can see blocks
        },
      });
    }

    // Forward ingest to origin with enrichment headers.
    const origin = originUrl.replace(/\/$/, '') + path + url.search;
    const newHeaders = new Headers(request.headers);
    newHeaders.delete('host');

    for (const [k, v] of Object.entries(enrich)) {
      if (v !== undefined && v !== null && String(v).length) newHeaders.set(k, String(v));
    }

    try {
      const upstream = await fetch(
        new Request(origin, {
          method: request.method,
          headers: newHeaders,
          body: request.body,
          duplex: 'half',
        })
      );

      // Make sure the browser can read the response.
      const out = new Response(upstream.body, upstream);
      out.headers.set('access-control-allow-origin', '*');
      out.headers.set('vary', 'origin');
      return out;
    } catch (_) {
      return new Response('Upstream fetch failed', {
        status: 502,
        headers: { 'access-control-allow-origin': '*', 'vary': 'origin' },
      });
    }
  },
};
