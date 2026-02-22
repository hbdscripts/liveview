/**
 * Load kexo-tooltips.js app-wide (when not already loaded, e.g. on Settings)
 * and init tooltips + help popovers on document.body.
 */
(function () {
  'use strict';

  function run() {
    if (typeof window.initKexoTooltips === 'function' && typeof window.initKexoHelpPopovers === 'function') {
      try {
        window.initKexoTooltips(document.body);
        window.initKexoHelpPopovers(document.body);
      } catch (_) {}
      return;
    }
    var script = document.createElement('script');
    script.src = '/kexo-tooltips.js';
    script.async = false;
    script.onload = function () {
      try {
        if (typeof window.initKexoTooltips === 'function') window.initKexoTooltips(document.body);
        if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(document.body);
      } catch (_) {}
    };
    document.head.appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
