/**
 * KEXO shared chart builder — single source of truth for chart rendering.
 * All ApexCharts and map charts should use these builders.
 */
(function () {
  'use strict';

  // ApexCharts 4.x can render markers but hide strokes if stroke.show defaults false
  // (or if vendor scripts tweak defaults). Enforce visible strokes by default.
  try {
    if (typeof window !== 'undefined') {
      window.Apex = window.Apex || {};
      window.Apex.stroke = window.Apex.stroke || {};
      if (window.Apex.stroke.show == null || window.Apex.stroke.show === false) {
        window.Apex.stroke.show = true;
      }
    }
  } catch (_) {}

  var APEX_MAX_RETRIES = 25;
  var APEX_RETRY_MS = 200;
  var DIMENSION_POLL_MS = 50;
  var DIMENSION_MAX_WAIT_MS = 5000;

  function escapeHtml(str) {
    if (str == null) return '';
    try {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    } catch (_) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  }

  /**
   * Ensure ApexCharts is loaded. Calls cb when ready, or gives up after APEX_MAX_RETRIES.
   * @param {function} cb - Callback when ApexCharts is available
   * @param {number} retries - Internal retry count
   */
  function ensureApexCharts(cb, retries) {
    if (typeof ApexCharts !== 'undefined') {
      try { cb(); } catch (_) {}
      return;
    }
    retries = typeof retries === 'number' ? retries : 0;
    if (retries >= APEX_MAX_RETRIES) {
      try {
        if (typeof window.kexoCaptureMessage === 'function') {
          window.kexoCaptureMessage('ApexCharts failed to load after retries', 'kexoChartBuilder', { retries: retries }, 'error');
        }
      } catch (_) {}
      return;
    }
    setTimeout(function () { ensureApexCharts(cb, retries + 1); }, APEX_RETRY_MS);
  }

  /**
   * Wait until container has non-zero dimensions (fixes "data with no visuals" when chart
   * renders in hidden/collapsed modal or before layout).
   * @param {HTMLElement} el - Container element
   * @param {function} cb - Callback when dimensions are ready
   * @param {number} maxWaitMs - Max wait in ms (default DIMENSION_MAX_WAIT_MS)
   */
  function waitForContainerDimensions(el, cb, maxWaitMs) {
    if (!el || typeof cb !== 'function') return;
    maxWaitMs = typeof maxWaitMs === 'number' && maxWaitMs > 0 ? maxWaitMs : DIMENSION_MAX_WAIT_MS;
    var start = Date.now();

    function check() {
      try {
        var w = el.offsetWidth || 0;
        var h = el.offsetHeight || 0;
        if (w > 0 && h > 0) {
          cb();
          return;
        }
        if (Date.now() - start >= maxWaitMs) {
          cb();
          return;
        }
        setTimeout(check, DIMENSION_POLL_MS);
      } catch (_) {
        cb();
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      try {
        var ro = new ResizeObserver(function () {
          var w = el.offsetWidth || 0;
          var h = el.offsetHeight || 0;
          if (w > 0 && h > 0) {
            try { ro.disconnect(); } catch (_) {}
            cb();
          }
        });
        ro.observe(el);
        setTimeout(function () {
          try {
            var w = el.offsetWidth || 0;
            var h = el.offsetHeight || 0;
            if (w > 0 && h > 0) {
              ro.disconnect();
              cb();
            }
          } catch (_) {}
        }, 0);
        setTimeout(function () {
          try { ro.disconnect(); } catch (_) {}
          cb();
        }, maxWaitMs);
        return;
      } catch (_) {}
    }
    check();
  }

  /**
   * Normalize chart type for ApexCharts (multi-line-labels -> line).
   */
  function normalizeChartType(value, fallback) {
    var v = String(value || '').trim().toLowerCase();
    if (v === 'multi-line-labels') return 'line';
    if (['area', 'line', 'bar', 'pie'].indexOf(v) >= 0) return v;
    return fallback || 'line';
  }

  /**
   * Render an ApexCharts line/area/bar chart with canonical data shape.
   * config: { chartKey, containerEl, categories, series, mode?, colors?, height?, pct?, currency?, showEndLabels?, splitLayout?, legendEl?, onError? }
   * series: [{ name, data }]
   */
  function renderKexoApexChart(config) {
    var c = config || {};
    var chartKey = c.chartKey || '';
    var el = c.containerEl;
    var categories = Array.isArray(c.categories) ? c.categories : [];
    var series = Array.isArray(c.series) ? c.series : [];
    var mode = c.mode || 'line';
    var colors = Array.isArray(c.colors) ? c.colors : ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444'];
    var height = typeof c.height === 'number' ? c.height : 320;
    var pct = !!c.pct;
    var currency = !!c.currency;
    var showEndLabels = !!c.showEndLabels;
    var splitLayout = !!c.splitLayout;
    var legendEl = c.legendEl || null;
    var onError = typeof c.onError === 'function' ? c.onError : null;

    if (!el) return null;

    var def = (window.KEXO_CHART_DEFS && window.KEXO_CHART_DEFS[chartKey]) || {};
    height = typeof def.height === 'number' ? def.height : height;

    var chartType = normalizeChartType(mode, 'line');
    var apexSeries = series.map(function (s) {
      var data = Array.isArray(s && s.data) ? s.data : [];
      return { name: (s && s.name) || '—', data: data.map(function (v) { var n = Number(v); return isFinite(n) ? n : 0; }) };
    });

    var yFmt = pct ? function (v) { return v != null ? Number(v).toFixed(1) + '%' : '—'; }
      : currency ? function (v) { return v != null ? ('£' + Number(v).toLocaleString()) : '—'; }
      : function (v) { return v != null ? Number(v).toLocaleString() : '—'; };

    // ApexCharts 4.x can zero out stroke alpha when fill opacity is 0 for line charts.
    // Keep opacity at 1; line charts still render without an area fill.
    var fillConfig = chartType === 'line' ? { type: 'solid', opacity: 1 }
      : chartType === 'bar' ? { type: 'solid', opacity: 1 }
      : { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.15, opacityTo: 0.02, stops: [0, 100] } };

    var apexOpts = {
      chart: {
        type: chartType,
        height: height,
        fontFamily: 'Inter, sans-serif',
        toolbar: { show: false },
        animations: { enabled: true },
        zoom: { enabled: false },
      },
      series: apexSeries,
      colors: colors,
      stroke: { show: true, width: chartType === 'bar' ? 0 : 2.6, curve: 'smooth', lineCap: 'round' },
      fill: fillConfig,
      plotOptions: chartType === 'bar' ? { bar: { columnWidth: '62%', borderRadius: 3 } } : {},
      xaxis: {
        categories: categories,
        labels: { style: { fontSize: '10px' }, hideOverlappingLabels: true },
        axisBorder: { show: false },
        axisTicks: { show: false },
      },
      yaxis: {
        labels: { formatter: yFmt },
        min: 0,
        forceNiceScale: true,
      },
      grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
      tooltip: { y: { formatter: yFmt } },
      legend: { show: apexSeries.length > 1, position: 'top', fontSize: '11px' },
      dataLabels: (showEndLabels && chartType === 'line') ? { enabled: true } : { enabled: false },
      markers: { size: chartType === 'line' ? 4 : 0, hover: { size: 6 } },
      noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } },
    };

    var instance = null;
    ensureApexCharts(function () {
      waitForContainerDimensions(el, function () {
        try {
          if (el.__kexoChartInstance) {
            try { el.__kexoChartInstance.destroy(); } catch (_) {}
            el.__kexoChartInstance = null;
          }
          el.innerHTML = '';
          instance = new ApexCharts(el, apexOpts);
          instance.render();
          el.__kexoChartInstance = instance;
        } catch (err) {
          if (onError) onError(err);
          else if (typeof window.kexoCaptureError === 'function') {
            window.kexoCaptureError(err, { context: 'kexoChartBuilder', chartKey: chartKey });
          }
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:' + height + 'px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
      }, DIMENSION_MAX_WAIT_MS);
    });

    return instance;
  }

  /**
   * Render a sparkline (ApexCharts line, sparkline mode).
   * config: { containerEl, data, color?, height? }
   */
  function renderKexoSparkline(config) {
    var c = config || {};
    var el = c.containerEl;
    var data = Array.isArray(c.data) ? c.data : [];
    var color = c.color || '#3eb3ab';
    var height = typeof c.height === 'number' ? c.height : 30;

    if (!el) return null;
    if (data.length < 2) data = data.length === 1 ? [data[0], data[0]] : [0, 0];

    var instance = null;
    ensureApexCharts(function () {
      try {
        if (el.__kexoChartInstance) {
          try { el.__kexoChartInstance.destroy(); } catch (_) {}
          el.__kexoChartInstance = null;
        }
        el.innerHTML = '';
        instance = new ApexCharts(el, {
          chart: { type: 'line', height: height, sparkline: { enabled: true }, animations: { enabled: false } },
          series: [{ data: data }],
          stroke: { width: 2.15, curve: 'smooth', lineCap: 'round' },
          fill: { type: 'solid', opacity: 1 },
          colors: [color],
          markers: { size: 0 },
          grid: { padding: { top: 0, right: 0, bottom: -2, left: 0 } },
          tooltip: { enabled: false },
        });
        instance.render();
        el.__kexoChartInstance = instance;
      } catch (_) {}
    });

    return instance;
  }

  window.kexoEnsureApexCharts = ensureApexCharts;
  window.kexoWaitForContainerDimensions = waitForContainerDimensions;
  window.kexoRenderApexChart = renderKexoApexChart;
  window.kexoRenderSparkline = renderKexoSparkline;
  window.kexoNormalizeChartType = normalizeChartType;
  window.kexoChartBuilderEscapeHtml = escapeHtml;
})();
