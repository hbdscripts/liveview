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
    var done = false;
    var ro = null;
    var t0 = null;
    var tMax = null;

    function cleanup() {
      try { if (t0) clearTimeout(t0); } catch (_) {}
      try { if (tMax) clearTimeout(tMax); } catch (_) {}
      t0 = null;
      tMax = null;
      try { if (ro) ro.disconnect(); } catch (_) {}
      ro = null;
    }

    function finish() {
      if (done) return;
      done = true;
      cleanup();
      try { cb(); } catch (_) {}
    }

    function check() {
      if (done) return;
      try {
        var w = el.offsetWidth || 0;
        var h = el.offsetHeight || 0;
        if (w > 0 && h > 0) {
          finish();
          return;
        }
        if (Date.now() - start >= maxWaitMs) {
          finish();
          return;
        }
        setTimeout(check, DIMENSION_POLL_MS);
      } catch (_) {
        finish();
      }
    }

    if (typeof ResizeObserver !== 'undefined') {
      try {
        ro = new ResizeObserver(function () {
          if (done) return;
          var w = el.offsetWidth || 0;
          var h = el.offsetHeight || 0;
          if (w > 0 && h > 0) {
            finish();
          }
        });
        ro.observe(el);
        t0 = setTimeout(function () {
          if (done) return;
          try {
            var w = el.offsetWidth || 0;
            var h = el.offsetHeight || 0;
            if (w > 0 && h > 0) {
              finish();
            }
          } catch (_) {}
        }, 0);
        tMax = setTimeout(function () { finish(); }, maxWaitMs);
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

  function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function deepMergeInto(target, patch) {
    if (!isPlainObject(target) || !isPlainObject(patch)) return target;
    Object.keys(patch).forEach(function (key) {
      var pv = patch[key];
      if (Array.isArray(pv)) {
        target[key] = pv.slice();
      } else if (isPlainObject(pv)) {
        if (!isPlainObject(target[key])) target[key] = {};
        deepMergeInto(target[key], pv);
      } else {
        target[key] = pv;
      }
    });
    return target;
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
    var advancedApexOverride = isPlainObject(c.advancedApexOverride) ? c.advancedApexOverride : {};

    if (!el) return null;

    var def = (window.KEXO_CHART_DEFS && window.KEXO_CHART_DEFS[chartKey]) || {};
    height = typeof def.height === 'number' ? def.height : height;

    var chartType = normalizeChartType(mode, 'line');
    var apexSeries = series.map(function (s) {
      var data = Array.isArray(s && s.data) ? s.data : [];
      return { name: (s && s.name) || '—', data: data.map(function (v) { var n = Number(v); return isFinite(n) ? n : 0; }) };
    });
    var pieLabels = [];
    var pieValues = [];
    if (chartType === 'pie') {
      apexSeries.forEach(function (s, idx) {
        pieLabels.push((s && s.name) ? String(s.name) : ('Series ' + String(idx + 1)));
        var v = Array.isArray(s && s.data) ? Number(s.data[0]) : Number(s && s.data);
        pieValues.push(Number.isFinite(v) ? v : 0);
      });
    }

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
    if (chartType === 'pie') {
      apexOpts.labels = pieLabels;
      apexOpts.series = pieValues;
      apexOpts.legend.show = true;
      apexOpts.dataLabels = { enabled: true };
      apexOpts.stroke = { show: false };
      apexOpts.yaxis = undefined;
      apexOpts.xaxis = undefined;
      apexOpts.tooltip = { y: { formatter: yFmt } };
    }
    if (advancedApexOverride && Object.keys(advancedApexOverride).length) {
      deepMergeInto(apexOpts, advancedApexOverride);
    }

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
    var compareData = Array.isArray(c.compareData) ? c.compareData : [];
    var showCompare = !!c.showCompare && compareData.length > 1;
    var color = c.color || '#3eb3ab';
    var compareColor = c.compareColor || '#cccccc';
    var height = typeof c.height === 'number' ? c.height : 30;
    var mode = normalizeChartType(c.mode || 'line', 'line');
    var curve = ['smooth', 'straight', 'stepline'].indexOf(String(c.curve || '').trim().toLowerCase()) >= 0
      ? String(c.curve).trim().toLowerCase() : 'smooth';
    var strokeWidth = Number(c.strokeWidth);
    if (!Number.isFinite(strokeWidth)) strokeWidth = 2.15;
    if (strokeWidth < 0.5) strokeWidth = 0.5;
    if (strokeWidth > 6) strokeWidth = 6;
    var advancedApexOverride = isPlainObject(c.advancedApexOverride) ? c.advancedApexOverride : {};

    if (!el) return null;
    if (data.length < 2) data = data.length === 1 ? [data[0], data[0]] : [0, 0];
    if (showCompare && compareData.length < data.length) {
      var fill = compareData.length ? compareData[compareData.length - 1] : 0;
      while (compareData.length < data.length) compareData.push(fill);
    }
    if (showCompare && compareData.length > data.length) compareData = compareData.slice(0, data.length);

    var instance = null;
    ensureApexCharts(function () {
      try {
        if (el.__kexoChartInstance) {
          try { el.__kexoChartInstance.destroy(); } catch (_) {}
          el.__kexoChartInstance = null;
        }
        el.innerHTML = '';
        var opts = {
          chart: { type: mode, height: height, sparkline: { enabled: true }, animations: { enabled: false } },
          series: showCompare ? [{ name: 'Current', data: data }, { name: 'Compare', data: compareData }] : [{ name: 'Current', data: data }],
          stroke: { width: showCompare ? [strokeWidth, Math.max(1, strokeWidth - 0.8)] : strokeWidth, curve: curve, lineCap: 'round', dashArray: showCompare ? [0, 5] : 0 },
          fill: mode === 'area' ? { type: 'solid', opacity: showCompare ? [0.22, 0] : 0.2 } : { type: 'solid', opacity: 1 },
          colors: showCompare ? [color, compareColor] : [color],
          markers: { size: 0 },
          grid: { padding: { top: 0, right: 0, bottom: -2, left: 0 } },
          tooltip: { enabled: false },
          legend: { show: false }
        };
        if (mode === 'bar') {
          opts.stroke = { width: 0 };
          opts.fill = { type: 'solid', opacity: 0.9 };
          opts.plotOptions = { bar: { columnWidth: '62%', borderRadius: 2 } };
        }
        if (advancedApexOverride && Object.keys(advancedApexOverride).length) {
          deepMergeInto(opts, advancedApexOverride);
        }
        instance = new ApexCharts(el, opts);
        try { instance.render(); } catch (_) {}
        el.__kexoChartInstance = instance;
      } catch (_) {}
    });

    return instance;
  }

  function demoCategories() {
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  }

  function buildDemoSeriesForChart(chartKey, mode, pieMetric) {
    var key = String(chartKey || '').trim().toLowerCase();
    var metric = String(pieMetric || 'sessions').trim().toLowerCase();
    if (mode === 'pie') {
      if (key === 'channels-chart') {
        var channels = ['Direct', 'Email', 'Paid', 'Social', 'Organic'];
        var valuesByMetric = {
          sessions: [230, 180, 120, 90, 75],
          orders: [34, 28, 19, 13, 10],
          revenue: [6400, 5300, 4200, 2700, 2100],
        };
        var arr = valuesByMetric[metric] || valuesByMetric.sessions;
        return channels.map(function (name, idx) {
          return { name: name, data: [Number(arr[idx] || 0)] };
        });
      }
      if (key === 'type-chart') {
        var device = ['Mobile', 'Desktop', 'Tablet'];
        var deviceByMetric = {
          sessions: [320, 170, 55],
          orders: [42, 25, 7],
          revenue: [8600, 5900, 1300],
        };
        var vals = deviceByMetric[metric] || deviceByMetric.sessions;
        return device.map(function (name, idx) {
          return { name: name, data: [Number(vals[idx] || 0)] };
        });
      }
      if (key === 'products-chart') {
        return [
          { name: 'Charms', data: [5200] },
          { name: 'Necklaces', data: [4300] },
          { name: 'Bracelets', data: [3100] },
          { name: 'Earrings', data: [2500] }
        ];
      }
    }

    var categories = demoCategories();
    var base = [9, 12, 11, 14, 16, 15, 18];
    var scale = 1;
    if (key.indexOf('revenue') >= 0 || key.indexOf('adspend') >= 0 || key === 'sales-overview-chart') scale = 420;
    else if (key.indexOf('orders') >= 0) scale = 9;
    else if (key.indexOf('sessions') >= 0 || key === 'live-online-chart') scale = 36;
    else if (key.indexOf('conv') >= 0) scale = 0.8;

    var meta = (window.KEXO_CHART_DEFS && window.KEXO_CHART_DEFS[key]) || {};
    var names = Array.isArray(meta.series) && meta.series.length ? meta.series.slice(0, 6) : ['Series 1'];
    return names.map(function (name, idx) {
      var idxScale = 1 + (idx * 0.12);
      return {
        name: String(name || ('Series ' + String(idx + 1))),
        data: categories.map(function (seed, pointIdx) {
          void seed;
          var wobble = ((pointIdx % 2 === 0) ? 0.9 : 1.05);
          var raw = base[pointIdx] * idxScale * wobble * scale;
          if (scale <= 1) return Number((raw).toFixed(2));
          return Math.round(raw);
        })
      };
    });
  }

  function renderMapPreviewPlaceholder(containerEl, mode, color) {
    if (!containerEl) return;
    try {
      if (containerEl.__kexoChartInstance) {
        try { containerEl.__kexoChartInstance.destroy(); } catch (_) {}
        containerEl.__kexoChartInstance = null;
      }
    } catch (_) {}
    var accent = String(color || '#3eb3ab');
    var isAnimated = String(mode || '').trim().toLowerCase() === 'map-animated';
    containerEl.innerHTML = '' +
      '<div style="height:100%;min-height:150px;border:1px dashed #d7dde5;border-radius:6px;background:linear-gradient(180deg,#f8fbfe,#f3f7fb);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;">' +
        '<div style="position:absolute;inset:0;opacity:' + (isAnimated ? '0.22' : '0.12') + ';background:radial-gradient(circle at 20% 35%, ' + accent + ' 0 4px, transparent 5px),radial-gradient(circle at 36% 58%, ' + accent + ' 0 4px, transparent 5px),radial-gradient(circle at 57% 42%, ' + accent + ' 0 4px, transparent 5px),radial-gradient(circle at 74% 60%, ' + accent + ' 0 4px, transparent 5px);"></div>' +
        '<div style="font-size:12px;color:#5b6472;padding:0 10px;text-align:center;">Map preview (' + escapeHtml(isAnimated ? 'animated' : 'flat') + ')</div>' +
      '</div>';
  }

  function renderKexoChartPreview(config) {
    var c = config || {};
    var containerEl = c.containerEl;
    if (!containerEl) return null;
    var chartKey = String(c.chartKey || '').trim().toLowerCase();
    var mode = String(c.mode || '').trim().toLowerCase() || 'line';
    var colors = Array.isArray(c.colors) && c.colors.length ? c.colors : ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6'];
    if (mode === 'map-animated' || mode === 'map-flat') {
      renderMapPreviewPlaceholder(containerEl, mode, colors[0] || '#3eb3ab');
      return null;
    }
    var categories = demoCategories();
    var series = buildDemoSeriesForChart(chartKey, mode, c.pieMetric);
    return renderKexoApexChart({
      chartKey: chartKey,
      containerEl: containerEl,
      categories: categories,
      series: series,
      mode: mode,
      colors: colors,
      height: Number.isFinite(Number(c.height)) ? Number(c.height) : 220,
      advancedApexOverride: c.advancedApexOverride
    });
  }

  function renderKexoKpiSparklinePreview(config) {
    var c = config || {};
    var spark = c.sparkline && typeof c.sparkline === 'object' ? c.sparkline : {};
    var palette = c.palette && typeof c.palette === 'object' ? c.palette : {};
    var data = [8, 10, 9, 11, 14, 13, 16];
    var compare = [7, 8, 8, 9, 11, 11, 12];
    return renderKexoSparkline({
      containerEl: c.containerEl,
      data: data,
      compareData: compare,
      showCompare: !!spark.showCompare,
      color: palette.up || '#2fb344',
      compareColor: palette.compareLine || '#cccccc',
      mode: spark.mode || 'line',
      curve: spark.curve || 'smooth',
      strokeWidth: spark.strokeWidth,
      height: spark.height,
      advancedApexOverride: spark.advancedApexOverride
    });
  }

  window.kexoEnsureApexCharts = ensureApexCharts;
  window.kexoWaitForContainerDimensions = waitForContainerDimensions;
  window.kexoRenderApexChart = renderKexoApexChart;
  window.kexoRenderSparkline = renderKexoSparkline;
  window.kexoRenderChartPreview = renderKexoChartPreview;
  window.kexoRenderKpiSparklinePreview = renderKexoKpiSparklinePreview;
  window.kexoNormalizeChartType = normalizeChartType;
  window.kexoChartBuilderEscapeHtml = escapeHtml;
})();
