/**
 * Repository: visitors, sessions, events, settings, purchases.
 * All timestamps in epoch ms.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const config = require('./config');
const fx = require('./fx');
const salesTruth = require('./salesTruth');
const shopifyQl = require('./shopifyQl');

const ALLOWED_EVENT_TYPES = new Set([
  'page_viewed', 'product_viewed', 'product_added_to_cart', 'product_removed_from_cart',
  'cart_updated', 'cart_viewed', 'checkout_started', 'checkout_completed', 'heartbeat',
]);

const WHITELIST = new Set([
  'visitor_id', 'session_id', 'event_type', 'path', 'product_handle', 'product_title',
  'variant_title', 'quantity_delta', 'price', 'cart_qty', 'cart_value', 'cart_currency',
  'order_total', 'order_currency', 'checkout_started', 'checkout_completed',
  'order_id', 'checkout_token',
  'country_code', 'device', 'network_speed', 'ts', 'customer_privacy_debug',
  'ua_device_type', 'ua_platform', 'ua_model',
  'utm_campaign', 'utm_source', 'utm_medium', 'utm_content',
  'referrer',
  'entry_url',
]);

function sanitize(payload) {
  const out = {};
  for (const key of Object.keys(payload)) {
    if (WHITELIST.has(key)) out[key] = payload[key];
  }
  return out;
}

function truthy(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  return false;
}

function isCheckoutStartedPayload(payload) {
  const type = typeof payload?.event_type === 'string' ? payload.event_type : '';
  return truthy(payload?.checkout_started) || type === 'checkout_started';
}

function isCheckoutCompletedPayload(payload) {
  const type = typeof payload?.event_type === 'string' ? payload.event_type : '';
  return truthy(payload?.checkout_completed) || type === 'checkout_completed';
}

function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const c = value.trim().toUpperCase();
  if (c.length !== 2 || c === 'XX' || c === 'T1') return null;
  return c;
}

function trimLower(v, maxLen = 256) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const out = s.length > maxLen ? s.slice(0, maxLen) : s;
  return out.toLowerCase();
}

function safeUrlHost(url) {
  if (typeof url !== 'string') return '';
  const raw = url.trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    // Handle schemeless URLs like "example.com/path"
    try {
      return new URL('https://' + raw).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }
}

function safeUrlParams(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    return new URL(raw).searchParams;
  } catch (_) {
    try {
      return new URL('https://' + raw).searchParams;
    } catch (_) {
      return null;
    }
  }
}

let _internalHostsCache = null;
function internalHostSet() {
  if (_internalHostsCache) return _internalHostsCache;
  const set = new Set();
  function addHostFromUrl(url) {
    if (!url || typeof url !== 'string') return;
    try { set.add(new URL(url).hostname.toLowerCase()); } catch (_) {}
  }
  function addHost(host) {
    const h = typeof host === 'string' ? host.trim().toLowerCase() : '';
    if (!h) return;
    // Config may be "domain" or "https://domain"
    try { set.add(new URL(h.startsWith('http') ? h : ('https://' + h)).hostname.toLowerCase()); } catch (_) {}
  }
  addHost(config.shopDomain);
  addHost(config.allowedShopDomain);
  addHostFromUrl(config.storeMainDomain);
  // Shopify checkout/self-referral sources
  set.add('checkout.shopify.com');
  set.add('shopify.com');
  _internalHostsCache = set;
  return set;
}

function isInternalHost(hostname) {
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
  if (!host) return false;
  const set = internalHostSet();
  for (const h of set) {
    if (!h) continue;
    if (host === h) return true;
    if (host.endsWith('.' + h)) return true;
  }
  return false;
}

function isPaidMedium(m) {
  const s = trimLower(m, 64) || '';
  if (!s) return false;
  if (s === 'cpc' || s === 'ppc' || s === 'paid' || s === 'paidsearch' || s === 'paid_search') return true;
  if (s.includes('cpc') || s.includes('ppc') || s.includes('paid')) return true;
  return false;
}

/**
 * Derive a stable source key using:
 * - Shopify pixel UTMs (utm_source/utm_medium/etc)
 * - Cloudflare/Worker fallback entry_url/referrer (including click IDs like gclid)
 */
function deriveTrafficSourceKey({ utmSource, utmMedium, utmCampaign, utmContent, referrer, entryUrl } = {}) {
  const us = trimLower(utmSource, 128) || '';
  const um = trimLower(utmMedium, 64) || '';
  const uc = trimLower(utmCampaign, 128) || '';
  const ucon = trimLower(utmContent, 128) || '';

  const refHost = safeUrlHost(referrer || '');
  const entryParams = safeUrlParams(entryUrl || '');

  const hasGclid = !!(entryParams && (entryParams.get('gclid') || entryParams.get('gbraid') || entryParams.get('wbraid')));
  const hasMsclkid = !!(entryParams && entryParams.get('msclkid'));
  const hasFbclid = !!(entryParams && entryParams.get('fbclid'));
  const paid = isPaidMedium(um);

  // 1) Explicit UTMs win (Shopify pixel)
  if (us.includes('omnisend') || (um === 'email' && (us.includes('omnisend') || uc.includes('omnisend') || ucon.includes('omnisend')))) {
    return 'omnisend';
  }
  if (us.includes('google') || us.includes('googleads') || us.includes('adwords')) {
    if (paid || hasGclid) return 'google_ads';
    return 'google_organic';
  }
  if (us.includes('bing') || us.includes('microsoft')) {
    if (paid || hasMsclkid) return 'bing_ads';
    return 'bing_organic';
  }
  if (us.includes('facebook') || us === 'fb' || us.includes('instagram')) {
    if (paid || hasFbclid) return 'facebook_ads';
    return 'facebook_organic';
  }

  // 2) Click IDs (Cloudflare/Worker entry_url)
  if (hasGclid) return 'google_ads';
  if (hasMsclkid) return 'bing_ads';
  if (hasFbclid) return 'facebook_ads';

  // 3) Referrer host (Cloudflare/Worker fallback)
  if (refHost && !isInternalHost(refHost)) {
    if (refHost.includes('google.')) return 'google_organic';
    if (refHost.endsWith('bing.com') || refHost.endsWith('search.msn.com') || refHost.includes('bing.')) return 'bing_organic';
    if (
      refHost.endsWith('facebook.com') ||
      refHost === 'l.facebook.com' ||
      refHost === 'm.facebook.com' ||
      refHost === 'lm.facebook.com'
    ) {
      return 'facebook_organic';
    }
  }

  // 4) Direct / internal
  const hasAnyUtm = !!(us || um || uc || ucon);
  if (!hasAnyUtm && (!refHost || isInternalHost(refHost))) return 'direct';

  return null;
}

function normalizeUaDeviceType(v) {
  const s = trimLower(v, 16);
  if (s === 'desktop' || s === 'mobile' || s === 'tablet') return s;
  return null;
}

function normalizeUaPlatform(v) {
  const s = trimLower(v, 16);
  if (!s) return null;
  if (s === 'windows' || s === 'mac' || s === 'ios' || s === 'android' || s === 'chromeos' || s === 'linux' || s === 'other') return s;
  return null;
}

function normalizeUaModel(v) {
  const s = trimLower(v, 16);
  if (s === 'iphone' || s === 'ipad') return s;
  return null;
}

async function getSetting(key) {
  const db = getDb();
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  const db = getDb();
  if (config.dbUrl) {
    await db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
  } else {
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }
}

// Reporting sources (used to switch between Shopify truth vs pixel-derived reporting)
const REPORTING_ORDERS_SOURCE_KEY = 'reporting_orders_source'; // orders_shopify | pixel
const REPORTING_SESSIONS_SOURCE_KEY = 'reporting_sessions_source'; // sessions | shopify_sessions

function normalizeReportingOrdersSource(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  if (s === 'orders_shopify' || s === 'pixel') return s;
  return null;
}

function normalizeReportingSessionsSource(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  if (s === 'sessions' || s === 'shopify_sessions') return s;
  return null;
}

async function getReportingConfig() {
  const rawOrders = await getSetting(REPORTING_ORDERS_SOURCE_KEY);
  const rawSessions = await getSetting(REPORTING_SESSIONS_SOURCE_KEY);
  const ordersSource = normalizeReportingOrdersSource(rawOrders) || 'orders_shopify';
  const sessionsSource = normalizeReportingSessionsSource(rawSessions) || 'sessions';
  return { ordersSource, sessionsSource };
}

async function isTrackingEnabled() {
  const v = await getSetting('tracking_enabled');
  if (v === null) return config.trackingDefaultEnabled;
  return v === 'true' || v === '1';
}

async function getVisitor(visitorId) {
  const db = getDb();
  return db.get('SELECT * FROM visitors WHERE visitor_id = ?', [visitorId]);
}

