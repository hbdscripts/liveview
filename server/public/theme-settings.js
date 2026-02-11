(function () {
  'use strict';

  var ICON_STYLE_CLASSES = ['fa-jelly', 'fa-jelly-filled', 'fa-light', 'fa-solid', 'fa-brands'];
  var ICON_STYLE_DEFAULTS = {
    'theme-icon-default': 'fa-jelly',
    'theme-icon-topnav': 'fa-jelly-filled',
    'theme-icon-dropdown': 'fa-jelly',
    'theme-icon-settings-menu': 'fa-jelly-filled',
    'theme-icon-table-heading': 'fa-jelly-filled',
  };
  var ICON_STYLE_META = {
    'theme-icon-default': { title: 'Global default', help: 'All icon contexts not matched below.', icon: 'fa-circle-info' },
    'theme-icon-topnav': { title: 'Top nav toggles', help: 'Top nav menu titles.', icon: 'fa-table-cells-large' },
    'theme-icon-dropdown': { title: 'Dropdown menu items', help: 'All dropdown item icons.', icon: 'fa-list' },
    'theme-icon-settings-menu': { title: 'Settings left menu', help: 'Settings page sidebar icon style.', icon: 'fa-sliders' },
    'theme-icon-table-heading': { title: 'Table heading icons', help: 'Compact sortable table heading icons.', icon: 'fa-percent' },
  };
  var ICON_GLYPH_DEFAULTS = {
    'mobile-menu': 'fa-bars',
    'mobile-date': 'fa-calendar-days',
    'topnav-date-chevron': 'fa-chevron-down',
    'nav-toggle-dashboard': 'fa-table-cells-large',
    'nav-toggle-breakdown': 'fa-chart-pie',
    'nav-toggle-traffic': 'fa-route',
    'nav-toggle-integrations': 'fa-puzzle-piece',
    'nav-toggle-tools': 'fa-screwdriver-wrench',
    'nav-toggle-settings': 'fa-gear',
    'nav-item-overview': 'fa-house',
    'nav-item-live': 'fa-satellite-dish',
    'nav-item-sales': 'fa-cart-shopping',
    'nav-item-table': 'fa-table',
    'nav-item-countries': 'fa-globe',
    'nav-item-products': 'fa-box-open',
    'nav-item-channels': 'fa-diagram-project',
    'nav-item-type': 'fa-table-cells',
    'nav-item-ads': 'fa-rectangle-ad',
    'nav-item-tools': 'fa-toolbox',
    'nav-item-settings': 'fa-gear',
    'nav-item-refresh': 'fa-rotate-right',
    'nav-item-sound-on': 'fa-volume-high',
    'nav-item-sound-off': 'fa-volume-xmark',
    'nav-item-theme': 'fa-palette',
    'nav-item-signout': 'fa-right-from-bracket',
    'table-icon-cr': 'fa-percent',
    'table-icon-orders': 'fa-box-open',
    'table-icon-sessions': 'fa-users',
    'table-icon-revenue': 'fa-sterling-sign',
    'table-icon-clicks': 'fa-hand-pointer',
    'settings-tab-general': 'fa-sliders',
    'settings-tab-theme': 'fa-palette',
    'settings-tab-assets': 'fa-image',
    'settings-tab-data-reporting': 'fa-chart-column',
    'settings-tab-integrations': 'fa-plug',
    'settings-tab-sources': 'fa-map-location-dot',
    'settings-tab-kpis': 'fa-gauge-high',
    'settings-tab-diagnostics': 'fa-chart-line',
    'settings-diagnostics-refresh': 'fa-rotate-right',
    'settings-diagnostics-reconcile': 'fa-sliders',
    'footer-refresh': 'fa-rotate-right',
    'footer-sound': 'fa-volume-high',
    'footer-theme': 'fa-palette',
    'footer-settings': 'fa-gear',
    'footer-signout': 'fa-right-from-bracket',
    'footer-last-sale-show': 'fa-eye',
    'footer-last-sale-hide': 'fa-eye-slash',
    'side-panel-close': 'fa-xmark',
    'side-panel-activity': 'fa-list',
    'side-panel-details': 'fa-user',
    'side-panel-source': 'fa-link',
    'side-panel-network': 'fa-cloud',
    'kpi-compare-refresh': 'fa-rotate-right',
    'kpi-compare-close': 'fa-xmark',
    'kpi-compare-date-info': 'fa-circle-info',
    'sale-toast-time': 'fa-clock',
    'live-landing-entry': 'fa-circle-check',
    'live-landing-exit': 'fa-circle-check',
    'live-bought-overlay': 'fa-cart-shopping',
    'pagination-prev': 'fa-chevron-left',
    'pagination-next': 'fa-chevron-right',
    'breakdown-placeholder-image': 'fa-image',
    'breakdown-icon-image': 'fa-image',
    'breakdown-icon-star': 'fa-star',
    'breakdown-icon-chart-column': 'fa-chart-column',
    'breakdown-icon-link': 'fa-link',
    'type-device-desktop': 'fa-desktop',
    'type-device-mobile': 'fa-mobile-screen',
    'type-device-tablet': 'fa-tablet-screen-button',
    'type-device-unknown': 'fa-globe',
    'type-platform-ios': 'fa-apple',
    'type-platform-android': 'fa-android',
    'type-platform-windows': 'fa-windows',
    'type-platform-linux': 'fa-linux',
    'type-platform-unknown': 'fa-circle-question',
    'diag-copy': 'fa-copy',
    'diag-tab-sales': 'fa-sterling-sign',
    'diag-tab-compare': 'fa-scale-balanced',
    'diag-tab-traffic': 'fa-route',
    'diag-tab-pixel': 'fa-crosshairs',
    'diag-tab-googleads': 'fa-rectangle-ad',
    'diag-tab-shopify': 'fa-bag-shopping',
    'diag-tab-system': 'fa-server',
    'diag-tab-definitions': 'fa-book-open',
    'ads-status-warning': 'fa-triangle-exclamation',
    'ads-status-connected': 'fa-circle-check',
    'ads-status-disconnected': 'fa-circle-xmark',
    'ads-actions-refresh': 'fa-rotate-right',
    'kpi-trend-up': 'fa-arrow-trend-up',
    'kpi-trend-down': 'fa-arrow-trend-down',
    'kpi-trend-flat': 'fa-minus',
    'chart-type-area': 'fa-chart-area',
    'chart-type-bar': 'fa-chart-column',
    'chart-type-line': 'fa-chart-line',
  };
  var ICON_GLYPH_META = {
    'mobile-menu': { title: 'Mobile menu button', help: 'Top-left mobile menu icon.', styleKey: 'theme-icon-default' },
    'mobile-date': { title: 'Mobile date button', help: 'Top-right mobile date icon.', styleKey: 'theme-icon-default' },
    'topnav-date-chevron': { title: 'Desktop date chevron', help: 'Chevron in desktop date selector.', styleKey: 'theme-icon-topnav' },
    'nav-toggle-dashboard': { title: 'Dashboard toggle', help: 'Desktop nav top-level icon.', styleKey: 'theme-icon-topnav' },
    'nav-toggle-breakdown': { title: 'Breakdown toggle', help: 'Desktop nav top-level icon.', styleKey: 'theme-icon-topnav' },
    'nav-toggle-traffic': { title: 'Traffic toggle', help: 'Desktop nav top-level icon.', styleKey: 'theme-icon-topnav' },
    'nav-toggle-integrations': { title: 'Integrations toggle', help: 'Desktop nav top-level icon.', styleKey: 'theme-icon-topnav' },
    'nav-toggle-tools': { title: 'Tools toggle', help: 'Desktop nav top-level icon.', styleKey: 'theme-icon-topnav' },
    'nav-toggle-settings': { title: 'Settings toggle', help: 'Desktop nav top-level icon.', styleKey: 'theme-icon-topnav' },
    'nav-item-overview': { title: 'Overview menu item', help: 'Dashboard dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-live': { title: 'Live view menu item', help: 'Dashboard dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-sales': { title: 'Recent sales menu item', help: 'Dashboard dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-table': { title: 'Table view menu item', help: 'Dashboard dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-countries': { title: 'Countries menu item', help: 'Breakdown dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-products': { title: 'Products menu item', help: 'Breakdown dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-channels': { title: 'Channels menu item', help: 'Traffic dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-type': { title: 'Type menu item', help: 'Traffic dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-ads': { title: 'Google Ads menu item', help: 'Integrations dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-tools': { title: 'Tools menu item', help: 'Tools dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-settings': { title: 'Settings menu item', help: 'Tools dropdown icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-refresh': { title: 'Refresh action', help: 'Settings dropdown action icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-sound-on': { title: 'Sound on action', help: 'Settings dropdown action icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-sound-off': { title: 'Sound off action', help: 'Settings dropdown action icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-theme': { title: 'Theme action', help: 'Settings dropdown action icon.', styleKey: 'theme-icon-dropdown' },
    'nav-item-signout': { title: 'Sign out action', help: 'Settings dropdown action icon.', styleKey: 'theme-icon-dropdown' },
    'table-icon-cr': { title: 'Table CR icon', help: 'Table heading short icon.', styleKey: 'theme-icon-table-heading' },
    'table-icon-orders': { title: 'Table orders icon', help: 'Table heading short icon.', styleKey: 'theme-icon-table-heading' },
    'table-icon-sessions': { title: 'Table sessions icon', help: 'Table heading short icon.', styleKey: 'theme-icon-table-heading' },
    'table-icon-revenue': { title: 'Table revenue icon', help: 'Table heading short icon.', styleKey: 'theme-icon-table-heading' },
    'table-icon-clicks': { title: 'Table clicks icon', help: 'Table heading short icon.', styleKey: 'theme-icon-table-heading' },
    'kpi-trend-up': { title: 'KPI trend up', help: 'Up delta arrow on KPI chips/cards.', styleKey: 'theme-icon-default' },
    'kpi-trend-down': { title: 'KPI trend down', help: 'Down delta arrow on KPI chips/cards.', styleKey: 'theme-icon-default' },
    'kpi-trend-flat': { title: 'KPI trend flat', help: 'Flat/minus delta icon on KPI chips/cards.', styleKey: 'theme-icon-default' },
    'chart-type-area': { title: 'Chart type: Area', help: 'Chart type switch button icon.', styleKey: 'theme-icon-default' },
    'chart-type-bar': { title: 'Chart type: Bar', help: 'Chart type switch button icon.', styleKey: 'theme-icon-default' },
    'chart-type-line': { title: 'Chart type: Line', help: 'Chart type switch button icon.', styleKey: 'theme-icon-default' },
  };

  var DEFAULTS = {
    theme: 'light',
    'theme-primary': 'green',
    'theme-radius': '1',
    'theme-font': 'sans',
    'theme-base': 'slate',
  };
  Object.keys(ICON_STYLE_DEFAULTS).forEach(function (k) { DEFAULTS[k] = ICON_STYLE_DEFAULTS[k]; });
  Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (k) { DEFAULTS['theme-icon-glyph-' + k] = ICON_GLYPH_DEFAULTS[k]; });

  var KEYS = Object.keys(DEFAULTS).filter(function (k) { return k !== 'theme'; });
  var ICON_STYLE_KEYS = Object.keys(ICON_STYLE_DEFAULTS);
  var ICON_GLYPH_KEYS = Object.keys(ICON_GLYPH_DEFAULTS).map(function (k) { return 'theme-icon-glyph-' + k; });

  // Primary color map: name -> [hex, r, g, b]
  var PRIMARY_COLORS = {
    blue: ['#206bc4', '32,107,196'],
    azure: ['#4299e1', '66,153,225'],
    indigo: ['#4263eb', '66,99,235'],
    purple: ['#ae3ec9', '174,62,201'],
    pink: ['#d6336c', '214,51,108'],
    red: ['#d63939', '214,57,57'],
    orange: ['#f76707', '247,103,7'],
    yellow: ['#f59f00', '245,159,0'],
    lime: ['#74b816', '116,184,22'],
    green: ['#3eb3ab', '62,179,171'],
    teal: ['#0ca678', '12,166,120'],
    cyan: ['#17a2b8', '23,162,184'],
  };

  // Border radius scale -> CSS value
  var RADIUS_MAP = {
    '0': '0',
    '0.5': '.25rem',
    '1': '.375rem',
    '1.5': '.5rem',
    '2': '2rem',
  };

  // Font family map
  var FONT_FAMILIES = {
    sans: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    serif: 'Georgia, Cambria, \"Times New Roman\", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
    comic: '\"Comic Sans MS\", \"Comic Sans\", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  };

  // Gray palette map (Tabler uses --tblr-gray-50..950)
  var BASE_PALETTES = {
    slate: { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617' },
    gray: { 50:'#f9fafb',100:'#f3f4f6',200:'#e5e7eb',300:'#d1d5db',400:'#9ca3af',500:'#6b7280',600:'#4b5563',700:'#374151',800:'#1f2937',900:'#111827',950:'#030712' },
    zinc: { 50:'#fafafa',100:'#f4f4f5',200:'#e4e4e7',300:'#d4d4d8',400:'#a1a1aa',500:'#71717a',600:'#52525b',700:'#3f3f46',800:'#27272a',900:'#18181b',950:'#09090b' },
    neutral: { 50:'#fafafa',100:'#f5f5f5',200:'#e5e5e5',300:'#d4d4d4',400:'#a3a3a3',500:'#737373',600:'#525252',700:'#404040',800:'#262626',900:'#171717',950:'#0a0a0a' },
    stone: { 50:'#fafaf9',100:'#f5f5f4',200:'#e7e5e4',300:'#d6d3d1',400:'#a8a29e',500:'#78716c',600:'#57534e',700:'#44403c',800:'#292524',900:'#1c1917',950:'#0c0a09' },
  };

  function getStored(key) {
    try { return localStorage.getItem('tabler-' + key); } catch (_) { return null; }
  }

  function setStored(key, val) {
    try { localStorage.setItem('tabler-' + key, val); } catch (_) {}
  }

  function removeStored(key) {
    try { localStorage.removeItem('tabler-' + key); } catch (_) {}
  }

  function normalizeIconStyle(value, fallback) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    if (!raw) return fallback;
    if (raw.indexOf('fa-jelly-filled') >= 0 || raw === 'jelly-filled') return 'fa-jelly-filled';
    if (raw.indexOf('fa-jelly') >= 0 || raw === 'jelly') return 'fa-jelly';
    if (raw.indexOf('fa-solid') >= 0 || raw === 'solid') return 'fa-solid';
    if (raw.indexOf('fa-light') >= 0 || raw === 'light') return 'fa-light';
    if (raw.indexOf('fa-brands') >= 0 || raw === 'brands' || raw === 'brand') return 'fa-brands';
    return fallback;
  }

  function sanitizeIconClassString(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function isIconStyleToken(token) {
    return token === 'fa-jelly' || token === 'fa-jelly-filled' || token === 'fa-light' ||
      token === 'fa-solid' || token === 'fa-brands' || token === 'fas' || token === 'far' ||
      token === 'fal' || token === 'fab';
  }

  function parseIconGlyphInput(value, fallback) {
    var raw = sanitizeIconClassString(value).toLowerCase();
    var safeFallback = fallback || 'fa-circle';
    if (!raw) return { mode: 'glyph', value: safeFallback, glyph: safeFallback };
    var tokens = raw.split(/\s+/).filter(Boolean);
    var faTokens = tokens.filter(function (t) { return t === 'fa' || t.indexOf('fa-') === 0 || t === 'fas' || t === 'far' || t === 'fal' || t === 'fab'; });
    var hasExplicitStyle = tokens.some(isIconStyleToken);
    var styleOrSubset = hasExplicitStyle || faTokens.length >= 2;
    if (styleOrSubset) {
      var full = tokens.slice();
      var hasGlyph = full.some(function (t) { return t.indexOf('fa-') === 0 && !isIconStyleToken(t); });
      if (!hasGlyph) full.push(safeFallback);
      return { mode: 'full', value: full.join(' '), full: full.join(' ') };
    }
    var m = raw.match(/fa-[a-z0-9-]+/);
    if (m && m[0]) return { mode: 'glyph', value: m[0], glyph: m[0] };
    if (/^[a-z0-9-]+$/.test(raw)) return { mode: 'glyph', value: 'fa-' + raw, glyph: 'fa-' + raw };
    return { mode: 'glyph', value: safeFallback, glyph: safeFallback };
  }

  function normalizeIconGlyph(value, fallback) {
    return parseIconGlyphInput(value, fallback).value;
  }

  function glyphNameFromThemeKey(themeKey) {
    return String(themeKey || '').replace(/^theme-icon-glyph-/, '');
  }

  function titleizeIconKey(name) {
    var s = String(name || '').replace(/-/g, ' ').trim();
    if (!s) return 'Icon';
    return s.replace(/\b\w/g, function (m) { return m.toUpperCase(); });
  }

  function defaultStyleKeyForGlyph(name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return 'theme-icon-default';
    if (key.indexOf('nav-toggle-') === 0 || key === 'topnav-date-chevron') return 'theme-icon-topnav';
    if (key.indexOf('nav-item-') === 0) return 'theme-icon-dropdown';
    if (key.indexOf('settings-tab-') === 0) return 'theme-icon-settings-menu';
    if (key.indexOf('table-icon-') === 0) return 'theme-icon-table-heading';
    return 'theme-icon-default';
  }

  function glyphMetaFor(name) {
    var custom = ICON_GLYPH_META[name];
    if (custom) return custom;
    return {
      title: titleizeIconKey(name),
      help: 'Glyph class or full class override.',
      styleKey: defaultStyleKeyForGlyph(name),
    };
  }

  function triggerIconThemeRefresh() {
    try {
      window.dispatchEvent(new CustomEvent('kexo:icon-theme-changed'));
      if (window.KexoIconTheme && typeof window.KexoIconTheme.refresh === 'function') window.KexoIconTheme.refresh();
    } catch (_) {}
  }

  function applyTheme(key, value) {
    var root = document.documentElement;
    if (key === 'theme') {
      document.body.classList.toggle('theme-dark', value === 'dark');
      root.setAttribute('data-bs-theme', value || 'light');
      root.classList.remove('theme-dark-early');
    } else if (key === 'theme-primary') {
      var color = PRIMARY_COLORS[value];
      if (color) {
        root.style.setProperty('--tblr-primary', color[0]);
        root.style.setProperty('--tblr-primary-rgb', color[1]);
      } else {
        root.style.removeProperty('--tblr-primary');
        root.style.removeProperty('--tblr-primary-rgb');
      }
    } else if (key === 'theme-radius') {
      var r = RADIUS_MAP[value];
      if (r != null) {
        root.style.setProperty('--tblr-border-radius', r);
        root.style.setProperty('--tblr-border-radius-sm', r === '0' ? '0' : 'calc(' + r + ' * .75)');
        root.style.setProperty('--tblr-border-radius-lg', r === '0' ? '0' : 'calc(' + r + ' * 1.5)');
        root.style.setProperty('--tblr-border-radius-xl', r === '0' ? '0' : 'calc(' + r + ' * 3)');
        root.style.setProperty('--radius', r);
      } else {
        root.style.removeProperty('--tblr-border-radius');
        root.style.removeProperty('--tblr-border-radius-sm');
        root.style.removeProperty('--tblr-border-radius-lg');
        root.style.removeProperty('--tblr-border-radius-xl');
        root.style.removeProperty('--radius');
      }
    } else if (key === 'theme-font') {
      var ff = FONT_FAMILIES[value];
      if (ff) {
        root.style.setProperty('--tblr-font-sans-serif', ff);
        root.style.setProperty('--bs-body-font-family', ff);
      } else {
        root.style.removeProperty('--tblr-font-sans-serif');
        root.style.removeProperty('--bs-body-font-family');
      }
    } else if (key === 'theme-base') {
      var palette = BASE_PALETTES[value];
      if (!palette) {
        ['50','100','200','300','400','500','600','700','800','900','950'].forEach(function (k) {
          root.style.removeProperty('--tblr-gray-' + k);
        });
      } else {
        Object.keys(palette).forEach(function (k) {
          root.style.setProperty('--tblr-gray-' + k, palette[k]);
        });
      }
    } else if (ICON_STYLE_KEYS.indexOf(key) >= 0 || ICON_GLYPH_KEYS.indexOf(key) >= 0) {
      triggerIconThemeRefresh();
    }
  }

  function restoreAll() {
    applyTheme('theme', 'light');
    KEYS.forEach(function (key) {
      var val = getStored(key);
      if (val !== null) applyTheme(key, val);
      else applyTheme(key, DEFAULTS[key]);
    });
  }

  // Fetch server defaults for first-time visitors (no localStorage yet)
  function fetchDefaults() {
    var hasAny = KEYS.some(function (k) { return getStored(k) !== null; });
    if (hasAny) return;

    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        KEYS.forEach(function (key) {
          var dbKey = key.replace(/-/g, '_');
          var val = data[dbKey] || data[key];
          if (val) setStored(key, val);
          applyTheme(key, val || DEFAULTS[key]);
        });
        syncUI();
      })
      .catch(function () {});
  }

  function saveToServer() {
    var payload = {};
    KEYS.forEach(function (key) {
      var dbKey = key.replace(/-/g, '_');
      payload[dbKey] = getStored(key) || DEFAULTS[key];
    });
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(function () {});
  }

  function syncUI() {
    var form = document.getElementById('theme-settings-form');
    if (!form) return;
    KEYS.forEach(function (key) {
      var val = getStored(key) || DEFAULTS[key];
      if (ICON_STYLE_KEYS.indexOf(key) >= 0) {
        var styleInput = form.querySelector('[name="' + key + '"]');
        if (styleInput) styleInput.value = normalizeIconStyle(val, DEFAULTS[key]);
        return;
      }
      if (ICON_GLYPH_KEYS.indexOf(key) >= 0) {
        var glyphInput = form.querySelector('[name="' + key + '"]');
        if (glyphInput) glyphInput.value = normalizeIconGlyph(val, DEFAULTS[key]);
        return;
      }
      var radios = form.querySelectorAll('[name="' + key + '"]');
      radios.forEach(function (r) { r.checked = (r.value === val); });
    });
    refreshIconPreviews(form);
  }

  function styleInputCard(key) {
    var meta = ICON_STYLE_META[key] || { title: key, help: '', icon: 'fa-circle-info' };
    var inputId = 'theme-input-' + key;
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2">' +
            '<i class="fa-jelly ' + meta.icon + ' me-2" data-theme-icon-preview="' + key + '" aria-hidden="true"></i>' +
            '<strong>' + meta.title + '</strong>' +
          '</div>' +
          '<div class="text-secondary small mb-2">' + meta.help + '</div>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" data-theme-icon-style-input="' + key + '" placeholder="' + DEFAULTS[key] + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function glyphInputCard(key) {
    var name = glyphNameFromThemeKey(key);
    var meta = glyphMetaFor(name);
    var inputId = 'theme-input-' + key;
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2">' +
            '<i class="fa-jelly ' + ICON_GLYPH_DEFAULTS[name] + ' me-2" data-theme-icon-preview-glyph="' + key + '" aria-hidden="true"></i>' +
            '<strong>' + meta.title + '</strong>' +
          '</div>' +
          '<div class="text-secondary small mb-2">' + meta.help + '</div>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" data-theme-icon-glyph-input="' + key + '" placeholder="' + (DEFAULTS[key] || 'fa-circle') + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function radioCard(name, value, label) {
    var id = 'theme-opt-' + name + '-' + (value || 'default');
    return '<label class="form-selectgroup-item flex-fill">' +
      '<input type="radio" name="' + name + '" value="' + value + '" class="form-selectgroup-input" id="' + id + '">' +
      '<div class="form-selectgroup-label d-flex align-items-center justify-content-center p-2">' +
        '<span class="form-selectgroup-label-content">' + label + '</span>' +
      '</div>' +
    '</label>';
  }

  function colorCard(name, value, label) {
    var color = PRIMARY_COLORS[value];
    var swatch = color ? '<span class="avatar avatar-xs rounded-circle me-2" style="background:' + color[0] + '"></span>' : '';
    var id = 'theme-opt-' + name + '-' + (value || 'default');
    return '<div class="col-4">' +
      '<label class="form-selectgroup-item flex-fill">' +
        '<input type="radio" name="' + name + '" value="' + value + '" class="form-selectgroup-input" id="' + id + '">' +
        '<div class="form-selectgroup-label d-flex align-items-center p-2">' +
          swatch +
          '<span class="form-selectgroup-label-content" style="font-size:.8125rem">' + label + '</span>' +
        '</div>' +
      '</label>' +
    '</div>';
  }

  function getThemeFormHtml() {
    var styleGrid = ICON_STYLE_KEYS.map(function (k) { return styleInputCard(k); }).join('');
    var glyphGrid = ICON_GLYPH_KEYS.map(function (k) { return glyphInputCard(k); }).join('');
    return '<form id="theme-settings-form">' +
      '<ul class="nav nav-underline mb-3" id="theme-subtabs" role="tablist">' +
        '<li class="nav-item" role="presentation"><button class="nav-link active" type="button" role="tab" data-theme-subtab="icons" aria-selected="true">Icons</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="color" aria-selected="false">Color</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="fonts" aria-selected="false">Fonts</button></li>' +
      '</ul>' +

      '<div class="theme-subpanel" data-theme-subpanel="icons">' +
        '<div class="text-secondary mb-3">Control icon style classes and specific icon glyphs with live preview. Enter a single glyph (for example <code>fa-gear</code>) or a full class override (for example <code>fa-etch fa-solid fa-address-card</code>). Desktop shows a 3-column grid; mobile stacks to one per line.</div>' +
        '<h4 class="mb-2">Style rules</h4>' +
        '<div class="row g-3">' + styleGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Icon glyph overrides</h4>' +
        '<div class="row g-3">' + glyphGrid + '</div>' +
        '<div class="d-flex align-items-center gap-2 mt-3">' +
          '<button type="button" class="btn btn-outline-secondary btn-sm" id="theme-icons-refresh">Refresh previews</button>' +
          '<span class="text-secondary small">Debounced preview updates after typing stops.</span>' +
        '</div>' +
      '</div>' +

      '<div class="theme-subpanel" data-theme-subpanel="color" hidden>' +
        '<div class="mb-4">' +
          '<label class="form-label">Primary color</label>' +
          '<div class="row g-2">' +
            colorCard('theme-primary', 'blue', 'Blue') +
            colorCard('theme-primary', 'azure', 'Azure') +
            colorCard('theme-primary', 'indigo', 'Indigo') +
            colorCard('theme-primary', 'purple', 'Purple') +
            colorCard('theme-primary', 'pink', 'Pink') +
            colorCard('theme-primary', 'red', 'Red') +
            colorCard('theme-primary', 'orange', 'Orange') +
            colorCard('theme-primary', 'yellow', 'Yellow') +
            colorCard('theme-primary', 'lime', 'Lime') +
            colorCard('theme-primary', 'green', 'Green') +
            colorCard('theme-primary', 'teal', 'Teal') +
            colorCard('theme-primary', 'cyan', 'Cyan') +
          '</div>' +
        '</div>' +
        '<div class="mb-4">' +
          '<label class="form-label">Theme base</label>' +
          '<div class="form-selectgroup">' +
            radioCard('theme-base', 'slate', 'Slate') +
            radioCard('theme-base', 'gray', 'Gray') +
            radioCard('theme-base', 'zinc', 'Zinc') +
            radioCard('theme-base', 'neutral', 'Neutral') +
            radioCard('theme-base', 'stone', 'Stone') +
          '</div>' +
        '</div>' +
        '<div class="mb-2">' +
          '<label class="form-label">Corner radius</label>' +
          '<div class="form-selectgroup">' +
            radioCard('theme-radius', '0', '0') +
            radioCard('theme-radius', '0.5', '0.5') +
            radioCard('theme-radius', '1', '1') +
            radioCard('theme-radius', '1.5', '1.5') +
            radioCard('theme-radius', '2', '2') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="theme-subpanel" data-theme-subpanel="fonts" hidden>' +
        '<div class="mb-2">' +
          '<label class="form-label">Font family</label>' +
          '<div class="form-selectgroup">' +
            radioCard('theme-font', 'sans', 'Sans-serif') +
            radioCard('theme-font', 'serif', 'Serif') +
            radioCard('theme-font', 'mono', 'Monospace') +
            radioCard('theme-font', 'comic', 'Comic') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</form>' +
    '<div class="d-flex gap-2 mt-3">' +
      '<button type="button" class="btn btn-primary flex-fill" id="theme-save-defaults">Save as default</button>' +
      '<button type="button" class="btn btn-outline-secondary" id="theme-reset">Reset</button>' +
    '</div>';
  }

  function wireThemeSubTabs(root) {
    var tabs = root ? root.querySelectorAll('[data-theme-subtab]') : null;
    var panels = root ? root.querySelectorAll('[data-theme-subpanel]') : null;
    if (!tabs || !tabs.length || !panels || !panels.length) return;
    function activate(key) {
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-theme-subtab') === key;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(function (panel) {
        var active = panel.getAttribute('data-theme-subpanel') === key;
        panel.hidden = !active;
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-theme-subtab') || 'icons');
      });
    });
    activate('icons');
  }

  function setPreviewIconClass(previewEl, styleCls, glyphCls) {
    if (!previewEl) return;
    var parsed = parseIconGlyphInput(glyphCls, 'fa-circle');
    previewEl.className = parsed.mode === 'full'
      ? parsed.value
      : (normalizeIconStyle(styleCls, 'fa-jelly') + ' ' + parsed.value);
  }

  function styleForGlyphPreview(formEl, glyphThemeKey) {
    var glyphName = glyphNameFromThemeKey(glyphThemeKey);
    var meta = glyphMetaFor(glyphName);
    var styleKey = meta.styleKey || 'theme-icon-default';
    var styleInput = formEl ? formEl.querySelector('[name="' + styleKey + '"]') : null;
    var styleVal = styleInput && styleInput.value ? styleInput.value : (getStored(styleKey) || DEFAULTS[styleKey] || 'fa-jelly');
    return normalizeIconStyle(styleVal, DEFAULTS[styleKey] || 'fa-jelly');
  }

  function refreshIconPreviews(formEl) {
    if (!formEl) return;
    ICON_STYLE_KEYS.forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      var preview = formEl.querySelector('[data-theme-icon-preview="' + key + '"]');
      var styleVal = input && input.value ? input.value : (getStored(key) || DEFAULTS[key]);
      var glyphVal = (ICON_STYLE_META[key] && ICON_STYLE_META[key].icon) ? ICON_STYLE_META[key].icon : 'fa-circle-info';
      setPreviewIconClass(preview, styleVal, glyphVal);
    });
    ICON_GLYPH_KEYS.forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      var preview = formEl.querySelector('[data-theme-icon-preview-glyph="' + key + '"]');
      var glyphVal = input && input.value ? input.value : (getStored(key) || DEFAULTS[key]);
      var styleVal = styleForGlyphPreview(formEl, key);
      setPreviewIconClass(preview, styleVal, glyphVal);
    });
  }

  function bindThemeForm(formEl) {
    if (!formEl) return;
    var debounceTimers = {};

    function debouncedApply(name, value) {
      if (debounceTimers[name]) clearTimeout(debounceTimers[name]);
      debounceTimers[name] = setTimeout(function () {
        applyTheme(name, value);
      }, 350);
    }

    formEl.addEventListener('change', function (e) {
      var name = e && e.target ? e.target.name : '';
      var val = e && e.target && e.target.value != null ? String(e.target.value).trim() : '';
      if (!name) return;
      if (ICON_STYLE_KEYS.indexOf(name) >= 0) val = normalizeIconStyle(val, DEFAULTS[name]);
      if (ICON_GLYPH_KEYS.indexOf(name) >= 0) val = normalizeIconGlyph(val, DEFAULTS[name]);
      setStored(name, val);
      applyTheme(name, val);
      refreshIconPreviews(formEl);
    });

    ICON_STYLE_KEYS.concat(ICON_GLYPH_KEYS).forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      if (!input) return;
      input.addEventListener('input', function () {
        var val = String(input.value || '').trim();
        if (ICON_STYLE_KEYS.indexOf(key) >= 0) val = normalizeIconStyle(val, DEFAULTS[key]);
        if (ICON_GLYPH_KEYS.indexOf(key) >= 0) val = normalizeIconGlyph(val, DEFAULTS[key]);
        setStored(key, val);
        refreshIconPreviews(formEl);
        debouncedApply(key, val);
      });
    });

    var root = formEl.parentElement || document;
    var refreshBtn = root.querySelector('#theme-icons-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      refreshIconPreviews(formEl);
      triggerIconThemeRefresh();
    });

    var saveBtn = root.querySelector('#theme-save-defaults');
    var resetBtn = root.querySelector('#theme-reset');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      saveToServer();
      var btn = this;
      btn.textContent = 'Saved!';
      btn.classList.replace('btn-primary', 'btn-success');
      setTimeout(function () {
        btn.textContent = 'Save as default';
        btn.classList.replace('btn-success', 'btn-primary');
      }, 1500);
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      KEYS.forEach(function (key) {
        removeStored(key);
        applyTheme(key, DEFAULTS[key]);
      });
      syncUI();
      triggerIconThemeRefresh();
    });

    wireThemeSubTabs(root);
    syncUI();
  }

  // Build offcanvas and inject into page
  function injectOffcanvas() {
    if (document.getElementById('theme-offcanvas')) return;
    var html = '<div class="offcanvas offcanvas-end" tabindex="-1" id="theme-offcanvas" aria-labelledby="theme-offcanvas-label">' +
      '<div class="offcanvas-header">' +
        '<h2 class="offcanvas-title" id="theme-offcanvas-label">Theme Settings</h2>' +
        '<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>' +
      '</div>' +
      '<div class="offcanvas-body">' + getThemeFormHtml() + '</div>' +
    '</div>';
    document.body.insertAdjacentHTML('beforeend', html);
    bindThemeForm(document.getElementById('theme-settings-form'));
  }

  function injectSettingsThemePanel() {
    var panel = document.getElementById('settings-theme-panel');
    if (!panel || panel.querySelector('#theme-settings-form')) return;
    panel.innerHTML = getThemeFormHtml();
    bindThemeForm(panel.querySelector('#theme-settings-form'));
  }

  // Open the theme offcanvas programmatically
  function openThemePanel() {
    injectOffcanvas();
    var el = document.getElementById('theme-offcanvas');
    if (el && typeof bootstrap !== 'undefined') {
      var offcanvas = bootstrap.Offcanvas.getOrCreateInstance(el);
      offcanvas.show();
    }
  }

  function bindThemeButtons() {
    var isSettingsPage = document.body.getAttribute('data-page') === 'settings';
    if (!isSettingsPage) injectOffcanvas();
    var sidebarBtn = document.getElementById('theme-settings-btn');
    var isSettingsLink = sidebarBtn && sidebarBtn.getAttribute('href') && String(sidebarBtn.getAttribute('href')).indexOf('/settings') >= 0;
    if (sidebarBtn && !isSettingsLink) {
      sidebarBtn.setAttribute('data-bs-toggle', 'offcanvas');
      sidebarBtn.setAttribute('data-bs-target', '#theme-offcanvas');
      sidebarBtn.addEventListener('click', function () {
        var dd = sidebarBtn.closest('.dropdown-menu');
        if (dd) {
          var toggle = dd.previousElementSibling;
          if (toggle && typeof bootstrap !== 'undefined') {
            try { bootstrap.Dropdown.getOrCreateInstance(toggle).hide(); } catch (_) {}
          }
        }
      });
    }
    if (!isSettingsPage) {
      document.querySelectorAll('.footer-theme-btn').forEach(function (btn) {
        btn.setAttribute('data-bs-toggle', 'offcanvas');
        btn.setAttribute('data-bs-target', '#theme-offcanvas');
      });
    }
  }

  try { window.openThemePanel = openThemePanel; } catch (_) {}

  // Init
  restoreAll();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindThemeButtons();
      fetchDefaults();
      if (document.body.getAttribute('data-page') === 'settings') injectSettingsThemePanel();
    });
  } else {
    bindThemeButtons();
    fetchDefaults();
    if (document.body.getAttribute('data-page') === 'settings') injectSettingsThemePanel();
  }
})();
