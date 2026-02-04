/**
 * Sessions: derived traffic fields
 * - traffic_source_key: normalized marketing source category (google_ads, direct, etc)
 * - ua_device_type: desktop | mobile | tablet
 * - ua_platform: windows | mac | ios | android | chromeos | linux | other
 * - ua_model: iphone | ipad | (optional)
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS traffic_source_key TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ua_device_type TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ua_platform TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ua_model TEXT');

    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_traffic_source_key ON sessions(traffic_source_key)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_ua_device_type ON sessions(ua_device_type)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_ua_platform ON sessions(ua_platform)');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_ua_model ON sessions(ua_model)');
  } else {
    const cols = [
      { name: 'traffic_source_key', type: 'TEXT' },
      { name: 'ua_device_type', type: 'TEXT' },
      { name: 'ua_platform', type: 'TEXT' },
      { name: 'ua_model', type: 'TEXT' },
    ];
    for (const c of cols) {
      try {
        await db.run(`ALTER TABLE sessions ADD COLUMN ${c.name} ${c.type}`);
      } catch (e) {
        if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
      }
    }
    await db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_traffic_source_key ON sessions(traffic_source_key)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_ua_device_type ON sessions(ua_device_type)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_ua_platform ON sessions(ua_platform)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_ua_model ON sessions(ua_model)');
  }
}

module.exports = { up };

