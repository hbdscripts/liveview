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

test('Business snapshot revenue matches truth sales-time contract (processed_at, include non-checkout orders)', async () => {
  // Configure isolated SQLite DB + config BEFORE requiring server modules.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'business-snapshot.metrics-contract.sqlite');
  process.env.SHOP_DOMAIN = 'test-shop.myshopify.com';
  process.env.ADMIN_TIMEZONE = 'UTC';

  const originalFetch = global.fetch;
  global.fetch = stubFetch;

  let db = null;
  try {
    const { getDb } = require('../server/db');
    const { up: up001 } = require('../server/migrations/001_initial');
    const { up: up002 } = require('../server/migrations/002_shop_sessions');
    const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');

    await up001();
    await up002();
    await up017();

    db = getDb();
    const shop = process.env.SHOP_DOMAIN;
    const now = Date.now();

    // Day under test: 2026-02-24 UTC.
    // Order A: created on 24th, processed on 25th -> must bucket into 25th (NOT 24th).
    await db.run(
      `
        INSERT OR REPLACE INTO orders_shopify
        (shop, order_id, created_at, processed_at, financial_status, cancelled_at, test, currency, total_price, total_tax, customer_id, checkout_token, synced_at, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        shop,
        'o_a',
        Date.UTC(2026, 1, 24, 23, 50, 0),
        Date.UTC(2026, 1, 25, 0, 10, 0),
        'paid',
        null,
        0,
        'GBP',
        10,
        0,
        'c_a',
        'tok_a',
        now,
        '{}',
      ]
    );

    // Order B: processed on 24th, checkout_token missing -> MUST still be included in truth revenue.
    await db.run(
      `
        INSERT OR REPLACE INTO orders_shopify
        (shop, order_id, created_at, processed_at, financial_status, cancelled_at, test, currency, total_price, total_tax, customer_id, checkout_token, synced_at, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        shop,
        'o_b',
        Date.UTC(2026, 1, 24, 12, 0, 0),
        Date.UTC(2026, 1, 24, 12, 5, 0),
        'paid',
        null,
        0,
        'GBP',
        20,
        0,
        'c_b',
        null,
        now,
        '{}',
      ]
    );

    const businessSnapshotService = require('../server/businessSnapshotService');
    const salesTruth = require('../server/salesTruth');
    const store = require('../server/store');

    const rangeKey = 'r:2026-02-24:2026-02-24';
    const bounds = store.getRangeBounds(rangeKey, Date.UTC(2026, 1, 26, 12, 0, 0), 'UTC');
    const truthRevenue = await salesTruth.getTruthSalesTotalGbp(shop, bounds.start, bounds.end);

    const snapshot = await businessSnapshotService.getBusinessSnapshot({
      mode: 'range',
      preset: 'custom',
      since: '2026-02-24',
      until: '2026-02-24',
      granularity: 'hour',
    });

    assert.equal(snapshot?.ok, true);
    assert.equal(snapshot?.financial?.revenue?.value, truthRevenue);
    assert.equal(truthRevenue, 20);

    const series = snapshot?.seriesComparison?.current?.revenueGbp;
    assert.ok(Array.isArray(series), 'expected current.revenueGbp array');
    const seriesSum = series.reduce((acc, v) => acc + (Number(v) || 0), 0);
    assert.equal(Math.round(seriesSum * 100) / 100, truthRevenue);
  } finally {
    global.fetch = originalFetch;
    try { db && db.close && db.close(); } catch (_) {}
  }
});

