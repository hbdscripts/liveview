/**
 * Logo rotator: header/footer.
 * - Random per page load (server picks an existing variant).
 * - Single-init, no listeners beyond DOMContentLoaded.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__kexoLogoRotatorBound) return;
  window.__kexoLogoRotatorBound = true;

  function setLogoImg(img, url) {
    if (!img || !img.getAttribute || !img.setAttribute) return;
    if (img.getAttribute('data-kexo-logo-rotated') === '1') {
      try {
        img.setAttribute('data-kexo-logo-ready', '1');
        if (img.hasAttribute && img.hasAttribute('hidden')) img.removeAttribute('hidden');
      } catch (_) {}
      return;
    }
    if (!url) return;
    try {
      if (String(img.getAttribute('src') || '') !== String(url)) img.setAttribute('src', url);
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
    if (headerImg) setLogoImg(headerImg, '/api/header-logo');

    // Footer
    var footerImg =
      document.querySelector('img[data-kexo-logo-slot="footer"]') ||
      document.querySelector('.kexo-footer-logo img');
    if (footerImg) setLogoImg(footerImg, '/api/footer-logo');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

