/**
 * Role permissions: read/update per-tier permission maps (starter/growth/pro/scale).
 */
const { getDb, isPostgres } = require('./db');
const rbac = require('./rbac');

async function getRolePermissions(tier) {
  const t = rbac.validateTier(tier);
  if (!t) return rbac.getDefaultPermissionsForTier();
  const db = getDb();
  try {
    const row = await db.get('SELECT permissions_json FROM role_permissions WHERE tier = ?', [t]);
    if (!row || !row.permissions_json) return rbac.getDefaultPermissionsForTier();
    const parsed = JSON.parse(row.permissions_json);
    if (!parsed || typeof parsed !== 'object') return rbac.getDefaultPermissionsForTier();
    const out = rbac.getDefaultPermissionsForTier();
    for (const key of rbac.ALL_PERMISSION_KEYS) {
      if (parsed[key] === true || parsed[key] === false) {
        out[key] = parsed[key] === true;
      }
    }
    return out;
  } catch (_) {
    return rbac.getDefaultPermissionsForTier();
  }
}

async function getAllRolePermissions() {
  const db = getDb();
  const tiers = rbac.VALID_TIERS;
  const result = {};
  for (const tier of tiers) {
    result[tier] = await getRolePermissions(tier);
  }
  return result;
}

async function putRolePermissions(tier, permissions) {
  const t = rbac.validateTier(tier);
  if (!t) return { ok: false, error: 'invalid_tier' };
  const db = getDb();
  const current = await getRolePermissions(t);
  const next = { ...current };
  if (permissions && typeof permissions === 'object') {
    for (const key of rbac.ALL_PERMISSION_KEYS) {
      if (permissions[key] === true || permissions[key] === false) {
        next[key] = permissions[key] === true;
      }
    }
  }
  const now = Date.now();
  const json = JSON.stringify(next);
  try {
    if (isPostgres()) {
      await db.run(
        'INSERT INTO role_permissions (tier, permissions_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (tier) DO UPDATE SET permissions_json = ?, updated_at = ?',
        [t, json, now, json, now]
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO role_permissions (tier, permissions_json, updated_at) VALUES (?, ?, ?)',
        [t, json, now]
      );
    }
    return { ok: true, permissions: next };
  } catch (err) {
    return { ok: false, error: 'db_error' };
  }
}

module.exports = {
  getRolePermissions,
  getAllRolePermissions,
  putRolePermissions,
};
