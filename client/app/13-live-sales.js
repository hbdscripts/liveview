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

    var _tickTimeIntervalId = null;
    function ensureTickTimeInterval() {
      if (_tickTimeIntervalId) return _tickTimeIntervalId;
      _tickTimeIntervalId = setInterval(function() {
        if (document.visibilityState !== 'visible') return;
        try { tickTimeOnSite(); } catch (_) {}
      }, 30000);
      _intervals.push(_tickTimeIntervalId);
      return _tickTimeIntervalId;
    }

    // Background polling is intentionally disabled across the site (manual refresh only),
    // except for /dashboard/live and /dashboard/sales (which use a dedicated 10s poller).
    ensureTickTimeInterval();

    // ?????? Tab resume + deploy drift guard ???????????????????????????????????????????????????????????????????????????????????????????????????????????????
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

    // On mobile, post-login redirect can restore the dashboard from bfcache; DOMContentLoaded
    // does not fire again, so data fetches never run. Refresh when page is shown from bfcache.
    // Also restart SSE and pollers (runCleanup on pagehide closes them).
    function reinitLiveStreamsAndPollers() {
      try { initEventSource(); } catch (_) {}
      ensureTickTimeInterval();
      try { if (typeof scheduleLiveSalesPoll === 'function') scheduleLiveSalesPoll(LIVE_SALES_POLL_MS); } catch (_) {}
      try { if (typeof window.__kexoInitStickyDocObserver === 'function') window.__kexoInitStickyDocObserver(); } catch (_) {}
      try { if (typeof window.__kexoInitGridDocObserver === 'function') window.__kexoInitGridDocObserver(); } catch (_) {}
    }
    window.addEventListener('pageshow', function(ev) {
      if (!ev.persisted) return;
      reinitLiveStreamsAndPollers();
      kexoWithSilentOverlay(function() {
        if (PAGE === 'dashboard') {
          try {
            if (window.dashboardController && typeof window.dashboardController.onVisibleResume === 'function') window.dashboardController.onVisibleResume('pageshow');
            else if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true });
          } catch (_) {}
        }
        try { refreshKpis({ force: true }); } catch (_) {}
      });
    });

    var VISIBILITY_REFRESH_MIN_IDLE_MS = 30 * 1000; // Skip full refresh if tab was hidden < 30s (avoids lag on brief tab switch)
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible') {
        _lastHiddenAt = Date.now();
        try { window.__kexoLastHiddenAt = _lastHiddenAt; } catch (_) {}
        return;
      }

      var idleMs = _lastHiddenAt ? (Date.now() - _lastHiddenAt) : 0;
      // Skip refresh for brief hides (< 30s) to avoid CPU/memory spike when returning to tab.
      if (idleMs < VISIBILITY_REFRESH_MIN_IDLE_MS) {
        return onBecameVisible();
      }
      // Dashboard has its own visibility listener (dashboardController); delegate to avoid duplicate refresh.
      // When on dashboard, dashboardController handles refresh + KPIs. When on other pages, refresh KPIs only.
      if (idleMs < 2 * 60 * 1000 && PAGE === 'dashboard') {
        kexoWithSilentOverlay(function() {
          try {
            if (window.dashboardController && typeof window.dashboardController.onVisibleResume === 'function') window.dashboardController.onVisibleResume('visibility');
            else {
              if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true });
              try { refreshKpis({ force: true }); } catch (_) {}
            }
          } catch (_) {}
        });
      } else if (idleMs < 2 * 60 * 1000 && PAGE !== 'dashboard') {
        kexoWithSilentOverlay(function() {
          try { refreshKpis({ force: true }); } catch (_) {}
        });
      }
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

    var _newSaleRefreshTimer = null;
    function scheduleNewSaleDashboardRefresh() {
      if (_newSaleRefreshTimer) return;
      _newSaleRefreshTimer = setTimeout(function () {
        _newSaleRefreshTimer = null;
        try { if (typeof refreshKpis === 'function') refreshKpis({ force: true }); } catch (_) {}
        try {
          if (PAGE === 'dashboard' || activeMainTab === 'dashboard') {
            if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true, reason: 'new-sale' });
          }
        } catch (_) {}
      }, 280);
    }

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
            setSaleToastContent({ countryCode: cc || 'XX', productTitle: (productTitle || curTitle || '\u2014'), amountGbp });
          }
        } catch (_) {}
      }

      function maybeTriggerSaleToastFromSse(session) {
        try {
          if (!session || !session.has_purchased) return;
          const purchasedAt = session.purchased_at != null ? toMs(session.purchased_at) : null;
          if (purchasedAt == null) return;
          const cur = lastSaleAt == null ? null : toMs(lastSaleAt);
          // If we don't have a baseline yet: only skip if the sale is old (likely stale catch-up).
          // If the sale is recent (within 2 min), treat it as new and fire toast + sound.
          if (cur == null) {
            setLastSaleAt(purchasedAt);
            const ageMs = Date.now() - purchasedAt;
            if (ageMs > 2 * 60 * 1000) return; // older than 2 min: skip (stale)
            triggerSaleToast({ origin: 'sse', session: session, playSound: true });
            scheduleNewSaleDashboardRefresh();
            return;
          }
          if (purchasedAt <= cur) { setLastSaleAt(purchasedAt); return; }
          setLastSaleAt(purchasedAt);
          triggerSaleToast({ origin: 'sse', session: session, playSound: true });
          scheduleNewSaleDashboardRefresh();
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

    // ?????? Cleanup on page unload (centralized via registerCleanup in core) ??????
    registerCleanup(function() {
      _intervals.forEach(function(id) { clearInterval(id); });
      _intervals.length = 0;
      _tickTimeIntervalId = null;
      if (liveSalesPollTimer) { try { clearTimeout(liveSalesPollTimer); } catch (_) {} liveSalesPollTimer = null; }
      if (_newSaleRefreshTimer) { try { clearTimeout(_newSaleRefreshTimer); } catch (_) {} _newSaleRefreshTimer = null; }
      if (_eventSource) { try { _eventSource.close(); } catch (_) {} _eventSource = null; }
      if (_condensedStripResizeObserver) {
        try { _condensedStripResizeObserver.disconnect(); } catch (_) {}
        _condensedStripResizeObserver = null;
      }
      try {
        document.querySelectorAll('.table-scroll-wrap, .country-table-wrap, .grid-table, .table-responsive').forEach(function(wrap) {
          try { if (wrap && wrap._dragScrollObserver && typeof wrap._dragScrollObserver.disconnect === 'function') wrap._dragScrollObserver.disconnect(); } catch (_) {}
          try { if (wrap && wrap._stickyResizeObserver && typeof wrap._stickyResizeObserver.disconnect === 'function') wrap._stickyResizeObserver.disconnect(); } catch (_) {}
          try { if (wrap && wrap._stickyResizeMutationObserver && typeof wrap._stickyResizeMutationObserver.disconnect === 'function') wrap._stickyResizeMutationObserver.disconnect(); } catch (_) {}
        });
      } catch (_) {}
      Object.keys(_fetchAbortControllers).forEach(function(k) {
        try { _fetchAbortControllers[k].abort(); } catch (_) {}
      });
    });

    // ?????? Dashboard tab logic ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    (function initDashboard() {
      var dashLoading = false;
