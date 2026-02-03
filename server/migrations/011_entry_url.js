/**
 * Add entry_url to sessions (Cloudflare request Referer on entry).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const col = 'entry_url';
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

