/**
 * Shopify OAuth: install request (redirect to authorize) and callback (exchange code, store token, redirect to embedded app).
 */

const crypto = require('crypto');
const config = require('../config');
const { getDb, isPostgres } = require('../db');

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

function getRedirectUri() {
  return `${appUrl}/auth/callback`;
}

/** GET /auth/callback or /auth/shopify/callback - Shopify redirects here with code, shop, hmac, state, timestamp [, host] */
async function handleCallback(req, res) {
  const { code, shop, hmac, state, timestamp, host } = req.query;
  if (!apiKey || !apiSecret || !appUrl) {
    res.status(500).send('App not configured (missing Shopify API key/secret or app URL).');
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
      redirectUrl = `${appUrl}/app/live-visitors`;
    }
    res.redirect(302, redirectUrl);
  } catch (err) {
    console.error('[auth] Callback error:', err);
    res.status(500).send('Server error during install.');
  }
}

/** GET / - App URL: if shop + hmac + timestamp (no code), redirect to Shopify authorize; else go to dashboard */
function handleAppUrl(req, res, next) {
  const { shop, hmac, timestamp, code, host } = req.query;
  if (!apiKey || !apiSecret || !appUrl) {
    return res.redirect(302, '/app/live-visitors');
  }
  if (shop && hmac && timestamp && !code) {
    if (!verifyHmac(req.query)) {
      return res.status(400).send('Invalid HMAC.');
    }
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = getRedirectUri();
    const authUrl = buildAuthorizeUrl(shop, state, redirectUri);

    // When loaded inside Shopify admin iframe, do NOT 302 to OAuth (OAuth page blocks framing → "refused to connect").
    // Return HTML that redirects the top window so the whole tab goes to OAuth, then comes back into the iframe.
    if (host && typeof host === 'string' && host.length > 0) {
      const escapedAuthUrl = authUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting…</title></head><body><p>Redirecting to Shopify…</p><script>window.top.location.href = "${escapedAuthUrl}";</script></body></html>`
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
