/**
 * Shopify OAuth: install request (redirect to authorize) and callback (exchange code, store token, redirect to embedded app).
 */

const crypto = require('crypto');
const config = require('../config');
const { getDb, isPostgres } = require('../db');
const { writeAudit } = require('../audit');
const salesTruth = require('../salesTruth');

const apiKey = config.shopify.apiKey;
const apiSecret = config.shopify.apiSecret;
const appUrl = (config.shopify.appUrl || '').replace(/\/$/, '');
const scopes = config.shopify.scopes || 'read_products,read_orders';

function verifyHmac(query) {
  const { hmac, ...rest } = query;
  if (!hmac || !apiSecret) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hmac, 'hex'), Buffer.from(digest, 'hex'));
}

function buildAuthorizeUrl(shop, state, redirectUri) {
  return `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(apiKey)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}

function getRedirectUri(req) {
  const base = (appUrl && appUrl.startsWith('http')) ? appUrl : null;
  if (base) return `${base.replace(/\/$/, '')}/auth/callback`;
  if (req && (req.get('host') || req.get('x-forwarded-host'))) {
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    return `${proto}://${host}/auth/callback`;
  }
  return `${appUrl}/auth/callback`;
}

/** GET /auth/callback or /auth/shopify/callback - Shopify redirects here with code, shop, hmac, state, timestamp [, host] */
async function handleCallback(req, res) {
  const { code, shop, hmac, state, timestamp, host } = req.query;
  if (!apiKey || !apiSecret) {
    res.status(500).send('App not configured (missing Shopify API key/secret).');
    return;
  }
  if (!code || !shop || !hmac || !timestamp) {
    res.status(400).send('Missing required query parameters (code, shop, hmac, timestamp).');
    return;
  }
  if (!verifyHmac(req.query)) {
    res.status(400).send('Invalid HMAC.');
    return;
  }
  const shopMatch = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
  if (!shopMatch) {
    res.status(400).send('Invalid shop.');
    return;
  }

  try {
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
      console.error('[auth] Token exchange failed:', tokenRes.status, errText);
      res.status(502).send('Token exchange failed.');
      return;
    }
    const data = await tokenRes.json();
    const accessToken = data.access_token;
    const scope = data.scope || '';

    const db = getDb();
    const now = Date.now();
    if (isPostgres()) {
      await db.run(
        'INSERT INTO shop_sessions (shop, access_token, scope, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (shop) DO UPDATE SET access_token = ?, scope = ?, updated_at = ?',
        [shop, accessToken, scope, now, accessToken, scope, now]
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO shop_sessions (shop, access_token, scope, updated_at) VALUES (?, ?, ?, ?)',
        [shop, accessToken, scope, now]
      );
    }

    // Kick off a background reconcile immediately after (re)authorization so truth tables are correct ASAP.
    try {
      const endMs = now;
      const startMs = endMs - 48 * 60 * 60 * 1000;
      setTimeout(() => {
        salesTruth.reconcileRange(shop, startMs, endMs, 'today').catch(() => {});
      }, 0);
    } catch (_) {
      // ignore
    }

    let redirectUrl;
    if (host && typeof host === 'string' && host.length > 0) {
      let hostDecoded = host;
      try {
        const padded = host + '='.repeat((4 - (host.length % 4)) % 4);
        hostDecoded = Buffer.from(padded, 'base64').toString('utf8');
      } catch (_) {
        hostDecoded = host;
      }
      redirectUrl = `https://${hostDecoded}/apps/${apiKey}/`;
    } else {
      const base = (appUrl && appUrl.startsWith('http')) ? appUrl.replace(/\/$/, '') : null;
      if (base) {
        redirectUrl = `${base}/app/live-visitors`;
      } else if (req.get('host') || req.get('x-forwarded-host')) {
        const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
        const h = req.get('x-forwarded-host') || req.get('host') || '';
        redirectUrl = `${proto}://${h}/app/live-visitors`;
      } else {
        redirectUrl = '/app/live-visitors';
      }
    }
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('[auth] Callback error:', err);
    res.status(500).send('Server error during install.');
  }
}

async function isAccessTokenValid(shop, accessToken) {
  if (!shop || !accessToken) return false;
  try {
    const res = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    if (res.status === 401 || res.status === 403) return false;
    // Fail-open: treat other statuses as "valid enough" to avoid OAuth loops on transient errors.
    return true;
  } catch (_) {
    return true;
  }
}

/** GET / - App URL: if shop + hmac + timestamp (no code), redirect to OAuth only when no session; else show dashboard in iframe */
async function handleAppUrl(req, res, next) {
  const { shop, hmac, timestamp, code, host } = req.query;
  if (!apiKey || !apiSecret) {
    return res.redirect(302, '/app/live-visitors');
  }
  if (shop && hmac && timestamp && !code) {
    if (!verifyHmac(req.query)) {
      return res.status(400).send('Invalid HMAC.');
    }
    try {
      // Already installed: we have a token for this shop → show app in iframe (no OAuth redirect).
      const db = getDb();
      const session = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
      if (session && session.access_token) {
        const tokenOk = await isAccessTokenValid(shop, session.access_token);
        if (tokenOk) {
          return res.redirect(302, `/app/live-visitors?shop=${encodeURIComponent(shop)}`);
        }
        await writeAudit('system', 'shopify_token_invalid', { shop, at: Date.now() });
        // Fall through to OAuth re-authorize when token is invalid/revoked.
      }
    } catch (err) {
      console.error('[auth] App URL session check:', err);
      return next(err);
    }
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = getRedirectUri(req);
    if (!redirectUri || !redirectUri.startsWith('http')) {
      console.error('[auth] No valid redirect_uri (set SHOPIFY_APP_URL or ensure request has Host)');
      return res.status(500).send('App URL not configured. Set SHOPIFY_APP_URL in your deployment.');
    }
    const authUrl = buildAuthorizeUrl(shop, state, redirectUri);
    if (host && typeof host === 'string' && host.length > 0) {
      const authUrlB64 = Buffer.from(authUrl, 'utf8').toString('base64');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Loading…</title><style>
          *{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f7;font-family:system-ui,sans-serif}
          .spinner{width:40px;height:40px;border:3px solid #e1e3e5;border-top-color:#008060;border-radius:50%;animation:spin .8s linear infinite}
          @keyframes spin{to{transform:rotate(360deg)}}
        </style></head><body><div class="spinner" aria-hidden="true"></div><script>window.top.location.href=atob("${authUrlB64}");</script></body></html>`
      );
    }
    return res.redirect(302, authUrl);
  }
  next();
}

module.exports = {
  handleCallback,
  handleAppUrl,
  verifyHmac,
};
