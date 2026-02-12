(function () {
  'use strict';

  if (!document.body || document.body.getAttribute('data-page') !== 'variants') return;

  var API = '';
  try {
    if (typeof window !== 'undefined' && window.API) API = String(window.API || '');
  } catch (_) {}

  var state = {
    shop: '',
    tables: [],
    loading: false,
    loaded: false,
  };

  function dismissGlobalPageLoader() {
    try {
      var overlay = document.getElementById('page-body-loader');
      if (overlay) overlay.classList.add('is-hidden');
    } catch (_) {}
    try {
      var pageBody = document.querySelector('.page-body');
      if (pageBody) {
        pageBody.classList.remove('report-building');
        pageBody.style.minHeight = '';
      }
    } catch (_) {}
  }

  function escapeHtml(value) {
    if (value == null) return '';
    var div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
  }

  function getShopFromQuery() {
    try {
      var m = /[?&]shop=([^&]+)/.exec(window.location.search || '');
      return m && m[1] ? decodeURIComponent(m[1]) : '';
    } catch (_) {
      return '';
    }
  }

  function getRangeKey() {
    var el = document.getElementById('global-date-select');
    if (!el || !el.value) return 'today';
    return String(el.value).trim().toLowerCase() || 'today';
  }

  function rowsStorageKey(tableId) {
    return 'kexo:table-rows:v1:' + String(tableId || '').trim().toLowerCase();
  }

  function rowsPerPageForTable(tableId) {
    var fallback = 5;
    try {
      var raw = localStorage.getItem(rowsStorageKey(tableId));
      var n = parseInt(String(raw || ''), 10);
      if (n === 5 || n === 10) return n;
    } catch (_) {}
    return fallback;
  }

  function buildTableCard(table) {
    var safeId = String(table.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    var tableId = 'variants-table-' + safeId;
    var bodyId = 'variants-body-' + safeId;
    var wrapId = 'variants-wrap-' + safeId;
    var paginationId = 'variants-pagination-' + safeId;
    var cardId = 'stats-variants-' + safeId;
    var title = table.name || table.id || 'Variant Table';
    var diag = table && table.diagnostics ? table.diagnostics : null;
    var unmappedCount = diag && Number(diag.unmappedCount) ? Number(diag.unmappedCount) : 0;
    var ambiguousCount = diag && Number(diag.ambiguousCount) ? Number(diag.ambiguousCount) : 0;
    var hasWarnings = unmappedCount > 0 || ambiguousCount > 0;
    var warningText = hasWarnings
      ? ('Mappings issue: ' + String(unmappedCount) + ' unmapped, ' + String(ambiguousCount) + ' ambiguous')
      : '';

    return '' +
      '<div class="stats-card card" id="' + escapeHtml(cardId) + '" data-table-class="dashboard" data-table-zone="variants-' + escapeHtml(safeId) + '" data-table-id="' + escapeHtml(tableId) + '">' +
        '<div class="card-header d-flex align-items-center justify-content-between">' +
          '<h3 class="card-title">' + escapeHtml(title) + '</h3>' +
          (hasWarnings ? '<span class="badge bg-warning-lt text-warning" title="' + escapeHtml(warningText) + '">' + escapeHtml(String(unmappedCount + ambiguousCount)) + ' mapping issues</span>' : '') +
        '</div>' +
        '<div class="country-table-wrap" id="' + escapeHtml(wrapId) + '">' +
          '<div id="' + escapeHtml(tableId) + '" class="grid-table by-country-table best-variants-table" role="table" aria-label="' + escapeHtml(title) + '">' +
            '<div class="grid-header kexo-grid-header" role="rowgroup">' +
              '<div class="grid-row grid-row--header" role="row">' +
                '<div class="grid-cell bs-product-col sortable" role="columnheader" data-sort="variant" aria-sort="none" tabindex="0" aria-label="Variant"><span class="th-label-long">Variant</span><span class="th-label-short"><i class="fa-solid fa-box-open" data-icon-key="table-short-product" aria-hidden="true"></i></span></div>' +
                '<div class="grid-cell sortable" role="columnheader" data-sort="sessions" aria-sort="none" tabindex="0" aria-label="Sessions"><span class="th-label-long">Sessions</span><span class="th-label-short"><i class="fa-jelly-filled fa-hand-pointer" data-icon-key="table-icon-clicks" aria-hidden="true"></i></span></div>' +
                '<div class="grid-cell sortable" role="columnheader" data-sort="orders" aria-sort="none" tabindex="0" aria-label="Orders"><span class="th-label-long">Orders</span><span class="th-label-short"><i class="fa-jelly-filled fa-box-open" data-icon-key="table-icon-orders" aria-hidden="true"></i></span></div>' +
                '<div class="grid-cell sortable" role="columnheader" data-sort="cr" aria-sort="none" tabindex="0" aria-label="CR%"><span class="th-label-long">CR%</span><span class="th-label-short"><i class="fa-jelly-filled fa-percent" data-icon-key="table-icon-cr" aria-hidden="true"></i></span></div>' +
                '<div class="grid-cell sortable" role="columnheader" data-sort="rev" aria-sort="descending" tabindex="0" aria-label="Rev"><span class="th-label-long">Rev</span><span class="th-label-short"><i class="fa-jelly-filled fa-sterling-sign" data-icon-key="table-icon-revenue" aria-hidden="true"></i></span></div>' +
              '</div>' +
            '</div>' +
            '<div id="' + escapeHtml(bodyId) + '" class="grid-body" role="rowgroup">' +
              '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">Loading…</div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-footer d-flex align-items-center justify-content-center is-hidden" id="' + escapeHtml(paginationId) + '" aria-label="' + escapeHtml(title) + ' pagination"></div>' +
      '</div>';
  }

  function formatInt(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.max(0, Math.trunc(n)).toLocaleString();
  }

  function formatPct(value) {
    if (value == null) return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(1) + '%';
  }

  function formatMoney(value) {
    if (value == null) return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return '&pound;' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function cmpText(a, b, dir) {
    var aa = a == null ? '' : String(a).toLowerCase();
    var bb = b == null ? '' : String(b).toLowerCase();
    if (aa === bb) return 0;
    if (dir === 'asc') return aa < bb ? -1 : 1;
    return aa < bb ? 1 : -1;
  }

  function cmpNum(a, b, dir) {
    var aa = Number(a);
    var bb = Number(b);
    var av = Number.isFinite(aa) ? aa : null;
    var bv = Number.isFinite(bb) ? bb : null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return 0;
    return dir === 'asc' ? (av - bv) : (bv - av);
  }

  function clampPage(page, totalPages) {
    var n = Number(page);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(Math.max(1, Math.trunc(n)), Math.max(1, Math.trunc(totalPages || 1)));
  }

  function buildPagination(page, totalPages) {
    try {
      if (typeof window.__kexoBuildPaginationHtml === 'function') {
        return window.__kexoBuildPaginationHtml(page, totalPages);
      }
    } catch (_) {}
    return '';
  }

  function updateSortHeaders(tableId, sortBy, sortDir) {
    var root = document.getElementById(tableId);
    if (!root) return;
    root.querySelectorAll('.grid-cell.sortable').forEach(function (th) {
      var col = (th.getAttribute('data-sort') || '').trim();
      var active = col === sortBy;
      th.classList.remove('th-sort-asc', 'th-sort-desc');
      th.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      if (active) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
    });
  }

  function renderTableRows(tableState) {
    var safeId = tableState.safeId;
    var tableId = 'variants-table-' + safeId;
    var bodyId = 'variants-body-' + safeId;
    var paginationId = 'variants-pagination-' + safeId;
    var body = document.getElementById(bodyId);
    var paginationWrap = document.getElementById(paginationId);
    if (!body) return;

    var rows = Array.isArray(tableState.rows) ? tableState.rows.slice() : [];
    var sortBy = tableState.sortBy || 'rev';
    var sortDir = tableState.sortDir === 'asc' ? 'asc' : 'desc';
    rows.sort(function (a, b) {
      if (sortBy === 'variant') return cmpText(a && a.variant, b && b.variant, sortDir);
      if (sortBy === 'sessions') return cmpNum(a && a.sessions, b && b.sessions, sortDir) || cmpNum(a && a.revenue, b && b.revenue, 'desc');
      if (sortBy === 'orders') return cmpNum(a && a.orders, b && b.orders, sortDir) || cmpNum(a && a.revenue, b && b.revenue, 'desc');
      if (sortBy === 'cr') return cmpNum(a && a.cr, b && b.cr, sortDir) || cmpNum(a && a.orders, b && b.orders, 'desc');
      return cmpNum(a && a.revenue, b && b.revenue, sortDir) || cmpNum(a && a.orders, b && b.orders, 'desc');
    });

    if (!rows.length) {
      body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No mapped data in this range</div></div>';
      if (paginationWrap) {
        paginationWrap.classList.add('is-hidden');
        paginationWrap.innerHTML = '';
      }
      updateSortHeaders(tableId, sortBy, sortDir);
      return;
    }

    var pageSize = rowsPerPageForTable(tableId);
    var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    tableState.page = clampPage(tableState.page || 1, totalPages);
    var start = (tableState.page - 1) * pageSize;
    var pageRows = rows.slice(start, start + pageSize);

    body.innerHTML = pageRows.map(function (row) {
      return '' +
        '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell"><span class="bs-name" title="' + escapeHtml(row.variant || '—') + '">' + escapeHtml(row.variant || '—') + '</span></div></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatInt(row.sessions)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatInt(row.orders)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatPct(row.cr)) + '</div>' +
          '<div class="grid-cell" role="cell">' + formatMoney(row.revenue) + '</div>' +
        '</div>';
    }).join('');

    if (paginationWrap) {
      if (totalPages > 1) {
        paginationWrap.classList.remove('is-hidden');
        paginationWrap.innerHTML = buildPagination(tableState.page, totalPages);
      } else {
        paginationWrap.classList.add('is-hidden');
        paginationWrap.innerHTML = '';
      }
    }
    updateSortHeaders(tableId, sortBy, sortDir);
  }

  function bindTableInteractions(tableState) {
    var safeId = tableState.safeId;
    var tableId = 'variants-table-' + safeId;
    var paginationId = 'variants-pagination-' + safeId;
    var tableEl = document.getElementById(tableId);
    var paginationEl = document.getElementById(paginationId);
    if (!tableEl || tableEl.getAttribute('data-variants-bound') === '1') return;

    tableEl.setAttribute('data-variants-bound', '1');
    tableEl.querySelectorAll('.grid-cell.sortable').forEach(function (th) {
      function activate() {
        var col = (th.getAttribute('data-sort') || '').trim().toLowerCase();
        if (!col) return;
        if (tableState.sortBy === col) {
          tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          tableState.sortBy = col;
          tableState.sortDir = col === 'variant' ? 'asc' : 'desc';
        }
        tableState.page = 1;
        renderTableRows(tableState);
      }
      th.addEventListener('click', function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        activate();
      });
      th.addEventListener('keydown', function (e) {
        if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        activate();
      });
    });

    if (paginationEl && paginationEl.getAttribute('data-variants-bound') !== '1') {
      paginationEl.setAttribute('data-variants-bound', '1');
      paginationEl.addEventListener('click', function (e) {
        var link = e && e.target && e.target.closest ? e.target.closest('a[data-page]') : null;
        if (!link) return;
        e.preventDefault();
        if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
        var next = parseInt(String(link.getAttribute('data-page') || ''), 10);
        if (!Number.isFinite(next) || next < 1) return;
        tableState.page = next;
        renderTableRows(tableState);
      });
    }
  }

  function renderAllTables(payload) {
    var root = document.getElementById('variants-tables-row');
    if (!root) return;
    var tables = payload && Array.isArray(payload.tables) ? payload.tables : [];
    if (!tables.length) {
      root.innerHTML = '' +
        '<div class="stats-card card" data-no-card-collapse="1">' +
          '<div class="card-header"><h3 class="card-title">Variants</h3></div>' +
          '<div class="card-body text-secondary">' +
            '<div>No enabled variant tables. Open Settings → Insights → Variants to configure tables.</div>' +
            '<a class="btn btn-sm btn-primary mt-3" href="/settings?tab=insights">Configure variants</a>' +
          '</div>' +
        '</div>';
      dismissGlobalPageLoader();
      return;
    }

    var diagById = {};
    var diagnostics = payload && Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    diagnostics.forEach(function (d) {
      var id = d && d.tableId ? String(d.tableId).trim().toLowerCase() : '';
      if (!id) return;
      diagById[id] = d;
    });

    state.tables = tables.map(function (t) {
      var safeId = String(t && t.id ? t.id : '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      var tableId = t && t.id ? String(t.id).trim().toLowerCase() : '';
      return {
        id: t.id,
        safeId: safeId,
        name: t.name || t.id || 'Variant Table',
        rows: Array.isArray(t.rows) ? t.rows.slice() : [],
        diagnostics: tableId && diagById[tableId] ? diagById[tableId] : null,
        sortBy: 'rev',
        sortDir: 'desc',
        page: 1,
      };
    });

    root.innerHTML = state.tables.map(function (t) { return buildTableCard(t); }).join('');
    state.tables.forEach(function (t) {
      bindTableInteractions(t);
      renderTableRows(t);
    });
    dismissGlobalPageLoader();
  }

  function setLoadingUi(on) {
    var note = document.getElementById('variants-loading-note');
    if (!note) return;
    note.textContent = on ? 'Loading variant tables…' : 'Ready';
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = Number(timeoutMs);
    var timeout = Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : 25000;
    if (typeof AbortController === 'undefined') {
      return Promise.race([
        fetch(url, options || {}),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('Request timed out')); }, timeout);
        }),
      ]);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () {
      try { controller.abort(); } catch (_) {}
    }, timeout);
    var opts = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  function fetchShopFallback() {
    return fetch((API || '') + '/api/store-base-url', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var shop = data && data.shopForSales ? String(data.shopForSales).trim().toLowerCase() : '';
        return shop;
      })
      .catch(function () { return ''; });
  }

  function refreshVariants(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var force = !!opts.force;
    if (state.loading) return Promise.resolve(null);
    state.loading = true;
    setLoadingUi(true);

    var ensureShop = state.shop
      ? Promise.resolve(state.shop)
      : Promise.resolve(getShopFromQuery() || '').then(function (shop) {
        if (shop) return shop;
        return fetchShopFallback();
      });

    return ensureShop
      .then(function (shop) {
        state.shop = shop || '';
        if (!state.shop || !/\.myshopify\.com$/i.test(state.shop)) {
          renderAllTables({ tables: [] });
          return null;
        }
        var url = (API || '') + '/api/insights-variants?shop=' + encodeURIComponent(state.shop) +
          '&range=' + encodeURIComponent(getRangeKey());
        if (force) url += '&_=' + Date.now();
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            renderAllTables(data || { tables: [] });
            state.loaded = true;
            return data;
          });
      })
      .catch(function () {
        renderAllTables({ tables: [] });
        return null;
      })
      .finally(function () {
        state.loading = false;
        dismissGlobalPageLoader();
      });
  }

  function bindGlobalListeners() {
    var dateSelect = document.getElementById('global-date-select');
    if (dateSelect && dateSelect.getAttribute('data-variants-bound') !== '1') {
      dateSelect.setAttribute('data-variants-bound', '1');
      dateSelect.addEventListener('change', function () {
        refreshVariants({ force: true });
      });
    }

    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn && refreshBtn.getAttribute('data-variants-bound') !== '1') {
      refreshBtn.setAttribute('data-variants-bound', '1');
      refreshBtn.addEventListener('click', function () {
        setTimeout(function () { refreshVariants({ force: true }); }, 0);
      });
    }

    window.addEventListener('kexo:table-rows-changed', function (evt) {
      var detail = evt && evt.detail ? evt.detail : null;
      var tableId = detail && detail.tableId ? String(detail.tableId) : '';
      if (!tableId || tableId.indexOf('variants-table-') !== 0) return;
      var safeId = tableId.replace(/^variants-table-/, '');
      var tableState = state.tables.find(function (t) { return t && t.safeId === safeId; });
      if (!tableState) return;
      tableState.page = 1;
      renderTableRows(tableState);
    });
  }

  function init() {
    try { window.__refreshVariantsInsights = refreshVariants; } catch (_) {}
    dismissGlobalPageLoader();
    bindGlobalListeners();
    refreshVariants({ force: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
