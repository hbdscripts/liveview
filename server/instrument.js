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

function createDedupeCache(maxEntries, defaultTtlMs) {
  let max = Number(maxEntries);
  if (!Number.isFinite(max) || max < 10) max = 300;
  let ttl = Number(defaultTtlMs);
  if (!Number.isFinite(ttl) || ttl < 1000) ttl = 15000;
  const map = Object.create(null);
  let keys = [];
  function cleanup(now, ttlOverride) {
    const useTtl = Number(ttlOverride);
    const cutoff = now - (Number.isFinite(useTtl) && useTtl > 500 ? useTtl : ttl);
    if (cutoff <= 0) return;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (!k) continue;
      const t = map[k] || 0;
      if (t && t >= cutoff) break;
      delete map[k];
      keys[i] = null;
    }
    if (keys.length > max * 2) keys = keys.filter(Boolean);
  }
  return function dedupe(keyRaw, ttlOverride) {
    const key = String(keyRaw == null ? '' : keyRaw).trim().slice(0, 600);
    if (!key) return false;
    const now = Date.now();
    const useTtl = Number(ttlOverride);
    const ttlMs = Number.isFinite(useTtl) && useTtl > 500 ? useTtl : ttl;
    const last = map[key] || 0;
    if (last && (now - last) < ttlMs) return true;
    map[key] = now;
    keys.push(key);
    if (keys.length > max) cleanup(now, ttlMs);
    return false;
  };
}

const dedupe = createDedupeCache(400, 15000);

function normalizeContext(ctx) {
  if (!ctx) return {};
  if (typeof ctx === 'string') return { context: ctx };
  if (typeof ctx === 'object') return ctx;
  return { context: String(ctx) };
}

function shouldSkipNotify(ctx) {
  try { return !!(ctx && typeof ctx === 'object' && (ctx.skipNotify || ctx.noNotify)); } catch (_) { return false; }
}

function addBreadcrumb(category, message, data) {
  if (!enabled || !Sentry) return false;
  try {
    Sentry.addBreadcrumb({
      category: category || 'default',
      message: message || '',
      data: data || {},
    });
    return true;
  } catch (_) {
    return false;
  }
}

function captureException(err, ctx, level) {
  if (!enabled || !Sentry) return false;
  try {
    const context = normalizeContext(ctx);
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'non_error_exception');
    const msg = (e && e.message ? String(e.message) : 'error').slice(0, 260);
    const key = 'ex:' + msg + '|' + String(context && context.context ? context.context : '').slice(0, 120);
    if (dedupe(key, 15000)) return false;
    Sentry.withScope((scope) => {
      try {
        if (level) scope.setLevel(level);
        scope.setTag('kexo_ctx', String(context && context.context ? context.context : '').slice(0, 80));
        if (context && typeof context === 'object') scope.setExtras(context);
      } catch (_) {}
      Sentry.captureException(e);
    });
    if (!shouldSkipNotify(context)) {
      setImmediate(() => {
        try {
          const notificationsService = require('./notificationsService');
          if (notificationsService && typeof notificationsService.createSentryNotification === 'function') {
            notificationsService.createSentryNotification(err).catch((notifyErr) => {
              try { console.warn('[Sentry] createSentryNotification failed', notifyErr && notifyErr.message ? notifyErr.message : notifyErr); } catch (_) {}
              try { captureException(notifyErr, { context: 'notifications.createSentryNotification', skipNotify: true }, 'warning'); } catch (_) {}
            });
          }
        } catch (e) {
          try { console.warn('[Sentry] notification hook error', e && e.message ? e.message : e); } catch (_) {}
        }
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function captureMessage(message, ctx, level) {
  if (!enabled || !Sentry) return false;
  try {
    const context = normalizeContext(ctx);
    const msg = String(message || '').slice(0, 260);
    if (!msg) return false;
    const key = 'msg:' + msg + '|' + String(context && context.context ? context.context : '').slice(0, 120);
    if (dedupe(key, 15000)) return false;
    Sentry.withScope((scope) => {
      try {
        if (level) scope.setLevel(level);
        scope.setTag('kexo_ctx', String(context && context.context ? context.context : '').slice(0, 80));
        if (context && typeof context === 'object') scope.setExtras(context);
      } catch (_) {}
      Sentry.captureMessage(msg);
    });
    if (!shouldSkipNotify(context)) {
      setImmediate(() => {
        try {
          const notificationsService = require('./notificationsService');
          if (notificationsService && typeof notificationsService.createSentryNotification === 'function') {
            notificationsService.createSentryNotification(message).catch((notifyErr) => {
              try { console.warn('[Sentry] createSentryNotification failed', notifyErr && notifyErr.message ? notifyErr.message : notifyErr); } catch (_) {}
              try { captureException(notifyErr, { context: 'notifications.createSentryNotification', skipNotify: true }, 'warning'); } catch (_) {}
            });
          }
        } catch (e) {
          try { console.warn('[Sentry] notification hook error', e && e.message ? e.message : e); } catch (_) {}
        }
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}

function safeWrap(fn, ctx, fallback) {
  const context = normalizeContext(ctx);
  return function kexoSafeWrap() {
    try {
      return fn.apply(this, arguments);
    } catch (err) {
      try { console.error('[safeWrap]', context && context.context ? context.context : 'error', err); } catch (_) {}
      try { captureException(err, Object.assign({ context: (context && context.context) || 'safeWrap' }, context), 'error'); } catch (_) {}
      return fallback;
    }
  };
}

async function safeAsync(fn, ctx, fallback) {
  const context = normalizeContext(ctx);
  try {
    return await fn();
  } catch (err) {
    try { console.error('[safeAsync]', context && context.context ? context.context : 'error', err); } catch (_) {}
    try { captureException(err, Object.assign({ context: (context && context.context) || 'safeAsync' }, context), 'error'); } catch (_) {}
    return fallback;
  }
}

try {
  process.on('unhandledRejection', (reason) => {
    captureException(reason, { context: 'process.unhandledRejection' }, 'error');
    try {
      if (Sentry && enabled) {
        Sentry.flush(1500).catch((e) => {
          try { console.warn('[Sentry] flush failed (unhandledRejection)', e && e.message ? e.message : e); } catch (_) {}
        });
      }
    } catch (_) {}
  });
  process.on('uncaughtException', (err) => {
    captureException(err, { context: 'process.uncaughtException' }, 'fatal');
    try {
      if (Sentry && enabled) {
        Sentry.flush(1500).catch((e) => {
          try { console.warn('[Sentry] flush failed (uncaughtException)', e && e.message ? e.message : e); } catch (_) {}
        });
      }
    } catch (_) {}
  });
} catch (_) {}

module.exports = {
  enabled,
  Sentry,
  addBreadcrumb,
  captureException,
  captureMessage,
  safeWrap,
  safeAsync,
};
