/**
 * Live Visitors app – Express server, ingest, SSE, admin API, cleanup job.
 * Load .env if present (e.g. dotenv).
 */

try { require('dotenv').config(); } catch (_) {}

const config = require('./config');
const sentry = require('./sentry');
sentry.init();

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

// Sentry request context (first middleware)
app.use(sentry.requestHandler());

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
app.get('/', auth.handleAppUrl, (req, res) => res.redirect(302, '/app/live-visitors'));

// Sentry error handler (before final catch-all)
app.use(sentry.errorHandler());

// Final error handler
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
    app.listen(PORT, () => {
      console.log(`Live Visitors app listening on http://localhost:${PORT}`);
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
