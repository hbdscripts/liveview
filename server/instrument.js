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
    tracesSampleRate: 0.1,
    maxBreadcrumbs: 50,
    sendDefaultPii: false,
  });
}