async function upsertVisitor(payload) {
  const db = getDb();
  const now = payload.ts || Date.now();
  const normalizedCountry = normalizeCountry(payload.country_code);
  const existing = await db.get('SELECT visitor_id, last_seen, first_seen FROM visitors WHERE visitor_id = ?', [payload.visitor_id]);
  const isReturning = existing ? (now - existing.last_seen > config.returningGapMinutes * 60 * 1000) : false;
  const returningCount = existing ? (existing.returning_count || 0) + (isReturning ? 1 : 0) : 0;
  const firstSeen = existing && existing.first_seen != null ? existing.first_seen : now;

  if (config.dbUrl) {
    await db.run(`
      INSERT INTO visitors (visitor_id, first_seen, last_seen, last_country, device, network_speed, is_returning, returning_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (visitor_id) DO UPDATE SET
        last_seen = $3, last_country = COALESCE($4, visitors.last_country), device = COALESCE($5, visitors.device),
        network_speed = COALESCE($6, visitors.network_speed), is_returning = $7, returning_count = $8
    `, [
      payload.visitor_id,
      firstSeen,
      now,
      normalizedCountry,
      payload.device ?? null,
      payload.network_speed ?? null,
      isReturning ? 1 : 0,
      returningCount,
    ]);
  } else {
    if (existing) {
      await db.run(`
        UPDATE visitors SET last_seen = ?, last_country = COALESCE(?, last_country), device = COALESCE(?, device),
        network_speed = COALESCE(?, network_speed), is_returning = ?, returning_count = ? WHERE visitor_id = ?
      `, [now, normalizedCountry, payload.device, payload.network_speed, isReturning ? 1 : 0, returningCount, payload.visitor_id]);
    } else {
      await db.run(`
        INSERT INTO visitors (visitor_id, first_seen, last_seen, last_country, device, network_speed, is_returning, returning_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [payload.visitor_id, now, now, normalizedCountry, payload.device ?? null, payload.network_speed ?? null, 0, 0]);
    }
  }
  return { isReturning };
}

async function getSession(sessionId) {
  const db = getDb();
  return db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
}

function parseCfContext(cfContext) {
  if (!cfContext) return { cfKnownBot: null, cfVerifiedBotCategory: null, cfCountry: null, cfColo: null, cfAsn: null };
  const knownBot = cfContext.cf_known_bot;
  const cfKnownBot = knownBot === '1' || knownBot === true ? 1 : (knownBot === '0' || knownBot === false ? 0 : null);
  return {
    cfKnownBot,
    cfVerifiedBotCategory: cfContext.cf_verified_bot_category && String(cfContext.cf_verified_bot_category).trim() ? String(cfContext.cf_verified_bot_category).trim().slice(0, 128) : null,
    cfCountry: cfContext.cf_country && String(cfContext.cf_country).trim().length === 2 ? String(cfContext.cf_country).trim().toUpperCase() : null,
    cfColo: cfContext.cf_colo && String(cfContext.cf_colo).trim() ? String(cfContext.cf_colo).trim().slice(0, 32) : null,
    cfAsn: cfContext.cf_asn != null && String(cfContext.cf_asn).trim() ? String(cfContext.cf_asn).trim().slice(0, 32) : null,
  };
}

async function upsertSession(payload, visitorIsReturning, cfContext) {
  const db = getDb();
  const now = payload.ts || Date.now();
  const existing = await db.get('SELECT * FROM sessions WHERE session_id = ?', [payload.session_id]);
  const normalizedCountry = normalizeCountry(payload.country_code);
  const cf = parseCfContext(cfContext);
  const checkoutCompleted = isCheckoutCompletedPayload(payload);
  const checkoutStarted = isCheckoutStartedPayload(payload);
  let purchasedAt = typeof existing?.purchased_at === 'number' ? existing.purchased_at : null;
  if (checkoutCompleted && !purchasedAt) {
    purchasedAt = now;
  }

  let cartQty = payload.cart_qty;
  if (cartQty === undefined && existing) cartQty = existing.cart_qty;
  if (cartQty === undefined) cartQty = 0;

  let isCheckingOut = existing?.is_checking_out || (checkoutStarted ? 1 : 0) || 0;
  let checkoutStartedAt = existing?.checkout_started_at || (checkoutStarted ? now : null);
  if (checkoutCompleted) {
    isCheckingOut = 0;
    checkoutStartedAt = null;
  }
  if (checkoutStarted) {
    isCheckingOut = 1;
    checkoutStartedAt = now;
  }
  const checkoutWindowMs = config.checkoutStartedWindowMinutes * 60 * 1000;
  if (checkoutStartedAt && (now - checkoutStartedAt) > checkoutWindowMs) {
    isCheckingOut = 0;
  }

  const hasPurchased = existing?.has_purchased || (checkoutCompleted ? 1 : 0) || 0;
  const lastPath = payload.path ?? existing?.last_path ?? null;
  const lastProductHandle = payload.product_handle ?? existing?.last_product_handle ?? null;

  let cartValue = payload.cart_value;
  if (cartValue === undefined && existing?.cart_value != null) cartValue = existing.cart_value;
  if (typeof cartValue === 'string') cartValue = parseFloat(cartValue);
  if (typeof cartValue !== 'number' || Number.isNaN(cartValue)) cartValue = null;
  const cartCurrency = typeof payload.cart_currency === 'string' ? payload.cart_currency : (existing?.cart_currency ?? null);

  let orderTotal = payload.order_total;
  let orderCurrency = payload.order_currency;
  if (checkoutCompleted && (payload.order_total != null || payload.order_currency != null)) {
    if (typeof payload.order_total === 'number') orderTotal = payload.order_total;
    else if (typeof payload.order_total === 'string') {
      const parsed = parseFloat(payload.order_total);
      if (!Number.isNaN(parsed)) orderTotal = parsed;
    }
    if (typeof payload.order_currency === 'string') orderCurrency = payload.order_currency;
  }
  if (orderTotal === undefined && existing?.order_total != null) orderTotal = existing.order_total;
  if (orderCurrency === undefined && existing?.order_currency) orderCurrency = existing.order_currency;
  if (typeof orderTotal !== 'number' || Number.isNaN(orderTotal)) orderTotal = null;
  if (typeof orderCurrency !== 'string') orderCurrency = null;

  const trimUtm = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const utmCampaign = trimUtm(payload.utm_campaign) ?? existing?.utm_campaign ?? null;
  const utmSource = trimUtm(payload.utm_source) ?? existing?.utm_source ?? null;
  const utmMedium = trimUtm(payload.utm_medium) ?? existing?.utm_medium ?? null;
  const utmContent = trimUtm(payload.utm_content) ?? existing?.utm_content ?? null;

  const trimUrl = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2048) : null);
  const referrer = trimUrl(payload.referrer) ?? existing?.referrer ?? null;
  const hasExistingReferrer = existing?.referrer != null && String(existing.referrer).trim() !== '';
  const updateReferrer = hasExistingReferrer ? null : (trimUrl(payload.referrer) ?? null);

  const entryUrl = trimUrl(payload.entry_url) ?? existing?.entry_url ?? null;
  const hasExistingEntryUrl = existing?.entry_url != null && String(existing.entry_url).trim() !== '';
  const updateEntryUrl = hasExistingEntryUrl ? null : (trimUrl(payload.entry_url) ?? null);

  const trafficSourceKey = deriveTrafficSourceKey({
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    referrer,
    entryUrl,
  });
  const uaDeviceType = normalizeUaDeviceType(payload.ua_device_type);
  const uaPlatform = normalizeUaPlatform(payload.ua_platform);
  const uaModel = normalizeUaModel(payload.ua_model);

  const cfKnownBot = cf.cfKnownBot != null ? cf.cfKnownBot : null;
  const cfVerifiedBotCategory = cf.cfVerifiedBotCategory;
  const cfCountry = cf.cfCountry;
  const cfColo = cf.cfColo;
  const cfAsn = cf.cfAsn;
  const isReturningSession = visitorIsReturning ? 1 : 0;

  if (!existing) {
    if (config.dbUrl) {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, is_returning, traffic_source_key, ua_device_type, ua_platform, ua_model)
        VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 0, NULL, NULL, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
        ON CONFLICT (session_id) DO UPDATE SET
          visitor_id = EXCLUDED.visitor_id,
          started_at = EXCLUDED.started_at,
          last_seen = EXCLUDED.last_seen,
          last_path = EXCLUDED.last_path,
          last_product_handle = EXCLUDED.last_product_handle,
          first_path = EXCLUDED.first_path,
          first_product_handle = EXCLUDED.first_product_handle,
          cart_qty = EXCLUDED.cart_qty,
          cart_value = EXCLUDED.cart_value,
          cart_currency = EXCLUDED.cart_currency,
          order_total = EXCLUDED.order_total,
          order_currency = EXCLUDED.order_currency,
          country_code = EXCLUDED.country_code,
          utm_campaign = EXCLUDED.utm_campaign,
          utm_source = EXCLUDED.utm_source,
          utm_medium = EXCLUDED.utm_medium,
          utm_content = EXCLUDED.utm_content,
          referrer = EXCLUDED.referrer,
          entry_url = EXCLUDED.entry_url,
          is_checking_out = EXCLUDED.is_checking_out,
          checkout_started_at = EXCLUDED.checkout_started_at,
          has_purchased = EXCLUDED.has_purchased,
          purchased_at = EXCLUDED.purchased_at,
          is_abandoned = EXCLUDED.is_abandoned,
          abandoned_at = EXCLUDED.abandoned_at,
          recovered_at = EXCLUDED.recovered_at,
          cf_known_bot = EXCLUDED.cf_known_bot,
          cf_verified_bot_category = EXCLUDED.cf_verified_bot_category,
          cf_country = EXCLUDED.cf_country,
          cf_colo = EXCLUDED.cf_colo,
          cf_asn = EXCLUDED.cf_asn,
          traffic_source_key = COALESCE(EXCLUDED.traffic_source_key, sessions.traffic_source_key),
          ua_device_type = COALESCE(EXCLUDED.ua_device_type, sessions.ua_device_type),
          ua_platform = COALESCE(EXCLUDED.ua_platform, sessions.ua_platform),
          ua_model = COALESCE(EXCLUDED.ua_model, sessions.ua_model)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, isReturningSession, trafficSourceKey, uaDeviceType, uaPlatform, uaModel]);
    } else {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, is_returning, traffic_source_key, ua_device_type, ua_platform, ua_model)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, isReturningSession, trafficSourceKey, uaDeviceType, uaPlatform, uaModel]);
    }
  } else {
    const cfUpdates = [];
    const cfParams = [];
    let p = config.dbUrl ? 23 : 0;
    if (cfKnownBot != null) {
      cfUpdates.push(config.dbUrl ? `cf_known_bot = $${++p}` : 'cf_known_bot = ?');
      cfParams.push(cfKnownBot);
    }
    if (cfVerifiedBotCategory !== undefined && cfVerifiedBotCategory !== null) {
      cfUpdates.push(config.dbUrl ? `cf_verified_bot_category = $${++p}` : 'cf_verified_bot_category = ?');
      cfParams.push(cfVerifiedBotCategory);
    }
    if (cfCountry !== undefined && cfCountry !== null) {
      cfUpdates.push(config.dbUrl ? `cf_country = $${++p}` : 'cf_country = ?');
      cfParams.push(cfCountry);
    }
    if (cfColo !== undefined && cfColo !== null) {
      cfUpdates.push(config.dbUrl ? `cf_colo = $${++p}` : 'cf_colo = ?');
      cfParams.push(cfColo);
    }
    if (cfAsn !== undefined && cfAsn !== null) {
      cfUpdates.push(config.dbUrl ? `cf_asn = $${++p}` : 'cf_asn = ?');
      cfParams.push(cfAsn);
    }
    const cfSet = cfUpdates.length ? ', ' + cfUpdates.join(', ') : '';
    const sessionIdPlaceholder = config.dbUrl ? '$' + (24 + cfParams.length) : '?';
    if (config.dbUrl) {
      await db.run(`
        UPDATE sessions SET last_seen = $1, last_path = COALESCE($2, last_path), last_product_handle = COALESCE($3, last_product_handle),
        cart_qty = $4, cart_value = COALESCE($5, cart_value), cart_currency = COALESCE($6, cart_currency),
        order_total = COALESCE($7, order_total), order_currency = COALESCE($8, order_currency),
        country_code = COALESCE($9, country_code), utm_campaign = COALESCE($10, utm_campaign), utm_source = COALESCE($11, utm_source), utm_medium = COALESCE($12, utm_medium), utm_content = COALESCE($13, utm_content),
        referrer = COALESCE($14, referrer),
        entry_url = COALESCE($15, entry_url),
        is_checking_out = $16, checkout_started_at = $17, has_purchased = $18, purchased_at = COALESCE($19, purchased_at),
        traffic_source_key = COALESCE($20, traffic_source_key),
        ua_device_type = COALESCE($21, ua_device_type),
        ua_platform = COALESCE($22, ua_platform),
        ua_model = COALESCE($23, ua_model)
        ${cfSet}
        WHERE session_id = ${sessionIdPlaceholder}
      `, [now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, updateReferrer, updateEntryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, trafficSourceKey, uaDeviceType, uaPlatform, uaModel, ...cfParams, payload.session_id]);
    } else {
      const placeholders = [now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, updateReferrer, updateEntryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, trafficSourceKey, uaDeviceType, uaPlatform, uaModel, ...cfParams, payload.session_id];
      await db.run(`
        UPDATE sessions SET last_seen = ?, last_path = COALESCE(?, last_path), last_product_handle = COALESCE(?, last_product_handle),
        cart_qty = ?, cart_value = COALESCE(?, cart_value), cart_currency = COALESCE(?, cart_currency),
        order_total = COALESCE(?, order_total), order_currency = COALESCE(?, order_currency),
        country_code = COALESCE(?, country_code), utm_campaign = COALESCE(?, utm_campaign), utm_source = COALESCE(?, utm_source), utm_medium = COALESCE(?, utm_medium), utm_content = COALESCE(?, utm_content),
        referrer = COALESCE(?, referrer),
        entry_url = COALESCE(?, entry_url),
        is_checking_out = ?, checkout_started_at = ?, has_purchased = ?, purchased_at = COALESCE(?, purchased_at),
        traffic_source_key = COALESCE(?, traffic_source_key),
        ua_device_type = COALESCE(?, ua_device_type),
        ua_platform = COALESCE(?, ua_platform),
        ua_model = COALESCE(?, ua_model)
        ${cfSet}
        WHERE session_id = ?
      `, placeholders);
    }
  }

  await maybeMarkAbandoned(payload.session_id);
  return { sessionId: payload.session_id, visitorId: payload.visitor_id };
}

async function maybeMarkAbandoned(sessionId) {
  const db = getDb();
  const session = await db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (!session || session.has_purchased || session.is_abandoned) return;
  if (session.cart_qty <= 0) return;
  const cutoff = Date.now() - config.abandonedWindowMinutes * 60 * 1000;
  if (session.last_seen < cutoff) {
    if (config.dbUrl) {
      await db.run('UPDATE sessions SET is_abandoned = 1, abandoned_at = ? WHERE session_id = ?', [Date.now(), sessionId]);
    } else {
      await db.run('UPDATE sessions SET is_abandoned = 1, abandoned_at = ? WHERE session_id = ?', [Date.now(), sessionId]);
    }
  }
}

async function insertEvent(sessionId, payload) {
  const db = getDb();
  const ts = payload.ts || Date.now();
  const type = payload.event_type || 'heartbeat';
  if (!ALLOWED_EVENT_TYPES.has(type)) return;

  const checkoutStarted = isCheckoutStartedPayload(payload);
  const checkoutCompleted = isCheckoutCompletedPayload(payload);
  const checkoutState = (payload.checkout_started != null || payload.checkout_completed != null || checkoutStarted || checkoutCompleted)
    ? JSON.stringify({ checkout_started: checkoutStarted, checkout_completed: checkoutCompleted })
    : null;
  const meta = payload.customer_privacy_debug ? JSON.stringify(payload.customer_privacy_debug) : null;

  if (config.dbUrl) {
    const r = await db.run(`
      INSERT INTO events (session_id, ts, type, path, product_handle, qty_delta, cart_qty, checkout_state_json, meta_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [sessionId, ts, type, payload.path ?? null, payload.product_handle ?? null, payload.quantity_delta ?? null, payload.cart_qty ?? null, checkoutState, meta]);
  } else {
    await db.run(`
      INSERT INTO events (session_id, ts, type, path, product_handle, qty_delta, cart_qty, checkout_state_json, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [sessionId, ts, type, payload.path ?? null, payload.product_handle ?? null, payload.quantity_delta ?? null, payload.cart_qty ?? null, checkoutState, meta]);
  }
}

function computePurchaseKey(payload, sessionId) {
  const orderId = payload.order_id != null && String(payload.order_id).trim() !== '' ? String(payload.order_id).trim() : null;
  const token = payload.checkout_token != null && String(payload.checkout_token).trim() !== '' ? String(payload.checkout_token).trim() : null;
  // Prefer checkout_token because Shopify can emit checkout_completed once before order_id exists,
  // and again after the order is created. Both events share the same checkout_token.
  if (token) return 'token:' + token;
  if (orderId) return 'order:' + orderId;
  // 15-min bucket so multiple checkout_completed events for same order (e.g. thank-you reload) dedupe
  const ts = payload.ts || Date.now();
  const round15Min = Math.floor(ts / (15 * 60000));
  const cur = (payload.order_currency || '').toString();
  const tot = payload.order_total != null ? String(payload.order_total) : '';
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + round15Min + '|' + sessionId).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function insertPurchase(payload, sessionId, countryCode) {
  if (!isCheckoutCompletedPayload(payload)) return;
  const db = getDb();
  const now = payload.ts || Date.now();
  const purchaseKey = computePurchaseKey(payload, sessionId);
  const orderTotal = payload.order_total != null ? (typeof payload.order_total === 'number' ? payload.order_total : parseFloat(payload.order_total)) : null;
  const orderCurrency = typeof payload.order_currency === 'string' && payload.order_currency.trim() ? payload.order_currency.trim() : null;
  const orderId = payload.order_id != null && String(payload.order_id).trim() !== '' ? String(payload.order_id).trim() : null;
  const checkoutToken = payload.checkout_token != null && String(payload.checkout_token).trim() !== '' ? String(payload.checkout_token).trim() : null;
  const country = normalizeCountry(countryCode) || null;

  if (config.dbUrl) {
    await db.run(`
      INSERT INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (purchase_key) DO NOTHING
    `, [purchaseKey, sessionId, payload.visitor_id ?? null, now, Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country]);
  } else {
    await db.run(`
      INSERT OR IGNORE INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [purchaseKey, sessionId, payload.visitor_id ?? null, now, Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country]);
  }
  // Never delete purchase rows (project rule: no DB deletes without backup). Dedupe is done in stats queries only.
}

/** "Today (24h)" tab: last 24 hours. "All (60 min)" tab: last 60 min. Cleanup uses SESSION_RETENTION_DAYS. */
const TODAY_WINDOW_MINUTES = 24 * 60;
const ALL_SESSIONS_WINDOW_MINUTES = 60;

async function listSessions(filter) {
  const db = getDb();
  const now = Date.now();
  const todayCutoff = now - TODAY_WINDOW_MINUTES * 60 * 1000;
  const activeCutoff = now - config.activeWindowMinutes * 60 * 1000;
  const recentCutoff = now - config.recentWindowMinutes * 60 * 1000;
  const allCutoff = now - ALL_SESSIONS_WINDOW_MINUTES * 60 * 1000;
  const abandonedRetentionMs = config.abandonedRetentionHours * 60 * 60 * 1000;
  const abandonedCutoff = now - abandonedRetentionMs;

  let sql = `
    SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
      COALESCE(s.country_code, v.last_country) AS session_country,
      v.device, v.network_speed
    FROM sessions s
    LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE 1=1
  `;
  const params = [];
  let idx = 0;
  const ph = () => (config.dbUrl ? `$${++idx}` : '?');

  if (filter === 'today') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(todayCutoff);
  } else if (filter === 'converted') {
    sql += ` AND s.has_purchased = 1 AND s.purchased_at >= ${ph()}`;
    params.push(todayCutoff);
  } else if (filter === 'active') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(activeCutoff);
    const arrivedCutoff = now - config.liveArrivedWindowMinutes * 60 * 1000;
    sql += ` AND s.started_at >= ${ph()}`;
    params.push(arrivedCutoff);
  } else if (filter === 'recent') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(recentCutoff);
  } else if (filter === 'abandoned') {
    sql += ` AND s.is_abandoned = 1 AND s.abandoned_at >= ${ph()}`;
    params.push(abandonedCutoff);
  } else if (filter === 'all') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(allCutoff);
  } else {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(now - config.sessionTtlMinutes * 60 * 1000);
  }

  sql += ' ORDER BY s.last_seen DESC';
  const rows = await db.all(sql, params);

  return rows.map(r => {
    const countryCode = (r.session_country || r.country_code || 'XX').toUpperCase().slice(0, 2);
    const out = { ...r, country_code: countryCode };
    delete out.session_country;
    delete out.visitor_is_returning;
    out.is_returning = (r.is_returning != null ? r.is_returning : r.visitor_is_returning) ? 1 : 0;
    out.started_at = r.started_at != null ? Number(r.started_at) : null;
    out.last_seen = r.last_seen != null ? Number(r.last_seen) : null;
    out.purchased_at = r.purchased_at != null ? Number(r.purchased_at) : null;
    out.checkout_started_at = r.checkout_started_at != null ? Number(r.checkout_started_at) : null;
    out.abandoned_at = r.abandoned_at != null ? Number(r.abandoned_at) : null;
    out.recovered_at = r.recovered_at != null ? Number(r.recovered_at) : null;
    return out;
  });
}

