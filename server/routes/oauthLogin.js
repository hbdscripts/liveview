/**
 * OAuth login for dashboard: Google and "Login with Shopify" (store domain).
 * Sets oauth_session cookie on success; middleware allows access when that cookie is valid.
 */

const crypto = require('crypto');
const config = require('../config');
const { getDb, isPostgres } = require('../db');
const { signOauthSession, OAUTH_COOKIE_NAME } = require('../middleware/dashboardAuth');
const auth = require('./auth');
const salesTruth = require('../salesTruth');
const users = require('../usersService');
const shopOauthIdentities = require('../shopOauthIdentitiesService');
const { warnOnReject } = require('../shared/warnReject');

let geoip;
try {
  geoip = require('geoip-lite');
} catch (_) {
  geoip = null;
}

const SESSION_HOURS = 24;
const appUrl = (config.shopify.appUrl || '').replace(/\/$/, '');
const apiKey = config.shopify.apiKey;
const apiSecret = config.shopify.apiSecret;
const scopes = config.shopify.scopes || 'read_products,read_orders,read_all_orders,write_pixels,read_customer_events,read_reports';

function setOauthCookie(res, value) {
  const maxAge = SESSION_HOURS * 60 * 60;
  let set = `${OAUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=lax; HttpOnly`;
  if (config.nodeEnv === 'production') set += '; Secure';
  res.setHeader('Set-Cookie', set);
}

function clearOauthCookie(res) {
  res.setHeader('Set-Cookie', `${OAUTH_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=lax; HttpOnly`);
}

function stateEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function stateDecode(str) {
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function getClientIp(req) {
  const cfIp = req.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || '';
}

function normalizeCountryCode(raw) {
  if (!raw || typeof raw !== 'string') return '';
  const c = raw.trim().toUpperCase();
  if (c.length !== 2 || c === 'T1' || c === 'XX') return '';
  return c;
}

function countryFromHeaders(req) {
  const worker = normalizeCountryCode(req.get('x-cf-country'));
  if (worker) return worker;
  const cf = normalizeCountryCode(req.get('cf-ipcountry'));
  if (cf) return cf;
  return '';
}

function cityFromIp(ip) {
  if (!geoip || !ip || ip === '::1' || ip === '127.0.0.1') return '';
  try {
    const geo = geoip.lookup(ip);
    const city = geo && typeof geo.city === 'string' ? geo.city.trim() : '';
    return city && city.length <= 96 ? city : (city ? city.slice(0, 96) : '');
  } catch (_) {
    return '';
  }
}

function parseTrafficTypeFromUserAgent(uaRaw) {
  const ua = (uaRaw || '').trim();
  if (!ua) return { deviceType: '', platform: '' };
  const s = ua.toLowerCase();

  const isIphone = /\biphone\b/.test(s) || /\bipod\b/.test(s);
  const isIpad = /\bipad\b/.test(s) || (/\bmacintosh\b/.test(s) && /\bmobile\b/.test(s) && !isIphone);
  const isAndroid = /\bandroid\b/.test(s);

  let deviceType = 'desktop';
  if (isIpad || /\btablet\b/.test(s) || (isAndroid && !/\bmobile\b/.test(s))) deviceType = 'tablet';
  else if (/\bmobi\b/.test(s) || isIphone || isAndroid) deviceType = 'mobile';

  let platform = 'other';
  if (isIphone || isIpad || /\bipod\b/.test(s)) platform = 'ios';
  else if (isAndroid) platform = 'android';
  else if (/\bwindows\b/.test(s)) platform = 'windows';
  else if (/\bmacintosh\b|\bmac os\b|\bmac os x\b/.test(s)) platform = 'mac';
  else if (/\bcros\b/.test(s)) platform = 'chromeos';
  else if (/\blinux\b|\bubuntu\b|\bfedora\b/.test(s)) platform = 'linux';

  return { deviceType, platform };
}

function buildMetaFromRequest(req) {
  const ip = getClientIp(req);
  const ua = (req.get('user-agent') || req.get('User-Agent') || '').trim();
  const country = countryFromHeaders(req);
  const city = cityFromIp(ip);
  const tt = parseTrafficTypeFromUserAgent(ua);
  return {
    last_country: country || null,
    last_city: city || null,
    last_device_type: tt.deviceType || null,
    last_platform: tt.platform || null,
    last_user_agent: ua ? ua.slice(0, 320) : null,
    last_ip: ip ? String(ip).slice(0, 64) : null,
  };
}

// ---- Google OAuth ----

function handleGoogleRedirect(req, res) {
  const redirect = (req.query && req.query.redirect) || '/';
  if (!config.googleClientId || !config.googleClientSecret) {
    return res.redirect(302, '/app/login?error=google_not_configured');
  }
  const state = stateEncode({ rnd: crypto.randomBytes(16).toString('hex'), r: redirect });
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: `${appUrl}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

async function handleGoogleCallback(req, res) {
  const { code, state, error } = req.query;
  if (error) {
    return res.redirect(302, '/app/login?error=google_denied');
  }
  const decoded = stateDecode(state || '');
  const redirect = (decoded && decoded.r) || '/';
  if (!code || !decoded || !decoded.rnd) {
    return res.redirect(302, '/app/login?error=invalid_state');
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: `${appUrl}/auth/google/callback`,
      grant_type: 'authorization_code',
    }).toString(),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('[oauth] Google token error:', tokenRes.status, errText);
    return res.redirect(302, '/app/login?error=google_token');
  }
  const tokens = await tokenRes.json();
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    return res.redirect(302, '/app/login?error=google_user');
  }
  const user = await userRes.json();
  const email = (user.email || '').trim().toLowerCase();
  const allowed = config.allowedGoogleEmails.length === 0 || config.allowedGoogleEmails.includes(email);
  if (!allowed) {
    console.warn('[oauth] Google email not allowed:', email);
    return res.redirect(302, '/app/login?error=email_not_allowed');
  }
  try {
    const now = Date.now();
    const meta = buildMetaFromRequest(req);
    if (users.isBootstrapMasterEmail(email)) {
      await users.ensureBootstrapMaster(email, { now });
    }
    const existing = await users.getUserByEmail(email);
    if (!existing) {
      await users.createPendingUser(email, null, meta, { now });
    }
    await users.updateLoginMeta(email, meta, { now });
  } catch (_) {
    // Fail-open: auth should succeed even if metadata tracking fails.
  }
  const token = signOauthSession({ email });
  if (!token) {
    return res.redirect(302, '/app/login?error=session');
  }
  setOauthCookie(res, token);
  res.redirect(302, redirect);
}

// ---- Login with Shopify (store domain) ----

function handleShopifyLoginRedirect(req, res) {
  let shop = (req.query && req.query.shop) || '';
  shop = shop.trim().toLowerCase();
  if (!shop.endsWith('.myshopify.com')) shop = shop ? `${shop}.myshopify.com` : '';
  if (!shop) {
    return res.redirect(302, '/app/login?error=shop_required');
  }
  if (!apiKey || !apiSecret || !appUrl) {
    return res.redirect(302, '/app/login?error=app_not_configured');
  }
  const redirect = (req.query && req.query.redirect) || '/';
  const state = stateEncode({ rnd: crypto.randomBytes(16).toString('hex'), r: redirect });
  // Use the main OAuth callback (already whitelisted in Shopify app settings).
  // This avoids "redirect_uri not whitelisted" when /auth/shopify-login/callback isn't configured in Shopify.
  const redirectUri = `${appUrl}/auth/callback`;
  const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(apiKey)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  res.redirect(302, authUrl);
}

async function handleShopifyLoginCallback(req, res) {
  const { code, shop, state, hmac, timestamp } = req.query;
  const decoded = stateDecode(state || '');
  const redirect = (decoded && decoded.r) || '/';
  if (!code || !shop || !decoded || !decoded.rnd) {
    return res.redirect(302, '/app/login?error=invalid_state');
  }
  if (!auth.verifyHmac || !auth.verifyHmac(req.query)) {
    return res.redirect(302, '/app/login?error=invalid_hmac');
  }
  const shopNorm = shop.trim().toLowerCase();
  const allowed = config.allowedShopDomain && shopNorm === config.allowedShopDomain;
  if (!allowed) {
    console.warn('[oauth] Shopify shop not allowed:', shopNorm, 'allowed:', config.allowedShopDomain);
    return res.redirect(302, '/app/login?error=shop_not_allowed');
  }
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
    console.error('[oauth] Shopify token error:', tokenRes.status, errText);
    return res.redirect(302, '/app/login?error=shopify_token');
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData && tokenData.access_token;
  const scope = (tokenData && tokenData.scope) || '';
  const now = Date.now();
  let oauthEmail = null;
  let oauthUserId = null;
  if (accessToken) {
    try {
      const db = getDb();
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
      try {
        const userRes = await fetch(`https://${shopNorm}/admin/api/2024-01/users/current.json`, {
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
              const meta = buildMetaFromRequest(req);
              await users.updateLoginMeta(email, meta, { now });
            }
            await getDb().run(
              'UPDATE shop_sessions SET last_oauth_email = ?, last_oauth_user_id = ?, last_oauth_at = ? WHERE shop = ?',
              [oauthEmail, oauthUserId, now, shopNorm]
            );
            try {
              await shopOauthIdentities.upsertIdentity({ shop: shopNorm, email: oauthEmail, shopifyUserId: oauthUserId, now });
            } catch (_) {}
          }
        }
      } catch (_) {}
      try {
        const endMs = now;
        const startMs = endMs - 48 * 60 * 60 * 1000;
        setTimeout(() => {
          salesTruth.reconcileRange(shopNorm, startMs, endMs, 'today').catch(warnOnReject('[oauthLogin] reconcileRange'));
        }, 0);
      } catch (_) {}
    } catch (err) {
      console.error('[oauth] Failed to persist Shopify access token:', err);
    }
  }
  const payload = oauthEmail ? { email: oauthEmail } : { shop: shopNorm };
  const token = signOauthSession(payload);
  if (!token) {
    return res.redirect(302, '/app/login?error=session');
  }
  setOauthCookie(res, token);
  res.redirect(302, redirect);
}

module.exports = {
  handleGoogleRedirect,
  handleGoogleCallback,
  handleShopifyLoginRedirect,
  handleShopifyLoginCallback,
  clearOauthCookie,
};
