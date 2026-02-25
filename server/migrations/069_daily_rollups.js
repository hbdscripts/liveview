/**
 * Daily rollups: compact per-day aggregates used for long retention charts/KPIs.
 *
 * Phase 1 (single-install): no shop column yet. Phase 2 will add (shop, ymd, traffic_mode).
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS daily_rollups (
  ymd TEXT NOT NULL,
  traffic_mode TEXT NOT NULL,
  total_sessions INTEGER NOT NULL,
  human_sessions INTEGER NOT NULL,
  known_bot_sessions INTEGER NOT NULL,
  single_page_sessions INTEGER NOT NULL,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (ymd, traffic_mode)
);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_ymd ON daily_rollups(ymd);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_computed_at ON daily_rollups(computed_at);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS daily_rollups (
  ymd TEXT NOT NULL,
  traffic_mode TEXT NOT NULL,
  total_sessions BIGINT NOT NULL,
  human_sessions BIGINT NOT NULL,
  known_bot_sessions BIGINT NOT NULL,
  single_page_sessions BIGINT NOT NULL,
  computed_at BIGINT NOT NULL,
  PRIMARY KEY (ymd, traffic_mode)
);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_ymd ON daily_rollups(ymd);
CREATE INDEX IF NOT EXISTS idx_daily_rollups_computed_at ON daily_rollups(computed_at);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    const statements = pgSchema.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
  } else {
    await db.exec(sqliteSchema);
  }
}

module.exports = { up };

