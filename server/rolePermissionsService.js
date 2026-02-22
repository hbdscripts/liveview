/**
 * Role permissions: read/update per-tier permission maps (starter/growth/pro/scale).
 * In-memory cache for getRolePermissions to reduce DB hits (TTL 120s; invalidated on put).
 */
const { getDb, isPostgres } = require('./db');
const rbac = require('./rbac');

const ROLE_PERMS_CACHE_TTL_MS = 120 * 1000;
const _rolePermsCache = {};
const _rolePermsCacheExpiry = {};

function getRolePermissionsCached(tier) {
  const t = rbac.validateTier(tier);
  if (!t) return null;
  const now = Date.now();
  if (_rolePermsCacheExpiry[t] != null && now < _rolePermsCacheExpiry[t]) {
    return _rolePermsCache[t];
  }
  return null;
}

function setRolePermissionsCached(tier, perms) {
  const t = rbac.validateTier(tier);
  if (!t) return;
  _rolePermsCache[t] = perms;
  _rolePermsCacheExpiry[t] = Date.now() + ROLE_PERMS_CACHE_TTL_MS;
}

function invalidateRolePermissionsCached(tier) {
  const t = tier != null ? String(tier).trim().toLowerCase() : '';
  if (t) {
    delete _rolePermsCache[t];
    delete _rolePermsCacheExpiry[t];
  }
}

async function getRolePermissions(tier) {
  const t = rbac.validateTier(tier);
  if (!t) return rbac.getDefaultPermissionsForTier();
  const cached = getRolePermissionsCached(t);
  if (cached != null) return cached;
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
    setRolePermissionsCached(t, out);
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
    invalidateRolePermissionsCached(t);
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
