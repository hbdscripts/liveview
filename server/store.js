/**
 * Repository: visitors, sessions, events, settings, purchases.
 * All timestamps in epoch ms.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const config = require('./config');
const fx = require('./fx');

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

  const cfKnownBot = cf.cfKnownBot != null ? cf.cfKnownBot : null;
  const cfVerifiedBotCategory = cf.cfVerifiedBotCategory;
  const cfCountry = cf.cfCountry;
  const cfColo = cf.cfColo;
  const cfAsn = cf.cfAsn;
  const isReturningSession = visitorIsReturning ? 1 : 0;

  if (!existing) {
    if (config.dbUrl) {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, is_returning)
        VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 0, NULL, NULL, $23, $24, $25, $26, $27, $28)
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
          cf_asn = EXCLUDED.cf_asn
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, isReturningSession]);
    } else {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, is_returning)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, isReturningSession]);
    }
  } else {
    const cfUpdates = [];
    const cfParams = [];
    let p = config.dbUrl ? 19 : 0;
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
    const sessionIdPlaceholder = config.dbUrl ? '$' + (20 + cfParams.length) : '?';
    if (config.dbUrl) {
      await db.run(`
        UPDATE sessions SET last_seen = $1, last_path = COALESCE($2, last_path), last_product_handle = COALESCE($3, last_product_handle),
        cart_qty = $4, cart_value = COALESCE($5, cart_value), cart_currency = COALESCE($6, cart_currency),
        order_total = COALESCE($7, order_total), order_currency = COALESCE($8, order_currency),
        country_code = COALESCE($9, country_code), utm_campaign = COALESCE($10, utm_campaign), utm_source = COALESCE($11, utm_source), utm_medium = COALESCE($12, utm_medium), utm_content = COALESCE($13, utm_content),
        referrer = COALESCE($14, referrer),
        entry_url = COALESCE($15, entry_url),
        is_checking_out = $16, checkout_started_at = $17, has_purchased = $18, purchased_at = COALESCE($19, purchased_at)
        ${cfSet}
        WHERE session_id = ${sessionIdPlaceholder}
      `, [now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, updateReferrer, updateEntryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, ...cfParams, payload.session_id]);
    } else {
      const placeholders = [now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, updateReferrer, updateEntryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, ...cfParams, payload.session_id];
      await db.run(`
        UPDATE sessions SET last_seen = ?, last_path = COALESCE(?, last_path), last_product_handle = COALESCE(?, last_product_handle),
        cart_qty = ?, cart_value = COALESCE(?, cart_value), cart_currency = COALESCE(?, cart_currency),
        order_total = COALESCE(?, order_total), order_currency = COALESCE(?, order_currency),
        country_code = COALESCE(?, country_code), utm_campaign = COALESCE(?, utm_campaign), utm_source = COALESCE(?, utm_source), utm_medium = COALESCE(?, utm_medium), utm_content = COALESCE(?, utm_content),
        referrer = COALESCE(?, referrer),
        entry_url = COALESCE(?, entry_url),
        is_checking_out = ?, checkout_started_at = ?, has_purchased = ?, purchased_at = COALESCE(?, purchased_at)
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
  // Avoid double-counting: migration 008 backfilled legacy:session_id for sessions with has_purchased=1.
  // When we later get a real checkout_completed with token/order for that session, remove the legacy row.
  if ((purchaseKey.startsWith('token:') || purchaseKey.startsWith('order:')) && sessionId) {
    const legacyKey = 'legacy:' + sessionId;
    if (config.dbUrl) {
      await db.run('DELETE FROM purchases WHERE purchase_key = $1', [legacyKey]);
    } else {
      await db.run('DELETE FROM purchases WHERE purchase_key = ?', [legacyKey]);
    }
  }
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

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d', 'month'];
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

/** List sessions in a date range with pagination. Used by Live tab when Today/Yesterday/3d/7d is selected. */
async function listSessionsByRange(rangeKey, timeZone, limit, offset) {
  const db = getDb();
  const now = Date.now();
  const tz = timeZone || resolveAdminTimeZone();
  const bounds = getRangeBounds(rangeKey, now, tz);
  const { start, end } = bounds;
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

  const baseSql = `
    SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
      COALESCE(s.country_code, v.last_country) AS session_country,
      v.device, v.network_speed
    FROM sessions s
    LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE s.started_at >= ${config.dbUrl ? '$1' : '?'} AND s.started_at < ${config.dbUrl ? '$2' : '?'}
  `;
  const baseParams = [start, end];

  const countRow = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= $1 AND s.started_at < $2', [start, end])
    : await db.get('SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ? AND s.started_at < ?', [start, end]);
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

function purchaseDedupeKeySql() {
  // Prefer checkout_token; it remains stable even when order_id is missing on early checkout_completed events.
  // TRIM() to protect against accidental whitespace.
  return "COALESCE(NULLIF(TRIM(checkout_token), ''), NULLIF(TRIM(order_id), ''), purchase_key)";
}

/** Total sales in range (all purchases). Includes purchases with null/empty/XX country; overall >= sum(country revenue). */
async function getSalesTotal(start, end) {
  const db = getDb();
  const dedupeKey = purchaseDedupeKeySql();
  const rows = config.dbUrl
    ? await db.all(
      `
        SELECT currency, COALESCE(SUM(total), 0)::float AS total
        FROM (
          SELECT
            COALESCE(NULLIF(order_currency, ''), 'GBP') AS currency,
            ${dedupeKey} AS dedupe_key,
            MAX(order_total)::float AS total
          FROM purchases
          WHERE purchased_at >= $1 AND purchased_at < $2
          GROUP BY currency, dedupe_key
        ) t
        GROUP BY currency
      `,
      [start, end]
    )
    : await db.all(
      `
        SELECT currency, COALESCE(SUM(total), 0) AS total
        FROM (
          SELECT
            COALESCE(NULLIF(order_currency, ''), 'GBP') AS currency,
            ${dedupeKey} AS dedupe_key,
            MAX(order_total) AS total
          FROM purchases
          WHERE purchased_at >= ? AND purchased_at < ?
          GROUP BY currency, dedupe_key
        ) t
        GROUP BY currency
      `,
      [start, end]
    );

  const ratesToGbp = await fx.getRatesToGbp();
  let sum = 0;
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const total = r.total != null ? Number(r.total) : 0;
    if (!Number.isFinite(total) || total === 0) continue;
    const gbp = fx.convertToGbp(total, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) sum += gbp;
  }
  return Math.round(sum * 100) / 100;
}

