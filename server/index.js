/**
 * Live Visitors app – Express server, ingest, SSE, admin API, cleanup job.
 * Load .env if present (e.g. dotenv).
 */

try { require('dotenv').config(); } catch (_) {}

const express = require('express');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { getDb } = require('./db');
const cleanup = require('./cleanup');

const ingestRouter = require('./routes/ingest');
const streamRouter = require('./routes/stream');
const sessionsRouter = require('./routes/sessions');
const settingsRouter = require('./routes/settings');
const configStatusRouter = require('./routes/configStatus');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Admin UI (embedded dashboard)
app.use(express.static(path.join(__dirname, 'public')));
app.get('/app/live-visitors', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'live-visitors.html'));
});
app.get('/', (req, res) => {
  res.redirect('/app/live-visitors');
});

// Migrate on startup
const { up } = require('./migrations/001_initial');
getDb();

up()
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