/** Count of sessions currently "online" (active window: last_seen and started_at within config windows). Used for Online display regardless of date range. */
async function getActiveSessionCount() {
  const db = getDb();
  const now = Date.now();
  const activeCutoff = now - config.activeWindowMinutes * 60 * 1000;
  const arrivedCutoff = now - config.liveArrivedWindowMinutes * 60 * 1000;
  const row = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= $1 AND started_at >= $2', [activeCutoff, arrivedCutoff])
    : await db.get('SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= ? AND started_at >= ?', [activeCutoff, arrivedCutoff]);
  return row ? Number(row.n) || 0 : 0;
}

async function getSessionEvents(sessionId, limit = 20) {
  const db = getDb();
  const rows = await db.all(
    'SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?',
    [sessionId, limit]
  );
  return rows.reverse().map(r => ({
    ...r,
    ts: r.ts != null ? Number(r.ts) : null,
  }));
}

/** When trafficMode is human_only, exclude sessions with cf_known_bot = 1. No bot score used. */
function sessionFilterForTraffic(trafficMode) {
  if (trafficMode === 'human_only') {
    return config.dbUrl
      ? { sql: ' AND (sessions.cf_known_bot IS NULL OR sessions.cf_known_bot = 0)', params: [] }
      : { sql: ' AND (sessions.cf_known_bot IS NULL OR sessions.cf_known_bot = 0)', params: [] };
  }
  return { sql: '', params: [] };
}

