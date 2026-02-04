/**
 * Orders truth: store Shopify's customer.orders_count so we can classify returning customers
 * without needing to backfill the store's full historical order set.
 *
 * Shopify's own "returning customers" metrics are based on customer history; orders_count
 * gives us that signal directly on each order payload.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS customer_orders_count INTEGER');
  } else {
    try {
      await db.run('ALTER TABLE orders_shopify ADD COLUMN customer_orders_count INTEGER');
    } catch (e) {
      if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
    }
  }
}

module.exports = { up };

