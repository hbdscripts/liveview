/**
 * Users service (DB-backed).
 *
 * Purpose:
 * - Power local signup + approvals workflow (pending/active/denied).
 * - Provide roles (user/master) + future tiers (free/pro/...) for feature gating.
 *
 * NOTE: This is intentionally lightweight and uses epoch ms timestamps.
 */
const { getDb } = require('./db');

const BOOTSTRAP_MASTER_EMAIL = 'smlsites@gmail.com';

function normalizeEmail(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  // Very small validation: enough to prevent junk keys in DB.
  if (!s || s.length > 254) return '';
  if (!s.includes('@') || s.startsWith('@') || s.endsWith('@')) return '';
  return s;
}

function normalizeUserStatus(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'pending' || s === 'active' || s === 'denied') return s;
  return '';
}

function normalizeUserRole(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'master' || s === 'user') return s;
  return '';
}

function normalizeUserTier(raw) {
  // Future tiers are coming; keep this permissive but bounded.
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!s) return 'free';
  if (s.length > 32) return 'free';
  if (!/^[a-z0-9_-]+$/.test(s)) return 'free';
  return s;
}

function isBootstrapMasterEmail(email) {
  const e = normalizeEmail(email);
  return !!(e && e === BOOTSTRAP_MASTER_EMAIL);
}

async function getUserByEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const db = getDb();
  try {
    return await db.get('SELECT * FROM users WHERE email = ? LIMIT 1', [e]);
  } catch (_) {
    // Table may not exist yet during early boot; fail-open.
    return null;
  }
}

async function getUserById(id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  const db = getDb();
  try {
    return await db.get('SELECT * FROM users WHERE id = ? LIMIT 1', [Math.trunc(n)]);
  } catch (_) {
    return null;
  }
}

async function ensureBootstrapMaster(email, { now = Date.now() } = {}) {
  const e = normalizeEmail(email);
  if (!e || !isBootstrapMasterEmail(e)) return null;
  const db = getDb();
  try {
    const existing = await db.get('SELECT * FROM users WHERE email = ? LIMIT 1', [e]);
    if (existing && existing.id != null) {
      // Ensure role/status are strong enough; do not downgrade tier.
      const nextTier = existing.tier ? normalizeUserTier(existing.tier) : 'free';
      await db.run(
        'UPDATE users SET status = ?, role = ?, tier = ?, approved_at = COALESCE(approved_at, ?) WHERE email = ?',
        ['active', 'master', nextTier, now, e]
      );
      return await db.get('SELECT * FROM users WHERE email = ? LIMIT 1', [e]);
    }
    await db.run(
      'INSERT INTO users (email, password_hash, status, role, tier, created_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [e, null, 'active', 'master', 'free', now, now]
    );
    return await db.get('SELECT * FROM users WHERE email = ? LIMIT 1', [e]);
  } catch (_) {
    return null;
  }
}

