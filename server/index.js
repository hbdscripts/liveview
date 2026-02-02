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
const auth = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check (for Railway/proxy – no auth, no redirects)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
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

// Shopify OAuth (install flow)
app.get('/auth/callback', (req, res) => auth.handleCallback(req, res));
app.get('/auth/shopify/callback', (req, res) => auth.handleCallback(req, res));

// Admin UI (embedded dashboard) - before / so /app/live-visitors is exact
app.use(express.static(path.join(__dirname, 'public')));
app.get('/app/live-visitors', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live-visitors.html'));
});

// App URL: if shop + hmac (no code), redirect to Shopify authorize; else redirect to dashboard
app.get('/', (req, res, next) => {
  try {
    auth.handleAppUrl(req, res, next);
  } catch (err) {
    next(err);
  }
}, (req, res) => res.redirect(302, '/app/live-visitors'));

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
getDb();

up001()
  .then(() => up002())
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
