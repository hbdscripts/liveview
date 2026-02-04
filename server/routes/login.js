/**
 * Dashboard login: GET /app/login (Google only), GET /app/logout.
 * From Shopify admin, dashboard is allowed without login (middleware bypass).
 * Direct visit to Railway URL requires Sign in with Google.
 */

const config = require('../config');
const oauthLogin = require('./oauthLogin');

const ERROR_MESSAGES = {
  google_not_configured: 'Google sign-in is not configured.',
  google_denied: 'Google sign-in was cancelled.',
  google_token: 'Google sign-in failed. Try again.',
  google_user: 'Could not load Google profile.',
  email_not_allowed: 'Your email is not allowed to sign in.',
  invalid_state: 'Invalid request. Try again.',
  session: 'Session error. Try again.',
};

function getLoginHtml(queryError) {
  const errFromQuery = queryError && ERROR_MESSAGES[queryError] ? ERROR_MESSAGES[queryError] : '';
  const errMsg = errFromQuery ? `<p class="error">${errFromQuery}</p>` : '';

  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);

  const buttons = hasGoogle
    ? `<a href="/auth/google" class="btn btn-google">Sign in with Google</a>`
    : '<p class="muted">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (and OAUTH_COOKIE_SECRET) in Railway to enable sign-in.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/png" href="${config.assetsBaseUrl ? config.assetsBaseUrl + '/favicon.png?width=100' : 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/spyview_favicon.png?v=1770086377&width=100'}">
  <title>Sign in</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f6f6f7; }
    .card { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); width: 100%; max-width: 400px; }
    .subtitle { color: #6d7175; font-size: 0.875rem; margin: 0 0 1.25rem; }
    .btn { display: block; width: 100%; padding: 0.6rem 1rem; font-size: 0.95rem; font-weight: 500; border-radius: 6px; border: none; cursor: pointer; text-align: center; text-decoration: none; margin-bottom: 0.75rem; }
    .btn-google { background: #fff; color: #202223; border: 1px solid #c9cccf; }
    .btn-google:hover { background: #f9fafb; border-color: #8c9196; }
    .error { color: #d72c0d; font-size: 0.875rem; margin-bottom: 1rem; }
    .muted { color: #6d7175; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="card">
    <p class="subtitle">Sign in to view your dashboard.</p>
    ${errMsg}
    ${buttons}
  </div>
</body>
</html>`;
}

function handleGetLogin(req, res) {
  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  if (!hasGoogle) {
    return res.redirect(302, '/app/live-visitors');
  }
  const queryError = (req.query && req.query.error) || '';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getLoginHtml(queryError));
}

function handleLogout(req, res) {
  oauthLogin.clearOauthCookie(res);
  res.redirect(302, '/app/login');
}

module.exports = {
  handleGetLogin,
  handleLogout,
};
