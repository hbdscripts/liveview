const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const stmt = 'CREATE INDEX IF NOT EXISTS idx_sessions_last_seen_started_at ON sessions(last_seen, started_at)';

  if (isPostgres()) {
    await db.run(stmt);
    await db.exec('ANALYZE sessions');
    return;
  }

  await db.exec(stmt);
  await db.exec('ANALYZE');
}

module.exports = { up };

