const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const statements = [
    'CREATE INDEX IF NOT EXISTS idx_sessions_first_product_handle_started_at_bot ON sessions(first_product_handle, started_at, cf_known_bot)',
  ];

  if (isPostgres()) {
    for (const stmt of statements) {
      await db.run(stmt);
    }
    return;
  }

  for (const stmt of statements) {
    await db.exec(stmt);
  }
}

module.exports = { up };
