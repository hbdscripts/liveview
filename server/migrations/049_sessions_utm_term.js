/**
 * Add utm_term to sessions (traffic source diagnostics + mapping).
 * Fixes NODE-1R: column s.utm_term does not exist.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS utm_term TEXT');
  } else {
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN utm_term TEXT');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}

module.exports = { up };
