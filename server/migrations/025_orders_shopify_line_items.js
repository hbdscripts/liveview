/**
 * Persisted line-item facts for Shopify truth orders.
 *
 * Purpose:
 * - Product reports should be pure SQL (no parsing orders_shopify.raw_json at request-time).
 *
 * Safety:
 * - This table is populated via INSERT/UPSERT only.
 * - No deletes are required (and none are performed by this migration).
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS orders_shopify_line_items (
  shop TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_created_at INTEGER NOT NULL,
  order_updated_at INTEGER,
  order_financial_status TEXT,
  order_cancelled_at INTEGER,
  order_test INTEGER,
  currency TEXT,
  product_id TEXT,
  variant_id TEXT,
  quantity INTEGER,
  unit_price REAL,
  line_revenue REAL,
  title TEXT,
  variant_title TEXT,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (shop, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_osli_shop_order_created_at ON orders_shopify_line_items(shop, order_created_at);
CREATE INDEX IF NOT EXISTS idx_osli_shop_order_id ON orders_shopify_line_items(shop, order_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_product_id ON orders_shopify_line_items(shop, product_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_variant_id ON orders_shopify_line_items(shop, variant_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_created_at_product_id ON orders_shopify_line_items(shop, order_created_at, product_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_created_at_variant_id ON orders_shopify_line_items(shop, order_created_at, variant_id);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS orders_shopify_line_items (
  shop TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_created_at BIGINT NOT NULL,
  order_updated_at BIGINT,
  order_financial_status TEXT,
  order_cancelled_at BIGINT,
  order_test INTEGER,
  currency TEXT,
  product_id TEXT,
  variant_id TEXT,
  quantity INT,
  unit_price DOUBLE PRECISION,
  line_revenue DOUBLE PRECISION,
  title TEXT,
  variant_title TEXT,
  synced_at BIGINT NOT NULL,
  PRIMARY KEY (shop, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_osli_shop_order_created_at ON orders_shopify_line_items(shop, order_created_at);
CREATE INDEX IF NOT EXISTS idx_osli_shop_order_id ON orders_shopify_line_items(shop, order_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_product_id ON orders_shopify_line_items(shop, product_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_variant_id ON orders_shopify_line_items(shop, variant_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_created_at_product_id ON orders_shopify_line_items(shop, order_created_at, product_id);
CREATE INDEX IF NOT EXISTS idx_osli_shop_created_at_variant_id ON orders_shopify_line_items(shop, order_created_at, variant_id);
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