const DEFAULT_RANGE_KEYS = ['today', 'yesterday'];
const SALES_ROLLING_WINDOWS = [
  { key: '3h', ms: 3 * 60 * 60 * 1000 },
  { key: '6h', ms: 6 * 60 * 60 * 1000 },
  { key: '12h', ms: 12 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];
const CONVERSION_ROLLING_WINDOWS = [
  { key: '3h', ms: 3 * 60 * 60 * 1000 },
  { key: '6h', ms: 6 * 60 * 60 * 1000 },
  { key: '12h', ms: 12 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
];

function resolveAdminTimeZone() {
  const tz = config.adminTimezone || 'Europe/London';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(new Date());
    return tz;
  } catch (_) {
    return 'Europe/London';
  }
}

function getTimeZoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getTimeZoneOffsetMs(timeZone, date) {
  const parts = getTimeZoneParts(date, timeZone);
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utc - date.getTime();
}

function zonedTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  return utcGuess.getTime() - offset;
}

function addDaysToParts(parts, deltaDays) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function startOfDayUtcMs(parts, timeZone) {
  return zonedTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

function getRangeBounds(rangeKey, nowMs, timeZone) {
  const todayParts = getTimeZoneParts(new Date(nowMs), timeZone);
  const startToday = startOfDayUtcMs(todayParts, timeZone);
  // Custom day: d:YYYY-MM-DD (in admin timezone)
  if (typeof rangeKey === 'string' && rangeKey.startsWith('d:')) {
    const m = rangeKey.match(/^d:(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const start = zonedTimeToUtcMs(year, month, day, 0, 0, 0, timeZone);
        const nextParts = addDaysToParts({ year, month, day }, 1);
        const endFull = zonedTimeToUtcMs(nextParts.year, nextParts.month, nextParts.day, 0, 0, 0, timeZone);
        const isToday = year === todayParts.year && month === todayParts.month && day === todayParts.day;
        const end = isToday ? nowMs : endFull;
        // Clamp future dates.
        if (start >= nowMs) return { start: nowMs, end: nowMs };
        return { start, end: Math.max(start, end) };
      }
    }
  }
  if (rangeKey === '1h') {
    return { start: nowMs - 60 * 60 * 1000, end: nowMs };
  }
  if (rangeKey === 'today') {
    const start = startToday >= nowMs ? nowMs - 24 * 60 * 60 * 1000 : startToday;
    return { start, end: nowMs };
  }
  if (rangeKey === 'yesterday') {
    const yParts = addDaysToParts(todayParts, -1);
    return { start: startOfDayUtcMs(yParts, timeZone), end: startToday };
  }
  if (rangeKey === '3d') {
    const startParts = addDaysToParts(todayParts, -2);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === '7d') {
    const startParts = addDaysToParts(todayParts, -6);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === 'month') {
    const startOfMonth = zonedTimeToUtcMs(todayParts.year, todayParts.month, 1, 0, 0, 0, timeZone);
    return { start: startOfMonth, end: nowMs };
  }
  return { start: nowMs, end: nowMs };
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromParts(parts) {
  if (!parts) return '';
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d);
}

function ymdFromMs(ms, timeZone) {
  const parts = getTimeZoneParts(new Date(ms), timeZone);
  return ymdFromParts(parts);
}

function listYmdsInBounds(startMs, endMs, timeZone) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const startParts = getTimeZoneParts(new Date(start), timeZone);
  const endParts = getTimeZoneParts(new Date(Math.max(start, end - 1)), timeZone);
  let cur = { year: startParts.year, month: startParts.month, day: startParts.day };
  const last = { year: endParts.year, month: endParts.month, day: endParts.day };
  const out = [];
  for (let guard = 0; guard < 400; guard++) {
    const ymd = ymdFromParts(cur);
    if (ymd) out.push(ymd);
    if (cur.year === last.year && cur.month === last.month && cur.day === last.day) break;
    cur = addDaysToParts(cur, 1);
  }
  return out;
}

