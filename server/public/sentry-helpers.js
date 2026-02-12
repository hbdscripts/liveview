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
        kexoCaptureError(err, { url: urlStr, method: method, type: 'fetch' });
        throw err;
      }
    );
  }

  window.kexoBreadcrumb = kexoBreadcrumb;
  window.kexoCaptureError = kexoCaptureError;
  window.kexoSetContext = kexoSetContext;
  window.kexoFetch = kexoFetch;

  if (typeof window !== 'undefined' && _nativeFetch) {
    window.fetch = kexoFetch;
  }
})();
