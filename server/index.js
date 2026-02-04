/**
 * Live Visitors app – Express server, ingest, SSE, admin API, cleanup job.
 * IMPORTANT: instrument.js must be required first so Sentry initializes before anything else.
 */

require('./instrument.js');

const Sentry = require('@sentry/node');
const config = require('./config');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb } = require('./db');
const cleanup = require('./cleanup');

const ingestRouter = require('./routes/ingest');
const streamRouter = require('./routes/stream');
const sessionsRouter = require('./routes/sessions');
const configStatus = require('./routes/configStatus');
const shopifySessions = require('./routes/shopifySessions');
const statsRouter = require('./routes/stats');
const trafficRouter = require('./routes/traffic');
const pixelRouter = require('./routes/pixel');
const shopifySales = require('./routes/shopifySales');
const salesDiagnostics = require('./routes/salesDiagnostics');
const verifySales = require('./routes/verifySales');
const reconcileSales = require('./routes/reconcileSales');
const shopifyBestSellers = require('./routes/shopifyBestSellers');
const shopifyBestVariants = require('./routes/shopifyBestVariants');
const worstProducts = require('./routes/worstProducts');
const ogThumb = require('./routes/ogThumb');
const auth = require('./routes/auth');
const login = require('./routes/login');
const oauthLogin = require('./routes/oauthLogin');
const dashboardAuth = require('./middleware/dashboardAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check (for Railway/proxy – no auth, no redirects)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// robots.txt – public so crawlers see noindex/Disallow without hitting dashboard auth
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Log every request (so we can see in Railway logs if the request reached the app)
app.use((req, res, next) => {
  console.log('[Request]', req.method, req.path);
  next();
});

// Body parser (for ingest JSON)
app.use(express.json({ limit: config.maxEventPayloadBytes }));
app.use(express.urlencoded({ extended: true }));

// CORS: ingest allows * (pixel sandbox Origin: null)
app.use('/api/ingest', cors({ origin: true, credentials: false }));

app.use('/api/ingest', ingestRouter);

// Admin API (no Shopify auth for minimal local run; add middleware for production)
app.get('/api/stream', streamRouter);
app.get('/api/sessions', sessionsRouter.list);
app.get('/api/sessions/:id/events', sessionsRouter.events);
app.get('/api/config-status', configStatus);
app.post('/api/bot-blocked', require('./routes/botBlocked').postBotBlocked);
app.get('/api/stats', statsRouter.getStats);
app.get('/api/traffic', trafficRouter.getTraffic);
app.post('/api/traffic-prefs', trafficRouter.setTrafficPrefs);
app.get('/api/sales-diagnostics', salesDiagnostics.getSalesDiagnostics);
app.get('/api/reconcile-sales', reconcileSales.reconcileSales);
app.post('/api/reconcile-sales', reconcileSales.reconcileSales);
app.get('/api/verify-sales', verifySales.verifySales);
app.get('/api/pixel/ensure', pixelRouter.ensurePixel);
app.post('/api/pixel/ensure', pixelRouter.ensurePixel);
app.get('/api/pixel/status', pixelRouter.getPixelStatus);
app.get('/api/pixel/config', pixelRouter.getPixelConfig);
app.get('/api/shopify-sales', shopifySales.getShopifySalesToday);
app.get('/api/shopify-sessions', shopifySessions.getShopifySessionsToday);
app.get('/api/shopify-best-sellers', shopifyBestSellers.getShopifyBestSellers);
app.get('/api/shopify-best-variants', shopifyBestVariants.getShopifyBestVariants);
app.get('/api/worst-products', worstProducts.getWorstProducts);
app.get('/api/og-thumb', ogThumb.handleOgThumb);
const pkg = require(path.join(__dirname, '..', 'package.json'));
app.get('/api/version', (req, res) => res.json({ version: pkg.version || '0.0.0' }));
app.get('/api/store-base-url', (req, res) => {
  const domain = (config.shopDomain || '').trim().toLowerCase();
  const baseUrl = !domain ? '' : (domain.startsWith('http') ? domain : 'https://' + domain.replace(/^\.+/, ''));
  const mainBaseUrl = config.storeMainDomain || baseUrl;
  const assetsBaseUrl = config.assetsBaseUrl || '';
  const shopForSales = (config.shopDomain || config.allowedShopDomain || '').trim().toLowerCase();
  res.json({ baseUrl, mainBaseUrl, assetsBaseUrl, shopForSales: shopForSales && shopForSales.endsWith('.myshopify.com') ? shopForSales : '' });
});

// Shopify OAuth (install flow)
app.get('/auth/callback', (req, res) => auth.handleCallback(req, res));
app.get('/auth/shopify/callback', (req, res) => auth.handleCallback(req, res));

// Dashboard login (no auth required for these paths)
app.get('/app/login', login.handleGetLogin);
app.get('/app/logout', login.handleLogout);

// OAuth login: Google and "Login with Shopify"
app.get('/auth/google', oauthLogin.handleGoogleRedirect);
app.get('/auth/google/callback', oauthLogin.handleGoogleCallback);
app.get('/auth/shopify-login', oauthLogin.handleShopifyLoginRedirect);
app.get('/auth/shopify-login/callback', oauthLogin.handleShopifyLoginCallback);

// Allow embedding in Shopify admin (fixes "admin.shopify.com refused to connect"); keep private from search/AI
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com 'self'"
  );
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Block docs/markdown paths from being served in production.
app.use((req, res, next) => {
  const p = req.path || '';
  if (p.startsWith('/docs') || /\.md$/i.test(p)) {
    res.status(404).end();
    return;
  }
  next();
});