async function saveShopifySessionsSnapshot({ shop, snapshotKey, dayYmd, sessionsCount, fetchedAt } = {}) {
  const db = getDb();
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const ymd = typeof dayYmd === 'string' ? dayYmd.trim() : '';
  const snapKey = snapshotKey != null ? String(snapshotKey).trim().slice(0, 64) : null;
  const count = sessionsCount != null ? parseInt(String(sessionsCount), 10) : NaN;
  const at = fetchedAt != null ? Number(fetchedAt) : Date.now();
  if (!safeShop) return { ok: false, error: 'missing_shop' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return { ok: false, error: 'invalid_day' };
  if (!Number.isFinite(count) || count < 0) return { ok: false, error: 'invalid_count' };
  if (!Number.isFinite(at) || at <= 0) return { ok: false, error: 'invalid_fetched_at' };
  try {
    await db.run(
      `INSERT INTO shopify_sessions_snapshots (snapshot_key, shop, day_ymd, sessions_count, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
      [snapKey, safeShop, ymd, count, at]
    );
  } catch (_) {
    // Fail-open if table doesn't exist yet.
  }
  return { ok: true };
}

async function getLatestShopifySessionsSnapshot(shop, dayYmd) {
  const db = getDb();
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const ymd = typeof dayYmd === 'string' ? dayYmd.trim() : '';
  if (!safeShop || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  try {
    const row = await db.get(
      `SELECT sessions_count, fetched_at
       FROM shopify_sessions_snapshots
       WHERE shop = ? AND day_ymd = ?
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [safeShop, ymd]
    );
    if (!row) return null;
    const count = row.sessions_count != null ? Number(row.sessions_count) : null;
    const fetchedAt = row.fetched_at != null ? Number(row.fetched_at) : null;
    return { sessionsCount: Number.isFinite(count) ? count : null, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null };
  } catch (_) {
    return null;
  }
}

const SHOPIFY_SESSIONS_TODAY_REFRESH_MS = 5 * 60 * 1000;
const shopifySessionsFetchInflight = new Map(); // shop|ymd -> Promise<number|null>

async function fetchShopifySessionsCountForDay(shop, dayYmd, timeZone, { snapshotKey } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayYmd || ''))) return null;
  const token = await salesTruth.getAccessToken(safeShop);
  if (!token) return null;
  const tz = timeZone || resolveAdminTimeZone();
  const todayYmd = ymdFromMs(Date.now(), tz);
  const during = String(dayYmd) === todayYmd ? 'today' : String(dayYmd);
  const result = await shopifyQl.fetchShopifySessionsCount(safeShop, token, { during });
  if (typeof result.count !== 'number') return null;
  const fetchedAt = Date.now();
  await saveShopifySessionsSnapshot({
    shop: safeShop,
    snapshotKey: snapshotKey != null ? snapshotKey : ('d:' + String(dayYmd)),
    dayYmd: String(dayYmd),
    sessionsCount: result.count,
    fetchedAt,
  });
  return result.count;
}

async function getShopifySessionsCountForBounds(shop, startMs, endMs, timeZone, { fetchIfMissing = false } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return null;
  const tz = timeZone || resolveAdminTimeZone();
  const ymds = listYmdsInBounds(startMs, endMs, tz);
  if (!ymds.length) return 0;

  const todayYmd = ymdFromMs(Date.now(), tz);
  let total = 0;
  for (const ymd of ymds) {
    const latest = await getLatestShopifySessionsSnapshot(safeShop, ymd);
    const isToday = ymd === todayYmd;
    const freshEnough = latest && typeof latest.sessionsCount === 'number' && (!isToday || (latest.fetchedAt && (Date.now() - latest.fetchedAt) < SHOPIFY_SESSIONS_TODAY_REFRESH_MS));
    if (freshEnough) {
      total += Number(latest.sessionsCount) || 0;
      continue;
    }
    if (!fetchIfMissing) return null;

    const inflightKey = safeShop + '|' + ymd;
    let p = shopifySessionsFetchInflight.get(inflightKey);
    if (!p) {
      p = fetchShopifySessionsCountForDay(safeShop, ymd, tz).catch(() => null).finally(() => {
        if (shopifySessionsFetchInflight.get(inflightKey) === p) shopifySessionsFetchInflight.delete(inflightKey);
      });
      shopifySessionsFetchInflight.set(inflightKey, p);
    }
    const fetched = await p;
    if (typeof fetched === 'number') {
      total += fetched;
    } else {
      return null;
    }
  }
  return total;
}

/** List sessions in a date range with pagination. Used by Live tab when Today/Yesterday/3d/7d/1h is selected. */
async function listSessionsByRange(rangeKey, timeZone, limit, offset) {
  const db = getDb();
  const now = Date.now();
  const tz = timeZone || resolveAdminTimeZone();
  const bounds = getRangeBounds(rangeKey, now, tz);
  const { start, end } = bounds;
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

  // Last Hour: filter by activity (last_seen) so we show sessions active in the last hour, not only sessions that started in the last hour
  const useLastSeen = rangeKey === '1h';
  const timeCol = useLastSeen ? 's.last_seen' : 's.started_at';

  const baseSql = `
    SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
      COALESCE(s.country_code, v.last_country) AS session_country,
      v.device, v.network_speed
    FROM sessions s
    LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE ${timeCol} >= ${config.dbUrl ? '$1' : '?'} AND ${timeCol} < ${config.dbUrl ? '$2' : '?'}
  `;
  const baseParams = [start, end];

  const countSql = config.dbUrl
    ? 'SELECT COUNT(*) AS n FROM sessions s WHERE ' + timeCol + ' >= $1 AND ' + timeCol + ' < $2'
    : 'SELECT COUNT(*) AS n FROM sessions s WHERE ' + timeCol + ' >= ? AND ' + timeCol + ' < ?';
  const countRow = await db.get(countSql, [start, end]);
  const total = (countRow && countRow.n != null) ? Number(countRow.n) : 0;

  const orderLimitOffset = ' ORDER BY s.last_seen DESC LIMIT ' + (config.dbUrl ? '$3' : '?') + ' OFFSET ' + (config.dbUrl ? '$4' : '?');
  const rows = config.dbUrl
    ? await db.all(baseSql + orderLimitOffset, [...baseParams, limitNum, offsetNum])
    : await db.all(baseSql + orderLimitOffset, [...baseParams, limitNum, offsetNum]);

  const sessions = rows.map(r => {
    const countryCode = (r.session_country || r.country_code || 'XX').toUpperCase().slice(0, 2);
    const out = { ...r, country_code: countryCode };
    delete out.session_country;
    delete out.visitor_is_returning;
    out.is_returning = (r.is_returning != null ? r.is_returning : r.visitor_is_returning) ? 1 : 0;
    out.started_at = r.started_at != null ? Number(r.started_at) : null;
    out.last_seen = r.last_seen != null ? Number(r.last_seen) : null;
    out.purchased_at = r.purchased_at != null ? Number(r.purchased_at) : null;
    out.checkout_started_at = r.checkout_started_at != null ? Number(r.checkout_started_at) : null;
    out.abandoned_at = r.abandoned_at != null ? Number(r.abandoned_at) : null;
    out.recovered_at = r.recovered_at != null ? Number(r.recovered_at) : null;
    return out;
  });

  return { sessions, total };
}

function purchaseDedupeKeySql(alias = '') {
  // Prefer checkout_token, then order_id. For rows without either (h: hash), dedupe by session+total+currency+15min.
  const p = alias ? alias + '.' : '';
  const bucket = config.dbUrl
    ? `FLOOR(${p}purchased_at/900000.0)::bigint`
    : `CAST(${p}purchased_at/900000 AS INTEGER)`;
  return `CASE WHEN NULLIF(TRIM(${p}checkout_token), '') IS NOT NULL THEN TRIM(${p}checkout_token) WHEN NULLIF(TRIM(${p}order_id), '') IS NOT NULL THEN TRIM(${p}order_id) ELSE ${p}session_id || '_' || COALESCE(CAST(${p}order_total AS TEXT), '0') || '_' || COALESCE(NULLIF(TRIM(${p}order_currency), ''), 'GBP') || '_' || ${bucket} END`;
}

/** SQL AND clause: exclude h: rows when a token/order row exists for same (session, total, currency, 15min bucket). Prevents double-counting without deleting data. */
function purchaseFilterExcludeDuplicateH(alias) {
  const p = alias || 'p';
  const bucketCmp = config.dbUrl
    ? `FLOOR(p2.purchased_at/900000.0) = FLOOR(${p}.purchased_at/900000.0)`
    : `CAST(p2.purchased_at/900000 AS INTEGER) = CAST(${p}.purchased_at/900000 AS INTEGER)`;
  const sameRow = config.dbUrl
    ? `(p2.order_total IS NOT DISTINCT FROM ${p}.order_total) AND (p2.order_currency IS NOT DISTINCT FROM ${p}.order_currency)`
    : `(p2.order_total IS ${p}.order_total OR (p2.order_total IS NULL AND ${p}.order_total IS NULL)) AND (p2.order_currency IS ${p}.order_currency OR (p2.order_currency IS NULL AND ${p}.order_currency IS NULL))`;
  return ` AND (
    (NULLIF(TRIM(${p}.checkout_token), '') IS NOT NULL OR NULLIF(TRIM(${p}.order_id), '') IS NOT NULL)
    OR (${p}.purchase_key LIKE 'h:%' AND NOT EXISTS (
      SELECT 1 FROM purchases p2
      WHERE (NULLIF(TRIM(p2.checkout_token), '') IS NOT NULL OR NULLIF(TRIM(p2.order_id), '') IS NOT NULL)
        AND p2.session_id = ${p}.session_id AND ${sameRow} AND ${bucketCmp}
    ))
  )`;
}

