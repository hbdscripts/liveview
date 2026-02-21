      function run() {
        var mounts = document.querySelectorAll('[data-kexo-table]');
        if (!mounts.length) return;
        var build = typeof window.buildKexoGridTable === 'function' ? window.buildKexoGridTable : null;
        var buildNative = typeof window.buildKexoNativeTable === 'function' ? window.buildKexoNativeTable : null;
        var defs = window.KEXO_TABLE_DEFS;
        var nativeDefs = window.KEXO_NATIVE_TABLE_DEFS;
        if (!build && !buildNative) return;
        mounts.forEach(function (mount) {
          var tableId = mount.getAttribute('data-kexo-table');
          if (!tableId) return;
          var def = defs && defs[tableId];
          var nativeDef = nativeDefs && nativeDefs[tableId];
          if (def && build) {
            // Live View: hide Exit column only on /dashboard/live.
            var cols = Array.isArray(def.columns) ? def.columns.slice() : [];
            try {
              if (String(PAGE || '').trim().toLowerCase() === 'live' && String(tableId || '').trim().toLowerCase() === 'sessions-table') {
                cols = cols.filter(function (c) {
                  var k = c && c.key != null ? String(c.key).trim().toLowerCase() : '';
                  return k !== 'exit';
                });
              }
            } catch (_) {}
            var config = Object.assign({}, def, {
              tableId: tableId,
              wrapId: (mount.id || tableId + '-mount') + '-wrap',
              bodyId: def.bodyId || tableId + '-body',
              columns: cols
            });
            mount.outerHTML = build(config);
          } else if (nativeDef && buildNative) {
            var dashTopListIds = ['dash-top-products', 'dash-top-countries', 'dash-trending'];
            if (dashTopListIds.indexOf(tableId) >= 0) {
              var wrapId = tableId + '-wrap';
              var bodyId = tableId + '-body';
              mount.outerHTML = '<div id="' + wrapId + '"><div id="' + bodyId + '" class="kexo-dash-top-list" role="list" aria-label="' + (tableId.replace(/-/g, ' ') + ' list') + '"></div></div>';
            } else {
              var nativeConfig = Object.assign({}, nativeDef, { tableId: tableId });
              mount.outerHTML = buildNative(nativeConfig);
            }
          }
        });
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
    })();

    const tableRowsCache = {};
    const TABLES_UI_CFG_LS_KEY = 'kexo:tables-ui-config:v1';
    var tablesUiConfigV1 = null;

    // Hydrate table layout/pagination prefs from localStorage for first paint.
    try {
      var cachedTables = safeReadLocalStorageJson(TABLES_UI_CFG_LS_KEY);
      if (cachedTables && cachedTables.v === 1 && Array.isArray(cachedTables.pages)) {
        tablesUiConfigV1 = cachedTables;
        try { window.__kexoTablesUiConfigV1 = cachedTables; } catch (_) {}
      }
    } catch (_) {}

    function normalizeUiPageKey(key) {
      var k = String(key == null ? '' : key).trim().toLowerCase();
      return k || '';
    }

    function normalizeUiTableId(id) {
      return String(id == null ? '' : id).trim().toLowerCase();
    }

    function getTablesUiPageCfg(pageKey) {
      var cfg = tablesUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.pages)) return null;
      var pk = normalizeUiPageKey(pageKey || PAGE);
      if (!pk) return null;
      for (var i = 0; i < cfg.pages.length; i++) {
        var p = cfg.pages[i];
        if (!p || typeof p !== 'object') continue;
        var k = p.key != null ? normalizeUiPageKey(p.key) : '';
        if (k && k === pk) return p;
      }
      return null;
    }

    function resolveVariantsTableId(tableId, pageKey) {
      var id = String(tableId == null ? '' : tableId).trim().toLowerCase();
      var pk = normalizeUiPageKey(pageKey || PAGE);
      if (id.indexOf('variants-table-') === 0 && pk === 'variants') return 'insights-variants-tables';
      return id;
    }
    function getTablesUiTableCfg(tableId, pageKey) {
      var p = getTablesUiPageCfg(pageKey || PAGE);
      if (!p || !Array.isArray(p.tables)) return null;
      var id = normalizeUiTableId(resolveVariantsTableId(tableId, pageKey));
      if (!id) return null;
      for (var i = 0; i < p.tables.length; i++) {
        var t = p.tables[i];
        if (!t || typeof t !== 'object') continue;
        var tid = t.id != null ? normalizeUiTableId(t.id) : '';
        if (tid && tid === id) return t;
      }
      return null;
    }

    function tablesUiConfigSignature(cfg) {
      try { return JSON.stringify(cfg || null); } catch (_) { return ''; }
    }

    function applyTablesUiConfigV1(cfg) {
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1 || !Array.isArray(cfg.pages)) return false;
      var prevSig = tablesUiConfigSignature(tablesUiConfigV1);
      var nextSig = tablesUiConfigSignature(cfg);
      tablesUiConfigV1 = cfg;
      try { window.__kexoTablesUiConfigV1 = cfg; } catch (_) {}
      try { safeWriteLocalStorageJson(TABLES_UI_CFG_LS_KEY, cfg); } catch (_) {}
      try {
        Object.keys(tableRowsCache).forEach(function (k) { delete tableRowsCache[k]; });
      } catch (_) {}
      var changed = prevSig !== nextSig;
      if (changed) {
        try { syncDashboardTableRowsOverridesFromUiConfig(cfg); } catch (_) {}
      }
      return changed;
    }

    function syncDashboardTableRowsOverridesFromUiConfig(cfg) {
      // Dashboard tables are frequently configured in Settings/Modals, but a stale per-table localStorage
      // override can take precedence and make "Default rows" appear ignored. When the UI config changes,
      // sync dashboard table row overrides to the configured defaults so the saved setting wins.
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.pages)) return;
      var dashPage = null;
      for (var i = 0; i < cfg.pages.length; i++) {
        var p = cfg.pages[i];
        if (!p || typeof p !== 'object') continue;
        if (normalizeUiPageKey(p.key) === 'dashboard') { dashPage = p; break; }
      }
      if (!dashPage || !Array.isArray(dashPage.tables)) return;

      dashPage.tables.forEach(function (t) {
        if (!t || typeof t !== 'object') return;
        var tableId = t.id != null ? normalizeUiTableId(t.id) : '';
        if (!tableId) return;
        var classKey = getTableClassByTableId(tableId, 'dashboard');
        if (classKey !== 'dashboard') return;
        if (!t.rows || typeof t.rows !== 'object') return;

        var defaultRows = t.rows.default;
        if (typeof defaultRows !== 'number' || !Number.isFinite(defaultRows)) return;
        defaultRows = Math.round(defaultRows);
        if (defaultRows <= 0 || defaultRows > 200) return;

        var rowOptions = null;
        var opts = Array.isArray(t.rows.options) ? t.rows.options : null;
        if (opts && opts.length) {
          var seen = {};
          var normalized = [];
          opts.forEach(function (n) {
            var x = Math.round(Number(n));
            if (!Number.isFinite(x) || x <= 0 || x > 200) return;
            if (seen[x]) return;
            seen[x] = true;
            normalized.push(x);
          });
          normalized.sort(function (a, b) { return a - b; });
          if (normalized.length) rowOptions = normalized.slice(0, 12);
        }
        if (!rowOptions || !rowOptions.length) {
          var fallback = tableClassConfig('dashboard');
          rowOptions = Array.isArray(fallback && fallback.rowOptions) ? fallback.rowOptions.slice() : [5, 10];
        }
        if (rowOptions.indexOf(defaultRows) < 0) {
          var nearest = rowOptions[0];
          var nearestDiff = Math.abs(nearest - defaultRows);
          for (var j = 1; j < rowOptions.length; j++) {
            var diff = Math.abs(rowOptions[j] - defaultRows);
            if (diff < nearestDiff) {
              nearest = rowOptions[j];
              nearestDiff = diff;
            }
          }
          defaultRows = nearest;
        }

        tableRowsCache[tableId] = defaultRows;
        try { localStorage.setItem(tableRowsStorageKey(tableId), String(defaultRows)); } catch (_) {}
      });
    }

    function tableRowsConfigForTableId(tableId, classKey) {
      var cfg = tableClassConfig(classKey);
      var defaultRows = cfg && typeof cfg.defaultRows === 'number' ? cfg.defaultRows : 20;
      var rowOptions = Array.isArray(cfg && cfg.rowOptions) ? cfg.rowOptions.slice() : [defaultRows];

      var ui = getTablesUiTableCfg(tableId, PAGE);
      if (ui && ui.rows && typeof ui.rows === 'object') {
        var opts = Array.isArray(ui.rows.options) ? ui.rows.options : null;
        if (opts && opts.length) {
          var seen = {};
          var normalized = [];
          opts.forEach(function (n) {
            var x = Math.round(Number(n));
            if (!Number.isFinite(x) || x <= 0 || x > 200) return;
            if (seen[x]) return;
            seen[x] = true;
            normalized.push(x);
          });
          normalized.sort(function (a, b) { return a - b; });
          if (normalized.length) rowOptions = normalized.slice(0, 12);
        }
        var dr = ui.rows.default;
        if (typeof dr === 'number' && Number.isFinite(dr)) defaultRows = Math.round(dr);
      }

      if (!rowOptions.length) rowOptions = [defaultRows];
      if (rowOptions.indexOf(defaultRows) < 0) {
        // Pick nearest allowed option for robustness.
        var nearest = rowOptions[0];
        var nearestDiff = Math.abs(nearest - defaultRows);
        for (var i = 1; i < rowOptions.length; i++) {
          var d = Math.abs(rowOptions[i] - defaultRows);
          if (d < nearestDiff) {
            nearest = rowOptions[i];
            nearestDiff = d;
          }
        }
        defaultRows = nearest;
      }

      return { defaultRows: defaultRows, rowOptions: rowOptions };
    }

    function syncPageBodyLoaderOffset(scope) {
      try {
        if (!scope || !scope.classList || !scope.classList.contains('page-body')) return;
        var rect = scope.getBoundingClientRect ? scope.getBoundingClientRect() : null;
        var top = rect && Number.isFinite(rect.top) ? Math.max(0, Math.round(rect.top)) : 0;
        scope.style.setProperty('--kexo-loader-page-top', String(top) + 'px');
      } catch (_) {}
    }

    (function primePageBodyLoader() {
      // Default behavior: keep content visible and avoid global overlay on initial load.
      var pageBody = document.querySelector('.page-body');
      var overlay = document.getElementById('page-body-loader');
      if (!pageBody || !overlay) return;
      syncPageBodyLoaderOffset(pageBody);
      pageBody.classList.remove('report-building');
      overlay.classList.add('is-hidden');
    })();

    function normalizeTableClass(classKey) {
      var key = String(classKey == null ? '' : classKey).trim().toLowerCase();
      if (key && TABLE_CLASS_CONFIG[key]) return key;
      return 'live';
    }

    function tableClassConfig(classKey) {
      return TABLE_CLASS_CONFIG[normalizeTableClass(classKey)] || TABLE_CLASS_CONFIG.live;
    }

    function clampTableRows(value, tableId, classKey) {
      var cfg = tableRowsConfigForTableId(tableId, classKey);
      var opts = Array.isArray(cfg && cfg.rowOptions) ? cfg.rowOptions : [cfg.defaultRows];
      var n = Number(value);
      if (!Number.isFinite(n)) return cfg.defaultRows;
      n = Math.round(n);
      if (opts.indexOf(n) >= 0) return n;
      // Pick nearest allowed option for robustness against stale values.
      var nearest = opts[0];
      var nearestDiff = Math.abs(nearest - n);
      for (var i = 1; i < opts.length; i++) {
        var d = Math.abs(opts[i] - n);
        if (d < nearestDiff) {
          nearest = opts[i];
          nearestDiff = d;
        }
      }
      return nearest;
    }

    function inferTableIdFromCard(card) {
      if (!card || !card.querySelector) return '';
      if (card.dataset && card.dataset.tableId) return String(card.dataset.tableId).trim();
      var el = card.querySelector('table[id], .grid-table[id], [id="ads-root"]');
      return el && el.id ? String(el.id).trim() : '';
    }

    function findTableCardById(tableId) {
      var id = String(tableId == null ? '' : tableId).trim();
      if (!id || !document || !document.querySelector) return null;
      var byCardAttr = document.querySelector('.card[data-table-id="' + id + '"]');
      if (byCardAttr) return byCardAttr;
      var tableEl = document.getElementById(id);
      if (!tableEl || !tableEl.closest) return null;
      return tableEl.closest('.card');
    }

    function applyTablesUiLayoutForPage() {
      try {
        if (String(PAGE || '').toLowerCase() === 'settings') return;
        var pageCfg = getTablesUiPageCfg(PAGE);
        if (!pageCfg || !Array.isArray(pageCfg.tables)) return;

        // Titles (opt-in via data attr to avoid clobbering dynamic headers).
        pageCfg.tables.forEach(function (t) {
          if (!t || typeof t !== 'object') return;
          var tableId = t.id != null ? String(t.id).trim() : '';
          if (!tableId) return;
          var name = t.name != null ? String(t.name).trim() : '';
          if (!name) return;
          var card = findTableCardById(tableId);
          if (!card || !card.querySelector) return;
          var titleEl = card.querySelector('[data-kexo-table-title="1"]');
          if (!titleEl) return;
          titleEl.textContent = name;
        });

        function isBootstrapCol(el) {
          if (!el || !el.classList) return false;
          for (var i = 0; i < el.classList.length; i++) {
            var c = el.classList[i];
            if (c === 'col' || String(c).indexOf('col-') === 0) return true;
          }
          return false;
        }

        function setColWrapperFullWidth(colEl, full) {
          if (!colEl) return;
          var orig = colEl.getAttribute('data-kexo-orig-col-class');
          if (!orig) {
            try { colEl.setAttribute('data-kexo-orig-col-class', colEl.className || ''); } catch (_) {}
            orig = colEl.className || '';
          }
          if (!full) {
            colEl.className = orig;
            return;
          }
          var keep = [];
          String(orig || '').split(/\s+/g).filter(Boolean).forEach(function (cls) {
            if (cls === 'col' || String(cls).indexOf('col-') === 0) return;
            keep.push(cls);
          });
          keep.push('col-12');
          colEl.className = keep.join(' ');
        }

        // Per group (row/stats-row): order + grid/full width
        var groups = new Map();
        pageCfg.tables.forEach(function (t) {
          if (!t || typeof t !== 'object') return;
          var tableId = t.id != null ? String(t.id).trim() : '';
          if (!tableId) return;
          var card = findTableCardById(tableId);
          if (!card || !card.closest) return;

          var group = card.closest('.stats-row, .row');
          if (!group) return;

          var unit = card;
          try {
            if (group.classList && group.classList.contains('row') && card.parentElement && isBootstrapCol(card.parentElement) && card.parentElement.parentElement === group) {
              unit = card.parentElement;
            }
          } catch (_) {}

          var inGrid = !(t.inGrid === false);
          if (unit !== card) {
            // Bootstrap column wrapper
            setColWrapperFullWidth(unit, !inGrid);
          } else {
            // Flex/grid card
            card.classList.toggle('kexo-layout-full', !inGrid);
          }

          var list = groups.get(group) || [];
          list.push({ order: Number(t.order) || 0, unit: unit });
          groups.set(group, list);
        });

        groups.forEach(function (list, group) {
          if (!group || !Array.isArray(list) || list.length < 2) return;
          list.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
          list.forEach(function (it) {
            if (!it || !it.unit || !it.unit.parentElement) return;
            try { group.appendChild(it.unit); } catch (_) {}
          });
        });
      } catch (_) {}
    }

    (function primeTablesUiLayout() {
      try {
        if (!tablesUiConfigV1) return;
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function() {
            try { scheduleTablesUiApply(); } catch (_) {}
          });
        } else {
          scheduleTablesUiApply();
        }
      } catch (_) {}
    })();

    function getTableClassByTableId(tableId, fallbackClassKey) {
      var id = String(tableId == null ? '' : tableId).trim();
      var card = findTableCardById(id);
      if (card && card.dataset && card.dataset.tableClass) return normalizeTableClass(card.dataset.tableClass);
      if (id && TABLE_CLASS_FALLBACK_BY_ID[id]) return normalizeTableClass(TABLE_CLASS_FALLBACK_BY_ID[id]);
      return normalizeTableClass(fallbackClassKey || 'live');
    }

    function tableRowsStorageKey(tableId) {
      var id = String(tableId == null ? '' : tableId).trim().toLowerCase();
      var resolved = resolveVariantsTableId(id, PAGE);
      return TABLE_ROWS_STORAGE_PREFIX + ':' + (resolved || id);
    }

    function getTableRowsPerPage(tableId, fallbackClassKey) {
      var id = String(tableId == null ? '' : tableId).trim();
      if (!id) return tableClassConfig(fallbackClassKey || 'live').defaultRows;
      var resolved = resolveVariantsTableId(id, PAGE);
      if (Object.prototype.hasOwnProperty.call(tableRowsCache, id)) return tableRowsCache[id];
      var classKey = getTableClassByTableId(id, fallbackClassKey);
      var cfg = tableRowsConfigForTableId(resolved || id, classKey);
      var raw = null;
      // Dashboard tables: "Default rows" in UI config should always win.
      // Ignore stale persisted overrides (common cause of Trending Up/Down stuck at 10).
      if (classKey !== 'dashboard') {
        try { raw = localStorage.getItem(tableRowsStorageKey(id)); } catch (_) { raw = null; }
      }
      var value = clampTableRows(raw == null ? cfg.defaultRows : Number(raw), resolved || id, classKey);
      tableRowsCache[id] = value;
      return value;
    }

    function setTableRowsPerPage(tableId, rows, fallbackClassKey) {
      var id = String(tableId == null ? '' : tableId).trim();
      if (!id) return null;
      var resolved = resolveVariantsTableId(id, PAGE);
      var classKey = getTableClassByTableId(id, fallbackClassKey);
      var next = clampTableRows(rows, resolved || id, classKey);
      tableRowsCache[id] = next;
      try { localStorage.setItem(tableRowsStorageKey(id), String(next)); } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent('kexo:table-rows-changed', {
          detail: { tableId: id, rows: next, tableClass: classKey },
        }));
      } catch (_) {}
      try {
        if (typeof window.__kexoOnTableRowsPerPageChanged === 'function') {
          window.__kexoOnTableRowsPerPageChanged(id, next, classKey);
        }
      } catch (_) {}
      return next;
    }

    // Desktop date picker is mounted into the page header right slot.

    // Page progress bar (Tabler Turbo-style): refcount + width animation
    // Section strip (same height): always present; hidden while progress active
    var _progressEl = null;
    var _progressBarEl = null;
    var _sectionStripEl = null;
    var _progressActive = 0;
    var _progressHideTimer = null;
    function _ensureSectionStrip() {
      if (_sectionStripEl) return;
      _sectionStripEl = document.createElement('div');
      _sectionStripEl.className = 'kexo-section-strip';
      _sectionStripEl.setAttribute('aria-hidden', 'true');
      document.body.prepend(_sectionStripEl);
    }
    function _ensureProgress() {
      if (_progressEl) return;
      _ensureSectionStrip();
      _progressEl = document.createElement('div');
      _progressEl.className = 'page-progress';
      _progressEl.innerHTML = '<div class="page-progress-bar"></div>';
      document.body.prepend(_progressEl);
      _progressBarEl = _progressEl.querySelector('.page-progress-bar');
    }
    function showPageProgress() {
      _ensureProgress();
      _progressActive += 1;
      try { document.body.classList.add('kexo-page-progress-active'); } catch (_) {}
      _progressEl.classList.add('active');
      if (_progressBarEl) {
        _progressBarEl.style.width = '';
        _progressBarEl.offsetHeight;
        _progressBarEl.style.width = '70%';
      }
      if (_progressHideTimer) {
        clearTimeout(_progressHideTimer);
        _progressHideTimer = null;
      }
    }
    function hidePageProgress() {
      _progressActive = Math.max(0, _progressActive - 1);
      if (_progressActive > 0 || !_progressEl || !_progressBarEl) {
        if (_progressActive === 0) try { document.body.classList.remove('kexo-page-progress-active'); } catch (_) {}
        return;
      }
      _progressBarEl.style.width = '100%';
      _progressHideTimer = setTimeout(function() {
        _progressHideTimer = null;
        _progressEl.classList.remove('active');
        _progressBarEl.style.width = '0%';
        try { document.body.classList.remove('kexo-page-progress-active'); } catch (_) {}
      }, 200);
    }
    (function ensureLoaderAndStripOnBoot() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          _ensureProgress();
        });
      } else {
        _ensureProgress();
      }
    })();
    const LIVE_REFRESH_MS = 60000;
    const RANGE_REFRESH_MS = 5 * 60 * 1000; // Today and Sales refresh every 5 min
    const LIVE_SALES_POLL_MS = 10 * 1000; // Only /dashboard/live + /dashboard/sales poll automatically
    const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // Live view: only show sessions seen in last 5 min
    const ARRIVED_WINDOW_MS = 60 * 60 * 1000; // Live view: only show sessions that arrived in last 60 min
    const STATS_REFRESH_MS = 5 * 60 * 1000; // Breakdown / Products / Traffic refresh (Today only)
    const KPI_REFRESH_MS = 120000; // 2 min: reduce repeated KPI queries during fast nav
    const KPI_CACHE_TTL_MS = KPI_REFRESH_MS;
    const KPI_CACHE_STALE_OK_MS = 30 * 60 * 1000; // paint stale values while revalidating
    const KPI_EXTRAS_CACHE_TTL_MS = 30 * 60 * 1000;
    const KPI_EXTRAS_CACHE_STALE_OK_MS = 60 * 60 * 1000;
    const KPI_CACHE_LS_KEY = 'kexo-kpis-cache-v1';
    const KPI_EXTRAS_CACHE_LS_KEY = 'kexo-kpis-expanded-extra-cache-v1';
    const KPI_SPINNER_MIN_MS = 800;
    let kpisSpinnerShownOnce = false;
    let updateAvailable = false;
    const SALE_MUTED_KEY = 'livevisitors-sale-muted';
    const TOP_TABLE_PAGE_SIZE = 10;
    const COUNTRY_PAGE_SIZE = 20;
    const COUNTRY_PRODUCTS_PAGE_SIZE = 20;
    const BREAKDOWN_PAGE_SIZE = 25;
    const ROWS_PER_PAGE_DEFAULT = 20;
    function loadRowsPerPage() {
      return getTableRowsPerPage('sessions-table', 'live');
    }
    let rowsPerPage = loadRowsPerPage();
    let sessions = [];
    let sessionsLoadError = null;
    let statsCache = {};
    let attributionCache = null;
    let devicesCache = null;
    let browsersCache = null;
    // Acquisition ??? Attribution (tree/table + chart state)
    let attributionExpandedChannels = null; // null = first render, default all open
    let attributionExpandedSources = null; // null = first render, default all open
    let attributionChartInstance = null;
    let attributionChartData = null;
    // Acquisition ??? Devices (tree/table + chart state)
    let devicesExpanded = null; // null = first render, default all open
    let devicesChartInstance = null;
    let devicesChartData = null;
    let dateRange = PAGE === 'sales' ? 'sales' : PAGE === 'date' ? 'today' : PAGE === 'dashboard' ? 'today' : PAGE === 'abandoned-carts' ? 'today' : 'live';
    let customRangeStartYmd = null; // YYYY-MM-DD (admin TZ)
    let customRangeEndYmd = null; // YYYY-MM-DD (admin TZ)
    let pendingCustomRangeStartYmd = null; // modal-only pending selection
    let pendingCustomRangeEndYmd = null; // modal-only pending selection
    let customCalendarLastPayload = null; // last /api/available-days payload used for rendering
    const ABANDONED_MODE_LS_KEY = 'kexo:abandoned-mode:v1';
    let abandonedMode = 'cart'; // cart | checkout
    /** When dateRange is 'live' or 'sales', stats/KPIs use today's data; only the main table shows those special views. */
    function normalizeRangeKeyForApi(key) {
      const k = (key == null ? '' : String(key)).trim().toLowerCase();
      // UI uses friendly labels (7days/14days/30days) but APIs + server payload keys use 7d/14d/30d.
      if (k === '7days') return '7d';
      if (k === '14days') return '14d';
      if (k === '30days') return '30d';
      return k;
    }

    function normalizeAbandonedMode(value) {
      var s = value != null ? String(value).trim().toLowerCase() : '';
      if (s === 'checkout' || s === 'checkouts') return 'checkout';
      return 'cart';
    }

    function abandonedModeDisplayLabel(mode) {
      return normalizeAbandonedMode(mode) === 'checkout' ? 'Abandoned Checkouts' : 'Abandoned Carts';
    }

    function loadAbandonedMode() {
      var raw = '';
      try { raw = localStorage.getItem(ABANDONED_MODE_LS_KEY) || ''; } catch (_) { raw = ''; }
      return normalizeAbandonedMode(raw);
    }

    function saveAbandonedMode(mode) {
      try { localStorage.setItem(ABANDONED_MODE_LS_KEY, normalizeAbandonedMode(mode)); } catch (_) {}
    }

    function syncAbandonedModeUi() {
      if (PAGE !== 'abandoned-carts') return;
      var titleTextEl = document.getElementById('abandoned-page-title-text');
      if (titleTextEl) titleTextEl.textContent = abandonedModeDisplayLabel(abandonedMode);

      var switchEl = document.getElementById('abandoned-mode-switch');
      if (switchEl) {
        var next = normalizeAbandonedMode(abandonedMode) === 'checkout' ? 'cart' : 'checkout';
        switchEl.textContent = 'Switch to ' + abandonedModeDisplayLabel(next);
        switchEl.setAttribute('data-abandoned-mode', next);
        switchEl.setAttribute('aria-label', 'Switch to ' + abandonedModeDisplayLabel(next));
      }
      var tableTitle = document.getElementById('table-title-text');
      if (tableTitle) tableTitle.textContent = abandonedModeDisplayLabel(abandonedMode);
    }

    function setAbandonedMode(nextMode, opts) {
      var next = normalizeAbandonedMode(nextMode);
      if (next === abandonedMode) {
        syncAbandonedModeUi();
        return;
      }
      abandonedMode = next;
      saveAbandonedMode(next);
      syncAbandonedModeUi();
      if (PAGE === 'abandoned-carts') {
        abandonedCartsChartKey = '';
        abandonedCartsTopCacheKey = '';
        try { refreshAbandonedCarts({ force: false }); } catch (_) { try { fetchSessions(); } catch (_) {} }
      }
    }

    // Abandoned Carts page: init mode dropdown state + bindings.
    if (PAGE === 'abandoned-carts') {
      try { abandonedMode = loadAbandonedMode(); } catch (_) { abandonedMode = 'cart'; }
      syncAbandonedModeUi();
      try {
        var switchEl = document.getElementById('abandoned-mode-switch');
        if (switchEl && switchEl.getAttribute('data-kexo-bound') !== '1') {
          switchEl.setAttribute('data-kexo-bound', '1');
          switchEl.addEventListener('keydown', function(e) {
            if (!e) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            try { switchEl.click(); } catch (_) {}
          });
        }
      } catch (_) {}
      try {
        document.addEventListener('click', function(e) {
          var t = e && e.target ? e.target : null;
          var btn = t && t.closest ? t.closest('[data-abandoned-mode]') : null;
          if (!btn) return;
          e.preventDefault();
          setAbandonedMode(btn.getAttribute('data-abandoned-mode') || 'cart', { source: 'ui' });
        });
      } catch (_) {}
    }

    function setUpdateAvailable(next, opts) {
      updateAvailable = !!next;
      const reason = opts && opts.reason ? String(opts.reason) : '';
      try { document.body.classList.toggle('kexo-update-available', updateAvailable); } catch (_) {}
      try { document.documentElement.toggleAttribute('data-kexo-update-available', updateAvailable); } catch (_) {}
      try {
        const btn = document.getElementById('refresh-btn');
        if (btn) btn.setAttribute('title', updateAvailable ? ('Update available. Click to reload.' + (reason ? (' ' + reason) : '')) : 'Refresh');
      } catch (_) {}
      try {
        document.querySelectorAll('.footer-refresh-btn').forEach(function(btn) {
          if (!btn) return;
          btn.setAttribute('title', updateAvailable ? ('Update available. Click to reload.' + (reason ? (' ' + reason) : '')) : 'Refresh');
        });
      } catch (_) {}
    }
    function getStatsRange() {
      const raw = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : dateRange;
      return normalizeRangeKeyForApi(raw);
    }
    function getRangeDisplayLabel(rangeKey) {
      const rk = normalizeRangeKeyForApi(rangeKey);
      if (rk === 'today') return 'Today';
      if (rk === 'yesterday') return 'Yesterday';
      if (rk === '3d') return 'Last 3 days';
      if (rk === '7d') return 'Last 7 days';
      if (rk === '14d') return 'Last 14 days';
      if (rk === '30d') return 'Last 30 days';
      if (rk === 'month') return 'This month';
      if (/^d:\d{4}-\d{2}-\d{2}$/.test(rk)) return 'Selected day';
      if (/^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(rk)) return 'Selected range';
      return 'Current';
    }
    function getCompareDisplayLabel(rangeKey) {
      const rk = normalizeRangeKeyForApi(rangeKey);
      if (rk === 'today') return 'Yesterday';
      if (rk === 'yesterday') return 'Day before';
      if (rk === '3d') return 'Previous 3 days';
      if (rk === '7d') return 'Previous 7 days';
      if (rk === '14d') return 'Previous 14 days';
      if (rk === '30d') return 'Previous 30 days';
      if (rk === 'month') return 'Previous month';
      if (/^d:\d{4}-\d{2}-\d{2}$/.test(rk)) return 'Previous day';
      if (/^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(rk)) {
        var m = rk.match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
        if (m && m[1] && m[2]) {
          try {
            var a = Date.parse(m[1] + 'T00:00:00Z');
            var b = Date.parse(m[2] + 'T00:00:00Z');
            if (Number.isFinite(a) && Number.isFinite(b)) {
              var spanDays = Math.abs(Math.round((b - a) / 86400000)) + 1;
              if (spanDays <= 1) return 'Previous day';
              return 'Previous ' + String(spanDays) + ' days';
            }
          } catch (_) {}
        }
        return 'Previous period';
      }
      return 'Previous period';
    }

    function showDashboardSecondaryCompare(rangeKey) {
      const rk = normalizeRangeKeyForApi(rangeKey);
      return rk === 'today' || rk === 'yesterday';
    }

    // Shopify embedded app: keep the signed query params on internal navigation.
    // Without this, moving from `/?shop=...&hmac=...` to `/dashboard/overview` drops the signature and API calls can 401.
    (function propagateShopifySignedQueryToLinks() {
      try {
        const cur = new URL(window.location.href);
        const sp = cur.searchParams;
        const shop = sp.get('shop');
        const hmac = sp.get('hmac');
        const ts = sp.get('timestamp');
        if (!shop || !hmac || !ts) return;
        if (!/\.myshopify\.com$/i.test(shop)) return;

        const signedEntries = [];
        sp.forEach(function(v, k) { signedEntries.push([k, v]); });
        const signedKeys = new Set(signedEntries.map(function(e) { return e[0]; }));

        const isAssetPath = function(p) {
          if (!p) return false;
          if (p.startsWith('/assets/')) return true;
          return /\.(css|js|png|webp|jpg|jpeg|gif|svg|ico|map|txt)$/i.test(p);
        };

        document.querySelectorAll('a[href]').forEach(function(a) {
          const rawHref = a.getAttribute('href');
          if (!rawHref) return;
          const h = rawHref.trim();
          if (!h || h[0] === '#') return;
          if (/^(javascript:|mailto:|tel:)/i.test(h)) return;

          let u;
          try { u = new URL(h, cur.origin); } catch (_) { return; }
          if (u.origin !== cur.origin) return;
          if ((u.pathname || '').startsWith('/api/')) return;
          if (isAssetPath(u.pathname || '')) return;

          // Don't add signed params to links that already have extra params:
          // adding any new key would invalidate the existing hmac.
          let hasNonSigned = false;
          u.searchParams.forEach(function(_v, k) { if (!signedKeys.has(k)) hasNonSigned = true; });
          if (hasNonSigned) return;

          signedEntries.forEach(function(pair) {
            u.searchParams.set(pair[0], pair[1]);
          });
          a.setAttribute('href', u.pathname + '?' + u.searchParams.toString() + (u.hash || ''));
        });
      } catch (_) {}
    })();

    // Sync data-label from header to body cells for mobile card layout
    (function initGridTableMobileLabels() {
      function syncLabels(tableEl) {
