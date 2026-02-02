/**
 * Add first_path, first_product_handle to sessions (landing page; set on first event only).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = ['first_path', 'first_product_handle'];
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
