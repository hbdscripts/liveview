/**
 * GET /api/config-status – non-sensitive config for admin panel.
 */

const config = require('../config');
const store = require('../store');
const { getDb, isPostgres } = require('../db');

async function configStatus(req, res, next) {
  const hasShopify = !!(config.shopify.apiKey && config.shopify.apiSecret);
  const hasAppUrl = !!config.shopify.appUrl;
  const hasIngestSecret = !!config.ingestSecret;
  const ingestBase = config.ingestPublicUrl && config.ingestPublicUrl.startsWith('http')
    ? config.ingestPublicUrl
    : config.shopify.appUrl.replace(/\/$/, '');
  const ingestUrl = `${ingestBase}/api/ingest`;

  let trackingEnabled = config.trackingDefaultEnabled;
  try {
    trackingEnabled = await store.isTrackingEnabled();
  } catch (_) {}

  const now = Date.now();
  const last24hStart = now - 24 * 60 * 60 * 1000;
  const timeZone = store.resolveAdminTimeZone();
  const todayBounds = store.getRangeBounds('today', now, timeZone);
  const yesterdayBounds = store.getRangeBounds('yesterday', now, timeZone);

  const db = getDb();
  const dbEngine = isPostgres() ? 'postgres' : 'sqlite';

  async function tableExists(name) {
    try {
      // If table exists but is empty, db.get returns null (still ok).
      await db.get(`SELECT 1 FROM ${name} LIMIT 1`);
      return true;
    } catch (_) {
      return false;
    }
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  const health = {
    now,
    timeZone,
    ranges: { today: todayBounds, yesterday: yesterdayBounds },
    db: { engine: dbEngine },
    tables: {},
    sessions: {},
    purchases: {},
    events: {},
    cfKnownBot: {},
  };

  const hasSessions = await tableExists('sessions');
  const hasEvents = await tableExists('events');
  const hasPurchases = await tableExists('purchases');
  health.tables = { sessions: hasSessions, events: hasEvents, purchases: hasPurchases };

  if (hasSessions) {
    try {
      const maxRow = await db.get('SELECT MAX(started_at) AS max_started_at, MAX(last_seen) AS max_last_seen FROM sessions');
      health.sessions.max_started_at = num(maxRow?.max_started_at);
      health.sessions.max_last_seen = num(maxRow?.max_last_seen);
    } catch (_) {}
    try {
      const r24 = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?', [last24hStart]);
      health.sessions.last24h = num(r24?.n) ?? 0;
    } catch (_) {}
    try {
      const ry = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?', [yesterdayBounds.start, yesterdayBounds.end]);
      health.sessions.yesterday = num(ry?.n) ?? 0;
    } catch (_) {}
    try {
      const rp = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE has_purchased = 1 AND purchased_at >= ?', [last24hStart]);
      health.sessions.purchasedLast24h = num(rp?.n) ?? 0;
    } catch (_) {}
    try {
      const cf = await db.get(`
        SELECT
          SUM(CASE WHEN cf_known_bot = 1 THEN 1 ELSE 0 END) AS known_bot,
          SUM(CASE WHEN cf_known_bot = 0 THEN 1 ELSE 0 END) AS known_human,
          SUM(CASE WHEN cf_known_bot IS NULL THEN 1 ELSE 0 END) AS unknown
        FROM sessions
        WHERE started_at >= ?
      `, [last24hStart]);
      health.cfKnownBot = {
        known_bot: num(cf?.known_bot) ?? 0,
        known_human: num(cf?.known_human) ?? 0,
        unknown: num(cf?.unknown) ?? 0,
      };
    } catch (_) {}
  }

  if (hasEvents) {
    try {
      const r = await db.get('SELECT COUNT(*) AS n FROM events WHERE type = ? AND ts >= ?', ['checkout_completed', last24hStart]);
      health.events.checkoutCompletedLast24h = num(r?.n) ?? 0;
    } catch (_) {}
  }

  if (hasPurchases) {
    try {
      const maxRow = await db.get('SELECT MAX(purchased_at) AS max_purchased_at FROM purchases');
      health.purchases.max_purchased_at = num(maxRow?.max_purchased_at);
    } catch (_) {}
    try {
      const r24 = await db.get('SELECT COUNT(*) AS n FROM purchases WHERE purchased_at >= ?', [last24hStart]);
      health.purchases.last24h = num(r24?.n) ?? 0;
    } catch (_) {}
    try {
      const ry = await db.get('SELECT COUNT(*) AS n FROM purchases WHERE purchased_at >= ? AND purchased_at < ?', [yesterdayBounds.start, yesterdayBounds.end]);
      health.purchases.yesterday = num(ry?.n) ?? 0;
    } catch (_) {}
  }

  res.json({
    shopify: { configured: hasShopify },
    appUrl: { configured: hasAppUrl, value: config.shopify.appUrl },
    ingestSecret: { configured: hasIngestSecret },
    ingestUrl,
    ingestPublicUrl: config.ingestPublicUrl || '',
    trackingEnabled,
    adminTimezone: config.adminTimezone,
    trafficMode: config.trafficMode,
    sessionRetentionDays: config.sessionRetentionDays,
    db: { engine: dbEngine, configured: isPostgres() },
    sentry: { configured: !!(config.sentryDsn && config.sentryDsn.trim()) },
    health,
  });
}

module.exports = configStatus;
