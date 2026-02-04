/**
 * Reconcile snapshots: append-only audit trail for successful Shopify Orders reconciliations.
 *
 * IMPORTANT: We never delete from orders_shopify/purchases/purchase_events/sessions to “fix” mismatches.
 * Snapshots let us compare sources over time without destructive repair.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS reconcile_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  scope TEXT NOT NULL,
  range_start_ts INTEGER NOT NULL,
  range_end_ts INTEGER NOT NULL,
  shopify_order_count INTEGER NOT NULL,
  shopify_revenue_gbp REAL NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reconcile_snapshots_shop_fetched_at ON reconcile_snapshots(shop, fetched_at);
CREATE INDEX IF NOT EXISTS idx_reconcile_snapshots_shop_scope_range ON reconcile_snapshots(shop, scope, range_start_ts, range_end_ts);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS reconcile_snapshots (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  scope TEXT NOT NULL,
  range_start_ts BIGINT NOT NULL,
  range_end_ts BIGINT NOT NULL,
  shopify_order_count INT NOT NULL,
  shopify_revenue_gbp DOUBLE PRECISION NOT NULL,
  fetched_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reconcile_snapshots_shop_fetched_at ON reconcile_snapshots(shop, fetched_at);
CREATE INDEX IF NOT EXISTS idx_reconcile_snapshots_shop_scope_range ON reconcile_snapshots(shop, scope, range_start_ts, range_end_ts);
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

