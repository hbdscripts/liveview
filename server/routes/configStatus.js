/**
 * GET /api/config-status – non-sensitive config for admin panel.
 * Optional ?shop=xxx.myshopify.com to fetch Shopify sessions (today); otherwise uses ALLOWED_SHOP_DOMAIN.
 */

const config = require('../config');
const store = require('../store');
const { getDb, isPostgres } = require('../db');

const GRAPHQL_API_VERSION = '2025-10'; // shopifyqlQuery available from 2025-10

async function fetchShopifySessionsToday(shop, accessToken) {
  const query = 'FROM sessions SHOW sessions DURING today';
  const graphqlUrl = `https://${shop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`;
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      query: `query($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name } rows } parseErrors } }`,
      variables: { q: query },
    }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
  if (!res.ok || !json?.data?.shopifyqlQuery) return null;
  const q = json.data.shopifyqlQuery;
  if (q.parseErrors?.length) return null;
  const table = q.tableData;
  if (!table?.rows?.length) return 0;
  const columns = (table.columns || []).map((c) => c.name);
  const sessionsIdx = columns.findIndex((n) => String(n).toLowerCase().includes('sessions'));
  if (sessionsIdx === -1) return null;
  let total = 0;
  for (const row of table.rows) {
    const val = Array.isArray(row) ? row[sessionsIdx] : row[columns[sessionsIdx]];
    const n = typeof val === 'number' ? val : parseInt(String(val || '').replace(/,/g, ''), 10);
    if (Number.isFinite(n)) total += n;
  }
  return total;
}

async function configStatus(req, res, next) {
  const hasShopify = !!(config.shopify.apiKey && config.shopify.apiSecret);
  const hasAppUrl = !!config.shopify.appUrl;
  const hasIngestSecret = !!config.ingestSecret;
  const ingestBase = config.ingestPublicUrl && config.ingestPublicUrl.startsWith('http')
    ? config.ingestPublicUrl
    : config.shopify.appUrl.replace(/\/$/, '');
  const ingestUrl = `${ingestBase}/api/ingest`;

  const trackingEnabled = true;

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
    botsLast24h: 0,
    humanLast24h: 0,
    shopifySessionsToday: null,
    shopifySessionsTodayNote: '',
    sessionsToday: null,
    botsToday: 0,
    humanToday: 0,
    botsBlockedAtEdge: 0, // from Worker callback POST /api/bot-blocked
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
      const rt = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?', [todayBounds.start]);
      health.sessionsToday = num(rt?.n) ?? 0;
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
      const kb = num(cf?.known_bot) ?? 0;
      const kh = num(cf?.known_human) ?? 0;
      const ku = num(cf?.unknown) ?? 0;
      health.botsLast24h = kb;
      health.humanLast24h = kh + ku;
    } catch (_) {}
    try {
      const cfToday = await db.get(`
        SELECT
          SUM(CASE WHEN cf_known_bot = 1 THEN 1 ELSE 0 END) AS known_bot,
          SUM(CASE WHEN cf_known_bot = 0 OR cf_known_bot IS NULL THEN 1 ELSE 0 END) AS human
        FROM sessions
        WHERE started_at >= ?
      `, [todayBounds.start]);
      health.botsToday = num(cfToday?.known_bot) ?? 0;
      health.humanToday = num(cfToday?.human) ?? 0;
    } catch (_) {}
  }

  if (hasEvents) {
    try {
      const r = await db.get('SELECT COUNT(*) AS n FROM events WHERE type = ? AND ts >= ?', ['checkout_completed', last24hStart]);
      health.events.checkoutCompletedLast24h = num(r?.n) ?? 0;
    } catch (_) {}
  }

  try {
    const todayStr = new Date(todayBounds.start).toLocaleDateString('en-CA', { timeZone: store.resolveAdminTimeZone() });
    const blockRow = await db.get('SELECT "count" AS n FROM bot_block_counts WHERE date = ?', [todayStr]);
    if (blockRow != null) health.botsBlockedAtEdge = num(blockRow.n) ?? 0;
  } catch (_) {}

  const shop = (req.query.shop || config.allowedShopDomain || config.shopDomain || '').trim().toLowerCase();
  if (shop && shop.endsWith('.myshopify.com')) {
    try {
      const row = await db.get('SELECT access_token, scope FROM shop_sessions WHERE shop = ?', [shop]);
      const token = row?.access_token;
      const scope = typeof row?.scope === 'string' ? row.scope : '';
      if (!token) {
        health.shopifySessionsTodayNote = 'No Shopify access token found for this shop (complete OAuth / reinstall).';
      } else if (!scope.toLowerCase().split(',').map(s => s.trim()).includes('read_reports')) {
        health.shopifySessionsTodayNote = 'Shopify Sessions requires read_reports. Re-authorize the app so the store grants the new scope.';
      } else {
        const n = await fetchShopifySessionsToday(shop, token);
        if (typeof n === 'number') {
          health.shopifySessionsToday = n;
        } else {
          health.shopifySessionsTodayNote = 'Shopify Sessions unavailable (ShopifyQL requires read_reports + protected customer data access).';
        }
      }
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
    sessionRetentionDays: config.sessionRetentionDays,
    db: { engine: dbEngine, configured: isPostgres() },
    sentry: { configured: !!(config.sentryDsn && config.sentryDsn.trim()) },
    health,
  });
}

module.exports = configStatus;
