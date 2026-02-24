/**
 * Global search: header button opens a modal; search products, pages, and settings routes.
 * Uses /api/tools/catalog-search for products/pages; local list for settings.
 */
(function () {
  'use strict';
  var API = (typeof window !== 'undefined' && window.API != null) ? String(window.API) : '';
  var MODAL_ID = 'kexo-global-search-modal';
  var DEBOUNCE_MS = 220;
  var MIN_QUERY_LEN = 1;
  var inputDebounceTimer = null;
  var fallbackBackdropEl = null;

  function getShop() {
    try {
      if (typeof getShopParam === 'function') return getShopParam() || '';
      var q = window.location && window.location.search ? window.location.search : '';
      var p = q ? new URLSearchParams(q) : null;
      return (p && p.get('shop')) ? String(p.get('shop')).trim() : '';
    } catch (_) { return ''; }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Settings and high-traffic routes searchable by label
  var SETTINGS_ROUTES = [
    { label: 'Admin', href: '/settings/admin/users' },
    { label: 'Attribution Map', href: '/settings/attribution/mapping' },
    { label: 'Costs & Expenses', href: '/settings/cost-expenses/cost-sources' },
    { label: 'Variant Management', href: '/settings/insights/variants' },
    { label: 'View All Settings', href: '/settings/kexo/general' },
    { label: 'Products', href: '/insights/products' },
    { label: 'Snapshot', href: '/insights/snapshot' },
    { label: 'Countries', href: '/insights/countries' },
    { label: 'Variants', href: '/insights/variants' },
    { label: 'Payment Methods', href: '/insights/payment-methods' },
    { label: 'Abandoned Carts', href: '/insights/abandoned-carts' },
    { label: 'Dashboard Overview', href: '/dashboard/overview' },
    { label: 'Live View', href: '/dashboard/live' },
    { label: 'Recent Sales', href: '/dashboard/sales' },
    { label: 'Table View', href: '/dashboard/table' },
    { label: 'Attribution', href: '/acquisition/attribution' },
    { label: 'Browsers', href: '/acquisition/browsers' },
    { label: 'Devices', href: '/acquisition/devices' },
  ];

  function filterSettings(query) {
    var q = (query || '').toLowerCase().trim();
    if (!q) return [];
    return SETTINGS_ROUTES.filter(function (r) {
      return (r.label || '').toLowerCase().indexOf(q) !== -1;
    }).slice(0, 5);
  }

  var debounceTimer = null;
  var lastAbort = null;

  function isBootstrapModalAvailable() {
    try { return !!(window.bootstrap && window.bootstrap.Modal); } catch (_) { return false; }
  }

  function removeFallbackBackdrop() {
    if (!fallbackBackdropEl) return;
    try {
      if (fallbackBackdropEl.parentNode) fallbackBackdropEl.parentNode.removeChild(fallbackBackdropEl);
    } catch (_) {}
    fallbackBackdropEl = null;
  }

  function closeModal(modal) {
    if (!modal) modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    try { if (lastAbort) lastAbort.abort(); } catch (_) {}
    try { lastAbort = null; } catch (_) {}
    try { if (debounceTimer) clearTimeout(debounceTimer); } catch (_) {}
    try { debounceTimer = null; } catch (_) {}
    try { if (inputDebounceTimer) clearTimeout(inputDebounceTimer); } catch (_) {}
    try { inputDebounceTimer = null; } catch (_) {}

    if (isBootstrapModalAvailable()) {
      try {
        window.bootstrap.Modal.getOrCreateInstance(modal).hide();
        return;
      } catch (_) {}
    }

    // Fallback (no Bootstrap JS): manual hide + dark backdrop.
    try { modal.style.display = 'none'; } catch (_) {}
    try { modal.classList.remove('show'); } catch (_) {}
    try { modal.setAttribute('aria-hidden', 'true'); } catch (_) {}
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    removeFallbackBackdrop();
  }

  function ensureFallbackBackdrop(modal) {
    if (fallbackBackdropEl && fallbackBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    el.addEventListener('click', function () { closeModal(modal); });
    document.body.appendChild(el);
    fallbackBackdropEl = el;
  }

  function ensureModal() {
    var existing = document.getElementById(MODAL_ID);
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="modal fade" id="' + MODAL_ID + '" tabindex="-1" role="dialog" aria-labelledby="' + MODAL_ID + '-title" aria-hidden="true">' +
      '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable" role="document">' +
      '<div class="modal-content">' +
      '<div class="modal-header">' +
      '<h5 class="modal-title" id="' + MODAL_ID + '-title">Search</h5>' +
      '<button type="button" class="btn-close" aria-label="Close"></button>' +
      '</div>' +
      '<div class="modal-body">' +
      '<input type="text" class="form-control mb-3" id="' + MODAL_ID + '-input" placeholder="Products, pages, settings…" autocomplete="off" aria-label="Search query">' +
      '<div id="' + MODAL_ID + '-results" class="kexo-global-search-results"></div>' +
      '<div id="' + MODAL_ID + '-empty" class="text-muted small" aria-live="polite" style="display:none;"></div>' +
      '</div>' +
      '</div></div></div>';
    var first = wrap.firstElementChild;
    if (first) document.body.appendChild(first);
    var modal = document.getElementById(MODAL_ID);
    if (modal && modal.getAttribute('data-kexo-global-search-bound') !== '1') {
      modal.setAttribute('data-kexo-global-search-bound', '1');
      var closeBtn = modal.querySelector('.btn-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          closeModal(modal);
        });
      }
      // Fallback: clicking the shaded area closes.
      modal.addEventListener('click', function (e) {
        if (e && e.target === modal && !isBootstrapModalAvailable()) closeModal(modal);
      });
      // Fallback: escape closes.
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!modal.classList.contains('show')) return;
        if (!isBootstrapModalAvailable()) closeModal(modal);
      });
    }
    return modal;
  }

  function navigateTo(url, newTab) {
    if (newTab) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    window.location.assign(url);
  }

  function renderResults(data, settingsHits, query) {
    var container = document.getElementById(MODAL_ID + '-results');
    var emptyEl = document.getElementById(MODAL_ID + '-empty');
    if (!container) return;
    var products = (data && data.products && Array.isArray(data.products)) ? data.products : [];
    var pages = (data && data.pages && Array.isArray(data.pages)) ? data.pages : [];
    var hasAny = products.length > 0 || pages.length > 0 || (settingsHits && settingsHits.length > 0);
    var q = (query || '').trim();
    var queryActive = q.length >= MIN_QUERY_LEN;
    if (emptyEl) {
      if (hasAny) {
        emptyEl.style.display = 'none';
        emptyEl.textContent = '';
      } else {
        emptyEl.style.display = 'block';
        var err = (data && data.ok === false && data.error) ? String(data.error) : '';
        if (queryActive && err === 'missing_shop_or_token') emptyEl.textContent = 'Select a shop to search products/pages.';
        else if (queryActive && err) emptyEl.textContent = 'Search failed.';
        else emptyEl.textContent = queryActive ? ('No results for “' + q + '”.') : 'Type to search products, pages, or settings.';
      }
    }
    var html = '';
    if (products.length > 0) {
      html += '<div class="mb-2"><span class="text-muted small text-uppercase fw-semibold">Products</span></div><ul class="list-unstyled mb-3">';
      products.forEach(function (p) {
        var id = (p && p.product_id) ? String(p.product_id) : '';
        var title = escapeHtml((p && p.title) ? p.title : 'Untitled');
        if (!id) return;
        var url = '/insights/products/' + id;
        var qs = window.location.search || '';
        html += '<li><a href="' + escapeHtml(url + qs) + '" class="dropdown-item kexo-global-search-item" data-type="product" data-url="' + escapeHtml(url + qs) + '">' + title + '</a></li>';
      });
      html += '</ul>';
    }
    if (pages.length > 0) {
      html += '<div class="mb-2"><span class="text-muted small text-uppercase fw-semibold">Pages</span></div><ul class="list-unstyled mb-3">';
      pages.forEach(function (p) {
        var id = (p && p.page_id) ? String(p.page_id) : '';
        var title = escapeHtml((p && p.title) ? p.title : 'Untitled');
        if (!id) return;
        var url = '/insights/pages/' + id;
        var qs = window.location.search || '';
        html += '<li><a href="' + escapeHtml(url + qs) + '" class="dropdown-item kexo-global-search-item" data-type="page" data-url="' + escapeHtml(url + qs) + '">' + title + '</a></li>';
      });
      html += '</ul>';
    }
    if (settingsHits && settingsHits.length > 0) {
      html += '<div class="mb-2"><span class="text-muted small text-uppercase fw-semibold">Settings &amp; pages</span></div><ul class="list-unstyled">';
      settingsHits.forEach(function (r) {
        var href = (r.href || '').trim();
        var label = escapeHtml(r.label || '');
        if (!href) return;
        var url = href + (href.indexOf('?') !== -1 ? '' : (window.location.search || ''));
        html += '<li><a href="' + escapeHtml(url) + '" class="dropdown-item kexo-global-search-item" data-type="settings" data-url="' + escapeHtml(url) + '">' + label + '</a></li>';
      });
      html += '</ul>';
    }
    container.innerHTML = html || '';

    container.querySelectorAll('.kexo-global-search-item').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var url = a.getAttribute('data-url');
        if (!url) return;
        if (e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          navigateTo(url, true);
          return;
        }
        e.preventDefault();
        navigateTo(url, false);
      });
    });
  }

  function runSearch(query) {
    var q = (query || '').trim();
    var settingsHits = filterSettings(q);
    if (q.length < MIN_QUERY_LEN) {
      renderResults(null, settingsHits, q);
      return;
    }
    var container = document.getElementById(MODAL_ID + '-results');
    var emptyEl = document.getElementById(MODAL_ID + '-empty');
    if (container) container.innerHTML = '';
    if (emptyEl) {
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Searching…';
    }
    var shop = getShop();
    var url = API + '/api/tools/catalog-search?q=' + encodeURIComponent(q) + '&limit=10';
    if (shop) url += '&shop=' + encodeURIComponent(shop);
    if (lastAbort) lastAbort.abort();
    var controller = new AbortController();
    lastAbort = controller;
    fetch(url, { credentials: 'same-origin', signal: controller.signal })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (controller.signal && controller.signal.aborted) return;
        lastAbort = null;
        renderResults(data, settingsHits, q);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        lastAbort = null;
        var emptyEl2 = document.getElementById(MODAL_ID + '-empty');
        if (emptyEl2) {
          emptyEl2.style.display = 'block';
          emptyEl2.textContent = 'Search failed.';
        }
        renderResults({ ok: false, error: 'search_failed', products: [], pages: [] }, settingsHits, q);
      });
  }

  function openSearchModal() {
    var modal = ensureModal();
    var input = document.getElementById(MODAL_ID + '-input');
    if (!input) return;
    input.value = '';
    renderResults(null, [], '');

    if (isBootstrapModalAvailable()) {
      try { window.bootstrap.Modal.getOrCreateInstance(modal, { backdrop: true, keyboard: true }).show(); } catch (_) {}
    } else {
      modal.style.display = 'block';
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
      ensureFallbackBackdrop(modal);
    }

    setTimeout(function () { try { input.focus(); } catch (_) {} }, 0);

    if (input.getAttribute('data-kexo-global-search-input-bound') !== '1') {
      input.setAttribute('data-kexo-global-search-input-bound', '1');
      input.addEventListener('input', function () {
        if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
        inputDebounceTimer = setTimeout(function () {
          inputDebounceTimer = null;
          runSearch(input.value);
        }, DEBOUNCE_MS);
      });
      input.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Enter') return;
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        runSearch(input.value);
      });
    }
  }

  function bindSearchTriggers() {
    var triggers = document.querySelectorAll('[data-kexo-global-search-open="1"], #kexo-global-search-btn-header');
    triggers.forEach(function (el) {
      if (el && el.getAttribute && el.getAttribute('data-kexo-global-search-bound') === '1') return;
      if (el) {
        el.setAttribute('data-kexo-global-search-bound', '1');
        el.addEventListener('click', function (e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          openSearchModal();
        });
      }
    });
  }
  bindSearchTriggers();
  document.addEventListener('DOMContentLoaded', bindSearchTriggers);
})();
