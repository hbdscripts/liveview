/**
 * Edge metadata: persist city + browser on sessions.
 *
 * - cf_city: city from Cloudflare Worker / request.cf (preferred)
 * - city: geoip-lite fallback city (best-effort)
 * - ua_browser / ua_browser_version: derived from User-Agent
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = [
    'cf_city',
    'city',
    'ua_browser',
    'ua_browser_version',
  ];

  if (isPostgres()) {
    for (const col of cols) {
      await db.run(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }
  } else {
    for (const col of cols) {
      try {
        await db.run(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    }
  }
}

module.exports = { up };

