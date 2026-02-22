/**
 * Per-user permission overrides: store only keys explicitly set (true/false).
 * Missing key means "Default (inherit from role)".
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id INTEGER PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id BIGINT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run(pgSchema.trim());
  } else {
    await db.exec(sqliteSchema);
  }
}

module.exports = { up };
