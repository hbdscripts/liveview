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
    const PAGE_LOADERS_UI_LS_KEY = 'kexo:page-loaders-ui:v1';
    const PAGE_LOADER_ENABLED_LS_KEY_LEGACY = 'kexo:page-loader-enabled:v1';

    var LOADER_PAGE_KEYS = [
      'dashboard', 'live', 'sales', 'date', 'snapshot', 'countries', 'products', 'variants',
      'abandoned-carts', 'attribution', 'devices', 'ads', 'compare-conversion-rate', 'shipping-cr',
      'click-order-lookup', 'change-pins', 'time-of-day', 'settings', 'upgrade', 'admin'
    ];

    function defaultPageLoadersUiV1() {
      var pages = {};
      LOADER_PAGE_KEYS.forEach(function (key) {
        var locked = key === 'settings' || key === 'upgrade' || key === 'admin';
        pages[key] = {
          overlay: locked ? false : key !== 'snapshot',
          strip: locked ? false : true
        };
      });
      return { v: 1, pages: pages };
    }

    function normalizePageLoadersUiV1(cfg) {
      var base = defaultPageLoadersUiV1();
      var out = { v: 1, pages: {} };
      LOADER_PAGE_KEYS.forEach(function (k) {
        out.pages[k] = base.pages[k] ? { overlay: base.pages[k].overlay, strip: base.pages[k].strip } : { overlay: false, strip: false };
      });
      if (!cfg || typeof cfg !== 'object') return out;
      if (Number(cfg.v) !== 1) return out;
      var pages = cfg.pages && typeof cfg.pages === 'object' ? cfg.pages : null;
      if (!pages) return out;
      LOADER_PAGE_KEYS.forEach(function (k) {
        var p = pages[k];
        if (!p || typeof p !== 'object') return;
        if (k === 'settings' || k === 'upgrade' || k === 'admin') {
          out.pages[k] = { overlay: false, strip: false };
          return;
        }
        out.pages[k].overlay = p.overlay !== false;
        out.pages[k].strip = p.strip !== false;
      });
      return out;
    }

    function migrateLegacyPageLoaderToLoadersUi(legacy) {
      if (!legacy || typeof legacy !== 'object' || Number(legacy.v) !== 1) return null;
      var legacyPages = legacy.pages && typeof legacy.pages === 'object' ? legacy.pages : null;
      if (!legacyPages) return null;
      var out = defaultPageLoadersUiV1();
      var keyMap = { channels: 'attribution', type: 'devices' };
      LOADER_PAGE_KEYS.forEach(function (key) {
        if (key === 'settings' || key === 'upgrade' || key === 'admin') return;
        var legacyKey = keyMap[key] || key;
        var enabled = legacyPages[legacyKey] !== false;
        out.pages[key].overlay = enabled;
        out.pages[key].strip = true;
      });
      return out;
    }

    var pageLoadersUiV1 = null;
    try {
      var cached = safeReadLocalStorageJson(PAGE_LOADERS_UI_LS_KEY);
      if (cached && cached.v === 1) {
        pageLoadersUiV1 = normalizePageLoadersUiV1(cached);
      }
    } catch (_) {}
    if (!pageLoadersUiV1) {
      try {
        var legacy = safeReadLocalStorageJson(PAGE_LOADER_ENABLED_LS_KEY_LEGACY);
        var migrated = migrateLegacyPageLoaderToLoadersUi(legacy);
        if (migrated) {
          pageLoadersUiV1 = migrated;
          try { safeWriteLocalStorageJson(PAGE_LOADERS_UI_LS_KEY, migrated); } catch (_) {}
        } else {
          pageLoadersUiV1 = defaultPageLoadersUiV1();
        }
      } catch (_) {
        pageLoadersUiV1 = defaultPageLoadersUiV1();
      }
    }

    function applyPageLoadersUiV1(cfg) {
      pageLoadersUiV1 = normalizePageLoadersUiV1(cfg);
      try { window.__kexoPageLoadersUiV1 = pageLoadersUiV1; } catch (_) {}
      try { safeWriteLocalStorageJson(PAGE_LOADERS_UI_LS_KEY, pageLoadersUiV1); } catch (_) {}
      return pageLoadersUiV1;
    }

    function resolvePageKey(pageKey) {
      var k = String(pageKey == null ? '' : pageKey).trim().toLowerCase();
      if (!k) k = String(PAGE || '').trim().toLowerCase();
      return k;
    }

    function isPageOverlayLoaderEnabled(pageKey) {
      var k = resolvePageKey(pageKey);
      if (!k) return true;
      if (k === 'settings' || k === 'admin' || k === 'snapshot') return false;
      var cfg = pageLoadersUiV1;
      var pages = cfg && cfg.pages && typeof cfg.pages === 'object' ? cfg.pages : null;
      if (!pages || !Object.prototype.hasOwnProperty.call(pages, k)) return true;
      return pages[k].overlay !== false;
    }

    function isPageTopStripLoaderEnabled(pageKey) {
      var k = resolvePageKey(pageKey);
      if (!k) return true;
      if (k === 'settings' || k === 'admin') return false;
      var cfg = pageLoadersUiV1;
      var pages = cfg && cfg.pages && typeof cfg.pages === 'object' ? cfg.pages : null;
      if (!pages || !Object.prototype.hasOwnProperty.call(pages, k)) return true;
      return pages[k].strip !== false;
    }

    function isPageLoaderEnabled(pageKey) {
      return isPageOverlayLoaderEnabled(pageKey);
    }

    try { window.__kexoIsPageLoaderEnabled = isPageLoaderEnabled; } catch (_) {}
    try { window.__kexoIsPageOverlayLoaderEnabled = isPageOverlayLoaderEnabled; } catch (_) {}
    try { window.__kexoIsPageTopStripLoaderEnabled = isPageTopStripLoaderEnabled; } catch (_) {}
    try { window.__kexoApplyPageLoadersUiV1 = applyPageLoadersUiV1; } catch (_) {}

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
      return fetch(url, { credentials: 'same-origin', cache: 'default' })
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
    function applyRealAdminOnlyVisibility(realIsAdmin) {
      try {
        var els = document.querySelectorAll ? document.querySelectorAll('.kexo-real-admin-only') : [];
        if (!els || !els.length) return;
        els.forEach(function (el) {
          if (!el || !el.classList) return;
          if (realIsAdmin) el.classList.remove('d-none');
          else el.classList.add('d-none');
        });
        var dividers = document.querySelectorAll ? document.querySelectorAll('[data-kexo-divider-tier="1"]') : [];
        if (dividers && dividers.length) {
          dividers.forEach(function (el) {
            if (!el || !el.classList) return;
            if (realIsAdmin) el.classList.remove('d-none');
            else el.classList.add('d-none');
          });
        }
      } catch (_) {}
    }
    var _rolePermissionsByTierCache = null;
    var _rolePermissionsCacheTs = 0;
    var ROLE_PERMISSIONS_CACHE_MS = 120000;
    function fetchRolePermissionsForPreview(tier, callback) {
      if (typeof callback !== 'function') return;
      if (_rolePermissionsByTierCache && (Date.now() - _rolePermissionsCacheTs) < ROLE_PERMISSIONS_CACHE_MS) {
        var map = _rolePermissionsByTierCache[tier];
        if (!map && (tier === 'max')) map = _rolePermissionsByTierCache.scale || {};
        if (tier === 'admin') {
          var allTrue = {};
          var src = _rolePermissionsByTierCache.starter || _rolePermissionsByTierCache.scale || {};
          for (var k in src) allTrue[k] = true;
          map = allTrue;
        }
        callback(map || {});
        return;
      }
      fetch(API + '/api/admin/role-permissions', { credentials: 'same-origin' })
        .then(function (r) { return r.json ? r.json() : null; })
        .then(function (d) {
          if (d && d.ok && d.permissions) {
            _rolePermissionsByTierCache = d.permissions;
            _rolePermissionsCacheTs = Date.now();
            var map = d.permissions[tier];
            if (!map && (tier === 'max')) map = d.permissions.scale;
            if (tier === 'admin') {
              var allTrue = {};
              var src = d.permissions.starter || d.permissions.scale || {};
              for (var k in src) allTrue[k] = true;
              map = allTrue;
            }
            callback(map || {});
          } else {
            callback({});
          }
        })
        .catch(function () { callback({}); });
    }
    function applyPermissionGating(permissions) {
      try {
        var els = document.querySelectorAll ? document.querySelectorAll('[data-kexo-perm]') : [];
        if (!els || !els.length) return;
        var perms = permissions && typeof permissions === 'object' ? permissions : {};
        // When no permissions (e.g. Shopify embed, no OAuth), show all so nav items are visible.
        var showAll = (Object.keys(perms).length === 0);
        els.forEach(function (el) {
          if (!el || !el.classList) return;
          var perm = el.getAttribute && el.getAttribute('data-kexo-perm');
          if (!perm) return;
          if (showAll || perms[perm] === true) el.classList.remove('d-none');
          else el.classList.add('d-none');
        });
        // Settings left nav: hide empty categories (no visible children).
        try {
          var cats = document.querySelectorAll ? document.querySelectorAll('.settings-nav-category') : [];
          if (!cats || !cats.length) return;
          cats.forEach(function (cat) {
            if (!cat || !cat.classList || !cat.querySelectorAll) return;
            // Admin-only categories are handled by applyAdminOnlyVisibility().
            if (cat.classList.contains('kexo-admin-only')) return;

            var catPerm = cat.getAttribute && cat.getAttribute('data-kexo-perm');
            var catPermAllows = !catPerm || perms[catPerm] === true;
            // Never override permission-based hiding.
            if (!catPermAllows) {
              try { cat.removeAttribute('data-kexo-empty-hidden'); } catch (_) {}
              var lockedLink = cat.querySelector('a[data-settings-tab]:not(.settings-nav-child)');
              if (lockedLink) {
                try { lockedLink.removeAttribute('data-kexo-empty-hidden'); } catch (_) {}
              }
              return;
            }

            var children = cat.querySelectorAll('.settings-nav-children a.settings-nav-child');
            var anyVisible = false;
            if (children && children.length) {
              children.forEach(function (a) {
                if (!a || !a.classList) return;
                if (!a.classList.contains('d-none')) anyVisible = true;
              });
            }

            var catLink = cat.querySelector('a[data-settings-tab]:not(.settings-nav-child)');
            var isEmptyHidden = (cat.getAttribute && cat.getAttribute('data-kexo-empty-hidden') === '1');
            if (!anyVisible) {
              if (!isEmptyHidden) {
                try { cat.setAttribute('data-kexo-empty-hidden', '1'); } catch (_) {}
                try { cat.classList.add('d-none'); } catch (_) {}
              }
              if (catLink && (catLink.getAttribute('data-kexo-empty-hidden') !== '1')) {
                try { catLink.setAttribute('data-kexo-empty-hidden', '1'); } catch (_) {}
                try { catLink.classList.add('d-none'); } catch (_) {}
              }
              return;
            }

            if (isEmptyHidden) {
              try { cat.removeAttribute('data-kexo-empty-hidden'); } catch (_) {}
              try { cat.classList.remove('d-none'); } catch (_) {}
            }
            if (catLink && catLink.getAttribute('data-kexo-empty-hidden') === '1') {
              try { catLink.removeAttribute('data-kexo-empty-hidden'); } catch (_) {}
              try { catLink.classList.remove('d-none'); } catch (_) {}
            }
          });
        } catch (_) {}
      } catch (_) {}
    }
    var _miniMenuBuilt = false;
    function stripIds(node) {
      if (!node) return;
      if (node.id) node.removeAttribute('id');
      var children = node.querySelectorAll ? node.querySelectorAll('*') : [];
      if (children.length) children.forEach(stripIds);
    }
    function ensureMiniSettingsMenu() {
      if (_miniMenuBuilt) return;
      var template = document.getElementById('kexo-settings-nav-template');
      var panelHost = document.getElementById('kexo-settings-mini-menu-panel');
      if (!template || !template.content || !panelHost) return;
      var fragment = template.content.cloneNode(true);
      stripIds(fragment);
      function setCategoryExpanded(cat, expand, immediate, categories) {
        if (!cat || !cat.classList) return;
        var children = cat.querySelector ? cat.querySelector('.settings-nav-children') : null;
        if (!children) {
          if (expand) cat.classList.add('kexo-mini-menu-expanded');
          else cat.classList.remove('kexo-mini-menu-expanded');
          return;
        }
        try {
          if (children._kexoMiniAnimHandler) {
            children.removeEventListener('transitionend', children._kexoMiniAnimHandler);
            children._kexoMiniAnimHandler = null;
          }
        } catch (_) {}

        function cleanupStyles() {
          try { children.style.willChange = ''; } catch (_) {}
          try { children.style.transition = ''; } catch (_) {}
          try { children.style.overflow = ''; } catch (_) {}
          try { children.style.height = ''; } catch (_) {}
          try { children.style.opacity = ''; } catch (_) {}
        }

        if (immediate) {
          if (expand) {
            cat.classList.add('kexo-mini-menu-expanded');
            try { children.style.display = 'block'; } catch (_) {}
            cleanupStyles();
          } else {
            cat.classList.remove('kexo-mini-menu-expanded');
            try { children.style.display = 'none'; } catch (_) {}
            cleanupStyles();
          }
          return;
        }

        try { children.style.willChange = 'height, opacity'; } catch (_) {}
        try { children.style.transition = 'height 220ms ease, opacity 180ms ease'; } catch (_) {}
        try { children.style.overflow = 'hidden'; } catch (_) {}

        if (expand) {
          cat.classList.add('kexo-mini-menu-expanded');
          try { children.style.display = 'block'; } catch (_) {}
          try { children.style.height = '0px'; } catch (_) {}
          try { children.style.opacity = '0'; } catch (_) {}
          try { children.offsetHeight; } catch (_) {}
          var targetH = 0;
          try { targetH = children.scrollHeight || 0; } catch (_) { targetH = 0; }
          try { children.style.height = String(targetH) + 'px'; } catch (_) {}
          try { children.style.opacity = '1'; } catch (_) {}
          var onEndExpand = function (e) {
            if (e && e.propertyName && e.propertyName !== 'height') return;
            cleanupStyles();
            try { children.removeEventListener('transitionend', onEndExpand); } catch (_) {}
            try { children._kexoMiniAnimHandler = null; } catch (_) {}
          };
          children._kexoMiniAnimHandler = onEndExpand;
          children.addEventListener('transitionend', onEndExpand);
        } else {
          // Keep expanded class during collapse so CSS doesn't snap to display:none.
          cat.classList.add('kexo-mini-menu-expanded');
          try { children.style.display = 'block'; } catch (_) {}
          var startH = 0;
          try { startH = children.scrollHeight || 0; } catch (_) { startH = 0; }
          try { children.style.height = String(startH) + 'px'; } catch (_) {}
          try { children.style.opacity = '1'; } catch (_) {}
          try { children.offsetHeight; } catch (_) {}
          try { children.style.height = '0px'; } catch (_) {}
          try { children.style.opacity = '0'; } catch (_) {}
          var onEndCollapse = function (e) {
            if (e && e.propertyName && e.propertyName !== 'height') return;
            try { cat.classList.remove('kexo-mini-menu-expanded'); } catch (_) {}
            try { children.style.display = 'none'; } catch (_) {}
            cleanupStyles();
            try { children.removeEventListener('transitionend', onEndCollapse); } catch (_) {}
            try { children._kexoMiniAnimHandler = null; } catch (_) {}
          };
          children._kexoMiniAnimHandler = onEndCollapse;
          children.addEventListener('transitionend', onEndCollapse);
        }
      }
      function addToggleListeners(root) {
        if (!root || !root.querySelectorAll) return;
        var categories = root.querySelectorAll('.settings-nav-category');
        categories.forEach(function (cat) {
          var headerLink = cat.querySelector && cat.querySelector('a[data-settings-tab]:not(.settings-nav-child)');
          if (!headerLink) return;
          headerLink.addEventListener('click', function (e) {
            e.preventDefault();
            var isExpanded = !!(cat.classList && cat.classList.contains('kexo-mini-menu-expanded'));
            // Accordion: collapse others (smooth).
            try {
              categories.forEach(function (other) {
                if (!other || !other.classList) return;
                if (other === cat) return;
                if (other.classList.contains('kexo-mini-menu-expanded')) setCategoryExpanded(other, false, false, categories);
              });
            } catch (_) {}
            setCategoryExpanded(cat, !isExpanded, false, categories);
          });
        });
      }
      panelHost.appendChild(fragment);
      addToggleListeners(panelHost);
      // Default open: Kexo (and ensure other categories are collapsed).
      try {
        var kexoHeader = panelHost.querySelector('a[data-settings-tab="kexo"]:not(.settings-nav-child)');
        var kexoCat = kexoHeader && kexoHeader.closest ? kexoHeader.closest('.settings-nav-category') : null;
        if (kexoCat && kexoCat.classList) {
          try {
            var cats = panelHost.querySelectorAll ? panelHost.querySelectorAll('.settings-nav-category') : [];
            if (cats && cats.length) cats.forEach(function (c) { if (c && c.classList) setCategoryExpanded(c, false, true, cats); });
          } catch (_) {}
          setCategoryExpanded(kexoCat, true, true, null);
        }
      } catch (_) {}
      _miniMenuBuilt = true;
    }
    function ensureViewingAsTierRow(viewer) {
      ensureMiniSettingsMenu();
      var panelSelect = document.getElementById('kexo-viewing-as-tier-panel');
      var current = readPreviewConfig();
      var value = (current && current.tier) ? current.tier : '';
      function setSelect(sel) {
        if (!sel || !sel.options) return;
        for (var i = 0; i < sel.options.length; i++) {
          if ((sel.options[i].value || '') === value) { sel.selectedIndex = i; return; }
        }
        sel.value = value;
      }
      setSelect(panelSelect);
      function onTierChange() {
        var v = (this && this.value) ? this.value : '';
        writePreviewConfig(v || null);
        applyEffectiveViewer();
      }
      if (panelSelect && !panelSelect._kexoTierBound) {
        panelSelect._kexoTierBound = true;
        panelSelect.addEventListener('change', onTierChange);
      }
    }
    var _effectiveViewerCache = null;
    function applyEffectiveViewer() {
      var v = getEffectiveViewer(window.__kexoMe);
      _effectiveViewerCache = v;
      try { window.__kexoEffectiveViewer = v; } catch (_) {}
      try { window.__kexoEffectiveIsAdmin = !!v.isAdmin; } catch (_) {}
      try { applyAdminOnlyVisibility(!!v.isAdmin); } catch (_) {}
      try { applyRealAdminOnlyVisibility(!!(v.real && v.real.isAdmin)); } catch (_) {}
      if (v.preview && v.preview.enabled && v.preview.tier) {
        try {
          fetchRolePermissionsForPreview(v.preview.tier, function (tierPerms) {
            try { applyPermissionGating(tierPerms); } catch (_) {}
          });
        } catch (_) {}
      } else {
        try { applyPermissionGating(v.permissions); } catch (_) {}
      }
      try { ensureViewingAsTierRow(v); } catch (_) {}
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
      product: Object.freeze({ defaultRows: 5, rowOptions: Object.freeze([5]) }),
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
      'products-trending-table': 'product',
      'products-gross-profit-high-table': 'product',
      'products-gross-profit-low-table': 'product',
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

    // Long-lived timers (setInterval / setTimeout that outlive a single view) should call registerCleanup
    // with a function that clears them, so pagehide/beforeunload can tear down without leaking.
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
