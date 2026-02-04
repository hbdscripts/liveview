/**
 * Shopify sessions snapshots: append-only daily/session-run counts from ShopifyQL.
 *
 * Used for optional reporting where sessions denominator comes from Shopify rather than our sessions table.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS shopify_sessions_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_key TEXT,
  shop TEXT NOT NULL,
  day_ymd TEXT NOT NULL,
  sessions_count INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopify_sessions_snapshots_shop_day ON shopify_sessions_snapshots(shop, day_ymd, fetched_at);
CREATE INDEX IF NOT EXISTS idx_shopify_sessions_snapshots_shop_key ON shopify_sessions_snapshots(shop, snapshot_key, fetched_at);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS shopify_sessions_snapshots (
  id BIGSERIAL PRIMARY KEY,
  snapshot_key TEXT,
  shop TEXT NOT NULL,
  day_ymd TEXT NOT NULL,
  sessions_count INT NOT NULL,
  fetched_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopify_sessions_snapshots_shop_day ON shopify_sessions_snapshots(shop, day_ymd, fetched_at);
CREATE INDEX IF NOT EXISTS idx_shopify_sessions_snapshots_shop_key ON shopify_sessions_snapshots(shop, snapshot_key, fetched_at);
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

