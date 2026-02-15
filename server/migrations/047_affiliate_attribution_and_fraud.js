/**
 * Affiliate attribution + fraud evaluations.
 *
 * Safe:
 * - Creates new tables only.
 * - Idempotent (CREATE IF NOT EXISTS).
 * - No deletes from core tables.
 *
 * Notes:
 * - JSON fields are stored as TEXT for SQLite/Postgres compatibility (project convention).
 * - Timestamps are epoch ms (INTEGER/BIGINT).
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS affiliate_attribution_sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT,
  first_seen_at INTEGER NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'unknown', -- affiliate | paid | organic | direct | unknown
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  paid_click_ids_json TEXT, -- JSON object (e.g. {gclid, msclkid, fbclid})
  affiliate_click_ids_json TEXT, -- JSON object (e.g. {clickid, irclickid, sca_ref})
  affiliate_network_hint TEXT, -- e.g. uppromote | impact | awin | cj | rakuten | unknown
  affiliate_id_hint TEXT,
  landing_url TEXT NOT NULL DEFAULT '',
  referrer TEXT,
  ip_hash TEXT, -- hash only; never raw IP
  ua_hash TEXT,
  last_seen_at INTEGER,
  last_seen_json TEXT, -- JSON object with secondary/late signals (rate-limited updates)
  evidence_version TEXT NOT NULL DEFAULT 'v1',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_sessions_visitor_id ON affiliate_attribution_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_sessions_ip_hash ON affiliate_attribution_sessions(ip_hash);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS affiliate_attribution_sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT,
  first_seen_at BIGINT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'unknown',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  paid_click_ids_json TEXT,
  affiliate_click_ids_json TEXT,
  affiliate_network_hint TEXT,
  affiliate_id_hint TEXT,
  landing_url TEXT NOT NULL DEFAULT '',
  referrer TEXT,
  ip_hash TEXT,
  ua_hash TEXT,
  last_seen_at BIGINT,
  last_seen_json TEXT,
  evidence_version TEXT NOT NULL DEFAULT 'v1',
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_sessions_visitor_id ON affiliate_attribution_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_sessions_ip_hash ON affiliate_attribution_sessions(ip_hash);

CREATE TABLE IF NOT EXISTS fraud_evaluations (
  eval_id BIGSERIAL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  entity_type TEXT NOT NULL, -- session | purchase | order
  entity_id TEXT NOT NULL,
  session_id TEXT,
  visitor_id TEXT,
  order_id TEXT,
  checkout_token TEXT,
  score INT NOT NULL,
  triggered SMALLINT NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT,
  ai_summary TEXT,
  ai_model TEXT,
  ai_version TEXT,
  resolved_status TEXT NOT NULL DEFAULT 'open', -- open|reviewed|ignored|denied|approved
  resolved_by TEXT,
  resolved_note TEXT,
  ip_hash TEXT,
  affiliate_network_hint TEXT,
  affiliate_id_hint TEXT,
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_triggered_created_at ON fraud_evaluations(triggered, created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_session_id ON fraud_evaluations(session_id);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_visitor_id ON fraud_evaluations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_order_id ON fraud_evaluations(order_id);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_checkout_token ON fraud_evaluations(checkout_token);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_ip_hash_created_at ON fraud_evaluations(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS fraud_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

// SQLite requires INTEGER PK AUTOINCREMENT; keep schema split so we can still use the pg block above.
const sqliteFraudSchema = `
CREATE TABLE IF NOT EXISTS fraud_evaluations (
  eval_id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  entity_type TEXT NOT NULL, -- session | purchase | order
  entity_id TEXT NOT NULL,
  session_id TEXT,
  visitor_id TEXT,
  order_id TEXT,
  checkout_token TEXT,
  score INTEGER NOT NULL,
  triggered INTEGER NOT NULL DEFAULT 0,
  flags_json TEXT NOT NULL DEFAULT '[]',
  evidence_json TEXT,
  ai_summary TEXT,
  ai_model TEXT,
  ai_version TEXT,
  resolved_status TEXT NOT NULL DEFAULT 'open', -- open|reviewed|ignored|denied|approved
  resolved_by TEXT,
  resolved_note TEXT,
  ip_hash TEXT,
  affiliate_network_hint TEXT,
  affiliate_id_hint TEXT,
  UNIQUE (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_triggered_created_at ON fraud_evaluations(triggered, created_at);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_session_id ON fraud_evaluations(session_id);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_visitor_id ON fraud_evaluations(visitor_id);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_order_id ON fraud_evaluations(order_id);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_checkout_token ON fraud_evaluations(checkout_token);
CREATE INDEX IF NOT EXISTS idx_fraud_evaluations_ip_hash_created_at ON fraud_evaluations(ip_hash, created_at);

CREATE TABLE IF NOT EXISTS fraud_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    const statements = pgSchema.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
  } else {
    await db.exec(sqliteSchema);
    await db.exec(sqliteFraudSchema);
  }
}

module.exports = { up };