async function getPixelSalesSummary(start, end) {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT
        COALESCE(NULLIF(TRIM(order_currency), ''), 'GBP') AS currency,
        COUNT(*) AS orders,
        COALESCE(SUM(order_total), 0) AS revenue
      FROM purchases p
      WHERE purchased_at >= ? AND purchased_at < ?
        ${purchaseFilterExcludeDuplicateH('p')}
      GROUP BY currency
    `,
    [start, end]
  );
  const ratesToGbp = await fx.getRatesToGbp();
  let orderCount = 0;
  let revenueGbp = 0;
  const revenueByCurrency = {};
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
    const rev = r && r.revenue != null ? Number(r.revenue) : 0;
    const revNum = Number.isFinite(rev) ? rev : 0;
    orderCount += orders;
    revenueByCurrency[cur] = Math.round(revNum * 100) / 100;
    const gbp = fx.convertToGbp(revNum, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) revenueGbp += gbp;
  }
  revenueGbp = Math.round(revenueGbp * 100) / 100;
  return { orderCount, revenueGbp, revenueByCurrency };
}

async function getPixelSalesTotalGbp(start, end) {
  const s = await getPixelSalesSummary(start, end);
  return s && typeof s.revenueGbp === 'number' ? s.revenueGbp : 0;
}

async function getPixelOrderCount(start, end) {
  const s = await getPixelSalesSummary(start, end);
  return s && typeof s.orderCount === 'number' ? s.orderCount : 0;
}

async function getPixelReturningRevenueGbp(start, end) {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT
        COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS currency,
        COALESCE(SUM(p.order_total), 0) AS revenue
      FROM purchases p
      INNER JOIN sessions s ON s.session_id = p.session_id
      WHERE p.purchased_at >= ? AND p.purchased_at < ?
        AND s.is_returning = 1
        ${purchaseFilterExcludeDuplicateH('p')}
      GROUP BY currency
    `,
    [start, end]
  );
  const ratesToGbp = await fx.getRatesToGbp();
  let revenueGbp = 0;
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const rev = r && r.revenue != null ? Number(r.revenue) : 0;
    const revNum = Number.isFinite(rev) ? rev : 0;
    const gbp = fx.convertToGbp(revNum, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) revenueGbp += gbp;
  }
  return Math.round(revenueGbp * 100) / 100;
}

function isDayLikeRangeKey(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.trim().toLowerCase();
  if (k === 'today' || k === 'yesterday' || k === '3d' || k === '7d' || k === 'month') return true;
  return /^d:\d{4}-\d{2}-\d{2}$/.test(k);
}

/** Total sales in range. Dedupe in query only; never delete rows. */
async function getSalesTotal(start, end, options = {}) {
  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  if (ordersSource === 'pixel') return getPixelSalesTotalGbp(start, end);
  // Truth: Shopify Orders API cached in orders_shopify.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthSalesTotalGbp(shop, start, end);
}

/** Revenue from returning-customer sessions only (sessions.is_returning = 1). Same dedupe and GBP conversion as getSalesTotal. */
async function getReturningRevenue(start, end, options = {}) {
  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  if (ordersSource === 'pixel') return getPixelReturningRevenueGbp(start, end);
  // Truth-based returning revenue: customers with a prior paid order before start.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningRevenueGbp(shop, start, end);
}

async function getConversionRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const sessionsSource = options?.reporting?.sessionsSource || 'sessions';
  const rangeKey = typeof options.rangeKey === 'string' ? options.rangeKey : '';
  const timeZone = options.timeZone || resolveAdminTimeZone();

  let t = null;
  if (sessionsSource === 'shopify_sessions' && isDayLikeRangeKey(rangeKey)) {
    const shop = salesTruth.resolveShopForSales('');
    if (shop) {
      t = await getShopifySessionsCountForBounds(shop, start, end, timeZone, { fetchIfMissing: true });
    }
  }
  if (t == null) {
    const total = config.dbUrl
      ? await db.get(
        'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql,
        [start, end, ...filter.params]
      )
      : await db.get(
        'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql,
        [start, end, ...filter.params]
      );
    t = total?.n ?? 0;
  }
  const p = await getConvertedCount(start, end, options);
  return t > 0 ? Math.round((p / t) * 1000) / 10 : null;
}

/** Product-only sessions: landed on a product page (not homepage, collection, etc). */
const PRODUCT_LANDING_SQL = " AND (first_path LIKE '/products/%' OR (first_product_handle IS NOT NULL AND TRIM(COALESCE(first_product_handle, '')) != ''))";

async function getProductConversionRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  // Keep sessions. prefixes so we can safely re-alias (s.) in joined queries.
  const productFilter = filter.sql + PRODUCT_LANDING_SQL;
  const total = config.dbUrl
    ? await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + productFilter,
      [start, end, ...filter.params]
    )
    : await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + productFilter,
      [start, end, ...filter.params]
    );
  const t = total?.n ?? 0;
  if (t <= 0) return null;

  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  let c = 0;
  if (ordersSource === 'pixel') {
    const convertedRow = await db.get(
      `
        SELECT COUNT(*) AS n FROM (
          SELECT DISTINCT ${purchaseDedupeKeySql('p')} AS k
          FROM sessions s
          INNER JOIN purchases p ON p.session_id = s.session_id
          WHERE s.started_at >= ? AND s.started_at < ?
            ${productFilter.replace(/sessions\./g, 's.')}
            AND p.purchased_at >= ? AND p.purchased_at < ?
            ${purchaseFilterExcludeDuplicateH('p')}
        ) t
      `,
      [start, end, start, end, ...filter.params]
    );
    c = convertedRow?.n != null ? Number(convertedRow.n) || 0 : 0;
  } else {
    // Truth conversions attributed to product-landed sessions via linked evidence.
    const shop = salesTruth.resolveShopForSales('');
    if (!shop) return null;
    const convertedRow = await db.get(
      `
        SELECT COUNT(DISTINCT o.order_id) AS n
        FROM sessions s
        INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = ?
        INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
        WHERE s.started_at >= ? AND s.started_at < ?
          ${productFilter.replace(/sessions\./g, 's.')}
          AND o.created_at >= ? AND o.created_at < ?
          AND (o.test IS NULL OR o.test = 0)
          AND o.cancelled_at IS NULL
          AND o.financial_status = 'paid'
      `,
      [shop, start, end, start, end, ...filter.params]
    );
    c = convertedRow?.n != null ? Number(convertedRow.n) || 0 : 0;
  }
  return t > 0 ? Math.round((c / t) * 1000) / 10 : null;
}

/** Sessions and revenue by country. Revenue excludes purchases with null/empty/XX country_code; sum(revenue) <= getSalesTotal. */
async function getCountryStats(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const conversionRows = config.dbUrl
    ? await db.all(`
      SELECT country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= $1 AND started_at < $2
        AND country_code IS NOT NULL AND country_code != '' AND country_code != 'XX'
        ${filter.sql.replace(/sessions\./g, '')}
      GROUP BY country_code
    `, [start, end, ...filter.params])
    : await db.all(`
      SELECT country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
        AND country_code IS NOT NULL AND country_code != '' AND country_code != 'XX'
        ${filter.sql.replace(/sessions\./g, '')}
      GROUP BY country_code
    `, [start, end, ...filter.params]);
  // Truth revenue by country is attributed via linked purchase evidence (so sum(revenue) <= truth total).
  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  const shop = salesTruth.resolveShopForSales('');
  const purchaseAgg = ordersSource === 'pixel'
    ? await db.all(
      `
        SELECT country_code, currency, COUNT(*) AS converted, COALESCE(SUM(revenue), 0) AS revenue
        FROM (
          SELECT
            COALESCE(NULLIF(TRIM(p.country_code), ''), 'XX') AS country_code,
            COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS currency,
            ${purchaseDedupeKeySql('p')} AS order_key,
            p.order_total AS revenue
          FROM purchases p
          WHERE p.purchased_at >= ? AND p.purchased_at < ?
            AND p.country_code IS NOT NULL AND TRIM(p.country_code) != '' AND p.country_code != 'XX'
            ${purchaseFilterExcludeDuplicateH('p')}
        ) t
        GROUP BY country_code, currency
      `,
      [start, end]
    )
    : (shop
      ? await db.all(
        `
          SELECT country_code, currency, COUNT(*) AS converted, COALESCE(SUM(revenue), 0) AS revenue
          FROM (
            SELECT DISTINCT
              s.country_code AS country_code,
              COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency,
              o.order_id AS order_id,
              o.total_price AS revenue
            FROM purchase_events pe
            INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
            INNER JOIN sessions s ON s.session_id = pe.session_id
            WHERE pe.shop = ?
              AND pe.event_type = 'checkout_completed'
              AND o.created_at >= ? AND o.created_at < ?
              AND s.country_code IS NOT NULL AND s.country_code != '' AND s.country_code != 'XX'
              ${filter.sql.replace(/sessions\./g, 's.')}
              AND (o.test IS NULL OR o.test = 0)
              AND o.cancelled_at IS NULL
              AND o.financial_status = 'paid'
          ) t
          GROUP BY country_code, currency
        `,
        [shop, start, end, ...filter.params]
      )
      : []);

  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map();
  for (const row of conversionRows) {
    const code = normalizeCountry(row.country_code);
    if (!code) continue;
    map.set(code, {
      country_code: code,
      total: Number(row.total) || 0,
      converted: Number(row.converted) || 0,
      revenue: 0,
    });
  }

  // Sum converted counts and convert revenue to GBP across currencies.
  for (const row of purchaseAgg || []) {
    const code = normalizeCountry(row.country_code);
    if (!code) continue;
    const current = map.get(code) || { country_code: code, total: 0, converted: 0, revenue: 0 };
    const converted = Number(row.converted) || 0;
    const revenue = row.revenue != null ? Number(row.revenue) : 0;
    const cur = fx.normalizeCurrency(row.currency) || 'GBP';
    current.converted += converted;
    const gbp = fx.convertToGbp(revenue, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) current.revenue += gbp;
    map.set(code, current);
  }

  const out = Array.from(map.values()).map(r => {
    const revenue = Math.round((Number(r.revenue) || 0) * 100) / 100;
    const converted = r.converted || 0;
    const aov = converted > 0 ? Math.round((revenue / converted) * 100) / 100 : null;
    return {
      country_code: r.country_code,
      conversion: r.total > 0 ? Math.round((r.converted / r.total) * 1000) / 10 : null,
      revenue,
      total: r.total,
      converted,
      aov,
    };
  });
  out.sort((a, b) => (b.revenue - a.revenue) || (b.converted - a.converted) || (b.total - a.total));
  return out.slice(0, 20);
}

