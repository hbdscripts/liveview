/**
 * Runtime icon migration helper.
 * Converts Tabler icon classes and shared inline nav SVGs to Font Awesome icons.
 */
(function () {
  'use strict';

  var ICON_STYLE_CLASSES = ['fa-light', 'fa-solid', 'fa-jelly', 'fa-jelly-filled'];
  var ICON_THEME_DEFAULTS = {
    iconDefault: 'fa-jelly',
    iconTopnav: 'fa-jelly-filled',
    iconDropdown: 'fa-jelly',
    iconSettingsMenu: 'fa-jelly-filled',
    iconTableHeading: 'fa-jelly-filled',
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
  };

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

  function normalizeIconStyle(value, fallback) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    if (!raw) return fallback;
    if (raw.indexOf('fa-jelly-filled') >= 0) return 'fa-jelly-filled';
    if (raw.indexOf('fa-jelly') >= 0) return 'fa-jelly';
    if (raw.indexOf('fa-solid') >= 0) return 'fa-solid';
    if (raw.indexOf('fa-light') >= 0) return 'fa-light';
    if (raw === 'jelly-filled') return 'fa-jelly-filled';
    if (raw === 'jelly') return 'fa-jelly';
    if (raw === 'solid') return 'fa-solid';
    if (raw === 'light') return 'fa-light';
    return fallback;
  }

  function normalizeIconGlyph(value, fallback) {
    var raw = value == null ? '' : String(value).trim().toLowerCase();
    if (!raw) return fallback;
    var m = raw.match(/fa-[a-z0-9-]+/);
    if (m && m[0]) return m[0];
    if (/^[a-z0-9-]+$/.test(raw)) return 'fa-' + raw;
    return fallback;
  }

  function readIconTheme() {
    function read(lsKey, fallback) {
      var v = null;
      try { v = localStorage.getItem(lsKey); } catch (_) { v = null; }
      return normalizeIconStyle(v, fallback);
    }
    return {
      iconDefault: read('tabler-theme-icon-default', ICON_THEME_DEFAULTS.iconDefault),
      iconTopnav: read('tabler-theme-icon-topnav', ICON_THEME_DEFAULTS.iconTopnav),
      iconDropdown: read('tabler-theme-icon-dropdown', ICON_THEME_DEFAULTS.iconDropdown),
      iconSettingsMenu: read('tabler-theme-icon-settings-menu', ICON_THEME_DEFAULTS.iconSettingsMenu),
      iconTableHeading: read('tabler-theme-icon-table-heading', ICON_THEME_DEFAULTS.iconTableHeading),
    };
  }

  function readIconGlyphTheme() {
    var out = {};
    Object.keys(ICON_GLYPH_DEFAULTS).forEach(function (key) {
      var lsKey = 'tabler-theme-icon-glyph-' + key;
      var raw = null;
      try { raw = localStorage.getItem(lsKey); } catch (_) { raw = null; }
      out[key] = normalizeIconGlyph(raw, ICON_GLYPH_DEFAULTS[key]);
    });
    return out;
  }

  function resolveIconContext(el) {
    if (!el || !(el instanceof Element)) return 'iconDefault';
    if (el.closest('.dropdown-menu .dropdown-item')) return 'iconDropdown';
    if (el.closest('.list-group-item[data-settings-tab]')) return 'iconSettingsMenu';
    if (el.closest('.grid-row--header .th-label-short')) return 'iconTableHeading';
    if (el.closest('.kexo-desktop-nav .nav-link.dropdown-toggle')) return 'iconTopnav';
    if (el.closest('.kexo-desktop-nav .kexo-date-btn')) return 'iconTopnav';
    return 'iconDefault';
  }

  function iconHasFaGlyph(el) {
    if (!el || !el.classList) return false;
    var hasFa = false;
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab') return;
      if (cls.indexOf('fa-') === 0) hasFa = true;
    });
    return hasFa;
  }

  function currentGlyphClass(el) {
    if (!el || !el.classList) return null;
    var glyph = null;
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls === 'fa-fw') return;
      if (ICON_STYLE_CLASSES.indexOf(cls) >= 0) return;
      if (cls.indexOf('fa-') === 0) glyph = cls;
    });
    return glyph;
  }

  function applyIconClasses(el, style, glyph) {
    if (!el || !el.classList) return;
    var keep = [];
    var hadFaFw = el.classList.contains('fa-fw');
    Array.prototype.forEach.call(el.classList, function (cls) {
      if (cls.indexOf('fa-') === 0) return;
      if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab') return;
      keep.push(cls);
    });
    el.className = keep.join(' ').trim();
    el.classList.add(style || ICON_THEME_DEFAULTS.iconDefault);
    el.classList.add(glyph || 'fa-circle');
    if (hadFaFw) el.classList.add('fa-fw');
  }

  function applyIconStyle(el, settings, glyphSettings) {
    if (!el || !iconHasFaGlyph(el)) return;
    if (el.hasAttribute && el.hasAttribute('data-theme-icon-preview')) return;
    if (el.hasAttribute && el.hasAttribute('data-theme-icon-preview-glyph')) return;
    if (el.classList.contains('fa-brands') || el.classList.contains('fab')) return;
    var ctx = resolveIconContext(el);
    var style = settings && settings[ctx] ? settings[ctx] : ICON_THEME_DEFAULTS.iconDefault;
    var iconKey = el.getAttribute ? (el.getAttribute('data-icon-key') || '') : '';
    var glyph = currentGlyphClass(el);
    if (iconKey) {
      glyph = glyphSettings && glyphSettings[iconKey] ? glyphSettings[iconKey] : (ICON_GLYPH_DEFAULTS[iconKey] || glyph);
    }
    applyIconClasses(el, style, glyph);
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
    var settings = readIconTheme();
    var glyphSettings = readIconGlyphTheme();
    var icons = (root || document).querySelectorAll('i');
    icons.forEach(function (el) { applyIconStyle(el, settings, glyphSettings); });
  }

  function run(root) {
    replaceTiIcons(root);
    replaceSharedSvgIcons(root);
    applyIconTheme(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { run(document); });
  } else {
    run(document);
  }

  var observer = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (!(n instanceof Element)) return;
        run(n);
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  try {
    window.KexoIconTheme = {
      refresh: function () { run(document); },
      getSettings: readIconTheme,
    };
    window.addEventListener('kexo:icon-theme-changed', function () { run(document); });
  } catch (_) {}
})();
