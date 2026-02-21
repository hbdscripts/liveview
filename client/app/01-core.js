const API = '';
    const PAGE = (document.body && document.body.getAttribute('data-page')) || '';
    try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext(PAGE || 'unknown', { page: PAGE || 'unknown' }); } catch (_) {}
    try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('app', 'init', { page: PAGE }); } catch (_) {}
    function captureChartError(err, context, extra) {
      try {
        if (typeof window.kexoCaptureError !== 'function') return;
        var payload = {
          context: context || 'chart',
          page: PAGE || 'unknown'
        };
        if (extra && typeof extra === 'object') {
          Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        }
        window.kexoCaptureError(err, payload);
      } catch (_) {}
    }
    function captureChartMessage(message, context, extra, level) {
      try {
        if (typeof window.kexoCaptureMessage !== 'function') return;
        var payload = {
          context: context || 'chart',
          page: PAGE || 'unknown'
        };
        if (extra && typeof extra === 'object') {
          Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
        }
        window.kexoCaptureMessage(String(message || ''), payload, level || 'error');
      } catch (_) {}
    }
    const PAGE_LOADER_ENABLED_LS_KEY = 'kexo:page-loader-enabled:v1';

    function defaultPageLoaderEnabledV1() {
      return {
        v: 1,
        pages: {
          dashboard: true,
          live: true,
          sales: true,
          date: true,
          // Snapshot uses its own in-card loaders and never calls report-build finish().
          snapshot: false,
          countries: true,
          products: true,
          variants: true,
          'abandoned-carts': true,
          attribution: true,
          devices: true,
          ads: true,
          'compare-conversion-rate': true,
          'shipping-cr': true,
          'click-order-lookup': true,
          'change-pins': true,
          // Settings must never show the page overlay loader.
          settings: false,
          // Upgrade page is a static marketing/TODO page; never show the overlay loader there.
          upgrade: false,
          // Admin must never show the overlay loader.
          admin: false,
        },
      };
    }

    function normalizePageLoaderEnabledV1(cfg) {
      const base = defaultPageLoaderEnabledV1();
      const out = { v: 1, pages: Object.assign({}, base.pages) };
      if (!cfg || typeof cfg !== 'object') return out;
      if (Number(cfg.v) !== 1) return out;
      const pages = cfg.pages && typeof cfg.pages === 'object' ? cfg.pages : null;
      if (!pages) return out;
      Object.keys(out.pages).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(pages, key)) return;
        out.pages[key] = pages[key] === false ? false : true;
      });
      // Backwards compatibility: legacy Traffic pages.
      if (typeof out.pages.attribution !== 'boolean' && typeof pages.channels === 'boolean') out.pages.attribution = pages.channels !== false;
      if (typeof out.pages.devices !== 'boolean' && typeof pages.type === 'boolean') out.pages.devices = pages.type !== false;
      out.pages.settings = false;
      out.pages.admin = false;
      out.pages.snapshot = false;
      return out;
    }

    var pageLoaderEnabledV1 = null;
    try {
      var cachedLoaderCfg = safeReadLocalStorageJson(PAGE_LOADER_ENABLED_LS_KEY);
      if (cachedLoaderCfg && cachedLoaderCfg.v === 1) {
        pageLoaderEnabledV1 = normalizePageLoaderEnabledV1(cachedLoaderCfg);
      }
    } catch (_) {}
    if (!pageLoaderEnabledV1) pageLoaderEnabledV1 = defaultPageLoaderEnabledV1();

    function applyPageLoaderEnabledV1(cfg) {
      pageLoaderEnabledV1 = normalizePageLoaderEnabledV1(cfg);
      try { window.__kexoPageLoaderEnabledV1 = pageLoaderEnabledV1; } catch (_) {}
      try { safeWriteLocalStorageJson(PAGE_LOADER_ENABLED_LS_KEY, pageLoaderEnabledV1); } catch (_) {}
      return pageLoaderEnabledV1;
    }

    function isPageLoaderEnabled(pageKey) {
      var k = String(pageKey == null ? '' : pageKey).trim().toLowerCase();
      if (!k) k = String(PAGE || '').trim().toLowerCase();
      if (!k) return true;
      if (k === 'settings') return false;
      if (k === 'admin') return false;
      if (k === 'snapshot') return false;
      var cfg = pageLoaderEnabledV1;
      var pages = cfg && cfg.pages && typeof cfg.pages === 'object' ? cfg.pages : null;
      if (!pages) return true;
      if (!Object.prototype.hasOwnProperty.call(pages, k)) return true;
      return pages[k] !== false;
    }

    try { window.__kexoIsPageLoaderEnabled = isPageLoaderEnabled; } catch (_) {}
    try { window.__kexoApplyPageLoaderEnabledV1 = applyPageLoaderEnabledV1; } catch (_) {}

    var _silentOverlayDepth = 0;
    function kexoWithSilentOverlay(fn) {
      _silentOverlayDepth = Math.max(0, Number(_silentOverlayDepth || 0)) + 1;
      try { return fn(); }
      finally { _silentOverlayDepth = Math.max(0, Number(_silentOverlayDepth || 0) - 1); }
    }
    function kexoSilentOverlayActive() {
      return Number(_silentOverlayDepth || 0) > 0;
    }
    try { window.__kexoWithSilentOverlay = kexoWithSilentOverlay; } catch (_) {}
    try { window.__kexoSilentOverlayActive = kexoSilentOverlayActive; } catch (_) {}

    // Change Pins (timeline annotations) — cached for dashboard chart overlays.
    var _changePinsCache = null;
    var _changePinsFetchedAt = 0;
    var _changePinsInFlight = null;
    var CHANGE_PINS_CACHE_TTL_MS = 60 * 1000;

    function fetchChangePinsRecent(days) {
      var d = (typeof days === 'number' && isFinite(days)) ? Math.max(7, Math.min(400, Math.floor(days))) : 120;
      var url = API + '/api/tools/change-pins/recent?days=' + encodeURIComponent(String(d));
      return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return (r && r.ok) ? r.json().catch(function () { return null; }) : null; })
        .then(function (json) {
          var pins = json && json.ok && Array.isArray(json.pins) ? json.pins : null;
          if (!pins) return null;
          _changePinsCache = pins;
          _changePinsFetchedAt = Date.now();
          return pins;
        })
        .catch(function (err) {
          try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'changePins.fetch' }); } catch (_) {}
          return null;
        });
    }

    function getChangePinsRecent(days, force) {
      var fresh = _changePinsCache && _changePinsFetchedAt && (Date.now() - _changePinsFetchedAt) < CHANGE_PINS_CACHE_TTL_MS;
      if (!force && fresh) return Promise.resolve(_changePinsCache);
      if (_changePinsInFlight) return _changePinsInFlight;
      _changePinsInFlight = fetchChangePinsRecent(days).finally(function () { _changePinsInFlight = null; });
      return _changePinsInFlight;
    }

    try { window.__kexoGetChangePinsRecent = getChangePinsRecent; } catch (_) {}
    try { window.__kexoReadChangePinsRecentCache = function () { return _changePinsCache; }; } catch (_) {}

    // ?????? Admin preview mode (UI-only) ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    // Preview is an admin tool: it affects client UI gating only and cannot bypass server auth.
    const PREVIEW_LS_KEY = 'kexo:preview:v1';
    function normalizePreviewTier(raw) {
      var t = raw == null ? '' : String(raw).trim().toLowerCase();
      if (!t) return '';
      var allowed = new Set(['starter', 'growth', 'scale', 'max', 'admin']);
      return allowed.has(t) ? t : '';
    }
    function previewTierLabel(tier) {
      var t = normalizePreviewTier(tier);
      if (t === 'starter') return 'Starter';
      if (t === 'growth') return 'Growth';
      if (t === 'scale') return 'Scale';
      if (t === 'max') return 'Max';
      if (t === 'admin') return 'Admin';
      return '';
    }
    function readPreviewConfig() {
      try {
        var raw = localStorage.getItem(PREVIEW_LS_KEY);
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        if (Number(parsed.v) !== 1) return null;
        if (parsed.enabled !== true) return null;
        var tier = normalizePreviewTier(parsed.tier);
        if (!tier) return null;
        return { v: 1, enabled: true, tier: tier };
      } catch (_) {
        return null;
      }
    }
    function writePreviewConfig(tierOrOff) {
      var tier = normalizePreviewTier(tierOrOff);
      if (!tier) {
        try { localStorage.removeItem(PREVIEW_LS_KEY); } catch (_) {}
        return '';
      }
      try { localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify({ v: 1, enabled: true, tier: tier })); } catch (_) {}
      return tier;
    }
    function clearPreviewConfig() {
      try { localStorage.removeItem(PREVIEW_LS_KEY); } catch (_) {}
    }
    function isAdminLikeRole(raw) {
      var r = raw == null ? '' : String(raw).trim().toLowerCase();
      // Backwards-compatible while Master???Admin migration rolls out.
      return r === 'admin' || r === 'master';
    }
    function isRealAdminViewer(me) {
      if (!me || typeof me !== 'object') return false;
      if (me.isMaster === true) return true;
      return isAdminLikeRole(me.role);
    }
    function getEffectiveViewer(realMe) {
      var me = (realMe && typeof realMe === 'object') ? realMe : (window.__kexoMe && typeof window.__kexoMe === 'object' ? window.__kexoMe : null);
      var realIsAdmin = isRealAdminViewer(me);
      var previewStored = readPreviewConfig();
      var preview = null;
      if (realIsAdmin) preview = previewStored;
      else if (me && previewStored) {
        // Safety: preview should not leak into normal user sessions.
        clearPreviewConfig();
      }
      var previewTier = preview && preview.tier ? String(preview.tier) : '';
      var previewEnabled = !!previewTier;
      var effectiveIsAdmin = realIsAdmin;
      if (previewEnabled) effectiveIsAdmin = previewTier === 'admin';
      var tier = previewEnabled
        ? previewTier
        : (me && me.tier != null ? String(me.tier).trim().toLowerCase() : '');
      var permissions = (me && me.permissions && typeof me.permissions === 'object') ? me.permissions : {};
      return {
        email: me && me.email ? String(me.email) : null,
        role: effectiveIsAdmin ? 'admin' : 'user',
        tier: tier || null,
        isAdmin: effectiveIsAdmin,
        // Keep legacy name for existing code paths.
        isMaster: effectiveIsAdmin,
        permissions: permissions,
        preview: { enabled: previewEnabled, tier: previewTier || '' },
        real: {
          role: me && me.role != null ? String(me.role) : null,
          tier: me && me.tier != null ? String(me.tier) : null,
          isAdmin: realIsAdmin,
        },
      };
    }
    function applyAdminOnlyVisibility(isAdmin) {
      try {
        var els = document.querySelectorAll ? document.querySelectorAll('.kexo-admin-only') : [];
        if (!els || !els.length) return;
        els.forEach(function (el) {
          if (!el || !el.classList) return;
          if (isAdmin) el.classList.remove('d-none');
          else el.classList.add('d-none');
        });
      } catch (_) {}
    }
    function applyPermissionGating(permissions) {
      try {
        var els = document.querySelectorAll ? document.querySelectorAll('[data-kexo-perm]') : [];
        if (!els || !els.length) return;
        var perms = permissions && typeof permissions === 'object' ? permissions : {};
        els.forEach(function (el) {
          if (!el || !el.classList) return;
          var perm = el.getAttribute && el.getAttribute('data-kexo-perm');
          if (!perm) return;
          if (perms[perm] === true) el.classList.remove('d-none');
          else el.classList.add('d-none');
        });
      } catch (_) {}
    }
    function ensurePreviewExitMenuItem(viewer) {
      var menu = document.getElementById('navbar-settings-menu');
      if (!menu) return;
      var btn = menu.querySelector('[data-kexo-preview-exit="1"]');
      var div = menu.querySelector('[data-kexo-preview-divider="1"]');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dropdown-item kexo-top-strip-settings-item';
        btn.setAttribute('data-kexo-preview-exit', '1');
        btn.innerHTML = '<i class="fa-jelly fa-eye kexo-top-strip-settings-item-icon" aria-hidden="true"></i><span data-kexo-preview-exit-label>Preview</span>';
        btn.addEventListener('click', function () {
          try { clearPreviewConfig(); } catch (_) {}
          try { window.location.reload(); } catch (_) {}
        });
        menu.insertBefore(btn, menu.firstChild);
      }
      if (!div) {
        div = document.createElement('div');
        div.className = 'dropdown-divider';
        div.setAttribute('data-kexo-preview-divider', '1');
        if (btn.nextSibling) menu.insertBefore(div, btn.nextSibling);
        else menu.appendChild(div);
      }

      var enabled = !!(viewer && viewer.preview && viewer.preview.enabled);
      if (!enabled) {
        btn.style.display = 'none';
        div.style.display = 'none';
        return;
      }
      var label = previewTierLabel(viewer.preview.tier) || 'Preview';
      var text = 'Preview: ' + label + ' (Exit)';
      var span = btn.querySelector('[data-kexo-preview-exit-label]');
      if (span) span.textContent = text;
      else btn.textContent = text;
      btn.style.display = '';
      div.style.display = '';
    }
    var _effectiveViewerCache = null;
    function applyEffectiveViewer() {
      var v = getEffectiveViewer(window.__kexoMe);
      _effectiveViewerCache = v;
      try { window.__kexoEffectiveViewer = v; } catch (_) {}
      try { window.__kexoEffectiveIsAdmin = !!v.isAdmin; } catch (_) {}
      try { applyAdminOnlyVisibility(!!v.isAdmin); } catch (_) {}
      try { applyPermissionGating(v.permissions); } catch (_) {}
      try { ensurePreviewExitMenuItem(v); } catch (_) {}
      try { window.dispatchEvent(new CustomEvent('kexo:viewer-changed', { detail: v })); } catch (_) {}
      return v;
    }
    try { window.__kexoGetEffectiveViewer = function() { return getEffectiveViewer(window.__kexoMe); }; } catch (_) {}
    try { window.__kexoApplyEffectiveViewer = applyEffectiveViewer; } catch (_) {}
    try {
      window.__kexoSetPreviewTier = function(tierOrOff) {
        writePreviewConfig(tierOrOff);
        applyEffectiveViewer();
      };
    } catch (_) {}

    const TABLE_CLASS_CONFIG = Object.freeze({
      dashboard: Object.freeze({ defaultRows: 5, rowOptions: Object.freeze([5, 10]) }),
      product: Object.freeze({ defaultRows: 10, rowOptions: Object.freeze([10, 15, 20]) }),
      live: Object.freeze({ defaultRows: 20, rowOptions: Object.freeze([20, 30, 40, 50]) }),
    });
    const TABLE_ROWS_STORAGE_PREFIX = 'kexo:table-rows:v1';
    const TABLE_CLASS_FALLBACK_BY_ID = Object.freeze({
      'sessions-table': 'live',
      'dash-top-products': 'dashboard',
      'dash-top-countries': 'dashboard',
      'dash-trending': 'dashboard',
      'best-sellers-table': 'product',
      'best-variants-table': 'product',
      'type-necklaces-table': 'product',
      'type-bracelets-table': 'product',
      'type-earrings-table': 'product',
      'type-sets-table': 'product',
      'type-charms-table': 'product',
      'type-extras-table': 'product',
      'country-table': 'live',
      'best-geo-products-table': 'live',
      'ads-root': 'live',
    });

    var _kexoCleanupFns = [];
    function registerCleanup(fn) {
      if (typeof fn === 'function') _kexoCleanupFns.push(fn);
    }
    function runCleanup() {
      _kexoCleanupFns.forEach(function(f) { try { f(); } catch (_) {} });
      // Do not clear _kexoCleanupFns so bfcache restore can re-init and next pagehide still cleans up
    }
    try {
      window.addEventListener('beforeunload', runCleanup);
      window.addEventListener('pagehide', runCleanup);
    } catch (_) {}

    (function initKexoTableMounts() {