/** Revenue from returning-customer sessions only (sessions.is_returning = 1). Same dedupe and GBP conversion as getSalesTotal. */
async function getReturningRevenue(start, end) {
  const db = getDb();
  const dedupeKeyP = "COALESCE(NULLIF(TRIM(p.checkout_token), ''), NULLIF(TRIM(p.order_id), ''), p.purchase_key)";
  const rows = config.dbUrl
    ? await db.all(
      `
        SELECT currency, COALESCE(SUM(total), 0)::float AS total
        FROM (
          SELECT
            COALESCE(NULLIF(p.order_currency, ''), 'GBP') AS currency,
            ${dedupeKeyP} AS dedupe_key,
            MAX(p.order_total)::float AS total
          FROM purchases p
          INNER JOIN sessions s ON p.session_id = s.session_id AND COALESCE(s.is_returning, 0) = 1
          WHERE p.purchased_at >= $1 AND p.purchased_at < $2
          GROUP BY currency, dedupe_key
        ) t
        GROUP BY currency
      `,
      [start, end]
    )
    : await db.all(
      `
        SELECT currency, COALESCE(SUM(total), 0) AS total
        FROM (
          SELECT
            COALESCE(NULLIF(p.order_currency, ''), 'GBP') AS currency,
            ${dedupeKeyP} AS dedupe_key,
            MAX(p.order_total) AS total
          FROM purchases p
          INNER JOIN sessions s ON p.session_id = s.session_id AND COALESCE(s.is_returning, 0) = 1
          WHERE p.purchased_at >= ? AND p.purchased_at < ?
          GROUP BY currency, dedupe_key
        ) t
        GROUP BY currency
      `,
      [start, end]
    );

  const ratesToGbp = await fx.getRatesToGbp();
  let sum = 0;
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const total = r.total != null ? Number(r.total) : 0;
    if (!Number.isFinite(total) || total === 0) continue;
    const gbp = fx.convertToGbp(total, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) sum += gbp;
  }
  return Math.round(sum * 100) / 100;
}

