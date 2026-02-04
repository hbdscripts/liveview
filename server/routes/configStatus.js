/**
 * GET /api/config-status – non-sensitive config for admin panel.
 * Optional ?shop=xxx.myshopify.com to fetch Shopify sessions (today); otherwise uses ALLOWED_SHOP_DOMAIN.
 */

const config = require('../config');
const store = require('../store');
const { getDb, isPostgres } = require('../db');

const GRAPHQL_API_VERSION = '2025-10'; // shopifyqlQuery available from 2025-10

/**
 * Returns { count, error } where count is a number or null, and error is a short message if the request failed.
 */
function firstErrorMsg(json) {
  const err = json?.errors?.[0];
  if (err && typeof err.message === 'string') return err.message;
  return null;
}

async function fetchShopifySessionsToday(shop, accessToken) {
  const query = 'FROM sessions SHOW sessions DURING today';
  const graphqlUrl = `https://${shop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`;
  let res;
  let text;
  try {
    res = await fetch(graphqlUrl, {
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
    text = await res.text();
  } catch (err) {
    return { count: null, error: err && err.message ? String(err.message).slice(0, 80) : 'Network error' };
  }
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    return { count: null, error: 'Invalid JSON from Shopify' };
  }
  if (!res.ok) {
    const msg = firstErrorMsg(json) || json?.message || `HTTP ${res.status}`;
    console.error('[config-status] Shopify sessions request failed:', res.status, String(text).slice(0, 500));
    return { count: null, error: String(msg).slice(0, 120) };
  }
  const graphqlError = firstErrorMsg(json);
  if (graphqlError) {
    console.error('[config-status] Shopify GraphQL error:', graphqlError, String(text).slice(0, 500));
    return { count: null, error: String(graphqlError).slice(0, 120) };
  }
  if (!json?.data?.shopifyqlQuery) {
    const msg = 'No shopifyqlQuery in response';
    console.error('[config-status] Shopify sessions:', msg, String(text).slice(0, 500));
    return { count: null, error: msg };
  }
  const q = json.data.shopifyqlQuery;
  if (q.parseErrors?.length) {
    const msg = (q.parseErrors[0] || 'Parse error').slice(0, 120);
    return { count: null, error: msg };
  }
  const table = q.tableData;
  if (!table?.rows?.length) return { count: 0, error: '' };
  const columns = (table.columns || []).map((c) => c.name);
  const sessionsIdx = columns.findIndex((n) => String(n).toLowerCase().includes('sessions'));
  if (sessionsIdx === -1) return { count: null, error: 'Sessions column not found' };
  let total = 0;
  for (const row of table.rows) {
    const val = Array.isArray(row) ? row[sessionsIdx] : row[columns[sessionsIdx]];
    const n = typeof val === 'number' ? val : parseInt(String(val || '').replace(/,/g, ''), 10);
    if (Number.isFinite(n)) total += n;
  }
  return { count: total, error: '' };
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
    storedScopes: '',
    /** Scopes the server would request on next OAuth (from SHOPIFY_SCOPES). Shown so user can confirm env before reinstalling. */
    serverScopes: (config.shopify.scopes || '').split(',').map((s) => s.trim()).filter(Boolean).join(', '),
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
      health.storedScopes = scope ? scope.split(',').map((s) => s.trim()).filter(Boolean).join(', ') : '';
      if (!token) {
        health.shopifySessionsTodayNote = 'No Shopify access token for this shop. Install the app (OAuth) or reinstall from Shopify Admin.';
      } else {
        // Always try the API when we have a token; show count or real error (e.g. missing read_reports → 403 / access denied).
        const result = await fetchShopifySessionsToday(shop, token);
        if (typeof result.count === 'number') {
          health.shopifySessionsToday = result.count;
          health.shopifySessionsTodayNote = '';
        } else {
          const errMsg = result.error ? String(result.error) : '';
          const isAuthError = /http\s*401|http\s*403|unauthorized|invalid access token|access token/i.test(errMsg);
          if (isAuthError) {
            health.shopifySessionsTodayNote =
              'Shopify returned ' + (errMsg ? errMsg : 'HTTP 401/403') +
              '. The stored access token is invalid/revoked. Open the app from Shopify Admin to re-authorize, or uninstall + reinstall the app.';
          } else {
            health.shopifySessionsTodayNote = errMsg
              ? 'Shopify returned: ' + errMsg
              : 'Shopify Sessions unavailable (ShopifyQL may require Protected Customer Data access in Partners).';
            // Explain why orders/revenue work but sessions don't: different Shopify APIs (Orders API vs Reports/ShopifyQL)
            health.shopifySessionsTodayNote += ' Orders and revenue use the Orders API (read_orders); session count uses Reports (ShopifyQL, read_reports)—same app, different API.';
            const missingScope = /access denied|forbidden|required scope/i.test(errMsg);
            if (missingScope && !(scope.toLowerCase().split(',').map((s) => s.trim()).includes('read_reports'))) {
              health.shopifySessionsTodayNote += ' Add read_reports to SHOPIFY_SCOPES in Railway, redeploy, then uninstall and reinstall the app from this store\'s Admin.';
            }
            if (errMsg && /protected customer|customer data|level 2/i.test(errMsg)) {
              health.shopifySessionsTodayNote += ' Enable Protected Customer Data in Partners (App setup → API access).';
            }
          }
        }
      }
    } catch (err) {
      health.shopifySessionsTodayNote = (err && err.message ? String(err.message).slice(0, 80) : 'Error loading Shopify sessions') + '. Check server logs.';
    }
  } else if (health.shopifySessionsTodayNote === undefined || health.shopifySessionsTodayNote === '') {
    health.shopifySessionsTodayNote = 'Open the app with ?shop=yourstore.myshopify.com in the URL, or set ALLOWED_SHOP_DOMAIN (or SHOP_DOMAIN) in Railway, so Config can fetch Shopify sessions.';
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
module.exports.fetchShopifySessionsToday = fetchShopifySessionsToday;
