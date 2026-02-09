const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  // Targeted indexes for hottest read paths:
  // - events bounce/page_view counting: filter by type then group/join by session_id
  // - traffic picker: last_seen + traffic_source_key + human-only
  // - truth queries: returning/customer history
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_events_type_session_id ON events(type, session_id)',
    'CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_source_bot ON sessions(last_seen, traffic_source_key, cf_known_bot)',
    'CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_customer_id_created_at ON orders_shopify(shop, customer_id, created_at)',
  ];

  if (isPostgres()) {
    for (const stmt of indexes) {
      await db.run(stmt);
    }
    await db.exec('ANALYZE sessions');
    await db.exec('ANALYZE events');
    await db.exec('ANALYZE orders_shopify');
    return;
  }

  for (const stmt of indexes) {
    await db.exec(stmt);
  }
  await db.exec('ANALYZE');
}

module.exports = { up };

