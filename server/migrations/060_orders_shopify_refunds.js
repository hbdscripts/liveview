/**
 * Persist refund and refund line item facts for Total/Net sales net of returns.
 * - orders_shopify_refunds: one row per refund (refund_id, order_id, refund_created_at, amount, order_processed_at)
 * - orders_shopify_refund_line_items: one row per refunded line (refund_id, order_id, line_item_id, product_id, variant_id, quantity, subtotal, order_processed_at)
 */
const { getDb, isPostgres } = require('../db');

const sqliteRefunds = `
CREATE TABLE IF NOT EXISTS orders_shopify_refunds (
  shop TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  refund_created_at INTEGER NOT NULL,
  order_processed_at INTEGER,
  currency TEXT,
  amount REAL NOT NULL,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (shop, refund_id)
);
CREATE INDEX IF NOT EXISTS idx_osr_shop_refund_created_at ON orders_shopify_refunds(shop, refund_created_at);
CREATE INDEX IF NOT EXISTS idx_osr_shop_order_processed_at ON orders_shopify_refunds(shop, order_processed_at);
CREATE INDEX IF NOT EXISTS idx_osr_shop_order_id ON orders_shopify_refunds(shop, order_id);
`;

const sqliteRefundLineItems = `
CREATE TABLE IF NOT EXISTS orders_shopify_refund_line_items (
  shop TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  refund_created_at INTEGER NOT NULL,
  order_processed_at INTEGER,
  product_id TEXT,
  variant_id TEXT,
  quantity INTEGER NOT NULL,
  subtotal REAL NOT NULL,
  currency TEXT,
  synced_at INTEGER NOT NULL,
  PRIMARY KEY (shop, refund_id, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_refund_created_at ON orders_shopify_refund_line_items(shop, refund_created_at);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_order_processed_at ON orders_shopify_refund_line_items(shop, order_processed_at);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_product_id ON orders_shopify_refund_line_items(shop, order_processed_at, product_id);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_variant_id ON orders_shopify_refund_line_items(shop, order_processed_at, variant_id);
`;

const pgRefunds = `
CREATE TABLE IF NOT EXISTS orders_shopify_refunds (
  shop TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  refund_created_at BIGINT NOT NULL,
  order_processed_at BIGINT,
  currency TEXT,
  amount DOUBLE PRECISION NOT NULL,
  synced_at BIGINT NOT NULL,
  PRIMARY KEY (shop, refund_id)
);
CREATE INDEX IF NOT EXISTS idx_osr_shop_refund_created_at ON orders_shopify_refunds(shop, refund_created_at);
CREATE INDEX IF NOT EXISTS idx_osr_shop_order_processed_at ON orders_shopify_refunds(shop, order_processed_at);
CREATE INDEX IF NOT EXISTS idx_osr_shop_order_id ON orders_shopify_refunds(shop, order_id);
`;

const pgRefundLineItems = `
CREATE TABLE IF NOT EXISTS orders_shopify_refund_line_items (
  shop TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  refund_created_at BIGINT NOT NULL,
  order_processed_at BIGINT,
  product_id TEXT,
  variant_id TEXT,
  quantity INT NOT NULL,
  subtotal DOUBLE PRECISION NOT NULL,
  currency TEXT,
  synced_at BIGINT NOT NULL,
  PRIMARY KEY (shop, refund_id, line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_refund_created_at ON orders_shopify_refund_line_items(shop, refund_created_at);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_order_processed_at ON orders_shopify_refund_line_items(shop, order_processed_at);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_product_id ON orders_shopify_refund_line_items(shop, order_processed_at, product_id);
CREATE INDEX IF NOT EXISTS idx_osrli_shop_variant_id ON orders_shopify_refund_line_items(shop, order_processed_at, variant_id);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    for (const stmt of pgRefunds.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.run(stmt + ';');
    }
    for (const stmt of pgRefundLineItems.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.run(stmt + ';');
    }
  } else {
    await db.exec(sqliteRefunds);
    await db.exec(sqliteRefundLineItems);
  }
}

module.exports = { up };
