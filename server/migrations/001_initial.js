/**
 * Initial schema: visitors, sessions, events, settings.
 * Uses epoch ms for all timestamps for SQLite/Postgres compatibility.
 */

const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_country TEXT,
  device TEXT,
  network_speed TEXT,
  is_returning INTEGER DEFAULT 0,
  returning_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_path TEXT,
  last_product_handle TEXT,
  cart_qty INTEGER DEFAULT 0,
  is_checking_out INTEGER DEFAULT 0,
  checkout_started_at INTEGER,
  has_purchased INTEGER DEFAULT 0,
  is_abandoned INTEGER DEFAULT 0,
  abandoned_at INTEGER,
  recovered_at INTEGER,
  FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_sessions_abandoned ON sessions(is_abandoned, abandoned_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  product_handle TEXT,
  qty_delta INTEGER,
  cart_qty INTEGER,
  checkout_state_json TEXT,
  meta_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('tracking_enabled', 'true');
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS visitors (
  visitor_id TEXT PRIMARY KEY,
  first_seen BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  last_country TEXT,
  device TEXT,
  network_speed TEXT,
  is_returning SMALLINT DEFAULT 0,
  returning_count INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL REFERENCES visitors(visitor_id),
  started_at BIGINT NOT NULL,
  last_seen BIGINT NOT NULL,
  last_path TEXT,
  last_product_handle TEXT,
  cart_qty INT DEFAULT 0,
  is_checking_out SMALLINT DEFAULT 0,
  checkout_started_at BIGINT,
  has_purchased SMALLINT DEFAULT 0,
  is_abandoned SMALLINT DEFAULT 0,
  abandoned_at BIGINT,
  recovered_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen);
CREATE INDEX IF NOT EXISTS idx_sessions_abandoned ON sessions(is_abandoned, abandoned_at);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(session_id),
  ts BIGINT NOT NULL,
  type TEXT NOT NULL,
  path TEXT,
  product_handle TEXT,
  qty_delta INT,
  cart_qty INT,
  checkout_state_json TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT INTO settings (key, value) VALUES ('tracking_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
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
  }
}

module.exports = { up };
