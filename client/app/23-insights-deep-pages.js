(function initInsightsDeepPages() {
  'use strict';
  var body = document.body;
  if (!body) return;
  var page = (body.getAttribute && body.getAttribute('data-page')) || '';
  if (page !== 'product-insights' && page !== 'page-insights') return;

  var API = (typeof window !== 'undefined' && window.API != null) ? String(window.API) : '';
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
      if (typeof getStatsRange === 'function') return getStatsRange() || 'today';
    } catch (_) {}
    return 'today';
  }
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '\u2014';
    try { return x.toLocaleString('en-GB'); } catch (_) { return String(Math.round(x)); }
  }
  function fmtMoneyGbp(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '\u2014';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(x); } catch (_) { return '\u00A3' + Number(x).toFixed(2); }
  }
  function fmtPct(n) {
    var x = (typeof n === 'number') ? n : Number(n);
    if (!Number.isFinite(x)) return '\u2014';
    return Number(x).toFixed(1) + '%';
  }
  function countryLabel(code) {
    if (!code) return 'Unknown';
    var c = String(code || 'XX').toUpperCase().slice(0, 2);
    if (c === 'UK') c = 'GB';
    try {
      if (typeof window.countryNames === 'object' && window.countryNames[c]) return window.countryNames[c];
    } catch (_) {}
    return c;
  }
  function flagImg(code, label) {
    var raw = String(code || '').trim().toLowerCase();
    if (raw === 'uk') raw = 'gb';
    var safeLabel = label != null ? escapeHtml(String(label)) : (code ? escapeHtml(String(code)) : '?');
    if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
      return '<span class="kexo-flag-fallback" aria-hidden="true"><i class="fa-light fa-globe"></i></span>';
    }
    return '<span class="kexo-flag-wrap" aria-hidden="true"><span class="flag flag-country-' + raw + '"' + (safeLabel ? ' title="' + safeLabel + '"' : '') + '></span></span>';
  }

  function parseIdFromPath(pathname) {
    if (!pathname) return null;
    var p = String(pathname);
    if (page === 'product-insights') {
      var m = p.match(/\/insights\/products\/(\d+)\/?$/i);
      return m && m[1] ? m[1] : null;
    }
    if (page === 'page-insights') {
      var m2 = p.match(/\/insights\/pages\/(\d+)\/?$/i);
      return m2 && m2[1] ? m2[1] : null;
    }
    return null;
  }

  var rootId = page === 'product-insights' ? 'product-insights-page-root' : 'page-insights-page-root';
  var statusId = page === 'product-insights' ? 'product-insights-page-status' : 'page-insights-page-status';
  var titleId = page === 'product-insights' ? 'product-insights-page-title' : 'page-insights-page-title';
  var rangeLabelId = page === 'product-insights' ? 'product-insights-range-label' : 'page-insights-range-label';
  var rangeMenuId = page === 'product-insights' ? 'product-insights-range-menu' : 'page-insights-range-menu';

  var currentRange = getRange();
  var charts = { revenue: null, activity: null };

  function setStatus(msg) {
    var statusEl = document.getElementById(statusId);
    var rootEl = document.getElementById(rootId);
    if (statusEl) statusEl.textContent = msg || '';
    if (rootEl && rootEl.querySelector('.kexo-deeppage-body')) {
      rootEl.querySelector('.kexo-deeppage-body').style.display = msg ? 'none' : '';
      statusEl.style.display = msg ? 'block' : 'none';
    } else if (statusEl) statusEl.style.display = msg ? 'block' : 'none';
  }

  function destroyCharts() {
    try { if (charts.revenue) charts.revenue.destroy(); } catch (_) {}
    try { if (charts.activity) charts.activity.destroy(); } catch (_) {}
    charts.revenue = null;
    charts.activity = null;
  }

  function syncRangeLabel() {
    var labelEl = document.getElementById(rangeLabelId);
    if (!labelEl) return;
    var rk = (currentRange || 'today').toLowerCase();
    try {
      if (typeof getRangeDisplayLabel === 'function') { labelEl.textContent = getRangeDisplayLabel(rk); return; }
    } catch (_) {}
    var labels = { today: 'Today', yesterday: 'Yesterday', '3d': 'Last 3 days', '7d': 'Last 7 days', '14d': 'Last 14 days', '30d': 'Last 30 days' };
    labelEl.textContent = labels[rk] || rk;
  }

  function bindRangeMenu() {
    var menu = document.getElementById(rangeMenuId);
    if (!menu) return;
    menu.querySelectorAll('.dropdown-item[data-range]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var r = btn.getAttribute('data-range') || 'today';
        currentRange = r;
        syncRangeLabel();
        load();
      });
    });
  }

  function urlWithWidth(rawUrl, width) {
    var raw = rawUrl != null ? String(rawUrl).trim() : '';
    if (!raw) return '';
    var w = Math.max(32, Math.floor(Number(width) || 1000));
    try {
      var u = new URL(raw, window.location.origin);
      u.searchParams.set('width', String(w));
      if (u.searchParams.has('height')) u.searchParams.delete('height');
      return u.toString();
    } catch (_) {
      return raw;
    }
  }

  function renderCharts(payload, containerPrefix) {
    if (!payload || !payload.series || !payload.series.points || typeof ApexCharts === 'undefined') return;
    destroyCharts();
    var points = payload.series.points || [];
    var isHourly = !!(payload.series && payload.series.isHourly);
    function labelForTs(ts) {
      try {
        var d = new Date(Number(ts));
        return isHourly ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      } catch (_) { return ''; }
    }
    var labels = points.map(function(p) { return labelForTs(p.ts); });
    var rev = points.map(function(p) { return (p && p.revenueGbp) ? Number(p.revenueGbp) : 0; });
    var ord = points.map(function(p) { return (p && p.orders) ? Number(p.orders) : 0; });
    var clicks = points.map(function(p) { return (p && p.clicks) ? Number(p.clicks) : 0; });
    var views = points.map(function(p) { return (p && p.views) ? Number(p.views) : 0; });
    var atc = points.map(function(p) { return (p && p.addToCart) ? Number(p.addToCart) : 0; });

    var revEl = document.getElementById(containerPrefix + 'chart-revenue');
    var actEl = document.getElementById(containerPrefix + 'chart-activity');
    if (revEl && rev.length) {
      charts.revenue = new ApexCharts(revEl, {
        chart: { type: 'area', height: 240, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
        series: [{ name: 'Revenue', data: rev }, { name: 'Conversions', data: ord }],
        colors: ['#0d9488', '#3b82f6'],
        stroke: { show: true, width: 2, curve: 'smooth', lineCap: 'round' },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.16, opacityTo: 0.04, stops: [0, 100] } },
        dataLabels: { enabled: false },
        xaxis: { categories: labels, labels: { style: { fontSize: '10px' } } },
        yaxis: [
          { labels: { style: { fontSize: '11px' }, formatter: function(v) { return fmtMoneyGbp(v).replace('.00', ''); } } },
          { opposite: true, labels: { style: { fontSize: '11px' }, formatter: function(v) { return fmtNum(v); } } },
        ],
        tooltip: { y: { formatter: function(v, o) { return o && o.seriesIndex === 0 ? fmtMoneyGbp(v) : fmtNum(v); } } },
        grid: { borderColor: '#f1f1f1', strokeDashArray: 3 },
        legend: { position: 'top', fontSize: '11px' },
      });
      charts.revenue.render();
    }
    if (actEl && clicks.length) {
      if (!charts.activity) {
        charts.activity = new ApexCharts(actEl, {
          chart: { type: 'line', height: 240, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
          series: [
            { name: 'Clicks', data: clicks },
            { name: 'Views (pixel)', data: views },
            { name: 'Add to cart', data: atc },
          ],
          colors: ['#6366f1', '#f59e0b', '#ef4444'],
          stroke: { show: true, width: 2, curve: 'smooth', lineCap: 'round' },
          markers: { size: 2, hover: { size: 5 } },
          dataLabels: { enabled: false },
          xaxis: { categories: labels, labels: { style: { fontSize: '10px' } } },
          yaxis: { labels: { style: { fontSize: '11px' }, formatter: function(v) { return fmtNum(v); } }, min: 0 },
          tooltip: { y: { formatter: function(v) { return fmtNum(v); } } },
          grid: { borderColor: '#f1f1f1', strokeDashArray: 3 },
          legend: { position: 'top', fontSize: '11px' },
        });
        charts.activity.render();
      }
    }
  }

  function renderProductPage(payload) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var prod = payload && payload.product ? payload.product : null;
    var metrics = payload && payload.metrics ? payload.metrics : {};
    var details = payload && payload.details ? payload.details : {};
    var title = (prod && prod.title) ? String(prod.title) : 'Product';
    var titleEl = document.getElementById(titleId);
    if (titleEl) titleEl.textContent = title;

    var images = (prod && Array.isArray(prod.images)) ? prod.images : [];
    var first = images[0];
    var mainImgUrl = (first && first.url) ? String(first.url) : '';
    var handle = (payload && payload.handle) ? String(payload.handle).trim() : (prod && prod.handle) ? String(prod.handle).trim() : '';
    var openStoreUrl = (payload && payload.links && payload.links.storeProductUrl) ? String(payload.links.storeProductUrl) : (handle ? '/products/' + encodeURIComponent(handle) : '#');
    var adminUrl = (payload && payload.links && payload.links.adminProductUrl) ? String(payload.links.adminProductUrl) : '';

    var revenue = metrics.revenueGbp != null ? fmtMoneyGbp(metrics.revenueGbp) : '\u2014';
    var units = metrics.units != null ? fmtNum(metrics.units) : '\u2014';
    var views = metrics.views != null ? fmtNum(metrics.views) : '\u2014';
    var atc = metrics.addToCart != null ? fmtNum(metrics.addToCart) : '\u2014';
    var cs = metrics.checkoutStarted != null ? fmtNum(metrics.checkoutStarted) : '\u2014';
    var atcRate = metrics.atcRate != null ? fmtPct(metrics.atcRate) : '\u2014';
    var clicks = metrics.clicks != null ? fmtNum(metrics.clicks) : '\u2014';
    var conv = metrics.orders != null ? fmtNum(metrics.orders) : '\u2014';
    var cr = metrics.cr != null ? fmtPct(metrics.cr) : '\u2014';
    var rpc = metrics.revPerClick != null ? fmtMoneyGbp(metrics.revPerClick) : '\u2014';
    var rpv = metrics.revPerView != null ? fmtMoneyGbp(metrics.revPerView) : '\u2014';
    var stockUnits = details.inventoryUnits != null ? fmtNum(details.inventoryUnits) : '\u2014';
    var stockVariants = details.inStockVariants != null ? fmtNum(details.inStockVariants) : '\u2014';
    var totalSales = details.totalSalesLifetime != null ? fmtNum(details.totalSalesLifetime) : '\u2014';
    var totalRev = details.totalRevenueLifetimeGbp != null ? fmtMoneyGbp(details.totalRevenueLifetimeGbp) : '\u2014';
    var cogs = details.costOfGoodsLifetimeGbp != null ? fmtMoneyGbp(details.costOfGoodsLifetimeGbp) : '\u2014';

    function row(l, v) { return '<tr><td>' + escapeHtml(l) + '</td><td class="w-1 fw-bold text-center">' + escapeHtml(v) + '</td></tr>'; }
    function sec(t) { return '<tr class="kexo-product-metrics-section"><td colspan="2">' + escapeHtml(t) + '</td></tr>'; }
    var metricsRows =
      sec('Key metrics') + row('Revenue (selected range)', revenue) + row('Conversions', conv) + row('Conversion rate', cr) + row('Units sold (selected range)', units) +
      sec('Engagement') + row('Clicks', clicks) + row('Views (pixel)', views) + row('Add to cart', atc) + row('Checkout started', cs) + row('View to Cart rate', atcRate) + row('Revenue / Click', rpc) + row('Revenue / View', rpv) +
      sec('Stock & lifetime') + row('In stock (units)', stockUnits) + row('In-stock variants', stockVariants) + row('Total sales (lifetime)', totalSales) + row('Total revenue (lifetime)', totalRev) + row('Cost of goods (lifetime)', cogs);

    var thumbsHtml = images.slice(0, 20).map(function(img, i) {
      var u = img && img.url ? String(img.url) : '';
      var t = img && img.thumb ? String(img.thumb) : u;
      if (!u) return '';
      return '<button type="button" class="product-insights-thumb' + (i === 0 ? ' active' : '') + '" data-img="' + escapeHtml(u) + '" aria-label="Image ' + (i + 1) + '"><img src="' + escapeHtml(t || u) + '" alt="" loading="lazy"></button>';
    }).join('');

    var topCountries = (payload && Array.isArray(payload.topCountries)) ? payload.topCountries : [];
    var topCountriesHtml = topCountries.slice(0, 5).map(function(r) {
      var iso = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
      if (iso === 'UK') iso = 'GB';
      var name = countryLabel(iso);
      var convN = (r && r.orders != null) ? Number(r.orders) : 0;
      var rev = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
      var revText = (rev != null && Number.isFinite(rev)) ? fmtMoneyGbp(rev) : '\u2014';
      return '<div class="d-flex align-items-center justify-content-between">' +
        '<div class="d-flex align-items-center gap-2 min-w-0">' + flagImg(iso, name) + '<span class="text-truncate">' + escapeHtml(name) + '</span></div>' +
        '<div class="text-end"><div class="fw-semibold" style="font-size:.875rem">' + escapeHtml(fmtNum(convN)) + ' conversions</div><div class="text-muted small">' + escapeHtml(revText) + '</div></div></div>';
    }).join('');

    var bodyHtml =
      '<div class="kexo-deeppage-body row g-3" style="display:none">' +
        '<div class="col-12 col-lg-5">' +
          '<div class="card"><div class="card-body">' +
            '<div class="product-insights-main-img-wrap"><img id="product-insights-page-main-img" class="img-fluid" alt="" src="' + escapeHtml(mainImgUrl ? urlWithWidth(mainImgUrl, 900) : '') + '"></div>' +
            '<div class="product-insights-thumbs-bar mt-2"><div class="product-insights-thumbs-strip" id="product-insights-page-thumbs">' + thumbsHtml + '</div></div>' +
          '</div></div>' +
          '<div class="card mt-3"><div class="card-header"><h3 class="card-title">Revenue</h3></div><div class="card-body"><div id="product-insights-page-chart-revenue" style="min-height:240px"></div></div></div>' +
          '<div class="card mt-3"><div class="card-header"><h3 class="card-title">Demand signals</h3></div><div class="card-body"><div id="product-insights-page-chart-activity" style="min-height:240px"></div></div></div>' +
        '</div>' +
        '<div class="col-12 col-lg-7">' +
          '<div class="card"><div class="card-header"><h3 class="card-title">Product details</h3></div>' +
            '<div class="table-responsive"><table class="table table-vcenter card-table table-sm kexo-product-insights-metrics"><thead><tr><th>Metric</th><th class="text-center">Value</th></tr></thead><tbody id="product-insights-page-metrics-table">' + metricsRows + '</tbody></table></div>' +
          '</div>' +
          (topCountries.length ? '<div class="card mt-3"><div class="card-header"><h3 class="card-title">Top countries</h3></div><div class="card-body"><div class="d-grid gap-2" id="product-insights-page-top-countries">' + topCountriesHtml + '</div></div>' : '') +
          '<div class="card mt-3"><div class="card-footer d-flex gap-2 flex-wrap">' +
            (adminUrl ? '<a class="btn btn-primary" href="' + escapeHtml(adminUrl) + '" target="_blank" rel="noopener">Edit on Shopify</a>' : '') +
            '<a class="btn btn-md" href="' + escapeHtml(openStoreUrl) + '" target="_blank" rel="noopener">View on Website</a>' +
          '</div></div>' +
        '</div>' +
      '</div>';
    root.innerHTML = '<div class="kexo-deeppage-body-wrap">' + bodyHtml + '</div>';
    setStatus('');

    if (handle && openStoreUrl.indexOf('/products/') === 0) {
      fetch(API + '/api/store-base-url', { credentials: 'same-origin', cache: 'default' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
          var base = (d && d.mainBaseUrl) ? String(d.mainBaseUrl).trim() : '';
          if (base) {
            var link = root.querySelector('a[href^="/products/"]');
            if (link) link.href = base.replace(/\/+$/, '') + openStoreUrl;
          }
        })
        .catch(function() {});
    }
    var mainImg = document.getElementById('product-insights-page-main-img');
    if (mainImg && mainImgUrl) mainImg.src = urlWithWidth(mainImgUrl, 900);
    var thumbsEl = document.getElementById('product-insights-page-thumbs');
    if (thumbsEl) {
      thumbsEl.querySelectorAll('[data-img]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var u = btn.getAttribute('data-img') || '';
          if (mainImg && u) { mainImg.src = urlWithWidth(u, 900); thumbsEl.querySelectorAll('.product-insights-thumb').forEach(function(x) { x.classList.remove('active'); }); btn.classList.add('active'); }
        });
      });
    }
    renderCharts(payload, 'product-insights-page-');
  }

  function renderPageInsights(payload) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var pageData = payload && payload.page ? payload.page : null;
    var metrics = payload && payload.metrics ? payload.metrics : {};
    var title = (pageData && pageData.path) ? pageData.path : 'Page';
    var titleEl = document.getElementById(titleId);
    if (titleEl) titleEl.textContent = title;

    var sessions = metrics.sessions != null ? fmtNum(metrics.sessions) : '\u2014';
    var pageViews = metrics.pageViews != null ? fmtNum(metrics.pageViews) : '\u2014';
    var purchasedSessions = metrics.purchasedSessions != null ? fmtNum(metrics.purchasedSessions) : '\u2014';
    var checkoutStartedSessions = metrics.checkoutStartedSessions != null ? fmtNum(metrics.checkoutStartedSessions) : '\u2014';
    var revenue2 = metrics.revenueGbp != null ? fmtMoneyGbp(metrics.revenueGbp) : '\u2014';
    var cr2 = metrics.cr != null ? fmtPct(metrics.cr) : '\u2014';
    var rps = metrics.revPerSession != null ? fmtMoneyGbp(metrics.revPerSession) : '\u2014';

    function row(l, v) { return '<tr><td>' + escapeHtml(l) + '</td><td class="w-1 fw-bold text-center">' + escapeHtml(v) + '</td></tr>'; }
    var metricsRows = row('Revenue', revenue2) + row('Purchased sessions', purchasedSessions) + row('Checkout started sessions', checkoutStartedSessions) + row('Sessions', sessions) + row('Page views', pageViews) + row('Purchase rate', cr2) + row('Revenue / Session', rps);

    var bodyHtml =
      '<div class="kexo-deeppage-body row g-3" style="display:none">' +
        '<div class="col-12 col-lg-7">' +
          '<div class="card"><div class="card-header"><h3 class="card-title">Page details</h3></div>' +
            '<div class="table-responsive"><table class="table table-vcenter card-table table-sm kexo-product-insights-metrics"><thead><tr><th>Metric</th><th class="text-center">Value</th></tr></thead><tbody id="page-insights-page-metrics-table">' + metricsRows + '</tbody></table></div>' +
          '</div>' +
        '</div>' +
        '<div class="col-12 col-lg-5">' +
          '<div class="card"><div class="card-header"><h3 class="card-title">Revenue</h3></div><div class="card-body"><div id="page-insights-page-chart-revenue" style="min-height:240px"></div></div></div>' +
        '</div>' +
      '</div>';
    root.innerHTML = '<div class="kexo-deeppage-body-wrap">' + bodyHtml + '</div>';
    setStatus('');
    renderCharts(payload, 'page-insights-page-');
  }

  function load() {
    var id = parseIdFromPath(window.location.pathname);
    if (!id) { setStatus('Invalid URL'); return; }
    setStatus('Loading…');

    if (page === 'product-insights') {
      var shop = getShop();
      var range = currentRange || getRange();
      var url = API + '/api/product-insights?product_id=' + encodeURIComponent(id) + '&range=' + encodeURIComponent(range) + (shop ? '&shop=' + encodeURIComponent(shop) : '');
      fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (!data || !data.ok) { setStatus('No data available for this product.'); return; }
          renderProductPage(data);
        })
        .catch(function() { setStatus('Could not load product insights.'); });
      return;
    }

    if (page === 'page-insights') {
      var shop2 = getShop();
      var metaUrl = API + '/api/page-meta?page_id=' + encodeURIComponent(id) + (shop2 ? '&shop=' + encodeURIComponent(shop2) : '');
      fetch(metaUrl, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(meta) {
          if (!meta || !meta.ok || !meta.path) { setStatus('Page not found.'); return; }
          var range2 = currentRange || getRange();
          var insightsUrl = API + '/api/page-insights?path=' + encodeURIComponent(meta.path) + '&kind=entry&range=' + encodeURIComponent(range2);
          return fetch(insightsUrl, { credentials: 'same-origin', cache: 'no-store' }).then(function(r) { return r.json(); });
        })
        .then(function(data) {
          if (!data || !data.ok) { setStatus('No data available for this page.'); return; }
          renderPageInsights(data);
        })
        .catch(function() { setStatus('Could not load page insights.'); });
    }
  }

  syncRangeLabel();
  bindRangeMenu();
  load();
  window.addEventListener('pagehide', function() { destroyCharts(); });
})();
