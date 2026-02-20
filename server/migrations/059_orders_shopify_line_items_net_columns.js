/**
 * Add net-sales columns to orders_shopify_line_items for correct product/variant revenue.
 * - order_processed_at: bucket by sale date (processed_at)
 * - line_gross: quantity * unit_price
 * - line_discount: from Shopify line item total_discount / discount allocations
 * - line_net: gross - discount (used for Net sales reporting)
 */
const { getDb, isPostgres } = require('../db');

async function safeAddColumnSqlite(db, table, column, type) {
  try {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}

async function up() {
  const db = getDb();

  if (isPostgres()) {
    await db.run('ALTER TABLE orders_shopify_line_items ADD COLUMN IF NOT EXISTS order_processed_at BIGINT').catch(() => null);
    await db.run('ALTER TABLE orders_shopify_line_items ADD COLUMN IF NOT EXISTS line_gross DOUBLE PRECISION').catch(() => null);
    await db.run('ALTER TABLE orders_shopify_line_items ADD COLUMN IF NOT EXISTS line_discount DOUBLE PRECISION').catch(() => null);
    await db.run('ALTER TABLE orders_shopify_line_items ADD COLUMN IF NOT EXISTS line_net DOUBLE PRECISION').catch(() => null);
  } else {
    await safeAddColumnSqlite(db, 'orders_shopify_line_items', 'order_processed_at', 'INTEGER');
    await safeAddColumnSqlite(db, 'orders_shopify_line_items', 'line_gross', 'REAL');
    await safeAddColumnSqlite(db, 'orders_shopify_line_items', 'line_discount', 'REAL');
    await safeAddColumnSqlite(db, 'orders_shopify_line_items', 'line_net', 'REAL');
  }

  // Indexes for range queries by order_processed_at (sale-date bucketing)
  await db.run('CREATE INDEX IF NOT EXISTS idx_osli_shop_order_processed_at ON orders_shopify_line_items(shop, order_processed_at)').catch(() => null);
  await db.run('CREATE INDEX IF NOT EXISTS idx_osli_shop_processed_at_product_id ON orders_shopify_line_items(shop, order_processed_at, product_id)').catch(() => null);
  await db.run('CREATE INDEX IF NOT EXISTS idx_osli_shop_processed_at_variant_id ON orders_shopify_line_items(shop, order_processed_at, variant_id)').catch(() => null);
}

module.exports = { up };
