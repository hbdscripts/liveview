/**
 * Shopify OAuth: install request (redirect to authorize) and callback (exchange code, store token, redirect to embedded app).
 */

const crypto = require('crypto');
const config = require('../config');
const { getDb, isPostgres } = require('../db');
const { writeAudit } = require('../audit');
const salesTruth = require('../salesTruth');
const users = require('../usersService');
const shopOauthIdentities = require('../shopOauthIdentitiesService');
const { signOauthSession, OAUTH_COOKIE_NAME } = require('../middleware/dashboardAuth');
const { warnOnReject } = require('../shared/warnReject');

const apiKey = config.shopify.apiKey;
const apiSecret = config.shopify.apiSecret;
const appUrl = (config.shopify.appUrl || '').replace(/\/$/, '');
const scopes = config.shopify.scopes || 'read_products,read_orders,read_all_orders,write_pixels,read_customer_events,read_reports';

function parseScopeSet(scopeStr) {
  return new Set(
    String(scopeStr || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function scopesSatisfy(grantedScopes, requiredScopes) {
  const granted = parseScopeSet(grantedScopes);
  const required = parseScopeSet(requiredScopes);
  for (const s of required) {
    if (!granted.has(s)) return false;
  }
  return true;
}

function verifyHmac(query) {
  const q = (query && typeof query === 'object') ? query : {};
  const { hmac, ...rest } = q;
  if (!hmac || !apiSecret) return false;
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  try {
    const a = Buffer.from(String(hmac), 'hex');
    const b = Buffer.from(digest, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
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

function stateDecode(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function isSafeRelativeRedirectPath(p) {
  if (!p || typeof p !== 'string') return false;
  if (!p.startsWith('/')) return false;
  if (p.startsWith('//')) return false;
  if (p.includes('://')) return false;
  return true;
}

function setOauthCookie(res, value) {
  const maxAge = 24 * 60 * 60;
  let set = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=lax; HttpOnly`;
  if (config.nodeEnv === 'production') set += '; Secure';
  res.setHeader('Set-Cookie', set);
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
    const shopNorm = String(shop).trim().toLowerCase();
    const decodedState = stateDecode(state);
    const wantsOauthCookie = !!(decodedState && typeof decodedState === 'object' && typeof decodedState.r === 'string');
    const stateRedirect = wantsOauthCookie && isSafeRelativeRedirectPath(decodedState.r) ? decodedState.r : null;

    const db = getDb();
    const now = Date.now();
    if (isPostgres()) {
      await db.run(
        'INSERT INTO shop_sessions (shop, access_token, scope, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (shop) DO UPDATE SET access_token = ?, scope = ?, updated_at = ?',
        [shopNorm, accessToken, scope, now, accessToken, scope, now]
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO shop_sessions (shop, access_token, scope, updated_at) VALUES (?, ?, ?, ?)',
        [shopNorm, accessToken, scope, now]
      );
    }

    // Kick off a background reconcile immediately after (re)authorization so truth tables are correct ASAP.
    try {
      const endMs = now;
      const startMs = endMs - 48 * 60 * 60 * 1000;
      setTimeout(() => {
        salesTruth.reconcileRange(shopNorm, startMs, endMs, 'today').catch(warnOnReject('[auth] reconcileRange'));
      }, 0);
    } catch (_) {
      // ignore
    }

    const allowed = !config.allowedShopDomain || shopNorm === String(config.allowedShopDomain).trim().toLowerCase();
    let oauthEmail = null;
    let oauthUserId = null;
    if (wantsOauthCookie && allowed) {
      try {
        const userRes = await fetch(`https://${shop}/admin/api/2024-01/users/current.json`, {
          headers: { 'X-Shopify-Access-Token': accessToken },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          const shopifyUser = userData && userData.user;
          const email = shopifyUser && shopifyUser.email ? String(shopifyUser.email).trim().toLowerCase() : '';
          const userId = shopifyUser && shopifyUser.id != null ? Number(shopifyUser.id) : null;
          if (email && email.includes('@')) {
            oauthEmail = email;
            oauthUserId = Number.isFinite(userId) ? userId : null;
            const existing = await users.getUserByEmail(email);
            if (!existing) {
              await users.createPendingUser(email, null, {}, { now });
            } else if ((existing.status || '').toString().trim().toLowerCase() === 'active') {
              const meta = {};
              if (req) {
                const ip = (req.get && req.get('cf-connecting-ip')) || (req.get && req.get('x-forwarded-for')) || (req.ip || '');
                const ua = (req.get && (req.get('user-agent') || req.get('User-Agent'))) || '';
                if (ua) meta.last_user_agent = ua.slice(0, 320);
                if (ip) meta.last_ip = String(ip).slice(0, 64);
              }
              await users.updateLoginMeta(email, meta, { now });
            }
            await db.run(
              'UPDATE shop_sessions SET last_oauth_email = ?, last_oauth_user_id = ?, last_oauth_at = ? WHERE shop = ?',
              [oauthEmail, oauthUserId, now, shopNorm]
            );
            try {
              await shopOauthIdentities.upsertIdentity({ shop: shopNorm, email: oauthEmail, shopifyUserId: oauthUserId, now });
            } catch (_) {}
          }
        }
      } catch (err) {
        console.warn('[auth] Failed to fetch current user for OAuth attribution:', err && err.message ? String(err.message).slice(0, 200) : err);
      }
    }

    try {
      if (wantsOauthCookie && allowed) {
        const payload = oauthEmail ? { email: oauthEmail } : { shop: shopNorm };
        const token = signOauthSession(payload);
        if (token) setOauthCookie(res, token);
      }
    } catch (_) {}

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
    } else if (stateRedirect) {
      redirectUrl = stateRedirect;
    } else {
      const base = (appUrl && appUrl.startsWith('http')) ? appUrl.replace(/\/$/, '') : null;
      if (base) {
        redirectUrl = `${base}/`;
      } else if (req.get('host') || req.get('x-forwarded-host')) {
        const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
        const h = req.get('x-forwarded-host') || req.get('host') || '';
        redirectUrl = `${proto}://${h}/`;
      } else {
        redirectUrl = '/';
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

/** GET / - App URL: if shop + hmac + timestamp (no code), redirect to OAuth only when no session; else render dashboard in iframe */
async function handleAppUrl(req, res, next) {
  const { shop, hmac, timestamp, code, host } = req.query;
  if (!apiKey || !apiSecret) {
    return res.redirect(302, '/');
  }
  if (shop && hmac && timestamp && !code) {
    if (!verifyHmac(req.query)) {
      return res.status(400).send('Invalid HMAC.');
    }
    const shopNorm = String(shop).trim().toLowerCase();
    try {
      // Already installed: we have a token for this shop → show app in iframe (no OAuth redirect).
      const db = getDb();
      const session = await db.get('SELECT access_token, scope FROM shop_sessions WHERE shop = ?', [shopNorm]);
      if (session && session.access_token) {
        const scopeOk = scopesSatisfy(session.scope || '', scopes || '');
        if (!scopeOk) {
          await writeAudit('system', 'shopify_token_missing_scopes', { shop: shopNorm, have: session.scope || '', need: scopes || '' });
        } else {
          const tokenOk = await isAccessTokenValid(shopNorm, session.access_token);
          if (tokenOk) {
            // Important: do NOT redirect internally to / here.
            // Inside Shopify admin this can cause auth loops when cookies are blocked or Referer is stripped.
            // Instead, let the caller render the dashboard on this signed App URL request.
            res.locals = res.locals || {};
            res.locals.renderEmbeddedDashboard = true;
            res.locals.shop = shopNorm;
            return;
          }
          await writeAudit('system', 'shopify_token_invalid', { shop: shopNorm, at: Date.now() });
          // Fall through to OAuth re-authorize when token is invalid/revoked.
        }
      }
    } catch (err) {
      console.error('[auth] App URL session check:', err);
      throw err;
    }
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = getRedirectUri(req);
    if (!redirectUri || !redirectUri.startsWith('http')) {
      console.error('[auth] No valid redirect_uri (set SHOPIFY_APP_URL or ensure request has Host)');
      return res.status(500).send('App URL not configured. Set SHOPIFY_APP_URL in your deployment.');
    }
    const authUrl = buildAuthorizeUrl(shopNorm, state, redirectUri);
    if (host && typeof host === 'string' && host.length > 0) {
      const authUrlB64 = Buffer.from(authUrl, 'utf8').toString('base64');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Loading…</title><link rel="stylesheet" href="/app.css" /></head><body class="page-auth-loading"><div class="spinner" aria-hidden="true"></div><script>window.top.location.href=atob("${authUrlB64}");</script></body></html>`
      );
    }
    return res.redirect(302, authUrl);
  }
}

module.exports = {
  handleCallback,
  handleAppUrl,
  verifyHmac,
};
