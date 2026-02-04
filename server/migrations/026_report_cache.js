/**
 * Persisted report cache (server-side).
 *
 * Goal:
 * - Cache expensive aggregates across restarts/replicas (in-memory caches are lost on deploy/restart).
 *
 * Notes:
 * - Keyed by cache_key (app-defined stable string; typically shop|endpoint|range|rangeStart|paramsHash).
 * - Overwrites (UPSERT) are allowed; no deletes are required.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS report_cache (
  cache_key TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  range_key TEXT NOT NULL,
  range_start_ts INTEGER NOT NULL,
  range_end_ts INTEGER NOT NULL,
  params_hash TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  ttl_ms INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_cache_shop_endpoint ON report_cache(shop, endpoint, computed_at);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS report_cache (
  cache_key TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  range_key TEXT NOT NULL,
  range_start_ts BIGINT NOT NULL,
  range_end_ts BIGINT NOT NULL,
  params_hash TEXT NOT NULL,
  computed_at BIGINT NOT NULL,
  ttl_ms BIGINT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_cache_shop_endpoint ON report_cache(shop, endpoint, computed_at);
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

