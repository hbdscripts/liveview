/**
 * Add utm_source, utm_medium, utm_content to sessions (Source column shows all non-blank UTM params).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = ['utm_source', 'utm_medium', 'utm_content'];
  for (const col of cols) {
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
}

module.exports = { up };
