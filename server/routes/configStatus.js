/**
 * GET /api/config-status – diagnostics-only payload for the dashboard settings modal.
 *
 * Optional ?shop=xxx.myshopify.com to fetch Shopify-backed diagnostics; otherwise falls back to ALLOWED_SHOP_DOMAIN / SHOP_DOMAIN.
 */

const config = require('../config');
const store = require('../store');
const { getDb, isPostgres } = require('../db');
const salesTruth = require('../salesTruth');
const {
  DEFINITIONS_VERSION: TRACKER_DEFS_VERSION,
  LAST_UPDATED: TRACKER_DEFS_LAST_UPDATED,
  TRACKER_TABLE_DEFINITIONS,
} = require('../trackerDefinitions');
const pkg = require('../../package.json');
const shopifyQl = require('../shopifyQl');

const PIXEL_API_VERSION = '2024-01';

/**
 * Returns { count, error } where count is a number or null, and error is a short message if the request failed.
 */
function firstErrorMsg(json) {
  const err = json?.errors?.[0];
  if (err && typeof err.message === 'string') return err.message;
  return null;
}

async function fetchShopifySessionsToday(shop, accessToken) {
  return shopifyQl.fetchShopifySessionsCount(shop, accessToken, { during: 'today' });
}

function safeJsonParse(str) {
  if (!str || typeof str !== 'string') return null;
  try {
    return JSON.parse(str);
  } catch (_) {
    return null;
  }
}

async function fetchShopifyWebPixelIngestUrl(shop, accessToken) {
  const graphqlUrl = `https://${shop}/admin/api/${PIXEL_API_VERSION}/graphql.json`;
  let res;
  let text;
  try {
    res = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query: 'query { webPixel { settings } }' }),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, installed: null, ingestUrl: null, message: err && err.message ? String(err.message).slice(0, 120) : 'Network error' };
  }

  const json = safeJsonParse(text) || null;
  const gqlErrors = Array.isArray(json?.errors) ? json.errors : [];
  const notFound = gqlErrors.some((e) => {
    const code = (e && e.extensions && e.extensions.code) ? String(e.extensions.code) : '';
    const msg = e && e.message ? String(e.message) : '';
    return code.toUpperCase() === 'RESOURCE_NOT_FOUND' || /no web pixel was found/i.test(msg);
  });
  if (notFound) {
    return { ok: true, installed: false, ingestUrl: null, message: 'No web pixel for this app (yet)' };
  }

  if (!res.ok) {
    const msg = firstErrorMsg(json) || json?.message || `HTTP ${res.status}`;
    return { ok: false, installed: null, ingestUrl: null, message: String(msg).slice(0, 180) };
  }
  if (gqlErrors.length > 0) {
    const msg = firstErrorMsg(json) || 'GraphQL error';
    return { ok: false, installed: null, ingestUrl: null, message: String(msg).slice(0, 180) };
  }

  const raw = json?.data?.webPixel?.settings;
  if (raw == null) return { ok: true, installed: true, ingestUrl: null, message: 'Pixel installed but settings are empty' };
  const settings = (typeof raw === 'object' && raw !== null) ? raw : safeJsonParse(raw);
  const ingestUrl = (settings && typeof settings.ingestUrl === 'string') ? settings.ingestUrl : null;
  return { ok: true, installed: true, ingestUrl, message: '' };
}

