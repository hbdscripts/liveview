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

  // FX rates (GBP base)
  if (u.startsWith('https://api.frankfurter.app/latest?from=GBP')) {
    return jsonResponse({ amount: 1, base: 'GBP', rates: { GBP: 1, USD: 1.25 } });
  }
  if (u.startsWith('https://open.er-api.com/v6/latest/GBP')) {
    return jsonResponse({ rates: { GBP: 1, USD: 1.25 } });
  }

  // Shopify product meta (REST)
  if (u.includes('/admin/api/2025-01/products/123.json')) {
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

test('GET /api/shopify-best-sellers: 30days normalizes; sessions counted from first_product_handle', async () => {
  // Configure test shop + isolated SQLite DB BEFORE requiring server modules.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'live_visitors.best_sellers.test.sqlite');
  process.env.ALLOWED_SHOP_DOMAIN = 'test.myshopify.com';
  process.env.SHOP_DOMAIN = 'test.myshopify.com';
  process.env.SALES_TRUTH_RECONCILE_MIN_INTERVAL_SECONDS = '3600';

  const originalFetch = global.fetch;
  global.fetch = stubFetch;

  let db = null;
  try {
    const { getDb } = require('../server/db');
    const { up: up001 } = require('../server/migrations/001_initial');
    const { up: up002 } = require('../server/migrations/002_shop_sessions');
    const { up: up007 } = require('../server/migrations/007_first_path');
    const { up: up009 } = require('../server/migrations/009_cf_traffic');
    const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');
    const { up: up025 } = require('../server/migrations/025_orders_shopify_line_items');

    await up001();
    await up002();
    await up007();
    await up009();
    await up017();
    await up025();

    db = getDb();
    const now = Date.now();
    const shop = 'test.myshopify.com';

    // Token exists so product handle can resolve (fetch is stubbed).
    await db.run('INSERT OR REPLACE INTO shop_sessions (shop, access_token, updated_at) VALUES (?, ?, ?)', [shop, 'test_token', now]);
    // Throttle truth reconcile so it won’t fetch during this test.
    await db.run(
      'INSERT OR REPLACE INTO reconcile_state (shop, scope, last_success_at, last_attempt_at, last_error, cursor_json) VALUES (?, ?, ?, ?, ?, ?)',
      [shop, 'range_30d', now, now, null, null]
    );

    // Sessions: one product landing for the resolved handle.
    await db.run(
      'INSERT OR REPLACE INTO visitors (visitor_id, first_seen, last_seen, last_country) VALUES (?, ?, ?, ?)',
      ['v1', now - 60_000, now - 30_000, 'GB']
    );
    await db.run(
      `INSERT OR REPLACE INTO sessions (session_id, visitor_id, started_at, last_seen, first_product_handle)
       VALUES (?, ?, ?, ?, ?)`,
      ['s1', 'v1', now - 10_000, now - 5_000, 'test-handle']
    );

    // Truth line item: 1 order for product 123, 20 days ago (inside 30d).
    const twentyDaysMs = 20 * 24 * 60 * 60 * 1000;
    await db.run(
      `INSERT OR REPLACE INTO orders_shopify_line_items
       (shop, line_item_id, order_id, order_created_at, order_financial_status, order_cancelled_at, order_test, currency, product_id, quantity, unit_price, line_revenue, title, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop, 'li1', 'o1', now - twentyDaysMs, 'paid', null, 0, 'GBP', '123', 1, 10, 10, 'Test Product', now]
    );

    const { getShopifyBestSellers } = require('../server/routes/shopifyBestSellers');

    async function callBestSellers(extraQuery = {}) {
      let body;
      let status = 200;
      const req = { query: { shop, page: '1', pageSize: '10', ...extraQuery } };
      const res = {
        setHeader() {},
        status(code) { status = code; return res; },
        json(data) { body = data; },
      };
      await getShopifyBestSellers(req, res);
      return { status, body };
    }

    const r30 = await callBestSellers({ range: '30days', force: '1' });
    assert.equal(r30.status, 200);
    assert.ok(Array.isArray(r30.body?.bestSellers));
    assert.equal(r30.body.bestSellers.length, 1);
    assert.equal(r30.body.bestSellers[0].product_id, '123');
    assert.equal(r30.body.bestSellers[0].orders, 1);
    assert.equal(r30.body.bestSellers[0].clicks, 1);
    assert.equal(r30.body.bestSellers[0].cr, 100);

    const r7 = await callBestSellers({ range: '7days', force: '1' });
    assert.equal(r7.status, 200);
    assert.ok(Array.isArray(r7.body?.bestSellers));
    assert.equal(r7.body.bestSellers.length, 0);
  } finally {
    global.fetch = originalFetch;
    try { db && db.close && db.close(); } catch (_) {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
    try { delete process.env.SQLITE_DB_PATH; } catch (_) {}
  }
});

