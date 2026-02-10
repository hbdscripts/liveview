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
</head>
<body class="d-flex flex-column" data-bs-theme="light">
  <div class="page page-center">
    <div class="container container-tight py-4">
      <div class="text-center mb-4">
        <a href="/" class="navbar-brand navbar-brand-autodark">
          <img src="/assets/logo2.png" alt="Kexo" width="120" height="44">
        </a>
      </div>
      <div class="card card-md">
        <div class="card-body">
          <h2 class="h2 text-center mb-4">Sign in to your account</h2>
          ${errMsg}
          <div class="d-grid gap-2">
            <a href="/auth/shopify-login" class="btn btn-dark">
              <svg class="icon me-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M15.34 3.8c-.07-.05-.14-.05-.21-.02s-.1.1-.12.17l-.44 1.36c-.26-.12-.56-.23-.9-.3-.08-.78-.44-1.57-1.2-1.57h-.06c-.18-.22-.4-.37-.63-.37-1.56 0-2.3 1.95-2.54 2.94l-1.5.47c-.47.15-.48.16-.54.6l-1.14 8.8L11.28 17l5.17-1.12s-1.87-12.52-1.9-12.72c-.04-.2-.14-.31-.21-.36zM12.2 5.48l-.73.23c.14-.55.42-1.1.78-1.37-.15.32-.05.73 0 1.14zM11.29 4.4c.36.02.6.43.74.87l-.56.17c.1-.42.08-.8-.18-1.04zm-.4-.42c.05 0 .1.02.14.05-.47.22-.98.79-1.2 1.93l-1.12.35c.31-1.06.93-2.33 2.17-2.33z"/><path d="M15.13 3.95l-.02-.01-.01.01c-.02 0-.05.02-.07.05-.02.02-.03.05-.04.08l-.44 1.37s-.65-.14-.95-.17c-.12-1.16-.68-1.53-1.13-1.56h-.02l-.04-.04-.01-.01c-.14-.16-.32-.27-.5-.27-1.26 0-2.04 1.58-2.37 2.72l-1.68.52c-.35.11-.37.12-.41.46l-1.2 9.2 7.02 1.31 5.44-1.18-1.87-12.52c-.03-.12-.09-.17-.14-.2l-.02-.01-.03.02.5.22zm-3.43.91c.26.03.44.08.44.08l-.1.3c-.15-.5-.44-.87-.8-.95zm-.32-.42s.03 0 .07.02c-.38.17-.8.65-1.04 1.66l-1.27.39c.27-.92.83-2.07 2.24-2.07z"/></svg>
              Continue with Shopify
            </a>
            ${hasGoogle ? `<a href="/auth/google?redirect=/dashboard" class="btn btn-outline-secondary">
              <svg class="icon me-2" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M21.35 11.1H12v2.9h5.35c-.5 2.95-3 4.25-5.35 4.25a6.1 6.1 0 0 1 0-12.2c1.65 0 2.75.7 3.4 1.3l2.3-2.2C16.25 3.55 14.35 2.7 12 2.7a9.3 9.3 0 1 0 0 18.6c5.35 0 8.9-3.75 8.9-9.05 0-.6-.05-1.05-.15-1.5z"/></svg>
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
