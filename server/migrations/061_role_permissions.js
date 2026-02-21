/**
 * Role permissions table: per-tier (starter/growth/pro/scale) checkbox state for pages + settings.
 * Admin is not stored here; admin always has full access.
 */
const { getDb, isPostgres } = require('../db');
const { VALID_TIERS, getDefaultPermissionsForTier } = require('../rbac');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS role_permissions (
  tier TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS role_permissions (
  tier TEXT PRIMARY KEY,
  permissions_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run(pgSchema.trim());
  } else {
    await db.exec(sqliteSchema);
  }

  const now = Date.now();
  const defaultPerms = JSON.stringify(getDefaultPermissionsForTier());
  for (const tier of VALID_TIERS) {
    try {
      if (isPostgres()) {
        await db.run(
          'INSERT INTO role_permissions (tier, permissions_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (tier) DO NOTHING',
          [tier, defaultPerms, now]
        );
      } else {
        await db.run(
          'INSERT OR IGNORE INTO role_permissions (tier, permissions_json, updated_at) VALUES (?, ?, ?)',
          [tier, defaultPerms, now]
        );
      }
    } catch (_) {
      // Row may already exist from prior run
    }
  }
}

module.exports = { up };
