(function () {
  'use strict';

  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('tools', { page: 'tools', tool: 'click-order-lookup' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('tools', 'init', { tool: 'click-order-lookup' }); } catch (_) {}

  function qs(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
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

  function fmtTs(ms) {
    var n = ms == null ? null : Number(ms);
    if (n == null || !Number.isFinite(n) || n <= 0) return '—';
    try { return new Date(n).toLocaleString('en-GB'); } catch (_) { return String(n); }
  }

  function setNote(msg, ok) {
    var el = qs('#lookup-note');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'tools-note ' + (ok ? 'text-success' : (msg ? 'text-danger' : ''));
  }

  function safeJsonPre(obj) {
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  }

  function copyText(text) {
    var value = String(text == null ? '' : text);
    if (!value) return Promise.resolve(false);
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return false; });
      }
    } catch (_) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.left = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return Promise.resolve(!!ok);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  function renderKvTable(rows) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) return '<div class="text-muted">—</div>';
    var body = list.map(function (r) {
      var k = r && r.k != null ? String(r.k) : '';
      var v = r && r.v != null ? String(r.v) : '';
      var copy = r && r.copy != null ? String(r.copy) : '';
      var copyBtn = copy
        ? '<button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-copy="' + esc(copy) + '">Copy</button>'
        : '';
      return '<tr><th style="width:180px">' + esc(k) + '</th><td><code>' + esc(v || '—') + '</code>' + copyBtn + '</td></tr>';
    }).join('');
    return '<div class="table-responsive"><table class="table table-sm table-vcenter mb-0"><tbody>' + body + '</tbody></table></div>';
  }

  function renderSection(title, innerHtml) {
    return '' +
      '<div class="card mt-3">' +
        '<div class="card-header"><h3 class="card-title">' + esc(title) + '</h3></div>' +
        '<div class="card-body">' + (innerHtml || '') + '</div>' +
      '</div>';
  }

  function renderResults(payload) {
    var el = qs('#lookup-results');
    if (!el) return;
    var ok = !!(payload && payload.ok);
    if (!ok) {
      var err = payload && payload.error ? String(payload.error) : 'Lookup failed.';
      el.innerHTML = '<div class="alert alert-danger mb-0">' + esc(err) + '</div>';
      el.classList.remove('is-hidden');
      return;
    }

    var resolved = payload.resolved && typeof payload.resolved === 'object' ? payload.resolved : {};
    var session = payload.session && typeof payload.session === 'object' ? payload.session : null;
    var attribution = payload.attribution && typeof payload.attribution === 'object' ? payload.attribution : null;
    var purchases = Array.isArray(payload.purchases) ? payload.purchases : [];
    var fraud = payload.fraud && typeof payload.fraud === 'object' ? payload.fraud : null;

    var idsRows = [];
    function addId(label, key) {
      var val = resolved && resolved[key] != null ? String(resolved[key]) : '';
      if (!val) return;
      idsRows.push({ k: label, v: val, copy: val });
    }
    addId('Kexo Click ID (session)', 'session_id');
    addId('Visitor ID', 'visitor_id');
    addId('Checkout token', 'checkout_token');
    addId('Shopify order ID', 'order_id');
    addId('Kexo order key', 'purchase_key');

    var html = '';
    html += renderSection('Resolved IDs', renderKvTable(idsRows));

    if (session) {
      var sRows = [
        { k: 'Started', v: fmtTs(session.started_at), copy: session.started_at != null ? String(session.started_at) : '' },
        { k: 'Last seen', v: fmtTs(session.last_seen), copy: session.last_seen != null ? String(session.last_seen) : '' },
        { k: 'Country', v: session.country_code || '—', copy: session.country_code || '' },
        { k: 'Device', v: session.device || '—', copy: session.device || '' },
        { k: 'UA device/platform', v: ((session.ua_device_type || '') + ' / ' + (session.ua_platform || '') + (session.ua_model ? (' / ' + session.ua_model) : '')).trim() || '—' },
        { k: 'Traffic source', v: session.traffic_source_key || '—', copy: session.traffic_source_key || '' },
        { k: 'Entry URL', v: session.entry_url || '—', copy: session.entry_url || '' },
        { k: 'Referrer', v: session.referrer || '—', copy: session.referrer || '' },
        { k: 'UTM', v: [session.utm_source, session.utm_medium, session.utm_campaign, session.utm_content].filter(Boolean).join(' · ') || '—' },
      ];
      html += renderSection('Session', renderKvTable(sRows));
    }

    if (purchases && purchases.length) {
      var pHtml = purchases.map(function (p) {
        if (!p || typeof p !== 'object') return '';
        var rows = [
          { k: 'Purchase key', v: p.purchase_key || '—', copy: p.purchase_key || '' },
          { k: 'Purchased at', v: fmtTs(p.purchased_at), copy: p.purchased_at != null ? String(p.purchased_at) : '' },
          { k: 'Order ID', v: p.order_id || '—', copy: p.order_id || '' },
          { k: 'Checkout token', v: p.checkout_token || '—', copy: p.checkout_token || '' },
          { k: 'Total', v: (p.order_total != null ? String(p.order_total) : '—') + (p.order_currency ? (' ' + p.order_currency) : '') },
        ];
        return '<div class="mb-3">' + renderKvTable(rows) + '</div>';
      }).join('');
      html += renderSection('Purchases', pHtml);
    }

    if (fraud) {
      html += renderSection('Fraud', '<details><summary class="text-muted">Show fraud payload</summary><pre class="mt-2 mb-0" style="white-space:pre-wrap">' + esc(safeJsonPre(fraud)) + '</pre></details>');
    }

    if (attribution) {
      html += renderSection('Attribution', '<details><summary class="text-muted">Show attribution payload</summary><pre class="mt-2 mb-0" style="white-space:pre-wrap">' + esc(safeJsonPre(attribution)) + '</pre></details>');
    }

    // Debug/raw
    html += renderSection('Raw payload', '<details><summary class="text-muted">Show raw JSON</summary><pre class="mt-2 mb-0" style="white-space:pre-wrap" data-raw-json="1">' + esc(safeJsonPre(payload)) + '</pre></details>');

    el.innerHTML = html;
    el.classList.remove('is-hidden');
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

    if (results.getAttribute('data-wired') !== '1') {
      results.setAttribute('data-wired', '1');
      results.addEventListener('click', function (e) {
        var target = e && e.target ? e.target : null;
        var btn = target && target.closest ? target.closest('button[data-copy]') : null;
        if (!btn) return;
        e.preventDefault();
        var val = btn.getAttribute('data-copy') || '';
        copyText(val).then(function (ok) {
          btn.textContent = ok ? 'Copied' : 'Copy';
          setTimeout(function () { try { btn.textContent = 'Copy'; } catch (_) {} }, 900);
        });
      });
    }

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

