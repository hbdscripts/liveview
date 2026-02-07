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
  const errMsg = errFromQuery
    ? `<div class="alert alert-error" role="alert">
        <div class="alert-title">Sign-in error</div>
        <div class="alert-body">${errFromQuery}</div>
      </div>`
    : '';

  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);

  const buttons = hasGoogle
    ? `<a href="/auth/google" class="btn btn-primary" aria-label="Continue with Google">
        <svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.5 2.95-3 4.25-5.35 4.25a6.1 6.1 0 0 1 0-12.2c1.65 0 2.75.7 3.4 1.3l2.3-2.2C16.25 3.55 14.35 2.7 12 2.7a9.3 9.3 0 1 0 0 18.6c5.35 0 8.9-3.75 8.9-9.05 0-.6-.05-1.05-.15-1.5z"/>
        </svg>
        <span>Continue with Google</span>
      </a>`
    : '<p class="muted">Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (and OAUTH_COOKIE_SECRET) to enable sign-in.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/png" href="${config.assetsBaseUrl ? config.assetsBaseUrl + '/favicon.png?width=100' : '/assets/favicon.png'}">
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/app.css" />
  <title>Kexo · Sign in</title>
</head>
<body class="page-login">
  <div class="shell">
    <div class="brand">
      <img class="logo" src="/assets/kexo_logo_fullcolor.webp" alt="Kexo" decoding="async" loading="eager" />
      <div class="brand-title">Kexo</div>
    </div>
    <div class="login-actions">
      ${errMsg}
      ${buttons}
    </div>
  </div>
</body>
</html>`;
}

function handleGetLogin(req, res) {
  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const queryError = (req.query && req.query.error) || '';
  // Local dev: if Google isn't configured, just jump straight to the dashboard (auth middleware allows).
  if (!hasGoogle && process.env.NODE_ENV !== 'production') {
    return res.redirect(302, '/app/dashboard');
  }
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
