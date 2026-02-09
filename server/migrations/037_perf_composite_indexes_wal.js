const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  const indexes = [
    // Composite: sessions range queries that filter by started_at and order by last_seen
    'CREATE INDEX IF NOT EXISTS idx_sessions_started_at_last_seen ON sessions(started_at, last_seen)',
    // Composite: time-range purchase aggregates joining to sessions
    'CREATE INDEX IF NOT EXISTS idx_purchases_purchased_at_session_id ON purchases(purchased_at, session_id)',
    // Composite: per-session purchase lookups ordered by time
    'CREATE INDEX IF NOT EXISTS idx_purchases_session_id_purchased_at ON purchases(session_id, purchased_at)',
  ];

  if (isPostgres()) {
    for (const stmt of indexes) {
      await db.run(stmt);
    }
    // Postgres: update planner statistics
    await db.exec('ANALYZE sessions');
    await db.exec('ANALYZE purchases');
    return;
  }

  // SQLite: enable WAL mode for better concurrent read/write performance
  await db.exec('PRAGMA journal_mode = WAL');
  // Increase cache size to 32 MB (negative = KiB)
  await db.exec('PRAGMA cache_size = -32000');
  // Enable memory-mapped I/O (256 MB) for faster reads
  await db.exec('PRAGMA mmap_size = 268435456');

  for (const stmt of indexes) {
    await db.exec(stmt);
  }

  // Update planner statistics after adding indexes
  await db.exec('ANALYZE');
}

module.exports = { up };
