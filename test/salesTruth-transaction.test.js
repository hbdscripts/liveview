/**
 * salesTruth uses db.transaction for per-order reconcile; rollback leaves DB unchanged.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('db.transaction rolls back on throw (SQLite)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-tx-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'live_visitors.test.sqlite');

  const { getDb } = require('../server/db');
  const { up: up001 } = require('../server/migrations/001_initial');
  const { up: up002 } = require('../server/migrations/002_shop_sessions');
  const { up: up003 } = require('../server/migrations/003_cart_order_money');
  const { up: up004 } = require('../server/migrations/004_session_stats_fields');
  const { up: up008 } = require('../server/migrations/008_purchases');
  const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');

  await up001();
  await up002();
  await up003();
  await up004();
  await up008();
  await up017();

  const db = getDb();
  assert.equal(typeof db.transaction, 'function', 'db.transaction is a function');

  const countBefore = (await db.get('SELECT COUNT(*) AS n FROM orders_shopify')).n;
  const now = Date.now();

  await assert.rejects(
    db.transaction(async () => {
      await db.run(
        'INSERT INTO orders_shopify (shop, order_id, order_name, created_at, currency, total_price, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['test.myshopify.com', '999999', '#999999', now, 'GBP', 0, now]
      );
      throw new Error('rollback test');
    }),
    /rollback test/
  );

  const countAfter = (await db.get('SELECT COUNT(*) AS n FROM orders_shopify')).n;
  assert.equal(countAfter, countBefore, 'transaction rollback left orders_shopify count unchanged');
});
