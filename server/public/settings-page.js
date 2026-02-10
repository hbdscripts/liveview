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

  var TAB_MAP = {
    general: 'settings-panel-general',
    theme: 'settings-panel-theme',
    assets: 'settings-panel-assets',
    'data-reporting': 'settings-panel-data-reporting',
    integrations: 'settings-panel-integrations',
    kpis: 'settings-panel-kpis',
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
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
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

        var reporting = c && c.reporting ? c.reporting : {};
        var pixel = c && c.pixel ? c.pixel : {};
        var ads = c && c.ads && c.ads.status ? c.ads.status : null;
        var providers = ads && Array.isArray(ads.providers) ? ads.providers : [];
        var ga = providers.find(function (p) {
          return p && String(p.key || '').toLowerCase() === 'google_ads';
        }) || null;

        document.querySelectorAll('#settings-integrations-pixel').forEach(function (el) {
          var ok = pixel && pixel.installed === true;
          var match = c && c.ingest && c.pixel && pixel.ingestUrl === (c.ingest.effectiveIngestUrl || '');
          el.innerHTML = (ok ? '<span class="badge bg-success">Installed</span>' : '<span class="badge bg-danger">Not installed</span>') +
            (match != null ? (match ? ' <span class="badge bg-success">Ingest URL match</span>' : ' <span class="badge bg-danger">Ingest URL mismatch</span>') : '');
        });
        document.querySelectorAll('#settings-integrations-googleads').forEach(function (el) {
          var conn = ga && ga.connected === true;
          el.innerHTML = conn ? '<span class="badge bg-success">Connected</span>' : '<span class="badge bg-primary-lt">Not connected</span>';
        });
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
