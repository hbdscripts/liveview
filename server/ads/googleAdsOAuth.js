const crypto = require('crypto');
const config = require('../config');
const { getGoogleAdsConfig, setGoogleAdsConfig } = require('./adsStore');

const appUrl = (config.shopify && config.shopify.appUrl ? String(config.shopify.appUrl) : '').replace(/\/$/, '');

function stateEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function stateDecode(str) {
  try {
    return JSON.parse(Buffer.from(String(str || ''), 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function isSafeRelativeRedirectPath(p) {
  if (!p || typeof p !== 'string') return false;
  if (!p.startsWith('/')) return false;
  if (p.startsWith('//')) return false;
  if (p.includes('://')) return false;
  return true;
}

function ensureGoogleOAuthConfigured() {
  const ok = !!(config.googleClientId && config.googleClientSecret);
  return ok ? null : 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET not set';
}

function getRedirectUri() {
  if (!appUrl || !appUrl.startsWith('http')) return null;
  return `${appUrl}/api/ads/google/callback`;
}

function buildGoogleAdsConnectUrl(options = {}) {
  const err = ensureGoogleOAuthConfigured();
  if (err) return { ok: false, error: err };

  const redirectUri = getRedirectUri();
  if (!redirectUri) return { ok: false, error: 'SHOPIFY_APP_URL not set (needed to build redirect URI)' };

  const redirect = (options && options.redirect && isSafeRelativeRedirectPath(options.redirect))
    ? options.redirect
    : '/app/dashboard';

  const state = stateEncode({
    rnd: crypto.randomBytes(16).toString('hex'),
    r: redirect,
  });

  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return { ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

async function exchangeCodeForTokens(code) {
  const redirectUri = getRedirectUri();
  if (!redirectUri) throw new Error('Missing redirectUri');

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error('Google token exchange failed: ' + tokenRes.status + ' ' + errText);
  }

  return tokenRes.json();
}

async function handleGoogleAdsCallback(query = {}) {
  const { code, state, error } = query || {};
  if (error) return { ok: false, error: 'google_denied' };

  const decoded = stateDecode(state || '');
  const redirect = (decoded && decoded.r && isSafeRelativeRedirectPath(decoded.r)) ? decoded.r : '/app/dashboard';

  if (!code || !decoded || !decoded.rnd) return { ok: false, error: 'invalid_state', redirect };

  const tokens = await exchangeCodeForTokens(String(code));

  const refreshToken = tokens && tokens.refresh_token ? String(tokens.refresh_token) : '';
  if (!refreshToken) {
    return { ok: false, error: 'missing_refresh_token', redirect };
  }

  const existing = await getGoogleAdsConfig();
  const next = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    refresh_token: refreshToken,
    scope: tokens && tokens.scope ? String(tokens.scope) : 'https://www.googleapis.com/auth/adwords',
    token_type: tokens && tokens.token_type ? String(tokens.token_type) : 'Bearer',
    obtained_at: Date.now(),
  };

  await setGoogleAdsConfig(next);

  return { ok: true, redirect };
}

module.exports = {
  buildGoogleAdsConnectUrl,
  handleGoogleAdsCallback,
  getRedirectUri,
};
