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
  shop_required: 'Shop domain is missing for Shopify login.',
  shop_not_allowed: 'That Shopify shop is not allowed.',
  app_not_configured: 'Shopify login is not configured.',
  invalid_hmac: 'Shopify login validation failed. Try again.',
  shopify_token: 'Shopify token exchange failed. Try again.',
  email_not_allowed: 'Your email is not allowed to sign in.',
  invalid_state: 'Invalid request. Try again.',
  session: 'Session error. Try again.',
  session_expired: 'Your session expired. Please sign in again.',
  pending: 'Your account is awaiting approval.',
  denied: 'Your registration was denied.',
  registered: 'Thanks for signing up. Your account is awaiting approval.',
  invalid_email: 'Please enter a valid email address.',
  weak_password: 'Password must be at least 8 characters.',
  already_exists: 'An account with that email already exists.',
  invalid_credentials: 'Invalid email or password.',
  register_failed: 'Sign up failed. Please try again.',
  db_error: 'Something went wrong. Please try again.',
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

function normalizeSafeRedirectPath(value) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return '/dashboard/overview';
  if (!raw.startsWith('/')) return '/dashboard/overview';
  if (raw.startsWith('//')) return '/dashboard/overview';
  if (raw.includes('://')) return '/dashboard/overview';
  return raw;
}

