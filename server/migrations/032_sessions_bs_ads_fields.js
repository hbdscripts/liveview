const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = [
    { name: 'bs_source', type: 'TEXT' },
    { name: 'bs_campaign_id', type: 'TEXT' },
    { name: 'bs_adgroup_id', type: 'TEXT' },
    { name: 'bs_ad_id', type: 'TEXT' },
  ];

  if (isPostgres()) {
    for (const c of cols) {
      await db.run(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ${c.name} ${c.type}`);
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_bs_campaign_id ON sessions(bs_campaign_id)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_bs_adgroup_id ON sessions(bs_adgroup_id)');
    return;
  }

  for (const c of cols) {
    try {
      await db.run(`ALTER TABLE sessions ADD COLUMN ${c.name} ${c.type}`);
    } catch (e) {
      if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
    }
  }
}

module.exports = { up };
