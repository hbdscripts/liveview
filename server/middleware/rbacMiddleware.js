/**
 * RBAC middleware: enforce tier permissions on protected pages and APIs.
 * Runs after dashboardAuth; only applies when request has required permission(s).
 * Admin (role === 'admin') always allowed.
 */
const dashboardAuth = require('./dashboardAuth');
const users = require('../usersService');
const rolePermissionsService = require('../rolePermissionsService');
const userPermissionOverrides = require('../userPermissionOverridesService');
const rbac = require('../rbac');

function getCookie(req, name) {
  const raw = (req.get && (req.get('Cookie') || req.get('cookie'))) || '';
  const parts = String(raw).split(';').map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1'));
    }
  }
  return undefined;
}

async function middleware(req, res, next) {
  try {
    const pathname = (req && req.path) ? String(req.path) : '';
    const method = (req && req.method) ? String(req.method) : '';
    if (!dashboardAuth.requiresAuth(pathname, method)) return next();

    const required = rbac.getRequiredPermissionsForRequest(req);
    const anyLen = required && Array.isArray(required.any) ? required.any.length : 0;
    const allLen = required && Array.isArray(required.all) ? required.all.length : 0;
    if (anyLen === 0 && allLen === 0) return next();

    const oauthCookie = getCookie(req, dashboardAuth.OAUTH_COOKIE_NAME);
    const session = oauthCookie ? dashboardAuth.readOauthSession(oauthCookie) : null;
    if (!session || !session.email) return next(); // already blocked by dashboardAuth for protected paths

    const email = users.normalizeEmail(session.email);
    if (!email) return next();

    let user = null;
    if (users.isBootstrapMasterEmail(email)) {
      try {
        user = await users.ensureBootstrapMaster(email);
      } catch (_) {}
    } else {
      user = await users.getUserByEmail(email);
    }
    if (!user || (user.status || '').toString().trim().toLowerCase() !== 'active') return next();

    if (rbac.isAdminViewer(user)) return next();

    const tier = rbac.normalizeUserTierForRbac(user.tier);
    let tierPerms;
    try {
      tierPerms = await rolePermissionsService.getRolePermissions(tier);
    } catch (_) {
      tierPerms = rbac.getDefaultPermissionsForTier();
    }
    let overrides = {};
    try {
      overrides = await userPermissionOverrides.getOverrides(user.id);
    } catch (_) {}
    const effectivePerms = userPermissionOverrides.getEffectivePermissions(tierPerms, overrides);
    if (rbac.isAllowed(user, required, effectivePerms)) return next();

    const isApi = pathname.startsWith('/api/');
    if (isApi) {
      res.status(403).json({ error: 'Forbidden', reason: 'insufficient_permission' });
      return;
    }
    const redirectTarget = String(req.originalUrl || req.path || '/dashboard/overview');
    res.redirect(302, '/app/logout?redirect=' + encodeURIComponent(redirectTarget) + '&error=insufficient_permission');
  } catch (err) {
    next(err);
  }
}

module.exports = { middleware };
