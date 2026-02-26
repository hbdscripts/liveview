/**
 * Add last_auth_provider to users (google | shopify | local) for Admin Users login method visibility.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const col = { name: 'last_auth_provider', sqlite: 'TEXT', pg: 'TEXT' };
  try {
    if (isPostgres()) {
      await db.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col.name} ${col.pg}`);
    } else {
      await db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.sqlite}`);
    }
  } catch (e) {
    const msg = String((e && e.message) || e || '').toLowerCase();
    if (!msg.includes('duplicate') && !msg.includes('already exists')) throw e;
  }
}

module.exports = { up };
