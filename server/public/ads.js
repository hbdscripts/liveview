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

  function fmtRoas(n) {
    const x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(2) + 'x';
  }

  function fmtPct(n) {
    const x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(1) + '%';
  }

  function render(root, status, summary) {
    const providers = status && status.providers ? status.providers : [];
    const totals = summary && summary.totals ? summary.totals : {};
    const campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns : [];
    const currency = (summary && summary.currency) || 'GBP';
    const note = (summary && summary.note) ? String(summary.note) : '';

    const providerLine = providers.length
      ? providers.map(function (p) {
          const label = p && p.label ? p.label : (p && p.key ? p.key : 'Provider');
          const connected = !!(p && p.connected);
          return '<span class="muted"><strong>' + esc(label) + '</strong>: ' + (connected ? 'Connected' : 'Not connected') + '</span>';
        }).join(' · ')
      : '<span class="muted">No providers configured.</span>';

    function gridRow(cells, isHeader, cssClass) {
      const role = isHeader ? 'columnheader' : 'cell';
      const cls = 'grid-row' + (isHeader ? ' grid-row--header' : '') + (cssClass ? ' ' + cssClass : '');
      var h = '<div class="' + cls + '" role="row">';
      for (var i = 0; i < cells.length; i++) {
        h += '<div class="grid-cell" role="' + role + '">' + cells[i] + '</div>';
      }
      h += '</div>';
      return h;
    }

    var headerCells = ['Campaign', 'Spend', 'Impr', 'Clicks', 'Revenue', 'Profit', 'ROAS'];

    var bodyHtml = '';

    // Totals row
    bodyHtml += gridRow([
      '<strong>Total</strong>',
      esc(fmtMoney(totals.spend, currency)),
      esc(fmtNum(totals.impressions)),
      esc(fmtNum(totals.clicks)),
      esc(fmtMoney(totals.revenue, currency)),
      esc(fmtMoney(totals.profit, currency)),
      esc(fmtRoas(totals.roas)),
    ], false, 'ads-totals-row');

    // Campaign rows
    for (var ci = 0; ci < campaigns.length; ci++) {
      var c = campaigns[ci];
      if (!c) continue;
      var cName = c.campaignName || c.campaignId || '—';
      var ctr = (c.impressions > 0) ? (c.clicks / c.impressions * 100) : null;

      bodyHtml += gridRow([
        esc(cName),
        esc(fmtMoney(c.spend, currency)),
        esc(fmtNum(c.impressions)),
        esc(fmtNum(c.clicks)),
        esc(fmtMoney(c.revenue, currency)),
        esc(fmtMoney(c.profit, currency)),
        esc(fmtRoas(c.roas)),
      ], false, '');
    }

    if (!campaigns.length && !note) {
      bodyHtml += '<div class="grid-row" role="row"><div class="grid-cell muted" role="cell" style="grid-column:1/-1;text-align:center;">No campaign data yet. Click ↻ to sync.</div></div>';
    }

    root.innerHTML =
      '<div class="stats-row-wrap">' +
        '<div class="stats-row">' +
          '<div class="stats-card">' +
            '<div class="traffic-card-header">' +
              '<h3 class="traffic-card-title">Ads</h3>' +
              '<button type="button" class="config-btn" id="ads-refresh-btn" title="Sync spend from Google Ads" aria-label="Refresh">↻</button>' +
            '</div>' +
            '<div class="country-table-wrap">' +
              '<div class="muted" style="padding: 10px 12px;">' + providerLine + '</div>' +
              '<div class="grid-table ads-campaign-table" role="table" aria-label="Ads campaigns">' +
                '<div class="grid-header" role="rowgroup">' + gridRow(headerCells, true) + '</div>' +
                '<div class="grid-body" role="rowgroup">' + bodyHtml + '</div>' +
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