async function getConversionRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const total = config.dbUrl
    ? await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql,
      [start, end, ...filter.params]
    )
    : await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql,
      [start, end, ...filter.params]
    );
  const t = total?.n ?? 0;
  const p = await getConvertedCount(start, end);
  return t > 0 ? Math.round((p / t) * 1000) / 10 : null;
}

/** Product-only sessions: landed on a product page (not homepage, collection, etc). */
const PRODUCT_LANDING_SQL = " AND (first_path LIKE '/products/%' OR (first_product_handle IS NOT NULL AND TRIM(COALESCE(first_product_handle, '')) != ''))";

async function getProductConversionRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const productFilter = filter.sql.replace('sessions.', '') + PRODUCT_LANDING_SQL;
  const total = config.dbUrl
    ? await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + productFilter,
      [start, end, ...filter.params]
    )
    : await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + productFilter,
      [start, end, ...filter.params]
    );
  const converted = config.dbUrl
    ? await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2 AND has_purchased = 1' + productFilter,
      [start, end, ...filter.params]
    )
    : await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ? AND has_purchased = 1' + productFilter,
      [start, end, ...filter.params]
    );
  const t = total?.n ?? 0;
  const c = converted?.n ?? 0;
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
        ${filter.sql.replace('sessions.', '')}
      GROUP BY country_code
    `, [start, end, ...filter.params])
    : await db.all(`
      SELECT country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
        AND country_code IS NOT NULL AND country_code != '' AND country_code != 'XX'
        ${filter.sql.replace('sessions.', '')}
      GROUP BY country_code
    `, [start, end, ...filter.params]);
  // Aggregate purchases by country + currency so we can convert to GBP.
  const dedupeKey = purchaseDedupeKeySql();
  const purchaseAgg = config.dbUrl
    ? await db.all(`
      SELECT country_code, currency, COUNT(*) AS converted, COALESCE(SUM(revenue), 0)::float AS revenue
      FROM (
        SELECT
          country_code,
          COALESCE(NULLIF(order_currency, ''), 'GBP') AS currency,
          ${dedupeKey} AS dedupe_key,
          MAX(order_total)::float AS revenue
        FROM purchases
        WHERE purchased_at >= $1 AND purchased_at < $2
          AND country_code IS NOT NULL AND country_code != '' AND country_code != 'XX'
        GROUP BY country_code, currency, dedupe_key
      ) t
      GROUP BY country_code, currency
    `, [start, end])
    : await db.all(`
      SELECT country_code, currency, COUNT(*) AS converted, COALESCE(SUM(revenue), 0) AS revenue
      FROM (
        SELECT
          country_code,
          COALESCE(NULLIF(order_currency, ''), 'GBP') AS currency,
          ${dedupeKey} AS dedupe_key,
          MAX(order_total) AS revenue
        FROM purchases
        WHERE purchased_at >= ? AND purchased_at < ?
          AND country_code IS NOT NULL AND country_code != '' AND country_code != 'XX'
        GROUP BY country_code, currency, dedupe_key
      ) t
      GROUP BY country_code, currency
    `, [start, end]);

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

async function getSessionCounts(start, end, options = {}) {
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

async function getConvertedCount(start, end) {
  const db = getDb();
  const dedupeKey = purchaseDedupeKeySql();
  const row = config.dbUrl
    ? await db.get(`SELECT COUNT(DISTINCT ${dedupeKey}) AS n FROM purchases WHERE purchased_at >= $1 AND purchased_at < $2`, [start, end])
    : await db.get(`SELECT COUNT(DISTINCT ${dedupeKey}) AS n FROM purchases WHERE purchased_at >= ? AND purchased_at < ?`, [start, end]);
  return row ? Number(row.n) || 0 : 0;
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
  const breakdown = await getSessionCounts(start, end, options);
  const total = breakdown.human_sessions ?? 0;
  const singlePage = singlePageRow ? Number(singlePageRow.n) || 0 : 0;
  if (total <= 0) return null;
  return Math.round((singlePage / total) * 1000) / 10;
}

async function getStats(options = {}) {
  const trafficMode = options.trafficMode === 'human_only' ? 'human_only' : (config.trafficMode || 'all');
  const opts = { trafficMode };
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const ranges = {};
  for (const key of RANGE_KEYS) {
    ranges[key] = getRangeBounds(key, now, timeZone);
  }
  // Run all stats queries in one parallel batch to avoid N+1 (many sequential DB round-trips). Fixes NODE-1.
  const [
    salesByRangeEntries,
    returningRevenueByRangeEntries,
    conversionByRangeEntries,
    productConversionByRangeEntries,
    countryByRangeEntries,
    salesRollingEntries,
    conversionRollingEntries,
    convertedCountByRangeEntries,
    convertedCountRollingEntries,
    trafficBreakdownEntries,
    bounceByRangeEntries,
    yesterdayOk,
    threeDOk,
    sevenDOk,
  ] = await Promise.all([
    Promise.all(RANGE_KEYS.map(async key => [key, await getSalesTotal(ranges[key].start, ranges[key].end)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getReturningRevenue(ranges[key].start, ranges[key].end)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getConversionRate(ranges[key].start, ranges[key].end, opts)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getProductConversionRate(ranges[key].start, ranges[key].end, opts)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getCountryStats(ranges[key].start, ranges[key].end, opts)])),
    Promise.all(SALES_ROLLING_WINDOWS.map(async w => [w.key, await getSalesTotal(now - w.ms, now)])),
    Promise.all(CONVERSION_ROLLING_WINDOWS.map(async w => [w.key, await getConversionRate(now - w.ms, now, opts)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getConvertedCount(ranges[key].start, ranges[key].end)])),
    Promise.all(SALES_ROLLING_WINDOWS.map(async w => [w.key, await getConvertedCount(now - w.ms, now)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getSessionCounts(ranges[key].start, ranges[key].end, opts)])),
    Promise.all(RANGE_KEYS.map(async key => [key, await getBounceRate(ranges[key].start, ranges[key].end, opts)])),
    rangeHasSessions(ranges.yesterday.start, ranges.yesterday.end, opts),
    rangeHasSessions(ranges['3d'].start, ranges['3d'].end, opts),
    rangeHasSessions(ranges['7d'].start, ranges['7d'].end, opts),
  ]);
  const salesByRange = Object.fromEntries(salesByRangeEntries);
  const returningRevenueByRange = Object.fromEntries(returningRevenueByRangeEntries);
  const conversionByRange = Object.fromEntries(conversionByRangeEntries);
  const productConversionByRange = Object.fromEntries(productConversionByRangeEntries);
  const countryByRange = Object.fromEntries(countryByRangeEntries);
  const salesRolling = Object.fromEntries(salesRollingEntries);
  const conversionRolling = Object.fromEntries(conversionRollingEntries);
  const convertedCountByRange = Object.fromEntries(convertedCountByRangeEntries);
  const convertedCountRolling = Object.fromEntries(convertedCountRollingEntries);
  const trafficBreakdown = Object.fromEntries(trafficBreakdownEntries);
  const bounceByRange = Object.fromEntries(bounceByRangeEntries);
  const aovByRange = {};
  for (const key of RANGE_KEYS) {
    aovByRange[key] = aovFromSalesAndCount(salesByRange[key], convertedCountByRange[key]);
  }
  const aovRolling = {};
  for (const key of Object.keys(salesRolling)) {
    aovRolling[key] = aovFromSalesAndCount(salesRolling[key], convertedCountRolling[key]);
  }
  const rangeAvailable = {
    today: true,
    yesterday: yesterdayOk,
    '3d': threeDOk && yesterdayOk,
    '7d': sevenDOk && yesterdayOk,
    month: true,
  };
  return {
    sales: { ...salesByRange, rolling: salesRolling },
    returningRevenue: { ...returningRevenueByRange },
    conversion: { ...conversionByRange, rolling: conversionRolling },
    productConversion: productConversionByRange,
    country: countryByRange,
    aov: { ...aovByRange, rolling: aovRolling },
    bounce: bounceByRange,
    revenueToday: salesByRange.today ?? 0,
    rangeAvailable,
    convertedCount: convertedCountByRange,
    trafficMode,
    trafficBreakdown,
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
  getStats,
  getRangeBounds,
  resolveAdminTimeZone,
  validateEventType,
  ALLOWED_EVENT_TYPES,
};
