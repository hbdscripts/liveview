/**
 * Sentry error tracking – init only when SENTRY_DSN is set.
 * Use requestHandler as first middleware and errorHandler before other error handlers.
 */

const Sentry = require('@sentry/node');
const config = require('./config');

function init() {
  if (!config.sentryDsn || config.sentryDsn.trim() === '') return false;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
    maxBreadcrumbs: 50,
  });
  return true;
}

function requestHandler() {
  if (!config.sentryDsn || config.sentryDsn.trim() === '') {
    return (req, res, next) => next();
  }
  return Sentry.Handlers.requestHandler();
}

function errorHandler() {
  if (!config.sentryDsn || config.sentryDsn.trim() === '') {
    return (err, req, res, next) => next(err);
  }
  return Sentry.Handlers.errorHandler();
}

module.exports = { init, requestHandler, errorHandler };
