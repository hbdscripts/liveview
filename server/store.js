/**
 * Repository: visitors, sessions, events, settings, purchases.
 * All timestamps in epoch ms.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const config = require('./config');
const fx = require('./fx');
const salesTruth = require('./salesTruth');
const productMetaCache = require('./shopifyProductMetaCache');
const shopifyLandingMeta = require('./shopifyLandingMeta');
const shopifyQl = require('./shopifyQl');
const reportCache = require('./reportCache');
const { deriveAttribution } = require('./attribution/deriveAttribution');
const { warnOnReject } = require('./shared/warnReject');
const { ratioOrNull } = require('./metrics');
const { normalizePaymentMethod } = require('./paymentMethods/normalizePaymentMethod');

// Best-effort Shopify truth warmup (must not block request paths).
let _truthNudgeLastAt = 0;
let _truthNudgeInFlight = false;
function nudgeSalesTruthWarmupDetached(shop, startMs, endMs, scopeKey, logTag) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  if (!safeShop) return;
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return;
  const now = Date.now();
  // Throttle to avoid hammering reconcile_state / Shopify on KPI polling.
  if ((now - (_truthNudgeLastAt || 0)) < 2 * 60 * 1000) return;
  if (_truthNudgeInFlight) return;
  _truthNudgeLastAt = now;
  _truthNudgeInFlight = true;
  const tag = logTag ? String(logTag) : '[store] ensureReconciled';
  const refundsScope = 'refunds_' + (scopeKey || 'today');
  try {
    if (typeof setImmediate === 'function') {
      setImmediate(() => {
        salesTruth
          .ensureReconciled(safeShop, start, end, scopeKey || 'today')
          .catch(warnOnReject(tag));
        salesTruth
          .ensureRefundsSynced(safeShop, start, end, refundsScope)
          .catch(warnOnReject(tag))
          .finally(() => { _truthNudgeInFlight = false; });
      });
      return;
    }
  } catch (_) {}
  salesTruth
    .ensureReconciled(safeShop, start, end, scopeKey || 'today')
    .catch(warnOnReject(tag));
  salesTruth
    .ensureRefundsSynced(safeShop, start, end, refundsScope)
    .catch(warnOnReject(tag))
    .finally(() => { _truthNudgeInFlight = false; });
}

const ALLOWED_EVENT_TYPES = new Set([
  'page_viewed', 'product_viewed', 'product_added_to_cart', 'product_removed_from_cart',
  'cart_updated', 'cart_viewed', 'checkout_started', 'checkout_completed', 'heartbeat',
]);

let _sessionsHasBsNetworkColumn = null;
let _sessionsHasBsNetworkColumnInFlight = null;

async function sessionsHasBsNetworkColumn(db) {
  if (_sessionsHasBsNetworkColumn === true) return true;
  if (_sessionsHasBsNetworkColumn === false) return false;
  if (_sessionsHasBsNetworkColumnInFlight) return _sessionsHasBsNetworkColumnInFlight;

  _sessionsHasBsNetworkColumnInFlight = Promise.resolve()
    .then(() => db.get('SELECT bs_network FROM sessions LIMIT 1'))
    .then(() => {
      _sessionsHasBsNetworkColumn = true;
      return true;
    })
    .catch((err) => {
      const msg = String(err && err.message ? err.message : err);
      // Postgres: column "bs_network" does not exist
      // SQLite: no such column: bs_network
      if (/bs_network/i.test(msg) && /(does not exist|no such column|has no column)/i.test(msg)) {
        _sessionsHasBsNetworkColumn = false;
        return false;
      }
      throw err;
    })
    .finally(() => {
      _sessionsHasBsNetworkColumnInFlight = null;
    });

  return _sessionsHasBsNetworkColumnInFlight;
}

let _sessionsHasAcquisitionColumns = null;
let _sessionsHasAcquisitionColumnsInFlight = null;

async function sessionsHasAcquisitionColumns(db) {
  if (_sessionsHasAcquisitionColumns === true) return true;
  if (_sessionsHasAcquisitionColumns === false) return false;
  if (_sessionsHasAcquisitionColumnsInFlight) return _sessionsHasAcquisitionColumnsInFlight;

  _sessionsHasAcquisitionColumnsInFlight = Promise.resolve()
    .then(() => db.get('SELECT device_key, attribution_variant FROM sessions LIMIT 1'))
    .then(() => {
      _sessionsHasAcquisitionColumns = true;
      return true;
    })
    .catch((err) => {
      const msg = String(err && err.message ? err.message : err);
      // Postgres: column "device_key" does not exist
      // SQLite: no such column: device_key
      if (/(device_key|attribution_variant)/i.test(msg) && /(does not exist|no such column|has no column)/i.test(msg)) {
        _sessionsHasAcquisitionColumns = false;
        return false;
      }
      throw err;
    })
    .finally(() => {
      _sessionsHasAcquisitionColumnsInFlight = null;
    });

  return _sessionsHasAcquisitionColumnsInFlight;
}

const WHITELIST = new Set([
  'visitor_id', 'session_id', 'event_type', 'path', 'product_handle', 'product_title',
  'variant_title', 'quantity_delta', 'price', 'cart_qty', 'cart_value', 'cart_currency',
  'order_total', 'order_currency', 'checkout_started', 'checkout_completed',
  'order_id', 'checkout_token',
  'payment_gateway', 'payment_method_name', 'payment_method_type', 'payment_card_brand',
  'country_code', 'device', 'network_speed', 'ts', 'customer_privacy_debug',
  'ua_device_type', 'ua_platform', 'ua_model',
  'utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term',
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

function normalizePaymentKey(v, maxLen = 64) {
  if (v == null) return null;
  const t = typeof v;
  if (t !== 'string' && t !== 'number') return null;
  let s = String(v).trim().toLowerCase();
  if (!s) return null;
  if (s === 'null' || s === 'undefined' || s === 'true' || s === 'false' || s === '[object object]') return null;
  s = s.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizePaymentLabel(v, maxLen = 96) {
  if (v == null) return null;
  const t = typeof v;
  if (t !== 'string' && t !== 'number') return null;
  let s = String(v).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
  // Privacy: never persist digits (avoids PAN fragments in method labels).
  s = s.replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
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
      // Handle relative/path-only URLs like "/?gclid=..." from Shopify landing_site.
      try {
        return new URL(raw, 'https://example.local').searchParams;
      } catch (_) {
        return null;
      }
    }
  }
}

function extractBsAdsIdsFromEntryUrl(entryUrl) {
  const params = safeUrlParams(entryUrl || '');
  function trimParam(key, maxLen) {
    try {
      const v = params ? params.get(key) : null;
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      return s.length > maxLen ? s.slice(0, maxLen) : s;
    } catch (_) {
      return null;
    }
  }
  const bsSourceRaw = trimParam('bs_source', 32);
  const bsSource = bsSourceRaw ? bsSourceRaw.toLowerCase() : null;
  const bsNetworkRaw = trimParam('bs_network', 16);
  const bsNetwork = bsNetworkRaw ? bsNetworkRaw.toLowerCase() : null;
  return {
    bsSource,
    bsCampaignId: trimParam('bs_campaign_id', 64),
    bsAdgroupId: trimParam('bs_adgroup_id', 64),
    bsAdId: trimParam('bs_ad_id', 64),
    bsNetwork,
  };
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
  // Brand/store self-referral domains: treat as internal so they map to Direct (not Other).
  // These appear as referrers during redirects / multi-domain setups.
  set.add('heybigday.com');
  set.add('www.heybigday.com');
  set.add('hbdjewellery.com');
  set.add('www.hbdjewellery.com');
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

// --- Legacy traffic source mapping removed (Acquisition uses deriveAttribution + attribution_sources). ---

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

function normalizeUaBrowser(v) {
  const s = trimLower(v, 24);
  if (!s) return null;
  if (s === 'chrome' || s === 'safari' || s === 'edge' || s === 'firefox' || s === 'opera' || s === 'ie' || s === 'samsung' || s === 'other') return s;
  return null;
}

function normalizeUaBrowserVersion(v) {
  const raw = typeof v === 'string' ? v.trim() : '';
  if (!raw) return null;
  const m = raw.match(/^\d+(?:\.\d+){0,3}$/);
  const out = m ? m[0] : raw.replace(/[^\d.]/g, '');
  if (!out) return null;
  return out.length > 16 ? out.slice(0, 16) : out;
}

function normalizeCity(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return s.length > 96 ? s.slice(0, 96) : s;
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
  // Guardrail: reporting must never exceed Shopify. Pixel-derived purchases remain debug-only.
  if (s === 'orders_shopify') return s;
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
  return db.get(
    `
    SELECT
      s.*,
      (SELECT payment_gateway FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_gateway,
      (SELECT payment_method_name FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_method_name,
      (SELECT payment_method_type FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_method_type
    FROM sessions s
    WHERE s.session_id = ?
    `.trim(),
    [sessionId]
  );
}

function parseCfContext(cfContext) {
  if (!cfContext) {
    return {
      cfKnownBot: null,
      cfVerifiedBotCategory: null,
      cfCountry: null,
      cfCity: null,
      cfColo: null,
      cfAsn: null,
    };
  }
  const knownBot = cfContext.cf_known_bot;
  const cfKnownBot = knownBot === '1' || knownBot === true ? 1 : (knownBot === '0' || knownBot === false ? 0 : null);
  return {
    cfKnownBot,
    cfVerifiedBotCategory: cfContext.cf_verified_bot_category && String(cfContext.cf_verified_bot_category).trim() ? String(cfContext.cf_verified_bot_category).trim().slice(0, 128) : null,
    cfCountry: cfContext.cf_country && String(cfContext.cf_country).trim().length === 2 ? String(cfContext.cf_country).trim().toUpperCase() : null,
    cfCity: cfContext.cf_city && String(cfContext.cf_city).trim() ? normalizeCity(String(cfContext.cf_city)) : null,
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
  function normalizeProductHandle(v) {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    return s ? s.slice(0, 128) : null;
  }
  function productHandleFromPath(pathValue) {
    const raw = typeof pathValue === 'string' ? pathValue.trim() : '';
    if (!raw) return null;
    const m = raw.match(/^\/products\/([^/?#]+)/i);
    return m && m[1] ? normalizeProductHandle(m[1]) : null;
  }
  const derivedLandingHandle = productHandleFromPath(lastPath);
  const lastProductHandle = normalizeProductHandle(payload.product_handle) || derivedLandingHandle || normalizeProductHandle(existing?.last_product_handle) || null;

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
  const utmTerm = trimUtm(payload.utm_term) ?? existing?.utm_term ?? null;

  const trimUrl = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2048) : null);
  const referrer = trimUrl(payload.referrer) ?? existing?.referrer ?? null;
  const hasExistingReferrer = existing?.referrer != null && String(existing.referrer).trim() !== '';
  const updateReferrer = hasExistingReferrer ? null : (trimUrl(payload.referrer) ?? null);

  const entryUrl = trimUrl(payload.entry_url) ?? existing?.entry_url ?? null;
  const hasExistingEntryUrl = existing?.entry_url != null && String(existing.entry_url).trim() !== '';
  const updateEntryUrl = hasExistingEntryUrl ? null : (trimUrl(payload.entry_url) ?? null);

  const bsExistingSource = existing?.bs_source != null && String(existing.bs_source).trim() !== '' ? String(existing.bs_source).trim() : null;
  const bsExistingCampaignId = existing?.bs_campaign_id != null && String(existing.bs_campaign_id).trim() !== '' ? String(existing.bs_campaign_id).trim() : null;
  const bsExistingAdgroupId = existing?.bs_adgroup_id != null && String(existing.bs_adgroup_id).trim() !== '' ? String(existing.bs_adgroup_id).trim() : null;
  const bsExistingAdId = existing?.bs_ad_id != null && String(existing.bs_ad_id).trim() !== '' ? String(existing.bs_ad_id).trim() : null;
  const bsExistingNetwork = existing?.bs_network != null && String(existing.bs_network).trim() !== '' ? String(existing.bs_network).trim() : null;
  const bsFromUrl = extractBsAdsIdsFromEntryUrl(updateEntryUrl || entryUrl || '');
  const bsSource = bsExistingSource || bsFromUrl.bsSource || null;
  const bsCampaignId = bsExistingCampaignId || bsFromUrl.bsCampaignId || null;
  const bsAdgroupId = bsExistingAdgroupId || bsFromUrl.bsAdgroupId || null;
  const bsAdId = bsExistingAdId || bsFromUrl.bsAdId || null;
  const bsNetwork = bsExistingNetwork || bsFromUrl.bsNetwork || null;
  const updateBsSource = bsExistingSource ? null : (bsFromUrl.bsSource || null);
  const updateBsCampaignId = bsExistingCampaignId ? null : (bsFromUrl.bsCampaignId || null);
  const updateBsAdgroupId = bsExistingAdgroupId ? null : (bsFromUrl.bsAdgroupId || null);
  const updateBsAdId = bsExistingAdId ? null : (bsFromUrl.bsAdId || null);
  const updateBsNetwork = bsExistingNetwork ? null : (bsFromUrl.bsNetwork || null);
  const uaDeviceType = normalizeUaDeviceType(payload.ua_device_type);
  const uaPlatform = normalizeUaPlatform(payload.ua_platform);
  const uaModel = normalizeUaModel(payload.ua_model);
  const uaBrowser = normalizeUaBrowser(payload.ua_browser);
  const uaBrowserVersion = normalizeUaBrowserVersion(payload.ua_browser_version);
  const city = normalizeCity(payload.city);

  const cfKnownBot = cf.cfKnownBot != null ? cf.cfKnownBot : null;
  const cfVerifiedBotCategory = cf.cfVerifiedBotCategory;
  const cfCountry = cf.cfCountry;
  const cfCity = cf.cfCity;
  const cfColo = cf.cfColo;
  const cfAsn = cf.cfAsn;
  const isReturningSession = visitorIsReturning ? 1 : 0;
  const supportsBsNetwork = await sessionsHasBsNetworkColumn(db);

  if (!existing) {
    if (config.dbUrl) {
      if (supportsBsNetwork) {
        await db.run(`
          INSERT INTO sessions (
            session_id, visitor_id, started_at, last_seen,
            last_path, last_product_handle,
            first_path, first_product_handle,
            cart_qty, cart_value, cart_currency,
            order_total, order_currency,
            country_code,
            utm_campaign, utm_source, utm_medium, utm_content, utm_term,
            referrer, entry_url,
            is_checking_out, checkout_started_at, has_purchased, purchased_at,
            is_abandoned, abandoned_at, recovered_at,
            cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, cf_city, city,
            is_returning,
            ua_device_type, ua_platform, ua_model, ua_browser, ua_browser_version,
            bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id, bs_network
          )
          VALUES (
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            0, NULL, NULL,
            ?, ?, ?, ?, ?, ?, ?,
            ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?
          )
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
            utm_term = EXCLUDED.utm_term,
            referrer = EXCLUDED.referrer,
            entry_url = EXCLUDED.entry_url,
            is_checking_out = EXCLUDED.is_checking_out,
            checkout_started_at = EXCLUDED.checkout_started_at,
            has_purchased = EXCLUDED.has_purchased,
            purchased_at = EXCLUDED.purchased_at,
            -- Do not overwrite abandonment markers during upserts.
            -- These are derived asynchronously (cleanup marker pass) and should remain stable once set.
            is_abandoned = sessions.is_abandoned,
            abandoned_at = sessions.abandoned_at,
            recovered_at = sessions.recovered_at,
            cf_known_bot = EXCLUDED.cf_known_bot,
            cf_verified_bot_category = EXCLUDED.cf_verified_bot_category,
            cf_country = EXCLUDED.cf_country,
            cf_colo = EXCLUDED.cf_colo,
            cf_asn = EXCLUDED.cf_asn,
            cf_city = COALESCE(EXCLUDED.cf_city, sessions.cf_city),
            city = COALESCE(EXCLUDED.city, sessions.city),
            ua_device_type = COALESCE(EXCLUDED.ua_device_type, sessions.ua_device_type),
            ua_platform = COALESCE(EXCLUDED.ua_platform, sessions.ua_platform),
            ua_model = COALESCE(EXCLUDED.ua_model, sessions.ua_model),
            ua_browser = COALESCE(EXCLUDED.ua_browser, sessions.ua_browser),
            ua_browser_version = COALESCE(EXCLUDED.ua_browser_version, sessions.ua_browser_version),
            bs_source = COALESCE(EXCLUDED.bs_source, sessions.bs_source),
            bs_campaign_id = COALESCE(EXCLUDED.bs_campaign_id, sessions.bs_campaign_id),
            bs_adgroup_id = COALESCE(EXCLUDED.bs_adgroup_id, sessions.bs_adgroup_id),
            bs_ad_id = COALESCE(EXCLUDED.bs_ad_id, sessions.bs_ad_id),
            bs_network = COALESCE(EXCLUDED.bs_network, sessions.bs_network)
        `, [
          payload.session_id,
          payload.visitor_id,
          now,
          now,
          lastPath,
          lastProductHandle,
          lastPath,
          lastProductHandle,
          cartQty,
          cartValue,
          cartCurrency,
          orderTotal,
          orderCurrency,
          normalizedCountry,
          utmCampaign,
          utmSource,
          utmMedium,
          utmContent,
          utmTerm,
          referrer,
          entryUrl,
          isCheckingOut,
          checkoutStartedAt,
          hasPurchased,
          purchasedAt,
          cfKnownBot,
          cfVerifiedBotCategory,
          cfCountry,
          cfColo,
          cfAsn,
          cfCity,
          city,
          isReturningSession,
          uaDeviceType,
          uaPlatform,
          uaModel,
          uaBrowser,
          uaBrowserVersion,
          bsSource,
          bsCampaignId,
          bsAdgroupId,
          bsAdId,
          bsNetwork,
        ]);
      } else {
        await db.run(`
          INSERT INTO sessions (
            session_id, visitor_id, started_at, last_seen,
            last_path, last_product_handle,
            first_path, first_product_handle,
            cart_qty, cart_value, cart_currency,
            order_total, order_currency,
            country_code,
            utm_campaign, utm_source, utm_medium, utm_content, utm_term,
            referrer, entry_url,
            is_checking_out, checkout_started_at, has_purchased, purchased_at,
            is_abandoned, abandoned_at, recovered_at,
            cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, cf_city, city,
            is_returning,
            ua_device_type, ua_platform, ua_model, ua_browser, ua_browser_version,
            bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id
          )
          VALUES (
            ?, ?, ?, ?,
            ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?,
            ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?, ?,
            0, NULL, NULL,
            ?, ?, ?, ?, ?, ?, ?,
            ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?
          )
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
            utm_term = EXCLUDED.utm_term,
            referrer = EXCLUDED.referrer,
            entry_url = EXCLUDED.entry_url,
            is_checking_out = EXCLUDED.is_checking_out,
            checkout_started_at = EXCLUDED.checkout_started_at,
            has_purchased = EXCLUDED.has_purchased,
            purchased_at = EXCLUDED.purchased_at,
            -- Do not overwrite abandonment markers during upserts.
            -- These are derived asynchronously (cleanup marker pass) and should remain stable once set.
            is_abandoned = sessions.is_abandoned,
            abandoned_at = sessions.abandoned_at,
            recovered_at = sessions.recovered_at,
            cf_known_bot = EXCLUDED.cf_known_bot,
            cf_verified_bot_category = EXCLUDED.cf_verified_bot_category,
            cf_country = EXCLUDED.cf_country,
            cf_colo = EXCLUDED.cf_colo,
            cf_asn = EXCLUDED.cf_asn,
            cf_city = COALESCE(EXCLUDED.cf_city, sessions.cf_city),
            city = COALESCE(EXCLUDED.city, sessions.city),
            ua_device_type = COALESCE(EXCLUDED.ua_device_type, sessions.ua_device_type),
            ua_platform = COALESCE(EXCLUDED.ua_platform, sessions.ua_platform),
            ua_model = COALESCE(EXCLUDED.ua_model, sessions.ua_model),
            ua_browser = COALESCE(EXCLUDED.ua_browser, sessions.ua_browser),
            ua_browser_version = COALESCE(EXCLUDED.ua_browser_version, sessions.ua_browser_version),
            bs_source = COALESCE(EXCLUDED.bs_source, sessions.bs_source),
            bs_campaign_id = COALESCE(EXCLUDED.bs_campaign_id, sessions.bs_campaign_id),
            bs_adgroup_id = COALESCE(EXCLUDED.bs_adgroup_id, sessions.bs_adgroup_id),
            bs_ad_id = COALESCE(EXCLUDED.bs_ad_id, sessions.bs_ad_id)
        `, [
          payload.session_id,
          payload.visitor_id,
          now,
          now,
          lastPath,
          lastProductHandle,
          lastPath,
          lastProductHandle,
          cartQty,
          cartValue,
          cartCurrency,
          orderTotal,
          orderCurrency,
          normalizedCountry,
          utmCampaign,
          utmSource,
          utmMedium,
          utmContent,
          utmTerm,
          referrer,
          entryUrl,
          isCheckingOut,
          checkoutStartedAt,
          hasPurchased,
          purchasedAt,
          cfKnownBot,
          cfVerifiedBotCategory,
          cfCountry,
          cfColo,
          cfAsn,
          cfCity,
          city,
          isReturningSession,
          uaDeviceType,
          uaPlatform,
          uaModel,
          uaBrowser,
          uaBrowserVersion,
          bsSource,
          bsCampaignId,
          bsAdgroupId,
          bsAdId,
        ]);
      }
    } else {
      if (supportsBsNetwork) {
        await db.run(`
          INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, utm_term, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, cf_city, city, is_returning, ua_device_type, ua_platform, ua_model, ua_browser, ua_browser_version, bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id, bs_network)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, utmTerm, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, cfCity, city, isReturningSession, uaDeviceType, uaPlatform, uaModel, uaBrowser, uaBrowserVersion, bsSource, bsCampaignId, bsAdgroupId, bsAdId, bsNetwork]);
      } else {
        await db.run(`
          INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, utm_term, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, cf_city, city, is_returning, ua_device_type, ua_platform, ua_model, ua_browser, ua_browser_version, bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, utmTerm, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, cfCity, city, isReturningSession, uaDeviceType, uaPlatform, uaModel, uaBrowser, uaBrowserVersion, bsSource, bsCampaignId, bsAdgroupId, bsAdId]);
      }
    }
  } else {
    const setParts = [
      'last_seen = ?',
      'last_path = COALESCE(?, last_path)',
      'last_product_handle = COALESCE(?, last_product_handle)',
      'cart_qty = ?',
      'cart_value = COALESCE(?, cart_value)',
      'cart_currency = COALESCE(?, cart_currency)',
      'order_total = COALESCE(?, order_total)',
      'order_currency = COALESCE(?, order_currency)',
      'country_code = COALESCE(?, country_code)',
      'city = COALESCE(?, city)',
      'utm_campaign = COALESCE(?, utm_campaign)',
      'utm_source = COALESCE(?, utm_source)',
      'utm_medium = COALESCE(?, utm_medium)',
      'utm_content = COALESCE(?, utm_content)',
      'utm_term = COALESCE(?, utm_term)',
      'referrer = COALESCE(?, referrer)',
      'entry_url = COALESCE(?, entry_url)',
      'is_checking_out = ?',
      'checkout_started_at = ?',
      'has_purchased = ?',
      'purchased_at = COALESCE(?, purchased_at)',
      'ua_device_type = COALESCE(?, ua_device_type)',
      'ua_platform = COALESCE(?, ua_platform)',
      'ua_model = COALESCE(?, ua_model)',
      'ua_browser = COALESCE(?, ua_browser)',
      'ua_browser_version = COALESCE(?, ua_browser_version)',
      'bs_source = COALESCE(?, bs_source)',
      'bs_campaign_id = COALESCE(?, bs_campaign_id)',
      'bs_adgroup_id = COALESCE(?, bs_adgroup_id)',
      'bs_ad_id = COALESCE(?, bs_ad_id)',
    ];
    const params = [
      now,
      lastPath,
      lastProductHandle,
      cartQty,
      cartValue,
      cartCurrency,
      orderTotal,
      orderCurrency,
      normalizedCountry,
      city,
      utmCampaign,
      utmSource,
      utmMedium,
      utmContent,
      utmTerm,
      updateReferrer,
      updateEntryUrl,
      isCheckingOut,
      checkoutStartedAt,
      hasPurchased,
      purchasedAt,
      uaDeviceType,
      uaPlatform,
      uaModel,
      uaBrowser,
      uaBrowserVersion,
      updateBsSource,
      updateBsCampaignId,
      updateBsAdgroupId,
      updateBsAdId,
    ];

    if (supportsBsNetwork) {
      setParts.push('bs_network = COALESCE(?, bs_network)');
      params.push(updateBsNetwork);
    }

    if (cfKnownBot != null) {
      setParts.push('cf_known_bot = ?');
      params.push(cfKnownBot);
    }
    if (cfVerifiedBotCategory !== undefined && cfVerifiedBotCategory !== null) {
      setParts.push('cf_verified_bot_category = ?');
      params.push(cfVerifiedBotCategory);
    }
    if (cfCountry !== undefined && cfCountry !== null) {
      setParts.push('cf_country = ?');
      params.push(cfCountry);
    }
    if (cfCity !== undefined && cfCity !== null) {
      setParts.push('cf_city = ?');
      params.push(cfCity);
    }
    if (cfColo !== undefined && cfColo !== null) {
      setParts.push('cf_colo = ?');
      params.push(cfColo);
    }
    if (cfAsn !== undefined && cfAsn !== null) {
      setParts.push('cf_asn = ?');
      params.push(cfAsn);
    }

    params.push(payload.session_id);
    await db.run(`UPDATE sessions SET ${setParts.join(', ')} WHERE session_id = ?`, params);
  }

  // Persist Acquisition fields (device_key + attribution_*) at write-time (best-effort; fail-open).
  try {
    const ok = await sessionsHasAcquisitionColumns(db);
    if (ok) {
      const existingDeviceKey = existing && existing.device_key != null ? String(existing.device_key) : '';
      const existingVariant = existing && existing.attribution_variant != null ? String(existing.attribution_variant) : '';
      const needs = !existing || !existingDeviceKey.trim() || !existingVariant.trim();
      if (needs) {
        await ensureSessionAcquisitionFields({
          sessionId: payload.session_id,
          nowMs: now,
          entryUrl,
          referrer,
          utmSource,
          utmMedium,
          utmCampaign,
          utmContent,
          utmTerm,
          uaDeviceType,
          uaPlatform,
          existingUaDeviceType: existing?.ua_device_type ?? null,
          existingUaPlatform: existing?.ua_platform ?? null,
          existingDeviceKey,
          existingVariant,
        });
      }
    }
  } catch (_) {}

  await maybeMarkAbandoned(payload.session_id);
  return { sessionId: payload.session_id, visitorId: payload.visitor_id };
}

async function ensureSessionAcquisitionFields(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const sessionId = o.sessionId != null ? String(o.sessionId).trim() : '';
  if (!sessionId) return;

  const db = getDb();
  let ok = false;
  try {
    ok = await sessionsHasAcquisitionColumns(db);
  } catch (_) {
    ok = false;
  }
  if (!ok) return;

  const existingDeviceKey = typeof o.existingDeviceKey === 'string' ? o.existingDeviceKey.trim() : '';
  const existingVariant = typeof o.existingVariant === 'string' ? o.existingVariant.trim() : '';
  const needsDevice = !existingDeviceKey;
  const needsAttribution = !existingVariant;
  if (!needsDevice && !needsAttribution) return;

  const uaDeviceTypeEffective =
    normalizeUaDeviceType(o.uaDeviceType) ||
    normalizeUaDeviceType(o.existingUaDeviceType) ||
    'unknown';
  const uaPlatformEffective =
    normalizeUaPlatform(o.uaPlatform) ||
    normalizeUaPlatform(o.existingUaPlatform) ||
    'other';
  const deviceKey = String(uaDeviceTypeEffective || 'unknown') + ':' + String(uaPlatformEffective || 'other');

  const nowMs = Number.isFinite(Number(o.nowMs)) ? Number(o.nowMs) : Date.now();
  const entryUrl = typeof o.entryUrl === 'string' ? o.entryUrl.trim().slice(0, 2048) : '';
  const referrer = typeof o.referrer === 'string' ? o.referrer.trim().slice(0, 2048) : '';
  const utmSource = typeof o.utmSource === 'string' ? o.utmSource.trim().slice(0, 256) : '';
  const utmMedium = typeof o.utmMedium === 'string' ? o.utmMedium.trim().slice(0, 256) : '';
  const utmCampaign = typeof o.utmCampaign === 'string' ? o.utmCampaign.trim().slice(0, 256) : '';
  const utmContent = typeof o.utmContent === 'string' ? o.utmContent.trim().slice(0, 256) : '';
  const utmTerm = typeof o.utmTerm === 'string' ? o.utmTerm.trim().slice(0, 256) : '';

  let derived = null;
  if (needsAttribution) {
    try {
      derived = await deriveAttribution({
        now_ms: nowMs,
        entry_url: entryUrl,
        referrer,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
        utm_content: utmContent,
        utm_term: utmTerm,
      });
    } catch (_) {
      derived = null;
    }
  }

  const channel = derived && derived.channel ? String(derived.channel) : null;
  const source = derived && derived.source ? String(derived.source) : null;
  const variant = derived && derived.variant ? String(derived.variant) : null;
  const tag = derived && derived.tag ? String(derived.tag) : null;
  const confidence = derived && derived.confidence ? String(derived.confidence) : null;
  let evidenceJson = null;
  try {
    evidenceJson = derived && derived.evidence_json != null ? JSON.stringify(derived.evidence_json) : null;
  } catch (_) {
    evidenceJson = null;
  }

  try {
    await db.run(
      `
        UPDATE sessions SET
          device_key = COALESCE(NULLIF(TRIM(device_key), ''), ?),
          attribution_channel = COALESCE(NULLIF(TRIM(attribution_channel), ''), ?),
          attribution_source = COALESCE(NULLIF(TRIM(attribution_source), ''), ?),
          attribution_variant = COALESCE(NULLIF(TRIM(attribution_variant), ''), ?),
          attribution_tag = COALESCE(NULLIF(TRIM(attribution_tag), ''), ?),
          attribution_confidence = COALESCE(NULLIF(TRIM(attribution_confidence), ''), ?),
          attribution_evidence_json = COALESCE(NULLIF(TRIM(attribution_evidence_json), ''), ?)
        WHERE session_id = ?
      `,
      [deviceKey, channel, source, variant, tag, confidence, evidenceJson, sessionId]
    );
  } catch (_) {}
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
  function normalizeCheckoutToken(v) {
    // IMPORTANT: do NOT String() non-strings (can become "[object Object]" and collapse dedupe).
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 128 ? s.slice(0, 128) : s;
  }
  function normalizeOrderId(v) {
    // Prefer numeric Shopify order id. Ignore objects (String(obj) => "[object Object]").
    if (v == null) return null;
    const t = typeof v;
    if (t !== 'string' && t !== 'number') return null;
    const extracted = salesTruth.extractNumericId(v);
    const s = extracted != null ? String(extracted).trim() : '';
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 64 ? s.slice(0, 64) : s;
  }

  const orderId = normalizeOrderId(payload.order_id);
  const token = normalizeCheckoutToken(payload.checkout_token);
  // Prefer checkout_token because Shopify can emit checkout_completed once before order_id exists,
  // and again after the order is created. Both events share the same checkout_token.
  if (token) return 'token:' + token;
  if (orderId) return 'order:' + orderId;
  // 15-min bucket so multiple checkout_completed events for same order (e.g. thank-you reload) dedupe
  const tsNum = payload.ts != null ? Number(payload.ts) : NaN;
  const ts = Number.isFinite(tsNum) ? tsNum : Date.now();
  const round15Min = Math.floor(ts / (15 * 60000));
  const cur = typeof payload.order_currency === 'string' ? payload.order_currency.trim() : '';
  const tot = payload.order_total != null ? String(payload.order_total) : '';
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + round15Min + '|' + sessionId).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function insertPurchase(payload, sessionId, countryCode) {
  if (!isCheckoutCompletedPayload(payload)) return;
  const db = getDb();
  const tsNum = payload.ts != null ? Number(payload.ts) : NaN;
  const now = Number.isFinite(tsNum) ? tsNum : Date.now();
  const purchaseKey = computePurchaseKey(payload, sessionId);
  const orderTotal = payload.order_total != null ? (typeof payload.order_total === 'number' ? payload.order_total : parseFloat(payload.order_total)) : null;
  const orderCurrency = typeof payload.order_currency === 'string' && payload.order_currency.trim() ? payload.order_currency.trim() : null;
  // Keep stored fields consistent with computePurchaseKey (avoid "[object Object]" junk).
  const orderId = (function () {
    if (payload.order_id == null) return null;
    const t = typeof payload.order_id;
    if (t !== 'string' && t !== 'number') return null;
    const extracted = salesTruth.extractNumericId(payload.order_id);
    const s = extracted != null ? String(extracted).trim() : '';
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 64 ? s.slice(0, 64) : s;
  })();
  const checkoutToken = (function () {
    if (typeof payload.checkout_token !== 'string') return null;
    const s = payload.checkout_token.trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 128 ? s.slice(0, 128) : s;
  })();
  const country = normalizeCountry(countryCode) || null;
  const paymentGateway = normalizePaymentKey(payload.payment_gateway, 64);
  const paymentMethodName = normalizePaymentLabel(payload.payment_method_name, 96);
  const paymentMethodType = normalizePaymentKey(payload.payment_method_type, 32);
  const paymentCardBrand = normalizePaymentKey(payload.payment_card_brand, 32);
  const paymentMethod = normalizePaymentMethod({
    gateway: paymentGateway,
    methodType: paymentMethodType,
    methodName: paymentMethodName,
    cardBrand: paymentCardBrand,
  });
  const paymentMethodKey = paymentMethod && paymentMethod.key ? String(paymentMethod.key) : 'other';
  const paymentMethodLabel = paymentMethod && paymentMethod.label ? String(paymentMethod.label) : 'Other';

  if (config.dbUrl) {
    await db.run(`
      INSERT INTO purchases (
        purchase_key, session_id, visitor_id, purchased_at,
        order_total, order_currency, order_id, checkout_token, country_code,
        payment_gateway, payment_method_name, payment_method_type, payment_card_brand,
        payment_method_key, payment_method_label
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (purchase_key) DO UPDATE SET
        order_total = COALESCE(purchases.order_total, EXCLUDED.order_total),
        order_currency = COALESCE(purchases.order_currency, EXCLUDED.order_currency),
        order_id = COALESCE(purchases.order_id, EXCLUDED.order_id),
        checkout_token = COALESCE(purchases.checkout_token, EXCLUDED.checkout_token),
        country_code = COALESCE(purchases.country_code, EXCLUDED.country_code),
        payment_gateway = COALESCE(purchases.payment_gateway, EXCLUDED.payment_gateway),
        payment_method_name = COALESCE(purchases.payment_method_name, EXCLUDED.payment_method_name),
        payment_method_type = COALESCE(purchases.payment_method_type, EXCLUDED.payment_method_type),
        payment_card_brand = COALESCE(purchases.payment_card_brand, EXCLUDED.payment_card_brand),
        payment_method_key = CASE
          WHEN purchases.payment_method_key IS NULL OR purchases.payment_method_key = 'other' THEN EXCLUDED.payment_method_key
          ELSE purchases.payment_method_key
        END,
        payment_method_label = CASE
          WHEN purchases.payment_method_label IS NULL OR purchases.payment_method_key IS NULL OR purchases.payment_method_key = 'other' THEN EXCLUDED.payment_method_label
          ELSE purchases.payment_method_label
        END
    `, [
      purchaseKey, sessionId, payload.visitor_id ?? null, now,
      Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country,
      paymentGateway, paymentMethodName, paymentMethodType, paymentCardBrand,
      paymentMethodKey, paymentMethodLabel,
    ]);
  } else {
    await db.run(`
      INSERT OR IGNORE INTO purchases (
        purchase_key, session_id, visitor_id, purchased_at,
        order_total, order_currency, order_id, checkout_token, country_code,
        payment_gateway, payment_method_name, payment_method_type, payment_card_brand,
        payment_method_key, payment_method_label
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      purchaseKey, sessionId, payload.visitor_id ?? null, now,
      Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country,
      paymentGateway, paymentMethodName, paymentMethodType, paymentCardBrand,
      paymentMethodKey, paymentMethodLabel,
    ]);
    await db.run(`
      UPDATE purchases
         SET order_total = COALESCE(order_total, ?),
             order_currency = COALESCE(order_currency, ?),
             order_id = COALESCE(order_id, ?),
             checkout_token = COALESCE(checkout_token, ?),
             country_code = COALESCE(country_code, ?),
             payment_gateway = COALESCE(payment_gateway, ?),
             payment_method_name = COALESCE(payment_method_name, ?),
             payment_method_type = COALESCE(payment_method_type, ?),
             payment_card_brand = COALESCE(payment_card_brand, ?),
             payment_method_key = CASE
               WHEN payment_method_key IS NULL OR payment_method_key = 'other' THEN ?
               ELSE payment_method_key
             END,
             payment_method_label = CASE
               WHEN payment_method_label IS NULL OR payment_method_key IS NULL OR payment_method_key = 'other' THEN ?
               ELSE payment_method_label
             END
       WHERE purchase_key = ?
    `, [
      Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country,
      paymentGateway, paymentMethodName, paymentMethodType,
      paymentCardBrand,
      paymentMethodKey,
      paymentMethodLabel,
      purchaseKey,
    ]).catch(() => null);
  }
  // Never delete purchase rows (project rule: no DB deletes without backup). Dedupe is done in stats queries only.
}

/** "Today (24h)" tab: last 24 hours. "All (60 min)" tab: last 60 min. Cleanup uses SESSION_RETENTION_DAYS. */
const TODAY_WINDOW_MINUTES = 24 * 60;
const ALL_SESSIONS_WINDOW_MINUTES = 60;

