/**
 * Edge block events: append-only log of edge-blocked/dropped requests.
 *
 * Privacy: never store raw IP. Only store ip_prefix and/or non-reversible salted hash.
 */

const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS edge_block_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  edge_result TEXT,
  blocked_reason TEXT,
  http_method TEXT,
  host TEXT,
  path TEXT,
  ray_id TEXT,
  country TEXT,
  colo TEXT,
  asn TEXT,
  known_bot INTEGER DEFAULT 0,
  verified_bot_category TEXT,
  ua TEXT,
  origin TEXT,
  referer TEXT,
  ip_hash TEXT,
  ip_prefix TEXT,
  tenant_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_edge_block_events_created_at ON edge_block_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_reason_created_at ON edge_block_events(blocked_reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_country_created_at ON edge_block_events(country, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_asn_created_at ON edge_block_events(asn, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_tenant_created_at ON edge_block_events(tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS edge_block_counts_hourly (
  hour_ts INTEGER NOT NULL,
  blocked_reason TEXT NOT NULL,
  tenant_key TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER,
  PRIMARY KEY (hour_ts, blocked_reason, tenant_key)
);
CREATE INDEX IF NOT EXISTS idx_edge_block_counts_hourly_hour ON edge_block_counts_hourly(hour_ts DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_counts_hourly_reason_hour ON edge_block_counts_hourly(blocked_reason, hour_ts DESC);
`.trim();

const pgSchema = `
CREATE TABLE IF NOT EXISTS edge_block_events (
  id BIGSERIAL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  edge_result TEXT,
  blocked_reason TEXT,
  http_method TEXT,
  host TEXT,
  path TEXT,
  ray_id TEXT,
  country TEXT,
  colo TEXT,
  asn TEXT,
  known_bot SMALLINT DEFAULT 0,
  verified_bot_category TEXT,
  ua TEXT,
  origin TEXT,
  referer TEXT,
  ip_hash TEXT,
  ip_prefix TEXT,
  tenant_key TEXT
);

CREATE INDEX IF NOT EXISTS idx_edge_block_events_created_at ON edge_block_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_reason_created_at ON edge_block_events(blocked_reason, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_country_created_at ON edge_block_events(country, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_asn_created_at ON edge_block_events(asn, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_events_tenant_created_at ON edge_block_events(tenant_key, created_at DESC);

CREATE TABLE IF NOT EXISTS edge_block_counts_hourly (
  hour_ts BIGINT NOT NULL,
  blocked_reason TEXT NOT NULL,
  tenant_key TEXT NOT NULL DEFAULT '',
  count BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT,
  PRIMARY KEY (hour_ts, blocked_reason, tenant_key)
);
CREATE INDEX IF NOT EXISTS idx_edge_block_counts_hourly_hour ON edge_block_counts_hourly(hour_ts DESC);
CREATE INDEX IF NOT EXISTS idx_edge_block_counts_hourly_reason_hour ON edge_block_counts_hourly(blocked_reason, hour_ts DESC);
`.trim();

async function up() {
  const db = getDb();
  await db.exec(isPostgres() ? pgSchema : sqliteSchema);
}

module.exports = { up };

