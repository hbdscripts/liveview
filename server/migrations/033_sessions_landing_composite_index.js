/**
 * Composite index for product landing session queries.
 *
 * All landing-sessions queries filter on (started_at, cf_known_bot) together.
 * The existing idx_sessions_started_at only covers started_at alone, forcing
 * a full scan of matching rows to check cf_known_bot.
 *
 * Also adds a covering index for the orders_shopify_line_items status filters
 * used by every product report query.
 *
 * Safe: indexes only (no deletes).
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const statements = [
    // Sessions: composite for date-range + bot filter used by all landing queries
    'CREATE INDEX IF NOT EXISTS idx_sessions_started_at_bot ON sessions(started_at, cf_known_bot)',

    // orders_shopify_line_items: composite for the common WHERE clause pattern
    // (shop, order_created_at, order_financial_status, order_cancelled_at, order_test)
    'CREATE INDEX IF NOT EXISTS idx_osli_shop_created_status ON orders_shopify_line_items(shop, order_created_at, order_financial_status, order_cancelled_at, order_test)',
  ];

  if (isPostgres()) {
    for (const stmt of statements) await db.run(stmt);
  } else {
    for (const stmt of statements) await db.exec(stmt);
  }
}

module.exports = { up };
