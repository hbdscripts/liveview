(function () {
const API = '';
    const PAGE = (document.body && document.body.getAttribute('data-page')) || '';
    try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext(PAGE || 'unknown', { page: PAGE || 'unknown' }); } catch (_) {}
    try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('app', 'init', { page: PAGE }); } catch (_) {}
    function captureChartError(err, context, extra) {
      try {
        if (typeof window.kexoCaptureError !== 'function') return;
        var payload = {
          context: context || 'chart',
          page: PAGE || 'unknown'
        };
        if (extra && typeof extra === 'object') {
          Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        }
        window.kexoCaptureError(err, payload);
      } catch (_) {}
    }
    function captureChartMessage(message, context, extra, level) {
      try {
        if (typeof window.kexoCaptureMessage !== 'function') return;
        var payload = {
          context: context || 'chart',
          page: PAGE || 'unknown'
        };
        if (extra && typeof extra === 'object') {
          Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        }
        window.kexoCaptureMessage(String(message || ''), payload, level || 'error');
      } catch (_) {}
    }
    const PAGE_LOADER_ENABLED = Object.freeze({
      dashboard: true,
      live: true,
      sales: true,
      date: true,
      countries: true,
      products: true,
      channels: true,
      type: true,
      ads: true,
    });
    const TABLE_CLASS_CONFIG = Object.freeze({
      dashboard: Object.freeze({ defaultRows: 5, rowOptions: Object.freeze([5, 10]) }),
      product: Object.freeze({ defaultRows: 10, rowOptions: Object.freeze([10, 15, 20]) }),
      live: Object.freeze({ defaultRows: 20, rowOptions: Object.freeze([20, 30, 40, 50]) }),
    });
    const TABLE_ROWS_STORAGE_PREFIX = 'kexo:table-rows:v1';
    const TABLE_CLASS_FALLBACK_BY_ID = Object.freeze({
      'sessions-table': 'live',
      'dash-top-products': 'dashboard',
      'dash-top-countries': 'dashboard',
      'dash-trending-up': 'dashboard',
      'dash-trending-down': 'dashboard',
      'best-sellers-table': 'product',
      'best-variants-table': 'product',
      'type-necklaces-table': 'product',
      'type-bracelets-table': 'product',
      'type-earrings-table': 'product',
      'type-sets-table': 'product',
      'type-charms-table': 'product',
      'type-extras-table': 'product',
      'country-table': 'live',
      'best-geo-products-table': 'live',
      'traffic-sources-table': 'live',
      'traffic-types-table': 'live',
      'ads-root': 'live',
    });

    (function initKexoTableMounts() {
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
            var config = Object.assign({}, def, {
              tableId: tableId,
              wrapId: (mount.id || tableId + '-mount') + '-wrap',
              bodyId: def.bodyId || tableId + '-body'
            });
            mount.outerHTML = build(config);
          } else if (nativeDef && buildNative) {
            var nativeConfig = Object.assign({}, nativeDef, { tableId: tableId });
            mount.outerHTML = buildNative(nativeConfig);
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
    const TABLES_CONVERTED_COLOR_DEFAULTS = Object.freeze({
      iconColor: '#2f7d50',
      iconBackground: '#f0f8f1',
      stickyBackground: '#ffffff',
      convertedBackground: '#f9fcfa',
    });
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

    function getTablesUiTableCfg(tableId, pageKey) {
      var p = getTablesUiPageCfg(pageKey || PAGE);
      if (!p || !Array.isArray(p.tables)) return null;
      var id = normalizeUiTableId(tableId);
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

    function normalizeTablesUiHexColor(value, fallback) {
      var raw = value == null ? '' : String(value).trim();
      if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
      return fallback;
    }

    function getTablesUiConvertedRowColors(cfg) {
      var defaults = TABLES_CONVERTED_COLOR_DEFAULTS;
      var raw = (
        cfg &&
        cfg.shared &&
        cfg.shared.convertedRowColors &&
        typeof cfg.shared.convertedRowColors === 'object'
      ) ? cfg.shared.convertedRowColors : {};
      return {
        iconColor: normalizeTablesUiHexColor(raw.iconColor, defaults.iconColor),
        iconBackground: normalizeTablesUiHexColor(raw.iconBackground, defaults.iconBackground),
        stickyBackground: normalizeTablesUiHexColor(raw.stickyBackground, defaults.stickyBackground),
        convertedBackground: normalizeTablesUiHexColor(raw.convertedBackground, defaults.convertedBackground),
      };
    }

    function applyTablesUiConvertedRowColors(cfg) {
      var root = document && document.documentElement ? document.documentElement : null;
      if (!root || !root.style || !root.style.setProperty) return;
      var colors = getTablesUiConvertedRowColors(cfg);
      root.style.setProperty('--kexo-converted-icon-color', colors.iconColor);
      root.style.setProperty('--kexo-converted-icon-bg', colors.iconBackground);
      root.style.setProperty('--kexo-sticky-cell-bg', colors.stickyBackground);
      root.style.setProperty('--kexo-converted-cell-bg', colors.convertedBackground);
    }

    function applyTablesUiConfigV1(cfg) {
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1 || !Array.isArray(cfg.pages)) return false;
      var prevSig = tablesUiConfigSignature(tablesUiConfigV1);
      var nextSig = tablesUiConfigSignature(cfg);
      tablesUiConfigV1 = cfg;
      try { applyTablesUiConvertedRowColors(cfg); } catch (_) {}
      try { window.__kexoTablesUiConfigV1 = cfg; } catch (_) {}
      try { safeWriteLocalStorageJson(TABLES_UI_CFG_LS_KEY, cfg); } catch (_) {}
      try {
        Object.keys(tableRowsCache).forEach(function (k) { delete tableRowsCache[k]; });
      } catch (_) {}
      return prevSig !== nextSig;
    }

    try { applyTablesUiConvertedRowColors(tablesUiConfigV1); } catch (_) {}

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
      if (!PAGE_LOADER_ENABLED[PAGE]) return;
      var pageBody = document.querySelector('.page-body');
      var overlay = document.getElementById('page-body-loader');
      if (!pageBody || !overlay) return;
      syncPageBodyLoaderOffset(pageBody);
      pageBody.classList.add('report-building');
      overlay.classList.remove('is-hidden');
      var titleEl = overlay.querySelector('.report-build-title');
      var stepEl = document.getElementById('page-body-build-step') || overlay.querySelector('.report-build-step');
      if (titleEl && !String(titleEl.textContent || '').trim()) titleEl.textContent = 'Preparing application';
      if (stepEl && !String(stepEl.textContent || '').trim()) stepEl.textContent = 'Preparing application';
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
      return TABLE_ROWS_STORAGE_PREFIX + ':' + String(tableId == null ? '' : tableId).trim().toLowerCase();
    }

    function getTableRowsPerPage(tableId, fallbackClassKey) {
      var id = String(tableId == null ? '' : tableId).trim();
      if (!id) return tableClassConfig(fallbackClassKey || 'live').defaultRows;
      if (Object.prototype.hasOwnProperty.call(tableRowsCache, id)) return tableRowsCache[id];
      var classKey = getTableClassByTableId(id, fallbackClassKey);
      var cfg = tableRowsConfigForTableId(id, classKey);
      var raw = null;
      try { raw = localStorage.getItem(tableRowsStorageKey(id)); } catch (_) { raw = null; }
      var value = clampTableRows(raw == null ? cfg.defaultRows : Number(raw), id, classKey);
      tableRowsCache[id] = value;
      return value;
    }

    function setTableRowsPerPage(tableId, rows, fallbackClassKey) {
      var id = String(tableId == null ? '' : tableId).trim();
      if (!id) return null;
      var classKey = getTableClassByTableId(id, fallbackClassKey);
      var next = clampTableRows(rows, id, classKey);
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

    // ── Page progress bar (Tabler turbo-style) ──
    var _progressEl = null;
    var _progressBarEl = null;
    var _progressActive = 0;
    var _progressHideTimer = null;
    function _ensureProgress() {
      if (_progressEl) return;
      _progressEl = document.createElement('div');
      _progressEl.className = 'page-progress';
      _progressEl.innerHTML = '<div class="page-progress-bar"></div>';
      document.body.prepend(_progressEl);
      _progressBarEl = _progressEl.querySelector('.page-progress-bar');
    }
    function showPageProgress() {
      // Single-loader contract: do not show a separate top progress bar.
      return;
    }
    function hidePageProgress() {
      return;
    }
    const LIVE_REFRESH_MS = 60000;
    const RANGE_REFRESH_MS = 5 * 60 * 1000; // Today and Sales refresh every 5 min
    const LIVE_SALES_POLL_MS = 10 * 1000; // Only /dashboard/live + /dashboard/sales poll automatically
    const ACTIVE_WINDOW_MS = 5 * 60 * 1000; // Live view: only show sessions seen in last 5 min
    const ARRIVED_WINDOW_MS = 60 * 60 * 1000; // Live view: only show sessions that arrived in last 60 min
    const STATS_REFRESH_MS = 5 * 60 * 1000; // Breakdown / Products / Traffic refresh (Today only)
    const KPI_REFRESH_MS = 120000; // 2 min: reduce repeated KPI queries during fast nav
    const KPI_CACHE_TTL_MS = KPI_REFRESH_MS;
    const KPI_CACHE_STALE_OK_MS = 30 * 60 * 1000; // paint stale values while revalidating
    const KPI_EXTRAS_CACHE_TTL_MS = 10 * 60 * 1000;
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
    let trafficCache = null;
    let trafficTypeExpanded = null; // device -> boolean (Traffic Type tree) — null = first render, default all open
    let dateRange = PAGE === 'sales' ? 'sales' : PAGE === 'date' ? 'today' : PAGE === 'dashboard' ? 'today' : 'live';
    let customRangeStartYmd = null; // YYYY-MM-DD (admin TZ)
    let customRangeEndYmd = null; // YYYY-MM-DD (admin TZ)
    let pendingCustomRangeStartYmd = null; // modal-only pending selection
    let pendingCustomRangeEndYmd = null; // modal-only pending selection
    let customCalendarLastPayload = null; // last /api/available-days payload used for rendering
    /** When dateRange is 'live' or 'sales', stats/KPIs use today's data; only the main table shows those special views. */
    function normalizeRangeKeyForApi(key) {
      const k = (key == null ? '' : String(key)).trim().toLowerCase();
      // UI uses friendly labels (7days/14days/30days) but APIs + server payload keys use 7d/14d/30d.
      if (k === '7days') return '7d';
      if (k === '14days') return '14d';
      if (k === '30days') return '30d';
      return k;
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
        if (!tableEl || !tableEl.querySelector) return;
        var headerRow = tableEl.querySelector('.grid-row--header');
        var headerCells = headerRow ? headerRow.querySelectorAll('.grid-cell') : [];
        var labels = Array.from(headerCells).map(function(c) {
          var a = c.getAttribute('aria-label');
          if (a) return a.trim();
          var long = c.querySelector('.th-label-long');
          if (long && long.textContent) return long.textContent.trim();
          return (c.textContent || '').trim();
        });
        if (labels.length === 0) return;
        tableEl.querySelectorAll('.grid-body .grid-row').forEach(function(row) {
          var cells = row.querySelectorAll('.grid-cell:not(.span-all)');
          cells.forEach(function(cell, i) {
            if (labels[i]) cell.setAttribute('data-label', labels[i]);
          });
        });
      }
      function observeGridBodies() {
        document.querySelectorAll('.grid-table .grid-body').forEach(function(body) {
          if (body._gridLabelsObserved) return;
          body._gridLabelsObserved = true;
          syncLabels(body.closest('.grid-table'));
          var mo = new MutationObserver(function() {
            syncLabels(body.closest('.grid-table'));
          });
          mo.observe(body, { childList: true, subtree: true });
        });
      }
      function run() {
        observeGridBodies();
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
      setTimeout(run, 800);
      setTimeout(run, 2000);
    })();

    (function initHorizontalDragScroll() {
      var WRAP_SELECTOR = '.table-scroll-wrap, .country-table-wrap, .table-responsive';

      function shouldIgnoreTarget(target) {
        if (!target || !target.closest) return false;
        return !!target.closest('a, button, input, select, textarea, label, [role="button"], [data-no-drag-scroll]');
      }

      function setDragEnabledClass(wrap) {
        if (!wrap) return;
        var canDrag = (wrap.scrollWidth || 0) > ((wrap.clientWidth || 0) + 1);
        wrap.classList.toggle('is-drag-scroll', !!canDrag);
      }

      function shouldSkipStickyScrollClass(wrap) {
        if (!wrap || !wrap.querySelector) return true;
        return !!wrap.querySelector('#latest-sales-table');
      }

      function updateStickyScrollClass(wrap) {
        if (!wrap || shouldSkipStickyScrollClass(wrap)) return;
        var scrolled = (wrap.scrollLeft || 0) > 0;
        wrap.classList.toggle('kexo-sticky-scrolled', scrolled);
      }

      function bind(wrap) {
        if (!wrap || wrap.getAttribute('data-drag-scroll-bound') === '1') return;
        wrap.setAttribute('data-drag-scroll-bound', '1');
        setDragEnabledClass(wrap);

        if (!shouldSkipStickyScrollClass(wrap)) {
          updateStickyScrollClass(wrap);
          wrap.addEventListener('scroll', function() { updateStickyScrollClass(wrap); }, { passive: true });
        }

        var startX = 0;
        var startScrollLeft = 0;
        var dragging = false;
        var moved = false;

        wrap.addEventListener('pointerdown', function(e) {
          if (!e || e.button !== 0) return;
          var scrollbarHidden = (getComputedStyle(wrap).getPropertyValue('scrollbar-width') || '').trim() === 'none';
          if ((e.pointerType || '') === 'touch' && !scrollbarHidden) return; // native swipe when scrollbar visible; when hidden (mobile/emulation), run our drag
          if (!wrap.classList.contains('is-drag-scroll')) return;
          if (shouldIgnoreTarget(e.target)) return;
          dragging = true;
          moved = false;
          startX = e.clientX;
          startScrollLeft = wrap.scrollLeft;
          wrap.classList.add('is-dragging');
          try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
        });

        wrap.addEventListener('pointermove', function(e) {
          if (!dragging) return;
          var dx = e.clientX - startX;
          if (!moved && Math.abs(dx) > 3) moved = true;
          wrap.scrollLeft = startScrollLeft - dx;
          if (moved) e.preventDefault();
        });

        function endDrag(e) {
          if (!dragging) return;
          dragging = false;
          wrap.classList.remove('is-dragging');
          try { if (e && e.pointerId != null) wrap.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        wrap.addEventListener('pointerup', endDrag);
        wrap.addEventListener('pointercancel', endDrag);
        wrap.addEventListener('pointerleave', function(e) {
          if (!dragging) return;
          if (e && e.buttons === 1) return;
          endDrag(e);
        });

        if (typeof ResizeObserver !== 'undefined') {
          try {
            var ro = new ResizeObserver(function() {
              setDragEnabledClass(wrap);
              if (!shouldSkipStickyScrollClass(wrap)) updateStickyScrollClass(wrap);
            });
            ro.observe(wrap);
            wrap._dragScrollObserver = ro;
          } catch (_) {}
        }
      }

      function run() {
        document.querySelectorAll(WRAP_SELECTOR).forEach(function(wrap) { bind(wrap); });
      }

      var resizeTid;
      function refreshAll() {
        document.querySelectorAll(WRAP_SELECTOR).forEach(function(wrap) {
          if (wrap.getAttribute('data-drag-scroll-bound') !== '1') return;
          setDragEnabledClass(wrap);
          if (!shouldSkipStickyScrollClass(wrap)) updateStickyScrollClass(wrap);
        });
      }
      window.addEventListener('resize', function() {
        clearTimeout(resizeTid);
        resizeTid = setTimeout(refreshAll, 80);
      });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
      setTimeout(run, 700);
      setTimeout(run, 1800);
    })();

    (function initTableCardCollapse() {
      var STORAGE_PREFIX = 'kexo:table-collapse:v1';
      var CARD_SELECTOR = '.card';
      var TABLE_CONTENT_SELECTOR = '.table-scroll-wrap, .country-table-wrap, .table-responsive, .grid-table, table';
      var CHART_CONTENT_SELECTOR = '.dash-chart-wrap, [id^="dash-chart-"], #live-online-chart, #sessions-overview-chart, #ads-overview-chart, #channels-chart, #type-chart, #products-chart, #countries-map-chart';
      var HEADER_SELECTOR = '.card-header';

      function getPageScope() {
        var page = '';
        try { page = (document.body && document.body.getAttribute('data-page')) || ''; } catch (_) { page = ''; }
        if (page) return String(page).trim().toLowerCase();
        var path = '';
        try { path = (window.location && window.location.pathname) ? String(window.location.pathname) : ''; } catch (_) { path = ''; }
        path = path.replace(/^\/+/, '').trim().toLowerCase();
        return path || 'dashboard';
      }

      function slugify(value) {
        return String(value == null ? '' : value)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'table-card';
      }

      function getDirectHeader(card) {
        if (!card || !card.querySelector) return null;
        var header = null;
        try { header = card.querySelector(':scope > .card-header'); } catch (_) { header = null; }
        if (header) return header;
        return card.querySelector(HEADER_SELECTOR);
      }

      function hasTableContent(card) {
        if (!card || !card.querySelector) return false;
        if (card.querySelector(TABLE_CONTENT_SELECTOR)) return true;
        if (card.querySelector(CHART_CONTENT_SELECTOR)) return true;
        return false;
      }

      function hasChartContent(card) {
        if (!card || !card.querySelector) return false;
        return !!card.querySelector(CHART_CONTENT_SELECTOR);
      }

      function isChartOnlyCard(card) {
        if (!card) return false;
        if (card.dataset && card.dataset.tableId) return false;
        var wrap = card.closest ? card.closest('[data-kexo-chart-key]') : null;
        if (wrap) return true;
        return hasChartContent(card) && !card.querySelector(TABLE_CONTENT_SELECTOR);
      }

      function getCollapseId(card, index) {
        if (!card || !card.dataset) return 'table-card-' + String(index || 0);
        if (card.dataset.collapseId) return card.dataset.collapseId;
        var id = '';
        if (card.id) id = String(card.id).trim();
        if (!id) {
          var titleEl = card.querySelector('.card-header .card-title');
          var title = titleEl ? String(titleEl.textContent || '').trim() : '';
          if (title) id = slugify(title) + '-' + String(index || 0);
        }
        if (!id) id = 'table-card-' + String(index || 0);
        card.dataset.collapseId = id;
        return id;
      }

      function getStorageKey(card, index) {
        return STORAGE_PREFIX + ':' + getPageScope() + ':' + getCollapseId(card, index);
      }

      function refreshIconTheme() {
        try {
          window.dispatchEvent(new CustomEvent('kexo:icon-theme-changed'));
          if (window.KexoIconTheme && typeof window.KexoIconTheme.refresh === 'function') window.KexoIconTheme.refresh();
        } catch (_) {}
      }

      function setCollapseChevron(button, collapsed) {
        if (!button || !button.querySelector) return;
        var icon = button.querySelector('.kexo-card-collapse-chevron');
        if (!icon) return;
        var isCollapsed = !!collapsed;
        var glyph = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
        var key = isCollapsed ? 'card-collapse-collapsed' : 'card-collapse-expanded';
        icon.setAttribute('data-icon-key', key);
        icon.className = 'kexo-card-collapse-chevron fa-light ' + glyph;
        refreshIconTheme();
      }

      function setCollapsed(card, button, collapsed, persist, storageKey) {
        if (!card) return;
        var isCollapsed = !!collapsed;
        card.classList.toggle('kexo-card-collapsed', isCollapsed);
        if (button) {
          button.classList.toggle('is-collapsed', isCollapsed);
          button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
          button.setAttribute('aria-label', isCollapsed ? 'Expand section' : 'Collapse section');
          button.title = isCollapsed ? 'Expand section' : 'Collapse section';
          setCollapseChevron(button, isCollapsed);
        }
        if (persist && storageKey) {
          try { sessionStorage.setItem(storageKey, isCollapsed ? '1' : '0'); } catch (_) {}
        }
      }

      function restoreCollapsed(card, button, storageKey) {
        var raw = null;
        try { raw = sessionStorage.getItem(storageKey); } catch (_) { raw = null; }
        if (raw == null) {
          // Keep any default collapsed state already present in the DOM (useful for
          // dynamically-inserted cards like modals).
          var already = !!(card && card.classList && card.classList.contains('kexo-card-collapsed'));
          setCollapsed(card, button, already, false, storageKey);
          return;
        }
        setCollapsed(card, button, raw === '1', false, storageKey);
      }

      function ensureToggle(card, index) {
        if (!card || card.getAttribute('data-no-card-collapse') === '1') return;
        if (!hasTableContent(card)) return;
        var header = getDirectHeader(card);
        if (!header) return;

        if (card.dataset && card.dataset.tableId) {
          if (header.querySelector('.kexo-builder-icon-link')) return;
          var link = document.createElement('a');
          link.href = 'https://app.kexo.io/settings?tab=layout';
          link.className = 'btn btn-icon btn-ghost-secondary kexo-builder-icon-link';
          link.title = 'Layout settings';
          link.setAttribute('aria-label', 'Layout settings');
          link.innerHTML = '<i class="fa-light fa-gear" data-icon-key="table-builder-icon" style="color:#999" aria-hidden="true"></i>';
          var actions = header.querySelector(':scope > .card-actions');
          if (!actions) {
            actions = document.createElement('div');
            actions.className = 'card-actions d-flex align-items-center gap-2 ms-auto';
            header.appendChild(actions);
          }
          actions.appendChild(link);
          return;
        }

        if (isChartOnlyCard(card)) {
          var existingChartLink = header.querySelector('.kexo-builder-icon-link');
          var existingCollapse = header.querySelector('.kexo-card-collapse-toggle');
          if (existingCollapse) existingCollapse.remove();
          if (existingChartLink) return;
          var chartLink = document.createElement('a');
          chartLink.href = 'https://app.kexo.io/settings?tab=layout';
          chartLink.className = 'btn btn-icon btn-ghost-secondary kexo-builder-icon-link';
          chartLink.title = 'Layout settings';
          chartLink.setAttribute('aria-label', 'Layout settings');
          chartLink.innerHTML = '<i class="fa-light fa-gear" data-icon-key="chart-builder-icon" style="color:#999" aria-hidden="true"></i>';
          var chartActions = header.querySelector(':scope > .card-actions');
          if (!chartActions) {
            chartActions = document.createElement('div');
            chartActions.className = 'card-actions d-flex align-items-center gap-2 ms-auto';
            header.appendChild(chartActions);
          }
          chartActions.appendChild(chartLink);
          return;
        }

        var storageKey = getStorageKey(card, index);
        var btn = header.querySelector('.kexo-card-collapse-toggle');
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-icon btn-ghost-secondary kexo-card-collapse-toggle';
          btn.innerHTML = '<i class="kexo-card-collapse-chevron fa-light fa-chevron-down" data-icon-key="card-collapse-expanded" aria-hidden="true"></i>';
          var actions = null;
          try { actions = header.querySelector(':scope > .card-actions'); } catch (_) { actions = null; }
          if (actions && actions.parentElement === header) {
            header.appendChild(btn);
          } else {
            btn.classList.add('ms-auto');
            header.appendChild(btn);
          }
        }
        if (btn.getAttribute('data-collapse-bound') !== '1') {
          btn.setAttribute('data-collapse-bound', '1');
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            var next = !card.classList.contains('kexo-card-collapsed');
            setCollapsed(card, btn, next, true, storageKey);
          });
        }
        restoreCollapsed(card, btn, storageKey);
      }

      function run(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var cards = scope.querySelectorAll(CARD_SELECTOR);
        cards.forEach(function(card, idx) { ensureToggle(card, idx); });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { run(document); });
      } else {
        run(document);
      }

      var observer = new MutationObserver(function(muts) {
        muts.forEach(function(m) {
          m.addedNodes.forEach(function(n) {
            if (!(n instanceof Element)) return;
            run(n);
          });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });

      try { window.addEventListener('hashchange', function() { setTimeout(function() { run(document); }, 0); }); } catch (_) {}
      setTimeout(function() { run(document); }, 800);
      setTimeout(function() { run(document); }, 1800);
    })();

    (function initTableRowsPerPageControls() {
      var CARD_SELECTOR = '.card[data-table-class][data-table-id]';

      function getDirectHeader(card) {
        if (!card || !card.querySelector) return null;
        try { return card.querySelector(':scope > .card-header'); } catch (_) {}
        return card.querySelector('.card-header');
      }

      function ensureActionsContainer(header) {
        if (!header || !header.querySelector) return null;
        var actions = null;
        try { actions = header.querySelector(':scope > .card-actions'); } catch (_) { actions = null; }
        if (actions && actions.parentElement === header) return actions;
        actions = document.createElement('div');
        actions.className = 'card-actions d-flex align-items-center gap-2 ms-auto kexo-table-actions';
        header.appendChild(actions);
        return actions;
      }

      function ensureRowsControl(card) {
        if (!card) return;
        var tableId = (card.dataset && card.dataset.tableId) ? String(card.dataset.tableId).trim() : inferTableIdFromCard(card);
        if (!tableId) return;
        var classKey = normalizeTableClass(card.dataset && card.dataset.tableClass ? card.dataset.tableClass : 'live');
        var cfg = tableRowsConfigForTableId(tableId, classKey);
        var selectedRows = getTableRowsPerPage(tableId, classKey);
        var header = getDirectHeader(card);
        if (!header) return;
        var actions = ensureActionsContainer(header);
        if (!actions) return;

        var collapseBtn = header.querySelector('.kexo-card-collapse-toggle');
        var builderLink = header.querySelector('.kexo-builder-icon-link');
        if (collapseBtn && collapseBtn.parentElement !== actions) {
          collapseBtn.classList.remove('ms-auto');
          actions.appendChild(collapseBtn);
        }
        if (builderLink && builderLink.parentElement !== actions) {
          builderLink.classList.remove('ms-auto');
          actions.appendChild(builderLink);
        }

        var control = actions.querySelector('.kexo-table-rows-control[data-table-id="' + tableId + '"]');
        if (!control) {
          control = document.createElement('label');
          control.className = 'kexo-table-rows-control';
          control.setAttribute('data-table-id', tableId);
          control.innerHTML = '<select class="form-select form-select-sm kexo-table-rows-select" aria-label="Rows per table"></select>';
          var insertBefore = (collapseBtn && collapseBtn.parentElement === actions) ? collapseBtn : (builderLink && builderLink.parentElement === actions) ? builderLink : null;
          if (insertBefore) {
            actions.insertBefore(control, insertBefore);
          } else {
            actions.appendChild(control);
          }
        }

        var selectEl = control.querySelector('.kexo-table-rows-select');
        if (!selectEl) return;
        var options = Array.isArray(cfg && cfg.rowOptions) ? cfg.rowOptions : [cfg.defaultRows];
        selectEl.innerHTML = options.map(function(opt) {
          return '<option value="' + String(opt) + '">' + String(opt) + '</option>';
        }).join('');
        selectEl.value = String(clampTableRows(selectedRows, tableId, classKey));
        if (selectEl.getAttribute('data-rows-bound') !== '1') {
          selectEl.setAttribute('data-rows-bound', '1');
          selectEl.addEventListener('change', function() {
            var next = setTableRowsPerPage(tableId, Number(selectEl.value), classKey);
            applyTableRowsPerPageChange(tableId, next);
          });
        }
      }

      function run(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var cards = scope.querySelectorAll(CARD_SELECTOR);
        cards.forEach(function(card) { ensureRowsControl(card); });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { run(document); });
      } else {
        run(document);
      }
      var observer = new MutationObserver(function(muts) {
        muts.forEach(function(m) {
          m.addedNodes.forEach(function(n) {
            if (!(n instanceof Element)) return;
            run(n);
          });
        });
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.addEventListener('kexo:table-rows-changed', function() {
        run(document);
      });
      window.addEventListener('kexo:tablesUiConfigApplied', function() {
        run(document);
      });
      window.addEventListener('kexo:variant-cards-rendered', function() {
        run(document);
      });
      window.addEventListener('kexo:icon-theme-changed', function() {
        run(document);
        setTimeout(function() { run(document); }, 80);
      });
      setTimeout(function() { run(document); }, 900);
      setTimeout(function() { run(document); }, 2000);
    })();

    (function initStickyColumnResize() {
      var page = '';
      try { page = (document.body && document.body.getAttribute('data-page')) || ''; } catch (_) { page = ''; }
      if (String(page || '').toLowerCase() === 'settings') return;
      var WRAP_SELECTOR = '.table-scroll-wrap, .country-table-wrap, .table-responsive';
      var ABS_MIN_WIDTH = 72;
      var ABS_MAX_WIDTH = 420;
      var LS_KEY = 'kexo-sticky-col-width';

      function getViewportBucket() {
        try {
          return (window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches) ? 'mobile' : 'desktop';
        } catch (_) {
          return 'desktop';
        }
      }

      function getWrapTableId(wrap) {
        if (!wrap) return '';
        try {
          var table = wrap.querySelector ? wrap.querySelector('table[id], .grid-table[id]') : null;
          if (table && table.id) return String(table.id).trim();
        } catch (_) {}
        // Prefer the owning card's declared table id so related wraps (e.g. Ads footer)
        // share the same sticky width key.
        try {
          var card = wrap.closest ? wrap.closest('.card[data-table-id]') : null;
          if (card && card.dataset && card.dataset.tableId) return String(card.dataset.tableId).trim();
        } catch (_) {}
        try {
          if (wrap.id) return String(wrap.id).trim();
        } catch (_) {}
        return '';
      }

      function getWrapTableClass(wrap) {
        try {
          var card = wrap && wrap.closest ? wrap.closest('.card') : null;
          if (card && card.dataset && card.dataset.tableClass) return normalizeTableClass(card.dataset.tableClass);
        } catch (_) {}
        return getTableClassByTableId(getWrapTableId(wrap), 'live');
      }

      function getTableCardsInGroupCount(wrap) {
        if (!wrap || !wrap.closest || !wrap.querySelectorAll) return 1;
        var card = wrap.closest('.card');
        if (!card) return 1;
        var group = card.closest('.stats-row, .row');
        if (!group || !group.querySelectorAll) return 1;
        var cards = group.querySelectorAll('.card[data-table-id]');
        var count = 0;
        cards.forEach(function(c) {
          if (!c || !c.closest) return;
          var owner = c.closest('.stats-row, .row');
          if (owner === group) count++;
        });
        return count > 0 ? count : 1;
      }

      function getBounds(wrap) {
        var classKey = getWrapTableClass(wrap);
        var gridCount = getTableCardsInGroupCount(wrap);
        var min = classKey === 'dashboard' ? 90 : ABS_MIN_WIDTH;
        var max = classKey === 'dashboard' ? 180 : (classKey === 'product' ? 240 : 280);
        var def = classKey === 'dashboard' ? 120 : 120;

        // Live-class tables (20/30/40/50 rows) can expand wider for sticky labels.
        if (classKey === 'live') max = Math.max(max, 400);

        // Site-wide sticky sizing rules by table-grid cardinality.
        if (classKey !== 'live' && gridCount === 1) max = Math.min(max, 250);
        // On mobile the cards stack; allow sticky labels to expand more naturally.
        if (classKey !== 'live' && gridCount === 2 && getViewportBucket() !== 'mobile') max = Math.min(max, 150);
        if (gridCount >= 3) min = Math.max(min, 100);

        // Optional per-table overrides from Settings → Layout → Tables.
        try {
          var tableId = getWrapTableId(wrap);
          var ui = getTablesUiTableCfg(tableId, page);
          if (ui && ui.sticky && typeof ui.sticky === 'object') {
            if (typeof ui.sticky.minWidth === 'number' && Number.isFinite(ui.sticky.minWidth)) min = ui.sticky.minWidth;
            if (typeof ui.sticky.maxWidth === 'number' && Number.isFinite(ui.sticky.maxWidth)) max = ui.sticky.maxWidth;
          }
        } catch (_) {}

        var wrapW = wrap && wrap.clientWidth ? Number(wrap.clientWidth) : 0;
        var colCount = 0;
        try {
          var headerRow = wrap && wrap.querySelector ? wrap.querySelector('.grid-row--header') : null;
          if (headerRow && headerRow.querySelectorAll) {
            colCount = headerRow.querySelectorAll('.grid-cell').length;
          } else {
            var tableHeadRow = wrap && wrap.querySelector ? wrap.querySelector('table thead tr') : null;
            if (tableHeadRow && tableHeadRow.children) colCount = tableHeadRow.children.length || 0;
          }
        } catch (_) { colCount = 0; }
        if (Number.isFinite(wrapW) && wrapW > 0) {
          var isMobile = getViewportBucket() === 'mobile';
          var fitRatio = isMobile ? 0.8 : 0.65;
          var softMax = Math.max(min + 16, Math.round(wrapW * fitRatio));
          max = Math.min(max, softMax);
          if (colCount > 1) {
            var minOtherColWidth = classKey === 'live' ? 72 : 64;
            var byRemainingCols = wrapW - (minOtherColWidth * (colCount - 1));
            /* Only cap by remaining cols when table fits; when scrollable, skip so sticky can expand */
            if (byRemainingCols >= min + 16) max = Math.min(max, byRemainingCols);
          }
        }
        min = Math.max(ABS_MIN_WIDTH, Math.min(min, ABS_MAX_WIDTH - 16));
        max = Math.max(min + 16, Math.min(max, ABS_MAX_WIDTH));
        def = Math.max(min, Math.min(max, def));
        return { min: min, max: max, def: def };
      }

      function clampWidth(wrap, n) {
        var bounds = getBounds(wrap);
        var x = Number(n);
        if (!Number.isFinite(x)) return bounds.def;
        return Math.max(bounds.min, Math.min(bounds.max, Math.round(x)));
      }

      function getHeaderFirstCell(wrap) {
        if (!wrap || !wrap.querySelector) return null;
        return wrap.querySelector('.grid-row--header .grid-cell:first-child, table thead th:first-child');
      }

      function getStorageKey(wrap) {
        var suffix = 'default';
        try {
          var tableId = getWrapTableId(wrap);
          if (tableId) suffix = tableId;
          else if (page) suffix = String(page).trim().toLowerCase();
        } catch (_) {}
        return LS_KEY + ':' + suffix + ':' + getViewportBucket();
      }

      function readSavedWidth(wrap) {
        var raw = null;
        var key = getStorageKey(wrap);
        try { raw = localStorage.getItem(key); } catch (_) { raw = null; }
        var fallback = getBounds(wrap).def;
        return clampWidth(wrap, raw == null ? fallback : Number(raw));
      }

      function saveWidth(wrap, width) {
        var n = Number(width);
        if (!Number.isFinite(n)) return;
        var key = getStorageKey(wrap);
        try { localStorage.setItem(key, String(Math.round(n))); } catch (_) {}
      }

      function wrapWidth(wrap) {
        var style = null;
        try { style = getComputedStyle(wrap); } catch (_) { style = null; }
        var raw = style ? style.getPropertyValue('--kexo-sticky-col-width') : '';
        var n = parseFloat(String(raw || '').trim());
        if (!Number.isFinite(n)) {
          var cell = getHeaderFirstCell(wrap);
          if (cell) {
            try { n = parseFloat(getComputedStyle(cell).width); } catch (_) { n = NaN; }
          }
        }
        return clampWidth(wrap, Number.isFinite(n) ? n : getBounds(wrap).def);
      }

      function applyWidthSingle(wrap, width) {
        if (!wrap || !wrap.style) return;
        var bounds = getBounds(wrap);
        var next = clampWidth(wrap, width);
        wrap.style.setProperty('--kexo-sticky-col-min-width', bounds.min + 'px');
        wrap.style.setProperty('--kexo-sticky-col-max-width', bounds.max + 'px');
        wrap.style.setProperty('--kexo-sticky-col-width', next + 'px');
      }

      function applyWidthToGroup(wrap, width) {
        if (!wrap) return;
        var key = '';
        try { key = getStorageKey(wrap); } catch (_) { key = ''; }
        applyWidthSingle(wrap, width);
        var applied = wrapWidth(wrap);
        if (key) {
          try {
            document.querySelectorAll(WRAP_SELECTOR).forEach(function(other) {
              if (!other || other === wrap) return;
              try {
                if (getStorageKey(other) !== key) return;
              } catch (_) {
                return;
              }
              applyWidthSingle(other, applied);
            });
          } catch (_) {}
        }
        if (wrap.id === 'ads-root' && Number.isFinite(applied)) {
          try {
            var footer = document.getElementById('ads-footer');
            if (footer && footer !== wrap) applyWidthSingle(footer, applied);
          } catch (_) {}
        }
      }

      function markResizeInteraction(wrap) {
        var ts = Date.now();
        try { if (wrap) wrap.setAttribute('data-sticky-resize-at', String(ts)); } catch (_) {}
        try { window.__kexoLastStickyResizeAt = ts; } catch (_) {}
      }

      function bindHandle(wrap, handle) {
        if (!wrap || !handle || handle.getAttribute('data-sticky-resize-bound') === '1') return;
        handle.setAttribute('data-sticky-resize-bound', '1');
        var startX = 0;
        var startW = getBounds(wrap).def;
        var resizing = false;

        function stopResize(e) {
          if (!resizing) return;
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          resizing = false;
          wrap.classList.remove('is-resizing-first-col');
          try { if (e && e.pointerId != null) handle.releasePointerCapture(e.pointerId); } catch (_) {}
          markResizeInteraction(wrap);
          saveWidth(wrap, wrapWidth(wrap));
        }

        handle.addEventListener('pointerdown', function(e) {
          if (!e || e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          resizing = true;
          startX = e.clientX;
          startW = wrapWidth(wrap);
          wrap.classList.add('is-resizing-first-col');
          markResizeInteraction(wrap);
          try { handle.setPointerCapture(e.pointerId); } catch (_) {}
        });

        handle.addEventListener('pointermove', function(e) {
          if (!resizing) return;
          e.preventDefault();
          e.stopPropagation();
          var next = startW + (e.clientX - startX);
          applyWidthToGroup(wrap, next);
          markResizeInteraction(wrap);
        });

        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);
        handle.addEventListener('lostpointercapture', stopResize);
      }

      function ensureHandle(wrap) {
        var cell = getHeaderFirstCell(wrap);
        if (!cell) return;
        var handle = cell.querySelector('.kexo-sticky-resize-handle');
        if (!handle) {
          handle = document.createElement('span');
          handle.className = 'kexo-sticky-resize-handle';
          handle.setAttribute('aria-hidden', 'true');
          handle.setAttribute('data-no-drag-scroll', '1');
          cell.appendChild(handle);
        }
        bindHandle(wrap, handle);
      }

      function bind(wrap) {
        if (!wrap) return;
        // Latest Sales (Live View) is intentionally not sticky/resizable.
        try {
          var tid = String(getWrapTableId(wrap) || '').trim().toLowerCase();
          if (tid === 'latest-sales-table') return;
        } catch (_) {}
        try { wrap.classList.add('kexo-sticky-wrap'); } catch (_) {}
        applyWidthSingle(wrap, readSavedWidth(wrap));
        ensureHandle(wrap);
        if (wrap.getAttribute('data-sticky-resize-wrap-bound') === '1') return;
        wrap.setAttribute('data-sticky-resize-wrap-bound', '1');
        if (typeof ResizeObserver !== 'undefined') {
          try {
            var ro = new ResizeObserver(function() {
              applyWidthSingle(wrap, wrapWidth(wrap));
              ensureHandle(wrap);
            });
            ro.observe(wrap);
            wrap._stickyResizeObserver = ro;
          } catch (_) {}
        }
        if (typeof MutationObserver !== 'undefined') {
          try {
            var mo = new MutationObserver(function() { ensureHandle(wrap); });
            mo.observe(wrap, { childList: true, subtree: true });
            wrap._stickyResizeMutationObserver = mo;
          } catch (_) {}
        }
      }

      function run() {
        document.querySelectorAll(WRAP_SELECTOR).forEach(function(wrap) { bind(wrap); });
      }
      try { window.__kexoRunStickyColumnResize = run; } catch (_) {}
      try {
        window.addEventListener('kexo:tablesUiConfigApplied', function() { run(); });
      } catch (_) {}

      // Bind dynamically inserted tables (Variants page builds tables after fetch).
      if (typeof MutationObserver !== 'undefined') {
        try {
          var docMo = new MutationObserver(function(muts) {
            muts.forEach(function(m) {
              (m.addedNodes || []).forEach(function(n) {
                if (!(n instanceof Element)) return;
                try {
                  if (n.matches && n.matches(WRAP_SELECTOR)) bind(n);
                } catch (_) {}
                try {
                  if (n.querySelectorAll) n.querySelectorAll(WRAP_SELECTOR).forEach(function(w) { bind(w); });
                } catch (_) {}
              });
            });
          });
          docMo.observe(document.documentElement, { childList: true, subtree: true });
        } catch (_) {}
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
      setTimeout(run, 700);
      setTimeout(run, 1800);
    })();

    function getKpiData() {
      const statsRange = getStatsRange();
      if (kpiCache && kpiCacheRange === statsRange) return kpiCache;
      if (statsRange === 'today') return {};
      return statsCache || {};
    }
    let activeMainTab = 'spy';
    let nextLiveAt = 0;
    let nextRangeAt = 0; // next refresh for Today/Sales (5 min)
    let lastSessionsFetchedAt = 0;
    let lastSessionsMode = null; // 'live' or 'range' - helps avoid Online count flicker when switching modes
    let lastStatsFetchedAt = 0;
    let lastKpisFetchedAt = 0;
    let lastTrafficFetchedAt = 0;
    let lastProductsFetchedAt = 0;
    let kpiCache = null;
    let kpiCacheRange = '';
    let kpiCacheSource = '';
    let liveRefreshInFlight = null;
    let liveSalesPollTimer = null;
    let liveSalesPollInFlight = null;
    let liveSalesPendingPayload = null;
    let liveSalesPendingAt = 0;
    let statsRefreshInFlight = null;
    let trafficRefreshInFlight = null;
    let productsRefreshInFlight = null;
    let kpisRefreshInFlight = null;
    let kpisRefreshRangeKey = '';
    let configStatusRefreshInFlight = null;
    let activeKpiCompareKey = 'conv';
    let reportBuildTokens = { stats: 0, breakdown: 0, products: 0, traffic: 0, sessions: 0, diagnostics: 0, kpiCompare: 0, dashboard: 0 };
    var _intervals = [];
    var _eventSource = null;
    var _fetchAbortControllers = {};
    let lastUpdateTime = null;
    let lastConvertedCountToday = 0;
    let hasSeenConvertedCountToday = false; // prevents "sale" triggers on first load
    let convertedCountDayYmd = null; // YYYY-MM-DD in admin TZ; resets converted-count baseline daily
    let lastSaleAt = null; // ms; authoritative timestamp of most recent sale we know about (Shopify truth preferred)
    let lastOnlineCount = null; // when dateRange !== 'live', we fetch active count so Online always shows real people online
    let onlineCountInFlight = false;
    let liveOnlineChart = null;
    let liveOnlineChartType = '';
    let liveOnlineChartFetchedAt = 0;
    let liveOnlineChartInFlight = null;
    let liveOnlineMapChartInstance = null;
    let rangeOverviewChart = null;
    let rangeOverviewChartKey = '';
    let rangeOverviewChartInFlight = null;
    let shopifySalesToday = null;
    let shopifyOrderCountToday = null;
    let shopifySalesTodayLoaded = false; // true once we have attempted to fetch (success or failure)
    let shopifySalesTodayLoading = false;
    let shopifySessionsToday = null;
    let shopifySessionsTodayLoaded = false;
    let shopifySessionsTodayLoading = false;
    let dashCache = null;
    const PRODUCTS_LEADERBOARD_VIEW_KEY = 'products-leaderboard-view';
    const PRODUCTS_LEADERBOARD_FETCH_LIMIT = 20;
    let productsLeaderboardView = 'title';
    let leaderboardCache = null;
    let leaderboardLoading = false;
    const PRODUCTS_VARIANT_CARDS_VIEW_KEY = 'products-variant-cards-view';
    let productsVariantCardsView = 'finishes';
    let finishesCache = null;
    let finishesLoading = false;
    let lengthsCache = null;
    let lengthsLoading = false;
    let chainStylesCache = null;
    let chainStylesLoading = false;
    let bestSellersCache = null;
    let bestVariantsCache = null;
    let countryPage = 1;
    let lastCountryRowCount = 0;
    let bestGeoProductsPage = 1;
    let bestSellersPage = 1;
    let bestVariantsPage = 1;
    let trafficSourcesPage = 1;
    let trafficTypesPage = 1;
    let dashTopProductsPage = 1;
    let dashTopCountriesPage = 1;
    let dashTrendingUpPage = 1;
    let dashTrendingDownPage = 1;
    let bestSellersSortBy = 'rev';
    let bestSellersSortDir = 'desc';
    const tableSortState = {
      country: { by: 'rev', dir: 'desc' },
      bestGeoProducts: { by: 'rev', dir: 'desc' },
      aov: { by: 'aov', dir: 'desc' },
      bestVariants: { by: 'rev', dir: 'desc' },
      trafficSources: { by: 'rev', dir: 'desc' },
      trafficTypes: { by: 'rev', dir: 'desc' },
    };
    const TABLE_SORT_DEFAULTS = {
      country: { country: 'asc', cr: 'desc', sales: 'desc', clicks: 'desc', rev: 'desc' },
      bestGeoProducts: { country: 'asc', cr: 'desc', sales: 'desc', clicks: 'desc', rev: 'desc' },
      aov: { aov: 'desc' },
      bestVariants: { variant: 'asc', sales: 'desc', clicks: 'desc', rev: 'desc', cr: 'desc' },
      trafficSources: { source: 'asc', cr: 'desc', orders: 'desc', sessions: 'desc', rev: 'desc' },
      trafficTypes: { type: 'asc', cr: 'desc', orders: 'desc', sessions: 'desc', rev: 'desc' },
    };

    function rerenderDashboardFromCache() {
      try {
        if (typeof window.refreshDashboard === 'function') {
          window.refreshDashboard({ force: false, silent: true });
          return true;
        }
      } catch (_) {}
      return false;
    }

    function applyTableRowsPerPageChange(tableId, rows) {
      var id = String(tableId == null ? '' : tableId).trim();
      var n = Number(rows);
      if (!id || !Number.isFinite(n)) return;
      if (id === 'sessions-table') {
        rowsPerPage = n;
        currentPage = 1;
        if (sessionsTotal != null) fetchSessions();
        else renderTable();
        return;
      }
      if (id === 'best-sellers-table') {
        bestSellersPage = 1;
        fetchBestSellers({ force: true });
        return;
      }
      if (id === 'best-variants-table') {
        bestVariantsPage = 1;
        fetchBestVariants({ force: true });
        return;
      }
      if (id === 'country-table') {
        countryPage = 1;
        renderCountry(statsCache || {});
        return;
      }
      if (id === 'best-geo-products-table') {
        bestGeoProductsPage = 1;
        renderBestGeoProducts(statsCache || {});
        return;
      }
      if (id === 'traffic-sources-table') {
        trafficSourcesPage = 1;
        renderTrafficTables(trafficCache || {});
        return;
      }
      if (id === 'traffic-types-table') {
        trafficTypesPage = 1;
        renderTrafficTables(trafficCache || {});
        return;
      }
      if (id === 'dash-top-products') {
        dashTopProductsPage = 1;
        rerenderDashboardFromCache();
        return;
      }
      if (id === 'dash-top-countries') {
        dashTopCountriesPage = 1;
        rerenderDashboardFromCache();
        return;
      }
      if (id === 'dash-trending-up') {
        dashTrendingUpPage = 1;
        rerenderDashboardFromCache();
        return;
      }
      if (id === 'dash-trending-down') {
        dashTrendingDownPage = 1;
        rerenderDashboardFromCache();
        return;
      }
      var typeMatch = id.match(/^type-([a-z0-9-]+)-table$/i);
      if (typeMatch && typeMatch[1]) {
        var typeId = String(typeMatch[1]).toLowerCase();
        typeTablePages[typeId] = 1;
        var def = TYPE_TABLE_DEFS.find(function(d) { return d && d.id === typeId; });
        if (def) renderTypeTable(leaderboardCache, def);
        return;
      }
      try {
        if (typeof window.__adsRowsPerPageChanged === 'function') {
          window.__adsRowsPerPageChanged(id, n);
        }
      } catch (_) {}
    }
    let saleAudio = null;
    let saleMuted = false;
    let saleAudioPrimed = false;
    let saleSoundDeferredOnce = false;
    let saleToastActive = false;
    let saleToastToken = 0; // increments per toast trigger; prevents stale latest-sale fetch overwriting newer toasts
    let saleToastSessionId = null; // best-effort: session_id that opened the current toast (used to avoid double plays)
    let saleToastHideTimer = null;
    let saleToastLastOrderId = null;
    let saleToastLastPayload = null;
    let saleToastPinned = false;
    let saleToastLastShownAt = 0;
    let currentPage = 1;
    let sortBy = 'last_seen';
    let sortDir = 'desc';
    const SORT_DEFAULTS = { landing: 'asc', from: 'asc', arrived: 'desc', source: 'asc', device: 'asc', cart: 'desc', last_seen: 'desc', history: 'desc' };

    (function restoreProductsVariantCardsView() {
      try {
        const raw = sessionStorage.getItem(PRODUCTS_VARIANT_CARDS_VIEW_KEY);
        const s = raw != null ? String(raw).trim().toLowerCase() : '';
        productsVariantCardsView = (s === 'lengths' || s === 'length') ? 'lengths' : 'finishes';
      } catch (_) {
        productsVariantCardsView = 'finishes';
      }
    })();

    (function restoreProductsLeaderboardView() {
      try {
        const raw = sessionStorage.getItem(PRODUCTS_LEADERBOARD_VIEW_KEY);
        const s = raw != null ? String(raw).trim().toLowerCase() : '';
        productsLeaderboardView = (s === 'type') ? 'type' : 'title';
      } catch (_) {
        productsLeaderboardView = 'title';
      }
    })();

    // Auto-configure pixel when opened from Shopify (shop in URL) so merchants don't run mutations manually
    (function ensurePixelOnce() {
      const params = new URLSearchParams(window.location.search);
      const shop = params.get('shop');
      if (shop && /\.myshopify\.com$/i.test(shop)) {
        fetch(API + '/api/pixel/ensure?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok && data.action) console.log('[Live Visitors] Pixel', data.action);
          })
          .catch(function () {});
      }
    })();
    // 'active' = Live view (last 5 min + arrived 60 min). Range mode uses ?range= with pagination.
    let filter = 'active';
    let sessionsTotal = null; // set when fetching by range (today/yesterday/3d/7d); null for Live
    let selectedSessionId = null;
    let timeTick = null;
    const tz = 'Europe/London';
    const MIN_YMD = '2025-02-01';

    function floorAllowsYesterday() {
      try {
        return ymdNowInTz() > MIN_YMD;
      } catch (_) {
        return true;
      }
    }

    function updateServerTimeDisplay() {
      const el = document.getElementById('server-time-msg');
      if (!el) return;
      var now = new Date();
      el.textContent = now.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function updateNextUpdateUi() {
      const block = document.querySelector('#tab-panel-spy .next-update-block');
      if (!block) return;
      const labelEl = document.getElementById('next-update-label');
      const timerWrap = document.getElementById('next-update-timer-wrap');
      const isSales = PAGE === 'sales';
      const show = activeMainTab === 'sales' && isSales;
      block.classList.toggle('is-hidden', !show);
      if (!show) return;

      // "Updates available" CTA when polling is paused (sorting/paging).
      const hasPending = !!liveSalesPendingPayload;
      let pendingBtn = document.getElementById('live-sales-updates-btn');
      if (!pendingBtn) {
        try {
          pendingBtn = document.createElement('button');
          pendingBtn.type = 'button';
          pendingBtn.id = 'live-sales-updates-btn';
          pendingBtn.className = 'btn btn-sm btn-outline-primary is-hidden';
          pendingBtn.textContent = 'Updates available';
          block.appendChild(pendingBtn);
        } catch (_) { pendingBtn = null; }
      }
      if (pendingBtn && pendingBtn.getAttribute('data-bound') !== '1') {
        try {
          pendingBtn.setAttribute('data-bound', '1');
          pendingBtn.addEventListener('click', function(e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            applyLiveSalesPending();
          });
        } catch (_) {}
      }

      if (hasPending && pendingBtn) {
        try { pendingBtn.classList.remove('is-hidden'); } catch (_) {}
        if (labelEl) labelEl.classList.add('is-hidden');
        if (timerWrap) timerWrap.classList.add('is-hidden');
        return;
      } else if (pendingBtn) {
        try { pendingBtn.classList.add('is-hidden'); } catch (_) {}
      }

      if (labelEl) labelEl.classList.remove('is-hidden');
      if (timerWrap) timerWrap.classList.remove('is-hidden');
      if (!timerWrap) return;

      const duration = LIVE_SALES_POLL_MS;
      const target = (typeof nextLiveAt === 'number' && nextLiveAt > Date.now())
        ? nextLiveAt
        : (typeof nextRangeAt === 'number' && nextRangeAt > Date.now())
          ? nextRangeAt
          : (Date.now() + duration);
      const remaining = Math.max(0, target - Date.now());
      const progress = Math.min(1, 1 - remaining / duration);
      timerWrap.style.setProperty('--progress', String(progress));
    }

    function toMs(v) {
      if (v == null || v === '') return null;
      let n = typeof v === 'number' ? v : Number(v);
      if (Number.isNaN(n)) return null;
      if (n < 1e12) n *= 1000;
      return n;
    }

    function formatTs(ms) {
      const n = toMs(ms);
      if (n == null) return '\u2014';
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return '\u2014';
      return d.toLocaleString('en-GB', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
    }

    function formatRelative(ms) {
      const n = toMs(ms);
      if (n == null) return '';
      const s = Math.floor((Date.now() - n) / 1000);
      if (s < 0) return 'now';
      if (s < 60) return s + 's ago';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      var d = Math.floor(s / 86400);
      return d + (d === 1 ? ' day' : ' days') + ' ago';
    }

    function formatSaleTime(ms) {
      const n = toMs(ms);
      if (n == null) return '\u2014';
      const d = new Date(n);
      if (Number.isNaN(d.getTime())) return '\u2014';
      try {
        return d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
      } catch (_) {
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }

    function ymdNowInTz() {
      try {
        // en-CA yields YYYY-MM-DD.
        return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      } catch (_) {
        return new Date().toISOString().slice(0, 10);
      }
    }

    function updateLastSaleAgo() {
      var els = document.querySelectorAll('.last-sale-ago');
      if (!els.length) return;
      var text = lastSaleAt == null ? '\u2014' : formatRelative(lastSaleAt);
      els.forEach(function(el) { el.textContent = text; });
    }

    function setLastSaleAt(ms) {
      const n = toMs(ms);
      if (n == null) return;
      const cur = lastSaleAt == null ? null : toMs(lastSaleAt);
      if (cur == null || n > cur) {
        lastSaleAt = n;
        updateLastSaleAgo();
      }
    }

    function formatDuration(startMs) {
      const n = toMs(startMs);
      if (n == null) return '';
      const s = Math.floor((Date.now() - n) / 1000);
      const m = Math.floor(s / 60);
      const h = Math.floor(m / 60);
      if (h > 0) return h + 'h ' + (m % 60) + 'm';
      if (m > 0) return m + 'm ' + (s % 60) + 's';
      return s + 's';
    }

    var countryNames = { GB: 'UK', US: 'USA', CA: 'CA', AU: 'AU', DE: 'DE', FR: 'FR', IE: 'IE', ES: 'ES', IT: 'IT', NL: 'NL', IN: 'IN', JP: 'JP', DK: 'DK', SE: 'SE', NO: 'NO', TH: 'TH', NZ: 'NZ', RO: 'RO', BE: 'BE', FI: 'FI', AE: 'UAE', XX: '\u2014' };
    var countryNamesFull = { GB: 'United Kingdom', US: 'United States', CA: 'Canada', AU: 'Australia', DE: 'Germany', FR: 'France', IE: 'Ireland', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', IN: 'India', JP: 'Japan', DK: 'Denmark', SE: 'Sweden', NO: 'Norway', TH: 'Thailand', NZ: 'New Zealand', RO: 'Romania', BE: 'Belgium', FI: 'Finland', AE: 'United Arab Emirates', XX: '\u2014' };

    function countryLabel(code) {
      if (!code) return 'Unknown';
      var c = (code || 'XX').toUpperCase().slice(0, 2);
      return countryNames[c] || c;
    }

    function countryLabelFull(code) {
      if (!code) return 'Unknown';
      var c = (code || 'XX').toUpperCase().slice(0, 2);
      return countryNamesFull[c] || countryNames[c] || c;
    }

    // Add width=100 to hotlinked images (? or & depending on existing params).
    function hotImg(url) {
      if (typeof url !== 'string') return url;
      if (/[?&]width=/i.test(url)) return url;
      if (/^https?:\/\//i.test(url)) {
        try {
          const u = new URL(url);
          u.searchParams.set('width', '100');
          return u.toString();
        } catch (_) {
          return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=100';
        }
      }
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=100';
    }
    // Product thumbs: request square (width + height) so object-fit: cover gives identical framing.
    function hotImgSquare(url) {
      if (typeof url !== 'string') return url;
      if (/^https?:\/\//i.test(url)) {
        try {
          const u = new URL(url);
          u.searchParams.set('width', '100');
          u.searchParams.set('height', '100');
          if (u.hostname.includes('shopify.com')) u.searchParams.set('crop', 'center');
          return u.toString();
        } catch (_) {
          const sep = url.indexOf('?') >= 0 ? '&' : '?';
          return url + sep + 'width=100&height=100';
        }
      }
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'width=100&height=100';
    }

    function flagImg(code, label) {
      const raw = (code || '').toString().trim().toLowerCase();
      const safeLabel = label != null ? String(label) : (code ? String(code) : '?');
      const titleAttr = label ? ' title="' + escapeHtml(safeLabel) + '"' : '';
      if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
        return '<span class="flag flag-xs flag-country-xx"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
      }
      return '<span class="flag flag-xs flag-country-' + raw + '"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
    }

    function flagImgSmall(code) {
      const raw = (code || '').toString().trim().toLowerCase();
      if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
        return '<span class="flag flag-xs flag-country-xx" aria-hidden="true"></span>';
      }
      return '<span class="flag flag-xs flag-country-' + raw + '" aria-hidden="true"></span>';
    }

    function arrivedAgo(startedAt) {
      var n = toMs(startedAt);
      if (n == null) return '\u2014';
      var s = Math.floor((Date.now() - n) / 1000);
      if (s < 0) return 'now';
      if (s < 60) return s + (s === 1 ? 'sec' : 'secs');
      if (s < 3600) return Math.floor(s / 60) + 'min';
      if (s < 86400) return Math.floor(s / 3600) + 'hr';
      var d = Math.floor(s / 86400);
      return d + (d === 1 ? 'day' : 'days');
    }

    var storeBaseUrlFallback = '';
    var mainBaseUrlFallback = '';
    var assetsBaseUrlFallback = '';
    var shopForSalesFallback = '';
    var storeBaseUrlLoaded = false;
    (function fetchStoreBaseUrl() {
      fetch(API + '/api/store-base-url', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d) {
            if (d.baseUrl) storeBaseUrlFallback = d.baseUrl;
            if (d.mainBaseUrl) mainBaseUrlFallback = d.mainBaseUrl;
            if (d.assetsBaseUrl) assetsBaseUrlFallback = d.assetsBaseUrl;
            if (d.shopForSales) shopForSalesFallback = d.shopForSales;
            if (sessions.length) renderTable();
            if (assetsBaseUrlFallback) {
              var link = document.querySelector('link[rel="icon"]');
              if (link) link.href = '/assets/favicon.png';
              if (typeof saleAudio !== 'undefined' && saleAudio && typeof getCashRegisterMp3Url === 'function') {
                setSaleAudioSrc(getCashRegisterMp3Url());
              }
            }
            if (shopForSalesFallback) {
              if (activeMainTab === 'products' && typeof refreshProducts === 'function') refreshProducts({ force: false });
              if (activeMainTab === 'stats' && typeof refreshStats === 'function') refreshStats({ force: false });
              if ((activeMainTab === 'channels' || activeMainTab === 'type') && typeof refreshTraffic === 'function') refreshTraffic({ force: false });
            }
          }
          storeBaseUrlLoaded = true;
          if (typeof renderSales === 'function') renderSales(statsCache);
        })
        .catch(function() { storeBaseUrlLoaded = true; if (typeof renderSales === 'function') renderSales(statsCache); });
    })();

    function getShopForSales() {
      var shop = getShopParam() || shopForSalesFallback || null;
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : null;
    }

    function getStoreBaseUrl() {
      var params = new URLSearchParams(window.location.search);
      var shop = params.get('shop');
      if (shop && /\.myshopify\.com$/i.test(shop)) return 'https://' + shop;
      return storeBaseUrlFallback || '';
    }
    function getMainBaseUrl() {
      if (mainBaseUrlFallback) return mainBaseUrlFallback;
      return getStoreBaseUrl();
    }
    function getAssetsBase() {
      if (assetsBaseUrlFallback) return assetsBaseUrlFallback;
      return (API || '') + '/assets';
    }

    var HICON_URL = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/hicon.webp?v=1770084894');
    var DOLLAR_URL = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/dollar.png?v=1770085223');
    // Sale toast chime: try assets/cash-register.mp3 first, fall back to Shopify CDN.
    var CASH_REGISTER_MP3_CDN = 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/cash-register.mp3?v=1770171264';
    function getCashRegisterMp3Url() {
      var defaultAssetsBase = (API || '') + '/assets';
      var assetsBase = '';
      try {
        assetsBase = typeof getAssetsBase === 'function' ? String(getAssetsBase() || '').trim() : '';
      } catch (_) {
        assetsBase = '';
      }
      // Only use a custom assets host/path when it is explicitly configured.
      // The default local /assets path may not include this MP3 in all environments.
      if (assetsBase && assetsBase !== defaultAssetsBase) {
        return assetsBase.replace(/\/+$/, '') + '/cash-register.mp3';
      }
      return CASH_REGISTER_MP3_CDN;
    }

    function bindSaleAudioFallback() {
      if (!saleAudio) return;
      try {
        var a = saleAudio;
        if (a.__kexoSaleAudioOnError) {
          try { a.removeEventListener('error', a.__kexoSaleAudioOnError); } catch (_) {}
        }
        a.__kexoSaleAudioOnError = function() {
          try {
            if (!a || !CASH_REGISTER_MP3_CDN) return;
            var cur = String(a.currentSrc || a.src || '');
            if (cur && cur.indexOf(CASH_REGISTER_MP3_CDN) >= 0) return;
            a.src = CASH_REGISTER_MP3_CDN;
            try { a.load(); } catch (_) {}
          } catch (_) {}
        };
        a.addEventListener('error', a.__kexoSaleAudioOnError);
      } catch (_) {}
    }

    function setSaleAudioSrc(nextUrl) {
      if (!saleAudio) return;
      var url = nextUrl != null ? String(nextUrl) : '';
      if (!url) return;
      bindSaleAudioFallback();
      try {
        saleAudio.src = url;
        try { saleAudio.load(); } catch (_) {}
      } catch (_) {}
    }

    function titleCaseFromHandle(handle) {
      if (typeof handle !== 'string') return null;
      let s = handle;
      try { s = decodeURIComponent(s); } catch (_) {}
      s = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!s) return null;
      return s.split(' ').filter(Boolean).map(function(w) {
        const lower = w.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      }).join(' ');
    }

    function productTitleFromPath(path) {
      if (typeof path !== 'string') return null;
      const m = path.trim().match(/^\/products\/([^/?#]+)/i);
      if (!m) return null;
      return titleCaseFromHandle(m[1]);
    }

    /** For display: /collections/bracelets -> Bracelets, /products/foo -> title-cased product name, else null. */
    function friendlyLabelFromPath(path) {
      if (typeof path !== 'string') return null;
      const p = path.trim();
      const pNorm = p.replace(/\/+$/, '') || '/';
      if (pNorm === '/pages/order-tracker') return 'Order Tracker';
      if (pNorm === '/pages/contact') return 'Contact';
      if (pNorm === '/account/login' || pNorm.startsWith('/account/login/')) return 'Login';
      if (pNorm === '/orders' || pNorm.startsWith('/orders/')) return 'Viewed Order';
      const collectionsMatch = p.match(/^\/collections\/([^/?#]+)/i);
      if (collectionsMatch) return titleCaseFromHandle(collectionsMatch[1]);
      const productsMatch = p.match(/^\/products\/([^/?#]+)/i);
      if (productsMatch) return titleCaseFromHandle(productsMatch[1]);
      return null;
    }

    function landingSortKey(s) {
      function trimStr(v) { return v != null ? String(v).trim() : ''; }
      function normalizeToPath(pathVal, handleVal) {
        var path = trimStr(pathVal);
        var handle = trimStr(handleVal);
        if (!path && handle) path = '/products/' + handle.replace(/^\/+/, '');
        if (path && !path.startsWith('/')) path = '/' + path;
        try {
          if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/';
        } catch (_) {}
        path = (path || '').split('#')[0].split('?')[0];
        path = path.replace(/\/+$/, '');
        if (path === '') path = '/';
        return path;
      }
      function collapseKey(path) {
        if (!path) return '';
        var pathNorm = path.replace(/\/+$/, '');
        if (path.indexOf('/checkouts') === 0) return '/checkouts';
        if (pathNorm === '/cart') return '/cart';
        if (path === '/orders' || pathNorm === '/orders' || path.indexOf('/orders/') === 0) return '/orders';
        return path;
      }

      var path = normalizeToPath(s && s.first_path, s && s.first_product_handle);
      var key = collapseKey(path);
      if (!key) return '';
      if (key === '/') return 'Home';
      if (key === '/orders') return 'Viewed Order';
      if (key === '/cart' || key === '/checkouts') return 'Cart';
      return friendlyLabelFromPath(key) || key;
    }

    function visitsCount(s) {
      var n = 0;
      try { n = s && s.returning_count != null ? Number(s.returning_count) : 0; } catch (_) { n = 0; }
      if (!Number.isFinite(n)) n = 0;
      return n + 1;
    }

    function landingPageCell(s) {
      function trimStr(v) { return v != null ? String(v).trim() : ''; }
      function normalizeHandle(v) {
        var h = trimStr(v);
        if (!h) return '';
        h = h.replace(/^\/+/, '').split('#')[0].split('?')[0].trim().toLowerCase();
        if (!h) return '';
        return h.slice(0, 128);
      }
      function handleFromPath(v) {
        var raw = trimStr(v);
        if (!raw) return '';
        try { if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname || ''; } catch (_) {}
        var m = raw.match(/\/products\/([^/?#]+)/i);
        return m && m[1] ? normalizeHandle(m[1]) : '';
      }

      // Prefer the explicit product_handle fields; fall back to parsing /products/<handle> from paths.
      var handle = normalizeHandle(s && s.first_product_handle) ||
                   normalizeHandle(s && s.last_product_handle) ||
                   handleFromPath(s && s.first_path) ||
                   handleFromPath(s && s.last_path);
      var mainBase = getMainBaseUrl();
      var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
      if (handle && productUrl) {
        var title = '';
        try { title = friendlyLabelFromPath('/products/' + handle) || handle; } catch (_) { title = handle; }
        title = String(title || '').trim() || handle;
        return '<div class="last-action-cell">' +
          '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
            ' data-product-handle="' + escapeHtml(handle) + '"' +
            ' data-product-title="' + escapeHtml(title) + '"' +
          '>' + escapeHtml(title) + '</a>' +
        '</div>';
      }

      // Fallback: show a friendly landing label with no external link and no thumbnail.
      var hasFirst = (s && s.first_path != null && s.first_path !== '') || (s && s.first_product_handle != null && s.first_product_handle !== '');
      var path = '';
      try { path = (s && s.first_path != null && s.first_path !== '' ? s.first_path : (hasFirst ? '' : (s && s.last_path != null ? s.last_path : ''))).trim(); } catch (_) { path = ''; }
      if (path && !path.startsWith('/')) path = '/' + path;
      try { if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/'; } catch (_) {}
      path = (path || '').split('#')[0].split('?')[0];
      path = path.replace(/\/+$/, '');
      if (path === '') path = '/';
      var pathNorm = path ? path.replace(/\/+$/, '') : '';
      var isCheckout = path && path.indexOf('/checkouts') === 0;
      var isHomeOrOrders = path === '/' || path === '/orders' || pathNorm === '/orders' || (path && path.startsWith('/orders/'));
      var isCart = path === '/cart' || pathNorm === '/cart';
      var label = '\u2014';
      if (isHomeOrOrders) label = path === '/' ? 'Home' : 'Viewed Order';
      else if (isCart || isCheckout) label = 'Cart';
      else if (path) label = friendlyLabelFromPath(path) || path;
      label = String(label || '').trim() || '\u2014';
      return '<div class="last-action-cell">' + escapeHtml(label) + '</div>';
    }

    function formatMoney(amount, currencyCode) {
      if (amount == null || typeof amount !== 'number') return '';
      const code = (currencyCode || 'GBP').toUpperCase();
      const sym = code === 'GBP' ? '\u00A3' : code === 'USD' ? '$' : code === 'EUR' ? '\u20AC' : code + ' ';
      return sym + (amount % 1 === 0 ? amount : amount.toFixed(2));
    }

    function formatCompactNumber(amount) {
      const raw = typeof amount === 'number' ? amount : Number(amount);
      const n = Number.isFinite(raw) ? Math.abs(raw) : 0;
      if (n < 1000) return String(Math.round(n));
      if (n >= 1e9) {
        const v = n / 1e9;
        const dec = v < 100 ? 1 : 0;
        return v.toFixed(dec).replace(/\.0$/, '') + 'b';
      }
      if (n >= 1e6) {
        const v = n / 1e6;
        const dec = v < 100 ? 1 : 0;
        return v.toFixed(dec).replace(/\.0$/, '') + 'm';
      }
      // n >= 1e3
      const v = n / 1e3;
      const dec = v < 100 ? 1 : 0;
      return v.toFixed(dec).replace(/\.0$/, '') + 'k';
    }

    function formatMoneyCompact(amount, currencyCode) {
      if (amount == null || typeof amount !== 'number') return '';
      const code = (currencyCode || 'GBP').toUpperCase();
      const sym = code === 'GBP' ? '\u00A3' : code === 'USD' ? '$' : code === 'EUR' ? '\u20AC' : code + ' ';
      const n = Number.isFinite(amount) ? amount : 0;
      const sign = n < 0 ? '-' : '';
      return sign + sym + formatCompactNumber(n);
    }

    function sourceLabel(s) {
      const parts = [];
      if (s.utm_source && String(s.utm_source).trim()) parts.push('utm_source: ' + escapeHtml(String(s.utm_source).trim()));
      if (s.utm_campaign && String(s.utm_campaign).trim()) parts.push('utm_campaign: ' + escapeHtml(String(s.utm_campaign).trim()));
      if (s.utm_medium && String(s.utm_medium).trim()) parts.push('utm_medium: ' + escapeHtml(String(s.utm_medium).trim()));
      if (s.utm_content && String(s.utm_content).trim()) parts.push('utm_content: ' + escapeHtml(String(s.utm_content).trim()));
      if (s.referrer && String(s.referrer).trim()) parts.push('referrer: ' + escapeHtml(String(s.referrer).trim()));
      return parts.join(' ');
    }

    function sourceUtmString(s) {
      return [s.utm_source, s.utm_campaign, s.utm_medium, s.utm_content].filter(Boolean).join(' ').toLowerCase();
    }

    function isGoogleAdsSource(s) {
      return sourceUtmString(s).indexOf('googleads') !== -1;
    }

    /** Derive friendly source name from referrer URL host (when no UTM). Use for tooltip and to collect images. */
    function sourceReferrerFriendlyLabel(s) {
      const ref = s.referrer && String(s.referrer).trim();
      if (!ref) return null;
      try {
        const u = new URL(ref);
        const host = (u.hostname || '').toLowerCase().replace(/^www\./, '');
        if (!host) return null;
        if (host === 'account.heybigday.com') return 'HeyBigDay Account';
        if (host === 'account.hbdjewellery.com') return 'HBD Account';
        if (host === 'hbdjewellery.com' || host.endsWith('.myshopify.com')) return 'Store';
        if (host.indexOf('omnisend') !== -1) return 'Omnisend';
        if (host.indexOf('google') !== -1) return 'Google';
        if (host.indexOf('facebook') !== -1 || host.indexOf('fb.') === 0 || host === 'fb.com') return 'Facebook';
        if (host.indexOf('instagram') !== -1) return 'Instagram';
        if (host.indexOf('pinterest') !== -1) return 'Pinterest';
        if (host.indexOf('tiktok') !== -1) return 'TikTok';
        if (host.indexOf('twitter') !== -1 || host.indexOf('x.com') !== -1) return 'X (Twitter)';
        if (host.indexOf('youtube') !== -1) return 'YouTube';
        if (host.indexOf('linkedin') !== -1) return 'LinkedIn';
        if (host.indexOf('bing') !== -1) return 'Bing';
        if (host.indexOf('yahoo') !== -1) return 'Yahoo';
        if (host.indexOf('duckduckgo') !== -1) return 'DuckDuckGo';
        return host;
      } catch (_) { return null; }
    }

    function sourceFriendlyLabel(s) {
      const str = sourceUtmString(s);
      if (str) {
        if (str.indexOf('googleads') !== -1) return null;
        if (str.indexOf('google') !== -1) return 'Google';
        if (str.indexOf('bing') !== -1) return 'Bing';
        if (str.indexOf('omnisend') !== -1) return 'Omnisend';
        if (str.indexOf('chatgpt') !== -1 || str.indexOf('chat gpt') !== -1) return 'Chatgpt';
        return null;
      }
      return sourceReferrerFriendlyLabel(s);
    }

    function sourceSortKey(s) {
      try {
        const mapped = getMappedSourceKeysForSession(s);
        if (mapped && mapped.length) {
          const key0 = String(mapped[0] || '').trim().toLowerCase();
          if (key0) return trafficSourceLabelForKey(key0, key0) || key0;
        }
      } catch (_) {}
      if (isGoogleAdsSource(s)) return 'Google Ads';
      const friendly = sourceFriendlyLabel(s);
      if (friendly === 'Google') return 'Google';
      if (friendly) return friendly;
      if (sourceUtmString(s)) return 'Other';
      if (s.referrer && String(s.referrer).trim()) return 'Other';
      return 'Direct';
    }

    const SOURCE_GOOGLE_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/google.png?v=1770086632');
    const SOURCE_DIRECT_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/arrow-right.png?v=1770086632');
    const BOUGHT_OVERLAY_SVG = '<i class="fa-light fa-cart-shopping" data-icon-key="live-bought-overlay" aria-hidden="true"></i>';
    const SOURCE_UNKNOWN_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/question.png?v=1770135816');
    const SOURCE_OMNISEND_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/omnisend.png?v=1770141052');
    const SOURCE_BING_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/bing.png?v=1770141094');
    const SOURCE_LIVEVIEW_SOURCE_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/liveview-source-logo.png?v=1770141081');

    // Traffic source mapping (server-configurable)
    const TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'utm_source_platform',
      'utm_creative_format',
      'utm_marketing_tactic',
      'utm_name',
      'utm_cid',
      'utm_referrer',
      'utm_reader',
    ];
    const TRAFFIC_SOURCE_MAP_ALLOWED_PARAM_SET = new Set(TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS);

    let trafficSourceMetaByKey = new Map(); // key -> { label, iconUrl, updatedAt }
    let trafficSourceRulesIndex = new Map(); // param -> value -> [source_key]
    let trafficSourceMetaLoadedAt = 0;
    let trafficSourceMetaInFlight = null;

    function safeUrlParams(url) {
      const raw = url != null ? String(url).trim() : '';
      if (!raw) return null;
      try { return new URL(raw).searchParams; } catch (_) {}
      try { return new URL('https://' + raw).searchParams; } catch (_) {}
      return null;
    }

    function normalizeUtmParam(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (!s) return '';
      return TRAFFIC_SOURCE_MAP_ALLOWED_PARAM_SET.has(s) ? s : '';
    }

    function normalizeUtmValue(v) {
      const s = v != null ? String(v).trim() : '';
      if (!s) return '';
      return (s.length > 256 ? s.slice(0, 256) : s).toLowerCase();
    }

    function buildTrafficSourceRulesIndex(rules) {
      const idx = new Map();
      (Array.isArray(rules) ? rules : []).forEach(function(r) {
        const p = normalizeUtmParam(r && r.utm_param);
        const v = normalizeUtmValue(r && r.utm_value);
        const k = (r && r.source_key != null) ? String(r.source_key).trim().toLowerCase() : '';
        if (!p || !v || !k) return;
        if (!idx.has(p)) idx.set(p, new Map());
        const byVal = idx.get(p);
        if (!byVal.has(v)) byVal.set(v, []);
        byVal.get(v).push(k);
      });
      return idx;
    }

    function refreshTrafficSourceMeta(options = {}) {
      const force = !!options.force;
      const now = Date.now();
      if (!force && trafficSourceMetaLoadedAt && (now - trafficSourceMetaLoadedAt) < 60 * 1000) {
        return Promise.resolve({ ok: true, cached: true });
      }
      if (trafficSourceMetaInFlight) return trafficSourceMetaInFlight;
      trafficSourceMetaInFlight = fetchWithTimeout(API + '/api/traffic-source-meta' + (force ? ('?_=' + now) : ''), { credentials: 'same-origin', cache: 'no-store' }, 20000)
        .then(function(r) { if (!r.ok) throw new Error('Meta HTTP ' + r.status); return r.json(); })
        .then(function(json) {
          const meta = (json && json.meta && typeof json.meta === 'object') ? json.meta : {};
          const m = new Map();
          Object.keys(meta).forEach(function(k) {
            const kk = String(k || '').trim().toLowerCase();
            if (!kk) return;
            const v = meta[k] || {};
            m.set(kk, {
              label: v && v.label != null ? String(v.label) : kk,
              iconUrl: v && v.iconUrl != null ? String(v.iconUrl) : (v && v.icon_url != null ? String(v.icon_url) : null),
              updatedAt: v && v.updatedAt != null ? Number(v.updatedAt) : (v && v.updated_at != null ? Number(v.updated_at) : null),
            });
          });
          const rules = (json && Array.isArray(json.rules)) ? json.rules : [];
          trafficSourceMetaByKey = m;
          trafficSourceRulesIndex = buildTrafficSourceRulesIndex(rules);
          trafficSourceMetaLoadedAt = Date.now();
          try { if (trafficCache) renderTraffic(trafficCache); } catch (_) {}
          try { if (sessions && sessions.length) renderTable(); } catch (_) {}
          return { ok: true, metaCount: m.size, ruleCount: rules.length };
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'trafficSourceMeta', page: PAGE }); } catch (_) {}
          console.error(err);
          return { ok: false, error: err && err.message ? String(err.message) : 'Failed' };
        })
        .finally(function() { trafficSourceMetaInFlight = null; });
      return trafficSourceMetaInFlight;
    }

    function trafficSourceLabelForKey(key, fallbackLabel) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (!k) return fallbackLabel != null ? String(fallbackLabel) : '';
      const meta = trafficSourceMetaByKey.get(k);
      if (meta && meta.label != null && String(meta.label).trim() !== '') return String(meta.label);
      return fallbackLabel != null ? String(fallbackLabel) : k;
    }

    function trafficSourceIconUrlForKey(key) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (!k) return '';
      const meta = trafficSourceMetaByKey.get(k);
      return meta && meta.iconUrl != null && String(meta.iconUrl).trim() !== '' ? String(meta.iconUrl).trim() : '';
    }

    function extractMappedUtmTokensFromSession(s) {
      const out = [];
      function add(param, value) {
        const p = normalizeUtmParam(param);
        const v = normalizeUtmValue(value);
        if (!p || !v) return;
        out.push({ param: p, value: v });
      }
      const params = safeUrlParams(s && s.entry_url ? String(s.entry_url) : '');
      if (params) {
        TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS.forEach(function(p) {
          const v = params.get(p);
          if (v != null && String(v).trim() !== '') add(p, v);
        });
      }
      add('utm_source', s && s.utm_source != null ? String(s.utm_source) : '');
      add('utm_medium', s && s.utm_medium != null ? String(s.utm_medium) : '');
      add('utm_campaign', s && s.utm_campaign != null ? String(s.utm_campaign) : '');
      add('utm_content', s && s.utm_content != null ? String(s.utm_content) : '');

      const seen = new Set();
      const deduped = [];
      out.forEach(function(t) {
        const k = t.param + '\0' + t.value;
        if (seen.has(k)) return;
        seen.add(k);
        deduped.push(t);
      });
      return deduped;
    }

    function getMappedSourceKeysForSession(s) {
      const tokens = extractMappedUtmTokensFromSession(s);
      if (!tokens.length) return [];
      const out = [];
      const seen = new Set();
      tokens.forEach(function(t) {
        const byVal = trafficSourceRulesIndex.get(t.param);
        if (!byVal) return;
        const keys = byVal.get(t.value);
        if (!Array.isArray(keys) || !keys.length) return;
        // Newest mapping wins (rules are appended; API preserves created order).
        for (let i = keys.length - 1; i >= 0; i--) {
          const kk = String(keys[i] || '').trim().toLowerCase();
          if (!kk || seen.has(kk)) continue;
          seen.add(kk);
          out.push(kk);
        }
      });
      return out;
    }

    function trafficSourceBuiltInIconSrc(key) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (!k) return '';
      if (k === 'google_ads') return SOURCE_GOOGLE_IMG;
      if (k === 'google_organic') return SOURCE_GOOGLE_IMG;
      if (k === 'bing_ads' || k === 'bing_organic') return SOURCE_BING_IMG;
      if (k === 'omnisend') return SOURCE_OMNISEND_IMG;
      if (k === 'direct') return SOURCE_DIRECT_IMG;
      return SOURCE_UNKNOWN_IMG;
    }

    // Config modal: source mapping UI
    let trafficSourceMapsShowMappedTokens = false;
    let trafficSourceMapsUiInFlight = null;

    function fetchTrafficSourceMaps(options = {}) {
      const sinceDays = (options && typeof options.sinceDays === 'number') ? options.sinceDays : 30;
      const limitTokens = (options && typeof options.limitTokens === 'number') ? options.limitTokens : 250;
      const unmappedOnly = options && options.unmappedOnly != null ? !!options.unmappedOnly : !trafficSourceMapsShowMappedTokens;
      let url = API + '/api/traffic-source-maps?sinceDays=' + encodeURIComponent(String(sinceDays)) +
        '&limitTokens=' + encodeURIComponent(String(limitTokens)) +
        '&unmappedOnly=' + encodeURIComponent(unmappedOnly ? '1' : '0');
      url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) { if (!r.ok) throw new Error('Maps HTTP ' + r.status); return r.json(); });
    }

    function postTrafficSourceMap(payload) {
      return fetchWithTimeout(API + '/api/traffic-source-maps/map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {}),
      }, 45000).then(function(r) { return r.ok ? r.json() : r.json().catch(function() { return null; }).then(function(j) { throw new Error((j && j.error) ? j.error : ('HTTP ' + r.status)); }); });
    }

    function postTrafficSourceMeta(payload) {
      return fetchWithTimeout(API + '/api/traffic-source-maps/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {}),
      }, 25000).then(function(r) { return r.ok ? r.json() : r.json().catch(function() { return null; }).then(function(j) { throw new Error((j && j.error) ? j.error : ('HTTP ' + r.status)); }); });
    }

    function postTrafficSourceBackfill(payload) {
      return fetchWithTimeout(API + '/api/traffic-source-maps/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload || {}),
      }, 60000).then(function(r) { return r.ok ? r.json() : null; });
    }

    // Preserve token editor inputs across refreshes (bulk mapping UX).
    // Keyed by utm_param + utm_value so "Refresh/Scan/Show mapped tokens" won't wipe in-progress edits.
    let trafficSourceTokenDrafts = new Map(); // tokenKey -> { sourcePick, sourceLabel, iconUrl }

    function normalizeFlatLabel(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (!s) return '';
      return s.replace(/[^a-z0-9]+/g, '');
    }

    function tokenDraftKey(utmParam, utmValue) {
      const p = utmParam != null ? String(utmParam).trim().toLowerCase() : '';
      const v = utmValue != null ? String(utmValue).trim().toLowerCase() : '';
      if (!p || !v) return '';
      return p + '\u0000' + v;
    }

    function setTokenRowOtherMode(row, on) {
      const otherEl = row ? row.querySelector('input[data-field="source_label"]') : null;
      if (otherEl) otherEl.classList.toggle('is-hidden', !on);
    }

    function readTokenDraftFromRow(row) {
      const pickEl = row ? row.querySelector('select[data-field="source_pick"]') : null;
      const labelEl = row ? row.querySelector('input[data-field="source_label"]') : null;
      const iconEl = row ? row.querySelector('input[data-field="icon_url"]') : null;
      const pick = pickEl ? String(pickEl.value || '').trim().toLowerCase() : '';
      const sourceLabel = labelEl ? String(labelEl.value || '') : '';
      const iconUrl = iconEl ? String(iconEl.value || '') : '';
      return { sourcePick: pick, sourceLabel, iconUrl };
    }

    function upsertTokenDraft(key, draft) {
      if (!key) return;
      const pick = draft && draft.sourcePick != null ? String(draft.sourcePick).trim().toLowerCase() : '';
      const label = draft && draft.sourceLabel != null ? String(draft.sourceLabel) : '';
      const icon = draft && draft.iconUrl != null ? String(draft.iconUrl) : '';
      const labelTrim = label.trim();
      const iconTrim = icon.trim();
      const meaningful = (!!pick) || (!!labelTrim) || (!!iconTrim);
      if (!meaningful || (pick === '__other__' && !labelTrim && !iconTrim)) {
        trafficSourceTokenDrafts.delete(key);
        return;
      }
      trafficSourceTokenDrafts.set(key, { sourcePick: pick, sourceLabel: label, iconUrl: icon });
    }

    function stashTokenDraftsFromRoot(root) {
      if (!root || !trafficSourceTokenDrafts || !trafficSourceTokenDrafts.size) return;
      const rows = root.querySelectorAll('.tsm-token-row');
      rows.forEach(function(row) {
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;
        if (!trafficSourceTokenDrafts.has(key)) return; // only update existing drafts (avoid making every row "dirty")
        upsertTokenDraft(key, readTokenDraftFromRow(row));
      });
    }

    function applyTokenDraftsToRoot(root) {
      if (!root || !trafficSourceTokenDrafts || !trafficSourceTokenDrafts.size) return;
      const rows = root.querySelectorAll('.tsm-token-row');
      rows.forEach(function(row) {
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;
        const d = trafficSourceTokenDrafts.get(key);
        if (!d) return;

        const pickEl = row.querySelector('select[data-field="source_pick"]');
        if (pickEl && d.sourcePick != null && String(d.sourcePick).trim() !== '') {
          pickEl.value = String(d.sourcePick).trim().toLowerCase();
        }

        const labelEl = row.querySelector('input[data-field="source_label"]');
        if (labelEl && d.sourceLabel != null) labelEl.value = String(d.sourceLabel);

        const iconEl = row.querySelector('input[data-field="icon_url"]');
        if (iconEl && d.iconUrl != null) iconEl.value = String(d.iconUrl);

        const pickNow = pickEl ? String(pickEl.value || '').trim().toLowerCase() : (d.sourcePick || '');
        const otherOn = (pickNow === '__other__') || (!!String(d.sourceLabel || '').trim() && (!pickNow || pickNow === '__other__'));
        setTokenRowOtherMode(row, otherOn);
      });
    }

    function setTsmSaveMsg(root, msg) {
      if (!root) return;
      const els = root.querySelectorAll('[data-tsm-save-msg]');
      els.forEach(function(el) { el.textContent = msg != null ? String(msg) : ''; });
    }

    function renderTrafficSourceMappingPanel(state) {
      const sources = (state && Array.isArray(state.sources)) ? state.sources.slice() : [];
      const tokens = (state && Array.isArray(state.tokens)) ? state.tokens.slice() : [];
      sources.sort(function(a, b) {
        const al = (a && a.label != null) ? String(a.label) : '';
        const bl = (b && b.label != null) ? String(b.label) : '';
        return al.localeCompare(bl);
      });

      function fmtTs(ms) { return (typeof ms === 'number' && isFinite(ms)) ? formatTs(ms) : '—'; }
      function tokenJumpId(p, v) {
        const s = String(p || '') + '\u0000' + String(v || '');
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return 'tsm-token-' + (h >>> 0).toString(16);
      }

      let html = '';
      html += '<div class="tsm-actions">';
      html +=   '<button type="button" class="tsm-btn primary" data-tsm-action="save-mappings">' + '<span>Save mappings</span>' + '</button>';
      html +=   '<button type="button" class="tsm-btn" data-tsm-action="refresh">' + '<span>Refresh</span>' + '</button>';
      html +=   '<button type="button" class="tsm-btn" data-tsm-action="scan">' + '<span>Scan last 30d</span>' + '</button>';
      html +=   '<button type="button" class="tsm-btn" data-tsm-action="toggle-mapped">' + '<span>' + (trafficSourceMapsShowMappedTokens ? 'Hide mapped tokens' : 'Show mapped tokens') + '</span>' + '</button>';
      html +=   '<span class="tsm-save-msg" data-tsm-save-msg></span>';
      html += '</div>';
      html += '<div class="diag-note">Unmapped tokens appear here first. Pick an existing Source (or choose <strong>Other…</strong>), then press <strong>Save mappings</strong> to apply in bulk. If you map a token again, the newest mapping wins. Paste an icon URL to override the default icon.</div>';

      html += '<div class="diag-section-title">' + '<span>Mapped sources</span>' + '</div>';
      if (!sources.length) {
        html += '<div class="diag-note">No sources yet.</div>';
      } else {
        // Quick-jump row for source meta (icons → scroll to source row)
        try {
          html += '<div class="tsm-jump-row" aria-label="Source shortcuts">';
          sources.forEach(function(s) {
            const key = s && s.source_key != null ? String(s.source_key).trim().toLowerCase() : '';
            if (!key) return;
            const label = s && s.label != null ? String(s.label) : key;
            const iconUrl = s && s.icon_url != null ? String(s.icon_url) : '';
            const builtIn = trafficSourceBuiltInIconSrc(key);
            const previewSrc = (iconUrl && iconUrl.trim())
              ? iconUrl.trim()
              : ((builtIn && builtIn !== SOURCE_UNKNOWN_IMG) ? builtIn : SOURCE_UNKNOWN_IMG);
            const targetId = 'tsm-source-' + key;
            html += '<button type="button" class="tsm-jump-btn" data-tsm-jump-source="' + escapeHtml(targetId) + '" title="' + escapeHtml(label) + '">' +
              '<img src="' + escapeHtml(hotImg(previewSrc) || previewSrc) + '" alt="" />' +
            '</button>';
          });
          html += '</div>';
        } catch (_) {}
        var sourcesBodyHtml = '';
        sources.forEach(function(s) {
          const key = s && s.source_key != null ? String(s.source_key).trim().toLowerCase() : '';
          if (!key) return;
          const label = s && s.label != null ? String(s.label) : key;
          const iconUrl = s && s.icon_url != null ? String(s.icon_url) : '';
          const builtIn = trafficSourceBuiltInIconSrc(key);
          const previewSrc = (iconUrl && iconUrl.trim())
            ? iconUrl.trim()
            : ((builtIn && builtIn !== SOURCE_UNKNOWN_IMG) ? builtIn : '');
          const preview = previewSrc
            ? ('<img class="tsm-icon-preview" src="' + escapeHtml(previewSrc) + '" alt="" onerror="this.classList.add(\'is-hidden\')">')
            : '<span class="tsm-icon-spacer" aria-hidden="true"></span>';
          sourcesBodyHtml += '<div class="grid-row tsm-source-row" role="row" id="tsm-source-' + escapeHtml(key) + '" data-source-key="' + escapeHtml(key) + '">' +
            '<div class="grid-cell" role="cell"><input class="tsm-input" data-field="label" value="' + escapeHtml(label) + '" /></div>' +
            '<div class="grid-cell" role="cell"><code>' + escapeHtml(key) + '</code></div>' +
            '<div class="grid-cell" role="cell"><div class="tsm-icon-input-row">' +
              preview +
              '<input class="tsm-input" data-field="icon_url" placeholder="https://.../icon.png" value="' + escapeHtml(iconUrl || '') + '" />' +
            '</div></div>' +
            '<div class="grid-cell" role="cell"><button type="button" class="tsm-btn primary" data-tsm-action="save-meta">Save</button></div>' +
          '</div>';
        });
        var sourcesGridHtml = (typeof window.buildKexoGridTable === 'function' && window.KEXO_TABLE_DEFS && window.KEXO_TABLE_DEFS['tsm-sources-grid'])
          ? window.buildKexoGridTable({
              innerOnly: true,
              tableClass: (window.KEXO_TABLE_DEFS['tsm-sources-grid'].tableClass || 'tsm-table tsm-sources-grid'),
              ariaLabel: 'Mapped sources',
              columns: (window.KEXO_TABLE_DEFS['tsm-sources-grid'].columns || []),
              bodyHtml: sourcesBodyHtml
            })
          : ('<div class="grid-table tsm-table tsm-sources-grid" role="table" aria-label="Mapped sources">' +
              '<div class="grid-header kexo-grid-header" role="rowgroup"><div class="grid-row grid-row--header" role="row">' +
                '<div class="grid-cell" role="columnheader">Source</div>' +
                '<div class="grid-cell" role="columnheader">Key</div>' +
                '<div class="grid-cell" role="columnheader">Icon URL</div>' +
                '<div class="grid-cell" role="columnheader"></div>' +
              '</div></div>' +
              '<div class="grid-body" role="rowgroup">' + sourcesBodyHtml + '</div></div>');
        html += '<div class="tsm-table-scroll">' + sourcesGridHtml + '</div>';
      }

      html += '<div class="diag-section-title u-mt-md">' + '<span>' + (trafficSourceMapsShowMappedTokens ? 'Tokens (mapped + unmapped)' : 'Unmapped tokens') + '</span>' + '</div>';
      // Quick-jump row: show mapped token icons inline for fast navigation.
      try {
        const MAX_JUMPS = 120;
        const mappedTokens = [];
        tokens.forEach(function(t) {
          const p = t && t.utm_param != null ? String(t.utm_param).trim().toLowerCase() : '';
          const v = t && t.utm_value != null ? String(t.utm_value).trim().toLowerCase() : '';
          if (!p || !v) return;
          const mapped = (t && Array.isArray(t.mapped)) ? t.mapped : [];
          const currentKey = (mapped && mapped[0] && mapped[0].source_key != null) ? String(mapped[0].source_key).trim().toLowerCase() : '';
          if (!currentKey) return;
          const label = (mapped && mapped[0] && mapped[0].label != null) ? String(mapped[0].label) : currentKey;
          const mu = (mapped && mapped[0] && mapped[0].icon_url != null) ? String(mapped[0].icon_url) : '';
          let src = (mu && mu.trim()) ? mu.trim() : '';
          if (!src) {
            const bi = trafficSourceBuiltInIconSrc(currentKey);
            if (bi) src = bi;
          }
          if (!src) src = SOURCE_UNKNOWN_IMG;
          mappedTokens.push({
            jumpId: tokenJumpId(p, v),
            iconSrc: src,
            title: p + '=' + v + ' → ' + label,
          });
        });
        if (mappedTokens.length) {
          html += '<div class="tsm-jump-row" aria-label="Mapped token shortcuts">';
          mappedTokens.slice(0, MAX_JUMPS).forEach(function(it) {
            html += '<button type="button" class="tsm-jump-btn" data-tsm-jump="' + escapeHtml(it.jumpId) + '" title="' + escapeHtml(it.title) + '">' +
              '<img src="' + escapeHtml(hotImg(it.iconSrc) || it.iconSrc) + '" alt="" />' +
            '</button>';
          });
          if (mappedTokens.length > MAX_JUMPS) {
            html += '<span class="tsm-save-msg">+' + escapeHtml(String(mappedTokens.length - MAX_JUMPS)) + ' more</span>';
          }
          html += '</div>';
        }
      } catch (_) {}
      if (!tokens.length) {
        html += '<div class="diag-note">No tokens captured yet. Click <strong>Scan last 30d</strong> (or wait for new sessions) and they will appear here.</div>';
      } else {
        var tokensBodyHtml = '';
        tokens.forEach(function(t) {
          const p = t && t.utm_param != null ? String(t.utm_param).trim().toLowerCase() : '';
          const v = t && t.utm_value != null ? String(t.utm_value).trim().toLowerCase() : '';
          if (!p || !v) return;
          const jumpId = tokenJumpId(p, v);
          const seenCount = t && typeof t.seen_count === 'number' ? t.seen_count : 0;
          const lastSeen = t && typeof t.last_seen_at === 'number' ? t.last_seen_at : null;
          const mapped = (t && Array.isArray(t.mapped)) ? t.mapped : [];
          const currentKey = (mapped && mapped[0] && mapped[0].source_key != null) ? String(mapped[0].source_key).trim().toLowerCase() : '';
          let opts = '<option value="">Choose…</option>';
          sources.forEach(function(s) {
            const sk = s && s.source_key != null ? String(s.source_key).trim().toLowerCase() : '';
            if (!sk) return;
            const sl = s && s.label != null ? String(s.label) : sk;
            opts += '<option value="' + escapeHtml(sk) + '"' + (sk === currentKey ? ' selected' : '') + '>' + escapeHtml(sl) + '</option>';
          });
          opts += '<option value="__other__">Other…</option>';

          tokensBodyHtml += '<div class="grid-row tsm-token-row" role="row" id="' + escapeHtml(jumpId) + '" data-utm-param="' + escapeHtml(p) + '" data-utm-value="' + escapeHtml(v) + '" data-current-source-key="' + escapeHtml(currentKey) + '">' +
            '<div class="grid-cell" role="cell"><code>' + escapeHtml(p) + '=' + escapeHtml(v) + '</code></div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(String(seenCount || 0)) + '<div class="diag-note tsm-seen-subnote">Last: ' + escapeHtml(fmtTs(lastSeen)) + '</div></div>' +
            '<div class="grid-cell" role="cell">' +
              '<div class="tsm-token-map-row">' +
                '<select class="tsm-input tsm-select" data-field="source_pick">' + opts + '</select>' +
                '<input class="tsm-input tsm-token-other is-hidden" data-field="source_label" placeholder="Other source…" />' +
                '<input class="tsm-input tsm-token-icon" data-field="icon_url" placeholder="Icon URL (optional)" />' +
              '</div>' +
              (mapped.length ? ('<div class="tsm-mapped-list">' + mapped.map(function(m) {
                const ml = m && m.label != null ? String(m.label) : (m && m.source_key ? String(m.source_key) : '');
                const mu = m && m.icon_url != null ? String(m.icon_url) : '';
                const mk = m && m.source_key != null ? String(m.source_key).trim().toLowerCase() : '';
                let prevSrc = (mu && mu.trim()) ? mu.trim() : '';
                if (!prevSrc && mk) {
                  const bi = trafficSourceBuiltInIconSrc(mk);
                  if (bi && bi !== SOURCE_UNKNOWN_IMG) prevSrc = bi;
                }
                const prev = prevSrc ? ('<img class="tsm-icon-preview" src="' + escapeHtml(prevSrc) + '" alt="" onerror="this.classList.add(\'is-hidden\')">') : '';
                return '<span class="tsm-mapped-pill">' + prev + escapeHtml(ml) + '</span>';
              }).join('') + '</div>') : '') +
            '</div>' +
          '</div>';
        });
        var tokensGridHtml = (typeof window.buildKexoGridTable === 'function' && window.KEXO_TABLE_DEFS && window.KEXO_TABLE_DEFS['tsm-tokens-grid'])
          ? window.buildKexoGridTable({
              innerOnly: true,
              tableClass: (window.KEXO_TABLE_DEFS['tsm-tokens-grid'].tableClass || 'tsm-table tsm-tokens-grid'),
              ariaLabel: 'Tokens',
              columns: (window.KEXO_TABLE_DEFS['tsm-tokens-grid'].columns || []),
              bodyHtml: tokensBodyHtml
            })
          : ('<div class="grid-table tsm-table tsm-tokens-grid" role="table" aria-label="Tokens">' +
              '<div class="grid-header kexo-grid-header" role="rowgroup"><div class="grid-row grid-row--header" role="row">' +
                '<div class="grid-cell" role="columnheader">Token</div>' +
                '<div class="grid-cell" role="columnheader">Seen</div>' +
                '<div class="grid-cell" role="columnheader">Map / existing</div>' +
              '</div></div>' +
              '<div class="grid-body" role="rowgroup">' + tokensBodyHtml + '</div></div>');
        html += '<div class="tsm-table-scroll">' + tokensGridHtml + '</div>';
        html += '<div class="tsm-actions tsm-actions--footer">' +
          '<button type="button" class="tsm-btn primary" data-tsm-action="save-mappings">' + '<span>Save mappings</span>' + '</button>' +
          '<span class="tsm-save-msg" data-tsm-save-msg></span>' +
        '</div>';
      }

      return html;
    }

    function setTrafficSourceMappingFullscreen(on) {
      const modal = document.getElementById('traffic-sources-modal');
      if (!modal) return;
      modal.classList.toggle('tsm-fullscreen', !!on);
    }

    function bindTrafficSourceMappingFullscreen() {
      const details = document.getElementById('traffic-source-mapping-details');
      if (!details) return;
      if (details.getAttribute('data-tsm-fs-bound')) return;
      details.setAttribute('data-tsm-fs-bound', '1');
      details.addEventListener('toggle', function() {
        setTrafficSourceMappingFullscreen(!!details.open);
        if (details.open) {
          try { details.scrollIntoView({ block: 'start' }); } catch (_) {}
        }
      });
      setTrafficSourceMappingFullscreen(!!details.open);
    }

    let trafficSourceMapsLastState = null;
    let trafficSourceMapsLastLoadedAt = 0;

    function refreshTrafficSourceMappingPanel(options = {}) {
      const rootId = options && options.rootId ? String(options.rootId) : 'traffic-source-mapping-root';
      const root = document.getElementById(rootId);
      if (!root) return Promise.resolve(null);
      try { stashTokenDraftsFromRoot(root); } catch (_) {}
      const force = !!options.force;
      const now = Date.now();
      const fresh = !!(trafficSourceMapsLastState && trafficSourceMapsLastLoadedAt && (now - trafficSourceMapsLastLoadedAt) < 30 * 1000);
      if (!force && fresh) {
        root.innerHTML = renderTrafficSourceMappingPanel(trafficSourceMapsLastState);
        try { applyTokenDraftsToRoot(root); } catch (_) {}
        return Promise.resolve(trafficSourceMapsLastState);
      }

      root.innerHTML = '<div class="diag-loading">Loading\u2026</div>';

      if (trafficSourceMapsUiInFlight) {
        return trafficSourceMapsUiInFlight
          .then(function(state) {
            if (state && state.ok === true) {
              root.innerHTML = renderTrafficSourceMappingPanel(state);
              try { applyTokenDraftsToRoot(root); } catch (_) {}
            }
            else root.innerHTML = '<div class="diag-note">Failed to load source mapping.</div>';
            return state;
          })
          .catch(function(err) {
            try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'trafficSourceMappingPanel', page: PAGE }); } catch (_) {}
            console.error(err);
            root.innerHTML = '<div class="diag-note">Failed to load source mapping. ' + escapeHtml(err && err.message ? String(err.message) : '') + '</div>';
            return null;
          });
      }

      trafficSourceMapsUiInFlight = fetchTrafficSourceMaps({ force: true, unmappedOnly: !trafficSourceMapsShowMappedTokens })
        .then(function(json) {
          if (!json || json.ok !== true) throw new Error('Bad response');
          trafficSourceMapsLastState = json;
          trafficSourceMapsLastLoadedAt = Date.now();
          return json;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'trafficSourceMapsFetch', page: PAGE }); } catch (_) {}
          console.error(err);
          return null;
        })
        .finally(function() { trafficSourceMapsUiInFlight = null; });

      return trafficSourceMapsUiInFlight.then(function(state) {
        if (state && state.ok === true) {
          root.innerHTML = renderTrafficSourceMappingPanel(state);
          try { applyTokenDraftsToRoot(root); } catch (_) {}
        }
        else root.innerHTML = '<div class="diag-note">Failed to load source mapping.</div>';
        return state;
      });
    }

    function initTrafficSourceMappingPanel(options = {}) {
      const rootId = options && options.rootId ? String(options.rootId) : 'traffic-source-mapping-root';
      const root = document.getElementById(rootId);
      if (!root) return;
      try { bindTrafficSourceMappingFullscreen(); } catch (_) {}

      // Draft-preserving editors (so Save/Refresh doesn't wipe other rows).
      root.onchange = function(e) {
        const el = e && e.target ? e.target : null;
        if (!el || !el.closest) return;
        const row = el.closest('.tsm-token-row');
        if (!row) return;
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;

        if (el.matches && el.matches('select[data-field="source_pick"]')) {
          const pick = String(el.value || '').trim().toLowerCase();
          setTokenRowOtherMode(row, pick === '__other__');
          if (pick === '__other__') {
            const otherEl = row.querySelector('input[data-field="source_label"]');
            if (otherEl) { try { otherEl.focus(); } catch (_) {} }
          }
        }

        upsertTokenDraft(key, readTokenDraftFromRow(row));
        try { setTsmSaveMsg(root, ''); } catch (_) {}
      };

      root.oninput = function(e) {
        const el = e && e.target ? e.target : null;
        if (!el || !el.closest) return;
        const row = el.closest('.tsm-token-row');
        if (!row) return;
        const p = (row.getAttribute('data-utm-param') || '').trim();
        const v = (row.getAttribute('data-utm-value') || '').trim();
        const key = tokenDraftKey(p, v);
        if (!key) return;
        upsertTokenDraft(key, readTokenDraftFromRow(row));
        try { setTsmSaveMsg(root, ''); } catch (_) {}
      };

      root.onclick = function(e) {
        const jump = e && e.target ? e.target.closest('[data-tsm-jump],[data-tsm-jump-source]') : null;
        if (jump) {
          const id = (jump.getAttribute('data-tsm-jump') || jump.getAttribute('data-tsm-jump-source') || '').trim();
          if (!id) return;
          const row = document.getElementById(id);
          if (row) {
            try { row.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (_) { try { row.scrollIntoView(true); } catch (_) {} }
            try {
              row.classList.remove('tsm-flash');
              // restart animation
              void row.offsetWidth;
              row.classList.add('tsm-flash');
              setTimeout(function() { try { row.classList.remove('tsm-flash'); } catch (_) {} }, 1400);
            } catch (_) {}
          }
          return;
        }
        const btn = e && e.target ? e.target.closest('button[data-tsm-action]') : null;
        if (!btn) return;
        const action = (btn.getAttribute('data-tsm-action') || '').trim();
        if (action === 'refresh') {
          refreshTrafficSourceMappingPanel({ force: true, rootId: rootId });
          return;
        }
        if (action === 'toggle-mapped') {
          trafficSourceMapsShowMappedTokens = !trafficSourceMapsShowMappedTokens;
          refreshTrafficSourceMappingPanel({ force: true, rootId: rootId });
          return;
        }
        if (action === 'scan') {
          btn.disabled = true;
          postTrafficSourceBackfill({ since_days: 30, limit_sessions: 20000 })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .finally(function() { btn.disabled = false; });
          return;
        }
        if (action === 'save-mappings') {
          const rootEl = root;
          const rows = Array.from(rootEl.querySelectorAll('.tsm-token-row'));

          // Capture any "dirty" rows into drafts (resilient even if a browser misses input events).
          try {
            rows.forEach(function(r) {
              const utmParam = (r.getAttribute('data-utm-param') || '').trim();
              const utmValue = (r.getAttribute('data-utm-value') || '').trim();
              const tkey = tokenDraftKey(utmParam, utmValue);
              if (!tkey) return;
              const currentKey = (r.getAttribute('data-current-source-key') || '').trim().toLowerCase();
              const pickEl = r.querySelector('select[data-field="source_pick"]');
              const pick = pickEl ? String(pickEl.value || '').trim().toLowerCase() : '';
              const labelEl = r.querySelector('input[data-field="source_label"]');
              const iconEl = r.querySelector('input[data-field="icon_url"]');
              const label = labelEl ? String(labelEl.value || '').trim() : '';
              const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
              const dirty = (pick === '__other__') || (!!label) || (!!iconUrl) || (!!pick && pick !== currentKey);
              if (!dirty) return;
              upsertTokenDraft(tkey, { sourcePick: pick, sourceLabel: label, iconUrl: iconUrl });
            });
          } catch (_) {}

          const jobs = [];
          rows.forEach(function(r) {
            const utmParam = (r.getAttribute('data-utm-param') || '').trim();
            const utmValue = (r.getAttribute('data-utm-value') || '').trim();
            if (!utmParam || !utmValue) return;
            const tkey = tokenDraftKey(utmParam, utmValue);
            const currentKey = (r.getAttribute('data-current-source-key') || '').trim().toLowerCase();
            const pickEl = r.querySelector('select[data-field="source_pick"]');
            const pick = pickEl ? String(pickEl.value || '').trim().toLowerCase() : '';
            const labelEl = r.querySelector('input[data-field="source_label"]');
            const iconEl = r.querySelector('input[data-field="icon_url"]');
            const label = labelEl ? String(labelEl.value || '').trim() : '';
            const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
            if (!pick && !label && !iconUrl) return; // nothing entered

            const currentLabel = currentKey ? trafficSourceLabelForKey(currentKey, '') : '';
            if (pick && pick !== '__other__') {
              if (pick === currentKey) {
                if (iconUrl) {
                  jobs.push({
                    kind: 'meta',
                    tokenKey: tkey,
                    payload: { source_key: pick, label: trafficSourceLabelForKey(pick, pick), icon_url: iconUrl },
                  });
                }
                return;
              }
              jobs.push({
                kind: 'map',
                tokenKey: tkey,
                payload: { utm_param: utmParam, utm_value: utmValue, source_key: pick, source_label: '', icon_url: iconUrl || null, since_days: 30, limit_sessions: 50000 },
              });
              return;
            }

            // Other/custom label mode.
            if (!label) return; // can't map without a label

            if (currentKey && normalizeFlatLabel(currentLabel) && normalizeFlatLabel(currentLabel) === normalizeFlatLabel(label)) {
              if (iconUrl) {
                jobs.push({
                  kind: 'meta',
                  tokenKey: tkey,
                  payload: { source_key: currentKey, label: trafficSourceLabelForKey(currentKey, currentKey), icon_url: iconUrl },
                });
              }
              return;
            }

            jobs.push({
              kind: 'map',
              tokenKey: tkey,
              payload: { utm_param: utmParam, utm_value: utmValue, source_label: label, icon_url: iconUrl || null, since_days: 30, limit_sessions: 50000 },
            });
          });

          if (!jobs.length) {
            setTsmSaveMsg(rootEl, 'No pending mappings.');
            return;
          }

          // Disable action buttons while saving.
          rootEl.querySelectorAll('button[data-tsm-action]').forEach(function(b) { b.disabled = true; });
          setTsmSaveMsg(rootEl, 'Saving ' + jobs.length + '…');

          let ok = 0;
          let fail = 0;
          function run(i) {
            if (i >= jobs.length) return Promise.resolve();
            setTsmSaveMsg(rootEl, 'Saving ' + (i + 1) + '/' + jobs.length + '…');
            const j = jobs[i];
            const p = j.kind === 'meta' ? postTrafficSourceMeta(j.payload) : postTrafficSourceMap(j.payload);
            return Promise.resolve(p)
              .then(function() {
                ok += 1;
                if (j && j.tokenKey) trafficSourceTokenDrafts.delete(j.tokenKey);
              })
              .catch(function(err) {
                fail += 1;
                console.error(err);
              })
              .then(function() { return run(i + 1); });
          }

          run(0)
            .then(function() { setTsmSaveMsg(rootEl, 'Saved ' + ok + (fail ? (', failed ' + fail) : '') + '. Refreshing…'); })
            .then(function() { return refreshTrafficSourceMeta({ force: true }); })
            .then(function() { try { refreshTraffic({ force: true }); } catch (_) {} })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .catch(function(err) {
              try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'trafficSourceMapSave', page: PAGE }); } catch (_) {}
              console.error(err);
              setTsmSaveMsg(rootEl, 'Save failed: ' + (err && err.message ? String(err.message) : 'error'));
            })
            .finally(function() {
              // Buttons will be recreated on refresh; if refresh failed, re-enable the existing ones.
              try {
                const rr = document.getElementById(rootId);
                if (rr) rr.querySelectorAll('button[data-tsm-action]').forEach(function(b) { b.disabled = false; });
              } catch (_) {}
            });
          return;
        }
        if (action === 'map-token') {
          const row = btn.closest('.tsm-token-row');
          if (!row) return;
          const utmParam = (row.getAttribute('data-utm-param') || '').trim();
          const utmValue = (row.getAttribute('data-utm-value') || '').trim();
          const labelEl = row.querySelector('input[data-field="source_label"]');
          const iconEl = row.querySelector('input[data-field="icon_url"]');
          const sourceLabel = labelEl ? String(labelEl.value || '').trim() : '';
          const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
          if (!utmParam || !utmValue || !sourceLabel) {
            alert('Please enter a Source name.');
            return;
          }
          btn.disabled = true;
          postTrafficSourceMap({ utm_param: utmParam, utm_value: utmValue, source_label: sourceLabel, icon_url: iconUrl || null, since_days: 30, limit_sessions: 50000 })
            .then(function() { return refreshTrafficSourceMeta({ force: true }); })
            .then(function() { try { refreshTraffic({ force: true }); } catch (_) {} })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .finally(function() { btn.disabled = false; });
          return;
        }
        if (action === 'save-meta') {
          const row = btn.closest('.tsm-source-row');
          if (!row) return;
          const sourceKey = (row.getAttribute('data-source-key') || '').trim();
          const labelEl = row.querySelector('input[data-field="label"]');
          const iconEl = row.querySelector('input[data-field="icon_url"]');
          const label = labelEl ? String(labelEl.value || '').trim() : '';
          const iconUrl = iconEl ? String(iconEl.value || '').trim() : '';
          if (!sourceKey || !label) {
            alert('Source label is required.');
            return;
          }
          btn.disabled = true;
          postTrafficSourceMeta({ source_key: sourceKey, label: label, icon_url: iconUrl || null })
            .then(function() { return refreshTrafficSourceMeta({ force: true }); })
            .then(function() { try { renderTable(); } catch (_) {} })
            .then(function() { try { refreshTraffic({ force: true }); } catch (_) {} })
            .then(function() { return refreshTrafficSourceMappingPanel({ force: true, rootId: rootId }); })
            .finally(function() { btn.disabled = false; });
          return;
        }
      };

      // Initial load (best-effort).
      if (!root.getAttribute('data-tsm-loaded')) {
        root.setAttribute('data-tsm-loaded', '1');
        refreshTrafficSourceMappingPanel({ force: true, rootId: rootId });
      }
    }

    function sourceCell(s) {
      function icon(src, alt, title, extraClass) {
        const cls = (extraClass ? (extraClass + ' ') : '') + 'source-icon-img';
        const t = title ? ' title="' + escapeHtml(String(title)) + '"' : '';
        return '<img src="' + escapeHtml(hotImg(src) || src || '') + '" alt="' + escapeHtml(alt || '') + '" class="' + cls + '" width="20" height="20"' + t + '>';
      }

      // Show source icons driven by Traffic sources + mapping:
      // - If a session matches multiple mapping rules, show multiple icons side-by-side.
      // - Otherwise, show the derived `sessions.traffic_source_key` (includes Direct/no-referrer).
      // This avoids legacy hard-coded UTM/referrer icon heuristics and prevents duplicates.
      const keys = [];
      const seen = new Set();
      function addKey(v) {
        const k = v != null ? String(v).trim().toLowerCase() : '';
        if (!k) return;
        if (seen.has(k)) return;
        seen.add(k);
        keys.push(k);
      }

      try {
        const mapped = getMappedSourceKeysForSession(s);
        (Array.isArray(mapped) ? mapped : []).forEach(addKey);
      } catch (_) {}

      if (!keys.length) {
        // Fallback: use stored source_key (so icon/meta changes go live even when no UTM-token mapping exists).
        let k = s && (s.traffic_source_key ?? s.trafficSourceKey ?? s.source_key ?? s.sourceKey);
        const kk = k != null ? String(k).trim().toLowerCase() : '';
        if (kk === 'other') {
          const ref = s && s.referrer != null ? String(s.referrer).toLowerCase() : '';
          if (ref.includes('heybigday.com') || ref.includes('hbdjewellery.com')) k = 'direct';
        }
        addKey(k);
      }

      if (!keys.length) return '';

      const out = [];
      keys.forEach(function(key) {
        const label = trafficSourceLabelForKey(key, key);
        const metaIcon = trafficSourceIconUrlForKey(key);
        const src = metaIcon || trafficSourceBuiltInIconSrc(key) || SOURCE_UNKNOWN_IMG;
        const extra = key === 'google_ads' ? 'source-googleads-img' : '';
        out.push(icon(src, label, label, extra));
      });
      return out.length ? ('<span class="source-icons">' + out.join('') + '</span>') : '';
    }

    function sourceDetailForPanel(s) {
      const lines = [];
      const entry = s.entry_url && String(s.entry_url).trim();
      if (entry) lines.push('Entry URL (CF referer): ' + entry);
      const ref = s.referrer && String(s.referrer).trim();
      if (ref) lines.push('Referrer: ' + ref);
      if (s.utm_source != null && String(s.utm_source).trim() !== '') lines.push('utm_source: ' + String(s.utm_source).trim());
      if (s.utm_medium != null && String(s.utm_medium).trim() !== '') lines.push('utm_medium: ' + String(s.utm_medium).trim());
      if (s.utm_campaign != null && String(s.utm_campaign).trim() !== '') lines.push('utm_campaign: ' + String(s.utm_campaign).trim());
      if (s.utm_content != null && String(s.utm_content).trim() !== '') lines.push('utm_content: ' + String(s.utm_content).trim());
      if (lines.length === 0) return '—';
      return lines.join('\n');
    }

    function renderRow(s) {
      const countryCode = s.country_code || 'XX';
      const visits = (s.returning_count != null ? s.returning_count : 0) + 1;
      const visitsLabel = visits === 1 ? '1 visit' : visits + ' visits';
      const cartValueNum = s.cart_value != null ? Number(s.cart_value) : NaN;
      const cartVal = s.has_purchased ? '' : ((s.cart_value != null && !Number.isNaN(cartValueNum))
        ? formatMoney(Math.floor(cartValueNum), s.cart_currency)
        : '');
      const saleVal = s.has_purchased ? formatMoney(s.order_total != null ? Number(s.order_total) : null, s.order_currency) : '';
      const cartOrSaleCell = s.has_purchased
        ? '<span class="cart-value-sale">' + escapeHtml(saleVal) + '</span>'
        : cartVal;
      const convertedLeadIcon = s.has_purchased
        ? '<i class="fa-solid fa-sterling-sign converted-row-sale-icon" data-icon-key="table-icon-converted-sale" aria-hidden="true"></i>'
        : '';
      const fromCell = flagImg(countryCode);
      let consentDebug = '';
      if (s && s.meta_json) {
        try {
          const mj = JSON.parse(String(s.meta_json || '{}'));
          consentDebug = (mj && mj.customer_privacy_debug) ? 'yes' : '';
        } catch (_) {}
      }
      return `<div class="grid-row clickable ${s.is_returning ? 'returning' : ''} ${s.has_purchased ? 'converted' : ''}" role="row" data-session-id="${s.session_id}">
        <div class="grid-cell ${s.has_purchased ? 'converted-row' : ''}" role="cell">${convertedLeadIcon}${landingPageCell(s)}</div>
        <div class="grid-cell flag-cell" role="cell">${fromCell}</div>
        <div class="grid-cell source-cell" role="cell">${sourceCell(s)}</div>
        <div class="grid-cell" role="cell">${escapeHtml(s.device || '')}</div>
        <div class="grid-cell cart-value-cell" role="cell">${cartOrSaleCell}</div>
        <div class="grid-cell arrived-cell" role="cell"><span data-started="${s.started_at}">${arrivedAgo(s.started_at)}</span></div>
        <div class="grid-cell last-seen-cell" role="cell"><span data-last-seen="${s.last_seen}">${arrivedAgo(s.last_seen)}</span></div>
        <div class="grid-cell" role="cell">${visitsLabel}</div>
        <div class="grid-cell consent-debug consent-col is-hidden" role="cell">${escapeHtml(consentDebug)}</div>
      </div>`;
    }

    function escapeHtml(str) {
      if (str == null) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function cartSortValue(s) {
      if (s.has_purchased && s.order_total != null) return Number(s.order_total);
      if (s.cart_value != null) { const n = Number(s.cart_value); if (!Number.isNaN(n)) return n; }
      return -Infinity;
    }

    function getSortedSessions() {
      if (!sortBy) return sessions.slice();
      const list = sessions.slice();
      const mult = sortDir === 'asc' ? 1 : -1;
      list.sort(function (a, b) {
        var va, vb;
        if (sortBy === 'landing') {
          va = (landingSortKey(a) || '').toLowerCase();
          vb = (landingSortKey(b) || '').toLowerCase();
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'from') {
          va = (a.country_code || 'ZZ').toUpperCase();
          vb = (b.country_code || 'ZZ').toUpperCase();
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'arrived') {
          va = toMs(a.started_at) ?? 0;
          vb = toMs(b.started_at) ?? 0;
          return mult * (va - vb);
        }
        if (sortBy === 'source') {
          va = sourceSortKey(a);
          vb = sourceSortKey(b);
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'device') {
          va = (a && a.device != null ? String(a.device) : '').trim().toLowerCase();
          vb = (b && b.device != null ? String(b.device) : '').trim().toLowerCase();
          return mult * (va < vb ? -1 : va > vb ? 1 : 0);
        }
        if (sortBy === 'cart') {
          va = cartSortValue(a);
          vb = cartSortValue(b);
          return mult * (va - vb);
        }
        if (sortBy === 'last_seen') {
          va = toMs(a.last_seen) ?? 0;
          vb = toMs(b.last_seen) ?? 0;
          return mult * (va - vb);
        }
        if (sortBy === 'history') {
          va = visitsCount(a);
          vb = visitsCount(b);
          return mult * (va - vb);
        }
        return 0;
      });
      return list;
    }

    function sessionRowSig(s) {
      try {
        if (!s) return '';
        return [
          s.session_id != null ? String(s.session_id) : '',
          s.last_seen != null ? String(s.last_seen) : '',
          s.started_at != null ? String(s.started_at) : '',
          s.has_purchased ? '1' : '0',
          s.order_total != null ? String(s.order_total) : '',
          s.order_currency != null ? String(s.order_currency) : '',
          s.cart_value != null ? String(s.cart_value) : '',
          s.cart_currency != null ? String(s.cart_currency) : '',
          s.cart_qty != null ? String(s.cart_qty) : '',
          s.device != null ? String(s.device) : '',
          s.country_code != null ? String(s.country_code) : '',
          s.is_returning ? '1' : '0',
          s.returning_count != null ? String(s.returning_count) : '',
          s.last_product_handle != null ? String(s.last_product_handle) : '',
          s.first_product_handle != null ? String(s.first_product_handle) : '',
        ].join('|');
      } catch (_) {
        return '';
      }
    }

    function rowElFromHtml(html) {
      const wrap = document.createElement('div');
      wrap.innerHTML = String(html || '').trim();
      return wrap.firstElementChild;
    }

    function patchSessionsTableBody(tbody, pageSessions) {
      if (!tbody) return;
      const list = Array.isArray(pageSessions) ? pageSessions : [];
      if (!list.length) return;

      // Map current DOM rows by session id.
      const existing = new Map();
      Array.from(tbody.querySelectorAll('.grid-row[data-session-id]')).forEach(function(row) {
        const sid = row && row.getAttribute ? (row.getAttribute('data-session-id') || '') : '';
        if (sid) existing.set(String(sid), row);
      });
      const hadRows = existing.size > 0;

      const desired = [];
      list.forEach(function(s) {
        const sid = s && s.session_id != null ? String(s.session_id) : '';
        if (!sid) return;
        const sig = sessionRowSig(s);
        const cur = existing.get(sid);
        if (cur && cur.getAttribute('data-kexo-sig') === sig) {
          existing.delete(sid);
          desired.push(cur);
          return;
        }
        const next = rowElFromHtml(renderRow(s));
        if (!next) return;
        try { next.setAttribute('data-kexo-sig', sig); } catch (_) {}
        if (cur && cur.parentNode === tbody) {
          try { cur.replaceWith(next); } catch (_) {}
          if (hadRows) { try { next.classList.add('kexo-row-update'); } catch (_) {} }
        } else {
          if (hadRows) { try { next.classList.add('kexo-row-insert'); } catch (_) {} }
        }
        existing.delete(sid);
        desired.push(next);
      });

      // Reorder/move nodes in-place.
      let cursor = tbody.firstElementChild;
      desired.forEach(function(row) {
        if (!row) return;
        if (row === cursor) {
          cursor = cursor.nextElementSibling;
          return;
        }
        try { tbody.insertBefore(row, cursor); } catch (_) {}
      });

      // Remove any rows that are no longer in the desired list.
      existing.forEach(function(row) { try { row.remove(); } catch (_) {} });

      // If an empty-state row is still present, remove it.
      try {
        Array.from(tbody.querySelectorAll('.grid-row:not([data-session-id])')).forEach(function(row) { row.remove(); });
      } catch (_) {}

      // Drop animation classes after a moment.
      try {
        desired.forEach(function(row) {
          if (!row || !row.classList) return;
          if (!row.classList.contains('kexo-row-insert') && !row.classList.contains('kexo-row-update')) return;
          setTimeout(function() {
            try { row.classList.remove('kexo-row-insert', 'kexo-row-update'); } catch (_) {}
          }, 900);
        });
      } catch (_) {}
    }

    function renderTable() {
      const tbody = document.getElementById('table-body');
      if (!tbody) return; // Sessions table not present (e.g. Settings page)
      if (tbody.getAttribute('data-kexo-click-bound') !== '1') {
        try {
          tbody.setAttribute('data-kexo-click-bound', '1');
          tbody.addEventListener('click', function(e) {
            const target = e && e.target ? e.target : null;
            // Clicking interactive elements inside a row should not open the side panel.
            // Product links open the Product Insights modal only.
            if (target && target.closest && target.closest('a.js-product-modal-link')) return;
            const row = target && target.closest ? target.closest('.grid-row.clickable[data-session-id]') : null;
            if (!row || !tbody.contains(row)) return;
            selectedSessionId = row.getAttribute('data-session-id');
            openSidePanel(selectedSessionId);
          });
        } catch (_) {}
      }
      const isRangeMode = sessionsTotal != null;
      const totalPages = isRangeMode
        ? Math.max(1, Math.ceil(sessionsTotal / rowsPerPage))
        : Math.max(1, Math.ceil(getSortedSessions().length / rowsPerPage));
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      const start = (currentPage - 1) * rowsPerPage;
      const sorted = getSortedSessions();
      const pageSessions = isRangeMode ? sorted : sorted.slice(start, start + rowsPerPage);
      if (pageSessions.length === 0) {
        var emptyMsg = sessionsLoadError ? sessionsLoadError : 'No sessions in this view.';
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyMsg) + '</div></div>';
      } else {
        // Avoid janky full rerenders: patch rows in-place so new rows animate cleanly.
        patchSessionsTableBody(tbody, pageSessions);
      }
      var paginWrap = document.getElementById('table-pagination');
      if (paginWrap) {
        paginWrap.classList.toggle('is-hidden', totalPages <= 1);
        if (totalPages > 1) paginWrap.innerHTML = buildPaginationHtml(currentPage, totalPages);
      }
      const rowsSelect = document.getElementById('rows-per-page-select');
      if (rowsSelect) rowsSelect.value = String(rowsPerPage);
      updateSortHeaders();
      syncSessionsTableTightMode();
      tickTimeOnSite();
    }

    function syncSessionsTableTightMode() {
      const wrap = document.querySelector('.table-scroll-wrap');
      const table = document.getElementById('sessions-table');
      if (!wrap || !table) return;
      // "Max mode": when all columns fit, remove extra inter-column padding.
      const fits = table.scrollWidth <= wrap.clientWidth + 1;
      wrap.classList.toggle('tight-cols', !!fits);
    }

    function updateSortHeaders() {
      document.querySelectorAll('.table-scroll-wrap .grid-cell.sortable').forEach(function (th) {
        var col = th.getAttribute('data-sort');
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (sortBy === col) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function shouldIgnoreStickyResizeSortClick(e) {
      var target = e && e.target && e.target.closest ? e.target : null;
      if (target && target.closest('.kexo-sticky-resize-handle')) return true;
      var wrap = target ? target.closest('.table-scroll-wrap, .country-table-wrap, .table-responsive') : null;
      var ts = wrap ? Number(wrap.getAttribute('data-sticky-resize-at') || '0') : 0;
      if (!Number.isFinite(ts) || ts <= 0) ts = Number(window.__kexoLastStickyResizeAt || 0);
      return Number.isFinite(ts) && ts > 0 && (Date.now() - ts) < 400;
    }

    function setupSortableHeaders() {
      document.querySelectorAll('.table-scroll-wrap .grid-cell.sortable').forEach(function (th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortBy = col; sortDir = SORT_DEFAULTS[col] || 'asc'; }
          renderTable();
        }
        th.addEventListener('click', function (e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (shouldIgnoreStickyResizeSortClick(e)) return;
          activate();
        });
        th.addEventListener('keydown', function (e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
    }

    function tickTimeOnSite() {
      document.querySelectorAll('#table-body span[data-started]').forEach(span => {
        const started = parseInt(span.getAttribute('data-started'), 10);
        span.textContent = arrivedAgo(started);
      });
      document.querySelectorAll('#table-body span[data-last-seen]').forEach(span => {
        const lastSeen = parseInt(span.getAttribute('data-last-seen'), 10);
        span.textContent = arrivedAgo(lastSeen);
      });
    }

    function pct(v) { return v != null ? v.toFixed(1) + '%' : ''; }

    function formatRevenue0(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '';
      try {
        return '\u00A3' + Math.round(num).toLocaleString('en-GB');
      } catch (_) {
        return '\u00A3' + String(Math.round(num));
      }
    }

    function isEffectivelyZero(value, epsilon) {
      var n = (typeof value === 'number') ? value : Number(value);
      if (!Number.isFinite(n)) return false;
      var tol = (typeof epsilon === 'number' && Number.isFinite(epsilon) && epsilon >= 0) ? epsilon : 1e-9;
      return Math.abs(n) <= tol;
    }

    function normalizeZeroNumber(value, epsilon) {
      var n = (typeof value === 'number') ? value : Number(value);
      if (!Number.isFinite(n)) return null;
      return isEffectivelyZero(n, epsilon) ? 0 : n;
    }

    function formatSignedPercentOneDecimalFromRatio(rawRatio) {
      var ratio = normalizeZeroNumber(rawRatio, 0.0005); // <0.05% should render as 0%
      if (ratio == null) return '\u2014';
      var pct = Math.round(ratio * 1000) / 10;
      if (isEffectivelyZero(pct, 1e-9)) pct = 0;
      var sign = pct > 0 ? '+' : (pct < 0 ? '-' : '');
      return sign + Math.abs(pct).toFixed(1).replace(/\.0$/, '') + '%';
    }

    function formatNegativeCurrencyOrZero(value, useWholePounds) {
      var n = (typeof value === 'number' && Number.isFinite(value)) ? Math.abs(value) : null;
      if (n == null) return '\u2014';
      var epsilon = useWholePounds ? 0.5 : 0.005;
      if (n < epsilon) return useWholePounds ? '\u00A30' : '\u00A30.00';
      var s = useWholePounds ? formatRevenue0(n) : formatRevenue(n);
      if (!s) return '\u2014';
      return '-' + s;
    }

    function crPillHtml(v) {
      const n = v != null ? Number(v) : NaN;
      if (!Number.isFinite(n)) return '';
      return '<span class="aov-card-cr-pill" title="Conversion rate">CR ' + escapeHtml(pct(n)) + '</span>';
    }

    function formatRevenue(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '';
      // Keep dashboard currency formatting consistent everywhere (thousands separators + 2dp).
      try {
        return '\u00A3' + num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (_) {
        return '\u00A3' + num.toFixed(2);
      }
    }

    function formatRevenueSub(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '\u2014';
      return formatRevenue(num) || '\u2014';
    }

    function isIconMode() {
      try {
        return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
      } catch (_) {
        return false;
      }
    }

    function formatRevenueTableHtml(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '—';
      if (isIconMode()) return '\u00A3' + Math.round(num).toLocaleString('en-GB');
      if (num % 1 === 0) return '\u00A3' + num.toLocaleString('en-GB');
      let fixed = null;
      try {
        fixed = num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (_) {
        fixed = num.toFixed(2);
      }
      const parts = String(fixed).split('.');
      return '\u00A3' + parts[0] + '<span class="rev-decimal">.' + (parts[1] || '00') + '</span>';
    }

    function animateTickerText(el, nextText) {
      if (!el) return;
      const prev = el.textContent != null ? String(el.textContent) : '';
      const next = nextText != null ? String(nextText) : '';
      if (prev === next) {
        el.textContent = next;
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'kpi-ticker';
      const stack = document.createElement('span');
      stack.className = 'kpi-ticker-stack';
      const a = document.createElement('span');
      a.className = 'kpi-ticker-line';
      a.textContent = prev;
      const b = document.createElement('span');
      b.className = 'kpi-ticker-line';
      b.textContent = next;
      stack.appendChild(a);
      stack.appendChild(b);
      wrap.appendChild(stack);
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(wrap);
      requestAnimationFrame(function() { wrap.classList.add('run'); });
      setTimeout(function() {
        // Finalize (but only if the wrapper is still present).
        if (el && el.contains(wrap)) el.textContent = next;
      }, 460);
    }

    function animateOdometerText(el, nextText) {
      if (!el) return;
      const next = nextText != null ? String(nextText) : '';
      const prevStored = el.getAttribute('data-odometer');
      const prev = prevStored != null ? String(prevStored) : (el.textContent != null ? String(el.textContent) : '');
      if (prev === next) {
        el.textContent = next;
        el.setAttribute('data-odometer', next);
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'kpi-odometer';
      const stacks = [];
      for (let i = 0; i < next.length; i++) {
        const ch = next[i];
        if (ch >= '0' && ch <= '9') {
          const prevCh = prev[i] || '0';
          const prevDigit = (prevCh >= '0' && prevCh <= '9') ? parseInt(prevCh, 10) : 0;
          const digit = parseInt(ch, 10);
          const digitWrap = document.createElement('span');
          digitWrap.className = 'kpi-odometer-digit';
          const stack = document.createElement('span');
          stack.className = 'kpi-odometer-stack';
          for (let d = 0; d <= 9; d++) {
            const line = document.createElement('span');
            line.textContent = String(d);
            stack.appendChild(line);
          }
          stack.style.transform = 'translateY(' + (-prevDigit) + 'em)';
          digitWrap.appendChild(stack);
          wrap.appendChild(digitWrap);
          stacks.push({ stack, digit });
        } else {
          const span = document.createElement('span');
          span.className = 'kpi-odometer-char';
          span.textContent = ch;
          wrap.appendChild(span);
        }
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(wrap);
      el.setAttribute('data-odometer', next);
      requestAnimationFrame(function() {
        stacks.forEach(function(item) {
          item.stack.style.transform = 'translateY(' + (-item.digit) + 'em)';
        });
      });
      setTimeout(function() {
        if (!el || !el.contains(wrap)) return;
        el.textContent = next;
      }, 460);
    }

    function productUrlFromHandle(handle) {
      const h = handle != null ? String(handle).trim() : '';
      if (!h) return '';
      const base = getMainBaseUrl();
      if (!base) return '';
      return base + '/products/' + encodeURIComponent(h.replace(/^\/+/, ''));
    }

    function resolveSaleToastThumbSrc(data) {
      if (!data) return '';
      const rawThumb = data.productThumbUrl != null ? String(data.productThumbUrl).trim() : '';
      if (rawThumb) return hotImgSquare(rawThumb) || rawThumb;
      const directUrl = data.productUrl != null ? String(data.productUrl).trim() : '';
      const handleUrl = data.productHandle ? productUrlFromHandle(data.productHandle) : '';
      const finalUrl = directUrl || handleUrl;
      if (!finalUrl) return '';
      return (API || '') + '/api/og-thumb?url=' + encodeURIComponent(finalUrl) + '&width=100';
    }

    function setSaleToastContent(patch) {
      patch = patch && typeof patch === 'object' ? patch : {};
      const data = { ...(saleToastLastPayload || {}) };
      const hasOwn = Object.prototype.hasOwnProperty;
      if (hasOwn.call(patch, 'countryCode')) data.countryCode = patch.countryCode;
      if (hasOwn.call(patch, 'productTitle')) data.productTitle = patch.productTitle;
      if (hasOwn.call(patch, 'amountGbp')) data.amountGbp = patch.amountGbp;
      if (hasOwn.call(patch, 'productHandle')) data.productHandle = patch.productHandle;
      if (hasOwn.call(patch, 'productUrl')) data.productUrl = patch.productUrl;
      if (hasOwn.call(patch, 'productThumbUrl')) data.productThumbUrl = patch.productThumbUrl;
      if (hasOwn.call(patch, 'createdAt')) data.createdAt = patch.createdAt;

      const cc = (data.countryCode || 'XX').toString().trim().toUpperCase().slice(0, 2) || 'XX';
      const product = data.productTitle != null ? String(data.productTitle) : '';
      const amountRaw = data.amountGbp != null ? Number(data.amountGbp) : null;
      const amountGbp = (amountRaw != null && Number.isFinite(amountRaw)) ? amountRaw : null;

      saleToastLastPayload = {
        ...data,
        countryCode: cc,
        productTitle: product,
        amountGbp: amountGbp,
      };

      const inlineFlagEl = document.getElementById('sale-toast-inline-flag');
      const productEl = document.getElementById('sale-toast-product');
      const amountEl = document.getElementById('sale-toast-amount');
      if (inlineFlagEl) inlineFlagEl.innerHTML = flagImgSmall(cc);
      if (productEl) productEl.textContent = product && product.trim() ? product : '\u2014';
      if (amountEl) amountEl.textContent = (amountGbp != null) ? (formatRevenue(amountGbp) || '\u00A3\u2014') : '\u00A3\u2014';
      if (data.createdAt != null) {
        try { setLastSaleAt(data.createdAt); } catch (_) {}
      }
    }

    function updateSaleToastToggle() {
      var isPinned = !!saleToastPinned;
      ['last-sale-toggle', 'footer-last-sale-toggle'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('is-on', isPinned);
        btn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
        btn.setAttribute('aria-label', isPinned ? 'Hide last sale toast' : 'Show last sale toast');
        var eyeOn = btn.querySelector('.fa-eye');
        var eyeOff = btn.querySelector('.fa-eye-slash');
        if (eyeOn) eyeOn.style.display = isPinned ? 'none' : '';
        if (eyeOff) eyeOff.style.display = isPinned ? '' : 'none';
      });
    }

    function showSaleToast() {
      const banner = document.getElementById('sale-toast-banner');
      if (!banner) return;
      saleToastActive = true;
      saleToastLastShownAt = Date.now();
      banner.removeAttribute('hidden');
      banner.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function() { banner.classList.add('active'); });
    }

    function hideSaleToast() {
      const banner = document.getElementById('sale-toast-banner');
      if (saleToastHideTimer) {
        clearTimeout(saleToastHideTimer);
        saleToastHideTimer = null;
      }
      if (!banner) {
        saleToastActive = false;
        saleToastSessionId = null;
        return;
      }
      banner.classList.remove('active');
      banner.setAttribute('aria-hidden', 'true');
      setTimeout(function() {
        banner.setAttribute('hidden', '');
        saleToastActive = false;
        saleToastSessionId = null;

        // Sale banner indicates KPIs are about to change. Reset caches once the banner disappears.
        try { clearKpiLocalStorageCaches(); } catch (_) {}
        try { lastKpisFetchedAt = 0; } catch (_) {}
        try { kpiCacheRange = ''; } catch (_) {}
        try { kpiCacheSource = ''; } catch (_) {}
        try { kpiExpandedExtrasFetchedAt = 0; } catch (_) {}

        // Pull fresh KPI data (fast metrics) immediately after cache reset.
        try { refreshKpis({ force: true }); } catch (_) {}
        // Keep the dashboard tables/charts in sync, but do not re-show the global loader.
        try { if (PAGE === 'dashboard' && typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true }); } catch (_) {}
        // Refresh condensed KPI extras as well.
        try { refreshKpiExtrasSoft(); } catch (_) {}
      }, 320);
    }

    let latestSaleFetchInFlight = null;
    function fetchLatestSaleForToast(options = {}) {
      const forceNew = !!(options && options.forceNew);
      if (!forceNew && latestSaleFetchInFlight) return latestSaleFetchInFlight;
      const url = API + '/api/latest-sale?_=' + Date.now();
      const p = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) { return (json && json.ok && json.sale) ? json.sale : null; })
        .catch(function() { return null; })
        .finally(function() { if (latestSaleFetchInFlight === p) latestSaleFetchInFlight = null; });
      latestSaleFetchInFlight = p;
      return p;
    }

    // Latest sales table (/dashboard/live): last 5 converted sessions (desktop only).
    let latestSalesFetchInFlight = null;
    let latestSalesCache = null; // array of normalized rows
    let latestSalesRefetchTimer = null;

    function normalizeLatestSaleRow(row) {
      const r = row && typeof row === 'object' ? row : {};
      const sid = r.session_id != null ? String(r.session_id) : '';
      const cc = r.country_code != null ? String(r.country_code).trim().toUpperCase().slice(0, 2) : 'XX';
      const purchasedAt = r.purchased_at != null ? toMs(r.purchased_at) : null;
      const totalRaw = r.order_total != null ? (typeof r.order_total === 'number' ? r.order_total : parseFloat(String(r.order_total))) : null;
      const total = (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) ? totalRaw : null;
      const cur = r.order_currency != null ? String(r.order_currency).trim().toUpperCase() : '';
      const lastHandle = r.last_product_handle != null ? String(r.last_product_handle).trim() : '';
      const firstHandle = r.first_product_handle != null ? String(r.first_product_handle).trim() : '';
      const out = {
        session_id: sid || null,
        country_code: cc || 'XX',
        purchased_at: purchasedAt,
        order_total: total,
        order_currency: cur || null,
        last_product_handle: lastHandle || null,
        first_product_handle: firstHandle || null,
      };
      const totalGbpRaw = r.order_total_gbp != null ? (typeof r.order_total_gbp === 'number' ? r.order_total_gbp : parseFloat(String(r.order_total_gbp))) : null;
      const totalGbp = (typeof totalGbpRaw === 'number' && Number.isFinite(totalGbpRaw)) ? totalGbpRaw : null;
      if (totalGbp != null) out.order_total_gbp = totalGbp;
      const titleRaw = r.product_title != null ? String(r.product_title).trim() : '';
      if (titleRaw) out.product_title = titleRaw;
      return out;
    }

    function renderLatestSalesTable(rows) {
      const table = document.getElementById('latest-sales-table');
      if (!table) return;
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="dash-empty">No sales</td></tr>';
        return;
      }
      const mainBase = getMainBaseUrl();
      const pageSize = getTableRowsPerPage('latest-sales-table', 'dashboard');
      tbody.innerHTML = list.slice(0, pageSize).map(function(s) {
        const cc = (s && s.country_code ? String(s.country_code) : 'XX').toUpperCase().slice(0, 2) || 'XX';
        const handle = (s && s.last_product_handle) ? String(s.last_product_handle).trim()
          : (s && s.first_product_handle) ? String(s.first_product_handle).trim()
          : '';
        const explicitTitle = (s && s.product_title != null) ? String(s.product_title).trim() : '';
        const title = explicitTitle || (handle ? (titleCaseFromHandle(handle) || '') : '');
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
        const titleHtml = handle
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl || '#') + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title || handle) + '</a>'
            )
          : escapeHtml(title || '\u2014');
        const ago = (s && s.purchased_at != null) ? arrivedAgo(s.purchased_at) : '\u2014';
        const money = (s && typeof s.order_total_gbp === 'number')
          ? (formatMoney(s.order_total_gbp, 'GBP') || '\u2014')
          : (s && s.order_total != null) ? (formatMoney(s.order_total, s.order_currency) || '\u2014') : '\u2014';
        return (
          '<tr>' +
            '<td class="w-1">' + flagImgSmall(cc) + '</td>' +
            '<td>' + titleHtml + '</td>' +
            '<td class="text-end text-muted">' + escapeHtml(ago) + '</td>' +
            '<td class="text-end fw-semibold">' + escapeHtml(money) + '</td>' +
          '</tr>'
        );
      }).join('');
    }

    function upsertLatestSaleRow(nextRaw) {
      const table = document.getElementById('latest-sales-table');
      if (!table) return;
      const next = normalizeLatestSaleRow(nextRaw);
      if (!next || !next.session_id || next.purchased_at == null) return;
      const cur = Array.isArray(latestSalesCache) ? latestSalesCache.slice() : [];
      const idx = cur.findIndex(function(r) { return r && r.session_id && String(r.session_id) === String(next.session_id); });
      if (idx >= 0) {
        cur[idx] = { ...(cur[idx] || {}), ...next };
      } else {
        cur.unshift(next);
      }
      cur.sort(function(a, b) { return (toMs(b && b.purchased_at) || 0) - (toMs(a && a.purchased_at) || 0); });
      latestSalesCache = cur.slice(0, 5);
      renderLatestSalesTable(latestSalesCache);

      // SSE gives us the raw session row (may lack product title / GBP conversion).
      // Refresh the server-enriched latest-sales payload shortly after a new sale is detected.
      if (idx < 0) {
        try {
          if (latestSalesRefetchTimer) clearTimeout(latestSalesRefetchTimer);
          latestSalesRefetchTimer = setTimeout(function() {
            latestSalesRefetchTimer = null;
            try { fetchLatestSales({ force: true }); } catch (_) {}
          }, 400);
        } catch (_) {}
      }
    }

    function fetchLatestSales(options = {}) {
      const force = !!(options && options.force);
      if (!force && latestSalesFetchInFlight) return latestSalesFetchInFlight;
      const table = document.getElementById('latest-sales-table');
      if (!table) return Promise.resolve(null);
      const url = API + '/api/latest-sales?limit=5&_=' + Date.now();
      const p = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) {
          const list = (json && Array.isArray(json.sales)) ? json.sales : [];
          latestSalesCache = list.map(normalizeLatestSaleRow).filter(function(r) { return r && r.session_id; }).slice(0, 5);
          renderLatestSalesTable(latestSalesCache);
          return latestSalesCache;
        })
        .catch(function() { return null; })
        .finally(function() { if (latestSalesFetchInFlight === p) latestSalesFetchInFlight = null; });
      latestSalesFetchInFlight = p;
      return p;
    }

    (function initLatestSalesTable() {
      const table = document.getElementById('latest-sales-table');
      if (!table) return;
      renderLatestSalesTable([]);
      fetchLatestSales({ force: false });
    })();

    function buildSalesKpiUpdateFromStats(data) {
      const rangeKey = getStatsRange();
      const sales = data && data.sales ? data.sales : {};
      const convertedCountMap = data && data.convertedCount ? data.convertedCount : {};
      const salesVal = typeof sales[rangeKey] === 'number' ? sales[rangeKey] : null;
      const orderCountVal = typeof convertedCountMap[rangeKey] === 'number' ? convertedCountMap[rangeKey] : null;
      return {
        labelText: orderCountVal != null ? (orderCountVal + ' Orders') : 'Orders',
        valueText: salesVal != null ? (formatRevenue(salesVal) || '\u2014') : '\u2014',
      };
    }

    // Sale sound: prime/unlock on first user interaction, and retry once on click if autoplay is blocked.
    function primeSaleAudio() {
      if (!saleAudio || saleAudioPrimed) return;
      const a = saleAudio;
      saleAudioPrimed = true;
      const prevMuted = !!a.muted;
      const prevVol = (typeof a.volume === 'number' && Number.isFinite(a.volume)) ? a.volume : 1;
      try { a.preload = 'auto'; } catch (_) {}
      try { a.load(); } catch (_) {}
      try { a.muted = true; } catch (_) {}
      try { a.volume = 0; } catch (_) {}
      try {
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(function() {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
          }).catch(function() {
            saleAudioPrimed = false;
          }).finally(function() {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
            try { a.muted = prevMuted; } catch (_) {}
            try { a.volume = prevVol; } catch (_) {}
          });
          return;
        }
      } catch (_) {
        saleAudioPrimed = false;
      }
      try { a.pause(); } catch (_) {}
      try { a.currentTime = 0; } catch (_) {}
      try { a.muted = prevMuted; } catch (_) {}
      try { a.volume = prevVol; } catch (_) {}
    }

    function playSaleSound(options = {}) {
      const deferOnClick = options.deferOnClick !== false;
      if (saleMuted || !saleAudio) return;
      try { saleAudio.currentTime = 0; } catch (_) {}
      const p = saleAudio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function() {
          if (!deferOnClick) return;
          if (saleSoundDeferredOnce) return;
          saleSoundDeferredOnce = true;
          document.addEventListener('click', function once() {
            saleSoundDeferredOnce = false;
            if (saleMuted || !saleAudio) return;
            try { saleAudio.currentTime = 0; } catch (_) {}
            saleAudio.play().catch(function() {});
          }, { once: true });
        });
      }
    }

    function triggerSaleToast(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const session = opts.session || null;
      const playSound = opts.playSound !== false;
      const payload = opts.payload || null;
      const skipLatest = !!opts.skipLatest;
      const persist = !!opts.persist;
      const toastToken = ++saleToastToken; // newest toast wins
      saleToastLastPayload = null;
      saleToastSessionId = session && session.session_id != null ? String(session.session_id) : null;
      saleToastLastOrderId = null;
      if (persist) {
        saleToastPinned = true;
        updateSaleToastToggle();
      } else if (saleToastPinned) {
        saleToastPinned = false;
        updateSaleToastToggle();
      }

      showSaleToast();

      if (payload) {
        setSaleToastContent(payload);
      } else {
        // Fast, best-effort content from the session update (then refined by truth).
        try {
          const cc = session && session.country_code ? String(session.country_code).toUpperCase().slice(0, 2) : 'XX';
          let productTitle = '';
          let productHandle = '';
          if (session && session.last_product_handle) productHandle = String(session.last_product_handle).trim();
          if (!productHandle && session && session.first_product_handle) productHandle = String(session.first_product_handle).trim();
          if (productHandle) productTitle = titleCaseFromHandle(String(productHandle));
          let amountGbp = null;
          if (session && session.order_total != null) {
            const n = typeof session.order_total === 'number' ? session.order_total : parseFloat(String(session.order_total));
            if (Number.isFinite(n)) amountGbp = n;
          }
          const createdAt = (session && session.purchased_at != null)
            ? session.purchased_at
            : (session && session.last_seen != null)
              ? session.last_seen
              : (session && session.started_at != null)
                ? session.started_at
                : Date.now();
          setSaleToastContent({
            countryCode: cc,
            productTitle: productTitle || 'Processing\u2026',
            amountGbp,
            productHandle: productHandle || '',
            createdAt,
          });
        } catch (_) {}
      }

      if (playSound) {
        try { primeSaleAudio(); } catch (_) {}
        playSaleSound({ deferOnClick: true });
      }

      if (saleToastHideTimer) clearTimeout(saleToastHideTimer);
      if (!persist) saleToastHideTimer = setTimeout(hideSaleToast, 10000);

      if (skipLatest) return;
      fetchLatestSaleForToast({ forceNew: true }).then(function(sale) {
        if (!sale) return;
        if (toastToken !== saleToastToken) return; // stale fetch (a newer sale toast is showing)
        if (!saleToastActive) return;
        const orderId = sale.orderId != null ? String(sale.orderId) : '';
        if (orderId) saleToastLastOrderId = orderId;
        const cc = sale.countryCode ? String(sale.countryCode).toUpperCase().slice(0, 2) : 'XX';
        const product = sale.productTitle && String(sale.productTitle).trim() ? String(sale.productTitle).trim() : '';
        const amount = sale.amountGbp != null ? Number(sale.amountGbp) : null;
        const productHandle = sale.productHandle != null ? String(sale.productHandle).trim() : '';
        const productThumbUrl = sale.productThumbUrl != null ? String(sale.productThumbUrl).trim() : '';
        const createdAt = sale.createdAt != null ? sale.createdAt : null;
        setSaleToastContent({
          countryCode: cc || 'XX',
          productTitle: product || (document.getElementById('sale-toast-product') ? document.getElementById('sale-toast-product').textContent : '—'),
          amountGbp: (amount != null && Number.isFinite(amount)) ? amount : null,
          productHandle: productHandle || '',
          productThumbUrl: productThumbUrl || '',
          createdAt,
        });
      });
    }

    function buildSaleToastPayloadFromSale(sale) {
      if (!sale) return null;
      const cc = sale.countryCode ? String(sale.countryCode).toUpperCase().slice(0, 2) : 'XX';
      const productTitle = sale.productTitle && String(sale.productTitle).trim() ? String(sale.productTitle).trim() : '';
      const amount = sale.amountGbp != null ? Number(sale.amountGbp) : null;
      return {
        countryCode: cc || 'XX',
        productTitle,
        amountGbp: (amount != null && Number.isFinite(amount)) ? amount : null,
        productHandle: sale.productHandle != null ? String(sale.productHandle).trim() : '',
        productThumbUrl: sale.productThumbUrl != null ? String(sale.productThumbUrl).trim() : '',
        createdAt: sale.createdAt != null ? sale.createdAt : null,
      };
    }

    function triggerManualSaleToast(persist) {
      const keep = !!persist;
      const cached = saleToastLastPayload;
      const hasCache = cached && (cached.productTitle || cached.amountGbp != null || cached.productHandle || cached.productThumbUrl);
      const placeholder = { countryCode: 'XX', productTitle: 'Loading\u2026', amountGbp: null, productHandle: '', productThumbUrl: '', createdAt: null };
      const payload = hasCache ? cached : placeholder;
      // Show banner immediately (no wait for API), then refresh when fetch completes.
      triggerSaleToast({ origin: 'manual', payload: payload, playSound: true, skipLatest: true, persist: keep });
      fetchLatestSaleForToast({ forceNew: true }).then(function(sale) {
        const next = buildSaleToastPayloadFromSale(sale);
        if (!next) return;
        if (saleToastActive) setSaleToastContent(next);
      });
    }

    (function initSaleToastToggle() {
      function handleToggle(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (saleToastPinned) {
          saleToastPinned = false;
          updateSaleToastToggle();
          hideSaleToast();
        } else {
          triggerManualSaleToast(true);
        }
      }
      ['last-sale-toggle', 'footer-last-sale-toggle'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handleToggle);
      });
      updateSaleToastToggle();
    })();

    (function initSaleToastCloseBtn() {
      var btn = document.getElementById('sale-toast-close');
      if (!btn) return;
      btn.addEventListener('click', function(e) {
        if (e) e.preventDefault();
        saleToastPinned = false;
        updateSaleToastToggle();
        hideSaleToast();
      });
    })();

    function getShopParam() {
      var p = new URLSearchParams(window.location.search);
      var shop = p.get('shop') || '';
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : null;
    }

    function fetchShopifySales() {
      var shop = getShopForSales();
      if (!shop || getStatsRange() !== 'today') {
        // If the store-base-url lookup is done and we still have no shop, stop waiting and fall back to DB.
        if (getStatsRange() === 'today' && storeBaseUrlLoaded && !shop) shopifySalesTodayLoaded = true;
        shopifySalesTodayLoading = false;
        return;
      }
      if (shopifySalesTodayLoading) return;
      shopifySalesTodayLoading = true;
      fetch(API + '/api/shopify-sales?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          shopifySalesToday = data && typeof data.salesToday === 'number' ? data.salesToday : null;
          shopifyOrderCountToday = data && typeof data.orderCountToday === 'number' ? data.orderCountToday : null;
          shopifySalesTodayLoaded = true;
          shopifySalesTodayLoading = false;
          renderSales(statsCache);
          renderLiveKpis(getKpiData());
        })
        .catch(function() {
          shopifySalesToday = null;
          shopifyOrderCountToday = null;
          shopifySalesTodayLoaded = true;
          shopifySalesTodayLoading = false;
          renderSales(statsCache);
          renderLiveKpis(getKpiData());
        });
    }

    function fetchShopifySessions() {
      var shop = getShopForSales();
      if (!shop || getStatsRange() !== 'today') {
        if (getStatsRange() === 'today' && storeBaseUrlLoaded && !shop) shopifySessionsTodayLoaded = true;
        shopifySessionsTodayLoading = false;
        return;
      }
      if (shopifySessionsTodayLoading) return;
      shopifySessionsTodayLoading = true;
      fetch(API + '/api/shopify-sessions?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          shopifySessionsToday = data && typeof data.sessionsToday === 'number' ? data.sessionsToday : null;
          shopifySessionsTodayLoaded = true;
          shopifySessionsTodayLoading = false;
          renderLiveKpis(getKpiData());
        })
        .catch(function() {
          shopifySessionsToday = null;
          shopifySessionsTodayLoaded = true;
          shopifySessionsTodayLoading = false;
          renderLiveKpis(getKpiData());
        });
    }

    function fetchBestSellers(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        bestSellersCache = null;
        renderBestSellers(null);
        return Promise.resolve(null);
      }
      var pageSize = getTableRowsPerPage('best-sellers-table', 'product');
      let url = API + '/api/shopify-best-sellers?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange()) +
          '&page=' + encodeURIComponent(String(bestSellersPage || 1)) +
          '&pageSize=' + encodeURIComponent(String(pageSize)) +
          '&sort=' + encodeURIComponent(String(bestSellersSortBy || 'rev')) +
          '&dir=' + encodeURIComponent(String(bestSellersSortDir || 'desc'));
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data || {} }; }).catch(function() { return { ok: r.ok, status: r.status, data: {} }; }); })
        .then(function(result) {
          if (result.ok) {
            bestSellersCache = result.data;
            renderProductsChart(result.data);
            renderBestSellers(result.data);
            return result.data;
          }
          var msg = (result.data && result.data.error) ? result.data.error : ('Error ' + result.status);
          if (result.data && result.data.hint) msg += '. ' + result.data.hint;
          bestSellersCache = null;
          renderBestSellers(null, msg);
          return null;
        })
        .catch(function() { bestSellersCache = null; renderBestSellers(null); return null; });
    }

    function normalizeProductsLeaderboardView(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      return s === 'type' ? 'type' : 'title';
    }

    function labelForProductsLeaderboardView(view) {
      return normalizeProductsLeaderboardView(view) === 'type' ? 'Product Type' : 'Product Title';
    }

    function updateProductsLeaderboardDropdownUi() {
      const view = normalizeProductsLeaderboardView(productsLeaderboardView);
      const labelEl = document.getElementById('products-leaderboard-label');
      const grid = document.getElementById('leaderboard-cards-grid');
      const wrap = document.getElementById('leaderboard-cards-wrap');
      const menu = document.getElementById('products-leaderboard-menu');
      if (labelEl) labelEl.textContent = labelForProductsLeaderboardView(view);
      if (grid) grid.setAttribute('data-leaderboard-view', view);
      if (wrap) wrap.setAttribute('data-leaderboard-view', view);
      if (menu) {
        const opts = menu.querySelectorAll('.aov-cards-title-option');
        opts.forEach(function(el) {
          const v = normalizeProductsLeaderboardView(el && el.getAttribute ? el.getAttribute('data-view') : '');
          el.setAttribute('aria-current', v === view ? 'true' : 'false');
        });
      }
    }

    function closeProductsLeaderboardMenu() {
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
    }

    function toggleProductsLeaderboardMenu() {
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      if (!btn || !menu) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeProductsLeaderboardMenu();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
    }

    function setProductsLeaderboardView(nextView, options = {}) {
      const force = !!(options && options.force);
      const view = normalizeProductsLeaderboardView(nextView);
      productsLeaderboardView = view;
      try { sessionStorage.setItem(PRODUCTS_LEADERBOARD_VIEW_KEY, view); } catch (_) {}
      updateProductsLeaderboardDropdownUi();
      closeProductsLeaderboardMenu();
      renderProductsLeaderboard(leaderboardCache);
      if (activeMainTab !== 'breakdown' && activeMainTab !== 'products') return;
      fetchProductsLeaderboard({ force }).catch(function() {});
    }

    (function initProductsLeaderboardDropdown() {
      updateProductsLeaderboardDropdownUi();
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      const root = document.getElementById('products-leaderboard-dropdown');
      if (!btn || !menu || !root) return;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleProductsLeaderboardMenu();
      });
      menu.addEventListener('click', function(e) {
        const t = e && e.target ? e.target : null;
        const opt = t && t.closest ? t.closest('.aov-cards-title-option') : null;
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        setProductsLeaderboardView(opt.getAttribute('data-view') || '', { force: false });
      });
      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        if (target && root.contains && root.contains(target)) return;
        closeProductsLeaderboardMenu();
      });
      document.addEventListener('keydown', function(e) {
        if (!e || e.key !== 'Escape') return;
        closeProductsLeaderboardMenu();
      });
    })();

    function normalizeProductsVariantCardsView(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (s === 'lengths' || s === 'length') return 'lengths';
      return 'finishes';
    }

    function labelForProductsVariantCardsView(view) {
      return normalizeProductsVariantCardsView(view) === 'lengths' ? 'Variant Length' : 'Variant Finish';
    }

    function updateProductsVariantCardsDropdownUi() {
      const view = normalizeProductsVariantCardsView(productsVariantCardsView);
      const labelEl = document.getElementById('products-variant-cards-label');
      const grid = document.getElementById('finishes-cards-grid');
      const wrap = document.getElementById('finishes-cards-wrap');
      const menu = document.getElementById('products-variant-cards-menu');
      if (labelEl) labelEl.textContent = labelForProductsVariantCardsView(view);
      if (grid) grid.setAttribute('data-cards-view', view);
      if (wrap) wrap.setAttribute('data-cards-view', view);
      if (menu) {
        const opts = menu.querySelectorAll('.aov-cards-title-option');
        opts.forEach(function(el) {
          const v = normalizeProductsVariantCardsView(el && el.getAttribute ? el.getAttribute('data-view') : '');
          el.setAttribute('aria-current', v === view ? 'true' : 'false');
        });
      }
    }

    function closeProductsVariantCardsMenu() {
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
    }

    function toggleProductsVariantCardsMenu() {
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      if (!btn || !menu) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeProductsVariantCardsMenu();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
    }

    function setProductsVariantCardsView(nextView, options = {}) {
      const force = !!(options && options.force);
      const view = normalizeProductsVariantCardsView(nextView);
      productsVariantCardsView = view;
      try { sessionStorage.setItem(PRODUCTS_VARIANT_CARDS_VIEW_KEY, view); } catch (_) {}
      updateProductsVariantCardsDropdownUi();
      closeProductsVariantCardsMenu();
      if (activeMainTab !== 'breakdown' && activeMainTab !== 'products') return;
      if (view === 'lengths') {
        if (lengthsCache) renderLengths(lengthsCache);
        fetchLengths({ force }).catch(function() {});
      } else {
        if (finishesCache) renderFinishes(finishesCache);
        fetchFinishes({ force }).catch(function() {});
      }
    }

    (function initProductsVariantCardsDropdown() {
      updateProductsVariantCardsDropdownUi();
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      const root = document.getElementById('products-variant-cards-dropdown');
      if (!btn || !menu || !root) return;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleProductsVariantCardsMenu();
      });
      menu.addEventListener('click', function(e) {
        const t = e && e.target ? e.target : null;
        const opt = t && t.closest ? t.closest('.aov-cards-title-option') : null;
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        setProductsVariantCardsView(opt.getAttribute('data-view') || '', { force: false });
      });
      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        if (target && root.contains && root.contains(target)) return;
        closeProductsVariantCardsMenu();
      });
      document.addEventListener('keydown', function(e) {
        if (!e || e.key !== 'Escape') return;
        closeProductsVariantCardsMenu();
      });
    })();

    function fetchProductsLeaderboard(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        leaderboardLoading = false;
        leaderboardCache = null;
        renderProductsLeaderboard(null);
        return Promise.resolve(null);
      }
      leaderboardLoading = true;
      if (!leaderboardCache) renderProductsLeaderboard(null);
      let url = API + '/api/shopify-leaderboard?shop=' + encodeURIComponent(shop) +
        '&topProducts=' + encodeURIComponent(String(PRODUCTS_LEADERBOARD_FETCH_LIMIT)) +
        '&topTypes=' + encodeURIComponent(String(PRODUCTS_LEADERBOARD_FETCH_LIMIT)) +
        '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          leaderboardCache = data;
          leaderboardLoading = false;
          renderProductsLeaderboard(data);
          renderAllTypeTables(data);
          return data;
        })
        .catch(function() { leaderboardCache = null; leaderboardLoading = false; renderProductsLeaderboard(null); renderAllTypeTables(null); return null; })
        .finally(function() { leaderboardLoading = false; });
    }

    function productsLeaderboardIsMobile() {
      return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    function productsLeaderboardIsMedium() {
      return !!(window.matchMedia && window.matchMedia('(max-width: 980px)').matches);
    }

    function productsLeaderboardColumnsForView(view) {
      const v = normalizeProductsLeaderboardView(view);
      const isMobile = productsLeaderboardIsMobile();
      const isMedium = !isMobile && productsLeaderboardIsMedium();
      if (v === 'type') {
        if (isMobile) return 1;
        if (isMedium) return 2;
        return 4;
      }
      // v === 'title'
      if (isMobile) return 2;
      if (isMedium) return 4;
      return 6;
    }

    function productsLeaderboardMaxItems() {
      return productsLeaderboardIsMobile() ? 4 : 12;
    }

    function sliceProductsLeaderboardEven(list, view) {
      const arr = Array.isArray(list) ? list : [];
      const cols = productsLeaderboardColumnsForView(view);
      const max = productsLeaderboardMaxItems();
      const target = Math.min(arr.length, max);
      if (target <= 0) return [];
      if (cols <= 1 || target < cols) return arr.slice(0, target);
      const even = target - (target % cols);
      return arr.slice(0, even || target);
    }

    function renderProductsLeaderboard(data) {
      const view = normalizeProductsLeaderboardView(productsLeaderboardView);
      const grid = document.getElementById('leaderboard-cards-grid');
      if (!grid) return;
      grid.setAttribute('data-leaderboard-view', view);

      const hasData = !!(data && data.ok);
      const listAll = hasData ? (view === 'type' ? (data.byType || []) : (data.byTitle || [])) : [];
      const list = sliceProductsLeaderboardEven(listAll, view);

      if (!hasData || !listAll.length) {
        if (leaderboardLoading) {
          grid.innerHTML = '<div class="aov-card aov-card-empty aov-card--leaderboard-loading"><span class="inline-spinner" aria-hidden="true"></span><span>Building leaderboards...</span></div>';
        } else {
          grid.innerHTML = '<div class="aov-card aov-card-empty">No data</div>';
        }
        return;
      }

      if (view === 'type') {
        grid.innerHTML = list.map(function(row) {
          const label = row && (row.label || row.key) ? String(row.label || row.key) : 'Unknown';
          const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
          const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
          const cr = crPillHtml(row && row.cr);
          return '<div class="aov-card aov-card--leaderboard aov-card--leaderboard-type">' +
              '<div class="aov-card-left"><span class="aov-card-name leaderboard-type-name">' + escapeHtml(label || 'Unknown') + '</span></div>' +
              '<div class="aov-card-value"><span class="aov-card-value-main">' + escapeHtml(value) + '</span>' + cr + '</div>' +
            '</div>';
        }).join('');
        return;
      }

      // view === 'title'
      const mainBase = getMainBaseUrl();
      grid.innerHTML = list.map(function(row) {
        const title = row && row.title != null ? String(row.title) : 'Product';
        const handle = row && row.handle ? String(row.handle) : '';
        const productId = (row && row.product_id) ? String(row.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const thumb = row && row.thumb_url ? String(row.thumb_url) : '';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = crPillHtml(row && row.cr);
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        const canOpen = handle || (productId && /^\d+$/.test(productId));
        const thumbInner = '<span class="thumb-wrap">' +
            (thumb
              ? '<img class="landing-thumb" src="' + escapeHtml(hotImgSquare(thumb) || thumb) + '" alt="" loading="lazy" onerror="this.remove()">'
              : '') +
          '</span>';
        const img = canOpen
          ? '<a class="leaderboard-thumb-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener" aria-label="Open product: ' + escapeHtml(title || 'Product') + '"' +
            (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
            (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
            (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
            (thumb ? (' data-product-thumb="' + escapeHtml(thumb) + '"') : '') +
          '>' + thumbInner + '</a>'
          : thumbInner;
        return '<div class="aov-card aov-card--leaderboard aov-card--leaderboard-title">' +
            '<div class="aov-card-left">' +
              img +
              '<span class="aov-card-name sr-only">' + escapeHtml(title || 'Product') + '</span>' +
            '</div>' +
            '<div class="aov-card-value"><span class="aov-card-value-main">' + escapeHtml(value) + '</span>' + cr + '</div>' +
          '</div>';
      }).join('');
    }

    // ── Product Type Tables (Necklaces, Bracelets, Earrings, Sets, Charms, Extras) ──
    function setHiddenById(id, hidden) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('is-hidden', !!hidden);
    }

    var TYPE_TABLE_DEFS = [
      { id: 'necklaces', keys: ['necklaces', 'necklace'] },
      { id: 'bracelets', keys: ['bracelets', 'bracelet'] },
      { id: 'earrings',  keys: ['earrings', 'earring'] },
      { id: 'sets',      keys: ['jewellery sets', 'jewellery set', 'jewelry sets', 'jewelry set', 'sets', 'set'] },
      { id: 'charms',    keys: ['charms', 'charm'] },
      { id: 'extras',    keys: ['extras', 'extra'] },
    ];
    function getTypeTablePageSize(def) {
      var id = def && def.id ? ('type-' + def.id + '-table') : '';
      return getTableRowsPerPage(id, 'product');
    }
    var typeTablePages = {};
    TYPE_TABLE_DEFS.forEach(function(d) { typeTablePages[d.id] = 1; });

    function getTypeProducts(data, def) {
      if (!data || !data.productsByType) return [];
      var out = [];
      for (var i = 0; i < def.keys.length; i++) {
        var arr = data.productsByType[def.keys[i]];
        if (Array.isArray(arr)) out = out.concat(arr);
      }
      return out;
    }

    function renderTypeTable(data, def) {
      var tbody = document.getElementById('type-' + def.id + '-body');
      if (!tbody) return;
      var rows = getTypeProducts(data, def);
      var sessionsTotal = 0;
      for (var i = 0; i < rows.length; i++) sessionsTotal += Number(rows[i] && rows[i].sessions) || 0;
      var hideCard = !leaderboardLoading && sessionsTotal <= 0;
      setHiddenById('stats-type-' + def.id, hideCard);
      if (hideCard) {
        tbody.innerHTML = '';
        updateCardPagination('type-' + def.id, 1, 1);
        return;
      }
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('type-' + def.id, 1, 1);
        return;
      }
      var pageSize = getTypeTablePageSize(def);
      var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      var page = clampPage(typeTablePages[def.id] || 1, totalPages);
      typeTablePages[def.id] = page;
      updateCardPagination('type-' + def.id, page, totalPages);
      var start = (page - 1) * pageSize;
      var pageRows = rows.slice(start, start + pageSize);
      const mainBase = getMainBaseUrl();
      tbody.innerHTML = pageRows.map(function(r) {
        var title = r && r.title ? String(r.title) : '—';
        var orders = r && r.orders != null ? Number(r.orders) : 0;
        var sessions = r && r.sessions != null ? Number(r.sessions) : 0;
        var rev = r && r.revenueGbp != null ? formatRevenueTableHtml(r.revenueGbp) : '—';
        var cr = r && r.cr != null ? pct(r.cr) : '—';
        var handle = r && r.handle ? String(r.handle) : '';
        var productId = (r && r.product_id) ? String(r.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        var canOpen = handle || (productId && /^\d+$/.test(productId));
        var nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title);
        var name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + nameInner + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + formatSessions(sessions) + '</div>' +
          '<div class="grid-cell" role="cell">' + formatSessions(orders) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
          '<div class="grid-cell" role="cell">' + rev + '</div>' +
        '</div>';
      }).join('');
    }

    function renderAllTypeTables(data) {
      TYPE_TABLE_DEFS.forEach(function(def) { renderTypeTable(data, def); });
      // If every type table is hidden (0 sessions), hide the whole row.
      try {
        var rowWrap = document.getElementById('products-type-tables-row');
        if (rowWrap) {
          var anyVisible = false;
          for (var i = 0; i < TYPE_TABLE_DEFS.length; i++) {
            var id = TYPE_TABLE_DEFS[i] && TYPE_TABLE_DEFS[i].id ? String(TYPE_TABLE_DEFS[i].id) : '';
            if (!id) continue;
            var card = document.getElementById('stats-type-' + id);
            if (card && !card.classList.contains('is-hidden')) { anyVisible = true; break; }
          }
          rowWrap.classList.toggle('is-hidden', !anyVisible);
        }
        var note = document.getElementById('products-hidden-tables-note');
        if (note) {
          var hiddenCount = 0;
          for (var i = 0; i < TYPE_TABLE_DEFS.length; i++) {
            var id = TYPE_TABLE_DEFS[i] && TYPE_TABLE_DEFS[i].id ? String(TYPE_TABLE_DEFS[i].id) : '';
            if (!id) continue;
            var card = document.getElementById('stats-type-' + id);
            if (card && card.classList.contains('is-hidden')) hiddenCount++;
          }
          note.style.display = hiddenCount > 0 ? '' : 'none';
        }
      } catch (_) {}
    }

    (function initTypeTablePagination() {
      TYPE_TABLE_DEFS.forEach(function(def) {
        var wrap = document.getElementById('type-' + def.id + '-pagination');
        if (!wrap) return;
        wrap.addEventListener('click', function(e) {
          var link = e.target.closest('a[data-page]');
          if (!link) return;
          e.preventDefault();
          if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
          var pg = parseInt(link.dataset.page, 10);
          if (!pg || pg < 1) return;
          typeTablePages[def.id] = pg;
          renderTypeTable(leaderboardCache, def);
        });
      });
    })();

    (function initProductsLeaderboardResizeWatcher() {
      let raf = null;
      function schedule() {
        if (activeMainTab !== 'products') return;
        if (!leaderboardCache && !leaderboardLoading) return;
        if (typeof requestAnimationFrame !== 'function') {
          renderProductsLeaderboard(leaderboardCache);
          return;
        }
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function() {
          raf = null;
          if (activeMainTab !== 'products') return;
          renderProductsLeaderboard(leaderboardCache);
        });
      }
      try { window.addEventListener('resize', schedule); } catch (_) {}
    })();

    function fetchFinishes(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        finishesLoading = false;
        finishesCache = null;
        if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null);
        return Promise.resolve(null);
      }
      finishesLoading = true;
      if (!finishesCache && normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null);
      let url = API + '/api/shopify-finishes?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          finishesCache = data;
          if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(data);
          return data;
        })
        .catch(function() { finishesCache = null; finishesLoading = false; if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null); return null; })
        .finally(function() { finishesLoading = false; });
    }

    function fetchLengths(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        lengthsLoading = false;
        lengthsCache = null;
        if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null);
        return Promise.resolve(null);
      }
      lengthsLoading = true;
      if (!lengthsCache && normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null);
      let url = API + '/api/shopify-lengths?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          lengthsCache = data;
          if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(data);
          return data;
        })
        .catch(function() { lengthsCache = null; lengthsLoading = false; if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null); return null; })
        .finally(function() { lengthsLoading = false; });
    }

    function fetchChainStyles(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        chainStylesLoading = false;
        chainStylesCache = null;
        return Promise.resolve(null);
      }
      chainStylesLoading = true;
      let url = API + '/api/shopify-chain-styles?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          chainStylesCache = data;
          chainStylesLoading = false;
          return data;
        })
        .catch(function() { chainStylesCache = null; chainStylesLoading = false; return null; })
        .finally(function() { chainStylesLoading = false; });
    }

    function fetchBestVariants(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        bestVariantsCache = null;
        renderBestVariants(null);
        return Promise.resolve(null);
      }
      var pageSize = getTableRowsPerPage('best-variants-table', 'product');
      let url = API + '/api/shopify-best-variants?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange()) +
          '&page=' + encodeURIComponent(String(bestVariantsPage || 1)) +
          '&pageSize=' + encodeURIComponent(String(pageSize));
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data || {} }; }).catch(function() { return { ok: r.ok, status: r.status, data: {} }; }); })
        .then(function(result) {
          if (result.ok) {
            bestVariantsCache = result.data;
            renderBestVariants(result.data);
            return result.data;
          }
          var msg = (result.data && result.data.error) ? result.data.error : ('Error ' + result.status);
          if (result.data && result.data.hint) msg += '. ' + result.data.hint;
          bestVariantsCache = null;
          renderBestVariants(null, msg);
          return null;
        })
        .catch(function() { bestVariantsCache = null; renderBestVariants(null); return null; });
    }

    function renderBestVariants(data, errorMessage) {
      const tbody = document.getElementById('best-variants-body');
      if (!tbody) return;
      if (!data || !Array.isArray(data.bestVariants)) {
        setHiddenById('stats-best-variants', false);
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (errorMessage ? escapeHtml(errorMessage) : 'No shop or no data') + '</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-variants-table'), tableSortState.bestVariants.by, tableSortState.bestVariants.dir);
        updateCardPagination('best-variants', 1, 1);
        return;
      }
      const rows = data.bestVariants.slice();
      var hasSessions = false;
      for (var i = 0; i < rows.length; i++) {
        if ((Number(rows[i] && rows[i].clicks) || 0) > 0) { hasSessions = true; break; }
      }
      setHiddenById('stats-best-variants', !hasSessions);
      if (!hasSessions) {
        tbody.innerHTML = '';
        updateCardPagination('best-variants', 1, 1);
        return;
      }
      const bvBy = (tableSortState.bestVariants.by || 'rev').toString().trim().toLowerCase();
      const bvDir = (tableSortState.bestVariants.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function displayVariantName(v) {
        const variantName = (v && v.variant_title && String(v.variant_title).trim()) ? String(v.variant_title).trim() : 'Default';
        const productName = (v && v.title && String(v.title).trim()) ? String(v.title).trim() : '';
        return variantName + (productName ? (' \u2014 ' + productName) : '');
      }
      rows.sort(function(a, b) {
        var primary = 0;
        if (bvBy === 'variant') primary = cmpNullableText(displayVariantName(a), displayVariantName(b), bvDir);
        else if (bvBy === 'sales') primary = cmpNullableNumber(a && a.orders, b && b.orders, bvDir);
        else if (bvBy === 'clicks') primary = cmpNullableNumber(a && a.clicks, b && b.clicks, bvDir);
        else if (bvBy === 'rev') primary = cmpNullableNumber(a && a.revenue, b && b.revenue, bvDir);
        else if (bvBy === 'cr') {
          primary = cmpNullableNumber(a && a.cr, b && b.cr, bvDir) ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc');
        }
        return primary ||
          cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc') ||
          cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
          cmpNullableText(displayVariantName(a), displayVariantName(b), 'asc');
      });
      const pageSize = (data && typeof data.pageSize === 'number' && data.pageSize > 0)
        ? data.pageSize
        : getTableRowsPerPage('best-variants-table', 'product');
      const totalCount = (data && typeof data.totalCount === 'number' && data.totalCount >= 0) ? data.totalCount : rows.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      bestVariantsPage = clampPage((data && typeof data.page === 'number') ? data.page : bestVariantsPage, totalPages);
      updateCardPagination('best-variants', bestVariantsPage, totalPages);
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No orders in this range</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-variants-table'), bvBy, bvDir);
        return;
      }
      tbody.innerHTML = rows.map(function(v) {
        const mainBase = getMainBaseUrl();
        const handle = (v && v.handle) ? String(v.handle).trim().toLowerCase() : '';
        const productId = (v && v.product_id) ? String(v.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(String(handle))) : '#';
        const title = (v && v.title) ? String(v.title).trim() : '';

        const nameText = displayVariantName(v);
        const canOpen = handle || (productId && /^\d+$/.test(productId));
        const nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(nameText) + '</a>'
            )
          : escapeHtml(nameText);
        const name = '<span class="bs-name" title="' + escapeHtml(nameText) + '">' + nameInner + '</span>';

        const ordersNum = (v && typeof v.orders === 'number') ? v.orders : (v && v.orders != null ? Number(v.orders) : 0);
        const orders = formatSessions(Number(ordersNum) || 0);
        const clicks = (v && typeof v.clicks === 'number') ? formatSessions(v.clicks) : '\u2014';
        const revenue = formatRevenueTableHtml(v && v.revenue != null ? v.revenue : null);
        const crVal = (v && typeof v.cr === 'number') ? v.cr : null;
        const cr = crVal != null ? pct(crVal) : '\u2014';

        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + orders + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('best-variants-table'), bvBy, bvDir);
    }

    function normalizeChartType(value, fallback) {
      const v = String(value == null ? '' : value).trim().toLowerCase();
      if (v === 'area' || v === 'bar' || v === 'line') return v;
      return fallback || 'area';
    }

    // Chart-type switchers were removed theme-wide; keep this helper as a
    // compatibility shim so existing render paths can still pick defaults.
    function ensureChartTypeControls(_chartId, _scope, fallbackType) {
      return normalizeChartType(fallbackType, 'area');
    }

    let productsChartInstance = null;
    let productsChartData = null;

    function ensureThumbWidthParam(url, width) {
      const raw = url != null ? String(url).trim() : '';
      if (!raw) return '';
      const targetWidth = Math.max(32, Number(width) || 100);
      if (/^data:/i.test(raw)) return raw;
      if (/[?&]width=\d+/i.test(raw)) return raw;
      try {
        const u = new URL(raw, window.location.origin);
        if (!u.searchParams.has('width')) u.searchParams.set('width', String(targetWidth));
        return u.toString();
      } catch (_) {
        const joiner = raw.indexOf('?') === -1 ? '?' : '&';
        return raw + joiner + 'width=' + targetWidth;
      }
    }

    function renderProductsChart(data) {
      const el = document.getElementById('products-chart');
      if (!el) return;

      if (typeof ApexCharts === 'undefined') {
        // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
        const tries = (el.__kexoApexWaitTries || 0) + 1;
        el.__kexoApexWaitTries = tries;
        if (tries >= 25) {
          el.__kexoApexWaitTries = 0;
          captureChartMessage('Chart library failed to load.', 'productsChartLibraryLoad', { chartKey: 'products-chart', tries: tries }, 'error');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);text-align:center;padding:0 18px;font-size:.875rem">Chart library failed to load.</div>';
          return;
        }
        setTimeout(function() { renderProductsChart(data); }, 200);
        return;
      }
      try { el.__kexoApexWaitTries = 0; } catch (_) {}
      var chartKey = 'products-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (productsChartInstance) { try { productsChartInstance.destroy(); } catch (_) {} productsChartInstance = null; }
        el.innerHTML = '';
        return;
      }

      if (productsChartInstance) {
        productsChartInstance.destroy();
        productsChartInstance = null;
      }

      if (data) productsChartData = data;
      var d = productsChartData;

      if (!d || !Array.isArray(d.bestSellers) || d.bestSellers.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);font-size:.875rem">No product data available</div>';
        return;
      }

      const products = d.bestSellers.slice().sort(function(a, b) {
        return (b.revenue || 0) - (a.revenue || 0);
      }).slice(0, 10);

      if (!products.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);font-size:.875rem">No product data available</div>';
        return;
      }

      const mainBase = getMainBaseUrl();
      const chartRows = products.map(function (p) {
        const handle = (p && p.handle != null) ? String(p.handle).trim() : '';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
        const srcRaw = (p && p.thumb_url) ? (hotImgSquare(String(p.thumb_url)) || String(p.thumb_url)) : '';
        const ogThumb = productUrl ? ((API || '') + '/api/og-thumb?url=' + encodeURIComponent(productUrl) + '&width=100') : '';
        const thumb = ensureThumbWidthParam(srcRaw || ogThumb || '', 100);
        const titleRaw = (p && p.title != null) ? String(p.title).trim() : '';
        const title = titleRaw || 'Unknown Product';
        return {
          title: title,
          titleShort: title.length > 38 ? (title.slice(0, 35) + '...') : title,
          revenue: Number((p && p.revenue) || 0),
          thumb: thumb,
          productUrl: productUrl,
        };
      });

      const chartHeight = Math.max(280, chartRows.length * 30);
      var thumbsHtml = chartRows.map(function(row) {
        var thumb = row.thumb ? ('<img src="' + escapeHtml(row.thumb) + '" alt="" class="products-chart-thumb-img" loading="lazy">') : '<span class="products-chart-thumb-placeholder"></span>';
        return '<div class="products-chart-thumb" title="' + escapeHtml(row.title) + '">' + thumb + '</div>';
      }).join('');
      el.innerHTML = '<div class="products-chart-plot" id="products-chart-plot"></div>' +
        '<div class="products-chart-thumbs" id="products-chart-thumbs" aria-label="Product thumbnails">' + thumbsHtml + '</div>';
      const plotEl = document.getElementById('products-chart-plot');
      if (!plotEl) return;
      const categories = chartRows.map(function(row) { return row.titleShort; });

      var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      var showEndLabels = rawMode === 'multi-line-labels';
      var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      var palette = chartColorsFromUiConfig(chartKey, ['#3eb3ab']);

      if (mode === 'pie') {
        try {
          productsChartInstance = new ApexCharts(plotEl, {
            chart: {
              type: 'pie',
              height: Math.max(300, chartHeight),
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
            },
            series: chartRows.map(function (row) { return row.revenue; }),
            labels: categories,
            colors: palette,
            dataLabels: { enabled: true, formatter: function(pct) { return (typeof pct === 'number' && isFinite(pct)) ? (pct.toFixed(0) + '%') : ''; } },
            tooltip: {
              custom: function(ctx) {
                var idx = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                var row = idx >= 0 && idx < chartRows.length ? chartRows[idx] : null;
                if (!row) return '';
                var thumb = row.thumb
                  ? ('<img src="' + escapeHtml(row.thumb) + '" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid rgba(15,23,42,.08);margin-right:8px;">')
                  : '';
                return '<div style="padding:8px 10px;min-width:170px;">' +
                  '<div style="display:flex;align-items:center;margin-bottom:4px;">' + thumb +
                    '<div style="font-weight:600;font-size:12px;line-height:1.2;">' + escapeHtml(row.title) + '</div>' +
                  '</div>' +
                  '<div style="font-size:12px;color:#475569;">Revenue: <strong style="color:#0f172a;">' + escapeHtml(formatRevenue(row.revenue) || '—') + '</strong></div>' +
                '</div>';
              }
            },
            legend: { position: 'bottom', fontSize: '12px' },
          });
          var pieRender = productsChartInstance.render();
          if (pieRender && typeof pieRender.then === 'function') {
            pieRender.catch(function (err) {
              captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: 'pie' });
            });
          }
        } catch (err) {
          captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: 'pie' });
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
        return;
      }

      var chartType = normalizeChartType(mode, 'line');
      try {
        productsChartInstance = new ApexCharts(plotEl, {
          chart: {
            type: chartType,
            height: chartHeight,
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: false },
          },
          series: [{
            name: 'Revenue',
            data: chartRows.map(function (row) { return row.revenue; })
          }],
          colors: palette,
          stroke: { width: chartType === 'bar' ? 0 : 3, curve: 'smooth' },
          markers: { size: chartType === 'line' ? 4 : 0, hover: { size: 6 } },
          fill: chartType === 'bar'
            ? { type: 'solid', opacity: 1 }
            : { type: 'gradient', gradient: { opacityFrom: 0.38, opacityTo: 0.08, stops: [0, 100] } },
          plotOptions: chartType === 'bar' ? { bar: { columnWidth: '56%', borderRadius: 3 } } : {},
          dataLabels: (showEndLabels && chartType === 'line') ? {
            enabled: true,
            formatter: function(val, ctx) {
              try {
                var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                var w = ctx && ctx.w ? ctx.w : null;
                var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                if (dp !== last) return '';
              } catch (_) { return ''; }
              return formatRevenue(Number(val)) || '—';
            },
            style: { fontSize: '10px' },
            background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
            offsetY: -3,
          } : { enabled: false },
          xaxis: {
            categories: categories,
            labels: {
              style: { fontSize: '11px' },
              rotate: -18,
              trim: true,
              hideOverlappingLabels: true,
              formatter: function() { return ''; }
            }
          },
          yaxis: {
            min: 0,
            forceNiceScale: true,
            labels: {
              style: { fontSize: '11px' },
              formatter: function(value) { return formatRevenue(Number(value)) || '—'; }
            }
          },
          tooltip: {
            custom: function(ctx) {
              var idx = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
              var row = idx >= 0 && idx < chartRows.length ? chartRows[idx] : null;
              if (!row) return '';
              var thumb = row.thumb
                ? ('<img src="' + escapeHtml(row.thumb) + '" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid rgba(15,23,42,.08);margin-right:8px;">')
                : '';
              return '<div style="padding:8px 10px;min-width:170px;">' +
                '<div style="display:flex;align-items:center;margin-bottom:4px;">' + thumb +
                  '<div style="font-weight:600;font-size:12px;line-height:1.2;">' + escapeHtml(row.title) + '</div>' +
                '</div>' +
                '<div style="font-size:12px;color:#475569;">Revenue: <strong style="color:#0f172a;">' + escapeHtml(formatRevenue(row.revenue) || '—') + '</strong></div>' +
              '</div>';
            }
          },
          grid: {
            borderColor: '#eef2f6',
            strokeDashArray: 3,
            padding: { left: 4, right: 8, top: 8, bottom: 8 }
          }
        });
        var productsRender = productsChartInstance.render();
        if (productsRender && typeof productsRender.then === 'function') {
          productsRender.catch(function (err) {
            captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: chartType });
          });
        }
      } catch (err) {
        captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: chartType });
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    function renderBestSellers(data, errorMessage) {
      const tbody = document.getElementById('best-sellers-body');
      if (!tbody) return;
      if (!data || !Array.isArray(data.bestSellers)) {
        setHiddenById('stats-best-sellers', false);
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (errorMessage ? escapeHtml(errorMessage) : 'No shop or no data') + '</div></div>';
        updateBestSellersSortHeaders();
        updateCardPagination('best-sellers', 1, 1);
        return;
      }
      const rows = data.bestSellers.slice();
      var hasSessions = false;
      for (var i = 0; i < rows.length; i++) {
        if ((Number(rows[i] && rows[i].clicks) || 0) > 0) { hasSessions = true; break; }
      }
      setHiddenById('stats-best-sellers', !hasSessions);
      if (!hasSessions) {
        tbody.innerHTML = '';
        updateCardPagination('best-sellers', 1, 1);
        return;
      }
      const sortKey = (bestSellersSortBy || 'rev').toString().trim().toLowerCase();
      const sortDir = (bestSellersSortDir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      rows.sort(function(a, b) {
        if (sortKey === 'title') return cmpNullableText(a && a.title, b && b.title, sortDir);
        if (sortKey === 'orders') return cmpNullableNumber(a && a.orders, b && b.orders, sortDir);
        if (sortKey === 'clicks') return cmpNullableNumber(a && a.clicks, b && b.clicks, sortDir);
        if (sortKey === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, sortDir);
        if (sortKey === 'cr') {
          return cmpNullableNumber(a && a.cr, b && b.cr, sortDir) ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc');
        }
        return 0;
      });
      const pageSize = (data && typeof data.pageSize === 'number' && data.pageSize > 0)
        ? data.pageSize
        : getTableRowsPerPage('best-sellers-table', 'product');
      const totalCount = (data && typeof data.totalCount === 'number' && data.totalCount >= 0) ? data.totalCount : rows.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      bestSellersPage = clampPage((data && typeof data.page === 'number') ? data.page : bestSellersPage, totalPages);
      updateCardPagination('best-sellers', bestSellersPage, totalPages);
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No orders in this range</div></div>';
        updateBestSellersSortHeaders();
        return;
      }
      tbody.innerHTML = rows.map(function(p) {
        const mainBase = getMainBaseUrl();
        const handle = (p && p.handle) ? String(p.handle).trim().toLowerCase() : '';
        const productId = (p && p.product_id) ? String(p.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(String(handle))) : '#';
        const title = (p && p.title) ? String(p.title).trim() : '';
        const canOpen = handle || (productId && /^\d+$/.test(productId));
        const nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title);
        const name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + nameInner + '</span>';
        const orders = String(p.orders != null ? p.orders : 0);
        const clicks = (typeof p.clicks === 'number') ? formatSessions(p.clicks) : '\u2014';
        const revenue = formatRevenueTableHtml(p.revenue);
        const cr = p.cr != null ? pct(p.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + orders + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateBestSellersSortHeaders();
    }

    function updateBestSellersSortHeaders() {
      document.querySelectorAll('#best-sellers-wrap .grid-cell.sortable').forEach(function(th) {
        var col = th.getAttribute('data-sort');
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', bestSellersSortBy === col ? (bestSellersSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (bestSellersSortBy === col) th.classList.add(bestSellersSortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupBestSellersSort() {
      document.querySelectorAll('#best-sellers-wrap .grid-cell.sortable').forEach(function(th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          if (bestSellersSortBy === col) bestSellersSortDir = bestSellersSortDir === 'asc' ? 'desc' : 'asc';
          else { bestSellersSortBy = col; bestSellersSortDir = col === 'title' ? 'asc' : 'desc'; }
          bestSellersPage = 1;
          updateBestSellersSortHeaders();
          fetchBestSellers();
        }
        th.addEventListener('click', function(e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (shouldIgnoreStickyResizeSortClick(e)) return;
          activate();
        });
        th.addEventListener('keydown', function(e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
    }

    function asSortText(v) {
      if (v == null) return '';
      return String(v).trim().toLowerCase();
    }

    function asFiniteNumber(v) {
      const n = (typeof v === 'number') ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function cmpNullableText(a, b, dir) {
      const da = asSortText(a);
      const db = asSortText(b);
      const d = dir === 'asc' ? 'asc' : 'desc';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      if (da === db) return 0;
      if (d === 'asc') return da < db ? -1 : 1;
      return da < db ? 1 : -1;
    }

    function cmpNullableNumber(a, b, dir) {
      const na = asFiniteNumber(a);
      const nb = asFiniteNumber(b);
      const d = dir === 'asc' ? 'asc' : 'desc';
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      if (na === nb) return 0;
      return d === 'asc' ? (na - nb) : (nb - na);
    }

    function updateSortHeadersInContainer(container, sortBy, sortDir) {
      const root = typeof container === 'string' ? document.querySelector(container) : container;
      if (!root) return;
      root.querySelectorAll('.grid-cell.sortable').forEach(function(th) {
        var col = (th.getAttribute('data-sort') || '').trim();
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (sortBy === col) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupTableSortHeaders(container, state, defaults, onChange) {
      const root = typeof container === 'string' ? document.querySelector(container) : container;
      if (!root || !state) return;
      root.querySelectorAll('.grid-cell.sortable').forEach(function(th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          var prevCol = state.by;
          if (state.by === col) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
          else { state.by = col; state.dir = (defaults && defaults[col]) ? defaults[col] : 'asc'; }
          state.dir = state.dir === 'asc' ? 'asc' : 'desc';
          updateSortHeadersInContainer(root, state.by, state.dir);
          if (typeof onChange === 'function') onChange({ by: state.by, dir: state.dir, columnChanged: prevCol !== state.by });
        }
        th.addEventListener('click', function(e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (shouldIgnoreStickyResizeSortClick(e)) return;
          activate();
        });
        th.addEventListener('keydown', function(e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
      state.dir = state.dir === 'asc' ? 'asc' : 'desc';
      updateSortHeadersInContainer(root, state.by, state.dir);
    }

    function setupAllTableSorts() {
      setupTableSortHeaders(document.getElementById('country-table'), tableSortState.country, TABLE_SORT_DEFAULTS.country, function(info) {
        if (info && info.columnChanged) countryPage = 1;
        renderCountry(statsCache);
      });
      setupTableSortHeaders(document.getElementById('best-geo-products-table'), tableSortState.bestGeoProducts, TABLE_SORT_DEFAULTS.bestGeoProducts, function(info) {
        if (info && info.columnChanged) bestGeoProductsPage = 1;
        renderBestGeoProducts(statsCache);
      });
      setupTableSortHeaders(document.getElementById('best-variants-table'), tableSortState.bestVariants, TABLE_SORT_DEFAULTS.bestVariants, function(info) {
        if (info && info.columnChanged) {
          bestVariantsPage = 1;
          fetchBestVariants();
          return;
        }
        if (bestVariantsCache) renderBestVariants(bestVariantsCache);
        else fetchBestVariants();
      });
      setupTableSortHeaders(document.getElementById('traffic-sources-table'), tableSortState.trafficSources, TABLE_SORT_DEFAULTS.trafficSources, function() {
        renderTrafficTables(trafficCache || {});
      });
      setupTableSortHeaders(document.getElementById('traffic-types-table'), tableSortState.trafficTypes, TABLE_SORT_DEFAULTS.trafficTypes, function() {
        renderTrafficTables(trafficCache || {});
      });
    }

    function formatSessions(n) {
      if (n == null || typeof n !== 'number') return '—';
      return n.toLocaleString();
    }

    function clampPage(p, totalPages) {
      const n = typeof p === 'number' ? p : parseInt(String(p), 10);
      if (!Number.isFinite(n)) return 1;
      return Math.min(Math.max(1, n), Math.max(1, totalPages || 1));
    }

    function buildPaginationHtml(page, totalPages) {
      var p = Math.max(1, page);
      var tp = Math.max(1, totalPages);
      var chevL = '<i class="fa-light fa-chevron-left" data-icon-key="pagination-prev"></i>';
      var chevR = '<i class="fa-light fa-chevron-right" data-icon-key="pagination-next"></i>';
      var h = '<ul class="pagination m-0">';
      h += '<li class="page-item' + (p <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p - 1) + '" tabindex="-1" aria-label="Previous">' + chevL + '</a></li>';
      // Build page numbers with ellipsis
      var pages = [];
      if (tp <= 7) {
        for (var i = 1; i <= tp; i++) pages.push(i);
      } else {
        pages.push(1);
        if (p > 3) pages.push('...');
        var start = Math.max(2, p - 1);
        var end = Math.min(tp - 1, p + 1);
        if (p <= 3) { start = 2; end = 4; }
        if (p >= tp - 2) { start = tp - 3; end = tp - 1; }
        for (var i = start; i <= end; i++) pages.push(i);
        if (p < tp - 2) pages.push('...');
        pages.push(tp);
      }
      for (var j = 0; j < pages.length; j++) {
        var pg = pages[j];
        if (pg === '...') {
          h += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        } else {
          h += '<li class="page-item' + (pg === p ? ' active' : '') + '"><a class="page-link" href="#" data-page="' + pg + '">' + pg + '</a></li>';
        }
      }
      h += '<li class="page-item' + (p >= tp ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p + 1) + '" aria-label="Next">' + chevR + '</a></li>';
      h += '</ul>';
      return h;
    }
    try { window.__kexoBuildPaginationHtml = buildPaginationHtml; } catch (_) {}

    function updateCardPagination(prefix, page, totalPages) {
      var wrap = document.getElementById(prefix + '-pagination');
      if (!wrap) return;
      var pages = Math.max(1, totalPages || 1);
      var show = pages > 1;
      wrap.dataset.paginated = show ? '1' : '0';
      wrap.dataset.pages = String(pages);
      wrap.dataset.page = String(page);
      wrap.classList.toggle('is-hidden', !show);
      if (show) wrap.innerHTML = buildPaginationHtml(page, pages);
    }

    function scheduleBreakdownSync() {
      // No-op: layout is handled via CSS grid/flex.
    }

    function renderSales(data) {
      const sales = data.sales || {};
      const salesTodayEl = document.getElementById('sales-today');
      const range = getStatsRange();
      const baseSales = (sales[range] != null ? sales[range] : 0);
      if (salesTodayEl) salesTodayEl.textContent = formatRevenue(baseSales);
      const salesYesterdayEl = document.getElementById('sales-yesterday');
      if (salesYesterdayEl) salesYesterdayEl.textContent = formatRevenue(sales.yesterday);
    }

    function renderConversion(data) {
      const c = data.conversion || {};
      const range = getStatsRange();
      document.getElementById('conversion-range').textContent = pct(c[range]);
      const productCr = (data.productConversion || {})[range];
      const productCrEl = document.getElementById('conversion-product-cr');
      if (productCrEl) productCrEl.textContent = productCr != null ? pct(productCr) : '\u2014';
    }

    function renderSessions(data) {
      const breakdown = data && data.trafficBreakdown ? data.trafficBreakdown : {};
      const forRange = breakdown[getStatsRange()];
      const forYesterday = breakdown.yesterday;
      const main = forRange != null ? forRange.human_sessions : null;
      const yesterday = forYesterday != null ? forYesterday.human_sessions : null;
      const sessionsRangeEl = document.getElementById('sessions-range');
      const sessionsYesterdayEl = document.getElementById('sessions-yesterday');
      if (sessionsRangeEl) sessionsRangeEl.textContent = formatSessions(main);
      if (sessionsYesterdayEl) sessionsYesterdayEl.textContent = formatSessions(yesterday);
    }

    var breakdownAovPage = 1;
    function renderAov(data) {
      const rows = (data.country || {})[getStatsRange()] || [];
      const tbody = document.getElementById('breakdown-aov-body');
      if (!tbody) return;
      const filtered = rows.filter(r => (r && (r.revenue != null || r.aov != null || r.conversion != null)));
      if (filtered.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateCardPagination('breakdown-aov', 1, 1);
        return;
      }
      const list = filtered.slice();
      list.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc') ||
          cmpNullableNumber(a && a.aov, b && b.aov, 'desc') ||
          cmpNullableNumber(a && a.conversion, b && b.conversion, 'desc');
      });
      var totalPages = Math.max(1, Math.ceil(list.length / TOP_TABLE_PAGE_SIZE));
      breakdownAovPage = clampPage(breakdownAovPage, totalPages);
      updateCardPagination('breakdown-aov', breakdownAovPage, totalPages);
      var start = (breakdownAovPage - 1) * TOP_TABLE_PAGE_SIZE;
      var pageRows = list.slice(start, start + TOP_TABLE_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(r => {
        const iso = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabelFull(iso);
        const flag = flagImg(iso, label);
        const revenue = r && r.revenue != null ? formatRevenueTableHtml(r.revenue) : '—';
        const aov = r && r.aov != null ? formatRevenueTableHtml(r.aov) : '—';
        const cr = r && r.conversion != null ? pct(r.conversion) : '—';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + '<span class="country-label"><span class="country-name">' + escapeHtml(label) + '</span></span></span></div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
          '<div class="grid-cell" role="cell">' + aov + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderFinishes(data) {
      const grid = document.getElementById('finishes-cards-grid');
      if (!grid) return;
      const rows = (data && Array.isArray(data.finishes)) ? data.finishes : [];
      if (rows.length === 0) {
        const msg = finishesLoading ? 'Loading finishes…' : 'No data';
        grid.innerHTML = '<div class="aov-card aov-card-empty">' + escapeHtml(msg) + '</div>';
        return;
      }
      function iconFor(key) {
        const k = (key || '').toString().trim().toLowerCase();
        if (k === 'gold') return '<span class="finish-icon finish-icon-gold" aria-hidden="true"></span>';
        if (k === 'silver') return '<span class="finish-icon finish-icon-silver" aria-hidden="true"></span>';
        if (k === 'vermeil') return '<span class="finish-icon finish-icon-vermeil" aria-hidden="true"></span>';
        if (k === 'solid_silver' || k === 'solid-silver') return '<span class="finish-icon finish-icon-solid-silver" aria-hidden="true"></span>';
        return '<span class="finish-icon" aria-hidden="true"></span>';
      }
      const ordered = rows.slice();
      const orderIndex = { gold: 0, silver: 1, vermeil: 2, solid_silver: 3, 'solid-silver': 3 };
      ordered.sort(function(a, b) {
        const primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc');
        if (primary) return primary;
        const ak = a && a.key != null ? String(a.key) : '';
        const bk = b && b.key != null ? String(b.key) : '';
        const ai = Object.prototype.hasOwnProperty.call(orderIndex, ak) ? orderIndex[ak] : 99;
        const bi = Object.prototype.hasOwnProperty.call(orderIndex, bk) ? orderIndex[bk] : 99;
        return ai - bi;
      });
      grid.innerHTML = ordered.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '—';
        const cr = crPillHtml(r && r.cr);
        return '<div class="aov-card">' +
          '<div class="aov-card-left">' + iconFor(r && r.key) + '<span class="aov-card-name">' + escapeHtml(label || '—') + '</span></div>' +
          '<div class="aov-card-value"><span class="aov-card-value-main">' + value + '</span>' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderLengths(data) {
      const grid = document.getElementById('finishes-cards-grid');
      if (!grid) return;
      const rows = (data && Array.isArray(data.lengths)) ? data.lengths : [];
      if (rows.length === 0) {
        const msg = lengthsLoading ? 'Loading lengths…' : 'No data';
        grid.innerHTML = '<div class="aov-card aov-card-empty">' + escapeHtml(msg) + '</div>';
        return;
      }
      const ordered = rows.slice();
      ordered.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
          cmpNullableNumber(a && a.inches, b && b.inches, 'asc');
      });
      grid.innerHTML = ordered.map(function(r) {
        const inches = (r && r.inches != null) ? Number(r.inches) : null;
        const label = (r && r.label != null) ? String(r.label) : (inches != null && Number.isFinite(inches) ? (String(inches) + '"') : '');
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '—';
        const cr = crPillHtml(r && r.cr);
        const icon = '<span class="length-icon" aria-hidden="true"><span class="length-icon-text">' + escapeHtml(label || '—') + '</span></span>';
        const sr = '<span class="aov-card-name sr-only">' + escapeHtml((label || '—') + ' Inches') + '</span>';
        return '<div class="aov-card aov-card--length">' +
          '<div class="aov-card-left">' + icon + sr + '</div>' +
          '<div class="aov-card-value"><span class="aov-card-value-main">' + value + '</span>' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownTitlePage = 1;
    function renderBreakdownTitles(data) {
      const tbody = document.getElementById('breakdown-title-body');
      if (!tbody) return;
      const hasData = !!(data && data.ok);
      const list = hasData ? (data.byTitle || []) : [];
      if (!list.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-title', 1, 1);
        return;
      }
      var totalPages = Math.max(1, Math.ceil(list.length / TOP_TABLE_PAGE_SIZE));
      breakdownTitlePage = clampPage(breakdownTitlePage, totalPages);
      updateCardPagination('breakdown-title', breakdownTitlePage, totalPages);
      var start = (breakdownTitlePage - 1) * TOP_TABLE_PAGE_SIZE;
      var pageRows = list.slice(start, start + TOP_TABLE_PAGE_SIZE);
      const mainBase = getMainBaseUrl();
      tbody.innerHTML = pageRows.map(function(row) {
        const title = row && row.title != null ? String(row.title) : 'Product';
        const handle = row && row.handle ? String(row.handle) : '';
        const productId = (row && row.product_id) ? String(row.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = row && row.cr != null ? pct(row.cr) : '\u2014';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        const placeholderSvg = '<i class="fa-light fa-image" data-icon-key="breakdown-placeholder-image" aria-hidden="true"></i>';
        const normalizedHandle = handle ? String(handle).trim().toLowerCase() : '';
        const canOpen = normalizedHandle || (productId && /^\d+$/.test(productId));
        const titleLink = canOpen
          ? '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
              (normalizedHandle ? (' data-product-handle="' + escapeHtml(normalizedHandle) + '"') : '') +
              (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
              (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
            '>' + escapeHtml(title) + '</a>'
          : escapeHtml(title);
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell"><span class="breakdown-thumb-wrap" aria-hidden="true">' + placeholderSvg + '</span><span class="breakdown-label"><span class="breakdown-product-name">' + titleLink + '</span><span class="sr-only">' + escapeHtml(title) + '</span></span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(value) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderBreakdownTypes(data) {
      const tbody = document.getElementById('breakdown-type-body');
      if (!tbody) return;
      const hasData = !!(data && data.ok);
      const list = hasData ? (data.byType || []) : [];
      if (!list.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        return;
      }
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-image" data-icon-key="breakdown-icon-image"></i></span>';
      tbody.innerHTML = list.map(function(row) {
        const label = row && (row.label || row.key) ? String(row.label || row.key) : 'Unknown';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = row && row.cr != null ? pct(row.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(value) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownFinishPage = 1;
    function renderBreakdownFinishes(data) {
      const tbody = document.getElementById('breakdown-finish-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.finishes)) ? data.finishes : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (finishesLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-finish', 1, 1);
        return;
      }
      function iconFor(key) {
        const k = (key || '').toString().trim().toLowerCase();
        if (k === 'gold') return '<span class="finish-icon finish-icon-gold" aria-hidden="true"></span>';
        if (k === 'silver') return '<span class="finish-icon finish-icon-silver" aria-hidden="true"></span>';
        if (k === 'vermeil') return '<span class="finish-icon finish-icon-vermeil" aria-hidden="true"></span>';
        if (k === 'solid_silver' || k === 'solid-silver') return '<span class="finish-icon finish-icon-solid-silver" aria-hidden="true"></span>';
        return '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-star" data-icon-key="breakdown-icon-star"></i></span>';
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) { return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc'); });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownFinishPage = clampPage(breakdownFinishPage, totalPages);
      updateCardPagination('breakdown-finish', breakdownFinishPage, totalPages);
      var start = (breakdownFinishPage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '\u2014';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconFor(r && r.key) + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownLengthPage = 1;
    function renderBreakdownLengths(data) {
      const tbody = document.getElementById('breakdown-length-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.lengths)) ? data.lengths : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (lengthsLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-length', 1, 1);
        return;
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
          cmpNullableNumber(a && a.inches, b && b.inches, 'asc');
      });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownLengthPage = clampPage(breakdownLengthPage, totalPages);
      updateCardPagination('breakdown-length', breakdownLengthPage, totalPages);
      var start = (breakdownLengthPage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-chart-column" data-icon-key="breakdown-icon-chart-column"></i></span>';
      tbody.innerHTML = pageRows.map(function(r) {
        const inches = (r && r.inches != null) ? Number(r.inches) : null;
        const label = (r && r.label != null) ? String(r.label) : (inches != null && Number.isFinite(inches) ? (String(inches) + '"') : '\u2014');
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownChainStylePage = 1;
    function renderBreakdownChainStyles(data) {
      const tbody = document.getElementById('breakdown-chainstyle-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.chainStyles)) ? data.chainStyles : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (chainStylesLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-chainstyle', 1, 1);
        return;
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) { return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc'); });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownChainStylePage = clampPage(breakdownChainStylePage, totalPages);
      updateCardPagination('breakdown-chainstyle', breakdownChainStylePage, totalPages);
      var start = (breakdownChainStylePage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-link" data-icon-key="breakdown-icon-link"></i></span>';
      tbody.innerHTML = pageRows.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '\u2014';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderCountry(data) {
      const c = data.country || {};
      const rows = c[getStatsRange()] || [];
      const tbody = document.getElementById('by-country-body');
      if (!tbody) return;
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateSortHeadersInContainer(document.getElementById('country-table'), tableSortState.country.by, tableSortState.country.dir);
        updateCardPagination('country', 1, 1);
        return;
      }
      const list = rows.slice();
      const countryBy = (tableSortState.country.by || 'rev').toString().trim().toLowerCase();
      const countryDir = (tableSortState.country.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function labelFor(r) {
        const code = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
        return countryLabel(code);
      }
      list.sort(function(a, b) {
        if (countryBy === 'country') return cmpNullableText(labelFor(a), labelFor(b), countryDir);
        if (countryBy === 'cr') return cmpNullableNumber(a && a.conversion, b && b.conversion, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'sales') return cmpNullableNumber(a && a.converted, b && b.converted, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'clicks') return cmpNullableNumber(a && a.total, b && b.total, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        return 0;
      });

      lastCountryRowCount = list.length;
      var countryPageSize = getTableRowsPerPage('country-table', 'live');
      var totalPages = Math.max(1, Math.ceil(list.length / countryPageSize));
      countryPage = clampPage(countryPage, totalPages);
      updateCardPagination('country', countryPage, totalPages);
      var start = (countryPage - 1) * countryPageSize;
      var pageRows = list.slice(start, start + countryPageSize);
      tbody.innerHTML = pageRows.map(r => {
        const code = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabel(code);
        const conversion = pct(r.conversion);
        const salesCount = r.converted != null ? Number(r.converted) : 0;
        const clicks = r.total != null ? formatSessions(r.total) : '—';
        const revenue = formatRevenueTableHtml(r.revenue);
        const flag = flagImg(code, label);
        const labelHtml = '<span class="country-label">' + escapeHtml(label) + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + salesCount + '</div>' +
          '<div class="grid-cell" role="cell">' + conversion + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('country-table'), countryBy, countryDir);
      scheduleBreakdownSync();
    }

    // Countries map chart
    let countriesMapChartInstance = null;

    function clearCountriesFlowOverlay(el) {
      if (!el) return;
      var existing = el.querySelector('.kexo-map-flow-overlay');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function mapRegionCenter(mapSvg, mapRect, iso2) {
      if (!mapSvg || !mapRect) return null;
      var iso = String(iso2 || '').trim().toUpperCase();
      if (!iso) return null;
      var lowerIso = iso.toLowerCase();
      var node = mapSvg.querySelector('[data-code="' + iso + '"], [data-code="' + lowerIso + '"], .jvm-region-' + lowerIso + ', .jvm-region-' + iso);
      if (!node) return null;
      var rect = node.getBoundingClientRect();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
      return {
        x: (rect.left - mapRect.left) + (rect.width / 2),
        y: (rect.top - mapRect.top) + (rect.height / 2),
      };
    }

    function renderCountriesFlowOverlay(el, rows, primaryRgb, originIso2) {
      if (!el) return;
      clearCountriesFlowOverlay(el);
      var mapSvg = el.querySelector('svg');
      if (!mapSvg) return;
      var mapRect = mapSvg.getBoundingClientRect();
      if (!mapRect || !(mapRect.width > 20) || !(mapRect.height > 20)) return;

      var originIso = String(originIso2 || 'GB').trim().toUpperCase().slice(0, 2);
      if (originIso === 'UK') originIso = 'GB';
      if (!originIso) originIso = 'GB';

      var NS = 'http://www.w3.org/2000/svg';
      var overlay = document.createElementNS(NS, 'svg');
      overlay.setAttribute('class', 'kexo-map-flow-overlay');
      overlay.setAttribute('viewBox', '0 0 ' + mapRect.width + ' ' + mapRect.height);
      overlay.setAttribute('width', String(mapRect.width));
      overlay.setAttribute('height', String(mapRect.height));

      var ranked = (Array.isArray(rows) ? rows : [])
        .map(function (r) {
          var rawIso = r && r.country_code != null ? String(r.country_code) : 'XX';
          var iso = rawIso.trim().toUpperCase().slice(0, 2);
          if (iso === 'UK') iso = 'GB';
          return {
            iso: iso,
            orders: Number((r && r.converted) || 0),
          };
        })
        .filter(function (r) { return r.iso && r.iso !== 'XX' && r.iso !== originIso && r.orders > 0; })
        .sort(function (a, b) { return b.orders - a.orders; })
        .slice(0, 8);

      if (!ranked.length) {
        el.appendChild(overlay);
        return;
      }

      var origin = mapRegionCenter(mapSvg, mapRect, originIso) ||
        { x: mapRect.width * 0.52, y: mapRect.height * 0.42 };
      var palette = [
        'rgba(' + primaryRgb + ',0.78)',
        'rgba(' + primaryRgb + ',0.6)',
        'rgba(' + primaryRgb + ',0.44)',
      ];

      ranked.forEach(function (item, idx) {
        var target = mapRegionCenter(mapSvg, mapRect, item.iso);
        if (!target) return;
        var midX = (origin.x + target.x) / 2;
        var bend = Math.max(18, Math.min(74, (Math.abs(target.x - origin.x) * 0.16) + (idx * 3)));
        var midY = (origin.y + target.y) / 2 - bend;
        var stroke = palette[idx % palette.length];

        var path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'kexo-map-flow-line');
        path.setAttribute('d', 'M ' + origin.x + ' ' + origin.y + ' Q ' + midX + ' ' + midY + ' ' + target.x + ' ' + target.y);
        path.setAttribute('stroke', stroke);
        path.style.animationDelay = String(idx * 0.24) + 's';
        overlay.appendChild(path);

        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'kexo-map-flow-dot');
        dot.setAttribute('cx', String(target.x));
        dot.setAttribute('cy', String(target.y));
        dot.setAttribute('r', '3.2');
        dot.setAttribute('fill', stroke);
        dot.style.animationDelay = String(0.12 + idx * 0.24) + 's';
        overlay.appendChild(dot);
      });

      var originDot = document.createElementNS(NS, 'circle');
      originDot.setAttribute('class', 'kexo-map-flow-origin');
      originDot.setAttribute('cx', String(origin.x));
      originDot.setAttribute('cy', String(origin.y));
      originDot.setAttribute('r', '4.2');
      originDot.setAttribute('fill', 'rgba(' + primaryRgb + ',0.86)');
      overlay.appendChild(originDot);

      el.appendChild(overlay);
    }

    function setCountriesMapState(el, text, opts) {
      if (!el) return;
      var message = String(text == null ? '' : text).trim() || 'Unavailable';
      var isError = !!(opts && opts.error);
      var color = isError ? '#ef4444' : 'var(--tblr-secondary)';
      if (isError) captureChartMessage(message, 'countriesMapState', { chartKey: 'countries-map-chart' }, 'error');
      el.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:' + color + ';text-align:center;padding:0 18px;">' +
          escapeHtml(message) +
        '</div>';
    }

    function buildMapFillScaleByIso(valuesByIso2, _primaryRgb, _minAlpha, _maxAlpha) {
      var src = valuesByIso2 && typeof valuesByIso2 === 'object' ? valuesByIso2 : {};
      var entries = [];
      var keys = Object.keys(src);
      for (var i = 0; i < keys.length; i++) {
        var iso = String(keys[i] || '').trim().toUpperCase();
        if (!iso) continue;
        var n = Number(src[iso]);
        if (!Number.isFinite(n) || n <= 0) continue;
        entries.push({ iso: iso, value: n });
      }
      var out = {};
      if (entries.length) {
        var min = Infinity;
        var max = -Infinity;
        for (var j = 0; j < entries.length; j++) {
          var v = entries[j].value;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        for (var k = 0; k < entries.length; k++) {
          var row = entries[k];
          var weight = 1;
          if (max > min) {
            var t = (row.value - min) / (max - min);
            if (!Number.isFinite(t)) t = 0;
            weight = Math.max(0, Math.min(1, t));
          }
          out[row.iso] = weight;
        }
      }
      return new Proxy(out, {
        get: function(target, prop) {
          var v = target[prop];
          if (v !== undefined && v !== null && Number.isFinite(Number(v))) return v;
          return 0;
        }
      });
    }

    function setVectorMapTooltipContent(tooltip, html, text) {
      if (!tooltip) return;
      var htmlContent = html == null ? '' : String(html);
      var textContent = text == null ? '' : String(text);
      try {
        if (typeof tooltip.html === 'function') {
          tooltip.html(htmlContent);
          return;
        }
      } catch (_) {}
      try {
        if (typeof tooltip.text === 'function') {
          tooltip.text(textContent || htmlContent);
          return;
        }
      } catch (_) {}
      try {
        if (tooltip.element && tooltip.element.nodeType === 1) {
          tooltip.element.innerHTML = htmlContent;
          return;
        }
      } catch (_) {}
      try {
        if (tooltip.nodeType === 1) {
          tooltip.innerHTML = htmlContent;
          return;
        }
      } catch (_) {}
      try {
        if (typeof tooltip.setContent === 'function') {
          tooltip.setContent(htmlContent || textContent);
        }
      } catch (_) {}
    }

    function renderCountriesMapChart(data) {
      const el = document.getElementById('countries-map-chart');
      if (!el) return;
      if (typeof jsVectorMap === 'undefined') {
        if (!el.__kexoJvmWaitTries) {
          setCountriesMapState(el, 'Loading map library...');
        }
        // Avoid an unbounded retry loop if the CDN/map script is blocked (adblock/network).
        const tries = (el.__kexoJvmWaitTries || 0) + 1;
        el.__kexoJvmWaitTries = tries;
        if (tries >= 25) {
          el.__kexoJvmWaitTries = 0;
          setCountriesMapState(el, 'Map library failed to load.', { error: true });
          return;
        }
        setTimeout(function() { renderCountriesMapChart(data); }, 200);
        return;
      }
      try { el.__kexoJvmWaitTries = 0; } catch (_) {}
      var chartKey = 'countries-map-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (countriesMapChartInstance) {
          try { countriesMapChartInstance.destroy(); } catch (_) {}
          countriesMapChartInstance = null;
        }
        clearCountriesFlowOverlay(el);
        setCountriesMapState(el, 'Map disabled in Settings > Charts.');
        return;
      }

      // jsVectorMap snapshots container size at init. If we render while hidden (page loader / collapsed),
      // it can end up with a 0x0 SVG (scale(0)) and never recover. Wait until the container is measurable.
      try {
        var rect = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null;
        var w = rect && Number.isFinite(rect.width) ? rect.width : Number(el && el.offsetWidth);
        var h = rect && Number.isFinite(rect.height) ? rect.height : Number(el && el.offsetHeight);
        if (!(w > 20) || !(h > 20)) {
          var tries = (el.__kexoJvmSizeWaitTries || 0) + 1;
          el.__kexoJvmSizeWaitTries = tries;
          if (tries <= 60) {
            setTimeout(function() { renderCountriesMapChart(data); }, 220);
          } else {
            el.__kexoJvmSizeWaitTries = 0;
          }
          return;
        }
        el.__kexoJvmSizeWaitTries = 0;
      } catch (_) {}

      if (countriesMapChartInstance) {
        try { countriesMapChartInstance.destroy(); } catch (_) {}
        countriesMapChartInstance = null;
      }
      clearCountriesFlowOverlay(el);

      const c = data && data.country ? data.country : {};
      const rows = c[getStatsRange()] || [];
      if (!rows.length) {
        setCountriesMapState(el, 'No country data for this range.');
        return;
      }

      const revenueByIso2 = {};
      const ordersByIso2 = {};
      const mapMetricByIso2 = {};
      for (const r of rows || []) {
        let iso = (r && r.country_code != null) ? String(r.country_code).trim().toUpperCase().slice(0, 2) : 'XX';
        if (!iso || iso === 'XX') continue;
        if (iso === 'UK') iso = 'GB';
        const rev = (r && typeof r.revenue === 'number') ? r.revenue : 0;
        const ord = (r && r.converted != null) ? Number(r.converted) : 0;
        if (!Number.isFinite(rev) && !Number.isFinite(ord)) continue;
        revenueByIso2[iso] = (revenueByIso2[iso] || 0) + (Number.isFinite(rev) ? rev : 0);
        ordersByIso2[iso] = (ordersByIso2[iso] || 0) + (Number.isFinite(ord) ? ord : 0);
        const metric = (Number.isFinite(rev) && rev > 0) ? rev : ((Number.isFinite(ord) && ord > 0) ? ord : 0);
        if (metric > 0) {
          mapMetricByIso2[iso] = (mapMetricByIso2[iso] || 0) + metric;
        }
      }

      el.innerHTML = '';
      try {
        const rootCss = getComputedStyle(document.documentElement);
        const border = (rootCss.getPropertyValue('--tblr-border-color') || '#d4dee5').trim();
        const muted = (rootCss.getPropertyValue('--tblr-secondary') || '#626976').trim();
        const rawMode = chartModeFromUiConfig(chartKey, 'map-flat') || 'map-flat';
        const isAnimated = rawMode !== 'map-flat';
        const palette = chartColorsFromUiConfig(chartKey, ['#3eb3ab']);
        const accent = (palette && palette[0]) ? String(palette[0]).trim() : '#3eb3ab';

        function rgbFromColor(c) {
          const s = String(c || '').trim();
          let m = /^#([0-9a-f]{6})$/i.exec(s);
          if (m) {
            const hex = m[1];
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return { r, g, b, rgb: r + ',' + g + ',' + b };
          }
          m = /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})/i.exec(s);
          if (m) {
            const r = Math.max(0, Math.min(255, parseInt(m[1], 10) || 0));
            const g = Math.max(0, Math.min(255, parseInt(m[2], 10) || 0));
            const b = Math.max(0, Math.min(255, parseInt(m[3], 10) || 0));
            return { r, g, b, rgb: r + ',' + g + ',' + b };
          }
          return { r: 62, g: 179, b: 171, rgb: '62,179,171' };
        }
        const rgb = rgbFromColor(accent);
        const primaryRgb = rgb.rgb;
        const regionFillByIso2 = buildMapFillScaleByIso(mapMetricByIso2, primaryRgb, 0.24, 0.92);

        countriesMapChartInstance = new jsVectorMap({
          selector: '#countries-map-chart',
          map: 'world',
          backgroundColor: 'transparent',
          zoomButtons: false,
          zoomOnScroll: false,
          zoomAnimate: false,
          regionStyle: {
            initial: { fill: 'rgba(' + primaryRgb + ',0.18)', stroke: border, strokeWidth: 0.7 },
            hover: { fill: 'rgba(' + primaryRgb + ',0.46)' },
            selected: { fill: 'rgba(' + primaryRgb + ',0.78)' },
          },
          series: {
            regions: [
              {
                attribute: 'fill',
                values: regionFillByIso2,
                scale: ['rgba(' + primaryRgb + ',0.24)', 'rgba(' + primaryRgb + ',0.92)'],
                normalizeFunction: 'linear',
              }
            ]
          },
          onRegionTooltipShow: function(tooltip, code) {
            const iso = (code || '').toString().trim().toUpperCase();
            const name = (countriesMapChartInstance && typeof countriesMapChartInstance.getRegionName === 'function')
              ? (countriesMapChartInstance.getRegionName(iso) || iso)
              : iso;
            const rev = revenueByIso2[iso] || 0;
            const ord = ordersByIso2[iso] || 0;
            if (!rev && !ord) {
              setVectorMapTooltipContent(
                tooltip,
                '<div style="min-width:140px;font-weight:600">' + escapeHtml(name) + '</div>',
                name
              );
              return;
            }
            const revHtml = formatRevenue(Number(rev) || 0) || '—';
            const ordHtml = ord ? (formatSessions(ord) + ' orders') : '—';
            setVectorMapTooltipContent(
              tooltip,
              '<div style="min-width:180px">' +
                '<div style="font-weight:600;margin-bottom:2px">' + escapeHtml(name) + '</div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Revenue: <span style="color:inherit">' + escapeHtml(revHtml) + '</span></div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Orders: <span style="color:inherit">' + escapeHtml(ordHtml) + '</span></div>' +
              '</div>',
              name + ' | Revenue: ' + revHtml + ' | Orders: ' + ordHtml
            );
          }
        });

        if (isAnimated) {
          setTimeout(function () {
            try { renderCountriesFlowOverlay(el, rows, primaryRgb); } catch (_) {}
          }, 140);
        }
      } catch (err) {
        captureChartError(err, 'countriesMapRender', { chartKey: 'countries-map-chart' });
        console.error('[countries-map] map render error:', err);
        setCountriesMapState(el, 'Map rendering failed.', { error: true });
      }
    }

    function renderBestGeoProducts(data) {
      const map = data && data.bestGeoProducts ? data.bestGeoProducts : {};
      const rows = map[getStatsRange()] || [];
      const tbody = document.getElementById('best-geo-products-body');
      if (!tbody) return;
      if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-geo-products-table'), tableSortState.bestGeoProducts.by, tableSortState.bestGeoProducts.dir);
        updateCardPagination('best-geo-products', 1, 1);
        return;
      }
      const list = rows.slice();
      const geoBy = (tableSortState.bestGeoProducts.by || 'rev').toString().trim().toLowerCase();
      const geoDir = (tableSortState.bestGeoProducts.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function geoCountryLabel(r) {
        const iso = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
        return countryLabel(iso);
      }
      function geoProductTitle(r) {
        return (r && r.product_title != null) ? String(r.product_title).trim() : '';
      }
      list.sort(function(a, b) {
        if (geoBy === 'country') {
          return cmpNullableText(geoCountryLabel(a), geoCountryLabel(b), geoDir) ||
            cmpNullableText(geoProductTitle(a), geoProductTitle(b), 'asc');
        }
        if (geoBy === 'cr') return cmpNullableNumber(a && a.conversion, b && b.conversion, geoDir) || cmpNullableNumber(a && a.total, b && b.total, 'desc');
        if (geoBy === 'sales') return cmpNullableNumber(a && a.converted, b && b.converted, geoDir) || cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc');
        if (geoBy === 'clicks') return cmpNullableNumber(a && a.total, b && b.total, geoDir) || cmpNullableNumber(a && a.converted, b && b.converted, 'desc');
        if (geoBy === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, geoDir) || cmpNullableNumber(a && a.converted, b && b.converted, 'desc');
        return 0;
      });

      const geoPageSize = getTableRowsPerPage('best-geo-products-table', 'live');
      const totalPages = Math.max(1, Math.ceil(list.length / geoPageSize));
      bestGeoProductsPage = clampPage(bestGeoProductsPage, totalPages);
      updateCardPagination('best-geo-products', bestGeoProductsPage, totalPages);
      const start = (bestGeoProductsPage - 1) * geoPageSize;
      const pageRows = list.slice(start, start + geoPageSize);
      tbody.innerHTML = pageRows.map(r => {
        const iso = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabel(iso);
        const productTitle = (r.product_title && String(r.product_title).trim()) ? String(r.product_title).trim() : '—';
        const productHandle = (r && r.product_handle != null) ? String(r.product_handle).trim() : '';
        const productId = (r && r.product_id) ? String(r.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const mainBase = getMainBaseUrl();
        const productUrl = (mainBase && productHandle) ? (mainBase + '/products/' + encodeURIComponent(productHandle)) : '#';
        const conversion = pct(r.conversion);
        const salesCount = r.converted != null ? Number(r.converted) : 0;
        const clicks = r.total != null ? formatSessions(r.total) : '—';
        const revenue = formatRevenueTableHtml(r.revenue);
        const flag = flagImg(iso, label);
        const normalizedHandle = productHandle ? String(productHandle).trim().toLowerCase() : '';
        const canOpen = normalizedHandle || (productId && /^\d+$/.test(productId));
        const titleLink = canOpen
          ? '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
              (normalizedHandle ? (' data-product-handle="' + escapeHtml(normalizedHandle) + '"') : '') +
              (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
              (productTitle ? (' data-product-title="' + escapeHtml(productTitle) + '"') : '') +
            '>' + escapeHtml(productTitle) + '</a>'
          : escapeHtml(productTitle);
        const labelHtml =
          '<span class="country-product-stack">' +
            '<span class="country-label">' + escapeHtml(label) + '</span>' +
            '<span class="country-product-label">' + titleLink + '</span>' +
          '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + salesCount + '</div>' +
          '<div class="grid-cell" role="cell">' + conversion + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('best-geo-products-table'), geoBy, geoDir);
      scheduleBreakdownSync();
    }

    function isCustomDayRangeKey(v) {
      return typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
    }

    function isCustomRangeKey(v) {
      return typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
    }

    function ymdFromDayKey(dayKey) {
      if (!isCustomDayRangeKey(dayKey)) return null;
      return dayKey.slice(2);
    }

    function ymdRangeFromRangeKey(rangeKey) {
      if (!isCustomRangeKey(rangeKey)) return null;
      const parts = String(rangeKey).split(':');
      if (parts.length !== 3) return null;
      const a = String(parts[1] || '').trim();
      const b = String(parts[2] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
      const startYmd = a <= b ? a : b;
      const endYmd = a <= b ? b : a;
      return { startYmd, endYmd };
    }

    function appliedYmdRangeFromDateRange() {
      if (isCustomRangeKey(dateRange)) return ymdRangeFromRangeKey(dateRange);
      if (isCustomDayRangeKey(dateRange)) {
        const ymd = ymdFromDayKey(dateRange);
        return ymd ? { startYmd: ymd, endYmd: ymd } : null;
      }
      return null;
    }

    function formatYmdLabel(ymd) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      const y = parseInt(String(ymd).slice(0, 4), 10);
      const m = parseInt(String(ymd).slice(5, 7), 10);
      const d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd || '');
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      try {
        return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(dt);
      } catch (_) {
        return String(ymd || '');
      }
    }

    function formatYmdRangeLabel(startYmd, endYmd) {
      if (!startYmd || !endYmd) return '';
      if (startYmd === endYmd) return formatYmdShort(startYmd);
      // Same month? Compact as "5–7 Feb"
      if (startYmd.slice(0, 7) === endYmd.slice(0, 7)) {
        var d1 = parseInt(startYmd.slice(8, 10), 10);
        var d2 = parseInt(endYmd.slice(8, 10), 10);
        var suffix = formatYmdShort(endYmd);
        // suffix is "7 Feb" — replace the day part
        return d1 + '–' + suffix;
      }
      return formatYmdShort(startYmd) + ' – ' + formatYmdShort(endYmd);
    }

    function formatYmdShort(ymd) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      var y = parseInt(String(ymd).slice(0, 4), 10);
      var m = parseInt(String(ymd).slice(5, 7), 10);
      var d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd || '');
      var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      try {
        return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(dt);
      } catch (_) {
        return String(ymd || '');
      }
    }

    function makeRangeKeyFromYmds(startYmd, endYmd) {
      const a = String(startYmd || '').trim();
      const b = String(endYmd || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
      const s = a <= b ? a : b;
      const e = a <= b ? b : a;
      return 'r:' + s + ':' + e;
    }

    function updateLiveViewTitle() {
      const sel = document.getElementById('global-date-select');
      // Date page: sync the table card title with the selected range
      if (PAGE === 'date') {
        const titleEl = document.getElementById('table-title-text');
        if (titleEl) {
          let label = null;
          const applied = appliedYmdRangeFromDateRange();
          if (applied && applied.startYmd && applied.endYmd) {
            label = formatYmdRangeLabel(applied.startYmd, applied.endYmd);
          } else if (sel) {
            const opt = sel.querySelector('option[value="' + dateRange + '"]') || sel.options[sel.selectedIndex];
            label = opt && opt.textContent ? String(opt.textContent).trim() : null;
          }
          const fallback = { today: 'Today', yesterday: 'Yesterday', '3d': 'Last 3 Days', '7d': 'Last 7 Days', '1h': 'Last Hour', custom: 'Custom' };
          titleEl.textContent = label || fallback[dateRange] || 'Today';
        }
      }
    }

    function updateRowsPerPageVisibility() {
      const wrap = document.getElementById('rows-per-page-wrap');
      if (wrap) wrap.classList.toggle('is-hidden', dateRange === 'live');
    }

    function syncHeaderDateDisplay() {
      const sel = document.getElementById('global-date-select');
      const displayBtn = document.getElementById('kexo-date-display');
      if (!sel || !displayBtn) return;

      let label = null;
      try {
        const opt = sel.options[sel.selectedIndex];
        label = opt && opt.textContent ? String(opt.textContent).trim() : null;
      } catch (_) {}

      if (!label) {
        const fallback = { today: 'Today', yesterday: 'Yesterday', '7days': 'Last 7 days', '14days': 'Last 14 days', '30days': 'Last 30 days', custom: 'Custom' };
        label = fallback[String(dateRange || 'today')] || 'Today';
      }
      var lbl = displayBtn.querySelector('.kexo-date-btn-label');
      if (lbl) lbl.textContent = label; else displayBtn.textContent = label;
    }

    function syncHeaderDateMenuAvailability() {
      const sel = document.getElementById('global-date-select');
      const menu = document.getElementById('kexo-date-menu');
      if (!sel || !menu) return;

      // Mirror visibility/disabled + labels from the <select> options.
      try {
        menu.querySelectorAll('[data-range]').forEach(function(item) {
          const key = String(item.getAttribute('data-range') || '').trim();
          if (!key) return;
          const opt = sel.querySelector('option[value="' + key + '"]');
          if (!opt) return;
          const hidden = !!opt.hidden;
          const disabled = !!opt.disabled;
          item.style.display = hidden ? 'none' : '';
          if (disabled) item.setAttribute('disabled', 'disabled');
          else item.removeAttribute('disabled');
          item.classList.toggle('disabled', disabled);
          item.setAttribute('aria-disabled', disabled ? 'true' : 'false');
          if (opt.textContent) item.textContent = String(opt.textContent).trim();
        });
      } catch (_) {}

      // Active item highlight: custom ranges map to the "Custom…" item.
      let active = '';
      try { active = String(sel.value || '').trim(); } catch (_) { active = ''; }
      const isCustom = isCustomRangeKey(active) || isCustomDayRangeKey(active);
      menu.querySelectorAll('[data-range]').forEach(function(btn) {
        const v = String(btn.getAttribute('data-range') || '').trim();
        btn.classList.toggle('active', isCustom ? (v === 'custom') : (v === active));
      });
    }

    function syncPageHeaderTripleLayout(headerRow) {
      try {
        const row =
          headerRow ||
          document.querySelector('.page-header .row.align-items-center') ||
          document.querySelector('.page-header .row');
        if (!row) return;

        const dateCol = row.querySelector('.kexo-page-header-date-col');
        if (!dateCol) {
          row.classList.remove('kexo-page-header-layout-triple');
          return;
        }

        // Skip headers that have other right-side actions (buttons, etc).
        // Only inspect direct children so nested controls inside the date dropdown
        // do not accidentally disable the triple layout. Exclude our own leftCol.
        let hasOtherAuto = false;
        try {
          hasOtherAuto = !!row.querySelector(':scope > .col-auto:not(.kexo-page-header-date-col):not(.kexo-page-header-left-col)');
        } catch (_) {
          hasOtherAuto = Array.prototype.slice.call(row.children || []).some(function(ch) {
            if (!ch || !ch.classList) return false;
            if (!ch.classList.contains('col-auto')) return false;
            if (ch.classList.contains('kexo-page-header-date-col') || ch.classList.contains('kexo-page-header-left-col')) return false;
            return true;
          });
        }
        if (hasOtherAuto) {
          row.classList.remove('kexo-page-header-layout-triple');
          return;
        }

        const pretitle = row.querySelector('.page-pretitle');
        const title = row.querySelector('.page-title');
        if (!pretitle || !title) return;

        const legacyPretitleParent = pretitle.parentElement;
        const legacyTitleParent = title.parentElement;

        let leftCol = row.querySelector('.kexo-page-header-left-col');
        if (!leftCol) {
          leftCol = document.createElement('div');
          leftCol.className = 'col-auto kexo-page-header-left-col';
        }

        let titleCol = row.querySelector('.kexo-page-header-title-col');
        if (!titleCol) {
          titleCol = document.createElement('div');
          titleCol.className = 'col kexo-page-header-title-col';
        }

        // Ensure order: left, title, date.
        if (leftCol.parentElement !== row) {
          row.insertBefore(leftCol, row.firstChild || null);
        }
        if (titleCol.parentElement !== row) {
          row.insertBefore(titleCol, dateCol);
        }
        if (dateCol.parentElement === row && dateCol.nextElementSibling) {
          row.appendChild(dateCol);
        }

        if (pretitle.parentElement !== leftCol) leftCol.appendChild(pretitle);
        if (title.parentElement !== titleCol) titleCol.appendChild(title);

        // Clean up legacy wrapper(s) if we emptied them.
        try {
          [legacyPretitleParent, legacyTitleParent].forEach(function(p) {
            if (!p) return;
            if (p === leftCol || p === titleCol || p === row) return;
            if (p.children && p.children.length === 0) p.remove();
          });
        } catch (_) {}

        row.classList.add('kexo-page-header-layout-triple');
      } catch (_) {}
    }

    function mountDesktopDatePickerIntoPageHeader() {
      try {
        if (document.body && document.body.getAttribute('data-page') === 'settings') return;
        const dateBtn = document.getElementById('kexo-date-display');
        const dateWrap = dateBtn && dateBtn.closest ? dateBtn.closest('.kexo-topbar-date') : null;
        if (!dateWrap) return;
        const sourceLi = document.querySelector('.kexo-desktop-nav .kexo-nav-date-slot');
        const headerRow = document.querySelector('.page-header .row.align-items-center') || document.querySelector('.page-header .row');
        const canRelocate = !!headerRow;

        if (!canRelocate) {
          if (sourceLi && dateWrap.parentElement !== sourceLi) {
            sourceLi.appendChild(dateWrap);
          }
          if (sourceLi) {
            sourceLi.classList.add('is-date-inline-fallback');
            sourceLi.classList.remove('is-date-relocated');
          }
          return;
        }

        let dateCol = headerRow.querySelector('.kexo-page-header-date-col');
        if (!dateCol) {
          dateCol = document.createElement('div');
          dateCol.className = 'col-auto kexo-page-header-date-col';
          headerRow.appendChild(dateCol);
        }

        if (dateWrap.parentElement !== dateCol) {
          dateCol.appendChild(dateWrap);
        }
        if (sourceLi) {
          sourceLi.classList.add('is-date-relocated');
          sourceLi.classList.remove('is-date-inline-fallback');
        }
        syncPageHeaderTripleLayout(headerRow);
      } catch (_) {}
    }

    function initHeaderDateMenu() {
      const sel = document.getElementById('global-date-select');
      const menu = document.getElementById('kexo-date-menu');
      if (!sel || !menu) return;
      if (menu.getAttribute('data-kexo-bound') === '1') return;
      menu.setAttribute('data-kexo-bound', '1');

      menu.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('[data-range]') : null;
        if (!btn) return;
        const v = String(btn.getAttribute('data-range') || '').trim();
        if (!v) return;
        if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true') return;
        sel.value = v;
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        syncHeaderDateDisplay();
        syncHeaderDateMenuAvailability();
      });

      syncHeaderDateDisplay();
      syncHeaderDateMenuAvailability();
    }

    function syncDateSelectOptions() {
      const sel = document.getElementById('global-date-select');
      if (!sel) return;
      const hasLive = sel.querySelector('option[value="live"]');
      if (hasLive) hasLive.remove();
      // Keep the "Custom" option stable, and create a dynamic option for the currently applied custom range.
      const customOpt = document.getElementById('date-opt-custom') || sel.querySelector('option[value="custom"]');
      if (customOpt) customOpt.textContent = 'Custom';

      // Remove previous dynamic custom-range option(s).
      sel.querySelectorAll('option[data-custom-range="1"]').forEach(function(o) { try { o.remove(); } catch (_) {} });

      // Normalize legacy single-day custom keys into the new range key.
      if (isCustomDayRangeKey(dateRange)) {
        const ymd = ymdFromDayKey(dateRange);
        const rk = ymd ? makeRangeKeyFromYmds(ymd, ymd) : null;
        if (rk) dateRange = rk;
      }

      const applied = appliedYmdRangeFromDateRange();
      if (applied && applied.startYmd && applied.endYmd) {
        customRangeStartYmd = applied.startYmd;
        customRangeEndYmd = applied.endYmd;
        const label = formatYmdRangeLabel(applied.startYmd, applied.endYmd) || 'Selected dates';
        const opt = document.createElement('option');
        opt.value = String(dateRange);
        opt.textContent = label;
        opt.setAttribute('data-custom-range', '1');
        if (customOpt && customOpt.parentNode === sel) sel.insertBefore(opt, customOpt);
        else sel.appendChild(opt);
        sel.value = String(dateRange);
      } else if (activeMainTab === 'spy' || activeMainTab === 'sales' || activeMainTab === 'date') {
        // Table pages: dropdown stays on Today/Yesterday/Custom.
        sel.value = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : String(dateRange || 'today');
      } else {
        // Other tabs only use day/range ranges; if somehow on live, treat as Today.
        if (dateRange === 'live') {
          dateRange = 'today';
          sessionsTotal = null;
        }
        sel.value = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : String(dateRange || 'today');
      }

      // Apply user-configured labels/visibility for the standard date ranges.
      try { applyDateRangeUiConfigToSelect(sel); } catch (_) {}

      updateLiveViewTitle();
      updateRowsPerPageVisibility();
      syncHeaderDateDisplay();
      syncHeaderDateMenuAvailability();
    }

    function applyRangeAvailable(available) {
      const sel = document.getElementById('global-date-select');
      if (!sel) return;
      const keys = ['today', 'yesterday'];
      const allowYesterday = floorAllowsYesterday();
      if (dateRange === 'yesterday' && !allowYesterday) {
        dateRange = 'today';
        customRangeStartYmd = null;
        customRangeEndYmd = null;
        syncDateSelectOptions();
      }
      keys.forEach((key) => {
        const o = sel.querySelector('option[value="' + key + '"]');
        if (!o) return;
        const ok = key === 'yesterday' ? (allowYesterday && !!(available && available[key])) : !!(available && available[key]);
        o.disabled = !ok;
        try { o.hidden = (key === 'yesterday' && !allowYesterday); } catch (_) {}
      });

      if (dateRange !== 'live' && !isCustomDayRangeKey(dateRange) && !isCustomRangeKey(dateRange) && available && available[dateRange] === false) {
        dateRange = 'today';
        customRangeStartYmd = null;
        customRangeEndYmd = null;
        syncDateSelectOptions();
      }
      updateLiveViewTitle();
      updateRowsPerPageVisibility();
      syncHeaderDateDisplay();
      syncHeaderDateMenuAvailability();
    }

    // Custom date calendar (last 30 days, disabled if no data)
    let availableDaysMemo = null;
    let availableDaysMemoAt = 0;
    let availableDaysInflight = null;
    const AVAILABLE_DAYS_MEMO_TTL_MS = 60 * 1000;

    function fetchAvailableDays(days, opts = {}) {
      const force = !!opts.force;
      const now = Date.now();
      if (!force && availableDaysMemo && (now - availableDaysMemoAt) < AVAILABLE_DAYS_MEMO_TTL_MS) {
        return Promise.resolve(availableDaysMemo);
      }
      if (!force && availableDaysInflight) return availableDaysInflight;
      const url = API + '/api/available-days?days=' + encodeURIComponent(String(days || 30)) + (force ? ('&_=' + now) : '');
      const p = fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 20000)
        .then((r) => (r && r.ok) ? r.json() : null)
        .then((data) => {
          if (data && data.ok) {
            availableDaysMemo = data;
            availableDaysMemoAt = Date.now();
          }
          return data;
        })
        .catch(() => null)
        .finally(() => {
          if (availableDaysInflight === p) availableDaysInflight = null;
        });
      availableDaysInflight = p;
      return p;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    // Flatpickr instance for custom date picker
    let flatpickrInstance = null;
    let availableDatesSet = new Set();

    function initFlatpickrDatePicker(payload) {
      const input = document.getElementById('date-range-picker');
      if (!input) return;

      // Destroy existing instance
      if (flatpickrInstance) {
        flatpickrInstance.destroy();
        flatpickrInstance = null;
      }

      // Parse available days from API
      const data = payload && payload.ok ? payload : null;
      if (data && Array.isArray(data.days)) {
        availableDatesSet = new Set(
          data.days
            .filter(function(d) { return d && d.date && d.hasSessions; })
            .map(function(d) { return String(d.date); })
        );
      }

      // Wait for flatpickr to be available
      if (typeof flatpickr === 'undefined') {
        setTimeout(function() { initFlatpickrDatePicker(payload); }, 200);
        return;
      }

      // Initialize flatpickr
      flatpickrInstance = flatpickr(input, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        maxDate: 'today',
        minDate: MIN_YMD || '2025-02-01',
        disable: [
          function(date) {
            const y = date.getFullYear();
            const m = date.getMonth() + 1;
            const d = date.getDate();
            const ymd = y + '-' + pad2(m) + '-' + pad2(d);
            return !availableDatesSet.has(ymd);
          }
        ],
        onChange: function(selectedDates) {
          if (selectedDates.length === 0) {
            pendingCustomRangeStartYmd = null;
            pendingCustomRangeEndYmd = null;
            updateCustomDateFooter();
            return;
          }
          if (selectedDates.length === 1) {
            const d = selectedDates[0];
            const ymd = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            pendingCustomRangeStartYmd = ymd;
            pendingCustomRangeEndYmd = null;
            updateCustomDateFooter();
            return;
          }
          if (selectedDates.length === 2) {
            const d1 = selectedDates[0];
            const d2 = selectedDates[1];
            const ymd1 = d1.getFullYear() + '-' + pad2(d1.getMonth() + 1) + '-' + pad2(d1.getDate());
            const ymd2 = d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());

            // Check 30-day limit
            const diffMs = Math.abs(d2 - d1);
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays > 30) {
              // Exceeded limit - reset
              flatpickrInstance.clear();
              pendingCustomRangeStartYmd = null;
              pendingCustomRangeEndYmd = null;
              updateCustomDateFooter();
              const summaryEl = document.getElementById('date-custom-summary');
              if (summaryEl) summaryEl.textContent = 'Range exceeds 30 days. Please select a shorter period.';
              return;
            }

            pendingCustomRangeStartYmd = ymd1 <= ymd2 ? ymd1 : ymd2;
            pendingCustomRangeEndYmd = ymd1 <= ymd2 ? ymd2 : ymd1;
            updateCustomDateFooter();
          }
        }
      });

      // Set initial dates if already selected
      if (pendingCustomRangeStartYmd && pendingCustomRangeEndYmd) {
        flatpickrInstance.setDate([pendingCustomRangeStartYmd, pendingCustomRangeEndYmd]);
      } else if (pendingCustomRangeStartYmd) {
        flatpickrInstance.setDate(pendingCustomRangeStartYmd);
      }
    }

    function closeCustomDateModal() {
      const modal = document.getElementById('date-custom-modal');
      if (!modal) return;
      modal.style.display = '';
      modal.classList.remove('show');
      document.body.classList.remove('modal-open');
      pendingCustomRangeStartYmd = null;
      pendingCustomRangeEndYmd = null;
      if (flatpickrInstance) {
        flatpickrInstance.destroy();
        flatpickrInstance = null;
      }
      syncDateSelectOptions();
    }

    function applyDateRangeChange() {
      if (dateRange !== 'live') lastOnlineCount = null;
      countryPage = 1;
      bestGeoProductsPage = 1;
      aovPage = 1;
      bestSellersPage = 1;
      bestVariantsPage = 1;
      currentPage = 1;
      syncDateSelectOptions();
      // Reset caches when range changes.
      leaderboardCache = null;
      finishesCache = null;
      lengthsCache = null;
      chainStylesCache = null;
      bestSellersCache = null;
      bestVariantsCache = null;
      trafficCache = null;
      lastStatsFetchedAt = 0;
      lastProductsFetchedAt = 0;
      lastTrafficFetchedAt = 0;
      updateNextUpdateUi();

      // Top KPI grid refreshes independently (every minute). On range change, force a refresh immediately.
      refreshKpis({ force: true });
      try { refreshKpiExtrasSoft(); } catch (_) {}
      // Keep the desktop navbar "visitors" status eager on every range change.
      updateKpis();

      if (activeMainTab === 'dashboard') {
        try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: true }); } catch (_) {}
      } else if (activeMainTab === 'stats') {
        refreshStats({ force: false });
      } else if (activeMainTab === 'channels' || activeMainTab === 'type') {
        refreshTraffic({ force: false });
      } else if (activeMainTab === 'products') {
        refreshProducts({ force: false });
      } else if (activeMainTab === 'variants') {
        try { if (typeof window.__refreshVariantsInsights === 'function') window.__refreshVariantsInsights({ force: true }); } catch (_) {}
      } else if (activeMainTab === 'ads' || PAGE === 'ads') {
        try { if (window.__adsRefresh) window.__adsRefresh({ force: false }); } catch (_) {}
      } else {
        updateKpis();
        fetchSessions();
      }
    }

    function openCustomDateModal() {
      const modal = document.getElementById('date-custom-modal');
      const input = document.getElementById('date-range-picker');
      if (!modal || !input) return;
      modal.style.display = 'block';
      modal.classList.add('show');
      document.body.classList.add('modal-open');
      const applied = appliedYmdRangeFromDateRange();
      pendingCustomRangeStartYmd = applied && applied.startYmd && applied.startYmd >= MIN_YMD ? applied.startYmd : null;
      pendingCustomRangeEndYmd = applied && applied.endYmd && applied.endYmd >= MIN_YMD ? applied.endYmd : null;
      customCalendarLastPayload = null;
      updateCustomDateFooter();
      input.placeholder = 'Loading...';
      input.disabled = true;
      fetchAvailableDays(30).then((payload) => {
        customCalendarLastPayload = payload;
        initFlatpickrDatePicker(payload);
        input.placeholder = 'Select dates...';
        input.disabled = false;
        updateCustomDateFooter();
      });
    }

    function updateCustomDateFooter() {
      const summaryEl = document.getElementById('date-custom-summary');
      const clearBtn = document.getElementById('date-custom-clear');
      const applyBtn = document.getElementById('date-custom-apply');
      if (!summaryEl) return;
      const a = pendingCustomRangeStartYmd;
      const b = pendingCustomRangeEndYmd;
      if (!a) {
        summaryEl.textContent = 'Select a start date.';
        if (clearBtn) clearBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      if (!b) {
        summaryEl.textContent = 'Start: ' + formatYmdLabel(a) + '. Select an end date.';
        if (clearBtn) clearBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      const startYmd = a <= b ? a : b;
      const endYmd = a <= b ? b : a;
      summaryEl.textContent = 'Selected: ' + (formatYmdRangeLabel(startYmd, endYmd) || (startYmd + ' – ' + endYmd));
      if (clearBtn) clearBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
    }

    let customDateModalInited = false;
    function initCustomDateModal() {
      if (customDateModalInited) return;
      customDateModalInited = true;
      const modal = document.getElementById('date-custom-modal');
      if (!modal) return;
      const closeBtn = document.getElementById('date-custom-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', function(e) { e.preventDefault(); closeCustomDateModal(); });
      modal.addEventListener('click', function(e) {
        if (e && e.target === modal) closeCustomDateModal();
      });
      document.addEventListener('keydown', function(e) {
        if (!modal.classList.contains('show')) return;
        const key = e && (e.key || e.code) ? String(e.key || e.code) : '';
        if (key === 'Escape') closeCustomDateModal();
      });
      const clearBtn = document.getElementById('date-custom-clear');
      const applyBtn = document.getElementById('date-custom-apply');
      if (clearBtn) {
        clearBtn.addEventListener('click', function(e) {
          e.preventDefault();
          pendingCustomRangeStartYmd = null;
          pendingCustomRangeEndYmd = null;
          if (flatpickrInstance) flatpickrInstance.clear();
          updateCustomDateFooter();
        });
      }
      if (applyBtn) {
        applyBtn.addEventListener('click', function(e) {
          e.preventDefault();
          const a = pendingCustomRangeStartYmd;
          const b = pendingCustomRangeEndYmd;
          if (!a || !b) return;
          const startYmd = a <= b ? a : b;
          const endYmd = a <= b ? b : a;
          if (startYmd < MIN_YMD || endYmd < MIN_YMD) return;
          const rk = makeRangeKeyFromYmds(startYmd, endYmd);
          if (!rk) return;
          customRangeStartYmd = startYmd;
          customRangeEndYmd = endYmd;
          dateRange = rk;
          closeCustomDateModal();
          applyDateRangeChange();
        });
      }
      // Flatpickr handles date selection via its own UI
    }

    function maybeTriggerSaleToastFromStatsLikeData(data) {
      const conv = data && data.convertedCount ? data.convertedCount : {};
      const haveToday = (typeof conv.today === 'number' && Number.isFinite(conv.today));
      if (!haveToday) return;

      // Reset the converted-count baseline daily (admin TZ).
      try {
        const day = ymdNowInTz();
        if (convertedCountDayYmd == null) convertedCountDayYmd = day;
        if (day && convertedCountDayYmd !== day) {
          convertedCountDayYmd = day;
          hasSeenConvertedCountToday = false;
          lastConvertedCountToday = 0;
        }
      } catch (_) {}

      // Guard against stale/cache drift where counts briefly move backwards (would cause double "sale" sounds).
      if (hasSeenConvertedCountToday && conv.today < lastConvertedCountToday) return;

      const increased = hasSeenConvertedCountToday && conv.today > lastConvertedCountToday;
      if (increased) {
        triggerSaleToast({ origin: 'stats', playSound: true });
        // Keep Home tables in sync when a toast fires outside SSE (Today/Sales/Live).
        if (activeMainTab === 'spy' && (dateRange === 'today' || dateRange === 'sales' || dateRange === 'live' || dateRange === '1h')) {
          try { fetchSessions(); } catch (_) {}
        }
        // Pull the authoritative timestamp (truth/evidence) so the footer is accurate.
        try { refreshConfigStatus(); } catch (_) {}
      }
      lastConvertedCountToday = conv.today;
      hasSeenConvertedCountToday = true;
    }

    function setLiveKpisLoading() {
      const spinner = '<span class="kpi-mini-spinner" aria-hidden="true"></span>';
      const ids = [
        'cond-kpi-orders',
        'cond-kpi-revenue',
        'cond-kpi-sessions',
        'cond-kpi-conv',
        'cond-kpi-roas',
        'cond-kpi-returning',
        'cond-kpi-aov',
        'cond-kpi-cogs',
        'cond-kpi-bounce',
        'cond-kpi-items-sold',
        'cond-kpi-orders-fulfilled',
        'cond-kpi-returns',
      ];
      ids.forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.removeAttribute('data-odometer');
        el.innerHTML = spinner;
      });
    }

    function renderStats(data) {
      statsCache = data || {};
      const statsRange = getStatsRange();
      if (statsRange !== 'today') {
        const hasTrustedKpiForRange = kpiCache && kpiCacheRange === statsRange && kpiCacheSource === 'kpis';
        if (!hasTrustedKpiForRange) {
          if (kpiCache && kpiCache.compare && !statsCache.compare) {
            kpiCache = { ...statsCache, compare: kpiCache.compare };
          } else {
            kpiCache = statsCache;
          }
          kpiCacheRange = statsRange;
          kpiCacheSource = 'stats';
        }
      }
      maybeTriggerSaleToastFromStatsLikeData(statsCache);
      if (statsCache.rangeAvailable) applyRangeAvailable(statsCache.rangeAvailable);
      renderCountriesMapChart(statsCache);
      renderCountry(statsCache);
      renderBestGeoProducts(statsCache);
      renderAov(statsCache);
      renderLiveKpis(getKpiData());
      scheduleBreakdownSync();
    }

    function kpiDelta(current, baseline) {
      const cur = typeof current === 'number' ? current : NaN;
      const base = typeof baseline === 'number' ? baseline : NaN;
      if (!Number.isFinite(cur) || !Number.isFinite(base)) return null;
      const diff = cur - base;
      if (diff === 0) return 0;
      if (base <= 0) return diff > 0 ? 1 : -1;
      return diff / base;
    }

    function normalizeIconStyleClass(value, fallback) {
      const raw = value == null ? '' : String(value).trim().toLowerCase();
      if (!raw) return fallback;
      if (raw.indexOf('fa-jelly-filled') >= 0 || raw === 'jelly-filled') return 'fa-jelly-filled';
      if (raw.indexOf('fa-jelly') >= 0 || raw === 'jelly') return 'fa-jelly';
      if (raw.indexOf('fa-solid') >= 0 || raw === 'solid') return 'fa-solid';
      if (raw.indexOf('fa-light') >= 0 || raw === 'light') return 'fa-light';
      if (raw.indexOf('fa-brands') >= 0 || raw === 'brands' || raw === 'brand') return 'fa-brands';
      return fallback;
    }

    function getStoredIconStyleClass(lsSuffix, fallback) {
      let v = null;
      try { v = localStorage.getItem('tabler-theme-' + lsSuffix); } catch (_) { v = null; }
      return normalizeIconStyleClass(v, fallback);
    }

    function sanitizeIconClassString(value) {
      return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    }

    function isFontAwesomeSubsetToken(token) {
      return token === 'fa-sharp' || token === 'fa-sharp-light' || token === 'fa-sharp-regular' ||
        token === 'fa-sharp-solid' || token === 'fa-sharp-thin' || token === 'fa-sharp-duotone';
    }

    function isIconStyleToken(token) {
      return token === 'fa-jelly' || token === 'fa-jelly-filled' || token === 'fa-light' ||
        token === 'fa-solid' || token === 'fa-brands' || token === 'fa-regular' ||
        token === 'fa-thin' || token === 'fa-duotone' || isFontAwesomeSubsetToken(token) ||
        token === 'fas' || token === 'far' || token === 'fal' || token === 'fab' ||
        token === 'fat' || token === 'fad';
    }

    function parseIconGlyphInput(value, fallbackGlyph) {
      const raw = sanitizeIconClassString(value).toLowerCase();
      const safeFallback = fallbackGlyph || 'fa-circle';
      if (!raw) return { mode: 'glyph', value: safeFallback };
      const tokens = raw.split(/\s+/).filter(Boolean);
      const faTokens = tokens.filter(function (t) {
        return t === 'fa' || t.indexOf('fa-') === 0 || t === 'fas' || t === 'far' ||
          t === 'fal' || t === 'fab' || t === 'fat' || t === 'fad';
      });
      const hasExplicitStyle = tokens.some(isIconStyleToken);
      if (hasExplicitStyle || faTokens.length >= 2) {
        const full = tokens.slice();
        const hasGlyph = full.some(function (t) { return t.indexOf('fa-') === 0 && !isIconStyleToken(t); });
        if (!hasGlyph) full.push(safeFallback);
        return { mode: 'full', value: full.join(' ') };
      }
      const m = raw.match(/fa-[a-z0-9-]+/);
      if (m && m[0]) return { mode: 'glyph', value: m[0] };
      if (/^[a-z0-9-]+$/.test(raw)) return { mode: 'glyph', value: 'fa-' + raw };
      return { mode: 'glyph', value: safeFallback };
    }

    function applyIconClassSpec(iconEl, classSpec, styleFallback, glyphFallback) {
      if (!iconEl) return;
      const keep = [];
      Array.prototype.forEach.call(iconEl.classList, function (cls) {
        if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab' || cls === 'fat' || cls === 'fad') return;
        if (cls.indexOf('fa-') === 0) return;
        keep.push(cls);
      });
      const tokens = sanitizeIconClassString(classSpec).toLowerCase().split(/\s+/).filter(Boolean);
      const parsed = tokens.length ? tokens : [styleFallback || 'fa-jelly', glyphFallback || 'fa-circle'];
      let hasStyle = false;
      let hasGlyph = false;
      parsed.forEach(function (t) {
        if (isIconStyleToken(t)) hasStyle = true;
        if (t.indexOf('fa-') === 0 && !isIconStyleToken(t)) hasGlyph = true;
      });
      if (!hasStyle) parsed.unshift(styleFallback || 'fa-jelly');
      if (!hasGlyph) parsed.push(glyphFallback || 'fa-circle');
      iconEl.className = keep.concat(parsed).join(' ').trim();
    }

    function applyCondensedKpiDelta(key, current, baseline, invert) {
      const deltaEl = document.getElementById('cond-kpi-' + key + '-delta');
      const barEl = document.getElementById('cond-kpi-' + key + '-bar');
      if (!deltaEl && !barEl) return;

      const cur = typeof current === 'number' && Number.isFinite(current) ? current : null;
      const base = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : null;
      const rawDelta = (cur != null && base != null) ? kpiDelta(cur, base) : null;
      const toneDelta = rawDelta == null ? null : (invert ? -rawDelta : rawDelta);
      const isNew = cur != null && base === 0 && cur !== 0;
      const isUp = toneDelta != null && toneDelta > 0.005;
      const isDown = toneDelta != null && toneDelta < -0.005;
      const isFlat = toneDelta != null && !isUp && !isDown;

      if (deltaEl) {
        const textEl = deltaEl.querySelector('.kexo-kpi-chip-delta-text');
        let text = '\u2014';
        let dir = 'none';

        if (rawDelta != null) {
          if (isNew) {
            text = 'new';
            dir = isDown ? 'down' : 'up';
          } else {
            text = formatSignedPercentOneDecimalFromRatio(rawDelta);
            dir = isUp ? 'up' : (isDown ? 'down' : 'flat');
          }
        }

        deltaEl.classList.remove('is-up', 'is-down', 'is-flat');
        if (dir === 'up') deltaEl.classList.add('is-up');
        else if (dir === 'down') deltaEl.classList.add('is-down');
        else if (dir === 'flat') deltaEl.classList.add('is-flat');
        deltaEl.setAttribute('data-dir', dir);
        if (textEl) textEl.textContent = text;
        else deltaEl.textContent = text;
      }

      if (barEl) {
        barEl.classList.remove('bg-success', 'bg-danger', 'bg-secondary');
        const progressEl = (barEl.closest && barEl.closest('.progress')) ? barEl.closest('.progress') : null;
        const srText = barEl.querySelector ? barEl.querySelector('.visually-hidden') : null;

        // When compare is missing, avoid misleading "0% complete" semantics.
        if (rawDelta == null) {
          if (progressEl) progressEl.classList.add('is-hidden');
          barEl.style.width = '0%';
          barEl.classList.add('bg-secondary');
          barEl.setAttribute('aria-valuenow', '0');
          barEl.setAttribute('aria-label', 'No comparison available');
          if (srText) srText.textContent = 'No comparison available';
          return;
        }

        if (progressEl) progressEl.classList.remove('is-hidden');
        let widthPct = 0;
        let barClass = 'bg-secondary';

        if (!isFlat) {
          widthPct = isNew ? 100 : Math.max(6, Math.min(100, Math.round(Math.abs(rawDelta) * 100)));
          barClass = isUp ? 'bg-success' : 'bg-danger';
        }

        barEl.style.width = String(widthPct) + '%';
        barEl.classList.add(barClass);
        barEl.setAttribute('aria-valuenow', String(widthPct));
        barEl.setAttribute('aria-label', String(widthPct) + '% change');
        if (srText) srText.textContent = String(widthPct) + '% change';
      }
    }

    var condensedSeriesCache = null;
    var condensedSeriesRange = null;
    var condensedSeriesFetchedAt = 0;
    var condensedSparklineOverrides = {};
    var sparklineHistorySeriesCache = null;
    var sparklineHistorySeriesRange = null;
    var sparklineHistorySeriesFetchedAt = 0;
    var sparklineHistorySeriesInFlight = null;

    function getSparklineSeries(series) {
      if (Array.isArray(series) && series.length >= 2) return series;
      if (Array.isArray(sparklineHistorySeriesCache) && sparklineHistorySeriesCache.length >= 2) return sparklineHistorySeriesCache;
      return Array.isArray(series) ? series : [];
    }

    function getSparklineFallbackRangeKey() {
      var rk = normalizeRangeKeyForApi(getStatsRange());
      if (!rk || rk === 'today' || rk === 'yesterday' || rk === '1h' || /^d:\d{4}-\d{2}-\d{2}$/.test(rk)) return '7d';
      return rk;
    }

    function ensureSparklineHistorySeries() {
      var fallbackRange = getSparklineFallbackRangeKey();
      var stale = !sparklineHistorySeriesFetchedAt || (Date.now() - sparklineHistorySeriesFetchedAt) > KPI_CACHE_TTL_MS;
      if (!stale && sparklineHistorySeriesRange === fallbackRange && sparklineHistorySeriesCache && sparklineHistorySeriesCache.length >= 2) {
        return Promise.resolve(sparklineHistorySeriesCache);
      }
      if (sparklineHistorySeriesInFlight) return sparklineHistorySeriesInFlight;
      sparklineHistorySeriesInFlight = fetchWithTimeout(API + '/api/dashboard-series?range=' + encodeURIComponent(fallbackRange), { credentials: 'same-origin', cache: 'default' }, 15000)
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
          var s = data && Array.isArray(data.series) ? data.series : [];
          if (s.length >= 2) {
            sparklineHistorySeriesCache = s;
            sparklineHistorySeriesRange = fallbackRange;
            sparklineHistorySeriesFetchedAt = Date.now();
          }
          return sparklineHistorySeriesCache;
        })
        .catch(function() { return sparklineHistorySeriesCache; })
        .finally(function() { sparklineHistorySeriesInFlight = null; });
      return sparklineHistorySeriesInFlight;
    }

    function renderCondensedSparklines(series) {
      if (typeof ApexCharts === 'undefined') return;
      var sourceSeries = getSparklineSeries(series);
      if (!sourceSeries || !sourceSeries.length) return;
      var GREEN = '#16a34a';
      var RED = '#dc2626';
      var NEUTRAL = '#3eb3ab';
      var map = {
        'cond-kpi-orders-sparkline': function(d) { return d.orders; },
        'cond-kpi-revenue-sparkline': function(d) { return d.revenue; },
        'cond-kpi-conv-sparkline': function(d) { return d.convRate; },
        'cond-kpi-roas-sparkline': function(d) {
          var spend = d && typeof d.adSpend === 'number' ? d.adSpend : 0;
          var rev = d && typeof d.revenue === 'number' ? d.revenue : 0;
          return (spend > 0) ? (rev / spend) : 0;
        },
        'cond-kpi-sessions-sparkline': function(d) { return d.sessions; },
        'cond-kpi-returning-sparkline': function(d) { return d.returningCustomerOrders || 0; },
        'cond-kpi-aov-sparkline': function(d) { return d.aov; },
        'cond-kpi-cogs-sparkline': function() { return null; },
        'cond-kpi-bounce-sparkline': function(d) { return d.bounceRate; },
        'cond-kpi-orders-fulfilled-sparkline': function() { return null; },
        'cond-kpi-returns-sparkline': function() { return null; },
        'cond-kpi-items-sold-sparkline': function(d) { return d.units || 0; }
      };
      Object.keys(map).forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var overrideData = condensedSparklineOverrides && Array.isArray(condensedSparklineOverrides[id]) ? condensedSparklineOverrides[id] : null;
        var dataArr = overrideData && overrideData.length ? overrideData.slice() : sourceSeries.map(map[id]);
        if (dataArr.length < 2) dataArr = dataArr.length === 1 ? [dataArr[0], dataArr[0]] : [0, 0];
        var tone = String(el.getAttribute('data-tone') || '').toLowerCase();
        if (tone !== 'up' && tone !== 'down') {
          tone = 'neutral';
        }
        var sparkColor = tone === 'down' ? RED : (tone === 'up' ? GREEN : NEUTRAL);
        el.innerHTML = '';
        try {
          var chart = new ApexCharts(el, {
            chart: { type: 'line', height: 30, sparkline: { enabled: true }, animations: { enabled: false } },
            series: [{ data: dataArr }],
            stroke: { width: 2.15, curve: 'smooth', lineCap: 'round' },
            // NOTE: ApexCharts 4.x can incorrectly apply fill opacity to line stroke color.
            // Keep fill opacity at 1 for visible strokes; line charts still render line-only.
            fill: { type: 'solid', opacity: 1 },
            colors: [sparkColor],
            markers: { size: 0 },
            grid: { padding: { top: 0, right: 0, bottom: -2, left: 0 } },
            tooltip: { enabled: false }
          });
          chart.render();
        } catch (_) {}
      });
    }

    function fetchCondensedSeries() {
      var rangeKey = getStatsRange();
      if (!rangeKey) return;
      var stale = !condensedSeriesFetchedAt || (Date.now() - condensedSeriesFetchedAt) > KPI_CACHE_TTL_MS;
      if (!stale && condensedSeriesCache && condensedSeriesRange === rangeKey) {
        renderCondensedSparklines(condensedSeriesCache);
        return;
      }
      fetchWithTimeout(API + '/api/dashboard-series?range=' + encodeURIComponent(rangeKey), { credentials: 'same-origin', cache: 'default' }, 15000)
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
          var s = data && data.series ? data.series : null;
          if (s && s.length) {
            condensedSeriesCache = s;
            condensedSeriesRange = rangeKey;
            condensedSeriesFetchedAt = Date.now();
            renderCondensedSparklines(s);
            if (s.length < 2) {
              ensureSparklineHistorySeries().then(function(historySeries) {
                if (historySeries && historySeries.length >= 2) renderCondensedSparklines(s);
              }).catch(function() {});
            }
          }
        })
        .catch(function() {});
    }

    function renderLiveKpis(data) {
      const sales = data && data.sales ? data.sales : {};
      const convertedCountMap = data && data.convertedCount ? data.convertedCount : {};
      const returningCustomerCountMap = data && data.returningCustomerCount ? data.returningCustomerCount : {};
      const breakdown = data && data.trafficBreakdown ? data.trafficBreakdown : {};
      const conv = data && data.conversion ? data.conversion : {};
      const aovMap = data && data.aov ? data.aov : {};
      const bounceMap = data && data.bounce ? data.bounce : {};
      const condOrdersEl = document.getElementById('cond-kpi-orders');
      const condRevenueEl = document.getElementById('cond-kpi-revenue');
      const condConvEl = document.getElementById('cond-kpi-conv');
      const condSessionsEl = document.getElementById('cond-kpi-sessions');
      const condReturningEl = document.getElementById('cond-kpi-returning');
      const condAovEl = document.getElementById('cond-kpi-aov');
      const condRoasEl = document.getElementById('cond-kpi-roas');
      const condBounceEl = document.getElementById('cond-kpi-bounce');
      const topbarOrdersEl = document.getElementById('topbar-kpi-orders');
      const topbarClicksEl = document.getElementById('topbar-kpi-clicks');
      const topbarConvEl = document.getElementById('topbar-kpi-conv');
      const topbarOrdersDeltaEl = document.getElementById('topbar-kpi-orders-delta');
      const topbarOrdersDeltaTextEl = document.getElementById('topbar-kpi-orders-delta-text');
      const topbarClicksDeltaEl = document.getElementById('topbar-kpi-clicks-delta');
      const topbarClicksDeltaTextEl = document.getElementById('topbar-kpi-clicks-delta-text');
      const topbarConvDeltaEl = document.getElementById('topbar-kpi-conv-delta');
      const topbarConvDeltaTextEl = document.getElementById('topbar-kpi-conv-delta-text');
      const kpiRange = getStatsRange();
      const forRange = breakdown[kpiRange];
      const sessionsVal = forRange != null && typeof forRange.human_sessions === 'number' ? forRange.human_sessions : null;
      const orderCountVal = typeof convertedCountMap[kpiRange] === 'number' ? convertedCountMap[kpiRange] : null;
      const revenueVal = typeof sales[kpiRange] === 'number' ? sales[kpiRange] : null;
      const returningVal = typeof returningCustomerCountMap[kpiRange] === 'number' ? returningCustomerCountMap[kpiRange] : null;
      const convVal = typeof conv[kpiRange] === 'number' ? conv[kpiRange] : null;
      const aovVal = typeof aovMap[kpiRange] === 'number' ? aovMap[kpiRange] : null;
      const roasVal = data && data.roas && typeof data.roas[kpiRange] === 'number' ? data.roas[kpiRange] : null;
      const bounceVal = typeof bounceMap[kpiRange] === 'number' ? bounceMap[kpiRange] : null;
      const compare = data && data.compare ? data.compare : null;
      const compareBreakdown = compare && compare.trafficBreakdown ? compare.trafficBreakdown : null;
      const compareSessionsVal = compareBreakdown && typeof compareBreakdown.human_sessions === 'number' ? compareBreakdown.human_sessions : null;
      const compareOrdersVal = compare && typeof compare.convertedCount === 'number' ? compare.convertedCount : null;
      const compareRevenueVal = compare && typeof compare.sales === 'number' ? compare.sales : null;
      const compareReturningVal = compare && typeof compare.returningCustomerCount === 'number' ? compare.returningCustomerCount : null;
      const compareConvVal = compare && typeof compare.conversion === 'number' ? compare.conversion : null;
      const compareAovVal = compare && typeof compare.aov === 'number' ? compare.aov : null;
      const compareRoasVal = compare && typeof compare.roas === 'number' ? compare.roas : null;
      const compareBounceVal = compare && typeof compare.bounce === 'number' ? compare.bounce : null;
      function setCondensedSparklineTone(id, current, baseline, invert) {
        const sparkEl = document.getElementById(id);
        if (!sparkEl) return;
        const cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
        const base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
        if (cur == null || base == null) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        const delta = invert ? (base - cur) : (cur - base);
        if (Math.abs(delta) < 1e-9) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        sparkEl.setAttribute('data-tone', delta < 0 ? 'down' : 'up');
      }

      if (condOrdersEl) condOrdersEl.textContent = orderCountVal != null ? formatSessions(orderCountVal) : '\u2014';
      if (condRevenueEl) condRevenueEl.textContent = revenueVal != null ? formatRevenue(revenueVal) : '\u2014';
      if (condSessionsEl) condSessionsEl.textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (condConvEl) condConvEl.textContent = convVal != null ? pct(convVal) : '\u2014';
      if (condReturningEl) condReturningEl.textContent = returningVal != null ? formatSessions(returningVal) : '\u2014';
      if (condAovEl) condAovEl.textContent = aovVal != null ? formatRevenue(aovVal) : '\u2014';
      if (condRoasEl) condRoasEl.textContent = roasVal != null ? Number(roasVal).toFixed(2) + 'x' : '\u2014';
      if (condBounceEl) condBounceEl.textContent = bounceVal != null ? pct(bounceVal) : '\u2014';
      applyCondensedKpiDelta('orders', orderCountVal, compareOrdersVal, false);
      applyCondensedKpiDelta('revenue', revenueVal, compareRevenueVal, false);
      applyCondensedKpiDelta('sessions', sessionsVal, compareSessionsVal, false);
      applyCondensedKpiDelta('conv', convVal, compareConvVal, false);
      applyCondensedKpiDelta('returning', returningVal, compareReturningVal, false);
      applyCondensedKpiDelta('aov', aovVal, compareAovVal, false);
      applyCondensedKpiDelta('roas', roasVal, compareRoasVal, false);
      applyCondensedKpiDelta('bounce', bounceVal, compareBounceVal, true);
      setCondensedSparklineTone('cond-kpi-orders-sparkline', orderCountVal, compareOrdersVal);
      setCondensedSparklineTone('cond-kpi-revenue-sparkline', revenueVal, compareRevenueVal);
      setCondensedSparklineTone('cond-kpi-conv-sparkline', convVal, compareConvVal);
      setCondensedSparklineTone('cond-kpi-roas-sparkline', roasVal, compareRoasVal);
      setCondensedSparklineTone('cond-kpi-sessions-sparkline', sessionsVal, compareSessionsVal);
      setCondensedSparklineTone('cond-kpi-returning-sparkline', returningVal, compareReturningVal);
      setCondensedSparklineTone('cond-kpi-aov-sparkline', aovVal, compareAovVal);
      setCondensedSparklineTone('cond-kpi-bounce-sparkline', bounceVal, compareBounceVal, true);
      try { updateCondensedKpiOverflow(); } catch (_) {}

      // Header quick KPIs (compact)
      if (topbarOrdersEl) topbarOrdersEl.textContent = orderCountVal != null ? formatSessions(orderCountVal) : '\u2014';
      if (topbarClicksEl) topbarClicksEl.textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (topbarConvEl) topbarConvEl.textContent = convVal != null ? pct(convVal) : '\u2014';

      function deltaPct(curr, prev) {
        const c = (typeof curr === 'number' && Number.isFinite(curr)) ? curr : null;
        const p = (typeof prev === 'number' && Number.isFinite(prev)) ? prev : null;
        if (c == null || p == null) return null;
        // Avoid divide-by-zero: show "new" when baseline is 0 and current is non-zero.
        if (p === 0) return (c === 0) ? 0 : Infinity;
        return ((c - p) / p) * 100;
      }
      function applyTopbarDelta(deltaWrap, deltaTextEl, pctVal) {
        if (!deltaWrap || !deltaTextEl) return;
        if (pctVal == null || !Number.isFinite(pctVal)) {
          if (pctVal === Infinity) {
            deltaWrap.classList.remove('is-hidden');
            deltaWrap.classList.add('is-up');
            deltaWrap.classList.remove('is-down', 'is-flat');
            deltaTextEl.textContent = 'new';
            return;
          }
          deltaWrap.classList.add('is-hidden');
          deltaWrap.classList.remove('is-up', 'is-down', 'is-flat');
          return;
        }
        const p = Math.round(pctVal * 10) / 10;
        const up = p > 0.05;
        const down = p < -0.05;
        deltaWrap.classList.remove('is-hidden');
        deltaWrap.classList.toggle('is-up', up);
        deltaWrap.classList.toggle('is-down', down);
        deltaWrap.classList.toggle('is-flat', !up && !down);
        deltaTextEl.textContent = Math.abs(p).toFixed(1).replace(/\.0$/, '') + '%';
      }

      applyTopbarDelta(
        topbarOrdersDeltaEl,
        topbarOrdersDeltaTextEl,
        deltaPct(orderCountVal, compareOrdersVal)
      );
      applyTopbarDelta(
        topbarClicksDeltaEl,
        topbarClicksDeltaTextEl,
        deltaPct(sessionsVal, compareSessionsVal)
      );
      applyTopbarDelta(
        topbarConvDeltaEl,
        topbarConvDeltaTextEl,
        deltaPct(convVal, compareConvVal)
      );
    }

    // Dashboard KPI cards:
    // - Left compare slot always uses true previous-period values from /api/kpis compare payload.
    // - Right compare slot is optional context (Previous 7 days) shown only on today/yesterday.
    let _dashKpiSecondaryFetchedAt = 0;
    let _dashKpiSecondaryInFlight = null;
    let _dashKpisSecondary = null; // /api/kpis?range=7d
    let _dashKpiExtrasSecondaryFetchedAt = 0;
    let _dashKpiExtrasSecondaryInFlight = null;
    let _dashKpiExtrasSecondary = null; // /api/kpis-expanded-extra?range=7d

    function fetchKpisForRangeKey(rangeKey) {
      rangeKey = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
      if (!rangeKey) rangeKey = 'today';
      const url = API + '/api/kpis?range=' + encodeURIComponent(rangeKey);
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) {
          if (!r || !r.ok) throw new Error('KPIs HTTP ' + (r ? r.status : '0'));
          return r.json();
        });
    }

    function fetchExpandedExtrasForRangeKey(rangeKey) {
      rangeKey = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
      if (!rangeKey) rangeKey = 'today';
      let url = API + '/api/kpis-expanded-extra?range=' + encodeURIComponent(rangeKey);
      try {
        const shop = getShopForSales();
        if (shop) url += '&shop=' + encodeURIComponent(shop);
      } catch (_) {}
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) {
          if (!r || !r.ok) throw new Error('KPI extras HTTP ' + (r ? r.status : '0'));
          return r.json();
        });
    }

    function ensureDashboardSecondaryKpis() {
      const ttlMs = 120 * 1000;
      const fresh = _dashKpiSecondaryFetchedAt && (Date.now() - _dashKpiSecondaryFetchedAt) < ttlMs;
      if (fresh && _dashKpisSecondary) return Promise.resolve(_dashKpisSecondary);
      if (_dashKpiSecondaryInFlight) return _dashKpiSecondaryInFlight;
      _dashKpiSecondaryInFlight = fetchKpisForRangeKey('7d')
        .catch(function() { return null; })
        .then(function(part) {
          _dashKpisSecondary = part || null;
          _dashKpiSecondaryFetchedAt = Date.now();
          return _dashKpisSecondary;
        }).finally(function() {
          _dashKpiSecondaryInFlight = null;
        });
      return _dashKpiSecondaryInFlight;
    }

    function ensureDashboardSecondaryExtras() {
      const ttlMs = 120 * 1000;
      const fresh = _dashKpiExtrasSecondaryFetchedAt && (Date.now() - _dashKpiExtrasSecondaryFetchedAt) < ttlMs;
      if (fresh && _dashKpiExtrasSecondary) return Promise.resolve(_dashKpiExtrasSecondary);
      if (_dashKpiExtrasSecondaryInFlight) return _dashKpiExtrasSecondaryInFlight;
      _dashKpiExtrasSecondaryInFlight = fetchExpandedExtrasForRangeKey('7d')
        .catch(function() { return null; })
        .then(function(part) {
          _dashKpiExtrasSecondary = part || null;
          _dashKpiExtrasSecondaryFetchedAt = Date.now();
          return _dashKpiExtrasSecondary;
        }).finally(function() {
          _dashKpiExtrasSecondaryInFlight = null;
        });
      return _dashKpiExtrasSecondaryInFlight;
    }

    function setDashboardCompareLabels(primaryLabel, secondaryLabel, showSecondary) {
      var p = String(primaryLabel || 'Previous period').trim() || 'Previous period';
      var s = String(secondaryLabel || 'Previous 7 days').trim() || 'Previous 7 days';
      document.querySelectorAll('.dash-kpi-compare-row').forEach(function(row) {
        if (!row) return;
        var items = row.querySelectorAll('.dash-kpi-compare-item');
        var left = items && items[0] ? items[0] : null;
        var right = items && items[1] ? items[1] : null;
        if (left) {
          var leftLabel = left.querySelector('.text-muted.small');
          if (leftLabel) leftLabel.textContent = p + ':';
        }
        if (right) {
          right.classList.toggle('is-hidden', !showSecondary);
          var rightLabel = right.querySelector('.text-muted.small');
          if (rightLabel) rightLabel.textContent = s + ':';
        }
      });
    }

    function renderDashboardKpisFromApi(primaryData) {
      if (!primaryData || PAGE !== 'dashboard') return;
      var el = function(id) { return document.getElementById(id); };
      var kpiRange = getStatsRange();
      var showSecondary = showDashboardSecondaryCompare(kpiRange);

      function numFromMap(dataObj, keyName, rangeKey) {
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

      function sessionsFromBreakdownCompare(compareObj) {
        var br = compareObj && compareObj.trafficBreakdown ? compareObj.trafficBreakdown : null;
        var v = br && typeof br.human_sessions === 'number' ? br.human_sessions : null;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      }

      function numFromCompare(compareObj, keyName) {
        var v = compareObj && typeof compareObj[keyName] === 'number' ? compareObj[keyName] : null;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      }

      var main = primaryData;
      var salesVal = numFromMap(main, 'sales', kpiRange);
      var ordersVal = numFromMap(main, 'convertedCount', kpiRange);
      var sessionsVal = sessionsFromBreakdownMap(main, kpiRange);
      var convVal = numFromMap(main, 'conversion', kpiRange);
      var aovVal = numFromMap(main, 'aov', kpiRange);
      var bounceVal = numFromMap(main, 'bounce', kpiRange);
      var returningVal = numFromMap(main, 'returningCustomerCount', kpiRange);
      var roasVal = numFromMap(main, 'roas', kpiRange);
      var extrasMain = (kpiExpandedExtrasRange === kpiRange) ? (kpiExpandedExtrasCache || null) : null;
      var itemsVal = extrasMain && typeof extrasMain.itemsSold === 'number' ? extrasMain.itemsSold : null;
      var fulfilledVal = extrasMain && typeof extrasMain.ordersFulfilled === 'number' ? extrasMain.ordersFulfilled : null;
      var returnsVal = extrasMain && typeof extrasMain.returns === 'number' ? extrasMain.returns : null;
      var cogsVal = extrasMain && typeof extrasMain.cogs === 'number' ? extrasMain.cogs : null;

      if (el('dash-kpi-revenue')) el('dash-kpi-revenue').textContent = salesVal != null ? formatRevenue0(salesVal) : '\u2014';
      if (el('dash-kpi-orders')) el('dash-kpi-orders').textContent = ordersVal != null ? Math.round(ordersVal).toLocaleString() : '\u2014';
      if (el('dash-kpi-sessions')) el('dash-kpi-sessions').textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (el('dash-kpi-conv')) el('dash-kpi-conv').textContent = convVal != null ? pct(convVal) : '\u2014';
      if (el('dash-kpi-aov')) el('dash-kpi-aov').textContent = aovVal != null ? formatRevenue0(aovVal) : '\u2014';
      if (el('dash-kpi-bounce')) el('dash-kpi-bounce').textContent = bounceVal != null ? pct(bounceVal) : '\u2014';
      if (el('dash-kpi-returning')) el('dash-kpi-returning').textContent = returningVal != null ? Math.round(returningVal).toLocaleString() : '\u2014';
      if (el('dash-kpi-roas')) el('dash-kpi-roas').textContent = roasVal != null ? roasVal.toFixed(2) + 'x' : '\u2014';
      if (el('dash-kpi-items')) el('dash-kpi-items').textContent = itemsVal != null ? Math.round(itemsVal).toLocaleString() : '\u2014';
      if (el('dash-kpi-fulfilled')) el('dash-kpi-fulfilled').textContent = fulfilledVal != null ? Math.round(fulfilledVal).toLocaleString() : '\u2014';
      if (el('dash-kpi-returns')) el('dash-kpi-returns').textContent = returnsVal != null ? formatNegativeCurrencyOrZero(returnsVal, true) : '\u2014';
      if (el('dash-kpi-cogs')) el('dash-kpi-cogs').textContent = cogsVal != null ? formatRevenue0(cogsVal) : '\u2014';

      function renderCompareSlot(slotSuffix, values) {
        values = values || {};
        var sales = values.sales;
        var orders = values.orders;
        var sessions = values.sessions;
        var conv = values.conv;
        var aov = values.aov;
        var bounce = values.bounce;
        var returning = values.returning;
        var roas = values.roas;
        var items = values.items;
        var fulfilled = values.fulfilled;
        var returns = values.returns;
        var cogs = values.cogs;

        if (el('dash-revenue-' + slotSuffix)) el('dash-revenue-' + slotSuffix).textContent = sales != null ? formatRevenue0(sales) : '\u2014';
        if (el('dash-orders-' + slotSuffix)) el('dash-orders-' + slotSuffix).textContent = orders != null ? Math.round(orders).toLocaleString() : '\u2014';
        if (el('dash-sessions-' + slotSuffix)) el('dash-sessions-' + slotSuffix).textContent = sessions != null ? formatSessions(sessions) : '\u2014';
        if (el('dash-conv-' + slotSuffix)) el('dash-conv-' + slotSuffix).textContent = conv != null ? pct(conv) : '\u2014';
        if (el('dash-aov-' + slotSuffix)) el('dash-aov-' + slotSuffix).textContent = aov != null ? formatRevenue0(aov) : '\u2014';
        if (el('dash-bounce-' + slotSuffix)) el('dash-bounce-' + slotSuffix).textContent = bounce != null ? pct(bounce) : '\u2014';
        if (el('dash-returning-' + slotSuffix)) el('dash-returning-' + slotSuffix).textContent = returning != null ? Math.round(returning).toLocaleString() : '\u2014';
        if (el('dash-roas-' + slotSuffix)) el('dash-roas-' + slotSuffix).textContent = roas != null ? roas.toFixed(2) + 'x' : '\u2014';
        if (el('dash-items-' + slotSuffix)) el('dash-items-' + slotSuffix).textContent = items != null ? Math.round(items).toLocaleString() : '\u2014';
        if (el('dash-fulfilled-' + slotSuffix)) el('dash-fulfilled-' + slotSuffix).textContent = fulfilled != null ? Math.round(fulfilled).toLocaleString() : '\u2014';
        if (el('dash-returns-' + slotSuffix)) el('dash-returns-' + slotSuffix).textContent = returns != null ? formatNegativeCurrencyOrZero(returns, true) : '\u2014';
        if (el('dash-cogs-' + slotSuffix)) el('dash-cogs-' + slotSuffix).textContent = cogs != null ? formatRevenue0(cogs) : '\u2014';
      }

      function applyDashDelta(key, current, baseline, invert) {
        var wrap = el('dash-kpi-' + key + '-delta');
        var textEl = el('dash-kpi-' + key + '-delta-text');
        if (!wrap || !textEl) return;

        var cur = typeof current === 'number' && Number.isFinite(current) ? current : null;
        var base = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : null;
        var rawDelta = (cur != null && base != null) ? kpiDelta(cur, base) : null;
        var toneDelta = rawDelta == null ? null : (invert ? -rawDelta : rawDelta);
        var isNew = cur != null && base === 0 && cur !== 0;
        var isUp = toneDelta != null && toneDelta > 0.005;
        var isDown = toneDelta != null && toneDelta < -0.005;
        var isFlat = toneDelta != null && !isUp && !isDown;

        var dir = 'none';
        var text = '\u2014';
        if (rawDelta != null) {
          if (isNew) {
            text = 'new';
            dir = isDown ? 'down' : 'up';
          } else {
            text = formatSignedPercentOneDecimalFromRatio(rawDelta);
            dir = isUp ? 'up' : (isDown ? 'down' : 'flat');
          }
        }

        wrap.classList.remove('is-up', 'is-down', 'is-flat');
        if (rawDelta == null) {
          wrap.classList.add('is-hidden');
          wrap.setAttribute('data-dir', 'none');
          textEl.textContent = '\u2014';
          return;
        }

        wrap.classList.remove('is-hidden');
        if (dir === 'up') wrap.classList.add('is-up');
        else if (dir === 'down') wrap.classList.add('is-down');
        else if (dir === 'flat') wrap.classList.add('is-flat');
        wrap.setAttribute('data-dir', dir);
        textEl.textContent = text;

        var icon = wrap.querySelector ? wrap.querySelector('i') : null;
        if (icon) {
          var iconKey = 'dash-kpi-delta-up';
          if (dir === 'down') iconKey = 'dash-kpi-delta-down';
          else if (dir === 'flat') iconKey = 'dash-kpi-delta-flat';
          icon.setAttribute('data-icon-key', iconKey);
          icon.classList.remove('fa-arrow-trend-up', 'fa-arrow-trend-down', 'fa-minus');
          if (dir === 'down') icon.classList.add('fa-arrow-trend-down');
          else if (dir === 'flat') icon.classList.add('fa-minus');
          else icon.classList.add('fa-arrow-trend-up');
          try {
            if (window.KexoIconTheme && typeof window.KexoIconTheme.applyElement === 'function') {
              window.KexoIconTheme.applyElement(icon);
            }
          } catch (_) {}
        }
      }

      var primaryCompare = main && main.compare ? main.compare : null;
      var primaryExtrasCompare = extrasMain && extrasMain.compare ? extrasMain.compare : null;
      var salesBase = numFromCompare(primaryCompare, 'sales');
      var ordersBase = numFromCompare(primaryCompare, 'convertedCount');
      var sessionsBase = sessionsFromBreakdownCompare(primaryCompare);
      var convBase = numFromCompare(primaryCompare, 'conversion');
      var aovBase = numFromCompare(primaryCompare, 'aov');
      var bounceBase = numFromCompare(primaryCompare, 'bounce');
      var returningBase = numFromCompare(primaryCompare, 'returningCustomerCount');
      var roasBase = numFromCompare(primaryCompare, 'roas');
      var itemsBase = primaryExtrasCompare && typeof primaryExtrasCompare.itemsSold === 'number' ? primaryExtrasCompare.itemsSold : null;
      var fulfilledBase = primaryExtrasCompare && typeof primaryExtrasCompare.ordersFulfilled === 'number' ? primaryExtrasCompare.ordersFulfilled : null;
      var returnsBase = primaryExtrasCompare && typeof primaryExtrasCompare.returns === 'number' ? primaryExtrasCompare.returns : null;
      var cogsBase = primaryExtrasCompare && typeof primaryExtrasCompare.cogs === 'number' ? primaryExtrasCompare.cogs : null;

      applyDashDelta('revenue', salesVal, salesBase, false);
      applyDashDelta('orders', ordersVal, ordersBase, false);
      applyDashDelta('sessions', sessionsVal, sessionsBase, false);
      applyDashDelta('conv', convVal, convBase, false);
      applyDashDelta('aov', aovVal, aovBase, false);
      applyDashDelta('bounce', bounceVal, bounceBase, true);
      applyDashDelta('returning', returningVal, returningBase, false);
      applyDashDelta('roas', roasVal, roasBase, false);
      applyDashDelta('items', itemsVal, itemsBase, false);
      applyDashDelta('fulfilled', fulfilledVal, fulfilledBase, false);
      applyDashDelta('returns', returnsVal, returnsBase, true);
      applyDashDelta('cogs', cogsVal, cogsBase, true);
      renderCompareSlot('yesterday', {
        sales: salesBase,
        orders: ordersBase,
        sessions: sessionsBase,
        conv: convBase,
        aov: aovBase,
        bounce: bounceBase,
        returning: returningBase,
        roas: roasBase,
        items: itemsBase,
        fulfilled: fulfilledBase,
        returns: returnsBase,
        cogs: cogsBase,
      });

      setDashboardCompareLabels(
        getCompareDisplayLabel(kpiRange),
        'Previous 7 days',
        showSecondary
      );

      if (showSecondary) {
        var secondary = _dashKpisSecondary;
        var secondaryRangeKey = '7d';
        var secondaryExtras = _dashKpiExtrasSecondary;
        renderCompareSlot('7d', {
          sales: numFromMap(secondary, 'sales', secondaryRangeKey),
          orders: numFromMap(secondary, 'convertedCount', secondaryRangeKey),
          sessions: sessionsFromBreakdownMap(secondary, secondaryRangeKey),
          conv: numFromMap(secondary, 'conversion', secondaryRangeKey),
          aov: numFromMap(secondary, 'aov', secondaryRangeKey),
          bounce: numFromMap(secondary, 'bounce', secondaryRangeKey),
          returning: numFromMap(secondary, 'returningCustomerCount', secondaryRangeKey),
          roas: numFromMap(secondary, 'roas', secondaryRangeKey),
          items: secondaryExtras && typeof secondaryExtras.itemsSold === 'number' ? secondaryExtras.itemsSold : null,
          fulfilled: secondaryExtras && typeof secondaryExtras.ordersFulfilled === 'number' ? secondaryExtras.ordersFulfilled : null,
          returns: secondaryExtras && typeof secondaryExtras.returns === 'number' ? secondaryExtras.returns : null,
          cogs: secondaryExtras && typeof secondaryExtras.cogs === 'number' ? secondaryExtras.cogs : null,
        });
      } else {
        renderCompareSlot('7d', {});
      }

      // Fetch optional secondary compare in background only when slot is visible.
      if (showSecondary && !_dashKpisSecondary) {
        ensureDashboardSecondaryKpis().then(function() {
          try { if (PAGE === 'dashboard') renderDashboardKpisFromApi(primaryData); } catch (_) {}
        }).catch(function() {});
      }
      if (showSecondary && !_dashKpiExtrasSecondary) {
        ensureDashboardSecondaryExtras().then(function() {
          try { if (PAGE === 'dashboard') renderDashboardKpisFromApi(primaryData); } catch (_) {}
        }).catch(function() {});
      }

      // Main extras are fetched on-demand from the selected range.
      if (!extrasMain) {
        fetchExpandedKpiExtras({ force: false }).then(function() {
          try { if (PAGE === 'dashboard') renderDashboardKpisFromApi(primaryData); } catch (_) {}
        }).catch(function() {});
      }
    }

    // Condensed KPI strip only (expanded overlay removed).
    let _condensedOverflowRaf = 0;
    let _condensedStripResizeObserver = null;
    function updateCondensedKpiOverflow() {
      const strip = document.getElementById('kexo-condensed-kpis');
      if (!strip) return;
      const chipsAll = Array.prototype.slice.call(strip.querySelectorAll('.kexo-kpi-chip'));
      const chips = chipsAll.filter(function(ch) { return ch && ch.classList ? !ch.classList.contains('is-user-disabled') : true; });
      if (!chips.length) return;
      const isMobileViewport = !!(window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches);
      if (isMobileViewport) {
        strip.style.removeProperty('--kexo-kpi-width');
        strip.style.removeProperty('--kexo-kpi-min-width');
        strip.style.setProperty('--kexo-kpi-spark-width', '36px');
        strip.style.setProperty('--kexo-kpi-spark-right', '4px');
        for (let i = 0; i < chips.length; i++) {
          chips[i].classList.remove('is-hidden');
          chips[i].setAttribute('aria-hidden', 'false');
        }
        return;
      }
      // Auto-fit chips to available width; hide overflow chips from the end.
      const avail = strip.clientWidth || 0;
      if (!Number.isFinite(avail) || avail <= 0) return;

      const stripStyle = window.getComputedStyle(strip);
      const gapPx = parseFloat(stripStyle.columnGap || stripStyle.gap) || 0;
      const rootStyle = window.getComputedStyle(document.documentElement);
      const configuredMin = parseFloat(rootStyle.getPropertyValue('--kexo-kpi-min-width')) || 120;
      const minWidth = Math.max(100, configuredMin); // never below 100; hide chips when below min

      function widthFor(count) {
        const n = Math.max(1, Number(count) || 1);
        const totalGap = gapPx * Math.max(0, n - 1);
        return (avail - totalGap) / n;
      }

      let visibleCount = chips.length;
      let chipWidth = widthFor(visibleCount);
      while (visibleCount > 1 && chipWidth < minWidth) {
        visibleCount -= 1;
        chipWidth = widthFor(visibleCount);
      }

      // If we can’t satisfy the floor (extremely narrow), show 1 chip at whatever width we have.
      if (!Number.isFinite(chipWidth) || chipWidth <= 0) return;

      const w = Math.max(0, Math.round(chipWidth * 100) / 100);
      const wStr = String(w).replace(/\.0+$/, '');
      strip.style.setProperty('--kexo-kpi-width', wStr + 'px');
      strip.style.setProperty('--kexo-kpi-min-width', wStr + 'px');

      // Condensed sparkline sizing: shrink more aggressively on tight chips so the chart
      // doesn't sit behind the label/value text when chips are auto-fit small.
      const tight = w <= 136;
      const sparkRatio = tight ? 0.24 : 0.30;
      const sparkW = Math.max(28, Math.min(45, Math.round(w * sparkRatio)));
      strip.style.setProperty('--kexo-kpi-spark-width', String(sparkW) + 'px');
      strip.style.setProperty('--kexo-kpi-spark-right', (tight ? '0px' : '6px'));

      for (let i = 0; i < chips.length; i++) {
        const show = i < visibleCount;
        chips[i].classList.toggle('is-hidden', !show);
        chips[i].setAttribute('aria-hidden', show ? 'false' : 'true');
      }
    }
    function scheduleCondensedKpiOverflowUpdate() {
      if (_condensedOverflowRaf) return;
      const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(cb) { return setTimeout(cb, 16); };
      _condensedOverflowRaf = raf(function() {
        _condensedOverflowRaf = 0;
        updateCondensedKpiOverflow();
      });
    }

    // ── KPI + date range UI config (stored in /api/settings) ───────────────
    var uiSettingsCache = null;
    var uiSettingsFetchedAt = 0;
    var uiSettingsInFlight = null;
    var kpiUiConfigV1 = null;
    var chartsUiConfigV1 = null;
    var KPI_UI_CFG_LS_KEY = 'kexo:kpi-ui-config:v1';
    var CHARTS_UI_CFG_LS_KEY = 'kexo:charts-ui-config:v1';

    // Hydrate KPI prefs from localStorage so disabled KPIs are hidden on first paint.
    try {
      var cachedKpis = safeReadLocalStorageJson(KPI_UI_CFG_LS_KEY);
      if (cachedKpis && cachedKpis.v === 1 && cachedKpis.kpis) {
        kpiUiConfigV1 = cachedKpis;
        try { window.__kexoKpiUiConfigV1 = cachedKpis; } catch (_) {}
      }
    } catch (_) {}

    // Hydrate chart prefs from localStorage so first paint uses the last saved config.
    try {
      var cachedCharts = safeReadLocalStorageJson(CHARTS_UI_CFG_LS_KEY);
      if (cachedCharts && cachedCharts.v === 1 && Array.isArray(cachedCharts.charts)) {
        chartsUiConfigV1 = cachedCharts;
        try { window.__kexoChartsUiConfigV1 = cachedCharts; } catch (_) {}
      }
    } catch (_) {}

    function isChartsMobileViewport() {
      try {
        return !!(window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches);
      } catch (_) {
        return false;
      }
    }

    function shouldHideChartsOnMobile() {
      var cfg = chartsUiConfigV1;
      // Default ON when config is missing/outdated (requested project policy).
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1) return true;
      return cfg.hideOnMobile !== false;
    }

    function applyHideChartsOnMobileClass() {
      var root = null;
      try { root = document.documentElement; } catch (_) { root = null; }
      if (!root || !root.classList) return;
      var on = shouldHideChartsOnMobile();
      var mobile = isChartsMobileViewport();
      root.classList.toggle('kexo-hide-charts-mobile', !!(on && mobile));
    }

    try {
      applyHideChartsOnMobileClass();
      window.addEventListener('resize', function() {
        try { applyHideChartsOnMobileClass(); } catch (_) {}
      });
    } catch (_) {}

    function getChartsUiItem(key) {
      var cfg = chartsUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.charts)) return null;
      var k = String(key == null ? '' : key).trim().toLowerCase();
      if (!k) return null;
      for (var i = 0; i < cfg.charts.length; i++) {
        var it = cfg.charts[i];
        if (!it || typeof it !== 'object') continue;
        var ik = it.key != null ? String(it.key).trim().toLowerCase() : '';
        if (ik && ik === k) return it;
      }
      return null;
    }

    function isChartEnabledByUiConfig(key, fallbackEnabled) {
      if (shouldHideChartsOnMobile() && isChartsMobileViewport()) return false;
      var it = getChartsUiItem(key);
      if (it && it.enabled === false) return false;
      return fallbackEnabled !== false;
    }

    function chartModeFromUiConfig(key, fallbackMode) {
      var k = String(key == null ? '' : key).trim().toLowerCase();
      var it = getChartsUiItem(k);
      var m = it && it.mode != null ? String(it.mode).trim().toLowerCase() : '';
      if (k === 'live-online-chart') {
        if (m === 'map-animated' || m === 'map-flat') return m;
        return 'map-animated';
      }
      if (k === 'countries-map-chart') {
        if (m === 'map-animated' || m === 'map-flat') return m;
        return 'map-flat';
      }
      if (m) return m;
      return String(fallbackMode || '').trim().toLowerCase() || '';
    }

    function chartColorsFromUiConfig(key, fallbackColors) {
      var it = getChartsUiItem(key);
      var arr = it && Array.isArray(it.colors) ? it.colors.filter(Boolean).map(function(c) { return String(c).trim(); }).filter(Boolean) : [];
      if (arr.length) return arr;
      return Array.isArray(fallbackColors) ? fallbackColors : [];
    }

    function chartPieMetricFromUiConfig(key, fallbackMetric) {
      var it = getChartsUiItem(key);
      var raw = it && it.pieMetric != null ? String(it.pieMetric).trim().toLowerCase() : '';
      if (raw === 'sessions' || raw === 'orders' || raw === 'revenue') return raw;
      var fb = String(fallbackMetric || 'sessions').trim().toLowerCase();
      if (fb === 'sessions' || fb === 'orders' || fb === 'revenue') return fb;
      return 'sessions';
    }

    function chartUiConfigSignature(cfg) {
      try { return JSON.stringify(cfg || null); } catch (_) { return ''; }
    }

    function applyChartsUiConfigV1(cfg) {
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1 || !Array.isArray(cfg.charts)) return false;
      var prevSig = chartUiConfigSignature(chartsUiConfigV1);
      var nextSig = chartUiConfigSignature(cfg);
      chartsUiConfigV1 = cfg;
      try { window.__kexoChartsUiConfigV1 = cfg; } catch (_) {}
      try { safeWriteLocalStorageJson(CHARTS_UI_CFG_LS_KEY, cfg); } catch (_) {}
      try { applyHideChartsOnMobileClass(); } catch (_) {}
      return prevSig !== nextSig;
    }

    var chartsUiReRenderTimer = null;
    function scheduleChartsUiReRender() {
      if (chartsUiReRenderTimer) {
        try { clearTimeout(chartsUiReRenderTimer); } catch (_) {}
      }
      chartsUiReRenderTimer = setTimeout(function() {
        chartsUiReRenderTimer = null;
        try {
          if (activeMainTab === 'dashboard') {
            if (typeof refreshDashboard === 'function') refreshDashboard({ force: true });
            return;
          }
          if (activeMainTab === 'stats') {
            refreshStats({ force: true });
            return;
          }
          if (activeMainTab === 'products') {
            refreshProducts({ force: true });
            return;
          }
          if (activeMainTab === 'channels' || activeMainTab === 'type') {
            refreshTraffic({ force: true });
            return;
          }
          if (activeMainTab === 'ads') {
            if (window.__adsRefresh) window.__adsRefresh({ force: true });
            return;
          }
          if (activeMainTab === 'spy' || activeMainTab === 'sales' || activeMainTab === 'date') {
            fetchSessions();
            return;
          }
        } catch (_) {}
      }, 80);
    }

    var tablesUiApplyTimer = null;
    function scheduleTablesUiApply() {
      if (tablesUiApplyTimer) {
        try { clearTimeout(tablesUiApplyTimer); } catch (_) {}
      }
      tablesUiApplyTimer = setTimeout(function() {
        tablesUiApplyTimer = null;
        try { applyTablesUiLayoutForPage(); } catch (_) {}
        try {
          window.dispatchEvent(new CustomEvent('kexo:tablesUiConfigApplied', {
            detail: { v: 1 }
          }));
        } catch (_) {}
      }, 80);
    }

    function applyDateRangeUiConfigToSelect(sel) {
      if (!sel) return;
      var cfg = kpiUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.dateRanges)) return;
      var byKey = {};
      cfg.dateRanges.forEach(function(it) {
        if (!it || typeof it !== 'object') return;
        var k = it.key != null ? String(it.key).trim().toLowerCase() : '';
        if (!k) return;
        byKey[k] = it;
      });

      function labelOf(key, fallback) {
        var it = byKey[key] || null;
        var lbl = it && it.label != null ? String(it.label).trim() : '';
        return lbl || fallback || '';
      }
      function enabledOf(key, defaultEnabled) {
        var it = byKey[key] || null;
        if (it && it.enabled === false) return false;
        return defaultEnabled !== false;
      }

      function applyOne(key, fallbackLabel, defaultEnabled, preserveExistingDisabledHidden) {
        var opt = sel.querySelector('option[value="' + key + '"]');
        if (!opt) return;
        opt.textContent = labelOf(key, fallbackLabel);
        var enabled = enabledOf(key, defaultEnabled);
        // Guardrails: never allow disabling Today/Custom via UI config.
        if (key === 'today' || key === 'custom') enabled = true;

        if (!enabled) {
          opt.disabled = true;
          try { opt.hidden = true; } catch (_) {}
          return;
        }
        if (preserveExistingDisabledHidden) return;
        opt.disabled = false;
        try { opt.hidden = false; } catch (_) {}
      }

      applyOne('today', 'Today', true, false);
      // For yesterday, keep availability rules from applyRangeAvailable (floor + rangeAvailable)
      applyOne('yesterday', 'Yesterday', true, true);
      applyOne('7days', 'Last 7 days', true, false);
      applyOne('14days', 'Last 14 days', true, false);
      applyOne('30days', 'Last 30 days', true, false);
      applyOne('custom', 'Custom\u2026', true, false);
    }

    function applyHeaderKpiStripVisibilityByPage(cfg) {
      try {
        var bar = document.getElementById('kexo-kpis');
        if (!bar || !cfg || cfg.v !== 1) return;
        var page = '';
        try {
          page = String(document.body && document.body.getAttribute ? document.body.getAttribute('data-page') : '').trim().toLowerCase();
        } catch (_) { page = ''; }
        if (!page) return;
        var pages = cfg && cfg.headerStrip && cfg.headerStrip.pages && typeof cfg.headerStrip.pages === 'object' ? cfg.headerStrip.pages : null;
        if (!pages) return;
        if (pages[page] === false) bar.style.display = 'none';
        else bar.style.display = '';
      } catch (_) {}
    }

    function applyCondensedKpiUiConfig(cfg) {
      var strip = document.getElementById('kexo-condensed-kpis');
      if (!strip || !cfg || cfg.v !== 1) return;
      var list = cfg && cfg.kpis && Array.isArray(cfg.kpis.header) ? cfg.kpis.header : null;
      if (!list) return;

      var idByKey = {
        orders: 'cond-kpi-orders',
        revenue: 'cond-kpi-revenue',
        conv: 'cond-kpi-conv',
        roas: 'cond-kpi-roas',
        sessions: 'cond-kpi-sessions',
        returning: 'cond-kpi-returning',
        aov: 'cond-kpi-aov',
        cogs: 'cond-kpi-cogs',
        bounce: 'cond-kpi-bounce',
        fulfilled: 'cond-kpi-orders-fulfilled',
        returns: 'cond-kpi-returns',
        items: 'cond-kpi-items-sold',
      };
      var chipByKey = {};
      Object.keys(idByKey).forEach(function(key) {
        var valueEl = document.getElementById(idByKey[key]);
        var chip = valueEl && valueEl.closest ? valueEl.closest('.kexo-kpi-chip') : null;
        if (chip) chipByKey[key] = chip;
      });

      var allChips = Array.prototype.slice.call(strip.querySelectorAll('.kexo-kpi-chip'));
      var seen = new Set();
      var frag = document.createDocumentFragment();

      list.forEach(function(item) {
        if (!item || typeof item !== 'object') return;
        var key = item.key != null ? String(item.key).trim().toLowerCase() : '';
        if (!key) return;
        var chip = chipByKey[key] || null;
        if (!chip) return;
        var labelEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-label') : null;
        if (labelEl && item.label != null) {
          var lbl = String(item.label).trim();
          if (lbl) labelEl.textContent = lbl;
        }
        var enabled = item.enabled !== false;
        chip.classList.toggle('is-user-disabled', !enabled);
        frag.appendChild(chip);
        seen.add(chip);
      });

      allChips.forEach(function(chip) {
        if (!chip || seen.has(chip)) return;
        frag.appendChild(chip);
      });

      strip.appendChild(frag);
      scheduleCondensedKpiOverflowUpdate();

      // Options: hide/show common elements via inline style so other logic doesn't flip them back.
      var opt = cfg.options && cfg.options.condensed ? cfg.options.condensed : {};
      var showDelta = opt.showDelta !== false;
      var showProgress = opt.showProgress !== false;
      var showSparkline = opt.showSparkline !== false;
      strip.querySelectorAll('.kexo-kpi-chip').forEach(function(chip) {
        if (!chip) return;
        var deltaEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-delta') : null;
        var progEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-progress') : null;
        var sparkEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-sparkline') : null;
        if (deltaEl) deltaEl.style.display = showDelta ? '' : 'none';
        if (progEl) progEl.style.display = showProgress ? '' : 'none';
        if (sparkEl) sparkEl.style.display = showSparkline ? '' : 'none';
      });
    }

    function applyDashboardKpiUiConfig(cfg) {
      var grid = document.getElementById('dash-kpi-grid');
      if (!grid || !cfg || cfg.v !== 1) return;
      var list = cfg && cfg.kpis && Array.isArray(cfg.kpis.dashboard) ? cfg.kpis.dashboard : null;
      if (!list) return;

      var idByKey = {
        revenue: 'dash-kpi-revenue',
        orders: 'dash-kpi-orders',
        conv: 'dash-kpi-conv',
        aov: 'dash-kpi-aov',
        sessions: 'dash-kpi-sessions',
        bounce: 'dash-kpi-bounce',
        returning: 'dash-kpi-returning',
        roas: 'dash-kpi-roas',
        cogs: 'dash-kpi-cogs',
        fulfilled: 'dash-kpi-fulfilled',
        returns: 'dash-kpi-returns',
        items: 'dash-kpi-items',
      };
      var colByKey = {};
      Object.keys(idByKey).forEach(function(key) {
        var valueEl = document.getElementById(idByKey[key]);
        var col = valueEl && valueEl.closest ? valueEl.closest('.col-sm-6') : null;
        if (col) colByKey[key] = col;
      });

      var allCols = Array.prototype.slice.call(grid.children || []).filter(function(el) {
        return el && el.classList && el.classList.contains('col-sm-6');
      });
      var seen = new Set();
      var frag = document.createDocumentFragment();

      list.forEach(function(item) {
        if (!item || typeof item !== 'object') return;
        var key = item.key != null ? String(item.key).trim().toLowerCase() : '';
        if (!key) return;
        var col = colByKey[key] || null;
        if (!col) return;
        var labelEl = col.querySelector ? col.querySelector('.subheader') : null;
        if (labelEl && item.label != null) {
          var lbl = String(item.label).trim();
          if (lbl) labelEl.textContent = lbl;
        }
        var enabled = item.enabled !== false;
        col.classList.toggle('is-user-disabled', !enabled);
        frag.appendChild(col);
        seen.add(col);
      });
      allCols.forEach(function(col) {
        if (!col || seen.has(col)) return;
        col.classList.remove('is-user-disabled');
        frag.appendChild(col);
      });
      grid.appendChild(frag);

      var showDelta = !(cfg.options && cfg.options.dashboard && cfg.options.dashboard.showDelta === false);
      grid.querySelectorAll('.dash-kpi-delta').forEach(function(el) {
        if (!el) return;
        el.style.display = showDelta ? '' : 'none';
      });
    }

    function isStandardDateRangeKey(key) {
      var k = key != null ? String(key).trim().toLowerCase() : '';
      return k === 'today' || k === 'yesterday' || k === '7days' || k === '14days' || k === '30days' || k === 'custom';
    }

    function ensureDateRangeAllowedByUiConfig() {
      var cfg = kpiUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.dateRanges)) return;
      if (!isStandardDateRangeKey(dateRange)) return;
      if (dateRange === 'today' || dateRange === 'custom') return;
      var key = String(dateRange || '').trim().toLowerCase();
      var item = cfg.dateRanges.find(function(it) { return it && typeof it === 'object' && String(it.key || '').trim().toLowerCase() === key; }) || null;
      if (item && item.enabled === false) {
        dateRange = 'today';
        try { syncDateSelectOptions(); } catch (_) {}
        try { applyDateRangeChange(); } catch (_) {}
      }
    }

    function applyKpiUiConfigV1(cfg) {
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1) return;
      kpiUiConfigV1 = cfg;
      try { window.__kexoKpiUiConfigV1 = cfg; } catch (_) {}
      try { safeWriteLocalStorageJson(KPI_UI_CFG_LS_KEY, cfg); } catch (_) {}
      try { applyHeaderKpiStripVisibilityByPage(cfg); } catch (_) {}
      try { applyCondensedKpiUiConfig(cfg); } catch (_) {}
      try { applyDashboardKpiUiConfig(cfg); } catch (_) {}
      try { syncDateSelectOptions(); } catch (_) {}
      try { ensureDateRangeAllowedByUiConfig(); } catch (_) {}
    }

    // Apply cached KPI settings immediately (before async /api/settings returns).
    try { if (kpiUiConfigV1) applyKpiUiConfigV1(kpiUiConfigV1); } catch (_) {}

    function ensureUiSettingsLoaded(options) {
      options = options && typeof options === 'object' ? options : {};
      var force = !!options.force;
      var ttlMs = 5 * 60 * 1000;
      if (!force && uiSettingsCache && uiSettingsFetchedAt && (Date.now() - uiSettingsFetchedAt) < ttlMs) {
        if (options.apply && uiSettingsCache.kpiUiConfig) applyKpiUiConfigV1(uiSettingsCache.kpiUiConfig);
        if (options.apply && uiSettingsCache.chartsUiConfig) {
          var changedFromCache = applyChartsUiConfigV1(uiSettingsCache.chartsUiConfig);
          if (changedFromCache) scheduleChartsUiReRender();
        }
        if (options.apply && uiSettingsCache.tablesUiConfig) {
          try { applyTablesUiConfigV1(uiSettingsCache.tablesUiConfig); } catch (_) {}
          try { scheduleTablesUiApply(); } catch (_) {}
        }
        return Promise.resolve(uiSettingsCache);
      }
      if (uiSettingsInFlight) return uiSettingsInFlight;
      var url = API + '/api/settings' + (force ? ('?_=' + Date.now()) : '');
      uiSettingsInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 15000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          uiSettingsCache = (data && data.ok) ? data : null;
          uiSettingsFetchedAt = Date.now();
          if (options.apply && uiSettingsCache && uiSettingsCache.kpiUiConfig) applyKpiUiConfigV1(uiSettingsCache.kpiUiConfig);
          if (options.apply && uiSettingsCache && uiSettingsCache.chartsUiConfig) {
            var changedFromFetch = applyChartsUiConfigV1(uiSettingsCache.chartsUiConfig);
            if (changedFromFetch) scheduleChartsUiReRender();
          }
          if (options.apply && uiSettingsCache && uiSettingsCache.tablesUiConfig) {
            try { applyTablesUiConfigV1(uiSettingsCache.tablesUiConfig); } catch (_) {}
            try { scheduleTablesUiApply(); } catch (_) {}
          }
          return uiSettingsCache;
        })
        .catch(function() { return null; })
        .finally(function() { uiSettingsInFlight = null; });
      return uiSettingsInFlight;
    }

    try {
      window.addEventListener('kexo:kpiUiConfigUpdated', function(e) {
        var cfg = e && e.detail ? e.detail : null;
        try { applyKpiUiConfigV1(cfg); } catch (_) {}
      });
    } catch (_) {}

    try {
      window.addEventListener('kexo:chartsUiConfigUpdated', function(e) {
        var cfg = e && e.detail ? e.detail : null;
        try {
          var changed = applyChartsUiConfigV1(cfg);
          if (changed) scheduleChartsUiReRender();
        } catch (_) {}
      });
    } catch (_) {}

    try {
      window.addEventListener('kexo:tablesUiConfigUpdated', function(e) {
        var cfg = e && e.detail ? e.detail : null;
        try {
          applyTablesUiConfigV1(cfg);
          scheduleTablesUiApply();
        } catch (_) {}
      });
    } catch (_) {}

    let kpiExpandedExtrasCache = null;
    let kpiExpandedExtrasRange = null;
    let kpiExpandedExtrasFetchedAt = 0;
    let kpiExpandedExtrasInFlight = null;

    function renderExpandedKpiExtras(extras) {
      const condItemsEl = document.getElementById('cond-kpi-items-sold');
      const condFulfilledEl = document.getElementById('cond-kpi-orders-fulfilled');
      const condReturnsEl = document.getElementById('cond-kpi-returns');
      const condCogsEl = document.getElementById('cond-kpi-cogs');
      if (!condItemsEl && !condFulfilledEl && !condReturnsEl && !condCogsEl) return;

      const itemsSold = extras && typeof extras.itemsSold === 'number' ? extras.itemsSold : null;
      const ordersFulfilled = extras && typeof extras.ordersFulfilled === 'number' ? extras.ordersFulfilled : null;
      const returnsAmount = extras && typeof extras.returns === 'number' ? extras.returns : null;
      const cogsAmount = extras && typeof extras.cogs === 'number' ? extras.cogs : null;
      const compare = extras && extras.compare ? extras.compare : null;
      const itemsSoldCompare = compare && typeof compare.itemsSold === 'number' ? compare.itemsSold : null;
      const ordersFulfilledCompare = compare && typeof compare.ordersFulfilled === 'number' ? compare.ordersFulfilled : null;
      const returnsCompare = compare && typeof compare.returns === 'number' ? compare.returns : null;
      const cogsCompare = compare && typeof compare.cogs === 'number' ? compare.cogs : null;

      function formatReturns(v) {
        return formatNegativeCurrencyOrZero(v, false);
      }
      if (condItemsEl) condItemsEl.textContent = itemsSold != null ? formatSessions(itemsSold) : '\u2014';
      if (condFulfilledEl) condFulfilledEl.textContent = ordersFulfilled != null ? formatSessions(ordersFulfilled) : '\u2014';
      if (condReturnsEl) condReturnsEl.textContent = returnsAmount != null ? formatReturns(returnsAmount) : '\u2014';
      if (condCogsEl) condCogsEl.textContent = cogsAmount != null ? formatRevenue(cogsAmount) : '\u2014';
      applyCondensedKpiDelta('items-sold', itemsSold, itemsSoldCompare, false);
      applyCondensedKpiDelta('orders-fulfilled', ordersFulfilled, ordersFulfilledCompare, false);
      applyCondensedKpiDelta('returns', returnsAmount, returnsCompare, true);
      applyCondensedKpiDelta('cogs', cogsAmount, cogsCompare, true);

      function setTone(id, current, baseline, invert) {
        const sparkEl = document.getElementById(id);
        if (!sparkEl) return;
        const cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
        const base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
        if (cur == null || base == null) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        const delta = invert ? (base - cur) : (cur - base);
        if (Math.abs(delta) < 1e-9) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        sparkEl.setAttribute('data-tone', delta < 0 ? 'down' : 'up');
      }
      setTone('cond-kpi-items-sold-sparkline', itemsSold, itemsSoldCompare, false);
      setTone('cond-kpi-orders-fulfilled-sparkline', ordersFulfilled, ordersFulfilledCompare, false);
      setTone('cond-kpi-returns-sparkline', returnsAmount, returnsCompare, true);
      setTone('cond-kpi-cogs-sparkline', cogsAmount, cogsCompare, true);

      if (!condensedSparklineOverrides || typeof condensedSparklineOverrides !== 'object') condensedSparklineOverrides = {};
      condensedSparklineOverrides['cond-kpi-orders-fulfilled-sparkline'] = (ordersFulfilled != null && ordersFulfilledCompare != null) ? [ordersFulfilledCompare, ordersFulfilled] : null;
      condensedSparklineOverrides['cond-kpi-returns-sparkline'] = (returnsAmount != null && returnsCompare != null) ? [returnsCompare, returnsAmount] : null;
      condensedSparklineOverrides['cond-kpi-cogs-sparkline'] = (cogsAmount != null && cogsCompare != null) ? [cogsCompare, cogsAmount] : null;

      try { renderCondensedSparklines(condensedSeriesCache || sparklineHistorySeriesCache || []); } catch (_) {}

      try { updateCondensedKpiOverflow(); } catch (_) {}
    }

    function fetchExpandedKpiExtras(options = {}) {
      const force = !!options.force;
      const rangeKey = getStatsRange();
      if (!rangeKey) return Promise.resolve(null);
      // Paint from localStorage first to avoid empty KPI boxes on fast navigation.
      if (!force) {
        try {
          const wantHydrate =
            (!kpiExpandedExtrasCache || kpiExpandedExtrasRange !== rangeKey) ||
            (!kpiExpandedExtrasFetchedAt || (Date.now() - kpiExpandedExtrasFetchedAt) > KPI_EXTRAS_CACHE_TTL_MS);
          if (wantHydrate) hydrateExpandedExtrasFromLocalStorage(rangeKey, true);
        } catch (_) {}
      }

      const stale = !kpiExpandedExtrasFetchedAt || (Date.now() - kpiExpandedExtrasFetchedAt) > KPI_EXTRAS_CACHE_TTL_MS;
      if (!force && !stale && kpiExpandedExtrasCache && kpiExpandedExtrasRange === rangeKey) {
        return Promise.resolve(kpiExpandedExtrasCache);
      }
      if (kpiExpandedExtrasInFlight && !force && kpiExpandedExtrasRange === rangeKey) return kpiExpandedExtrasInFlight;
      let url = API + '/api/kpis-expanded-extra?range=' + encodeURIComponent(rangeKey);
      try {
        const shop = getShopForSales();
        if (shop) url += '&shop=' + encodeURIComponent(shop);
      } catch (_) {}
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      kpiExpandedExtrasRange = rangeKey;
      kpiExpandedExtrasInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 25000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(extras) {
          kpiExpandedExtrasCache = extras || null;
          kpiExpandedExtrasFetchedAt = Date.now();
          try { setRangeCacheEntry(KPI_EXTRAS_CACHE_LS_KEY, rangeKey, kpiExpandedExtrasCache, 12); } catch (_) {}
          return kpiExpandedExtrasCache;
        })
        .catch(function() { return null; })
        .finally(function() { kpiExpandedExtrasInFlight = null; });
      return kpiExpandedExtrasInFlight;
    }

    (function initCondensedKpisUi() {
      try { window.addEventListener('resize', function() { scheduleCondensedKpiOverflowUpdate(); }); } catch (_) {}
      try { window.addEventListener('orientationchange', function() { scheduleCondensedKpiOverflowUpdate(); }); } catch (_) {}
      try {
        const strip = document.getElementById('kexo-condensed-kpis');
        if (strip && typeof ResizeObserver !== 'undefined') {
          _condensedStripResizeObserver = new ResizeObserver(function() { scheduleCondensedKpiOverflowUpdate(); });
          _condensedStripResizeObserver.observe(strip);
        }
      } catch (_) {}
      scheduleCondensedKpiOverflowUpdate();
    })();

    function delay(ms) {
      const n = Number(ms) || 0;
      if (n <= 0) return Promise.resolve();
      return new Promise(function(resolve) { setTimeout(resolve, n); });
    }

    function fetchWithTimeout(url, options, timeoutMs) {
      const ms = Number(timeoutMs) || 0;
      const timeout = ms > 0 ? ms : 25000;
      if (typeof AbortController === 'undefined') {
        return Promise.race([
          fetch(url, options),
          new Promise(function(_, reject) {
            setTimeout(function() { reject(new Error('Request timed out')); }, timeout);
          }),
        ]);
      }
      const controller = new AbortController();
      const timer = setTimeout(function() { try { controller.abort(); } catch (_) {} }, timeout);
      const opts = Object.assign({}, options || {}, { signal: controller.signal });
      return fetch(url, opts).finally(function() { clearTimeout(timer); });
    }

    function defaultReportBuildTitleForKey(key) {
      const k = key != null ? String(key).trim().toLowerCase() : '';
      if (k === 'stats') return 'Preparing country report';
      if (k === 'products') return 'Preparing product report';
      if (k === 'dashboard') return 'Preparing dashboard overview';
      if (k === 'traffic') {
        const page = (document.body && document.body.getAttribute('data-page')) || '';
        if (page === 'channels') return 'Preparing channels report';
        if (page === 'type') return 'Preparing traffic type report';
        return 'Preparing traffic report';
      }
      if (k === 'sessions') return 'Preparing sessions table';
      if (k === 'diagnostics') return 'Preparing diagnostics';
      if (k === 'kpicompare') return 'Preparing KPI comparison';
      return 'Preparing data';
    }

    function ensureReportBuildMarkup(overlay, titleText, stepId) {
      if (!overlay) return { titleEl: null, stepEl: null };
      let wrap = overlay.querySelector('.report-build-wrap');
      if (!wrap) {
        overlay.innerHTML = '' +
          '<div class="container container-slim py-4 report-build-wrap">' +
            '<div class="text-center">' +
              '<div class="text-secondary mb-2 report-build-title">Preparing application</div>' +
              '<div class="text-secondary mb-3 report-build-step">Preparing application</div>' +
              '<div class="progress progress-sm page-loader-progress"><div class="progress-bar progress-bar-indeterminate"></div></div>' +
            '</div>' +
          '</div>';
        wrap = overlay.querySelector('.report-build-wrap');
      }
      try {
        wrap.querySelectorAll('.spinner-border, .report-build-spinner, .ads-loader-spinner').forEach(function(node) {
          if (node && node.parentNode) node.parentNode.removeChild(node);
        });
      } catch (_) {}
      let titleEl = wrap.querySelector('.report-build-title');
      if (!titleEl) {
        titleEl = document.createElement('div');
        titleEl.className = 'text-secondary mb-2 report-build-title';
        wrap.appendChild(titleEl);
      }
      if (titleText != null) titleEl.textContent = String(titleText);
      let stepEl = null;
      const sid = stepId ? String(stepId) : '';
      if (sid) {
        stepEl = document.getElementById(sid);
        if (!stepEl) {
          stepEl = document.createElement('div');
          stepEl.id = sid;
          stepEl.className = 'report-build-step';
          wrap.appendChild(stepEl);
        }
      } else {
        stepEl = wrap.querySelector('.report-build-step');
        if (!stepEl) {
          stepEl = document.createElement('div');
          stepEl.className = 'text-secondary small mb-3 report-build-step';
          wrap.appendChild(stepEl);
        }
      }
      let progressEl = wrap.querySelector('.page-loader-progress');
      if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'progress progress-sm page-loader-progress';
        progressEl.innerHTML = '<div class="progress-bar progress-bar-indeterminate"></div>';
        wrap.appendChild(progressEl);
      }
      try { overlay.setAttribute('aria-live', 'polite'); } catch (_) {}
      return { titleEl: titleEl, stepEl: stepEl };
    }

    function resolveReportBuildOverlay(opts, key) {
      const sharedOverlay = document.getElementById('page-body-loader');
      if (sharedOverlay) return { overlayId: 'page-body-loader', overlayEl: sharedOverlay };
      const explicitId = opts.overlayId ? String(opts.overlayId) : '';
      if (explicitId) {
        const explicitEl = document.getElementById(explicitId);
        if (explicitEl) return { overlayId: explicitId, overlayEl: explicitEl };
      }
      const keyed = document.querySelector('[data-loader-key="' + key + '"]');
      if (keyed && keyed.id) return { overlayId: keyed.id, overlayEl: keyed };
      return { overlayId: explicitId || '', overlayEl: explicitId ? document.getElementById(explicitId) : null };
    }

    function resolveReportBuildScope(opts, overlay) {
      const pageBody = document.querySelector('.page-body');
      if (pageBody) return pageBody;
      if (opts && opts.scopeEl && opts.scopeEl instanceof Element) return opts.scopeEl;
      const scopeId = opts && opts.scopeId ? String(opts.scopeId) : '';
      if (scopeId) {
        const byId = document.getElementById(scopeId);
        if (byId) return byId;
      }
      if (overlay && overlay.closest) {
        const panel = overlay.closest('.main-tab-panel');
        if (panel) return panel;
      }
      return overlay ? (overlay.parentElement || null) : null;
    }

    const reportBuildScopeState = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    function beginReportBuildScope(scope) {
      if (!scope) return;
      if (!reportBuildScopeState) {
        scope.classList.add('report-building');
        return;
      }
      let state = reportBuildScopeState.get(scope);
      if (!state) state = { count: 0, prevMinHeight: '' };
      if (state.count <= 0) {
        state.prevMinHeight = scope.style.minHeight || '';
        if (scope.classList && scope.classList.contains('page-body')) {
          syncPageBodyLoaderOffset(scope);
          var topPx = scope.style.getPropertyValue('--kexo-loader-page-top') || '0px';
          scope.style.minHeight = 'calc(100vh - ' + topPx + ')';
        } else {
          const h = Number(scope.offsetHeight || 0);
          if (h > 0) scope.style.minHeight = String(Math.ceil(h)) + 'px';
        }
        scope.classList.add('report-building');
      }
      state.count += 1;
      reportBuildScopeState.set(scope, state);
    }

    function endReportBuildScope(scope) {
      if (!scope) return;
      if (!reportBuildScopeState) {
        scope.classList.remove('report-building');
        return;
      }
      let state = reportBuildScopeState.get(scope);
      if (!state) return;
      state.count = Math.max(0, Number(state.count || 0) - 1);
      if (state.count <= 0) {
        scope.classList.remove('report-building');
        scope.style.minHeight = state.prevMinHeight || '';
        reportBuildScopeState.delete(scope);
        return;
      }
      reportBuildScopeState.set(scope, state);
    }

    function startReportBuild(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const key = opts.key ? String(opts.key) : '';
      if (!key || !reportBuildTokens || typeof reportBuildTokens[key] !== 'number') {
        return { step: function() {}, title: function() {}, finish: function() {} };
      }

      reportBuildTokens[key] = (reportBuildTokens[key] || 0) + 1;
      const token = reportBuildTokens[key];
      const resolved = resolveReportBuildOverlay(opts, key);
      const overlay = resolved && resolved.overlayEl ? resolved.overlayEl : null;
      const scope = resolveReportBuildScope(opts, overlay);
      let overlayOrigin = null;
      if (overlay && scope && overlay.parentElement && overlay.parentElement !== scope && scope.contains(overlay)) {
        overlayOrigin = { parent: overlay.parentElement, next: overlay.nextSibling };
        try { scope.insertBefore(overlay, scope.firstChild); } catch (_) {}
      }
      const stepId = overlay && overlay.getAttribute('data-step-id') ? String(overlay.getAttribute('data-step-id')) : '';
      const titleText = opts.title != null ? String(opts.title) : defaultReportBuildTitleForKey(key);
      const ensured = ensureReportBuildMarkup(overlay, titleText, stepId);
      const titleEl = ensured.titleEl;
      const stepEl = ensured.stepEl;

      beginReportBuildScope(scope);
      if (overlay) overlay.classList.remove('is-hidden');
      if (stepEl) {
        if (opts.initialStep != null) stepEl.textContent = String(opts.initialStep);
        else if (!String(stepEl.textContent || '').trim()) stepEl.textContent = 'Preparing application';
      }
      showPageProgress();

      function title(text) {
        if (reportBuildTokens[key] !== token) return;
        if (!titleEl) return;
        titleEl.textContent = text != null ? String(text) : '';
      }

      function step(text, nextTitle) {
        if (reportBuildTokens[key] !== token) return;
        if (typeof nextTitle === 'string') title(nextTitle);
        if (!stepEl) return;
        stepEl.textContent = text != null ? String(text) : '';
      }

      function finish() {
        if (reportBuildTokens[key] !== token) return;
        if (overlay) overlay.classList.add('is-hidden');
        if (overlay && overlayOrigin && overlayOrigin.parent) {
          try {
            if (overlayOrigin.next && overlayOrigin.next.parentNode === overlayOrigin.parent) overlayOrigin.parent.insertBefore(overlay, overlayOrigin.next);
            else overlayOrigin.parent.appendChild(overlay);
          } catch (_) {}
        }
        endReportBuildScope(scope);
        try { window.dispatchEvent(new CustomEvent('kexo:table-rows-changed')); } catch (_) {}
        hidePageProgress();
      }

      return { step: step, title: title, finish: finish };
    }

    function fetchStatsData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/stats?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 30000)
        .then(function(r) {
          if (!r.ok) throw new Error('Stats HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          lastStatsFetchedAt = Date.now();
          lastUpdateTime = new Date();
          updateServerTimeDisplay();
          renderStats(data && typeof data.country === 'object' ? data : {});
          return data;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'reportBuildStats', page: PAGE }); } catch (_) {}
          console.error(err);
          renderStats(statsCache || {});
          return null;
        });
    }

    // ── KPI local cache (prevents empty KPI boxes during fast navigation) ──
    function safeReadLocalStorageJson(key) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (_) {
        return null;
      }
    }

    function safeWriteLocalStorageJson(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {}
    }

    function getRangeCacheEntry(lsKey, rangeKey) {
      if (!lsKey || !rangeKey) return null;
      const root = safeReadLocalStorageJson(lsKey);
      const byRange = root && typeof root === 'object' && root.byRange && typeof root.byRange === 'object' ? root.byRange : null;
      if (!byRange) return null;
      const entry = byRange[rangeKey];
      if (!entry || typeof entry !== 'object') return null;
      const at = entry.at != null ? Number(entry.at) : NaN;
      if (!Number.isFinite(at) || at <= 0) return null;
      return { at, data: entry.data };
    }

    function setRangeCacheEntry(lsKey, rangeKey, data, maxEntries) {
      if (!lsKey || !rangeKey) return;
      let root = safeReadLocalStorageJson(lsKey);
      if (!root || typeof root !== 'object') root = { v: 1, byRange: {} };
      if (!root.byRange || typeof root.byRange !== 'object') root.byRange = {};
      root.byRange[rangeKey] = { at: Date.now(), data: data == null ? null : data };

      const cap = (typeof maxEntries === 'number' && Number.isFinite(maxEntries) && maxEntries > 0) ? Math.trunc(maxEntries) : 12;
      try {
        const keys = Object.keys(root.byRange);
        if (keys.length > cap) {
          keys.sort(function(a, b) {
            const ta = root.byRange[a] && root.byRange[a].at != null ? Number(root.byRange[a].at) : 0;
            const tb = root.byRange[b] && root.byRange[b].at != null ? Number(root.byRange[b].at) : 0;
            return ta - tb;
          });
          while (keys.length > cap) {
            const k = keys.shift();
            if (k) delete root.byRange[k];
          }
        }
      } catch (_) {}

      safeWriteLocalStorageJson(lsKey, root);
    }

    function hydrateKpisFromLocalStorage(rangeKey, allowStale) {
      const entry = getRangeCacheEntry(KPI_CACHE_LS_KEY, rangeKey);
      if (!entry) return false;
      const age = Date.now() - entry.at;
      if (!Number.isFinite(age) || age < 0) return false;
      const maxAge = allowStale ? KPI_CACHE_STALE_OK_MS : KPI_CACHE_TTL_MS;
      if (age > maxAge) return false;
      if (!entry.data || typeof entry.data !== 'object') return false;
      if (lastKpisFetchedAt && entry.at <= lastKpisFetchedAt) return false;
      kpiCache = entry.data;
      kpiCacheRange = rangeKey;
      kpiCacheSource = 'kpis';
      lastKpisFetchedAt = entry.at;
      // If we can paint real numbers immediately, don't flash KPI spinners.
      kpisSpinnerShownOnce = true;
      return true;
    }

    function hydrateExpandedExtrasFromLocalStorage(rangeKey, allowStale) {
      const entry = getRangeCacheEntry(KPI_EXTRAS_CACHE_LS_KEY, rangeKey);
      if (!entry) return false;
      const age = Date.now() - entry.at;
      if (!Number.isFinite(age) || age < 0) return false;
      const maxAge = allowStale ? KPI_EXTRAS_CACHE_STALE_OK_MS : KPI_EXTRAS_CACHE_TTL_MS;
      if (age > maxAge) return false;
      kpiExpandedExtrasCache = entry.data || null;
      kpiExpandedExtrasRange = rangeKey;
      kpiExpandedExtrasFetchedAt = entry.at;
      return true;
    }

    function clearKpiLocalStorageCaches() {
      try { localStorage.removeItem(KPI_CACHE_LS_KEY); } catch (_) {}
      try { localStorage.removeItem(KPI_EXTRAS_CACHE_LS_KEY); } catch (_) {}
      try { kpiCacheRange = ''; } catch (_) {}
      try { kpiCacheSource = ''; } catch (_) {}
    }

    function fetchKpisData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/kpis?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'force=1';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('KPIs HTTP ' + r.status);
          return r.json();
        });
    }

    function refreshKpiExtrasSoft() {
      // Condensed strip includes these KPIs; keep them warm in the background.
      const hasExtrasEls = !!document.getElementById('cond-kpi-items-sold');
      if (!hasExtrasEls) return;
      fetchExpandedKpiExtras({ force: false })
        .then(function(extras) { try { renderExpandedKpiExtras(extras); } catch (_) {} })
        .catch(function() {});
    }

    function refreshKpis(options = {}) {
      const force = !!options.force;
      const rangeKey = getStatsRange();
      if (!rangeKey) return Promise.resolve(null);

      // Hydrate from localStorage so KPI boxes render instantly on fast nav.
      if (!force) {
        try { hydrateKpisFromLocalStorage(rangeKey, true); } catch (_) {}
      }

      const cacheMatchesRange = !!(kpiCache && kpiCacheRange === rangeKey);
      const stale = !cacheMatchesRange || !lastKpisFetchedAt || (Date.now() - lastKpisFetchedAt) > KPI_CACHE_TTL_MS;
      const trustedKpiCache = cacheMatchesRange && kpiCacheSource !== 'stats';

      // If cache is still fresh, avoid refetching.
      if (!force && !stale && trustedKpiCache) {
        try { renderLiveKpis(getKpiData()); } catch (_) {}
        try { if (typeof renderDashboardKpisFromApi === 'function') renderDashboardKpisFromApi(getKpiData()); } catch (_) {}
        try { if (PAGE === 'dashboard' && typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: false }); } catch (_) {}
        try { refreshKpiExtrasSoft(); } catch (_) {}
        try { fetchCondensedSeries(); } catch (_) {}
        return Promise.resolve(kpiCache);
      }

      if (kpisRefreshInFlight && kpisRefreshRangeKey === rangeKey) return kpisRefreshInFlight;

      // Stale-while-revalidate: keep showing last known values while we refresh.
      try {
        if (cacheMatchesRange) {
          renderLiveKpis(getKpiData());
          if (typeof renderDashboardKpisFromApi === 'function') renderDashboardKpisFromApi(getKpiData());
          try { if (PAGE === 'dashboard' && typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: false }); } catch (_) {}
          fetchCondensedSeries();
        }
      } catch (_) {}

      // Only show the KPI mini spinners on the very first load (avoid visual noise on refreshes).
      const showSpinner = !kpisSpinnerShownOnce && !cacheMatchesRange;
      if (showSpinner) {
        kpisSpinnerShownOnce = true;
        setLiveKpisLoading();
      }

      const fetchP = fetchKpisData({ force });
      kpisRefreshRangeKey = rangeKey;
      kpisRefreshInFlight = (showSpinner ? Promise.all([fetchP, delay(KPI_SPINNER_MIN_MS)]) : fetchP)
        .then(function(partsOrData) {
          const data = showSpinner
            ? (partsOrData && partsOrData[0] && typeof partsOrData[0] === 'object' ? partsOrData[0] : null)
            : (partsOrData && typeof partsOrData === 'object' ? partsOrData : null);
          if (data) {
            lastKpisFetchedAt = Date.now();
            kpiCache = data;
            kpiCacheRange = rangeKey;
            kpiCacheSource = 'kpis';
            maybeTriggerSaleToastFromStatsLikeData(kpiCache);
            try { setRangeCacheEntry(KPI_CACHE_LS_KEY, rangeKey, kpiCache, 12); } catch (_) {}
          }
          renderLiveKpis(getKpiData());
          try { if (typeof renderDashboardKpisFromApi === 'function') renderDashboardKpisFromApi(getKpiData()); } catch (_) {}
          try { if (PAGE === 'dashboard' && typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: false }); } catch (_) {}
          try { refreshKpiExtrasSoft(); } catch (_) {}
          try { fetchCondensedSeries(); } catch (_) {}
          return data;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'reportBuildKpis', page: PAGE }); } catch (_) {}
          console.error(err);
          renderLiveKpis(getKpiData());
          try { if (typeof renderDashboardKpisFromApi === 'function') renderDashboardKpisFromApi(getKpiData()); } catch (_) {}
          try { if (PAGE === 'dashboard' && typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: false }); } catch (_) {}
          try { refreshKpiExtrasSoft(); } catch (_) {}
          return null;
        });
      var activeRequest = kpisRefreshInFlight;
      var wrappedRequest = activeRequest.finally(function() {
        if (kpisRefreshInFlight === wrappedRequest) {
          kpisRefreshInFlight = null;
          if (kpisRefreshRangeKey === rangeKey) kpisRefreshRangeKey = '';
        }
      });
      kpisRefreshInFlight = wrappedRequest;
      return wrappedRequest;
    }

    function refreshStats(options = {}) {
      const force = !!options.force;
      if (statsRefreshInFlight) return statsRefreshInFlight;

      const build = startReportBuild({
        key: 'stats',
        overlayId: 'stats-loading-overlay',
        stepId: 'stats-build-step',
        title: 'Preparing country report',
      });
      build.step('Loading country performance data');
      statsRefreshInFlight = fetchStatsData({ force })
        .then(function(data) {
          build.step('Analyzing average order value');
          return delay(180).then(function() {
            build.step('Building country table');
            return delay(120).then(function() {
              return delay(180).then(function() { return data; });
            });
          });
        })
        .finally(function() {
          statsRefreshInFlight = null;
          build.finish();
        });
      return statsRefreshInFlight;
    }

    function refreshProducts(options = {}) {
      const force = !!options.force;
      if (productsRefreshInFlight) return productsRefreshInFlight;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) return Promise.resolve(null);

      const build = startReportBuild({
        key: 'products',
        overlayId: 'products-loading-overlay',
        stepId: 'products-build-step',
        title: 'Preparing product report',
      });
      let bestP = null;
      let variantsP = null;
      let leaderboardP = null;
      let variantCardsP = null;
      try { bestP = fetchBestSellers({ force }); } catch (err) { console.error(err); bestP = Promise.resolve(null); }
      try { variantsP = fetchBestVariants({ force }); } catch (err) { console.error(err); variantsP = Promise.resolve(null); }
      try { leaderboardP = fetchProductsLeaderboard({ force }); } catch (err) { console.error(err); leaderboardP = Promise.resolve(null); }
      try {
        variantCardsP = (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths')
          ? fetchLengths({ force })
          : fetchFinishes({ force });
      } catch (err) {
        console.error(err);
        variantCardsP = Promise.resolve(null);
      }
      function settled(p) {
        return Promise.resolve(p)
          .then(function(v) { return { ok: true, value: v }; })
          .catch(function(err) { console.error(err); return { ok: false, error: err }; });
      }
      const bestS = settled(bestP);
      const variantsS = settled(variantsP);
      const leaderboardS = settled(leaderboardP);
      const variantCardsS = settled(variantCardsP);

      productsRefreshInFlight = Promise.resolve()
        .then(function() { build.step('Loading best-selling products'); return bestS; })
        .then(function() { return delay(180); })
        .then(function() { build.step('Loading top variants'); return variantsS; })
        .then(function() { return delay(180); })
        .then(function() { build.step('Analyzing product leaderboard'); return leaderboardS; })
        .then(function() { return delay(140); })
        .then(function() { build.step('Building product tables'); return variantCardsS; })
        .then(function() { return delay(140); })
        .then(function() { lastProductsFetchedAt = Date.now(); })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'trafficSourceMapsFetch', page: PAGE }); } catch (_) {}
          console.error(err);
          return null;
        })
        .finally(function() {
          productsRefreshInFlight = null;
          build.finish();
        });
      return productsRefreshInFlight;
    }

    function renderTrafficTables(data) {
      const sources = data && data.sources ? data.sources : null;
      const types = data && data.types ? data.types : null;
      const srcBy = (tableSortState.trafficSources.by || 'rev').toString().trim().toLowerCase();
      const srcDir = (tableSortState.trafficSources.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      const typeBy = (tableSortState.trafficTypes.by || 'rev').toString().trim().toLowerCase();
      const typeDir = (tableSortState.trafficTypes.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

      function trafficSourceIconHtml(keyRaw, labelRaw) {
        function icon(src, alt, title, extraClass) {
          const cls = (extraClass ? (extraClass + ' ') : '') + 'source-icon-img';
          const t = title ? ' title="' + escapeHtml(String(title)) + '"' : '';
          return '<img src="' + escapeHtml(hotImg(src) || src || '') + '" alt="' + escapeHtml(alt || '') + '" class="' + cls + '" width="20" height="20"' + t + '>';
        }
        const key = keyRaw != null ? String(keyRaw).trim().toLowerCase() : '';
        const label = labelRaw != null ? String(labelRaw).trim() : '';
        if (!key) return escapeHtml(label || '—');
        const resolvedLabel = trafficSourceLabelForKey(key, label || key);
        const customIcon = trafficSourceIconUrlForKey(key);
        const src = customIcon || trafficSourceBuiltInIconSrc(key) || SOURCE_UNKNOWN_IMG;
        const extra = key === 'google_ads' ? 'source-googleads-img' : '';
        // Traffic tab: show icon + label (Home table is icon-only).
        return '<span class="traffic-source-cell">' +
          '<span class="source-icons">' + icon(src, resolvedLabel, resolvedLabel, extra) + '</span>' +
          '<span class="traffic-source-label">' + escapeHtml(resolvedLabel || label || key) + '</span>' +
        '</span>';
      }

      function renderRows(bodyId, rows, emptyText) {
        const body = document.getElementById(bodyId);
        if (!body) return;
        const list = Array.isArray(rows) ? rows.slice() : [];
        function sourceLabel(r) {
          const key = (r && r.key != null) ? String(r.key).trim().toLowerCase() : '';
          const labelText = (r && r.label) ? String(r.label) : (key || '—');
          return labelText;
        }
        list.sort(function(a, b) {
          var primary = 0;
          if (srcBy === 'source') primary = cmpNullableText(sourceLabel(a), sourceLabel(b), srcDir);
          else if (srcBy === 'cr') primary = cmpNullableNumber(a && a.conversionPct, b && b.conversionPct, srcDir);
          else if (srcBy === 'orders') primary = cmpNullableNumber(a && a.orders, b && b.orders, srcDir);
          else if (srcBy === 'sessions') primary = cmpNullableNumber(a && a.sessions, b && b.sessions, srcDir);
          else if (srcBy === 'rev') primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, srcDir);
          return primary ||
            cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
            cmpNullableNumber(a && a.sessions, b && b.sessions, 'desc') ||
            cmpNullableText(sourceLabel(a), sourceLabel(b), 'asc');
        });
        if (!list.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyText || '—') + '</div></div>';
          updateCardPagination('traffic-sources', 1, 1);
          return;
        }
        var filtered = list.filter(function(r) {
          var s = (r && typeof r.sessions === 'number') ? r.sessions : 0;
          var o = (r && typeof r.orders === 'number') ? r.orders : 0;
          return s >= 1 || o >= 1;
        });
        if (!filtered.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyText || '—') + '</div></div>';
          updateCardPagination('traffic-sources', 1, 1);
          return;
        }
        var pageSize = getTableRowsPerPage('traffic-sources-table', 'live');
        var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        trafficSourcesPage = clampPage(trafficSourcesPage, totalPages);
        updateCardPagination('traffic-sources', trafficSourcesPage, totalPages);
        var pageStart = (trafficSourcesPage - 1) * pageSize;
        var pagedRows = filtered.slice(pageStart, pageStart + pageSize);
        let html = '';
        pagedRows.forEach(function(r) {
          const key = (r && r.key != null) ? String(r.key).trim().toLowerCase() : '';
          const labelText = (r && r.label) ? String(r.label) : (key || '—');
          const labelCell = trafficSourceIconHtml(key, labelText);
          const cr = (r && typeof r.conversionPct === 'number') ? pct(r.conversionPct) : '—';
          const orders = (r && typeof r.orders === 'number') ? formatSessions(r.orders) : '—';
          const sessions = (r && typeof r.sessions === 'number') ? formatSessions(r.sessions) : '—';
          const rev = (r && typeof r.revenueGbp === 'number') ? formatRevenueTableHtml(r.revenueGbp) : '—';
          html += '<div class="grid-row" role="row">' +
            '<div class="grid-cell" role="cell">' + labelCell + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sessions || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(orders || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(cr || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + (rev || '—') + '</div>' +
            '</div>';
        });
        body.innerHTML = html;
      }

      renderRows('traffic-sources-body', sources ? sources.rows : [], 'Open Settings (footer) → Traffic to choose channels.');

      function trafficTypeDeviceIcon(device) {
        var d = (device || '').trim().toLowerCase();
        var s = 'width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
        if (d === 'desktop') return '<i class="' + s + ' fa-light fa-desktop" data-icon-key="type-device-desktop"></i>';
        if (d === 'mobile') return '<i class="' + s + ' fa-light fa-mobile-screen" data-icon-key="type-device-mobile"></i>';
        if (d === 'tablet') return '<i class="' + s + ' fa-light fa-tablet-screen-button" data-icon-key="type-device-tablet"></i>';
        return '<i class="' + s + ' fa-light fa-globe" data-icon-key="type-device-unknown"></i>';
      }

      function trafficTypePlatformIcon(platform) {
        var p = (platform || '').trim().toLowerCase();
        if (p === 'ios' || p === 'mac') return '<i class="fa-light fa-apple" data-icon-key="type-platform-ios"></i>';
        if (p === 'android') return '<i class="fa-light fa-android" data-icon-key="type-platform-android"></i>';
        if (p === 'windows') return '<i class="fa-light fa-windows" data-icon-key="type-platform-windows"></i>';
        if (p === 'linux') return '<i class="fa-light fa-linux" data-icon-key="type-platform-linux"></i>';
        return '<i class="fa-light fa-circle-question" data-icon-key="type-platform-unknown"></i>';
      }

      (function renderTypeTree() {
        const body = document.getElementById('traffic-types-body');
        if (!body) return;
        const groups = types && Array.isArray(types.rows) ? types.rows.slice() : [];
        if (!groups.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml('Open Settings (footer) → Traffic to choose device types.') + '</div></div>';
          updateCardPagination('traffic-types', 1, 1);
          return;
        }
        function typeLabel(r) {
          if (!r) return '—';
          if (r.label != null && String(r.label).trim() !== '') return String(r.label);
          if (r.platform != null && String(r.platform).trim() !== '') return String(r.platform);
          if (r.key != null && String(r.key).trim() !== '') return String(r.key);
          return '—';
        }
        groups.sort(function(a, b) {
          var primary = 0;
          if (typeBy === 'type') primary = cmpNullableText(typeLabel(a), typeLabel(b), typeDir);
          else if (typeBy === 'cr') primary = cmpNullableNumber(a && a.conversionPct, b && b.conversionPct, typeDir);
          else if (typeBy === 'orders') primary = cmpNullableNumber(a && a.orders, b && b.orders, typeDir);
          else if (typeBy === 'sessions') primary = cmpNullableNumber(a && a.sessions, b && b.sessions, typeDir);
          else if (typeBy === 'rev') primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, typeDir);
          return primary ||
            cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
            cmpNullableNumber(a && a.sessions, b && b.sessions, 'desc') ||
            cmpNullableText(typeLabel(a), typeLabel(b), 'asc');
        });

        var filteredGroups = groups.filter(function(g) {
          var s = (g && typeof g.sessions === 'number') ? g.sessions : 0;
          var o = (g && typeof g.orders === 'number') ? g.orders : 0;
          return s >= 1 || o >= 1;
        });
        if (!filteredGroups.length) {
          body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No traffic types with sessions or sales.</div></div>';
          updateCardPagination('traffic-types', 1, 1);
          return;
        }
        var groupPageSize = getTableRowsPerPage('traffic-types-table', 'live');
        var groupPages = Math.max(1, Math.ceil(filteredGroups.length / groupPageSize));
        trafficTypesPage = clampPage(trafficTypesPage, groupPages);
        updateCardPagination('traffic-types', trafficTypesPage, groupPages);
        var groupStart = (trafficTypesPage - 1) * groupPageSize;
        var pageGroups = filteredGroups.slice(groupStart, groupStart + groupPageSize);
        let html = '';
        pageGroups.forEach(function(g) {
          const device = (g && g.device != null) ? String(g.device).trim().toLowerCase() : '';
          const open = trafficTypeExpanded === null ? true : !!(device && trafficTypeExpanded && trafficTypeExpanded[device]);
          const label = escapeHtml((g && g.label) ? String(g.label) : (g && g.key ? String(g.key) : '—'));
          const cr = (g && typeof g.conversionPct === 'number') ? pct(g.conversionPct) : '—';
          const orders = (g && typeof g.orders === 'number') ? formatSessions(g.orders) : '—';
          const sessions = (g && typeof g.sessions === 'number') ? formatSessions(g.sessions) : '—';
          const rev = (g && typeof g.revenueGbp === 'number') ? formatRevenueTableHtml(g.revenueGbp) : '—';
          html += '<div class="grid-row traffic-type-parent" role="row" data-device="' + escapeHtml(device) + '">' +
            '<div class="grid-cell" role="cell">' +
              '<button type="button" class="traffic-type-toggle" data-device="' + escapeHtml(device) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
                '<span class="tt-device-icon" aria-hidden="true">' + trafficTypeDeviceIcon(device) + '</span>' +
                '<span>' + label + '</span>' +
              '</button>' +
            '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sessions || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(orders || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(cr || '—') + '</div>' +
            '<div class="grid-cell" role="cell">' + (rev || '—') + '</div>' +
          '</div>';

          const kids = (g && Array.isArray(g.children)) ? g.children.slice() : [];
          kids.sort(function(a, b) {
            var primary = 0;
            if (typeBy === 'type') primary = cmpNullableText(typeLabel(a), typeLabel(b), typeDir);
            else if (typeBy === 'cr') primary = cmpNullableNumber(a && a.conversionPct, b && b.conversionPct, typeDir);
            else if (typeBy === 'orders') primary = cmpNullableNumber(a && a.orders, b && b.orders, typeDir);
            else if (typeBy === 'sessions') primary = cmpNullableNumber(a && a.sessions, b && b.sessions, typeDir);
            else if (typeBy === 'rev') primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, typeDir);
            return primary ||
              cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
              cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
              cmpNullableNumber(a && a.sessions, b && b.sessions, 'desc') ||
              cmpNullableText(typeLabel(a), typeLabel(b), 'asc');
          });
          kids.forEach(function(c) {
            const clabel = escapeHtml((c && c.label) ? String(c.label) : (c && c.platform ? String(c.platform) : (c && c.key ? String(c.key) : '—')));
            const ccr = (c && typeof c.conversionPct === 'number') ? pct(c.conversionPct) : '—';
            const corders = (c && typeof c.orders === 'number') ? formatSessions(c.orders) : '—';
            const csessions = (c && typeof c.sessions === 'number') ? formatSessions(c.sessions) : '—';
            const crev = (c && typeof c.revenueGbp === 'number') ? formatRevenueTableHtml(c.revenueGbp) : '—';
            html += '<div class="grid-row traffic-type-child' + (open ? '' : ' is-hidden') + '" role="row" data-parent="' + escapeHtml(device) + '">' +
              '<div class="grid-cell" role="cell">' + clabel + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(csessions || '—') + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(corders || '—') + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(ccr || '—') + '</div>' +
              '<div class="grid-cell" role="cell">' + (crev || '—') + '</div>' +
            '</div>';
          });
        });
        body.innerHTML = html;
      })();

      updateSortHeadersInContainer(document.getElementById('traffic-sources-table'), srcBy, srcDir);
      updateSortHeadersInContainer(document.getElementById('traffic-types-table'), typeBy, typeDir);
    }

    function renderTrafficPickers(data) {
      function renderPicker(containerId, available, enabled, onChange) {
        const el = document.getElementById(containerId);
        if (!el) return;
        const have = new Set((enabled || []).map(function(k) { return String(k || '').trim().toLowerCase(); }).filter(Boolean));
        const list = Array.isArray(available) ? available.slice() : [];
        if (!list.length) {
          el.innerHTML = '<div class="dm-def-note">No items yet.</div>';
          return;
        }
        let html = '';
        list.forEach(function(item) {
          const key = item && item.key != null ? String(item.key).trim().toLowerCase() : '';
          if (!key) return;
          const label = escapeHtml(item.label != null ? String(item.label) : key);
          const checked = have.has(key);
          const meta = (item && typeof item.sessions === 'number') ? (formatSessions(item.sessions) + ' sessions') : '';
          html += '<label class="traffic-picker-item">' +
            '<input type="checkbox" data-key="' + key + '"' + (checked ? ' checked' : '') + ' />' +
            '<span>' + label + '</span>' +
            (meta ? ('<span class="traffic-picker-meta">' + escapeHtml(meta) + '</span>') : '') +
            '</label>';
        });
        el.innerHTML = html;
        el.onchange = function(e) {
          const t = e && e.target ? e.target : null;
          if (!t || t.tagName !== 'INPUT') return;
          const keys = Array.from(el.querySelectorAll('input[type="checkbox"][data-key]:checked'))
            .map(function(inp) { return (inp.getAttribute('data-key') || '').trim(); })
            .filter(Boolean);
          onChange(keys);
        };
      }

      renderPicker(
        'traffic-sources-picker',
        data && data.sources ? data.sources.available : [],
        data && data.sources ? data.sources.enabled : [],
        function(keys) { saveTrafficPrefs({ sourcesEnabled: keys }); }
      );
      renderPicker(
        'traffic-types-picker',
        data && data.types ? data.types.available : [],
        data && data.types ? data.types.enabled : [],
        function(keys) { saveTrafficPrefs({ typesEnabled: keys }); }
      );
    }

    var channelsChartInstance = null;
    var channelsChartData = null;

    function renderChannelsChart(data) {
      var el = document.getElementById('channels-chart');
      if (!el) return;
      if (typeof ApexCharts === 'undefined') {
        // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
        const tries = (el.__kexoApexWaitTries || 0) + 1;
        el.__kexoApexWaitTries = tries;
        if (tries >= 25) {
          el.__kexoApexWaitTries = 0;
          captureChartMessage('Chart library failed to load.', 'channelsChartLibraryLoad', { chartKey: 'channels-chart', tries: tries }, 'error');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);text-align:center;padding:0 18px;font-size:.875rem">Chart library failed to load.</div>';
          return;
        }
        setTimeout(function() { renderChannelsChart(data); }, 200);
        return;
      }
      try { el.__kexoApexWaitTries = 0; } catch (_) {}
      var chartKey = 'channels-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (channelsChartInstance) { try { channelsChartInstance.destroy(); } catch (_) {} channelsChartInstance = null; }
        el.innerHTML = '';
        return;
      }
      if (channelsChartInstance) { try { channelsChartInstance.destroy(); } catch (_) {} channelsChartInstance = null; }
      if (data) channelsChartData = data;
      var d = channelsChartData;

      // New trend chart: multi-series sessions over time (top 5) with right-side legend.
      var chartPayload = d && d.sources && d.sources.chart ? d.sources.chart : null;
      if (chartPayload && Array.isArray(chartPayload.buckets) && Array.isArray(chartPayload.series)) {
        var buckets = chartPayload.buckets.slice();
        var seriesRows = chartPayload.series.slice()
          .filter(function(s) { return s && Array.isArray(s.sessions); })
          .slice(0, 5);
        if (!buckets.length || !seriesRows.length) {
          var enabledKeys = d && d.sources && Array.isArray(d.sources.enabled) ? d.sources.enabled : [];
          var msg = enabledKeys && enabledKeys.length ? 'No channel data available' : 'Open Settings (footer) → Traffic to choose channels.';
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">' + escapeHtml(msg) + '</div>';
          return;
        }
        // Normalize to the shortest series length.
        var len = buckets.length;
        seriesRows.forEach(function(s) { if (Array.isArray(s.sessions)) len = Math.min(len, s.sessions.length); });
        if (!Number.isFinite(len) || len < 2) {
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No channel data available</div>';
          return;
        }
        buckets = buckets.slice(0, len);
        seriesRows = seriesRows.map(function(s) { return { ...s, sessions: (s.sessions || []).slice(0, len) }; });

        var bucketKind = chartPayload.bucket === 'hour' ? 'hour' : 'day';
        var categories = buckets.map(function(ts) { return bucketKind === 'hour' ? shortTimeLabel(ts) : shortDayLabel(ts); });
        var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
        var showEndLabels = rawMode === 'multi-line-labels';
        var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
        var palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e']);
        var colors = seriesRows.map(function(_s, i) { return palette[i % palette.length]; });

        // Split layout: plot + legend
        el.innerHTML = '<div class="kexo-series-split-chart">' +
          '<div class="kexo-series-split-plot" id="channels-chart-plot"></div>' +
          '<div class="kexo-series-split-legend" id="channels-chart-legend" aria-label="Top channels"></div>' +
          '</div>';
        var plotEl = document.getElementById('channels-chart-plot');
        var legendEl = document.getElementById('channels-chart-legend');
        if (!plotEl) return;

        if (legendEl) {
          legendEl.innerHTML = seriesRows.map(function(s, i) {
            var lbl = (s && (s.label || s.key)) ? String(s.label || s.key) : '—';
            var total = (s && typeof s.totalSessions === 'number') ? s.totalSessions : 0;
            if (!Number.isFinite(total)) total = 0;
            return '<div class="kexo-series-legend-item" title="' + escapeHtml(lbl) + '">' +
              '<span class="kexo-series-legend-dot" style="background:' + escapeHtml(colors[i] || '#4b94e4') + '"></span>' +
              '<div class="kexo-series-legend-meta">' +
                '<div class="kexo-series-legend-label">' + escapeHtml(lbl) + '</div>' +
                '<div class="kexo-series-legend-value">' + escapeHtml(Math.max(0, Math.trunc(total)).toLocaleString()) + '</div>' +
              '</div>' +
            '</div>';
          }).join('');
        }

        // Chart data: sessions only (series = channel)
        var apexSeries = seriesRows.map(function(s, i) {
          var name = (s && (s.label || s.key)) ? String(s.label || s.key) : ('Series ' + String(i + 1));
          var nums = (s && Array.isArray(s.sessions)) ? s.sessions.map(function(v) { var n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0; }) : [];
          return { name: name, data: nums };
        });

        if (mode === 'pie') {
          function renderChannelsPie() {
            plotEl.innerHTML = '';
            try {
              channelsChartInstance = new ApexCharts(plotEl, {
                chart: { type: 'pie', height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
                series: seriesRows.map(function(s) { return Number(s && s.totalSessions) || 0; }),
                labels: seriesRows.map(function(s) { return (s && (s.label || s.key)) ? String(s.label || s.key) : '—'; }),
                colors: colors,
                legend: { show: false },
                dataLabels: { enabled: true, formatter: function(pct) { return (typeof pct === 'number' && isFinite(pct)) ? (pct.toFixed(0) + '%') : ''; } },
                tooltip: { y: { formatter: function(v) { return Number(v || 0).toLocaleString(); } } },
              });
              channelsChartInstance.render();
            } catch (err) {
              console.error('[channels] chart render error:', err);
              plotEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
            }
          }
          if (typeof window.kexoWaitForContainerDimensions === 'function') {
            window.kexoWaitForContainerDimensions(plotEl, function() {
              requestAnimationFrame(renderChannelsPie);
            });
          } else { renderChannelsPie(); }
          return;
        }

        var chartType = normalizeChartType(mode, 'line');
        function renderChannelsLineBar() {
          plotEl.innerHTML = '';
          try {
            channelsChartInstance = new ApexCharts(plotEl, {
            chart: {
              type: chartType,
              height: 320,
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
              zoom: { enabled: false },
              animations: { enabled: true, easing: 'easeinout', speed: 350, dynamicAnimation: { enabled: true, speed: 350 } },
              stacked: chartType === 'bar',
            },
            series: apexSeries,
            colors: colors,
            stroke: chartType === 'bar' ? { width: 0 } : { width: 2.6, curve: 'smooth' },
            fill: chartType === 'area'
              ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.18, opacityTo: 0.05, stops: [0, 100] } }
              : { type: 'solid', opacity: chartType === 'line' ? 0 : 1 },
            plotOptions: chartType === 'bar' ? { bar: { horizontal: false, columnWidth: '62%', borderRadius: 3 } } : {},
            markers: { size: 0, hover: { size: 4 } },
            dataLabels: (showEndLabels && chartType === 'line') ? {
              enabled: true,
              formatter: function(val, ctx) {
                try {
                  var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                  var w = ctx && ctx.w ? ctx.w : null;
                  var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                  if (dp !== last) return '';
                } catch (_) { return ''; }
                return Number(val || 0).toLocaleString();
              },
              style: { fontSize: '10px' },
              background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
              offsetY: -3,
            } : { enabled: false },
            xaxis: {
              categories: categories,
              labels: { style: { fontSize: '11px' }, rotate: bucketKind === 'hour' ? -18 : 0, hideOverlappingLabels: true }
            },
            yaxis: {
              min: 0,
              forceNiceScale: true,
              labels: { style: { fontSize: '11px' }, formatter: function(v) { return Number(v || 0).toLocaleString(); } }
            },
            tooltip: {
              shared: true,
              intersect: false,
              y: { formatter: function(v) { return Number(v || 0).toLocaleString(); } },
            },
            legend: { show: false },
            grid: { borderColor: '#f1f1f1', strokeDashArray: 3 }
          });
          var renderPromise = channelsChartInstance.render();
          if (renderPromise && typeof renderPromise.then === 'function') {
            renderPromise.catch(function(err) {
              try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'channelsChartRender', page: PAGE }); } catch (_) {}
              console.error('[channels] chart render error:', err);
              plotEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
            });
          }
        } catch (err) {
          console.error('[channels] chart render error:', err);
          plotEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
        }
        if (typeof window.kexoWaitForContainerDimensions === 'function') {
          window.kexoWaitForContainerDimensions(plotEl, function() {
            requestAnimationFrame(renderChannelsLineBar);
          });
        } else { renderChannelsLineBar(); }
        return;
      }

      var rows = d && d.sources && Array.isArray(d.sources.rows) ? d.sources.rows.slice() : [];
      rows = rows.filter(function(r) {
        return r && ((Number(r.revenueGbp) || 0) > 0 || (Number(r.sessions) || 0) > 0 || (Number(r.orders) || 0) > 0);
      });
      rows.sort(function(a, b) { return (Number(b && b.revenueGbp) || 0) - (Number(a && a.revenueGbp) || 0); });
      rows = rows.slice(0, 5);
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No channel data available</div>';
        return;
      }
      var categories = rows.map(function(r) {
        var lbl = r.label || r.key || '—';
        return lbl.length > 22 ? lbl.substring(0, 19) + '...' : lbl;
      });
      var sessions = rows.map(function(r) { return Number((r && r.sessions) || 0); });
      var orders = rows.map(function(r) { return Number((r && r.orders) || 0); });
      var revenues = rows.map(function(r) { return Number((r && r.revenueGbp) || 0); });
      var series = [
        { name: 'Sessions', data: sessions },
        { name: 'Orders', data: orders },
        { name: 'Revenue', data: revenues }
      ];
      var valid = categories.length > 0 && series.every(function(s) {
        return s && Array.isArray(s.data) && s.data.length === categories.length && s.data.every(function(v) {
          return typeof v === 'number' && Number.isFinite(v);
        });
      });
      if (!valid) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No channel data available</div>';
        return;
      }

      var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      var showEndLabels = rawMode === 'multi-line-labels';
      var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      var palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab']);

      if (mode === 'pie') {
        var metric = chartPieMetricFromUiConfig(chartKey, 'sessions');
        var seriesArr = metric === 'revenue' ? revenues : (metric === 'orders' ? orders : sessions);
        var yFmt = function(v) {
          if (metric === 'revenue') return formatRevenue(Number(v)) || '—';
          return Number(v || 0).toLocaleString();
        };
        el.innerHTML = '';
        try {
          channelsChartInstance = new ApexCharts(el, {
            chart: { type: 'pie', height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
            series: seriesArr,
            labels: categories,
            colors: palette,
            legend: { position: 'bottom', fontSize: '12px' },
            dataLabels: { enabled: true, formatter: function(pct) { return (typeof pct === 'number' && isFinite(pct)) ? (pct.toFixed(0) + '%') : ''; } },
            tooltip: { y: { formatter: yFmt } },
          });
          channelsChartInstance.render();
        } catch (err) {
          console.error('[channels] chart render error:', err);
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
        return;
      }

      var chartType = normalizeChartType(mode, 'line');
      el.innerHTML = '';
      try {
        channelsChartInstance = new ApexCharts(el, {
          chart: { type: chartType, height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
          series: series,
          colors: palette,
          stroke: chartType === 'bar' ? { width: 0 } : { width: [3, 2.4, 2.4], curve: 'smooth' },
          fill: chartType === 'area'
            ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.22, opacityTo: 0.06, stops: [0, 100] } }
            : { type: 'solid', opacity: chartType === 'line' ? 0 : 1 },
          plotOptions: chartType === 'bar' ? { bar: { columnWidth: '56%', borderRadius: 3 } } : {},
          markers: { size: chartType === 'line' ? 3 : 0, hover: { size: 5 } },
          dataLabels: (showEndLabels && chartType === 'line') ? {
            enabled: true,
            formatter: function(val, ctx) {
              try {
                var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                var w = ctx && ctx.w ? ctx.w : null;
                var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                if (dp !== last) return '';
              } catch (_) { return ''; }
              var idx = ctx && ctx.seriesIndex != null ? Number(ctx.seriesIndex) : 0;
              if (idx === 2) return formatRevenue(Number(val)) || '—';
              return Number(val || 0).toLocaleString();
            },
            style: { fontSize: '10px' },
            background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
            offsetY: -3,
          } : { enabled: false },
          xaxis: {
            categories: categories,
            labels: { style: { fontSize: '11px' }, rotate: -20, hideOverlappingLabels: false }
          },
          yaxis: [
            {
              min: 0,
              forceNiceScale: true,
              labels: {
                style: { fontSize: '11px' },
                formatter: function(v) { return Number(v || 0).toLocaleString(); }
              }
            },
            {
              min: 0,
              forceNiceScale: true,
              show: false,
              labels: { show: false },
            },
            {
              min: 0,
              opposite: true,
              forceNiceScale: true,
              labels: {
                style: { fontSize: '11px' },
                formatter: function(v) { return formatRevenue(Number(v)) || '—'; }
              }
            }
          ],
          tooltip: {
            shared: true,
            intersect: false,
            y: {
              formatter: function(v, opts) {
                var idx = opts && opts.seriesIndex != null ? Number(opts.seriesIndex) : 0;
                if (idx === 2) return formatRevenue(Number(v)) || '—';
                return Number(v || 0).toLocaleString();
              }
            }
          },
          legend: { position: 'top', fontSize: '12px' },
          grid: { borderColor: '#f1f1f1', strokeDashArray: 3 }
        });
        var renderPromise = channelsChartInstance.render();
        if (renderPromise && typeof renderPromise.then === 'function') {
          renderPromise.catch(function(err) {
            try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'channelsChartRender', page: PAGE }); } catch (_) {}
            console.error('[channels] chart render error:', err);
            el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
          });
        }
      } catch (err) {
        console.error('[channels] chart render error:', err);
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    var typeChartInstance = null;

    function renderTypeChart(data) {
      var el = document.getElementById('type-chart');
      if (!el) return;
      if (typeof ApexCharts === 'undefined') {
        // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
        const tries = (el.__kexoApexWaitTries || 0) + 1;
        el.__kexoApexWaitTries = tries;
        if (tries >= 25) {
          el.__kexoApexWaitTries = 0;
          captureChartMessage('Chart library failed to load.', 'typeChartLibraryLoad', { chartKey: 'type-chart', tries: tries }, 'error');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);text-align:center;padding:0 18px;font-size:.875rem">Chart library failed to load.</div>';
          return;
        }
        setTimeout(function() { renderTypeChart(data); }, 200);
        return;
      }
      try { el.__kexoApexWaitTries = 0; } catch (_) {}
      var chartKey = 'type-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (typeChartInstance) { try { typeChartInstance.destroy(); } catch (_) {} typeChartInstance = null; }
        el.innerHTML = '';
        return;
      }
      if (typeChartInstance) { try { typeChartInstance.destroy(); } catch (_) {} typeChartInstance = null; }

      // New trend chart: multi-series sessions over time (top 5) with right-side legend.
      var chartPayload = data && data.types && data.types.chart ? data.types.chart : null;
      if (chartPayload && Array.isArray(chartPayload.buckets) && Array.isArray(chartPayload.series)) {
        var buckets = chartPayload.buckets.slice();
        var seriesRows = chartPayload.series.slice()
          .filter(function(s) { return s && Array.isArray(s.sessions); })
          .slice(0, 5);
        if (!buckets.length || !seriesRows.length) {
          var enabledKeys = data && data.types && Array.isArray(data.types.enabled) ? data.types.enabled : [];
          var msg = enabledKeys && enabledKeys.length ? 'No type data available' : 'Open Settings (footer) → Traffic to choose device types.';
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">' + escapeHtml(msg) + '</div>';
          return;
        }
        // Normalize to the shortest series length.
        var len = buckets.length;
        seriesRows.forEach(function(s) { if (Array.isArray(s.sessions)) len = Math.min(len, s.sessions.length); });
        if (!Number.isFinite(len) || len < 2) {
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No type data available</div>';
          return;
        }
        buckets = buckets.slice(0, len);
        seriesRows = seriesRows.map(function(s) { return { ...s, sessions: (s.sessions || []).slice(0, len) }; });

        var bucketKind = chartPayload.bucket === 'hour' ? 'hour' : 'day';
        var categories = buckets.map(function(ts) { return bucketKind === 'hour' ? shortTimeLabel(ts) : shortDayLabel(ts); });
        var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
        var showEndLabels = rawMode === 'multi-line-labels';
        var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
        var palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e']);
        var colors = seriesRows.map(function(_s, i) { return palette[i % palette.length]; });

        // Split layout: plot + legend
        el.innerHTML = '<div class="kexo-series-split-chart">' +
          '<div class="kexo-series-split-plot" id="type-chart-plot"></div>' +
          '<div class="kexo-series-split-legend" id="type-chart-legend" aria-label="Top device types"></div>' +
          '</div>';
        var plotEl = document.getElementById('type-chart-plot');
        var legendEl = document.getElementById('type-chart-legend');
        if (!plotEl) return;

        if (legendEl) {
          legendEl.innerHTML = seriesRows.map(function(s, i) {
            var lbl = (s && (s.label || s.key)) ? String(s.label || s.key) : '—';
            var total = (s && typeof s.totalSessions === 'number') ? s.totalSessions : 0;
            if (!Number.isFinite(total)) total = 0;
            return '<div class="kexo-series-legend-item" title="' + escapeHtml(lbl) + '">' +
              '<span class="kexo-series-legend-dot" style="background:' + escapeHtml(colors[i] || '#4b94e4') + '"></span>' +
              '<div class="kexo-series-legend-meta">' +
                '<div class="kexo-series-legend-label">' + escapeHtml(lbl) + '</div>' +
                '<div class="kexo-series-legend-value">' + escapeHtml(Math.max(0, Math.trunc(total)).toLocaleString()) + '</div>' +
              '</div>' +
            '</div>';
          }).join('');
        }

        // Chart data: sessions only (series = type)
        var apexSeries = seriesRows.map(function(s, i) {
          var name = (s && (s.label || s.key)) ? String(s.label || s.key) : ('Series ' + String(i + 1));
          var nums = (s && Array.isArray(s.sessions)) ? s.sessions.map(function(v) { var n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0; }) : [];
          return { name: name, data: nums };
        });

        if (mode === 'pie') {
          function renderTypePie() {
            plotEl.innerHTML = '';
            try {
              typeChartInstance = new ApexCharts(plotEl, {
                chart: { type: 'pie', height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
                series: seriesRows.map(function(s) { return Number(s && s.totalSessions) || 0; }),
                labels: seriesRows.map(function(s) { return (s && (s.label || s.key)) ? String(s.label || s.key) : '—'; }),
                colors: colors,
                legend: { show: false },
                dataLabels: { enabled: true, formatter: function(pct) { return (typeof pct === 'number' && isFinite(pct)) ? (pct.toFixed(0) + '%') : ''; } },
                tooltip: { y: { formatter: function(v) { return Number(v || 0).toLocaleString(); } } },
              });
              typeChartInstance.render();
            } catch (err) {
              console.error('[type] chart render error:', err);
              plotEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
            }
          }
          if (typeof window.kexoWaitForContainerDimensions === 'function') {
            window.kexoWaitForContainerDimensions(plotEl, function() {
              requestAnimationFrame(renderTypePie);
            });
          } else { renderTypePie(); }
          return;
        }

        var chartType = normalizeChartType(mode, 'line');
        function renderTypeLineBar() {
          plotEl.innerHTML = '';
          try {
            typeChartInstance = new ApexCharts(plotEl, {
            chart: {
              type: chartType,
              height: 320,
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
              zoom: { enabled: false },
              animations: { enabled: true, easing: 'easeinout', speed: 350, dynamicAnimation: { enabled: true, speed: 350 } },
              stacked: chartType === 'bar',
            },
            series: apexSeries,
            colors: colors,
            stroke: chartType === 'bar' ? { width: 0 } : { width: 2.6, curve: 'smooth' },
            fill: chartType === 'area'
              ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.18, opacityTo: 0.05, stops: [0, 100] } }
              : { type: 'solid', opacity: chartType === 'line' ? 0 : 1 },
            plotOptions: chartType === 'bar' ? { bar: { horizontal: false, columnWidth: '62%', borderRadius: 3 } } : {},
            markers: { size: 0, hover: { size: 4 } },
            dataLabels: (showEndLabels && chartType === 'line') ? {
              enabled: true,
              formatter: function(val, ctx) {
                try {
                  var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                  var w = ctx && ctx.w ? ctx.w : null;
                  var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                  if (dp !== last) return '';
                } catch (_) { return ''; }
                return Number(val || 0).toLocaleString();
              },
              style: { fontSize: '10px' },
              background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
              offsetY: -3,
            } : { enabled: false },
            xaxis: {
              categories: categories,
              labels: { style: { fontSize: '11px' }, rotate: bucketKind === 'hour' ? -18 : 0, hideOverlappingLabels: true }
            },
            yaxis: {
              min: 0,
              forceNiceScale: true,
              labels: { style: { fontSize: '11px' }, formatter: function(v) { return Number(v || 0).toLocaleString(); } }
            },
            tooltip: {
              shared: true,
              intersect: false,
              y: { formatter: function(v) { return Number(v || 0).toLocaleString(); } },
            },
            legend: { show: false },
            grid: { borderColor: '#f1f1f1', strokeDashArray: 3 }
          });
          var renderPromise = typeChartInstance.render();
          if (renderPromise && typeof renderPromise.then === 'function') {
            renderPromise.catch(function(err) {
              try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'typeChartRender', page: PAGE }); } catch (_) {}
              console.error('[type] chart render error:', err);
              plotEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
            });
          }
        } catch (err) {
          console.error('[type] chart render error:', err);
          plotEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
        }
        if (typeof window.kexoWaitForContainerDimensions === 'function') {
          window.kexoWaitForContainerDimensions(plotEl, function() {
            requestAnimationFrame(renderTypeLineBar);
          });
        } else { renderTypeLineBar(); }
        return;
      }

      var rows = data && data.types && Array.isArray(data.types.rows) ? data.types.rows.slice() : [];
      rows = rows.filter(function(r) {
        return r && ((Number(r.sessions) || 0) > 0 || (Number(r.orders) || 0) > 0 || (Number(r.revenueGbp) || 0) > 0);
      });
      rows.sort(function(a, b) { return (Number(b && b.sessions) || 0) - (Number(a && a.sessions) || 0); });
      rows = rows.slice(0, 5);
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No type data available</div>';
        return;
      }
      var labels = rows.map(function(r) {
        var lbl = r && (r.label || r.key) ? String(r.label || r.key) : '—';
        return lbl.length > 22 ? lbl.slice(0, 19) + '...' : lbl;
      });
      var sessions = rows.map(function(r) { return Number((r && r.sessions) || 0); });
      var orders = rows.map(function(r) { return Number((r && r.orders) || 0); });
      var revenues = rows.map(function(r) { return Number((r && r.revenueGbp) || 0); });
      var series = [
        { name: 'Sessions', data: sessions },
        { name: 'Orders', data: orders },
        { name: 'Revenue', data: revenues }
      ];
      var valid = labels.length > 0 && series.every(function(s) {
        return s && Array.isArray(s.data) && s.data.length === labels.length && s.data.every(function(v) {
          return typeof v === 'number' && Number.isFinite(v);
        });
      });
      if (!valid) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:var(--tblr-secondary);font-size:.875rem">No type data available</div>';
        return;
      }

      var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      var showEndLabels = rawMode === 'multi-line-labels';
      var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      var palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab']);

      if (mode === 'pie') {
        var metric = chartPieMetricFromUiConfig(chartKey, 'sessions');
        var seriesArr = metric === 'revenue' ? revenues : (metric === 'orders' ? orders : sessions);
        var yFmt = function(v) {
          if (metric === 'revenue') return formatRevenue(Number(v)) || '—';
          return Number(v || 0).toLocaleString();
        };
        el.innerHTML = '';
        try {
          typeChartInstance = new ApexCharts(el, {
            chart: { type: 'pie', height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
            series: seriesArr,
            labels: labels,
            colors: palette,
            legend: { position: 'bottom', fontSize: '12px' },
            dataLabels: { enabled: true, formatter: function(pct) { return (typeof pct === 'number' && isFinite(pct)) ? (pct.toFixed(0) + '%') : ''; } },
            tooltip: { y: { formatter: yFmt } },
          });
          typeChartInstance.render();
        } catch (err) {
          console.error('[type] chart render error:', err);
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
        return;
      }

      var chartType = normalizeChartType(mode, 'line');
      el.innerHTML = '';
      try {
        typeChartInstance = new ApexCharts(el, {
          chart: { type: chartType, height: 320, fontFamily: 'Inter, sans-serif', toolbar: { show: false } },
          series: series,
          colors: palette,
          stroke: chartType === 'bar' ? { width: 0 } : { width: [3, 2.4, 2.4], curve: 'smooth' },
          fill: chartType === 'area'
            ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.22, opacityTo: 0.06, stops: [0, 100] } }
            : { type: 'solid', opacity: chartType === 'line' ? 0 : 1 },
          plotOptions: chartType === 'bar' ? { bar: { columnWidth: '56%', borderRadius: 3 } } : {},
          markers: { size: chartType === 'line' ? 3 : 0, hover: { size: 5 } },
          dataLabels: (showEndLabels && chartType === 'line') ? {
            enabled: true,
            formatter: function(val, ctx) {
              try {
                var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                var w = ctx && ctx.w ? ctx.w : null;
                var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                if (dp !== last) return '';
              } catch (_) { return ''; }
              var idx = ctx && ctx.seriesIndex != null ? Number(ctx.seriesIndex) : 0;
              if (idx === 2) return formatRevenue(Number(val)) || '—';
              return Number(val || 0).toLocaleString();
            },
            style: { fontSize: '10px' },
            background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
            offsetY: -3,
          } : { enabled: false },
          xaxis: {
            categories: labels,
            labels: { style: { fontSize: '11px' }, rotate: -12, hideOverlappingLabels: false }
          },
          yaxis: [
            {
              min: 0,
              forceNiceScale: true,
              labels: { style: { fontSize: '11px' }, formatter: function(v) { return Number(v || 0).toLocaleString(); } }
            },
            {
              min: 0,
              forceNiceScale: true,
              show: false,
              labels: { show: false },
            },
            {
              min: 0,
              opposite: true,
              forceNiceScale: true,
              labels: { style: { fontSize: '11px' }, formatter: function(v) { return formatRevenue(Number(v)) || '—'; } }
            }
          ],
          legend: { position: 'top', fontSize: '12px' },
          tooltip: {
            shared: true,
            intersect: false,
            y: {
              formatter: function(v, opts) {
                var idx = opts && opts.seriesIndex != null ? Number(opts.seriesIndex) : 0;
                if (idx === 2) return formatRevenue(Number(v)) || '—';
                return Number(v || 0).toLocaleString();
              }
            }
          },
          grid: { borderColor: '#f1f1f1', strokeDashArray: 3 }
        });
        var renderPromise = typeChartInstance.render();
        if (renderPromise && typeof renderPromise.then === 'function') {
          renderPromise.catch(function(err) {
            try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'typeChartRender', page: PAGE }); } catch (_) {}
            console.error('[type] chart render error:', err);
            el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
          });
        }
      } catch (err) {
        console.error('[type] chart render error:', err);
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    function renderTraffic(data) {
      trafficCache = data || trafficCache || null;
      renderTrafficTables(trafficCache);
      renderTrafficPickers(trafficCache);
      renderChannelsChart(trafficCache);
      renderTypeChart(trafficCache);
    }

    function fetchTrafficData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/traffic?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('Traffic HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          lastTrafficFetchedAt = Date.now();
          renderTraffic(data && typeof data === 'object' ? data : null);
          return data;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'trafficPrefsSave', page: PAGE }); } catch (_) {}
          console.error(err);
          renderTraffic(trafficCache || null);
          return null;
        });
    }

    function refreshTraffic(options = {}) {
      const force = !!options.force;
      if (trafficRefreshInFlight) return trafficRefreshInFlight;

      const isTypePage = PAGE === 'type';
      const trafficTitle = isTypePage ? 'Preparing traffic type report' : 'Preparing channels report';
      const build = startReportBuild({
        key: 'traffic',
        title: trafficTitle,
      });
      build.step(isTypePage ? 'Loading traffic type data' : 'Loading channel performance data');
      trafficRefreshInFlight = fetchTrafficData({ force })
        .then(function(data) {
          build.step('Analyzing traffic quality');
          return delay(180).then(function() {
            build.step('Building traffic table');
            return delay(120).then(function() {
              return delay(180).then(function() { return data; });
            });
          });
        })
        .finally(function() {
          trafficRefreshInFlight = null;
          build.finish();
        });
      return trafficRefreshInFlight;
    }

    function saveTrafficPrefs(payload) {
      if (!payload || typeof payload !== 'object') return Promise.resolve(null);
      return fetch(API + '/api/traffic-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload),
      })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) {
          if (!json || json.ok !== true) return null;
          // Re-fetch so tables match new enabled selections.
          refreshTraffic({ force: true });
          return json;
        })
        .catch(function(err) { console.error(err); return null; });
    }

    function sessionIdsEqual(a, b) {
      if (!a && !b) return true;
      if (!a || !b || a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i].session_id !== b[i].session_id) return false;
      return true;
    }

    function shortTimeLabel(tsMs) {
      var ts = Number(tsMs);
      if (!Number.isFinite(ts)) return '';
      try {
        return new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ts));
      } catch (_) {
        return '';
      }
    }

    function shortDayLabel(tsMs) {
      var ts = Number(tsMs);
      if (!Number.isFinite(ts)) return '';
      try {
        return new Intl.DateTimeFormat('en-GB', {
          day: '2-digit',
          month: 'short',
        }).format(new Date(ts));
      } catch (_) {
        return '';
      }
    }

    function shortDateTimeLabel(tsMs) {
      var ts = Number(tsMs);
      if (!Number.isFinite(ts)) return '';
      try {
        return new Intl.DateTimeFormat('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(ts));
      } catch (_) {
        return '';
      }
    }

    function setLiveOnlineMapState(el, text, opts) {
      if (!el) return;
      var message = String(text == null ? '' : text).trim() || 'Unavailable';
      var isError = !!(opts && opts.error);
      var color = isError ? '#ef4444' : 'var(--tblr-secondary)';
      if (isError) captureChartMessage(message, 'liveOnlineMapState', { chartKey: 'live-online-chart' }, 'error');
      el.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:220px;color:' + color + ';text-align:center;padding:0 18px;font-size:.875rem">' +
          escapeHtml(message) +
        '</div>';
    }

    function renderLiveOnlineMapChartFromSessions(sessionList) {
      var el = document.getElementById('live-online-chart');
      if (!el) return;
      var chartKey = 'live-online-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (liveOnlineChart) { try { liveOnlineChart.destroy(); } catch (_) {} liveOnlineChart = null; }
        liveOnlineChartType = '';
        if (liveOnlineMapChartInstance) { try { liveOnlineMapChartInstance.destroy(); } catch (_) {} liveOnlineMapChartInstance = null; }
        clearCountriesFlowOverlay(el);
        try { el.__kexoLiveOnlineMapSig = ''; } catch (_) {}
        el.innerHTML = '';
        return;
      }

      if (typeof jsVectorMap === 'undefined') {
        if (!el.__kexoJvmWaitTries) setLiveOnlineMapState(el, 'Loading map library...');
        // Avoid an unbounded retry loop if the CDN/map script is blocked (adblock/network).
        var tries = (el.__kexoJvmWaitTries || 0) + 1;
        el.__kexoJvmWaitTries = tries;
        if (tries >= 25) {
          el.__kexoJvmWaitTries = 0;
          setLiveOnlineMapState(el, 'Map library failed to load.', { error: true });
          return;
        }
        setTimeout(function() { renderLiveOnlineMapChartFromSessions(sessionList); }, 200);
        return;
      }
      try { el.__kexoJvmWaitTries = 0; } catch (_) {}

      // jsVectorMap snapshots container size at init; wait until the container is measurable.
      try {
        var rect = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null;
        if (!rect || !(rect.width > 20) || !(rect.height > 20)) {
          var sizeTries = (el.__kexoJvmSizeWaitTries || 0) + 1;
          el.__kexoJvmSizeWaitTries = sizeTries;
          if (sizeTries <= 60) setTimeout(function() { renderLiveOnlineMapChartFromSessions(sessionList); }, 220);
          else el.__kexoJvmSizeWaitTries = 0;
          return;
        }
        el.__kexoJvmSizeWaitTries = 0;
      } catch (_) {}

      var rawMode = chartModeFromUiConfig(chartKey, 'map-animated') || 'map-animated';
      rawMode = String(rawMode || '').trim().toLowerCase();
      var isAnimated = rawMode !== 'map-flat';

      var list = Array.isArray(sessionList) ? sessionList : (Array.isArray(sessions) ? sessions : []);
      var countsByIso2 = {};
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var iso = (s && s.country_code != null) ? String(s.country_code).trim().toUpperCase().slice(0, 2) : 'XX';
        if (!iso || iso === 'XX') continue;
        if (iso === 'UK') iso = 'GB';
        countsByIso2[iso] = (countsByIso2[iso] || 0) + 1;
      }
      var keys = Object.keys(countsByIso2);
      if (!keys.length) {
        if (liveOnlineMapChartInstance) { try { liveOnlineMapChartInstance.destroy(); } catch (_) {} liveOnlineMapChartInstance = null; }
        clearCountriesFlowOverlay(el);
        try { el.__kexoLiveOnlineMapSig = ''; } catch (_) {}
        setLiveOnlineMapState(el, 'No live activity yet');
        return;
      }

      var palette = chartColorsFromUiConfig(chartKey, ['#16a34a']);
      var accent = (palette && palette[0]) ? String(palette[0]).trim() : '#16a34a';

      var sigParts = [];
      for (var k = 0; k < keys.length; k++) {
        var code = keys[k];
        sigParts.push(code + ':' + String(countsByIso2[code] || 0));
      }
      sigParts.sort();
      var sig = rawMode + '|' + accent + '|' + sigParts.join('|');
      if (liveOnlineMapChartInstance && el.__kexoLiveOnlineMapSig === sig) {
        if (!isAnimated) clearCountriesFlowOverlay(el);
        return;
      }
      try { el.__kexoLiveOnlineMapSig = sig; } catch (_) {}

      // Switching chart types: clear Apex instance.
      if (liveOnlineChart) { try { liveOnlineChart.destroy(); } catch (_) {} liveOnlineChart = null; }
      liveOnlineChartType = '';

      if (liveOnlineMapChartInstance) {
        try { liveOnlineMapChartInstance.destroy(); } catch (_) {}
        liveOnlineMapChartInstance = null;
      }
      clearCountriesFlowOverlay(el);
      el.innerHTML = '';

      try {
        var rootCss = getComputedStyle(document.documentElement);
        var border = (rootCss.getPropertyValue('--tblr-border-color') || '#d4dee5').trim();
        var muted = (rootCss.getPropertyValue('--tblr-secondary') || '#626976').trim();

        function rgbFromColor(c) {
          var s = String(c || '').trim();
          var m = /^#([0-9a-f]{6})$/i.exec(s);
          if (m) {
            var hex = m[1];
            var r = parseInt(hex.slice(0, 2), 16);
            var g = parseInt(hex.slice(2, 4), 16);
            var b = parseInt(hex.slice(4, 6), 16);
            return { r: r, g: g, b: b, rgb: r + ',' + g + ',' + b };
          }
          m = /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})/i.exec(s);
          if (m) {
            var rr = Math.max(0, Math.min(255, parseInt(m[1], 10) || 0));
            var gg = Math.max(0, Math.min(255, parseInt(m[2], 10) || 0));
            var bb = Math.max(0, Math.min(255, parseInt(m[3], 10) || 0));
            return { r: rr, g: gg, b: bb, rgb: rr + ',' + gg + ',' + bb };
          }
          return { r: 22, g: 163, b: 74, rgb: '22,163,74' };
        }
        var rgb = rgbFromColor(accent);
        var primaryRgb = rgb.rgb;
        var regionFillByIso2 = buildMapFillScaleByIso(countsByIso2, primaryRgb, 0.24, 0.92);

        liveOnlineMapChartInstance = new jsVectorMap({
          selector: '#live-online-chart',
          map: 'world',
          backgroundColor: 'transparent',
          zoomButtons: false,
          zoomOnScroll: false,
          zoomAnimate: false,
          regionStyle: {
            initial: { fill: 'rgba(' + primaryRgb + ',0.18)', stroke: border, strokeWidth: 0.7 },
            hover: { fill: 'rgba(' + primaryRgb + ',0.46)' },
            selected: { fill: 'rgba(' + primaryRgb + ',0.78)' },
          },
          series: {
            regions: [
              {
                attribute: 'fill',
                values: regionFillByIso2,
                scale: ['rgba(' + primaryRgb + ',0.24)', 'rgba(' + primaryRgb + ',0.92)'],
                normalizeFunction: 'linear',
              }
            ]
          },
          onRegionTooltipShow: function(tooltip, code2) {
            var iso2 = (code2 || '').toString().trim().toUpperCase();
            var name = (liveOnlineMapChartInstance && typeof liveOnlineMapChartInstance.getRegionName === 'function')
              ? (liveOnlineMapChartInstance.getRegionName(iso2) || iso2)
              : iso2;
            var n = countsByIso2[iso2] || 0;
            if (!n) {
              setVectorMapTooltipContent(
                tooltip,
                '<div style="min-width:140px;font-weight:600">' + escapeHtml(name) + '</div>',
                name
              );
              return;
            }
            var sessionsText = formatSessions(n);
            setVectorMapTooltipContent(
              tooltip,
              '<div style="min-width:180px">' +
                '<div style="font-weight:600;margin-bottom:2px">' + escapeHtml(name) + '</div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Sessions (last 5m): <span style="color:inherit">' + escapeHtml(sessionsText) + '</span></div>' +
              '</div>',
              name + ' | Sessions (last 5m): ' + sessionsText
            );
          }
        });

        if (isAnimated) {
          setTimeout(function () {
            try {
              var pseudo = keys.map(function (iso2) { return { country_code: iso2, converted: countsByIso2[iso2] || 0 }; });
              pseudo.sort(function (a, b) { return Number(b && b.converted) - Number(a && a.converted); });
              var originIso = pseudo && pseudo[0] && pseudo[0].country_code ? String(pseudo[0].country_code) : 'GB';
              renderCountriesFlowOverlay(el, pseudo, primaryRgb, originIso);
            } catch (_) {}
          }, 120);
        }
      } catch (err) {
        captureChartError(err, 'liveOnlineMapRender', { chartKey: 'live-online-chart' });
        console.error('[live-online-map] render error:', err);
        setLiveOnlineMapState(el, 'Map rendering failed.', { error: true });
      }
    }

    function renderLiveOnlineTrendChart(payload) {
      var el = document.getElementById('live-online-chart');
      if (!el) return;
      if (typeof ApexCharts === 'undefined') {
        // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
        const tries = (el.__kexoApexWaitTries || 0) + 1;
        el.__kexoApexWaitTries = tries;
        if (tries >= 25) {
          el.__kexoApexWaitTries = 0;
          captureChartMessage('Chart library failed to load.', 'liveOnlineTrendLibraryLoad', { chartKey: 'live-online-chart', tries: tries }, 'error');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:220px;color:var(--tblr-secondary);text-align:center;padding:0 18px;font-size:.875rem">Chart library failed to load.</div>';
          return;
        }
        setTimeout(function() { renderLiveOnlineTrendChart(payload); }, 180);
        return;
      }
      try { el.__kexoApexWaitTries = 0; } catch (_) {}
      var chartKey = 'live-online-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (liveOnlineChart) { try { liveOnlineChart.destroy(); } catch (_) {} liveOnlineChart = null; }
        liveOnlineChartType = '';
        if (liveOnlineMapChartInstance) { try { liveOnlineMapChartInstance.destroy(); } catch (_) {} liveOnlineMapChartInstance = null; }
        clearCountriesFlowOverlay(el);
        try { el.__kexoLiveOnlineMapSig = ''; } catch (_) {}
        el.innerHTML = '';
        return;
      }
      var allPoints = payload && Array.isArray(payload.points) ? payload.points.slice() : [];
      var viewport = 0;
      try {
        viewport = Math.max(window.innerWidth || 0, document.documentElement ? (document.documentElement.clientWidth || 0) : 0);
      } catch (_) {
        viewport = 0;
      }
      var compactMode = viewport > 0 && viewport <= 960;
      var points = compactMode && allPoints.length > 6 ? allPoints.slice(-6) : allPoints;
      if (!points.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:220px;color:var(--tblr-secondary);font-size:.875rem">No live activity yet</div>';
        return;
      }
      var labels = points.map(function(p) { return shortTimeLabel(p && p.ts); });
      var values = points.map(function(p) {
        var n = p && p.online != null ? Number(p.online) : NaN;
        return Number.isFinite(n) ? n : 0;
      });
      var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      var showEndLabels = rawMode === 'multi-line-labels';
      var chartType = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      chartType = normalizeChartType(chartType, 'line');
      var palette = chartColorsFromUiConfig(chartKey, ['#16a34a']);
      var apexSeries = [{ name: 'Online now', data: values }];

      // Smooth updates: keep the chart instance and update series/options.
      if (liveOnlineChart && liveOnlineChartType === chartType) {
        try {
          var updateOpts = {
            colors: palette,
            xaxis: {
              categories: labels,
              tickPlacement: 'between',
              labels: { style: { fontSize: '11px' } },
            },
          };
          if (chartType === 'bar') {
            updateOpts.stroke = { show: false };
            updateOpts.dataLabels = { enabled: false };
            updateOpts.fill = { type: 'solid', opacity: 1 };
            updateOpts.plotOptions = { bar: { horizontal: false, columnWidth: points.length > 8 ? '58%' : '50%', borderRadius: 3 } };
            updateOpts.markers = { size: 0 };
          } else {
            updateOpts.stroke = { curve: 'smooth', width: 3 };
            updateOpts.fill = chartType === 'area'
              ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } }
              : { type: 'solid', opacity: 0 };
            updateOpts.plotOptions = {};
            updateOpts.markers = { size: chartType === 'line' ? 3 : 0, hover: { size: 5 } };
            updateOpts.dataLabels = (showEndLabels && chartType === 'line') ? {
              enabled: true,
              formatter: function(val, ctx) {
                try {
                  var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                  var w = ctx && ctx.w ? ctx.w : null;
                  var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                  if (dp !== last) return '';
                } catch (_) { return ''; }
                return Number(val || 0).toLocaleString();
              },
              style: { fontSize: '10px' },
              background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
              offsetY: -3,
            } : { enabled: false };
          }
          liveOnlineChart.updateOptions(updateOpts, false, true);
          liveOnlineChart.updateSeries(apexSeries, true);
          return;
        } catch (_) {
          try { liveOnlineChart.destroy(); } catch (_) {}
          liveOnlineChart = null;
          liveOnlineChartType = '';
        }
      }

      if (liveOnlineChart) {
        try { liveOnlineChart.destroy(); } catch (_) {}
        liveOnlineChart = null;
        liveOnlineChartType = '';
      }
      el.innerHTML = '';

      var apexOpts = {
        chart: {
          type: chartType,
          height: 220,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false },
          zoom: { enabled: false },
          animations: {
            enabled: true,
            easing: 'easeinout',
            speed: 450,
            animateGradually: { enabled: true, delay: 80 },
            dynamicAnimation: { enabled: true, speed: 450 },
          },
        },
        series: apexSeries,
        xaxis: {
          categories: labels,
          tickPlacement: 'between',
          labels: { style: { fontSize: '11px' } },
        },
        yaxis: {
          min: 0,
          forceNiceScale: true,
          tickAmount: 5,
          labels: { style: { fontSize: '11px' } },
        },
        colors: palette,
        tooltip: {
          y: { formatter: function(v) { return Number(v || 0).toLocaleString() + ' online'; } },
        },
        grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
      };

      if (chartType === 'bar') {
        apexOpts.stroke = { show: false };
        apexOpts.dataLabels = { enabled: false };
        apexOpts.fill = { type: 'solid', opacity: 1 };
        apexOpts.plotOptions = { bar: { horizontal: false, columnWidth: points.length > 8 ? '58%' : '50%', borderRadius: 3 } };
        apexOpts.markers = { size: 0 };
      } else {
        apexOpts.stroke = { curve: 'smooth', width: 3 };
        apexOpts.fill = chartType === 'area'
          ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } }
          : { type: 'solid', opacity: 0 };
        apexOpts.plotOptions = {};
        apexOpts.markers = { size: chartType === 'line' ? 3 : 0, hover: { size: 5 } };
        apexOpts.dataLabels = (showEndLabels && chartType === 'line') ? {
          enabled: true,
          formatter: function(val, ctx) {
            try {
              var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
              var w = ctx && ctx.w ? ctx.w : null;
              var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
              if (dp !== last) return '';
            } catch (_) { return ''; }
            return Number(val || 0).toLocaleString();
          },
          style: { fontSize: '10px' },
          background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
          offsetY: -3,
        } : { enabled: false };
      }

      liveOnlineChartType = chartType;
      liveOnlineChart = new ApexCharts(el, apexOpts);
      liveOnlineChart.render();
    }

    function refreshLiveOnlineChart(options) {
      var chartKey = 'live-online-chart';
      var rawMode = chartModeFromUiConfig(chartKey, 'map-animated') || 'map-animated';
      rawMode = String(rawMode || '').trim().toLowerCase();
      if (rawMode.indexOf('map-') === 0) {
        try { renderLiveOnlineMapChartFromSessions(Array.isArray(sessions) ? sessions : []); } catch (_) {}
        return Promise.resolve(null);
      }

      // Switching away from map: clean up jsVectorMap instance + overlay.
      var el = document.getElementById('live-online-chart');
      if (liveOnlineMapChartInstance) { try { liveOnlineMapChartInstance.destroy(); } catch (_) {} liveOnlineMapChartInstance = null; }
      if (el) {
        clearCountriesFlowOverlay(el);
        try { el.__kexoLiveOnlineMapSig = ''; } catch (_) {}
      }
      return refreshLiveOnlineTrendChart(options || {});
    }

    function refreshLiveOnlineTrendChart(options) {
      var el = document.getElementById('live-online-chart');
      if (!el) return Promise.resolve(null);
      options = options || {};
      var force = !!options.force;
      var ttlMs = 30 * 1000;
      if (!force && liveOnlineChartFetchedAt && (Date.now() - liveOnlineChartFetchedAt) < ttlMs) {
        return Promise.resolve(null);
      }
      if (liveOnlineChartInFlight) return liveOnlineChartInFlight;
      var url = API + '/api/sessions/online-series?minutes=5&stepMinutes=1' + (force ? ('&_=' + Date.now()) : '');
      liveOnlineChartInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 15000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          liveOnlineChartFetchedAt = Date.now();
          renderLiveOnlineTrendChart(data || null);
          return data;
        })
        .catch(function() { return null; })
        .finally(function() { liveOnlineChartInFlight = null; });
      return liveOnlineChartInFlight;
    }

    function renderSessionsOverviewChart(payload, rangeKey) {
      var el = document.getElementById('sessions-overview-chart');
      if (!el) return;
      if (typeof ApexCharts === 'undefined') {
        // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
        const tries = (el.__kexoApexWaitTries || 0) + 1;
        el.__kexoApexWaitTries = tries;
        if (tries >= 25) {
          el.__kexoApexWaitTries = 0;
          captureChartMessage('Chart library failed to load.', 'sessionsOverviewLibraryLoad', { chartKey: (PAGE === 'sales' ? 'sales-overview-chart' : 'date-overview-chart'), tries: tries }, 'error');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:220px;color:var(--tblr-secondary);text-align:center;padding:0 18px;font-size:.875rem">Chart library failed to load.</div>';
          return;
        }
        setTimeout(function() { renderSessionsOverviewChart(payload, rangeKey); }, 180);
        return;
      }
      try { el.__kexoApexWaitTries = 0; } catch (_) {}
      var chartKey = PAGE === 'sales' ? 'sales-overview-chart' : 'date-overview-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (rangeOverviewChart) { try { rangeOverviewChart.destroy(); } catch (_) {} rangeOverviewChart = null; }
        el.innerHTML = '';
        var lbl = document.getElementById('sessions-overview-bucket-label');
        if (lbl) { lbl.textContent = ''; lbl.setAttribute('aria-hidden', 'true'); }
        return;
      }
      var rows = payload && Array.isArray(payload.series) ? payload.series.slice() : [];
      if (rangeOverviewChart) {
        try { rangeOverviewChart.destroy(); } catch (_) {}
        rangeOverviewChart = null;
      }
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:220px;color:var(--tblr-secondary);font-size:.875rem">No data for this range</div>';
        var lbl2 = document.getElementById('sessions-overview-bucket-label');
        if (lbl2) { lbl2.textContent = ''; lbl2.setAttribute('aria-hidden', 'true'); }
        return;
      }

      var bucket = payload && payload.bucket ? String(payload.bucket) : 'day';
      var labels = rows.map(function(row) {
        var ts = row && row.ts != null ? Number(row.ts) : NaN;
        if (!Number.isFinite(ts)) return '';
        return bucket === 'hour' ? shortTimeLabel(ts) : shortDateTimeLabel(ts);
      });

      var chartCfg;
      if (PAGE === 'sales') {
        chartCfg = {
          series: [{ name: 'Revenue', data: rows.map(function(r) { return Number(r && r.revenue) || 0; }) }],
          colors: ['#0d9488'],
          yFormatter: function(v) { return formatRevenue(Number(v)) || '—'; },
          tooltipFormatter: function(v) { return formatRevenue(Number(v)) || '—'; },
        };
      } else {
        chartCfg = {
          series: [
            { name: 'Sessions', data: rows.map(function(r) { return Number(r && r.sessions) || 0; }) },
            { name: 'Orders', data: rows.map(function(r) { return Number(r && r.orders) || 0; }) },
          ],
          colors: ['#4b94e4', '#f59e34'],
          yFormatter: function(v) { return Number(v || 0).toLocaleString(); },
          tooltipFormatter: function(v) { return Number(v || 0).toLocaleString(); },
        };
      }
      // Apply chart mode + palette overrides from global Charts settings.
      var rawMode = chartModeFromUiConfig(chartKey, 'area') || 'area';
      var showEndLabels = rawMode === 'multi-line-labels';
      var overviewType = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      overviewType = normalizeChartType(overviewType, 'area');
      chartCfg.colors = chartColorsFromUiConfig(chartKey, chartCfg.colors);
      el.innerHTML = '';
      rangeOverviewChart = new ApexCharts(el, {
        chart: {
          type: overviewType,
          height: 220,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false },
          zoom: { enabled: false },
        },
        series: chartCfg.series,
        colors: chartCfg.colors,
        stroke: { curve: 'smooth', width: overviewType === 'bar' ? 0 : 2 },
        fill: overviewType === 'area'
          ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } }
          : { type: 'solid', opacity: overviewType === 'line' ? 0 : 1 },
        plotOptions: overviewType === 'bar' ? { bar: { columnWidth: '56%', borderRadius: 3 } } : {},
        markers: { size: overviewType === 'line' ? 3 : 0, hover: { size: 5 } },
        dataLabels: (showEndLabels && overviewType === 'line') ? {
          enabled: true,
          formatter: function(val, ctx) {
            try {
              var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
              var w = ctx && ctx.w ? ctx.w : null;
              var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
              if (dp !== last) return '';
            } catch (_) { return ''; }
            try { return chartCfg.tooltipFormatter(val); } catch (_) { return String(val); }
          },
          style: { fontSize: '10px' },
          background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
          offsetY: -3,
        } : { enabled: false },
        xaxis: { categories: labels, labels: { style: { fontSize: '11px' } } },
        yaxis: { min: 0, labels: { style: { fontSize: '11px' }, formatter: chartCfg.yFormatter } },
        tooltip: { y: { formatter: chartCfg.tooltipFormatter } },
        grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
      });
      rangeOverviewChart.render();
      rangeOverviewChartKey = String(rangeKey || '');
      var labelEl = document.getElementById('sessions-overview-bucket-label');
      if (labelEl && PAGE === 'sales') {
        var bucketLabel = bucket === 'hour' ? 'By hour' : bucket === 'month' ? 'By month' : 'By day';
        labelEl.textContent = bucketLabel;
        labelEl.removeAttribute('aria-hidden');
      } else if (labelEl) {
        labelEl.textContent = '';
        labelEl.setAttribute('aria-hidden', 'true');
      }
    }

    function refreshSessionsOverviewChart(options) {
      var el = document.getElementById('sessions-overview-chart');
      if (!el) return Promise.resolve(null);
      options = options || {};
      var force = !!options.force;
      var rangeKey = getStatsRange();
      var cacheKey = (PAGE || 'page') + '|' + rangeKey;
      if (!force && rangeOverviewChart && rangeOverviewChartKey === cacheKey) return Promise.resolve(null);
      if (rangeOverviewChartInFlight) return rangeOverviewChartInFlight;
      var url = API + '/api/dashboard-series?range=' + encodeURIComponent(rangeKey) + (force ? ('&force=1&_=' + Date.now()) : '');
      rangeOverviewChartInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 20000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          renderSessionsOverviewChart(data || null, cacheKey);
          return data;
        })
        .catch(function() { return null; })
        .finally(function() { rangeOverviewChartInFlight = null; });
      return rangeOverviewChartInFlight;
    }

    function refreshSessionPageCharts(options) {
      if (document.getElementById('live-online-chart')) return refreshLiveOnlineChart(options || {});
      if (document.getElementById('sessions-overview-chart')) return refreshSessionsOverviewChart(options || {});
      return Promise.resolve(null);
    }

    function fetchSessions() {
      if (liveRefreshInFlight) return liveRefreshInFlight;
      var isLive = dateRange === 'live';
      var build = startReportBuild({
        key: 'sessions',
        overlayId: 'sessions-loading-overlay',
        title: isLive ? 'Preparing live sessions' : 'Preparing sessions table',
      });
      build.step(isLive ? 'Loading active visitors' : 'Loading selected date range');
      var url;
      if (isLive) {
        url = API + '/api/sessions?filter=active&_=' + Date.now();
      } else {
        var limit = rowsPerPage;
        var offset = (currentPage - 1) * rowsPerPage;
        url = API + '/api/sessions?range=' + encodeURIComponent(normalizeRangeKeyForApi(dateRange)) + '&limit=' + limit + '&offset=' + offset + '&timezone=' + encodeURIComponent(tz) + '&_=' + Date.now();
      }
      if (_fetchAbortControllers.sessions) { try { _fetchAbortControllers.sessions.abort(); } catch (_) {} }
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      _fetchAbortControllers.sessions = ac;
      liveRefreshInFlight = fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: ac ? ac.signal : undefined })
        .then(function(r) {
          if (!r.ok) {
            build.step('Could not load sessions');
            sessionsLoadError = r.status === 502 ? 'Server error (502). Try again or refresh.' : 'Server error (' + r.status + ').';
            sessions = [];
            sessionsTotal = null;
            renderTable();
            return null;
          }
          return r.json();
        })
        .then(function(data) {
          if (data == null) return null;
          sessionsLoadError = null;
          build.step('Analyzing session activity');
          if (isLive) {
            sessionsTotal = null;
            var next = data.sessions || [];
            var cutoff = Date.now() - ACTIVE_WINDOW_MS;
            var arrivedCutoff = Date.now() - ARRIVED_WINDOW_MS;
            next = next.filter(function(s) {
              return (s.last_seen != null && s.last_seen >= cutoff) &&
                (s.started_at != null && s.started_at >= arrivedCutoff);
            });
            next.sort(function(a, b) { return (b.last_seen || 0) - (a.last_seen || 0); });
            var listChanged = !sessionIdsEqual(sessions, next);
            sessions = next;
            if (listChanged) currentPage = 1;
          } else {
            sessions = data.sessions || [];
            sessionsTotal = typeof data.total === 'number' ? data.total : sessions.length;
          }
          lastSessionsMode = isLive ? 'live' : 'range';
          lastSessionsFetchedAt = Date.now();
          if (isLive) nextLiveAt = Date.now() + LIVE_REFRESH_MS;
          else if (dateRange === 'today' || dateRange === 'sales' || dateRange === '1h') nextRangeAt = Date.now() + RANGE_REFRESH_MS;
          lastUpdateTime = new Date();
          updateServerTimeDisplay();
          build.step('Building sessions table');
          renderTable();
          updateKpis();
          try { refreshSessionPageCharts({ force: isLive }); } catch (_) {}
          return sessions;
        })
        .catch(function(err) {
          if (err && err.name === 'AbortError') return null;
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'sessionsFetch', page: PAGE }); } catch (_) {}
          build.step('Could not load sessions');
          sessionsLoadError = 'Could not load sessions. Check connection or refresh.';
          sessions = [];
          sessionsTotal = null;
          currentPage = 1;
          renderTable();
          return null;
        })
        .finally(function() {
          liveRefreshInFlight = null;
          if (_fetchAbortControllers.sessions === ac) _fetchAbortControllers.sessions = null;
          build.finish();
        });
      return liveRefreshInFlight;
    }

    function fetchOnlineCount() {
      if (onlineCountInFlight) return;
      onlineCountInFlight = true;
      if (_fetchAbortControllers.onlineCount) { try { _fetchAbortControllers.onlineCount.abort(); } catch (_) {} }
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      _fetchAbortControllers.onlineCount = ac;
      fetch(API + '/api/sessions?filter=active&countOnly=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', signal: ac ? ac.signal : undefined })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (data != null && typeof data.count === 'number') {
            lastOnlineCount = data.count;
          }
        })
        .catch(function() {})
        .then(function() {
          onlineCountInFlight = false;
          if (_fetchAbortControllers.onlineCount === ac) _fetchAbortControllers.onlineCount = null;
          updateKpis();
        });
    }

    function updateKpis() {
      const el = document.getElementById('online-count');
      const spinner = document.getElementById('online-count-spinner');
      const iconEl = document.getElementById('kexo-online-icon');
      const liveNowCountEl = document.getElementById('live-online-now-count');
      if (!el && !liveNowCountEl) return;
      function showLiveNowCount(n) {
        if (!liveNowCountEl) return;
        var safe = Number.isFinite(Number(n)) ? Math.max(0, Math.trunc(Number(n))) : 0;
        liveNowCountEl.textContent = String(safe);
      }
      function showSpinner() {
        if (spinner) { spinner.classList.remove('is-hidden'); }
        if (el) el.classList.add('is-hidden');
        if (iconEl) { iconEl.classList.add('kexo-online-icon--offline'); iconEl.classList.remove('kexo-online-icon--online'); }
      }
      function showCount(n) {
        if (spinner) { spinner.classList.add('is-hidden'); }
        if (el) {
          el.classList.remove('is-hidden');
          el.textContent = String(n);
        }
        if (iconEl) {
          iconEl.classList.remove('kexo-online-icon--offline', 'kexo-online-icon--online');
          iconEl.classList.add(n > 0 ? 'kexo-online-icon--online' : 'kexo-online-icon--offline');
        }
        showLiveNowCount(n);
      }
      if (activeMainTab === 'spy' && dateRange === 'live') {
        if (lastSessionsMode !== 'live') {
          showSpinner();
          fetchSessions();
          return;
        }
        const active = sessions.filter(s => s.last_seen >= Date.now() - ACTIVE_WINDOW_MS).length;
        showCount(active);
        return;
      }
      // Online is real people online right now; show count regardless of date range (Today, Yesterday, etc.)
      if (lastOnlineCount != null) {
        showCount(lastOnlineCount);
      } else {
        showSpinner();
        fetchOnlineCount();
      }
    }

    function cfSection(title, value) {
      const v = value != null && String(value).trim() !== '' ? String(value).trim() : null;
      const cls = v ? 'cf-row' : 'cf-row empty';
      return '<div class="' + cls + '"><strong>' + escapeHtml(title) + ':</strong> ' + (v ? escapeHtml(v) : '\u2014') + '</div>';
    }

    function buildSidePanelCf(session) {
      const s = session || {};
      const blocks = [
        ['Country & Device', cfSection('Country', s.cf_country || s.country_code) + cfSection('Device', s.device)],
        ['Referrer / Entry', cfSection('Referrer', s.referrer) + cfSection('Entry URL', s.entry_url)],
        ['Colo / ASN', cfSection('Colo', s.cf_colo) + cfSection('ASN', s.cf_asn)],
        ['Bot', cfSection('Known bot', s.cf_known_bot != null ? (s.cf_known_bot === 1 ? 'Yes' : 'No') : null) + cfSection('Verified bot category', s.cf_verified_bot_category)],
        ['City', cfSection('City', null)]
      ];
      return blocks.map(function (b) { return '<div class="side-panel-cf-block"><div class="side-panel-cf-subtitle">' + escapeHtml(b[0]) + '</div>' + b[1] + '</div>'; }).join('');
    }

    function ensureSidePanelBackdrop() {
      var panel = document.getElementById('side-panel');
      if (!panel) return null;
      var backdrop = document.getElementById('side-panel-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'side-panel-backdrop';
        backdrop.className = 'side-panel-backdrop is-hidden';
        document.body.appendChild(backdrop);
      }
      if (!backdrop.dataset.bound) {
        backdrop.addEventListener('click', function () { closeSidePanel(); });
        backdrop.dataset.bound = '1';
      }
      return backdrop;
    }

    function closeSidePanel() {
      var panel = document.getElementById('side-panel');
      if (panel) panel.classList.add('is-hidden');
      var backdrop = document.getElementById('side-panel-backdrop');
      if (backdrop) backdrop.classList.add('is-hidden');
      document.body.classList.remove('side-panel-open');
    }

    function openSidePanel(sessionId) {
      const panel = document.getElementById('side-panel');
      if (!panel) return;
      const backdrop = ensureSidePanelBackdrop();
      panel.classList.remove('is-hidden');
      if (backdrop) backdrop.classList.remove('is-hidden');
      document.body.classList.add('side-panel-open');
      document.getElementById('side-events').innerHTML = '<li class="muted">Loading\u2026</li>';
      document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Loading\u2026</span></div>';
      const sideSourceEl = document.getElementById('side-source');
      if (sideSourceEl) sideSourceEl.textContent = '';
      document.getElementById('side-cf').innerHTML = '';
      fetch(API + '/api/sessions/' + encodeURIComponent(sessionId) + '/events?limit=20')
        .then(r => r.json())
        .then(data => {
          const session = sessions.find(s => s.session_id === sessionId) || {};
          const saleBlock = session.has_purchased
            ? '<div class="side-panel-sale"><strong>Sale</strong><br>Order: ' + escapeHtml(formatMoney(session.order_total, session.order_currency) || '\u2014') + (session.purchased_at ? '<br>Purchased: ' + formatTs(session.purchased_at) : '') + '</div>'
            : '';
          const mainBase = getMainBaseUrl();
          const eventList = (data.events || []).filter(e => e.type !== 'heartbeat').reverse();
          const eventsHtml = eventList.map(e => {
            var path = (e.path || '').trim();
            if (!path && e.product_handle) path = '/products/' + (e.product_handle || '');
            if (path && !path.startsWith('/')) path = '/' + path;
            var pathLabel = path ? (friendlyLabelFromPath(path) || path) : (e.product_handle || '');
            var fullUrl = mainBase && path ? mainBase + path : '';
            var thumb = fullUrl ? '<img class="landing-thumb" src="' + (API || '') + '/api/og-thumb?url=' + encodeURIComponent(fullUrl) + '&width=100' + '" alt="" onerror="this.classList.add(\'is-hidden\')">' : '';
            var text = formatTs(e.ts) + ' ' + escapeHtml(e.type) + ' ' + escapeHtml(pathLabel) + (e.qty_delta != null ? ' \u0394' + e.qty_delta : '');
            return '<li>' + thumb + '<span>' + text + '</span></li>';
          }).join('');
          document.getElementById('side-events').innerHTML = eventsHtml || '<li class="muted">No events</li>';
          const metaRows = [
            ['Session', sessionId],
            ['Visitor', session.visitor_id || '\u2014'],
            ['Started', formatTs(session.started_at)],
            ['Seen', formatTs(session.last_seen)],
            ['Cart qty', String(session.cart_qty ?? 0)]
          ].map(function (r) { return '<div class="side-panel-detail-row"><span class="side-panel-label">' + escapeHtml(r[0]) + '</span><span class="side-panel-value">' + escapeHtml(String(r[1])) + '</span></div>'; }).join('');
          var startedMs = session.started_at != null ? Number(session.started_at) : 0;
          var seenMs = session.last_seen != null ? Number(session.last_seen) : 0;
          var gapHours = (seenMs - startedMs) / (60 * 60 * 1000);
          var openTabHint = (gapHours >= 1) ? '<div class="side-panel-detail-row muted side-panel-hint">If Started and Seen are many hours apart, the visitor likely left the tab open; we receive a heartbeat every 30s which updates Seen.</div>' : '';
          document.getElementById('side-meta').innerHTML = metaRows + openTabHint + (saleBlock ? saleBlock : '');
          if (sideSourceEl) sideSourceEl.textContent = sourceDetailForPanel(session);
          document.getElementById('side-cf').innerHTML = buildSidePanelCf(session);
        })
        .catch(() => {
          document.getElementById('side-events').innerHTML = '<li class="muted">Failed to load.</li>';
          document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Failed to load.</span></div>';
        });
    }

    const sideCloseBtn = document.getElementById('side-close');
    if (sideCloseBtn) sideCloseBtn.addEventListener('click', closeSidePanel);
    document.addEventListener('keydown', function (e) {
      if (!e || e.key !== 'Escape') return;
      var panel = document.getElementById('side-panel');
      if (panel && !panel.classList.contains('is-hidden')) closeSidePanel();
    });

    // Session table pagination (live/sales/date) — delegated
    (function initSessionTablePagination() {
      var wrap = document.getElementById('table-pagination');
      if (!wrap) return;
      wrap.addEventListener('click', function(e) {
        var link = e.target.closest('a[data-page]');
        if (!link) return;
        e.preventDefault();
        if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
        var pg = parseInt(link.dataset.page, 10);
        if (!pg || pg < 1) return;
        currentPage = pg;
        if (sessionsTotal != null) fetchSessions(); else renderTable();
      });
    })();

    setupSortableHeaders();
    setupBestSellersSort();
    setupAllTableSorts();

    // Card-table pagination — event delegation on containers
    (function initTopTablePagination() {
      function bindDelegate(prefix, goToPage) {
        var wrap = document.getElementById(prefix + '-pagination');
        if (!wrap) return;
        wrap.addEventListener('click', function(e) {
          var link = e.target.closest('a[data-page]');
          if (!link) return;
          e.preventDefault();
          if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
          var pg = parseInt(link.dataset.page, 10);
          if (!pg || pg < 1) return;
          goToPage(pg);
        });
      }
      bindDelegate('country', function(pg) { countryPage = pg; renderCountry(statsCache); });
      bindDelegate('best-geo-products', function(pg) { bestGeoProductsPage = pg; renderBestGeoProducts(statsCache); });
      bindDelegate('best-sellers', function(pg) { bestSellersPage = pg; fetchBestSellers(); });
      bindDelegate('best-variants', function(pg) { bestVariantsPage = pg; fetchBestVariants(); });
      bindDelegate('traffic-sources', function(pg) { trafficSourcesPage = pg; renderTrafficTables(trafficCache || {}); });
      bindDelegate('traffic-types', function(pg) { trafficTypesPage = pg; renderTrafficTables(trafficCache || {}); });
      bindDelegate('dash-top-products', function(pg) { dashTopProductsPage = pg; rerenderDashboardFromCache(); });
      bindDelegate('dash-top-countries', function(pg) { dashTopCountriesPage = pg; rerenderDashboardFromCache(); });
      bindDelegate('dash-trending-up', function(pg) { dashTrendingUpPage = pg; rerenderDashboardFromCache(); });
      bindDelegate('dash-trending-down', function(pg) { dashTrendingDownPage = pg; rerenderDashboardFromCache(); });
      bindDelegate('breakdown-aov', function(pg) { breakdownAovPage = pg; renderAov(statsCache); });
      bindDelegate('breakdown-title', function(pg) { breakdownTitlePage = pg; renderBreakdownTitles(leaderboardCache); });
      bindDelegate('breakdown-finish', function(pg) { breakdownFinishPage = pg; renderBreakdownFinishes(finishesCache); });
      bindDelegate('breakdown-length', function(pg) { breakdownLengthPage = pg; renderBreakdownLengths(lengthsCache); });
      bindDelegate('breakdown-chainstyle', function(pg) { breakdownChainStylePage = pg; renderBreakdownChainStyles(chainStylesCache); });
    })();

    (function initRowsPerPageSelect() {
      // Rows-per-page UI is intentionally hidden; keep page size fixed at default.
      const sel = document.getElementById('rows-per-page-select');
      if (sel) sel.value = String(rowsPerPage);
    })();

    function getConfigStatusUrl(options = {}) {
      var url = API + '/api/config-status';
      try {
        var shop = getShopParam();
        if (!shop && typeof shopForSalesFallback === 'string' && shopForSalesFallback) shop = shopForSalesFallback;
        if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);
      } catch (_) {}
      if (options && options.force) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      }
      return url;
    }

    function getReconcileSalesUrl(options = {}) {
      var url = API + '/api/reconcile-sales?range=7d';
      try {
        var shop = getShopParam();
        if (!shop && typeof shopForSalesFallback === 'string' && shopForSalesFallback) shop = shopForSalesFallback;
        if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);
      } catch (_) {}
      if (options && options.force) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      }
      return url;
    }

    function setDiagnosticsActionMsg(text, ok) {
      var el = document.getElementById('config-action-msg');
      if (!el) return;
      el.textContent = text || '';
      el.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
    }

    function reconcileSalesTruth(options = {}) {
      const btn = document.getElementById('config-reconcile-btn');
      if (btn) {
        btn.classList.add('spinning');
        btn.disabled = true;
      }
      setDiagnosticsActionMsg('Reconciling Shopify truth (7d)…', true);
      const p = fetch(getReconcileSalesUrl({ force: true }), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(function(r) { return r.json(); })
        .then(function(payload) {
          try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
          try { fetchTrafficData({ force: true }); } catch (_) {}
          var details = payload && payload.result ? payload.result : null;
          var fetched = details && typeof details.fetched === 'number' ? details.fetched : null;
          var inserted = details && typeof details.inserted === 'number' ? details.inserted : null;
          var updated = details && typeof details.updated === 'number' ? details.updated : null;
          var linked = details && typeof details.evidenceLinked === 'number' ? details.evidenceLinked : null;
          var bits = [];
          if (fetched != null) bits.push('fetched ' + String(fetched));
          if (inserted != null) bits.push('inserted ' + String(inserted));
          if (updated != null) bits.push('updated ' + String(updated));
          if (linked != null) bits.push('linked ' + String(linked));
          setDiagnosticsActionMsg(bits.length ? ('Reconcile done: ' + bits.join(', ')) : 'Reconcile done.', true);
        })
        .catch(function(err) {
          setDiagnosticsActionMsg('Reconcile failed: ' + (err && err.message ? String(err.message).slice(0, 120) : 'request_failed'), false);
        })
        .finally(() => {
          if (btn) {
            btn.classList.remove('spinning');
            btn.disabled = false;
          }
        });
      return p;
    }

    var activeDiagTabKey = 'sales';

    function isConfigModalOpen() { return false; }

    function refreshConfigStatus(options = {}) {
      if (configStatusRefreshInFlight && !options.force) return configStatusRefreshInFlight;
      const refreshBtn = document.getElementById('config-refresh-btn');
      const configStatusEl = document.getElementById('diagnostics-content');
      const compareModalEl = document.getElementById('kpi-compare-modal');
      const compareRefreshBtn = document.getElementById('kpi-compare-refresh-btn');
      const compareStatusEl = document.getElementById('kpi-compare-status');
      const compareUpdatedEl = document.getElementById('kpi-compare-updated');
      const compareKickerEl = document.getElementById('kpi-compare-kicker');
      const compareOpen = !!(compareModalEl && compareModalEl.classList.contains('open'));
      let diagnosticsStepEl = null;
      let compareStepEl = null;
      const preserveView = !!(options && options.preserveView);
      const modalCardEl = null;
      const prevModalScrollTop = (preserveView && modalCardEl) ? (modalCardEl.scrollTop || 0) : 0;
      if (configStatusEl && !preserveView) {
        configStatusEl.innerHTML =
          '<div class="d-flex align-items-center gap-2 text-secondary">' +
            '<div class="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true"></div>' +
            '<div>Loading diagnostics…</div>' +
          '</div>' +
          '<div id="settings-diagnostics-loading-step" class="text-secondary small mt-2">\u2014</div>';
        diagnosticsStepEl = configStatusEl.querySelector('#settings-diagnostics-loading-step');
        if (diagnosticsStepEl) diagnosticsStepEl.textContent = 'Connecting to diagnostics services';
      }
      if (compareOpen && compareStatusEl) {
        compareStatusEl.innerHTML = '<div class="kpi-compare-loading"><div class="report-build-wrap"><div class="spinner-border text-primary" role="status"></div><div class="report-build-title">building KPI comparison</div><div class="report-build-step">—</div></div></div>';
        compareStepEl = compareStatusEl.querySelector('.report-build-step');
        if (compareStepEl) compareStepEl.textContent = 'Loading KPI sources';
      }

      if (refreshBtn) refreshBtn.classList.add('spinning');
      if (compareOpen && compareRefreshBtn) compareRefreshBtn.classList.add('spinning');
      const p = fetch(getConfigStatusUrl({ force: !!options.force }), { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) {
          if (!r.ok) throw new Error('Config status ' + r.status);
          return r.json();
        })
        .then(c => {
          if (diagnosticsStepEl) diagnosticsStepEl.textContent = 'Analyzing diagnostics payload';
          if (compareStepEl) compareStepEl.textContent = 'Comparing KPI values';
          function code(value) { return '<code>' + escapeHtml(value == null ? '' : String(value)) + '</code>'; }
          function pill(text, tone) {
            const t = (tone === 'bad' || tone === 'warn') ? tone : 'ok';
            return '<span class="diag-pill ' + t + '">' + escapeHtml(String(text || '')) + '</span>';
          }
          function kv(label, valueHtml) {
            return '<div class="diag-kv"><div class="k">' + escapeHtml(label) + '</div><div class="v">' + valueHtml + '</div></div>';
          }
          function icon(name, cls, iconKey) {
            const map = {
              shield: 'fa-light fa-shield-halved',
              columns: 'fa-light fa-table-columns',
              list: 'fa-light fa-list',
              bag: 'fa-light fa-bag-shopping',
              activity: 'fa-light fa-wave-square',
              bar: 'fa-light fa-chart-column',
              server: 'fa-light fa-server',
              key: 'fa-light fa-key',
              link: 'fa-light fa-link',
              chev: 'fa-light fa-chevron-down'
            };
            const fa = map[name] || 'fa-light fa-circle';
            const extra = cls ? (' ' + cls) : '';
            var keyAttr = iconKey ? (' data-icon-key="' + escapeHtml(String(iconKey)) + '"') : '';
            return '<i class="' + fa + extra + '"' + keyAttr + ' aria-hidden="true"></i>';
          }
          function fmtSessions(n) { return (typeof n === 'number' && isFinite(n)) ? escapeHtml(formatSessions(n)) : '\u2014'; }
          function fmtRevenue(n) { return (typeof n === 'number' && isFinite(n)) ? escapeHtml(formatRevenue(n)) : '\u2014'; }
          function fmtTsMaybe(ms) { return (typeof ms === 'number' && isFinite(ms)) ? escapeHtml(formatTs(ms)) : '\u2014'; }
          function fmtPct(p) {
            if (typeof p !== 'number' || !isFinite(p)) return '\u2014';
            const s = (Math.round(p * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
            return escapeHtml(s + '%');
          }
          function fmtSigned(n, fmtAbsFn, unitSuffix) {
            if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
            const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
            const abs = Math.abs(n);
            const core = fmtAbsFn ? fmtAbsFn(abs) : String(abs);
            return escapeHtml(sign + core + (unitSuffix || ''));
          }

          const app = c && c.app ? c.app : {};
          const shopify = c && c.shopify ? c.shopify : {};
          const db = c && c.db ? c.db : {};
          const ingest = c && c.ingest ? c.ingest : {};
          const reporting = c && c.reporting ? c.reporting : {};
          const traffic = c && c.traffic ? c.traffic : {};
          const sales = c && c.sales ? c.sales : {};
          const truth = sales && sales.truth ? sales.truth : {};
          const truthToday = truth && truth.today ? truth.today : {};
          const health = truth && truth.health ? truth.health : {};
          const evidenceToday = sales && sales.evidence && sales.evidence.today ? sales.evidence.today : {};
          const driftOrders = sales && sales.drift && typeof sales.drift.orders === 'number' ? sales.drift.orders : null;
          const pixelDerivedToday = sales && sales.pixel && sales.pixel.today ? sales.pixel.today : {};
          const pixelDerivedOrders = (typeof pixelDerivedToday.orderCount === 'number') ? pixelDerivedToday.orderCount : null;
          const pixelDerivedRevenue = (typeof pixelDerivedToday.revenueGbp === 'number') ? pixelDerivedToday.revenueGbp : null;
          const driftPixelOrders = sales && sales.drift && typeof sales.drift.pixelVsTruthOrders === 'number' ? sales.drift.pixelVsTruthOrders : null;
          const driftPixelRevenue = sales && sales.drift && typeof sales.drift.pixelVsTruthRevenueGbp === 'number' ? sales.drift.pixelVsTruthRevenueGbp : null;
          const missingEvidenceToday = sales && sales.missingEvidence && sales.missingEvidence.today ? sales.missingEvidence.today : {};
          const missingEvidenceCount = (missingEvidenceToday && typeof missingEvidenceToday.missingOrderCount === 'number')
            ? missingEvidenceToday.missingOrderCount
            : null;
          const missingEvidenceSample = (missingEvidenceToday && Array.isArray(missingEvidenceToday.missingOrdersSample))
            ? missingEvidenceToday.missingOrdersSample
            : [];
          const missingEvidenceNote = (missingEvidenceToday && typeof missingEvidenceToday.note === 'string')
            ? missingEvidenceToday.note
            : '';
          const pixel = c && c.pixel ? c.pixel : {};
          const appSettings = c && c.settings ? c.settings : {};
          const trackerDefinitions = c && c.trackerDefinitions ? c.trackerDefinitions : null;
          const pixelSessionMode = (appSettings && appSettings.pixelSessionMode != null)
            ? String(appSettings.pixelSessionMode).trim().toLowerCase()
            : 'legacy';
          const sharedSessionFixEnabled = pixelSessionMode === 'shared_ttl';

          const truthOrders = (typeof truthToday.orderCount === 'number') ? truthToday.orderCount : null;
          const truthRevenue = (typeof truthToday.revenueGbp === 'number') ? truthToday.revenueGbp : null;
          const truthCheckoutOrders = (typeof truthToday.checkoutOrderCount === 'number') ? truthToday.checkoutOrderCount : null;
          const truthCheckoutRevenue = (typeof truthToday.checkoutRevenueGbp === 'number') ? truthToday.checkoutRevenueGbp : null;
          const truthReturningCustomers = (typeof truthToday.returningCustomerCount === 'number') ? truthToday.returningCustomerCount : null;
          const truthReturningRevenue = (typeof truthToday.returningRevenueGbp === 'number') ? truthToday.returningRevenueGbp : null;
          const evTotal = (typeof evidenceToday.checkoutCompleted === 'number') ? evidenceToday.checkoutCompleted : null;
          const evSessions = (typeof evidenceToday.checkoutCompletedSessions === 'number') ? evidenceToday.checkoutCompletedSessions : null;
          const evLinked = (typeof evidenceToday.linked === 'number') ? evidenceToday.linked : null;
          const evUnlinked = (typeof evidenceToday.unlinked === 'number') ? evidenceToday.unlinked : null;
          const staleSec = (health && typeof health.staleMs === 'number') ? Math.round(health.staleMs / 1000) : null;

          const SHOPIFY_LOGO_URL = 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/shopify.png?v=1770259752';
          const KEXO_LOGO_URL = '/assets/kexo_logo_fullcolor.webp';

          const shopifySessionsToday = (traffic && typeof traffic.shopifySessionsToday === 'number') ? traffic.shopifySessionsToday : null;
          const shopifyConversionRateToday = (traffic && typeof traffic.shopifyConversionRateToday === 'number') ? traffic.shopifyConversionRateToday : null;
          const shopifyConversionRateNote = (traffic && typeof traffic.shopifyConversionRateTodayNote === 'string') ? traffic.shopifyConversionRateTodayNote : '';
          const kexoSessionsToday = (traffic && traffic.today && typeof traffic.today.humanSessions === 'number') ? traffic.today.humanSessions :
            (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number') ? traffic.today.sessionsReachedApp : null;
          const botsBlockedToday = (traffic && traffic.today && typeof traffic.today.botsBlockedAtEdge === 'number') ? traffic.today.botsBlockedAtEdge : null;
          const botsBlockedUpdatedAt = (traffic && traffic.today && typeof traffic.today.botsBlockedAtEdgeUpdatedAt === 'number') ? traffic.today.botsBlockedAtEdgeUpdatedAt : null;

          // Conversion rate used across Kexo tables: truth orders / sessions.
          // Prefer checkout-token truth orders (online-store proxy) when available.
          const convertedOrdersForCr = (truthCheckoutOrders != null ? truthCheckoutOrders : truthOrders);
          const shopifyCr = (shopifyConversionRateToday != null)
            ? shopifyConversionRateToday
            : ((convertedOrdersForCr != null && shopifySessionsToday != null && shopifySessionsToday > 0)
              ? (convertedOrdersForCr / shopifySessionsToday) * 100
              : null);
          const kexoCr = (convertedOrdersForCr != null && kexoSessionsToday != null && kexoSessionsToday > 0) ? (convertedOrdersForCr / kexoSessionsToday) * 100 : null;
          const shopifyCrSource = (shopifyConversionRateToday != null)
            ? 'traffic.shopifyConversionRateToday (ShopifyQL conversion_rate)'
            : 'computed: truth orders / Shopify sessions (fallback)';

          const driftPixelCheckoutOrders = (truthCheckoutOrders != null && pixelDerivedOrders != null) ? (pixelDerivedOrders - truthCheckoutOrders) : null;
          const driftPixelCheckoutRevenue = (truthCheckoutRevenue != null && pixelDerivedRevenue != null)
            ? (Math.round((pixelDerivedRevenue - truthCheckoutRevenue) * 100) / 100)
            : null;
          const driftEvidenceCheckoutOrders = (truthCheckoutOrders != null && evTotal != null) ? (evTotal - truthCheckoutOrders) : null;

          const sessionsDiff = (shopifySessionsToday != null && kexoSessionsToday != null) ? (shopifySessionsToday - kexoSessionsToday) : null;
          const crDiff = (shopifyCr != null && kexoCr != null) ? (shopifyCr - kexoCr) : null;

          const storedScopesStr = (shopify && shopify.storedScopes) ? String(shopify.storedScopes) : '';
          const serverScopesStr = (shopify && shopify.serverScopes) ? String(shopify.serverScopes) : '';
          const storedScopes = storedScopesStr ? storedScopesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
          const serverScopes = serverScopesStr ? serverScopesStr.split(',').map(s => s.trim()).filter(Boolean) : [];
          const missingScopes = (storedScopes.length && serverScopes.length) ? serverScopes.filter(s => storedScopes.indexOf(s) === -1) : [];

          const pixelIngestUrl = (pixel && pixel.ingestUrl != null) ? String(pixel.ingestUrl) : '';
          const expectedIngestUrl = (ingest && ingest.effectiveIngestUrl != null) ? String(ingest.effectiveIngestUrl) : '';
          const ingestUrlMatch = (pixelIngestUrl && expectedIngestUrl) ? (pixelIngestUrl === expectedIngestUrl) : null;

          function diffCell(text, cls) {
            const c = cls ? (' ' + cls) : '';
            return '<span class="' + c.trim() + '">' + escapeHtml(text) + '</span>';
          }

          function renderTrackerDefinitions(defs) {
            if (!defs || !Array.isArray(defs.tables)) {
              return '<div class="dm-def-note">No tracker definitions available from server.</div>';
            }

            function pill2(text, tone) {
              const t = (tone === 'bad' || tone === 'warn') ? tone : 'ok';
              return '<span class="dm-pill dm-pill-' + t + '">' + escapeHtml(String(text || '')) + '</span>';
            }
            function code2(value) {
              return '<code class="dm-code">' + escapeHtml(value == null ? '' : String(value)) + '</code>';
            }
            function line2(label, valueHtml) {
              return (
                '<div class="dm-row-kv">' +
                  '<div class="dm-k">' + escapeHtml(label) + '</div>' +
                  '<div class="dm-v">' + (valueHtml || '\u2014') + '</div>' +
                '</div>'
              );
            }
            function sectionTitle2(text) {
              return '<div class="dm-def-section-title">' + escapeHtml(text) + '</div>';
            }

            const ver = (defs.version != null) ? String(defs.version) : '';
            const last = (defs.lastUpdated != null) ? String(defs.lastUpdated) : '';
            const note = defs.note ? String(defs.note) : '';
            const defsTables = Array.isArray(defs.tables) ? defs.tables : [];

            const byPage = {};
            for (const d of defsTables) {
              const p = (d && d.page) ? String(d.page) : 'Other';
              if (!byPage[p]) byPage[p] = [];
              byPage[p].push(d);
            }

            const preferredOrder = ['Home', 'Overview', 'Countries', 'Products', 'Traffic', 'Diagnostics', 'Other'];
            const pages = Object.keys(byPage || {});
            pages.sort(function(a, b) {
              const ia = preferredOrder.indexOf(a);
              const ib = preferredOrder.indexOf(b);
              if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
              if (ia === -1) return 1;
              if (ib === -1) return -1;
              return ia - ib;
            });

            let out = '';
            out += '<div class="dm-def-root">';
            const metaBits = [];
            if (ver) metaBits.push('v' + ver);
            if (last) metaBits.push('Last updated ' + last);
            if (metaBits.length) out += '<div class="dm-def-meta">' + escapeHtml(metaBits.join(' · ')) + '</div>';
            if (note) out += '<div class="dm-def-note">' + escapeHtml(note) + '</div>';

            if (!pages.length) {
              out += '<div class="dm-def-note">No definitions found.</div>';
              out += '</div>';
              return out;
            }

            for (const page of pages) {
              const list = Array.isArray(byPage[page]) ? byPage[page].slice() : [];
              list.sort(function(a, b) { return String((a && a.name) || '').localeCompare(String((b && b.name) || '')); });

              out += '<div class="dm-def-page-box">';
              out +=   '<div class="dm-def-page-title">' + escapeHtml(page) + '</div>';

              for (const d of list) {
                const id = (d && d.id) ? String(d.id) : '';
                const name = (d && d.name) ? String(d.name) : (id || 'Unnamed');
                const endpoint = (d && d.endpoint) ? d.endpoint : {};
                const method = endpoint && endpoint.method ? String(endpoint.method) : '';
                const path = endpoint && endpoint.path ? String(endpoint.path) : '';
                const params = (endpoint && Array.isArray(endpoint.params)) ? endpoint.params : [];
                const uiIds = (d && d.ui && Array.isArray(d.ui.elementIds)) ? d.ui.elementIds : [];
                const uiMissing = uiIds.filter(function(x) { return x && !document.getElementById(String(x)); });

                const checks = (d && d.checks) ? d.checks : {};
                const activeMissingTables = (checks && Array.isArray(checks.activeDbTablesMissing)) ? checks.activeDbTablesMissing : null;
                const missingTables = activeMissingTables != null
                  ? activeMissingTables
                  : ((checks && Array.isArray(checks.dbTablesMissing)) ? checks.dbTablesMissing : []);
                const dbOk = (missingTables.length === 0);
                const tokenOk = (checks && checks.shopifyTokenOk === true) || !(d && d.requires && d.requires.shopifyToken);
                const uiOk = (uiMissing.length === 0);
                const overallOk = dbOk && tokenOk && uiOk;

                const summaryBits = [];
                if (method && path) summaryBits.push(method + ' ' + path);
                if (params.length) summaryBits.push('params: ' + params.join(', '));
                if (!summaryBits.length && id) summaryBits.push(id);

                const chips = [];
                chips.push(overallOk ? pill2('OK', 'ok') : pill2('Check', (missingTables.length ? 'bad' : 'warn')));
                if (uiIds.length) chips.push(uiOk ? pill2('UI OK', 'ok') : pill2('UI missing', 'warn'));
                if (missingTables.length) chips.push(pill2('DB missing', 'bad'));
                if (d && d.requires && d.requires.shopifyToken) chips.push(tokenOk ? pill2('Token OK', 'ok') : pill2('Token missing', 'bad'));

                out += '<details class="dm-def-details">';
                out +=   '<summary>';
                out +=     '<div style="min-width:0;">';
                out +=       '<div class="dm-def-details-name">' + escapeHtml(name) + '</div>';
                out +=       '<div class="dm-def-details-sub">' + escapeHtml(summaryBits.join(' · ')) + '</div>';
                out +=     '</div>';
                out +=     '<div class="dm-def-details-chips">' + chips.join('') + '</div>';
                out +=   '</summary>';

                out +=   '<div class="dm-def-details-body">';
                if (id) out += line2('Id', code2(id));
                if (method && path) out += line2('Endpoint', code2(method + ' ' + path));
                if (params.length) out += line2('Params', code2(params.join(', ')));
                if (uiIds.length) out += line2('UI elementIds', code2(uiIds.join(', ')));
                if (uiMissing.length) out += line2('UI missing', code2(uiMissing.join(', ')));
                if (missingTables.length) out += line2('DB tables missing', code2(missingTables.join(', ')));
                if (d && d.requires && d.requires.shopifyToken) out += line2('Shopify token', tokenOk ? pill2('OK', 'ok') : pill2('Missing', 'bad'));

                const respects = (d && d.respectsReporting) ? d.respectsReporting : {};
                const rOrders = !!(respects && respects.ordersSource);
                const rSessions = !!(respects && respects.sessionsSource);
                const respectsBits = [];
                respectsBits.push('ordersSource ' + (rOrders ? 'YES' : 'NO'));
                respectsBits.push('sessionsSource ' + (rSessions ? 'YES' : 'NO'));
                const nowBits = [];
                if (rOrders && reporting && reporting.ordersSource) nowBits.push('ordersSource=' + reporting.ordersSource);
                if (rSessions && reporting && reporting.sessionsSource) nowBits.push('sessionsSource=' + reporting.sessionsSource);
                out += line2('Respects reporting', code2(respectsBits.join(' · ') + (nowBits.length ? (' · now ' + nowBits.join(', ')) : '')));

                const sources = (d && Array.isArray(d.sources)) ? d.sources : [];
                if (sources.length) {
                  out += sectionTitle2('Sources');
                  out += '<ul class="dm-def-list">';
                  for (const s of sources) {
                    const kind = (s && s.kind) ? String(s.kind) : 'source';
                    const st = (s && Array.isArray(s.tables)) ? s.tables : [];
                    const note2 = (s && s.note) ? String(s.note) : '';
                    let line = '<strong>' + escapeHtml(kind) + '</strong>';
                    if (st.length) line += ' · ' + escapeHtml(st.join(', '));
                    if (note2) line += ' — ' + escapeHtml(note2);
                    out += '<li>' + line + '</li>';
                  }
                  out += '</ul>';
                }

                const columns = (d && Array.isArray(d.columns)) ? d.columns : [];
                if (columns.length) {
                  out += sectionTitle2('Columns + math');
                  out += '<ul class="dm-def-list">';
                  for (const col of columns) {
                    const cn = (col && col.name) ? String(col.name) : 'Column';
                    const cv = (col && col.value != null) ? String(col.value) : '';
                    const cf = (col && col.formula != null) ? String(col.formula) : '';
                    let line = '<strong>' + escapeHtml(cn) + '</strong>';
                    if (cv) line += ' · ' + escapeHtml(cv);
                    if (cf) line += ' · <code class="dm-code">' + escapeHtml(cf) + '</code>';
                    out += '<li>' + line + '</li>';
                  }
                  out += '</ul>';
                }

                const math = (d && Array.isArray(d.math)) ? d.math : [];
                if (math.length) {
                  out += sectionTitle2('Notes');
                  out += '<ul class="dm-def-list">';
                  for (const m of math) {
                    const mn = (m && m.name) ? String(m.name) : 'Note';
                    const mv = (m && m.value != null) ? String(m.value) : '';
                    out += '<li><strong>' + escapeHtml(mn) + '</strong>' + (mv ? (' · ' + escapeHtml(mv)) : '') + '</li>';
                  }
                  out += '</ul>';
                }

                out +=   '</div>';
                out += '</details>';
              }

              out += '</div>';
            }

            out += '</div>';
            return out;
          }

          // --- New flattened, top-tab Diagnostics UI (inline-styled) ---
          const shopifyOrderRate = shopifyCr;
          const kexoOrderRate = kexoCr;
          const orderRateDiff = (shopifyOrderRate != null && kexoOrderRate != null) ? (shopifyOrderRate - kexoOrderRate) : null;

          const evidenceExpected = (truthCheckoutOrders != null ? truthCheckoutOrders : truthOrders);

          function pillInline(text, tone) {
            const t = (tone === 'bad' || tone === 'warn') ? tone : 'ok';
            return '<span class="dm-pill dm-pill-' + t + '">' + escapeHtml(String(text || '')) + '</span>';
          }
          function codeInline(value) {
            return '<code class="dm-code">' + escapeHtml(value == null ? '' : String(value)) + '</code>';
          }
          function card(title, bodyHtml) {
            const h = title ? ('<div class="dm-card-title">' + escapeHtml(title) + '</div>') : '';
            return '<div class="dm-card">' + h + (bodyHtml || '') + '</div>';
          }
          function brandHeader(name, iconUrl, subtitle, accentRgb) {
            const sub = subtitle ? ('<div class="dm-brand-sub">' + escapeHtml(subtitle) + '</div>') : '';
            return (
              '<div class="dm-brand-header">' +
                '<div class="dm-brand-header-inner">' +
                  '<img src="' + escapeHtml(String(iconUrl || '')) + '" alt="' + escapeHtml(String(name || '')) + '" class="dm-brand-icon" />' +
                  '<div style="min-width:0;line-height:1.1;">' +
                    '<div class="dm-brand-name">' + escapeHtml(String(name || '')) + '</div>' +
                    sub +
                  '</div>' +
                '</div>' +
              '</div>'
            );
          }
          function brandIconTiny(name, iconUrl, accentRgb) {
            return '<img src="' + escapeHtml(String(iconUrl || '')) + '" alt="' + escapeHtml(String(name || '')) + '" class="dm-brand-icon" />';
          }
          function metric(label, valueHtml) {
            return (
              '<div class="dm-metric">' +
                '<div class="dm-metric-label">' + escapeHtml(label) + '</div>' +
                '<div class="dm-metric-value">' + (valueHtml || '\u2014') + '</div>' +
              '</div>'
            );
          }
          function rowKV(label, valueHtml, noteHtml) {
            return (
              '<div class="dm-row-kv">' +
                '<div class="dm-k">' + escapeHtml(label) + '</div>' +
                '<div class="dm-v">' + (valueHtml || '\u2014') + '</div>' +
              '</div>' +
              (noteHtml ? ('<div class="dm-row-kv-note">' + noteHtml + '</div>') : '')
            );
          }
          function diffSpan(n, fmtAbsFn, unitSuffix) {
            if (typeof n !== 'number' || !isFinite(n)) return '\u2014';
            const abs = Math.abs(n);
            const sign = n > 0 ? '+' : (n < 0 ? '-' : '');
            const core = fmtAbsFn ? fmtAbsFn(abs) : String(abs);
            const tone = Math.abs(n) < 0.0001 ? 'ok' : 'warn';
            const text = sign + core + (unitSuffix || '');
            return pillInline(text, tone);
          }


          const headerMetaBits = [];
          if (shopify && shopify.shop) headerMetaBits.push('Shop ' + codeInline(shopify.shop));
          if (c && c.timeZone) headerMetaBits.push('TZ ' + codeInline(String(c.timeZone)));
          headerMetaBits.push('Updated ' + codeInline(formatTs(c && c.now ? c.now : Date.now())));

          const aiCopyGeneratedAt = new Date().toISOString();
          let aiCopyText = '';
          let aiPayloadData = null;
          try {
            const convertedSessionsSource = (evSessions != null)
              ? 'sales.evidence.today.checkoutCompletedSessions'
              : (truthCheckoutOrders != null ? 'sales.truth.today.checkoutOrderCount (fallback)' : (truthOrders != null ? 'sales.truth.today.orderCount (fallback)' : 'unknown'));
            const aiPayload = {
              kind: 'kexo_diagnostics_v2',
              generatedAt: aiCopyGeneratedAt,
              diagnosticsSchemaVersion: (c && c.diagnostics && c.diagnostics.schemaVersion != null) ? c.diagnostics.schemaVersion : null,
              page: {
                href: (typeof window !== 'undefined' && window.location) ? window.location.href : '',
              },
              browser: {
                userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '',
                language: (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : '',
              },
              aiNotes: [
                'Truth = Shopify Orders API cache (orders_shopify). This is authoritative.',
                'Evidence = Web Pixel checkout_completed events (purchase_events). Evidence < Truth usually means missing pixel events (consent/adblock/checkout surface) or non-storefront orders.',
                'Kexo derived = purchases built from evidence; if derived matches evidence, drift is upstream of purchases.',
                'Inspect rawConfigStatus.sales.missingEvidence.today.missingOrdersSample for a sample of truth orders missing evidence.',
              ],
              computed: {
                sessions: {
                  shopifyToday: shopifySessionsToday,
                  kexoHumanToday: kexoSessionsToday,
                  diff: sessionsDiff,
                },
                conversions: {
                  definition: 'Shopify CR% uses ShopifyQL conversion_rate; Kexo CR% uses truth orders / sessions * 100',
                  shopifyCrSource,
                  convertedSessionsSource,
                  shopifyCrPct: shopifyCr,
                  kexoCrPct: kexoCr,
                  crDiffPctPoints: crDiff,
                  ordersPerSessionPct: {
                    shopify: shopifyOrderRate,
                    kexo: kexoOrderRate,
                    diffPctPoints: orderRateDiff,
                  },
                },
                truth: {
                  ordersPaidToday: truthOrders,
                  revenueGbpToday: truthRevenue,
                  checkoutTokenOrdersPaidToday: truthCheckoutOrders,
                  checkoutTokenRevenueGbpToday: truthCheckoutRevenue,
                },
                pixelDerived: {
                  ordersToday: pixelDerivedOrders,
                  revenueGbpToday: pixelDerivedRevenue,
                },
                evidence: {
                  checkoutCompletedEventsToday: evTotal,
                  checkoutCompletedSessionsToday: evSessions,
                  linkedEventsToday: evLinked,
                  unlinkedEventsToday: evUnlinked,
                },
                drift: {
                  pixelVsTruthOrders: driftPixelOrders,
                  pixelVsTruthRevenueGbp: driftPixelRevenue,
                  evidenceVsCheckoutTokenOrders: driftEvidenceCheckoutOrders,
                },
                salesEvidence: {
                  evidenceCoveragePct: (truthCheckoutOrders != null && truthCheckoutOrders > 0 && evTotal != null) ? ((evTotal / truthCheckoutOrders) * 100) : null,
                  missingEvidenceOrderCount: missingEvidenceCount,
                  missingEvidenceSample: (missingEvidenceSample && missingEvidenceSample.length) ? missingEvidenceSample.slice(0, 25) : [],
                },
                pixel: {
                  shopifyWebPixelOk: (pixel && typeof pixel.ok === 'boolean') ? pixel.ok : null,
                  shopifyWebPixelInstalled: (pixel && typeof pixel.installed === 'boolean') ? pixel.installed : null,
                  pixelIngestUrl,
                  expectedIngestUrl,
                  ingestUrlMatch,
                },
                settings: {
                  pixelSessionMode,
                  sharedSessionFixEnabled,
                  chartsUiSummary: (c && c.settings && c.settings.chartsUiSummary) ? c.settings.chartsUiSummary : null,
                  kpiUiSummary: (c && c.settings && c.settings.kpiUiSummary) ? c.settings.kpiUiSummary : null,
                },
              },
              rawConfigStatus: c,
            };
            aiPayloadData = aiPayload;
            aiCopyText =
              'Kexo diagnostics (paste this for AI)\n' +
              'Generated: ' + aiCopyGeneratedAt + '\n' +
              (shopify && shopify.shop ? ('Shop: ' + shopify.shop + '\n') : '') +
              '\n```json\n' + JSON.stringify(aiPayload, null, 2) + '\n```\n';
          } catch (err) {
            aiCopyText = 'Kexo diagnostics (AI)\nGenerated: ' + aiCopyGeneratedAt + '\nError building payload: ' + (err && err.message ? String(err.message) : String(err)) + '\n';
          }

          const copyIcon = '<i class="fa-light fa-copy" data-icon-key="diag-copy" aria-hidden="true"></i>';

          // Settings → Diagnostics (Tabler accordion, no tabs/custom dm-* classes)
          function badgeLt(text, tone) {
            var cls = 'bg-secondary-lt';
            if (tone === 'ok') cls = 'bg-success-lt';
            else if (tone === 'warn') cls = 'bg-warning-lt';
            else if (tone === 'bad') cls = 'bg-danger-lt';
            return '<span class="badge ' + cls + '">' + escapeHtml(String(text || '')) + '</span>';
          }
          function cardSm(titleHtml, bodyHtml) {
            return (
              '<div class="card card-sm">' +
                '<div class="card-header"><h4 class="card-title mb-0">' + titleHtml + '</h4></div>' +
                '<div class="card-body">' + (bodyHtml || '') + '</div>' +
              '</div>'
            );
          }
          function kvTable(rows) {
            if (typeof buildKexoSettingsTable !== 'function') {
              var body = (rows || []).map(function(r) {
                return '<tr><td class="text-secondary">' + escapeHtml(r[0] || '') + '</td><td class="text-end">' + (r[1] != null ? String(r[1]) : '\u2014') + '</td></tr>';
              }).join('');
              return '<div class="table-responsive"><table class="table table-sm table-vcenter mb-0"><tbody>' + body + '</tbody></table></div>';
            }
            var def = (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['diagnostics-kv-table']) || {};
            return buildKexoSettingsTable({
              tableClass: 'table table-sm table-vcenter mb-0',
              columns: (def.columns || []).length ? def.columns : [
                { header: 'Metric', headerClass: 'text-secondary' },
                { header: 'Value', headerClass: 'text-end' }
              ],
              bodyHtml: (rows || []).map(function(r) {
                return '<tr><td class="text-secondary">' + escapeHtml(r[0] || '') + '</td><td class="text-end">' + (r[1] != null ? String(r[1]) : '\u2014') + '</td></tr>';
              }).join('')
            });
          }
          function accordionItem(key, title, bodyHtml) {
            var safeKey = String(key || '').replace(/[^a-z0-9_-]+/gi, '');
            var headingId = 'settings-diagnostics-heading-' + safeKey;
            var collapseId = 'settings-diagnostics-collapse-' + safeKey;
            return (
              '<div class="accordion-item">' +
                '<h2 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
                  '<button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="false" aria-controls="' + escapeHtml(collapseId) + '">' +
                    '<span class="kexo-settings-accordion-chevron"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span>' +
                    '<span class="fw-semibold">' + escapeHtml(title || '') + '</span>' +
                  '</button>' +
                '</h2>' +
                '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse" aria-labelledby="' + escapeHtml(headingId) + '" data-bs-parent="#settings-diagnostics-accordion">' +
                  '<div class="accordion-body">' + (bodyHtml || '') + '</div>' +
                '</div>' +
              '</div>'
            );
          }

          var overviewBody = '';
          overviewBody += '<div class="row g-3">';
          overviewBody +=   '<div class="col-12 col-xl-6">' + cardSm(
            '<span class="d-flex align-items-center gap-2"><img src="' + escapeHtml(SHOPIFY_LOGO_URL) + '" width="20" height="20" alt="" aria-hidden="true" decoding="async" /><span>Shopify</span></span>',
            kvTable([
              ['Sessions (today)', fmtSessions(shopifySessionsToday)],
              ['CR% (today)', fmtPct(shopifyCr)],
              ['Orders (paid, today)', truthOrders != null ? escapeHtml(String(truthOrders)) : '\u2014'],
              ['Revenue (paid, today)', fmtRevenue(truthRevenue)],
            ])
          ) + '</div>';
          overviewBody +=   '<div class="col-12 col-xl-6">' + cardSm(
            '<span class="d-flex align-items-center gap-2"><img src="' + escapeHtml(KEXO_LOGO_URL) + '" width="20" height="20" alt="" aria-hidden="true" decoding="async" /><span>Kexo</span></span>',
            kvTable([
              ['Sessions (human, today)', fmtSessions(kexoSessionsToday)],
              ['CR% (truth, today)', fmtPct(kexoCr)],
              ['Bots blocked (today)', botsBlockedToday != null ? fmtSessions(botsBlockedToday) : '\u2014'],
              ['Orders (paid, today)', truthOrders != null ? escapeHtml(String(truthOrders)) : '\u2014'],
              ['Revenue (paid, today)', fmtRevenue(truthRevenue)],
            ])
          ) + '</div>';
          overviewBody += '</div>';
          if (shopifyCrSource) {
            overviewBody += '<div class="text-secondary small mt-3">Shopify CR source: ' + escapeHtml(shopifyCrSource) + '</div>';
          }
          if (shopifyConversionRateNote) {
            overviewBody += '<div class="text-secondary small mt-2">' + escapeHtml(shopifyConversionRateNote) + '</div>';
          }

          var salesBody = '';
          var lastReconcile = truth && truth.lastReconcile ? truth.lastReconcile : null;
          var reconcileBits = [];
          if (lastReconcile && typeof lastReconcile.fetched === 'number') reconcileBits.push('fetched ' + String(lastReconcile.fetched));
          if (lastReconcile && typeof lastReconcile.inserted === 'number') reconcileBits.push('inserted ' + String(lastReconcile.inserted));
          if (lastReconcile && typeof lastReconcile.updated === 'number') reconcileBits.push('updated ' + String(lastReconcile.updated));
          if (lastReconcile && typeof lastReconcile.evidenceLinked === 'number') reconcileBits.push('linked ' + String(lastReconcile.evidenceLinked));
          var denomForCoverage = (truthCheckoutOrders != null ? truthCheckoutOrders : truthOrders);
          var missingOrders = (typeof missingEvidenceCount === 'number')
            ? missingEvidenceCount
            : ((denomForCoverage != null && evTotal != null) ? Math.max(0, denomForCoverage - evTotal) : null);
          salesBody += '<div class="row g-3">';
          salesBody +=   '<div class="col-12 col-xl-6">' + cardSm('Truth (paid)', kvTable([
            ['Orders', truthOrders != null ? escapeHtml(String(truthOrders)) : '\u2014'],
            ['Revenue', fmtRevenue(truthRevenue)],
            ['Checkout-token orders', truthCheckoutOrders != null ? escapeHtml(String(truthCheckoutOrders)) : '\u2014'],
            ['Checkout-token revenue', truthCheckoutRevenue != null ? fmtRevenue(truthCheckoutRevenue) : '\u2014'],
            ['Returning customers', truthReturningCustomers != null ? escapeHtml(String(truthReturningCustomers)) : '\u2014'],
            ['Returning revenue', truthReturningRevenue != null ? fmtRevenue(truthReturningRevenue) : '\u2014'],
          ])) + '</div>';
          salesBody +=   '<div class="col-12 col-xl-6">' + cardSm('Evidence + Pixel', kvTable([
            ['Evidence events (today)', evTotal != null ? escapeHtml(String(evTotal)) : '\u2014'],
            ['Converted sessions (today)', evSessions != null ? escapeHtml(String(evSessions)) : '\u2014'],
            ['Linked / unlinked', (evLinked != null && evUnlinked != null) ? (escapeHtml(String(evLinked)) + ' / ' + escapeHtml(String(evUnlinked))) : '\u2014'],
            ['Pixel derived orders', pixelDerivedOrders != null ? escapeHtml(String(pixelDerivedOrders)) : '\u2014'],
            ['Pixel derived revenue', pixelDerivedRevenue != null ? fmtRevenue(pixelDerivedRevenue) : '\u2014'],
          ])) + '</div>';
          salesBody +=   '<div class="col-12">' + cardSm('Drift + reconcile', kvTable([
            ['Pixel vs checkout-token (orders)', driftPixelCheckoutOrders == null ? '\u2014' : escapeHtml(String(driftPixelCheckoutOrders >= 0 ? '+' : '') + String(driftPixelCheckoutOrders))],
            ['Pixel vs checkout-token (revenue)', driftPixelCheckoutRevenue == null ? '\u2014' : escapeHtml('\u00a3' + String(driftPixelCheckoutRevenue >= 0 ? '+' : '') + String(driftPixelCheckoutRevenue))],
            ['Evidence vs checkout-token (orders)', driftEvidenceCheckoutOrders == null ? '\u2014' : escapeHtml(String(driftEvidenceCheckoutOrders >= 0 ? '+' : '') + String(driftEvidenceCheckoutOrders))],
            ['Missing evidence (count)', missingOrders == null ? '\u2014' : badgeLt(String(missingOrders), missingOrders === 0 ? 'ok' : (missingOrders <= 3 ? 'warn' : 'bad'))],
            ['Last reconcile', (lastReconcile && typeof lastReconcile.ts === 'number')
              ? (escapeHtml(formatTs(lastReconcile.ts)) + (reconcileBits.length ? (' \u00b7 ' + escapeHtml(reconcileBits.join(', '))) : ''))
              : '\u2014'],
          ])) + '</div>';
          salesBody += '</div>';
          if (missingEvidenceNote) {
            salesBody += '<div class="text-secondary small mt-3">' + escapeHtml(missingEvidenceNote) + '</div>';
          }
          if (missingEvidenceSample && missingEvidenceSample.length) {
            function missingLineSimple(o) {
              if (!o || typeof o !== 'object') return '';
              var bits = [];
              var on = o.order_name != null ? String(o.order_name).trim() : '';
              var oid = o.order_id != null ? String(o.order_id).trim() : '';
              var ca = (o.created_at != null && isFinite(Number(o.created_at))) ? Number(o.created_at) : null;
              var src = o.source_name != null ? String(o.source_name).trim() : '';
              if (on) bits.push(on);
              if (oid) bits.push('id ' + oid);
              if (ca != null) bits.push(formatTs(ca));
              if (src) bits.push('source=' + src);
              return bits.length ? bits.join(' \u00b7 ') : '';
            }
            var lines = missingEvidenceSample.slice(0, 20).map(missingLineSimple).filter(Boolean);
            if (lines.length) {
              salesBody += '<details class="mt-3">';
              salesBody +=   '<summary class="text-secondary">Missing evidence orders (sample ' + escapeHtml(String(missingEvidenceSample.length)) + ')</summary>';
              salesBody +=   '<div class="mt-2">';
              salesBody +=     lines.map(function(t) { return '<div class="text-secondary small">' + escapeHtml(t) + '</div>'; }).join('');
              salesBody +=   '</div>';
              salesBody += '</details>';
            }
          }

          var trafficBody = '';
          trafficBody += '<div class="row g-3">';
          trafficBody +=   '<div class="col-12 col-xl-6">' + cardSm('Sessions (today)', kvTable([
            ['Reached app', (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number') ? escapeHtml(formatSessions(traffic.today.sessionsReachedApp)) : '\u2014'],
            ['Human sessions', (traffic && traffic.today && typeof traffic.today.humanSessions === 'number') ? escapeHtml(formatSessions(traffic.today.humanSessions)) : '\u2014'],
            ['Bot sessions tagged', (traffic && traffic.today && typeof traffic.today.botSessionsTagged === 'number') ? escapeHtml(formatSessions(traffic.today.botSessionsTagged)) : '\u2014'],
            ['Total traffic est.', (traffic && traffic.today && typeof traffic.today.totalTrafficEst === 'number') ? escapeHtml(formatSessions(traffic.today.totalTrafficEst)) : '\u2014'],
          ])) + '</div>';
          trafficBody +=   '<div class="col-12 col-xl-6">' + cardSm('Shopify vs ours', kvTable([
            ['Shopify sessions (today)', shopifySessionsToday != null ? escapeHtml(formatSessions(shopifySessionsToday)) : '\u2014'],
            ['Shopify CR% (today)', fmtPct(shopifyCr)],
            ['Ours CR% (truth, today)', fmtPct(kexoCr)],
          ])) + '</div>';
          trafficBody += '</div>';

          var pixelBody = '';
          var installedBadge = (pixel && pixel.installed === true) ? badgeLt('Installed', 'ok') : ((pixel && pixel.installed === false) ? badgeLt('Not installed', 'bad') : badgeLt('\u2014', 'warn'));
          pixelBody += '<div class="row g-3">';
          pixelBody +=   '<div class="col-12 col-xl-6">' + cardSm('Pixel (Shopify)', kvTable([
            ['Installed', installedBadge],
            ['Pixel ingestUrl', pixelIngestUrl ? code(pixelIngestUrl) : '\u2014'],
            ['Expected ingestUrl', expectedIngestUrl ? code(expectedIngestUrl) : '\u2014'],
            ['IngestUrl match', ingestUrlMatch == null ? '\u2014' : (ingestUrlMatch ? badgeLt('Match', 'ok') : badgeLt('Mismatch', 'bad'))],
          ])) + '</div>';
          pixelBody +=   '<div class="col-12 col-xl-6">' + cardSm('Session mode', (
            '<div class="form-check form-switch mb-2">' +
              '<input class="form-check-input" type="checkbox" id="pixel-session-mode-toggle"' + (sharedSessionFixEnabled ? ' checked' : '') + ' />' +
              '<label class="form-check-label" for="pixel-session-mode-toggle">Share session across tabs (30m inactivity)</label>' +
            '</div>' +
            '<div class="text-secondary small">Auto-saves. ON shares one session across tabs (30m inactivity) to reduce inflated session counts. OFF uses legacy per-tab sessions.</div>' +
            '<div id="pixel-session-mode-msg" class="form-hint mt-2"></div>'
          )) + '</div>';
          pixelBody += '</div>';

          var shopifyBody = '';
          shopifyBody += '<div class="row g-3">';
          shopifyBody +=   '<div class="col-12 col-xl-6">' + cardSm('Auth + scopes', kvTable([
            ['Shop', shopify && shopify.shop ? code(shopify.shop) : badgeLt('Missing', 'bad')],
            ['Token stored', shopify && shopify.hasToken ? badgeLt('Yes', 'ok') : badgeLt('No', 'bad')],
            ['Stored scopes', storedScopesStr ? code(storedScopesStr) : '\u2014'],
            ['Required scopes', serverScopesStr ? code(serverScopesStr) : '\u2014'],
            ['Missing scopes', missingScopes.length ? code(missingScopes.join(', ')) : badgeLt('None', 'ok')],
          ])) + '</div>';
          shopifyBody +=   '<div class="col-12 col-xl-6">' + cardSm('Truth sync health', kvTable([
            ['Sync age', staleSec != null ? code(String(staleSec) + 's') : '\u2014'],
            ['Last sync', (health && health.lastSuccessAt) ? code(formatTs(health.lastSuccessAt)) : '\u2014'],
            ['Last error', (health && health.lastError) ? code(String(health.lastError).slice(0, 220)) : '\u2014'],
            ['Last order', (typeof truthToday.lastOrderCreatedAt === 'number') ? code(formatTs(truthToday.lastOrderCreatedAt)) : '\u2014'],
          ])) + '</div>';
          shopifyBody += '</div>';

          var googleAdsBody = '';
          try {
            var ads = c && c.ads ? c.ads : {};
            var adsStatus = ads && ads.status ? ads.status : null;
            var providers = (adsStatus && Array.isArray(adsStatus.providers)) ? adsStatus.providers : [];
            var g = providers.find(function(p) { return p && String(p.key || '').toLowerCase() === 'google_ads'; }) || null;
            var connected = g && g.connected === true;
            var configured = g && g.configured === true;
            var customerId = (g && g.customerId) ? String(g.customerId) : '';
            var loginCustomerId = (g && g.loginCustomerId) ? String(g.loginCustomerId) : '';
            var hasRefreshToken = g && g.hasRefreshToken === true;
            var hasDeveloperToken = g && g.hasDeveloperToken === true;
            var hasAdsDb = g && g.adsDb === true;
            var apiVer = (ads && typeof ads.googleAdsApiVersion === 'string') ? ads.googleAdsApiVersion : '';
            var connectUrl = '/api/ads/google/connect?redirect=' + encodeURIComponent('/settings?tab=integrations');
            googleAdsBody += '<div class="row g-3">';
            googleAdsBody +=   '<div class="col-12 col-xl-6">' + cardSm('Connection', kvTable([
              ['Configured', configured ? badgeLt('Yes', 'ok') : badgeLt('No', 'bad')],
              ['Connected (refresh_token)', connected ? badgeLt('Yes', 'ok') : badgeLt('No', 'bad')],
              ['ADS DB', hasAdsDb ? badgeLt('OK', 'ok') : badgeLt('Missing', 'bad')],
              ['Customer ID', customerId ? code(customerId) : '\u2014'],
              ['Login Customer ID', loginCustomerId ? code(loginCustomerId) : '\u2014'],
              ['Developer token', hasDeveloperToken ? badgeLt('Set', 'ok') : badgeLt('Missing', 'bad')],
              ['Refresh token', hasRefreshToken ? badgeLt('Present', 'ok') : badgeLt('Missing', 'bad')],
              ['API version hint', apiVer ? code(apiVer) : badgeLt('Auto', 'ok')],
            ])) + '</div>';
            googleAdsBody +=   '<div class="col-12 col-xl-6">' + cardSm('Actions', (
              '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                '<a class="btn btn-outline-primary btn-sm" href="' + escapeHtml(connectUrl) + '">' + copyIcon + ' Connect</a>' +
                '<button type="button" id="ga-status-btn" class="btn btn-outline-secondary btn-sm">' + copyIcon + ' Status</button>' +
                '<button type="button" id="ga-summary-btn" class="btn btn-outline-secondary btn-sm">' + copyIcon + ' Summary</button>' +
                '<button type="button" id="ga-refresh-7d-btn" class="btn btn-outline-secondary btn-sm">' + copyIcon + ' Refresh 7d</button>' +
                '<button type="button" id="ga-refresh-month-btn" class="btn btn-outline-secondary btn-sm">' + copyIcon + ' Refresh month</button>' +
                '<span id="ga-msg" class="form-hint ms-2"></span>' +
              '</div>' +
              '<div class="text-secondary small mt-2">Refresh returns spend sync diagnostics including per-version attempts when Google Ads REST errors occur.</div>'
            )) + '</div>';
            googleAdsBody +=   '<div class="col-12">' + cardSm('Output', (
              '<pre id="ga-output" class="mb-0 small">' + escapeHtml(JSON.stringify({ ads: adsStatus }, null, 2)) + '</pre>'
            )) + '</div>';
            googleAdsBody += '</div>';
          } catch (err) {
            googleAdsBody = '<div class="alert alert-danger mb-0">Google Ads diagnostics failed to render.</div>';
          }

          var systemBody = '';
          var tablesLine = '';
          if (db && db.tables) {
            var t = db.tables;
            var bits = [];
            function add(name, ok) { bits.push(name + (ok ? ' ✓' : ' ✗')); }
            add('settings', !!t.settings);
            add('shop_sessions', !!t.shop_sessions);
            add('visitors', !!t.visitors);
            add('sessions', !!t.sessions);
            add('events', !!t.events);
            add('purchases', !!t.purchases);
            add('orders_shopify', !!t.orders_shopify);
            add('orders_shopify_line_items', !!t.orders_shopify_line_items);
            add('customer_order_facts', !!t.customer_order_facts);
            add('purchase_events', !!t.purchase_events);
            add('reconcile_state', !!t.reconcile_state);
            add('reconcile_snapshots', !!t.reconcile_snapshots);
            add('shopify_sessions_snapshots', !!t.shopify_sessions_snapshots);
            add('audit_log', !!t.audit_log);
            add('bot_block_counts', !!t.bot_block_counts);
            tablesLine = bits.join(' \u00b7 ');
          }
          systemBody += '<div class="row g-3">';
          systemBody +=   '<div class="col-12 col-xl-6">' + cardSm('Reporting', kvTable([
            ['Orders source', reporting && reporting.ordersSource ? code(reporting.ordersSource) : '\u2014'],
            ['Sessions source', reporting && reporting.sessionsSource ? code(reporting.sessionsSource) : '\u2014'],
          ])) + '</div>';
          systemBody +=   '<div class="col-12 col-xl-6">' + cardSm('Runtime', kvTable([
            ['App version', app && app.version ? code(app.version) : '\u2014'],
            ['DB', db && db.engine ? code(db.engine + (db.configured ? '' : ' (DB_URL not set)')) : '\u2014'],
            ['Tables', tablesLine ? code(tablesLine) : '\u2014'],
            ['Sentry', (app && typeof app.sentryConfigured === 'boolean') ? (app.sentryConfigured ? badgeLt('ON', 'ok') : badgeLt('OFF', 'bad')) : '\u2014'],
          ])) + '</div>';
          systemBody += '</div>';

          var defsBody = '';
          try {
            if (trackerDefinitions && typeof trackerDefinitions === 'object') {
              defsBody = cardSm('Tracker definitions (raw)', '<pre class="mb-0 small">' + escapeHtml(JSON.stringify(trackerDefinitions, null, 2)) + '</pre>');
            } else {
              defsBody = '<div class="text-secondary">No tracker definitions available from server.</div>';
            }
          } catch (_) {
            defsBody = '<div class="text-secondary">No tracker definitions available from server.</div>';
          }

          var advancedBody = '';
          advancedBody += '<div class="d-flex align-items-center gap-2 flex-wrap">';
          advancedBody +=   '<button type="button" id="be-copy-ai-btn" class="btn btn-outline-secondary btn-sm" title="Copy a detailed diagnostics payload for AI">' + copyIcon + ' Copy AI debug</button>';
          advancedBody +=   '<button type="button" id="be-download-ai-json-btn" class="btn btn-outline-secondary btn-sm" title="Download diagnostics JSON for AI"><i class="fa-light fa-download" aria-hidden="true"></i> Download JSON</button>';
          advancedBody +=   '<span id="be-copy-ai-msg" class="form-hint ms-2"></span>';
          advancedBody += '</div>';
          advancedBody += '<div class="text-secondary small mt-2">Generated at ' + escapeHtml(aiCopyGeneratedAt) + '.</div>';

          var html = '';
          html += '<div class="accordion settings-layout-accordion" id="settings-diagnostics-accordion">';
          html += accordionItem('overview', 'Overview', overviewBody);
          html += accordionItem('sales', 'Sales', salesBody);
          html += accordionItem('traffic', 'Traffic', trafficBody);
          html += accordionItem('pixel', 'Pixel', pixelBody);
          html += accordionItem('shopify', 'Shopify', shopifyBody);
          html += accordionItem('googleads', 'Google Ads', googleAdsBody);
          html += accordionItem('system', 'System', systemBody);
          html += accordionItem('definitions', 'Definitions', defsBody);
          html += accordionItem('advanced', 'Advanced', advancedBody);
          html += '</div>';

          var targetEl = document.getElementById('diagnostics-content');
          if (diagnosticsStepEl) diagnosticsStepEl.textContent = 'Building diagnostics panel';
          if (targetEl) targetEl.innerHTML = html;

          // Preserve scroll position when refreshing while the modal is already open.
          try {
            if (preserveView && modalCardEl) modalCardEl.scrollTop = prevModalScrollTop;
          } catch (_) {}
          try {
            const compareIsOpenNow = !!(compareModalEl && compareModalEl.classList.contains('open'));
            if (compareIsOpenNow && compareStatusEl) {
              const updatedAtMs = (c && typeof c.now === 'number' && isFinite(c.now)) ? c.now : Date.now();

              function kickerForKey(key) {
                const k = key ? String(key).trim().toLowerCase() : '';
                if (k === 'sessions') return 'Sessions';
                if (k === 'aov') return 'AOV';
                return 'Conversion rate';
              }

              const compareKey = activeKpiCompareKey ? String(activeKpiCompareKey).trim().toLowerCase() : 'conv';
              if (compareKickerEl) compareKickerEl.textContent = kickerForKey(compareKey);

              function compareMetric(label, valueHtml) {
                return (
                  '<div class="kpi-compare-metric">' +
                    '<div class="kpi-compare-metric-label">' + escapeHtml(label) + '</div>' +
                    '<div class="kpi-compare-metric-value">' + (valueHtml || '\u2014') + '</div>' +
                  '</div>'
                );
              }
              function compareBrand(name, logoUrl, sub, rightHtml) {
                const right = rightHtml ? String(rightHtml) : '';
                return (
                  '<div class="kpi-compare-brand">' +
                    '<div class="kpi-compare-brand-left">' +
                      '<img class="kpi-compare-brand-icon" src="' + escapeHtml(String(logoUrl || '')) + '" width="28" height="28" alt="" aria-hidden="true" decoding="async" />' +
                      '<div class="kpi-compare-brand-text">' +
                        '<div class="kpi-compare-brand-name">' + escapeHtml(name || '') + '</div>' +
                        '<div class="kpi-compare-brand-sub">' + escapeHtml(sub || '') + '</div>' +
                      '</div>' +
                    '</div>' +
                    (right ? ('<div class="kpi-compare-brand-right">' + right + '</div>') : '') +
                  '</div>'
                );
              }
              function inlineMetric(label, valueHtml) {
                return (
                  '<span class="kpi-compare-inline-metric">' +
                    '<span class="kpi-compare-inline-label">' + escapeHtml(label || '') + '</span>' +
                    '<span class="kpi-compare-inline-value">' + (valueHtml || '\u2014') + '</span>' +
                  '</span>'
                );
              }

              function fmtSignedCount(v) {
                if (typeof v !== 'number' || !isFinite(v)) return '';
                const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
                return sign + formatSessions(Math.abs(v));
              }
              function fmtSignedMoney(v) {
                if (typeof v !== 'number' || !isFinite(v)) return '';
                const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
                return sign + formatRevenue(Math.abs(v));
              }
              function fmtSignedPp(v) {
                if (typeof v !== 'number' || !isFinite(v)) return '';
                const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
                const abs = Math.abs(v);
                const s = (Math.round(abs * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
                return sign + s + 'pp';
              }
              function safeAov(revenue, orders) {
                if (typeof revenue !== 'number' || !isFinite(revenue)) return null;
                if (typeof orders !== 'number' || !isFinite(orders) || orders <= 0) return null;
                return revenue / orders;
              }

              const botsTaggedToday = (traffic && traffic.today && typeof traffic.today.botSessionsTagged === 'number')
                ? traffic.today.botSessionsTagged
                : null;
              const totalTrafficEstToday = (traffic && traffic.today && typeof traffic.today.totalTrafficEst === 'number')
                ? traffic.today.totalTrafficEst
                : null;
              const sessionsReachedAppToday = (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number')
                ? traffic.today.sessionsReachedApp
                : null;

              const truthAov = safeAov(truthRevenue, truthOrders);
              const pixelAov = safeAov(pixelDerivedRevenue, pixelDerivedOrders);

              let diffText = '';
              if (compareKey === 'sessions') {
                const d = (kexoSessionsToday != null && shopifySessionsToday != null) ? (kexoSessionsToday - shopifySessionsToday) : null;
                diffText = (d != null) ? ('Δ Sessions ' + fmtSignedCount(d)) : '';
              } else if (compareKey === 'aov') {
                const d = (pixelAov != null && truthAov != null) ? (pixelAov - truthAov) : null;
                diffText = (d != null) ? ('Δ AOV ' + fmtSignedMoney(d)) : '';
              } else {
                const d = (kexoCr != null && shopifyCr != null) ? (kexoCr - shopifyCr) : null;
                diffText = (d != null) ? ('Δ CR ' + fmtSignedPp(d)) : '';
              }

              if (compareUpdatedEl) {
                compareUpdatedEl.textContent = 'Updated ' + formatTs(updatedAtMs) + (diffText ? (' · ' + diffText) : '');
              }

              const ordersHtml = (truthOrders != null) ? escapeHtml(String(truthOrders)) : '\u2014';
              const pixelOrdersHtml = (pixelDerivedOrders != null) ? escapeHtml(String(pixelDerivedOrders)) : '\u2014';
              const missingEvidenceHtml = (typeof missingEvidenceCount === 'number' && isFinite(missingEvidenceCount)) ? escapeHtml(String(missingEvidenceCount)) : '\u2014';
              const evidenceHtml = (typeof evTotal === 'number' && isFinite(evTotal)) ? escapeHtml(String(evTotal)) : '\u2014';

              let cmpHtml = '';
              cmpHtml += '<div class="kpi-compare-grid">';

              if (compareKey === 'sessions') {
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'ShopifyQL sessions', inlineMetric('Sessions', fmtSessions(shopifySessionsToday)));
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Human sessions', inlineMetric('Sessions', fmtSessions(kexoSessionsToday)));
                cmpHtml +=   '</div>';
              } else if (compareKey === 'aov') {
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'Paid truth orders', inlineMetric('AOV', fmtRevenue(truthAov)));
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card kpi-compare-card--simple">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Pixel purchases (deduped)', inlineMetric('AOV', fmtRevenue(pixelAov)));
                cmpHtml +=   '</div>';
              } else {
                cmpHtml +=   '<div class="kpi-compare-card">';
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'ShopifyQL sessions · conversion_rate');
                cmpHtml +=     '<div class="kpi-compare-metrics">' +
                                 compareMetric('CR% (Shopify)', fmtPct(shopifyCr)) +
                                 compareMetric('Sessions (today)', fmtSessions(shopifySessionsToday)) +
                                 compareMetric('Orders (paid)', ordersHtml) +
                                 compareMetric('Revenue (paid)', fmtRevenue(truthRevenue)) +
                               '</div>';
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Human sessions · bot signals');
                cmpHtml +=     '<div class="kpi-compare-metrics">' +
                                 compareMetric('CR% (truth)', fmtPct(kexoCr)) +
                                 compareMetric('Sessions (human, today)', fmtSessions(kexoSessionsToday)) +
                                 compareMetric('Bots blocked (today)', botsBlockedToday != null ? fmtSessions(botsBlockedToday) : '\u2014') +
                                 compareMetric('Bot-tagged (today)', botsTaggedToday != null ? fmtSessions(botsTaggedToday) : '\u2014') +
                               '</div>';
                cmpHtml +=   '</div>';
              }

              cmpHtml += '</div>';

              if (compareStepEl) compareStepEl.textContent = 'Building comparison view';
              compareStatusEl.innerHTML = cmpHtml;
            }
          } catch (_) {}
          try { renderTrafficPickers(trafficCache || null); } catch (_) {}
          // On Settings page: trafficCache is never populated (no modal open). Fetch and populate Channels/Device pickers.
          if (configStatusEl && configStatusEl.id === 'diagnostics-content') {
            try {
              if (document.getElementById('traffic-sources-picker') || document.getElementById('traffic-types-picker')) {
                fetchTrafficData({ force: true }).then(function(data) {
                  try { renderTrafficPickers(data || null); } catch (_) {}
                }).catch(function() {});
              }
            } catch (_) {}
          }
          try {
            const btn = document.getElementById('be-copy-ai-btn');
            const downloadBtn = document.getElementById('be-download-ai-json-btn');
            const msg = document.getElementById('be-copy-ai-msg');
            function setMsg(t, ok) {
              if (!msg) return;
              msg.textContent = t || '';
              msg.classList.remove('text-success', 'text-danger');
              msg.classList.add(ok ? 'text-success' : 'text-danger');
            }
            function fallbackCopy(t) {
              const ta = document.createElement('textarea');
              ta.value = t;
              ta.setAttribute('readonly', 'readonly');
              ta.style.position = 'fixed';
              ta.style.top = '-9999px';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              ta.setSelectionRange(0, ta.value.length);
              const ok = document.execCommand('copy');
              document.body.removeChild(ta);
              return ok;
            }
            if (btn) {
              btn.onclick = function() {
                const text = aiCopyText || '';
                try {
                  if (!text) {
                    setMsg('Nothing to copy', false);
                    return;
                  }
                  setMsg('Copying…', true);
                  if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                    navigator.clipboard.writeText(text)
                      .then(function() { setMsg('Copied (' + text.length + ' chars)', true); })
                      .catch(function(err) {
                        const ok = fallbackCopy(text);
                        if (ok) setMsg('Copied (' + text.length + ' chars)', true);
                        else setMsg('Copy failed: ' + (err && err.message ? String(err.message) : 'error'), false);
                      });
                  } else {
                    const ok = fallbackCopy(text);
                    if (ok) setMsg('Copied (' + text.length + ' chars)', true);
                    else setMsg('Copy failed', false);
                  }
                } catch (err) {
                  setMsg('Copy failed: ' + (err && err.message ? String(err.message) : 'error'), false);
                }
              };
            }
            if (downloadBtn) {
              downloadBtn.onclick = function() {
                try {
                  if (!aiPayloadData || typeof aiPayloadData !== 'object') {
                    setMsg('No JSON payload to download', false);
                    return;
                  }
                  var shopSafe = (shopify && shopify.shop) ? String(shopify.shop).replace(/[^a-z0-9.-]+/gi, '_') : 'shop';
                  var stamp = aiCopyGeneratedAt.replace(/[:.]/g, '-');
                  var filename = 'kexo-diagnostics-' + shopSafe + '-' + stamp + '.json';
                  var json = JSON.stringify(aiPayloadData, null, 2);
                  var blob = new Blob([json], { type: 'application/json;charset=utf-8' });
                  var url = URL.createObjectURL(blob);
                  var a = document.createElement('a');
                  a.href = url;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  setMsg('Downloaded ' + filename, true);
                } catch (err) {
                  setMsg('Download failed: ' + (err && err.message ? String(err.message) : 'error'), false);
                }
              };
            }
          } catch (_) {}
          try {
            function setGaMsg(t, ok) {
              const msgEl = document.getElementById('ga-msg');
              if (!msgEl) return;
              msgEl.textContent = t || '';
              msgEl.classList.remove('text-success', 'text-danger');
              msgEl.classList.add(ok ? 'text-success' : 'text-danger');
            }
            function setGaOutput(obj) {
              const outEl = document.getElementById('ga-output');
              if (!outEl) return;
              try { outEl.textContent = JSON.stringify(obj, null, 2); }
              catch (_) { outEl.textContent = String(obj || ''); }
            }
            function fetchJson(url, options) {
              return fetch(url, options || { credentials: 'same-origin', cache: 'no-store' })
                .then(function(r) {
                  return r.text().then(function(t) {
                    let j = null;
                    try { j = t ? JSON.parse(t) : null; } catch (_) {}
                    return { ok: r.ok, status: r.status, json: j, text: t };
                  });
                });
            }
            const statusBtn = document.getElementById('ga-status-btn');
            const summaryBtn = document.getElementById('ga-summary-btn');
            const refresh7dBtn = document.getElementById('ga-refresh-7d-btn');
            const refreshMonthBtn = document.getElementById('ga-refresh-month-btn');
            if (statusBtn) {
              statusBtn.onclick = function() {
                setGaMsg('Fetching status…', true);
                fetchJson((API || '') + '/api/ads/status', { credentials: 'same-origin', cache: 'no-store' })
                  .then(function(r) {
                    setGaOutput({ endpoint: 'GET /api/ads/status', status: r.status, ok: r.ok, body: r.json || r.text });
                    setGaMsg(r.ok ? 'Status OK' : ('Status error ' + r.status), r.ok);
                  })
                  .catch(function(err) {
                    setGaOutput({ endpoint: 'GET /api/ads/status', error: err && err.message ? String(err.message) : 'request_failed' });
                    setGaMsg('Status request failed', false);
                  });
              };
            }
            if (summaryBtn) {
              summaryBtn.onclick = function() {
                setGaMsg('Fetching summary…', true);
                fetchJson((API || '') + '/api/ads/summary?range=7d', { credentials: 'same-origin', cache: 'no-store' })
                  .then(function(r) {
                    setGaOutput({ endpoint: 'GET /api/ads/summary?range=7d', status: r.status, ok: r.ok, body: r.json || r.text });
                    setGaMsg(r.ok ? 'Summary OK' : ('Summary error ' + r.status), r.ok);
                  })
                  .catch(function(err) {
                    setGaOutput({ endpoint: 'GET /api/ads/summary?range=7d', error: err && err.message ? String(err.message) : 'request_failed' });
                    setGaMsg('Summary request failed', false);
                  });
              };
            }
            function doRefresh(rangeKey) {
              setGaMsg('Refreshing ' + rangeKey + '…', true);
              fetchJson((API || '') + '/api/ads/refresh?range=' + encodeURIComponent(rangeKey), {
                method: 'POST',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'googleads' }),
              })
                .then(function(r) {
                  setGaOutput({ endpoint: 'POST /api/ads/refresh?range=' + rangeKey, status: r.status, ok: r.ok, body: r.json || r.text });
                  setGaMsg(r.ok ? ('Refresh ' + rangeKey + ' OK') : ('Refresh error ' + r.status), r.ok);
                })
                .catch(function(err) {
                  setGaOutput({ endpoint: 'POST /api/ads/refresh?range=' + rangeKey, error: err && err.message ? String(err.message) : 'request_failed' });
                  setGaMsg('Refresh request failed', false);
                });
            }
            if (refresh7dBtn) refresh7dBtn.onclick = function() { doRefresh('7d'); };
            if (refreshMonthBtn) refreshMonthBtn.onclick = function() { doRefresh('month'); };
          } catch (_) {}
          try {
            const toggle = document.getElementById('pixel-session-mode-toggle');
            const msgEl = document.getElementById('pixel-session-mode-msg');
            if (toggle) {
              toggle.onchange = function() {
                const enabled = !!toggle.checked;
                const nextMode = enabled ? 'shared_ttl' : 'legacy';
                toggle.disabled = true;
                if (msgEl) msgEl.textContent = 'Saving…';
                fetch(API + '/api/settings', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin',
                  cache: 'no-store',
                  body: JSON.stringify({ pixelSessionMode: nextMode }),
                })
                  .then(function(r) {
                    if (r.ok) return r.json();
                    return r.json().catch(function() { return null; }).then(function(j) {
                      const msg = j && j.error ? String(j.error) : ('HTTP ' + r.status);
                      throw new Error(msg);
                    });
                  })
                  .then(function() {
                    const shop = getShopParam();
                    if (shop && /\.myshopify\.com$/i.test(shop)) {
                      if (msgEl) msgEl.textContent = 'Saved. Syncing pixel settings…';
                      return fetch(API + '/api/pixel/ensure?shop=' + encodeURIComponent(shop), { credentials: 'same-origin', cache: 'no-store' })
                        .then(function(r) { return r.ok ? r.json() : null; })
                        .catch(function() { return null; });
                    }
                    return null;
                  })
                  .then(function() {
                    if (msgEl) msgEl.textContent = 'Saved. Applies on next page view.';
                  })
                  .catch(function(err) {
                    if (msgEl) {
                      msgEl.textContent = 'Save failed: ' + (err && err.message ? String(err.message).slice(0, 140) : 'error');
                    }
                  })
                  .finally(function() {
                    toggle.disabled = false;
                    // Refresh diagnostics so the UI reflects the saved setting.
                    try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
                  });
              };
            }
          } catch (_) {}
          if (typeof evidenceToday !== 'undefined' && typeof evidenceToday.lastOccurredAt === 'number') {
            setLastSaleAt(evidenceToday.lastOccurredAt);
          }
          if (options && options.force) {
            setDiagnosticsActionMsg('Diagnostics refreshed at ' + formatTs(Date.now()), true);
          }
          return c;
        })
        .catch(() => {
          const errEl = document.getElementById('diagnostics-content');
          if (errEl) {
            errEl.innerHTML = '<div class="alert alert-danger mb-0">Could not load diagnostics.</div>';
          }
          try {
            const compareIsOpenNow = !!(compareModalEl && compareModalEl.classList.contains('open'));
            if (compareIsOpenNow && compareStatusEl) {
              compareStatusEl.innerHTML =
                '<div class="kpi-compare-error">' +
                  '<div class="kpi-compare-error-title">Error</div>' +
                  '<div class="kpi-compare-error-body">Could not load comparison.</div>' +
                '</div>';
              if (compareUpdatedEl) compareUpdatedEl.textContent = 'Update failed';
            }
          } catch (_) {}
          if (options && options.force) {
            setDiagnosticsActionMsg('Diagnostics refresh failed.', false);
          }
        })
        .finally(function() {
          if (refreshBtn) refreshBtn.classList.remove('spinning');
          if (compareRefreshBtn) compareRefreshBtn.classList.remove('spinning');
          if (configStatusRefreshInFlight === p) configStatusRefreshInFlight = null;
        });
      configStatusRefreshInFlight = p;
      return p;
    }
    try { window.refreshConfigStatus = refreshConfigStatus; } catch (_) {}
    try { window.initTrafficSourceMapping = function(opts) { initTrafficSourceMappingPanel(opts || {}); }; } catch (_) {}

    // Best-effort: prime Diagnostics data in the background for Settings.
    try { refreshConfigStatus(); } catch (_) {}

    updateLastSaleAgo();
    _intervals.push(setInterval(updateLastSaleAgo, 10000));

    (function initDiagnosticsActions() {
      const openBtn = document.getElementById('config-open-btn');
      const refreshBtn = document.getElementById('config-refresh-btn');
      const reconcileBtn = document.getElementById('config-reconcile-btn');
      if (refreshBtn) refreshBtn.addEventListener('click', function() {
        setDiagnosticsActionMsg('Refreshing diagnostics…', true);
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      });
      if (reconcileBtn) reconcileBtn.addEventListener('click', function() { try { reconcileSalesTruth({}); } catch (_) {} });
      if (openBtn && openBtn.tagName === 'A') {
        try { openBtn.setAttribute('href', '/settings'); } catch (_) {}
      }
    })();

    (function initKpiCompareModal() {
      const modal = document.getElementById('kpi-compare-modal');
      const refreshBtn = document.getElementById('kpi-compare-refresh-btn');
      const closeBtn = document.getElementById('kpi-compare-close-btn');
      const kickerEl = document.getElementById('kpi-compare-kicker');
      if (!modal) return;

      function kickerForKey(key) {
        const k = key ? String(key).trim().toLowerCase() : '';
        if (k === 'sessions') return 'Sessions';
        if (k === 'aov') return 'AOV';
        return 'Conversion rate';
      }

      function open(key) {
        activeKpiCompareKey = key ? String(key).trim().toLowerCase() : 'conv';
        if (kickerEl) kickerEl.textContent = kickerForKey(activeKpiCompareKey);
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      }
      function close() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }

      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('.kpi-compare-open-btn[data-kpi-compare]') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const key = (btn.getAttribute('data-kpi-compare') || '').trim().toLowerCase();
        open(key || 'conv');
      });

      if (refreshBtn) refreshBtn.addEventListener('click', function() { try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {} });
      if (closeBtn) closeBtn.addEventListener('click', close);
      modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (!modal.classList.contains('open')) return;
        close();
      });
    })();

    (function initBusinessSnapshotModal() {
      if (window.__businessSnapshotModalInit) return;
      window.__businessSnapshotModalInit = true;

      const openBtn = document.getElementById('kexo-business-snapshot-btn');
      if (!openBtn) return;

      let snapshotModal = null;
      let rulesModal = null;
      let selectedYear = String((new Date()).getFullYear());
      let rulesDraft = null;
      let editingRuleId = '';
      let snapshotLoading = false;
      let snapshotRequestSeq = 0;
      let snapshotActiveRequest = 0;
      let backdropEl = null;
      let backdropCount = 0;

      function isIsoCountryCode(code) {
        return /^[A-Z]{2}$/.test(String(code || '').trim().toUpperCase());
      }

      function normalizeCountryCode(code) {
        const raw = String(code || '').trim().toUpperCase().slice(0, 2);
        if (!raw) return '';
        const fixed = raw === 'UK' ? 'GB' : raw;
        return isIsoCountryCode(fixed) ? fixed : '';
      }

      function createRuleId() {
        return 'rule_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      }

      function modalVisible(el) {
        return !!(el && el.classList && el.classList.contains('show') && el.getAttribute('aria-hidden') !== 'true');
      }

      function updateBodyModalOpenClass() {
        const anyOpen = modalVisible(snapshotModal) || modalVisible(rulesModal);
        document.body.classList.toggle('modal-open', anyOpen);
      }

      function ensureBackdrop() {
        if (backdropEl && backdropEl.parentNode) return backdropEl;
        const el = document.createElement('div');
        el.className = 'modal-backdrop fade show business-snapshot-backdrop';
        el.setAttribute('aria-hidden', 'true');
        el.addEventListener('click', function () {
          try {
            if (modalVisible(rulesModal)) closeModal(rulesModal);
            else if (modalVisible(snapshotModal)) closeModal(snapshotModal);
          } catch (_) {}
        });
        document.body.appendChild(el);
        backdropEl = el;
        return el;
      }

      function updateBackdrop() {
        const anyOpen = modalVisible(snapshotModal) || modalVisible(rulesModal);
        if (!anyOpen) {
          try { backdropEl && backdropEl.remove && backdropEl.remove(); } catch (_) {}
          backdropEl = null;
          backdropCount = 0;
          return;
        }
        const el = ensureBackdrop();
        try { el.classList.toggle('is-dark', modalVisible(rulesModal)); } catch (_) {}
      }

      function openModal(el) {
        if (!el) return;
        backdropCount += 1;
        el.style.display = 'block';
        el.classList.add('show');
        el.setAttribute('aria-hidden', 'false');
        updateBodyModalOpenClass();
        updateBackdrop();
      }

      function closeModal(el) {
        if (!el) return;
        el.classList.remove('show');
        el.setAttribute('aria-hidden', 'true');
        el.style.display = 'none';
        try { if (el === snapshotModal) destroySnapshotCharts(); } catch (_) {}
        backdropCount = Math.max(0, backdropCount - 1);
        updateBodyModalOpenClass();
        updateBackdrop();
      }

      function fmtCurrency(value) {
        const n = value == null ? null : Number(value);
        if (n == null || !Number.isFinite(n)) return 'Unavailable';
        return formatRevenue(n) || 'Unavailable';
      }

      function fmtCount(value) {
        const n = value == null ? null : Number(value);
        if (n == null || !Number.isFinite(n)) return 'Unavailable';
        return formatSessions(Math.round(n));
      }

      function fmtPercent(value) {
        const n = value == null ? null : Number(value);
        if (n == null || !Number.isFinite(n)) return 'Unavailable';
        return n.toFixed(1).replace(/\.0$/, '') + '%';
      }

      function getCurrentYearString() {
        return String((new Date()).getFullYear());
      }

      function deltaInfo(current, previous) {
        const cur = current == null ? null : Number(current);
        const prev = previous == null ? null : Number(previous);
        if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
        const pct = ((cur - prev) / Math.abs(prev)) * 100;
        if (!Number.isFinite(pct)) return null;
        const rounded = Math.round(pct * 10) / 10;
        const dir = rounded > 0 ? 'up' : (rounded < 0 ? 'down' : 'flat');
        const sign = rounded > 0 ? '+' : '';
        const short = sign + rounded.toFixed(1).replace(/\.0$/, '') + '%';
        return {
          dir,
          pct: rounded,
          short,
          text: short,
        };
      }

      function deltaIconKey(dir) {
        if (dir === 'up') return 'dash-kpi-delta-up';
        if (dir === 'down') return 'dash-kpi-delta-down';
        return 'dash-kpi-delta-flat';
      }

      function deltaHtml(delta) {
        if (!delta || !delta.short) return '';
        const dir = delta.dir === 'up' ? 'up' : (delta.dir === 'down' ? 'down' : 'flat');
        const iconKey = deltaIconKey(dir);
        const cls = dir === 'up' ? 'is-up' : (dir === 'down' ? 'is-down' : 'is-flat');
        const iconCls = dir === 'up' ? 'fa-arrow-trend-up' : (dir === 'down' ? 'fa-arrow-trend-down' : 'fa-minus');
        return '' +
          '<div class="business-snapshot-card-delta business-snapshot-delta ' + cls + '" title="vs previous period">' +
            '<i class="fa-light ' + iconCls + '" data-icon-key="' + escapeHtml(iconKey) + '" aria-hidden="true"></i>' +
            '<span class="business-snapshot-delta-text">' + escapeHtml(delta.short) + '</span>' +
          '</div>';
      }

      let snapshotCharts = {};
      let snapshotChartsSeq = 0;
      let snapshotApexLoading = false;
      let snapshotApexWaiters = [];

      function ensureSnapshotApexCharts(cb) {
        if (typeof ApexCharts !== 'undefined') { cb(); return; }
        snapshotApexWaiters.push(cb);
        if (snapshotApexLoading) return;
        snapshotApexLoading = true;
        try {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/apexcharts@4.7.0/dist/apexcharts.min.js';
          s.defer = true;
          s.onload = function () {
            snapshotApexLoading = false;
            const q = snapshotApexWaiters.slice();
            snapshotApexWaiters = [];
            q.forEach(function (fn) { try { fn(); } catch (_) {} });
          };
          s.onerror = function () { snapshotApexLoading = false; snapshotApexWaiters = []; };
          document.head.appendChild(s);
        } catch (_) {
          snapshotApexLoading = false;
          snapshotApexWaiters = [];
        }
      }

      function destroySnapshotCharts() {
        try {
          Object.keys(snapshotCharts || {}).forEach(function (k) {
            const ch = snapshotCharts[k];
            if (!ch) return;
            try { ch.destroy(); } catch (_) {}
          });
        } catch (_) {}
        snapshotCharts = {};
      }

      function snapshotPrimaryColor() {
        try {
          const rgb = getComputedStyle(document.documentElement).getPropertyValue('--tblr-primary-rgb').trim() || '32,107,196';
          return 'rgb(' + rgb + ')';
        } catch (_) {
          return '#206bc4';
        }
      }

      function normalizeSeriesNumbers(dataArr) {
        const src = Array.isArray(dataArr) ? dataArr : [];
        const nums = src.map(function (v) {
          if (v == null) return null;
          const n = (typeof v === 'number') ? v : Number(v);
          return (typeof n === 'number' && isFinite(n)) ? n : null;
        });
        // Apex sparkline dislikes 1-point series.
        if (nums.length === 1) return [nums[0], nums[0]];
        return nums;
      }

      function renderSnapshotSparkline(elId, dataArr, opts) {
        if (typeof ApexCharts === 'undefined') return;
        const el = document.getElementById(elId);
        if (!el) return;
        const options = opts && typeof opts === 'object' ? opts : {};
        // Snapshot sparklines are line-only (no bar/area fill).
        const chartType = 'line';
        const color = options.color || snapshotPrimaryColor();
        const height = Number.isFinite(Number(options.height)) ? Number(options.height) : 56;

        let nums = normalizeSeriesNumbers(dataArr);
        if (!nums.length) return;
        // Replace nulls with 0 for smooth sparklines.
        nums = nums.map(function (v) { return v == null ? 0 : v; });

        // Destroy any existing instance for this element.
        if (snapshotCharts[elId]) { try { snapshotCharts[elId].destroy(); } catch (_) {} }
        el.innerHTML = '';

        const base = {
          chart: { type: chartType, height: height, sparkline: { enabled: true }, animations: { enabled: false } },
          series: [{ name: 'Trend', data: nums }],
          colors: [color],
          tooltip: { enabled: false },
          grid: { padding: { top: 0, right: 0, bottom: -3, left: 0 } },
          dataLabels: { enabled: false },
        };

        const apexOpts = Object.assign({}, base, {
          stroke: { width: 2.55, curve: 'smooth', lineCap: 'round' },
          fill: { type: 'solid', opacity: 0 },
          markers: { size: 0 },
        });

        function doRender() {
          try {
            const chart = new ApexCharts(el, apexOpts);
            chart.render();
            snapshotCharts[elId] = chart;
          } catch (_) {}
        }
        if (typeof window.kexoWaitForContainerDimensions === 'function') {
          window.kexoWaitForContainerDimensions(el, doRender);
        } else { doRender(); }
      }

      function renderSnapshotRadial(elId, pct, opts) {
        if (typeof ApexCharts === 'undefined') return;
        const el = document.getElementById(elId);
        if (!el) return;
        const options = opts && typeof opts === 'object' ? opts : {};
        const color = options.color || snapshotPrimaryColor();
        const height = Number.isFinite(Number(options.height)) ? Number(options.height) : 72;
        const v = (typeof pct === 'number') ? pct : Number(pct);
        if (!isFinite(v)) return;
        const clamped = Math.max(0, Math.min(100, v));

        if (snapshotCharts[elId]) { try { snapshotCharts[elId].destroy(); } catch (_) {} }
        el.innerHTML = '';

        try {
          const chart = new ApexCharts(el, {
            chart: { type: 'radialBar', height: height, sparkline: { enabled: true }, animations: { enabled: false } },
            series: [clamped],
            colors: [color],
            plotOptions: {
              radialBar: {
                hollow: { size: '60%' },
                track: { background: 'rgba(24,36,51,0.08)' },
                dataLabels: {
                  name: { show: false },
                  value: {
                    show: true,
                    fontSize: '12px',
                    fontWeight: 500,
                    formatter: function (val) { return Math.round(val) + '%'; },
                    offsetY: 4,
                  }
                },
              }
            },
            stroke: { lineCap: 'round' },
            tooltip: { enabled: false },
          });
          chart.render();
          snapshotCharts[elId] = chart;
        } catch (_) {}
      }

      function renderSnapshotCharts(data, seq) {
        const payload = data && typeof data === 'object' ? data : {};
        const series = payload.series && typeof payload.series === 'object' ? payload.series : {};
        const labelsYmd = Array.isArray(series.labelsYmd) ? series.labelsYmd : [];
        const revenue = Array.isArray(series.revenueGbp) ? series.revenueGbp : [];
        const cost = Array.isArray(series.costGbp) ? series.costGbp : [];
        const orders = Array.isArray(series.orders) ? series.orders : [];
        const sessions = Array.isArray(series.sessions) ? series.sessions : [];
        const conv = Array.isArray(series.conversionRate) ? series.conversionRate : [];
        const aov = Array.isArray(series.aov) ? series.aov : [];

        const f = payload.financial || {};
        const perf = payload.performance || {};
        const c = payload.customers || {};
        const profit = f.profit || {};

        const marginPct = profit && profit.marginPct && Number.isFinite(Number(profit.marginPct.value)) ? Number(profit.marginPct.value) : null;
        const estProfitVal = profit && profit.estimatedProfit && Number.isFinite(Number(profit.estimatedProfit.value)) ? Number(profit.estimatedProfit.value) : null;
        const netProfitVal = profit && profit.netProfit && Number.isFinite(Number(profit.netProfit.value)) ? Number(profit.netProfit.value) : null;
        const deductionsVal = profit && profit.deductions && Number.isFinite(Number(profit.deductions.value)) ? Number(profit.deductions.value) : null;
        const revenueVal = f.revenue && Number.isFinite(Number(f.revenue.value)) ? Number(f.revenue.value) : null;
        const estRatio = (Number.isFinite(estProfitVal) && Number.isFinite(revenueVal) && revenueVal > 0) ? (estProfitVal / revenueVal) : null;
        const netRatio = (Number.isFinite(netProfitVal) && Number.isFinite(revenueVal) && revenueVal > 0) ? (netProfitVal / revenueVal) : null;
        const estSeries = (Number.isFinite(estRatio) && revenue.length) ? revenue.map(function (v) { const n = Number(v); return Number.isFinite(n) ? n * estRatio : 0; }) : [];
        const netSeries = (Number.isFinite(netRatio) && revenue.length) ? revenue.map(function (v) { const n = Number(v); return Number.isFinite(n) ? n * netRatio : 0; }) : [];
        const deductionsSeries = (estSeries.length && revenue.length === estSeries.length) ? revenue.map(function (v, i) {
          const r = Number(v);
          const p = Number(estSeries[i]);
          if (!Number.isFinite(r) || !Number.isFinite(p)) return 0;
          return Math.max(0, r - p);
        }) : [];

        function snapshotTrendColor(dir) {
          const d = String(dir || '').toLowerCase();
          function cssVar(name, fallback) {
            try {
              const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
              return v || fallback;
            } catch (_) {
              return fallback;
            }
          }
          // Only use the KEXO accent scheme for KPI colors.
          // Mapping:
          // - up/growth:   accent-3
          // - down/loss:   accent-4
          // - flat/stable: accent-2
          if (d === 'up') return cssVar('--kexo-accent-3', '#f59e34');
          if (d === 'down') return cssVar('--kexo-accent-4', '#e4644b');
          return cssVar('--kexo-accent-2', '#3eb3ab');
        }

        function trendColorForDelta(delta) {
          const d = delta && delta.dir ? String(delta.dir) : 'flat';
          return snapshotTrendColor(d);
        }

        function sparkLine(id, dataArr, delta) {
          renderSnapshotSparkline(id, dataArr, { type: 'line', color: trendColorForDelta(delta), height: 56 });
        }

        function ensureIsoCategories(labels) {
          const src = Array.isArray(labels) ? labels : [];
          const cats = src.map(function (ymd) {
            const d = String(ymd || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
            return d + 'T00:00:00.000Z';
          }).filter(Boolean);
          if (cats.length === 1) {
            // ApexCharts doesn't love a single-point datetime category set.
            try {
              const t = Date.parse(cats[0]);
              if (Number.isFinite(t)) {
                cats.push(new Date(t + 24 * 60 * 60 * 1000).toISOString());
              } else {
                cats.push(cats[0]);
              }
            } catch (_) {
              cats.push(cats[0]);
            }
          }
          return cats;
        }

        function expandToCategoriesLen(arr, targetLen) {
          const src = Array.isArray(arr) ? arr : [];
          if (src.length === targetLen) return src;
          if (!src.length) return Array(targetLen).fill(0);
          if (src.length === 1 && targetLen >= 2) return Array(targetLen).fill(src[0]);
          // Best-effort: pad/truncate.
          const out = src.slice(0, targetLen);
          while (out.length < targetLen) out.push(out[out.length - 1]);
          return out;
        }

        function renderSnapshotRevenueCostChart(elId, labels, revenueArr, costArr) {
          if (typeof ApexCharts === 'undefined') return;
          const el = document.getElementById(elId);
          if (!el) return;
          const categories = ensureIsoCategories(labels);
          if (!categories.length) return;

          const revNums = (normalizeSeriesNumbers(revenueArr) || []).map(function (v) { return v == null ? 0 : v; });
          const costNums = (normalizeSeriesNumbers(costArr) || []).map(function (v) { return v == null ? 0 : v; });
          const rev = expandToCategoriesLen(revNums, categories.length);
          const cst = expandToCategoriesLen(costNums, categories.length);

          if (snapshotCharts[elId]) { try { snapshotCharts[elId].destroy(); } catch (_) {} }
          el.innerHTML = '';

          function doRender() {
            try {
              const revenueColor = snapshotTrendColor('up');
              const costColor = snapshotTrendColor('down');
              const chart = new ApexCharts(el, {
                series: [
                  { name: 'Revenue', data: rev },
                  { name: 'Cost', data: cst },
                ],
                chart: {
                  height: 320,
                  type: 'line',
                  animations: { enabled: false },
                  toolbar: { show: false },
                },
                colors: [revenueColor, costColor],
                dataLabels: { enabled: false },
                stroke: { curve: 'smooth', width: 2.6, lineCap: 'round' },
                fill: { type: 'solid', opacity: 0 },
                markers: { size: 0 },
                xaxis: { type: 'datetime', categories },
                tooltip: { x: { format: 'dd/MM/yy' } },
                legend: { show: true, position: 'top', horizontalAlign: 'right' },
                grid: { padding: { left: 0, right: 0, top: 8, bottom: 0 } },
              });
              chart.render();
              snapshotCharts[elId] = chart;
            } catch (_) {}
          }
          if (typeof window.kexoWaitForContainerDimensions === 'function') {
            window.kexoWaitForContainerDimensions(el, doRender);
          } else { doRender(); }
        }

        ensureSnapshotApexCharts(function () {
          if (seq !== snapshotChartsSeq) return;
          renderSnapshotRevenueCostChart('business-snapshot-chart-revenue-cost', labelsYmd, revenue, cost);

          // Profit charts (line-only)
          const estDelta = deltaInfo(profit.estimatedProfit && profit.estimatedProfit.value, profit.estimatedProfit && profit.estimatedProfit.previous);
          const netDelta = deltaInfo(profit.netProfit && profit.netProfit.value, profit.netProfit && profit.netProfit.previous);
          const marginDelta = deltaInfo(profit.marginPct && profit.marginPct.value, profit.marginPct && profit.marginPct.previous);
          const deductionsDelta = deltaInfo(profit.deductions && profit.deductions.value, profit.deductions && profit.deductions.previous);
          if (estSeries.length) sparkLine('business-snapshot-chart-profit', estSeries, estDelta);
          if (netSeries.length) sparkLine('business-snapshot-chart-net-profit', netSeries, netDelta);
          if (estSeries.length) sparkLine('business-snapshot-chart-margin', estSeries, marginDelta);
          if (deductionsSeries.length) sparkLine('business-snapshot-chart-deductions-pct', deductionsSeries, deductionsDelta);

          // Performance charts
          const sessionsDelta = deltaInfo(perf.sessions && perf.sessions.value, perf.sessions && perf.sessions.previous);
          const ordersDelta = deltaInfo(perf.orders && perf.orders.value, perf.orders && perf.orders.previous);
          const convDelta = deltaInfo(perf.conversionRate && perf.conversionRate.value, perf.conversionRate && perf.conversionRate.previous);
          const aovDelta = deltaInfo(perf.aov && perf.aov.value, perf.aov && perf.aov.previous);
          sparkLine('business-snapshot-chart-sessions', sessions, sessionsDelta);
          sparkLine('business-snapshot-chart-perf-orders', orders, ordersDelta);
          sparkLine('business-snapshot-chart-perf-conversion', conv, convDelta);
          sparkLine('business-snapshot-chart-perf-aov', aov, aovDelta);

          // Customers charts (line-only)
          const repeatVal = c.repeatPurchaseRate && Number.isFinite(Number(c.repeatPurchaseRate.value)) ? Number(c.repeatPurchaseRate.value) : null;
          const ltvVal = c.ltv && Number.isFinite(Number(c.ltv.value)) ? Number(c.ltv.value) : null;
          const repeatSeries = (repeatVal != null && labelsYmd.length) ? labelsYmd.map(function () { return repeatVal; }) : [];
          const ltvSeries = (ltvVal != null && labelsYmd.length) ? labelsYmd.map(function () { return ltvVal; }) : [];
          sparkLine('business-snapshot-chart-new-share', orders, null);
          sparkLine('business-snapshot-chart-returning-share', orders, null);
          sparkLine('business-snapshot-chart-repeat-rate', repeatSeries, null);
          sparkLine('business-snapshot-chart-ltv-ratio', ltvSeries, null);
        });
      }

      function costBreakdownTooltipHtml(lines) {
        const list = Array.isArray(lines) ? lines : [];
        const rows = list
          .map(function (r) {
            const label = r && r.label != null ? String(r.label) : '';
            const amount = r && r.amountGbp != null ? Number(r.amountGbp) : NaN;
            if (!label) return '';
            const amtText = Number.isFinite(amount) ? (formatRevenue(amount) || ('£' + String(amount))) : 'Unavailable';
            return '<div class="business-snapshot-cost-row"><span>' + escapeHtml(label) + '</span><span>' + escapeHtml(amtText) + '</span></div>';
          })
          .filter(Boolean)
          .join('');
        if (!rows) {
          return '<div class="text-muted small">No cost breakdown available.</div>';
        }
        return '<div class="business-snapshot-cost-rows">' + rows + '</div>';
      }

      function revenueCostTopHtml(financial) {
        const f = financial && typeof financial === 'object' ? financial : {};
        const revMetric = f.revenue || {};
        const costMetric = f.cost || {};
        const breakdownNow = Array.isArray(f.costBreakdownNow) ? f.costBreakdownNow : [];
        const d = deltaInfo(revMetric && revMetric.value, revMetric && revMetric.previous);
        const dHtml = deltaHtml(d);
        const revenueText = fmtCurrency(revMetric && revMetric.value);
        const costText = fmtCurrency(costMetric && costMetric.value);
        const tooltipHtml = costBreakdownTooltipHtml(breakdownNow);
        return '' +
          '<div class="business-snapshot-top">' +
            '<div class="business-snapshot-top-head">' +
              '<div class="business-snapshot-top-title-row">' +
                '<div class="subheader d-flex align-items-center gap-2">' +
                  'Revenue &amp; Cost' +
                  '<span class="business-snapshot-info" tabindex="0" role="button" aria-label="Cost breakdown">' +
                    '<i class="fa-light fa-circle-info" aria-hidden="true"></i>' +
                    '<div class="business-snapshot-info-popover" role="tooltip">' + tooltipHtml + '</div>' +
                  '</span>' +
                '</div>' +
                (dHtml ? dHtml : '') +
              '</div>' +
              '<div class="business-snapshot-top-metrics">' +
                '<div class="business-snapshot-top-metric">' +
                  '<div class="text-muted small">Revenue</div>' +
                  '<div class="h2 mb-0">' + escapeHtml(revenueText || 'Unavailable') + '</div>' +
                '</div>' +
                '<div class="business-snapshot-top-metric">' +
                  '<div class="text-muted small">Cost</div>' +
                  '<div class="h2 mb-0">' + escapeHtml(costText || 'Unavailable') + '</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="business-snapshot-top-chart" id="business-snapshot-chart-revenue-cost" aria-hidden="true"></div>' +
          '</div>';
      }

      function metricCardHtml(label, valueText, delta, chart) {
        const dHtml = deltaHtml(delta);
        const c = chart && typeof chart === 'object' ? chart : null;
        const chartId = c && c.id ? String(c.id) : '';
        const chartHtml = chartId
          ? ('<div class="business-snapshot-chart" id="' + escapeHtml(chartId) + '" aria-hidden="true"></div>')
          : '';
        return '' +
          '<div class="col-12 col-md-6 col-xl-3">' +
            '<div class="card h-100 business-snapshot-card">' +
              '<div class="card-body business-snapshot-card-body">' +
                (chartHtml ? chartHtml : '') +
                '<div class="business-snapshot-card-content">' +
                  '<div class="subheader">' + escapeHtml(label) + '</div>' +
                  '<div class="h2 mb-1 business-snapshot-value">' + escapeHtml(valueText || 'Unavailable') + '</div>' +
                '</div>' +
                (dHtml ? dHtml : '') +
              '</div>' +
            '</div>' +
          '</div>';
      }

      function calloutCardHtml() {
        return '';
      }

      function renderSnapshot(data) {
        const body = document.getElementById('business-snapshot-body');
        if (!body) return;
        if (!data || data.ok !== true) {
          body.innerHTML = '' +
            '<div class="p-4">' +
              '<div class="alert alert-warning d-flex align-items-center justify-content-between gap-2 mb-0">' +
                '<div>Snapshot is unavailable right now.</div>' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" id="business-snapshot-retry-btn">Retry</button>' +
              '</div>' +
            '</div>';
          const retryBtn = document.getElementById('business-snapshot-retry-btn');
          if (retryBtn) retryBtn.addEventListener('click', function () { fetchSnapshot(true); });
          return;
        }

        const f = data.financial || {};
        const p = data.performance || {};
        const c = data.customers || {};
        const profit = f.profit || {};

        const titleEl = document.getElementById('business-snapshot-title');
        if (titleEl) {
          const name = data && data.shopName != null ? String(data.shopName).trim() : '';
          titleEl.textContent = name || 'Business Snapshot';
        }

        const subtitle = document.getElementById('business-snapshot-subtitle');
        if (subtitle) subtitle.textContent = String(data.periodLabel || '').trim() || 'Business Snapshot';

        (function updateSelectors() {
          selectedYear = String(data.year || selectedYear || getCurrentYearString());

          const yearSel = document.getElementById('business-snapshot-year');
          if (!yearSel) return;
          const years = Array.isArray(data.availableYears) ? data.availableYears.map(function (y) { return String(y); }).filter(Boolean) : [];
          const existing = Array.from(yearSel.options || []).map(function (o) { return String(o && o.value || ''); });
          const same = existing.length === years.length && existing.every(function (v, i) { return v === years[i]; });
          if (!same) {
            yearSel.innerHTML = years.map(function (y) { return '<option value="' + escapeHtml(y) + '">' + escapeHtml(y) + '</option>'; }).join('');
          }
          if (years.length && years.indexOf(selectedYear) < 0) selectedYear = years[0];
          yearSel.value = selectedYear;
        })();

        const chartSeq = ++snapshotChartsSeq;
        destroySnapshotCharts();

        const topBlock = revenueCostTopHtml(f);

        let profitCards = '';
        if (profit.visible) {
          profitCards += metricCardHtml('Estimated Profit', fmtCurrency(profit.estimatedProfit && profit.estimatedProfit.value), deltaInfo(profit.estimatedProfit && profit.estimatedProfit.value, profit.estimatedProfit && profit.estimatedProfit.previous), { id: 'business-snapshot-chart-profit' });
          profitCards += metricCardHtml('Net Profit', fmtCurrency(profit.netProfit && profit.netProfit.value), deltaInfo(profit.netProfit && profit.netProfit.value, profit.netProfit && profit.netProfit.previous), { id: 'business-snapshot-chart-net-profit' });
          profitCards += metricCardHtml('Margin %', fmtPercent(profit.marginPct && profit.marginPct.value), deltaInfo(profit.marginPct && profit.marginPct.value, profit.marginPct && profit.marginPct.previous), { id: 'business-snapshot-chart-margin' });
          profitCards += metricCardHtml('Deductions', fmtCurrency(profit.deductions && profit.deductions.value), deltaInfo(profit.deductions && profit.deductions.value, profit.deductions && profit.deductions.previous), { id: 'business-snapshot-chart-deductions-pct' });
        }

        let performanceCards = '';
        performanceCards += metricCardHtml('Sessions', fmtCount(p.sessions && p.sessions.value), deltaInfo(p.sessions && p.sessions.value, p.sessions && p.sessions.previous), { id: 'business-snapshot-chart-sessions' });
        performanceCards += metricCardHtml('Orders', fmtCount(p.orders && p.orders.value), deltaInfo(p.orders && p.orders.value, p.orders && p.orders.previous), { id: 'business-snapshot-chart-perf-orders' });
        performanceCards += metricCardHtml('Conversion Rate %', fmtPercent(p.conversionRate && p.conversionRate.value), deltaInfo(p.conversionRate && p.conversionRate.value, p.conversionRate && p.conversionRate.previous), { id: 'business-snapshot-chart-perf-conversion' });
        performanceCards += metricCardHtml('AOV', fmtCurrency(p.aov && p.aov.value), deltaInfo(p.aov && p.aov.value, p.aov && p.aov.previous), { id: 'business-snapshot-chart-perf-aov' });

        let customersCards = '';
        customersCards += metricCardHtml('New Customers', fmtCount(c.newCustomers && c.newCustomers.value), null, { id: 'business-snapshot-chart-new-share' });
        customersCards += metricCardHtml('Returning Customers', fmtCount(c.returningCustomers && c.returningCustomers.value), null, { id: 'business-snapshot-chart-returning-share' });
        customersCards += metricCardHtml('Repeat Purchase Rate %', fmtPercent(c.repeatPurchaseRate && c.repeatPurchaseRate.value), null, { id: 'business-snapshot-chart-repeat-rate' });
        customersCards += metricCardHtml('LTV', fmtCurrency(c.ltv && c.ltv.value), null, { id: 'business-snapshot-chart-ltv-ratio' });

        body.innerHTML = '' +
          (topBlock ? topBlock : '') +
          '<div class="business-snapshot-sections p-4">' +
            (profit.visible
              ? ('<div class="business-snapshot-section mb-4">' +
                  '<h3 class="card-title mb-3">Profit</h3>' +
                  '<div class="row g-3 business-snapshot-grid">' + profitCards + '</div>' +
                '</div>')
              : '') +
            '<div class="business-snapshot-section mb-4">' +
              '<h3 class="card-title mb-3">Performance</h3>' +
              '<div class="row g-3 business-snapshot-grid">' + performanceCards + '</div>' +
            '</div>' +
            '<div class="business-snapshot-section">' +
              '<h3 class="card-title mb-3">Customers</h3>' +
              '<div class="row g-3 business-snapshot-grid">' + customersCards + '</div>' +
            '</div>' +
          '</div>';

        try { renderSnapshotCharts(data, chartSeq); } catch (_) {}
      }

      function setSnapshotLoading() {
        const body = document.getElementById('business-snapshot-body');
        if (!body) return;
        body.innerHTML =
          '<div class="business-snapshot-loading py-4 px-4 text-center">' +
            '<div class="spinner-border text-primary" role="status"></div>' +
            '<div class="text-muted mt-2">Loading business snapshot...</div>' +
          '</div>';
      }

      function fetchSnapshot(force) {
        const reqId = ++snapshotRequestSeq;
        snapshotActiveRequest = reqId;
        snapshotLoading = true;
        if (force) setSnapshotLoading();
        const year = String(selectedYear || getCurrentYearString());
        let url = API + '/api/business-snapshot?mode=yearly&year=' + encodeURIComponent(year);
        if (force) url += '&_=' + Date.now();
        const cacheMode = force ? 'no-store' : 'default';
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 30000)
          .then(function (res) { return (res && res.ok) ? res.json() : null; })
          .then(function (data) { if (reqId === snapshotActiveRequest) renderSnapshot(data); })
          .catch(function () { if (reqId === snapshotActiveRequest) renderSnapshot(null); })
          .finally(function () { if (reqId === snapshotActiveRequest) snapshotLoading = false; });
      }

      function normalizeRulesPayload(payload) {
        const src = payload && typeof payload === 'object' ? payload : {};
        const out = {
          enabled: !!src.enabled,
          currency: (src.currency && typeof src.currency === 'string' ? src.currency : 'GBP').toUpperCase(),
          integrations: {
            includeGoogleAdsSpend: !!(src.integrations && typeof src.integrations === 'object' && src.integrations.includeGoogleAdsSpend === true),
          },
          rules: [],
        };
        const list = Array.isArray(src.rules) ? src.rules : [];
        for (let i = 0; i < list.length; i++) {
          const row = list[i] && typeof list[i] === 'object' ? list[i] : {};
          const mode = row.appliesTo && row.appliesTo.mode === 'countries' ? 'countries' : 'all';
          const countries = mode === 'countries' && row.appliesTo && Array.isArray(row.appliesTo.countries)
            ? row.appliesTo.countries.map(normalizeCountryCode).filter(Boolean)
            : [];
          out.rules.push({
            id: row.id ? String(row.id) : createRuleId(),
            name: row.name ? String(row.name) : 'Expense',
            appliesTo: mode === 'countries' && countries.length ? { mode: 'countries', countries } : { mode: 'all', countries: [] },
            type: row.type ? String(row.type) : 'percent_revenue',
            value: Number.isFinite(Number(row.value)) ? Number(row.value) : 0,
            notes: row.notes ? String(row.notes) : '',
            enabled: row.enabled !== false,
            sort: Number.isFinite(Number(row.sort)) ? Math.trunc(Number(row.sort)) : (i + 1),
          });
        }
        out.rules.sort(function (a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0); });
        return out;
      }

      function fetchProfitRules(force) {
        let url = API + '/api/settings/profit-rules';
        if (force) url += '?_=' + Date.now();
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 20000)
          .then(function (res) { return (res && res.ok) ? res.json() : null; })
          .then(function (payload) {
            const normalized = normalizeRulesPayload(payload && payload.profitRules ? payload.profitRules : null);
            rulesDraft = normalized;
            return normalized;
          })
          .catch(function () {
            const fallback = normalizeRulesPayload({ enabled: false, currency: 'GBP', rules: [] });
            rulesDraft = fallback;
            return fallback;
          });
      }

      function setRulesMessage(text, ok) {
        const el = document.getElementById('profit-rules-msg');
        if (!el) return;
        el.textContent = text || '';
        el.classList.toggle('text-success', !!ok);
        el.classList.toggle('text-danger', ok === false);
        el.classList.toggle('is-hidden', !text);
      }

      function sortRulesDraft() {
        if (!rulesDraft || !Array.isArray(rulesDraft.rules)) return;
        rulesDraft.rules.sort(function (a, b) {
          const sa = Number(a && a.sort != null ? a.sort : 0) || 0;
          const sb = Number(b && b.sort != null ? b.sort : 0) || 0;
          if (sa !== sb) return sa - sb;
          return String(a && a.id || '').localeCompare(String(b && b.id || ''));
        });
      }

      function reindexRulesSort() {
        if (!rulesDraft || !Array.isArray(rulesDraft.rules)) return;
        sortRulesDraft();
        rulesDraft.rules.forEach(function (rule, idx) {
          rule.sort = idx + 1;
        });
      }

      function ruleTypeLabel(type) {
        if (type === 'fixed_per_order') return 'Fixed per Order';
        if (type === 'fixed_per_period') return 'Fixed per Period';
        return 'Percent of Revenue';
      }

      function ruleValueLabel(rule) {
        if (!rule) return '—';
        const value = Number(rule.value);
        if (!Number.isFinite(value)) return '—';
        if (rule.type === 'percent_revenue') return value.toFixed(2).replace(/\.00$/, '') + '%';
        return fmtCurrency(value);
      }

      function renderRulesList() {
        const body = document.getElementById('profit-rules-table-body');
        if (!body) return;
        if (!rulesDraft || !Array.isArray(rulesDraft.rules) || !rulesDraft.rules.length) {
          body.innerHTML = '<tr><td colspan="7" class="text-muted">No rules yet.</td></tr>';
          return;
        }
        sortRulesDraft();
        let html = '';
        rulesDraft.rules.forEach(function (rule, idx) {
          const applies = rule && rule.appliesTo && rule.appliesTo.mode === 'countries'
            ? ((rule.appliesTo.countries || []).join(', ') || '—')
            : 'All';
          html += '' +
            '<tr data-rule-id="' + escapeHtml(rule.id || '') + '">' +
              '<td>' + escapeHtml(rule.name || 'Expense') + '</td>' +
              '<td>' + escapeHtml(applies) + '</td>' +
              '<td>' + escapeHtml(ruleTypeLabel(rule.type)) + '</td>' +
              '<td>' + escapeHtml(ruleValueLabel(rule)) + '</td>' +
              '<td class="text-nowrap">' +
                '<button class="btn btn-sm btn-ghost-secondary" data-pr-action="move-up" data-rule-id="' + escapeHtml(rule.id || '') + '"' + (idx <= 0 ? ' disabled' : '') + '>Up</button> ' +
                '<button class="btn btn-sm btn-ghost-secondary" data-pr-action="move-down" data-rule-id="' + escapeHtml(rule.id || '') + '"' + (idx >= (rulesDraft.rules.length - 1) ? ' disabled' : '') + '>Down</button>' +
              '</td>' +
              '<td>' +
                '<label class="form-check form-switch m-0">' +
                  '<input class="form-check-input" type="checkbox" data-pr-action="toggle-enabled" data-rule-id="' + escapeHtml(rule.id || '') + '"' + (rule.enabled ? ' checked' : '') + '>' +
                '</label>' +
              '</td>' +
              '<td class="text-nowrap">' +
                '<button class="btn btn-sm btn-ghost-secondary" data-pr-action="edit" data-rule-id="' + escapeHtml(rule.id || '') + '">Edit</button> ' +
                '<button class="btn btn-sm btn-ghost-danger" data-pr-action="delete" data-rule-id="' + escapeHtml(rule.id || '') + '">Delete</button>' +
              '</td>' +
            '</tr>';
        });
        body.innerHTML = html;
      }

      function getRuleById(ruleId) {
        if (!rulesDraft || !Array.isArray(rulesDraft.rules)) return null;
        return rulesDraft.rules.find(function (rule) { return String(rule && rule.id || '') === String(ruleId || ''); }) || null;
      }

      function setFormMode(modeText) {
        const title = document.getElementById('profit-rules-form-title');
        if (title) title.textContent = modeText || 'Add Expense Rule';
      }

      function showRulesForm(rule) {
        const panel = document.getElementById('profit-rules-form-wrap');
        if (!panel) return;
        panel.classList.remove('is-hidden');
        const editing = !!rule;
        editingRuleId = editing ? String(rule.id || '') : '';
        setFormMode(editing ? 'Edit Expense Rule' : 'Add Expense Rule');
        const nameEl = document.getElementById('profit-rule-name');
        const modeAllEl = document.getElementById('profit-rule-applies-all');
        const modeCountriesEl = document.getElementById('profit-rule-applies-countries');
        const countriesEl = document.getElementById('profit-rule-countries');
        const typeEl = document.getElementById('profit-rule-type');
        const valueEl = document.getElementById('profit-rule-value');
        const notesEl = document.getElementById('profit-rule-notes');
        const enabledEl = document.getElementById('profit-rule-enabled');
        if (nameEl) nameEl.value = editing ? (rule.name || '') : '';
        const mode = editing && rule.appliesTo && rule.appliesTo.mode === 'countries' ? 'countries' : 'all';
        if (modeAllEl) modeAllEl.checked = mode === 'all';
        if (modeCountriesEl) modeCountriesEl.checked = mode === 'countries';
        if (countriesEl) countriesEl.value = editing && rule.appliesTo && Array.isArray(rule.appliesTo.countries) ? rule.appliesTo.countries.join(', ') : '';
        if (typeEl) typeEl.value = editing ? (rule.type || 'percent_revenue') : 'percent_revenue';
        if (valueEl) valueEl.value = editing ? String(Number(rule.value) || 0) : '';
        if (notesEl) notesEl.value = editing ? (rule.notes || '') : '';
        if (enabledEl) enabledEl.checked = editing ? (rule.enabled !== false) : true;
      }

      function hideRulesForm() {
        const panel = document.getElementById('profit-rules-form-wrap');
        if (!panel) return;
        panel.classList.add('is-hidden');
        editingRuleId = '';
      }

      function readRuleForm() {
        const nameEl = document.getElementById('profit-rule-name');
        const modeCountriesEl = document.getElementById('profit-rule-applies-countries');
        const countriesEl = document.getElementById('profit-rule-countries');
        const typeEl = document.getElementById('profit-rule-type');
        const valueEl = document.getElementById('profit-rule-value');
        const notesEl = document.getElementById('profit-rule-notes');
        const enabledEl = document.getElementById('profit-rule-enabled');

        const name = nameEl ? String(nameEl.value || '').trim() : '';
        if (!name) return { ok: false, error: 'Rule name is required.' };

        const type = typeEl ? String(typeEl.value || '').trim() : 'percent_revenue';
        if (['percent_revenue', 'fixed_per_order', 'fixed_per_period'].indexOf(type) < 0) {
          return { ok: false, error: 'Invalid calculation type.' };
        }

        const value = valueEl ? Number(valueEl.value) : NaN;
        if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Value must be a positive number.' };

        const mode = modeCountriesEl && modeCountriesEl.checked ? 'countries' : 'all';
        let countries = [];
        if (mode === 'countries') {
          const raw = countriesEl ? String(countriesEl.value || '') : '';
          countries = raw.split(/[\s,]+/).map(normalizeCountryCode).filter(Boolean);
          const uniq = [];
          const seen = new Set();
          countries.forEach(function (cc) {
            if (!cc || seen.has(cc)) return;
            seen.add(cc);
            uniq.push(cc);
          });
          countries = uniq;
          if (!countries.length) return { ok: false, error: 'Enter at least one valid ISO country code.' };
          if (!countries.every(isIsoCountryCode)) return { ok: false, error: 'Country codes must be 2-letter ISO values.' };
        }

        return {
          ok: true,
          rule: {
            id: editingRuleId || createRuleId(),
            name: name.slice(0, 80),
            appliesTo: mode === 'countries' ? { mode: 'countries', countries: countries.slice(0, 64) } : { mode: 'all', countries: [] },
            type,
            value,
            notes: notesEl ? String(notesEl.value || '').trim().slice(0, 400) : '',
            enabled: enabledEl ? !!enabledEl.checked : true,
          },
        };
      }

      function saveRuleForm() {
        const parsed = readRuleForm();
        if (!parsed.ok) {
          setRulesMessage(parsed.error, false);
          return;
        }
        if (!rulesDraft || !Array.isArray(rulesDraft.rules)) rulesDraft = normalizeRulesPayload(null);
        const existing = getRuleById(parsed.rule.id);
        if (existing) {
          existing.name = parsed.rule.name;
          existing.appliesTo = parsed.rule.appliesTo;
          existing.type = parsed.rule.type;
          existing.value = parsed.rule.value;
          existing.notes = parsed.rule.notes;
          existing.enabled = parsed.rule.enabled;
        } else {
          parsed.rule.sort = (rulesDraft.rules.length || 0) + 1;
          rulesDraft.rules.push(parsed.rule);
        }
        reindexRulesSort();
        renderRulesList();
        hideRulesForm();
        setRulesMessage('Rule saved in draft.', true);
      }

      function saveProfitRules() {
        if (!rulesDraft) rulesDraft = normalizeRulesPayload(null);
        const enabledToggle = document.getElementById('profit-rules-enabled');
        rulesDraft.enabled = enabledToggle ? !!enabledToggle.checked : !!rulesDraft.enabled;
        const adsToggle = document.getElementById('profit-rules-include-google-ads');
        if (!rulesDraft.integrations || typeof rulesDraft.integrations !== 'object') rulesDraft.integrations = { includeGoogleAdsSpend: false };
        if (adsToggle) rulesDraft.integrations.includeGoogleAdsSpend = !!adsToggle.checked;
        reindexRulesSort();
        setRulesMessage('Saving…', true);
        return fetchWithTimeout(API + '/api/settings/profit-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ profitRules: rulesDraft }),
        }, 25000)
          .then(function (res) { return (res && res.ok) ? res.json() : null; })
          .then(function (payload) {
            const saved = normalizeRulesPayload(payload && payload.profitRules ? payload.profitRules : rulesDraft);
            rulesDraft = saved;
            setRulesMessage('Profit rules saved.', true);
            if (modalVisible(snapshotModal)) fetchSnapshot(true);
          })
          .catch(function () {
            setRulesMessage('Failed to save profit rules.', false);
          });
      }

      function setProfitRulesTab(tabKey) {
        const key = tabKey === 'integrations' ? 'integrations' : 'rules';
        if (!rulesModal) return;
        const tabs = rulesModal.querySelectorAll ? rulesModal.querySelectorAll('[data-pr-tab]') : [];
        tabs.forEach(function (btn) {
          const v = btn && btn.getAttribute ? String(btn.getAttribute('data-pr-tab') || '') : '';
          if (btn && btn.classList) btn.classList.toggle('active', v === key);
        });
        const panes = rulesModal.querySelectorAll ? rulesModal.querySelectorAll('[data-pr-pane]') : [];
        panes.forEach(function (pane) {
          const v = pane && pane.getAttribute ? String(pane.getAttribute('data-pr-pane') || '') : '';
          if (pane && pane.classList) pane.classList.toggle('is-hidden', v !== key);
        });
      }

      function openProfitRulesModal() {
        ensureModals();
        setRulesMessage('', null);
        fetchProfitRules(false).then(function (rules) {
          const enabledToggle = document.getElementById('profit-rules-enabled');
          if (enabledToggle) enabledToggle.checked = !!(rules && rules.enabled);
          const adsToggle = document.getElementById('profit-rules-include-google-ads');
          if (adsToggle) adsToggle.checked = !!(rules && rules.integrations && rules.integrations.includeGoogleAdsSpend);
          setProfitRulesTab('rules');
          renderRulesList();
          hideRulesForm();
          openModal(rulesModal);
        });
      }

      function ensureModals() {
        if (snapshotModal && rulesModal) return;
        if (!snapshotModal) {
          const wrap = document.createElement('div');
          wrap.className = 'modal modal-blur fade';
          wrap.id = 'business-snapshot-modal';
          wrap.tabIndex = -1;
          wrap.setAttribute('aria-hidden', 'true');
          wrap.style.display = 'none';
          wrap.innerHTML = '' +
            '<div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="dialog" aria-modal="true" aria-label="Business Snapshot">' +
              '<div class="modal-content">' +
                '<div class="modal-header p-4 align-items-start business-snapshot-modal-header">' +
                  '<div class="business-snapshot-header-bg" aria-hidden="true">' +
                    '<svg viewBox="0 0 600 140" preserveAspectRatio="none" aria-hidden="true">' +
                      '<g fill="currentColor">' +
                        '<rect x="18" y="78" width="18" height="52" rx="3"></rect>' +
                        '<rect x="48" y="64" width="18" height="66" rx="3"></rect>' +
                        '<rect x="78" y="86" width="18" height="44" rx="3"></rect>' +
                        '<rect x="108" y="44" width="18" height="86" rx="3"></rect>' +
                        '<rect x="138" y="58" width="18" height="72" rx="3"></rect>' +
                        '<rect x="168" y="24" width="18" height="106" rx="3"></rect>' +
                        '<rect x="198" y="52" width="18" height="78" rx="3"></rect>' +
                        '<rect x="228" y="70" width="18" height="60" rx="3"></rect>' +
                        '<rect x="258" y="34" width="18" height="96" rx="3"></rect>' +
                        '<rect x="288" y="60" width="18" height="70" rx="3"></rect>' +
                        '<rect x="318" y="90" width="18" height="40" rx="3"></rect>' +
                        '<rect x="348" y="68" width="18" height="62" rx="3"></rect>' +
                        '<rect x="378" y="38" width="18" height="92" rx="3"></rect>' +
                        '<rect x="408" y="56" width="18" height="74" rx="3"></rect>' +
                        '<rect x="438" y="28" width="18" height="102" rx="3"></rect>' +
                        '<rect x="468" y="66" width="18" height="64" rx="3"></rect>' +
                        '<rect x="498" y="46" width="18" height="84" rx="3"></rect>' +
                        '<rect x="528" y="74" width="18" height="56" rx="3"></rect>' +
                        '<rect x="558" y="54" width="18" height="76" rx="3"></rect>' +
                      '</g>' +
                    '</svg>' +
                  '</div>' +
                  '<div class="d-flex flex-column">' +
                    '<h5 class="modal-title mb-0" id="business-snapshot-title">Business Snapshot</h5>' +
                    '<div class="text-muted small" id="business-snapshot-subtitle">Yearly Reports</div>' +
                    '<div class="business-snapshot-date-mode-grid mt-3">' +
                      '<div class="business-snapshot-report-panel">' +
                        '<div class="d-flex flex-wrap align-items-center gap-2">' +
                          '<select class="form-select form-select-sm" id="business-snapshot-year" aria-label="Year"></select>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="ms-auto d-flex align-items-start gap-2 business-snapshot-header-actions">' +
                    '<button type="button" class="btn-close" id="business-snapshot-close-btn" aria-label="Close"></button>' +
                  '</div>' +
                '</div>' +
                '<div class="modal-body p-0 business-snapshot-modal-body">' +
                  '<div id="business-snapshot-body"></div>' +
                '</div>' +
                '<div class="modal-footer business-snapshot-modal-footer">' +
                  '<div class="business-snapshot-footer-settings">' +
                    '<a href="#" class="link-secondary" id="business-snapshot-footer-settings-link">Settings</a>' +
                  '</div>' +
                '</div>' +
              '</div>' +
            '</div>';
          document.body.appendChild(wrap);
          snapshotModal = wrap;

          const closeBtn = document.getElementById('business-snapshot-close-btn');
          if (closeBtn) closeBtn.addEventListener('click', function () { closeModal(snapshotModal); });
          snapshotModal.addEventListener('click', function (e) {
            if (modalVisible(rulesModal)) return;
            if (e && e.target === snapshotModal) closeModal(snapshotModal);
          });
          document.addEventListener('keydown', function (e) {
            if (!modalVisible(snapshotModal)) return;
            if (modalVisible(rulesModal)) return;
            if ((e && (e.key || e.code)) === 'Escape') closeModal(snapshotModal);
          });

          const yearSel = document.getElementById('business-snapshot-year');
          if (yearSel) {
            yearSel.addEventListener('change', function () {
              selectedYear = String(yearSel.value || getCurrentYearString());
              setSnapshotLoading();
              fetchSnapshot(false);
            });
          }
          const footerSettingsLink = document.getElementById('business-snapshot-footer-settings-link');
          if (footerSettingsLink) {
            footerSettingsLink.addEventListener('click', function (e) {
              e.preventDefault();
              openProfitRulesModal();
            });
          }
        }

        if (!rulesModal) {
          const wrap = document.createElement('div');
          wrap.className = 'modal modal-blur fade';
          wrap.id = 'profit-rules-modal';
          wrap.tabIndex = -1;
          wrap.setAttribute('aria-hidden', 'true');
          wrap.style.display = 'none';
          wrap.innerHTML = '' +
            '<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="dialog" aria-modal="true" aria-label="Profit Rules">' +
              '<div class="modal-content">' +
                '<div class="modal-header">' +
                  '<h5 class="modal-title">Profit Rules</h5>' +
                  '<button type="button" class="btn-close" id="profit-rules-close-btn" aria-label="Close"></button>' +
                '</div>' +
                '<div class="modal-body">' +
                  '<ul class="nav nav-tabs mb-3">' +
                    '<li class="nav-item"><button type="button" class="nav-link active" data-pr-tab="rules">Rules</button></li>' +
                    '<li class="nav-item"><button type="button" class="nav-link" data-pr-tab="integrations">Integrations</button></li>' +
                  '</ul>' +
                  '<div data-pr-pane="rules">' +
                  '<div class="mb-3">' +
                    '<label class="form-check form-switch m-0">' +
                      '<input class="form-check-input" type="checkbox" id="profit-rules-enabled">' +
                      '<span class="form-check-label">Enable estimated profit in Business Snapshot</span>' +
                    '</label>' +
                  '</div>' +
                  '<div class="d-flex align-items-center justify-content-between mb-2">' +
                    '<h6 class="mb-0">Rules</h6>' +
                    '<button type="button" class="btn btn-outline-primary btn-sm" id="profit-rules-add-btn">Add Expense Rule</button>' +
                  '</div>' +
                  '<div class="mb-3">' + (typeof buildKexoNativeTable === 'function' ? buildKexoNativeTable({
                    tableId: 'profit-rules-table',
                    bodyId: 'profit-rules-table-body',
                    tableClass: 'table table-sm table-vcenter',
                    columns: (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['profit-rules-table'] && window.KEXO_APP_MODAL_TABLE_DEFS['profit-rules-table'].columns) || [
                      { header: 'Rule name', headerClass: '' },
                      { header: 'Applies to', headerClass: '' },
                      { header: 'Type', headerClass: '' },
                      { header: 'Value', headerClass: '' },
                      { header: 'Priority', headerClass: '' },
                      { header: 'Enabled', headerClass: '' },
                      { header: 'Actions', headerClass: '' }
                    ]
                  }) : '<div class="table-responsive"><table class="table table-sm table-vcenter"><thead><tr><th>Rule name</th><th>Applies to</th><th>Type</th><th>Value</th><th>Priority</th><th>Enabled</th><th>Actions</th></tr></thead><tbody id="profit-rules-table-body"></tbody></table></div>') + '</div>' +
                  '<div class="card is-hidden" id="profit-rules-form-wrap">' +
                    '<div class="card-body">' +
                      '<h6 id="profit-rules-form-title" class="mb-3">Add Expense Rule</h6>' +
                      '<div class="row g-3">' +
                        '<div class="col-12 col-md-6">' +
                          '<label class="form-label">Name</label>' +
                          '<input class="form-control" id="profit-rule-name" placeholder="VAT">' +
                        '</div>' +
                        '<div class="col-12 col-md-6">' +
                          '<label class="form-label">Calculation type</label>' +
                          '<select class="form-select" id="profit-rule-type">' +
                            '<option value="percent_revenue">Percent of Revenue</option>' +
                            '<option value="fixed_per_order">Fixed per Order</option>' +
                            '<option value="fixed_per_period">Fixed per Period</option>' +
                          '</select>' +
                        '</div>' +
                        '<div class="col-12">' +
                          '<label class="form-label d-block">Applies to</label>' +
                          '<label class="form-check form-check-inline"><input class="form-check-input" type="radio" name="profit-rule-applies" id="profit-rule-applies-all" checked><span class="form-check-label">All countries</span></label>' +
                          '<label class="form-check form-check-inline"><input class="form-check-input" type="radio" name="profit-rule-applies" id="profit-rule-applies-countries"><span class="form-check-label">Specific countries</span></label>' +
                          '<input class="form-control mt-2" id="profit-rule-countries" placeholder="GB, US, AU">' +
                        '</div>' +
                        '<div class="col-12 col-md-6">' +
                          '<label class="form-label">Value</label>' +
                          '<input type="number" step="0.01" min="0" class="form-control" id="profit-rule-value" placeholder="20">' +
                        '</div>' +
                        '<div class="col-12 col-md-6 d-flex align-items-end">' +
                          '<label class="form-check form-switch m-0">' +
                            '<input class="form-check-input" type="checkbox" id="profit-rule-enabled" checked>' +
                            '<span class="form-check-label">Enabled</span>' +
                          '</label>' +
                        '</div>' +
                        '<div class="col-12">' +
                          '<label class="form-label">Notes (optional)</label>' +
                          '<textarea class="form-control" id="profit-rule-notes" rows="2"></textarea>' +
                        '</div>' +
                      '</div>' +
                      '<div class="d-flex justify-content-end gap-2 mt-3">' +
                        '<button type="button" class="btn btn-ghost-secondary" id="profit-rule-cancel-btn">Cancel</button>' +
                        '<button type="button" class="btn btn-primary" id="profit-rule-save-btn">Save</button>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="small mt-3 is-hidden" id="profit-rules-msg"></div>' +
                  '</div>' +
                  '<div class="is-hidden" data-pr-pane="integrations">' +
                    '<div class="card card-sm mb-3">' +
                      '<div class="card-body">' +
                        '<label class="form-check form-switch m-0">' +
                          '<input class="form-check-input" type="checkbox" id="profit-rules-include-google-ads">' +
                          '<span class="form-check-label">Include Google Ads spend in Cost chart</span>' +
                        '</label>' +
                        '<div class="text-muted small mt-2">When enabled, the Business Snapshot Cost line includes Google Ads spend for the selected period.</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="modal-footer">' +
                  '<button type="button" class="btn btn-ghost-secondary" id="profit-rules-dismiss-btn">Close</button>' +
                  '<button type="button" class="btn btn-primary" id="profit-rules-save-btn">Save Rules</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          document.body.appendChild(wrap);
          rulesModal = wrap;

          const closeBtn = document.getElementById('profit-rules-close-btn');
          if (closeBtn) closeBtn.addEventListener('click', function () { closeModal(rulesModal); });
          const dismissBtn = document.getElementById('profit-rules-dismiss-btn');
          if (dismissBtn) dismissBtn.addEventListener('click', function () { closeModal(rulesModal); });
          rulesModal.addEventListener('click', function (e) {
            if (e && e.target === rulesModal) closeModal(rulesModal);
          });
          rulesModal.addEventListener('click', function (e) {
            const target = e && e.target ? e.target : null;
            const tabBtn = target && target.closest ? target.closest('button[data-pr-tab]') : null;
            if (!tabBtn) return;
            e.preventDefault();
            const key = String(tabBtn.getAttribute('data-pr-tab') || '').trim();
            setProfitRulesTab(key);
          });
          document.addEventListener('keydown', function (e) {
            if (!modalVisible(rulesModal)) return;
            if ((e && (e.key || e.code)) === 'Escape') closeModal(rulesModal);
          });

          const addBtn = document.getElementById('profit-rules-add-btn');
          if (addBtn) addBtn.addEventListener('click', function () {
            setRulesMessage('', null);
            showRulesForm(null);
          });
          const cancelBtn = document.getElementById('profit-rule-cancel-btn');
          if (cancelBtn) cancelBtn.addEventListener('click', function () { hideRulesForm(); });
          const saveRuleBtn = document.getElementById('profit-rule-save-btn');
          if (saveRuleBtn) saveRuleBtn.addEventListener('click', function () { saveRuleForm(); });
          const saveRulesBtn = document.getElementById('profit-rules-save-btn');
          if (saveRulesBtn) saveRulesBtn.addEventListener('click', function () { saveProfitRules(); });

          const tableBody = document.getElementById('profit-rules-table-body');
          if (tableBody) {
            tableBody.addEventListener('click', function (e) {
              const target = e && e.target ? e.target : null;
              const btn = target && target.closest ? target.closest('[data-pr-action]') : null;
              if (!btn) return;
              const action = String(btn.getAttribute('data-pr-action') || '').trim();
              const ruleId = String(btn.getAttribute('data-rule-id') || '').trim();
              const rule = getRuleById(ruleId);
              if (!rule) return;
              if (action === 'edit') {
                setRulesMessage('', null);
                showRulesForm(rule);
                return;
              }
              if (action === 'delete') {
                rulesDraft.rules = rulesDraft.rules.filter(function (r) { return String(r.id || '') !== ruleId; });
                reindexRulesSort();
                renderRulesList();
                setRulesMessage('Rule removed.', true);
                return;
              }
              if (action === 'move-up' || action === 'move-down') {
                sortRulesDraft();
                const idx = rulesDraft.rules.findIndex(function (r) { return String(r && r.id || '') === ruleId; });
                if (idx < 0) return;
                const nextIdx = action === 'move-up' ? idx - 1 : idx + 1;
                if (nextIdx < 0 || nextIdx >= rulesDraft.rules.length) return;
                const tmp = rulesDraft.rules[idx];
                rulesDraft.rules[idx] = rulesDraft.rules[nextIdx];
                rulesDraft.rules[nextIdx] = tmp;
                reindexRulesSort();
                renderRulesList();
                setRulesMessage('Rule priority updated.', true);
              }
            });
            tableBody.addEventListener('change', function (e) {
              const target = e && e.target ? e.target : null;
              if (!target || target.getAttribute('data-pr-action') !== 'toggle-enabled') return;
              const ruleId = String(target.getAttribute('data-rule-id') || '').trim();
              const rule = getRuleById(ruleId);
              if (!rule) return;
              rule.enabled = !!target.checked;
              setRulesMessage('Rule updated in draft.', true);
            });
          }
        }
      }

      openBtn.addEventListener('click', function () {
        ensureModals();
        selectedYear = getCurrentYearString();
        const yearSel = document.getElementById('business-snapshot-year');
        if (yearSel) yearSel.value = selectedYear;
        setSnapshotLoading();
        openModal(snapshotModal);
        fetchSnapshot(false);
      });
    })();

    (function initTrafficTypeTree() {
      const body = document.getElementById('traffic-types-body');
      if (!body) return;
      body.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('.traffic-type-toggle') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const device = (btn.getAttribute('data-device') || '').trim().toLowerCase();
        if (!device) return;
        if (!trafficTypeExpanded || typeof trafficTypeExpanded !== 'object') {
          // First click: snapshot current groups as all-open, then toggle the clicked one
          trafficTypeExpanded = {};
          document.querySelectorAll('.traffic-type-parent[data-device]').forEach(function(row) {
            var d = (row.getAttribute('data-device') || '').trim().toLowerCase();
            if (d) trafficTypeExpanded[d] = true;
          });
        }
        const nextOpen = !trafficTypeExpanded[device];
        trafficTypeExpanded[device] = nextOpen;
        btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        body.querySelectorAll('.grid-row.traffic-type-child[data-parent="' + device + '"]').forEach(function(tr) {
          tr.classList.toggle('is-hidden', !nextOpen);
        });
      });
    })();

    (function initTopBar() {
      try { saleMuted = sessionStorage.getItem(SALE_MUTED_KEY) === 'true'; } catch (_) { saleMuted = false; }
      try { saleAudio = new Audio(); } catch (_) { saleAudio = null; }
      if (saleAudio) {
        try { saleAudio.preload = 'auto'; } catch (_) {}
        try { setSaleAudioSrc(typeof getCashRegisterMp3Url === 'function' ? getCashRegisterMp3Url() : (API || '') + '/assets/cash-register.mp3'); } catch (_) {}
        // Prime/unlock audio on the first user interaction so sale sounds can play later.
        (function primeOnFirstGesture() {
          function prime() { try { primeSaleAudio(); } catch (_) {} }
          document.addEventListener('pointerdown', prime, { once: true, capture: true });
          document.addEventListener('keydown', prime, { once: true, capture: true });
          document.addEventListener('click', prime, { once: true, capture: true });
        })();
      }
      function syncFooterAudioMute(muted) {
        document.querySelectorAll('.footer-audio-btn, .footer-settings-audio').forEach(function(btn) {
          btn.classList.toggle('muted', muted);
          var iconOn = btn.querySelector('.sound-icon-on');
          var iconOff = btn.querySelector('.sound-icon-off');
          if (iconOn) iconOn.classList.toggle('is-hidden', muted);
          if (iconOff) iconOff.classList.toggle('is-hidden', !muted);
        });
      }
      const muteBtn = document.getElementById('audio-mute-btn');
      const iconOn = muteBtn && muteBtn.querySelector('.sound-icon-on');
      const iconOff = muteBtn && muteBtn.querySelector('.sound-icon-off');
      if (muteBtn) {
        if (iconOn) iconOn.classList.toggle('is-hidden', saleMuted);
        if (iconOff) iconOff.classList.toggle('is-hidden', !saleMuted);
        muteBtn.classList.toggle('muted', saleMuted);
        syncFooterAudioMute(saleMuted);
        muteBtn.addEventListener('click', function() {
          saleMuted = !saleMuted;
          try { sessionStorage.setItem(SALE_MUTED_KEY, String(saleMuted)); } catch (_) {}
          if (iconOn) iconOn.classList.toggle('is-hidden', saleMuted);
          if (iconOff) iconOff.classList.toggle('is-hidden', !saleMuted);
          muteBtn.classList.toggle('muted', saleMuted);
          syncFooterAudioMute(saleMuted);
          if (!saleMuted) {
            // User gesture: unlock audio so future sale sounds work.
            try { primeSaleAudio(); } catch (_) {}
          }
        });
      }
      // Test sale sound: add ?cha=ching to the URL. Plays once when sound is on; if autoplay blocked, plays on first click.
      (function testChaChing() {
        if (new URLSearchParams(window.location.search).get('cha') !== 'ching' || !saleAudio) return;
        function playTest() {
          if (saleMuted) return;
          saleAudio.currentTime = 0;
          saleAudio.play().catch(function() {});
        }
        playTest();
        document.body.addEventListener('click', function once() {
          document.body.removeEventListener('click', once);
          playTest();
        }, { once: true });
      })();
      const dateSelect = document.getElementById('global-date-select');
      if (dateSelect) {
        mountDesktopDatePickerIntoPageHeader();
        try {
          const syncHeaderDatePlacement = function() { mountDesktopDatePickerIntoPageHeader(); };
          window.addEventListener('resize', syncHeaderDatePlacement, { passive: true });
          window.addEventListener('orientationchange', syncHeaderDatePlacement);
          window.addEventListener('pageshow', syncHeaderDatePlacement);
        } catch (_) {}
        syncDateSelectOptions();
        applyRangeAvailable({ today: true, yesterday: true });
        updateLiveViewTitle();
        updateRowsPerPageVisibility();
        dateSelect.addEventListener('change', function() {
          const next = String(this.value || '').trim().toLowerCase();
          try {
            const opt = this.querySelector('option[value="' + next + '"]');
            if (opt && opt.disabled) {
              this.value = 'today';
              return;
            }
          } catch (_) {}
          if (next === 'custom') {
            openCustomDateModal();
            // Revert the select so "Custom" can be selected again.
            syncDateSelectOptions();
            return;
          }
          // Handle standard date ranges
          if (next === 'today' || next === 'yesterday' || next === '7days' || next === '14days' || next === '30days') {
            dateRange = next;
            applyDateRangeChange();
            return;
          }
          // Defensive: allow selecting an applied range key if present.
          if (isCustomRangeKey(next)) {
            dateRange = next;
            applyDateRangeChange();
          }
        });
        initCustomDateModal();
        initHeaderDateMenu();
        try { ensureUiSettingsLoaded({ apply: true }); } catch (_) {}
      }
      (function initTableTitleTabs() {
        const tabsWrap = document.getElementById('table-title-tabs');
        if (!tabsWrap) return;
        function setRangeFromTab(range) {
          dateRange = range;
          if (dateRange === 'sales' || dateRange === '1h') {
            const sel = document.getElementById('global-date-select');
            if (sel) sel.value = 'today';
          }
          lastOnlineCount = null;
          countryPage = 1;
          updateLiveViewTitle();
          updateRowsPerPageVisibility();
          refreshKpis({ force: true });
          updateKpis();
          fetchSessions();
          updateNextUpdateUi();
        }
        document.querySelectorAll('#table-title-tabs button[data-range]').forEach(function(btn) {
          btn.addEventListener('click', function() { setRangeFromTab(btn.getAttribute('data-range')); });
        });
      })();
      (function initMainTabs() {
        const TAB_KEY = 'kexo-main-tab';
        const VALID_TABS = ['dashboard', 'spy', 'sales', 'date', 'stats', 'products', 'channels', 'type', 'ads', 'tools'];
        const TAB_LABELS = { dashboard: 'Overview', spy: 'Live View', sales: 'Recent Sales', date: 'Table View', stats: 'Countries', products: 'Products', variants: 'Variants', channels: 'Channels', type: 'Device & Platform', ads: 'Google Ads', tools: 'Conversion Rate Compare' };
        const HASH_TO_TAB = { dashboard: 'dashboard', 'live-view': 'spy', sales: 'sales', date: 'date', countries: 'stats', products: 'products', channels: 'channels', type: 'type', ads: 'ads', 'compare-conversion-rate': 'tools' };
        const TAB_TO_HASH = { dashboard: 'dashboard', spy: 'live-view', sales: 'sales', date: 'date', stats: 'countries', products: 'products', channels: 'channels', type: 'type', ads: 'ads', tools: 'compare-conversion-rate' };
        const tabDashboard = document.getElementById('nav-tab-dashboard');
        const tabSpy = document.getElementById('nav-tab-spy');
        const tabStats = document.getElementById('nav-tab-stats');
        const tabProducts = document.getElementById('nav-tab-products');
        const tabVariants = document.getElementById('nav-tab-variants');
        const tabAds = document.getElementById('nav-tab-ads');
        const tabSales = document.getElementById('nav-tab-sales');
        const tabDate = document.getElementById('nav-tab-date');
        const tabTools = document.getElementById('nav-tab-tools');
        const panelDashboard = document.getElementById('tab-panel-dashboard');
        const panelSpy = document.getElementById('tab-panel-spy');
        const panelStats = document.getElementById('tab-panel-stats');
        const panelProducts = document.getElementById('tab-panel-products');
        const panelAds = document.getElementById('tab-panel-ads');
        const pageTitleEl = document.getElementById('page-title');
        const navLinks = document.querySelectorAll('[data-nav]');

        // Ads tab: lazy-load /ads.js only when Ads is opened.
        let adsLoading = null;
        let adsLoaded = false;
        function ensureAdsLoaded() {
          if (adsLoaded) return Promise.resolve(true);
          if (adsLoading) return adsLoading;
          adsLoading = new Promise(function(resolve) {
            const existing = document.querySelector('script[data-ads-js="1"]');
            if (existing) {
              // If the script tag exists but hasn't executed yet (defer + slow network),
              // wait for it so Ads can initialize immediately instead of staying blank.
              try {
                if (window.__adsInit || window.__adsRefresh) {
                  adsLoaded = true;
                  resolve(true);
                  return;
                }
              } catch (_) {}

              const onLoad = function() {
                adsLoaded = true;
                resolve(true);
              };
              const onError = function() {
                resolve(false);
              };
              try {
                existing.addEventListener('load', onLoad, { once: true });
                existing.addEventListener('error', onError, { once: true });
              } catch (_) {}

              // Edge: if it already loaded before listeners attached, resolve on next tick.
              setTimeout(function() {
                try {
                  if (window.__adsInit || window.__adsRefresh) {
                    adsLoaded = true;
                    resolve(true);
                  }
                } catch (_) {}
              }, 0);
              return;
            }
            const s = document.createElement('script');
            s.src = '/ads.js';
            s.async = true;
            s.defer = true;
            s.setAttribute('data-ads-js', '1');
            s.onload = function() {
              adsLoaded = true;
              resolve(true);
            };
            s.onerror = function() {
              resolve(false);
            };
            document.head.appendChild(s);
          }).finally(function() {
            adsLoading = null;
          });
          return adsLoading;
        }

        function tabFromHash() {
          var h = location.hash ? location.hash.replace(/^#/, '').toLowerCase() : '';
          return HASH_TO_TAB[h] || null;
        }

        var hashUpdateInProgress = false;
        function setHash(tab) {
          if (PAGE) return;
          var h = TAB_TO_HASH[tab] || 'dashboard';
          if (location.hash === '#' + h) return;
          hashUpdateInProgress = true;
          try { history.replaceState(null, '', '#' + h); } catch (_) {}
          hashUpdateInProgress = false;
        }

        var TAB_TO_NAV = { spy: 'live', stats: 'countries' };
        function syncPageHeaderCategoryIcon() {
          // Inject the active top-menu category icon into the page header (next to pretitle/title),
          // using the same icon + accent as the active dropdown toggle.
          try {
            var pretitle = document.querySelector('.page-header .page-pretitle');
            if (!pretitle) return;
            // Remove previous injected icon(s) (legacy placed as sibling; current placed inside pretitle).
            try {
              pretitle.querySelectorAll('.kexo-page-header-category-icon').forEach(function(el) { try { el.remove(); } catch (_) {} });
            } catch (_) {}
            try {
              var parent = pretitle.parentElement;
              if (parent) {
                parent.querySelectorAll(':scope > .kexo-page-header-category-icon').forEach(function(el) { try { el.remove(); } catch (_) {} });
              }
            } catch (_) {}

            var navList = document.querySelector('.kexo-desktop-nav-list');
            if (!navList) return;

            // Top-level active category (Dashboard/Insights/Traffic/Integrations/Tools)
            var activeCat = navList.querySelector(':scope > .nav-item.dropdown.active');
            if (!activeCat) return;

            var toggle = activeCat.querySelector(':scope > .nav-link.dropdown-toggle');
            if (!toggle) return;

            var iconSrc = toggle.querySelector('.kexo-nav-svg');
            if (!iconSrc) return;

            var icon = iconSrc.cloneNode(true);
            // Avoid nav spacing helpers (they use !important and fight our header layout).
            try { icon.classList.remove('me-1', 'me-2'); } catch (_) {}
            icon.classList.add('kexo-page-header-category-icon');
            icon.setAttribute('aria-hidden', 'true');

            // Apply the same accent index as the active top-level nav item.
            var idx = 0;
            try {
              var kids = Array.prototype.slice.call(navList.children || []);
              idx = kids.indexOf(activeCat) + 1;
            } catch (_) { idx = 0; }
            if (idx >= 1 && idx <= 5) {
              icon.classList.add('kexo-accent-' + String(idx));
            }

            // Ensure the header icon matches the EXACT computed color from the menu icon,
            // even if accents are altered by theme/scripts (no drift).
            var computedColor = '';
            try {
              computedColor = (window.getComputedStyle && iconSrc) ? window.getComputedStyle(iconSrc).color : '';
              computedColor = String(computedColor || '').trim();
              if (computedColor) icon.style.color = computedColor;
            } catch (_) {}

            pretitle.insertBefore(icon, pretitle.firstChild || null);

            // Expose accent for connector lines (very light tint of same shade).
            try {
              var row = pretitle.closest('.row.align-items-center');
              if (row && computedColor) row.style.setProperty('--kexo-page-header-accent', computedColor);
            } catch (_) {}
          } catch (_) {}
        }
        function updateNavSelection(tab) {
          var navKey = TAB_TO_NAV[tab] || tab;
          navLinks.forEach(function(link) {
            var isActive = link.getAttribute('data-nav') === navKey;
            link.setAttribute('aria-current', isActive ? 'page' : 'false');
            // Apply active to the parent li.nav-item (Tabler pattern), not the link itself
            var parentItem = link.closest('.nav-item');
            if (parentItem) {
              if (isActive) parentItem.classList.add('active'); else parentItem.classList.remove('active');
            }
            link.classList.remove('active');
          });
          if (tabDashboard) tabDashboard.setAttribute('aria-selected', tab === 'dashboard' ? 'true' : 'false');
          if (tabSpy) tabSpy.setAttribute('aria-selected', tab === 'spy' ? 'true' : 'false');
          if (tabStats) tabStats.setAttribute('aria-selected', tab === 'stats' ? 'true' : 'false');
          if (tabProducts) tabProducts.setAttribute('aria-selected', tab === 'products' ? 'true' : 'false');
          if (tabVariants) tabVariants.setAttribute('aria-selected', tab === 'variants' ? 'true' : 'false');
          if (tabAds) tabAds.setAttribute('aria-selected', tab === 'ads' ? 'true' : 'false');
          if (tabSales) tabSales.setAttribute('aria-selected', tab === 'sales' ? 'true' : 'false');
          if (tabDate) tabDate.setAttribute('aria-selected', tab === 'date' ? 'true' : 'false');
          if (tabTools) tabTools.setAttribute('aria-selected', tab === 'tools' ? 'true' : 'false');
          // Dashboard dropdown — highlight parent li.nav-item when a child page is active
          var isDashboardChild = (tab === 'dashboard' || tab === 'spy' || tab === 'sales' || tab === 'date');
          var dashboardToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-dashboard-menu"]');
          var dashboardDropdownItem = dashboardToggle ? dashboardToggle.closest('.nav-item') : null;
          if (dashboardToggle) {
            dashboardToggle.setAttribute('aria-current', isDashboardChild ? 'page' : 'false');
          }
          if (dashboardDropdownItem) {
            if (isDashboardChild) dashboardDropdownItem.classList.add('active');
            else dashboardDropdownItem.classList.remove('active');
          }
          // Insights dropdown (Countries + Products + Variants)
          var isInsightsChild = (tab === 'stats' || tab === 'products' || tab === 'variants');
          var insightsToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-insights-menu"]');
          var insightsDropdownItem = insightsToggle ? insightsToggle.closest('.nav-item') : null;
          if (insightsToggle) {
            insightsToggle.setAttribute('aria-current', isInsightsChild ? 'page' : 'false');
          }
          if (insightsDropdownItem) {
            if (isInsightsChild) insightsDropdownItem.classList.add('active');
            else insightsDropdownItem.classList.remove('active');
          }
          // Traffic dropdown
          var isTrafficChild = (tab === 'channels' || tab === 'type');
          var trafficToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-traffic-menu"]');
          var trafficDropdownItem = trafficToggle ? trafficToggle.closest('.nav-item') : null;
          if (trafficToggle) {
            trafficToggle.setAttribute('aria-current', isTrafficChild ? 'page' : 'false');
          }
          if (trafficDropdownItem) {
            if (isTrafficChild) trafficDropdownItem.classList.add('active');
            else trafficDropdownItem.classList.remove('active');
          }

          // Integrations dropdown
          var isIntegrationsChild = (tab === 'ads');
          var integrationsToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-integrations-menu"]');
          var integrationsDropdownItem = integrationsToggle ? integrationsToggle.closest('.nav-item') : null;
          if (integrationsToggle) {
            integrationsToggle.setAttribute('aria-current', isIntegrationsChild ? 'page' : 'false');
          }
          if (integrationsDropdownItem) {
            if (isIntegrationsChild) integrationsDropdownItem.classList.add('active');
            else integrationsDropdownItem.classList.remove('active');
          }

          // Tools dropdown
          var isToolsChild = (tab === 'tools');
          var toolsToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-tools-menu"]');
          var toolsDropdownItem = toolsToggle ? toolsToggle.closest('.nav-item') : null;
          if (toolsToggle) {
            toolsToggle.setAttribute('aria-current', isToolsChild ? 'page' : 'false');
          }
          if (toolsDropdownItem) {
            if (isToolsChild) toolsDropdownItem.classList.add('active');
            else toolsDropdownItem.classList.remove('active');
          }

          // Keep the page header icon in sync with the active top-level dropdown.
          syncPageHeaderCategoryIcon();
        }

        function runTabWork(tab) {
          // Keep condensed KPI strip fitted to available width.
          try { scheduleCondensedKpiOverflowUpdate(); } catch (_) {}
          // Keep the global date selector visible on ALL pages (including Tools) for consistent header UX.
          var showDateSel = true;
          var globalDateSel = document.getElementById('global-date-select');
          if (globalDateSel) globalDateSel.style.display = showDateSel ? '' : 'none';

          syncDateSelectOptions();
          updateNextUpdateUi();

          function ensureKpis() {
            var staleKpis = !lastKpisFetchedAt || (Date.now() - lastKpisFetchedAt) > KPI_REFRESH_MS;
            if (staleKpis) refreshKpis({ force: false });
            else {
              renderLiveKpis(getKpiData());
              try { fetchCondensedSeries(); } catch (_) {}
            }
          }

          if (tab === 'tools') {
            ensureKpis();
            return;
          }
          if (tab === 'dashboard') {
            try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: false }); } catch (_) {}
            refreshKpis({ force: false }).then(function(data) {
              if (data) renderDashboardKpisFromApi(data);
            });
          } else if (tab === 'stats') {
            refreshStats({ force: false });
            ensureKpis();
          } else if (tab === 'products') {
            refreshProducts({ force: false });
            ensureKpis();
          } else if (tab === 'variants') {
            try { if (typeof window.__refreshVariantsInsights === 'function') window.__refreshVariantsInsights({ force: false }); } catch (_) {}
            ensureKpis();
          } else if (tab === 'channels' || tab === 'type') {
            refreshTraffic({ force: false });
            ensureKpis();
          } else if (tab === 'ads') {
            ensureKpis();
            ensureAdsLoaded().then(function(ok) {
              if (!ok) return;
              // IMPORTANT: if `/ads.js` is already present as a deferred script tag (e.g. on `/integrations/google-ads` page),
              // the promise can resolve before the script executes (microtask checkpoint after this script),
              // leaving Ads blank until another event triggers a refresh. Defer one macrotask so Ads JS has run.
              setTimeout(function() {
                try {
                  if (window.__adsInit) window.__adsInit();
                  else if (window.__adsRefresh) window.__adsRefresh({ force: false });
                } catch (_) {}
              }, 0);
            });
          } else {
            var sessionStaleMs = dateRange === 'live' ? LIVE_REFRESH_MS : (dateRange === 'today' || dateRange === 'sales' || dateRange === '1h' ? RANGE_REFRESH_MS : LIVE_REFRESH_MS);
            var staleSessions = !lastSessionsFetchedAt || (Date.now() - lastSessionsFetchedAt) > sessionStaleMs;
            if (staleSessions) fetchSessions();
            ensureKpis();
          }
        }

        function setTab(tab) {
          var isDashboard = tab === 'dashboard';
          var isSpy = tab === 'spy';
          var isStats = tab === 'stats';
          var isProducts = tab === 'products';
          var isAds = tab === 'ads';
          activeMainTab = tab;
          setHash(tab);

          if (pageTitleEl && !PAGE) {
            pageTitleEl.textContent = TAB_LABELS[tab] || 'Overview';
          }

          updateNavSelection(tab);
          if (panelDashboard) panelDashboard.classList.toggle('active', isDashboard);
          var isSales = tab === 'sales';
          var isDate = tab === 'date';
          if (panelSpy) panelSpy.classList.toggle('active', isSpy || isSales || isDate);
          if (panelStats) panelStats.classList.toggle('active', isStats);
          if (panelProducts) panelProducts.classList.toggle('active', isProducts);
          if (panelAds) panelAds.classList.toggle('active', isAds);

          try { sessionStorage.setItem(TAB_KEY, tab); } catch (_) {}
          runTabWork(tab);
          // Ensure navbar live visitors status updates immediately on navigation.
          try { updateKpis(); } catch (_) {}
        }

        try { window.setTab = setTab; } catch (_) {}

        if (PAGE) {
          var pageTab = PAGE === 'live' ? 'spy' : PAGE === 'countries' ? 'stats' : PAGE === 'sales' ? 'sales' : PAGE === 'date' ? 'date' : (PAGE === 'compare-conversion-rate' || PAGE === 'shipping-cr') ? 'tools' : PAGE;
          setTab(pageTab);
          return;
        }

        // Hash-based routing: hash overrides sessionStorage
        var initialTab = 'dashboard';
        var hashTab = tabFromHash();
        if (hashTab && VALID_TABS.indexOf(hashTab) !== -1) {
          initialTab = hashTab;
        } else {
          try {
            var saved = sessionStorage.getItem(TAB_KEY);
            if (saved && VALID_TABS.indexOf(saved) !== -1) initialTab = saved;
          } catch (_) {}
        }
        setTab(initialTab);

        window.addEventListener('hashchange', function() {
          if (hashUpdateInProgress) return;
          var t = tabFromHash();
          if (t && VALID_TABS.indexOf(t) !== -1 && t !== activeMainTab) setTab(t);
        });

        if (tabDashboard) tabDashboard.addEventListener('click', function() { setTab('dashboard'); });
        if (tabSpy) tabSpy.addEventListener('click', function() { setTab('spy'); });
        if (tabStats) tabStats.addEventListener('click', function() { setTab('stats'); });
        if (tabProducts) tabProducts.addEventListener('click', function() { setTab('products'); });
        if (tabAds) tabAds.addEventListener('click', function() { setTab('ads'); });
        if (tabTools) tabTools.addEventListener('click', function() { setTab('tools'); });
      })();
      (function initTopNavMobileBehavior() {
        const navLeft = document.querySelector('.kexo-desktop-nav-left');
        if (!navLeft) return;

        function isMobileViewport() {
          try {
            if (typeof window.matchMedia === 'function') return window.matchMedia('(max-width: 991.98px)').matches;
          } catch (_) {}
          return (window.innerWidth || 0) < 992;
        }

        function syncDropdownOverflowState() {
          if (!isMobileViewport()) {
            navLeft.classList.remove('is-dropdown-open');
            return;
          }
          const hasOpenMenu = !!navLeft.querySelector('.dropdown-menu.show');
          navLeft.classList.toggle('is-dropdown-open', hasOpenMenu);
        }

        function resetNavStartPosition() {
          if (!isMobileViewport()) return;
          try { navLeft.scrollLeft = 0; } catch (_) {}
        }

        navLeft.addEventListener('show.bs.dropdown', function() {
          if (!isMobileViewport()) return;
          navLeft.classList.add('is-dropdown-open');
        });

        navLeft.addEventListener('hide.bs.dropdown', function() {
          if (!isMobileViewport()) return;
          setTimeout(syncDropdownOverflowState, 0);
        });

        window.addEventListener('resize', function() {
          syncDropdownOverflowState();
        }, { passive: true });
        window.addEventListener('orientationchange', function() {
          resetNavStartPosition();
          syncDropdownOverflowState();
        });
        window.addEventListener('pageshow', function() {
          resetNavStartPosition();
          syncDropdownOverflowState();
        });

        resetNavStartPosition();
        syncDropdownOverflowState();
      })();
      (function initStripDropdownAlign() {
        function positionStripDropdown(menu) {
          if (!menu || !menu.classList.contains('kexo-strip-dropdown-align')) return;
          const nav = document.querySelector('.kexo-desktop-nav-container');
          const strip = document.querySelector('.kexo-desktop-top-strip');
          if (!nav || !strip) return;
          const navRect = nav.getBoundingClientRect();
          const stripRect = strip.getBoundingClientRect();
          menu.style.setProperty('position', 'fixed');
          menu.style.setProperty('left', navRect.left + 'px');
          menu.style.setProperty('top', (stripRect.bottom + 5) + 'px');
          menu.style.setProperty('right', 'auto');
        }
        function onStripDropdownShown(e) {
          const menu = e.target.querySelector('.dropdown-menu.kexo-strip-dropdown-align');
          if (!menu) return;
          positionStripDropdown(menu);
          requestAnimationFrame(function() { positionStripDropdown(menu); });
        }
        document.querySelectorAll('.kexo-desktop-top-strip .dropdown').forEach(function(dd) {
          dd.addEventListener('shown.bs.dropdown', onStripDropdownShown);
        });
        window.addEventListener('resize', function() {
          document.querySelectorAll('.dropdown-menu.kexo-strip-dropdown-align.show').forEach(positionStripDropdown);
        }, { passive: true });
      })();
      (function initRefreshBtn() {
        const btn = document.getElementById('refresh-btn');
        if (btn) {
          btn.addEventListener('click', function() {
            if (updateAvailable) {
              try { window.location.reload(); } catch (_) { try { window.location.href = window.location.href; } catch (_) {} }
              return;
            }
            btn.classList.add('refresh-spinning');
            setTimeout(function() { btn.classList.remove('refresh-spinning'); }, 600);
            try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
            if (activeMainTab === 'dashboard') { try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: true }); } catch (_) {} }
            else if (activeMainTab === 'stats') refreshStats({ force: true });
            else if (activeMainTab === 'products') refreshProducts({ force: true });
            else if (activeMainTab === 'variants') { try { if (typeof window.__refreshVariantsInsights === 'function') window.__refreshVariantsInsights({ force: true }); } catch (_) {} }
            else if (activeMainTab === 'channels' || activeMainTab === 'type') refreshTraffic({ force: true });
            else if (activeMainTab === 'ads') { try { if (window.__adsRefresh) window.__adsRefresh({ force: true }); } catch (_) {} }
            else fetchSessions();
          });
        }
      })();
      updateServerTimeDisplay();
      updateNextUpdateUi();
      _intervals.push(setInterval(function() {
        updateServerTimeDisplay();
        updateNextUpdateUi();
      }, 1000));
    })();

    (function setupStatsCardScrollHideHeader() {
      function onScroll(wrapId, cardId) {
        const wrap = document.getElementById(wrapId);
        const card = document.getElementById(cardId);
        if (!wrap || !card) return;
        function update() {
          card.classList.toggle('scrolled', wrap.scrollTop > 0);
        }
        wrap.addEventListener('scroll', update);
        update();
      }
      onScroll('country-table-wrap', 'stats-country');
      onScroll('best-sellers-wrap', 'stats-best-sellers');
      onScroll('best-variants-wrap', 'stats-best-variants');
    })();

    // Load traffic source mapping + custom icons (best-effort).
    try { refreshTrafficSourceMeta({ force: false }); } catch (_) {}

    function liveSalesAutoPollEnabled() {
      return PAGE === 'live' || PAGE === 'sales';
    }

    function liveSalesCanAutoApply() {
      if (!liveSalesAutoPollEnabled()) return false;
      if (document.visibilityState !== 'visible') return false;
      // Pause while interacting (sorting/paging). New data will be queued and applied on demand.
      try { if (typeof currentPage === 'number' && currentPage !== 1) return false; } catch (_) {}
      try {
        const sb = sortBy != null ? String(sortBy) : '';
        const sd = sortDir != null ? String(sortDir) : '';
        const isDefaultSort = (sb === 'last_seen' && sd === 'desc');
        if (sb && !isDefaultSort) return false;
      } catch (_) {}
      return true;
    }

    function liveSalesPollUrl() {
      if (PAGE === 'live') {
        return API + '/api/sessions?filter=active&_=' + Date.now();
      }
      // Sales page: always poll the "top page" so new rows are detected even if user is paging.
      var limit = rowsPerPage;
      var offset = 0;
      return API + '/api/sessions?range=' + encodeURIComponent(normalizeRangeKeyForApi('sales')) + '&limit=' + limit + '&offset=' + offset + '&timezone=' + encodeURIComponent(tz) + '&_=' + Date.now();
    }

    function setLiveSalesNextAt(ts) {
      var n = typeof ts === 'number' && isFinite(ts) ? ts : (Date.now() + LIVE_SALES_POLL_MS);
      if (PAGE === 'live') nextLiveAt = n;
      else nextRangeAt = n;
      updateNextUpdateUi();
    }

    function scheduleLiveSalesPoll(ms) {
      if (!liveSalesAutoPollEnabled()) return;
      if (liveSalesPollTimer) { try { clearTimeout(liveSalesPollTimer); } catch (_) {} liveSalesPollTimer = null; }
      var delay = (typeof ms === 'number' && isFinite(ms) && ms >= 0) ? ms : LIVE_SALES_POLL_MS;
      setLiveSalesNextAt(Date.now() + delay);
      liveSalesPollTimer = setTimeout(function() { try { runLiveSalesPoll(); } catch (_) {} }, delay);
    }

    function applyLiveSalesPayload(data) {
      if (!data) return;
      if (PAGE === 'live') {
        sessionsTotal = null;
        var next = data.sessions || [];
        var cutoff = Date.now() - ACTIVE_WINDOW_MS;
        var arrivedCutoff = Date.now() - ARRIVED_WINDOW_MS;
        next = next.filter(function(s) {
          return (s.last_seen != null && s.last_seen >= cutoff) &&
            (s.started_at != null && s.started_at >= arrivedCutoff);
        });
        next.sort(function(a, b) { return (b.last_seen || 0) - (a.last_seen || 0); });
        sessions = next;
        lastSessionsMode = 'live';
        lastSessionsFetchedAt = Date.now();
        lastUpdateTime = new Date();
        updateServerTimeDisplay();
        renderTable();
        updateKpis();
        try { refreshSessionPageCharts({ force: false }); } catch (_) {}
        return;
      }

      // Sales (range mode)
      sessions = data.sessions || [];
      sessionsTotal = typeof data.total === 'number' ? data.total : sessions.length;
      lastSessionsMode = 'range';
      lastSessionsFetchedAt = Date.now();
      lastUpdateTime = new Date();
      updateServerTimeDisplay();
      renderTable();
      updateKpis();
      try { refreshSessionPageCharts({ force: false }); } catch (_) {}
    }

    function applyLiveSalesPending() {
      if (!liveSalesPendingPayload) return false;
      const payload = liveSalesPendingPayload;
      liveSalesPendingPayload = null;
      liveSalesPendingAt = 0;
      // Newest rows are at the top; jump to page 1 so the update is visible.
      try { currentPage = 1; } catch (_) {}
      try { applyLiveSalesPayload(payload); } catch (_) {}
      try { updateNextUpdateUi(); } catch (_) {}
      return true;
    }

    function runLiveSalesPoll() {
      if (!liveSalesAutoPollEnabled()) return;
      // Always reschedule first so we don't stop polling if something throws.
      scheduleLiveSalesPoll(LIVE_SALES_POLL_MS);
      if (document.visibilityState !== 'visible') return;
      if (liveSalesPollInFlight) return;
      var url = liveSalesPollUrl();
      liveSalesPollInFlight = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          if (!data) return;
          if (liveSalesPendingPayload || !liveSalesCanAutoApply()) {
            liveSalesPendingPayload = data;
            liveSalesPendingAt = Date.now();
            try { updateNextUpdateUi(); } catch (_) {}
            return;
          }
          liveSalesPendingPayload = null;
          liveSalesPendingAt = 0;
          applyLiveSalesPayload(data);
        })
        .catch(function() {})
        .finally(function() { liveSalesPollInFlight = null; });
    }

    (function initLiveSalesPoller() {
      if (!liveSalesAutoPollEnabled()) return;
      // Defer the first poll slightly so initial page load fetch/render completes first.
      scheduleLiveSalesPoll(LIVE_SALES_POLL_MS);
    })();

    function onLiveAutoRefreshTick() {
      if (activeMainTab !== 'spy') return;
      if (dateRange !== 'live') return;
      if (document.visibilityState !== 'visible') return;
      fetchSessions();
    }

    function onRangeAutoRefreshTick() {
      if (activeMainTab !== 'spy') return;
      if (dateRange !== 'today' && dateRange !== 'sales' && dateRange !== '1h') return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() < nextRangeAt) return;
      fetchSessions();
    }

    function onStatsAutoRefreshTick() {
      if (activeMainTab !== 'stats') return;
      if (getStatsRange() !== 'today') return;
      if (document.visibilityState !== 'visible') return;
      refreshStats({ force: false });
    }

    function onKpisAutoRefreshTick() {
      if (document.visibilityState !== 'visible') return;
      if (activeMainTab === 'dashboard' || activeMainTab === 'tools') return;
      refreshKpis({ force: false });
    }

    function onProductsAutoRefreshTick() {
      if (activeMainTab !== 'products') return;
      if (getStatsRange() !== 'today') return;
      if (document.visibilityState !== 'visible') return;
      refreshProducts({ force: false });
    }

    function onTrafficAutoRefreshTick() {
      if (activeMainTab !== 'channels' && activeMainTab !== 'type') return;
      if (getStatsRange() !== 'today') return;
      if (document.visibilityState !== 'visible') return;
      refreshTraffic({ force: false });
    }

    // Background polling is intentionally disabled across the site (manual refresh only),
    // except for /dashboard/live and /dashboard/sales (which use a dedicated 10s poller).
    _intervals.push(setInterval(tickTimeOnSite, 30000));

    // ── Tab resume + deploy drift guard ─────────────────────────────────────
    // In Safari/iOS (and some embed contexts) long-idle tabs can resume with a "white page"
    // or broken JS/CSS if a deploy happened while the tab was backgrounded. We expose an
    // assetVersion signal via /api/version; if it changes while hidden, hard-reload on resume.
    var _bootVersionSig = null;
    var _lastHiddenAt = 0;
    var _versionCheckInFlight = null;
    var RESUME_RELOAD_IDLE_MS = 10 * 60 * 1000;

    function fetchVersionSig() {
      if (_versionCheckInFlight) return _versionCheckInFlight;
      _versionCheckInFlight = fetch(API + '/api/version', { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
          _versionCheckInFlight = null;
          if (!data) return null;
          var av = data.assetVersion != null ? String(data.assetVersion) : '';
          var pv = data.version != null ? String(data.version) : '';
          var sig = (av || pv) ? (av + '|' + pv) : '';
          return sig && sig.trim() ? sig : null;
        })
        .catch(function() { _versionCheckInFlight = null; return null; });
      return _versionCheckInFlight;
    }

    try {
      fetchVersionSig().then(function(sig) { if (sig) _bootVersionSig = sig; });
    } catch (_) {}

    function onBecameVisible() {
      updateServerTimeDisplay();
      updateNextUpdateUi();
    }

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible') {
        _lastHiddenAt = Date.now();
        return;
      }

      var idleMs = _lastHiddenAt ? (Date.now() - _lastHiddenAt) : 0;
      if (idleMs < RESUME_RELOAD_IDLE_MS) return onBecameVisible();

      fetchVersionSig()
        .then(function(sig) {
          if (_bootVersionSig && sig && sig !== _bootVersionSig) {
            try { setUpdateAvailable(true, { reason: 'New deploy detected.' }); } catch (_) {}
            try { _bootVersionSig = sig; } catch (_) {}
            return onBecameVisible();
          }
          if (!_bootVersionSig && sig) _bootVersionSig = sig;
          onBecameVisible();
        })
        .catch(function() {
          onBecameVisible();
        });
    });

    function initEventSource() {
      if (_eventSource) { try { _eventSource.close(); } catch (_) {} }
      var es = new EventSource(API + '/api/stream');
      _eventSource = es;
      es.onerror = function() {
        // Browser auto-reconnects on transient errors; if the connection is
        // permanently closed (readyState === CLOSED), retry after a delay.
        if (es.readyState === EventSource.CLOSED) {
          try { es.close(); } catch (_) {}
          setTimeout(function() { if (_eventSource === es) initEventSource(); }, 5000);
        }
      };

      function maybePatchActiveSaleToastAmount(session) {
        // If the toast is currently showing for this session, patch the amount when order_total arrives.
        try {
          const sid = session && session.session_id != null ? String(session.session_id) : '';
          if (!sid || !saleToastActive || !saleToastSessionId || String(saleToastSessionId) !== sid) return;
          const cc = session && session.country_code ? String(session.country_code).toUpperCase().slice(0, 2) : 'XX';
          const productTitle = (session && session.last_product_handle) ? titleCaseFromHandle(String(session.last_product_handle)) : '';
          const curTitle = document.getElementById('sale-toast-product') ? String(document.getElementById('sale-toast-product').textContent || '') : '';
          let amountGbp = null;
          if (session && session.order_total != null) {
            const n = typeof session.order_total === 'number' ? session.order_total : parseFloat(String(session.order_total));
            if (Number.isFinite(n)) amountGbp = n;
          }
          if (amountGbp != null && Number.isFinite(amountGbp)) {
            setSaleToastContent({ countryCode: cc || 'XX', productTitle: (productTitle || curTitle || '—'), amountGbp });
          }
        } catch (_) {}
      }

      function maybeTriggerSaleToastFromSse(session) {
        try {
          if (!session || !session.has_purchased) return;
          const purchasedAt = session.purchased_at != null ? toMs(session.purchased_at) : null;
          if (purchasedAt == null) return;
          const cur = lastSaleAt == null ? null : toMs(lastSaleAt);
          // If we don't have a baseline yet, prime it without firing a toast.
          if (cur == null) { setLastSaleAt(purchasedAt); return; }
          if (purchasedAt <= cur) { setLastSaleAt(purchasedAt); return; }
          setLastSaleAt(purchasedAt);
          triggerSaleToast({ origin: 'sse', session: session, playSound: true });
        } catch (_) {}
      }

      es.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'session_update' && msg.session) {
            const session = msg.session;
            // Keep footer "Last sale" correct and show the banner globally.
            if (session && session.has_purchased && session.purchased_at != null) {
              maybeTriggerSaleToastFromSse(session);
              maybePatchActiveSaleToastAmount(session);
              try { upsertLatestSaleRow(session); } catch (_) {}
            }
          }
        } catch (_) {}
      };
    }
    initEventSource();

    // ── Cleanup on page unload ──
    window.addEventListener('beforeunload', function() {
      _intervals.forEach(function(id) { clearInterval(id); });
      _intervals.length = 0;
      if (liveSalesPollTimer) { try { clearTimeout(liveSalesPollTimer); } catch (_) {} liveSalesPollTimer = null; }
      if (_eventSource) { try { _eventSource.close(); } catch (_) {} _eventSource = null; }
      Object.keys(_fetchAbortControllers).forEach(function(k) {
        try { _fetchAbortControllers[k].abort(); } catch (_) {}
      });
    });

    // ── Dashboard tab logic ──────────────────────────────────────────────
    (function initDashboard() {
      var dashLoading = false;
      var dashLastRangeKey = null;
      var dashLastDayYmd = null;
      var dashCompareSeriesCache = null;
      var dashCompareRangeKey = null;
      var dashCompareFetchedAt = 0;
      var dashCompareSeriesInFlight = null;
      var dashCharts = {};
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
        var fresh = dashCompareRangeKey === compareRangeKey &&
          Array.isArray(dashCompareSeriesCache) &&
          dashCompareSeriesCache.length >= 2 &&
          dashCompareFetchedAt &&
          (Date.now() - dashCompareFetchedAt) < KPI_CACHE_TTL_MS;
        if (fresh) return Promise.resolve(dashCompareSeriesCache);
        if (dashCompareSeriesInFlight && dashCompareRangeKey === compareRangeKey) return dashCompareSeriesInFlight;
        dashCompareRangeKey = compareRangeKey;
        var url = API + '/api/dashboard-series?range=' + encodeURIComponent(compareRangeKey);
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

          var fillConfig = chartType === 'line' ? { type: 'solid', opacity: 0 }
            : chartType === 'bar' ? { type: 'solid', opacity: 1 }
            : { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: areaOpacityFrom, opacityTo: areaOpacityTo, stops: [0, 100] } };

          var apexOpts = {
            chart: {
              type: chartType,
              height: 200,
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
              animations: { enabled: true, easing: 'easeinout', speed: 300 },
              zoom: { enabled: false }
            },
            series: apexSeries,
            colors: colors,
            stroke: { width: chartType === 'bar' ? 0 : 2, curve: 'smooth' },
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
        function renderSparkline(elId, dataArr, color, type) {
          var sparkEl = el(elId);
          if (!sparkEl || typeof ApexCharts === 'undefined') return;
          if (dataArr.length < 2) dataArr = dataArr.length === 1 ? [dataArr[0], dataArr[0]] : [0, 0];
          sparkEl.innerHTML = '';
          var sparkCurve = 'smooth';

          var nums = dataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return isFinite(n) ? n : 0;
          });
          var minVal = nums[0];
          var maxVal = nums[0];
          for (var i = 1; i < nums.length; i++) {
            if (nums[i] < minVal) minVal = nums[i];
            if (nums[i] > maxVal) maxVal = nums[i];
          }
          if (!isFinite(minVal)) minVal = 0;
          if (!isFinite(maxVal)) maxVal = 0;

          // Flat/near-flat series can render as visually empty at 40px height.
          // Keep a truly zero series flat/neutral; only bump non-zero flat lines.
          var span = Math.abs(maxVal - minVal);
          var allZero = span < 1e-9 && nums.every(function(v) { return Math.abs(v) < 1e-9; });
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

          var chartType = String(type || '').toLowerCase() === 'area' ? 'area' : 'line';
          var isArea = chartType === 'area';
          var chart = new ApexCharts(sparkEl, {
            chart: { type: chartType, height: 50, sparkline: { enabled: true }, animations: { enabled: false } },
            series: [{ name: 'Trend', data: nums }],
            stroke: { width: 2.55, curve: sparkCurve, lineCap: 'round' },
            fill: { type: 'solid', opacity: isArea ? 0.28 : 1 },
            colors: [color],
            yaxis: { min: yMin, max: yMax },
            markers: { size: 0 },
            grid: { padding: { top: 0, right: 0, bottom: -3, left: 0 } },
            tooltip: { enabled: false }
          });
          chart.render();
        }
        function sparkToneColor(dataArr) {
          var GREEN = '#16a34a';
          var RED = '#dc2626';
          var NEUTRAL = '#3eb3ab';
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
          var GREEN = '#16a34a';
          var RED = '#dc2626';
          var NEUTRAL = '#3eb3ab';
          var cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
          var base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
          if (cur == null || base == null) return NEUTRAL;
          var delta = cur - base;
          if (invert) delta = -delta;
          if (Math.abs(delta) < 1e-9) return NEUTRAL;
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
        function sparkSeriesFromCompare(current, baseline, fallbackDataArr) {
          var cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
          var base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
          if (Array.isArray(fallbackDataArr) && fallbackDataArr.length >= 2) {
            var hist = fallbackDataArr.map(function(v) {
              var n = (typeof v === 'number') ? v : Number(v);
              return Number.isFinite(n) ? n : 0;
            });
            if (cur != null) {
              var lastVal = hist[hist.length - 1];
              if (Math.abs(lastVal) < 1e-9) {
                var offset = cur - lastVal;
                hist = hist.map(function(v) { return v + offset; });
              } else {
                var ratio = cur / lastVal;
                if (!Number.isFinite(ratio)) ratio = 1;
                ratio = Math.max(-6, Math.min(6, ratio));
                hist = hist.map(function(v) { return v * ratio; });
              }
              hist[hist.length - 1] = cur;
            }
            return hist;
          }
          if (cur != null && base != null) return [base, cur];
          return Array.isArray(fallbackDataArr) ? fallbackDataArr : [];
        }
        function sparkCompareSeries(primaryDataArr, current, baseline) {
          var base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
          if (base == null || !Array.isArray(primaryDataArr) || primaryDataArr.length < 2) return null;
          var arr = primaryDataArr.map(function(v) {
            var n = (typeof v === 'number') ? v : Number(v);
            return Number.isFinite(n) ? n : 0;
          });
          var lastVal = arr[arr.length - 1];
          if (Math.abs(lastVal) < 1e-9) {
            var offset = base - lastVal;
            arr = arr.map(function(v) { return v + offset; });
          } else {
            var ratio = base / lastVal;
            if (!Number.isFinite(ratio)) ratio = 1;
            ratio = Math.max(-6, Math.min(6, ratio));
            arr = arr.map(function(v) { return v * ratio; });
          }
          arr[arr.length - 1] = base;
          return arr;
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
        var fulfilledSpark = sparkSeriesFromCompare(currentFulfilledTone, compareFulfilledTone, ordersHistorySpark);
        var returnsSpark = sparkSeriesFromCompare(currentReturnsTone, compareReturnsTone, revenueHistorySpark);
        var cogsSpark = sparkSeriesFromCompare(currentCogsTone, compareCogsTone, revenueHistorySpark);
        var roasSpark = sparkSeriesFromCompare(currentRoasTone, compareRoasTone, roasHistorySpark);
        renderSparkline('dash-revenue-sparkline', revenueSpark, sparkToneFromCompare(currentRevenueTone, compareRevenueTone, false, revenueSpark), 'area');
        renderSparkline('dash-sessions-sparkline', sessionsSpark, sparkToneFromCompare(currentSessionsTone, compareSessionsTone, false, sessionsSpark), 'area');
        renderSparkline('dash-orders-sparkline', ordersSpark, sparkToneFromCompare(currentOrdersTone, compareOrdersTone, false, ordersSpark), 'area');
        renderSparkline('dash-returning-sparkline', returningSpark, sparkToneFromCompare(currentReturningTone, compareReturningTone, false, returningSpark), 'area');
        renderSparkline('dash-conv-sparkline', convSpark, sparkToneFromCompare(currentConvTone, compareConvTone, false, convSpark), 'area');
        renderSparkline('dash-aov-sparkline', aovSpark, sparkToneFromCompare(currentAovTone, compareAovTone, false, aovSpark), 'area');
        renderSparkline('dash-bounce-sparkline', bounceSpark, sparkToneFromCompare(currentBounceTone, compareBounceTone, true, bounceSpark), 'area');
        renderSparkline('dash-roas-sparkline', roasSpark, sparkToneFromCompare(currentRoasTone, compareRoasTone, false, roasSpark), 'area');
        renderSparkline('dash-items-sparkline', itemsSpark, sparkToneFromCompare(currentItemsTone, compareItemsTone, false, itemsSpark), 'area');
        renderSparkline('dash-fulfilled-sparkline', fulfilledSpark, sparkToneFromCompare(currentFulfilledTone, compareFulfilledTone, false, fulfilledSpark), 'area');
        renderSparkline('dash-returns-sparkline', returnsSpark, sparkToneFromCompare(currentReturnsTone, compareReturnsTone, true, returnsSpark), 'area');
        renderSparkline('dash-cogs-sparkline', cogsSpark, sparkToneFromCompare(currentCogsTone, compareCogsTone, true, cogsSpark), 'area');

        try { if (typeof renderCondensedSparklines === 'function') renderCondensedSparklines(sparklineSeries); } catch (_) {}

        var bucket = data && data.bucket ? String(data.bucket) : 'day';
        var labels = chartSeries.map(function(d) {
          return bucket === 'hour' ? shortHourLabel(d.date) : shortDate(d.date);
        });

        makeChart('dash-chart-revenue', labels, [{
          label: 'Revenue',
          data: chartSeries.map(function(d) { return d.revenue; }),
          borderColor: DASH_ACCENT,
          backgroundColor: DASH_ACCENT_LIGHT,
          fill: true,
          borderWidth: 2
        }], { currency: true, chartType: 'area', areaOpacityFrom: 0.58, areaOpacityTo: 0.18 });

        makeChart('dash-chart-orders', labels, [{
          label: 'Orders',
          data: chartSeries.map(function(d) { return d.orders; }),
          borderColor: DASH_BLUE,
          backgroundColor: DASH_BLUE_LIGHT,
          fill: true,
          borderWidth: 2
        }], { chartType: 'area', areaOpacityFrom: 0.58, areaOpacityTo: 0.18 });

        var hasShopifyConv = chartSeries.some(function(d) { return d.shopifyConvRate != null; });
        var convDatasets = [{
          label: 'Kexo Conv Rate',
          data: chartSeries.map(function(d) { return d.convRate; }),
          borderColor: DASH_PURPLE,
          backgroundColor: DASH_PURPLE_LIGHT,
          fill: true,
          borderWidth: 2
        }];
        if (hasShopifyConv) {
          convDatasets.push({
            label: 'Shopify Conv Rate',
            data: chartSeries.map(function(d) { return d.shopifyConvRate; }),
            borderColor: '#5c6ac4',
            backgroundColor: 'rgba(92,106,196,0.10)',
            fill: false,
            borderWidth: 2,
            borderDash: [5, 3]
          });
        }
        makeChart('dash-chart-conv', labels, convDatasets, { pct: true, chartType: 'area', areaOpacityFrom: 0.58, areaOpacityTo: 0.18 });

        makeChart('dash-chart-sessions', labels, [{
          label: 'Sessions',
          data: chartSeries.map(function(d) { return d.sessions; }),
          borderColor: DASH_ORANGE,
          backgroundColor: DASH_ORANGE_LIGHT,
          fill: true,
          borderWidth: 2
        }], { chartType: 'area', areaOpacityFrom: 0.58, areaOpacityTo: 0.18 });

        var hasAdSpend = chartSeries.some(function(d) { return d.adSpend > 0; });
        var adRow = el('dash-adspend-row');
        if (adRow) adRow.style.display = hasAdSpend ? '' : 'none';
        if (hasAdSpend) {
          makeChart('dash-chart-adspend', labels, [{
            label: 'Revenue',
            data: chartSeries.map(function(d) { return d.revenue; }),
            borderColor: DASH_ACCENT,
            backgroundColor: 'transparent',
            borderWidth: 2
          }, {
            label: 'Ad Spend',
            data: chartSeries.map(function(d) { return d.adSpend; }),
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239,68,68,0.08)',
            fill: true,
            borderWidth: 2
          }], { currency: true });
        }

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
            if (s === '\u2014') s = '£0.00';
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
          return;
        }
        fetchDashboardData(rk, force, { silent: silent });
      };

      // Initial fetch: refreshDashboard is defined after setTab('dashboard') runs,
      // so the initial setTab call can't trigger it. Kick it off now if dashboard is active.
      var dashPanel = document.getElementById('tab-panel-dashboard');
      if (dashPanel && (dashPanel.classList.contains('active') || PAGE === 'dashboard')) {
        fetchDashboardData(dashRangeKeyFromDateRange(), false);
      }
    })();

    // ── User avatar: fetch /api/me and populate ────────────────────────
    (function initUserAvatar() {
      try {
        var avatarEl = document.getElementById('user-avatar');
        var emailEl = document.getElementById('user-email');
        if (!avatarEl && !emailEl) return;
        fetch('/api/me').then(function(r) { return r.json(); }).then(function(d) {
          if (!d || !d.email) return;
          if (avatarEl && d.initial) avatarEl.textContent = d.initial;
          if (emailEl) emailEl.textContent = d.email;
        }).catch(function() {});
      } catch (_) {}
    })();

    // ── Online badge: populate website name from store config ────────────
    (function initOnlineBadgeWebsite() {
      try {
        var el = document.getElementById('kexo-online-website');
        if (!el) return;
        fetch('/api/store-base-url', { credentials: 'same-origin' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var domain = (d && d.shopDisplayDomain) ? String(d.shopDisplayDomain).trim() : '';
            el.textContent = domain || '\u2014';
            el.title = domain || '';
          })
          .catch(function() {});
      } catch (_) {}
    })();

    // ── Footer action buttons ──────────────────────────────────────────
    (function initFooterActions() {
      function proxyClick(footerSel, headerId) {
        document.querySelectorAll(footerSel).forEach(function(btn) {
          btn.addEventListener('click', function() {
            var h = document.getElementById(headerId);
            if (h) h.click();
          });
        });
      }
      proxyClick('.footer-refresh-btn', 'refresh-btn');
      proxyClick('.footer-audio-btn', 'audio-mute-btn');
      proxyClick('.footer-settings-refresh', 'refresh-btn');
      proxyClick('.footer-settings-audio', 'audio-mute-btn');
      var backToTop = document.getElementById('back-to-top-btn');
      if (backToTop) {
        backToTop.addEventListener('click', function() {
          function scrollToTop() {
            try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
            if (document.documentElement) document.documentElement.scrollTop = 0;
            if (document.body) document.body.scrollTop = 0;
            try { window.scrollTo(0, 0); } catch (_) {}
            if (window.parent !== window) {
              try { window.parent.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
              try { window.parent.scrollTo(0, 0); } catch (_) {}
            }
          }
          scrollToTop();
          requestAnimationFrame(scrollToTop);
        });
      }
    })();

    // ── Footer diagnostics strip (status tags from config-status) ───────
    (function initFooterDiagnostics() {
      var wrap = document.getElementById('kexo-footer-diagnostics');
      var tagsEl = document.getElementById('kexo-footer-diagnostics-tags');
      if (!wrap || !tagsEl) return;
      var url = API + '/api/config-status';
      try {
        var shop = (typeof getShopParam === 'function' ? getShopParam() : null) || (typeof shopForSalesFallback === 'string' && shopForSalesFallback ? shopForSalesFallback : null);
        if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);
      } catch (_) {}
      fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(c) {
          if (!c) return;
          var items = [];
          var px = c.pixel;
          var ads = c.ads && c.ads.status ? c.ads.status : null;
          var gaProvider = ads && Array.isArray(ads.providers) ? ads.providers.find(function(p) { return p && String(p.key || '').toLowerCase() === 'google_ads'; }) : null;
          var gaConnected = !!(gaProvider && gaProvider.connected);
          items.push({ key: 'pixel', label: 'Kexo Pixel', status: (px && px.installed === true) ? 'Online' : 'Offline', ok: !!(px && px.installed === true) });
          items.push({ key: 'google_ads', label: 'Google Ads', status: gaConnected ? 'Connected' : 'Offline', ok: gaConnected });
          var html = '';
          items.forEach(function(it) {
            var statusCls = it.ok ? 'kexo-status-indicator--online' : 'kexo-status-indicator--offline';
            var esc = function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
            html += '<div class="kexo-footer-diagnostics-tag">';
            html += '<a href="/settings?tab=diagnostics" class="kexo-footer-diagnostics-tag-link" title="' + esc(it.label) + ' ' + esc(it.status) + ' – click for diagnostics">';
            html += '<span class="kexo-footer-diagnostics-label">' + esc(it.label) + '</span>';
            html += '</a>';
            html += '<span class="kexo-footer-diagnostics-status">';
            html += '<span class="kexo-status-indicator ' + statusCls + '" aria-hidden="true"></span>' + esc(it.status);
            html += '</span>';
            html += '</div>';
          });
          tagsEl.innerHTML = html;
          wrap.style.display = 'block';
        })
        .catch(function() {});
    })();

    // ── Shared Product Insights modal ───────────────────────────────────
    (function initProductInsightsModal() {
      if (window.__productInsightsModalInit) return;
      window.__productInsightsModalInit = true;

      var modalEl = null;
      var currentMode = 'product'; // product | page
      var currentHandle = null;
      var currentProductId = null;
      var currentTitle = null;
      var currentProductUrl = null;
      var currentPageUrl = null;
      var currentLandingKind = null; // entry | exit (when opened from sessions table)
      var currentRangeKey = 'today'; // modal-local range; default Today regardless of page range
      var lastPayload = null;
      var backdropEl = null;
      var charts = { revenue: null, activity: null };
      var apexLoading = false;
      var apexWaiters = [];

      function isModifiedClick(e) {
        if (!e) return false;
        if (e.defaultPrevented) return true;
        if (e.button != null && e.button !== 0) return true; // only left click
        return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
      }

      function normalizeHandle(h) {
        if (!h) return '';
        return String(h).trim().toLowerCase().slice(0, 128);
      }

      function parseHandleFromHref(href) {
        if (!href) return '';
        try {
          var u = new URL(String(href), window.location.origin);
          var p = String(u.pathname || '');
          var m = p.match(/^\/products\/([^/?#]+)/i);
          if (m && m[1]) return normalizeHandle(decodeURIComponent(m[1]));
        } catch (_) {}
        var raw = String(href);
        var m2 = raw.match(/\/products\/([^/?#]+)/i);
        return m2 && m2[1] ? normalizeHandle(m2[1]) : '';
      }

      function ensureApexCharts(cb) {
        if (typeof ApexCharts !== 'undefined') { cb(); return; }
        apexWaiters.push(cb);
        if (apexLoading) return;
        apexLoading = true;
        try {
          var s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/apexcharts@4.7.0/dist/apexcharts.min.js';
          s.defer = true;
          s.onload = function() {
            apexLoading = false;
            var q = apexWaiters.slice();
            apexWaiters = [];
            q.forEach(function(fn) { try { fn(); } catch (_) {} });
          };
          s.onerror = function() { apexLoading = false; apexWaiters = []; };
          document.head.appendChild(s);
        } catch (_) {
          apexLoading = false;
          apexWaiters = [];
        }
      }

      function destroyCharts() {
        try { if (charts.revenue) charts.revenue.destroy(); } catch (_) {}
        try { if (charts.activity) charts.activity.destroy(); } catch (_) {}
        charts.revenue = null;
        charts.activity = null;
      }

      function ensureDom() {
        if (modalEl) return modalEl;
        modalEl = document.getElementById('product-insights-modal');
        if (modalEl) return modalEl;

        var wrap = document.createElement('div');
        wrap.className = 'modal modal-blur fade';
        wrap.id = 'product-insights-modal';
        wrap.tabIndex = -1;
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.display = 'none';
        wrap.innerHTML =
          '<div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="dialog">' +
            '<div class="modal-content">' +
              '<div class="modal-header p-4">' +
                '<h5 class="modal-title" id="product-insights-title">Product</h5>' +
                '<div class="ms-auto d-flex align-items-center gap-2">' +
                  '<select class="form-select form-select-sm" id="product-insights-range" aria-label="Date range">' +
                    '<option value="today" selected>Today</option>' +
                    '<option value="yesterday">Yesterday</option>' +
                    '<option value="3d">Last 3 days</option>' +
                    '<option value="7d">Last 7 days</option>' +
                    '<option value="14d">Last 14 days</option>' +
                    '<option value="30d">Last 30 days</option>' +
                  '</select>' +
                  '<button type="button" class="btn-close" id="product-insights-close" aria-label="Close"></button>' +
                '</div>' +
              '</div>' +
              '<div class="modal-body">' +
                '<div id="product-insights-status" class="text-muted">Loading…</div>' +
                '<div id="product-insights-body" style="display:none">' +
                  '<div class="row g-3">' +
                    '<div class="col-12 col-lg-5" id="product-insights-col-left">' +
                      '<div class="card">' +
                        '<div class="card-body">' +
                          '<div class="kexo-product-gallery">' +
                            '<div class="product-insights-main-img-wrap">' +
                              '<img id="product-insights-main-img" class="img-fluid" alt="">' +
                            '</div>' +
                            '<div class="product-insights-thumbs-bar" aria-label="Product images">' +
                              '<button type="button" class="btn btn-icon btn-ghost-secondary product-insights-thumb-arrow" id="product-insights-thumbs-left" aria-label="Scroll thumbnails left" style="display:none">' +
                                '<i class="fa-light fa-chevron-left" aria-hidden="true"></i>' +
                              '</button>' +
                              '<div class="product-insights-thumbs-strip" id="product-insights-thumbs"></div>' +
                              '<button type="button" class="btn btn-icon btn-ghost-secondary product-insights-thumb-arrow" id="product-insights-thumbs-right" aria-label="Scroll thumbnails right" style="display:none">' +
                                '<i class="fa-light fa-chevron-right" aria-hidden="true"></i>' +
                              '</button>' +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                      '</div>' +
                      '<div class="card mt-3 kexo-card-collapsed" data-collapse-id="product-insights-revenue">' +
                        '<div class="card-header"><h3 class="card-title">Revenue</h3></div>' +
                        '<div class="card-body"><div id="product-insights-chart-revenue" class="dash-chart-wrap" style="min-height:240px"></div></div>' +
                      '</div>' +
                      '<div class="card mt-3 kexo-card-collapsed" data-collapse-id="product-insights-demand">' +
                        '<div class="card-header"><h3 class="card-title">Demand signals</h3></div>' +
                        '<div class="card-body"><div id="product-insights-chart-activity" class="dash-chart-wrap" style="min-height:240px"></div></div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="col-12 col-lg-7" id="product-insights-col-right">' +
                      '<div class="card" data-no-card-collapse="1">' +
                        '<div class="card-header"><h3 class="card-title" id="product-insights-details-title">Product details</h3></div>' +
                        '<div>' + (typeof buildKexoNativeTable === 'function' ? buildKexoNativeTable({
                          tableId: 'product-insights-metrics-table-wrap',
                          bodyId: 'product-insights-metrics-table',
                          tableClass: 'table table-vcenter card-table table-sm kexo-product-insights-metrics',
                          columns: (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['product-insights-metrics-table'] && window.KEXO_APP_MODAL_TABLE_DEFS['product-insights-metrics-table'].columns) || [
                            { header: 'Metric', headerClass: '' },
                            { header: 'Value', headerClass: 'text-end' }
                          ]
                        }) : '<div class="table-responsive"><table class="table table-vcenter card-table table-sm kexo-product-insights-metrics"><thead><tr><th>Metric</th><th class="text-end">Value</th></tr></thead><tbody id="product-insights-metrics-table"></tbody></table></div>') + '</div>' +
                      '</div>' +
                      '<div class="card mt-3" data-no-card-collapse="1" id="product-insights-top-countries-card" style="display:none">' +
                        '<div class="card-header"><h3 class="card-title">Top countries</h3></div>' +
                        '<div class="card-body">' +
                          '<div id="product-insights-top-countries" class="d-grid gap-2"></div>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="modal-footer d-flex align-items-center justify-content-end gap-2 p-4">' +
                '<a class="btn btn-primary" id="product-insights-open-admin" href="#" target="_blank" rel="noopener" style="display:none">Edit on Shopify</a>' +
                '<a class="btn btn-secondary" id="product-insights-open-store" href="#" target="_blank" rel="noopener">View on Website</a>' +
              '</div>' +
            '</div>' +
          '</div>';

        document.body.appendChild(wrap);
        modalEl = wrap;

        var closeBtn = document.getElementById('product-insights-close');
        if (closeBtn) closeBtn.addEventListener('click', function() { close(); });
        modalEl.addEventListener('click', function(e) { if (e && e.target === modalEl) close(); });
        document.addEventListener('keydown', function(e) {
          if (!modalEl || !modalEl.classList.contains('show')) return;
          var key = e && (e.key || e.code) ? String(e.key || e.code) : '';
          if (key === 'Escape') close();
        });

        var sel = document.getElementById('product-insights-range');
        if (sel) {
          sel.addEventListener('change', function() {
            var v = sel.value || 'today';
            currentRangeKey = v;
            load();
          });
        }

        var thumbsLeft = document.getElementById('product-insights-thumbs-left');
        if (thumbsLeft) {
          thumbsLeft.addEventListener('click', function(e) {
            e.preventDefault();
            scrollThumbStrip(-1);
          });
        }
        var thumbsRight = document.getElementById('product-insights-thumbs-right');
        if (thumbsRight) {
          thumbsRight.addEventListener('click', function(e) {
            e.preventDefault();
            scrollThumbStrip(1);
          });
        }
        var thumbsStrip = document.getElementById('product-insights-thumbs');
        if (thumbsStrip) {
          thumbsStrip.addEventListener('scroll', function() {
            syncThumbStripArrows();
          }, { passive: true });
        }
        try {
          window.addEventListener('resize', function() { syncThumbStripArrows(); syncMainImageBalance(); });
        } catch (_) {}

        // When collapsed chart cards are expanded, render charts at the right size.
        modalEl.addEventListener('click', function(e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('.kexo-card-collapse-toggle') : null;
          if (!btn) return;
          setTimeout(function() {
            try { syncMainImageBalance(); } catch (_) {}
            try { if (lastPayload) renderCharts(lastPayload); } catch (_) {}
          }, 160);
        });

        return modalEl;
      }

      function ensureBackdrop() {
        if (backdropEl && backdropEl.parentNode) return;
        var el = document.createElement('div');
        el.className = 'modal-backdrop fade show product-insights-backdrop';
        document.body.appendChild(el);
        backdropEl = el;
      }

      function removeBackdrop() {
        if (backdropEl && backdropEl.parentNode) {
          backdropEl.parentNode.removeChild(backdropEl);
        }
        backdropEl = null;
      }

      function show() {
        ensureDom();
        ensureBackdrop();
        modalEl.style.display = 'block';
        modalEl.classList.add('show');
        modalEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
      }

      function close() {
        if (!modalEl) return;
        modalEl.style.display = 'none';
        modalEl.classList.remove('show');
        modalEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        removeBackdrop();
        destroyCharts();
        currentMode = 'product';
        currentHandle = null;
        currentProductId = null;
        currentTitle = null;
        currentProductUrl = null;
        currentPageUrl = null;
        currentLandingKind = null;
      }

      function setStatus(msg) {
        var s = document.getElementById('product-insights-status');
        var b = document.getElementById('product-insights-body');
        if (s) s.textContent = msg || '';
        if (b) b.style.display = 'none';
        if (s) s.style.display = msg ? 'block' : 'none';
      }

      function fmtNum(n) {
        var x = (typeof n === 'number') ? n : Number(n);
        if (!isFinite(x)) return '—';
        try { return x.toLocaleString('en-GB'); } catch (_) { return String(Math.round(x)); }
      }

      function fmtMoneyGbp(n) {
        var x = (typeof n === 'number') ? n : Number(n);
        if (!isFinite(x)) return '—';
        try { return '£' + x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return '£' + x.toFixed(2); }
      }

      function fmtPct(n) {
        var x = (typeof n === 'number') ? n : Number(n);
        if (!isFinite(x)) return '—';
        return x.toFixed(2) + '%';
      }

      function labelForTs(ts, isHourly) {
        try {
          var d = new Date(Number(ts));
          if (isHourly) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        } catch (_) {
          return '';
        }
      }

      function renderCharts(payload) {
        if (!payload || !payload.series || !payload.series.points) return;
        var points = payload.series.points || [];
        var isHourly = !!(payload.series && payload.series.isHourly);
        var labels = points.map(function(p) { return labelForTs(p.ts, isHourly); });
        var rev = points.map(function(p) { return (p && p.revenueGbp) ? Number(p.revenueGbp) : 0; });
        var ord = points.map(function(p) { return (p && p.orders) ? Number(p.orders) : 0; });
        var clicks = points.map(function(p) { return (p && p.clicks) ? Number(p.clicks) : 0; });
        var views = points.map(function(p) { return (p && p.views) ? Number(p.views) : 0; });
        var atc = points.map(function(p) { return (p && p.addToCart) ? Number(p.addToCart) : 0; });

        ensureApexCharts(function() {
          var revEl = document.getElementById('product-insights-chart-revenue');
          var actEl = document.getElementById('product-insights-chart-activity');
          if ((!revEl && !actEl) || typeof ApexCharts === 'undefined') return;

          function isVisible(el) {
            if (!el) return false;
            if ((el.clientWidth || 0) < 30) return false;
            if (!el.offsetParent) return false;
            return true;
          }

          var canRev = isVisible(revEl);
          var canAct = isVisible(actEl);
          if (!canRev && !canAct) {
            // Charts are inside collapsed cards (hidden). We'll re-render when expanded.
            destroyCharts();
            return;
          }

          destroyCharts();

          // Revenue chart (GBP + Orders)
          if (canRev) {
            charts.revenue = new ApexCharts(revEl, {
              chart: { type: 'area', height: 240, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
              series: [
                { name: 'Revenue', data: rev },
                { name: 'Conversions', data: ord },
              ],
              colors: ['#0d9488', '#3b82f6'],
              stroke: { width: 2, curve: 'smooth' },
              fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.16, opacityTo: 0.04, stops: [0, 100] } },
              dataLabels: { enabled: false },
              xaxis: { categories: labels, labels: { style: { fontSize: '10px' } } },
              yaxis: [
                { labels: { style: { fontSize: '11px' }, formatter: function(v) { return fmtMoneyGbp(v).replace('.00', ''); } } },
                { opposite: true, labels: { style: { fontSize: '11px' }, formatter: function(v) { return fmtNum(v); } } },
              ],
              tooltip: { y: { formatter: function(v, o) { return o && o.seriesIndex === 0 ? fmtMoneyGbp(v) : fmtNum(v); } } },
              grid: { borderColor: '#f1f1f1', strokeDashArray: 3 },
              legend: { position: 'top', fontSize: '11px' },
            });
            revEl.innerHTML = '';
            charts.revenue.render();
          }

          // Activity chart (Clicks / Views / Add to cart)
          if (canAct) {
            charts.activity = new ApexCharts(actEl, {
              chart: { type: 'line', height: 240, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
              series: [
                { name: 'Clicks', data: clicks },
                { name: 'Views (pixel)', data: views },
                { name: 'Add to cart', data: atc },
              ],
              colors: ['#6366f1', '#f59e0b', '#ef4444'],
              stroke: { width: 2, curve: 'smooth' },
              markers: { size: 2, hover: { size: 5 } },
              dataLabels: { enabled: false },
              xaxis: { categories: labels, labels: { style: { fontSize: '10px' } } },
              yaxis: { labels: { style: { fontSize: '11px' }, formatter: function(v) { return fmtNum(v); } }, min: 0 },
              tooltip: { y: { formatter: function(v) { return fmtNum(v); } } },
              grid: { borderColor: '#f1f1f1', strokeDashArray: 3 },
              legend: { position: 'top', fontSize: '11px' },
            });
            actEl.innerHTML = '';
            charts.activity.render();
          }
        });
      }

      function rangeLabelForKey(rangeKey) {
        var rk = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
        if (!rk) rk = 'today';
        try {
          if (typeof isCustomRangeKey === 'function' && isCustomRangeKey(rk)) {
            var r = ymdRangeFromRangeKey(rk);
            if (r && r.startYmd && r.endYmd) return formatYmdRangeLabel(r.startYmd, r.endYmd) || 'Selected dates';
          }
          if (typeof isCustomDayRangeKey === 'function' && isCustomDayRangeKey(rk)) {
            var ymd = ymdFromDayKey(rk);
            if (ymd) return formatYmdLabel(ymd) || 'Selected day';
          }
        } catch (_) {}
        try { return getRangeDisplayLabel(rk); } catch (_) {}
        return rk;
      }

      function globalRangeKeyOrToday() {
        try {
          var rk = getStatsRange();
          rk = (rk == null ? '' : String(rk)).trim().toLowerCase();
          return rk || 'today';
        } catch (_) {
          return 'today';
        }
      }

      function syncRangeSelect(key) {
        ensureDom();
        var sel = document.getElementById('product-insights-range');
        if (!sel) return;
        var k = (key == null ? '' : String(key)).trim().toLowerCase();
        if (!k) k = 'today';
        try {
          Array.from(sel.querySelectorAll('option[data-dynamic="1"]')).forEach(function(o) { o.remove(); });
        } catch (_) {}
        var found = false;
        try {
          for (var i = 0; i < sel.options.length; i++) {
            var ov = (sel.options[i] && sel.options[i].value != null) ? String(sel.options[i].value).trim().toLowerCase() : '';
            if (ov === k) { found = true; break; }
          }
        } catch (_) {}
        if (!found) {
          try {
            var opt = document.createElement('option');
            opt.value = k;
            opt.textContent = rangeLabelForKey(k) || k;
            opt.setAttribute('data-dynamic', '1');
            sel.appendChild(opt);
          } catch (_) {}
        }
        try { sel.value = k; } catch (_) {}
      }

      function syncThumbStripArrows() {
        ensureDom();
        var strip = document.getElementById('product-insights-thumbs');
        var leftBtn = document.getElementById('product-insights-thumbs-left');
        var rightBtn = document.getElementById('product-insights-thumbs-right');
        if (!strip || !leftBtn || !rightBtn) return;
        var max = Math.max(0, (strip.scrollWidth || 0) - (strip.clientWidth || 0));
        var hasOverflow = max > 6;
        leftBtn.style.display = hasOverflow ? 'inline-flex' : 'none';
        rightBtn.style.display = hasOverflow ? 'inline-flex' : 'none';
        leftBtn.disabled = !hasOverflow || (strip.scrollLeft || 0) <= 1;
        rightBtn.disabled = !hasOverflow || (strip.scrollLeft || 0) >= (max - 1);
      }

      function isDesktopModalLayout() {
        try { return !!(window.matchMedia && window.matchMedia('(min-width: 992px)').matches); } catch (_) { return false; }
      }

      function isVisibleEl(el) {
        if (!el) return false;
        if (!el.offsetParent) return false;
        if ((el.clientWidth || 0) < 8 || (el.clientHeight || 0) < 8) return false;
        return true;
      }

      function unionHeightOfCards(cards) {
        var top = null;
        var bottom = null;
        (cards || []).forEach(function(card) {
          if (!card || !card.getBoundingClientRect) return;
          if (!isVisibleEl(card)) return;
          var r = card.getBoundingClientRect();
          if (top == null || r.top < top) top = r.top;
          if (bottom == null || r.bottom > bottom) bottom = r.bottom;
        });
        if (top == null || bottom == null) return 0;
        return Math.max(0, bottom - top);
      }

      function syncMainImageBalance() {
        ensureDom();
        var wrap = modalEl ? modalEl.querySelector('.product-insights-main-img-wrap') : null;
        if (!wrap) return;

        if (!isDesktopModalLayout()) {
          wrap.style.height = '';
          return;
        }

        var colLeft = document.getElementById('product-insights-col-left');
        var colRight = document.getElementById('product-insights-col-right');
        if (!colLeft || !colRight) {
          wrap.style.height = '';
          return;
        }

        // If charts are expanded, let the gallery be its natural size (square).
        var revCard = colLeft.querySelector('[data-collapse-id="product-insights-revenue"]');
        var demCard = colLeft.querySelector('[data-collapse-id="product-insights-demand"]');
        var hasExpandedCharts =
          (revCard && !revCard.classList.contains('kexo-card-collapsed')) ||
          (demCard && !demCard.classList.contains('kexo-card-collapsed'));
        if (hasExpandedCharts) {
          wrap.style.height = '';
          return;
        }

        var leftCards = Array.from(colLeft.querySelectorAll(':scope > .card'));
        var rightCards = Array.from(colRight.querySelectorAll(':scope > .card'));
        if (!leftCards.length || !rightCards.length) {
          wrap.style.height = '';
          return;
        }

        var leftHeight = unionHeightOfCards(leftCards);
        var rightHeight = unionHeightOfCards(rightCards);
        if (!leftHeight || !rightHeight) {
          wrap.style.height = '';
          return;
        }

        var wrapRect = wrap.getBoundingClientRect();
        var wrapH = wrapRect.height || 0;
        var wrapW = wrapRect.width || 0;
        if (!wrapH || !wrapW) {
          wrap.style.height = '';
          return;
        }

        var fixedLeft = leftHeight - wrapH;
        if (!isFinite(fixedLeft)) fixedLeft = 0;
        var naturalSquare = wrapW; // default via aspect-ratio: 1/1

        // Target = right content height, but clamp so the image doesn't exceed a square.
        var target = rightHeight - fixedLeft;
        var minH = Math.max(220, Math.round(naturalSquare * 0.6));
        if (!isFinite(target)) target = naturalSquare;
        target = Math.max(minH, Math.min(naturalSquare, target));

        // If we're basically square, clear the override.
        if (Math.abs(target - naturalSquare) < 10) {
          wrap.style.height = '';
          return;
        }

        wrap.style.height = String(Math.round(target)) + 'px';
      }

      function urlWithWidth(rawUrl, width) {
        var raw = rawUrl != null ? String(rawUrl).trim() : '';
        if (!raw) return '';
        var w = Math.max(32, Math.floor(Number(width) || 1000));
        try {
          var u = new URL(raw, window.location.origin);
          u.searchParams.set('width', String(w));
          if (u.searchParams.has('height')) u.searchParams.delete('height');
          return u.toString();
        } catch (_) {
          if (/[?&]width=\d+/i.test(raw)) return raw.replace(/([?&]width=)(\d+)/i, '$1' + String(w));
          return raw;
        }
      }

      function setMainImg(imgEl, rawUrl, alt) {
        if (!imgEl) return;
        var u = rawUrl != null ? String(rawUrl).trim() : '';
        imgEl.alt = alt || '';
        if (!u) {
          imgEl.removeAttribute('src');
          imgEl.removeAttribute('srcset');
          imgEl.removeAttribute('sizes');
          imgEl.style.opacity = '0.35';
          return;
        }

        var widths = [360, 540, 720, 900, 1100, 1400];
        imgEl.src = urlWithWidth(u, 900) || u;
        imgEl.srcset = widths.map(function(w) {
          var uu = urlWithWidth(u, w) || u;
          return uu + ' ' + String(w) + 'w';
        }).join(', ');
        imgEl.sizes = '(min-width: 992px) 480px, 92vw';
        imgEl.style.opacity = '1';
      }

      function scrollThumbStrip(dir) {
        ensureDom();
        var strip = document.getElementById('product-insights-thumbs');
        if (!strip) return;
        var step = Math.max(120, Math.round((strip.clientWidth || 0) * 0.85));
        if (!step) step = 160;
        try {
          strip.scrollBy({ left: (dir < 0 ? -step : step), behavior: 'smooth' });
        } catch (_) {
          strip.scrollLeft = (strip.scrollLeft || 0) + (dir < 0 ? -step : step);
        }
        setTimeout(function() { syncThumbStripArrows(); }, 140);
      }

      function render(payload) {
        lastPayload = payload || null;
        var status = document.getElementById('product-insights-status');
        var body = document.getElementById('product-insights-body');
        if (status) status.style.display = 'none';
        if (body) body.style.display = 'block';

        var titleEl = document.getElementById('product-insights-title');
        var detailsTitleEl = document.getElementById('product-insights-details-title');
        var openLink = document.getElementById('product-insights-open-store');
        var adminLink = document.getElementById('product-insights-open-admin');
        var mainImg = document.getElementById('product-insights-main-img');
        var thumbsEl = document.getElementById('product-insights-thumbs');
        var topCountriesCard = document.getElementById('product-insights-top-countries-card');
        var topCountriesEl = document.getElementById('product-insights-top-countries');

        var prod = payload && payload.product ? payload.product : null;
        var metrics = payload && payload.metrics ? payload.metrics : {};
        var details = payload && payload.details ? payload.details : {};
        var isPage = payload && payload.kind === 'page';
        var page = payload && payload.page ? payload.page : null;

        var title = isPage
          ? (page && page.path ? (friendlyLabelFromPath(page.path) || page.path) : (currentPageUrl || 'Page'))
          : ((prod && prod.title) ? String(prod.title) : (currentTitle || currentHandle || 'Product'));
        if (titleEl) titleEl.textContent = title;
        if (detailsTitleEl) detailsTitleEl.textContent = isPage ? 'Page details' : 'Product details';
        var rk = (payload && payload.rangeKey) ? String(payload.rangeKey) : currentRangeKey;
        syncRangeSelect(rk);

        if (openLink) {
          var href = isPage ? (currentPageUrl || '#') : (currentProductUrl || '#');
          openLink.href = href;
          openLink.style.display = href && href !== '#' ? 'inline-flex' : 'none';
          openLink.textContent = isPage ? 'View page' : 'View on Website';
        }
        if (adminLink) {
          var adminHref = (!isPage && payload && payload.links && payload.links.adminProductUrl)
            ? String(payload.links.adminProductUrl)
            : '';
          adminLink.href = adminHref || '#';
          adminLink.style.display = adminHref && adminHref !== '#' ? 'inline-flex' : 'none';
          adminLink.textContent = 'Edit on Shopify';
        }

        // Images
        var images = (!isPage && prod && Array.isArray(prod.images)) ? prod.images : [];
        var first = images && images[0] ? images[0] : null;
        if (mainImg) {
          if (isPage) {
            var u = currentPageUrl || (page && page.url ? String(page.url) : '');
            var src = u ? ((API || '') + '/api/og-thumb?url=' + encodeURIComponent(u) + '&width=1000') : '';
            setMainImg(mainImg, src, title);
          } else {
            setMainImg(mainImg, (first && first.url) ? String(first.url) : '', title);
          }
        }
        if (thumbsEl) {
          thumbsEl.innerHTML = isPage ? '' : (images || []).slice(0, 20).map(function(img, i) {
            var u = img && img.url ? String(img.url) : '';
            var t = img && img.thumb ? String(img.thumb) : u;
            if (!u) return '';
            return '<button type="button" class="product-insights-thumb' + (i === 0 ? ' active' : '') + '" data-img="' + escapeHtml(u) + '" aria-label="Image ' + (i + 1) + '">' +
              '<img src="' + escapeHtml(t) + '" alt="" loading="lazy">' +
            '</button>';
          }).join('');
          try { thumbsEl.scrollLeft = 0; } catch (_) {}
          syncThumbStripArrows();

          thumbsEl.querySelectorAll('[data-img]').forEach(function(a) {
            a.addEventListener('click', function(e) {
              e.preventDefault();
              var u = a.getAttribute('data-img') || '';
              if (!u || !mainImg) return;
              thumbsEl.querySelectorAll('.product-insights-thumb').forEach(function(x) { x.classList.remove('active'); });
              a.classList.add('active');
              setMainImg(mainImg, u, title);
            });
          });
        }

        // Metrics table
        var mt = document.getElementById('product-insights-metrics-table');
        if (mt) {
          function row(label, value) {
            return '<tr><td>' + escapeHtml(label) + '</td><td class="w-1 fw-bold text-end">' + escapeHtml(value) + '</td></tr>';
          }
          if (isPage) {
            var sessions = metrics && metrics.sessions != null ? fmtNum(metrics.sessions) : '—';
            var pageViews = metrics && metrics.pageViews != null ? fmtNum(metrics.pageViews) : '—';
            var purchasedSessions = metrics && metrics.purchasedSessions != null ? fmtNum(metrics.purchasedSessions) : '—';
            var checkoutStartedSessions = metrics && metrics.checkoutStartedSessions != null ? fmtNum(metrics.checkoutStartedSessions) : '—';
            var revenue2 = metrics && metrics.revenueGbp != null ? fmtMoneyGbp(metrics.revenueGbp) : '—';
            var cr2 = metrics && metrics.cr != null ? fmtPct(metrics.cr) : '—';
            var rps = metrics && metrics.revPerSession != null ? fmtMoneyGbp(metrics.revPerSession) : '—';
            mt.innerHTML =
              row('Revenue', revenue2) +
              row('Purchased sessions', purchasedSessions) +
              row('Checkout started sessions', checkoutStartedSessions) +
              row('Sessions', sessions) +
              row('Page views', pageViews) +
              row('Purchase rate', cr2) +
              row('Revenue / Session', rps);
          } else {
            var revenue = metrics && metrics.revenueGbp != null ? fmtMoneyGbp(metrics.revenueGbp) : '—';
            var units = metrics && metrics.units != null ? fmtNum(metrics.units) : '—';
            var views = metrics && metrics.views != null ? fmtNum(metrics.views) : '—';
            var atc = metrics && metrics.addToCart != null ? fmtNum(metrics.addToCart) : '—';
            var cs = metrics && metrics.checkoutStarted != null ? fmtNum(metrics.checkoutStarted) : '—';
            var atcRate = metrics && metrics.atcRate != null ? fmtPct(metrics.atcRate) : '—';
            var clicks = metrics && metrics.clicks != null ? fmtNum(metrics.clicks) : '—';
            var conv = metrics && metrics.orders != null ? fmtNum(metrics.orders) : '—';
            var cr = metrics && metrics.cr != null ? fmtPct(metrics.cr) : '—';
            var rpc = metrics && metrics.revPerClick != null ? fmtMoneyGbp(metrics.revPerClick) : '—';
            var rpv = metrics && metrics.revPerView != null ? fmtMoneyGbp(metrics.revPerView) : '—';
            var totalSales = details && details.totalSalesLifetime != null ? fmtNum(details.totalSalesLifetime) : '—';
            var totalRev = details && details.totalRevenueLifetimeGbp != null ? fmtMoneyGbp(details.totalRevenueLifetimeGbp) : '—';
            var cogs = details && details.costOfGoodsLifetimeGbp != null ? fmtMoneyGbp(details.costOfGoodsLifetimeGbp) : '—';
            var stockUnits = details && details.inventoryUnits != null ? fmtNum(details.inventoryUnits) : '—';
            var stockVariants = details && details.inStockVariants != null ? fmtNum(details.inStockVariants) : '—';
            mt.innerHTML =
              row('Clicks', clicks) +
              row('Conversions', conv) +
              row('Conversion rate', cr) +
              row('Revenue (selected range)', revenue) +
              row('Units sold (selected range)', units) +
              row('Views (pixel)', views) +
              row('Add to cart', atc) +
              row('Checkout started', cs) +
              row('View → Cart rate', atcRate) +
              row('Revenue / Click', rpc) +
              row('Revenue / View', rpv) +
              row('In stock (units)', stockUnits) +
              row('In-stock variants', stockVariants) +
              row('Total sales (lifetime)', totalSales) +
              row('Total revenue (lifetime)', totalRev) +
              row('Cost of goods (lifetime)', cogs);
          }
        }

        if (topCountriesCard && topCountriesEl) {
          var top = (!isPage && payload && Array.isArray(payload.topCountries)) ? payload.topCountries : [];
          if (top && top.length) {
            topCountriesCard.style.display = '';
            topCountriesEl.innerHTML = top.slice(0, 5).map(function(r) {
              var iso = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
              if (iso === 'UK') iso = 'GB';
              var name = countryLabel(iso);
              var flag = flagImg(iso, name);
              var conv = (r && r.orders != null) ? (Number(r.orders) || 0) : 0;
              var rev = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
              var revText = (rev != null && isFinite(rev)) ? fmtMoneyGbp(rev) : '—';
              return '' +
                '<div class="d-flex align-items-center justify-content-between">' +
                  '<div class="d-flex align-items-center gap-2 min-w-0">' +
                    flag +
                    '<span class="text-truncate">' + escapeHtml(name) + '</span>' +
                  '</div>' +
                  '<div class="text-end">' +
                    '<div class="fw-semibold" style="font-size:.875rem">' + escapeHtml(fmtNum(conv)) + ' conversions</div>' +
                    '<div class="text-muted small">' + escapeHtml(revText) + '</div>' +
                  '</div>' +
                '</div>';
            }).join('');
          } else {
            topCountriesCard.style.display = 'none';
            topCountriesEl.innerHTML = '';
          }
        }

        syncMainImageBalance();
        renderCharts(payload);
      }

      function load() {
        ensureDom();
        setStatus('Loading…');

        var shop = null;
        try { shop = getShopParam() || shopForSalesFallback || null; } catch (_) { shop = null; }
        var url = '';
        if (currentMode === 'page') {
          if (!currentPageUrl) { setStatus('No page selected.'); return; }
          url = (API || '') + '/api/page-insights?url=' + encodeURIComponent(currentPageUrl) +
            '&kind=' + encodeURIComponent(currentLandingKind || 'entry') +
            '&range=' + encodeURIComponent(currentRangeKey || 'today') +
            '&_=' + Date.now();
        } else {
          if (!currentHandle && !currentProductId) { setStatus('No product selected.'); return; }
          var q = 'range=' + encodeURIComponent(currentRangeKey || 'today') + (shop ? ('&shop=' + encodeURIComponent(shop)) : '') + '&_=' + Date.now();
          if (currentHandle) {
            url = (API || '') + '/api/product-insights?handle=' + encodeURIComponent(currentHandle) + '&' + q;
          } else {
            url = (API || '') + '/api/product-insights?product_id=' + encodeURIComponent(currentProductId) + '&' + q;
          }
        }

        fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 30000)
          .then(function(r) { return r && r.ok ? r.json() : null; })
          .then(function(data) {
            if (!data || !data.ok) {
              setStatus(currentMode === 'page' ? 'No data available for this page.' : 'No data available for this product.');
              return;
            }
            render(data);
          })
          .catch(function() { setStatus(currentMode === 'page' ? 'Could not load page insights.' : 'Could not load product insights.'); });
      }

      function openProduct(handleOrProductId, options) {
        options = options || {};
        var raw = String(handleOrProductId || '').trim();
        var pid = options.productId ? String(options.productId).trim() : '';
        if (!pid && /^\d+$/.test(raw)) pid = raw;
        if (!pid && /gid:\/\/shopify\/Product\/(\d+)/i.test(raw)) pid = raw.replace(/gid:\/\/shopify\/Product\/(\d+)/i, '$1');
        var h = pid ? null : normalizeHandle(handleOrProductId);
        if (!h && !pid) return;
        currentHandle = h || null;
        currentProductId = pid || null;
        currentMode = 'product';
        currentPageUrl = null;
        currentTitle = options.title ? String(options.title) : null;
        currentProductUrl = options.productUrl ? String(options.productUrl) : null;
        currentLandingKind = options.landingKind ? String(options.landingKind) : null;
        currentRangeKey = globalRangeKeyOrToday();
        ensureDom();
        syncRangeSelect(currentRangeKey);
        show();
        load();
      }

      function openPage(url, options) {
        var u = url != null ? String(url).trim() : '';
        if (!u) return;
        currentMode = 'page';
        currentPageUrl = u;
        currentHandle = null;
        currentProductId = null;
        options = options || {};
        currentTitle = options.title ? String(options.title) : null;
        currentProductUrl = null;
        currentLandingKind = options.landingKind ? String(options.landingKind) : null;
        currentRangeKey = globalRangeKeyOrToday();
        ensureDom();
        syncRangeSelect(currentRangeKey);
        show();
        load();
      }

      // Delegate clicks from product links (tables, breakdowns, etc.)
      document.addEventListener('click', function(e) {
        var a = e && e.target && e.target.closest ? e.target.closest('a.js-product-modal-link') : null;
        if (!a) return;
        if (isModifiedClick(e)) return;
        var h = normalizeHandle(a.getAttribute('data-product-handle') || '');
        if (!h) h = parseHandleFromHref(a.getAttribute('href') || '');
        var pid = (a.getAttribute('data-product-id') || '').trim();
        if (!h && !pid) return;
        e.preventDefault();
        openProduct(h || pid, {
          title: a.getAttribute('data-product-title') || '',
          productUrl: a.getAttribute('href') || '',
          productId: pid || undefined,
        });
      });

      // Expose for debugging / future use
      window.__openProductInsights = openProduct;
    })();

})();
