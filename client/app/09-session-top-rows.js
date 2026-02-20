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

    // Card-table pagination ??? event delegation on containers
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
      bindDelegate('attribution', function(pg) { attributionPage = pg; renderAttributionTables(attributionCache || {}); });
      bindDelegate('devices', function(pg) { devicesPage = pg; renderDevicesTables(devicesCache || {}); });
      bindDelegate('browsers', function(pg) { browsersPage = pg; renderBrowsersTables(browsersCache || {}); });
      bindDelegate('dash-top-products', function(pg) { dashTopProductsPage = pg; rerenderDashboardFromCache(); });
      bindDelegate('dash-top-countries', function(pg) { dashTopCountriesPage = pg; rerenderDashboardFromCache(); });
      bindDelegate('dash-trending', function(pg) { dashTrendingPage = pg; rerenderDashboardFromCache(); });
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
      try {
        var rangeSel = document.getElementById('diagnostics-overview-range');
        if (rangeSel && rangeSel.value) {
          var rk = normalizeRangeKeyForApi(String(rangeSel.value || '').trim().toLowerCase());
          if (rk) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'range=' + encodeURIComponent(rk);
        }
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

    function edgeBlocksButtonHtml(count, rangeKey) {
      var label = '\u2014';
      try {
        if (count != null && typeof fmtSessions === 'function') label = fmtSessions(count);
        else if (count != null) label = String(count);
      } catch (_) { label = count != null ? String(count) : '\u2014'; }
      var rk = (rangeKey && String(rangeKey).trim().toLowerCase() === '7d') ? '7d' : '24h';
      return (
        '<button type="button" class="btn btn-link p-0 kexo-edge-blocks-open-btn" data-edge-blocks-range="' +
        escapeHtml(rk) +
        '" disabled aria-disabled="true" title="Admin only">' +
        escapeHtml(label) +
        '</button>'
      );
    }

    function reconcileSalesTruth(options = {}) {
      const btn = document.getElementById('config-reconcile-btn');
      if (btn) {
        btn.classList.add('spinning');
        btn.disabled = true;
      }
      setDiagnosticsActionMsg('Reconciling Shopify truth (7d)\u2026', true);
      const p = fetch(getReconcileSalesUrl({ force: true }), {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(function(r) { return r.json(); })
        .then(function(payload) {
          try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
          try { refreshAttribution({ force: true }); } catch (_) {}
          try { refreshDevices({ force: true }); } catch (_) {}
          try { refreshBrowsers({ force: true }); } catch (_) {}
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
            '<div>Loading diagnostics\u2026</div>' +
          '</div>' +
          '<div id="settings-diagnostics-loading-step" class="text-secondary small mt-2">\u2014</div>';
        diagnosticsStepEl = configStatusEl.querySelector('#settings-diagnostics-loading-step');
        if (diagnosticsStepEl) diagnosticsStepEl.textContent = 'Connecting to diagnostics services';
      }
      if (compareOpen && compareStatusEl) {
        compareStatusEl.innerHTML = '<div class="kpi-compare-loading"><div class="report-build-wrap"><div class="spinner-border text-primary" role="status"></div><div class="report-build-title">building KPI comparison</div><div class="report-build-step">\u2026</div></div></div>';
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
          const KEXO_LOGO_URL = '/assets/logos/new/kexo.webp';

          const shopifySessionsToday = (traffic && typeof traffic.shopifySessionsToday === 'number') ? traffic.shopifySessionsToday : null;
          const shopifyConversionRateToday = (traffic && typeof traffic.shopifyConversionRateToday === 'number') ? traffic.shopifyConversionRateToday : null;
          const shopifyConversionRateNote = (traffic && typeof traffic.shopifyConversionRateTodayNote === 'string') ? traffic.shopifyConversionRateTodayNote : '';
          const kexoSessionsToday = (traffic && traffic.today && typeof traffic.today.humanSessions === 'number') ? traffic.today.humanSessions :
            (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number') ? traffic.today.sessionsReachedApp : null;
          const botsBlockedToday = (traffic && traffic.today && typeof traffic.today.botsBlockedAtEdge === 'number') ? traffic.today.botsBlockedAtEdge : null;
          const botsBlockedUpdatedAt = (traffic && traffic.today && typeof traffic.today.botsBlockedAtEdgeUpdatedAt === 'number') ? traffic.today.botsBlockedAtEdgeUpdatedAt : null;

          const overview = (c && c.overview && typeof c.overview === 'object') ? c.overview : null;
          const overviewRangeKey = (overview && typeof overview.rangeKey === 'string')
            ? String(overview.rangeKey).trim().toLowerCase()
            : 'today';
          function overviewRangeLabel(key) {
            const k = key ? String(key).trim().toLowerCase() : '';
            if (k === 'yesterday') return 'yesterday';
            if (k === '7d') return 'last 7 days';
            if (k === '14d') return 'last 14 days';
            if (k === '30d') return 'last 30 days';
            return 'today';
          }
          const overviewLabel = overviewRangeLabel(overviewRangeKey);
          const overviewTruthOrders = (overview && typeof overview.truthOrders === 'number') ? overview.truthOrders : truthOrders;
          const overviewTruthRevenue = (overview && typeof overview.truthRevenueGbp === 'number') ? overview.truthRevenueGbp : truthRevenue;
          const overviewShopifySessions = (overview && typeof overview.shopifySessions === 'number') ? overview.shopifySessions : shopifySessionsToday;
          const overviewKexoSessions = (overview && typeof overview.kexoSessionsHuman === 'number') ? overview.kexoSessionsHuman : kexoSessionsToday;
          const overviewBotsBlocked = (overview && typeof overview.botsBlockedAtEdge === 'number') ? overview.botsBlockedAtEdge : botsBlockedToday;

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

          const overviewShopifyCr = (overview && typeof overview.shopifyCr === 'number') ? overview.shopifyCr : shopifyCr;
          const overviewKexoCr = (overview && typeof overview.kexoCr === 'number') ? overview.kexoCr : kexoCr;
          const overviewShopifyCrSource = (overview && typeof overview.shopifyCrSource === 'string') ? String(overview.shopifyCrSource) : shopifyCrSource;
          const overviewShopifySessionsNote = (overview && typeof overview.shopifySessionsNote === 'string') ? String(overview.shopifySessionsNote) : '';

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

            const preferredOrder = ['Home', 'Overview', 'Countries', 'Products', 'Acquisition', 'Diagnostics', 'Other'];
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
            if (metaBits.length) out += '<div class="dm-def-meta">' + escapeHtml(metaBits.join(' ?? ')) + '</div>';
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
                out +=       '<div class="dm-def-details-sub">' + escapeHtml(summaryBits.join(' ?? ')) + '</div>';
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
                out += line2('Respects reporting', code2(respectsBits.join(' ?? ') + (nowBits.length ? (' ?? now ' + nowBits.join(', ')) : '')));

                const sources = (d && Array.isArray(d.sources)) ? d.sources : [];
                if (sources.length) {
                  out += sectionTitle2('Sources');
                  out += '<ul class="dm-def-list">';
                  for (const s of sources) {
                    const kind = (s && s.kind) ? String(s.kind) : 'source';
                    const st = (s && Array.isArray(s.tables)) ? s.tables : [];
                    const note2 = (s && s.note) ? String(s.note) : '';
                    let line = '<strong>' + escapeHtml(kind) + '</strong>';
                    if (st.length) line += ' ?? ' + escapeHtml(st.join(', '));
                    if (note2) line += ' \u2014 ' + escapeHtml(note2);
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
                    if (cv) line += ' ?? ' + escapeHtml(cv);
                    if (cf) line += ' ?? <code class="dm-code">' + escapeHtml(cf) + '</code>';
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
                    out += '<li><strong>' + escapeHtml(mn) + '</strong>' + (mv ? (' ?? ' + escapeHtml(mv)) : '') + '</li>';
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

          // Settings ??? Diagnostics (Tabler accordion, no tabs/custom dm-* classes)
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
              ['Sessions (' + overviewLabel + ')', fmtSessions(overviewShopifySessions)],
              ['CR% (' + overviewLabel + ')', fmtPct(overviewShopifyCr)],
              ['Orders (paid, ' + overviewLabel + ')', overviewTruthOrders != null ? escapeHtml(String(overviewTruthOrders)) : '\u2014'],
              ['Revenue (paid, ' + overviewLabel + ')', fmtRevenue(overviewTruthRevenue)],
            ])
          ) + '</div>';
          overviewBody +=   '<div class="col-12 col-xl-6">' + cardSm(
            '<span class="d-flex align-items-center gap-2"><img src="' + escapeHtml(KEXO_LOGO_URL) + '" width="20" height="20" alt="" aria-hidden="true" decoding="async" /><span>Kexo</span></span>',
            kvTable([
              ['Sessions (human, ' + overviewLabel + ')', fmtSessions(overviewKexoSessions)],
              ['CR% (truth, ' + overviewLabel + ')', fmtPct(overviewKexoCr)],
              ['Bots blocked (' + overviewLabel + ')', overviewBotsBlocked != null ? edgeBlocksButtonHtml(overviewBotsBlocked, '24h') : '\u2014'],
              ['Orders (paid, ' + overviewLabel + ')', overviewTruthOrders != null ? escapeHtml(String(overviewTruthOrders)) : '\u2014'],
              ['Revenue (paid, ' + overviewLabel + ')', fmtRevenue(overviewTruthRevenue)],
            ])
          ) + '</div>';
          overviewBody += '</div>';
          if (overviewShopifyCrSource) {
            overviewBody += '<div class="text-secondary small mt-3">Shopify CR source: ' + escapeHtml(overviewShopifyCrSource) + '</div>';
          }
          if (overviewShopifySessionsNote) {
            overviewBody += '<div class="text-secondary small mt-2">' + escapeHtml(overviewShopifySessionsNote) + '</div>';
          } else if (shopifyConversionRateNote) {
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

          var acquisitionBody = '';
          acquisitionBody += '<div class="row g-3">';
          acquisitionBody +=   '<div class="col-12 col-xl-6">' + cardSm('Sessions (today)', kvTable([
            ['Reached app', (traffic && traffic.today && typeof traffic.today.sessionsReachedApp === 'number') ? escapeHtml(formatSessions(traffic.today.sessionsReachedApp)) : '\u2014'],
            ['Human sessions', (traffic && traffic.today && typeof traffic.today.humanSessions === 'number') ? escapeHtml(formatSessions(traffic.today.humanSessions)) : '\u2014'],
            ['Bot sessions tagged', (traffic && traffic.today && typeof traffic.today.botSessionsTagged === 'number') ? escapeHtml(formatSessions(traffic.today.botSessionsTagged)) : '\u2014'],
            ['Total sessions est.', (traffic && traffic.today && typeof traffic.today.totalTrafficEst === 'number') ? escapeHtml(formatSessions(traffic.today.totalTrafficEst)) : '\u2014'],
          ])) + '</div>';
          acquisitionBody +=   '<div class="col-12 col-xl-6">' + cardSm('Shopify vs ours', kvTable([
            ['Shopify sessions (today)', shopifySessionsToday != null ? escapeHtml(formatSessions(shopifySessionsToday)) : '\u2014'],
            ['Shopify CR% (today)', fmtPct(shopifyCr)],
            ['Ours CR% (truth, today)', fmtPct(kexoCr)],
          ])) + '</div>';
          acquisitionBody += '</div>';

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
            var oauthEnabled = ads && ads.googleAdsOAuthEnabled === true;
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
                (oauthEnabled ? ('<a class="btn btn-outline-primary btn-sm" href="' + escapeHtml(connectUrl) + '">' + copyIcon + ' Connect</a>') : '') +
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
            function add(name, ok) { bits.push(name + (ok ? ' \u2713' : ' \u2717')); }
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
          html += accordionItem('acquisition', 'Acquisition', acquisitionBody);
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
                diffText = (d != null) ? ('?? Sessions ' + fmtSignedCount(d)) : '';
              } else if (compareKey === 'aov') {
                const d = (pixelAov != null && truthAov != null) ? (pixelAov - truthAov) : null;
                diffText = (d != null) ? ('?? AOV ' + fmtSignedMoney(d)) : '';
              } else {
                const d = (kexoCr != null && shopifyCr != null) ? (kexoCr - shopifyCr) : null;
                diffText = (d != null) ? ('?? CR ' + fmtSignedPp(d)) : '';
              }

              if (compareUpdatedEl) {
                compareUpdatedEl.textContent = 'Updated ' + formatTs(updatedAtMs) + (diffText ? (' ?? ' + diffText) : '');
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
                cmpHtml +=     compareBrand('Shopify', SHOPIFY_LOGO_URL, 'ShopifyQL sessions ?? conversion_rate');
                cmpHtml +=     '<div class="kpi-compare-metrics">' +
                                 compareMetric('CR% (Shopify)', fmtPct(shopifyCr)) +
                                 compareMetric('Sessions (today)', fmtSessions(shopifySessionsToday)) +
                                 compareMetric('Orders (paid)', ordersHtml) +
                                 compareMetric('Revenue (paid)', fmtRevenue(truthRevenue)) +
                               '</div>';
                cmpHtml +=   '</div>';
                cmpHtml +=   '<div class="kpi-compare-card">';
                cmpHtml +=     compareBrand('Kexo', KEXO_LOGO_URL, 'Human sessions ?? bot signals');
                cmpHtml +=     '<div class="kpi-compare-metrics">' +
                                 compareMetric('CR% (truth)', fmtPct(kexoCr)) +
                                 compareMetric('Sessions (human, today)', fmtSessions(kexoSessionsToday)) +
                                 compareMetric('Bots blocked (today)', botsBlockedToday != null ? edgeBlocksButtonHtml(botsBlockedToday, '24h') : '\u2014') +
                                 compareMetric('Bot-tagged (today)', botsTaggedToday != null ? fmtSessions(botsTaggedToday) : '\u2014') +
                               '</div>';
                cmpHtml +=   '</div>';
              }

              cmpHtml += '</div>';

              if (compareStepEl) compareStepEl.textContent = 'Building comparison view';
              compareStatusEl.innerHTML = cmpHtml;
            }
          } catch (_) {}
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
                  setMsg('Copying\u2026', true);
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
                setGaMsg('Fetching status\u2026', true);
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
                setGaMsg('Fetching summary\u2026', true);
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
              setGaMsg('Refreshing ' + rangeKey + '\u2026', true);
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
                if (msgEl) msgEl.textContent = 'Saving\u2026';
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
                      if (msgEl) msgEl.textContent = 'Saved. Syncing pixel settings\u2026';
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

    updateLastSaleAgo();
    hydrateLastSaleFooterFromApi({ forceNew: false });
    _intervals.push(setInterval(function() {
      if (document.visibilityState !== 'visible') return;
      try { updateLastSaleAgo(); } catch (_) {}
    }, 10000));

    (function initDiagnosticsActions() {
      const openBtn = document.getElementById('config-open-btn');
