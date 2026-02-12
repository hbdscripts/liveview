/**
 * Settings page – tab switching, data loading, form wiring.
 * Runs only when data-page="settings".
 */
(function () {
  'use strict';

  if (document.body.getAttribute('data-page') !== 'settings') return;

  var API = '';
  try {
    if (typeof window !== 'undefined' && window.API) API = String(window.API || '');
  } catch (_) {}

  var kpiUiConfigCache = null;
  var chartsUiConfigCache = null;
  var chartsUiPanelRendered = false;

  var TAB_MAP = {
    general: 'settings-panel-general',
    theme: 'settings-panel-theme',
    assets: 'settings-panel-assets',
    'data-reporting': 'settings-panel-data-reporting',
    integrations: 'settings-panel-integrations',
    sources: 'settings-panel-sources',
    kpis: 'settings-panel-kpis',
    charts: 'settings-panel-charts',
    diagnostics: 'settings-panel-diagnostics',
  };

  function getTabFromQuery() {
    var m = /[?&]tab=([^&]+)/.exec(window.location.search || '');
    if (m && m[1]) {
      var t = m[1].toLowerCase().replace(/\s+/g, '-');
      if (TAB_MAP[t]) return t;
    }
    return null;
  }

  function getTabFromHash() {
    var hash = (window.location.hash || '').replace(/^#/, '').toLowerCase();
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

  function renderChartsWhenVisible() {
    if (chartsUiPanelRendered) return;
    renderChartsUiPanel(chartsUiConfigCache || defaultChartsUiConfigV1());
    chartsUiPanelRendered = true;
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
    if (key === 'diagnostics') {
      try { if (typeof window.refreshConfigStatus === 'function') window.refreshConfigStatus({ force: true, preserveView: false }); } catch (_) {}
    }
    if (key === 'sources') {
      try { if (typeof window.initTrafficSourceMapping === 'function') window.initTrafficSourceMapping({ rootId: 'settings-traffic-source-mapping-root' }); } catch (_) {}
    }
    if (key === 'charts') {
      try { renderChartsWhenVisible(); } catch (_) {}
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function formatTs(ms) {
    try {
      if (typeof ms !== 'number' || !isFinite(ms)) return '\u2014';
      return new Date(ms).toLocaleString();
    } catch (_) {
      return '\u2014';
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

    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
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
      .catch(function () {});
  }

  function loadSettingsAndPopulate() {
    fetch(API + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) return;
        var reporting = data.reporting || {};
        var sessionMode = data.pixelSessionMode || 'legacy';
        var overrides = data.assetOverrides || {};
        kpiUiConfigCache = data.kpiUiConfig || null;
        chartsUiConfigCache = data.chartsUiConfig || null;
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
        document.querySelectorAll('#settings-asset-logo').forEach(function (el) {
          el.value = overrides.logo || '';
        });

        try { renderKpisUiPanel(kpiUiConfigCache); } catch (_) {}
        try {
          if (getActiveSettingsTab() === 'charts') renderChartsWhenVisible();
        } catch (_) {}
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
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var favicon = (document.getElementById('settings-asset-favicon') || {}).value || '';
      var logo = (document.getElementById('settings-asset-logo') || {}).value || '';
      saveSettings({ assetOverrides: { favicon: favicon.trim(), logo: logo.trim() } })
        .then(function (r) {
          var msg = document.getElementById('settings-assets-msg');
          if (msg) {
            msg.textContent = r && r.ok ? 'Saved.' : (r && r.error ? r.error : 'Save failed');
            msg.className = 'form-hint ' + (r && r.ok ? 'text-success' : 'text-danger');
          }
        })
        .catch(function () {
          var msg = document.getElementById('settings-assets-msg');
          if (msg) { msg.textContent = 'Save failed'; msg.className = 'form-hint text-danger'; }
        });
    });
  }

  function defaultKpiUiConfigV1() {
    return {
      v: 1,
      options: {
        condensed: { showDelta: true, showProgress: true, showSparkline: true },
        dashboard: { showDelta: true },
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
          { key: 'revenue', label: 'Revenue', enabled: true },
          { key: 'orders', label: 'Orders', enabled: true },
          { key: 'conv', label: 'Conversion Rate', enabled: true },
          { key: 'aov', label: 'Average Order Value', enabled: true },
          { key: 'sessions', label: 'Sessions', enabled: true },
          { key: 'bounce', label: 'Bounce Rate', enabled: true },
          { key: 'returning', label: 'Returning', enabled: true },
          { key: 'roas', label: 'ADS ROAS', enabled: true },
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

  function defaultChartsUiConfigV1() {
    return {
      v: 1,
      charts: [
        { key: 'dash-chart-revenue', label: 'Dashboard · Revenue', enabled: true, mode: 'area', colors: ['#3eb3ab'] },
        { key: 'dash-chart-orders', label: 'Dashboard · Orders', enabled: true, mode: 'area', colors: ['#3b82f6'] },
        { key: 'dash-chart-conv', label: 'Dashboard · Conversion Rate', enabled: true, mode: 'area', colors: ['#8b5cf6', '#5c6ac4'] },
        { key: 'dash-chart-sessions', label: 'Dashboard · Sessions', enabled: true, mode: 'area', colors: ['#f59e0b'] },
        { key: 'dash-chart-adspend', label: 'Dashboard · Revenue vs Ad Spend', enabled: true, mode: 'area', colors: ['#3eb3ab', '#ef4444'] },
        { key: 'live-online-chart', label: 'Dashboard · Live Online', enabled: true, mode: 'bar', colors: ['#16a34a'] },
        { key: 'sales-overview-chart', label: 'Dashboard · Sales Trend', enabled: true, mode: 'area', colors: ['#0d9488'] },
        { key: 'date-overview-chart', label: 'Dashboard · Sessions & Orders Trend', enabled: true, mode: 'area', colors: ['#4b94e4', '#f59e34'] },
        { key: 'ads-overview-chart', label: 'Integrations · Google Ads Overview', enabled: true, mode: 'combo', colors: ['#3eb3ab', '#ef4444', '#4b94e4'] },
        { key: 'channels-chart', label: 'Traffic · Channels', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions' },
        { key: 'type-chart', label: 'Traffic · Device & Platform', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions' },
        { key: 'products-chart', label: 'Insights · Products', enabled: true, mode: 'line', colors: ['#3eb3ab', '#4b94e4', '#f59e34', '#8b5cf6', '#ef4444', '#22c55e'] },
        { key: 'countries-map-chart', label: 'Insights · Countries Map', enabled: true, mode: 'map-animated', colors: ['#3eb3ab'] },
      ],
    };
  }

  var CHART_MODE_LABEL = {
    'map-animated': 'Map (animated)',
    'map-flat': 'Map (flat)',
    area: 'Area',
    line: 'Line',
    bar: 'Bar',
    pie: 'Pie',
    combo: 'Multiple (combo)',
    'multi-line-labels': 'Multiple line + labels',
  };

  var CHART_META = {
    'dash-chart-revenue': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue'] },
    'dash-chart-orders': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Orders'] },
    'dash-chart-conv': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Kexo', 'Shopify (if available)'] },
    'dash-chart-sessions': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Sessions'] },
    'dash-chart-adspend': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue', 'Ad spend'] },
    'live-online-chart': { modes: ['bar', 'line', 'area', 'multi-line-labels'], series: ['Online now'] },
    'sales-overview-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue'] },
    'date-overview-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Sessions', 'Orders'] },
    'ads-overview-chart': { modes: ['combo', 'line', 'area', 'multi-line-labels'], series: ['Sales', 'Spend', 'ROAS'] },
    'channels-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true },
    'type-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true },
    'products-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Revenue'] },
    'countries-map-chart': { modes: ['map-animated', 'map-flat'], series: ['Accent'] },
  };

  function chartMeta(key) {
    var k = String(key || '').trim().toLowerCase();
    return CHART_META[k] || { modes: ['line', 'area'], series: [] };
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

  function renderChartsUiPanel(cfg) {
    var root = document.getElementById('settings-charts-root');
    if (!root) return;
    var c = cfg && typeof cfg === 'object' ? cfg : defaultChartsUiConfigV1();
    var list = c && Array.isArray(c.charts) ? c.charts : [];

    var html = '<div class="table-responsive">' +
      '<table class="table table-sm table-vcenter mb-0">' +
      '<thead><tr>' +
      '<th class="w-1">On</th>' +
      '<th>Chart</th>' +
      '<th class="w-1">Type</th>' +
      '<th>Colors</th>' +
      '<th class="w-1">Pie metric</th>' +
      '</tr></thead><tbody>';

    list.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var key = it.key != null ? String(it.key).trim().toLowerCase() : '';
      if (!key) return;
      var label = it.label != null ? String(it.label) : key;
      var enabled = it.enabled !== false;
      var mode = it.mode != null ? String(it.mode).trim().toLowerCase() : 'line';
      var colors = Array.isArray(it.colors) ? it.colors : [];
      var meta = chartMeta(key);
      var modes = meta && Array.isArray(meta.modes) ? meta.modes : ['line'];
      var series = meta && Array.isArray(meta.series) ? meta.series : [];
      var pieMetric = it.pieMetric != null ? String(it.pieMetric).trim().toLowerCase() : 'sessions';
      var showPieMetric = !!(meta && meta.pieMetric);

      var colorHtml = '<div class="d-flex flex-wrap gap-2">';
      var count = Math.max(1, Math.min(6, Math.max(series.length || 0, colors.length || 0, 1)));
      for (var i = 0; i < count; i++) {
        var title = series[i] ? String(series[i]) : ('Series ' + (i + 1));
        var val = colors[i] ? String(colors[i]) : '#3eb3ab';
        if (!/^#([0-9a-f]{6})$/i.test(val)) val = '#3eb3ab';
        colorHtml += '<input type="color" class="form-control form-control-color" data-field="color" data-idx="' + i + '"' +
          ' value="' + escapeHtml(val) + '" title="' + escapeHtml(title) + '" aria-label="' + escapeHtml(title) + '">' +
          '';
      }
      colorHtml += '</div>';

      var pieMetricHtml = '&mdash;';
      if (showPieMetric) {
        pieMetricHtml =
          '<select class="form-select form-select-sm" data-field="pieMetric"' + (mode === 'pie' ? '' : ' disabled') + '>' +
            '<option value="sessions"' + (pieMetric === 'sessions' ? ' selected' : '') + '>Sessions</option>' +
            '<option value="orders"' + (pieMetric === 'orders' ? ' selected' : '') + '>Orders</option>' +
            '<option value="revenue"' + (pieMetric === 'revenue' ? ' selected' : '') + '>Revenue</option>' +
          '</select>';
      }

      html += '<tr data-chart-key="' + escapeHtml(key) + '">' +
        '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + '></label></td>' +
        '<td>' +
          '<input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '">' +
          '<div class="text-muted small mt-1">' + escapeHtml(key) + '</div>' +
        '</td>' +
        '<td>' +
          '<select class="form-select form-select-sm" data-field="mode">' +
            selectOptionsHtml(modes, mode) +
          '</select>' +
        '</td>' +
        '<td>' + colorHtml + '</td>' +
        '<td>' + pieMetricHtml + '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>' +
      '<div class="text-muted small mt-2">Options are filtered per chart to avoid incompatible types. For pie charts on Channels/Device, the selected metric is used.</div>';

    root.innerHTML = html;

    // Enable/disable pie-metric selector dynamically when mode changes.
    root.querySelectorAll('select[data-field="mode"]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var tr = sel.closest('tr[data-chart-key]');
        if (!tr) return;
        var metricSel = tr.querySelector('select[data-field="pieMetric"]');
        if (!metricSel) return;
        metricSel.disabled = String(sel.value || '').trim().toLowerCase() !== 'pie';
      });
    });
  }

  function buildChartsUiConfigFromDom() {
    var root = document.getElementById('settings-charts-root');
    if (!root) return defaultChartsUiConfigV1();
    var out = { v: 1, charts: [] };
    root.querySelectorAll('tr[data-chart-key]').forEach(function (tr) {
      var key = (tr.getAttribute('data-chart-key') || '').trim().toLowerCase();
      if (!key) return;
      var enabledEl = tr.querySelector('input[data-field="enabled"]');
      var labelEl = tr.querySelector('input[data-field="label"]');
      var modeEl = tr.querySelector('select[data-field="mode"]');
      var metricEl = tr.querySelector('select[data-field="pieMetric"]');
      var colors = [];
      tr.querySelectorAll('input[data-field="color"][data-idx]').forEach(function (inp) {
        var idx = parseInt(inp.getAttribute('data-idx') || '0', 10);
        if (!Number.isFinite(idx) || idx < 0) idx = 0;
        colors[idx] = (inp && inp.value) ? String(inp.value).trim() : '';
      });
      out.charts.push({
        key: key,
        enabled: !!(enabledEl && enabledEl.checked),
        label: labelEl && labelEl.value != null ? String(labelEl.value).trim() : key,
        mode: modeEl && modeEl.value != null ? String(modeEl.value).trim().toLowerCase() : 'line',
        colors: colors.filter(function (c) { return !!c; }),
        pieMetric: metricEl && metricEl.value != null ? String(metricEl.value).trim().toLowerCase() : undefined,
      });
    });
    return out;
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
      var cfg = buildChartsUiConfigFromDom();
      setMsg('Saving\u2026', true);
      saveSettings({ chartsUiConfig: cfg })
        .then(function (r) {
          if (r && r.ok) {
            chartsUiConfigCache = r.chartsUiConfig || cfg;
            setMsg('Saved.', true);
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
      var row = btn.closest('tr[data-kpi-key], tr[data-range-key]');
      if (!row) return;
      e.preventDefault();
      moveRow(row, action);
    });
  }

  function renderKpiTable(rootId, items, kind) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var rows = Array.isArray(items) ? items : [];
    var html = '<div class="table-responsive">' +
      '<table class="table table-sm table-vcenter mb-0">' +
      '<thead><tr>' +
      '<th class="w-1">On</th>' +
      '<th>Label</th>' +
      '<th class="text-muted">Key</th>' +
      '<th class="text-end w-1">Order</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function (it) {
      if (!it) return;
      var key = String(it.key || '').trim().toLowerCase();
      if (!key) return;
      var label = it.label != null ? String(it.label) : key;
      var enabled = !!it.enabled;
      html += '<tr data-kpi-key="' + escapeHtml(key) + '">' +
        '<td><label class="form-check form-switch m-0"><input class="form-check-input" type="checkbox" data-field="enabled" ' + (enabled ? 'checked' : '') + '></label></td>' +
        '<td><input type="text" class="form-control form-control-sm" data-field="label" value="' + escapeHtml(label) + '"></td>' +
        '<td class="text-muted small">' + escapeHtml(key) + '</td>' +
        '<td class="text-end"><div class="btn-group btn-group-sm" role="group" aria-label="Reorder">' +
          '<button type="button" class="btn btn-outline-secondary" data-action="up" aria-label="Move up">\u2191</button>' +
          '<button type="button" class="btn btn-outline-secondary" data-action="down" aria-label="Move down">\u2193</button>' +
        '</div></td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    root.innerHTML = html;
    wireReorderButtons(root);
  }

  function renderDateRangesTable(rootId, items) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var rows = Array.isArray(items) ? items : [];
    var html = '<div class="table-responsive">' +
      '<table class="table table-sm table-vcenter mb-0">' +
      '<thead><tr>' +
      '<th class="w-1">On</th>' +
      '<th>Label</th>' +
      '<th class="text-muted">Key</th>' +
      '<th class="text-end w-1">Order</th>' +
      '</tr></thead><tbody>';
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
    root.innerHTML = html;
    wireReorderButtons(root);
  }

  function readKpiTable(rootId) {
    var root = document.getElementById(rootId);
    if (!root) return [];
    var out = [];
    root.querySelectorAll('tr[data-kpi-key]').forEach(function (tr) {
      var key = (tr.getAttribute('data-kpi-key') || '').trim().toLowerCase();
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
    var c = cfg && typeof cfg === 'object' ? cfg : defaultKpiUiConfigV1();
    var options = c.options || {};
    var condensed = options.condensed || {};
    var dashboard = options.dashboard || {};

    var optCondDelta = document.getElementById('settings-kpi-opt-condensed-delta');
    var optCondProg = document.getElementById('settings-kpi-opt-condensed-progress');
    var optCondSpark = document.getElementById('settings-kpi-opt-condensed-sparkline');
    var optDashDelta = document.getElementById('settings-kpi-opt-dashboard-delta');
    if (optCondDelta) optCondDelta.checked = condensed.showDelta !== false;
    if (optCondProg) optCondProg.checked = condensed.showProgress !== false;
    if (optCondSpark) optCondSpark.checked = condensed.showSparkline !== false;
    if (optDashDelta) optDashDelta.checked = dashboard.showDelta !== false;

    renderKpiTable('settings-kpis-dashboard-root', (c.kpis && c.kpis.dashboard) ? c.kpis.dashboard : [], 'dashboard');
    renderKpiTable('settings-kpis-header-root', (c.kpis && c.kpis.header) ? c.kpis.header : [], 'header');
    renderDateRangesTable('settings-date-ranges-root', c.dateRanges || []);
  }

  function buildKpiUiConfigFromDom() {
    var optCondDelta = document.getElementById('settings-kpi-opt-condensed-delta');
    var optCondProg = document.getElementById('settings-kpi-opt-condensed-progress');
    var optCondSpark = document.getElementById('settings-kpi-opt-condensed-sparkline');
    var optDashDelta = document.getElementById('settings-kpi-opt-dashboard-delta');
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
      },
      kpis: {
        dashboard: readKpiTable('settings-kpis-dashboard-root'),
        header: readKpiTable('settings-kpis-header-root'),
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

    loadConfigAndPopulate();
    loadSettingsAndPopulate();
    wireDataReporting();
    wireAssets();
    wireIntegrationsSubTabs();
    wireGoogleAdsActions();
    wireKpisLayoutSubTabs();
    wireKpisSaveReset();
    wireChartsSaveReset();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
