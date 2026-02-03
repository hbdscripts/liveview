/**
 * Add referrer to sessions (Source column: when no UTM, show derived source from referrer host).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const col = 'referrer';
  if (isPostgres()) {
    await db.run(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${col} TEXT`);
  } else {
    try {
      await db.run(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}

module.exports = { up };
