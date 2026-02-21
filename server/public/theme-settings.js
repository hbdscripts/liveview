(function () {
  'use strict';

  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('theme', { page: 'theme' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('theme', 'init', {}); } catch (_) {}

  var ICON_STYLE_CLASSES = ['fa-jelly', 'fa-jelly-filled', 'fa-light', 'fa-solid', 'fa-brands'];
  var ICON_STYLE_DEFAULTS = {};
  var ICON_STYLE_META = {};
  var ICON_OVERRIDES_JSON_KEY = 'theme-icon-overrides-json';
  var ICON_REGISTRY = (window.KexoIconRegistry && window.KexoIconRegistry.registry) ? window.KexoIconRegistry.registry : null;
  function cloneRegistryMap(src) {
    var out = {};
    var map = src && typeof src === 'object' ? src : {};
    Object.keys(map).forEach(function (k) { out[k] = map[k]; });
    return out;
  }
  var LOCKED_SETTINGS_ICON_KEYS = cloneRegistryMap(ICON_REGISTRY && ICON_REGISTRY.lockedSettingsIconKeys);
  var ICON_GLYPH_DEFAULTS = cloneRegistryMap(ICON_REGISTRY && ICON_REGISTRY.iconGlyphDefaults);
  var LEGACY_THEME_ICON_KEYS = cloneRegistryMap(ICON_REGISTRY && ICON_REGISTRY.legacyThemeIconKeys);
  var REQUIRED_ACTIVE_ICON_KEYS = Array.isArray(ICON_REGISTRY && ICON_REGISTRY.requiredActiveIconKeys)
    ? ICON_REGISTRY.requiredActiveIconKeys.slice()
    : [];
  if (!Object.keys(ICON_GLYPH_DEFAULTS).length) {
    try { console.error('[theme-settings] Missing icon registry payload from /icon-registry.js'); } catch (_) {}
  }
  var ICON_GLYPH_META = {
    'live-landing-entry': { title: 'Live Table - "Entry"', help: 'Landing direction entry icon. Shows in the Live table on /dashboard/live.' },
    'live-landing-exit': { title: 'Live Table - "Exit"', help: 'Landing direction exit icon. Shows in the Live table on /dashboard/live.' },
    'table-icon-variants-variant': { title: 'Variants table - Variant', help: 'Short header icon for the Variant column in Insights → Variants.' },
    'table-icon-variants-sessions': { title: 'Variants table - Sessions', help: 'Short header icon for the Sessions column in Insights → Variants.' },
    'table-icon-variants-orders': { title: 'Variants table - Orders', help: 'Short header icon for the Orders column in Insights → Variants.' },
    'table-icon-variants-cr': { title: 'Variants table - CR', help: 'Short header icon for the CR% column in Insights → Variants.' },
    'table-icon-variants-revenue': { title: 'Variants table - Revenue', help: 'Short header icon for the Rev column in Insights → Variants.' },
    'table-icon-converted-sale': { title: 'Converted row - Sale', help: 'Sale icon shown in the Compliance column when a session has a conversion.' },
    'table-icon-compliance-header': { title: 'Compliance - Header', help: 'Icon shown in the Compliance column header in sessions tables (Live, Sales, Table views).' },
    'table-icon-compliance-check': { title: 'Compliance - Check', help: 'Icon shown when a session passes compliance checks (no fraud warning).' },
    'table-icon-compliance-warning': { title: 'Compliance - Warning', help: 'Icon shown when compliance checks warn (fraud triggered).' },
    'table-icon-compliance-search': { title: 'Compliance - Search', help: 'Default icon in the Compliance column when no fraud evaluation exists; replaced by check or warning when evaluation is present.' },
    'table-sticky-resize-handle': { title: 'Sticky column - Resize handle', help: 'Icon shown on the sticky column resize handle in sessions tables (Live, Sales, Table views).' },
    'chart-builder-icon': { title: 'Chart - Layout', help: 'Icon shown at the top of chart cards that links to Settings → Layout. Use full Font Awesome classes (e.g. fa-light fa-gear).' },
    'dash-kpi-delta-up': { title: 'Overview KPI - Delta up', help: 'Up-trend icon in KPI cards on /dashboard/overview when metric delta is positive.' },
    'dash-kpi-delta-down': { title: 'Overview KPI - Delta down', help: 'Down-trend icon in KPI cards on /dashboard/overview when metric delta is negative.' },
    'dash-kpi-delta-flat': { title: 'Overview KPI - Delta flat', help: 'Flat-trend icon in KPI cards on /dashboard/overview when metric delta is neutral.' },
    'nav-dropdown-arrow': { title: 'Nav Dropdown Arrow', help: 'Arrow icon shown next to each item in the top-nav dropdown menus (Dashboard, Insights, Acquisition, etc.).' },
    'nav-item-admin': { title: 'Settings menu - Admin', help: 'Icon shown for the Admin item in the top-right settings dropdown.' },
    'admin-tab-controls': { title: 'Admin - Controls', help: 'Sidebar icon shown for Controls in /admin.' },
    'admin-tab-diagnostics': { title: 'Admin - Diagnostics', help: 'Sidebar icon shown for Diagnostics in /admin.' },
    'admin-tab-users': { title: 'Admin - Users', help: 'Sidebar icon shown for Users in /admin.' },
    'admin-tab-help-tooltip': { title: 'Admin - Help tooltip', help: 'Icon shown on the Icons & assets panel as the click-to-open help trigger at the end of each icon label row.' },
    'admin-tab-save-icon': { title: 'Admin - Save icon', help: 'Icon used for Save on icon cards (glyphs, payment, attribution, variants).' },
    'admin-tab-edit-icon': { title: 'Admin - Edit icon', help: 'Icon used for Edit on icon cards (glyphs, payment, attribution, variants).' },
  };

  function isLockedSettingsIconKey(name) {
    return !!LOCKED_SETTINGS_ICON_KEYS[String(name || '').trim()];
  }

  function defaultIconStyleForKey(name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return 'fa-light';
    if (isLockedSettingsIconKey(key)) return 'fa-thin';
    if (key === 'nav-item-refresh' || key === 'nav-item-sound-on' || key === 'nav-item-sound-off' || key === 'nav-item-settings') return 'fa-thin';
    if (key.indexOf('nav-toggle-') === 0 || key === 'topnav-date-chevron' || key === 'nav-notifications-bell') return 'fa-jelly-filled';
    if (key.indexOf('header-') === 0) return 'fa-jelly-filled';
    if (key === 'nav-dropdown-arrow') return 'fa-solid';
    if (key.indexOf('nav-item-') === 0) return 'fa-jelly';
    if (key === 'table-icon-compliance-search') return 'fa-light';
    if (key.indexOf('table-icon-') === 0) return 'fa-jelly-filled';
    if (key.indexOf('table-short-') === 0) return 'fa-solid';
    if (key.indexOf('card-title-') === 0) return 'fa-jelly-filled';
    if (key.indexOf('footer-') === 0) return 'fa-jelly-filled';
    if (key === 'mobile-menu' || key === 'mobile-date' || key === 'online-status-indicator') return 'fa-jelly';
    if (key.indexOf('kpi-compare-') === 0) return 'fa-light';
    if (key.indexOf('live-') === 0 || key.indexOf('breakdown-') === 0) return 'fa-light';
    if (key.indexOf('type-device-') === 0 || key.indexOf('type-platform-') === 0 || key.indexOf('type-browser-') === 0) return 'fa-light';
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

  var ACCENT_DEFAULTS = ['#4b94e4', '#3eb3ab', '#f59e34', '#e4644b', '#6681e8', '#8395aa', '#a3e635', '#f43f5e', '#06b6d4', '#8b5cf6'];
  var DEFAULTS = {
    theme: 'light',
    'theme-accent-1': ACCENT_DEFAULTS[0],
    'theme-accent-2': ACCENT_DEFAULTS[1],
    'theme-accent-3': ACCENT_DEFAULTS[2],
    'theme-accent-4': ACCENT_DEFAULTS[3],
    'theme-accent-5': ACCENT_DEFAULTS[4],
    'theme-accent-6': ACCENT_DEFAULTS[5],
    'theme-accent-7': ACCENT_DEFAULTS[6],
    'theme-accent-8': ACCENT_DEFAULTS[7],
    'theme-accent-9': ACCENT_DEFAULTS[8],
    'theme-accent-10': ACCENT_DEFAULTS[9],
    'theme-radius': '1',
    'theme-font': 'sans',
    'theme-base': 'slate',
    'theme-preference-mode': 'global',
    'theme-icon-overrides-json': '{}',
    'theme-header-top-bg': '#ffffff',
    'theme-header-top-text-color': '#1f2937',
    'theme-header-main-bg': '#ffffff',
    'theme-header-link-color': '#1f2937',
    'theme-header-main-link-color': '#1f2937',
    'theme-header-main-dropdown-bg': '#ffffff',
    'theme-header-main-dropdown-link-color': '#1f2937',
    'theme-header-main-dropdown-icon-color': '#1f2937',
    'theme-header-main-border': 'show',
    'theme-header-main-border-color': 'transparent',
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
    'theme-menu-hover-opacity': '8',
    'theme-menu-hover-color': 'black',
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
    if (LOCKED_GLYPH_THEME_KEYS.indexOf(k) >= 0) return false;
    var name = glyphNameFromThemeKey(k);
    if (LEGACY_THEME_ICON_KEYS[name]) return false;
    if (name.indexOf('payment-method-') === 0) return false;
    return true;
  });
  var KEYS = Object.keys(DEFAULTS).filter(function (k) {
    if (k === 'theme') return false;
    if (ICON_STYLE_KEYS.indexOf(k) >= 0) return false;
    if (LOCKED_GLYPH_THEME_KEYS.indexOf(k) >= 0) return false;
    return true;
  });
  var ACCENT_HEX_KEYS = ['theme-accent-1', 'theme-accent-2', 'theme-accent-3', 'theme-accent-4', 'theme-accent-5', 'theme-accent-6', 'theme-accent-7', 'theme-accent-8', 'theme-accent-9', 'theme-accent-10'];
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
    'theme-header-strip-padding',
  ];
  var HEADER_THEME_TOGGLE_KEYS = [
    'theme-header-main-border',
    'theme-header-settings-label',
    'theme-header-settings-border',
    'theme-header-online-border',
  ];
  var ACCENT_OPACITY_KEYS = ['theme-menu-hover-opacity'];
  var HEADER_THEME_RADIO_KEYS = ['theme-menu-hover-color'];
  var CUSTOM_CSS_KEYS = ['theme-custom-css'];

  /* Fallbacks from tabler-theme.css, custom.css, app.css, head-theme (slate) */
  var CSS_VAR_FALLBACKS = {
    '--kexo-header-top-bg': '#4b94e4',
    '--kexo-header-top-text-color': '#1f2937',
    '--kexo-top-menu-bg': '#4b94e4',
    '--kexo-top-menu-link-color': '#1f2937',
    '--kexo-top-menu-dropdown-bg': '#4b94e4',
    '--kexo-top-menu-dropdown-link-color': '#1f2937',
    '--kexo-top-menu-dropdown-icon-color': '#1f2937',
    '--kexo-top-menu-border-color': 'transparent',
    '--kexo-header-settings-bg': '#4b94e4',
    '--kexo-header-settings-text-color': '#1f2937',
    '--kexo-header-settings-border-color': '#4b94e4',
    '--kexo-header-online-bg': '#4b94e4',
    '--kexo-header-online-text-color': '#1f2937',
    '--kexo-header-online-border-color': '#e6e7e9',
    '--kexo-menu-hover-bg': 'rgba(0,0,0,.08)',
    '--kexo-kpi-delta-up': '#2fb344',
    '--kexo-kpi-delta-same': '#66bdb7',
    '--kexo-kpi-delta-down': '#d63939',
    '--kexo-kpi-compare-line': '#cccccc',
    '--tblr-primary': '#3eb3ab',
    '--tblr-success': '#2fb344',
    '--tblr-warning': '#f59e0b',
    '--tblr-danger': '#d63939',
    '--tblr-secondary': '#626976',
    '--tblr-secondary-color': '#626976',
    '--tblr-body-color': '#1e293b',
    '--tblr-body-bg': '#f5f7fb',
    '--tblr-border-color': '#e6e7e9',
    '--tblr-bg-surface': '#fff',
    '--tblr-bg-surface-secondary': '#f8fafc',
    '--tblr-link-color': '#3eb3ab',
    '--tblr-muted': '#6c757d',
    '--tblr-disabled-color': '#adb5bd',
    '--tblr-border-color-translucent': 'rgba(0,0,0,.08)',
    '--tblr-card-bg': '#ffffff',
    '--tblr-gray-50': '#f8fafc',
    '--tblr-gray-100': '#f1f5f9',
    '--tblr-gray-200': '#e2e8f0',
    '--tblr-gray-300': '#cbd5e1',
    '--tblr-gray-400': '#94a3b8',
    '--tblr-gray-500': '#64748b',
    '--tblr-gray-600': '#475569',
    '--tblr-gray-700': '#334155',
    '--tblr-gray-800': '#1e293b',
    '--tblr-gray-900': '#0f172a',
    '--tblr-gray-950': '#020617',
    '--converted-bg': '#edf7f6',
    '--converted-hover': '#e0f2ef',
    '--returning-bg': '#fff',
    '--badge-returning': '#6366f1',
    '--chip-abandoned': '#dc2626',
    '--online-dot-color': '#22c55e',
    '--link-fg': '#222',
    '--side-panel-sale-bg': 'rgba(13,148,136,.08)',
    '--top-bar-divider': '#eee',
  };

  function getColorSchemeMap() {
    try {
      return (typeof window !== 'undefined' && window.KexoColorSchemeMap && typeof window.KexoColorSchemeMap === 'object')
        ? window.KexoColorSchemeMap
        : null;
    } catch (_) {
      return null;
    }
  }

  function listCssVarOverrideItemsForAccordion(map, accordionId, opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var includeAdvanced = o.includeAdvanced === true;
    var mapObj = map && typeof map === 'object' ? map : null;
    if (!mapObj || typeof mapObj.cssVarOverrides !== 'function') return [];
    var all = [];
    try { all = mapObj.cssVarOverrides(); } catch (_) { all = []; }
    return (Array.isArray(all) ? all : []).filter(function (it) {
      if (!it || typeof it !== 'object') return false;
      if (it.tab !== 'colors') return false;
      if (it.accordion !== accordionId) return false;
      if (it.advanced && !includeAdvanced) return false;
      if (!it.key || typeof it.key !== 'string') return false;
      // Never render dead/stale vars
      try {
        if (Array.isArray(mapObj.deadCssVars) && mapObj.deadCssVars.indexOf(it.key) >= 0) return false;
      } catch (_) {}
      return true;
    });
  }

  function cssVarOverrideRow(it) {
    var name = it && it.key ? String(it.key).trim() : '';
    if (!name) return '';
    var label = it && it.label ? String(it.label) : name;
    var searchText = (label + ' ' + name).toLowerCase();
    var groupId = it && it.accordion ? String(it.accordion) : 'misc';
    return '' +
      '<div class="mb-3 kexo-css-var-row" data-kexo-css-var-row="1" data-kexo-css-var-group="' + escapeHtml(groupId) + '" data-kexo-css-var-search="' + escapeHtml(searchText) + '">' +
        '<div class="d-flex align-items-center gap-2 justify-content-between mb-1">' +
          '<div class="form-label mb-0"><strong>' + escapeHtml(label) + '</strong></div>' +
          '<a href="#" class="kexo-css-var-revert text-secondary small" data-kexo-css-var="' + escapeHtml(name) + '" role="button" aria-label="Revert">Revert</a>' +
        '</div>' +
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
          '<input type="color" class="form-control form-control-color kexo-css-var-swatch" data-kexo-css-var="' + escapeHtml(name) + '" title="Pick colour" />' +
          '<input type="text" class="form-control kexo-css-var-input settings-ui-maxw-360" data-kexo-css-var="' + escapeHtml(name) + '" placeholder="#rrggbb or rgb()/hsl()" maxlength="150" />' +
          '<code class="text-secondary small ms-auto kexo-css-var-name">' + escapeHtml(name) + '</code>' +
        '</div>' +
      '</div>';
  }

  function buildCssVarOverridesAccordionHtml(map, accordionId, accordionLabel, opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var open = o.open === true;
    var parentId = o.parentId ? String(o.parentId) : '';
    var parentAttr = parentId ? (' data-bs-parent="#' + escapeHtml(parentId) + '"') : '';
    var collapseId = 'theme-color-accordion-' + String(accordionId || 'section').replace(/[^a-z0-9_-]/ig, '-');
    var headingId = collapseId + '-h';
    var items = listCssVarOverrideItemsForAccordion(map, accordionId, { includeAdvanced: o.includeAdvanced === true });
    var cards = items.map(function (it) {
      var name = it && it.key ? String(it.key).trim() : '';
      var label = it && it.label ? String(it.label) : name;
      var groupId = it && it.accordion ? String(it.accordion) : 'misc';
      var searchText = (label + ' ' + name).toLowerCase();
      var extraAttrs = ' data-kexo-css-var-group="' + escapeHtml(groupId) + '" data-kexo-css-var-search="' + escapeHtml(searchText) + '"';
      return cssVarOverrideInputCard(name, label, null, extraAttrs);
    }).join('');
    var bodyContent = cards
      ? '<div class="settings-responsive-grid" data-kexo-css-var-accordion-body="' + escapeHtml(accordionId) + '">' + cards + '</div>'
      : '<div class="text-secondary small">No items.</div>';
    return '' +
      '<div class="accordion-item" data-kexo-css-var-accordion="' + escapeHtml(accordionId) + '">' +
        '<h4 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
          '<button class="accordion-button' + (open ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + escapeHtml(collapseId) + '">' +
            '<span class="d-flex align-items-center w-100 gap-2">' +
              '<span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span>' +
              '<span class="me-auto">' + escapeHtml(accordionLabel || accordionId) + '</span>' +
            '</span>' +
          '</button>' +
        '</h4>' +
        '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse' + (open ? ' show' : '') + '"' + parentAttr + ' aria-labelledby="' + escapeHtml(headingId) + '">' +
          '<div class="accordion-body">' +
            '<div class="text-secondary small mb-3">Leave blank to use theme default.</div>' +
            bodyContent +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function buildAccordionItemHtml(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var accordionId = String(o.accordionId || 'section');
    var label = String(o.label || accordionId);
    var open = o.open === true;
    var parentId = o.parentId ? String(o.parentId) : '';
    var collapseId = (o.collapseId ? String(o.collapseId) : ('theme-accordion-' + accordionId)).replace(/[^a-z0-9_-]/ig, '-');
    var headingId = collapseId + '-h';
    var bodyHtml = o.bodyHtml != null ? String(o.bodyHtml) : '';
    var dataAttrs = o.dataAttrs ? String(o.dataAttrs) : '';
    var parentAttr = parentId ? (' data-bs-parent="#' + escapeHtml(parentId) + '"') : '';
    return '' +
      '<div class="accordion-item"' + dataAttrs + '>' +
        '<h4 class="accordion-header" id="' + escapeHtml(headingId) + '">' +
          '<button class="accordion-button' + (open ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + escapeHtml(collapseId) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + escapeHtml(collapseId) + '">' +
            '<span class="d-flex align-items-center w-100 gap-2">' +
              '<span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span>' +
              '<span class="me-auto">' + escapeHtml(label) + '</span>' +
            '</span>' +
          '</button>' +
        '</h4>' +
        '<div id="' + escapeHtml(collapseId) + '" class="accordion-collapse collapse' + (open ? ' show' : '') + '"' + parentAttr + ' aria-labelledby="' + escapeHtml(headingId) + '">' +
          '<div class="accordion-body">' + bodyHtml + '</div>' +
        '</div>' +
      '</div>';
  }

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

  function cssColorToHex(cssColor) {
    if (!cssColor || typeof cssColor !== 'string') return '';
    var s = cssColor.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) {
      var h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      return '#' + h.toLowerCase();
    }
    var rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s);
    if (rgb) {
      var r = parseInt(rgb[1], 10);
      var g = parseInt(rgb[2], 10);
      var b = parseInt(rgb[3], 10);
      if (r > 255) r = 255;
      if (g > 255) g = 255;
      if (b > 255) b = 255;
      return '#' + [r, g, b].map(function (x) {
        var h = x.toString(16);
        return h.length === 1 ? '0' + h : h;
      }).join('');
    }
    return '';
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

  function extractFirstSvgMarkup(value) {
    var raw = String(value == null ? '' : value);
    if (!raw) return '';
    var m = raw.match(/<svg[\s\S]*?<\/svg>/i);
    return m && m[0] ? String(m[0]) : '';
  }

  function sanitizeSvgMarkup(value) {
    var svg = extractFirstSvgMarkup(value);
    if (!svg) return '';
    svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, '');
    svg = svg.replace(/<!--[\s\S]*?-->/g, '');
    svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
    svg = svg.replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
    svg = svg.replace(/\s(?:href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
    return svg.trim();
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
    var rawInput = String(value == null ? '' : value).trim();
    var svgMarkup = sanitizeSvgMarkup(rawInput);
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
    if (!rawInput) return { mode: 'full', value: safeFallback, full: safeFallback };
    if (svgMarkup) return { mode: 'svg', value: svgMarkup, full: safeFallback };
    if (/^(https?:\/\/|\/\/|\/)/i.test(rawInput)) return { mode: 'img', value: rawInput, full: safeFallback };
    var raw = sanitizeIconClassString(rawInput).toLowerCase();
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

  function normalizeIconColor(value, fallback) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return fallback || 'currentColor';
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
    if (/^(rgb|hsl)a?\(/i.test(raw)) return raw;
    if (raw.toLowerCase() === 'currentcolor') return 'currentColor';
    if (/^[a-z-]+$/i.test(raw)) return raw;
    return fallback || 'currentColor';
  }

  function normalizeIconOverrideSize(value) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return '';
    if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(raw)) return raw;
    if (/^\d+(\.\d+)?$/.test(raw)) return raw + 'em';
    return '';
  }

  function normalizeIconOverrideColor(value) {
    var raw = sanitizeIconClassString(value);
    if (!raw) return '';
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
    if (/^(rgb|hsl)a?\(/i.test(raw)) return raw;
    if (raw.toLowerCase() === 'currentcolor') return 'currentColor';
    if (/^[a-z-]+$/i.test(raw)) return raw;
    return '';
  }

  function isAllowedIconOverrideKey(name) {
    var s = String(name || '').trim();
    if (!s || s.length > 120) return false;
    if (Object.prototype.hasOwnProperty.call(ICON_GLYPH_DEFAULTS, s)) return true;
    if (/^payment-method-[a-z0-9_-]+$/i.test(s)) return true;
    if (/^variant_rule_[a-z0-9_-]+__[a-z0-9_-]+$/i.test(s)) return true;
    if (/^attribution-source-[a-z0-9_-]+$/i.test(s)) return true;
    if (/^attribution-variant-[a-z0-9_-]+$/i.test(s)) return true;
    if (/^overview-widget-[a-z0-9_-]+$/i.test(s)) return true;
    if (/^variant_icon_[a-z0-9_-]+$/i.test(s)) return true;
    return false;
  }

  function readIconOverridesMap() {
    var raw = getStored(ICON_OVERRIDES_JSON_KEY);
    if (!raw) return {};
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return {};
    var out = {};
    Object.keys(parsed).forEach(function (name) {
      if (!isAllowedIconOverrideKey(name)) return;
      var row = parsed[name];
      if (!row || typeof row !== 'object') return;
      var size = normalizeIconOverrideSize(row.size);
      var color = normalizeIconOverrideColor(row.color);
      if (!size && !color) return;
      out[name] = { size: size, color: color };
    });
    return out;
  }

  function writeIconOverridesMap(map) {
    var src = map && typeof map === 'object' ? map : {};
    var out = {};
    Object.keys(src).forEach(function (name) {
      if (!isAllowedIconOverrideKey(name)) return;
      var row = src[name];
      if (!row || typeof row !== 'object') return;
      var size = normalizeIconOverrideSize(row.size);
      var color = normalizeIconOverrideColor(row.color);
      if (!size && !color) return;
      out[name] = { size: size, color: color };
    });
    setStored(ICON_OVERRIDES_JSON_KEY, JSON.stringify(out));
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
    s = s.replace(/\b\w/g, function (m) { return m.toUpperCase(); });
    s = s.replace(/\s+Icon\s+/g, ' - ').replace(/\s*Icon\s*$/i, '').trim();
    return s || 'Icon';
  }

  function defaultIconHelpFor(name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return 'Icon shown in the app UI.';
    if (key === 'mobile-menu') return 'Mobile menu button. Shows in the header on all pages on mobile.';
    if (key === 'mobile-date') return 'Mobile date button. Shows in the header on all pages on mobile.';
    if (key === 'topnav-date-chevron') return 'Desktop date selector chevron. Shows in the header date control on all pages.';
    if (key.indexOf('nav-toggle-') === 0) return 'Desktop top-nav section icon. Shows in the main header menu on all pages.';
    if (key.indexOf('nav-item-') === 0) return 'Desktop dropdown menu icon. Shows inside top-nav dropdown menus on all pages.';
    if (key.indexOf('table-icon-') === 0) return 'Compact table metric icon. Shows in sortable table headers on /acquisition/attribution and /acquisition/devices.';
    if (key.indexOf('table-short-') === 0) return 'Compact table column icon. Shows in sortable table headers on /dashboard/live, /dashboard/sales, /dashboard/table, /insights/countries, /insights/products, /acquisition/attribution, and /acquisition/devices.';
    if (key.indexOf('footer-') === 0) return 'Footer quick-action icon. Shows in the bottom action bar on all pages.';
    if (key.indexOf('side-panel-') === 0) return 'Session details side panel icon. Shows on /dashboard/live, /dashboard/sales, and /dashboard/table.';
    if (key.indexOf('kpi-compare-') === 0) return 'KPI compare modal icon. Shows on /dashboard/overview, /dashboard/live, /dashboard/sales, /dashboard/table, /insights/countries, /insights/products, /acquisition/attribution, /acquisition/devices, /integrations/google-ads, and /tools/ads.';
    if (key === 'tools-click-order-lookup-search') return 'Search icon shown inside the Click & Order Lookup input on /tools/click-order-lookup.';
    if (key === 'live-landing-entry') return 'Live table entry icon. Shows in the Landing direction column on /dashboard/live.';
    if (key === 'live-landing-exit') return 'Live table exit icon. Shows in the Landing direction column on /dashboard/live.';
    if (key === 'live-bought-overlay') return 'Live table bought overlay icon. Shows in bought-state overlays on /dashboard/live.';
    if (key.indexOf('breakdown-') === 0) return 'Breakdown item icon. Shows in breakdown cards/tables on insights pages.';
    if (key.indexOf('type-device-') === 0) return 'Device type icon. Shows in the Device table on /acquisition/devices.';
    if (key.indexOf('type-platform-') === 0) return 'Platform icon. Shows in the Device table on /acquisition/devices.';
    if (key.indexOf('type-browser-') === 0) return 'Browser icon. Shows in the Browser table on /acquisition/browsers.';
    if (key === 'diag-copy') return 'Diagnostics copy icon. Shows in the diagnostics panel on /settings.';
    if (key.indexOf('ads-status-') === 0 || key.indexOf('ads-actions-') === 0) return 'Ads integration status/action icon. Shows on /integrations/google-ads and /tools/ads.';
    if (key.indexOf('pagination-') === 0) return 'Pagination arrow icon. Shows in paginated cards/tables across dashboard and insights pages.';
    if (key.indexOf('card-title-') === 0) return 'Auto card-title icon. Added to matching card headers across dashboard, insights, acquisition, integrations, tools, and settings pages.';
    if (key === 'online-status-indicator') return 'Online visitors badge icon. Shows in the top strip header on all pages.';
    if (key === 'nav-notifications-bell') return 'Notifications bell. Shows in the top strip next to Settings and in the footer on all pages.';
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

  function iconGroupIdForName(name) {
    var key = String(name || '').trim().toLowerCase();
    if (!key) return 'misc';
    if (key.indexOf('admin-tab-') === 0 || key === 'nav-item-admin') return 'admin';
    if (key.indexOf('nav-toggle-') === 0 || key.indexOf('nav-item-') === 0 || key === 'topnav-date-chevron' || key === 'online-status-indicator' || key === 'nav-dropdown-arrow' || key === 'nav-notifications-bell') return 'header-nav';
    if (key.indexOf('footer-') === 0) return 'footer';
    if (key.indexOf('table-icon-') === 0 || key.indexOf('table-short-') === 0) return 'mobile-icons';
    if (key === 'table-builder-icon' || key === 'table-sticky-resize-handle') return 'tables';
    if (key.indexOf('card-title-') === 0 || key.indexOf('card-collapse-') === 0 || key.indexOf('dash-kpi-delta-') === 0 || key.indexOf('chart-type-') === 0 || key === 'chart-builder-icon') return 'cards';
    if (key.indexOf('side-panel-') === 0 || key.indexOf('kpi-compare-') === 0 || key.indexOf('pagination-') === 0 || key.indexOf('live-') === 0 || key.indexOf('breakdown-') === 0 || key.indexOf('type-device-') === 0 || key.indexOf('type-platform-') === 0 || key.indexOf('type-browser-') === 0 || key.indexOf('ads-') === 0 || key === 'diag-copy') return 'runtime';
    return 'misc';
  }

  function iconGroupLabel(groupId) {
    if (groupId === 'header-nav') return 'Header & Nav';
    if (groupId === 'footer') return 'Footer';
    if (groupId === 'mobile-icons') return 'Mobile icons';
    if (groupId === 'tables') return 'Tables';
    if (groupId === 'cards') return 'Cards & Charts';
    if (groupId === 'runtime') return 'Panels, Modals & Runtime';
    if (groupId === 'admin') return 'Admin';
    return 'Misc';
  }

  function buildGlyphAccordionHtml() {
    var groups = {};
    var keys = ICON_GLYPH_KEYS.slice();
    keys.sort(function (a, b) {
      var an = glyphNameFromThemeKey(a);
      var bn = glyphNameFromThemeKey(b);
      return an.localeCompare(bn);
    });
    keys.forEach(function (themeKey) {
      var name = glyphNameFromThemeKey(themeKey);
      var groupId = iconGroupIdForName(name);
      if (!groups[groupId]) groups[groupId] = [];
      groups[groupId].push(glyphInputCard(themeKey));
    });

    var order = ['header-nav', 'footer', 'mobile-icons', 'tables', 'cards', 'runtime', 'admin', 'misc'];
    var accordionId = 'theme-icons-accordion';
    var html = '<div class="accordion settings-layout-accordion" id="' + accordionId + '">';
    var itemIdx = 0;
    order.forEach(function (groupId) {
      var rows = groups[groupId] || [];
      if (!rows.length) return;
      var headingId = 'theme-icons-accordion-heading-' + groupId;
      var collapseId = 'theme-icons-accordion-collapse-' + groupId;
      var isOpen = itemIdx === 0;
      html += '' +
        '<div class="accordion-item">' +
          '<h2 class="accordion-header" id="' + headingId + '">' +
            '<button class="accordion-button' + (isOpen ? '' : ' collapsed') + '" type="button" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" aria-controls="' + collapseId + '">' +
              '<span class="d-flex align-items-center w-100 gap-2">' +
                '<span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span>' +
                '<span class="me-auto">' + iconGroupLabel(groupId) + '</span>' +
                '<span class="text-muted small">' + String(rows.length) + ' icons</span>' +
              '</span>' +
            '</button>' +
          '</h2>' +
          '<div id="' + collapseId + '" class="accordion-collapse collapse' + (isOpen ? ' show' : '') + '" aria-labelledby="' + headingId + '" data-bs-parent="#' + accordionId + '">' +
            '<div class="accordion-body"><div class="settings-responsive-grid" data-theme-icon-group-body="' + groupId + '">' + rows.join('') + '</div></div>' +
          '</div>' +
        '</div>';
      itemIdx += 1;
    });
    html += '</div>';
    return html;
  }

  function escapeHtml(value) {
    if (value == null) return '';
    var s = String(value);
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fetchObservedDevices(opts) {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    var minClicks = opts && typeof opts.minClicks === 'number' ? opts.minClicks : 2;
    var url = base + '/api/devices/observed?minClicks=' + encodeURIComponent(String(minClicks));
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function ensureDetectedDevicesAccordionItem(accordionEl, { groupId, label, insertBeforeId } = {}) {
    if (!accordionEl) return null;
    var gid = String(groupId || '').trim().toLowerCase();
    if (!gid) return null;
    var existingCollapse = accordionEl.querySelector('#theme-icons-accordion-collapse-' + gid);
    if (existingCollapse) {
      return existingCollapse.closest('.accordion-item');
    }

    var accordionId = accordionEl.getAttribute('id') || 'theme-icons-accordion';
    var headingId = 'theme-icons-accordion-heading-' + gid;
    var collapseId = 'theme-icons-accordion-collapse-' + gid;
    var title = label ? String(label) : 'Detected Devices';

    var html = '' +
      '<div class="accordion-item" data-theme-icon-group="' + gid + '">' +
        '<h2 class="accordion-header" id="' + headingId + '">' +
          '<button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" aria-expanded="false" aria-controls="' + collapseId + '">' +
            '<span class="d-flex align-items-center w-100 gap-2">' +
              '<span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span>' +
              '<span class="me-auto">' + escapeHtml(title) + '</span>' +
              '<span class="text-muted small" data-theme-icon-group-count="' + gid + '">0 icons</span>' +
            '</span>' +
          '</button>' +
        '</h2>' +
        '<div id="' + collapseId + '" class="accordion-collapse collapse" aria-labelledby="' + headingId + '" data-bs-parent="#' + accordionId + '">' +
          '<div class="accordion-body"><div class="settings-responsive-grid" data-theme-icon-group-body="' + gid + '"></div></div>' +
        '</div>' +
      '</div>';

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var item = wrap.firstElementChild;
    if (!item) return null;

    var beforeNode = null;
    if (insertBeforeId) {
      var target = accordionEl.querySelector('#' + String(insertBeforeId));
      beforeNode = target ? target.closest('.accordion-item') : null;
    }
    if (beforeNode) accordionEl.insertBefore(item, beforeNode);
    else accordionEl.appendChild(item);
    return item;
  }

  function updateThemeIconsAccordionCounts(accordionEl) {
    if (!accordionEl) return;
    accordionEl.querySelectorAll('.accordion-item').forEach(function (item) {
      var body = item.querySelector('.accordion-body .settings-responsive-grid');
      if (!body) return;
      var n = body.querySelectorAll(
        '[data-theme-icon-glyph-card]:not([data-theme-icon-count-exclude="1"]),' +
        '[data-payment-method-icon-card]:not([data-theme-icon-count-exclude="1"]),' +
        '[data-variant-rule-icon-card]:not([data-theme-icon-count-exclude="1"]),' +
        '[data-attribution-icon]:not([data-theme-icon-count-exclude="1"])'
      ).length;
      var countEl = item.querySelector('[data-theme-icon-group-count]') || item.querySelector('.accordion-header .text-muted.small');
      if (countEl) countEl.textContent = String(n) + ' icons';
    });
  }

  function hydrateDetectedDevicesIconGroup(root) {
    // Best-effort: dynamically move detected device/platform icon cards into a dedicated accordion group.
    // This avoids re-rendering (so unsaved edits in textareas are preserved).
    if (!root) return;
    var accordion = root.querySelector ? root.querySelector('#theme-icons-accordion') : null;
    if (!accordion) return;
    if (accordion.getAttribute('data-detected-devices-hydrate') === '1') return;
    accordion.setAttribute('data-detected-devices-hydrate', '1');

    function platformIconKeyFor(p) {
      var v = String(p || '').trim().toLowerCase();
      if (v === 'ios') return 'type-platform-ios';
      if (v === 'mac') return 'type-platform-mac';
      if (v === 'android') return 'type-platform-android';
      if (v === 'windows') return 'type-platform-windows';
      if (v === 'chromeos') return 'type-platform-chromeos';
      if (v === 'linux') return 'type-platform-linux';
      return 'type-platform-unknown';
    }
    function deviceIconKeyFor(d) {
      var v = String(d || '').trim().toLowerCase();
      if (v === 'desktop' || v === 'mobile' || v === 'tablet') return 'type-device-' + v;
      return 'type-device-unknown';
    }

    fetchObservedDevices({ minClicks: 2 }).then(function (data) {
      if (!data || data.ok !== true) return;
      var iconKeys = [];
      var seen = {};
      function add(k) {
        var kk = String(k || '').trim().toLowerCase();
        if (!kk || seen[kk]) return;
        seen[kk] = true;
        iconKeys.push(kk);
      }
      (Array.isArray(data.ua_device_type) ? data.ua_device_type : []).forEach(function (r) { add(deviceIconKeyFor(r && r.key)); });
      (Array.isArray(data.ua_platform) ? data.ua_platform : []).forEach(function (r) { add(platformIconKeyFor(r && r.key)); });
      if (!iconKeys.length) return;

      var item = ensureDetectedDevicesAccordionItem(accordion, {
        groupId: 'detected-devices',
        label: 'Detected Devices',
        insertBeforeId: 'theme-icons-accordion-collapse-runtime',
      });
      if (!item) return;
      var body = item.querySelector('[data-theme-icon-group-body="detected-devices"]');
      if (!body) return;

      iconKeys.forEach(function (iconKey) {
        var themeKey = 'theme-icon-glyph-' + iconKey;
        var input = root.querySelector('[data-theme-icon-glyph-input="' + themeKey + '"]');
        if (!input) return;
        var card = input.closest('[data-theme-icon-glyph-card]');
        if (!card) return;
        body.appendChild(card);
      });

      updateThemeIconsAccordionCounts(accordion);
    });
  }

  function ensureAttributionAccordionItem(accordionEl, opts) {
    var groupId = String((opts && opts.groupId) || 'attribution').trim().toLowerCase();
    var label = (opts && opts.label) ? String(opts.label) : 'Attribution';
    var insertBeforeId = opts && opts.insertBeforeId ? String(opts.insertBeforeId) : null;
    if (!accordionEl || !groupId) return null;
    var existingCollapse = accordionEl.querySelector('#theme-icons-accordion-collapse-' + groupId);
    if (existingCollapse) return existingCollapse.closest('.accordion-item');
    var accordionId = accordionEl.getAttribute('id') || 'theme-icons-accordion';
    var headingId = 'theme-icons-accordion-heading-' + groupId;
    var collapseId = 'theme-icons-accordion-collapse-' + groupId;
    var html = '' +
      '<div class="accordion-item" data-theme-icon-group="' + groupId + '">' +
        '<h2 class="accordion-header" id="' + headingId + '">' +
          '<button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#' + collapseId + '" aria-expanded="false" aria-controls="' + collapseId + '">' +
            '<span class="d-flex align-items-center w-100 gap-2">' +
              '<span class="kexo-settings-accordion-chevron" aria-hidden="true"><i class="fa-regular fa-chevron-down" aria-hidden="true"></i></span>' +
              '<span class="me-auto">' + escapeHtml(label) + '</span>' +
              '<span class="text-muted small" data-theme-icon-group-count="' + groupId + '">0 icons</span>' +
            '</span>' +
          '</button>' +
        '</h2>' +
        '<div id="' + collapseId + '" class="accordion-collapse collapse" aria-labelledby="' + headingId + '" data-bs-parent="#' + accordionId + '">' +
          '<div class="accordion-body"><div class="settings-responsive-grid" data-theme-icon-group-body="' + groupId + '"></div></div>' +
        '</div>' +
      '</div>';
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var item = wrap.firstElementChild;
    if (!item) return null;
    var beforeNode = insertBeforeId ? accordionEl.querySelector('#' + insertBeforeId) && accordionEl.querySelector('#' + insertBeforeId).closest('.accordion-item') : null;
    if (beforeNode) accordionEl.insertBefore(item, beforeNode);
    else accordionEl.appendChild(item);
    return item;
  }

  function fetchAttributionConfig() {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    return fetch(base + '/api/attribution/config', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function saveAttributionIcons(payload) {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    return fetch(base + '/api/attribution/icons', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (r && r.ok) return body;
          return { ok: false, status: r && r.status, error: (body && body.error) || (r && r.status === 403 ? 'Admin only' : 'Request failed') };
        });
      })
      .catch(function () { return { ok: false, status: 0, error: 'Request failed' }; });
  }

  function titleFromKey(key) {
    var s = String(key || '').trim();
    if (!s) return 'Unknown';
    return s.replace(/[:_ -]+/g, ' ').trim().split(/\s+/g).filter(Boolean)
      .map(function (w) { return w.slice(0, 1).toUpperCase() + w.slice(1); }).join(' ');
  }

  function attributionIconSpecToPreviewHtml(spec, label) {
    var s = spec != null ? String(spec).trim() : '';
    var l = label != null ? String(label).trim() : '';
    if (!s) return '<span class="text-muted small">—</span>';
    if (/^<svg[\s>]/i.test(s)) {
      var safeSvg = sanitizeSvgMarkup(s);
      if (!safeSvg) return '<span class="text-muted small">—</span>';
      return '<span title="' + escapeHtml(l) + '">' + safeSvg + '</span>';
    }
    if (/^(https?:\/\/|\/\/|\/)/i.test(s)) return '<img src="' + escapeHtml(s) + '" alt="" title="' + escapeHtml(l) + '">';
    return '<i class="' + escapeHtml(s) + '" aria-hidden="true" title="' + escapeHtml(l) + '"></i>';
  }

  function saveAssetOverridesPatch(patch) {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    return fetch(base + '/api/settings', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetOverrides: patch || {} }),
    })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (r && r.ok) return body || { ok: true };
          return { ok: false, status: r && r.status, error: (body && body.error) || (r && r.status === 403 ? 'Admin only' : 'Request failed') };
        });
      })
      .catch(function () { return { ok: false, status: 0, error: 'Request failed' }; });
  }

  function fetchPaymentMethodsCatalog() {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    return fetch(base + '/api/payment-methods/catalog', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function fetchSettingsPayloadForIconGroups() {
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    return fetch(base + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function keySlugPart(raw) {
    var s = raw != null ? String(raw).trim().toLowerCase() : '';
    if (!s) return '';
    return s.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function buildVariantRuleIconRows(payload) {
    var cfg = payload && payload.insightsVariantsConfig && typeof payload.insightsVariantsConfig === 'object'
      ? payload.insightsVariantsConfig
      : {};
    var tables = Array.isArray(cfg.tables) ? cfg.tables : [];
    var overrides = payload && payload.assetOverrides && typeof payload.assetOverrides === 'object'
      ? payload.assetOverrides
      : {};
    var rows = [];
    tables.forEach(function (t) {
      var tableId = keySlugPart(t && t.id != null ? t.id : '');
      if (!tableId) return;
      var tableName = t && t.name != null ? String(t.name) : titleFromKey(tableId);
      var rules = Array.isArray(t && t.rules) ? t.rules : [];
      rules.forEach(function (rule) {
        var ruleId = keySlugPart(rule && rule.id != null ? rule.id : '');
        if (!ruleId) return;
        var ruleLabel = rule && rule.label != null ? String(rule.label).trim() : '';
        var label = tableName + ' / ' + (ruleLabel || titleFromKey(ruleId));
        var overrideKey = 'variant_rule_' + tableId + '__' + ruleId;
        rows.push({
          overrideKey: overrideKey,
          label: label,
          iconSpec: overrides[overrideKey] != null ? String(overrides[overrideKey]) : '',
        });
      });
    });
    rows.sort(function (a, b) { return String(a.label || '').localeCompare(String(b.label || '')); });
    return rows;
  }

  function hydratePaymentMethodsIconGroup(root) {
    if (!root) return;
    var accordion = root.querySelector('#theme-icons-accordion');
    if (!accordion) return;
    var item = ensureAttributionAccordionItem(accordion, {
      groupId: 'payment-methods',
      label: 'Payment Methods',
      insertBeforeId: 'theme-icons-accordion-collapse-attribution',
    });
    if (!item) return;
    var body = item.querySelector('[data-theme-icon-group-body="payment-methods"]');
    if (!body) return;
    body.innerHTML = '<div class="settings-responsive-grid-span-all"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading payment methods…</div>';
    fetchPaymentMethodsCatalog().then(function (res) {
      if (!res || !res.ok || !Array.isArray(res.methods)) {
        body.innerHTML = '<div class="settings-responsive-grid-span-all text-secondary small">Could not load payment methods.</div>';
        return;
      }
      var cards = [];
      cards.push(
        '<div class="settings-responsive-grid-span-all" data-theme-icon-count-exclude="1">' +
          '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">' +
            '<h4 class="mb-0">Payment Methods</h4>' +
            '<span class="text-secondary small">Auto-seeded from common methods + what appears in purchases</span>' +
          '</div>' +
        '</div>'
      );
      res.methods.forEach(function (m) {
        var key = m && m.key != null ? String(m.key).trim() : '';
        if (!key) return;
        var label = m && m.label != null ? String(m.label).trim() : titleFromKey(key);
        var hasSaved = !!(m && m.iconSpec != null && String(m.iconSpec).trim());
        cards.push(
          '<div class="kexo-theme-grid-item" data-payment-method-icon-card="1" data-payment-key="' + escapeHtml(key) + '" data-payment-label="' + escapeHtml(label) + '">' +
            '<div class="card card-sm h-100">' +
              '<div class="card-body">' +
                '<div class="d-flex align-items-center mb-2">' +
                  '<span class="theme-icons-attribution-preview me-2 d-inline-flex align-items-center justify-content-center" style="width:1.5rem;height:1.5rem;" data-payment-icon-preview="1" aria-hidden="true"></span>' +
                  '<strong class="me-auto">' + escapeHtml(label) + '</strong>' +
                  (hasSaved ? '<span class="badge bg-azure-lt text-azure">Saved</span>' : '') +
                '</div>' +
                '<div class="text-secondary small mb-2"><code>payment_' + escapeHtml(key) + '</code></div>' +
                '<textarea class="form-control form-control-sm payment-icon-input font-monospace" rows="2" spellcheck="false" placeholder="fa-brands fa-cc-visa  OR  https://...svg  OR  <svg ...>">' + escapeHtml(m && m.iconSpec != null ? String(m.iconSpec) : '') + '</textarea>' +
                '<div class="form-hint small mt-1">Starts blank intentionally. Paste Font Awesome, image URL/path, or SVG markup.</div>' +
                '<div class="d-flex align-items-center gap-2 mt-2">' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-edit payment-icon-edit" data-theme-icon-edit="payment-method-' + escapeHtml(key) + '" aria-label="Edit">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-edit-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-save payment-icon-save" aria-label="Save">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-save-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<span class="small text-secondary ms-auto" data-payment-icon-msg="1"></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      });

      body.innerHTML = cards.join('');
      function updatePreview(cardEl) {
        if (!cardEl) return;
        var input = cardEl.querySelector('.payment-icon-input');
        var preview = cardEl.querySelector('[data-payment-icon-preview]');
        if (!input || !preview) return;
        var label = cardEl.getAttribute('data-payment-label') || '';
        preview.innerHTML = attributionIconSpecToPreviewHtml(input.value, label);
      }
      body.querySelectorAll('[data-payment-method-icon-card]').forEach(function (cardEl) { updatePreview(cardEl); });
      if (body.getAttribute('data-payment-icon-wired') !== '1') {
        body.setAttribute('data-payment-icon-wired', '1');
        body.addEventListener('input', function (e) {
          var target = e && e.target ? e.target : null;
          var input = target && target.closest ? target.closest('.payment-icon-input') : null;
          if (!input) return;
          var cardEl = input.closest ? input.closest('[data-payment-method-icon-card]') : null;
          if (!cardEl) return;
          updatePreview(cardEl);
          var msgEl = cardEl.querySelector('[data-payment-icon-msg]');
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'small text-secondary ms-auto';
          }
        });
        body.addEventListener('click', function (e) {
          var target = e && e.target ? e.target : null;
          var btn = target && target.closest ? target.closest('.payment-icon-save') : null;
          if (!btn) return;
          e.preventDefault();
          if (btn.disabled) return;
          var cardEl = btn.closest('[data-payment-method-icon-card]');
          if (!cardEl) return;
          var key = cardEl.getAttribute('data-payment-key') || '';
          if (!key) return;
          var input = cardEl.querySelector('.payment-icon-input');
          var msgEl = cardEl.querySelector('[data-payment-icon-msg]');
          var spec = input ? String(input.value || '').trim() : '';
          var patch = {};
          patch['payment_' + key] = spec || '';
          var isIconOnly = btn.classList.contains('kexo-icon-action-save');
          var originalText = isIconOnly ? '' : (btn.textContent || 'Save');
          btn.disabled = true;
          if (!isIconOnly) btn.textContent = 'Saving…';
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'small text-secondary ms-auto';
          }
          saveAssetOverridesPatch(patch).then(function (saveRes) {
            if (saveRes && saveRes.ok) {
              if (!isIconOnly) {
                btn.textContent = 'Saved!';
btn.classList.remove('btn-md');
          btn.classList.add('btn-success');
              }
              if (msgEl) {
                msgEl.textContent = 'Saved';
                msgEl.className = 'small text-success ms-auto';
              }
              try { window.dispatchEvent(new CustomEvent('kexo:payment-icons-updated')); } catch (_) {}
            } else {
              if (!isIconOnly) {
                btn.textContent = 'Save failed';
btn.classList.remove('btn-md');
              btn.classList.add('btn-danger');
              }
              if (msgEl) {
                msgEl.textContent = (saveRes && saveRes.error) ? String(saveRes.error) : 'Save failed';
                msgEl.className = 'small text-danger ms-auto';
              }
              setTimeout(function () {
                if (!isIconOnly) {
                  btn.textContent = originalText;
btn.classList.remove('btn-danger');
                btn.classList.add('btn-md');
                }
                btn.disabled = false;
              }, 1800);
              return;
            }
            setTimeout(function () {
              if (!isIconOnly) {
                btn.textContent = originalText;
btn.classList.remove('btn-success');
            btn.classList.add('btn-md');
              }
              btn.disabled = false;
            }, 1200);
          });
        });
      }
      updateThemeIconsAccordionCounts(accordion);
    });
  }

  function hydrateVariantsIconGroup(root) {
    if (!root) return;
    var accordion = root.querySelector('#theme-icons-accordion');
    if (!accordion) return;
    var item = ensureAttributionAccordionItem(accordion, {
      groupId: 'variants',
      label: 'Variants',
      insertBeforeId: 'theme-icons-accordion-collapse-attribution',
    });
    if (!item) return;
    var body = item.querySelector('[data-theme-icon-group-body="variants"]');
    if (!body) return;
    body.innerHTML = '<div class="settings-responsive-grid-span-all"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading variants…</div>';
    fetchSettingsPayloadForIconGroups().then(function (payload) {
      var rows = buildVariantRuleIconRows(payload);
      if (!rows.length) {
        body.innerHTML = '<div class="settings-responsive-grid-span-all text-secondary small">No variant rules found yet. Configure tables in Settings → Variants.</div>';
        return;
      }
      var cards = [];
      cards.push(
        '<div class="settings-responsive-grid-span-all" data-theme-icon-count-exclude="1">' +
          '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">' +
            '<h4 class="mb-0">Variant Rule Icons</h4>' +
            '<span class="text-secondary small">Applies to Insights → Variants and Overview finishes widget</span>' +
          '</div>' +
        '</div>'
      );
      rows.forEach(function (row) {
        cards.push(
          '<div class="kexo-theme-grid-item" data-variant-rule-icon-card="1" data-variant-override-key="' + escapeHtml(row.overrideKey) + '" data-variant-label="' + escapeHtml(row.label) + '">' +
            '<div class="card card-sm h-100">' +
              '<div class="card-body">' +
                '<div class="d-flex align-items-center mb-2">' +
                  '<span class="theme-icons-attribution-preview me-2 d-inline-flex align-items-center justify-content-center" style="width:1.5rem;height:1.5rem;" data-variant-rule-icon-preview="1" aria-hidden="true"></span>' +
                  '<strong class="me-auto">' + escapeHtml(row.label) + '</strong>' +
                '</div>' +
                '<div class="text-secondary small mb-2"><code>' + escapeHtml(row.overrideKey) + '</code></div>' +
                '<textarea class="form-control form-control-sm variant-rule-icon-input font-monospace" rows="2" spellcheck="false" placeholder="fa-light fa-gem  OR  https://...svg  OR  <svg ...>">' + escapeHtml(row.iconSpec || '') + '</textarea>' +
                '<div class="form-hint small mt-1">Save a unique icon per variant rule row.</div>' +
                '<div class="d-flex align-items-center gap-2 mt-2">' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-edit variant-rule-icon-edit" data-theme-icon-edit="' + escapeHtml(row.overrideKey) + '" aria-label="Edit">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-edit-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-save variant-rule-icon-save" aria-label="Save">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-save-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<span class="small text-secondary ms-auto" data-variant-rule-icon-msg="1"></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      });
      body.innerHTML = cards.join('');
      function updatePreview(cardEl) {
        if (!cardEl) return;
        var input = cardEl.querySelector('.variant-rule-icon-input');
        var preview = cardEl.querySelector('[data-variant-rule-icon-preview]');
        if (!input || !preview) return;
        var label = cardEl.getAttribute('data-variant-label') || '';
        preview.innerHTML = attributionIconSpecToPreviewHtml(input.value, label);
      }
      body.querySelectorAll('[data-variant-rule-icon-card]').forEach(function (cardEl) { updatePreview(cardEl); });
      if (body.getAttribute('data-variant-rule-icon-wired') !== '1') {
        body.setAttribute('data-variant-rule-icon-wired', '1');
        body.addEventListener('input', function (e) {
          var target = e && e.target ? e.target : null;
          var input = target && target.closest ? target.closest('.variant-rule-icon-input') : null;
          if (!input) return;
          var cardEl = input.closest ? input.closest('[data-variant-rule-icon-card]') : null;
          if (!cardEl) return;
          updatePreview(cardEl);
          var msgEl = cardEl.querySelector('[data-variant-rule-icon-msg]');
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'small text-secondary ms-auto';
          }
        });
        body.addEventListener('click', function (e) {
          var target = e && e.target ? e.target : null;
          var btn = target && target.closest ? target.closest('.variant-rule-icon-save') : null;
          if (!btn) return;
          e.preventDefault();
          if (btn.disabled) return;
          var cardEl = btn.closest('[data-variant-rule-icon-card]');
          if (!cardEl) return;
          var overrideKey = cardEl.getAttribute('data-variant-override-key') || '';
          if (!overrideKey) return;
          var input = cardEl.querySelector('.variant-rule-icon-input');
          var msgEl = cardEl.querySelector('[data-variant-rule-icon-msg]');
          var spec = input ? String(input.value || '').trim() : '';
          var patch = {};
          patch[overrideKey] = spec || '';
          var isIconOnly = btn.classList.contains('kexo-icon-action-save');
          var originalText = isIconOnly ? '' : (btn.textContent || 'Save');
          btn.disabled = true;
          if (!isIconOnly) btn.textContent = 'Saving…';
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'small text-secondary ms-auto';
          }
          saveAssetOverridesPatch(patch).then(function (saveRes) {
            if (saveRes && saveRes.ok) {
              if (!isIconOnly) {
                btn.textContent = 'Saved!';
btn.classList.remove('btn-md');
          btn.classList.add('btn-success');
              }
              if (msgEl) {
                msgEl.textContent = 'Saved';
                msgEl.className = 'small text-success ms-auto';
              }
              try { window.dispatchEvent(new CustomEvent('kexo:variants-icons-updated')); } catch (_) {}
            } else {
              if (!isIconOnly) {
                btn.textContent = 'Save failed';
btn.classList.remove('btn-md');
              btn.classList.add('btn-danger');
              }
              if (msgEl) {
                msgEl.textContent = (saveRes && saveRes.error) ? String(saveRes.error) : 'Save failed';
                msgEl.className = 'small text-danger ms-auto';
              }
              setTimeout(function () {
                if (!isIconOnly) {
                  btn.textContent = originalText;
btn.classList.remove('btn-danger');
                btn.classList.add('btn-md');
                }
                btn.disabled = false;
              }, 1800);
              return;
            }
            setTimeout(function () {
              if (!isIconOnly) {
                btn.textContent = originalText;
btn.classList.remove('btn-success');
            btn.classList.add('btn-md');
              }
              btn.disabled = false;
            }, 1200);
          });
        });
      }
      updateThemeIconsAccordionCounts(accordion);
    });
  }

  function hydrateAttributionIconGroup(root) {
    if (!root) return;
    var accordion = root.querySelector('#theme-icons-accordion');
    if (!accordion) return;
    var item = ensureAttributionAccordionItem(accordion, {
      groupId: 'attribution',
      label: 'Attribution',
      insertBeforeId: 'theme-icons-accordion-collapse-misc',
    });
    if (!item) return;
    var body = item.querySelector('[data-theme-icon-group-body="attribution"]');
    if (!body) return;
    body.innerHTML = '<div class="settings-responsive-grid-span-all"><div class="spinner-border spinner-border-sm text-primary" role="status"></div> Loading attribution…</div>';
    fetchAttributionConfig().then(function (res) {
      if (!res || !res.ok || !res.config) {
        body.innerHTML = '<div class="settings-responsive-grid-span-all text-secondary small">Could not load attribution config.</div>';
        return;
      }
      var rawSources = Array.isArray(res.config.sources) ? res.config.sources : [];
      var rawVariants = Array.isArray(res.config.variants) ? res.config.variants : [];

      var sourcesByKey = {}; // lower -> { key, label, icon_spec }
      function upsertSourceRow(key, label, iconSpec) {
        var rawKey = String(key || '').trim();
        if (!rawKey) return;
        var lk = rawKey.toLowerCase();
        if (!lk) return;
        var row = sourcesByKey[lk];
        if (row) {
          var l = label != null ? String(label).trim() : '';
          var i = iconSpec != null ? String(iconSpec) : '';
          if (l && (!row.label || row.label === row.key)) row.label = l;
          if (i && !row.icon_spec) row.icon_spec = i;
          return;
        }
        sourcesByKey[lk] = {
          key: rawKey,
          label: (label != null && String(label).trim()) ? String(label).trim() : titleFromKey(rawKey),
          icon_spec: iconSpec != null ? String(iconSpec) : '',
        };
      }

      rawSources.forEach(function (r) {
        var key = (r && r.source_key != null) ? String(r.source_key) : (r && r.key != null) ? String(r.key) : '';
        if (!key) return;
        upsertSourceRow(key, (r && r.label != null) ? String(r.label) : '', (r && r.icon_spec != null) ? String(r.icon_spec) : '');
      });
      rawVariants.forEach(function (r) {
        var sk = (r && r.source_key != null) ? String(r.source_key) : '';
        if (!sk) return;
        upsertSourceRow(sk, '', '');
      });

      var sources = Object.keys(sourcesByKey).map(function (k) { return sourcesByKey[k]; });
      sources.sort(function (a, b) { return String(a.label || a.key).localeCompare(String(b.label || b.key)); });

      var variants = [];
      rawVariants.forEach(function (r) {
        var key = (r && r.variant_key != null) ? String(r.variant_key) : (r && r.key != null) ? String(r.key) : '';
        if (!key) return;
        variants.push({
          key: key,
          label: (r && r.label != null) ? String(r.label) : titleFromKey(key),
          icon_spec: (r && r.icon_spec != null) ? String(r.icon_spec) : '',
        });
      });
      variants.sort(function (a, b) { return String(a.label || a.key).localeCompare(String(b.label || b.key)); });

      var cards = [];
      if (sources.length) {
        cards.push(
          '<div class="settings-responsive-grid-span-all" data-theme-icon-count-exclude="1">' +
            '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">' +
              '<h4 class="mb-0">Attribution Sources</h4>' +
              '<span class="text-secondary small">Syncs with Settings → Attribution → Mapped tree</span>' +
            '</div>' +
          '</div>'
        );
        sources.forEach(function (r) {
          var key = r.key;
          var label = r.label || key || '—';
          var icon = r.icon_spec != null ? String(r.icon_spec) : '';
          if (!key) return;
          cards.push('<div class="kexo-theme-grid-item" data-attribution-icon="source" data-attribution-key="' + escapeHtml(key) + '" data-attribution-label="' + escapeHtml(label) + '">' +
            '<div class="card card-sm h-100">' +
              '<div class="card-body">' +
                '<div class="d-flex align-items-center mb-2">' +
                  '<span class="theme-icons-attribution-preview me-2 d-inline-flex align-items-center justify-content-center" style="width:1.5rem;height:1.5rem;" data-attribution-icon-preview="1" aria-hidden="true"></span>' +
                  '<strong class="me-auto">Source: ' + escapeHtml(label) + '</strong>' +
                '</div>' +
                '<div class="text-secondary small mb-2"><code>' + escapeHtml(key) + '</code></div>' +
                '<textarea class="form-control form-control-sm attribution-icon-input font-monospace" data-kind="source" data-key="' + escapeHtml(key) + '" rows="2" spellcheck="false" placeholder="fa-brands fa-google  OR  /assets/icon.png  OR  <svg ...>">' + escapeHtml(icon) + '</textarea>' +
                '<div class="form-hint small mt-1">Font Awesome class, image URL/path, or inline SVG. Blank clears the icon.</div>' +
                '<div class="d-flex align-items-center gap-2 mt-2">' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-edit attribution-icon-edit" data-kind="source" data-key="' + escapeHtml(key) + '" data-theme-icon-edit="attribution-source-' + escapeHtml(key) + '" aria-label="Edit">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-edit-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-save attribution-icon-save" data-kind="source" data-key="' + escapeHtml(key) + '" aria-label="Save">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-save-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<span class="small text-secondary ms-auto" data-attribution-icon-msg="1"></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>');
        });
      }
      if (variants.length) {
        cards.push(
          '<div class="settings-responsive-grid-span-all mt-2" data-theme-icon-count-exclude="1">' +
            '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2">' +
              '<h4 class="mb-0">Attribution Variants</h4>' +
              '<span class="text-secondary small">Syncs with Settings → Attribution → Mapped tree</span>' +
            '</div>' +
          '</div>'
        );
        variants.forEach(function (r) {
          var key = r.key;
          var label = r.label || key || '—';
          var icon = r.icon_spec != null ? String(r.icon_spec) : '';
          if (!key) return;
          cards.push('<div class="kexo-theme-grid-item" data-attribution-icon="variant" data-attribution-key="' + escapeHtml(key) + '" data-attribution-label="' + escapeHtml(label) + '">' +
            '<div class="card card-sm h-100">' +
              '<div class="card-body">' +
                '<div class="d-flex align-items-center mb-2">' +
                  '<span class="theme-icons-attribution-preview me-2 d-inline-flex align-items-center justify-content-center" style="width:1.5rem;height:1.5rem;" data-attribution-icon-preview="1" aria-hidden="true"></span>' +
                  '<strong class="me-auto">Variant: ' + escapeHtml(label) + '</strong>' +
                '</div>' +
                '<div class="text-secondary small mb-2"><code>' + escapeHtml(key) + '</code></div>' +
                '<textarea class="form-control form-control-sm attribution-icon-input font-monospace" data-kind="variant" data-key="' + escapeHtml(key) + '" rows="2" spellcheck="false" placeholder="fa-solid fa-bolt  OR  /assets/icon.png  OR  <svg ...>">' + escapeHtml(icon) + '</textarea>' +
                '<div class="form-hint small mt-1">Font Awesome class, image URL/path, or inline SVG. Blank clears the icon.</div>' +
                '<div class="d-flex align-items-center gap-2 mt-2">' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-edit attribution-icon-edit" data-kind="variant" data-key="' + escapeHtml(key) + '" data-theme-icon-edit="attribution-variant-' + escapeHtml(key) + '" aria-label="Edit">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-edit-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<button type="button" class="kexo-icon-action-btn kexo-icon-action-save attribution-icon-save" data-kind="variant" data-key="' + escapeHtml(key) + '" aria-label="Save">' +
                    '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-save-icon" aria-hidden="true"></span>' +
                  '</button>' +
                  '<span class="small text-secondary ms-auto" data-attribution-icon-msg="1"></span>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>');
        });
      }

      body.innerHTML = cards.length ? cards.join('') : '<div class="settings-responsive-grid-span-all text-secondary small">No sources or variants yet. Add them in Settings → Attribution → Mapping.</div>';

      function updateCardPreview(cardEl) {
        if (!cardEl) return;
        var input = cardEl.querySelector('.attribution-icon-input');
        var preview = cardEl.querySelector('[data-attribution-icon-preview]');
        if (!input || !preview) return;
        var label = cardEl.getAttribute('data-attribution-label') || '';
        preview.innerHTML = attributionIconSpecToPreviewHtml(input.value, label);
      }

      body.querySelectorAll('[data-attribution-icon]').forEach(function (cardEl) { updateCardPreview(cardEl); });
      if (body.getAttribute('data-attribution-icon-wired') !== '1') {
        body.setAttribute('data-attribution-icon-wired', '1');

        body.addEventListener('input', function (e) {
          var target = e && e.target ? e.target : null;
          var input = target && target.closest ? target.closest('.attribution-icon-input') : null;
          if (!input) return;
          var cardEl = input.closest ? input.closest('[data-attribution-icon]') : null;
          if (!cardEl) return;
          updateCardPreview(cardEl);
          var msgEl = cardEl.querySelector('[data-attribution-icon-msg]');
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'small text-secondary ms-auto';
          }
        });

        body.addEventListener('click', function (e) {
          var target = e && e.target ? e.target : null;
          var btn = target && target.closest ? target.closest('.attribution-icon-save') : null;
          if (!btn) return;
          e.preventDefault();
          if (btn.disabled) return;
          var kind = btn.getAttribute('data-kind');
          var key = btn.getAttribute('data-key');
          var cardEl = btn.closest('[data-attribution-icon]');
          var input = cardEl ? cardEl.querySelector('.attribution-icon-input') : null;
          var msgEl = cardEl ? cardEl.querySelector('[data-attribution-icon-msg]') : null;
          var spec = input ? String(input.value || '').trim() : '';
          var payload = kind === 'source' ? { sources: [{ source_key: key, icon_spec: spec || null }] } : { variants: [{ variant_key: key, icon_spec: spec || null }] };

          var isIconOnly = btn.classList.contains('kexo-icon-action-save');
          var originalText = isIconOnly ? '' : (btn.textContent || 'Save');
          btn.disabled = true;
          if (!isIconOnly) btn.textContent = 'Saving…';
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'small text-secondary ms-auto';
          }
          saveAttributionIcons(payload).then(function (res2) {
            if (res2 && res2.ok) {
              if (!isIconOnly) {
                btn.textContent = 'Saved!';
btn.classList.remove('btn-md');
          btn.classList.add('btn-success');
              }
              if (msgEl) {
                msgEl.textContent = 'Saved';
                msgEl.className = 'small text-success ms-auto';
              }
              setTimeout(function () {
                try { window.dispatchEvent(new CustomEvent('kexo:attribution-icons-updated')); } catch (_) {}
              }, 350);
            } else {
              if (!isIconOnly) {
                btn.textContent = 'Save failed';
btn.classList.remove('btn-md');
              btn.classList.add('btn-danger');
              }
              if (msgEl) {
                msgEl.textContent = (res2 && res2.error) ? String(res2.error) : 'Save failed';
                msgEl.className = 'small text-danger ms-auto';
              }
              setTimeout(function () {
                if (!isIconOnly) {
                  btn.textContent = originalText;
btn.classList.remove('btn-danger');
                btn.classList.add('btn-md');
                }
                btn.disabled = false;
              }, 1800);
              return;
            }
            setTimeout(function () {
              if (!isIconOnly) {
                btn.textContent = originalText;
btn.classList.remove('btn-success');
            btn.classList.add('btn-md');
              }
              btn.disabled = false;
            }, 1200);
          });
        });
      }

      updateThemeIconsAccordionCounts(accordion);
    });
  }

  function buildIconEditModalHtml() {
    return '' +
      '<div class="modal fade" id="theme-icon-edit-modal" tabindex="-1" aria-hidden="true">' +
        '<div class="modal-dialog">' +
          '<div class="modal-content">' +
            '<div class="modal-header">' +
              '<h3 class="modal-title h5">Edit icon overrides</h3>' +
              '<button type="button" class="btn-close" data-bs-dismiss="modal" data-theme-icon-edit-close aria-label="Close"></button>' +
            '</div>' +
            '<div class="modal-body">' +
              '<div class="text-secondary small mb-3" id="theme-icon-edit-target">Set optional size and color overrides for this icon. Leave blank to use global defaults.</div>' +
              '<div class="mb-3">' +
                '<label class="form-label" for="theme-icon-edit-size">Size override</label>' +
                '<input type="text" class="form-control" id="theme-icon-edit-size" placeholder="e.g. 1em, 14px">' +
              '</div>' +
              '<div class="mb-0">' +
                '<label class="form-label" for="theme-icon-edit-color">Color override</label>' +
                '<input type="text" class="form-control" id="theme-icon-edit-color" placeholder="e.g. #ffffff, currentColor">' +
              '</div>' +
              '<input type="hidden" id="theme-icon-edit-key" value="">' +
            '</div>' +
            '<div class="modal-footer d-flex align-items-center flex-wrap gap-2">' +
              '<span class="small text-secondary me-auto" id="theme-icon-edit-msg" aria-live="polite"></span>' +
              '<button type="button" class="btn btn-md" id="theme-icon-edit-clear">Clear</button>' +
              '<button type="button" class="btn btn-primary btn-md" id="theme-icon-edit-save">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
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
        root.style.setProperty('--kexo-top-menu-dropdown-bg', derived);
      }
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
    } else if (key === ICON_OVERRIDES_JSON_KEY) {
      triggerIconThemeRefresh();
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

  // Fetch server defaults and optionally apply to the DOM.
  // On non-settings pages we sync localStorage without re-theming the page to avoid colour flashes.
  function fetchDefaults(opts) {
    var shouldApply = !(opts && opts.apply === false);
    var shouldSyncUI = shouldApply || !!(opts && opts.syncUI === true);
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        var mode = 'global';
        setStored('theme-preference-mode', mode);
        if (shouldApply) applyTheme('theme-preference-mode', mode);
        var legacyPrimary = data.theme_primary || getStored('theme-primary');
        if (legacyPrimary && ACCENT_HEX_KEYS.indexOf('theme-accent-1') >= 0) {
          var legacyMap = { blue: '#4b94e4', teal: '#3eb3ab', orange: '#f59e34', green: '#3eb3ab' };
          var migrated = legacyMap[String(legacyPrimary).trim().toLowerCase()] || ACCENT_DEFAULTS[0];
          setStored('theme-accent-1', migrated);
          if (shouldApply) applyTheme('theme-accent-1', migrated);
        }
        KEYS.forEach(function (key) {
          if (key === 'theme-preference-mode') return;
          var dbKey = key.replace(/-/g, '_');
          // If the server no longer provides this key (e.g. legacy header color keys migrated to css_var_overrides_v1),
          // do not write defaults into localStorage and do not apply DOM overrides. The page should follow /theme-vars.css.
          var hasDbProp = Object.prototype.hasOwnProperty.call(data, dbKey);
          var hasKeyProp = Object.prototype.hasOwnProperty.call(data, key);
          if (!hasDbProp && !hasKeyProp) return;
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
          if (shouldApply) applyTheme(key, serverVal || DEFAULTS[key]);
        });
        if (shouldSyncUI) syncUI();
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
      if (ACCENT_HEX_KEYS.indexOf(key) >= 0) {
        var hex = normalizeAccentHex(val, ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)]);
        var accentInput = form.querySelector('.theme-accent-hex[name="' + key + '"]');
        var swatch = form.querySelector('.theme-accent-swatch[data-accent-sync="' + key + '"]');
        var circle = form.querySelector('.kexo-accent-preview-circle[data-accent-sync="' + key + '"]');
        if (accentInput) accentInput.value = hex;
        if (swatch) swatch.value = hex;
        if (circle) try { circle.style.background = (hex && /^#[0-9a-fA-F]{3,8}$/.test(hex)) ? hex : '#e0e0e0'; } catch (_) {}
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

  window.__kexoThemeGetState = function () {
    var themePayload = buildFullThemePayload();
    var cssVarOverridesV1 = (typeof window.__kexoThemeReadCssVarOverrides === 'function')
      ? window.__kexoThemeReadCssVarOverrides()
      : { v: 1, vars: {} };
    return { themePayload: themePayload, cssVarOverridesV1: cssVarOverridesV1 };
  };
  window.__kexoThemeApplyState = function (state) {
    if (state.themePayload && typeof state.themePayload === 'object') {
      KEYS.forEach(function (key) {
        var dbKey = key.replace(/-/g, '_');
        var val = state.themePayload[dbKey];
        if (val !== undefined) setStored(key, val);
      });
      syncUI();
    }
    if (state.cssVarOverridesV1 && typeof window.__kexoThemeApplyCssVarOverrides === 'function') {
      window.__kexoThemeApplyCssVarOverrides(state.cssVarOverridesV1);
    }
  };

  function styleInputCard(key) {
    var meta = ICON_STYLE_META[key] || { title: key, help: '', icon: 'fa-circle-info' };
    var inputId = 'theme-input-' + key;
    return '<div class="kexo-theme-grid-item">' +
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
    return '<div class="kexo-theme-grid-item" data-theme-icon-glyph-card="' + key + '">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2">' +
            '<span class="kexo-theme-icon-preview me-2 d-inline-flex align-items-center justify-content-center" style="width:1.25rem;height:1.25rem;" data-theme-icon-preview-glyph="' + key + '" aria-hidden="true"></span>' +
            '<strong class="me-auto">' + meta.title + '</strong>' +
            '<button type="button" class="kexo-icon-help-trigger" data-theme-icon-help-trigger data-theme-icon-help-key="' + escapeHtml(key) + '" aria-label="Show description">' +
              '<span class="kexo-icon-help-trigger-icon kexo-theme-icon-preview d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-help-tooltip" aria-hidden="true"></span>' +
            '</button>' +
          '</div>' +
          '<textarea class="form-control font-monospace" id="' + inputId + '" name="' + key + '" data-theme-icon-glyph-input="' + key + '" rows="2" placeholder="' + (DEFAULTS[key] || 'fa-circle') + '"></textarea>' +
          '<div class="d-flex align-items-center gap-2 mt-2">' +
            '<button type="button" class="kexo-icon-action-btn kexo-icon-action-edit" data-theme-icon-edit="' + key + '" aria-label="Edit">' +
              '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-edit-icon" aria-hidden="true"></span>' +
            '</button>' +
            '<button type="button" class="kexo-icon-action-btn kexo-icon-action-save" data-theme-icon-save-glyph="' + key + '" aria-label="Save">' +
              '<span class="kexo-theme-icon-preview kexo-icon-action-icon d-inline-flex align-items-center justify-content-center" style="width:16px;height:16px;" data-theme-icon-preview-glyph="theme-icon-glyph-admin-tab-save-icon" aria-hidden="true"></span>' +
            '</button>' +
            '<span class="small text-secondary ms-auto" data-theme-icon-glyph-msg="' + key + '"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  var TOOLTIP_ICON = ' <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i>';
  function headerInputCard(key, title, help, placeholder) {
    var inputId = 'theme-input-' + key;
    var titleAttr = help ? (' title="' + String(help).replace(/"/g, '&quot;') + '"') : '';
    return '<div class="kexo-theme-grid-item">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<label class="form-label d-flex align-items-center mb-2" for="' + inputId + '"' + titleAttr + '><i class="fa-jelly fa-window-maximize me-2" aria-hidden="true"></i><strong>' + title + '</strong>' + TOOLTIP_ICON + '</label>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerInputCardNoIcon(key, title, help, placeholder) {
    var inputId = 'theme-input-' + key;
    var titleAttr = help ? (' title="' + String(help).replace(/"/g, '&quot;') + '"') : '';
    return '<div class="kexo-theme-grid-item">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<label class="form-label mb-2" for="' + inputId + '"' + titleAttr + '><strong>' + title + '</strong>' + TOOLTIP_ICON + '</label>' +
          '<input type="text" class="form-control" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" />' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerToggleCardNoIcon(key, title, help) {
    var titleAttr = help ? (' title="' + String(help).replace(/"/g, '&quot;') + '"') : '';
    return '<div class="kexo-theme-grid-item">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2"><strong' + titleAttr + '>' + title + TOOLTIP_ICON + '</strong></div>' +
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
    var titleAttr = help ? (' title="' + String(help).replace(/"/g, '&quot;') + '"') : '';
    return '<div class="kexo-theme-grid-item">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2"><strong' + titleAttr + '>' + title + TOOLTIP_ICON + '</strong></div>' +
          '<div class="form-selectgroup">' + radios + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function accentHexInputCard(key, title, placeholder) {
    var inputId = 'theme-input-' + key;
    var def = ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)] || '#4b94e4';
    return '<div class="kexo-theme-grid-item">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="mb-2">' +
            '<strong>' + title + '</strong>' +
          '</div>' +
          '<div class="d-flex align-items-center gap-2">' +
            '<input type="color" class="form-control form-control-color theme-accent-swatch" data-accent-sync="' + key + '" style="width:2.5rem;height:2rem;padding:2px;cursor:pointer" title="Pick color" />' +
            '<input type="text" class="form-control theme-accent-hex" id="' + inputId + '" name="' + key + '" placeholder="' + placeholder + '" maxlength="7" />' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function headerToggleCard(key, title, help) {
    var titleAttr = help ? (' title="' + String(help).replace(/"/g, '&quot;') + '"') : '';
    return '<div class="kexo-theme-grid-item">' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body">' +
          '<div class="d-flex align-items-center mb-2"><i class="fa-jelly fa-toggle-on me-2" aria-hidden="true"></i><strong' + titleAttr + '>' + title + TOOLTIP_ICON + '</strong></div>' +
          '<div class="form-selectgroup">' +
            radioCard(key, 'show', 'Show') +
            radioCard(key, 'hide', 'Hide') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function cssVarOverrideInputCard(varName, title, helpText, extraDataAttrs) {
    var name = String(varName || '').trim();
    var label = String(title || name || 'CSS var').trim();
    var help = helpText ? String(helpText) : '';
    var titleAttr = help ? (' title="' + escapeHtml(help) + '"') : '';
    var attrs = extraDataAttrs ? String(extraDataAttrs) : '';
    return '<div class="kexo-theme-grid-item kexo-css-var-card"' + attrs + '>' +
      '<div class="card card-sm h-100">' +
        '<div class="card-body position-relative">' +
          '<a href="#" class="kexo-css-var-revert text-secondary small position-absolute top-0 end-0 me-1 mt-1" data-kexo-css-var="' + escapeHtml(name) + '" role="button" aria-label="Revert to default">Revert</a>' +
          '<div class="mb-2">' +
            '<strong' + titleAttr + '>' + escapeHtml(label) + (help ? TOOLTIP_ICON : '') + '</strong>' +
          '</div>' +
          '<div class="d-flex align-items-center gap-2">' +
            '<input type="color" class="form-control form-control-color kexo-css-var-swatch" data-kexo-css-var="' + escapeHtml(name) + '" style="width:2.5rem;height:2rem;padding:2px;cursor:pointer" title="Pick colour" />' +
            '<input type="text" class="form-control kexo-css-var-input" data-kexo-css-var="' + escapeHtml(name) + '" placeholder="Leave blank for default" maxlength="150" />' +
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
    var glyphAccordion = buildGlyphAccordionHtml();
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
    var schemeMap = getColorSchemeMap();
    var themeAccordionsId = 'theme-color-accordion';
    var accentItems = (schemeMap && Array.isArray(schemeMap.themeAccents) && schemeMap.themeAccents.length)
      ? schemeMap.themeAccents.slice()
      : ACCENT_HEX_KEYS.map(function (k, i) {
        return { themeKeyHyphen: k, label: 'Accent ' + String(i + 1) };
      });
    var accentGrid = accentItems.map(function (it) {
      var key = it && it.themeKeyHyphen ? String(it.themeKeyHyphen) : '';
      var label = it && it.label ? String(it.label) : key;
      return accentHexInputCard(key, label, DEFAULTS[key] || '');
    }).join('');

    var themeAccentsAccordion = buildAccordionItemHtml({
      accordionId: 'theme-accents',
      label: 'Theme Accents',
      open: true,
      parentId: themeAccordionsId,
      collapseId: 'theme-color-accordion-theme-accents',
      bodyHtml:
        '<div class="text-secondary small mb-3">Accent 1 is the primary accent (Top Bar + Top Nav). Accents 1–10 rotate for nav underline/accents. Leave blank to use defaults.</div>' +
        '<div class="settings-responsive-grid">' + accentGrid + '</div>',
    });

    var headerNavAccordion = buildCssVarOverridesAccordionHtml(schemeMap, 'header-nav', 'Header & Navigation', { open: false, parentId: themeAccordionsId });

    var kpiBaseCards = (function () {
      var items = listCssVarOverrideItemsForAccordion(schemeMap, 'kpis', { includeAdvanced: false });
      return items.map(function (it) {
        var name = it && it.key ? String(it.key).trim() : '';
        var label = it && it.label ? String(it.label) : name;
        var groupId = it && it.accordion ? String(it.accordion) : 'kpis';
        var searchText = (label + ' ' + name).toLowerCase();
        return cssVarOverrideInputCard(name, label, null, ' data-kexo-css-var-group="' + escapeHtml(groupId) + '" data-kexo-css-var-search="' + escapeHtml(searchText) + '"');
      }).join('');
    })();
    var kpiAdvancedCards = (function () {
      var all = listCssVarOverrideItemsForAccordion(schemeMap, 'kpis', { includeAdvanced: true });
      var adv = all.filter(function (it) { return it && it.advanced; });
      return adv.map(function (it) {
        var name = it && it.key ? String(it.key).trim() : '';
        var label = it && it.label ? String(it.label) : name;
        var groupId = it && it.accordion ? String(it.accordion) : 'kpis';
        var searchText = (label + ' ' + name).toLowerCase();
        return cssVarOverrideInputCard(name, label, null, ' data-kexo-css-var-group="' + escapeHtml(groupId) + '" data-kexo-css-var-search="' + escapeHtml(searchText) + '"');
      }).join('');
    })();
    var kpiAccordion = buildAccordionItemHtml({
      accordionId: 'kpis',
      label: 'KPIs',
      open: false,
      parentId: themeAccordionsId,
      collapseId: 'theme-color-accordion-kpis',
      dataAttrs: ' data-kexo-css-var-accordion="kpis"',
      bodyHtml:
        '<div class="text-secondary small mb-3">Leave blank to use theme default.</div>' +
        '<div class="settings-responsive-grid" data-kexo-css-var-accordion-body="kpis">' + kpiBaseCards + '</div>' +
        (kpiBaseCards ? '' : '<div class="text-secondary small">No items.</div>') +
        '<hr class="my-3" />' +
        '<div class="form-check form-switch mb-3">' +
          '<input class="form-check-input" type="checkbox" id="theme-kpi-separate-palettes" name="theme-kpi-separate-palettes" />' +
          '<label class="form-check-label" for="theme-kpi-separate-palettes">Use separate KPI palettes per section (advanced)</label>' +
          '<div class="form-hint">Default off. When off, all KPI areas use the same palette.</div>' +
        '</div>' +
        '<div id="theme-kpi-advanced-overrides" hidden>' +
          '<div class="text-secondary small mb-3">Section-specific overrides (only applied when enabled).</div>' +
          '<div class="settings-responsive-grid" data-kexo-css-var-accordion-body="kpis">' + kpiAdvancedCards + '</div>' +
        '</div>',
    });

    var tablerAccordion = buildCssVarOverridesAccordionHtml(schemeMap, 'tabler-semantic', 'Tabler Semantic', { open: false, parentId: themeAccordionsId });
    var featureAccordion = buildCssVarOverridesAccordionHtml(schemeMap, 'feature-tokens', 'Feature Tokens', { open: false, parentId: themeAccordionsId });
    var settingsUiAccordion = buildCssVarOverridesAccordionHtml(schemeMap, 'settings-ui', 'Settings UI', { open: false, parentId: themeAccordionsId });

    var graysCards = (function () {
      var all = listCssVarOverrideItemsForAccordion(schemeMap, 'advanced-grays', { includeAdvanced: true });
      return all.map(function (it) {
        var name = it && it.key ? String(it.key).trim() : '';
        var label = it && it.label ? String(it.label) : name;
        var groupId = it && it.accordion ? String(it.accordion) : 'advanced-grays';
        var searchText = (label + ' ' + name).toLowerCase();
        return cssVarOverrideInputCard(name, label, null, ' data-kexo-css-var-group="' + escapeHtml(groupId) + '" data-kexo-css-var-search="' + escapeHtml(searchText) + '"');
      }).join('');
    })();
    var advancedGraysAccordion = buildAccordionItemHtml({
      accordionId: 'advanced-grays',
      label: 'Advanced Grays',
      open: false,
      parentId: themeAccordionsId,
      collapseId: 'theme-color-accordion-advanced-grays',
      dataAttrs: ' data-kexo-css-var-accordion="advanced-grays"',
      bodyHtml:
        '<div class="text-secondary small mb-3">Leave blank to use theme default.</div>' +
        '<div class="mb-3">' +
          '<label class="form-label">Theme base</label>' +
          '<div class="form-selectgroup">' +
            radioCard('theme-base', 'slate', 'Slate') +
            radioCard('theme-base', 'gray', 'Gray') +
            radioCard('theme-base', 'zinc', 'Zinc') +
            radioCard('theme-base', 'neutral', 'Neutral') +
            radioCard('theme-base', 'stone', 'Stone') +
          '</div>' +
          '<div class="form-hint">Sets the default gray palette. Manual overrides below take precedence.</div>' +
        '</div>' +
        '<div class="settings-responsive-grid" data-kexo-css-var-accordion-body="advanced-grays">' + graysCards + '</div>' +
        (graysCards ? '' : '<div class="text-secondary small">No items.</div>'),
    });

    var colorsAccordionHtml =
      '<div class="accordion settings-layout-accordion" id="' + escapeHtml(themeAccordionsId) + '">' +
        themeAccentsAccordion +
        headerNavAccordion +
        kpiAccordion +
        tablerAccordion +
        featureAccordion +
        settingsUiAccordion +
        advancedGraysAccordion +
      '</div>';

    var cssVarOverridesPanel =
      '<div class="mb-4" id="kexo-css-var-overrides-panel">' +
        '<div class="text-secondary small mb-3">Overrides take precedence over Theme Accents.</div>' +
        '<div class="mb-3">' +
          '<input type="text" class="form-control" id="kexo-css-var-overrides-search" placeholder="Search/filter colours…" aria-label="Search colours" />' +
        '</div>' +
        '<div id="kexo-css-var-overrides-grid">' + colorsAccordionHtml + '</div>' +
      '</div>';

    var menuHoverGrid = [
      headerInputCardNoIcon('theme-menu-hover-opacity', 'Menu hover opacity', 'Hover tint strength 0–100%. 0 = no overlay, 8 = subtle.', '8'),
      headerSelectCardNoIcon('theme-menu-hover-color', 'Menu hover tint', 'Black = darken on hover, White = lighten on hover.', { black: 'Black', white: 'White' }, 'black'),
    ].join('');
    var customCssFieldset =
      '<fieldset class="mb-4">' +
        '<legend class="form-label" title="Injected inline into head after other stylesheets. Changes are global.">Custom CSS <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></legend>' +
        '<textarea class="form-control font-monospace" name="theme-custom-css" rows="9" spellcheck="false" placeholder="/* Custom CSS */"></textarea>' +
      '</fieldset>';
    return '<form id="theme-settings-form">' +
      '<ul class="nav nav-underline mb-3" id="theme-subtabs" role="tablist">' +
        '<li class="nav-item" role="presentation"><button class="nav-link active" type="button" role="tab" data-theme-subtab="icons" aria-selected="true">Icons</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="header" aria-selected="false">Header</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="color" aria-selected="false">Color</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="fonts" aria-selected="false">Fonts</button></li>' +
        '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-subtab="sale-notification" aria-selected="false">Notifications</button></li>' +
      '</ul>' +

      '<div class="theme-subpanel" data-theme-subpanel="icons">' +
        glyphAccordion +
        '<div class="d-flex align-items-center gap-2 mt-3">' +
          '<button type="button" class="btn btn-md" id="theme-icons-refresh" title="Debounced preview updates after typing stops.">Refresh previews</button>' +
        '</div>' +
      '</div>' +

      '<div class="theme-subpanel" data-theme-subpanel="header" hidden>' +
        '<h4 class="mb-2" title="Configure header visibility and shape. Header/nav colors are in the Color tab.">Shape <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></h4>' +
        '<div class="row g-3">' + headerShapeGrid + '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Visibility & borders</h4>' +
        '<div class="row g-3">' + headerToggleGrid + '</div>' +
      '</div>' +

      '<div class="theme-subpanel" data-theme-subpanel="color" hidden>' +
        '<ul class="nav nav-underline mb-3" id="theme-color-subtabs" role="tablist">' +
          '<li class="nav-item" role="presentation"><button class="nav-link active" type="button" role="tab" data-theme-color-subtab="colors" aria-selected="true">Colours</button></li>' +
          '<li class="nav-item" role="presentation"><button class="nav-link" type="button" role="tab" data-theme-color-subtab="layout" aria-selected="false">Layout &amp; Styling</button></li>' +
        '</ul>' +
        '<div class="theme-color-subpanel" data-theme-color-subpanel="colors">' +
          cssVarOverridesPanel +
        '</div>' +
        '<div class="theme-color-subpanel" data-theme-color-subpanel="layout" hidden>' +
          '<div class="accordion settings-layout-accordion" id="theme-layout-accordion">' +
            buildAccordionItemHtml({
              accordionId: 'layout-header-nav',
              label: 'Header & Navigation',
              open: true,
              parentId: 'theme-layout-accordion',
              collapseId: 'theme-layout-accordion-header-nav',
              bodyHtml:
                '<div class="text-secondary small mb-3">Layout and styling controls (not colour overrides).</div>' +
                '<div class="d-flex flex-column gap-3 kexo-theme-stack">' +
                  headerInputCardNoIcon('theme-header-strip-padding', 'Top Bar padding', 'CSS padding for the top bar (for example 0 5px).', DEFAULTS['theme-header-strip-padding']) +
                  headerInputCardNoIcon('theme-header-main-shadow', 'Top Nav box-shadow', 'CSS box-shadow for top nav row (for example 2px 2px 2px #eee or none).', DEFAULTS['theme-header-main-shadow']) +
                '</div>' +
                '<hr class="my-3" />' +
                '<div class="mb-2">' +
                  '<label class="form-label">Menu hover tint</label>' +
                  '<div class="text-secondary small mb-3">Control the hover overlay on menu links and dropdown items. Black = darken, White = lighten. Opacity 0–100% sets strength.</div>' +
                  '<div class="d-flex flex-column gap-3 kexo-theme-stack">' + menuHoverGrid + '</div>' +
                '</div>',
            }) +
            buildAccordionItemHtml({
              accordionId: 'layout-corners',
              label: 'Corners',
              open: false,
              parentId: 'theme-layout-accordion',
              collapseId: 'theme-layout-accordion-corners',
              bodyHtml:
                '<div class="mb-2">' +
                  '<label class="form-label">Corner radius</label>' +
                  '<div class="form-selectgroup">' +
                    radioCard('theme-radius', '0', '0') +
                    radioCard('theme-radius', '0.5', '0.5') +
                    radioCard('theme-radius', '1', '1') +
                    radioCard('theme-radius', '1.5', '1.5') +
                    radioCard('theme-radius', '2', '2') +
                  '</div>' +
                '</div>',
            }) +
            buildAccordionItemHtml({
              accordionId: 'layout-custom-css',
              label: 'Custom CSS',
              open: false,
              parentId: 'theme-layout-accordion',
              collapseId: 'theme-layout-accordion-custom-css',
              bodyHtml: customCssFieldset,
            }) +
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

      '<div class="theme-subpanel" data-theme-subpanel="sale-notification" hidden>' +
        '<h4 class="mb-2">Notification types</h4>' +
        '<p class="text-secondary small mb-3">Turn each notification type on or off. Sale sound is played when a new sale is detected.</p>' +
        '<div class="mb-4" id="settings-notification-types-wrap">' +
          '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="settings-notif-daily-report" data-notification-pref="daily_report" checked><label class="form-check-label" for="settings-notif-daily-report">Daily report</label></div>' +
          '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="settings-notif-sale" data-notification-pref="sale" checked><label class="form-check-label" for="settings-notif-sale">Sale (sound + banner)</label></div>' +
          '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="settings-notif-sentry" data-notification-pref="sentry" checked><label class="form-check-label" for="settings-notif-sentry">Sentry errors <span class="text-muted">(admins only)</span></label></div>' +
          '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="settings-notif-pending-signup" data-notification-pref="pending_signup" checked><label class="form-check-label" for="settings-notif-pending-signup">Pending sign-ups <span class="text-muted">(admins only)</span></label></div>' +
          '<div class="form-check form-switch mb-2"><input class="form-check-input" type="checkbox" id="settings-notif-diagnostics" data-notification-pref="diagnostics_unresolved" checked><label class="form-check-label" for="settings-notif-diagnostics">Unresolved diagnostics <span class="text-muted">(admins only)</span></label></div>' +
        '</div>' +
        '<hr class="my-3" />' +
        '<h4 class="mb-2">Sale sound</h4>' +
        '<div class="text-secondary mb-3">Choose the sound played when a new sale is detected. Use a preset or upload your own MP3.</div>' +
        '<form id="settings-sale-notification-form">' +
          '<div class="mb-3">' +
            '<label class="form-label" for="settings-sale-sound-preset">Sound preset</label>' +
            '<select class="form-select" id="settings-sale-sound-preset">' +
              '<option value="kexo1">Kexo 1</option>' +
              '<option value="kexo2">Kexo 2</option>' +
              '<option value="kexo3">Kexo 3</option>' +
              '<option value="kexo4">Kexo 4</option>' +
              '<option value="custom">Custom URL or upload</option>' +
            '</select>' +
          '</div>' +
          '<div class="mb-3" id="settings-sale-sound-custom-wrap" style="display:none">' +
            '<label class="form-label" for="settings-asset-sale-sound">Custom sound URL</label>' +
            '<input type="url" class="form-control" id="settings-asset-sale-sound" placeholder="https://… or upload below" />' +
            '<div class="input-group mt-2">' +
              '<input type="file" class="form-control" id="settings-upload-sale-sound" accept="audio/mpeg,audio/mp3" />' +
              '<button type="button" class="btn btn-md" data-kexo-asset-upload="1" data-kexo-slot="sale_sound" data-kexo-file="settings-upload-sale-sound" data-kexo-url="settings-asset-sale-sound">Upload</button>' +
            '</div>' +
            '<div class="form-hint">MP3 only. Max 2MB.</div>' +
          '</div>' +
          '<div class="mb-3">' +
            '<button type="button" class="btn btn-md" id="settings-sale-sound-preview">Preview</button>' +
          '</div>' +
          '<div class="mt-3">' +
            '<button type="submit" class="btn btn-primary btn-md">Save</button>' +
            '<span id="settings-sale-notification-msg" class="form-hint ms-2"></span>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</form>' +
    buildIconEditModalHtml();
  }

  function wireThemeSubTabs(root) {
    var tabs = root ? root.querySelectorAll('[data-theme-subtab]') : null;
    var panels = root ? root.querySelectorAll('[data-theme-subpanel]') : null;
    if (!tabs || !tabs.length || !panels || !panels.length) return;
    function activate(key) {
      var k = String(key || '').trim().toLowerCase();
      if (!k) k = 'icons';
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-theme-subtab') === k;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(function (panel) {
        var active = panel.getAttribute('data-theme-subpanel') === k;
        panel.hidden = !active;
      });
    }
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-theme-subtab') || 'icons');
      });
    });
    // Allow Settings top-level tabs to control the visible subpanel.
    try {
      window.kexoThemeActivateSubtab = function (key) { activate(key); };
    } catch (_) {}
    // On Settings page, hide the internal subtabs (Icons/Header/Color/Fonts/Notifications)
    // because Settings promotes these to the Kexo top-level subnav.
    try {
      if (document.body && document.body.getAttribute('data-page') === 'settings') {
        var nav = root.querySelector('#theme-subtabs');
        if (nav) nav.hidden = true;
      }
    } catch (_) {}
    var initial = 'icons';
    try {
      var requested = window.__kexoThemeRequestedSubtab;
      if (requested) initial = String(requested).trim().toLowerCase() || initial;
    } catch (_) {}
    activate(initial);
  }

  function wireThemeColorSubTabs(root) {
    var wrap = root || document;
    var tabs = wrap ? wrap.querySelectorAll('[data-theme-color-subtab]') : null;
    var panels = wrap ? wrap.querySelectorAll('[data-theme-color-subpanel]') : null;
    if (!tabs || !tabs.length || !panels || !panels.length) return;

    function activate(key) {
      var k = String(key || '').trim().toLowerCase();
      if (k !== 'layout' && k !== 'colors') k = 'colors';
      tabs.forEach(function (tab) {
        var active = tab.getAttribute('data-theme-color-subtab') === k;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach(function (panel) {
        var active = panel.getAttribute('data-theme-color-subpanel') === k;
        panel.hidden = !active;
      });
      try { localStorage.setItem('kexo:theme-color-subtab:v1', k); } catch (_) {}
    }

    try {
      window.kexoThemeActivateColorSubtab = function (key) { activate(key); };
    } catch (_) {}

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.getAttribute('data-theme-color-subtab') || 'colors');
      });
    });

    var initial = 'colors';
    try {
      if (document.body && document.body.getAttribute('data-page') === 'settings') {
        var requested = window.__kexoThemeRequestedColorSubtab;
        if (requested) initial = String(requested).trim().toLowerCase() || initial;
      } else {
        var raw = localStorage.getItem('kexo:theme-color-subtab:v1');
        if (raw) initial = String(raw).trim().toLowerCase() || initial;
      }
    } catch (_) {}
    activate(initial);

    try {
      if (document.body && document.body.getAttribute('data-page') === 'settings') {
        var nav = wrap.querySelector('#theme-color-subtabs');
        if (nav) nav.hidden = true;
      }
    } catch (_) {}
  }

  function setPreviewIconClass(previewEl, glyphCls) {
    if (!previewEl) return;
    var parsed = parseIconGlyphInput(glyphCls, 'fa-light fa-circle');
    previewEl.innerHTML = '';
    if (parsed.mode === 'svg') {
      previewEl.innerHTML = parsed.value;
      var svg = previewEl.querySelector('svg');
      if (svg) {
        try {
          svg.removeAttribute('width');
          svg.removeAttribute('height');
          svg.setAttribute('width', '1em');
          svg.setAttribute('height', '1em');
          svg.style.width = '1em';
          svg.style.height = '1em';
          svg.style.display = 'inline-block';
          svg.style.verticalAlign = '-0.125em';
          svg.style.fill = 'currentColor';
        } catch (_) {}
      }
      return;
    }
    if (parsed.mode === 'img') {
      var img = document.createElement('img');
      img.src = parsed.value;
      img.alt = '';
      img.style.width = '1em';
      img.style.height = '1em';
      img.style.objectFit = 'contain';
      previewEl.appendChild(img);
      return;
    }
    var icon = document.createElement('i');
    icon.className = parsed.value;
    icon.setAttribute('aria-hidden', 'true');
    previewEl.appendChild(icon);
  }

  function refreshIconPreviews(formEl) {
    if (!formEl) return;
    ICON_GLYPH_KEYS.forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      var previews = formEl.querySelectorAll('[data-theme-icon-preview-glyph="' + key + '"]');
      var glyphVal = (getStored(key) != null && getStored(key) !== '') ? getStored(key) : (input && input.value ? input.value : DEFAULTS[key]);
      if (input && input.value !== glyphVal) input.value = glyphVal;
      previews.forEach(function (preview) { setPreviewIconClass(preview, glyphVal); });
    });
  }

  function wireCssVarOverridesPanel(formEl) {
    if (!formEl) return;
    var root = formEl.parentElement || document;
    var grid = root.querySelector('#kexo-css-var-overrides-grid');
    if (!grid) return;
    var searchInput = root.querySelector('#kexo-css-var-overrides-search');
    var msgEl = root.querySelector('#kexo-css-var-overrides-msg');
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}

    var applied = {};
    var schemeMap = getColorSchemeMap();
    var kpiToggle = root.querySelector('#theme-kpi-separate-palettes');
    var kpiAdvancedWrap = root.querySelector('#theme-kpi-advanced-overrides');

    function filterCssVarGrid() {
      var q = (searchInput && searchInput.value) ? String(searchInput.value).trim().toLowerCase() : '';
      var tiles = root.querySelectorAll('.kexo-css-var-row[data-kexo-css-var-row], .kexo-css-var-card[data-kexo-css-var-search]');
      var accordions = root.querySelectorAll('[data-kexo-css-var-accordion]');
      if (!q) {
        tiles.forEach(function (el) { el.hidden = false; });
        accordions.forEach(function (el) { el.hidden = false; });
        return;
      }
      var visibleByGroup = {};
      tiles.forEach(function (el) {
        var searchAttr = el.getAttribute('data-kexo-css-var-search') || '';
        var show = searchAttr.indexOf(q) !== -1;
        el.hidden = !show;
        if (show) {
          var g = el.getAttribute('data-kexo-css-var-group') || '';
          visibleByGroup[g] = true;
        }
      });
      accordions.forEach(function (el) {
        var g = el.getAttribute('data-kexo-css-var-accordion') || '';
        el.hidden = !visibleByGroup[g];
      });
    }

    function setMsg(text, ok) {
      if (!msgEl) return;
      msgEl.textContent = text || '';
      if (ok === true) msgEl.className = 'form-hint text-success';
      else if (ok === false) msgEl.className = 'form-hint text-danger';
      else msgEl.className = 'form-hint text-secondary';
    }

    function normalizeCssVarOverrideValue(raw) {
      var v = raw == null ? '' : String(raw).trim();
      if (!v) return '';
      if (v.length > 150) return '';
      if (/[;\r\n{}]/.test(v)) return '';
      if (/^var\(--[a-zA-Z0-9._-]+\)$/.test(v)) return v;
      if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
      if (/^(rgb|hsl)a?\(/i.test(v)) return v;
      if (/^color-mix\(/.test(v)) return v;
      if (v.toLowerCase() === 'currentcolor') return 'currentColor';
      if (v.toLowerCase() === 'transparent') return 'transparent';
      if (/^[a-z-]+$/i.test(v)) return v;
      return '';
    }

    function normalizeOpaqueCssVarOverrideValue(raw) {
      var v = raw == null ? '' : String(raw).trim();
      if (!v) return '';
      if (v.length > 150) return '';
      if (/[;\r\n{}]/.test(v)) return '';
      // Do not allow indirection or alpha formats for header/menu backgrounds.
      if (/^var\(/i.test(v)) return '';
      if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(v)) return '';
      if (/^(rgba|hsla)\(/i.test(v)) return '';
      if (/^(rgb|hsl)\(/i.test(v) && v.indexOf('/') !== -1) return '';
      if (/^color-mix\(/i.test(v)) return '';
      if (v.toLowerCase() === 'transparent') return '';

      var m3 = /^#([0-9a-f]{3})$/i.exec(v);
      if (m3) {
        var h = m3[1];
        return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      }
      if (/^#([0-9a-f]{6})$/i.test(v)) return v;
      if (/^(rgb|hsl)\(/i.test(v)) return v;
      if (v.toLowerCase() === 'currentcolor') return 'currentColor';
      if (/^[a-z-]+$/i.test(v)) return v;
      return '';
    }

    function readCfgFromUi() {
      var vars = {};
      var isPerSectionEnabled = !!(kpiToggle && kpiToggle.checked);
      var inputs = root.querySelectorAll('.kexo-css-var-input[data-kexo-css-var]');
      Array.prototype.forEach.call(inputs, function (el) {
        var name = el && el.getAttribute ? String(el.getAttribute('data-kexo-css-var') || '').trim() : '';
        if (!name || !/^--[a-zA-Z0-9._-]+$/.test(name)) return;
        if (!isPerSectionEnabled && schemeMap && typeof schemeMap.isKpiPerSectionVar === 'function' && schemeMap.isKpiPerSectionVar(name)) return;
        var isOpaque = schemeMap && typeof schemeMap.isOpaqueVar === 'function' ? schemeMap.isOpaqueVar(name) : false;
        var val = isOpaque ? normalizeOpaqueCssVarOverrideValue(el.value) : normalizeCssVarOverrideValue(el.value);
        if (!val) return;
        vars[name] = val;
      });
      return { v: 1, vars: vars };
    }

    function getComputedColorForVar(varName) {
      try {
        var computed = getComputedStyle(document.documentElement).getPropertyValue(varName.trim()).trim();
        return computed || '';
      } catch (_) { return ''; }
    }

    function updateCssVarPreviewCircles() {
      var swatches = root.querySelectorAll('.kexo-css-var-swatch[data-kexo-css-var]');
      Array.prototype.forEach.call(swatches, function (el) {
        var name = el.getAttribute('data-kexo-css-var');
        if (!name) return;
        var input = root.querySelector('.kexo-css-var-input[data-kexo-css-var="' + CSS.escape(name) + '"]');
        var swatch = el;
        var overrideVal = input && input.value ? String(input.value).trim() : '';
        var swatchHex = '';
        if (overrideVal) {
          if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(overrideVal)) {
            swatchHex = overrideVal.length === 7 || overrideVal.length === 4 ? overrideVal : overrideVal.slice(0, 7);
          } else if (/^(rgb|hsl)a?\(/i.test(overrideVal)) {
            swatchHex = cssColorToHex(overrideVal);
          }
        } else {
          var computed = getComputedColorForVar(name);
          var fallback = (typeof CSS_VAR_FALLBACKS !== 'undefined' && CSS_VAR_FALLBACKS[name]) ? CSS_VAR_FALLBACKS[name] : '';
          var displayVal = computed || fallback;
          if (displayVal) swatchHex = cssColorToHex(displayVal);
        }
        var hex = swatchHex || (CSS_VAR_FALLBACKS && CSS_VAR_FALLBACKS[name] ? cssColorToHex(CSS_VAR_FALLBACKS[name]) : '');
        try { swatch.value = hex || '#888888'; } catch (_) {}
      });
    }

    function applyCfgToUi(cfg) {
      var vars = cfg && cfg.vars && typeof cfg.vars === 'object' ? cfg.vars : {};
      var inputs = root.querySelectorAll('.kexo-css-var-input[data-kexo-css-var]');
      Array.prototype.forEach.call(inputs, function (el) {
        var name = el && el.getAttribute ? String(el.getAttribute('data-kexo-css-var') || '').trim() : '';
        var next = (name && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name] || '') : '';
        try { el.value = next; } catch (_) {}
      });
      var swatches = root.querySelectorAll('.kexo-css-var-swatch[data-kexo-css-var]');
      Array.prototype.forEach.call(swatches, function (el) {
        var name = el && el.getAttribute ? String(el.getAttribute('data-kexo-css-var') || '').trim() : '';
        var v = (name && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name] || '') : '';
        var hex = v && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? v : '';
        try { el.value = hex ? hex : '#000000'; } catch (_) {}
      });
      updateCssVarPreviewCircles();
    }

    function applyCfgToDom(cfg) {
      var vars = cfg && cfg.vars && typeof cfg.vars === 'object' ? cfg.vars : {};
      var docEl = document.documentElement;
      Object.keys(applied).forEach(function (k) {
        if (!Object.prototype.hasOwnProperty.call(vars, k)) {
          try { docEl.style.removeProperty(k); } catch (_) {}
        }
      });
      Object.keys(vars).forEach(function (k) {
        try { docEl.style.setProperty(k, String(vars[k])); } catch (_) {}
      });
      applied = Object.assign({}, vars);
      try { localStorage.setItem('kexo:css_var_overrides:v1', JSON.stringify({ v: 1, vars: applied })); } catch (_) {}
      try { document.dispatchEvent(new CustomEvent('kexo:cssVarOverridesUpdated', { detail: { cfg: { v: 1, vars: applied } } })); } catch (_) {}
    }

    function fetchCurrent() {
      setMsg('Loading…', null);
      return fetch(base + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (data) {
          var cfg = (data && data.ok && data.cssVarOverridesV1) ? data.cssVarOverridesV1 : null;
          cfg = cfg && typeof cfg === 'object' ? cfg : { v: 1, vars: {} };
          applyCfgToUi(cfg);
          applyCfgToDom(cfg);
          setMsg('', null);
          setTimeout(function () { updateCssVarPreviewCircles(); }, 50);
        })
        .catch(function () { setMsg('Failed to load colours.', false); });
    }

    function postCfg(cfg) {
      return fetch(base + '/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cssVarOverridesV1: cfg }),
      }).then(function (r) { return r && r.ok ? r.json() : null; });
    }

    if (searchInput) {
      searchInput.addEventListener('input', filterCssVarGrid);
      searchInput.addEventListener('change', filterCssVarGrid);
    }

    function applyKpiAdvancedUiState() {
      if (!kpiToggle || !kpiAdvancedWrap) return;
      kpiAdvancedWrap.hidden = !kpiToggle.checked;
      applyCfgToDom(readCfgFromUi());
      updateCssVarPreviewCircles();
    }
    if (kpiToggle) {
      try {
        var raw = localStorage.getItem('kexo:theme-kpi-separate-palettes:v1');
        if (raw === '1' || raw === 'true') kpiToggle.checked = true;
      } catch (_) {}
      kpiToggle.addEventListener('change', function () {
        try { localStorage.setItem('kexo:theme-kpi-separate-palettes:v1', kpiToggle.checked ? '1' : '0'); } catch (_) {}
        applyKpiAdvancedUiState();
      });
      applyKpiAdvancedUiState();
    }

    grid.addEventListener('click', function (e) {
      var t = e && e.target ? e.target : null;
      if (!t || !t.classList) return;

      if (t.classList.contains('kexo-css-var-revert')) {
        e.preventDefault();
        var name = t.getAttribute('data-kexo-css-var');
        if (!name) return;
        var input = root.querySelector('.kexo-css-var-input[data-kexo-css-var="' + CSS.escape(name) + '"]');
        if (input) { try { input.value = ''; } catch (_) {} }
        applyCfgToDom(readCfgFromUi());
        updateCssVarPreviewCircles();
        return;
      }

    });

    function syncSwatchToInput(t) {
      if (!t || !t.classList || !t.classList.contains('kexo-css-var-swatch')) return;
      var name = String(t.getAttribute('data-kexo-css-var') || '').trim();
      if (!name) return;
      var input = root.querySelector('.kexo-css-var-input[data-kexo-css-var="' + CSS.escape(name) + '"]');
      if (input) try { input.value = String(t.value || '').trim(); } catch (_) {}
    }
    grid.addEventListener('input', function (e) {
      syncSwatchToInput(e && e.target ? e.target : null);
      applyCfgToDom(readCfgFromUi());
      updateCssVarPreviewCircles();
    });
    grid.addEventListener('change', function (e) {
      syncSwatchToInput(e && e.target ? e.target : null);
      applyCfgToDom(readCfgFromUi());
      updateCssVarPreviewCircles();
    });

    window.__kexoThemeReadCssVarOverrides = readCfgFromUi;
    window.__kexoThemeApplyCssVarOverrides = function (cfg) {
      applyCfgToUi(cfg);
      applyCfgToDom(cfg);
      updateCssVarPreviewCircles();
    };
    fetchCurrent().then(function () {
      if (typeof window.__kexoThemeBaselineReady === 'function') window.__kexoThemeBaselineReady();
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
        saveToServer(payload).catch(function () {});
      }, 700);
    }

    function queueGlobalSaveAll() {
      if (getPreferenceMode() !== 'global') return;
      if (globalSaveAllTimer) clearTimeout(globalSaveAllTimer);
      globalSaveAllTimer = setTimeout(function () {
        saveToServer().catch(function () {});
      }, 700);
    }

    function wireIconEditModal() {
      var root = formEl.parentElement || document;
      var modalEl = root.querySelector('#theme-icon-edit-modal');
      if (!modalEl) return;
      var targetEl = modalEl.querySelector('#theme-icon-edit-target');
      var keyInput = modalEl.querySelector('#theme-icon-edit-key');
      var sizeInput = modalEl.querySelector('#theme-icon-edit-size');
      var colorInput = modalEl.querySelector('#theme-icon-edit-color');
      var saveBtn = modalEl.querySelector('#theme-icon-edit-save');
      var clearBtn = modalEl.querySelector('#theme-icon-edit-clear');
      var closeBtn = modalEl.querySelector('[data-theme-icon-edit-close]');
      if (!keyInput || !sizeInput || !colorInput || !saveBtn || !clearBtn) return;
      var fallbackBackdropEl = null;

      function getModal() {
        try {
          if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return null;
          return bootstrap.Modal.getOrCreateInstance(modalEl);
        } catch (_) {
          return null;
        }
      }

      function closeModal() {
        var modal = getModal();
        if (modal) {
          modal.hide();
          try {
            if (fallbackBackdropEl && fallbackBackdropEl.parentNode) fallbackBackdropEl.parentNode.removeChild(fallbackBackdropEl);
            fallbackBackdropEl = null;
          } catch (_) {}
          return;
        }
        modalEl.classList.remove('show');
        modalEl.style.display = 'none';
        modalEl.setAttribute('aria-hidden', 'true');
        try {
          document.body.classList.remove('modal-open');
          if (fallbackBackdropEl && fallbackBackdropEl.parentNode) fallbackBackdropEl.parentNode.removeChild(fallbackBackdropEl);
          fallbackBackdropEl = null;
        } catch (_) {}
      }

      function openModal(themeKey) {
        var key = String(themeKey || '');
        var iconName = glyphNameFromThemeKey(key);
        var meta = glyphMetaFor(iconName);
        var map = readIconOverridesMap();
        var row = map[iconName] || {};
        keyInput.value = key;
        sizeInput.value = row.size || '';
        colorInput.value = row.color || '';
        if (targetEl) targetEl.textContent = 'Overrides for ' + String(meta.title || iconName) + ' (' + iconName + '). Leave blank to use global defaults.';
        var modal = getModal();
        if (modal) {
          modal.show();
          return;
        }
        if (!fallbackBackdropEl || !fallbackBackdropEl.parentNode) {
          fallbackBackdropEl = document.createElement('div');
          fallbackBackdropEl.className = 'modal-backdrop fade show kexo-theme-icon-edit-backdrop';
          fallbackBackdropEl.setAttribute('aria-hidden', 'true');
          fallbackBackdropEl.addEventListener('click', function () {
            closeModal();
          });
          document.body.appendChild(fallbackBackdropEl);
        }
        modalEl.style.display = 'block';
        modalEl.classList.add('show');
        modalEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
      }

      function persistIconEdit(clearValues) {
        var themeKey = keyInput.value || '';
        var iconName = glyphNameFromThemeKey(themeKey);
        if (!iconName) return;
        if (!isAllowedIconOverrideKey(iconName)) return;
        var map = readIconOverridesMap();
        var size = clearValues ? '' : normalizeIconOverrideSize(sizeInput.value);
        var color = clearValues ? '' : normalizeIconOverrideColor(colorInput.value);
        if (size || color) map[iconName] = { size: size, color: color };
        else delete map[iconName];
        writeIconOverridesMap(map);
        applyTheme(ICON_OVERRIDES_JSON_KEY, getStored(ICON_OVERRIDES_JSON_KEY) || DEFAULTS[ICON_OVERRIDES_JSON_KEY]);
        refreshIconPreviews(formEl);
        triggerIconThemeRefresh();
        var msgEl = modalEl.querySelector('#theme-icon-edit-msg');
        if (msgEl) { msgEl.textContent = 'Saving…'; msgEl.className = 'small text-secondary me-auto'; }
        var payload = {};
        payload['theme_icon_overrides_json'] = getStored(ICON_OVERRIDES_JSON_KEY) || DEFAULTS[ICON_OVERRIDES_JSON_KEY] || '';
        saveToServer(payload).then(function () {
          var isLocalOnly = getPreferenceMode() !== 'global';
          if (msgEl) {
            msgEl.textContent = isLocalOnly
              ? 'Saved locally. Switch to Global theme to apply everywhere.'
              : 'Saved';
            msgEl.className = isLocalOnly ? 'small text-warning me-auto' : 'small text-success me-auto';
          }
          setTimeout(function () {
            if (msgEl) { msgEl.textContent = ''; msgEl.className = 'small text-secondary me-auto'; }
            closeModal();
          }, isLocalOnly ? 2200 : 600);
        }).catch(function (err) {
          if (msgEl) {
            msgEl.textContent = (err && err.message) ? String(err.message) : 'Save failed';
            msgEl.className = 'small text-danger me-auto';
          }
        });
      }

      root.addEventListener('click', function (e) {
        var btn = e && e.target && e.target.closest ? e.target.closest('[data-theme-icon-edit]') : null;
        if (!btn) return;
        e.preventDefault();
        openModal(btn.getAttribute('data-theme-icon-edit') || '');
      });

      root.addEventListener('click', function (e) {
        var btn = e && e.target && e.target.closest ? e.target.closest('[data-theme-icon-save-glyph]') : null;
        if (!btn) return;
        e.preventDefault();
        var key = btn.getAttribute('data-theme-icon-save-glyph') || '';
        if (!key || ICON_GLYPH_KEYS.indexOf(key) < 0) return;
        var input = formEl.querySelector('[name="' + key + '"]');
        var msgEl = formEl.querySelector('[data-theme-icon-glyph-msg="' + key + '"]');
        if (!input) return;
        var rawVal = String(input.value != null ? input.value : '').trim();
        var val = normalizeIconGlyph(rawVal, DEFAULTS[key]);
        setStored(key, val);
        if (input) input.value = val;
        applyTheme(key, val);
        refreshIconPreviews(formEl);
        triggerIconThemeRefresh();
        var dbKey = key.replace(/-/g, '_');
        var payload = {};
        payload[dbKey] = (val != null && String(val).trim() !== '') ? String(val) : (DEFAULTS[key] || '');
        var isIconOnly = btn.classList.contains('kexo-icon-action-save');
        var originalText = isIconOnly ? '' : (btn.textContent || 'Save');
        btn.disabled = true;
        if (!isIconOnly) btn.textContent = 'Saving…';
        if (msgEl) { msgEl.textContent = ''; msgEl.className = 'small text-secondary ms-auto'; }
        saveToServer(payload).then(function () {
          if (msgEl) {
            var isLocalOnly = getPreferenceMode() !== 'global';
            msgEl.textContent = isLocalOnly ? 'Saved locally. Switch to Global to apply everywhere.' : 'Saved';
            msgEl.className = isLocalOnly ? 'small text-warning ms-auto' : 'small text-success ms-auto';
            setTimeout(function () { msgEl.textContent = ''; msgEl.className = 'small text-secondary ms-auto'; }, isLocalOnly ? 3500 : 2000);
          }
          if (!isIconOnly) {
            btn.textContent = 'Saved!';
btn.classList.remove('btn-md');
          btn.classList.add('btn-success');
          }
          setTimeout(function () {
            if (!isIconOnly) {
              btn.textContent = originalText;
              btn.classList.remove('btn-success');
              btn.classList.add('btn-md');
            }
            btn.disabled = false;
          }, 1200);
        }).catch(function (err) {
          if (!isIconOnly) btn.textContent = originalText;
          btn.disabled = false;
          if (msgEl) {
            msgEl.textContent = (err && err.message) ? String(err.message) : 'Save failed';
            msgEl.className = 'small text-danger ms-auto';
            setTimeout(function () { msgEl.textContent = ''; msgEl.className = 'small text-secondary ms-auto'; }, 4000);
          }
        });
      });

      saveBtn.addEventListener('click', function () {
        persistIconEdit(false);
      });
      clearBtn.addEventListener('click', function () {
        persistIconEdit(true);
      });
      if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
          e.preventDefault();
          closeModal();
        });
      }
      modalEl.addEventListener('click', function (e) {
        if (e.target === modalEl) closeModal();
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        var visible = modalEl.classList.contains('show') && modalEl.style.display !== 'none' && modalEl.getAttribute('aria-hidden') !== 'true';
        if (!visible) return;
        closeModal();
      });
    }

    formEl.addEventListener('change', function (e) {
      var name = e && e.target ? e.target.name : '';
      var rawVal = e && e.target && e.target.value != null ? String(e.target.value) : '';
      var val = name === 'theme-custom-css' ? rawVal : rawVal.trim();
      if (!name) return;
      if (ICON_STYLE_KEYS.indexOf(name) >= 0) val = normalizeIconStyle(val, DEFAULTS[name]);
      if (ICON_GLYPH_KEYS.indexOf(name) >= 0) val = normalizeIconGlyph(val, DEFAULTS[name]);
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
        var circle = formEl.querySelector('.kexo-accent-preview-circle[data-accent-sync="' + key + '"]');
        if (!hexInput) return;
        function updateAccentCircle(v) {
          var bg = (v && /^#[0-9a-fA-F]{3,8}$/.test(v)) ? v : '#e0e0e0';
          if (circle) try { circle.style.background = bg; } catch (_) {}
        }
        function syncFromHex() {
          var val = normalizeAccentHex(hexInput.value, ACCENT_DEFAULTS[ACCENT_HEX_KEYS.indexOf(key)]);
          setStored(key, val);
          debouncedApply(key, val);
          queueGlobalSaveKey(key);
          if (swatch) swatch.value = val;
          updateAccentCircle(val);
        }
        function syncFromSwatch() {
          if (swatch && swatch.value) {
            hexInput.value = swatch.value;
            setStored(key, swatch.value);
            debouncedApply(key, swatch.value);
            queueGlobalSaveKey(key);
            updateAccentCircle(swatch.value);
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

    ICON_STYLE_KEYS.concat(ICON_GLYPH_KEYS).concat(HEADER_THEME_TEXT_KEYS).concat(ACCENT_OPACITY_KEYS).concat(CUSTOM_CSS_KEYS).forEach(function (key) {
      var input = formEl.querySelector('[name="' + key + '"]');
      if (!input) return;
      input.addEventListener('input', function () {
        var rawVal = String(input.value || '');
        var val = key === 'theme-custom-css' ? rawVal : rawVal.trim();
        if (ICON_STYLE_KEYS.indexOf(key) >= 0) val = normalizeIconStyle(val, DEFAULTS[key]);
        if (ICON_GLYPH_KEYS.indexOf(key) >= 0) val = normalizeIconGlyph(val, DEFAULTS[key]);
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
    wireIconEditModal();

    function wireIconHelpPopovers() {
      var triggers = formEl.querySelectorAll('[data-theme-icon-help-trigger]');
      if (!triggers || !triggers.length) return;
      var Bootstrap = window.bootstrap || (window.tabler && window.tabler.bootstrap);
      if (!Bootstrap || !Bootstrap.Popover) return;
      triggers.forEach(function (trigger) {
        trigger.removeAttribute('title');
        trigger.removeAttribute('data-bs-title');
        trigger.removeAttribute('data-bs-original-title');
        var key = trigger.getAttribute('data-theme-icon-help-key') || '';
        var name = glyphNameFromThemeKey(key);
        var meta = glyphMetaFor(name);
        var helpText = (meta && meta.help) ? String(meta.help) : defaultIconHelpFor(name);
        if (!helpText) helpText = 'Icon shown in the app UI.';
        var contentHtml = '<div class="kexo-icon-help-popover-content">' +
          '<button type="button" class="btn-close kexo-icon-help-popover-close" aria-label="Close"></button>' +
          '<div class="kexo-icon-help-popover-text">' + escapeHtml(helpText) + '</div></div>';
        new Bootstrap.Popover(trigger, {
          title: '',
          content: contentHtml,
          html: true,
          trigger: 'click',
          placement: 'left',
          customClass: 'kexo-icon-help-popover',
          sanitize: false
        });
      });
      if (!window.__kexoIconHelpCloseBound) {
        window.__kexoIconHelpCloseBound = true;
        document.addEventListener('click', function (e) {
          var closeBtn = e.target && e.target.closest ? e.target.closest('.kexo-icon-help-popover .btn-close') : null;
          if (!closeBtn) return;
          var popoverEl = closeBtn.closest('.popover');
          if (!popoverEl || !popoverEl.id) return;
          var trigger = document.querySelector('[aria-describedby="' + popoverEl.id + '"]');
          var BootstrapRef = window.bootstrap || (window.tabler && window.tabler.bootstrap);
          if (trigger && BootstrapRef && BootstrapRef.Popover && BootstrapRef.Popover.getInstance(trigger)) BootstrapRef.Popover.getInstance(trigger).hide();
        });
      }
    }
    wireIconHelpPopovers();

    var root = formEl.parentElement || document;
    var refreshBtn = root.querySelector('#theme-icons-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      refreshIconPreviews(formEl);
      triggerIconThemeRefresh();
    });

    wireThemeSubTabs(root);
    wireThemeColorSubTabs(root);
    wireSaleNotificationPanel();
    wireCssVarOverridesPanel(formEl);
    syncUI();
    hydrateDetectedDevicesIconGroup(root);
    hydratePaymentMethodsIconGroup(root);
    hydrateVariantsIconGroup(root);
    hydrateAttributionIconGroup(root);
    try {
      if (!window.__kexoAttributionIconsListenerBound) {
        window.__kexoAttributionIconsListenerBound = true;
        window.addEventListener('kexo:attribution-icons-updated', function () {
          var form = document.getElementById('theme-settings-form');
          if (form) hydrateAttributionIconGroup(form);
        });
        window.addEventListener('kexo:payment-icons-updated', function () {
          var form = document.getElementById('theme-settings-form');
          if (form) hydratePaymentMethodsIconGroup(form);
        });
        window.addEventListener('kexo:variants-icons-updated', function () {
          var form = document.getElementById('theme-settings-form');
          if (form) {
            hydrateVariantsIconGroup(form);
            hydrateAttributionIconGroup(form);
          }
        });
      }
    } catch (_) {}
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
    Promise.all([
      fetch(base + '/api/asset-overrides', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r && r.ok ? r.json() : null; }),
      fetch(base + '/api/settings', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r && r.ok ? r.json() : null; })
    ])
      .then(function (results) {
        var data = results[0];
        var settingsData = results[1] || {};
        if (!data || !data.ok) data = { ok: true, assetOverrides: {} };
        var overrides = data.assetOverrides || {};
        if (settingsData.notificationsPreferencesV1 && typeof settingsData.notificationsPreferencesV1 === 'object') {
          overrides.notificationsPreferencesV1 = settingsData.notificationsPreferencesV1;
        }

        var favicon = normalizeAssetOverrideUrl(overrides.favicon);
        if (favicon) applyFaviconOverride(favicon);

        var footerLogo = normalizeAssetOverrideUrl(overrides.footerLogo || overrides.footer_logo);
        if (footerLogo) applyImgSrcOverride('img[data-kexo-asset="footer-logo"]', footerLogo);

        var kexoLogoFull = normalizeAssetOverrideUrl(overrides.kexoLogoFullcolor || overrides.kexo_logo_fullcolor);
        if (kexoLogoFull) applyImgSrcOverride('img[src*="/assets/logos/new/kexo.webp"]', kexoLogoFull);

        // Legacy: if Theme header logo isn't set, fall back to assetOverrides.logo.
        var legacyHeaderLogo = normalizeAssetOverrideUrl(overrides.logo);
        if (legacyHeaderLogo) {
          var stored = '';
          try { stored = String(localStorage.getItem('theme-header-logo-url') || '').trim(); } catch (_) { stored = ''; }
          if (!stored) applyHeaderLogoOverride(legacyHeaderLogo);
        }
        try { populateSaleNotificationPanel(overrides); } catch (_) {}
      })
      .catch(function () {});
  }

  var SALE_SOUND_PRESETS = {
    kexo1: '/assets/ui-alert/1.mp3',
    kexo2: '/assets/ui-alert/2.wav',
    kexo3: '/assets/ui-alert/3.wav',
    kexo4: '/assets/ui-alert/4.mp3',
  };

  function populateSaleNotificationPanel(overrides) {
    var prefs = (overrides && overrides.notificationsPreferencesV1 && typeof overrides.notificationsPreferencesV1 === 'object')
      ? overrides.notificationsPreferencesV1
      : {};
    var prefKeys = ['daily_report', 'sale', 'sentry', 'pending_signup', 'diagnostics_unresolved'];
    prefKeys.forEach(function (key) {
      var el = document.querySelector('[data-notification-pref="' + key + '"]');
      if (!el) return;
      var val = prefs[key];
      el.checked = val !== false;
    });
    var url = ((overrides && overrides.saleSound) || (overrides && overrides.sale_sound) || '').trim();
    var presetSel = document.getElementById('settings-sale-sound-preset');
    var customWrap = document.getElementById('settings-sale-sound-custom-wrap');
    var urlInput = document.getElementById('settings-asset-sale-sound');
    if (!presetSel) return;
    var presetKeys = Object.keys(SALE_SOUND_PRESETS);
    var matched = '';
    if (url) {
      for (var i = 0; i < presetKeys.length; i++) {
        if (SALE_SOUND_PRESETS[presetKeys[i]] === url) {
          matched = presetKeys[i];
          break;
        }
      }
      if (!matched) {
        matched = 'custom';
        if (urlInput) urlInput.value = url;
      }
    } else {
      matched = 'kexo1';
    }
    presetSel.value = matched;
    if (customWrap) customWrap.style.display = matched === 'custom' ? 'block' : 'none';
  }

  function wireSaleNotificationPanel() {
    var form = document.getElementById('settings-sale-notification-form');
    if (!form) return;
    if (form.dataset.saleNotificationBound === '1') return;
    form.dataset.saleNotificationBound = '1';
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    function readNotificationPrefs() {
      var prefs = { daily_report: true, sale: true, sentry: true, pending_signup: true, diagnostics_unresolved: true };
      document.querySelectorAll('[data-notification-pref]').forEach(function (el) {
        var key = el.getAttribute('data-notification-pref');
        if (key && prefs.hasOwnProperty(key)) prefs[key] = el.checked;
      });
      return prefs;
    }
    function saveNotificationPrefs() {
      var prefs = readNotificationPrefs();
      return fetch(base + '/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationsPreferencesV1: prefs }),
      }).then(function (r) { return r && r.ok ? r.json() : null; });
    }
    document.querySelectorAll('[data-notification-pref]').forEach(function (el) {
      el.addEventListener('change', function () {
        saveNotificationPrefs().catch(function () {});
      });
    });
    var previewAudio = null;
    var previewAudioPrimed = false;
    var previewMsgTimer = null;

    function setSaleMsg(text, ok) {
      var el = document.getElementById('settings-sale-notification-msg');
      if (!el) return;
      el.textContent = text || '';
      if (ok === true) el.className = 'form-hint ms-2 text-success';
      else if (ok === false) el.className = 'form-hint ms-2 text-danger';
      else el.className = 'form-hint ms-2 text-secondary';
    }

    function setSaleMsgTemporary(text, ok, ms) {
      if (previewMsgTimer) {
        clearTimeout(previewMsgTimer);
        previewMsgTimer = null;
      }
      setSaleMsg(text, ok);
      if (!ms || ms <= 0) return;
      previewMsgTimer = setTimeout(function () {
        setSaleMsg('', null);
        previewMsgTimer = null;
      }, ms);
    }

    function getEffectiveSaleSoundUrl() {
      var preset = (document.getElementById('settings-sale-sound-preset') || {}).value || 'kexo1';
      if (preset !== 'custom') return SALE_SOUND_PRESETS[preset] || SALE_SOUND_PRESETS.kexo1;
      var raw = (document.getElementById('settings-asset-sale-sound') || {}).value || '';
      return raw.trim() || '';
    }

    function resolveSaleSoundUrl(url) {
      var out = url != null ? String(url).trim() : '';
      if (!out) return '';
      if (out.charAt(0) === '/') {
        var base = '';
        try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
        out = (base || window.location.origin || '') + out;
      }
      return out;
    }

    function ensurePreviewAudio() {
      if (previewAudio) return previewAudio;
      try {
        previewAudio = new Audio();
        previewAudio.preload = 'auto';
      } catch (_) {
        previewAudio = null;
      }
      return previewAudio;
    }

    function primePreviewAudio() {
      var a = ensurePreviewAudio();
      if (!a || previewAudioPrimed) return;
      previewAudioPrimed = true;
      var prevMuted = !!a.muted;
      var prevVol = (typeof a.volume === 'number' && isFinite(a.volume)) ? a.volume : 1;
      try { a.muted = true; } catch (_) {}
      try { a.volume = 0; } catch (_) {}
      try { a.load(); } catch (_) {}
      try {
        var p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(function () {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
          }).catch(function () {
            previewAudioPrimed = false;
          }).finally(function () {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
            try { a.muted = prevMuted; } catch (_) {}
            try { a.volume = prevVol; } catch (_) {}
          });
          return;
        }
      } catch (_) {
        previewAudioPrimed = false;
      }
      try { a.pause(); } catch (_) {}
      try { a.currentTime = 0; } catch (_) {}
      try { a.muted = prevMuted; } catch (_) {}
      try { a.volume = prevVol; } catch (_) {}
    }

    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function (evt) {
      try { document.addEventListener(evt, primePreviewAudio, { once: true, capture: true }); } catch (_) {}
    });

    var presetSel = document.getElementById('settings-sale-sound-preset');
    var customWrap = document.getElementById('settings-sale-sound-custom-wrap');
    if (presetSel) {
      presetSel.addEventListener('change', function () {
        var v = (this.value || '').trim();
        if (customWrap) customWrap.style.display = v === 'custom' ? 'block' : 'none';
      });
    }

    document.body.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('#settings-sale-sound-preview') : null;
      if (!btn) return;
      e.preventDefault();
      var url = resolveSaleSoundUrl(getEffectiveSaleSoundUrl());
      if (!url) {
        setSaleMsgTemporary('Select a sale sound first.', false, 2200);
        return;
      }
      try {
        if (typeof window.__kexoPreviewSaleSound === 'function') {
          var run = window.__kexoPreviewSaleSound(url);
          if (run && typeof run.catch === 'function') {
            run.catch(function (err) {
              console.warn('[KEXO] Sale sound preview (runtime) failed', err);
              setSaleMsgTemporary('Preview failed. Tap once then try again.', false, 2800);
            });
          }
          return;
        }
        var a = ensurePreviewAudio();
        if (!a) {
          setSaleMsgTemporary('Preview failed. Audio is unavailable.', false, 2600);
          return;
        }
        if (String(a.src || '') !== url) {
          a.src = url;
        }
        try { a.load(); } catch (_) {}
        try { a.currentTime = 0; } catch (_) {}
        var p = a.play();
        if (p && typeof p.catch === 'function') {
          p.catch(function (err) {
            previewAudioPrimed = false;
            console.warn('[KEXO] Sale sound preview failed', err);
            setSaleMsgTemporary('Preview failed. Tap once then try again.', false, 2800);
          });
        }
      } catch (err) {
        console.warn('[KEXO] Sale sound preview error', err);
        setSaleMsgTemporary('Preview failed. Check sound URL/format.', false, 2800);
      }
    });

    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = getEffectiveSaleSoundUrl();
      setSaleMsg('Saving…', null);
      fetch(base + '/api/settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetOverrides: { saleSound: url || '' } }),
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (!r || !r.ok) {
            setSaleMsg((r && r.error) ? r.error : 'Save failed', false);
            return;
          }
          setSaleMsg('Saved.', true);
          try { window.__kexoSaleSoundOverrideUrl = url || ''; } catch (_) {}
          try { window.dispatchEvent(new CustomEvent('kexo:sale-sound-updated', { detail: { url: url } })); } catch (_) {}
        })
        .catch(function () {
          setSaleMsg('Save failed', false);
        });
    });
  }

  // Init
  var IS_SETTINGS_PAGE = document.body && document.body.getAttribute
    ? (document.body.getAttribute('data-page') === 'settings')
    : false;

  // Only apply theme JS-driven overrides on the Settings page.
  // Everywhere else, the page should follow server-injected /theme-vars.css to avoid inconsistent flashes.
  if (IS_SETTINGS_PAGE) {
    clearLockedIconOverrides();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindThemeButtons();
      // Settings page: never re-theme the DOM on load (prevents header/menu flip-flops).
      // We only sync localStorage + form UI; live preview happens on user edits.
      fetchDefaults({ apply: false, syncUI: IS_SETTINGS_PAGE });
      if (IS_SETTINGS_PAGE) injectSettingsThemePanel();
      fetchAssetOverridesAndApply();
    });
  } else {
    bindThemeButtons();
    fetchDefaults({ apply: false, syncUI: IS_SETTINGS_PAGE });
    if (IS_SETTINGS_PAGE) injectSettingsThemePanel();
    fetchAssetOverridesAndApply();
  }
})();
