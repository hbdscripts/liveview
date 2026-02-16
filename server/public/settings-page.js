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

  function normalizeSettingsUrlQueryEarly() {
    try {
      if (!window.history || typeof window.history.replaceState !== 'function') return;
      var rawSearch = String(window.location.search || '');
      if (!rawSearch) return;
      var params = new URLSearchParams(rawSearch);
      var keep = new URLSearchParams();
      var rawTab = String(params.get('tab') || '').trim().toLowerCase();
      if (rawTab === 'sources') rawTab = 'attribution';
      if (rawTab === 'charts' || rawTab === 'kpis') rawTab = 'layout';
      var allowedTabs = {
        general: true, theme: true, assets: true, integrations: true,
        attribution: true, insights: true, layout: true,
      };
      if (allowedTabs[rawTab]) keep.set('tab', rawTab);
      var rawLayout = String(params.get('layoutTab') || params.get('layout') || '').trim().toLowerCase();
      if ((rawLayout === 'tables' || rawLayout === 'charts' || rawLayout === 'kpis') && keep.get('tab') === 'layout') {
        keep.set('layoutTab', rawLayout);
      }
      var rawShop = String(params.get('shop') || '').trim();
      if (rawShop) keep.set('shop', rawShop);
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
  var chartsUiConfigCache = null;
  var tablesUiConfigCache = null;
  var insightsVariantsConfigCache = null;
  var insightsVariantsDraft = null;
  var chartsUiPanelRendered = false;
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
  var activeLayoutSubTab = 'tables';

  var TAB_MAP = {
    general: 'settings-panel-general',
    theme: 'settings-panel-theme',
    assets: 'settings-panel-assets',
    integrations: 'settings-panel-integrations',
    attribution: 'settings-panel-attribution',
    insights: 'settings-panel-insights',
    layout: 'settings-panel-layout',
  };

  function getTabFromQuery() {
    var m = /[?&]tab=([^&]+)/.exec(window.location.search || '');
    if (m && m[1]) {
      var t = m[1].toLowerCase().replace(/\s+/g, '-');
      if (t === 'sources') t = 'attribution';
      if (t === 'charts' || t === 'kpis') {
        initialLayoutSubTab = t;
        return 'layout';
      }
      if (t === 'layout') {
        var lm = /[?&](?:layoutTab|layout)=([^&]+)/.exec(window.location.search || '');
        if (lm && lm[1]) {
          var lk = lm[1].toLowerCase().replace(/\s+/g, '-');
          if (lk === 'tables' || lk === 'charts' || lk === 'kpis') initialLayoutSubTab = lk;
        }
      }
      if (TAB_MAP[t]) return t;
    }
    return null;
  }

  function getTabFromHash() {
    var hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
    if (hash === 'sources') return 'attribution';
    if (hash === 'charts' || hash === 'kpis') {
      initialLayoutSubTab = hash;
      return 'layout';
    }
    if (hash && TAB_MAP[hash]) return hash;
    return null;
  }

  function updateUrl(key) {
    var url = window.location.pathname + '?tab=' + encodeURIComponent(key);
    try { history.replaceState(null, '', url); } catch (_) {}
  }

  function getActiveSettingsTab() {
    var active = document.querySelector('.settings-panel.active');
    if (!active || !active.id) return '';
    return String(active.id).replace('settings-panel-', '');
  }

  function getActiveLayoutSubTab() {
    var tab = document.querySelector('[data-settings-layout-tab].active');
    if (!tab) return activeLayoutSubTab || 'tables';
    var key = String(tab.getAttribute('data-settings-layout-tab') || '').trim().toLowerCase();
    return key || (activeLayoutSubTab || 'tables');
  }

  function renderChartsWhenVisible() {
    if (chartsUiPanelRendered) return;
    renderChartsUiPanel(chartsUiConfigCache || defaultChartsUiConfigV1());
    chartsUiPanelRendered = true;
  }

  function renderTablesWhenVisible() {
    if (tablesUiPanelRendered) return;
    renderLayoutTablesUiPanel(tablesUiConfigCache || defaultTablesUiConfigV1());
    tablesUiPanelRendered = true;
  }

  function activateTab(key) {
    document.querySelectorAll('[data-settings-tab]').forEach(function (el) {
      var isActive = el.getAttribute('data-settings-tab') === key;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
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
      var sub = getActiveLayoutSubTab();
      if (sub === 'charts') {
        try { renderChartsWhenVisible(); } catch (_) {}
      } else if (sub === 'tables') {
        try { renderTablesWhenVisible(); } catch (_) {}
      }
    }
    if (key === 'insights') {
      try {
        if (!insightsVariantsDraft) {
          renderInsightsVariantsPanel(insightsVariantsConfigCache || defaultInsightsVariantsConfigV1());
        }
      } catch (_) {}
    }
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
        '<span class="badge bg-secondary-lt kexo-alias-chip">' +
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
    var tabs = document.querySelectorAll('[data-settings-integrations-tab]');
    if (!tabs.length) return;
    function activate(key) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-settings-integrations-tab') === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      ['shopify', 'googleads'].forEach(function (k) {
        var panel = document.getElementById('settings-integrations-panel-' + k);
        if (panel) panel.classList.toggle('active', k === key);
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-settings-integrations-tab') || 'shopify');
      });
    });
    activate('shopify');
  }

  function wireGoogleAdsActions() {
    var msgEl = document.getElementById('settings-ga-msg');
    var outEl = document.getElementById('settings-ga-output');
    if (!msgEl || !outEl) return;

    function setMsg(t, ok) {
      msgEl.textContent = t || '';
      msgEl.className = 'form-hint ' + (ok ? 'text-success' : 'text-danger');
    }

    function setOut(obj) {
      try { outEl.textContent = JSON.stringify(obj, null, 2); }
      catch (_) { outEl.textContent = String(obj || ''); }
    }

    function fetchJson(url, opts) {
      return fetch(url, opts || { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) {
          return r.text().then(function (t) {
            var j = null;
            try { j = t ? JSON.parse(t) : null; } catch (_) {}
            return { ok: r.ok, status: r.status, json: j, text: t };
          });
        });
    }

    var statusBtn = document.getElementById('settings-ga-status-btn');
    if (statusBtn) {
      statusBtn.addEventListener('click', function () {
        setMsg('Fetching status…', true);
        fetchJson((API || '') + '/api/ads/status', { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) {
            setOut({ endpoint: 'GET /api/ads/status', status: r.status, ok: r.ok, body: r.json || r.text });
            setMsg(r.ok ? 'Status OK' : ('Status failed (' + r.status + ')'), r.ok);
          })
          .catch(function (err) {
            setMsg('Status failed: ' + (err && err.message ? err.message : 'error'), false);
          });
      });
    }

    var summaryBtn = document.getElementById('settings-ga-summary-btn');
    if (summaryBtn) {
      summaryBtn.addEventListener('click', function () {
        setMsg('Fetching summary…', true);
        fetchJson((API || '') + '/api/ads/summary?range=7d', { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) {
            setOut({ endpoint: 'GET /api/ads/summary?range=7d', status: r.status, ok: r.ok, body: r.json || r.text });
            setMsg(r.ok ? 'Summary OK' : ('Summary failed (' + r.status + ')'), r.ok);
          })
          .catch(function (err) {
            setMsg('Summary failed: ' + (err && err.message ? err.message : 'error'), false);
          });
      });
    }

    function wireRefresh(btnId, range) {
      var btn = document.getElementById(btnId);
      if (!btn) return;
      btn.addEventListener('click', function () {
        setMsg('Refreshing ' + range + '…', true);
        fetchJson((API || '') + '/api/ads/refresh?range=' + encodeURIComponent(range), {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store'
        })
          .then(function (r) {
            setOut({ endpoint: 'POST /api/ads/refresh?range=' + range, status: r.status, ok: r.ok, body: r.json || r.text });
            setMsg(r.ok ? ('Refresh ' + range + ' complete') : ('Refresh failed (' + r.status + ')'), r.ok);
          })
          .catch(function (err) {
            setMsg('Refresh failed: ' + (err && err.message ? err.message : 'error'), false);
          });
      });
    }

    wireRefresh('settings-ga-refresh-7d-btn', '7d');
    wireRefresh('settings-ga-refresh-month-btn', 'month');
  }

  function renderIntegrationsFromConfig(c) {
    var shopify = c && c.shopify ? c.shopify : {};
    var health = c && c.sales && c.sales.truth && c.sales.truth.health ? c.sales.truth.health : {};
    var pixel = c && c.pixel ? c.pixel : {};
    var settings = c && c.settings ? c.settings : {};
    var ingest = c && c.ingest ? c.ingest : {};
    var ads = c && c.ads && c.ads.status ? c.ads.status : {};
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
    setText('settings-int-session-mode', settings && settings.pixelSessionMode === 'shared_ttl' ? 'shared_ttl (cross-tab)' : 'legacy');

    setHtml('settings-int-ga-configured', ga && ga.configured ? badge('Yes', 'ok') : badge('No', 'bad'));
    setHtml('settings-int-ga-connected', ga && ga.connected ? badge('Yes', 'ok') : badge('No', 'bad'));
    setText('settings-int-ga-customer-id', ga && ga.customerId ? String(ga.customerId) : '\u2014');
    setText('settings-int-ga-login-customer-id', ga && ga.loginCustomerId ? String(ga.loginCustomerId) : '\u2014');
    setHtml('settings-int-ga-dev-token', ga && ga.hasDeveloperToken ? badge('Set', 'ok') : badge('Missing', 'bad'));
    setHtml('settings-int-ga-refresh-token', ga && ga.hasRefreshToken ? badge('Present', 'ok') : badge('Missing', 'bad'));

    var outEl = document.getElementById('settings-ga-output');
    if (outEl) {
      try { outEl.textContent = JSON.stringify({ ads: ads }, null, 2); }
      catch (_) { outEl.textContent = 'Could not format Ads status'; }
    }
  }

  function getShopParam() {
    try {
      var m = /[?&]shop=([^&]+)/.exec(window.location.search || '');
      return m && m[1] ? decodeURIComponent(m[1]) : '';
    } catch (_) { return ''; }
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
        var reporting = data.reporting || {};
        var sessionMode = data.pixelSessionMode || 'legacy';
        var overrides = data.assetOverrides || {};
        kpiUiConfigCache = data.kpiUiConfig || null;
        chartsUiConfigCache = data.chartsUiConfig || null;
        tablesUiConfigCache = data.tablesUiConfig || null;
        insightsVariantsConfigCache = data.insightsVariantsConfig || null;
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
            if (sub === 'charts') renderChartsWhenVisible();
            else if (sub === 'tables') renderTablesWhenVisible();
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
        header: { showKexoScore: true },
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
          { key: 'conv', label: 'Conversion Rate', enabled: true },
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
          { key: 'revenue', label: 'Revenue', enabled: true, position: 'top' },
          { key: 'orders', label: 'Orders', enabled: true, position: 'top' },
          { key: 'conv', label: 'Conversion Rate', enabled: true, position: 'top' },
          { key: 'aov', label: 'Average Order Value', enabled: true, position: 'top' },
          { key: 'sessions', label: 'Sessions', enabled: true, position: 'top' },
          { key: 'bounce', label: 'Bounce Rate', enabled: true, position: 'top' },
          { key: 'returning', label: 'Returning', enabled: true, position: 'lower' },
          { key: 'roas', label: 'ADS ROAS', enabled: true, position: 'lower' },
          { key: 'kexo_score', label: 'Kexo Score', enabled: true, position: 'lower' },
          { key: 'cogs', label: 'COGS', enabled: true, position: 'lower' },
          { key: 'fulfilled', label: 'Fulfilled', enabled: true, position: 'lower' },
          { key: 'returns', label: 'Returns', enabled: true, position: 'lower' },
          { key: 'items', label: 'Items ordered', enabled: true, position: 'lower' },
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

  function defaultChartsUiConfigV1() {
    var baseCharts = [
      { key: 'dash-chart-overview-30d', label: 'Dashboard · 30 Day Overview', enabled: true, mode: 'bar', colors: ['#3eb3ab', '#ef4444'], advancedApexOverride: {} },
      { key: 'dash-chart-finishes-30d', label: 'Dashboard · Finishes (30 Days)', enabled: true, mode: 'pie', colors: ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4'], advancedApexOverride: {} },
      { key: 'dash-chart-countries-30d', label: 'Dashboard · Countries (30 Days)', enabled: true, mode: 'pie', colors: ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'], advancedApexOverride: {} },
      { key: 'dash-chart-kexo-score-today', label: 'Dashboard · Kexo Score (Today)', enabled: true, mode: 'pie', colors: ['#4b94e4', '#e5e7eb'], advancedApexOverride: {} },
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
      row.style = defaultChartStyleConfig();
      return row;
    });
    return {
      v: 1,
      hideOnMobile: true,
      // User-managed chart + KPI bundle config source of truth.
      // Runtime reads this payload; avoid adding hardcoded style overrides elsewhere.
      charts: baseCharts,
      kpiBundles: {
        dashboardCards: {
          sparkline: { mode: 'line', curve: 'straight', strokeWidth: 2.55, height: 50, showCompare: true, advancedApexOverride: {} },
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
            { id: 'dash-top-products', name: 'Top Products', tableClass: 'dashboard', zone: 'dashboard-top-products', order: 1, inGrid: true, rows: { default: 5, options: [5, 10] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'dash-top-countries', name: 'Top Countries', tableClass: 'dashboard', zone: 'dashboard-top-countries', order: 2, inGrid: true, rows: { default: 5, options: [5, 10] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'dash-trending-up', name: 'Trending Up', tableClass: 'dashboard', zone: 'dashboard-trending-up', order: 3, inGrid: true, rows: { default: 5, options: [5, 10] }, sticky: { minWidth: null, maxWidth: null } },
            { id: 'dash-trending-down', name: 'Trending Down', tableClass: 'dashboard', zone: 'dashboard-trending-down', order: 4, inGrid: true, rows: { default: 5, options: [5, 10] }, sticky: { minWidth: null, maxWidth: null } },
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

  var CHART_MODE_LABEL = (typeof window.KEXO_CHART_MODE_LABEL === 'object' && window.KEXO_CHART_MODE_LABEL) || {
    'map-animated': 'Map (animated)', 'map-flat': 'Map (flat)', area: 'Area', line: 'Line', bar: 'Bar', pie: 'Pie',
    combo: 'Multiple (combo)', 'multi-line-labels': 'Multiple line + labels',
  };

  var CHARTS_GROUPS = [
    { id: 'dashboard', label: 'Dashboard charts', keys: ['dash-chart-overview-30d', 'dash-chart-finishes-30d', 'dash-chart-countries-30d', 'dash-chart-kexo-score-today', 'live-online-chart', 'sales-overview-chart', 'date-overview-chart'] },
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
    };
  }

  function normalizeChartStyleDraft(raw, fallback) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var def = fallback && typeof fallback === 'object' ? fallback : defaultChartStyleConfig();
    var curve = String(src.curve != null ? src.curve : def.curve).trim().toLowerCase();
    if (['smooth', 'straight', 'stepline'].indexOf(curve) < 0) curve = def.curve;
    var labelsMode = String(src.dataLabels != null ? src.dataLabels : def.dataLabels).trim().toLowerCase();
    if (labelsMode !== 'on' && labelsMode !== 'off' && labelsMode !== 'auto') labelsMode = def.dataLabels;
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
    };
  }

  function defaultKpiBundlePalette() {
    return { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' };
  }

  function defaultKpiBundleSparkline(bundleKey) {
    if (bundleKey === 'headerStrip') return { mode: 'line', curve: 'smooth', strokeWidth: 2.15, height: 30, showCompare: false, advancedApexOverride: {} };
    if (bundleKey === 'yearlySnapshot') return { mode: 'line', curve: 'smooth', strokeWidth: 2.55, height: 56, showCompare: false, advancedApexOverride: {} };
    return { mode: 'line', curve: 'straight', strokeWidth: 2.55, height: 50, showCompare: true, compareUsePrimaryColor: true, compareOpacity: 50, advancedApexOverride: {} };
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
    var out = { v: 1, hideOnMobile: !(src.hideOnMobile === false), charts: [], kpiBundles: {} };
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
      var label = series[i] ? String(series[i]) : ('Series ' + (i + 1));
      var val = normalizeHexColor(colors[i], '#3eb3ab');
      html += '<label class="settings-charts-color-field"><span class="form-label mb-1">' + escapeHtml(label) + '</span><div class="settings-charts-color-field-row"><input type="text" class="form-control form-control-sm" data-chart-field="color" data-idx="' + i + '" value="' + escapeHtml(val) + '" placeholder="#3eb3ab"><span class="settings-charts-color-swatch" data-color-swatch style="background:' + escapeHtml(val) + ';"></span></div></label>';
    }
    html += '</div>';
    return html;
  }

  function renderBundleColorInput(field, value, labelText) {
    var val = normalizeHexColor(value, '#2fb344');
    return '<label class="settings-charts-color-field"><span class="form-label mb-1">' + escapeHtml(labelText) + '</span><div class="settings-charts-color-field-row"><input type="text" class="form-control form-control-sm" data-bundle-field="' + escapeHtml(field) + '" value="' + escapeHtml(val) + '" placeholder="#2fb344"><span class="settings-charts-color-swatch" data-color-swatch style="background:' + escapeHtml(val) + ';"></span></div></label>';
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
    var style = normalizeChartStyleDraft(item && item.style, defaultChartStyleConfig());
    var collapseId = 'settings-chart-item-' + key.replace(/[^a-z0-9_-]/g, '-');
    var headingId = collapseId + '-heading';
    var isOpen = idx === 0;
    return '<div class="accordion-item settings-charts-item" data-chart-config-key="' + escapeHtml(key) + '">' +
      '<h2 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
        '<button class="accordion-button' + (isOpen ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + escapeHtml(collapseId) + '">' +
          '<span class="d-flex align-items-center w-100 gap-2"><span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span><span class="me-auto">' + escapeHtml(title) + '</span><span class="text-muted small"><code>' + escapeHtml(key) + '</code></span></span>' +
        '</button>' +
      '</h2>' +
      '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse' + (isOpen ? ' show' : '') + '" aria-labelledby="' + escapeHtml(headingId) + '" data-bs-parent="#' + escapeHtml(accordionId) + '">' +
        '<div class="accordion-body"><div class="settings-charts-card-body"><div class="row g-3">' +
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
          '<div class="col-12"><label class="form-label mb-1">Series colors (hex)</label>' + renderChartColorInputs(item, meta) + '</div>' +
          '<div class="col-12"><label class="form-label mb-1">Advanced Apex override (JSON)</label><textarea class="form-control form-control-sm settings-charts-advanced-json" rows="5" data-chart-field="advancedApexOverride" spellcheck="false">' + escapeHtml(prettyJson(item && item.advancedApexOverride)) + '</textarea></div>' +
          '<div class="col-12"><div class="settings-charts-preview-wrap"><div class="text-muted small mb-2">Preview</div><div class="settings-charts-preview-canvas" data-chart-preview-canvas></div></div></div>' +
        '</div></div></div>' +
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
    var modeEl = card.querySelector('[data-chart-field="mode"]');
    var metricEl = card.querySelector('[data-chart-field="pieMetric"]');
    if (!modeEl || !metricEl || metricEl.disabled) return;
    metricEl.disabled = String(modeEl.value || '').trim().toLowerCase() !== 'pie';
  }

  function syncColorSwatches(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-color-swatch]').forEach(function (sw) {
      var input = sw.previousElementSibling;
      if (!input) return;
      sw.style.background = normalizeHexColor(input.value, '#3eb3ab');
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
      '<label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" id="settings-charts-hide-mobile" ' + (hideOnMobile ? 'checked' : '') + '><span class="form-check-label ms-2">Hide charts on mobile</span></label>' +
      '<div class="text-muted small" style="max-width:560px;">Configure one chart/KPI bundle at a time with live previews.</div>' +
      '</div>' +
      '<div class="accordion settings-layout-accordion settings-charts-accordion" id="' + escapeHtml(accordionId) + '">';
    var itemIndex = 0;
    CHARTS_GROUPS.forEach(function (group) {
      var keys = group && Array.isArray(group.keys) ? group.keys : [];
      var groupCharts = c.charts.filter(function (it) { return keys.indexOf(String(it.key || '').trim().toLowerCase()) >= 0; });
      if (!groupCharts.length) return;
      html += '<div class="settings-charts-group-label">' + escapeHtml(group.label || '') + '</div>';
      groupCharts.forEach(function (it) {
        html += renderChartAccordionItem(it, itemIndex, accordionId);
        itemIndex += 1;
      });
    });
    html += '<div class="settings-charts-group-label">KPI bundles</div>';
    KPI_BUNDLE_ORDER.forEach(function (bundleKey) {
      html += renderBundleAccordionItem(bundleKey, c.kpiBundles[bundleKey] || defaultKpiBundle(bundleKey), itemIndex, accordionId);
      itemIndex += 1;
    });
    html += '</div>';
    root.innerHTML = html;
    root.querySelectorAll('[data-chart-config-key]').forEach(function (card) { refreshPieMetricState(card); });
    syncColorSwatches(root);
    renderAllChartsPreviews(root);

    var previewTimer = 0;
    function queuePreview() {
      if (previewTimer) {
        try { clearTimeout(previewTimer); } catch (_) {}
      }
      previewTimer = setTimeout(function () {
        previewTimer = 0;
        root.querySelectorAll('[data-chart-config-key]').forEach(function (card) { refreshPieMetricState(card); });
        syncColorSwatches(root);
        renderAllChartsPreviews(root);
      }, 100);
    }
    root.addEventListener('input', queuePreview);
    root.addEventListener('change', queuePreview);
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
    var root = document.getElementById('settings-charts-root');
    if (!root) return defaultChartsUiConfigV1();
    var hideEl = document.getElementById('settings-charts-hide-mobile');
    var out = { v: 1, hideOnMobile: hideEl ? !!hideEl.checked : true, charts: [], kpiBundles: {} };
    root.querySelectorAll('[data-chart-config-key]').forEach(function (card) {
      var chartCfg = readChartConfigFromCard(card);
      if (!chartCfg) return;
      out.charts.push({
        key: chartCfg.key,
        enabled: chartCfg.enabled,
        label: chartCfg.label || chartCfg.key,
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
    var tabs = document.querySelectorAll('[data-settings-layout-tab]');
    if (!tabs.length) return;
    var KEYS = ['tables', 'charts', 'kpis'];
    function activate(key) {
      if (KEYS.indexOf(key) < 0) key = 'tables';
      activeLayoutSubTab = key;
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-settings-layout-tab') === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      KEYS.forEach(function (k) {
        var panel = document.getElementById('settings-layout-panel-' + k);
        if (panel) panel.classList.toggle('active', k === key);
      });
      if (getActiveSettingsTab() === 'layout') {
        if (key === 'tables') {
          try { renderTablesWhenVisible(); } catch (_) {}
        } else if (key === 'charts') {
          try { renderChartsWhenVisible(); } catch (_) {}
        }
      }
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-settings-layout-tab') || 'tables');
      });
    });
    activate(initialKey || activeLayoutSubTab || 'tables');
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

        var defaultOptsHtml = (rowOptions.length ? rowOptions : [defaultRows]).map(function (n) {
          return '<option value="' + String(n) + '"' + (Number(n) === Number(defaultRows) ? ' selected' : '') + '>' + String(n) + '</option>';
        }).join('');

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
            '<div class="card-body">' +
              '<div class="row g-3">' +
                '<div class="col-12">' +
                  '<label class="form-label mb-1">Display name</label>' +
                  '<input type="text" class="form-control form-control-sm" data-field="name" value="' + escapeHtml(name) + '">' +
                '</div>' +
                '<div class="col-12 col-md-6">' +
                  '<label class="form-label mb-1">Rows options</label>' +
                  '<input type="text" class="form-control form-control-sm" data-field="rows-options" data-default-options="' + escapeHtml(formatRowOptionsText(rowOptions)) + '" value="' + escapeHtml(formatRowOptionsText(rowOptions)) + '" placeholder="e.g. 5, 10, 15, 20">' +
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
                  '<div class="text-muted small mt-1">Disable to force full-width layout.</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
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
      setLayoutTablesMsg('Saving\u2026', true);
      saveSettings({ tablesUiConfig: cfg })
        .then(function (r) {
          if (r && r.ok) {
            tablesUiConfigCache = r.tablesUiConfig || cfg;
            try { localStorage.setItem('kexo:tables-ui-config:v1', JSON.stringify(tablesUiConfigCache)); } catch (_) {}
            setLayoutTablesMsg('Saved.', true);
            try {
              if (window && typeof window.dispatchEvent === 'function') {
                window.dispatchEvent(new CustomEvent('kexo:tablesUiConfigUpdated', { detail: tablesUiConfigCache }));
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
    var tabs = document.querySelectorAll('[data-settings-kpis-layout-tab]');
    if (!tabs.length) return;
    function activate(key) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-settings-kpis-layout-tab') === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      ['dashboard', 'header'].forEach(function (k) {
        var panel = document.getElementById('settings-kpis-layout-panel-' + k);
        if (panel) panel.classList.toggle('active', k === key);
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-settings-kpis-layout-tab') || 'dashboard');
      });
    });
    activate('dashboard');
  }

  function wireInsightsLayoutSubTabs() {
    var tabs = document.querySelectorAll('[data-settings-insights-layout-tab]');
    if (!tabs.length) return;
    function activate(key) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-settings-insights-layout-tab') === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      ['products', 'countries', 'variants'].forEach(function (k) {
        var panel = document.getElementById('settings-insights-layout-panel-' + k);
        if (panel) panel.classList.toggle('active', k === key);
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-settings-insights-layout-tab') || 'products');
      });
    });
    activate('variants');
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
            '<div class="kexo-alias-chipbox form-control form-control-sm" style="max-width:360px" data-alias-chipbox data-table-idx="' + String(tableIdx) + '" title="Type and press Enter or comma to add. These are Shopify option-name synonyms to merge Suggestions into the same table.">' +
              '<input type="hidden" data-field="table-aliases" data-table-idx="' + String(tableIdx) + '" value="' + escapeHtml(aliasValue) + '">' +
              '<div class="kexo-alias-chipbox-chips" data-alias-chips data-table-idx="' + String(tableIdx) + '">' + aliasChips + '</div>' +
              '<input type="text" class="kexo-alias-chipbox-input" data-alias-input data-table-idx="' + String(tableIdx) + '" placeholder="Aliases (Enter or comma)">' +
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
    });
  }

  function defaultDashboardKpiPositionForKey(key) {
    var k = String(key || '').trim().toLowerCase();
    if (!k) return 'top';
    if (k === 'cogs' || k === 'fulfilled' || k === 'returns' || k === 'items') return 'lower';
    return 'top';
  }

  function normalizeDashboardKpiPosition(pos, key) {
    var raw = String(pos || '').trim().toLowerCase();
    if (raw === 'top' || raw === 'lower') return raw;
    return defaultDashboardKpiPositionForKey(key);
  }

  function renderKpiTable(rootId, items, kind) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var rows = Array.isArray(items) ? items : [];
    var showPosition = String(kind || '').trim().toLowerCase() === 'dashboard';
    var tableColumns = [
      { header: 'On', headerClass: 'w-1' },
      { header: 'Label', headerClass: '' },
    ];
    if (showPosition) tableColumns.push({ header: 'Position', headerClass: 'w-1' });
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
          var position = normalizeDashboardKpiPosition(it.position, key);
          var positionCell = showPosition
            ? '<td><select class="form-select form-select-sm" data-field="position">' +
                '<option value="top"' + (position === 'top' ? ' selected' : '') + '>Top grid</option>' +
                '<option value="lower"' + (position === 'lower' ? ' selected' : '') + '>Lower grid</option>' +
              '</select></td>'
            : '';
          return '<tr data-kpi-key="' + escapeHtml(key) + '">' +
            '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + '></label></td>' +
            '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
            positionCell +
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
        '<thead><tr><th class="w-1">On</th><th>Label</th>' + (showPosition ? '<th class="w-1">Position</th>' : '') + '<th class="text-muted">Key</th><th class="text-end w-1">Order</th></tr></thead><tbody>';
      rows.forEach(function (it) {
        if (!it) return;
        var key = String(it.key || '').trim().toLowerCase();
        if (!key) return;
        var label = it.label != null ? String(it.label) : key;
        var enabled = !!it.enabled;
        var position = normalizeDashboardKpiPosition(it.position, key);
        var positionCell = showPosition
          ? '<td><select class="form-select form-select-sm" data-field="position">' +
              '<option value="top"' + (position === 'top' ? ' selected' : '') + '>Top grid</option>' +
              '<option value="lower"' + (position === 'lower' ? ' selected' : '') + '>Lower grid</option>' +
            '</select></td>'
          : '';
        html += '<tr data-kpi-key="' + escapeHtml(key) + '">' +
          '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + '></label></td>' +
          '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
          positionCell +
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
    var includePosition = String(kind || '').trim().toLowerCase() === 'dashboard';
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
      if (includePosition) {
        var positionEl = tr.querySelector('select[data-field="position"]');
        row.position = normalizeDashboardKpiPosition(positionEl && positionEl.value, key);
      }
      out.push(row);
    });
    return out;
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
    var dashRoot = document.getElementById('settings-kpis-dashboard-root');
    var headRoot = document.getElementById('settings-kpis-header-root');
    var rangesRoot = document.getElementById('settings-date-ranges-root');
    if (!dashRoot || !headRoot || !rangesRoot) return;
    var def = defaultKpiUiConfigV1();
    var c = cfg && typeof cfg === 'object' ? cfg : def;
    var options = c.options || {};
    var condensed = options.condensed || {};
    var dashboard = options.dashboard || {};

    var optCondDelta = document.getElementById('settings-kpi-opt-condensed-delta');
    var optCondProg = document.getElementById('settings-kpi-opt-condensed-progress');
    var optCondSpark = document.getElementById('settings-kpi-opt-condensed-sparkline');
    var optDashDelta = document.getElementById('settings-kpi-opt-dashboard-delta');
    var optHeaderKexoScore = document.getElementById('settings-kpi-opt-header-kexo-score');
    if (optCondDelta) optCondDelta.checked = condensed.showDelta !== false;
    if (optCondProg) optCondProg.checked = condensed.showProgress !== false;
    if (optCondSpark) optCondSpark.checked = condensed.showSparkline !== false;
    if (optDashDelta) optDashDelta.checked = dashboard.showDelta !== false;
    if (optHeaderKexoScore) {
      var headerOpt = options.header && typeof options.header === 'object' ? options.header : {};
      optHeaderKexoScore.checked = headerOpt.showKexoScore !== false;
    }

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

    renderKpiTable('settings-kpis-dashboard-root', (c.kpis && c.kpis.dashboard) ? c.kpis.dashboard : [], 'dashboard');
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
    var optDashDelta = document.getElementById('settings-kpi-opt-dashboard-delta');
    var optHeaderKexoScore = document.getElementById('settings-kpi-opt-header-kexo-score');
    return {
      v: 1,
      options: {
        condensed: {
          showDelta: !!(optCondDelta && optCondDelta.checked),
          showProgress: !!(optCondProg && optCondProg.checked),
          showSparkline: !!(optCondSpark && optCondSpark.checked),
        },
        dashboard: {
          showDelta: !!(optDashDelta && optDashDelta.checked),
        },
        header: {
          showKexoScore: !!(optHeaderKexoScore && optHeaderKexoScore.checked),
        },
      },
      headerStrip: {
        pages: readHeaderStripPagesFromDom(),
      },
      kpis: {
        dashboard: readKpiTable('settings-kpis-dashboard-root', 'dashboard'),
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
    var initialTab = getTabFromQuery() || getTabFromHash() || 'general';
    // Layout is now a multi-tab section (Tables / Charts / KPIs). If the URL used legacy
    // `tab=charts` or `tab=kpis`, preselect the right Layout subtab BEFORE activating the panel.
    wireLayoutSubTabs(initialLayoutSubTab);
    activateTab(initialTab);

    document.querySelectorAll('[data-settings-tab]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        var key = el.getAttribute('data-settings-tab');
        if (key) activateTab(key);
      });
    });

    window.addEventListener('popstate', function () {
      activateTab(getTabFromQuery() || getTabFromHash() || 'general');
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
    wireIntegrationsSubTabs();
    wireGoogleAdsActions();
    wireKpisLayoutSubTabs();
    wireInsightsLayoutSubTabs();
    wireInsightsVariantsEditor();
    wireKpisSaveReset();
    wireInsightsVariantsSaveReset();
    wireInsightsVariantsIgnoreModal();
    wireInsightsVariantsSuggestModal();
    wireInsightsVariantsMergeModal();
    wireInsightsVariantsWarningsModal();
    wireChartsSaveReset();
    wireLayoutTablesSaveReset();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
