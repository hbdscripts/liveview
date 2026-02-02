/**
 * Repository: visitors, sessions, events, settings.
 * All timestamps in epoch ms.
 */

const { getDb } = require('./db');
const config = require('./config');

const ALLOWED_EVENT_TYPES = new Set([
  'page_viewed', 'product_viewed', 'product_added_to_cart', 'product_removed_from_cart',
  'cart_updated', 'cart_viewed', 'checkout_started', 'checkout_completed', 'heartbeat',
]);

const WHITELIST = new Set([
  'visitor_id', 'session_id', 'event_type', 'path', 'product_handle', 'product_title',
  'variant_title', 'quantity_delta', 'price', 'cart_qty', 'checkout_started', 'checkout_completed',
  'country_code', 'device', 'network_speed', 'ts', 'customer_privacy_debug',
]);

function sanitize(payload) {
  const out = {};
  for (const key of Object.keys(payload)) {
    if (WHITELIST.has(key)) out[key] = payload[key];
  }
  return out;
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
  const existing = await db.get('SELECT visitor_id, last_seen FROM visitors WHERE visitor_id = ?', [payload.visitor_id]);
  const isReturning = existing ? (now - existing.last_seen > config.returningGapMinutes * 60 * 1000) : false;
  const returningCount = existing ? (existing.returning_count || 0) + (isReturning ? 1 : 0) : 0;

  if (config.dbUrl) {
    await db.run(`
      INSERT INTO visitors (visitor_id, first_seen, last_seen, last_country, device, network_speed, is_returning, returning_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (visitor_id) DO UPDATE SET
        last_seen = $3, last_country = COALESCE($4, visitors.last_country), device = COALESCE($5, visitors.device),
        network_speed = COALESCE($6, visitors.network_speed), is_returning = $7, returning_count = $8
    `, [
      payload.visitor_id,
      existing ? existing.first_seen : now,
      now,
      payload.country_code ?? null,
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
      `, [now, payload.country_code, payload.device, payload.network_speed, isReturning ? 1 : 0, returningCount, payload.visitor_id]);
    } else {
      await db.run(`
        INSERT INTO visitors (visitor_id, first_seen, last_seen, last_country, device, network_speed, is_returning, returning_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [payload.visitor_id, now, now, payload.country_code ?? null, payload.device ?? null, payload.network_speed ?? null, 0, 0]);
    }
  }
  return { isReturning };
}

async function getSession(sessionId) {
  const db = getDb();
  return db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
}

async function upsertSession(payload, visitorIsReturning) {
  const db = getDb();
  const now = payload.ts || Date.now();
  const existing = await db.get('SELECT * FROM sessions WHERE session_id = ?', [payload.session_id]);

  let cartQty = payload.cart_qty;
  if (cartQty === undefined && existing) cartQty = existing.cart_qty;
  if (cartQty === undefined) cartQty = 0;

  let isCheckingOut = existing?.is_checking_out || (payload.checkout_started ? 1 : 0) || 0;
  let checkoutStartedAt = existing?.checkout_started_at || (payload.checkout_started ? now : null);
  if (payload.checkout_completed) {
    isCheckingOut = 0;
    checkoutStartedAt = null;
  }
  if (payload.checkout_started) {
    isCheckingOut = 1;
    checkoutStartedAt = now;
  }
  const checkoutWindowMs = config.checkoutStartedWindowMinutes * 60 * 1000;
  if (checkoutStartedAt && (now - checkoutStartedAt) > checkoutWindowMs) {
    isCheckingOut = 0;
  }

  const hasPurchased = existing?.has_purchased || (payload.checkout_completed ? 1 : 0) || 0;
  const lastPath = payload.path ?? existing?.last_path ?? null;
  const lastProductHandle = payload.product_handle ?? existing?.last_product_handle ?? null;

  if (!existing) {
    if (config.dbUrl) {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, cart_qty, is_checking_out, checkout_started_at, has_purchased, is_abandoned, abandoned_at, recovered_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, NULL, NULL)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, cartQty, isCheckingOut, checkoutStartedAt, hasPurchased]);
    } else {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, cart_qty, is_checking_out, checkout_started_at, has_purchased, is_abandoned, abandoned_at, recovered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, cartQty, isCheckingOut, checkoutStartedAt, hasPurchased]);
    }
  } else {
    if (config.dbUrl) {
      await db.run(`
        UPDATE sessions SET last_seen = ?, last_path = COALESCE($2, last_path), last_product_handle = COALESCE($3, last_product_handle),
        cart_qty = $4, is_checking_out = $5, checkout_started_at = $6, has_purchased = $7
        WHERE session_id = $8
      `, [now, lastPath, lastProductHandle, cartQty, isCheckingOut, checkoutStartedAt, hasPurchased, payload.session_id]);
    } else {
      await db.run(`
        UPDATE sessions SET last_seen = ?, last_path = COALESCE(?, last_path), last_product_handle = COALESCE(?, last_product_handle),
        cart_qty = ?, is_checking_out = ?, checkout_started_at = ?, has_purchased = ?
        WHERE session_id = ?
      `, [now, lastPath, lastProductHandle, cartQty, isCheckingOut, checkoutStartedAt, hasPurchased, payload.session_id]);
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

  const checkoutState = (payload.checkout_started != null || payload.checkout_completed != null)
    ? JSON.stringify({ checkout_started: !!payload.checkout_started, checkout_completed: !!payload.checkout_completed })
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

/** "Today (24h)" tab: last 24 hours. "All (60 min)" tab: last 60 min. Cleanup uses SESSION_TTL_MINUTES (default 24*60). */
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
    SELECT s.*, v.is_returning, v.returning_count, v.last_country AS country_code, v.device, v.network_speed
    FROM sessions s
    JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE 1=1
  `;
  const params = [];
  let idx = 0;
  const ph = () => (config.dbUrl ? `$${++idx}` : '?');

  if (filter === 'today') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(todayCutoff);
  } else if (filter === 'active') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(activeCutoff);
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

  return rows.map(r => ({
    ...r,
    country_code: r.country_code || 'XX',
  }));
}

async function getSessionEvents(sessionId, limit = 20) {
  const db = getDb();
  const rows = await db.all(
    'SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?',
    [sessionId, limit]
  );
  return rows.reverse();
}

/** Conversion rate = (sessions with has_purchased) / total sessions in window. Returns { overall, 6h, 12h, 48h, 72h } in percent. */
async function getConversionRates() {
  const db = getDb();
  const now = Date.now();
  const windows = [
    { key: 'overall', ms: 30 * 24 * 60 * 60 * 1000 },
    { key: '72h', ms: 72 * 60 * 60 * 1000 },
    { key: '48h', ms: 48 * 60 * 60 * 1000 },
    { key: '12h', ms: 12 * 60 * 60 * 1000 },
    { key: '6h', ms: 6 * 60 * 60 * 1000 },
  ];
  const out = { overall: null, '6h': null, '12h': null, '48h': null, '72h': null };
  for (const { key, ms } of windows) {
    const cutoff = now - ms;
    const total = await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= ?',
      [cutoff]
    );
    const purchased = await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= ? AND has_purchased = 1',
      [cutoff]
    );
    const t = total?.n ?? 0;
    const p = purchased?.n ?? 0;
    out[key] = t > 0 ? Math.round((p / t) * 1000) / 10 : null;
  }
  return out;
}

/** Sessions per country (last 72h), sorted by count desc, limit 20. */
async function getSessionsByCountry() {
  const db = getDb();
  const cutoff = Date.now() - 72 * 60 * 60 * 1000;
  const sql = `SELECT v.last_country AS country_code, COUNT(*) AS count
    FROM sessions s
    JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE s.last_seen >= ? AND v.last_country IS NOT NULL AND v.last_country != ''
    GROUP BY v.last_country
    ORDER BY count DESC
    LIMIT 20`;
  const rows = await db.all(sql, [cutoff]);
  return rows.map(r => ({
    country_code: (r.country_code || 'XX').toUpperCase().slice(0, 2),
    count: r.count,
  }));
}

async function getStats() {
  const [conversion, byCountry] = await Promise.all([
    getConversionRates(),
    getSessionsByCountry(),
  ]);
  return { conversion, byCountry };
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
  insertEvent,
  listSessions,
  getSessionEvents,
  getStats,
  validateEventType,
  ALLOWED_EVENT_TYPES,
};
