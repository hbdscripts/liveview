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
      if (k === 'attribution') return 'Preparing attribution report';
      if (k === 'devices') return 'Preparing devices report';
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
    let reportBuildGlobalActive = 0;
    function beginGlobalReportLoading() {
      reportBuildGlobalActive = Math.max(0, reportBuildGlobalActive) + 1;
      if (reportBuildGlobalActive === 1) {
        try { document.body.classList.add('kexo-report-loading'); } catch (_) {}
      }
    }
    function endGlobalReportLoading() {
      reportBuildGlobalActive = Math.max(0, reportBuildGlobalActive - 1);
      if (reportBuildGlobalActive <= 0) {
        reportBuildGlobalActive = 0;
        try { document.body.classList.remove('kexo-report-loading'); } catch (_) {}
      }
    }
    try {
      window.__kexoBeginGlobalReportLoading = beginGlobalReportLoading;
      window.__kexoEndGlobalReportLoading = endGlobalReportLoading;
    } catch (_) {}
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
      beginGlobalReportLoading();
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
        endGlobalReportLoading();
        return;
      }
      reportBuildScopeState.set(scope, state);
      endGlobalReportLoading();
    }

    function startReportBuild(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const key = opts.key ? String(opts.key) : '';
      if (!key || !reportBuildTokens || typeof reportBuildTokens[key] !== 'number') {
        return { step: function() {}, title: function() {}, finish: function() {} };
      }

      // Default: keep the page visible (top progress bar + header spinner only).
      // Only show the full overlay when explicitly requested.
      // Also respect per-page loader enable (Admin ??? Controls). Admin is always disabled.
      var allowOverlay = true;
      try { allowOverlay = isPageLoaderEnabled(PAGE); } catch (_) { allowOverlay = true; }
      try { if (kexoSilentOverlayActive && typeof kexoSilentOverlayActive === 'function' && kexoSilentOverlayActive()) allowOverlay = false; } catch (_) {}
      var showOverlay = opts.showOverlay === true && allowOverlay;
      if (!showOverlay) {
        reportBuildTokens[key] = (reportBuildTokens[key] || 0) + 1;
        const token = reportBuildTokens[key];
        beginGlobalReportLoading();
        showPageProgress();
        var finished = false;
        return {
          step: function() {},
          title: function() {},
          finish: function() {
            if (reportBuildTokens[key] !== token) return;
            if (finished) return;
            finished = true;
            endGlobalReportLoading();
            try { window.dispatchEvent(new CustomEvent('kexo:table-rows-changed')); } catch (_) {}
            hidePageProgress();
          }
        };
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
      if (key === 'sessions' && scope) try { scope.classList.add('report-building-sessions'); } catch (_) {}
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
        if (key === 'sessions' && scope) try { scope.classList.remove('report-building-sessions'); } catch (_) {}
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

    // ?????? KPI local cache (prevents empty KPI boxes during fast navigation) ??????
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

    function renderAttributionTables(data) {
      const body = document.getElementById('attribution-body');
      if (!body) return;

      const by = (tableSortState.attribution.by || 'rev').toString().trim().toLowerCase();
      const dir = (tableSortState.attribution.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

      const rows = data && data.attribution && Array.isArray(data.attribution.rows) ? data.attribution.rows.slice() : [];
      const filtered = rows.filter(function(r) {
        const s = r && typeof r.sessions === 'number' ? r.sessions : 0;
        const o = r && typeof r.orders === 'number' ? r.orders : 0;
        return s >= 1 || o >= 1;
      });

      function stripSvgSizing(svgMarkup) {
        var raw = svgMarkup != null ? String(svgMarkup) : '';
        if (!raw) return '';
        if (!/^<svg[\s>]/i.test(raw.trim())) return raw;
        // If the SVG has no viewBox, removing/overriding width/height can clip the artwork.
        // In that case, leave the original sizing attributes intact and rely on CSS max-size.
        try {
          var m = raw.trim().match(/^<svg\b([^>]*)>/i);
          var attrs = m && m[1] ? String(m[1]) : '';
          if (!/\sviewBox\s*=/i.test(attrs)) return raw;
        } catch (_) {}
        // Remove width/height attributes from the root <svg ...> tag so CSS can enforce sizing.
        raw = raw.replace(/^<svg\b([^>]*)>/i, function (_m, attrs) {
          var a = String(attrs || '');
          a = a.replace(/\s(width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
          // Best-effort: remove width/height declarations from inline style (keep other styles).
          a = a.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/i, function (_m2, q, style) {
            var s = String(style || '');
            var cleaned = s
              .replace(/(^|;)\s*width\s*:\s*[^;]+/gi, '$1')
              .replace(/(^|;)\s*height\s*:\s*[^;]+/gi, '$1')
              .replace(/;;+/g, ';')
              .replace(/^\s*;\s*|\s*;\s*$/g, '')
              .trim();
            if (!cleaned) return '';
            return ' style=' + q + cleaned + q;
          });
          return '<svg' + a + '>';
        });
        return raw;
      }

      function iconSpecHtml(iconSpecRaw, labelRaw) {
        const spec = iconSpecRaw != null ? String(iconSpecRaw).trim() : '';
        const label = labelRaw != null ? String(labelRaw).trim() : '';
        const t = label ? (' title="' + escapeHtml(label) + '"') : '';
        if (!spec) return '';
        if (/^<svg[\s>]/i.test(spec)) {
          const svg = stripSvgSizing(spec);
          return '<span class="source-icons"' + t + ' aria-hidden="true">' + svg + '</span>';
        }
        if (/^(https?:\/\/|\/\/|\/)/i.test(spec)) {
          const src = hotImg(spec) || spec;
          return '<span class="source-icons"><img src="' + escapeHtml(src) + '" alt="' + escapeHtml(label) + '" class="source-icon-img" width="20" height="20"' + t + '></span>';
        }
        return '<span class="source-icons"><i class="' + escapeHtml(spec) + '"' + t + ' aria-hidden="true"></i></span>';
      }

      function channelLabel(r) {
        if (!r) return 'unknown';
        if (r.label != null && String(r.label).trim() !== '') return String(r.label);
        if (r.channel_key != null && String(r.channel_key).trim() !== '') return String(r.channel_key);
        return 'unknown';
      }
      function sourceLabel(r) {
        if (!r) return 'unknown';
        if (r.label != null && String(r.label).trim() !== '') return String(r.label);
        if (r.source_key != null && String(r.source_key).trim() !== '') return String(r.source_key);
        return 'unknown';
      }
      function variantLabel(r) {
        if (!r) return 'unknown';
        if (r.label != null && String(r.label).trim() !== '') return String(r.label);
        if (r.variant_key != null && String(r.variant_key).trim() !== '') return String(r.variant_key);
        return 'unknown';
      }

      function metric(r, key) {
        if (!r) return null;
        if (key === 'cr') return (typeof r.conversion_pct === 'number') ? r.conversion_pct : null;
        if (key === 'orders') return (typeof r.orders === 'number') ? r.orders : null;
        if (key === 'sessions') return (typeof r.sessions === 'number') ? r.sessions : null;
        if (key === 'rev') return (typeof r.revenue_gbp === 'number') ? r.revenue_gbp : null;
        if (key === 'vpv') {
          const rev = (typeof r.revenue_gbp === 'number') ? r.revenue_gbp : null;
          const sess = (typeof r.sessions === 'number') ? r.sessions : null;
          return (sess != null && sess > 0 && rev != null) ? (rev / sess) : null;
        }
        return null;
      }

      filtered.sort(function(a, b) {
        let primary = 0;
        if (by === 'attribution') primary = cmpNullableText(channelLabel(a), channelLabel(b), dir);
        else primary = cmpNullableNumber(metric(a, by), metric(b, by), dir);
        return primary ||
          cmpNullableNumber(metric(a, 'rev'), metric(b, 'rev'), 'desc') ||
          cmpNullableNumber(metric(a, 'orders'), metric(b, 'orders'), 'desc') ||
          cmpNullableNumber(metric(a, 'sessions'), metric(b, 'sessions'), 'desc') ||
          cmpNullableText(channelLabel(a), channelLabel(b), 'asc');
      });

      if (!filtered.length) {
        body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No attribution data yet.</div></div>';
        updateCardPagination('attribution', 1, 1);
        updateSortHeadersInContainer(document.getElementById('attribution-table'), by, dir);
        return;
      }

      const pageSize = getTableRowsPerPage('attribution-table', 'live');
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      attributionPage = clampPage(attributionPage, totalPages);
      updateCardPagination('attribution', attributionPage, totalPages);
      const pageStart = (attributionPage - 1) * pageSize;
      const pageChannels = filtered.slice(pageStart, pageStart + pageSize);

      function channelKey(r) {
        const k = r && r.channel_key != null ? String(r.channel_key).trim().toLowerCase() : '';
        return k || 'other';
      }
      function sourceKey(r) {
        const k = r && r.source_key != null ? String(r.source_key).trim().toLowerCase() : '';
        return k || 'other';
      }
      function variantKey(r) {
        const k = r && r.variant_key != null ? String(r.variant_key).trim().toLowerCase() : '';
        return k || 'other:house';
      }

      function isChannelOpen(key) {
        if (attributionExpandedChannels === null) return true;
        if (!attributionExpandedChannels || typeof attributionExpandedChannels !== 'object') return true;
        if (!Object.prototype.hasOwnProperty.call(attributionExpandedChannels, key)) return true;
        return !!attributionExpandedChannels[key];
      }
      function isSourceOpen(chKey, srcKey) {
        if (attributionExpandedSources === null) return true;
        if (!attributionExpandedSources || typeof attributionExpandedSources !== 'object') return true;
        const k = chKey + '|' + srcKey;
        if (!Object.prototype.hasOwnProperty.call(attributionExpandedSources, k)) return true;
        return !!attributionExpandedSources[k];
      }

      let html = '';
      pageChannels.forEach(function(ch) {
        const chKey = channelKey(ch);
        const chOpen = isChannelOpen(chKey);
        const chLabel = channelLabel(ch);
        const chCr = (ch && typeof ch.conversion_pct === 'number') ? pct(ch.conversion_pct) : '-';
        const chOrders = (ch && typeof ch.orders === 'number') ? formatSessions(ch.orders) : '-';
        const chSessions = (ch && typeof ch.sessions === 'number') ? formatSessions(ch.sessions) : '-';
        const chRev = (ch && typeof ch.revenue_gbp === 'number') ? formatRevenueTableHtml(ch.revenue_gbp) : '-';
        const chVpv = metric(ch, 'vpv') != null ? formatRevenue(metric(ch, 'vpv')) : '\u2014';
        html += '<div class="grid-row traffic-type-parent attribution-channel-parent" role="row" data-channel="' + escapeHtml(chKey) + '">' +
          '<div class="grid-cell" role="cell">' +
            '<button type="button" class="traffic-type-toggle attribution-channel-toggle" data-channel="' + escapeHtml(chKey) + '" aria-expanded="' + (chOpen ? 'true' : 'false') + '">' +
              '<span>' + escapeHtml(chLabel) + '</span>' +
            '</button>' +
          '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(chSessions || '-') + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(chOrders || '-') + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(chCr || '-') + '</div>' +
          '<div class="grid-cell" role="cell">' + chVpv + '</div>' +
          '<div class="grid-cell" role="cell">' + (chRev || '-') + '</div>' +
        '</div>';

        const sources = ch && Array.isArray(ch.sources) ? ch.sources.slice() : [];
        sources.sort(function(a, b) {
          let primary = 0;
          if (by === 'attribution') primary = cmpNullableText(sourceLabel(a), sourceLabel(b), dir);
          else primary = cmpNullableNumber(metric(a, by), metric(b, by), dir);
          return primary ||
            cmpNullableNumber(metric(a, 'rev'), metric(b, 'rev'), 'desc') ||
            cmpNullableNumber(metric(a, 'orders'), metric(b, 'orders'), 'desc') ||
            cmpNullableNumber(metric(a, 'sessions'), metric(b, 'sessions'), 'desc') ||
            cmpNullableText(sourceLabel(a), sourceLabel(b), 'asc');
        });

        sources.forEach(function(src) {
          const sKey = sourceKey(src);
          const srcOpen = chOpen && isSourceOpen(chKey, sKey);
          const sLabel = sourceLabel(src);
          const sIcon = iconSpecHtml(src && src.icon_spec != null ? src.icon_spec : null, sLabel);
          const sCr = (src && typeof src.conversion_pct === 'number') ? pct(src.conversion_pct) : '-';
          const sOrders = (src && typeof src.orders === 'number') ? formatSessions(src.orders) : '-';
          const sSessions = (src && typeof src.sessions === 'number') ? formatSessions(src.sessions) : '-';
          const sRev = (src && typeof src.revenue_gbp === 'number') ? formatRevenueTableHtml(src.revenue_gbp) : '-';
          const sVpv = metric(src, 'vpv') != null ? formatRevenue(metric(src, 'vpv')) : '\u2014';
          html += '<div class="grid-row traffic-type-child attribution-source-row' + (chOpen ? '' : ' is-hidden') + '" role="row" data-parent="' + escapeHtml(chKey) + '" data-channel="' + escapeHtml(chKey) + '" data-source="' + escapeHtml(sKey) + '">' +
            '<div class="grid-cell" role="cell">' +
              '<button type="button" class="traffic-type-toggle attribution-source-toggle" data-channel="' + escapeHtml(chKey) + '" data-source="' + escapeHtml(sKey) + '" aria-expanded="' + (srcOpen ? 'true' : 'false') + '">' +
                (sIcon || '') +
                '<span>' + escapeHtml(sLabel) + '</span>' +
              '</button>' +
            '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sSessions || '-') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sOrders || '-') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(sCr || '-') + '</div>' +
            '<div class="grid-cell" role="cell">' + sVpv + '</div>' +
            '<div class="grid-cell" role="cell">' + (sRev || '-') + '</div>' +
          '</div>';

          const variants = src && Array.isArray(src.variants) ? src.variants.slice() : [];
          variants.sort(function(a, b) {
            let primary = 0;
            if (by === 'attribution') primary = cmpNullableText(variantLabel(a), variantLabel(b), dir);
            else primary = cmpNullableNumber(metric(a, by), metric(b, by), dir);
            return primary ||
              cmpNullableNumber(metric(a, 'rev'), metric(b, 'rev'), 'desc') ||
              cmpNullableNumber(metric(a, 'orders'), metric(b, 'orders'), 'desc') ||
              cmpNullableNumber(metric(a, 'sessions'), metric(b, 'sessions'), 'desc') ||
              cmpNullableText(variantLabel(a), variantLabel(b), 'asc');
          });

          const parentKey = chKey + '|' + sKey;
          variants.forEach(function(v) {
            const vKey = variantKey(v);
            const vLabel = variantLabel(v);
            const vIcon = iconSpecHtml(v && v.icon_spec != null ? v.icon_spec : null, vLabel);
            const vCr = (v && typeof v.conversion_pct === 'number') ? pct(v.conversion_pct) : '-';
            const vOrders = (v && typeof v.orders === 'number') ? formatSessions(v.orders) : '-';
            const vSessions = (v && typeof v.sessions === 'number') ? formatSessions(v.sessions) : '-';
            const vRev = (v && typeof v.revenue_gbp === 'number') ? formatRevenueTableHtml(v.revenue_gbp) : '-';
            const vVpv = metric(v, 'vpv') != null ? formatRevenue(metric(v, 'vpv')) : '\u2014';
            const ownerKind = v && v.owner_kind != null ? String(v.owner_kind).trim().toLowerCase() : '';
            const ownerBadge = ownerKind && ownerKind !== 'house'
              ? (' <span class="text-muted small">(' + escapeHtml(ownerKind) + ')</span>')
              : '';
            html += '<div class="grid-row traffic-type-child attribution-variant-row' + (srcOpen ? '' : ' is-hidden') + '" role="row" data-parent="' + escapeHtml(parentKey) + '" data-channel="' + escapeHtml(chKey) + '" data-source="' + escapeHtml(sKey) + '">' +
              '<div class="grid-cell" role="cell"><span style="display:inline-flex;align-items:center;gap:8px;padding-left:18px">' + (vIcon || '') + '<span>' + escapeHtml(vLabel) + '</span>' + ownerBadge + '</span></div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(vSessions || '-') + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(vOrders || '-') + '</div>' +
              '<div class="grid-cell" role="cell">' + escapeHtml(vCr || '-') + '</div>' +
              '<div class="grid-cell" role="cell">' + vVpv + '</div>' +
              '<div class="grid-cell" role="cell">' + (vRev || '-') + '</div>' +
            '</div>';
          });
        });
      });

      body.innerHTML = html;
      updateSortHeadersInContainer(document.getElementById('attribution-table'), by, dir);
    }

    function renderAttributionChart(data) {
      const el = document.getElementById('attribution-chart');
      if (!el) return;
      const chartKey = 'attribution-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        try {
          if (el.__kexoChartInstance) {
            try { el.__kexoChartInstance.destroy(); } catch (_) {}
            el.__kexoChartInstance = null;
          }
        } catch (_) {}
        el.innerHTML = '';
        return;
      }

      const rows = data && data.attribution && Array.isArray(data.attribution.rows) ? data.attribution.rows.slice() : [];
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#6b7280;font-size:.875rem">No attribution data</div>';
        return;
      }

      function channelLabel(r) {
        if (!r) return 'Unknown';
        if (r.label != null && String(r.label).trim() !== '') return String(r.label);
        if (r.channel_key != null && String(r.channel_key).trim() !== '') return String(r.channel_key);
        return 'Unknown';
      }
      function metricValue(r, metricKey) {
        if (!r) return 0;
        if (metricKey === 'orders') return Math.max(0, Number(r.orders) || 0);
        if (metricKey === 'revenue') return Math.max(0, Number(r.revenue_gbp) || 0);
        return Math.max(0, Number(r.sessions) || 0);
      }

      const rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      const showEndLabels = rawMode === 'multi-line-labels';
      const mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      const metricKey = chartPieMetricFromUiConfig(chartKey, 'sessions');
      const palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e']);
      const isCurrency = metricKey === 'revenue';
      const seriesName = metricKey === 'orders' ? 'Orders' : (metricKey === 'revenue' ? 'Revenue' : 'Sessions');

      const items = rows
        .map(function (r) { return { label: channelLabel(r), value: metricValue(r, metricKey) }; })
        .filter(function (it) { return it && it.value > 0; })
        .sort(function (a, b) { return (b.value - a.value) || String(a.label).localeCompare(String(b.label)); })
        .slice(0, 10);

      if (!items.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#6b7280;font-size:.875rem">No attribution data</div>';
        return;
      }

      const categories = items.map(function (it) { return it.label; });
      const values = items.map(function (it) { return it.value; });
      const series = (String(mode).toLowerCase() === 'pie')
        ? categories.map(function (name, idx) { return { name: name, data: [values[idx]] }; })
        : [{ name: seriesName, data: values }];

      try {
        window.kexoRenderApexChart({
          chartKey: chartKey,
          containerEl: el,
          categories: categories,
          series: series,
          mode: mode,
          colors: palette,
          height: 320,
          currency: isCurrency,
          showEndLabels: showEndLabels,
          chartStyle: chartStyleFromUiConfig(chartKey),
          advancedApexOverride: chartAdvancedOverrideFromUiConfig(chartKey, mode),
        });
      } catch (_) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    function renderAttribution(data) {
      attributionCache = data || attributionCache || null;
      try { renderAttributionTables(attributionCache || {}); } catch (_) {}
      try { renderAttributionChart(attributionCache || {}); } catch (_) {}
    }

    function fetchAttributionData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/attribution/report?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('Attribution HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          lastAttributionFetchedAt = Date.now();
          renderAttribution(data && typeof data === 'object' ? data : null);
          return data;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'attributionFetch', page: PAGE }); } catch (_) {}
          renderAttribution(attributionCache || null);
          return null;
        });
    }

    function refreshAttribution(options = {}) {
      const force = !!options.force;
      if (attributionRefreshInFlight) return attributionRefreshInFlight;
      const build = startReportBuild({ key: 'attribution', title: 'Preparing attribution report' });
      build.step('Loading attribution performance');
      attributionRefreshInFlight = fetchAttributionData({ force })
        .finally(function() {
          attributionRefreshInFlight = null;
          build.finish();
        });
      return attributionRefreshInFlight;
    }

    function renderDevicesTables(data) {
      const body = document.getElementById('devices-body');
      if (!body) return;

      const by = (tableSortState.devices.by || 'rev').toString().trim().toLowerCase();
      const dir = (tableSortState.devices.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

      const rows = data && data.devices && Array.isArray(data.devices.rows) ? data.devices.rows.slice() : [];
      const filtered = rows.filter(function(r) {
        const s = r && typeof r.sessions === 'number' ? r.sessions : 0;
        const o = r && typeof r.orders === 'number' ? r.orders : 0;
        return s >= 1 || o >= 1;
      });

      function deviceLabel(r) {
        if (!r) return 'unknown';
        const k = r.device_type != null ? String(r.device_type).trim().toLowerCase() : '';
        return k || 'unknown';
      }

      function metric(r, key) {
        if (!r) return null;
        if (key === 'cr') return (typeof r.conversion_pct === 'number') ? r.conversion_pct : null;
        if (key === 'orders') return (typeof r.orders === 'number') ? r.orders : null;
        if (key === 'sessions') return (typeof r.sessions === 'number') ? r.sessions : null;
        if (key === 'rev') return (typeof r.revenue_gbp === 'number') ? r.revenue_gbp : null;
        if (key === 'vpv') {
          const rev = (typeof r.revenue_gbp === 'number') ? r.revenue_gbp : null;
          const sess = (typeof r.sessions === 'number') ? r.sessions : null;
          return (sess != null && sess > 0 && rev != null) ? (rev / sess) : null;
        }
        return null;
      }

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
        if (p === 'ios') return '<i class="fa-light fa-apple" data-icon-key="type-platform-ios"></i>';
        if (p === 'mac') return '<i class="fa-light fa-apple" data-icon-key="type-platform-mac"></i>';
        if (p === 'android') return '<i class="fa-light fa-android" data-icon-key="type-platform-android"></i>';
        if (p === 'windows') return '<i class="fa-light fa-windows" data-icon-key="type-platform-windows"></i>';
        if (p === 'chromeos') return '<i class="fa-brands fa-chrome" data-icon-key="type-platform-chromeos"></i>';
        if (p === 'linux') return '<i class="fa-light fa-linux" data-icon-key="type-platform-linux"></i>';
        return '<i class="fa-light fa-circle-question" data-icon-key="type-platform-unknown"></i>';
      }

      filtered.sort(function(a, b) {
        let primary = 0;
        if (by === 'device') primary = cmpNullableText(deviceLabel(a), deviceLabel(b), dir);
        else primary = cmpNullableNumber(metric(a, by), metric(b, by), dir);
        return primary ||
          cmpNullableNumber(metric(a, 'rev'), metric(b, 'rev'), 'desc') ||
          cmpNullableNumber(metric(a, 'orders'), metric(b, 'orders'), 'desc') ||
          cmpNullableNumber(metric(a, 'sessions'), metric(b, 'sessions'), 'desc') ||
          cmpNullableText(deviceLabel(a), deviceLabel(b), 'asc');
      });

      if (!filtered.length) {
        body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No device data yet.</div></div>';
        updateCardPagination('devices', 1, 1);
        updateSortHeadersInContainer(document.getElementById('devices-table'), by, dir);
        return;
      }

      const pageSize = getTableRowsPerPage('devices-table', 'live');
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      devicesPage = clampPage(devicesPage, totalPages);
      updateCardPagination('devices', devicesPage, totalPages);
      const pageStart = (devicesPage - 1) * pageSize;
      const pageGroups = filtered.slice(pageStart, pageStart + pageSize);

      function isDeviceOpen(key) {
        if (devicesExpanded === null) return true;
        if (!devicesExpanded || typeof devicesExpanded !== 'object') return true;
        if (!Object.prototype.hasOwnProperty.call(devicesExpanded, key)) return true;
        return !!devicesExpanded[key];
      }

      let html = '';
      pageGroups.forEach(function(g) {
        const dKey = deviceLabel(g);
        const open = isDeviceOpen(dKey);
        const label = dKey;
        const cr = (g && typeof g.conversion_pct === 'number') ? pct(g.conversion_pct) : '-';
        const orders = (g && typeof g.orders === 'number') ? formatSessions(g.orders) : '-';
        const sessions = (g && typeof g.sessions === 'number') ? formatSessions(g.sessions) : '-';
        const rev = (g && typeof g.revenue_gbp === 'number') ? formatRevenueTableHtml(g.revenue_gbp) : '-';
        const vpv = metric(g, 'vpv') != null ? formatRevenue(metric(g, 'vpv')) : '\u2014';
        html += '<div class="grid-row traffic-type-parent devices-parent" role="row" data-device-type="' + escapeHtml(dKey) + '">' +
          '<div class="grid-cell" role="cell">' +
            '<button type="button" class="traffic-type-toggle devices-toggle" data-device-type="' + escapeHtml(dKey) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
              '<span class="tt-device-icon" aria-hidden="true">' + trafficTypeDeviceIcon(dKey) + '</span>' +
              '<span>' + escapeHtml(label) + '</span>' +
            '</button>' +
          '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(sessions || '-') + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(orders || '-') + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(cr || '-') + '</div>' +
          '<div class="grid-cell" role="cell">' + vpv + '</div>' +
          '<div class="grid-cell" role="cell">' + (rev || '-') + '</div>' +
        '</div>';

        const kids = g && Array.isArray(g.platforms) ? g.platforms.slice() : [];
        kids.sort(function(a, b) {
          let primary = 0;
          if (by === 'device') primary = cmpNullableText((a && a.platform) ? String(a.platform) : '', (b && b.platform) ? String(b.platform) : '', dir);
          else primary = cmpNullableNumber(metric(a, by), metric(b, by), dir);
          return primary ||
            cmpNullableNumber(metric(a, 'rev'), metric(b, 'rev'), 'desc') ||
            cmpNullableNumber(metric(a, 'orders'), metric(b, 'orders'), 'desc') ||
            cmpNullableNumber(metric(a, 'sessions'), metric(b, 'sessions'), 'desc') ||
            cmpNullableText((a && a.platform) ? String(a.platform) : '', (b && b.platform) ? String(b.platform) : '', 'asc');
        });

        kids.forEach(function(c) {
          const platform = c && c.platform != null ? String(c.platform).trim().toLowerCase() : 'other';
          const clabel = platform || 'other';
          const ccr = (c && typeof c.conversion_pct === 'number') ? pct(c.conversion_pct) : '-';
          const corders = (c && typeof c.orders === 'number') ? formatSessions(c.orders) : '-';
          const csessions = (c && typeof c.sessions === 'number') ? formatSessions(c.sessions) : '-';
          const crev = (c && typeof c.revenue_gbp === 'number') ? formatRevenueTableHtml(c.revenue_gbp) : '-';
          const cvpv = metric(c, 'vpv') != null ? formatRevenue(metric(c, 'vpv')) : '\u2014';
          html += '<div class="grid-row traffic-type-child devices-child' + (open ? '' : ' is-hidden') + '" role="row" data-parent="' + escapeHtml(dKey) + '">' +
            '<div class="grid-cell" role="cell"><span style="display:inline-flex;align-items:center;gap:8px">' + trafficTypePlatformIcon(platform) + '<span>' + escapeHtml(clabel) + '</span></span></div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(csessions || '-') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(corders || '-') + '</div>' +
            '<div class="grid-cell" role="cell">' + escapeHtml(ccr || '-') + '</div>' +
            '<div class="grid-cell" role="cell">' + cvpv + '</div>' +
            '<div class="grid-cell" role="cell">' + (crev || '-') + '</div>' +
          '</div>';
        });
      });

      body.innerHTML = html;
      updateSortHeadersInContainer(document.getElementById('devices-table'), by, dir);
    }

    function renderDevicesChart(data) {
      const el = document.getElementById('devices-chart');
      if (!el) return;
      const chartKey = 'devices-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        try {
          if (el.__kexoChartInstance) {
            try { el.__kexoChartInstance.destroy(); } catch (_) {}
            el.__kexoChartInstance = null;
          }
        } catch (_) {}
        el.innerHTML = '';
        return;
      }

      const rows = data && data.devices && Array.isArray(data.devices.rows) ? data.devices.rows.slice() : [];
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#6b7280;font-size:.875rem">No device data</div>';
        return;
      }

      function deviceLabel(r) {
        const k = r && r.device_type != null ? String(r.device_type).trim().toLowerCase() : '';
        return k || 'unknown';
      }
      function titleCase(s) {
        const raw = String(s || '').trim();
        if (!raw) return 'Unknown';
        return raw.slice(0, 1).toUpperCase() + raw.slice(1);
      }
      function metricValue(r, metricKey) {
        if (!r) return 0;
        if (metricKey === 'orders') return Math.max(0, Number(r.orders) || 0);
        if (metricKey === 'revenue') return Math.max(0, Number(r.revenue_gbp) || 0);
        return Math.max(0, Number(r.sessions) || 0);
      }

      const rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      const showEndLabels = rawMode === 'multi-line-labels';
      const mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      const metricKey = chartPieMetricFromUiConfig(chartKey, 'sessions');
      const palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e']);
      const isCurrency = metricKey === 'revenue';
      const seriesName = metricKey === 'orders' ? 'Orders' : (metricKey === 'revenue' ? 'Revenue' : 'Sessions');

      const items = rows
        .map(function (r) { return { label: titleCase(deviceLabel(r)), value: metricValue(r, metricKey) }; })
        .filter(function (it) { return it && it.value > 0; })
        .sort(function (a, b) { return (b.value - a.value) || String(a.label).localeCompare(String(b.label)); })
        .slice(0, 10);

      if (!items.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#6b7280;font-size:.875rem">No device data</div>';
        return;
      }

      const categories = items.map(function (it) { return it.label; });
      const values = items.map(function (it) { return it.value; });
      const series = (String(mode).toLowerCase() === 'pie')
        ? categories.map(function (name, idx) { return { name: name, data: [values[idx]] }; })
        : [{ name: seriesName, data: values }];

      try {
        window.kexoRenderApexChart({
          chartKey: chartKey,
          containerEl: el,
          categories: categories,
          series: series,
          mode: mode,
          colors: palette,
          height: 320,
          currency: isCurrency,
          showEndLabels: showEndLabels,
          chartStyle: chartStyleFromUiConfig(chartKey),
          advancedApexOverride: chartAdvancedOverrideFromUiConfig(chartKey, mode),
        });
      } catch (_) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    function renderDevices(data) {
      devicesCache = data || devicesCache || null;
      try { renderDevicesTables(devicesCache || {}); } catch (_) {}
      try { renderDevicesChart(devicesCache || {}); } catch (_) {}
    }

    function fetchDevicesData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/devices/report?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('Devices HTTP ' + r.status);
          return r.json();
        })
        .then(function(data) {
          lastDevicesFetchedAt = Date.now();
          renderDevices(data && typeof data === 'object' ? data : null);
          return data;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'devicesFetch', page: PAGE }); } catch (_) {}
          renderDevices(devicesCache || null);
          return null;
        });
    }

    function refreshDevices(options = {}) {
      const force = !!options.force;
      if (devicesRefreshInFlight) return devicesRefreshInFlight;
      const build = startReportBuild({ key: 'devices', title: 'Preparing devices report' });
      build.step('Loading device performance');
      devicesRefreshInFlight = fetchDevicesData({ force })
        .finally(function() {
          devicesRefreshInFlight = null;
          build.finish();
        });
      return devicesRefreshInFlight;
    }

    function browserLabel(key) {
      var k = key == null ? '' : String(key).trim().toLowerCase();
      if (!k) return 'Unknown';
      var names = {
        chrome: 'Chrome',
        safari: 'Safari',
        edge: 'Edge',
        firefox: 'Firefox',
        opera: 'Opera',
        ie: 'Internet Explorer',
        samsung: 'Samsung Internet',
        other: 'Other',
        unknown: 'Unknown',
      };
      if (names[k]) return names[k];
      return k.slice(0, 1).toUpperCase() + k.slice(1);
    }

    function browserIconKey(browserKeyRaw) {
      var k = browserKeyRaw == null ? '' : String(browserKeyRaw).trim().toLowerCase();
      if (!k) return 'type-browser-unknown';
      if (k === 'chrome') return 'type-browser-chrome';
      if (k === 'safari') return 'type-browser-safari';
      if (k === 'edge') return 'type-browser-edge';
      if (k === 'firefox') return 'type-browser-firefox';
      if (k === 'opera') return 'type-browser-opera';
      if (k === 'ie' || k === 'internet explorer') return 'type-browser-ie';
      if (k === 'samsung' || k === 'samsung internet') return 'type-browser-samsung';
      if (k === 'other') return 'type-browser-other';
      if (k === 'unknown') return 'type-browser-unknown';
      return 'type-browser-other';
    }

    function browserIconHtml(browserKeyRaw) {
      var iconKey = browserIconKey(browserKeyRaw);
      // Default glyphs come from the icon registry via data-icon-key; we provide a sensible fallback class.
      var fallback = 'fa-light fa-globe';
      if (iconKey === 'type-browser-chrome') fallback = 'fa-brands fa-chrome';
      else if (iconKey === 'type-browser-safari') fallback = 'fa-brands fa-safari';
      else if (iconKey === 'type-browser-edge') fallback = 'fa-brands fa-edge';
      else if (iconKey === 'type-browser-firefox') fallback = 'fa-brands fa-firefox-browser';
      else if (iconKey === 'type-browser-opera') fallback = 'fa-brands fa-opera';
      else if (iconKey === 'type-browser-ie') fallback = 'fa-brands fa-internet-explorer';
      else if (iconKey === 'type-browser-unknown') fallback = 'fa-light fa-circle-question';
      return '<i class="' + fallback + '" data-icon-key="' + escapeHtml(iconKey) + '" aria-hidden="true"></i>';
    }

    function renderBrowsersTables(data) {
      const body = document.getElementById('browsers-body');
      if (!body) return;

      const by = (tableSortState.browsers.by || 'rev').toString().trim().toLowerCase();
      const dir = (tableSortState.browsers.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';

      const rows = data && data.browsers && Array.isArray(data.browsers.rows) ? data.browsers.rows.slice() : [];
      const filtered = rows.filter(function(r) {
        const s = r && typeof r.sessions === 'number' ? r.sessions : 0;
        const o = r && typeof r.orders === 'number' ? r.orders : 0;
        return s >= 1 || o >= 1;
      });

      function rowBrowserKey(r) {
        if (!r) return 'unknown';
        const k = r.ua_browser != null ? String(r.ua_browser).trim().toLowerCase() : '';
        return k || 'unknown';
      }

      function metric(r, key) {
        if (!r) return null;
        if (key === 'browser') return browserLabel(rowBrowserKey(r));
        if (key === 'sessions') return (typeof r.sessions === 'number') ? r.sessions : null;
        if (key === 'carts') return (typeof r.carts === 'number') ? r.carts : null;
        if (key === 'orders') return (typeof r.orders === 'number') ? r.orders : null;
        if (key === 'cr') return (typeof r.cr === 'number') ? r.cr : null;
        if (key === 'vpv') return (typeof r.vpv === 'number') ? r.vpv : null;
        if (key === 'rev') return (typeof r.revenue === 'number') ? r.revenue : null;
        if (key === 'aov') return (typeof r.aov === 'number') ? r.aov : null;
        return null;
      }

      filtered.sort(function(a, b) {
        let primary = 0;
        if (by === 'browser') primary = cmpNullableText(metric(a, 'browser'), metric(b, 'browser'), dir);
        else primary = cmpNullableNumber(metric(a, by), metric(b, by), dir);
        return primary ||
          cmpNullableNumber(metric(a, 'rev'), metric(b, 'rev'), 'desc') ||
          cmpNullableNumber(metric(a, 'orders'), metric(b, 'orders'), 'desc') ||
          cmpNullableNumber(metric(a, 'sessions'), metric(b, 'sessions'), 'desc') ||
          cmpNullableText(metric(a, 'browser'), metric(b, 'browser'), 'asc');
      });

      if (!filtered.length) {
        body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No browser data yet.</div></div>';
        updateCardPagination('browsers', 1, 1);
        updateSortHeadersInContainer(document.getElementById('browsers-table'), by, dir);
        return;
      }

      const pageSize = getTableRowsPerPage('browsers-table', 'live');
      const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
      browsersPage = clampPage(browsersPage, totalPages);
      updateCardPagination('browsers', browsersPage, totalPages);
      const pageStart = (browsersPage - 1) * pageSize;
      const pageRows = filtered.slice(pageStart, pageStart + pageSize);

      let html = '';
      pageRows.forEach(function(r) {
        const k = rowBrowserKey(r);
        const label = browserLabel(k);
        const sessions = (r && typeof r.sessions === 'number') ? formatSessions(r.sessions) : '\u2014';
        const carts = (r && typeof r.carts === 'number') ? formatSessions(r.carts) : '\u2014';
        const orders = (r && typeof r.orders === 'number') ? formatSessions(r.orders) : '\u2014';
        const cr = (r && typeof r.cr === 'number') ? pct(r.cr) : '\u2014';
        const vpv = (r && typeof r.vpv === 'number') ? formatRevenue(r.vpv) : '\u2014';
        const rev = (r && typeof r.revenue === 'number') ? formatRevenueTableHtml(r.revenue) : '\u2014';
        const aov = (r && typeof r.aov === 'number') ? formatRevenue(r.aov) : '\u2014';
        html += '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span style="display:inline-flex;align-items:center;gap:8px"><span class="tt-browser-icon" aria-hidden="true">' + browserIconHtml(k) + '</span><span>' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(sessions) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(carts) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(orders) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(cr) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(vpv) + '</div>' +
          '<div class="grid-cell" role="cell">' + (rev || '\u2014') + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(aov) + '</div>' +
        '</div>';
      });

      body.innerHTML = html;
      updateSortHeadersInContainer(document.getElementById('browsers-table'), by, dir);
      try { if (window.KexoIconTheme && typeof window.KexoIconTheme.refresh === 'function') window.KexoIconTheme.refresh(); } catch (_) {}
    }

    function renderBrowsersChart(data) {
      const el = document.getElementById('browsers-chart');
      if (!el) return;
      const chartKey = 'browsers-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        try {
          if (el.__kexoChartInstance) {
            try { el.__kexoChartInstance.destroy(); } catch (_) {}
            el.__kexoChartInstance = null;
          }
        } catch (_) {}
        el.innerHTML = '';
        return;
      }

      const rows = data && data.browsers && Array.isArray(data.browsers.rows) ? data.browsers.rows.slice() : [];
      if (!rows.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#6b7280;font-size:.875rem">No browser data</div>';
        return;
      }

      function metricValue(r, metricKey) {
        if (!r) return 0;
        if (metricKey === 'orders') return Math.max(0, Number(r.orders) || 0);
        if (metricKey === 'revenue') return Math.max(0, Number(r.revenue) || 0);
        return Math.max(0, Number(r.sessions) || 0);
      }

      const rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      const showEndLabels = rawMode === 'multi-line-labels';
      const mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      const metricKey = chartPieMetricFromUiConfig(chartKey, 'sessions');
      const palette = chartColorsFromUiConfig(chartKey, ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e']);
      const isCurrency = metricKey === 'revenue';
      const seriesName = metricKey === 'orders' ? 'Orders' : (metricKey === 'revenue' ? 'Revenue' : 'Sessions');

      const items = rows
        .map(function (r) {
          const key = r && r.ua_browser != null ? String(r.ua_browser).trim().toLowerCase() : 'unknown';
          return { label: browserLabel(key), value: metricValue(r, metricKey) };
        })
        .filter(function (it) { return it && it.value > 0; })
        .sort(function (a, b) { return (b.value - a.value) || String(a.label).localeCompare(String(b.label)); })
        .slice(0, 10);

      if (!items.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#6b7280;font-size:.875rem">No browser data</div>';
        return;
      }

      const categories = items.map(function (it) { return it.label; });
      const values = items.map(function (it) { return it.value; });
      const series = (String(mode).toLowerCase() === 'pie')
        ? categories.map(function (name, idx) { return { name: name, data: [values[idx]] }; })
        : [{ name: seriesName, data: values }];

      try {
        window.kexoRenderApexChart({
          chartKey: chartKey,
          containerEl: el,
          categories: categories,
          series: series,
          mode: mode,
          colors: palette,
          height: 320,
          currency: isCurrency,
          showEndLabels: showEndLabels,
          chartStyle: chartStyleFromUiConfig(chartKey),
          advancedApexOverride: chartAdvancedOverrideFromUiConfig(chartKey, mode),
        });
      } catch (_) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    function renderBrowsers(data) {
      browsersCache = data || browsersCache || null;
      try { renderBrowsersTables(browsersCache || {}); } catch (_) {}
      try { renderBrowsersChart(browsersCache || {}); } catch (_) {}
    }

    function setBrowsersUpdated(label) {
      const el = document.getElementById('browsers-updated');
      if (!el) return;
      el.textContent = label || 'Updated \u2014';
    }

    function fetchBrowsersData(options = {}) {
      const force = !!options.force;
      let url = API + '/api/browsers/table?range=' + encodeURIComponent(getStatsRange());
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 25000)
        .then(function(r) {
          if (!r.ok) throw new Error('Browsers HTTP ' + r.status);
          return r.json();
        })
        .then(function(payload) {
          lastBrowsersFetchedAt = Date.now();
          try { setBrowsersUpdated('Updated ' + (new Date(lastBrowsersFetchedAt)).toLocaleString('en-GB')); } catch (_) { setBrowsersUpdated('Updated'); }
          renderBrowsers(payload && typeof payload === 'object' ? { browsers: { rows: Array.isArray(payload.rows) ? payload.rows : [] }, meta: payload } : null);
          return payload;
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'browsersFetch', page: PAGE }); } catch (_) {}
          setBrowsersUpdated('Failed to load');
          renderBrowsers(browsersCache || null);
          return null;
        });
    }

    function refreshBrowsers(options = {}) {
      const force = !!options.force;
      if (browsersRefreshInFlight) return browsersRefreshInFlight;
      const build = startReportBuild({ key: 'browsers', title: 'Preparing browsers report' });
      build.step('Loading browser performance');
      browsersRefreshInFlight = fetchBrowsersData({ force })
        .finally(function() {
          browsersRefreshInFlight = null;
          build.finish();
        });
      return browsersRefreshInFlight;
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

      var rawMode = chartModeFromUiConfig(chartKey, 'map-flat') || 'map-flat';
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
      var hasNoLiveActivity = !keys.length;

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
          onRegionTooltipShow: function(event, tooltip, code2) {
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

        if (liveOnlineMapChartInstance && liveOnlineMapChartInstance.regions) {
          var regions = liveOnlineMapChartInstance.regions;
          for (var code in regionFillByIso2) {
            if (regions[code] && regions[code].element && typeof regions[code].element.setStyle === 'function') {
              try { regions[code].element.setStyle('fill', regionFillByIso2[code]); } catch (_) {}
            }
          }
        }
        hideMapTooltipOnLeave(el);

        if (hasNoLiveActivity) {
          var noActivity = document.createElement('div');
          noActivity.setAttribute('class', 'kexo-live-map-empty-caption');
          noActivity.style.cssText = 'position:absolute;left:0;right:0;bottom:12px;text-align:center;font-size:.8125rem;color:' + (muted || 'var(--tblr-secondary)') + ';pointer-events:none;';
          noActivity.textContent = 'No live activity yet';
          if (el && el.style) el.style.position = 'relative';
          try { el.appendChild(noActivity); } catch (_) {}
        }

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
            updateOpts.stroke = { show: true, curve: 'smooth', width: 3, lineCap: 'round' };
            updateOpts.fill = chartType === 'area'
              ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } }
              : { type: 'solid', opacity: 1 };
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
          try {
            var liveUpdateOverride = chartAdvancedOverrideFromUiConfig(chartKey, chartType);
            if (liveUpdateOverride && isPlainObject(liveUpdateOverride)) {
              updateOpts = deepMergeOptions(updateOpts, liveUpdateOverride);
            }
          } catch (_) {}
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
        apexOpts.stroke = { show: true, curve: 'smooth', width: 3, lineCap: 'round' };
        apexOpts.fill = chartType === 'area'
          ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } }
          : { type: 'solid', opacity: 1 };
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
      try {
        var liveOverride = chartAdvancedOverrideFromUiConfig(chartKey, chartType);
        if (liveOverride && isPlainObject(liveOverride)) {
          apexOpts = deepMergeOptions(apexOpts, liveOverride);
        }
      } catch (_) {}
      liveOnlineChart = new ApexCharts(el, apexOpts);
      liveOnlineChart.render();
    }

    function refreshLiveOnlineChart(options) {
      var chartKey = 'live-online-chart';
      var rawMode = chartModeFromUiConfig(chartKey, 'map-flat') || 'map-flat';
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
          yFormatter: function(v) { return formatRevenue(Number(v)) || '\u2014'; },
          tooltipFormatter: function(v) { return formatRevenue(Number(v)) || '\u2014'; },
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
      var overviewOpts = {
        chart: {
          type: overviewType,
          height: 220,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false },
          zoom: { enabled: false },
        },
        series: chartCfg.series,
        colors: chartCfg.colors,
        stroke: { show: true, curve: 'smooth', width: overviewType === 'bar' ? 0 : 2, lineCap: 'round' },
        fill: overviewType === 'area'
          ? { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } }
          : { type: 'solid', opacity: 1 },
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
      };
      try {
        var overviewOverride = chartAdvancedOverrideFromUiConfig(chartKey, overviewType);
        if (overviewOverride && isPlainObject(overviewOverride)) {
          overviewOpts = deepMergeOptions(overviewOpts, overviewOverride);
        }
      } catch (_) {}
      rangeOverviewChart = new ApexCharts(el, overviewOpts);
      var curOverviewChart = rangeOverviewChart;
      var overviewRenderPromise = null;
      try { overviewRenderPromise = curOverviewChart.render(); } catch (_) { overviewRenderPromise = null; }
      rangeOverviewChartKey = String(rangeKey || '');
      function applyChangePinsOverlay() {
        try {
          if (rangeOverviewChart !== curOverviewChart) return;
          if (typeof window === 'undefined' || typeof window.__kexoGetChangePinsRecent !== 'function') return;
          window.__kexoGetChangePinsRecent(120, false).then(function (pins) {
            try {
              if (rangeOverviewChart !== curOverviewChart) return;
              if (!pins || !Array.isArray(pins) || !pins.length) return;
              if (!labels || !labels.length) return;
              var idx = new Map();
              for (var i = 0; i < labels.length; i++) {
                var key = labels[i] != null ? String(labels[i]) : '';
                if (!key) continue;
                if (!idx.has(key)) idx.set(key, i);
              }
              var ann = [];
              for (var j = 0; j < pins.length; j++) {
                var p = pins[j] || {};
                var ts = p.event_ts != null ? Number(p.event_ts) : NaN;
                if (!Number.isFinite(ts)) continue;
                var cand = bucket === 'hour' ? shortTimeLabel(ts) : shortDateTimeLabel(ts);
                if (!cand) continue;
                if (!idx.has(cand)) continue;
                var text = p.title != null ? String(p.title).trim() : '';
                if (text.length > 22) text = text.slice(0, 21) + '…';
                if (!text) text = 'Pin';
                ann.push({
                  x: cand,
                  borderColor: 'rgba(15,23,42,0.35)',
                  label: {
                    text: text,
                    borderColor: 'rgba(15,23,42,0.55)',
                    style: { background: 'rgba(15,23,42,0.75)', color: '#fff', fontSize: '10px', fontWeight: 500 },
                    offsetY: -6,
                  },
                });
              }
              if (!ann.length) return;
              try { curOverviewChart.updateOptions({ annotations: { xaxis: ann } }, false, true); } catch (_) {}
            } catch (_) {}
          });
        } catch (_) {}
      }
      if (overviewRenderPromise && typeof overviewRenderPromise.then === 'function') {
        overviewRenderPromise.then(function () { try { setTimeout(applyChangePinsOverlay, 0); } catch (_) {} }).catch(function () {});
      } else {
        try { setTimeout(applyChangePinsOverlay, 0); } catch (_) {}
      }
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
    try { window.refreshLiveOnlineChart = refreshLiveOnlineChart; } catch (_) {}

    function setAbandonedCartsChartTitle(totalGbp) {
      var titleEl = document.getElementById('abandoned-carts-chart-title');
      if (!titleEl) return;
      var n = totalGbp != null ? Number(totalGbp) : NaN;
      if (!Number.isFinite(n)) {
        titleEl.textContent = '\u00A3\u2014';
        return;
      }
      titleEl.textContent = formatRevenue(n) || '\u00A3\u2014';
    }

    function renderAbandonedCartsChart(data, cacheKey) {
      var el = document.getElementById('abandoned-carts-chart');
      if (!el) return;
      var chartKey = 'abandoned-carts-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        try {
          if (el.__kexoChartInstance) {
            try { el.__kexoChartInstance.destroy(); } catch (_) {}
            el.__kexoChartInstance = null;
          }
        } catch (_) {}
        el.innerHTML = '';
        abandonedCartsChart = null;
        abandonedCartsChartKey = String(cacheKey || '');
        setAbandonedCartsChartTitle(null);
        return;
      }

      var series = data && Array.isArray(data.series) ? data.series : [];
      var bucket = (data && data.bucket === 'day') ? 'day' : 'hour';
      var categories = series.map(function(p) { return bucket === 'day' ? shortDayLabel(p && p.ts) : shortTimeLabel(p && p.ts); });
      var nums = series.map(function(p) {
        var n = p && p.abandoned != null ? Number(p.abandoned) : 0;
        return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
      });

      var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      var showEndLabels = rawMode === 'multi-line-labels';
      var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      var palette = chartColorsFromUiConfig(chartKey, ['#ef4444', '#f59e34']);
      var cartColor = palette[0] || '#ef4444';
      var checkoutColor = palette[1] || '#f59e34';
      var isCheckout = normalizeAbandonedMode(abandonedMode) === 'checkout';
      var colors = [isCheckout ? checkoutColor : cartColor];

      try {
        abandonedCartsChart = window.kexoRenderApexChart({
          chartKey: chartKey,
          containerEl: el,
          categories: categories,
          series: [{ name: abandonedModeDisplayLabel(abandonedMode), data: nums }],
          mode: mode,
          colors: colors,
          height: 280,
          showEndLabels: showEndLabels,
          chartStyle: chartStyleFromUiConfig(chartKey),
          advancedApexOverride: chartAdvancedOverrideFromUiConfig(chartKey, mode),
        });
      } catch (_) {}

      abandonedCartsChartKey = String(cacheKey || '');
      setAbandonedCartsChartTitle(data && data.totalAbandonedGbp != null ? Number(data.totalAbandonedGbp) : null);
    }

    function abandonedCartsSeriesCachePut(cacheKey, data) {
      var k = String(cacheKey || '');
      if (!k) return;
      if (data == null) return;
      abandonedCartsSeriesCache[k] = data;
      var idx = abandonedCartsSeriesCacheOrder.indexOf(k);
      if (idx >= 0) abandonedCartsSeriesCacheOrder.splice(idx, 1);
      abandonedCartsSeriesCacheOrder.push(k);
      while (abandonedCartsSeriesCacheOrder.length > ABANDONED_CARTS_SERIES_CACHE_MAX) {
        var drop = abandonedCartsSeriesCacheOrder.shift();
        if (drop) {
          try { delete abandonedCartsSeriesCache[drop]; } catch (_) { abandonedCartsSeriesCache[drop] = null; }
        }
      }
    }

    function prefetchAbandonedCartsSeries(rangeKey, mode) {
      try {
        if (PAGE !== 'abandoned-carts') return null;
        var rk = String(rangeKey || '').trim().toLowerCase();
        if (!rk) return null;
        var m = normalizeAbandonedMode(mode);
        var cacheKey = rk + '|' + m;
        if (abandonedCartsSeriesCache && abandonedCartsSeriesCache[cacheKey]) return null;
        if (abandonedCartsSeriesPrefetchInFlight && abandonedCartsSeriesPrefetchInFlight[cacheKey]) return abandonedCartsSeriesPrefetchInFlight[cacheKey];

        var url =
          API + '/api/abandoned-carts/series?range=' + encodeURIComponent(rk) +
          '&timezone=' + encodeURIComponent(tz) +
          '&mode=' + encodeURIComponent(m) +
          '&_=' + Date.now();

        abandonedCartsSeriesPrefetchInFlight[cacheKey] = fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 20000)
          .then(function(r) { return (r && r.ok) ? r.json() : null; })
          .then(function(data) {
            if (data != null) abandonedCartsSeriesCachePut(cacheKey, data);
            return data;
          })
          .catch(function() { return null; })
          .finally(function() {
            try { delete abandonedCartsSeriesPrefetchInFlight[cacheKey]; } catch (_) { abandonedCartsSeriesPrefetchInFlight[cacheKey] = null; }
          });

        return abandonedCartsSeriesPrefetchInFlight[cacheKey];
      } catch (_) {
        return null;
      }
    }

    function refreshAbandonedCartsChart(options) {
      var el = document.getElementById('abandoned-carts-chart');
      if (!el) return Promise.resolve(null);
      options = options || {};
      var force = !!options.force;
      var rangeKey = normalizeRangeKeyForApi(dateRange);
      var modeKey = String(normalizeAbandonedMode(abandonedMode));
      var cacheKey = rangeKey + '|' + modeKey;
      if (!force && abandonedCartsChartKey === cacheKey && abandonedCartsChart) return Promise.resolve(null);
      if (!force && abandonedCartsSeriesCache && abandonedCartsSeriesCache[cacheKey]) {
        try { renderAbandonedCartsChart(abandonedCartsSeriesCache[cacheKey], cacheKey); } catch (_) {}
        try { prefetchAbandonedCartsSeries(rangeKey, modeKey === 'checkout' ? 'cart' : 'checkout'); } catch (_) {}
        return Promise.resolve(abandonedCartsSeriesCache[cacheKey]);
      }
      if (abandonedCartsChartInFlight && abandonedCartsChartInFlightKey === cacheKey) return abandonedCartsChartInFlight;

      var url =
        API + '/api/abandoned-carts/series?range=' + encodeURIComponent(rangeKey) +
        '&timezone=' + encodeURIComponent(tz) +
        '&mode=' + encodeURIComponent(modeKey) +
        '&_=' + Date.now();

      var reqSeq = ++abandonedCartsChartReqSeq;
      abandonedCartsChartInFlightKey = cacheKey;
      var p = fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 20000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          if (reqSeq !== abandonedCartsChartReqSeq) return null;
          renderAbandonedCartsChart(data || null, cacheKey);
          if (data != null) abandonedCartsSeriesCachePut(cacheKey, data);
          try { prefetchAbandonedCartsSeries(rangeKey, modeKey === 'checkout' ? 'cart' : 'checkout'); } catch (_) {}
          return data;
        })
        .catch(function() { return null; })
        .finally(function() {
          if (abandonedCartsChartInFlight === p) {
            abandonedCartsChartInFlightKey = '';
            abandonedCartsChartInFlight = null;
          }
        });

      abandonedCartsChartInFlight = p;
      return p;
    }

    function clearGridTableBodyMessageState(tbody) {
      if (!tbody || !tbody.closest) return;
      var table = tbody.closest('.grid-table');
      if (!table) return;
      table.classList.remove('kexo-grid-empty-state-active');
      try {
        var block = table.querySelector('.kexo-grid-empty-state');
        if (block && block.parentNode) block.parentNode.removeChild(block);
      } catch (_) {}
    }

    function setGridTableBodyMessage(tbody, message, options) {
      if (!tbody) return;
      var msg = String(message == null ? '' : message).trim() || '\u2014';
      var opts = options && typeof options === 'object' ? options : {};
      var useBlock = !!opts.useBlock;
      clearGridTableBodyMessageState(tbody);
      if (useBlock && tbody.closest) {
        var table = tbody.closest('.grid-table');
        if (table) {
          tbody.innerHTML = '';
          table.classList.add('kexo-grid-empty-state-active');
          var emptyBlock = document.createElement('div');
          emptyBlock.className = 'kexo-grid-empty-state';
          emptyBlock.textContent = msg;
          table.appendChild(emptyBlock);
          return;
        }
      }
      tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(msg) + '</div></div>';
    }

    function renderAbandonedCartsTopCountries(payload) {
      var tbody = document.getElementById('abandoned-carts-countries-body');
      if (!tbody) return;
      var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) {
        setGridTableBodyMessage(tbody, 'No data', { useBlock: true });
        return;
      }
      clearGridTableBodyMessageState(tbody);
      tbody.innerHTML = rows.slice(0, 5).map(function(r) {
        var code = (r && r.country != null ? String(r.country) : 'XX').toUpperCase().slice(0, 2);
        var label = countryLabel(code);
        var abandoned = r && r.abandoned != null ? Math.max(0, Math.trunc(Number(r.abandoned) || 0)) : 0;
        var checkout = r && r.checkout_sessions != null ? Math.max(0, Math.trunc(Number(r.checkout_sessions) || 0)) : 0;
        var pctVal = (r && r.abandoned_pct != null) ? pct(Number(r.abandoned_pct)) : '\u2014';
        var valueGbp = (r && r.abandoned_value_gbp != null) ? Number(r.abandoned_value_gbp) : null;
        var value = (valueGbp != null && Number.isFinite(valueGbp)) ? formatRevenueTableHtml(valueGbp) : '\u2014';
        var flag = flagImg(code, label);
        var labelHtml = '<span class="country-label">' + escapeHtml(label) + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatSessions(abandoned)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatSessions(checkout)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(pctVal) + '</div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
        '</div>';
      }).join('');
    }

    function renderAbandonedCartsTopCountryProducts(payload) {
      var tbody = document.getElementById('abandoned-carts-country-products-body');
      if (!tbody) return;
      var rows = payload && Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) {
        setGridTableBodyMessage(tbody, 'No data', { useBlock: true });
        return;
      }
      clearGridTableBodyMessageState(tbody);
      tbody.innerHTML = rows.slice(0, 5).map(function(r) {
        var iso = (r && r.country != null ? String(r.country) : 'XX').toUpperCase().slice(0, 2);
        var label = countryLabel(iso);
        var productTitle = (r && r.product_title != null) ? String(r.product_title).trim() : '\u2014';
        var productHandle = (r && r.product_handle != null) ? String(r.product_handle).trim().toLowerCase() : '';
        var mainBase = getMainBaseUrl();
        var productUrl = (mainBase && productHandle) ? (mainBase + '/products/' + encodeURIComponent(productHandle)) : '#';

        var abandoned = r && r.abandoned != null ? Math.max(0, Math.trunc(Number(r.abandoned) || 0)) : 0;
        var checkout = r && r.checkout_sessions != null ? Math.max(0, Math.trunc(Number(r.checkout_sessions) || 0)) : 0;
        var pctVal = (r && r.abandoned_pct != null) ? pct(Number(r.abandoned_pct)) : '\u2014';
        var valueGbp = (r && r.abandoned_value_gbp != null) ? Number(r.abandoned_value_gbp) : null;
        var value = (valueGbp != null && Number.isFinite(valueGbp)) ? formatRevenueTableHtml(valueGbp) : '\u2014';
        var flag = flagImg(iso, label);

        var canOpen = !!productHandle;
        var titleLink = canOpen
          ? '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
              (productHandle ? (' data-product-handle="' + escapeHtml(productHandle) + '"') : '') +
              (productTitle ? (' data-product-title="' + escapeHtml(productTitle) + '"') : '') +
            '>' + escapeHtml(productTitle) + '</a>'
          : escapeHtml(productTitle);

        var labelHtml =
          '<span class="country-product-stack">' +
            '<span class="country-label">' + escapeHtml(label) + '</span>' +
            '<span class="country-product-label">' + titleLink + '</span>' +
          '</span>';

        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatSessions(abandoned)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatSessions(checkout)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(pctVal) + '</div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
        '</div>';
      }).join('');
    }

    function refreshAbandonedCartsTopTables(options) {
      if (PAGE !== 'abandoned-carts') return Promise.resolve(null);
      options = options || {};
      var force = !!options.force;
      var rangeKey = normalizeRangeKeyForApi(dateRange);
      var cacheKey = rangeKey + '|' + String(normalizeAbandonedMode(abandonedMode));
      if (!force && abandonedCartsTopCacheKey === cacheKey && abandonedCartsTopCountriesCache && abandonedCartsTopCountryProductsCache) {
        renderAbandonedCartsTopCountries(abandonedCartsTopCountriesCache);
        renderAbandonedCartsTopCountryProducts(abandonedCartsTopCountryProductsCache);
        return Promise.resolve(null);
      }
      if (abandonedCartsTopInFlight) return abandonedCartsTopInFlight;

      var countriesBody = document.getElementById('abandoned-carts-countries-body');
      var productsBody = document.getElementById('abandoned-carts-country-products-body');
      setGridTableBodyMessage(countriesBody, 'Loading\u2026');
      setGridTableBodyMessage(productsBody, 'Loading\u2026');

      var qs =
        'range=' + encodeURIComponent(rangeKey) +
        '&timezone=' + encodeURIComponent(tz) +
        '&mode=' + encodeURIComponent(normalizeAbandonedMode(abandonedMode)) +
        '&limit=5&_=' + Date.now();

      var urlCountries = API + '/api/abandoned-carts/top-countries?' + qs;
      var urlCountryProducts = API + '/api/abandoned-carts/top-country-products?' + qs;

      abandonedCartsTopInFlight = Promise.all([
        fetchWithTimeout(urlCountries, { credentials: 'same-origin', cache: 'no-store' }, 20000).then(function(r) { return (r && r.ok) ? r.json() : null; }).catch(function() { return null; }),
        fetchWithTimeout(urlCountryProducts, { credentials: 'same-origin', cache: 'no-store' }, 20000).then(function(r) { return (r && r.ok) ? r.json() : null; }).catch(function() { return null; }),
      ])
        .then(function(arr) {
          var a = arr && arr[0] ? arr[0] : { rows: [] };
          var b = arr && arr[1] ? arr[1] : { rows: [] };
          abandonedCartsTopCacheKey = cacheKey;
          abandonedCartsTopCountriesCache = a;
          abandonedCartsTopCountryProductsCache = b;
          renderAbandonedCartsTopCountries(a);
          renderAbandonedCartsTopCountryProducts(b);
          return { countries: a, countryProducts: b };
        })
        .finally(function() { abandonedCartsTopInFlight = null; });

      return abandonedCartsTopInFlight;
    }

    function refreshAbandonedCarts(options) {
      if (PAGE !== 'abandoned-carts') return Promise.resolve(null);
      options = options || {};
      syncAbandonedModeUi();
      return Promise.all([
        refreshAbandonedCartsChart(options),
        refreshAbandonedCartsTopTables(options),
        fetchSessions(),
      ]);
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
        if (PAGE === 'abandoned-carts') {
          url = API + '/api/abandoned-carts/sessions?range=' + encodeURIComponent(normalizeRangeKeyForApi(dateRange)) + '&limit=' + limit + '&offset=' + offset + '&timezone=' + encodeURIComponent(tz) + '&mode=' + encodeURIComponent(normalizeAbandonedMode(abandonedMode)) + '&_=' + Date.now();
        } else {
          url = API + '/api/sessions?range=' + encodeURIComponent(normalizeRangeKeyForApi(dateRange)) + '&limit=' + limit + '&offset=' + offset + '&timezone=' + encodeURIComponent(tz) + '&_=' + Date.now();
        }
      }
      var SESSIONS_FETCH_TIMEOUT_MS = 15000;
      if (_fetchAbortControllers.sessions) { try { _fetchAbortControllers.sessions.abort(); } catch (_) {} }
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      _fetchAbortControllers.sessions = ac;
      var sessionsTimeoutId = null;
      if (ac && SESSIONS_FETCH_TIMEOUT_MS > 0) {
        sessionsTimeoutId = setTimeout(function() {
          try { ac.abort(); } catch (_) {}
        }, SESSIONS_FETCH_TIMEOUT_MS);
      }
      var sessionsFetchStart = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
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
          try {
            window.__kexoPerfMetrics = window.__kexoPerfMetrics || {};
            if (err && err.name === 'AbortError') window.__kexoPerfMetrics.sessionsFetchTimeoutCount = (window.__kexoPerfMetrics.sessionsFetchTimeoutCount || 0) + 1;
          } catch (_) {}
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
          try {
            if (typeof performance !== 'undefined' && performance.now && sessionsFetchStart != null) {
              window.__kexoPerfMetrics = window.__kexoPerfMetrics || {};
              window.__kexoPerfMetrics.lastSessionsFetchMs = Math.round((performance.now() - sessionsFetchStart) * 100) / 100;
            }
          } catch (_) {}
          if (sessionsTimeoutId != null) { clearTimeout(sessionsTimeoutId); sessionsTimeoutId = null; }
          liveRefreshInFlight = null;
          if (_fetchAbortControllers.sessions === ac) _fetchAbortControllers.sessions = null;
          build.finish();
        });
      return liveRefreshInFlight;
    }

    function scheduleOnlineCountPoll(ms) {
      if (onlineCountPollTimer) {
        try { clearTimeout(onlineCountPollTimer); } catch (_) {}
        onlineCountPollTimer = null;
      }
      if (onlineCountAuthBlocked) return;
      var delay = (typeof ms === 'number' && isFinite(ms) && ms >= 0) ? ms : ONLINE_COUNT_POLL_MS;
      onlineCountPollTimer = setTimeout(function() {
        onlineCountPollTimer = null;
        try { updateKpis(); } catch (_) {}
      }, delay);
    }

    function fetchOnlineCount() {
      if (onlineCountInFlight || onlineCountAuthBlocked) return;
      onlineCountInFlight = true;
      if (_fetchAbortControllers.onlineCount) { try { _fetchAbortControllers.onlineCount.abort(); } catch (_) {} }
      var ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
      _fetchAbortControllers.onlineCount = ac;
      fetch(API + '/api/sessions?filter=active&countOnly=1&_=' + Date.now(), { credentials: 'same-origin', cache: 'no-store', signal: ac ? ac.signal : undefined })
        .then(function(r) {
          if (!r || !r.ok) {
            if (r && r.status === 401) onlineCountAuthBlocked = true;
            return null;
          }
          return r.json();
        })
        .then(function(data) {
          if (data != null && typeof data.count === 'number') {
            lastOnlineCount = data.count;
            onlineCountLastFetchedAt = Date.now();
          }
        })
        .catch(function(err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'onlineCountFetch', page: PAGE }); } catch (_) {}
        })
        .then(function() {
          onlineCountInFlight = false;
          if (_fetchAbortControllers.onlineCount === ac) _fetchAbortControllers.onlineCount = null;
          if (onlineCountAuthBlocked) {
            if (onlineCountPollTimer) {
              try { clearTimeout(onlineCountPollTimer); } catch (_) {}
              onlineCountPollTimer = null;
            }
          } else {
            var nextMs = onlineCountLastFetchedAt ? ONLINE_COUNT_POLL_MS : ONLINE_COUNT_RETRY_MS;
            scheduleOnlineCountPoll(nextMs);
          }
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
      if (onlineCountAuthBlocked) {
        // Session/auth is no longer valid (401). Stop auto-polling to avoid API spam.
        showCount(lastOnlineCount != null ? lastOnlineCount : 0);
        return;
      }
      var onlineCountIsFresh = onlineCountLastFetchedAt > 0 && (Date.now() - onlineCountLastFetchedAt) < ONLINE_COUNT_POLL_MS;
      if (lastOnlineCount != null) {
        showCount(lastOnlineCount);
        if (!onlineCountIsFresh) fetchOnlineCount();
      } else {
        showSpinner();
        fetchOnlineCount();
      }
    }

    function cfSection(title, value) {
      const v = value != null && String(value).trim() !== '' ? String(value).trim() : null;
      return '<div class="cf-row"><strong>' + escapeHtml(title) + ':</strong> ' + (v ? escapeHtml(v) : '\u2014') + '</div>';
    }

    function formatBrowserLabel(session) {
      const s = session || {};
      const key = s.ua_browser != null ? String(s.ua_browser).trim().toLowerCase() : '';
      const vRaw = s.ua_browser_version != null ? String(s.ua_browser_version).trim() : '';
      const version = vRaw && vRaw.length > 16 ? vRaw.slice(0, 16) : vRaw;
      if (!key) return null;
      const names = {
        chrome: 'Chrome',
        safari: 'Safari',
        edge: 'Edge',
        firefox: 'Firefox',
        opera: 'Opera',
        ie: 'Internet Explorer',
        samsung: 'Samsung Internet',
        other: 'Other',
      };
      const name = names[key] || (key ? (key.charAt(0).toUpperCase() + key.slice(1)) : '');
      if (!name) return null;
      return version ? (name + ' ' + version) : name;
    }

    function buildSidePanelCf(session) {
      const s = session || {};
      const blocks = [
        ['Country & Device', cfSection('Country', s.cf_country || s.country_code) + cfSection('Device', s.device) + cfSection('Browser', formatBrowserLabel(s))],
        ['Referrer / Entry', cfSection('Referrer', s.referrer) + cfSection('Entry URL', s.entry_url)],
        ['City', cfSection('City', s.cf_city || s.city || null)]
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

    function sideLookupHref(q) {
      var qq = q != null ? String(q).trim() : '';
      if (!qq) return '/tools/click-order-lookup';
      try {
        var shop = getShopParam() || shopForSalesFallback || '';
        var p = new URLSearchParams();
        if (shop) p.set('shop', shop);
        p.set('q', qq);
        return '/tools/click-order-lookup?' + p.toString();
      } catch (_) {
        return '/tools/click-order-lookup?q=' + encodeURIComponent(qq);
      }
    }

    function buildSideLookupIdsHtml(resolved, sessionId, options) {
      var r = resolved && typeof resolved === 'object' ? resolved : {};
      var sid = sessionId != null ? String(sessionId) : '';
      var opts = options && typeof options === 'object' ? options : {};
      var loading = !!opts.loading;
      var out = '';

      function addRow(label, value) {
        var v = value != null ? String(value).trim() : '';
        if (!v) return;
        out += '' +
          '<div class="side-panel-detail-row side-panel-lookup-id-row">' +
            '<span class="side-panel-label">' + escapeHtml(label) + '</span>' +
            '<span class="side-panel-value"><code>' + escapeHtml(v) + '</code>' +
              '<button type="button" class="btn btn-sm btn-outline-secondary ms-2 side-panel-copy-btn" data-side-copy="' + escapeHtml(v) + '">Copy</button>' +
            '</span>' +
          '</div>';
      }

      var clickId = sid || (r.session_id != null ? String(r.session_id) : '');
      var openQ = clickId || (r.order_id != null ? String(r.order_id) : '') || (r.checkout_token != null ? String(r.checkout_token) : '') || '';
      var href = sideLookupHref(openQ);
      out = '' +
        '<div class="side-panel-detail-row side-panel-lookup-open-row">' +
          '<span class="side-panel-label">Lookup</span>' +
          '<span class="side-panel-value">' +
            '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener">Open in Lookup</a>' +
            (loading ? '<span class="muted ms-2">Loading IDs\u2026</span>' : '') +
          '</span>' +
        '</div>';

      addRow('Click ID', clickId);
      addRow('Shopify order ID', r.order_id);
      addRow('Checkout token', r.checkout_token);
      addRow('Kexo order key', r.purchase_key);
      addRow('Visitor', r.visitor_id);
      return out;
    }

    function copyTextToClipboard(text) {
      var value = String(text == null ? '' : text);
      if (!value) return Promise.resolve(false);
      try {
        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          return navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return false; });
        }
      } catch (_) {}
      try {
        var ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve(!!ok);
      } catch (_) {
        return Promise.resolve(false);
      }
    }

    // Shared Click & Order Lookup renderer (Tools page + side drawer).
    var clickOrderLookupUiReady = false;
    function ensureClickOrderLookupUi() {
      if (clickOrderLookupUiReady) return;
      clickOrderLookupUiReady = true;

      function esc(v) { return escapeHtml(v == null ? '' : String(v)); }
      function safeJsonPre(obj) { try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); } }

      function copyLinkHtml(value) {
        var v = value != null ? String(value).trim() : '';
        if (!v) return '';
        return ' <a href="#" class="kexo-copy-link" data-kexo-copy="' + esc(v) + '">Copy</a>';
      }

      function ensureCopyLinksBound() {
        try {
          var root = document && document.documentElement ? document.documentElement : null;
          if (root && root.getAttribute('data-kexo-copy-links') === '1') return;
          if (root) root.setAttribute('data-kexo-copy-links', '1');
          document.addEventListener('click', function (e) {
            var target = e && e.target ? e.target : null;
            var a = target && target.closest ? target.closest('a.kexo-copy-link[data-kexo-copy]') : null;
            if (!a) return;
            try { e.preventDefault(); } catch (_) {}
            var txt = a.getAttribute('data-kexo-copy') || '';
            if (!txt) return;
            copyTextToClipboard(txt).then(function (ok) {
              var prev = a.getAttribute('data-kexo-copy-prev') || (a.textContent || 'Copy');
              try { a.setAttribute('data-kexo-copy-prev', prev); } catch (_) {}
              try { a.textContent = ok ? 'Copied' : 'Copy'; } catch (_) {}
              setTimeout(function () {
                try { a.textContent = prev; } catch (_) {}
              }, 900);
            });
          }, true);
        } catch (_) {}
      }

      function pickFraudEvalFromBundle(bundle) {
        var b = bundle && typeof bundle === 'object' ? bundle : null;
        if (!b || b.ok !== true || b.available !== true) return null;
        var pref = (b.session && b.session.evaluation) ? b.session
          : (b.purchase && b.purchase.evaluation) ? b.purchase
          : (b.order && b.order.evaluation) ? b.order
          : null;
        if (!pref || !pref.evaluation) return null;
        var ev = pref.evaluation || {};
        var an = pref.analysis || {};
        var score = ev.score != null ? Number(ev.score) : 0;
        if (!Number.isFinite(score)) score = 0;
        score = Math.max(0, Math.min(100, Math.trunc(score)));
        var risk = an && an.risk_level ? String(an.risk_level).trim() : '';
        if (!risk) risk = score >= (b.threshold != null ? Number(b.threshold) : 70) ? 'Medium' : 'Low';
        return {
          score: score,
          risk_level: risk || 'Unknown',
          triggered: !!ev.triggered,
          threshold: (b.threshold != null && Number.isFinite(Number(b.threshold))) ? Number(b.threshold) : null,
          summary: an && an.summary ? String(an.summary) : '',
          key_reasons: an && Array.isArray(an.key_reasons) ? an.key_reasons : [],
          flags: Array.isArray(ev.flags) ? ev.flags : [],
          evidence: (ev.evidence && typeof ev.evidence === 'object') ? ev.evidence : {},
        };
      }

      function gaugeToneFromRisk(riskLevel) {
        var r = String(riskLevel || '').trim().toLowerCase();
        if (r === 'high') return 'high';
        if (r === 'medium') return 'medium';
        if (r === 'low') return 'low';
        return 'unknown';
      }

      function renderFraudGaugeHtml(info, options) {
        var i = info && typeof info === 'object' ? info : null;
        var score = i && i.score != null ? Math.max(0, Math.min(100, Math.trunc(Number(i.score) || 0))) : 0;
        var triggered = !!(i && i.triggered === true);
        var label = (options && options.label) ? String(options.label) : 'Fraud Meter';
        var pct = String(score) + '%';
        var safety = Math.max(0, Math.min(100, 100 - score)); // 0 fraud => 100% safe
        var riskLabel = (safety <= 49) ? 'High' : (safety <= 75) ? 'Medium' : 'Low';
        var barClass = (safety <= 49) ? 'bg-danger' : (safety <= 75) ? 'bg-warning' : 'bg-success';
        var iconTone = (safety <= 49) ? 'high' : (safety <= 75) ? 'medium' : 'low';
        var statusIcon = (riskLabel === 'Low' && !triggered)
          ? (
              '<i class="fa-light fa-circle-check kexo-fraud-meter-status-icon is-ok"' +
                ' data-icon-key="table-icon-compliance-check" aria-hidden="true"></i>'
            )
          : (
              '<i class="fa-light fa-triangle-exclamation kexo-fraud-meter-status-icon is-warn tone-' + esc(iconTone) + '"' +
                ' data-icon-key="table-icon-compliance-warning" aria-hidden="true"></i>'
            );
        var aria = riskLabel + ' (' + pct + ' fraud score, ' + String(safety) + '% safe)';
        return '' +
          '<div class="kexo-kpi-chip kexo-fraud-meter-chip" data-kexo-fraud-meter="1" aria-label="' + esc(aria) + '">' +
            '<div class="subheader kexo-kpi-chip-label">' + esc(label) + '</div>' +
            '<div class="d-flex align-items-baseline">' +
              '<div class="h3 mb-0 me-2 kexo-kpi-chip-value">' + statusIcon + '<span class="kexo-fraud-meter-status-label">' + esc(riskLabel) + '</span></div>' +
              '<div class="me-auto">' +
                '<span class="kexo-kpi-chip-delta d-inline-flex align-items-center lh-1 is-flat">' + esc(pct) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="progress progress-sm kexo-kpi-chip-progress" role="progressbar" aria-valuenow="' + esc(String(safety)) + '" aria-valuemin="0" aria-valuemax="100">' +
              '<div class="progress-bar ' + esc(barClass) + '" style="width:' + esc(String(safety)) + '%"></div>' +
            '</div>' +
          '</div>';
      }

      function animateFraudGauges(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var nodes = Array.from(scope.querySelectorAll('[data-kexo-gauge="1"]'));
        nodes.forEach(function (wrap) {
          try {
            if (!wrap || wrap.getAttribute('data-kexo-gauge-animated') === '1') return;
            wrap.setAttribute('data-kexo-gauge-animated', '1');
            var score = Number(wrap.getAttribute('data-score') || '0');
            if (!Number.isFinite(score)) score = 0;
            score = Math.max(0, Math.min(100, Math.trunc(score)));
            var path = wrap.querySelector('.kexo-fraud-gauge-progress');
            if (!path || !path.getTotalLength) return;
            var len = path.getTotalLength();
            path.style.strokeDasharray = String(len);
            path.style.strokeDashoffset = String(len);
            path.getBoundingClientRect(); // force layout
            var target = len * (1 - (score / 100));
            path.style.transition = 'stroke-dashoffset 900ms ease-out';
            requestAnimationFrame(function () { path.style.strokeDashoffset = String(target); });
          } catch (_) {}
        });
      }

      function renderIdsHtml(resolved, mode) {
        var r = resolved && typeof resolved === 'object' ? resolved : {};
        var rows = [
          { k: 'Kexo Click ID (session)', v: r.session_id, copy: true },
          { k: 'Shopify order ID', v: r.order_id, copy: true },
          { k: 'Checkout token', v: r.checkout_token, copy: true },
          { k: 'Kexo order key', v: r.purchase_key, copy: true },
          { k: 'Visitor ID', v: r.visitor_id, copy: false },
        ].filter(function (x) { return x && x.v != null && String(x.v).trim() !== ''; });
        if (!rows.length) return '<div class="text-muted">\u2014</div>';

        if (mode === 'drawer') {
          return rows.map(function (row) {
            var v = String(row.v);
            return '' +
              '<div class="side-panel-detail-row">' +
                '<span class="side-panel-label">' + esc(row.k) + '</span>' +
                '<span class="side-panel-value"><code>' + esc(v) + '</code>' + (row.copy ? copyLinkHtml(v) : '') + '</span>' +
              '</div>';
          }).join('');
        }

        var body = rows.map(function (row) {
          var v = String(row.v);
          return '<tr><th style="width:180px">' + esc(row.k) + '</th><td><code>' + esc(v) + '</code>' + (row.copy ? copyLinkHtml(v) : '') + '</td></tr>';
        }).join('');
        return '<div class="table-responsive"><table class="table table-sm table-vcenter mb-0"><tbody>' + body + '</tbody></table></div>';
      }

      function renderActivityHtml(events, mode) {
        var list = Array.isArray(events) ? events : [];
        if (!list.length) return '<div class="text-muted">No activity.</div>';
        var filtered = list.filter(function (e) { return e && e.type !== 'heartbeat'; }).slice().reverse(); // newest-first
        var items = filtered.slice(0, 30).map(function (e) {
          var path = (e.path || '').trim();
          if (!path && e.product_handle) path = '/products/' + (e.product_handle || '');
          if (path && !path.startsWith('/')) path = '/' + path;
          var pathLabel = path || (e.product_handle || '');
          var text = (formatTs(e.ts) || '\u2014') + ' ' + esc(e.type) + ' ' + esc(pathLabel) + (e.qty_delta != null ? (' \u2014 ' + esc(e.qty_delta)) : '');
          return '<li><span>' + text + '</span></li>';
        }).join('');
        return '<ul class="side-panel-events kexo-lookup-events">' + items + '</ul>';
      }

      function renderFraudHtml(fraudBundle, mode) {
        var b = fraudBundle && typeof fraudBundle === 'object' ? fraudBundle : null;
        if (!b) return '<div class="text-muted">Fraud scoring unavailable.</div>';
        if (b.ok !== true || b.available !== true) {
          if (b.available === false) return '<div class="text-muted">Fraud system unavailable.</div>';
          return '<div class="text-muted">Fraud data unavailable.</div>';
        }

        var picked = pickFraudEvalFromBundle(b);
        if (!picked) return '<div class="text-muted">No fraud evaluation yet.</div>';

        var gauge = renderFraudGaugeHtml(picked, { label: 'Fraud Meter' });
        var reasons = Array.isArray(picked.key_reasons) ? picked.key_reasons : [];
        var flags = Array.isArray(picked.flags) ? picked.flags : [];
        var reasonsHtml = reasons.length
          ? ('<ul class="kexo-fraud-reasons">' + reasons.slice(0, 6).map(function (r) { return '<li>' + esc(String(r)) + '</li>'; }).join('') + '</ul>')
          : '';
        var flagsHtml = flags.length
          ? ('<div class="kexo-fraud-flags">' + flags.slice(0, 10).map(function (f) { return '<span class="badge bg-azure-lt me-1 mb-1">' + esc(String(f)) + '</span>'; }).join('') + '</div>')
          : '<div class="text-muted">No flags recorded.</div>';
        var evidenceJson = safeJsonPre(picked.evidence || {});
        var evidenceDetails = '' +
          '<details class="kexo-fraud-evidence-details">' +
            '<summary class="text-muted">Show evidence snapshot</summary>' +
            '<pre class="mt-2 mb-0 kexo-fraud-evidence-pre" style="white-space:pre-wrap">' + esc(evidenceJson || '{}') + '</pre>' +
          '</details>';

        if (mode === 'drawer') {
          return '' +
            gauge +
            '<div class="side-panel-detail-row"><span class="side-panel-label">Summary</span><span class="side-panel-value">' + esc(picked.summary || '\u2014') + '</span></div>' +
            (reasonsHtml ? ('<div class="kexo-fraud-reasons-wrap">' + reasonsHtml + '</div>') : '') +
            '<div class="mt-2">' + flagsHtml + '</div>' +
            '<div class="mt-2">' + evidenceDetails + '</div>';
        }

        return '' +
          gauge +
          '<div class="mt-2">' +
            '<div class="text-muted small">Summary</div>' +
            '<div>' + esc(picked.summary || '\u2014') + '</div>' +
            (reasonsHtml ? ('<div class="mt-2">' + reasonsHtml + '</div>') : '') +
            '<div class="mt-2">' + flagsHtml + '</div>' +
            '<div class="mt-2">' + evidenceDetails + '</div>' +
          '</div>';
      }

      function renderLookupHtml(payload, options) {
        var mode = options && options.mode ? String(options.mode) : 'page';
        var ok = !!(payload && payload.ok);
        if (!ok) {
          var err = payload && payload.error ? String(payload.error) : 'Lookup failed.';
          return (mode === 'drawer')
            ? ('<div class="side-panel-detail-row"><span class="side-panel-value muted">' + esc(err) + '</span></div>')
            : ('<div class="alert alert-danger mb-0">' + esc(err) + '</div>');
        }

        var resolved = payload.resolved && typeof payload.resolved === 'object' ? payload.resolved : {};
        var events = Array.isArray(payload.events) ? payload.events : [];
        var session = payload.session && typeof payload.session === 'object' ? payload.session : null;
        var purchases = Array.isArray(payload.purchases) ? payload.purchases : [];
        var attribution = payload.attribution && typeof payload.attribution === 'object' ? payload.attribution : null;
        var fraud = payload.fraud && typeof payload.fraud === 'object' ? payload.fraud : null;

        function section(title, inner) {
          return '' +
            '<div class="card mt-3">' +
              '<div class="card-header"><h3 class="card-title">' + esc(title) + '</h3></div>' +
              '<div class="card-body">' + (inner || '') + '</div>' +
            '</div>';
        }

        if (mode === 'drawer') {
          // Provide a direct link to the full tool page.
          var q = (resolved && resolved.session_id) ? String(resolved.session_id) : (payload && payload.q ? String(payload.q) : '');
          var href = sideLookupHref(q);
          var openLink = '' +
            '<div class="side-panel-detail-row">' +
              '<span class="side-panel-label">Lookup</span>' +
              '<span class="side-panel-value"><a href="' + esc(href) + '" target="_blank" rel="noopener">Open in Lookup</a></span>' +
            '</div>';

          var idsHtml = renderIdsHtml(resolved, 'drawer');
          var sessionMini = '';
          try {
            if (session && typeof session === 'object') {
              var started = formatTs(session.started_at) || '\u2014';
              var seen = formatTs(session.last_seen) || '\u2014';
              var cartQty = (session.cart_qty != null) ? String(session.cart_qty) : '0';
              sessionMini = '' +
                '<div class="side-panel-detail-row"><span class="side-panel-label">Started</span><span class="side-panel-value">' + esc(started) + '</span></div>' +
                '<div class="side-panel-detail-row"><span class="side-panel-label">Seen</span><span class="side-panel-value">' + esc(seen) + '</span></div>' +
                '<div class="side-panel-detail-row"><span class="side-panel-label">Cart qty</span><span class="side-panel-value">' + esc(cartQty) + '</span></div>';
              if (session.has_purchased) {
                var sale = formatMoney(session.order_total, session.order_currency) || '\u2014';
                sessionMini += '<div class="side-panel-detail-row"><span class="side-panel-label">Sale</span><span class="side-panel-value">' + esc(sale) + (session.purchased_at ? (' <span class="text-muted">(' + esc(formatTs(session.purchased_at) || '') + ')</span>') : '') + '</span></div>';
              }
            }
          } catch (_) { sessionMini = ''; }
          var fraudHtml = renderFraudHtml(fraud, 'drawer');
          var attribDetails = attribution
            ? (
                '<details class="kexo-lookup-attribution-details">' +
                  '<summary class="text-muted">Show attribution</summary>' +
                  '<pre class="mt-2 mb-0" style="white-space:pre-wrap">' + esc(safeJsonPre(attribution)) + '</pre>' +
                '</details>'
              )
            : '<div class="text-muted">No attribution row.</div>';

          return '' +
            '<div class="kexo-lookup-drawer-root">' +
              '<div class="kexo-lookup-drawer-block">' + openLink + idsHtml + sessionMini + '</div>' +
              '<div class="kexo-lookup-drawer-block">' + fraudHtml + '</div>' +
              '<div class="kexo-lookup-drawer-block">' + attribDetails + '</div>' +
            '</div>';
        }

        var html = '';
        html += section('Resolved IDs', renderIdsHtml(resolved, 'page'));
        html += section('Activity', renderActivityHtml(events, 'page'));
        if (session) {
          var utm = [session.utm_source, session.utm_medium, session.utm_campaign, session.utm_content].filter(Boolean).join(' / ');
          var attrib = [session.attribution_channel, session.attribution_source, session.attribution_variant].filter(Boolean).join(' / ');
          if (session.attribution_confidence) attrib = attrib ? (attrib + ' (' + session.attribution_confidence + ')') : String(session.attribution_confidence);
          var sRows = [
            { k: 'Started', v: formatTs(session.started_at) || '\u2014' },
            { k: 'Last seen', v: formatTs(session.last_seen) || '\u2014' },
            { k: 'Country', v: session.country_code || '\u2014' },
            { k: 'Device', v: session.device || '\u2014' },
            { k: 'UA device/platform', v: ((session.ua_device_type || '') + ' / ' + (session.ua_platform || '') + (session.ua_model ? (' / ' + session.ua_model) : '')).trim() || '\u2014' },
            { k: 'Attribution', v: attrib || '\u2014' },
            { k: 'Entry URL', v: session.entry_url || '\u2014' },
            { k: 'Referrer', v: session.referrer || '\u2014' },
            { k: 'UTM', v: utm || '\u2014' },
          ];
          var body = sRows.map(function (r) {
            return '<tr><th style="width:180px">' + esc(r.k) + '</th><td><code>' + esc(r.v) + '</code></td></tr>';
          }).join('');
          html += section('Session', '<div class="table-responsive"><table class="table table-sm table-vcenter mb-0"><tbody>' + body + '</tbody></table></div>');
        }
        if (purchases && purchases.length) {
          var pHtml = purchases.slice(0, 5).map(function (p) {
            if (!p || typeof p !== 'object') return '';
            var rows = [
              { k: 'Purchase key', v: p.purchase_key || '\u2014' },
              { k: 'Purchased at', v: formatTs(p.purchased_at) || '\u2014' },
              { k: 'Order ID', v: p.order_id || '\u2014' },
              { k: 'Checkout token', v: p.checkout_token || '\u2014' },
              { k: 'Total', v: (p.order_total != null ? String(p.order_total) : '\u2014') + (p.order_currency ? (' ' + p.order_currency) : '') },
            ];
            var body = rows.map(function (r) {
              return '<tr><th style="width:180px">' + esc(r.k) + '</th><td><code>' + esc(r.v) + '</code></td></tr>';
            }).join('');
            return '<div class="mb-3"><div class="table-responsive"><table class="table table-sm table-vcenter mb-0"><tbody>' + body + '</tbody></table></div></div>';
          }).join('');
          html += section('Purchases', pHtml);
        }
        html += section('Fraud', renderFraudHtml(fraud, 'page'));
        if (attribution) {
          html += section('Attribution', '<details><summary class="text-muted">Show attribution payload</summary><pre class="mt-2 mb-0" style="white-space:pre-wrap">' + esc(safeJsonPre(attribution)) + '</pre></details>');
        }
        return html;
      }

      function renderInto(el, payload, options) {
        if (!el) return;
        ensureCopyLinksBound();
        el.innerHTML = renderLookupHtml(payload, options || {}) || '';
        try { animateFraudGauges(el); } catch (_) {}
      }

      try {
        window.KexoClickOrderLookupUI = {
          renderInto: renderInto,
          buildHtml: renderLookupHtml,
          animateGauges: animateFraudGauges,
        };
      } catch (_) {}

      ensureCopyLinksBound();
    }
    try { ensureClickOrderLookupUi(); } catch (_) {}

    function openSidePanel(sessionId) {
      const panel = document.getElementById('side-panel');
      if (!panel) return;
      try { selectedSessionId = sessionId; } catch (_) {}
      const backdrop = ensureSidePanelBackdrop();
      panel.classList.remove('is-hidden');
      if (backdrop) backdrop.classList.remove('is-hidden');
      document.body.classList.add('side-panel-open');
      document.getElementById('side-events').innerHTML = '<li class="muted">Loading\u2026</li>';
      document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Loading\u2026</span></div>';
      const sideSourceEl = document.getElementById('side-source');
      if (sideSourceEl) sideSourceEl.innerHTML = '';
      const rowIconsEl = document.getElementById('side-row-icons');
      if (rowIconsEl) rowIconsEl.innerHTML = '';
      document.getElementById('side-cf').innerHTML = '';

      function ensureSidePanelSummarySection() {
        try {
          var existing = document.getElementById('side-summary');
          if (existing) return existing;
          var header = panel.querySelector('.side-panel-header');
          if (!header || !header.parentNode) return null;
          var wrap = document.createElement('section');
          wrap.className = 'side-panel-section side-panel-summary';
          wrap.innerHTML =
            '<div class="side-panel-summary-grid" id="side-summary"></div>';
          header.parentNode.insertBefore(wrap, header.nextSibling);
          return wrap.querySelector('#side-summary');
        } catch (_) {
          return null;
        }
      }

      function minimizeSidePanelSections() {
        try {
          panel.querySelectorAll('.side-panel-section:not(.side-panel-summary)').forEach(function (sec) {
            sec.classList.add('is-minimized');
            var title = sec.querySelector('.side-panel-section-title');
            if (title) title.setAttribute('aria-expanded', 'false');
          });
        } catch (_) {}
      }

      function wireSidePanelSectionToggles() {
        try {
          if (panel.getAttribute('data-side-toggles-wired') === '1') return;
          panel.setAttribute('data-side-toggles-wired', '1');
          panel.addEventListener('click', function (e) {
            var t = e && e.target ? e.target : null;
            var title = t && t.closest ? t.closest('.side-panel-section-title') : null;
            if (!title) return;
            var sec = title.closest('.side-panel-section');
            if (!sec || sec.classList.contains('side-panel-summary')) return;
            e.preventDefault();
            sec.classList.toggle('is-minimized');
            title.setAttribute('aria-expanded', sec.classList.contains('is-minimized') ? 'false' : 'true');
          });
        } catch (_) {}
      }

      wireSidePanelSectionToggles();
      minimizeSidePanelSections();

      var summaryEl = ensureSidePanelSummarySection();
      if (summaryEl) summaryEl.innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Loading…</span></div>';
      (function fetchLookupBundle() {
        var shop = '';
        try { shop = getShopParam() || shopForSalesFallback || ''; } catch (_) { shop = ''; }
        var url = API + '/api/tools/click-order-lookup?q=' + encodeURIComponent(String(sessionId || ''));
        if (shop) url += '&shop=' + encodeURIComponent(shop);
        url += '&_=' + Date.now();
        fetch(url, { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) { return r && r.ok ? r.json() : null; })
          .then(function (payload) {
            if (selectedSessionId !== sessionId) return;
            if (!payload || payload.ok !== true) {
              document.getElementById('side-events').innerHTML = '<li class="muted">Unavailable.</li>';
              document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Unavailable.</span></div>';
              return;
            }

            var session = payload.session && typeof payload.session === 'object' ? payload.session : {};
            var events = Array.isArray(payload.events) ? payload.events : [];

            try {
              if (rowIconsEl) {
                var cc = (session && (session.country_code || session.cf_country)) ? String(session.country_code || session.cf_country) : 'XX';
                var ccUp = cc ? cc.trim().toUpperCase() : 'XX';
                var flag = flagImg(ccUp, ccUp);

                var channelLabel = '';
                try {
                  var variantKey = session && (session.attribution_variant ?? session.attributionVariant);
                  var channelKey = session && (session.attribution_channel ?? session.attributionChannel);
                  var sourceKey = session && (session.attribution_source ?? session.attributionSource);

                  function titleizeAttrib(v) {
                    var s = (v || '').trim().toLowerCase();
                    if (!s) return '';
                    if (s === 'google_ads') return 'Google Ads';
                    if (s === 'google_organic') return 'Google';
                    if (s === 'bing_ads') return 'Bing Ads';
                    if (s === 'bing_organic') return 'Bing';
                    if (s === 'meta_ads') return 'Meta Ads';
                    if (s === 'meta_organic') return 'Meta';
                    if (s === 'paid_search') return 'Paid search';
                    if (s === 'organic_search') return 'Organic search';
                    if (s === 'paid_social') return 'Paid social';
                    if (s === 'organic_social') return 'Organic social';
                    if (s === 'email') return 'Email';
                    if (s === 'sms') return 'SMS';
                    if (s === 'direct') return 'Direct';
                    if (s === 'affiliate') return 'Affiliate';
                    if (s === 'other') return 'Other';
                    return s.replace(/_/g, ' ').replace(/\b\w/g, function(m) { return m.toUpperCase(); });
                  }

                  if (variantKey) {
                    var head = String(variantKey).trim().toLowerCase().split(':')[0] || '';
                    channelLabel = titleizeAttrib(head);
                  }
                  if (!channelLabel && channelKey) channelLabel = titleizeAttrib(String(channelKey));
                  if (!channelLabel && sourceKey) channelLabel = titleizeAttrib(String(sourceKey));
                } catch (_) { channelLabel = ''; }

                var deviceLabel = '';
                try {
                  var info = deviceInfoForSession(session);
                  function titleize(v) {
                    var s = (v || '').trim().toLowerCase();
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
                  var parts2 = [];
                  if (info.platform && info.platform !== 'unknown') parts2.push(titleize(info.platform));
                  if (info.model) parts2.push(titleize(info.model));
                  if (info.deviceType && info.deviceType !== 'unknown') parts2.push(titleize(info.deviceType));
                  deviceLabel = parts2.length ? parts2.join(' - ') : '';
                } catch (_) { deviceLabel = ''; }

                // Previously we showed "Other - iOS - iPhone - Mobile" under the header.
                // That summary now lives in the dedicated Session block.
                rowIconsEl.innerHTML = '';
              }
            } catch (_) {}

            // Summary block (always open)
            try {
              var sumEl = document.getElementById('side-summary');
              if (sumEl) {
                var cc = (session && (session.country_code || session.cf_country)) ? String(session.country_code || session.cf_country) : 'XX';
                var ccUp = cc ? cc.trim().toUpperCase() : 'XX';
                var countryFlag = flagImg(ccUp, ccUp);
                var srcText = '';
                try { srcText = sourceDetailForPanel(session) || ''; } catch (_) { srcText = ''; }
                var info = null;
                try { info = deviceInfoForSession(session); } catch (_) { info = null; }
                var firstSeen = '';
                var lastSeen = '';
                try { firstSeen = arrivedAgo(session && session.started_at); } catch (_) { firstSeen = ''; }
                try { lastSeen = arrivedAgo(session && session.last_seen); } catch (_) { lastSeen = ''; }
                var visits = 1;
                try {
                  var rc = session && session.returning_count != null ? Number(session.returning_count) : 0;
                  visits = (Number.isFinite(rc) ? rc : 0) + 1;
                } catch (_) { visits = 1; }
                var deviceLine = '';
                try {
                  function tcase(v) {
                    var s = (v || '').trim().toLowerCase();
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
                  var parts = [];
                  if (info && info.platform && info.platform !== 'unknown') parts.push(tcase(info.platform));
                  if (info && info.model) parts.push(tcase(info.model));
                  if (info && info.deviceType && info.deviceType !== 'unknown') parts.push(tcase(info.deviceType));
                  deviceLine = parts.length ? parts.join(' - ') : '—';
                } catch (_) { deviceLine = '—'; }

                var srcIcon = '';
                try { if (typeof sourceCell === 'function') srcIcon = sourceCell(session) || ''; } catch (_) { srcIcon = ''; }
                sumEl.innerHTML =
                  '<div class="side-panel-detail-row"><span class="side-panel-label">Country</span><span class="side-panel-value">' + countryFlag + '</span></div>' +
                  '<div class="side-panel-detail-row"><span class="side-panel-label">Source</span><span class="side-panel-value">' + (srcIcon || '<span class="muted">—</span>') + '</span></div>' +
                  '<div class="side-panel-detail-row"><span class="side-panel-label">Device</span><span class="side-panel-value">' + escapeHtml(deviceLine || '—') + '</span></div>' +
                  '<div class="side-panel-detail-row"><span class="side-panel-label">First seen</span><span class="side-panel-value">' + escapeHtml(firstSeen || '—') + '</span></div>' +
                  '<div class="side-panel-detail-row"><span class="side-panel-label">Last seen</span><span class="side-panel-value">' + escapeHtml(lastSeen || '—') + '</span></div>' +
                  '<div class="side-panel-detail-row"><span class="side-panel-label">Total visits</span><span class="side-panel-value">' + escapeHtml(String(visits)) + '</span></div>';
              }
            } catch (_) {}

            // Activity (newest-first), with og thumbs (same UX as legacy drawer).
            try {
              var mainBase = getMainBaseUrl();
              var eventList = events.filter(function (e) { return e && e.type !== 'heartbeat'; }).slice().reverse();
              var eventsHtml = eventList.map(function (e) {
                var path = (e.path || '').trim();
                if (!path && e.product_handle) path = '/products/' + (e.product_handle || '');
                if (path && !path.startsWith('/')) path = '/' + path;
                var pathLabel = path || (e.product_handle || '');
                var fullUrl = mainBase && path ? mainBase + path : '';
                var thumb = fullUrl ? '<img class="landing-thumb" src="' + (API || '') + '/api/og-thumb?url=' + encodeURIComponent(fullUrl) + '&width=100' + '" alt="" onerror="this.classList.add(\'is-hidden\')">' : '';
                var text = formatTs(e.ts) + ' ' + escapeHtml(e.type) + ' ' + escapeHtml(pathLabel) + (e.qty_delta != null ? ' \u0394' + e.qty_delta : '');
                return '<li>' + thumb + '<span>' + text + '</span></li>';
              }).join('');
              document.getElementById('side-events').innerHTML = eventsHtml || '<li class="muted">No events</li>';
            } catch (_) {
              document.getElementById('side-events').innerHTML = '<li class="muted">No events</li>';
            }

            // Details (single source of truth): render lookup bundle in drawer mode.
            try {
              var metaEl = document.getElementById('side-meta');
              if (metaEl && window.KexoClickOrderLookupUI && typeof window.KexoClickOrderLookupUI.renderInto === 'function') {
                window.KexoClickOrderLookupUI.renderInto(metaEl, payload, { mode: 'drawer' });
              } else if (metaEl) {
                metaEl.innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Lookup UI unavailable.</span></div>';
              }
            } catch (_) {}

            try {
              if (sideSourceEl) {
                var srcText = sourceDetailForPanel(session);
                var entryUrl = session && session.entry_url != null ? String(session.entry_url).trim() : '';
                var fullUrl = '';
                try { fullUrl = buildFullEntryUrlForCopy(session) || ''; } catch (_) { fullUrl = ''; }
                var copyUrl = fullUrl || entryUrl;
                var html = '<div class="side-panel-source-text">' + escapeHtml(String(srcText || '\u2014')).replace(/\n/g, '<br>') + '</div>';
                if (copyUrl) {
                  html += '<div class="side-panel-source-actions"><a href="#" class="kexo-copy-link" data-kexo-copy="' + escapeHtml(copyUrl) + '">Copy URL</a></div>';
                }
                sideSourceEl.innerHTML = html;
              }
            } catch (_) {}
            try { document.getElementById('side-cf').innerHTML = buildSidePanelCf(session); } catch (_) {}
          })
          .catch(function () {
            document.getElementById('side-events').innerHTML = '<li class="muted">Failed to load.</li>';
            document.getElementById('side-meta').innerHTML = '<div class="side-panel-detail-row"><span class="side-panel-value muted">Failed to load.</span></div>';
          });
      })();
    }

    const sideCloseBtn = document.getElementById('side-close');
    if (sideCloseBtn) sideCloseBtn.addEventListener('click', closeSidePanel);
    document.addEventListener('keydown', function (e) {
      if (!e || e.key !== 'Escape') return;
      var panel = document.getElementById('side-panel');
      if (panel && !panel.classList.contains('is-hidden')) closeSidePanel();
    });

    // Session table pagination (live/sales/date) ??? delegated
    (function initSessionTablePagination() {
      var wrap = document.getElementById('table-pagination');
