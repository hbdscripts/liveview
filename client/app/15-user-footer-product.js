        var avatarEl = document.getElementById('user-avatar');
        var emailEl = document.getElementById('user-email');
        // We still fetch /api/me even if avatar elements are missing, so we can gate master-only UI.
        fetch('/api/me', { credentials: 'same-origin' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var isMaster = !!(d && d.isMaster);
            try { window.__kexoMe = d || null; } catch (_) {}
            try { window.__kexoIsMasterUser = isMaster; } catch (_) {}
            try { window.dispatchEvent(new CustomEvent('kexo:me-loaded', { detail: { isMaster: isMaster, email: d && d.email ? String(d.email) : '' } })); } catch (_) {}
            try { if (typeof window.__kexoApplyEffectiveViewer === 'function') window.__kexoApplyEffectiveViewer(); } catch (_) {}
            if (!d || !d.email) return;
            if (avatarEl && d.initial) avatarEl.textContent = d.initial;
            if (emailEl) emailEl.textContent = d.email;
          })
          .catch(function() {
            try { window.__kexoMe = null; } catch (_) {}
            try { window.__kexoIsMasterUser = false; } catch (_) {}
            try { window.dispatchEvent(new CustomEvent('kexo:me-loaded', { detail: { isMaster: false, email: '' } })); } catch (_) {}
            try { if (typeof window.__kexoApplyEffectiveViewer === 'function') window.__kexoApplyEffectiveViewer(); } catch (_) {}
          });
      } catch (_) {}
    })();

    // ?????? Online badge: populate website name from store config ????????????????????????????????????
    (function initOnlineBadgeWebsite() {
      try {
        var el = document.getElementById('kexo-online-website');
        if (!el) return;
        fetch('/api/store-base-url', { credentials: 'same-origin' })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            var domain = (d && d.shopDisplayDomain) ? String(d.shopDisplayDomain).trim() : '';
            el.textContent = domain || '\u2014';
            el.title = domain || '';
          })
          .catch(function() {});
      } catch (_) {}
    })();

    // ?????? Footer action buttons ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    (function initFooterActions() {
      function proxyClick(footerSel, headerId) {
        document.querySelectorAll(footerSel).forEach(function(btn) {
          btn.addEventListener('click', function() {
            var h = document.getElementById(headerId);
            if (h) h.click();
          });
        });
      }
      function doCacheReload() {
        var url = window.location.pathname + (window.location.search || '');
        url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
        if (window.location.hash) url += window.location.hash;
        window.location.href = url;
      }
      document.querySelectorAll('.footer-settings-cache-reload, .footer-cache-reload-btn').forEach(function (btn) {
        btn.addEventListener('click', doCacheReload);
      });
      var backToTop = document.getElementById('back-to-top-btn');
      if (backToTop) {
        backToTop.addEventListener('click', function() {
          function scrollToTop() {
            try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
            if (document.documentElement) document.documentElement.scrollTop = 0;
            if (document.body) document.body.scrollTop = 0;
            try { window.scrollTo(0, 0); } catch (_) {}
            if (window.parent !== window) {
              try { window.parent.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) {}
              try { window.parent.scrollTo(0, 0); } catch (_) {}
            }
          }
          scrollToTop();
          requestAnimationFrame(scrollToTop);
        });
      }
    })();

    // ?????? Footer diagnostics strip (status tags from config-status) ?????????????????????
    (function initFooterDiagnostics() {
      var wrap = document.getElementById('kexo-footer-diagnostics');
      var tagsEl = document.getElementById('kexo-footer-diagnostics-tags');
      if (!wrap || !tagsEl) return;
      var active = false;
      var token = 0;
      function stop() {
        token += 1;
        active = false;
        try { wrap.style.display = 'none'; } catch (_) {}
        try { tagsEl.innerHTML = ''; } catch (_) {}
      }
      function render() {
        if (active) return;
        active = true;
        var myToken = (token += 1);
        var url = API + '/api/config-status';
        try {
          var shop = (typeof getShopParam === 'function' ? getShopParam() : null) || (typeof shopForSalesFallback === 'string' && shopForSalesFallback ? shopForSalesFallback : null);
          if (shop) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'shop=' + encodeURIComponent(shop);
        } catch (_) {}
        fetch(url, { credentials: 'same-origin', cache: 'no-store' })
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(c) {
            if (myToken !== token) return;
            if (!c) return;
            var items = [];
            var px = c.pixel;
            var ads = c.ads && c.ads.status ? c.ads.status : null;
            var gaProvider = ads && Array.isArray(ads.providers) ? ads.providers.find(function(p) { return p && String(p.key || '').toLowerCase() === 'google_ads'; }) : null;
            var gaConnected = !!(gaProvider && gaProvider.connected);
            items.push({ key: 'pixel', label: 'Kexo Pixel', status: (px && px.installed === true) ? 'Online' : 'Offline', ok: !!(px && px.installed === true) });
            items.push({ key: 'google_ads', label: 'Google Ads', status: gaConnected ? 'Connected' : 'Offline', ok: gaConnected });
            var html = '';
            items.forEach(function(it) {
              var statusCls = it.ok ? 'kexo-status-indicator--online' : 'kexo-status-indicator--offline';
              var esc = function(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
              html += '<div class="kexo-footer-diagnostics-tag">';
              html += '<a href="/settings?tab=admin&adminTab=diagnostics" class="kexo-footer-diagnostics-tag-link" title="' + esc(it.label) + ' ' + esc(it.status) + ' \u2014 click for diagnostics">';
              html += '<span class="kexo-footer-diagnostics-label">' + esc(it.label) + '</span>';
              html += '</a>';
              html += '<span class="kexo-footer-diagnostics-status">';
              html += '<span class="kexo-status-indicator ' + statusCls + '" aria-hidden="true"></span>' + esc(it.status);
              html += '</span>';
              html += '</div>';
            });
            tagsEl.innerHTML = html;
            wrap.style.display = 'block';
          })
          .catch(function() {});
      }

      function applyFromViewer(viewer) {
        var isAdmin = !!(viewer && (viewer.isAdmin === true || viewer.isMaster === true));
        if (!isAdmin) return stop();
        render();
      }

      try {
        if (typeof window.__kexoGetEffectiveViewer === 'function') {
          applyFromViewer(window.__kexoGetEffectiveViewer());
        }
      } catch (_) {}

      window.addEventListener('kexo:viewer-changed', function(ev) {
        try { applyFromViewer(ev && ev.detail ? ev.detail : null); } catch (_) {}
      });
    })();

    // ?????? Shared Product Insights modal ?????????????????????????????????????????????????????????????????????????????????????????????????????????
    (function initProductInsightsModal() {
      if (window.__productInsightsModalInit) return;
      window.__productInsightsModalInit = true;

      var modalEl = null;
      var currentMode = 'product'; // product | page
      var currentHandle = null;
      var currentProductId = null;
      var currentTitle = null;
      var currentProductUrl = null;
      var currentPageUrl = null;
      var currentLandingKind = null; // entry | exit (when opened from sessions table)
      var currentRangeKey = 'today'; // modal-local range; default Today regardless of page range
      var lastPayload = null;
      var backdropEl = null;
      var charts = { revenue: null, activity: null };
      var apexLoading = false;
      var apexWaiters = [];

      function isModifiedClick(e) {
        if (!e) return false;
        if (e.defaultPrevented) return true;
        if (e.button != null && e.button !== 0) return true; // only left click
        return !!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
      }

      function normalizeHandle(h) {
        if (!h) return '';
        return String(h).trim().toLowerCase().slice(0, 128);
      }

      function parseHandleFromHref(href) {
        if (!href) return '';
        try {
          var u = new URL(String(href), window.location.origin);
          var p = String(u.pathname || '');
          var m = p.match(/^\/products\/([^/?#]+)/i);
          if (m && m[1]) return normalizeHandle(decodeURIComponent(m[1]));
        } catch (_) {}
        var raw = String(href);
        var m2 = raw.match(/\/products\/([^/?#]+)/i);
        return m2 && m2[1] ? normalizeHandle(m2[1]) : '';
      }

      function ensureApexCharts(cb) {
        if (typeof ApexCharts !== 'undefined') { cb(); return; }
        apexWaiters.push(cb);
        if (apexLoading) return;
        apexLoading = true;
        try {
          var s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/apexcharts@4.7.0/dist/apexcharts.min.js';
          s.defer = true;
          s.onload = function() {
            apexLoading = false;
            var q = apexWaiters.slice();
            apexWaiters = [];
            q.forEach(function(fn) { try { fn(); } catch (_) {} });
          };
          s.onerror = function() { apexLoading = false; apexWaiters = []; };
          document.head.appendChild(s);
        } catch (_) {
          apexLoading = false;
          apexWaiters = [];
        }
      }

      function destroyCharts() {
        try { if (charts.revenue) charts.revenue.destroy(); } catch (_) {}
        try { if (charts.activity) charts.activity.destroy(); } catch (_) {}
        charts.revenue = null;
        charts.activity = null;
      }

      function ensureDom() {
        if (modalEl) return modalEl;
        modalEl = document.getElementById('product-insights-modal');
        if (modalEl) return modalEl;

        var wrap = document.createElement('div');
        wrap.className = 'modal modal-blur fade';
        wrap.id = 'product-insights-modal';
        wrap.tabIndex = -1;
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.display = 'none';
        wrap.innerHTML =
          '<div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable" role="dialog">' +
            '<div class="modal-content">' +
              '<div class="modal-header p-4">' +
                '<h5 class="modal-title" id="product-insights-title">Product</h5>' +
                '<div class="ms-auto d-flex align-items-center gap-2">' +
                  '<select class="form-select form-select-sm" id="product-insights-range" aria-label="Date range">' +
                    '<option value="today" selected>Today</option>' +
                    '<option value="yesterday">Yesterday</option>' +
                    '<option value="3d">Last 3 days</option>' +
                    '<option value="7d">Last 7 days</option>' +
                    '<option value="14d">Last 14 days</option>' +
                    '<option value="30d">Last 30 days</option>' +
                  '</select>' +
                  '<button type="button" class="btn-close" id="product-insights-close" aria-label="Close"></button>' +
                '</div>' +
              '</div>' +
              '<div class="modal-body">' +
                '<div id="product-insights-status" class="text-muted">Loading\u2026</div>' +
                '<div id="product-insights-body" style="display:none">' +
                  '<div class="row g-3">' +
                    '<div class="col-12 col-lg-5" id="product-insights-col-left">' +
                      '<div class="card">' +
                        '<div class="card-body">' +
                          '<div class="kexo-product-gallery">' +
                            '<div class="product-insights-main-img-wrap">' +
                              '<img id="product-insights-main-img" class="img-fluid" alt="">' +
                            '</div>' +
                            '<div class="product-insights-thumbs-bar" aria-label="Product images">' +
                              '<button type="button" class="btn btn-icon btn-ghost-secondary product-insights-thumb-arrow" id="product-insights-thumbs-left" aria-label="Scroll thumbnails left" style="display:none">' +
                                '<i class="fa-light fa-chevron-left" aria-hidden="true"></i>' +
                              '</button>' +
                              '<div class="product-insights-thumbs-strip" id="product-insights-thumbs"></div>' +
                              '<button type="button" class="btn btn-icon btn-ghost-secondary product-insights-thumb-arrow" id="product-insights-thumbs-right" aria-label="Scroll thumbnails right" style="display:none">' +
                                '<i class="fa-light fa-chevron-right" aria-hidden="true"></i>' +
                              '</button>' +
                            '</div>' +
                          '</div>' +
                        '</div>' +
                      '</div>' +
                      '<div class="card mt-3 kexo-card-collapsed" data-collapse-id="product-insights-revenue">' +
                        '<div class="card-header"><h3 class="card-title">Revenue</h3></div>' +
                        '<div class="card-body"><div id="product-insights-chart-revenue" class="dash-chart-wrap" style="min-height:240px"></div></div>' +
                      '</div>' +
                      '<div class="card mt-3 kexo-card-collapsed" data-collapse-id="product-insights-demand">' +
                        '<div class="card-header"><h3 class="card-title">Demand signals</h3></div>' +
                        '<div class="card-body"><div id="product-insights-chart-activity" class="dash-chart-wrap" style="min-height:240px"></div></div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="col-12 col-lg-7" id="product-insights-col-right">' +
                      '<div class="card" data-no-card-collapse="1">' +
                        '<div class="card-header"><h3 class="card-title" id="product-insights-details-title">Product details</h3></div>' +
                        '<div>' + (typeof buildKexoNativeTable === 'function' ? buildKexoNativeTable({
                          tableId: 'product-insights-metrics-table-wrap',
                          bodyId: 'product-insights-metrics-table',
                          tableClass: 'table table-vcenter card-table table-sm kexo-product-insights-metrics',
                          columns: (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['product-insights-metrics-table'] && window.KEXO_APP_MODAL_TABLE_DEFS['product-insights-metrics-table'].columns) || [
                            { header: 'Metric', headerClass: '' },
                            { header: 'Value', headerClass: 'text-end' }
                          ]
                        }) : '<div class="table-responsive"><table class="table table-vcenter card-table table-sm kexo-product-insights-metrics"><thead><tr><th>Metric</th><th class="text-end">Value</th></tr></thead><tbody id="product-insights-metrics-table"></tbody></table></div>') + '</div>' +
                      '</div>' +
                      '<div class="card mt-3" data-no-card-collapse="1" id="product-insights-top-countries-card" style="display:none">' +
                        '<div class="card-header"><h3 class="card-title">Top countries</h3></div>' +
                        '<div class="card-body">' +
                          '<div id="product-insights-top-countries" class="d-grid gap-2"></div>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="modal-footer d-flex align-items-center justify-content-end gap-2 p-4">' +
                '<a class="btn btn-primary" id="product-insights-open-admin" href="#" target="_blank" rel="noopener" style="display:none">Edit on Shopify</a>' +
                '<a class="btn btn-secondary" id="product-insights-open-store" href="#" target="_blank" rel="noopener">View on Website</a>' +
              '</div>' +
            '</div>' +
          '</div>';

        document.body.appendChild(wrap);
        modalEl = wrap;

        var closeBtn = document.getElementById('product-insights-close');
        if (closeBtn) closeBtn.addEventListener('click', function() { close(); });
        modalEl.addEventListener('click', function(e) { if (e && e.target === modalEl) close(); });
        document.addEventListener('keydown', function(e) {
          if (!modalEl || !modalEl.classList.contains('show')) return;
          var key = e && (e.key || e.code) ? String(e.key || e.code) : '';
          if (key === 'Escape') close();
        });

        var sel = document.getElementById('product-insights-range');
        if (sel) {
          sel.addEventListener('change', function() {
            var v = sel.value || 'today';
            currentRangeKey = v;
            load();
          });
        }

        var thumbsLeft = document.getElementById('product-insights-thumbs-left');
        if (thumbsLeft) {
          thumbsLeft.addEventListener('click', function(e) {
            e.preventDefault();
            scrollThumbStrip(-1);
          });
        }
        var thumbsRight = document.getElementById('product-insights-thumbs-right');
        if (thumbsRight) {
          thumbsRight.addEventListener('click', function(e) {
            e.preventDefault();
            scrollThumbStrip(1);
          });
        }
        var thumbsStrip = document.getElementById('product-insights-thumbs');
        if (thumbsStrip) {
          thumbsStrip.addEventListener('scroll', function() {
            syncThumbStripArrows();
          }, { passive: true });
        }
        try {
          window.addEventListener('resize', function() { syncThumbStripArrows(); syncMainImageBalance(); });
        } catch (_) {}

        // When collapsed chart cards are expanded, render charts at the right size.
        modalEl.addEventListener('click', function(e) {
          var btn = e && e.target && e.target.closest ? e.target.closest('.kexo-card-collapse-toggle') : null;
          if (!btn) return;
          setTimeout(function() {
            try { syncMainImageBalance(); } catch (_) {}
            try { if (lastPayload) renderCharts(lastPayload); } catch (_) {}
          }, 160);
        });

        return modalEl;
      }

      function ensureBackdrop() {
        if (backdropEl && backdropEl.parentNode) return;
        var el = document.createElement('div');
        el.className = 'modal-backdrop fade show product-insights-backdrop';
        document.body.appendChild(el);
        backdropEl = el;
      }

      function removeBackdrop() {
        if (backdropEl && backdropEl.parentNode) {
          backdropEl.parentNode.removeChild(backdropEl);
        }
        backdropEl = null;
      }

      function show() {
        ensureDom();
        ensureBackdrop();
        modalEl.style.display = 'block';
        modalEl.classList.add('show');
        modalEl.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');
      }

      function close() {
        if (!modalEl) return;
        modalEl.style.display = 'none';
        modalEl.classList.remove('show');
        modalEl.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('modal-open');
        removeBackdrop();
        destroyCharts();
        currentMode = 'product';
        currentHandle = null;
        currentProductId = null;
        currentTitle = null;
        currentProductUrl = null;
        currentPageUrl = null;
        currentLandingKind = null;
      }

      function setStatus(msg) {
        var s = document.getElementById('product-insights-status');
        var b = document.getElementById('product-insights-body');
        if (s) s.textContent = msg || '';
        if (b) b.style.display = 'none';
        if (s) s.style.display = msg ? 'block' : 'none';
      }

      function fmtNum(n) {
        var x = (typeof n === 'number') ? n : Number(n);
        if (!isFinite(x)) return '\u2014';
        try { return x.toLocaleString('en-GB'); } catch (_) { return String(Math.round(x)); }
      }

      function labelForTs(ts, isHourly) {
        try {
          var d = new Date(Number(ts));
          if (isHourly) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        } catch (_) {
          return '';
        }
      }

      function renderCharts(payload) {
        if (!payload || !payload.series || !payload.series.points) return;
        var points = payload.series.points || [];
        var isHourly = !!(payload.series && payload.series.isHourly);
        var labels = points.map(function(p) { return labelForTs(p.ts, isHourly); });
        var rev = points.map(function(p) { return (p && p.revenueGbp) ? Number(p.revenueGbp) : 0; });
        var ord = points.map(function(p) { return (p && p.orders) ? Number(p.orders) : 0; });
        var clicks = points.map(function(p) { return (p && p.clicks) ? Number(p.clicks) : 0; });
        var views = points.map(function(p) { return (p && p.views) ? Number(p.views) : 0; });
        var atc = points.map(function(p) { return (p && p.addToCart) ? Number(p.addToCart) : 0; });

        ensureApexCharts(function() {
          var revEl = document.getElementById('product-insights-chart-revenue');
          var actEl = document.getElementById('product-insights-chart-activity');
          if ((!revEl && !actEl) || typeof ApexCharts === 'undefined') return;

          function isVisible(el) {
            if (!el) return false;
            if ((el.clientWidth || 0) < 30) return false;
            if (!el.offsetParent) return false;
            return true;
          }

          var canRev = isVisible(revEl);
          var canAct = isVisible(actEl);
          if (!canRev && !canAct) {
            // Charts are inside collapsed cards (hidden). We'll re-render when expanded.
            destroyCharts();
            return;
          }

          destroyCharts();

          // Revenue chart (GBP + Orders)
          if (canRev) {
            charts.revenue = new ApexCharts(revEl, {
              chart: { type: 'area', height: 240, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
              series: [
                { name: 'Revenue', data: rev },
                { name: 'Conversions', data: ord },
              ],
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
            revEl.innerHTML = '';
            charts.revenue.render();
          }

          // Activity chart (Clicks / Views / Add to cart)
          if (canAct) {
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
            actEl.innerHTML = '';
            charts.activity.render();
          }
        });
      }

      function rangeLabelForKey(rangeKey) {
        var rk = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
        if (!rk) rk = 'today';
        try {
          if (typeof isCustomRangeKey === 'function' && isCustomRangeKey(rk)) {
            var r = ymdRangeFromRangeKey(rk);
            if (r && r.startYmd && r.endYmd) return formatYmdRangeLabel(r.startYmd, r.endYmd) || 'Selected dates';
          }
          if (typeof isCustomDayRangeKey === 'function' && isCustomDayRangeKey(rk)) {
            var ymd = ymdFromDayKey(rk);
            if (ymd) return formatYmdLabel(ymd) || 'Selected day';
          }
        } catch (_) {}
        try { return getRangeDisplayLabel(rk); } catch (_) {}
        return rk;
      }

      function globalRangeKeyOrToday() {
        try {
          var rk = getStatsRange();
          rk = (rk == null ? '' : String(rk)).trim().toLowerCase();
          return rk || 'today';
        } catch (_) {
          return 'today';
        }
      }

      function syncRangeSelect(key) {
        ensureDom();
        var sel = document.getElementById('product-insights-range');
        if (!sel) return;
        var k = (key == null ? '' : String(key)).trim().toLowerCase();
        if (!k) k = 'today';
        try {
          Array.from(sel.querySelectorAll('option[data-dynamic="1"]')).forEach(function(o) { o.remove(); });
        } catch (_) {}
        var found = false;
        try {
          for (var i = 0; i < sel.options.length; i++) {
            var ov = (sel.options[i] && sel.options[i].value != null) ? String(sel.options[i].value).trim().toLowerCase() : '';
            if (ov === k) { found = true; break; }
          }
        } catch (_) {}
        if (!found) {
          try {
            var opt = document.createElement('option');
            opt.value = k;
            opt.textContent = rangeLabelForKey(k) || k;
            opt.setAttribute('data-dynamic', '1');
            sel.appendChild(opt);
          } catch (_) {}
        }
        try { sel.value = k; } catch (_) {}
      }

      function syncThumbStripArrows() {
        ensureDom();
        var strip = document.getElementById('product-insights-thumbs');
        var leftBtn = document.getElementById('product-insights-thumbs-left');
        var rightBtn = document.getElementById('product-insights-thumbs-right');
        if (!strip || !leftBtn || !rightBtn) return;
        var max = Math.max(0, (strip.scrollWidth || 0) - (strip.clientWidth || 0));
        var hasOverflow = max > 6;
        leftBtn.style.display = hasOverflow ? 'inline-flex' : 'none';
        rightBtn.style.display = hasOverflow ? 'inline-flex' : 'none';
        leftBtn.disabled = !hasOverflow || (strip.scrollLeft || 0) <= 1;
        rightBtn.disabled = !hasOverflow || (strip.scrollLeft || 0) >= (max - 1);
      }

      function isDesktopModalLayout() {
        try { return !!(window.matchMedia && window.matchMedia('(min-width: 992px)').matches); } catch (_) { return false; }
      }

      function isVisibleEl(el) {
        if (!el) return false;
        if (!el.offsetParent) return false;
        if ((el.clientWidth || 0) < 8 || (el.clientHeight || 0) < 8) return false;
        return true;
      }

      function unionHeightOfCards(cards) {
        var top = null;
        var bottom = null;
        (cards || []).forEach(function(card) {
          if (!card || !card.getBoundingClientRect) return;
          if (!isVisibleEl(card)) return;
          var r = card.getBoundingClientRect();
          if (top == null || r.top < top) top = r.top;
          if (bottom == null || r.bottom > bottom) bottom = r.bottom;
        });
        if (top == null || bottom == null) return 0;
        return Math.max(0, bottom - top);
      }

      function syncMainImageBalance() {
        ensureDom();
        var wrap = modalEl ? modalEl.querySelector('.product-insights-main-img-wrap') : null;
        if (!wrap) return;

        if (!isDesktopModalLayout()) {
          wrap.style.height = '';
          return;
        }

        var colLeft = document.getElementById('product-insights-col-left');
        var colRight = document.getElementById('product-insights-col-right');
        if (!colLeft || !colRight) {
          wrap.style.height = '';
          return;
        }

        // If charts are expanded, let the gallery be its natural size (square).
        var revCard = colLeft.querySelector('[data-collapse-id="product-insights-revenue"]');
        var demCard = colLeft.querySelector('[data-collapse-id="product-insights-demand"]');
        var hasExpandedCharts =
          (revCard && !revCard.classList.contains('kexo-card-collapsed')) ||
          (demCard && !demCard.classList.contains('kexo-card-collapsed'));
        if (hasExpandedCharts) {
          wrap.style.height = '';
          return;
        }

        var leftCards = Array.from(colLeft.querySelectorAll(':scope > .card'));
        var rightCards = Array.from(colRight.querySelectorAll(':scope > .card'));
        if (!leftCards.length || !rightCards.length) {
          wrap.style.height = '';
          return;
        }

        var leftHeight = unionHeightOfCards(leftCards);
        var rightHeight = unionHeightOfCards(rightCards);
        if (!leftHeight || !rightHeight) {
          wrap.style.height = '';
          return;
        }

        var wrapRect = wrap.getBoundingClientRect();
        var wrapH = wrapRect.height || 0;
        var wrapW = wrapRect.width || 0;
        if (!wrapH || !wrapW) {
          wrap.style.height = '';
          return;
        }

        var fixedLeft = leftHeight - wrapH;
        if (!isFinite(fixedLeft)) fixedLeft = 0;
        var naturalSquare = wrapW; // default via aspect-ratio: 1/1

        // Target = right content height, but clamp so the image doesn't exceed a square.
        var target = rightHeight - fixedLeft;
        var minH = Math.max(220, Math.round(naturalSquare * 0.6));
        if (!isFinite(target)) target = naturalSquare;
        target = Math.max(minH, Math.min(naturalSquare, target));

        // If we're basically square, clear the override.
        if (Math.abs(target - naturalSquare) < 10) {
          wrap.style.height = '';
          return;
        }

        wrap.style.height = String(Math.round(target)) + 'px';
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
          if (/[?&]width=\d+/i.test(raw)) return raw.replace(/([?&]width=)(\d+)/i, '$1' + String(w));
          return raw;
        }
      }

      function setMainImg(imgEl, rawUrl, alt) {
        if (!imgEl) return;
        var u = rawUrl != null ? String(rawUrl).trim() : '';
        imgEl.alt = alt || '';
        if (!u) {
          imgEl.removeAttribute('src');
          imgEl.removeAttribute('srcset');
          imgEl.removeAttribute('sizes');
          imgEl.style.opacity = '0.35';
          return;
        }

        var widths = [360, 540, 720, 900, 1100, 1400];
        imgEl.src = urlWithWidth(u, 900) || u;
        imgEl.srcset = widths.map(function(w) {
          var uu = urlWithWidth(u, w) || u;
          return uu + ' ' + String(w) + 'w';
        }).join(', ');
        imgEl.sizes = '(min-width: 992px) 480px, 92vw';
        imgEl.style.opacity = '1';
      }

      function scrollThumbStrip(dir) {
        ensureDom();
        var strip = document.getElementById('product-insights-thumbs');
        if (!strip) return;
        var step = Math.max(120, Math.round((strip.clientWidth || 0) * 0.85));
        if (!step) step = 160;
        try {
          strip.scrollBy({ left: (dir < 0 ? -step : step), behavior: 'smooth' });
        } catch (_) {
          strip.scrollLeft = (strip.scrollLeft || 0) + (dir < 0 ? -step : step);
        }
        setTimeout(function() { syncThumbStripArrows(); }, 140);
      }

      function render(payload) {
        lastPayload = payload || null;
        var status = document.getElementById('product-insights-status');
        var body = document.getElementById('product-insights-body');
        if (status) status.style.display = 'none';
        if (body) body.style.display = 'block';

        var titleEl = document.getElementById('product-insights-title');
        var detailsTitleEl = document.getElementById('product-insights-details-title');
        var openLink = document.getElementById('product-insights-open-store');
        var adminLink = document.getElementById('product-insights-open-admin');
        var mainImg = document.getElementById('product-insights-main-img');
        var thumbsEl = document.getElementById('product-insights-thumbs');
        var topCountriesCard = document.getElementById('product-insights-top-countries-card');
        var topCountriesEl = document.getElementById('product-insights-top-countries');

        var prod = payload && payload.product ? payload.product : null;
        var metrics = payload && payload.metrics ? payload.metrics : {};
        var details = payload && payload.details ? payload.details : {};
        var isPage = payload && payload.kind === 'page';
        var page = payload && payload.page ? payload.page : null;

        var title = isPage
          ? (page && page.path ? page.path : (currentPageUrl || 'Page'))
          : ((prod && prod.title) ? String(prod.title) : (currentTitle || currentHandle || 'Product'));
        if (titleEl) titleEl.textContent = title;
        if (detailsTitleEl) detailsTitleEl.textContent = isPage ? 'Page details' : 'Product details';
        var rk = (payload && payload.rangeKey) ? String(payload.rangeKey) : currentRangeKey;
        syncRangeSelect(rk);

        if (openLink) {
          var href = isPage ? (currentPageUrl || '#') : (currentProductUrl || '#');
          openLink.href = href;
          openLink.style.display = href && href !== '#' ? 'inline-flex' : 'none';
          openLink.textContent = isPage ? 'View page' : 'View on Website';
        }
        if (adminLink) {
          var adminHref = (!isPage && payload && payload.links && payload.links.adminProductUrl)
            ? String(payload.links.adminProductUrl)
            : '';
          adminLink.href = adminHref || '#';
          adminLink.style.display = adminHref && adminHref !== '#' ? 'inline-flex' : 'none';
          adminLink.textContent = 'Edit on Shopify';
        }

        // Images
        var images = (!isPage && prod && Array.isArray(prod.images)) ? prod.images : [];
        var first = images && images[0] ? images[0] : null;
        if (mainImg) {
          if (isPage) {
            var u = currentPageUrl || (page && page.url ? String(page.url) : '');
            var src = u ? ((API || '') + '/api/og-thumb?url=' + encodeURIComponent(u) + '&width=1000') : '';
            setMainImg(mainImg, src, title);
          } else {
            setMainImg(mainImg, (first && first.url) ? String(first.url) : '', title);
          }
        }
        if (thumbsEl) {
          thumbsEl.innerHTML = isPage ? '' : (images || []).slice(0, 20).map(function(img, i) {
            var u = img && img.url ? String(img.url) : '';
            var t = img && img.thumb ? String(img.thumb) : u;
            if (!u) return '';
            return '<button type="button" class="product-insights-thumb' + (i === 0 ? ' active' : '') + '" data-img="' + escapeHtml(u) + '" aria-label="Image ' + (i + 1) + '">' +
              '<img src="' + escapeHtml(t) + '" alt="" loading="lazy">' +
            '</button>';
          }).join('');
          try { thumbsEl.scrollLeft = 0; } catch (_) {}
          syncThumbStripArrows();

          thumbsEl.querySelectorAll('[data-img]').forEach(function(a) {
            a.addEventListener('click', function(e) {
              e.preventDefault();
              var u = a.getAttribute('data-img') || '';
              if (!u || !mainImg) return;
              thumbsEl.querySelectorAll('.product-insights-thumb').forEach(function(x) { x.classList.remove('active'); });
              a.classList.add('active');
              setMainImg(mainImg, u, title);
            });
          });
        }

        // Metrics table
        var mt = document.getElementById('product-insights-metrics-table');
        if (mt) {
          function row(label, value) {
            return '<tr><td>' + escapeHtml(label) + '</td><td class="w-1 fw-bold text-end">' + escapeHtml(value) + '</td></tr>';
          }
          if (isPage) {
            var sessions = metrics && metrics.sessions != null ? fmtNum(metrics.sessions) : '\u2014';
            var pageViews = metrics && metrics.pageViews != null ? fmtNum(metrics.pageViews) : '\u2014';
            var purchasedSessions = metrics && metrics.purchasedSessions != null ? fmtNum(metrics.purchasedSessions) : '\u2014';
            var checkoutStartedSessions = metrics && metrics.checkoutStartedSessions != null ? fmtNum(metrics.checkoutStartedSessions) : '\u2014';
            var revenue2 = metrics && metrics.revenueGbp != null ? fmtMoneyGbp(metrics.revenueGbp) : '\u2014';
            var cr2 = metrics && metrics.cr != null ? fmtPct(metrics.cr) : '\u2014';
            var rps = metrics && metrics.revPerSession != null ? fmtMoneyGbp(metrics.revPerSession) : '\u2014';
            mt.innerHTML =
              row('Revenue', revenue2) +
              row('Purchased sessions', purchasedSessions) +
              row('Checkout started sessions', checkoutStartedSessions) +
              row('Sessions', sessions) +
              row('Page views', pageViews) +
              row('Purchase rate', cr2) +
              row('Revenue / Session', rps);
          } else {
            var revenue = metrics && metrics.revenueGbp != null ? fmtMoneyGbp(metrics.revenueGbp) : '\u2014';
            var units = metrics && metrics.units != null ? fmtNum(metrics.units) : '\u2014';
            var views = metrics && metrics.views != null ? fmtNum(metrics.views) : '\u2014';
            var atc = metrics && metrics.addToCart != null ? fmtNum(metrics.addToCart) : '\u2014';
            var cs = metrics && metrics.checkoutStarted != null ? fmtNum(metrics.checkoutStarted) : '\u2014';
            var atcRate = metrics && metrics.atcRate != null ? fmtPct(metrics.atcRate) : '\u2014';
            var clicks = metrics && metrics.clicks != null ? fmtNum(metrics.clicks) : '\u2014';
            var conv = metrics && metrics.orders != null ? fmtNum(metrics.orders) : '\u2014';
            var cr = metrics && metrics.cr != null ? fmtPct(metrics.cr) : '\u2014';
            var rpc = metrics && metrics.revPerClick != null ? fmtMoneyGbp(metrics.revPerClick) : '\u2014';
            var rpv = metrics && metrics.revPerView != null ? fmtMoneyGbp(metrics.revPerView) : '\u2014';
            var totalSales = details && details.totalSalesLifetime != null ? fmtNum(details.totalSalesLifetime) : '\u2014';
            var totalRev = details && details.totalRevenueLifetimeGbp != null ? fmtMoneyGbp(details.totalRevenueLifetimeGbp) : '\u2014';
            var cogs = details && details.costOfGoodsLifetimeGbp != null ? fmtMoneyGbp(details.costOfGoodsLifetimeGbp) : '\u2014';
            var stockUnits = details && details.inventoryUnits != null ? fmtNum(details.inventoryUnits) : '\u2014';
            var stockVariants = details && details.inStockVariants != null ? fmtNum(details.inStockVariants) : '\u2014';
            mt.innerHTML =
              row('Clicks', clicks) +
              row('Conversions', conv) +
              row('Conversion rate', cr) +
              row('Revenue (selected range)', revenue) +
              row('Units sold (selected range)', units) +
              row('Views (pixel)', views) +
              row('Add to cart', atc) +
              row('Checkout started', cs) +
              row('View to Cart rate', atcRate) +
              row('Revenue / Click', rpc) +
              row('Revenue / View', rpv) +
              row('In stock (units)', stockUnits) +
              row('In-stock variants', stockVariants) +
              row('Total sales (lifetime)', totalSales) +
              row('Total revenue (lifetime)', totalRev) +
              row('Cost of goods (lifetime)', cogs);
          }
        }

        if (topCountriesCard && topCountriesEl) {
          var top = (!isPage && payload && Array.isArray(payload.topCountries)) ? payload.topCountries : [];
          if (top && top.length) {
            topCountriesCard.style.display = '';
            topCountriesEl.innerHTML = top.slice(0, 5).map(function(r) {
              var iso = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
              if (iso === 'UK') iso = 'GB';
              var name = countryLabel(iso);
              var flag = flagImg(iso, name);
              var conv = (r && r.orders != null) ? (Number(r.orders) || 0) : 0;
              var rev = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
              var revText = (rev != null && isFinite(rev)) ? fmtMoneyGbp(rev) : '\u2014';
              return '' +
                '<div class="d-flex align-items-center justify-content-between">' +
                  '<div class="d-flex align-items-center gap-2 min-w-0">' +
                    flag +
                    '<span class="text-truncate">' + escapeHtml(name) + '</span>' +
                  '</div>' +
                  '<div class="text-end">' +
                    '<div class="fw-semibold" style="font-size:.875rem">' + escapeHtml(fmtNum(conv)) + ' conversions</div>' +
                    '<div class="text-muted small">' + escapeHtml(revText) + '</div>' +
                  '</div>' +
                '</div>';
            }).join('');
          } else {
            topCountriesCard.style.display = 'none';
            topCountriesEl.innerHTML = '';
          }
        }

        syncMainImageBalance();
        renderCharts(payload);
      }

      function load() {
        ensureDom();
        setStatus('Loading\u2026');

        var shop = null;
        try { shop = getShopParam() || shopForSalesFallback || null; } catch (_) { shop = null; }
        var url = '';
        if (currentMode === 'page') {
          if (!currentPageUrl) { setStatus('No page selected.'); return; }
          url = (API || '') + '/api/page-insights?url=' + encodeURIComponent(currentPageUrl) +
            '&kind=' + encodeURIComponent(currentLandingKind || 'entry') +
            '&range=' + encodeURIComponent(currentRangeKey || 'today') +
            '&_=' + Date.now();
        } else {
          if (!currentHandle && !currentProductId) { setStatus('No product selected.'); return; }
          var q = 'range=' + encodeURIComponent(currentRangeKey || 'today') + (shop ? ('&shop=' + encodeURIComponent(shop)) : '') + '&_=' + Date.now();
          if (currentHandle) {
            url = (API || '') + '/api/product-insights?handle=' + encodeURIComponent(currentHandle) + '&' + q;
          } else {
            url = (API || '') + '/api/product-insights?product_id=' + encodeURIComponent(currentProductId) + '&' + q;
          }
        }

        fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 30000)
          .then(function(r) { return r && r.ok ? r.json() : null; })
          .then(function(data) {
            if (!data || !data.ok) {
              setStatus(currentMode === 'page' ? 'No data available for this page.' : 'No data available for this product.');
              return;
            }
            render(data);
          })
          .catch(function() { setStatus(currentMode === 'page' ? 'Could not load page insights.' : 'Could not load product insights.'); });
      }

      function openProduct(handleOrProductId, options) {
        options = options || {};
        var raw = String(handleOrProductId || '').trim();
        var pid = options.productId ? String(options.productId).trim() : '';
        if (!pid && /^\d+$/.test(raw)) pid = raw;
        if (!pid && /gid:\/\/shopify\/Product\/(\d+)/i.test(raw)) pid = raw.replace(/gid:\/\/shopify\/Product\/(\d+)/i, '$1');
        var h = pid ? null : normalizeHandle(handleOrProductId);
        if (!h && !pid) return;
        currentHandle = h || null;
        currentProductId = pid || null;
        currentMode = 'product';
        currentPageUrl = null;
        currentTitle = options.title ? String(options.title) : null;
        currentProductUrl = options.productUrl ? String(options.productUrl) : null;
        currentLandingKind = options.landingKind ? String(options.landingKind) : null;
        currentRangeKey = globalRangeKeyOrToday();
        ensureDom();
        syncRangeSelect(currentRangeKey);
        show();
        load();
      }

      function openPage(url, options) {
        var u = url != null ? String(url).trim() : '';
        if (!u) return;
        currentMode = 'page';
        currentPageUrl = u;
        currentHandle = null;
        currentProductId = null;
        options = options || {};
        currentTitle = options.title ? String(options.title) : null;
        currentProductUrl = null;
        currentLandingKind = options.landingKind ? String(options.landingKind) : null;
        currentRangeKey = globalRangeKeyOrToday();
        ensureDom();
        syncRangeSelect(currentRangeKey);
        show();
        load();
      }

      // Delegate clicks from product links (tables, breakdowns, etc.)
      document.addEventListener('click', function(e) {
        var a = e && e.target && e.target.closest ? e.target.closest('a.js-product-modal-link') : null;
        if (!a) return;
        if (isModifiedClick(e)) return;
        var h = normalizeHandle(a.getAttribute('data-product-handle') || '');
        if (!h) h = parseHandleFromHref(a.getAttribute('href') || '');
        var pid = (a.getAttribute('data-product-id') || '').trim();
        if (!h && !pid) return;
        e.preventDefault();
        openProduct(h || pid, {
          title: a.getAttribute('data-product-title') || '',
          productUrl: a.getAttribute('href') || '',
          productId: pid || undefined,
        });
      });

      // Expose for debugging / future use
      window.__openProductInsights = openProduct;
    })();

