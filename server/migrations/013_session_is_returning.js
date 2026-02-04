/**
 * Add is_returning to sessions so we can report returning-customer revenue per range.
 * Set on first session create from visitor's isReturning; not updated on later events.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_returning SMALLINT DEFAULT 0');
  } else {
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN is_returning INTEGER DEFAULT 0');
    } catch (e) {
      if (!e.message || !e.message.includes('duplicate column')) throw e;
    }
  }
}

module.exports = { up };
