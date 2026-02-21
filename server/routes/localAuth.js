/**
 * Local auth (email + password).
 *
 * - POST /auth/local/register -> creates a PENDING user (awaiting approval)
 * - POST /auth/local/login    -> allows ACTIVE/MASTER users only
 *
 * NOTE: This does not replace Shopify OAuth (install/scopes); it is for dashboard access control.
 */
const crypto = require('crypto');
const config = require('../config');
const users = require('../usersService');
const dashboardAuth = require('../middleware/dashboardAuth');
const notificationsService = require('../notificationsService');

let geoip;
try {
  geoip = require('geoip-lite');
} catch (_) {
  geoip = null;
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

function normalizeSafeRedirectPath(value) {
  const raw = value != null ? String(value).trim() : '';
  if (!raw) return '/dashboard/overview';
  if (!raw.startsWith('/')) return '/dashboard/overview';
  if (raw.startsWith('//')) return '/dashboard/overview';
  if (raw.includes('://')) return '/dashboard/overview';
  return raw;
}

function setOauthCookie(res, value, maxAgeSecOverride) {
  const maxAge = Number.isFinite(Number(maxAgeSecOverride)) && Number(maxAgeSecOverride) > 0
    ? Math.trunc(Number(maxAgeSecOverride))
    : (dashboardAuth.SESSION_HOURS * 60 * 60);
  let set = `${dashboardAuth.OAUTH_COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=lax; HttpOnly`;
  if (config.nodeEnv === 'production') set += '; Secure';
  res.setHeader('Set-Cookie', set);
}

function scryptAsync(password, salt, keylen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, opts || {}, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const keylen = 64;
  const derived = await scryptAsync(String(password), salt, keylen, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$N=16384,r=8,p=1$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const raw = stored != null ? String(stored) : '';
  if (!raw.startsWith('scrypt$')) return false;
  const parts = raw.split('$');
  if (parts.length !== 4) return false;
  const params = parts[1] || '';
  const saltB64 = parts[2] || '';
  const hashB64 = parts[3] || '';
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (!salt.length || !expected.length) return false;

  let N = 16384; let r = 8; let p = 1;
  try {
    params.split(',').forEach((kv) => {
      const [k, v] = kv.split('=');
      const n = parseInt(v, 10);
      if (k === 'N' && Number.isFinite(n)) N = n;
      if (k === 'r' && Number.isFinite(n)) r = n;
      if (k === 'p' && Number.isFinite(n)) p = n;
    });
  } catch (_) {}

  const derived = await scryptAsync(String(password), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  try {
    return crypto.timingSafeEqual(Buffer.from(derived), expected);
  } catch (_) {
    return false;
  }
}

function readForm(req) {
  const body = (req && req.body && typeof req.body === 'object') ? req.body : {};
  const email = body.email != null ? String(body.email).trim() : '';
  const password = body.password != null ? String(body.password) : '';
  const redirect = body.redirect != null ? String(body.redirect).trim() : '';
  const remember = body.remember != null ? String(body.remember).trim() : '';
  const terms = body.terms != null ? String(body.terms).trim() : '';
  return { email, password, redirect, remember, terms };
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

async function postRegister(req, res) {
  // Allow disabling local signup in future; for now it is enabled by default.
  void config;
  const { email, password, redirect, terms } = readForm(req);
  const safeRedirect = normalizeSafeRedirectPath(redirect);
  const acceptedTerms = terms === '1' || terms === 'on' || terms === 'true' || terms === 'yes';
  if (!acceptedTerms) {
    return res.redirect(302, '/app/register?error=terms_required&redirect=' + encodeURIComponent(safeRedirect));
  }
  const e = users.normalizeEmail(email);
  if (!e) return res.redirect(302, '/app/register?error=invalid_email&redirect=' + encodeURIComponent(safeRedirect));
  if (!password || String(password).length < 8) return res.redirect(302, '/app/register?error=weak_password&redirect=' + encodeURIComponent(safeRedirect));

  const meta = buildMetaFromRequest(req);
  const passwordHash = await hashPassword(password);
  const r = await users.createPendingUser(e, passwordHash, meta, { now: Date.now() });
  if (!r || r.ok !== true) {
    const err = (r && r.error) ? String(r.error) : 'register_failed';
    return res.redirect(302, '/app/register?error=' + encodeURIComponent(err) + '&redirect=' + encodeURIComponent(safeRedirect));
  }
  try {
    const prefs = await notificationsService.getPreferences();
    if (prefs.pending_signup !== false) {
      await notificationsService.create({
        type: 'pending_signup',
        title: 'New sign-up pending approval',
        body: e,
        forAdminOnly: true,
      });
    }
  } catch (_) {}
  return res.redirect(302, '/app/login?registered=1&redirect=' + encodeURIComponent(safeRedirect));
}

async function postLogin(req, res) {
  const { email, password, redirect, remember } = readForm(req);
  const safeRedirect = normalizeSafeRedirectPath(redirect);
  const e = users.normalizeEmail(email);
  if (!e || !password) return res.redirect(302, '/app/login?error=invalid_credentials&redirect=' + encodeURIComponent(safeRedirect));

  // Seed master: ensure exists, allow even without password (but still require password for local auth unless you set one).
  if (users.isBootstrapMasterEmail(e)) {
    try { await users.ensureBootstrapMaster(e); } catch (_) {}
  }

  const row = await users.getUserByEmail(e);
  if (!row) return res.redirect(302, '/app/login?error=invalid_credentials&redirect=' + encodeURIComponent(safeRedirect));

  const status = row.status != null ? String(row.status).trim().toLowerCase() : '';
  if (status === 'pending') return res.redirect(302, '/app/login?error=pending&redirect=' + encodeURIComponent(safeRedirect));
  if (status === 'denied') return res.redirect(302, '/app/login?error=denied&redirect=' + encodeURIComponent(safeRedirect));

  const storedHash = row.password_hash != null ? String(row.password_hash) : '';
  const ok = storedHash ? await verifyPassword(password, storedHash) : false;
  if (!ok) return res.redirect(302, '/app/login?error=invalid_credentials&redirect=' + encodeURIComponent(safeRedirect));

  const rememberMe = remember === '1' || remember === 'on' || remember === 'true' || remember === 'yes';
  const rememberTtlMs = 30 * 24 * 60 * 60 * 1000;
  const token = dashboardAuth.signOauthSession({ email: e }, rememberMe ? { ttlMs: rememberTtlMs } : undefined);
  if (!token) return res.redirect(302, '/app/login?error=session&redirect=' + encodeURIComponent(safeRedirect));
  const maxAgeSec = rememberMe ? Math.trunc(rememberTtlMs / 1000) : (dashboardAuth.SESSION_HOURS * 60 * 60);
  setOauthCookie(res, token, maxAgeSec);

  // Track login metadata for Admin -> Users.
  try {
    const meta = buildMetaFromRequest(req);
    await users.updateLoginMeta(e, meta, { now: Date.now() });
  } catch (_) {}

  return res.redirect(302, safeRedirect);
}

module.exports = {
  postRegister,
  postLogin,
};

