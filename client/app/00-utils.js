  // Shared formatters and fetch – single source for client/app bundle (same IIFE scope).
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
