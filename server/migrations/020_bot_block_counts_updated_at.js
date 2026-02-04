/**
 * Add updated_at to bot_block_counts so the dashboard can show freshness.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE bot_block_counts ADD COLUMN IF NOT EXISTS updated_at BIGINT');
  } else {
    try {
      await db.run('ALTER TABLE bot_block_counts ADD COLUMN updated_at INTEGER');
    } catch (e) {
      if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
    }
  }
}

module.exports = { up };

