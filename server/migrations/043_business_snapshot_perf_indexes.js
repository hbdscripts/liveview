const { getDb, isPostgres } = require('../db');

/**
 * Business Snapshot performance indexes.
 *
 * Safe: indexes only (no deletes).
 */
async function up() {
  const db = getDb();
  const statements = [
    // Speed up COGS query (paid line-items grouped by variant_id in a date range).
    "CREATE INDEX IF NOT EXISTS idx_osli_shop_created_paid_variant_id ON orders_shopify_line_items(shop, order_created_at, variant_id) WHERE order_financial_status = 'paid' AND order_cancelled_at IS NULL AND (order_test IS NULL OR order_test = 0)",

    // Speed up returning/distinct customer queries (paid checkout-token orders grouped by customer).
    "CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_customer_created_paid_checkout ON orders_shopify(shop, customer_id, created_at) WHERE financial_status = 'paid' AND cancelled_at IS NULL AND (test IS NULL OR test = 0) AND checkout_token IS NOT NULL AND checkout_token != '' AND customer_id IS NOT NULL AND customer_id != ''",
  ];

  if (isPostgres()) {
    for (const stmt of statements) {
      try { await db.run(stmt); } catch (_) {}
    }
    try { await db.exec('ANALYZE orders_shopify'); } catch (_) {}
    try { await db.exec('ANALYZE orders_shopify_line_items'); } catch (_) {}
    return;
  }

  for (const stmt of statements) {
    try { await db.exec(stmt); } catch (_) {}
  }
  try { await db.exec('ANALYZE'); } catch (_) {}
}

module.exports = { up };

