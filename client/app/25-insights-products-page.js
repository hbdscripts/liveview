/**
 * Insights → Products page: embedded search, trending table, gross-profit tables.
 * Only runs when data-page="products".
 */
(function () {
  'use strict';
  var body = document.body;
  if (!body || (body.getAttribute && body.getAttribute('data-page')) !== 'products') return;

  var API = (typeof window !== 'undefined' && window.API != null) ? String(window.API) : '';
  var SEARCH_DEBOUNCE_MS = 220;

  function getPageSize(tableId) {
    try {
      if (typeof getTableRowsPerPage === 'function') return getTableRowsPerPage(tableId, 'product');
    } catch (_) {}
    return 5;
  }

  function buildPaginationHtml(page, totalPages) {
    try {
      if (typeof window.__kexoBuildPaginationHtml === 'function') return window.__kexoBuildPaginationHtml(page, totalPages);
    } catch (_) {}
    // Minimal fallback (should rarely be used).
    return '<nav aria-label="Pagination"><ul class="pagination pagination-sm mb-0">' +
      '<li class="page-item' + (page <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (page - 1) + '">Prev</a></li>' +
      '<li class="page-item disabled"><span class="page-link">' + page + ' / ' + totalPages + '</span></li>' +
      '<li class="page-item' + (page >= totalPages ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (page + 1) + '">Next</a></li>' +
      '</ul></nav>';
  }

  function setCardPagination(prefix, page, totalPages) {
    var wrap = document.getElementById(prefix + '-pagination');
    if (!wrap) return;
    var pages = Math.max(1, Number(totalPages) || 1);
    var p = Math.max(1, Math.min(Number(page) || 1, pages));
    wrap.classList.toggle('is-hidden', pages <= 1);
    if (pages <= 1) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = buildPaginationHtml(p, pages);
  }

  function getShop() {
    try {
      if (typeof getShopForSales === 'function') {
        var s = getShopForSales();
        if (s) return s;
      }
      if (typeof getShopParam === 'function') return getShopParam() || '';
      var q = window.location && window.location.search ? window.location.search : '';
      var p = q ? new URLSearchParams(q) : null;
      return (p && p.get('shop')) ? String(p.get('shop')).trim() : '';
    } catch (_) { return ''; }
  }

  function getRange() {
    try {
      if (typeof getStatsRange === 'function') return getStatsRange() || '7d';
    } catch (_) {}
    return '7d';
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtGbp(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '—';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(x); } catch (_) { return '£' + Number(x).toFixed(2); }
  }

  function fmtSignedGbp(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '—';
    var s = x >= 0 ? '+' : '';
    return s + fmtGbp(x);
  }

  function fmtPct(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '—';
    return Number(x).toFixed(1) + '%';
  }

  // —— Search ——
  var searchDebounceTimer = null;
  var searchAbort = null;

  function showSearchDropdown(show) {
    var wrap = document.getElementById('products-page-search-dropdown');
    if (wrap) wrap.classList.toggle('is-open', !!show);
  }

  function onSearchInput() {
    var input = document.getElementById('products-page-search-input');
    var dropdown = document.getElementById('products-page-search-dropdown');
    if (!input || !dropdown) return;
    var q = (input.value || '').trim();
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    if (!q) {
      dropdown.innerHTML = '';
      showSearchDropdown(false);
      return;
    }
    searchDebounceTimer = setTimeout(function () {
      searchDebounceTimer = null;
      if (searchAbort) searchAbort.abort();
      var shop = getShop();
      var url = API + '/api/tools/catalog-search?q=' + encodeURIComponent(q) + '&limit=10';
      if (shop) url += '&shop=' + encodeURIComponent(shop);
      var controller = new AbortController();
      searchAbort = controller;
      fetch(url, { credentials: 'same-origin', signal: controller.signal })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (controller.signal && controller.signal.aborted) return;
          searchAbort = null;
          var products = (data && data.products && Array.isArray(data.products)) ? data.products : [];
          var err = (data && data.ok === false && data.error) ? String(data.error) : '';
          var qs = window.location.search || '';
          if (!products.length) {
            var msg = (err === 'missing_shop_or_token') ? 'Select a shop to search products.' : 'No products found';
            dropdown.innerHTML = '<div class="dropdown-item text-muted">' + escapeHtml(msg) + '</div>';
          } else {
            dropdown.innerHTML = products.map(function (p) {
              var id = (p && p.product_id) ? String(p.product_id) : '';
              var title = escapeHtml((p && p.title) ? p.title : 'Untitled');
              if (!id) return '';
              return '<a class="dropdown-item kexo-product-search-hit" href="' + escapeHtml('/insights/products/' + id + qs) + '" data-product-id="' + escapeHtml(id) + '">' + title + '</a>';
            }).join('');
          }
          showSearchDropdown(true);
          dropdown.querySelectorAll('.kexo-product-search-hit').forEach(function (a) {
            a.addEventListener('click', function (e) {
              e.preventDefault();
              var href = a.getAttribute('href');
              if (href) window.location.assign(href);
            });
          });
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          searchAbort = null;
          dropdown.innerHTML = '<div class="dropdown-item text-muted">Search failed</div>';
          showSearchDropdown(true);
        });
    }, SEARCH_DEBOUNCE_MS);
  }

  document.addEventListener('click', function (e) {
    var input = document.getElementById('products-page-search-input');
    var dropdown = document.getElementById('products-page-search-dropdown');
    if (!input || !dropdown) return;
    if (e.target !== input && !dropdown.contains(e.target)) showSearchDropdown(false);
  });

  var searchInput = document.getElementById('products-page-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', onSearchInput);
    searchInput.addEventListener('focus', function () { if ((searchInput.value || '').trim()) onSearchInput(); });
  }

  // —— Trending ——
  var productsTrendingMode = 'up';
  var productsTrendingPage = 1;
  var productsTrendingCache = null;
  var productsTrendingRange = '';

  function renderProductsTrendingTable(items) {
    var tbody = document.getElementById('products-trending-body');
    var paginationEl = document.getElementById('products-trending-pagination');
    if (!tbody) return;
    var rows = Array.isArray(items) ? items : [];
    var pageSize = getPageSize('products-trending-table');
    var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    productsTrendingPage = Math.max(1, Math.min(productsTrendingPage, totalPages));
    var pageStart = (productsTrendingPage - 1) * pageSize;
    var pageRows = rows.slice(pageStart, pageStart + pageSize);

    function deltaText(r) {
      var d = (r && typeof r.deltaRevenue === 'number' && isFinite(r.deltaRevenue)) ? r.deltaRevenue : 0;
      var cls = d >= 0 ? 'text-green' : 'text-red';
      var pct = (r && typeof r.pctGrowth === 'number' && isFinite(r.pctGrowth)) ? r.pctGrowth : null;
      var pctStr = pct != null ? (pct >= 999 ? ' new' : ' (' + (pct >= 0 ? '+' : '') + pct + '%)') : '';
      return '<span class="dash-trend-delta ' + cls + '">' + escapeHtml(fmtSignedGbp(d) + pctStr) + '</span>';
    }
    function deltaOrdersText(r) {
      var d = (r && typeof r.deltaOrders === 'number' && isFinite(r.deltaOrders)) ? r.deltaOrders : 0;
      var sign = d >= 0 ? '+' : '';
      var cls = d >= 0 ? 'text-green' : 'text-red';
      return '<span class="dash-trend-delta ' + cls + '">' + sign + String(d) + '</span>';
    }

    if (!pageRows.length) {
      tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
    } else {
      tbody.innerHTML = pageRows.map(function (p) {
        var title = p && p.title ? String(p.title) : 'Unknown';
        var handle = (p && p.handle) ? String(p.handle).trim().toLowerCase() : '';
        var productId = (p && p.product_id) ? String(p.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        var numericId = (productId && /^\d+$/.test(productId)) ? productId : '';
        var canOpen = !!numericId;
        var qs = window.location.search || '';
        var linkHref = numericId ? ('/insights/products/' + numericId) : '#';
        var targetAttr = linkHref.indexOf('/insights/') === 0 ? '' : ' target="_blank" rel="noopener"';
        var nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(linkHref) + '"' + targetAttr +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (numericId ? (' data-product-id="' + escapeHtml(numericId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title);
        var name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + nameInner + '</span>';

        var revCell = '<div>' + deltaText(p) + '</div>';
        var ordCell = '<div>' + deltaOrdersText(p) + '</div>';
        var crCell = fmtPct(p && (typeof p.cr === 'number' ? p.cr : null));
        var vpvVal = (p && typeof p.vpv === 'number' && isFinite(p.vpv)) ? p.vpv : null;
        var vpvCell = vpvVal != null ? fmtGbp(vpvVal) : '\u2014';

        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + revCell + '</div>' +
          '<div class="grid-cell" role="cell">' + ordCell + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(crCell) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(vpvCell) + '</div>' +
        '</div>';
      }).join('');
    }

    if (paginationEl) {
      setCardPagination('products-trending', productsTrendingPage, totalPages);
      paginationEl.querySelectorAll('a[data-page]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var p = parseInt(a.getAttribute('data-page'), 10);
          if (Number.isFinite(p) && p >= 1 && p <= totalPages) {
            productsTrendingPage = p;
            var list = productsTrendingMode === 'up'
              ? (productsTrendingCache && productsTrendingCache.trendingUp) || []
              : (productsTrendingCache && productsTrendingCache.trendingDown) || [];
            renderProductsTrendingTable(list);
          }
        });
      });
    }
  }

  function fetchProductsTrending() {
    var rangeKey = getRange();
    var url = API + '/api/dashboard-series?range=' + encodeURIComponent(rangeKey) + '&trendingPreset=' + encodeURIComponent(rangeKey);
    try { if (typeof window.kexoGetTrafficQuerySuffix === 'function') url += window.kexoGetTrafficQuerySuffix(); } catch (_) {}
    fetch(url, { credentials: 'same-origin', cache: 'default' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        productsTrendingRange = rangeKey;
        productsTrendingCache = data;
        var items = (data && data.trendingUp && Array.isArray(data.trendingUp)) ? data.trendingUp : [];
        if (productsTrendingMode !== 'up') items = (data && data.trendingDown && Array.isArray(data.trendingDown)) ? data.trendingDown : [];
        productsTrendingPage = 1;
        renderProductsTrendingTable(items);
      })
      .catch(function () {
        productsTrendingCache = null;
        renderProductsTrendingTable([]);
      });
  }

  var trendingToggle = document.getElementById('products-trending-toggle');
  if (trendingToggle) {
    trendingToggle.addEventListener('click', function (e) {
      e.preventDefault();
      productsTrendingMode = productsTrendingMode === 'up' ? 'down' : 'up';
      var titleEl = document.getElementById('products-trending-title');
      var iconEl = trendingToggle.querySelector('.kexo-trending-chevron');
      if (titleEl) titleEl.textContent = productsTrendingMode === 'up' ? 'Up' : 'Down';
      trendingToggle.setAttribute('aria-label', productsTrendingMode === 'up' ? 'Switch to Trending Down' : 'Switch to Trending Up');
      if (iconEl) iconEl.className = (productsTrendingMode === 'up' ? 'fa-solid fa-angle-down' : 'fa-solid fa-angle-up') + ' ms-1 kexo-trending-chevron';
      var items = productsTrendingMode === 'up'
        ? (productsTrendingCache && productsTrendingCache.trendingUp) || []
        : (productsTrendingCache && productsTrendingCache.trendingDown) || [];
      productsTrendingPage = 1;
      renderProductsTrendingTable(items);
    });
  }

  // —— Gross profit ——
  var grossProfitHighPage = 1;
  var grossProfitLowPage = 1;
  var grossProfitHighRows = [];
  var grossProfitLowRows = [];

  function renderGrossProfitTable(tableId, bodyId, rows, pageKey) {
    var tbody = document.getElementById(bodyId);
    var paginationEl = document.getElementById(bodyId.replace('-body', '-pagination'));
    if (!tbody) return;
    var page = (pageKey === 'high') ? grossProfitHighPage : grossProfitLowPage;
    var pageSize = getPageSize(tableId);
    var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.max(1, Math.min(page, totalPages));
    if (pageKey === 'high') grossProfitHighPage = page; else grossProfitLowPage = page;
    var pageStart = (page - 1) * pageSize;
    var pageRows = rows.slice(pageStart, pageStart + pageSize);

    if (!pageRows.length) {
      tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
    } else {
      tbody.innerHTML = pageRows.map(function (r) {
        var title = (r && r.title != null) ? String(r.title) : (r && r.product_id != null ? r.product_id : '—');
        var productId = (r && r.product_id) ? String(r.product_id) : '';
        var numericId = (productId && /^\d+$/.test(productId)) ? productId : '';
        var revenue = (r && r.revenue_gbp != null) ? Number(r.revenue_gbp) : 0;
        var cost = (r && r.cost_gbp != null) ? Number(r.cost_gbp) : 0;
        var profit = (r && r.gross_profit_gbp != null) ? Number(r.gross_profit_gbp) : (revenue - cost);
        var qs = window.location.search || '';
        var linkHref = numericId ? ('/insights/products/' + numericId) : '#';
        var canOpen = !!numericId;
        var nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(linkHref) + '"' +
                (numericId ? (' data-product-id="' + escapeHtml(numericId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title);
        var name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + nameInner + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtGbp(revenue)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtGbp(cost)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(fmtGbp(profit)) + '</div>' +
        '</div>';
      }).join('');
    }

    if (paginationEl) {
      setCardPagination(bodyId.replace('-body', ''), page, totalPages);
      paginationEl.querySelectorAll('a[data-page]').forEach(function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var p = parseInt(a.getAttribute('data-page'), 10);
          if (!Number.isFinite(p)) return;
          if (pageKey === 'high') grossProfitHighPage = p; else grossProfitLowPage = p;
          renderGrossProfitTable(
            pageKey === 'high' ? 'products-gross-profit-high-table' : 'products-gross-profit-low-table',
            pageKey === 'high' ? 'products-gross-profit-high-body' : 'products-gross-profit-low-body',
            pageKey === 'high' ? grossProfitHighRows : grossProfitLowRows,
            pageKey
          );
        });
      });
    }
  }

  function fetchGrossProfit() {
    var highCard = document.getElementById('stats-products-gross-profit-high');
    var lowCard = document.getElementById('stats-products-gross-profit-low');
    var rangeKey = getRange();
    var allowed = ['today', 'yesterday', '7d', '14d', '30d'];
    var range = allowed.indexOf(rangeKey) !== -1 ? rangeKey : '30d';
    var url = API + '/api/performance/gross-profit?range=' + encodeURIComponent(range);
    var shop = getShop();
    if (shop) url += '&shop=' + encodeURIComponent(shop);
    fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (r.status === 403) throw { status: 403 };
        if (!r.ok) throw new Error('Request failed');
        return r.json();
      })
      .then(function (data) {
        if (highCard) highCard.classList.remove('is-hidden');
        if (lowCard) lowCard.classList.remove('is-hidden');
        grossProfitHighRows = (data && data.high && Array.isArray(data.high)) ? data.high : [];
        grossProfitLowRows = (data && data.low && Array.isArray(data.low)) ? data.low : [];
        grossProfitHighPage = 1;
        grossProfitLowPage = 1;
        renderGrossProfitTable('products-gross-profit-high-table', 'products-gross-profit-high-body', grossProfitHighRows, 'high');
        renderGrossProfitTable('products-gross-profit-low-table', 'products-gross-profit-low-body', grossProfitLowRows, 'low');
      })
      .catch(function (err) {
        if (err && err.status === 403) {
          if (highCard) highCard.classList.add('is-hidden');
          if (lowCard) lowCard.classList.add('is-hidden');
          return;
        }
        var msg = 'Failed to load gross profit data';
        var highBody = document.getElementById('products-gross-profit-high-body');
        var lowBody = document.getElementById('products-gross-profit-low-body');
        if (highBody) highBody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(msg) + '</div></div>';
        if (lowBody) lowBody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(msg) + '</div></div>';
      });
  }

  // Run on load and when range might change (header range change is handled by existing app refresh)
  function init() {
    fetchProductsTrending();
    fetchGrossProfit();
  }

  function rerenderDynamicTables() {
    try {
      var items = productsTrendingMode === 'up'
        ? (productsTrendingCache && productsTrendingCache.trendingUp) || []
        : (productsTrendingCache && productsTrendingCache.trendingDown) || [];
      if (productsTrendingCache) renderProductsTrendingTable(items);
    } catch (_) {}
    try {
      renderGrossProfitTable('products-gross-profit-high-table', 'products-gross-profit-high-body', grossProfitHighRows, 'high');
      renderGrossProfitTable('products-gross-profit-low-table', 'products-gross-profit-low-body', grossProfitLowRows, 'low');
    } catch (_) {}
  }

  init();
  try {
    window.addEventListener('kexo:tablesUiConfigApplied', function () {
      rerenderDynamicTables();
    });
    window.addEventListener('kexo:table-rows-changed', function (e) {
      var d = e && e.detail ? e.detail : null;
      var tid = d && d.tableId ? String(d.tableId) : '';
      if (tid === 'products-trending-table' || tid === 'products-gross-profit-high-table' || tid === 'products-gross-profit-low-table') {
        rerenderDynamicTables();
      }
    });
  } catch (_) {}
  try {
    if (typeof window.kexoRegisterCleanup === 'function') {
      window.kexoRegisterCleanup(function () {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        if (searchAbort) searchAbort.abort();
      });
    }
  } catch (_) {}
})();
