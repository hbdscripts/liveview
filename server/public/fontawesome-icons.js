/**
 * Runtime icon migration helper.
 * Converts Tabler icon classes and shared inline nav SVGs to Font Awesome icons.
 */
(function () {
  'use strict';

  var ICON_STYLE_CLASSES = [
    'fa-light', 'fa-solid', 'fa-jelly', 'fa-jelly-filled', 'fa-brands',
    'fa-regular', 'fa-thin', 'fa-duotone', 'fa-sharp', 'fa-sharp-light',
    'fa-sharp-regular', 'fa-sharp-solid', 'fa-sharp-thin', 'fa-sharp-duotone'
  ];
  var ICON_THEME_DEFAULTS = {
    iconDefault: 'fa-light',
  };
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
  if (!Object.keys(ICON_GLYPH_DEFAULTS).length) {
    try { console.error('[fontawesome-icons] Missing icon registry payload from /icon-registry.js'); } catch (_) {}
  }

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
    var raw = String(spec == null ? '' : spec).trim().toLowerCase();
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
      if (ICON_STYLE_CLASSES.indexOf(t) >= 0 && !style) {
        style = t;
        return;
      }
      if (t.indexOf('fa-') === 0 && ICON_STYLE_CLASSES.indexOf(t) < 0 && !glyph) glyph = t;
    });
    if (!style) style = fallbackStyle;
    if (!glyph) glyph = 'fa-circle';
    return style + ' ' + glyph;
  }

  Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (k) {
    ICON_GLYPH_DEFAULTS[k] = withDefaultIconStyle(k, ICON_GLYPH_DEFAULTS[k]);
  });

  var TI_TO_FA = {
    'settings': 'fa-jelly fa-gear',
    'settings-2': 'fa-jelly fa-sliders',
    'palette': 'fa-jelly fa-palette',
    'photo': 'fa-jelly fa-image',
    'chart-bar': 'fa-jelly fa-chart-column',
    'chart-dots': 'fa-jelly fa-chart-line',
    'plug': 'fa-jelly fa-plug',
    'map-2': 'fa-jelly fa-map-location-dot',
    'gauge': 'fa-jelly fa-gauge-high',
    'refresh': 'fa-jelly fa-rotate-right',
    'adjustments': 'fa-jelly fa-sliders',
    'menu-2': 'fa-jelly fa-bars',
    'calendar': 'fa-jelly fa-calendar-days',
    'volume': 'fa-jelly fa-volume-high',
    'volume-off': 'fa-jelly fa-volume-xmark',
    'logout': 'fa-jelly fa-right-from-bracket',
    'chevron-down': 'fa-jelly fa-chevron-down',
    'trending-up': 'fa-jelly fa-arrow-trend-up',
    'trending-down': 'fa-jelly fa-arrow-trend-down',
    'minus': 'fa-jelly fa-minus',
    'x': 'fa-jelly fa-xmark',
    'download': 'fa-jelly fa-download',
    'info-circle': 'fa-jelly fa-circle-info',
    'list': 'fa-jelly fa-list',
    'user': 'fa-jelly fa-user',
    'link': 'fa-jelly fa-link',
    'cloud': 'fa-jelly fa-cloud',
    'percentage': 'fa-jelly fa-percent',
    'package': 'fa-jelly fa-box-open',
    'users': 'fa-jelly fa-users',
    'currency-pound': 'fa-jelly fa-sterling-sign',
    'click': 'fa-jelly fa-hand-pointer',
    'eye-off': 'fa-jelly fa-eye-slash'
  };

  var TABLE_ID_TO_ICON_KEY = {
    'dash-top-products': 'card-title-table-dash-top-products',
    'dash-top-countries': 'card-title-table-dash-top-countries',
    'dash-trending-up': 'card-title-table-dash-trending-up',
    'dash-trending-down': 'card-title-table-dash-trending-down',
    'latest-sales-table': 'card-title-table-latest-sales',
    'sessions-table': 'card-title-table-sessions',
    'country-table': 'card-title-table-country',
    'best-geo-products-table': 'card-title-table-country-product',
    'best-sellers-table': 'card-title-table-best-sellers',
    'best-variants-table': 'card-title-table-best-variants',
    'type-necklaces-table': 'card-title-table-necklaces',
    'type-bracelets-table': 'card-title-table-bracelets',
    'type-earrings-table': 'card-title-table-earrings',
    'type-sets-table': 'card-title-table-sets',
    'type-charms-table': 'card-title-table-charms',
    'type-extras-table': 'card-title-table-extras',
    'traffic-sources-table': 'card-title-table-channels',
    'traffic-types-table': 'card-title-table-device',
    'ads-root': 'card-title-table-ads'
  };

  var CARD_TITLE_ICON_RULES = [
    { key: 'card-title-online', test: /people online|online now|online trend/i, fa: 'fa-jelly-filled fa-users' },
    { key: 'card-title-revenue', test: /\brevenue\b|\brev\b|sales total|sales trend/i, fa: 'fa-jelly-filled fa-sterling-sign' },
    { key: 'card-title-orders', test: /\borders?\b|order trend|purchases?/i, fa: 'fa-jelly-filled fa-box-open' },
    { key: 'card-title-conversion', test: /\bconversion\b|\bcr(?:%| rate)?\b/i, fa: 'fa-jelly-filled fa-percent' },
    { key: 'card-title-sessions', test: /\bsessions?\b|session trend|visitors?/i, fa: 'fa-jelly-filled fa-users' },
    { key: 'card-title-countries', test: /\bcountr(?:y|ies)\b|\bgeo\b/i, fa: 'fa-jelly-filled fa-globe' },
    { key: 'card-title-products', test: /\bproducts?\b|\bvariants?\b|best sellers?/i, fa: 'fa-jelly-filled fa-box-open' },
    { key: 'card-title-channels', test: /\bchannels?\b|\bsources?\b|\butm\b/i, fa: 'fa-jelly-filled fa-diagram-project' },
    { key: 'card-title-type', test: /\btype\b|\bdevices?\b|\bbrowsers?\b|\bos\b/i, fa: 'fa-jelly-filled fa-table-cells' },
    { key: 'card-title-ads', test: /\bads?\b|\bcampaigns?\b|google ads/i, fa: 'fa-brands fa-google' },
    { key: 'card-title-tools', test: /\btools?\b|utilities?/i, fa: 'fa-jelly-filled fa-toolbox' },
    { key: 'card-title-settings', test: /\bsettings?\b|configuration|diagnostics?|theme/i, fa: 'fa-jelly-filled fa-gear' },
    { key: 'card-title-date', test: /\bdate\b|calendar|timeline|period/i, fa: 'fa-jelly-filled fa-calendar-days' },
    { key: 'card-title-dashboard', test: /dashboard|overview|kpi/i, fa: 'fa-jelly-filled fa-gauge-high' },
    { key: 'card-title-traffic', test: /\btraffic\b|\blive\b/i, fa: 'fa-jelly-filled fa-route' },
    { key: 'card-title-trending-up', test: /\btrending\s+up\b/i, fa: 'fa-jelly-filled fa-arrow-trend-up' },
    { key: 'card-title-trending-down', test: /\btrending\s+down\b/i, fa: 'fa-jelly-filled fa-arrow-trend-down' },
    { key: 'card-title-chart', test: /\bchart\b|trend|sparkline/i, fa: 'fa-jelly-filled fa-chart-line' }
  ];

  function pageDefaultCardIcon() {
    var page = '';
    try { page = (document.body && document.body.getAttribute('data-page')) || ''; } catch (_) { page = ''; }
    page = String(page || '').toLowerCase();
    if (page === 'dashboard') return { key: 'card-title-dashboard', fa: 'fa-jelly-filled fa-gauge-high' };
    if (page === 'live') return { key: 'card-title-traffic', fa: 'fa-jelly-filled fa-satellite-dish' };
    if (page === 'sales') return { key: 'card-title-orders', fa: 'fa-jelly-filled fa-cart-shopping' };
    if (page === 'date') return { key: 'card-title-date', fa: 'fa-jelly-filled fa-calendar-days' };
    if (page === 'countries') return { key: 'card-title-countries', fa: 'fa-jelly-filled fa-globe' };
    if (page === 'products') return { key: 'card-title-products', fa: 'fa-jelly-filled fa-box-open' };
    if (page === 'channels') return { key: 'card-title-channels', fa: 'fa-jelly-filled fa-diagram-project' };
    if (page === 'type') return { key: 'card-title-type', fa: 'fa-jelly-filled fa-table-cells' };
    if (page === 'ads') return { key: 'card-title-ads', fa: 'fa-jelly-filled fa-rectangle-ad' };
    if (page === 'tools') return { key: 'card-title-tools', fa: 'fa-jelly-filled fa-toolbox' };
    if (page === 'settings') return { key: 'card-title-settings', fa: 'fa-jelly-filled fa-gear' };
    return { key: 'card-title-chart', fa: 'fa-jelly-filled fa-circle-info' };
  }

  function resolveCardTitleIcon(cardTitleEl) {
    if (!cardTitleEl) return pageDefaultCardIcon();
    var card = cardTitleEl.closest ? cardTitleEl.closest('.card') : null;
    var tableId = (card && card.dataset && card.dataset.tableId) ? String(card.dataset.tableId).trim() : '';
    if (tableId) {
      var iconKey = TABLE_ID_TO_ICON_KEY[tableId];
      if (!iconKey && tableId.indexOf('variants-table-') === 0) iconKey = 'card-title-table-variants';
      if (iconKey) return { key: iconKey, fa: ICON_GLYPH_DEFAULTS[iconKey] || 'fa-jelly-filled fa-table-cells' };
    }
    var text = (cardTitleEl.textContent || '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < CARD_TITLE_ICON_RULES.length; i += 1) {
      var rule = CARD_TITLE_ICON_RULES[i];
      if (rule && rule.test && rule.test.test(text)) return { key: rule.key, fa: rule.fa };
    }
    return pageDefaultCardIcon();
  }

  function applyFaSpec(el, spec) {
    if (!el || !el.classList) return;
    var parts = String(spec || '').trim().split(/\s+/).filter(Boolean);
    var style = ICON_THEME_DEFAULTS.iconDefault;
    var glyph = 'fa-circle';
    var brand = false;
    parts.forEach(function (cls) {
      if (cls === 'fa-brands' || cls === 'fab') {
        brand = true;
        return;
      }
      if (ICON_STYLE_CLASSES.indexOf(cls) >= 0) {
        style = cls;
        return;
      }
      if (cls.indexOf('fa-') === 0) glyph = cls;
    });

    var keep = [];
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab' || cls === 'fat' || cls === 'fad' || cls === 'fa-brands') return;
      if (cls.indexOf('fa-') === 0) return;
      keep.push(cls);
    });
    el.className = keep.join(' ').trim();
    if (brand) el.classList.add('fa-brands');
    else el.classList.add(style || ICON_THEME_DEFAULTS.iconDefault);
    el.classList.add(glyph || 'fa-circle');
  }

  function ensureCardTitleIcons(root) {
    var page = '';
    try { page = (document.body && document.body.getAttribute('data-page') || '').trim().toLowerCase(); } catch (_) {}
    if (page === 'settings') return;
    var titles = (root || document).querySelectorAll('.card-header .card-title');
    titles.forEach(function (titleEl) {
      if (!titleEl || !titleEl.classList) return;
      if (titleEl.hasAttribute('data-no-title-icon')) return;
      var desired = resolveCardTitleIcon(titleEl);
      var iconEl = titleEl.querySelector('.kexo-card-title-icon');
      if (!iconEl) {
        var firstIcon = null;
        Array.prototype.forEach.call(titleEl.children || [], function (child) {
          if (!firstIcon && child && child.tagName === 'I') firstIcon = child;
        });
        if (firstIcon && !firstIcon.classList.contains('kexo-card-title-icon')) return;
        iconEl = document.createElement('i');
        iconEl.className = 'kexo-card-title-icon';
        iconEl.setAttribute('aria-hidden', 'true');
        iconEl.setAttribute('data-icon-lib', 'font-awesome');
        titleEl.insertBefore(iconEl, titleEl.firstChild);
      }
      try {
        if (desired && desired.key) iconEl.setAttribute('data-icon-key', desired.key);
      } catch (_) {}
      applyFaSpec(iconEl, desired && desired.fa ? desired.fa : desired);
    });
  }

  function normalizeIconStyle(value, fallback) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    if (!raw) return fallback;
    if (raw.indexOf('fa-jelly-filled') >= 0) return 'fa-jelly-filled';
    if (raw.indexOf('fa-jelly') >= 0) return 'fa-jelly';
    if (raw.indexOf('fa-solid') >= 0) return 'fa-solid';
    if (raw.indexOf('fa-light') >= 0) return 'fa-light';
    if (raw.indexOf('fa-brands') >= 0 || raw === 'brands' || raw === 'brand') return 'fa-brands';
    if (raw === 'jelly-filled') return 'fa-jelly-filled';
    if (raw === 'jelly') return 'fa-jelly';
    if (raw === 'solid') return 'fa-solid';
    if (raw === 'light') return 'fa-light';
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
    var raw = sanitizeIconClassString(rawInput).toLowerCase();
    var tokens = raw.split(/\s+/).filter(Boolean);
    var faTokens = tokens.filter(function (t) {
      return t === 'fa' || t.indexOf('fa-') === 0 || t === 'fas' || t === 'far' ||
        t === 'fal' || t === 'fab' || t === 'fat' || t === 'fad';
    });
    var hasExplicitStyle = tokens.some(isIconStyleToken);
    if (hasExplicitStyle || faTokens.length >= 2) {
      var fullTokens = tokens.slice();
      var hasGlyph = fullTokens.some(function (t) { return t.indexOf('fa-') === 0 && !isIconStyleToken(t); });
      var hasStyle = fullTokens.some(isIconStyleToken);
      if (!hasStyle) fullTokens.unshift(fallbackStyle || 'fa-light');
      if (!hasGlyph) fullTokens.push(fallbackGlyph || 'fa-circle');
      return { mode: 'full', value: sanitizeIconClassString(fullTokens.join(' ')), full: sanitizeIconClassString(fullTokens.join(' ')) };
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

  function clearLockedIconOverrides() {
    Object.keys(LOCKED_SETTINGS_ICON_KEYS).forEach(function (key) {
      try { localStorage.removeItem('tabler-theme-icon-glyph-' + key); } catch (_) {}
    });
  }

  function readIconGlyphTheme() {
    var out = {};
    Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (key) {
      var lsKey = 'tabler-theme-icon-glyph-' + key;
      var raw = null;
      if (isLockedSettingsIconKey(key)) {
        raw = null;
      } else {
        try { raw = localStorage.getItem(lsKey); } catch (_) { raw = null; }
      }
      out[key] = parseIconGlyphInput(raw, ICON_GLYPH_DEFAULTS[key]);
    });
    return out;
  }

  function readIconOverridesTheme() {
    var raw = null;
    try { raw = localStorage.getItem('tabler-' + ICON_OVERRIDES_JSON_KEY); } catch (_) { raw = null; }
    if (!raw) return {};
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return {};
    var out = {};
    Object.keys(parsed).forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(ICON_GLYPH_DEFAULTS, key)) return;
      var row = parsed[key];
      if (!row || typeof row !== 'object') return;
      var size = normalizeIconOverrideSize(row.size);
      var color = normalizeIconOverrideColor(row.color);
      if (!size && !color) return;
      out[key] = { size: size, color: color };
    });
    return out;
  }

  function currentIconSpec(el) {
    if (!el || !el.classList) return ICON_THEME_DEFAULTS.iconDefault + ' fa-circle';
    var style = ICON_THEME_DEFAULTS.iconDefault;
    var glyph = 'fa-circle';
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls === 'fa-fw') return;
      if (isIconStyleToken(cls)) {
        style = normalizeIconStyle(cls, ICON_THEME_DEFAULTS.iconDefault);
        return;
      }
      if (cls.indexOf('fa-') === 0 && !isIconStyleToken(cls)) glyph = cls;
    });
    return style + ' ' + glyph;
  }

  function faAliasToStyle(token) {
    if (token === 'fas') return 'fa-solid';
    if (token === 'far') return 'fa-regular';
    if (token === 'fal') return 'fa-light';
    if (token === 'fab') return 'fa-brands';
    if (token === 'fat') return 'fa-thin';
    if (token === 'fad') return 'fa-duotone';
    return token;
  }

  function applyFullOverrideClasses(el, fullSpec, fallbackSpec) {
    if (!el || !el.classList) return;
    var keep = [];
    var hadFaFw = el.classList.contains('fa-fw');
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls.indexOf('fa-') === 0) return;
      if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab' || cls === 'fat' || cls === 'fad') return;
      keep.push(cls);
    });
    var tokens = sanitizeIconClassString(fullSpec).toLowerCase().split(/\s+/).filter(Boolean);
    var faTokens = [];
    tokens.forEach(function (t) {
      if (t === 'fa') return;
      if (t === 'fas' || t === 'far' || t === 'fal' || t === 'fab' || t === 'fat' || t === 'fad') {
        faTokens.push(faAliasToStyle(t));
        return;
      }
      if (t.indexOf('fa-') === 0) faTokens.push(t);
    });
    var fallbackParsed = parseIconGlyphInput('', fallbackSpec || (ICON_THEME_DEFAULTS.iconDefault + ' fa-circle'));
    var fallbackStyle = ICON_THEME_DEFAULTS.iconDefault;
    var fallbackGlyph = 'fa-circle';
    sanitizeIconClassString(fallbackParsed.value).toLowerCase().split(/\s+/).filter(Boolean).forEach(function (t) {
      if (isIconStyleToken(t)) {
        fallbackStyle = normalizeIconStyle(t, ICON_THEME_DEFAULTS.iconDefault);
        return;
      }
      if (t.indexOf('fa-') === 0 && !isIconStyleToken(t)) fallbackGlyph = t;
    });
    if (!faTokens.length) faTokens.push(fallbackStyle, fallbackGlyph);
    var hasStyle = faTokens.some(function (t) { return isIconStyleToken(t); });
    if (!hasStyle) faTokens.unshift(fallbackStyle);
    var hasGlyph = faTokens.some(function (t) { return t.indexOf('fa-') === 0 && !isIconStyleToken(t); });
    if (!hasGlyph) faTokens.push(fallbackGlyph || 'fa-circle');
    el.className = keep.concat(faTokens).join(' ').trim();
    if (hadFaFw) el.classList.add('fa-fw');
  }

  function applyElementOverrideStyles(el, override) {
    if (!el || !el.style) return;
    var size = override && override.size ? normalizeIconOverrideSize(override.size) : '';
    var color = override && override.color ? normalizeIconOverrideColor(override.color) : '';
    if (size) el.style.fontSize = size;
    else el.style.removeProperty('font-size');
    if (color) el.style.color = color;
    else el.style.removeProperty('color');
  }

  function applySvgOverrideMarkup(el, svgMarkup, override) {
    if (!el || !el.classList) return;
    var keep = [];
    var hadFaFw = el.classList.contains('fa-fw');
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls.indexOf('fa-') === 0) return;
      if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab' || cls === 'fat' || cls === 'fad') return;
      if (cls === 'kexo-svg-icon-host') return;
      keep.push(cls);
    });
    el.className = keep.concat(['fa', 'kexo-svg-icon-host']).join(' ').trim();
    if (hadFaFw) el.classList.add('fa-fw');
    el.setAttribute('data-kexo-icon-mode', 'svg');
    el.innerHTML = svgMarkup;
    applyElementOverrideStyles(el, override);

    var svgEl = el.querySelector('svg');
    if (!svgEl) return;
    var size = (override && override.size) ? normalizeIconOverrideSize(override.size) : '1em';
    if (!size) size = '1em';
    try {
      svgEl.removeAttribute('width');
      svgEl.removeAttribute('height');
      svgEl.setAttribute('width', size);
      svgEl.setAttribute('height', size);
      svgEl.style.width = size;
      svgEl.style.height = size;
      svgEl.style.display = 'inline-block';
      svgEl.style.verticalAlign = '-0.125em';
      svgEl.style.fill = 'currentColor';
    } catch (_) {}
  }

  function applyIconStyle(el, glyphSettings, overrideSettings) {
    if (!el) return;
    if (el.hasAttribute && el.hasAttribute('data-theme-icon-preview')) return;
    if (el.hasAttribute && el.hasAttribute('data-theme-icon-preview-glyph')) return;
    var iconKey = el.getAttribute ? (el.getAttribute('data-icon-key') || '') : '';
    if (!iconKey) return;
    var fallbackSpec = ICON_GLYPH_DEFAULTS[iconKey] || currentIconSpec(el);
    var parsed = glyphSettings && glyphSettings[iconKey] ? glyphSettings[iconKey] : parseIconGlyphInput(null, fallbackSpec);
    var override = overrideSettings && overrideSettings[iconKey] ? overrideSettings[iconKey] : null;
    if (parsed && parsed.mode === 'svg') {
      applySvgOverrideMarkup(el, parsed.value, override);
      return;
    }
    if (el.getAttribute && el.getAttribute('data-kexo-icon-mode') === 'svg') {
      el.removeAttribute('data-kexo-icon-mode');
      try { el.innerHTML = ''; } catch (_) {}
      try { el.classList.remove('kexo-svg-icon-host'); } catch (_) {}
    }
    applyFullOverrideClasses(el, parsed && parsed.value ? parsed.value : fallbackSpec, fallbackSpec);
    applyElementOverrideStyles(el, override);
  }

  function replaceTiIcons(root) {
    var nodes = (root || document).querySelectorAll('i[class*="ti "]');
    nodes.forEach(function (el) {
      var tiName = '';
      Array.prototype.forEach.call(el.classList, function (cls) {
        if (cls.indexOf('ti-') === 0) tiName = cls.slice(3);
      });
      if (!tiName) return;
      var fa = TI_TO_FA[tiName] || 'fa-jelly fa-circle';
      var preserve = [];
      Array.prototype.forEach.call(el.classList, function (cls) {
        if (cls === 'ti' || cls.indexOf('ti-') === 0) return;
        preserve.push(cls);
      });
      el.className = preserve.join(' ').trim();
      fa.split(/\s+/).forEach(function (c) { if (c) el.classList.add(c); });
      el.classList.add('fa-fw');
      el.setAttribute('data-icon-lib', 'font-awesome');
    });
  }

  function navContextToFa(el) {
    var owner = el.closest('[id],[data-nav],a,button') || el.parentElement || el;
    var id = (owner && owner.id) ? owner.id : '';
    var nav = owner && owner.getAttribute ? owner.getAttribute('data-nav') : '';
    var text = owner && owner.textContent ? owner.textContent.toLowerCase() : '';

    if (id === 'theme-settings-btn' || text.indexOf('theme') >= 0) return 'fa-jelly fa-palette';
    if (id === 'config-open-btn' || text.indexOf('diagnostics') >= 0 || text.indexOf('settings') >= 0) return 'fa-jelly fa-gear';
    if (id === 'refresh-btn' || text.indexOf('refresh') >= 0) return 'fa-jelly fa-rotate-right';
    if (id === 'audio-mute-btn' || text.indexOf('sound') >= 0) return 'fa-jelly fa-volume-high';
    if (id === 'logout-btn' || text.indexOf('sign out') >= 0) return 'fa-jelly fa-right-from-bracket';
    if (id === 'mobile-date-btn' || id === 'kexo-date-display' || text.indexOf('date') >= 0) return 'fa-jelly fa-calendar-days';
    if (id === 'footer-last-sale-toggle') return 'fa-jelly fa-eye';

    if (nav === 'dashboard' || id === 'nav-tab-dashboard') return 'fa-jelly-filled fa-gauge-high';
    if (nav === 'live' || id === 'nav-tab-spy') return 'fa-jelly-filled fa-satellite-dish';
    if (nav === 'sales' || id === 'nav-tab-sales') return 'fa-jelly-filled fa-cart-shopping';
    if (nav === 'date' || id === 'nav-tab-date') return 'fa-jelly-filled fa-table';
    if (nav === 'countries' || id === 'nav-tab-stats') return 'fa-jelly-filled fa-globe';
    if (nav === 'products' || id === 'nav-tab-products') return 'fa-jelly-filled fa-box-open';
    if (nav === 'channels' || id === 'nav-tab-channels') return 'fa-jelly-filled fa-diagram-project';
    if (nav === 'type' || id === 'nav-tab-type') return 'fa-jelly-filled fa-table-cells';
    if (nav === 'ads' || id === 'nav-tab-ads') return 'fa-jelly-filled fa-rectangle-ad';
    if (nav === 'tools' || id === 'nav-tab-tools') return 'fa-jelly-filled fa-toolbox';
    if (id === 'kexo-mobile-menu-btn') return 'fa-jelly fa-bars';

    if (text.indexOf('dashboard') >= 0) return 'fa-jelly-filled fa-table-cells-large';
    if (text.indexOf('breakdown') >= 0) return 'fa-jelly-filled fa-chart-pie';
    if (text.indexOf('traffic') >= 0) return 'fa-jelly-filled fa-route';
    if (text.indexOf('integrations') >= 0) return 'fa-jelly-filled fa-puzzle-piece';
    if (text.indexOf('tools') >= 0) return 'fa-jelly-filled fa-screwdriver-wrench';

    return 'fa-jelly fa-circle';
  }

  function replaceSharedSvgIcons(root) {
    var nodes = (root || document).querySelectorAll('svg.kexo-nav-svg');
    nodes.forEach(function (svg) {
      var i = document.createElement('i');
      var fa = navContextToFa(svg);
      fa.split(/\s+/).forEach(function (c) { if (c) i.classList.add(c); });
      i.classList.add('kexo-nav-svg', 'fa-fw');
      if (svg.classList.contains('me-1')) i.classList.add('me-1');
      if (svg.classList.contains('me-2')) i.classList.add('me-2');
      if (svg.getAttribute('aria-hidden') === 'true') i.setAttribute('aria-hidden', 'true');
      i.setAttribute('data-icon-lib', 'font-awesome');
      svg.replaceWith(i);
    });
  }

  function applyIconTheme(root) {
    var glyphSettings = readIconGlyphTheme();
    var overrideSettings = readIconOverridesTheme();
    var icons = (root || document).querySelectorAll('i');
    icons.forEach(function (el) { applyIconStyle(el, glyphSettings, overrideSettings); });
  }

  function applyIconToElement(el) {
    if (!el || !(el instanceof Element)) return;
    var glyphSettings = readIconGlyphTheme();
    var overrideSettings = readIconOverridesTheme();
    applyIconStyle(el, glyphSettings, overrideSettings);
  }

  function waitForIconAssetsReady() {
    if (!document.fonts || !document.fonts.ready || typeof document.fonts.ready.then !== 'function') {
      return Promise.resolve();
    }
    return document.fonts.ready.then(function () {}).catch(function () {});
  }

  function run(root) {
    replaceTiIcons(root);
    replaceSharedSvgIcons(root);
    ensureCardTitleIcons(root);
    applyIconTheme(root);
  }

  var observer = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (!(n instanceof Element)) return;
        run(n);
      });
    });
  });
  var didBoot = false;
  function bootWhenReady() {
    if (didBoot) return;
    didBoot = true;
    clearLockedIconOverrides();
    waitForIconAssetsReady().then(function () {
      run(document);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWhenReady);
  } else {
    bootWhenReady();
  }

  try {
    window.KexoIconTheme = {
      refresh: function () { run(document); },
      applyElement: applyIconToElement,
    };
    window.addEventListener('kexo:icon-theme-changed', function () { run(document); });
  } catch (_) {}
})();
