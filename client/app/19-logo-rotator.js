/**
 * Logo rotator: header/footer.
 * - Random (stable per-tab via sessionStorage) between curated assets.
 * - Single-init, no listeners beyond DOMContentLoaded.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__kexoLogoRotatorBound) return;
  window.__kexoLogoRotatorBound = true;

  var HEADER_VARIANTS = [
    '/assets/logos/new/light/1.png',
    '/assets/logos/new/light/2.png',
    '/assets/logos/new/light/3.png',
    '/assets/logos/new/light/4.png',
    '/assets/logos/new/light/5.png',
  ];
  var FOOTER_VARIANTS = [
    '/assets/logos/new/dark/1.png',
    '/assets/logos/new/dark/2.png',
    '/assets/logos/new/dark/3.png',
    '/assets/logos/new/dark/4.png',
    '/assets/logos/new/dark/5.png',
  ];

  function pickStable(slot, variants) {
    var list = Array.isArray(variants) ? variants.filter(Boolean) : [];
    if (!list.length) return '';
    var key = 'kexo:logo-variant:' + String(slot || 'slot');
    var existing = '';
    try { existing = sessionStorage.getItem(key) || ''; } catch (_) { existing = ''; }
    if (existing && list.indexOf(existing) >= 0) return existing;
    var idx = Math.floor(Math.random() * list.length);
    var chosen = list[Math.max(0, Math.min(list.length - 1, idx))] || list[0];
    try { sessionStorage.setItem(key, chosen); } catch (_) {}
    return chosen;
  }

  function setLogoImg(img, slot, variants) {
    if (!img || !img.getAttribute || !img.setAttribute) return;
    if (img.getAttribute('data-kexo-logo-rotated') === '1') {
      try {
        img.setAttribute('data-kexo-logo-ready', '1');
        if (img.hasAttribute && img.hasAttribute('hidden')) img.removeAttribute('hidden');
      } catch (_) {}
      return;
    }
    var chosen = pickStable(slot, variants);
    if (!chosen) return;
    try {
      if (String(img.getAttribute('src') || '') !== String(chosen)) img.setAttribute('src', chosen);
      img.setAttribute('data-kexo-logo-rotated', '1');
      img.setAttribute('data-kexo-logo-ready', '1');
      if (img.hasAttribute && img.hasAttribute('hidden')) img.removeAttribute('hidden');
    } catch (_) {}
  }

  function run() {
    // Header (desktop strip)
    var headerImg =
      document.querySelector('img[data-kexo-logo-slot="header"]') ||
      document.querySelector('.kexo-desktop-brand-link img');
    if (headerImg) setLogoImg(headerImg, 'header', HEADER_VARIANTS);

    // Footer
    var footerImg =
      document.querySelector('img[data-kexo-logo-slot="footer"]') ||
      document.querySelector('.kexo-footer-logo img');
    if (footerImg) setLogoImg(footerImg, 'footer', FOOTER_VARIANTS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

