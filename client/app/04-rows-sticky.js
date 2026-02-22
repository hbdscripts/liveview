
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

        // Acquisition → Attribution: quick link to Settings → Attribution → Mapping.
        try {
          var page = (document.body && document.body.getAttribute) ? String(document.body.getAttribute('data-page') || '') : '';
          if (page.trim().toLowerCase() === 'attribution' && String(tableId || '').trim().toLowerCase() === 'attribution-table') {
            var existingSettingsLink = actions.querySelector('.kexo-attribution-settings-link');
            if (!existingSettingsLink) {
              var a = document.createElement('a');
              a.className = 'kexo-attribution-settings-link';
              a.href = '/settings/attribution/mapping';
              a.title = 'Attribution settings';
              a.setAttribute('aria-label', 'Attribution settings');
              a.innerHTML = '<i class="fa-light fa-sliders" aria-hidden="true"></i>';
              // Place next to the table settings cog when present.
              if (builderLink && builderLink.parentElement === actions) actions.insertBefore(a, builderLink.nextSibling);
              else actions.appendChild(a);
            }
          }
        } catch (_) {}

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
      var WRAP_SELECTOR = '.table-scroll-wrap, .country-table-wrap, .table-responsive, .tools-table-wrap';
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

        // Optional per-table overrides from Settings ??? Layout ??? Tables.
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
            var isScrollable = (wrap.scrollWidth || 0) > ((wrap.clientWidth || 0) + 1);
            if (!isScrollable && byRemainingCols >= min + 16) max = Math.min(max, byRemainingCols);
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

      function getHeaderStickyCell(wrap) {
        if (!wrap || !wrap.querySelector) return null;
        return wrap.querySelector('.grid-row--header .grid-cell:first-child, table thead th:first-child');
      }

      function getWrapIndex(wrap) {
        if (!wrap || !document.querySelectorAll) return 0;
        var list = [];
        try { list = Array.prototype.slice.call(document.querySelectorAll(WRAP_SELECTOR)); } catch (_) {}
        var i = list.indexOf(wrap);
        return i >= 0 ? i : 0;
      }

      function getStorageKey(wrap) {
        var suffix = 'default';
        try {
          var tableId = getWrapTableId(wrap);
          if (tableId) suffix = resolveVariantsTableId(tableId, page || PAGE) || tableId;
          else if (page) suffix = String(page).trim().toLowerCase();
        } catch (_) {}
        return LS_KEY + ':' + suffix + ':' + getViewportBucket() + ':' + getWrapIndex(wrap);
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
          var cell = getHeaderStickyCell(wrap);
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
        applyWidthSingle(wrap, width);
        var applied = wrapWidth(wrap);
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
        var didDrag = false;

        function ensureResizeClickGuard() {
          try {
            var root = document.documentElement;
            if (!root || root.getAttribute('data-kexo-sticky-resize-click-guard') === '1') return;
            root.setAttribute('data-kexo-sticky-resize-click-guard', '1');
          } catch (_) {}
          try {
            document.addEventListener('click', function (e) {
              var until = Number(window.__kexoStickyResizeSuppressClickUntil || 0);
              if (!Number.isFinite(until) || until <= 0) return;
              if (Date.now() > until) return;
              // A resize drag ends with a "click" on the header; eat it so it doesn't trigger sort/reorder.
              try { e.preventDefault(); } catch (_) {}
              try { e.stopPropagation(); } catch (_) {}
              try { if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation(); } catch (_) {}
              try { window.__kexoStickyResizeSuppressClickUntil = 0; } catch (_) {}
            }, true);
          } catch (_) {}
        }

        function suppressNextClick() {
          ensureResizeClickGuard();
          try { window.__kexoStickyResizeSuppressClickUntil = Date.now() + 600; } catch (_) {}
        }

        function stopResize(e) {
          if (!resizing) return;
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          resizing = false;
          wrap.classList.remove('is-resizing-first-col');
          try { if (e && e.pointerId != null) handle.releasePointerCapture(e.pointerId); } catch (_) {}
          markResizeInteraction(wrap);
          saveWidth(wrap, wrapWidth(wrap));
          if (didDrag) suppressNextClick();
        }

        handle.addEventListener('pointerdown', function(e) {
          if (!e) return;
          var pt = String(e.pointerType || '').toLowerCase();
          if (pt === 'mouse' && e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          resizing = true;
          didDrag = false;
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
          if (!didDrag) {
            try { didDrag = Math.abs((e.clientX || 0) - (startX || 0)) > 2; } catch (_) { didDrag = true; }
          }
          var next = startW + (e.clientX - startX);
          applyWidthToGroup(wrap, next);
          markResizeInteraction(wrap);
        });

        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);
        handle.addEventListener('lostpointercapture', stopResize);
        handle.addEventListener('click', function (e) {
          // Prevent header click/sort when user interacts with the resize handle.
          try { e.preventDefault(); } catch (_) {}
          try { e.stopPropagation(); } catch (_) {}
        }, true);
      }

      var STICKY_DEBOUNCE_MS = 60;
      function ensureHandle(wrap) {
        var cell = getHeaderStickyCell(wrap);
        if (!cell) return;
        var handle = cell.querySelector('.kexo-sticky-resize-handle');
        if (!handle) {
          handle = document.createElement('span');
          handle.className = 'kexo-sticky-resize-handle';
          handle.setAttribute('aria-hidden', 'true');
          handle.setAttribute('data-no-drag-scroll', '1');
          var iconEl = document.createElement('i');
          iconEl.setAttribute('data-icon-key', 'table-sticky-resize-handle');
          iconEl.setAttribute('aria-hidden', 'true');
          handle.appendChild(iconEl);
          cell.appendChild(handle);
        }
        bindHandle(wrap, handle);
      }
      function debouncedEnsureHandle(wrap) {
        if (!wrap) return;
        try {
          if (wrap._stickyEnsureHandleTimer != null) clearTimeout(wrap._stickyEnsureHandleTimer);
          wrap._stickyEnsureHandleTimer = setTimeout(function() {
            wrap._stickyEnsureHandleTimer = null;
            ensureHandle(wrap);
          }, STICKY_DEBOUNCE_MS);
        } catch (_) {}
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
              debouncedEnsureHandle(wrap);
            });
            ro.observe(wrap);
            wrap._stickyResizeObserver = ro;
          } catch (_) {}
        }
        if (typeof MutationObserver !== 'undefined') {
          try {
            var mo = new MutationObserver(function() { debouncedEnsureHandle(wrap); });
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

      var docMo = null;
      function initStickyDocObserver() {
        if (docMo) return;
        if (typeof MutationObserver === 'undefined') return;
        try {
          docMo = new MutationObserver(function(muts) {
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
          if (typeof registerCleanup === 'function') {
            registerCleanup(function() {
              try { if (docMo && typeof docMo.disconnect === 'function') docMo.disconnect(); } catch (_) {}
              docMo = null;
            });
          }
        } catch (_) {}
      }
      try { window.__kexoInitStickyDocObserver = initStickyDocObserver; } catch (_) {}
      initStickyDocObserver();

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
    let lastAttributionFetchedAt = 0;
    let lastDevicesFetchedAt = 0;
    let lastBrowsersFetchedAt = 0;
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
    let attributionRefreshInFlight = null;
    let devicesRefreshInFlight = null;
    let browsersRefreshInFlight = null;
    let productsRefreshInFlight = null;
    let kpisRefreshInFlight = null;
    let kpisRefreshRangeKey = '';
    let configStatusRefreshInFlight = null;
    let activeKpiCompareKey = 'conv';
    let reportBuildTokens = { stats: 0, breakdown: 0, products: 0, attribution: 0, devices: 0, browsers: 0, sessions: 0, diagnostics: 0, kpiCompare: 0, dashboard: 0 };
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
    let onlineCountLastFetchedAt = 0;
    let onlineCountPollTimer = null;
    let onlineCountAuthBlocked = false;
    const ONLINE_COUNT_POLL_MS = 15000;
    const ONLINE_COUNT_RETRY_MS = 30000;
    let liveOnlineChart = null;
    let liveOnlineChartType = '';
    let liveOnlineChartFetchedAt = 0;
    let liveOnlineChartInFlight = null;
    let liveOnlineMapChartInstance = null;
    let liveOnlineMapSessions = [];
    let liveOnlineMapSessionsFetchedAt = 0;
    let liveOnlineMapSessionsInFlight = null;
    let rangeOverviewChart = null;
    let rangeOverviewChartKey = '';
    let rangeOverviewChartInFlight = null;
    let abandonedCartsChart = null;
    let abandonedCartsChartKey = '';
    let abandonedCartsChartInFlight = null;
    let abandonedCartsChartInFlightKey = '';
    let abandonedCartsChartReqSeq = 0;
    let abandonedCartsSeriesCache = {};
    let abandonedCartsSeriesCacheOrder = [];
    let abandonedCartsSeriesPrefetchInFlight = {};
    const ABANDONED_CARTS_SERIES_CACHE_MAX = 12;
    let abandonedCartsTopCacheKey = '';
    let abandonedCartsTopCountriesCache = null;
    let abandonedCartsTopCountryProductsCache = null;
    let abandonedCartsTopInFlight = null;
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
    let attributionPage = 1;
    let devicesPage = 1;
    let browsersPage = 1;
    let dashTopProductsPage = 1;
    let dashTopCountriesPage = 1;
    let dashTrendingPage = 1;
    let bestSellersSortBy = 'rev';
    let bestSellersSortDir = 'desc';
    const tableSortState = {
      country: { by: 'rev', dir: 'desc' },
      bestGeoProducts: { by: 'rev', dir: 'desc' },
      aov: { by: 'aov', dir: 'desc' },
      bestVariants: { by: 'rev', dir: 'desc' },
      attribution: { by: 'rev', dir: 'desc' },
      devices: { by: 'rev', dir: 'desc' },
      browsers: { by: 'rev', dir: 'desc' },
    };
    const TABLE_SORT_DEFAULTS = {
      country: { country: 'asc', cr: 'desc', sales: 'desc', clicks: 'desc', rev: 'desc' },
      bestGeoProducts: { country: 'asc', cr: 'desc', sales: 'desc', clicks: 'desc', rev: 'desc' },
      aov: { aov: 'desc' },
      bestVariants: { variant: 'asc', sales: 'desc', clicks: 'desc', rev: 'desc', cr: 'desc' },
      attribution: { attribution: 'asc', cr: 'desc', orders: 'desc', sessions: 'desc', rev: 'desc' },
      devices: { device: 'asc', cr: 'desc', orders: 'desc', sessions: 'desc', rev: 'desc' },
      browsers: { browser: 'asc', cr: 'desc', orders: 'desc', carts: 'desc', sessions: 'desc', aov: 'desc', vpv: 'desc', rev: 'desc' },
    };

    function rerenderDashboardFromCache() {
      try {
        if (typeof window.refreshDashboard === 'function') {
          window.refreshDashboard({ force: false, silent: true, rerender: true });
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
      if (id === 'attribution-table') {
        attributionPage = 1;
        try { renderAttributionTables(attributionCache || {}); } catch (_) {}
        return;
      }
      if (id === 'devices-table') {
        devicesPage = 1;
        try { renderDevicesTables(devicesCache || {}); } catch (_) {}
        return;
      }
      if (id === 'browsers-table') {
        browsersPage = 1;
        try { renderBrowsersTables(browsersCache || {}); } catch (_) {}
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
      if (id === 'dash-trending') {
        dashTrendingPage = 1;
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
    let saleSoundDeferredHandler = null;
    let saleSoundLastOrigin = '';
    let saleSoundLastKey = '';
    let saleSoundLastAt = 0;
    const SALE_SOUND_DEDUPE_WINDOW_MS = 8000;
    const SALE_TOAST_SEEN_STORAGE_KEY = 'kexo:sale-toast-seen:v1';
    const SALE_TOAST_SEEN_KEY_MAX = 500;
    let saleToastSeenKeys = new Set();
    let saleToastSeenOrder = [];
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
      if (!block) {
        // Recent Sales no longer shows the next-update UI; don't let queued payloads get stuck.
        try {
          if (liveSalesPendingPayload && typeof liveSalesCanAutoApply === 'function' && liveSalesCanAutoApply()) {
            applyLiveSalesPending();
          }
        } catch (_) {}
        return;
      }
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

    function formatExitDelta(ms) {
      var n = typeof ms === 'number' ? ms : Number(ms);
      if (!Number.isFinite(n) || n < 0) return '\u2014';
      var s = Math.round(n / 1000);
      if (s < 60) return String(s) + 's';
      var m = Math.floor(s / 60);
      var rem = s % 60;
      if (m < 60) return String(m) + 'm ' + String(rem) + 's';
      var h = Math.floor(m / 60);
      var remM = m % 60;
      return String(h) + 'h ' + String(remM) + 'm';
    }

    function sessionActionsCount(s) {
      var n = s && s.actions_count != null ? Number(s.actions_count) : null;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 0;
      return Math.round(n);
    }

    function sessionExitLabel(s) {
      // Live view: still active, no meaningful "exit" yet.
      if (sessionsTotal == null && filter === 'active') return 'Live';
      var lastSeen = toMs(s && s.last_seen);
      var lastAction = toMs(s && s.last_action_ts);
      var lastEvent = toMs(s && s.last_event_ts);
      var baseline = lastAction != null ? lastAction : lastEvent;
      if (lastSeen == null || baseline == null) return '\u2014';
      var delta = lastSeen - baseline;
      if (!Number.isFinite(delta) || delta < 0) return '\u2014';
      return formatExitDelta(delta);
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
        return '<span class="kexo-flag-fallback" style="display:inline-flex;align-items:center;justify-content:center;width:1rem;height:1rem;opacity:.8"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"><i class="fa-light fa-globe"></i></span>';
      }
      return '<span class="flag flag-xs flag-country-' + raw + '"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
    }

    function flagImgSmall(code) {
      const raw = (code || '').toString().trim().toLowerCase();
      if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
        return '<span class="kexo-flag-fallback" style="display:inline-flex;align-items:center;justify-content:center;width:1rem;height:1rem;opacity:.8" aria-hidden="true"><i class="fa-light fa-globe"></i></span>';
      }
      return '<span class="flag flag-xs flag-country-' + raw + '" aria-hidden="true"></span>';
    }

    function arrivedAgo(startedAt) {
      var n = toMs(startedAt);
      if (n == null) return '\u2014';
      var s = Math.floor((Date.now() - n) / 1000);
      if (s < 0) return 'now';
      if (s < 60) return s + 's';
      if (s < 3600) return Math.floor(s / 60) + 'm';
      if (s < 86400) return Math.floor(s / 3600) + 'h';
      var d = Math.floor(s / 86400);
      return d + 'd';
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
              if (link) link.href = '/assets/logos/new/kexo.webp';
              if (typeof saleAudio !== 'undefined' && saleAudio && typeof getCashRegisterMp3Url === 'function') {
                setSaleAudioSrc(getCashRegisterMp3Url());
              }
            }
            if (shopForSalesFallback) {
              if (activeMainTab === 'products' && typeof refreshProducts === 'function') refreshProducts({ force: false });
              if (activeMainTab === 'stats' && typeof refreshStats === 'function') refreshStats({ force: false });
              if (activeMainTab === 'attribution' && typeof refreshAttribution === 'function') refreshAttribution({ force: false });
              if (activeMainTab === 'devices' && typeof refreshDevices === 'function') refreshDevices({ force: false });
              if (activeMainTab === 'browsers' && typeof refreshBrowsers === 'function') refreshBrowsers({ force: false });
              if (typeof requestDashboardWidgetsRefresh === 'function') requestDashboardWidgetsRefresh({ force: false });
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
    // Sale toast chime: prefer assetOverrides.saleSound, then assets base, else local default.
    var DEFAULT_SALE_SOUND = '/assets/ui-alert/1.mp3';
    var CASH_REGISTER_MP3_CDN = 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/cash-register.mp3?v=1770171264';
    function getCashRegisterMp3Url() {
      try {
        var override = (typeof window !== 'undefined' && window.__kexoSaleSoundOverrideUrl) ? String(window.__kexoSaleSoundOverrideUrl).trim() : '';
        if (override && /^https?:\/\//i.test(override)) return override;
        if (override && override.charAt(0) === '/') return override;
      } catch (_) {}
      var defaultAssetsBase = (API || '') + '/assets';
      var assetsBase = '';
      try {
        assetsBase = typeof getAssetsBase === 'function' ? String(getAssetsBase() || '').trim() : '';
      } catch (_) {
        assetsBase = '';
      }
      // Only use a custom assets host/path when it is explicitly configured.
      if (assetsBase && assetsBase !== defaultAssetsBase) {
        return assetsBase.replace(/\/+$/, '') + '/ui-alert/1.mp3';
      }
      return DEFAULT_SALE_SOUND;
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
            if (!a || !DEFAULT_SALE_SOUND) return;
            var cur = String(a.currentSrc || a.src || '');
            if (cur && cur.indexOf(DEFAULT_SALE_SOUND) >= 0) return;
            a.src = DEFAULT_SALE_SOUND;
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

    /** Sort key for landing column: use server-provided landing_title, else path. */
    function landingSortKey(s) {
      var title = (s && s.landing_title != null) ? String(s.landing_title).trim() : '';
      if (title) return title;
      function trimStr(v) { return v != null ? String(v).trim() : ''; }
      var path = trimStr(s && s.first_path);
      var handle = trimStr(s && s.first_product_handle);
      if (!path && handle) path = '/products/' + handle.replace(/^\/+/, '');
      if (path && !path.startsWith('/')) path = '/' + path;
      try { if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/'; } catch (_) {}
      path = (path || '').split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
      return path;
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

      var path = '';
      try { path = (s && s.first_path != null && s.first_path !== '' ? s.first_path : (s && s.last_path != null ? s.last_path : '')).trim(); } catch (_) { path = ''; }
      if (path && !path.startsWith('/')) path = '/' + path;
      try { if (/^https?:\/\//i.test(path)) path = new URL(path).pathname || '/'; } catch (_) {}
      path = (path || '').split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
      var label = (s && s.landing_title != null) ? String(s.landing_title).trim() : '';
      var display = label || path || '\u2014';
      var handle = handleFromPath(s && s.first_path) || handleFromPath(s && s.last_path);
      if (!handle) handle = '';
      var mainBase = getMainBaseUrl();
      var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';

      if (handle && productUrl) {
        var title = label || handle;
        return '<div class="last-action-cell">' +
          '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
            ' data-product-handle="' + escapeHtml(handle) + '"' +
            ' data-product-title="' + escapeHtml(title) + '"' +
          '>' + escapeHtml(display) + '</a>' +
        '</div>';
      }

      return '<div class="last-action-cell">' + escapeHtml(display) + '</div>';
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
        const variant = s && (s.attribution_variant ?? s.attributionVariant) != null ? String(s.attribution_variant ?? s.attributionVariant).trim() : '';
        if (variant) return variant.toLowerCase();
        const source = s && (s.attribution_source ?? s.attributionSource) != null ? String(s.attribution_source ?? s.attributionSource).trim() : '';
        if (source) return source.toLowerCase();
        const channel = s && (s.attribution_channel ?? s.attributionChannel) != null ? String(s.attribution_channel ?? s.attributionChannel).trim() : '';
        if (channel) return channel.toLowerCase();
      } catch (_) {}
      // Fallback: derive from UTMs/referrer (best-effort; older rows may not have attribution yet).
      if (isGoogleAdsSource(s)) return 'google ads';
      const friendly = sourceFriendlyLabel(s);
      if (friendly) return friendly.toLowerCase();
      if (sourceUtmString(s)) return 'other';
      if (s && s.referrer && String(s.referrer).trim()) return 'other';
      return 'direct';
    }

    const SOURCE_GOOGLE_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/google.png?v=1770086632');
    const SOURCE_DIRECT_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/arrow-right.png?v=1770086632');
    const BOUGHT_OVERLAY_SVG = '<i class="fa-light fa-cart-shopping" data-icon-key="live-bought-overlay" aria-hidden="true"></i>';
    const SOURCE_UNKNOWN_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/question.png?v=1770135816');
    const SOURCE_OMNISEND_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/omnisend.png?v=1770141052');
    const SOURCE_BING_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/bing.png?v=1770141094');
    const SOURCE_LIVEVIEW_SOURCE_IMG = hotImg('https://cdn.shopify.com/s/files/1/0847/7261/8587/files/liveview-source-logo.png?v=1770141081');
    function sourceCell(s) {
      function icon(src, alt, title, extraClass) {
        const cls = (extraClass ? (extraClass + ' ') : '') + 'source-icon-img';
        const t = title ? ' title="' + escapeHtml(String(title)) + '"' : '';
        return '<img src="' + escapeHtml(hotImg(src) || src || '') + '" alt="' + escapeHtml(alt || '') + '" class="' + cls + '" width="20" height="20"' + t + '>';
      }

      function iconFromSpec(specRaw, label, extraClass) {
        const spec = specRaw != null ? String(specRaw).trim() : '';
        if (!spec) return '';
        const t = label ? ' title="' + escapeHtml(String(label)) + '"' : '';
        const extra = extraClass ? (' ' + String(extraClass)) : '';
        if (/^<svg[\s>]/i.test(spec)) {
          return '<span class="source-icon-svg' + escapeHtml(extra) + '"' + t + ' aria-hidden="true">' + spec + '</span>';
        }
        if (/^(https?:\/\/|\/\/|\/)/i.test(spec)) {
          return icon(spec, label, label, extraClass);
        }
        return '<i class="' + escapeHtml(spec) + ' source-icon-fa' + escapeHtml(extra) + '"' + t + ' aria-hidden="true"></i>';
      }

      // Acquisition attribution: use persisted `attribution_*` fields (single source of truth).
      const variant = s && (s.attribution_variant ?? s.attributionVariant) != null ? String(s.attribution_variant ?? s.attributionVariant).trim().toLowerCase() : '';
      const channel = s && (s.attribution_channel ?? s.attributionChannel) != null ? String(s.attribution_channel ?? s.attributionChannel).trim().toLowerCase() : '';
      const source = s && (s.attribution_source ?? s.attributionSource) != null ? String(s.attribution_source ?? s.attributionSource).trim().toLowerCase() : '';
      const confidence = s && (s.attribution_confidence ?? s.attributionConfidence) != null ? String(s.attribution_confidence ?? s.attributionConfidence).trim().toLowerCase() : '';

      const labelRaw = variant || (channel && source ? (channel + ' / ' + source) : (channel || source || 'unknown'));
      const title = confidence ? (labelRaw + ' (' + confidence + ')') : labelRaw;
      const head = (variant ? variant.split(':')[0] : channel) || '';

      let spec = '';
      let extraClass = '';
      if (head === 'google_ads' || head === 'google_organic' || head === 'google') {
        spec = SOURCE_GOOGLE_IMG;
        if (head === 'google_ads') extraClass = 'source-googleads-img';
      } else if (head === 'bing_ads' || head === 'bing_organic' || head === 'bing') {
        spec = SOURCE_BING_IMG;
      } else if (head === 'omnisend' || head === 'klaviyo' || head === 'email') {
        spec = SOURCE_OMNISEND_IMG;
      } else if (head.indexOf('meta') >= 0 || head === 'facebook' || head === 'instagram') {
        spec = 'fa-brands fa-facebook';
      } else if (head.indexOf('tiktok') >= 0) {
        spec = 'fa-brands fa-tiktok';
      } else if (head.indexOf('pinterest') >= 0) {
        spec = 'fa-brands fa-pinterest';
      } else if (head.indexOf('affiliate') >= 0 || channel === 'affiliate') {
        spec = 'fa-light fa-handshake';
      } else if (head === 'direct' || channel === 'direct') {
        spec = SOURCE_DIRECT_IMG;
      } else if (head) {
        spec = SOURCE_UNKNOWN_IMG;
      } else {
        spec = SOURCE_UNKNOWN_IMG;
      }

      const html = iconFromSpec(spec || 'fa-light fa-circle-question', title, extraClass);
      return html ? ('<span class="source-icons"><span class="visually-hidden">' + escapeHtml(String(title || '')) + '</span>' + html + '</span>') : '';
    }

    function buildFullEntryUrlForCopy(s) {
      var entry = s && s.entry_url != null ? String(s.entry_url).trim() : '';
      if (!entry) return '';
      try {
        var u = new URL(entry);
        var map = {
          utm_source: s && s.utm_source != null ? String(s.utm_source).trim() : '',
          utm_medium: s && s.utm_medium != null ? String(s.utm_medium).trim() : '',
          utm_campaign: s && s.utm_campaign != null ? String(s.utm_campaign).trim() : '',
          utm_content: s && s.utm_content != null ? String(s.utm_content).trim() : '',
          utm_term: s && s.utm_term != null ? String(s.utm_term).trim() : '',
        };
        Object.keys(map).forEach(function (k) {
          var v = map[k];
          if (!v) return;
          try { if (!u.searchParams.has(k)) u.searchParams.set(k, v); } catch (_) {}
        });
        return u.toString();
      } catch (_) {
        return entry;
      }
    }

    function sourceDetailForPanel(s) {
      function truncateUrlForPanel(raw, maxChars) {
        var txt = raw != null ? String(raw) : '';
        var max = Number.isFinite(Number(maxChars)) ? Math.max(24, Math.trunc(Number(maxChars))) : 160;
        if (txt.length <= max) return txt;
        return txt.slice(0, Math.max(0, max - 5)) + '.....';
      }
      const lines = [];
      const entry = s.entry_url && String(s.entry_url).trim();
      if (entry) {
        const full = buildFullEntryUrlForCopy(s);
        const fullDisplay = truncateUrlForPanel(full, 180);
        const entryDisplay = truncateUrlForPanel(entry, 180);
        if (full && full !== entry) {
          lines.push('URL: ' + fullDisplay);
          lines.push('Entry URL (raw): ' + entryDisplay);
        } else {
          lines.push('URL: ' + entryDisplay);
        }
      }
      const ref = s.referrer && String(s.referrer).trim();
      if (ref) lines.push('Referrer: ' + ref);
      if (s.utm_source != null && String(s.utm_source).trim() !== '') lines.push('utm_source: ' + String(s.utm_source).trim());
      if (s.utm_medium != null && String(s.utm_medium).trim() !== '') lines.push('utm_medium: ' + String(s.utm_medium).trim());
      if (s.utm_campaign != null && String(s.utm_campaign).trim() !== '') lines.push('utm_campaign: ' + String(s.utm_campaign).trim());
      if (s.utm_content != null && String(s.utm_content).trim() !== '') lines.push('utm_content: ' + String(s.utm_content).trim());
      if (lines.length === 0) return '\u2014';
      return lines.join('\n');
    }

    function deviceInfoForSession(s) {
      const uaDeviceTypeRaw = s && (s.ua_device_type ?? s.uaDeviceType) != null ? String(s.ua_device_type ?? s.uaDeviceType) : '';
      const uaPlatformRaw = s && (s.ua_platform ?? s.uaPlatform) != null ? String(s.ua_platform ?? s.uaPlatform) : '';
      const uaModelRaw = s && (s.ua_model ?? s.uaModel) != null ? String(s.ua_model ?? s.uaModel) : '';
      const legacyDeviceRaw = s && s.device != null ? String(s.device) : '';

      function norm(v) { return (v || '').trim().toLowerCase(); }
      function isOneOf(v, list) { return list.indexOf(v) >= 0; }
      function derivePlatformFallback() {
        const d = norm(legacyDeviceRaw);
        if (!d) return '';
        if (d === 'ios') return 'ios';
        if (d === 'android') return 'android';
        if (d === 'windows') return 'windows';
        if (d === 'mac') return 'mac';
        if (d === 'chrome os' || d === 'chromeos') return 'chromeos';
        if (d === 'linux') return 'linux';
        if (d === 'windows phone') return 'windows';
        return '';
      }

      const deviceType = (() => {
        const v = norm(uaDeviceTypeRaw);
        if (isOneOf(v, ['desktop', 'mobile', 'tablet'])) return v;
        return 'unknown';
      })();

      const platform = (() => {
        const v = norm(uaPlatformRaw) || derivePlatformFallback();
        if (isOneOf(v, ['ios', 'android', 'windows', 'mac', 'chromeos', 'linux'])) return v;
        if (v === 'other') return 'other';
        return 'unknown';
      })();

      const model = (() => {
        const v = norm(uaModelRaw);
        if (isOneOf(v, ['iphone', 'ipad'])) return v;
        return '';
      })();

      return { deviceType, platform, model };
    }

    function deviceIconKeyForPlatform(platform) {
      const p = (platform || '').trim().toLowerCase();
      if (p === 'ios') return 'type-platform-ios';
      if (p === 'mac') return 'type-platform-mac';
      if (p === 'android') return 'type-platform-android';
      if (p === 'windows') return 'type-platform-windows';
      if (p === 'chromeos') return 'type-platform-chromeos';
      if (p === 'linux') return 'type-platform-linux';
      return 'type-platform-unknown';
    }

    function deviceIconKeyForDeviceType(deviceType) {
      const d = (deviceType || '').trim().toLowerCase();
      if (d === 'desktop') return 'type-device-desktop';
      if (d === 'mobile') return 'type-device-mobile';
      if (d === 'tablet') return 'type-device-tablet';
      return 'type-device-unknown';
    }

    function deviceSortKey(s) {
      const info = deviceInfoForSession(s);
      return (info.platform + ' ' + (info.model || '') + ' ' + info.deviceType).trim().toLowerCase();
    }

    function deviceCell(s) {
      const info = deviceInfoForSession(s);
      const platformIconKey = deviceIconKeyForPlatform(info.platform);
      const deviceIconKey = deviceIconKeyForDeviceType(info.deviceType);

      function titleize(v) {
        const s = (v || '').trim().toLowerCase();
        if (!s) return '';
        if (s === 'ios') return 'iOS';
        if (s === 'mac') return 'Mac';
        if (s === 'android') return 'Android';
        if (s === 'windows') return 'Windows';
        if (s === 'chromeos') return 'Chrome OS';
        if (s === 'linux') return 'Linux';
        if (s === 'desktop') return 'Desktop';
        if (s === 'mobile') return 'Mobile';
        if (s === 'tablet') return 'Tablet';
        if (s === 'iphone') return 'iPhone';
        if (s === 'ipad') return 'iPad';
        if (s === 'other') return 'Other';
        if (s === 'unknown') return 'Unknown';
        return s;
      }

      const titleParts = [];
      if (info.platform && info.platform !== 'unknown') titleParts.push(titleize(info.platform));
      if (info.model) titleParts.push(titleize(info.model));
      if (info.deviceType && info.deviceType !== 'unknown') titleParts.push(titleize(info.deviceType));
      const title = titleParts.length ? titleParts.join(' - ') : (s && s.device != null ? String(s.device) : 'Unknown');
      const t = title ? ' title="' + escapeHtml(String(title)) + '"' : '';

      return '' +
        '<span class="kexo-device-icons"' + t + '>' +
          '<i class="fa-light fa-circle-question" data-icon-key="' + escapeHtml(platformIconKey) + '" aria-hidden="true"></i>' +
          '<i class="fa-light fa-globe" data-icon-key="' + escapeHtml(deviceIconKey) + '" aria-hidden="true"></i>' +
          '<span class="visually-hidden">' + escapeHtml(String(title || '')) + '</span>' +
        '</span>';
    }

    var liveComplianceMarkersCache = {};
    function getComplianceCellHtmlFromState(hasSale, hasEval, triggered, score) {
      var scoreText = (typeof score === 'number' && Number.isFinite(score)) ? String(Math.trunc(score)) : '';
      var title = hasEval
        ? (triggered
          ? ('Compliance warning' + (scoreText ? (' (score ' + scoreText + ')') : ''))
          : ('Compliance passed' + (scoreText ? (' (score ' + scoreText + ')') : '')))
        : 'Compliance';
      var saleIcon = hasSale
        ? '<i class="fa-solid fa-sterling-sign compliance-sale-icon" data-icon-key="table-icon-converted-sale" aria-hidden="true"></i>'
        : '';
      var statusIcon = '';
      if (hasEval) {
        statusIcon = triggered
          ? '<i class="fa-light fa-triangle-exclamation compliance-status-icon is-warn" data-icon-key="table-icon-compliance-warning" aria-hidden="true"></i>'
          : '<i class="fa-light fa-circle-check compliance-status-icon is-ok" data-icon-key="table-icon-compliance-check" aria-hidden="true"></i>';
      } else {
        statusIcon = '<i class="fa-light fa-magnifying-glass compliance-status-icon is-search" data-icon-key="table-icon-compliance-search" aria-hidden="true"></i>';
      }
      return '<span class="compliance-icons" aria-label="' + escapeHtml(title) + '" title="' + escapeHtml(title) + '">' + saleIcon + statusIcon + '</span>';
    }

    function inferPaymentProviderKeyFromSession(s) {
      try {
        if (!s || !s.has_purchased) return null;
        var candidates = [];
        if (s.payment_method_type != null) candidates.push(String(s.payment_method_type));
        if (s.payment_gateway != null) candidates.push(String(s.payment_gateway));
        if (s.payment_method_name != null) candidates.push(String(s.payment_method_name));
        for (var i = 0; i < candidates.length; i++) {
          var raw = (candidates[i] || '').trim();
          if (!raw) continue;
          var low = raw.toLowerCase();
          if (low.includes('paypal')) return 'paypal';
          if (low.includes('apple') && low.includes('pay')) return 'applepay';
          if (low.includes('google') && low.includes('pay')) return 'google-pay';
          if (low.includes('klarna')) return 'klarna';
          if (low.includes('shop') && low.includes('pay')) return 'shop-pay';
          if (low.includes('visa')) return 'visa';
          if (low.includes('mastercard')) return 'mastercard';
          if (low.includes('american') && low.includes('express')) return 'americanexpress';
          if (typeof normalizePaymentProviderKey === 'function') {
            var k = normalizePaymentProviderKey(raw);
            if (k) {
              var meta = (typeof paymentProviderMeta === 'function') ? paymentProviderMeta(k) : null;
              if (meta && meta.iconKey) return k;
            }
          }
        }
      } catch (_) {}
      return null;
    }

    function paymentIconHtmlForSession(s) {
      try {
        var k = inferPaymentProviderKeyFromSession(s);
        if (!k) return '';
        if (typeof paymentProviderIconHtml === 'function') {
          return paymentProviderIconHtml(k, { extraClass: 'payment-xxs' });
        }
        var meta = (typeof paymentProviderMeta === 'function') ? paymentProviderMeta(k) : null;
        if (!meta) return '';
        return '<i class="' + escapeHtml(String(meta.iconClass || 'fa-light fa-credit-card') + ' payment-xxs') + '" data-icon-key="' + escapeHtml(String(meta.iconKey || 'payment-method-other')) + '" aria-label="' + escapeHtml(meta.label || '') + '" title="' + escapeHtml(meta.label || '') + '" aria-hidden="true"></i>';
      } catch (_) {
        return '';
      }
    }

    function renderRow(s) {
      const countryCode = s.country_code || 'XX';
      const visits = (s.returning_count != null ? s.returning_count : 0) + 1;
      const visitsLabel = String(visits);
      const actionsLabel = String(sessionActionsCount(s));
      const exitLabel = String(sessionExitLabel(s) || '\u2014');
      const showExit = String(PAGE || '').trim().toLowerCase() !== 'live';
      const exitCell = showExit ? `<div class="grid-cell" role="cell">${escapeHtml(exitLabel)}</div>` : '';
      const cartValueNum = s.cart_value != null ? Number(s.cart_value) : NaN;
      const cartVal = s.has_purchased ? '' : ((s.cart_value != null && !Number.isNaN(cartValueNum))
        ? formatMoney(Math.floor(cartValueNum), s.cart_currency)
        : '');
      const saleVal = s.has_purchased ? formatMoney(s.order_total != null ? Number(s.order_total) : null, s.order_currency) : '';
      const paymentIcon = s.has_purchased ? paymentIconHtmlForSession(s) : '';
      const cartOrSaleCell = s.has_purchased
        ? ('<span class="d-inline-flex align-items-center gap-2">' +
            '<span class="cart-value-sale">' + escapeHtml(saleVal) + '</span>' +
            paymentIcon +
          '</span>')
        : cartVal;
      const cached = liveComplianceMarkersCache[s.session_id];
      const hasEval = cached ? !!cached.hasEval : false;
      const triggered = cached ? !!cached.triggered : false;
      const score = (cached && cached.score != null) ? Number(cached.score) : null;
      const complianceCellHtml = getComplianceCellHtmlFromState(!!s.has_purchased, hasEval, triggered, score);
      const fromCell = flagImg(countryCode);
      let consentDebug = '';
      if (s && s.meta_json) {
        try {
          const mj = JSON.parse(String(s.meta_json || '{}'));
          consentDebug = (mj && mj.customer_privacy_debug) ? 'yes' : '';
        } catch (_) {}
      }
      return `<div class="grid-row clickable ${s.is_returning ? 'returning' : ''} ${s.has_purchased ? 'converted' : ''}" role="row" data-session-id="${s.session_id}">
        <div class="grid-cell landing-cell" role="cell">${landingPageCell(s)}</div>
        <div class="grid-cell compliance-cell" role="cell">${complianceCellHtml}</div>
        <div class="grid-cell flag-cell" role="cell">${fromCell}</div>
        <div class="grid-cell source-cell" role="cell">${sourceCell(s)}</div>
        <div class="grid-cell device-cell" role="cell">${deviceCell(s)}</div>
        <div class="grid-cell cart-value-cell" role="cell">${cartOrSaleCell}</div>
        <div class="grid-cell arrived-cell" role="cell"><span data-started="${s.started_at}">${arrivedAgo(s.started_at)}</span></div>
        <div class="grid-cell last-seen-cell" role="cell"><span data-last-seen="${s.last_seen}">${arrivedAgo(s.last_seen)}</span></div>
        <div class="grid-cell" role="cell">${escapeHtml(actionsLabel)}</div>
        ${exitCell}
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
          va = deviceSortKey(a);
          vb = deviceSortKey(b);
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

    var PATCH_CHUNK_SIZE = 12;
    var PATCH_CHUNK_YIELD_THRESHOLD = 15;

    function patchSessionsTableBodySync(tbody, list, existing, hadRows, desired) {
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
    }

    function patchSessionsTableBody(tbody, pageSessions) {
      if (!tbody) return;
      const list = Array.isArray(pageSessions) ? pageSessions : [];
      if (!list.length) return;

      const existing = new Map();
      Array.from(tbody.querySelectorAll('.grid-row[data-session-id]')).forEach(function(row) {
        const sid = row && row.getAttribute ? (row.getAttribute('data-session-id') || '') : '';
        if (sid) existing.set(String(sid), row);
      });
      const hadRows = existing.size > 0;
      const desired = [];

      if (list.length <= PATCH_CHUNK_YIELD_THRESHOLD) {
        patchSessionsTableBodySync(tbody, list, existing, hadRows, desired);
      } else {
        var chunkStart = 0;
        function flushPatch() {
          var cursor = tbody.firstElementChild;
          desired.forEach(function(row) {
            if (!row) return;
            if (row === cursor) {
              cursor = cursor.nextElementSibling;
              return;
            }
            try { tbody.insertBefore(row, cursor); } catch (_) {}
          });
          existing.forEach(function(row) { try { row.remove(); } catch (_) {} });
          try {
            Array.from(tbody.querySelectorAll('.grid-row:not([data-session-id])')).forEach(function(row) { row.remove(); });
          } catch (_) {}
          desired.forEach(function(row) {
            if (!row || !row.classList) return;
            if (!row.classList.contains('kexo-row-insert') && !row.classList.contains('kexo-row-update')) return;
            setTimeout(function() {
              try { row.classList.remove('kexo-row-insert', 'kexo-row-update'); } catch (_) {}
            }, 900);
          });
          try { refreshComplianceMarkersForSessionsTable(); } catch (_) {}
        }
        function doChunk() {
          var chunkEnd = Math.min(chunkStart + PATCH_CHUNK_SIZE, list.length);
          var chunk = list.slice(chunkStart, chunkEnd);
          patchSessionsTableBodySync(tbody, chunk, existing, hadRows, desired);
          chunkStart = chunkEnd;
          if (chunkStart < list.length && typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(doChunk);
            return;
          }
          flushPatch();
        }
        doChunk();
        return;
      }


      var cursor = tbody.firstElementChild;
      desired.forEach(function(row) {
        if (!row) return;
        if (row === cursor) {
          cursor = cursor.nextElementSibling;
          return;
        }
        try { tbody.insertBefore(row, cursor); } catch (_) {}
      });
      existing.forEach(function(row) { try { row.remove(); } catch (_) {} });
      try {
        Array.from(tbody.querySelectorAll('.grid-row:not([data-session-id])')).forEach(function(row) { row.remove(); });
      } catch (_) {}

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
      const renderStart = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
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
      const sorted = getSortedSessions();
      const isRangeMode = sessionsTotal != null;
      const totalPages = isRangeMode
        ? Math.max(1, Math.ceil(sessionsTotal / rowsPerPage))
        : Math.max(1, Math.ceil(sorted.length / rowsPerPage));
      currentPage = Math.min(Math.max(1, currentPage), totalPages);
      const start = (currentPage - 1) * rowsPerPage;
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
      try {
        if (typeof performance !== 'undefined' && performance.now) {
          var ms = Math.round((performance.now() - renderStart) * 100) / 100;
          try { window.__kexoPerfMetrics = window.__kexoPerfMetrics || {}; window.__kexoPerfMetrics.lastTableRenderMs = ms; } catch (_) {}
        }
      } catch (_) {}
      try { refreshComplianceMarkersForSessionsTable(); } catch (_) {}
    }

    // Fraud markers + modal (fail-open; markers fetched in batches).
    var fraudUiBound = false;
    var fraudMarkersFetchInFlight = null; // { key, p }
    var fraudMarkersLastKey = '';
    var fraudMarkersLastAt = 0;

    function buildFraudAlertIconHtml(entityType, entityId, marker) {
      var et = entityType ? String(entityType) : 'session';
      var eid = entityId != null ? String(entityId) : '';
      if (!eid) return '';
      var score = marker && marker.score != null ? Number(marker.score) : null;
      var scoreText = (typeof score === 'number' && Number.isFinite(score)) ? String(Math.trunc(score)) : '';
      var title = scoreText ? ('Fraud alert (score ' + scoreText + ')') : 'Fraud alert';
      return (
        '<i class="fa-light fa-triangle-exclamation fraud-alert-icon"' +
          ' data-icon-key="fraud-alert"' +
          ' data-fraud-open="1"' +
          ' data-fraud-entity-type="' + escapeHtml(et) + '"' +
          ' data-fraud-entity-id="' + escapeHtml(eid) + '"' +
          ' aria-label="' + escapeHtml(title) + '"' +
          ' title="' + escapeHtml(title) + '"' +
        '></i>'
      );
    }

    function fetchFraudMarkers(entityType, ids) {
      var et = entityType ? String(entityType).trim().toLowerCase() : '';
      if (et !== 'session' && et !== 'order') return Promise.resolve({});
      var list = Array.isArray(ids) ? ids.map(function(x) { return x != null ? String(x).trim() : ''; }).filter(Boolean) : [];
      if (!list.length) return Promise.resolve({});
      if (list.length > 200) list = list.slice(0, 200);
      var key = et + ':' + list.join(',');
      if (fraudMarkersFetchInFlight && fraudMarkersFetchInFlight.key === key) return fraudMarkersFetchInFlight.p;
      var url = API + '/api/fraud/markers?entityType=' + encodeURIComponent(et) + '&ids=' + encodeURIComponent(list.join(',')) + '&_=' + Date.now();
      var p = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) { return (json && typeof json === 'object') ? json : {}; })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'fraudMarkersFetch', page: (document.body && document.body.getAttribute('data-page')) || '' }); } catch (_) {}
          return {};
        })
        .finally(function() { if (fraudMarkersFetchInFlight && fraudMarkersFetchInFlight.key === key) fraudMarkersFetchInFlight = null; });
      fraudMarkersFetchInFlight = { key: key, p: p };
      return p;
    }

    var complianceHelpGlobalBound = false;
    function ensureComplianceHeaderUi() {
      var table = document.getElementById('sessions-table');
      if (!table || !table.querySelector) return;
      var th = table.querySelector('.grid-row--header .grid-cell.compliance-cell');
      if (!th) return;
      if (th.getAttribute('data-compliance-header') === '1') return;
      th.setAttribute('data-compliance-header', '1');
      th.innerHTML = '<i class="compliance-header-icon" data-icon-key="table-icon-compliance-header" aria-hidden="true"></i>';
    }

    function complianceCellHtml(sessionId, options) {
      var sid = sessionId != null ? String(sessionId) : '';
      if (!sid) return '';
      var opts = options && typeof options === 'object' ? options : {};
      return getComplianceCellHtmlFromState(!!opts.hasSale, !!opts.hasEval, !!opts.triggered, opts.score != null ? Number(opts.score) : null);
    }

    function refreshComplianceMarkersForSessionsTable() {
      ensureComplianceHeaderUi();
      var tbody = document.getElementById('table-body');
      if (!tbody) return;
      var rows = Array.from(tbody.querySelectorAll('.grid-row[data-session-id]'));
      if (!rows.length) return;
      var ids = rows.map(function(r) { return r.getAttribute('data-session-id') || ''; }).filter(Boolean);
      if (!ids.length) return;
      // Avoid spamming when renderTable is called repeatedly in quick succession.
      var key = ids.join(',');
      var now = Date.now();
      if (key === fraudMarkersLastKey && (now - fraudMarkersLastAt) >= 0 && (now - fraudMarkersLastAt) < 600) return;
      fraudMarkersLastKey = key;
      fraudMarkersLastAt = now;
      fetchFraudMarkers('session', ids).then(function(markers) {
        rows.forEach(function(row) {
          if (!row || !row.querySelector) return;
          var sid = row.getAttribute('data-session-id') || '';
          var cell = row.querySelector('.grid-cell.compliance-cell');
          if (!cell) return;
          var m = markers && markers[sid] ? markers[sid] : null;
          var hasEval = !!(m && (m.has_eval === true || m.hasEval === true));
          var triggered = !!(m && m.triggered === true);
          var score = m && m.score != null ? Number(m.score) : null;
          try { liveComplianceMarkersCache[sid] = { hasEval: hasEval, triggered: triggered, score: score }; } catch (_) {}
          var hasSale = false;
          try { hasSale = row.classList && row.classList.contains('converted'); } catch (_) { hasSale = false; }
          var sig = (hasSale ? '1' : '0') + '|' + (hasEval ? '1' : '0') + '|' + (triggered ? '1' : '0') + '|' + (score != null && Number.isFinite(score) ? String(Math.trunc(score)) : '');
          if (cell.getAttribute('data-compliance-sig') === sig) return;
          try { cell.setAttribute('data-compliance-sig', sig); } catch (_) {}
          cell.innerHTML = complianceCellHtml(sid, { hasSale: hasSale, hasEval: hasEval, triggered: triggered, score: score });
        });
      }).catch(function(err) {
        try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'complianceMarkersRefresh', page: (document.body && document.body.getAttribute('data-page')) || '' }); } catch (_) {}
      });
    }

    function refreshFraudMarkersForLatestSalesTable() {
      var table = document.getElementById('latest-sales-table');
      if (!table) return;
      var rows = Array.from(table.querySelectorAll('tbody tr[data-session-id]'));
      if (!rows.length) return;
      var ids = rows.map(function(tr) { return tr.getAttribute('data-session-id') || ''; }).filter(Boolean);
      if (!ids.length) return;
      fetchFraudMarkers('session', ids).then(function(markers) {
        rows.forEach(function(tr) {
          if (!tr || !tr.querySelector) return;
          var sid = tr.getAttribute('data-session-id') || '';
          var slot = tr.querySelector('.latest-sales-fraud-slot');
          if (!slot) return;
          var m = markers && markers[sid] ? markers[sid] : null;
          var triggered = !!(m && m.triggered === true);
          slot.innerHTML = triggered ? buildFraudAlertIconHtml('session', sid, m) : '';
        });
      }).catch(function(err) {
        try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'latestSalesFraudMarkersRefresh', page: (document.body && document.body.getAttribute('data-page')) || '' }); } catch (_) {}
      });
    }

    function ensureFraudModal() {
      var existing = document.getElementById('fraud-detail-modal');
      if (existing) return existing;
      var wrap = document.createElement('div');
      wrap.innerHTML = (
        '<div class="modal modal-blur" id="fraud-detail-modal" tabindex="-1" role="dialog" aria-hidden="true">' +
          '<div class="modal-dialog modal-lg modal-dialog-centered" role="document">' +
            '<div class="modal-content">' +
              '<div class="modal-header">' +
                '<h5 class="modal-title">Fraud alert</h5>' +
                '<button type="button" class="btn-close" aria-label="Close" data-fraud-close="1"></button>' +
              '</div>' +
              '<div class="modal-body" id="fraud-detail-body"></div>' +
              '<div class="modal-footer">' +
                '<button type="button" class="btn btn-outline-secondary" data-fraud-open-session="1" style="display:none">Open session</button>' +
                '<a class="btn btn-outline-secondary" data-fraud-shopify-order="1" target="_blank" rel="noopener" style="display:none">Open order (Shopify)</a>' +
                '<button type="button" class="btn btn-primary" data-fraud-close="1">Close</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
      var el = wrap.firstChild;
      document.body.appendChild(el);
      return el;
    }

    function showFraudModal() {
      var el = ensureFraudModal();
      try {
        if (window.bootstrap && window.bootstrap.Modal) {
          var inst = window.bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, focus: true, keyboard: true });
          inst.show();
          return;
        }
      } catch (_) {}
      // Minimal fallback (should rarely be used).
      try { el.style.display = 'block'; } catch (_) {}
      try { el.classList.add('show'); } catch (_) {}
      try {
        var bd = document.createElement('div');
        bd.className = 'modal-backdrop fade show';
        bd.setAttribute('data-fraud-backdrop', '1');
        document.body.appendChild(bd);
      } catch (_) {}
    }

    function hideFraudModal() {
      var el = document.getElementById('fraud-detail-modal');
      if (!el) return;
      try {
        if (window.bootstrap && window.bootstrap.Modal) {
          var inst = window.bootstrap.Modal.getOrCreateInstance(el);
          inst.hide();
        }
      } catch (_) {}
      try { el.classList.remove('show'); } catch (_) {}
      try { el.style.display = 'none'; } catch (_) {}
      try {
        Array.from(document.querySelectorAll('[data-fraud-backdrop="1"]')).forEach(function(n) { n.remove(); });
      } catch (_) {}
    }

    function shopifyAdminOrderUrl(orderId) {
      var oid = orderId != null ? String(orderId).trim() : '';
      if (!oid || !/^\d+$/.test(oid)) return null;
      var shop = null;
      try { shop = getShopParam() || shopForSalesFallback || null; } catch (_) { shop = null; }
      if (!shop) return null;
      return 'https://' + shop + '/admin/orders/' + encodeURIComponent(oid);
    }

    function renderFraudDetailBody(detail) {
      var d = detail && detail.evaluation ? detail : { evaluation: null };
      var ev = d && d.evaluation ? d.evaluation : null;
      if (!ev) return '<div class="text-muted">Unavailable.</div>';
      var score = ev.score != null ? Number(ev.score) : null;
      var scoreText = (typeof score === 'number' && Number.isFinite(score)) ? String(Math.trunc(score)) : '\u2014';
      var risk = d && d.analysis && d.analysis.risk_level ? String(d.analysis.risk_level) : 'Unknown';
      var summary = d && d.analysis && d.analysis.summary ? String(d.analysis.summary) : '';
      var rec = d && d.analysis && d.analysis.recommended_action ? String(d.analysis.recommended_action) : '';
      var reasons = d && d.analysis && Array.isArray(d.analysis.key_reasons) ? d.analysis.key_reasons : [];
      var flags = ev.flags && Array.isArray(ev.flags) ? ev.flags : [];
      var evidence = ev.evidence && typeof ev.evidence === 'object' ? ev.evidence : {};
      var badge = (risk === 'High') ? 'bg-red-lt text-red' : (risk === 'Medium') ? 'bg-yellow-lt text-yellow' : 'bg-green-lt text-green';
      function listKeys(obj) {
        try {
          if (!obj || typeof obj !== 'object') return [];
          return Object.keys(obj).filter(function(k) { return obj[k] != null && String(obj[k]).trim() !== ''; }).slice(0, 8);
        } catch (_) { return []; }
      }
      function flagDetail(flagKey) {
        var k = String(flagKey || '').trim().toLowerCase();
        var attr = evidence && evidence.attribution ? evidence.attribution : {};
        var eng = evidence && evidence.engagement ? evidence.engagement : {};
        var sig = evidence && evidence.signals ? evidence.signals : {};
        if (k === 'google_ads_conflict') {
          var paid = attr && attr.paid_click_ids ? attr.paid_click_ids : {};
          var aff = attr && attr.affiliate_click_ids ? attr.affiliate_click_ids : {};
          var pk = listKeys(paid);
          var ak = listKeys(aff);
          return 'Paid click IDs (' + (pk.length ? pk.join(', ') : 'none') + ') and affiliate click IDs (' + (ak.length ? ak.join(', ') : 'none') + ') both detected.';
        }
        if (k === 'late_injection') {
          var late = attr && attr.late ? attr.late : null;
          var affLate = late && late.affiliate_click_ids ? late.affiliate_click_ids : {};
          var ak = listKeys(affLate);
          var seenAt = late && late.seen_at != null ? Number(late.seen_at) : null;
          var when = (seenAt && Number.isFinite(seenAt)) ? ('seen_at ' + new Date(seenAt).toLocaleString()) : 'seen late';
          return 'Affiliate click IDs appeared late (' + (ak.length ? ak.join(', ') : 'unknown') + '), ' + when + '.';
        }
        if (k === 'low_engagement') {
          var pv = eng && eng.page_views != null ? Number(eng.page_views) : null;
          var te = eng && eng.total_events != null ? Number(eng.total_events) : null;
          return 'Very few interactions before checkout (page_views: ' + (pv != null && Number.isFinite(pv) ? pv : '\u2014') + ', total_events: ' + (te != null && Number.isFinite(te) ? te : '\u2014') + ').';
        }
        if (k === 'suspicious_referrer') {
          var ref = attr && attr.referrer ? String(attr.referrer) : '';
          return ref ? ('Referrer matches coupon/deal patterns: ' + ref) : 'Referrer matches coupon/deal patterns.';
        }
        if (k === 'duplicate_ip_pattern') {
          var n = sig && sig.duplicate_ip_triggered_recent != null ? Number(sig.duplicate_ip_triggered_recent) : null;
          var h = sig && sig.duplicate_ip_window_hours != null ? Number(sig.duplicate_ip_window_hours) : null;
          if (n != null && Number.isFinite(n) && h != null && Number.isFinite(h)) {
            return 'Triggered evaluations from the same IP hash in last ' + h + 'h: ' + n + '.';
          }
          if (n != null && Number.isFinite(n)) return 'Multiple triggered evaluations share the same IP hash (count: ' + n + ').';
          return 'Multiple triggered evaluations share the same IP hash in a short window.';
        }
        if (k === 'no_affiliate_evidence') {
          var net = attr && attr.affiliate_network_hint ? String(attr.affiliate_network_hint) : '';
          var idh = attr && attr.affiliate_id_hint ? String(attr.affiliate_id_hint) : '';
          var um = attr && attr.utm_medium ? String(attr.utm_medium) : '';
          var parts = [];
          if (net) parts.push('network: ' + net);
          if (idh) parts.push('affiliate_id: ' + idh);
          if (um) parts.push('utm_medium: ' + um);
          return 'Affiliate attribution hints present but no reliable click ID evidence' + (parts.length ? (' (' + parts.join(', ') + ')') : '') + '.';
        }
        return '';
      }
      var flagsHtml = flags.length
        ? (
            '<ul class="fraud-flag-lines">' +
              flags.map(function(f) {
                var desc = flagDetail(f);
                return '<li><span class="badge bg-azure-lt">' + escapeHtml(String(f)) + '</span>' + (desc ? ('<span class="fraud-flag-desc">' + escapeHtml(desc) + '</span>') : '') + '</li>';
              }).join('') +
            '</ul>'
          )
        : '<div class="text-muted">No flags recorded.</div>';
      var reasonsHtml = reasons.length
        ? ('<ul class="fraud-reasons">' + reasons.map(function(r) { return '<li>' + escapeHtml(String(r)) + '</li>'; }).join('') + '</ul>')
        : '';
      var evidenceJson = '';
      try { evidenceJson = JSON.stringify(evidence, null, 2); } catch (_) { evidenceJson = ''; }
      return (
        '<div class="fraud-detail-grid">' +
          '<div class="fraud-score">' +
            '<div class="fraud-score-num">' + escapeHtml(scoreText) + '</div>' +
            '<div class="fraud-score-meta">' +
              '<span class="badge ' + escapeHtml(badge) + '" style="font-weight:500">' + escapeHtml(risk) + '</span>' +
              '<div class="text-muted" style="margin-top:.25rem">Fraud score (0\u2013100)</div>' +
            '</div>' +
          '</div>' +
          '<div class="fraud-analysis">' +
            '<div class="mb-2" style="font-weight:500">Analysis</div>' +
            '<div class="fraud-summary">' + escapeHtml(summary || '\u2014') + '</div>' +
            (reasonsHtml ? ('<div class="mt-2">' + reasonsHtml + '</div>') : '') +
            (rec ? ('<div class="mt-2 text-muted"><span style="font-weight:500">Suggested action:</span> ' + escapeHtml(rec) + '</div>') : '') +
          '</div>' +
        '</div>' +
        '<hr class="my-3" />' +
        '<div class="mb-2" style="font-weight:500">Flags</div>' +
        flagsHtml +
        '<hr class="my-3" />' +
        '<div class="mb-2 d-flex align-items-center justify-content-between">' +
          '<div style="font-weight:500">Evidence (safe snapshot)</div>' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" data-fraud-copy-evidence="1">Copy</button>' +
        '</div>' +
        '<pre class="fraud-evidence-pre" data-fraud-evidence-pre="1">' + escapeHtml(evidenceJson || '{}') + '</pre>'
      );
    }

    function openFraudDetailModal(entityType, entityId) {
      var et = entityType ? String(entityType).trim().toLowerCase() : 'session';
      var eid = entityId != null ? String(entityId).trim() : '';
      if (!eid) return;
      var modal = ensureFraudModal();
      var body = modal.querySelector('#fraud-detail-body');
      if (body) body.innerHTML = '<div class="text-muted">Loading\u2026</div>';
      // Hide action buttons until we have links.
      try {
        var btnSession = modal.querySelector('[data-fraud-open-session]');
        var btnOrder = modal.querySelector('[data-fraud-shopify-order]');
        if (btnSession) btnSession.style.display = 'none';
        if (btnOrder) btnOrder.style.display = 'none';
      } catch (_) {}
      showFraudModal();
      var url = API + '/api/fraud/detail?entityType=' + encodeURIComponent(et) + '&entityId=' + encodeURIComponent(eid) + '&_=' + Date.now();
      fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) {
          if (!json || !json.ok || !json.evaluation) {
            if (body) body.innerHTML = '<div class="text-muted">Unavailable.</div>';
            return null;
          }
          if (body) body.innerHTML = renderFraudDetailBody(json);
          try {
            var links = json.links || {};
            var sid = links && links.session_id ? String(links.session_id) : '';
            var oid = links && links.order_id ? String(links.order_id) : '';
            var btnSession = modal.querySelector('[data-fraud-open-session]');
            if (btnSession && sid) {
              btnSession.style.display = '';
              btnSession.setAttribute('data-fraud-open-session', sid);
            }
            var btnOrder = modal.querySelector('[data-fraud-shopify-order]');
            var orderUrl = shopifyAdminOrderUrl(oid);
            if (btnOrder && orderUrl) {
              btnOrder.style.display = '';
              btnOrder.setAttribute('href', orderUrl);
            }
          } catch (_) {}
          return json;
        })
        .catch(function() {
          if (body) body.innerHTML = '<div class="text-muted">Unavailable.</div>';
          return null;
        });
    }

    (function initFraudUi() {
      if (fraudUiBound) return;
