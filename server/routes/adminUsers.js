/**
 * Admin API: Users approvals + role promotion + role permissions.
 *
 * Protected by requireMaster middleware at mount time.
 */
const express = require('express');
const users = require('../usersService');
const rolePermissionsService = require('../rolePermissionsService');
const userPermissionOverrides = require('../userPermissionOverridesService');
const rbac = require('../rbac');
const { getDb } = require('../db');

const router = express.Router();

function normalizeStatus(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'pending' || s === 'active' || s === 'denied') return s;
  return '';
}

function coerceEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

async function listShopifyAuthRows(limit = 20) {
  const db = getDb();
  try {
    const rows = await db.all(
      `
        SELECT shop, updated_at, last_oauth_email, last_oauth_at
        FROM shop_sessions
        WHERE shop IS NOT NULL AND TRIM(shop) <> ''
        ORDER BY COALESCE(last_oauth_at, updated_at) DESC
        LIMIT ?
      `,
      [Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    return (rows || []).map((row) => {
      const shop = row && row.shop ? String(row.shop).trim().toLowerCase() : '';
      const at = coerceEpochMs(row && (row.last_oauth_at != null ? row.last_oauth_at : row.updated_at));
      const oauthEmail = row && row.last_oauth_email ? String(row.last_oauth_email).trim() : '';
      const emailLabel = shop ? `Shopify (${shop})` : 'Shopify';
      const email = oauthEmail ? emailLabel + ' — ' + oauthEmail : emailLabel;
      return {
        id: `shop:${shop || 'unknown'}`,
        email,
        status: 'active',
        role: 'shopify',
        tier: 'n/a',
        created_at: at,
        last_login_at: at,
        last_country: null,
        last_city: null,
        last_device_type: 'shopify',
        last_platform: 'oauth',
        auth_provider: 'shopify',
        shop: shop || null,
      };
    });
  } catch (_) {
    // Table can be missing in early boot/tests; fail-open with no shop sessions.
    return [];
  }
}

function sortRowsByLastSeenDesc(rows) {
  return (rows || []).slice().sort((a, b) => {
    const aSeen = coerceEpochMs(a && (a.last_login_at || a.created_at));
    const bSeen = coerceEpochMs(b && (b.last_login_at || b.created_at));
    if (aSeen !== bSeen) return bSeen - aSeen;
    const aId = a && a.id != null ? String(a.id) : '';
    const bId = b && b.id != null ? String(b.id) : '';
    return bId.localeCompare(aId);
  });
}

router.get('/users', async (req, res) => {
  const status = normalizeStatus(req.query && req.query.status);
  let rows = await users.listUsers({ status: status || undefined });
  if (!status || status === 'active') {
    const shopRows = await listShopifyAuthRows(20);
    rows = sortRowsByLastSeenDesc([...(rows || []), ...shopRows]);
  }
  res.json({ ok: true, users: rows || [] });
});

router.post('/users/:id/approve', async (req, res) => {
  const id = req.params && req.params.id;
  const tier = req.body && req.body.tier != null ? req.body.tier : undefined;
  const r = await users.approveUser(id, null, { tier, now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'approve_failed' });
  res.json({ ok: true });
});

router.patch('/users/:id', async (req, res) => {
  const id = req.params && req.params.id;
  const tier = req.body && req.body.tier != null ? req.body.tier : undefined;
  if (tier == null || String(tier).trim() === '') return res.status(400).json({ ok: false, error: 'tier_required' });
  const r = await users.updateUserTier(id, tier, null, { now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'update_failed' });
  res.json({ ok: true });
});

router.post('/users/:id/deny', async (req, res) => {
  const id = req.params && req.params.id;
  const r = await users.denyUser(id, null, { now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'deny_failed' });
  res.json({ ok: true });
});

async function promoteAdmin(req, res) {
  const id = req.params && req.params.id;
  const r = await users.promoteToAdmin(id, null, { now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'promote_failed' });
  res.json({ ok: true });
}

router.post('/users/:id/promote-admin', promoteAdmin);
// Backwards-compatible alias
router.post('/users/:id/promote-master', promoteAdmin);

router.get('/role-permissions', async (req, res) => {
  try {
    const all = await rolePermissionsService.getAllRolePermissions();
    res.json({ ok: true, permissions: all });
  } catch (_) {
    res.status(500).json({ ok: false, error: 'load_failed' });
  }
});

router.put('/role-permissions/:tier', async (req, res) => {
  const tier = (req.params && req.params.tier) ? String(req.params.tier).trim().toLowerCase() : '';
  if (!rbac.validateTier(tier)) return res.status(400).json({ ok: false, error: 'invalid_tier' });
  const permissions = req.body && req.body.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : null;
  if (!permissions) return res.status(400).json({ ok: false, error: 'permissions_required' });
  const r = await rolePermissionsService.putRolePermissions(tier, permissions);
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'save_failed' });
  res.json({ ok: true, permissions: r.permissions });
});

function parseUserId(id) {
  if (id == null || String(id).startsWith('shop:')) return null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

router.get('/users/:id/permissions', async (req, res) => {
  const userId = parseUserId(req.params && req.params.id);
  if (userId == null) return res.status(404).json({ ok: false, error: 'user_not_found' });
  const user = await users.getUserById(userId);
  if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
  const tier = rbac.normalizeUserTierForRbac(user.tier);
  let tierPerms;
  try {
    tierPerms = await rolePermissionsService.getRolePermissions(tier);
  } catch (_) {
    tierPerms = rbac.getDefaultPermissionsForTier();
  }
  let overrides = {};
  try {
    overrides = await userPermissionOverrides.getOverrides(userId);
  } catch (_) {}
  const effectivePermissions = userPermissionOverrides.getEffectivePermissions(tierPerms, overrides);
  res.json({
    ok: true,
    user: { id: user.id, email: user.email, tier: user.tier, role: user.role },
    overrides,
    effectivePermissions,
  });
});

router.put('/users/:id/permissions', async (req, res) => {
  const userId = parseUserId(req.params && req.params.id);
  if (userId == null) return res.status(404).json({ ok: false, error: 'user_not_found' });
  const user = await users.getUserById(userId);
  if (!user) return res.status(404).json({ ok: false, error: 'user_not_found' });
  const overrides = req.body && typeof req.body.overrides === 'object' ? req.body.overrides : {};
  const r = await userPermissionOverrides.putOverrides(userId, overrides);
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'save_failed' });
  res.json({ ok: true, overrides: r.overrides });
});

module.exports = router;

