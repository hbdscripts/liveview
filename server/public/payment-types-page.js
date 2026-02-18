(function () {
  'use strict';

  if (!document.body || document.body.getAttribute('data-page') !== 'payment-types') return;
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('payment-types', { page: 'payment-types' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('payment-types', 'init', { page: 'payment-types' }); } catch (_) {}

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

  function providerLabel(key) {
    try {
      var meta = (typeof paymentProviderMeta === 'function') ? paymentProviderMeta(key) : null;
      if (meta && meta.label) return String(meta.label);
    } catch (_) {}
    var k = key == null ? '' : String(key);
    return k ? k : 'unknown';
  }

  function paymentIconHtml(key, sizeClass) {
    var cls = '';
    try { cls = (typeof tablerPaymentClassName === 'function') ? tablerPaymentClassName(key) : ''; } catch (_) { cls = ''; }
    if (!cls) return '';
    var label = providerLabel(key);
    return '<span class="' + escapeHtml(cls) + ' ' + escapeHtml(sizeClass || 'payment-xs') + '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '"></span>';
  }

  function setUpdated(label) {
    var el = document.getElementById('payment-types-updated');
    if (!el) return;
    el.textContent = label || 'Updated \u2014';
  }

  function renderLegend(series) {
    var el = document.getElementById('payment-types-legend');
    if (!el) return;
    if (!Array.isArray(series) || !series.length) {
      el.innerHTML = '<div class="text-secondary small">No payment types found for this range.</div>';
      return;
    }
    el.innerHTML = series.map(function (s) {
      var key = s && s.key != null ? String(s.key) : '';
      var label = providerLabel(key);
      var icon = paymentIconHtml(key, 'payment-xxs');
      return '' +
        '<span class="badge bg-dark-lt border-0 d-inline-flex align-items-center gap-2 kexo-payment-legend-item" data-payment-key="' + escapeHtml(key) + '">' +
          (icon ? icon : '') +
          '<span>' + escapeHtml(label) + '</span>' +
        '</span>';
    }).join('');
  }

  function renderChart(payload) {
    var el = document.getElementById('payment-types-chart');
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
      var name = providerLabel(key);
      var data = Array.isArray(s.data) ? s.data.map(function (v) { return Number(v) || 0; }) : [];
      return { key: key, name: name, data: data };
    });

    renderLegend(series);

    var colours = [
      '#206bc4', '#4299e1', '#2fb344', '#f59f00',
      '#d63939', '#ae3ec9', '#0ca678', '#f06595',
    ];

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
      try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'paymentTypes.chart.render' }); } catch (_) {}
      el.innerHTML = '<div class="text-danger">Failed to render chart.</div>';
    }
  }

  function renderTable(payload) {
    var body = document.getElementById('payment-types-body');
    if (!body) return;
    var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      body.innerHTML = '<tr><td class="text-secondary" colspan="8">No orders found for this range.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var key = r && r.payment_gateway != null ? String(r.payment_gateway) : '';
      var label = providerLabel(key);
      var icon = paymentIconHtml(key, 'payment-xxs');
      var payCell = '<span class="d-inline-flex align-items-center gap-2">' +
        (icon ? icon : '') +
        '<span>' + escapeHtml(label) + '</span>' +
      '</span>';
      return '' +
        '<tr>' +
          '<td>' + payCell + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtInt(r.sessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtInt(r.carts)) + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtInt(r.orders)) + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtPct1(r.cr)) + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtMoneyGbp2(r.vpv)) + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtMoneyGbp2(r.revenue)) + '</td>' +
          '<td class="text-end">' + escapeHtml(fmtMoneyGbp2(r.aov)) + '</td>' +
        '</tr>';
    }).join('');
  }

  function fetchJsonSafe(url) {
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; })
      .catch(function () { return null; });
  }

  function setLoading() {
    var chartEl = document.getElementById('payment-types-chart');
    if (chartEl) chartEl.innerHTML = '<div class="text-secondary">Loading…</div>';
    var legendEl = document.getElementById('payment-types-legend');
    if (legendEl) legendEl.innerHTML = '';
    var body = document.getElementById('payment-types-body');
    if (body) body.innerHTML = '<tr><td class="text-secondary" colspan="8">Loading…</td></tr>';
  }

  function load() {
    var range = currentRangeKey();
    if (!range) range = 'today';
    if (range === lastRange) {
      // Still update the label (date picker can change its label without changing range key).
      try { setUpdated('Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } catch (_) {}
      return;
    }
    lastRange = range;

    setLoading();
    setUpdated('Updated \u2014');

    var qs = 'range=' + encodeURIComponent(String(range));
    var urlSeries = API + '/api/payment-types/series?' + qs;
    var urlTable = API + '/api/payment-types/table?' + qs;

    return Promise.all([fetchJsonSafe(urlSeries), fetchJsonSafe(urlTable)]).then(function (parts) {
      var seriesPayload = parts && parts[0] ? parts[0] : null;
      var tablePayload = parts && parts[1] ? parts[1] : null;
      if (!seriesPayload || !seriesPayload.ok) {
        var chartEl = document.getElementById('payment-types-chart');
        if (chartEl) chartEl.innerHTML = '<div class="text-danger">Failed to load series.</div>';
      } else {
        renderChart(seriesPayload);
      }
      if (!tablePayload || !tablePayload.ok) {
        var body = document.getElementById('payment-types-body');
        if (body) body.innerHTML = '<tr><td class="text-danger" colspan="8">Failed to load table.</td></tr>';
      } else {
        renderTable(tablePayload);
      }
      try { setUpdated('Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } catch (_) {}
    }).catch(function (err) {
      try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'paymentTypes.load' }); } catch (_) {}
      var chartEl = document.getElementById('payment-types-chart');
      if (chartEl) chartEl.innerHTML = '<div class="text-danger">Failed to load payment types.</div>';
      var body = document.getElementById('payment-types-body');
      if (body) body.innerHTML = '<tr><td class="text-danger" colspan="8">Failed to load payment types.</td></tr>';
    });
  }

  function bind() {
    var sel = document.getElementById('global-date-select');
    if (sel && sel.getAttribute('data-payment-types-bound') !== '1') {
      sel.setAttribute('data-payment-types-bound', '1');
      sel.addEventListener('change', function () {
        // syncDateSelectOptions() may run after the change; give it one tick.
        setTimeout(function () { load(); }, 0);
      });
    }
  }

  bind();
  load();
})();