/**
 * Best GEO Products: top revenue products per country (cap 3 per country).
 *
 * Attribution:
 * - Country comes from sessions.country_code via purchase_events.session_id (truth evidence linkage).
 * - Revenue comes from orders_shopify_line_items (no orders_shopify.raw_json parsing).
 *
 * Output rows:
 * - country_code, product_title, conversion (pct), converted (orders), total (sessions), revenue (GBP)
 */
async function getBestGeoProducts(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');
  const db = getDb();
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return [];

  const sql = `
    WITH sessions_by_country AS (
      SELECT s.country_code AS country_code, COUNT(*) AS clicks
      FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ?
        AND s.country_code IS NOT NULL AND s.country_code != '' AND s.country_code != 'XX'
        ${filterAlias}
      GROUP BY s.country_code
    ),
    order_country AS (
      SELECT DISTINCT pe.shop AS shop, s.country_code AS country_code, pe.linked_order_id AS order_id
      FROM purchase_events pe
      INNER JOIN sessions s ON s.session_id = pe.session_id
      WHERE pe.shop = ?
        AND pe.event_type = 'checkout_completed'
        AND pe.linked_order_id IS NOT NULL AND TRIM(pe.linked_order_id) != ''
        AND s.country_code IS NOT NULL AND s.country_code != '' AND s.country_code != 'XX'
        ${filterAlias}
    ),
    product_rev AS (
      SELECT
        oc.country_code AS country_code,
        COALESCE(NULLIF(TRIM(li.currency), ''), 'GBP') AS currency,
        li.product_id AS product_id,
        MAX(li.title) AS title,
        COUNT(DISTINCT li.order_id) AS sales,
        COALESCE(SUM(li.line_revenue), 0) AS revenue
      FROM order_country oc
      INNER JOIN orders_shopify_line_items li
        ON li.shop = oc.shop AND li.order_id = oc.order_id
      WHERE li.order_created_at >= ? AND li.order_created_at < ?
        AND (li.order_test IS NULL OR li.order_test = 0)
        AND li.order_cancelled_at IS NULL
        AND li.order_financial_status = 'paid'
        AND li.product_id IS NOT NULL AND TRIM(li.product_id) != ''
        AND li.title IS NOT NULL AND TRIM(li.title) != ''
      GROUP BY oc.country_code, currency, li.product_id
    ),
    ranked AS (
      SELECT
        pr.country_code,
        pr.currency,
        pr.product_id,
        pr.title,
        pr.sales,
        pr.revenue,
        COALESCE(sbc.clicks, 0) AS clicks,
        ROW_NUMBER() OVER (PARTITION BY pr.country_code ORDER BY pr.revenue DESC) AS rn,
        SUM(pr.revenue) OVER (PARTITION BY pr.country_code) AS country_revenue
      FROM product_rev pr
      LEFT JOIN sessions_by_country sbc ON sbc.country_code = pr.country_code
    )
    SELECT
      country_code,
      currency,
      product_id,
      title,
      sales,
      clicks,
      revenue
    FROM ranked
    WHERE rn <= 3
    ORDER BY country_revenue DESC, revenue DESC
  `;

  // filter.params is currently empty, but keep it twice since filterAlias is used twice.
  const params = [start, end, ...filter.params, shop, ...filter.params, start, end];
  const rows = await db.all(sql, params);

  const ratesToGbp = await fx.getRatesToGbp();
  const out = [];
  for (const row of rows || []) {
    const code = normalizeCountry(row && row.country_code);
    if (!code) continue;
    const clicks = row && row.clicks != null ? Number(row.clicks) || 0 : 0;
    const converted = row && row.sales != null ? Number(row.sales) || 0 : 0;
    const revenueRaw = row && row.revenue != null ? Number(row.revenue) : 0;
    const revenueNum = Number.isFinite(revenueRaw) ? revenueRaw : 0;
    const cur = fx.normalizeCurrency(row && row.currency) || 'GBP';
    const gbp = fx.convertToGbp(revenueNum, cur, ratesToGbp);
    const revenue = (typeof gbp === 'number' && Number.isFinite(gbp)) ? (Math.round(gbp * 100) / 100) : 0;
    const productTitle = (row && row.title != null) ? String(row.title).trim() : '';
    const conversion = clicks > 0 ? Math.round((converted / clicks) * 1000) / 10 : null;
    out.push({
      country_code: code,
      product_title: productTitle || null,
      conversion,
      total: clicks,
      converted,
      revenue,
    });
  }
  return out;
}

async function getSessionCountsFromSessionsTable(start, end, options = {}) {
  const db = getDb();
  const totalRow = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2', [start, end])
    : await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?', [start, end]);
  const filter = sessionFilterForTraffic(options.trafficMode || config.trafficMode || 'all');
  const humanRow = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql, [start, end, ...filter.params])
    : await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql, [start, end, ...filter.params]);
  const total = totalRow ? Number(totalRow.n) || 0 : 0;
  const human = humanRow ? Number(humanRow.n) || 0 : 0;
  return { total_sessions: total, human_sessions: human, known_bot_sessions: total - human };
}

async function getSessionCounts(start, end, options = {}) {
  const sessionsSource = options?.reporting?.sessionsSource || 'sessions';
  const rangeKey = typeof options.rangeKey === 'string' ? options.rangeKey : '';
  const timeZone = options.timeZone || resolveAdminTimeZone();
  if (sessionsSource !== 'shopify_sessions' || !isDayLikeRangeKey(rangeKey)) {
    return getSessionCountsFromSessionsTable(start, end, options);
  }
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return getSessionCountsFromSessionsTable(start, end, options);
  const n = await getShopifySessionsCountForBounds(shop, start, end, timeZone, { fetchIfMissing: true });
  if (typeof n === 'number' && Number.isFinite(n)) {
    return { total_sessions: n, human_sessions: n, known_bot_sessions: null };
  }
  return { total_sessions: null, human_sessions: null, known_bot_sessions: null };
}

async function getConvertedCount(start, end, options = {}) {
  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  if (ordersSource === 'pixel') return getPixelOrderCount(start, end);
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthOrderCount(shop, start, end);
}

function aovFromSalesAndCount(sales, count) {
  if (count == null || count <= 0 || sales == null) return null;
  return Math.round((sales / count) * 100) / 100;
}

/** Bounce rate: (single-page sessions / total sessions) × 100. Industry standard: single-page = session with exactly one page_viewed (user left without a second page). */
async function getBounceRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');
  const db = getDb();
  const singlePageRow = config.dbUrl
    ? await db.get(`
      SELECT COUNT(*) AS n FROM sessions s
      WHERE s.started_at >= $1 AND s.started_at < $2 ${filterAlias}
      AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = 'page_viewed') = 1
    `, [start, end, ...filter.params])
    : await db.get(`
      SELECT COUNT(*) AS n FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ? ${filterAlias}
      AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = 'page_viewed') = 1
    `, [start, end, ...filter.params]);
  const breakdown = await getSessionCountsFromSessionsTable(start, end, options);
  const total = breakdown.human_sessions ?? 0;
  const singlePage = singlePageRow ? Number(singlePageRow.n) || 0 : 0;
  if (total <= 0) return null;
  return Math.round((singlePage / total) * 1000) / 10;
}

