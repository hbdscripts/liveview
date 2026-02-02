/**
 * Add session country and purchase timestamp for accurate stats.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS country_code TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS purchased_at BIGINT');
    await db.run(`
      UPDATE sessions s
      SET country_code = v.last_country
      FROM visitors v
      WHERE s.visitor_id = v.visitor_id
        AND (s.country_code IS NULL OR s.country_code = '')
    `);
    await db.run(`
      UPDATE sessions
      SET purchased_at = last_seen
      WHERE has_purchased = 1 AND purchased_at IS NULL
    `);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_purchased_at ON sessions(purchased_at)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_country_code ON sessions(country_code)');
  } else {
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN country_code TEXT');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN purchased_at INTEGER');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
    await db.run(`
      UPDATE sessions
      SET country_code = (SELECT last_country FROM visitors v WHERE v.visitor_id = sessions.visitor_id)
      WHERE country_code IS NULL OR country_code = ''
    `);
    await db.run(`
      UPDATE sessions
      SET purchased_at = last_seen
      WHERE has_purchased = 1 AND purchased_at IS NULL
    `);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_purchased_at ON sessions(purchased_at)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_country_code ON sessions(country_code)');
  }
}

module.exports = { up };
