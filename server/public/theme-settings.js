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
    'chart-type-area': 'fa-chart-area',
    'chart-type-bar': 'fa-chart-column',
    'chart-type-line': 'fa-chart-line',
    'table-short-geo': 'fa-globe',
    'table-short-country-product': 'fa-globe',
    'table-short-source': 'fa-link',
    'table-short-landing': 'fa-link',
    'table-short-device': 'fa-mobile-screen',
    'table-short-cart': 'fa-box-open',
    'table-short-arrived': 'fa-circle-check',
    'table-short-seen': 'fa-eye',
    'table-short-history': 'fa-list',
    'table-short-type': 'fa-table-cells',
    'table-short-product': 'fa-box-open',
    'table-short-consent': 'fa-circle-info',
    'card-title-online': 'fa-jelly-filled fa-users',
    'card-title-revenue': 'fa-jelly-filled fa-sterling-sign',
    'card-title-orders': 'fa-jelly-filled fa-box-open',
    'card-title-conversion': 'fa-jelly-filled fa-percent',
    'card-title-sessions': 'fa-jelly-filled fa-users',
    'card-title-countries': 'fa-jelly-filled fa-globe',
    'card-title-products': 'fa-jelly-filled fa-box-open',
    'card-title-channels': 'fa-jelly-filled fa-diagram-project',
    'card-title-type': 'fa-jelly-filled fa-table-cells',
    'card-title-ads': 'fa-brands fa-google',
    'card-title-tools': 'fa-jelly-filled fa-toolbox',
    'card-title-settings': 'fa-jelly-filled fa-gear',
    'card-title-date': 'fa-jelly-filled fa-calendar-days',
    'card-title-dashboard': 'fa-jelly-filled fa-gauge-high',
    'card-title-traffic': 'fa-jelly-filled fa-route',
    'card-title-trending-up': 'fa-jelly-filled fa-arrow-trend-up',
    'card-title-trending-down': 'fa-jelly-filled fa-arrow-trend-down',
    'card-title-chart': 'fa-jelly-filled fa-chart-line',
    'online-status-indicator': 'fa-circle',
    'card-collapse-expanded': 'fa-chevron-down',
    'card-collapse-collapsed': 'fa-chevron-right',
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
    'nav-item-settings': { title: 'Settings menu item', help: 'Settings dropdown icon.', styleKey: 'theme-icon-dropdown' },
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
    'card-title-trending-up': { title: 'Table Trending Up', help: 'Dashboard table title icon.', styleKey: 'theme-icon-default' },
    'card-title-trending-down': { title: 'Table Trending Down', help: 'Dashboard table title icon.', styleKey: 'theme-icon-default' },
    'online-status-indicator': { title: 'Online status indicator', help: 'Desktop top strip live visitor icon.', styleKey: 'theme-icon-default' },
    'card-collapse-expanded': { title: 'Card collapse expanded', help: 'Chevron shown when card content is open.', styleKey: 'theme-icon-default' },
    'card-collapse-collapsed': { title: 'Card collapse collapsed', help: 'Chevron shown when card content is collapsed.', styleKey: 'theme-icon-default' },
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
    'theme-preference-mode': 'global',
    'theme-icon-size': '1em',
    'theme-icon-color': 'currentColor',
    'theme-header-top-bg': '#ffffff',
    'theme-header-top-text-color': '#1f2937',
    'theme-header-main-bg': '#ffffff',
    'theme-header-link-color': '#1f2937',
    'theme-header-main-link-color': '#1f2937',
    'theme-header-main-dropdown-bg': '#ffffff',
    'theme-header-main-dropdown-link-color': '#1f2937',
    'theme-header-main-dropdown-icon-color': '#1f2937',
    'theme-header-main-border': 'show',
    'theme-header-main-border-color': '#e6e7e9',
    'theme-header-main-shadow': '2px 2px 2px #eee',
    'theme-header-settings-label': 'show',
    'theme-header-settings-bg': '#ffffff',
    'theme-header-settings-text-color': '#1f2937',
    'theme-header-settings-radius': '.375rem',
    'theme-header-settings-border': 'show',
    'theme-header-settings-border-color': '#e6e7e9',
    'theme-header-online-bg': '#f8fafc',
    'theme-header-online-text-color': '#1f2937',
    'theme-header-online-radius': '.375rem',
    'theme-header-online-border': 'show',
    'theme-header-online-border-color': '#e6e7e9',
    'theme-header-logo-url': '',
  };
  Object.keys(ICON_STYLE_DEFAULTS).forEach(function (k) { DEFAULTS[k] = ICON_STYLE_DEFAULTS[k]; });
  Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (k) { DEFAULTS['theme-icon-glyph-' + k] = ICON_GLYPH_DEFAULTS[k]; });

  var KEYS = Object.keys(DEFAULTS).filter(function (k) { return k !== 'theme'; });
  var ICON_STYLE_KEYS = Object.keys(ICON_STYLE_DEFAULTS);
  var ICON_GLYPH_KEYS = Object.keys(ICON_GLYPH_DEFAULTS).map(function (k) { return 'theme-icon-glyph-' + k; });
  var ICON_VISUAL_KEYS = ['theme-icon-size', 'theme-icon-color'];
  var HEADER_THEME_TEXT_KEYS = [
    'theme-header-top-bg',
    'theme-header-top-text-color',
    'theme-header-main-bg',
    'theme-header-main-link-color',
    'theme-header-main-dropdown-bg',
    'theme-header-main-dropdown-link-color',
    'theme-header-main-dropdown-icon-color',
    'theme-header-main-border-color',
    'theme-header-main-shadow',
    'theme-header-settings-bg',
    'theme-header-settings-text-color',
    'theme-header-settings-radius',
    'theme-header-settings-border-color',
    'theme-header-online-bg',
    'theme-header-online-text-color',
    'theme-header-online-radius',
    'theme-header-online-border-color',
    'theme-header-logo-url',
  ];
  var HEADER_THEME_TOGGLE_KEYS = [
    'theme-header-main-border',
    'theme-header-settings-label',
    'theme-header-settings-border',
    'theme-header-online-border',
  ];

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

  function isFontAwesomeSubsetToken(token) {
    return token === 'fa-sharp' || token === 'fa-sharp-light' || token === 'fa-sharp-regular' ||
      token === 'fa-sharp-solid' || token === 'fa-sharp-thin' || token === 'fa-sharp-duotone';
  }

  function isIconStyleToken(token) {
    return token === 'fa-jelly' || token === 'fa-jelly-filled' || token === 'fa-light' ||
      token === 'fa-solid' || token === 'fa-brands' || token === 'fa-regular' ||
      token === 'fa-thin' || token === 'fa-duotone' || isFontAwesomeSubsetToken(token) ||
      token === 'fas' || token === 'far' || token === 'fal' || token === 'fab' ||
      token === 'fat' || token === 'fad';
  }

  function parseIconGlyphInput(value, fallback) {
    var raw = sanitizeIconClassString(value).toLowerCase();
    var safeFallback = fallback || 'fa-circle';
    if (!raw) return { mode: 'glyph', value: safeFallback, glyph: safeFallback };
    var tokens = raw.split(/\s+/).filter(Boolean);
    var faTokens = tokens.filter(function (t) {
      return t === 'fa' || t.indexOf('fa-') === 0 || t === 'fas' || t === 'far' ||
        t === 'fal' || t === 'fab' || t === 'fat' || t === 'fad';
    });
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

  function normalizeIconSize(value, fallback) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return fallback || '1em';
    if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(raw)) return raw;
    if (/^\d+(\.\d+)?$/.test(raw)) return raw + 'em';
    return fallback || '1em';
  }

  function normalizeIconColor(value, fallback) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return fallback || 'currentColor';
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
    if (/^(rgb|hsl)a?\(/i.test(raw)) return raw;
    if (raw.toLowerCase() === 'currentcolor') return 'currentColor';
    if (/^[a-z-]+$/i.test(raw)) return raw;
    return fallback || 'currentColor';
  }

  function normalizeHeaderColor(value, fallback) {
    return normalizeIconColor(value, fallback || '#ffffff');
  }

  function normalizeHeaderRadius(value, fallback) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return fallback || '.375rem';
    if (raw === '0') return '0';
    if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(raw)) return raw;
    if (/^\d+(\.\d+)?$/.test(raw)) return raw + 'px';
    return fallback || '.375rem';
  }

  function normalizeHeaderShadow(value, fallback) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return fallback || '2px 2px 2px #eee';
    if (raw.toLowerCase() === 'none') return 'none';
    if (raw.length > 120) return fallback || '2px 2px 2px #eee';
    return raw;
  }

  function normalizeHeaderToggle(value, fallback) {
    var raw = sanitizeIconClassString(value).toLowerCase();
    if (raw === 'show' || raw === 'on' || raw === 'true' || raw === '1') return 'show';
    if (raw === 'hide' || raw === 'off' || raw === 'false' || raw === '0') return 'hide';
    return fallback === 'hide' ? 'hide' : 'show';
  }

  function normalizeLogoUrl(value) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return '';
    if (/^(https?:)?\/\//i.test(raw)) return raw;
    if (raw[0] === '/') return raw;
    return '';
  }

  function normalizePreferenceMode(value, fallback) {
    var raw = sanitizeIconClassString(value).toLowerCase();
    if (raw === 'global') return 'global';
    if (raw === 'user' || raw === 'user-selected' || raw === 'personal') return 'user';
    return fallback === 'user' ? 'user' : 'global';
  }

  function getPreferenceMode() {
    return normalizePreferenceMode(getStored('theme-preference-mode'), DEFAULTS['theme-preference-mode']);
  }

  function applyHeaderLogoOverride(url) {
    var safe = normalizeLogoUrl(url);
    var logos = document.querySelectorAll('.kexo-desktop-brand-link img, .kexo-mobile-logo-link img');
    if (!logos || !logos.length) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { applyHeaderLogoOverride(safe); }, { once: true });
      }
      return;
    }
    logos.forEach(function (img) {
      if (!img) return;
      var original = img.getAttribute('data-kexo-default-src');
      if (!original) {
        original = img.getAttribute('src') || '';
        img.setAttribute('data-kexo-default-src', original);
      }
      img.setAttribute('src', safe || original);
    });
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
    if (key.indexOf('table-icon-') === 0 || key.indexOf('table-short-') === 0) return 'theme-icon-table-heading';
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
    } else if (key === 'theme-preference-mode') {
      root.setAttribute('data-kexo-theme-preference-mode', normalizePreferenceMode(value, DEFAULTS[key]));
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
    } else if (key === 'theme-icon-size') {
      root.style.setProperty('--kexo-theme-icon-size', normalizeIconSize(value, DEFAULTS[key]));
    } else if (key === 'theme-icon-color') {
      root.style.setProperty('--kexo-theme-icon-color', normalizeIconColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-top-bg') {
      root.style.setProperty('--kexo-header-top-bg', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-top-text-color') {
      root.style.setProperty('--kexo-header-top-text-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-main-bg') {
      root.style.setProperty('--kexo-header-main-bg', normalizeHeaderColor(value, DEFAULTS[key]));
      root.style.setProperty('--kexo-top-menu-bg', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-link-color') {
      // Legacy shared header text key kept for backwards compatibility.
      var legacyHeader = normalizeHeaderColor(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-top-text-color', legacyHeader);
      root.style.setProperty('--kexo-top-menu-link-color', legacyHeader);
    } else if (key === 'theme-header-main-link-color') {
      root.style.setProperty('--kexo-top-menu-link-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-main-dropdown-bg') {
      root.style.setProperty('--kexo-top-menu-dropdown-bg', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-main-dropdown-link-color') {
      root.style.setProperty('--kexo-top-menu-dropdown-link-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-main-dropdown-icon-color') {
      root.style.setProperty('--kexo-top-menu-dropdown-icon-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-main-border') {
      var mainBorderMode = normalizeHeaderToggle(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-top-menu-border-width', mainBorderMode === 'hide' ? '0px' : '1px');
    } else if (key === 'theme-header-main-border-color') {
      root.style.setProperty('--kexo-top-menu-border-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-main-shadow') {
      root.style.setProperty('--kexo-top-menu-shadow', normalizeHeaderShadow(value, DEFAULTS[key]));
    } else if (key === 'theme-header-settings-label') {
      var labelMode = normalizeHeaderToggle(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-settings-label-display', labelMode === 'hide' ? 'none' : 'inline');
      root.style.setProperty('--kexo-header-settings-icon-gap', labelMode === 'hide' ? '0' : '.35rem');
    } else if (key === 'theme-header-settings-bg') {
      root.style.setProperty('--kexo-header-settings-bg', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-settings-text-color') {
      root.style.setProperty('--kexo-header-settings-text-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-settings-radius') {
      root.style.setProperty('--kexo-header-settings-radius', normalizeHeaderRadius(value, DEFAULTS[key]));
    } else if (key === 'theme-header-settings-border') {
      var settingsBorderMode = normalizeHeaderToggle(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-settings-border-width', settingsBorderMode === 'hide' ? '0px' : '1px');
    } else if (key === 'theme-header-settings-border-color') {
      root.style.setProperty('--kexo-header-settings-border-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-online-bg') {
      root.style.setProperty('--kexo-header-online-bg', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-online-text-color') {
      root.style.setProperty('--kexo-header-online-text-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-online-radius') {
      root.style.setProperty('--kexo-header-online-radius', normalizeHeaderRadius(value, DEFAULTS[key]));
    } else if (key === 'theme-header-online-border') {
      var onlineBorderMode = normalizeHeaderToggle(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-online-border-width', onlineBorderMode === 'hide' ? '0px' : '1px');
    } else if (key === 'theme-header-online-border-color') {
      root.style.setProperty('--kexo-header-online-border-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-logo-url') {
      applyHeaderLogoOverride(value);
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

  // Fetch server defaults and apply according to preference mode.
  function fetchDefaults() {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        var serverModeRaw = data.theme_preference_mode || data['theme-preference-mode'] || '';
        var mode = normalizePreferenceMode(serverModeRaw || getStored('theme-preference-mode') || DEFAULTS['theme-preference-mode'], DEFAULTS['theme-preference-mode']);
        setStored('theme-preference-mode', mode);
        applyTheme('theme-preference-mode', mode);
        var useGlobal = mode === 'global';
        KEYS.forEach(function (key) {
          if (key === 'theme-preference-mode') return;
          var dbKey = key.replace(/-/g, '_');
          var serverVal = data[dbKey] || data[key] || DEFAULTS[key];
          if (useGlobal) {
            setStored(key, serverVal);
            applyTheme(key, serverVal);
            return;
          }
          var localVal = getStored(key);
          if (localVal === null) {
            setStored(key, serverVal);
            applyTheme(key, serverVal);
            return;
          }
          applyTheme(key, localVal || DEFAULTS[key]);
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
      if (ICON_VISUAL_KEYS.indexOf(key) >= 0) {
        var visualInput = form.querySelector('[name="' + key + '"]');
        if (!visualInput) return;
        if (key === 'theme-icon-size') visualInput.value = normalizeIconSize(val, DEFAULTS[key]);
        else visualInput.value = normalizeIconColor(val, DEFAULTS[key]);
        return;
      }
      if (HEADER_THEME_TEXT_KEYS.indexOf(key) >= 0) {
        var headerTextInput = form.querySelector('[name="' + key + '"]');
        if (!headerTextInput) return;
        if (key === 'theme-header-logo-url') headerTextInput.value = normalizeLogoUrl(val);
        else if (key === 'theme-header-settings-radius' || key === 'theme-header-online-radius') headerTextInput.value = normalizeHeaderRadius(val, DEFAULTS[key]);
        else if (key === 'theme-header-main-shadow') headerTextInput.value = normalizeHeaderShadow(val, DEFAULTS[key]);
        else headerTextInput.value = normalizeHeaderColor(val, DEFAULTS[key]);
        return;
      }
      if (HEADER_THEME_TOGGLE_KEYS.indexOf(key) >= 0) {
        var toggleVal = normalizeHeaderToggle(val, DEFAULTS[key]);
        var toggleRadios = form.querySelectorAll('[name="' + key + '"]');
        toggleRadios.forEach(function (r) { r.checked = (r.value === toggleVal); });
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

  function iconVisualInputCard(key, title, help, placeholder) {
    var inputId = 'theme-input-' + key;
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2">' +
            '<i class="fa-jelly fa-sliders me-2" aria-hidden="true"></i>' +
            '<strong>' + title + '</strong>' +
          '</div>' +
          '<div class="text-secondary small mb-2">' + help + '</div>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerInputCard(key, title, help, placeholder) {
    var inputId = 'theme-input-' + key;
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2">' +
            '<i class="fa-jelly fa-window-maximize me-2" aria-hidden="true"></i>' +
            '<strong>' + title + '</strong>' +
          '</div>' +
          '<div class="text-secondary small mb-2">' + help + '</div>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerToggleCard(key, title, help) {
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2">' +
            '<i class="fa-jelly fa-toggle-on me-2" aria-hidden="true"></i>' +
            '<strong>' + title + '</strong>' +
          '</div>' +
          '<div class="text-secondary small mb-2">' + help + '</div>' +
          '<div class="form-selectgroup">' +
            radioCard(key, 'show', 'Show') +
            radioCard(key, 'hide', 'Hide') +
          '</div>' +
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
    var visualGrid = [
      iconVisualInputCard('theme-icon-size', 'Global icon size', 'CSS size value used by all Font Awesome icons (for example 1em, 14px, 0.95rem).', DEFAULTS['theme-icon-size']),
      iconVisualInputCard('theme-icon-color', 'Global icon color', 'CSS color for all icons (for example currentColor, #ffffff, rgb(255,255,255)).', DEFAULTS['theme-icon-color'])
    ].join('');
    var headerStripGrid = [
      headerInputCard('theme-header-top-bg', 'Strip background', 'Background color for the top strip row.', DEFAULTS['theme-header-top-bg']),
      headerInputCard('theme-header-top-text-color', 'Strip text color', 'Text color used by strip controls unless overridden.', DEFAULTS['theme-header-top-text-color'])
    ].join('');
    var headerSettingsGrid = [
      headerInputCard('theme-header-settings-bg', 'Settings button background', 'Background color for the strip Settings button.', DEFAULTS['theme-header-settings-bg']),
      headerInputCard('theme-header-settings-text-color', 'Settings button text/icon color', 'Text and icon color for the strip Settings button.', DEFAULTS['theme-header-settings-text-color']),
      headerInputCard('theme-header-settings-radius', 'Settings button radius', 'Border radius for the strip Settings button (for example .375rem or 6px).', DEFAULTS['theme-header-settings-radius']),
      headerInputCard('theme-header-settings-border-color', 'Settings button border color', 'Border color for the strip Settings button.', DEFAULTS['theme-header-settings-border-color'])
    ].join('');
    var headerOnlineGrid = [
      headerInputCard('theme-header-online-bg', 'Online badge background', 'Background color for the visitors badge.', DEFAULTS['theme-header-online-bg']),
      headerInputCard('theme-header-online-text-color', 'Online badge text/icon color', 'Text/icon color for the visitors badge.', DEFAULTS['theme-header-online-text-color']),
      headerInputCard('theme-header-online-radius', 'Online badge radius', 'Border radius for the visitors badge (for example .375rem or 6px).', DEFAULTS['theme-header-online-radius']),
      headerInputCard('theme-header-online-border-color', 'Online badge border color', 'Border color for the visitors badge.', DEFAULTS['theme-header-online-border-color'])
    ].join('');
    var topMenuGrid = [
      headerInputCard('theme-header-main-bg', 'Menu background', 'Background color for the desktop top menu row.', DEFAULTS['theme-header-main-bg']),
      headerInputCard('theme-header-main-link-color', 'Menu link color', 'Color for top-level desktop menu links.', DEFAULTS['theme-header-main-link-color']),
      headerInputCard('theme-header-main-border-color', 'Menu border-bottom color', 'Color for the menu bottom border.', DEFAULTS['theme-header-main-border-color']),
      headerInputCard('theme-header-main-shadow', 'Menu box-shadow', 'CSS box-shadow for top menu row (for example 2px 2px 2px #eee or none).', DEFAULTS['theme-header-main-shadow']),
      headerInputCard('theme-header-main-dropdown-bg', 'Dropdown background', 'Background color for top menu dropdown panels.', DEFAULTS['theme-header-main-dropdown-bg']),
      headerInputCard('theme-header-main-dropdown-link-color', 'Dropdown link color', 'Text color for dropdown links.', DEFAULTS['theme-header-main-dropdown-link-color']),
      headerInputCard('theme-header-main-dropdown-icon-color', 'Dropdown icon color', 'Icon color for dropdown item icons.', DEFAULTS['theme-header-main-dropdown-icon-color'])
    ].join('');
    var headerToggleGrid = [
      headerToggleCard('theme-header-main-border', 'Menu border-bottom', 'Show or hide the top menu bottom border.'),
      headerToggleCard('theme-header-settings-label', 'Settings text label', 'Show or hide the "Settings" text next to the icon button.'),
      headerToggleCard('theme-header-settings-border', 'Settings button border', 'Show or hide the border around the Settings button.'),
      headerToggleCard('theme-header-online-border', 'Online badge border', 'Show or hide the border around the visitors badge.')
    ].join('');
    var logoCard = headerInputCard(
      'theme-header-logo-url',
      'Logo URL override',
      'Use an absolute URL or /path to replace desktop and mobile logos.',
      '/assets/kexo/logo_light.webp'
    );
    var preferenceModePanel =
      '<div class="card card-sm mt-3">' +
        '<div class="card-body">' +
          '<h4 class="mb-2">Preference mode</h4>' +
          '<div class="form-selectgroup">' +
            radioCard('theme-preference-mode', 'global', 'Global (shared)') +
            radioCard('theme-preference-mode', 'user', 'User-selected') +
          '</div>' +
          '<div class="text-secondary small mt-2">' +
            'Global mode applies one shared theme to everyone and auto-saves changes for all users. ' +
            'User-selected mode lets each browser keep its own local theme; use Save as default to set the starting preset.' +
          '</div>' +
        '</div>' +
      '</div>';
    return '<form id="theme-settings-form">' +
      '<ul class="nav nav-underline mb-3" id="theme-subtabs" role="tablist">' +
        '<li class="nav-item" role="presentation"><button class="nav-link active" type="button" role="tab" data-theme-subtab="icons" aria-selected="true">Icons</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="header" aria-selected="false">Header</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="color" aria-selected="false">Color</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="fonts" aria-selected="false">Fonts</button></li>' +
      '</ul>' +

      '<div class="theme-subpanel" data-theme-subpanel="icons">' +
        '<div class="text-secondary mb-3">Control icon style classes and specific icon glyphs with live preview. Enter a single glyph (for example <code>fa-gear</code>) or a full class override (for example <code>fa-etch fa-solid fa-address-card</code>). Desktop shows a 3-column grid; mobile stacks to one per line.</div>' +
        '<h4 class="mb-2">Style rules</h4>' +
        '<div class="row g-3">' + styleGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Global icon visuals</h4>' +
        '<div class="row g-3">' + visualGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Icon glyph overrides</h4>' +
        '<div class="row g-3">' + glyphGrid + '</div>' +
        '<div class="d-flex align-items-center gap-2 mt-3">' +
          '<button type="button" class="btn btn-outline-secondary btn-sm" id="theme-icons-refresh">Refresh previews</button>' +
          '<span class="text-secondary small">Debounced preview updates after typing stops.</span>' +
        '</div>' +
      '</div>' +

      '<div class="theme-subpanel" data-theme-subpanel="header" hidden>' +
        '<div class="text-secondary mb-3">Configure strip controls and top menu appearance. All controls apply live.</div>' +
        '<h4 class="mb-2">Strip</h4>' +
        '<div class="row g-3">' + headerStripGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Strip Settings button</h4>' +
        '<div class="row g-3">' + headerSettingsGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Strip Online badge</h4>' +
        '<div class="row g-3">' + headerOnlineGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Top menu</h4>' +
        '<div class="row g-3">' + topMenuGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Visibility & borders</h4>' +
        '<div class="row g-3">' + headerToggleGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Logo</h4>' +
        '<div class="row g-3">' + logoCard + '</div>' +
        '<div class="alert alert-secondary mt-3 mb-0 py-2">Upload logo file: TODO. Use URL override for now.</div>' +
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
      preferenceModePanel +
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
    var globalSaveTimer = null;

    function debouncedApply(name, value) {
      if (debounceTimers[name]) clearTimeout(debounceTimers[name]);
      debounceTimers[name] = setTimeout(function () {
        applyTheme(name, value);
      }, 350);
    }

    function queueGlobalSave() {
      if (getPreferenceMode() !== 'global') return;
      if (globalSaveTimer) clearTimeout(globalSaveTimer);
      globalSaveTimer = setTimeout(function () {
        saveToServer();
      }, 700);
    }

    formEl.addEventListener('change', function (e) {
      var name = e && e.target ? e.target.name : '';
      var val = e && e.target && e.target.value != null ? String(e.target.value).trim() : '';
      if (!name) return;
      if (ICON_STYLE_KEYS.indexOf(name) >= 0) val = normalizeIconStyle(val, DEFAULTS[name]);
      if (ICON_GLYPH_KEYS.indexOf(name) >= 0) val = normalizeIconGlyph(val, DEFAULTS[name]);
      if (name === 'theme-icon-size') val = normalizeIconSize(val, DEFAULTS[name]);
      if (name === 'theme-icon-color') val = normalizeIconColor(val, DEFAULTS[name]);
      if (HEADER_THEME_TEXT_KEYS.indexOf(name) >= 0) {
        if (name === 'theme-header-logo-url') val = normalizeLogoUrl(val);
        else if (name === 'theme-header-settings-radius' || name === 'theme-header-online-radius') val = normalizeHeaderRadius(val, DEFAULTS[name]);
        else if (name === 'theme-header-main-shadow') val = normalizeHeaderShadow(val, DEFAULTS[name]);
        else val = normalizeHeaderColor(val, DEFAULTS[name]);
      }
      if (HEADER_THEME_TOGGLE_KEYS.indexOf(name) >= 0) val = normalizeHeaderToggle(val, DEFAULTS[name]);
      if (name === 'theme-preference-mode') val = normalizePreferenceMode(val, DEFAULTS[name]);
      setStored(name, val);
      applyTheme(name, val);
      refreshIconPreviews(formEl);
      queueGlobalSave();
    });

    ICON_STYLE_KEYS.concat(ICON_GLYPH_KEYS).concat(ICON_VISUAL_KEYS).concat(HEADER_THEME_TEXT_KEYS).forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      if (!input) return;
      input.addEventListener('input', function () {
        var val = String(input.value || '').trim();
        if (ICON_STYLE_KEYS.indexOf(key) >= 0) val = normalizeIconStyle(val, DEFAULTS[key]);
        if (ICON_GLYPH_KEYS.indexOf(key) >= 0) val = normalizeIconGlyph(val, DEFAULTS[key]);
        if (key === 'theme-icon-size') val = normalizeIconSize(val, DEFAULTS[key]);
        if (key === 'theme-icon-color') val = normalizeIconColor(val, DEFAULTS[key]);
        if (HEADER_THEME_TEXT_KEYS.indexOf(key) >= 0) {
          if (key === 'theme-header-logo-url') val = normalizeLogoUrl(val);
          else if (key === 'theme-header-settings-radius' || key === 'theme-header-online-radius') val = normalizeHeaderRadius(val, DEFAULTS[key]);
          else if (key === 'theme-header-main-shadow') val = normalizeHeaderShadow(val, DEFAULTS[key]);
          else val = normalizeHeaderColor(val, DEFAULTS[key]);
        }
        setStored(key, val);
        refreshIconPreviews(formEl);
        debouncedApply(key, val);
        queueGlobalSave();
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
      queueGlobalSave();
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