function getLoginHtml(queryError, opts) {
  const errFromQuery = queryError && ERROR_MESSAGES[queryError] ? ERROR_MESSAGES[queryError] : '';
  const errLevel = (queryError === 'pending' || queryError === 'session_expired') ? 'warning' : 'danger';
  const errMsg = errFromQuery
    ? `<div class="alert alert-${errLevel} mb-3" role="alert">
        <div class="d-flex">
          <div><svg xmlns="http://www.w3.org/2000/svg" class="icon alert-icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M12 9v4"></path><path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z"></path><path d="M12 16h.01"></path></svg></div>
          <div>${errFromQuery}</div>
        </div>
      </div>`
    : '';

  const registered = !!(opts && opts.registered);
  const okMsg = registered
    ? `<div class="alert alert-success mb-3" role="alert">
        <div class="d-flex">
          <div><svg xmlns="http://www.w3.org/2000/svg" class="icon alert-icon" width="24" height="24" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"></path><path d="M5 12l5 5l10 -10"></path></svg></div>
          <div>${ERROR_MESSAGES.registered}</div>
        </div>
      </div>`
    : '';

  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  const hasShopifyOAuth = !!(config.shopify && config.shopify.apiKey && config.shopify.apiSecret && config.shopify.appUrl);
  const shopDomain = (opts && opts.shopDomain) ? String(opts.shopDomain).trim().toLowerCase() : '';
  const faviconHref = (opts && opts.faviconHref) ? String(opts.faviconHref) : (config.assetsBaseUrl ? config.assetsBaseUrl + '/favicon.png?width=100' : '/assets/favicon.png');
  const loginLogoSrc = (opts && opts.loginLogoSrc) ? String(opts.loginLogoSrc) : '/assets/desktop_ui_logo.webp';
  const redirectTarget = normalizeSafeRedirectPath((opts && opts.redirectTarget) || '/dashboard/overview');
  const googleLoginHref = '/auth/google?redirect=' + encodeURIComponent(redirectTarget);
  const shopifyLoginHref = '/auth/shopify-login?shop=' + encodeURIComponent(shopDomain) + '&redirect=' + encodeURIComponent(redirectTarget);
  const shopifySvg = `<svg class="kexo-login-icon" viewBox="-3 0 48 48" version="1.1" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g fill="#81BF37"><path d="M233.8471,666.99462 C234.633657,667.77951 235.525036,668.6685 235.525036,668.6685 C235.525036,668.6685 239.195316,668.9415 239.368457,668.9565 C239.54309,668.9715 239.753545,669.105 239.786382,669.3465 C239.819219,669.588 245,704.7915 245,704.7915 L232.287087,707.554966 L233.8471,666.99462 Z M231.896906,665.661214 C231.799504,665.673829 231.715018,665.693029 231.656242,665.7105 C231.624898,665.7195 231.099506,665.883 230.229326,666.153 C229.377057,663.69 227.874018,661.4265 225.230641,661.4265 C225.157504,661.4265 225.081382,661.4295 225.006752,661.434 C224.254487,660.435 223.32311,660 222.518604,660 C216.358684,660 213.415295,667.74 212.492875,671.6715 C210.09876,672.417 208.398699,672.9465 208.182274,673.0155 C206.844913,673.437 206.80312,673.479 206.628487,674.7435 C206.495647,675.702 203,702.8715 203,702.8715 L230.239774,708 L230.268734,707.993705 L231.896906,665.661214 Z M224.805252,667.572 C224.805252,667.6665 224.80376,667.7535 224.80376,667.8405 C223.303707,668.307 221.675291,668.814 220.042397,669.3225 C220.958847,665.7675 222.676819,664.05 224.179857,663.402 C224.557482,664.356 224.805252,665.7255 224.805252,667.572 Z M222.348449,661.6605 C222.615622,661.6605 222.882796,661.752 223.139522,661.929 C221.164825,662.862 219.049824,665.214 218.155762,669.909 C216.849746,670.3155 215.573581,670.713 214.392942,671.0805 C215.439248,667.4985 217.924411,661.6605 222.348449,661.6605 Z M223.409681,682.593 C223.409681,682.593 221.815594,681.738 219.861793,681.738 C216.99602,681.738 216.851238,683.5455 216.851238,684 C216.851238,686.4855 223.296244,687.438 223.296244,693.258 C223.296244,697.836 220.406589,700.785 216.509435,700.785 C211.83315,700.785 209.44202,697.86 209.44202,697.86 L210.694303,693.7035 C210.694303,693.7035 213.1526,695.8245 215.2273,695.8245 C216.58108,695.8245 217.133338,694.752 217.133338,693.969 C217.133338,690.7275 211.84509,690.582 211.84509,685.2555 C211.84509,680.7735 215.046697,676.4355 221.509613,676.4355 C223.999254,676.4355 225.230641,677.1525 225.230641,677.1525 L223.409681,682.593 Z M226.418743,667.338 C226.418743,667.1745 226.420235,667.014 226.420235,666.8385 C226.420235,665.3085 226.208287,664.0755 225.869469,663.099 C227.232204,663.27 228.139699,664.8285 228.723302,666.621 C228.039696,666.834 227.262056,667.0755 226.418743,667.338 Z" transform="translate(-203.000000, -660.000000)"></path></g></svg>`;
  const googleSvg = `<svg class="kexo-login-icon" viewBox="-3 0 262 262" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" aria-hidden="true"><path d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" fill="#4285F4"></path><path d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" fill="#34A853"></path><path d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782" fill="#FBBC05"></path><path d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" fill="#EB4335"></path></svg>`;

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
    html, body { width: 100%; overflow-x: hidden; }
    body { margin: 0; background: #19222e; min-height: 100vh; }
    .navbar-brand img { height: 36px; }
    .container-tight { width: min(100%, 440px); margin-left: auto; margin-right: auto; padding-left: 12px; padding-right: 12px; box-sizing: border-box; }
    @media (max-width: 420px) { .container-tight { padding-left: 10px; padding-right: 10px; } }
    .card-md { background: rgba(255,255,255,0.94); border: 1px solid rgba(255,255,255,0.14); box-shadow: 0 14px 34px rgba(0,0,0,0.28); }
    .kexo-login-title { color: #182433; font-size: 1.05rem; font-weight: 600; text-align: center; margin-bottom: 14px; }
    .kexo-login-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .btn-login { height: 50px; font-size: .9375rem; font-weight: 600; display: flex; align-items: center; justify-content: center; }
    .btn-login .kexo-login-icon { width: 18px; height: 18px; margin-right: 8px; flex: 0 0 auto; display: inline-block; }
    .btn-login .kexo-login-label { line-height: 1; white-space: nowrap; font-size: 0.84rem; }
    .btn-shopify { background: #3eb3ab; border-color: #3eb3ab; color: #fff; }
    .btn-shopify:hover { background: #2f9b94; border-color: #2f9b94; color: #fff; }
    .btn-google { background: #4b94e4; border-color: #4b94e4; color: #fff; }
    .btn-google:hover { background: #3f84ce; border-color: #3f84ce; color: #fff; }
    .btn-login.disabled, .btn-login[aria-disabled="true"] { opacity: 0.6; pointer-events: none; }
    .kexo-help-note { margin-top: 10px; text-align: center; font-size: 12px; color: #5b6b7f; }
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
          <div class="kexo-login-title">Login to Kexo Below</div>
          ${okMsg}
          ${errMsg}
          <div class="kexo-login-grid">
            ${hasShopifyOAuth ? (
              shopDomain
                ? `<a href="${shopifyLoginHref}" class="btn btn-shopify btn-login" aria-label="Login with Shopify">
                    ${shopifySvg}
                    <span class="kexo-login-label">Login with Shopify</span>
                  </a>`
                : `<a href="#" class="btn btn-shopify btn-login disabled" aria-disabled="true" title="Shop domain missing">
                    ${shopifySvg}
                    <span class="kexo-login-label">Login with Shopify</span>
                  </a>`
            ) : ''}
            ${hasGoogle ? `<a href="${googleLoginHref}" class="btn btn-google btn-login" aria-label="Login with Google">
              ${googleSvg}
              <span class="kexo-login-label">Login with Google</span>
            </a>` : ''}
          </div>
          ${(!shopDomain && hasShopifyOAuth) ? '<div class="kexo-help-note">Shopify login needs a valid <code>shop</code> param or <code>ALLOWED_SHOP_DOMAIN</code>.</div>' : ''}

          <div class="hr-text my-4">or</div>

          <form method="post" action="/auth/local/login" autocomplete="on">
            <input type="hidden" name="redirect" value="${redirectTarget}">
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" name="email" class="form-control" placeholder="you@example.com" autocomplete="email" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Password</label>
              <input type="password" name="password" class="form-control" autocomplete="current-password" required>
            </div>
            <button type="submit" class="btn btn-dark w-100">Login</button>
          </form>

          <div class="hr-text my-4">Sign Up</div>
          <form method="post" action="/auth/local/register" autocomplete="on">
            <input type="hidden" name="redirect" value="${redirectTarget}">
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" name="email" class="form-control" placeholder="you@example.com" autocomplete="email" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Password</label>
              <input type="password" name="password" class="form-control" autocomplete="new-password" required>
              <div class="form-hint">New accounts require approval before you can access the dashboard.</div>
            </div>
            <button type="submit" class="btn btn-outline-dark w-100">Sign Up</button>
          </form>
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
  const redirectTarget = normalizeSafeRedirectPath(req.query && req.query.redirect);
  const registered = !!(req.query && (req.query.registered === '1' || req.query.registered === 'true' || req.query.registered === 'yes'));
  const queryShop = req.query && req.query.shop ? String(req.query.shop).trim().toLowerCase() : '';
  const shopDomain = (queryShop && /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/i.test(queryShop))
    ? queryShop
    : (config.allowedShopDomain || '');
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
  res.send(getLoginHtml(queryError, { faviconHref, loginLogoSrc, redirectTarget, shopDomain, registered }));
}

function handleLogout(req, res) {
  const reason = (req.query && req.query.error) ? String(req.query.error) : '';
  const redirectTarget = normalizeSafeRedirectPath(req.query && req.query.redirect);
  oauthLogin.clearOauthCookie(res);
  let url = '/app/login?redirect=' + encodeURIComponent(redirectTarget);
  if (reason) url += '&error=' + encodeURIComponent(reason);
  res.redirect(302, url);
}

module.exports = {
  handleGetLogin,
  handleLogout,
};
