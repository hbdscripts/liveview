const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  const statements = [
    "CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_event_occurred_at ON purchase_events(shop, event_type, occurred_at)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_bs_campaign_id ON sessions(bs_campaign_id)",
    "CREATE INDEX IF NOT EXISTS idx_sessions_bs_adgroup_id ON sessions(bs_adgroup_id)",
  ];

  if (isPostgres()) {
    for (const stmt of statements) {
      await db.run(stmt);
    }
    try {
      await db.run(
        "CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_created_paid ON orders_shopify(shop, created_at) WHERE financial_status = 'paid' AND cancelled_at IS NULL AND (test IS NULL OR test = 0)"
      );
    } catch (_) {}
    return;
  }

  for (const stmt of statements) {
    await db.exec(stmt);
  }
  try {
    await db.exec(
      "CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_created_paid ON orders_shopify(shop, created_at) WHERE financial_status = 'paid' AND cancelled_at IS NULL AND (test IS NULL OR test = 0)"
    );
  } catch (_) {}
}

module.exports = { up };
