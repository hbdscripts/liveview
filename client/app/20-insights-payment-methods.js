// Insights → Payment Methods (back-compat route: /insights/payment-types)
(function () {
  'use strict';

  try {
    const page = String(PAGE || '').trim().toLowerCase();
    if (page !== 'payment-types') return;
  } catch (_) { return; }

  // Single-init guard (avoid repeated bindings in embed reloads).
  try {
    if (document && document.documentElement && document.documentElement.getAttribute('data-kexo-payment-methods-init') === '1') return;
    if (document && document.documentElement) document.documentElement.setAttribute('data-kexo-payment-methods-init', '1');
  } catch (_) {}

  function escapeHtml(value) {
    if (value == null) return '';
    try {
      const div = document.createElement('div');
      div.textContent = String(value);
      return div.innerHTML.replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
    } catch (_) {
      return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  }

  function fmtInt(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.max(0, Math.trunc(n)).toLocaleString('en-GB');
  }

  function fmtMoneyGbp2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    try { return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return '£' + n.toFixed(2); }
  }

  function fmtPct1(value) {
    if (value == null) return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(1) + '%';
  }

  function normalizeRangeKeyForApi(key) {
    const k = (key == null ? '' : String(key)).trim();
    if (!k) return 'today';
    const lc = k.toLowerCase();
    if (lc === '7days') return '7d';
    if (lc === '14days') return '14d';
    if (lc === '30days') return '30d';
    return k;
  }

  function currentRangeKey() {
    try {
      const sel = document.getElementById('global-date-select');
      if (sel && sel.value) return normalizeRangeKeyForApi(sel.value);
    } catch (_) {}
    try {
      if (typeof dateRange !== 'undefined' && dateRange) return normalizeRangeKeyForApi(dateRange);
    } catch (_) {}
    return 'today';
  }

  function setUpdated(label) {
    const el = document.getElementById('payment-methods-updated');
    if (!el) return;
    el.textContent = label || 'Updated —';
  }

  function setTableMessage(message, isError) {
    const body = document.getElementById('payment-types-body');
    if (!body) return;
    const msg = String(message || '—');
    body.innerHTML =
      '<div class="grid-row" role="row">' +
        '<div class="grid-cell empty span-all' + (isError ? ' text-danger' : '') + '" role="cell">' + escapeHtml(msg) + '</div>' +
      '</div>';
  }

  function setChartMessage(message, isError) {
    const el = document.getElementById('payment-methods-chart');
    if (!el) return;
    el.innerHTML = '<div class="' + (isError ? 'text-danger' : 'text-secondary') + '">' + escapeHtml(message || '—') + '</div>';
  }

  function renderPaymentIconOnly(iconSpec, iconSrc, iconAlt, label) {
    const safeLabel = label != null ? String(label) : 'Other';
    const safeAlt = iconAlt != null ? String(iconAlt) : safeLabel;
    const spec = iconSpec != null ? String(iconSpec).trim() : '';
    const url = iconSrc != null ? String(iconSrc).trim() : '';
    if (spec) {
      if (/^<svg[\s>]/i.test(spec)) return '<span class="kexo-payment-method-icon kexo-payment-method-icon--fill" aria-hidden="true">' + spec + '</span>';
      if (/^(https?:\/\/|\/\/|\/)/i.test(spec)) return '<img class="kexo-payment-method-icon kexo-payment-method-icon--fill" src="' + escapeHtml(spec) + '" alt="' + escapeHtml(safeAlt) + '" loading="lazy" />';
      return '<i class="' + escapeHtml(spec) + ' kexo-payment-method-fallback-icon" aria-hidden="true"></i>';
    }
    return url
      ? '<img class="kexo-payment-method-icon kexo-payment-method-icon--fill" src="' + escapeHtml(url) + '" alt="' + escapeHtml(safeAlt) + '" loading="lazy" />'
      : '<i class="fa-light fa-circle-question text-secondary kexo-payment-method-fallback-icon" aria-hidden="true"></i>';
  }

  function renderPaymentCell(iconSpec, iconSrc, iconAlt, label) {
    const safeLabel = label != null ? String(label) : 'Other';
    const iconInner = renderPaymentIconOnly(iconSpec, iconSrc, iconAlt, safeLabel);
    return '<span class="d-inline-flex align-items-center gap-2">' + iconInner + '<span>' + escapeHtml(safeLabel) + '</span></span>';
  }

  const CHART_KEY = 'payment-methods-chart';
  let lastPayload = null;
  let inFlight = null;
  let reqSeq = 0;

  function renderChart(payload) {
    const el = document.getElementById('payment-methods-chart');
    if (!el) return;

    const categoriesRaw = payload && Array.isArray(payload.categories) ? payload.categories : [];
    const seriesRaw = payload && Array.isArray(payload.series) ? payload.series : [];
    if (!categoriesRaw.length || !seriesRaw.length) {
      setChartMessage('No revenue data for this range.', false);
      return;
    }

    const categories = categoriesRaw.map(function (v) {
      try {
        const s = String(v || '');
        // Only apply date formatter to YYYY-MM-DD categories; hourly buckets are already formatted.
        if (/^\d{4}-\d{2}-\d{2}/.test(s) && typeof formatYmdShort === 'function') return formatYmdShort(s);
      } catch (_) {}
      return String(v || '');
    });

    const series = seriesRaw.map(function (s) {
      const name = s && s.label != null ? String(s.label) : (s && s.key != null ? String(s.key) : '—');
      const data = Array.isArray(s && s.data) ? s.data.map(function (v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }) : [];
      return { name: name, data: data };
    });

    const enabled = (typeof isChartEnabledByUiConfig === 'function') ? isChartEnabledByUiConfig(CHART_KEY, true) : true;
    if (!enabled) {
      try {
        if (el.__kexoChartInstance) {
          try { el.__kexoChartInstance.destroy(); } catch (_) {}
          el.__kexoChartInstance = null;
        }
      } catch (_) {}
      el.innerHTML = '';
      return;
    }

    const rawMode = (typeof chartModeFromUiConfig === 'function') ? (chartModeFromUiConfig(CHART_KEY, 'line') || 'line') : 'line';
    const showEndLabels = rawMode === 'multi-line-labels';
    const mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
    const palette = (typeof chartColorsFromUiConfig === 'function')
      ? chartColorsFromUiConfig(CHART_KEY, ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e', '#0ea5e9', '#a3e635'])
      : ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e', '#0ea5e9', '#a3e635'];

    try {
      if (typeof window.kexoRenderApexChart === 'function') {
        window.kexoRenderApexChart({
          chartKey: CHART_KEY,
          containerEl: el,
          categories: categories,
          series: series,
          mode: mode,
          colors: palette,
          height: 320,
          showEndLabels: showEndLabels,
          currency: true,
          chartStyle: (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(CHART_KEY) : null,
          advancedApexOverride: (typeof chartAdvancedOverrideFromUiConfig === 'function') ? chartAdvancedOverrideFromUiConfig(CHART_KEY, mode) : {},
        });
      } else {
        setChartMessage('Chart unavailable.', true);
      }
    } catch (_) {
      setChartMessage('Failed to render chart.', true);
    }
  }

  function renderTable(payload) {
    const body = document.getElementById('payment-types-body');
    if (!body) return;
    const rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      setTableMessage('No payment methods for this range.', false);
      return;
    }
    body.innerHTML = rows.map(function (r) {
      const key = r && r.key != null ? String(r.key) : '';
      const label = r && r.label != null ? String(r.label) : 'Other';
      const iconSpec = r && r.iconSpec != null ? String(r.iconSpec) : '';
      const iconSrc = r && r.iconSrc ? String(r.iconSrc) : '';
      const iconAlt = r && r.iconAlt ? String(r.iconAlt) : label;
      const payCell = renderPaymentCell(iconSpec, iconSrc, iconAlt, label);
      const iconCell = '<span class="d-flex align-items-center justify-content-center w-100 h-100">' + renderPaymentIconOnly(iconSpec, iconSrc, iconAlt, label) + '</span>';
      return '' +
        '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell">' + payCell + '</div>' +
          '<div class="grid-cell kexo-payments-icon-col kexo-payment-method-icon-cell" role="cell">' + iconCell + '</div>' +
          '<div class="grid-cell text-center" role="cell">' + escapeHtml(fmtInt(r.sessions)) + '</div>' +
          '<div class="grid-cell text-end" role="cell">' + escapeHtml(fmtInt(r.carts)) + '</div>' +
          '<div class="grid-cell text-end" role="cell">' + escapeHtml(fmtInt(r.orders)) + '</div>' +
          '<div class="grid-cell text-end" role="cell">' + escapeHtml(fmtPct1(r.cr)) + '</div>' +
          '<div class="grid-cell text-end" role="cell">' + escapeHtml(fmtMoneyGbp2(r.vpv)) + '</div>' +
          '<div class="grid-cell text-end" role="cell">' + escapeHtml(fmtMoneyGbp2(r.revenue)) + '</div>' +
          '<div class="grid-cell text-end" role="cell">' + escapeHtml(fmtMoneyGbp2(r.aov)) + '</div>' +
        '</div>';
    }).join('');
  }

  function load(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const force = !!opts.force;
    const range = currentRangeKey() || 'today';
    const seq = ++reqSeq;
    setUpdated('Updated —');
    setChartMessage('Loading…', false);
    setTableMessage('Loading…', false);

    const url = API + '/api/payment-methods/report?range=' + encodeURIComponent(String(range)) + (force ? ('&_=' + Date.now()) : '');
    const fetcher = (typeof fetchWithTimeout === 'function')
      ? fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 20000)
      : fetch(url, { credentials: 'same-origin', cache: 'no-store' });

    inFlight = Promise.resolve(fetcher)
      .then(function (r) { return (r && r.ok) ? r.json().catch(function () { return null; }) : null; })
      .then(function (data) {
        if (seq !== reqSeq) return null;
        if (!data || !data.ok) {
          setChartMessage('Failed to load payment methods.', true);
          setTableMessage('Failed to load payment methods.', true);
          return null;
        }
        lastPayload = data;
        renderChart(data);
        renderTable(data);
        try { setUpdated('Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); } catch (_) {}
        return data;
      })
      .catch(function () {
        if (seq !== reqSeq) return null;
        setChartMessage('Failed to load payment methods.', true);
        setTableMessage('Failed to load payment methods.', true);
        return null;
      })
      .finally(function () {
        if (inFlight && seq === reqSeq) inFlight = null;
      });

    return inFlight;
  }

  function bind() {
    const sel = document.getElementById('global-date-select');
    if (sel && sel.getAttribute('data-payment-methods-bound') !== '1') {
      sel.setAttribute('data-payment-methods-bound', '1');
      sel.addEventListener('change', function () { setTimeout(function () { load({ force: true }); }, 0); });
    }

    try {
      if (window && window.addEventListener) {
        window.addEventListener('kexo:chartsUiConfigUpdated', function () {
          if (!lastPayload) return;
          try { renderChart(lastPayload); } catch (_) {}
        });
      }
    } catch (_) {}
  }

  bind();
  load({ force: false });
})();

