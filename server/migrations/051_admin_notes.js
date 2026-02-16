/**
 * Admin Notes: admin-only todo/notes stored in DB.
 * Table: admin_notes (id, body, created_at, created_by)
 * Used as a read-todo list for admins (footer pen icon, modal).
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS admin_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_created_at ON admin_notes(created_at DESC);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS admin_notes (
  id SERIAL PRIMARY KEY,
  body TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_notes_created_at ON admin_notes(created_at DESC);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.exec('CREATE TABLE IF NOT EXISTS admin_notes (id SERIAL PRIMARY KEY, body TEXT NOT NULL, created_at BIGINT NOT NULL, created_by TEXT)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_admin_notes_created_at ON admin_notes(created_at DESC)').catch(() => null);
  } else {
    await db.exec(sqliteSchema);
  }
}

module.exports = { up };
