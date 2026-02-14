/**
 * Master-only gate for Admin pages and APIs.
 *
 * Master accounts are stored in `users.role = 'master'` (plus a bootstrap seed master).
 */
const dashboardAuth = require('./dashboardAuth');
const users = require('../usersService');

function getCookie(req, name) {
  const raw = req.get('Cookie') || req.get('cookie') || '';
  const parts = raw.split(';').map(s => s.trim());
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

function isApi(req) {
  return !!(req && typeof req.path === 'string' && req.path.startsWith('/api/'));
}

async function middleware(req, res, next) {
  const cookieValue = getCookie(req, dashboardAuth.OAUTH_COOKIE_NAME);
  if (!cookieValue || !dashboardAuth.verifyOauthSession(cookieValue)) {
    if (isApi(req)) return res.status(403).json({ error: 'Forbidden' });
    return res.redirect(302, '/app/login?error=session_expired&redirect=' + encodeURIComponent(String(req.originalUrl || '/dashboard/overview')));
  }

  const raw = parseOauthCookie(cookieValue) || {};
  const email = users.normalizeEmail(raw.email);
  if (!email) {
    if (isApi(req)) return res.status(403).json({ error: 'Forbidden' });
    return res.redirect(302, '/dashboard/overview');
  }

  if (users.isBootstrapMasterEmail(email)) {
    try { await users.ensureBootstrapMaster(email); } catch (_) {}
    return next();
  }

  const row = await users.getUserByEmail(email);
  const role = row && row.role != null ? String(row.role).trim().toLowerCase() : '';
  const status = row && row.status != null ? String(row.status).trim().toLowerCase() : '';
  if (role === 'master' && status === 'active') return next();

  if (isApi(req)) return res.status(403).json({ error: 'Forbidden' });
  return res.redirect(302, '/dashboard/overview');
}

module.exports = { middleware };

