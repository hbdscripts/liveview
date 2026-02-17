(function () {
  'use strict';

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function flagSpan(code, label) {
    var raw = (code || '').toString().trim().toLowerCase();
    var safeLabel = label != null ? String(label) : (code ? String(code) : '?');
    var titleAttr = safeLabel ? ' title="' + escapeHtml(safeLabel) + '"' : '';
    if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
      return '<span class="flag flag-xs flag-country-xx"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
    }
    return '<span class="flag flag-xs flag-country-' + raw + '"' + titleAttr + ' aria-label="' + escapeHtml(safeLabel) + '"></span>';
  }

  function fmtTs(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return '—';
    try {
      return new Date(n).toLocaleString();
    } catch (_) {
      return '—';
    }
  }

  function deviceLabel(row) {
    var dt = row && row.last_device_type ? String(row.last_device_type).trim() : '';
    var pf = row && row.last_platform ? String(row.last_platform).trim() : '';
    var out = '';
    if (dt) out += dt;
    if (pf) out += (out ? ' · ' : '') + pf;
    return out || '—';
  }

  function makeBadge(text, tone) {
    var t = (tone || 'secondary').trim();
    return '<span class="badge bg-' + escapeHtml(t) + '-lt admin-users-badge">' + escapeHtml(text) + '</span>';
  }

  function kfetch(url, opts) {
    var f = (typeof window.kexoFetch === 'function') ? window.kexoFetch : fetch;
    var o = Object.assign({ credentials: 'same-origin' }, opts || {});
    return f(url, o);
  }

  // ── Admin tabs ────────────────────────────────────────────────────────────

  var activeTab = 'controls';
  var usersLoadedOnce = false;
  var controlsLoadedOnce = false;

  function isSettingsPage() {
    try {
      return (document.body && document.body.getAttribute('data-page')) === 'settings';
    } catch (_) { return false; }
  }

  function getTabFromQuery() {
    try {
      var search = window.location.search || '';
      if (isSettingsPage()) {
        var m = /[?&]adminTab=([^&]+)/.exec(search);
        var raw = m && m[1] ? String(m[1]) : '';
        var t = raw.trim().toLowerCase();
        if (t === 'users' || t === 'diagnostics' || t === 'controls') return t;
        return 'controls';
      }
      var m = /[?&]tab=([^&]+)/.exec(search);
      var raw = m && m[1] ? String(m[1]) : '';
      var t = raw.trim().toLowerCase();
      if (t === 'users' || t === 'diagnostics' || t === 'controls') return t;
    } catch (_) {}
    return '';
  }

  function setActiveTab(next, opts) {
    var t = (next || '').trim().toLowerCase();
    if (t !== 'users' && t !== 'diagnostics' && t !== 'controls') t = 'controls';
    activeTab = t;

    document.querySelectorAll('[data-admin-tab]').forEach(function (el) {
      var isActive = String(el.getAttribute('data-admin-tab') || '').trim().toLowerCase() === t;
      el.classList.toggle('active', isActive);
      el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.admin-panel').forEach(function (el) {
      var key = el && el.id ? String(el.id).replace(/^admin-panel-/, '') : '';
      el.classList.toggle('active', key === t);
    });

    if (!(opts && opts.skipUrl)) {
      try {
        if (isSettingsPage()) {
          var params = new URLSearchParams(window.location.search);
          params.set('tab', 'admin');
          params.set('adminTab', t);
          var q = params.toString();
          history.replaceState(null, '', window.location.pathname + (q ? '?' + q : ''));
        } else {
          history.replaceState(null, '', window.location.pathname + '?tab=' + encodeURIComponent(t));
        }
      } catch (_) {}
    }

    // Lazy-load per panel
    if (t === 'users') {
      if (!usersLoadedOnce) {
        usersLoadedOnce = true;
        refreshAll();
      }
    } else if (t === 'controls') {
      if (!controlsLoadedOnce) {
        controlsLoadedOnce = true;
        loadControlsPanel();
      }
    } else if (t === 'diagnostics') {
      try {
        var msg = document.getElementById('config-action-msg');
        if (msg) { msg.textContent = 'Loading diagnostics…'; msg.className = 'form-hint text-secondary'; }
      } catch (_) {}
      try { if (typeof window.refreshConfigStatus === 'function') window.refreshConfigStatus({ force: true, preserveView: false }); } catch (_) {}
    }
  }

  function bindTabClicks() {
    document.addEventListener('click', function (e) {
      var t = e && e.target ? e.target : null;
      var trigger = t && t.closest ? t.closest('a[data-admin-tab], button[data-admin-tab]') : null;
      if (!trigger) return;
      var tab = String(trigger.getAttribute('data-admin-tab') || '').trim().toLowerCase();
      if (!tab) return;
      e.preventDefault();
      setActiveTab(tab);
    });
  }

  function bindAdminUsersSubTabs() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-admin-users-tab]');
      if (!btn) return;
      e.preventDefault();
      var which = String(btn.getAttribute('data-admin-users-tab') || '').trim().toLowerCase();
      if (which !== 'active' && which !== 'pending') return;
      var activePane = document.getElementById('admin-users-active');
      var pendingPane = document.getElementById('admin-users-pending');
      if (!activePane || !pendingPane) return;
      if (which === 'active') {
        activePane.classList.add('active', 'show');
        pendingPane.classList.remove('active', 'show');
      } else {
        pendingPane.classList.add('active', 'show');
        activePane.classList.remove('active', 'show');
      }
      document.querySelectorAll('[data-admin-users-tab]').forEach(function (el) {
        var val = String(el.getAttribute('data-admin-users-tab') || '').trim().toLowerCase();
        var sel = val === which;
        el.setAttribute('aria-selected', sel ? 'true' : 'false');
        el.classList.toggle('active', sel);
      });
    });
  }

  function renderActive(rows) {
    var body = document.getElementById('admin-users-active-body');
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="text-secondary">No active users.</td></tr>';
      return;
    }
    var h = '';
    rows.forEach(function (row) {
      var email = row && row.email ? String(row.email) : '';
      var role = row && row.role ? String(row.role).trim().toLowerCase() : '';
      var provider = row && row.auth_provider ? String(row.auth_provider).trim().toLowerCase() : '';
      var status = row && row.status ? String(row.status).trim().toLowerCase() : '';
      var country = row && row.last_country ? String(row.last_country).trim() : '';
      var city = row && row.last_city ? String(row.last_city).trim() : '';
      var lastLogin = row && row.last_login_at != null ? Number(row.last_login_at) : 0;
      var isShopifySession = (provider === 'shopify' || role === 'shopify');

      var actions = '';
      if (isShopifySession) {
        actions = makeBadge('Shopify session', 'secondary');
      } else if (role === 'admin' || role === 'master') {
        actions = makeBadge('Admin', 'primary');
      } else {
        actions =
          '<button type="button" class="btn btn-sm btn-outline-primary" data-admin-action="promote" data-user-id="' +
          escapeHtml(row.id) +
          '">Promote to admin</button>';
      }

      if (status && status !== 'active') {
        actions = actions + ' ' + makeBadge(status, status === 'denied' ? 'danger' : 'secondary');
      }

      var countryCell = isShopifySession
        ? '<span class="text-secondary">—</span>'
        : (flagSpan(country, country || '—') + ' <span class="ms-1 text-secondary small">' + escapeHtml(country || '—') + '</span>');
      var cityCell = isShopifySession ? '—' : (city || '—');
      var emailCell = email || '—';

      h +=
        '<tr>' +
          '<td><div class="admin-users-email">' + escapeHtml(emailCell) + '</div></td>' +
          '<td>' + countryCell + '</td>' +
          '<td>' + escapeHtml(cityCell) + '</td>' +
          '<td>' + escapeHtml(deviceLabel(row)) + '</td>' +
          '<td>' + escapeHtml(fmtTs(lastLogin)) + '</td>' +
          '<td class="text-end"><div class="admin-users-actions">' + actions + '</div></td>' +
        '</tr>';
    });
    body.innerHTML = h;
  }

  function renderPending(rows) {
    var body = document.getElementById('admin-users-pending-body');
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="text-secondary">No pending users.</td></tr>';
      return;
    }
    var h = '';
    rows.forEach(function (row) {
      var email = row && row.email ? String(row.email) : '';
      var country = row && row.last_country ? String(row.last_country).trim() : '';
      var city = row && row.last_city ? String(row.last_city).trim() : '';
      var created = row && row.created_at != null ? Number(row.created_at) : 0;

      var actions =
        '<button type="button" class="btn btn-sm btn-outline-success" data-admin-action="approve" data-user-id="' +
        escapeHtml(row.id) +
        '">Approve</button>' +
        '<button type="button" class="btn btn-sm btn-outline-danger" data-admin-action="deny" data-user-id="' +
        escapeHtml(row.id) +
        '">Deny</button>' +
        '<button type="button" class="btn btn-sm btn-outline-primary" data-admin-action="promote" data-user-id="' +
        escapeHtml(row.id) +
        '">Promote to admin</button>';

      h +=
        '<tr>' +
          '<td><div class="admin-users-email">' + escapeHtml(email || '—') + '</div></td>' +
          '<td>' + flagSpan(country, country || '—') + ' <span class="ms-1 text-secondary small">' + escapeHtml(country || '—') + '</span></td>' +
          '<td>' + escapeHtml(city || '—') + '</td>' +
          '<td>' + escapeHtml(deviceLabel(row)) + '</td>' +
          '<td>' + escapeHtml(fmtTs(created)) + '</td>' +
          '<td class="text-end"><div class="admin-users-actions">' + actions + '</div></td>' +
        '</tr>';
    });
    body.innerHTML = h;
  }

  function setLoading(which, text) {
    var id = which === 'pending' ? 'admin-users-pending-body' : 'admin-users-active-body';
    var body = document.getElementById(id);
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" class="text-secondary">' + escapeHtml(text || 'Loading…') + '</td></tr>';
  }

  function loadUsers(status) {
    return kfetch('/api/admin/users?status=' + encodeURIComponent(status), { method: 'GET' })
      .then(function (r) { return r.json ? r.json() : null; })
      .then(function (d) { return (d && d.users) ? d.users : []; })
      .catch(function () { return []; });
  }

  function postAction(action, id) {
    var url = '';
    if (action === 'approve') url = '/api/admin/users/' + encodeURIComponent(id) + '/approve';
    else if (action === 'deny') url = '/api/admin/users/' + encodeURIComponent(id) + '/deny';
    else if (action === 'promote') url = '/api/admin/users/' + encodeURIComponent(id) + '/promote-admin';
    else return Promise.resolve(null);

    return kfetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return { ok: true }; }) : null; })
      .catch(function () { return null; });
  }

  function bindActions() {
    function handler(e) {
      var t = e && e.target ? e.target : null;
      var btn = t && t.closest ? t.closest('[data-admin-action][data-user-id]') : null;
      if (!btn) return;
      e.preventDefault();
      var action = String(btn.getAttribute('data-admin-action') || '').trim();
      var id = String(btn.getAttribute('data-user-id') || '').trim();
      if (!action || !id) return;
      btn.disabled = true;
      postAction(action, id)
        .then(function () { return refreshAll(); })
        .finally(function () { try { btn.disabled = false; } catch (_) {} });
    }
    document.addEventListener('click', handler);
  }

  function refreshAll() {
    setLoading('active', 'Refreshing…');
    setLoading('pending', 'Refreshing…');
    return Promise.all([
      loadUsers('active').then(renderActive),
      loadUsers('pending').then(renderPending),
    ]);
  }

  // ── Controls panel wiring ────────────────────────────────────────────────

  var _loaderSaveTimer = null;
  var _loaderSaving = false;
  var _previewWired = false;
  var PREVIEW_LS_KEY = 'kexo:preview:v1';

  function setHint(id, text, tone) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    if (!tone) el.className = 'form-hint';
    else if (tone === 'ok') el.className = 'form-hint text-success';
    else if (tone === 'bad') el.className = 'form-hint text-danger';
    else el.className = 'form-hint text-secondary';
  }

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

  function writePreviewConfig(tier) {
    var t = normalizePreviewTier(tier);
    if (!t) {
      try { localStorage.removeItem(PREVIEW_LS_KEY); } catch (_) {}
      return '';
    }
    try { localStorage.setItem(PREVIEW_LS_KEY, JSON.stringify({ v: 1, enabled: true, tier: t })); } catch (_) {}
    return t;
  }

  function applyPreviewUi() {
    var sel = document.getElementById('admin-preview-tier');
    var exitBtn = document.getElementById('admin-preview-exit-btn');
    if (!sel) return;
    var cfg = readPreviewConfig();
    var tier = cfg && cfg.tier ? cfg.tier : '';
    try { sel.value = tier || ''; } catch (_) {}
    if (exitBtn) {
      try { exitBtn.disabled = !tier; } catch (_) {}
    }
    if (!tier) setHint('admin-preview-msg', 'Preview is off.', 'muted');
    else setHint('admin-preview-msg', 'Preview active: ' + previewTierLabel(tier) + '.', 'ok');
  }

  function bindPreviewControls() {
    if (_previewWired) return;
    _previewWired = true;
    var sel = document.getElementById('admin-preview-tier');
    var exitBtn = document.getElementById('admin-preview-exit-btn');
    if (!sel) return;

    function applyTier(tierOrOff) {
      var t = writePreviewConfig(tierOrOff);
      applyPreviewUi();
      try {
        if (typeof window.__kexoSetPreviewTier === 'function') {
          window.__kexoSetPreviewTier(t || '');
          return;
        }
      } catch (_) {}
      // Fallback: reload so other pages pick up preview changes.
      try { window.location.reload(); } catch (_) {}
    }

    sel.addEventListener('change', function () {
      applyTier(sel.value || '');
    });

    if (exitBtn) {
      exitBtn.addEventListener('click', function () {
        applyTier('');
      });
    }

    applyPreviewUi();
  }

  function defaultPageLoaderEnabled() {
    return {
      v: 1,
      pages: {
        dashboard: true,
        live: true,
        sales: true,
        date: true,
        countries: true,
        products: true,
        variants: true,
        'abandoned-carts': true,
        channels: true,
        type: true,
        ads: true,
        'compare-conversion-rate': true,
        'shipping-cr': true,
        // Settings loader is locked off.
        settings: false,
        upgrade: false,
        admin: false,
      },
    };
  }

  function normalizePageLoaderEnabled(cfg) {
    var base = defaultPageLoaderEnabled();
    var out = { v: 1, pages: Object.assign({}, base.pages) };
    if (!cfg || typeof cfg !== 'object') return out;
    var v = Number(cfg.v);
    if (v !== 1) return out;
    var pages = cfg.pages && typeof cfg.pages === 'object' ? cfg.pages : null;
    if (!pages) return out;
    Object.keys(out.pages).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(pages, k)) return;
      out.pages[k] = pages[k] === false ? false : true;
    });
    out.pages.settings = false;
    out.pages.admin = false;
    return out;
  }

  var pageLoaderEnabledDraft = null;

  function getLoaderToggles() {
    try {
      return Array.prototype.slice.call(document.querySelectorAll('[data-admin-loader-page]')) || [];
    } catch (_) {
      return [];
    }
  }

  function readLoaderTogglesIntoDraft() {
    var cfg = pageLoaderEnabledDraft || defaultPageLoaderEnabled();
    cfg = normalizePageLoaderEnabled(cfg);
    var toggles = getLoaderToggles();
    toggles.forEach(function (el) {
      var key = el && el.getAttribute ? String(el.getAttribute('data-admin-loader-page') || '').trim().toLowerCase() : '';
      if (!key) return;
      if (key === 'admin') return;
      if (key === 'settings') return;
      cfg.pages[key] = !!el.checked;
    });
    cfg.pages.settings = false;
    cfg.pages.admin = false;
    pageLoaderEnabledDraft = cfg;
    return cfg;
  }

  function applyLoaderDraftToUi(cfg) {
    cfg = normalizePageLoaderEnabled(cfg);
    pageLoaderEnabledDraft = cfg;
    getLoaderToggles().forEach(function (el) {
      var key = el && el.getAttribute ? String(el.getAttribute('data-admin-loader-page') || '').trim().toLowerCase() : '';
      if (!key) return;
      var val = cfg.pages && Object.prototype.hasOwnProperty.call(cfg.pages, key) ? cfg.pages[key] : true;
      if (key === 'settings') {
        el.checked = false;
        el.disabled = true;
        return;
      }
      el.checked = val !== false;
    });
  }

  function saveLoaderConfigDebounced() {
    if (_loaderSaveTimer) { try { clearTimeout(_loaderSaveTimer); } catch (_) {} }
    _loaderSaveTimer = setTimeout(function () {
      _loaderSaveTimer = null;
      saveLoaderConfigNow();
    }, 350);
  }

  function saveLoaderConfigNow() {
    if (_loaderSaving) return;
    _loaderSaving = true;
    var cfg = readLoaderTogglesIntoDraft();
    setHint('admin-loader-msg', 'Saving…', 'muted');
    kfetch('/api/admin/controls', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pageLoaderEnabled: cfg }),
    })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return { ok: true }; }) : null; })
      .then(function (d) {
        if (!d || d.ok !== true) {
          setHint('admin-loader-msg', (d && d.error) ? String(d.error) : 'Save failed', 'bad');
          return;
        }
        // Also hydrate localStorage so prime loader can use it on next navigation.
        try { localStorage.setItem('kexo:page-loader-enabled:v1', JSON.stringify(cfg)); } catch (_) {}
        setHint('admin-loader-msg', 'Saved.', 'ok');
      })
      .catch(function (err) {
        setHint('admin-loader-msg', err && err.message ? String(err.message).slice(0, 120) : 'Save failed', 'bad');
      })
      .finally(function () { _loaderSaving = false; });
  }

  function bindLoaderToggles() {
    getLoaderToggles().forEach(function (el) {
      el.addEventListener('change', function () {
        saveLoaderConfigDebounced();
      });
    });
  }

  var _reportingSaving = false;

  function saveReportingNow() {
    if (_reportingSaving) return;
    var ordSel = document.getElementById('admin-orders-source');
    var sessSel = document.getElementById('admin-sessions-source');
    var pxToggle = document.getElementById('admin-pixel-session-mode');
    if (!ordSel || !sessSel) return;
    _reportingSaving = true;
    setHint('admin-reporting-msg', 'Saving…', 'muted');
    var payload = {
      reporting: {
        ordersSource: ordSel.value || 'orders_shopify',
        sessionsSource: sessSel.value || 'sessions',
      },
      pixelSessionMode: (pxToggle && pxToggle.checked) ? 'shared_ttl' : 'legacy',
    };
    kfetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return { ok: true }; }) : null; })
      .then(function (d) {
        if (!d || d.ok !== true) {
          setHint('admin-reporting-msg', (d && d.error) ? String(d.error) : 'Save failed', 'bad');
          return;
        }
        setHint('admin-reporting-msg', 'Saved.', 'ok');
      })
      .catch(function (err) {
        setHint('admin-reporting-msg', err && err.message ? String(err.message).slice(0, 120) : 'Save failed', 'bad');
      })
      .finally(function () { _reportingSaving = false; });
  }

  function bindReportingControls() {
    var ordSel = document.getElementById('admin-orders-source');
    var sessSel = document.getElementById('admin-sessions-source');
    var pxToggle = document.getElementById('admin-pixel-session-mode');
    if (ordSel) ordSel.addEventListener('change', saveReportingNow);
    if (sessSel) sessSel.addEventListener('change', saveReportingNow);
    if (pxToggle) pxToggle.addEventListener('change', saveReportingNow);
  }

  function loadControlsPanel() {
    // Loader config
    setHint('admin-loader-msg', 'Loading…', 'muted');
    kfetch('/api/admin/controls', { method: 'GET' })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (d) {
        var cfg = d && d.pageLoaderEnabled ? d.pageLoaderEnabled : null;
        cfg = normalizePageLoaderEnabled(cfg);
        applyLoaderDraftToUi(cfg);
        setHint('admin-loader-msg', 'Loaded.', 'muted');
      })
      .catch(function () {
        // Fall back to localStorage/defaults
        try {
          var raw = localStorage.getItem('kexo:page-loader-enabled:v1');
          var parsed = raw ? JSON.parse(raw) : null;
          applyLoaderDraftToUi(normalizePageLoaderEnabled(parsed));
          setHint('admin-loader-msg', 'Loaded (local).', 'muted');
        } catch (_) {
          applyLoaderDraftToUi(defaultPageLoaderEnabled());
          setHint('admin-loader-msg', 'Loaded (default).', 'muted');
        }
      });

    // Reporting + settings scope (read-only)
    setHint('admin-reporting-msg', 'Loading…', 'muted');
    kfetch('/api/settings', { method: 'GET', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (d) {
        if (!d || d.ok !== true) { setHint('admin-reporting-msg', 'Failed to load settings.', 'bad'); return; }
        var reporting = d.reporting || {};
        var ordSel = document.getElementById('admin-orders-source');
        var sessSel = document.getElementById('admin-sessions-source');
        var pxToggle = document.getElementById('admin-pixel-session-mode');
        if (ordSel) ordSel.value = reporting.ordersSource || 'orders_shopify';
        if (sessSel) sessSel.value = reporting.sessionsSource || 'sessions';
        if (pxToggle) pxToggle.checked = String(d.pixelSessionMode || 'legacy').toLowerCase() === 'shared_ttl';
        setHint('admin-reporting-msg', '', '');
      })
      .catch(function () {
        setHint('admin-reporting-msg', 'Failed to load settings.', 'bad');
      });

    bindPreviewControls();
    bindLoaderToggles();
    bindReportingControls();
  }

  function init() {
    bindTabClicks();
    bindAdminUsersSubTabs();
    bindActions();

    var initial = getTabFromQuery() || 'controls';
    setActiveTab(initial, { skipUrl: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

