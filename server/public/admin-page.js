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
        var pathname = (window.location.pathname || '').replace(/\/+$/, '');
        var pm = /^\/settings\/admin\/([^/?#]+)/.exec(pathname);
        if (pm && pm[1]) {
          var pt = String(pm[1]).trim().toLowerCase();
          if (pt === 'users' || pt === 'diagnostics' || pt === 'controls' || pt === 'role-permissions') return pt;
        }
        var m = /[?&]adminTab=([^&]+)/.exec(search);
        var raw = m && m[1] ? String(m[1]) : '';
        var t = raw.trim().toLowerCase();
        if (t === 'users' || t === 'diagnostics' || t === 'controls' || t === 'role-permissions') return t;
        return 'controls';
      }
      var m = /[?&]tab=([^&]+)/.exec(search);
      var raw = m && m[1] ? String(m[1]) : '';
      var t = raw.trim().toLowerCase();
      if (t === 'users' || t === 'diagnostics' || t === 'controls' || t === 'role-permissions') return t;
    } catch (_) {}
    return '';
  }

  function preservedSettingsQuery() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var keep = new URLSearchParams();
      var shop = String(params.get('shop') || '').trim();
      if (shop) keep.set('shop', shop);
      var adsOauth = String(params.get('ads_oauth') || '').trim();
      if (adsOauth) keep.set('ads_oauth', adsOauth);
      var q = keep.toString();
      return q ? ('?' + q) : '';
    } catch (_) {
      return '';
    }
  }

  function setActiveTab(next, opts) {
    var t = (next || '').trim().toLowerCase();
    if (t !== 'users' && t !== 'diagnostics' && t !== 'controls' && t !== 'role-permissions') t = 'controls';
    activeTab = t;

    if (!isSettingsPage()) {
      document.querySelectorAll('[data-admin-tab]').forEach(function (el) {
        var isActive = String(el.getAttribute('data-admin-tab') || '').trim().toLowerCase() === t;
        el.classList.toggle('active', isActive);
        el.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      document.querySelectorAll('.admin-panel').forEach(function (el) {
        var key = el && el.id ? String(el.id).replace(/^admin-panel-/, '') : '';
        el.classList.toggle('active', key === t);
      });
    }

    if (!(opts && opts.skipUrl)) {
      try {
        if (isSettingsPage()) {
          history.replaceState(null, '', '/settings/admin/' + encodeURIComponent(t) + preservedSettingsQuery());
        } else {
          history.replaceState(null, '', window.location.pathname + '?tab=' + encodeURIComponent(t));
        }
      } catch (_) {}
    }

    runLazyLoadForAdminTab(t);
  }

  function kexoAdminSetActiveTab(tab, opts) {
    if (!isSettingsPage()) return;
    var t = (tab || '').trim().toLowerCase();
    if (t !== 'users' && t !== 'diagnostics' && t !== 'controls' && t !== 'role-permissions') t = 'controls';
    setActiveTab(t, opts);
  }

  try {
    window.kexoAdminSetActiveTab = kexoAdminSetActiveTab;
  } catch (_) {}

  function runLazyLoadForAdminTab(t) {
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
    } else if (t === 'role-permissions') {
      loadRolePermissionsPanel();
    }
  }

  function bindTabClicks() {
    document.addEventListener('click', function (e) {
      var t = e && e.target ? e.target : null;
      var trigger = t && t.closest ? t.closest('a[data-admin-tab], button[data-admin-tab], a[data-settings-admin-tab], button[data-settings-admin-tab]') : null;
      if (!trigger) return;
      // On Settings, let the left-nav admin links navigate (path-based URLs).
      if (isSettingsPage() && trigger.tagName === 'A') {
        try {
          var href = String(trigger.getAttribute('href') || '');
          if (href && href.indexOf('/settings/admin/') === 0) return;
        } catch (_) {}
      }
      var tab = String(
        trigger.getAttribute('data-admin-tab') ||
        trigger.getAttribute('data-settings-admin-tab') ||
        ''
      ).trim().toLowerCase();
      if (!tab) return;
      e.preventDefault();
      setActiveTab(tab);
    });
  }

  function wireAdminAccordionShown() {
    var controlsEl = document.getElementById('settings-admin-accordion-controls');
    var diagnosticsEl = document.getElementById('settings-admin-accordion-diagnostics');
    var usersEl = document.getElementById('settings-admin-accordion-users');
    var rolePermsEl = document.getElementById('settings-admin-accordion-role-permissions');
    function updateUrlFromTab(t) {
      try {
        history.replaceState(null, '', '/settings/admin/' + encodeURIComponent(t) + preservedSettingsQuery());
      } catch (_) {}
    }
    if (controlsEl) {
      controlsEl.addEventListener('shown.bs.collapse', function () {
        activeTab = 'controls';
        updateUrlFromTab('controls');
        runLazyLoadForAdminTab('controls');
      });
    }
    if (diagnosticsEl) {
      diagnosticsEl.addEventListener('shown.bs.collapse', function () {
        activeTab = 'diagnostics';
        updateUrlFromTab('diagnostics');
        runLazyLoadForAdminTab('diagnostics');
      });
    }
    if (usersEl) {
      usersEl.addEventListener('shown.bs.collapse', function () {
        activeTab = 'users';
        updateUrlFromTab('users');
        runLazyLoadForAdminTab('users');
      });
    }
    if (rolePermsEl) {
      rolePermsEl.addEventListener('shown.bs.collapse', function () {
        activeTab = 'role-permissions';
        updateUrlFromTab('role-permissions');
        loadRolePermissionsPanel();
      });
    }
  }

  var _rolePermsSaveTimer = null;
  function loadRolePermissionsPanel() {
    var container = document.getElementById('admin-role-permissions-content');
    if (!container) return;
    container.innerHTML = '<div class="d-flex align-items-center gap-2 text-secondary"><div class="spinner-border spinner-border-sm text-primary" role="status"></div><span>Loading…</span></div>';
    kfetch('/api/admin/role-permissions', { method: 'GET' })
      .then(function (r) { return r.json ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok || !d.permissions) {
          container.innerHTML = '<p class="text-secondary">Failed to load.</p>';
          return;
        }
        var tiers = ['starter', 'growth', 'pro', 'scale'];
        var tierLabels = { starter: 'Starter', growth: 'Growth', pro: 'Pro', scale: 'Scale' };
        var perms = d.permissions;
        var keys = perms.starter ? Object.keys(perms.starter) : [];
        if (!keys.length) {
          container.innerHTML = '<p class="text-secondary">No permissions defined.</p>';
          return;
        }
        keys.sort();
        var pageKeys = keys.filter(function (k) { return k.indexOf('page.') === 0; });
        var settingsKeys = keys.filter(function (k) { return k.indexOf('settings.') === 0 || k === 'page.settings'; });
        function labelForKey(k) {
          var s = k.replace(/^page\./, '').replace(/^settings\./, '').replace(/\./g, ' ');
          return s.charAt(0).toUpperCase() + s.slice(1);
        }
        var html = '';
        tiers.forEach(function (tier) {
          var tierPerms = perms[tier] || {};
          html += '<div class="card mb-3"><div class="card-header"><strong>' + escapeHtml(tierLabels[tier] || tier) + '</strong></div><div class="card-body">';
          if (pageKeys.length) {
            html += '<div class="mb-2"><span class="text-secondary small">Pages</span></div><div class="d-flex flex-wrap gap-3 mb-3">';
            pageKeys.forEach(function (key) {
              var checked = tierPerms[key] === true ? ' checked' : '';
              html += '<div class="form-check"><input class="form-check-input admin-role-perm-cb" type="checkbox" data-tier="' + escapeHtml(tier) + '" data-perm="' + escapeHtml(key) + '" id="rp-' + escapeHtml(tier) + '-' + escapeHtml(key.replace(/\./g, '-')) + '"' + checked + '><label class="form-check-label" for="rp-' + escapeHtml(tier) + '-' + escapeHtml(key.replace(/\./g, '-')) + '">' + escapeHtml(labelForKey(key)) + '</label></div>';
            });
            html += '</div>';
          }
          if (settingsKeys.length) {
            html += '<div class="mb-2"><span class="text-secondary small">Settings</span></div><div class="d-flex flex-wrap gap-3">';
            settingsKeys.forEach(function (key) {
              var checked = tierPerms[key] === true ? ' checked' : '';
              html += '<div class="form-check"><input class="form-check-input admin-role-perm-cb" type="checkbox" data-tier="' + escapeHtml(tier) + '" data-perm="' + escapeHtml(key) + '" id="rp-' + escapeHtml(tier) + '-' + escapeHtml(key.replace(/\./g, '-')) + '"' + checked + '><label class="form-check-label" for="rp-' + escapeHtml(tier) + '-' + escapeHtml(key.replace(/\./g, '-')) + '">' + escapeHtml(labelForKey(key)) + '</label></div>';
            });
            html += '</div>';
          }
          html += '</div></div>';
        });
        container.innerHTML = html;
        container.querySelectorAll('.admin-role-perm-cb').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var tier = cb.getAttribute('data-tier');
            if (!tier) return;
            if (_rolePermsSaveTimer) clearTimeout(_rolePermsSaveTimer);
            _rolePermsSaveTimer = setTimeout(function () {
              _rolePermsSaveTimer = null;
              var permsForTier = {};
              container.querySelectorAll('.admin-role-perm-cb[data-tier="' + tier + '"]').forEach(function (c) {
                var key = c.getAttribute('data-perm');
                if (key) permsForTier[key] = c.checked;
              });
              kfetch('/api/admin/role-permissions/' + encodeURIComponent(tier), {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ permissions: permsForTier })
              }).then(function (r) { return r && r.ok ? r.json() : null; }).catch(function () { return null; });
            }, 400);
          });
        });
      })
      .catch(function () {
        if (container) container.innerHTML = '<p class="text-secondary">Failed to load.</p>';
      });
  }

  function expandAdminAccordionFromUrl() {
    var initial = getTabFromQuery() || 'controls';
    activeTab = initial;
    var collapseId = 'settings-admin-accordion-' + initial;
    var el = document.getElementById(collapseId);
    if (el && typeof window.bootstrap !== 'undefined' && window.bootstrap.Collapse) {
      try {
        var col = new window.bootstrap.Collapse(el, { toggle: false });
        col.show();
      } catch (_) {}
    } else {
      runLazyLoadForAdminTab(initial);
    }
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

  var TIER_LABELS = { starter: 'Starter', growth: 'Growth', pro: 'Pro', scale: 'Scale', admin: 'Admin' };
  function tierLabel(tier) {
    var t = (tier || '').toString().trim().toLowerCase();
    return TIER_LABELS[t] || (t || '—');
  }

  function renderActive(rows) {
    var body = document.getElementById('admin-users-active-body');
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="text-secondary">No active users.</td></tr>';
      return;
    }
    var h = '';
    rows.forEach(function (row) {
      var email = row && row.email ? String(row.email) : '';
      var role = row && row.role ? String(row.role).trim().toLowerCase() : '';
      var tier = row && row.tier ? String(row.tier).trim().toLowerCase() : '';
      var provider = row && row.auth_provider ? String(row.auth_provider).trim().toLowerCase() : '';
      var status = row && row.status ? String(row.status).trim().toLowerCase() : '';
      var country = row && row.last_country ? String(row.last_country).trim() : '';
      var city = row && row.last_city ? String(row.last_city).trim() : '';
      var lastLogin = row && row.last_login_at != null ? Number(row.last_login_at) : 0;
      var isShopifySession = (provider === 'shopify' || role === 'shopify');

      var roleCell = isShopifySession ? '—' : (role === 'admin' || role === 'master' ? makeBadge('Admin', 'primary') : escapeHtml(tierLabel(tier)));
      var actions = '';
      if (isShopifySession) {
        actions = makeBadge('Shopify session', 'secondary');
      } else if (role === 'admin' || role === 'master') {
        actions = makeBadge('Admin', 'primary');
      } else {
        actions =
          '<button type="button" class="btn btn-md me-1" data-admin-action="edit" data-user-id="' + escapeHtml(row.id) + '" data-user-tier="' + escapeHtml(tier) + '">Edit</button>' +
          '<button type="button" class="btn btn-md" data-admin-action="promote" data-user-id="' + escapeHtml(row.id) + '">Promote to admin</button>';
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
          '<td>' + roleCell + '</td>' +
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
      body.innerHTML = '<tr><td colspan="7" class="text-secondary">No pending users.</td></tr>';
      return;
    }
    var tierOpts = '<option value="starter">Starter</option><option value="growth">Growth</option><option value="pro">Pro</option><option value="scale">Scale</option>';
    var h = '';
    rows.forEach(function (row) {
      var email = row && row.email ? String(row.email) : '';
      var country = row && row.last_country ? String(row.last_country).trim() : '';
      var city = row && row.last_city ? String(row.last_city).trim() : '';
      var created = row && row.created_at != null ? Number(row.created_at) : 0;
      var rowId = row && row.id != null ? String(row.id) : '';

      var roleSelect = '<select class="form-select form-select-sm admin-pending-tier-select" data-user-id="' + escapeHtml(rowId) + '" aria-label="Assign role">' + tierOpts + '</select>';
      var actions =
        '<button type="button" class="btn btn-md" data-admin-action="approve" data-user-id="' + escapeHtml(rowId) + '">Approve</button>' +
        '<button type="button" class="btn btn-md" data-admin-action="deny" data-user-id="' + escapeHtml(rowId) + '">Deny</button>' +
        '<button type="button" class="btn btn-md" data-admin-action="promote" data-user-id="' + escapeHtml(rowId) + '">Promote to admin</button>';

      h +=
        '<tr>' +
          '<td><div class="admin-users-email">' + escapeHtml(email || '—') + '</div></td>' +
          '<td>' + roleSelect + '</td>' +
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
    body.innerHTML = '<tr><td colspan="7" class="text-secondary">' + escapeHtml(text || 'Loading…') + '</td></tr>';
  }

  function loadUsers(status) {
    return kfetch('/api/admin/users?status=' + encodeURIComponent(status), { method: 'GET' })
      .then(function (r) { return r.json ? r.json() : null; })
      .then(function (d) { return (d && d.users) ? d.users : []; })
      .catch(function () { return []; });
  }

  function postAction(action, id, bodyObj) {
    var url = '';
    if (action === 'approve') url = '/api/admin/users/' + encodeURIComponent(id) + '/approve';
    else if (action === 'deny') url = '/api/admin/users/' + encodeURIComponent(id) + '/deny';
    else if (action === 'promote') url = '/api/admin/users/' + encodeURIComponent(id) + '/promote-admin';
    else return Promise.resolve(null);
    var body = (bodyObj && typeof bodyObj === 'object') ? JSON.stringify(bodyObj) : '{}';
    return kfetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return { ok: true }; }) : null; })
      .catch(function () { return null; });
  }

  function patchUserTier(id, tier) {
    var url = '/api/admin/users/' + encodeURIComponent(id);
    return kfetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tier: tier }) })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return { ok: true }; }) : null; })
      .catch(function () { return null; });
  }

  function getUserPermissions(id) {
    var url = '/api/admin/users/' + encodeURIComponent(id) + '/permissions';
    return kfetch(url, { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function putUserPermissions(id, overrides) {
    var url = '/api/admin/users/' + encodeURIComponent(id) + '/permissions';
    return kfetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ overrides: overrides }) })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return { ok: true }; }) : null; })
      .catch(function () { return null; });
  }

  var PERM_KEYS_FRONTEND = [
    'page.dashboard.overview', 'page.dashboard.live', 'page.dashboard.sales', 'page.dashboard.table',
    'page.insights.snapshot', 'page.insights.countries', 'page.insights.products', 'page.insights.variants',
    'page.insights.payment_methods', 'page.insights.abandoned_carts',
    'page.acquisition.attribution', 'page.acquisition.browsers', 'page.acquisition.devices',
    'page.integrations.google_ads',
    'page.tools.compare_conversion_rate', 'page.tools.shipping_cr', 'page.tools.click_order_lookup', 'page.tools.change_pins',
    'page.settings',
  ];
  var PERM_KEYS_BACKEND = [
    'settings.kexo', 'settings.kexo.general', 'settings.kexo.assets', 'settings.kexo.icons', 'settings.kexo.colours', 'settings.kexo.layout_styling',
    'settings.integrations', 'settings.integrations.shopify', 'settings.integrations.google_ads',
    'settings.layout', 'settings.layout.tables', 'settings.layout.kpis', 'settings.layout.date_ranges',
    'settings.attribution', 'settings.attribution.mapping', 'settings.attribution.tree',
    'settings.insights', 'settings.insights.variants',
    'settings.cost_expenses', 'settings.cost_expenses.cost_sources', 'settings.cost_expenses.shipping', 'settings.cost_expenses.rules', 'settings.cost_expenses.breakdown',
  ];
  function permKeyToLabel(key) {
    var parts = key.split('.');
    if (parts[0] === 'page') {
      if (parts[1] === 'dashboard') return 'Dashboard \u00BB ' + (parts[2] === 'overview' ? 'Overview' : parts[2] === 'live' ? 'Live View' : parts[2] === 'sales' ? 'Recent Sales' : parts[2] === 'table' ? 'Table View' : parts[2] || key);
      if (parts[1] === 'insights') return 'Insights \u00BB ' + (parts[2] || key);
      if (parts[1] === 'acquisition') return 'Acquisition \u00BB ' + (parts[2] || key);
      if (parts[1] === 'integrations') return 'Integrations \u00BB Google Ads';
      if (parts[1] === 'tools') return 'Tools \u00BB ' + (parts[2] ? parts[2].replace(/_/g, ' ') : key);
      if (parts[1] === 'settings') return 'Settings';
    }
    if (parts[0] === 'settings') {
      if (parts[1] === 'kexo') return parts[2] ? 'Kexo \u00BB ' + (parts[2].replace(/_/g, ' ') || '') : 'Kexo';
      if (parts[1] === 'integrations') return parts[2] ? 'Integrations \u00BB ' + (parts[2] === 'google_ads' ? 'Google Ads' : parts[2]) : 'Integrations';
      if (parts[1] === 'layout') return parts[2] ? 'Layout \u00BB ' + (parts[2].replace(/_/g, ' ') || '') : 'Layout';
      if (parts[1] === 'attribution') return parts[2] ? 'Attribution \u00BB ' + (parts[2] || '') : 'Attribution';
      if (parts[1] === 'insights') return parts[2] ? 'Insights \u00BB ' + (parts[2] || '') : 'Insights';
      if (parts[1] === 'cost_expenses') return parts[2] ? 'Costs \u00BB ' + (parts[2].replace(/_/g, ' ') || '') : 'Costs & profit';
    }
    return key.replace(/\./g, ' \u00BB ').replace(/_/g, ' ');
  }

  function renderPermissionList(container, keys, overrides, effectivePerms) {
    if (!container) return;
    var html = '';
    keys.forEach(function (key) {
      var label = permKeyToLabel(key);
      var state = overrides && overrides[key] === true ? 'enabled' : overrides && overrides[key] === false ? 'disabled' : 'default';
      var name = 'admin-user-perm-' + key.replace(/\./g, '-');
      html += '<div class="d-flex align-items-center gap-3 py-2 border-bottom border-secondary border-opacity-25 admin-user-perm-row" data-perm-key="' + escapeHtml(key) + '">';
      html += '<span class="flex-grow-1 text-break">' + escapeHtml(label) + '</span>';
      html += '<div class="d-flex align-items-center gap-2 flex-shrink-0">';
      html += '<label class="d-flex align-items-center gap-1 mb-0"><input type="radio" name="' + escapeHtml(name) + '" value="default" ' + (state === 'default' ? 'checked' : '') + '> Default</label>';
      html += '<label class="d-flex align-items-center gap-1 mb-0"><input type="radio" name="' + escapeHtml(name) + '" value="enabled" ' + (state === 'enabled' ? 'checked' : '') + '> Enabled</label>';
      html += '<label class="d-flex align-items-center gap-1 mb-0"><input type="radio" name="' + escapeHtml(name) + '" value="disabled" ' + (state === 'disabled' ? 'checked' : '') + '> Disabled</label>';
      html += '</div></div>';
    });
    container.innerHTML = html || '<p class="text-secondary small mb-0">No permissions.</p>';
  }

  function collectOverridesFromModal() {
    var overrides = {};
    document.querySelectorAll('.admin-user-perm-row').forEach(function (row) {
      var key = row.getAttribute('data-perm-key');
      if (!key) return;
      var checked = row.querySelector('input[type="radio"]:checked');
      var val = checked ? String(checked.value) : 'default';
      if (val === 'enabled') overrides[key] = true;
      else if (val === 'disabled') overrides[key] = false;
    });
    return overrides;
  }

  function isNumericUserId(id) {
    if (!id || String(id).startsWith('shop:')) return false;
    var n = Number(id);
    return Number.isFinite(n) && n > 0;
  }

  function bindEditModal() {
    var modal = document.getElementById('admin-user-edit-modal');
    var idEl = document.getElementById('admin-user-edit-id');
    var tierEl = document.getElementById('admin-user-edit-tier');
    var saveBtn = document.getElementById('admin-user-edit-save');
    var frontendEl = document.getElementById('admin-user-edit-perms-frontend');
    var backendEl = document.getElementById('admin-user-edit-perms-backend');
    var permTabs = document.getElementById('admin-user-edit-perm-tabs');
    if (!modal || !idEl || !tierEl || !saveBtn) return;
    saveBtn.addEventListener('click', function () {
      var id = (idEl && idEl.value) ? String(idEl.value).trim() : '';
      var tier = (tierEl && tierEl.value) ? String(tierEl.value).trim() : '';
      if (!id || !tier) return;
      saveBtn.disabled = true;
      var tierPromise = isNumericUserId(id) ? patchUserTier(id, tier) : Promise.resolve(null);
      var permPromise = isNumericUserId(id) ? putUserPermissions(id, collectOverridesFromModal()) : Promise.resolve(null);
      Promise.all([tierPromise, permPromise])
        .then(function () {
          if (typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal && modal) {
            var m = window.bootstrap.Modal.getInstance(modal);
            if (m) m.hide();
          }
          return refreshAll();
        })
        .finally(function () { try { saveBtn.disabled = false; } catch (_) {} });
    });
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
      if (action === 'edit') {
        var modal = document.getElementById('admin-user-edit-modal');
        var idEl = document.getElementById('admin-user-edit-id');
        var tierEl = document.getElementById('admin-user-edit-tier');
        var tier = String(btn.getAttribute('data-user-tier') || 'starter').trim().toLowerCase();
        if (idEl) idEl.value = id;
        if (tierEl) tierEl.value = tier;
        var frontendEl = document.getElementById('admin-user-edit-perms-frontend');
        var backendEl = document.getElementById('admin-user-edit-perms-backend');
        var permTabs = document.getElementById('admin-user-edit-perm-tabs');
        if (permTabs) permTabs.style.display = isNumericUserId(id) ? '' : 'none';
        if (isNumericUserId(id)) {
          getUserPermissions(id).then(function (d) {
            var overrides = (d && d.overrides) ? d.overrides : {};
            var effective = (d && d.effectivePermissions) ? d.effectivePermissions : {};
            if (frontendEl) renderPermissionList(frontendEl, PERM_KEYS_FRONTEND, overrides, effective);
            if (backendEl) renderPermissionList(backendEl, PERM_KEYS_BACKEND, overrides, effective);
          });
        } else {
          if (frontendEl) renderPermissionList(frontendEl, PERM_KEYS_FRONTEND, {}, {});
          if (backendEl) renderPermissionList(backendEl, PERM_KEYS_BACKEND, {}, {});
        }
        if (typeof window.bootstrap !== 'undefined' && window.bootstrap.Modal && modal) {
          var m = new window.bootstrap.Modal(modal);
          m.show();
        }
        return;
      }
      var bodyObj = {};
      if (action === 'approve') {
        var row = btn.closest ? btn.closest('tr') : null;
        var sel = row ? row.querySelector('.admin-pending-tier-select') : null;
        if (sel && sel.value) bodyObj.tier = sel.value;
      }
      btn.disabled = true;
      postAction(action, id, Object.keys(bodyObj).length ? bodyObj : undefined)
        .then(function () { return refreshAll(); })
        .finally(function () { try { btn.disabled = false; } catch (_) {} });
    }
    document.addEventListener('click', handler);
    bindEditModal();
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

    if (isSettingsPage()) {
      var hasSettingsAdminTabs = !!document.querySelector('[data-settings-admin-tab]');
      if (hasSettingsAdminTabs) {
        var initialSettingsTab = getTabFromQuery() || 'controls';
        setActiveTab(initialSettingsTab, { skipUrl: true });
      } else {
        wireAdminAccordionShown();
        expandAdminAccordionFromUrl();
      }
    } else {
      var initial = getTabFromQuery() || 'controls';
      setActiveTab(initial, { skipUrl: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

