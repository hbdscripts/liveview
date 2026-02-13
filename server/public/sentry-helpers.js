/**
 * Sentry helpers for KEXO – breadcrumbs, error capture, fetch wrapper.
 * No-op when Sentry is not loaded.
 */
(function () {
  'use strict';

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

  function shouldSkipFetchCapture(err) {
    var name = '';
    var msg = '';
    try { name = err && err.name ? String(err.name) : ''; } catch (_) { name = ''; }
    try { msg = err && err.message ? String(err.message) : ''; } catch (_) { msg = ''; }
    if (name === 'AbortError') return true;
    if (/aborted/i.test(msg)) return true;
    if (name === 'TypeError' && /failed to fetch/i.test(msg)) {
      try {
        if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return true;
      } catch (_) {}
    }
    return false;
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
        }
        return r;
      },
      function (err) {
        if (!shouldSkipFetchCapture(err)) {
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