async function createPendingUser(email, passwordHash, meta = {}, { now = Date.now() } = {}) {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, error: 'invalid_email' };
  const db = getDb();
  try {
    const existing = await db.get('SELECT id, status, role FROM users WHERE email = ? LIMIT 1', [e]);
    if (existing && existing.id != null) {
      return { ok: false, error: 'already_exists' };
    }
    const ph = passwordHash != null ? String(passwordHash) : null;
    const lastCountry = meta.last_country != null ? String(meta.last_country).trim().toUpperCase().slice(0, 2) : null;
    const lastCity = meta.last_city != null ? String(meta.last_city).trim().slice(0, 96) : null;
    const lastDeviceType = meta.last_device_type != null ? String(meta.last_device_type).trim().toLowerCase().slice(0, 24) : null;
    const lastPlatform = meta.last_platform != null ? String(meta.last_platform).trim().toLowerCase().slice(0, 24) : null;
    const lastUserAgent = meta.last_user_agent != null ? String(meta.last_user_agent).trim().slice(0, 320) : null;
    const lastIp = meta.last_ip != null ? String(meta.last_ip).trim().slice(0, 64) : null;
    await db.run(
      `
        INSERT INTO users (
          email, password_hash, status, role, tier,
          created_at,
          last_country, last_city, last_device_type, last_platform, last_user_agent, last_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [e, ph, 'pending', 'user', 'free', now, lastCountry, lastCity, lastDeviceType, lastPlatform, lastUserAgent, lastIp]
    );
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'db_error' };
  }
}

async function listUsers({ status } = {}) {
  const st = normalizeUserStatus(status);
  const db = getDb();
  try {
    if (st) {
      return await db.all(
        `SELECT id, email, status, role, tier, created_at, last_login_at, last_country, last_city, last_device_type, last_platform
         FROM users
         WHERE status = ?
         ORDER BY COALESCE(last_login_at, created_at) DESC, id DESC`,
        [st]
      );
    }
    return await db.all(
      `SELECT id, email, status, role, tier, created_at, last_login_at, last_country, last_city, last_device_type, last_platform
       FROM users
       ORDER BY COALESCE(last_login_at, created_at) DESC, id DESC`,
      []
    );
  } catch (_) {
    return [];
  }
}

async function approveUser(id, actorEmail, { now = Date.now() } = {}) {
  const actor = normalizeEmail(actorEmail);
  const db = getDb();
  const u = await getUserById(id);
  if (!u) return { ok: false, error: 'not_found' };
  try {
    const nextRole = normalizeUserRole(u.role) || 'user';
    const nextTier = normalizeUserTier(u.tier);
    await db.run(
      'UPDATE users SET status = ?, role = ?, tier = ?, approved_at = ?, denied_at = NULL WHERE id = ?',
      ['active', nextRole, nextTier, now, u.id]
    );
    // Actor is kept for future audit trails (not stored yet).
    void actor;
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'db_error' };
  }
}

async function denyUser(id, actorEmail, { now = Date.now() } = {}) {
  const actor = normalizeEmail(actorEmail);
  const db = getDb();
  const u = await getUserById(id);
  if (!u) return { ok: false, error: 'not_found' };
  try {
    await db.run(
      'UPDATE users SET status = ?, denied_at = ?, approved_at = COALESCE(approved_at, NULL) WHERE id = ?',
      ['denied', now, u.id]
    );
    void actor;
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'db_error' };
  }
}

async function promoteToMaster(id, actorEmail, { now = Date.now() } = {}) {
  const actor = normalizeEmail(actorEmail);
  const db = getDb();
  const u = await getUserById(id);
  if (!u) return { ok: false, error: 'not_found' };
  try {
    const nextTier = normalizeUserTier(u.tier);
    await db.run(
      'UPDATE users SET role = ?, status = ?, tier = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?',
      ['master', 'active', nextTier, now, u.id]
    );
    void actor;
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'db_error' };
  }
}

async function updateLoginMeta(email, meta = {}, { now = Date.now() } = {}) {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, error: 'invalid_email' };
  const db = getDb();
  try {
    const lastCountry = meta.last_country != null ? String(meta.last_country).trim().toUpperCase().slice(0, 2) : null;
    const lastCity = meta.last_city != null ? String(meta.last_city).trim().slice(0, 96) : null;
    const lastDeviceType = meta.last_device_type != null ? String(meta.last_device_type).trim().toLowerCase().slice(0, 24) : null;
    const lastPlatform = meta.last_platform != null ? String(meta.last_platform).trim().toLowerCase().slice(0, 24) : null;
    const lastUserAgent = meta.last_user_agent != null ? String(meta.last_user_agent).trim().slice(0, 320) : null;
    const lastIp = meta.last_ip != null ? String(meta.last_ip).trim().slice(0, 64) : null;
    await db.run(
      `
        UPDATE users SET
          last_login_at = ?,
          last_country = COALESCE(?, last_country),
          last_city = COALESCE(?, last_city),
          last_device_type = COALESCE(?, last_device_type),
          last_platform = COALESCE(?, last_platform),
          last_user_agent = COALESCE(?, last_user_agent),
          last_ip = COALESCE(?, last_ip)
        WHERE email = ?
      `,
      [now, lastCountry, lastCity, lastDeviceType, lastPlatform, lastUserAgent, lastIp, e]
    );
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'db_error' };
  }
}

module.exports = {
  BOOTSTRAP_MASTER_EMAIL,
  normalizeEmail,
  isBootstrapMasterEmail,
  getUserByEmail,
  getUserById,
  ensureBootstrapMaster,
  createPendingUser,
  listUsers,
  approveUser,
  denyUser,
  promoteToMaster,
  updateLoginMeta,
};

