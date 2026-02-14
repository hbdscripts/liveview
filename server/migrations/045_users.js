/**
 * Users + access tiers.
 *
 * Adds a lightweight `users` table for:
 * - local email/password login
 * - pending approvals (block until approved)
 * - roles (user/master) and future tiers (free/pro/etc)
 *
 * Timestamps are epoch ms for SQLite/Postgres compatibility.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | denied
  role TEXT NOT NULL DEFAULT 'user', -- user | master (more later)
  tier TEXT NOT NULL DEFAULT 'free', -- free | pro (more later)
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  denied_at INTEGER,
  last_login_at INTEGER,
  last_country TEXT,
  last_city TEXT,
  last_device_type TEXT,
  last_platform TEXT,
  last_user_agent TEXT,
  last_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  role TEXT NOT NULL DEFAULT 'user',
  tier TEXT NOT NULL DEFAULT 'free',
  created_at BIGINT NOT NULL,
  approved_at BIGINT,
  denied_at BIGINT,
  last_login_at BIGINT,
  last_country TEXT,
  last_city TEXT,
  last_device_type TEXT,
  last_platform TEXT,
  last_user_agent TEXT,
  last_ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
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

