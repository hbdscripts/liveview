/**
 * Insights → Products page: embedded search, trending table, gross-profit tables.
 * Only runs when data-page="products".
 */
(function () {
  'use strict';
  var body = document.body;
  if (!body || (body.getAttribute && body.getAttribute('data-page')) !== 'products') return;

  var API = (typeof window !== 'undefined' && window.API != null) ? String(window.API) : '';
  var ROWS_PER_PAGE = 5;
  var SEARCH_DEBOUNCE_MS = 220;

  function getShop() {
    try {
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
          var qs = window.location.search || '';
          if (!products.length) {
            dropdown.innerHTML = '<div class="dropdown-item text-muted">No products found</div>';
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
    var mount = document.getElementById('products-trending-mount');
    var paginationEl = document.getElementById('products-trending-pagination');
    if (!mount) return;
    var rows = Array.isArray(items) ? items : [];
    var totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    productsTrendingPage = Math.max(1, Math.min(productsTrendingPage, totalPages));
    var pageStart = (productsTrendingPage - 1) * ROWS_PER_PAGE;
    var pageRows = rows.slice(pageStart, pageStart + ROWS_PER_PAGE);

    var thead = '<thead><tr><th>Product</th><th class="text-end">Revenue</th><th class="text-end">Orders</th><th class="text-end">CR</th><th class="text-end">VPV</th></tr></thead>';
    function deltaText(r) {
      var d = (r && typeof r.deltaRevenue === 'number' && isFinite(r.deltaRevenue)) ? r.deltaRevenue : 0;
      var cls = d >= 0 ? 'text-success' : 'text-danger';
      var pct = (r && typeof r.pctGrowth === 'number' && isFinite(r.pctGrowth)) ? r.pctGrowth : null;
      var pctStr = pct != null ? (pct >= 999 ? ' new' : ' (' + (pct >= 0 ? '+' : '') + pct + '%)') : '';
      return '<span class="' + cls + '">' + escapeHtml(fmtSignedGbp(d) + pctStr) + '</span>';
    }
    function deltaOrdersText(r) {
      var d = (r && typeof r.deltaOrders === 'number' && isFinite(r.deltaOrders)) ? r.deltaOrders : 0;
      var sign = d >= 0 ? '+' : '';
      var cls = d >= 0 ? 'text-success' : 'text-danger';
      return '<span class="' + cls + '">' + sign + String(d) + '</span>';
    }
    var tbodyHtml = !pageRows.length
      ? '<tbody><tr><td colspan="5" class="text-muted text-center">No data</td></tr></tbody>'
      : '<tbody>' + pageRows.map(function (p) {
          var title = (p && p.title) ? String(p.title) : 'Unknown';
          var productId = (p && p.product_id) ? String(p.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
          var numericId = (productId && /^\d+$/.test(productId)) ? productId : '';
          var qs = window.location.search || '';
          var linkHref = numericId ? ('/insights/products/' + numericId + qs) : '#';
          var titleHtml = numericId
            ? ('<a class="js-product-modal-link" href="' + escapeHtml(linkHref) + '" data-product-id="' + escapeHtml(numericId) + '" data-product-title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</a>')
            : escapeHtml(title);
          var revCell = deltaText(p);
          var ordCell = deltaOrdersText(p);
          var crCell = fmtPct(p && (typeof p.cr === 'number' ? p.cr : null));
          var vpvVal = (p && typeof p.vpv === 'number' && isFinite(p.vpv)) ? p.vpv : null;
          var vpvCell = vpvVal != null ? fmtGbp(vpvVal) : '—';
          return '<tr><td>' + titleHtml + '</td><td class="text-end">' + revCell + '</td><td class="text-end">' + ordCell + '</td><td class="text-end">' + crCell + '</td><td class="text-end">' + vpvCell + '</td></tr>';
        }).join('') + '</tbody>';
    mount.innerHTML = '<div class="table-responsive"><table class="table table-sm table-hover mb-0"><colgroup><col><col class="text-end"><col class="text-end"><col class="text-end"><col class="text-end"></colgroup>' + thead + tbodyHtml + '</table></div>';

    if (paginationEl) {
      paginationEl.classList.toggle('is-hidden', totalPages <= 1);
      if (totalPages > 1) {
        var pg = productsTrendingPage;
        var html = '<nav aria-label="Trending pagination"><ul class="pagination pagination-sm mb-0">';
        html += '<li class="page-item' + (pg <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (pg - 1) + '" aria-label="Previous">Prev</a></li>';
        html += '<li class="page-item disabled"><span class="page-link">' + pg + ' / ' + totalPages + '</span></li>';
        html += '<li class="page-item' + (pg >= totalPages ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (pg + 1) + '" aria-label="Next">Next</a></li>';
        html += '</ul></nav>';
        paginationEl.innerHTML = html;
        paginationEl.querySelectorAll('a[data-page]').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            var p = parseInt(a.getAttribute('data-page'), 10);
            if (Number.isFinite(p) && p >= 1 && p <= totalPages) {
              productsTrendingPage = p;
              renderProductsTrendingTable(productsTrendingCache);
            }
          });
        });
      }
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

  function renderGrossProfitTable(bodyId, rows, pageKey) {
    var tbody = document.getElementById(bodyId);
    var paginationEl = document.getElementById(bodyId.replace('-body', '-pagination'));
    if (!tbody) return;
    var page = (pageKey === 'high') ? grossProfitHighPage : grossProfitLowPage;
    var totalPages = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
    page = Math.max(1, Math.min(page, totalPages));
    if (pageKey === 'high') grossProfitHighPage = page; else grossProfitLowPage = page;
    var pageStart = (page - 1) * ROWS_PER_PAGE;
    var pageRows = rows.slice(pageStart, pageStart + ROWS_PER_PAGE);

    if (!pageRows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted text-center">No data</td></tr>';
    } else {
      tbody.innerHTML = pageRows.map(function (r) {
        var title = (r && r.title != null) ? String(r.title) : (r && r.product_id != null ? r.product_id : '—');
        var productId = (r && r.product_id) ? String(r.product_id) : '';
        var numericId = (productId && /^\d+$/.test(productId)) ? productId : '';
        var revenue = (r && r.revenue_gbp != null) ? Number(r.revenue_gbp) : 0;
        var cost = (r && r.cost_gbp != null) ? Number(r.cost_gbp) : 0;
        var profit = (r && r.gross_profit_gbp != null) ? Number(r.gross_profit_gbp) : (revenue - cost);
        var qs = window.location.search || '';
        var titleCell = numericId
          ? '<a class="js-product-modal-link" href="' + escapeHtml('/insights/products/' + numericId + qs) + '" data-product-id="' + escapeHtml(numericId) + '" data-product-title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</a>'
          : escapeHtml(title);
        return '<tr><td>' + titleCell + '</td><td class="text-end">' + escapeHtml(fmtGbp(revenue)) + '</td><td class="text-end">' + escapeHtml(fmtGbp(cost)) + '</td><td class="text-end">' + escapeHtml(fmtGbp(profit)) + '</td></tr>';
      }).join('');
    }

    if (paginationEl) {
      paginationEl.classList.toggle('is-hidden', totalPages <= 1);
      if (totalPages > 1) {
        var html = '<nav aria-label="Pagination"><ul class="pagination pagination-sm mb-0">';
        html += '<li class="page-item' + (page <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-gp-page="' + pageKey + '" data-page="' + (page - 1) + '">Prev</a></li>';
        html += '<li class="page-item disabled"><span class="page-link">' + page + ' / ' + totalPages + '</span></li>';
        html += '<li class="page-item' + (page >= totalPages ? ' disabled' : '') + '"><a class="page-link" href="#" data-gp-page="' + pageKey + '" data-page="' + (page + 1) + '">Next</a></li>';
        html += '</ul></nav>';
        paginationEl.innerHTML = html;
        paginationEl.querySelectorAll('a[data-gp-page]').forEach(function (a) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            var p = parseInt(a.getAttribute('data-page'), 10);
            var key = a.getAttribute('data-gp-page');
            if (key === 'high') grossProfitHighPage = p; else grossProfitLowPage = p;
            renderGrossProfitTable(key === 'high' ? 'products-gross-profit-high-body' : 'products-gross-profit-low-body', key === 'high' ? grossProfitHighRows : grossProfitLowRows, key);
          });
        });
      }
    }
  }

  function fetchGrossProfit() {
    var loading = document.getElementById('products-gross-profit-loading');
    var errorEl = document.getElementById('products-gross-profit-error');
    var section = document.getElementById('products-gross-profit-section');
    if (loading) loading.classList.remove('is-hidden');
    if (errorEl) { errorEl.classList.add('is-hidden'); errorEl.textContent = ''; }
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
        if (loading) loading.classList.add('is-hidden');
        if (section) section.classList.remove('is-hidden');
        grossProfitHighRows = (data && data.high && Array.isArray(data.high)) ? data.high : [];
        grossProfitLowRows = (data && data.low && Array.isArray(data.low)) ? data.low : [];
        grossProfitHighPage = 1;
        grossProfitLowPage = 1;
        renderGrossProfitTable('products-gross-profit-high-body', grossProfitHighRows, 'high');
        renderGrossProfitTable('products-gross-profit-low-body', grossProfitLowRows, 'low');
      })
      .catch(function (err) {
        if (loading) loading.classList.add('is-hidden');
        if (err && err.status === 403 && section) section.classList.add('is-hidden');
        else if (errorEl) {
          errorEl.textContent = err && err.status === 403 ? 'Not authorized' : 'Failed to load gross profit data';
          errorEl.classList.remove('is-hidden');
        }
      });
  }

  // Run on load and when range might change (header range change is handled by existing app refresh)
  function init() {
    fetchProductsTrending();
    fetchGrossProfit();
  }

  init();
  try {
    if (typeof window.kexoRegisterCleanup === 'function') {
      window.kexoRegisterCleanup(function () {
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        if (searchAbort) searchAbort.abort();
      });
    }
  } catch (_) {}
})();
