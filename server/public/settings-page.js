/**
 * Settings page – tab switching and layout. Standalone; no app.js modifications.
 * Runs only when data-page="settings".
 */
(function () {
  'use strict';

  if (document.body.getAttribute('data-page') !== 'settings') return;

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
    try {
      history.replaceState(null, '', url);
    } catch (_) {}
  }

  function activateTab(key) {
    var navItems = document.querySelectorAll('[data-settings-tab]');
    var panels = document.querySelectorAll('.settings-panel');

    navItems.forEach(function (el) {
      var isActive = el.getAttribute('data-settings-tab') === key;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    panels.forEach(function (el) {
      var panelKey = el.id && el.id.replace('settings-panel-', '');
      el.classList.toggle('active', panelKey === key);
    });

    updateUrl(key);
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
