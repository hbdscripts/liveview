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
    try {
      if (window.bootstrap && window.bootstrap.Modal) {
        var inst = window.bootstrap.Modal.getInstance(modal);
        if (inst) inst.hide();
      }
    } catch (_) {}
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
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
        var isOverview = chartKey === 'dash-chart-overview-30d';
        var colors = (s.colors && Array.isArray(s.colors)) ? s.colors : (meta.series && meta.series.length ? ['#3eb3ab', '#ef4444', '#2fb344', '#d63939'].slice(0, meta.series.length) : ['#3eb3ab']);
        var rev = (isOverview && colors[0]) ? colors[0] : '#3eb3ab';
        var cost = (isOverview && colors[1]) ? colors[1] : '#ef4444';
        var profitPos = (isOverview && colors[2]) ? colors[2] : '#2fb344';
        var profitNeg = (isOverview && colors[3]) ? colors[3] : '#d63939';

        var body = '';
        body += '<div class="row g-3">';
        body += '<div class="col-12 col-md-6"><label class="form-label">Chart type</label><select class="form-select form-select-sm" data-cs-field="mode">' + modeOptionsHtml(modes, mode) + '</select></div>';
        body += '<div class="col-12 col-md-6"><label class="form-label">Size (% of container)</label><select class="form-select form-select-sm" data-cs-field="sizePercent">';
        for (var p = 25; p <= 100; p += 5) {
          body += '<option value="' + p + '"' + (p === size ? ' selected' : '') + '>' + p + '%</option>';
        }
        body += '</select></div>';
        body += '<div class="col-12"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-cs-field="animations"' + (animations ? ' checked' : '') + '><span class="form-check-label ms-2">Animations</span></label></div>';
        if (supportsIcons) {
          body += '<div class="col-12"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-cs-field="icons"' + (iconsEnabled ? ' checked' : '') + '><span class="form-check-label ms-2">Icons</span></label><div class="form-hint">Show source icons in the chart legend.</div></div>';
        }
        if (isOverview) {
          body += '<div class="col-12"><label class="form-label">Colours</label><div class="row g-2">';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Revenue</label><input type="text" class="form-control form-control-sm" data-cs-field="color-revenue" value="' + escapeHtml(rev) + '" placeholder="#3eb3ab"></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Cost</label><input type="text" class="form-control form-control-sm" data-cs-field="color-cost" value="' + escapeHtml(cost) + '" placeholder="#ef4444"></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Profit (positive)</label><input type="text" class="form-control form-control-sm" data-cs-field="color-profitPos" value="' + escapeHtml(profitPos) + '" placeholder="#2fb344"></div>';
          body += '<div class="col-6 col-md-3"><label class="form-label small">Profit (negative)</label><input type="text" class="form-control form-control-sm" data-cs-field="color-profitNeg" value="' + escapeHtml(profitNeg) + '" placeholder="#d63939"></div>';
          body += '</div></div>';
        }
        body += '</div>';

        bodyEl.innerHTML = body;
        bodyEl.setAttribute('data-cs-chart-key', chartKey);
        setMsg('', null);

        function readForm() {
          var modeEl = bodyEl.querySelector('[data-cs-field="mode"]');
          var sizeEl = bodyEl.querySelector('[data-cs-field="sizePercent"]');
          var animEl = bodyEl.querySelector('[data-cs-field="animations"]');
          var iconsEl = supportsIcons ? bodyEl.querySelector('[data-cs-field="icons"]') : null;
          var styleBase = {};
          try {
            if (s && s.style && typeof s.style === 'object') styleBase = Object.assign({}, s.style);
          } catch (_) { styleBase = {}; }
          styleBase.animations = !!(animEl && animEl.checked);
          if (supportsIcons) styleBase.icons = !!(iconsEl && iconsEl.checked);
          var out = {
            key: chartKey,
            mode: (modeEl && modeEl.value) ? String(modeEl.value).trim().toLowerCase() : mode,
            sizePercent: sizeEl ? parseInt(sizeEl.value, 10) : 100,
            style: styleBase,
            colors: (s.colors && Array.isArray(s.colors)) ? s.colors.slice() : (meta.series && meta.series.length ? ['#3eb3ab', '#ef4444', '#2fb344', '#d63939'].slice(0, meta.series.length) : ['#3eb3ab']),
          };
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
    // Capture phase so we still handle clicks even if other handlers stop propagation.
    document.addEventListener('click', function (e) {
      if (!e || !e.target) return;
      if (e.__kexoChartSettingsHandled) return;
      // 1) Prefer explicit settings key on the cog/button.
      // 2) Fallback to explicit chart key on the element.
      // 3) Final fallback: nearest wrapper with data-kexo-chart-key / data-chart-key.
      var hit = safeClosest(e.target,
        '[data-kexo-chart-settings-key],.kexo-overview-chart-settings-btn,' +
        '[data-chart-key],[data-kexo-chart-key]'
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
    }, true);
  }

  // Bind immediately (safe even while DOM is still loading).
  initDelegation();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDelegation);
  }
})();
