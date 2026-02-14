(function () {
  'use strict';

  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('theme', { page: 'theme' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('theme', 'init', {}); } catch (_) {}

  var ICON_STYLE_CLASSES = ['fa-jelly', 'fa-jelly-filled', 'fa-light', 'fa-solid', 'fa-brands'];
  var ICON_STYLE_DEFAULTS = {};
  var ICON_STYLE_META = {};
  var LOCKED_SETTINGS_ICON_KEYS = {
    'settings-tab-general': true,
    'settings-tab-theme': true,
    'settings-tab-assets': true,
    'settings-tab-data-reporting': true,
    'settings-tab-integrations': true,
    'settings-tab-sources': true,
    'settings-tab-kpis': true,
    'settings-tab-insights': true,
    'settings-tab-charts': true,
    'settings-tab-layout': true,
    'settings-tab-diagnostics': true,
    'settings-diagnostics-refresh': true,
    'settings-diagnostics-reconcile': true,
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
    'header-business-snapshot': 'fa-sterling-sign',
    'nav-dropdown-arrow': 'fa-solid fa-arrow-turn-down-right',
    'nav-item-overview': 'fa-house',
    'nav-item-live': 'fa-satellite-dish',
    'nav-item-sales': 'fa-cart-shopping',
    'nav-item-table': 'fa-table',
    'nav-item-countries': 'fa-globe',
    'nav-item-products': 'fa-box-open',
    'nav-item-variants': 'fa-bezier-curve',
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
    'table-icon-converted-sale': 'fa-solid fa-sterling-sign',
    'table-icon-clicks': 'fa-hand-pointer',
    'table-icon-variants-variant': 'fa-shapes',
    'table-icon-variants-sessions': 'fa-users',
    'table-icon-variants-orders': 'fa-box-open',
    'table-icon-variants-cr': 'fa-percent',
    'table-icon-variants-revenue': 'fa-sterling-sign',
    'settings-tab-general': 'fa-sliders',
    'settings-tab-theme': 'fa-palette',
    'settings-tab-assets': 'fa-image',
    'settings-tab-data-reporting': 'fa-chart-column',
    'settings-tab-integrations': 'fa-plug',
    'settings-tab-sources': 'fa-map-location-dot',
    'settings-tab-kpis': 'fa-gauge-high',
    'settings-tab-insights': 'fa-chart-pie',
    'settings-tab-charts': 'fa-chart-pie',
    'settings-tab-layout': 'fa-table-columns',
    'settings-tab-diagnostics': 'fa-chart-line',
    'settings-diagnostics-refresh': 'fa-rotate-right',
    'settings-diagnostics-reconcile': 'fa-sliders',
    'footer-refresh': 'fa-rotate-right',
    'footer-sound': 'fa-volume-high',
    'footer-sound-muted': 'fa-volume-xmark',
    'footer-theme': 'fa-palette',
    'footer-settings': 'fa-gear',
    'footer-settings-toggle': 'fa-gear',
    'footer-signout': 'fa-right-from-bracket',
    'footer-last-sale-show': 'fa-eye',
    'footer-last-sale-hide': 'fa-eye-slash',
    'footer-back-to-top': 'fa-arrow-up',
    'side-panel-close': 'fa-xmark',
    'side-panel-activity': 'fa-list',
    'side-panel-details': 'fa-user',
    'side-panel-source': 'fa-link',
    'side-panel-network': 'fa-cloud',
    'kpi-compare-refresh': 'fa-rotate-right',
    'kpi-compare-close': 'fa-xmark',
    'kpi-compare-date-info': 'fa-circle-info',
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
    'table-builder-icon': 'fa-light fa-gear',
    'chart-builder-icon': 'fa-light fa-gear',
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
    'card-title-table-dash-top-products': 'fa-jelly-filled fa-chart-line',
    'card-title-table-dash-top-countries': 'fa-jelly-filled fa-globe',
    'card-title-table-dash-trending-up': 'fa-jelly-filled fa-arrow-trend-up',
    'card-title-table-dash-trending-down': 'fa-jelly-filled fa-arrow-trend-down',
    'card-title-table-latest-sales': 'fa-jelly-filled fa-cart-shopping',
    'card-title-table-sessions': 'fa-jelly-filled fa-users',
    'card-title-table-country': 'fa-jelly-filled fa-map-location-dot',
    'card-title-table-country-product': 'fa-jelly-filled fa-globe-americas',
    'card-title-table-best-sellers': 'fa-jelly-filled fa-trophy',
    'card-title-table-best-variants': 'fa-jelly-filled fa-shapes',
    'card-title-table-necklaces': 'fa-jelly-filled fa-gem',
    'card-title-table-bracelets': 'fa-jelly-filled fa-circle',
    'card-title-table-earrings': 'fa-jelly-filled fa-heart',
    'card-title-table-sets': 'fa-jelly-filled fa-layer-group',
    'card-title-table-charms': 'fa-jelly-filled fa-star',
    'card-title-table-extras': 'fa-jelly-filled fa-puzzle-piece',
    'card-title-table-channels': 'fa-jelly-filled fa-diagram-project',
    'card-title-table-device': 'fa-jelly-filled fa-table-cells',
    'card-title-table-ads': 'fa-brands fa-google',
    'card-title-table-variants': 'fa-jelly-filled fa-bezier-curve',
    'dash-kpi-delta-up': 'fa-arrow-trend-up',
    'dash-kpi-delta-down': 'fa-arrow-trend-down',
    'dash-kpi-delta-flat': 'fa-minus',
    'online-status-indicator': 'fa-circle',
    'card-collapse-expanded': 'fa-chevron-down',
    'card-collapse-collapsed': 'fa-chevron-right',
  };
  var ICON_GLYPH_META = {
    'live-landing-entry': { title: 'Live Table Entry Icon', help: 'Landing direction entry icon. Shows in the Live table on /dashboard/live.' },
    'live-landing-exit': { title: 'Live Table Exit Icon', help: 'Landing direction exit icon. Shows in the Live table on /dashboard/live.' },
    'table-icon-variants-variant': { title: 'Variants Table Variant Icon', help: 'Short header icon for the Variant column in Insights → Variants.' },
    'table-icon-variants-sessions': { title: 'Variants Table Sessions Icon', help: 'Short header icon for the Sessions column in Insights → Variants.' },
    'table-icon-variants-orders': { title: 'Variants Table Orders Icon', help: 'Short header icon for the Orders column in Insights → Variants.' },
    'table-icon-variants-cr': { title: 'Variants Table CR Icon', help: 'Short header icon for the CR% column in Insights → Variants.' },
    'table-icon-variants-revenue': { title: 'Variants Table Revenue Icon', help: 'Short header icon for the Rev column in Insights → Variants.' },
    'table-icon-converted-sale': { title: 'Converted Row Sale Icon', help: 'Icon shown at the start of converted sale rows in sessions/live tables.' },
    'table-builder-icon': { title: 'Table Layout Icon', help: 'Icon shown at the top of table cards that links to Settings → Layout. Use full Font Awesome classes (e.g. fa-light fa-gear).' },
    'chart-builder-icon': { title: 'Chart Layout Icon', help: 'Icon shown at the top of chart cards that links to Settings → Layout. Use full Font Awesome classes (e.g. fa-light fa-gear).' },
    'dash-kpi-delta-up': { title: 'Overview KPI Delta Up', help: 'Up-trend icon in KPI cards on /dashboard/overview when metric delta is positive.' },
    'dash-kpi-delta-down': { title: 'Overview KPI Delta Down', help: 'Down-trend icon in KPI cards on /dashboard/overview when metric delta is negative.' },
    'dash-kpi-delta-flat': { title: 'Overview KPI Delta Flat', help: 'Flat-trend icon in KPI cards on /dashboard/overview when metric delta is neutral.' },
    'nav-dropdown-arrow': { title: 'Nav Dropdown Arrow', help: 'Arrow icon shown next to each item in the top-nav dropdown menus (Dashboard, Insights, Traffic, etc.).' },
  };

  function isLockedSettingsIconKey(name) {
    return !!LOCKED_SETTINGS_ICON_KEYS[String(name || '').trim()];
  }

  function defaultIconStyleForKey(name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return 'fa-light';
    if (isLockedSettingsIconKey(key)) return 'fa-thin';
    if (key === 'nav-item-refresh' || key === 'nav-item-sound-on' || key === 'nav-item-sound-off' || key === 'nav-item-settings') return 'fa-thin';
    if (key.indexOf('nav-toggle-') === 0 || key === 'topnav-date-chevron') return 'fa-jelly-filled';
    if (key.indexOf('header-') === 0) return 'fa-jelly-filled';
    if (key === 'nav-dropdown-arrow') return 'fa-solid';
    if (key.indexOf('nav-item-') === 0) return 'fa-jelly';
    if (key.indexOf('table-icon-') === 0) return 'fa-jelly-filled';
    if (key.indexOf('table-short-') === 0) return 'fa-solid';
    if (key.indexOf('card-title-') === 0) return 'fa-jelly-filled';
    if (key.indexOf('footer-') === 0) return 'fa-jelly-filled';
    if (key === 'mobile-menu' || key === 'mobile-date' || key === 'online-status-indicator') return 'fa-jelly';
    if (key.indexOf('kpi-compare-') === 0) return 'fa-light';
    if (key.indexOf('live-') === 0 || key.indexOf('breakdown-') === 0) return 'fa-light';
    if (key.indexOf('type-device-') === 0 || key.indexOf('type-platform-') === 0) return 'fa-light';
    if (key.indexOf('diag-') === 0 || key.indexOf('ads-') === 0) return 'fa-light';
    if (key.indexOf('pagination-') === 0 || key.indexOf('card-collapse-') === 0) return 'fa-light';
    if (key.indexOf('dash-kpi-delta-') === 0) return 'fa-jelly';
    if (key.indexOf('chart-type-') === 0) return 'fa-light';
    return 'fa-light';
  }

  function withDefaultIconStyle(name, spec) {
    var fallbackStyle = defaultIconStyleForKey(name);
    var raw = sanitizeIconClassString(spec).toLowerCase();
    if (!raw) return fallbackStyle + ' fa-circle';
    var tokens = raw.split(/\s+/).filter(Boolean);
    var style = '';
    var glyph = '';
    tokens.forEach(function (t) {
      if (t === 'fa') return;
      if ((t === 'fas' || t === 'far' || t === 'fal' || t === 'fab' || t === 'fat' || t === 'fad') && !style) {
        if (t === 'fas') style = 'fa-solid';
        else if (t === 'far') style = 'fa-regular';
        else if (t === 'fal') style = 'fa-light';
        else if (t === 'fab') style = 'fa-brands';
        else if (t === 'fat') style = 'fa-thin';
        else if (t === 'fad') style = 'fa-duotone';
        return;
      }
      if (isIconStyleToken(t) && !style) {
        style = t;
        return;
      }
      if (t.indexOf('fa-') === 0 && !isIconStyleToken(t) && !glyph) glyph = t;
    });
    if (!style) style = fallbackStyle;
    if (!glyph) glyph = 'fa-circle';
    return style + ' ' + glyph;
  }

  Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (k) {
    ICON_GLYPH_DEFAULTS[k] = withDefaultIconStyle(k, ICON_GLYPH_DEFAULTS[k]);
  });

  var ACCENT_DEFAULTS = ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'];
  var DEFAULTS = {
    theme: 'light',
    'theme-accent-1': ACCENT_DEFAULTS[0],
    'theme-accent-2': ACCENT_DEFAULTS[1],
    'theme-accent-3': ACCENT_DEFAULTS[2],
    'theme-accent-4': ACCENT_DEFAULTS[3],
    'theme-accent-5': ACCENT_DEFAULTS[4],
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
    'theme-header-settings-menu-bg': '#ffffff',
    'theme-header-settings-menu-link-color': '#1f2937',
    'theme-header-settings-menu-icon-color': '#1f2937',
    'theme-header-settings-menu-border-color': '#e6e7e9',
    'theme-header-settings-menu-radius': '.375rem',
    'theme-header-online-bg': '#f8fafc',
    'theme-header-online-text-color': '#1f2937',
    'theme-header-online-radius': '.375rem',
    'theme-header-online-border': 'show',
    'theme-header-online-border-color': '#e6e7e9',
    'theme-header-logo-url': '',
    'theme-strip-opacity-filter': '0',
    'theme-menu-opacity-filter': '0',
    'theme-menu-hover-opacity': '8',
    'theme-menu-hover-color': 'black',
    'theme-header-strip-border': 'show',
    'theme-header-strip-padding': '0 5px',
    'theme-custom-css': [
      '.kexo-product-link {',
      '    color: #144c88 !important;',
      '    font-size: 13px;',
      '    text-decoration: underline;',
      '    text-underline-offset: 1px;',
      '}',
      '',
    ].join('\n'),
  };
  Object.keys(ICON_STYLE_DEFAULTS).forEach(function (k) { DEFAULTS[k] = ICON_STYLE_DEFAULTS[k]; });
  Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (k) { DEFAULTS['theme-icon-glyph-' + k] = ICON_GLYPH_DEFAULTS[k]; });

  var ICON_STYLE_KEYS = Object.keys(ICON_STYLE_DEFAULTS);
  var ICON_GLYPH_ALL_KEYS = Object.keys(ICON_GLYPH_DEFAULTS).map(function (k) { return 'theme-icon-glyph-' + k; });
  var LOCKED_GLYPH_THEME_KEYS = Object.keys(LOCKED_SETTINGS_ICON_KEYS).map(function (k) { return 'theme-icon-glyph-' + k; });
  var ICON_GLYPH_KEYS = ICON_GLYPH_ALL_KEYS.filter(function (k) {
    return LOCKED_GLYPH_THEME_KEYS.indexOf(k) < 0;
  });
  var KEYS = Object.keys(DEFAULTS).filter(function (k) {
    if (k === 'theme') return false;
    if (ICON_STYLE_KEYS.indexOf(k) >= 0) return false;
    if (LOCKED_GLYPH_THEME_KEYS.indexOf(k) >= 0) return false;
    return true;
  });
  var ICON_VISUAL_KEYS = ['theme-icon-size', 'theme-icon-color'];
  var ACCENT_HEX_KEYS = ['theme-accent-1', 'theme-accent-2', 'theme-accent-3', 'theme-accent-4', 'theme-accent-5'];
  var HEADER_THEME_TEXT_KEYS = [
    'theme-header-top-text-color',
    'theme-header-main-link-color',
    'theme-header-main-border-color',
    'theme-header-main-shadow',
    'theme-header-settings-text-color',
    'theme-header-settings-radius',
    'theme-header-settings-border-color',
    'theme-header-online-text-color',
    'theme-header-online-radius',
    'theme-header-online-border-color',
    'theme-header-logo-url',
    'theme-header-strip-padding',
  ];
  var HEADER_THEME_TOGGLE_KEYS = [
    'theme-header-main-border',
    'theme-header-settings-label',
    'theme-header-settings-border',
    'theme-header-online-border',
    'theme-header-strip-border',
  ];
  var ACCENT_OPACITY_KEYS = ['theme-strip-opacity-filter', 'theme-menu-opacity-filter', 'theme-menu-hover-opacity'];
  var HEADER_THEME_RADIO_KEYS = ['theme-menu-hover-color'];
  var CUSTOM_CSS_KEYS = ['theme-custom-css'];

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var h = m[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    if (!Number.isFinite(r + g + b)) return null;
    return r + ',' + g + ',' + b;
  }

  function normalizeAccentHex(value, fallback) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return fallback || ACCENT_DEFAULTS[0];
    if (raw.charAt(0) !== '#') raw = '#' + raw;
    if (!/^#([0-9a-f]{6})$/i.test(raw)) {
      var short = raw.match(/^#([0-9a-f]{3})$/i);
      if (short) {
        var s = short[1];
        raw = '#' + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
      } else return fallback || ACCENT_DEFAULTS[0];
    }
    return raw;
  }

  function normalizeOpacityFilter(value, fallback) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return fallback || '0';
    var n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) return fallback || '0';
    if (n > 100) return '100';
    return String(Math.round(n));
  }

  function normalizeStripPadding(value, fallback) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return fallback || '0 5px';
    if (raw.length > 80) return fallback || '0 5px';
    if (/[;{}]/.test(raw)) return fallback || '0 5px';
    return raw;
  }

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
    var fallbackRaw = sanitizeIconClassString(fallback).toLowerCase();
    var fallbackStyle = 'fa-light';
    var fallbackGlyph = 'fa-circle';
    if (fallbackRaw) {
      fallbackRaw.split(/\s+/).filter(Boolean).forEach(function (t) {
        if (t === 'fa') return;
        if (t === 'fas') t = 'fa-solid';
        else if (t === 'far') t = 'fa-regular';
        else if (t === 'fal') t = 'fa-light';
        else if (t === 'fab') t = 'fa-brands';
        else if (t === 'fat') t = 'fa-thin';
        else if (t === 'fad') t = 'fa-duotone';
        if (isIconStyleToken(t) && !fallbackStyle) {
          fallbackStyle = t;
          return;
        }
        if (isIconStyleToken(t)) {
          fallbackStyle = t;
          return;
        }
        if (t.indexOf('fa-') === 0 && !isIconStyleToken(t)) fallbackGlyph = t;
      });
    }
    var safeFallback = (fallbackStyle || 'fa-light') + ' ' + (fallbackGlyph || 'fa-circle');
    if (!raw) return { mode: 'full', value: safeFallback, full: safeFallback };
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
      var hasStyle = full.some(isIconStyleToken);
      if (!hasStyle) full.unshift(fallbackStyle || 'fa-light');
      if (!hasGlyph) full.push(fallbackGlyph || 'fa-circle');
      return { mode: 'full', value: sanitizeIconClassString(full.join(' ')), full: sanitizeIconClassString(full.join(' ')) };
    }
    var m = raw.match(/fa-[a-z0-9-]+/);
    var glyph = null;
    if (m && m[0] && !isIconStyleToken(m[0])) glyph = m[0];
    else if (/^[a-z0-9-]+$/.test(raw)) glyph = 'fa-' + raw;
    if (!glyph) glyph = fallbackGlyph || 'fa-circle';
    var fullValue = (fallbackStyle || 'fa-light') + ' ' + glyph;
    return { mode: 'full', value: fullValue, full: fullValue };
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
    // Settings scope is currently GLOBAL (shared) only.
    // User-selected settings are intentionally disabled until a later project phase.
    return 'global';
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

  function defaultIconHelpFor(name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return 'Icon shown in the app UI.';
    if (key === 'mobile-menu') return 'Mobile menu button. Shows in the header on all pages on mobile.';
    if (key === 'mobile-date') return 'Mobile date button. Shows in the header on all pages on mobile.';
    if (key === 'topnav-date-chevron') return 'Desktop date selector chevron. Shows in the header date control on all pages.';
    if (key.indexOf('nav-toggle-') === 0) return 'Desktop top-nav section icon. Shows in the main header menu on all pages.';
    if (key.indexOf('nav-item-') === 0) return 'Desktop dropdown menu icon. Shows inside top-nav dropdown menus on all pages.';
    if (key.indexOf('table-icon-') === 0) return 'Compact table metric icon. Shows in sortable table headers on /traffic/channels and /traffic/device.';
    if (key.indexOf('table-short-') === 0) return 'Compact table column icon. Shows in sortable table headers on /dashboard/live, /dashboard/sales, /dashboard/table, /insights/countries, /insights/products, /traffic/channels, and /traffic/device.';
    if (key.indexOf('footer-') === 0) return 'Footer quick-action icon. Shows in the bottom action bar on all pages.';
    if (key.indexOf('side-panel-') === 0) return 'Session details side panel icon. Shows on /dashboard/live, /dashboard/sales, and /dashboard/table.';
    if (key.indexOf('kpi-compare-') === 0) return 'KPI compare modal icon. Shows on /dashboard/overview, /dashboard/live, /dashboard/sales, /dashboard/table, /insights/countries, /insights/products, /traffic/channels, /traffic/device, /integrations/google-ads, and /tools/ads.';
    if (key === 'live-landing-entry') return 'Live table entry icon. Shows in the Landing direction column on /dashboard/live.';
    if (key === 'live-landing-exit') return 'Live table exit icon. Shows in the Landing direction column on /dashboard/live.';
    if (key === 'live-bought-overlay') return 'Live table bought overlay icon. Shows in bought-state overlays on /dashboard/live.';
    if (key.indexOf('breakdown-') === 0) return 'Breakdown item icon. Shows in breakdown cards/tables on insights pages.';
    if (key.indexOf('type-device-') === 0) return 'Device type icon. Shows in the Device table on /traffic/device.';
    if (key.indexOf('type-platform-') === 0) return 'Platform icon. Shows in the Device table on /traffic/device.';
    if (key === 'diag-copy') return 'Diagnostics copy icon. Shows in the diagnostics panel on /settings.';
    if (key.indexOf('ads-status-') === 0 || key === 'ads-actions-refresh') return 'Ads integration status/action icon. Shows on /integrations/google-ads and /tools/ads.';
    if (key.indexOf('pagination-') === 0) return 'Pagination arrow icon. Shows in paginated cards/tables across dashboard and insights pages.';
    if (key.indexOf('card-title-') === 0) return 'Auto card-title icon. Added to matching card headers across dashboard, insights, traffic, integrations, tools, and settings pages.';
    if (key === 'online-status-indicator') return 'Online visitors badge icon. Shows in the top strip header on all pages.';
    if (key.indexOf('card-collapse-') === 0) return 'Card collapse chevron icon. Shows on collapsible cards in dashboard and insights pages.';
    if (key.indexOf('dash-kpi-delta-') === 0) return 'Overview KPI delta icon. Shows in KPI cards on /dashboard/overview.';
    if (key.indexOf('settings-tab-') === 0 || key.indexOf('settings-diagnostics-') === 0) return 'Settings page icon. Locked to a fixed fa-thin class and not editable.';
    if (key.indexOf('chart-type-') === 0) return 'Chart type switch icon used when chart type controls are enabled.';
    return 'Icon shown in the app UI for key "' + key + '".';
  }

  function glyphMetaFor(name) {
    var custom = ICON_GLYPH_META[name];
    if (custom) return custom;
    return {
      title: titleizeIconKey(name),
      help: defaultIconHelpFor(name),
    };
  }

  function triggerIconThemeRefresh() {
    try {
      window.dispatchEvent(new CustomEvent('kexo:icon-theme-changed'));
      if (window.KexoIconTheme && typeof window.KexoIconTheme.refresh === 'function') window.KexoIconTheme.refresh();
    } catch (_) {}
  }

  function applyThemeCustomCss(rawCss) {
    var css = rawCss == null ? '' : String(rawCss);
    try {
      var styleEl = document.getElementById('kexo-theme-custom-css');
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'kexo-theme-custom-css';
        styleEl.type = 'text/css';
        document.head.appendChild(styleEl);
      }
      if (styleEl.textContent !== css) styleEl.textContent = css;
      // Keep this style tag last in <head> (after other CSS includes).
      try {
        if (document.head && document.head.lastElementChild !== styleEl) {
          document.head.appendChild(styleEl);
        }
      } catch (_) {}
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
    } else if (ACCENT_HEX_KEYS.indexOf(key) >= 0) {
      var idx = ACCENT_HEX_KEYS.indexOf(key);
      var hex = normalizeAccentHex(value, ACCENT_DEFAULTS[idx]);
      var rgb = hexToRgb(hex);
      root.style.setProperty('--kexo-accent-' + (idx + 1), hex);
      if (rgb) root.style.setProperty('--kexo-accent-' + (idx + 1) + '-rgb', rgb);
      if (idx === 0) {
        root.style.setProperty('--tblr-primary', hex);
        if (rgb) root.style.setProperty('--tblr-primary-rgb', rgb);
        var derived = hex;
        root.style.setProperty('--kexo-header-top-bg', derived);
        root.style.setProperty('--kexo-header-settings-bg', derived);
        root.style.setProperty('--kexo-header-settings-border-color', derived);
        root.style.setProperty('--kexo-header-online-bg', derived);
        root.style.setProperty('--kexo-header-main-bg', derived);
        root.style.setProperty('--kexo-top-menu-bg', derived);
        root.style.setProperty('--kexo-top-menu-border-color', derived);
        root.style.setProperty('--kexo-top-menu-dropdown-bg', derived);
      }
    } else if (key === 'theme-strip-opacity-filter') {
      var pct = normalizeOpacityFilter(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-strip-opacity-filter', (parseFloat(pct) / 100).toFixed(2));
    } else if (key === 'theme-menu-opacity-filter') {
      var pct = normalizeOpacityFilter(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-menu-opacity-filter', (parseFloat(pct) / 100).toFixed(2));
    } else if (key === 'theme-header-strip-border') {
      var stripBorderMode = normalizeHeaderToggle(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-strip-border-width', stripBorderMode === 'hide' ? '0px' : '1px');
    } else if (key === 'theme-header-strip-padding') {
      root.style.setProperty('--kexo-header-strip-padding', normalizeStripPadding(value, DEFAULTS[key]));
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
    } else if (key === 'theme-header-top-text-color') {
      root.style.setProperty('--kexo-header-top-text-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-link-color') {
      // Legacy shared header text key kept for backwards compatibility.
      var legacyHeader = normalizeHeaderColor(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-top-text-color', legacyHeader);
      root.style.setProperty('--kexo-top-menu-link-color', legacyHeader);
    } else if (key === 'theme-header-main-link-color') {
      root.style.setProperty('--kexo-top-menu-link-color', normalizeHeaderColor(value, DEFAULTS[key]));
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
    } else if (key === 'theme-header-settings-text-color') {
      root.style.setProperty('--kexo-header-settings-text-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-header-settings-radius') {
      root.style.setProperty('--kexo-header-settings-radius', normalizeHeaderRadius(value, DEFAULTS[key]));
    } else if (key === 'theme-header-settings-border') {
      var settingsBorderMode = normalizeHeaderToggle(value, DEFAULTS[key]);
      root.style.setProperty('--kexo-header-settings-border-width', settingsBorderMode === 'hide' ? '0px' : '1px');
    } else if (key === 'theme-header-settings-border-color') {
      root.style.setProperty('--kexo-header-settings-border-color', normalizeHeaderColor(value, DEFAULTS[key]));
    } else if (key === 'theme-menu-hover-opacity' || key === 'theme-menu-hover-color') {
      var hovOpVal = key === 'theme-menu-hover-opacity' ? value : (getStored('theme-menu-hover-opacity') || DEFAULTS['theme-menu-hover-opacity']);
      var hovColVal = key === 'theme-menu-hover-color' ? value : (getStored('theme-menu-hover-color') || DEFAULTS['theme-menu-hover-color']);
      var hovOp = normalizeOpacityFilter(hovOpVal, DEFAULTS['theme-menu-hover-opacity']);
      var hovCol = (hovColVal || '').trim().toLowerCase() === 'white' ? 'white' : 'black';
      var pct = Math.min(100, Math.max(0, parseFloat(hovOp) || 0)) / 100;
      var r = hovCol === 'white' ? 255 : 0, g = hovCol === 'white' ? 255 : 0, b = hovCol === 'white' ? 255 : 0;
      root.style.setProperty('--kexo-menu-hover-bg', 'rgba(' + r + ',' + g + ',' + b + ',' + pct.toFixed(2) + ')');
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
    } else if (key === 'theme-custom-css') {
      applyThemeCustomCss(value);
    } else if (ICON_GLYPH_ALL_KEYS.indexOf(key) >= 0) {
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

  function clearLockedIconOverrides() {
    LOCKED_GLYPH_THEME_KEYS.forEach(function (themeKey) {
      removeStored(themeKey);
    });
  }

  // Fetch server defaults and apply globally (shared).
  function fetchDefaults() {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        var mode = 'global';
        setStored('theme-preference-mode', mode);
        applyTheme('theme-preference-mode', mode);
        var legacyPrimary = data.theme_primary || getStored('theme-primary');
        if (legacyPrimary && ACCENT_HEX_KEYS.indexOf('theme-accent-1') >= 0) {
          var legacyMap = { blue: '#4b94e4', teal: '#3eb3ab', orange: '#f59e34', green: '#3eb3ab' };
          var migrated = legacyMap[String(legacyPrimary).trim().toLowerCase()] || ACCENT_DEFAULTS[0];
          setStored('theme-accent-1', migrated);
          applyTheme('theme-accent-1', migrated);
        }
        KEYS.forEach(function (key) {
          if (key === 'theme-preference-mode') return;
          var dbKey = key.replace(/-/g, '_');
          var rawDbVal = data[dbKey];
          var rawKeyVal = data[key];
          var hasDbVal = rawDbVal != null && String(rawDbVal).trim() !== '';
          var hasKeyVal = rawKeyVal != null && String(rawKeyVal).trim() !== '';
          var serverVal = hasDbVal
            ? String(rawDbVal).trim()
            : (hasKeyVal ? String(rawKeyVal).trim() : DEFAULTS[key]);
          if (ACCENT_HEX_KEYS.indexOf(key) >= 0) serverVal = normalizeAccentHex(serverVal, ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)]);
          if (ACCENT_OPACITY_KEYS.indexOf(key) >= 0) serverVal = normalizeOpacityFilter(serverVal, DEFAULTS[key]);
          if (key === 'theme-header-strip-padding') serverVal = normalizeStripPadding(serverVal, DEFAULTS[key]);
          setStored(key, serverVal);
          applyTheme(key, serverVal || DEFAULTS[key]);
        });
        syncUI();
      })
      .catch(function () {});
  }

  function buildFullThemePayload() {
    var payload = {};
    KEYS.forEach(function (key) {
      var dbKey = key.replace(/-/g, '_');
      payload[dbKey] = getStored(key) || DEFAULTS[key];
    });
    return payload;
  }

  function saveToServer(payloadOverride, opts) {
    var payload = payloadOverride && typeof payloadOverride === 'object'
      ? payloadOverride
      : buildFullThemePayload();
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    var fetchOpts = {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    };
    if (opts && opts.keepalive) fetchOpts.keepalive = true;
    return fetch(base + '/api/theme-defaults', fetchOpts).then(function (r) {
      return r.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        if (!r.ok || (json && json.ok === false)) {
          var msg = (json && json.error) ? String(json.error) : ('Theme save failed (' + r.status + ')');
          throw new Error(msg);
        }
        return json || { ok: true };
      });
    });
  }

  function syncUI() {
    var form = document.getElementById('theme-settings-form');
    if (!form) return;
    KEYS.forEach(function (key) {
      var val = getStored(key) || DEFAULTS[key];
      if (ACCENT_HEX_KEYS.indexOf(key) >= 0) {
        val = normalizeAccentHex(val, ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)]);
        setStored(key, val);
      }
      if (ACCENT_OPACITY_KEYS.indexOf(key) >= 0) val = normalizeOpacityFilter(val, DEFAULTS[key]);
      if (key === 'theme-header-strip-padding') val = normalizeStripPadding(val, DEFAULTS[key]);
      if (key === 'theme-custom-css') {
        var cssInput = form.querySelector('[name="' + key + '"]');
        if (cssInput) cssInput.value = String(val == null ? '' : val);
        return;
      }
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
      if (ACCENT_HEX_KEYS.indexOf(key) >= 0) {
        var hex = normalizeAccentHex(val, ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)]);
        var accentInput = form.querySelector('.theme-accent-hex[name="' + key + '"]');
        var swatch = form.querySelector('.theme-accent-swatch[data-accent-sync="' + key + '"]');
        if (accentInput) accentInput.value = hex;
        if (swatch) swatch.value = hex;
        return;
      }
      if (ACCENT_OPACITY_KEYS.indexOf(key) >= 0) {
        var opacityInput = form.querySelector('[name="' + key + '"]');
        if (opacityInput) opacityInput.value = normalizeOpacityFilter(val, DEFAULTS[key]);
        return;
      }
      if (HEADER_THEME_TEXT_KEYS.indexOf(key) >= 0) {
        var headerTextInput = form.querySelector('[name="' + key + '"]');
        if (!headerTextInput) return;
        if (key === 'theme-header-logo-url') headerTextInput.value = normalizeLogoUrl(val);
        else if (key === 'theme-header-strip-padding') headerTextInput.value = normalizeStripPadding(val, DEFAULTS[key]);
        else if (/theme-header-.*-radius$/.test(key)) headerTextInput.value = normalizeHeaderRadius(val, DEFAULTS[key]);
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
      if (HEADER_THEME_RADIO_KEYS.indexOf(key) >= 0) {
        var radioVal = (val || '').trim().toLowerCase() === 'white' ? 'white' : 'black';
        var radioEls = form.querySelectorAll('[name="' + key + '"]');
        radioEls.forEach(function (r) { r.checked = (r.value === radioVal); });
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
            '<i class="' + ICON_GLYPH_DEFAULTS[name] + ' me-2" data-theme-icon-preview-glyph="' + key + '" aria-hidden="true"></i>' +
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

  function headerInputCardNoIcon(key, title, help, placeholder) {
    var inputId = 'theme-input-' + key;
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2"><strong>' + title + '</strong></div>' +
          '<div class="text-secondary small mb-2">' + help + '</div>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerToggleCardNoIcon(key, title, help) {
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2"><strong>' + title + '</strong></div>' +
          '<div class="text-secondary small mb-2">' + help + '</div>' +
          '<div class="form-selectgroup">' +
            radioCard(key, 'show', 'Show') +
            radioCard(key, 'hide', 'Hide') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerSelectCardNoIcon(key, title, help, options, defaultValue) {
    var opts = options || {};
    var radios = Object.keys(opts).map(function (v) { return radioCard(key, v, opts[v] || v); }).join('');
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2"><strong>' + title + '</strong></div>' +
          '<div class="text-secondary small mb-2">' + help + '</div>' +
          '<div class="form-selectgroup">' + radios + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function accentHexInputCard(key, title, placeholder) {
    var inputId = 'theme-input-' + key;
    var def = ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)] || '#4b94e4';
    return '<div class="col-12 col-md-6 col-lg-4">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2"><strong>' + title + '</strong></div>' +
          '<div class="d-flex align-items-center gap-2">' +
            '<input type="color" class="form-control form-control-color theme-accent-swatch" data-accent-sync="' + key + '" style="width:2.5rem;height:2rem;padding:2px;cursor:pointer" title="Pick color" />' +
            '<input type="text" class="form-control theme-accent-hex" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" maxlength="7" />' +
          '</div>' +
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

  function getThemeFormHtml() {
    var glyphGrid = ICON_GLYPH_KEYS.map(function (k) { return glyphInputCard(k); }).join('');
    var visualGrid = [
      iconVisualInputCard('theme-icon-size', 'Global icon size', 'CSS size value used by all Font Awesome icons (for example 1em, 14px, 0.95rem).', DEFAULTS['theme-icon-size']),
      iconVisualInputCard('theme-icon-color', 'Global icon color', 'CSS color for all icons (for example currentColor, #ffffff, rgb(255,255,255)).', DEFAULTS['theme-icon-color'])
    ].join('');
    var headerShapeGrid = [
      headerInputCardNoIcon('theme-header-settings-radius', 'Settings button radius', 'Border radius for the strip Settings button (for example .375rem or 6px).', DEFAULTS['theme-header-settings-radius']),
      headerInputCardNoIcon('theme-header-online-radius', 'Online badge radius', 'Border radius for the visitors badge (for example .375rem or 6px).', DEFAULTS['theme-header-online-radius'])
    ].join('');
    var headerToggleGrid = [
      headerToggleCardNoIcon('theme-header-main-border', 'Menu border-bottom', 'Show or hide the top menu bottom border.'),
      headerToggleCardNoIcon('theme-header-settings-label', 'Settings text label', 'Show or hide the "Settings" text next to the icon button.'),
      headerToggleCardNoIcon('theme-header-settings-border', 'Settings button border', 'Show or hide the border around the Settings button.'),
      headerToggleCardNoIcon('theme-header-online-border', 'Online badge border', 'Show or hide the border around the visitors badge.')
    ].join('');
    var logoCard = headerInputCardNoIcon(
      'theme-header-logo-url',
      'Logo URL override',
      'Use an absolute URL or /path to replace desktop and mobile logos.',
      '/assets/kexo/logo_light.webp'
    );
    var accentGrid = accentHexInputCard('theme-accent-1', 'Accent 1', DEFAULTS['theme-accent-1']) +
      accentHexInputCard('theme-accent-2', 'Accent 2', DEFAULTS['theme-accent-2']) +
      accentHexInputCard('theme-accent-3', 'Accent 3', DEFAULTS['theme-accent-3']) +
      accentHexInputCard('theme-accent-4', 'Accent 4', DEFAULTS['theme-accent-4']) +
      accentHexInputCard('theme-accent-5', 'Accent 5', DEFAULTS['theme-accent-5']);
    var colorRemainingGrid = [
      headerInputCardNoIcon('theme-header-top-text-color', 'Strip text color', 'Text color for strip controls.', DEFAULTS['theme-header-top-text-color']),
      headerInputCardNoIcon('theme-header-settings-text-color', 'Settings button text/icon color', 'Text and icon color for the strip Settings button.', DEFAULTS['theme-header-settings-text-color']),
      headerInputCardNoIcon('theme-header-main-link-color', 'Menu link color', 'Color for top-level desktop menu links.', DEFAULTS['theme-header-main-link-color']),
      headerInputCardNoIcon('theme-header-main-border-color', 'Menu border-bottom color', 'Color for the menu bottom border.', DEFAULTS['theme-header-main-border-color']),
      headerInputCardNoIcon('theme-header-main-shadow', 'Menu box-shadow', 'CSS box-shadow for top menu row (for example 2px 2px 2px #eee or none).', DEFAULTS['theme-header-main-shadow']),
      headerInputCardNoIcon('theme-header-online-text-color', 'Online badge text/icon color', 'Text/icon color for the visitors badge.', DEFAULTS['theme-header-online-text-color']),
      headerInputCardNoIcon('theme-header-strip-padding', 'Strip padding', 'CSS padding for the top strip (for example 0 5px).', DEFAULTS['theme-header-strip-padding']),
    ].join('');
    var opacityGrid = [
      headerInputCardNoIcon('theme-strip-opacity-filter', 'Strip opacity filter', 'Darken strip by 0–100%. 0 = no change, 5 = 5% black overlay.', '0'),
      headerInputCardNoIcon('theme-menu-opacity-filter', 'Menu opacity filter', 'Darken menu by 0–100%. 0 = no change, 5 = 5% black overlay.', '0'),
    ].join('');
    var menuHoverGrid = [
      headerInputCardNoIcon('theme-menu-hover-opacity', 'Menu hover opacity', 'Hover tint strength 0–100%. 0 = no overlay, 8 = subtle.', '8'),
      headerSelectCardNoIcon('theme-menu-hover-color', 'Menu hover tint', 'Black = darken on hover, White = lighten on hover.', { black: 'Black', white: 'White' }, 'black'),
    ].join('');
    var customCssFieldset =
      '<fieldset class="mb-4">' +
        '<legend class="form-label">Custom CSS</legend>' +
        '<div class="text-secondary small mb-2">Injected inline into <code>&lt;head&gt;</code> after other stylesheets. Changes are global.</div>' +
        '<textarea class="form-control font-monospace" name="theme-custom-css" rows="9" spellcheck="false" placeholder="/* Custom CSS */"></textarea>' +
      '</fieldset>';
    return '<form id="theme-settings-form">' +
      '<ul class="nav nav-underline mb-3" id="theme-subtabs" role="tablist">' +
        '<li class="nav-item" role="presentation"><button class="nav-link active" type="button" role="tab" data-theme-subtab="icons" aria-selected="true">Icons</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="header" aria-selected="false">Header</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="color" aria-selected="false">Color</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="fonts" aria-selected="false">Fonts</button></li>' +
      '</ul>' +

      '<div class="theme-subpanel" data-theme-subpanel="icons">' +
        '<div class="text-secondary mb-3">Set icon classes with full Font Awesome specs only (for example <code>fa-light fa-bars</code> or <code>fa-thin fa-circle-check</code>). Settings-page sidebar and diagnostics icons are locked to fixed <code>fa-thin</code> classes and are intentionally excluded from this list.</div>' +
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
        '<div class="text-secondary mb-3">Configure header visibility and shape controls. Header/nav colors are configured in the Color tab.</div>' +
        '<h4 class="mb-2">Shape</h4>' +
        '<div class="row g-3">' + headerShapeGrid + '</div>' +
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
          '<label class="form-label">Theme accents (5 colors)</label>' +
          '<div class="text-secondary small mb-3">Accent 1 drives strip, menu, settings, and dropdown backgrounds. Accents 1–5 rotate for nav active underline.</div>' +
          '<div class="row g-3">' + accentGrid + '</div>' +
        '</div>' +
        '<div class="mb-4">' +
          '<label class="form-label">Opacity filters</label>' +
          '<div class="text-secondary small mb-3">Darken strip or menu by %. 0 = no change.</div>' +
          '<div class="row g-3">' + opacityGrid + '</div>' +
        '</div>' +
        '<div class="mb-4">' +
          '<label class="form-label">Menu hover tint</label>' +
          '<div class="text-secondary small mb-3">Control the hover overlay on menu links and dropdown items. Black = darken, White = lighten. Opacity 0–100% sets strength.</div>' +
          '<div class="row g-3">' + menuHoverGrid + '</div>' +
        '</div>' +
        '<div class="mb-4">' +
          '<label class="form-label">Header & nav colors</label>' +
          '<div class="row g-3">' + colorRemainingGrid + '</div>' +
        '</div>' +
        customCssFieldset +
        '<div class="mb-4">' +
          '<label class="form-label">Strip border & padding</label>' +
          '<div class="row g-3">' +
            headerToggleCardNoIcon('theme-header-strip-border', 'Strip border-bottom', 'Show or hide the bottom border on the top strip.') +
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

  function setPreviewIconClass(previewEl, glyphCls) {
    if (!previewEl) return;
    var parsed = parseIconGlyphInput(glyphCls, 'fa-light fa-circle');
    previewEl.className = parsed.value;
  }

  function refreshIconPreviews(formEl) {
    if (!formEl) return;
    ICON_GLYPH_KEYS.forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      var preview = formEl.querySelector('[data-theme-icon-preview-glyph="' + key + '"]');
      var glyphVal = input && input.value ? input.value : (getStored(key) || DEFAULTS[key]);
      setPreviewIconClass(preview, glyphVal);
    });
  }

  function bindThemeForm(formEl) {
    if (!formEl) return;
    var debounceTimers = {};
    var globalSaveTimers = {};
    var globalSaveAllTimer = null;

    function debouncedApply(name, value) {
      if (debounceTimers[name]) clearTimeout(debounceTimers[name]);
      debounceTimers[name] = setTimeout(function () {
        applyTheme(name, value);
      }, 350);
    }

    function queueGlobalSaveKey(key) {
      if (!key) return;
      var mode = getPreferenceMode();
      // Theme scope is a shared setting; persist it even when switching to `user`.
      var isScopeKey = key === 'theme-preference-mode';
      if (mode !== 'global' && !isScopeKey) return;

      if (globalSaveTimers[key]) clearTimeout(globalSaveTimers[key]);
      globalSaveTimers[key] = setTimeout(function () {
        var dbKey = key.replace(/-/g, '_');
        var payload = {};
        var raw = getStored(key);
        payload[dbKey] = (raw != null && String(raw).trim() !== '') ? String(raw) : (DEFAULTS[key] || '');
        saveToServer(payload, { keepalive: true }).catch(function () {});
      }, 700);
    }

    function queueGlobalSaveAll() {
      if (getPreferenceMode() !== 'global') return;
      if (globalSaveAllTimer) clearTimeout(globalSaveAllTimer);
      globalSaveAllTimer = setTimeout(function () {
        saveToServer().catch(function () {});
      }, 700);
    }

    formEl.addEventListener('change', function (e) {
      var name = e && e.target ? e.target.name : '';
      var rawVal = e && e.target && e.target.value != null ? String(e.target.value) : '';
      var val = name === 'theme-custom-css' ? rawVal : rawVal.trim();
      if (!name) return;
      if (ICON_STYLE_KEYS.indexOf(name) >= 0) val = normalizeIconStyle(val, DEFAULTS[name]);
      if (ICON_GLYPH_KEYS.indexOf(name) >= 0) val = normalizeIconGlyph(val, DEFAULTS[name]);
      if (name === 'theme-icon-size') val = normalizeIconSize(val, DEFAULTS[name]);
      if (name === 'theme-icon-color') val = normalizeIconColor(val, DEFAULTS[name]);
      if (ACCENT_OPACITY_KEYS.indexOf(name) >= 0) val = normalizeOpacityFilter(val, DEFAULTS[name]);
      if (name === 'theme-header-strip-padding') val = normalizeStripPadding(val, DEFAULTS[name]);
      if (HEADER_THEME_TEXT_KEYS.indexOf(name) >= 0) {
        if (name === 'theme-header-logo-url') val = normalizeLogoUrl(val);
        else if (/theme-header-.*-radius$/.test(name)) val = normalizeHeaderRadius(val, DEFAULTS[name]);
        else if (name === 'theme-header-main-shadow') val = normalizeHeaderShadow(val, DEFAULTS[name]);
        else val = normalizeHeaderColor(val, DEFAULTS[name]);
      }
      if (HEADER_THEME_TOGGLE_KEYS.indexOf(name) >= 0) val = normalizeHeaderToggle(val, DEFAULTS[name]);
      if (HEADER_THEME_RADIO_KEYS.indexOf(name) >= 0) val = (val === 'white' ? 'white' : 'black');
      if (name === 'theme-preference-mode') val = normalizePreferenceMode(val, DEFAULTS[name]);
      setStored(name, val);
      applyTheme(name, val);
      refreshIconPreviews(formEl);
      queueGlobalSaveKey(name);
    });

    function wireAccentHexInputs() {
      ACCENT_HEX_KEYS.forEach(function (key) {
        var hexInput = formEl.querySelector('.theme-accent-hex[name="' + key + '"]');
        var swatch = formEl.querySelector('.theme-accent-swatch[data-accent-sync="' + key + '"]');
        if (!hexInput) return;
        function syncFromHex() {
          var val = normalizeAccentHex(hexInput.value, ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)]);
          setStored(key, val);
          debouncedApply(key, val);
          queueGlobalSaveKey(key);
          if (swatch) swatch.value = val;
        }
        function syncFromSwatch() {
          if (swatch && swatch.value) {
            hexInput.value = swatch.value;
            setStored(key, swatch.value);
            debouncedApply(key, swatch.value);
            queueGlobalSaveKey(key);
          }
        }
        hexInput.addEventListener('input', syncFromHex);
        hexInput.addEventListener('change', syncFromHex);
        if (swatch) {
          swatch.addEventListener('input', syncFromSwatch);
          swatch.addEventListener('change', syncFromSwatch);
        }
      });
    }

    ICON_STYLE_KEYS.concat(ICON_GLYPH_KEYS).concat(ICON_VISUAL_KEYS).concat(HEADER_THEME_TEXT_KEYS).concat(ACCENT_OPACITY_KEYS).concat(CUSTOM_CSS_KEYS).forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      if (!input) return;
      input.addEventListener('input', function () {
        var rawVal = String(input.value || '');
        var val = key === 'theme-custom-css' ? rawVal : rawVal.trim();
        if (ICON_STYLE_KEYS.indexOf(key) >= 0) val = normalizeIconStyle(val, DEFAULTS[key]);
        if (ICON_GLYPH_KEYS.indexOf(key) >= 0) val = normalizeIconGlyph(val, DEFAULTS[key]);
        if (key === 'theme-icon-size') val = normalizeIconSize(val, DEFAULTS[key]);
        if (key === 'theme-icon-color') val = normalizeIconColor(val, DEFAULTS[key]);
        if (ACCENT_OPACITY_KEYS.indexOf(key) >= 0) val = normalizeOpacityFilter(val, DEFAULTS[key]);
        if (key === 'theme-header-strip-padding') val = normalizeStripPadding(val, DEFAULTS[key]);
        if (HEADER_THEME_TEXT_KEYS.indexOf(key) >= 0) {
          if (key === 'theme-header-logo-url') val = normalizeLogoUrl(val);
          else if (/theme-header-.*-radius$/.test(key)) val = normalizeHeaderRadius(val, DEFAULTS[key]);
          else if (key === 'theme-header-main-shadow') val = normalizeHeaderShadow(val, DEFAULTS[key]);
          else val = normalizeHeaderColor(val, DEFAULTS[key]);
        }
        setStored(key, val);
        refreshIconPreviews(formEl);
        debouncedApply(key, val);
        queueGlobalSaveKey(key);
      });
    });

    wireAccentHexInputs();

    var root = formEl.parentElement || document;
    var refreshBtn = root.querySelector('#theme-icons-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      refreshIconPreviews(formEl);
      triggerIconThemeRefresh();
    });

    var saveBtn = root.querySelector('#theme-save-defaults');
    var resetBtn = root.querySelector('#theme-reset');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      var btn = this;
      if (btn.disabled) return;
      var originalText = 'Save as default';
      btn.disabled = true;
      btn.textContent = 'Saving...';
      saveToServer().then(function () {
        btn.textContent = 'Saved!';
        btn.classList.replace('btn-primary', 'btn-success');
        setTimeout(function () {
          btn.textContent = originalText;
          btn.classList.replace('btn-success', 'btn-primary');
          btn.disabled = false;
        }, 1500);
      }).catch(function () {
        btn.textContent = 'Save failed';
        btn.classList.replace('btn-primary', 'btn-danger');
        setTimeout(function () {
          btn.textContent = originalText;
          btn.classList.replace('btn-danger', 'btn-primary');
          btn.disabled = false;
        }, 2200);
      });
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      var modeBeforeReset = getPreferenceMode();
      KEYS.forEach(function (key) {
        if (key === 'theme-preference-mode') return;
        removeStored(key);
        applyTheme(key, DEFAULTS[key]);
      });
      syncUI();
      triggerIconThemeRefresh();
      if (modeBeforeReset === 'global') queueGlobalSaveAll();
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

  // ── Asset overrides (favicon + logos) ─────────────────────────────────────
  function normalizeAssetOverrideUrl(value) {
    var raw = value != null ? String(value).trim() : '';
    if (!raw) return '';
    if (raw.length > 2048) return '';
    if (/[<>"'\r\n\t ]/.test(raw)) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\/\//.test(raw)) return raw;
    if (raw[0] === '/') return raw;
    return '';
  }

  function applyFaviconOverride(url) {
    var safe = normalizeAssetOverrideUrl(url);
    if (!safe) return;
    try {
      var link = document.querySelector('link[rel="icon"]');
      if (link) link.href = safe;
    } catch (_) {}
  }

  function applyImgSrcOverride(selector, url) {
    var safe = normalizeAssetOverrideUrl(url);
    if (!safe) return;
    try {
      var nodes = document.querySelectorAll(selector);
      if (!nodes || !nodes.length) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { applyImgSrcOverride(selector, safe); }, { once: true });
        }
        return;
      }
      nodes.forEach(function (img) {
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

  function fetchAssetOverridesAndApply() {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/asset-overrides', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        var overrides = data.assetOverrides || {};

        var favicon = normalizeAssetOverrideUrl(overrides.favicon);
        if (favicon) applyFaviconOverride(favicon);

        var footerLogo = normalizeAssetOverrideUrl(overrides.footerLogo || overrides.footer_logo);
        if (footerLogo) applyImgSrcOverride('img[data-kexo-asset="footer-logo"]', footerLogo);

        var kexoLogoFull = normalizeAssetOverrideUrl(overrides.kexoLogoFullcolor || overrides.kexo_logo_fullcolor);
        if (kexoLogoFull) applyImgSrcOverride('img[src*="/assets/kexo_logo_fullcolor.webp"]', kexoLogoFull);

        // Legacy: if Theme header logo isn't set, fall back to assetOverrides.logo.
        var legacyHeaderLogo = normalizeAssetOverrideUrl(overrides.logo);
        if (legacyHeaderLogo) {
          var stored = '';
          try { stored = String(localStorage.getItem('theme-header-logo-url') || '').trim(); } catch (_) { stored = ''; }
          if (!stored) applyHeaderLogoOverride(legacyHeaderLogo);
        }
      })
      .catch(function () {});
  }

  // Init
  clearLockedIconOverrides();
  restoreAll();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindThemeButtons();
      fetchDefaults();
      fetchAssetOverridesAndApply();
      if (document.body.getAttribute('data-page') === 'settings') injectSettingsThemePanel();
    });
  } else {
    bindThemeButtons();
    fetchDefaults();
    fetchAssetOverridesAndApply();
    if (document.body.getAttribute('data-page') === 'settings') injectSettingsThemePanel();
  }
})();
