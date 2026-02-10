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
    ? `<div class="alert alert-danger mb-3" role="alert">
        <div class="d-flex">
          <div><svg xmlns="http://www.w3.org/2000/svg" class="icon alert-icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M12 9v4"></path><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"></path><path d="M12 16h.01"></path></svg></div>
          <div>${errFromQuery}</div>
        </div>
      </div>`
    : '';

  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const faviconHref = config.assetsBaseUrl ? config.assetsBaseUrl + '/favicon.png?width=100' : '/assets/favicon.png';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/png" href="${faviconHref}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/core@1.4.0/dist/css/tabler.min.css">
  <link rel="stylesheet" href="/tabler-theme.css">
  <title>Kexo &middot; Sign in</title>
  <style>
    .navbar-brand img { height: 36px; }
    .btn-login { height: 50px; font-size: .9375rem; font-weight: 600; display: flex; align-items: center; justify-content: center; }
    .btn-shopify { background: #96bf48; border-color: #96bf48; color: #fff; }
    .btn-shopify:hover { background: #7ea83e; border-color: #7ea83e; color: #fff; }
    .btn-google { background: #4285f4; border-color: #4285f4; color: #fff; }
    .btn-google:hover { background: #3367d6; border-color: #3367d6; color: #fff; }
  </style>
</head>
<body class="d-flex flex-column" data-bs-theme="light">
  <div class="page page-center">
    <div class="container container-tight py-4">
      <div class="text-center mb-4">
        <a href="/" class="navbar-brand navbar-brand-autodark">
          <img src="/assets/desktop_ui_logo.webp" alt="Kexo" width="100" height="36">
        </a>
      </div>
      <div class="card card-md">
        <div class="card-body">
          <h2 class="h2 text-center mb-4">Sign in to your account</h2>
          ${errMsg}
          <div class="d-grid gap-2">
            <a href="/auth/shopify-login" class="btn btn-shopify btn-login">
              <svg class="icon me-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 109.5 124.5" fill="white"><path d="M95.9 23.9c-.1-.6-.6-1-1.1-1-.5 0-9.3-.2-9.3-.2s-7.4-7.2-8.1-7.9c-.7-.7-2.2-.5-2.7-.3-.1 0-1.5.5-3.9 1.2-2.3-6.7-6.4-12.8-13.6-12.8h-.6C54.6.6 52.4 0 50.5 0 29.4 0 19.2 26.4 16.2 39.8l-13.7 4.2c-4.3 1.3-4.4 1.5-5 5.5C-2.9 52.6 0 124.5 0 124.5l76.1 13.1 39.1-9.6S96 24.5 95.9 23.9zM67.2 18.3l-5.9 1.8c0-3.1-.3-7.5-1.5-11.2 3.7.7 6.2 4.7 7.4 9.4zM55.8 22.1l-12.7 3.9c1.2-4.7 3.6-9.4 6.4-12.5 1.1-1.1 2.6-2.4 4.3-3.1 1.7 3.5 2.1 8.5 2 11.7zM50.6 4.2c1.4 0 2.6.5 3.6 1.4-4.1 1.9-8.5 6.8-10.3 16.5l-10 3.1C36.3 15.7 42.3 4.2 50.6 4.2z"/></svg>
              Continue with Shopify
            </a>
            ${hasGoogle ? `<a href="/auth/google?redirect=/dashboard" class="btn btn-google btn-login">
              <svg class="icon me-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M21.35 11.1H12v2.9h5.35c-.5 2.95-3 4.25-5.35 4.25a6.1 6.1 0 0 1 0-12.2c1.65 0 2.75.7 3.4 1.3l2.3-2.2C16.25 3.55 14.35 2.7 12 2.7a9.3 9.3 0 1 0 0 18.6c5.35 0 8.9-3.75 8.9-9.05 0-.6-.05-1.05-.15-1.5z"/></svg>
              Continue with Google
            </a>` : ''}
          </div>
        </div>
      </div>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.4.0/dist/js/tabler.min.js" defer></script>
</body>
</html>`;
}

function handleGetLogin(req, res) {
  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const queryError = (req.query && req.query.error) || '';
  // Local dev: if Google isn't configured, just jump straight to the dashboard (auth middleware allows).
  if (!hasGoogle && process.env.NODE_ENV !== 'production') {
    return res.redirect(302, '/dashboard');
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
