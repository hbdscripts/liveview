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
const settingsRouter = require('./routes/settings');
const configStatusRouter = require('./routes/configStatus');
const statsRouter = require('./routes/stats');
const pixelRouter = require('./routes/pixel');
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
app.get('/api/settings/tracking', settingsRouter.getTracking);
app.put('/api/settings/tracking', express.json(), settingsRouter.putTracking);
app.get('/api/config-status', configStatusRouter);
app.get('/api/stats', statsRouter.getStats);
app.get('/api/pixel/ensure', pixelRouter.ensurePixel);
app.get('/api/og-thumb', ogThumb.handleOgThumb);
const pkg = require(path.join(__dirname, '..', 'package.json'));
app.get('/api/version', (req, res) => res.json({ version: pkg.version || '0.0.0' }));
app.get('/api/store-base-url', (req, res) => {
  const domain = (config.shopDomain || '').trim().toLowerCase();
  const baseUrl = !domain ? '' : (domain.startsWith('http') ? domain : 'https://' + domain.replace(/^\.+/, ''));
  const mainBaseUrl = config.storeMainDomain || baseUrl;
  const assetsBaseUrl = config.assetsBaseUrl || '';
  res.json({ baseUrl, mainBaseUrl, assetsBaseUrl });
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
    if (!res.headersSent) {
      res.redirect(302, '/app/live-visitors');
    }
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
getDb();

up001()
  .then(() => up002())
  .then(() => up003())
  .then(() => up004())
  .then(() => up005())
  .then(() => up006())
  .then(() => up007())
  .then(() => up008())
  .then(() => up009())
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Live Visitors app listening on http://0.0.0.0:${PORT}`);
      console.log('Dashboard: /app/live-visitors');
      console.log('Ingest: POST /api/ingest (header: X-Ingest-Secret or Authorization: Bearer <secret>)');
    });
  })
  .catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });

// TTL cleanup every 2 minutes
setInterval(() => {
  cleanup.run().catch(err => console.error('Cleanup error:', err));
}, 2 * 60 * 1000);
