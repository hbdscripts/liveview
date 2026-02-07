const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_report_cache_computed_at ON report_cache(computed_at)',
    'CREATE INDEX IF NOT EXISTS idx_reconcile_snapshots_fetched_at ON reconcile_snapshots(fetched_at)',
  ];

  if (isPostgres()) {
    for (const stmt of statements) {
      try {
        await db.run(stmt);
      } catch (_) {}
    }
  } else {
    for (const stmt of statements) {
      try {
        await db.exec(stmt);
      } catch (_) {}
    }
  }
}

module.exports = { up };
