/**
 * Notifications offcanvas: tabs (Unread/Read/Archived), type icons, detail with Archive + Delete; mark read on view only.
 */
(function () {
  var API = typeof window.API !== 'undefined' ? window.API : '';
  var listEl = document.getElementById('notifications-list');
  var listEmptyEl = document.getElementById('notifications-list-empty');
  var listViewEl = document.getElementById('notifications-list-view');
  var detailViewEl = document.getElementById('notifications-detail-view');
  var detailBodyEl = document.getElementById('notifications-detail-body');
  var detailActionsEl = document.getElementById('notifications-detail-actions');
  var backBtn = document.getElementById('notifications-back-btn');
  var offcanvasEl = document.getElementById('notifications-offcanvas');

  if (!listEl || !offcanvasEl) return;

  var currentTab = 'unread';
  var listData = null;

  var TYPE_ICONS = {
    daily_report: 'fa-chart-line',
    sale: 'fa-cart-shopping',
    sentry: 'fa-bug',
    pending_signup: 'fa-user-clock',
    diagnostics_unresolved: 'fa-wrench',
  };
  var DEFAULT_ICON = 'fa-bell';

  function getIconForType(type) {
    return TYPE_ICONS[type] || DEFAULT_ICON;
  }

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

  function deleteNotification(id) {
    return fetch(API + '/api/notifications/' + encodeURIComponent(String(id)), {
      method: 'DELETE',
      credentials: 'same-origin',
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function renderItem(n, readFlag) {
    var icon = getIconForType(n.type);
    var readAttr = readFlag ? '1' : '0';
    var showArchive = !n.archived_at && currentTab !== 'archived';
    var html = '<div class="list-group-item list-group-item-action notification-item" data-id="' + esc(n.id) + '" data-type="' + esc(n.type) + '" data-read="' + readAttr + '">';
    html += '<a href="#" class="notification-item-main" data-notification-open="1" aria-label="Open notification">';
    html += '<span class="notification-type-icon bg-primary-lt text-primary"><i class="fa-solid ' + esc(icon) + '" aria-hidden="true"></i></span>';
    html += '<span class="notification-item-content">';
    html += '<span class="notification-item-title">' + esc(n.title) + '</span>';
    html += '<span class="notification-item-time d-block">' + esc(formatTime(n.created_at)) + '</span>';
    html += '</span>';
    html += '</a>';
    html += '<div class="notification-item-actions" aria-label="Quick actions">';
    if (showArchive) {
      html += '<button type="button" class="notification-quick-btn notification-quick-btn--archive" data-notification-action="archive" aria-label="Archive"><i class="fa-solid fa-archive" aria-hidden="true"></i></button>';
    }
    html += '<button type="button" class="notification-quick-btn notification-quick-btn--delete" data-notification-action="delete" aria-label="Delete permanently"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function updateTabCounts(data) {
    var unread = (data && data.unread) ? data.unread.length : 0;
    var read = (data && data.read) ? data.read.length : 0;
    var archived = (data && data.archived) ? data.archived.length : 0;
    var countUnread = document.getElementById('notifications-count-unread');
    var countRead = document.getElementById('notifications-count-read');
    var countArchived = document.getElementById('notifications-count-archived');
    if (countUnread) countUnread.textContent = String(unread);
    if (countRead) countRead.textContent = String(read);
    if (countArchived) countArchived.textContent = String(archived);
  }

  function setActiveTab(tab) {
    currentTab = tab;
    var tabs = ['unread', 'read', 'archived'];
    tabs.forEach(function (t) {
      var btn = document.getElementById('notifications-tab-' + t);
      if (btn) {
        btn.classList.toggle('active', t === tab);
        btn.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      }
    });
    renderListForTab();
  }

  function getItemsForCurrentTab() {
    if (!listData || !listData.ok) return [];
    if (currentTab === 'unread') return listData.unread || [];
    if (currentTab === 'read') return listData.read || [];
    return listData.archived || [];
  }

  function getEmptyMessage() {
    if (currentTab === 'unread') return 'No unread notifications.';
    if (currentTab === 'read') return 'No read notifications.';
    return 'No archived notifications.';
  }

  function renderListForTab() {
    var items = getItemsForCurrentTab();
    var html = '';
    items.forEach(function (n) {
      var isUnread = currentTab === 'unread';
      html += renderItem(n, !isUnread);
    });
    listEl.innerHTML = html;
    if (listEmptyEl) {
      listEmptyEl.textContent = getEmptyMessage();
      listEmptyEl.classList.toggle('d-none', items.length > 0);
    }
  }

  function renderList(data) {
    listData = data;
    if (!data || !data.ok) {
      if (listEmptyEl) listEmptyEl.textContent = 'Unable to load notifications.';
      if (listEl) listEl.innerHTML = '';
      updateTabCounts({ unread: 0, read: 0, archived: 0 });
      return;
    }
    var unread = data.unread || [];
    var read = data.read || [];
    var archived = data.archived || [];
    updateTabCounts(data);
    renderListForTab();

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
    if (detailBodyEl) detailBodyEl.innerHTML = '<div class="text-muted">Loading…</div>';
    if (detailActionsEl) detailActionsEl.innerHTML = '';
    fetchDetail(id).then(function (res) {
      if (!res || !res.notification) {
        if (detailBodyEl) detailBodyEl.innerHTML = '<div class="text-danger">Could not load notification.</div>';
        return;
      }
      var n = res.notification;
      var icon = getIconForType(n.type);
      var bodyHtml = '<div class="d-flex align-items-start gap-2 mb-2">';
      bodyHtml += '<span class="notification-type-icon bg-primary-lt text-primary flex-shrink-0"><i class="fa-solid ' + esc(icon) + '" aria-hidden="true"></i></span>';
      bodyHtml += '<div class="flex-grow-1 min-w-0"><strong>' + esc(n.title) + '</strong></div></div>';
      bodyHtml += '<div class="small text-muted mb-2">' + esc(formatTime(n.created_at)) + '</div>';
      if (n.body) bodyHtml += '<div class="notification-body">' + esc(n.body).replace(/\n/g, '<br>') + '</div>';
      if (n.link) bodyHtml += '<p class="mt-3"><a href="' + esc(n.link) + '" class="btn">View</a></p>';
      if (detailBodyEl) detailBodyEl.innerHTML = bodyHtml;

      if (detailActionsEl) {
        var actionsHtml = '';
        if (!n.archived_at) {
          actionsHtml += '<button type="button" class="btn btn-light btn-sm" id="notifications-archive-btn" aria-label="Archive"><i class="fa-solid fa-archive me-1" aria-hidden="true"></i>Archive</button>';
        }
        actionsHtml += '<button type="button" class="btn btn-danger btn-sm" id="notifications-delete-btn" aria-label="Delete permanently"><i class="fa-solid fa-trash me-1" aria-hidden="true"></i>Delete</button>';
        detailActionsEl.innerHTML = actionsHtml;

        var archiveBtn = document.getElementById('notifications-archive-btn');
        if (archiveBtn) {
          archiveBtn.addEventListener('click', function (e) {
            e.preventDefault();
            archiveBtn.disabled = true;
            patchNotification(id, { read: true, archived: true }).then(function () {
              fetchList().then(function (d) {
                renderList(d);
                showListView();
              });
            });
          });
        }
        var deleteBtn = document.getElementById('notifications-delete-btn');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', function (e) {
            e.preventDefault();
            deleteBtn.disabled = true;
            deleteNotification(id).then(function () {
              fetchList().then(function (d) {
                renderList(d);
                showListView();
              });
            });
          });
        }
      }

      if (!alreadyRead) {
        patchNotification(id, { read: true }).then(function () {
          fetchList().then(function (d) {
            listData = d;
            updateTabCounts(d && d.ok ? d : null);
          });
        });
      }
    });
  }

  offcanvasEl.addEventListener('shown.bs.offcanvas', function () {
    if (listEmptyEl) { listEmptyEl.textContent = 'Loading…'; listEmptyEl.classList.remove('d-none'); }
    currentTab = 'unread';
    setActiveTab('unread');
    fetchList().then(renderList);
  });

  listEl.addEventListener('click', function (e) {
    var actionBtn = e.target && e.target.closest ? e.target.closest('[data-notification-action]') : null;
    if (actionBtn) {
      e.preventDefault();
      e.stopPropagation();
      var action = actionBtn.getAttribute('data-notification-action');
      var row = actionBtn.closest('.notification-item');
      var idForAction = row && row.getAttribute ? row.getAttribute('data-id') : null;
      if (!idForAction) return;
      actionBtn.disabled = true;
      if (action === 'archive') {
        patchNotification(idForAction, { read: true, archived: true }).then(function () {
          fetchList().then(function (d) { renderList(d); });
        });
      } else if (action === 'delete') {
        deleteNotification(idForAction).then(function () {
          fetchList().then(function (d) { renderList(d); });
        });
      }
      return;
    }

    var a = e.target && e.target.closest ? e.target.closest('.notification-item') : null;
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('data-id');
    if (id) openDetail(id);
  });

  document.querySelectorAll('[data-notifications-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-notifications-tab');
      if (tab) setActiveTab(tab);
    });
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
