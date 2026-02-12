/**
 * Persisted per-order shipping option facts for Shopify truth orders.
 *
 * Purpose:
 * - Shipping CR tool should be pure SQL (no parsing orders_shopify.raw_json at request-time).
 *
 * Safety:
 * - Append-only/UPSERT population happens in salesTruth reconciliation.
 * - No deletes required (and none performed here).
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS orders_shopify_shipping_options (
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_created_at INTEGER NOT NULL,
  order_processed_at INTEGER,
  order_updated_at INTEGER,
  order_financial_status TEXT,
  order_cancelled_at INTEGER,
  order_test INTEGER,
  order_country_code TEXT,
  currency TEXT,
  shipping_label TEXT,
  shipping_price REAL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (shop, order_id)
);
CREATE INDEX IF NOT EXISTS idx_osso_shop_processed_country ON orders_shopify_shipping_options(shop, order_processed_at, order_country_code);
CREATE INDEX IF NOT EXISTS idx_osso_shop_created_country ON orders_shopify_shipping_options(shop, order_created_at, order_country_code);
CREATE INDEX IF NOT EXISTS idx_osso_shop_country_label_price ON orders_shopify_shipping_options(shop, order_country_code, shipping_label, shipping_price);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS orders_shopify_shipping_options (
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_created_at BIGINT NOT NULL,
  order_processed_at BIGINT,
  order_updated_at BIGINT,
  order_financial_status TEXT,
  order_cancelled_at BIGINT,
  order_test INTEGER,
  order_country_code TEXT,
  currency TEXT,
  shipping_label TEXT,
  shipping_price DOUBLE PRECISION,
  synced_at BIGINT NOT NULL,
  PRIMARY KEY (shop, order_id)
);
CREATE INDEX IF NOT EXISTS idx_osso_shop_processed_country ON orders_shopify_shipping_options(shop, order_processed_at, order_country_code);
CREATE INDEX IF NOT EXISTS idx_osso_shop_created_country ON orders_shopify_shipping_options(shop, order_created_at, order_country_code);
CREATE INDEX IF NOT EXISTS idx_osso_shop_country_label_price ON orders_shopify_shipping_options(shop, order_country_code, shipping_label, shipping_price);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    const statements = pgSchema.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
    return;
  }
  await db.exec(sqliteSchema);
}

module.exports = { up };

