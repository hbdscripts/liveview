/**
 * Customer order facts (truth helper).
 *
 * Stores the customer's first paid order timestamp so we can compute
 * "returning customers" and "returning revenue" correctly (Shopify definition)
 * without needing to backfill the store's entire historical order dataset.
 *
 * Populated lazily via Orders API lookups (read_orders) for customers observed in recent orders.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS customer_order_facts (
  shop TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  first_paid_order_at INTEGER,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (shop, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_order_facts_shop_first_paid ON customer_order_facts(shop, first_paid_order_at);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS customer_order_facts (
  shop TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  first_paid_order_at BIGINT,
  checked_at BIGINT NOT NULL,
  PRIMARY KEY (shop, customer_id)
);
CREATE INDEX IF NOT EXISTS idx_customer_order_facts_shop_first_paid ON customer_order_facts(shop, first_paid_order_at);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    const statements = pgSchema.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
  } else {
    await db.exec(sqliteSchema);
  }
}

module.exports = { up };

