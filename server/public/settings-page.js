/**
 * Settings page – tab switching, data loading, form wiring.
 * Runs only when data-page="settings".
 */
(function () {
  'use strict';

  if (document.body.getAttribute('data-page') !== 'settings') return;
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('settings', { page: 'settings' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('settings', 'init', { page: 'settings' }); } catch (_) {}

  var API = '';
  try {
    if (typeof window !== 'undefined' && window.API) API = String(window.API || '');
  } catch (_) {}

  // Persist the shop parameter even if the Settings UI rewrites the URL.
  var _settingsShopParamCache = '';

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = typeof timeoutMs === 'number' ? timeoutMs : 25000;
    ms = Math.max(0, Number(ms) || 0);
    if (typeof fetch !== 'function') {
      return Promise.reject(new Error('fetch not available'));
    }
    if (typeof AbortController === 'undefined' || ms === 0) {
      return fetch(url, options || {});
    }
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      try { ctrl.abort(); } catch (_) {}
    }, ms);
    var opts = options && typeof options === 'object' ? { ...options } : {};
    opts.signal = ctrl.signal;
    return fetch(url, opts).then(
      function (res) { try { clearTimeout(timer); } catch (_) {} return res; },
      function (err) { try { clearTimeout(timer); } catch (_) {} throw err; }
    );
  }

  function normalizeSettingsUrlQueryEarly() {
    try {
      if (!window.history || typeof window.history.replaceState !== 'function') return;
      var rawSearch = String(window.location.search || '');
      if (!rawSearch) return;
      var params = new URLSearchParams(rawSearch);
      var keep = new URLSearchParams();
      var rawTab = String(params.get('tab') || '').trim().toLowerCase();
      if (rawTab === 'sources') rawTab = 'attribution';
      if (rawTab === 'general' || rawTab === 'assets' || rawTab === 'theme') rawTab = 'kexo';
      if (rawTab === 'charts' || rawTab === 'kpis') rawTab = 'layout';
      var allowedTabs = {
        kexo: true, integrations: true,
        attribution: true, insights: true, layout: true,
        'cost-expenses': true,
        admin: true,
      };
      if (allowedTabs[rawTab]) {
        if (rawTab === 'admin' && !document.getElementById('settings-tab-admin')) keep.set('tab', 'kexo');
        else if (rawTab === 'cost-expenses' && !document.getElementById('settings-tab-cost-expenses')) keep.set('tab', 'kexo');
        else keep.set('tab', rawTab);
      }
      var rawCostExpenses = String(params.get('costExpensesTab') || '').trim().toLowerCase();
      if ((rawCostExpenses === 'cost-sources' || rawCostExpenses === 'shipping' || rawCostExpenses === 'rules' || rawCostExpenses === 'breakdown') && keep.get('tab') === 'cost-expenses') {
        keep.set('costExpensesTab', rawCostExpenses);
      }
      var rawKexo = String(params.get('kexoTab') || params.get('kexo') || '').trim().toLowerCase();
      if (!rawKexo) {
        var legacyTab = String(params.get('tab') || '').trim().toLowerCase();
        if (legacyTab === 'theme') rawKexo = 'theme-display';
        else if (legacyTab === 'general' || legacyTab === 'assets') rawKexo = 'general';
      }
      var kexoToNew = { ui: 'icons-assets', icons: 'icons-assets', 'payment-methods': 'icons-assets', header: 'theme-display', color: 'theme-display', fonts: 'theme-display', notifications: 'theme-display' };
      if (kexoToNew[rawKexo]) rawKexo = kexoToNew[rawKexo];
      if (rawKexo === 'brand-appearance') rawKexo = 'icons-assets';
      var allowedKexo = { general: true, 'icons-assets': true, 'theme-display': true };
      if (allowedKexo[rawKexo] && keep.get('tab') === 'kexo') {
        keep.set('kexoTab', rawKexo);
      }
      var rawLayout = String(params.get('layoutTab') || params.get('layout') || '').trim().toLowerCase();
      if ((rawLayout === 'tables' || rawLayout === 'charts' || rawLayout === 'kpis' || rawLayout === 'date-ranges') && keep.get('tab') === 'layout') {
        keep.set('layoutTab', rawLayout);
      }
      if (rawLayout === 'charts') keep.set('layoutTab', 'tables');
      var rawIntegrations = String(params.get('integrationsTab') || '').trim().toLowerCase();
      if ((rawIntegrations === 'shopify' || rawIntegrations === 'googleads') && keep.get('tab') === 'integrations') {
        keep.set('integrationsTab', rawIntegrations);
      }
      var rawAdminTab = String(params.get('adminTab') || '').trim().toLowerCase();
      if ((rawAdminTab === 'controls' || rawAdminTab === 'diagnostics' || rawAdminTab === 'users') && keep.get('tab') === 'admin') {
        keep.set('adminTab', rawAdminTab);
      }
      var rawShop = String(params.get('shop') || '').trim();
      if (rawShop) keep.set('shop', rawShop);
      // Preserve Google Ads OAuth marker so the UI can show a useful hint after redirect.
      var rawAdsOauth = String(params.get('ads_oauth') || '').trim();
      if (rawAdsOauth) keep.set('ads_oauth', rawAdsOauth);
      var nextSearch = keep.toString();
      var nextUrl = window.location.pathname + (nextSearch ? ('?' + nextSearch) : '') + (window.location.hash || '');
      var curUrl = window.location.pathname + rawSearch + (window.location.hash || '');
      if (nextUrl !== curUrl) window.history.replaceState(null, '', nextUrl);
    } catch (_) {}
  }
  normalizeSettingsUrlQueryEarly();

  function isSettingsPageLoaderEnabled() {
    // Settings should never show the page overlay loader.
    return false;
  }

  function getGlobalPageLoaderEls() {
    var pageBody = document.querySelector('.page-body');
    var overlay = document.getElementById('page-body-loader');
    if (!pageBody || !overlay) return null;
    var titleEl = overlay.querySelector('.report-build-title');
    var stepEl = document.getElementById('page-body-build-step') || overlay.querySelector('.report-build-step');
    return { pageBody: pageBody, overlay: overlay, titleEl: titleEl, stepEl: stepEl };
  }

  function showGlobalPageLoader(title, step) {
    var st = getGlobalPageLoaderEls();
    if (!st) return;
    try { st.pageBody.classList.add('report-building'); } catch (_) {}
    try { st.overlay.classList.remove('is-hidden'); } catch (_) {}
    if (title != null && st.titleEl) st.titleEl.textContent = String(title);
    if (step != null && st.stepEl) st.stepEl.textContent = String(step);
  }

  function dismissGlobalPageLoader() {
    var st = getGlobalPageLoaderEls();
    if (!st) return;
    try { st.overlay.classList.add('is-hidden'); } catch (_) {}
    try { st.pageBody.classList.remove('report-building'); } catch (_) {}
    try { st.pageBody.style.minHeight = ''; } catch (_) {}
  }

  var kpiUiConfigCache = null;
  var profitRulesCache = null;
  var tablesUiConfigCache = null;
  var chartsUiConfigCache = null;
  var insightsVariantsConfigCache = null;
  var insightsVariantsDraft = null;
  var tablesUiPanelRendered = false;
  var insightsIgnoreModalBackdropEl = null;
  var insightsSuggestModalBackdropEl = null;
  var insightsSuggestPayload = null;
  var insightsSuggestLoadingInterval = null;
  var insightsSuggestLoadingStartMs = 0;
  var insightsVariantsWarningsCache = null;
  var insightsWarningsModalBackdropEl = null;
  var insightsMergeModalBackdropEl = null;
  var insightsMergeContext = null;
  var initialLayoutSubTab = null;
  var initialKexoSubTab = null;
  var initialIntegrationsSubTab = null;
  var initialAttributionSubTab = null;
  var initialAdminSubTab = null;
  var initialCostExpensesSubTab = null;
  var activeLayoutSubTab = 'tables';
  var activeKexoSubTab = 'general';
  var activeIntegrationsSubTab = 'shopify';
  var activeAttributionSubTab = 'mapping';
  var activeAdminSubTab = 'users';
  var activeCostExpensesSubTab = 'cost-sources';

  var layoutTabsetApi = null;
  var kexoTabsetApi = null;
  var integrationsTabsetApi = null;
  var attributionTabsetApi = null;
  var adminTabsetApi = null;

  var TAB_MAP = {
    kexo: 'settings-panel-kexo',
    integrations: 'settings-panel-integrations',
    attribution: 'settings-panel-attribution',
    insights: 'settings-panel-insights',
    layout: 'settings-panel-layout',
    'cost-expenses': 'settings-panel-cost-expenses',
    admin: 'settings-panel-admin',
  };

  function getTabFromQuery() {
    var m = /[?&]tab=([^&]+)/.exec(window.location.search || '');
    if (m && m[1]) {
      var t = m[1].toLowerCase().replace(/\s+/g, '-');
      if (t === 'sources') t = 'attribution';
      if (t === 'general' || t === 'assets' || t === 'theme') {
        initialKexoSubTab = (t === 'theme') ? 'theme-display' : 'general';
        return 'kexo';
      }
      if (t === 'kpis') {
        initialLayoutSubTab = t;
        return 'layout';
      }
      if (t === 'kexo') {
        var km = /[?&](?:kexoTab|kexo)=([^&]+)/.exec(window.location.search || '');
        if (km && km[1]) {
          var kk = km[1].toLowerCase().replace(/\s+/g, '-');
          var kexoMap = { ui: 'icons-assets', icons: 'icons-assets', 'payment-methods': 'icons-assets', header: 'theme-display', color: 'theme-display', fonts: 'theme-display', notifications: 'theme-display' };
          if (kexoMap[kk]) kk = kexoMap[kk];
          if (kk === 'brand-appearance') kk = 'icons-assets';
          if (kk === 'general' || kk === 'icons-assets' || kk === 'theme-display') {
            initialKexoSubTab = kk;
          }
        }
      }
      if (t === 'layout') {
        var lm = /[?&](?:layoutTab|layout)=([^&]+)/.exec(window.location.search || '');
        if (lm && lm[1]) {
          var lk = lm[1].toLowerCase().replace(/\s+/g, '-');
          if (lk === 'tables' || lk === 'charts' || lk === 'kpis' || lk === 'date-ranges') initialLayoutSubTab = lk;
        }
      }
      if (t === 'integrations') {
        var im = /[?&]integrationsTab=([^&]+)/.exec(window.location.search || '');
        if (im && im[1]) {
          var ik = im[1].toLowerCase().replace(/\s+/g, '-');
          if (ik === 'shopify' || ik === 'googleads') initialIntegrationsSubTab = ik;
        }
      }
      if (t === 'attribution') {
        var am = /[?&]attributionTab=([^&]+)/.exec(window.location.search || '');
        if (am && am[1]) {
          var ak = am[1].toLowerCase().replace(/\s+/g, '-');
          if (ak === 'mapping' || ak === 'tree') initialAttributionSubTab = ak;
        }
      }
      if (t === 'admin') {
        var adm = /[?&]adminTab=([^&]+)/.exec(window.location.search || '');
        if (adm && adm[1]) {
          var adk = adm[1].toLowerCase().replace(/\s+/g, '-');
          if (adk === 'controls' || adk === 'diagnostics' || adk === 'users') initialAdminSubTab = adk;
        }
      }
      if (t === 'cost-expenses') {
        var cem = /[?&]costExpensesTab=([^&]+)/.exec(window.location.search || '');
        if (cem && cem[1]) {
          var cek = cem[1].toLowerCase().replace(/\s+/g, '-');
          if (cek === 'cost-sources' || cek === 'shipping' || cek === 'rules' || cek === 'breakdown') initialCostExpensesSubTab = cek;
        }
      }
      if (TAB_MAP[t]) {
        if (t === 'admin' && !document.getElementById('settings-tab-admin')) return null;
        if (t === 'cost-expenses' && !document.getElementById('settings-tab-cost-expenses')) return null;
        return t;
      }
    }
    return null;
  }

  function getTabFromHash() {
    var hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
    if (hash === 'sources') return 'attribution';
    if (hash === 'general' || hash === 'assets' || hash === 'theme') {
      initialKexoSubTab = hash === 'theme' ? 'theme-display' : 'general';
      return 'kexo';
    }
    if (hash === 'kpis') {
      initialLayoutSubTab = hash;
      return 'layout';
    }
    if (hash === 'charts') {
      initialLayoutSubTab = 'charts';
      return 'layout';
    }
    if (hash && TAB_MAP[hash]) return hash;
    return null;
  }

  function updateUrl(key) {
    var params = new URLSearchParams();
    params.set('tab', key);
    if (key === 'layout') {
      var layoutKey = getActiveLayoutSubTab();
      if (layoutKey === 'tables' || layoutKey === 'charts' || layoutKey === 'kpis' || layoutKey === 'date-ranges') params.set('layoutTab', layoutKey);
    }
    if (key === 'integrations') {
      var integrationsKey = getActiveIntegrationsSubTab();
      if (integrationsKey === 'shopify' || integrationsKey === 'googleads') params.set('integrationsTab', integrationsKey);
    }
    if (key === 'kexo') {
      var kexoKey = getActiveKexoSubTab();
      if (kexoKey) params.set('kexoTab', kexoKey);
    }
    if (key === 'attribution') {
      var attributionKey = getActiveAttributionSubTab();
      if (attributionKey === 'mapping' || attributionKey === 'tree') params.set('attributionTab', attributionKey);
    }
    if (key === 'admin') {
      var adminKey = getActiveAdminSubTab();
      if (adminKey === 'controls' || adminKey === 'diagnostics' || adminKey === 'users') params.set('adminTab', adminKey);
    }
    if (key === 'cost-expenses') {
      var costExpensesKey = getActiveCostExpensesSubTab();
      if (costExpensesKey === 'cost-sources' || costExpensesKey === 'shipping' || costExpensesKey === 'rules' || costExpensesKey === 'breakdown') params.set('costExpensesTab', costExpensesKey);
    }
    // Preserve shop and Google Ads OAuth marker (used to show post-redirect hints).
    try {
      var sp = getShopParam();
      if (sp) params.set('shop', sp);
    } catch (_) {}
    try {
      var ao = String(new URLSearchParams(window.location.search || '').get('ads_oauth') || '').trim();
      if (ao) params.set('ads_oauth', ao);
    } catch (_) {}
    var url = window.location.pathname + '?' + params.toString();
    try { history.replaceState(null, '', url); } catch (_) {}
  }

  function getActiveSettingsTab() {
    var active = document.querySelector('.settings-panel.active');
    if (!active || !active.id) return '';
    return String(active.id).replace('settings-panel-', '');
  }

  function getActiveLayoutSubTab() {
    return activeLayoutSubTab || 'tables';
  }

  function getActiveIntegrationsSubTab() {
    var key = activeIntegrationsSubTab || initialIntegrationsSubTab || 'shopify';
    return key === 'googleads' ? 'googleads' : 'shopify';
  }

  function getActiveKexoSubTab() {
    return activeKexoSubTab || 'general';
  }

  function getActiveAttributionSubTab() {
    var key = activeAttributionSubTab || initialAttributionSubTab || 'mapping';
    return key === 'tree' ? 'tree' : 'mapping';
  }

  function getActiveAdminSubTab() {
    var key = activeAdminSubTab || initialAdminSubTab || 'users';
    if (key === 'users' || key === 'diagnostics') return key;
    return 'controls';
  }

  function getActiveCostExpensesSubTab() {
    var key = (activeCostExpensesSubTab || initialCostExpensesSubTab || 'cost-sources');
    key = String(key || '').trim().toLowerCase();
    if (key === 'breakdown') return 'breakdown';
    if (key === 'cost-sources') return 'cost-sources';
    if (key === 'rules') return 'rules';
    if (key === 'shipping') return 'shipping';
    return 'cost-sources';
  }


  function renderTablesWhenVisible() {
    if (tablesUiPanelRendered) return;
    renderLayoutTablesUiPanel(tablesUiConfigCache || defaultTablesUiConfigV1());
    var chartsCfg = chartsUiConfigCache || defaultChartsUiConfigV1();
    var hideEl = document.getElementById('settings-charts-hide-mobile');
    if (hideEl) hideEl.checked = !(chartsCfg.hideOnMobile !== false);
    tablesUiPanelRendered = true;
  }

  var chartsUiPanelRendered = false;
  function renderChartsWhenVisible() {
    if (chartsUiPanelRendered) return;
    renderChartsUiPanel(chartsUiConfigCache || defaultChartsUiConfigV1());
    chartsUiPanelRendered = true;
    wireChartsSaveReset();
  }

  function syncLeftNavActiveClasses(key) {
    var tablist = document.getElementById('settings-category-tablist');
    if (!tablist) return;
    tablist.querySelectorAll('a[data-settings-tab]').forEach(function (el) {
      var tabKey = el.getAttribute('data-settings-tab');
      var isCategoryMatch = (tabKey === key);
      var isActive;
      if (el.classList.contains('settings-nav-child')) {
        var subAttr = (tabKey === 'kexo' && 'data-settings-kexo-tab') || (tabKey === 'layout' && 'data-settings-layout-tab') || (tabKey === 'integrations' && 'data-settings-integrations-tab') || (tabKey === 'attribution' && 'data-settings-attribution-tab') || (tabKey === 'cost-expenses' && 'data-settings-cost-expenses-tab') || (tabKey === 'admin' && 'data-settings-admin-tab');
        if (!subAttr) {
          // Some categories (e.g. Insights) use a single child label; treat it as active when the category is active.
          isActive = isCategoryMatch;
        } else {
          var subKey = el.getAttribute(subAttr);
          var currentSub = tabKey === 'kexo' ? getActiveKexoSubTab() : (tabKey === 'layout' ? getActiveLayoutSubTab() : (tabKey === 'integrations' ? getActiveIntegrationsSubTab() : (tabKey === 'attribution' ? getActiveAttributionSubTab() : (tabKey === 'cost-expenses' ? getActiveCostExpensesSubTab() : (tabKey === 'admin' ? getActiveAdminSubTab() : null)))));
          isActive = isCategoryMatch && subKey && (String(subKey).toLowerCase() === String(currentSub || '').toLowerCase());
        }
      } else {
        isActive = isCategoryMatch;
      }
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    try { syncSettingsMobileMenuTitle(); } catch (_) {}
  }

  function getSettingsActiveNavLabel() {
    var tablist = document.getElementById('settings-category-tablist');
    if (!tablist) return '';
    var child = tablist.querySelector('a.settings-nav-child.active');
    var parent = tablist.querySelector('a[data-settings-tab]:not(.settings-nav-child).active');
    var childText = child ? String(child.textContent || '').trim() : '';
    var parentText = parent ? String(parent.textContent || '').trim() : '';
    if (childText && parentText && childText.toLowerCase() !== parentText.toLowerCase()) return parentText + ' · ' + childText;
    return childText || parentText || '';
  }

  function syncSettingsMobileMenuTitle() {
    var titleEl = document.getElementById('settings-mobile-menu-title');
    if (!titleEl) return;
    var t = getSettingsActiveNavLabel();
    titleEl.textContent = t || 'Settings';
  }

  function isSettingsMobileViewport() {
    try {
      return !!(window && window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches);
    } catch (_) {
      return false;
    }
  }

  function settingsSubAttrForKey(key) {
    var k = String(key || '').trim().toLowerCase();
    return (k === 'kexo' && 'data-settings-kexo-tab') ||
      (k === 'layout' && 'data-settings-layout-tab') ||
      (k === 'integrations' && 'data-settings-integrations-tab') ||
      (k === 'attribution' && 'data-settings-attribution-tab') ||
      (k === 'cost-expenses' && 'data-settings-cost-expenses-tab') ||
      (k === 'admin' && 'data-settings-admin-tab') ||
      null;
  }

  function activateTab(key) {
    syncLeftNavActiveClasses(key);
    document.querySelectorAll('.settings-panel').forEach(function (el) {
      var panelKey = el.id && el.id.replace('settings-panel-', '');
      el.classList.toggle('active', panelKey === key);
    });
    updateUrl(key);
    if (key === 'attribution') {
      try {
        if (typeof window.initAttributionMappingSettings === 'function') {
          window.initAttributionMappingSettings({ rootId: 'settings-attribution-mapping-root' });
        }
      } catch (_) {}
    }
    if (key === 'layout') {
      try { renderTablesWhenVisible(); } catch (_) {}
    }
    if (key === 'insights') {
      try {
        if (!insightsVariantsDraft) {
          renderInsightsVariantsPanel(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
        }
      } catch (_) {}
    }
    if (key === 'cost-expenses') {
      try {
        if (typeof window.initCostExpensesSettings === 'function') window.initCostExpensesSettings();
      } catch (_) {}
      try {
        var costExpensesSub = getActiveCostExpensesSubTab();
        if (typeof window.__kexoCostExpensesSetActiveSubTab === 'function') {
          window.__kexoCostExpensesSetActiveSubTab(costExpensesSub, { updateUrl: false });
        }
      } catch (_) {}
    }
  }

  function activateFromSettingsNavAnchor(a, opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    if (!a || !a.getAttribute) return;
    var key = a.getAttribute('data-settings-tab');
    if (!key) return;

    var subKey = null;
    if (a.classList && a.classList.contains('settings-nav-child')) {
      var subAttr = settingsSubAttrForKey(key);
      subKey = subAttr ? a.getAttribute(subAttr) : null;
      if (subKey) {
        if (key === 'kexo') { initialKexoSubTab = subKey; activeKexoSubTab = subKey; }
        else if (key === 'layout') { initialLayoutSubTab = subKey; activeLayoutSubTab = subKey; }
        else if (key === 'integrations') { initialIntegrationsSubTab = subKey; activeIntegrationsSubTab = subKey; }
        else if (key === 'attribution') { initialAttributionSubTab = subKey; activeAttributionSubTab = subKey; }
        else if (key === 'cost-expenses') { initialCostExpensesSubTab = subKey; activeCostExpensesSubTab = subKey; }
        else if (key === 'admin') { initialAdminSubTab = subKey; activeAdminSubTab = subKey; }
      }
    }

    if (a.getAttribute('href')) {
      try { history.replaceState(null, '', a.getAttribute('href')); } catch (_) {}
    }

    activateTab(key);
    try {
      if (subKey) {
        if (key === 'kexo' && kexoTabsetApi) kexoTabsetApi.activate(subKey);
        else if (key === 'layout' && layoutTabsetApi) layoutTabsetApi.activate(subKey);
        else if (key === 'integrations' && integrationsTabsetApi) integrationsTabsetApi.activate(subKey);
        else if (key === 'attribution' && attributionTabsetApi) attributionTabsetApi.activate(subKey);
        else if (key === 'admin' && adminTabsetApi) adminTabsetApi.activate(subKey);
      }
    } catch (_) {}

    if (o.scrollIntoView) {
      try {
        var activePanel = document.querySelector('.settings-panel.active');
        if (activePanel && activePanel.scrollIntoView) {
          activePanel.scrollIntoView({ block: 'start', behavior: 'smooth' });
          setTimeout(function () { try { window.scrollBy(0, -12); } catch (_) {} }, 0);
        }
      } catch (_) {}
    }
  }

  function initSettingsMobileMenu() {
    var btn = document.getElementById('settings-mobile-menu-btn');
    var closeBtn = document.getElementById('settings-mobile-menu-close');
    var backdrop = document.getElementById('settings-mobile-drawer-backdrop');
    var drawer = document.getElementById('settings-mobile-drawer');
    var menuRoot = document.getElementById('settings-mobile-drawer-menu');
    var tablist = document.getElementById('settings-category-tablist');
    if (!btn || !drawer || !backdrop || !menuRoot || !tablist) return;

    function closeMenu() {
      try { btn.setAttribute('aria-expanded', 'false'); } catch (_) {}
      try { document.documentElement.classList.remove('settings-mobile-menu-open'); } catch (_) {}
      try { backdrop.hidden = true; } catch (_) {}
      try { drawer.hidden = true; } catch (_) {}
      try { btn.focus(); } catch (_) {}
    }

    function collapseAllMobileCategories() {
      try {
        menuRoot.querySelectorAll('.settings-mobile-category').forEach(function (wrap) {
          if (!wrap) return;
          wrap.classList.remove('is-open');
          var btnEl = wrap.querySelector ? wrap.querySelector('.settings-mobile-cat-btn') : null;
          if (btnEl) btnEl.setAttribute('aria-expanded', 'false');
        });
      } catch (_) {}
    }

    function syncMobileMenuActiveLinks() {
      try {
        var activeTab = getActiveSettingsTab();
        var currentSubAttr = settingsSubAttrForKey(activeTab);
        var currentSub = currentSubAttr
          ? (activeTab === 'kexo' ? getActiveKexoSubTab() : (activeTab === 'layout' ? getActiveLayoutSubTab() : (activeTab === 'integrations' ? getActiveIntegrationsSubTab() : (activeTab === 'attribution' ? getActiveAttributionSubTab() : (activeTab === 'cost-expenses' ? getActiveCostExpensesSubTab() : (activeTab === 'admin' ? getActiveAdminSubTab() : null))))))
          : null;
        menuRoot.querySelectorAll('a[data-settings-tab]').forEach(function (a) {
          var k = a.getAttribute('data-settings-tab');
          var isMatch = (k === activeTab);
          var isActive = false;
          if (a.classList.contains('settings-nav-child')) {
            var subAttr = settingsSubAttrForKey(k);
            var subKey = subAttr ? a.getAttribute(subAttr) : null;
            if (!subAttr) isActive = isMatch;
            else isActive = isMatch && subKey && String(subKey).toLowerCase() === String(currentSub || '').toLowerCase();
          } else {
            isActive = isMatch;
          }
          a.classList.toggle('active', !!isActive);
        });
      } catch (_) {}
    }

    function buildMenu() {
      menuRoot.innerHTML = '';
      tablist.querySelectorAll('.settings-nav-category').forEach(function (cat) {
        if (!cat || !cat.querySelector) return;
        var catLink = cat.querySelector('a[data-settings-tab]:not(.settings-nav-child)');
        if (!catLink) return;
        if (catLink.classList.contains('d-none')) return;
        var key = String(catLink.getAttribute('data-settings-tab') || '').trim();
        if (!key) return;
        var label = String(catLink.textContent || '').trim() || key;

        var wrap = document.createElement('div');
        wrap.className = 'settings-mobile-category';
        wrap.setAttribute('data-settings-tab', key);

        var btnCat = document.createElement('button');
        btnCat.type = 'button';
        btnCat.className = 'settings-mobile-cat-btn';
        btnCat.setAttribute('aria-expanded', 'false');
        var left = document.createElement('span');
        left.textContent = label;
        var chev = document.createElement('span');
        chev.className = 'settings-mobile-cat-chevron';
        chev.innerHTML = '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>';
        btnCat.appendChild(left);
        btnCat.appendChild(chev);

        var children = document.createElement('div');
        children.className = 'settings-mobile-children';
        cat.querySelectorAll('.settings-nav-children a[data-settings-tab]').forEach(function (childA) {
          if (!childA) return;
          var clone = childA.cloneNode(true);
          clone.removeAttribute('role');
          clone.removeAttribute('aria-controls');
          clone.removeAttribute('aria-selected');
          clone.addEventListener('click', function (e) {
            try { e.preventDefault(); } catch (_) {}
            activateFromSettingsNavAnchor(clone, { scrollIntoView: true });
            syncMobileMenuActiveLinks();
            closeMenu();
          });
          children.appendChild(clone);
        });

        btnCat.addEventListener('click', function () {
          var isNowOpen = !wrap.classList.contains('is-open');
          menuRoot.querySelectorAll('.settings-mobile-category').forEach(function (w) {
            if (!w) return;
            w.classList.toggle('is-open', w === wrap ? isNowOpen : false);
            var b = w.querySelector ? w.querySelector('.settings-mobile-cat-btn') : null;
            if (b) b.setAttribute('aria-expanded', w.classList.contains('is-open') ? 'true' : 'false');
          });
        });

        wrap.appendChild(btnCat);
        wrap.appendChild(children);
        menuRoot.appendChild(wrap);
      });
      collapseAllMobileCategories();
      syncMobileMenuActiveLinks();
    }

    function openMenu() {
      try { btn.setAttribute('aria-expanded', 'true'); } catch (_) {}
      try { backdrop.hidden = false; } catch (_) {}
      try { drawer.hidden = false; } catch (_) {}
      try { document.documentElement.classList.add('settings-mobile-menu-open'); } catch (_) {}
      try { syncSettingsMobileMenuTitle(); } catch (_) {}
      try { buildMenu(); } catch (_) {}
      setTimeout(function () { try { drawer.focus(); } catch (_) {} }, 0);
    }

    function isOpen() {
      try { return document.documentElement.classList.contains('settings-mobile-menu-open'); } catch (_) { return false; }
    }

    // Build once for initial label; we rebuild on open in case tabs are toggled by viewer plan.
    try { syncSettingsMobileMenuTitle(); } catch (_) {}

    btn.addEventListener('click', function () { if (isOpen()) closeMenu(); else openMenu(); });
    if (closeBtn) closeBtn.addEventListener('click', closeMenu);
    backdrop.addEventListener('click', closeMenu);
    window.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      var k = e && e.key != null ? String(e.key) : '';
      if (k === 'Escape') closeMenu();
    });
    window.addEventListener('resize', function () {
      if (!isSettingsMobileViewport() && isOpen()) closeMenu();
    });
  }

  function ensurePanelClass(panelId, className) {
    var panel = document.getElementById(panelId);
    if (!panel) return null;
    if (className) panel.classList.add(className);
    return panel;
  }

  function ensureKexoUiPanel() {
    ensurePanelClass('settings-kexo-panel-general', 'settings-kexo-panel');
    ensurePanelClass('settings-kexo-panel-icons-assets', 'settings-kexo-panel');
    var themeDisplay = document.getElementById('settings-kexo-panel-theme-display');
    if (themeDisplay) themeDisplay.classList.add('settings-kexo-panel');
  }

  function injectMainTabsFromAccordion(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var accordion = document.getElementById(String(o.accordionId || ''));
    var tabAttr = String(o.tabAttr || '');
    var navId = String(o.navId || '');
    var panelClass = String(o.panelClass || '');
    var tabs = Array.isArray(o.tabs) ? o.tabs : [];
    if (!accordion || !tabAttr || !navId || !tabs.length) return;

    var host = accordion.parentElement;
    if (!host) return;

    var nav = document.getElementById(navId);
    if (!nav) {
      nav = document.createElement('ul');
      nav.className = 'nav nav-tabs mb-3';
      nav.id = navId;
      nav.setAttribute('role', 'tablist');
      tabs.forEach(function (tab, idx) {
        var key = tab && tab.key != null ? String(tab.key) : '';
        if (!key) return;
        var label = tab && tab.label != null ? String(tab.label) : key;
        var li = document.createElement('li');
        li.className = 'nav-item';
        li.setAttribute('role', 'presentation');
        var link = document.createElement('a');
        link.href = '#';
        link.className = 'nav-link' + (idx === 0 ? ' active' : '');
        link.setAttribute('role', 'tab');
        link.setAttribute('aria-selected', idx === 0 ? 'true' : 'false');
        link.setAttribute(tabAttr, key);
        link.id = navId + '-tab-' + key;
        link.textContent = label;
        li.appendChild(link);
        nav.appendChild(li);
      });
      host.insertBefore(nav, accordion);
    }

    accordion.classList.add('settings-main-tabs-accordion');
    tabs.forEach(function (tab, idx) {
      var panelId = tab && tab.panelId != null ? String(tab.panelId) : '';
      if (!panelId) return;
      var panel = ensurePanelClass(panelId, panelClass);
      if (!panel) return;
      if (idx === 0) panel.classList.add('active');

      var collapse = panel.closest('.accordion-collapse');
      if (collapse) {
        collapse.classList.add('show');
        collapse.style.height = '';
        collapse.removeAttribute('data-bs-parent');
      }

      var body = panel.closest('.accordion-body');
      if (body) body.classList.add('settings-main-tab-body');
      var item = panel.closest('.accordion-item');
      if (item) item.classList.add('settings-main-tab-item');
      var header = item ? item.querySelector('.accordion-header') : null;
      if (header) header.classList.add('d-none');
    });
  }

  function prepareSettingsMainTabs() {
    ensureKexoUiPanel();
    injectMainTabsFromAccordion({
      accordionId: 'settings-kexo-accordion',
      tabAttr: 'data-settings-kexo-tab',
      navId: 'settings-kexo-main-tabs',
      panelClass: 'settings-kexo-panel',
      tabs: [
        { key: 'general', label: 'General', panelId: 'settings-kexo-panel-general' },
        { key: 'icons-assets', label: 'Icons & assets', panelId: 'settings-kexo-panel-icons-assets' },
        { key: 'theme-display', label: 'Color Scheme', panelId: 'settings-kexo-panel-theme-display' },
      ],
    });

    injectMainTabsFromAccordion({
      accordionId: 'settings-integrations-accordion',
      tabAttr: 'data-settings-integrations-tab',
      navId: 'settings-integrations-main-tabs',
      panelClass: 'settings-integrations-panel',
      tabs: [
        { key: 'shopify', label: 'Shopify', panelId: 'settings-integrations-panel-shopify' },
        { key: 'googleads', label: 'Google Ads', panelId: 'settings-integrations-panel-googleads' },
      ],
    });

    injectMainTabsFromAccordion({
      accordionId: 'settings-attribution-accordion',
      tabAttr: 'data-settings-attribution-tab',
      navId: 'settings-attribution-main-tabs',
      panelClass: 'settings-attribution-panel',
      tabs: [
        { key: 'mapping', label: 'Mapping rules', panelId: 'settings-attribution-panel-mapping' },
        { key: 'tree', label: 'Channel tree', panelId: 'settings-attribution-panel-tree' },
      ],
    });

    injectMainTabsFromAccordion({
      accordionId: 'settings-insights-accordion',
      tabAttr: 'data-settings-insights-layout-tab',
      navId: 'settings-insights-main-tabs',
      panelClass: 'settings-insights-layout-panel',
      tabs: [
        { key: 'variants', label: 'Variants', panelId: 'settings-insights-layout-panel-variants' },
      ],
    });

    injectMainTabsFromAccordion({
      accordionId: 'settings-layout-accordion',
      tabAttr: 'data-settings-layout-tab',
      navId: 'settings-layout-main-tabs',
      panelClass: 'settings-layout-panel',
      tabs: [
        { key: 'tables', label: 'Tables', panelId: 'settings-layout-panel-tables' },
        { key: 'kpis', label: 'KPIs', panelId: 'settings-layout-panel-kpis' },
        { key: 'date-ranges', label: 'Date ranges', panelId: 'settings-layout-panel-date-ranges' },
      ],
    });

    injectMainTabsFromAccordion({
      accordionId: 'settings-admin-accordion',
      tabAttr: 'data-settings-admin-tab',
      navId: 'settings-admin-main-tabs',
      panelClass: 'admin-panel',
      tabs: [
        { key: 'users', label: 'Users & roles', panelId: 'admin-panel-users' },
        { key: 'diagnostics', label: 'Diagnostics', panelId: 'admin-panel-diagnostics' },
        { key: 'controls', label: 'Controls', panelId: 'admin-panel-controls' },
      ],
    });
  }

  function wireSettingsAccordionShown() {
    var mappingEl = document.getElementById('settings-attribution-accordion-mapping');
    var treeEl = document.getElementById('settings-attribution-accordion-tree');
    if (mappingEl) {
      mappingEl.addEventListener('shown.bs.collapse', function () {
        try { if (typeof window.initAttributionMappingSettings === 'function') window.initAttributionMappingSettings({ rootId: 'settings-attribution-mapping-root' }); } catch (_) {}
      });
    }
    if (treeEl) {
      treeEl.addEventListener('shown.bs.collapse', function () {
        try { if (typeof window.initAttributionTreeView === 'function') window.initAttributionTreeView({ rootId: 'settings-attribution-tree-root' }); } catch (_) {}
      });
    }
    var tablesEl = document.getElementById('settings-layout-accordion-tables');
    if (tablesEl) {
      tablesEl.addEventListener('shown.bs.collapse', function () {
        try { renderTablesWhenVisible(); } catch (_) {}
      });
    }
    var variantsEl = document.getElementById('settings-insights-accordion-variants');
    if (variantsEl) {
      variantsEl.addEventListener('shown.bs.collapse', function () {
        try {
          if (!insightsVariantsDraft) {
            renderInsightsVariantsPanel(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
          }
        } catch (_) {}
      });
    }
  }

  /**
   * Generic tabset controller. Wires [data-kexo-tab] / data-*-tab buttons to panels by id.
   * options: { tabSelector, panelIdPrefix, keys, tabToPanel (optional), initialKey, onActivate(key) }
   */
  function wireKexoTabset(options) {
    var opts = options || {};
    var tabSelector = opts.tabSelector || '[data-kexo-tab]';
    var tabAttr = opts.tabAttr || 'data-kexo-tab';
    var panelIdPrefix = opts.panelIdPrefix || '';
    var keys = opts.keys || [];
    var tabToPanel = opts.tabToPanel || null;
    var initialKey = opts.initialKey || (keys[0]);
    var onActivate = typeof opts.onActivate === 'function' ? opts.onActivate : null;
    var tabs = document.querySelectorAll(tabSelector);
    if (!tabs.length) return;
    function getPanelKey(tabKey) {
      return tabToPanel && tabToPanel[tabKey] !== undefined ? tabToPanel[tabKey] : tabKey;
    }
    function activate(key) {
      var panelKey = getPanelKey(key);
      tabs.forEach(function (tab) {
        var tabKey = (tab.getAttribute && tab.getAttribute(tabAttr)) || '';
        var isActive = tabKey === key;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        var ctrlId = tab.id;
        if (ctrlId && panelIdPrefix) {
          var p = document.getElementById(panelIdPrefix + panelKey);
          if (p) p.setAttribute('aria-labelledby', ctrlId);
        }
      });
      keys.forEach(function (k) {
        var pkey = getPanelKey(k);
        var panel = document.getElementById(panelIdPrefix + pkey);
        if (panel) panel.classList.toggle('active', pkey === panelKey);
      });
      if (onActivate) onActivate(key);
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function (e) {
        try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (_) {}
        var k = (tab.getAttribute && tab.getAttribute(tabAttr)) || keys[0];
        activate(k);
      });
    });
    activate(initialKey);
    return { activate: activate };
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML.replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTs(ms) {
    try {
      if (typeof ms !== 'number' || !isFinite(ms)) return '\u2014';
      return new Date(ms).toLocaleString();
    } catch (_) {
      return '\u2014';
    }
  }

  function formatInt(v) {
    try {
      var n = Number(v);
      if (!isFinite(n)) return '0';
      return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    } catch (_) {
      return '0';
    }
  }

  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = String(html || '');
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text == null ? '\u2014' : String(text);
  }

  function badge(text, tone) {
    var cls = 'bg-secondary-lt';
    if (tone === 'ok') cls = 'bg-success-lt';
    else if (tone === 'bad') cls = 'bg-danger-lt';
    else if (tone === 'warn') cls = 'bg-warning-lt';
    return '<span class="badge ' + cls + '">' + escapeHtml(String(text || '')) + '</span>';
  }

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj || null)); } catch (_) { return obj || null; }
  }

  function makeLengthRules() {
    var out = [];
    for (var n = 12; n <= 21; n += 1) {
      out.push({
        id: String(n) + 'in',
        label: String(n) + '"',
        include: [String(n) + '"', String(n) + ' inches', String(n) + ' inch', String(n) + ' in'],
        exclude: [],
      });
    }
    return out;
  }

  function defaultInsightsVariantsConfigV1() {
    return {
      v: 1,
      tables: [],
    };
  }

  function isBuiltinInsightsTableId(id) {
    return false;
  }

  var DEFAULT_VARIANTS_TABLE_ICON = 'fa-solid fa-grid-round';

  function normalizeTokenList(rawList) {
    var out = [];
    var seen = {};
    var arr = Array.isArray(rawList) ? rawList : [];
    arr.forEach(function (item) {
      var token = item == null ? '' : String(item).trim().toLowerCase();
      token = token.replace(/\s+/g, ' ').slice(0, 120);
      if (!token || seen[token]) return;
      seen[token] = true;
      out.push(token);
    });
    return out;
  }

  function parseAliasesFromText(raw) {
    var text = raw == null ? '' : String(raw);
    return normalizeTokenList(
      text
        .split(/\n|,/g)
        .map(function (s) { return s.trim(); })
        .filter(Boolean)
    );
  }

  function buildTableAliasChipsHtml(aliasList, tableIdx) {
    var list = Array.isArray(aliasList) ? aliasList : [];
    return list.map(function (a) {
      var token = String(a || '');
      if (!token) return '';
      return '' +
        '<span class="item badge bg-secondary-lt kexo-alias-chip" data-ts-item data-value="' + escapeHtml(token) + '">' +
          '<span class="kexo-alias-chip-text">' + escapeHtml(token) + '</span>' +
          '<button type="button" class="kexo-alias-chip-remove" aria-label="Remove alias" data-action="remove-table-alias" data-table-idx="' + String(tableIdx) + '" data-alias="' + escapeHtml(token) + '">×</button>' +
        '</span>';
    }).join('');
  }

  function normalizeIgnoredTitle(raw) {
    return String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 512);
  }

  function normalizeIgnoredList(rawList) {
    var out = [];
    var seen = {};
    var arr = Array.isArray(rawList) ? rawList : [];
    arr.forEach(function (item) {
      var title = normalizeIgnoredTitle(item);
      if (!title || seen[title]) return;
      seen[title] = true;
      out.push(title);
    });
    return out;
  }

  function slugify(raw, fallback) {
    var s = raw == null ? '' : String(raw).trim().toLowerCase();
    s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return s || (fallback || 'table');
  }

  function normalizeInsightsVariantsConfig(raw) {
    var cfg = raw && typeof raw === 'object' ? raw : null;
    var defaults = defaultInsightsVariantsConfigV1();
    var tables = cfg && Array.isArray(cfg.tables) ? cfg.tables : defaults.tables;
    var out = [];
    var seenIds = {};
    tables.forEach(function (table, idx) {
      if (!table || typeof table !== 'object') return;
      var name = (table.name == null ? '' : String(table.name)).trim().replace(/\s+/g, ' ').slice(0, 80);
      if (!name) name = 'Table ' + String(idx + 1);
      var id = slugify(table.id || name, 'table-' + String(idx + 1));
      if (seenIds[id]) return;
      seenIds[id] = true;
      var enabled = table.enabled !== false;
      var orderRaw = parseInt(String(table.order), 10);
      var order = Number.isFinite(orderRaw) ? Math.max(0, orderRaw) : (idx + 1);
      var aliases = Array.isArray(table.aliases) ? normalizeTokenList(table.aliases) : parseAliasesFromText(table.aliases);
      var iconRaw = table.icon == null ? '' : String(table.icon);
      var icon = iconRaw.trim().replace(/\s+/g, ' ').slice(0, 120);
      var ignored = normalizeIgnoredList(table.ignored);
      var rules = [];
      var seenRuleIds = {};
      (Array.isArray(table.rules) ? table.rules : []).forEach(function (rule, rIdx) {
        if (!rule || typeof rule !== 'object') return;
        var label = (rule.label == null ? '' : String(rule.label)).trim().replace(/\s+/g, ' ').slice(0, 80);
        if (!label) label = 'Rule ' + String(rIdx + 1);
        var ruleId = slugify(rule.id || label, 'rule-' + String(rIdx + 1));
        if (seenRuleIds[ruleId]) return;
        seenRuleIds[ruleId] = true;
        var include = normalizeTokenList(rule.include);
        var exclude = normalizeTokenList(rule.exclude);
        rules.push({ id: ruleId, label: label, include: include, exclude: exclude });
      });
      out.push({ id: id, name: name, enabled: enabled, order: order, aliases: aliases, icon: icon, ignored: ignored, rules: rules });
    });
    defaults.tables.forEach(function (table) {
      if (seenIds[table.id]) return;
      out.push(deepClone(table));
      seenIds[table.id] = true;
    });
    out.sort(function (a, b) {
      var ao = Number(a && a.order) || 0;
      var bo = Number(b && b.order) || 0;
      if (ao !== bo) return ao - bo;
      var an = a && a.name ? String(a.name).toLowerCase() : '';
      var bn = b && b.name ? String(b.name).toLowerCase() : '';
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    return { v: 1, tables: out };
  }

  function wireIntegrationsSubTabs() {
    integrationsTabsetApi = wireKexoTabset({
      tabSelector: '#settings-integrations-main-tabs [data-settings-integrations-tab]',
      tabAttr: 'data-settings-integrations-tab',
      panelIdPrefix: 'settings-integrations-panel-',
      keys: ['shopify', 'googleads'],
      initialKey: initialIntegrationsSubTab || 'shopify',
      onActivate: function (key) {
        activeIntegrationsSubTab = key;
        if (getActiveSettingsTab() === 'integrations') {
          updateUrl('integrations');
          syncLeftNavActiveClasses('integrations');
        }
      },
    });
  }

  var gaIssueModalBackdropEl = null;
  function ensureGaIssueModalBackdrop() {
    if (gaIssueModalBackdropEl && gaIssueModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    gaIssueModalBackdropEl = el;
  }

  function closeGaIssueModal() {
    var modal = document.getElementById('settings-ga-issue-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.classList.add('kexo-modal-hidden');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (gaIssueModalBackdropEl && gaIssueModalBackdropEl.parentNode) {
      gaIssueModalBackdropEl.parentNode.removeChild(gaIssueModalBackdropEl);
    }
    gaIssueModalBackdropEl = null;
    try { modal.removeAttribute('data-issue-id'); } catch (_) {}
  }

  function openGaIssueModal(issue) {
    var modal = document.getElementById('settings-ga-issue-modal');
    if (!modal) return;
    var titleEl = document.getElementById('settings-ga-issue-modal-title');
    var bodyEl = document.getElementById('settings-ga-issue-modal-body');
    if (titleEl) titleEl.textContent = (issue && issue.title) ? String(issue.title) : 'Issue';
    if (bodyEl) bodyEl.innerHTML = '<div class="text-muted small">Loading…</div>';
    try { modal.setAttribute('data-issue-id', (issue && issue.id != null) ? String(issue.id) : ''); } catch (_) {}
    ensureGaIssueModalBackdrop();
    modal.style.display = 'block';
    modal.classList.remove('kexo-modal-hidden');
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
  }

  function wireGoogleAdsSettingsUi() {
    var root = document.documentElement;
    if (root && root.getAttribute('data-kexo-ga-settings-wired') === '1') return;
    try { root && root.setAttribute('data-kexo-ga-settings-wired', '1'); } catch (_) {}

    var connMsgEl = document.getElementById('settings-ga-connection-msg');
    var signinBtn = document.getElementById('settings-ga-signin-btn');
    var reconnectBtn = document.getElementById('settings-ga-reconnect-btn');
    var testConnBtn = document.getElementById('settings-ga-test-connection-btn');
    var disconnectBtn = document.getElementById('settings-ga-disconnect-btn');
    var provisionBtn = document.getElementById('settings-ga-provision-goals-btn');
    var postbackCb = document.getElementById('settings-ga-postback-enabled');
    var issuesRefreshBtn = document.getElementById('settings-ga-issues-refresh-btn');

    var profitSaveBtn = document.getElementById('settings-ga-profit-save-btn');
    var profitMsgEl = document.getElementById('settings-ga-profit-msg');

    var issueModalCloseBtn = document.getElementById('settings-ga-issue-modal-close');
    var issueModalDismissBtn = document.getElementById('settings-ga-issue-modal-dismiss');
    var issueModalResolveBtn = document.getElementById('settings-ga-issue-modal-resolve');

    if (!signinBtn && !reconnectBtn && !testConnBtn && !disconnectBtn && !provisionBtn && !postbackCb && !issuesRefreshBtn && !profitSaveBtn) return;

    function setHint(el, text, ok) {
      if (!el) return;
      el.textContent = text || '';
      if (ok === true) el.className = 'form-hint text-success';
      else if (ok === false) el.className = 'form-hint text-danger';
      else el.className = 'form-hint';
    }

    function fetchJson(url, opts, timeoutMs) {
      var o = opts && typeof opts === 'object' ? { ...opts } : {};
      if (!o.credentials) o.credentials = 'same-origin';
      if (!o.cache) o.cache = 'no-store';
      var tm = typeof timeoutMs === 'number' ? timeoutMs : 25000;
      var fetcher = typeof fetchWithTimeout === 'function' ? fetchWithTimeout : (function (u, opt, _tm) {
        if (typeof fetch !== 'function') return Promise.reject(new Error('fetch not available'));
        if (typeof AbortController === 'undefined' || !_tm) return fetch(u, opt || {});
        var ctrl = new AbortController();
        var t = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, _tm);
        var opts = opt && typeof opt === 'object' ? { ...opt } : {};
        opts.signal = ctrl.signal;
        return fetch(u, opts).then(function (r) { try { clearTimeout(t); } catch (_) {} return r; }, function (e) { try { clearTimeout(t); } catch (_) {} throw e; });
      });
      return fetcher(url, o, tm)
        .then(function (r) {
          return r.text().then(function (t) {
            var j = null;
            try { j = t ? JSON.parse(t) : null; } catch (_) {}
            return { ok: r.ok, status: r.status, json: j, text: t };
          });
        })
        .catch(function (e) {
          return { ok: false, status: 0, json: null, text: '', error: e && e.message ? e.message : 'Request failed' };
        });
    }

    function apiGet(path) {
      return fetchJson((API || '') + path, { method: 'GET' }, 25000);
    }
    function apiPost(path, body) {
      return fetchJson((API || '') + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
      }, 35000);
    }

    function safeText(s) {
      if (s == null) return '—';
      var t = String(s);
      return t ? t : '—';
    }

    function fmtTs(ts) {
      if (!ts) return '—';
      try { return formatTs(ts); } catch (_) {}
      try { return new Date(Number(ts)).toISOString(); } catch (_) { return '—'; }
    }

    function fmtPct(n) {
      var v = Number(n);
      if (!Number.isFinite(v)) return '—';
      var pct = Math.round(v * 10) / 10;
      return String(pct) + '%';
    }

    function fmtNum(n) {
      var v = Number(n);
      if (!Number.isFinite(v)) return '—';
      return String(Math.round(v));
    }

    function computeSuccessRate(counts) {
      var c = counts && typeof counts === 'object' ? counts : {};
      var success = Number(c.success) || 0;
      var failure = Number(c.failure) || 0;
      var pending = Number(c.pending) || 0;
      var denom = success + failure + pending;
      if (denom <= 0) return null;
      return (success / denom) * 100;
    }

    function readProfitDeductionsDraft() {
      var deductions = {
        includeGoogleAdsSpend: !!document.getElementById('settings-ga-deduction-google-ads') && document.getElementById('settings-ga-deduction-google-ads').checked,
        includePaymentFees: !!document.getElementById('settings-ga-deduction-payment-fees') && document.getElementById('settings-ga-deduction-payment-fees').checked,
        includeShopifyTaxes: !!document.getElementById('settings-ga-deduction-tax') && document.getElementById('settings-ga-deduction-tax').checked,
        includeShopifyAppBills: !!document.getElementById('settings-ga-deduction-app-bills') && document.getElementById('settings-ga-deduction-app-bills').checked,
        includeShipping: !!document.getElementById('settings-ga-deduction-shipping') && document.getElementById('settings-ga-deduction-shipping').checked,
        includeRules: !!document.getElementById('settings-ga-deduction-rules') && document.getElementById('settings-ga-deduction-rules').checked,
      };
      var addToCartEl = document.getElementById('settings-ga-addtocart-value');
      var addToCartValue = addToCartEl ? (Number(addToCartEl.value) || 0) : 1;
      if (!Number.isFinite(addToCartValue) || addToCartValue < 0) addToCartValue = 1;
      return { deductions: deductions, googleAdsAddToCartValue: addToCartValue };
    }

    function applyProfitDeductions(deductions, addToCartValue) {
      var d = deductions && typeof deductions === 'object' ? deductions : {};
      function setChk(id, val) {
        var el = document.getElementById(id);
        if (el) el.checked = !!val;
      }
      setChk('settings-ga-deduction-google-ads', d.includeGoogleAdsSpend);
      setChk('settings-ga-deduction-payment-fees', d.includePaymentFees);
      setChk('settings-ga-deduction-tax', d.includeShopifyTaxes);
      setChk('settings-ga-deduction-app-bills', d.includeShopifyAppBills);
      setChk('settings-ga-deduction-shipping', d.includeShipping);
      setChk('settings-ga-deduction-rules', d.includeRules);
      var addToCartEl = document.getElementById('settings-ga-addtocart-value');
      if (addToCartEl) addToCartEl.value = (addToCartValue != null && Number.isFinite(Number(addToCartValue)) && Number(addToCartValue) >= 0) ? String(Number(addToCartValue)) : '1';
    }

    function applyPostbackGoals(goals) {
      var g = goals && typeof goals === 'object' ? goals : {};
      function setChk(id, val) {
        var el = document.getElementById(id);
        if (el) el.checked = !!val;
      }
      setChk('settings-ga-upload-revenue', g.uploadRevenue !== false);
      setChk('settings-ga-upload-profit', g.uploadProfit === true);
      setChk('settings-ga-upload-addtocart', g.uploadAddToCart === true);
    }

    function readPostbackGoalsDraft() {
      return {
        uploadRevenue: !!document.getElementById('settings-ga-upload-revenue') && document.getElementById('settings-ga-upload-revenue').checked,
        uploadProfit: !!document.getElementById('settings-ga-upload-profit') && document.getElementById('settings-ga-upload-profit').checked,
        uploadAddToCart: !!document.getElementById('settings-ga-upload-addtocart') && document.getElementById('settings-ga-upload-addtocart').checked,
      };
    }

    function loadConversionActions() {
      var body = document.getElementById('settings-ga-actions-body');
      if (!body) return Promise.resolve(false);
      body.innerHTML = '<tr><td colspan="5" class="text-muted small">Loading…</td></tr>';
      var shop = getShopParam();
      var qs = shop ? ('?shop=' + encodeURIComponent(shop)) : '';
      return apiGet('/api/ads/google/conversion-actions' + qs)
        .then(function (r) {
          if (!r || !r.ok || !r.json || !r.json.ok) {
            body.innerHTML = '<tr><td colspan="5" class="text-muted small">No data yet.</td></tr>';
            return false;
          }
          var actions = Array.isArray(r.json.actions) ? r.json.actions : [];
          if (!actions.length) {
            body.innerHTML = '<tr><td colspan="5" class="text-muted small">No conversion actions found. Click “Provision conversion actions”.</td></tr>';
            return true;
          }
          body.innerHTML = actions.map(function (a) {
            var name = a && a.name ? String(a.name) : '—';
            var st = a && a.status ? String(a.status) : '—';
            var cat = a && a.category ? String(a.category) : '—';
            var primary = a && a.primary_for_goal === true;
            var last = a && a.last_upload_date_time ? String(a.last_upload_date_time) : null;
            return '<tr>' +
              '<td>' + escapeHtml(name) + '</td>' +
              '<td><span class="text-muted small">' + escapeHtml(st) + '</span></td>' +
              '<td><span class="text-muted small">' + escapeHtml(cat || '—') + '</span></td>' +
              '<td class="text-center"><span class="text-muted small">' + (primary ? 'On' : 'Off') + '</span></td>' +
              '<td class="text-end"><span class="text-muted small">' + escapeHtml(last || '—') + '</span></td>' +
              '</tr>';
          }).join('');
          return true;
        })
        .catch(function () {
          body.innerHTML = '<tr><td colspan="5" class="text-muted small">Failed to load conversion actions.</td></tr>';
          return false;
        });
    }

    function loadPostbackHealth() {
      var shop = getShopParam();
      var qs = shop ? ('?shop=' + encodeURIComponent(shop)) : '';
      return apiGet('/api/ads/google/goal-health' + qs)
        .then(function (r) {
          var lastRunEl = document.getElementById('settings-ga-pb-last-run');
          var queuedEl = document.getElementById('settings-ga-pb-queued');
          var sr24El = document.getElementById('settings-ga-pb-sr-24h');
          var sr7El = document.getElementById('settings-ga-pb-sr-7d');
          var fail7El = document.getElementById('settings-ga-pb-failures-7d');
          var cov7El = document.getElementById('settings-ga-pb-coverage-7d');
          var missEl = document.getElementById('settings-ga-pb-missing-clickid');
          var rejEl = document.getElementById('settings-ga-pb-rejected');
          var techEl = document.getElementById('settings-ga-pb-tech');

          if (!r || !r.ok || !r.json || !r.json.ok) {
            if (lastRunEl) lastRunEl.textContent = '—';
            if (queuedEl) queuedEl.textContent = '—';
            if (sr24El) sr24El.textContent = '—';
            if (sr7El) sr7El.textContent = '—';
            if (fail7El) fail7El.textContent = '—';
            if (cov7El) cov7El.textContent = '—';
            if (missEl) missEl.textContent = '—';
            if (rejEl) rejEl.textContent = '—';
            if (techEl) techEl.textContent = safeText(r && r.json ? r.json.error : null);
            return false;
          }

          var cov7 = r.json.coverage_7d || {};
          var rev7 = cov7.revenue || {};
          var prof7 = cov7.profit || {};
          var success7 = (Number(rev7.success) || 0) + (Number(prof7.success) || 0);
          var failure7 = (Number(rev7.failure) || 0) + (Number(prof7.failure) || 0);
          var pending7 = (Number(rev7.pending) || 0) + (Number(prof7.pending) || 0);
          var sr7 = computeSuccessRate({ success: success7, failure: failure7, pending: pending7 });

          var cov24 = r.json.coverage_24h || {};
          var rev24 = cov24.revenue || {};
          var prof24 = cov24.profit || {};
          var success24 = (Number(rev24.success) || 0) + (Number(prof24.success) || 0);
          var failure24 = (Number(rev24.failure) || 0) + (Number(prof24.failure) || 0);
          var pending24 = (Number(rev24.pending) || 0) + (Number(prof24.pending) || 0);
          var sr24 = computeSuccessRate({ success: success24, failure: failure24, pending: pending24 });

          if (lastRunEl) lastRunEl.textContent = safeText(r.json.last_run_at ? fmtTs(r.json.last_run_at) : null);
          if (queuedEl) queuedEl.textContent = safeText(r.json.jobs_queued != null ? fmtNum(r.json.jobs_queued) : null);
          if (sr24El) sr24El.textContent = sr24 == null ? '—' : fmtPct(sr24);
          if (sr7El) sr7El.textContent = sr7 == null ? '—' : fmtPct(sr7);
          if (fail7El) fail7El.textContent = fmtNum(failure7);
          if (cov7El) cov7El.textContent = (r.json.coverage_percent_7d == null) ? '—' : fmtPct(r.json.coverage_percent_7d);
          if (missEl) missEl.textContent = safeText(r.json.reconciliation && r.json.reconciliation.missing_click_id_orders != null ? fmtNum(r.json.reconciliation.missing_click_id_orders) : null);
          if (rejEl) rejEl.textContent = safeText(r.json.reconciliation && r.json.reconciliation.rejected_uploads != null ? fmtNum(r.json.reconciliation.rejected_uploads) : null);
          if (techEl) {
            try { techEl.textContent = JSON.stringify(r.json, null, 2); } catch (_) { techEl.textContent = '—'; }
          }
          return true;
        })
        .catch(function () { return false; });
    }

    function normalizeIssueType(t) {
      var s = t == null ? '' : String(t);
      if (!s) return 'Unknown';
      return s.replace(/_/g, ' ').toLowerCase().replace(/\b[a-z]/g, function (m) { return m.toUpperCase(); });
    }

    function renderIssues(rows) {
      var body = document.getElementById('settings-ga-issues-body');
      if (!body) return;
      var list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        body.innerHTML = '<tr><td colspan="5" class="text-muted small">No issues found.</td></tr>';
        return;
      }
      body.innerHTML = list.map(function (it) {
        var id = it && it.id != null ? String(it.id) : '';
        var typ = normalizeIssueType(it && (it.error_code || it.type));
        var ord = it && it.order_id ? String(it.order_id) : (it && it.order_ref ? String(it.order_ref) : '');
        if (!ord) {
          var msg = it && it.error_message ? String(it.error_message) : '';
          var m = /\bOrder\s+([A-Za-z0-9_-]{3,64})\b/.exec(msg);
          if (m && m[1]) ord = m[1];
        }
        if (!ord) ord = '—';
        var ts = it && (it.last_seen_at || it.created_at) ? fmtTs(it.last_seen_at || it.created_at) : '—';
        var st = it && it.status ? String(it.status) : '—';
        return '<tr>' +
          '<td><span class="text-muted small">' + escapeHtml(typ) + '</span></td>' +
          '<td><code class="small">' + escapeHtml(ord) + '</code></td>' +
          '<td><span class="text-muted small">' + escapeHtml(ts) + '</span></td>' +
          '<td><span class="text-muted small">' + escapeHtml(st) + '</span></td>' +
          '<td class="text-end"><button type="button" class="btn btn-outline-secondary btn-sm" data-settings-ga-issue-view="1" data-issue-id="' + escapeHtml(id) + '">View details</button></td>' +
          '</tr>';
      }).join('');
    }

    function loadIssues() {
      var body = document.getElementById('settings-ga-issues-body');
      if (!body) return Promise.resolve(false);
      body.innerHTML = '<tr><td colspan="5" class="text-muted small">Loading…</td></tr>';
      var shop = getShopParam();
      var filterBtn = document.querySelector('[data-settings-ga-issue-filter].active');
      var status = filterBtn && filterBtn.getAttribute('data-settings-ga-issue-filter') ? String(filterBtn.getAttribute('data-settings-ga-issue-filter')) : 'open';
      var qs = '?status=' + encodeURIComponent(status);
      if (shop) qs += '&shop=' + encodeURIComponent(shop);
      return apiGet('/api/integrations/google-ads/issues' + qs)
        .then(function (r) {
          if (!r || !r.ok || !r.json || !r.json.ok) {
            body.innerHTML = '<tr><td colspan="5" class="text-muted small">Failed to load issues.</td></tr>';
            return false;
          }
          renderIssues(r.json.issues || []);
          return true;
        })
        .catch(function () {
          body.innerHTML = '<tr><td colspan="5" class="text-muted small">Failed to load issues.</td></tr>';
          return false;
        });
    }

    function openIssueModal(issueId) {
      var id = issueId != null ? String(issueId) : '';
      if (!id) return;
      openGaIssueModal({ id: id, title: 'Issue #' + id });
      var shop = getShopParam();
      var qs = shop ? ('?shop=' + encodeURIComponent(shop)) : '';
      apiGet('/api/integrations/google-ads/issues/' + encodeURIComponent(id) + qs)
        .then(function (r) {
          var bodyEl = document.getElementById('settings-ga-issue-modal-body');
          var titleEl = document.getElementById('settings-ga-issue-modal-title');
          if (!bodyEl) return;
          if (!r || !r.ok || !r.json || !r.json.ok || !r.json.issue) {
            if (titleEl) titleEl.textContent = 'Issue';
            bodyEl.innerHTML = '<div class="text-muted small">' + escapeHtml((r && r.json && r.json.error) ? String(r.json.error) : 'Failed to load issue') + '</div>';
            return;
          }
          var it = r.json.issue;
          if (titleEl) titleEl.textContent = normalizeIssueType(it.error_code || it.type);
          var html = '';
          html += '<div class="mb-2"><strong>Status</strong> <span class="text-muted">' + escapeHtml(String(it.status || '—')) + '</span></div>';
          if (it.order_id) html += '<div class="mb-2"><strong>Order</strong> <code>' + escapeHtml(String(it.order_id)) + '</code></div>';
          html += '<div class="mb-2"><strong>First seen</strong> <span class="text-muted">' + escapeHtml(fmtTs(it.first_seen_at || it.created_at)) + '</span></div>';
          html += '<div class="mb-2"><strong>Last seen</strong> <span class="text-muted">' + escapeHtml(fmtTs(it.last_seen_at || it.updated_at)) + '</span></div>';
          if (it.error_message) html += '<div class="mt-3"><div class="text-muted small mb-1">Message</div><div>' + escapeHtml(String(it.error_message)) + '</div></div>';
          if (it.suggested_fix) html += '<div class="mt-3"><div class="text-muted small mb-1">Suggested fix</div><div>' + escapeHtml(String(it.suggested_fix)) + '</div></div>';
          bodyEl.innerHTML = html || '<div class="text-muted small">—</div>';
        })
        .catch(function () {});
    }

    function resolveCurrentIssue() {
      var modal = document.getElementById('settings-ga-issue-modal');
      if (!modal) return;
      var id = modal.getAttribute('data-issue-id') || '';
      if (!id) return;
      var shop = getShopParam();
      apiPost('/api/integrations/google-ads/issues/' + encodeURIComponent(id) + '/resolve', { shop: shop })
        .then(function (r) {
          if (r && r.ok && r.json && r.json.ok) {
            closeGaIssueModal();
            loadIssues();
            loadPostbackHealth();
            loadConversionActions();
          }
        })
        .catch(function () {});
    }

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', function () {
        setHint(connMsgEl, 'Disconnecting…', true);
        var shop = getShopParam();
        apiPost('/api/ads/google/disconnect', { shop: shop })
          .then(function (r) {
            if (r && r.ok && r.json && r.json.ok) {
              setHint(connMsgEl, 'Disconnected.', true);
              loadConfigAndPopulate();
              loadConversionActions();
              loadPostbackHealth();
              loadIssues();
            } else {
              setHint(connMsgEl, (r && r.json && r.json.error) ? String(r.json.error) : 'Disconnect failed', false);
            }
          })
          .catch(function () { setHint(connMsgEl, 'Disconnect failed', false); });
      });
    }

    if (testConnBtn) {
      testConnBtn.addEventListener('click', function () {
        setHint(connMsgEl, 'Testing connection…', true);
        var shop = getShopParam();
        var qs = shop ? ('?shop=' + encodeURIComponent(shop)) : '';
        apiGet('/api/ads/google/test-connection' + qs)
          .then(function (r) {
            var ok = !!(r && r.ok && r.json && r.json.ok);
            setHint(connMsgEl, ok ? 'Connection OK.' : ((r && r.json && r.json.error) ? String(r.json.error) : 'Test failed.'), ok);
          })
          .catch(function () { setHint(connMsgEl, 'Test failed.', false); });
      });
    }

    if (provisionBtn) {
      provisionBtn.addEventListener('click', function () {
        var goals = [];
        if (document.getElementById('settings-ga-goal-revenue') && document.getElementById('settings-ga-goal-revenue').checked) goals.push('revenue');
        if (document.getElementById('settings-ga-goal-profit') && document.getElementById('settings-ga-goal-profit').checked) goals.push('profit');
        if (document.getElementById('settings-ga-goal-addtocart') && document.getElementById('settings-ga-goal-addtocart').checked) goals.push('add_to_cart');
        if (!goals.length) {
          setHint(connMsgEl, 'Select at least one goal to provision.', false);
          return;
        }
        setHint(connMsgEl, 'Provisioning conversion actions…', true);
        var shop = getShopParam();
        apiPost('/api/ads/google/provision-goals', { shop: shop, goals: goals })
          .then(function (r) {
            var ok = !!(r && r.ok && r.json && r.json.ok);
            setHint(connMsgEl, ok ? 'Provisioned.' : ((r && r.json && r.json.error) ? String(r.json.error) : 'Provision failed.'), ok);
            if (ok) {
              loadConversionActions();
              loadPostbackHealth();
              loadIssues();
            }
          })
          .catch(function () { setHint(connMsgEl, 'Provision failed.', false); });
      });
    }

    if (postbackCb) {
      postbackCb.addEventListener('change', function () {
        var checked = !!postbackCb.checked;
        saveSettings({ googleAdsPostbackEnabled: checked })
          .then(function () {
            setHint(connMsgEl, checked ? 'Conversion uploads enabled.' : 'Conversion uploads disabled.', true);
            loadPostbackHealth();
          })
          .catch(function () { setHint(connMsgEl, 'Failed to save setting.', false); });
      });
    }

    var uploadRevenueEl = document.getElementById('settings-ga-upload-revenue');
    var uploadProfitEl = document.getElementById('settings-ga-upload-profit');
    var uploadAddToCartEl = document.getElementById('settings-ga-upload-addtocart');
    function savePostbackGoals() {
      saveSettings({ googleAdsPostbackGoals: readPostbackGoalsDraft() })
        .then(function () { setHint(connMsgEl, 'Upload goals saved.', true); })
        .catch(function () { setHint(connMsgEl, 'Failed to save upload goals.', false); });
    }
    if (uploadRevenueEl) uploadRevenueEl.addEventListener('change', savePostbackGoals);
    if (uploadProfitEl) uploadProfitEl.addEventListener('change', savePostbackGoals);
    if (uploadAddToCartEl) uploadAddToCartEl.addEventListener('change', savePostbackGoals);

    if (profitSaveBtn) {
      profitSaveBtn.addEventListener('click', function () {
        var draft = readProfitDeductionsDraft();
        setHint(profitMsgEl, 'Saving…', true);
        saveSettings({
          googleAdsProfitDeductions: draft.deductions,
          googleAdsAddToCartValue: draft.googleAdsAddToCartValue,
        })
          .then(function (r) {
            if (r && r.ok) setHint(profitMsgEl, 'Saved.', true);
            else setHint(profitMsgEl, (r && r.error) ? String(r.error) : 'Save failed.', false);
          })
          .catch(function () { setHint(profitMsgEl, 'Save failed.', false); });
      });
    }

    if (issueModalCloseBtn) issueModalCloseBtn.addEventListener('click', closeGaIssueModal);
    if (issueModalDismissBtn) issueModalDismissBtn.addEventListener('click', closeGaIssueModal);
    if (issueModalResolveBtn) issueModalResolveBtn.addEventListener('click', resolveCurrentIssue);

    document.addEventListener('click', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target) return;
      var viewBtn = target.closest ? target.closest('[data-settings-ga-issue-view="1"]') : null;
      if (viewBtn) {
        var id = viewBtn.getAttribute('data-issue-id') || '';
        openIssueModal(id);
        return;
      }
      var filterBtn = target.closest ? target.closest('[data-settings-ga-issue-filter]') : null;
      if (filterBtn) {
        document.querySelectorAll('[data-settings-ga-issue-filter]').forEach(function (b) {
          b.classList.remove('active');
        });
        filterBtn.classList.add('active');
        loadIssues();
      }
    });

    if (issuesRefreshBtn) issuesRefreshBtn.addEventListener('click', function () { loadIssues(); });

    try {
      window.__kexoApplyGoogleAdsProfitDeductions = function (d, v) { applyProfitDeductions(d, v != null ? v : 1); };
      window.__kexoApplyPostbackGoals = function (g) { applyPostbackGoals(g); };
    } catch (_) {}
    try {
      var payload = window.__kexoSettingsPayload;
      if (payload && payload.googleAdsProfitDeductions) applyProfitDeductions(payload.googleAdsProfitDeductions, payload.googleAdsAddToCartValue);
      else applyProfitDeductions(null, 1);
      if (payload && payload.googleAdsPostbackGoals) applyPostbackGoals(payload.googleAdsPostbackGoals);
      else applyPostbackGoals(null);
    } catch (_) {
      applyProfitDeductions(null, 1);
      applyPostbackGoals(null);
    }
    loadConversionActions();
    loadPostbackHealth();
    loadIssues();
  }

  function renderIntegrationsFromConfig(c) {
    var shopify = c && c.shopify ? c.shopify : {};
    var health = c && c.sales && c.sales.truth && c.sales.truth.health ? c.sales.truth.health : {};
    var pixel = c && c.pixel ? c.pixel : {};
    var settings = c && c.settings ? c.settings : {};
    var ingest = c && c.ingest ? c.ingest : {};
    var ads = c && c.ads && c.ads.status ? c.ads.status : {};
    var shopParam = getShopParam();
    var providers = Array.isArray(ads.providers) ? ads.providers : [];
    var ga = providers.find(function (p) { return p && String(p.key || '').toLowerCase() === 'google_ads'; }) || {};

    var storedScopes = shopify && shopify.storedScopes ? String(shopify.storedScopes) : '';
    var requiredScopes = shopify && shopify.serverScopes ? String(shopify.serverScopes) : '';
    var storedList = storedScopes ? storedScopes.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var requiredList = requiredScopes ? requiredScopes.split(',').map(function (s) { return s.trim(); }).filter(Boolean) : [];
    var missing = requiredList.filter(function (s) { return storedList.indexOf(s) === -1; });

    setText('settings-int-shopify-shop', shopify && shopify.shop ? shopify.shop : '\u2014');
    setHtml('settings-int-shopify-token', shopify && shopify.hasToken ? badge('Stored', 'ok') : badge('Missing', 'bad'));
    setText('settings-int-shopify-scopes', storedScopes || '\u2014');
    setHtml('settings-int-shopify-missing-scopes', missing.length ? badge(missing.join(', '), 'bad') : badge('None', 'ok'));

    var staleSec = (health && typeof health.staleMs === 'number' && isFinite(health.staleMs)) ? Math.round(health.staleMs / 1000) : null;
    setText('settings-int-shopify-sync-age', staleSec == null ? '\u2014' : (staleSec + 's'));
    setText('settings-int-shopify-last-sync', health && health.lastSuccessAt ? formatTs(health.lastSuccessAt) : '\u2014');
    setText('settings-int-shopify-last-error', health && health.lastError ? String(health.lastError).slice(0, 220) : '\u2014');

    var pixelIngestUrl = pixel && pixel.ingestUrl != null ? String(pixel.ingestUrl) : '';
    var expectedIngestUrl = ingest && ingest.effectiveIngestUrl != null ? String(ingest.effectiveIngestUrl) : '';
    var match = pixelIngestUrl && expectedIngestUrl ? pixelIngestUrl === expectedIngestUrl : null;
    setHtml('settings-int-pixel-installed', pixel && pixel.installed === true ? badge('Installed', 'ok') : badge('Not installed', 'bad'));
    setText('settings-int-pixel-ingest', pixelIngestUrl || '\u2014');
    setText('settings-int-expected-ingest', expectedIngestUrl || '\u2014');
    setHtml('settings-int-pixel-match', match == null ? badge('Unknown', 'warn') : (match ? badge('Match', 'ok') : badge('Mismatch', 'bad')));
    setText('settings-int-session-mode', (settings && settings.pixelSessionMode === 'shared_ttl') ? 'shared_ttl (cross-tab)' : 'legacy');

    var connBadge = document.getElementById('settings-ga-connection-status');
    if (connBadge) {
      if (ga && ga.connected) connBadge.innerHTML = badge('Connected', 'ok');
      else if (ga && ga.configured) connBadge.innerHTML = badge('Not connected', 'warn');
      else connBadge.innerHTML = badge('Not configured', 'bad');
    }
    setText('settings-ga-customer-id', ga && ga.customerId ? String(ga.customerId) : '\u2014');
    setText('settings-ga-login-customer-id', ga && ga.loginCustomerId ? String(ga.loginCustomerId) : '\u2014');
    setText('settings-ga-conversion-customer-id', ga && ga.conversionCustomerId ? String(ga.conversionCustomerId) : '\u2014');
    setHtml('settings-ga-devtoken-badge', ga && ga.hasDeveloperToken ? badge('Developer token: present', 'ok') : badge('Developer token: missing', 'bad'));
    setHtml('settings-ga-refreshtoken-badge', ga && ga.hasRefreshToken ? badge('Refresh token: present', 'ok') : badge('Refresh token: missing', 'bad'));

    var custIdEl = document.getElementById('settings-ga-account-customer-id');
    var loginCustEl = document.getElementById('settings-ga-account-login-customer-id');
    var convCustEl = document.getElementById('settings-ga-account-conversion-customer-id');
    if (custIdEl && (ga && ga.connected && ga.customerId)) custIdEl.value = String(ga.customerId);
    if (loginCustEl && (ga && ga.connected && ga.loginCustomerId)) loginCustEl.value = String(ga.loginCustomerId);
    if (convCustEl && (ga && ga.connected && ga.conversionCustomerId)) convCustEl.value = String(ga.conversionCustomerId);

    var postbackCb = document.getElementById('settings-ga-postback-enabled');
    if (postbackCb) postbackCb.checked = !!(settings && settings.googleAdsPostbackEnabled);

    function updateConnectHrefs() {
      var signIn = document.getElementById('settings-ga-signin-btn');
      var reconnect = document.getElementById('settings-ga-reconnect-btn');
      var cust = document.getElementById('settings-ga-account-customer-id');
      var login = document.getElementById('settings-ga-account-login-customer-id');
      var conv = document.getElementById('settings-ga-account-conversion-customer-id');
      var sp = getShopParam();
      var base = (typeof API !== 'undefined' ? API : '') + '/api/ads/google/connect?redirect=' + encodeURIComponent('/settings?tab=integrations&integrationsTab=googleads');
      if (sp) base += '&shop=' + encodeURIComponent(sp);
      if (cust && cust.value.trim()) base += '&customer_id=' + encodeURIComponent(cust.value.trim());
      if (login && login.value.trim()) base += '&login_customer_id=' + encodeURIComponent(login.value.trim());
      if (conv && conv.value.trim()) base += '&conversion_customer_id=' + encodeURIComponent(conv.value.trim());
      if (signIn) signIn.setAttribute('href', base);
      if (reconnect) reconnect.setAttribute('href', base);
    }
    updateConnectHrefs();
    if (custIdEl) custIdEl.addEventListener('input', updateConnectHrefs);
    if (loginCustEl) loginCustEl.addEventListener('input', updateConnectHrefs);
    if (convCustEl) convCustEl.addEventListener('input', updateConnectHrefs);

    var googleAdsOAuthEnabled = !!(c && c.ads && c.ads.googleAdsOAuthEnabled);
    var signInBtn = document.getElementById('settings-ga-signin-btn');
    var reconnectBtn = document.getElementById('settings-ga-reconnect-btn');
    var isConnected = !!(ga && ga.connected);
    if (signInBtn) signInBtn.classList.toggle('d-none', !googleAdsOAuthEnabled || isConnected);
    if (reconnectBtn) reconnectBtn.classList.toggle('d-none', !googleAdsOAuthEnabled || !isConnected);
  }

  function getShopParam() {
    try {
      var m = /[?&]shop=([^&]+)/.exec(window.location.search || '');
      var v = m && m[1] ? decodeURIComponent(m[1]) : '';
      if (v) _settingsShopParamCache = v;
      return v || _settingsShopParamCache || '';
    } catch (_) { return _settingsShopParamCache || ''; }
  }

  function loadConfigAndPopulate() {
    var shop = getShopParam();
    var url = API + '/api/config-status';
    if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);

    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        var cd = c && c.configDisplay ? c.configDisplay : {};
        document.querySelectorAll('#settings-general-app-url').forEach(function (el) {
          el.value = cd.shopifyAppUrl || '\u2014';
        });
        document.querySelectorAll('#settings-general-timezone').forEach(function (el) {
          el.value = cd.adminTimezone || '\u2014';
        });
        document.querySelectorAll('#settings-general-shop-domain').forEach(function (el) {
          el.value = cd.shopDomain || '\u2014';
        });
        document.querySelectorAll('#settings-general-display-domain').forEach(function (el) {
          el.value = cd.shopDisplayDomain || '\u2014';
        });
        document.querySelectorAll('#settings-general-store-main').forEach(function (el) {
          el.value = cd.storeMainDomain || '\u2014';
        });
        document.querySelectorAll('#settings-general-ingest-url').forEach(function (el) {
          el.value = cd.ingestUrl || '\u2014';
        });
        document.querySelectorAll('#settings-general-traffic-mode').forEach(function (el) {
          el.value = (cd.trafficMode || 'all') + (cd.dbEngine ? ' \u00b7 ' + cd.dbEngine : '');
        });

        renderIntegrationsFromConfig(c || {});
      })
      .catch(function () { return null; });
  }

  function loadSettingsAndPopulate() {
    return fetch(API + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        try { window.__kexoSettingsPayload = data; } catch (_) {}
        try {
          if (typeof window.__kexoApplyGoogleAdsProfitDeductions === 'function') {
            window.__kexoApplyGoogleAdsProfitDeductions(data.googleAdsProfitDeductions || null, data.googleAdsAddToCartValue != null ? data.googleAdsAddToCartValue : 1);
          }
          if (typeof window.__kexoApplyPostbackGoals === 'function') {
            window.__kexoApplyPostbackGoals(data.googleAdsPostbackGoals || null);
          }
        } catch (_) {}
        var reporting = data.reporting || {};
        var sessionMode = data.pixelSessionMode || 'legacy';
        var overrides = data.assetOverrides || {};
        kpiUiConfigCache = data.kpiUiConfig || null;
        profitRulesCache = data.profitRules || null;
        tablesUiConfigCache = data.tablesUiConfig || null;
        chartsUiConfigCache = data.chartsUiConfig || null;
        insightsVariantsConfigCache = data.insightsVariantsConfig || null;
        var generalDateFormat = normalizeDateLabelFormat(
          kpiUiConfigCache &&
          kpiUiConfigCache.options &&
          kpiUiConfigCache.options.general &&
          kpiUiConfigCache.options.general.dateLabelFormat
        );
        var dateFmtEl = document.getElementById('settings-general-date-format');
        if (dateFmtEl) dateFmtEl.value = generalDateFormat;
        var scopeMode = (data.settingsScopeMode || 'global');
        var scopeGlobal = document.getElementById('settings-scope-global');
        var scopeUser = document.getElementById('settings-scope-user');
        if (scopeGlobal) scopeGlobal.checked = String(scopeMode).toLowerCase() !== 'user';
        if (scopeUser) scopeUser.checked = String(scopeMode).toLowerCase() === 'user';

        var ordSel = document.getElementById('settings-orders-source');
        if (ordSel) ordSel.value = reporting.ordersSource || 'orders_shopify';

        var sessSel = document.getElementById('settings-sessions-source');
        if (sessSel) sessSel.value = reporting.sessionsSource || 'sessions';

        var pxToggle = document.getElementById('settings-pixel-session-mode');
        if (pxToggle) pxToggle.checked = sessionMode === 'shared_ttl';

        document.querySelectorAll('#settings-asset-favicon').forEach(function (el) {
          el.value = overrides.favicon || '';
        });
        document.querySelectorAll('#settings-asset-footer-logo').forEach(function (el) {
          el.value = overrides.footerLogo || overrides.footer_logo || '';
        });
        document.querySelectorAll('#settings-asset-login-logo').forEach(function (el) {
          el.value = overrides.loginLogo || overrides.login_logo || '';
        });
        document.querySelectorAll('#settings-asset-kexo-fullcolor-logo').forEach(function (el) {
          el.value = overrides.kexoLogoFullcolor || overrides.kexo_logo_fullcolor || '';
        });
        // Header logo is stored in Theme defaults; fall back to legacy overrides.logo.
        document.querySelectorAll('#settings-asset-logo').forEach(function (el) {
          el.value = overrides.logo || '';
        });
        try { loadThemeDefaultsAndPopulateAssets(overrides || {}); } catch (_) {}

        try { renderKpisUiPanel(kpiUiConfigCache); } catch (_) {}
        try {
          renderInsightsVariantsPanel(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
        } catch (_) {}
        try {
          if (getActiveSettingsTab() === 'layout') {
            var sub = getActiveLayoutSubTab();
            if (sub === 'tables' || sub === 'charts') renderTablesWhenVisible();
          }
        } catch (_) {}
      })
      .catch(function () { return null; });
  }

  function loadThemeDefaultsAndPopulateAssets(fallbackOverrides) {
    fetch(API + '/api/theme-defaults', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        var headerLogo = (data.theme_header_logo_url != null) ? String(data.theme_header_logo_url).trim() : '';
        if (!headerLogo) {
          var fb = fallbackOverrides && (fallbackOverrides.logo || fallbackOverrides.headerLogo);
          headerLogo = fb != null ? String(fb).trim() : '';
        }
        document.querySelectorAll('#settings-asset-logo').forEach(function (el) {
          el.value = headerLogo || '';
        });
      })
      .catch(function () {});
  }

  function saveSettings(payload) {
    return fetch(API + '/api/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); });
  }

  function saveThemeDefaults(payload) {
    return fetch(API + '/api/theme-defaults', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }).then(function (r) { return r.json(); });
  }

  function wireGeneralSettingsSave() {
    var formatEl = document.getElementById('settings-general-date-format');
    var saveBtn = document.getElementById('settings-general-save-btn');
    var msgEl = document.getElementById('settings-general-msg');
    if (!formatEl || !saveBtn) return;

    function setMsg(text, ok) {
      if (!msgEl) return;
      msgEl.textContent = text || '';
      if (ok === true) msgEl.className = 'form-hint text-success';
      else if (ok === false) msgEl.className = 'form-hint text-danger';
      else msgEl.className = 'form-hint';
    }

    saveBtn.addEventListener('click', function () {
      var nextFormat = normalizeDateLabelFormat(formatEl.value);
      var cfg = deepClone(kpiUiConfigCache || defaultKpiUiConfigV1()) || defaultKpiUiConfigV1();
      if (!cfg.options || typeof cfg.options !== 'object') cfg.options = {};
      if (!cfg.options.general || typeof cfg.options.general !== 'object') cfg.options.general = {};
      cfg.options.general.dateLabelFormat = nextFormat;

      setMsg('Saving…', true);
      saveSettings({ kpiUiConfig: cfg })
        .then(function (r) {
          if (r && r.ok) {
            kpiUiConfigCache = r.kpiUiConfig || cfg;
            var saved = normalizeDateLabelFormat(
              kpiUiConfigCache &&
              kpiUiConfigCache.options &&
              kpiUiConfigCache.options.general &&
              kpiUiConfigCache.options.general.dateLabelFormat
            );
            formatEl.value = saved;
            setMsg('Saved.', true);
            try {
              if (window && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('kexo:kpiUiConfigUpdated', { detail: kpiUiConfigCache }));
              }
            } catch (_) {}
          } else {
            setMsg((r && r.error) ? String(r.error) : 'Save failed', false);
          }
        })
        .catch(function () { setMsg('Save failed', false); });
    });
  }

  function wireDataReporting() {
    var ordSel = document.getElementById('settings-orders-source');
    var sessSel = document.getElementById('settings-sessions-source');
    var pxToggle = document.getElementById('settings-pixel-session-mode');

    function persist() {
      var payload = {
        reporting: {
          ordersSource: ordSel ? ordSel.value : 'orders_shopify',
          sessionsSource: sessSel ? sessSel.value : 'sessions',
        },
      };
      if (pxToggle) {
        payload.pixelSessionMode = pxToggle.checked ? 'shared_ttl' : 'legacy';
      }
      saveSettings(payload).catch(function () {});
    }

    if (ordSel) ordSel.addEventListener('change', persist);
    if (sessSel) sessSel.addEventListener('change', persist);
    if (pxToggle) pxToggle.addEventListener('change', persist);
  }

  function wireAssets() {
    var form = document.getElementById('settings-assets-form');
    if (!form) return;

    function setMsg(text, ok) {
      var msg = document.getElementById('settings-assets-msg');
      if (!msg) return;
      msg.textContent = text || '';
      if (ok === true) msg.className = 'form-hint ms-2 text-success';
      else if (ok === false) msg.className = 'form-hint ms-2 text-danger';
      else msg.className = 'form-hint ms-2 text-secondary';
    }

    function normalizeAssetUrl(value) {
      var raw = value != null ? String(value).trim() : '';
      if (!raw) return '';
      if (raw.length > 2048) return '';
      if (/[<>"'\r\n\t ]/.test(raw)) return '';
      if (/^https?:\/\//i.test(raw)) return raw;
      if (/^\/\//.test(raw)) return raw;
      if (raw.charAt(0) === '/') return raw;
      return '';
    }

    function applyFaviconOverride(url) {
      var safe = normalizeAssetUrl(url);
      try {
        var link = document.querySelector('link[rel="icon"]');
        if (link && safe) link.href = safe;
        else if (link && !safe) link.href = '/assets/logos/new/kexo.webp';
      } catch (_) {}
    }

    function applyHeaderLogoOverride(url) {
      var safe = normalizeAssetUrl(url);
      try { localStorage.setItem('theme-header-logo-url', safe || ''); } catch (_) {}
      try {
        var logos = document.querySelectorAll('.kexo-desktop-brand-link img, .kexo-mobile-logo-link img');
        if (!logos || !logos.length) return;
        logos.forEach(function (img) {
          if (!img) return;
          var original = img.getAttribute('data-kexo-default-src');
          if (!original) {
            original = img.getAttribute('src') || '';
            img.setAttribute('data-kexo-default-src', original);
          }
          img.setAttribute('src', safe || original);
        });
      } catch (_) {}
    }

    function applyFooterLogoOverride(url) {
      var safe = normalizeAssetUrl(url);
      try {
        var imgs = document.querySelectorAll('img[data-kexo-asset="footer-logo"]');
        if (!imgs || !imgs.length) return;
        imgs.forEach(function (img) {
          if (!img) return;
          var original = img.getAttribute('data-kexo-default-src');
          if (!original) {
            original = img.getAttribute('src') || '';
            img.setAttribute('data-kexo-default-src', original);
          }
          img.setAttribute('src', safe || original);
        });
      } catch (_) {}
    }

    function applyKexoFullcolorLogoOverride(url) {
      var safe = normalizeAssetUrl(url);
      try {
        var imgs = document.querySelectorAll('img[src*="/assets/logos/new/kexo.webp"]');
        if (!imgs || !imgs.length) return;
        imgs.forEach(function (img) {
          if (!img) return;
          var original = img.getAttribute('data-kexo-default-src');
          if (!original) {
            original = img.getAttribute('src') || '';
            img.setAttribute('data-kexo-default-src', original);
          }
          img.setAttribute('src', safe || original);
        });
      } catch (_) {}
    }

    function persistThemeHeaderLogo(url, cb) {
      saveThemeDefaults({ theme_header_logo_url: url || '' })
        .then(function (r) {
          if (cb) cb(null, r);
        })
        .catch(function (err) {
          if (cb) cb(err || new Error('Theme save failed'), null);
        });
    }

    function persistAssetOverrides(patch, cb) {
      saveSettings({ assetOverrides: patch || {} })
        .then(function (r) {
          if (cb) cb(null, r);
        })
        .catch(function (err) {
          if (cb) cb(err || new Error('Save failed'), null);
        });
    }

    function persistSlot(slot, url) {
      var safeUrl = normalizeAssetUrl(url);
      if (!safeUrl) {
        setMsg('Upload returned an invalid URL', false);
        return;
      }
      setMsg('Saving…', null);

      if (slot === 'header_logo') {
        persistAssetOverrides({ logo: safeUrl }, function (err1, r1) {
          if (err1 || !(r1 && r1.ok)) {
            setMsg((r1 && r1.error) ? r1.error : 'Save failed', false);
            return;
          }
          persistThemeHeaderLogo(safeUrl, function (err2, r2) {
            if (err2 || !(r2 && r2.ok)) {
              setMsg((r2 && r2.error) ? r2.error : 'Theme save failed', false);
              return;
            }
            applyHeaderLogoOverride(safeUrl);
            setMsg('Uploaded & saved.', true);
          });
        });
        return;
      }

      if (slot === 'sale_sound') {
        var saleMsgEl = document.getElementById('settings-sale-notification-msg');
        if (saleMsgEl) { saleMsgEl.textContent = 'Saving…'; saleMsgEl.className = 'form-hint ms-2 text-secondary'; }
        persistAssetOverrides({ saleSound: safeUrl }, function (err, r) {
          if (saleMsgEl) {
            if (err || !(r && r.ok)) {
              saleMsgEl.textContent = (r && r.error) ? r.error : 'Save failed';
              saleMsgEl.className = 'form-hint ms-2 text-danger';
            } else {
              saleMsgEl.textContent = 'Uploaded & saved.';
              saleMsgEl.className = 'form-hint ms-2 text-success';
              try { window.dispatchEvent(new CustomEvent('kexo:sale-sound-updated', { detail: { url: safeUrl } })); } catch (_) {}
            }
          }
        });
        return;
      }

      var patch = {};
      if (slot === 'favicon') patch.favicon = safeUrl;
      else if (slot === 'footer_logo') patch.footerLogo = safeUrl;
      else if (slot === 'login_logo') patch.loginLogo = safeUrl;
      else if (slot === 'kexo_logo_fullcolor') patch.kexoLogoFullcolor = safeUrl;
      else patch.other = safeUrl;

      persistAssetOverrides(patch, function (err, r) {
        if (err || !(r && r.ok)) {
          setMsg((r && r.error) ? r.error : 'Save failed', false);
          return;
        }
        if (slot === 'favicon') applyFaviconOverride(safeUrl);
        else if (slot === 'footer_logo') applyFooterLogoOverride(safeUrl);
        else if (slot === 'kexo_logo_fullcolor') applyKexoFullcolorLogoOverride(safeUrl);
        setMsg('Uploaded & saved.', true);
      });
    }

    function setMsgForSlot(slot, text, ok) {
      if (slot === 'sale_sound') {
        var el = document.getElementById('settings-sale-notification-msg');
        if (!el) return;
        el.textContent = text || '';
        if (ok === true) el.className = 'form-hint ms-2 text-success';
        else if (ok === false) el.className = 'form-hint ms-2 text-danger';
        else el.className = 'form-hint ms-2 text-secondary';
      } else {
        setMsg(text, ok);
      }
    }

    function wireUploadButtons() {
      document.body.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-kexo-asset-upload="1"]') : null;
        if (!btn) return;
        e.preventDefault();
        var slot = btn.getAttribute('data-kexo-slot') || '';
        var fileId = btn.getAttribute('data-kexo-file') || '';
        var urlId = btn.getAttribute('data-kexo-url') || '';
        var fileEl = fileId ? document.getElementById(fileId) : null;
        var urlEl = urlId ? document.getElementById(urlId) : null;
        var file = fileEl && fileEl.files && fileEl.files[0] ? fileEl.files[0] : null;
        if (!slot) { setMsgForSlot(slot, 'Missing upload slot', false); return; }
        if (!file) { setMsgForSlot(slot, 'Choose a file first', false); return; }

        setMsgForSlot(slot, 'Uploading…', null);
        try { btn.disabled = true; } catch (_) {}

        var fd = new FormData();
        fd.append('file', file);
        fd.append('slot', slot);
        fetch(API + '/api/assets/upload?slot=' + encodeURIComponent(slot), {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        })
          .then(function (r) {
            return r.text().then(function (txt) {
              var data = null;
              try { data = txt ? JSON.parse(txt) : null; } catch (_) {}
              if (!r.ok) {
                var msg = (data && data.error) ? String(data.error) : ('Upload failed (' + String(r.status || 500) + ')');
                throw new Error(msg);
              }
              return data || {};
            });
          })
          .then(function (data) {
            if (!data || !data.ok) {
              throw new Error((data && data.error) ? String(data.error) : 'Upload failed');
            }
            var url = data.url || '';
            if (urlEl) urlEl.value = url;
            try { if (fileEl) fileEl.value = ''; } catch (_) {}
            persistSlot(slot, url);
          })
          .catch(function (err) {
            setMsgForSlot(slot, err && err.message ? String(err.message) : 'Upload failed', false);
          })
          .finally(function () {
            try { btn.disabled = false; } catch (_) {}
          });
      });
    }

    wireUploadButtons();

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var favicon = normalizeAssetUrl((document.getElementById('settings-asset-favicon') || {}).value || '');
      var headerLogo = normalizeAssetUrl((document.getElementById('settings-asset-logo') || {}).value || '');
      var footerLogo = normalizeAssetUrl((document.getElementById('settings-asset-footer-logo') || {}).value || '');
      var loginLogo = normalizeAssetUrl((document.getElementById('settings-asset-login-logo') || {}).value || '');
      var kexoLogoFullcolor = normalizeAssetUrl((document.getElementById('settings-asset-kexo-fullcolor-logo') || {}).value || '');

      setMsg('Saving…', null);

      var assetPatch = {
        favicon: favicon || '',
        logo: headerLogo || '',
        footerLogo: footerLogo || '',
        loginLogo: loginLogo || '',
        kexoLogoFullcolor: kexoLogoFullcolor || '',
      };

      Promise.all([
        saveSettings({ assetOverrides: assetPatch }),
        saveThemeDefaults({ theme_header_logo_url: headerLogo || '' }),
      ])
        .then(function (results) {
          var r1 = results && results[0] ? results[0] : null;
          var r2 = results && results[1] ? results[1] : null;
          var ok = !!(r1 && r1.ok) && !!(r2 && r2.ok);
          if (!ok) {
            var err = (r1 && !r1.ok && r1.error) ? r1.error : ((r2 && !r2.ok && r2.error) ? r2.error : 'Save failed');
            setMsg(err, false);
            return;
          }
          applyFaviconOverride(favicon);
          applyHeaderLogoOverride(headerLogo);
          applyFooterLogoOverride(footerLogo);
          applyKexoFullcolorLogoOverride(kexoLogoFullcolor);
          setMsg('Saved.', true);
        })
        .catch(function () {
          setMsg('Save failed', false);
        });
    });
  }

  // ── Plan-based gating (master vs normal for now) ──────────────────────────
  function wirePlanBasedBrandingLocks() {
    var groups = [
      { urlId: 'settings-asset-favicon', fileId: 'settings-upload-favicon', slot: 'favicon' },
      { urlId: 'settings-asset-logo', fileId: 'settings-upload-header-logo', slot: 'header_logo' },
      { urlId: 'settings-asset-footer-logo', fileId: 'settings-upload-footer-logo', slot: 'footer_logo' },
      { urlId: 'settings-asset-login-logo', fileId: 'settings-upload-login-logo', slot: 'login_logo' },
      { urlId: 'settings-asset-kexo-fullcolor-logo', fileId: 'settings-upload-kexo-fullcolor-logo', slot: 'kexo_logo_fullcolor' },
    ];

    var brandingLocked = null; // null = unknown, boolean afterwards

    function lockGroup(g) {
      var urlEl = document.getElementById(g.urlId);
      if (!urlEl) return;
      var col = urlEl.closest ? (urlEl.closest('.col-12') || urlEl.closest('.col')) : null;
      if (!col) col = urlEl.parentElement;
      if (!col) return;

      try { col.classList.add('kexo-upgrade-locked'); } catch (_) {}
      try { col.setAttribute('data-kexo-upgrade-locked', '1'); } catch (_) {}

      try { urlEl.disabled = true; } catch (_) {}
      var fileEl = document.getElementById(g.fileId);
      if (fileEl) { try { fileEl.disabled = true; } catch (_) {} }

      var btn = document.querySelector('button[data-kexo-asset-upload="1"][data-kexo-slot="' + g.slot + '"]');
      if (btn) {
        try { if (!btn.getAttribute('data-kexo-orig-text')) btn.setAttribute('data-kexo-orig-text', String(btn.textContent || 'Upload')); } catch (_) {}
        try { btn.textContent = 'Upgrade required'; } catch (_) {}
        try { btn.disabled = true; } catch (_) {}
        try {
          btn.classList.remove('btn-outline-primary');
          btn.classList.add('btn-outline-secondary');
        } catch (_) {}
      }

      if (!col.querySelector('.kexo-upgrade-lock-overlay')) {
        var overlay = document.createElement('a');
        overlay.href = '/upgrade';
        overlay.className = 'kexo-upgrade-lock-overlay';
        overlay.setAttribute('role', 'button');
        overlay.setAttribute('aria-label', 'Upgrade required');
        overlay.setAttribute('title', 'Upgrade required');
        overlay.innerHTML = '<span>Upgrade required</span><span class="badge bg-primary-lt">View plans</span>';
        col.appendChild(overlay);
      }
    }

    function unlockGroup(g) {
      var urlEl = document.getElementById(g.urlId);
      if (!urlEl) return;
      var col = urlEl.closest ? (urlEl.closest('.col-12') || urlEl.closest('.col')) : null;
      if (!col) col = urlEl.parentElement;
      if (!col) return;

      try { col.classList.remove('kexo-upgrade-locked'); } catch (_) {}
      try { col.removeAttribute('data-kexo-upgrade-locked'); } catch (_) {}

      try { urlEl.disabled = false; } catch (_) {}
      var fileEl = document.getElementById(g.fileId);
      if (fileEl) { try { fileEl.disabled = false; } catch (_) {} }

      var btn = document.querySelector('button[data-kexo-asset-upload="1"][data-kexo-slot="' + g.slot + '"]');
      if (btn) {
        try {
          var orig = btn.getAttribute('data-kexo-orig-text');
          btn.textContent = orig ? String(orig) : 'Upload';
        } catch (_) { try { btn.textContent = 'Upload'; } catch (_) {} }
        try { btn.disabled = false; } catch (_) {}
        try {
          btn.classList.remove('btn-outline-secondary');
          btn.classList.add('btn-outline-primary');
        } catch (_) {}
      }

      try {
        var overlay = col.querySelector('.kexo-upgrade-lock-overlay');
        if (overlay) overlay.remove();
      } catch (_) {}
    }

    function setLocked(nextLocked) {
      var n = !!nextLocked;
      if (brandingLocked === n) return;
      brandingLocked = n;
      groups.forEach(function (g) {
        if (brandingLocked) lockGroup(g);
        else unlockGroup(g);
      });
      try {
        var msg = document.getElementById('settings-assets-msg');
        if (!msg) return;
        if (brandingLocked) msg.textContent = 'Upgrade required';
        else if (String(msg.textContent || '').trim() === 'Upgrade required') msg.textContent = '';
      } catch (_) {}
    }

    // Intercept Assets form submit only when locked.
    (function wireSubmitGuard() {
      var form = document.getElementById('settings-assets-form');
      if (!form) return;
      if (form.getAttribute('data-kexo-upgrade-lock-wired') === '1') return;
      form.setAttribute('data-kexo-upgrade-lock-wired', '1');
      form.addEventListener('submit', function (e) {
        if (!brandingLocked) return;
        e.preventDefault();
        e.stopPropagation();
        try { window.location.href = '/upgrade'; } catch (_) {}
      }, true);
    })();

    function applyFromViewer(viewer) {
      var isAdmin = !!(viewer && (viewer.isAdmin === true || viewer.isMaster === true));
      setLocked(!isAdmin);
    }

    // Initial: be pessimistic until viewer loads.
    try {
      if (typeof window.__kexoGetEffectiveViewer === 'function') applyFromViewer(window.__kexoGetEffectiveViewer());
      else if (window.__kexoIsMasterUser === true) applyFromViewer({ isAdmin: true, isMaster: true });
      else applyFromViewer({ isAdmin: false, isMaster: false });
    } catch (_) {
      applyFromViewer({ isAdmin: false, isMaster: false });
    }

    window.addEventListener('kexo:viewer-changed', function (ev) {
      try { applyFromViewer(ev && ev.detail ? ev.detail : null); } catch (_) {}
    });
  }

  function defaultKpiUiConfigV1() {
    return {
      v: 1,
      options: {
        condensed: { showDelta: true, showProgress: true, showSparkline: true },
        dashboard: { showDelta: true },
        general: { dateLabelFormat: 'dmy' },
      },
      headerStrip: {
        pages: {
          dashboard: true,
          live: true,
          sales: true,
          date: true,
          countries: true,
          products: true,
          variants: true,
          attribution: true,
          devices: true,
          ads: true,
          'compare-conversion-rate': true,
          'shipping-cr': true,
          settings: false,
        },
      },
      kpis: {
        header: [
          { key: 'orders', label: 'Orders', enabled: true },
          { key: 'revenue', label: 'Revenue', enabled: true },
          { key: 'profit', label: 'Profit', enabled: true },
          { key: 'conv', label: 'Conversion Rate', enabled: true },
          { key: 'vpv', label: 'Value per Visit', enabled: false },
          { key: 'roas', label: 'ADS ROAS', enabled: true },
          { key: 'sessions', label: 'Sessions', enabled: true },
          { key: 'returning', label: 'Returning', enabled: true },
          { key: 'aov', label: 'AOV', enabled: true },
          { key: 'cogs', label: 'COGS', enabled: true },
          { key: 'bounce', label: 'Bounce Rate', enabled: true },
          { key: 'fulfilled', label: 'Fulfilled', enabled: true },
          { key: 'returns', label: 'Returns', enabled: true },
          { key: 'items', label: 'Items ordered', enabled: true },
        ],
        dashboard: [
          { key: 'revenue', label: 'Revenue', enabled: true },
          { key: 'profit', label: 'Profit', enabled: true },
          { key: 'orders', label: 'Orders', enabled: true },
          { key: 'conv', label: 'Conversion Rate', enabled: true },
          { key: 'vpv', label: 'Value per Visit', enabled: false },
          { key: 'aov', label: 'Average Order Value', enabled: true },
          { key: 'sessions', label: 'Sessions', enabled: true },
          { key: 'bounce', label: 'Bounce Rate', enabled: true },
          { key: 'returning', label: 'Returning', enabled: true },
          { key: 'roas', label: 'ADS ROAS', enabled: true },
          { key: 'kexo_score', label: 'Kexo Score', enabled: true },
          { key: 'cogs', label: 'COGS', enabled: true },
          { key: 'fulfilled', label: 'Fulfilled', enabled: true },
          { key: 'returns', label: 'Returns', enabled: true },
          { key: 'items', label: 'Items ordered', enabled: true },
        ],
      },
      dateRanges: [
        { key: 'today', label: 'Today', enabled: true },
        { key: 'yesterday', label: 'Yesterday', enabled: true },
        { key: '7days', label: 'Last 7 days', enabled: true },
        { key: '14days', label: 'Last 14 days', enabled: true },
        { key: '30days', label: 'Last 30 days', enabled: true },
        { key: 'custom', label: 'Custom\u2026', enabled: true },
      ],
    };
  }

  function isProfitKpiGateEnabled() {
    return !!(profitRulesCache && typeof profitRulesCache === 'object' && profitRulesCache.enabled === true);
  }

  function normalizeDateLabelFormat(raw) {
    var key = String(raw || '').trim().toLowerCase();
    return key === 'mdy' ? 'mdy' : 'dmy';
  }

  function defaultChartsUiConfigV1() {
    var baseCharts = [
      { key: 'dash-chart-overview-30d', label: 'Dashboard · 7 Day Overview', enabled: true, mode: 'area', colors: ['#3eb3ab', '#ef4444'], advancedApexOverride: {}, styleOverride: { animations: false } },
      { key: 'dash-chart-finishes-30d', label: 'Dashboard · Finishes (7 Days)', enabled: true, mode: 'radialbar', colors: ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab'], advancedApexOverride: {}, styleOverride: { animations: false } },
      { key: 'dash-chart-devices-30d', label: 'Dashboard · Devices (7 Days)', enabled: true, mode: 'bar-horizontal', colors: ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'], advancedApexOverride: {}, styleOverride: { animations: false } },
      { key: 'dash-chart-attribution-30d', label: 'Dashboard · Attribution (7 Days)', enabled: true, mode: 'donut', colors: ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'], advancedApexOverride: {}, styleOverride: { animations: false, pieDonut: true, pieDonutSize: 64, pieLabelPosition: 'outside', pieLabelContent: 'label', pieLabelOffset: 18 } },
      { key: 'live-online-chart', label: 'Dashboard · Live Online', enabled: true, mode: 'map-flat', colors: ['#16a34a'], advancedApexOverride: {} },
      { key: 'sales-overview-chart', label: 'Dashboard · Sales Trend', enabled: true, mode: 'area', colors: ['#0d9488'], advancedApexOverride: {} },
      { key: 'date-overview-chart', label: 'Dashboard · Sessions & Orders Trend', enabled: true, mode: 'area', colors: ['#4b94e4', '#f59e34'], advancedApexOverride: {} },
      { key: 'ads-overview-chart', label: 'Integrations · Google Ads Overview', enabled: true, mode: 'bar', colors: ['#22c55e', '#ef4444', '#4b94e4'], advancedApexOverride: {} },
      { key: 'attribution-chart', label: 'Acquisition · Attribution', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions', advancedApexOverride: {} },
      { key: 'devices-chart', label: 'Acquisition · Devices', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions', advancedApexOverride: {} },
      { key: 'products-chart', label: 'Insights · Products', enabled: true, mode: 'line', colors: ['#3eb3ab', '#4b94e4', '#f59e34', '#8b5cf6', '#ef4444', '#22c55e'], advancedApexOverride: {} },
      { key: 'abandoned-carts-chart', label: 'Insights · Abandoned Carts', enabled: true, mode: 'line', colors: ['#ef4444'], advancedApexOverride: {} },
      { key: 'countries-map-chart', label: 'Insights · Countries Map', enabled: true, mode: 'map-flat', colors: ['#3eb3ab'], advancedApexOverride: {} },
    ].map(function (it) {
      var row = Object.assign({}, it);
      row.style = Object.assign(defaultChartStyleConfig(), it.styleOverride && typeof it.styleOverride === 'object' ? it.styleOverride : {});
      delete row.styleOverride;
      return row;
    });
    return {
      v: 1,
      defaultsVersion: 2,
      hideOnMobile: false,
      // User-managed chart + KPI bundle config source of truth.
      // Runtime reads this payload; avoid adding hardcoded style overrides elsewhere.
      charts: baseCharts,
      kpiBundles: {
        dashboardCards: {
          sparkline: { mode: 'line', curve: 'straight', strokeWidth: 2.55, height: 50, showCompare: true, compareUsePrimaryColor: false, compareOpacity: 50, advancedApexOverride: {} },
          deltaStyle: { fontSize: 14, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' },
          palette: { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' },
        },
        headerStrip: {
          sparkline: { mode: 'line', curve: 'smooth', strokeWidth: 2.15, height: 30, showCompare: false, advancedApexOverride: {} },
          deltaStyle: { fontSize: 11, fontWeight: 500, iconSize: 10, fontColor: '', iconColor: '' },
          palette: { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' },
        },
        yearlySnapshot: {
          sparkline: { mode: 'line', curve: 'smooth', strokeWidth: 2.55, height: 56, showCompare: false, advancedApexOverride: {} },
          deltaStyle: { fontSize: 12, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' },
          palette: { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' },
        }
      }
    };
  }

  function defaultTablesUiConfigV1() {
    return {
      v: 1,
      pages: [
        {
          key: 'dashboard',
          label: 'Dashboard · Overview',
          tables: [
            { id: 'dash-top-products', name: 'Top Products', tableClass: 'dashboard', zone: 'dashboard-top-products', order: 1, inGrid: true, rows: { default: 5, options: [5] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'dash-top-countries', name: 'Top Countries', tableClass: 'dashboard', zone: 'dashboard-top-countries', order: 2, inGrid: true, rows: { default: 5, options: [5] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'dash-trending-up', name: 'Trending Up', tableClass: 'dashboard', zone: 'dashboard-trending-up', order: 3, inGrid: true, rows: { default: 5, options: [5] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'dash-trending-down', name: 'Trending Down', tableClass: 'dashboard', zone: 'dashboard-trending-down', order: 4, inGrid: true, rows: { default: 5, options: [5] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'live',
          label: 'Dashboard · Live View',
          tables: [
            { id: 'latest-sales-table', name: 'Latest sales', tableClass: 'dashboard', zone: 'live-latest-sales', order: 1, inGrid: true, rows: { default: 5, options: [5] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'sessions-table', name: 'Sessions', tableClass: 'live', zone: 'live-sessions', order: 2, inGrid: false, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'sales',
          label: 'Dashboard · Recent Sales',
          tables: [
            { id: 'sessions-table', name: 'Sessions', tableClass: 'live', zone: 'sales-sessions', order: 1, inGrid: false, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'date',
          label: 'Dashboard · Table View',
          tables: [
            { id: 'sessions-table', name: 'Sessions', tableClass: 'live', zone: 'date-sessions', order: 1, inGrid: false, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'countries',
          label: 'Insights · Countries',
          tables: [
            { id: 'country-table', name: 'Country', tableClass: 'live', zone: 'countries-main', order: 1, inGrid: true, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'best-geo-products-table', name: 'Country + Product', tableClass: 'live', zone: 'countries-products', order: 2, inGrid: true, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'products',
          label: 'Insights · Products',
          tables: [
            { id: 'best-sellers-table', name: 'Best Sellers', tableClass: 'product', zone: 'products-best-sellers', order: 1, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'best-variants-table', name: 'Variant', tableClass: 'product', zone: 'products-best-variants', order: 2, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'type-necklaces-table', name: 'Necklaces', tableClass: 'product', zone: 'products-type-necklaces', order: 3, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'type-bracelets-table', name: 'Bracelets', tableClass: 'product', zone: 'products-type-bracelets', order: 4, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'type-earrings-table', name: 'Earrings', tableClass: 'product', zone: 'products-type-earrings', order: 5, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'type-sets-table', name: 'Jewelry Sets', tableClass: 'product', zone: 'products-type-sets', order: 6, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'type-charms-table', name: 'Charms', tableClass: 'product', zone: 'products-type-charms', order: 7, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'type-extras-table', name: 'Extras', tableClass: 'product', zone: 'products-type-extras', order: 8, inGrid: true, rows: { default: 10, options: [10, 15, 20] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'variants',
          label: 'Insights · Variants',
          tables: [
            { id: 'insights-variants-tables', name: 'Variant tables', tableClass: 'product', zone: 'variants-insights', order: 1, inGrid: true, rows: { default: 5, options: [5, 10] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'attribution',
          label: 'Acquisition · Attribution',
          tables: [
            { id: 'attribution-table', name: 'Attribution', tableClass: 'live', zone: 'attribution-main', order: 1, inGrid: false, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'devices',
          label: 'Acquisition · Devices',
          tables: [
            { id: 'devices-table', name: 'Devices', tableClass: 'live', zone: 'devices-main', order: 1, inGrid: false, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
        {
          key: 'ads',
          label: 'Integrations · Google Ads',
          tables: [
            { id: 'ads-root', name: 'Google Ads', tableClass: 'live', zone: 'ads-main', order: 1, inGrid: false, rows: { default: 20, options: [20, 30, 40, 50] }, sticky: { minWidth: null, maxWidth: null } },
          ],
        },
      ],
    };
  }

  var CHART_MODE_LABEL = (typeof window.KEXO_CHART_MODE_LABEL === 'object' && window.KEXO_CHART_MODE_LABEL) || {};

  var CHARTS_GROUPS = [
    { id: 'dashboard', label: 'Dashboard charts', keys: ['dash-chart-overview-30d', 'dash-chart-finishes-30d', 'dash-chart-devices-30d', 'dash-chart-attribution-30d', 'live-online-chart', 'sales-overview-chart', 'date-overview-chart'] },
    { id: 'acquisition', label: 'Acquisition charts', keys: ['attribution-chart', 'devices-chart'] },
    { id: 'insights', label: 'Insights charts', keys: ['products-chart', 'abandoned-carts-chart', 'countries-map-chart'] },
    { id: 'integrations', label: 'Integration charts', keys: ['ads-overview-chart'] },
  ];
  var KPI_BUNDLE_ORDER = ['dashboardCards', 'headerStrip', 'yearlySnapshot'];
  var KPI_BUNDLE_META = {
    dashboardCards: { label: 'KPI Bundle · Dashboard Cards', help: 'Applies to KPI cards on /dashboard/overview.', supportsCompare: true },
    headerStrip: { label: 'KPI Bundle · Header Strip (top of pages)', help: 'Applies to compact KPI chips shown at the top of pages.', supportsCompare: false },
    yearlySnapshot: { label: 'KPI Bundle · Snapshot Page', help: 'Applies to KPI cards/chips rendered on /insights/snapshot.', supportsCompare: false },
  };

  function chartMeta(key) {
    return (typeof window.kexoChartMeta === 'function' ? window.kexoChartMeta(key) : null) || { modes: ['line', 'area'], series: [] };
  }

  function selectOptionsHtml(modes, selected) {
    var sel = String(selected || '').trim().toLowerCase();
    var opts = Array.isArray(modes) ? modes : [];
    return opts.map(function (m) {
      var val = String(m || '').trim().toLowerCase();
      if (!val) return '';
      var label = CHART_MODE_LABEL[val] || val;
      return '<option value="' + escapeHtml(val) + '"' + (val === sel ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
    }).join('');
  }

  function normalizeHexColor(value, fallback) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(raw) ? raw : fallback;
  }

  function normalizeOptionalHexColor(value) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    if (!raw) return '';
    return /^#[0-9a-f]{6}$/.test(raw) ? raw : '';
  }

  function safeNumber(value, fallback, min, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = Number(fallback);
    if (!Number.isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }

  function defaultChartStyleConfig() {
    return {
      curve: 'smooth',
      strokeWidth: 2.6,
      dashArray: 0,
      markerSize: 3,
      fillOpacity: 0.18,
      gridDash: 3,
      dataLabels: 'auto',
      toolbar: false,
      animations: true,
      pieDonut: false,
      pieDonutSize: 66,
      pieLabelPosition: 'auto',
      pieLabelContent: 'percent',
      pieLabelOffset: 16,
      pieCountryFlags: false,
      mapShowTooltip: true,
      mapDraggable: true,
      mapZoomButtons: false,
      mapShowEmptyCaption: true,
      mapMetric: 'auto',
    };
  }

  function normalizeChartStyleDraft(raw, fallback) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var def = fallback && typeof fallback === 'object' ? fallback : defaultChartStyleConfig();
    var curve = String(src.curve != null ? src.curve : def.curve).trim().toLowerCase();
    if (['smooth', 'straight', 'stepline'].indexOf(curve) < 0) curve = def.curve;
    var labelsMode = String(src.dataLabels != null ? src.dataLabels : def.dataLabels).trim().toLowerCase();
    if (labelsMode !== 'on' && labelsMode !== 'off' && labelsMode !== 'auto') labelsMode = def.dataLabels;
    var pieLabelPosition = String(src.pieLabelPosition != null ? src.pieLabelPosition : def.pieLabelPosition).trim().toLowerCase();
    if (['auto', 'inside', 'outside'].indexOf(pieLabelPosition) < 0) pieLabelPosition = def.pieLabelPosition || 'auto';
    var pieLabelContent = String(src.pieLabelContent != null ? src.pieLabelContent : def.pieLabelContent).trim().toLowerCase();
    if (['percent', 'label', 'label_percent'].indexOf(pieLabelContent) < 0) pieLabelContent = def.pieLabelContent || 'percent';
    return {
      curve: curve,
      strokeWidth: safeNumber(src.strokeWidth, def.strokeWidth, 0, 8),
      dashArray: safeNumber(src.dashArray, def.dashArray, 0, 20),
      markerSize: safeNumber(src.markerSize, def.markerSize, 0, 12),
      fillOpacity: safeNumber(src.fillOpacity, def.fillOpacity, 0, 1),
      gridDash: safeNumber(src.gridDash, def.gridDash, 0, 16),
      dataLabels: labelsMode,
      toolbar: !!(src.toolbar === true || (src.toolbar == null && def.toolbar)),
      animations: !(src.animations === false),
      pieDonut: !!(src.pieDonut === true || (src.pieDonut == null && def.pieDonut)),
      pieDonutSize: Math.round(safeNumber(src.pieDonutSize, def.pieDonutSize, 30, 90)),
      pieLabelPosition: pieLabelPosition,
      pieLabelContent: pieLabelContent,
      pieLabelOffset: Math.round(safeNumber(src.pieLabelOffset, def.pieLabelOffset, -40, 40)),
      pieCountryFlags: !!(src.pieCountryFlags === true || (src.pieCountryFlags == null && def.pieCountryFlags)),
      mapShowTooltip: src.mapShowTooltip !== false,
      mapDraggable: src.mapDraggable !== false,
      mapZoomButtons: !!(src.mapZoomButtons === true),
      mapShowEmptyCaption: src.mapShowEmptyCaption !== false,
      mapMetric: ['auto', 'revenue', 'orders'].indexOf(String(src.mapMetric != null ? src.mapMetric : def.mapMetric).trim().toLowerCase()) >= 0
        ? String(src.mapMetric != null ? src.mapMetric : def.mapMetric).trim().toLowerCase()
        : 'auto',
    };
  }

  function defaultKpiBundlePalette() {
    return { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' };
  }

  function defaultKpiBundleSparkline(bundleKey) {
    if (bundleKey === 'headerStrip') return { mode: 'line', curve: 'smooth', strokeWidth: 2.15, height: 30, showCompare: false, advancedApexOverride: {} };
    if (bundleKey === 'yearlySnapshot') return { mode: 'line', curve: 'smooth', strokeWidth: 2.55, height: 56, showCompare: false, advancedApexOverride: {} };
    return { mode: 'line', curve: 'straight', strokeWidth: 2.55, height: 50, showCompare: true, compareUsePrimaryColor: false, compareOpacity: 50, advancedApexOverride: {} };
  }

  function defaultKpiBundleDeltaStyle(bundleKey) {
    if (bundleKey === 'headerStrip') return { fontSize: 11, fontWeight: 500, iconSize: 10, fontColor: '', iconColor: '' };
    if (bundleKey === 'yearlySnapshot') return { fontSize: 12, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' };
    return { fontSize: 14, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' };
  }

  function defaultKpiBundle(bundleKey) {
    return {
      sparkline: defaultKpiBundleSparkline(bundleKey),
      deltaStyle: defaultKpiBundleDeltaStyle(bundleKey),
      palette: defaultKpiBundlePalette(),
    };
  }

  function parseApexOverride(raw, fallbackObj) {
    var fb = (fallbackObj && typeof fallbackObj === 'object' && !Array.isArray(fallbackObj)) ? fallbackObj : {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
    var text = raw == null ? '' : String(raw).trim();
    if (!text) return fb;
    try {
      var parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return fb;
  }

  function prettyJson(value) {
    try {
      var obj = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
      return JSON.stringify(obj, null, 2) || '{}';
    } catch (_) { return '{}'; }
  }

  function normalizeBundleDraft(bundleKey, raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var def = defaultKpiBundle(bundleKey);
    var spark = src.sparkline && typeof src.sparkline === 'object' ? src.sparkline : {};
    var delta = src.deltaStyle && typeof src.deltaStyle === 'object' ? src.deltaStyle : {};
    var palette = src.palette && typeof src.palette === 'object' ? src.palette : {};
    var mode = String(spark.mode || def.sparkline.mode).trim().toLowerCase();
    if (['line', 'area', 'bar'].indexOf(mode) < 0) mode = def.sparkline.mode;
    var curve = String(spark.curve || def.sparkline.curve).trim().toLowerCase();
    if (['smooth', 'straight', 'stepline'].indexOf(curve) < 0) curve = def.sparkline.curve;
    var fontWeight = parseInt(String(delta.fontWeight != null ? delta.fontWeight : def.deltaStyle.fontWeight), 10);
    if (fontWeight !== 400 && fontWeight !== 500) fontWeight = def.deltaStyle.fontWeight;
    var supportsCompare = !!(KPI_BUNDLE_META[bundleKey] && KPI_BUNDLE_META[bundleKey].supportsCompare);
    return {
      sparkline: {
        mode: mode,
        curve: curve,
        strokeWidth: safeNumber(spark.strokeWidth, def.sparkline.strokeWidth, 0.5, 6),
        height: Math.round(safeNumber(spark.height, def.sparkline.height, 18, 120)),
        showCompare: supportsCompare ? !(spark.showCompare === false) : false,
        compareUsePrimaryColor: supportsCompare ? (spark.compareUsePrimaryColor !== false) : false,
        compareOpacity: Math.round(safeNumber(spark.compareOpacity, 50, 0, 100)),
        advancedApexOverride: parseApexOverride(spark.advancedApexOverride, def.sparkline.advancedApexOverride),
      },
      deltaStyle: {
        fontSize: Math.round(safeNumber(delta.fontSize, def.deltaStyle.fontSize, 9, 24)),
        fontWeight: fontWeight,
        iconSize: Math.round(safeNumber(delta.iconSize, def.deltaStyle.iconSize, 8, 24)),
        fontColor: normalizeOptionalHexColor(delta.fontColor || ''),
        iconColor: normalizeOptionalHexColor(delta.iconColor || ''),
      },
      palette: {
        up: normalizeHexColor(palette.up, def.palette.up),
        down: normalizeHexColor(palette.down, def.palette.down),
        same: normalizeHexColor(palette.same, def.palette.same),
        compareLine: normalizeHexColor(palette.compareLine, def.palette.compareLine),
      },
    };
  }

  function normalizeChartsUiConfigDraft(cfg) {
    var def = defaultChartsUiConfigV1();
    var src = cfg && typeof cfg === 'object' ? cfg : {};
    var dv = parseInt(String(src.defaultsVersion != null ? src.defaultsVersion : ''), 10);
    if (!(dv >= 0)) dv = 0;
    if (dv < 2) dv = 2;
    var out = { v: 1, defaultsVersion: dv, hideOnMobile: !(src.hideOnMobile === false), charts: [], kpiBundles: {} };
    var incomingByKey = {};
    (Array.isArray(src.charts) ? src.charts : []).forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var key = String(it.key || '').trim().toLowerCase();
      if (!key) return;
      incomingByKey[key] = it;
    });
    (def.charts || []).forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      var key = String(d.key || '').trim().toLowerCase();
      if (!key) return;
      var it = incomingByKey[key] || {};
      var meta = chartMeta(key);
      var mode = String(it.mode || d.mode || '').trim().toLowerCase();
      var modes = meta && Array.isArray(meta.modes) ? meta.modes : ['line'];
      if (modes.indexOf(mode) < 0) mode = String(d.mode || modes[0] || 'line').trim().toLowerCase();
      var colors = Array.isArray(it.colors) ? it.colors : d.colors;
      colors = (Array.isArray(colors) ? colors : []).slice(0, 6).map(function (c) { return normalizeHexColor(c, '#3eb3ab'); });
      if (!colors.length) colors = (Array.isArray(d.colors) ? d.colors : ['#3eb3ab']).slice(0, 6);
      var row = {
        key: key,
        enabled: !(it.enabled === false),
        label: String(it.label || d.label || key).trim() || key,
        mode: mode,
        colors: colors,
        style: normalizeChartStyleDraft(it.style, d.style || defaultChartStyleConfig()),
        advancedApexOverride: parseApexOverride(it.advancedApexOverride, d.advancedApexOverride || {}),
      };
      if (meta && meta.pieMetric) {
        var pieMetric = String(it.pieMetric || d.pieMetric || 'sessions').trim().toLowerCase();
        if (['sessions', 'orders', 'revenue'].indexOf(pieMetric) < 0) pieMetric = 'sessions';
        row.pieMetric = pieMetric;
      }
      out.charts.push(row);
    });
    var srcBundles = src.kpiBundles && typeof src.kpiBundles === 'object' ? src.kpiBundles : {};
    KPI_BUNDLE_ORDER.forEach(function (bundleKey) {
      out.kpiBundles[bundleKey] = normalizeBundleDraft(bundleKey, srcBundles[bundleKey]);
    });
    return out;
  }

  function chartColorCount(meta, item) {
    var seriesLen = meta && Array.isArray(meta.series) ? meta.series.length : 0;
    var colorLen = item && Array.isArray(item.colors) ? item.colors.length : 0;
    return Math.max(1, Math.min(6, Math.max(seriesLen, colorLen, 1)));
  }

  function renderChartColorInputs(item, meta) {
    var colors = Array.isArray(item.colors) ? item.colors : [];
    var series = meta && Array.isArray(meta.series) ? meta.series : [];
    var count = chartColorCount(meta, item);
    var html = '<div class="settings-charts-color-grid">';
    for (var i = 0; i < count; i += 1) {
      var label = String(i + 1);
      var val = normalizeHexColor(colors[i], '#3eb3ab');
      html += '<label class="settings-charts-color-field"><span class="form-label mb-1">' + escapeHtml(label) + '</span><div class="settings-charts-color-field-row"><input type="text" class="form-control form-control-sm" data-chart-field="color" data-idx="' + i + '" value="' + escapeHtml(val) + '" placeholder="#3eb3ab"></div><span class="settings-charts-color-swatch" data-color-swatch style="background:' + escapeHtml(val) + ';" title="' + escapeHtml(val) + '" aria-hidden="true"></span></label>';
    }
    html += '</div>';
    return html;
  }

  function renderBundleColorInput(field, value, labelText) {
    var val = normalizeHexColor(value, '#2fb344');
    return '<label class="settings-charts-color-field"><span class="form-label mb-1">' + escapeHtml(labelText) + '</span><div class="settings-charts-color-field-row"><input type="text" class="form-control form-control-sm" data-bundle-field="' + escapeHtml(field) + '" value="' + escapeHtml(val) + '" placeholder="#2fb344"></div><span class="settings-charts-color-swatch" data-color-swatch style="background:' + escapeHtml(val) + ';" aria-hidden="true"></span></label>';
  }

  function renderChartAccordionItem(item, idx, accordionId) {
    var key = String(item && item.key || '').trim().toLowerCase();
    if (!key) return '';
    var meta = chartMeta(key);
    var title = item && item.label ? String(item.label) : key;
    var mode = item && item.mode ? String(item.mode).trim().toLowerCase() : 'line';
    var modes = meta && Array.isArray(meta.modes) ? meta.modes : ['line'];
    if (modes.indexOf(mode) < 0) mode = modes[0] || 'line';
    var enabled = !(item && item.enabled === false);
    var pieMetric = item && item.pieMetric ? String(item.pieMetric).trim().toLowerCase() : 'sessions';
    var canPie = !!(meta && meta.pieMetric);
    var supportsPie = modes.indexOf('pie') >= 0 || mode === 'pie';
    var isCountriesOverview = key === 'dash-chart-countries-30d';
    var style = normalizeChartStyleDraft(item && item.style, defaultChartStyleConfig());
    var collapseId = 'settings-chart-item-' + key.replace(/[^a-z0-9_-]/g, '-');
    var headingId = collapseId + '-heading';
    var isOpen = idx === 0;

    var cardBodyContent;
    if (typeof window.KexoLayoutShortcuts !== 'undefined' && window.KexoLayoutShortcuts.renderChartModalBody) {
      var sharedRow = window.KexoLayoutShortcuts.renderChartModalBody(item, key);
      var previewHtml = '<div class="col-12"><div class="settings-charts-preview-wrap"><div class="text-muted small mb-2">Preview</div><div class="settings-charts-preview-canvas" data-chart-preview-canvas></div></div></div>';
      cardBodyContent = sharedRow.slice(0, sharedRow.length - 6) + previewHtml + '</div>';
    } else {
      cardBodyContent = '<div class="row g-3">' +
        '<div class="col-12 col-lg-4"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="enabled"' + (enabled ? ' checked' : '') + '><span class="form-check-label ms-2">Enabled</span></label></div>' +
        '<div class="col-12 col-lg-8"><label class="form-label mb-1">Display name</label><input type="text" class="form-control form-control-sm" data-chart-field="label" value="' + escapeHtml(title) + '"></div>' +
        '<div class="col-12 col-md-6 col-xl-4"><label class="form-label mb-1">Chart type</label><select class="form-select form-select-sm" data-chart-field="mode">' + selectOptionsHtml(modes, mode) + '</select></div>' +
        '<div class="col-12 col-md-6 col-xl-4"><label class="form-label mb-1">Pie metric</label><select class="form-select form-select-sm" data-chart-field="pieMetric"' + (canPie ? '' : ' disabled') + '><option value="sessions"' + (pieMetric === 'sessions' ? ' selected' : '') + '>Sessions</option><option value="orders"' + (pieMetric === 'orders' ? ' selected' : '') + '>Orders</option><option value="revenue"' + (pieMetric === 'revenue' ? ' selected' : '') + '>Revenue</option></select></div>' +
        '<div class="col-12"><label class="form-label mb-1">Chart style (quick controls)</label><div class="row g-2">' +
          '<div class="col-6 col-lg-4 col-xl-3"><label class="form-label mb-1">Curve</label><select class="form-select form-select-sm" data-chart-field="style.curve"><option value="smooth"' + (style.curve === 'smooth' ? ' selected' : '') + '>Smooth</option><option value="straight"' + (style.curve === 'straight' ? ' selected' : '') + '>Straight</option><option value="stepline"' + (style.curve === 'stepline' ? ' selected' : '') + '>Stepline</option></select></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Stroke</label><input type="number" class="form-control form-control-sm" min="0" max="8" step="0.1" data-chart-field="style.strokeWidth" value="' + escapeHtml(String(style.strokeWidth)) + '"></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Dash</label><input type="number" class="form-control form-control-sm" min="0" max="20" step="1" data-chart-field="style.dashArray" value="' + escapeHtml(String(style.dashArray)) + '"></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Markers</label><input type="number" class="form-control form-control-sm" min="0" max="12" step="1" data-chart-field="style.markerSize" value="' + escapeHtml(String(style.markerSize)) + '"></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Fill opacity</label><input type="number" class="form-control form-control-sm" min="0" max="1" step="0.05" data-chart-field="style.fillOpacity" value="' + escapeHtml(String(style.fillOpacity)) + '"></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Grid dash</label><input type="number" class="form-control form-control-sm" min="0" max="16" step="1" data-chart-field="style.gridDash" value="' + escapeHtml(String(style.gridDash)) + '"></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Labels</label><select class="form-select form-select-sm" data-chart-field="style.dataLabels"><option value="auto"' + (style.dataLabels === 'auto' ? ' selected' : '') + '>Auto</option><option value="on"' + (style.dataLabels === 'on' ? ' selected' : '') + '>On</option><option value="off"' + (style.dataLabels === 'off' ? ' selected' : '') + '>Off</option></select></div>' +
          '<div class="col-6 col-lg-4 col-xl-2 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.toolbar"' + (style.toolbar ? ' checked' : '') + '><span class="form-check-label ms-2">Toolbar</span></label></div>' +
          '<div class="col-6 col-lg-4 col-xl-2 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.animations"' + (style.animations ? ' checked' : '') + '><span class="form-check-label ms-2">Animations</span></label></div>' +
        '</div></div>' +
        '<div class="col-12"><label class="form-label mb-1">Pie / donut controls</label><div class="row g-2">' +
          '<div class="col-6 col-lg-4 col-xl-2 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.pieDonut"' + (style.pieDonut ? ' checked' : '') + (supportsPie ? '' : ' disabled') + '><span class="form-check-label ms-2">Hollow donut</span></label></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Donut size (%)</label><input type="number" class="form-control form-control-sm" min="30" max="90" step="1" data-chart-field="style.pieDonutSize" value="' + escapeHtml(String(style.pieDonutSize)) + '"' + (supportsPie ? '' : ' disabled') + '></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Label position</label><select class="form-select form-select-sm" data-chart-field="style.pieLabelPosition"' + (supportsPie ? '' : ' disabled') + '><option value="auto"' + (style.pieLabelPosition === 'auto' ? ' selected' : '') + '>Auto</option><option value="inside"' + (style.pieLabelPosition === 'inside' ? ' selected' : '') + '>Inside</option><option value="outside"' + (style.pieLabelPosition === 'outside' ? ' selected' : '') + '>Outside</option></select></div>' +
          '<div class="col-6 col-lg-4 col-xl-3"><label class="form-label mb-1">Label content</label><select class="form-select form-select-sm" data-chart-field="style.pieLabelContent"' + (supportsPie ? '' : ' disabled') + '><option value="percent"' + (style.pieLabelContent === 'percent' ? ' selected' : '') + '>Percent</option><option value="label"' + (style.pieLabelContent === 'label' ? ' selected' : '') + '>Label</option><option value="label_percent"' + (style.pieLabelContent === 'label_percent' ? ' selected' : '') + '>Label + percent</option></select></div>' +
          '<div class="col-6 col-lg-4 col-xl-2"><label class="form-label mb-1">Label offset</label><input type="number" class="form-control form-control-sm" min="-40" max="40" step="1" data-chart-field="style.pieLabelOffset" value="' + escapeHtml(String(style.pieLabelOffset)) + '"' + (supportsPie ? '' : ' disabled') + '></div>' +
          (isCountriesOverview ? '<div class="col-12 col-md-6 col-xl-3 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-chart-field="style.pieCountryFlags"' + (style.pieCountryFlags ? ' checked' : '') + '><span class="form-check-label ms-2">Country flags in labels</span></label></div>' : '') +
        '</div></div>' +
        '<div class="col-12"><label class="form-label mb-1">Series colors (hex)</label>' + renderChartColorInputs(item, meta) + '</div>' +
        '<div class="col-12"><label class="form-label mb-1">Advanced Apex override (JSON)</label><textarea class="form-control form-control-sm settings-charts-advanced-json" rows="5" data-chart-field="advancedApexOverride" spellcheck="false">' + escapeHtml(prettyJson(item && item.advancedApexOverride)) + '</textarea></div>' +
        '<div class="col-12"><div class="settings-charts-preview-wrap"><div class="text-muted small mb-2">Preview</div><div class="settings-charts-preview-canvas" data-chart-preview-canvas></div></div></div>' +
      '</div>';
    }

    return '<div class="accordion-item settings-charts-item" data-chart-config-key="' + escapeHtml(key) + '">' +
      '<h2 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
        '<button class="accordion-button' + (isOpen ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + escapeHtml(collapseId) + '">' +
          '<span class="d-flex align-items-center w-100 gap-2"><span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span><span class="me-auto">' + escapeHtml(title) + '</span><span class="text-muted small"><code>' + escapeHtml(key) + '</code></span></span>' +
        '</button>' +
      '</h2>' +
      '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse' + (isOpen ? ' show' : '') + '" aria-labelledby="' + escapeHtml(headingId) + '" data-bs-parent="#' + escapeHtml(accordionId) + '">' +
        '<div class="accordion-body"><div class="settings-charts-card-body">' + cardBodyContent + '</div></div>' +
      '</div>' +
    '</div>';
  }

  function renderBundleAccordionItem(bundleKey, bundleCfg, idx, accordionId) {
    var meta = KPI_BUNDLE_META[bundleKey] || { label: bundleKey, help: '', supportsCompare: false };
    var spark = bundleCfg && bundleCfg.sparkline ? bundleCfg.sparkline : defaultKpiBundleSparkline(bundleKey);
    var delta = bundleCfg && bundleCfg.deltaStyle ? bundleCfg.deltaStyle : defaultKpiBundleDeltaStyle(bundleKey);
    var palette = bundleCfg && bundleCfg.palette ? bundleCfg.palette : defaultKpiBundlePalette();
    var collapseId = 'settings-chart-bundle-' + String(bundleKey).replace(/[^a-z0-9_-]/g, '-');
    var headingId = collapseId + '-heading';
    var isOpen = idx === 0;
    return '<div class="accordion-item settings-charts-item" data-kpi-bundle-key="' + escapeHtml(bundleKey) + '">' +
      '<h2 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
        '<button class="accordion-button' + (isOpen ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + escapeHtml(collapseId) + '">' +
          '<span class="d-flex align-items-center w-100 gap-2"><span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span><span class="me-auto">' + escapeHtml(meta.label) + '</span><span class="text-muted small"><code>' + escapeHtml(bundleKey) + '</code></span></span>' +
        '</button>' +
      '</h2>' +
      '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse' + (isOpen ? ' show' : '') + '" aria-labelledby="' + escapeHtml(headingId) + '" data-bs-parent="#' + escapeHtml(accordionId) + '">' +
        '<div class="accordion-body"><div class="settings-charts-card-body"><div class="text-muted small mb-3">' + escapeHtml(meta.help || '') + '</div><div class="row g-3">' +
          '<div class="col-12 col-md-6 col-xl-3"><label class="form-label mb-1">Sparkline type</label><select class="form-select form-select-sm" data-bundle-field="sparkline.mode"><option value="line"' + (String(spark.mode) === 'line' ? ' selected' : '') + '>Line</option><option value="area"' + (String(spark.mode) === 'area' ? ' selected' : '') + '>Area</option><option value="bar"' + (String(spark.mode) === 'bar' ? ' selected' : '') + '>Bar</option></select></div>' +
          '<div class="col-12 col-md-6 col-xl-3"><label class="form-label mb-1">Curve</label><select class="form-select form-select-sm" data-bundle-field="sparkline.curve"><option value="straight"' + (String(spark.curve) === 'straight' ? ' selected' : '') + '>Straight</option><option value="smooth"' + (String(spark.curve) === 'smooth' ? ' selected' : '') + '>Smooth</option><option value="stepline"' + (String(spark.curve) === 'stepline' ? ' selected' : '') + '>Stepline</option></select></div>' +
          '<div class="col-12 col-md-6 col-xl-2"><label class="form-label mb-1">Height</label><input type="number" class="form-control form-control-sm" min="18" max="120" step="1" data-bundle-field="sparkline.height" value="' + escapeHtml(String(spark.height)) + '"></div>' +
          '<div class="col-12 col-md-6 col-xl-2"><label class="form-label mb-1">Stroke width</label><input type="number" class="form-control form-control-sm" min="0.5" max="6" step="0.05" data-bundle-field="sparkline.strokeWidth" value="' + escapeHtml(String(spark.strokeWidth)) + '"></div>' +
          '<div class="col-12 col-xl-2 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-bundle-field="sparkline.showCompare"' + (spark.showCompare ? ' checked' : '') + (meta.supportsCompare ? '' : ' disabled') + '><span class="form-check-label ms-2">Compare line</span></label></div>' +
          (meta.supportsCompare ? '<div class="col-12 col-md-6 col-xl-3 d-flex align-items-end"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-bundle-field="sparkline.compareUsePrimaryColor"' + (spark.compareUsePrimaryColor !== false ? ' checked' : '') + '><span class="form-check-label ms-2">Use primary color at opacity</span></label></div><div class="col-12 col-md-6 col-xl-2"><label class="form-label mb-1">Compare opacity (%)</label><input type="number" class="form-control form-control-sm" min="0" max="100" step="1" data-bundle-field="sparkline.compareOpacity" value="' + escapeHtml(String(spark.compareOpacity != null ? spark.compareOpacity : 50)) + '"></div>' : '') +
          '<div class="col-12"><label class="form-label mb-1">Palette (hex)</label><div class="settings-charts-color-grid">' + renderBundleColorInput('palette.up', palette.up, 'Up / positive') + renderBundleColorInput('palette.down', palette.down, 'Down / negative') + renderBundleColorInput('palette.same', palette.same, 'Even / flat') + renderBundleColorInput('palette.compareLine', palette.compareLine, 'Compare line') + '</div></div>' +
          '<div class="col-12"><label class="form-label mb-1">Delta text + icon style</label><div class="row g-2">' +
            '<div class="col-12 col-sm-6 col-xl-2"><label class="form-label mb-1">Font size</label><input type="number" class="form-control form-control-sm" min="9" max="24" step="1" data-bundle-field="deltaStyle.fontSize" value="' + escapeHtml(String(delta.fontSize)) + '"></div>' +
            '<div class="col-12 col-sm-6 col-xl-2"><label class="form-label mb-1">Font weight</label><select class="form-select form-select-sm" data-bundle-field="deltaStyle.fontWeight"><option value="400"' + (Number(delta.fontWeight) === 400 ? ' selected' : '') + '>400</option><option value="500"' + (Number(delta.fontWeight) === 500 ? ' selected' : '') + '>500</option></select></div>' +
            '<div class="col-12 col-sm-6 col-xl-2"><label class="form-label mb-1">Icon size</label><input type="number" class="form-control form-control-sm" min="8" max="24" step="1" data-bundle-field="deltaStyle.iconSize" value="' + escapeHtml(String(delta.iconSize)) + '"></div>' +
            '<div class="col-12 col-sm-6 col-xl-3"><label class="form-label mb-1">Font color (optional)</label><input type="text" class="form-control form-control-sm" data-bundle-field="deltaStyle.fontColor" value="' + escapeHtml(delta.fontColor || '') + '" placeholder="Tone color"></div>' +
            '<div class="col-12 col-sm-6 col-xl-3"><label class="form-label mb-1">Icon color (optional)</label><input type="text" class="form-control form-control-sm" data-bundle-field="deltaStyle.iconColor" value="' + escapeHtml(delta.iconColor || '') + '" placeholder="Tone color"></div>' +
          '</div></div>' +
          '<div class="col-12"><label class="form-label mb-1">Advanced Apex override (JSON)</label><textarea class="form-control form-control-sm settings-charts-advanced-json" rows="5" data-bundle-field="sparkline.advancedApexOverride" spellcheck="false">' + escapeHtml(prettyJson(spark.advancedApexOverride)) + '</textarea></div>' +
          '<div class="col-12"><div class="settings-charts-preview-wrap"><div class="text-muted small mb-2">Preview</div><div class="settings-kpi-preview-card"><div class="settings-kpi-preview-head"><div class="settings-kpi-preview-title">Revenue</div><div class="settings-kpi-preview-delta" data-kpi-preview-delta><i class="fa-jelly fa-arrow-trend-up" aria-hidden="true"></i><span data-kpi-preview-delta-text>+8.4%</span></div></div><div class="settings-kpi-preview-value">£12.4k</div><div class="settings-charts-preview-canvas" data-kpi-preview-canvas></div></div></div></div>' +
        '</div></div></div>' +
      '</div>' +
    '</div>';
  }

  function refreshPieMetricState(card) {
    if (!card || !card.querySelector) return;
    var key = String(card.getAttribute('data-chart-config-key') || '').trim().toLowerCase();
    var meta = chartMeta(key);
    var modes = meta && Array.isArray(meta.modes) ? meta.modes : [];
    var supportsPie = modes.indexOf('pie') >= 0;
    var modeEl = card.querySelector('[data-chart-field="mode"]');
    var metricEl = card.querySelector('[data-chart-field="pieMetric"]');
    if (!modeEl) return;
    if (metricEl && !metricEl.hasAttribute('disabled')) {
      metricEl.disabled = String(modeEl.value || '').trim().toLowerCase() !== 'pie';
    }
    var pieEnabled = supportsPie && String(modeEl.value || '').trim().toLowerCase() === 'pie';
    [
      '[data-chart-field="style.pieDonut"]',
      '[data-chart-field="style.pieDonutSize"]',
      '[data-chart-field="style.pieLabelPosition"]',
      '[data-chart-field="style.pieLabelContent"]',
      '[data-chart-field="style.pieLabelOffset"]',
      '[data-chart-field="style.pieCountryFlags"]'
    ].forEach(function(sel) {
      var el = card.querySelector(sel);
      if (!el) return;
      el.disabled = !pieEnabled;
    });
  }

  function syncColorSwatches(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-color-swatch]').forEach(function (sw) {
      var row = sw.previousElementSibling;
      var input = row && row.querySelector && (row.querySelector('[data-chart-field="color"]') || row.querySelector('input[data-bundle-field]'));
      if (input) {
        var val = normalizeHexColor(input.value, '#3eb3ab');
        sw.style.background = val;
        sw.setAttribute('title', val);
      }
    });
  }

  function validateApexTextarea(el, fallbackObj) {
    if (!el) return { value: fallbackObj || {}, invalid: false };
    var txt = el.value == null ? '' : String(el.value).trim();
    if (!txt) {
      el.classList.remove('is-invalid');
      return { value: fallbackObj || {}, invalid: false };
    }
    try {
      var parsed = JSON.parse(txt);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        el.classList.remove('is-invalid');
        return { value: parsed, invalid: false };
      }
    } catch (_) {}
    el.classList.add('is-invalid');
    return { value: fallbackObj || {}, invalid: true };
  }

  function readChartConfigFromCard(card) {
    var key = card ? String(card.getAttribute('data-chart-config-key') || '').trim().toLowerCase() : '';
    if (!key) return null;
    var def = (defaultChartsUiConfigV1().charts || []).find(function (it) { return it && String(it.key || '').trim().toLowerCase() === key; }) || { key: key, label: key, enabled: true, mode: 'line', colors: ['#3eb3ab'], advancedApexOverride: {} };
    var enabledEl = card.querySelector('[data-chart-field="enabled"]');
    var labelEl = card.querySelector('[data-chart-field="label"]');
    var modeEl = card.querySelector('[data-chart-field="mode"]');
    var pieMetricEl = card.querySelector('[data-chart-field="pieMetric"]');
    var advancedEl = card.querySelector('[data-chart-field="advancedApexOverride"]');
    var style = normalizeChartStyleDraft({
      curve: (card.querySelector('[data-chart-field="style.curve"]') || {}).value,
      strokeWidth: (card.querySelector('[data-chart-field="style.strokeWidth"]') || {}).value,
      dashArray: (card.querySelector('[data-chart-field="style.dashArray"]') || {}).value,
      markerSize: (card.querySelector('[data-chart-field="style.markerSize"]') || {}).value,
      fillOpacity: (card.querySelector('[data-chart-field="style.fillOpacity"]') || {}).value,
      gridDash: (card.querySelector('[data-chart-field="style.gridDash"]') || {}).value,
      dataLabels: (card.querySelector('[data-chart-field="style.dataLabels"]') || {}).value,
      toolbar: !!(card.querySelector('[data-chart-field="style.toolbar"]') || {}).checked,
      animations: !!(card.querySelector('[data-chart-field="style.animations"]') || {}).checked,
      pieDonut: !!(card.querySelector('[data-chart-field="style.pieDonut"]') || {}).checked,
      pieDonutSize: (card.querySelector('[data-chart-field="style.pieDonutSize"]') || {}).value,
      pieLabelPosition: (card.querySelector('[data-chart-field="style.pieLabelPosition"]') || {}).value,
      pieLabelContent: (card.querySelector('[data-chart-field="style.pieLabelContent"]') || {}).value,
      pieLabelOffset: (card.querySelector('[data-chart-field="style.pieLabelOffset"]') || {}).value,
      pieCountryFlags: !!(card.querySelector('[data-chart-field="style.pieCountryFlags"]') || {}).checked,
    }, def.style || defaultChartStyleConfig());
    var adv = validateApexTextarea(advancedEl, def.advancedApexOverride || {});
    var colors = [];
    card.querySelectorAll('[data-chart-field="color"][data-idx]').forEach(function (inp) {
      var idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
      if (!Number.isFinite(idx) || idx < 0) idx = 0;
      colors[idx] = normalizeHexColor(inp.value, '#3eb3ab');
    });
    return {
      key: key,
      enabled: !!(enabledEl && enabledEl.checked),
      label: labelEl && labelEl.value != null ? String(labelEl.value).trim() : key,
      mode: modeEl && modeEl.value != null ? String(modeEl.value).trim().toLowerCase() : String(def.mode || 'line').toLowerCase(),
      pieMetric: pieMetricEl && pieMetricEl.value != null ? String(pieMetricEl.value).trim().toLowerCase() : (def.pieMetric || 'sessions'),
      colors: colors.filter(function (c) { return !!c; }),
      style: style,
      advancedApexOverride: adv.value,
      hasInvalidJson: !!adv.invalid,
    };
  }

  function readBundleConfigFromCard(card, bundleKey) {
    var def = defaultKpiBundle(bundleKey);
    if (!card) return def;
    function v(path) {
      var el = card.querySelector('[data-bundle-field="' + path + '"]');
      if (!el) return null;
      if (el.type === 'checkbox') return !!el.checked;
      return el.value;
    }
    var mode = String(v('sparkline.mode') || def.sparkline.mode).trim().toLowerCase();
    if (['line', 'area', 'bar'].indexOf(mode) < 0) mode = def.sparkline.mode;
    var curve = String(v('sparkline.curve') || def.sparkline.curve).trim().toLowerCase();
    if (['smooth', 'straight', 'stepline'].indexOf(curve) < 0) curve = def.sparkline.curve;
    var weight = parseInt(String(v('deltaStyle.fontWeight') || def.deltaStyle.fontWeight), 10);
    if (weight !== 400 && weight !== 500) weight = def.deltaStyle.fontWeight;
    var advEl = card.querySelector('[data-bundle-field="sparkline.advancedApexOverride"]');
    var adv = validateApexTextarea(advEl, def.sparkline.advancedApexOverride || {});
    return {
      sparkline: {
        mode: mode,
        curve: curve,
        strokeWidth: safeNumber(v('sparkline.strokeWidth'), def.sparkline.strokeWidth, 0.5, 6),
        height: Math.round(safeNumber(v('sparkline.height'), def.sparkline.height, 18, 120)),
        showCompare: (KPI_BUNDLE_META[bundleKey] && KPI_BUNDLE_META[bundleKey].supportsCompare) ? !!v('sparkline.showCompare') : false,
        compareUsePrimaryColor: (KPI_BUNDLE_META[bundleKey] && KPI_BUNDLE_META[bundleKey].supportsCompare) ? !!v('sparkline.compareUsePrimaryColor') : false,
        compareOpacity: Math.round(safeNumber(v('sparkline.compareOpacity'), 50, 0, 100)),
        advancedApexOverride: adv.value,
      },
      deltaStyle: {
        fontSize: Math.round(safeNumber(v('deltaStyle.fontSize'), def.deltaStyle.fontSize, 9, 24)),
        fontWeight: weight,
        iconSize: Math.round(safeNumber(v('deltaStyle.iconSize'), def.deltaStyle.iconSize, 8, 24)),
        fontColor: normalizeOptionalHexColor(v('deltaStyle.fontColor') || ''),
        iconColor: normalizeOptionalHexColor(v('deltaStyle.iconColor') || ''),
      },
      palette: {
        up: normalizeHexColor(v('palette.up'), def.palette.up),
        down: normalizeHexColor(v('palette.down'), def.palette.down),
        same: normalizeHexColor(v('palette.same'), def.palette.same),
        compareLine: normalizeHexColor(v('palette.compareLine'), def.palette.compareLine),
      },
      hasInvalidJson: !!adv.invalid,
    };
  }

  function renderChartPreview(card, chartCfg) {
    var canvas = card ? card.querySelector('[data-chart-preview-canvas]') : null;
    if (!canvas) return;
    if (typeof window.kexoRenderChartPreview === 'function') {
      window.kexoRenderChartPreview({
        containerEl: canvas,
        chartKey: chartCfg.key,
        mode: chartCfg.mode,
        colors: chartCfg.colors && chartCfg.colors.length ? chartCfg.colors : ['#3eb3ab'],
        pieMetric: chartCfg.pieMetric,
        chartStyle: chartCfg.style,
        advancedApexOverride: chartCfg.advancedApexOverride
      });
      return;
    }
    canvas.innerHTML = '<div class="text-muted small py-4 text-center">Preview unavailable.</div>';
  }

  function renderBundlePreview(card, bundleKey, bundleCfg) {
    var canvas = card ? card.querySelector('[data-kpi-preview-canvas]') : null;
    var deltaEl = card ? card.querySelector('[data-kpi-preview-delta]') : null;
    if (!canvas || !deltaEl) return;
    var tone = bundleCfg.palette.up || '#2fb344';
    deltaEl.style.fontSize = String(bundleCfg.deltaStyle.fontSize) + 'px';
    deltaEl.style.fontWeight = String(bundleCfg.deltaStyle.fontWeight);
    deltaEl.style.color = bundleCfg.deltaStyle.fontColor || tone;
    var iconEl = deltaEl.querySelector('i');
    if (iconEl) {
      iconEl.style.fontSize = String(bundleCfg.deltaStyle.iconSize) + 'px';
      iconEl.style.color = bundleCfg.deltaStyle.iconColor || tone;
    }
    if (typeof window.kexoRenderKpiSparklinePreview === 'function') {
      window.kexoRenderKpiSparklinePreview({
        containerEl: canvas,
        bundleKey: bundleKey,
        sparkline: bundleCfg.sparkline,
        palette: bundleCfg.palette
      });
      return;
    }
    canvas.innerHTML = '<div class="text-muted small py-4 text-center">Sparkline preview unavailable.</div>';
  }

  function renderAllChartsPreviews(root) {
    if (!root) return;
    root.querySelectorAll('[data-chart-config-key]').forEach(function (card) {
      var cfg = readChartConfigFromCard(card);
      if (cfg) renderChartPreview(card, cfg);
    });
    KPI_BUNDLE_ORDER.forEach(function (bundleKey) {
      var card = root.querySelector('[data-kpi-bundle-key="' + bundleKey + '"]');
      if (!card) return;
      var cfg = readBundleConfigFromCard(card, bundleKey);
      renderBundlePreview(card, bundleKey, cfg);
    });
  }

  function renderChartsUiPanel(cfg) {
    var root = document.getElementById('settings-charts-root');
    if (!root) return;
    var c = normalizeChartsUiConfigDraft(cfg);
    var hideOnMobile = c.hideOnMobile !== false;
    var accordionId = 'settings-layout-charts-accordion';
    var html = '<div class="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">' +
      '<label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="settings-charts-hide-mobile" ' + (!hideOnMobile ? 'checked' : '') + '><span class="form-check-label ms-2">Show graphs on mobile</span></label>' +
      '<div class="text-muted small" style="max-width:560px;">Configure one chart/KPI bundle at a time with live previews.</div>' +
      '</div>' +
      '<div class="accordion settings-layout-accordion settings-charts-accordion" id="' + escapeHtml(accordionId) + '">';
    var itemIndex = 0;
    CHARTS_GROUPS.forEach(function (group, groupIndex) {
      var keys = group && Array.isArray(group.keys) ? group.keys : [];
      var groupCharts = c.charts.filter(function (it) { return keys.indexOf(String(it.key || '').trim().toLowerCase()) >= 0; });
      if (!groupCharts.length) return;
      var groupId = (group && group.id) ? String(group.id) : 'group-' + groupIndex;
      var groupLabel = (group && group.label) ? String(group.label) : 'Charts';
      var groupCollapseId = 'settings-charts-group-collapse-' + groupId.replace(/[^a-z0-9_-]/g, '-');
      var innerAccordionId = 'settings-charts-group-inner-' + groupId.replace(/[^a-z0-9_-]/g, '-');
      var groupHeadingId = groupCollapseId + '-heading';
      var isGroupOpen = groupIndex === 0;
      html += '<div class="accordion-item settings-charts-group-item">' +
        '<h2 class="accordion-header" id="' + escapeHtml(groupHeadingId) + '">' +
          '<button class="accordion-button' + (isGroupOpen ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(groupCollapseId) + '" aria-expanded="' + (isGroupOpen ? 'true' : 'false') + '" aria-controls="' + escapeHtml(groupCollapseId) + '">' +
            '<span class="d-flex align-items-center w-100 gap-2"><span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span><span class="me-auto">' + escapeHtml(groupLabel) + '</span></span>' +
          '</button>' +
        '</h2>' +
        '<div id="' + escapeHtml(groupCollapseId) + '" class="accordion-collapse collapse' + (isGroupOpen ? ' show' : '') + '" aria-labelledby="' + escapeHtml(groupHeadingId) + '" data-bs-parent="#' + escapeHtml(accordionId) + '">' +
          '<div class="accordion-body">' +
            '<div class="accordion settings-layout-accordion settings-charts-inner-accordion" id="' + escapeHtml(innerAccordionId) + '">';
      groupCharts.forEach(function (it, innerIdx) {
        html += renderChartAccordionItem(it, innerIdx, innerAccordionId);
        itemIndex += 1;
      });
      html += '</div></div></div></div>';
    });
    var kpiGroupCollapseId = 'settings-charts-group-collapse-kpi-bundles';
    var kpiGroupHeadingId = kpiGroupCollapseId + '-heading';
    var kpiInnerAccordionId = 'settings-charts-group-inner-kpi-bundles';
    html += '<div class="accordion-item settings-charts-group-item">' +
      '<h2 class="accordion-header" id="' + escapeHtml(kpiGroupHeadingId) + '">' +
        '<button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(kpiGroupCollapseId) + '" aria-expanded="false" aria-controls="' + escapeHtml(kpiGroupCollapseId) + '">' +
          '<span class="d-flex align-items-center w-100 gap-2"><span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span><span class="me-auto">KPI bundles</span></span>' +
        '</button>' +
      '</h2>' +
      '<div id="' + escapeHtml(kpiGroupCollapseId) + '" class="accordion-collapse collapse" aria-labelledby="' + escapeHtml(kpiGroupHeadingId) + '" data-bs-parent="#' + escapeHtml(accordionId) + '">' +
        '<div class="accordion-body">' +
          '<div class="accordion settings-layout-accordion settings-charts-inner-accordion" id="' + escapeHtml(kpiInnerAccordionId) + '">';
    KPI_BUNDLE_ORDER.forEach(function (bundleKey, innerIdx) {
      html += renderBundleAccordionItem(bundleKey, c.kpiBundles[bundleKey] || defaultKpiBundle(bundleKey), innerIdx, kpiInnerAccordionId);
      itemIndex += 1;
    });
    html += '</div></div></div></div></div>';
    // If a debounced preview render is still pending from a previous panel paint,
    // clear it before rebuilding the DOM to avoid stale rerenders.
    if (root.__kexoChartsPreviewTimer) {
      try { clearTimeout(root.__kexoChartsPreviewTimer); } catch (_) {}
      root.__kexoChartsPreviewTimer = 0;
    }
    root.innerHTML = html;
    root.querySelectorAll('[data-chart-config-key]').forEach(function (card) {
      refreshPieMetricState(card);
      var bodyEl = card.querySelector('.settings-charts-card-body');
      var key = (card.getAttribute('data-chart-config-key') || '').trim().toLowerCase();
      if (bodyEl && key && typeof window.KexoLayoutShortcuts !== 'undefined' && window.KexoLayoutShortcuts.refreshChartSettingsUi) {
        window.KexoLayoutShortcuts.refreshChartSettingsUi(bodyEl, key);
      }
    });
    syncColorSwatches(root);
    renderAllChartsPreviews(root);

    if (typeof root.__kexoChartsQueuePreview !== 'function') {
      root.__kexoChartsQueuePreview = function () {
        if (root.__kexoChartsPreviewTimer) {
          try { clearTimeout(root.__kexoChartsPreviewTimer); } catch (_) {}
        }
        root.__kexoChartsPreviewTimer = setTimeout(function () {
          root.__kexoChartsPreviewTimer = 0;
          root.querySelectorAll('[data-chart-config-key]').forEach(function (card) {
            refreshPieMetricState(card);
            var bodyEl = card.querySelector('.settings-charts-card-body');
            var key = (card.getAttribute('data-chart-config-key') || '').trim().toLowerCase();
            if (bodyEl && key && typeof window.KexoLayoutShortcuts !== 'undefined' && window.KexoLayoutShortcuts.refreshChartSettingsUi) {
              window.KexoLayoutShortcuts.refreshChartSettingsUi(bodyEl, key);
            }
          });
          syncColorSwatches(root);
          renderAllChartsPreviews(root);
        }, 100);
      };
      root.addEventListener('input', root.__kexoChartsQueuePreview);
      root.addEventListener('change', root.__kexoChartsQueuePreview);
      root.setAttribute('data-layout-charts-wired', '1');
    }
    root.querySelectorAll('.accordion-collapse').forEach(function (collapseEl) {
      collapseEl.addEventListener('shown.bs.collapse', function () {
        var chartCard = collapseEl.closest('[data-chart-config-key]');
        if (chartCard) {
          var chartCfg = readChartConfigFromCard(chartCard);
          if (chartCfg) renderChartPreview(chartCard, chartCfg);
          return;
        }
        var bundleCard = collapseEl.closest('[data-kpi-bundle-key]');
        if (bundleCard) {
          var bundleKey = String(bundleCard.getAttribute('data-kpi-bundle-key') || '').trim();
          if (!bundleKey) return;
          var bundleCfg = readBundleConfigFromCard(bundleCard, bundleKey);
          renderBundlePreview(bundleCard, bundleKey, bundleCfg);
        }
      });
    });
  }

  function buildChartsUiConfigFromDom() {
    var hideEl = document.getElementById('settings-charts-hide-mobile');
    var hideOnMobile = hideEl ? !hideEl.checked : false;
    var root = document.getElementById('settings-charts-root');
    if (!root) {
      var base = chartsUiConfigCache || defaultChartsUiConfigV1();
      return normalizeChartsUiConfigDraft({ v: 1, hideOnMobile: hideOnMobile, charts: base.charts || [], kpiBundles: base.kpiBundles || {} });
    }
    var out = { v: 1, hideOnMobile: hideOnMobile, charts: [], kpiBundles: {} };
    root.querySelectorAll('[data-chart-config-key]').forEach(function (card) {
      var key = (card.getAttribute('data-chart-config-key') || '').trim().toLowerCase();
      var bodyEl = card.querySelector('.settings-charts-card-body');
      var chartCfg = (typeof window.KexoLayoutShortcuts !== 'undefined' && window.KexoLayoutShortcuts.readChartModalBody && bodyEl)
        ? window.KexoLayoutShortcuts.readChartModalBody(bodyEl, key)
        : readChartConfigFromCard(card);
      if (!chartCfg) return;
      out.charts.push({
        key: chartCfg.key || key,
        enabled: chartCfg.enabled,
        label: chartCfg.label || chartCfg.key || key,
        mode: chartCfg.mode,
        colors: chartCfg.colors,
        style: chartCfg.style,
        pieMetric: chartCfg.pieMetric,
        advancedApexOverride: chartCfg.advancedApexOverride
      });
    });
    KPI_BUNDLE_ORDER.forEach(function (bundleKey) {
      var card = root.querySelector('[data-kpi-bundle-key="' + bundleKey + '"]');
      out.kpiBundles[bundleKey] = readBundleConfigFromCard(card, bundleKey);
    });
    return normalizeChartsUiConfigDraft(out);
  }

  function wireChartsSaveReset() {
    var saveBtn = document.getElementById('settings-charts-save-btn');
    var resetBtn = document.getElementById('settings-charts-reset-btn');
    var msgEl = document.getElementById('settings-charts-msg');
    if (!saveBtn || !resetBtn) return;

    function setMsg(t, ok) {
      if (!msgEl) return;
      msgEl.textContent = t || '';
      msgEl.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
    }

    saveBtn.addEventListener('click', function () {
      var root = document.getElementById('settings-charts-root');
      var invalidJson = root ? root.querySelector('.settings-charts-advanced-json.is-invalid') : null;
      if (invalidJson) {
        setMsg('Fix invalid Apex JSON before saving.', false);
        return;
      }
      var cfg = buildChartsUiConfigFromDom();
      setMsg('Saving\u2026', true);
      saveSettings({ chartsUiConfig: cfg })
        .then(function (r) {
          if (r && r.ok) {
            chartsUiConfigCache = r.chartsUiConfig || cfg;
            try { localStorage.setItem('kexo:charts-ui-config:v1', JSON.stringify(chartsUiConfigCache)); } catch (_) {}
            setMsg('Saved.', true);
            try { renderChartsUiPanel(chartsUiConfigCache); } catch (_) {}
            try {
              if (window && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('kexo:chartsUiConfigUpdated', { detail: chartsUiConfigCache }));
              }
            } catch (_) {}
          } else {
            setMsg((r && r.error) ? String(r.error) : 'Save failed', false);
          }
        })
        .catch(function () { setMsg('Save failed', false); });
    });

    resetBtn.addEventListener('click', function () {
      renderChartsUiPanel(defaultChartsUiConfigV1());
      setMsg('Defaults loaded. Press Save to apply.', true);
    });
  }

  function wireLayoutSubTabs(initialKey) {
    layoutTabsetApi = wireKexoTabset({
      tabSelector: '#settings-layout-main-tabs [data-settings-layout-tab]',
      tabAttr: 'data-settings-layout-tab',
      panelIdPrefix: 'settings-layout-panel-',
      keys: ['tables', 'kpis', 'date-ranges'],
      initialKey: (function () { var k = initialKey || activeLayoutSubTab || 'tables'; return k === 'charts' ? 'tables' : k; })(),
      onActivate: function (key) {
        activeLayoutSubTab = key;
        if (getActiveSettingsTab() === 'layout') {
          if (key === 'tables') try { renderTablesWhenVisible(); } catch (_) {}
          updateUrl('layout');
          syncLeftNavActiveClasses('layout');
        }
      },
    });
  }

  function wireKexoSubTabs(initialKey) {
    function placeThemeCard(viewKey) {
      var iconsPanel = document.getElementById('settings-kexo-panel-icons-assets');
      var themePanel = document.getElementById('settings-kexo-panel-theme-display');
      if (!iconsPanel || !themePanel) return;
      var themeCard = document.querySelector('#settings-panel-kexo .kexo-brand-theme');
      if (!themeCard) return;
      if (viewKey === 'icons-assets') {
        if (themeCard.parentElement !== iconsPanel) iconsPanel.appendChild(themeCard);
        return;
      }
      if (themeCard.parentElement !== themePanel) themePanel.appendChild(themeCard);
    }

    kexoTabsetApi = wireKexoTabset({
      tabSelector: '#settings-kexo-main-tabs [data-settings-kexo-tab]',
      tabAttr: 'data-settings-kexo-tab',
      panelIdPrefix: 'settings-kexo-panel-',
      keys: ['general', 'icons-assets', 'theme-display'],
      initialKey: initialKey || activeKexoSubTab || 'general',
      onActivate: function (key) {
        activeKexoSubTab = key;
        placeThemeCard(key);
        var requestedThemeSubtab = null;
        if (key === 'icons-assets') requestedThemeSubtab = 'icons';
        else if (key === 'theme-display') requestedThemeSubtab = 'header';
        if (requestedThemeSubtab) {
          try {
            try { window.__kexoThemeRequestedSubtab = requestedThemeSubtab; } catch (_) {}
            if (typeof window.kexoThemeActivateSubtab === 'function') window.kexoThemeActivateSubtab(requestedThemeSubtab);
          } catch (_) {}
        }
        if (getActiveSettingsTab() === 'kexo') {
          updateUrl('kexo');
          syncLeftNavActiveClasses('kexo');
        }
      },
    });
  }

  function wireAttributionSubTabs(initialKey) {
    attributionTabsetApi = wireKexoTabset({
      tabSelector: '#settings-attribution-main-tabs [data-settings-attribution-tab]',
      tabAttr: 'data-settings-attribution-tab',
      panelIdPrefix: 'settings-attribution-panel-',
      keys: ['mapping', 'tree'],
      initialKey: initialKey || 'mapping',
      onActivate: function (key) {
        activeAttributionSubTab = key;
        if (getActiveSettingsTab() === 'attribution') {
          if (key === 'mapping' && typeof window.initAttributionMappingSettings === 'function') {
            try { window.initAttributionMappingSettings({ rootId: 'settings-attribution-mapping-root' }); } catch (_) {}
          } else if (key === 'tree' && typeof window.initAttributionTreeView === 'function') {
            try { window.initAttributionTreeView({ rootId: 'settings-attribution-tree-root' }); } catch (_) {}
          }
          updateUrl('attribution');
          syncLeftNavActiveClasses('attribution');
        }
      },
    });
  }

  function wireAdminSubTabs(initialKey) {
    adminTabsetApi = wireKexoTabset({
      tabSelector: '#settings-admin-main-tabs [data-settings-admin-tab]',
      tabAttr: 'data-settings-admin-tab',
      panelIdPrefix: 'admin-panel-',
      keys: ['users', 'diagnostics', 'controls'],
      initialKey: initialKey || initialAdminSubTab || 'users',
      onActivate: function (key) {
        activeAdminSubTab = key;
        if (getActiveSettingsTab() === 'admin') {
          updateUrl('admin');
          syncLeftNavActiveClasses('admin');
        }
      },
    });
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

  function updateDefaultRowsSelectForRow(row) {
    if (!row || !row.querySelector) return;
    var optionsInput = row.querySelector('input[data-field="rows-options"]');
    var defaultSel = row.querySelector('select[data-field="rows-default"]');
    if (!optionsInput || !defaultSel) return;

    var options = parseRowOptionsText(optionsInput.value);
    if (!options.length) {
      options = parseRowOptionsText(optionsInput.getAttribute('data-default-options') || '');
    }
    if (!options.length) options = [20];

    var cur = parseInt(String(defaultSel.value || ''), 10);
    if (!Number.isFinite(cur) || options.indexOf(cur) < 0) cur = options[0];

    defaultSel.innerHTML = options.map(function (n) {
      return '<option value="' + String(n) + '"' + (n === cur ? ' selected' : '') + '>' + String(n) + '</option>';
    }).join('');
  }

  function renderLayoutTablesUiPanel(cfg) {
    var root = document.getElementById('settings-layout-tables-root');
    if (!root) return;
    var c = cfg && typeof cfg === 'object' ? cfg : defaultTablesUiConfigV1();
    var pages = Array.isArray(c.pages) ? c.pages.slice() : [];
    pages.sort(function (a, b) {
      var al = a && a.label ? String(a.label).toLowerCase() : '';
      var bl = b && b.label ? String(b.label).toLowerCase() : '';
      if (al < bl) return -1;
      if (al > bl) return 1;
      return 0;
    });

    var html = '' +
      '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">' +
        '<div class="text-muted small">Each section is grouped by page so table settings are easier to scan and edit one row at a time.</div>' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" disabled title="Coming later">Add table\u2026</button>' +
      '</div>' +
      '<div class="accordion settings-layout-accordion" id="settings-layout-tables-accordion">';

    pages.forEach(function (page, pageIdx) {
      if (!page || typeof page !== 'object') return;
      var pageKey = page.key != null ? String(page.key).trim().toLowerCase() : '';
      if (!pageKey) return;
      var label = page.label != null ? String(page.label) : pageKey;
      var tables = Array.isArray(page.tables) ? page.tables.slice() : [];
      tables.sort(function (a, b) {
        var ao = Number(a && a.order) || 0;
        var bo = Number(b && b.order) || 0;
        if (ao !== bo) return ao - bo;
        var an = a && a.name ? String(a.name).toLowerCase() : '';
        var bn = b && b.name ? String(b.name).toLowerCase() : '';
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
      });

      var rowsHtml = '';
      tables.forEach(function (t) {
        if (!t || typeof t !== 'object') return;
        var tableId = t.id != null ? String(t.id).trim() : '';
        if (!tableId) return;
        var name = t.name != null ? String(t.name) : tableId;
        var tableClass = t.tableClass != null ? String(t.tableClass) : '';
        var zone = t.zone != null ? String(t.zone) : '';
        var inGrid = t.inGrid !== false;
        var rowOptions = t.rows && Array.isArray(t.rows.options) ? t.rows.options : [];
        var defaultRows = t.rows && typeof t.rows.default === 'number' ? t.rows.default : (rowOptions[0] || 20);
        if (rowOptions.indexOf(defaultRows) < 0 && rowOptions.length) defaultRows = rowOptions[0];
        var stickyMin = t.sticky && typeof t.sticky.minWidth === 'number' ? t.sticky.minWidth : null;
        var stickyMax = t.sticky && typeof t.sticky.maxWidth === 'number' ? t.sticky.maxWidth : null;

        var tableBodyHtml;
        if (typeof window.KexoLayoutShortcuts !== 'undefined' && window.KexoLayoutShortcuts.renderTableModalBody) {
          tableBodyHtml = window.KexoLayoutShortcuts.renderTableModalBody(t);
        } else {
          var defaultOptsHtml = (rowOptions.length ? rowOptions : [defaultRows]).map(function (n) {
            return '<option value="' + String(n) + '"' + (Number(n) === Number(defaultRows) ? ' selected' : '') + '>' + String(n) + '</option>';
          }).join('');
          tableBodyHtml = '<div class="row g-3">' +
            '<div class="col-12"><label class="form-label mb-1">Display name</label><input type="text" class="form-control form-control-sm" data-field="name" value="' + escapeHtml(name) + '"></div>' +
            '<div class="col-12 col-md-6"><label class="form-label mb-1">Rows options</label><input type="text" class="form-control form-control-sm" data-field="rows-options" data-default-options="' + escapeHtml(formatRowOptionsText(rowOptions)) + '" value="' + escapeHtml(formatRowOptionsText(rowOptions)) + '" placeholder="e.g. 5, 10, 15, 20"><div class="text-muted small mt-1">Comma-separated values.</div></div>' +
            '<div class="col-12 col-md-6"><label class="form-label mb-1">Default rows</label><select class="form-select form-select-sm" data-field="rows-default">' + defaultOptsHtml + '</select></div>' +
            '<div class="col-12 col-md-6"><label class="form-label mb-1">Sticky min width (px)</label><input type="number" class="form-control form-control-sm" data-field="sticky-min" placeholder="auto" value="' + (stickyMin == null ? '' : escapeHtml(String(stickyMin))) + '"></div>' +
            '<div class="col-12 col-md-6"><label class="form-label mb-1">Sticky max width (px)</label><input type="number" class="form-control form-control-sm" data-field="sticky-max" placeholder="auto" value="' + (stickyMax == null ? '' : escapeHtml(String(stickyMax))) + '"></div>' +
            '<div class="col-12"><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="inGrid"' + (inGrid ? ' checked' : '') + '><span class="form-check-label small ms-2">Keep in grid layout</span></label><div class="text-muted small mt-1">Disable to force full-width layout.</div></div>' +
            '</div>';
        }

        rowsHtml += '' +
          '<div class="card card-sm mb-3 settings-layout-table-card" data-layout-page-key="' + escapeHtml(pageKey) + '" data-layout-table-id="' + escapeHtml(tableId) + '">' +
            '<div class="card-header d-flex align-items-start justify-content-between flex-wrap gap-2">' +
              '<div>' +
                '<h4 class="card-title mb-1">' + escapeHtml(name) + '</h4>' +
                '<div class="text-muted small">' +
                  '<code>' + escapeHtml(tableId) + '</code>' +
                  (tableClass ? ' \u00b7 class <code>' + escapeHtml(tableClass) + '</code>' : '') +
                  (zone ? ' \u00b7 zone <code>' + escapeHtml(zone) + '</code>' : '') +
                '</div>' +
              '</div>' +
              '<div class="d-flex align-items-center justify-content-end gap-2 flex-wrap">' +
                '<div class="btn-group btn-group-sm" role="group" aria-label="Reorder">' +
                  '<button type="button" class="btn btn-outline-secondary" data-action="up" aria-label="Move up">\u2191</button>' +
                  '<button type="button" class="btn btn-outline-secondary" data-action="down" aria-label="Move down">\u2193</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="card-body">' + tableBodyHtml + '</div>' +
          '</div>';
      });

      var collapseId = 'settings-layout-page-' + pageKey.replace(/[^a-z0-9_-]/g, '-');
      var headingId = collapseId + '-heading';
      var isOpen = pageIdx === 0;
      html += '' +
        '<div class="accordion-item" data-layout-page="' + escapeHtml(pageKey) + '">' +
          '<h2 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
            '<button class="accordion-button' + (isOpen ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + escapeHtml(collapseId) + '">' +
              '<span class="d-flex align-items-center w-100 gap-2">' +
                '<span class="kexo-settings-accordion-chevron" aria-hidden="true">' +
                  '<i class="fa-regular fa-chevron-down" aria-hidden="true"></i>' +
                '</span>' +
                '<span class="me-auto">' + escapeHtml(label) + '</span>' +
                '<span class="text-muted small"><code>' + escapeHtml(pageKey) + '</code></span>' +
              '</span>' +
            '</button>' +
          '</h2>' +
          '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse' + (isOpen ? ' show' : '') + '" aria-labelledby="' + escapeHtml(headingId) + '" data-bs-parent="#settings-layout-tables-accordion">' +
            '<div class="accordion-body">' +
              '<div data-layout-page-block="1" data-layout-page-key="' + escapeHtml(pageKey) + '">' +
                (rowsHtml || '<div class="text-secondary small">No tables found.</div>') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });

    html += '</div>';
    root.innerHTML = html;
    wireReorderButtons(root);

    // Keep default selector valid when options change.
    if (root.getAttribute('data-layout-wired') !== '1') {
      root.setAttribute('data-layout-wired', '1');
      root.addEventListener('input', function (e) {
        var target = e && e.target ? e.target : null;
        if (!target) return;
        if (target.matches && target.matches('input[data-field="rows-options"]')) {
          var row = target.closest ? target.closest('[data-layout-table-id]') : null;
          if (row) updateDefaultRowsSelectForRow(row);
        }
      });
      root.addEventListener('change', function (e) {
        var target = e && e.target ? e.target : null;
        if (!target) return;
        if (target.matches && target.matches('input[data-field="rows-options"]')) {
          var row = target.closest ? target.closest('[data-layout-table-id]') : null;
          if (row) updateDefaultRowsSelectForRow(row);
        }
      });
    }
  }

  function buildTablesUiConfigFromDom() {
    var root = document.getElementById('settings-layout-tables-root');
    var out = {
      v: 1,
      pages: [],
    };
    if (!root) return out;

    var pageBodies = Array.prototype.slice.call(root.querySelectorAll('[data-layout-page-block="1"][data-layout-page-key]'));
    pageBodies.forEach(function (tbody) {
      var pageKey = (tbody.getAttribute('data-layout-page-key') || '').trim().toLowerCase();
      if (!pageKey) return;
      var page = { key: pageKey, tables: [] };
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('[data-layout-table-id]'));
      rows.forEach(function (tr, idx) {
        var tableId = (tr.getAttribute('data-layout-table-id') || '').trim();
        if (!tableId) return;
        var cardBody = tr.querySelector('.card-body');
        var patch = (typeof window.KexoLayoutShortcuts !== 'undefined' && window.KexoLayoutShortcuts.readTableModalBody && cardBody)
          ? window.KexoLayoutShortcuts.readTableModalBody(cardBody)
          : null;
        if (patch) {
          page.tables.push({
            id: tableId,
            name: patch.name || tableId,
            order: idx + 1,
            inGrid: patch.inGrid !== false,
            rows: patch.rows || { default: 20, options: [20] },
            sticky: patch.sticky || { minWidth: null, maxWidth: null },
          });
          return;
        }
        var nameEl = tr.querySelector('input[data-field="name"]');
        var inGridEl = tr.querySelector('input[data-field="inGrid"]');
        var optionsEl = tr.querySelector('input[data-field="rows-options"]');
        var defaultEl = tr.querySelector('select[data-field="rows-default"]');
        var stickyMinEl = tr.querySelector('input[data-field="sticky-min"]');
        var stickyMaxEl = tr.querySelector('input[data-field="sticky-max"]');

        var options = parseRowOptionsText(optionsEl ? optionsEl.value : '');
        if (!options.length && optionsEl) options = parseRowOptionsText(optionsEl.getAttribute('data-default-options') || '');

        var defaultRows = parseInt(String(defaultEl && defaultEl.value != null ? defaultEl.value : ''), 10);
        if (!Number.isFinite(defaultRows) && options.length) defaultRows = options[0];

        function parseSticky(inp) {
          if (!inp) return null;
          var raw = String(inp.value || '').trim();
          if (!raw) return null;
          var n = parseInt(raw, 10);
          return Number.isFinite(n) ? n : null;
        }

        page.tables.push({
          id: tableId,
          name: nameEl && nameEl.value != null ? String(nameEl.value).trim() : tableId,
          order: idx + 1,
          inGrid: !!(inGridEl && inGridEl.checked),
          rows: {
            default: Number.isFinite(defaultRows) ? defaultRows : undefined,
            options: options,
          },
          sticky: {
            minWidth: parseSticky(stickyMinEl),
            maxWidth: parseSticky(stickyMaxEl),
          },
        });
      });
      out.pages.push(page);
    });
    return out;
  }

  function setLayoutTablesMsg(text, ok) {
    var msgEl = document.getElementById('settings-layout-tables-msg');
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
  }

  function wireLayoutTablesSaveReset() {
    var saveBtn = document.getElementById('settings-layout-tables-save-btn');
    var resetBtn = document.getElementById('settings-layout-tables-reset-btn');
    if (!saveBtn || !resetBtn) return;

    saveBtn.addEventListener('click', function () {
      var cfg = buildTablesUiConfigFromDom();
      var chartsCfg = buildChartsUiConfigFromDom();
      setLayoutTablesMsg('Saving\u2026', true);
      saveSettings({ tablesUiConfig: cfg, chartsUiConfig: chartsCfg })
        .then(function (r) {
          if (r && r.ok) {
            tablesUiConfigCache = r.tablesUiConfig || cfg;
            chartsUiConfigCache = r.chartsUiConfig || chartsCfg;
            try { localStorage.setItem('kexo:tables-ui-config:v1', JSON.stringify(tablesUiConfigCache)); } catch (_) {}
            try { localStorage.setItem('kexo:charts-ui-config:v1', JSON.stringify(chartsUiConfigCache)); } catch (_) {}
            setLayoutTablesMsg('Saved.', true);
            try {
              if (window && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('kexo:tablesUiConfigUpdated', { detail: tablesUiConfigCache }));
                window.dispatchEvent(new CustomEvent('kexo:chartsUiConfigUpdated', { detail: chartsUiConfigCache }));
              }
            } catch (_) {}
            renderLayoutTablesUiPanel(tablesUiConfigCache);
          } else {
            setLayoutTablesMsg((r && r.error) ? String(r.error) : 'Save failed', false);
          }
        })
        .catch(function () { setLayoutTablesMsg('Save failed', false); });
    });

    resetBtn.addEventListener('click', function () {
      renderLayoutTablesUiPanel(defaultTablesUiConfigV1());
      setLayoutTablesMsg('Defaults loaded. Press Save to apply.', true);
    });
  }

  function wireKpisLayoutSubTabs() {
    wireKexoTabset({
      tabSelector: '[data-settings-kpis-layout-tab]',
      tabAttr: 'data-settings-kpis-layout-tab',
      panelIdPrefix: 'settings-kpis-layout-panel-',
      keys: ['dashboard', 'header'],
      initialKey: 'dashboard',
    });
  }

  function wireInsightsLayoutSubTabs() {
    wireKexoTabset({
      tabSelector: '[data-settings-insights-layout-tab]',
      tabAttr: 'data-settings-insights-layout-tab',
      panelIdPrefix: 'settings-insights-layout-panel-',
      keys: ['products', 'countries', 'variants'],
      initialKey: 'variants',
    });
  }

  function setInsightsVariantsMsg(text, ok) {
    var msgEl = document.getElementById('settings-insights-variants-msg');
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
  }

  function setInsightsVariantsResetVariantsVisibility(cfg) {
    var btn = document.getElementById('settings-insights-variants-reset-variants-btn');
    if (!btn) return;
    var tables = cfg && Array.isArray(cfg.tables) ? cfg.tables : [];
    var show = tables.length > 0;
    btn.classList.toggle('is-hidden', !show);
  }

  function countCoverageWarningTables(details) {
    var tables = details && Array.isArray(details.tables) ? details.tables : [];
    var n = 0;
    tables.forEach(function (t) {
      if (!t) return;
      var unmapped = Number(t.unmappedCount) || 0;
      var ambiguous = Number(t.ambiguousCount) || 0;
      if ((unmapped + ambiguous) > 0) n += 1;
    });
    return n;
  }

  function setInsightsVariantsWarnings(details) {
    var btn = document.getElementById('settings-insights-variants-warnings-btn');
    if (details && typeof details === 'object' && details.stage === 'coverage') {
      insightsVariantsWarningsCache = details;
    } else {
      insightsVariantsWarningsCache = null;
    }
    if (!btn) return;
    if (!insightsVariantsWarningsCache) {
      btn.disabled = true;
      btn.textContent = 'Warnings';
      btn.classList.remove('btn-danger');
      btn.classList.add('btn-outline-danger');
      return;
    }
    var n = countCoverageWarningTables(insightsVariantsWarningsCache);
    btn.disabled = false;
    btn.textContent = n > 0 ? ('Warnings (' + String(n) + ')') : 'Warnings';
    btn.classList.remove('btn-outline-danger');
    btn.classList.add('btn-danger');
  }

  function buildInsightsVariantsCoverageWarningsHtml(details) {
    var d = details && typeof details === 'object' ? details : null;
    if (!d || d.stage !== 'coverage') return '<div class="text-secondary">No warnings loaded yet.</div>';
    var tables = Array.isArray(d.tables) ? d.tables : [];
    var html = '';
    html += '<div class="alert alert-warning mb-3">';
    html += '<div class="fw-semibold mb-2">Saved with coverage warnings</div>';
    html += '<div class="text-secondary small mb-2">These warnings do not block saving. Until you map or ignore them, Insights → Variants may show inflated CR (because unmapped sessions/orders are excluded from table rows).</div>';
    if (typeof d.observedCount === 'number') {
      html += '<div class="text-secondary small mb-2">Validated against ' + escapeHtml(String(d.observedCount)) + ' recent variant titles.</div>';
    }
    tables.forEach(function (table) {
      if (!table) return;
      var ignoredCount = Number(table.ignoredCount) || 0;
      var outOfScopeCount = Number(table.outOfScopeCount) || 0;
      var resolvedCount = Number(table.resolvedCount) || 0;
      var unmappedCount = Number(table.unmappedCount) || 0;
      var ambiguousCount = Number(table.ambiguousCount) || 0;
      if (unmappedCount <= 0 && ambiguousCount <= 0) return;
      html += '<div class="mb-2"><strong>' + escapeHtml(table.tableName || table.tableId || 'Table') + '</strong>: ' +
        escapeHtml(String(unmappedCount)) + ' unmapped, ' + escapeHtml(String(ambiguousCount)) + ' ambiguous' +
        (outOfScopeCount > 0 ? ' (' + escapeHtml(String(outOfScopeCount)) + ' out-of-scope)' : '') +
        (ignoredCount > 0 ? ' (' + escapeHtml(String(ignoredCount)) + ' ignored)' : '') +
        (resolvedCount > 0 ? ' (' + escapeHtml(String(resolvedCount)) + ' overlap-resolved)' : '') + '</div>';
      var unmapped = Array.isArray(table.unmappedExamples) ? table.unmappedExamples.slice(0, 6) : [];
      var ambiguous = Array.isArray(table.ambiguousExamples) ? table.ambiguousExamples.slice(0, 6) : [];
      if (unmapped.length) {
        html += '<div class="small fw-semibold">Unmapped examples</div><ul class="small mb-2">';
        unmapped.forEach(function (ex) {
          html += '<li>' + escapeHtml(ex.variant_title || 'Unknown title') +
            ' (orders: ' + escapeHtml(String(Number(ex.orders) || 0)) + ')</li>';
        });
        html += '</ul>';
      }
      if (ambiguous.length) {
        html += '<div class="small fw-semibold">Ambiguous examples</div><ul class="small mb-2">';
        ambiguous.forEach(function (ex) {
          var matchLabels = Array.isArray(ex.matches)
            ? ex.matches.map(function (m) { return m && (m.label || m.id) ? String(m.label || m.id) : ''; }).filter(Boolean).join(', ')
            : '';
          html += '<li>' + escapeHtml(ex.variant_title || 'Unknown title') +
            (matchLabels ? ' \u2192 ' + escapeHtml(matchLabels) : '') + '</li>';
        });
        html += '</ul>';
      }
    });
    html += '</div>';
    return html;
  }

  function renderInsightsVariantsErrors(details) {
    var container = document.getElementById('settings-insights-variants-errors');
    if (!container) return;
    if (!details || typeof details !== 'object') {
      container.innerHTML = '';
      return;
    }
    var html = '';
    if (details.stage === 'structure') {
      // Structure errors block save – keep inline.
      var errors = Array.isArray(details.errors) ? details.errors : [];
      html += '<div class="alert alert-danger mb-3"><div class="fw-semibold mb-1">Cannot save: invalid structure</div>';
      if (errors.length) {
        html += '<ul class="mb-0">';
        errors.slice(0, 20).forEach(function (err) {
          var msg = err && err.message ? String(err.message) : 'Invalid config field';
          html += '<li>' + escapeHtml(msg) + '</li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="text-secondary">Unknown structure error.</div>';
      }
      html += '</div>';
      container.innerHTML = html;
      return;
    }
    if (details.stage === 'coverage') {
      // Coverage warnings no longer render inline (too noisy). Store for Warnings modal.
      setInsightsVariantsWarnings(details);
      container.innerHTML = '';
      return;
    }
    container.innerHTML = '';
  }

  function persistInsightsVariantsConfig(payloadCfg, options) {
    var opts = options && typeof options === 'object' ? options : {};
    setInsightsVariantsMsg(opts.pendingText || 'Saving…', true);
    renderInsightsVariantsErrors(null);
    return saveSettings({ insightsVariantsConfig: payloadCfg })
      .then(function (r) {
        if (r && r.ok) {
          insightsVariantsConfigCache = normalizeInsightsVariantsConfig(r.insightsVariantsConfig || payloadCfg);
          insightsVariantsDraft = deepClone(insightsVariantsConfigCache);
          renderInsightsVariantsPanel(insightsVariantsDraft);
          var warnings = r && r.insightsVariantsWarnings ? r.insightsVariantsWarnings : null;
          setInsightsVariantsWarnings(warnings);
          setInsightsVariantsMsg(opts.successText || (warnings ? 'Saved (warnings).' : 'Saved.'), true);
          if (typeof opts.onSuccess === 'function') opts.onSuccess(r);
          return true;
        }
        renderInsightsVariantsErrors(r && r.details ? r.details : null);
        var msg = (r && (r.message || r.error)) ? String(r.message || r.error) : 'Save failed';
        setInsightsVariantsMsg(msg, false);
        if (typeof opts.onFailure === 'function') opts.onFailure(r);
        return false;
      })
      .catch(function () {
        setInsightsVariantsMsg('Save failed', false);
        if (typeof opts.onFailure === 'function') opts.onFailure(null);
        return false;
      });
  }

  function ensureInsightsIgnoreModalBackdrop() {
    if (insightsIgnoreModalBackdropEl && insightsIgnoreModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    insightsIgnoreModalBackdropEl = el;
  }

  function closeInsightsIgnoreModal() {
    var modal = document.getElementById('settings-insights-variants-ignore-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (insightsIgnoreModalBackdropEl && insightsIgnoreModalBackdropEl.parentNode) {
      insightsIgnoreModalBackdropEl.parentNode.removeChild(insightsIgnoreModalBackdropEl);
    }
    insightsIgnoreModalBackdropEl = null;
  }

  function getInsightsIgnoredEntries() {
    var cfg = insightsVariantsDraft && typeof insightsVariantsDraft === 'object'
      ? insightsVariantsDraft
      : normalizeInsightsVariantsConfig(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
    var tables = Array.isArray(cfg.tables) ? cfg.tables : [];
    var entries = [];
    tables.forEach(function (table, tableIdx) {
      if (!table) return;
      var ignored = normalizeIgnoredList(table.ignored);
      ignored.forEach(function (title, ignoreIdx) {
        entries.push({
          tableIdx: tableIdx,
          ignoreIdx: ignoreIdx,
          tableId: table.id || '',
          tableName: table.name || table.id || 'Table',
          title: title,
        });
      });
    });
    return entries;
  }

  function renderInsightsIgnoreModalBody() {
    var body = document.getElementById('settings-insights-variants-ignore-body');
    if (!body) return;
    var msg = document.getElementById('settings-insights-variants-ignore-msg');
    if (msg) {
      msg.textContent = '';
      msg.className = 'form-hint';
    }
    var entries = getInsightsIgnoredEntries();
    if (!entries.length) {
      body.innerHTML = '<div class="text-secondary">No ignored variant titles yet.</div>';
      return;
    }
    var def = (window.KEXO_SETTINGS_MODAL_TABLE_DEFS && window.KEXO_SETTINGS_MODAL_TABLE_DEFS['settings-ignore-list-table']) || {};
    body.innerHTML = buildKexoSettingsTable({
      tableClass: 'table table-sm table-vcenter mb-0',
      columns: (def.columns || []).length ? def.columns : [
        { header: 'Table', headerClass: '' },
        { header: 'Ignored variant title', headerClass: '' },
        { header: 'Actions', headerClass: 'text-end' }
      ],
      rows: entries,
      renderRow: function (entry) {
        return '<tr>' +
          '<td>' + escapeHtml(entry.tableName) + '<div class="text-secondary small"><code>' + escapeHtml(entry.tableId) + '</code></div></td>' +
          '<td>' + escapeHtml(entry.title) + '</td>' +
          '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-action="remove-ignore" data-table-idx="' + String(entry.tableIdx) + '" data-ignore-idx="' + String(entry.ignoreIdx) + '">Remove</button></td>' +
        '</tr>';
      }
    });
  }

  function openInsightsIgnoreModal() {
    var modal = document.getElementById('settings-insights-variants-ignore-modal');
    if (!modal) return;
    syncInsightsVariantsDraftFromDom();
    renderInsightsIgnoreModalBody();
    ensureInsightsIgnoreModalBackdrop();
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
  }

  function ensureInsightsSuggestModalBackdrop() {
    if (insightsSuggestModalBackdropEl && insightsSuggestModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    insightsSuggestModalBackdropEl = el;
  }

  function closeInsightsSuggestModal() {
    var modal = document.getElementById('settings-insights-variants-suggest-modal');
    if (!modal) return;
    stopInsightsSuggestLoadingTimer();
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (insightsSuggestModalBackdropEl && insightsSuggestModalBackdropEl.parentNode) {
      insightsSuggestModalBackdropEl.parentNode.removeChild(insightsSuggestModalBackdropEl);
    }
    insightsSuggestModalBackdropEl = null;
  }

  function ensureInsightsMergeModalBackdrop() {
    if (insightsMergeModalBackdropEl && insightsMergeModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    insightsMergeModalBackdropEl = el;
  }

  function closeInsightsMergeModal() {
    var modal = document.getElementById('settings-insights-variants-merge-modal');
    if (!modal) return;
    insightsMergeContext = null;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (insightsMergeModalBackdropEl && insightsMergeModalBackdropEl.parentNode) {
      insightsMergeModalBackdropEl.parentNode.removeChild(insightsMergeModalBackdropEl);
    }
    insightsMergeModalBackdropEl = null;
  }

  function setInsightsMergeMsg(text, ok) {
    var msg = document.getElementById('settings-insights-variants-merge-msg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
  }

  function renderInsightsMergeModalBody() {
    var body = document.getElementById('settings-insights-variants-merge-body');
    if (!body) return;
    setInsightsMergeMsg('', true);

    var ctx = insightsMergeContext && typeof insightsMergeContext === 'object' ? insightsMergeContext : null;
    var cfg = insightsVariantsDraft && typeof insightsVariantsDraft === 'object'
      ? insightsVariantsDraft
      : normalizeInsightsVariantsConfig(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
    var tables = Array.isArray(cfg.tables) ? cfg.tables : [];
    var tIdx = ctx && Number.isFinite(ctx.tableIdx) ? ctx.tableIdx : -1;
    var rIdx = ctx && Number.isFinite(ctx.ruleIdx) ? ctx.ruleIdx : -1;
    if (!Number.isFinite(tIdx) || tIdx < 0 || tIdx >= tables.length) {
      body.innerHTML = '<div class="text-danger">Invalid table selection.</div>';
      return;
    }
    var table = tables[tIdx];
    var rules = table && Array.isArray(table.rules) ? table.rules : [];
    if (!Number.isFinite(rIdx) || rIdx < 0 || rIdx >= rules.length) {
      body.innerHTML = '<div class="text-danger">Invalid rule selection.</div>';
      return;
    }
    if (rules.length <= 1) {
      body.innerHTML = '<div class="text-secondary">Nothing to merge (only one label in this table).</div>';
      return;
    }

    var src = rules[rIdx] || {};
    var srcLabel = src && src.label ? String(src.label) : ('Rule ' + String(rIdx + 1));
    var srcCount = Array.isArray(src.include) ? src.include.length : 0;

    var options = [];
    for (var i = 0; i < rules.length; i += 1) {
      if (i === rIdx) continue;
      var rr = rules[i] || {};
      var label = rr && rr.label ? String(rr.label) : ('Rule ' + String(i + 1));
      var n = Array.isArray(rr.include) ? rr.include.length : 0;
      options.push({ idx: i, label: label, n: n });
    }
    if (!options.length) {
      body.innerHTML = '<div class="text-secondary">No other labels to merge into.</div>';
      return;
    }

    var radios = options.map(function (o, i) {
      return '' +
        '<label class="form-check mb-2">' +
          '<input class="form-check-input" type="radio" name="insights-variants-merge-target" value="' + escapeHtml(String(o.idx)) + '"' + (i === 0 ? ' checked' : '') + '>' +
          '<span class="form-check-label">' +
            '<div class="fw-semibold">' + escapeHtml(o.label) + '</div>' +
            '<div class="text-secondary small">' + escapeHtml(String(o.n)) + ' include aliases</div>' +
          '</span>' +
        '</label>';
    }).join('');

    body.innerHTML = '' +
      '<div class="text-secondary small mb-3">Merge <strong>' + escapeHtml(srcLabel) + '</strong> (' + escapeHtml(String(srcCount)) + ' include aliases) into the selected label below. This will move include aliases into the target and remove the source row.</div>' +
      '<div>' + radios + '</div>';
  }

  function openInsightsMergeModal(context) {
    var modal = document.getElementById('settings-insights-variants-merge-modal');
    var body = document.getElementById('settings-insights-variants-merge-body');
    if (!modal || !body) return;
    syncInsightsVariantsDraftFromDom();
    var ctx = context && typeof context === 'object' ? context : {};
    insightsMergeContext = {
      tableIdx: parseInt(String(ctx.tableIdx), 10),
      ruleIdx: parseInt(String(ctx.ruleIdx), 10),
    };
    renderInsightsMergeModalBody();
    ensureInsightsMergeModalBackdrop();
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
  }

  function applyInsightsMerge() {
    var modal = document.getElementById('settings-insights-variants-merge-modal');
    if (!modal) return;
    syncInsightsVariantsDraftFromDom();
    var ctx = insightsMergeContext && typeof insightsMergeContext === 'object' ? insightsMergeContext : null;
    if (!ctx) {
      setInsightsMergeMsg('Nothing selected to merge.', false);
      return;
    }
    var cfg = insightsVariantsDraft && typeof insightsVariantsDraft === 'object'
      ? insightsVariantsDraft
      : normalizeInsightsVariantsConfig(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
    var tables = Array.isArray(cfg.tables) ? cfg.tables : [];
    var tIdx = Number(ctx.tableIdx);
    var srcIdx = Number(ctx.ruleIdx);
    if (!Number.isFinite(tIdx) || tIdx < 0 || tIdx >= tables.length) {
      setInsightsMergeMsg('Invalid table.', false);
      return;
    }
    var table = tables[tIdx];
    if (!table || !Array.isArray(table.rules)) {
      setInsightsMergeMsg('Invalid table rules.', false);
      return;
    }
    var rules = table.rules;
    if (!Number.isFinite(srcIdx) || srcIdx < 0 || srcIdx >= rules.length) {
      setInsightsMergeMsg('Invalid source label.', false);
      return;
    }
    var sel = modal.querySelector('input[name="insights-variants-merge-target"]:checked');
    var targetIdx = sel && sel.value != null ? parseInt(String(sel.value), 10) : NaN;
    if (!Number.isFinite(targetIdx) || targetIdx < 0 || targetIdx >= rules.length) {
      setInsightsMergeMsg('Select a target label.', false);
      return;
    }
    if (targetIdx === srcIdx) {
      setInsightsMergeMsg('Select a different target label.', false);
      return;
    }

    var src = rules[srcIdx] || {};
    var tgt = rules[targetIdx] || {};
    var mergedInc = normalizeTokenList((Array.isArray(tgt.include) ? tgt.include : []).concat(Array.isArray(src.include) ? src.include : []));
    var mergedExc = normalizeTokenList((Array.isArray(tgt.exclude) ? tgt.exclude : []).concat(Array.isArray(src.exclude) ? src.exclude : []));
    tgt.include = mergedInc;
    tgt.exclude = mergedExc;

    rules.splice(srcIdx, 1);
    insightsVariantsDraft = normalizeInsightsVariantsConfig(cfg);
    renderInsightsVariantsPanel(insightsVariantsDraft);
    closeInsightsMergeModal();
    setInsightsVariantsMsg('Merged. Press Save to apply.', true);
  }

  function ensureInsightsWarningsModalBackdrop() {
    if (insightsWarningsModalBackdropEl && insightsWarningsModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    insightsWarningsModalBackdropEl = el;
  }

  function closeInsightsWarningsModal() {
    var modal = document.getElementById('settings-insights-variants-warnings-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (insightsWarningsModalBackdropEl && insightsWarningsModalBackdropEl.parentNode) {
      insightsWarningsModalBackdropEl.parentNode.removeChild(insightsWarningsModalBackdropEl);
    }
    insightsWarningsModalBackdropEl = null;
  }

  function openInsightsWarningsModal() {
    var modal = document.getElementById('settings-insights-variants-warnings-modal');
    var body = document.getElementById('settings-insights-variants-warnings-body');
    if (!modal || !body) return;
    var html = buildInsightsVariantsCoverageWarningsHtml(insightsVariantsWarningsCache);
    body.innerHTML = html;
    ensureInsightsWarningsModalBackdrop();
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
  }

  function setInsightsSuggestMsg(text, ok) {
    var msg = document.getElementById('settings-insights-variants-suggest-msg');
    if (!msg) return;
    msg.textContent = text || '';
    msg.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
  }

  function stopInsightsSuggestLoadingTimer() {
    if (insightsSuggestLoadingInterval) {
      try { clearInterval(insightsSuggestLoadingInterval); } catch (_) {}
    }
    insightsSuggestLoadingInterval = null;
    insightsSuggestLoadingStartMs = 0;
  }

  function startInsightsSuggestLoadingTimer() {
    stopInsightsSuggestLoadingTimer();
    insightsSuggestLoadingStartMs = Date.now();
    function tick() {
      var el = document.getElementById('settings-insights-variants-suggest-elapsed');
      if (!el || !insightsSuggestLoadingStartMs) return;
      var s = Math.max(0, Math.floor((Date.now() - insightsSuggestLoadingStartMs) / 1000));
      el.textContent = String(s) + 's';
    }
    tick();
    insightsSuggestLoadingInterval = setInterval(tick, 500);
  }

  function renderInsightsSuggestLoadingBody(kind) {
    var hint = kind === 'refresh'
      ? 'Refreshing from Shopify: reconciling orders before generating suggestions. This can take up to ~2 minutes.'
      : 'Building suggestions from cached/local data (fast). Use “Refresh from Shopify” for the freshest result.';
    return '' +
      '<div class="d-flex align-items-start gap-2">' +
        '<div class="spinner-border spinner-border-sm text-primary mt-1" role="status" aria-hidden="true"></div>' +
        '<div>' +
          '<div class="fw-semibold">Loading suggestions…</div>' +
          '<div class="text-secondary small">' + escapeHtml(hint) + '</div>' +
          '<div class="text-muted small mt-1">Elapsed: <span id="settings-insights-variants-suggest-elapsed">0s</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="progress progress-sm mt-3">' +
        '<div class="progress-bar progress-bar-indeterminate"></div>' +
      '</div>';
  }

  function setInsightsSuggestLoadingState(isLoading) {
    var applyBtn = document.getElementById('settings-insights-variants-suggest-apply-btn');
    var refreshBtn = document.getElementById('settings-insights-variants-suggest-refresh-btn');
    if (applyBtn) applyBtn.disabled = !!isLoading;
    if (refreshBtn) refreshBtn.disabled = !!isLoading;
  }

  function fetchInsightsVariantsSuggestions(rangeKey, options) {
    var range = rangeKey || '30d';
    var opts = options && typeof options === 'object' ? options : {};
    var refresh = !!opts.refresh;
    var url = (API || '') + '/api/insights-variants-suggestions?range=' + encodeURIComponent(range);
    if (refresh) url += '&refresh=1&force=1';
    return fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (r) { return r.json(); });
  }

  function loadInsightsVariantsSuggestionsIntoModal(rangeKey, options) {
    var modal = document.getElementById('settings-insights-variants-suggest-modal');
    var body = document.getElementById('settings-insights-variants-suggest-body');
    if (!modal || !body) return;
    var opts = options && typeof options === 'object' ? options : {};
    var refresh = !!opts.refresh;
    setInsightsSuggestMsg('', true);
    setInsightsSuggestLoadingState(true);
    body.innerHTML = renderInsightsSuggestLoadingBody(refresh ? 'refresh' : 'fast');
    startInsightsSuggestLoadingTimer();
    fetchInsightsVariantsSuggestions(rangeKey || '30d', { refresh: refresh })
      .then(function (r) {
        stopInsightsSuggestLoadingTimer();
        setInsightsSuggestLoadingState(false);
        if (!modal.classList.contains('show')) return;
        renderInsightsSuggestModalBody(r || {});
      })
      .catch(function () {
        stopInsightsSuggestLoadingTimer();
        setInsightsSuggestLoadingState(false);
        body.innerHTML = '<div class="text-danger">Failed to load suggestions.</div>';
        setInsightsSuggestMsg('Failed to load suggestions.', false);
      });
  }

  function renderInsightsSuggestModalBody(payload) {
    var body = document.getElementById('settings-insights-variants-suggest-body');
    if (!body) return;
    var p = payload && typeof payload === 'object' ? payload : {};
    insightsSuggestPayload = p;
    var list = Array.isArray(p.suggestions) ? p.suggestions : [];
    if (!list.length) {
      var note = p.notice ? String(p.notice) : '';
      body.innerHTML = '' +
        '<div class="text-secondary mb-2">No suggestions available right now.</div>' +
        (note ? '<div class="text-muted small">Notice: <code>' + escapeHtml(note) + '</code></div>' : '');
      return;
    }

    var cards = list.map(function (s, idx) {
      var table = s && s.table ? s.table : {};
      var option = s && s.option ? s.option : {};
      var impact = s && s.impact ? s.impact : {};
      var id = s && s.suggestionId ? String(s.suggestionId) : ('suggestion-' + String(idx + 1));
      var preview = Array.isArray(option.previewValues) ? option.previewValues.filter(Boolean).slice(0, 8) : [];
      var previewHtml = preview.length
        ? ('<div class="text-muted small mt-1">Top values: ' + escapeHtml(preview.join(', ')) + '</div>')
        : '';
      return '' +
        '<div class="card card-sm mb-2">' +
          '<div class="card-body">' +
            '<label class="form-check">' +
              '<input class="form-check-input" type="checkbox" data-suggest-select value="' + escapeHtml(id) + '"' + (idx < 3 ? ' checked' : '') + '>' +
              '<span class="form-check-label">' +
                '<div class="fw-semibold">' + escapeHtml(table.name || table.id || 'Variant Table') + '</div>' +
                '<div class="text-secondary small">From Shopify option <code>' + escapeHtml(option.name || '') + '</code> · ' +
                  escapeHtml(String(option.distinctValues || 0)) + ' values · ' +
                  escapeHtml(formatInt(impact.sessions || 0)) + ' sessions · ' +
                  escapeHtml(formatInt(impact.orders || 0)) + ' orders</div>' +
                previewHtml +
              '</span>' +
            '</label>' +
          '</div>' +
        '</div>';
    }).join('');

    body.innerHTML = '' +
      '<div class="text-secondary small mb-2">Suggestions are built from Shopify variant option labels (selected options) + recent observed variant activity. Seeded tables are fully editable.</div>' +
      cards;
  }

  function openInsightsSuggestModal() {
    var modal = document.getElementById('settings-insights-variants-suggest-modal');
    var body = document.getElementById('settings-insights-variants-suggest-body');
    if (!modal || !body) return;
    syncInsightsVariantsDraftFromDom();
    setInsightsSuggestMsg('', true);
    ensureInsightsSuggestModalBackdrop();
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
    loadInsightsVariantsSuggestionsIntoModal('30d', { refresh: false });
  }

  function readSelectedSuggestIds() {
    var modal = document.getElementById('settings-insights-variants-suggest-modal');
    if (!modal) return [];
    var ids = [];
    modal.querySelectorAll('input[data-suggest-select]:checked').forEach(function (el) {
      if (!el) return;
      var v = el.value != null ? String(el.value) : '';
      if (!v) return;
      ids.push(v);
    });
    return ids;
  }

  function applySelectedSuggestions() {
    syncInsightsVariantsDraftFromDom();
    var baseCfg = normalizeInsightsVariantsConfig(insightsVariantsDraft || insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
    var payload = insightsSuggestPayload && typeof insightsSuggestPayload === 'object' ? insightsSuggestPayload : {};
    var suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
    var selectedIds = new Set(readSelectedSuggestIds().map(function (s) { return String(s || ''); }).filter(Boolean));
    var selected = suggestions.filter(function (s) {
      return s && s.suggestionId && selectedIds.has(String(s.suggestionId));
    });
    var seedTables = selected.map(function (s) { return s && s.table ? s.table : null; }).filter(Boolean);
    if (!seedTables.length) {
      setInsightsSuggestMsg('Select at least one suggestion to apply.', false);
      return;
    }

    setInsightsSuggestMsg('Applying…', true);

    fetch((API || '') + '/api/insights-variants-suggestions/apply', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseConfig: baseCfg,
        seedTables: seedTables,
        range: (payload && payload.range) ? String(payload.range) : '30d',
        shop: (payload && payload.shop) ? String(payload.shop) : '',
      }),
    })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) {
          setInsightsSuggestMsg((r && (r.message || r.error)) ? String(r.message || r.error) : 'Apply failed', false);
          return;
        }
        insightsVariantsConfigCache = normalizeInsightsVariantsConfig(r.insightsVariantsConfig || baseCfg);
        insightsVariantsDraft = deepClone(insightsVariantsConfigCache);
        renderInsightsVariantsPanel(insightsVariantsDraft);
        setInsightsVariantsMsg('Suggestions applied.', true);
        setInsightsVariantsWarnings(r && r.warnings ? r.warnings : null);
        closeInsightsSuggestModal();
      })
      .catch(function () {
        setInsightsSuggestMsg('Apply failed', false);
      });
  }

  function nextUniqueTableId(baseName, tables) {
    var base = slugify(baseName, 'custom-table');
    var taken = {};
    (tables || []).forEach(function (t) {
      if (!t || !t.id) return;
      taken[String(t.id)] = true;
    });
    if (!taken[base]) return base;
    var i = 2;
    while (taken[base + '-' + i]) i += 1;
    return base + '-' + i;
  }

  function nextUniqueRuleId(baseName, rules) {
    var base = slugify(baseName, 'rule');
    var taken = {};
    (rules || []).forEach(function (r) {
      if (!r || !r.id) return;
      taken[String(r.id)] = true;
    });
    if (!taken[base]) return base;
    var i = 2;
    while (taken[base + '-' + i]) i += 1;
    return base + '-' + i;
  }

  function renderInsightsVariantsPanel(cfg) {
    var root = document.getElementById('settings-insights-variants-root');
    if (!root) return;
    var normalized = normalizeInsightsVariantsConfig(cfg || insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
    insightsVariantsDraft = deepClone(normalized);
    var tables = Array.isArray(insightsVariantsDraft.tables) ? insightsVariantsDraft.tables : [];
    var html = '' +
      '<div id="settings-insights-variants-errors"></div>' +
      '<div class="mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2">' +
        '<div class="text-muted small">Define table rows by aliases. Includes are required. Overlap is auto-managed (most-specific include wins; earlier rows win ties). Titles outside table scope (e.g. non-length titles for length tables) are skipped. <strong>Table aliases</strong> are synonyms for Shopify option labels (e.g. Size/Chain Length) and help Suggestions merge into the same table.</div>' +
        '<div class="d-flex align-items-center gap-2">' +
          '<button type="button" class="btn btn-outline-primary btn-sm" data-action="add-table">Add custom table</button>' +
        '</div>' +
      '</div>';

    tables.forEach(function (table, tableIdx) {
      if (!table) return;
      var rules = Array.isArray(table.rules) ? table.rules : [];
      var aliasList = Array.isArray(table.aliases) ? table.aliases : [];
      var aliasValue = aliasList.join(', ');
      var aliasChips = buildTableAliasChipsHtml(aliasList, tableIdx);
      var iconValue = String((table.icon || '').trim() || DEFAULT_VARIANTS_TABLE_ICON);
      html += '<div class="card card-sm mb-3" data-table-idx="' + String(tableIdx) + '">' +
        '<div class="card-header d-flex align-items-center justify-content-between flex-wrap gap-2">' +
          '<div class="d-flex align-items-center gap-2 flex-grow-1">' +
            '<input type="text" class="form-control form-control-sm" style="max-width:280px" data-field="table-name" data-table-idx="' + String(tableIdx) + '" value="' + escapeHtml(table.name || '') + '">' +
            '<div class="kexo-alias-chipbox ts-wrapper multi form-control form-control-sm" style="max-width:360px" data-alias-chipbox data-table-idx="' + String(tableIdx) + '" title="Type and press Enter or comma to add. These are Shopify option-name synonyms to merge Suggestions into the same table.">' +
              '<input type="hidden" data-field="table-aliases" data-table-idx="' + String(tableIdx) + '" value="' + escapeHtml(aliasValue) + '">' +
              '<div class="kexo-alias-chipbox-chips ts-control" data-alias-chips data-table-idx="' + String(tableIdx) + '">' + aliasChips + '<input type="text" class="kexo-alias-chipbox-input" data-alias-input data-table-idx="' + String(tableIdx) + '" placeholder="Aliases (Enter or comma)"></div>' +
            '</div>' +
            '<span class="badge bg-secondary-lt">Custom</span>' +
          '</div>' +
          '<div class="d-flex align-items-center gap-2">' +
            '<label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="table-enabled" data-table-idx="' + String(tableIdx) + '"' + (table.enabled !== false ? ' checked' : '') + '><span class="form-check-label small ms-2">Enabled</span></label>' +
            '<button type="button" class="btn btn-sm btn-outline-danger" data-action="remove-table" data-table-idx="' + String(tableIdx) + '">Delete</button>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="text-muted small mb-2">Key: <code>' + escapeHtml(table.id || '') + '</code></div>' +
          (function () {
            var def = (window.KEXO_SETTINGS_MODAL_TABLE_DEFS && window.KEXO_SETTINGS_MODAL_TABLE_DEFS['settings-merge-rules-table']) || {};
            var cols = (def.columns || []).length ? def.columns : [
              { header: 'Output', headerClass: '' },
              { header: 'Include aliases', headerClass: '' },
              { header: 'Actions', headerClass: 'text-end w-1' }
            ];
            var rowsData = rules.length ? rules.map(function (r, i) { return { rule: r, ruleIdx: i }; }) : [{ _empty: true }];
            return buildKexoSettingsTable({
              tableClass: 'table table-sm table-vcenter mb-0',
              columns: cols,
              rows: rowsData,
              renderRow: function (item) {
                if (item && item._empty) {
                  return '<tr><td colspan="3" class="text-secondary small">No rules yet.</td></tr>';
                }
                var rule = item.rule;
                var ruleIdx = item.ruleIdx;
                var mergeBtn = rules.length > 1
                  ? ('<button type="button" class="btn btn-sm btn-outline-primary" data-action="merge-rule" data-table-idx="' + String(tableIdx) + '" data-rule-idx="' + String(ruleIdx) + '">Merge</button>')
                  : '';
                return '<tr data-table-idx="' + String(tableIdx) + '" data-rule-idx="' + String(ruleIdx) + '">' +
                  '<td><input type="text" class="form-control form-control-sm" data-field="rule-label" data-table-idx="' + String(tableIdx) + '" data-rule-idx="' + String(ruleIdx) + '" value="' + escapeHtml(rule.label || '') + '"></td>' +
                  '<td><textarea class="form-control form-control-sm" rows="2" placeholder="One per line (or comma-separated)" data-field="rule-include" data-table-idx="' + String(tableIdx) + '" data-rule-idx="' + String(ruleIdx) + '">' + escapeHtml((rule.include || []).join('\n')) + '</textarea></td>' +
                  '<td class="text-end">' +
                    '<div class="d-inline-flex align-items-center gap-2">' +
                      mergeBtn +
                      '<button type="button" class="btn btn-sm btn-outline-secondary" data-action="remove-rule" data-table-idx="' + String(tableIdx) + '" data-rule-idx="' + String(ruleIdx) + '">Remove</button>' +
                    '</div>' +
                  '</td>' +
                '</tr>';
              }
            });
          })() +
        '<div class="mt-2 d-flex justify-content-between align-items-center flex-wrap gap-2">' +
          '<div class="d-flex align-items-center gap-2 flex-wrap">' +
            '<button type="button" class="btn btn-outline-secondary btn-sm" data-action="add-rule" data-table-idx="' + String(tableIdx) + '">Add row mapping</button>' +
            '<input type="text" class="form-control form-control-sm" style="max-width:260px" data-field="table-icon" data-table-idx="' + String(tableIdx) + '" value="' + escapeHtml(iconValue) + '" placeholder="Icon (e.g. fa-solid fa-grid-round)" aria-label="Table icon (Font Awesome classes)">' +
          '</div>' +
          '<span class="text-muted small">Rule count: ' + String(rules.length) + '</span>' +
        '</div>' +
        '</div>' +
      '</div>';
    });

    root.innerHTML = html;
    renderInsightsVariantsErrors(null);
    setInsightsVariantsResetVariantsVisibility(insightsVariantsDraft);
  }

  function updateDraftValue(tableIdx, ruleIdx, field, rawValue, checked) {
    var tables = insightsVariantsDraft && Array.isArray(insightsVariantsDraft.tables) ? insightsVariantsDraft.tables : [];
    var tIdx = parseInt(String(tableIdx), 10);
    if (!Number.isFinite(tIdx) || tIdx < 0 || tIdx >= tables.length) return;
    var table = tables[tIdx];
    if (!table) return;
    if (field === 'table-name') {
      var oldId = table.id || '';
      table.name = String(rawValue || '').trim().replace(/\s+/g, ' ').slice(0, 80) || ('Table ' + String(tIdx + 1));
      if (!isBuiltinInsightsTableId(oldId)) {
        table.id = nextUniqueTableId(table.name, tables.filter(function (t, idx) { return idx !== tIdx; }));
      }
      return;
    }
    if (field === 'table-enabled') {
      table.enabled = !!checked;
      return;
    }
    if (field === 'table-aliases') {
      table.aliases = parseAliasesFromText(rawValue);
      return;
    }
    if (field === 'table-icon') {
      table.icon = String(rawValue == null ? '' : rawValue).trim().replace(/\s+/g, ' ').slice(0, 120);
      return;
    }
    var rIdx = parseInt(String(ruleIdx), 10);
    var rules = Array.isArray(table.rules) ? table.rules : [];
    if (!Number.isFinite(rIdx) || rIdx < 0 || rIdx >= rules.length) return;
    var rule = rules[rIdx];
    if (!rule) return;
    if (field === 'rule-label') {
      rule.label = String(rawValue || '').trim().replace(/\s+/g, ' ').slice(0, 80) || ('Rule ' + String(rIdx + 1));
      return;
    }
    if (field === 'rule-include') {
      rule.include = parseAliasesFromText(rawValue);
      return;
    }
    if (field === 'rule-exclude') {
      rule.exclude = parseAliasesFromText(rawValue);
    }
  }

  function syncInsightsVariantsDraftFromDom() {
    var root = document.getElementById('settings-insights-variants-root');
    if (!root) return;
    var draft = insightsVariantsDraft && typeof insightsVariantsDraft === 'object'
      ? deepClone(insightsVariantsDraft)
      : normalizeInsightsVariantsConfig(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
    insightsVariantsDraft = draft;

    root.querySelectorAll('.card[data-table-idx]').forEach(function (card) {
      if (!card) return;
      var tIdx = card.getAttribute('data-table-idx');
      var nameEl = card.querySelector('input[data-field="table-name"][data-table-idx="' + String(tIdx) + '"]');
      var aliasesEl = card.querySelector('input[data-field="table-aliases"][data-table-idx="' + String(tIdx) + '"]');
      var iconEl = card.querySelector('input[data-field="table-icon"][data-table-idx="' + String(tIdx) + '"]');
      var enabledEl = card.querySelector('input[data-field="table-enabled"][data-table-idx="' + String(tIdx) + '"]');
      if (nameEl) updateDraftValue(tIdx, null, 'table-name', nameEl.value, false);
      if (aliasesEl) updateDraftValue(tIdx, null, 'table-aliases', aliasesEl.value, false);
      if (iconEl) updateDraftValue(tIdx, null, 'table-icon', iconEl.value, false);
      if (enabledEl) updateDraftValue(tIdx, null, 'table-enabled', '', !!enabledEl.checked);

      card.querySelectorAll('tr[data-rule-idx]').forEach(function (tr) {
        if (!tr) return;
        var rIdx = tr.getAttribute('data-rule-idx');
        var labelEl = tr.querySelector('input[data-field="rule-label"]');
        var includeEl = tr.querySelector('textarea[data-field="rule-include"]');
        if (labelEl) updateDraftValue(tIdx, rIdx, 'rule-label', labelEl.value, false);
        if (includeEl) updateDraftValue(tIdx, rIdx, 'rule-include', includeEl.value, false);
      });
    });

    insightsVariantsDraft = normalizeInsightsVariantsConfig(insightsVariantsDraft);
  }

  function applyInsightsVariantsResetNow() {
    var ok = true;
    try {
      ok = window.confirm('Reset Variants will remove ALL variant mapping tables, rules, and ignores. This does NOT delete any database data. Continue?');
    } catch (_) { ok = false; }
    if (!ok) return;
    insightsVariantsDraft = defaultInsightsVariantsConfigV1();
    setInsightsVariantsWarnings(null);
    renderInsightsVariantsPanel(insightsVariantsDraft);
    persistInsightsVariantsConfig(insightsVariantsDraft, { successText: 'Variants reset.' });
  }

  function getAliasChipboxEls(rootEl, tableIdx) {
    if (!rootEl) return null;
    var idx = String(tableIdx);
    var box = rootEl.querySelector('[data-alias-chipbox][data-table-idx="' + idx + '"]');
    if (!box) return null;
    var hidden = box.querySelector('input[data-field="table-aliases"][data-table-idx="' + idx + '"]');
    var chips = box.querySelector('[data-alias-chips][data-table-idx="' + idx + '"]');
    var input = box.querySelector('input[data-alias-input][data-table-idx="' + idx + '"]');
    return { box: box, hidden: hidden, chips: chips, input: input };
  }

  function setAliasChipboxAliases(rootEl, tableIdx, aliasList) {
    var els = getAliasChipboxEls(rootEl, tableIdx);
    if (!els || !els.hidden || !els.chips) return;
    var next = normalizeTokenList(aliasList);
    els.hidden.value = next.join(', ');
    try { els.hidden.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    els.chips.innerHTML = buildTableAliasChipsHtml(next, tableIdx);
  }

  function addAliasChipboxFromText(rootEl, tableIdx, rawText) {
    var els = getAliasChipboxEls(rootEl, tableIdx);
    if (!els || !els.hidden) return;
    var current = parseAliasesFromText(els.hidden.value || '');
    var incoming = parseAliasesFromText(rawText || '');
    if (!incoming.length) return;
    var next = normalizeTokenList(current.concat(incoming));
    setAliasChipboxAliases(rootEl, tableIdx, next);
  }

  function removeAliasChipboxToken(rootEl, tableIdx, rawToken) {
    var token = String(rawToken == null ? '' : rawToken).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    if (!token) return;
    var els = getAliasChipboxEls(rootEl, tableIdx);
    if (!els || !els.hidden) return;
    var current = parseAliasesFromText(els.hidden.value || '');
    if (!current.length) return;
    var next = current.filter(function (t) { return String(t || '') !== token; });
    setAliasChipboxAliases(rootEl, tableIdx, next);
  }

  function wireInsightsVariantsEditor() {
    var root = document.getElementById('settings-insights-variants-root');
    if (!root || root.getAttribute('data-insights-variants-wired') === '1') return;
    root.setAttribute('data-insights-variants-wired', '1');

    root.addEventListener('click', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target || !target.closest) return;
      if (target.closest('button[data-action]')) return;
      var box = target.closest('[data-alias-chipbox]');
      if (!box) return;
      var input = box.querySelector('input[data-alias-input]');
      if (!input) return;
      try { input.focus(); } catch (_) {}
    });

    root.addEventListener('click', function (e) {
      var btn = e && e.target && e.target.closest ? e.target.closest('button[data-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-action') || '';
      var tIdx = parseInt(String(btn.getAttribute('data-table-idx') || ''), 10);
      var rIdx = parseInt(String(btn.getAttribute('data-rule-idx') || ''), 10);
      var cfg = insightsVariantsDraft && typeof insightsVariantsDraft === 'object'
        ? insightsVariantsDraft
        : normalizeInsightsVariantsConfig(defaultInsightsVariantsConfigV1());
      var tables = Array.isArray(cfg.tables) ? cfg.tables : [];

      if (action === 'add-table') {
        var id = nextUniqueTableId('custom-table', tables);
        tables.push({
          id: id,
          name: 'Custom Table',
          enabled: true,
          order: tables.length + 1,
          aliases: [],
          icon: DEFAULT_VARIANTS_TABLE_ICON,
          rules: [
            { id: 'new-rule', label: 'New Rule', include: [], exclude: [] },
          ],
          ignored: [],
        });
        insightsVariantsDraft = normalizeInsightsVariantsConfig(cfg);
        renderInsightsVariantsPanel(insightsVariantsDraft);
        return;
      }

      if (!Number.isFinite(tIdx) || tIdx < 0 || tIdx >= tables.length) return;
      var table = tables[tIdx];
      if (!table) return;

      if (action === 'remove-table-alias') {
        var token = btn.getAttribute('data-alias') || '';
        removeAliasChipboxToken(root, tIdx, token);
        return;
      }

      if (action === 'remove-table') {
        if (isBuiltinInsightsTableId(table.id)) return;
        tables.splice(tIdx, 1);
        insightsVariantsDraft = normalizeInsightsVariantsConfig(cfg);
        renderInsightsVariantsPanel(insightsVariantsDraft);
        return;
      }

      if (action === 'merge-rule') {
        if (!Array.isArray(table.rules)) table.rules = [];
        if (!Number.isFinite(rIdx) || rIdx < 0 || rIdx >= table.rules.length) return;
        openInsightsMergeModal({ tableIdx: tIdx, ruleIdx: rIdx });
        return;
      }

      if (action === 'add-rule') {
        if (!Array.isArray(table.rules)) table.rules = [];
        var nextRuleId = nextUniqueRuleId('new-rule', table.rules);
        table.rules.push({ id: nextRuleId, label: 'New Rule', include: [], exclude: [] });
        insightsVariantsDraft = normalizeInsightsVariantsConfig(cfg);
        renderInsightsVariantsPanel(insightsVariantsDraft);
        return;
      }

      if (action === 'remove-rule') {
        if (!Array.isArray(table.rules)) table.rules = [];
        if (!Number.isFinite(rIdx) || rIdx < 0 || rIdx >= table.rules.length) return;
        table.rules.splice(rIdx, 1);
        insightsVariantsDraft = normalizeInsightsVariantsConfig(cfg);
        renderInsightsVariantsPanel(insightsVariantsDraft);
      }
    });

    root.addEventListener('keydown', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target || !target.getAttribute) return;
      if (target.getAttribute('data-alias-input') == null) return;
      var tableIdx = target.getAttribute('data-table-idx');
      var tIdx = parseInt(String(tableIdx || ''), 10);
      if (!Number.isFinite(tIdx) || tIdx < 0) return;
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addAliasChipboxFromText(root, tIdx, target.value || '');
        try { target.value = ''; } catch (_) {}
        return;
      }
    });

    root.addEventListener('focusout', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target || !target.getAttribute) return;
      if (target.getAttribute('data-alias-input') == null) return;
      var v = String(target.value || '').trim();
      if (!v) return;
      var tableIdx = target.getAttribute('data-table-idx');
      var tIdx = parseInt(String(tableIdx || ''), 10);
      if (!Number.isFinite(tIdx) || tIdx < 0) return;
      addAliasChipboxFromText(root, tIdx, v);
      try { target.value = ''; } catch (_) {}
    });

    root.addEventListener('paste', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target || !target.getAttribute) return;
      if (target.getAttribute('data-alias-input') == null) return;
      var text = '';
      try { text = (e.clipboardData && e.clipboardData.getData) ? String(e.clipboardData.getData('text') || '') : ''; } catch (_) { text = ''; }
      if (!text) return;
      e.preventDefault();
      var tableIdx = target.getAttribute('data-table-idx');
      var tIdx = parseInt(String(tableIdx || ''), 10);
      if (!Number.isFinite(tIdx) || tIdx < 0) return;
      addAliasChipboxFromText(root, tIdx, text);
      try { target.value = ''; } catch (_) {}
    });

    root.addEventListener('change', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target) return;
      var field = target.getAttribute('data-field') || '';
      if (!field) return;
      var tableIdx = target.getAttribute('data-table-idx');
      var ruleIdx = target.getAttribute('data-rule-idx');
      updateDraftValue(tableIdx, ruleIdx, field, target.value, target.checked);
      if (field === 'table-name') {
        insightsVariantsDraft = normalizeInsightsVariantsConfig(insightsVariantsDraft);
        renderInsightsVariantsPanel(insightsVariantsDraft);
      }
    });
  }

  function wireInsightsVariantsSaveReset() {
    var saveBtn = document.getElementById('settings-insights-variants-save-btn');
    var resetVariantsBtn = document.getElementById('settings-insights-variants-reset-variants-btn');
    if (!saveBtn) return;

    if (saveBtn.getAttribute('data-variants-save-wired') !== '1') {
      saveBtn.setAttribute('data-variants-save-wired', '1');
      saveBtn.addEventListener('click', function () {
        syncInsightsVariantsDraftFromDom();
        var payloadCfg = normalizeInsightsVariantsConfig(insightsVariantsDraft || insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
        persistInsightsVariantsConfig(payloadCfg);
      });
    }

    if (resetVariantsBtn && resetVariantsBtn.getAttribute('data-variants-reset-wired') !== '1') {
      resetVariantsBtn.setAttribute('data-variants-reset-wired', '1');
      resetVariantsBtn.addEventListener('click', function () {
        if (resetVariantsBtn.classList.contains('is-hidden')) return;
        applyInsightsVariantsResetNow();
      });
    }
  }

  function wireInsightsVariantsIgnoreModal() {
    var openBtn = document.getElementById('settings-insights-variants-ignore-btn');
    var modal = document.getElementById('settings-insights-variants-ignore-modal');
    var saveBtn = document.getElementById('settings-insights-variants-ignore-save-btn');
    var msgEl = document.getElementById('settings-insights-variants-ignore-msg');
    if (!openBtn || !modal || !saveBtn) return;

    if (openBtn.getAttribute('data-ignore-wired') !== '1') {
      openBtn.setAttribute('data-ignore-wired', '1');
      openBtn.addEventListener('click', function () {
        openInsightsIgnoreModal();
      });
    }

    if (modal.getAttribute('data-ignore-wired') !== '1') {
      modal.setAttribute('data-ignore-wired', '1');
      modal.addEventListener('click', function (e) {
        var target = e && e.target ? e.target : null;
        if (!target) return;
        if (target === modal) {
          closeInsightsIgnoreModal();
          return;
        }
        var closeBtn = target.closest ? target.closest('[data-close-insights-ignore]') : null;
        if (closeBtn) {
          closeInsightsIgnoreModal();
          return;
        }
        var removeBtn = target.closest ? target.closest('button[data-action="remove-ignore"][data-table-idx][data-ignore-idx]') : null;
        if (!removeBtn) return;
        var tIdx = parseInt(String(removeBtn.getAttribute('data-table-idx') || ''), 10);
        var iIdx = parseInt(String(removeBtn.getAttribute('data-ignore-idx') || ''), 10);
        var cfg = insightsVariantsDraft && typeof insightsVariantsDraft === 'object'
          ? insightsVariantsDraft
          : normalizeInsightsVariantsConfig(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
        var tables = Array.isArray(cfg.tables) ? cfg.tables : [];
        if (!Number.isFinite(tIdx) || tIdx < 0 || tIdx >= tables.length) return;
        var table = tables[tIdx];
        if (!table || !Array.isArray(table.ignored)) return;
        if (!Number.isFinite(iIdx) || iIdx < 0 || iIdx >= table.ignored.length) return;
        table.ignored.splice(iIdx, 1);
        insightsVariantsDraft = normalizeInsightsVariantsConfig(cfg);
        renderInsightsVariantsPanel(insightsVariantsDraft);
        renderInsightsIgnoreModalBody();
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!modal.classList.contains('show')) return;
        closeInsightsIgnoreModal();
      });
    }

    if (saveBtn.getAttribute('data-ignore-save-wired') !== '1') {
      saveBtn.setAttribute('data-ignore-save-wired', '1');
      saveBtn.addEventListener('click', function () {
        syncInsightsVariantsDraftFromDom();
        var payloadCfg = normalizeInsightsVariantsConfig(insightsVariantsDraft || insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
        if (msgEl) {
          msgEl.textContent = 'Saving...';
          msgEl.className = 'form-hint text-primary';
        }
        persistInsightsVariantsConfig(payloadCfg, {
          onSuccess: function () {
            renderInsightsIgnoreModalBody();
            if (msgEl) {
              msgEl.textContent = 'Saved.';
              msgEl.className = 'form-hint text-success';
            }
          },
          onFailure: function () {
            if (msgEl) {
              msgEl.textContent = 'Save failed. Check Insights -> Variants errors.';
              msgEl.className = 'form-hint text-danger';
            }
          },
        });
      });
    }
  }

  function wireInsightsVariantsSuggestModal() {
    var openBtn = document.getElementById('settings-insights-variants-suggest-btn');
    var modal = document.getElementById('settings-insights-variants-suggest-modal');
    var applyBtn = document.getElementById('settings-insights-variants-suggest-apply-btn');
    var refreshBtn = document.getElementById('settings-insights-variants-suggest-refresh-btn');
    if (!openBtn || !modal || !applyBtn) return;

    if (openBtn.getAttribute('data-suggest-wired') !== '1') {
      openBtn.setAttribute('data-suggest-wired', '1');
      openBtn.addEventListener('click', function () {
        openInsightsSuggestModal();
      });
    }

    if (modal.getAttribute('data-suggest-wired') !== '1') {
      modal.setAttribute('data-suggest-wired', '1');
      modal.addEventListener('click', function (e) {
        var target = e && e.target ? e.target : null;
        if (!target) return;
        if (target === modal) {
          closeInsightsSuggestModal();
          return;
        }
        var closeBtn = target.closest ? target.closest('[data-close-insights-suggest]') : null;
        if (closeBtn) {
          closeInsightsSuggestModal();
        }
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!modal.classList.contains('show')) return;
        closeInsightsSuggestModal();
      });
    }

    if (applyBtn.getAttribute('data-suggest-apply-wired') !== '1') {
      applyBtn.setAttribute('data-suggest-apply-wired', '1');
      applyBtn.addEventListener('click', function () {
        applySelectedSuggestions();
      });
    }

    if (refreshBtn && refreshBtn.getAttribute('data-suggest-refresh-wired') !== '1') {
      refreshBtn.setAttribute('data-suggest-refresh-wired', '1');
      refreshBtn.addEventListener('click', function () {
        if (!modal.classList.contains('show')) return;
        loadInsightsVariantsSuggestionsIntoModal('30d', { refresh: true });
      });
    }
  }

  function wireInsightsVariantsMergeModal() {
    var modal = document.getElementById('settings-insights-variants-merge-modal');
    var applyBtn = document.getElementById('settings-insights-variants-merge-apply-btn');
    if (!modal || !applyBtn) return;

    if (modal.getAttribute('data-merge-wired') !== '1') {
      modal.setAttribute('data-merge-wired', '1');
      modal.addEventListener('click', function (e) {
        var target = e && e.target ? e.target : null;
        if (!target) return;
        if (target === modal) {
          closeInsightsMergeModal();
          return;
        }
        var closeBtn = target.closest ? target.closest('[data-close-insights-merge]') : null;
        if (closeBtn) closeInsightsMergeModal();
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!modal.classList.contains('show')) return;
        closeInsightsMergeModal();
      });
    }

    if (applyBtn.getAttribute('data-merge-apply-wired') !== '1') {
      applyBtn.setAttribute('data-merge-apply-wired', '1');
      applyBtn.addEventListener('click', function () {
        applyInsightsMerge();
      });
    }
  }

  function wireInsightsVariantsWarningsModal() {
    var openBtn = document.getElementById('settings-insights-variants-warnings-btn');
    var modal = document.getElementById('settings-insights-variants-warnings-modal');
    if (!openBtn || !modal) return;

    if (openBtn.getAttribute('data-warnings-wired') !== '1') {
      openBtn.setAttribute('data-warnings-wired', '1');
      openBtn.addEventListener('click', function () {
        if (openBtn.disabled) return;
        openInsightsWarningsModal();
      });
    }

    if (modal.getAttribute('data-warnings-wired') !== '1') {
      modal.setAttribute('data-warnings-wired', '1');
      modal.addEventListener('click', function (e) {
        var target = e && e.target ? e.target : null;
        if (!target) return;
        if (target === modal) {
          closeInsightsWarningsModal();
          return;
        }
        var closeBtn = target.closest ? target.closest('[data-close-insights-warnings]') : null;
        if (closeBtn) {
          closeInsightsWarningsModal();
        }
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!modal.classList.contains('show')) return;
        closeInsightsWarningsModal();
      });
    }
  }

  function moveRow(row, dir) {
    if (!row || !row.parentElement) return;
    var tbody = row.parentElement;
    if (dir === 'up') {
      var prev = row.previousElementSibling;
      if (prev) tbody.insertBefore(row, prev);
    } else if (dir === 'down') {
      var next = row.nextElementSibling;
      if (next) tbody.insertBefore(next, row);
    }
  }

  function wireReorderButtons(rootEl) {
    if (!rootEl) return;
    if (rootEl.getAttribute('data-kexo-reorder-wired') === '1') return;
    try { rootEl.setAttribute('data-kexo-reorder-wired', '1'); } catch (_) {}
    rootEl.addEventListener('click', function (e) {
      var target = e && e.target ? e.target : null;
      var btn = target && target.closest ? target.closest('button[data-action]') : null;
      if (!btn) return;
      var action = btn.getAttribute('data-action') || '';
      if (action !== 'up' && action !== 'down') return;
      var row = btn.closest('tr[data-kpi-key], tr[data-range-key], [data-layout-table-id]');
      if (!row) return;
      e.preventDefault();
      moveRow(row, action);
      if (row.matches && row.matches('tr[data-kpi-key]')) {
        try { renderKpiPlacementPreview(); } catch (_) {}
      }
    });
  }

  function renderKpiTable(rootId, items, kind) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var rows = Array.isArray(items) ? items : [];
    var tableColumns = [
      { header: 'On', headerClass: 'w-1' },
      { header: 'Label', headerClass: '' },
    ];
    tableColumns.push({ header: 'Key', headerClass: 'text-muted' });
    tableColumns.push({ header: 'Order', headerClass: 'text-end w-1' });
    var html;
    if (typeof window.buildKexoSettingsTable === 'function') {
      html = window.buildKexoSettingsTable({
        tableClass: 'table table-sm table-vcenter mb-0',
        columns: tableColumns,
        rows: rows,
        renderRow: function (it) {
          if (!it) return '';
          var key = String(it.key || '').trim().toLowerCase();
          if (!key) return '';
          var label = it.label != null ? String(it.label) : key;
          var enabled = !!it.enabled;
          var profitLocked = key === 'profit' && !isProfitKpiGateEnabled();
          if (profitLocked) enabled = false;
          return '<tr data-kpi-key="' + escapeHtml(key) + '">' +
            '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + (profitLocked ? ' disabled' : '') + '></label></td>' +
            '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
            '<td class="text-muted small">' + escapeHtml(key) + '</td>' +
            '<td class="text-end"><div class="btn-group btn-group-sm" role="group" aria-label="Reorder">' +
              '<button type="button" class="btn btn-outline-secondary" data-action="up" aria-label="Move up">\u2191</button>' +
              '<button type="button" class="btn btn-outline-secondary" data-action="down" aria-label="Move down">\u2193</button>' +
            '</div></td>' +
          '</tr>';
        }
      });
    } else {
      html = '<div class="table-responsive">' +
        '<table class="table table-sm table-vcenter mb-0">' +
        '<thead><tr><th class="w-1">On</th><th>Label</th><th class="text-muted">Key</th><th class="text-end w-1">Order</th></tr></thead><tbody>';
      rows.forEach(function (it) {
        if (!it) return;
        var key = String(it.key || '').trim().toLowerCase();
        if (!key) return;
        var label = it.label != null ? String(it.label) : key;
        var enabled = !!it.enabled;
        var profitLocked = key === 'profit' && !isProfitKpiGateEnabled();
        if (profitLocked) enabled = false;
        html += '<tr data-kpi-key="' + escapeHtml(key) + '">' +
          '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + (profitLocked ? ' disabled' : '') + '></label></td>' +
          '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
          '<td class="text-muted small">' + escapeHtml(key) + '</td>' +
          '<td class="text-end"><div class="btn-group btn-group-sm" role="group" aria-label="Reorder">' +
            '<button type="button" class="btn btn-outline-secondary" data-action="up" aria-label="Move up">\u2191</button>' +
            '<button type="button" class="btn btn-outline-secondary" data-action="down" aria-label="Move down">\u2193</button>' +
          '</div></td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }
    root.innerHTML = html;
    wireReorderButtons(root);
    if (String(kind || '').trim().toLowerCase() === 'dashboard') renderKpiPlacementPreview();
    if (String(kind || '').trim().toLowerCase() === 'dashboard' && root.getAttribute('data-kpi-preview-wired') !== '1') {
      root.setAttribute('data-kpi-preview-wired', '1');
      root.addEventListener('change', function () {
        try { renderKpiPlacementPreview(); } catch (_) {}
      });
      root.addEventListener('input', function () {
        try { renderKpiPlacementPreview(); } catch (_) {}
      });
    }
  }

  function renderDateRangesTable(rootId, items) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var rows = Array.isArray(items) ? items : [];
    var html;
    if (typeof window.buildKexoSettingsTable === 'function') {
      html = window.buildKexoSettingsTable({
        tableClass: 'table table-sm table-vcenter mb-0',
        columns: [
          { header: 'On', headerClass: 'w-1' },
          { header: 'Label', headerClass: '' },
          { header: 'Key', headerClass: 'text-muted' },
          { header: 'Order', headerClass: 'text-end w-1' }
        ],
        rows: rows,
        renderRow: function (it) {
          if (!it) return '';
          var key = String(it.key || '').trim().toLowerCase();
          if (!key) return '';
          var label = it.label != null ? String(it.label) : key;
          var enabled = !!it.enabled;
          var locked = key === 'today' || key === 'custom';
          return '<tr data-range-key="' + escapeHtml(key) + '">' +
            '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + (locked ? ' disabled' : '') + '></label></td>' +
            '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
            '<td class="text-muted small">' + escapeHtml(key) + '</td>' +
            '<td class="text-end"><div class="btn-group btn-group-sm" role="group" aria-label="Reorder">' +
              '<button type="button" class="btn btn-outline-secondary" data-action="up" aria-label="Move up">\u2191</button>' +
              '<button type="button" class="btn btn-outline-secondary" data-action="down" aria-label="Move down">\u2193</button>' +
            '</div></td>' +
          '</tr>';
        }
      });
    } else {
      html = '<div class="table-responsive">' +
        '<table class="table table-sm table-vcenter mb-0">' +
        '<thead><tr><th class="w-1">On</th><th>Label</th><th class="text-muted">Key</th><th class="text-end w-1">Order</th></tr></thead><tbody>';
      rows.forEach(function (it) {
        if (!it) return;
        var key = String(it.key || '').trim().toLowerCase();
        if (!key) return;
        var label = it.label != null ? String(it.label) : key;
        var enabled = !!it.enabled;
        var locked = key === 'today' || key === 'custom';
        html += '<tr data-range-key="' + escapeHtml(key) + '">' +
          '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + (locked ? ' disabled' : '') + '></label></td>' +
          '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
          '<td class="text-muted small">' + escapeHtml(key) + '</td>' +
          '<td class="text-end"><div class="btn-group btn-group-sm" role="group" aria-label="Reorder">' +
            '<button type="button" class="btn btn-outline-secondary" data-action="up" aria-label="Move up">\u2191</button>' +
            '<button type="button" class="btn btn-outline-secondary" data-action="down" aria-label="Move down">\u2193</button>' +
          '</div></td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }
    root.innerHTML = html;
    wireReorderButtons(root);
  }

  function readKpiTable(rootId, kind) {
    var root = document.getElementById(rootId);
    if (!root) return [];
    var out = [];
    root.querySelectorAll('tr[data-kpi-key]').forEach(function (tr) {
      var key = (tr.getAttribute('data-kpi-key') || '').trim().toLowerCase();
      if (!key) return;
      var enabledEl = tr.querySelector('input[data-field="enabled"]');
      var labelEl = tr.querySelector('input[data-field="label"]');
      var row = {
        key: key,
        enabled: !!(enabledEl && enabledEl.checked),
        label: labelEl && labelEl.value != null ? String(labelEl.value).trim() : key,
      };
      out.push(row);
    });
    return out;
  }

  function renderKpiPlacementPreview() {
    var root = document.getElementById('settings-kpis-placement-preview');
    if (!root) return;
    var list = []
    function slice(start, end) {
      return list.slice(start, end).map(function (label) {
        return '<span class="badge bg-secondary-lt">' + escapeHtml(label) + '</span>';
      }).join(' ');
    }
    function row(title, rangeText, labelsHtml) {
      return '<div class="mb-2"><div class="text-muted small mb-1">' + escapeHtml(title) + '</div>' +
        '<div class="small mb-1">' + escapeHtml(rangeText) + '</div>' +
        '<div class="d-flex flex-wrap gap-1">' + (labelsHtml || '<span class="text-muted small">None</span>') + '</div></div>';
    }
    var desktopTop = slice(0, 8);
    var desktopMid = slice(8, 12);
    var desktopLower = slice(12);
    var mobileTop = slice(0, 4);
    var mobileMid = slice(4, 8);
    var mobileLower = slice(8);
    root.innerHTML =
      '<div class="col-12 col-xl-6"><div class="card card-sm h-100"><div class="card-body">' +
      '<div class="fw-medium mb-2">Desktop/Large screens</div>' +
      row('Left KPI block', 'First 8 enabled KPIs', desktopTop) +
      row('Under first 2 tables', 'Next 4 KPIs', desktopMid) +
      row('Under last 2 tables', 'Remaining KPIs', desktopLower) +
      '</div></div></div>' +
      '<div class="col-12 col-xl-6"><div class="card card-sm h-100"><div class="card-body">' +
      '<div class="fw-medium mb-2">Small screens</div>' +
      row('Top KPI block', 'First 4 enabled KPIs', mobileTop) +
      row('Under first 2 tables', 'Next 4 KPIs', mobileMid) +
      row('Under last 2 tables', 'Remaining KPIs', mobileLower) +
      '</div></div></div>';
  }

  function readDateRangesTable(rootId) {
    var root = document.getElementById(rootId);
    if (!root) return [];
    var out = [];
    root.querySelectorAll('tr[data-range-key]').forEach(function (tr) {
      var key = (tr.getAttribute('data-range-key') || '').trim().toLowerCase();
      if (!key) return;
      var enabledEl = tr.querySelector('input[data-field="enabled"]');
      var labelEl = tr.querySelector('input[data-field="label"]');
      out.push({
        key: key,
        enabled: !!(enabledEl && enabledEl.checked),
        label: labelEl && labelEl.value != null ? String(labelEl.value).trim() : key,
      });
    });
    return out;
  }

  function renderKpisUiPanel(cfg) {
    var headRoot = document.getElementById('settings-kpis-header-root');
    var rangesRoot = document.getElementById('settings-date-ranges-root');
    if (!headRoot || !rangesRoot) return;
    var def = defaultKpiUiConfigV1();
    var c = cfg && typeof cfg === 'object' ? cfg : def;
    var options = c.options || {};
    var condensed = options.condensed || {};
    var general = options.general || {};

    var optCondDelta = document.getElementById('settings-kpi-opt-condensed-delta');
    var optCondProg = document.getElementById('settings-kpi-opt-condensed-progress');
    var optCondSpark = document.getElementById('settings-kpi-opt-condensed-sparkline');
    var generalDateFormatEl = document.getElementById('settings-general-date-format');
    if (optCondDelta) optCondDelta.checked = condensed.showDelta !== false;
    if (optCondProg) optCondProg.checked = condensed.showProgress !== false;
    if (optCondSpark) optCondSpark.checked = condensed.showSparkline !== false;
    if (generalDateFormatEl) generalDateFormatEl.value = normalizeDateLabelFormat(general.dateLabelFormat);

    // Header KPI strip visibility per page.
    var defPages = (def.headerStrip && def.headerStrip.pages && typeof def.headerStrip.pages === 'object') ? def.headerStrip.pages : {};
    var pages = (c.headerStrip && c.headerStrip.pages && typeof c.headerStrip.pages === 'object') ? c.headerStrip.pages : {};
    // Backwards compatibility: treat legacy Traffic keys as Acquisition keys when missing.
    var mergedPages = Object.assign({}, pages);
    if (typeof mergedPages.attribution !== 'boolean' && typeof mergedPages.channels === 'boolean') mergedPages.attribution = mergedPages.channels;
    if (typeof mergedPages.devices !== 'boolean' && typeof mergedPages.type === 'boolean') mergedPages.devices = mergedPages.type;
    try {
      document.querySelectorAll('[data-kpi-header-strip-page]').forEach(function (el) {
        var k = String(el.getAttribute('data-kpi-header-strip-page') || '').trim().toLowerCase();
        if (!k) return;
        var v = (typeof mergedPages[k] === 'boolean') ? mergedPages[k] : defPages[k];
        if (typeof v !== 'boolean') v = true;
        el.checked = v !== false;
      });
    } catch (_) {}

    renderKpiTable('settings-kpis-header-root', (c.kpis && c.kpis.header) ? c.kpis.header : [], 'header');
    renderDateRangesTable('settings-date-ranges-root', c.dateRanges || []);
  }

  function readHeaderStripPagesFromDom() {
    var def = defaultKpiUiConfigV1();
    var defPages = (def.headerStrip && def.headerStrip.pages && typeof def.headerStrip.pages === 'object') ? def.headerStrip.pages : {};
    var out = {};
    Object.keys(defPages).forEach(function (k) {
      out[k] = defPages[k] !== false;
    });
    try {
      document.querySelectorAll('[data-kpi-header-strip-page]').forEach(function (el) {
        var k = String(el.getAttribute('data-kpi-header-strip-page') || '').trim().toLowerCase();
        if (!k) return;
        out[k] = !!el.checked;
      });
    } catch (_) {}
    return out;
  }

  function buildKpiUiConfigFromDom() {
    var optCondDelta = document.getElementById('settings-kpi-opt-condensed-delta');
    var optCondProg = document.getElementById('settings-kpi-opt-condensed-progress');
    var optCondSpark = document.getElementById('settings-kpi-opt-condensed-sparkline');
    var generalDateFormatEl = document.getElementById('settings-general-date-format');
    return {
      v: 1,
      options: {
        condensed: {
          showDelta: !!(optCondDelta && optCondDelta.checked),
          showProgress: !!(optCondProg && optCondProg.checked),
          showSparkline: !!(optCondSpark && optCondSpark.checked),
        },
        general: {
          dateLabelFormat: normalizeDateLabelFormat(generalDateFormatEl && generalDateFormatEl.value),
        },
      },
      headerStrip: {
        pages: readHeaderStripPagesFromDom(),
      },
      kpis: {
        header: readKpiTable('settings-kpis-header-root', 'header'),
      },
      dateRanges: readDateRangesTable('settings-date-ranges-root'),
    };
  }

  function wireKpisSaveReset() {
    var saveBtn = document.getElementById('settings-kpis-save-btn');
    var resetBtn = document.getElementById('settings-kpis-reset-btn');
    var msgEl = document.getElementById('settings-kpis-msg');
    if (!saveBtn || !resetBtn) return;

    function setMsg(t, ok) {
      if (!msgEl) return;
      msgEl.textContent = t || '';
      msgEl.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
    }

    saveBtn.addEventListener('click', function () {
      var cfg = buildKpiUiConfigFromDom();
      setMsg('Saving\u2026', true);
      saveSettings({ kpiUiConfig: cfg })
        .then(function (r) {
          if (r && r.ok) {
            kpiUiConfigCache = r.kpiUiConfig || cfg;
            setMsg('Saved.', true);
            try {
              if (window && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('kexo:kpiUiConfigUpdated', { detail: kpiUiConfigCache }));
              }
            } catch (_) {}
          } else {
            setMsg((r && r.error) ? String(r.error) : 'Save failed', false);
          }
        })
        .catch(function () { setMsg('Save failed', false); });
    });

    resetBtn.addEventListener('click', function () {
      renderKpisUiPanel(defaultKpiUiConfigV1());
      setMsg('Defaults loaded. Press Save to apply.', true);
    });
  }

  function init() {
    try {
      var tooltipRoot = document.querySelector('.page-body') || document.body;
      if (typeof window.initKexoTooltips === 'function') window.initKexoTooltips(tooltipRoot);
    } catch (_) {}

    function syncFromUrl() {
      var tab = getTabFromQuery() || getTabFromHash() || 'kexo';
      // Fail-safe: if the URL explicitly requests cost-expenses, honor it on direct loads.
      // This prevents falling back to Kexo when query parsing or DOM timing is off.
      try {
        var params = new URLSearchParams(window.location.search || '');
        var requested = String(params.get('tab') || '').trim().toLowerCase();
        if (requested === 'cost-expenses' && document.getElementById('settings-tab-cost-expenses')) {
          tab = 'cost-expenses';
        }
      } catch (_) {}
      if (initialKexoSubTab) activeKexoSubTab = initialKexoSubTab;
      if (initialLayoutSubTab) activeLayoutSubTab = initialLayoutSubTab;
      if (initialIntegrationsSubTab) activeIntegrationsSubTab = initialIntegrationsSubTab;
      if (initialAttributionSubTab) activeAttributionSubTab = initialAttributionSubTab;
      if (initialAdminSubTab) activeAdminSubTab = initialAdminSubTab;
      if (initialCostExpensesSubTab) activeCostExpensesSubTab = initialCostExpensesSubTab;

      activateTab(tab);
      try {
        if (tab === 'kexo' && kexoTabsetApi) kexoTabsetApi.activate(getActiveKexoSubTab());
        else if (tab === 'layout' && layoutTabsetApi) layoutTabsetApi.activate(getActiveLayoutSubTab());
        else if (tab === 'integrations' && integrationsTabsetApi) integrationsTabsetApi.activate(getActiveIntegrationsSubTab());
        else if (tab === 'attribution' && attributionTabsetApi) attributionTabsetApi.activate(getActiveAttributionSubTab());
        else if (tab === 'admin' && adminTabsetApi) adminTabsetApi.activate(getActiveAdminSubTab());
      } catch (_) {}
    }

    prepareSettingsMainTabs();
    // Sync the active panel from the URL *before* wiring sub-tab tabsets.
    // Some tabsets fire `onActivate` immediately during initialization; if the DOM default
    // panel is still active (Kexo → General), that can overwrite deep-links via updateUrl().
    syncFromUrl();
    // Layout is now a multi-tab section (Tables / Charts / KPIs). If the URL used legacy
    // `tab=charts` or `tab=kpis`, preselect the right Layout subtab BEFORE activating the panel.
    wireLayoutSubTabs(initialLayoutSubTab);
    wireKexoSubTabs(initialKexoSubTab);
    wireIntegrationsSubTabs();
    wireAttributionSubTabs(initialAttributionSubTab);
    wireAdminSubTabs(initialAdminSubTab);
    initSettingsMobileMenu();

    var tablist = document.getElementById('settings-category-tablist');
    if (tablist) {
      tablist.addEventListener('click', function (e) {
        var a = null;
        try { a = e && e.target && e.target.closest ? e.target.closest('a[data-settings-tab]') : null; } catch (_) {}
        if (!a || !tablist.contains(a)) return;
        try { e.preventDefault(); } catch (_) {}
        activateFromSettingsNavAnchor(a, { scrollIntoView: isSettingsMobileViewport() });
      });
    }

    if (document.documentElement.getAttribute('data-kexo-cost-expenses-sync-bound') !== '1') {
      document.documentElement.setAttribute('data-kexo-cost-expenses-sync-bound', '1');
      window.addEventListener('kexo:costExpensesTabChanged', function (e) {
        var key = e && e.detail && e.detail.key != null ? String(e.detail.key).trim().toLowerCase() : '';
        if (key !== 'cost-sources' && key !== 'shipping' && key !== 'rules' && key !== 'breakdown') return;
        initialCostExpensesSubTab = key;
        activeCostExpensesSubTab = key;
        if (getActiveSettingsTab() === 'cost-expenses') {
          syncLeftNavActiveClasses('cost-expenses');
          updateUrl('cost-expenses');
        }
      });
    }

    window.addEventListener('popstate', function () {
      syncFromUrl();
    });

    var loaderEnabled = isSettingsPageLoaderEnabled();
    if (loaderEnabled) {
      try { showGlobalPageLoader('Preparing settings', 'Loading settings\u2026'); } catch (_) {}
    } else {
      try { dismissGlobalPageLoader(); } catch (_) {}
    }

    var pConfig = loadConfigAndPopulate();
    var pSettings = loadSettingsAndPopulate();
    Promise.all([pConfig, pSettings]).finally(function () {
      try { dismissGlobalPageLoader(); } catch (_) {}
    });

    wirePlanBasedBrandingLocks();
    wireAssets();
    wireGeneralSettingsSave();
    // Integrations main-tabs are wired above so left-nav child clicks can activate them.
    wireGoogleAdsSettingsUi();
    wireKpisLayoutSubTabs();
    wireInsightsLayoutSubTabs();
    wireInsightsVariantsEditor();
    wireKpisSaveReset();
    wireInsightsVariantsSaveReset();
    wireInsightsVariantsIgnoreModal();
    wireInsightsVariantsSuggestModal();
    wireInsightsVariantsMergeModal();
    wireInsightsVariantsWarningsModal();
    wireLayoutTablesSaveReset();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
