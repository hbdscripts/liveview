/**
 * Shared authorization helpers.
 *
 * IMPORTANT: This app supports both Shopify-embedded access (dashboardAuth) and direct visits
 * via OAuth cookie. "Admin" checks should ONLY rely on the OAuth cookie + users table so
 * customers in Shopify admin do not get elevated access by default.
 */
const dashboardAuth = require('./middleware/dashboardAuth');
const users = require('./usersService');

function getCookie(req, name) {
  const raw = (req && (req.get('Cookie') || req.get('cookie'))) || '';
  const parts = String(raw).split(';').map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim().replace(/^\"(.*)\"$/, '$1'));
    }
  }
  return undefined;
}

function parseOauthCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

async function isMasterRequest(req) {
  const cookieValue = getCookie(req, dashboardAuth.OAUTH_COOKIE_NAME);
  if (!cookieValue || !dashboardAuth.verifyOauthSession(cookieValue)) return false;

  const raw = parseOauthCookie(cookieValue) || {};
  const email = users.normalizeEmail(raw.email);
  if (!email) return false;

  if (users.isBootstrapMasterEmail(email)) {
    try { await users.ensureBootstrapMaster(email); } catch (_) {}
    return true;
  }

  const row = await users.getUserByEmail(email);
  const role = row && row.role != null ? String(row.role).trim().toLowerCase() : '';
  const status = row && row.status != null ? String(row.status).trim().toLowerCase() : '';
  return (role === 'admin' || role === 'master') && status === 'active';
}

function getRequestEmail(req) {
  const cookieValue = getCookie(req, dashboardAuth.OAUTH_COOKIE_NAME);
  if (!cookieValue || !dashboardAuth.verifyOauthSession(cookieValue)) return null;
  const raw = parseOauthCookie(cookieValue) || {};
  return users.normalizeEmail(raw.email) || null;
}

module.exports = {
  isMasterRequest,
  getRequestEmail,
};

