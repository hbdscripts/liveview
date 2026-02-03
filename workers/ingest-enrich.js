/**
 * Cloudflare Worker: enrich ingest requests with CF metadata (no bot score).
 * Deploy on the ingest hostname/path so POST /api/ingest goes through CF.
 * Set env ORIGIN_URL (e.g. https://your-app.up.railway.app) in Worker settings.
 * Fail-open: on error we still forward to origin without enrichment.
 */

export default {
  async fetch(request, env, ctx) {
    const originUrl = env.ORIGIN_URL || '';
    if (!originUrl) {
      return new Response('ORIGIN_URL not configured', { status: 500 });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const ingestPath = '/api/ingest';
    const isIngest = path === ingestPath || path.endsWith(ingestPath);

    if (!isIngest || request.method === 'OPTIONS') {
      const origin = originUrl.replace(/\/$/, '') + path + url.search;
      const init = { method: request.method, headers: request.headers };
      if (request.body != null && request.method !== 'GET' && request.method !== 'HEAD') {
        init.body = request.body;
        init.duplex = 'half';
      }
      return fetch(new Request(origin, init));
    }

    let headers = {};
    try {
      const cf = request.cf || {};
      const knownBot = cf.botManagement?.verifiedBot === true ? '1' : '0';
      const verifiedBotCategory = (cf.verifiedBotCategory && String(cf.verifiedBotCategory).trim()) || '';
      const country = (cf.country && String(cf.country).trim().length === 2) ? String(cf.country).trim().toUpperCase() : '';
      const colo = (cf.colo && String(cf.colo).trim()) ? String(cf.colo).trim().slice(0, 32) : '';
      const asn = (cf.asn != null && cf.asn !== '') ? String(cf.asn).trim().slice(0, 32) : '';

      headers = {
        'x-cf-known-bot': knownBot,
        'x-cf-verified-bot-category': verifiedBotCategory,
        'x-cf-country': country,
        'x-cf-colo': colo,
        'x-cf-asn': asn,
      };
    } catch (_) {
      headers = {};
    }

    const newHeaders = new Headers(request.headers);
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined && v !== null) newHeaders.set(k, v);
    }

    const origin = originUrl.replace(/\/$/, '') + path + url.search;
    const newRequest = new Request(origin, {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      duplex: 'half',
    });

    return fetch(newRequest);
  },
};
