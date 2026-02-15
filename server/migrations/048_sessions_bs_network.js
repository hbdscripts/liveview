const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS bs_network TEXT');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_bs_network ON sessions(bs_network)');
    return;
  }

  try {
    await db.run('ALTER TABLE sessions ADD COLUMN bs_network TEXT');
  } catch (e) {
    if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
  }
}

module.exports = { up };

