(function () {
  'use strict';

  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('tools', { page: 'tools', tool: 'click-order-lookup' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('tools', 'init', { tool: 'click-order-lookup' }); } catch (_) {}

  function qs(sel) { return document.querySelector(sel); }
  function getShopParam() {
    try {
      var p = new URLSearchParams(window.location.search);
      var shop = p.get('shop') || '';
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : '';
    } catch (_) {
      return '';
    }
  }
  function getQParam() {
    try {
      var p = new URLSearchParams(window.location.search);
      return (p.get('q') || '').trim();
    } catch (_) {
      return '';
    }
  }
  function setQParam(nextQ) {
    try {
      var p = new URLSearchParams(window.location.search);
      if (state.shop) p.set('shop', state.shop);
      if (nextQ) p.set('q', nextQ);
      else p.delete('q');
      var next = window.location.pathname + '?' + p.toString();
      window.history.replaceState(null, '', next);
    } catch (_) {}
  }

  function setNote(msg, ok) {
    var el = qs('#lookup-note');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'tools-note ' + (ok ? 'text-success' : (msg ? 'text-danger' : ''));
  }

  function renderResults(payload) {
    var el = qs('#lookup-results');
    if (!el) return;
    var ui = (typeof window !== 'undefined' && window.KexoClickOrderLookupUI) ? window.KexoClickOrderLookupUI : null;
    if (ui && typeof ui.renderInto === 'function') {
      ui.renderInto(el, payload, { mode: 'page' });
      el.classList.remove('is-hidden');
      return;
    }
    // Minimal fallback if shared renderer is unavailable.
    try {
      el.innerHTML = '<pre style="white-space:pre-wrap;margin:0">' + String(payload ? JSON.stringify(payload, null, 2) : '') + '</pre>';
      el.classList.remove('is-hidden');
    } catch (_) {}
  }

  var state = {
    shop: getShopParam(),
    abort: null,
  };

  function fetchLookup(q) {
    var query = String(q || '').trim();
    if (!query) return Promise.resolve(null);
    if (state.abort) { try { state.abort.abort(); } catch (_) {} }
    var ctrl = new AbortController();
    state.abort = ctrl;
    var url = '/api/tools/click-order-lookup?q=' + encodeURIComponent(query);
    if (state.shop) url += '&shop=' + encodeURIComponent(state.shop);
    url += '&_=' + Date.now();
    return fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ctrl.signal })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return null;
        try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'tools.clickOrderLookup.fetch', q: query }); } catch (_) {}
        return null;
      });
  }

  function runLookup(q) {
    var query = String(q || '').trim();
    var input = qs('#lookup-q');
    if (input && input.value !== query) input.value = query;
    if (!query) {
      setQParam('');
      setNote('', true);
      var results = qs('#lookup-results');
      if (results) {
        results.innerHTML = '';
        results.classList.add('is-hidden');
      }
      return;
    }
    setQParam(query);
    setNote('Searching\u2026', true);
    fetchLookup(query).then(function (json) {
      if (!json) {
        setNote('Search failed.', false);
        renderResults({ ok: false, error: 'Lookup failed.' });
        return;
      }
      setNote('', true);
      renderResults(json);
    });
  }

  function init() {
    var input = qs('#lookup-q');
    var btn = qs('#lookup-btn');
    var clear = qs('#lookup-clear-btn');
    var results = qs('#lookup-results');
    if (!input || !btn || !clear || !results) return;

    btn.addEventListener('click', function () { runLookup(input.value); });
    clear.addEventListener('click', function () { runLookup(''); input.focus(); });
    input.addEventListener('keydown', function (e) {
      if (!e || e.key !== 'Enter') return;
      e.preventDefault();
      runLookup(input.value);
    });

    var initial = getQParam();
    if (initial) runLookup(initial);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

