/**
 * Per-user permission overrides. Only stored keys are overrides; missing key = inherit from role.
 */
const { getDb, isPostgres } = require('./db');
const rbac = require('./rbac');

async function getOverrides(userId) {
  if (userId == null || !Number.isFinite(Number(userId))) return {};
  const db = getDb();
  try {
    const row = await db.get('SELECT permissions_json FROM user_permission_overrides WHERE user_id = ?', [Number(userId)]);
    if (!row || !row.permissions_json) return {};
    const parsed = JSON.parse(row.permissions_json);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const key of Object.keys(parsed)) {
      const k = rbac.validatePermissionKey(key);
      if (k && (parsed[key] === true || parsed[key] === false)) out[k] = parsed[key] === true;
    }
    return out;
  } catch (_) {
    return {};
  }
}

/**
 * Persist overrides. Only canonical keys with true/false are stored; unknown keys ignored.
 */
async function putOverrides(userId, overrides) {
  if (userId == null || !Number.isFinite(Number(userId))) return { ok: false, error: 'invalid_user_id' };
  if (!overrides || typeof overrides !== 'object') return { ok: true, overrides: {} };
  const filtered = {};
  for (const key of Object.keys(overrides)) {
    const k = rbac.validatePermissionKey(key);
    if (k && (overrides[key] === true || overrides[key] === false)) filtered[k] = overrides[key] === true;
  }
  const db = getDb();
  const now = Date.now();
  const json = JSON.stringify(filtered);
  try {
    if (isPostgres()) {
      await db.run(
        'INSERT INTO user_permission_overrides (user_id, permissions_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET permissions_json = ?, updated_at = ?',
        [Number(userId), json, now, json, now]
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO user_permission_overrides (user_id, permissions_json, updated_at) VALUES (?, ?, ?)',
        [Number(userId), json, now]
      );
    }
    return { ok: true, overrides: filtered };
  } catch (err) {
    return { ok: false, error: 'db_error' };
  }
}

/**
 * Merge tier defaults with user overrides. tierPerms = base; overrides override specific keys.
 * Returns effective permission map (all keys from rbac.ALL_PERMISSION_KEYS).
 */
function getEffectivePermissions(tierPerms, overrides) {
  const base = tierPerms && typeof tierPerms === 'object' ? { ...tierPerms } : rbac.getDefaultPermissionsForTier();
  const keys = rbac.ALL_PERMISSION_KEYS;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) base[key] = true;
  }
  if (overrides && typeof overrides === 'object') {
    for (const key of Object.keys(overrides)) {
      if (rbac.validatePermissionKey(key) && (overrides[key] === true || overrides[key] === false)) {
        base[key] = overrides[key] === true;
      }
    }
  }
  return base;
}

module.exports = {
  getOverrides,
  putOverrides,
  getEffectivePermissions,
};
