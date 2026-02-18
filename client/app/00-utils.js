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
