/**
 * Add missing index to speed up variant_title product reports.
 *
 * Used by:
 * - GET /api/shopify-finishes (GROUP BY variant_title)
 * - GET /api/shopify-lengths (GROUP BY variant_title)
 *
 * Safe: indexes only (no deletes).
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_osli_shop_created_at_variant_title ON orders_shopify_line_items(shop, order_created_at, variant_title)',
  ];

  if (isPostgres()) {
    for (const stmt of statements) await db.run(stmt);
  } else {
    for (const stmt of statements) await db.exec(stmt);
  }
}

module.exports = { up };