async function attachSessionActionStats(sessions) {
  const db = getDb();
  const list = Array.isArray(sessions) ? sessions : [];
  if (!list.length) return;

  const ids = [];
  for (const s of list) {
    const sid = (s && s.session_id != null) ? String(s.session_id).trim() : '';
    if (sid) ids.push(sid);
  }
  if (!ids.length) return;

  const seen = new Set();
  const uniq = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }

  const CHUNK = 200;
  const map = new Map(); // session_id -> { actions_count, last_event_ts, last_action_ts }

  for (let start = 0; start < uniq.length; start += CHUNK) {
    const chunk = uniq.slice(start, start + CHUNK);
    if (!chunk.length) continue;

    let sql = `
      SELECT
        session_id,
        SUM(CASE WHEN type <> 'heartbeat' THEN 1 ELSE 0 END) AS actions_count,
        MAX(CASE WHEN type <> 'heartbeat' THEN ts END) AS last_action_ts,
        MAX(ts) AS last_event_ts
      FROM events
      WHERE session_id IN (
    `;
    const params = [];
    let idx = 0;
    const ph = () => (config.dbUrl ? `$${++idx}` : '?');
    sql += chunk.map(() => ph()).join(', ');
    sql += `)
      GROUP BY session_id
    `;
    params.push(...chunk);

    const rows = await db.all(sql, params);
    for (const r of rows || []) {
      const sid = r && r.session_id != null ? String(r.session_id) : '';
      if (!sid) continue;
      map.set(sid, {
        actions_count: r.actions_count != null ? Number(r.actions_count) : 0,
        last_action_ts: r.last_action_ts != null ? Number(r.last_action_ts) : null,
        last_event_ts: r.last_event_ts != null ? Number(r.last_event_ts) : null,
      });
    }
  }

  for (const s of list) {
    const sid = (s && s.session_id != null) ? String(s.session_id).trim() : '';
    if (!sid) continue;
    const stats = map.get(sid);
    s.actions_count = stats && Number.isFinite(stats.actions_count) ? Math.max(0, Math.round(stats.actions_count)) : 0;
    s.last_action_ts = (stats && stats.last_action_ts != null && Number.isFinite(stats.last_action_ts)) ? Number(stats.last_action_ts) : null;
    s.last_event_ts = (stats && stats.last_event_ts != null && Number.isFinite(stats.last_event_ts)) ? Number(stats.last_event_ts) : null;
  }
}

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
      v.device, v.network_speed,
      (SELECT payment_gateway FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_gateway,
      (SELECT payment_method_name FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_method_name,
      (SELECT payment_method_type FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_method_type
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
  await attachSessionActionStats(sessions);
  await shopifyLandingMeta.enrichSessionsWithLandingTitles(sessions);
  return sessions;
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

/**
 * Time-bucketed active-online series for live chart.
 * Returns bucketed counts using the same active/arrived windows as listSessions('active').
 */
async function getActiveSessionSeries(minutes = 10, stepMinutes = 1) {
  const db = getDb();
  const safeStepMinutes = Math.max(1, Math.min(15, parseInt(String(stepMinutes || 1), 10) || 1));
  const safeMinutes = Math.max(safeStepMinutes * 2, Math.min(60, parseInt(String(minutes || 10), 10) || 10));
  const stepMs = safeStepMinutes * 60 * 1000;
  const bucketCount = Math.max(2, Math.floor(safeMinutes / safeStepMinutes));
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  const start = end - (bucketCount - 1) * stepMs;
  const activeWindowMs = config.activeWindowMinutes * 60 * 1000;
  const arrivedWindowMs = config.liveArrivedWindowMinutes * 60 * 1000;

  let rows = [];
  if (config.dbUrl) {
    rows = await db.all(
      `WITH buckets AS (
         SELECT generate_series($1::bigint, $2::bigint, $3::bigint) AS ts
       )
       SELECT b.ts::bigint AS ts,
              COUNT(s.session_id)::bigint AS online
       FROM buckets b
       LEFT JOIN sessions s
         ON COALESCE(s.started_at, 0) <= b.ts
        AND COALESCE(s.last_seen, s.started_at, 0) >= (b.ts - $4::bigint)
        AND COALESCE(s.started_at, 0) >= (b.ts - $5::bigint)
       GROUP BY b.ts
       ORDER BY b.ts ASC`,
      [start, end, stepMs, activeWindowMs, arrivedWindowMs]
    );
  } else {
    rows = await db.all(
      `WITH RECURSIVE buckets(ts, n) AS (
         SELECT ? AS ts, 0
         UNION ALL
         SELECT ts + ?, n + 1
         FROM buckets
         WHERE n + 1 < ?
       )
       SELECT b.ts AS ts,
              COUNT(s.session_id) AS online
       FROM buckets b
       LEFT JOIN sessions s
         ON COALESCE(s.started_at, 0) <= b.ts
        AND COALESCE(s.last_seen, s.started_at, 0) >= (b.ts - ?)
        AND COALESCE(s.started_at, 0) >= (b.ts - ?)
       GROUP BY b.ts
       ORDER BY b.ts ASC`,
      [start, stepMs, bucketCount, activeWindowMs, arrivedWindowMs]
    );
  }

  return (rows || []).map((r) => {
    const ts = r && r.ts != null ? Number(r.ts) : null;
    const online = r && r.online != null ? Number(r.online) : 0;
    return {
      ts: Number.isFinite(ts) ? ts : null,
      online: Number.isFinite(online) ? Math.max(0, Math.trunc(online)) : 0,
    };
  }).filter((p) => Number.isFinite(p.ts));
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
  // Partial day: p:YYYY-MM-DD:HH:MM (in admin timezone)
  if (typeof rangeKey === 'string' && rangeKey.startsWith('p:')) {
    const m = rangeKey.match(/^p:(\d{4})-(\d{2})-(\d{2}):(\d{2}):(\d{2})$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      const hh = parseInt(m[4], 10);
      const mm = parseInt(m[5], 10);
      if (
        Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) &&
        Number.isFinite(hh) && Number.isFinite(mm) &&
        month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
        hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59
      ) {
        const start = zonedTimeToUtcMs(year, month, day, 0, 0, 0, timeZone);
        const endTarget = zonedTimeToUtcMs(year, month, day, hh, mm, 0, timeZone);
        const nextParts = addDaysToParts({ year, month, day }, 1);
        const endFull = zonedTimeToUtcMs(nextParts.year, nextParts.month, nextParts.day, 0, 0, 0, timeZone);
        let end = Math.min(endTarget, endFull);
        if (end > nowMs) end = nowMs;
        if (start >= nowMs) return { start: nowMs, end: nowMs };
        return { start, end: Math.max(start, end) };
      }
    }
  }
  // Custom range: r:YYYY-MM-DD:YYYY-MM-DD (inclusive, admin timezone)
  if (typeof rangeKey === 'string' && rangeKey.startsWith('r:')) {
    const m = rangeKey.match(/^r:(\d{4})-(\d{2})-(\d{2}):(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const sy = parseInt(m[1], 10);
      const sm = parseInt(m[2], 10);
      const sd = parseInt(m[3], 10);
      const ey = parseInt(m[4], 10);
      const em = parseInt(m[5], 10);
      const ed = parseInt(m[6], 10);
      if (
        Number.isFinite(sy) && Number.isFinite(sm) && Number.isFinite(sd) && sm >= 1 && sm <= 12 && sd >= 1 && sd <= 31 &&
        Number.isFinite(ey) && Number.isFinite(em) && Number.isFinite(ed) && em >= 1 && em <= 12 && ed >= 1 && ed <= 31
      ) {
        const aYmd = `${m[1]}-${m[2]}-${m[3]}`;
        const bYmd = `${m[4]}-${m[5]}-${m[6]}`;
        const useAForStart = aYmd <= bYmd;
        const startY = useAForStart ? sy : ey;
        const startM = useAForStart ? sm : em;
        const startD = useAForStart ? sd : ed;
        const endY = useAForStart ? ey : sy;
        const endM = useAForStart ? em : sm;
        const endD = useAForStart ? ed : sd;

        const start = zonedTimeToUtcMs(startY, startM, startD, 0, 0, 0, timeZone);
        const endNextParts = addDaysToParts({ year: endY, month: endM, day: endD }, 1);
        const endFull = zonedTimeToUtcMs(endNextParts.year, endNextParts.month, endNextParts.day, 0, 0, 0, timeZone);
        const endIsToday = endY === todayParts.year && endM === todayParts.month && endD === todayParts.day;
        let end = endIsToday ? nowMs : endFull;

        // Clamp future end.
        if (end > nowMs) end = nowMs;

        // Clamp future start.
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
  if (rangeKey === '14d') {
    const startParts = addDaysToParts(todayParts, -13);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === '30d') {
    const startParts = addDaysToParts(todayParts, -29);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === 'month') {
    const startOfMonth = zonedTimeToUtcMs(todayParts.year, todayParts.month, 1, 0, 0, 0, timeZone);
    return { start: startOfMonth, end: nowMs };
  }
  return { start: nowMs, end: nowMs };
}

// Platform start date: never return data before Feb 1 2025
const PLATFORM_START_MS = zonedTimeToUtcMs(2025, 2, 1, 0, 0, 0, 'Europe/London');
const _origGetRangeBounds = getRangeBounds;
getRangeBounds = function(rangeKey, nowMs, timeZone) {
  const bounds = _origGetRangeBounds(rangeKey, nowMs, timeZone);
  if (bounds.start < PLATFORM_START_MS) bounds.start = PLATFORM_START_MS;
  if (bounds.end < PLATFORM_START_MS) bounds.end = PLATFORM_START_MS;
  return bounds;
};

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
  const latestByYmd = await Promise.all(
    ymds.map(async (ymd) => ({ ymd, latest: await getLatestShopifySessionsSnapshot(safeShop, ymd) }))
  );
  let total = 0;
  const missingYmds = [];

  for (const { ymd, latest } of latestByYmd) {
    const isToday = ymd === todayYmd;
    const freshEnough = latest && typeof latest.sessionsCount === 'number' && (!isToday || (latest.fetchedAt && (Date.now() - latest.fetchedAt) < SHOPIFY_SESSIONS_TODAY_REFRESH_MS));
    if (freshEnough) {
      total += Number(latest.sessionsCount) || 0;
    } else {
      if (!fetchIfMissing) return null;
      missingYmds.push(ymd);
    }
  }

  if (!missingYmds.length) return total;

  const fetchedCounts = await Promise.all(
    missingYmds.map(async (ymd) => {
      const inflightKey = safeShop + '|' + ymd;
      let p = shopifySessionsFetchInflight.get(inflightKey);
      if (!p) {
        p = fetchShopifySessionsCountForDay(safeShop, ymd, tz).catch(() => null).finally(() => {
          if (shopifySessionsFetchInflight.get(inflightKey) === p) shopifySessionsFetchInflight.delete(inflightKey);
        });
        shopifySessionsFetchInflight.set(inflightKey, p);
      }
      return p;
    })
  );

  for (const fetched of fetchedCounts) {
    if (typeof fetched === 'number') total += fetched;
    else return null;
  }
  return total;
}

function hasPartialHistoricalDayWindow(startMs, endMs, timeZone) {
  const tz = timeZone || resolveAdminTimeZone();
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;

  const ymds = listYmdsInBounds(start, end, tz);
  if (!ymds.length) return false;
  const todayYmd = ymdFromMs(Date.now(), tz);

  for (const ymd of ymds) {
    if (ymd === todayYmd) continue;
    let dayBounds = null;
    try { dayBounds = getRangeBounds('d:' + ymd, Date.now(), tz); } catch (_) { dayBounds = null; }
    if (!dayBounds) continue;
    const dayStart = Number(dayBounds.start);
    const dayEnd = Number(dayBounds.end);
    if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) continue;
    const segStart = Math.max(start, dayStart);
    const segEnd = Math.min(end, dayEnd);
    if (!(segEnd > segStart)) continue;
    // Historical Shopify sessions snapshots are day-granular only.
    // If the requested historical segment is partial, snapshot counts would over/under-count.
    if (segStart > dayStart || segEnd < dayEnd) return true;
  }
  return false;
}

/** List sessions in a date range with pagination. Used by Live tab when Today/Yesterday/3d/7d/1h/Sales is selected. */
async function listSessionsByRange(rangeKey, timeZone, limit, offset) {
  const db = getDb();
  const now = Date.now();
  const tz = timeZone || resolveAdminTimeZone();
  const isSales = rangeKey === 'sales';
  // Sales is a "Today" sub-view: show only converted sessions in today's date bounds (admin TZ).
  const boundsKey = isSales ? 'today' : rangeKey;
  const bounds = getRangeBounds(boundsKey, now, tz);
  const { start, end } = bounds;
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

  // Last Hour: filter by activity (last_seen) so we show sessions active in the last hour, not only sessions that started in the last hour
  const useLastSeen = rangeKey === '1h';
  const timeCol = isSales ? 's.purchased_at' : (useLastSeen ? 's.last_seen' : 's.started_at');
  const purchasedFilterSql = isSales ? ' AND s.has_purchased = 1' : '';

  const baseSql = `
    SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
      COALESCE(s.country_code, v.last_country) AS session_country,
      v.device, v.network_speed,
      (SELECT payment_gateway FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_gateway,
      (SELECT payment_method_name FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_method_name,
      (SELECT payment_method_type FROM purchases p WHERE p.session_id = s.session_id ORDER BY p.purchased_at DESC LIMIT 1) AS payment_method_type
    FROM sessions s
    LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE ${timeCol} >= ${config.dbUrl ? '$1' : '?'} AND ${timeCol} < ${config.dbUrl ? '$2' : '?'}${purchasedFilterSql}
  `;
  const baseParams = [start, end];

  const countSql = config.dbUrl
    ? 'SELECT COUNT(*) AS n FROM sessions s WHERE ' + timeCol + ' >= $1 AND ' + timeCol + ' < $2' + purchasedFilterSql
    : 'SELECT COUNT(*) AS n FROM sessions s WHERE ' + timeCol + ' >= ? AND ' + timeCol + ' < ?' + purchasedFilterSql;
  const countRow = await db.get(countSql, [start, end]);
  const total = (countRow && countRow.n != null) ? Number(countRow.n) : 0;

  const orderBy = isSales ? ' ORDER BY s.purchased_at DESC, s.last_seen DESC' : ' ORDER BY s.last_seen DESC';
  const orderLimitOffset = orderBy + ' LIMIT ' + (config.dbUrl ? '$3' : '?') + ' OFFSET ' + (config.dbUrl ? '$4' : '?');
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

  await attachSessionActionStats(sessions);
  await shopifyLandingMeta.enrichSessionsWithLandingTitles(sessions);
  return { sessions, total };
}

/** Latest converted sessions by purchased_at desc. Used for /dashboard/live "Latest sales" widget. */
async function listLatestSales(limit = 5) {
  const db = getDb();
  const lim = Math.max(1, Math.min(50, parseInt(String(limit), 10) || 5));
  const rows = await db.all(
    config.dbUrl
      ? `
        SELECT
          s.session_id,
          s.purchased_at,
          s.order_total,
          s.order_currency,
          s.last_product_handle,
          s.first_product_handle,
          COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(v.last_country), ''), NULLIF(TRIM(s.cf_country), '')) AS session_country
        FROM sessions s
        LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
        WHERE s.has_purchased = 1 AND s.purchased_at IS NOT NULL
        ORDER BY s.purchased_at DESC
        LIMIT $1
      `
      : `
        SELECT
          s.session_id,
          s.purchased_at,
          s.order_total,
          s.order_currency,
          s.last_product_handle,
          s.first_product_handle,
          COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(v.last_country), ''), NULLIF(TRIM(s.cf_country), '')) AS session_country
        FROM sessions s
        LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
        WHERE s.has_purchased = 1 AND s.purchased_at IS NOT NULL
        ORDER BY s.purchased_at DESC
        LIMIT ?
      `,
    [lim]
  );
  const shop = salesTruth.resolveShopForSales('');
  let ratesToGbp = null;
  try { ratesToGbp = await fx.getRatesToGbp(); } catch (_) { ratesToGbp = null; }
  let accessToken = '';
  try { accessToken = shop ? await salesTruth.getAccessToken(shop) : ''; } catch (_) { accessToken = ''; }
  if (typeof accessToken !== 'string') accessToken = '';
  accessToken = accessToken.trim();

  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }

  function safeStr(v, maxLen = 256) {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  function safeNonJunkStr(v, maxLen = 256) {
    const s = safeStr(v, maxLen);
    if (!s) return '';
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return '';
    return s;
  }

  function normalizeProductId(v) {
    const extracted = salesTruth.extractNumericId(v);
    const s = safeNonJunkStr(extracted, 64);
    if (!s) return null;
    if (/^\d+$/.test(s)) return s;
    const m = s.match(/gid:\/\/shopify\/Product\/(\d+)/i);
    if (m && m[1]) return m[1];
    return null;
  }

  function numOrNull(v) {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function round2(n) {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100) / 100;
  }

  function parseTopProductFromOrderRawJson(rawJson) {
    const order = safeJsonParse(rawJson);
    const items = order && Array.isArray(order.line_items) ? order.line_items : [];
    let best = null;
    for (const li of items) {
      const title = safeStr(li && li.title, 256);
      if (!title) continue;
      const qtyRaw = li && li.quantity != null ? li.quantity : 1;
      const qty = (() => {
        const n = typeof qtyRaw === 'number' ? qtyRaw : parseInt(String(qtyRaw), 10);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
      })();
      const priceRaw =
        (li && li.price != null ? li.price : null) ??
        li?.price_set?.shop_money?.amount ??
        li?.priceSet?.shopMoney?.amount ??
        null;
      const unit = numOrNull(priceRaw) ?? 0;
      const lineTotal = unit * qty;
      if (!Number.isFinite(lineTotal)) continue;
      const productIdRaw = (li && li.product_id != null ? li.product_id : null) ?? li?.productId ?? null;
      const productId = productIdRaw != null ? safeStr(productIdRaw, 64) : '';
      if (!best || lineTotal > best.lineTotal || (lineTotal === best.lineTotal && unit > best.unit)) {
        best = { title, unit, qty, lineTotal, productId: productId || null };
      }
    }
    return best ? { title: best.title || '', productId: best.productId || null } : { title: '', productId: null };
  }

  const purchaseLinkCache = new Map(); // session_id -> { order_id, checkout_token, order_total, order_currency } | null
  const purchaseEvidenceCache = new Map(); // session_id -> { linked_order_id, order_id, checkout_token, currency, total_price, occurred_at, received_at } | null
  const truthOrderCache = new Map(); // key -> order row | null
  const topProductCache = new Map(); // order_id -> { title, productId } | null

  async function getLatestPurchaseLink(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    if (purchaseLinkCache.has(sid)) return purchaseLinkCache.get(sid);
    let row = null;
    try {
      row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, checkout_token, order_total, order_currency
            FROM purchases
            WHERE session_id = $1
            ORDER BY purchased_at DESC
            LIMIT 1
          `
          : `
            SELECT order_id, checkout_token, order_total, order_currency
            FROM purchases
            WHERE session_id = ?
            ORDER BY purchased_at DESC
            LIMIT 1
          `,
        [sid]
      );
    } catch (_) {
      row = null;
    }
    purchaseLinkCache.set(sid, row || null);
    return row || null;
  }

  async function getLatestPurchaseEvidence(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!shop || !sid) return null;
    if (purchaseEvidenceCache.has(sid)) return purchaseEvidenceCache.get(sid);
    let best = null;
    try {
      const rows = await db.all(
        `
          SELECT linked_order_id, order_id, checkout_token, currency, total_price, occurred_at, received_at
          FROM purchase_events
          WHERE shop = ? AND session_id = ?
            AND event_type IN ('checkout_completed', 'checkout_started')
          ORDER BY occurred_at DESC, received_at DESC
          LIMIT 10
        `,
        [shop, sid]
      );
      let bestAny = null;
      let bestLinked = null;
      let bestOrder = null;
      let bestToken = null;
      for (const r of (rows || [])) {
        const cand = {
          linked_order_id: safeNonJunkStr(r && r.linked_order_id, 64) || null,
          order_id: safeNonJunkStr(r && r.order_id, 64) || null,
          checkout_token: safeNonJunkStr(r && r.checkout_token, 128) || null,
          currency: safeNonJunkStr(r && r.currency, 16) || null,
          total_price: numOrNull(r && r.total_price),
          occurred_at: numOrNull(r && r.occurred_at),
          received_at: numOrNull(r && r.received_at),
        };
        if (!bestAny) bestAny = cand;
        if (!bestLinked && cand.linked_order_id) bestLinked = cand;
        if (!bestOrder && cand.order_id) bestOrder = cand;
        if (!bestToken && cand.checkout_token) bestToken = cand;
      }
      best = bestLinked || bestOrder || bestToken || bestAny || null;
    } catch (_) {
      best = null;
    }
    purchaseEvidenceCache.set(sid, best || null);
    return best || null;
  }

  async function getTruthOrderByOrderId(orderId) {
    const oid = safeStr(orderId, 64);
    if (!shop || !oid) return null;
    const key = 'order:' + oid;
    if (truthOrderCache.has(key)) return truthOrderCache.get(key);
    let row = null;
    try {
      row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = $1 AND order_id = $2
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            LIMIT 1
          `
          : `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = ? AND order_id = ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            LIMIT 1
          `,
        [shop, oid]
      );
    } catch (_) {
      row = null;
    }
    truthOrderCache.set(key, row || null);
    return row || null;
  }

  async function getTopProductForTruthOrder(truthOrder) {
    const oid = safeNonJunkStr(truthOrder && truthOrder.order_id, 64);
    if (!shop || !oid) return { title: '', productId: null };
    if (topProductCache.has(oid)) return topProductCache.get(oid) || { title: '', productId: null };
    let out = null;
    // Prefer persisted truth line items (has stable product_id), fall back to orders_shopify.raw_json.
    try {
      const rows = await db.all(
        `
          SELECT
            TRIM(li.product_id) AS product_id,
            NULLIF(TRIM(li.title), '') AS title,
            li.quantity AS quantity,
            li.unit_price AS unit_price,
            li.line_revenue AS line_revenue
          FROM orders_shopify_line_items li
          WHERE li.shop = ? AND li.order_id = ?
            AND (li.order_test IS NULL OR li.order_test = 0)
            AND li.order_cancelled_at IS NULL
            AND li.order_financial_status = 'paid'
          ORDER BY COALESCE(li.line_revenue, 0) DESC, COALESCE(li.unit_price, 0) DESC, COALESCE(li.quantity, 0) DESC
          LIMIT 10
        `,
        [shop, oid]
      );
      let best = null;
      for (const r of (rows || [])) {
        const title = safeStr(r && r.title, 256);
        const productId = normalizeProductId(r && r.product_id);
        if (productId && title) { best = { title, productId }; break; }
        if (!best && title) best = { title, productId: productId || null };
      }
      if (best) out = { title: best.title || '', productId: best.productId || null };
    } catch (_) {
      out = null;
    }
    if (!out) {
      try {
        const raw = truthOrder && truthOrder.raw_json != null ? String(truthOrder.raw_json) : '';
        const top = parseTopProductFromOrderRawJson(raw);
        const pid = normalizeProductId(top && top.productId != null ? top.productId : null);
        const title = top && top.title ? String(top.title) : '';
        out = { title: title || '', productId: pid || null };
      } catch (_) {
        out = { title: '', productId: null };
      }
    }
    topProductCache.set(oid, out || null);
    return out || { title: '', productId: null };
  }

  async function getTruthOrderByCheckoutToken(checkoutToken) {
    const token = safeStr(checkoutToken, 128);
    if (!shop || !token) return null;
    const key = 'token:' + token;
    if (truthOrderCache.has(key)) return truthOrderCache.get(key);
    let row = null;
    try {
      row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = $1 AND checkout_token = $2
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            ORDER BY created_at DESC
            LIMIT 1
          `
          : `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = ? AND checkout_token = ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            ORDER BY created_at DESC
            LIMIT 1
          `,
        [shop, token]
      );
    } catch (_) {
      row = null;
    }
    truthOrderCache.set(key, row || null);
    return row || null;
  }

  async function findTruthOrderForSession(sessionId, purchasedAtMs, orderTotal, orderCurrency) {
    if (!shop) return null;
    const purchase = await getLatestPurchaseLink(sessionId);
    const directOrderId = safeStr(purchase && purchase.order_id, 64);
    const directToken = safeStr(purchase && purchase.checkout_token, 128);
    if (directOrderId) {
      const byId = await getTruthOrderByOrderId(directOrderId);
      if (byId) return byId;
    }
    if (directToken) {
      const byToken = await getTruthOrderByCheckoutToken(directToken);
      if (byToken) return byToken;
    }

    // Evidence-based lookup: more reliable than heuristics when available.
    const evidence = await getLatestPurchaseEvidence(sessionId);
    const linkedOrderId = safeNonJunkStr(evidence && evidence.linked_order_id, 64);
    const evOrderId = safeNonJunkStr(evidence && evidence.order_id, 64);
    const evToken = safeNonJunkStr(evidence && evidence.checkout_token, 128);
    if (linkedOrderId) {
      const byLinked = await getTruthOrderByOrderId(linkedOrderId);
      if (byLinked) return byLinked;
    }
    if (evOrderId) {
      const byEvId = await getTruthOrderByOrderId(evOrderId);
      if (byEvId) return byEvId;
    }
    if (evToken) {
      const byEvToken = await getTruthOrderByCheckoutToken(evToken);
      if (byEvToken) return byEvToken;
    }

    // Heuristic match: nearest paid truth order around purchased_at with matching currency + total.
    const ts = numOrNull(purchasedAtMs);
    const total = numOrNull(orderTotal);
    const cur = fx.normalizeCurrency(orderCurrency) || 'GBP';
    if (ts == null || total == null) return null;
    const WINDOW_MS = 2 * 60 * 60 * 1000;
    const start = Math.max(0, Math.trunc(ts - WINDOW_MS));
    const end = Math.trunc(ts + WINDOW_MS);
    const tol = 0.05;
    try {
      const row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = $1
              AND created_at >= $2 AND created_at <= $3
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
              AND total_price IS NOT NULL
              AND ABS(total_price - $4) <= $5
              AND COALESCE(NULLIF(TRIM(currency), ''), 'GBP') = $6
            ORDER BY ABS(created_at - $7) ASC
            LIMIT 1
          `
          : `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = ?
              AND created_at >= ? AND created_at <= ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
              AND total_price IS NOT NULL
              AND ABS(total_price - ?) <= ?
              AND COALESCE(NULLIF(TRIM(currency), ''), 'GBP') = ?
            ORDER BY ABS(created_at - ?) ASC
            LIMIT 1
          `,
        config.dbUrl
          ? [shop, start, end, total, tol, cur, ts]
          : [shop, start, end, total, tol, cur, ts]
      );
      return row || null;
    } catch (_) {
      return null;
    }
  }

  const out = [];
  for (const r of rows || []) {
    const sessionId = r && r.session_id != null ? String(r.session_id) : null;
    if (!sessionId) continue;
    const rawCountry = (r && r.session_country != null) ? String(r.session_country) : '';
    const cc = (rawCountry || 'XX').toUpperCase().slice(0, 2) || 'XX';
    const cur = (r && r.order_currency != null) ? String(r.order_currency).trim().toUpperCase() : '';
    const totalRaw = (r && r.order_total != null) ? (typeof r.order_total === 'number' ? r.order_total : parseFloat(String(r.order_total))) : null;
    const total = (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) ? totalRaw : null;
    const purchasedAtRaw = (r && r.purchased_at != null) ? (typeof r.purchased_at === 'number' ? r.purchased_at : Number(r.purchased_at)) : null;
    const purchasedAt = (typeof purchasedAtRaw === 'number' && Number.isFinite(purchasedAtRaw)) ? purchasedAtRaw : null;
    const lastHandle = (r && r.last_product_handle != null) ? String(r.last_product_handle).trim() : '';
    const firstHandle = (r && r.first_product_handle != null) ? String(r.first_product_handle).trim() : '';

    const purchaseLink = await getLatestPurchaseLink(sessionId);
    const evidence = await getLatestPurchaseEvidence(sessionId);
    const purchaseTotal = numOrNull(purchaseLink && purchaseLink.order_total);
    const evidenceTotal = numOrNull(evidence && evidence.total_price);
    const baseTotal = total != null ? total : (purchaseTotal != null ? purchaseTotal : evidenceTotal);
    const baseCur =
      fx.normalizeCurrency(cur) ||
      fx.normalizeCurrency(purchaseLink && purchaseLink.order_currency) ||
      fx.normalizeCurrency(evidence && evidence.currency) ||
      null;

    // Prefer truth order enrichment when available.
    let productTitle = null;
    let orderTotalGbp = null;
    let productId = null;
    let resolvedHandle = null;
    const truth = await findTruthOrderForSession(sessionId, purchasedAt, baseTotal, baseCur);
    if (truth) {
      const top = await getTopProductForTruthOrder(truth);
      productTitle = top && top.title ? String(top.title) : null;
      productId = top && top.productId ? String(top.productId) : null;
      if (productId && accessToken) {
        try {
          const meta = await productMetaCache.getProductMeta(shop, accessToken, productId);
          const h = meta && meta.ok && meta.handle ? safeNonJunkStr(meta.handle, 128) : '';
          if (h) resolvedHandle = h;
          if ((!productTitle || productTitle === 'Unknown') && meta && meta.ok && meta.title) {
            const t = safeStr(meta.title, 256);
            if (t) productTitle = t;
          }
        } catch (_) {}
      }
      const truthTotal = numOrNull(truth && truth.total_price);
      const truthCur = fx.normalizeCurrency(truth && truth.currency) || 'GBP';
      const gbp = (truthTotal != null) ? fx.convertToGbp(truthTotal, truthCur, ratesToGbp) : null;
      orderTotalGbp = round2(gbp);
    } else if (baseTotal != null) {
      const gbp = fx.convertToGbp(baseTotal, baseCur || 'GBP', ratesToGbp);
      orderTotalGbp = round2(gbp);
      resolvedHandle = lastHandle || firstHandle || null;
    }

    const outTotal = truth
      ? (numOrNull(truth && truth.total_price) != null ? numOrNull(truth && truth.total_price) : baseTotal)
      : baseTotal;
    const outCur = truth
      ? (fx.normalizeCurrency(truth && truth.currency) || baseCur || 'GBP')
      : (baseCur || null);
    const outLastHandle = truth ? (resolvedHandle || null) : (resolvedHandle || null);
    const outFirstHandle = truth ? (resolvedHandle || null) : (firstHandle || resolvedHandle || null);

    out.push({
      session_id: sessionId,
      country_code: cc,
      purchased_at: purchasedAt,
      order_total: outTotal,
      order_currency: outCur,
      order_total_gbp: orderTotalGbp,
      product_title: productTitle,
      product_id: productId,
      last_product_handle: outLastHandle,
      first_product_handle: outFirstHandle,
    });
  }
  return out;
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

/** SQL AND clause: exclude token-only rows when an order_id row exists for same (session, total, currency, 15min bucket). */
function purchaseFilterExcludeTokenWhenOrderExists(alias) {
  const p = alias || 'p';
  const bucketCmp = config.dbUrl
    ? `FLOOR(p2.purchased_at/900000.0) = FLOOR(${p}.purchased_at/900000.0)`
    : `CAST(p2.purchased_at/900000 AS INTEGER) = CAST(${p}.purchased_at/900000 AS INTEGER)`;
  const sameRow = config.dbUrl
    ? `(p2.order_total IS NOT DISTINCT FROM ${p}.order_total) AND (p2.order_currency IS NOT DISTINCT FROM ${p}.order_currency)`
    : `(p2.order_total IS ${p}.order_total OR (p2.order_total IS NULL AND ${p}.order_total IS NULL)) AND (p2.order_currency IS ${p}.order_currency OR (p2.order_currency IS NULL AND ${p}.order_currency IS NULL))`;
  return ` AND (
    NULLIF(TRIM(${p}.checkout_token), '') IS NULL
    OR NULLIF(TRIM(${p}.order_id), '') IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM purchases p2
      WHERE NULLIF(TRIM(p2.order_id), '') IS NOT NULL
        AND p2.session_id = ${p}.session_id AND ${sameRow} AND ${bucketCmp}
    )
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
  if (k === 'today' || k === 'yesterday' || k === '3d' || k === '7d' || k === '14d' || k === '30d' || k === 'month') return true;
  if (/^d:\d{4}-\d{2}-\d{2}$/.test(k)) return true;
  const m = k.match(/^r:(\d{4})-(\d{2})-(\d{2}):(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  // Shopify sessions snapshots are day-based; cap to avoid huge on-demand backfills.
  const a = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
  const b = Date.UTC(parseInt(m[4], 10), parseInt(m[5], 10) - 1, parseInt(m[6], 10), 12, 0, 0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const days = Math.floor(Math.abs(b - a) / 86400000) + 1;
  return days > 0 && days <= 90;
}

/** Total sales in range. Dedupe in query only; never delete rows. */
async function getSalesTotal(start, end, options = {}) {
  // Guardrail: report sales from Shopify truth only (never exceed Shopify).
  // Truth: Shopify Orders API cached in orders_shopify.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthSalesTotalGbp(shop, start, end);
}

/** Revenue from returning-customer sessions only (sessions.is_returning = 1). Same dedupe and GBP conversion as getSalesTotal. */
async function getReturningRevenue(start, end, options = {}) {
  // Guardrail: report sales from Shopify truth only (never exceed Shopify).
  // Truth-based returning revenue: customers with a prior paid order before start.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningRevenueGbp(shop, start, end);
}

/** Count of truth orders from returning customers in range. */
async function getReturningOrderCount(start, end, options = {}) {
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningOrderCount(shop, start, end);
}

/** Count of unique truth customers who are returning in range. */
async function getReturningCustomerCount(start, end, options = {}) {
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningCustomerCount(shop, start, end);
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
  // Guardrail: conversion must be based on Shopify truth orders (never exceed Shopify).
  // Definition used across Breakdown/Traffic/Product tables: Orders / Sessions × 100.
  const convertedOrders = await getConvertedCount(start, end, options);
  return t > 0 ? Math.round((convertedOrders / t) * 1000) / 10 : null;
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

  // Guardrail: conversions must be Shopify truth (never exceed Shopify).
  // Approximation: count truth orders whose first landing page was a product page (landing_site contains "/products/").
  // This avoids relying on pixel evidence linkage which can be incomplete under blockers.
  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return null;
  const orderRows = config.dbUrl
    ? await db.all(
      `
        SELECT raw_json
        FROM orders_shopify
        WHERE shop = $1
          AND created_at >= $2 AND created_at < $3
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    )
    : await db.all(
      `
        SELECT raw_json
        FROM orders_shopify
        WHERE shop = ?
          AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    );
  let c = 0;
  for (const r of orderRows || []) {
    const raw = safeJsonParse(r && r.raw_json != null ? String(r.raw_json) : '');
    if (!raw || typeof raw !== 'object') continue;
    const landing = raw?.landing_site ?? raw?.landingSite ?? raw?.landing_site_ref ?? raw?.landingSiteRef ?? null;
    const s = landing != null ? String(landing) : '';
    if (s && s.toLowerCase().includes('/products/')) c++;
  }
  return t > 0 ? Math.round((c / t) * 1000) / 10 : null;
}

/** Sessions and revenue by country (truth). Includes 'XX' for unknown order/session country. */
async function getCountryStats(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  function normalizeCountryOrXX(value) {
    const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!s) return 'XX';
    const code = s.slice(0, 2);
    if (!/^[A-Z]{2}$/.test(code)) return 'XX';
    return code;
  }
  const conversionRows = config.dbUrl
    ? await db.all(`
      SELECT COALESCE(NULLIF(TRIM(country_code), ''), 'XX') AS country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= $1 AND started_at < $2
        ${filter.sql.replace(/sessions\./g, '')}
      GROUP BY COALESCE(NULLIF(TRIM(country_code), ''), 'XX')
    `, [start, end, ...filter.params])
    : await db.all(`
      SELECT COALESCE(NULLIF(TRIM(country_code), ''), 'XX') AS country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
        ${filter.sql.replace(/sessions\./g, '')}
      GROUP BY COALESCE(NULLIF(TRIM(country_code), ''), 'XX')
    `, [start, end, ...filter.params]);

  // Guardrail: conversions + revenue must be Shopify truth (never exceed Shopify).
  // Attribution basis: Shopify order country (shipping/billing) rather than pixel-evidence linkage.
  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  function orderCountryCodeFromRawJson(rawJson) {
    const raw = safeJsonParse(rawJson);
    if (!raw || typeof raw !== 'object') return null;
    const ship =
      raw?.shipping_address?.country_code ??
      raw?.shipping_address?.countryCode ??
      raw?.shippingAddress?.countryCode ??
      raw?.shippingAddress?.country_code ??
      null;
    const bill =
      raw?.billing_address?.country_code ??
      raw?.billing_address?.countryCode ??
      raw?.billingAddress?.countryCode ??
      raw?.billingAddress?.country_code ??
      null;
    return normalizeCountryOrXX(ship || bill);
  }

  const shop = salesTruth.resolveShopForSales('');
  let purchaseAgg = [];
  if (shop) {
    const orders = config.dbUrl
      ? await db.all(
        `
          SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price AS revenue, raw_json
          FROM orders_shopify
          WHERE shop = $1
            AND created_at >= $2 AND created_at < $3
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
            AND total_price IS NOT NULL
        `,
        [shop, start, end]
      )
      : await db.all(
        `
          SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price AS revenue, raw_json
          FROM orders_shopify
          WHERE shop = ?
            AND created_at >= ? AND created_at < ?
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
            AND total_price IS NOT NULL
        `,
        [shop, start, end]
      );
    const byCountryCurrency = new Map(); // "CC|CUR" -> { country_code, currency, converted, revenue }
    for (const o of orders || []) {
      const cc = orderCountryCodeFromRawJson(o && o.raw_json != null ? String(o.raw_json) : '') || 'XX';
      const cur = fx.normalizeCurrency(o && o.currency != null ? String(o.currency) : '') || 'GBP';
      const rev = o && o.revenue != null ? Number(o.revenue) : 0;
      const amt = Number.isFinite(rev) ? rev : 0;
      const key = cc + '|' + cur;
      const curRow = byCountryCurrency.get(key) || { country_code: cc, currency: cur, converted: 0, revenue: 0 };
      curRow.converted += 1;
      curRow.revenue += amt;
      byCountryCurrency.set(key, curRow);
    }
    purchaseAgg = Array.from(byCountryCurrency.values()).map((r) => ({
      country_code: r.country_code,
      currency: r.currency,
      converted: r.converted,
      revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
    }));
  }

  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map();
  for (const row of conversionRows) {
    const code = normalizeCountryOrXX(row && row.country_code != null ? String(row.country_code) : '');
    map.set(code, {
      country_code: code,
      total: Number(row.total) || 0,
      converted: Number(row.converted) || 0,
      revenue: 0,
    });
  }

  // Sum converted counts and convert revenue to GBP across currencies.
  for (const row of purchaseAgg || []) {
    const code = normalizeCountryOrXX(row && row.country_code != null ? String(row.country_code) : '');
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
 * Best GEO Products: top revenue products by country + product.
 *
 * Attribution:
 * - Country comes from Shopify truth orders (shipping/billing country parsed from orders_shopify.raw_json).
 * - Revenue comes from orders_shopify_line_items (truth line-item facts).
 *
 * Output rows:
 * - country_code, product_id, product_title, product_handle, product_thumb_url,
 *   conversion (pct), converted (orders), total (sessions), revenue (GBP)
 */
async function getBestGeoProducts(start, end, options = {}) {
  const MAX_BEST_GEO_ROWS = 200;
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return [];
  const token = await salesTruth.getAccessToken(shop);

  // Guardrail: use Shopify truth orders + line items (no pixel-evidence linkage) so totals match Shopify.
  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  function orderCountryCodeFromRawJson(rawJson) {
    const raw = safeJsonParse(rawJson);
    if (!raw || typeof raw !== 'object') return null;
    const ship =
      raw?.shipping_address?.country_code ??
      raw?.shipping_address?.countryCode ??
      raw?.shippingAddress?.countryCode ??
      raw?.shippingAddress?.country_code ??
      null;
    const bill =
      raw?.billing_address?.country_code ??
      raw?.billing_address?.countryCode ??
      raw?.billingAddress?.countryCode ??
      raw?.billingAddress?.country_code ??
      null;
    return normalizeCountry(ship || bill);
  }

  function normalizeHandle(v) {
    if (typeof v !== 'string') return '';
    return v.trim().toLowerCase().slice(0, 128);
  }

  function handleFromPath(pathValue) {
    if (typeof pathValue !== 'string') return '';
    const m = pathValue.match(/^\/products\/([^/?#]+)/i);
    return m ? normalizeHandle(m[1]) : '';
  }

  function handleFromUrl(urlValue) {
    if (typeof urlValue !== 'string') return '';
    const raw = urlValue.trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return handleFromPath(u.pathname || '');
    } catch (_) {
      return handleFromPath(raw);
    }
  }

  function handleFromSessionRow(row) {
    return (
      handleFromPath(row && row.first_path) ||
      normalizeHandle(row && row.first_product_handle) ||
      handleFromUrl(row && row.entry_url) ||
      ''
    );
  }

  // Sessions used as denominator are now country + product handle specific.
  // For performance, we aggregate after selecting the country+handle pairs we care about.
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');

  // Truth orders -> country (shipping/billing).
  const orderRows = config.dbUrl
    ? await db.all(
      `
        SELECT order_id, raw_json
        FROM orders_shopify
        WHERE shop = $1
          AND created_at >= $2 AND created_at < $3
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    )
    : await db.all(
      `
        SELECT order_id, raw_json
        FROM orders_shopify
        WHERE shop = ?
          AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    );
  const orderCountry = new Map(); // order_id -> CC
  for (const o of orderRows || []) {
    const oid = o && o.order_id != null ? String(o.order_id).trim() : '';
    if (!oid) continue;
    const cc = orderCountryCodeFromRawJson(o && o.raw_json != null ? String(o.raw_json) : '');
    if (!cc || cc === 'XX') continue;
    orderCountry.set(oid, cc);
  }

  // Line items (truth revenue per product) for those orders in range.
  const liRows = config.dbUrl
    ? await db.all(
      `
        SELECT
          order_id,
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          product_id,
          title,
          line_revenue AS revenue
        FROM orders_shopify_line_items
        WHERE shop = $1
          AND order_created_at >= $2 AND order_created_at < $3
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) != ''
          AND title IS NOT NULL AND TRIM(title) != ''
      `,
      [shop, start, end]
    )
    : await db.all(
      `
        SELECT
          order_id,
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          product_id,
          title,
          line_revenue AS revenue
        FROM orders_shopify_line_items
        WHERE shop = ?
          AND order_created_at >= ? AND order_created_at < ?
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) != ''
          AND title IS NOT NULL AND TRIM(title) != ''
      `,
      [shop, start, end]
    );

  const ratesToGbp = await fx.getRatesToGbp();
  const byCountryProduct = new Map(); // "CC|PID" -> { country_code, product_id, title, orderIds:Set, revenueGbp }
  for (const r of liRows || []) {
    const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
    if (!oid) continue;
    const cc = orderCountry.get(oid);
    if (!cc) continue;
    const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
    if (!pid) continue;
    const title = r && r.title != null ? String(r.title).trim() : '';
    const cur = fx.normalizeCurrency(r && r.currency) || 'GBP';
    const rev = r && r.revenue != null ? Number(r.revenue) : 0;
    const amt = Number.isFinite(rev) ? rev : 0;
    const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
    const gbpAmt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;

    const key = cc + '|' + pid;
    const curRow = byCountryProduct.get(key) || { country_code: cc, product_id: pid, title: title || null, orderIds: new Set(), revenueGbp: 0 };
    curRow.orderIds.add(oid);
    curRow.revenueGbp += gbpAmt;
    if (!curRow.title && title) curRow.title = title;
    byCountryProduct.set(key, curRow);
  }

  // Group products by country and keep a stable sort within each country.
  const byCountryList = new Map(); // CC -> rows[]
  for (const v of byCountryProduct.values()) {
    const list = byCountryList.get(v.country_code) || [];
    list.push(v);
    byCountryList.set(v.country_code, list);
  }
  for (const [cc, list] of byCountryList.entries()) {
    list.sort((a, b) => (b.revenueGbp - a.revenueGbp) || (b.orderIds.size - a.orderIds.size));
    byCountryList.set(cc, list);
  }

  // Fetch product meta (handle + thumb) for the selected products.
  const metaByProduct = new Map();
  if (token) {
    const selected = new Set();
    for (const list of byCountryList.values()) {
      for (const v of list || []) {
        if (v && v.product_id) selected.add(v.product_id);
      }
    }
    const uniqIds = Array.from(selected.values()).filter(Boolean);
    await Promise.all(
      uniqIds.map(async (pid) => {
        try {
          const meta = await productMetaCache.getProductMeta(shop, token, pid);
          if (meta && meta.ok) metaByProduct.set(pid, meta);
        } catch (_) {}
      })
    );
  }

  const selectedCountryHandlePairs = new Set();
  for (const [cc, list] of byCountryList.entries()) {
    for (const v of list || []) {
      const pid = v && v.product_id ? String(v.product_id) : '';
      const meta = pid && metaByProduct.has(pid) ? metaByProduct.get(pid) : null;
      const handle = meta && meta.handle ? normalizeHandle(String(meta.handle)) : '';
      if (!handle) continue;
      selectedCountryHandlePairs.add(`${cc}|${handle}`);
    }
  }

  const clicksByCountryHandle = new Map();
  if (selectedCountryHandlePairs.size) {
    const selectedCountries = new Set();
    const selectedHandles = new Set();
    for (const pair of selectedCountryHandlePairs) {
      const parts = String(pair || '').split('|');
      const cc = parts && parts[0] ? String(parts[0]).trim().toUpperCase().slice(0, 2) : '';
      const handle = parts && parts[1] ? normalizeHandle(String(parts[1])) : '';
      if (cc && cc !== 'XX') selectedCountries.add(cc);
      if (handle) selectedHandles.add(handle);
    }
    const countries = Array.from(selectedCountries.values()).filter(Boolean);
    const handles = Array.from(selectedHandles.values()).filter(Boolean);
    if (countries.length && handles.length) {
      try {
        const rows = config.dbUrl
          ? await (async () => {
              let p = 2 + (filter.params ? filter.params.length : 0);
              const ccSql = countries.map(() => `$${++p}`).join(', ');
              const handleSql = handles.map(() => `$${++p}`).join(', ');
              return db.all(
                `
                  SELECT
                    UPPER(TRIM(s.country_code)) AS country_code,
                    LOWER(TRIM(s.first_product_handle)) AS handle,
                    COUNT(*) AS clicks
                  FROM sessions s
                  WHERE s.started_at >= $1 AND s.started_at < $2
                    AND s.country_code IS NOT NULL AND TRIM(s.country_code) != '' AND s.country_code != 'XX'
                    ${filterAlias}
                    AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
                    AND UPPER(TRIM(s.country_code)) IN (${ccSql})
                    AND LOWER(TRIM(s.first_product_handle)) IN (${handleSql})
                  GROUP BY UPPER(TRIM(s.country_code)), LOWER(TRIM(s.first_product_handle))
                `,
                [start, end, ...filter.params, ...countries, ...handles]
              );
            })()
          : await (async () => {
              const ccSql = countries.map(() => '?').join(', ');
              const handleSql = handles.map(() => '?').join(', ');
              return db.all(
                `
                  SELECT
                    UPPER(TRIM(s.country_code)) AS country_code,
                    LOWER(TRIM(s.first_product_handle)) AS handle,
                    COUNT(*) AS clicks
                  FROM sessions s
                  WHERE s.started_at >= ? AND s.started_at < ?
                    AND s.country_code IS NOT NULL AND TRIM(s.country_code) != '' AND s.country_code != 'XX'
                    ${filterAlias}
                    AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
                    AND UPPER(TRIM(s.country_code)) IN (${ccSql})
                    AND LOWER(TRIM(s.first_product_handle)) IN (${handleSql})
                  GROUP BY UPPER(TRIM(s.country_code)), LOWER(TRIM(s.first_product_handle))
                `,
                [start, end, ...filter.params, ...countries, ...handles]
              );
            })();

        for (const row of rows || []) {
          const cc = normalizeCountry(row && row.country_code);
          if (!cc || cc === 'XX') continue;
          const handle = normalizeHandle(row && row.handle != null ? String(row.handle) : '');
          if (!handle) continue;
          const n = row && row.clicks != null ? Number(row.clicks) : 0;
          if (!Number.isFinite(n)) continue;
          const pairKey = `${cc}|${handle}`;
          if (!selectedCountryHandlePairs.has(pairKey)) continue;
          clicksByCountryHandle.set(pairKey, Math.max(0, Math.trunc(n)));
        }
      } catch (_) {}
    }
  }

  const out = [];
  for (const [cc, list] of byCountryList.entries()) {
    for (const v of list || []) {
      const pid = v.product_id;
      const meta = pid && metaByProduct.has(pid) ? metaByProduct.get(pid) : null;
      const handle = meta && meta.handle ? String(meta.handle).trim() : '';
      const normalizedHandle = normalizeHandle(handle);
      const thumbUrl = meta && meta.thumb_url ? String(meta.thumb_url).trim() : '';
      const converted = v.orderIds ? v.orderIds.size : 0;
      const revenue = Math.round((Number(v.revenueGbp) || 0) * 100) / 100;
      const clicks = normalizedHandle ? (clicksByCountryHandle.get(`${cc}|${normalizedHandle}`) || 0) : 0;
      const conversion = clicks > 0 ? Math.round((converted / clicks) * 1000) / 10 : null;
      out.push({
        country_code: cc,
        product_id: pid || null,
        product_title: v.title || null,
        product_handle: handle || null,
        product_thumb_url: thumbUrl || null,
        conversion,
        total: clicks,
        converted,
        revenue,
      });
    }
  }
  // Keep stable ordering: highest revenue first.
  out.sort((a, b) => (b.revenue - a.revenue) || (b.converted - a.converted) || (b.total - a.total));
  return out.slice(0, MAX_BEST_GEO_ROWS);
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
  if (hasPartialHistoricalDayWindow(start, end, timeZone)) {
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
  // Guardrail: report order counts from Shopify truth only (never exceed Shopify).
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthOrderCount(shop, start, end);
}

/**
 * Session-based conversions (Shopify-style): count sessions that had >=1 purchase in the range.
 * Shopify's "conversion rate" uses sessions that completed checkout, not raw order count.
 *
 * Falls back to order-count when required tables are missing (older installs).
 */
async function getConvertedSessionCount(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');
  const db = getDb();

  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  if (ordersSource === 'pixel') {
    try {
      const row = config.dbUrl
        ? await db.get(
          `
            SELECT COUNT(*) AS n FROM (
              SELECT DISTINCT s.session_id AS session_id
              FROM sessions s
              INNER JOIN purchases p ON p.session_id = s.session_id
              WHERE s.started_at >= $1 AND s.started_at < $2
                ${filterAlias}
                AND p.purchased_at >= $3 AND p.purchased_at < $4
                ${purchaseFilterExcludeDuplicateH('p')}
            ) t
          `,
          [start, end, start, end, ...filter.params]
        )
        : await db.get(
          `
            SELECT COUNT(*) AS n FROM (
              SELECT DISTINCT s.session_id AS session_id
              FROM sessions s
              INNER JOIN purchases p ON p.session_id = s.session_id
              WHERE s.started_at >= ? AND s.started_at < ?
                ${filterAlias}
                AND p.purchased_at >= ? AND p.purchased_at < ?
                ${purchaseFilterExcludeDuplicateH('p')}
            ) t
          `,
          [start, end, start, end, ...filter.params]
        );
      return row?.n != null ? Number(row.n) || 0 : 0;
    } catch (_) {
      // Older installs might not have purchases table; fall back to order-count behavior.
      return getConvertedCount(start, end, options);
    }
  }

  // Truth-backed conversions attributed to sessions via linked purchase evidence.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return getConvertedCount(start, end, options);
  try {
    const row = config.dbUrl
      ? await db.get(
        `
          SELECT COUNT(*) AS n FROM (
            SELECT DISTINCT s.session_id AS session_id
            FROM sessions s
            INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = $1
            INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
            WHERE s.started_at >= $2 AND s.started_at < $3
              ${filterAlias}
              AND pe.event_type IN ('checkout_completed', 'checkout_started')
              AND pe.occurred_at >= $4 AND pe.occurred_at < $5
              AND o.created_at >= $4 AND o.created_at < $5
              AND (o.test IS NULL OR o.test = 0)
              AND o.cancelled_at IS NULL
              AND o.financial_status = 'paid'
          ) t
        `,
        [shop, start, end, start, end, ...filter.params]
      )
      : await db.get(
        `
          SELECT COUNT(*) AS n FROM (
            SELECT DISTINCT s.session_id AS session_id
            FROM sessions s
            INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = ?
            INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
            WHERE s.started_at >= ? AND s.started_at < ?
              ${filterAlias}
              AND pe.event_type IN ('checkout_completed', 'checkout_started')
              AND pe.occurred_at >= ? AND pe.occurred_at < ?
              AND o.created_at >= ? AND o.created_at < ?
              AND (o.test IS NULL OR o.test = 0)
              AND o.cancelled_at IS NULL
              AND o.financial_status = 'paid'
          ) t
        `,
        [shop, start, end, start, end, start, end, ...filter.params]
      );
    return row?.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    // If purchase evidence tables don't exist yet, keep legacy behavior instead of returning 0/null.
    return getConvertedCount(start, end, options);
  }
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
      SELECT COUNT(*) AS n FROM (
        SELECT s.session_id
        FROM sessions s
        JOIN events e ON e.session_id = s.session_id
        WHERE s.started_at >= $1 AND s.started_at < $2 ${filterAlias}
          AND e.type = 'page_viewed'
        GROUP BY s.session_id
        HAVING COUNT(*) = 1
      ) t
    `, [start, end, ...filter.params])
    : await db.get(`
      SELECT COUNT(*) AS n FROM (
        SELECT s.session_id
        FROM sessions s
        JOIN events e ON e.session_id = s.session_id
        WHERE s.started_at >= ? AND s.started_at < ? ${filterAlias}
          AND e.type = 'page_viewed'
        GROUP BY s.session_id
        HAVING COUNT(*) = 1
      ) t
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
  const isPartialKey = requestedRange && /^p:\d{4}-\d{2}-\d{2}:\d{2}:\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['3d', '7d', '14d', '30d', 'month']);
  const rangeKeys = DEFAULT_RANGE_KEYS.slice();
  if (requestedRange && !rangeKeys.includes(requestedRange) && (isDayKey || isPartialKey || isRangeKey || allowedLegacy.has(requestedRange))) {
    rangeKeys.push(requestedRange);
  }
  const ranges = {};
  for (const key of rangeKeys) {
    ranges[key] = getRangeBounds(key, now, timeZone);
  }
  // Guardrail: nudge truth warmup; do not block /api/stats on reconciliation (same as getKpis).
  const salesShop = salesTruth.resolveShopForSales('');
  const salesTruthTodaySync = null; // No longer blocking; warmup is nudged in background.
  if (salesShop) {
    try {
      nudgeSalesTruthWarmupDetached(salesShop, ranges.today.start, ranges.today.end, 'today', '[store] getStats today');
    } catch (_) {}
    // Reconcile other ranges in background (skip ranges fully contained inside another requested range).
    const others = rangeKeys
      .map((key) => ({ key, start: ranges[key]?.start, end: ranges[key]?.end }))
      .filter((r) => r && r.key && r.key !== 'today' && typeof r.start === 'number' && Number.isFinite(r.start) && typeof r.end === 'number' && Number.isFinite(r.end) && r.end > r.start);
    const needed = [];
    for (const r of others) {
      const contained = others.some((o) => o !== r && o.start <= r.start && o.end >= r.end);
      if (!contained) needed.push(r);
    }
    for (const r of needed) {
      // Avoid blocking report responses on potentially slow Shopify reconciliation.
      // Long-range backfills are handled opportunistically in the background.
      const scopeKey = salesTruth.scopeForRangeKey(r.key || 'range', 'range');
      salesTruth.ensureReconciled(salesShop, r.start, r.end, scopeKey).catch(warnOnReject('[store] ensureReconciled'));
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
  const force = !!options.force;
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const reporting = await getReportingConfig();
  const opts = { trafficMode, timeZone, reporting };

  const requestedRangeRaw =
    typeof options.rangeKey === 'string' ? options.rangeKey :
      (typeof options.range === 'string' ? options.range : '');
  const requestedRange = requestedRangeRaw ? String(requestedRangeRaw).trim().toLowerCase() : '';
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const isPartialKey = requestedRange && /^p:\d{4}-\d{2}-\d{2}:\d{2}:\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
  const rangeKey = (DEFAULT_RANGE_KEYS.includes(requestedRange) || isDayKey || isPartialKey || isRangeKey || allowedLegacy.has(requestedRange))
    ? requestedRange
    : 'today';

  const bounds = getRangeBounds(rangeKey, now, timeZone);
  const compareBounds = (() => {
    const periodLengthMs = bounds.end - bounds.start;
    let compareStart;
    let compareEnd;
    if (rangeKey === 'today') {
      // Today up to now -> yesterday up to same time-of-day.
      const nowParts = getTimeZoneParts(new Date(now), timeZone);
      const yesterdayParts = addDaysToParts(nowParts, -1);
      compareStart = startOfDayUtcMs(yesterdayParts, timeZone);
      const sameTimeYesterday = zonedTimeToUtcMs(
        yesterdayParts.year,
        yesterdayParts.month,
        yesterdayParts.day,
        nowParts.hour,
        nowParts.minute,
        nowParts.second,
        timeZone
      );
      const todayStart = startOfDayUtcMs(nowParts, timeZone);
      compareEnd = Math.max(compareStart, Math.min(sameTimeYesterday, todayStart));
    } else {
      // All other ranges: shift back by the same duration.
      compareStart = bounds.start - periodLengthMs;
      compareEnd = bounds.start;
    }
    if (compareStart < PLATFORM_START_MS) compareStart = PLATFORM_START_MS;
    if (compareEnd < PLATFORM_START_MS) compareEnd = PLATFORM_START_MS;
    if (!(compareEnd > compareStart)) return null;
    return { start: compareStart, end: compareEnd };
  })();

  async function getAdSpendGbp(startMs, endMs) {
    try {
      const adsDb = require('./ads/adsDb');
      if (!adsDb || typeof adsDb.getAdsPool !== 'function') return null;
      const pool = adsDb.getAdsPool();
      if (!pool) return null;
      const start = Number(startMs);
      const end = Number(endMs);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
      const startSec = start / 1000;
      const endSec = end / 1000;
      const r = await pool.query(
        'SELECT COALESCE(SUM(spend_gbp), 0) AS spend_gbp FROM google_ads_spend_hourly WHERE hour_ts >= to_timestamp($1) AND hour_ts < to_timestamp($2)',
        [startSec, endSec]
      );
      const v = r && r.rows && r.rows[0] ? Number(r.rows[0].spend_gbp) : null;
      return (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 100) / 100 : null;
    } catch (_) {
      return null;
    }
  }

  function cacheSlowMetric(metricKey, start, end, cacheRangeKey, computeFn) {
    const rk = typeof cacheRangeKey === 'string' ? cacheRangeKey : rangeKey;
    return reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'kpis_slow_' + String(metricKey || 'metric'),
        rangeKey: rk,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { trafficMode, rangeKey: rk },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      computeFn
    ).then((r) => (r && r.ok ? r.data : null));
  }

  // Guardrail: keep Shopify truth cache warm for this range.
  // IMPORTANT: do not block KPI responses on reconciliation. Truth reconciliation can be very slow
  // (Shopify rate limits, large order volumes, pre-reconcile backups after deploy restarts).
  // Startup/background warmers already run; here we only nudge the warmup best-effort.
  const salesShop = salesTruth.resolveShopForSales('');
  let salesTruthSync = null;
  let salesTruthCompareSync = null;
  if (salesShop) {
    const scopeKey = salesTruth.scopeForRangeKey(rangeKey, 'range');
    try {
      const warmNow = Date.now();
      if ((warmNow - (_truthNudgeLastAt || 0)) >= 2 * 60 * 1000 && !_truthNudgeInFlight) {
        _truthNudgeLastAt = warmNow;
        _truthNudgeInFlight = true;
        salesTruth.ensureReconciled(salesShop, bounds.start, bounds.end, scopeKey || 'today').catch(warnOnReject('[store] ensureReconciled'))
          .finally(() => { _truthNudgeInFlight = false; });
      }
    } catch (_) {}
    // Keep the baseline trustworthy too: for Today comparisons, warm yesterday-same-time range.
    // Non-blocking: comparisons will reflect the freshest truth available.
    if (rangeKey === 'today' && compareBounds && compareBounds.end > compareBounds.start) {
      const compareScopeKey = salesTruth.scopeForRangeKey('yesterday', 'range');
      try {
        nudgeSalesTruthWarmupDetached(salesShop, compareBounds.start, compareBounds.end, compareScopeKey, '[store] ensureReconciled(compare)');
      } catch (_) {}
    }
  }

  const yesterdayBounds = getRangeBounds('yesterday', now, timeZone);
  const [
    salesVal,
    returningRevenueVal,
    returningOrderCountVal,
    returningCustomerCountVal,
    convertedCountVal,
    trafficBreakdownVal,
    bounceVal,
    adSpendVal,
    yesterdayOk,
    salesTruthHealth,
  ] = await Promise.all([
    getSalesTotal(bounds.start, bounds.end, { ...opts, rangeKey }),
    getReturningRevenue(bounds.start, bounds.end, { ...opts, rangeKey }),
    getReturningOrderCount(bounds.start, bounds.end, { ...opts, rangeKey }),
    cacheSlowMetric(
      'returningCustomerCount',
      bounds.start,
      bounds.end,
      rangeKey,
      () => getReturningCustomerCount(bounds.start, bounds.end, { ...opts, rangeKey })
    ),
    getConvertedCount(bounds.start, bounds.end, { ...opts, rangeKey }),
    getSessionCounts(bounds.start, bounds.end, { ...opts, rangeKey }),
    cacheSlowMetric(
      'bounce',
      bounds.start,
      bounds.end,
      rangeKey,
      () => getBounceRate(bounds.start, bounds.end, { ...opts, rangeKey })
    ),
    cacheSlowMetric(
      'adSpend',
      bounds.start,
      bounds.end,
      rangeKey,
      () => getAdSpendGbp(bounds.start, bounds.end)
    ),
    rangeHasSessions(yesterdayBounds.start, yesterdayBounds.end, opts),
    (salesShop ? salesTruth.getTruthHealth(salesShop || '', salesTruth.scopeForRangeKey(rangeKey, 'range')) : Promise.resolve(null)),
  ]);

  // Avoid duplicate work: conversion rate is derived from already-fetched orders + session counts.
  const sessionsForConv = trafficBreakdownVal && typeof trafficBreakdownVal.human_sessions === 'number'
    ? trafficBreakdownVal.human_sessions
    : null;
  const ordersForConv = (typeof convertedCountVal === 'number' && Number.isFinite(convertedCountVal)) ? convertedCountVal : null;
  const conversionVal = (sessionsForConv != null && Number.isFinite(sessionsForConv) && sessionsForConv > 0 && ordersForConv != null)
    ? (Math.round((ordersForConv / sessionsForConv) * 1000) / 10)
    : null;

  const roasVal = (typeof salesVal === 'number' && Number.isFinite(salesVal) && typeof adSpendVal === 'number' && Number.isFinite(adSpendVal) && adSpendVal > 0)
    ? (Math.round((salesVal / adSpendVal) * 100) / 100)
    : null;

  const vpvVal = ratioOrNull(salesVal, sessionsForConv, { decimals: 2 });

  let compare = null;
  // Compute previous-period comparison for all date ranges
  {
    const compareStart = compareBounds && Number.isFinite(compareBounds.start) ? Number(compareBounds.start) : NaN;
    const compareEnd = compareBounds && Number.isFinite(compareBounds.end) ? Number(compareBounds.end) : NaN;
    if (Number.isFinite(compareStart) && Number.isFinite(compareEnd) && compareEnd > compareStart) {
      const compareOpts = { ...opts, rangeKey: rangeKey === 'today' ? 'yesterday' : rangeKey };
      const [
        compareSales,
        compareReturning,
        compareReturningOrderCount,
        compareReturningCustomerCount,
        compareConvertedCount,
        compareBreakdown,
        compareBounce,
        compareAdSpend,
      ] = await Promise.all([
        getSalesTotal(compareStart, compareEnd, compareOpts),
        getReturningRevenue(compareStart, compareEnd, compareOpts),
        getReturningOrderCount(compareStart, compareEnd, compareOpts),
        cacheSlowMetric(
          'returningCustomerCount',
          compareStart,
          compareEnd,
          compareOpts.rangeKey,
          () => getReturningCustomerCount(compareStart, compareEnd, compareOpts)
        ),
        getConvertedCount(compareStart, compareEnd, compareOpts),
        getSessionCounts(compareStart, compareEnd, compareOpts),
        cacheSlowMetric(
          'bounce',
          compareStart,
          compareEnd,
          compareOpts.rangeKey,
          () => getBounceRate(compareStart, compareEnd, compareOpts)
        ),
        cacheSlowMetric(
          'adSpend',
          compareStart,
          compareEnd,
          compareOpts.rangeKey,
          () => getAdSpendGbp(compareStart, compareEnd)
        ),
      ]);

      const compareSessionsForConv = compareBreakdown && typeof compareBreakdown.human_sessions === 'number'
        ? compareBreakdown.human_sessions
        : null;
      const compareOrdersForConv = (typeof compareConvertedCount === 'number' && Number.isFinite(compareConvertedCount)) ? compareConvertedCount : null;
      const compareConversion = (compareSessionsForConv != null && Number.isFinite(compareSessionsForConv) && compareSessionsForConv > 0 && compareOrdersForConv != null)
        ? (Math.round((compareOrdersForConv / compareSessionsForConv) * 1000) / 10)
        : null;

      const compareRoas = (typeof compareSales === 'number' && Number.isFinite(compareSales) && typeof compareAdSpend === 'number' && Number.isFinite(compareAdSpend) && compareAdSpend > 0)
        ? (Math.round((compareSales / compareAdSpend) * 100) / 100)
        : null;

      const compareVpv = ratioOrNull(compareSales, compareSessionsForConv, { decimals: 2 });

      compare = {
        sales: compareSales,
        returningRevenue: compareReturning,
        returningOrderCount: compareReturningOrderCount,
        returningCustomerCount: compareReturningCustomerCount,
        conversion: compareConversion,
        aov: aovFromSalesAndCount(compareSales, compareConvertedCount),
        bounce: compareBounce,
        adSpend: compareAdSpend,
        roas: compareRoas,
        vpv: compareVpv,
        convertedCount: compareConvertedCount,
        trafficBreakdown: compareBreakdown,
        range: { start: compareStart, end: compareEnd },
      };
    }
  }

  const aovVal = aovFromSalesAndCount(salesVal, convertedCountVal);
  const rangeAvailable = {
    today: true,
    yesterday: yesterdayOk,
  };

  return {
    sales: { [rangeKey]: salesVal },
    returningRevenue: { [rangeKey]: returningRevenueVal },
    returningOrderCount: { [rangeKey]: returningOrderCountVal },
    returningCustomerCount: { [rangeKey]: returningCustomerCountVal },
    conversion: { [rangeKey]: conversionVal },
    aov: { [rangeKey]: aovVal },
    bounce: { [rangeKey]: bounceVal },
    convertedCount: { [rangeKey]: convertedCountVal },
    adSpend: { [rangeKey]: adSpendVal },
    roas: { [rangeKey]: roasVal },
    vpv: { [rangeKey]: vpvVal },
    compare,
    trafficMode,
    trafficBreakdown: { [rangeKey]: trafficBreakdownVal },
    reporting,
    salesTruth: {
      shop: salesShop || '',
      todaySync: salesTruthSync,
      compareSync: salesTruthCompareSync,
      health: salesTruthHealth,
    },
    rangeAvailable,
  };
}

/**
 * Kexo Score: 0-100 performance score from current vs previous vs previous2 windows.
 * Same time-of-day alignment for 'today'; weighted component scores (revenue, conversion, bounce, sessions; optional ROAS/CTR when ads integrated).
 * Returns score, band (20/40/60/80/100), and components array for modal breakdown.
 */
async function getKexoScore(options = {}) {
  const trafficMode = options.trafficMode === 'human_only' ? 'human_only' : (config.trafficMode || 'all');
  const force = !!options.force;
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const reporting = await getReportingConfig();
  const opts = { trafficMode, timeZone, reporting };

  const requestedRangeRaw =
    typeof options.rangeKey === 'string' ? options.rangeKey :
      (typeof options.range === 'string' ? options.range : '');
  const requestedRange = requestedRangeRaw ? String(requestedRangeRaw).trim().toLowerCase() : '';
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
  const rangeKey = (DEFAULT_RANGE_KEYS.includes(requestedRange) || isDayKey || isRangeKey || allowedLegacy.has(requestedRange))
    ? requestedRange
    : 'today';

  const bounds = getRangeBounds(rangeKey, now, timeZone);
  const periodLengthMs = bounds.end - bounds.start;

  function getPreviousBounds() {
    let compareStart;
    let compareEnd;
    if (rangeKey === 'today') {
      const nowParts = getTimeZoneParts(new Date(now), timeZone);
      const yesterdayParts = addDaysToParts(nowParts, -1);
      compareStart = startOfDayUtcMs(yesterdayParts, timeZone);
      const sameTimeYesterday = zonedTimeToUtcMs(
        yesterdayParts.year, yesterdayParts.month, yesterdayParts.day,
        nowParts.hour, nowParts.minute, nowParts.second,
        timeZone
      );
      const todayStart = startOfDayUtcMs(nowParts, timeZone);
      compareEnd = Math.max(compareStart, Math.min(sameTimeYesterday, todayStart));
    } else {
      compareStart = bounds.start - periodLengthMs;
      compareEnd = bounds.start;
    }
    if (compareStart < PLATFORM_START_MS) compareStart = PLATFORM_START_MS;
    if (compareEnd < PLATFORM_START_MS) compareEnd = PLATFORM_START_MS;
    if (!(compareEnd > compareStart)) return null;
    return { start: compareStart, end: compareEnd };
  }

  function getPrevious2Bounds(prevBounds) {
    if (!prevBounds || !(prevBounds.end > prevBounds.start)) return null;

    // For "today", align previous2 to "day-before same-time" (00:00 -> now-time two days ago),
    // not the immediately preceding rolling window, so modal "before" values are comparable.
    if (rangeKey === 'today') {
      const nowParts = getTimeZoneParts(new Date(now), timeZone);
      const dayBeforeParts = addDaysToParts(nowParts, -2);
      let start = startOfDayUtcMs(dayBeforeParts, timeZone);
      const sameTimeDayBefore = zonedTimeToUtcMs(
        dayBeforeParts.year, dayBeforeParts.month, dayBeforeParts.day,
        nowParts.hour, nowParts.minute, nowParts.second,
        timeZone
      );
      const nextDayStart = startOfDayUtcMs(addDaysToParts(dayBeforeParts, 1), timeZone);
      let end = Math.max(start, Math.min(sameTimeDayBefore, nextDayStart));
      if (start < PLATFORM_START_MS) start = PLATFORM_START_MS;
      if (end < PLATFORM_START_MS) end = PLATFORM_START_MS;
      if (!(end > start)) return null;
      return { start, end };
    }

    const prevLength = prevBounds.end - prevBounds.start;
    let start = prevBounds.start - prevLength;
    let end = prevBounds.start;
    if (start < PLATFORM_START_MS) start = PLATFORM_START_MS;
    if (end < PLATFORM_START_MS) end = PLATFORM_START_MS;
    if (!(end > start)) return null;
    return { start, end };
  }

  const previousBounds = getPreviousBounds();
  const previous2Bounds = previousBounds ? getPrevious2Bounds(previousBounds) : null;

  async function getAdSpendGbp(startMs, endMs) {
    try {
      const adsDb = require('./ads/adsDb');
      if (!adsDb || typeof adsDb.getAdsPool !== 'function') return null;
      const pool = adsDb.getAdsPool();
      if (!pool) return null;
      const start = Number(startMs);
      const end = Number(endMs);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
      const startSec = start / 1000;
      const endSec = end / 1000;
      const r = await pool.query(
        'SELECT COALESCE(SUM(spend_gbp), 0) AS spend_gbp FROM google_ads_spend_hourly WHERE hour_ts >= to_timestamp($1) AND hour_ts < to_timestamp($2)',
        [startSec, endSec]
      );
      const v = r && r.rows && r.rows[0] ? Number(r.rows[0].spend_gbp) : null;
      return (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 100) / 100 : null;
    } catch (_) {
      return null;
    }
  }

  async function getAdsClicksImpressions(startMs, endMs) {
    try {
      const adsDb = require('./ads/adsDb');
      if (!adsDb || typeof adsDb.getAdsPool !== 'function') return null;
      const pool = adsDb.getAdsPool();
      if (!pool) return null;
      const start = Number(startMs);
      const end = Number(endMs);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
      const startSec = start / 1000;
      const endSec = end / 1000;
      const r = await pool.query(
        'SELECT COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(impressions), 0) AS impressions FROM google_ads_spend_hourly WHERE hour_ts >= to_timestamp($1) AND hour_ts < to_timestamp($2)',
        [startSec, endSec]
      );
      const row = r && r.rows && r.rows[0] ? r.rows[0] : null;
      if (!row) return null;
      const clicks = Number(row.clicks);
      const impressions = Number(row.impressions);
      return {
        clicks: Number.isFinite(clicks) ? Math.max(0, Math.floor(clicks)) : 0,
        impressions: Number.isFinite(impressions) ? Math.max(0, Math.floor(impressions)) : 0,
      };
    } catch (_) {
      return null;
    }
  }

  async function getItemsOrderedCount(startMs, endMs) {
    const shop = salesTruth.resolveShopForSales('');
    if (!shop) return null;
    const start = Number(startMs);
    const end = Number(endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
    try {
      const db = getDb();
      const row = config.dbUrl
        ? await db.get(
          `SELECT COALESCE(SUM(li.quantity), 0) AS total
           FROM orders_shopify_line_items li
           WHERE li.shop = $1
             AND li.order_created_at >= $2 AND li.order_created_at < $3
             AND (li.order_test IS NULL OR li.order_test = 0)
             AND li.order_cancelled_at IS NULL
             AND li.order_financial_status = 'paid'`,
          [shop, start, end]
        )
        : await db.get(
          `SELECT COALESCE(SUM(li.quantity), 0) AS total
           FROM orders_shopify_line_items li
           WHERE li.shop = ?
             AND li.order_created_at >= ? AND li.order_created_at < ?
             AND (li.order_test IS NULL OR li.order_test = 0)
             AND li.order_cancelled_at IS NULL
             AND li.order_financial_status = 'paid'`,
          [shop, start, end]
        );
      const v = row ? Number(row.total) : null;
      return Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
    } catch (_) {
      return null;
    }
  }

  // Profit (v2): best-effort estimated profit using Profit Rules toggles when configured.
  // Must fail-open and never block scoring (short timeout).
  let profitShop = '';
  let profitToggles = null;
  try {
    profitShop = salesTruth.resolveShopForSales('') || '';
    const { PROFIT_RULES_V1_KEY, normalizeProfitRulesConfigV1, hasEnabledProfitRules } = require('./profitRulesConfig');
    const raw = await getSetting(PROFIT_RULES_V1_KEY);
    const cfg = normalizeProfitRulesConfigV1(raw);
    if (cfg && cfg.enabled === true) {
      const integ = cfg.integrations && typeof cfg.integrations === 'object' ? cfg.integrations : {};
      const hasRules = hasEnabledProfitRules(cfg);
      const shippingEnabled = !!(cfg.shipping && cfg.shipping.enabled === true);
      profitToggles = {
        includeGoogleAdsSpend: integ.includeGoogleAdsSpend === true,
        includePaymentFees: integ.includePaymentFees === true,
        includeShopifyTaxes: integ.includeShopifyTaxes === true,
        includeShopifyAppBills: integ.includeShopifyAppBills === true,
        includeShipping: shippingEnabled,
        includeRules: hasRules,
      };
    }
  } catch (_) {
    profitShop = '';
    profitToggles = null;
  }

  function promiseWithTimeout(promise, ms) {
    const timeoutMs = Number(ms);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
    return new Promise((resolve) => {
      let done = false;
      const t = setTimeout(() => {
        done = true;
        resolve(null);
      }, timeoutMs);
      Promise.resolve(promise).then(
        (v) => {
          if (done) return;
          try { clearTimeout(t); } catch (_) {}
          resolve(v);
        },
        () => {
          if (done) return;
          try { clearTimeout(t); } catch (_) {}
          resolve(null);
        }
      );
    });
  }

  async function getEstimatedProfitGbpBestEffort(startMs, endMs) {
    if (!profitShop || !profitToggles) return null;
    const start = Number(startMs);
    const end = Number(endMs);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
    try {
      const svc = require('./businessSnapshotService');
      if (!svc || typeof svc.getRevenueAndCostForGoogleAdsPostback !== 'function') return null;
      const out = await svc.getRevenueAndCostForGoogleAdsPostback(profitShop, start, end, profitToggles);
      const rev = out && typeof out.revenueGbp === 'number' && Number.isFinite(out.revenueGbp) ? out.revenueGbp : null;
      const cost = out && typeof out.costGbp === 'number' && Number.isFinite(out.costGbp) ? out.costGbp : null;
      if (rev == null || cost == null) return null;
      return Math.round((rev - cost) * 100) / 100;
    } catch (_) {
      return null;
    }
  }

  async function metricsForWindow(startMs, endMs, windowRangeKey) {
    const windowOpts = { ...opts, rangeKey: windowRangeKey };
    const [sales, convertedCount, itemsOrderedCount, trafficBreakdown, adSpend, adsClicksImpr, estimatedProfit] = await Promise.all([
      getSalesTotal(startMs, endMs, windowOpts),
      getConvertedCount(startMs, endMs, windowOpts),
      getItemsOrderedCount(startMs, endMs),
      getSessionCounts(startMs, endMs, windowOpts),
      getAdSpendGbp(startMs, endMs),
      getAdsClicksImpressions(startMs, endMs),
      promiseWithTimeout(getEstimatedProfitGbpBestEffort(startMs, endMs), 1500),
    ]);
    const sessions = trafficBreakdown && typeof trafficBreakdown.human_sessions === 'number' ? trafficBreakdown.human_sessions : null;
    const conversion = (sessions != null && sessions > 0 && convertedCount != null && Number.isFinite(convertedCount))
      ? Math.round((convertedCount / sessions) * 1000) / 10
      : null;
    const mer = (typeof sales === 'number' && Number.isFinite(sales) && typeof adSpend === 'number' && Number.isFinite(adSpend) && adSpend > 0)
      ? Math.round((sales / adSpend) * 100) / 100
      : null;
    // VPV v2: "Value per view" if views exist; fallback to sessions in this pipeline.
    const vpv = (typeof sales === 'number' && Number.isFinite(sales) && typeof sessions === 'number' && Number.isFinite(sessions) && sessions > 0)
      ? Math.round((sales / sessions) * 100) / 100
      : null;
    // Profit v2: prefer configured estimated profit; fall back to ads-only proxy when available.
    const profit = (typeof estimatedProfit === 'number' && Number.isFinite(estimatedProfit))
      ? estimatedProfit
      : ((typeof sales === 'number' && Number.isFinite(sales) && typeof adSpend === 'number' && Number.isFinite(adSpend) && adSpend > 0)
        ? Math.round((sales - adSpend) * 100) / 100
        : null);
    return {
      sales: typeof sales === 'number' && Number.isFinite(sales) ? sales : null,
      orders: typeof convertedCount === 'number' && Number.isFinite(convertedCount) ? Math.max(0, Math.round(convertedCount)) : null,
      itemsOrdered: typeof itemsOrderedCount === 'number' && Number.isFinite(itemsOrderedCount) ? Math.max(0, Math.round(itemsOrderedCount)) : null,
      sessions,
      conversion,
      adSpend: typeof adSpend === 'number' && Number.isFinite(adSpend) ? adSpend : null,
      mer,
      vpv,
      profit,
      clicks: adsClicksImpr && Number.isFinite(adsClicksImpr.clicks) ? adsClicksImpr.clicks : null,
      impressions: adsClicksImpr && Number.isFinite(adsClicksImpr.impressions) ? adsClicksImpr.impressions : null,
    };
  }

  const [current, previous, previous2] = await Promise.all([
    metricsForWindow(bounds.start, bounds.end, rangeKey),
    previousBounds ? metricsForWindow(previousBounds.start, previousBounds.end, rangeKey === 'today' ? 'yesterday' : rangeKey) : Promise.resolve(null),
    previous2Bounds ? metricsForWindow(previous2Bounds.start, previous2Bounds.end, rangeKey === 'today' ? 'yesterday_prev2' : rangeKey + '_prev2') : Promise.resolve(null),
  ]);

  // Kexo Score v2: stable deltas (floors + ln ratios), per-metric stability thresholds,
  // and confidence dampening for low traffic.
  const KEXO_SCORE_V2 = Object.freeze({
    floors: {
      money: 100,
      vpv: 0.5,
      mer: 0.25,
    },
    stable: {
      conversionPp: 0.2, // 0.2 percentage points
      vpvRatio: 0.05,
      revenueRatio: 0.07,
      profitRatio: 0.07,
      merRatio: 0.09,
    },
    clamp: {
      ln: Math.log(2), // +/-100% (ln 2) maps to 0/100
      conversionPp: 1.0, // +/-1.0pp maps to 0/100
    },
    confidence: {
      minTraffic: 80, // sessions threshold for stabilising VPV + conversion
    },
  });

  function clampNumber(n, min, max) {
    const v = Number(n);
    if (!Number.isFinite(v)) return min;
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  function stableLnDelta(curRaw, prevRaw, floor, stableRatio, confidence01) {
    const cur = (typeof curRaw === 'number' && Number.isFinite(curRaw)) ? curRaw : null;
    const prev = (typeof prevRaw === 'number' && Number.isFinite(prevRaw)) ? prevRaw : null;
    if (cur == null || prev == null) return null;
    const denom = Math.max(Math.abs(prev), Number(floor) || 0, 1e-9);
    const rel = (cur - prev) / denom;
    if (typeof stableRatio === 'number' && Number.isFinite(stableRatio) && Math.abs(rel) < stableRatio) return 0;
    const f = Math.max(0, Number(floor) || 0);
    const eps = 1e-9;
    const curAdj = Math.max(cur, -f + eps);
    const prevAdj = Math.max(prev, -f + eps);
    const ratio = (curAdj + f) / (prevAdj + f);
    if (!Number.isFinite(ratio) || ratio <= 0) return null;
    let delta = Math.log(ratio);
    if (typeof confidence01 === 'number' && Number.isFinite(confidence01)) {
      delta *= clampNumber(confidence01, 0, 1);
    }
    return delta;
  }

  function stablePpDelta(curRaw, prevRaw, stableAbsPp, confidence01) {
    const cur = (typeof curRaw === 'number' && Number.isFinite(curRaw)) ? curRaw : null;
    const prev = (typeof prevRaw === 'number' && Number.isFinite(prevRaw)) ? prevRaw : null;
    if (cur == null || prev == null) return null;
    const delta = cur - prev;
    if (typeof stableAbsPp === 'number' && Number.isFinite(stableAbsPp) && Math.abs(delta) < stableAbsPp) return 0;
    const c = (typeof confidence01 === 'number' && Number.isFinite(confidence01)) ? clampNumber(confidence01, 0, 1) : 1;
    return delta * c;
  }

  function deltaToScore(delta, clampAbs) {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) return null;
    const cap = (typeof clampAbs === 'number' && Number.isFinite(clampAbs) && clampAbs > 1e-9) ? clampAbs : 1;
    const d = clampNumber(delta, -cap, cap);
    return Math.round((50 + (d / cap) * 50) * 10) / 10;
  }

  /** Change-based score 0–100 from signal (cur vs prev) + momentum (prev vs prev2). */
  function changeScoreV2(metricKey, valueCur, valuePrev, valuePrev2, confidenceCtx, invert = false) {
    const k = String(metricKey || '').trim().toLowerCase();
    const confidenceTraffic = (confidenceCtx && typeof confidenceCtx.traffic === 'number' && Number.isFinite(confidenceCtx.traffic))
      ? Math.max(0, Number(confidenceCtx.traffic))
      : null;
    const confidence01 = confidenceTraffic != null
      ? clampNumber(confidenceTraffic / (KEXO_SCORE_V2.confidence.minTraffic || 1), 0, 1)
      : 1;

    let signalDelta = null;
    let momentumDelta = null;
    let clampAbs = KEXO_SCORE_V2.clamp.ln;

    if (k === 'conversion') {
      clampAbs = KEXO_SCORE_V2.clamp.conversionPp;
      signalDelta = stablePpDelta(valueCur, valuePrev, KEXO_SCORE_V2.stable.conversionPp, confidence01);
      momentumDelta = stablePpDelta(valuePrev, valuePrev2, KEXO_SCORE_V2.stable.conversionPp, confidence01);
    } else if (k === 'vpv') {
      signalDelta = stableLnDelta(valueCur, valuePrev, KEXO_SCORE_V2.floors.vpv, KEXO_SCORE_V2.stable.vpvRatio, confidence01);
      momentumDelta = stableLnDelta(valuePrev, valuePrev2, KEXO_SCORE_V2.floors.vpv, KEXO_SCORE_V2.stable.vpvRatio, confidence01);
    } else if (k === 'mer') {
      signalDelta = stableLnDelta(valueCur, valuePrev, KEXO_SCORE_V2.floors.mer, KEXO_SCORE_V2.stable.merRatio, 1);
      momentumDelta = stableLnDelta(valuePrev, valuePrev2, KEXO_SCORE_V2.floors.mer, KEXO_SCORE_V2.stable.merRatio, 1);
    } else if (k === 'profit') {
      signalDelta = stableLnDelta(valueCur, valuePrev, KEXO_SCORE_V2.floors.money, KEXO_SCORE_V2.stable.profitRatio, 1);
      momentumDelta = stableLnDelta(valuePrev, valuePrev2, KEXO_SCORE_V2.floors.money, KEXO_SCORE_V2.stable.profitRatio, 1);
    } else {
      // revenue (and any other money-like scale metric)
      signalDelta = stableLnDelta(valueCur, valuePrev, KEXO_SCORE_V2.floors.money, KEXO_SCORE_V2.stable.revenueRatio, 1);
      momentumDelta = stableLnDelta(valuePrev, valuePrev2, KEXO_SCORE_V2.floors.money, KEXO_SCORE_V2.stable.revenueRatio, 1);
    }

    if (signalDelta == null && momentumDelta == null) return null;
    const combined = 0.85 * (signalDelta || 0) + 0.15 * (momentumDelta || 0);
    const raw = invert ? -combined : combined;
    return deltaToScore(raw, clampAbs);
  }

  /** Absolute health 0–100 from current value (ratio metrics); scale metrics return 50 (neutral). */
  function levelScoreV2(componentKey, valueCur, ctx) {
    const v = typeof valueCur === 'number' && Number.isFinite(valueCur) ? valueCur : null;
    if (v == null) return null;
    const k = String(componentKey || '').trim().toLowerCase();
    if (k === 'conversion') {
      if (v <= 0) return 0;
      if (v >= 5) return 100;
      return Math.round((v / 5) * 100 * 10) / 10;
    }
    if (k === 'mer') {
      if (v <= 0) return 0;
      if (v >= 4) return 100;
      return Math.round((v / 4) * 100 * 10) / 10;
    }
    if (k === 'profit') {
      const revenue = ctx && typeof ctx.revenue === 'number' && Number.isFinite(ctx.revenue) ? ctx.revenue : null;
      if (revenue == null || revenue <= 0) return (v <= 0 ? 0 : 50);
      const margin = v / revenue; // 0.30 = 30% margin
      if (!Number.isFinite(margin)) return null;
      if (margin <= 0) return 0;
      if (margin >= 0.3) return 100;
      return Math.round((margin / 0.3) * 100 * 10) / 10;
    }
    return 50;
  }

  const adsIntegrated = !!(current && (
    (typeof current.adSpend === 'number' && Number.isFinite(current.adSpend) && current.adSpend > 0) ||
    current.mer != null ||
    (current.clicks != null && current.impressions != null && current.impressions > 0)
  ));

  // Kexo Score v2 component mix + weights.
  const KEXO_SCORE_COMPONENTS = adsIntegrated
    ? [
      { key: 'profit', label: 'Estimated Profit', weight: 30, getCur: (m) => m.profit, getPrev: (m) => m && m.profit, getPrev2: (m) => m && m.profit, invert: false, wLevel: 0.35, wChange: 0.65 },
      { key: 'vpv', label: 'VPV (per session)', weight: 20, getCur: (m) => m.vpv, getPrev: (m) => m && m.vpv, getPrev2: (m) => m && m.vpv, invert: false, wLevel: 0.0, wChange: 1.0 },
      { key: 'conversion', label: 'Conversion Rate', weight: 20, getCur: (m) => m.conversion, getPrev: (m) => m && m.conversion, getPrev2: (m) => m && m.conversion, invert: false, wLevel: 0.25, wChange: 0.75 },
      { key: 'revenue', label: 'Revenue', weight: 15, getCur: (m) => m.sales, getPrev: (m) => m && m.sales, getPrev2: (m) => m && m.sales, invert: false, wLevel: 0.0, wChange: 1.0 },
      { key: 'mer', label: 'MER', weight: 15, getCur: (m) => m.mer, getPrev: (m) => m && m.mer, getPrev2: (m) => m && m.mer, invert: false, wLevel: 0.3, wChange: 0.7 },
    ]
    : [
      { key: 'profit', label: 'Estimated Profit', weight: 35, getCur: (m) => m.profit, getPrev: (m) => m && m.profit, getPrev2: (m) => m && m.profit, invert: false, wLevel: 0.35, wChange: 0.65 },
      { key: 'vpv', label: 'VPV (per session)', weight: 25, getCur: (m) => m.vpv, getPrev: (m) => m && m.vpv, getPrev2: (m) => m && m.vpv, invert: false, wLevel: 0.0, wChange: 1.0 },
      { key: 'conversion', label: 'Conversion Rate', weight: 25, getCur: (m) => m.conversion, getPrev: (m) => m && m.conversion, getPrev2: (m) => m && m.conversion, invert: false, wLevel: 0.25, wChange: 0.75 },
      { key: 'revenue', label: 'Revenue', weight: 15, getCur: (m) => m.sales, getPrev: (m) => m && m.sales, getPrev2: (m) => m && m.sales, invert: false, wLevel: 0.0, wChange: 1.0 },
    ];
  const components = [];
  let totalWeight = 0;
  let weightedSum = 0;

  for (const def of KEXO_SCORE_COMPONENTS) {
    const valueCur = def.getCur(current);
    const valuePrev = def.getPrev(previous) ?? null;
    const valuePrev2 = def.getPrev2(previous2) ?? null;
    const confidenceCtx = {
      traffic: current && typeof current.sessions === 'number' && Number.isFinite(current.sessions) ? current.sessions : null,
      revenue: current && typeof current.sales === 'number' && Number.isFinite(current.sales) ? current.sales : null,
    };
    const chScore = changeScoreV2(def.key, valueCur, valuePrev, valuePrev2, confidenceCtx, def.invert);
    const lvlScore = levelScoreV2(def.key, valueCur, confidenceCtx);
    if (chScore == null && lvlScore == null) continue;
    const wLevel = typeof def.wLevel === 'number' ? def.wLevel : 0.5;
    const wChange = typeof def.wChange === 'number' ? def.wChange : 0.5;
    const changePart = chScore != null ? chScore * wChange : 50 * wChange;
    const levelPart = lvlScore != null ? lvlScore * wLevel : 50 * wLevel;
    const score = Math.round((changePart + levelPart) * 10) / 10;
    const clamped = Math.max(0, Math.min(100, score));
    components.push({
      key: def.key,
      label: def.label,
      score: clamped,
      levelScore: lvlScore != null ? Math.round(lvlScore * 10) / 10 : null,
      changeScore: chScore != null ? Math.round(chScore * 10) / 10 : null,
      value: valueCur,
      previous: valuePrev,
      previous2: valuePrev2,
      weight: def.weight,
    });
    totalWeight += def.weight;
    weightedSum += clamped * def.weight;
  }

  const finalScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 50;
  const clampedScore = Math.max(0, Math.min(100, finalScore));
  const band = clampedScore >= 80 ? 100 : clampedScore >= 60 ? 80 : clampedScore >= 40 ? 60 : clampedScore >= 20 ? 40 : 20;

  return {
    score: clampedScore,
    band,
    components,
    rangeKey,
    range: { start: bounds.start, end: bounds.end },
    compare: previousBounds ? { start: previousBounds.start, end: previousBounds.end } : null,
    compare2: previous2Bounds ? { start: previous2Bounds.start, end: previous2Bounds.end } : null,
    adsIntegrated: !!adsIntegrated,
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
  listLatestSales,
  getActiveSessionCount,
  getActiveSessionSeries,
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
  getKexoScore,
  getRangeBounds,
  resolveAdminTimeZone,
  // Shared SQL helpers for pixel dedupe
  purchaseDedupeKeySql,
  purchaseFilterExcludeDuplicateH,
  purchaseFilterExcludeTokenWhenOrderExists,
  validateEventType,
  ALLOWED_EVENT_TYPES,
  extractBsAdsIdsFromEntryUrl,
};
