/**
 * Dashboard access:
 * - From Shopify admin (Referer/Origin): always allowed (no login).
 * - Direct visit (e.g. Railway URL): require Google OAuth session cookie.
 * No DASHBOARD_SECRET or password; Google-only for direct access.
 */

const crypto = require('crypto');
const config = require('../config');

const COOKIE_NAME = 'dashboard_session';
const SESSION_HOURS = 24;

function isShopifyAdminOrigin(req) {
  const origin = (req.get('Origin') || '').trim();
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (
      u.hostname === 'admin.shopify.com' ||
      u.hostname.endsWith('.myshopify.com')
    );
  } catch (_) {
    return false;
  }
}

function isShopifyAdminReferer(req) {
  const referer = (req.get('Referer') || req.get('referer') || '').trim();
  if (!referer) return false;
  const prefix = (config.allowedAdminRefererPrefix || '').trim();
  if (prefix) {
    // Restrict to your store's admin URL only (e.g. https://admin.shopify.com/store/943925-c1)
    return referer === prefix || referer.startsWith(prefix + '/');
  }
  try {
    const u = new URL(referer);
    return (
      u.hostname === 'admin.shopify.com' ||
      (u.hostname.endsWith('.myshopify.com') && u.pathname.startsWith('/admin'))
    );
  } catch (_) {
    return false;
  }
}

function signSession(expiryMs) {
  const secret = config.dashboardSecret;
  const msg = String(expiryMs);
  const h = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  return Buffer.from(JSON.stringify({ t: expiryMs, h })).toString('base64url');
}

function verifySession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const secret = config.dashboardSecret;
  if (!secret) return false;
  try {
    const raw = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8'));
    const { t, h } = raw;
    if (typeof t !== 'number' || typeof h !== 'string') return false;
    if (t < Date.now()) return false; // expired
    const expected = crypto.createHmac('sha256', secret).update(String(t)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    return false;
  }
}

function isProtectedPath(pathname) {
  if (pathname === '/app/login' || pathname === '/app/logout') return true;
  if (pathname.startsWith('/api/sessions') || pathname.startsWith('/api/stream') ||
      pathname.startsWith('/api/settings') || pathname === '/api/config-status' ||
      pathname === '/api/stats' || pathname.startsWith('/api/pixel') ||
      pathname.startsWith('/api/shopify-') || pathname === '/api/worst-products' ||
      pathname === '/api/insights-variants' || pathname.startsWith('/api/insights-variants-suggestions') ||
      // Ads tab API (new feature area)
      pathname.startsWith('/api/ads') ||
      pathname.startsWith('/api/traffic') || pathname === '/api/latest-sale' ||
      pathname === '/api/available-days') return true;
  const protectedPages = new Set([
    '/dashboard',
    '/dashboard/overview',
    '/dashboard/live',
    '/dashboard/sales',
    '/dashboard/table',
    '/insights/countries',
    '/insights/products',
    '/insights/variants',
    '/traffic',
    '/traffic/channels',
    '/traffic/device',
    '/integrations',
    '/integrations/google-ads',
    '/tools',
    '/tools/ads',
    '/tools/compare-conversion-rate',
    '/settings',
    // Legacy flat routes retained as protected redirect endpoints.
    '/overview',
    '/live',
    '/sales',
    '/date',
    '/countries',
    '/products',
    '/variants',
    '/channels',
    '/type',
    '/ads',
    '/compare-conversion-rate',
  ]);
  if (protectedPages.has(pathname)) return true;
  return false;
}

const OAUTH_COOKIE_NAME = 'oauth_session';

function requiresAuth(pathname, method) {
  if (pathname === '/app/login' || pathname === '/app/logout') return false;
  if (pathname === '/auth/google' || pathname === '/auth/google/callback') return false;
  if (pathname === '/auth/shopify-login' || pathname === '/auth/shopify-login/callback') return false;
  if (pathname === '/api/ads/google/callback') return false;
  // Public: ingest URL the server would push (for scripts / curl to verify before pixel ensure)
  if (pathname === '/api/pixel/config') return false;
  return isProtectedPath(pathname);
}

function getCookie(req, name) {
  const raw = req.get('Cookie') || req.get('cookie') || '';
  const parts = raw.split(';').map(s => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1'));
    }
  }
  return undefined;
}

function signOauthSession(payload) {
  const secret = config.oauthCookieSecret;
  if (!secret) return null;
  const t = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const parts = ['t=' + t];
  if (payload.email) parts.push('email=' + payload.email);
  if (payload.shop) parts.push('shop=' + payload.shop);
  const msg = parts.join('&');
  const h = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  return Buffer.from(JSON.stringify({ t, h, ...payload })).toString('base64url');
}

