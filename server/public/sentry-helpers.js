/**
 * Sentry helpers for KEXO – breadcrumbs, error capture, fetch wrapper.
 * No-op when Sentry is not loaded.
 */
(function () {
  'use strict';

  function createDedupeCache(maxEntries, defaultTtlMs) {
    var max = Number(maxEntries);
    if (!Number.isFinite(max) || max < 10) max = 200;
    var ttl = Number(defaultTtlMs);
    if (!Number.isFinite(ttl) || ttl < 1000) ttl = 15000;
    var map = Object.create(null);
    var keys = [];
    function cleanup(now) {
      if (!keys.length) return;
      var cutoff = now - ttl;
      if (cutoff <= 0) return;
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!k) continue;
        var t = map[k] || 0;
        if (t && t >= cutoff) break;
        delete map[k];
        keys[i] = null;
      }
      if (keys.length > max * 2) keys = keys.filter(Boolean);
    }
    return function dedupe(keyRaw, ttlOverride) {
      var key = keyRaw == null ? '' : String(keyRaw);
      key = key.trim().slice(0, 600);
      if (!key) return false;
      var now = Date.now();
      var useTtl = Number(ttlOverride);
      if (!Number.isFinite(useTtl) || useTtl < 500) useTtl = ttl;
      var last = map[key] || 0;
      if (last && (now - last) < useTtl) return true;
      map[key] = now;
      keys.push(key);
      if (keys.length > max) cleanup(now);
      return false;
    };
  }

  var kexoDedupe = createDedupeCache(250, 15000);

  function hasSentry() {
    try { return typeof window !== 'undefined' && window.Sentry && typeof window.Sentry.captureException === 'function'; } catch (_) { return false; }
  }

  function kexoBreadcrumb(category, message, data) {
    if (!hasSentry()) return;
    try {
      window.Sentry.addBreadcrumb({
        category: category || 'default',
        message: message || '',
        data: data || {}
      });
    } catch (_) {}
  }

  function kexoCaptureError(err, context) {
    if (!hasSentry()) return;
    try {
      var extra = context && typeof context === 'object' ? context : { context: String(context) };
      window.Sentry.captureException(err, { extra: extra });
    } catch (_) {}
  }

  function kexoCaptureMessage(message, context, level) {
    if (!hasSentry()) return;
    try {
      var msg = message == null ? '' : String(message);
      if (!msg) return;
      var lvl = level == null ? 'error' : String(level);
      var extra = context && typeof context === 'object' ? context : { context: String(context || '') };
      window.Sentry.captureMessage(msg, {
        level: lvl,
        extra: extra
      });
    } catch (_) {}
  }

  function kexoSetContext(page, data) {
    if (!hasSentry()) return;
    try {
      window.Sentry.setTag('page', page || '');
      if (data && typeof data === 'object') {
        Object.keys(data).forEach(function (k) {
          if (k !== 'page') window.Sentry.setTag(k, String(data[k] || ''));
        });
      }
    } catch (_) {}
  }

  var _nativeFetch = typeof fetch === 'function' ? fetch : null;

  function isSameOriginApiUrl(urlStr) {
    var s = urlStr == null ? '' : String(urlStr);
    if (!s) return false;
    if (s.indexOf('/api/') === 0) return true;
    try {
      var u = new URL(s, window.location.origin);
      return u && u.origin === window.location.origin && String(u.pathname || '').indexOf('/api/') === 0;
    } catch (_) {
      return false;
    }
  }

  function shouldSkipFetchCapture(err, urlStr, method) {
    var name = '';
    var msg = '';
    try { name = err && err.name ? String(err.name) : ''; } catch (_) { name = ''; }
    try { msg = err && err.message ? String(err.message) : ''; } catch (_) { msg = ''; }
    if (name === 'AbortError') return true;
    if (/aborted/i.test(msg)) return true;
    var m = method == null ? 'GET' : String(method);
    var isApiGet = String(m).toUpperCase() === 'GET' && isSameOriginApiUrl(urlStr);
    // Network flakiness on polling endpoints (Safari: "Load failed") is not actionable as an exception.
    if (name === 'TypeError' && isApiGet && (/failed to fetch/i.test(msg) || /load failed/i.test(msg) || /networkerror/i.test(msg))) return true;
    if (name === 'TypeError' && /failed to fetch/i.test(msg)) {
      try {
        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
      } catch (_) {}
    }
    return false;
  }

  function handleUnauthorizedApiResponse(status, urlStr) {
    if (status !== 401) return;
    if (!isSameOriginApiUrl(urlStr)) return;
    if (typeof window === 'undefined' || !window.location) return;
    var path = String(window.location.pathname || '');
    if (path.indexOf('/app/login') === 0 || path.indexOf('/auth/') === 0) return;
    if (window.__kexoUnauthorizedRedirectPending) return;
    window.__kexoUnauthorizedRedirectPending = true;
    try {
      kexoBreadcrumb('auth', 'api 401 -> redirect login', { url: urlStr, path: path });
    } catch (_) {}
    var redirect = '/dashboard/overview';
    try {
      var full = String(window.location.pathname || '/') + String(window.location.search || '') + String(window.location.hash || '');
      if (full && full[0] === '/') redirect = full;
    } catch (_) {}
    var loginUrl = '/app/logout?error=session_expired&redirect=' + encodeURIComponent(redirect);
    setTimeout(function() {
      try { window.location.assign(loginUrl); } catch (_) {}
    }, 60);
  }

  function kexoFetch(url, opts) {
    var urlStr = typeof url === 'string' ? url : (url && url.url) || '';
    var method = (opts && opts.method) || 'GET';
    kexoBreadcrumb('fetch', method + ' ' + urlStr, { url: urlStr, method: method });
    if (!_nativeFetch) return Promise.reject(new Error('fetch not available'));
    return _nativeFetch.apply(this, arguments).then(
      function (r) {
        if (!r || !r.ok) {
          kexoBreadcrumb('fetch', 'error ' + (r ? r.status : 'no-response'), { url: urlStr, status: r ? r.status : 0 });
          try { handleUnauthorizedApiResponse(r ? r.status : 0, urlStr); } catch (_) {}
        }
        return r;
      },
      function (err) {
        if (!shouldSkipFetchCapture(err, urlStr, method)) {
          kexoCaptureError(err, { url: urlStr, method: method, type: 'fetch' });
        }
        throw err;
      }
    );
  }

  window.kexoBreadcrumb = kexoBreadcrumb;
  window.kexoCaptureError = kexoCaptureError;
  window.kexoCaptureMessage = kexoCaptureMessage;
  window.kexoSetContext = kexoSetContext;
  window.kexoFetch = kexoFetch;

  (function installGlobalErrorHandlers() {
    if (typeof window === 'undefined') return;
    if (window.__kexoSentryGlobalHandlersApplied) return;

    function shouldSkipGlobalError(message) {
      var msg = message == null ? '' : String(message);
      if (!msg) return false;
      if (/ResizeObserver loop limit exceeded/i.test(msg)) return true;
      if (/ResizeObserver loop completed with undelivered notifications/i.test(msg)) return true;
      return false;
    }

    function onError(evt) {
      try {
        if (!evt) return;
        var err = evt.error;
        var msg = (evt.message != null ? String(evt.message) : '') || (err && err.message ? String(err.message) : '') || 'window.error';
        if (shouldSkipGlobalError(msg)) return;
        var filename = evt.filename != null ? String(evt.filename) : '';
        var lineno = evt.lineno != null ? Number(evt.lineno) : 0;
        var colno = evt.colno != null ? Number(evt.colno) : 0;
        var key = 'winerr:' + msg + '|' + filename + ':' + lineno + ':' + colno;
        if (kexoDedupe(key, 20000)) return;
        kexoBreadcrumb('window', 'error', { message: msg, filename: filename, lineno: lineno, colno: colno });
        if (err && typeof err === 'object') {
          kexoCaptureError(err, { context: 'window.error', message: msg, filename: filename, lineno: lineno, colno: colno });
        } else {
          kexoCaptureMessage(msg, { context: 'window.error', filename: filename, lineno: lineno, colno: colno }, 'error');
        }
      } catch (_) {}
    }

    function onUnhandledRejection(evt) {
      try {
        if (!evt) return;
        var reason = evt.reason;
        var msg = '';
        try { msg = reason && reason.message ? String(reason.message) : String(reason || 'unhandledrejection'); } catch (_) { msg = 'unhandledrejection'; }
        if (shouldSkipGlobalError(msg)) return;
        var key = 'unhandledrejection:' + msg;
        if (kexoDedupe(key, 20000)) return;
        kexoBreadcrumb('window', 'unhandledrejection', { message: String(msg).slice(0, 400) });
        var err = null;
        if (reason && typeof reason === 'object' && reason.name && reason.message) err = reason;
        else err = new Error(String(msg).slice(0, 400));
        kexoCaptureError(err, { context: 'window.unhandledrejection', message: String(msg).slice(0, 400) });
      } catch (_) {}
    }

    try { window.addEventListener('error', onError, true); } catch (_) {}
    try { window.addEventListener('unhandledrejection', onUnhandledRejection); } catch (_) {}
    window.__kexoSentryGlobalHandlersApplied = true;
  })();

  (function installDebugHook() {
    if (typeof window === 'undefined') return;
    function debugEnabled() {
      try { if (window.location && window.location.hostname === 'localhost') return true; } catch (_) {}
      try { if (window.location && String(window.location.search || '').indexOf('debugSentry=1') >= 0) return true; } catch (_) {}
      try { if (typeof localStorage !== 'undefined' && localStorage && localStorage.getItem('kexo:debug-sentry') === '1') return true; } catch (_) {}
      return false;
    }
    window.__kexoDebugSentry = function () {
      if (!debugEnabled()) return false;
      try {
        var err = new Error('kexo_debug_sentry_frontend');
        kexoCaptureError(err, { context: 'debug.sentry', page: (document.body && document.body.getAttribute('data-page')) || '' });
        return true;
      } catch (_) {
        return false;
      }
    };
  })();

  (function patchConsoleErrorForChartFailures() {
    if (typeof window === 'undefined') return;
    if (window.__kexoChartConsolePatchApplied) return;
    var c = (typeof console !== 'undefined' && console) ? console : null;
    if (!c || typeof c.error !== 'function') return;

    var nativeError = c.error.bind(c);
    var recent = Object.create(null);

    function shouldCapture(args, joined, errObj) {
      var text = String(joined || '').toLowerCase();
      if (/chart|map|apexcharts|jsvectormap|chart\.js|sparkline/.test(text)) return true;
      var msg = errObj && errObj.message ? String(errObj.message).toLowerCase() : '';
      if (/chart|map|apexcharts|jsvectormap|chart\.js|sparkline/.test(msg)) return true;
      var stack = errObj && errObj.stack ? String(errObj.stack).toLowerCase() : '';
      if (/apexcharts|jsvectormap|chart/.test(stack)) return true;
      return false;
    }

    function dedupe(key) {
      var k = String(key || '').slice(0, 500);
      if (!k) return false;
      var now = Date.now();
      var last = recent[k] || 0;
      if ((now - last) < 5000) return true;
      recent[k] = now;
      return false;
    }

    c.error = function () {
      var args = Array.prototype.slice.call(arguments || []);
      try {
        var errObj = null;
        var pieces = [];
        for (var i = 0; i < args.length; i++) {
          var a = args[i];
          if (!errObj && a && typeof a === 'object' && a.name && a.message) errObj = a;
          if (typeof a === 'string') pieces.push(a);
          else if (a && typeof a === 'object' && typeof a.message === 'string') pieces.push(a.message);
          else {
            try { pieces.push(String(a)); } catch (_) {}
          }
        }
        var joined = pieces.join(' | ').trim();
        if (shouldCapture(args, joined, errObj)) {
          var key = errObj && errObj.message ? ('err:' + errObj.message) : ('msg:' + joined);
          if (!dedupe(key)) {
            if (errObj) {
              kexoCaptureError(errObj, { context: 'console.error.chart', message: joined });
            } else {
              kexoCaptureMessage(joined || 'console.error chart issue', { context: 'console.error.chart' }, 'error');
            }
          }
        }
      } catch (_) {}
      return nativeError.apply(c, arguments);
    };

    window.__kexoChartConsolePatchApplied = true;
  })();

  if (typeof window !== 'undefined' && _nativeFetch) {
    window.fetch = kexoFetch;
  }
})();
