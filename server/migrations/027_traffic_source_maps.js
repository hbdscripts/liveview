/**
 * Custom traffic source mapping + icons.
 *
 * Purpose:
 * - Track observed UTM tokens from entry_url so the admin UI can surface "unmapped" sources.
 * - Allow mapping UTM tokens -> a stable traffic_source_key (plus label + optional icon URL).
 *
 * Notes:
 * - No deletes are required; mappings can be appended and meta can be upserted.
 * - This migration is safe for both SQLite and Postgres.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS traffic_source_meta (
  source_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon_url TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_meta_updated_at ON traffic_source_meta(updated_at);

CREATE TABLE IF NOT EXISTS traffic_source_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  utm_param TEXT NOT NULL,
  utm_value TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_rules_param_value ON traffic_source_rules(utm_param, utm_value);
CREATE UNIQUE INDEX IF NOT EXISTS uq_traffic_source_rules_triplet ON traffic_source_rules(utm_param, utm_value, source_key);

CREATE TABLE IF NOT EXISTS traffic_source_tokens (
  utm_param TEXT NOT NULL,
  utm_value TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  seen_count INTEGER NOT NULL,
  PRIMARY KEY (utm_param, utm_value)
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_tokens_last_seen ON traffic_source_tokens(last_seen_at);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS traffic_source_meta (
  source_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon_url TEXT,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_meta_updated_at ON traffic_source_meta(updated_at);

CREATE TABLE IF NOT EXISTS traffic_source_rules (
  id BIGSERIAL PRIMARY KEY,
  utm_param TEXT NOT NULL,
  utm_value TEXT NOT NULL,
  source_key TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_rules_param_value ON traffic_source_rules(utm_param, utm_value);
CREATE UNIQUE INDEX IF NOT EXISTS uq_traffic_source_rules_triplet ON traffic_source_rules(utm_param, utm_value, source_key);

CREATE TABLE IF NOT EXISTS traffic_source_tokens (
  utm_param TEXT NOT NULL,
  utm_value TEXT NOT NULL,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  seen_count BIGINT NOT NULL,
  PRIMARY KEY (utm_param, utm_value)
);
CREATE INDEX IF NOT EXISTS idx_traffic_source_tokens_last_seen ON traffic_source_tokens(last_seen_at);
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

