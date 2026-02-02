/**
 * Add utm_campaign to sessions for Source column (dashboard shows value or "Direct").
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS utm_campaign TEXT');
  } else {
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN utm_campaign TEXT');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}

module.exports = { up };
