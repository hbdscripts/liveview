/**
 * Layout shortcut modals — open table or chart settings in a modal from card header gear.
 * Saves via POST /api/settings; updates localStorage and dispatches kexo:tablesUiConfigUpdated / kexo:chartsUiConfigUpdated.
 */
(function () {
  'use strict';

  var TABLES_LS_KEY = 'kexo:tables-ui-config:v1';
  var CHARTS_LS_KEY = 'kexo:charts-ui-config:v1';
  var MODAL_ID = 'kexo-layout-shortcut-modal';

  function escapeHtml(str) {
    if (str == null) return '';
    try {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    } catch (_) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  }

  function parseRowOptionsText(raw) {
    var text = raw == null ? '' : String(raw);
    var parts = text.split(/[^0-9]+/g);
    var out = [];
    var seen = {};
    parts.forEach(function (p) {
      if (!p) return;
      var n = parseInt(p, 10);
      if (!Number.isFinite(n) || n <= 0 || n > 200) return;
      if (seen[n]) return;
      seen[n] = true;
      out.push(n);
    });
    out.sort(function (a, b) { return a - b; });
    return out.slice(0, 12);
  }

  function formatRowOptionsText(list) {
    return (Array.isArray(list) ? list : []).map(function (n) { return String(n); }).join(', ');
  }

  function getChartMeta(key) {
    return (typeof window.kexoChartMeta === 'function' ? window.kexoChartMeta(key) : null) || { modes: ['line', 'area'], series: [] };
  }

  function defaultChartStyleConfig() {
    return {
      curve: 'smooth',
      strokeWidth: 2.6,
      dashArray: 0,
      markerSize: 3,
      fillOpacity: 0.18,
      gridDash: 3,
      dataLabels: 'auto',
      toolbar: false,
      animations: true,
      pieDonut: false,
      pieDonutSize: 64,
      pieLabelPosition: 'auto',
      pieLabelContent: 'percent',
      pieLabelOffset: 0,
      pieCountryFlags: false,
      kexoRenderer: 'pie',
    };
  }

  function safeNumber(v, def, min, max) {
    var n = Number(v);
    if (!Number.isFinite(n)) n = Number(def);
    if (!Number.isFinite(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
  }

  function normalizeHexColor(value, fallback) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(raw) ? raw : fallback;
  }

  function prettyJson(value) {
    try {
      var obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
      return JSON.stringify(obj, null, 2) || '{}';
    } catch (_) { return '{}'; }
  }

  function selectOptionsHtml(modes, selected) {
    var sel = String(selected || '').trim().toLowerCase();
    var opts = Array.isArray(modes) ? modes : [];
    var CHART_MODE_LABEL = (typeof window.KEXO_CHART_MODE_LABEL === 'object' && window.KEXO_CHART_MODE_LABEL) || {};
    return opts.map(function (m) {
      var val = String(m || '').trim().toLowerCase();
      if (!val) return '';
      var label = CHART_MODE_LABEL[val] || val;
      return '<option value="' + escapeHtml(val) + '"' + (val === sel ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');
  }

  function defaultSingleTableRow(pageKey, tableId) {
    return {
      id: tableId,
      name: tableId,
      order: 1,
      tableClass: '',
      zone: '',
      inGrid: true,
      rows: { default: 20, options: [20, 30, 40, 50] },
      sticky: { minWidth: null, maxWidth: null },
    };
  }

  function renderTableModalBody(t) {
    var name = t.name != null ? String(t.name) : (t.id || '');
    var rowOptions = t.rows && Array.isArray(t.rows.options) ? t.rows.options : [20, 30, 40, 50];
    var defaultRows = t.rows && typeof t.rows.default === 'number' ? t.rows.default : (rowOptions[0] || 20);
    if (rowOptions.indexOf(defaultRows) < 0 && rowOptions.length) defaultRows = rowOptions[0];
    var stickyMin = t.sticky && typeof t.sticky.minWidth === 'number' ? t.sticky.minWidth : null;
    var stickyMax = t.sticky && typeof t.sticky.maxWidth === 'number' ? t.sticky.maxWidth : null;
    var inGrid = t.inGrid !== false;
    var defaultOptsHtml = (rowOptions.length ? rowOptions : [defaultRows]).map(function (n) {
      return '<option value="' + String(n) + '"' + (Number(n) === Number(defaultRows) ? ' selected' : '') + '>' + String(n) + '</option>';
    }).join('');
    return (
      '<div class="row g-3">' +
        '<div class="col-12">' +
          '<label class="form-label mb-1">Display name</label>' +
          '<input type="text" class="form-control form-control-sm" data-field="name" value="' + escapeHtml(name) + '">' +
        '</div>' +
        '<div class="col-12 col-md-6">' +
          '<label class="form-label mb-1">Rows options</label>' +
          '<input type="text" class="form-control form-control-sm" data-field="rows-options" value="' + escapeHtml(formatRowOptionsText(rowOptions)) + '" placeholder="e.g. 5, 10, 15, 20">' +
          '<div class="text-muted small mt-1">Comma-separated values.</div>' +
        '</div>' +
        '<div class="col-12 col-md-6">' +
          '<label class="form-label mb-1">Default rows</label>' +
          '<select class="form-select form-select-sm" data-field="rows-default">' + defaultOptsHtml + '</select>' +
        '</div>' +
        '<div class="col-12 col-md-6">' +
          '<label class="form-label mb-1">Sticky min width (px)</label>' +
          '<input type="number" class="form-control form-control-sm" data-field="sticky-min" placeholder="auto" value="' + (stickyMin == null ? '' : escapeHtml(String(stickyMin))) + '">' +
        '</div>' +
        '<div class="col-12 col-md-6">' +
          '<label class="form-label mb-1">Sticky max width (px)</label>' +
          '<input type="number" class="form-control form-control-sm" data-field="sticky-max" placeholder="auto" value="' + (stickyMax == null ? '' : escapeHtml(String(stickyMax))) + '">' +
        '</div>' +
        '<div class="col-12">' +
          '<label class="form-check form-switch m-0">' +
            '<input class="form-check-input" type="checkbox" data-field="inGrid"' + (inGrid ? ' checked' : '') + '>' +
            '<span class="form-check-label small ms-2">Keep in grid layout</span>' +
          '</label>' +
        '</div>' +
      '</div>'
    );
  }

  function readTableModalBody(container) {
    if (!container || !container.querySelector) return null;
    var nameEl = container.querySelector('input[data-field="name"]');
    var optionsEl = container.querySelector('input[data-field="rows-options"]');
    var defaultEl = container.querySelector('select[data-field="rows-default"]');
    var stickyMinEl = container.querySelector('input[data-field="sticky-min"]');
    var stickyMaxEl = container.querySelector('input[data-field="sticky-max"]');
    var inGridEl = container.querySelector('input[data-field="inGrid"]');
    var options = parseRowOptionsText(optionsEl ? optionsEl.value : '');
    if (!options.length) options = [20];
    var defaultRows = parseInt(String(defaultEl && defaultEl.value != null ? defaultEl.value : ''), 10);
    if (!Number.isFinite(defaultRows) && options.length) defaultRows = options[0];
    function parseSticky(inp) {
      if (!inp) return null;
      var raw = String(inp.value || '').trim();
      if (!raw) return null;
      var n = parseInt(raw, 10);
      return Number.isFinite(n) ? n : null;
    }
    return {
      name: nameEl && nameEl.value != null ? String(nameEl.value).trim() : '',
      rows: { default: Number.isFinite(defaultRows) ? defaultRows : options[0], options: options },
      sticky: { minWidth: parseSticky(stickyMinEl), maxWidth: parseSticky(stickyMaxEl) },
      inGrid: !!(inGridEl && inGridEl.checked),
    };
  }

  function updateTableDefaultRowsSelect(container) {
    if (!container || !container.querySelector) return;
    var optionsInput = container.querySelector('input[data-field="rows-options"]');
    var defaultSel = container.querySelector('select[data-field="rows-default"]');
    if (!optionsInput || !defaultSel) return;
    var options = parseRowOptionsText(optionsInput.value);
    if (!options.length) options = [20];
    var cur = parseInt(String(defaultSel.value || ''), 10);
    if (!Number.isFinite(cur) || options.indexOf(cur) < 0) cur = options[0];
    defaultSel.innerHTML = options.map(function (n) {
      return '<option value="' + String(n) + '"' + (n === cur ? ' selected' : '') + '>' + String(n) + '</option>';
    }).join('');
  }

  function chartColorCount(meta, item) {
    var slots = meta && typeof meta.colorSlots === 'number' && meta.colorSlots > 0 ? meta.colorSlots : null;
    if (slots != null) return Math.max(1, Math.min(6, Math.round(slots)));
    var seriesLen = meta && Array.isArray(meta.series) ? meta.series.length : 0;
    var colorLen = item && Array.isArray(item.colors) ? item.colors.length : 0;
    return Math.max(1, Math.min(6, Math.max(seriesLen, colorLen, 1)));
  }

  function renderChartColorInputs(item, meta) {
    var colors = Array.isArray(item && item.colors) ? item.colors : [];
    var series = meta && Array.isArray(meta.series) ? meta.series : [];
    var count = chartColorCount(meta, item);
    var html = '<div class="settings-charts-color-grid">';
    for (var i = 0; i < count; i += 1) {
      var label = series[i] ? String(series[i]) : ('Series ' + (i + 1));
      var val = normalizeHexColor(colors[i], '#3eb3ab');
      html += '<label class="settings-charts-color-field"><span class="form-label mb-1">' + escapeHtml(label) + '</span><div class="settings-charts-color-field-row"><input type="text" class="form-control form-control-sm" data-chart-field="color" data-idx="' + i + '" value="' + escapeHtml(val) + '" placeholder="#3eb3ab"></div><span class="settings-charts-color-swatch" data-color-swatch style="background:' + escapeHtml(val) + ';" title="' + escapeHtml(val) + '" aria-hidden="true"></span></label>';
    }
    html += '</div>';
    return html;
  }

  function normalizeChartStyleDraft(src, def) {
    def = def || defaultChartStyleConfig();
    var s = src && typeof src === 'object' ? src : {};
    return {
      curve: ['smooth', 'straight', 'stepline'].indexOf(String(s.curve || def.curve).toLowerCase()) >= 0 ? String(s.curve || def.curve).toLowerCase() : def.curve,
      strokeWidth: safeNumber(s.strokeWidth, def.strokeWidth, 0, 8),
      dashArray: safeNumber(s.dashArray, def.dashArray, 0, 20),
      markerSize: safeNumber(s.markerSize, def.markerSize, 0, 12),
      fillOpacity: safeNumber(s.fillOpacity, def.fillOpacity, 0, 1),
      gridDash: safeNumber(s.gridDash, def.gridDash, 0, 16),
      dataLabels: ['auto', 'on', 'off'].indexOf(String(s.dataLabels || def.dataLabels).toLowerCase()) >= 0 ? String(s.dataLabels || def.dataLabels).toLowerCase() : def.dataLabels,
      toolbar: !!s.toolbar,
      animations: s.animations !== false,
      pieDonut: !!s.pieDonut,
      pieDonutSize: safeNumber(s.pieDonutSize, def.pieDonutSize, 30, 90),
      pieLabelPosition: ['auto', 'inside', 'outside'].indexOf(String(s.pieLabelPosition || def.pieLabelPosition).toLowerCase()) >= 0 ? String(s.pieLabelPosition || def.pieLabelPosition).toLowerCase() : def.pieLabelPosition,
      pieLabelContent: ['percent', 'label', 'label_percent'].indexOf(String(s.pieLabelContent || def.pieLabelContent).toLowerCase()) >= 0 ? String(s.pieLabelContent || def.pieLabelContent).toLowerCase() : def.pieLabelContent,
      pieLabelOffset: safeNumber(s.pieLabelOffset, def.pieLabelOffset, -40, 40),
      pieCountryFlags: !!s.pieCountryFlags,
      kexoRenderer: (s.kexoRenderer === 'wheel' || s.kexoRenderer === 'pie') ? s.kexoRenderer : (def.kexoRenderer || 'pie'),
    };
  }

  function defaultSingleChart(key) {
    var meta = getChartMeta(key);
    var modes = meta && Array.isArray(meta.modes) ? meta.modes : ['line'];
    var defaultMode = (meta && meta.defaultMode) ? String(meta.defaultMode).toLowerCase() : (modes[0] || 'line');
    if (modes.indexOf(defaultMode) < 0) defaultMode = modes[0] || 'line';
    return {
      key: key,
      enabled: true,
      label: key,
      mode: defaultMode,
      colors: ['#3eb3ab', '#4b94e4', '#f59e34', '#8b5cf6', '#ef4444', '#22c55e'].slice(0, Math.max(1, (meta && meta.series) ? meta.series.length : 1)),
      style: defaultChartStyleConfig(),
      advancedApexOverride: {},
      pieMetric: 'sessions',
    };
  }

  function renderChartModalBody(item, chartKey) {
    var meta = getChartMeta(chartKey);
    var modes = meta && Array.isArray(meta.modes) ? meta.modes : ['line'];
    var title = item && item.label ? String(item.label) : chartKey;
    var mode = item && item.mode ? String(item.mode).trim().toLowerCase() : (modes[0] || 'line');
    if (modes.indexOf(mode) < 0) mode = modes[0] || 'line';
    var enabled = !(item && item.enabled === false);
    var pieMetric = item && item.pieMetric ? String(item.pieMetric).trim().toLowerCase() : 'sessions';
    var canPie = !!(meta && meta.pieMetric);
    var supportsPie = modes.indexOf('pie') >= 0 || mode === 'pie';
    var isCountriesOverview = chartKey === 'dash-chart-countries-30d';
    var isKexoOverview = chartKey === 'dash-chart-kexo-score-today';
    var style = normalizeChartStyleDraft(item && item.style, defaultChartStyleConfig());
    return (
      '<div class="row g-3">' +
        '<div class="col-12 col-lg-4"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="enabled"' + (enabled ? ' checked' : '') + '><span class="form-check-label ms-2">Enabled</span></label></div>' +
        '<div class="col-12 col-lg-8"><label class="form-label mb-1">Display name</label><input type="text" class="form-control form-control-sm" data-chart-field="label" value="' + escapeHtml(title) + '"></div>' +
        '<div class="col-12 col-md-6"><label class="form-label mb-1">Chart type</label><select class="form-select form-select-sm" data-chart-field="mode">' + selectOptionsHtml(modes, mode) + '</select></div>' +
        '<div class="col-12 col-md-6"><label class="form-label mb-1">Pie metric</label><select class="form-select form-select-sm" data-chart-field="pieMetric"' + (canPie ? '' : ' disabled') + '><option value="sessions"' + (pieMetric === 'sessions' ? ' selected' : '') + '>Sessions</option><option value="orders"' + (pieMetric === 'orders' ? ' selected' : '') + '>Orders</option><option value="revenue"' + (pieMetric === 'revenue' ? ' selected' : '') + '>Revenue</option></select></div>' +
        '<div class="col-12"><label class="form-label mb-1">Chart style</label><div class="row g-2">' +
          '<div class="col-6 col-lg-4" data-chart-setting="curve"><label class="form-label mb-1">Curve</label><select class="form-select form-select-sm" data-chart-field="style.curve"><option value="smooth"' + (style.curve === 'smooth' ? ' selected' : '') + '>Smooth</option><option value="straight"' + (style.curve === 'straight' ? ' selected' : '') + '>Straight</option><option value="stepline"' + (style.curve === 'stepline' ? ' selected' : '') + '>Stepline</option></select></div>' +
          '<div class="col-6 col-lg-4" data-chart-setting="stroke"><label class="form-label mb-1">Stroke</label><input type="number" class="form-control form-control-sm" min="0" max="8" step="0.1" data-chart-field="style.strokeWidth" value="' + escapeHtml(String(style.strokeWidth)) + '"></div>' +
          '<div class="col-6 col-lg-4" data-chart-setting="dash"><label class="form-label mb-1">Dash</label><input type="number" class="form-control form-control-sm" min="0" max="20" step="1" data-chart-field="style.dashArray" value="' + escapeHtml(String(style.dashArray)) + '"></div>' +
          '<div class="col-6 col-lg-4" data-chart-setting="markers"><label class="form-label mb-1">Markers</label><input type="number" class="form-control form-control-sm" min="0" max="12" step="1" data-chart-field="style.markerSize" value="' + escapeHtml(String(style.markerSize)) + '"></div>' +
          '<div class="col-6 col-lg-4" data-chart-setting="fill"><label class="form-label mb-1">Fill opacity</label><input type="number" class="form-control form-control-sm" min="0" max="1" step="0.05" data-chart-field="style.fillOpacity" value="' + escapeHtml(String(style.fillOpacity)) + '"></div>' +
          '<div class="col-6 col-lg-4" data-chart-setting="grid"><label class="form-label mb-1">Grid dash</label><input type="number" class="form-control form-control-sm" min="0" max="16" step="1" data-chart-field="style.gridDash" value="' + escapeHtml(String(style.gridDash)) + '"></div>' +
          '<div class="col-6 col-lg-4" data-chart-setting="labels"><label class="form-label mb-1">Labels</label><select class="form-select form-select-sm" data-chart-field="style.dataLabels"><option value="auto"' + (style.dataLabels === 'auto' ? ' selected' : '') + '>Auto</option><option value="on"' + (style.dataLabels === 'on' ? ' selected' : '') + '>On</option><option value="off"' + (style.dataLabels === 'off' ? ' selected' : '') + '>Off</option></select></div>' +
          '<div class="col-6 col-lg-4 d-flex align-items-end" data-chart-setting="toolbar"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.toolbar"' + (style.toolbar ? ' checked' : '') + '><span class="form-check-label ms-2">Toolbar</span></label></div>' +
          '<div class="col-6 col-lg-4 d-flex align-items-end" data-chart-setting="animations"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.animations"' + (style.animations ? ' checked' : '') + '><span class="form-check-label ms-2">Animations</span></label></div>' +
        '</div></div>' +
        '<div class="col-12" data-chart-setting="pie-donut"><label class="form-label mb-1">Pie / donut</label><div class="row g-2">' +
          '<div class="col-6 col-md-4 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.pieDonut"' + (style.pieDonut ? ' checked' : '') + (supportsPie ? '' : ' disabled') + '><span class="form-check-label ms-2">Hollow donut</span></label></div>' +
          '<div class="col-6 col-md-4"><label class="form-label mb-1">Donut size (%)</label><input type="number" class="form-control form-control-sm" min="30" max="90" step="1" data-chart-field="style.pieDonutSize" value="' + escapeHtml(String(style.pieDonutSize)) + '"' + (supportsPie ? '' : ' disabled') + '></div>' +
          '<div class="col-6 col-md-4"><label class="form-label mb-1">Label position</label><select class="form-select form-select-sm" data-chart-field="style.pieLabelPosition"' + (supportsPie ? '' : ' disabled') + '><option value="auto"' + (style.pieLabelPosition === 'auto' ? ' selected' : '') + '>Auto</option><option value="inside"' + (style.pieLabelPosition === 'inside' ? ' selected' : '') + '>Inside</option><option value="outside"' + (style.pieLabelPosition === 'outside' ? ' selected' : '') + '>Outside</option></select></div>' +
          '<div class="col-6 col-md-4"><label class="form-label mb-1">Label content</label><select class="form-select form-select-sm" data-chart-field="style.pieLabelContent"' + (supportsPie ? '' : ' disabled') + '><option value="percent"' + (style.pieLabelContent === 'percent' ? ' selected' : '') + '>Percent</option><option value="label"' + (style.pieLabelContent === 'label' ? ' selected' : '') + '>Label</option><option value="label_percent"' + (style.pieLabelContent === 'label_percent' ? ' selected' : '') + '>Label + percent</option></select></div>' +
          '<div class="col-6 col-md-4"><label class="form-label mb-1">Label offset</label><input type="number" class="form-control form-control-sm" min="-40" max="40" step="1" data-chart-field="style.pieLabelOffset" value="' + escapeHtml(String(style.pieLabelOffset)) + '"' + (supportsPie ? '' : ' disabled') + '></div>' +
          (isCountriesOverview ? '<div class="col-12 col-md-6 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.pieCountryFlags"' + (style.pieCountryFlags ? ' checked' : '') + '><span class="form-check-label ms-2">Country flags in labels</span></label></div>' : '') +
          (isKexoOverview ? '<div class="col-12 col-md-6"><label class="form-label mb-1">Kexo renderer</label><select class="form-select form-select-sm" data-chart-field="style.kexoRenderer"><option value="wheel"' + (style.kexoRenderer === 'wheel' ? ' selected' : '') + '>Kexo wheel</option><option value="pie"' + (style.kexoRenderer === 'pie' ? ' selected' : '') + '>Donut pie</option></select></div>' : '') +
        '</div></div>' +
        '<div class="col-12"><label class="form-label mb-1">Series colors (hex)</label>' + renderChartColorInputs(item, meta) + '</div>' +
        '<div class="col-12"><label class="form-label mb-1">Advanced Apex override (JSON)</label><textarea class="form-control form-control-sm" rows="4" data-chart-field="advancedApexOverride" spellcheck="false">' + escapeHtml(prettyJson(item && item.advancedApexOverride)) + '</textarea></div>' +
      '</div>'
    );
  }

  function parseApexOverride(raw, fallback) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    var text = raw == null ? '' : String(raw).trim();
    if (!text) return fallback || {};
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return fallback || {};
  }

  function readChartModalBody(container, chartKey) {
    if (!container || !container.querySelector) return null;
    var def = defaultSingleChart(chartKey);
    var enabledEl = container.querySelector('[data-chart-field="enabled"]');
    var labelEl = container.querySelector('[data-chart-field="label"]');
    var modeEl = container.querySelector('[data-chart-field="mode"]');
    var pieMetricEl = container.querySelector('[data-chart-field="pieMetric"]');
    var advancedEl = container.querySelector('[data-chart-field="advancedApexOverride"]');
    var style = normalizeChartStyleDraft({
      curve: (container.querySelector('[data-chart-field="style.curve"]') || {}).value,
      strokeWidth: (container.querySelector('[data-chart-field="style.strokeWidth"]') || {}).value,
      dashArray: (container.querySelector('[data-chart-field="style.dashArray"]') || {}).value,
      markerSize: (container.querySelector('[data-chart-field="style.markerSize"]') || {}).value,
      fillOpacity: (container.querySelector('[data-chart-field="style.fillOpacity"]') || {}).value,
      gridDash: (container.querySelector('[data-chart-field="style.gridDash"]') || {}).value,
      dataLabels: (container.querySelector('[data-chart-field="style.dataLabels"]') || {}).value,
      toolbar: !!(container.querySelector('[data-chart-field="style.toolbar"]') || {}).checked,
      animations: !!(container.querySelector('[data-chart-field="style.animations"]') || {}).checked,
      pieDonut: !!(container.querySelector('[data-chart-field="style.pieDonut"]') || {}).checked,
      pieDonutSize: (container.querySelector('[data-chart-field="style.pieDonutSize"]') || {}).value,
      pieLabelPosition: (container.querySelector('[data-chart-field="style.pieLabelPosition"]') || {}).value,
      pieLabelContent: (container.querySelector('[data-chart-field="style.pieLabelContent"]') || {}).value,
      pieLabelOffset: (container.querySelector('[data-chart-field="style.pieLabelOffset"]') || {}).value,
      pieCountryFlags: !!(container.querySelector('[data-chart-field="style.pieCountryFlags"]') || {}).checked,
      kexoRenderer: (container.querySelector('[data-chart-field="style.kexoRenderer"]') || {}).value,
    }, def.style);
    var colors = [];
    container.querySelectorAll('[data-chart-field="color"][data-idx]').forEach(function (inp) {
      var idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
      if (!Number.isFinite(idx) || idx < 0) idx = 0;
      colors[idx] = normalizeHexColor(inp.value, '#3eb3ab');
    });
    return {
      key: chartKey,
      enabled: !!(enabledEl && enabledEl.checked),
      label: labelEl && labelEl.value != null ? String(labelEl.value).trim() : chartKey,
      mode: modeEl && modeEl.value != null ? String(modeEl.value).trim().toLowerCase() : (def.mode || 'line'),
      pieMetric: pieMetricEl && !pieMetricEl.disabled && pieMetricEl.value != null ? String(pieMetricEl.value).trim().toLowerCase() : (def.pieMetric || 'sessions'),
      colors: colors.filter(Boolean).length ? colors.filter(Boolean) : def.colors,
      style: style,
      advancedApexOverride: parseApexOverride(advancedEl ? advancedEl.value : null, def.advancedApexOverride || {}),
    };
  }

  function syncColorSwatches(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-color-swatch]').forEach(function (sw) {
      var row = sw.previousElementSibling;
      var input = row && row.querySelector && row.querySelector('[data-chart-field="color"]');
      if (input) {
        var val = normalizeHexColor(input.value, '#3eb3ab');
        sw.style.background = val;
        sw.setAttribute('title', val);
      }
    });
  }

  function refreshChartSettingsUi(container, chartKey) {
    if (!container || !container.querySelectorAll) return;
    var modeEl = container.querySelector('[data-chart-field="mode"]');
    var mode = (modeEl && modeEl.value != null ? String(modeEl.value).trim().toLowerCase() : '') || 'line';
    var lineLike = mode === 'line' || mode === 'area' || mode === 'multi-line-labels' || mode === 'stacked-area' || mode === 'combo';
    var barLike = mode === 'bar' || mode === 'bar-horizontal' || mode === 'bar-distributed' || mode === 'stacked-bar';
    var showCurve = lineLike;
    var showStroke = lineLike;
    var showDash = lineLike;
    var showMarkers = lineLike;
    var showFill = (lineLike || barLike) && mode !== 'map-flat' && mode !== 'map-animated';
    var showGrid = lineLike || barLike;
    var showLabels = lineLike || barLike;
    var showToolbar = true;
    var showAnimations = true;
    var showPieDonut = mode === 'pie' || mode === 'donut';
    if (mode.indexOf('map-') === 0) {
      showCurve = showStroke = showDash = showMarkers = showFill = showGrid = showLabels = showPieDonut = false;
    }
    var settingNames = ['curve', 'stroke', 'dash', 'markers', 'fill', 'grid', 'labels', 'toolbar', 'animations', 'pie-donut'];
    var visibility = { curve: showCurve, stroke: showStroke, dash: showDash, markers: showMarkers, fill: showFill, grid: showGrid, labels: showLabels, toolbar: showToolbar, animations: showAnimations, 'pie-donut': showPieDonut };
    settingNames.forEach(function (name) {
      var el = container.querySelector('[data-chart-setting="' + name + '"]');
      if (!el) return;
      var visible = !!visibility[name];
      el.style.display = visible ? '' : 'none';
      var inputs = el.querySelectorAll('input, select, textarea');
      inputs.forEach(function (inp) {
        if (visible) inp.removeAttribute('disabled');
        else inp.setAttribute('disabled', 'disabled');
      });
    });
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.innerHTML = (
      '<div class="modal modal-blur" id="' + MODAL_ID + '" tabindex="-1" role="dialog" aria-labelledby="' + MODAL_ID + '-title" aria-hidden="true">' +
        '<div class="modal-dialog modal-lg modal-dialog-scrollable modal-dialog-centered" role="document">' +
          '<div class="modal-content">' +
            '<div class="modal-header">' +
              '<h5 class="modal-title" id="' + MODAL_ID + '-title">Layout settings</h5>' +
              '<button type="button" class="btn-close" aria-label="Close" data-kexo-layout-modal-close></button>' +
            '</div>' +
            '<div class="modal-body" id="' + MODAL_ID + '-body"></div>' +
            '<div class="modal-footer">' +
              '<span id="' + MODAL_ID + '-msg" class="form-hint me-auto"></span>' +
              '<button type="button" class="btn btn-secondary" data-kexo-layout-modal-close>Cancel</button>' +
              '<button type="button" class="btn btn-primary" id="' + MODAL_ID + '-save-btn">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    var el = wrap.firstChild;
    document.body.appendChild(el);
    try { initModalClose(); } catch (_) {}
    return el;
  }

  function setMsg(text, ok) {
    var msg = document.getElementById(MODAL_ID + '-msg');
    if (msg) {
      msg.textContent = text || '';
      msg.className = 'form-hint me-auto ' + (ok === true ? 'text-success' : ok === false ? 'text-danger' : '');
    }
  }

  function closeModal() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        var inst = window.bootstrap.Modal.getInstance(modal);
        if (inst) inst.hide();
      }
    } catch (_) {}
    modal.classList.remove('show');
    modal.style.display = '';
    document.body.classList.remove('modal-open');
    try {
      document.querySelectorAll('.modal-backdrop[data-kexo-layout-backdrop="1"]').forEach(function (b) { if (b && b.parentNode) b.parentNode.removeChild(b); });
    } catch (_) {}
  }

  function showModal() {
    var modal = ensureModal();
    modal.style.display = 'block';
    modal.classList.add('show');
    document.body.classList.add('modal-open');
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show';
    backdrop.setAttribute('data-kexo-layout-backdrop', '1');
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', function () { closeModal(); });
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        var inst = window.bootstrap.Modal.getOrCreateInstance(modal, { backdrop: true, keyboard: true });
        inst.show();
      }
    } catch (_) {}
  }

  function saveTablesUiConfig(cfg) {
    var api = (typeof API !== 'undefined' ? API : '') || '';
    return fetch(api + '/api/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tablesUiConfig: cfg }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok && data.tablesUiConfig) {
        try { (typeof safeWriteLocalStorageJson === 'function' ? safeWriteLocalStorageJson : function (k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_) {} })(TABLES_LS_KEY, data.tablesUiConfig); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('kexo:tablesUiConfigUpdated', { detail: data.tablesUiConfig })); } catch (_) {}
      }
      return data;
    });
  }

  function saveChartsUiConfig(cfg) {
    var api = (typeof API !== 'undefined' ? API : '') || '';
    return fetch(api + '/api/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chartsUiConfig: cfg }),
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.ok && data.chartsUiConfig) {
        try { (typeof safeWriteLocalStorageJson === 'function' ? safeWriteLocalStorageJson : function (k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_) {} })(CHARTS_LS_KEY, data.chartsUiConfig); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent('kexo:chartsUiConfigUpdated', { detail: data.chartsUiConfig })); } catch (_) {}
      }
      return data;
    });
  }

  function findPageAndTableIndex(cfg, pageKey, tableId) {
    if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.pages)) return { pageIndex: -1, tableIndex: -1 };
    var pk = String(pageKey || '').trim().toLowerCase();
    var tid = String(tableId || '').trim().toLowerCase();
    for (var pi = 0; pi < cfg.pages.length; pi++) {
      var p = cfg.pages[pi];
      if (!p || String(p.key || '').trim().toLowerCase() !== pk) continue;
      var tables = Array.isArray(p.tables) ? p.tables : [];
      for (var ti = 0; ti < tables.length; ti++) {
        if (tables[ti] && String(tables[ti].id || '').trim().toLowerCase() === tid) return { pageIndex: pi, tableIndex: ti };
      }
      return { pageIndex: pi, tableIndex: -1 };
    }
    return { pageIndex: -1, tableIndex: -1 };
  }

  function findChartIndex(cfg, chartKey) {
    if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.charts)) return -1;
    var ck = String(chartKey || '').trim().toLowerCase();
    for (var i = 0; i < cfg.charts.length; i++) {
      if (cfg.charts[i] && String(cfg.charts[i].key || '').trim().toLowerCase() === ck) return i;
    }
    return -1;
  }

  function openTableModal(opts) {
    var pageKey = (opts && opts.pageKey != null) ? String(opts.pageKey).trim().toLowerCase() : '';
    var tableId = (opts && opts.tableId != null) ? String(opts.tableId).trim() : '';
    var cardTitle = (opts && opts.cardTitle != null) ? String(opts.cardTitle).trim() : tableId;
    if (!pageKey || !tableId) return;

    var modal = ensureModal();
    var titleEl = document.getElementById(MODAL_ID + '-title');
    var bodyEl = document.getElementById(MODAL_ID + '-body');
    var saveBtn = document.getElementById(MODAL_ID + '-save-btn');
    if (titleEl) titleEl.textContent = 'Table: ' + cardTitle;
    if (!bodyEl) return;

    setMsg('Loading…', null);
    var api = (typeof API !== 'undefined' ? API : '') || '';
    fetch(api + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var cfg = (data && data.ok && data.tablesUiConfig) ? data.tablesUiConfig : null;
        if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.pages)) {
          cfg = (typeof safeReadLocalStorageJson === 'function' ? safeReadLocalStorageJson(TABLES_LS_KEY) : null) || { v: 1, pages: [] };
        }
        var found = findPageAndTableIndex(cfg, pageKey, tableId);
        var t;
        if (found.pageIndex >= 0 && found.tableIndex >= 0) {
          t = cfg.pages[found.pageIndex].tables[found.tableIndex];
          t = { id: t.id, name: t.name, order: t.order, tableClass: t.tableClass, zone: t.zone, inGrid: t.inGrid, rows: t.rows, sticky: t.sticky };
        } else {
          t = defaultSingleTableRow(pageKey, tableId);
        }
        bodyEl.innerHTML = renderTableModalBody(t);
        bodyEl.setAttribute('data-kexo-layout-mode', 'table');
        bodyEl.setAttribute('data-kexo-layout-page-key', pageKey);
        bodyEl.setAttribute('data-kexo-layout-table-id', tableId);
        bodyEl.removeAttribute('data-kexo-layout-chart-key');
        setMsg('', null);

        bodyEl.addEventListener('input', function (e) {
          if (e.target && e.target.getAttribute('data-field') === 'rows-options') updateTableDefaultRowsSelect(bodyEl);
        });
        bodyEl.addEventListener('change', function (e) {
          if (e.target && e.target.getAttribute('data-field') === 'rows-options') updateTableDefaultRowsSelect(bodyEl);
        });

        var saveHandler = function () {
          var patch = readTableModalBody(bodyEl);
          if (!patch) return;
          setMsg('Saving…', null);
          var nextCfg = JSON.parse(JSON.stringify(cfg));
          var f = findPageAndTableIndex(nextCfg, pageKey, tableId);
          var row = { id: tableId, name: patch.name || tableId, order: 1, tableClass: t.tableClass || '', zone: t.zone || '', inGrid: patch.inGrid, rows: patch.rows, sticky: patch.sticky };
          if (f.pageIndex >= 0) {
            if (f.tableIndex >= 0) {
              row.order = nextCfg.pages[f.pageIndex].tables[f.tableIndex].order;
              nextCfg.pages[f.pageIndex].tables[f.tableIndex] = row;
            } else {
              row.order = (nextCfg.pages[f.pageIndex].tables.length + 1);
              nextCfg.pages[f.pageIndex].tables.push(row);
            }
          } else {
            nextCfg.pages.push({ key: pageKey, label: pageKey, tables: [row] });
          }
          saveTablesUiConfig(nextCfg).then(function (data) {
            if (data && data.ok) {
              try {
                var nextRows = patch && patch.rows && typeof patch.rows.default === 'number' ? patch.rows.default : null;
                if (nextRows != null) {
                  if (typeof window.setTableRowsPerPage === 'function') window.setTableRowsPerPage(tableId, nextRows, 'live');
                  if (typeof window.applyTableRowsPerPageChange === 'function') window.applyTableRowsPerPageChange(tableId, nextRows);
                }
              } catch (_) {}
              setMsg('Saved.', true);
              closeModal();
            } else {
              setMsg((data && data.error) ? String(data.error) : 'Save failed', false);
            }
          }).catch(function () { setMsg('Save failed', false); });
        };

        saveBtn.replaceWith(saveBtn.cloneNode(true));
        document.getElementById(MODAL_ID + '-save-btn').addEventListener('click', saveHandler);
        showModal();
      })
      .catch(function () {
        setMsg('Could not load settings.', false);
        var t = defaultSingleTableRow(pageKey, tableId);
        bodyEl.innerHTML = renderTableModalBody(t);
        bodyEl.setAttribute('data-kexo-layout-mode', 'table');
        bodyEl.setAttribute('data-kexo-layout-page-key', pageKey);
        bodyEl.setAttribute('data-kexo-layout-table-id', tableId);
        bodyEl.removeAttribute('data-kexo-layout-chart-key');
        var nextCfg = { v: 1, pages: [] };
        saveBtn.replaceWith(saveBtn.cloneNode(true));
        document.getElementById(MODAL_ID + '-save-btn').addEventListener('click', function () {
          var patch = readTableModalBody(bodyEl);
          if (!patch) return;
          setMsg('Saving…', null);
          var row = { id: tableId, name: patch.name || tableId, order: 1, tableClass: t.tableClass || '', zone: t.zone || '', inGrid: patch.inGrid, rows: patch.rows, sticky: patch.sticky };
          nextCfg.pages.push({ key: pageKey, label: pageKey, tables: [row] });
          saveTablesUiConfig(nextCfg).then(function (data) {
            if (data && data.ok) {
              try {
                var nextRows = patch && patch.rows && typeof patch.rows.default === 'number' ? patch.rows.default : null;
                if (nextRows != null) {
                  if (typeof window.setTableRowsPerPage === 'function') window.setTableRowsPerPage(tableId, nextRows, 'live');
                  if (typeof window.applyTableRowsPerPageChange === 'function') window.applyTableRowsPerPageChange(tableId, nextRows);
                }
              } catch (_) {}
              setMsg('Saved.', true);
              closeModal();
            } else {
              setMsg((data && data.error) ? String(data.error) : 'Save failed', false);
            }
          }).catch(function () { setMsg('Save failed', false); });
        });
        showModal();
      });
  }

  function openChartModal(opts) {
    var chartKey = (opts && opts.chartKey != null) ? String(opts.chartKey).trim().toLowerCase() : '';
    var cardTitle = (opts && opts.cardTitle != null) ? String(opts.cardTitle).trim() : chartKey;
    if (!chartKey) return;

    var modal = ensureModal();
    var titleEl = document.getElementById(MODAL_ID + '-title');
    var bodyEl = document.getElementById(MODAL_ID + '-body');
    var saveBtn = document.getElementById(MODAL_ID + '-save-btn');
    if (titleEl) titleEl.textContent = 'Chart: ' + cardTitle;
    if (!bodyEl) return;

    setMsg('Loading…', null);
    var api = (typeof API !== 'undefined' ? API : '') || '';
    fetch(api + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var cfg = (data && data.ok && data.chartsUiConfig) ? data.chartsUiConfig : null;
        if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.charts)) {
          cfg = (typeof safeReadLocalStorageJson === 'function' ? safeReadLocalStorageJson(CHARTS_LS_KEY) : null) || { v: 1, hideOnMobile: true, charts: [], kpiBundles: {} };
        }
        var idx = findChartIndex(cfg, chartKey);
        var item = (idx >= 0 && cfg.charts[idx]) ? cfg.charts[idx] : defaultSingleChart(chartKey);
        bodyEl.innerHTML = renderChartModalBody(item, chartKey);
        bodyEl.setAttribute('data-kexo-layout-mode', 'chart');
        bodyEl.setAttribute('data-kexo-layout-chart-key', chartKey);
        bodyEl.removeAttribute('data-kexo-layout-page-key');
        bodyEl.removeAttribute('data-kexo-layout-table-id');
        setMsg('', null);
        refreshChartSettingsUi(bodyEl, chartKey);
        syncColorSwatches(bodyEl);
        bodyEl.addEventListener('input', function () { syncColorSwatches(bodyEl); });
        bodyEl.addEventListener('change', function () {
          syncColorSwatches(bodyEl);
          refreshChartSettingsUi(bodyEl, chartKey);
        });

        saveBtn.replaceWith(saveBtn.cloneNode(true));
        document.getElementById(MODAL_ID + '-save-btn').addEventListener('click', function () {
          var patch = readChartModalBody(bodyEl, chartKey);
          if (!patch) return;
          setMsg('Saving…', null);
          var nextCfg = JSON.parse(JSON.stringify(cfg));
          var i = findChartIndex(nextCfg, chartKey);
          var row = { key: chartKey, enabled: patch.enabled, label: patch.label, mode: patch.mode, colors: patch.colors, style: patch.style, advancedApexOverride: patch.advancedApexOverride, pieMetric: patch.pieMetric };
          if (i >= 0) nextCfg.charts[i] = row;
          else nextCfg.charts.push(row);
          saveChartsUiConfig(nextCfg).then(function (data) {
            if (data && data.ok) {
              setMsg('Saved.', true);
              closeModal();
            } else {
              setMsg((data && data.error) ? String(data.error) : 'Save failed', false);
            }
          }).catch(function () { setMsg('Save failed', false); });
        });
        showModal();
      })
      .catch(function () {
        setMsg('Could not load settings.', false);
        var item = defaultSingleChart(chartKey);
        bodyEl.innerHTML = renderChartModalBody(item, chartKey);
        bodyEl.setAttribute('data-kexo-layout-mode', 'chart');
        bodyEl.setAttribute('data-kexo-layout-chart-key', chartKey);
        bodyEl.removeAttribute('data-kexo-layout-page-key');
        bodyEl.removeAttribute('data-kexo-layout-table-id');
        refreshChartSettingsUi(bodyEl, chartKey);
        syncColorSwatches(bodyEl);
        saveBtn.replaceWith(saveBtn.cloneNode(true));
        document.getElementById(MODAL_ID + '-save-btn').addEventListener('click', function () {
          var patch = readChartModalBody(bodyEl, chartKey);
          if (!patch) return;
          setMsg('Saving…', null);
          var nextCfg = { v: 1, hideOnMobile: true, charts: [], kpiBundles: {} };
          nextCfg.charts.push({ key: chartKey, enabled: patch.enabled, label: patch.label, mode: patch.mode, colors: patch.colors, style: patch.style, advancedApexOverride: patch.advancedApexOverride, pieMetric: patch.pieMetric });
          saveChartsUiConfig(nextCfg).then(function (data) {
            if (data && data.ok) { setMsg('Saved.', true); closeModal(); } else { setMsg((data && data.error) ? String(data.error) : 'Save failed', false); }
          }).catch(function () { setMsg('Save failed', false); });
        });
        showModal();
      });
  }

  function initModalClose() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    if (modal.getAttribute('data-kexo-layout-close-wired') === '1') return;
    modal.setAttribute('data-kexo-layout-close-wired', '1');
    function close(e) {
      try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (_) {}
      closeModal();
    }
    modal.querySelectorAll('[data-kexo-layout-modal-close]').forEach(function (btn) { btn.addEventListener('click', close); });
    modal.addEventListener('click', function (e) { if (e && e.target === modal) close(e); });
    if (document.documentElement.getAttribute('data-kexo-layout-esc-wired') !== '1') {
      document.documentElement.setAttribute('data-kexo-layout-esc-wired', '1');
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var m = document.getElementById(MODAL_ID);
          if (m && m.classList && m.classList.contains('show')) close(e);
        }
      });
    }
  }

  try {
    window.KexoLayoutShortcuts = {
      openTableModal: openTableModal,
      openChartModal: openChartModal,
      saveTablesUiConfig: saveTablesUiConfig,
      saveChartsUiConfig: saveChartsUiConfig,
      renderTableModalBody: renderTableModalBody,
      readTableModalBody: readTableModalBody,
      renderChartModalBody: renderChartModalBody,
      readChartModalBody: readChartModalBody,
      refreshChartSettingsUi: refreshChartSettingsUi,
    };
  } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalClose);
  } else {
    initModalClose();
  }
})();
