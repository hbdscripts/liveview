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
  <title>Birdseye Tracker · Sign in</title>
  <style>
    :root {
      --bg: #f5f7f7;
      --card: rgba(255, 255, 255, 0.92);
      --text: #0f172a;
      --muted: #475569;
      --brand: #0d9488;
      --brandHover: #0f766e;
      --border: rgba(15, 23, 42, 0.10);
      --shadow: 0 10px 30px rgba(2, 6, 23, 0.12);
      --radius: 16px;
      --ring: rgba(13, 148, 136, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text);
      background:
        radial-gradient(900px circle at 20% 10%, rgba(13, 148, 136, 0.18), transparent 45%),
        radial-gradient(700px circle at 90% 30%, rgba(13, 148, 136, 0.10), transparent 50%),
        linear-gradient(180deg, #fafafa 0%, var(--bg) 100%);
      padding: 28px 18px;
    }
    .shell { width: 100%; max-width: 460px; }
    .brand { display: flex; flex-direction: column; align-items: center; margin-bottom: 14px; }
    .logo { width: 92px; height: 92px; object-fit: contain; display: block; }
    .brand-title { margin: 10px 0 0; font-size: 1.05rem; font-weight: 800; letter-spacing: -0.01em; }
    .brand-subtitle { margin: 6px 0 0; font-size: 0.9rem; color: var(--muted); text-align: center; line-height: 1.45; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 22px;
      backdrop-filter: blur(8px);
    }
    .btn {
      display: inline-flex;
      width: 100%;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 0.8rem 1rem;
      font-size: 0.95rem;
      font-weight: 800;
      border-radius: 12px;
      border: 1px solid transparent;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      user-select: none;
      transition: transform 90ms ease, background 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .btn:active { transform: translateY(1px); }
    .btn:focus-visible { outline: 3px solid var(--ring); outline-offset: 2px; }
    .btn-icon { width: 18px; height: 18px; display: block; }
    .btn-primary {
      background: var(--brand);
      color: #fff;
      border-color: rgba(13, 148, 136, 0.55);
      box-shadow: 0 8px 16px rgba(13, 148, 136, 0.22);
    }
    .btn-primary:hover { background: var(--brandHover); }
    .alert {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.75rem 0.85rem;
      margin-bottom: 12px;
      background: rgba(255, 255, 255, 0.75);
    }
    .alert-title { font-weight: 800; font-size: 0.9rem; margin: 0 0 0.25rem; }
    .alert-body { font-size: 0.9rem; color: var(--muted); }
    .alert-error { border-color: rgba(220, 38, 38, 0.28); background: rgba(220, 38, 38, 0.06); }
    .alert-error .alert-body { color: #991b1b; }
    .muted { color: var(--muted); font-size: 0.9rem; margin: 0; }
    .fineprint { margin-top: 14px; text-align: center; color: var(--muted); font-size: 0.78rem; line-height: 1.35; }
    .fineprint a { color: var(--brandHover); text-decoration: none; font-weight: 700; }
    .fineprint a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="brand">
      <img class="logo" src="/assets/birdseye.png" alt="Birdseye" decoding="async" loading="eager" />
      <div class="brand-title">Birdseye Tracker</div>
      <div class="brand-subtitle">Sign in to view your dashboard.</div>
    </div>
    <div class="card">
      ${errMsg}
      ${buttons}
      <div class="fineprint">Private dashboard access. Only approved emails can sign in.</div>
    </div>
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
