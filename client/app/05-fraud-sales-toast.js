      fraudUiBound = true;
      try {
        document.addEventListener('click', function(e) {
          var target = e && e.target ? e.target : null;
          var openEl = target && target.closest ? target.closest('[data-fraud-open]') : null;
          if (openEl) {
            try { e.preventDefault(); } catch (_) {}
            try { e.stopPropagation(); } catch (_) {}
            var et = openEl.getAttribute('data-fraud-entity-type') || 'session';
            var eid = openEl.getAttribute('data-fraud-entity-id') || '';
            openFraudDetailModal(et, eid);
            return;
          }
          var closeEl = target && target.closest ? target.closest('[data-fraud-close]') : null;
          if (closeEl) {
            try { e.preventDefault(); } catch (_) {}
            hideFraudModal();
            return;
          }
          var openSessionEl = target && target.closest ? target.closest('[data-fraud-open-session]') : null;
          if (openSessionEl) {
            var sid = openSessionEl.getAttribute('data-fraud-open-session') || '';
            if (sid) {
              try { e.preventDefault(); } catch (_) {}
              hideFraudModal();
              try { openSidePanel(sid); } catch (_) {}
            }
            return;
          }
          var copyEl = target && target.closest ? target.closest('[data-fraud-copy-evidence]') : null;
          if (copyEl) {
            try { e.preventDefault(); } catch (_) {}
            try {
              var pre = document.querySelector('#fraud-detail-modal [data-fraud-evidence-pre="1"]');
              var txt = pre ? (pre.textContent || '') : '';
              if (txt && navigator && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(txt).catch(function() {});
              }
            } catch (_) {}
          }
        }, true);
      } catch (_) {}
    })();

    function syncSessionsTableTightMode() {
      const wrap = document.querySelector('.table-scroll-wrap');
      const table = document.getElementById('sessions-table');
      if (!wrap || !table) return;
      // "Max mode": when all columns fit, remove extra inter-column padding.
      const fits = table.scrollWidth <= wrap.clientWidth + 1;
      wrap.classList.toggle('tight-cols', !!fits);
    }

    function updateSortHeaders() {
      document.querySelectorAll('.table-scroll-wrap .grid-cell.sortable').forEach(function (th) {
        var col = th.getAttribute('data-sort');
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (sortBy === col) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function shouldIgnoreStickyResizeSortClick(e) {
      var target = e && e.target && e.target.closest ? e.target : null;
      if (target && target.closest('.kexo-sticky-resize-handle')) return true;
      var wrap = target ? target.closest('.table-scroll-wrap, .country-table-wrap, .table-responsive') : null;
      var ts = wrap ? Number(wrap.getAttribute('data-sticky-resize-at') || '0') : 0;
      if (!Number.isFinite(ts) || ts <= 0) ts = Number(window.__kexoLastStickyResizeAt || 0);
      return Number.isFinite(ts) && ts > 0 && (Date.now() - ts) < 400;
    }

    function setupSortableHeaders() {
      document.querySelectorAll('.table-scroll-wrap .grid-cell.sortable').forEach(function (th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          if (sortBy === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortBy = col; sortDir = SORT_DEFAULTS[col] || 'asc'; }
          renderTable();
        }
        th.addEventListener('click', function (e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (shouldIgnoreStickyResizeSortClick(e)) return;
          activate();
        });
        th.addEventListener('keydown', function (e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
    }

    function tickTimeOnSite() {
      document.querySelectorAll('#table-body span[data-started]').forEach(span => {
        const started = parseInt(span.getAttribute('data-started'), 10);
        span.textContent = arrivedAgo(started);
      });
      document.querySelectorAll('#table-body span[data-last-seen]').forEach(span => {
        const lastSeen = parseInt(span.getAttribute('data-last-seen'), 10);
        span.textContent = arrivedAgo(lastSeen);
      });
    }

    function pct(v) { return v != null ? v.toFixed(1) + '%' : ''; }

    function formatRevenue0(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '';
      try {
        return '\u00A3' + Math.round(num).toLocaleString('en-GB');
      } catch (_) {
        return '\u00A3' + String(Math.round(num));
      }
    }

    function isEffectivelyZero(value, epsilon) {
      var n = (typeof value === 'number') ? value : Number(value);
      if (!Number.isFinite(n)) return false;
      var tol = (typeof epsilon === 'number' && Number.isFinite(epsilon) && epsilon >= 0) ? epsilon : 1e-9;
      return Math.abs(n) <= tol;
    }

    function normalizeZeroNumber(value, epsilon) {
      var n = (typeof value === 'number') ? value : Number(value);
      if (!Number.isFinite(n)) return null;
      return isEffectivelyZero(n, epsilon) ? 0 : n;
    }

    function formatSignedPercentOneDecimalFromRatio(rawRatio) {
      var ratio = normalizeZeroNumber(rawRatio, 0.0005); // <0.05% should render as 0%
      if (ratio == null) return '\u2014';
      var pct = Math.round(ratio * 1000) / 10;
      if (isEffectivelyZero(pct, 1e-9)) pct = 0;
      var sign = pct > 0 ? '+' : (pct < 0 ? '-' : '');
      return sign + Math.abs(pct).toFixed(1).replace(/\.0$/, '') + '%';
    }

    function formatNegativeCurrencyOrZero(value, useWholePounds) {
      var n = (typeof value === 'number' && Number.isFinite(value)) ? Math.abs(value) : null;
      if (n == null) return '\u2014';
      var epsilon = useWholePounds ? 0.5 : 0.005;
      if (n < epsilon) return useWholePounds ? '\u00A30' : '\u00A30.00';
      var s = useWholePounds ? formatRevenue0(n) : formatRevenue(n);
      if (!s) return '\u2014';
      return '-' + s;
    }

    function crPillHtml(v) {
      const n = v != null ? Number(v) : NaN;
      if (!Number.isFinite(n)) return '';
      return '<span class="aov-card-cr-pill" title="Conversion rate">CR ' + escapeHtml(pct(n)) + '</span>';
    }

    function formatRevenue(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '';
      // Keep dashboard currency formatting consistent everywhere (thousands separators + 2dp).
      try {
        return '\u00A3' + num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (_) {
        return '\u00A3' + num.toFixed(2);
      }
    }

    function formatRevenueSub(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '\u2014';
      return formatRevenue(num) || '\u2014';
    }

    function isIconMode() {
      try {
        return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
      } catch (_) {
        return false;
      }
    }

    function formatRevenueTableHtml(num) {
      if (num == null || typeof num !== 'number' || !Number.isFinite(num)) return '\u2014';
      if (isIconMode()) return '\u00A3' + Math.round(num).toLocaleString('en-GB');
      if (num % 1 === 0) return '\u00A3' + num.toLocaleString('en-GB');
      let fixed = null;
      try {
        fixed = num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      } catch (_) {
        fixed = num.toFixed(2);
      }
      const parts = String(fixed).split('.');
      return '\u00A3' + parts[0] + '<span class="rev-decimal">.' + (parts[1] || '00') + '</span>';
    }

    function animateTickerText(el, nextText) {
      if (!el) return;
      const prev = el.textContent != null ? String(el.textContent) : '';
      const next = nextText != null ? String(nextText) : '';
      if (prev === next) {
        el.textContent = next;
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'kpi-ticker';
      const stack = document.createElement('span');
      stack.className = 'kpi-ticker-stack';
      const a = document.createElement('span');
      a.className = 'kpi-ticker-line';
      a.textContent = prev;
      const b = document.createElement('span');
      b.className = 'kpi-ticker-line';
      b.textContent = next;
      stack.appendChild(a);
      stack.appendChild(b);
      wrap.appendChild(stack);
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(wrap);
      requestAnimationFrame(function() { wrap.classList.add('run'); });
      setTimeout(function() {
        // Finalize (but only if the wrapper is still present).
        if (el && el.contains(wrap)) el.textContent = next;
      }, 460);
    }

    function animateOdometerText(el, nextText) {
      if (!el) return;
      const next = nextText != null ? String(nextText) : '';
      const prevStored = el.getAttribute('data-odometer');
      const prev = prevStored != null ? String(prevStored) : (el.textContent != null ? String(el.textContent) : '');
      if (prev === next) {
        el.textContent = next;
        el.setAttribute('data-odometer', next);
        return;
      }
      const wrap = document.createElement('span');
      wrap.className = 'kpi-odometer';
      const stacks = [];
      for (let i = 0; i < next.length; i++) {
        const ch = next[i];
        if (ch >= '0' && ch <= '9') {
          const prevCh = prev[i] || '0';
          const prevDigit = (prevCh >= '0' && prevCh <= '9') ? parseInt(prevCh, 10) : 0;
          const digit = parseInt(ch, 10);
          const digitWrap = document.createElement('span');
          digitWrap.className = 'kpi-odometer-digit';
          const stack = document.createElement('span');
          stack.className = 'kpi-odometer-stack';
          for (let d = 0; d <= 9; d++) {
            const line = document.createElement('span');
            line.textContent = String(d);
            stack.appendChild(line);
          }
          stack.style.transform = 'translateY(' + (-prevDigit) + 'em)';
          digitWrap.appendChild(stack);
          wrap.appendChild(digitWrap);
          stacks.push({ stack, digit });
        } else {
          const span = document.createElement('span');
          span.className = 'kpi-odometer-char';
          span.textContent = ch;
          wrap.appendChild(span);
        }
      }
      while (el.firstChild) el.removeChild(el.firstChild);
      el.appendChild(wrap);
      el.setAttribute('data-odometer', next);
      requestAnimationFrame(function() {
        stacks.forEach(function(item) {
          item.stack.style.transform = 'translateY(' + (-item.digit) + 'em)';
        });
      });
      setTimeout(function() {
        if (!el || !el.contains(wrap)) return;
        el.textContent = next;
      }, 460);
    }

    function productUrlFromHandle(handle) {
      const h = handle != null ? String(handle).trim() : '';
      if (!h) return '';
      const base = getMainBaseUrl();
      if (!base) return '';
      return base + '/products/' + encodeURIComponent(h.replace(/^\/+/, ''));
    }

    function resolveSaleToastThumbSrc(data) {
      if (!data) return '';
      const rawThumb = data.productThumbUrl != null ? String(data.productThumbUrl).trim() : '';
      if (rawThumb) return hotImgSquare(rawThumb) || rawThumb;
      const directUrl = data.productUrl != null ? String(data.productUrl).trim() : '';
      const handleUrl = data.productHandle ? productUrlFromHandle(data.productHandle) : '';
      const finalUrl = directUrl || handleUrl;
      if (!finalUrl) return '';
      return (API || '') + '/api/og-thumb?url=' + encodeURIComponent(finalUrl) + '&width=100';
    }

    function setSaleToastContent(patch) {
      patch = patch && typeof patch === 'object' ? patch : {};
      const data = { ...(saleToastLastPayload || {}) };
      const hasOwn = Object.prototype.hasOwnProperty;
      if (hasOwn.call(patch, 'countryCode')) data.countryCode = patch.countryCode;
      if (hasOwn.call(patch, 'productTitle')) data.productTitle = patch.productTitle;
      if (hasOwn.call(patch, 'amountGbp')) data.amountGbp = patch.amountGbp;
      if (hasOwn.call(patch, 'productHandle')) data.productHandle = patch.productHandle;
      if (hasOwn.call(patch, 'productUrl')) data.productUrl = patch.productUrl;
      if (hasOwn.call(patch, 'productThumbUrl')) data.productThumbUrl = patch.productThumbUrl;
      if (hasOwn.call(patch, 'createdAt')) data.createdAt = patch.createdAt;

      const cc = (data.countryCode || 'XX').toString().trim().toUpperCase().slice(0, 2) || 'XX';
      const product = data.productTitle != null ? String(data.productTitle) : '';
      const amountRaw = data.amountGbp != null ? Number(data.amountGbp) : null;
      const amountGbp = (amountRaw != null && Number.isFinite(amountRaw)) ? amountRaw : null;

      saleToastLastPayload = {
        ...data,
        countryCode: cc,
        productTitle: product,
        amountGbp: amountGbp,
      };

      const inlineFlagEl = document.getElementById('sale-toast-inline-flag');
      const productEl = document.getElementById('sale-toast-product');
      const amountEl = document.getElementById('sale-toast-amount');
      if (inlineFlagEl) inlineFlagEl.innerHTML = flagImgSmall(cc);
      if (productEl) productEl.textContent = product && product.trim() ? product : '\u2014';
      if (amountEl) amountEl.textContent = (amountGbp != null) ? (formatRevenue(amountGbp) || '\u00A3\u2014') : '\u00A3\u2014';
      if (data.createdAt != null) {
        try { setLastSaleAt(data.createdAt); } catch (_) {}
      }
    }

    function updateSaleToastToggle() {
      var isPinned = !!saleToastPinned;
      ['last-sale-toggle', 'footer-last-sale-toggle'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle('is-on', isPinned);
        btn.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
        btn.setAttribute('aria-label', isPinned ? 'Hide last sale toast' : 'Show last sale toast');
        var eyeOn = btn.querySelector('.fa-eye');
        var eyeOff = btn.querySelector('.fa-eye-slash');
        if (eyeOn) eyeOn.style.display = isPinned ? 'none' : '';
        if (eyeOff) eyeOff.style.display = isPinned ? '' : 'none';
      });
    }

    function showSaleToast() {
      const banner = document.getElementById('sale-toast-banner');
      if (!banner) return;
      saleToastActive = true;
      saleToastLastShownAt = Date.now();
      banner.removeAttribute('hidden');
      banner.setAttribute('aria-hidden', 'false');
      requestAnimationFrame(function() { banner.classList.add('active'); });
    }

    function hideSaleToast() {
      const banner = document.getElementById('sale-toast-banner');
      if (saleToastHideTimer) {
        clearTimeout(saleToastHideTimer);
        saleToastHideTimer = null;
      }
      if (!banner) {
        saleToastActive = false;
        saleToastSessionId = null;
        return;
      }
      banner.classList.remove('active');
      banner.setAttribute('aria-hidden', 'true');
      setTimeout(function() {
        banner.setAttribute('hidden', '');
        saleToastActive = false;
        saleToastSessionId = null;

        // Sale banner indicates KPIs are about to change. Reset caches once the banner disappears.
        try { clearKpiLocalStorageCaches(); } catch (_) {}
        try { lastKpisFetchedAt = 0; } catch (_) {}
        try { kpiCacheRange = ''; } catch (_) {}
        try { kpiCacheSource = ''; } catch (_) {}
        try { kpiExpandedExtrasFetchedAt = 0; } catch (_) {}

        // Pull fresh KPI data (fast metrics) immediately after cache reset.
        try { refreshKpis({ force: true }); } catch (_) {}
        // Keep the dashboard tables/charts in sync, but do not re-show the global loader.
        try { if (PAGE === 'dashboard' && typeof window.refreshDashboard === 'function') window.refreshDashboard({ force: true, silent: true }); } catch (_) {}
        // Refresh condensed KPI extras as well.
        try { refreshKpiExtrasSoft(); } catch (_) {}
      }, 320);
    }

    let latestSaleFetchInFlight = null;
    function fetchLatestSaleForToast(options = {}) {
      const forceNew = !!(options && options.forceNew);
      if (!forceNew && latestSaleFetchInFlight) return latestSaleFetchInFlight;
      const url = API + '/api/latest-sale?_=' + Date.now();
      const p = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) { return (json && json.ok && json.sale) ? json.sale : null; })
        .catch(function() { return null; })
        .finally(function() { if (latestSaleFetchInFlight === p) latestSaleFetchInFlight = null; });
      latestSaleFetchInFlight = p;
      return p;
    }

    function hydrateLastSaleFooterFromApi(options = {}) {
      var forceNew = !!(options && options.forceNew);
      return fetchLatestSaleForToast({ forceNew: forceNew })
        .then(function(sale) {
          if (!sale || sale.createdAt == null) return null;
          setLastSaleAt(sale.createdAt);
          return sale;
        })
        .catch(function() { return null; });
    }

    // Latest sales table (/dashboard/live): last 5 converted sessions (desktop only).
    let latestSalesFetchInFlight = null;
    let latestSalesCache = null; // array of normalized rows
    let latestSalesRefetchTimer = null;

    function normalizeLatestSaleRow(row) {
      const r = row && typeof row === 'object' ? row : {};
      const sid = r.session_id != null ? String(r.session_id) : '';
      const cc = r.country_code != null ? String(r.country_code).trim().toUpperCase().slice(0, 2) : 'XX';
      const purchasedAt = r.purchased_at != null ? toMs(r.purchased_at) : null;
      const totalRaw = r.order_total != null ? (typeof r.order_total === 'number' ? r.order_total : parseFloat(String(r.order_total))) : null;
      const total = (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) ? totalRaw : null;
      const cur = r.order_currency != null ? String(r.order_currency).trim().toUpperCase() : '';
      const lastHandle = r.last_product_handle != null ? String(r.last_product_handle).trim() : '';
      const firstHandle = r.first_product_handle != null ? String(r.first_product_handle).trim() : '';
      const out = {
        session_id: sid || null,
        country_code: cc || 'XX',
        purchased_at: purchasedAt,
        order_total: total,
        order_currency: cur || null,
        last_product_handle: lastHandle || null,
        first_product_handle: firstHandle || null,
      };
      const totalGbpRaw = r.order_total_gbp != null ? (typeof r.order_total_gbp === 'number' ? r.order_total_gbp : parseFloat(String(r.order_total_gbp))) : null;
      const totalGbp = (typeof totalGbpRaw === 'number' && Number.isFinite(totalGbpRaw)) ? totalGbpRaw : null;
      if (totalGbp != null) out.order_total_gbp = totalGbp;
      const pidRaw = r.product_id != null ? String(r.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
      if (pidRaw && /^\d+$/.test(pidRaw)) out.product_id = pidRaw;
      const titleRaw = r.product_title != null ? String(r.product_title).trim() : '';
      if (titleRaw) out.product_title = titleRaw;
      return out;
    }

    function renderLatestSalesTable(rows) {
      const table = document.getElementById('latest-sales-table');
      if (!table) return;
      const tbody = table.querySelector('tbody');
      if (!tbody) return;
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="dash-empty">No sales</td></tr>';
        return;
      }
      const mainBase = getMainBaseUrl();
      const pageSize = getTableRowsPerPage('latest-sales-table', 'dashboard');
      tbody.innerHTML = list.slice(0, pageSize).map(function(s) {
        const sid = (s && s.session_id != null) ? String(s.session_id) : '';
        const cc = (s && s.country_code ? String(s.country_code) : 'XX').toUpperCase().slice(0, 2) || 'XX';
        const productId = (s && s.product_id != null) ? String(s.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const pid = (productId && /^\d+$/.test(productId)) ? productId : '';
        const handle = (s && s.last_product_handle) ? String(s.last_product_handle).trim()
          : (s && s.first_product_handle) ? String(s.first_product_handle).trim()
          : '';
        const explicitTitle = (s && s.product_title != null) ? String(s.product_title).trim() : '';
        const title = explicitTitle || (handle ? (titleCaseFromHandle(handle) || '') : '') || 'Unknown product';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        const canOpen = !!(handle || pid);
        const titleHtml = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl || '#') + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (pid ? (' data-product-id="' + escapeHtml(pid) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title || 'Unknown product');
        const ago = (s && s.purchased_at != null) ? arrivedAgo(s.purchased_at) : '\u2014';
        const money = (s && typeof s.order_total_gbp === 'number')
          ? (formatMoney(s.order_total_gbp, 'GBP') || '\u2014')
          : (s && s.order_total != null) ? (formatMoney(s.order_total, s.order_currency) || '\u2014') : '\u2014';
        return (
          '<tr' + (sid ? (' data-session-id="' + escapeHtml(sid) + '"') : '') + '>' +
            '<td class="w-1 latest-sales-flag-cell">' + flagImgSmall(cc) + '<span class="latest-sales-fraud-slot" aria-hidden="true"></span></td>' +
            '<td>' + titleHtml + '</td>' +
            '<td class="text-end text-muted">' + escapeHtml(ago) + '</td>' +
            '<td class="text-end fw-semibold">' + escapeHtml(money) + '</td>' +
          '</tr>'
        );
      }).join('');
      try { refreshFraudMarkersForLatestSalesTable(); } catch (_) {}
    }

    function upsertLatestSaleRow(nextRaw) {
      const table = document.getElementById('latest-sales-table');
      if (!table) return;
      const next = normalizeLatestSaleRow(nextRaw);
      if (!next || !next.session_id || next.purchased_at == null) return;
      const cur = Array.isArray(latestSalesCache) ? latestSalesCache.slice() : [];
      const idx = cur.findIndex(function(r) { return r && r.session_id && String(r.session_id) === String(next.session_id); });
      if (idx >= 0) {
        cur[idx] = { ...(cur[idx] || {}), ...next };
      } else {
        cur.unshift(next);
      }
      cur.sort(function(a, b) { return (toMs(b && b.purchased_at) || 0) - (toMs(a && a.purchased_at) || 0); });
      latestSalesCache = cur.slice(0, 5);
      renderLatestSalesTable(latestSalesCache);

      // SSE gives us the raw session row (may lack product title / GBP conversion).
      // Refresh the server-enriched latest-sales payload shortly after a new sale is detected.
      if (idx < 0) {
        try {
          if (latestSalesRefetchTimer) clearTimeout(latestSalesRefetchTimer);
          latestSalesRefetchTimer = setTimeout(function() {
            latestSalesRefetchTimer = null;
            try { fetchLatestSales({ force: true }); } catch (_) {}
          }, 400);
        } catch (_) {}
      }
    }

    function fetchLatestSales(options = {}) {
      const force = !!(options && options.force);
      if (!force && latestSalesFetchInFlight) return latestSalesFetchInFlight;
      const table = document.getElementById('latest-sales-table');
      if (!table) return Promise.resolve(null);
      const url = API + '/api/latest-sales?limit=5&_=' + Date.now();
      const p = fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(json) {
          const list = (json && Array.isArray(json.sales)) ? json.sales : [];
          latestSalesCache = list.map(normalizeLatestSaleRow).filter(function(r) { return r && r.session_id; }).slice(0, 5);
          renderLatestSalesTable(latestSalesCache);
          return latestSalesCache;
        })
        .catch(function() { return null; })
        .finally(function() { if (latestSalesFetchInFlight === p) latestSalesFetchInFlight = null; });
      latestSalesFetchInFlight = p;
      return p;
    }

    (function initLatestSalesTable() {
      const table = document.getElementById('latest-sales-table');
      if (!table) return;
      renderLatestSalesTable([]);
      fetchLatestSales({ force: false });
    })();

    function buildSalesKpiUpdateFromStats(data) {
      const rangeKey = getStatsRange();
      const sales = data && data.sales ? data.sales : {};
      const convertedCountMap = data && data.convertedCount ? data.convertedCount : {};
      const salesVal = typeof sales[rangeKey] === 'number' ? sales[rangeKey] : null;
      const orderCountVal = typeof convertedCountMap[rangeKey] === 'number' ? convertedCountMap[rangeKey] : null;
      return {
        labelText: orderCountVal != null ? (orderCountVal + ' Orders') : 'Orders',
        valueText: salesVal != null ? (formatRevenue(salesVal) || '\u2014') : '\u2014',
      };
    }

    // Sale sound: prime/unlock on first user interaction, and retry once on click if autoplay is blocked.
    function primeSaleAudio() {
      if (!saleAudio || saleAudioPrimed) return;
      const a = saleAudio;
      saleAudioPrimed = true;
      const prevMuted = !!a.muted;
      const prevVol = (typeof a.volume === 'number' && Number.isFinite(a.volume)) ? a.volume : 1;
      try { a.preload = 'auto'; } catch (_) {}
      try { a.load(); } catch (_) {}
      try { a.muted = true; } catch (_) {}
      try { a.volume = 0; } catch (_) {}
      try {
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(function() {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
          }).catch(function() {
            saleAudioPrimed = false;
          }).finally(function() {
            try { a.pause(); } catch (_) {}
            try { a.currentTime = 0; } catch (_) {}
            try { a.muted = prevMuted; } catch (_) {}
            try { a.volume = prevVol; } catch (_) {}
          });
          return;
        }
      } catch (_) {
        saleAudioPrimed = false;
      }
      try { a.pause(); } catch (_) {}
      try { a.currentTime = 0; } catch (_) {}
      try { a.muted = prevMuted; } catch (_) {}
      try { a.volume = prevVol; } catch (_) {}
    }

    function playSaleSound(options = {}) {
      const deferOnClick = options.deferOnClick !== false;
      if (saleMuted || !saleAudio) return;
      try { saleAudio.currentTime = 0; } catch (_) {}
      const p = saleAudio.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function() {
          if (!deferOnClick) return;
          if (saleSoundDeferredOnce || saleSoundDeferredHandler) return;
          saleSoundDeferredOnce = true;
          saleSoundDeferredHandler = function deferredSaleSoundPlay() {
            ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function(evt) {
              try { document.removeEventListener(evt, saleSoundDeferredHandler, true); } catch (_) {}
            });
            saleSoundDeferredHandler = null;
            saleSoundDeferredOnce = false;
            if (saleMuted || !saleAudio) return;
            try { primeSaleAudio(); } catch (_) {}
            try { saleAudio.currentTime = 0; } catch (_) {}
            saleAudio.play().catch(function() {});
          };
          ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(function(evt) {
            try { document.addEventListener(evt, saleSoundDeferredHandler, { once: true, capture: true }); } catch (_) {}
          });
        });
      }
    }

    function normalizeSaleToastIdentityPart(v, maxLen = 256) {
      if (v == null) return '';
      const s = String(v).trim();
      if (!s) return '';
      const low = s.toLowerCase();
      if (low === 'null' || low === 'undefined' || low === '[object object]') return '';
      return s.length > maxLen ? s.slice(0, maxLen) : s;
    }

    function pushSaleToastIdentityKey(keys, key) {
      const normalized = normalizeSaleToastIdentityPart(key, 384).toLowerCase();
      if (!normalized) return;
      if (keys.indexOf(normalized) >= 0) return;
      keys.push(normalized);
    }

    function loadSaleToastSeenKeys() {
      saleToastSeenKeys = new Set();
      saleToastSeenOrder = [];
      try {
        const raw = localStorage.getItem(SALE_TOAST_SEEN_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        parsed.slice(-SALE_TOAST_SEEN_KEY_MAX).forEach(function(entry) {
          const key = normalizeSaleToastIdentityPart(entry, 384).toLowerCase();
          if (!key || saleToastSeenKeys.has(key)) return;
          saleToastSeenKeys.add(key);
          saleToastSeenOrder.push(key);
        });
      } catch (_) {}
    }

    function saveSaleToastSeenKeys() {
      try {
        if (saleToastSeenOrder.length > SALE_TOAST_SEEN_KEY_MAX) {
          saleToastSeenOrder = saleToastSeenOrder.slice(-SALE_TOAST_SEEN_KEY_MAX);
          saleToastSeenKeys = new Set(saleToastSeenOrder);
        }
        localStorage.setItem(SALE_TOAST_SEEN_STORAGE_KEY, JSON.stringify(saleToastSeenOrder));
      } catch (_) {}
    }

    function hasSeenSaleToastIdentity(keys) {
      if (!Array.isArray(keys) || !keys.length) return false;
      for (let i = 0; i < keys.length; i += 1) {
        const key = normalizeSaleToastIdentityPart(keys[i], 384).toLowerCase();
        if (!key) continue;
        if (saleToastSeenKeys.has(key)) return true;
      }
      return false;
    }

    function rememberSaleToastIdentity(keys) {
      if (!Array.isArray(keys) || !keys.length) return;
      let changed = false;
      keys.forEach(function(rawKey) {
        const key = normalizeSaleToastIdentityPart(rawKey, 384).toLowerCase();
        if (!key || saleToastSeenKeys.has(key)) return;
        saleToastSeenKeys.add(key);
        saleToastSeenOrder.push(key);
        changed = true;
      });
      if (!changed) return;
      if (saleToastSeenOrder.length > SALE_TOAST_SEEN_KEY_MAX) {
        saleToastSeenOrder = saleToastSeenOrder.slice(-SALE_TOAST_SEEN_KEY_MAX);
        saleToastSeenKeys = new Set(saleToastSeenOrder);
      }
      saveSaleToastSeenKeys();
    }

    function buildSaleToastIdentityKeys(opts) {
      const inOpts = opts && typeof opts === 'object' ? opts : {};
      const keys = [];
      const explicit = normalizeSaleToastIdentityPart(inOpts.toastDedupeKey, 256);
      if (explicit) pushSaleToastIdentityKey(keys, 'toast:' + explicit);
      const soundKey = normalizeSaleToastIdentityPart(inOpts.soundDedupeKey, 256);
      if (soundKey) pushSaleToastIdentityKey(keys, 'sound:' + soundKey);

      const session = inOpts.session && typeof inOpts.session === 'object' ? inOpts.session : null;
      if (session) {
        const orderId = normalizeSaleToastIdentityPart(
          session.order_id != null ? session.order_id : session.orderId,
          64
        );
        const checkoutToken = normalizeSaleToastIdentityPart(
          session.checkout_token != null ? session.checkout_token : session.checkoutToken,
          128
        );
        const clickId = normalizeSaleToastIdentityPart(
          session.session_id != null ? session.session_id : session.sessionId,
          128
        );
        const purchasedAt = session.purchased_at != null
          ? toMs(session.purchased_at)
          : (session.purchasedAt != null ? toMs(session.purchasedAt) : null);
        if (orderId) pushSaleToastIdentityKey(keys, 'order:' + orderId);
        if (checkoutToken) pushSaleToastIdentityKey(keys, 'token:' + checkoutToken);
        if (clickId) pushSaleToastIdentityKey(keys, 'click:' + clickId);
        if (clickId && purchasedAt != null) pushSaleToastIdentityKey(keys, 'click-sale:' + clickId + ':' + String(purchasedAt));
        if (purchasedAt != null) pushSaleToastIdentityKey(keys, 'sale-at:' + String(purchasedAt));
      }

      const latestSale = inOpts.latestSale && typeof inOpts.latestSale === 'object'
        ? inOpts.latestSale
        : (inOpts.sale && typeof inOpts.sale === 'object' ? inOpts.sale : null);
      if (latestSale) {
        const orderId = normalizeSaleToastIdentityPart(
          latestSale.orderId != null ? latestSale.orderId : latestSale.order_id,
          64
        );
        const checkoutToken = normalizeSaleToastIdentityPart(
          latestSale.checkoutToken != null ? latestSale.checkoutToken : latestSale.checkout_token,
          128
        );
        const clickId = normalizeSaleToastIdentityPart(
          latestSale.sessionId != null ? latestSale.sessionId : latestSale.session_id,
          128
        );
        const createdAt = latestSale.createdAt != null
          ? toMs(latestSale.createdAt)
          : (latestSale.created_at != null ? toMs(latestSale.created_at) : null);
        if (orderId) pushSaleToastIdentityKey(keys, 'order:' + orderId);
        if (checkoutToken) pushSaleToastIdentityKey(keys, 'token:' + checkoutToken);
        if (clickId) pushSaleToastIdentityKey(keys, 'click:' + clickId);
        if (createdAt != null) pushSaleToastIdentityKey(keys, 'sale-at:' + String(createdAt));
      }

      const payload = inOpts.payload && typeof inOpts.payload === 'object' ? inOpts.payload : null;
      if (payload) {
        const createdAt = payload.createdAt != null
          ? toMs(payload.createdAt)
          : (payload.created_at != null ? toMs(payload.created_at) : null);
        if (createdAt != null) pushSaleToastIdentityKey(keys, 'sale-at:' + String(createdAt));
      }

      return keys;
    }

    (function initSaleToastIdentityStore() {
      loadSaleToastSeenKeys();
    })();

    function buildSaleSoundDedupeKey(opts) {
      const inOpts = opts && typeof opts === 'object' ? opts : {};
      const explicit = inOpts.soundDedupeKey != null ? String(inOpts.soundDedupeKey).trim() : '';
      if (explicit) return explicit;
      const session = inOpts.session && typeof inOpts.session === 'object' ? inOpts.session : null;
      if (session) {
        const orderId = session.order_id != null
          ? String(session.order_id).trim()
          : (session.orderId != null ? String(session.orderId).trim() : '');
        if (orderId) return 'order:' + orderId;
        const sid = session.session_id != null ? String(session.session_id).trim() : '';
        const purchasedAt = session.purchased_at != null ? toMs(session.purchased_at) : null;
        if (sid && purchasedAt != null) return 'session-sale:' + sid + ':' + String(purchasedAt);
        if (sid) return 'session:' + sid;
        if (purchasedAt != null) return 'purchased:' + String(purchasedAt);
      }
      const payload = inOpts.payload && typeof inOpts.payload === 'object' ? inOpts.payload : null;
      if (payload && payload.createdAt != null) {
        const createdAt = toMs(payload.createdAt);
        if (createdAt != null) return 'payload:' + String(createdAt);
      }
      const latest = lastSaleAt != null ? toMs(lastSaleAt) : null;
      if (latest != null) return 'last-sale:' + String(latest);
      return '';
    }

    var SALE_SOUND_CLAIM_PREFIX = 'kexo:saleSound:claim:v1:';
    var saleSoundTabId = (function () {
      try {
        var k = 'kexo:saleSound:tabId';
        var v = sessionStorage.getItem(k);
        if (v && v.length) return v;
        v = 'tab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);
        sessionStorage.setItem(k, v);
        return v;
      } catch (_) {
        return 'tab_' + Date.now();
      }
    })();

    function shouldPlaySaleSoundForToast(opts) {
      const inOpts = opts && typeof opts === 'object' ? opts : {};
      const origin = inOpts.origin != null ? String(inOpts.origin).trim().toLowerCase() : '';
      // Keep manual test/toggle behavior unchanged (always audible).
      if (origin === 'manual') return true;
      const now = Date.now();
      if (
        origin === 'stats' &&
        saleSoundLastOrigin === 'sse' &&
        saleSoundLastAt > 0 &&
        (now - saleSoundLastAt) < SALE_SOUND_DEDUPE_WINDOW_MS
      ) {
        return false;
      }
      const dedupeKey = buildSaleSoundDedupeKey(inOpts);
      if (
        dedupeKey &&
        saleSoundLastKey === dedupeKey &&
        saleSoundLastAt > 0 &&
        (now - saleSoundLastAt) < SALE_SOUND_DEDUPE_WINDOW_MS
      ) {
        return false;
      }
      if (dedupeKey) saleSoundLastKey = dedupeKey;
      saleSoundLastOrigin = origin || 'unknown';
      saleSoundLastAt = now;
      return true;
    }

    function tryClaimAndPlaySaleSound(dedupeKey) {
      try {
        var key = SALE_SOUND_CLAIM_PREFIX + (dedupeKey && dedupeKey.length ? String(dedupeKey).slice(0, 120) : 'default');
        var raw = localStorage.getItem(key);
        var claim = null;
        try { claim = raw ? JSON.parse(raw) : null; } catch (_) {}
        if (!claim || claim.tabId !== saleSoundTabId) return;
        if (saleMuted || !saleAudio) return;
        try { primeSaleAudio(); } catch (_) {}
        playSaleSound({ deferOnClick: true });
      } catch (_) {}
    }

    function triggerSaleToast(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      const session = opts.session || null;
      const playSound = opts.playSound !== false;
      const payload = opts.payload || null;
      const skipLatest = !!opts.skipLatest;
      const persist = !!opts.persist;
      const allowReplay = !!opts.allowReplay;
      const latestSale = opts.latestSale && typeof opts.latestSale === 'object' ? opts.latestSale : null;
      const identityKeys = buildSaleToastIdentityKeys(opts);
      if (!allowReplay) {
        // Guardrail: automatic notifications must carry a stable identity, otherwise we risk duplicates.
        if (!identityKeys.length) return;
        if (hasSeenSaleToastIdentity(identityKeys)) return;
        rememberSaleToastIdentity(identityKeys);
      }
      const toastToken = ++saleToastToken; // newest toast wins
      saleToastLastPayload = null;
      saleToastSessionId = session && session.session_id != null ? String(session.session_id) : null;
      saleToastLastOrderId = null;
      if (latestSale && latestSale.orderId != null) saleToastLastOrderId = String(latestSale.orderId);
      if (persist) {
        saleToastPinned = true;
        updateSaleToastToggle();
      } else if (saleToastPinned) {
        saleToastPinned = false;
        updateSaleToastToggle();
      }

      showSaleToast();

      if (payload) {
        setSaleToastContent(payload);
      } else {
        // Fast, best-effort content from the session update (then refined by truth).
        try {
          const cc = session && session.country_code ? String(session.country_code).toUpperCase().slice(0, 2) : 'XX';
          let productTitle = '';
          let productHandle = '';
          if (session && session.last_product_handle) productHandle = String(session.last_product_handle).trim();
          if (!productHandle && session && session.first_product_handle) productHandle = String(session.first_product_handle).trim();
          if (productHandle) productTitle = titleCaseFromHandle(String(productHandle));
          let amountGbp = null;
          if (session && session.order_total != null) {
            const n = typeof session.order_total === 'number' ? session.order_total : parseFloat(String(session.order_total));
            if (Number.isFinite(n)) amountGbp = n;
          }
          const createdAt = (session && session.purchased_at != null)
            ? session.purchased_at
            : (session && session.last_seen != null)
              ? session.last_seen
              : (session && session.started_at != null)
                ? session.started_at
                : Date.now();
          setSaleToastContent({
            countryCode: cc,
            productTitle: productTitle || 'Processing\u2026',
            amountGbp,
            productHandle: productHandle || '',
            createdAt,
          });
        } catch (_) {}
      }

      if (playSound && shouldPlaySaleSoundForToast(opts)) {
        const origin = opts.origin != null ? String(opts.origin).trim().toLowerCase() : '';
        const dedupeKey = buildSaleSoundDedupeKey(opts);
        if (origin === 'manual') {
          try { primeSaleAudio(); } catch (_) {}
          playSaleSound({ deferOnClick: true });
        } else {
          try {
            var claimKey = SALE_SOUND_CLAIM_PREFIX + (dedupeKey && dedupeKey.length ? String(dedupeKey).slice(0, 120) : 'default');
            localStorage.setItem(claimKey, JSON.stringify({ tabId: saleSoundTabId, at: Date.now() }));
          } catch (_) {}
          setTimeout(function () {
            try { tryClaimAndPlaySaleSound(dedupeKey); } catch (_) {}
          }, 65);
        }
      }

      if (saleToastHideTimer) clearTimeout(saleToastHideTimer);
      if (!persist) saleToastHideTimer = setTimeout(hideSaleToast, 10000);

      if (skipLatest) return;
      fetchLatestSaleForToast({ forceNew: true }).then(function(sale) {
        if (!sale) return;
        if (toastToken !== saleToastToken) return; // stale fetch (a newer sale toast is showing)
        if (!saleToastActive) return;
        if (!allowReplay) {
          try { rememberSaleToastIdentity(buildSaleToastIdentityKeys({ latestSale: sale })); } catch (_) {}
        }
        const orderId = sale.orderId != null ? String(sale.orderId) : '';
        if (orderId) saleToastLastOrderId = orderId;
        const cc = sale.countryCode ? String(sale.countryCode).toUpperCase().slice(0, 2) : 'XX';
        const product = sale.productTitle && String(sale.productTitle).trim() ? String(sale.productTitle).trim() : '';
        const amount = sale.amountGbp != null ? Number(sale.amountGbp) : null;
        const productHandle = sale.productHandle != null ? String(sale.productHandle).trim() : '';
        const productThumbUrl = sale.productThumbUrl != null ? String(sale.productThumbUrl).trim() : '';
        const createdAt = sale.createdAt != null ? sale.createdAt : null;
        setSaleToastContent({
          countryCode: cc || 'XX',
          productTitle: product || (document.getElementById('sale-toast-product') ? document.getElementById('sale-toast-product').textContent : '\u2014'),
          amountGbp: (amount != null && Number.isFinite(amount)) ? amount : null,
          productHandle: productHandle || '',
          productThumbUrl: productThumbUrl || '',
          createdAt,
        });
      });
    }

    function buildSaleToastPayloadFromSale(sale) {
      if (!sale) return null;
      const cc = sale.countryCode ? String(sale.countryCode).toUpperCase().slice(0, 2) : 'XX';
      const productTitle = sale.productTitle && String(sale.productTitle).trim() ? String(sale.productTitle).trim() : '';
      const amount = sale.amountGbp != null ? Number(sale.amountGbp) : null;
      return {
        countryCode: cc || 'XX',
        productTitle,
        amountGbp: (amount != null && Number.isFinite(amount)) ? amount : null,
        productHandle: sale.productHandle != null ? String(sale.productHandle).trim() : '',
        productThumbUrl: sale.productThumbUrl != null ? String(sale.productThumbUrl).trim() : '',
        createdAt: sale.createdAt != null ? sale.createdAt : null,
      };
    }

    function triggerManualSaleToast(persist) {
      const keep = !!persist;
      const cached = saleToastLastPayload;
      const hasCache = cached && (cached.productTitle || cached.amountGbp != null || cached.productHandle || cached.productThumbUrl);
      const placeholder = { countryCode: 'XX', productTitle: 'Loading\u2026', amountGbp: null, productHandle: '', productThumbUrl: '', createdAt: null };
      const payload = hasCache ? cached : placeholder;
      // Show banner immediately (no wait for API), then refresh when fetch completes.
      triggerSaleToast({ origin: 'manual', payload: payload, playSound: true, skipLatest: true, persist: keep, allowReplay: true });
      fetchLatestSaleForToast({ forceNew: true }).then(function(sale) {
        const next = buildSaleToastPayloadFromSale(sale);
        if (!next) return;
        if (saleToastActive) setSaleToastContent(next);
      });
    }

    (function initSaleToastToggle() {
      function handleToggle(e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (saleToastPinned) {
          saleToastPinned = false;
          updateSaleToastToggle();
          hideSaleToast();
        } else {
          triggerManualSaleToast(true);
        }
      }
      function primeOnPointerDown() { try { primeSaleAudio(); } catch (_) {} }
      ['last-sale-toggle', 'footer-last-sale-toggle'].forEach(function(id) {
        var btn = document.getElementById(id);
        if (btn) {
          btn.addEventListener('click', handleToggle);
          btn.addEventListener('pointerdown', primeOnPointerDown, { capture: true });
          btn.addEventListener('touchstart', primeOnPointerDown, { capture: true });
        }
      });
      updateSaleToastToggle();
    })();

    (function initSaleToastCloseBtn() {
      var btn = document.getElementById('sale-toast-close');
      if (!btn) return;
      btn.addEventListener('click', function(e) {
        if (e) e.preventDefault();
        saleToastPinned = false;
        updateSaleToastToggle();
        hideSaleToast();
      });
    })();

    function getShopParam() {
      var p = new URLSearchParams(window.location.search);
      var shop = p.get('shop') || '';
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : null;
    }

    function fetchShopifySales() {
      var shop = getShopForSales();
      if (!shop || getStatsRange() !== 'today') {
        // If the store-base-url lookup is done and we still have no shop, stop waiting and fall back to DB.
        if (getStatsRange() === 'today' && storeBaseUrlLoaded && !shop) shopifySalesTodayLoaded = true;
        shopifySalesTodayLoading = false;
        return;
      }
      if (shopifySalesTodayLoading) return;
      shopifySalesTodayLoading = true;
      fetch(API + '/api/shopify-sales?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          shopifySalesToday = data && typeof data.salesToday === 'number' ? data.salesToday : null;
          shopifyOrderCountToday = data && typeof data.orderCountToday === 'number' ? data.orderCountToday : null;
          shopifySalesTodayLoaded = true;
          shopifySalesTodayLoading = false;
          renderSales(statsCache);
          renderLiveKpis(getKpiData());
        })
        .catch(function() {
          shopifySalesToday = null;
          shopifyOrderCountToday = null;
          shopifySalesTodayLoaded = true;
          shopifySalesTodayLoading = false;
          renderSales(statsCache);
          renderLiveKpis(getKpiData());
        });
    }

    function fetchShopifySessions() {
      var shop = getShopForSales();
      if (!shop || getStatsRange() !== 'today') {
        if (getStatsRange() === 'today' && storeBaseUrlLoaded && !shop) shopifySessionsTodayLoaded = true;
        shopifySessionsTodayLoading = false;
        return;
      }
      if (shopifySessionsTodayLoading) return;
      shopifySessionsTodayLoading = true;
      fetch(API + '/api/shopify-sessions?shop=' + encodeURIComponent(shop), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          shopifySessionsToday = data && typeof data.sessionsToday === 'number' ? data.sessionsToday : null;
          shopifySessionsTodayLoaded = true;
          shopifySessionsTodayLoading = false;
          renderLiveKpis(getKpiData());
        })
        .catch(function() {
          shopifySessionsToday = null;
          shopifySessionsTodayLoaded = true;
          shopifySessionsTodayLoading = false;
          renderLiveKpis(getKpiData());
        });
    }

    function fetchBestSellers(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        bestSellersCache = null;
        renderBestSellers(null);
        return Promise.resolve(null);
      }
      var pageSize = getTableRowsPerPage('best-sellers-table', 'product');
      let url = API + '/api/shopify-best-sellers?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange()) +
          '&page=' + encodeURIComponent(String(bestSellersPage || 1)) +
          '&pageSize=' + encodeURIComponent(String(pageSize)) +
          '&sort=' + encodeURIComponent(String(bestSellersSortBy || 'rev')) +
          '&dir=' + encodeURIComponent(String(bestSellersSortDir || 'desc'));
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data || {} }; }).catch(function() { return { ok: r.ok, status: r.status, data: {} }; }); })
        .then(function(result) {
          if (result.ok) {
            bestSellersCache = result.data;
            renderProductsChart(result.data);
            renderBestSellers(result.data);
            return result.data;
          }
          var msg = (result.data && result.data.error) ? result.data.error : ('Error ' + result.status);
          if (result.data && result.data.hint) msg += '. ' + result.data.hint;
          bestSellersCache = null;
          renderBestSellers(null, msg);
          return null;
        })
        .catch(function() { bestSellersCache = null; renderBestSellers(null); return null; });
    }

    function normalizeProductsLeaderboardView(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      return s === 'type' ? 'type' : 'title';
    }

    function labelForProductsLeaderboardView(view) {
      return normalizeProductsLeaderboardView(view) === 'type' ? 'Product Type' : 'Product Title';
    }

    function updateProductsLeaderboardDropdownUi() {
      const view = normalizeProductsLeaderboardView(productsLeaderboardView);
      const labelEl = document.getElementById('products-leaderboard-label');
      const grid = document.getElementById('leaderboard-cards-grid');
      const wrap = document.getElementById('leaderboard-cards-wrap');
      const menu = document.getElementById('products-leaderboard-menu');
      if (labelEl) labelEl.textContent = labelForProductsLeaderboardView(view);
      if (grid) grid.setAttribute('data-leaderboard-view', view);
      if (wrap) wrap.setAttribute('data-leaderboard-view', view);
      if (menu) {
        const opts = menu.querySelectorAll('.aov-cards-title-option');
        opts.forEach(function(el) {
          const v = normalizeProductsLeaderboardView(el && el.getAttribute ? el.getAttribute('data-view') : '');
          el.setAttribute('aria-current', v === view ? 'true' : 'false');
        });
      }
    }

    function closeProductsLeaderboardMenu() {
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
    }

    function toggleProductsLeaderboardMenu() {
      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      if (!btn || !menu) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeProductsLeaderboardMenu();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
    }

    function setProductsLeaderboardView(nextView, options = {}) {
      const force = !!(options && options.force);
      const view = normalizeProductsLeaderboardView(nextView);
      productsLeaderboardView = view;
      try { sessionStorage.setItem(PRODUCTS_LEADERBOARD_VIEW_KEY, view); } catch (_) {}
      updateProductsLeaderboardDropdownUi();
      closeProductsLeaderboardMenu();
      renderProductsLeaderboard(leaderboardCache);
      if (activeMainTab !== 'breakdown' && activeMainTab !== 'products') return;
      fetchProductsLeaderboard({ force }).catch(function() {});
    }

    (function initProductsLeaderboardDropdown() {
      updateProductsLeaderboardDropdownUi();
