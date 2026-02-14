(function () {
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
      var status = row && row.status ? String(row.status).trim().toLowerCase() : '';
      var country = row && row.last_country ? String(row.last_country).trim() : '';
      var city = row && row.last_city ? String(row.last_city).trim() : '';
      var lastLogin = row && row.last_login_at != null ? Number(row.last_login_at) : 0;

      var actions = '';
      if (role === 'master') {
        actions = makeBadge('Master', 'primary');
      } else {
        actions =
          '<button type="button" class="btn btn-sm btn-outline-primary" data-admin-action="promote" data-user-id="' +
          escapeHtml(row.id) +
          '">Promote to master</button>';
      }

      if (status && status !== 'active') {
        actions = actions + ' ' + makeBadge(status, status === 'denied' ? 'danger' : 'secondary');
      }

      h +=
        '<tr>' +
          '<td><div class="admin-users-email">' + escapeHtml(email || '—') + '</div></td>' +
          '<td>' + flagSpan(country, country || '—') + ' <span class="ms-1 text-secondary small">' + escapeHtml(country || '—') + '</span></td>' +
          '<td>' + escapeHtml(city || '—') + '</td>' +
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
        '">Promote to master</button>';

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
    else if (action === 'promote') url = '/api/admin/users/' + encodeURIComponent(id) + '/promote-master';
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

  function init() {
    // This page is master-only (server-gated). Show master-only dropdown items without waiting.
    try {
      var masterEls = document.querySelectorAll ? document.querySelectorAll('.kexo-admin-only') : [];
      masterEls.forEach(function(el) {
        try { if (el && el.classList) el.classList.remove('d-none'); } catch (_) {}
      });
    } catch (_) {}
    bindActions();
    refreshAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

