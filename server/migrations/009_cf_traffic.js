/**
 * Add Cloudflare traffic classification to sessions (for human-only stats).
 * No bot score; only cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn.
 */

const { getDb, isPostgres } = require('../db');

const cols = [
  { name: 'cf_known_bot', type: 'INTEGER' },
  { name: 'cf_verified_bot_category', type: 'TEXT' },
  { name: 'cf_country', type: 'TEXT' },
  { name: 'cf_colo', type: 'TEXT' },
  { name: 'cf_asn', type: 'TEXT' },
];

async function up() {
  const db = getDb();
  for (const col of cols) {
    if (isPostgres()) {
      await db.run(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
    } else {
      try {
        await db.run(`ALTER TABLE sessions ADD COLUMN ${col.name} ${col.type}`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    }
  }
}

module.exports = { up };
