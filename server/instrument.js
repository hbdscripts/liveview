/**
 * Sentry init – load as early as possible (first require in index.js).
 * Loads dotenv and config, then inits Sentry when SENTRY_DSN is set.
 */

try { require('dotenv').config(); } catch (_) {}

const config = require('./config');

const enabled = !!(config.sentryDsn && config.sentryDsn.trim() !== '');
let Sentry = null;

if (enabled) {
  Sentry = require('@sentry/node');
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: 0.2,
    maxBreadcrumbs: 100,
    sendDefaultPii: false,
  });
  console.log('[Sentry] Enabled – errors will be sent to Sentry');
} else {
  console.log('[Sentry] Disabled – set SENTRY_DSN on this service to send errors to Sentry');
}

const _recent = Object.create(null);
function dedupe(key, ttlMs) {
  const k = String(key || '').slice(0, 600);
  if (!k) return false;
  const now = Date.now();
  const ttl = Number(ttlMs);
  const useTtl = Number.isFinite(ttl) && ttl > 200 ? ttl : 15000;
  const last = _recent[k] || 0;
  if (last && (now - last) < useTtl) return true;
  _recent[k] = now;
  return false;
}

function captureException(err, ctx, level) {
  if (!enabled || !Sentry) return false;
  try {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'non_error_exception');
    const msg = (e && e.message ? String(e.message) : 'error').slice(0, 260);
    const key = 'ex:' + msg + '|' + String(ctx && ctx.context ? ctx.context : ctx || '');
    if (dedupe(key, 15000)) return false;
    Sentry.withScope((scope) => {
      try {
        if (level) scope.setLevel(level);
        scope.setTag('kexo_ctx', String(ctx && ctx.context ? ctx.context : ctx || '').slice(0, 80));
        if (ctx && typeof ctx === 'object') scope.setExtras(ctx);
      } catch (_) {}
      Sentry.captureException(e);
    });
    setImmediate(() => {
      try {
        const notificationsService = require('./notificationsService');
        if (notificationsService && typeof notificationsService.createSentryNotification === 'function') {
          notificationsService.createSentryNotification(err).catch(() => {});
        }
      } catch (_) {}
    });
    return true;
  } catch (_) {
    return false;
  }
}

function captureMessage(message, ctx, level) {
  if (!enabled || !Sentry) return false;
  try {
    const msg = String(message || '').slice(0, 260);
    if (!msg) return false;
    const key = 'msg:' + msg + '|' + String(ctx && ctx.context ? ctx.context : ctx || '');
    if (dedupe(key, 15000)) return false;
    Sentry.withScope((scope) => {
      try {
        if (level) scope.setLevel(level);
        scope.setTag('kexo_ctx', String(ctx && ctx.context ? ctx.context : ctx || '').slice(0, 80));
        if (ctx && typeof ctx === 'object') scope.setExtras(ctx);
      } catch (_) {}
      Sentry.captureMessage(msg);
    });
    setImmediate(() => {
      try {
        const notificationsService = require('./notificationsService');
        if (notificationsService && typeof notificationsService.createSentryNotification === 'function') {
          notificationsService.createSentryNotification(message).catch(() => {});
        }
      } catch (_) {}
    });
    return true;
  } catch (_) {
    return false;
  }
}

try {
  process.on('unhandledRejection', (reason) => {
    captureException(reason, { context: 'process.unhandledRejection' }, 'error');
    try { if (Sentry && enabled) Sentry.flush(1500).catch(() => {}); } catch (_) {}
  });
  process.on('uncaughtException', (err) => {
    captureException(err, { context: 'process.uncaughtException' }, 'fatal');
    try { if (Sentry && enabled) Sentry.flush(1500).catch(() => {}); } catch (_) {}
  });
} catch (_) {}

module.exports = {
  enabled,
  Sentry,
  captureException,
  captureMessage,
};
