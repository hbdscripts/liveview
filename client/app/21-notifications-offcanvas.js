/**
 * Notifications offcanvas: list (unread/read/archived), detail view, mark read + auto-archive on view.
 */
(function () {
  var API = typeof window.API !== 'undefined' ? window.API : '';
  var listEl = document.getElementById('notifications-list');
  var listEmptyEl = document.getElementById('notifications-list-empty');
  var listViewEl = document.getElementById('notifications-list-view');
  var detailViewEl = document.getElementById('notifications-detail-view');
  var detailBodyEl = document.getElementById('notifications-detail-body');
  var backBtn = document.getElementById('notifications-back-btn');
  var offcanvasEl = document.getElementById('notifications-offcanvas');

  if (!listEl || !offcanvasEl) return;

  function getBadgeEls() {
    return document.querySelectorAll('.kexo-notifications-unread-badge');
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatTime(createdAt) {
    if (createdAt == null) return '';
    var ts = Number(createdAt);
    if (!Number.isFinite(ts)) return '';
    var d = new Date(ts);
    var now = Date.now();
    var diff = now - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    try {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
    } catch (_) {
      return '';
    }
  }

  function fetchList() {
    return fetch(API + '/api/notifications', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function fetchDetail(id) {
    return fetch(API + '/api/notifications/' + encodeURIComponent(String(id)), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function patchNotification(id, body) {
    return fetch(API + '/api/notifications/' + encodeURIComponent(String(id)), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function renderList(data) {
    if (!data || !data.ok) {
      if (listEmptyEl) listEmptyEl.textContent = 'Unable to load notifications.';
      if (listEl) listEl.innerHTML = '';
      return;
    }
    var unread = data.unread || [];
    var read = data.read || [];
    var archived = data.archived || [];
    var all = unread.concat(read).concat(archived);
    if (listEmptyEl) {
      listEmptyEl.textContent = all.length === 0 ? 'No notifications.' : '';
      listEmptyEl.classList.toggle('d-none', all.length > 0);
    }
    var html = '';
    if (unread.length) {
      html += '<div class="list-group-item list-group-item-secondary small text-uppercase">Unread</div>';
      unread.forEach(function (n) {
        html += '<a href="#" class="list-group-item list-group-item-action notification-item" data-id="' + esc(n.id) + '" data-read="0">';
        html += '<span class="text-body">' + esc(n.title) + '</span>';
        html += '<span class="small text-secondary ms-2">' + esc(formatTime(n.created_at)) + '</span>';
        html += '</a>';
      });
    }
    if (read.length) {
      html += '<div class="list-group-item list-group-item-secondary small text-uppercase">Read</div>';
      read.forEach(function (n) {
        html += '<a href="#" class="list-group-item list-group-item-action notification-item" data-id="' + esc(n.id) + '" data-read="1">';
        html += '<span class="text-body">' + esc(n.title) + '</span>';
        html += '<span class="small text-secondary ms-2">' + esc(formatTime(n.created_at)) + '</span>';
        html += '</a>';
      });
    }
    if (archived.length) {
      html += '<div class="list-group-item list-group-item-secondary small text-uppercase">Archived</div>';
      archived.forEach(function (n) {
        html += '<a href="#" class="list-group-item list-group-item-action notification-item text-secondary" data-id="' + esc(n.id) + '" data-read="1">';
        html += '<span class="text-body">' + esc(n.title) + '</span>';
        html += '<span class="small text-secondary ms-2">' + esc(formatTime(n.created_at)) + '</span>';
        html += '</a>';
      });
    }
    listEl.innerHTML = html || '';

    var count = (data.unreadCount != null ? data.unreadCount : unread.length);
    getBadgeEls().forEach(function (el) {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.classList.remove('is-hidden');
      } else {
        el.classList.add('is-hidden');
      }
    });
  }

  function showListView() {
    if (listViewEl) listViewEl.classList.remove('d-none');
    if (listViewEl) listViewEl.classList.add('d-flex');
    if (detailViewEl) detailViewEl.classList.add('d-none');
    if (detailViewEl) detailViewEl.classList.remove('d-flex');
  }

  function showDetailView() {
    if (listViewEl) listViewEl.classList.add('d-none');
    if (listViewEl) listViewEl.classList.remove('d-flex');
    if (detailViewEl) detailViewEl.classList.remove('d-none');
    if (detailViewEl) detailViewEl.classList.add('d-flex', 'flex-column');
  }

  function openDetail(id) {
    var item = listEl.querySelector('.notification-item[data-id="' + CSS.escape(String(id)) + '"]');
    var alreadyRead = item && item.getAttribute('data-read') === '1';
    showDetailView();
    if (detailBodyEl) detailBodyEl.innerHTML = '<div class="text-secondary">Loading…</div>';
    fetchDetail(id).then(function (res) {
      if (!res || !res.notification) {
        if (detailBodyEl) detailBodyEl.innerHTML = '<div class="text-danger">Could not load notification.</div>';
        return;
      }
      var n = res.notification;
      var bodyHtml = '<div class="mb-2"><strong>' + esc(n.title) + '</strong></div>';
      bodyHtml += '<div class="small text-secondary mb-2">' + esc(formatTime(n.created_at)) + '</div>';
      if (n.body) bodyHtml += '<div class="notification-body">' + esc(n.body).replace(/\n/g, '<br>') + '</div>';
      if (n.link) bodyHtml += '<p class="mt-3"><a href="' + esc(n.link) + '" class="btn btn-outline-primary btn-sm">View</a></p>';
      if (detailBodyEl) detailBodyEl.innerHTML = bodyHtml;

      if (!alreadyRead) {
        patchNotification(id, { read: true, archived: true }).then(function () {
          fetchList().then(renderList);
        });
      }
    });
  }

  offcanvasEl.addEventListener('shown.bs.offcanvas', function () {
    if (listEmptyEl) { listEmptyEl.textContent = 'Loading…'; listEmptyEl.classList.remove('d-none'); }
    fetchList().then(renderList);
  });

  listEl.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('.notification-item') : null;
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('data-id');
    if (id) openDetail(id);
  });

  if (backBtn) {
    backBtn.addEventListener('click', function (e) {
      e.preventDefault();
      showListView();
    });
  }

  function updateBadge(data) {
    if (!data || !data.ok) return;
    var count = data.unreadCount != null ? data.unreadCount : (data.unread || []).length;
    getBadgeEls().forEach(function (el) {
      if (count > 0) {
        el.textContent = count > 99 ? '99+' : String(count);
        el.classList.remove('is-hidden');
      } else {
        el.classList.add('is-hidden');
      }
    });
  }

  fetchList().then(updateBadge);
  setInterval(function () {
    fetchList().then(updateBadge);
  }, 60000);
})();
