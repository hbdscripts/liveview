/**
 * Sentry init – load as early as possible (first require in index.js).
 * Loads dotenv and config, then inits Sentry when SENTRY_DSN is set.
 */

try { require('dotenv').config(); } catch (_) {}

const config = require('./config');

if (config.sentryDsn && config.sentryDsn.trim() !== '') {
  const Sentry = require('@sentry/node');
  Sentry.init({
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.2,
    maxBreadcrumbs: 100,
    sendDefaultPii: false,
  });
  console.log('[Sentry] Enabled – errors will be sent to Sentry');
} else {
  console.log('[Sentry] Disabled – set SENTRY_DSN on this service to send errors to Sentry');
}
