      var dashLastRangeKey = null;
      var dashLastDayYmd = null;
      var dashCompareSeriesCache = null;
      var dashCompareRangeKey = null;
      var dashCompareFetchedAt = 0;
      var dashCompareSeriesInFlight = null;
      var dashCharts = {};
      var overviewMiniResizeObserver = null;
      var overviewMiniResizeScheduled = false;
      var overviewMiniSizeSignature = '';
      var overviewMiniCache = null;
      var overviewMiniFetchedAt = 0;
      var overviewMiniInFlight = null;
      var overviewMiniCacheShopKey = '';
      var OVERVIEW_MINI_CACHE_MS = 2 * 60 * 1000;
      var _primaryRgbDash = getComputedStyle(document.documentElement).getPropertyValue('--tblr-primary-rgb').trim() || '32,107,196';
      var DASH_ACCENT = 'rgb(' + _primaryRgbDash + ')';
      var DASH_ACCENT_LIGHT = 'rgba(' + _primaryRgbDash + ',0.12)';
      var DASH_ORANGE = '#f59e0b';
      var DASH_ORANGE_LIGHT = 'rgba(245,158,11,0.10)';
      var DASH_BLUE = '#3b82f6';
      var DASH_BLUE_LIGHT = 'rgba(59,130,246,0.10)';
      var DASH_PURPLE = '#8b5cf6';
      var DASH_PURPLE_LIGHT = 'rgba(139,92,246,0.10)';

      function fmtGbp(n) {
        var v = (typeof n === 'number') ? n : Number(n);
        if (!isFinite(v)) return '\u2014';
        return formatRevenue(v) || '\u2014';
      }
      function fmtNum(n) { return n != null ? n.toLocaleString() : '\u2014'; }
      function fmtPct(n) { return n != null ? n.toFixed(1) + '%' : '\u2014'; }
      function shortDate(ymd) {
        var parts = ymd.split('-');
        var d = parseInt(parts[2], 10);
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        var m = months[parseInt(parts[1], 10) - 1] || '';
        return d + ' ' + m;
      }
      function shortHourLabel(key) {
        if (!key) return '';
        var s = String(key);
        var idx = s.indexOf(' ');
        if (idx >= 0) return s.slice(idx + 1);
        return s;
      }
      function ymdInAdminTzFromMs(ms) {
        var n = Number(ms);
        if (!Number.isFinite(n)) return null;
        try {
          return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(n));
        } catch (_) {
          try {
            return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(n));
          } catch (_) {
            return null;
          }
        }
      }
      function compareRangeKeyFromKpiPayload(kpiObj) {
        var cmp = kpiObj && kpiObj.compare && kpiObj.compare.range ? kpiObj.compare.range : null;
        var startMs = cmp && cmp.start != null ? Number(cmp.start) : NaN;
        var endMs = cmp && cmp.end != null ? Number(cmp.end) : NaN;
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return null;
        var startYmd = ymdInAdminTzFromMs(startMs);
        var endYmd = ymdInAdminTzFromMs(Math.max(startMs, endMs - 1));
        if (!startYmd || !endYmd) return null;
        if (startYmd === endYmd) return 'd:' + startYmd;
        return 'r:' + startYmd + ':' + endYmd;
      }
      function ensureDashboardCompareSeries(kpiObj) {
        var compareRangeKey = compareRangeKeyFromKpiPayload(kpiObj);
        if (!compareRangeKey) return Promise.resolve(null);
        var cmp = kpiObj && kpiObj.compare && kpiObj.compare.range ? kpiObj.compare.range : null;
        var endMs = cmp && cmp.end != null ? Number(cmp.end) : NaN;
        var endMsRounded = Number.isFinite(endMs) ? (Math.floor(endMs / (60 * 1000)) * (60 * 1000)) : null;
        var cacheKey = endMsRounded != null ? (compareRangeKey + '|endMs:' + String(endMsRounded)) : compareRangeKey;
        var fresh = dashCompareRangeKey === cacheKey &&
          Array.isArray(dashCompareSeriesCache) &&
          dashCompareSeriesCache.length >= 2 &&
          dashCompareFetchedAt &&
          (Date.now() - dashCompareFetchedAt) < KPI_CACHE_TTL_MS;
        if (fresh) return Promise.resolve(dashCompareSeriesCache);
        if (dashCompareSeriesInFlight && dashCompareRangeKey === cacheKey) return dashCompareSeriesInFlight;
        dashCompareRangeKey = cacheKey;
        var url = API + '/api/dashboard-series?range=' + encodeURIComponent(compareRangeKey);
        if (endMsRounded != null) url += '&endMs=' + encodeURIComponent(String(endMsRounded));
        dashCompareSeriesInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: 'default' }, 20000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .then(function(data) {
            var s = data && Array.isArray(data.series) ? data.series : null;
            if (s && s.length >= 2) {
              dashCompareSeriesCache = s;
              dashCompareFetchedAt = Date.now();
              return s;
            }
            return null;
          })
          .catch(function() { return null; })
          .finally(function() { dashCompareSeriesInFlight = null; });
        return dashCompareSeriesInFlight;
      }

      function waitForApexCharts(cb, retries) {
        if (typeof ApexCharts !== 'undefined') { cb(); return; }
        if (!retries) retries = 0;
        if (retries >= 15) {
          captureChartMessage('ApexCharts failed to load after retries', 'dashboardApexLoad', { retries: retries }, 'error');
          console.error('[dashboard] ApexCharts failed to load after retries');
          return;
        }
        setTimeout(function() { waitForApexCharts(cb, retries + 1); }, 200);
      }

      var dashChartConfigs = {};

      function makeChart(chartId, labels, datasets, opts) {
        if (typeof ApexCharts === 'undefined') {
          waitForApexCharts(function() { makeChart(chartId, labels, datasets, opts); });
          return null;
        }
        if (!chartId) return null;
        var el = document.getElementById(chartId);
        if (!el) { console.warn('[dashboard] chart element not found:', chartId); return null; }
        if (dashCharts[chartId]) { try { dashCharts[chartId].destroy(); } catch (_) {} }
        el.innerHTML = '';

        var chartScope = (opts && opts.chartScope) ? String(opts.chartScope) : ('dashboard-' + chartId);
        var defaultType = (opts && opts.chartType) || 'area';
        var rawMode = chartModeFromUiConfig(chartId, defaultType) || defaultType;
        var showEndLabels = rawMode === 'multi-line-labels';
        var chartType = rawMode === 'multi-line-labels' ? 'line' : rawMode;
        chartType = normalizeChartType(chartType, normalizeChartType(defaultType, 'area'));

        if (!isChartEnabledByUiConfig(chartId, true)) {
          // Chart hidden by settings: keep DOM empty and avoid rendering work.
          try { if (dashCharts[chartId]) dashCharts[chartId].destroy(); } catch (_) {}
          dashCharts[chartId] = null;
          el.innerHTML = '';
          return null;
        }

        // Apply per-chart palette overrides (maps to series order).
        try {
          var uiColors = chartColorsFromUiConfig(chartId, []);
          if (uiColors && uiColors.length && Array.isArray(datasets)) {
            datasets = datasets.map(function(ds, idx) {
              if (!ds || typeof ds !== 'object') return ds;
              var next = Object.assign({}, ds);
              var c = uiColors[idx];
              if (c) next.borderColor = c;
              return next;
            });
          }
        } catch (_) {}

        dashChartConfigs[chartId] = { labels: labels, datasets: datasets, opts: Object.assign({}, opts || {}, { chartType: chartType, chartScope: chartScope }) };

        var areaOpacityFrom = (opts && typeof opts.areaOpacityFrom === 'number' && isFinite(opts.areaOpacityFrom)) ? opts.areaOpacityFrom : 0.15;
        var areaOpacityTo = (opts && typeof opts.areaOpacityTo === 'number' && isFinite(opts.areaOpacityTo)) ? opts.areaOpacityTo : 0.02;
        var chartHeight = (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 200;
        if (!Number.isFinite(chartHeight) || chartHeight < 80) chartHeight = 200;

        // Guardrails: single-point or all-zero series can render as visually empty.
        // Duplicate the only point to make a tiny segment, and set a y-axis max so 0-lines are visible.
        try {
          if (Array.isArray(labels) && labels.length === 1) labels = [labels[0], labels[0]];
          if (Array.isArray(datasets)) {
            datasets.forEach(function(ds) {
              if (!ds || !Array.isArray(ds.data)) return;
              if (ds.data.length === 1) ds.data = [ds.data[0], ds.data[0]];
            });
          }
        } catch (_) {}

        try {
          var apexSeries = datasets.map(function(ds) {
            var safeData = Array.isArray(ds && ds.data) ? ds.data.map(function(v) {
              var n = (typeof v === 'number') ? v : Number(v);
              return isFinite(n) ? n : 0;
            }) : [];
            return { name: ds.label, data: safeData };
          });
          var colors = datasets.map(function(ds) { return ds.borderColor || DASH_ACCENT; });
          var yMaxOverride = null;
          var yMinOverride = 0;
          try {
            var maxV = null;
            var minV = null;
            apexSeries.forEach(function(s) {
              (s.data || []).forEach(function(v) {
                var n = (typeof v === 'number') ? v : Number(v);
                if (!isFinite(n)) return;
                if (maxV == null || n > maxV) maxV = n;
                if (minV == null || n < minV) minV = n;
              });
            });
            if (maxV == null) maxV = 0;
            if (maxV <= 0) yMaxOverride = 1;
            else yMaxOverride = maxV + Math.max(1e-6, Math.abs(maxV) * 0.12);
            if (minV != null && minV < 0) yMinOverride = minV - Math.max(1e-6, Math.abs(minV) * 0.12);
          } catch (_) {}
          var yFmt = (opts && opts.pct) ? function(v) { return v != null ? Number(v).toFixed(1) + '%' : '\u2014'; }
            : (opts && opts.currency) ? function(v) { return v != null ? (formatRevenue(Number(v)) || '\u2014') : '\u2014'; }
            : function(v) { return v != null ? Number(v).toLocaleString() : '\u2014'; };

          // ApexCharts 4.x can hide line strokes when fill opacity is 0.
          // Keep opacity at 1; line charts still render without an area fill.
          var fillConfig = chartType === 'line' ? { type: 'solid', opacity: 1 }
            : chartType === 'bar' ? { type: 'solid', opacity: 1 }
            : { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: areaOpacityFrom, opacityTo: areaOpacityTo, stops: [0, 100] } };

          var apexOpts = {
            chart: {
              type: chartType,
              height: chartHeight,
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
              animations: { enabled: true, easing: 'easeinout', speed: 300 },
              zoom: { enabled: false }
            },
            series: apexSeries,
            colors: colors,
            stroke: { show: true, width: chartType === 'bar' ? 0 : 2, curve: 'smooth', lineCap: 'round' },
            fill: fillConfig,
            plotOptions: chartType === 'bar' ? { bar: { columnWidth: '60%', borderRadius: 3 } } : {},
            xaxis: {
              categories: labels || [],
              labels: { style: { fontSize: '10px', cssClass: 'apexcharts-xaxis-label' }, rotate: 0, hideOverlappingLabels: true },
              axisBorder: { show: false },
              axisTicks: { show: false }
            },
            yaxis: {
              labels: { style: { fontSize: '11px', cssClass: 'apexcharts-yaxis-label' }, formatter: yFmt },
              min: yMinOverride,
              max: yMaxOverride,
              forceNiceScale: true
            },
            grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
            tooltip: { y: { formatter: yFmt } },
            legend: { show: apexSeries.length > 1, position: 'top', fontSize: '11px' },
            dataLabels: (showEndLabels && chartType === 'line') ? {
              enabled: true,
              formatter: function(val, ctx) {
                try {
                  var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                  var w = ctx && ctx.w ? ctx.w : null;
                  var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                  if (dp !== last) return '';
                } catch (_) { return ''; }
                try { return yFmt(val); } catch (_) { return String(val); }
              },
              style: { fontSize: '10px' },
              background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
              offsetY: -3,
            } : { enabled: false },
            markers: { size: chartType === 'line' ? 3 : 0, hover: { size: 5 } },
            noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
          };
          try {
            var chartOverride = chartAdvancedOverrideFromUiConfig(chartId, chartType);
            if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) {
              apexOpts = deepMergeOptions(apexOpts, chartOverride);
            }
          } catch (_) {}

          var chart = new ApexCharts(el, apexOpts);
          chart.render();
          dashCharts[chartId] = chart;
          return chart;
        } catch (err) {
          captureChartError(err, 'dashboardChartRender', { chartId: chartId });
          console.error('[dashboard] chart render error:', chartId, err);
          return null;
        }
      }

      function destroyDashChart(chartId) {
        try {
          if (dashCharts && dashCharts[chartId] && typeof dashCharts[chartId].destroy === 'function') {
            dashCharts[chartId].destroy();
          }
        } catch (_) {}
        try { delete dashCharts[chartId]; } catch (_) {}
      }

      function normalizeOverviewMetric(v) {
        var n = (typeof v === 'number') ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      }

      function resolveOverviewChartHeight(chartEl, fallback, min, max) {
        var fb = Number(fallback);
        if (!Number.isFinite(fb) || fb <= 0) fb = 220;
        var lo = Number(min);
        if (!Number.isFinite(lo) || lo <= 0) lo = 120;
        var hi = Number(max);
        if (!Number.isFinite(hi) || hi <= 0) hi = 720;
        var h = 0;
        try {
          if (chartEl) {
            var rect = chartEl.getBoundingClientRect ? chartEl.getBoundingClientRect() : null;
            if (rect && Number.isFinite(rect.height) && rect.height > 0) h = rect.height;
            if ((!h || h < lo) && chartEl.parentElement && chartEl.parentElement.getBoundingClientRect) {
              var pRect = chartEl.parentElement.getBoundingClientRect();
              if (pRect && Number.isFinite(pRect.height) && pRect.height > 0) h = pRect.height;
            }
          }
        } catch (_) {}
        if (!Number.isFinite(h) || h <= 0) h = fb;
        h = Math.max(lo, Math.min(hi, h));
        return Math.round(h);
      }

      function overviewMiniChartIds() {
        return ['dash-chart-finishes-30d', 'dash-chart-countries-30d', 'dash-chart-kexo-score-today', 'dash-chart-overview-30d'];
      }

      function computeOverviewMiniSizeSignature() {
        var ids = overviewMiniChartIds();
        return ids.map(function(id) {
          var el = document.getElementById(id);
          if (!el || !el.getBoundingClientRect) return id + ':0x0';
          var r = el.getBoundingClientRect();
          var w = Number.isFinite(r.width) ? Math.round(r.width) : 0;
          var h = Number.isFinite(r.height) ? Math.round(r.height) : 0;
          return id + ':' + w + 'x' + h;
        }).join('|');
      }

      function scheduleOverviewMiniResizeRender() {
        if (overviewMiniResizeScheduled) return;
        overviewMiniResizeScheduled = true;
        requestAnimationFrame(function() {
          overviewMiniResizeScheduled = false;
          if (!overviewMiniCache) return;
          var sig = computeOverviewMiniSizeSignature();
          if (sig && sig === overviewMiniSizeSignature) return;
          overviewMiniSizeSignature = sig;
          renderOverviewMiniCharts(overviewMiniCache);
        });
      }

      function ensureOverviewMiniResizeObserver() {
        if (overviewMiniResizeObserver || typeof ResizeObserver === 'undefined') return;
        overviewMiniResizeObserver = new ResizeObserver(function() {
          scheduleOverviewMiniResizeRender();
        });
        overviewMiniChartIds().forEach(function(id) {
          var el = document.getElementById(id);
          if (el) overviewMiniResizeObserver.observe(el);
        });
      }

      registerCleanup(function() {
        try {
          if (overviewMiniResizeObserver && typeof overviewMiniResizeObserver.disconnect === 'function') {
            overviewMiniResizeObserver.disconnect();
          }
        } catch (_) {}
        overviewMiniResizeObserver = null;
        overviewMiniResizeScheduled = false;
        overviewMiniSizeSignature = '';
        overviewMiniCacheShopKey = '';
      });

      function renderOverviewChartEmpty(chartId, text) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl) return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          return;
        }
        destroyDashChart(chartId);
        chartEl.innerHTML = '<div class="kexo-overview-chart-empty">' + escapeHtml(text || 'No data available') + '</div>';
      }

      function renderOverviewPieChart(chartId, labels, values, opts) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || typeof ApexCharts === 'undefined') return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          return;
        }
        var safeLabels = [];
        var safeValues = [];
        var srcLabels = Array.isArray(labels) ? labels : [];
        var srcValues = Array.isArray(values) ? values : [];
        for (var i = 0; i < srcLabels.length; i++) {
          var label = srcLabels[i] != null ? String(srcLabels[i]).trim() : '';
          var n = normalizeOverviewMetric(srcValues[i]);
          if (!label || n <= 0) continue;
          safeLabels.push(label);
          safeValues.push(n);
        }
        if (!safeValues.length) {
          renderOverviewChartEmpty(chartId, 'No data available');
          return;
        }
        destroyDashChart(chartId);
        chartEl.innerHTML = '';
        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length)
          ? opts.colors
          : [DASH_ACCENT, DASH_BLUE, DASH_ORANGE, DASH_PURPLE, '#ef4444'];
        var colors = chartColorsFromUiConfig(chartId, fallbackColors);
        var valueFormatter = (opts && typeof opts.valueFormatter === 'function')
          ? opts.valueFormatter
          : function(v) { return formatRevenue(normalizeOverviewMetric(v)) || '\u2014'; };
        var chartType = opts && opts.donut ? 'donut' : 'pie';
        var chartHeight = resolveOverviewChartHeight(
          chartEl,
          (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 240,
          180,
          440
        );
        var apexOpts = {
          chart: {
            type: chartType,
            height: chartHeight,
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: false },
            animations: { enabled: true, easing: 'easeinout', speed: 280 },
            zoom: { enabled: false }
          },
          series: safeValues,
          labels: safeLabels,
          colors: colors,
          legend: { show: true, position: 'bottom', fontSize: '11px' },
          stroke: { show: true, width: 1, colors: ['#fff'] },
          dataLabels: {
            enabled: true,
            formatter: function(val) {
              var n = normalizeOverviewMetric(val);
              return n ? n.toFixed(0) + '%' : '';
            },
          },
          tooltip: { y: { formatter: valueFormatter } },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };
        if (chartType === 'donut') {
          apexOpts.plotOptions = { pie: { donut: { size: '66%' } } };
        }
        try {
          var chartOverride = chartAdvancedOverrideFromUiConfig(chartId, 'pie');
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) {
            apexOpts = deepMergeOptions(apexOpts, chartOverride);
          }
        } catch (_) {}
        try {
          var chart = new ApexCharts(chartEl, apexOpts);
          chart.render();
          dashCharts[chartId] = chart;
        } catch (err) {
          captureChartError(err, 'dashboardPieChartRender', { chartId: chartId });
          console.error('[dashboard] pie chart render error:', chartId, err);
        }
      }

      function renderOverviewRevenueCostChart(snapshotPayload) {
        var chartId = 'dash-chart-overview-30d';
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          var hiddenEl = document.getElementById(chartId);
          if (hiddenEl) hiddenEl.innerHTML = '';
          return;
        }
        var current = snapshotPayload && snapshotPayload.seriesComparison && snapshotPayload.seriesComparison.current
          ? snapshotPayload.seriesComparison.current
          : null;
        var labelsYmd = current && Array.isArray(current.labelsYmd) ? current.labelsYmd : [];
        var revenueGbp = current && Array.isArray(current.revenueGbp) ? current.revenueGbp : [];
        var costGbp = current && Array.isArray(current.costGbp) ? current.costGbp : [];
        var len = Math.max(labelsYmd.length, revenueGbp.length, costGbp.length);
        if (!len) {
          renderOverviewChartEmpty(chartId, 'No data available');
          return;
        }
        var labels = [];
        var revenue = [];
        var cost = [];
        for (var i = 0; i < len; i++) {
          var ymd = labelsYmd[i] != null ? String(labelsYmd[i]) : '';
          labels.push(ymd ? shortDate(ymd) : String(i + 1));
          revenue.push(normalizeOverviewMetric(revenueGbp[i]));
          cost.push(normalizeOverviewMetric(costGbp[i]));
        }
        var chartEl = document.getElementById(chartId);
        var chartHeight = resolveOverviewChartHeight(chartEl, 420, 300, 760);
        makeChart(chartId, labels, [{
          label: 'Revenue',
          data: revenue,
          borderColor: DASH_ACCENT,
          backgroundColor: DASH_ACCENT_LIGHT,
          fill: true,
          borderWidth: 2
        }, {
          label: 'Cost',
          data: cost,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.14)',
          fill: true,
          borderWidth: 2
        }], { currency: true, chartType: 'bar', height: chartHeight });
      }

      function fetchOverviewJson(url, force, timeoutMs) {
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, timeoutMs || 25000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .catch(function() { return null; });
      }

      function renderOverviewMiniCharts(payload) {
        var finishesRows = payload && payload.finishes && Array.isArray(payload.finishes.finishes) ? payload.finishes.finishes : [];
        var finishLabels = [];
        var finishValues = [];
        finishesRows.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          var label = '';
          if (row.label != null && String(row.label).trim()) label = String(row.label).trim();
          else if (row.finish != null && String(row.finish).trim()) label = String(row.finish).trim();
          else if (row.key != null && String(row.key).trim()) label = String(row.key).trim().replace(/_/g, ' ');
          var val = normalizeOverviewMetric(row.revenueGbp != null ? row.revenueGbp : row.revenue);
          if (!label || val <= 0) return;
          finishLabels.push(label);
          finishValues.push(val);
        });
        renderOverviewPieChart('dash-chart-finishes-30d', finishLabels, finishValues, {
          colors: ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab', '#ef4444'],
          valueFormatter: function(v) { return formatRevenue(normalizeOverviewMetric(v)) || '\u2014'; },
          height: 180
        });

        var countriesRows = payload && payload.countries && Array.isArray(payload.countries.topCountries) ? payload.countries.topCountries : [];
        var topCountries = countriesRows.slice(0, 5);
        var countryLabels = [];
        var countryValues = [];
        topCountries.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          var cc = row.country != null ? String(row.country).trim().toUpperCase() : '';
          var label = cc ? ((typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc) : '';
          var val = normalizeOverviewMetric(row.revenue);
          if (!label || val <= 0) return;
          countryLabels.push(label);
          countryValues.push(val);
        });
        renderOverviewPieChart('dash-chart-countries-30d', countryLabels, countryValues, {
          colors: ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'],
          valueFormatter: function(v) { return formatRevenue(normalizeOverviewMetric(v)) || '\u2014'; },
          height: 180
        });

        var rawScore = payload && payload.kexoScore && payload.kexoScore.score != null ? Number(payload.kexoScore.score) : NaN;
        var hasScore = Number.isFinite(rawScore);
        var score = hasScore ? Math.max(0, Math.min(100, rawScore)) : null;
        var scoreLabels = hasScore ? ['Score', 'Remaining'] : [];
        var scoreValues = hasScore ? [score, Math.max(0, 100 - score)] : [];
        renderOverviewPieChart('dash-chart-kexo-score-today', scoreLabels, scoreValues, {
          donut: true,
          colors: ['#4b94e4', '#e5e7eb'],
          valueFormatter: function(v) { return normalizeOverviewMetric(v).toFixed(1); },
          height: 180
        });

        renderOverviewRevenueCostChart(payload ? payload.snapshot : null);
        overviewMiniSizeSignature = computeOverviewMiniSizeSignature();
      }

      function fetchOverviewMiniData(options) {
        ensureOverviewMiniResizeObserver();
        var opts = options && typeof options === 'object' ? options : {};
        var force = !!opts.force;
        var shop = getShopForSales();
        var shopKey = shop || '__no_shop__';
        var fresh = overviewMiniCache && overviewMiniFetchedAt && (Date.now() - overviewMiniFetchedAt) < OVERVIEW_MINI_CACHE_MS && overviewMiniCacheShopKey === shopKey;
        if (!force && fresh) {
          renderOverviewMiniCharts(overviewMiniCache);
          return Promise.resolve(overviewMiniCache);
        }
        if (overviewMiniInFlight && !force) return overviewMiniInFlight;

        var stamp = Date.now();
        var seriesUrl = API + '/api/dashboard-series?range=30d' + (force ? ('&force=1&_=' + stamp) : '');
        var snapshotUrl = API + '/api/business-snapshot?mode=range&preset=last_30_days' + (force ? ('&force=1&_=' + stamp) : '');
        var finishesUrl = API + '/api/shopify-finishes?range=30d' + (shop ? ('&shop=' + encodeURIComponent(shop)) : '') + (force ? ('&force=1&_=' + stamp) : '');
        var scoreUrl = API + '/api/kexo-score?range=today' + (force ? ('&force=1&_=' + stamp) : '');

        overviewMiniInFlight = Promise.all([
          fetchOverviewJson(seriesUrl, force, 25000),
          fetchOverviewJson(snapshotUrl, force, 30000),
          fetchOverviewJson(finishesUrl, force, 25000),
          fetchOverviewJson(scoreUrl, force, 25000),
        ]).then(function(parts) {
          var payload = {
            countries: parts[0] || null,
            snapshot: parts[1] || null,
            finishes: parts[2] || null,
            kexoScore: parts[3] || null,
          };
          overviewMiniCache = payload;
          overviewMiniFetchedAt = Date.now();
          overviewMiniCacheShopKey = shopKey;
          overviewMiniSizeSignature = computeOverviewMiniSizeSignature();
          renderOverviewMiniCharts(payload);
          return payload;
        }).catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'dashboardOverviewMiniCharts', page: PAGE }); } catch (_) {}
          renderOverviewMiniCharts(overviewMiniCache || null);
          return overviewMiniCache || null;
        }).finally(function() {
          overviewMiniInFlight = null;
        });
        return overviewMiniInFlight;
      }

      function renderDashboard(data) {
        if (!data) return;
        var allSeries = data.series || [];
        var series = allSeries;
        var chartSeries = allSeries;

        var el = function(id) { return document.getElementById(id); };
        // Recompute summary from current period only
        function sumField(arr, field) { var t = 0; for (var i = 0; i < arr.length; i++) t += (arr[i][field] || 0); return t; }
        function avgField(arr, field) { if (!arr.length) return 0; return sumField(arr, field) / arr.length; }

        var s = data.summary || {};
        var curRevenue = sumField(series, 'revenue');
        var curOrders = sumField(series, 'orders');
        var curSessions = sumField(series, 'sessions');
        var curConvRate = avgField(series, 'convRate');
        var curAov = avgField(series, 'aov');
        var curBounceRate = avgField(series, 'bounceRate');
        var curAdSpend = sumField(series, 'adSpend');
        // KPI card values are set by renderDashboardKpisFromApi() using /api/kpis

        // Sparklines in KPI cards.
        var sparklineSeries = getSparklineSeries(chartSeries);
        if (chartSeries.length < 2 && (!sparklineHistorySeriesCache || sparklineHistorySeriesCache.length < 2)) {
          ensureSparklineHistorySeries().then(function(historySeries) {
            if (!historySeries || historySeries.length < 2) return;
            if (dashCache && dashLastRangeKey === dashRangeKeyFromDateRange()) {
              try { renderDashboard(dashCache); } catch (_) {}
            } else {
              try { renderCondensedSparklines(historySeries); } catch (_) {}
            }
          }).catch(function() {});
        }
        function hexToRgba(hex, alpha) {
          if (!hex || typeof hex !== 'string') return 'rgba(0,0,0,0.5)';
          var h = hex.replace(/^#/, '');
          if (h.length !== 6) return 'rgba(0,0,0,0.5)';
          var r = parseInt(h.slice(0, 2), 16);
          var g = parseInt(h.slice(2, 4), 16);
          var b = parseInt(h.slice(4, 6), 16);
          var a = typeof alpha === 'number' && Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0.5;
          return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
        }
        function renderSparkline(elId, dataArr, color, compareDataArr) {
          var sparkEl = el(elId);
          if (!sparkEl || typeof ApexCharts === 'undefined') return;
          if (dataArr.length < 2) dataArr = dataArr.length === 1 ? [dataArr[0], dataArr[0]] : [0, 0];
          sparkEl.innerHTML = '';
          var dashBundle = getChartsKpiBundle('dashboardCards');
          var sparkCfg = dashBundle.sparkline || defaultChartsKpiSparklineConfig('dashboardCards');
          var sparkMode = String(sparkCfg.mode || 'line').toLowerCase();
          if (sparkMode !== 'line' && sparkMode !== 'area' && sparkMode !== 'bar') sparkMode = 'line';
          var sparkCurve = String(sparkCfg.curve || 'straight').toLowerCase();
          if (sparkCurve !== 'smooth' && sparkCurve !== 'straight' && sparkCurve !== 'stepline') sparkCurve = 'straight';
          if (sparkMode === 'bar') sparkCurve = 'straight';
          var sparkHeight = Number(sparkCfg.height);
          if (!Number.isFinite(sparkHeight)) sparkHeight = 50;
          var sparkStrokeWidth = Number(sparkCfg.strokeWidth);
          if (!Number.isFinite(sparkStrokeWidth)) sparkStrokeWidth = 2.55;
          var showCompare = sparkCfg.showCompare !== false;

          var nums = dataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return isFinite(n) ? n : 0;
          });
          var compareNums = Array.isArray(compareDataArr) ? compareDataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return isFinite(n) ? n : 0;
          }) : null;
          if (compareNums && compareNums.length < 2) {
            compareNums = compareNums.length === 1 ? [compareNums[0], compareNums[0]] : null;
          }
          if (!showCompare) compareNums = null;
          if (compareNums && compareNums.length !== nums.length) {
            if (compareNums.length > nums.length) compareNums = compareNums.slice(0, nums.length);
            while (compareNums.length < nums.length) compareNums.push(compareNums[compareNums.length - 1] || 0);
          }
          var allNums = compareNums && compareNums.length ? nums.concat(compareNums) : nums.slice();
          var minVal = allNums[0];
          var maxVal = allNums[0];
          for (var i = 1; i < allNums.length; i++) {
            if (allNums[i] < minVal) minVal = allNums[i];
            if (allNums[i] > maxVal) maxVal = allNums[i];
          }
          if (!isFinite(minVal)) minVal = 0;
          if (!isFinite(maxVal)) maxVal = 0;

          // Flat/near-flat series can render as visually empty at 40px height.
          // Keep a truly zero series flat/neutral; only bump non-zero flat lines.
          var span = Math.abs(maxVal - minVal);
          var allZero = span < 1e-9 && allNums.every(function(v) { return Math.abs(v) < 1e-9; });
          if (span < 1e-9 && !allZero) {
            var bump = (maxVal === 0) ? 1 : Math.max(0.01, Math.abs(maxVal) * 0.02);
            nums[nums.length - 1] = nums[nums.length - 1] + bump;
            minVal = Math.min(minVal, nums[nums.length - 1]);
            maxVal = Math.max(maxVal, nums[nums.length - 1]);
            span = Math.abs(maxVal - minVal);
          }
          var yMin = -1;
          var yMax = 1;
          if (!allZero) {
            // Keep some headroom but avoid over-padding, so peaks read more like
            // the original "mountain" profile instead of looking flattened.
            var pad = Math.max(1e-6, span * 0.12);
            yMin = minVal - pad;
            yMax = maxVal + pad;
          }

          var series = [{ name: 'Current', data: nums }];
          var colors = [color];
          var strokeWidths = [sparkMode === 'bar' ? 0 : sparkStrokeWidth];
          var dashArray = [0];
          if (compareNums && compareNums.length >= 2) {
            series.push({ name: 'Compare', data: compareNums });
            var usePrimary = sparkCfg.compareUsePrimaryColor !== false;
            var opacityPct = Number(sparkCfg.compareOpacity);
            if (!Number.isFinite(opacityPct)) opacityPct = 50;
            opacityPct = Math.max(0, Math.min(100, opacityPct));
            var compareColor = usePrimary ? hexToRgba(color, opacityPct / 100) : (chartsKpiCompareLineColor('dashboardCards') || '#cccccc');
            colors.push(compareColor);
            strokeWidths.push(sparkMode === 'bar' ? 0 : Math.max(1, sparkStrokeWidth - 0.5));
            dashArray.push(usePrimary ? 0 : 4);
          }
          var apexOpts = {
            chart: { type: sparkMode, height: sparkHeight, sparkline: { enabled: true }, animations: { enabled: false } },
            series: series,
            stroke: { show: true, width: strokeWidths, curve: sparkCurve, lineCap: 'butt', dashArray: dashArray },
            fill: sparkMode === 'area'
              ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.26, opacityTo: 0.04, stops: [0, 100] } }
              : { type: 'solid', opacity: 1 },
            colors: colors,
            yaxis: { min: yMin, max: yMax },
            markers: { size: 0 },
            plotOptions: sparkMode === 'bar' ? { bar: { columnWidth: '55%', borderRadius: 2 } } : {},
            grid: { padding: { top: 0, right: 0, bottom: -3, left: 0 } },
            tooltip: { enabled: false }
          };
          try {
            var override = sparkCfg.advancedApexOverride;
            if (isPlainObject(override) && Object.keys(override).length) {
              apexOpts = deepMergeOptions(apexOpts, override);
            }
          } catch (_) {}
          var chart = new ApexCharts(sparkEl, apexOpts);
          chart.render();
        }
        function sparkToneColor(dataArr) {
          var GREEN = chartsKpiToneColor('dashboardCards', 'up');
          var RED = chartsKpiToneColor('dashboardCards', 'down');
          var NEUTRAL = chartsKpiToneColor('dashboardCards', 'flat');
          var vals = (dataArr || []).map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return isFinite(n) ? n : null;
          }).filter(function(v) { return v != null; });
          if (vals.length < 2) return NEUTRAL;
          var last = vals[vals.length - 1];
          var prev = vals[vals.length - 2];
          if (Math.abs(last - prev) < 1e-9) return NEUTRAL;
          return last > prev ? GREEN : RED;
        }
        function sparkToneFromCompare(current, baseline, invert, fallbackDataArr) {
          var GREEN = chartsKpiToneColor('dashboardCards', 'up');
          var RED = chartsKpiToneColor('dashboardCards', 'down');
          var NEUTRAL = chartsKpiToneColor('dashboardCards', 'flat');
          var cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
          var base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
          if (cur == null || base == null) return NEUTRAL;
          var delta = cur - base;
          if (invert) delta = -delta;
          if (Math.abs(delta) < 1e-9) return NEUTRAL;
          var denom = Math.abs(base);
          if (denom > 1e-9) {
            var ratio = delta / denom;
            if (Math.abs(ratio) <= KPI_STABLE_RATIO) return NEUTRAL;
          }
          return delta >= 0 ? GREEN : RED;
        }
        function numFromRangeMap(dataObj, keyName, rangeKey) {
          var map = dataObj && dataObj[keyName] ? dataObj[keyName] : null;
          var v = map && typeof map[rangeKey] === 'number' ? map[rangeKey] : null;
          return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        }
        function sessionsFromBreakdownMap(dataObj, rangeKey) {
          var br = dataObj && dataObj.trafficBreakdown ? dataObj.trafficBreakdown : null;
          var r = br && br[rangeKey] ? br[rangeKey] : null;
          var v = r && typeof r.human_sessions === 'number' ? r.human_sessions : null;
          return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
        }
        var kpiDataForTone = null;
        try { kpiDataForTone = getKpiData(); } catch (_) { kpiDataForTone = null; }
        var kpiRangeForTone = null;
        try { kpiRangeForTone = getStatsRange(); } catch (_) { kpiRangeForTone = null; }
        var compareTone = kpiDataForTone && kpiDataForTone.compare ? kpiDataForTone.compare : null;
        var currentRevenueTone = numFromRangeMap(kpiDataForTone, 'sales', kpiRangeForTone);
        var currentOrdersTone = numFromRangeMap(kpiDataForTone, 'convertedCount', kpiRangeForTone);
        var currentSessionsTone = sessionsFromBreakdownMap(kpiDataForTone, kpiRangeForTone);
        var currentConvTone = numFromRangeMap(kpiDataForTone, 'conversion', kpiRangeForTone);
        var currentReturningTone = numFromRangeMap(kpiDataForTone, 'returningCustomerCount', kpiRangeForTone);
        var currentAovTone = numFromRangeMap(kpiDataForTone, 'aov', kpiRangeForTone);
        var currentBounceTone = numFromRangeMap(kpiDataForTone, 'bounce', kpiRangeForTone);
        var currentRoasTone = numFromRangeMap(kpiDataForTone, 'roas', kpiRangeForTone);
        var compareRevenueTone = compareTone && typeof compareTone.sales === 'number' ? compareTone.sales : null;
        var compareOrdersTone = compareTone && typeof compareTone.convertedCount === 'number' ? compareTone.convertedCount : null;
        var compareSessionsTone = (compareTone && compareTone.trafficBreakdown && typeof compareTone.trafficBreakdown.human_sessions === 'number')
          ? compareTone.trafficBreakdown.human_sessions
          : null;
        var compareConvTone = compareTone && typeof compareTone.conversion === 'number' ? compareTone.conversion : null;
        var compareReturningTone = compareTone && typeof compareTone.returningCustomerCount === 'number' ? compareTone.returningCustomerCount : null;
        var compareAovTone = compareTone && typeof compareTone.aov === 'number' ? compareTone.aov : null;
        var compareBounceTone = compareTone && typeof compareTone.bounce === 'number' ? compareTone.bounce : null;
        var compareRoasTone = compareTone && typeof compareTone.roas === 'number' ? compareTone.roas : null;
        var extrasTone = (kpiExpandedExtrasRange === kpiRangeForTone) ? (kpiExpandedExtrasCache || null) : null;
        var currentItemsTone = extrasTone && typeof extrasTone.itemsSold === 'number' ? extrasTone.itemsSold : null;
        var compareItemsTone = extrasTone && extrasTone.compare && typeof extrasTone.compare.itemsSold === 'number' ? extrasTone.compare.itemsSold : null;
        var currentFulfilledTone = extrasTone && typeof extrasTone.ordersFulfilled === 'number' ? extrasTone.ordersFulfilled : null;
        var compareFulfilledTone = extrasTone && extrasTone.compare && typeof extrasTone.compare.ordersFulfilled === 'number' ? extrasTone.compare.ordersFulfilled : null;
        var currentReturnsTone = extrasTone && typeof extrasTone.returns === 'number' ? extrasTone.returns : null;
        var compareReturnsTone = extrasTone && extrasTone.compare && typeof extrasTone.compare.returns === 'number' ? extrasTone.compare.returns : null;
        var currentCogsTone = extrasTone && typeof extrasTone.cogs === 'number' ? extrasTone.cogs : null;
        var compareCogsTone = extrasTone && extrasTone.compare && typeof extrasTone.compare.cogs === 'number' ? extrasTone.compare.cogs : null;
        // KPI card sparklines should reflect the real per-bucket series returned by `/api/dashboard-series`.
        // Do NOT rescale the series to end at the headline KPI totals; that flattens yesterday/day-before views.
        function sparkSeriesFromCompare(_current, _baseline, fallbackDataArr) {
          if (!Array.isArray(fallbackDataArr)) return [];
          return fallbackDataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return Number.isFinite(n) ? n : 0;
          });
        }
        var revenueHistorySpark = sparklineSeries.map(function(d) { return d.revenue; });
        var sessionsHistorySpark = sparklineSeries.map(function(d) { return d.sessions; });
        var ordersHistorySpark = sparklineSeries.map(function(d) { return d.orders; });
        var returningHistorySpark = sparklineSeries.map(function(d) { return d.returningCustomerOrders || 0; });
        var convHistorySpark = sparklineSeries.map(function(d) { return d.convRate; });
        var aovHistorySpark = sparklineSeries.map(function(d) { return d.aov; });
        var bounceHistorySpark = sparklineSeries.map(function(d) { return d.bounceRate; });
        var itemsHistorySpark = sparklineSeries.map(function(d) { return d.units || 0; });
        var roasHistorySpark = sparklineSeries.map(function(d) {
          var spend = d && typeof d.adSpend === 'number' ? d.adSpend : 0;
          var rev = d && typeof d.revenue === 'number' ? d.revenue : 0;
          return (spend > 0) ? (rev / spend) : 0;
        });
        var revenueSpark = sparkSeriesFromCompare(currentRevenueTone, compareRevenueTone, revenueHistorySpark);
        var sessionsSpark = sparkSeriesFromCompare(currentSessionsTone, compareSessionsTone, sessionsHistorySpark);
        var ordersSpark = sparkSeriesFromCompare(currentOrdersTone, compareOrdersTone, ordersHistorySpark);
        var returningSpark = sparkSeriesFromCompare(currentReturningTone, compareReturningTone, returningHistorySpark);
        var convSpark = sparkSeriesFromCompare(currentConvTone, compareConvTone, convHistorySpark);
        var aovSpark = sparkSeriesFromCompare(currentAovTone, compareAovTone, aovHistorySpark);
        var bounceSpark = sparkSeriesFromCompare(currentBounceTone, compareBounceTone, bounceHistorySpark);
        var itemsSpark = sparkSeriesFromCompare(currentItemsTone, compareItemsTone, itemsHistorySpark);
        var roasSpark = sparkSeriesFromCompare(currentRoasTone, compareRoasTone, roasHistorySpark);
        function alignCompareToPrimary(compareArr, primaryLen) {
          if (!Array.isArray(compareArr) || compareArr.length < 2) return null;
          var arr = compareArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return Number.isFinite(n) ? n : 0;
          });
          if (arr.length === primaryLen) return arr;
          if (arr.length > primaryLen) return arr.slice(0, primaryLen);
          var last = arr.length ? (arr[arr.length - 1] || 0) : 0;
          while (arr.length < primaryLen) arr.push(last);
          return arr;
        }
        function compareFromCache(cache, primaryLen, extract) {
          if (!cache || !Array.isArray(cache) || cache.length < 2) return null;
          var extracted = cache.map(extract);
          return alignCompareToPrimary(extracted, primaryLen);
        }
        var primaryLen = revenueSpark.length;
        ensureDashboardCompareSeries(getKpiData()).then(function(compareSeries) {
          var cmp = compareSeries;
          var revenueSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.revenue || 0; });
          var sessionsSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.sessions || 0; });
          var ordersSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.orders || 0; });
          var returningSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.returningCustomerOrders || 0; });
          var convSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.convRate != null ? d.convRate : 0; });
          var aovSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.aov != null ? d.aov : 0; });
          var bounceSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.bounceRate != null ? d.bounceRate : 0; });
          var roasSparkCompare = null;
          if (cmp && cmp.length >= 2) {
            var roasExtracted = cmp.map(function(d) {
              var spend = d && typeof d.adSpend === 'number' ? d.adSpend : 0;
              var rev = d && typeof d.revenue === 'number' ? d.revenue : 0;
              return (spend > 0) ? (rev / spend) : 0;
            });
            roasSparkCompare = alignCompareToPrimary(roasExtracted, primaryLen);
          }
          var itemsSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.units || 0; });
          renderSparkline('dash-revenue-sparkline', revenueSpark, sparkToneFromCompare(currentRevenueTone, compareRevenueTone, false, revenueSpark), revenueSparkCompare);
          renderSparkline('dash-sessions-sparkline', sessionsSpark, sparkToneFromCompare(currentSessionsTone, compareSessionsTone, false, sessionsSpark), sessionsSparkCompare);
          renderSparkline('dash-orders-sparkline', ordersSpark, sparkToneFromCompare(currentOrdersTone, compareOrdersTone, false, ordersSpark), ordersSparkCompare);
          renderSparkline('dash-returning-sparkline', returningSpark, sparkToneFromCompare(currentReturningTone, compareReturningTone, false, returningSpark), returningSparkCompare);
          renderSparkline('dash-conv-sparkline', convSpark, sparkToneFromCompare(currentConvTone, compareConvTone, false, convSpark), convSparkCompare);
          renderSparkline('dash-aov-sparkline', aovSpark, sparkToneFromCompare(currentAovTone, compareAovTone, false, aovSpark), aovSparkCompare);
          renderSparkline('dash-bounce-sparkline', bounceSpark, sparkToneFromCompare(currentBounceTone, compareBounceTone, true, bounceSpark), bounceSparkCompare);
          renderSparkline('dash-roas-sparkline', roasSpark, sparkToneFromCompare(currentRoasTone, compareRoasTone, false, roasSpark), roasSparkCompare);
          renderSparkline('dash-items-sparkline', itemsSpark, DASHBOARD_NEUTRAL_TONE_HEX, itemsSparkCompare);
          // COGS / Fulfilled / Returns sparklines come from `/api/kpis-expanded-extra` (bucketed per range).
          try {
            var extraSpark = extrasTone && extrasTone.spark && typeof extrasTone.spark === 'object' ? extrasTone.spark : null;
            var extraCmpSpark = extrasTone && extrasTone.compare && extrasTone.compare.spark && typeof extrasTone.compare.spark === 'object'
              ? extrasTone.compare.spark
              : null;

            var cogsArr = extraSpark && Array.isArray(extraSpark.cogs) ? extraSpark.cogs : null;
            var fulfilledArr = extraSpark && Array.isArray(extraSpark.fulfilled) ? extraSpark.fulfilled : null;
            var returnsArr = extraSpark && Array.isArray(extraSpark.returns) ? extraSpark.returns : null;
            var cogsCmpArr = extraCmpSpark && Array.isArray(extraCmpSpark.cogs) ? extraCmpSpark.cogs : null;
            var fulfilledCmpArr = extraCmpSpark && Array.isArray(extraCmpSpark.fulfilled) ? extraCmpSpark.fulfilled : null;
            var returnsCmpArr = extraCmpSpark && Array.isArray(extraCmpSpark.returns) ? extraCmpSpark.returns : null;

            if (cogsArr && cogsArr.length) renderSparkline('dash-cogs-sparkline', cogsArr, DASHBOARD_NEUTRAL_TONE_HEX, cogsCmpArr);
            else { var cs = el('dash-cogs-sparkline'); if (cs) cs.innerHTML = ''; }

            if (fulfilledArr && fulfilledArr.length) renderSparkline('dash-fulfilled-sparkline', fulfilledArr, DASHBOARD_NEUTRAL_TONE_HEX, fulfilledCmpArr);
            else { var fs = el('dash-fulfilled-sparkline'); if (fs) fs.innerHTML = ''; }

            if (returnsArr && returnsArr.length) renderSparkline('dash-returns-sparkline', returnsArr, DASHBOARD_NEUTRAL_TONE_HEX, returnsCmpArr);
            else { var rs = el('dash-returns-sparkline'); if (rs) rs.innerHTML = ''; }
          } catch (_) {}
          try { if (typeof renderCondensedSparklines === 'function') renderCondensedSparklines(sparklineSeries); } catch (_) {}
        });

        renderOverviewMiniCharts(overviewMiniCache || null);

        var prodTbody = el('dash-top-products') ? el('dash-top-products').querySelector('tbody') : null;
        if (prodTbody) {
          var products = data.topProducts || [];
          var prodPageSize = getTableRowsPerPage('dash-top-products', 'dashboard');
          var prodPages = Math.max(1, Math.ceil(products.length / prodPageSize));
          dashTopProductsPage = clampPage(dashTopProductsPage, prodPages);
          updateCardPagination('dash-top-products', dashTopProductsPage, prodPages);
          var prodStart = (dashTopProductsPage - 1) * prodPageSize;
          var productsPageRows = products.slice(prodStart, prodStart + prodPageSize);
          if (!products.length) {
            prodTbody.innerHTML = '<tr><td colspan="4" class="dash-empty">No data</td></tr>';
          } else {
            var mainBase = getMainBaseUrl();
            prodTbody.innerHTML = productsPageRows.map(function(p) {
              var title = p && p.title ? String(p.title) : 'Unknown';
              var handle = (p && p.handle) ? String(p.handle).trim().toLowerCase() : '';
              var productId = (p && p.product_id) ? String(p.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
              var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
              var canOpen = handle || (productId && /^\d+$/.test(productId));
              var titleHtml = canOpen
                ? (
                    '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                      (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                      (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                      (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
                    '>' + escapeHtml(title) + '</a>'
                  )
                : escapeHtml(title);
              var crVal = (p && typeof p.cr === 'number' && isFinite(p.cr)) ? p.cr : null;
              var sessions = (p && typeof p.sessions === 'number' && isFinite(p.sessions)) ? p.sessions : null;
              var orders = (p && typeof p.orders === 'number' && isFinite(p.orders)) ? p.orders : 0;
              var crHtml = fmtPct(crVal);
              if (sessions === 0) {
                var tip = 'No tracked product landing sessions in this period.';
                crHtml = orders > 0
                  ? ('\u2014 <i class="fa-light fa-circle-info ms-1 text-muted" aria-hidden="true" title="' + escapeHtml(tip) + '"></i>')
                  : '\u2014';
              }
              return '<tr><td><span class="product-cell">' + titleHtml + '</span></td><td class="text-end">' + fmtGbp(p.revenue) + '</td><td class="text-end">' + p.orders + '</td><td class="text-end kexo-nowrap">' + crHtml + '</td></tr>';
            }).join('');
          }
        }

        var countryTbody = el('dash-top-countries') ? el('dash-top-countries').querySelector('tbody') : null;
        if (countryTbody) {
          var countries = data.topCountries || [];
          var countryPageSize = getTableRowsPerPage('dash-top-countries', 'dashboard');
          var countryPages = Math.max(1, Math.ceil(countries.length / countryPageSize));
          dashTopCountriesPage = clampPage(dashTopCountriesPage, countryPages);
          updateCardPagination('dash-top-countries', dashTopCountriesPage, countryPages);
          var countryStart = (dashTopCountriesPage - 1) * countryPageSize;
          var countriesPageRows = countries.slice(countryStart, countryStart + countryPageSize);
          if (!countries.length) {
            countryTbody.innerHTML = '<tr><td colspan="4" class="dash-empty">No data</td></tr>';
          } else {
            countryTbody.innerHTML = countriesPageRows.map(function(c) {
              var cc = (c.country || 'XX').toUpperCase();
              var name = (typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc;
              var crVal = (c && typeof c.cr === 'number' && isFinite(c.cr)) ? c.cr : null;
              var sessions = (c && typeof c.sessions === 'number' && isFinite(c.sessions)) ? c.sessions : null;
              var orders = (c && typeof c.orders === 'number' && isFinite(c.orders)) ? c.orders : 0;
              var crHtml = fmtPct(crVal);
              if (sessions === 0) {
                var tip = 'No tracked sessions for this country in this period.';
                crHtml = orders > 0
                  ? ('\u2014 <i class="fa-light fa-circle-info ms-1 text-muted" aria-hidden="true" title="' + escapeHtml(tip) + '"></i>')
                  : '\u2014';
              }
              return '<tr><td><span style="display:inline-flex;align-items:center;gap:0.5rem">' + flagImg(cc, name) + ' ' + escapeHtml(name) + '</span></td><td class="text-end">' + fmtGbp(c.revenue) + '</td><td class="text-end">' + c.orders + '</td><td class="text-end kexo-nowrap">' + crHtml + '</td></tr>';
            }).join('');
          }
        }

        function renderTrendingTable(tableId, items, isUp) {
          var t = el(tableId);
          var tbody = t ? t.querySelector('tbody') : null;
          if (!tbody) return;
          var rows = Array.isArray(items) ? items : [];
          var pagePrefix = tableId;
          var pageSize = getTableRowsPerPage(tableId, 'dashboard');
          var pages = Math.max(1, Math.ceil(rows.length / pageSize));
          if (tableId === 'dash-trending-up') dashTrendingUpPage = clampPage(dashTrendingUpPage, pages);
          else dashTrendingDownPage = clampPage(dashTrendingDownPage, pages);
          var page = tableId === 'dash-trending-up' ? dashTrendingUpPage : dashTrendingDownPage;
          updateCardPagination(pagePrefix, page, pages);
          var pageStart = (page - 1) * pageSize;
          var pageRows = rows.slice(pageStart, pageStart + pageSize);
          if (!rows.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="dash-empty">No data</td></tr>';
            return;
          }
          function fmtSignedGbp(v) {
            var d = normalizeZeroNumber(v, 0.005);
            if (d == null) d = 0;
            var abs = Math.abs(d);
            var s = fmtGbp(abs);
            if (s === '\u2014') s = '??0.00';
            if (d > 0) return '+' + s;
            if (d < 0) return '-' + s;
            return s;
          }
          function deltaText(r) {
            var d = r && typeof r.deltaRevenue === 'number' && isFinite(r.deltaRevenue) ? r.deltaRevenue : 0;
            var cls = d >= 0 ? 'text-green' : 'text-red';
            return '<span class="dash-trend-delta ' + cls + '">' + fmtSignedGbp(d) + '</span>';
          }
          function deltaOrdersText(r) {
            var d = r && typeof r.deltaOrders === 'number' && isFinite(r.deltaOrders) ? r.deltaOrders : 0;
            var sign = d >= 0 ? '+' : '';
            var cls = d >= 0 ? 'text-green' : 'text-red';
            return '<span class="dash-trend-delta ' + cls + '">' + sign + String(d) + '</span>';
          }
          var mainBase = getMainBaseUrl();
          tbody.innerHTML = pageRows.map(function(p) {
            var title = p && p.title ? String(p.title) : 'Unknown';
            var handle = (p && p.handle) ? String(p.handle).trim().toLowerCase() : '';
            var productId = (p && p.product_id) ? String(p.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
            var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
            var canOpen = handle || (productId && /^\d+$/.test(productId));
            var titleHtml = canOpen
              ? (
                  '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                    (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                    (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                    (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
                  '>' + escapeHtml(title) + '</a>'
                )
              : escapeHtml(title);
            var ordNow = p && typeof p.ordersNow === 'number' ? p.ordersNow : 0;
            var revCell = '<div>' + deltaText(p) + '</div>';
            var ordCell = '<div>' + deltaOrdersText(p) + '</div>';
            var crCell = fmtPct(p && (typeof p.cr === 'number' ? p.cr : null));
            return '<tr><td><span class="product-cell">' + titleHtml + '</span></td><td class="text-end">' + revCell + '</td><td class="text-end">' + ordCell + '</td><td class="text-end kexo-nowrap">' + crCell + '</td></tr>';
          }).join('');
        }

        renderTrendingTable('dash-trending-up', data.trendingUp || [], true);
        renderTrendingTable('dash-trending-down', data.trendingDown || [], false);
        try {
          if (typeof window.__kexoRunStickyColumnResize === 'function') window.__kexoRunStickyColumnResize();
        } catch (_) {}
      }

      var _kexoScoreCache = null;
      var _kexoScoreRangeKey = '';

      function isElementVisiblyRendered(el) {
        if (!el) return false;
        try {
          var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
        } catch (_) {}
        return true;
      }

      function isKexoScoreEnabledByConfig() {
        try {
          var cfg = (typeof kpiUiConfigV1 !== 'undefined' && kpiUiConfigV1 && kpiUiConfigV1.v === 1) ? kpiUiConfigV1 : null;
          if (!cfg) return true;
          var headerEnabled = !(cfg.options && cfg.options.header && cfg.options.header.showKexoScore === false);
          var dashboardEnabled = true;
          var list = cfg.kpis && Array.isArray(cfg.kpis.dashboard) ? cfg.kpis.dashboard : null;
          if (list) {
            var scoreItem = list.find(function(it) {
              return it && String(it.key || '').trim().toLowerCase() === 'kexo_score';
            });
            if (scoreItem && scoreItem.enabled === false) dashboardEnabled = false;
          }
          return headerEnabled || dashboardEnabled;
        } catch (_) {
          return true;
        }
      }

      function shouldFetchKexoScore() {
        if (!isKexoScoreEnabledByConfig()) return false;
        var headerBtn = document.getElementById('header-kexo-score-wrap');
        var dashCard = document.getElementById('dash-kpi-kexo-score-card');
        if (!headerBtn && !dashCard) return false;
        if (!isElementVisiblyRendered(headerBtn) && !isElementVisiblyRendered(dashCard)) return false;
        return true;
      }

      function fetchKexoScore(rangeKey) {
        rangeKey = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
        if (!rangeKey) rangeKey = 'today';
        if (!shouldFetchKexoScore()) return Promise.resolve(null);
        var url = API + '/api/kexo-score?range=' + encodeURIComponent(rangeKey);
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'default' }, 15000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .then(function(scoreData) {
            if (scoreData && shouldFetchKexoScore()) {
              _kexoScoreCache = scoreData;
              _kexoScoreRangeKey = rangeKey;
              renderKexoScore(scoreData);
            }
            return scoreData;
          })
          .catch(function() { return null; });
      }

      function formatKexoScoreNumber(rawScore) {
        var n = Number(rawScore);
        if (!Number.isFinite(n)) return '\u2014';
        var rounded = Math.round(n * 10) / 10;
        var intRounded = Math.round(rounded);
        if (Math.abs(rounded - intRounded) < 1e-9) return String(intRounded);
        return rounded.toFixed(1).replace(/\.0$/, '');
      }

      var KEXO_RING_R = 16;
      var KEXO_RING_CIRCUMFERENCE = 2 * Math.PI * KEXO_RING_R;
      var KEXO_RING_GAP = 2;
      var KEXO_RING_SEGMENT = (KEXO_RING_CIRCUMFERENCE - 5 * KEXO_RING_GAP) / 5;
      var KEXO_RING_SEGMENT_AND_GAP = KEXO_RING_SEGMENT + KEXO_RING_GAP;
      var KEXO_RING_START_OFFSET = 0.75 * KEXO_RING_CIRCUMFERENCE;

      function applyKexoScoreRingSvg(svg, rawScore) {
        if (!svg || svg.tagName !== 'svg') return;
        var score = Number(rawScore);
        if (!Number.isFinite(score)) score = 0;
        score = Math.max(0, Math.min(100, score));
        var trackCircle = svg.querySelector('.kexo-score-ring-track');
        if (trackCircle) {
          var trackDash = KEXO_RING_SEGMENT.toFixed(2) + ' ' + KEXO_RING_GAP.toFixed(2);
          trackCircle.setAttribute('stroke-dasharray', trackDash + ' ' + trackDash + ' ' + trackDash + ' ' + trackDash + ' ' + trackDash);
          trackCircle.setAttribute('stroke-dashoffset', (-KEXO_RING_START_OFFSET).toFixed(2));
        }
        var totalFill = (score / 100) * (5 * KEXO_RING_SEGMENT);
        for (var i = 0; i < 5; i += 1) {
          var segStart = KEXO_RING_START_OFFSET + i * KEXO_RING_SEGMENT_AND_GAP;
          var fillStart = i * KEXO_RING_SEGMENT_AND_GAP;
          var filled = Math.max(0, Math.min(KEXO_RING_SEGMENT, totalFill - fillStart));
          var fillCircle = svg.querySelector('.kexo-score-ring-fill--' + (i + 1));
          if (fillCircle) {
            fillCircle.setAttribute('stroke-dasharray', filled.toFixed(2) + ' 9999');
            fillCircle.setAttribute('stroke-dashoffset', (-segStart).toFixed(2));
          }
        }
      }

      function buildHeaderKexoScoreRingBg(rawScore) {
        var score = Number(rawScore);
        if (!Number.isFinite(score)) score = 0;
        score = Math.max(0, Math.min(100, score));

        var colors = [
          'var(--kexo-accent-1, #4b94e4)',
          'var(--kexo-accent-2, #3eb3ab)',
          'var(--kexo-accent-3, #f59e34)',
          'var(--kexo-accent-4, #8b5cf6)',
          'var(--kexo-accent-5, #ef4444)'
        ];
        var track = 'var(--kexo-score-track)';
        var segDeg = 360 / colors.length;
        var gapDeg = 4;
        var halfGap = gapDeg / 2;
        var fillDeg = score * 3.6;
        var stops = [];

        for (var i = 0; i < colors.length; i += 1) {
          var segStart = i * segDeg;
          var segEnd = segStart + segDeg;
          var segFillStart = segStart + halfGap;
          var segFillEnd = segEnd - halfGap;
          var paintedEnd = Math.min(fillDeg, segFillEnd);

          stops.push('transparent ' + segStart.toFixed(2) + 'deg ' + segFillStart.toFixed(2) + 'deg');

          if (paintedEnd <= segFillStart) {
            stops.push(track + ' ' + segFillStart.toFixed(2) + 'deg ' + segFillEnd.toFixed(2) + 'deg');
          } else if (paintedEnd >= segFillEnd) {
            stops.push(colors[i] + ' ' + segFillStart.toFixed(2) + 'deg ' + segFillEnd.toFixed(2) + 'deg');
          } else {
            stops.push(colors[i] + ' ' + segFillStart.toFixed(2) + 'deg ' + paintedEnd.toFixed(2) + 'deg');
            stops.push(track + ' ' + paintedEnd.toFixed(2) + 'deg ' + segFillEnd.toFixed(2) + 'deg');
          }

          stops.push('transparent ' + segFillEnd.toFixed(2) + 'deg ' + segEnd.toFixed(2) + 'deg');
        }

        return 'conic-gradient(from -90deg, ' + stops.join(', ') + ')';
      }

      function renderKexoScore(scoreData) {
        var dashNum = document.getElementById('dash-kpi-kexo-score');
        var dashRing = document.getElementById('dash-kpi-kexo-score-ring');
        var headerNum = document.getElementById('header-kexo-score');
        var headerRing = document.getElementById('header-kexo-score-ring');
        var score = null;
        if (scoreData && typeof scoreData.score === 'number' && Number.isFinite(scoreData.score)) {
          score = Math.max(0, Math.min(100, Number(scoreData.score)));
        }
        var empty = score == null;
        var dashText = empty ? '\u2014' : formatKexoScoreNumber(score);
        var headerText = empty ? '\u2014' : String(Math.round(score));
        var pct = empty ? '0' : String(score);
        if (dashNum) { dashNum.textContent = dashText; }
        if (dashRing) dashRing.style.setProperty('--kexo-score-pct', pct);
        if (headerNum) { headerNum.textContent = headerText; }
        if (headerRing) {
          if (headerRing.tagName === 'svg') {
            applyKexoScoreRingSvg(headerRing, score);
          } else {
            headerRing.style.setProperty('--kexo-score-pct', pct);
            headerRing.style.background = buildHeaderKexoScoreRingBg(score);
          }
        }
        applyKexoScoreModalSummary(scoreData);
      }

      function applyKexoScoreModalSummary(scoreData) {
        var modalScoreNum = document.getElementById('kexo-score-modal-score');
        var modalRing = document.getElementById('kexo-score-modal-ring');
        if (!modalScoreNum && !modalRing) return;
        var score = null;
        if (scoreData && typeof scoreData.score === 'number' && Number.isFinite(scoreData.score)) {
          score = Math.max(0, Math.min(100, Number(scoreData.score)));
        }
        var empty = score == null;
        var precise = empty ? '\u2014' : score.toFixed(1);
        var pct = empty ? '0' : String(score);
        if (modalScoreNum) modalScoreNum.textContent = precise;
        if (modalRing) {
          if (modalRing.tagName === 'svg') {
            applyKexoScoreRingSvg(modalRing, score);
          } else {
            modalRing.style.setProperty('--kexo-score-pct', pct);
            modalRing.style.background = buildHeaderKexoScoreRingBg(score);
          }
        }
      }

      function disposeKexoScorePopovers(scope) {
        if (!scope || !scope.querySelectorAll) return;
        var Popover = window.bootstrap && window.bootstrap.Popover;
        if (!Popover) return;
        var nodes = Array.from(scope.querySelectorAll('[data-kexo-score-popover="1"]'));
        nodes.forEach(function(node) {
          try {
            var existing = Popover.getInstance(node);
            if (existing) { existing.hide(); existing.dispose(); }
          } catch (_) {}
        });
      }

      function initKexoScorePopovers(scope) {
        if (!scope || !scope.querySelectorAll) return;
        var Popover = window.bootstrap && window.bootstrap.Popover;
        if (!Popover) return;
        var nodes = Array.from(scope.querySelectorAll('[data-kexo-score-popover="1"]'));
        nodes.forEach(function(node) {
          try {
            var existing = Popover.getInstance(node);
            if (existing) existing.dispose();
            var popover = new Popover(node, {
              trigger: node.getAttribute('data-bs-trigger') || 'click',
              placement: node.getAttribute('data-bs-placement') || 'bottom',
              html: false,
              container: scope,
              customClass: 'kexo-score-popover',
              title: 'Kexo Score',
            });
            node.addEventListener('shown.bs.popover', function onShown() {
              var tip = node.getAttribute('aria-describedby') ? document.getElementById(node.getAttribute('aria-describedby')) : scope.querySelector('.popover.show');
              if (tip && tip.querySelector && !tip.querySelector('.kexo-score-popover-close')) {
                var header = tip.querySelector('.popover-header');
                if (header) {
                  var closeBtn = document.createElement('button');
                  closeBtn.type = 'button';
                  closeBtn.className = 'btn-close btn-close-sm kexo-score-popover-close position-absolute top-0 end-0 m-2';
                  closeBtn.setAttribute('aria-label', 'Close');
                  header.style.position = 'relative';
                  header.appendChild(closeBtn);
                }
              }
            });
          } catch (_) {}
        });
        scope.addEventListener('click', function kexoScorePopoverCloseHandler(e) {
          if (!e.target || !e.target.closest || !e.target.closest('.kexo-score-popover-close')) return;
          nodes.forEach(function(n) {
            try {
              var inst = Popover.getInstance(n);
              if (inst) inst.hide();
            } catch (_) {}
          });
        });
      }

      function openKexoScoreModal() {
        var modal = document.getElementById('kexo-score-modal');
        var body = document.getElementById('kexo-score-modal-body');
        if (!modal || !body) return;

        function fmtComponentValue(key, raw) {
          if (raw == null) return '\u2014';
          var n = Number(raw);
          if (!Number.isFinite(n)) return '\u2014';
          var k = String(key || '').trim().toLowerCase();
          if (k === 'revenue') return (typeof formatRevenue0 === 'function') ? formatRevenue0(n) : ('\u00a3' + n.toFixed(0));
          if (k === 'orders' || k === 'itemsordered' || k === 'items_ordered') return Math.round(n).toLocaleString();
          if (k === 'conversion') return (typeof pct === 'function') ? pct(n) : (n.toFixed(1) + '%');
          if (k === 'roas') return n.toFixed(2) + 'x';
          return Math.round(n * 10) / 10;
        }

        function fmtComponentDeltaPct(rawCur, rawPrev) {
          var cur = Number(rawCur);
          var prev = Number(rawPrev);
          if (!Number.isFinite(cur) || !Number.isFinite(prev)) return '';
          if (Math.abs(prev) < 1e-9) return '';
          var delta = ((cur - prev) / Math.abs(prev)) * 100;
          var rounded = Math.round(delta * 10) / 10;
          var sign = rounded > 0 ? '+' : '';
          return sign + rounded.toFixed(1) + '%';
        }

        function normalizeScoreMetricKey(rawKey) {
          var k = String(rawKey || '').trim().toLowerCase();
          if (k === 'itemsordered' || k === 'items_ordered') return 'itemsOrdered';
          return k;
        }

        function kexoScoreBarClass(scorePct) {
          var p = Number(scorePct);
          if (!Number.isFinite(p)) return 'bg-secondary';
          p = Math.max(0, Math.min(100, p));
          if (p <= 49) return 'bg-danger';
          if (p <= 75) return 'bg-secondary';
          return 'bg-success';
        }

        function animateKexoScoreBreakdownBars(scope) {
          if (!scope || !scope.querySelectorAll) return;
          var bars = Array.from(scope.querySelectorAll('.kexo-score-breakdown-row .progress-bar[data-target-pct]'));
          if (!bars.length) return;
          var reduceMotion = false;
          try { reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) {}
          bars.forEach(function(bar, idx) {
            var target = Number(bar.getAttribute('data-target-pct') || '0');
            if (!Number.isFinite(target)) target = 0;
            target = Math.max(0, Math.min(100, target));
            if (reduceMotion) {
              bar.style.transition = 'none';
              bar.style.width = target + '%';
              return;
            }
            bar.style.transition = 'none';
            bar.style.width = '0%';
            bar.offsetWidth;
            requestAnimationFrame(function() {
              requestAnimationFrame(function() {
                bar.style.transition = 'width 720ms cubic-bezier(.22,.61,.36,1)';
                bar.style.transitionDelay = String(Math.min(idx * 45, 270)) + 'ms';
                bar.style.width = target + '%';
              });
            });
          });
        }

        var data = _kexoScoreCache;
        applyKexoScoreModalSummary(data);
        var rangeKey = (typeof dashRangeKeyFromDateRange === 'function') ? dashRangeKeyFromDateRange() : (dashLastRangeKey || 'today');
        var summaryHtml = '<div class="kexo-score-summary-loading text-muted">Loading summary…</div>';
        var breakdownHtml;
        if (!data || !Array.isArray(data.components) || data.components.length === 0) {
          breakdownHtml = '<div class="kexo-score-breakdown-empty text-muted">No score data. Select a date range and refresh.</div>';
        } else {
          var metricOrder = ['revenue', 'orders', 'itemsOrdered', 'conversion', 'roas'];
          var rankByKey = {};
          metricOrder.forEach(function(key, idx) { rankByKey[key] = idx; });
          var rows = data.components.filter(function(c) {
            return Object.prototype.hasOwnProperty.call(rankByKey, normalizeScoreMetricKey(c && c.key));
          }).sort(function(a, b) {
            var aRank = rankByKey[normalizeScoreMetricKey(a && a.key)];
            var bRank = rankByKey[normalizeScoreMetricKey(b && b.key)];
            return aRank - bRank;
          });
          breakdownHtml = rows.map(function(c) {
            var label = (c.label && String(c.label).trim()) ? String(c.label) : (c.key || '');
            var score = typeof c.score === 'number' && Number.isFinite(c.score) ? Math.max(0, Math.min(100, c.score)) : 0;
            var barClass = kexoScoreBarClass(score);
            var valueStr = fmtComponentValue(c.key, c.value);
            var deltaStr = fmtComponentDeltaPct(c.value, c.previous);
            var detail = deltaStr ? (String(valueStr) + ' | ' + String(deltaStr) + ' vs previous') : String(valueStr);
            return '<div class="kexo-score-breakdown-row mb-3">' +
              '<div class="kexo-score-breakdown-head mb-1">' +
                '<span class="kexo-score-breakdown-label">' + escapeHtml(label) + '</span>' +
                '<span class="kexo-score-breakdown-value">' + escapeHtml(detail) + '</span>' +
              '</div>' +
              '<div class="progress">' +
                '<div class="progress-bar ' + barClass + '" role="progressbar" style="width:0%" data-target-pct="' + score.toFixed(1) + '" aria-valuenow="' + score + '" aria-valuemin="0" aria-valuemax="100">' + score.toFixed(0) + '</div>' +
              '</div>' +
            '</div>';
          }).join('');
        }
        body.innerHTML = '<div id="kexo-score-summary-wrap" class="kexo-score-summary-card mb-3">' + summaryHtml + '</div><div id="kexo-score-breakdown">' + breakdownHtml + '</div>';
        (function fetchAndRenderSummary(force) {
          var wrap = document.getElementById('kexo-score-summary-wrap');
          if (!wrap) return;
          if (!force) wrap.innerHTML = '<div class="kexo-score-summary-loading text-muted">Loading summary…</div>';
          var url = (typeof API !== 'undefined' ? API : '') + '/api/kexo-score-summary?range=' + encodeURIComponent(rangeKey) + (force ? '&force=1&_=' + Date.now() : '');
          fetchWithTimeout(url, { credentials: 'same-origin' }, 15000)
            .then(function(r) { return (r && r.ok) ? r.json() : null; })
            .then(function(payload) {
              if (!wrap) return;
              if (!payload || payload.ok === false) {
                wrap.innerHTML = '<p class="kexo-score-summary-text text-muted">Summary unavailable.</p>';
                return;
              }
              var summary = (payload.summary && String(payload.summary).trim()) ? escapeHtml(payload.summary) : '';
              var drivers = Array.isArray(payload.key_drivers) ? payload.key_drivers : [];
              var rec = (payload.recommendation && String(payload.recommendation).trim()) ? escapeHtml(payload.recommendation) : '';
              var parts = [];
              if (summary) parts.push('<p class="kexo-score-summary-text">' + summary + '</p>');
              if (drivers.length) parts.push('<ul class="kexo-score-summary-drivers">' + drivers.map(function(d) { return '<li>' + escapeHtml(String(d)) + '</li>'; }).join('') + '</ul>');
              if (rec) parts.push('<p class="kexo-score-summary-recommendation">' + rec + '</p>');
              if (parts.length === 0) parts.push('<p class="kexo-score-summary-text text-muted">No summary for this range.</p>');
              parts.push('<button type="button" class="btn btn-sm btn-ghost-secondary kexo-score-summary-refresh" aria-label="Refresh summary">Refresh</button>');
              wrap.innerHTML = parts.join('');
              var refreshBtn = wrap.querySelector('.kexo-score-summary-refresh');
              if (refreshBtn) refreshBtn.addEventListener('click', function() { fetchAndRenderSummary(true); });
            })
            .catch(function() {
              if (wrap) wrap.innerHTML = '<p class="kexo-score-summary-text text-muted">Summary unavailable.</p>';
            });
        })();
        var breakdownEl = document.getElementById('kexo-score-breakdown');
        disposeKexoScorePopovers(modal);
        initKexoScorePopovers(modal);
        modal.classList.remove('is-hidden');
        modal.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(function() { animateKexoScoreBreakdownBars(breakdownEl); });
      }

      function closeKexoScoreModal() {
        var modal = document.getElementById('kexo-score-modal');
        if (!modal) return;
        disposeKexoScorePopovers(modal);
        modal.classList.add('is-hidden');
        modal.setAttribute('aria-hidden', 'true');
      }

      (function initKexoScoreModalInDashboard() {
        var card = document.getElementById('dash-kpi-kexo-score-card');
        var headerBtn = document.getElementById('header-kexo-score-wrap');
        var closeBtn = document.getElementById('kexo-score-modal-close-btn');
        var modalEl = document.getElementById('kexo-score-modal');
        function openOnClick(e) {
          e.preventDefault();
          openKexoScoreModal();
        }
        if (card) {
          card.addEventListener('click', openOnClick);
          card.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openKexoScoreModal(); }
          });
        }
        if (headerBtn) {
          headerBtn.addEventListener('click', openOnClick);
          headerBtn.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openKexoScoreModal(); }
          });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeKexoScoreModal);
        if (modalEl) modalEl.addEventListener('click', function(e) { if (e.target === modalEl) closeKexoScoreModal(); });
        document.addEventListener('keydown', function(e) {
          if (e.key !== 'Escape') return;
          if (!modalEl || modalEl.classList.contains('is-hidden')) return;
          if (modalEl.getAttribute('aria-hidden') === 'true') return;
          closeKexoScoreModal();
        });
      })();

      function fetchDashboardData(rangeKey, force, opts) {
        if (dashLoading && !force) return;
        rangeKey = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
        if (!rangeKey) rangeKey = 'today';
        dashLoading = true;
        var silent = !!(opts && opts.silent);
        var build = silent ? { step: function() {}, finish: function() {} } : startReportBuild({
          key: 'dashboard',
          title: 'Preparing dashboard overview',
          initialStep: 'Loading dashboard data',
        });
        var url = API + '/api/dashboard-series?range=' + encodeURIComponent(rangeKey) + (force ? ('&force=1&_=' + Date.now()) : '');
        fetchKexoScore(rangeKey);
        fetchOverviewMiniData({ force: force });
        fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .then(function(data) {
            dashLoading = false;
            if (data) {
              build.step('Rendering dashboard panels');
              dashCache = data;
              dashLastRangeKey = rangeKey;
              renderDashboard(data);
            }
          })
          .catch(function(err) {
            try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'dashboardSeries', page: PAGE }); } catch (_) {}
            dashLoading = false;
            build.step('Dashboard data unavailable');
            console.error('[dashboard] fetch error:', err);
          })
          .finally(function() {
            build.finish();
          });
      }

      function dashRangeKeyFromDateRange() {
        // Use the same normalized API range key as KPIs/stats so Dashboard charts/tables match the header selection.
        var rk = (typeof getStatsRange === 'function') ? getStatsRange() : ((typeof dateRange === 'string') ? dateRange : 'today');
        rk = (rk == null ? '' : String(rk)).trim().toLowerCase();
        if (!rk) rk = 'today';
        return rk;
      }

      window.refreshDashboard = function(opts) {
        var force = opts && opts.force;
        var silent = !!(opts && opts.silent);
        var rk = dashRangeKeyFromDateRange();
        try {
          var curYmd = (typeof ymdNowInTz === 'function') ? ymdNowInTz() : null;
          if (curYmd && dashLastDayYmd && dashLastDayYmd !== curYmd) {
            dashCache = null;
            dashLastRangeKey = null;
            force = true;
          }
          if (curYmd) dashLastDayYmd = curYmd;
        } catch (_) {}
        if (!force && dashCache && dashLastRangeKey === rk) {
          renderDashboard(dashCache);
          fetchOverviewMiniData({ force: false });
          return;
        }
        fetchDashboardData(rk, force, { silent: silent });
      };

      window.refreshKexoScore = function() {
        fetchKexoScore(dashRangeKeyFromDateRange());
      };
      if (document.getElementById('header-kexo-score-wrap')) {
        fetchKexoScore(dashRangeKeyFromDateRange());
      }

      // Initial fetch: refreshDashboard is defined after setTab('dashboard') runs,
      // so the initial setTab call can't trigger it. Kick it off now if dashboard is active.
      var dashPanel = document.getElementById('tab-panel-dashboard');
      if (dashPanel && (dashPanel.classList.contains('active') || PAGE === 'dashboard')) {
        fetchDashboardData(dashRangeKeyFromDateRange(), false);
      }

      // Failsafe: on some post-login flows (mobile app switching, bfcache restores),
      // the first dashboard fetch can be skipped or run while hidden. If we still have
      // no cache shortly after load, trigger ONE silent refresh.
      if (PAGE === 'dashboard') {
        setTimeout(function() {
          try {
            if (dashCache) return;
            if (dashLoading) return;
            var p = document.getElementById('tab-panel-dashboard');
            if (!p) return;
            if (!(p.classList.contains('active') || PAGE === 'dashboard')) return;
            if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true });
          } catch (_) {}
        }, 1200);
      }

      // Auto-refresh dynamic ranges so "Today"/"1h" stays live without manual refresh.
      _intervals.push(setInterval(function() {
        try {
          if (document && document.visibilityState && document.visibilityState !== 'visible') return;
          var rk = dashRangeKeyFromDateRange();
          if (rk !== 'today' && rk !== '1h') return;
          var p = document.getElementById('tab-panel-dashboard');
          if (!p) return;
          if (!(p.classList.contains('active') || PAGE === 'dashboard')) return;
          if (dashLoading) return;
          if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true });
        } catch (_) {}
      }, 60000));
    })();

    // ?????? User avatar: fetch /api/me and populate ????????????????????????????????????????????????????????????????????????
    (function initUserAvatar() {
      try {
