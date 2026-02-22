/**
 * Add deleted_at to notification_read_state for per-user permanent delete.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE notification_read_state ADD COLUMN IF NOT EXISTS deleted_at BIGINT').catch(() => null);
  } else {
    try {
      await db.run('ALTER TABLE notification_read_state ADD COLUMN deleted_at INTEGER');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}

module.exports = { up };