function verifyOauthSession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return false;
  const secret = config.oauthCookieSecret;
  if (!secret) return false;
  try {
    const raw = JSON.parse(Buffer.from(cookieValue, 'base64url').toString('utf8'));
    const { t, h, email, shop } = raw;
    if (typeof t !== 'number' || typeof h !== 'string') return false;
    if (t < Date.now()) return false;
    const parts = ['t=' + t];
    if (email) parts.push('email=' + email);
    if (shop) parts.push('shop=' + shop);
    const msg = parts.join('&');
    const expected = crypto.createHmac('sha256', secret).update(msg).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(expected, 'hex'));
  } catch (_) {
    return false;
  }
}

function verifyShopifyHmac(query) {
  const apiSecret = (config.shopify && config.shopify.apiSecret) ? String(config.shopify.apiSecret) : '';
  if (!apiSecret) return false;
  const q = (query && typeof query === 'object') ? query : {};
  const hmac = (q.hmac != null) ? String(q.hmac) : '';
  if (!hmac) return false;
  const rest = {};
  for (const k of Object.keys(q)) {
    if (k === 'hmac') continue;
    rest[k] = q[k];
  }
  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join('&');
  const digest = crypto.createHmac('sha256', apiSecret).update(message).digest('hex');
  try {
    const a = Buffer.from(hmac, 'hex');
    const b = Buffer.from(digest, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function isShopifySignedAppUrlRequest(req) {
  if (!req || req.method !== 'GET') return false;
  // Only treat signed query params as auth for UI page loads (not API calls).
  if (typeof req.path === 'string' && req.path.startsWith('/api/')) return false;
  const q = req.query || {};
  const shopNorm = String(q.shop || '').trim().toLowerCase();
  if (!shopNorm) return false;
  if (!q.hmac || !q.timestamp) return false;
  const shopMatch = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shopNorm);
  if (!shopMatch) return false;
  return verifyShopifyHmac(q);
}

function hostNoPort(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return '';
  // IPv6 in Host can be "[::1]:3000" – keep bracketed host.
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end >= 0 ? h.slice(0, end + 1) : h;
  }
  return h.split(':')[0];
}

/**
 * Embedded app API calls won't have the signed query params, but their Referer will be the
 * signed App URL (/?shop=...&host=...&hmac=...&timestamp=...). Verify that HMAC.
 */
function isShopifySignedAppUrlReferer(req) {
  const referer = (req.get('Referer') || req.get('referer') || '').trim();
  if (!referer) return false;
  try {
    const u = new URL(referer);
    // Only accept a signed referer from *this* host.
    const reqHost = hostNoPort(req.get('host') || req.get('x-forwarded-host'));
    const refHost = hostNoPort(u.host);
    if (reqHost && refHost && reqHost !== refHost) return false;
    // Embedded app navigation can be on canonical dashboard paths (and legacy redirects). Accept any path with valid signed query.
    if (!u.search || u.search.length < 5) return false;
    const q = {};
    for (const [k, v] of u.searchParams.entries()) {
      if (!k) continue;
      q[k] = v;
    }
    const shopNorm = String(q.shop || '').trim().toLowerCase();
    if (!shopNorm) return false;
    if (!q.hmac || !q.timestamp) return false;
    const shopMatch = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shopNorm);
    if (!shopMatch) return false;
    return verifyShopifyHmac(q);
  } catch (_) {
    return false;
  }
}

function allow(req) {
  const hasGoogle = !!(config.googleClientId && config.googleClientSecret);
  // From Shopify admin: always allow (embed / open from Admin)
  if (isShopifyAdminReferer(req) || isShopifyAdminOrigin(req)) return true;
  // Embedded app load: allow signed Shopify App URL requests even if Referer/Origin are stripped.
  if (isShopifySignedAppUrlRequest(req)) return true;
  // Embedded app API/XHR/SSE: allow when Referer is a signed Shopify App URL.
  if (isShopifySignedAppUrlReferer(req)) return true;
  // Direct visit: require Google OAuth session when Google is configured
  if (hasGoogle) {
    const oauthCookie = getCookie(req, OAUTH_COOKIE_NAME);
    return !!(oauthCookie && verifyOauthSession(oauthCookie));
  }
  // No Google configured: allow only in non-production (e.g. local dev).
  // In production, fail-closed for direct visits (still allows Shopify Admin embeds above).
  if (process.env.NODE_ENV === 'production') return false;
  return true;
}

function middleware(req, res, next) {
  if (!requiresAuth(req.path, req.method)) return next();
  if (allow(req)) return next();

  const isApi = req.path.startsWith('/api/');
  if (isApi) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.redirect(302, '/app/login');
}

module.exports = {
  middleware,
  COOKIE_NAME,
  OAUTH_COOKIE_NAME,
  SESSION_HOURS,
  signSession,
  verifySession,
  signOauthSession,
  verifyOauthSession,
};
