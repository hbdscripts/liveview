/**
 * Dashboard login: GET /app/login (Google only), GET /app/logout.
 * From Shopify admin, dashboard is allowed without login (middleware bypass).
 * Direct visit to Railway URL requires Sign in with Google.
 */

const config = require('../config');
const oauthLogin = require('./oauthLogin');
const store = require('../store');

const ERROR_MESSAGES = {
  google_not_configured: 'Google sign-in is not configured.',
  google_denied: 'Google sign-in was cancelled.',
  google_token: 'Google sign-in failed. Try again.',
  google_user: 'Could not load Google profile.',
  email_not_allowed: 'Your email is not allowed to sign in.',
  invalid_state: 'Invalid request. Try again.',
  session: 'Session error. Try again.',
};

function safeJsonParseObject(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function normalizeAssetUrl(value) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return '';
  // Prevent attribute injection (URLs should never contain quotes/angle brackets/whitespace).
  if (raw.length > 2048) return '';
  if (/[<>"'\r\n\t ]/.test(raw)) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return raw;
  if (raw[0] === '/') return raw;
  return '';
}

function getLoginHtml(queryError, opts) {
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
  const faviconHref = (opts && opts.faviconHref) ? String(opts.faviconHref) : (config.assetsBaseUrl ? config.assetsBaseUrl + '/favicon.png?width=100' : '/assets/favicon.png');
  const loginLogoSrc = (opts && opts.loginLogoSrc) ? String(opts.loginLogoSrc) : '/assets/desktop_ui_logo.webp';

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
    body { background: linear-gradient(135deg, #EAF3FF 0%, #E7FAF7 45%, #FFF2E2 100%); min-height: 100vh; }
    .navbar-brand img { height: 36px; }
    .container-tight { margin-left: 30px; margin-right: 30px; }
    @media (min-width: 576px) { .container-tight { margin-left: auto; margin-right: auto; } }
    .card-md { background: rgba(255,255,255,0.8); }
    .btn-login { height: 50px; font-size: .9375rem; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.btn-google { background: #4285f4; border-color: #4285f4; color: #fff; }
    .btn-google:hover { background: #3367d6; border-color: #3367d6; color: #fff; }
  </style>
</head>
<body class="d-flex flex-column" data-bs-theme="light">
  <div class="page page-center">
    <div class="container container-tight py-4">
      <div class="text-center mb-4">
        <a href="/" class="navbar-brand navbar-brand-autodark">
          <img src="${loginLogoSrc}" alt="Kexo" width="100" height="36">
        </a>
      </div>
      <div class="card card-md">
        <div class="card-body">
          <h2 class="h2 text-center mb-4">Sign in to your account</h2>
          ${errMsg}
          <div class="d-grid gap-2">
            ${hasGoogle ? `<a href="/auth/google?redirect=/dashboard/overview" class="btn btn-google btn-login">
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

async function handleGetLogin(req, res) {
  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const queryError = (req.query && req.query.error) || '';
  // Local dev: if Google isn't configured, jump straight to dashboard overview (auth middleware allows).
  if (!hasGoogle && process.env.NODE_ENV !== 'production') {
    return res.redirect(302, '/dashboard/overview');
  }

  // Asset overrides are stored in DB settings and can change at runtime.
  let assetOverrides = {};
  try {
    const raw = await store.getSetting('asset_overrides');
    const parsed = safeJsonParseObject(raw);
    if (parsed) assetOverrides = parsed;
  } catch (_) {}
  const faviconOverride = normalizeAssetUrl(assetOverrides.favicon);
  const loginLogoOverride = normalizeAssetUrl(assetOverrides.loginLogo || assetOverrides.login_logo);

  const faviconHref = faviconOverride || (config.assetsBaseUrl ? config.assetsBaseUrl + '/favicon.png?width=100' : '/assets/favicon.png');
  const loginLogoSrc = loginLogoOverride || '/assets/desktop_ui_logo.webp';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getLoginHtml(queryError, { faviconHref, loginLogoSrc }));
}

function handleLogout(req, res) {
  oauthLogin.clearOauthCookie(res);
  res.redirect(302, '/app/login');
}

module.exports = {
  handleGetLogin,
  handleLogout,
};
