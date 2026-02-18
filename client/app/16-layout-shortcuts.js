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
    if (window.KexoChartSettingsBuilder && typeof window.KexoChartSettingsBuilder.openModal === 'function') {
      window.KexoChartSettingsBuilder.openModal(opts);
    }
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
    };
  } catch (_) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalClose);
  } else {
    initModalClose();
  }
})();
