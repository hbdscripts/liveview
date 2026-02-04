/**
 * Performance indexes for larger datasets / reports.
 *
 * Adds indexes used by:
 * - country stats + worst products (joins via purchase_events -> sessions)
 * - product landing reports (first_product_handle / first_path)
 *
 * Safe: indexes only (no deletes).
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  const statements = [
    // purchase_events: speed up joins + filters used in reports.
    'CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_event_session_id ON purchase_events(shop, event_type, session_id)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_event_linked_order_id ON purchase_events(shop, event_type, linked_order_id)',

    // sessions: speed up product landing lookups.
    'CREATE INDEX IF NOT EXISTS idx_sessions_first_product_handle ON sessions(first_product_handle)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_first_path ON sessions(first_path)',
  ];

  if (isPostgres()) {
    for (const stmt of statements) {
      await db.run(stmt);
    }
  } else {
    for (const stmt of statements) {
      await db.exec(stmt);
    }
  }
}

module.exports = { up };

