/**
 * Runtime icon migration helper.
 * Converts Tabler icon classes and shared inline nav SVGs to Font Awesome icons.
 */
(function () {
  'use strict';

  var TI_TO_FA = {
    'settings': 'fa-jelly fa-regular fa-gear',
    'settings-2': 'fa-jelly fa-regular fa-sliders',
    'palette': 'fa-jelly fa-regular fa-palette',
    'photo': 'fa-jelly fa-regular fa-image',
    'chart-bar': 'fa-jelly fa-regular fa-chart-column',
    'chart-dots': 'fa-jelly fa-regular fa-chart-line',
    'plug': 'fa-jelly fa-regular fa-plug',
    'map-2': 'fa-jelly fa-regular fa-map-location-dot',
    'gauge': 'fa-jelly fa-regular fa-gauge-high',
    'refresh': 'fa-jelly fa-regular fa-rotate-right',
    'adjustments': 'fa-jelly fa-regular fa-sliders',
    'menu-2': 'fa-jelly fa-regular fa-bars',
    'calendar': 'fa-jelly fa-regular fa-calendar-days',
    'volume': 'fa-jelly fa-regular fa-volume-high',
    'volume-off': 'fa-jelly fa-regular fa-volume-xmark',
    'logout': 'fa-jelly fa-regular fa-right-from-bracket',
    'chevron-down': 'fa-jelly fa-regular fa-chevron-down',
    'trending-up': 'fa-jelly fa-regular fa-arrow-trend-up',
    'trending-down': 'fa-jelly fa-regular fa-arrow-trend-down',
    'minus': 'fa-jelly fa-regular fa-minus',
    'x': 'fa-jelly fa-regular fa-xmark',
    'download': 'fa-jelly fa-regular fa-download',
    'info-circle': 'fa-jelly fa-regular fa-circle-info',
    'list': 'fa-jelly fa-regular fa-list',
    'user': 'fa-jelly fa-regular fa-user',
    'link': 'fa-jelly fa-regular fa-link',
    'cloud': 'fa-jelly fa-regular fa-cloud',
    'percentage': 'fa-jelly fa-regular fa-percent',
    'package': 'fa-jelly fa-regular fa-box-open',
    'users': 'fa-jelly fa-regular fa-users',
    'currency-pound': 'fa-jelly fa-regular fa-sterling-sign',
    'click': 'fa-jelly fa-regular fa-hand-pointer',
    'eye-off': 'fa-jelly fa-regular fa-eye-slash'
  };

  function replaceTiIcons(root) {
    var nodes = (root || document).querySelectorAll('i[class*="ti "]');
    nodes.forEach(function (el) {
      var tiName = '';
      Array.prototype.forEach.call(el.classList, function (cls) {
        if (cls.indexOf('ti-') === 0) tiName = cls.slice(3);
      });
      if (!tiName) return;
      var fa = TI_TO_FA[tiName] || 'fa-jelly fa-regular fa-circle';
      var preserve = [];
      Array.prototype.forEach.call(el.classList, function (cls) {
        if (cls === 'ti' || cls.indexOf('ti-') === 0) return;
        preserve.push(cls);
      });
      el.className = preserve.join(' ').trim();
      fa.split(/\s+/).forEach(function (c) { if (c) el.classList.add(c); });
      el.classList.add('fa-fw', 'fa-jelly');
      el.setAttribute('data-icon-lib', 'font-awesome');
    });
  }

  function navContextToFa(el) {
    var owner = el.closest('[id],[data-nav],a,button') || el.parentElement || el;
    var id = (owner && owner.id) ? owner.id : '';
    var nav = owner && owner.getAttribute ? owner.getAttribute('data-nav') : '';
    var text = owner && owner.textContent ? owner.textContent.toLowerCase() : '';

    if (id === 'theme-settings-btn' || text.indexOf('theme') >= 0) return 'fa-jelly fa-regular fa-palette';
    if (id === 'config-open-btn' || text.indexOf('diagnostics') >= 0 || text.indexOf('settings') >= 0) return 'fa-jelly fa-regular fa-gear';
    if (id === 'refresh-btn' || text.indexOf('refresh') >= 0) return 'fa-jelly fa-regular fa-rotate-right';
    if (id === 'audio-mute-btn' || text.indexOf('sound') >= 0) return 'fa-jelly fa-regular fa-volume-high';
    if (id === 'logout-btn' || text.indexOf('sign out') >= 0) return 'fa-jelly fa-regular fa-right-from-bracket';
    if (id === 'mobile-date-btn' || id === 'kexo-date-display' || text.indexOf('date') >= 0) return 'fa-jelly fa-regular fa-calendar-days';
    if (id === 'footer-last-sale-toggle') return 'fa-jelly fa-regular fa-eye';

    if (nav === 'dashboard' || id === 'nav-tab-dashboard') return 'fa-jelly fa-regular fa-gauge-high';
    if (nav === 'live' || id === 'nav-tab-spy') return 'fa-jelly fa-regular fa-satellite-dish';
    if (nav === 'sales' || id === 'nav-tab-sales') return 'fa-jelly fa-regular fa-cart-shopping';
    if (nav === 'date' || id === 'nav-tab-date') return 'fa-jelly fa-regular fa-table';
    if (nav === 'countries' || id === 'nav-tab-stats') return 'fa-jelly fa-regular fa-globe';
    if (nav === 'products' || id === 'nav-tab-products') return 'fa-jelly fa-regular fa-box-open';
    if (nav === 'channels' || id === 'nav-tab-channels') return 'fa-jelly fa-regular fa-diagram-project';
    if (nav === 'type' || id === 'nav-tab-type') return 'fa-jelly fa-regular fa-table-cells';
    if (nav === 'ads' || id === 'nav-tab-ads') return 'fa-jelly fa-regular fa-rectangle-ad';
    if (nav === 'tools' || id === 'nav-tab-tools') return 'fa-jelly fa-regular fa-toolbox';
    if (id === 'kexo-mobile-menu-btn') return 'fa-jelly fa-regular fa-bars';

    if (text.indexOf('dashboard') >= 0) return 'fa-jelly fa-regular fa-table-cells-large';
    if (text.indexOf('breakdown') >= 0) return 'fa-jelly fa-regular fa-chart-pie';
    if (text.indexOf('traffic') >= 0) return 'fa-jelly fa-regular fa-route';
    if (text.indexOf('integrations') >= 0) return 'fa-jelly fa-regular fa-puzzle-piece';
    if (text.indexOf('tools') >= 0) return 'fa-jelly fa-regular fa-screwdriver-wrench';

    return 'fa-jelly fa-regular fa-circle';
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

  function run(root) {
    replaceTiIcons(root);
    replaceSharedSvgIcons(root);
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
})();
