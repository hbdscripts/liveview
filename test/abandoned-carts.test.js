const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function jsonResponse(obj, { status = 200 } = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function stubFetch(url) {
  const u = typeof url === 'string' ? url : (url && url.url ? url.url : String(url));

  // FX rates
  if (u.startsWith('https://api.frankfurter.app/latest?from=GBP')) {
    return jsonResponse({ amount: 1, base: 'GBP', rates: { USD: 1.25 } });
  }
  if (u.startsWith('https://open.er-api.com/v6/latest/GBP')) {
    return jsonResponse({ rates: { USD: 1.25 } });
  }

  return jsonResponse({ error: 'not_stubbed', url: u }, { status: 404 });
}

function getRouteHandler(router, method, routePath) {
  const m = String(method || '').toLowerCase();
  const p = String(routePath || '');
  for (const layer of router && Array.isArray(router.stack) ? router.stack : []) {
    if (!layer || !layer.route) continue;
    if (layer.route.path !== p) continue;
    if (!layer.route.methods || !layer.route.methods[m]) continue;
    const routeLayer = layer.route.stack && layer.route.stack[0];
    if (routeLayer && typeof routeLayer.handle === 'function') return routeLayer.handle;
  }
  return null;
}

test('GET /api/abandoned-carts/top-countries: 7days normalizes; % is null when denom=0', async () => {
  // Configure isolated SQLite DB BEFORE requiring server modules.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'live_visitors.abandoned_carts.test.sqlite');

  const originalFetch = global.fetch;
  global.fetch = stubFetch;

  let db = null;
  try {
    const { getDb } = require('../server/db');
    const { up: up001 } = require('../server/migrations/001_initial');
    const { up: up003 } = require('../server/migrations/003_cart_order_money');
    const { up: up004 } = require('../server/migrations/004_session_stats_fields');
    const { up: up007 } = require('../server/migrations/007_first_path');
    const { up: up009 } = require('../server/migrations/009_cf_traffic');

    await up001();
    await up003();
    await up004();
    await up007();
    await up009();

    db = getDb();
    const now = Date.now();

    // Visitors (FK requirement).
    await db.run(
      `INSERT OR REPLACE INTO visitors (visitor_id, first_seen, last_seen, last_country)
       VALUES (?, ?, ?, ?)`,
      ['v_us', now - 20_000, now - 5_000, 'US']
    );
    await db.run(
      `INSERT OR REPLACE INTO visitors (visitor_id, first_seen, last_seen, last_country)
       VALUES (?, ?, ?, ?)`,
      ['v_gb', now - 20_000, now - 5_000, 'GB']
    );

    // US: denom=1 => 100%
    await db.run(
      `INSERT OR REPLACE INTO sessions
       (session_id, visitor_id, started_at, last_seen, country_code, cart_qty, cart_value, cart_currency, has_purchased, is_abandoned, abandoned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s_us', 'v_us', now - 10_000, now - 5_000, 'US', 1, 25, 'GBP', 0, 1, now - 1_000]
    );

    // GB: numerator=1 but denom=0 (started_at outside 7d) => abandoned_pct should be null
    await db.run(
      `INSERT OR REPLACE INTO sessions
       (session_id, visitor_id, started_at, last_seen, country_code, cart_qty, cart_value, cart_currency, has_purchased, is_abandoned, abandoned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s_gb', 'v_gb', now - (10 * 24 * 60 * 60 * 1000), now - 5_000, 'GB', 1, 50, 'GBP', 0, 1, now - 1_000]
    );

    const router = require('../server/routes/abandonedCarts');
    const handler = getRouteHandler(router, 'get', '/top-countries');
    assert.ok(handler, 'Expected GET /top-countries route handler');

    async function callTopCountries(extraQuery = {}) {
      let body;
      let status = 200;
      const req = { query: { range: '7days', mode: 'cart', timezone: 'UTC', limit: '5', ...extraQuery } };
      const res = {
        setHeader() {},
        status(code) { status = code; return res; },
        json(data) { body = data; },
      };
      await handler(req, res);
      return { status, body };
    }

    const r1 = await callTopCountries();
    assert.equal(r1.status, 200);
    assert.equal(r1.body?.rangeKey, '7d');
    assert.equal(r1.body?.mode, 'cart');
    assert.ok(Array.isArray(r1.body?.rows));

    const us = r1.body.rows.find((x) => x && x.country === 'US');
    const gb = r1.body.rows.find((x) => x && x.country === 'GB');
    assert.ok(us, 'Expected US row');
    assert.ok(gb, 'Expected GB row');

    assert.equal(us.abandoned, 1);
    assert.equal(us.checkout_sessions, 0);
    assert.equal(us.abandoned_pct, 100);
    assert.equal(us.abandoned_value_gbp, 25);

    assert.equal(gb.abandoned, 1);
    assert.equal(gb.checkout_sessions, 0);
    assert.equal(gb.abandoned_pct, null);
    assert.equal(gb.abandoned_value_gbp, 50);
  } finally {
    try { db && db.close && db.close(); } catch (_) {}
    global.fetch = originalFetch;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

