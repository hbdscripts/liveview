(function () {
  if (window.__adsInit) return;

  function baseApi() {
    try {
      if (typeof API !== 'undefined') return String(API || '');
    } catch (_) {}
    return '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtNum(n) {
    const x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try {
      return x.toLocaleString('en-GB');
    } catch (_) {
      return String(Math.round(x));
    }
  }

  function fmtMoney(n, currency) {
    const x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    const cur = currency || 'GBP';
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(x);
    } catch (_) {
      return (cur === 'GBP' ? '£' : '') + String(Math.round(x * 100) / 100);
    }
  }

  function fetchJson(path, options) {
    const url = baseApi() + path;
    const opts = options || { credentials: 'same-origin', cache: 'no-store' };
    return fetch(url, opts).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function postRefresh(rangeKey) {
    const url = baseApi() + '/api/ads/refresh?range=' + encodeURIComponent(rangeKey || 'today');
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'googleads' }),
    }).then(function (r) {
      return r && r.ok ? r.json().catch(function () { return null; }) : null;
    }).catch(function () { return null; });
  }

  function render(root, status, summary) {
    const providers = status && status.providers ? status.providers : [];
    const totals = summary && summary.totals ? summary.totals : {};
    const currency = (summary && summary.currency) || 'GBP';
    const note = (summary && summary.note) ? String(summary.note) : '';

    const providerLine = providers.length
      ? providers.map(function (p) {
          const label = p && p.label ? p.label : (p && p.key ? p.key : 'Provider');
          const connected = !!(p && p.connected);
          return '<span class="muted"><strong>' + esc(label) + '</strong>: ' + (connected ? 'Connected' : 'Not connected') + '</span>';
        }).join(' · ')
      : '<span class="muted">No providers configured.</span>';

    root.innerHTML =
      '<div class="stats-row-wrap">' +
        '<div class="stats-row">' +
          '<div class="stats-card">' +
            '<div class="traffic-card-header">' +
              '<h3 class="traffic-card-title">Ads</h3>' +
              '<button type="button" class="config-btn" id="ads-refresh-btn" title="Refresh" aria-label="Refresh">↻</button>' +
            '</div>' +
            '<div class="country-table-wrap">' +
              '<div class="muted" style="padding: 10px 12px;">' + providerLine + '</div>' +
              '<div class="grid-table by-country-table" role="table" aria-label="Ads totals">' +
                '<div class="grid-header" role="rowgroup">' +
                  '<div class="grid-row grid-row--header" role="row">' +
                    '<div class="grid-cell" role="columnheader">Spend</div>' +
                    '<div class="grid-cell" role="columnheader">Impr</div>' +
                    '<div class="grid-cell" role="columnheader">Clicks</div>' +
                    '<div class="grid-cell" role="columnheader">Conv</div>' +
                    '<div class="grid-cell" role="columnheader">Revenue</div>' +
                  '</div>' +
                '</div>' +
                '<div class="grid-body" role="rowgroup">' +
                  '<div class="grid-row" role="row">' +
                    '<div class="grid-cell" role="cell">' + esc(fmtMoney(totals.spend, currency)) + '</div>' +
                    '<div class="grid-cell" role="cell">' + esc(fmtNum(totals.impressions)) + '</div>' +
                    '<div class="grid-cell" role="cell">' + esc(fmtNum(totals.clicks)) + '</div>' +
                    '<div class="grid-cell" role="cell">' + esc(fmtNum(totals.conversions)) + '</div>' +
                    '<div class="grid-cell" role="cell">' + esc(fmtMoney(totals.revenue, currency)) + '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              (note ? ('<div class="muted" style="padding: 10px 12px;">' + esc(note) + '</div>') : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var btn = document.getElementById('ads-refresh-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        try { window.__adsRefresh && window.__adsRefresh({ force: true }); } catch (_) {}
      });
    }
  }

  var inFlight = null;

  function computeRangeKey() {
    try {
      if (typeof getStatsRange === 'function') return String(getStatsRange() || 'today');
    } catch (_) {}
    try {
      if (typeof dateRange !== 'undefined') {
        var r = String(dateRange || 'today');
        if (r === 'live' || r === '1h') return 'today';
        return r;
      }
    } catch (_) {}
    return 'today';
  }

  function refresh(options) {
    var root = document.getElementById('ads-root');
    if (!root) return Promise.resolve(null);

    if (inFlight) return inFlight;

    var isForce = !!(options && options.force);
    root.innerHTML = '<div class="muted">' + (isForce ? 'Syncing Google Ads spend…' : 'Loading…') + '</div>';
    var rangeKey = computeRangeKey();

    var preStep = isForce ? postRefresh(rangeKey) : Promise.resolve(null);

    var p = preStep.then(function () {
      return Promise.all([
        fetchJson('/api/ads/status'),
        fetchJson('/api/ads/summary?range=' + encodeURIComponent(rangeKey) + (isForce ? ('&_=' + Date.now()) : '')),
      ]);
    }).then(function (arr) {
      var status = arr && arr[0] ? arr[0] : null;
      var summary = arr && arr[1] ? arr[1] : null;
      render(root, status, summary);
      return { status: status, summary: summary };
    }).catch(function () {
      root.innerHTML = '<div class="muted">Could not load ads.</div>';
      return null;
    }).finally(function () {
      if (inFlight === p) inFlight = null;
    });

    inFlight = p;
    return p;
  }

  window.__adsRefresh = refresh;
  window.__adsInit = function () {
    return refresh({ force: false });
  };
})();
