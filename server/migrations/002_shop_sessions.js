/**
 * Shop sessions table for OAuth access tokens (install flow).
 */

const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS shop_sessions (
  shop TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  scope TEXT,
  updated_at INTEGER NOT NULL
);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS shop_sessions (
  shop TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  scope TEXT,
  updated_at BIGINT NOT NULL
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