// Protect dashboard and API: only from Shopify admin (Referer) or with DASHBOARD_SECRET (cookie/header)
app.use(dashboardAuth.middleware);

// Admin UI (embedded dashboard) - before / so /app/live-visitors is exact
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.get('/app/live-visitors', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'public', 'live-visitors.html'));
});

// App URL: if shop + hmac (no code), OAuth when no session else show dashboard in iframe; else redirect to dashboard
app.get('/', async (req, res, next) => {
  try {
    await auth.handleAppUrl(req, res, next);
    if (res.headersSent) return;
    if (res.locals && res.locals.renderEmbeddedDashboard) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.sendFile(path.join(__dirname, 'public', 'live-visitors.html'));
      return;
    }
    res.redirect(302, '/app/live-visitors');
  } catch (err) {
    next(err);
  }
});

// Test route: trigger a Sentry event (only when SENTRY_DSN is set)
if (config.sentryDsn && config.sentryDsn.trim() !== '') {
  app.get('/debug-sentry', () => {
    throw new Error('My first Sentry error!');
  });
}

// Sentry Express error handler (after all controllers, before other error middleware)
Sentry.setupExpressErrorHandler(app);

// Fallthrough error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal server error');
});

// Migrate on startup
const { up: up001 } = require('./migrations/001_initial');
const { up: up002 } = require('./migrations/002_shop_sessions');
const { up: up003 } = require('./migrations/003_cart_order_money');
const { up: up004 } = require('./migrations/004_session_stats_fields');
const { up: up005 } = require('./migrations/005_utm_campaign');
const { up: up006 } = require('./migrations/006_utm_source_medium_content');
const { up: up007 } = require('./migrations/007_first_path');
const { up: up008 } = require('./migrations/008_purchases');
const { up: up009 } = require('./migrations/009_cf_traffic');
const { up: up010 } = require('./migrations/010_referrer');
const { up: up011 } = require('./migrations/011_entry_url');
const { up: up012 } = require('./migrations/012_bot_block_counts');
const { up: up013 } = require('./migrations/013_session_is_returning');
const { up: up014 } = require('./migrations/014_dedupe_legacy_purchases');
const { up: up015 } = require('./migrations/015_backfill_session_is_returning');
const { up: up016 } = require('./migrations/016_dedupe_h_purchases');
const { up: up017 } = require('./migrations/017_sales_truth_and_evidence');
const { up: up018 } = require('./migrations/018_orders_shopify_returning_fields');
const { up: up019 } = require('./migrations/019_customer_order_facts');
const { up: up020 } = require('./migrations/020_bot_block_counts_updated_at');
const { up: up021 } = require('./migrations/021_sessions_traffic_fields');
const backup = require('./backup');
const { writeAudit } = require('./audit');

async function migrateAndStart() {
  // Open DB early so backups can inspect/operate.
  getDb();

  // Required: backup before introducing the Sales Truth schema (first deploy only).
  const preBackup = await backup.backupBeforeTruthSchemaCreate();

  await up001();
  await up002();
  await up003();
  await up004();
  await up005();
  await up006();
  await up007();
  await up008();
  await up009();
  await up010();
  await up011();
  await up012();
  await up013();
  await up014();
  await up015();
  await up016();
  await up017();
  await up018();
  await up019();
  await up020();
  await up021();

  if (preBackup) {
    await writeAudit('system', 'backup', {
      when: 'startup_pre_truth_schema',
      ...preBackup,
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Live Visitors app listening on http://0.0.0.0:${PORT}`);
    console.log('Dashboard: /app/live-visitors');
    console.log('Ingest: POST /api/ingest (header: X-Ingest-Secret or Authorization: Bearer <secret>)');

    // Restore correctness ASAP: reconcile today's Shopify orders into orders_shopify (fail-open; throttled).
    setTimeout(() => {
      try {
        const store = require('./store');
        const salesTruth = require('./salesTruth');
        const shop = salesTruth.resolveShopForSales('');
        if (!shop) return;
        const tz = store.resolveAdminTimeZone();
        const nowMs = Date.now();
        const bounds = store.getRangeBounds('today', nowMs, tz);
        salesTruth.ensureReconciled(shop, bounds.start, bounds.end, 'today').catch(() => {});
      } catch (_) {}
    }, 1000);
  });
}

migrateAndStart().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

// TTL cleanup every 2 minutes
setInterval(() => {
  cleanup.run().catch(err => console.error('Cleanup error:', err));
}, 2 * 60 * 1000);
