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

  // Shopify product meta
  if (u.includes('/admin/api/2025-01/products/')) {
    return jsonResponse({
      product: {
        handle: 'test-handle',
        title: 'Test Product',
        image: { src: 'https://example.com/test.webp' },
      },
    });
  }

  return jsonResponse({ error: 'not_stubbed', url: u }, { status: 404 });
}

test('GET /api/dashboard-series: CR% is null when sessions=0; sessions attributed from first_path', async () => {
  // Configure test shop + isolated SQLite DB BEFORE requiring server modules.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'live_visitors.test.sqlite');
  process.env.ALLOWED_SHOP_DOMAIN = 'test.myshopify.com';
  process.env.SHOP_DOMAIN = 'test.myshopify.com';
  // Make reconcile throttling deterministic for the test.
  process.env.SALES_TRUTH_RECONCILE_MIN_INTERVAL_SECONDS = '3600';

  const originalFetch = global.fetch;
  global.fetch = stubFetch;

  let db = null;
  try {
  const { getDb } = require('../server/db');

  const { up: up001 } = require('../server/migrations/001_initial');
  const { up: up002 } = require('../server/migrations/002_shop_sessions');
  const { up: up004 } = require('../server/migrations/004_session_stats_fields');
  const { up: up007 } = require('../server/migrations/007_first_path');
  const { up: up009 } = require('../server/migrations/009_cf_traffic');
  const { up: up011 } = require('../server/migrations/011_entry_url');
  const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');
  const { up: up018 } = require('../server/migrations/018_orders_shopify_returning_fields');
  const { up: up025 } = require('../server/migrations/025_orders_shopify_line_items');

  await up001();
  await up002();
  await up004();
  await up007();
  await up009();
  await up011();
  await up017();
  await up018();
  await up025();

  db = getDb();
  const now = Date.now();
  const shop = 'test.myshopify.com';

  // Token exists so product meta can resolve handle (fetch is stubbed).
  await db.run('INSERT OR REPLACE INTO shop_sessions (shop, access_token, updated_at) VALUES (?, ?, ?)', [shop, 'test_token', now]);
  // Throttle truth reconcile so it won’t fetch orders during this test.
  await db.run(
    'INSERT OR REPLACE INTO reconcile_state (shop, scope, last_success_at, last_attempt_at, last_error, cursor_json) VALUES (?, ?, ?, ?, ?, ?)',
    [shop, 'today', now, now, null, null]
  );

  // Minimal truth rows for Top Products (line items) + per-day orders/revenue (orders_shopify).
  await db.run(
    `INSERT OR REPLACE INTO orders_shopify (shop, order_id, created_at, processed_at, financial_status, cancelled_at, test, currency, total_price, synced_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shop, 'o1', now - 2000, null, 'paid', null, 0, 'GBP', 10, now, JSON.stringify({})]
  );

  await db.run(
    `INSERT OR REPLACE INTO orders_shopify_line_items
     (shop, line_item_id, order_id, order_created_at, order_financial_status, order_cancelled_at, order_test, currency, product_id, quantity, unit_price, line_revenue, title, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [shop, 'li1', 'o1', now - 2000, 'paid', null, 0, 'GBP', '123', 1, 10, 10, 'Test Product', now]
  );

  const { getDashboardSeries } = require('../server/routes/dashboardSeries');

  async function callDashboardSeries(extraQuery = {}) {
    let body;
    let status = 200;
    const req = { query: { range: 'today', ...extraQuery } };
    const res = {
      setHeader() {},
      status(code) { status = code; return res; },
      json(data) { body = data; },
    };
    await getDashboardSeries(req, res);
    return { status, body };
  }

  // 1) Orders exist but sessions=0 => CR% is null (undefined), not 0.0%.
  const r1 = await callDashboardSeries({ force: '1' });
  assert.equal(r1.status, 200);
  assert.ok(Array.isArray(r1.body?.topProducts));
  assert.equal(r1.body.topProducts.length, 1);
  assert.equal(r1.body.topProducts[0].orders, 1);
  assert.equal(r1.body.topProducts[0].sessions, 0);
  assert.equal(r1.body.topProducts[0].cr, null);

  // 2) A product-landing session identified via first_path should be counted.
  await db.run(
    `INSERT OR REPLACE INTO visitors (visitor_id, first_seen, last_seen)
     VALUES (?, ?, ?)`,
    ['v1', now - 5000, now - 1000]
  );
  await db.run(
    `INSERT OR REPLACE INTO sessions (session_id, visitor_id, started_at, last_seen, first_path)
     VALUES (?, ?, ?, ?, ?)`,
    ['s1', 'v1', now - 1000, now - 500, '/products/test-handle']
  );
  // Include a page_viewed event so bounce logic can execute without empty joins.
  await db.run(
    `INSERT INTO events (session_id, ts, type, path)
     VALUES (?, ?, ?, ?)`,
    ['s1', now - 900, 'page_viewed', '/products/test-handle']
  );

  const r2 = await callDashboardSeries({ force: '1' });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.topProducts.length, 1);
  assert.equal(r2.body.topProducts[0].orders, 1);
  assert.equal(r2.body.topProducts[0].sessions, 1);
  assert.equal(r2.body.topProducts[0].cr, 100);

  // 3) endMs clip: single-day range clipped to 3h => 15-min buckets (12 points).
  const store = require('../server/store');
  const tz = store.resolveAdminTimeZone();
  const clipBounds = store.getRangeBounds('d:2025-02-02', now, tz);
  assert.ok(Number.isFinite(clipBounds?.start));
  const clipEndMs = Number(clipBounds.start) + 3 * 60 * 60 * 1000;
  const r3 = await callDashboardSeries({ range: 'd:2025-02-02', endMs: String(clipEndMs), force: '1' });
  assert.equal(r3.status, 200);
  assert.equal(r3.body.bucket, 'hour');
  assert.ok(Array.isArray(r3.body.series));
  assert.equal(r3.body.series.length, 12);
  assert.ok(String(r3.body.series[1]?.date || '').includes(':15'));
  } finally {
    try { db && db.close && db.close(); } catch (_) {}
    global.fetch = originalFetch;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

