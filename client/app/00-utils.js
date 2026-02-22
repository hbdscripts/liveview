  // Shared formatters + scheduling/fetch helpers — reduces UI jank + duplicate requests.
  function formatMoney(amount, currencyCode) {
    if (amount == null || typeof amount !== 'number') return '';
    var code = (currencyCode || 'GBP').toUpperCase();
    var sym = code === 'GBP' ? '\u00A3' : code === 'USD' ? '$' : code === 'EUR' ? '\u20AC' : code + ' ';
    return sym + (amount % 1 === 0 ? amount : amount.toFixed(2));
  }

  function formatCompactNumber(amount) {
    var raw = typeof amount === 'number' ? amount : Number(amount);
    var n = Number.isFinite(raw) ? Math.abs(raw) : 0;
    if (n < 1000) return String(Math.round(n));
    if (n >= 1e9) {
      var v = n / 1e9;
      var dec = v < 100 ? 1 : 0;
      return v.toFixed(dec).replace(/\.0$/, '') + 'b';
    }
    if (n >= 1e6) {
      var v = n / 1e6;
      var dec = v < 100 ? 1 : 0;
      return v.toFixed(dec).replace(/\.0$/, '') + 'm';
    }
    var v = n / 1e3;
    var dec = v < 100 ? 1 : 0;
    return v.toFixed(dec).replace(/\.0$/, '') + 'k';
  }

  function formatMoneyCompact(amount, currencyCode) {
    if (amount == null || typeof amount !== 'number') return '';
    var code = (currencyCode || 'GBP').toUpperCase();
    var sym = code === 'GBP' ? '\u00A3' : code === 'USD' ? '$' : code === 'EUR' ? '\u20AC' : code + ' ';
    var n = Number.isFinite(amount) ? amount : 0;
    var sign = n < 0 ? '-' : '';
    return sign + sym + formatCompactNumber(n);
  }

  function fmtPct(n) {
    if (n == null || !Number.isFinite(n)) return '\u2014';
    return n.toFixed(1) + '%';
  }

  function fmtMoneyGbp(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '\u2014';
    try { return '\u00A3' + x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return '\u00A3' + x.toFixed(2); }
  }

  function fetchJson(url, opts) {
    var options = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {});
    return fetch(url, options).then(function(r) { return r.json(); });
  }

  function kexoEscapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function kexoSafeHref(raw) {
    var s = raw != null ? String(raw).trim() : '';
    if (!s) return '';
    if (s[0] === '#') return s;
    if (s[0] === '/' || s.startsWith('./') || s.startsWith('../') || s[0] === '?') return s;
    try {
      var u = new URL(s, window.location.origin);
      var proto = (u && u.protocol) ? String(u.protocol).toLowerCase() : '';
      if (proto === 'http:' || proto === 'https:' || proto === 'mailto:' || proto === 'tel:') return u.href;
    } catch (_) {}
    return '';
  }

  function kexoDebounce(fn, waitMs) {
    var t = null;
    var lastArgs = null;
    var lastThis = null;
    var wait = Math.max(0, Number(waitMs) || 0);
    function run() {
      t = null;
      var args = lastArgs; lastArgs = null;
      var ctx = lastThis; lastThis = null;
      try { fn.apply(ctx, args || []); } catch (e) { throw e; }
    }
    function debounced() {
      lastArgs = arguments;
      lastThis = this;
      if (t) { try { clearTimeout(t); } catch (_) {} }
      t = setTimeout(run, wait);
    }
    debounced.cancel = function() {
      if (t) { try { clearTimeout(t); } catch (_) {} }
      t = null;
      lastArgs = null;
      lastThis = null;
    };
    return debounced;
  }

  function kexoThrottle(fn, waitMs) {
    var wait = Math.max(0, Number(waitMs) || 0);
    var last = 0;
    var t = null;
    var lastArgs = null;
    var lastThis = null;
    function invoke() {
      t = null;
      last = Date.now();
      var args = lastArgs; lastArgs = null;
      var ctx = lastThis; lastThis = null;
      try { fn.apply(ctx, args || []); } catch (e) { throw e; }
    }
    function throttled() {
      var now = Date.now();
      lastArgs = arguments;
      lastThis = this;
      var remaining = wait - (now - last);
      if (remaining <= 0 || remaining > wait) {
        if (t) { try { clearTimeout(t); } catch (_) {} t = null; }
        invoke();
        return;
      }
      if (!t) t = setTimeout(invoke, remaining);
    }
    throttled.cancel = function() {
      if (t) { try { clearTimeout(t); } catch (_) {} }
      t = null;
      lastArgs = null;
      lastThis = null;
    };
    return throttled;
  }

  function kexoRafBatch(fn) {
    var rafId = 0;
    function run() {
      rafId = 0;
      try { fn(); } catch (e) { throw e; }
    }
    function schedule() {
      if (rafId) return;
      var raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(cb) { return setTimeout(cb, 16); };
      rafId = raf(run);
    }
    schedule.cancel = function() {
      if (!rafId) return;
      try {
        if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        else clearTimeout(rafId);
      } catch (_) {}
      rafId = 0;
    };
    return schedule;
  }

  // registerCleanup isn't always available in standalone pages; provide a safe wrapper.
  var _kexoFallbackCleanupWired = false;
  var _kexoFallbackCleanupFns = [];
  function kexoRegisterCleanup(fn) {
    try {
      if (typeof registerCleanup === 'function') return registerCleanup(fn);
    } catch (_) {}
    if (typeof fn === 'function') _kexoFallbackCleanupFns.push(fn);
    if (_kexoFallbackCleanupWired) return;
    _kexoFallbackCleanupWired = true;
    function run() {
      _kexoFallbackCleanupFns.forEach(function (f) { try { f(); } catch (_) {} });
    }
    try { window.addEventListener('beforeunload', run); } catch (_) {}
    try { window.addEventListener('pagehide', run); } catch (_) {}
  }

  var _kexoJsonStableCache = new Map();
  function kexoFetchJsonStable(url, opts, ttlMs) {
    var ttl = Math.max(0, Number(ttlMs) || 0);
    var method = (opts && opts.method) ? String(opts.method).toUpperCase() : 'GET';
    if (method !== 'GET' || !ttl) return fetchJson(url, opts);
    var key = method + ' ' + String(url);
    var now = Date.now();
    var cur = _kexoJsonStableCache.get(key) || null;
    if (cur && cur.value !== undefined && cur.expiresAt && now < cur.expiresAt) return Promise.resolve(cur.value);
    if (cur && cur.inFlight) return cur.inFlight;
    var p = fetchJson(url, Object.assign({}, opts || {}, { cache: 'default' }))
      .then(function (json) {
        _kexoJsonStableCache.set(key, { value: json, expiresAt: now + ttl, inFlight: null });
        return json;
      })
      .catch(function (err) {
        var existing = _kexoJsonStableCache.get(key) || null;
        if (existing && existing.inFlight) _kexoJsonStableCache.set(key, { value: existing.value, expiresAt: existing.expiresAt, inFlight: null });
        throw err;
      });
    _kexoJsonStableCache.set(key, { value: cur ? cur.value : undefined, expiresAt: cur ? cur.expiresAt : 0, inFlight: p });
    return p;
  }

  var _kexoJsonInFlight = new Map();
  function kexoFetchJsonDedup(url, opts) {
    var method = (opts && opts.method) ? String(opts.method).toUpperCase() : 'GET';
    var key = method + ' ' + String(url);
    var existing = _kexoJsonInFlight.get(key) || null;
    if (existing) return existing;
    var p = fetchJson(url, opts)
      .finally(function () { try { _kexoJsonInFlight.delete(key); } catch (_) {} });
    _kexoJsonInFlight.set(key, p);
    return p;
  }

  function kexoFetchOkJson(url, opts) {
    var options = Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {});
    return fetch(url, options).then(function (r) { return (r && r.ok) ? r.json() : null; });
  }

  var _kexoOkJsonStableCache = new Map();
  function kexoFetchOkJsonStable(url, opts, ttlMs) {
    var ttl = Math.max(0, Number(ttlMs) || 0);
    var method = (opts && opts.method) ? String(opts.method).toUpperCase() : 'GET';
    if (method !== 'GET' || !ttl) return kexoFetchOkJson(url, opts);
    var key = method + ' ' + String(url);
    var now = Date.now();
    var cur = _kexoOkJsonStableCache.get(key) || null;
    if (cur && cur.value !== undefined && cur.expiresAt && now < cur.expiresAt) return Promise.resolve(cur.value);
    if (cur && cur.inFlight) return cur.inFlight;
    var p = kexoFetchOkJson(url, Object.assign({}, opts || {}, { cache: 'default' }))
      .then(function (json) {
        _kexoOkJsonStableCache.set(key, { value: json, expiresAt: now + ttl, inFlight: null });
        return json;
      })
      .catch(function (err) {
        var existing = _kexoOkJsonStableCache.get(key) || null;
        if (existing && existing.inFlight) _kexoOkJsonStableCache.set(key, { value: existing.value, expiresAt: existing.expiresAt, inFlight: null });
        throw err;
      });
    _kexoOkJsonStableCache.set(key, { value: cur ? cur.value : undefined, expiresAt: cur ? cur.expiresAt : 0, inFlight: p });
    return p;
  }

  function normalizePaymentProviderKey(v) {
    if (v == null) return null;
    var s = String(v).trim().toLowerCase();
    if (!s) return null;
    if (s === 'null' || s === 'undefined' || s === 'true' || s === 'false' || s === '[object object]') return null;
    s = s.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!s) return null;
    if (s === 'american-express') s = 'americanexpress';
    if (s === 'amex') s = 'americanexpress';
    if (s === 'apple-pay') s = 'applepay';
    if (s === 'shop-pay') s = 'shop-pay';
    if (s === 'shopify-payments' || s === 'shopifypayments') s = 'shopify-payments';
    return s.length > 64 ? s.slice(0, 64) : s;
  }

  function paymentProviderMeta(key) {
    var k = normalizePaymentProviderKey(key);
    if (!k) return null;
    var map = {
      visa: { label: 'Visa', iconKey: 'payment-method-visa', iconClass: 'fa-brands fa-cc-visa' },
      mastercard: { label: 'Mastercard', iconKey: 'payment-method-mastercard', iconClass: 'fa-brands fa-cc-mastercard' },
      americanexpress: { label: 'American Express', iconKey: 'payment-method-amex', iconClass: 'fa-brands fa-cc-amex' },
      paypal: { label: 'PayPal', iconKey: 'payment-method-paypal', iconClass: 'fa-brands fa-paypal' },
      applepay: { label: 'Apple Pay', iconKey: 'payment-method-apple_pay', iconClass: 'fa-brands fa-apple-pay' },
      'google-pay': { label: 'Google Pay', iconKey: 'payment-method-google_pay', iconClass: 'fa-brands fa-google-pay' },
      klarna: { label: 'Klarna', iconKey: 'payment-method-klarna', iconClass: 'fa-light fa-credit-card' },
      'shop-pay': { label: 'Shop Pay', iconKey: 'payment-method-shop_pay', iconClass: 'fa-light fa-bag-shopping' },
      'shopify-payments': { label: 'Shopify Payments', iconKey: 'payment-method-shop_pay', iconClass: 'fa-light fa-bag-shopping' },
    };
    return map[k] || { label: k, iconKey: 'payment-method-other', iconClass: 'fa-light fa-credit-card' };
  }

  function tablerPaymentClassName(providerKey) {
    return '';
  }

  function paymentProviderIconHtml(providerKey, opts) {
    function esc(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    var meta = paymentProviderMeta(providerKey);
    if (!meta) return '';
    var extraClass = opts && opts.extraClass ? String(opts.extraClass).trim() : '';
    var label = meta.label ? String(meta.label) : '';
    var iconClass = meta.iconClass ? String(meta.iconClass) : 'fa-light fa-credit-card';
    var iconKey = meta.iconKey ? String(meta.iconKey) : 'payment-method-other';
    var cls = [iconClass, extraClass].join(' ').trim();
    return '<i class="' + esc(cls) + '" data-icon-key="' + esc(iconKey) + '" aria-label="' + esc(label) + '" title="' + esc(label) + '" aria-hidden="true"></i>';
  }
