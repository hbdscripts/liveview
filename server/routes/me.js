/**
 * GET /api/me
 *
 * Returns the viewer identity for UI gating.
 * - email-based sessions: { email, status, role, tier, isMaster }
 * - shop-only sessions (Shopify login): { email: null, isMaster: false, ... }
 */
const dashboardAuth = require('../middleware/dashboardAuth');
const users = require('../usersService');

const OAUTH_COOKIE_NAME = 'oauth_session';

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

async function me(req, res) {
  const cookieValue = getCookie(req, OAUTH_COOKIE_NAME);
  if (!cookieValue || !dashboardAuth.verifyOauthSession(cookieValue)) {
    res.json({ email: null, initial: 'K', status: null, role: null, tier: null, isMaster: false });
    return;
  }

  const raw = parseOauthCookie(cookieValue) || {};
  const email = users.normalizeEmail(raw.email);

  let user = null;
  if (email) {
    // Ensure the initial seed master exists and remains master.
    if (users.isBootstrapMasterEmail(email)) {
      user = await users.ensureBootstrapMaster(email);
    } else {
      user = await users.getUserByEmail(email);
    }
  }

  const status = user && user.status != null ? String(user.status) : null;
  const role = user && user.role != null ? String(user.role) : null;
  const tier = user && user.tier != null ? String(user.tier) : null;
  const isMaster = (role === 'master') || users.isBootstrapMasterEmail(email);

  res.json({
    email: email || null,
    initial: email ? email[0].toUpperCase() : 'K',
    status,
    role,
    tier,
    isMaster,
  });
}

module.exports = me;

