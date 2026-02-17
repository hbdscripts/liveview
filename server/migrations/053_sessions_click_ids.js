/**
 * Deterministic click-id persistence on sessions for Google Ads postback.
 * Adds normalized gclid, gbraid, wbraid columns (parsed from entry_url at write-time).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = ['gclid', 'gbraid', 'wbraid'];
  if (isPostgres()) {
    for (const col of cols) {
      await db.run(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_gclid ON sessions(gclid) WHERE gclid IS NOT NULL').catch(() => null);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_gbraid ON sessions(gbraid) WHERE gbraid IS NOT NULL').catch(() => null);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_wbraid ON sessions(wbraid) WHERE wbraid IS NOT NULL').catch(() => null);
  } else {
    for (const col of cols) {
      try {
        await db.run(`ALTER TABLE sessions ADD COLUMN ${col} TEXT`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_gclid ON sessions(gclid)').catch(() => null);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_gbraid ON sessions(gbraid)').catch(() => null);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_wbraid ON sessions(wbraid)').catch(() => null);
  }
}

module.exports = { up };
