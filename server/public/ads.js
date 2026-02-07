(function () {
  if (window.__adsInit) return;

  /* ── helpers ─────────────────────────────────────────────── */

  function baseApi() {
    try { if (typeof API !== 'undefined') return String(API || ''); } catch (_) {}
    return '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtNum(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try { return x.toLocaleString('en-GB'); } catch (_) { return String(Math.round(x)); }
  }

  function fmtMoney(n, currency) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    var cur = currency || 'GBP';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(x); }
    catch (_) { return (cur === 'GBP' ? '£' : '') + String(Math.round(x * 100) / 100); }
  }

  function fmtRoas(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(2) + 'x';
  }

  function fmtTime(tsMs) {
    if (!tsMs) return '—';
    try { return new Date(Number(tsMs)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return '—'; }
  }

  function fetchJson(path, options) {
    var url = baseApi() + path;
    var opts = options || { credentials: 'same-origin', cache: 'no-store' };
    return fetch(url, opts).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().catch(function () { return null; });
    }).catch(function () { return null; });
  }

  function postRefresh(rangeKey) {
    var url = baseApi() + '/api/ads/refresh?range=' + encodeURIComponent(rangeKey || 'today');
    return fetch(url, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'googleads' }),
    }).then(function (r) {
      return r && r.ok ? r.json().catch(function () { return null; }) : null;
    }).catch(function () { return null; });
  }

  function profitClass(v) {
    var x = v != null ? Number(v) : 0;
    if (!Number.isFinite(x) || x === 0) return '';
    return x > 0 ? 'ads-profit-pos' : 'ads-profit-neg';
  }

  /* ── sort state ──────────────────────────────────────────── */

  // Column definitions: key, label, getter, format
  // Order: Campaign, Spend, Impr, Clicks, Profit, ROAS, Sales (clicks first among metrics, sales last)
  var COL_DEFS = [
    { key: 'campaign', label: 'Campaign', get: function (c) { return (c.campaignName || c.campaignId || '').toLowerCase(); }, fmt: null },
    { key: 'spend',    label: 'Spend',    get: function (c) { return c.spend || 0; },        fmt: function (v, cur) { return fmtMoney(v, cur); } },
    { key: 'impr',     label: 'Impr',     get: function (c) { return c.impressions || 0; },  fmt: function (v) { return fmtNum(v); } },
    { key: 'clicks',   label: 'Clicks',   get: function (c) { return c.clicks || 0; },       fmt: function (v) { return fmtNum(v); } },
    { key: 'profit',   label: 'Profit',   get: function (c) { return c.profit || 0; },       fmt: function (v, cur) { return fmtMoney(v, cur); } },
    { key: 'roas',     label: 'ROAS',     get: function (c) { return c.roas != null ? c.roas : -Infinity; }, fmt: function (v) { return fmtRoas(v === -Infinity ? null : v); } },
    { key: 'sales',    label: 'Sales',    get: function (c) { return c.revenue || 0; },      fmt: function (v, cur) { return fmtMoney(v, cur); } },
  ];

  var sortKey = 'profit';
  var sortDesc = true;

  function sortCampaigns(campaigns) {
    var def = null;
    for (var i = 0; i < COL_DEFS.length; i++) { if (COL_DEFS[i].key === sortKey) { def = COL_DEFS[i]; break; } }
    if (!def) return campaigns;
    var dir = sortDesc ? -1 : 1;
    return campaigns.slice().sort(function (a, b) {
      var va = def.get(a), vb = def.get(b);
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * ((va || 0) - (vb || 0));
    });
  }

  /* ── modal ───────────────────────────────────────────────── */

  var modalChart = null;

  function ensureModalDom() {
    if (document.getElementById('ads-campaign-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'ads-campaign-modal';
    overlay.className = 'ads-modal-overlay';
    overlay.innerHTML =
      '<div class="ads-modal-box">' +
        '<div class="ads-modal-header">' +
          '<h3 class="ads-modal-title"></h3>' +
          '<button type="button" class="ads-modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ads-modal-body">' +
          '<div class="ads-modal-chart-wrap"><canvas id="ads-modal-chart" height="200"></canvas></div>' +
          '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Recent Sales</h4>' +
          '<div id="ads-modal-sales"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.ads-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
  }

  function closeModal() {
    var el = document.getElementById('ads-campaign-modal');
    if (el) el.classList.remove('open');
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} modalChart = null; }
  }

  function openCampaignModal(campaignId, campaignName) {
    ensureModalDom();
    var modal = document.getElementById('ads-campaign-modal');
    modal.querySelector('.ads-modal-title').textContent = campaignName || campaignId || 'Campaign';
    document.getElementById('ads-modal-sales').innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Loading…</div>';
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} modalChart = null; }
    modal.classList.add('open');

    var rangeKey = computeRangeKey();
    fetchJson('/api/ads/campaign-detail?range=' + encodeURIComponent(rangeKey) + '&campaignId=' + encodeURIComponent(campaignId))
      .then(function (data) {
        if (!data || !data.ok) {
          document.getElementById('ads-modal-sales').innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No data available.</div>';
          return;
        }
        renderModalChart(data.chart || {});
        renderModalSales(data.recentSales || [], data.currency || 'GBP');
      });
  }

  function renderModalChart(chart) {
    if (typeof Chart === 'undefined') return;
    var canvas = document.getElementById('ads-modal-chart');
    if (!canvas) return;
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} }
    modalChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: chart.labels || [],
        datasets: [
          {
            label: 'Spend',
            data: chart.spend || [],
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 2,
          },
          {
            label: 'Sales',
            data: chart.revenue || [],
            borderColor: '#0d9488',
            backgroundColor: 'rgba(13,148,136,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 2,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { size: 12 }, bodyFont: { size: 12 },
            padding: 10, cornerRadius: 6,
            callbacks: {
              label: function (ctx) { return (ctx.dataset.label || '') + ': £' + (ctx.parsed.y != null ? ctx.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'); },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: function (v) { return '£' + v.toLocaleString(); }, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
          x: { ticks: { font: { size: 11 }, maxRotation: 0 }, grid: { display: false } },
        },
      },
    });
  }

  function renderModalSales(sales, currency) {
    var el = document.getElementById('ads-modal-sales');
    if (!el) return;
    if (!sales.length) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No attributed sales in this period.</div>';
      return;
    }
    var h = '<table class="ads-modal-sales-table"><thead><tr><th>Country</th><th>Value</th><th>Time</th></tr></thead><tbody>';
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      var flag = s.country ? '<img class="flag-img" src="https://flagcdn.com/w40/' + esc(s.country.toLowerCase()) + '.png" alt="' + esc(s.country) + '" width="20" height="15" style="border-radius:2px;vertical-align:middle;margin-right:4px;" onerror="this.style.display=\'none\'">' : '';
      h += '<tr><td>' + flag + esc(s.country || '—') + '</td><td>' + esc(fmtMoney(s.value, currency)) + '</td><td>' + esc(fmtTime(s.time)) + '</td></tr>';
    }
    h += '</tbody></table>';
    el.innerHTML = h;
  }

  /* ── inject modal CSS ────────────────────────────────────── */

  function ensureModalCss() {
    if (document.getElementById('ads-modal-css')) return;
    var style = document.createElement('style');
    style.id = 'ads-modal-css';
    style.textContent =
      '.ads-modal-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.45);align-items:center;justify-content:center;}' +
      '.ads-modal-overlay.open{display:flex;}' +
      '.ads-modal-box{background:var(--card,#fff);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);width:90%;max-width:620px;max-height:85vh;overflow:auto;animation:adsFadeIn .18s ease;}' +
      '@keyframes adsFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +
      '.ads-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e5e5e5);}' +
      '.ads-modal-title{margin:0;font-size:15px;font-weight:600;color:var(--text,#333);}' +
      '.ads-modal-close{border:none;background:none;font-size:22px;cursor:pointer;color:var(--muted,#555);padding:0 4px;line-height:1;}' +
      '.ads-modal-close:hover{color:var(--text,#333);}' +
      '.ads-modal-body{padding:18px;}' +
      '.ads-modal-chart-wrap{position:relative;height:220px;margin-bottom:8px;}' +
      '.ads-modal-sales-table{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.ads-modal-sales-table th{text-align:left;padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted,#555);border-bottom:1px solid var(--border,#e5e5e5);background:var(--th-bg,#f8f8f8);}' +
      '.ads-modal-sales-table td{padding:7px 10px;border-bottom:1px solid rgba(0,0,0,0.04);}' +
      '.ads-modal-sales-table tr:last-child td{border-bottom:none;}' +
      '.ads-modal-sales-table th:not(:first-child),.ads-modal-sales-table td:not(:first-child){text-align:center;}' +
      '.ads-profit-pos{color:#059669;font-weight:600;}' +
      '.ads-profit-neg{color:#dc2626;font-weight:600;}' +
      '.ads-campaign-link{color:var(--text,#333);text-decoration:none;cursor:pointer;border-bottom:1px dashed var(--border,#ccc);}' +
      '.ads-campaign-link:hover{color:var(--accent,#0d9488);border-bottom-color:var(--accent,#0d9488);}';
    document.head.appendChild(style);
  }

  /* ── render main table ───────────────────────────────────── */

  var _lastStatus = null;
  var _lastSummary = null;
  var _lastRefreshResult = null;

  function render(root, status, summary, refreshResult) {
    _lastStatus = status;
    _lastSummary = summary;
    if (refreshResult !== undefined) _lastRefreshResult = refreshResult;
    ensureModalCss();

    var providers = status && status.providers ? status.providers : [];
    var totals = summary && summary.totals ? summary.totals : {};
    var campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns : [];
    var currency = (summary && summary.currency) || 'GBP';
    var note = (summary && summary.note) ? String(summary.note) : '';

    // Sort campaigns
    campaigns = sortCampaigns(campaigns);

    var providerLine = providers.length
      ? providers.map(function (p) {
          var label = p && p.label ? p.label : (p && p.key ? p.key : 'Provider');
          var connected = !!(p && p.connected);
          return '<span class="muted"><strong>' + esc(label) + '</strong>: ' + (connected ? 'Connected' : 'Not connected') + '</span>';
        }).join(' · ')
      : '<span class="muted">No providers configured.</span>';

    function gridRow(cells, isHeader, cssClass, attrs) {
      var role = isHeader ? 'columnheader' : 'cell';
      var cls = 'grid-row' + (isHeader ? ' grid-row--header' : '') + (cssClass ? ' ' + cssClass : '');
      var h = '<div class="' + cls + '" role="row"' + (attrs || '') + '>';
      for (var i = 0; i < cells.length; i++) {
        var extra = '';
        if (isHeader && cells[i].sortKey) {
          var isActive = sortKey === cells[i].sortKey;
          extra = ' class="grid-cell sortable' + (isActive ? (sortDesc ? ' th-sort-desc' : ' th-sort-asc') : '') + '" data-sort="' + cells[i].sortKey + '"';
        } else {
          extra = ' class="grid-cell' + (cells[i].cls || '') + '"';
        }
        h += '<div' + extra + ' role="' + role + '">' + (cells[i].html != null ? cells[i].html : cells[i]) + '</div>';
      }
      h += '</div>';
      return h;
    }

    // Header cells: Campaign, Spend, Impr, Clicks, Profit, ROAS, Sales
    var headerCells = COL_DEFS.map(function (d) { return { html: d.label, sortKey: d.key }; });

    var bodyHtml = '';

    // Totals row
    var tProfit = totals.profit != null ? Number(totals.profit) : 0;
    bodyHtml += gridRow([
      { html: '<strong>Total</strong>' },
      { html: esc(fmtMoney(totals.spend, currency)) },
      { html: esc(fmtNum(totals.impressions)) },
      { html: esc(fmtNum(totals.clicks)) },
      { html: esc(fmtMoney(tProfit, currency)), cls: ' ' + profitClass(tProfit) },
      { html: esc(fmtRoas(totals.roas)) },
      { html: esc(fmtMoney(totals.revenue, currency)) },
    ], false, 'ads-totals-row');

    // Campaign rows
    for (var ci = 0; ci < campaigns.length; ci++) {
      var c = campaigns[ci];
      if (!c) continue;
      var cName = c.campaignName || c.campaignId || '—';
      var cId = c.campaignId || '';
      var pr = c.profit != null ? Number(c.profit) : 0;

      bodyHtml += gridRow([
        { html: '<a class="ads-campaign-link" data-campaign-id="' + esc(cId) + '" data-campaign-name="' + esc(cName) + '" href="#">' + esc(cName) + '</a>' },
        { html: esc(fmtMoney(c.spend, currency)) },
        { html: esc(fmtNum(c.impressions)) },
        { html: esc(fmtNum(c.clicks)) },
        { html: esc(fmtMoney(pr, currency)), cls: ' ' + profitClass(pr) },
        { html: esc(fmtRoas(c.roas)) },
        { html: esc(fmtMoney(c.revenue, currency)) },
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
              (_lastRefreshResult ? ('<details style="padding: 10px 12px;"><summary class="muted" style="cursor:pointer;">Sync diagnostics</summary><pre style="font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;margin:8px 0 0;padding:8px;background:#f8f8f8;border-radius:6px;border:1px solid #e5e5e5;">' + esc(JSON.stringify(_lastRefreshResult, null, 2)) + '</pre></details>') : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Bind refresh button
    var btn = document.getElementById('ads-refresh-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        try { window.__adsRefresh && window.__adsRefresh({ force: true }); } catch (_) {}
      });
    }

    // Bind sortable headers
    var headers = root.querySelectorAll('[data-sort]');
    for (var si = 0; si < headers.length; si++) {
      headers[si].addEventListener('click', function (e) {
        var key = e.currentTarget.getAttribute('data-sort');
        if (sortKey === key) { sortDesc = !sortDesc; }
        else { sortKey = key; sortDesc = true; }
        render(root, _lastStatus, _lastSummary);
      });
    }

    // Bind campaign links (open modal)
    var links = root.querySelectorAll('.ads-campaign-link');
    for (var li = 0; li < links.length; li++) {
      links[li].addEventListener('click', function (e) {
        e.preventDefault();
        var id = e.currentTarget.getAttribute('data-campaign-id');
        var name = e.currentTarget.getAttribute('data-campaign-name');
        openCampaignModal(id, name);
      });
    }
  }

  /* ── refresh / init ──────────────────────────────────────── */

  var inFlight = null;
  var hasAutoSynced = false;

  function computeRangeKey() {
    try { if (typeof getStatsRange === 'function') return String(getStatsRange() || 'today'); } catch (_) {}
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

    var p = preStep.then(function (rr) {
      if (rr) _lastRefreshResult = rr;
      return Promise.all([
        fetchJson('/api/ads/status'),
        fetchJson('/api/ads/summary?range=' + encodeURIComponent(rangeKey) + (isForce ? ('&_=' + Date.now()) : '')),
      ]);
    }).then(function (arr) {
      var status = arr && arr[0] ? arr[0] : null;
      var summary = arr && arr[1] ? arr[1] : null;
      render(root, status, summary, isForce ? _lastRefreshResult : undefined);

      if (!isForce && !hasAutoSynced && summary && summary.note && (!summary.campaigns || !summary.campaigns.length)) {
        hasAutoSynced = true;
        inFlight = null;
        return refresh({ force: true });
      }

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
  window.__adsInit = function () { return refresh({ force: false }); };
})();
