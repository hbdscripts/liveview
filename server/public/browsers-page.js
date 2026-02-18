(function () {
  'use strict';

  if (!document.body || document.body.getAttribute('data-page') !== 'browsers') return;
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('browsers', { page: 'browsers' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('browsers', 'init', { page: 'browsers' }); } catch (_) {}

  var API = '';
  try {
    if (typeof window !== 'undefined' && window.API) API = String(window.API || '');
  } catch (_) {}

  var chartInstance = null;
  var lastRange = null;

  function escapeHtml(value) {
    if (value == null) return '';
    var div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML.replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtInt(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '\u2014';
    return Math.max(0, Math.trunc(n)).toLocaleString('en-GB');
  }

  function fmtMoneyGbp2(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '\u2014';
    try { return '\u00A3' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return '\u00A3' + n.toFixed(2); }
  }

  function fmtMoneyGbp0(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '\u2014';
    try { return '\u00A3' + n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); } catch (_) { return '\u00A3' + String(Math.round(n)); }
  }

  function fmtPct1(value) {
    if (value == null) return '\u2014';
    var n = Number(value);
    if (!Number.isFinite(n)) return '\u2014';
    return n.toFixed(1) + '%';
  }

  function normalizeRangeKeyForApi(key) {
    var k = (key == null ? '' : String(key)).trim();
    if (!k) return 'today';
    var lc = k.toLowerCase();
    if (lc === '7days') return '7d';
    if (lc === '14days') return '14d';
    if (lc === '30days') return '30d';
    return k;
  }

  function currentRangeKey() {
    try {
      var sel = document.getElementById('global-date-select');
      if (sel && sel.value) return normalizeRangeKeyForApi(sel.value);
    } catch (_) {}
    try {
      if (typeof dateRange !== 'undefined' && dateRange) return normalizeRangeKeyForApi(dateRange);
    } catch (_) {}
    return 'today';
  }

  function browserLabel(key) {
    var k = key == null ? '' : String(key).trim().toLowerCase();
    if (!k) return 'Unknown';
    var names = {
      chrome: 'Chrome',
      safari: 'Safari',
      edge: 'Edge',
      firefox: 'Firefox',
      opera: 'Opera',
      ie: 'Internet Explorer',
      samsung: 'Samsung Internet',
      other: 'Other',
      unknown: 'Unknown',
    };
    if (names[k]) return names[k];
    return k.slice(0, 1).toUpperCase() + k.slice(1);
  }

  function setUpdated(label) {
    var el = document.getElementById('browsers-updated');
    if (!el) return;
    el.textContent = label || 'Updated \u2014';
  }

  function renderLegend(series) {
    var el = document.getElementById('browsers-legend');
    if (!el) return;
    if (!Array.isArray(series) || !series.length) {
      el.innerHTML = '<div class="text-secondary small">No browser data found for this range.</div>';
      return;
    }
    el.innerHTML = series.map(function (s) {
      var key = s && s.key != null ? String(s.key) : '';
      var label = browserLabel(key);
      return '' +
        '<span class="badge bg-dark-lt border-0 d-inline-flex align-items-center gap-2" data-browser-key="' + escapeHtml(key) + '">' +
          '<span>' + escapeHtml(label) + '</span>' +
        '</span>';
    }).join('');
  }

  function renderChart(payload) {
    var el = document.getElementById('browsers-chart');
    if (!el) return;

    if (chartInstance) {
      try { chartInstance.destroy(); } catch (_) {}
      chartInstance = null;
    }

    var categories = payload && Array.isArray(payload.categories) ? payload.categories : [];
    var rawSeries = payload && Array.isArray(payload.series) ? payload.series : [];
    if (!categories.length || !rawSeries.length) {
      el.innerHTML = '<div class="text-secondary">No revenue data for this range.</div>';
      return;
    }

    var series = rawSeries.map(function (s) {
      var key = s && s.key != null ? String(s.key) : '';
      var name = browserLabel(key);
      var data = Array.isArray(s.data) ? s.data.map(function (v) { return Number(v) || 0; }) : [];
      return { key: key, name: name, data: data };
    });

    var colours = [
      '#206bc4', '#4299e1', '#2fb344', '#f59f00',
      '#d63939', '#ae3ec9', '#0ca678', '#f06595',
    ];

    renderLegend(series);

    var opts = {
      chart: {
        type: 'line',
        height: 320,
        toolbar: { show: false },
        animations: { enabled: true },
      },
      series: series.map(function (s) { return { name: s.name, data: s.data }; }),
      xaxis: {
        categories: categories,
        labels: {
          formatter: function (v) {
            try {
              if (typeof formatYmdShort === 'function') return formatYmdShort(String(v || ''));
            } catch (_) {}
            return String(v || '');
          }
        }
      },
      yaxis: {
        labels: {
          formatter: function (v) { return fmtMoneyGbp0(v); }
        }
      },
      colors: colours,
      stroke: { curve: 'smooth', width: 2 },
      markers: { size: 0 },
      grid: { strokeDashArray: 4 },
      legend: { show: false },
      tooltip: {
        y: {
          formatter: function (v) { return fmtMoneyGbp2(v); }
        }
      }
    };

    try {
      chartInstance = new ApexCharts(el, opts);
      chartInstance.render();
    } catch (err) {
      try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'browsers.chart.render' }); } catch (_) {}
      el.innerHTML = '<div class="text-danger">Failed to render chart.</div>';
    }
  }

  function renderTable(payload) {
    var body = document.getElementById('browsers-body');
    if (!body) return;
    var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No sessions found for this range.</div></div>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var key = r && r.ua_browser != null ? String(r.ua_browser) : '';
      var label = browserLabel(key);
      return '' +
        '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell">' + escapeHtml(label) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtInt(r.sessions)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtInt(r.carts)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtInt(r.orders)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtPct1(r.cr)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtMoneyGbp2(r.vpv)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtMoneyGbp2(r.revenue)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtMoneyGbp2(r.aov)) + '</div>' +
        '</div>';
    }).join('');
  }

  function fetchJsonSafe(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .catch(function () { return null; });
  }

  function setLoading() {
    var chartEl = document.getElementById('browsers-chart');
    if (chartEl) chartEl.innerHTML = '<div class="text-secondary">Loading…</div>';
    var legendEl = document.getElementById('browsers-legend');
    if (legendEl) legendEl.innerHTML = '';
    var body = document.getElementById('browsers-body');
    if (body) body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">Loading…</div></div>';
  }

  function load() {
    var range = currentRangeKey();
    if (!range) range = 'today';
    if (range === lastRange) {
      try { setUpdated('Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } catch (_) {}
      return;
    }
    lastRange = range;

    setLoading();
    setUpdated('Updated \u2014');

    var qs = 'range=' + encodeURIComponent(String(range));
    var urlSeries = API + '/api/browsers/series?' + qs;
    var urlTable = API + '/api/browsers/table?' + qs;

    return Promise.all([fetchJsonSafe(urlSeries), fetchJsonSafe(urlTable)]).then(function (parts) {
      var seriesPayload = parts && parts[0] ? parts[0] : null;
      var tablePayload = parts && parts[1] ? parts[1] : null;
      if (!seriesPayload || !seriesPayload.ok) {
        var chartEl = document.getElementById('browsers-chart');
        if (chartEl) chartEl.innerHTML = '<div class="text-danger">Failed to load series.</div>';
      } else {
        renderChart(seriesPayload);
      }
      if (!tablePayload || !tablePayload.ok) {
        var body = document.getElementById('browsers-body');
        if (body) body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all text-danger" role="cell">Failed to load table.</div></div>';
      } else {
        renderTable(tablePayload);
      }
      try { setUpdated('Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } catch (_) {}
    }).catch(function (err) {
      try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'browsers.load' }); } catch (_) {}
      var chartEl = document.getElementById('browsers-chart');
      if (chartEl) chartEl.innerHTML = '<div class="text-danger">Failed to load browsers.</div>';
      var body = document.getElementById('browsers-body');
      if (body) body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all text-danger" role="cell">Failed to load browsers.</div></div>';
    });
  }

  function bind() {
    var sel = document.getElementById('global-date-select');
    if (sel && sel.getAttribute('data-browsers-bound') !== '1') {
      sel.setAttribute('data-browsers-bound', '1');
      sel.addEventListener('change', function () {
        setTimeout(function () { load(); }, 0);
      });
    }
  }

  bind();
  load();
})();

