/**
 * Minimal perf sanity runner for key dashboard endpoints.
 *
 * Usage:
 *   node scripts/dashboard-perf-sanity.js --base=http://127.0.0.1:3000
 *
 * Notes:
 * - Measures:
 *   - ttfb_ms_headers: time to response headers (approx TTFB)
 *   - ttfb_ms_first_data: time to first data chunk (closer to first byte)
 *   - total_ms: time to complete body
 *   - bytes: response body bytes
 * - Runs 2 passes: cold + warm (to show cache effects).
 */
const http = require('http');
const https = require('https');

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = String(a).match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2];
  }
  return out;
}

function requestTimings(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (_) { resolve({ ok: false, error: 'invalid_url', url }); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const t0 = nowMs();
    let tHeaders = null;
    let tFirstData = null;
    let status = 0;
    let bytes = 0;
    let body = '';
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Accept: 'application/json' },
      },
      (res) => {
        status = res.statusCode || 0;
        tHeaders = nowMs();
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (tFirstData == null) tFirstData = nowMs();
          if (typeof chunk === 'string') {
            bytes += Buffer.byteLength(chunk, 'utf8');
            // Cap stored body to avoid huge memory use; we only need JSON parse for shape checks.
            if (body.length < 200000) body += chunk;
          }
        });
        res.on('end', () => {
          const tEnd = nowMs();
          let json = null;
          let jsonOk = false;
          try { json = body ? JSON.parse(body) : null; jsonOk = true; } catch (_) { json = null; jsonOk = false; }
          resolve({
            ok: true,
            url,
            status,
            ttfb_ms_headers: tHeaders == null ? null : Math.max(0, tHeaders - t0),
            ttfb_ms_first_data: tFirstData == null ? null : Math.max(0, tFirstData - t0),
            total_ms: Math.max(0, tEnd - t0),
            bytes,
            json_ok: jsonOk,
            shape: json && typeof json === 'object'
              ? (Array.isArray(json) ? 'array' : 'object')
              : (json === null ? 'null' : typeof json),
            top_keys: json && jsonOk && json && typeof json === 'object' && !Array.isArray(json)
              ? Object.keys(json).slice(0, 12)
              : [],
          });
        });
      }
    );
    req.on('error', (err) => {
      resolve({ ok: false, url, error: err && err.message ? String(err.message) : 'request_error' });
    });
    req.setTimeout(35000, () => {
      try { req.destroy(new Error('timeout')); } catch (_) {}
    });
    req.end();
  });
}

async function runPass(base, passName) {
  const endpoints = [
    { name: 'kpis_today', path: '/api/kpis?range=today' },
    { name: 'kexo_score_today', path: '/api/kexo-score?range=today' },
    { name: 'dashboard_series_7d', path: '/api/dashboard-series?range=7d' },
    { name: 'settings', path: '/api/settings' },
  ];
  const results = [];
  for (const e of endpoints) {
    const url = base.replace(/\/$/, '') + e.path;
    const r = await requestTimings(url);
    results.push({ pass: passName, name: e.name, ...r });
  }
  return results;
}

const TIMING_BUDGET_MS = {
  kpis_today: 15000,
  kexo_score_today: 15000,
  dashboard_series_7d: 30000,
  settings: 10000,
};

function assertShapes(results) {
  const byName = {};
  results.forEach((r) => {
    if (!byName[r.name]) byName[r.name] = [];
    byName[r.name].push(r);
  });
  const errors = [];
  for (const [name, arr] of Object.entries(byName)) {
    const cold = arr.find((r) => r.pass === 'cold');
    if (cold && !cold.ok) errors.push(name + ': request failed');
    if (cold && cold.json_ok === false) errors.push(name + ': invalid JSON');
    const budget = TIMING_BUDGET_MS[name];
    if (typeof budget === 'number' && cold && cold.total_ms > budget) {
      errors.push(name + ': total_ms ' + cold.total_ms + ' > budget ' + budget);
    }
  }
  return errors;
}

async function main() {
  const args = parseArgs(process.argv);
  const base = args.base || 'http://127.0.0.1:3000';
  const strict = (args.strict || '').toLowerCase() === '1' || (args.strict || '').toLowerCase() === 'true';
  const out = [];
  out.push(...(await runPass(base, 'cold')));
  out.push(...(await runPass(base, 'warm')));
  process.stdout.write(JSON.stringify({ base, at: new Date().toISOString(), results: out }, null, 2) + '\n');
  const errors = assertShapes(out);
  if (errors.length) {
    process.stderr.write('dashboard-perf-sanity: ' + errors.join('; ') + '\n');
    if (strict) process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});

