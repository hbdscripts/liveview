/**
 * Dashboard login: GET /app/login (splash with Google/Shopify/secret), POST /app/login (secret), GET /app/logout.
 */

const config = require('../config');
const { signSession, COOKIE_NAME, SESSION_HOURS } = require('../middleware/dashboardAuth');
const oauthLogin = require('./oauthLogin');
const crypto = require('crypto');

function timingSafeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch (_) {
    return false;
  }
}

const ERROR_MESSAGES = {
  google_not_configured: 'Google sign-in is not configured.',
  google_denied: 'Google sign-in was cancelled.',
  google_token: 'Google sign-in failed. Try again.',
  google_user: 'Could not load Google profile.',
  email_not_allowed: 'Your email is not allowed to sign in.',
  shop_required: 'Enter your store domain.',
  shop_not_allowed: 'This store is not allowed to sign in.',
  shopify_token: 'Shopify sign-in failed. Try again.',
  invalid_state: 'Invalid request. Try again.',
  invalid_hmac: 'Invalid Shopify request.',
  app_not_configured: 'App is not configured for Shopify login.',
  session: 'Session error. Try again.',
};

function getLoginHtml(queryError, secretError) {
  const errFromQuery = queryError && ERROR_MESSAGES[queryError] ? ERROR_MESSAGES[queryError] : '';
  const errSecret = secretError ? 'Invalid secret. Try again.' : '';
  const errMsg = errFromQuery || errSecret ? `<p class="error">${errFromQuery || errSecret}</p>` : '';

  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const hasShopify = !!(config.shopify.apiKey && config.shopify.apiSecret && config.shopify.appUrl && config.allowedShopDomain);
  const hasSecret = !!(config.dashboardSecret && config.dashboardSecret.trim() !== '');

  let buttons = '';
  if (hasGoogle) {
    buttons += `<a href="/auth/google" class="btn btn-google">Sign in with Google</a>`;
  }
  if (hasShopify) {
    const shopParam = encodeURIComponent(config.allowedShopDomain);
    buttons += `<a href="/auth/shopify-login?shop=${shopParam}" class="btn btn-shopify">Sign in with Shopify</a>`;
  }
  if (hasSecret) {
    buttons += `
    <div class="divider">or use dashboard secret</div>
    <form method="post" action="/app/login">
      <label for="secret">Dashboard secret</label>
      <input type="password" id="secret" name="secret" autocomplete="current-password" required ${!hasGoogle && !hasShopify ? 'autofocus' : ''}>
      <button type="submit" class="btn btn-secret">Sign in with secret</button>
    </form>`;
  }

  if (!buttons) {
    buttons = '<p class="muted">No login method configured. Set GOOGLE_CLIENT_ID/SECRET, ALLOWED_SHOP_DOMAIN, or DASHBOARD_SECRET.</p>';
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Live Visitors – Sign in</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f6f6f7; }
    .card { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); width: 100%; max-width: 400px; }
    h1 { margin: 0 0 0.5rem; font-size: 1.35rem; font-weight: 600; color: #202223; }
    .subtitle { color: #6d7175; font-size: 0.875rem; margin: 0 0 1.25rem; }
    .btn { display: block; width: 100%; padding: 0.6rem 1rem; font-size: 0.95rem; font-weight: 500; border-radius: 6px; border: none; cursor: pointer; text-align: center; text-decoration: none; margin-bottom: 0.75rem; }
    .btn-google { background: #fff; color: #202223; border: 1px solid #c9cccf; }
    .btn-google:hover { background: #f9fafb; border-color: #8c9196; }
    .btn-shopify { background: #008060; color: #fff; }
    .btn-shopify:hover { background: #006e52; }
    .btn-secret { background: #2c6ecb; color: #fff; }
    .btn-secret:hover { background: #1f5199; }
    .shopify-form { margin-bottom: 0.75rem; }
    .shopify-form input { width: 100%; padding: 0.5rem 0.75rem; font-size: 0.95rem; border: 1px solid #c9cccf; border-radius: 6px; margin-bottom: 0.5rem; }
    .shopify-form input:focus { outline: none; border-color: #008060; }
    .divider { font-size: 0.8rem; color: #8c9196; margin: 1rem 0 0.75rem; text-align: center; }
    label { display: block; margin-bottom: 0.25rem; font-size: 0.875rem; color: #6d7175; }
    input[type="password"] { width: 100%; padding: 0.5rem 0.75rem; font-size: 1rem; border: 1px solid #c9cccf; border-radius: 6px; margin-bottom: 0.75rem; }
    input:focus { outline: none; border-color: #2c6ecb; }
    .error { color: #d72c0d; font-size: 0.875rem; margin-bottom: 1rem; }
    .muted { color: #6d7175; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Live Visitors</h1>
    <p class="subtitle">Sign in to view your dashboard.</p>
    ${errMsg}
    ${buttons}
  </div>
</body>
</html>`;
}

function getCookieOptions() {
  const maxAge = SESSION_HOURS * 60 * 60;
  const opts = {
    httpOnly: true,
    sameSite: 'lax',
    maxAge,
    path: '/',
  };
  if (process.env.NODE_ENV === 'production') opts.secure = true;
  return opts;
}

function setCookie(res, value) {
  const opts = getCookieOptions();
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}; Path=${opts.path}; Max-Age=${opts.maxAge}; SameSite=${opts.sameSite}; HttpOnly`];
  if (opts.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=lax; HttpOnly`);
}

function isProtected() {
  const prefix = (config.allowedAdminRefererPrefix || '').trim();
  const secret = (config.dashboardSecret || '').trim();
  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const hasShopify = !!(config.allowedShopDomain && config.shopify.apiKey);
  return prefix !== '' || secret !== '' || hasGoogle || hasShopify;
}

function handleGetLogin(req, res) {
  if (!isProtected()) {
    return res.redirect(302, '/app/live-visitors');
  }
  const queryError = (req.query && req.query.error) || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getLoginHtml(queryError, false));
}

function handlePostLogin(req, res) {
  const secret = (req.body && req.body.secret) || '';
  const expected = config.dashboardSecret || '';
  if (!expected.trim()) {
    return res.redirect(302, '/app/live-visitors');
  }
  if (!timingSafeEqual(secret, expected)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(getLoginHtml('', true));
  }
  const expiryMs = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const token = signSession(expiryMs);
  setCookie(res, token);
  const redirect = (req.query && req.query.redirect) || '/app/live-visitors';
  res.redirect(302, redirect);
}

function handleLogout(req, res) {
  clearCookie(res);
  oauthLogin.clearOauthCookie(res);
  res.redirect(302, '/app/login');
}

module.exports = {
  handleGetLogin,
  handlePostLogin,
  handleLogout,
};