async function configStatus(req, res, next) {
  const now = Date.now();
  const last24hStart = now - 24 * 60 * 60 * 1000;
  const timeZone = store.resolveAdminTimeZone();
  const todayBounds = store.getRangeBounds('today', now, timeZone);

  const db = getDb();
  const dbEngine = isPostgres() ? 'postgres' : 'sqlite';

  async function tableExists(name) {
    try {
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

  const shop = salesTruth.resolveShopForSales(req.query.shop || '');
  const serverScopes = (config.shopify.scopes || '').split(',').map((s) => s.trim()).filter(Boolean).join(', ');

  // --- DB tables ---
  const tables = {
    settings: await tableExists('settings'),
    shop_sessions: await tableExists('shop_sessions'),
    visitors: await tableExists('visitors'),
    sessions: await tableExists('sessions'),
    events: await tableExists('events'),
    purchases: await tableExists('purchases'),
    orders_shopify: await tableExists('orders_shopify'),
    orders_shopify_line_items: await tableExists('orders_shopify_line_items'),
    customer_order_facts: await tableExists('customer_order_facts'),
    purchase_events: await tableExists('purchase_events'),
    reconcile_state: await tableExists('reconcile_state'),
    reconcile_snapshots: await tableExists('reconcile_snapshots'),
    shopify_sessions_snapshots: await tableExists('shopify_sessions_snapshots'),
    audit_log: await tableExists('audit_log'),
    bot_block_counts: await tableExists('bot_block_counts'),
    traffic_source_meta: await tableExists('traffic_source_meta'),
    traffic_source_rules: await tableExists('traffic_source_rules'),
    traffic_source_tokens: await tableExists('traffic_source_tokens'),
  };

  let reporting = { ordersSource: 'orders_shopify', sessionsSource: 'sessions' };
  try { reporting = await store.getReportingConfig(); } catch (_) {}
  let pixelSessionMode = 'legacy';
  try {
    const raw = await store.getSetting('pixel_session_mode');
    const s = raw == null ? '' : String(raw).trim().toLowerCase();
    if (s === 'shared_ttl' || s === 'shared' || s === 'sharedttl') pixelSessionMode = 'shared_ttl';
  } catch (_) {}

  // --- Shopify token / scopes ---
  let token = '';
  let storedScopes = '';
  if (shop) {
    try {
      const row = await db.get('SELECT access_token, scope FROM shop_sessions WHERE shop = ?', [shop]);
      token = row?.access_token ? String(row.access_token) : '';
      storedScopes = typeof row?.scope === 'string'
        ? row.scope.split(',').map((s) => s.trim()).filter(Boolean).join(', ')
        : '';
    } catch (_) {}
  }

  // --- Traffic diagnostics (ours, bot-tagged, edge blocked) ---
  const traffic = {
    today: { sessionsReachedApp: null, humanSessions: null, botSessionsTagged: null, botsBlockedAtEdge: 0, botsBlockedAtEdgeUpdatedAt: null, totalTrafficEst: null },
    last24h: { sessionsReachedApp: null, humanSessions: null, botSessionsTagged: null },
    shopifySessionsToday: null,
    shopifySessionsTodayNote: '',
  };
  if (tables.sessions) {
    try {
      const r = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?', [todayBounds.start]);
      traffic.today.sessionsReachedApp = num(r?.n) ?? 0;
    } catch (_) {}
    try {
      const cfToday = await db.get(`
        SELECT
          SUM(CASE WHEN cf_known_bot = 1 THEN 1 ELSE 0 END) AS known_bot,
          SUM(CASE WHEN cf_known_bot = 0 OR cf_known_bot IS NULL THEN 1 ELSE 0 END) AS human
        FROM sessions
        WHERE started_at >= ?
      `, [todayBounds.start]);
      const bots = num(cfToday?.known_bot) ?? 0;
      const human = num(cfToday?.human) ?? 0;
      traffic.today.botSessionsTagged = bots;
      traffic.today.humanSessions = human;
    } catch (_) {}
    try {
      const r24 = await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ?', [last24hStart]);
      traffic.last24h.sessionsReachedApp = num(r24?.n) ?? 0;
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
      traffic.last24h.botSessionsTagged = kb;
      traffic.last24h.humanSessions = kh + ku;
    } catch (_) {}
  }
  if (tables.bot_block_counts) {
    try {
      const todayStr = new Date(todayBounds.start).toLocaleDateString('en-CA', { timeZone });
      try {
        const blockRow = await db.get('SELECT "count" AS n, updated_at FROM bot_block_counts WHERE date = ?', [todayStr]);
        if (blockRow != null) {
          traffic.today.botsBlockedAtEdge = num(blockRow.n) ?? 0;
          traffic.today.botsBlockedAtEdgeUpdatedAt = num(blockRow.updated_at);
        }
      } catch (_) {
        const blockRow = await db.get('SELECT "count" AS n FROM bot_block_counts WHERE date = ?', [todayStr]);
        if (blockRow != null) traffic.today.botsBlockedAtEdge = num(blockRow.n) ?? 0;
      }
    } catch (_) {}
  }
  if (typeof traffic.today.sessionsReachedApp === 'number' && typeof traffic.today.botsBlockedAtEdge === 'number') {
    traffic.today.totalTrafficEst = traffic.today.sessionsReachedApp + traffic.today.botsBlockedAtEdge;
  }

  // Shopify sessions today (ShopifyQL). Useful for diagnosing "why Shopify sessions don't match ours".
  if (shop && token) {
    const result = await fetchShopifySessionsToday(shop, token);
    if (typeof result.count === 'number') {
      traffic.shopifySessionsToday = result.count;
      traffic.shopifySessionsTodayNote = '';
      // Append Shopify sessions snapshot (today). Fail-open if table doesn't exist.
      try {
        const dayYmd = new Date(todayBounds.start).toLocaleDateString('en-CA', { timeZone });
        await store.saveShopifySessionsSnapshot({
          shop,
          snapshotKey: 'today',
          dayYmd,
          sessionsCount: result.count,
          fetchedAt: now,
        });
      } catch (_) {}
    } else {
      traffic.shopifySessionsToday = null;
      traffic.shopifySessionsTodayNote = result.error ? String(result.error) : 'Shopify sessions unavailable';
    }
  } else if (shop && !token) {
    traffic.shopifySessionsTodayNote = 'No Shopify access token stored for this shop (install/reinstall from Shopify Admin).';
  } else if (!shop) {
    traffic.shopifySessionsTodayNote = 'Missing shop domain (open the dashboard with ?shop=store.myshopify.com or set ALLOWED_SHOP_DOMAIN).';
  }

  // --- Sales truth + evidence diagnostics ---
  const truth = {
    today: {
      orderCount: null,
      revenueGbp: null,
      checkoutOrderCount: null,
      checkoutRevenueGbp: null,
      returningCustomerCount: null,
      returningRevenueGbp: null,
      lastOrderCreatedAt: null,
    },
    health: await salesTruth.getTruthHealth(shop || '', 'today'),
    lastVerify: null,
    lastReconcile: null,
  };
  const evidence = {
    today: { checkoutCompleted: null, linked: null, unlinked: null, lastOccurredAt: null },
  };
  const pixelDerived = {
    today: { orderCount: null, revenueGbp: null },
  };

  if (shop && tables.orders_shopify) {
    try {
      truth.today.orderCount = await salesTruth.getTruthOrderCount(shop, todayBounds.start, todayBounds.end);
      truth.today.revenueGbp = await salesTruth.getTruthSalesTotalGbp(shop, todayBounds.start, todayBounds.end);
      truth.today.checkoutOrderCount = await salesTruth.getTruthCheckoutOrderCount(shop, todayBounds.start, todayBounds.end);
      truth.today.checkoutRevenueGbp = await salesTruth.getTruthCheckoutSalesTotalGbp(shop, todayBounds.start, todayBounds.end);
      truth.today.returningCustomerCount = await salesTruth.getTruthReturningCustomerCount(shop, todayBounds.start, todayBounds.end);
      truth.today.returningRevenueGbp = await salesTruth.getTruthReturningRevenueGbp(shop, todayBounds.start, todayBounds.end);
    } catch (_) {}
    try {
      const r = await db.get(
        `SELECT MAX(created_at) AS max_created_at
         FROM orders_shopify
         WHERE shop = ?
           AND created_at >= ? AND created_at < ?
           AND (test IS NULL OR test = 0)
           AND cancelled_at IS NULL
           AND financial_status = 'paid'`,
        [shop, todayBounds.start, todayBounds.end]
      );
      truth.today.lastOrderCreatedAt = num(r?.max_created_at);
    } catch (_) {}
  }

  if (shop && tables.purchase_events) {
    try {
      const row = await db.get(
        `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN linked_order_id IS NOT NULL THEN 1 ELSE 0 END) AS linked,
          SUM(CASE WHEN linked_order_id IS NULL THEN 1 ELSE 0 END) AS unlinked,
          MAX(occurred_at) AS max_occurred_at
        FROM purchase_events
        WHERE shop = ? AND event_type = 'checkout_completed'
          AND occurred_at >= ? AND occurred_at < ?
        `,
        [shop, todayBounds.start, todayBounds.end]
      );
      evidence.today.checkoutCompleted = row?.total != null ? Number(row.total) || 0 : 0;
      evidence.today.linked = row?.linked != null ? Number(row.linked) || 0 : 0;
      evidence.today.unlinked = row?.unlinked != null ? Number(row.unlinked) || 0 : 0;
      evidence.today.lastOccurredAt = num(row?.max_occurred_at);
    } catch (_) {}
  }

  // Pixel-derived totals (purchases table, deduped in query). Useful for debugging drift.
  if (tables.purchases) {
    try {
      const s = await store.getPixelSalesSummary(todayBounds.start, todayBounds.end);
      pixelDerived.today.orderCount = typeof s.orderCount === 'number' ? s.orderCount : null;
      pixelDerived.today.revenueGbp = typeof s.revenueGbp === 'number' ? s.revenueGbp : null;
    } catch (_) {}
  }

  // --- Pixel diagnostics (Shopify web pixel settings for this app) ---
  let pixel = { ok: false, installed: null, ingestUrl: null, message: '' };
  if (shop && token) {
    pixel = await fetchShopifyWebPixelIngestUrl(shop, token);
  } else if (shop && !token) {
    pixel = { ok: false, installed: null, ingestUrl: null, message: 'No Shopify token stored for this shop yet' };
  } else {
    pixel = { ok: false, installed: null, ingestUrl: null, message: 'No shop specified' };
  }

  // --- Audit breadcrumbs (best-effort; no extra Shopify calls) ---
  async function latestAudit(action) {
    if (!tables.audit_log) return null;
    try {
      const rows = await db.all('SELECT ts, details_json FROM audit_log WHERE action = ? ORDER BY ts DESC LIMIT 25', [action]);
      for (const row of rows || []) {
        const details = safeJsonParse(row.details_json);
        if (!details || (shop && details.shop && String(details.shop).toLowerCase() !== String(shop).toLowerCase())) continue;
        return { ts: num(row.ts), details };
      }
    } catch (_) {}
    return null;
  }

  const lastVerify = await latestAudit('verify_sales');
  if (lastVerify && lastVerify.details && Array.isArray(lastVerify.details.results)) {
    const allOk = lastVerify.details.results.every((r) => r && r.ok === true);
    const today = lastVerify.details.results.find((r) => r && r.range && r.range.key === 'today') || null;
    truth.lastVerify = {
      ts: lastVerify.ts,
      ok: allOk,
      todayDiff: today && today.diff ? today.diff : null,
    };
  }
  const lastReconcile = await latestAudit('reconcile_orders_shopify');
  if (lastReconcile && lastReconcile.details) {
    truth.lastReconcile = {
      ts: lastReconcile.ts,
      scope: lastReconcile.details.scope || '',
      fetched: num(lastReconcile.details.fetched),
      inserted: num(lastReconcile.details.inserted),
      updated: num(lastReconcile.details.updated),
      evidenceLinked: num(lastReconcile.details.evidenceLinked),
      shopify: lastReconcile.details.shopify || null,
    };
  }

  // --- Ingest config (non-sensitive) ---
  const ingestBase = config.ingestPublicUrl && config.ingestPublicUrl.startsWith('http')
    ? config.ingestPublicUrl.replace(/\/$/, '')
    : (config.shopify.appUrl || '').replace(/\/$/, '');
  const effectiveIngestUrl = ingestBase ? `${ingestBase}/api/ingest` : '';

  // --- Tracker metric/table definitions (auditable manifest + runtime checks) ---
  function attachTrackerChecks(def) {
    const requires = def && def.requires ? def.requires : {};
    const requiredTables = Array.isArray(requires.dbTables) ? requires.dbTables : [];
    const missingTables = requiredTables.filter((t) => !tables[String(t)]);
    const byReporting = def && def.requiresByReporting ? def.requiresByReporting : {};
    const activeTables = [];
    for (const t of requiredTables) activeTables.push(String(t));
    if (byReporting && byReporting.ordersSource && reporting && typeof reporting.ordersSource === 'string') {
      const extra = byReporting.ordersSource[reporting.ordersSource];
      if (Array.isArray(extra)) for (const t of extra) activeTables.push(String(t));
    }
    if (byReporting && byReporting.sessionsSource && reporting && typeof reporting.sessionsSource === 'string') {
      const extra = byReporting.sessionsSource[reporting.sessionsSource];
      if (Array.isArray(extra)) for (const t of extra) activeTables.push(String(t));
    }
    const activeTablesUniq = Array.from(new Set(activeTables.filter(Boolean)));
    const activeMissingTables = activeTablesUniq.filter((t) => !tables[String(t)]);
    const needsToken = !!requires.shopifyToken;
    const tokenOk = !needsToken || !!token;
    return {
      ...def,
      checks: {
        dbTablesOk: missingTables.length === 0,
        dbTablesMissing: missingTables,
        activeDbTablesOk: activeMissingTables.length === 0,
        activeDbTablesMissing: activeMissingTables,
        activeDbTables: activeTablesUniq,
        shopifyTokenOk: tokenOk,
      },
    };
  }

  const trackerDefinitions = {
    version: TRACKER_DEFS_VERSION,
    lastUpdated: TRACKER_DEFS_LAST_UPDATED,
    tables: (TRACKER_TABLE_DEFINITIONS || []).map(attachTrackerChecks),
    note:
      'Update this manifest when adding/changing dashboard tables or metric math, so the diagnostics modal remains the single source of truth.',
  };

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({
    now,
    timeZone,
    app: {
      version: pkg.version || '0.0.0',
      nodeEnv: process.env.NODE_ENV || 'development',
      sentryConfigured: !!(config.sentryDsn && config.sentryDsn.trim()),
    },
    shopify: {
      shop,
      hasToken: !!token,
      storedScopes,
      serverScopes,
    },
    db: {
      engine: dbEngine,
      configured: isPostgres(),
      tables,
    },
    reporting,
    settings: {
      pixelSessionMode,
    },
    ingest: {
      effectiveIngestUrl,
      ingestPublicUrl: config.ingestPublicUrl || '',
      allowedIngestOrigins: config.allowedIngestOrigins || [],
      ingestSecretConfigured: !!(config.ingestSecret && String(config.ingestSecret).trim()),
    },
    traffic: {
      boundsToday: todayBounds,
      ...traffic,
    },
    sales: {
      boundsToday: todayBounds,
      truth,
      evidence,
      pixel: pixelDerived,
      drift: {
        orders: (typeof evidence.today.checkoutCompleted === 'number' && typeof truth.today.orderCount === 'number')
          ? (evidence.today.checkoutCompleted - truth.today.orderCount)
          : null,
        pixelVsTruthOrders: (typeof pixelDerived.today.orderCount === 'number' && typeof truth.today.orderCount === 'number')
          ? (pixelDerived.today.orderCount - truth.today.orderCount)
          : null,
        pixelVsTruthRevenueGbp: (typeof pixelDerived.today.revenueGbp === 'number' && typeof truth.today.revenueGbp === 'number')
          ? Math.round((pixelDerived.today.revenueGbp - truth.today.revenueGbp) * 100) / 100
          : null,
      },
    },
    pixel,
    trackerDefinitions,
  });
}

module.exports = configStatus;
module.exports.fetchShopifySessionsToday = fetchShopifySessionsToday;
