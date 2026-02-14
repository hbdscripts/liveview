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

  // Shopify product meta (REST)
  if (u.includes('/admin/api/2025-01/products/')) {
    return jsonResponse({
      product: {
        handle: 'real-handle',
        title: 'Real Product',
        image: { src: 'https://example.com/test.webp' },
      },
    });
  }

  return jsonResponse({ error: 'not_stubbed', url: u }, { status: 404 });
}

test('store.listLatestSales: returns truth product_id/title and ignores session handle', async () => {
  // Configure test shop + isolated SQLite DB BEFORE requiring server modules.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'live_visitors.test.sqlite');
  process.env.ALLOWED_SHOP_DOMAIN = 'test.myshopify.com';
  process.env.SHOP_DOMAIN = 'test.myshopify.com';

  const originalFetch = global.fetch;
  global.fetch = stubFetch;

  let db = null;
  try {
    const { getDb } = require('../server/db');

    const { up: up001 } = require('../server/migrations/001_initial');
    const { up: up002 } = require('../server/migrations/002_shop_sessions');
    const { up: up003 } = require('../server/migrations/003_cart_order_money');
    const { up: up004 } = require('../server/migrations/004_session_stats_fields');
    const { up: up007 } = require('../server/migrations/007_first_path');
    const { up: up008 } = require('../server/migrations/008_purchases');
    const { up: up009 } = require('../server/migrations/009_cf_traffic');
    const { up: up011 } = require('../server/migrations/011_entry_url');
    const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');
    const { up: up018 } = require('../server/migrations/018_orders_shopify_returning_fields');
    const { up: up025 } = require('../server/migrations/025_orders_shopify_line_items');

    await up001();
    await up002();
    await up003();
    await up004();
    await up007();
    await up008();
    await up009();
    await up011();
    await up017();
    await up018();
    await up025();

    db = getDb();
    const now = Date.now();
    const shop = 'test.myshopify.com';

    // Token exists so product meta can resolve handle (fetch is stubbed).
    await db.run(
      'INSERT OR REPLACE INTO shop_sessions (shop, access_token, updated_at) VALUES (?, ?, ?)',
      [shop, 'test_token', now]
    );

    // A converted session with a stale/incorrect handle.
    await db.run(
      'INSERT OR REPLACE INTO visitors (visitor_id, first_seen, last_seen, last_country) VALUES (?, ?, ?, ?)',
      ['v1', now - 5000, now - 1000, 'GB']
    );
    await db.run(
      `INSERT OR REPLACE INTO sessions
        (session_id, visitor_id, started_at, last_seen, has_purchased, purchased_at, order_total, order_currency, country_code, last_product_handle, first_product_handle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s1', 'v1', now - 2000, now - 1000, 1, now - 1500, 50, 'GBP', 'GB', 'wrong-handle', 'wrong-handle']
    );

    // Truth order + line items (top product is product_id=111).
    const orderId = '9001';
    const checkoutToken = 'tok1';
    await db.run(
      `INSERT OR REPLACE INTO orders_shopify
        (shop, order_id, created_at, financial_status, cancelled_at, test, currency, total_price, checkout_token, synced_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop, orderId, now - 1600, 'paid', null, 0, 'GBP', 50, checkoutToken, now, JSON.stringify({ line_items: [{ title: 'Real Product', quantity: 1, price: 50, product_id: 111 }] })]
    );
    await db.run(
      `INSERT OR REPLACE INTO orders_shopify_line_items
        (shop, line_item_id, order_id, order_created_at, order_financial_status, order_cancelled_at, order_test, currency, product_id, quantity, unit_price, line_revenue, title, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop, 'li1', orderId, now - 1600, 'paid', null, 0, 'GBP', '111', 1, 50, 50, 'Real Product', now]
    );

    // Evidence links the session to the truth order (so listLatestSales can resolve it reliably).
    await db.run(
      `INSERT INTO purchase_events
        (shop, occurred_at, received_at, event_type, session_id, checkout_token, order_id, currency, total_price, linked_order_id, link_reason, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop, now - 1500, now - 1490, 'checkout_completed', 's1', checkoutToken, orderId, 'GBP', 50, orderId, 'order_id', JSON.stringify({})]
    );

    const store = require('../server/store');
    const sales = await store.listLatestSales(5);
    assert.ok(Array.isArray(sales));
    assert.equal(sales.length, 1);

    const row = sales[0] || {};
    assert.equal(row.product_id, '111');
    assert.equal(row.product_title, 'Real Product');
    assert.equal(row.last_product_handle, 'real-handle');
    assert.notEqual(row.last_product_handle, 'wrong-handle');
  } finally {
    try { db && db.close && db.close(); } catch (_) {}
    global.fetch = originalFetch;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

