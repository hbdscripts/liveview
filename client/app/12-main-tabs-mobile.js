        const VALID_TABS = ['dashboard', 'spy', 'sales', 'date', 'snapshot', 'stats', 'products', 'attribution', 'devices', 'ads', 'tools'];
        const TAB_LABELS = { dashboard: 'Overview', spy: 'Live View', sales: 'Recent Sales', date: 'Table View', snapshot: 'Snapshot', stats: 'Countries', products: 'Products', variants: 'Variants', attribution: 'Attribution', devices: 'Devices', ads: 'Google Ads', tools: 'Tools' };
        const HASH_TO_TAB = { dashboard: 'dashboard', 'live-view': 'spy', sales: 'sales', date: 'date', countries: 'stats', products: 'products', channels: 'attribution', type: 'devices', attribution: 'attribution', devices: 'devices', ads: 'ads', 'compare-conversion-rate': 'tools', 'change-pins': 'tools' };
        const TAB_TO_HASH = { dashboard: 'dashboard', spy: 'live-view', sales: 'sales', date: 'date', stats: 'countries', products: 'products', attribution: 'attribution', devices: 'devices', ads: 'ads', tools: 'compare-conversion-rate' };
        const tabDashboard = document.getElementById('nav-tab-dashboard');
        const tabSpy = document.getElementById('nav-tab-spy');
        const tabStats = document.getElementById('nav-tab-stats');
        const tabSnapshot = document.getElementById('nav-tab-snapshot');
        const tabProducts = document.getElementById('nav-tab-products');
        const tabVariants = document.getElementById('nav-tab-variants');
        const tabAds = document.getElementById('nav-tab-ads');
        const tabSales = document.getElementById('nav-tab-sales');
        const tabDate = document.getElementById('nav-tab-date');
        const tabTools = document.getElementById('nav-tab-tools');
        const panelDashboard = document.getElementById('tab-panel-dashboard');
        const panelSpy = document.getElementById('tab-panel-spy');
        const panelStats = document.getElementById('tab-panel-stats');
        const panelSnapshot = document.getElementById('tab-panel-snapshot');
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

        var TAB_TO_NAV = { spy: 'live', snapshot: 'snapshot', stats: 'countries' };
        var NAV_TO_ICON_KEY = {
          overview: 'nav-item-overview',
          dashboard: 'nav-item-overview',
          live: 'nav-item-live',
          sales: 'nav-item-sales',
          date: 'nav-item-table',
          snapshot: 'nav-item-overview',
          countries: 'nav-item-countries',
          products: 'nav-item-products',
          variants: 'nav-item-variants',
          'abandoned-carts': 'nav-item-sales',
          channels: 'nav-item-channels',
          type: 'nav-item-type',
          attribution: 'nav-item-attribution',
          devices: 'nav-item-type',
          ads: 'nav-item-ads',
          tools: 'nav-item-tools',
          'click-order-lookup': 'nav-item-tools',
          'compare-conversion-rate': 'nav-item-tools',
          'shipping-cr': 'nav-item-tools',
          'change-pins': 'nav-item-tools'
        };
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

            // Mobile-only: inject a small arrow icon before the page title text.
            // (Shown/hidden purely by CSS media queries so it applies to every page consistently.)
            try {
              var title = document.querySelector('.page-header .kexo-page-header-title-col .page-title');
              if (title) {
                title.querySelectorAll('.kexo-page-header-title-icon').forEach(function(el) { try { el.remove(); } catch (_) {} });
                title.querySelectorAll('.kexo-page-title-mobile-sep').forEach(function(el) { try { el.remove(); } catch (_) {} });
                title.querySelectorAll('.kexo-page-title-mobile-arrow').forEach(function(el) { try { el.remove(); } catch (_) {} });
                var arrow = document.createElement('i');
                arrow.className = 'fa-thin fa-arrow-turn-down-right kexo-page-title-mobile-arrow';
                arrow.setAttribute('aria-hidden', 'true');
                title.insertBefore(arrow, title.firstChild || null);
              }
            } catch (_) {}

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
            var parentItem = link.closest('.nav-item');
            if (parentItem) {
              if (isActive) parentItem.classList.add('active');
              else {
                var menu = parentItem.querySelector('.dropdown-menu');
                var hasCurrent = menu && menu.querySelector('.dropdown-item[aria-current="page"]');
                if (!hasCurrent) parentItem.classList.remove('active');
              }
            }
            link.classList.remove('active');
          });
          if (tabDashboard) tabDashboard.setAttribute('aria-selected', tab === 'dashboard' ? 'true' : 'false');
          if (tabSpy) tabSpy.setAttribute('aria-selected', tab === 'spy' ? 'true' : 'false');
          if (tabSnapshot) tabSnapshot.setAttribute('aria-selected', tab === 'snapshot' ? 'true' : 'false');
          if (tabStats) tabStats.setAttribute('aria-selected', tab === 'stats' ? 'true' : 'false');
          if (tabProducts) tabProducts.setAttribute('aria-selected', tab === 'products' ? 'true' : 'false');
          if (tabVariants) tabVariants.setAttribute('aria-selected', tab === 'variants' ? 'true' : 'false');
          if (tabAds) tabAds.setAttribute('aria-selected', tab === 'ads' ? 'true' : 'false');
          if (tabSales) tabSales.setAttribute('aria-selected', tab === 'sales' ? 'true' : 'false');
          if (tabDate) tabDate.setAttribute('aria-selected', tab === 'date' ? 'true' : 'false');
          if (tabTools) tabTools.setAttribute('aria-selected', tab === 'tools' ? 'true' : 'false');
          // Dashboard dropdown ??? highlight parent li.nav-item when a child page is active
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
          // Insights dropdown (Snapshot + Countries + Products + Variants)
          var isInsightsChild = (tab === 'snapshot' || tab === 'stats' || tab === 'products' || tab === 'variants' || tab === 'abandoned-carts');
          var insightsToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-insights-menu"]');
          var insightsDropdownItem = insightsToggle ? insightsToggle.closest('.nav-item') : null;
          if (insightsToggle) {
            insightsToggle.setAttribute('aria-current', isInsightsChild ? 'page' : 'false');
          }
          if (insightsDropdownItem) {
            if (isInsightsChild) insightsDropdownItem.classList.add('active');
            else insightsDropdownItem.classList.remove('active');
          }
          // Acquisition dropdown
          var isAcquisitionChild = (tab === 'attribution' || tab === 'devices');
          var acquisitionToggle = document.querySelector('.nav-item.dropdown .dropdown-toggle[href="#navbar-acquisition-menu"]');
          var acquisitionDropdownItem = acquisitionToggle ? acquisitionToggle.closest('.nav-item') : null;
          if (acquisitionToggle) {
            acquisitionToggle.setAttribute('aria-current', isAcquisitionChild ? 'page' : 'false');
          }
          if (acquisitionDropdownItem) {
            if (isAcquisitionChild) acquisitionDropdownItem.classList.add('active');
            else acquisitionDropdownItem.classList.remove('active');
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

          // Tools dropdown (include tool sub-pages so Tools is highlighted on /tools/* pages)
          var isToolsChild = (tab === 'tools' || tab === 'compare-conversion-rate' || tab === 'shipping-cr' || tab === 'click-order-lookup' || tab === 'change-pins');
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
            var rangeKey = '';
            try { rangeKey = getStatsRange(); } catch (_) { rangeKey = ''; }
            var cacheMatchesRange = !!(rangeKey && kpiCache && kpiCacheRange === rangeKey);
            var trusted = cacheMatchesRange && kpiCacheSource === 'kpis';
            var staleKpis = !trusted || !lastKpisFetchedAt || (Date.now() - lastKpisFetchedAt) > KPI_REFRESH_MS;
            if (staleKpis) {
              refreshKpis({ force: false });
            } else {
              renderLiveKpis(getKpiData());
              try { refreshKpiExtrasSoft(); } catch (_) {}
              try { fetchCondensedSeries(); } catch (_) {}
            }
          }

          if (tab === 'tools') {
            ensureKpis();
            return;
          }
          if (tab === 'snapshot') {
            ensureKpis();
            return;
          }
          if (tab === 'dashboard') {
            try { if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: false }); } catch (_) {}
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
          } else if (tab === 'abandoned-carts') {
            try { refreshAbandonedCarts({ force: false }); } catch (_) { fetchSessions(); }
            ensureKpis();
          } else if (tab === 'attribution') {
            refreshAttribution({ force: false });
            ensureKpis();
          } else if (tab === 'devices') {
            refreshDevices({ force: false });
            ensureKpis();
          } else if (tab === 'browsers') {
            refreshBrowsers({ force: false });
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
          var isSnapshot = tab === 'snapshot';
          if (panelSpy) panelSpy.classList.toggle('active', isSpy || isSales || isDate);
          if (panelSnapshot) panelSnapshot.classList.toggle('active', isSnapshot);
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
          var pageTab = PAGE === 'live' ? 'spy'
            : PAGE === 'snapshot' ? 'snapshot'
            : PAGE === 'countries' ? 'stats'
            : PAGE === 'sales' ? 'sales'
            : PAGE === 'date' ? 'date'
            : PAGE === 'channels' ? 'attribution'
            : PAGE === 'type' ? 'devices'
            : PAGE === 'attribution' ? 'attribution'
            : PAGE === 'devices' ? 'devices'
            : PAGE === 'browsers' ? 'browsers'
            : (PAGE === 'compare-conversion-rate' || PAGE === 'shipping-cr' || PAGE === 'click-order-lookup' || PAGE === 'change-pins') ? PAGE
            : PAGE;
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

        function updateMobileNavDropdownTop() {
          if (!isMobileViewport()) return;
          const nav = document.querySelector('.kexo-desktop-nav');
          if (!nav) return;
          const rect = nav.getBoundingClientRect();
          document.documentElement.style.setProperty('--kexo-mobile-nav-dropdown-top', (rect.bottom - 4) + 'px');
        }

        function closeOpenNavDropdowns() {
          if (!isMobileViewport()) return;
          navLeft.querySelectorAll('.dropdown-menu.show').forEach(function (menu) {
            const toggle = menu.closest('.dropdown') && menu.closest('.dropdown').querySelector('[data-bs-toggle="dropdown"]');
            if (toggle && typeof bootstrap !== 'undefined' && bootstrap.Dropdown) {
              try {
                const instance = bootstrap.Dropdown.getOrCreateInstance(toggle);
                if (instance) instance.hide();
              } catch (_) {}
            }
          });
        }

        navLeft.querySelectorAll('.dropdown').forEach(function (dropdownEl) {
          dropdownEl.addEventListener('shown.bs.dropdown', function () {
            if (!isMobileViewport()) return;
            updateMobileNavDropdownTop();
          });
        });

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
          updateMobileNavDropdownTop();
        }, { passive: true });
        window.addEventListener('scroll', function() {
          closeOpenNavDropdowns();
        }, { passive: false });
        window.addEventListener('orientationchange', function() {
          resetNavStartPosition();
          syncDropdownOverflowState();
          updateMobileNavDropdownTop();
        });
        window.addEventListener('pageshow', function() {
          resetNavStartPosition();
          syncDropdownOverflowState();
        });

        resetNavStartPosition();
        syncDropdownOverflowState();
        updateMobileNavDropdownTop();
      })();
      (function initNavDropdownAccent() {
        var navList = document.querySelector('.kexo-desktop-nav-list');
        if (!navList) return;
        var styleEl = document.getElementById('kexo-nav-dropdown-accent');
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'kexo-nav-dropdown-accent';
          styleEl.textContent = [
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .nav-link {',
            '  --tblr-dropdown-bg: var(--kexo-accent, var(--tblr-primary, #3eb3ab)) !important;',
            '  background: var(--kexo-accent, var(--tblr-primary, #3eb3ab)) !important;',
            '  background-color: var(--kexo-accent, var(--tblr-primary, #3eb3ab)) !important;',
            '  color: #fff !important;',
            '  border-radius: 4px 4px 0 0;',
            '}',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .dropdown-menu {',
            '  --tblr-dropdown-bg: var(--kexo-accent, var(--tblr-primary, #3eb3ab)) !important;',
            '  background: var(--kexo-accent, var(--tblr-primary, #3eb3ab)) !important;',
            '  background-color: var(--kexo-accent, var(--tblr-primary, #3eb3ab)) !important;',
            '  color: #fff !important;',
            '  border-radius: 0 0 4px 4px;',
            '}',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .nav-link > .kexo-nav-svg,',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .nav-link > i[class*="fa-"] {',
            '  opacity: 1 !important;',
            '  color: #fff !important;',
            '}',
            '/* Override active accent icon when dropdown open (focused) ??? icon back to white */',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open.active .nav-link > .kexo-nav-svg,',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open.active .nav-link > i[class*="fa-"] {',
            '  color: #fff !important;',
            '}',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .dropdown-item,',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .dropdown-item .kexo-nav-svg,',
            '.kexo-desktop-nav-list .nav-item.dropdown.kexo-dropdown-open .dropdown-item .kexo-nav-dropdown-item-icon {',
            '  color: #fff !important;',
            '}'
          ].join('\n');
          document.head.appendChild(styleEl);
        }
        navList.addEventListener('show.bs.dropdown', function(e) {
          var navItem = (e.target && e.target.closest) ? e.target.closest('.nav-item.dropdown') : null;
          if (navItem) navItem.classList.add('kexo-dropdown-open');
        });
        navList.addEventListener('hide.bs.dropdown', function(e) {
          var navItem = (e.target && e.target.closest) ? e.target.closest('.nav-item.dropdown') : null;
          if (navItem) navItem.classList.remove('kexo-dropdown-open');
        });
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
            // Silent refresh: never cover the page with the overlay loader while refreshing.
            // (Use the subtle date-range spinner + the refresh button spin only.)
            kexoWithSilentOverlay(function() {
              if (activeMainTab === 'dashboard') {
                try { if (typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true }); } catch (_) {}
              } else if (activeMainTab === 'stats') {
                try { refreshStats({ force: true }); } catch (_) {}
              } else if (activeMainTab === 'products') {
                try { refreshProducts({ force: true }); } catch (_) {}
              } else if (activeMainTab === 'variants') {
                try { if (typeof window.__refreshVariantsInsights === 'function') window.__refreshVariantsInsights({ force: true }); } catch (_) {}
              } else if (activeMainTab === 'abandoned-carts') {
                try { refreshAbandonedCarts({ force: true }); } catch (_) { try { fetchSessions(); } catch (_) {} }
              } else if (activeMainTab === 'attribution') {
                try { refreshAttribution({ force: true }); } catch (_) {}
              } else if (activeMainTab === 'devices') {
                try { refreshDevices({ force: true }); } catch (_) {}
              } else if (activeMainTab === 'ads') {
                try { if (window.__adsRefresh) window.__adsRefresh({ force: true }); } catch (_) {}
              } else {
                try { fetchSessions(); } catch (_) {}
              }
              try { refreshKpis({ force: true }); } catch (_) {}
            });
          });
        }
      })();
      updateServerTimeDisplay();
      updateNextUpdateUi();
      _intervals.push(setInterval(function() {
        if (document.visibilityState !== 'visible') return;
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
