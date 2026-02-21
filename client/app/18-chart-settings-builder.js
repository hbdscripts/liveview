/**
 * Unified chart settings modal — opened from chart cog. Persists via PUT /api/chart-settings/:chartKey.
 * Single-init: one document listener for cog clicks; no duplicate bindings.
 */
(function () {
  'use strict';

  var MODAL_ID = 'kexo-chart-settings-modal';
  var CHARTS_LS_KEY = 'kexo:charts-ui-config:v1';
  var API = (typeof window !== 'undefined' && window.API) ? String(window.API || '') : '';
  var lastOpen = { key: '', at: 0 };
  var inFlight = { controller: null, chartKey: '' };
  var fallbackBackdrop = null;

  function getChartMeta(key) {
    return (typeof window.kexoChartMeta === 'function' ? window.kexoChartMeta(key) : null) || { modes: ['line', 'area'], series: [], defaultMode: 'line', height: 200 };
  }

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

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal modal-blur" id="' + MODAL_ID + '" tabindex="-1" role="dialog" aria-labelledby="' + MODAL_ID + '-title" aria-hidden="true">' +
        '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" role="document">' +
          '<div class="modal-content">' +
            '<div class="modal-header">' +
              '<h5 class="modal-title" id="' + MODAL_ID + '-title">Chart settings</h5>' +
              '<button type="button" class="btn-close" data-kexo-chart-settings-close aria-label="Close"></button>' +
            '</div>' +
            '<div class="modal-body" id="' + MODAL_ID + '-body"></div>' +
            '<div class="modal-footer">' +
              '<span id="' + MODAL_ID + '-msg" class="form-hint me-auto"></span>' +
              '<button type="button" class="btn btn-secondary" data-kexo-chart-settings-close>Cancel</button>' +
              '<button type="button" class="btn btn-primary" id="' + MODAL_ID + '-save">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var el = wrap.firstChild;
    document.body.appendChild(el);
    el.querySelectorAll('[data-kexo-chart-settings-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(); });
    });
    // Ensure we always cleanup in-flight requests when the modal closes.
    try {
      if (el.getAttribute('data-kexo-chart-settings-lifecycle') !== '1') {
        el.setAttribute('data-kexo-chart-settings-lifecycle', '1');
        el.addEventListener('hidden.bs.modal', function () { abortInFlight(); });
      }
    } catch (_) {}
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
    abortInFlight();
    var usedBootstrap = false;
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        var inst = window.bootstrap.Modal.getInstance(modal);
        if (inst) { inst.hide(); usedBootstrap = true; }
      }
    } catch (_) {}
    if (usedBootstrap) return;
    try { modal.style.display = 'none'; } catch (_) {}
    try { modal.classList.remove('show'); } catch (_) {}
    try { modal.setAttribute('aria-hidden', 'true'); } catch (_) {}
    try { if (document && document.body) document.body.classList.remove('modal-open'); } catch (_) {}
    try {
      if (fallbackBackdrop && fallbackBackdrop.parentNode) fallbackBackdrop.parentNode.removeChild(fallbackBackdrop);
    } catch (_) {}
    fallbackBackdrop = null;
  }

  function abortInFlight() {
    try {
      if (inFlight && inFlight.controller && typeof inFlight.controller.abort === 'function') {
        inFlight.controller.abort();
      }
    } catch (_) {}
    try { inFlight.controller = null; } catch (_) {}
    try { inFlight.chartKey = ''; } catch (_) {}
  }

  function showModal() {
    var modal = ensureModal();
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(modal, { backdrop: true, keyboard: true }).show();
        return;
      }
    } catch (_) {}
    // Fallback: display the modal without Bootstrap JS.
    try { modal.style.display = 'block'; } catch (_) {}
    try { if (document && document.body) document.body.classList.add('modal-open'); } catch (_) {}
    try {
      if (!fallbackBackdrop) {
        fallbackBackdrop = document.createElement('div');
        fallbackBackdrop.className = 'modal-backdrop fade show';
        fallbackBackdrop.addEventListener('click', function () { closeModal(); });
        document.body.appendChild(fallbackBackdrop);
      }
    } catch (_) {}
  }

  function modeOptionsHtml(modes, selected) {
    var labels = (window.KEXO_CHART_MODE_LABEL && typeof window.KEXO_CHART_MODE_LABEL === 'object') ? window.KEXO_CHART_MODE_LABEL : {};
    var sel = String(selected || '').trim().toLowerCase();
    return (modes || []).map(function (m) {
      var v = String(m || '').trim().toLowerCase();
      if (!v) return '';
      var label = labels[v] || v;
      return '<option value="' + escapeHtml(v) + '"' + (v === sel ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');
  }

  function writeChartsUiConfigCacheFromServer(cfg) {
    if (!cfg || cfg.v !== 1) return;
    var toStore;
    try {
      toStore = Object.assign({}, cfg, { schemaVersion: 1, updatedAt: Date.now() });
    } catch (_) {
      toStore = cfg;
    }
    try {
      (typeof safeWriteLocalStorageJson === 'function'
        ? safeWriteLocalStorageJson
        : function (k, v) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch (_) {} }
      )(CHARTS_LS_KEY, toStore);
    } catch (_) {}
  }

  function openModal(opts) {
    var chartKey = (opts && opts.chartKey != null) ? String(opts.chartKey).trim().toLowerCase() : '';
    var cardTitle = (opts && opts.cardTitle != null) ? String(opts.cardTitle).trim() : chartKey;
    if (!chartKey) return;
    var now = Date.now();
    if (lastOpen.key === chartKey && (now - lastOpen.at) < 250) return;
    lastOpen.key = chartKey;
    lastOpen.at = now;

    var modal = ensureModal();
    var titleEl = document.getElementById(MODAL_ID + '-title');
    var bodyEl = document.getElementById(MODAL_ID + '-body');
    var saveBtn = document.getElementById(MODAL_ID + '-save');
    if (titleEl) titleEl.textContent = 'Chart: ' + cardTitle;
    if (!bodyEl) return;

    setMsg('Loading…', null);
    bodyEl.innerHTML = '<div class="text-muted">Loading…</div>';
    showModal();
    abortInFlight();
    try {
      inFlight.chartKey = chartKey;
      inFlight.controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    } catch (_) {
      inFlight.controller = null;
    }
    fetch(API + '/api/chart-settings/' + encodeURIComponent(chartKey), {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: inFlight.controller ? inFlight.controller.signal : undefined,
    })
      .then(function (r) {
        if (!r) return null;
        // Always try to surface a useful error in the modal instead of failing silently.
        return r.json().catch(function () {
          return { ok: false, error: 'Request failed (' + String(r.status || '') + ')' };
        });
      })
      .then(function (data) {
        if (!data || !data.ok) {
          setMsg('Failed to load settings', false);
          bodyEl.innerHTML = '<div class="text-muted">Could not load settings.</div>';
          return;
        }
        var s = data.settings || {};
        var meta = getChartMeta(chartKey);
        var modes = meta.modes || ['line', 'area'];
        var mode = String((s.mode || meta.defaultMode || 'line')).trim().toLowerCase();
        if (modes.indexOf(mode) < 0) mode = modes[0] || 'line';
        var size = Number(s.sizePercent);
        if (!Number.isFinite(size) || size < 25 || size > 100) size = 100;
        size = Math.round(size / 5) * 5;
        var animations = !(s.style && s.style.animations === false);
        var supportsIcons = !!(meta && meta.capabilities && meta.capabilities.icons === true);
        var iconsEnabled = supportsIcons ? !!(s.style && s.style.icons === true) : false;
        var supportsPieLabels = !!(modes && (modes.indexOf('pie') >= 0 || modes.indexOf('donut') >= 0));
        var pieLabelPosition = (s && s.style && s.style.pieLabelPosition != null) ? String(s.style.pieLabelPosition).trim().toLowerCase() : 'auto';
        if (pieLabelPosition !== 'auto' && pieLabelPosition !== 'inside' && pieLabelPosition !== 'outside') pieLabelPosition = 'auto';
        var pieLabelOffset = (s && s.style && Number.isFinite(Number(s.style.pieLabelOffset))) ? Math.round(Number(s.style.pieLabelOffset)) : 16;
        if (!Number.isFinite(pieLabelOffset)) pieLabelOffset = 16;
        pieLabelOffset = Math.round(Math.max(-40, Math.min(40, pieLabelOffset)));
        if (pieLabelPosition === 'outside') pieLabelOffset = Math.max(6, pieLabelOffset);
        if (pieLabelPosition === 'inside') pieLabelOffset = Math.min(0, pieLabelOffset);
        var finishesCenterLabel = !(s.style && s.style.radialCenterLabel === false);
        var isOverview = chartKey === 'dash-chart-overview-30d';
        var isFinishes = chartKey === 'dash-chart-finishes-30d';
        var colors = (s.colors && Array.isArray(s.colors)) ? s.colors : (meta.series && meta.series.length ? ['#3eb3ab', '#ef4444', '#2fb344', '#d63939'].slice(0, meta.series.length) : ['#3eb3ab']);
        var rev = (isOverview && colors[0]) ? colors[0] : '#3eb3ab';
        var cost = (isOverview && colors[1]) ? colors[1] : '#ef4444';
        var profitPos = (isOverview && colors[2]) ? colors[2] : '#2fb344';
        var profitNeg = (isOverview && colors[3]) ? colors[3] : '#d63939';
        var fillOpacityRaw = (s && s.style && Number.isFinite(Number(s.style.fillOpacity)))
          ? Math.max(0, Math.min(1, Number(s.style.fillOpacity)))
          : 0.18;
        var fillOpacityPct = Math.round(fillOpacityRaw * 100);
        var fillOpacityVisible = (String(mode || '').trim().toLowerCase() !== 'map');

        var body = '';
        body += '<div class="row g-3">';
        var lockMode = Array.isArray(modes) && modes.length === 1;
        if (lockMode) {
          var lockVal = String(modes[0] || mode || 'line').trim().toLowerCase();
          body += '<input type="hidden" data-cs-field="mode" value="' + escapeHtml(String(lockVal)) + '">';
        } else {
          body += '<div class="col-12 col-md-6"><label class="form-label">Chart type</label><select class="form-select form-select-sm" data-cs-field="mode">' + modeOptionsHtml(modes, mode) + '</select></div>';
        }
        var isMapChart = chartKey === 'live-online-chart' || chartKey === 'countries-map-chart';
        if (!isMapChart) {
          body += '<div class="col-12 col-md-6"><label class="form-label">Size (% of container)</label><select class="form-select form-select-sm" data-cs-field="sizePercent">';
          for (var p = 25; p <= 100; p += 5) {
            body += '<option value="' + p + '"' + (p === size ? ' selected' : '') + '>' + p + '%</option>';
          }
          body += '</select></div>';
        }
        if (!isMapChart) {
          body += '<div class="col-12"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-cs-field="animations"' + (animations ? ' checked' : '') + '><span class="form-check-label ms-2">Animations</span></label></div>';
        }
        if (supportsIcons) {
          body += '<div class="col-12"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-cs-field="icons"' + (iconsEnabled ? ' checked' : '') + '><span class="form-check-label ms-2">Icons</span></label><div class="form-hint">Show source icons in the chart legend.</div></div>';
        }
        if (isFinishes) {
          body += '<div class="col-12' + (String(mode || '').toLowerCase() === 'radialbar' ? '' : ' d-none') + '" data-cs-mode-group="finishes-center-label">';
          body += '<label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-cs-field="radialCenterLabel"' + (finishesCenterLabel ? ' checked' : '') + '><span class="form-check-label ms-2">Place the highest revenue variant in the center?</span></label>';
          body += '<div class="form-hint">Only applies to the Radial Bar chart type.</div>';
          body += '</div>';
        }
        var capControls = (meta && meta.capabilities && Array.isArray(meta.capabilities.controls)) ? meta.capabilities.controls : [];
        if (capControls && capControls.length) {
          var styleObj = (s && s.style && typeof s.style === 'object') ? s.style : {};
          function hintIconHtml(txt) {
            var t = txt != null ? String(txt).trim() : '';
            if (!t) return '';
            return '<span class="text-muted small ms-1 d-inline-flex align-items-center" role="img" aria-label="' + escapeHtml(t) + '" title="' + escapeHtml(t) + '"><i class="fa-light fa-circle-info" aria-hidden="true"></i></span>';
          }
          capControls.forEach(function (c) {
            if (!c || typeof c !== 'object') return;
            var type = c.type != null ? String(c.type).trim().toLowerCase() : '';
            var field = c.field != null ? String(c.field).trim() : '';
            if (!type || !field) return;
            var label = c.label != null ? String(c.label) : field;
            var hint = c.hint != null ? String(c.hint) : '';
            var modesOnly = Array.isArray(c.modes) ? c.modes.map(function (m) { return String(m || '').trim().toLowerCase(); }).filter(Boolean) : null;
            var modeAttr = (modesOnly && modesOnly.length) ? (' data-cs-modes="' + escapeHtml(modesOnly.join(',')) + '"') : '';
            if (type === 'select') {
              var options = Array.isArray(c.options) ? c.options : [];
              var v = (styleObj && styleObj[field] != null) ? String(styleObj[field]).trim().toLowerCase() : (c.default != null ? String(c.default).trim().toLowerCase() : '');
              if (options.length && !options.some(function (o) { return o && String(o.value).trim().toLowerCase() === v; })) {
                v = String(options[0].value).trim().toLowerCase();
              }
              body += '<div class="col-12 col-md-6"' + modeAttr + '>';
              body += '<label class="form-label d-flex align-items-center gap-1">' + escapeHtml(label) + hintIconHtml(hint) + '</label>';
              body += '<select class="form-select form-select-sm" data-cs-field="' + escapeHtml(field) + '">';
              options.forEach(function (o) {
                if (!o) return;
                var ov = o.value != null ? String(o.value).trim().toLowerCase() : '';
                var ol = o.label != null ? String(o.label) : ov;
                if (!ov) return;
                body += '<option value="' + escapeHtml(ov) + '"' + (ov === v ? ' selected' : '') + '>' + escapeHtml(ol) + '</option>';
              });
              body += '</select>';
              body += '</div>';
            } else if (type === 'range') {
              var min = Number(c.min);
              var max = Number(c.max);
              var step = Number(c.step);
              var unit = c.unit != null ? String(c.unit) : '';
              if (!Number.isFinite(min)) min = 0;
              if (!Number.isFinite(max)) max = 100;
              if (!Number.isFinite(step) || step <= 0) step = 1;
              var raw = (styleObj && styleObj[field] != null) ? Number(styleObj[field]) : Number(c.default);
              if (!Number.isFinite(raw)) raw = min;
              if (raw < min) raw = min;
              if (raw > max) raw = max;
              body += '<div class="col-12 col-md-6"' + modeAttr + '>';
              body += '<label class="form-label d-flex align-items-center justify-content-between">';
              body += '<span class="d-inline-flex align-items-center gap-1">' + escapeHtml(label) + hintIconHtml(hint) + '</span>';
              body += '<span class="text-muted small" data-cs-range-value="' + escapeHtml(field) + '">' + escapeHtml(String(raw)) + (unit ? escapeHtml(unit) : '') + '</span>';
              body += '</label>';
              body += '<input type="range" class="form-range" min="' + escapeHtml(String(min)) + '" max="' + escapeHtml(String(max)) + '" step="' + escapeHtml(String(step)) + '" value="' + escapeHtml(String(raw)) + '" data-cs-field="' + escapeHtml(field) + '" data-cs-range-unit="' + escapeHtml(unit) + '">';
              body += '</div>';
            } else if (type === 'toggle') {
              var def = (typeof c.default === 'boolean') ? c.default : false;
              var stored = (styleObj && typeof styleObj[field] === 'boolean') ? styleObj[field] : def;
              var invert = !!c.invert;
              var checked = invert ? !stored : !!stored;
              body += '<div class="col-12"' + modeAttr + '>';
              body += '<label class="form-check form-switch m-0">';
              body += '<input class="form-check-input" type="checkbox" data-cs-field="' + escapeHtml(field) + '"' + (checked ? ' checked' : '') + (invert ? ' data-cs-invert="1"' : '') + '>';
              body += '<span class="form-check-label ms-2 d-inline-flex align-items-center gap-1">' + escapeHtml(label) + hintIconHtml(hint) + '</span>';
              body += '</label>';
              body += '</div>';
            }
          });
        }
        body += '<div class="col-12' + (fillOpacityVisible ? '' : ' d-none') + '" data-cs-mode-group="fill-opacity">';
        body += '<label class="form-label d-flex align-items-center justify-content-between">';
        body += '<span data-cs-fill-opacity-label>Area fill opacity</span>';
        body += '<span class="text-muted small" data-cs-fill-opacity-value>' + fillOpacityPct + '%</span>';
        body += '</label>';
        body += '<input type="range" class="form-range" min="0" max="100" step="1" value="' + fillOpacityPct + '" data-cs-field="fillOpacity">';
        body += '<div class="form-hint">Lower values make chart fills more transparent.</div>';
        body += '</div>';
        if (isMapChart) {
          var mapAccent = (colors && colors[0]) ? String(colors[0]).trim() : '#16a34a';
          var styleIn = (s && s.style && typeof s.style === 'object') ? s.style : {};
          var mapFit = (styleIn.mapFit != null) ? String(styleIn.mapFit).trim().toLowerCase() : 'cover';
          if (mapFit !== 'cover' && mapFit !== 'contain') mapFit = 'cover';
          var inactiveOpacity = (styleIn.mapInactiveOpacity != null && Number.isFinite(Number(styleIn.mapInactiveOpacity))) ? Math.max(0, Math.min(1, Number(styleIn.mapInactiveOpacity))) : 0.09;
          var inactiveOpacityPct = Math.round(inactiveOpacity * 100);
          var inactiveColor = (styleIn.mapInactiveColor != null) ? String(styleIn.mapInactiveColor).trim() : '';
          var stageBrowse = (styleIn.mapStageBrowseColor != null) ? String(styleIn.mapStageBrowseColor).trim() : '';
          var stageCart = (styleIn.mapStageCartColor != null) ? String(styleIn.mapStageCartColor).trim() : '';
          var stageCheckout = (styleIn.mapStageCheckoutColor != null) ? String(styleIn.mapStageCheckoutColor).trim() : '';
          var stagePurchase = (styleIn.mapStagePurchaseColor != null) ? String(styleIn.mapStagePurchaseColor).trim() : '';

          body += '<div class="col-12 col-md-6"><label class="form-label">Map accent (hex)</label>';
          body += '<div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="map-accent" value="' + escapeHtml(mapAccent) + '" placeholder="#16a34a"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div>';
          body += '<div class="form-hint">Controls map shading and highlighted regions.</div></div>';

          body += '<div class="col-12 col-md-6"><label class="form-label">Fit</label>';
          body += '<select class="form-select form-select-sm" data-cs-field="mapFit">';
          body += '<option value="cover"' + (mapFit === 'cover' ? ' selected' : '') + '>Fill (cover)</option>';
          body += '<option value="contain"' + (mapFit === 'contain' ? ' selected' : '') + '>Fit (contain)</option>';
          body += '</select>';
          body += '<div class="form-hint">Cover fills the container (crops edges). Contain shows the full world (may leave whitespace).</div></div>';

          body += '<div class="col-12 col-md-6"><label class="form-label d-flex align-items-center justify-content-between"><span>Inactive regions opacity</span><span class="text-muted small" data-cs-inactive-opacity-value>' + inactiveOpacityPct + '%</span></label>';
          body += '<input type="range" class="form-range" min="0" max="100" step="1" value="' + inactiveOpacityPct + '" data-cs-field="mapInactiveOpacity">';
          body += '<div class="form-hint">Opacity for countries with no data (default 9%).</div></div>';
          body += '<div class="col-12 col-md-6"><label class="form-label">Inactive regions colour</label>';
          body += '<div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="mapInactiveColor" value="' + escapeHtml(inactiveColor) + '" placeholder="(default)" data-kexo-default-color="' + escapeHtml(mapAccent) + '"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div>';
          body += '<div class="form-hint">Leave blank to use map accent colour.</div></div>';

          body += '<div class="col-12"><label class="form-label">Stage colors (legend + pins)</label><div class="row g-2">';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Browsing</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="mapStageBrowseColor" value="' + escapeHtml(stageBrowse) + '" placeholder="(default)" data-kexo-default-color="#4b94e4"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">In cart</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="mapStageCartColor" value="' + escapeHtml(stageCart) + '" placeholder="(default)" data-kexo-default-color="#f59e34"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Checkout</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="mapStageCheckoutColor" value="' + escapeHtml(stageCheckout) + '" placeholder="(default)" data-kexo-default-color="#6681e8"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Purchased</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="mapStagePurchaseColor" value="' + escapeHtml(stagePurchase) + '" placeholder="(default)" data-kexo-default-color="#3eb3ab"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '</div><div class="form-hint">Leave blank to use theme defaults.</div></div>';
        }
        body += '<div class="col-12' + (supportsPieLabels && (mode === 'pie' || mode === 'donut') ? '' : ' d-none') + '" data-cs-mode-group="pie-labels">';
        body += '<div class="row g-2">';
        body += '<div class="col-12 col-md-6">';
        body += '<label class="form-label">Label position</label>';
        body += '<select class="form-select form-select-sm" data-cs-field="pieLabelPosition">';
        body += '<option value="auto"' + (pieLabelPosition === 'auto' ? ' selected' : '') + '>Auto</option>';
        body += '<option value="inside"' + (pieLabelPosition === 'inside' ? ' selected' : '') + '>Inside</option>';
        body += '<option value="outside"' + (pieLabelPosition === 'outside' ? ' selected' : '') + '>Outside</option>';
        body += '</select>';
        body += '<div class="form-hint">Applies to Pie / Donut chart types.</div>';
        body += '</div>';
        body += '<div class="col-12 col-md-6">';
        body += '<label class="form-label d-flex align-items-center justify-content-between">';
        body += '<span>Label offset</span>';
        body += '<span class="text-muted small" data-cs-pie-label-offset-value>' + String(pieLabelOffset) + 'px</span>';
        body += '</label>';
        body += '<input type="range" class="form-range" min="-40" max="40" step="1" value="' + String(pieLabelOffset) + '" data-cs-field="pieLabelOffset">';
        body += '<div class="form-hint">Move labels inward (negative) or outward (positive).</div>';
        body += '</div>';
        body += '</div>';
        body += '</div>';
        if (isOverview) {
          body += '<div class="col-12"><label class="form-label">Colours</label><div class="row g-2">';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Revenue</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="color-revenue" value="' + escapeHtml(rev) + '" placeholder="#3eb3ab"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Cost</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="color-cost" value="' + escapeHtml(cost) + '" placeholder="#ef4444"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Profit (positive)</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="color-profitPos" value="' + escapeHtml(profitPos) + '" placeholder="#2fb344"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Profit (negative)</label><div class="kexo-color-input"><input type="text" class="form-control form-control-sm" data-kexo-color-input data-cs-field="color-profitNeg" value="' + escapeHtml(profitNeg) + '" placeholder="#d63939"><span class="kexo-color-swatch" data-kexo-color-swatch aria-hidden="true"></span></div></div>';
          body += '</div></div>';

          body += '<div class="col-12">';
          body += '<a class="btn btn-sm btn-outline-secondary" href="/settings/cost-expenses/rules">Open cost settings</a>';
          body += '<div class="form-hint">Manage cost sources, shipping, and profit rules.</div>';
          body += '</div>';
        }
        body += '</div>';

        bodyEl.innerHTML = body;
        bodyEl.setAttribute('data-cs-chart-key', chartKey);
        setMsg('', null);

        function normalizeHex6(v) {
          var r = (v == null ? '' : String(v)).trim().toLowerCase();
          if (/^#[0-9a-f]{6}$/.test(r)) return r;
          if (/^[0-9a-f]{6}$/.test(r)) return '#' + r;
          return null;
        }

        function syncColorPreview(inputEl) {
          if (!inputEl) return;
          var sw = null;
          try { sw = inputEl.parentNode ? inputEl.parentNode.querySelector('[data-kexo-color-swatch]') : null; } catch (_) { sw = null; }
          if (!sw) return;
          var raw = (inputEl.value == null ? '' : String(inputEl.value)).trim();
          var hexVal = normalizeHex6(raw);
          var defaultHex = null;
          if (!raw) {
            try { defaultHex = normalizeHex6(inputEl.getAttribute('data-kexo-default-color')); } catch (_) { defaultHex = null; }
            if (!defaultHex) {
              try { defaultHex = normalizeHex6(inputEl.getAttribute('placeholder')); } catch (_) { defaultHex = null; }
            }
          }
          try {
            var preview = hexVal || defaultHex;
            if (preview) {
              sw.classList.remove('is-empty');
              sw.style.setProperty('--kexo-swatch-color', preview);
            } else {
              sw.classList.add('is-empty');
              sw.style.removeProperty('--kexo-swatch-color');
            }
          } catch (_) {}
        }

        function bindColorPreviews() {
          try {
            var inputs = bodyEl.querySelectorAll('[data-kexo-color-input]');
            for (var i = 0; i < inputs.length; i++) {
              var el = inputs[i];
              if (!el || el.__kexoColorPreviewBound) continue;
              el.__kexoColorPreviewBound = 1;
              (function (inputEl) {
                var sync = function () { syncColorPreview(inputEl); };
                try { inputEl.addEventListener('input', sync); } catch (_) {}
                try { inputEl.addEventListener('change', sync); } catch (_) {}
                sync();
              })(el);
            }
          } catch (_) {}
        }
        bindColorPreviews();

        function modeSupportsFillOpacity(modeVal) {
          var m = String(modeVal || '').trim().toLowerCase();
          return (m !== 'map');
        }

        function fillOpacityLabelForMode(modeVal) {
          var m = String(modeVal || '').trim().toLowerCase();
          if (m.indexOf('map') === 0) return 'Map region opacity';
          if (m === 'stacked-area') return 'Stacked area opacity';
          if (m === 'area') return 'Area fill opacity';
          if (m === 'stacked-bar') return 'Stacked bar opacity';
          if (m === 'bar') return 'Bar opacity';
          if (m === 'line' || m === 'multi-line-labels') return 'Line opacity';
          if (m === 'pie' || m === 'donut') return 'Slice opacity';
          if (m === 'radialbar') return 'Ring opacity';
          return 'Series opacity';
        }

        function bindFillOpacityControls() {
          var input = bodyEl.querySelector('[data-cs-field="fillOpacity"]');
          var valueEl = bodyEl.querySelector('[data-cs-fill-opacity-value]');
          if (!input) return;
          function sync() {
            var raw = parseInt(String(input.value || ''), 10);
            if (!Number.isFinite(raw)) raw = fillOpacityPct;
            raw = Math.max(0, Math.min(100, raw));
            try { input.value = String(raw); } catch (_) {}
            if (valueEl) valueEl.textContent = raw + '%';
          }
          try { input.addEventListener('input', sync); } catch (_) {}
          try { input.addEventListener('change', sync); } catch (_) {}
          sync();
        }

        function bindInactiveOpacityControls() {
          var input = bodyEl.querySelector('[data-cs-field="mapInactiveOpacity"]');
          var valueEl = bodyEl.querySelector('[data-cs-inactive-opacity-value]');
          if (!input) return;
          function sync() {
            var raw = parseInt(String(input.value || ''), 10);
            if (!Number.isFinite(raw)) raw = 9;
            raw = Math.max(0, Math.min(100, raw));
            try { input.value = String(raw); } catch (_) {}
            if (valueEl) valueEl.textContent = raw + '%';
          }
          try { input.addEventListener('input', sync); } catch (_) {}
          try { input.addEventListener('change', sync); } catch (_) {}
          sync();
        }

        function bindPieLabelControls() {
          var posEl = bodyEl.querySelector('[data-cs-field="pieLabelPosition"]');
          var offEl = bodyEl.querySelector('[data-cs-field="pieLabelOffset"]');
          var valueEl = bodyEl.querySelector('[data-cs-pie-label-offset-value]');
          if (!posEl || !offEl) return;
          function clampOffsetForPosition(raw, pos) {
            var n = parseInt(String(raw == null ? '' : raw), 10);
            if (!Number.isFinite(n)) n = pieLabelOffset;
            n = Math.round(Math.max(-40, Math.min(40, n)));
            var p = String(pos || '').trim().toLowerCase();
            if (p === 'outside') n = Math.max(6, n);
            if (p === 'inside') n = Math.min(0, n);
            return n;
          }
          function sync() {
            var pos = String(posEl.value || '').trim().toLowerCase();
            if (pos !== 'auto' && pos !== 'inside' && pos !== 'outside') pos = 'auto';
            try { posEl.value = pos; } catch (_) {}
            var next = clampOffsetForPosition(offEl.value, pos);
            try { offEl.value = String(next); } catch (_) {}
            if (valueEl) valueEl.textContent = String(next) + 'px';
          }
          try { posEl.addEventListener('change', sync); } catch (_) {}
          try { offEl.addEventListener('input', sync); } catch (_) {}
          try { offEl.addEventListener('change', sync); } catch (_) {}
          sync();
        }

        function bindCapabilityRangeControls() {
          try {
            var inputs = bodyEl.querySelectorAll('input[type="range"][data-cs-range-unit]');
            for (var i = 0; i < inputs.length; i++) {
              var inp = inputs[i];
              if (!inp || inp.__kexoRangeBound) continue;
              inp.__kexoRangeBound = 1;
              (function (el) {
                var field = el.getAttribute('data-cs-field') || '';
                var unit = el.getAttribute('data-cs-range-unit') || '';
                function sync() {
                  var span = bodyEl.querySelector('[data-cs-range-value="' + field + '"]');
                  if (!span) return;
                  span.textContent = String(el.value || '') + (unit ? String(unit) : '');
                }
                try { el.addEventListener('input', sync); } catch (_) {}
                try { el.addEventListener('change', sync); } catch (_) {}
                sync();
              })(inp);
            }
          } catch (_) {}
        }

        function syncModeControls(modeVal) {
          var m = String(modeVal || '').trim().toLowerCase();
          var fillWrap = bodyEl.querySelector('[data-cs-mode-group="fill-opacity"]');
          if (fillWrap) {
            if (modeSupportsFillOpacity(m)) fillWrap.classList.remove('d-none');
            else fillWrap.classList.add('d-none');
            var labelEl = fillWrap.querySelector('[data-cs-fill-opacity-label]');
            if (labelEl) labelEl.textContent = fillOpacityLabelForMode(m);
          }
          var pieWrap = bodyEl.querySelector('[data-cs-mode-group="pie-labels"]');
          if (pieWrap) {
            if (supportsPieLabels && (m === 'pie' || m === 'donut')) pieWrap.classList.remove('d-none');
            else pieWrap.classList.add('d-none');
          }
          var finishesWrap = bodyEl.querySelector('[data-cs-mode-group="finishes-center-label"]');
          if (finishesWrap) {
            if (m === 'radialbar') finishesWrap.classList.remove('d-none');
            else finishesWrap.classList.add('d-none');
          }
          try {
            var modeWraps = bodyEl.querySelectorAll('[data-cs-modes]');
            for (var i = 0; i < modeWraps.length; i++) {
              var w = modeWraps[i];
              if (!w || !w.getAttribute) continue;
              var raw = String(w.getAttribute('data-cs-modes') || '');
              var allowed = raw.split(',').map(function (x) { return String(x || '').trim().toLowerCase(); }).filter(Boolean);
              if (!allowed.length) continue;
              if (allowed.indexOf(m) >= 0) w.classList.remove('d-none');
              else w.classList.add('d-none');
            }
          } catch (_) {}
        }

        bindFillOpacityControls();
        bindInactiveOpacityControls();
        bindPieLabelControls();
        bindCapabilityRangeControls();
        syncModeControls(mode);
        try {
          var modeSelect = bodyEl.querySelector('[data-cs-field="mode"]');
          if (modeSelect) modeSelect.addEventListener('change', function () { syncModeControls(modeSelect.value); });
        } catch (_) {}

        function readForm() {
          var modeEl = bodyEl.querySelector('[data-cs-field="mode"]');
          var sizeEl = bodyEl.querySelector('[data-cs-field="sizePercent"]');
          var animEl = bodyEl.querySelector('[data-cs-field="animations"]');
          var iconsEl = supportsIcons ? bodyEl.querySelector('[data-cs-field="icons"]') : null;
          var centerEl = isFinishes ? bodyEl.querySelector('[data-cs-field="radialCenterLabel"]') : null;
          var piePosEl = supportsPieLabels ? bodyEl.querySelector('[data-cs-field="pieLabelPosition"]') : null;
          var pieOffEl = supportsPieLabels ? bodyEl.querySelector('[data-cs-field="pieLabelOffset"]') : null;
          var styleBase = {};
          try {
            if (s && s.style && typeof s.style === 'object') styleBase = Object.assign({}, s.style);
          } catch (_) { styleBase = {}; }
          if (animEl) styleBase.animations = !!animEl.checked;
          if (supportsIcons) styleBase.icons = !!(iconsEl && iconsEl.checked);
          if (isFinishes) styleBase.radialCenterLabel = !!(centerEl && centerEl.checked);
          if (piePosEl) {
            var pp = String(piePosEl.value || '').trim().toLowerCase();
            if (pp !== 'auto' && pp !== 'inside' && pp !== 'outside') pp = 'auto';
            styleBase.pieLabelPosition = pp;
          }
          if (pieOffEl) {
            var po = parseInt(String(pieOffEl.value || ''), 10);
            if (Number.isFinite(po)) {
              po = Math.round(Math.max(-40, Math.min(40, po)));
              var refPos = (styleBase && styleBase.pieLabelPosition) ? String(styleBase.pieLabelPosition).trim().toLowerCase() : 'auto';
              if (refPos === 'outside') po = Math.max(6, po);
              if (refPos === 'inside') po = Math.min(0, po);
              styleBase.pieLabelOffset = po;
            }
          }
          var fillEl = bodyEl.querySelector('[data-cs-field="fillOpacity"]');
          if (fillEl) {
            var raw = parseInt(String(fillEl.value || ''), 10);
            if (Number.isFinite(raw)) styleBase.fillOpacity = Math.max(0, Math.min(1, raw / 100));
          }
          try {
            (capControls || []).forEach(function (c) {
              if (!c || typeof c !== 'object') return;
              var type = c.type != null ? String(c.type).trim().toLowerCase() : '';
              var field = c.field != null ? String(c.field).trim() : '';
              if (!type || !field) return;
              var el = bodyEl.querySelector('[data-cs-field="' + field + '"]');
              if (!el) return;
              if (type === 'select') {
                var sv = el.value != null ? String(el.value).trim().toLowerCase() : '';
                if (sv) styleBase[field] = sv;
              } else if (type === 'range') {
                var min = Number(c.min);
                var max = Number(c.max);
                var step = Number(c.step);
                if (!Number.isFinite(min)) min = 0;
                if (!Number.isFinite(max)) max = 100;
                if (!Number.isFinite(step) || step <= 0) step = 1;
                var n = Number(el.value);
                if (!Number.isFinite(n)) n = Number(c.default);
                if (!Number.isFinite(n)) n = min;
                if (n < min) n = min;
                if (n > max) n = max;
                // Keep a stable precision for decimals (e.g. strokeWidth step=0.1).
                var decimals = (String(step).indexOf('.') >= 0) ? String(step).split('.')[1].length : 0;
                if (decimals > 0) n = Number(n.toFixed(Math.min(4, decimals)));
                else n = Math.round(n);
                styleBase[field] = n;
              } else if (type === 'toggle') {
                var checked = !!(el && el.checked);
                var invert = !!(c.invert === true) || (el.getAttribute && el.getAttribute('data-cs-invert') === '1');
                styleBase[field] = invert ? !checked : checked;
              }
            });
          } catch (_) {}
          var out = {
            key: chartKey,
            mode: (modeEl && modeEl.value) ? String(modeEl.value).trim().toLowerCase() : mode,
            sizePercent: sizeEl ? parseInt(sizeEl.value, 10) : 100,
            style: styleBase,
            colors: (s.colors && Array.isArray(s.colors)) ? s.colors.slice() : (meta.series && meta.series.length ? ['#3eb3ab', '#ef4444', '#2fb344', '#d63939'].slice(0, meta.series.length) : ['#3eb3ab']),
          };
          if (isMapChart) {
            var mapAccentEl = bodyEl.querySelector('[data-cs-field="map-accent"]');
            var mapFitEl = bodyEl.querySelector('[data-cs-field="mapFit"]');
            function normalizeHexOpt(v) {
              var r = (v == null ? '' : String(v)).trim().toLowerCase();
              if (!r) return '';
              if (/^#[0-9a-f]{6}$/.test(r)) return r;
              if (r.length === 6 && /^[0-9a-f]{6}$/i.test(r)) return '#' + r;
              return '';
            }
            if (mapAccentEl) {
              var acc = normalizeHexOpt(mapAccentEl.value);
              if (acc) out.colors[0] = acc;
            }
            if (mapFitEl) {
              var mf = String(mapFitEl.value || '').trim().toLowerCase();
              if (mf !== 'cover' && mf !== 'contain') mf = 'cover';
              styleBase.mapFit = mf;
            }
            var inactiveOpacityEl = bodyEl.querySelector('[data-cs-field="mapInactiveOpacity"]');
            if (inactiveOpacityEl) {
              var rawOp = parseInt(String(inactiveOpacityEl.value || ''), 10);
              if (Number.isFinite(rawOp)) styleBase.mapInactiveOpacity = Math.max(0, Math.min(1, rawOp / 100));
            }
            var inactiveColorEl = bodyEl.querySelector('[data-cs-field="mapInactiveColor"]');
            if (inactiveColorEl) styleBase.mapInactiveColor = normalizeHexOpt(inactiveColorEl.value) || '';
            ['mapStageBrowseColor', 'mapStageCartColor', 'mapStageCheckoutColor', 'mapStagePurchaseColor'].forEach(function (field) {
              var el = bodyEl.querySelector('[data-cs-field="' + field + '"]');
              if (!el) return;
              var v = normalizeHexOpt(el.value);
              styleBase[field] = v || '';
            });
          }
          if (isOverview) {
            var revEl = bodyEl.querySelector('[data-cs-field="color-revenue"]');
            var costEl = bodyEl.querySelector('[data-cs-field="color-cost"]');
            var posEl = bodyEl.querySelector('[data-cs-field="color-profitPos"]');
            var negEl = bodyEl.querySelector('[data-cs-field="color-profitNeg"]');
            var hex = function (v) { var r = (v == null ? '' : String(v)).trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(r) ? r : (r.length === 6 && /^[0-9a-f]{6}$/i.test(r) ? '#' + r : null); };
            if (revEl && hex(revEl.value)) out.colors[0] = hex(revEl.value) || out.colors[0];
            if (costEl && hex(costEl.value)) out.colors[1] = hex(costEl.value) || out.colors[1];
            if (posEl && hex(posEl.value)) out.colors[2] = hex(posEl.value) || out.colors[2];
            if (negEl && hex(negEl.value)) out.colors[3] = hex(negEl.value) || out.colors[3];
          }
          return out;
        }

        if (!saveBtn) return;
        saveBtn.replaceWith(saveBtn.cloneNode(true));
        document.getElementById(MODAL_ID + '-save').addEventListener('click', function () {
          var payload = readForm();
          setMsg('Saving…', null);
          fetch(API + '/api/chart-settings/' + encodeURIComponent(chartKey), {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings: payload }),
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data && data.ok && data.chartsUiConfig) {
                // Server response is the only source of truth post-save.
                writeChartsUiConfigCacheFromServer(data.chartsUiConfig);
                try { window.dispatchEvent(new CustomEvent('kexo:chartsUiConfigUpdated', { detail: data.chartsUiConfig })); } catch (_) {}
                setMsg('Saved.', true);
                closeModal();
              } else {
                setMsg((data && data.error) ? String(data.error) : 'Save failed', false);
              }
            })
            .catch(function () { setMsg('Save failed', false); });
        });
      })
      .catch(function () {
        // Ignore aborts (close/back) to avoid showing a spurious error.
        try {
          if (inFlight && inFlight.controller && inFlight.controller.signal && inFlight.controller.signal.aborted) return;
        } catch (_) {}
        setMsg('Could not load settings.', false);
        if (bodyEl) bodyEl.innerHTML = '<div class="text-muted">Could not load settings.</div>';
      });
  }

  if (typeof window !== 'undefined') {
    window.KexoChartSettingsBuilder = { openModal: openModal };
  }

  var bound = false;
  function initDelegation() {
    try {
      if (document && document.documentElement && document.documentElement.getAttribute('data-kexo-chart-settings-delegation') === '1') {
        bound = true;
        return;
      }
    } catch (_) {}
    if (bound) return;
    bound = true;
    try {
      if (document && document.documentElement) document.documentElement.setAttribute('data-kexo-chart-settings-delegation', '1');
    } catch (_) {}
    function safeClosest(node, selector) {
      try {
        var el = node && node.nodeType === 1 ? node : (node && node.parentElement ? node.parentElement : null);
        while (el && el !== document && el.nodeType === 1) {
          if (el.matches && el.matches(selector)) return el;
          el = el.parentElement;
        }
      } catch (_) {}
      return null;
    }
    function handleSettingsTrigger(e) {
      if (!e || !e.target) return;
      if (e.__kexoChartSettingsHandled) return;
      // Some embed contexts can interfere with "click". Pointer events are more reliable.
      try {
        if (e.type === 'pointerup') {
          var pt = String(e.pointerType || '').toLowerCase();
          if (pt === 'mouse' && e.button !== 0) return;
        }
      } catch (_) {}
      // Only trigger when clicking an actual settings control (not anywhere inside a chart card).
      var hit = safeClosest(e.target,
        '[data-kexo-chart-settings-key],' +
        '.kexo-overview-chart-settings-btn,' +
        '.kexo-builder-icon-link[data-kexo-chart-settings-key],' +
        '.kexo-builder-icon-link[aria-label="Chart settings"],' +
        '.kexo-builder-icon-link[title="Chart settings"]'
      );
      if (!hit) return;

      var chartKey = '';
      try {
        chartKey = String(hit.getAttribute('data-kexo-chart-settings-key') || '').trim();
      } catch (_) { chartKey = ''; }
      if (!chartKey) {
        try { chartKey = String(hit.getAttribute('data-kexo-chart-key') || hit.getAttribute('data-chart-key') || '').trim(); } catch (_) { chartKey = ''; }
      }
      if (!chartKey) {
        try {
          var wrap = hit.closest ? hit.closest('[data-kexo-chart-key],[data-chart-key]') : null;
          chartKey = wrap ? String(wrap.getAttribute('data-kexo-chart-key') || wrap.getAttribute('data-chart-key') || '').trim() : '';
        } catch (_) { chartKey = ''; }
      }
      if (!chartKey) return;
      e.preventDefault();
      try { e.__kexoChartSettingsHandled = true; } catch (_) {}
      try { if (typeof e.stopPropagation === 'function') e.stopPropagation(); } catch (_) {}
      var title = '';
      try {
        var card = hit.closest ? hit.closest('.card') : null;
        var titleEl = card ? card.querySelector('.card-title,.subheader') : null;
        title = titleEl && titleEl.textContent ? String(titleEl.textContent).trim() : '';
      } catch (_) { title = ''; }
      openModal({ chartKey: chartKey, cardTitle: title || chartKey });
    }
    // Capture phase so we still handle clicks even if other handlers stop propagation.
    document.addEventListener('click', handleSettingsTrigger, true);
    try { document.addEventListener('pointerup', handleSettingsTrigger, true); } catch (_) {}
  }

  // Bind immediately (safe even while DOM is still loading).
  initDelegation();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDelegation);
  }
})();
