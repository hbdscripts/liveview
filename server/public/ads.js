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

  function profitClass(v) {
    var x = v != null ? Number(v) : 0;
    if (!Number.isFinite(x) || x === 0) return '';
    return x > 0 ? 'ads-profit-pos' : 'ads-profit-neg';
  }

  function setProfitCellClass(cell, profit) {
    if (!cell || !cell.classList) return;
    var x = profit != null ? Number(profit) : 0;
    cell.classList.remove('ads-profit-pos', 'ads-profit-neg');
    if (!Number.isFinite(x) || x === 0) return;
    cell.classList.add(x > 0 ? 'ads-profit-pos' : 'ads-profit-neg');
  }

  function patchText(el, text) {
    if (!el) return;
    var next = text == null ? '' : String(text);
    if (el.textContent !== next) el.textContent = next;
  }

  var _panelLoaderActive = false;
  function getPanelLoaderState() {
    var panel = document.getElementById('tab-panel-ads');
    var overlay = document.getElementById('ads-loading-overlay');
    var titleEl = overlay ? overlay.querySelector('.report-build-title') : null;
    var stepEl = document.getElementById('ads-build-step') || (overlay ? overlay.querySelector('.report-build-step') : null);
    return { panel: panel, overlay: overlay, titleEl: titleEl, stepEl: stepEl };
  }

  function showPanelLoader(title, step) {
    var st = getPanelLoaderState();
    if (!st.panel || !st.overlay) return;
    st.panel.classList.add('report-building');
    st.overlay.classList.remove('is-hidden');
    if (title != null) patchText(st.titleEl, String(title));
    if (step != null) patchText(st.stepEl, String(step));
    _panelLoaderActive = true;
  }

  function setPanelLoaderStep(step, title) {
    var st = getPanelLoaderState();
    if (!st.overlay || st.overlay.classList.contains('is-hidden')) return;
    if (title != null) patchText(st.titleEl, String(title));
    if (step != null) patchText(st.stepEl, String(step));
  }

  function hidePanelLoader() {
    var st = getPanelLoaderState();
    if (!st.panel || !st.overlay) return;
    st.overlay.classList.add('is-hidden');
    st.panel.classList.remove('report-building');
    _panelLoaderActive = false;
  }

  /* ── sort state ──────────────────────────────────────────── */

  // Column definitions: key, label, getter, format
  // Order: Campaign, Spend, Impr, Clicks, Conv, Profit, ROAS, Sales
  var COL_DEFS = [
    { key: 'campaign', label: 'Campaign', get: function (c) { return (c.campaignName || c.campaignId || '').toLowerCase(); }, fmt: null },
    { key: 'spend',    label: 'Spend',    get: function (c) { return c.spend || 0; },        fmt: function (v, cur) { return fmtMoney(v, cur); } },
    { key: 'impr',     label: 'Impr',     get: function (c) { return c.impressions || 0; },  fmt: function (v) { return fmtNum(v); } },
    { key: 'clicks',   label: 'Clicks',   get: function (c) { return c.clicks || 0; },       fmt: function (v) { return fmtNum(v); } },
    { key: 'conv',     label: 'Conv',     get: function (c) { return c.orders || 0; },       fmt: function (v) { return fmtNum(v); } },
    { key: 'profit',   label: 'Profit',   get: function (c) { return c.profit || 0; },       fmt: function (v, cur) { return fmtMoney(v, cur); } },
    { key: 'roas',     label: 'ROAS',     get: function (c) { return c.roas != null ? c.roas : -Infinity; }, fmt: function (v) { return fmtRoas(v === -Infinity ? null : v); } },
    { key: 'sales',    label: 'Sales',    get: function (c) { return c.revenue || 0; },      fmt: function (v, cur) { return fmtMoney(v, cur); } },
  ];

  var sortKey = 'sales';
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

  var adsOverviewChart = null;
  var modalChart = null;
  var chartJsLoading = null;

  function shortCampaignLabel(value, maxLen) {
    var raw = value == null ? '' : String(value).trim();
    var cap = Math.max(10, Number(maxLen) || 24);
    if (!raw) return '—';
    if (raw.length <= cap) return raw;
    return raw.slice(0, cap - 1) + '…';
  }

  function clearAdsOverviewChart(message) {
    var el = document.getElementById('ads-overview-chart');
    if (!el) return;
    if (adsOverviewChart) {
      try { adsOverviewChart.destroy(); } catch (_) {}
      adsOverviewChart = null;
    }
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:240px;color:var(--tblr-secondary);font-size:.875rem;">' +
      esc(message || 'No campaign data for this range') +
      '</div>';
  }

  function renderAdsOverviewChart(summary) {
    var el = document.getElementById('ads-overview-chart');
    if (!el) return;
    if (typeof ApexCharts === 'undefined') {
      setTimeout(function () { renderAdsOverviewChart(summary); }, 180);
      return;
    }
    var campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns.slice() : [];
    var currency = summary && summary.currency ? String(summary.currency) : 'GBP';
    campaigns = campaigns.filter(Boolean).sort(function (a, b) {
      return (Number((b && b.revenue) || 0) - Number((a && a.revenue) || 0));
    }).slice(0, 8);
    if (!campaigns.length) {
      clearAdsOverviewChart('No campaign data for this range');
      return;
    }

    var categories = campaigns.map(function (c) { return shortCampaignLabel(c.campaignName || c.campaignId || '—', 24); });
    var spendSeries = campaigns.map(function (c) { return Number((c && c.spend) || 0); });
    var salesSeries = campaigns.map(function (c) { return Number((c && c.revenue) || 0); });
    var roasSeries = campaigns.map(function (c) {
      var spend = Number((c && c.spend) || 0);
      var revenue = Number((c && c.revenue) || 0);
      return spend > 0 ? (revenue / spend) : 0;
    });
    var valid = categories.length > 0 && [spendSeries, salesSeries, roasSeries].every(function (arr) {
      return Array.isArray(arr) && arr.length === categories.length && arr.every(function(v) { return Number.isFinite(v); });
    });
    if (!valid) {
      clearAdsOverviewChart('No campaign data for this range');
      return;
    }

    if (adsOverviewChart) {
      try { adsOverviewChart.destroy(); } catch (_) {}
      adsOverviewChart = null;
    }
    el.innerHTML = '';

    try {
      adsOverviewChart = new ApexCharts(el, {
        chart: {
          type: 'line',
          height: 252,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false },
        },
        series: [
          { name: 'Sales', type: 'area', data: salesSeries },
          { name: 'Spend', type: 'area', data: spendSeries },
          { name: 'ROAS', type: 'line', data: roasSeries },
        ],
        colors: ['#3eb3ab', '#ef4444', '#4b94e4'],
        stroke: { width: [2.6, 2.4, 3], curve: 'smooth' },
        fill: {
          type: ['gradient', 'gradient', 'solid'],
          gradient: { opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] }
        },
        markers: { size: 3, hover: { size: 5 } },
        dataLabels: { enabled: false },
        xaxis: {
          categories: categories,
          labels: {
            style: { fontSize: '11px' },
            rotate: -18,
            hideOverlappingLabels: false,
            trim: true,
          },
        },
        yaxis: [
          {
            min: 0,
            forceNiceScale: true,
            labels: {
              style: { fontSize: '11px' },
              formatter: function (v) { return fmtMoney(v, currency); },
            },
          },
          {
            min: 0,
            forceNiceScale: true,
            show: false,
            labels: { show: false },
          },
          {
            min: 0,
            opposite: true,
            forceNiceScale: true,
            labels: {
              style: { fontSize: '11px' },
              formatter: function (v) { return fmtRoas(v); },
            },
          }
        ],
        tooltip: {
          shared: true,
          intersect: false,
          y: {
            formatter: function (v, opts) {
              var idx = opts && opts.seriesIndex != null ? Number(opts.seriesIndex) : 0;
              return idx === 2 ? fmtRoas(v) : fmtMoney(v, currency);
            },
          },
        },
        legend: {
          position: 'top',
          fontSize: '12px',
          markers: { radius: 10 },
        },
        grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
      });
      var renderPromise = adsOverviewChart.render();
      if (renderPromise && typeof renderPromise.then === 'function') {
        renderPromise.catch(function () {
          clearAdsOverviewChart('Chart rendering failed');
        });
      }
    } catch (_) {
      clearAdsOverviewChart('Chart rendering failed');
    }
  }

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

  function ensureChartJs() {
    try { if (typeof Chart !== 'undefined') return Promise.resolve(true); } catch (_) {}
    if (chartJsLoading) return chartJsLoading;

    chartJsLoading = new Promise(function(resolve) {
      try {
        // If a tag exists (possibly still loading), attach listeners.
        var existing = document.querySelector('script[data-chart-js="1"]');
        if (existing) {
          try { if (typeof Chart !== 'undefined') { resolve(true); return; } } catch (_) {}
          existing.addEventListener('load', function() { resolve(true); }, { once: true });
          existing.addEventListener('error', function() { resolve(false); }, { once: true });
          return;
        }

        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
        s.async = true;
        s.defer = true;
        s.setAttribute('data-chart-js', '1');
        s.onload = function() {
          try { resolve(typeof Chart !== 'undefined'); } catch (_) { resolve(false); }
        };
        s.onerror = function() { resolve(false); };
        document.head.appendChild(s);
      } catch (_) {
        resolve(false);
      }
    }).finally(function() {
      chartJsLoading = null;
    });

    return chartJsLoading;
  }

  function closeModal() {
    var el = document.getElementById('ads-campaign-modal');
    if (el) el.classList.remove('open');
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} modalChart = null; }
  }

  function ensureErrorsModalDom() {
    if (document.getElementById('ads-errors-modal')) return;
    var wrap = document.createElement('div');
    wrap.className = 'modal modal-blur';
    wrap.id = 'ads-errors-modal';
    wrap.tabIndex = -1;
    wrap.style.display = 'none';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="dialog">' +
        '<div class="modal-content">' +
          '<div class="modal-header">' +
            '<h5 class="modal-title">Errors detected</h5>' +
            '<button type="button" class="btn-close" id="ads-errors-close" aria-label="Close"></button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div id="ads-errors-body"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var closeBtn = document.getElementById('ads-errors-close');
    if (closeBtn) closeBtn.addEventListener('click', closeErrorsModal);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeErrorsModal(); });

    // One-time ESC handler.
    try {
      if (!window.__adsErrorsEscBound) {
        window.__adsErrorsEscBound = true;
        document.addEventListener('keydown', function (e) {
          if (!e || e.key !== 'Escape') return;
          closeErrorsModal();
        });
      }
    } catch (_) {}
  }

  function closeErrorsModal() {
    var el = document.getElementById('ads-errors-modal');
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function openErrorsModal(errors, payload) {
    ensureErrorsModalDom();
    var modal = document.getElementById('ads-errors-modal');
    var body = document.getElementById('ads-errors-body');
    if (!modal || !body) return;
    var errs = Array.isArray(errors) ? errors : [];
    var h = '';
    if (!errs.length) {
      h += '<div class="muted" style="padding:12px;text-align:center;">No errors.</div>';
    } else {
      h += '<div class="text-muted small" style="margin-bottom:10px;">' + esc(String(errs.length)) + ' issue(s) detected.</div>';
      h += '<ul class="ads-errors-list">';
      for (var i = 0; i < errs.length; i++) {
        var e = errs[i] || {};
        h += '<li><span class="ads-errors-title">' + esc(e.title || 'Error') + '</span>' +
          (e.detail ? ('<div class="ads-errors-detail">' + esc(e.detail) + '</div>') : '') +
        '</li>';
      }
      h += '</ul>';
    }
    if (payload) {
      h += '<div class="text-muted small" style="margin:14px 0 6px;">Diagnostics</div>';
      h += '<pre class="ads-errors-pre">' + esc(JSON.stringify(payload, null, 2)) + '</pre>';
    }
    body.innerHTML = h;
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
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
        var currency = data.currency || 'GBP';
        ensureChartJs().then(function(ok) {
          // If the modal was closed while loading, skip rendering.
          try {
            var m = document.getElementById('ads-campaign-modal');
            if (!m || !m.classList.contains('open')) return;
          } catch (_) {}
          if (!ok) return;
          renderModalChart(data.chart || {}, currency);
        });
        renderModalSales(data.recentSales || [], currency);
      });
  }

  function renderModalChart(chart, currency) {
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
              label: function (ctx) { return (ctx.dataset.label || '') + ': ' + (ctx.parsed.y != null ? fmtMoney(ctx.parsed.y, currency || 'GBP') : '—'); },
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { callback: function (v) { return fmtMoney(v, currency || 'GBP'); }, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
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
      var cc = s.country ? s.country.toLowerCase() : '';
      var flag = (cc && /^[a-z]{2}$/.test(cc)) ? '<span class="flag flag-xs flag-country-' + esc(cc) + '" style="vertical-align:middle;margin-right:4px;" aria-hidden="true"></span>' : '';
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
      '.ads-campaign-row{cursor:pointer;transition:background .12s;}' +
      '.ads-campaign-row:hover{background:rgba(13,148,136,0.04);}' +
      '.ads-loading-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:220px;padding:32px 12px;gap:12px;text-align:center;}' +
      '.ads-loader-spinner{width:30px;height:30px;border-radius:50%;background:conic-gradient(from 0deg,#4592e9,#32bdb0,#fa9f2e,#4592e9);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3.5px),#000 calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 3.5px),#000 calc(100% - 3px));animation:adsLoaderSpin .9s linear infinite;}' +
      '@keyframes adsLoaderSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
      '.ads-refresh-mini{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:rgba(0,0,0,0.04);color:var(--muted,#555);}' +
      'html[data-bs-theme="dark"] .ads-refresh-mini{background:rgba(255,255,255,0.06);}' +
      '@keyframes adsSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
      '.ads-spin{animation:adsSpin 1s linear infinite;transform-origin:50% 50%;}' +
      '.ads-campaign-table{table-layout:fixed;min-width:760px;}' +
      '#ads-footer{overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
      '.ads-campaign-table .grid-cell:nth-child(2){width:110px;}' +
      '.ads-campaign-table .grid-cell:nth-child(3){width:90px;}' +
      '.ads-campaign-table .grid-cell:nth-child(4){width:80px;}' +
      '.ads-campaign-table .grid-cell:nth-child(5){width:80px;}' +
      '.ads-campaign-table .grid-cell:nth-child(6){width:110px;}' +
      '.ads-campaign-table .grid-cell:nth-child(7){width:80px;}' +
      '.ads-campaign-table .grid-cell:nth-child(8){width:110px;}' +
      '@media (max-width:768px){' +
        '.ads-campaign-table .grid-cell:first-child{position:sticky;left:0;z-index:2;width:100px;max-width:100px;min-width:100px;background:inherit;box-shadow:1px 0 0 var(--tblr-border-color, #e6e7e9);}' +
        '.ads-campaign-table .grid-row--header .grid-cell:first-child{z-index:3;}' +
        '.ads-campaign-table .ads-totals-row .grid-cell:first-child{z-index:3;}' +
      '}' +
      '.ads-campaign-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.ads-errors-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px;}' +
      '.ads-errors-title{font-weight:600;}' +
      '.ads-errors-detail{margin-top:2px;color:var(--muted,#555);font-size:12px;white-space:pre-wrap;word-break:break-word;}' +
      '.ads-errors-pre{font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;margin:0;padding:10px;background:#f8f8f8;border-radius:8px;border:1px solid #e5e5e5;}';
    document.head.appendChild(style);
  }

  /* ── render main table ───────────────────────────────────── */

  var _lastStatus = null;
  var _lastSummary = null;
  var _lastRefreshResult = null;
  var _lastRangeKey = null;
  var _lastFetchedAt = 0;
  var _lastFetchError = null;
  var _isRefreshing = false;
  var _isForceRefreshing = false;
  var _lastErrors = [];
  var _lastErrorsPayload = null;

  function renderLoading(root, title, step) {
    if (!root) return;
    ensureModalCss();
    try {
      var actions = document.getElementById('ads-actions');
      var footer = document.getElementById('ads-footer');
      var noteEl = document.getElementById('ads-note');
      if (actions) actions.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (noteEl) { noteEl.style.display = 'none'; patchText(noteEl, ''); }
    } catch (_) {}
    root.innerHTML =
      '<div class="ads-loading-wrap">' +
        '<div class="report-build-wrap">' +
          '<div class="ads-loader-spinner" role="status" aria-label="Loading"></div>' +
          '<div class="report-build-title" data-ads-loader-title>' + esc(title || 'Preparing ads') + '</div>' +
          '<div class="report-build-step" data-ads-loader-step>' + esc(step || '') + '</div>' +
        '</div>' +
      '</div>';
  }

  function setLoadingStep(root, step, title) {
    setPanelLoaderStep(step, title);
    if (!root || !root.querySelector) return;
    var stepEl = root.querySelector('[data-ads-loader-step]');
    var titleEl = root.querySelector('[data-ads-loader-title]');
    if (titleEl && title != null) patchText(titleEl, String(title));
    if (stepEl && step != null) patchText(stepEl, String(step));
  }

  function renderLoadError(root, msg) {
    if (!root) return;
    ensureModalCss();
    try {
      var actions = document.getElementById('ads-actions');
      var footer = document.getElementById('ads-footer');
      var noteEl = document.getElementById('ads-note');
      if (actions) actions.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (noteEl) { noteEl.style.display = 'none'; patchText(noteEl, ''); }
    } catch (_) {}
    root.innerHTML =
      '<div class="ads-loading-wrap">' +
        '<div class="text-danger fw-semibold">Could not load ads</div>' +
        (msg ? ('<div class="muted small" style="max-width:520px;">' + esc(msg) + '</div>') : '') +
      '</div>';
  }

  function collectErrors(status, summary, refreshResult) {
    var errs = [];
    function push(title, detail) {
      var d = detail != null ? String(detail).trim() : '';
      if (!d) return;
      errs.push({ title: title, detail: d });
    }

    if (_lastFetchError) push('Load failed', _lastFetchError);
    if (!status) push('Status', 'No provider status returned.');
    if (!summary) push('Summary', 'No summary returned.');
    if (summary && summary.ok === false) push('Summary', summary.error || 'Summary failed.');

    var rr = refreshResult || null;
    if (rr) {
      if (rr.ok === false) push('Refresh', rr.error || 'Refresh failed.');
      if (rr.spend && rr.spend.ok === false) push('Spend sync', rr.spend.error || 'Spend sync failed.');
      if (rr.gclidBackfill && rr.gclidBackfill.ok === false) push('GCLID backfill', rr.gclidBackfill.error || 'GCLID backfill failed.');
      if (rr.orderAttribution && rr.orderAttribution.ok === false) push('Order attribution', rr.orderAttribution.error || 'Order attribution failed.');
    }

    return errs;
  }

  function patchSpendProfitRoas(root, summary) {
    if (!root || !summary || !summary.totals) return false;
    var currency = (summary && summary.currency) || 'GBP';
    var campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns : [];
    if (!campaigns.length) return false;

    var map = new Map();
    for (var i = 0; i < campaigns.length; i++) {
      var c = campaigns[i];
      if (!c || !c.campaignId) continue;
      map.set(String(c.campaignId), c);
    }

    var rows = root.querySelectorAll('.ads-campaign-row');
    if (!rows || !rows.length) return false;

    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      if (!row) continue;
      var id = row.getAttribute('data-campaign-id') || '';
      if (!id) continue;
      var c2 = map.get(String(id));
      if (!c2) return false; // campaign set changed -> full rerender

      var cells = row.querySelectorAll('.grid-cell');
      if (!cells || cells.length < 8) return false;

      patchText(cells[1], fmtMoney(c2.spend, currency));
      patchText(cells[2], fmtNum(c2.impressions));
      patchText(cells[3], fmtNum(c2.clicks));
      patchText(cells[4], fmtNum(c2.orders));

      var pr = c2.profit != null ? Number(c2.profit) : 0;
      patchText(cells[5], fmtMoney(pr, currency));
      setProfitCellClass(cells[5], pr);

      patchText(cells[6], fmtRoas(c2.roas));
      patchText(cells[7], fmtMoney(c2.revenue, currency));
    }

    var totals = summary && summary.totals ? summary.totals : null;
    var totalsFooter = document.getElementById('ads-footer');
    var tRow = totalsFooter ? totalsFooter.querySelector('.ads-totals-row') : null;
    if (totals && tRow) {
      var tCells = tRow.querySelectorAll('.grid-cell');
      if (!tCells || tCells.length < 8) return false;
      patchText(tCells[1], fmtMoney(totals.spend, currency));
      patchText(tCells[2], fmtNum(totals.impressions));
      patchText(tCells[3], fmtNum(totals.clicks));
      patchText(tCells[4], fmtNum(totals.conversions != null ? totals.conversions : totals.orders));
      var tProfit = totals.profit != null ? Number(totals.profit) : 0;
      patchText(tCells[5], fmtMoney(tProfit, currency));
      setProfitCellClass(tCells[5], tProfit);
      patchText(tCells[6], fmtRoas(totals.roas));
      patchText(tCells[7], fmtMoney(totals.revenue, currency));
    }

    return true;
  }

  function alertTriangleSvg() {
    return '<i class="fa-light fa-triangle-exclamation" data-icon-key="ads-status-warning" aria-hidden="true"></i>';
  }

  function refreshSvg(extraClass, idAttr) {
    var cls = 'fa-light fa-rotate-right' + (extraClass ? (' ' + extraClass) : '');
    var id = idAttr ? (' id="' + idAttr + '"') : '';
    return '<i' + id + ' class="' + cls + '" data-icon-key="ads-actions-refresh" aria-hidden="true"></i>';
  }

  function connectionStatusSvg(isConnected) {
    if (isConnected) {
      return '<i class="fa-light fa-circle-check" data-icon-key="ads-status-connected" aria-hidden="true"></i>';
    }
    return '<i class="fa-light fa-circle-xmark" data-icon-key="ads-status-disconnected" aria-hidden="true"></i>';
  }

  function ensureActionsPlacement() {
    var actions = document.getElementById('ads-actions');
    var footer = document.getElementById('ads-footer');
    if (!actions || !footer) return;
    var parent = footer.parentNode;
    if (!parent || actions.parentNode !== parent) return;
    if (footer.nextElementSibling === actions) return;
    parent.insertBefore(actions, footer.nextSibling);
  }

  function renderActionsBar(status, summary) {
    ensureActionsPlacement();
    var actions = document.getElementById('ads-actions');
    if (!actions) return;

    var providers = status && status.providers ? status.providers : [];
    var isConnected = !!(providers.length && providers.some(function (p) { return !!(p && p.connected); }));
    var connLabel = isConnected ? 'Connected' : (providers.length ? 'Not connected' : 'No providers configured');

    _lastErrors = collectErrors(status, summary, _lastRefreshResult);
    _lastErrorsPayload = {
      fetchError: _lastFetchError,
      refresh: _lastRefreshResult,
      providers: status && status.providers ? status.providers : null,
      rangeKey: summary && summary.rangeKey ? summary.rangeKey : null,
    };

    var connBtnClass = isConnected ? 'btn-ghost-success' : 'btn-ghost-secondary';

    actions.style.display = '';
    actions.innerHTML =
      '<button type="button" class="btn btn-icon btn-ghost-danger" id="ads-errors-icon" style="display:' + (_lastErrors.length ? 'inline-flex' : 'none') + ';" title="Errors detected" aria-label="Errors detected">' +
        alertTriangleSvg() +
      '</button>' +
      '<span class="btn btn-icon ' + connBtnClass + ' disabled" id="ads-conn-icon" title="' + esc(connLabel) + '" aria-label="' + esc(connLabel) + '">' +
        connectionStatusSvg(isConnected) +
      '</span>' +
      '<button type="button" class="btn btn-icon btn-ghost-secondary" id="ads-refresh-btn" title="Refresh metrics" aria-label="Refresh"' + (_isRefreshing ? ' disabled' : '') + '>' +
        refreshSvg(_isRefreshing ? 'ads-spin' : '', 'ads-refresh-icon') +
      '</button>';

    var rbtn = document.getElementById('ads-refresh-btn');
    if (rbtn) {
      rbtn.addEventListener('click', function () {
        try { window.__adsRefresh && window.__adsRefresh({ force: true }); } catch (_) {}
      });
    }
    var ebtn = document.getElementById('ads-errors-icon');
    if (ebtn) {
      ebtn.addEventListener('click', function () {
        try { openErrorsModal(_lastErrors, _lastErrorsPayload); } catch (_) {}
      });
    }
  }

  function patchFooterAndNote(status, summary) {
    var noteEl = document.getElementById('ads-note');
    var note = (summary && summary.note) ? String(summary.note) : '';
    if (noteEl) {
      if (note) {
        noteEl.style.display = '';
        patchText(noteEl, note);
      } else {
        noteEl.style.display = 'none';
        patchText(noteEl, '');
      }
    }

    renderActionsBar(status, summary);
  }

  var _adsScrollSyncInited = false;
  function syncFooterScroll() {
    var rootWrap = document.getElementById('ads-root');
    var footerWrap = document.getElementById('ads-footer');
    if (!rootWrap || !footerWrap) return;

    if (!_adsScrollSyncInited) {
      _adsScrollSyncInited = true;
      var syncing = false;
      function sync(from, to) {
        if (syncing) return;
        syncing = true;
        try { to.scrollLeft = from.scrollLeft; } catch (_) {}
        setTimeout(function () { syncing = false; }, 0);
      }
      try {
        rootWrap.addEventListener('scroll', function () { sync(rootWrap, footerWrap); }, { passive: true });
        footerWrap.addEventListener('scroll', function () { sync(footerWrap, rootWrap); }, { passive: true });
      } catch (_) {}
    }

    // Ensure footer aligns to current table scroll offset.
    try { footerWrap.scrollLeft = rootWrap.scrollLeft; } catch (_) {}
  }

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
    if (summary && summary.rangeKey) _lastRangeKey = String(summary.rangeKey);

    // Sort campaigns
    campaigns = sortCampaigns(campaigns);

    function gridRow(cells, isHeader, cssClass, attrs) {
      var role = isHeader ? 'columnheader' : 'cell';
      var cls = 'grid-row' + (isHeader ? ' grid-row--header' : '') + (cssClass ? ' ' + cssClass : '');
      var h = '<div class="' + cls + '" role="row"' + (attrs || '') + '>';
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i] || {};
        var cellCls = 'grid-cell' + (cell.cls || '');
        var extra = ' class="' + cellCls + '"';
        if (isHeader && cell.sortKey) {
          var isActive = sortKey === cell.sortKey;
          extra = ' class="grid-cell sortable' +
            (isActive ? (sortDesc ? ' th-sort-desc' : ' th-sort-asc') : '') +
            (cell.cls || '') +
            '" data-sort="' + cell.sortKey + '"';
        }
        h += '<div' + extra + ' role="' + role + '">' + (cell.html != null ? cell.html : cell) + '</div>';
      }
      h += '</div>';
      return h;
    }

    // Sanity-check totals (best-effort): API totals should match sum of campaigns (within rounding tolerance).
    (function auditTotals() {
      try {
        var sum = { spend: 0, impressions: 0, clicks: 0, revenue: 0, profit: 0 };
        for (var i = 0; i < campaigns.length; i++) {
          var c = campaigns[i] || {};
          sum.spend += Number(c.spend) || 0;
          sum.impressions += Number(c.impressions) || 0;
          sum.clicks += Number(c.clicks) || 0;
          sum.revenue += Number(c.revenue) || 0;
          sum.profit += Number(c.profit) || 0;
        }
        var tolMoney = 0.06; // allow small rounding drift between per-campaign rounding vs totals rounding
        function dm(a, b) { return Math.abs((Number(a) || 0) - (Number(b) || 0)); }
        function di(a, b) { return Math.abs((Math.floor(Number(a) || 0)) - (Math.floor(Number(b) || 0))); }
        var mismatches = [];
        if (dm(sum.spend, totals.spend) > tolMoney) mismatches.push('spend');
        if (dm(sum.revenue, totals.revenue) > tolMoney) mismatches.push('revenue');
        if (dm(sum.profit, totals.profit) > tolMoney) mismatches.push('profit');
        if (di(sum.clicks, totals.clicks) > 0) mismatches.push('clicks');
        if (di(sum.impressions, totals.impressions) > 0) mismatches.push('impressions');
        if (mismatches.length) {
          console.warn('[ads] totals mismatch (api vs sum(campaigns))', { mismatches: mismatches, api: totals, sum: sum });
        }
      } catch (_) {}
    })();

    // Header cells: Campaign, Spend, Impr, Clicks, Conv, Profit, ROAS, Sales
    var headerCells = COL_DEFS.map(function (d, idx) {
      return { html: d.label, sortKey: d.key, cls: idx === 0 ? '' : ' text-end' };
    });

    var bodyHtml = '';

    // Totals row (render in card footer)
    var tProfit = totals.profit != null ? Number(totals.profit) : 0;
    var totalsRowHtml = gridRow([
      { html: '<strong>Total</strong>' },
      { html: esc(fmtMoney(totals.spend, currency)), cls: ' text-end' },
      { html: esc(fmtNum(totals.impressions)), cls: ' text-end' },
      { html: esc(fmtNum(totals.clicks)), cls: ' text-end' },
      { html: esc(fmtNum(totals.conversions != null ? totals.conversions : totals.orders)), cls: ' text-end' },
      { html: esc(fmtMoney(tProfit, currency)), cls: ' text-end ' + profitClass(tProfit) },
      { html: esc(fmtRoas(totals.roas)), cls: ' text-end' },
      { html: esc(fmtMoney(totals.revenue, currency)), cls: ' text-end' },
    ], false, 'ads-totals-row');

    // Campaign rows
    for (var ci = 0; ci < campaigns.length; ci++) {
      var c = campaigns[ci];
      if (!c) continue;
      var cName = c.campaignName || c.campaignId || '—';
      var cId = c.campaignId || '';
      var pr = c.profit != null ? Number(c.profit) : 0;

      bodyHtml += gridRow([
        { html: '<span class="ads-campaign-name">' + esc(cName) + '</span>' },
        { html: esc(fmtMoney(c.spend, currency)), cls: ' text-end' },
        { html: esc(fmtNum(c.impressions)), cls: ' text-end' },
        { html: esc(fmtNum(c.clicks)), cls: ' text-end' },
        { html: esc(fmtNum(c.orders)), cls: ' text-end' },
        { html: esc(fmtMoney(pr, currency)), cls: ' text-end ' + profitClass(pr) },
        { html: esc(fmtRoas(c.roas)), cls: ' text-end' },
        { html: esc(fmtMoney(c.revenue, currency)), cls: ' text-end' },
      ], false, 'ads-campaign-row', ' data-campaign-id="' + esc(cId) + '" data-campaign-name="' + esc(cName) + '"');
    }

    if (!campaigns.length && !note) {
      bodyHtml += '<div class="grid-row" role="row"><div class="grid-cell muted" role="cell" style="text-align:center;">No campaign data yet. Click ↻ to sync.</div></div>';
    }

    root.innerHTML =
      '<div class="grid-table ads-campaign-table" role="table" aria-label="Ads campaigns">' +
        '<div class="grid-header kexo-grid-header" role="rowgroup">' + gridRow(headerCells, true) + '</div>' +
        '<div class="grid-body" role="rowgroup">' + bodyHtml + '</div>' +
      '</div>';

    var totalsFooter = document.getElementById('ads-footer');
    if (totalsFooter) {
      totalsFooter.style.display = '';
      totalsFooter.innerHTML =
        '<div class="grid-table ads-campaign-table" role="table" aria-label="Ads totals">' +
          '<div class="grid-body" role="rowgroup">' + totalsRowHtml + '</div>' +
        '</div>';
    }

    patchFooterAndNote(status, summary);
    syncFooterScroll();
    renderAdsOverviewChart(summary);

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

    // Bind campaign rows (open modal on click)
    var rows = root.querySelectorAll('.ads-campaign-row');
    for (var li = 0; li < rows.length; li++) {
      rows[li].addEventListener('click', function (e) {
        var id = e.currentTarget.getAttribute('data-campaign-id');
        var name = e.currentTarget.getAttribute('data-campaign-name');
        if (id) openCampaignModal(id, name);
      });
    }
  }

  /* ── refresh / init ──────────────────────────────────────── */

  var inFlight = null;

  function applyRefreshingUi(refreshing, isForce) {
    _isRefreshing = !!refreshing;
    _isForceRefreshing = !!isForce;
    var btn = document.getElementById('ads-refresh-btn');
    if (btn) {
      btn.disabled = _isRefreshing;
      var svg = document.getElementById('ads-refresh-icon');
      if (svg && svg.classList) {
        svg.classList.remove('ads-spin');
        if (_isRefreshing) svg.classList.add('ads-spin');
      }
    }
  }

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
    var showPageLoader = !_lastSummary;
    var rangeKey = computeRangeKey();
    var now = Date.now();

    // Soft refresh should not spam requests (tab focus / theme refresh). Keep UX smooth.
    if (!isForce && _lastSummary && _lastRangeKey === rangeKey && _lastFetchedAt && (now - _lastFetchedAt) < 15000) {
      // Ensure footer is visible (in case user navigated before first render)
      try {
        if (!root.innerHTML) render(root, _lastStatus, _lastSummary);
      } catch (_) {}
      return Promise.resolve({ status: _lastStatus, summary: _lastSummary, cached: true });
    }

    _lastFetchError = null;
    var actions = document.getElementById('ads-actions');
    var footer = document.getElementById('ads-footer');
    var noteEl = document.getElementById('ads-note');

    if (showPageLoader) {
      showPanelLoader('Preparing Google Ads', 'Connecting to Google');
      if (actions) actions.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (noteEl) { noteEl.style.display = 'none'; noteEl.textContent = ''; }
      renderLoading(root, 'Preparing Google Ads', 'Connecting to Google');
    } else {
      applyRefreshingUi(true, isForce);
    }

    var p = fetchJson('/api/ads/status')
      .then(function(status) {
        if (showPageLoader) setLoadingStep(root, 'Importing campaigns');
        return fetchJson('/api/ads/summary?range=' + encodeURIComponent(rangeKey) + (isForce ? ('&_=' + Date.now()) : ''))
          .then(function(summary) { return { status: status, summary: summary }; });
      })
      .then(function (arr) {
      var status = arr && arr.status ? arr.status : null;
      var summary = arr && arr.summary ? arr.summary : null;
      if (!status || !summary) _lastFetchError = 'Failed to load ads data (status/summary).';
      if (summary && summary.rangeKey) _lastRangeKey = String(summary.rangeKey);
      else _lastRangeKey = rangeKey;
      if (summary) _lastFetchedAt = Date.now();
      if (showPageLoader) setLoadingStep(root, 'Loading campaign data');

      applyRefreshingUi(false, false);
      var nextStatus = status || _lastStatus;
      var nextSummary = summary || _lastSummary;
      if (showPageLoader) setLoadingStep(root, 'Analyzing spend');

      var didPatch = false;
      if (nextSummary && _lastSummary) {
        try {
          if (showPageLoader) setLoadingStep(root, 'Analyzing spend');
          didPatch = patchSpendProfitRoas(root, nextSummary);
          patchFooterAndNote(nextStatus, nextSummary);
        } catch (_) { didPatch = false; }
      }

      if (!didPatch) {
        if (showPageLoader) setLoadingStep(root, 'Building profit table');
        render(root, nextStatus, nextSummary, undefined);
      } else {
        _lastStatus = nextStatus;
        _lastSummary = nextSummary;
        try { renderAdsOverviewChart(nextSummary); } catch (_) {}
      }

      return { status: status, summary: summary };
    }).catch(function () {
      _lastFetchError = 'Could not load ads.';
      applyRefreshingUi(false, false);
      if (_lastSummary) {
        try { patchFooterAndNote(_lastStatus, _lastSummary); } catch (_) {}
        try { renderAdsOverviewChart(_lastSummary); } catch (_) {}
      } else {
        if (showPageLoader) setLoadingStep(root, 'Could not load ads');
        if (actions) actions.style.display = 'none';
        if (footer) footer.style.display = 'none';
        if (noteEl) { noteEl.style.display = 'none'; noteEl.textContent = ''; }
        renderLoadError(root, _lastFetchError);
        try { clearAdsOverviewChart('Could not load chart'); } catch (_) {}
      }
      return null;
    }).finally(function () {
      if (inFlight === p) inFlight = null;
      if (showPageLoader || _panelLoaderActive) hidePanelLoader();
    });

    inFlight = p;
    return p;
  }

  window.__adsRefresh = refresh;
  window.__adsInit = function () {
    var AUTO_REFRESH_MS = 5 * 60 * 1000;
    var hasTimer = false;
    try { hasTimer = !!window.__adsAutoTimer; } catch (_) { hasTimer = false; }
    if (!hasTimer) {
      try {
        window.__adsAutoTimer = setInterval(function () {
          try {
            if (document.visibilityState !== 'visible') return;
            var panel = document.getElementById('tab-panel-ads');
            if (panel && panel.classList && !panel.classList.contains('active')) return;
            // Silent refresh: patch spend/profit/ROAS in-place (no table wipe).
            refresh({ force: false });
          } catch (_) {}
        }, AUTO_REFRESH_MS);
      } catch (_) {}
    }
    return refresh({ force: false });
  };
})();
