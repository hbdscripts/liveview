/**
 * Product catalog for search: products detected from Shopify truth (line items).
 *
 * Purpose:
 * - Search products by title / product_id without requiring Shopify GraphQL token.
 * - Populated on line-item upsert and optionally enriched from product-insights meta fetch.
 *
 * Safety:
 * - INSERT/UPSERT only; backfill is bounded and wrapped in try/catch.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS catalog_products (
  shop TEXT NOT NULL,
  product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  handle TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (shop, product_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_shop_title ON catalog_products(shop, title);
CREATE INDEX IF NOT EXISTS idx_catalog_products_shop_product_id ON catalog_products(shop, product_id);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS catalog_products (
  shop TEXT NOT NULL,
  product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  handle TEXT,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  PRIMARY KEY (shop, product_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_products_shop_title ON catalog_products(shop, title);
CREATE INDEX IF NOT EXISTS idx_catalog_products_shop_product_id ON catalog_products(shop, product_id);
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

  // Bounded backfill from orders_shopify_line_items (distinct shop, product_id, title)
  try {
    if (isPostgres()) {
      await db.run(`
        INSERT INTO catalog_products (shop, product_id, title, handle, first_seen_at, last_seen_at)
        SELECT shop, TRIM(product_id), COALESCE(NULLIF(TRIM(title), ''), 'Untitled'), NULL,
               (COALESCE(MIN(order_processed_at), MIN(order_created_at)))::bigint,
               (COALESCE(MAX(order_processed_at), MAX(order_created_at)))::bigint
        FROM orders_shopify_line_items
        WHERE product_id IS NOT NULL AND TRIM(product_id) != ''
        GROUP BY shop, TRIM(product_id), COALESCE(NULLIF(TRIM(title), ''), 'Untitled')
        ON CONFLICT (shop, product_id) DO UPDATE SET
          title = EXCLUDED.title,
          last_seen_at = GREATEST(catalog_products.last_seen_at, EXCLUDED.last_seen_at)
      `);
    } else {
      await db.run(`
        INSERT OR REPLACE INTO catalog_products (shop, product_id, title, handle, first_seen_at, last_seen_at)
        SELECT shop, TRIM(product_id), COALESCE(NULLIF(TRIM(title), ''), 'Untitled'), NULL,
               COALESCE(MIN(COALESCE(order_processed_at, order_created_at)), 0),
               COALESCE(MAX(COALESCE(order_processed_at, order_created_at)), 0)
        FROM orders_shopify_line_items
        WHERE product_id IS NOT NULL AND TRIM(product_id) != ''
        GROUP BY shop, TRIM(product_id), COALESCE(NULLIF(TRIM(title), ''), 'Untitled')
      `);
    }
  } catch (e) {
    // Fail-open: table might be empty or line_items not yet populated
    if (e && e.message && !/no such table|relation.*does not exist/i.test(String(e.message))) {
      console.warn('[068_catalog_products] backfill failed:', e.message);
    }
  }
}

module.exports = { up };
