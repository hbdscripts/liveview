/**
 * Bot block counts: Worker reports each blocked request here so config panel can show "Bots blocked: X".
 */

const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS bot_block_counts (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS bot_block_counts (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
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
