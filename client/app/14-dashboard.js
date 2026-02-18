      var dashLastRangeKey = null;
      var dashLastDayYmd = null;
      var dashCompareSeriesCache = null;
      var dashCompareRangeKey = null;
      var dashCompareFetchedAt = 0;
      var dashCompareSeriesInFlight = null;
      var dashPayloadSignature = '';
      var dashCharts = {};
      var dashSparkCharts = {};
      var dashController = null;
      var overviewMiniResizeObserver = null;
      var overviewMiniResizeScheduled = false;
      var overviewMiniSizeSignature = '';
      var overviewMiniCache = null;
      var overviewMiniFetchedAt = 0;
      var overviewMiniInFlight = null;
      var overviewMiniCacheShopKey = '';
      var overviewMiniPayloadSignature = '';
      var overviewMiniResizeTimer = null;
      var overviewHeightSyncObserver = null;
      var overviewHeightSyncTimer = null;
      var __kexoPerfOnce = {};
      var __kexoPerfOverviewMiniCalls = 0;
      var __kexoPerfDashboardFetchCalls = 0;
      var __kexoPerfLastHeightSig = '';
      var OVERVIEW_MINI_CACHE_MS = 2 * 60 * 1000;
      var OVERVIEW_MINI_FORCE_REFRESH_MS = 5 * 60 * 1000;
      var OVERVIEW_CARD_RANGE_LS_PREFIX = 'kexo:overview-card-range:v1:';
      var OVERVIEW_CARD_DEFAULT_RANGE = '7d';
      var overviewCardCache = {}; // chartId -> { rangeKey, fetchedAt, payload }
      var overviewCardInFlight = {}; // chartId -> Promise
      var overviewCardPayloadSignature = {}; // chartId -> string
      var overviewLazyObserver = null;
      var overviewLazyPending = {};
      var overviewLazyVisible = {};
      var overviewCardUiBound = false;
      var OVERVIEW_LAZY_CHART_IDS = {
        'dash-chart-attribution-30d': true,
        'dash-chart-overview-30d': true
      };
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
        if (typeof formatRevenue0 === 'function') return formatRevenue0(v) || '\u2014';
        try { return '\u00A3' + Math.round(v).toLocaleString('en-GB'); } catch (_) { return '\u00A3' + String(Math.round(v)); }
      }
      function fmtNum(n) { return n != null ? n.toLocaleString() : '\u2014'; }
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

      function fastPayloadHash(input) {
        var str = (input == null ? '' : String(input));
        var hash = 5381;
        for (var i = 0; i < str.length; i++) {
          hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
        }
        return String(hash >>> 0);
      }

      function dashboardPayloadSignature(data, rangeKey) {
        var safeData = data && typeof data === 'object' ? data : {};
        var sigPayload = {
          range: String(rangeKey || ''),
          labels: Array.isArray(safeData.labels) ? safeData.labels : [],
          revenue: Array.isArray(safeData.revenue) ? safeData.revenue : [],
          sessions: Array.isArray(safeData.sessions) ? safeData.sessions : [],
          orders: Array.isArray(safeData.orders) ? safeData.orders : [],
          topProducts: Array.isArray(safeData.topProducts) ? safeData.topProducts : [],
          topCountries: Array.isArray(safeData.topCountries) ? safeData.topCountries : [],
          trendingUp: Array.isArray(safeData.trendingUp) ? safeData.trendingUp : [],
          trendingDown: Array.isArray(safeData.trendingDown) ? safeData.trendingDown : []
        };
        try {
          return fastPayloadHash(JSON.stringify(sigPayload) || '');
        } catch (_) {
          return fastPayloadHash(String(Date.now()));
        }
      }

      function sanitizeChartConfig(labels, datasets) {
        var srcLabels = Array.isArray(labels) ? labels : [];
        var srcDatasets = Array.isArray(datasets) ? datasets : [];
        var normalized = srcDatasets.map(function(ds) {
          var next = Object.assign({}, ds || {});
          next.data = Array.isArray(next.data) ? next.data.slice() : [];
          return next;
        });
        var maxLen = srcLabels.length;
        normalized.forEach(function(ds) {
          if (Array.isArray(ds.data) && ds.data.length > maxLen) maxLen = ds.data.length;
        });
        var outLabels = srcLabels.slice(0, maxLen).map(function(lbl, idx) {
          var text = lbl == null ? '' : String(lbl).trim();
          return text || String(idx + 1);
        });
        while (outLabels.length < maxLen) outLabels.push(String(outLabels.length + 1));
        var seen = Object.create(null);
        outLabels = outLabels.map(function(lbl) {
          var base = String(lbl || '').trim() || '—';
          var key = base.toLowerCase();
          seen[key] = (seen[key] || 0) + 1;
          return seen[key] > 1 ? (base + ' (' + String(seen[key]) + ')') : base;
        });
        normalized.forEach(function(ds) {
          if (!Array.isArray(ds.data)) ds.data = [];
          if (ds.data.length > maxLen) ds.data = ds.data.slice(0, maxLen);
          while (ds.data.length < maxLen) ds.data.push(0);
        });
        return { labels: outLabels, datasets: normalized };
      }

      function validateChartType(chartId, requestedMode, fallbackMode) {
        var fallback = String(fallbackMode || 'area').trim().toLowerCase() || 'area';
        var req = String(requestedMode || '').trim().toLowerCase();
        if (!req) req = fallback;
        try {
          if (typeof window.kexoChartMeta === 'function') {
            var meta = window.kexoChartMeta(chartId);
            var allowed = meta && Array.isArray(meta.modes) ? meta.modes.map(function(m) { return String(m).trim().toLowerCase(); }) : [];
            if (allowed.length && allowed.indexOf(req) < 0) {
              if (allowed.indexOf(fallback) >= 0) return fallback;
              if (meta && meta.defaultMode) return String(meta.defaultMode).trim().toLowerCase();
              return allowed[0];
            }
          }
        } catch (_) {}
        return req;
      }

      function formatOverviewBucketLabel(rawLabel, granularity) {
        var key = rawLabel == null ? '' : String(rawLabel).trim();
        var g = String(granularity || '').trim().toLowerCase();
        if (!key) return '';
        if (g === 'hour') {
          if (key.indexOf(' ') >= 0) return shortHourLabel(key);
          return key;
        }
        if (g === 'week') {
          if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return 'Wk ' + shortDate(key);
          return key;
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return shortDate(key);
        return key;
      }

      function normalizeOverviewCardRangeKey(raw, fallback) {
        var fb = (fallback == null ? '' : String(fallback)).trim().toLowerCase() || OVERVIEW_CARD_DEFAULT_RANGE;
        var s = (raw == null ? '' : String(raw)).trim().toLowerCase();
        if (!s) return fb;
        if (s === '7days') s = '7d';
        if (s === 'today' || s === 'yesterday' || s === '7d') return s;
        if (/^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (/^d:\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        return fb;
      }

      function overviewCardRangeStorageKey(chartId) {
        var id = (chartId == null ? '' : String(chartId)).trim().toLowerCase();
        return OVERVIEW_CARD_RANGE_LS_PREFIX + id;
      }

      function getOverviewCardRange(chartId, fallback) {
        var fb = normalizeOverviewCardRangeKey(fallback, OVERVIEW_CARD_DEFAULT_RANGE);
        var raw = '';
        try { raw = localStorage.getItem(overviewCardRangeStorageKey(chartId)) || ''; } catch (_) { raw = ''; }
        return normalizeOverviewCardRangeKey(raw, fb);
      }

      function setOverviewCardRange(chartId, rangeKey) {
        var id = (chartId == null ? '' : String(chartId)).trim().toLowerCase();
        if (!id) return;
        var rk = normalizeOverviewCardRangeKey(rangeKey, OVERVIEW_CARD_DEFAULT_RANGE);
        try { localStorage.setItem(overviewCardRangeStorageKey(id), String(rk)); } catch (_) {}
      }

      function formatYmdDayMonth(ymd) {
        var s = (ymd == null ? '' : String(ymd)).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var m = parseInt(s.slice(5, 7), 10);
        var d = parseInt(s.slice(8, 10), 10);
        if (!Number.isFinite(m) || !Number.isFinite(d)) return s;
        return String(d) + '/' + String(m);
      }

      function formatRangeKeyDayMonth(rangeKey) {
        var rk = normalizeOverviewCardRangeKey(rangeKey, '');
        if (!rk) return '';
        if (rk === 'today') return 'Today';
        if (rk === 'yesterday') return 'Yesterday';
        if (rk === '7d') return '7 Days';
        if (/^d:\d{4}-\d{2}-\d{2}$/.test(rk)) return formatYmdDayMonth(rk.slice(2));
        var m = rk.match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
        if (m && m[1] && m[2]) {
          var a = formatYmdDayMonth(m[1]);
          var b = formatYmdDayMonth(m[2]);
          if (a && b) return a + ' – ' + b;
        }
        return '7 Days';
      }

      function overviewCardRevenueSubtitle(rangeKey) {
        var rk = normalizeOverviewCardRangeKey(rangeKey, OVERVIEW_CARD_DEFAULT_RANGE);
        if (rk === '7d') return '7 Day Revenue';
        var label = formatRangeKeyDayMonth(rk);
        if (!label) return 'Revenue';
        return label + ' Revenue';
      }

      function overviewCardWrap(chartId) {
        try { return document.querySelector('[data-kexo-chart-key="' + String(chartId || '') + '"]'); } catch (_) { return null; }
      }

      function syncOverviewCardRangeUi(chartId) {
        var rk = getOverviewCardRange(chartId, OVERVIEW_CARD_DEFAULT_RANGE);
        var wrap = overviewCardWrap(chartId);
        if (wrap) {
          var btn = wrap.querySelector('.kexo-overview-range-input');
          if (btn) btn.textContent = formatRangeKeyDayMonth(rk);
        }
        try {
          var sub = document.querySelector('[data-overview-subtitle][data-chart-id="' + String(chartId || '') + '"]');
          if (sub) sub.textContent = overviewCardRevenueSubtitle(rk);
        } catch (_) {}
      }

      function syncAllOverviewCardRangeUi() {
        try { overviewMiniChartIds().forEach(function (id) { syncOverviewCardRangeUi(id); }); } catch (_) {}
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

      function truncatePinTitle(s) {
        var v = s == null ? '' : String(s).trim();
        if (!v) return '';
        return v.length > 26 ? (v.slice(0, 25) + '…') : v;
      }

      function buildPinAnnotationsForCategories(categoryLabels, pins) {
        var labels = Array.isArray(categoryLabels) ? categoryLabels : [];
        var list = Array.isArray(pins) ? pins : [];
        if (!labels.length || !list.length) return [];
        var idx = new Map();
        for (var i = 0; i < labels.length; i++) {
          var key = labels[i] != null ? String(labels[i]) : '';
          if (!key) continue;
          if (!idx.has(key)) idx.set(key, i);
        }
        var out = [];
        for (var j = 0; j < list.length; j++) {
          var p = list[j] || {};
          var ymd = p.event_ymd ? String(p.event_ymd) : '';
          if (!ymd) continue;
          var cands = [];
          cands.push(ymd);
          try { cands.push(shortDate(ymd)); } catch (_) {}
          var matchedLabel = null;
          for (var k = 0; k < cands.length; k++) {
            var c = cands[k];
            if (!c) continue;
            if (idx.has(c)) { matchedLabel = c; break; }
          }
          if (!matchedLabel) continue;
          var text = truncatePinTitle(p.title || '') || 'Pin';
          out.push({
            x: matchedLabel,
            borderColor: 'rgba(15,23,42,0.35)',
            strokeDashArray: 0,
            label: {
              text: text,
              borderColor: 'rgba(15,23,42,0.55)',
              style: {
                background: 'rgba(15,23,42,0.75)',
                color: '#ffffff',
                fontSize: '10px',
                fontWeight: 500,
              },
              offsetY: -6,
            },
          });
        }
        return out;
      }

      function applyChangePinsOverlayToChart(chartId, chart, categoryLabels) {
        if (!chart || !categoryLabels || !categoryLabels.length) return;
        if (typeof window === 'undefined') return;
        var cached = null;
        try {
          cached = (typeof window.__kexoReadChangePinsRecentCache === 'function') ? window.__kexoReadChangePinsRecentCache() : null;
        } catch (_) {}
        var ann = buildPinAnnotationsForCategories(categoryLabels, cached);
        if (ann && ann.length) {
          try {
            if (dashCharts && dashCharts[chartId] !== chart) return;
            chart.updateOptions({ annotations: { xaxis: ann } }, false, true);
          } catch (_) {}
          return;
        }
        try {
          if (typeof window.__kexoGetChangePinsRecent !== 'function') return;
          window.__kexoGetChangePinsRecent(120, false).then(function (pins) {
            if (!pins) return;
            var nextAnn = buildPinAnnotationsForCategories(categoryLabels, pins);
            if (!nextAnn || !nextAnn.length) return;
            try {
              if (dashCharts && dashCharts[chartId] !== chart) return;
              chart.updateOptions({ annotations: { xaxis: nextAnn } }, false, true);
            } catch (_) {}
          });
        } catch (_) {}
      }

      function upsertDashboardApexChart(chartId, chartEl, apexOpts, afterRender) {
        if (!chartEl || !apexOpts || typeof ApexCharts === 'undefined') return null;
        var existing = dashCharts && dashCharts[chartId] ? dashCharts[chartId] : null;
        var series = Array.isArray(apexOpts.series) ? apexOpts.series : [];
        if (existing && typeof existing.updateOptions === 'function' && typeof existing.updateSeries === 'function') {
          try {
            var optsNoSeries = Object.assign({}, apexOpts);
            delete optsNoSeries.series;
            existing.updateOptions(optsNoSeries, false, true, false);
            existing.updateSeries(series, false);
            if (typeof afterRender === 'function') {
              setTimeout(function() {
                try { afterRender(existing); } catch (_) {}
              }, 0);
            }
            return existing;
          } catch (updateErr) {
            try { existing.destroy(); } catch (_) {}
            try { delete dashCharts[chartId]; } catch (_) {}
            captureChartError(updateErr, 'dashboardChartUpdate', { chartId: chartId });
          }
        }
        chartEl.innerHTML = '';
        var chart = new ApexCharts(chartEl, apexOpts);
        dashCharts[chartId] = chart;
        var rendered = null;
        try { rendered = chart.render(); } catch (_) { rendered = null; }
        if (rendered && typeof rendered.then === 'function') {
          rendered.then(function() {
            if (typeof afterRender === 'function') afterRender(chart);
          }).catch(function() {});
        } else if (typeof afterRender === 'function') {
          setTimeout(function() { afterRender(chart); }, 0);
        }
        return chart;
      }

      function makeChart(chartId, labels, datasets, opts) {
        if (typeof ApexCharts === 'undefined') {
          waitForApexCharts(function() { makeChart(chartId, labels, datasets, opts); });
          return null;
        }
        if (!chartId) return null;
        var el = document.getElementById(chartId);
        if (!el) { console.warn('[dashboard] chart element not found:', chartId); return null; }

        var chartScope = (opts && opts.chartScope) ? String(opts.chartScope) : ('dashboard-' + chartId);
        var defaultType = (opts && opts.chartType) || 'area';
        var requestedMode = chartModeFromUiConfig(chartId, defaultType) || defaultType;
        requestedMode = validateChartType(chartId, requestedMode, defaultType);
        var showEndLabels = requestedMode === 'multi-line-labels';
        var stacked = requestedMode === 'stacked-area' || requestedMode === 'stacked-bar';
        var chartType = requestedMode === 'multi-line-labels' ? 'line' : requestedMode === 'stacked-area' ? 'area' : requestedMode === 'stacked-bar' ? 'bar' : requestedMode === 'combo' ? 'area' : requestedMode;
        chartType = normalizeChartType(chartType, normalizeChartType(defaultType, 'area'));

        if (!isChartEnabledByUiConfig(chartId, true)) {
          try { if (dashCharts[chartId]) dashCharts[chartId].destroy(); } catch (_) {}
          dashCharts[chartId] = null;
          el.innerHTML = '';
          return null;
        }

        var normalized = sanitizeChartConfig(labels, datasets);
        labels = normalized.labels;
        datasets = normalized.datasets;

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

        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        var horizontal = !(opts && opts.horizontal === false);
        var fillOpacityVal = (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : null;
        var areaOpacityFrom = (opts && typeof opts.areaOpacityFrom === 'number' && isFinite(opts.areaOpacityFrom)) ? opts.areaOpacityFrom : 0.15;
        var areaOpacityTo = (opts && typeof opts.areaOpacityTo === 'number' && isFinite(opts.areaOpacityTo)) ? opts.areaOpacityTo : 0.02;
        var chartHeight = (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 200;
        if (!Number.isFinite(chartHeight) || chartHeight < 80) chartHeight = 200;
        try {
          if (typeof chartSizePercentFromUiConfig === 'function') {
            var pct = chartSizePercentFromUiConfig(chartId, 100);
            if (Number.isFinite(pct) && pct > 0 && pct !== 100) {
              chartHeight = Math.round(chartHeight * (pct / 100));
              if (chartHeight < 80) chartHeight = 80;
            }
          }
        } catch (_) {}

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
            : (opts && opts.currency) ? function(v) {
              if (v == null) return '\u2014';
              var n = Number(v);
              if (!isFinite(n)) return '\u2014';
              if (typeof formatRevenue0 === 'function') return formatRevenue0(n) || '\u2014';
              try { return '\u00A3' + Math.round(n).toLocaleString('en-GB'); } catch (_) { return '\u00A3' + String(Math.round(n)); }
            }
            : function(v) { return v != null ? Number(v).toLocaleString() : '\u2014'; };
          var legendPos = (opts && opts.legendPosition != null) ? String(opts.legendPosition).trim().toLowerCase() : 'top';
          if (legendPos !== 'top' && legendPos !== 'bottom' && legendPos !== 'left' && legendPos !== 'right') legendPos = 'top';
          var customTooltip = (opts && typeof opts.tooltipCustom === 'function') ? opts.tooltipCustom : null;
          var tooltipShared = (opts && typeof opts.tooltipShared === 'boolean') ? !!opts.tooltipShared : (apexSeries.length > 1);
          var tooltipIntersect = (opts && typeof opts.tooltipIntersect === 'boolean') ? !!opts.tooltipIntersect : false;
          var tooltipFollowCursor = (opts && typeof opts.tooltipFollowCursor === 'boolean') ? !!opts.tooltipFollowCursor : false;
          var tooltipConfig = {
            enabled: true,
            // For dense charts (especially the Overview Revenue/Cost/Profit), avoid requiring a direct point intersect.
            intersect: tooltipIntersect,
            shared: tooltipShared,
            followCursor: tooltipFollowCursor,
            y: { formatter: yFmt }
          };
          if (customTooltip) tooltipConfig.custom = customTooltip;

          var baseOpacity = fillOpacityVal != null ? fillOpacityVal : 1;
          var areaFrom = fillOpacityVal != null ? fillOpacityVal * areaOpacityFrom : areaOpacityFrom;
          var areaTo = fillOpacityVal != null ? fillOpacityVal * areaOpacityTo : areaOpacityTo;
          var fillConfig = chartType === 'line' ? { type: 'solid', opacity: baseOpacity }
            : chartType === 'bar' ? { type: 'solid', opacity: baseOpacity }
            : { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: areaFrom, opacityTo: areaTo, stops: [0, 100] } };
          var animationsEnabled = !!(uiStyle && uiStyle.animations === true);

          var markerSize = (opts && Number.isFinite(Number(opts.markerSize)))
            ? Math.max(0, Number(opts.markerSize))
            : (chartType === 'line' ? 3 : 0);
          var apexOpts = {
            chart: {
              type: chartType,
              height: chartHeight,
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
              animations: { enabled: animationsEnabled, easing: 'easeinout', speed: 300 },
              zoom: { enabled: false }
            },
            series: apexSeries,
            colors: colors,
            stroke: { show: true, width: chartType === 'bar' ? 0 : 2, curve: 'smooth', lineCap: 'round' },
            fill: fillConfig,
            plotOptions: chartType === 'bar' ? { bar: { columnWidth: stacked ? '80%' : '60%', borderRadius: 3, stacked: stacked } } : (chartType === 'area' && stacked ? { area: { stacked: true } } : {}),
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
            tooltip: tooltipConfig,
            legend: { show: apexSeries.length > 1, position: legendPos, fontSize: '11px' },
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
              offsetY: -3
            } : { enabled: false },
            markers: { size: markerSize, hover: { size: 5 } },
            noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
          };
          if (stacked) {
            apexOpts.chart.stacked = true;
            apexOpts.chart.stackType = 'normal';
          }
          try {
            var chartOverride = chartAdvancedOverrideFromUiConfig(chartId, chartType);
            if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) {
              apexOpts = deepMergeOptions(apexOpts, chartOverride);
            }
          } catch (_) {}
          if (opts && opts.forceTooltip === true) {
            apexOpts.tooltip = Object.assign({}, apexOpts.tooltip || {}, {
              enabled: true,
              shared: true,
              intersect: false,
              followCursor: true
            });
          }

          return upsertDashboardApexChart(chartId, el, apexOpts, function(chart) {
            try { applyChangePinsOverlayToChart(chartId, chart, labels || []); } catch (_) {}
          });
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

      var OVERVIEW_HEADER_GAP_PX = 8;
      var OVERVIEW_HEADER_FALLBACK_PX = 52;
      var OVERVIEW_MINI_FOOTER_FALLBACK_PX = 32;
      var OVERVIEW_MINI_EXTRA_BUFFER_PX = 10;
      function resolveOverviewChartHeight(chartEl, fallback, min, max) {
        var _dbgOn = false;
        var _dbgId = '';
        try {
          _dbgOn = !!(window && typeof window.__kexoPerfDebugEnabled === 'function' && window.__kexoPerfDebugEnabled());
          _dbgId = chartEl && chartEl.id ? String(chartEl.id) : '';
        } catch (_) { _dbgOn = false; _dbgId = ''; }
        var _dbgKey = _dbgId ? ('resolveOverviewChartHeight:' + _dbgId) : '';
        var _dbgCardH = 0;
        var _dbgAvail = 0;
        var _dbgUsedCard = false;
        var _dbgHeaderPx = 0;
        var fb = Number(fallback);
        if (!Number.isFinite(fb) || fb <= 0) fb = 220;
        var lo = Number(min);
        if (!Number.isFinite(lo) || lo <= 0) lo = 120;
        var hi = Number(max);
        if (!Number.isFinite(hi) || hi <= 0) hi = 720;
        var h = 0;
        try {
          if (chartEl) {
            var ch = chartEl.clientHeight;
            if (Number.isFinite(ch) && ch > 0) h = ch;
            var rect = chartEl.getBoundingClientRect ? chartEl.getBoundingClientRect() : null;
            if (rect && Number.isFinite(rect.height) && rect.height > 0) h = rect.height;
            if (chartEl.parentElement) {
              var parent = chartEl.parentElement;
              var ph = parent.clientHeight;
              if (Number.isFinite(ph) && ph > 0) h = ph;
              var pRect = parent.getBoundingClientRect ? parent.getBoundingClientRect() : null;
              if (pRect && Number.isFinite(pRect.height) && pRect.height > 0) h = pRect.height;
              var card = parent.closest ? parent.closest('.kexo-overview-mini-card, .kexo-overview-main-card') : null;
              if (card && card.getBoundingClientRect) {
                var cardH = card.getBoundingClientRect().height;
                var isMini = false;
                try { isMini = !!(card.classList && card.classList.contains('kexo-overview-mini-card')); } catch (_) { isMini = false; }
                var headEl = card.querySelector ? card.querySelector('.kexo-overview-card-head') : null;
                var headerPx = OVERVIEW_HEADER_FALLBACK_PX;
                if (headEl && headEl.getBoundingClientRect) {
                  var headRect = headEl.getBoundingClientRect();
                  if (Number.isFinite(headRect.height) && headRect.height > 0) headerPx = headRect.height + OVERVIEW_HEADER_GAP_PX;
                }
                var totalsEl = card.querySelector ? card.querySelector('.kexo-overview-running-totals') : null;
                if (totalsEl && totalsEl.getBoundingClientRect && !(headEl && headEl.contains && headEl.contains(totalsEl))) {
                  var totalsRect = totalsEl.getBoundingClientRect();
                  if (Number.isFinite(totalsRect.height) && totalsRect.height > 0) {
                    headerPx += totalsRect.height + OVERVIEW_HEADER_GAP_PX;
                  }
                }
                if (isMini) {
                  try {
                    var lid = chartEl && chartEl.id ? String(chartEl.id) : '';
                    var footerPx = 0;
                    var legendEl = lid && card.querySelector ? card.querySelector('[data-overview-legend="' + lid + '"]') : null;
                    if (legendEl && legendEl.getBoundingClientRect) {
                      var legendRect = legendEl.getBoundingClientRect();
                      if (legendRect && Number.isFinite(legendRect.height) && legendRect.height > 0) {
                        footerPx += legendRect.height + OVERVIEW_HEADER_GAP_PX;
                      } else {
                        footerPx += OVERVIEW_MINI_FOOTER_FALLBACK_PX;
                      }
                    } else if (legendEl) {
                      footerPx += OVERVIEW_MINI_FOOTER_FALLBACK_PX;
                    }
                    var iconRowEl = card.querySelector ? card.querySelector('.dash-attribution-icon-row') : null;
                    if (iconRowEl && iconRowEl.getBoundingClientRect) {
                      var iconRect = iconRowEl.getBoundingClientRect();
                      if (iconRect && Number.isFinite(iconRect.height) && iconRect.height > 0) {
                        footerPx += iconRect.height + OVERVIEW_HEADER_GAP_PX;
                      }
                    }
                    if (footerPx > 0) headerPx += footerPx;
                  } catch (_) {}
                  headerPx += OVERVIEW_MINI_EXTRA_BUFFER_PX;
                }
                var minBuffer = Math.max(OVERVIEW_HEADER_FALLBACK_PX, headerPx);
                if (Number.isFinite(cardH) && cardH > minBuffer) {
                  var avail = cardH - headerPx;
                  if (avail > lo) h = avail;
                  _dbgUsedCard = true;
                  _dbgCardH = Math.round(cardH);
                  _dbgAvail = Math.round(avail);
                  _dbgHeaderPx = Math.round(headerPx);
                }
              }
            }
          }
        } catch (_) {}
        if (!Number.isFinite(h) || h <= 0) h = fb;
        h = Math.max(lo, Math.min(hi, h));
        var out = Math.round(h);
        // #region agent log
        if (_dbgOn && _dbgKey && !__kexoPerfOnce[_dbgKey]) {
          __kexoPerfOnce[_dbgKey] = 1;
          fetch('http://127.0.0.1:7242/ingest/a370db6d-7333-4112-99f8-dd4bc899a89b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'14-dashboard.js:resolveOverviewChartHeight',message:'resolved overview chart height',data:{chartId:_dbgId,fallback:fb,min:lo,max:hi,headerPx:_dbgHeaderPx,used_card:!!_dbgUsedCard,card_h:_dbgCardH,avail:_dbgAvail,out:out},timestamp:Date.now(),runId:(typeof window.__kexoPerfDebugRunId==='function'?window.__kexoPerfDebugRunId():'baseline'),hypothesisId:'H2'} )}).catch(()=>{});
        }
        // #endregion
        return out;
      }

      function scaleHeightForChartSizePercent(chartId, height, min, max) {
        var h = Number(height);
        if (!Number.isFinite(h) || h <= 0) return height;
        try {
          if (typeof chartSizePercentFromUiConfig === 'function') {
            var pct = chartSizePercentFromUiConfig(chartId, 100);
            if (Number.isFinite(pct) && pct > 0 && pct !== 100) {
              h = Math.round(h * (pct / 100));
            }
          }
        } catch (_) {}
        if (Number.isFinite(min) && h < min) h = min;
        if (Number.isFinite(max) && h > max) h = max;
        return Math.round(h);
      }

      function overviewMiniChartIds() {
        return ['dash-chart-finishes-30d', 'dash-chart-devices-30d', 'dash-chart-attribution-30d', 'dash-chart-overview-30d'];
      }

      function clearOverviewHeightSyncStyles() {
        try {
          document.querySelectorAll('.kexo-overview-mini-row .kexo-overview-mini-card').forEach(function(card) {
            if (!card || !card.style) return;
            card.style.height = '';
            card.style.minHeight = '';
            card.style.maxHeight = '';
          });
        } catch (_) {}
        try {
          var mainCard = document.querySelector('[data-kexo-chart-key="dash-chart-overview-30d"] .kexo-overview-main-card');
          if (mainCard && mainCard.style) {
            mainCard.style.height = '';
            mainCard.style.minHeight = '';
          }
        } catch (_) {}
      }

      function syncOverviewHeightGrid() {
        var topGrid = document.getElementById('dash-kpi-grid');
        var midGrid = document.getElementById('dash-kpi-grid-mid');
        if (!topGrid) return;
        var desktop = false;
        try { desktop = !!(window && window.matchMedia && window.matchMedia('(min-width: 1200px)').matches); } catch (_) { desktop = false; }
        if (!desktop) {
          clearOverviewHeightSyncStyles();
          return;
        }
        var topHeight = 0;
        try {
          var topRect = topGrid.getBoundingClientRect ? topGrid.getBoundingClientRect() : null;
          if (topRect && Number.isFinite(topRect.height) && topRect.height > 0) topHeight = Math.max(0, Math.round(topRect.height) - 16);
        } catch (_) {}
        var midHeight = 0;
        try {
          if (midGrid && midGrid.getBoundingClientRect) {
            var midRect = midGrid.getBoundingClientRect();
            if (midRect && Number.isFinite(midRect.height) && midRect.height > 0) midHeight = Math.max(0, Math.round(midRect.height) - 16);
          }
        } catch (_) {}
        var miniHeight = midHeight > 0 ? midHeight : topHeight;
        if (miniHeight > 0) {
          try {
            document.querySelectorAll('.kexo-overview-mini-row .kexo-overview-mini-card').forEach(function(card) {
              if (!card || !card.style) return;
              card.style.height = String(miniHeight) + 'px';
              card.style.minHeight = String(miniHeight) + 'px';
              card.style.maxHeight = String(miniHeight) + 'px';
            });
          } catch (_) {}
        }
        var mainHeight = topHeight > 0 ? topHeight : midHeight;
        if (mainHeight > 0) {
          try {
            var mainCard = document.querySelector('[data-kexo-chart-key="dash-chart-overview-30d"] .kexo-overview-main-card');
            if (mainCard && mainCard.style) {
              mainCard.style.height = String(mainHeight) + 'px';
              mainCard.style.minHeight = String(mainHeight) + 'px';
            }
          } catch (_) {}
        }
        if (mainHeight > 0 || miniHeight > 0) {
          try {
            overviewMiniChartIds().forEach(function(chartId) {
              var chart = dashCharts && dashCharts[chartId];
              if (!chart || typeof chart.updateOptions !== 'function') return;
              var chartEl = document.getElementById(chartId);
              if (!chartEl) return;
              var h = resolveOverviewChartHeight(chartEl, 180, 120, 440);
              h = scaleHeightForChartSizePercent(chartId, h, 120, 440);
              if (h > 0) chart.updateOptions({ chart: { height: h } }, false, false, false);
            });
          } catch (_) {}
        }
        // #region agent log
        try {
          var _dbgOn = !!(window && typeof window.__kexoPerfDebugEnabled === 'function' && window.__kexoPerfDebugEnabled());
          if (_dbgOn) {
            var sig = String(desktop ? 1 : 0) + '|' + String(topHeight) + '|' + String(midHeight) + '|' + String(mainHeight);
            if (sig !== __kexoPerfLastHeightSig) {
              __kexoPerfLastHeightSig = sig;
              fetch('http://127.0.0.1:7242/ingest/a370db6d-7333-4112-99f8-dd4bc899a89b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'14-dashboard.js:syncOverviewHeightGrid',message:'overview height sync',data:{desktop:!!desktop,topHeight:topHeight,midHeight:midHeight,mainHeight:mainHeight},timestamp:Date.now(),runId:(typeof window.__kexoPerfDebugRunId==='function'?window.__kexoPerfDebugRunId():'baseline'),hypothesisId:'H2'} )}).catch(()=>{});
            }
          }
        } catch (_) {}
        // #endregion
      }

      function scheduleOverviewHeightSync() {
        if (overviewHeightSyncTimer) {
          try { clearTimeout(overviewHeightSyncTimer); } catch (_) {}
        }
        overviewHeightSyncTimer = setTimeout(function() {
          overviewHeightSyncTimer = null;
          var raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : function(f) { f(); };
          raf(function() {
            syncOverviewHeightGrid();
          });
          // Do not re-render charts here (ResizeObserver feedback loop).
        }, 80);
      }

      function ensureOverviewHeightSyncObserver() {
        if (overviewHeightSyncObserver || typeof ResizeObserver === 'undefined') return;
        overviewHeightSyncObserver = new ResizeObserver(function() {
          scheduleOverviewHeightSync();
        });
        try {
          var topGrid = document.getElementById('dash-kpi-grid');
          var midGrid = document.getElementById('dash-kpi-grid-mid');
          // Avoid observing chart containers/rows directly: chart rendering changes their size.
          if (topGrid) overviewHeightSyncObserver.observe(topGrid);
          if (midGrid) overviewHeightSyncObserver.observe(midGrid);
        } catch (_) {}
        try {
          window.addEventListener('resize', scheduleOverviewHeightSync);
        } catch (_) {}
      }

      function setOverviewMiniCardValue(id, text) {
        var target = document.getElementById(id);
        if (!target) return;
        target.textContent = text != null && String(text).trim() ? String(text) : '\u2014';
      }

      function setOverviewMiniDelta(prefix, cur, prev, opts) {
        var o = opts && typeof opts === 'object' ? opts : {};
        var invert = !!o.invert;
        var wrap = document.getElementById(prefix + '-delta');
        var textEl = document.getElementById(prefix + '-delta-text');
        if (!wrap || !textEl) return;

        var c = (typeof cur === 'number') ? cur : Number(cur);
        var p = (typeof prev === 'number') ? prev : Number(prev);
        if (!Number.isFinite(c) || !Number.isFinite(p) || Math.abs(p) < 1e-9) {
          wrap.classList.add('is-hidden');
          wrap.classList.remove('is-up', 'is-down', 'is-flat');
          wrap.setAttribute('data-dir', 'none');
          textEl.textContent = '\u2014';
          return;
        }

        var ratio = (c - p) / Math.abs(p);
        if (invert) ratio = -ratio;
        var rounded = Math.round(ratio * 1000) / 10; // 1dp
        var sign = rounded > 0 ? '+' : '';
        var text = sign + rounded.toFixed(1) + '%';

        var dir = 'flat';
        if (rounded > 0.05) dir = 'up';
        else if (rounded < -0.05) dir = 'down';

        wrap.classList.remove('is-hidden');
        wrap.classList.remove('is-up', 'is-down', 'is-flat');
        if (dir === 'up') wrap.classList.add('is-up');
        else if (dir === 'down') wrap.classList.add('is-down');
        else wrap.classList.add('is-flat');
        wrap.setAttribute('data-dir', dir);
        textEl.textContent = text;
      }

      function renderOverviewMiniCardStats(context) {
        var ctx = context && typeof context === 'object' ? context : {};
        function moneyText(value) {
          if (typeof formatRevenue0 === 'function') return formatRevenue0(normalizeOverviewMetric(value)) || '\u2014';
          return fmtGbp(normalizeOverviewMetric(value));
        }

        // Revenue cards should use a single truth total for the period (not “top N” sums),
        // otherwise the headline number won’t reconcile with the rest of the dashboard.
        var revNow = normalizeOverviewMetric(ctx.revenueNow);
        var revPrev = normalizeOverviewMetric(ctx.revenuePrev);
        var attrRevNow = normalizeOverviewMetric(ctx.attributionRevenueNow);
        var attrRevPrev = normalizeOverviewMetric(ctx.attributionRevenuePrev);

        setOverviewMiniCardValue('dash-mini-finishes-value', moneyText(revNow));
        setOverviewMiniCardValue('dash-mini-countries-value', moneyText(revNow));
        setOverviewMiniCardValue('dash-mini-attribution-value', moneyText(attrRevNow));

        setOverviewMiniDelta('dash-mini-finishes', revNow, revPrev);
        setOverviewMiniDelta('dash-mini-countries', revNow, revPrev);
        setOverviewMiniDelta('dash-mini-attribution', attrRevNow, attrRevPrev);
      }

      function quantizeOverviewMiniSize(value) {
        var n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        // Bucket to 16px to avoid ResizeObserver feedback loops and micro-resize rerenders.
        return Math.round(n / 16) * 16;
      }

      function overviewMiniPayloadSig(payload) {
        try { return JSON.stringify(payload || null) || ''; } catch (_) { return ''; }
      }

      function overviewMiniStyleSig() {
        try {
          if (typeof chartStyleFromUiConfig !== 'function') return '';
          function miniChartCfg(key, fallbackMode, fallbackColors) {
            return {
              enabled: (typeof isChartEnabledByUiConfig === 'function') ? isChartEnabledByUiConfig(key, true) : true,
              mode: (typeof chartModeFromUiConfig === 'function') ? chartModeFromUiConfig(key, fallbackMode) : fallbackMode,
              colors: (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(key, fallbackColors || []) : (fallbackColors || []),
              style: chartStyleFromUiConfig(key) || {},
            };
          }
          return JSON.stringify({
            finishes: miniChartCfg('dash-chart-finishes-30d', 'radialbar', ['#f59e34']),
            devices: miniChartCfg('dash-chart-devices-30d', 'bar-horizontal', ['#4b94e4']),
            attribution: miniChartCfg('dash-chart-attribution-30d', 'donut', ['#4b94e4']),
            overview: miniChartCfg('dash-chart-overview-30d', 'bar', ['#3eb3ab', '#ef4444']),
          }) || '';
        } catch (_) {
          return '';
        }
      }

      function computeOverviewMiniSizeSignature() {
        var ids = overviewMiniChartIds();
        return ids.map(function(id) {
          var el = document.getElementById(id);
          if (!el || !el.getBoundingClientRect) return id + ':0x0';
          var r = el.getBoundingClientRect();
          var w = quantizeOverviewMiniSize(r.width);
          // Deliberately ignore height here. Height can be content-driven (SVG rendering) and
          // cause ResizeObserver feedback loops. Width changes are the meaningful signal for
          // re-rendering these charts.
          return id + ':' + w;
        }).join('|');
      }

      function scheduleOverviewMiniResizeRender() {
        if (overviewMiniResizeScheduled) return;
        overviewMiniResizeScheduled = true;
        if (overviewMiniResizeTimer) {
          try { clearTimeout(overviewMiniResizeTimer); } catch (_) {}
          overviewMiniResizeTimer = null;
        }
        overviewMiniResizeTimer = setTimeout(function() {
          overviewMiniResizeTimer = null;
          overviewMiniResizeScheduled = false;
          if (!overviewCardCache || !Object.keys(overviewCardCache).length) return;
          var sig = computeOverviewMiniSizeSignature();
          if (sig && sig === overviewMiniSizeSignature) return;
          overviewMiniSizeSignature = sig;
          rerenderOverviewCardsFromCache({ reason: 'resize' });
        }, 300);
      }

      function ensureOverviewMiniResizeObserver() {
        if (overviewMiniResizeObserver || typeof ResizeObserver === 'undefined') return;
        ensureOverviewHeightSyncObserver();
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
        try {
          if (overviewMiniResizeTimer) clearTimeout(overviewMiniResizeTimer);
        } catch (_) {}
        try {
          if (overviewHeightSyncObserver && typeof overviewHeightSyncObserver.disconnect === 'function') {
            overviewHeightSyncObserver.disconnect();
          }
        } catch (_) {}
        try {
          if (overviewLazyObserver && typeof overviewLazyObserver.disconnect === 'function') {
            overviewLazyObserver.disconnect();
          }
        } catch (_) {}
        try {
          if (overviewHeightSyncTimer) clearTimeout(overviewHeightSyncTimer);
        } catch (_) {}
        try {
          window.removeEventListener('resize', scheduleOverviewHeightSync);
        } catch (_) {}
        overviewMiniResizeTimer = null;
        overviewMiniResizeObserver = null;
        overviewHeightSyncObserver = null;
        overviewHeightSyncTimer = null;
        overviewMiniResizeScheduled = false;
        overviewMiniSizeSignature = '';
        overviewMiniCacheShopKey = '';
        overviewMiniPayloadSignature = '';
        dashPayloadSignature = '';
        overviewMiniCache = null;
        overviewMiniFetchedAt = 0;
        overviewMiniInFlight = null;
        overviewCardCache = {};
        overviewCardInFlight = {};
        overviewCardPayloadSignature = {};
        overviewLazyObserver = null;
        overviewLazyPending = {};
        overviewLazyVisible = {};
        clearOverviewHeightSyncStyles();
        try {
          Object.keys(dashSparkCharts || {}).forEach(function (id) {
            var chart = dashSparkCharts[id];
            if (chart && typeof chart.destroy === 'function') chart.destroy();
          });
        } catch (_) {}
        dashSparkCharts = {};
        try {
          overviewMiniChartIds().forEach(function (chartId) {
            destroyDashChart(chartId);
          });
        } catch (_) {}
      });

      function renderOverviewChartEmpty(chartId, text) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl) return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          if (String(chartId || '') === 'dash-chart-overview-30d') {
            setOverviewSalesRunningTotals(null, null, null);
            setOverviewCostBreakdownTooltip(null);
          }
          return;
        }
        destroyDashChart(chartId);
        chartEl.innerHTML = '<div class="kexo-overview-chart-empty">' + escapeHtml(text || 'No data available') + '</div>';
        if (String(chartId || '') === 'dash-chart-overview-30d') {
          setOverviewSalesRunningTotals(null, null, null);
          setOverviewCostBreakdownTooltip(null);
        }
      }

      function renderOverviewChartLoading(chartId, text) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl) return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          if (String(chartId || '') === 'dash-chart-overview-30d') {
            setOverviewSalesRunningTotals(null, null, null);
            setOverviewCostBreakdownTooltip(null);
          }
          return;
        }
        destroyDashChart(chartId);
        chartEl.innerHTML = '<div class="kexo-overview-chart-empty is-loading"><span class="kpi-mini-spinner" aria-hidden="true"></span><span>' + escapeHtml(text || 'Loading...') + '</span></div>';
        if (String(chartId || '') === 'dash-chart-overview-30d') {
          setOverviewSalesRunningTotals(null, null, null);
          setOverviewCostBreakdownTooltip(null);
        }
      }

      function showOverviewMiniLoadingState() {
        setOverviewMiniCardValue('dash-mini-finishes-value', '\u2014');
        setOverviewMiniCardValue('dash-mini-countries-value', '\u2014');
        setOverviewMiniCardValue('dash-mini-attribution-value', '\u2014');
        renderOverviewChartLoading('dash-chart-finishes-30d', 'Loading finishes...');
        renderOverviewChartLoading('dash-chart-devices-30d', 'Loading devices...');
        renderOverviewChartLoading('dash-chart-attribution-30d', 'Loading attribution...');
        renderOverviewChartLoading('dash-chart-overview-30d', 'Loading 7 day overview...');
      }

      function countryCodeToFlagEmoji(rawCode) {
        var code = rawCode == null ? '' : String(rawCode).trim().toUpperCase();
        if (code === 'UK') code = 'GB';
        if (!/^[A-Z]{2}$/.test(code)) return '';
        var A = 0x1f1e6;
        return String.fromCodePoint(A + (code.charCodeAt(0) - 65), A + (code.charCodeAt(1) - 65));
      }
      function countryCodeToFlagHtml(rawCode) {
        var code = rawCode == null ? '' : String(rawCode).trim().toUpperCase().slice(0, 2);
        if (code === 'UK') code = 'GB';
        if (!/^[A-Z]{2}$/.test(code)) {
          return '<span class="kexo-flag-fallback" aria-hidden="true" style="display:inline-flex;align-items:center;margin-right:4px;opacity:.8"><i class="fa-light fa-globe"></i></span>';
        }
        var raw = code.toLowerCase();
        return '<span class="flag flag-xs flag-country-' + escapeHtml(raw) + '" style="vertical-align:middle;margin-right:4px;" aria-hidden="true"></span>';
      }

      function countryCodeFromRow(row) {
        if (!row || typeof row !== 'object') return '';
        var preferred = row.country_code != null ? String(row.country_code) : '';
        var fallback = row.country != null ? String(row.country) : '';
        var cc = (preferred || fallback).trim().toUpperCase().slice(0, 2);
        if (cc === 'UK') cc = 'GB';
        return /^[A-Z]{2}$/.test(cc) ? cc : '';
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
        safeLabels = sanitizeChartConfig(safeLabels, [{ label: 'Value', data: safeValues }]).labels;
        if (!safeValues.length) {
          renderOverviewChartLoading(chartId, 'Loading chart...');
          return;
        }
        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        if (!uiStyle || typeof uiStyle !== 'object') uiStyle = {};
        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length)
          ? opts.colors
          : [DASH_ACCENT, DASH_BLUE, DASH_ORANGE, DASH_PURPLE, '#ef4444'];
        var colors = chartColorsFromUiConfig(chartId, fallbackColors);
        var valueFormatter = (opts && typeof opts.valueFormatter === 'function')
          ? opts.valueFormatter
          : function(v) { return fmtGbp(normalizeOverviewMetric(v)) || '\u2014'; };
        var donut = (opts && typeof opts.donut === 'boolean')
          ? !!opts.donut
          : !!uiStyle.pieDonut;
        var chartType = donut ? 'donut' : 'pie';
        var pieLabelPosition = (opts && opts.pieLabelPosition != null)
          ? String(opts.pieLabelPosition).trim().toLowerCase()
          : String(uiStyle.pieLabelPosition || 'auto').trim().toLowerCase();
        if (pieLabelPosition !== 'outside' && pieLabelPosition !== 'inside' && pieLabelPosition !== 'auto') pieLabelPosition = 'auto';
        var pieLabelContent = (opts && opts.pieLabelContent != null)
          ? String(opts.pieLabelContent).trim().toLowerCase()
          : String(uiStyle.pieLabelContent || 'percent').trim().toLowerCase();
        if (pieLabelContent !== 'label' && pieLabelContent !== 'label_percent' && pieLabelContent !== 'percent') pieLabelContent = 'percent';
        var pieLabelOffset = Number((opts && opts.pieLabelOffset != null) ? opts.pieLabelOffset : uiStyle.pieLabelOffset);
        if (!Number.isFinite(pieLabelOffset)) pieLabelOffset = 16;
        pieLabelOffset = Math.round(Math.max(-40, Math.min(40, pieLabelOffset)));
        if (pieLabelPosition === 'outside') pieLabelOffset = Math.max(6, pieLabelOffset);
        if (pieLabelPosition === 'inside') pieLabelOffset = Math.min(0, pieLabelOffset);
        var pieStartAngle = Number(opts && opts.pieStartAngle != null ? opts.pieStartAngle : NaN);
        var pieEndAngle = Number(opts && opts.pieEndAngle != null ? opts.pieEndAngle : NaN);
        var showLegend = (opts && typeof opts.showLegend === 'boolean')
          ? !!opts.showLegend
          : (pieLabelPosition !== 'outside');
        var labelFormatter = (opts && typeof opts.labelFormatter === 'function') ? opts.labelFormatter : null;
        var countryCodesForPie = (opts && Array.isArray(opts.countryCodes) && opts.countryCodes.length === safeLabels.length) ? opts.countryCodes : null;
        var dataLabelsEnabled = (opts && opts.dataLabels === false)
          ? false
          : (uiStyle.dataLabels !== 'off');
        var chartHeight = resolveOverviewChartHeight(
          chartEl,
          (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 180,
          120,
          440
        );
        try {
          if (typeof chartSizePercentFromUiConfig === 'function') {
            var pct = chartSizePercentFromUiConfig(chartId, 100);
            if (Number.isFinite(pct) && pct > 0 && pct !== 100) {
              chartHeight = Math.round(chartHeight * (pct / 100));
              if (chartHeight < 120) chartHeight = 120;
              if (chartHeight > 440) chartHeight = 440;
            }
          }
        } catch (_) {}
        var apexOpts = {
          chart: {
            type: chartType,
            height: chartHeight,
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: !!(uiStyle && uiStyle.toolbar === true) },
            animations: { enabled: uiStyle.animations === true, easing: 'easeinout', speed: 280 },
            zoom: { enabled: false }
          },
          series: safeValues,
          labels: safeLabels,
          colors: colors,
          legend: { show: showLegend, position: 'bottom', fontSize: '11px' },
          fill: { opacity: (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : 1 },
          stroke: { show: true, width: 1, colors: ['#fff'] },
          dataLabels: {
            enabled: dataLabelsEnabled,
            formatter: function(val, ctx) {
              var pct = normalizeOverviewMetric(val);
              var idx = ctx && Number.isFinite(ctx.seriesIndex) ? ctx.seriesIndex : -1;
              var seriesLabel = (idx >= 0 && idx < safeLabels.length) ? safeLabels[idx] : '';
              if (countryCodesForPie && idx >= 0 && idx < countryCodesForPie.length) {
                var flag = (typeof countryCodeToFlagEmoji === 'function') ? countryCodeToFlagEmoji(countryCodesForPie[idx]) : '';
                var pctText = pct ? pct.toFixed(0) + '%' : '';
                if (pieLabelContent === 'label') return flag || seriesLabel || pctText;
                if (pieLabelContent === 'label_percent') return (flag ? flag + ' ' : '') + (pctText || seriesLabel);
                return (flag ? flag + ' ' : '') + pctText;
              }
              if (labelFormatter) {
                var custom = labelFormatter(pct, seriesLabel, idx, safeValues[idx]);
                if (custom != null) return String(custom);
              }
              var pctText = pct ? pct.toFixed(0) + '%' : '';
              if (pieLabelContent === 'label') return seriesLabel || pctText;
              if (pieLabelContent === 'label_percent') {
                if (seriesLabel && pctText) return seriesLabel + ' ' + pctText;
                return seriesLabel || pctText;
              }
              return pctText;
            },
            style: {
              fontSize: '11px',
              fontWeight: 500,
              colors: pieLabelPosition !== 'inside' ? ['#000'] : undefined
            },
            dropShadow: { enabled: false }
          },
          plotOptions: { pie: { dataLabels: { offset: pieLabelOffset, minAngleToShowLabel: 8 }, expandOnClick: false } },
          tooltip: { enabled: true, y: { formatter: valueFormatter } },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };
        if (Number.isFinite(pieStartAngle)) apexOpts.plotOptions.pie.startAngle = pieStartAngle;
        if (Number.isFinite(pieEndAngle)) apexOpts.plotOptions.pie.endAngle = pieEndAngle;
        if (chartType === 'donut') {
          var donutSize = Number(uiStyle.pieDonutSize);
          if (!Number.isFinite(donutSize)) donutSize = 66;
          donutSize = Math.round(Math.max(30, Math.min(90, donutSize)));
          apexOpts.plotOptions.pie.donut = { size: donutSize + '%' };
        }
        try {
          var chartOverride = chartAdvancedOverrideFromUiConfig(chartId, 'pie');
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) {
            apexOpts = deepMergeOptions(apexOpts, chartOverride);
          }
        } catch (_) {}
        try {
          var afterRender = (opts && typeof opts.afterRender === 'function') ? opts.afterRender : null;
          upsertDashboardApexChart(
            chartId,
            chartEl,
            apexOpts,
            afterRender
              ? function(chart) {
                try { afterRender(chart, { chartEl: chartEl, labels: safeLabels, values: safeValues, chartType: chartType }); } catch (_) {}
              }
              : null
          );
        } catch (err) {
          captureChartError(err, 'dashboardPieChartRender', { chartId: chartId });
          console.error('[dashboard] pie chart render error:', chartId, err);
        }
      }

      function renderOverviewFinishesRadialBar(chartId, labels, values, opts) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || typeof ApexCharts === 'undefined') return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          return;
        }
        var total = 0;
        for (var i = 0; i < values.length; i++) total += normalizeOverviewMetric(values[i]);
        var series = [];
        for (var j = 0; j < values.length; j++) {
          var v = normalizeOverviewMetric(values[j]);
          series.push(total > 0 ? (v / total) * 100 : 0);
        }
        labels = sanitizeChartConfig(labels, [{ label: 'Share', data: series }]).labels;
        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length) ? opts.colors : ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab'];
        var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
        var chartHeight = resolveOverviewChartHeight(chartEl, (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 180, 120, 440);
        chartHeight = scaleHeightForChartSizePercent(chartId, chartHeight, 120, 440);
        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        var labelsRef = labels;
        var valuesRef = values;
        var defaultIdx = 0;
        try {
          var bestRev = -Infinity;
          for (var k = 0; k < valuesRef.length; k++) {
            var rv = normalizeOverviewMetric(valuesRef[k]);
            if (rv > bestRev) { bestRev = rv; defaultIdx = k; }
          }
        } catch (_) { defaultIdx = 0; }
        try {
          chartEl.__kexoFinishesRadialCenter = {
            enabled: !(uiStyle && uiStyle.radialCenterLabel === false),
            defaultIdx: defaultIdx,
            labels: labelsRef,
            values: valuesRef,
          };
        } catch (_) {}
        function syncFinishesRadialCenterLabel(selectedIdx) {
          var st = null;
          try { st = chartEl && chartEl.__kexoFinishesRadialCenter ? chartEl.__kexoFinishesRadialCenter : null; } catch (_) { st = null; }
          if (!chartEl || !st || st.enabled !== true) {
            try {
              var existing = chartEl ? chartEl.querySelector('.kexo-radial-center-label-wrap') : null;
              if (existing) existing.remove();
            } catch (_) {}
            return;
          }
          var idx = Number.isFinite(Number(selectedIdx)) ? Number(selectedIdx) : st.defaultIdx;
          if (idx < 0 || idx >= st.labels.length) idx = st.defaultIdx;
          var name = (idx >= 0 && idx < st.labels.length) ? st.labels[idx] : '';
          var rev = (idx >= 0 && idx < st.values.length) ? st.values[idx] : 0;
          var revStr = fmtGbp(normalizeOverviewMetric(rev)) || '\u2014';
          try { if (chartEl && chartEl.style) chartEl.style.position = 'relative'; } catch (_) {}
          var el = null;
          try { el = chartEl.querySelector('.kexo-radial-center-label-wrap'); } catch (_) { el = null; }
          if (!el) {
            el = document.createElement('div');
            el.className = 'kexo-radial-center-label-wrap';
            el.setAttribute('aria-hidden', 'true');
            chartEl.appendChild(el);
          }
          el.innerHTML = '<div class="kexo-radial-center-label">' + escapeHtml(name || '') + '</div>' +
            '<div class="kexo-radial-center-value">' + escapeHtml(revStr) + '</div>';
        }
        var apexOpts = {
          chart: {
            type: 'radialBar',
            height: chartHeight,
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: !!(uiStyle && uiStyle.toolbar === true) },
            animations: { enabled: !!(uiStyle && uiStyle.animations === true), easing: 'easeinout', speed: 280 },
            events: {
              mounted: function() { try { syncFinishesRadialCenterLabel(defaultIdx); } catch (_) {} },
              updated: function() { try { syncFinishesRadialCenterLabel(defaultIdx); } catch (_) {} },
              dataPointMouseEnter: function(event, chartCtx, config) {
                try {
                  var idx = config && Number.isFinite(Number(config.seriesIndex)) ? Number(config.seriesIndex) : -1;
                  if (idx >= 0) syncFinishesRadialCenterLabel(idx);
                } catch (_) {}
              },
              dataPointMouseLeave: function() { try { syncFinishesRadialCenterLabel(defaultIdx); } catch (_) {} }
            }
          },
          plotOptions: {
            radialBar: {
              startAngle: -135,
              endAngle: 135,
              hollow: { size: '58%' },
              track: { background: 'rgba(0,0,0,0.06)' },
              dataLabels: {
                name: { show: false },
                value: { show: false },
                total: { show: false },
              }
            }
          },
          series: series,
          labels: labels,
          colors: colors,
          legend: { show: !!(opts && opts.showLegend), position: 'bottom', fontSize: '11px', labels: { colors: undefined } },
          fill: { opacity: (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : 1 },
          tooltip: {
            enabled: true,
            custom: function(ctx) {
              var idx = ctx && Number.isFinite(ctx.seriesIndex) ? ctx.seriesIndex : -1;
              var name = (idx >= 0 && idx < labelsRef.length) ? labelsRef[idx] : '';
              var rev = (idx >= 0 && idx < valuesRef.length) ? valuesRef[idx] : 0;
              var pct = (ctx && Array.isArray(ctx.series) && idx >= 0 && idx < ctx.series.length) ? Number(ctx.series[idx]) : null;
              var pctStr = (pct != null && Number.isFinite(pct)) ? pct.toFixed(1) + '%' : '\u2014';
              try { if (idx >= 0) syncFinishesRadialCenterLabel(idx); } catch (_) {}
              return '<div class="kexo-tooltip-card p-2"><div class="fw-semibold">' + escapeHtml(name || '') + '</div><div>Revenue: ' + escapeHtml(fmtGbp(normalizeOverviewMetric(rev)) || '\u2014') + '</div><div>Share: ' + escapeHtml(pctStr) + '</div></div>';
            }
          },
          states: { normal: { filter: { type: 'none', value: 0 } }, hover: { filter: { type: 'none', value: 0 } }, active: { filter: { type: 'none', value: 0 } } },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };
        try {
          var chartOverride = (typeof chartAdvancedOverrideFromUiConfig === 'function') ? chartAdvancedOverrideFromUiConfig(chartId, 'radialbar') : null;
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) {
            apexOpts = deepMergeOptions(apexOpts, chartOverride);
          }
        } catch (_) {}
        try {
          upsertDashboardApexChart(chartId, chartEl, apexOpts, function() {
            try { syncFinishesRadialCenterLabel(defaultIdx); } catch (_) {}
          });
          try {
            if (chartEl && !chartEl.__kexoRadialCenterLeaveBound) {
              chartEl.__kexoRadialCenterLeaveBound = true;
              chartEl.addEventListener('mouseleave', function () {
                try {
                  var st = chartEl && chartEl.__kexoFinishesRadialCenter ? chartEl.__kexoFinishesRadialCenter : null;
                  var idx = st && Number.isFinite(Number(st.defaultIdx)) ? Number(st.defaultIdx) : 0;
                  syncFinishesRadialCenterLabel(idx);
                } catch (_) {}
              });
            }
          } catch (_) {}
        } catch (err) {
          captureChartError(err, 'dashboardRadialBarRender', { chartId: chartId });
          console.error('[dashboard] radialBar chart render error:', chartId, err);
        }
      }

      function renderOverviewFinishesBarChart(chartId, labels, values, opts) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || typeof ApexCharts === 'undefined') return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          return;
        }
        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length) ? opts.colors : ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab'];
        var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
        var chartHeight = resolveOverviewChartHeight(chartEl, (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 180, 120, 440);
        chartHeight = scaleHeightForChartSizePercent(chartId, chartHeight, 120, 440);
        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        var horizontal = opts && opts.horizontal !== false;
        var apexOpts = {
          chart: { type: 'bar', height: chartHeight, fontFamily: 'Inter, sans-serif', toolbar: { show: false }, animations: { enabled: !!(uiStyle && uiStyle.animations === true) } },
          plotOptions: { bar: { horizontal: horizontal, borderRadius: 0, distributed: true, barHeight: horizontal ? '60%' : '70%' } },
          series: [{ name: 'Revenue', data: values.map(function(v) { return normalizeOverviewMetric(v); }) }],
          xaxis: { categories: labels, labels: { show: horizontal ? false : true } },
          yaxis: horizontal ? { labels: { show: true, style: { fontSize: '12px', fontWeight: 500, colors: '#090f17' } } } : { labels: { show: false } },
          grid: { padding: { bottom: 12, left: 12, right: 8, top: 4 } },
          colors: colors,
          legend: { show: false },
          dataLabels: { enabled: false },
          fill: { opacity: (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : 1 },
          tooltip: { enabled: true, y: { formatter: function(v) { return fmtGbp(normalizeOverviewMetric(v)) || '\u2014'; } } },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };
        try {
          var chartOverride = (typeof chartAdvancedOverrideFromUiConfig === 'function') ? chartAdvancedOverrideFromUiConfig(chartId, 'bar') : null;
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) apexOpts = deepMergeOptions(apexOpts, chartOverride);
        } catch (_) {}
        if (horizontal) {
          apexOpts.xaxis = apexOpts.xaxis || {};
          apexOpts.xaxis.labels = apexOpts.xaxis.labels || {};
          apexOpts.xaxis.labels.show = false;
        }
        try {
          upsertDashboardApexChart(chartId, chartEl, apexOpts);
        } catch (err) {
          captureChartError(err, 'dashboardFinishesBarRender', { chartId: chartId });
        }
      }

      function renderOverviewCountriesHorizontalBar(chartId, rows, opts) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || typeof ApexCharts === 'undefined') return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          return;
        }
        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        var categories = [];
        var values = [];
        var names = [];
        var countryCodes = [];
        var crPcts = [];
        var showFlags = !!(uiStyle && uiStyle.pieCountryFlags);
        var horizontal = opts && opts.horizontal !== false;
        rows.forEach(function(row) {
          var cc = countryCodeFromRow(row);
          if (!cc) {
            var raw = row && row.country != null ? String(row.country).trim() : '';
            cc = raw ? raw.toUpperCase().slice(0, 2) : '';
            if (cc === 'UK') cc = 'GB';
            if (!/^[A-Z]{2}$/.test(cc)) return;
          }
          var emoji = showFlags ? countryCodeToFlagEmoji(cc) : '';
          var name = (typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc;
          var rev = normalizeOverviewMetric(row && row.revenue);
          if (horizontal) {
            categories.push(showFlags && emoji ? (emoji + ' ' + name) : name);
          } else {
            categories.push(name || cc);
          }
          values.push(rev);
          names.push(name || cc);
          countryCodes.push(cc);
          crPcts.push(row && row.cr != null ? Number(row.cr) : null);
        });
        if (!categories.length || !values.length) {
          renderOverviewChartEmpty(chartId, 'No country data');
          try {
            var legendEl = chartEl.parentElement ? chartEl.parentElement.querySelector('[data-overview-legend="' + chartId + '"]') : null;
            if (legendEl) legendEl.innerHTML = '';
          } catch (_) {}
          return;
        }
        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length) ? opts.colors : ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
        var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
        var chartHeight = resolveOverviewChartHeight(chartEl, (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 180, 120, 440);
        var namesRef = names;
        var valuesRef = values;
        var crPctsRef = crPcts;
        var countryCodesRef = countryCodes;
        var showFlagsRef = showFlags;
        var dataLabelsConfig = false;
        if (!horizontal && showFlags && countryCodesRef.length) {
          dataLabelsConfig = {
            enabled: true,
            formatter: function (_val, opts) {
              var idx = opts && opts.dataPointIndex != null ? opts.dataPointIndex : -1;
              if (idx < 0 || idx >= countryCodesRef.length) return '';
              return countryCodeToFlagEmoji(countryCodesRef[idx]) || '';
            },
            style: { fontSize: '14px', fontWeight: 500 },
            offsetY: -4
          };
        }
        var apexOpts = {
          chart: { type: 'bar', height: chartHeight, fontFamily: 'Inter, sans-serif', toolbar: { show: false }, animations: { enabled: !!(uiStyle && uiStyle.animations === true) } },
          plotOptions: { bar: { horizontal: horizontal, borderRadius: 0, distributed: true, barHeight: horizontal ? '60%' : '70%', dataLabels: { hideOverflowingLabels: false } } },
          series: [{ name: 'Revenue', data: values }],
          xaxis: { categories: categories, labels: { show: horizontal ? false : true } },
          yaxis: horizontal ? { labels: { show: true, style: { fontSize: '12px', fontWeight: 500, colors: '#090f17' } } } : { labels: { show: false } },
          grid: { padding: { bottom: 12, left: 12, right: 8, top: 4 } },
          colors: colors,
          legend: { show: false },
          dataLabels: dataLabelsConfig || { enabled: false },
          fill: { opacity: (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : 1, type: 'solid' },
          stroke: { show: false, width: 0 },
          states: { normal: { filter: { type: 'none', value: 0 } }, hover: { filter: { type: 'none', value: 0 } }, active: { filter: { type: 'none', value: 0 } } },
          tooltip: {
            enabled: true,
            custom: function(opts) {
              var idx = opts && opts.dataPointIndex != null ? opts.dataPointIndex : -1;
              var name = (idx >= 0 && idx < namesRef.length) ? namesRef[idx] : '';
              var rev = (idx >= 0 && idx < valuesRef.length) ? valuesRef[idx] : 0;
              var cr = (idx >= 0 && idx < crPctsRef.length) ? crPctsRef[idx] : null;
              var crStr = cr != null && Number.isFinite(cr) ? cr.toFixed(1) + '%' : '\u2014';
              var flagHtml = (showFlagsRef && idx >= 0 && idx < countryCodesRef.length) ? countryCodeToFlagHtml(countryCodesRef[idx]) : '';
              return '<div class="kexo-tooltip-card p-2"><div class="fw-semibold">' + (flagHtml || '') + escapeHtml(name || '') + '</div><div>Revenue: ' + escapeHtml(fmtGbp(rev) || '\u2014') + '</div><div>Conversion: ' + escapeHtml(crStr) + '</div></div>';
            }
          },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };
        try {
          var chartOverride = (typeof chartAdvancedOverrideFromUiConfig === 'function') ? chartAdvancedOverrideFromUiConfig(chartId, 'bar') : null;
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) apexOpts = deepMergeOptions(apexOpts, chartOverride);
        } catch (_) {}
        if (horizontal) {
          apexOpts.xaxis = apexOpts.xaxis || {};
          apexOpts.xaxis.labels = apexOpts.xaxis.labels || {};
          apexOpts.xaxis.labels.show = false;
        }
        try {
          upsertDashboardApexChart(chartId, chartEl, apexOpts);
          var legendEl = chartEl.parentElement ? chartEl.parentElement.querySelector('[data-overview-legend="' + chartId + '"]') : null;
          if (legendEl) {
            // Strict layout: bar charts show flags on axis labels (horizontal) or as data labels (vertical),
            // not in the bottom legend.
            legendEl.innerHTML = '';
            legendEl.className = 'kexo-overview-mini-legend kexo-overview-countries-legend';
          }
        } catch (err) {
          captureChartError(err, 'dashboardCountriesBarRender', { chartId: chartId });
        }
      }

      function platformLabelForKey(platformKey) {
        var p = (platformKey || '').trim().toLowerCase();
        if (p === 'ios') return 'iOS';
        if (p === 'android') return 'Android';
        if (p === 'windows') return 'Windows';
        if (p === 'mac') return 'Mac';
        if (p === 'linux') return 'Linux';
        return p || 'Other';
      }

      function platformIconHtmlForKey(platformKey, label) {
        var p = (platformKey || '').trim().toLowerCase();
        var key = 'type-platform-unknown';
        var cls = 'fa-light fa-circle-question';
        if (p === 'ios') { key = 'type-platform-ios'; cls = 'fa-light fa-apple'; }
        else if (p === 'mac') { key = 'type-platform-mac'; cls = 'fa-light fa-apple'; }
        else if (p === 'android') { key = 'type-platform-android'; cls = 'fa-light fa-android'; }
        else if (p === 'windows') { key = 'type-platform-windows'; cls = 'fa-light fa-windows'; }
        else if (p === 'linux') { key = 'type-platform-linux'; cls = 'fa-light fa-linux'; }
        return '<i class="' + escapeHtml(cls) + '" data-icon-key="' + escapeHtml(key) + '" aria-hidden="true"' +
          (label ? (' title="' + escapeHtml(label) + '"') : '') + '></i>';
      }

      function clearOverviewDevicesYIcons(chartId) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || !chartEl.parentElement || !chartEl.parentElement.querySelector) return;
        var col = null;
        try { col = chartEl.parentElement.querySelector('[data-overview-yicons="' + chartId + '"]'); } catch (_) { col = null; }
        if (col) col.innerHTML = '';
      }

      function setOverviewDevicesYIcons(chartId, platforms) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || !chartEl.parentElement || !chartEl.parentElement.querySelector) return;
        var col = null;
        try { col = chartEl.parentElement.querySelector('[data-overview-yicons="' + chartId + '"]'); } catch (_) { col = null; }
        if (!col) return;
        var list = Array.isArray(platforms) ? platforms : [];
        if (!list.length) {
          col.innerHTML = '';
          return;
        }
        try { col.style.setProperty('--dash-devices-row-count', String(list.length)); } catch (_) {}
        col.innerHTML = list.map(function(r) {
          var platform = r && r.platform != null ? String(r.platform).trim().toLowerCase() : '';
          var label = r && r.label != null ? String(r.label).trim() : platformLabelForKey(platform);
          return '<div class="dash-devices-icon-cell" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' +
            platformIconHtmlForKey(platform, label) +
            '<span class="dash-devices-icon-label">' + escapeHtml(label) + '</span>' +
          '</div>';
        }).join('');
      }

      function renderOverviewDevicesHorizontalBar(chartId, platforms, opts) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || typeof ApexCharts === 'undefined') return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          clearOverviewDevicesYIcons(chartId);
          return;
        }

        var rows = Array.isArray(platforms) ? platforms : [];
        var labels = [];
        var values = [];
        var orders = [];
        var revenues = [];
        var platformKeys = [];
        var renderedRows = [];
        rows.forEach(function(r) {
          if (!r || typeof r !== 'object') return;
          var p = r.platform != null ? String(r.platform).trim().toLowerCase() : '';
          var label = r.label != null ? String(r.label).trim() : platformLabelForKey(p);
          var sessions = normalizeOverviewMetric(r.sessions);
          if (!label || sessions <= 0) return;
          var s = Math.max(0, Math.round(sessions));
          var o = Math.max(0, Math.round(normalizeOverviewMetric(r.orders)));
          var rev = normalizeOverviewMetric(r.revenue_gbp);
          labels.push(label);
          values.push(s);
          orders.push(o);
          revenues.push(rev);
          platformKeys.push(p);
          renderedRows.push({ platform: p, label: label, sessions: s, orders: o, revenue_gbp: rev });
        });

        if (!labels.length || !values.length) {
          renderOverviewChartEmpty(chartId, 'No device data');
          clearOverviewDevicesYIcons(chartId);
          return;
        }

        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length) ? opts.colors : ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
        var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
        var chartHeight = resolveOverviewChartHeight(chartEl, (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 180, 120, 440);
        try {
          if (typeof chartSizePercentFromUiConfig === 'function') {
            var pct = chartSizePercentFromUiConfig(chartId, 100);
            if (Number.isFinite(pct) && pct > 0 && pct !== 100) {
              chartHeight = Math.round(chartHeight * (pct / 100));
              if (chartHeight < 120) chartHeight = 120;
              if (chartHeight > 440) chartHeight = 440;
            }
          }
        } catch (_) {}
        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;

        var labelsRef = labels;
        var valuesRef = values;
        var ordersRef = orders;
        var revenuesRef = revenues;
        var platformRef = platformKeys;

        var horizontal = !!(opts && opts.horizontal);
        var plotOptions = { bar: { horizontal: horizontal, borderRadius: 0, distributed: true, dataLabels: { hideOverflowingLabels: false } } };
        if (horizontal) plotOptions.bar.barHeight = '54%';
        else plotOptions.bar.columnWidth = '55%';
        var apexOpts = {
          chart: { type: 'bar', height: chartHeight, offsetY: -4, fontFamily: 'Inter, sans-serif', toolbar: { show: false }, animations: { enabled: !!(uiStyle && uiStyle.animations === true) } },
          plotOptions: plotOptions,
          series: [{ name: 'Sessions', data: values }],
          xaxis: { categories: labels, labels: { show: !horizontal } },
          yaxis: { labels: { show: false } },
          grid: { show: false, padding: { bottom: 10, left: 6, right: 8, top: 0 } },
          colors: colors,
          legend: { show: false },
          dataLabels: { enabled: false },
          fill: { opacity: (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : 1, type: 'solid' },
          stroke: { show: false, width: 0 },
          states: { normal: { filter: { type: 'none', value: 0 } }, hover: { filter: { type: 'none', value: 0 } }, active: { filter: { type: 'none', value: 0 } } },
          tooltip: {
            enabled: true,
            custom: function(tip) {
              var idx = tip && tip.dataPointIndex != null ? tip.dataPointIndex : -1;
              var name = (idx >= 0 && idx < labelsRef.length) ? labelsRef[idx] : '';
              var sess = (idx >= 0 && idx < valuesRef.length) ? valuesRef[idx] : 0;
              var ord = (idx >= 0 && idx < ordersRef.length) ? ordersRef[idx] : 0;
              var rev = (idx >= 0 && idx < revenuesRef.length) ? revenuesRef[idx] : 0;
              var pKey = (idx >= 0 && idx < platformRef.length) ? platformRef[idx] : '';
              var crStr = (sess > 0) ? ((ord / sess) * 100).toFixed(1) + '%' : '\u2014';
              var iconHtml = platformIconHtmlForKey(pKey, name);
              return '<div class="kexo-tooltip-card p-2">' +
                '<div class="fw-semibold d-flex align-items-center gap-2">' + iconHtml + escapeHtml(name || '') + '</div>' +
                '<div>Sessions: ' + escapeHtml(fmtNum(sess)) + '</div>' +
                '<div>Orders: ' + escapeHtml(fmtNum(ord)) + '</div>' +
                '<div>Conversion: ' + escapeHtml(crStr) + '</div>' +
                '<div>Revenue: ' + escapeHtml(fmtGbp(normalizeOverviewMetric(rev)) || '\u2014') + '</div>' +
              '</div>';
            }
          },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };

        try {
          var chartOverride = (typeof chartAdvancedOverrideFromUiConfig === 'function') ? chartAdvancedOverrideFromUiConfig(chartId, 'bar-horizontal') : null;
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) apexOpts = deepMergeOptions(apexOpts, chartOverride);
        } catch (_) {}

        try {
          upsertDashboardApexChart(chartId, chartEl, apexOpts);
          if (horizontal) setOverviewDevicesYIcons(chartId, renderedRows);
          else clearOverviewDevicesYIcons(chartId);
          try {
            var legendEl = chartEl.parentElement && chartEl.parentElement.parentElement && chartEl.parentElement.parentElement.querySelector
              ? chartEl.parentElement.parentElement.querySelector('[data-overview-legend="' + chartId + '"]')
              : null;
            if (legendEl) legendEl.innerHTML = '';
          } catch (_) {}
        } catch (err) {
          captureChartError(err, 'dashboardDevicesBarRender', { chartId: chartId });
          clearOverviewDevicesYIcons(chartId);
        }
      }

      function attributionIconSpecToHtml(specRaw, labelRaw) {
        var spec = specRaw != null ? String(specRaw).trim() : '';
        var label = labelRaw != null ? String(labelRaw).trim() : '';
        if (!spec) return '';
        if (/^<svg[\s>]/i.test(spec)) return '<span class="source-icons" title="' + escapeHtml(label) + '" aria-hidden="true">' + spec + '</span>';
        if (/^(https?:\/\/|\/\/|\/)/i.test(spec)) return '<span class="source-icons"><img src="' + escapeHtml(spec) + '" alt="' + escapeHtml(label) + '" class="source-icon-img" width="20" height="20" title="' + escapeHtml(label) + '"></span>';
        return '<span class="source-icons"><i class="' + escapeHtml(spec) + '" title="' + escapeHtml(label) + '" aria-hidden="true"></i></span>';
      }

      function renderOverviewAttributionDistributedBar(chartId, sources, opts) {
        var chartEl = document.getElementById(chartId);
        if (!chartEl || typeof ApexCharts === 'undefined') return;
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          chartEl.innerHTML = '';
          removeAttributionIconRow(chartEl);
          return;
        }
        var labels = [];
        var values = [];
        var crPcts = [];
        var iconSpecs = [];
        sources.forEach(function(s) {
          var label = (s && s.label != null) ? String(s.label).trim() : '';
          var rev = normalizeOverviewMetric(s && s.revenue_gbp != null ? s.revenue_gbp : s.revenue);
          labels.push(label || '—');
          values.push(rev);
          crPcts.push(s && s.conversion_pct != null ? Number(s.conversion_pct) : null);
          iconSpecs.push(s && s.icon_spec != null ? String(s.icon_spec).trim() : '');
        });
        if (!labels.length || !values.length) {
          renderOverviewChartEmpty(chartId, 'No attribution data');
          removeAttributionIconRow(chartEl);
          return;
        }
        removeAttributionIconRow(chartEl);
        var fallbackColors = (opts && Array.isArray(opts.colors) && opts.colors.length) ? opts.colors : ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
        var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
        var chartHeight = resolveOverviewChartHeight(chartEl, (opts && Number.isFinite(Number(opts.height))) ? Number(opts.height) : 180, 120, 440);
        try {
          if (typeof chartSizePercentFromUiConfig === 'function') {
            var pct = chartSizePercentFromUiConfig(chartId, 100);
            if (Number.isFinite(pct) && pct > 0 && pct !== 100) {
              chartHeight = Math.round(chartHeight * (pct / 100));
              if (chartHeight < 120) chartHeight = 120;
              if (chartHeight > 440) chartHeight = 440;
            }
          }
        } catch (_) {}
        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        var labelsRef = labels;
        var valuesRef = values;
        var crPctsRef = crPcts;
        var horizontal = !!(opts && opts.horizontal);
        var apexOpts = {
          chart: { type: 'bar', height: chartHeight, fontFamily: 'Inter, sans-serif', toolbar: { show: false }, animations: { enabled: !!(uiStyle && uiStyle.animations === true) } },
          plotOptions: { bar: { borderRadius: 0, distributed: true, barHeight: horizontal ? '60%' : '70%', horizontal: horizontal } },
          series: [{ name: 'Revenue', data: values }],
          xaxis: { categories: labels, labels: { show: false } },
          yaxis: horizontal ? { labels: { show: true, style: { fontSize: '12px', fontWeight: 500, colors: '#090f17' } } } : { labels: { show: false } },
          grid: { padding: { bottom: 12, left: 12, right: 8, top: 4 } },
          colors: colors,
          legend: { show: false },
          dataLabels: { enabled: false },
          fill: { opacity: (uiStyle && Number.isFinite(Number(uiStyle.fillOpacity))) ? Math.max(0, Math.min(1, Number(uiStyle.fillOpacity))) : 1, type: 'solid' },
          stroke: { show: false, width: 0 },
          states: { normal: { filter: { type: 'none', value: 0 } }, hover: { filter: { type: 'none', value: 0 } }, active: { filter: { type: 'none', value: 0 } } },
          tooltip: {
            enabled: true,
            custom: function(opts) {
              var idx = opts && opts.dataPointIndex != null ? opts.dataPointIndex : -1;
              var name = (idx >= 0 && idx < labelsRef.length) ? labelsRef[idx] : '';
              var rev = (idx >= 0 && idx < valuesRef.length) ? valuesRef[idx] : 0;
              var cr = (idx >= 0 && idx < crPctsRef.length) ? crPctsRef[idx] : null;
              var crStr = cr != null && Number.isFinite(cr) ? cr.toFixed(1) + '%' : '\u2014';
              return '<div class="kexo-tooltip-card p-2"><div class="fw-semibold">' + escapeHtml(name) + '</div><div>Revenue: ' + escapeHtml(fmtGbp(rev) || '\u2014') + '</div><div>Conversion: ' + escapeHtml(crStr) + '</div></div>';
            }
          },
          noData: { text: 'No data available', style: { fontSize: '13px', color: '#626976' } }
        };
        try {
          var chartOverride = (typeof chartAdvancedOverrideFromUiConfig === 'function') ? chartAdvancedOverrideFromUiConfig(chartId, 'bar') : null;
          if (chartOverride && isPlainObject(chartOverride) && Object.keys(chartOverride).length) apexOpts = deepMergeOptions(apexOpts, chartOverride);
        } catch (_) {}
        if (horizontal) {
          apexOpts.xaxis = apexOpts.xaxis || {};
          apexOpts.xaxis.labels = apexOpts.xaxis.labels || {};
          apexOpts.xaxis.labels.show = false;
        }
        try {
          upsertDashboardApexChart(chartId, chartEl, apexOpts);
          appendAttributionIconRow(chartEl, sources, attributionIconSpecToHtml);
        } catch (err) {
          captureChartError(err, 'dashboardAttributionBarRender', { chartId: chartId });
        }
      }

      function removeAttributionIconRow(chartEl) {
        if (!chartEl || !chartEl.parentNode) return;
        var sibling = chartEl.nextElementSibling;
        if (sibling && sibling.classList && sibling.classList.contains('dash-attribution-icon-row')) {
          sibling.remove();
        }
      }

      function appendAttributionIconRow(chartEl, sources, iconSpecToHtml) {
        if (!chartEl || !chartEl.parentNode || !Array.isArray(sources) || !sources.length) return;
        var row = document.createElement('div');
        row.className = 'dash-attribution-icon-row';
        sources.forEach(function(s) {
          var cell = document.createElement('div');
          cell.className = 'dash-attribution-icon-cell';
          var label = (s && s.label != null) ? String(s.label).trim() : '';
          var spec = (s && s.icon_spec != null) ? String(s.icon_spec).trim() : '';
          cell.innerHTML = spec ? iconSpecToHtml(spec, label) : ('<span class="dash-attribution-icon-fallback">' + escapeHtml(label || '—') + '</span>');
          row.appendChild(cell);
        });
        chartEl.parentNode.insertBefore(row, chartEl.nextSibling);
        try { scheduleOverviewHeightSync(); } catch (_) {}
      }

      function removeAttributionDonutIcons(chartEl) {
        if (!chartEl) return;
        try {
          var existing = chartEl.querySelector('.dash-attribution-donut-icons');
          if (existing) existing.remove();
        } catch (_) {}
      }

      function upsertAttributionDonutIcons(chartEl, sources, values) {
        if (!chartEl) return;
        removeAttributionDonutIcons(chartEl);
        var list = Array.isArray(sources) ? sources : [];
        var vals = Array.isArray(values) ? values : [];
        if (!list.length || !vals.length || list.length !== vals.length) return;
        try { if (chartEl && chartEl.style) chartEl.style.position = 'relative'; } catch (_) {}

        var svg = null;
        var pieNode = null;
        try { svg = chartEl.querySelector('svg'); } catch (_) { svg = null; }
        if (svg) {
          try {
            pieNode = svg.querySelector('.apexcharts-pie') ||
              svg.querySelector('.apexcharts-donut-series') ||
              svg.querySelector('.apexcharts-series');
          } catch (_) { pieNode = null; }
        }
        var wrapRect = null;
        var pieRect = null;
        try { wrapRect = chartEl.getBoundingClientRect(); } catch (_) { wrapRect = null; }
        try { pieRect = (pieNode && pieNode.getBoundingClientRect) ? pieNode.getBoundingClientRect() : (svg && svg.getBoundingClientRect ? svg.getBoundingClientRect() : null); } catch (_) { pieRect = null; }
        if (!wrapRect || !pieRect || !(pieRect.width > 0) || !(pieRect.height > 0)) return;

        var cx = pieRect.left + (pieRect.width / 2);
        var cy = pieRect.top + (pieRect.height / 2);
        var r = Math.min(pieRect.width, pieRect.height) / 2;
        var iconR = r + Math.max(10, Math.round(r * 0.12));

        var total = 0;
        for (var i = 0; i < vals.length; i++) total += Math.max(0, normalizeOverviewMetric(vals[i]));
        if (!(total > 0)) return;

        var overlay = document.createElement('div');
        overlay.className = 'dash-attribution-donut-icons';
        overlay.setAttribute('aria-hidden', 'true');

        var angle = -90;
        for (var j = 0; j < list.length; j++) {
          var v = Math.max(0, normalizeOverviewMetric(vals[j]));
          if (!(v > 0)) continue;
          var span = (v / total) * 360;
          var mid = angle + (span / 2);
          angle += span;
          var rad = (mid * Math.PI) / 180;
          var x = cx + (iconR * Math.cos(rad));
          var y = cy + (iconR * Math.sin(rad));
          var left = x - wrapRect.left;
          var top = y - wrapRect.top;
          if (!Number.isFinite(left) || !Number.isFinite(top)) continue;

          var src = list[j] || {};
          var label = src.label != null ? String(src.label).trim() : '';
          var spec = src.icon_spec != null ? String(src.icon_spec).trim() : '';
          var cell = document.createElement('div');
          cell.className = 'dash-attribution-donut-icon';
          cell.style.left = left + 'px';
          cell.style.top = top + 'px';
          cell.innerHTML = spec ? attributionIconSpecToHtml(spec, label) : ('<span class="dash-attribution-icon-fallback">' + escapeHtml(label || '—') + '</span>');
          overlay.appendChild(cell);
        }

        chartEl.appendChild(overlay);
      }

      function renderOverviewAttributionChart(attributionPayload) {
        var chartId = 'dash-chart-attribution-30d';
        var rows = attributionPayload && attributionPayload.attribution && Array.isArray(attributionPayload.attribution.rows)
          ? attributionPayload.attribution.rows
          : [];
        var mode = (typeof chartModeFromUiConfig === 'function') ? String(chartModeFromUiConfig(chartId, 'donut') || 'donut').trim().toLowerCase() : 'donut';
        mode = validateChartType(chartId, mode, 'donut');

        var chartEl = document.getElementById(chartId);
        removeAttributionIconRow(chartEl);
        removeAttributionDonutIcons(chartEl);

        var uiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(chartId) : null;
        var showIcons = !!(uiStyle && uiStyle.icons === true);

        function normText(v) {
          var s = v == null ? '' : String(v);
          return s.replace(/\s+/g, ' ').trim();
        }
        function isOtherLabel(v) {
          var s = normText(v).toLowerCase();
          return s === 'other' || s === 'unknown' || s === '(other)' || s === '(unknown)' || s === 'n/a' || s === 'na';
        }
        function titleCaseWords(v) {
          var s = normText(v);
          if (!s) return '';
          if (/^(sms|seo|ppc|roas)$/i.test(s)) return s.toUpperCase();
          return s.split(' ').map(function(w) {
            if (!w) return '';
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
          }).join(' ');
        }
        function labelFromKey(keyRaw, fallbackLabel) {
          var key = normText(keyRaw).toLowerCase();
          var fb = normText(fallbackLabel);
          if (!key) return fb || 'Other';
          if (key.indexOf('google') >= 0 && key.indexOf('ads') >= 0) return 'Google Ads';
          if (key.indexOf('organic') >= 0) return 'Organic';
          if (key.indexOf('direct') >= 0) return 'Direct';
          if (key.indexOf('email') >= 0 || key.indexOf('klaviyo') >= 0) return 'Email';
          if (key.indexOf('affiliate') >= 0) return 'Affiliates';
          if (key.indexOf('referral') >= 0) return 'Referral';
          if (key.indexOf('sms') >= 0) return 'SMS';
          if (key.indexOf('tiktok') >= 0) return 'TikTok';
          if (key.indexOf('facebook') >= 0 || key.indexOf('meta') >= 0) return 'Meta';
          if (key.indexOf('instagram') >= 0) return 'Instagram';
          if (key.indexOf('pinterest') >= 0) return 'Pinterest';
          if (key.indexOf('snap') >= 0) return 'Snapchat';
          if (key.indexOf('bing') >= 0) return 'Bing';
          if (key.indexOf('other') >= 0 || key.indexOf('unknown') >= 0) return 'Other';
          var human = titleCaseWords(key.replace(/[_-]+/g, ' '));
          return human || fb || 'Other';
        }
        function fallbackIconSpecForLabel(labelRaw) {
          var s = normText(labelRaw).toLowerCase();
          if (!s || s === 'other') return 'fa-light fa-ellipsis';
          if (s.indexOf('google') >= 0) return 'fa-brands fa-google';
          if (s.indexOf('meta') >= 0 || s.indexOf('facebook') >= 0) return 'fa-brands fa-facebook';
          if (s.indexOf('instagram') >= 0) return 'fa-brands fa-instagram';
          if (s.indexOf('tiktok') >= 0) return 'fa-brands fa-tiktok';
          if (s.indexOf('email') >= 0) return 'fa-light fa-envelope';
          if (s.indexOf('direct') >= 0) return 'fa-light fa-arrow-right-to-bracket';
          if (s.indexOf('organic') >= 0) return 'fa-light fa-seedling';
          if (s.indexOf('affiliate') >= 0) return 'fa-light fa-handshake';
          if (s.indexOf('referral') >= 0) return 'fa-light fa-link';
          if (s.indexOf('sms') >= 0) return 'fa-light fa-message-sms';
          return 'fa-light fa-globe';
        }

        var byKey = {};
        rows.forEach(function(ch) {
          if (!ch || !Array.isArray(ch.sources)) return;
          (ch.sources || []).forEach(function(src) {
            if (!src) return;
            var rev = normalizeOverviewMetric(src.revenue_gbp != null ? src.revenue_gbp : src.revenue);
            if (!(rev > 0)) return;
            var rawLabel = normText(src.label != null ? src.label : '');
            var rawKey = normText(src.source_key != null ? src.source_key : '');
            var label = rawLabel && !isOtherLabel(rawLabel) ? rawLabel : labelFromKey(rawKey, rawLabel);
            if (isOtherLabel(label)) label = 'Other';
            if (!label) label = 'Other';
            var k = label.toLowerCase();
            if (k === 'other' || isOtherLabel(k)) k = 'other';
            var iconSpec = normText(src.icon_spec != null ? src.icon_spec : '');
            if (!iconSpec) iconSpec = '';
            if (!byKey[k]) byKey[k] = { key: k, label: label, icon_spec: iconSpec, revenue_gbp: 0 };
            byKey[k].revenue_gbp += rev;
            if (!byKey[k].icon_spec && iconSpec) byKey[k].icon_spec = iconSpec;
          });
        });

        var groups = Object.keys(byKey).map(function(k) { return byKey[k]; }).filter(Boolean);
        groups.forEach(function(g) {
          if (!g) return;
          if (g.key === 'other') g.label = 'Other';
          if (!g.icon_spec && showIcons) g.icon_spec = fallbackIconSpecForLabel(g.label);
        });
        groups.sort(function(a, b) { return (b.revenue_gbp || 0) - (a.revenue_gbp || 0); });

        var other = null;
        for (var oi = 0; oi < groups.length; oi++) {
          if (groups[oi] && groups[oi].key === 'other') { other = groups[oi]; break; }
        }
        var main = groups.filter(function(g) { return g && g.key !== 'other'; });
        var keep = main.slice(0, 4);
        var remainder = main.slice(4);
        if (remainder.length) {
          if (!other) other = { key: 'other', label: 'Other', icon_spec: showIcons ? fallbackIconSpecForLabel('Other') : '', revenue_gbp: 0 };
          remainder.forEach(function(g) { other.revenue_gbp += (g && g.revenue_gbp) ? g.revenue_gbp : 0; });
        }
        if (other && (other.revenue_gbp || 0) > 0) keep.push(other);
        var finalSources = keep.filter(function(g) { return g && (g.revenue_gbp || 0) > 0; }).slice(0, 5);

        if (!finalSources.length) {
          renderOverviewChartEmpty(chartId, 'No attribution data');
          try {
            var legendHost = document.querySelector('[data-overview-legend="' + chartId + '"]');
            if (legendHost) legendHost.innerHTML = '';
          } catch (_) {}
          return;
        }
        var labels = finalSources.map(function(s) { return s && s.label ? String(s.label) : ''; });
        var values = finalSources.map(function(s) { return s && s.revenue_gbp ? s.revenue_gbp : 0; });
        var crPcts = finalSources.map(function(s) { return (s && Number.isFinite(Number(s.conversion_pct))) ? Number(s.conversion_pct) : null; });
        var fallbackColors = ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
        var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
        try {
          var legendHost2 = document.querySelector('[data-overview-legend="' + chartId + '"]');
          if (legendHost2) {
            legendHost2.innerHTML = finalSources.map(function(s) {
              var lbl = s && s.label ? String(s.label) : '';
              var spec = s && s.icon_spec ? String(s.icon_spec) : '';
              var icon = (showIcons && spec) ? attributionIconSpecToHtml(spec, lbl) : '';
              return '<span class="kexo-overview-mini-legend-item">' + icon + '<span class="kexo-overview-legend-label">' + escapeHtml(lbl || 'Other') + '</span></span>';
            }).join('');
          }
        } catch (_) {}
        if (mode === 'bar-horizontal' || mode === 'bar' || mode === 'bar-distributed') {
          renderOverviewAttributionDistributedBar(chartId, finalSources, {
            colors: colors,
            height: 180,
            horizontal: mode === 'bar-horizontal'
          });
        } else if (mode === 'line' || mode === 'area' || mode === 'multi-line-labels') {
          var labelsRef = labels;
          var valuesRef = values;
          var crPctsRef = crPcts;
          makeChart(chartId, labels, [{
            label: 'Revenue',
            data: values,
            borderColor: (colors && colors[0]) || DASH_ACCENT,
            backgroundColor: (colors && colors[0]) ? (colors[0] + '33') : DASH_ACCENT_LIGHT,
            fill: mode === 'area',
            borderWidth: 2
          }], {
            currency: true,
            chartType: mode,
            height: 180,
            tooltipCustom: function(tip) {
              var idx = tip && tip.dataPointIndex != null ? tip.dataPointIndex : -1;
              var name = (idx >= 0 && idx < labelsRef.length) ? labelsRef[idx] : '';
              var rev = (idx >= 0 && idx < valuesRef.length) ? valuesRef[idx] : 0;
              var cr = (idx >= 0 && idx < crPctsRef.length) ? crPctsRef[idx] : null;
              var crStr = cr != null && Number.isFinite(cr) ? cr.toFixed(1) + '%' : '\u2014';
              return '<div class="kexo-tooltip-card p-2"><div class="fw-semibold">' + escapeHtml(name || '') + '</div><div>Revenue: ' + escapeHtml(fmtGbp(rev) || '\u2014') + '</div><div>Conversion: ' + escapeHtml(crStr) + '</div></div>';
            }
          });
        } else if (mode === 'radialbar') {
          renderOverviewFinishesRadialBar(chartId, labels, values, { colors: colors, height: 180, showLegend: false });
        } else {
          renderOverviewPieChart(chartId, labels, values, {
            colors: colors,
            valueFormatter: function(v) { return fmtGbp(normalizeOverviewMetric(v)) || '\u2014'; },
            height: 180,
            dataLabels: false,
            showLegend: false,
            donut: mode === 'donut',
            pieStartAngle: -90,
            pieEndAngle: 270,
            pieCustomScale: 0.70,
            afterRender: null
          });
        }
        try { scheduleOverviewHeightSync(); } catch (_) {}
      }

      function setOverviewSalesRunningTotals(revenueTotal, costTotal, profitTotal) {
        function setValue(id, value) {
          var el = document.getElementById(id);
          if (!el) return;
          var n = Number(value);
          if (!Number.isFinite(n)) {
            el.textContent = '\u2014';
            return;
          }
          el.textContent = fmtGbp(Math.round(n * 100) / 100);
        }
        setValue('dash-overview-total-revenue', revenueTotal);
        setValue('dash-overview-total-cost', costTotal);
        setValue('dash-overview-total-profit', profitTotal);
      }

      function setOverviewCostBreakdownTooltip(snapshotPayload) {
        var iconEl = document.getElementById('dash-overview-cost-breakdown-icon');
        var costEl = document.getElementById('dash-overview-total-cost');
        var Popover = window.bootstrap && window.bootstrap.Popover;
        function disposePopover(el) {
          if (!el || !Popover) return;
          try {
            var existing = Popover.getInstance(el);
            if (existing) { existing.hide(); existing.dispose(); }
          } catch (_) {}
        }
        function upsertPopover(el, contentHtml) {
          if (!el || !Popover) return;
          try {
            disposePopover(el);
            if (!contentHtml) return;
            var pop = new Popover(el, {
              trigger: 'hover focus',
              placement: 'bottom',
              html: true,
              container: document.body,
              customClass: 'kexo-cost-breakdown-popover',
              content: contentHtml
            });
            // Ensure screen-readers have an accessible name even if markup uses aria-hidden elsewhere.
            try {
              if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Cost breakdown');
            } catch (_) {}
            return pop;
          } catch (_) { return null; }
        }
        if (iconEl && iconEl.style) iconEl.style.display = 'none';
        disposePopover(iconEl);
        disposePopover(costEl);
        try { if (iconEl) iconEl.removeAttribute('title'); } catch (_) {}
        try { if (costEl) costEl.removeAttribute('title'); } catch (_) {}
        if (!snapshotPayload) return;
        var fin = snapshotPayload && snapshotPayload.financial && typeof snapshotPayload.financial === 'object' ? snapshotPayload.financial : null;
        var breakdown = fin && Array.isArray(fin.costBreakdownNow) ? fin.costBreakdownNow : null;
        if (!breakdown || !breakdown.length) return;
        var lines = [];
        var sum = 0;
        breakdown.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          var label = row.label != null ? String(row.label).trim() : '';
          var amt = row.amountGbp != null ? Number(row.amountGbp) : Number(row.amount);
          if (!label) return;
          if (!Number.isFinite(amt)) amt = 0;
          sum += amt;
          lines.push({ label: label, amount: Math.round(amt * 100) / 100 });
        });
        if (!lines.length) return;
        var total = Math.round(sum * 100) / 100;
        var html = '<strong>Cost breakdown</strong><br>'
          + lines.map(function(r) {
            return escapeHtml(r.label) + ': ' + escapeHtml(fmtGbp(r.amount));
          }).join('<br>')
          + '<br><strong>Total: ' + escapeHtml(fmtGbp(total)) + '</strong>';
        upsertPopover(iconEl, html);
        upsertPopover(costEl, html);
        if (iconEl && iconEl.style) iconEl.style.display = '';
      }

      function renderOverviewRevenueCostChart(snapshotPayload) {
        var chartId = 'dash-chart-overview-30d';
        if (!isChartEnabledByUiConfig(chartId)) {
          destroyDashChart(chartId);
          var hiddenEl = document.getElementById(chartId);
          if (hiddenEl) hiddenEl.innerHTML = '';
          setOverviewSalesRunningTotals(null, null, null);
          setOverviewCostBreakdownTooltip(null);
          return;
        }
        if (!snapshotPayload) {
          setOverviewSalesRunningTotals(null, null, null);
          setOverviewCostBreakdownTooltip(null);
          renderOverviewChartLoading(chartId, 'Loading sales overview…');
          return;
        }
        var current = snapshotPayload && snapshotPayload.seriesComparison && snapshotPayload.seriesComparison.current
          ? snapshotPayload.seriesComparison.current
          : null;
        var granularity = snapshotPayload && snapshotPayload.seriesComparison && snapshotPayload.seriesComparison.granularity
          ? String(snapshotPayload.seriesComparison.granularity).trim().toLowerCase()
          : 'day';
        var labelsYmd = current && Array.isArray(current.labelsYmd) ? current.labelsYmd : [];
        var revenueGbp = current && Array.isArray(current.revenueGbp) ? current.revenueGbp : [];
        var costGbp = current && Array.isArray(current.costGbp) ? current.costGbp : [];
        var len = Math.max(labelsYmd.length, revenueGbp.length, costGbp.length);
        if (!len) {
          setOverviewSalesRunningTotals(null, null, null);
          setOverviewCostBreakdownTooltip(snapshotPayload);
          renderOverviewChartEmpty(chartId, 'No sales overview data');
          return;
        }
        var labels = [];
        var revenue = [];
        var cost = [];
        var profit = [];
        var revenueTotal = 0;
        var costTotal = 0;
        var profitTotal = 0;
        for (var i = 0; i < len; i++) {
          var ymd = labelsYmd[i] != null ? String(labelsYmd[i]) : '';
          labels.push(ymd ? formatOverviewBucketLabel(ymd, granularity) : String(i + 1));
          var rev = Math.round(normalizeOverviewMetric(revenueGbp[i]));
          var cst = Math.round(normalizeOverviewMetric(costGbp[i]));
          var pft = (typeof rev === 'number' && typeof cst === 'number') ? Math.round(rev - cst) : 0;
          revenue.push(rev);
          cost.push(cst);
          profit.push(pft);
          revenueTotal += rev;
          costTotal += cst;
          profitTotal += pft;
        }
        setOverviewSalesRunningTotals(revenueTotal, costTotal, profitTotal);
        setOverviewCostBreakdownTooltip(snapshotPayload);
        var chartEl = document.getElementById(chartId);
        var chartHeight = resolveOverviewChartHeight(chartEl, 260, 140, 760);
        var overviewMode = (typeof chartModeFromUiConfig === 'function') ? chartModeFromUiConfig(chartId, 'area') : 'area';
        overviewMode = validateChartType(chartId, overviewMode, 'area');
        var overviewChartType = (overviewMode === 'multi-line-labels') ? 'line' : (overviewMode === 'stacked-area' || overviewMode === 'stacked-bar' || overviewMode === 'combo') ? overviewMode : (overviewMode || 'area');
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
        }, {
          label: 'Profit',
          data: profit,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.14)',
          fill: true,
          borderWidth: 2
        }], {
          currency: true,
          chartType: overviewChartType,
          height: chartHeight,
          legendPosition: 'bottom',
          forceTooltip: true,
          tooltipShared: true,
          tooltipIntersect: false,
          tooltipFollowCursor: true,
          markerSize: 3
        });
      }

      function fetchOverviewJson(url, force, timeoutMs) {
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, timeoutMs || 25000)
          .then(function(r) {
            if (!r) throw new Error('No response');
            if (!r.ok) throw new Error('Request failed (' + String(r.status || '') + ')');
            return r.json();
          });
      }

      function renderOverviewMiniLegend(chartId, labels, colors) {
        var id = (chartId == null ? '' : String(chartId)).trim();
        if (!id) return;
        var host = null;
        try { host = document.querySelector('[data-overview-legend="' + id + '"]'); } catch (_) { host = null; }
        if (!host) return;
        var list = Array.isArray(labels) ? labels : [];
        if (!list.length) {
          host.innerHTML = '';
          try { scheduleOverviewHeightSync(); } catch (_) {}
          return;
        }
        var cols = Array.isArray(colors) ? colors : [];
        var html = '';
        for (var i = 0; i < list.length; i++) {
          var lbl = list[i] != null ? String(list[i]).trim() : '';
          if (!lbl) continue;
          var c = cols[i] != null ? String(cols[i]) : '';
          html += '<span class="kexo-overview-mini-legend-item">'
            + '<span class="kexo-overview-mini-legend-swatch" style="background:' + escapeHtml(c || '#94a3b8') + '"></span>'
            + escapeHtml(lbl)
            + '</span>';
        }
        host.innerHTML = html;
        try { scheduleOverviewHeightSync(); } catch (_) {}
      }

      function overviewCardStyleSigFor(chartId) {
        try {
          if (typeof chartStyleFromUiConfig !== 'function') return '';
          var key = String(chartId || '');
          return JSON.stringify({
            enabled: (typeof isChartEnabledByUiConfig === 'function') ? isChartEnabledByUiConfig(key, true) : true,
            mode: (typeof chartModeFromUiConfig === 'function') ? chartModeFromUiConfig(key, '') : '',
            colors: (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(key, []) : [],
            style: chartStyleFromUiConfig(key) || {},
          }) || '';
        } catch (_) { return ''; }
      }

      function ensureOverviewLazyObserver() {
        if (overviewLazyObserver || typeof IntersectionObserver === 'undefined') return;
        overviewLazyObserver = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (!entry || !entry.target || !entry.target.id) return;
            var chartId = String(entry.target.id);
            overviewLazyVisible[chartId] = !!entry.isIntersecting;
            if (!entry.isIntersecting) return;
            var pending = overviewLazyPending && overviewLazyPending[chartId] ? overviewLazyPending[chartId] : null;
            if (!pending) return;
            try { delete overviewLazyPending[chartId]; } catch (_) {}
            var run = function() {
              try {
                renderOverviewCardById(chartId, pending.payload, Object.assign({}, pending.options || {}, { forceRender: true, reason: 'lazy-visible' }));
              } catch (_) {}
            };
            if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1200 });
            else setTimeout(run, 0);
          });
        }, { root: null, rootMargin: '120px 0px', threshold: 0.1 });
      }

      function shouldLazyRenderOverviewChart(chartId) {
        return !!(OVERVIEW_LAZY_CHART_IDS && OVERVIEW_LAZY_CHART_IDS[chartId]);
      }

      function observeOverviewChartIfLazy(chartId) {
        if (!shouldLazyRenderOverviewChart(chartId)) return;
        ensureOverviewLazyObserver();
        if (!overviewLazyObserver) return;
        try {
          var el = document.getElementById(chartId);
          if (el) overviewLazyObserver.observe(el);
        } catch (_) {}
      }

      function isOverviewChartVisible(chartId) {
        if (!shouldLazyRenderOverviewChart(chartId)) return true;
        if (overviewLazyVisible[chartId] != null) return !!overviewLazyVisible[chartId];
        try {
          var el = document.getElementById(chartId);
          if (!el || !el.getBoundingClientRect) return false;
          var rect = el.getBoundingClientRect();
          var h = (window && window.innerHeight) ? window.innerHeight : 0;
          return rect.bottom > 0 && rect.top < h;
        } catch (_) {
          return false;
        }
      }

      function renderOverviewCardById(chartId, payload, options) {
        var opts = options && typeof options === 'object' ? options : {};
        var reason = opts.reason != null ? String(opts.reason) : '';
        var rk = opts.rangeKey != null ? normalizeOverviewCardRangeKey(opts.rangeKey, OVERVIEW_CARD_DEFAULT_RANGE) : getOverviewCardRange(chartId, OVERVIEW_CARD_DEFAULT_RANGE);
        observeOverviewChartIfLazy(chartId);
        if (!opts.forceRender && shouldLazyRenderOverviewChart(chartId) && !isOverviewChartVisible(chartId)) {
          overviewLazyPending[chartId] = { payload: payload, options: { rangeKey: rk } };
          return;
        }

        // NOTE: Avoid JSON stringifying the full /api/dashboard-series payload. Build a small sig from rendered data.
        var styleSig = overviewCardStyleSigFor(chartId);
        var payloadSig = '';
        var doRender = null;

        if (chartId === 'dash-chart-finishes-30d') {
          var finishesRows = payload && Array.isArray(payload.finishes) ? payload.finishes : (payload && payload.finishes && Array.isArray(payload.finishes.finishes) ? payload.finishes.finishes : []);
          var finishPairs = [];
          (finishesRows || []).forEach(function(row) {
            if (!row || typeof row !== 'object') return;
            var label = '';
            if (row.label != null && String(row.label).trim()) label = String(row.label).trim();
            else if (row.finish != null && String(row.finish).trim()) label = String(row.finish).trim();
            else if (row.key != null && String(row.key).trim()) label = String(row.key).trim().replace(/_/g, ' ');
            var val = normalizeOverviewMetric(row.revenueGbp != null ? row.revenueGbp : row.revenue);
            if (!label || val <= 0) return;
            finishPairs.push({ label: label, value: val });
          });
          finishPairs.sort(function(a, b) { return (b.value || 0) - (a.value || 0); });
          var topFinishes = finishPairs.slice(0, 5);
          var finishLabels = topFinishes.map(function(p) { return p.label; });
          var finishValues = topFinishes.map(function(p) { return p.value; });
          var fallbackColors = ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab'];
          var colors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors) : fallbackColors;
          payloadSig = JSON.stringify({ labels: finishLabels, values: finishValues, rk: rk }) || '';
          doRender = function() {
            var finishesOpts = {
              colors: colors,
              valueFormatter: function(v) { return fmtGbp(normalizeOverviewMetric(v)) || '\u2014'; },
              height: 180
            };
            var finishesMode = (typeof chartModeFromUiConfig === 'function') ? String(chartModeFromUiConfig(chartId, 'radialbar') || 'radialbar').trim().toLowerCase() : 'radialbar';
            finishesMode = validateChartType(chartId, finishesMode, 'radialbar');
            if (!finishLabels.length || !finishValues.length) {
              renderOverviewChartEmpty(chartId, 'No finishes data');
              renderOverviewMiniLegend(chartId, [], []);
            } else if (finishesMode === 'radialbar') {
              renderOverviewFinishesRadialBar(chartId, finishLabels, finishValues, finishesOpts);
              renderOverviewMiniLegend(chartId, finishLabels, colors);
            } else if (finishesMode === 'bar' || finishesMode === 'bar-horizontal' || finishesMode === 'bar-distributed') {
              renderOverviewFinishesBarChart(chartId, finishLabels, finishValues, Object.assign({}, finishesOpts, { horizontal: finishesMode === 'bar-horizontal' }));
              renderOverviewMiniLegend(chartId, [], []);
            } else if (finishesMode === 'area' || finishesMode === 'line' || finishesMode === 'multi-line-labels') {
              makeChart(chartId, finishLabels, [{ label: 'Revenue', data: finishValues, borderColor: (colors && colors[0]) || DASH_ACCENT, backgroundColor: (colors && colors[0]) ? (colors[0] + '33') : DASH_ACCENT_LIGHT, fill: finishesMode === 'area', borderWidth: 2 }], { currency: true, chartType: finishesMode, height: 180 });
              renderOverviewMiniLegend(chartId, finishLabels, colors);
            } else {
              renderOverviewPieChart(chartId, finishLabels, finishValues, {
                colors: colors,
                valueFormatter: finishesOpts.valueFormatter,
                height: finishesOpts.height,
                donut: finishesMode === 'donut'
              });
              renderOverviewMiniLegend(chartId, finishLabels, colors);
            }
          };
        } else if (chartId === 'dash-chart-devices-30d') {
          var deviceRows = payload && payload.devices && Array.isArray(payload.devices.rows) ? payload.devices.rows : [];
          var agg = {
            ios: { sessions: 0, orders: 0, revenue: 0 },
            android: { sessions: 0, orders: 0, revenue: 0 },
            windows: { sessions: 0, orders: 0, revenue: 0 },
            mac: { sessions: 0, orders: 0, revenue: 0 },
            linux: { sessions: 0, orders: 0, revenue: 0 },
          };
          (deviceRows || []).forEach(function(d) {
            if (!d || !Array.isArray(d.platforms)) return;
            (d.platforms || []).forEach(function(p) {
              var key = p && p.platform != null ? String(p.platform).trim().toLowerCase() : '';
              if (!key || !agg[key]) return;
              agg[key].sessions += normalizeOverviewMetric(p.sessions);
              agg[key].orders += normalizeOverviewMetric(p.orders);
              agg[key].revenue += normalizeOverviewMetric(p.revenue_gbp);
            });
          });
          var orderKeys = ['ios', 'android', 'windows', 'mac', 'linux'];
          var platforms = [];
          orderKeys.forEach(function(k) {
            var a = agg[k];
            if (!a) return;
            var s = Math.max(0, Math.round(normalizeOverviewMetric(a.sessions)));
            var o = Math.max(0, Math.round(normalizeOverviewMetric(a.orders)));
            var r = Math.round(normalizeOverviewMetric(a.revenue) * 100) / 100;
            if (!(s > 0 || o > 0 || r > 0)) return;
            platforms.push({ platform: k, label: platformLabelForKey(k), sessions: s, orders: o, revenue_gbp: r });
          });
          payloadSig = JSON.stringify(platforms.map(function(r) {
            return [String(r.platform || ''), normalizeOverviewMetric(r.sessions), normalizeOverviewMetric(r.orders), normalizeOverviewMetric(r.revenue_gbp)];
          }).concat([rk])) || '';
          doRender = function() {
            var fallbackColors2 = ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
            var devicesColors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(chartId, fallbackColors2) : fallbackColors2;
            var devicesOpts = { colors: devicesColors, height: 180 };
            try {
              var legendEl = document.getElementById(chartId) && document.getElementById(chartId).parentElement
                ? document.getElementById(chartId).parentElement.parentElement.querySelector('[data-overview-legend="' + chartId + '"]')
                : null;
              if (legendEl) legendEl.innerHTML = '';
            } catch (_) {}
            if (!platforms.length) {
              renderOverviewChartEmpty(chartId, 'No device data');
              clearOverviewDevicesYIcons(chartId);
              return;
            }
            var devicesMode = (typeof chartModeFromUiConfig === 'function')
              ? String(chartModeFromUiConfig(chartId, 'bar-horizontal') || 'bar-horizontal').trim().toLowerCase()
              : 'bar-horizontal';
            devicesMode = validateChartType(chartId, devicesMode, 'bar-horizontal');
            if (devicesMode === 'bar-horizontal' || devicesMode === 'bar' || devicesMode === 'bar-distributed') {
              renderOverviewDevicesHorizontalBar(chartId, platforms, Object.assign({}, devicesOpts, { horizontal: devicesMode === 'bar-horizontal' }));
            } else if (devicesMode === 'line' || devicesMode === 'area' || devicesMode === 'multi-line-labels') {
              var labels = platforms.map(function(p) { return p && p.label ? String(p.label) : ''; });
              var values = platforms.map(function(p) { return p && Number.isFinite(Number(p.sessions)) ? Number(p.sessions) : 0; });
              var orders = platforms.map(function(p) { return p && Number.isFinite(Number(p.orders)) ? Number(p.orders) : 0; });
              var revenues = platforms.map(function(p) { return p && Number.isFinite(Number(p.revenue_gbp)) ? Number(p.revenue_gbp) : 0; });
              var keys = platforms.map(function(p) { return p && p.platform != null ? String(p.platform) : ''; });
              makeChart(chartId, labels, [{
                label: 'Sessions',
                data: values,
                borderColor: (devicesColors && devicesColors[0]) || DASH_BLUE,
                backgroundColor: (devicesColors && devicesColors[0]) ? (devicesColors[0] + '33') : DASH_BLUE_LIGHT,
                fill: devicesMode === 'area',
                borderWidth: 2
              }], {
                chartType: devicesMode,
                height: 180,
                tooltipCustom: function(tip) {
                  var idx = tip && tip.dataPointIndex != null ? tip.dataPointIndex : -1;
                  var name = (idx >= 0 && idx < labels.length) ? labels[idx] : '';
                  var sess = (idx >= 0 && idx < values.length) ? values[idx] : 0;
                  var ord = (idx >= 0 && idx < orders.length) ? orders[idx] : 0;
                  var rev = (idx >= 0 && idx < revenues.length) ? revenues[idx] : 0;
                  var pKey = (idx >= 0 && idx < keys.length) ? keys[idx] : '';
                  var crStr = (sess > 0) ? ((ord / sess) * 100).toFixed(1) + '%' : '\u2014';
                  var iconHtml = platformIconHtmlForKey(pKey, name);
                  return '<div class="kexo-tooltip-card p-2">' +
                    '<div class="fw-semibold d-flex align-items-center gap-2">' + iconHtml + escapeHtml(name || '') + '</div>' +
                    '<div>Sessions: ' + escapeHtml(fmtNum(sess)) + '</div>' +
                    '<div>Orders: ' + escapeHtml(fmtNum(ord)) + '</div>' +
                    '<div>Conversion: ' + escapeHtml(crStr) + '</div>' +
                    '<div>Revenue: ' + escapeHtml(fmtGbp(normalizeOverviewMetric(rev)) || '\u2014') + '</div>' +
                  '</div>';
                }
              });
              clearOverviewDevicesYIcons(chartId);
            } else {
              renderOverviewDevicesHorizontalBar(chartId, platforms, Object.assign({}, devicesOpts, { horizontal: true }));
            }
          };
        } else if (chartId === 'dash-chart-attribution-30d') {
          try {
            var rows = payload && payload.attribution && Array.isArray(payload.attribution.rows) ? payload.attribution.rows : (payload && payload.attribution && payload.attribution.attribution && Array.isArray(payload.attribution.attribution.rows) ? payload.attribution.attribution.rows : []);
            payloadSig = JSON.stringify({ rk: rk, n: rows && rows.length ? rows.length : 0 }) || '';
          } catch (_) { payloadSig = String(rk); }
          doRender = function() { renderOverviewAttributionChart(payload); };
        } else if (chartId === 'dash-chart-overview-30d') {
          try {
            var cur = payload && payload.seriesComparison && payload.seriesComparison.current ? payload.seriesComparison.current : null;
            var labelsYmd = cur && Array.isArray(cur.labelsYmd) ? cur.labelsYmd : [];
            payloadSig = JSON.stringify({ rk: rk, labels: labelsYmd }) || '';
          } catch (_) { payloadSig = String(rk); }
          doRender = function() { renderOverviewRevenueCostChart(payload); };
        } else {
          return;
        }

        var sig = payloadSig + '|style:' + styleSig;
        if (reason !== 'resize' && !opts.forceRender && sig && overviewCardPayloadSignature[chartId] && sig === overviewCardPayloadSignature[chartId]) {
          return;
        }
        overviewCardPayloadSignature[chartId] = sig;
        if (typeof doRender === 'function') doRender();
        scheduleOverviewHeightSync();
      }

      function rerenderOverviewCardsFromCache(options) {
        var opts = options && typeof options === 'object' ? options : {};
        var reason = opts.reason != null ? String(opts.reason) : 'rerender';
        try {
          overviewMiniChartIds().forEach(function (id) {
            var entry = overviewCardCache && overviewCardCache[id] ? overviewCardCache[id] : null;
            if (!entry || !entry.payload) return;
            renderOverviewCardById(id, entry.payload, { reason: reason, rangeKey: entry.rangeKey, forceRender: true });
          });
        } catch (_) {}
        scheduleOverviewHeightSync();
      }

      function renderOverviewMiniCharts(payload, options) {
        var opts = options && typeof options === 'object' ? options : {};
        var reason = opts.reason != null ? String(opts.reason) : '';
        var payloadSigBase = opts.payloadSignature != null ? String(opts.payloadSignature) : overviewMiniPayloadSig(payload);
        var payloadSig = payloadSigBase + '|style:' + overviewMiniStyleSig();
        if (reason !== 'resize' && !opts.forceRender && payloadSig && overviewMiniPayloadSignature && payloadSig === overviewMiniPayloadSignature) {
          return;
        }
        var finishesRows = payload && payload.finishes && Array.isArray(payload.finishes.finishes) ? payload.finishes.finishes : [];
        var finishPairs = [];
        finishesRows.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          var label = '';
          if (row.label != null && String(row.label).trim()) label = String(row.label).trim();
          else if (row.finish != null && String(row.finish).trim()) label = String(row.finish).trim();
          else if (row.key != null && String(row.key).trim()) label = String(row.key).trim().replace(/_/g, ' ');
          var val = normalizeOverviewMetric(row.revenueGbp != null ? row.revenueGbp : row.revenue);
          if (!label || val <= 0) return;
          finishPairs.push({ label: label, value: val });
        });
        finishPairs.sort(function(a, b) { return (b.value || 0) - (a.value || 0); });
        var topFinishes = finishPairs.slice(0, 5);
        var finishLabels = topFinishes.map(function(p) { return p.label; });
        var finishValues = topFinishes.map(function(p) { return p.value; });
        var finishesChartId = 'dash-chart-finishes-30d';
        var finishesOpts = {
          colors: ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab'],
          valueFormatter: function(v) { return fmtGbp(normalizeOverviewMetric(v)) || '\u2014'; },
          height: 180
        };
        var finishesMode = (typeof chartModeFromUiConfig === 'function') ? String(chartModeFromUiConfig(finishesChartId, 'radialbar') || 'radialbar').trim().toLowerCase() : 'radialbar';
        if (!finishLabels.length || !finishValues.length) {
          renderOverviewChartEmpty(finishesChartId, 'No finishes data');
        } else if (finishesMode === 'radialbar') {
          renderOverviewFinishesRadialBar(finishesChartId, finishLabels, finishValues, finishesOpts);
        } else if (finishesMode === 'bar-horizontal' || finishesMode === 'bar' || finishesMode === 'bar-distributed') {
          renderOverviewFinishesBarChart(finishesChartId, finishLabels, finishValues, Object.assign({}, finishesOpts, { horizontal: finishesMode === 'bar-horizontal' }));
        } else if (finishesMode === 'line' || finishesMode === 'area' || finishesMode === 'multi-line-labels') {
          makeChart(finishesChartId, finishLabels, [{
            label: 'Revenue',
            data: finishValues,
            borderColor: (finishesOpts.colors && finishesOpts.colors[0]) || DASH_ACCENT,
            backgroundColor: (finishesOpts.colors && finishesOpts.colors[0]) ? (finishesOpts.colors[0] + '33') : DASH_ACCENT_LIGHT,
            fill: finishesMode === 'area',
            borderWidth: 2
          }], { currency: true, chartType: finishesMode, height: finishesOpts.height });
        } else {
          renderOverviewPieChart(finishesChartId, finishLabels, finishValues, {
            colors: finishesOpts.colors,
            valueFormatter: finishesOpts.valueFormatter,
            height: finishesOpts.height,
            donut: finishesMode === 'donut'
          });
        }

        var countriesRows = payload && payload.countries && Array.isArray(payload.countries.topCountries) ? payload.countries.topCountries : [];
        var topCountries = countriesRows.filter(function(row) {
          if (!row || typeof row !== 'object') return false;
          var cc = countryCodeFromRow(row) || (row.country != null ? String(row.country).trim().toUpperCase().slice(0, 2) : '');
          var val = normalizeOverviewMetric(row.revenue);
          return (cc || row.revenue != null) && val > 0;
        }).slice(0, 5);
        var countriesChartId = 'dash-chart-countries-30d';
        var countriesMode = (typeof chartModeFromUiConfig === 'function') ? String(chartModeFromUiConfig(countriesChartId, 'bar-horizontal') || 'bar-horizontal').trim().toLowerCase() : 'bar-horizontal';
        var allowedCountriesModes = ['bar-horizontal', 'bar', 'bar-distributed', 'pie', 'donut', 'radialbar', 'line', 'area', 'multi-line-labels'];
        if (allowedCountriesModes.indexOf(countriesMode) < 0) countriesMode = 'bar-horizontal';
        var fallbackCountriesColors = ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
        var countriesColors = (typeof chartColorsFromUiConfig === 'function') ? chartColorsFromUiConfig(countriesChartId, fallbackCountriesColors) : fallbackCountriesColors;
        var countriesOpts = { colors: countriesColors, height: 180 };
        try {
          var legendEl = document.getElementById(countriesChartId) && document.getElementById(countriesChartId).parentElement
            ? document.getElementById(countriesChartId).parentElement.querySelector('[data-overview-legend="' + countriesChartId + '"]')
            : null;
          if (legendEl) legendEl.innerHTML = '';
        } catch (_) {}
        if (countriesMode === 'bar-horizontal' || countriesMode === 'bar' || countriesMode === 'bar-distributed') {
          renderOverviewCountriesHorizontalBar(countriesChartId, topCountries, Object.assign({}, countriesOpts, { horizontal: countriesMode === 'bar-horizontal' }));
        } else if (countriesMode === 'radialbar') {
          var rbLabels = [];
          var rbValues = [];
          topCountries.forEach(function(row) {
            var cc = countryCodeFromRow(row) || '';
            if (!cc) {
              var raw = row && row.country != null ? String(row.country).trim() : '';
              cc = raw ? raw.toUpperCase().slice(0, 2) : '';
              if (cc === 'UK') cc = 'GB';
              if (!/^[A-Z]{2}$/.test(cc)) cc = '';
            }
            var name = cc ? ((typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc) : '';
            var val = normalizeOverviewMetric(row && row.revenue);
            rbLabels.push(name || cc || (row && row.country != null ? String(row.country).trim() : ''));
            rbValues.push(val);
          });
          renderOverviewFinishesRadialBar(countriesChartId, rbLabels, rbValues, countriesOpts);
        } else if (countriesMode === 'line' || countriesMode === 'area' || countriesMode === 'multi-line-labels') {
          var lineLabels = [];
          var lineValues = [];
          topCountries.forEach(function(row) {
            var cc = countryCodeFromRow(row) || '';
            if (!cc) {
              var raw = row && row.country != null ? String(row.country).trim() : '';
              cc = raw ? raw.toUpperCase().slice(0, 2) : '';
              if (cc === 'UK') cc = 'GB';
              if (!/^[A-Z]{2}$/.test(cc)) cc = '';
            }
            var name = cc ? ((typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc) : '';
            var val = normalizeOverviewMetric(row && row.revenue);
            lineLabels.push(name || cc || (row && row.country != null ? String(row.country).trim() : ''));
            lineValues.push(val);
          });
          makeChart(countriesChartId, lineLabels, [{
            label: 'Revenue',
            data: lineValues,
            borderColor: (countriesColors && countriesColors[0]) || DASH_ACCENT,
            backgroundColor: (countriesColors && countriesColors[0]) ? (countriesColors[0] + '33') : DASH_ACCENT_LIGHT,
            fill: countriesMode === 'area',
            borderWidth: 2
          }], { currency: true, chartType: countriesMode, height: countriesOpts.height });
        } else {
          var countryLabels = [];
          var countryValues = [];
          var countriesUiStyle = (typeof chartStyleFromUiConfig === 'function') ? chartStyleFromUiConfig(countriesChartId) : null;
          var showFlags = !!(countriesUiStyle && countriesUiStyle.pieCountryFlags);
          var countryCodesForMini = [];
          topCountries.forEach(function(row) {
            var cc = countryCodeFromRow(row);
            if (!cc) {
              var raw = row.country != null ? String(row.country).trim() : '';
              cc = raw ? raw.toUpperCase().slice(0, 2) : '';
              if (cc === 'UK') cc = 'GB';
              if (!/^[A-Z]{2}$/.test(cc)) cc = '';
            }
            var name = cc ? ((typeof countryLabelFull === 'function') ? countryLabelFull(cc) : cc) : '';
            var val = normalizeOverviewMetric(row.revenue);
            countryLabels.push(name || cc || (row.country != null ? String(row.country).trim() : ''));
            countryValues.push(val);
            countryCodesForMini.push(cc || '');
          });
          renderOverviewPieChart(countriesChartId, countryLabels, countryValues, {
            colors: countriesOpts.colors,
            valueFormatter: function(v) { return fmtGbp(normalizeOverviewMetric(v)) || '\u2014'; },
            height: countriesOpts.height,
            donut: countriesMode === 'donut',
            countryCodes: showFlags ? countryCodesForMini : null
          });
        }
        var attributionRows = payload && payload.attribution && payload.attribution.attribution && Array.isArray(payload.attribution.attribution.rows)
          ? payload.attribution.attribution.rows
          : [];
        var attributionRevenueNow = 0;
        attributionRows.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          var rev = row.revenue_gbp != null ? normalizeOverviewMetric(row.revenue_gbp) : 0;
          attributionRevenueNow += rev;
        });

        var attributionPrevRows = payload && payload.attributionPrev && payload.attributionPrev.attribution && Array.isArray(payload.attributionPrev.attribution.rows)
          ? payload.attributionPrev.attribution.rows
          : [];
        var attributionRevenuePrev = 0;
        attributionPrevRows.forEach(function(row) {
          if (!row || typeof row !== 'object') return;
          var rev = row.revenue_gbp != null ? normalizeOverviewMetric(row.revenue_gbp) : 0;
          attributionRevenuePrev += rev;
        });

        var snapshotRevenueNow = payload && payload.snapshot && payload.snapshot.financial && payload.snapshot.financial.revenue
          ? normalizeOverviewMetric(payload.snapshot.financial.revenue.value)
          : 0;
        var snapshotRevenuePrev = payload && payload.snapshot && payload.snapshot.financial && payload.snapshot.financial.revenue
          ? normalizeOverviewMetric(payload.snapshot.financial.revenue.previous)
          : 0;
        if (snapshotRevenueNow <= 0 && payload && payload.countries && payload.countries.summary && payload.countries.summary.revenue != null) {
          snapshotRevenueNow = normalizeOverviewMetric(payload.countries.summary.revenue);
        }
        renderOverviewMiniCardStats({
          revenueNow: snapshotRevenueNow,
          revenuePrev: snapshotRevenuePrev,
          attributionRevenueNow: attributionRevenueNow,
          attributionRevenuePrev: attributionRevenuePrev,
        });

        renderOverviewAttributionChart(payload ? payload.attribution : null);

        renderOverviewRevenueCostChart(payload ? payload.snapshot : null);
        scheduleOverviewHeightSync();
        overviewMiniSizeSignature = computeOverviewMiniSizeSignature();
        overviewMiniPayloadSignature = payloadSig;
      }

      function safeYmdAddDays(ymd, deltaDays) {
        var d = (typeof deltaDays === 'number' && Number.isFinite(deltaDays)) ? deltaDays : Number(deltaDays);
        if (!Number.isFinite(d) || !ymd) return null;
        try { if (typeof ymdAddDays === 'function') return ymdAddDays(ymd, d); } catch (_) {}
        var m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!m) return null;
        try {
          var dt = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
          dt.setUTCDate(dt.getUTCDate() + d);
          return dt.toISOString().slice(0, 10);
        } catch (_) {
          return null;
        }
      }

      function buildBusinessSnapshotUrlForOverviewRange(rangeKey, force, stamp) {
        var rk = normalizeOverviewCardRangeKey(rangeKey, OVERVIEW_CARD_DEFAULT_RANGE);
        var url = API + '/api/business-snapshot?mode=range';
        var isSingleDay = rk === 'today' || rk === 'yesterday' || /^d:\d{4}-\d{2}-\d{2}$/.test(rk);
        if (rk === '7d') {
          url += '&preset=last_7_days';
        } else {
          var since = null;
          var until = null;
          if (rk === 'today') {
            since = (typeof ymdNowInTz === 'function') ? ymdNowInTz() : null;
            until = since;
          } else if (rk === 'yesterday') {
            var y = (typeof ymdNowInTz === 'function') ? ymdNowInTz() : null;
            var yd = y ? safeYmdAddDays(y, -1) : null;
            since = yd;
            until = yd;
          } else if (/^d:\d{4}-\d{2}-\d{2}$/.test(rk)) {
            since = rk.slice(2);
            until = rk.slice(2);
          } else {
            var m = rk.match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
            if (m && m[1] && m[2]) {
              since = m[1];
              until = m[2];
              if (m[1] === m[2]) isSingleDay = true;
            }
          }
          if (since && until) url += '&preset=custom&since=' + encodeURIComponent(String(since)) + '&until=' + encodeURIComponent(String(until));
          else url += '&preset=last_7_days';
        }
        if (isSingleDay) url += '&granularity=hour';
        if (force) url += '&force=1&_=' + encodeURIComponent(String(stamp || Date.now()));
        return url;
      }

      function buildOverviewCardFetchUrl(chartId, rangeKey, force, stamp, shop) {
        var id = (chartId == null ? '' : String(chartId)).trim();
        var rk = normalizeOverviewCardRangeKey(rangeKey, OVERVIEW_CARD_DEFAULT_RANGE);
        if (id === 'dash-chart-overview-30d') return buildBusinessSnapshotUrlForOverviewRange(rk, force, stamp);
        var url = '';
        if (id === 'dash-chart-finishes-30d') {
          url = API + '/api/shopify-finishes?range=' + encodeURIComponent(rk);
          if (shop) url += '&shop=' + encodeURIComponent(String(shop));
        } else if (id === 'dash-chart-devices-30d') {
          url = API + '/api/devices/report?range=' + encodeURIComponent(rk);
        } else if (id === 'dash-chart-attribution-30d') {
          url = API + '/api/attribution/report?range=' + encodeURIComponent(rk);
        } else {
          return null;
        }
        if (force) url += '&force=1&_=' + encodeURIComponent(String(stamp || Date.now()));
        return url;
      }

      function fetchOverviewCardData(chartId, options) {
        var opts = options && typeof options === 'object' ? options : {};
        var force = !!opts.force;
        var renderIfFresh = !!opts.renderIfFresh;
        var id = (chartId == null ? '' : String(chartId)).trim();
        if (!id) return Promise.resolve(null);

        var rk = normalizeOverviewCardRangeKey(opts.rangeKey != null ? opts.rangeKey : (typeof dashRangeKeyFromDateRange === 'function' ? dashRangeKeyFromDateRange() : OVERVIEW_CARD_DEFAULT_RANGE), OVERVIEW_CARD_DEFAULT_RANGE);

        var shop = (id === 'dash-chart-finishes-30d') ? getShopForSales() : null;
        var shopKey = shop || '__no_shop__';
        var entry = overviewCardCache && overviewCardCache[id] ? overviewCardCache[id] : null;
        var fresh = !force &&
          entry &&
          entry.payload &&
          entry.fetchedAt &&
          (Date.now() - entry.fetchedAt) < OVERVIEW_MINI_CACHE_MS &&
          entry.rangeKey === rk &&
          (id !== 'dash-chart-finishes-30d' || entry.shopKey === shopKey);

        if (fresh) {
          if (renderIfFresh) {
            try { renderOverviewCardById(id, entry.payload, { reason: 'fresh-cache', rangeKey: rk }); } catch (_) {}
          }
          return Promise.resolve(entry.payload);
        }

        if (overviewCardInFlight[id] && !force) return overviewCardInFlight[id];

        if (!entry || !entry.payload) {
          renderOverviewChartLoading(id, id === 'dash-chart-overview-30d' ? 'Loading revenue & cost…' : 'Loading…');
        }

        var stamp = Date.now();
        var url = buildOverviewCardFetchUrl(id, rk, force, stamp, shop);
        if (!url) return Promise.resolve(null);
        var timeoutMs = (id === 'dash-chart-overview-30d') ? 30000 : 25000;

        overviewCardInFlight[id] = fetchOverviewJson(url, force, timeoutMs)
          .then(function(data) {
            if (!data) return null;
            overviewCardCache[id] = { rangeKey: rk, fetchedAt: Date.now(), payload: data, shopKey: shopKey };
            try { renderOverviewCardById(id, data, { reason: force ? 'force-fetch' : 'fetch', rangeKey: rk, forceRender: true }); } catch (_) {}
            overviewMiniFetchedAt = Date.now();
            return data;
          })
          .catch(function(err) {
            try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'dashboardOverviewCard', chartId: id, page: PAGE }); } catch (_) {}
            var cached = overviewCardCache && overviewCardCache[id] ? overviewCardCache[id] : null;
            if (cached && cached.payload && cached.rangeKey === rk) {
              try { renderOverviewCardById(id, cached.payload, { reason: 'error-cache', rangeKey: rk, forceRender: true }); } catch (_) {}
              return cached.payload;
            }
            try { renderOverviewChartEmpty(id, 'Failed to load'); } catch (_) {}
            return null;
          })
          .finally(function() {
            overviewCardInFlight[id] = null;
          });

        return overviewCardInFlight[id];
      }

      function openOverviewCardCustomRange(chartId) {
        var id = (chartId == null ? '' : String(chartId)).trim();
        if (!id) return;
        if (typeof window.__kexoOpenCustomDateModalFor !== 'function') return;
        var currentRk = getOverviewCardRange(id, OVERVIEW_CARD_DEFAULT_RANGE);
        var prefill = (/^(r:|d:)/.test(currentRk)) ? currentRk : null;
        try {
          window.__kexoOpenCustomDateModalFor({
            prefillRangeKey: prefill,
            onApply: function(res) {
              var next = res && res.rangeKey != null ? String(res.rangeKey) : '';
              next = normalizeOverviewCardRangeKey(next, OVERVIEW_CARD_DEFAULT_RANGE);
              setOverviewCardRange(id, next);
              syncOverviewCardRangeUi(id);
              fetchOverviewCardData(id, { force: true, rangeKey: next, renderIfFresh: true });
            }
          });
        } catch (_) {}
      }

      function bindOverviewCardUiOnce() {
        if (overviewCardUiBound) return;
        overviewCardUiBound = true;
        try {
          document.addEventListener('click', function(e) {
            var t = e && e.target ? e.target : null;
            if (!t || !t.closest) return;

            var rangeBtn = t.closest('[data-overview-range][data-overview-chart]');
            if (rangeBtn) {
              e.preventDefault();
              var chartId = String(rangeBtn.getAttribute('data-overview-chart') || '').trim();
              var rangeKey = String(rangeBtn.getAttribute('data-overview-range') || '').trim().toLowerCase();
              if (!chartId || !rangeKey) return;
              if (rangeKey === 'custom') {
                openOverviewCardCustomRange(chartId);
                return;
              }
              var next = normalizeOverviewCardRangeKey(rangeKey, OVERVIEW_CARD_DEFAULT_RANGE);
              setOverviewCardRange(chartId, next);
              syncOverviewCardRangeUi(chartId);
              fetchOverviewCardData(chartId, { force: true, rangeKey: next, renderIfFresh: true });
              return;
            }

            var settingsBtn = t.closest('.kexo-overview-chart-settings-btn[data-kexo-chart-settings-key]');
            if (settingsBtn) {
              e.preventDefault();
              e.stopPropagation();
              var chartKey = String(settingsBtn.getAttribute('data-kexo-chart-settings-key') || '').trim();
              if (!chartKey) return;
              var cardTitle = '';
              try {
                var wrap = overviewCardWrap(chartKey);
                var titleEl = wrap ? wrap.querySelector('.subheader') : null;
                cardTitle = titleEl && titleEl.textContent ? String(titleEl.textContent).trim() : '';
              } catch (_) {}
              try {
                if (window.KexoChartSettingsBuilder && typeof window.KexoChartSettingsBuilder.openModal === 'function') {
                  window.KexoChartSettingsBuilder.openModal({ chartKey: chartKey, cardTitle: cardTitle || chartKey });
                  return;
                }
                if (window.KexoLayoutShortcuts && typeof window.KexoLayoutShortcuts.openChartModal === 'function') {
                  window.KexoLayoutShortcuts.openChartModal({ chartKey: chartKey, cardTitle: cardTitle || chartKey });
                }
              } catch (_) {}
              return;
            }
          });
        } catch (_) {}
      }

      function fetchOverviewMiniData(options) {
        var _dbgOn = false;
        var _dbgT0 = 0;
        var _dbgCall = 0;
        try {
          _dbgOn = !!(window && typeof window.__kexoPerfDebugEnabled === 'function' && window.__kexoPerfDebugEnabled());
          _dbgT0 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
          __kexoPerfOverviewMiniCalls += 1;
          _dbgCall = __kexoPerfOverviewMiniCalls;
        } catch (_) { _dbgOn = false; _dbgT0 = Date.now(); _dbgCall = 0; }
        if (typeof window.__applyDashboardKpiUiConfig === 'function') {
          try { window.__applyDashboardKpiUiConfig(); } catch (_) {}
        }
        ensureOverviewMiniResizeObserver();
        ensureOverviewHeightSyncObserver();
        try { syncOverviewHeightGrid(); } catch (_) {}
        scheduleOverviewHeightSync();
        bindOverviewCardUiOnce();
        syncAllOverviewCardRangeUi();

        var opts = options && typeof options === 'object' ? options : {};
        var force = !!opts.force;
        var renderIfFresh = !!opts.renderIfFresh;

        var ids = overviewMiniChartIds();
        if (!overviewMiniPayloadSignature && (!overviewCardCache || !Object.keys(overviewCardCache).length)) {
          ids.forEach(function(id) {
            renderOverviewChartLoading(id, id === 'dash-chart-overview-30d' ? 'Loading revenue & cost…' : 'Loading…');
          });
        }

        overviewMiniInFlight = Promise.all(ids.map(function(id) {
          return fetchOverviewCardData(id, { force: force, renderIfFresh: renderIfFresh });
        })).then(function() {
          overviewMiniFetchedAt = Date.now();
          overviewMiniPayloadSignature = 'cards:' + ids.map(function(id) {
            var entry = overviewCardCache && overviewCardCache[id] ? overviewCardCache[id] : null;
            return id + ':' + (entry && entry.rangeKey ? entry.rangeKey : '');
          }).join('|');
          overviewMiniSizeSignature = computeOverviewMiniSizeSignature();
          // #region agent log
          if (_dbgOn) {
            var _t1 = 0;
            try { _t1 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch (_) { _t1 = Date.now(); }
            var _ms = Math.max(0, Math.round(_t1 - (_dbgT0 || 0)));
            fetch('http://127.0.0.1:7242/ingest/a370db6d-7333-4112-99f8-dd4bc899a89b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'14-dashboard.js:fetchOverviewMiniData',message:'overview mini cards fetched',data:{call:_dbgCall,force:!!force,renderIfFresh:!!renderIfFresh,ms_total:_ms,charts:ids.length,payload_sig_len:overviewMiniPayloadSignature?String(overviewMiniPayloadSignature).length:0},timestamp:Date.now(),runId:(typeof window.__kexoPerfDebugRunId==='function'?window.__kexoPerfDebugRunId():'baseline'),hypothesisId:'H1'} )}).catch(()=>{});
          }
          // #endregion
          return overviewCardCache;
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
        // sparkBaseline: 'zero' = include 0 baseline (revenue, sessions, orders, aov, cogs, etc.);
        // 'percent' = clamp [0,100] (conversion, bounce); 'symmetric' = include 0 and allow negative (returns).
        function renderSparkline(elId, dataArr, color, compareDataArr, sparkBaseline) {
          var sparkEl = el(elId);
          if (!sparkEl || typeof ApexCharts === 'undefined') return;
          if (dataArr.length < 2) dataArr = dataArr.length === 1 ? [dataArr[0], dataArr[0]] : [0, 0];
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
          var baseline = (sparkBaseline === 'percent' || sparkBaseline === 'symmetric') ? sparkBaseline : 'zero';

          var nums = dataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return isFinite(n) ? n : 0;
          });
          if (baseline === 'percent') {
            nums = nums.map(function(n) { return Math.max(0, Math.min(100, n)); });
          }
          var compareNums = Array.isArray(compareDataArr) ? compareDataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return isFinite(n) ? n : 0;
          }) : null;
          if (baseline === 'percent' && compareNums) {
            compareNums = compareNums.map(function(n) { return Math.max(0, Math.min(100, n)); });
          }
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
          if (baseline === 'percent') {
            yMin = 0;
            yMax = 100;
          } else if (!allZero) {
            var pad = Math.max(1e-6, span * 0.12);
            yMin = minVal - pad;
            yMax = maxVal + pad;
            // Include zero baseline for non-negative KPIs (zero) or show zero line for symmetric (returns).
            if (baseline === 'zero') {
              yMin = Math.min(yMin, 0);
              if (maxVal <= 0) yMax = 0 + pad;
            } else if (baseline === 'symmetric') {
              if (minVal < 0 && maxVal > 0) {
                var absMax = Math.max(Math.abs(minVal), Math.abs(maxVal)) + pad;
                yMin = -absMax;
                yMax = absMax;
              } else {
                yMin = Math.min(yMin, 0);
                if (maxVal <= 0) yMax = 0 + pad;
              }
            }
          }

          var hasCompare = !!(compareNums && compareNums.length >= 2);
          var series = [{ name: 'Current', data: nums }];
          var chartType = sparkMode;
          // If the spark mode is `area` and we render a compare series, force the compare to be a line
          // so it reads as a dashed reference (not a filled area).
          if (sparkMode === 'area' && hasCompare) {
            chartType = 'line';
            series[0].type = 'area';
          }
          var colors = [color];
          var strokeWidths = [sparkMode === 'bar' ? 0 : sparkStrokeWidth];
          var dashArray = [0];
          if (hasCompare) {
            var compareSeries = { name: 'Compare', data: compareNums };
            if (sparkMode === 'area') compareSeries.type = 'line';
            series.push(compareSeries);
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
            chart: { type: chartType, height: sparkHeight, sparkline: { enabled: true }, animations: { enabled: false } },
            series: series,
            stroke: { show: true, width: strokeWidths, curve: sparkCurve, lineCap: 'butt', dashArray: dashArray },
            fill: sparkMode === 'area'
              ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.26, opacityTo: 0.04, stops: [0, 100] } }
              : { type: 'solid', opacity: 1 },
            colors: colors,
            yaxis: { min: yMin, max: yMax },
            markers: { size: 0 },
            plotOptions: sparkMode === 'bar' ? { bar: { columnWidth: '55%', borderRadius: 2 } } : {},
            grid: { padding: { top: 0, right: 2, bottom: 0, left: 2 } },
            tooltip: { enabled: true },
            // ApexCharts 4.x can crash when `annotations` is explicitly set to `undefined`.
            // Always provide an annotations object with empty arrays.
            annotations: (function () {
              var a = { xaxis: [], yaxis: [], points: [], texts: [], images: [] };
              if ((baseline === 'zero' || baseline === 'symmetric') && yMin <= 0 && yMax >= 0) {
                a.yaxis.push({ y: 0, strokeDashArray: 2, borderColor: 'rgba(0,0,0,0.15)', borderWidth: 1, opacity: 0.9 });
              }
              return a;
            })()
          };
          try {
            var override = sparkCfg.advancedApexOverride;
            if (isPlainObject(override) && Object.keys(override).length) {
              apexOpts = deepMergeOptions(apexOpts, override);
            }
          } catch (_) {}
          var existing = dashSparkCharts[elId];
          if (existing && typeof existing.updateOptions === 'function' && typeof existing.updateSeries === 'function') {
            try {
              existing.updateOptions(apexOpts, false, false, false);
              existing.updateSeries(series, false);
              return;
            } catch (_) {
              try { existing.destroy(); } catch (_) {}
              try { delete dashSparkCharts[elId]; } catch (_) {}
            }
          }
          sparkEl.innerHTML = '';
          var chart = new ApexCharts(sparkEl, apexOpts);
          chart.render();
          dashSparkCharts[elId] = chart;
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
        var currentProfitTone = numFromRangeMap(kpiDataForTone, 'profit', kpiRangeForTone);
        var currentOrdersTone = numFromRangeMap(kpiDataForTone, 'convertedCount', kpiRangeForTone);
        var currentSessionsTone = sessionsFromBreakdownMap(kpiDataForTone, kpiRangeForTone);
        var currentConvTone = numFromRangeMap(kpiDataForTone, 'conversion', kpiRangeForTone);
        var currentVpvTone = numFromRangeMap(kpiDataForTone, 'vpv', kpiRangeForTone);
        var currentReturningTone = numFromRangeMap(kpiDataForTone, 'returningCustomerCount', kpiRangeForTone);
        var currentAovTone = numFromRangeMap(kpiDataForTone, 'aov', kpiRangeForTone);
        var currentBounceTone = numFromRangeMap(kpiDataForTone, 'bounce', kpiRangeForTone);
        var currentRoasTone = numFromRangeMap(kpiDataForTone, 'roas', kpiRangeForTone);
        var profitKpiAllowed = !!(kpiDataForTone && kpiDataForTone.profitKpiAllowed === true);
        var compareRevenueTone = compareTone && typeof compareTone.sales === 'number' ? compareTone.sales : null;
        var compareProfitTone = compareTone && typeof compareTone.profit === 'number' ? compareTone.profit : null;
        var compareOrdersTone = compareTone && typeof compareTone.convertedCount === 'number' ? compareTone.convertedCount : null;
        var compareSessionsTone = (compareTone && compareTone.trafficBreakdown && typeof compareTone.trafficBreakdown.human_sessions === 'number')
          ? compareTone.trafficBreakdown.human_sessions
          : null;
        var compareConvTone = compareTone && typeof compareTone.conversion === 'number' ? compareTone.conversion : null;
        var compareVpvTone = compareTone && typeof compareTone.vpv === 'number' ? compareTone.vpv : null;
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
        function formatSparklineTimeLabel(key) {
          var timePart = key.indexOf(' ') >= 0 ? shortHourLabel(key) : key;
          if (!timePart) return timePart;
          var m = /^0?(\d{1,2}):(\d{2})$/.exec(String(timePart).trim());
          if (m) return (parseInt(m[1], 10)) + ':' + m[2];
          return timePart;
        }
        function renderDashboardKpiSparkBucketLabels(series) {
          try {
            if (!Array.isArray(series) || !series.length) return;
            var labels = series.map(function(d, idx) {
              var key = d && d.date != null ? String(d.date) : '';
              if (!key) return String(idx + 1);
              if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return shortDate(key);
              if (key.indexOf(' ') >= 0) return formatSparklineTimeLabel(key);
              return key;
            });
            var maxLabels = 6;
            var visibleIndices = new Set();
            if (labels.length <= maxLabels) {
              labels.forEach(function(_, i) { visibleIndices.add(i); });
            } else {
              for (var i = 0; i < maxLabels; i++) {
                var idx = i === 0 ? 0 : i === maxLabels - 1 ? labels.length - 1 : Math.round((i / (maxLabels - 1)) * (labels.length - 1));
                visibleIndices.add(idx);
              }
            }
            function ensureRow(bodyEl) {
              if (!bodyEl || !bodyEl.querySelector) return;
              var wrap = bodyEl.querySelector('.dash-kpi-sparkline-wrap');
              if (!wrap) return;
              var row = wrap.querySelector('.dash-kpi-sparkline-labels');
              if (!row) {
                row = document.createElement('div');
                row.className = 'dash-kpi-sparkline-labels';
                wrap.appendChild(row);
              }
              row.innerHTML = labels.map(function(t, i) {
                var hidden = visibleIndices.has(i) ? '' : ' is-hidden';
                return '<span class="dash-kpi-sparkline-label' + hidden + '">' + escapeHtml(t) + '</span>';
              }).join('');
            }
            document.querySelectorAll('#dash-kpi-grid .card-body, #dash-kpi-grid-mid .card-body, #dash-kpi-grid-lower .card-body').forEach(function(bodyEl) {
              if (!bodyEl || !bodyEl.querySelector) return;
              if (!bodyEl.querySelector('.dash-kpi-sparkline-wrap')) return;
              ensureRow(bodyEl);
            });
          } catch (_) {}
        }
        var revenueHistorySpark = sparklineSeries.map(function(d) { return d.revenue; });
        var sessionsHistorySpark = sparklineSeries.map(function(d) { return d.sessions; });
        var ordersHistorySpark = sparklineSeries.map(function(d) { return d.orders; });
        var returningHistorySpark = sparklineSeries.map(function(d) { return d.returningCustomerOrders || 0; });
        var convHistorySpark = sparklineSeries.map(function(d) { return d.convRate; });
        var vpvHistorySpark = sparklineSeries.map(function(d) {
          var r = d && typeof d.revenue === 'number' ? d.revenue : null;
          var s = d && typeof d.sessions === 'number' ? d.sessions : null;
          return (s != null && s > 0 && r != null) ? (r / s) : null;
        });
        var aovHistorySpark = sparklineSeries.map(function(d) { return d.aov; });
        var bounceHistorySpark = sparklineSeries.map(function(d) { return d.bounceRate; });
        var itemsHistorySpark = sparklineSeries.map(function(d) { return d.units || 0; });
        var roasHistorySpark = sparklineSeries.map(function(d) {
          var spend = d && typeof d.adSpend === 'number' ? d.adSpend : 0;
          var rev = d && typeof d.revenue === 'number' ? d.revenue : 0;
          return (spend > 0) ? (rev / spend) : 0;
        });
        var profitHistorySpark = (profitKpiAllowed && kpiDataForTone && Array.isArray(kpiDataForTone.profitSparkline))
          ? kpiDataForTone.profitSparkline
          : null;
        var revenueSpark = sparkSeriesFromCompare(currentRevenueTone, compareRevenueTone, revenueHistorySpark);
        var sessionsSpark = sparkSeriesFromCompare(currentSessionsTone, compareSessionsTone, sessionsHistorySpark);
        var ordersSpark = sparkSeriesFromCompare(currentOrdersTone, compareOrdersTone, ordersHistorySpark);
        var returningSpark = sparkSeriesFromCompare(currentReturningTone, compareReturningTone, returningHistorySpark);
        var convSpark = sparkSeriesFromCompare(currentConvTone, compareConvTone, convHistorySpark);
        var vpvSpark = sparkSeriesFromCompare(currentVpvTone, compareVpvTone, vpvHistorySpark);
        var aovSpark = sparkSeriesFromCompare(currentAovTone, compareAovTone, aovHistorySpark);
        var bounceSpark = sparkSeriesFromCompare(currentBounceTone, compareBounceTone, bounceHistorySpark);
        var itemsSpark = sparkSeriesFromCompare(currentItemsTone, compareItemsTone, itemsHistorySpark);
        var roasSpark = sparkSeriesFromCompare(currentRoasTone, compareRoasTone, roasHistorySpark);
        var profitSpark = profitKpiAllowed ? sparkSeriesFromCompare(currentProfitTone, compareProfitTone, profitHistorySpark) : [];
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
        if (profitSpark && profitSpark.length >= 2 && profitSpark.length !== primaryLen) {
          var alignedProfitSpark = alignCompareToPrimary(profitSpark, primaryLen);
          if (alignedProfitSpark) profitSpark = alignedProfitSpark;
        }
        ensureDashboardCompareSeries(getKpiData()).then(function(compareSeries) {
          var cmp = compareSeries;
          var revenueSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.revenue || 0; });
          var sessionsSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.sessions || 0; });
          var ordersSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.orders || 0; });
          var returningSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.returningCustomerOrders || 0; });
          var convSparkCompare = compareFromCache(cmp, primaryLen, function(d) { return d.convRate != null ? d.convRate : 0; });
          var vpvSparkCompare = compareFromCache(cmp, primaryLen, function(d) {
            var r = d && typeof d.revenue === 'number' ? d.revenue : null;
            var s = d && typeof d.sessions === 'number' ? d.sessions : null;
            return (s != null && s > 0 && r != null) ? (r / s) : 0;
          });
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
          var profitSparkCompare = null;
          try {
            var profitCmpRaw = (profitKpiAllowed && kpiDataForTone && Array.isArray(kpiDataForTone.profitSparklineCompare))
              ? kpiDataForTone.profitSparklineCompare
              : null;
            profitSparkCompare = profitCmpRaw ? alignCompareToPrimary(profitCmpRaw, primaryLen) : null;
          } catch (_) { profitSparkCompare = null; }
          renderSparkline('dash-revenue-sparkline', revenueSpark, sparkToneFromCompare(currentRevenueTone, compareRevenueTone, false, revenueSpark), revenueSparkCompare, 'zero');
          renderSparkline('dash-sessions-sparkline', sessionsSpark, sparkToneFromCompare(currentSessionsTone, compareSessionsTone, false, sessionsSpark), sessionsSparkCompare, 'zero');
          renderSparkline('dash-orders-sparkline', ordersSpark, sparkToneFromCompare(currentOrdersTone, compareOrdersTone, false, ordersSpark), ordersSparkCompare, 'zero');
          renderSparkline('dash-returning-sparkline', returningSpark, sparkToneFromCompare(currentReturningTone, compareReturningTone, false, returningSpark), returningSparkCompare, 'zero');
          renderSparkline('dash-conv-sparkline', convSpark, sparkToneFromCompare(currentConvTone, compareConvTone, false, convSpark), convSparkCompare, 'percent');
          renderSparkline('dash-vpv-sparkline', vpvSpark, sparkToneFromCompare(currentVpvTone, compareVpvTone, false, vpvSpark), vpvSparkCompare, 'zero');
          renderSparkline('dash-aov-sparkline', aovSpark, sparkToneFromCompare(currentAovTone, compareAovTone, false, aovSpark), aovSparkCompare, 'zero');
          renderSparkline('dash-bounce-sparkline', bounceSpark, sparkToneFromCompare(currentBounceTone, compareBounceTone, true, bounceSpark), bounceSparkCompare, 'percent');
          renderSparkline('dash-roas-sparkline', roasSpark, sparkToneFromCompare(currentRoasTone, compareRoasTone, false, roasSpark), roasSparkCompare, 'zero');
          if (profitKpiAllowed && profitSpark && profitSpark.length) {
            renderSparkline('dash-profit-sparkline', profitSpark, sparkToneFromCompare(currentProfitTone, compareProfitTone, false, profitSpark), profitSparkCompare, 'symmetric');
          } else {
            var ps = el('dash-profit-sparkline');
            if (ps) ps.innerHTML = '';
          }
          renderSparkline('dash-items-sparkline', itemsSpark, DASHBOARD_NEUTRAL_TONE_HEX, itemsSparkCompare, 'zero');
          renderDashboardKpiSparkBucketLabels(sparklineSeries);
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

            if (cogsArr && cogsArr.length) renderSparkline('dash-cogs-sparkline', cogsArr, DASHBOARD_NEUTRAL_TONE_HEX, cogsCmpArr, 'zero');
            else { var cs = el('dash-cogs-sparkline'); if (cs) cs.innerHTML = ''; }

            if (fulfilledArr && fulfilledArr.length) renderSparkline('dash-fulfilled-sparkline', fulfilledArr, DASHBOARD_NEUTRAL_TONE_HEX, fulfilledCmpArr, 'zero');
            else { var fs = el('dash-fulfilled-sparkline'); if (fs) fs.innerHTML = ''; }

            if (returnsArr && returnsArr.length) renderSparkline('dash-returns-sparkline', returnsArr, DASHBOARD_NEUTRAL_TONE_HEX, returnsCmpArr, 'symmetric');
            else { var rs = el('dash-returns-sparkline'); if (rs) rs.innerHTML = ''; }
          } catch (_) {}
          try { if (typeof renderCondensedSparklines === 'function') renderCondensedSparklines(sparklineSeries); } catch (_) {}
        });

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
            prodTbody.innerHTML = '<tr><td colspan="5" class="dash-empty">No data</td></tr>';
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
              var vpvVal = (p && typeof p.vpv === 'number' && isFinite(p.vpv)) ? p.vpv : null;
              var vpvHtml = vpvVal != null ? fmtGbp(vpvVal) : '\u2014';
              return '<tr><td><span class="product-cell">' + titleHtml + '</span></td><td class="text-end">' + fmtGbp(p.revenue) + '</td><td class="text-end">' + p.orders + '</td><td class="text-end kexo-nowrap">' + crHtml + '</td><td class="text-end kexo-nowrap">' + vpvHtml + '</td></tr>';
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
            countryTbody.innerHTML = '<tr><td colspan="5" class="dash-empty">No data</td></tr>';
          } else {
            countryTbody.innerHTML = countriesPageRows.map(function(c) {
              var cc = ((c && (c.country_code || c.country)) || 'XX').toUpperCase();
              if (cc === 'UK') cc = 'GB';
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
              var vpvVal = (c && typeof c.vpv === 'number' && isFinite(c.vpv)) ? c.vpv : null;
              var vpvHtml = vpvVal != null ? fmtGbp(vpvVal) : '\u2014';
              return '<tr><td><span style="display:inline-flex;align-items:center;gap:0.5rem">' + flagImg(cc, name) + ' ' + escapeHtml(name) + '</span></td><td class="text-end">' + fmtGbp(c.revenue) + '</td><td class="text-end">' + c.orders + '</td><td class="text-end kexo-nowrap">' + crHtml + '</td><td class="text-end kexo-nowrap">' + vpvHtml + '</td></tr>';
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
            tbody.innerHTML = '<tr><td colspan="5" class="dash-empty">No data</td></tr>';
            return;
          }
          function fmtSignedGbp(v) {
            var d = normalizeZeroNumber(v, 0.005);
            if (d == null) d = 0;
            var abs = Math.abs(d);
            var s = fmtGbp(abs);
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
            var vpvVal = (p && typeof p.vpv === 'number' && isFinite(p.vpv)) ? p.vpv : null;
            var vpvCell = vpvVal != null ? fmtGbp(vpvVal) : '\u2014';
            return '<tr><td><span class="product-cell">' + titleHtml + '</span></td><td class="text-end">' + revCell + '</td><td class="text-end">' + ordCell + '</td><td class="text-end kexo-nowrap">' + crCell + '</td><td class="text-end kexo-nowrap">' + vpvCell + '</td></tr>';
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
        return true;
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
        n = Math.max(0, Math.min(100, n));
        var rounded = Math.round(n * 10) / 10;
        if (rounded >= 100) return '100';
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

      var KEXO_RING_COLOR_ORDER = [
          'var(--kexo-accent-5, #ef4444)',
          'var(--kexo-accent-4, #8b5cf6)',
          'var(--kexo-accent-3, #f59e34)',
          'var(--kexo-accent-1, #4b94e4)',
          'var(--kexo-accent-2, #3eb3ab)'
        ];
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
        var fullRed = score === 0;
        var fullGreen = score === 100;
        for (var i = 0; i < 5; i += 1) {
          var segStart = KEXO_RING_START_OFFSET + i * KEXO_RING_SEGMENT_AND_GAP;
          // Fill length advances across segments only (gaps are always unfilled).
          var fillStart = i * KEXO_RING_SEGMENT;
          var filled = fullRed ? KEXO_RING_SEGMENT : (fullGreen ? KEXO_RING_SEGMENT : Math.max(0, Math.min(KEXO_RING_SEGMENT, totalFill - fillStart)));
          var fillCircle = svg.querySelector('.kexo-score-ring-fill--' + (i + 1));
          if (fillCircle) {
            // IMPORTANT: keep dasharray sum bounded to circumference so large dashoffsets
            // don't land in an effectively infinite gap (which can hide segments).
            var gap = Math.max(0, KEXO_RING_CIRCUMFERENCE - filled);
            fillCircle.setAttribute('stroke-dasharray', filled.toFixed(2) + ' ' + gap.toFixed(2));
            fillCircle.setAttribute('stroke-dashoffset', (-segStart).toFixed(2));
            if (fullRed) fillCircle.style.stroke = 'var(--kexo-accent-5, #ef4444)';
            else if (fullGreen) fillCircle.style.stroke = 'var(--kexo-accent-2, #3eb3ab)';
            else fillCircle.style.stroke = KEXO_RING_COLOR_ORDER[i];
          }
        }
      }

      function buildHeaderKexoScoreRingBg(rawScore) {
        var score = Number(rawScore);
        if (!Number.isFinite(score)) score = 0;
        score = Math.max(0, Math.min(100, score));

        if (score === 0) return 'conic-gradient(from -90deg, var(--kexo-accent-5, #ef4444) 0deg 360deg)';
        if (score === 100) return 'conic-gradient(from -90deg, var(--kexo-accent-2, #3eb3ab) 0deg 360deg)';

        var colors = [
          'var(--kexo-accent-5, #ef4444)',
          'var(--kexo-accent-4, #8b5cf6)',
          'var(--kexo-accent-3, #f59e34)',
          'var(--kexo-accent-1, #4b94e4)',
          'var(--kexo-accent-2, #3eb3ab)'
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
        if (dashNum) {
          if (empty) dashNum.innerHTML = '<span class="kpi-mini-spinner" aria-hidden="true"></span>';
          else dashNum.textContent = dashText;
        }
        if (dashRing) {
          dashRing.style.setProperty('--kexo-score-pct', pct);
          dashRing.setAttribute('data-score', pct);
        }
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
        var precise = empty ? '\u2014' : formatKexoScoreNumber(score);
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
        try {
          Array.from(scope.querySelectorAll('.popover')).forEach(function(p) { try { p.remove(); } catch (_) {} });
        } catch (_) {}
      }

      function initKexoScorePopovers(scope) {
        if (!scope || !scope.querySelectorAll) return;
        var Popover = window.bootstrap && window.bootstrap.Popover;
        if (!Popover) return;
        var nodes = Array.from(scope.querySelectorAll('[data-kexo-score-popover="1"]'));
        nodes.forEach(function(node) {
          try {
            // If Bootstrap auto-initialized this node from data-bs-toggle before our code runs,
            // reconfigure once so we always have a header (title) and a scoped container.
            if (node.getAttribute('data-kexo-score-popover-configured') !== '1') {
              try {
                var existing = Popover.getInstance(node);
                if (existing) existing.dispose();
              } catch (_) {}
            }
            var popover = Popover.getOrCreateInstance(node, {
              trigger: node.getAttribute('data-bs-trigger') || 'click',
              placement: node.getAttribute('data-bs-placement') || 'bottom',
              html: false,
              container: scope,
              customClass: 'kexo-score-popover',
              title: 'Kexo Score',
            });
            if (node.getAttribute('data-kexo-score-popover-configured') !== '1') {
              node.setAttribute('data-kexo-score-popover-configured', '1');
            }
            if (node.getAttribute('data-kexo-score-popover-bound') !== '1') {
              node.setAttribute('data-kexo-score-popover-bound', '1');
              node.addEventListener('shown.bs.popover', function onShown() {
                var tip = popover && typeof popover.getTipElement === 'function'
                  ? popover.getTipElement()
                  : (node.getAttribute('aria-describedby') ? document.getElementById(node.getAttribute('aria-describedby')) : scope.querySelector('.popover.show'));
                if (!tip || !tip.querySelector || tip.querySelector('.kexo-score-popover-close')) return;
                var header = tip.querySelector('.popover-header');
                if (!header) return;
                var closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.className = 'btn-close btn-close-sm kexo-score-popover-close position-absolute top-0 end-0 m-2';
                closeBtn.setAttribute('aria-label', 'Close');
                header.appendChild(closeBtn);
              });
            }
          } catch (_) {}
        });
        if (scope.getAttribute('data-kexo-score-popover-scope-bound') !== '1') {
          scope.setAttribute('data-kexo-score-popover-scope-bound', '1');
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
        body.innerHTML =
          '<div id="kexo-score-summary-section" class="kexo-score-summary-card mb-3 is-hidden" role="region" aria-label="Kexo Score summary">' +
            '<div class="kexo-score-summary-card-header d-flex align-items-center justify-content-between mb-2">' +
              '<span class="fw-medium">Summary</span>' +
              '<button type="button" class="btn btn-icon btn-ghost-secondary kexo-score-summary-close" aria-label="Close summary"><i class="fa-light fa-xmark" aria-hidden="true"></i></button>' +
            '</div>' +
            '<div id="kexo-score-summary-wrap">' + summaryHtml + '</div>' +
          '</div>' +
          '<div id="kexo-score-breakdown">' + breakdownHtml + '</div>';
        (function initSummaryCloseAndReset() {
          var section = document.getElementById('kexo-score-summary-section');
          var closeBtn = section && section.querySelector('.kexo-score-summary-close');
          var showBtn = document.getElementById('kexo-score-show-summary-btn');
          if (closeBtn && section) {
            closeBtn.addEventListener('click', function() {
              section.classList.add('is-hidden');
              if (showBtn) showBtn.classList.remove('is-hidden');
            });
          }
          if (showBtn) showBtn.classList.remove('is-hidden');
        })();
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
        disposeKexoScorePopovers(document);
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
        var showSummaryBtn = document.getElementById('kexo-score-show-summary-btn');
        if (showSummaryBtn) {
          showSummaryBtn.addEventListener('click', function() {
            var section = document.getElementById('kexo-score-summary-section');
            if (section) { section.classList.remove('is-hidden'); showSummaryBtn.classList.add('is-hidden'); }
          });
        }
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
        var _dbgOn = false;
        var _dbgT0 = 0;
        var _dbgCall = 0;
        try {
          _dbgOn = !!(window && typeof window.__kexoPerfDebugEnabled === 'function' && window.__kexoPerfDebugEnabled());
          _dbgT0 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now();
          __kexoPerfDashboardFetchCalls += 1;
          _dbgCall = __kexoPerfDashboardFetchCalls;
        } catch (_) { _dbgOn = false; _dbgT0 = Date.now(); _dbgCall = 0; }
        dashLoading = true;
        var silent = !!(opts && opts.silent);
        var build = silent ? { step: function() {}, finish: function() {} } : startReportBuild({
          key: 'dashboard',
          title: 'Preparing dashboard overview',
          initialStep: 'Loading dashboard data',
        });
        var url = API + '/api/dashboard-series?range=' + encodeURIComponent(rangeKey) + (force ? ('&force=1&_=' + Date.now()) : '');
        var forceMini = !!force;
        if (silent && forceMini) {
          var miniAgeMs = overviewMiniFetchedAt ? (Date.now() - overviewMiniFetchedAt) : Number.POSITIVE_INFINITY;
          forceMini = miniAgeMs > OVERVIEW_MINI_FORCE_REFRESH_MS;
        }
        fetchKexoScore(rangeKey);
        fetchOverviewMiniData({ force: forceMini });
        fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .then(function(data) {
            dashLoading = false;
            if (data) {
              var nextSig = dashboardPayloadSignature(data, rangeKey);
              var shouldRender = !!force || !(dashPayloadSignature && nextSig && nextSig === dashPayloadSignature);
              dashCache = data;
              dashLastRangeKey = rangeKey;
              dashPayloadSignature = nextSig;
              if (shouldRender || (opts && opts.rerender)) {
                build.step('Rendering dashboard panels');
                renderDashboard(data);
              }
            }
            // #region agent log
            if (_dbgOn) {
              var _t1 = 0;
              try { _t1 = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch (_) { _t1 = Date.now(); }
              var _ms = Math.max(0, Math.round(_t1 - (_dbgT0 || 0)));
              var _charts = 0;
              try { _charts = dashCharts ? Object.keys(dashCharts).filter(function(k){return !!dashCharts[k];}).length : 0; } catch (_) { _charts = 0; }
              fetch('http://127.0.0.1:7242/ingest/a370db6d-7333-4112-99f8-dd4bc899a89b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'14-dashboard.js:fetchDashboardData',message:'dashboard series fetched',data:{call:_dbgCall,range:rangeKey,force:!!force,silent:!!silent,ms_total:_ms,ok:!!data,charts_live:_charts},timestamp:Date.now(),runId:(typeof window.__kexoPerfDebugRunId==='function'?window.__kexoPerfDebugRunId():'baseline'),hypothesisId:'H4'} )}).catch(()=>{});
            }
            // #endregion
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
        var rerender = !!(opts && opts.rerender);
        var rk = dashRangeKeyFromDateRange();
        try {
          var curYmd = (typeof ymdNowInTz === 'function') ? ymdNowInTz() : null;
          if (curYmd && dashLastDayYmd && dashLastDayYmd !== curYmd) {
            dashCache = null;
            dashLastRangeKey = null;
            dashPayloadSignature = '';
            force = true;
          }
          if (curYmd) dashLastDayYmd = curYmd;
        } catch (_) {}
        if (!force && dashCache && dashLastRangeKey === rk) {
          if (rerender) renderDashboard(dashCache);
          fetchOverviewMiniData({ force: false, renderIfFresh: !overviewMiniPayloadSignature });
          return;
        }
        fetchDashboardData(rk, force, { silent: silent, rerender: rerender });
      };

      function createDashboardController() {
        var pollTimer = null;
        var visibilityBound = false;
        var pageShowBound = false;
        var lastResumeAt = 0;
        var POLL_MS = 120000;
        function isDashboardActive() {
          try {
            var p = document.getElementById('tab-panel-dashboard');
            if (!p) return PAGE === 'dashboard';
            return p.classList.contains('active') || PAGE === 'dashboard';
          } catch (_) {
            return PAGE === 'dashboard';
          }
        }
        function isVisible() {
          try {
            return !document || !document.visibilityState || document.visibilityState === 'visible';
          } catch (_) {
            return true;
          }
        }
        function isDynamicRange() {
          var rk = dashRangeKeyFromDateRange();
          return rk === 'today' || rk === '1h';
        }
        function stopPolling() {
          if (pollTimer) {
            try { clearInterval(pollTimer); } catch (_) {}
            pollTimer = null;
          }
        }
        function pollTick() {
          if (!isVisible()) return;
          if (!isDashboardActive()) return;
          if (!isDynamicRange()) return;
          if (dashLoading) return;
          try { if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true }); } catch (_) {}
        }
        function startPolling() {
          stopPolling();
          if (!isVisible()) return;
          pollTimer = setInterval(pollTick, POLL_MS);
        }
        function refreshOnceAndResume(reason) {
          var now = Date.now();
          if (now - lastResumeAt < 1000) return;
          lastResumeAt = now;
          try { if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true, reason: reason || 'resume' }); } catch (_) {}
          startPolling();
        }
        function onVisibilityChange() {
          if (!isVisible()) {
            stopPolling();
            return;
          }
          refreshOnceAndResume('visibility');
        }
        function onPageShow(ev) {
          if (ev && ev.persisted) refreshOnceAndResume('pageshow');
        }
        function init() {
          startPolling();
          if (!visibilityBound) {
            document.addEventListener('visibilitychange', onVisibilityChange);
            visibilityBound = true;
          }
          if (!pageShowBound) {
            window.addEventListener('pageshow', onPageShow);
            pageShowBound = true;
          }
        }
        function destroy() {
          stopPolling();
          if (visibilityBound) {
            try { document.removeEventListener('visibilitychange', onVisibilityChange); } catch (_) {}
            visibilityBound = false;
          }
          if (pageShowBound) {
            try { window.removeEventListener('pageshow', onPageShow); } catch (_) {}
            pageShowBound = false;
          }
        }
        return {
          init: init,
          destroy: destroy,
          startPolling: startPolling,
          stopPolling: stopPolling,
          onVisibleResume: refreshOnceAndResume,
          pollNow: pollTick
        };
      }

      window.refreshKexoScore = function() {
        return fetchKexoScore(dashRangeKeyFromDateRange());
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
      try {
        if (window.dashboardController && typeof window.dashboardController.destroy === 'function') {
          window.dashboardController.destroy();
        }
      } catch (_) {}
      dashController = createDashboardController();
      try { window.dashboardController = dashController; } catch (_) {}
      try { dashController.init(); } catch (_) {}

      // When Profit Rules are saved via the dashboard Cost Settings modal,
      // refresh the 7d overview snapshot payload (cost/revenue series depend on profit rule fingerprint).
      try {
        window.addEventListener('kexo:profitRulesUpdated', function () {
          try { fetchOverviewMiniData({ force: true }); } catch (_) {}
        });
      } catch (_) {}

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

      registerCleanup(function() {
        try {
          if (dashController && typeof dashController.destroy === 'function') dashController.destroy();
        } catch (_) {}
      });
    })();

    // ?????? User avatar: fetch /api/me and populate ????????????????????????????????????????????????????????????????????????
    (function initUserAvatar() {
      try {
