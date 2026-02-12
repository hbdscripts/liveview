const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const stmt = "CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_processed_paid ON orders_shopify(shop, processed_at) WHERE financial_status = 'paid' AND cancelled_at IS NULL AND (test IS NULL OR test = 0)";

  if (isPostgres()) {
    try { await db.run(stmt); } catch (_) {}
    try { await db.exec('ANALYZE orders_shopify'); } catch (_) {}
    return;
  }

  try { await db.exec(stmt); } catch (_) {}
  try { await db.exec('ANALYZE'); } catch (_) {}
}

module.exports = { up };

