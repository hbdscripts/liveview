/**
 * Add OAuth attribution columns to shop_sessions: who signed in (Shopify staff email) and when.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const columns = [
    { name: 'last_oauth_email', sqlite: 'TEXT', pg: 'TEXT' },
    { name: 'last_oauth_user_id', sqlite: 'INTEGER', pg: 'BIGINT' },
    { name: 'last_oauth_at', sqlite: 'INTEGER', pg: 'BIGINT' },
  ];
  for (const col of columns) {
    try {
      if (isPostgres()) {
        await db.run(`ALTER TABLE shop_sessions ADD COLUMN IF NOT EXISTS ${col.name} ${col.pg}`);
      } else {
        await db.run(`ALTER TABLE shop_sessions ADD COLUMN ${col.name} ${col.sqlite}`);
      }
    } catch (e) {
      if (!String(e.message || e).includes('duplicate') && !String(e.message || e).includes('already exists')) throw e;
    }
  }
}

module.exports = { up };