async function getStats(options = {}) {
  const trafficMode = options.trafficMode === 'human_only' ? 'human_only' : (config.trafficMode || 'all');
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const reporting = await getReportingConfig();
  const opts = { trafficMode, timeZone, reporting };
  const requestedRangeRaw =
    typeof options.rangeKey === 'string' ? options.rangeKey :
      (typeof options.range === 'string' ? options.range : '');
  const requestedRange = requestedRangeRaw ? String(requestedRangeRaw).trim().toLowerCase() : '';
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['3d', '7d', 'month']);
  const rangeKeys = DEFAULT_RANGE_KEYS.slice();
  if (requestedRange && !rangeKeys.includes(requestedRange) && (isDayKey || allowedLegacy.has(requestedRange))) {
    rangeKeys.push(requestedRange);
  }
  const ranges = {};
  for (const key of rangeKeys) {
    ranges[key] = getRangeBounds(key, now, timeZone);
  }
  // Ensure Shopify truth cache is fresh for "today" before computing KPI stats.
  const salesShop = salesTruth.resolveShopForSales('');
  let salesTruthTodaySync = null;
  if (salesShop && reporting.ordersSource === 'orders_shopify') {
    try {
      salesTruthTodaySync = await salesTruth.ensureReconciled(salesShop, ranges.today.start, ranges.today.end, 'today');
    } catch (_) {
      salesTruthTodaySync = { ok: false, error: 'reconcile_failed' };
    }
  }
  // Run all stats queries in one parallel batch to avoid N+1 (many sequential DB round-trips). Fixes NODE-1.
  const [
    salesByRangeEntries,
    returningRevenueByRangeEntries,
    conversionByRangeEntries,
    productConversionByRangeEntries,
    countryByRangeEntries,
    bestGeoProductsByRangeEntries,
    salesRollingEntries,
    conversionRollingEntries,
    convertedCountByRangeEntries,
    convertedCountRollingEntries,
    trafficBreakdownEntries,
    bounceByRangeEntries,
    yesterdayOk,
    salesTruthHealth,
  ] = await Promise.all([
    Promise.all(rangeKeys.map(async key => [key, await getSalesTotal(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getReturningRevenue(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getConversionRate(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getProductConversionRate(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getCountryStats(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getBestGeoProducts(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(SALES_ROLLING_WINDOWS.map(async w => [w.key, await getSalesTotal(now - w.ms, now, { ...opts, rangeKey: w.key })])),
    Promise.all(CONVERSION_ROLLING_WINDOWS.map(async w => [w.key, await getConversionRate(now - w.ms, now, { ...opts, rangeKey: w.key })])),
    Promise.all(rangeKeys.map(async key => [key, await getConvertedCount(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(SALES_ROLLING_WINDOWS.map(async w => [w.key, await getConvertedCount(now - w.ms, now, { ...opts, rangeKey: w.key })])),
    Promise.all(rangeKeys.map(async key => [key, await getSessionCounts(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getBounceRate(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    rangeHasSessions(ranges.yesterday.start, ranges.yesterday.end, opts),
    (salesShop ? salesTruth.getTruthHealth(salesShop || '', 'today') : Promise.resolve(null)),
  ]);
  const salesByRange = Object.fromEntries(salesByRangeEntries);
  const returningRevenueByRange = Object.fromEntries(returningRevenueByRangeEntries);
  const conversionByRange = Object.fromEntries(conversionByRangeEntries);
  const productConversionByRange = Object.fromEntries(productConversionByRangeEntries);
  const countryByRange = Object.fromEntries(countryByRangeEntries);
  const bestGeoProductsByRange = Object.fromEntries(bestGeoProductsByRangeEntries);
  const salesRolling = Object.fromEntries(salesRollingEntries);
  const conversionRolling = Object.fromEntries(conversionRollingEntries);
  const convertedCountByRange = Object.fromEntries(convertedCountByRangeEntries);
  const convertedCountRolling = Object.fromEntries(convertedCountRollingEntries);
  const trafficBreakdown = Object.fromEntries(trafficBreakdownEntries);
  const bounceByRange = Object.fromEntries(bounceByRangeEntries);
  const aovByRange = {};
  for (const key of rangeKeys) {
    aovByRange[key] = aovFromSalesAndCount(salesByRange[key], convertedCountByRange[key]);
  }
  const aovRolling = {};
  for (const key of Object.keys(salesRolling)) {
    aovRolling[key] = aovFromSalesAndCount(salesRolling[key], convertedCountRolling[key]);
  }
  const rangeAvailable = {
    today: true,
    yesterday: yesterdayOk,
  };
  return {
    sales: { ...salesByRange, rolling: salesRolling },
    returningRevenue: { ...returningRevenueByRange },
    conversion: { ...conversionByRange, rolling: conversionRolling },
    productConversion: productConversionByRange,
    country: countryByRange,
    bestGeoProducts: bestGeoProductsByRange,
    aov: { ...aovByRange, rolling: aovRolling },
    bounce: bounceByRange,
    revenueToday: salesByRange.today ?? 0,
    reporting,
    salesTruth: {
      shop: salesShop || '',
      todaySync: salesTruthTodaySync,
      health: salesTruthHealth,
    },
    rangeAvailable,
    convertedCount: convertedCountByRange,
    trafficMode,
    trafficBreakdown,
  };
}

/**
 * Lightweight KPI payload for the top grid (no country/product breakdown).
 * Returns a stats-shaped object but only for a single range key.
 */
async function getKpis(options = {}) {
  const trafficMode = options.trafficMode === 'human_only' ? 'human_only' : (config.trafficMode || 'all');
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const reporting = await getReportingConfig();
  const opts = { trafficMode, timeZone, reporting };

  const requestedRangeRaw =
    typeof options.rangeKey === 'string' ? options.rangeKey :
      (typeof options.range === 'string' ? options.range : '');
  const requestedRange = requestedRangeRaw ? String(requestedRangeRaw).trim().toLowerCase() : '';
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['today', 'yesterday', '3d', '7d', 'month']);
  const rangeKey = (DEFAULT_RANGE_KEYS.includes(requestedRange) || isDayKey || allowedLegacy.has(requestedRange))
    ? requestedRange
    : 'today';

  const bounds = getRangeBounds(rangeKey, now, timeZone);

  // Ensure Shopify truth cache is fresh for "today" before computing KPI stats.
  const salesShop = salesTruth.resolveShopForSales('');
  let salesTruthSync = null;
  if (rangeKey === 'today' && salesShop && reporting.ordersSource === 'orders_shopify') {
    try {
      // Share the same reconcile_state(scope='today') as /api/stats and startup reconcile.
      salesTruthSync = await salesTruth.ensureReconciled(salesShop, bounds.start, bounds.end, 'today');
    } catch (_) {
      salesTruthSync = { ok: false, error: 'reconcile_failed' };
    }
  }

  const yesterdayBounds = getRangeBounds('yesterday', now, timeZone);
  const [
    salesVal,
    returningRevenueVal,
    conversionVal,
    convertedCountVal,
    trafficBreakdownVal,
    bounceVal,
    yesterdayOk,
    salesTruthHealth,
  ] = await Promise.all([
    getSalesTotal(bounds.start, bounds.end, { ...opts, rangeKey }),
    getReturningRevenue(bounds.start, bounds.end, { ...opts, rangeKey }),
    getConversionRate(bounds.start, bounds.end, { ...opts, rangeKey }),
    getConvertedCount(bounds.start, bounds.end, { ...opts, rangeKey }),
    getSessionCounts(bounds.start, bounds.end, { ...opts, rangeKey }),
    getBounceRate(bounds.start, bounds.end, { ...opts, rangeKey }),
    rangeHasSessions(yesterdayBounds.start, yesterdayBounds.end, opts),
    (salesShop ? salesTruth.getTruthHealth(salesShop || '', 'today') : Promise.resolve(null)),
  ]);

  const aovVal = aovFromSalesAndCount(salesVal, convertedCountVal);
  const rangeAvailable = {
    today: true,
    yesterday: yesterdayOk,
  };

  return {
    sales: { [rangeKey]: salesVal },
    returningRevenue: { [rangeKey]: returningRevenueVal },
    conversion: { [rangeKey]: conversionVal },
    aov: { [rangeKey]: aovVal },
    bounce: { [rangeKey]: bounceVal },
    convertedCount: { [rangeKey]: convertedCountVal },
    trafficMode,
    trafficBreakdown: { [rangeKey]: trafficBreakdownVal },
    reporting,
    salesTruth: {
      shop: salesShop || '',
      todaySync: salesTruthSync,
      health: salesTruthHealth,
    },
    rangeAvailable,
  };
}

async function rangeHasSessions(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const row = config.dbUrl
    ? await db.get('SELECT 1 FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql + ' LIMIT 1', [start, end, ...filter.params])
    : await db.get('SELECT 1 FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql + ' LIMIT 1', [start, end, ...filter.params]);
  return !!row;
}

function validateEventType(type) {
  return ALLOWED_EVENT_TYPES.has(type);
}

module.exports = {
  sanitize,
  getSetting,
  setSetting,
  getReportingConfig,
  isTrackingEnabled,
  getVisitor,
  upsertVisitor,
  getSession,
  upsertSession,
  insertPurchase,
  insertEvent,
  listSessions,
  listSessionsByRange,
  getActiveSessionCount,
  getSessionEvents,
  // Reporting helpers (pixel vs truth)
  getPixelSalesSummary,
  getPixelSalesTotalGbp,
  getPixelOrderCount,
  // Shopify sessions snapshots (for optional Shopify sessions denominator)
  saveShopifySessionsSnapshot,
  getLatestShopifySessionsSnapshot,
  getStats,
  getKpis,
  getRangeBounds,
  resolveAdminTimeZone,
  // Shared SQL helpers for pixel dedupe
  purchaseDedupeKeySql,
  purchaseFilterExcludeDuplicateH,
  validateEventType,
  ALLOWED_EVENT_TYPES,
};
