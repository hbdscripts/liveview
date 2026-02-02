/**
 * OAuth login for dashboard: Google and "Login with Shopify" (store domain).
 * Sets oauth_session cookie on success; middleware allows access when that cookie is valid.
 */

const crypto = require('crypto');
const config = require('../config');
const { signOauthSession, OAUTH_COOKIE_NAME } = require('../middleware/dashboardAuth');
const auth = require('./auth');

const SESSION_HOURS = 24;
const appUrl = (config.shopify.appUrl || '').replace(/\/$/, '');
const apiKey = config.shopify.apiKey;
const apiSecret = config.shopify.apiSecret;
const scopes = config.shopify.scopes || 'read_products,read_orders';

function setOauthCookie(res, value) {
  const maxAge = SESSION_HOURS * 60 * 60;
  let set = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=lax; HttpOnly`;
  if (process.env.NODE_ENV === 'production') set += '; Secure';
  res.setHeader('Set-Cookie', set);
}

function clearOauthCookie(res) {
  res.setHeader('Set-Cookie', `${OAUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=lax; HttpOnly`);
}

function stateEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function stateDecode(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

// ---- Google OAuth ----

function handleGoogleRedirect(req, res) {
  const redirect = (req.query && req.query.redirect) || '/app/live-visitors';
  if (!config.googleClientId || !config.googleClientSecret) {
    return res.redirect(302, '/app/login?error=google_not_configured');
  }
  const state = stateEncode({ rnd: crypto.randomBytes(16).toString('hex'), r: redirect });
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${appUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

async function handleGoogleCallback(req, res) {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(302, '/app/login?error=google_denied');
  }
  const decoded = stateDecode(state || '');
  const redirect = (decoded && decoded.r) || '/app/live-visitors';
  if (!code || !decoded || !decoded.rnd) {
    return res.redirect(302, '/app/login?error=invalid_state');
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: `${appUrl}/auth/google/callback`,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[oauth] Google token error:', tokenRes.status, errText);
    return res.redirect(302, '/app/login?error=google_token');
  }
  const tokens = await tokenRes.json();
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return res.redirect(302, '/app/login?error=google_user');
  }
  const user = await userRes.json();
  const email = (user.email || '').trim().toLowerCase();
  const allowed = config.allowedGoogleEmails.length === 0 || config.allowedGoogleEmails.includes(email);
  if (!allowed) {
    console.warn('[oauth] Google email not allowed:', email);
    return res.redirect(302, '/app/login?error=email_not_allowed');
  }
  const token = signOauthSession({ email });
  if (!token) {
    return res.redirect(302, '/app/login?error=session');
  }
  setOauthCookie(res, token);
  res.redirect(302, redirect);
}

// ---- Login with Shopify (store domain) ----

function handleShopifyLoginRedirect(req, res) {
  let shop = (req.query && req.query.shop) || '';
  shop = shop.trim().toLowerCase();
  if (!shop.endsWith('.myshopify.com')) shop = shop ? `${shop}.myshopify.com` : '';
  if (!shop) {
    return res.redirect(302, '/app/login?error=shop_required');
  }
  if (!apiKey || !apiSecret || !appUrl) {
    return res.redirect(302, '/app/login?error=app_not_configured');
  }
  const redirect = (req.query && req.query.redirect) || '/app/live-visitors';
  const state = stateEncode({ rnd: crypto.randomBytes(16).toString('hex'), r: redirect });
  const redirectUri = `${appUrl}/auth/shopify-login/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(apiKey)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  res.redirect(302, authUrl);
}

async function handleShopifyLoginCallback(req, res) {
  const { code, shop, state, hmac, timestamp } = req.query;
  const decoded = stateDecode(state || '');
  const redirect = (decoded && decoded.r) || '/app/live-visitors';
  if (!code || !shop || !decoded || !decoded.rnd) {
    return res.redirect(302, '/app/login?error=invalid_state');
  }
  if (!auth.verifyHmac || !auth.verifyHmac(req.query)) {
    return res.redirect(302, '/app/login?error=invalid_hmac');
  }
  const shopNorm = shop.trim().toLowerCase();
  const allowed = config.allowedShopDomain && shopNorm === config.allowedShopDomain;
  if (!allowed) {
    console.warn('[oauth] Shopify shop not allowed:', shopNorm, 'allowed:', config.allowedShopDomain);
    return res.redirect(302, '/app/login?error=shop_not_allowed');
  }
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: apiKey,
      client_secret: apiSecret,
      code,
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[oauth] Shopify token error:', tokenRes.status, errText);
    return res.redirect(302, '/app/login?error=shopify_token');
  }
  const token = signOauthSession({ shop: shopNorm });
  if (!token) {
    return res.redirect(302, '/app/login?error=session');
  }
  setOauthCookie(res, token);
  res.redirect(302, redirect);
}

module.exports = {
  handleGoogleRedirect,
  handleGoogleCallback,
  handleShopifyLoginRedirect,
  handleShopifyLoginCallback,
  clearOauthCookie,
};
