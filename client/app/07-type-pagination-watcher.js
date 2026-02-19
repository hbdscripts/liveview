      function schedule() {
        if (activeMainTab !== 'products') return;
        if (!leaderboardCache && !leaderboardLoading) return;
        if (typeof requestAnimationFrame !== 'function') {
          renderProductsLeaderboard(leaderboardCache);
          return;
        }
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(function() {
          raf = null;
          if (activeMainTab !== 'products') return;
          renderProductsLeaderboard(leaderboardCache);
        });
      }
      try { window.addEventListener('resize', schedule); } catch (_) {}
    })();

    function fetchFinishes(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        finishesLoading = false;
        finishesCache = null;
        if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null);
        return Promise.resolve(null);
      }
      finishesLoading = true;
      if (!finishesCache && normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null);
      let url = API + '/api/shopify-finishes?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          finishesCache = data;
          if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(data);
          return data;
        })
        .catch(function() { finishesCache = null; finishesLoading = false; if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'finishes') renderFinishes(null); return null; })
        .finally(function() { finishesLoading = false; });
    }

    function fetchLengths(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        lengthsLoading = false;
        lengthsCache = null;
        if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null);
        return Promise.resolve(null);
      }
      lengthsLoading = true;
      if (!lengthsCache && normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null);
      let url = API + '/api/shopify-lengths?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          lengthsCache = data;
          if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(data);
          return data;
        })
        .catch(function() { lengthsCache = null; lengthsLoading = false; if (normalizeProductsVariantCardsView(productsVariantCardsView) === 'lengths') renderLengths(null); return null; })
        .finally(function() { lengthsLoading = false; });
    }

    function fetchChainStyles(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        chainStylesLoading = false;
        chainStylesCache = null;
        return Promise.resolve(null);
      }
      chainStylesLoading = true;
      let url = API + '/api/shopify-chain-styles?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          chainStylesCache = data;
          chainStylesLoading = false;
          return data;
        })
        .catch(function() { chainStylesCache = null; chainStylesLoading = false; return null; })
        .finally(function() { chainStylesLoading = false; });
    }

    function fetchBestVariants(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        bestVariantsCache = null;
        renderBestVariants(null);
        return Promise.resolve(null);
      }
      var pageSize = getTableRowsPerPage('best-variants-table', 'product');
      let url = API + '/api/shopify-best-variants?shop=' + encodeURIComponent(shop) +
          '&range=' + encodeURIComponent(getStatsRange()) +
          '&page=' + encodeURIComponent(String(bestVariantsPage || 1)) +
          '&pageSize=' + encodeURIComponent(String(pageSize));
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.json().then(function(data) { return { ok: r.ok, status: r.status, data: data || {} }; }).catch(function() { return { ok: r.ok, status: r.status, data: {} }; }); })
        .then(function(result) {
          if (result.ok) {
            bestVariantsCache = result.data;
            renderBestVariants(result.data);
            return result.data;
          }
          var msg = (result.data && result.data.error) ? result.data.error : ('Error ' + result.status);
          if (result.data && result.data.hint) msg += '. ' + result.data.hint;
          bestVariantsCache = null;
          renderBestVariants(null, msg);
          return null;
        })
        .catch(function() { bestVariantsCache = null; renderBestVariants(null); return null; });
    }

    function renderBestVariants(data, errorMessage) {
      const tbody = document.getElementById('best-variants-body');
      if (!tbody) return;
      if (!data || !Array.isArray(data.bestVariants)) {
        setHiddenById('stats-best-variants', false);
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (errorMessage ? escapeHtml(errorMessage) : 'No shop or no data') + '</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-variants-table'), tableSortState.bestVariants.by, tableSortState.bestVariants.dir);
        updateCardPagination('best-variants', 1, 1);
        return;
      }
      const rows = data.bestVariants.slice();
      var hasSessions = false;
      for (var i = 0; i < rows.length; i++) {
        if ((Number(rows[i] && rows[i].clicks) || 0) > 0) { hasSessions = true; break; }
      }
      setHiddenById('stats-best-variants', !hasSessions);
      if (!hasSessions) {
        tbody.innerHTML = '';
        updateCardPagination('best-variants', 1, 1);
        return;
      }
      const bvBy = (tableSortState.bestVariants.by || 'rev').toString().trim().toLowerCase();
      const bvDir = (tableSortState.bestVariants.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function displayVariantName(v) {
        const variantName = (v && v.variant_title && String(v.variant_title).trim()) ? String(v.variant_title).trim() : 'Default';
        const productName = (v && v.title && String(v.title).trim()) ? String(v.title).trim() : '';
        return variantName + (productName ? (' \u2014 ' + productName) : '');
      }
      rows.sort(function(a, b) {
        var primary = 0;
        if (bvBy === 'variant') primary = cmpNullableText(displayVariantName(a), displayVariantName(b), bvDir);
        else if (bvBy === 'sales') primary = cmpNullableNumber(a && a.orders, b && b.orders, bvDir);
        else if (bvBy === 'clicks') primary = cmpNullableNumber(a && a.clicks, b && b.clicks, bvDir);
        else if (bvBy === 'rev') primary = cmpNullableNumber(a && a.revenue, b && b.revenue, bvDir);
        else if (bvBy === 'vpv') primary = cmpNullableNumber(vpvFromRow(a), vpvFromRow(b), bvDir);
        else if (bvBy === 'cr') {
          primary = cmpNullableNumber(a && a.cr, b && b.cr, bvDir) ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc');
        }
        function vpvFromRow(r) {
          if (r && typeof r.vpv === 'number' && Number.isFinite(r.vpv)) return r.vpv;
          var rev = r && typeof r.revenue === 'number' ? r.revenue : null;
          var sess = r && (typeof r.clicks === 'number' || typeof r.sessions === 'number') ? (r.clicks != null ? r.clicks : r.sessions) : null;
          return (sess != null && sess > 0 && rev != null) ? (rev / sess) : null;
        }
        return primary ||
          cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc') ||
          cmpNullableNumber(a && a.orders, b && b.orders, 'desc') ||
          cmpNullableText(displayVariantName(a), displayVariantName(b), 'asc');
      });
      const pageSize = (data && typeof data.pageSize === 'number' && data.pageSize > 0)
        ? data.pageSize
        : getTableRowsPerPage('best-variants-table', 'product');
      const totalCount = (data && typeof data.totalCount === 'number' && data.totalCount >= 0) ? data.totalCount : rows.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      bestVariantsPage = clampPage((data && typeof data.page === 'number') ? data.page : bestVariantsPage, totalPages);
      updateCardPagination('best-variants', bestVariantsPage, totalPages);
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No orders in this range</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-variants-table'), bvBy, bvDir);
        return;
      }
      tbody.innerHTML = rows.map(function(v) {
        const mainBase = getMainBaseUrl();
        const handle = (v && v.handle) ? String(v.handle).trim().toLowerCase() : '';
        const productId = (v && v.product_id) ? String(v.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(String(handle))) : '#';
        const title = (v && v.title) ? String(v.title).trim() : '';

        const nameText = displayVariantName(v);
        const canOpen = handle || (productId && /^\d+$/.test(productId));
        const nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(nameText) + '</a>'
            )
          : escapeHtml(nameText);
        const name = '<span class="bs-name" title="' + escapeHtml(nameText) + '">' + nameInner + '</span>';

        const ordersNum = (v && typeof v.orders === 'number') ? v.orders : (v && v.orders != null ? Number(v.orders) : 0);
        const orders = formatSessions(Number(ordersNum) || 0);
        const clicks = (v && typeof v.clicks === 'number') ? formatSessions(v.clicks) : '\u2014';
        const revenue = formatRevenueTableHtml(v && v.revenue != null ? v.revenue : null);
        const crVal = (v && typeof v.cr === 'number') ? v.cr : null;
        const cr = crVal != null ? pct(crVal) : '\u2014';
        const vpvNum = (v && typeof v.vpv === 'number' && Number.isFinite(v.vpv)) ? v.vpv : ((v && v.clicks > 0 && v.revenue != null) ? (v.revenue / v.clicks) : null);
        const vpv = vpvNum != null ? formatRevenue(vpvNum) : '\u2014';

        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + orders + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
          '<div class="grid-cell" role="cell">' + vpv + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('best-variants-table'), bvBy, bvDir);
    }

    function normalizeChartType(value, fallback) {
      const v = String(value == null ? '' : value).trim().toLowerCase();
      if (v === 'multi-line-labels') return 'line';
      if (v === 'donut') return 'pie';
      if (v === 'radialbar' || v === 'radial-bar') return 'radialbar';
      if (v === 'area' || v === 'bar' || v === 'line' || v === 'pie') return v;
      return normalizeChartType(fallback, 'area');
    }

    // Chart-type switchers were removed theme-wide; keep this helper as a
    // compatibility shim so existing render paths can still pick defaults.
    function ensureChartTypeControls(_chartId, _scope, fallbackType) {
      return normalizeChartType(fallbackType, 'area');
    }

    let productsChartInstance = null;
    let productsChartData = null;

    function ensureThumbWidthParam(url, width) {
      const raw = url != null ? String(url).trim() : '';
      if (!raw) return '';
      const targetWidth = Math.max(32, Number(width) || 100);
      if (/^data:/i.test(raw)) return raw;
      if (/[?&]width=\d+/i.test(raw)) return raw;
      try {
        const u = new URL(raw, window.location.origin);
        if (!u.searchParams.has('width')) u.searchParams.set('width', String(targetWidth));
        return u.toString();
      } catch (_) {
        const joiner = raw.indexOf('?') === -1 ? '?' : '&';
        return raw + joiner + 'width=' + targetWidth;
      }
    }

    function renderProductsChart(data) {
      const el = document.getElementById('products-chart');
      if (!el) return;

      if (typeof ApexCharts === 'undefined') {
        // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
        const tries = (el.__kexoApexWaitTries || 0) + 1;
        el.__kexoApexWaitTries = tries;
        if (tries >= 25) {
          el.__kexoApexWaitTries = 0;
          captureChartMessage('Chart library failed to load.', 'productsChartLibraryLoad', { chartKey: 'products-chart', tries: tries }, 'error');
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);text-align:center;padding:0 18px;font-size:.875rem">Chart library failed to load.</div>';
          return;
        }
        setTimeout(function() { renderProductsChart(data); }, 200);
        return;
      }
      try { el.__kexoApexWaitTries = 0; } catch (_) {}
      var chartKey = 'products-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (productsChartInstance) { try { productsChartInstance.destroy(); } catch (_) {} productsChartInstance = null; }
        el.innerHTML = '';
        return;
      }

      if (productsChartInstance) {
        productsChartInstance.destroy();
        productsChartInstance = null;
      }

      if (data) productsChartData = data;
      var d = productsChartData;

      if (!d || !Array.isArray(d.bestSellers) || d.bestSellers.length === 0) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);font-size:.875rem">No product data available</div>';
        return;
      }

      const products = d.bestSellers.slice().sort(function(a, b) {
        return (b.revenue || 0) - (a.revenue || 0);
      }).slice(0, 10);

      if (!products.length) {
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:var(--tblr-secondary);font-size:.875rem">No product data available</div>';
        return;
      }

      const mainBase = getMainBaseUrl();
      const chartRows = products.map(function (p) {
        const handle = (p && p.handle != null) ? String(p.handle).trim() : '';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '';
        const srcRaw = (p && p.thumb_url) ? (hotImgSquare(String(p.thumb_url)) || String(p.thumb_url)) : '';
        const ogThumb = productUrl ? ((API || '') + '/api/og-thumb?url=' + encodeURIComponent(productUrl) + '&width=100') : '';
        const thumb = ensureThumbWidthParam(srcRaw || ogThumb || '', 100);
        const titleRaw = (p && p.title != null) ? String(p.title).trim() : '';
        const title = titleRaw || 'Unknown Product';
        return {
          title: title,
          titleShort: title.length > 38 ? (title.slice(0, 35) + '...') : title,
          revenue: Number((p && p.revenue) || 0),
          thumb: thumb,
          productUrl: productUrl,
        };
      });

      const chartHeight = Math.max(280, chartRows.length * 30);
      var thumbsHtml = chartRows.map(function(row) {
        var thumb = row.thumb ? ('<img src="' + escapeHtml(row.thumb) + '" alt="" class="products-chart-thumb-img" loading="lazy">') : '<span class="products-chart-thumb-placeholder"></span>';
        return '<div class="products-chart-thumb" title="' + escapeHtml(row.title) + '">' + thumb + '</div>';
      }).join('');
      el.innerHTML = '<div class="products-chart-plot" id="products-chart-plot"></div>' +
        '<div class="products-chart-thumbs" id="products-chart-thumbs" aria-label="Product thumbnails">' + thumbsHtml + '</div>';
      const plotEl = document.getElementById('products-chart-plot');
      if (!plotEl) return;
      const categories = chartRows.map(function(row) { return row.titleShort; });

      var rawMode = chartModeFromUiConfig(chartKey, 'line') || 'line';
      var showEndLabels = rawMode === 'multi-line-labels';
      var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      var palette = chartColorsFromUiConfig(chartKey, ['#3eb3ab']);

      if (mode === 'pie') {
        try {
          var productsPieOpts = {
            chart: {
              type: 'pie',
              height: Math.max(300, chartHeight),
              fontFamily: 'Inter, sans-serif',
              toolbar: { show: false },
            },
            series: chartRows.map(function (row) { return row.revenue; }),
            labels: categories,
            colors: palette,
            dataLabels: { enabled: true, formatter: function(pct) { return (typeof pct === 'number' && isFinite(pct)) ? (pct.toFixed(0) + '%') : ''; } },
            tooltip: {
              custom: function(ctx) {
                var idx = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                var row = idx >= 0 && idx < chartRows.length ? chartRows[idx] : null;
                if (!row) return '';
                var thumb = row.thumb
                  ? ('<img src="' + escapeHtml(row.thumb) + '" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid rgba(15,23,42,.08);margin-right:8px;">')
                  : '';
                return '<div style="padding:8px 10px;min-width:170px;">' +
                  '<div style="display:flex;align-items:center;margin-bottom:4px;">' + thumb +
                    '<div style="font-weight:600;font-size:12px;line-height:1.2;">' + escapeHtml(row.title) + '</div>' +
                  '</div>' +
                  '<div style="font-size:12px;color:#475569;">Revenue: <strong style="color:#0f172a;">' + escapeHtml(formatRevenue(row.revenue) || '\u2014') + '</strong></div>' +
                '</div>';
              }
            },
            legend: { position: 'bottom', fontSize: '12px' },
          };
          try {
            var productsPieOverride = chartAdvancedOverrideFromUiConfig(chartKey, 'pie');
            if (productsPieOverride && isPlainObject(productsPieOverride)) {
              productsPieOpts = deepMergeOptions(productsPieOpts, productsPieOverride);
            }
          } catch (_) {}
          productsChartInstance = new ApexCharts(plotEl, productsPieOpts);
          var pieRender = productsChartInstance.render();
          if (pieRender && typeof pieRender.then === 'function') {
            pieRender.catch(function (err) {
              captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: 'pie' });
            });
          }
        } catch (err) {
          captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: 'pie' });
          el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
        }
        return;
      }

      var chartType = normalizeChartType(mode, 'line');
      try {
        var productsOpts = {
          chart: {
            type: chartType,
            height: chartHeight,
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: false },
          },
          series: [{
            name: 'Revenue',
            data: chartRows.map(function (row) { return row.revenue; })
          }],
          colors: palette,
          stroke: { show: true, width: chartType === 'bar' ? 0 : 3, curve: 'smooth', lineCap: 'round' },
          markers: { size: chartType === 'line' ? 4 : 0, hover: { size: 6 } },
          fill: chartType === 'bar'
            ? { type: 'solid', opacity: 1 }
            : { type: 'gradient', gradient: { opacityFrom: 0.38, opacityTo: 0.08, stops: [0, 100] } },
          plotOptions: chartType === 'bar' ? { bar: { columnWidth: '56%', borderRadius: 3 } } : {},
          dataLabels: (showEndLabels && chartType === 'line') ? {
            enabled: true,
            formatter: function(val, ctx) {
              try {
                var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
                var w = ctx && ctx.w ? ctx.w : null;
                var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
                if (dp !== last) return '';
              } catch (_) { return ''; }
              return formatRevenue(Number(val)) || '\u2014';
            },
            style: { fontSize: '10px' },
            background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
            offsetY: -3,
          } : { enabled: false },
          xaxis: {
            categories: categories,
            labels: {
              style: { fontSize: '11px' },
              rotate: -18,
              trim: true,
              hideOverlappingLabels: true,
              formatter: function() { return ''; }
            }
          },
          yaxis: {
            min: 0,
            forceNiceScale: true,
            labels: {
              style: { fontSize: '11px' },
              formatter: function(value) { return formatRevenue(Number(value)) || '\u2014'; }
            }
          },
          tooltip: {
            custom: function(ctx) {
              var idx = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
              var row = idx >= 0 && idx < chartRows.length ? chartRows[idx] : null;
              if (!row) return '';
              var thumb = row.thumb
                ? ('<img src="' + escapeHtml(row.thumb) + '" alt="" style="width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid rgba(15,23,42,.08);margin-right:8px;">')
                : '';
              return '<div style="padding:8px 10px;min-width:170px;">' +
                '<div style="display:flex;align-items:center;margin-bottom:4px;">' + thumb +
                  '<div style="font-weight:600;font-size:12px;line-height:1.2;">' + escapeHtml(row.title) + '</div>' +
                '</div>' +
                '<div style="font-size:12px;color:#475569;">Revenue: <strong style="color:#0f172a;">' + escapeHtml(formatRevenue(row.revenue) || '\u2014') + '</strong></div>' +
              '</div>';
            }
          },
          grid: {
            borderColor: '#eef2f6',
            strokeDashArray: 3,
            padding: { left: 4, right: 8, top: 8, bottom: 8 }
          }
        };
        try {
          var productsOverride = chartAdvancedOverrideFromUiConfig(chartKey, chartType);
          if (productsOverride && isPlainObject(productsOverride)) {
            productsOpts = deepMergeOptions(productsOpts, productsOverride);
          }
        } catch (_) {}
        productsChartInstance = new ApexCharts(plotEl, productsOpts);
        var productsRender = productsChartInstance.render();
        if (productsRender && typeof productsRender.then === 'function') {
          productsRender.catch(function (err) {
            captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: chartType });
          });
        }
      } catch (err) {
        captureChartError(err, 'productsChartRender', { chartKey: 'products-chart', mode: chartType });
        el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:280px;color:#ef4444;font-size:.875rem">Chart rendering failed</div>';
      }
    }

    function renderBestSellers(data, errorMessage) {
      const tbody = document.getElementById('best-sellers-body');
      if (!tbody) return;
      if (!data || !Array.isArray(data.bestSellers)) {
        setHiddenById('stats-best-sellers', false);
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (errorMessage ? escapeHtml(errorMessage) : 'No shop or no data') + '</div></div>';
        updateBestSellersSortHeaders();
        updateCardPagination('best-sellers', 1, 1);
        return;
      }
      const rows = data.bestSellers.slice();
      var hasSessions = false;
      for (var i = 0; i < rows.length; i++) {
        if ((Number(rows[i] && rows[i].clicks) || 0) > 0) { hasSessions = true; break; }
      }
      setHiddenById('stats-best-sellers', !hasSessions);
      if (!hasSessions) {
        tbody.innerHTML = '';
        updateCardPagination('best-sellers', 1, 1);
        return;
      }
      const sortKey = (bestSellersSortBy || 'rev').toString().trim().toLowerCase();
      const sortDir = (bestSellersSortDir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      rows.sort(function(a, b) {
        if (sortKey === 'title') return cmpNullableText(a && a.title, b && b.title, sortDir);
        if (sortKey === 'orders') return cmpNullableNumber(a && a.orders, b && b.orders, sortDir);
        if (sortKey === 'clicks') return cmpNullableNumber(a && a.clicks, b && b.clicks, sortDir);
        if (sortKey === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, sortDir);
        if (sortKey === 'vpv') return cmpNullableNumber(vpvFromRow(a), vpvFromRow(b), sortDir);
        if (sortKey === 'cr') {
          return cmpNullableNumber(a && a.cr, b && b.cr, sortDir) ||
            cmpNullableNumber(a && a.orders, b && b.orders, 'desc');
        }
        return 0;
      });
      function vpvFromRow(r) {
        if (r && typeof r.vpv === 'number' && Number.isFinite(r.vpv)) return r.vpv;
        var rev = r && typeof r.revenue === 'number' ? r.revenue : null;
        var sess = r && (typeof r.clicks === 'number' || typeof r.sessions === 'number') ? (r.clicks != null ? r.clicks : r.sessions) : null;
        return (sess != null && sess > 0 && rev != null) ? (rev / sess) : null;
      }
      const pageSize = (data && typeof data.pageSize === 'number' && data.pageSize > 0)
        ? data.pageSize
        : getTableRowsPerPage('best-sellers-table', 'product');
      const totalCount = (data && typeof data.totalCount === 'number' && data.totalCount >= 0) ? data.totalCount : rows.length;
      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
      bestSellersPage = clampPage((data && typeof data.page === 'number') ? data.page : bestSellersPage, totalPages);
      updateCardPagination('best-sellers', bestSellersPage, totalPages);
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No orders in this range</div></div>';
        updateBestSellersSortHeaders();
        return;
      }
      tbody.innerHTML = rows.map(function(p) {
        const mainBase = getMainBaseUrl();
        const handle = (p && p.handle) ? String(p.handle).trim().toLowerCase() : '';
        const productId = (p && p.product_id) ? String(p.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(String(handle))) : '#';
        const title = (p && p.title) ? String(p.title).trim() : '';
        const canOpen = handle || (productId && /^\d+$/.test(productId));
        const nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title);
        const name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + nameInner + '</span>';
        const orders = String(p.orders != null ? p.orders : 0);
        const clicks = (typeof p.clicks === 'number') ? formatSessions(p.clicks) : '\u2014';
        const revenue = formatRevenueTableHtml(p.revenue);
        const cr = p.cr != null ? pct(p.cr) : '\u2014';
        const vpvNum = vpvFromRow(p);
        const vpv = vpvNum != null ? formatRevenue(vpvNum) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + orders + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
          '<div class="grid-cell" role="cell">' + vpv + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateBestSellersSortHeaders();
    }

    function updateBestSellersSortHeaders() {
      document.querySelectorAll('#best-sellers-wrap .grid-cell.sortable').forEach(function(th) {
        var col = th.getAttribute('data-sort');
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', bestSellersSortBy === col ? (bestSellersSortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (bestSellersSortBy === col) th.classList.add(bestSellersSortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupBestSellersSort() {
      document.querySelectorAll('#best-sellers-wrap .grid-cell.sortable').forEach(function(th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          if (bestSellersSortBy === col) bestSellersSortDir = bestSellersSortDir === 'asc' ? 'desc' : 'asc';
          else { bestSellersSortBy = col; bestSellersSortDir = col === 'title' ? 'asc' : 'desc'; }
          bestSellersPage = 1;
          updateBestSellersSortHeaders();
          fetchBestSellers();
        }
        th.addEventListener('click', function(e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (shouldIgnoreStickyResizeSortClick(e)) return;
          activate();
        });
        th.addEventListener('keydown', function(e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
    }

    function asSortText(v) {
      if (v == null) return '';
      return String(v).trim().toLowerCase();
    }

    function asFiniteNumber(v) {
      const n = (typeof v === 'number') ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function cmpNullableText(a, b, dir) {
      const da = asSortText(a);
      const db = asSortText(b);
      const d = dir === 'asc' ? 'asc' : 'desc';
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      if (da === db) return 0;
      if (d === 'asc') return da < db ? -1 : 1;
      return da < db ? 1 : -1;
    }

    function cmpNullableNumber(a, b, dir) {
      const na = asFiniteNumber(a);
      const nb = asFiniteNumber(b);
      const d = dir === 'asc' ? 'asc' : 'desc';
      if (na == null && nb == null) return 0;
      if (na == null) return 1;
      if (nb == null) return -1;
      if (na === nb) return 0;
      return d === 'asc' ? (na - nb) : (nb - na);
    }

    function updateSortHeadersInContainer(container, sortBy, sortDir) {
      const root = typeof container === 'string' ? document.querySelector(container) : container;
      if (!root) return;
      root.querySelectorAll('.grid-cell.sortable').forEach(function(th) {
        var col = (th.getAttribute('data-sort') || '').trim();
        th.classList.remove('th-sort-asc', 'th-sort-desc');
        th.setAttribute('aria-sort', sortBy === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
        if (sortBy === col) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
      });
    }

    function setupTableSortHeaders(container, state, defaults, onChange) {
      const root = typeof container === 'string' ? document.querySelector(container) : container;
      if (!root || !state) return;
      root.querySelectorAll('.grid-cell.sortable').forEach(function(th) {
        function activate() {
          var col = (th.getAttribute('data-sort') || '').trim();
          if (!col) return;
          var prevCol = state.by;
          if (state.by === col) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
          else { state.by = col; state.dir = (defaults && defaults[col]) ? defaults[col] : 'asc'; }
          state.dir = state.dir === 'asc' ? 'asc' : 'desc';
          updateSortHeadersInContainer(root, state.by, state.dir);
          if (typeof onChange === 'function') onChange({ by: state.by, dir: state.dir, columnChanged: prevCol !== state.by });
        }
        th.addEventListener('click', function(e) {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          if (shouldIgnoreStickyResizeSortClick(e)) return;
          activate();
        });
        th.addEventListener('keydown', function(e) {
          if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          activate();
        });
      });
      state.dir = state.dir === 'asc' ? 'asc' : 'desc';
      updateSortHeadersInContainer(root, state.by, state.dir);
    }

    function setupAllTableSorts() {
      setupTableSortHeaders(document.getElementById('country-table'), tableSortState.country, TABLE_SORT_DEFAULTS.country, function(info) {
        if (info && info.columnChanged) countryPage = 1;
        renderCountry(statsCache);
      });
      setupTableSortHeaders(document.getElementById('best-geo-products-table'), tableSortState.bestGeoProducts, TABLE_SORT_DEFAULTS.bestGeoProducts, function(info) {
        if (info && info.columnChanged) bestGeoProductsPage = 1;
        renderBestGeoProducts(statsCache);
      });
      setupTableSortHeaders(document.getElementById('best-variants-table'), tableSortState.bestVariants, TABLE_SORT_DEFAULTS.bestVariants, function(info) {
        if (info && info.columnChanged) {
          bestVariantsPage = 1;
          fetchBestVariants();
          return;
        }
        if (bestVariantsCache) renderBestVariants(bestVariantsCache);
        else fetchBestVariants();
      });
      setupTableSortHeaders(document.getElementById('attribution-table'), tableSortState.attribution, TABLE_SORT_DEFAULTS.attribution, function(info) {
        if (info && info.columnChanged) attributionPage = 1;
        renderAttributionTables(attributionCache || {});
      });
      setupTableSortHeaders(document.getElementById('devices-table'), tableSortState.devices, TABLE_SORT_DEFAULTS.devices, function(info) {
        if (info && info.columnChanged) devicesPage = 1;
        renderDevicesTables(devicesCache || {});
      });
      setupTableSortHeaders(document.getElementById('browsers-table'), tableSortState.browsers, TABLE_SORT_DEFAULTS.browsers, function(info) {
        if (info && info.columnChanged) browsersPage = 1;
        renderBrowsersTables(browsersCache || {});
      });
    }

    function formatSessions(n) {
      if (n == null || typeof n !== 'number') return '\u2014';
      return n.toLocaleString();
    }

    function clampPage(p, totalPages) {
      const n = typeof p === 'number' ? p : parseInt(String(p), 10);
      if (!Number.isFinite(n)) return 1;
      return Math.min(Math.max(1, n), Math.max(1, totalPages || 1));
    }

    function buildPaginationHtml(page, totalPages) {
      var p = Math.max(1, page);
      var tp = Math.max(1, totalPages);
      var chevL = '<i class="fa-light fa-chevron-left" data-icon-key="pagination-prev"></i>';
      var chevR = '<i class="fa-light fa-chevron-right" data-icon-key="pagination-next"></i>';
      var h = '<ul class="pagination m-0">';
      h += '<li class="page-item' + (p <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p - 1) + '" tabindex="-1" aria-label="Previous">' + chevL + '</a></li>';
      // Build page numbers with ellipsis
      var pages = [];
      if (tp <= 7) {
        for (var i = 1; i <= tp; i++) pages.push(i);
      } else {
        pages.push(1);
        if (p > 3) pages.push('...');
        var start = Math.max(2, p - 1);
        var end = Math.min(tp - 1, p + 1);
        if (p <= 3) { start = 2; end = 4; }
        if (p >= tp - 2) { start = tp - 3; end = tp - 1; }
        for (var i = start; i <= end; i++) pages.push(i);
        if (p < tp - 2) pages.push('...');
        pages.push(tp);
      }
      for (var j = 0; j < pages.length; j++) {
        var pg = pages[j];
        if (pg === '...') {
          h += '<li class="page-item disabled"><span class="page-link">...</span></li>';
        } else {
          h += '<li class="page-item' + (pg === p ? ' active' : '') + '"><a class="page-link" href="#" data-page="' + pg + '">' + pg + '</a></li>';
        }
      }
      h += '<li class="page-item' + (p >= tp ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p + 1) + '" aria-label="Next">' + chevR + '</a></li>';
      h += '</ul>';
      return h;
    }
    try { window.__kexoBuildPaginationHtml = buildPaginationHtml; } catch (_) {}

    function updateCardPagination(prefix, page, totalPages) {
      var wrap = document.getElementById(prefix + '-pagination');
      if (!wrap) return;
      var pages = Math.max(1, totalPages || 1);
      var show = pages > 1;
      wrap.dataset.paginated = show ? '1' : '0';
      wrap.dataset.pages = String(pages);
      wrap.dataset.page = String(page);
      wrap.classList.toggle('is-hidden', !show);
      if (show) wrap.innerHTML = buildPaginationHtml(page, pages);
    }

    function scheduleBreakdownSync() {
      // No-op: layout is handled via CSS grid/flex.
    }

    function renderSales(data) {
      const sales = data.sales || {};
      const salesTodayEl = document.getElementById('sales-today');
      const range = getStatsRange();
      const baseSales = (sales[range] != null ? sales[range] : 0);
      if (salesTodayEl) salesTodayEl.textContent = formatRevenue(baseSales);
      const salesYesterdayEl = document.getElementById('sales-yesterday');
      if (salesYesterdayEl) salesYesterdayEl.textContent = formatRevenue(sales.yesterday);
    }

    function renderConversion(data) {
      const c = data.conversion || {};
      const range = getStatsRange();
      document.getElementById('conversion-range').textContent = pct(c[range]);
      const productCr = (data.productConversion || {})[range];
      const productCrEl = document.getElementById('conversion-product-cr');
      if (productCrEl) productCrEl.textContent = productCr != null ? pct(productCr) : '\u2014';
    }

    function renderSessions(data) {
      const breakdown = data && data.trafficBreakdown ? data.trafficBreakdown : {};
      const forRange = breakdown[getStatsRange()];
      const forYesterday = breakdown.yesterday;
      const main = forRange != null ? forRange.human_sessions : null;
      const yesterday = forYesterday != null ? forYesterday.human_sessions : null;
      const sessionsRangeEl = document.getElementById('sessions-range');
      const sessionsYesterdayEl = document.getElementById('sessions-yesterday');
      if (sessionsRangeEl) sessionsRangeEl.textContent = formatSessions(main);
      if (sessionsYesterdayEl) sessionsYesterdayEl.textContent = formatSessions(yesterday);
    }

    var breakdownAovPage = 1;
    function renderAov(data) {
      const rows = (data.country || {})[getStatsRange()] || [];
      const tbody = document.getElementById('breakdown-aov-body');
      if (!tbody) return;
      const filtered = rows.filter(r => (r && (r.revenue != null || r.aov != null || r.conversion != null)));
      if (filtered.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateCardPagination('breakdown-aov', 1, 1);
        return;
      }
      const list = filtered.slice();
      list.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc') ||
          cmpNullableNumber(a && a.aov, b && b.aov, 'desc') ||
          cmpNullableNumber(a && a.conversion, b && b.conversion, 'desc');
      });
      var totalPages = Math.max(1, Math.ceil(list.length / TOP_TABLE_PAGE_SIZE));
      breakdownAovPage = clampPage(breakdownAovPage, totalPages);
      updateCardPagination('breakdown-aov', breakdownAovPage, totalPages);
      var start = (breakdownAovPage - 1) * TOP_TABLE_PAGE_SIZE;
      var pageRows = list.slice(start, start + TOP_TABLE_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(r => {
        const iso = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabelFull(iso);
        const flag = flagImg(iso, label);
        const revenue = r && r.revenue != null ? formatRevenueTableHtml(r.revenue) : '\u2014';
        const aov = r && r.aov != null ? formatRevenueTableHtml(r.aov) : '\u2014';
        const cr = r && r.conversion != null ? pct(r.conversion) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + '<span class="country-label"><span class="country-name">' + escapeHtml(label) + '</span></span></span></div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
          '<div class="grid-cell" role="cell">' + aov + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderFinishes(data) {
      const grid = document.getElementById('finishes-cards-grid');
      if (!grid) return;
      const rows = (data && Array.isArray(data.finishes)) ? data.finishes : [];
      if (rows.length === 0) {
        const msg = finishesLoading ? 'Loading finishes\u2026' : 'No data';
        grid.innerHTML = '<div class="aov-card aov-card-empty">' + escapeHtml(msg) + '</div>';
        return;
      }
      function iconFor(key) {
        const k = (key || '').toString().trim().toLowerCase();
        if (k === 'gold') return '<span class="finish-icon finish-icon-gold" aria-hidden="true"></span>';
        if (k === 'silver') return '<span class="finish-icon finish-icon-silver" aria-hidden="true"></span>';
        if (k === 'vermeil') return '<span class="finish-icon finish-icon-vermeil" aria-hidden="true"></span>';
        if (k === 'solid_silver' || k === 'solid-silver') return '<span class="finish-icon finish-icon-solid-silver" aria-hidden="true"></span>';
        return '<span class="finish-icon" aria-hidden="true"></span>';
      }
      const ordered = rows.slice();
      const orderIndex = { gold: 0, silver: 1, vermeil: 2, solid_silver: 3, 'solid-silver': 3 };
      ordered.sort(function(a, b) {
        const primary = cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc');
        if (primary) return primary;
        const ak = a && a.key != null ? String(a.key) : '';
        const bk = b && b.key != null ? String(b.key) : '';
        const ai = Object.prototype.hasOwnProperty.call(orderIndex, ak) ? orderIndex[ak] : 99;
        const bi = Object.prototype.hasOwnProperty.call(orderIndex, bk) ? orderIndex[bk] : 99;
        return ai - bi;
      });
      grid.innerHTML = ordered.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = crPillHtml(r && r.cr);
        return '<div class="aov-card">' +
          '<div class="aov-card-left">' + iconFor(r && r.key) + '<span class="aov-card-name">' + escapeHtml(label || '\u2014') + '</span></div>' +
          '<div class="aov-card-value"><span class="aov-card-value-main">' + value + '</span>' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderLengths(data) {
      const grid = document.getElementById('finishes-cards-grid');
      if (!grid) return;
      const rows = (data && Array.isArray(data.lengths)) ? data.lengths : [];
      if (rows.length === 0) {
        const msg = lengthsLoading ? 'Loading lengths\u2026' : 'No data';
        grid.innerHTML = '<div class="aov-card aov-card-empty">' + escapeHtml(msg) + '</div>';
        return;
      }
      const ordered = rows.slice();
      ordered.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
          cmpNullableNumber(a && a.inches, b && b.inches, 'asc');
      });
      grid.innerHTML = ordered.map(function(r) {
        const inches = (r && r.inches != null) ? Number(r.inches) : null;
        const label = (r && r.label != null) ? String(r.label) : (inches != null && Number.isFinite(inches) ? (String(inches) + '"') : '');
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = crPillHtml(r && r.cr);
        const icon = '<span class="length-icon" aria-hidden="true"><span class="length-icon-text">' + escapeHtml(label || '\u2014') + '</span></span>';
        const sr = '<span class="aov-card-name sr-only">' + escapeHtml((label || '\u2014') + ' Inches') + '</span>';
        return '<div class="aov-card aov-card--length">' +
          '<div class="aov-card-left">' + icon + sr + '</div>' +
          '<div class="aov-card-value"><span class="aov-card-value-main">' + value + '</span>' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownTitlePage = 1;
    function renderBreakdownTitles(data) {
      const tbody = document.getElementById('breakdown-title-body');
      if (!tbody) return;
      const hasData = !!(data && data.ok);
      const list = hasData ? (data.byTitle || []) : [];
      if (!list.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-title', 1, 1);
        return;
      }
      var totalPages = Math.max(1, Math.ceil(list.length / TOP_TABLE_PAGE_SIZE));
      breakdownTitlePage = clampPage(breakdownTitlePage, totalPages);
      updateCardPagination('breakdown-title', breakdownTitlePage, totalPages);
      var start = (breakdownTitlePage - 1) * TOP_TABLE_PAGE_SIZE;
      var pageRows = list.slice(start, start + TOP_TABLE_PAGE_SIZE);
      const mainBase = getMainBaseUrl();
      tbody.innerHTML = pageRows.map(function(row) {
        const title = row && row.title != null ? String(row.title) : 'Product';
        const handle = row && row.handle ? String(row.handle) : '';
        const productId = (row && row.product_id) ? String(row.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = row && row.cr != null ? pct(row.cr) : '\u2014';
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        const placeholderSvg = '<i class="fa-light fa-image" data-icon-key="breakdown-placeholder-image" aria-hidden="true"></i>';
        const normalizedHandle = handle ? String(handle).trim().toLowerCase() : '';
        const canOpen = normalizedHandle || (productId && /^\d+$/.test(productId));
        const titleLink = canOpen
          ? '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
              (normalizedHandle ? (' data-product-handle="' + escapeHtml(normalizedHandle) + '"') : '') +
              (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
              (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
            '>' + escapeHtml(title) + '</a>'
          : escapeHtml(title);
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell"><span class="breakdown-thumb-wrap" aria-hidden="true">' + placeholderSvg + '</span><span class="breakdown-label"><span class="breakdown-product-name">' + titleLink + '</span><span class="sr-only">' + escapeHtml(title) + '</span></span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(value) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderBreakdownTypes(data) {
      const tbody = document.getElementById('breakdown-type-body');
      if (!tbody) return;
      const hasData = !!(data && data.ok);
      const list = hasData ? (data.byType || []) : [];
      if (!list.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        return;
      }
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-image" data-icon-key="breakdown-icon-image"></i></span>';
      tbody.innerHTML = list.map(function(row) {
        const label = row && (row.label || row.key) ? String(row.label || row.key) : 'Unknown';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = row && row.cr != null ? pct(row.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(value) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownFinishPage = 1;
    function renderBreakdownFinishes(data) {
      const tbody = document.getElementById('breakdown-finish-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.finishes)) ? data.finishes : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (finishesLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-finish', 1, 1);
        return;
      }
      function iconFor(key) {
        const k = (key || '').toString().trim().toLowerCase();
        if (k === 'gold') return '<span class="finish-icon finish-icon-gold" aria-hidden="true"></span>';
        if (k === 'silver') return '<span class="finish-icon finish-icon-silver" aria-hidden="true"></span>';
        if (k === 'vermeil') return '<span class="finish-icon finish-icon-vermeil" aria-hidden="true"></span>';
        if (k === 'solid_silver' || k === 'solid-silver') return '<span class="finish-icon finish-icon-solid-silver" aria-hidden="true"></span>';
        return '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-star" data-icon-key="breakdown-icon-star"></i></span>';
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) { return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc'); });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownFinishPage = clampPage(breakdownFinishPage, totalPages);
      updateCardPagination('breakdown-finish', breakdownFinishPage, totalPages);
      var start = (breakdownFinishPage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      tbody.innerHTML = pageRows.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '\u2014';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconFor(r && r.key) + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownLengthPage = 1;
    function renderBreakdownLengths(data) {
      const tbody = document.getElementById('breakdown-length-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.lengths)) ? data.lengths : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (lengthsLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-length', 1, 1);
        return;
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) {
        return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc') ||
          cmpNullableNumber(a && a.inches, b && b.inches, 'asc');
      });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownLengthPage = clampPage(breakdownLengthPage, totalPages);
      updateCardPagination('breakdown-length', breakdownLengthPage, totalPages);
      var start = (breakdownLengthPage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-chart-column" data-icon-key="breakdown-icon-chart-column"></i></span>';
      tbody.innerHTML = pageRows.map(function(r) {
        const inches = (r && r.inches != null) ? Number(r.inches) : null;
        const label = (r && r.label != null) ? String(r.label) : (inches != null && Number.isFinite(inches) ? (String(inches) + '"') : '\u2014');
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    var breakdownChainStylePage = 1;
    function renderBreakdownChainStyles(data) {
      const tbody = document.getElementById('breakdown-chainstyle-body');
      if (!tbody) return;
      const rows = (data && Array.isArray(data.chainStyles)) ? data.chainStyles : [];
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (chainStylesLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('breakdown-chainstyle', 1, 1);
        return;
      }
      var ordered = rows.slice();
      ordered.sort(function(a, b) { return cmpNullableNumber(a && a.revenueGbp, b && b.revenueGbp, 'desc'); });
      var totalPages = Math.max(1, Math.ceil(ordered.length / BREAKDOWN_PAGE_SIZE));
      breakdownChainStylePage = clampPage(breakdownChainStylePage, totalPages);
      updateCardPagination('breakdown-chainstyle', breakdownChainStylePage, totalPages);
      var start = (breakdownChainStylePage - 1) * BREAKDOWN_PAGE_SIZE;
      var pageRows = ordered.slice(start, start + BREAKDOWN_PAGE_SIZE);
      const iconSvg = '<span class="breakdown-icon" aria-hidden="true"><i class="fa-light fa-link" data-icon-key="breakdown-icon-link"></i></span>';
      tbody.innerHTML = pageRows.map(function(r) {
        const label = (r && r.label != null) ? String(r.label) : '\u2014';
        const revenue = (r && r.revenueGbp != null) ? Number(r.revenueGbp) : null;
        const value = (revenue != null && Number.isFinite(revenue)) ? formatRevenueTableHtml(revenue) : '\u2014';
        const cr = r && r.cr != null ? pct(r.cr) : '\u2014';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="breakdown-cell">' + iconSvg + '<span class="breakdown-label">' + escapeHtml(label) + '</span></span></div>' +
          '<div class="grid-cell" role="cell">' + value + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
        '</div>';
      }).join('');
    }

    function renderCountry(data) {
      const c = data.country || {};
      const rows = c[getStatsRange()] || [];
      const tbody = document.getElementById('by-country-body');
      if (!tbody) return;
      if (rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateSortHeadersInContainer(document.getElementById('country-table'), tableSortState.country.by, tableSortState.country.dir);
        updateCardPagination('country', 1, 1);
        return;
      }
      const list = rows.slice();
      const countryBy = (tableSortState.country.by || 'rev').toString().trim().toLowerCase();
      const countryDir = (tableSortState.country.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function labelFor(r) {
        const code = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
        return countryLabel(code);
      }
      function countryVpv(r) {
        var rev = r && typeof r.revenue === 'number' ? r.revenue : null;
        var tot = r && typeof r.total === 'number' ? r.total : null;
        return (tot != null && tot > 0 && rev != null) ? (rev / tot) : null;
      }
      list.sort(function(a, b) {
        if (countryBy === 'country') return cmpNullableText(labelFor(a), labelFor(b), countryDir);
        if (countryBy === 'vpv') return cmpNullableNumber(countryVpv(a), countryVpv(b), countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'cr') return cmpNullableNumber(a && a.conversion, b && b.conversion, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'sales') return cmpNullableNumber(a && a.converted, b && b.converted, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'clicks') return cmpNullableNumber(a && a.total, b && b.total, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        if (countryBy === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, countryDir) || cmpNullableText(labelFor(a), labelFor(b), 'asc');
        return 0;
      });

      lastCountryRowCount = list.length;
      var countryPageSize = getTableRowsPerPage('country-table', 'live');
      var totalPages = Math.max(1, Math.ceil(list.length / countryPageSize));
      countryPage = clampPage(countryPage, totalPages);
      updateCardPagination('country', countryPage, totalPages);
      var start = (countryPage - 1) * countryPageSize;
      var pageRows = list.slice(start, start + countryPageSize);
      tbody.innerHTML = pageRows.map(r => {
        const code = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabel(code);
        const conversion = pct(r.conversion);
        const salesCount = r.converted != null ? Number(r.converted) : 0;
        const clicks = r.total != null ? formatSessions(r.total) : '\u2014';
        const revenue = formatRevenueTableHtml(r.revenue);
        const vpvNum = countryVpv(r);
        const vpv = vpvNum != null ? formatRevenue(vpvNum) : '\u2014';
        const flag = flagImg(code, label);
        const labelHtml = '<span class="country-label">' + escapeHtml(label) + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + salesCount + '</div>' +
          '<div class="grid-cell" role="cell">' + conversion + '</div>' +
          '<div class="grid-cell" role="cell">' + vpv + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('country-table'), countryBy, countryDir);
      scheduleBreakdownSync();
    }

    // Countries map chart
    let countriesMapChartInstance = null;

    function clearCountriesFlowOverlay(el) {
      if (!el) return;
      var existing = el.querySelector('.kexo-map-flow-overlay');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    }

    function mapRegionCenter(mapSvg, mapRect, iso2) {
      if (!mapSvg || !mapRect) return null;
      var iso = String(iso2 || '').trim().toUpperCase();
      if (!iso) return null;
      var lowerIso = iso.toLowerCase();
      var node = mapSvg.querySelector('[data-code="' + iso + '"], [data-code="' + lowerIso + '"], .jvm-region-' + lowerIso + ', .jvm-region-' + iso);
      if (!node) return null;
      var rect = node.getBoundingClientRect();
      if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
      return {
        x: (rect.left - mapRect.left) + (rect.width / 2),
        y: (rect.top - mapRect.top) + (rect.height / 2),
      };
    }

    function renderCountriesFlowOverlay(el, rows, primaryRgb, originIso2) {
      if (!el) return;
      clearCountriesFlowOverlay(el);
      var mapSvg = el.querySelector('svg');
      if (!mapSvg) return;
      var mapRect = mapSvg.getBoundingClientRect();
      if (!mapRect || !(mapRect.width > 20) || !(mapRect.height > 20)) return;

      var originIso = String(originIso2 || 'GB').trim().toUpperCase().slice(0, 2);
      if (originIso === 'UK') originIso = 'GB';
      if (!originIso) originIso = 'GB';

      var NS = 'http://www.w3.org/2000/svg';
      var overlay = document.createElementNS(NS, 'svg');
      overlay.setAttribute('class', 'kexo-map-flow-overlay');
      overlay.setAttribute('viewBox', '0 0 ' + mapRect.width + ' ' + mapRect.height);
      overlay.setAttribute('width', String(mapRect.width));
      overlay.setAttribute('height', String(mapRect.height));

      var ranked = (Array.isArray(rows) ? rows : [])
        .map(function (r) {
          var rawIso = r && r.country_code != null ? String(r.country_code) : 'XX';
          var iso = rawIso.trim().toUpperCase().slice(0, 2);
          if (iso === 'UK') iso = 'GB';
          return {
            iso: iso,
            orders: Number((r && r.converted) || 0),
          };
        })
        .filter(function (r) { return r.iso && r.iso !== 'XX' && r.iso !== originIso && r.orders > 0; })
        .sort(function (a, b) { return b.orders - a.orders; })
        .slice(0, 8);

      if (!ranked.length) {
        el.appendChild(overlay);
        return;
      }

      var origin = mapRegionCenter(mapSvg, mapRect, originIso) ||
        { x: mapRect.width * 0.52, y: mapRect.height * 0.42 };
      var palette = [
        'rgba(' + primaryRgb + ',0.78)',
        'rgba(' + primaryRgb + ',0.6)',
        'rgba(' + primaryRgb + ',0.44)',
      ];

      ranked.forEach(function (item, idx) {
        var target = mapRegionCenter(mapSvg, mapRect, item.iso);
        if (!target) return;
        var midX = (origin.x + target.x) / 2;
        var bend = Math.max(18, Math.min(74, (Math.abs(target.x - origin.x) * 0.16) + (idx * 3)));
        var midY = (origin.y + target.y) / 2 - bend;
        var stroke = palette[idx % palette.length];

        var path = document.createElementNS(NS, 'path');
        path.setAttribute('class', 'kexo-map-flow-line');
        path.setAttribute('d', 'M ' + origin.x + ' ' + origin.y + ' Q ' + midX + ' ' + midY + ' ' + target.x + ' ' + target.y);
        path.setAttribute('stroke', stroke);
        path.style.animationDelay = String(idx * 0.24) + 's';
        overlay.appendChild(path);

        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'kexo-map-flow-dot');
        dot.setAttribute('cx', String(target.x));
        dot.setAttribute('cy', String(target.y));
        dot.setAttribute('r', '3.2');
        dot.setAttribute('fill', stroke);
        dot.style.animationDelay = String(0.12 + idx * 0.24) + 's';
        overlay.appendChild(dot);
      });

      var originDot = document.createElementNS(NS, 'circle');
      originDot.setAttribute('class', 'kexo-map-flow-origin');
      originDot.setAttribute('cx', String(origin.x));
      originDot.setAttribute('cy', String(origin.y));
      originDot.setAttribute('r', '4.2');
      originDot.setAttribute('fill', 'rgba(' + primaryRgb + ',0.86)');
      overlay.appendChild(originDot);

      el.appendChild(overlay);
    }

    function setCountriesMapState(el, text, opts) {
      if (!el) return;
      var message = String(text == null ? '' : text).trim() || 'Unavailable';
      var isError = !!(opts && opts.error);
      var color = isError ? '#ef4444' : 'var(--tblr-secondary)';
      if (isError) captureChartMessage(message, 'countriesMapState', { chartKey: 'countries-map-chart' }, 'error');
      el.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:320px;color:' + color + ';text-align:center;padding:0 18px;">' +
          escapeHtml(message) +
        '</div>';
    }

    var WORLD_MAP_ISO2 = ['AE','AF','AG','AL','AM','AO','AR','AT','AU','AZ','BA','BB','BD','BE','BF','BG','BI','BJ','BN','BO','BR','BS','BT','BW','BY','BZ','CA','CD','CF','CG','CH','CI','CL','CM','CN','CO','CR','CU','CV','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FK','FR','GA','GB','GD','GE','GF','GH','GL','GM','GN','GQ','GR','GT','GW','GY','HN','HR','HT','HU','ID','IE','IL','IN','IQ','IR','IS','IT','JM','JO','JP','KE','KG','KH','KM','KN','KP','KR','KW','KZ','LA','LB','LC','LK','LR','LS','LT','LV','LY','MA','MD','MG','MK','ML','MM','MN','MR','MT','MU','MV','MW','MX','MY','MZ','NA','NC','NE','NG','NI','NL','NO','NP','NZ','OM','PA','PE','PF','PG','PH','PK','PL','PT','PY','QA','RE','RO','RS','RU','SA','SB','SC','SD','SE','SI','SK','SL','SN','SO','SR','ST','SV','SY','SZ','TD','TG','TH','TJ','TL','TM','TN','TR','TT','TW','TZ','UA','UG','US','UY','UZ','VE','VN','VU','YE','ZA','ZM','ZW'];
    function buildMapFillScaleByIso(valuesByIso2, primaryRgb, minAlpha, maxAlpha) {
      var src = valuesByIso2 && typeof valuesByIso2 === 'object' ? valuesByIso2 : {};
      var entries = [];
      var keys = Object.keys(src);
      for (var i = 0; i < keys.length; i++) {
        var iso = String(keys[i] || '').trim().toUpperCase();
        if (!iso) continue;
        var n = Number(src[iso]);
        if (!Number.isFinite(n) || n <= 0) continue;
        entries.push({ iso: iso, value: n });
      }
      var defaultFill = 'rgba(' + (primaryRgb || '62,179,171') + ',0.18)';
      var out = {};
      var idx;
      for (idx = 0; idx < WORLD_MAP_ISO2.length; idx++) {
        out[WORLD_MAP_ISO2[idx]] = defaultFill;
      }
      if (entries.length) {
        var min = Infinity;
        var max = -Infinity;
        for (var j = 0; j < entries.length; j++) {
          var v = entries[j].value;
          if (v < min) min = v;
          if (v > max) max = v;
        }
        var lo = typeof minAlpha === 'number' ? minAlpha : 0.24;
        var hi = typeof maxAlpha === 'number' ? maxAlpha : 0.92;
        for (var k = 0; k < entries.length; k++) {
          var row = entries[k];
          var alpha = hi;
          if (max > min) {
            var t = (row.value - min) / (max - min);
            if (!Number.isFinite(t)) t = 0;
            t = Math.max(0, Math.min(1, t));
            alpha = lo + t * (hi - lo);
          }
          out[row.iso] = 'rgba(' + (primaryRgb || '62,179,171') + ',' + alpha + ')';
        }
      }
      return out;
    }

    var mapTooltipScrollBound;
    function hideMapTooltipOnLeave(container) {
      if (!container || container.__kexoMapTooltipCleanup) return;
      container.__kexoMapTooltipCleanup = true;
      function hideTooltips() {
        document.querySelectorAll('.jvm-tooltip').forEach(function(t) { t.style.display = 'none'; });
      }
      container.addEventListener('mouseleave', hideTooltips, { passive: true });
      if (!mapTooltipScrollBound) {
        mapTooltipScrollBound = true;
        window.addEventListener('scroll', hideTooltips, { passive: true });
      }
    }

    function setVectorMapTooltipContent(tooltip, html, text) {
      if (!tooltip) return;
      var htmlContent = html == null ? '' : String(html);
      var textContent = text == null ? '' : String(text);
      try {
        if (typeof tooltip.text === 'function') {
          tooltip.text(htmlContent, true);
          return;
        }
      } catch (_) {}
      try {
        if (typeof tooltip.html === 'function') {
          tooltip.html(htmlContent);
          return;
        }
      } catch (_) {}
      try {
        if (tooltip.element && tooltip.element.nodeType === 1) {
          tooltip.element.innerHTML = htmlContent;
          return;
        }
      } catch (_) {}
      try {
        if (tooltip.nodeType === 1) {
          tooltip.innerHTML = htmlContent;
          return;
        }
      } catch (_) {}
      try {
        if (typeof tooltip.setContent === 'function') {
          tooltip.setContent(htmlContent || textContent);
        }
      } catch (_) {}
    }

    function renderCountriesMapChart(data) {
      const el = document.getElementById('countries-map-chart');
      if (!el) return;
      if (typeof jsVectorMap === 'undefined') {
        if (!el.__kexoJvmWaitTries) {
          setCountriesMapState(el, 'Loading map library...');
        }
        // Avoid an unbounded retry loop if the CDN/map script is blocked (adblock/network).
        const tries = (el.__kexoJvmWaitTries || 0) + 1;
        el.__kexoJvmWaitTries = tries;
        if (tries >= 25) {
          el.__kexoJvmWaitTries = 0;
          setCountriesMapState(el, 'Map library failed to load.', { error: true });
          return;
        }
        setTimeout(function() { renderCountriesMapChart(data); }, 200);
        return;
      }
      try { el.__kexoJvmWaitTries = 0; } catch (_) {}
      var chartKey = 'countries-map-chart';
      if (!isChartEnabledByUiConfig(chartKey, true)) {
        if (countriesMapChartInstance) {
          try { countriesMapChartInstance.destroy(); } catch (_) {}
          countriesMapChartInstance = null;
        }
        clearCountriesFlowOverlay(el);
        setCountriesMapState(el, 'Map disabled in Settings > Charts.');
        return;
      }

      // jsVectorMap snapshots container size at init. If we render while hidden (page loader / collapsed),
      // it can end up with a 0x0 SVG (scale(0)) and never recover. Wait until the container is measurable.
      try {
        var rect = (el && el.getBoundingClientRect) ? el.getBoundingClientRect() : null;
        var w = rect && Number.isFinite(rect.width) ? rect.width : Number(el && el.offsetWidth);
        var h = rect && Number.isFinite(rect.height) ? rect.height : Number(el && el.offsetHeight);
        if (!(w > 20) || !(h > 20)) {
          var tries = (el.__kexoJvmSizeWaitTries || 0) + 1;
          el.__kexoJvmSizeWaitTries = tries;
          if (tries <= 60) {
            setTimeout(function() { renderCountriesMapChart(data); }, 220);
          } else {
            el.__kexoJvmSizeWaitTries = 0;
          }
          return;
        }
        el.__kexoJvmSizeWaitTries = 0;
      } catch (_) {}

      if (countriesMapChartInstance) {
        try { countriesMapChartInstance.destroy(); } catch (_) {}
        countriesMapChartInstance = null;
      }
      clearCountriesFlowOverlay(el);

      const c = data && data.country ? data.country : {};
      const rows = c[getStatsRange()] || [];
      if (!rows.length) {
        setCountriesMapState(el, 'No country data for this range.');
        return;
      }

      const revenueByIso2 = {};
      const ordersByIso2 = {};
      const mapMetricByIso2 = {};
      for (const r of rows || []) {
        let iso = (r && r.country_code != null) ? String(r.country_code).trim().toUpperCase().slice(0, 2) : 'XX';
        if (!iso || iso === 'XX') continue;
        if (iso === 'UK') iso = 'GB';
        const rev = (r && typeof r.revenue === 'number') ? r.revenue : 0;
        const ord = (r && r.converted != null) ? Number(r.converted) : 0;
        if (!Number.isFinite(rev) && !Number.isFinite(ord)) continue;
        revenueByIso2[iso] = (revenueByIso2[iso] || 0) + (Number.isFinite(rev) ? rev : 0);
        ordersByIso2[iso] = (ordersByIso2[iso] || 0) + (Number.isFinite(ord) ? ord : 0);
        const metric = (Number.isFinite(rev) && rev > 0) ? rev : ((Number.isFinite(ord) && ord > 0) ? ord : 0);
        if (metric > 0) {
          mapMetricByIso2[iso] = (mapMetricByIso2[iso] || 0) + metric;
        }
      }

      el.innerHTML = '';
      try {
        const rootCss = getComputedStyle(document.documentElement);
        const border = (rootCss.getPropertyValue('--tblr-border-color') || '#d4dee5').trim();
        const muted = (rootCss.getPropertyValue('--tblr-secondary') || '#626976').trim();
        const rawMode = chartModeFromUiConfig(chartKey, 'map-flat') || 'map-flat';
        const isAnimated = rawMode !== 'map-flat';
        const palette = chartColorsFromUiConfig(chartKey, ['#3eb3ab']);
        const accent = (palette && palette[0]) ? String(palette[0]).trim() : '#3eb3ab';

        function rgbFromColor(c) {
          const s = String(c || '').trim();
          let m = /^#([0-9a-f]{6})$/i.exec(s);
          if (m) {
            const hex = m[1];
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            return { r, g, b, rgb: r + ',' + g + ',' + b };
          }
          m = /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})/i.exec(s);
          if (m) {
            const r = Math.max(0, Math.min(255, parseInt(m[1], 10) || 0));
            const g = Math.max(0, Math.min(255, parseInt(m[2], 10) || 0));
            const b = Math.max(0, Math.min(255, parseInt(m[3], 10) || 0));
            return { r, g, b, rgb: r + ',' + g + ',' + b };
          }
          return { r: 62, g: 179, b: 171, rgb: '62,179,171' };
        }
        const rgb = rgbFromColor(accent);
        const primaryRgb = rgb.rgb;
        const regionFillByIso2 = buildMapFillScaleByIso(mapMetricByIso2, primaryRgb, 0.24, 0.92);

        countriesMapChartInstance = new jsVectorMap({
          selector: '#countries-map-chart',
          map: 'world',
          backgroundColor: 'transparent',
          zoomButtons: false,
          zoomOnScroll: false,
          zoomAnimate: false,
          regionStyle: {
            initial: { fill: 'rgba(' + primaryRgb + ',0.18)', stroke: border, strokeWidth: 0.7 },
            hover: { fill: 'rgba(' + primaryRgb + ',0.46)' },
            selected: { fill: 'rgba(' + primaryRgb + ',0.78)' },
          },
          onRegionTooltipShow: function(event, tooltip, code) {
            const iso = (code || '').toString().trim().toUpperCase();
            const name = (countriesMapChartInstance && typeof countriesMapChartInstance.getRegionName === 'function')
              ? (countriesMapChartInstance.getRegionName(iso) || iso)
              : iso;
            const rev = revenueByIso2[iso] || 0;
            const ord = ordersByIso2[iso] || 0;
            if (!rev && !ord) {
              setVectorMapTooltipContent(
                tooltip,
                '<div style="min-width:140px;font-weight:600">' + escapeHtml(name) + '</div>',
                name
              );
              return;
            }
            const revHtml = formatRevenue(Number(rev) || 0) || '\u2014';
            const ordHtml = ord ? (formatSessions(ord) + ' orders') : '\u2014';
            setVectorMapTooltipContent(
              tooltip,
              '<div style="min-width:180px">' +
                '<div style="font-weight:600;margin-bottom:2px">' + escapeHtml(name) + '</div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Revenue: <span style="color:inherit">' + escapeHtml(revHtml) + '</span></div>' +
                '<div style="color:' + escapeHtml(muted) + ';font-size:.8125rem">Orders: <span style="color:inherit">' + escapeHtml(ordHtml) + '</span></div>' +
              '</div>',
              name + ' | Revenue: ' + revHtml + ' | Orders: ' + ordHtml
            );
          }
        });

        if (countriesMapChartInstance && countriesMapChartInstance.regions) {
          var regions = countriesMapChartInstance.regions;
          for (var code in regionFillByIso2) {
            if (regions[code] && regions[code].element && typeof regions[code].element.setStyle === 'function') {
              try { regions[code].element.setStyle('fill', regionFillByIso2[code]); } catch (_) {}
            }
          }
        }
        hideMapTooltipOnLeave(el);

        if (isAnimated) {
          setTimeout(function () {
            try { renderCountriesFlowOverlay(el, rows, primaryRgb); } catch (_) {}
          }, 140);
        }
      } catch (err) {
        captureChartError(err, 'countriesMapRender', { chartKey: 'countries-map-chart' });
        console.error('[countries-map] map render error:', err);
        setCountriesMapState(el, 'Map rendering failed.', { error: true });
      }
    }

    function renderBestGeoProducts(data) {
      const map = data && data.bestGeoProducts ? data.bestGeoProducts : {};
      const rows = map[getStatsRange()] || [];
      const tbody = document.getElementById('best-geo-products-body');
      if (!tbody) return;
      if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No data</div></div>';
        updateSortHeadersInContainer(document.getElementById('best-geo-products-table'), tableSortState.bestGeoProducts.by, tableSortState.bestGeoProducts.dir);
        updateCardPagination('best-geo-products', 1, 1);
        return;
      }
      const list = rows.slice();
      const geoBy = (tableSortState.bestGeoProducts.by || 'rev').toString().trim().toLowerCase();
      const geoDir = (tableSortState.bestGeoProducts.dir || 'desc').toString().trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
      function geoCountryLabel(r) {
        const iso = (r && r.country_code != null ? String(r.country_code) : 'XX').toUpperCase().slice(0, 2);
        return countryLabel(iso);
      }
      function geoProductTitle(r) {
        return (r && r.product_title != null) ? String(r.product_title).trim() : '';
      }
      function geoVpv(r) {
        var rev = r && typeof r.revenue === 'number' ? r.revenue : null;
        var tot = r && typeof r.total === 'number' ? r.total : null;
        return (tot != null && tot > 0 && rev != null) ? (rev / tot) : null;
      }
      list.sort(function(a, b) {
        if (geoBy === 'country') {
          return cmpNullableText(geoCountryLabel(a), geoCountryLabel(b), geoDir) ||
            cmpNullableText(geoProductTitle(a), geoProductTitle(b), 'asc');
        }
        if (geoBy === 'vpv') return cmpNullableNumber(geoVpv(a), geoVpv(b), geoDir) || cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc');
        if (geoBy === 'cr') return cmpNullableNumber(a && a.conversion, b && b.conversion, geoDir) || cmpNullableNumber(a && a.total, b && b.total, 'desc');
        if (geoBy === 'sales') return cmpNullableNumber(a && a.converted, b && b.converted, geoDir) || cmpNullableNumber(a && a.revenue, b && b.revenue, 'desc');
        if (geoBy === 'clicks') return cmpNullableNumber(a && a.total, b && b.total, geoDir) || cmpNullableNumber(a && a.converted, b && b.converted, 'desc');
        if (geoBy === 'rev') return cmpNullableNumber(a && a.revenue, b && b.revenue, geoDir) || cmpNullableNumber(a && a.converted, b && b.converted, 'desc');
        return 0;
      });

      const geoPageSize = getTableRowsPerPage('best-geo-products-table', 'live');
      const totalPages = Math.max(1, Math.ceil(list.length / geoPageSize));
      bestGeoProductsPage = clampPage(bestGeoProductsPage, totalPages);
      updateCardPagination('best-geo-products', bestGeoProductsPage, totalPages);
      const start = (bestGeoProductsPage - 1) * geoPageSize;
      const pageRows = list.slice(start, start + geoPageSize);
      tbody.innerHTML = pageRows.map(r => {
        const iso = (r.country_code || 'XX').toUpperCase().slice(0, 2);
        const label = countryLabel(iso);
        const productTitle = (r.product_title && String(r.product_title).trim()) ? String(r.product_title).trim() : '\u2014';
        const productHandle = (r && r.product_handle != null) ? String(r.product_handle).trim() : '';
        const productId = (r && r.product_id) ? String(r.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const mainBase = getMainBaseUrl();
        const productUrl = (mainBase && productHandle) ? (mainBase + '/products/' + encodeURIComponent(productHandle)) : '#';
        const conversion = pct(r.conversion);
        const salesCount = r.converted != null ? Number(r.converted) : 0;
        const clicks = r.total != null ? formatSessions(r.total) : '\u2014';
        const revenue = formatRevenueTableHtml(r.revenue);
        const vpvNum = (r && r.total > 0 && r.revenue != null) ? (r.revenue / r.total) : null;
        const vpv = vpvNum != null ? formatRevenue(vpvNum) : '\u2014';
        const flag = flagImg(iso, label);
        const normalizedHandle = productHandle ? String(productHandle).trim().toLowerCase() : '';
        const canOpen = normalizedHandle || (productId && /^\d+$/.test(productId));
        const titleLink = canOpen
          ? '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
              (normalizedHandle ? (' data-product-handle="' + escapeHtml(normalizedHandle) + '"') : '') +
              (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
              (productTitle ? (' data-product-title="' + escapeHtml(productTitle) + '"') : '') +
            '>' + escapeHtml(productTitle) + '</a>'
          : escapeHtml(productTitle);
        const labelHtml =
          '<span class="country-product-stack">' +
            '<span class="country-label">' + escapeHtml(label) + '</span>' +
            '<span class="country-product-label">' + titleLink + '</span>' +
          '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell" role="cell"><span class="country-cell">' + flag + labelHtml + '</span></div>' +
          '<div class="grid-cell" role="cell">' + clicks + '</div>' +
          '<div class="grid-cell" role="cell">' + salesCount + '</div>' +
          '<div class="grid-cell" role="cell">' + conversion + '</div>' +
          '<div class="grid-cell" role="cell">' + vpv + '</div>' +
          '<div class="grid-cell" role="cell">' + revenue + '</div>' +
        '</div>';
      }).join('');
      updateSortHeadersInContainer(document.getElementById('best-geo-products-table'), geoBy, geoDir);
      scheduleBreakdownSync();
    }

    function isCustomDayRangeKey(v) {
      return typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
    }

    function isCustomRangeKey(v) {
      return typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
    }

    function ymdFromDayKey(dayKey) {
      if (!isCustomDayRangeKey(dayKey)) return null;
      return dayKey.slice(2);
    }

    function ymdRangeFromRangeKey(rangeKey) {
      if (!isCustomRangeKey(rangeKey)) return null;
      const parts = String(rangeKey).split(':');
      if (parts.length !== 3) return null;
      const a = String(parts[1] || '').trim();
      const b = String(parts[2] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
      const startYmd = a <= b ? a : b;
      const endYmd = a <= b ? b : a;
      return { startYmd, endYmd };
    }

    function appliedYmdRangeFromDateRange() {
      if (isCustomRangeKey(dateRange)) return ymdRangeFromRangeKey(dateRange);
      if (isCustomDayRangeKey(dateRange)) {
        const ymd = ymdFromDayKey(dateRange);
        return ymd ? { startYmd: ymd, endYmd: ymd } : null;
      }
      return null;
    }

    function formatYmdLabel(ymd) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      const y = parseInt(String(ymd).slice(0, 4), 10);
      const m = parseInt(String(ymd).slice(5, 7), 10);
      const d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd || '');
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      try {
        return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(dt);
      } catch (_) {
        return String(ymd || '');
      }
    }

    function formatYmdRangeLabel(startYmd, endYmd) {
      if (!startYmd || !endYmd) return '';
      if (startYmd === endYmd) return formatYmdShort(startYmd);
      // Same month? Compact as "5–7 Feb"
      if (startYmd.slice(0, 7) === endYmd.slice(0, 7)) {
        var d1 = parseInt(startYmd.slice(8, 10), 10);
        var d2 = parseInt(endYmd.slice(8, 10), 10);
        var suffix = formatYmdShort(endYmd);
        return d1 + '\u2013' + suffix;
      }
      return formatYmdShort(startYmd) + ' \u2013 ' + formatYmdShort(endYmd);
    }

    function formatYmdShort(ymd) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      var y = parseInt(String(ymd).slice(0, 4), 10);
      var m = parseInt(String(ymd).slice(5, 7), 10);
      var d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return String(ymd || '');
      var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      try {
        return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(dt);
      } catch (_) {
        return String(ymd || '');
      }
    }

    function makeRangeKeyFromYmds(startYmd, endYmd) {
      const a = String(startYmd || '').trim();
      const b = String(endYmd || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
      const s = a <= b ? a : b;
      const e = a <= b ? b : a;
      return 'r:' + s + ':' + e;
    }

    function updateLiveViewTitle() {
      const sel = document.getElementById('global-date-select');
      // Date page: sync the table card title with the selected range
      if (PAGE === 'date') {
        const titleEl = document.getElementById('table-title-text');
        if (titleEl) {
          let label = null;
          const applied = appliedYmdRangeFromDateRange();
          if (applied && applied.startYmd && applied.endYmd) {
            label = formatYmdRangeLabel(applied.startYmd, applied.endYmd);
          } else if (sel) {
            const opt = sel.querySelector('option[value="' + dateRange + '"]') || sel.options[sel.selectedIndex];
            label = opt && opt.textContent ? String(opt.textContent).trim() : null;
          }
          const fallback = { today: 'Today', yesterday: 'Yesterday', '3d': 'Last 3 Days', '7d': 'Last 7 Days', '1h': 'Last Hour', custom: 'Custom' };
          titleEl.textContent = label || fallback[dateRange] || 'Today';
        }
      }
    }

    function updateRowsPerPageVisibility() {
      const wrap = document.getElementById('rows-per-page-wrap');
      if (wrap) wrap.classList.toggle('is-hidden', dateRange === 'live');
    }

    function syncHeaderDateDisplay() {
      const sel = document.getElementById('global-date-select');
      const displayBtn = document.getElementById('kexo-date-display');
      if (!sel || !displayBtn) return;

      let label = null;
      try {
        const opt = sel.options[sel.selectedIndex];
        label = opt && opt.textContent ? String(opt.textContent).trim() : null;
      } catch (_) {}

      if (!label) {
        const fallback = { today: 'Today', yesterday: 'Yesterday', '7days': 'Last 7 days', '14days': 'Last 14 days', '30days': 'Last 30 days', custom: 'Custom' };
        label = fallback[String(dateRange || 'today')] || 'Today';
      }
      var lbl = displayBtn.querySelector('.kexo-date-btn-label');
      if (lbl) lbl.textContent = label; else displayBtn.textContent = label;
    }

    function syncHeaderDateMenuAvailability() {
      const sel = document.getElementById('global-date-select');
      const menu = document.getElementById('kexo-date-menu');
      if (!sel || !menu) return;

      // Mirror visibility/disabled + labels from the <select> options.
      try {
        menu.querySelectorAll('[data-range]').forEach(function(item) {
          const key = String(item.getAttribute('data-range') || '').trim();
          if (!key) return;
          const opt = sel.querySelector('option[value="' + key + '"]');
          if (!opt) return;
          const hidden = !!opt.hidden;
          const disabled = !!opt.disabled;
          item.style.display = hidden ? 'none' : '';
          if (disabled) item.setAttribute('disabled', 'disabled');
          else item.removeAttribute('disabled');
          item.classList.toggle('disabled', disabled);
          item.setAttribute('aria-disabled', disabled ? 'true' : 'false');
          if (opt.textContent) item.textContent = String(opt.textContent).trim();
        });
      } catch (_) {}

      // Active item highlight: custom ranges map to the "Custom???" item.
      let active = '';
      try { active = String(sel.value || '').trim(); } catch (_) { active = ''; }
      const isCustom = isCustomRangeKey(active) || isCustomDayRangeKey(active);
      menu.querySelectorAll('[data-range]').forEach(function(btn) {
        const v = String(btn.getAttribute('data-range') || '').trim();
        btn.classList.toggle('active', isCustom ? (v === 'custom') : (v === active));
      });
    }

    function syncPageHeaderTripleLayout(headerRow) {
      try {
        const row =
          headerRow ||
          document.querySelector('.page-header .row.align-items-center') ||
          document.querySelector('.page-header .row');
        if (!row) return;

        const dateCol = row.querySelector('.kexo-page-header-date-col');
        if (!dateCol) {
          row.classList.remove('kexo-page-header-layout-triple');
          return;
        }

        // Skip headers that have other right-side actions (buttons, etc).
        // Only inspect direct children so nested controls inside the date dropdown
        // do not accidentally disable the triple layout. Exclude our own leftCol.
        let hasOtherAuto = false;
        try {
          hasOtherAuto = !!row.querySelector(':scope > .col-auto:not(.kexo-page-header-date-col):not(.kexo-page-header-left-col)');
        } catch (_) {
          hasOtherAuto = Array.prototype.slice.call(row.children || []).some(function(ch) {
            if (!ch || !ch.classList) return false;
            if (!ch.classList.contains('col-auto')) return false;
            if (ch.classList.contains('kexo-page-header-date-col') || ch.classList.contains('kexo-page-header-left-col')) return false;
            return true;
          });
        }
        if (hasOtherAuto) {
          row.classList.remove('kexo-page-header-layout-triple');
          return;
        }

        const pretitle = row.querySelector('.page-pretitle');
        const title = row.querySelector('.page-title');
        if (!pretitle || !title) return;

        const legacyPretitleParent = pretitle.parentElement;
        const legacyTitleParent = title.parentElement;

        let leftCol = row.querySelector('.kexo-page-header-left-col');
        if (!leftCol) {
          leftCol = document.createElement('div');
          leftCol.className = 'col-auto kexo-page-header-left-col';
        }

        let titleCol = row.querySelector('.kexo-page-header-title-col');
        if (!titleCol) {
          titleCol = document.createElement('div');
          titleCol.className = 'col kexo-page-header-title-col';
        }

        // Ensure order: left, title, date.
        if (leftCol.parentElement !== row) {
          row.insertBefore(leftCol, row.firstChild || null);
        }
        if (titleCol.parentElement !== row) {
          row.insertBefore(titleCol, dateCol);
        }
        if (dateCol.parentElement === row && dateCol.nextElementSibling) {
          row.appendChild(dateCol);
        }

        if (pretitle.parentElement !== leftCol) leftCol.appendChild(pretitle);
        if (title.parentElement !== titleCol) titleCol.appendChild(title);

        // Clean up legacy wrapper(s) if we emptied them.
        try {
          [legacyPretitleParent, legacyTitleParent].forEach(function(p) {
            if (!p) return;
            if (p === leftCol || p === titleCol || p === row) return;
            if (p.children && p.children.length === 0) p.remove();
          });
        } catch (_) {}

        row.classList.add('kexo-page-header-layout-triple');
      } catch (_) {}
    }

    function mountDesktopDatePickerIntoPageHeader() {
      try {
        const sourceLi = document.querySelector('.kexo-desktop-nav .kexo-nav-date-slot');
        if (document.body) {
          const page = String(document.body.getAttribute('data-page') || '');
          const dateBtn = document.getElementById('kexo-date-display');
          const dateWrap = dateBtn && dateBtn.closest ? dateBtn.closest('.kexo-topbar-date') : null;
          if (page === 'settings' || page === 'snapshot') return;
          try { if (sourceLi) sourceLi.style.display = ''; } catch (_) {}
          try { if (dateWrap) dateWrap.style.display = ''; } catch (_) {}
        }
        const dateBtn = document.getElementById('kexo-date-display');
        const dateWrap = dateBtn && dateBtn.closest ? dateBtn.closest('.kexo-topbar-date') : null;
        if (!dateWrap) return;
        const headerRow = document.querySelector('.page-header .row.align-items-center') || document.querySelector('.page-header .row');
        const canRelocate = !!headerRow;

        if (!canRelocate) {
          if (sourceLi && dateWrap.parentElement !== sourceLi) {
            sourceLi.appendChild(dateWrap);
          }
          if (sourceLi) {
            sourceLi.classList.add('is-date-inline-fallback');
            sourceLi.classList.remove('is-date-relocated');
          }
          return;
        }

        let dateCol = headerRow.querySelector('.kexo-page-header-date-col');
        if (!dateCol) {
          dateCol = document.createElement('div');
          dateCol.className = 'col-auto kexo-page-header-date-col';
          headerRow.appendChild(dateCol);
        }

        if (dateWrap.parentElement !== dateCol) {
          dateCol.appendChild(dateWrap);
        }
        if (sourceLi) {
          sourceLi.classList.add('is-date-relocated');
          sourceLi.classList.remove('is-date-inline-fallback');
        }
        syncPageHeaderTripleLayout(headerRow);
      } catch (_) {}
    }

    function initHeaderDateMenu() {
      const sel = document.getElementById('global-date-select');
      const menu = document.getElementById('kexo-date-menu');
      if (!sel || !menu) return;
      if (menu.getAttribute('data-kexo-bound') === '1') return;
      menu.setAttribute('data-kexo-bound', '1');

      menu.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('[data-range]') : null;
        if (!btn) return;
        const v = String(btn.getAttribute('data-range') || '').trim();
        if (!v) return;
        if (btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true') return;
        sel.value = v;
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
        syncHeaderDateDisplay();
        syncHeaderDateMenuAvailability();
      });

      syncHeaderDateDisplay();
      syncHeaderDateMenuAvailability();
    }

    function syncDateSelectOptions() {
      const sel = document.getElementById('global-date-select');
      if (!sel) return;
      const hasLive = sel.querySelector('option[value="live"]');
      if (hasLive) hasLive.remove();
      // Keep the "Custom" option stable, and create a dynamic option for the currently applied custom range.
      const customOpt = document.getElementById('date-opt-custom') || sel.querySelector('option[value="custom"]');
      if (customOpt) customOpt.textContent = 'Custom';

      // Remove previous dynamic custom-range option(s).
      sel.querySelectorAll('option[data-custom-range="1"]').forEach(function(o) { try { o.remove(); } catch (_) {} });

      // Normalize legacy single-day custom keys into the new range key.
      if (isCustomDayRangeKey(dateRange)) {
        const ymd = ymdFromDayKey(dateRange);
        const rk = ymd ? makeRangeKeyFromYmds(ymd, ymd) : null;
        if (rk) dateRange = rk;
      }

      const applied = appliedYmdRangeFromDateRange();
      if (applied && applied.startYmd && applied.endYmd) {
        customRangeStartYmd = applied.startYmd;
        customRangeEndYmd = applied.endYmd;
        const label = formatYmdRangeLabel(applied.startYmd, applied.endYmd) || 'Selected dates';
        const opt = document.createElement('option');
        opt.value = String(dateRange);
        opt.textContent = label;
        opt.setAttribute('data-custom-range', '1');
        if (customOpt && customOpt.parentNode === sel) sel.insertBefore(opt, customOpt);
        else sel.appendChild(opt);
        sel.value = String(dateRange);
      } else if (activeMainTab === 'spy' || activeMainTab === 'sales' || activeMainTab === 'date') {
        // Table pages: dropdown stays on Today/Yesterday/Custom.
        sel.value = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : String(dateRange || 'today');
      } else {
        // Other tabs only use day/range ranges; if somehow on live, treat as Today.
        if (dateRange === 'live') {
          dateRange = 'today';
          sessionsTotal = null;
        }
        sel.value = (dateRange === 'live' || dateRange === 'sales' || dateRange === '1h') ? 'today' : String(dateRange || 'today');
      }

      // Apply user-configured labels/visibility for the standard date ranges.
      try { applyDateRangeUiConfigToSelect(sel); } catch (_) {}

      updateLiveViewTitle();
      updateRowsPerPageVisibility();
      syncHeaderDateDisplay();
      syncHeaderDateMenuAvailability();
    }

    function applyRangeAvailable(available) {
      const sel = document.getElementById('global-date-select');
      if (!sel) return;
      const keys = ['today', 'yesterday'];
      const allowYesterday = floorAllowsYesterday();
      if (dateRange === 'yesterday' && !allowYesterday) {
        dateRange = 'today';
        customRangeStartYmd = null;
        customRangeEndYmd = null;
        syncDateSelectOptions();
      }
      keys.forEach((key) => {
        const o = sel.querySelector('option[value="' + key + '"]');
        if (!o) return;
        const ok = key === 'yesterday' ? (allowYesterday && !!(available && available[key])) : !!(available && available[key]);
        o.disabled = !ok;
        try { o.hidden = (key === 'yesterday' && !allowYesterday); } catch (_) {}
      });

      if (dateRange !== 'live' && !isCustomDayRangeKey(dateRange) && !isCustomRangeKey(dateRange) && available && available[dateRange] === false) {
        dateRange = 'today';
        customRangeStartYmd = null;
        customRangeEndYmd = null;
        syncDateSelectOptions();
      }
      updateLiveViewTitle();
      updateRowsPerPageVisibility();
      syncHeaderDateDisplay();
      syncHeaderDateMenuAvailability();
    }

    // Custom date calendar (last 30 days, disabled if no data)
    let availableDaysMemo = null;
    let availableDaysMemoAt = 0;
    let availableDaysInflight = null;
    const AVAILABLE_DAYS_MEMO_TTL_MS = 60 * 1000;

    function fetchAvailableDays(days, opts = {}) {
      const force = !!opts.force;
      const now = Date.now();
      if (!force && availableDaysMemo && (now - availableDaysMemoAt) < AVAILABLE_DAYS_MEMO_TTL_MS) {
        return Promise.resolve(availableDaysMemo);
      }
      if (!force && availableDaysInflight) return availableDaysInflight;
      const url = API + '/api/available-days?days=' + encodeURIComponent(String(days || 30)) + (force ? ('&_=' + now) : '');
      const p = fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 20000)
        .then((r) => (r && r.ok) ? r.json() : null)
        .then((data) => {
          if (data && data.ok) {
            availableDaysMemo = data;
            availableDaysMemoAt = Date.now();
          }
          return data;
        })
        .catch(() => null)
        .finally(() => {
          if (availableDaysInflight === p) availableDaysInflight = null;
        });
      availableDaysInflight = p;
      return p;
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    // Flatpickr instance for custom date picker
    let flatpickrInstance = null;
    let availableDatesSet = new Set();
    let customDateApplyOverride = null; // function({ rangeKey, startYmd, endYmd })
    let customDatePrefillRangeKey = null;

    function initFlatpickrDatePicker(payload) {
      const input = document.getElementById('date-range-picker');
      if (!input) return;

      // Destroy existing instance
      if (flatpickrInstance) {
        flatpickrInstance.destroy();
        flatpickrInstance = null;
      }

      // Parse available days from API
      const data = payload && payload.ok ? payload : null;
      if (data && Array.isArray(data.days)) {
        availableDatesSet = new Set(
          data.days
            .filter(function(d) { return d && d.date && d.hasSessions; })
            .map(function(d) { return String(d.date); })
        );
      }

      // Wait for flatpickr to be available
      if (typeof flatpickr === 'undefined') {
        setTimeout(function() { initFlatpickrDatePicker(payload); }, 200);
        return;
      }

      // Initialize flatpickr
      flatpickrInstance = flatpickr(input, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        maxDate: 'today',
        minDate: MIN_YMD || '2025-02-01',
        disable: [
          function(date) {
            const y = date.getFullYear();
            const m = date.getMonth() + 1;
            const d = date.getDate();
            const ymd = y + '-' + pad2(m) + '-' + pad2(d);
            return !availableDatesSet.has(ymd);
          }
        ],
        onChange: function(selectedDates) {
          if (selectedDates.length === 0) {
            pendingCustomRangeStartYmd = null;
            pendingCustomRangeEndYmd = null;
            updateCustomDateFooter();
            return;
          }
          if (selectedDates.length === 1) {
            const d = selectedDates[0];
            const ymd = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
            pendingCustomRangeStartYmd = ymd;
            pendingCustomRangeEndYmd = null;
            updateCustomDateFooter();
            return;
          }
          if (selectedDates.length === 2) {
            const d1 = selectedDates[0];
            const d2 = selectedDates[1];
            const ymd1 = d1.getFullYear() + '-' + pad2(d1.getMonth() + 1) + '-' + pad2(d1.getDate());
            const ymd2 = d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());

            // Check 30-day limit
            const diffMs = Math.abs(d2 - d1);
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays > 30) {
              // Exceeded limit - reset
              flatpickrInstance.clear();
              pendingCustomRangeStartYmd = null;
              pendingCustomRangeEndYmd = null;
              updateCustomDateFooter();
              const summaryEl = document.getElementById('date-custom-summary');
              if (summaryEl) summaryEl.textContent = 'Range exceeds 30 days. Please select a shorter period.';
              return;
            }

            pendingCustomRangeStartYmd = ymd1 <= ymd2 ? ymd1 : ymd2;
            pendingCustomRangeEndYmd = ymd1 <= ymd2 ? ymd2 : ymd1;
            updateCustomDateFooter();
          }
        }
      });

      // Set initial dates if already selected
      if (pendingCustomRangeStartYmd && pendingCustomRangeEndYmd) {
        flatpickrInstance.setDate([pendingCustomRangeStartYmd, pendingCustomRangeEndYmd]);
      } else if (pendingCustomRangeStartYmd) {
        flatpickrInstance.setDate(pendingCustomRangeStartYmd);
      }
    }

    function closeCustomDateModal() {
      const modal = document.getElementById('date-custom-modal');
      if (!modal) return;
      modal.style.display = '';
      modal.classList.remove('show');
      document.body.classList.remove('modal-open');
      pendingCustomRangeStartYmd = null;
      pendingCustomRangeEndYmd = null;
      customDateApplyOverride = null;
      customDatePrefillRangeKey = null;
      if (flatpickrInstance) {
        flatpickrInstance.destroy();
        flatpickrInstance = null;
      }
      syncDateSelectOptions();
    }

    var timeframeOverlayToken = 0;
    function applyDateRangeChange(opts) {
      opts = opts && typeof opts === 'object' ? opts : {};
      var showTimeframeOverlay = opts.showTimeframeOverlay === true;
      if (PAGE === 'settings') showTimeframeOverlay = false;

      if (dateRange !== 'live') lastOnlineCount = null;
      countryPage = 1;
      bestGeoProductsPage = 1;
      aovPage = 1;
      bestSellersPage = 1;
      bestVariantsPage = 1;
      attributionPage = 1;
      devicesPage = 1;
      currentPage = 1;
      syncDateSelectOptions();
      // Reset caches when range changes.
      leaderboardCache = null;
      finishesCache = null;
      lengthsCache = null;
      chainStylesCache = null;
      bestSellersCache = null;
      bestVariantsCache = null;
      abandonedCartsChartKey = '';
      abandonedCartsTopCacheKey = '';
      attributionCache = null;
      devicesCache = null;
      lastStatsFetchedAt = 0;
      lastProductsFetchedAt = 0;
      lastAttributionFetchedAt = 0;
      lastDevicesFetchedAt = 0;
      updateNextUpdateUi();

      if (showTimeframeOverlay) {
        timeframeOverlayToken += 1;
        var token = timeframeOverlayToken;
        var dateLabel = 'date range';
        try {
          var applied = appliedYmdRangeFromDateRange();
          if (applied && applied.startYmd && applied.endYmd) {
            dateLabel = formatYmdRangeLabel(applied.startYmd, applied.endYmd) || dateLabel;
          } else {
            var fallback = { today: 'Today', yesterday: 'Yesterday', '7days': 'Last 7 days', '14days': 'Last 14 days', '30days': 'Last 30 days' };
            dateLabel = fallback[String(dateRange || 'today')] || 'Today';
          }
        } catch (_) {}
        var overlay = document.getElementById('page-body-loader');
        var titleEl = overlay && overlay.querySelector ? overlay.querySelector('.report-build-title') : null;
        var stepEl = document.getElementById('page-body-build-step');
        var indeterminateWrap = overlay && overlay.querySelector ? overlay.querySelector('.page-loader-progress:not(.page-loader-progress--determinate)') : null;
        var determinateWrap = document.getElementById('page-body-loader-determinate');
        var determinateBar = document.getElementById('page-body-loader-determinate-bar');
        if (titleEl) titleEl.textContent = 'Preparing ' + dateLabel + ' reports';
        if (stepEl) stepEl.textContent = 'Loading…';
        if (indeterminateWrap) indeterminateWrap.style.display = 'none';
        if (determinateWrap) { determinateWrap.style.display = ''; }
        if (determinateBar) { determinateBar.style.width = '0%'; determinateBar.setAttribute('aria-valuenow', 0); }
        if (overlay) {
          overlay.classList.remove('is-hidden');
          overlay.classList.add('timeframe-overlay');
        }
        var scope = document.querySelector('.page-body');
        if (scope) try { scope.classList.add('report-building'); } catch (_) {}
        try { document.body.classList.add('kexo-report-loading'); } catch (_) {}

        var promises = [];
        try { promises.push(refreshKpis({ force: true })); } catch (_) {}
        try {
          var kexoP = typeof window.refreshKexoScore === 'function' ? window.refreshKexoScore() : null;
          if (kexoP && typeof kexoP.then === 'function') promises.push(kexoP);
        } catch (_) {}
        var tabPromise = null;
        if (activeMainTab === 'stats') { try { tabPromise = refreshStats({ force: false }); } catch (_) {} }
        else if (activeMainTab === 'products') { try { tabPromise = refreshProducts({ force: false }); } catch (_) {} }
        else if (activeMainTab === 'attribution') { try { tabPromise = refreshAttribution({ force: false }); } catch (_) {} }
        else if (activeMainTab === 'devices') { try { tabPromise = refreshDevices({ force: false }); } catch (_) {} }
        else if (activeMainTab === 'browsers') { try { tabPromise = refreshBrowsers({ force: false }); } catch (_) {} }
        else if (activeMainTab === 'variants') {
          try { tabPromise = typeof window.__refreshVariantsInsights === 'function' ? window.__refreshVariantsInsights({ force: true }) : null; } catch (_) {}
        } else if (activeMainTab === 'abandoned-carts') { try { tabPromise = refreshAbandonedCarts({ force: true }); } catch (_) {} }
        if (tabPromise && typeof tabPromise.then === 'function') promises.push(tabPromise);
        if (activeMainTab === 'dashboard') { try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: false }); } catch (_) {} }
        if (activeMainTab === 'ads' || PAGE === 'ads') { try { if (window.__adsRefresh) window.__adsRefresh({ force: false }); } catch (_) {} }
        if (activeMainTab !== 'dashboard' && activeMainTab !== 'stats' && activeMainTab !== 'products' && activeMainTab !== 'attribution' && activeMainTab !== 'devices' && activeMainTab !== 'variants' && activeMainTab !== 'abandoned-carts') {
          updateKpis();
          try { fetchSessions(); } catch (_) {}
        }

        var total = Math.max(1, promises.length);
        var completed = 0;
        function updateProgress(pct) {
          if (timeframeOverlayToken !== token) return;
          var bar = document.getElementById('page-body-loader-determinate-bar');
          if (bar) { bar.style.width = pct + '%'; bar.setAttribute('aria-valuenow', Math.round(pct)); }
        }
        function hideTimeframeOverlay() {
          if (timeframeOverlayToken !== token) return;
          var ov = document.getElementById('page-body-loader');
          if (ov) { ov.classList.add('is-hidden'); ov.classList.remove('timeframe-overlay'); }
          var ind = ov && ov.querySelector ? ov.querySelector('.page-loader-progress:not(.page-loader-progress--determinate)') : null;
          if (ind) ind.style.display = '';
          var det = document.getElementById('page-body-loader-determinate');
          if (det) det.style.display = 'none';
          var detBar = document.getElementById('page-body-loader-determinate-bar');
          if (detBar) { detBar.style.width = '0%'; detBar.setAttribute('aria-valuenow', 0); }
          if (scope) try { scope.classList.remove('report-building'); } catch (_) {}
          try { document.body.classList.remove('kexo-report-loading'); } catch (_) {}
        }
        promises.forEach(function(p) {
          if (p && typeof p.finally === 'function') {
            p.finally(function() {
              completed += 1;
              updateProgress((completed / total) * 100);
              if (completed >= total) hideTimeframeOverlay();
            });
          } else {
            completed += 1;
            updateProgress((completed / total) * 100);
            if (completed >= total) hideTimeframeOverlay();
          }
        });
        if (promises.length === 0) {
          updateProgress(100);
          hideTimeframeOverlay();
        }
        updateKpis();
        return;
      }

      // Top KPI grid refreshes independently (every minute). On range change, force a refresh immediately.
      refreshKpis({ force: false });
      try { refreshKpiExtrasSoft(); } catch (_) {}
      try { if (typeof window.refreshKexoScore === 'function') window.refreshKexoScore(); } catch (_) {}
      // Keep the desktop navbar "visitors" status eager on every range change.
      updateKpis();

      if (activeMainTab === 'dashboard') {
        try { if (typeof refreshDashboard === 'function') refreshDashboard({ force: false }); } catch (_) {}
      } else if (activeMainTab === 'stats') {
        refreshStats({ force: false });
      } else if (activeMainTab === 'attribution') {
        try { refreshAttribution({ force: false }); } catch (_) {}
      } else if (activeMainTab === 'devices') {
        try { refreshDevices({ force: false }); } catch (_) {}
      } else if (activeMainTab === 'browsers') {
        try { refreshBrowsers({ force: false }); } catch (_) {}
      } else if (activeMainTab === 'products') {
        refreshProducts({ force: false });
      } else if (activeMainTab === 'variants') {
        try { if (typeof window.__refreshVariantsInsights === 'function') window.__refreshVariantsInsights({ force: true }); } catch (_) {}
      } else if (activeMainTab === 'abandoned-carts') {
        try { refreshAbandonedCarts({ force: true }); } catch (_) { fetchSessions(); }
      } else if (activeMainTab === 'ads' || PAGE === 'ads') {
        try { if (window.__adsRefresh) window.__adsRefresh({ force: false }); } catch (_) {}
      } else {
        updateKpis();
        fetchSessions();
      }
    }

    function openCustomDateModalFor(opts) {
      const o = opts && typeof opts === 'object' ? opts : {};
      customDateApplyOverride = (typeof o.onApply === 'function') ? o.onApply : null;
      customDatePrefillRangeKey = (o.prefillRangeKey != null) ? String(o.prefillRangeKey).trim().toLowerCase() : null;
      const modal = document.getElementById('date-custom-modal');
      const input = document.getElementById('date-range-picker');
      if (!modal || !input) return;
      modal.style.display = 'block';
      modal.classList.add('show');
      document.body.classList.add('modal-open');
      let applied = null;
      try {
        if (customDatePrefillRangeKey) {
          if (isCustomRangeKey(customDatePrefillRangeKey)) applied = ymdRangeFromRangeKey(customDatePrefillRangeKey);
          else if (isCustomDayRangeKey(customDatePrefillRangeKey)) {
            const ymd = ymdFromDayKey(customDatePrefillRangeKey);
            applied = ymd ? { startYmd: ymd, endYmd: ymd } : null;
          }
        }
      } catch (_) { applied = null; }
      if (!applied) applied = appliedYmdRangeFromDateRange();
      pendingCustomRangeStartYmd = applied && applied.startYmd && applied.startYmd >= MIN_YMD ? applied.startYmd : null;
      pendingCustomRangeEndYmd = applied && applied.endYmd && applied.endYmd >= MIN_YMD ? applied.endYmd : null;
      customCalendarLastPayload = null;
      updateCustomDateFooter();
      input.placeholder = 'Loading...';
      input.disabled = true;
      fetchAvailableDays(30).then((payload) => {
        customCalendarLastPayload = payload;
        initFlatpickrDatePicker(payload);
        input.placeholder = 'Select dates...';
        input.disabled = false;
        updateCustomDateFooter();
      });
    }

    function openCustomDateModal() {
      openCustomDateModalFor({});
    }

    function updateCustomDateFooter() {
      const summaryEl = document.getElementById('date-custom-summary');
      const clearBtn = document.getElementById('date-custom-clear');
      const applyBtn = document.getElementById('date-custom-apply');
      if (!summaryEl) return;
      const a = pendingCustomRangeStartYmd;
      const b = pendingCustomRangeEndYmd;
      if (!a) {
        summaryEl.textContent = 'Select a start date.';
        if (clearBtn) clearBtn.disabled = true;
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      if (!b) {
        summaryEl.textContent = 'Start: ' + formatYmdLabel(a) + '. Select an end date.';
        if (clearBtn) clearBtn.disabled = false;
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      const startYmd = a <= b ? a : b;
      const endYmd = a <= b ? b : a;
      summaryEl.textContent = 'Selected: ' + (formatYmdRangeLabel(startYmd, endYmd) || (startYmd + ' \u2013 ' + endYmd));
      if (clearBtn) clearBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
    }

    let customDateModalInited = false;
    function initCustomDateModal() {
      if (customDateModalInited) return;
      customDateModalInited = true;
      const modal = document.getElementById('date-custom-modal');
      if (!modal) return;
      const closeBtn = document.getElementById('date-custom-close-btn');
      if (closeBtn) closeBtn.addEventListener('click', function(e) { e.preventDefault(); closeCustomDateModal(); });
      modal.addEventListener('click', function(e) {
        if (e && e.target === modal) closeCustomDateModal();
      });
      document.addEventListener('keydown', function(e) {
        if (!modal.classList.contains('show')) return;
        const key = e && (e.key || e.code) ? String(e.key || e.code) : '';
        if (key === 'Escape') closeCustomDateModal();
      });
      const clearBtn = document.getElementById('date-custom-clear');
      const applyBtn = document.getElementById('date-custom-apply');
      if (clearBtn) {
        clearBtn.addEventListener('click', function(e) {
          e.preventDefault();
          pendingCustomRangeStartYmd = null;
          pendingCustomRangeEndYmd = null;
          if (flatpickrInstance) flatpickrInstance.clear();
          updateCustomDateFooter();
        });
      }
      if (applyBtn) {
        applyBtn.addEventListener('click', function(e) {
          e.preventDefault();
          const a = pendingCustomRangeStartYmd;
          const b = pendingCustomRangeEndYmd;
          if (!a || !b) return;
          const startYmd = a <= b ? a : b;
          const endYmd = a <= b ? b : a;
          if (startYmd < MIN_YMD || endYmd < MIN_YMD) return;
          const rk = makeRangeKeyFromYmds(startYmd, endYmd);
          if (!rk) return;
          const override = customDateApplyOverride;
          if (typeof override === 'function') {
            closeCustomDateModal();
            try { override({ rangeKey: rk, startYmd: startYmd, endYmd: endYmd }); } catch (_) {}
            return;
          }
          customRangeStartYmd = startYmd;
          customRangeEndYmd = endYmd;
          dateRange = rk;
          closeCustomDateModal();
          applyDateRangeChange({ showTimeframeOverlay: true });
        });
      }
      // Flatpickr handles date selection via its own UI
    }

    try { window.__kexoOpenCustomDateModalFor = openCustomDateModalFor; } catch (_) {}

    function maybeTriggerSaleToastFromStatsLikeData(data) {
      const conv = data && data.convertedCount ? data.convertedCount : {};
      const haveToday = (typeof conv.today === 'number' && Number.isFinite(conv.today));
      if (!haveToday) return;

      // Reset the converted-count baseline daily (admin TZ).
      try {
        const day = ymdNowInTz();
        if (convertedCountDayYmd == null) convertedCountDayYmd = day;
        if (day && convertedCountDayYmd !== day) {
          convertedCountDayYmd = day;
          hasSeenConvertedCountToday = false;
          lastConvertedCountToday = 0;
        }
      } catch (_) {}

      // Guard against stale/cache drift where counts briefly move backwards (would cause double "sale" sounds).
      if (hasSeenConvertedCountToday && conv.today < lastConvertedCountToday) return;

      const increased = hasSeenConvertedCountToday && conv.today > lastConvertedCountToday;
      if (increased) {
        const statsTodayKey = 'stats:today:' + String(conv.today);
        fetchLatestSaleForToast({ forceNew: true })
          .then(function(sale) {
            if (!sale) return;
            triggerSaleToast({
              origin: 'stats',
              playSound: true,
              soundDedupeKey: statsTodayKey,
              toastDedupeKey: statsTodayKey,
              latestSale: sale,
              payload: buildSaleToastPayloadFromSale(sale),
              skipLatest: true,
            });
          })
          .catch(function() {});
        // Keep Home tables in sync when a toast fires outside SSE (Today/Sales/Live).
        if (activeMainTab === 'spy' && (dateRange === 'today' || dateRange === 'sales' || dateRange === 'live' || dateRange === '1h')) {
          try { fetchSessions(); } catch (_) {}
        }
        // Pull the authoritative timestamp (truth/evidence) so the footer is accurate.
        try { refreshConfigStatus(); } catch (_) {}
      }
      lastConvertedCountToday = conv.today;
      hasSeenConvertedCountToday = true;
    }

    function setLiveKpisLoading() {
      const spinner = '<span class="kpi-mini-spinner" aria-hidden="true"></span>';
      const ids = [
        'cond-kpi-orders',
        'cond-kpi-revenue',
        'cond-kpi-profit',
        'cond-kpi-sessions',
        'cond-kpi-conv',
        'cond-kpi-vpv',
        'cond-kpi-roas',
        'cond-kpi-returning',
        'cond-kpi-aov',
        'cond-kpi-cogs',
        'cond-kpi-bounce',
        'cond-kpi-items-sold',
        'cond-kpi-orders-fulfilled',
        'cond-kpi-returns',
      ];
      ids.forEach(function(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.removeAttribute('data-odometer');
        el.innerHTML = spinner;
      });
    }

    function renderStats(data) {
      statsCache = data || {};
      // IMPORTANT: keep the condensed KPI strip sourced from /api/kpis so compare windows
      // and truth semantics remain consistent across all pages. Stats payload is optimized
      // for reports/tables and may not include compare (or may differ from truth sources).
      maybeTriggerSaleToastFromStatsLikeData(statsCache);
      if (statsCache.rangeAvailable) applyRangeAvailable(statsCache.rangeAvailable);
      renderCountriesMapChart(statsCache);
      renderCountry(statsCache);
      renderBestGeoProducts(statsCache);
      renderAov(statsCache);
      renderLiveKpis(getKpiData());
      scheduleBreakdownSync();
    }

    function kpiDelta(current, baseline) {
      const cur = typeof current === 'number' ? current : NaN;
      const base = typeof baseline === 'number' ? baseline : NaN;
      if (!Number.isFinite(cur) || !Number.isFinite(base)) return null;
      const diff = cur - base;
      if (diff === 0) return 0;
      if (base <= 0) return diff > 0 ? 1 : -1;
      return diff / base;
    }

    // Treat small changes as "stable" (blue/flat) instead of flipping colors.
    // KPI deltas often jitter in short windows (Today/1h), so we use a deadband.
    const KPI_STABLE_RATIO = 0.05; // ??5% relative change
    const KPI_STABLE_PCT = 5; // ??5 percentage points (already-percent deltas)
    const DASHBOARD_NEUTRAL_DELTA_KEYS = new Set(['cogs', 'fulfilled', 'returns', 'items']);
    const DASHBOARD_NEUTRAL_TONE_HEX = '#999';
    let runtimeProfitKpiAllowed = false;

    function setRuntimeProfitKpiAllowed(nextAllowed) {
      var allowed = !!nextAllowed;
      if (runtimeProfitKpiAllowed === allowed) return;
      runtimeProfitKpiAllowed = allowed;
      try {
        if (kpiUiConfigV1 && kpiUiConfigV1.v === 1) {
          applyCondensedKpiUiConfig(kpiUiConfigV1);
          applyDashboardKpiUiConfig(kpiUiConfigV1);
        }
      } catch (_) {}
    }

    function cssVarColor(name, fallback) {
      try {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
      } catch (_) {
        return fallback;
      }
    }

    function kpiDeltaToneColor(dir, bundleKey) {
      if (bundleKey) return chartsKpiToneColor(bundleKey, dir);
      const d = String(dir || '').toLowerCase();
      if (d === 'up') {
        return cssVarColor('--kexo-kpi-delta-up', cssVarColor('--kexo-accent-2', '#3eb3ab'));
      }
      if (d === 'down') {
        return cssVarColor('--kexo-kpi-delta-down', cssVarColor('--kexo-accent-4', '#e4644b'));
      }
      return cssVarColor('--kexo-kpi-delta-same', cssVarColor('--kexo-accent-1', '#4b94e4'));
    }

    function normalizeIconStyleClass(value, fallback) {
      const raw = value == null ? '' : String(value).trim().toLowerCase();
      if (!raw) return fallback;
      if (raw.indexOf('fa-jelly-filled') >= 0 || raw === 'jelly-filled') return 'fa-jelly-filled';
      if (raw.indexOf('fa-jelly') >= 0 || raw === 'jelly') return 'fa-jelly';
      if (raw.indexOf('fa-solid') >= 0 || raw === 'solid') return 'fa-solid';
      if (raw.indexOf('fa-light') >= 0 || raw === 'light') return 'fa-light';
      if (raw.indexOf('fa-brands') >= 0 || raw === 'brands' || raw === 'brand') return 'fa-brands';
      return fallback;
    }

    function getStoredIconStyleClass(lsSuffix, fallback) {
      let v = null;
      try { v = localStorage.getItem('tabler-theme-' + lsSuffix); } catch (_) { v = null; }
      return normalizeIconStyleClass(v, fallback);
    }

    function sanitizeIconClassString(value) {
      return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    }

    function isFontAwesomeSubsetToken(token) {
      return token === 'fa-sharp' || token === 'fa-sharp-light' || token === 'fa-sharp-regular' ||
        token === 'fa-sharp-solid' || token === 'fa-sharp-thin' || token === 'fa-sharp-duotone';
    }

    function isIconStyleToken(token) {
      return token === 'fa-jelly' || token === 'fa-jelly-filled' || token === 'fa-light' ||
        token === 'fa-solid' || token === 'fa-brands' || token === 'fa-regular' ||
        token === 'fa-thin' || token === 'fa-duotone' || isFontAwesomeSubsetToken(token) ||
        token === 'fas' || token === 'far' || token === 'fal' || token === 'fab' ||
        token === 'fat' || token === 'fad';
    }

    function parseIconGlyphInput(value, fallbackGlyph) {
      const raw = sanitizeIconClassString(value).toLowerCase();
      const safeFallback = fallbackGlyph || 'fa-circle';
      if (!raw) return { mode: 'glyph', value: safeFallback };
      const tokens = raw.split(/\s+/).filter(Boolean);
      const faTokens = tokens.filter(function (t) {
        return t === 'fa' || t.indexOf('fa-') === 0 || t === 'fas' || t === 'far' ||
          t === 'fal' || t === 'fab' || t === 'fat' || t === 'fad';
      });
      const hasExplicitStyle = tokens.some(isIconStyleToken);
      if (hasExplicitStyle || faTokens.length >= 2) {
        const full = tokens.slice();
        const hasGlyph = full.some(function (t) { return t.indexOf('fa-') === 0 && !isIconStyleToken(t); });
        if (!hasGlyph) full.push(safeFallback);
        return { mode: 'full', value: full.join(' ') };
      }
      const m = raw.match(/fa-[a-z0-9-]+/);
      if (m && m[0]) return { mode: 'glyph', value: m[0] };
      if (/^[a-z0-9-]+$/.test(raw)) return { mode: 'glyph', value: 'fa-' + raw };
      return { mode: 'glyph', value: safeFallback };
    }

    function applyIconClassSpec(iconEl, classSpec, styleFallback, glyphFallback) {
      if (!iconEl) return;
      const keep = [];
      Array.prototype.forEach.call(iconEl.classList, function (cls) {
        if (cls === 'fa' || cls === 'fas' || cls === 'far' || cls === 'fal' || cls === 'fab' || cls === 'fat' || cls === 'fad') return;
        if (cls.indexOf('fa-') === 0) return;
        keep.push(cls);
      });
      const tokens = sanitizeIconClassString(classSpec).toLowerCase().split(/\s+/).filter(Boolean);
      const parsed = tokens.length ? tokens : [styleFallback || 'fa-jelly', glyphFallback || 'fa-circle'];
      let hasStyle = false;
      let hasGlyph = false;
      parsed.forEach(function (t) {
        if (isIconStyleToken(t)) hasStyle = true;
        if (t.indexOf('fa-') === 0 && !isIconStyleToken(t)) hasGlyph = true;
      });
      if (!hasStyle) parsed.unshift(styleFallback || 'fa-jelly');
      if (!hasGlyph) parsed.push(glyphFallback || 'fa-circle');
      iconEl.className = keep.concat(parsed).join(' ').trim();
    }

    function applyCondensedKpiDelta(key, current, baseline, invert) {
      const deltaEl = document.getElementById('cond-kpi-' + key + '-delta');
      const barEl = document.getElementById('cond-kpi-' + key + '-bar');
      if (!deltaEl && !barEl) return;

      const cur = typeof current === 'number' && Number.isFinite(current) ? current : null;
      const base = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : null;
      const rawDelta = (cur != null && base != null) ? kpiDelta(cur, base) : null;
      let toneDelta = null;
      if (cur != null && base != null) {
        const diff = cur - base;
        const denom = Math.abs(base);
        toneDelta = denom > 1e-9 ? (diff / denom) : (diff === 0 ? 0 : (diff > 0 ? 1 : -1));
        if (invert) toneDelta = -toneDelta;
      }
      const isNew = cur != null && base === 0 && cur !== 0;
      const isUp = isNew || (toneDelta != null && toneDelta > KPI_STABLE_RATIO);
      const isDown = !isNew && toneDelta != null && toneDelta < -KPI_STABLE_RATIO;
      const isFlat = !isNew && toneDelta != null && !isUp && !isDown;

      if (deltaEl) {
        const textEl = deltaEl.querySelector('.kexo-kpi-chip-delta-text');
        let text = '\u2014';
        let dir = 'none';

        if (rawDelta != null) {
          text = isNew ? 'new' : formatSignedPercentOneDecimalFromRatio(rawDelta);
          dir = isUp ? 'up' : (isDown ? 'down' : 'flat');
        }

        deltaEl.classList.remove('is-up', 'is-down', 'is-flat');
        if (dir === 'up') deltaEl.classList.add('is-up');
        else if (dir === 'down') deltaEl.classList.add('is-down');
        else if (dir === 'flat') deltaEl.classList.add('is-flat');
        deltaEl.setAttribute('data-dir', dir);
        try {
          var styleCfg = getChartsKpiBundle('headerStrip').deltaStyle;
          var toneColor = chartsKpiToneColor('headerStrip', dir === 'none' ? 'same' : dir);
          deltaEl.style.fontSize = String(styleCfg.fontSize) + 'px';
          deltaEl.style.fontWeight = String(styleCfg.fontWeight);
          deltaEl.style.color = styleCfg.fontColor || toneColor;
          var iconEl = deltaEl.querySelector('i');
          if (iconEl) {
            iconEl.style.fontSize = String(styleCfg.iconSize) + 'px';
            iconEl.style.color = styleCfg.iconColor || toneColor;
          }
        } catch (_) {}
        if (textEl) textEl.textContent = text;
        else deltaEl.textContent = text;
      }

      if (barEl) {
        barEl.classList.remove('bg-success', 'bg-danger', 'bg-secondary');
        const progressEl = (barEl.closest && barEl.closest('.progress')) ? barEl.closest('.progress') : null;
        const srText = barEl.querySelector ? barEl.querySelector('.visually-hidden') : null;

        // When compare is missing, avoid misleading "0% complete" semantics.
        if (rawDelta == null) {
          if (progressEl) progressEl.classList.add('is-hidden');
          barEl.style.width = '0%';
          barEl.classList.add('bg-secondary');
          barEl.setAttribute('aria-valuenow', '0');
          barEl.setAttribute('aria-label', 'No comparison available');
          if (srText) srText.textContent = 'No comparison available';
          return;
        }

        if (progressEl) progressEl.classList.remove('is-hidden');
        let widthPct = 0;
        let barClass = 'bg-secondary';
        const deltaPctAbs = Number.isFinite(rawDelta) ? (Math.round(Math.abs(rawDelta) * 1000) / 10) : null;

        if (!isFlat) {
          widthPct = isNew ? 100 : Math.max(6, Math.min(100, Math.round(Math.abs(rawDelta) * 100)));
          barClass = isUp ? 'bg-success' : 'bg-danger';
        }

        barEl.style.width = String(widthPct) + '%';
        barEl.classList.add(barClass);
        barEl.setAttribute('aria-valuenow', String(widthPct));
        if (isNew) {
          barEl.setAttribute('aria-label', 'New metric (baseline was 0)');
          if (srText) srText.textContent = 'New metric (baseline was 0)';
        } else if (deltaPctAbs != null) {
          barEl.setAttribute('aria-label', String(deltaPctAbs) + '% change');
          if (srText) srText.textContent = String(deltaPctAbs) + '% change';
        } else {
          barEl.setAttribute('aria-label', String(widthPct) + '% change');
          if (srText) srText.textContent = String(widthPct) + '% change';
        }
      }
    }

    var condensedSeriesCache = null;
    var condensedSeriesRange = null;
    var condensedSeriesFetchedAt = 0;
    var condensedSparklineOverrides = {};
    var sparklineHistorySeriesCache = null;
    var sparklineHistorySeriesRange = null;
    var sparklineHistorySeriesFetchedAt = 0;
    var sparklineHistorySeriesInFlight = null;

    function getSparklineSeries(series) {
      if (Array.isArray(series) && series.length >= 2) return series;
      if (Array.isArray(sparklineHistorySeriesCache) && sparklineHistorySeriesCache.length >= 2) return sparklineHistorySeriesCache;
      return Array.isArray(series) ? series : [];
    }

    function getSparklineFallbackRangeKey() {
      var rk = normalizeRangeKeyForApi(getStatsRange());
      if (!rk || rk === 'today' || rk === 'yesterday' || rk === '1h' || /^d:\d{4}-\d{2}-\d{2}$/.test(rk)) return '7d';
      return rk;
    }

    function ensureSparklineHistorySeries() {
      var fallbackRange = getSparklineFallbackRangeKey();
      var stale = !sparklineHistorySeriesFetchedAt || (Date.now() - sparklineHistorySeriesFetchedAt) > KPI_CACHE_TTL_MS;
      if (!stale && sparklineHistorySeriesRange === fallbackRange && sparklineHistorySeriesCache && sparklineHistorySeriesCache.length >= 2) {
        return Promise.resolve(sparklineHistorySeriesCache);
      }
      if (sparklineHistorySeriesInFlight) return sparklineHistorySeriesInFlight;
      sparklineHistorySeriesInFlight = fetchWithTimeout(API + '/api/dashboard-series?range=' + encodeURIComponent(fallbackRange), { credentials: 'same-origin', cache: 'default' }, 15000)
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
          var s = data && Array.isArray(data.series) ? data.series : [];
          if (s.length >= 2) {
            sparklineHistorySeriesCache = s;
            sparklineHistorySeriesRange = fallbackRange;
            sparklineHistorySeriesFetchedAt = Date.now();
          }
          return sparklineHistorySeriesCache;
        })
        .catch(function() { return sparklineHistorySeriesCache; })
        .finally(function() { sparklineHistorySeriesInFlight = null; });
      return sparklineHistorySeriesInFlight;
    }

    function renderCondensedSparklines(series) {
      if (typeof ApexCharts === 'undefined') return;
      var sourceSeries = getSparklineSeries(series);
      if (!sourceSeries || !sourceSeries.length) return;
      var bundleCfg = getChartsKpiBundle('headerStrip');
      var sparkCfg = bundleCfg.sparkline || defaultChartsKpiSparklineConfig('headerStrip');
      var GREEN = bundleCfg.palette && bundleCfg.palette.up ? bundleCfg.palette.up : kpiDeltaToneColor('up');
      var RED = bundleCfg.palette && bundleCfg.palette.down ? bundleCfg.palette.down : kpiDeltaToneColor('down');
      var NEUTRAL = bundleCfg.palette && bundleCfg.palette.same ? bundleCfg.palette.same : kpiDeltaToneColor('flat');
      var map = {
        'cond-kpi-orders-sparkline': function(d) { return d.orders; },
        'cond-kpi-revenue-sparkline': function(d) { return d.revenue; },
        'cond-kpi-profit-sparkline': function() { return null; },
        'cond-kpi-conv-sparkline': function(d) { return d.convRate; },
        'cond-kpi-vpv-sparkline': function(d) {
          var rev = d && typeof d.revenue === 'number' ? d.revenue : 0;
          var sess = d && typeof d.sessions === 'number' ? d.sessions : 0;
          return (sess > 0) ? (rev / sess) : null;
        },
        'cond-kpi-roas-sparkline': function(d) {
          var spend = d && typeof d.adSpend === 'number' ? d.adSpend : 0;
          var rev = d && typeof d.revenue === 'number' ? d.revenue : 0;
          return (spend > 0) ? (rev / spend) : 0;
        },
        'cond-kpi-sessions-sparkline': function(d) { return d.sessions; },
        'cond-kpi-returning-sparkline': function(d) { return d.returningCustomerOrders || 0; },
        'cond-kpi-aov-sparkline': function(d) { return d.aov; },
        'cond-kpi-cogs-sparkline': function() { return null; },
        'cond-kpi-bounce-sparkline': function(d) { return d.bounceRate; },
        'cond-kpi-orders-fulfilled-sparkline': function() { return null; },
        'cond-kpi-returns-sparkline': function() { return null; },
        'cond-kpi-items-sold-sparkline': function(d) { return d.units || 0; }
      };
      Object.keys(map).forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var overrideData = condensedSparklineOverrides && Array.isArray(condensedSparklineOverrides[id]) ? condensedSparklineOverrides[id] : null;
        var dataArr = overrideData && overrideData.length ? overrideData.slice() : sourceSeries.map(map[id]);
        if (dataArr.length < 2) dataArr = dataArr.length === 1 ? [dataArr[0], dataArr[0]] : [0, 0];
        var tone = String(el.getAttribute('data-tone') || '').toLowerCase();
        if (tone !== 'up' && tone !== 'down') {
          tone = 'neutral';
        }
        var sparkColor = tone === 'down' ? RED : (tone === 'up' ? GREEN : NEUTRAL);
        el.innerHTML = '';
        if (typeof window.kexoRenderSparkline === 'function') {
          try {
            window.kexoRenderSparkline({
              containerEl: el,
              data: dataArr,
              color: sparkColor,
              height: Number(sparkCfg.height) || 30,
              mode: sparkCfg.mode || 'line',
              curve: sparkCfg.curve || 'smooth',
              strokeWidth: sparkCfg.strokeWidth,
              showCompare: false,
              advancedApexOverride: sparkCfg.advancedApexOverride || {}
            });
            return;
          } catch (_) {}
        }
        try {
          var chart = new ApexCharts(el, {
            chart: { type: sparkCfg.mode || 'line', height: Number(sparkCfg.height) || 30, sparkline: { enabled: true }, animations: { enabled: false } },
            series: [{ data: dataArr }],
            stroke: { show: true, width: Number(sparkCfg.strokeWidth) || 2.15, curve: sparkCfg.curve || 'smooth', lineCap: 'round' },
            // NOTE: ApexCharts 4.x can incorrectly apply fill opacity to line stroke color.
            // Keep fill opacity at 1 for visible strokes; line charts still render line-only.
            fill: { type: 'solid', opacity: 1 },
            colors: [sparkColor],
            markers: { size: 0 },
            grid: { padding: { top: 0, right: 0, bottom: -2, left: 0 } },
            tooltip: { enabled: true }
          });
          chart.render();
        } catch (_) {}
      });
    }

    function fetchCondensedSeries() {
      var rangeKey = getStatsRange();
      if (!rangeKey) return;
      var stale = !condensedSeriesFetchedAt || (Date.now() - condensedSeriesFetchedAt) > KPI_CACHE_TTL_MS;
      if (!stale && condensedSeriesCache && condensedSeriesRange === rangeKey) {
        renderCondensedSparklines(condensedSeriesCache);
        return;
      }
      fetchWithTimeout(API + '/api/dashboard-series?range=' + encodeURIComponent(rangeKey), { credentials: 'same-origin', cache: 'default' }, 15000)
        .then(function(r) { return r && r.ok ? r.json() : null; })
        .then(function(data) {
          var s = data && data.series ? data.series : null;
          if (s && s.length) {
            condensedSeriesCache = s;
            condensedSeriesRange = rangeKey;
            condensedSeriesFetchedAt = Date.now();
            renderCondensedSparklines(s);
            if (s.length < 2) {
              ensureSparklineHistorySeries().then(function(historySeries) {
                if (historySeries && historySeries.length >= 2) renderCondensedSparklines(s);
              }).catch(function() {});
            }
          }
        })
        .catch(function() {});
    }

    function renderLiveKpis(data) {
      const sales = data && data.sales ? data.sales : {};
      const convertedCountMap = data && data.convertedCount ? data.convertedCount : {};
      const returningCustomerCountMap = data && data.returningCustomerCount ? data.returningCustomerCount : {};
      const breakdown = data && data.trafficBreakdown ? data.trafficBreakdown : {};
      const conv = data && data.conversion ? data.conversion : {};
      const vpvMap = data && data.vpv ? data.vpv : {};
      const aovMap = data && data.aov ? data.aov : {};
      const bounceMap = data && data.bounce ? data.bounce : {};
      const costMap = data && data.cost ? data.cost : {};
      const profitMap = data && data.profit ? data.profit : {};
      const condOrdersEl = document.getElementById('cond-kpi-orders');
      const condRevenueEl = document.getElementById('cond-kpi-revenue');
      const condProfitEl = document.getElementById('cond-kpi-profit');
      const condConvEl = document.getElementById('cond-kpi-conv');
      const condVpvEl = document.getElementById('cond-kpi-vpv');
      const condSessionsEl = document.getElementById('cond-kpi-sessions');
      const condReturningEl = document.getElementById('cond-kpi-returning');
      const condAovEl = document.getElementById('cond-kpi-aov');
      const condRoasEl = document.getElementById('cond-kpi-roas');
      const condBounceEl = document.getElementById('cond-kpi-bounce');
      const topbarOrdersEl = document.getElementById('topbar-kpi-orders');
      const topbarClicksEl = document.getElementById('topbar-kpi-clicks');
      const topbarConvEl = document.getElementById('topbar-kpi-conv');
      const topbarOrdersDeltaEl = document.getElementById('topbar-kpi-orders-delta');
      const topbarOrdersDeltaTextEl = document.getElementById('topbar-kpi-orders-delta-text');
      const topbarClicksDeltaEl = document.getElementById('topbar-kpi-clicks-delta');
      const topbarClicksDeltaTextEl = document.getElementById('topbar-kpi-clicks-delta-text');
      const topbarConvDeltaEl = document.getElementById('topbar-kpi-conv-delta');
      const topbarConvDeltaTextEl = document.getElementById('topbar-kpi-conv-delta-text');
      const kpiRange = getStatsRange();
      const profitKpiAllowed = !!(data && data.profitKpiAllowed === true);
      setRuntimeProfitKpiAllowed(profitKpiAllowed);
      const forRange = breakdown[kpiRange];
      const sessionsVal = forRange != null && typeof forRange.human_sessions === 'number' ? forRange.human_sessions : null;
      const orderCountVal = typeof convertedCountMap[kpiRange] === 'number' ? convertedCountMap[kpiRange] : null;
      const revenueVal = typeof sales[kpiRange] === 'number' ? sales[kpiRange] : null;
      const costVal = typeof costMap[kpiRange] === 'number' ? costMap[kpiRange] : null;
      let profitVal = typeof profitMap[kpiRange] === 'number' ? profitMap[kpiRange] : null;
      if (profitVal == null && revenueVal != null && costVal != null) {
        profitVal = Math.round((revenueVal - costVal) * 100) / 100;
      }
      if (!profitKpiAllowed) profitVal = null;
      const returningVal = typeof returningCustomerCountMap[kpiRange] === 'number' ? returningCustomerCountMap[kpiRange] : null;
      const convVal = typeof conv[kpiRange] === 'number' ? conv[kpiRange] : null;
      const vpvVal = typeof vpvMap[kpiRange] === 'number' ? vpvMap[kpiRange] : null;
      const aovVal = typeof aovMap[kpiRange] === 'number' ? aovMap[kpiRange] : null;
      const roasVal = data && data.roas && typeof data.roas[kpiRange] === 'number' ? data.roas[kpiRange] : null;
      const bounceVal = typeof bounceMap[kpiRange] === 'number' ? bounceMap[kpiRange] : null;
      const compare = data && data.compare ? data.compare : null;
      const compareBreakdown = compare && compare.trafficBreakdown ? compare.trafficBreakdown : null;
      const compareSessionsVal = compareBreakdown && typeof compareBreakdown.human_sessions === 'number' ? compareBreakdown.human_sessions : null;
      const compareOrdersVal = compare && typeof compare.convertedCount === 'number' ? compare.convertedCount : null;
      const compareRevenueVal = compare && typeof compare.sales === 'number' ? compare.sales : null;
      const compareCostVal = compare && typeof compare.cost === 'number' ? compare.cost : null;
      let compareProfitVal = compare && typeof compare.profit === 'number' ? compare.profit : null;
      if (compareProfitVal == null && compareRevenueVal != null && compareCostVal != null) {
        compareProfitVal = Math.round((compareRevenueVal - compareCostVal) * 100) / 100;
      }
      if (!profitKpiAllowed) compareProfitVal = null;
      const compareReturningVal = compare && typeof compare.returningCustomerCount === 'number' ? compare.returningCustomerCount : null;
      const compareConvVal = compare && typeof compare.conversion === 'number' ? compare.conversion : null;
      const compareVpvVal = compare && typeof compare.vpv === 'number' ? compare.vpv : null;
      const compareAovVal = compare && typeof compare.aov === 'number' ? compare.aov : null;
      const compareRoasVal = compare && typeof compare.roas === 'number' ? compare.roas : null;
      const compareBounceVal = compare && typeof compare.bounce === 'number' ? compare.bounce : null;
      function setCondensedSparklineTone(id, current, baseline, invert) {
        const sparkEl = document.getElementById(id);
        if (!sparkEl) return;
        const cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
        const base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
        if (cur == null || base == null) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        const delta = invert ? (base - cur) : (cur - base);
        if (Math.abs(delta) < 1e-9) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        const denom = Math.abs(base);
        if (denom > 1e-9) {
          const ratio = delta / denom;
          if (Math.abs(ratio) <= KPI_STABLE_RATIO) {
            sparkEl.removeAttribute('data-tone');
            return;
          }
        }
        sparkEl.setAttribute('data-tone', delta < 0 ? 'down' : 'up');
      }

      if (condOrdersEl) condOrdersEl.textContent = orderCountVal != null ? formatSessions(orderCountVal) : '\u2014';
      if (condRevenueEl) condRevenueEl.textContent = revenueVal != null ? formatRevenue(revenueVal) : '\u2014';
      if (condProfitEl) condProfitEl.textContent = profitVal != null ? formatRevenue(profitVal) : '\u2014';
      if (condSessionsEl) condSessionsEl.textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (condConvEl) condConvEl.textContent = convVal != null ? pct(convVal) : '\u2014';
      if (condVpvEl) condVpvEl.textContent = vpvVal != null ? formatRevenue(vpvVal) : '\u2014';
      if (condReturningEl) condReturningEl.textContent = returningVal != null ? formatSessions(returningVal) : '\u2014';
      if (condAovEl) condAovEl.textContent = aovVal != null ? formatRevenue(aovVal) : '\u2014';
      if (condRoasEl) condRoasEl.textContent = roasVal != null ? Number(roasVal).toFixed(2) + 'x' : '\u2014';
      if (condBounceEl) condBounceEl.textContent = bounceVal != null ? pct(bounceVal) : '\u2014';
      applyCondensedKpiDelta('orders', orderCountVal, compareOrdersVal, false);
      applyCondensedKpiDelta('revenue', revenueVal, compareRevenueVal, false);
      applyCondensedKpiDelta('profit', profitVal, compareProfitVal, false);
      applyCondensedKpiDelta('sessions', sessionsVal, compareSessionsVal, false);
      applyCondensedKpiDelta('conv', convVal, compareConvVal, false);
      applyCondensedKpiDelta('vpv', vpvVal, compareVpvVal, false);
      applyCondensedKpiDelta('returning', returningVal, compareReturningVal, false);
      applyCondensedKpiDelta('aov', aovVal, compareAovVal, false);
      applyCondensedKpiDelta('roas', roasVal, compareRoasVal, false);
      applyCondensedKpiDelta('bounce', bounceVal, compareBounceVal, true);
      setCondensedSparklineTone('cond-kpi-orders-sparkline', orderCountVal, compareOrdersVal);
      setCondensedSparklineTone('cond-kpi-revenue-sparkline', revenueVal, compareRevenueVal);
      setCondensedSparklineTone('cond-kpi-profit-sparkline', profitVal, compareProfitVal);
      setCondensedSparklineTone('cond-kpi-conv-sparkline', convVal, compareConvVal);
      setCondensedSparklineTone('cond-kpi-vpv-sparkline', vpvVal, compareVpvVal);
      setCondensedSparklineTone('cond-kpi-roas-sparkline', roasVal, compareRoasVal);
      setCondensedSparklineTone('cond-kpi-sessions-sparkline', sessionsVal, compareSessionsVal);
      setCondensedSparklineTone('cond-kpi-returning-sparkline', returningVal, compareReturningVal);
      setCondensedSparklineTone('cond-kpi-aov-sparkline', aovVal, compareAovVal);
      setCondensedSparklineTone('cond-kpi-bounce-sparkline', bounceVal, compareBounceVal, true);
      if (!condensedSparklineOverrides || typeof condensedSparklineOverrides !== 'object') condensedSparklineOverrides = {};
      var profitSparkline = (data && Array.isArray(data.profitSparkline)) ? data.profitSparkline : null;
      if (!profitKpiAllowed) {
        condensedSparklineOverrides['cond-kpi-profit-sparkline'] = null;
      } else if (profitSparkline && profitSparkline.length >= 2) {
        condensedSparklineOverrides['cond-kpi-profit-sparkline'] = profitSparkline.slice();
      } else {
        condensedSparklineOverrides['cond-kpi-profit-sparkline'] = (profitVal != null && compareProfitVal != null)
          ? [compareProfitVal, profitVal]
          : null;
      }
      try { if (condensedSeriesCache) renderCondensedSparklines(condensedSeriesCache); } catch (_) {}
      try { updateCondensedKpiOverflow(); } catch (_) {}

      // Header quick KPIs (compact)
      if (topbarOrdersEl) topbarOrdersEl.textContent = orderCountVal != null ? formatSessions(orderCountVal) : '\u2014';
      if (topbarClicksEl) topbarClicksEl.textContent = sessionsVal != null ? formatSessions(sessionsVal) : '\u2014';
      if (topbarConvEl) topbarConvEl.textContent = convVal != null ? pct(convVal) : '\u2014';

      function deltaPct(curr, prev) {
        const c = (typeof curr === 'number' && Number.isFinite(curr)) ? curr : null;
        const p = (typeof prev === 'number' && Number.isFinite(prev)) ? prev : null;
        if (c == null || p == null) return null;
        // Avoid divide-by-zero: show "new" when baseline is 0 and current is non-zero.
        if (p === 0) return (c === 0) ? 0 : Infinity;
        return ((c - p) / p) * 100;
      }
      function applyTopbarDelta(deltaWrap, deltaTextEl, pctVal) {
        if (!deltaWrap || !deltaTextEl) return;
        var headerDeltaStyle = getChartsKpiBundle('headerStrip').deltaStyle;
        function applyHeaderTone(dir) {
          var tone = chartsKpiToneColor('headerStrip', dir);
          deltaWrap.style.fontSize = String(headerDeltaStyle.fontSize) + 'px';
          deltaWrap.style.fontWeight = String(headerDeltaStyle.fontWeight);
          deltaWrap.style.color = headerDeltaStyle.fontColor || tone;
          var iconEl = deltaWrap.querySelector('i');
          if (iconEl) {
            iconEl.style.fontSize = String(headerDeltaStyle.iconSize) + 'px';
            iconEl.style.color = headerDeltaStyle.iconColor || tone;
          }
        }
        if (pctVal == null || !Number.isFinite(pctVal)) {
          if (pctVal === Infinity) {
            deltaWrap.classList.remove('is-hidden');
            deltaWrap.classList.add('is-up');
            deltaWrap.classList.remove('is-down', 'is-flat');
            deltaTextEl.textContent = 'new';
            applyHeaderTone('up');
            return;
          }
          deltaWrap.classList.add('is-hidden');
          deltaWrap.classList.remove('is-up', 'is-down', 'is-flat');
          return;
        }
        const p = Math.round(pctVal * 10) / 10;
        const up = p > KPI_STABLE_PCT;
        const down = p < -KPI_STABLE_PCT;
        deltaWrap.classList.remove('is-hidden');
        deltaWrap.classList.toggle('is-up', up);
        deltaWrap.classList.toggle('is-down', down);
        deltaWrap.classList.toggle('is-flat', !up && !down);
        applyHeaderTone(up ? 'up' : (down ? 'down' : 'same'));
        deltaTextEl.textContent = Math.abs(p).toFixed(1).replace(/\.0$/, '') + '%';
      }

      applyTopbarDelta(
        topbarOrdersDeltaEl,
        topbarOrdersDeltaTextEl,
        deltaPct(orderCountVal, compareOrdersVal)
      );
      applyTopbarDelta(
        topbarClicksDeltaEl,
        topbarClicksDeltaTextEl,
        deltaPct(sessionsVal, compareSessionsVal)
      );
      applyTopbarDelta(
        topbarConvDeltaEl,
        topbarConvDeltaTextEl,
        deltaPct(convVal, compareConvVal)
      );
    }

    // Dashboard KPI cards:
    // - Left compare slot always uses true previous-period values from /api/kpis compare payload.
    // - Right compare slot is optional context (Previous 7 days) shown only on today/yesterday.
    let _dashKpiSecondaryFetchedAt = 0;
    let _dashKpiSecondaryInFlight = null;
    let _dashKpisSecondary = null; // /api/kpis?range=7d
    let _dashKpiExtrasSecondaryFetchedAt = 0;
    let _dashKpiExtrasSecondaryInFlight = null;
    let _dashKpiExtrasSecondary = null; // /api/kpis-expanded-extra?range=7d

    function fetchKpisForRangeKey(rangeKey) {
      rangeKey = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
      if (!rangeKey) rangeKey = 'today';
      const url = API + '/api/kpis?range=' + encodeURIComponent(rangeKey);
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) {
          if (!r || !r.ok) throw new Error('KPIs HTTP ' + (r ? r.status : '0'));
          return r.json();
        });
    }

    function fetchExpandedExtrasForRangeKey(rangeKey) {
      rangeKey = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
      if (!rangeKey) rangeKey = 'today';
      let url = API + '/api/kpis-expanded-extra?range=' + encodeURIComponent(rangeKey);
      try {
        const shop = getShopForSales();
        if (shop) url += '&shop=' + encodeURIComponent(shop);
      } catch (_) {}
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
        .then(function(r) {
          if (!r || !r.ok) throw new Error('KPI extras HTTP ' + (r ? r.status : '0'));
          return r.json();
        });
    }

    function ensureDashboardSecondaryKpis() {
      const ttlMs = 120 * 1000;
      const fresh = _dashKpiSecondaryFetchedAt && (Date.now() - _dashKpiSecondaryFetchedAt) < ttlMs;
      if (fresh && _dashKpisSecondary) return Promise.resolve(_dashKpisSecondary);
      if (_dashKpiSecondaryInFlight) return _dashKpiSecondaryInFlight;
      _dashKpiSecondaryInFlight = fetchKpisForRangeKey('7d')
        .catch(function() { return null; })
        .then(function(part) {
          _dashKpisSecondary = part || null;
          _dashKpiSecondaryFetchedAt = Date.now();
          return _dashKpisSecondary;
        }).finally(function() {
          _dashKpiSecondaryInFlight = null;
        });
      return _dashKpiSecondaryInFlight;
    }

    function ensureDashboardSecondaryExtras() {
      const ttlMs = 120 * 1000;
      const fresh = _dashKpiExtrasSecondaryFetchedAt && (Date.now() - _dashKpiExtrasSecondaryFetchedAt) < ttlMs;
      if (fresh && _dashKpiExtrasSecondary) return Promise.resolve(_dashKpiExtrasSecondary);
      if (_dashKpiExtrasSecondaryInFlight) return _dashKpiExtrasSecondaryInFlight;
      _dashKpiExtrasSecondaryInFlight = fetchExpandedExtrasForRangeKey('7d')
        .catch(function() { return null; })
        .then(function(part) {
          _dashKpiExtrasSecondary = part || null;
          _dashKpiExtrasSecondaryFetchedAt = Date.now();
          return _dashKpiExtrasSecondary;
        }).finally(function() {
          _dashKpiExtrasSecondaryInFlight = null;
        });
      return _dashKpiExtrasSecondaryInFlight;
    }

    function setDashboardCompareLabels(primaryLabel, secondaryLabel, showSecondary) {
      var p = String(primaryLabel || 'Previous period').trim() || 'Previous period';
      var s = String(secondaryLabel || 'Previous 7 days').trim() || 'Previous 7 days';
      document.querySelectorAll('.dash-kpi-compare-row').forEach(function(row) {
        if (!row) return;
        var items = row.querySelectorAll('.dash-kpi-compare-item');
        var left = items && items[0] ? items[0] : null;
        var right = items && items[1] ? items[1] : null;
        if (left) {
          var leftLabel = left.querySelector('.text-muted.small');
          if (leftLabel) leftLabel.textContent = p + ':';
        }
        if (right) {
          right.classList.toggle('is-hidden', !showSecondary);
          var rightLabel = right.querySelector('.text-muted.small');
          if (rightLabel) rightLabel.textContent = s + ':';
        }
      });
    }

    // Dashboard compare labels: use explicit date/date-range strings (avoid "Day before", "Previous 7 days").
    function kpiDateLabelFormat() {
      try {
        var cfg = (typeof kpiUiConfigV1 !== 'undefined' && kpiUiConfigV1 && kpiUiConfigV1.v === 1) ? kpiUiConfigV1 : null;
        var general = cfg && cfg.options && cfg.options.general && typeof cfg.options.general === 'object' ? cfg.options.general : null;
        var raw = String(general && general.dateLabelFormat ? general.dateLabelFormat : '').trim().toLowerCase();
        return raw === 'mdy' ? 'mdy' : 'dmy';
      } catch (_) {
        return 'dmy';
      }
    }

    function formatYmdMonthDay(ymd, includeYear) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return String(ymd || '');
      var y = parseInt(String(ymd).slice(0, 4), 10);
      var m = parseInt(String(ymd).slice(5, 7), 10);
      var d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12 || d < 1 || d > 31) return String(ymd || '');
      var order = kpiDateLabelFormat();
      var base = order === 'mdy'
        ? (String(m) + '/' + String(d))
        : (String(d) + '/' + String(m));
      if (!includeYear) return base;
      return base + '/' + String(y);
    }

    function formatYmdRangeMonthDay(startYmd, endYmd) {
      if (!startYmd || !endYmd) return '';
      if (startYmd === endYmd) return formatYmdMonthDay(startYmd, false);
      var includeYear = String(startYmd).slice(0, 4) !== String(endYmd).slice(0, 4);
      return formatYmdMonthDay(startYmd, includeYear) + ' \u2013 ' + formatYmdMonthDay(endYmd, includeYear);
    }

    function ymdAddDays(ymd, deltaDays) {
      if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
      var y = parseInt(String(ymd).slice(0, 4), 10);
      var m = parseInt(String(ymd).slice(5, 7), 10);
      var d = parseInt(String(ymd).slice(8, 10), 10);
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
      var dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      dt.setUTCDate(dt.getUTCDate() + (Number(deltaDays) || 0));
      return dt.toISOString().slice(0, 10);
    }

    function rollingRangeYmdBounds(rangeKey) {
      var rk = (rangeKey == null ? '' : String(rangeKey)).trim().toLowerCase();
      if (!rk) return null;
      var endYmd = null;
      try { endYmd = ymdNowInTz(); } catch (_) { endYmd = null; }
      if (!endYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(endYmd))) return null;
      if (rk === '3d') return { startYmd: ymdAddDays(endYmd, -2), endYmd: endYmd };
      if (rk === '7d') return { startYmd: ymdAddDays(endYmd, -6), endYmd: endYmd };
      if (rk === '14d') return { startYmd: ymdAddDays(endYmd, -13), endYmd: endYmd };
      if (rk === '30d') return { startYmd: ymdAddDays(endYmd, -29), endYmd: endYmd };
      if (rk === 'month') return { startYmd: String(endYmd).slice(0, 7) + '-01', endYmd: endYmd };
      return null;
    }

    function compareLabelFromRange(rangeObj, opts) {
      var startMs = rangeObj && rangeObj.start != null ? Number(rangeObj.start) : NaN;
      var endMs = rangeObj && rangeObj.end != null ? Number(rangeObj.end) : NaN;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) return '';
      var startYmd = ymdInAdminTzFromMs(startMs);
      var endYmd = ymdInAdminTzFromMs(Math.max(startMs, endMs - 1));
      if (!startYmd || !endYmd) return '';
      return formatYmdRangeMonthDay(startYmd, endYmd);
    }

    function renderDashboardKpisFromApi(primaryData) {
      if (!primaryData || PAGE !== 'dashboard') return;
      var el = function(id) { return document.getElementById(id); };
      var kpiRange = getStatsRange();
      var showSecondary = showDashboardSecondaryCompare(kpiRange);

      function numFromMap(dataObj, keyName, rangeKey) {
        var map = dataObj && dataObj[keyName] ? dataObj[keyName] : null;
        var v = map && typeof map[rangeKey] === 'number' ? map[rangeKey] : null;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      }

      function sessionsFromBreakdownMap(dataObj, rangeKey) {
        var br = dataObj && dataObj.trafficBreakdown ? dataObj.trafficBreakdown : null;
        var r = br && br[rangeKey] ? br[rangeKey] : null;
        var v = r && typeof r.human_sessions === 'number' ? r.human_sessions : null;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      }

      function sessionsFromBreakdownCompare(compareObj) {
        var br = compareObj && compareObj.trafficBreakdown ? compareObj.trafficBreakdown : null;
        var v = br && typeof br.human_sessions === 'number' ? br.human_sessions : null;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      }

      function numFromCompare(compareObj, keyName) {
        var v = compareObj && typeof compareObj[keyName] === 'number' ? compareObj[keyName] : null;
        return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
      }

      function round2Local(v) {
        return (typeof v === 'number' && Number.isFinite(v)) ? (Math.round(v * 100) / 100) : null;
      }

      var main = primaryData;
      var profitKpiAllowed = !!(main && main.profitKpiAllowed === true);
      setRuntimeProfitKpiAllowed(profitKpiAllowed);
      var salesVal = numFromMap(main, 'sales', kpiRange);
      var costVal = numFromMap(main, 'cost', kpiRange);
      var profitVal = numFromMap(main, 'profit', kpiRange);
      if (profitVal == null && salesVal != null && costVal != null) profitVal = round2Local(salesVal - costVal);
      if (!profitKpiAllowed) profitVal = null;
      var ordersVal = numFromMap(main, 'convertedCount', kpiRange);
      var sessionsVal = sessionsFromBreakdownMap(main, kpiRange);
      var convVal = numFromMap(main, 'conversion', kpiRange);
      var vpvVal = numFromMap(main, 'vpv', kpiRange);
      var aovVal = numFromMap(main, 'aov', kpiRange);
      var bounceVal = numFromMap(main, 'bounce', kpiRange);
      var returningVal = numFromMap(main, 'returningCustomerCount', kpiRange);
      var roasVal = numFromMap(main, 'roas', kpiRange);
      var extrasMain = (kpiExpandedExtrasRange === kpiRange) ? (kpiExpandedExtrasCache || null) : null;
      var itemsVal = extrasMain && typeof extrasMain.itemsSold === 'number' ? extrasMain.itemsSold : null;
      var fulfilledVal = extrasMain && typeof extrasMain.ordersFulfilled === 'number' ? extrasMain.ordersFulfilled : null;
      var returnsVal = extrasMain && typeof extrasMain.returns === 'number' ? extrasMain.returns : null;
      var cogsVal = extrasMain && typeof extrasMain.cogs === 'number' ? extrasMain.cogs : null;

      function setDashValueText(id, textValue) {
        var node = el(id);
        if (!node) return;
        if (textValue == null || textValue === '') {
          node.innerHTML = '<span class="kpi-mini-spinner" aria-hidden="true"></span>';
          return;
        }
        node.textContent = String(textValue);
      }

      setDashValueText('dash-kpi-revenue', salesVal != null ? formatRevenue0(salesVal) : '\u2014');
      setDashValueText('dash-kpi-profit', profitVal != null ? formatRevenue0(profitVal) : '\u2014');
      // Keep the dashboard hero header Profit in sync with the Profit KPI tile.
      try {
        var heroProfit = el('dash-overview-total-profit');
        if (heroProfit) heroProfit.textContent = profitVal != null ? formatRevenue0(profitVal) : '\u2014';
      } catch (_) {}
      setDashValueText('dash-kpi-orders', ordersVal != null ? Math.round(ordersVal).toLocaleString() : '\u2014');
      setDashValueText('dash-kpi-sessions', sessionsVal != null ? formatSessions(sessionsVal) : '\u2014');
      setDashValueText('dash-kpi-conv', convVal != null ? pct(convVal) : '\u2014');
      setDashValueText('dash-kpi-vpv', vpvVal != null ? formatRevenue(vpvVal) : '\u2014');
      setDashValueText('dash-kpi-aov', aovVal != null ? formatRevenue0(aovVal) : '\u2014');
      setDashValueText('dash-kpi-bounce', bounceVal != null ? pct(bounceVal) : '\u2014');
      setDashValueText('dash-kpi-returning', returningVal != null ? Math.round(returningVal).toLocaleString() : '\u2014');
      setDashValueText('dash-kpi-roas', roasVal != null ? roasVal.toFixed(2) + 'x' : '\u2014');
      setDashValueText('dash-kpi-items', itemsVal != null ? Math.round(itemsVal).toLocaleString() : '\u2014');
      setDashValueText('dash-kpi-fulfilled', fulfilledVal != null ? Math.round(fulfilledVal).toLocaleString() : '\u2014');
      setDashValueText('dash-kpi-returns', returnsVal != null ? formatNegativeCurrencyOrZero(returnsVal, true) : '\u2014');
      setDashValueText('dash-kpi-cogs', cogsVal != null ? formatRevenue0(cogsVal) : '\u2014');

      function renderCompareSlot(slotSuffix, values) {
        values = values || {};
        var sales = values.sales;
        var profit = values.profit;
        var orders = values.orders;
        var sessions = values.sessions;
        var conv = values.conv;
        var vpv = values.vpv;
        var aov = values.aov;
        var bounce = values.bounce;
        var returning = values.returning;
        var roas = values.roas;
        var items = values.items;
        var fulfilled = values.fulfilled;
        var returns = values.returns;
        var cogs = values.cogs;

        setDashValueText('dash-revenue-' + slotSuffix, sales != null ? formatRevenue0(sales) : '\u2014');
        setDashValueText('dash-profit-' + slotSuffix, profit != null ? formatRevenue0(profit) : '\u2014');
        setDashValueText('dash-orders-' + slotSuffix, orders != null ? Math.round(orders).toLocaleString() : '\u2014');
        setDashValueText('dash-sessions-' + slotSuffix, sessions != null ? formatSessions(sessions) : '\u2014');
        setDashValueText('dash-conv-' + slotSuffix, conv != null ? pct(conv) : '\u2014');
        setDashValueText('dash-vpv-' + slotSuffix, vpv != null ? formatRevenue(vpv) : '\u2014');
        setDashValueText('dash-aov-' + slotSuffix, aov != null ? formatRevenue0(aov) : '\u2014');
        setDashValueText('dash-bounce-' + slotSuffix, bounce != null ? pct(bounce) : '\u2014');
        setDashValueText('dash-returning-' + slotSuffix, returning != null ? Math.round(returning).toLocaleString() : '\u2014');
        setDashValueText('dash-roas-' + slotSuffix, roas != null ? roas.toFixed(2) + 'x' : '\u2014');
        setDashValueText('dash-items-' + slotSuffix, items != null ? Math.round(items).toLocaleString() : '\u2014');
        setDashValueText('dash-fulfilled-' + slotSuffix, fulfilled != null ? Math.round(fulfilled).toLocaleString() : '\u2014');
        setDashValueText('dash-returns-' + slotSuffix, returns != null ? formatNegativeCurrencyOrZero(returns, true) : '\u2014');
        setDashValueText('dash-cogs-' + slotSuffix, cogs != null ? formatRevenue0(cogs) : '\u2014');
      }

      function applyDashDelta(key, current, baseline, invert) {
        var wrap = el('dash-kpi-' + key + '-delta');
        var textEl = el('dash-kpi-' + key + '-delta-text');
        if (!wrap || !textEl) return;

        var cur = typeof current === 'number' && Number.isFinite(current) ? current : null;
        var base = typeof baseline === 'number' && Number.isFinite(baseline) ? baseline : null;
        var rawDelta = (cur != null && base != null) ? kpiDelta(cur, base) : null;
        var toneDelta = null;
        if (cur != null && base != null) {
          var diff = cur - base;
          var denom = Math.abs(base);
          toneDelta = denom > 1e-9 ? (diff / denom) : (diff === 0 ? 0 : (diff > 0 ? 1 : -1));
          if (invert) toneDelta = -toneDelta;
        }
        var isNew = base === 0 && cur != null && cur !== 0;
        var isUp = isNew || (toneDelta != null && toneDelta > KPI_STABLE_RATIO);
        var isDown = !isNew && toneDelta != null && toneDelta < -KPI_STABLE_RATIO;
        var isFlat = !isNew && toneDelta != null && !isUp && !isDown;

        var dir = 'none';
        var text = '\u2014';
        if (rawDelta != null) {
          text = isNew ? 'new' : formatSignedPercentOneDecimalFromRatio(rawDelta);
          dir = isUp ? 'up' : (isDown ? 'down' : 'flat');
        }
        var forceNeutralTone = DASHBOARD_NEUTRAL_DELTA_KEYS.has(String(key || '').toLowerCase());
        var visualDir = (forceNeutralTone && dir !== 'none') ? 'flat' : dir;

        wrap.classList.remove('is-up', 'is-down', 'is-flat');
        if (rawDelta == null) {
          wrap.classList.add('is-hidden');
          wrap.setAttribute('data-dir', 'none');
          textEl.textContent = '\u2014';
          return;
        }

        wrap.classList.remove('is-hidden');
        if (visualDir === 'up') wrap.classList.add('is-up');
        else if (visualDir === 'down') wrap.classList.add('is-down');
        else if (visualDir === 'flat') wrap.classList.add('is-flat');
        wrap.setAttribute('data-dir', visualDir);
        textEl.textContent = text;
        try {
          var dashDeltaStyle = getChartsKpiBundle('dashboardCards').deltaStyle;
          var dashTone = forceNeutralTone
            ? DASHBOARD_NEUTRAL_TONE_HEX
            : chartsKpiToneColor('dashboardCards', visualDir === 'none' ? 'same' : visualDir);
          wrap.style.fontSize = String(dashDeltaStyle.fontSize) + 'px';
          wrap.style.fontWeight = String(dashDeltaStyle.fontWeight);
          wrap.style.color = forceNeutralTone ? DASHBOARD_NEUTRAL_TONE_HEX : (dashDeltaStyle.fontColor || dashTone);
        } catch (_) {}

        var icon = wrap.querySelector ? wrap.querySelector('i') : null;
        if (icon) {
          var iconKey = 'dash-kpi-delta-up';
          if (visualDir === 'down') iconKey = 'dash-kpi-delta-down';
          else if (visualDir === 'flat') iconKey = 'dash-kpi-delta-flat';
          icon.setAttribute('data-icon-key', iconKey);
          icon.classList.remove('fa-arrow-trend-up', 'fa-arrow-trend-down', 'fa-minus');
          if (visualDir === 'down') icon.classList.add('fa-arrow-trend-down');
          else if (visualDir === 'flat') icon.classList.add('fa-minus');
          else icon.classList.add('fa-arrow-trend-up');
          try {
            var dashDeltaStyleIcon = getChartsKpiBundle('dashboardCards').deltaStyle;
            var dashToneIcon = forceNeutralTone
              ? DASHBOARD_NEUTRAL_TONE_HEX
              : chartsKpiToneColor('dashboardCards', visualDir === 'none' ? 'same' : visualDir);
            icon.style.fontSize = String(dashDeltaStyleIcon.iconSize) + 'px';
            icon.style.color = forceNeutralTone ? DASHBOARD_NEUTRAL_TONE_HEX : (dashDeltaStyleIcon.iconColor || dashToneIcon);
          } catch (_) {}
          try {
            if (!forceNeutralTone && window.KexoIconTheme && typeof window.KexoIconTheme.applyElement === 'function') {
              window.KexoIconTheme.applyElement(icon);
            }
          } catch (_) {}
        }
      }

      var primaryCompare = main && main.compare ? main.compare : null;
      var primaryExtrasCompare = extrasMain && extrasMain.compare ? extrasMain.compare : null;
      var salesBase = numFromCompare(primaryCompare, 'sales');
      var costBase = numFromCompare(primaryCompare, 'cost');
      var profitBase = numFromCompare(primaryCompare, 'profit');
      if (profitBase == null && salesBase != null && costBase != null) profitBase = round2Local(salesBase - costBase);
      if (!profitKpiAllowed) profitBase = null;
      var ordersBase = numFromCompare(primaryCompare, 'convertedCount');
      var sessionsBase = sessionsFromBreakdownCompare(primaryCompare);
      var convBase = numFromCompare(primaryCompare, 'conversion');
      var vpvBase = numFromCompare(primaryCompare, 'vpv');
      var aovBase = numFromCompare(primaryCompare, 'aov');
      var bounceBase = numFromCompare(primaryCompare, 'bounce');
      var returningBase = numFromCompare(primaryCompare, 'returningCustomerCount');
      var roasBase = numFromCompare(primaryCompare, 'roas');
      var itemsBase = primaryExtrasCompare && typeof primaryExtrasCompare.itemsSold === 'number' ? primaryExtrasCompare.itemsSold : null;
      var fulfilledBase = primaryExtrasCompare && typeof primaryExtrasCompare.ordersFulfilled === 'number' ? primaryExtrasCompare.ordersFulfilled : null;
      var returnsBase = primaryExtrasCompare && typeof primaryExtrasCompare.returns === 'number' ? primaryExtrasCompare.returns : null;
      var cogsBase = primaryExtrasCompare && typeof primaryExtrasCompare.cogs === 'number' ? primaryExtrasCompare.cogs : null;

      applyDashDelta('revenue', salesVal, salesBase, false);
      applyDashDelta('profit', profitVal, profitBase, false);
      applyDashDelta('orders', ordersVal, ordersBase, false);
      applyDashDelta('sessions', sessionsVal, sessionsBase, false);
      applyDashDelta('conv', convVal, convBase, false);
      applyDashDelta('vpv', vpvVal, vpvBase, false);
      applyDashDelta('aov', aovVal, aovBase, false);
      applyDashDelta('bounce', bounceVal, bounceBase, true);
      applyDashDelta('returning', returningVal, returningBase, false);
      applyDashDelta('roas', roasVal, roasBase, false);
      applyDashDelta('items', itemsVal, itemsBase, false);
      applyDashDelta('fulfilled', fulfilledVal, fulfilledBase, false);
      applyDashDelta('returns', returnsVal, returnsBase, true);
      applyDashDelta('cogs', cogsVal, cogsBase, true);
      renderCompareSlot('yesterday', {
        sales: salesBase,
        profit: profitBase,
        orders: ordersBase,
        sessions: sessionsBase,
        conv: convBase,
        vpv: vpvBase,
        aov: aovBase,
        bounce: bounceBase,
        returning: returningBase,
        roas: roasBase,
        items: itemsBase,
        fulfilled: fulfilledBase,
        returns: returnsBase,
        cogs: cogsBase,
      });

      var primaryCompareLabel = '';
      try {
        var rkNorm = normalizeRangeKeyForApi(kpiRange);
        primaryCompareLabel = compareLabelFromRange(primaryCompare && primaryCompare.range ? primaryCompare.range : null, { sameTime: rkNorm === 'today' });
      } catch (_) {
        primaryCompareLabel = '';
      }
      if (!primaryCompareLabel) {
        try { primaryCompareLabel = getCompareDisplayLabel(kpiRange); } catch (_) { primaryCompareLabel = 'Previous period'; }
      }

      var secondaryCompareLabel = '';
      try {
        var sec = rollingRangeYmdBounds('7d');
        if (sec && sec.startYmd && sec.endYmd) secondaryCompareLabel = formatYmdRangeMonthDay(sec.startYmd, sec.endYmd);
      } catch (_) {
        secondaryCompareLabel = '';
      }
      if (!secondaryCompareLabel) secondaryCompareLabel = 'Previous 7 days';

      setDashboardCompareLabels(primaryCompareLabel, secondaryCompareLabel, showSecondary);

      if (showSecondary) {
        var secondary = _dashKpisSecondary;
        var secondaryRangeKey = '7d';
        var secondaryExtras = _dashKpiExtrasSecondary;
        var secondarySales = numFromMap(secondary, 'sales', secondaryRangeKey);
        var secondaryCost = numFromMap(secondary, 'cost', secondaryRangeKey);
        var secondaryProfit = numFromMap(secondary, 'profit', secondaryRangeKey);
        if (secondaryProfit == null && secondarySales != null && secondaryCost != null) secondaryProfit = round2Local(secondarySales - secondaryCost);
        if (!profitKpiAllowed) secondaryProfit = null;
        renderCompareSlot('7d', {
          sales: secondarySales,
          profit: secondaryProfit,
          orders: numFromMap(secondary, 'convertedCount', secondaryRangeKey),
          sessions: sessionsFromBreakdownMap(secondary, secondaryRangeKey),
          conv: numFromMap(secondary, 'conversion', secondaryRangeKey),
          vpv: numFromMap(secondary, 'vpv', secondaryRangeKey),
          aov: numFromMap(secondary, 'aov', secondaryRangeKey),
          bounce: numFromMap(secondary, 'bounce', secondaryRangeKey),
          returning: numFromMap(secondary, 'returningCustomerCount', secondaryRangeKey),
          roas: numFromMap(secondary, 'roas', secondaryRangeKey),
          items: secondaryExtras && typeof secondaryExtras.itemsSold === 'number' ? secondaryExtras.itemsSold : null,
          fulfilled: secondaryExtras && typeof secondaryExtras.ordersFulfilled === 'number' ? secondaryExtras.ordersFulfilled : null,
          returns: secondaryExtras && typeof secondaryExtras.returns === 'number' ? secondaryExtras.returns : null,
          cogs: secondaryExtras && typeof secondaryExtras.cogs === 'number' ? secondaryExtras.cogs : null,
        });
      } else {
        renderCompareSlot('7d', {});
      }

      // Fetch optional secondary compare in background only when slot is visible.
      if (showSecondary && !_dashKpisSecondary) {
        ensureDashboardSecondaryKpis().then(function() {
          try { if (PAGE === 'dashboard') renderDashboardKpisFromApi(primaryData); } catch (_) {}
        }).catch(function() {});
      }
      if (showSecondary && !_dashKpiExtrasSecondary) {
        ensureDashboardSecondaryExtras().then(function() {
          try { if (PAGE === 'dashboard') renderDashboardKpisFromApi(primaryData); } catch (_) {}
        }).catch(function() {});
      }

      // Main extras are fetched on-demand from the selected range.
      if (!extrasMain) {
        fetchExpandedKpiExtras({ force: false }).then(function() {
          try { if (PAGE === 'dashboard') renderDashboardKpisFromApi(primaryData); } catch (_) {}
        }).catch(function() {});
      }
    }

    // Condensed KPI strip only (expanded overlay removed).
    let _condensedOverflowRaf = 0;
    let _condensedStripResizeObserver = null;
    function updateCondensedKpiOverflow() {
      const strip = document.getElementById('kexo-condensed-kpis');
      if (!strip) return;
      const chipsAll = Array.prototype.slice.call(strip.querySelectorAll('.kexo-kpi-chip'));
      const chips = chipsAll.filter(function(ch) { return ch && ch.classList ? !ch.classList.contains('is-user-disabled') : true; });
      if (!chips.length) return;
      const isMobileViewport = !!(window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches);
      if (isMobileViewport) {
        strip.style.removeProperty('--kexo-kpi-width');
        strip.style.removeProperty('--kexo-kpi-min-width');
        strip.style.setProperty('--kexo-kpi-spark-width', '36px');
        strip.style.setProperty('--kexo-kpi-spark-right', '4px');
        for (let i = 0; i < chips.length; i++) {
          chips[i].classList.remove('is-hidden');
          chips[i].setAttribute('aria-hidden', 'false');
        }
        return;
      }
      // Auto-fit chips to available width; hide overflow chips from the end.
      const avail = strip.clientWidth || 0;
      if (!Number.isFinite(avail) || avail <= 0) return;

      const stripStyle = window.getComputedStyle(strip);
      const gapPx = parseFloat(stripStyle.columnGap || stripStyle.gap) || 0;
      const rootStyle = window.getComputedStyle(document.documentElement);
      const configuredMin = parseFloat(rootStyle.getPropertyValue('--kexo-kpi-min-width')) || 120;
      const minWidth = Math.max(100, configuredMin); // never below 100; hide chips when below min

      function widthFor(count) {
        const n = Math.max(1, Number(count) || 1);
        const totalGap = gapPx * Math.max(0, n - 1);
        return (avail - totalGap) / n;
      }

      let visibleCount = chips.length;
      let chipWidth = widthFor(visibleCount);
      while (visibleCount > 1 && chipWidth < minWidth) {
        visibleCount -= 1;
        chipWidth = widthFor(visibleCount);
      }

      // If we can???t satisfy the floor (extremely narrow), show 1 chip at whatever width we have.
      if (!Number.isFinite(chipWidth) || chipWidth <= 0) return;

      const w = Math.max(0, Math.round(chipWidth * 100) / 100);
      const wStr = String(w).replace(/\.0+$/, '');
      strip.style.setProperty('--kexo-kpi-width', wStr + 'px');
      strip.style.setProperty('--kexo-kpi-min-width', wStr + 'px');

      // Condensed sparkline sizing: shrink more aggressively on tight chips so the chart
      // doesn't sit behind the label/value text when chips are auto-fit small.
      const tight = w <= 136;
      const sparkRatio = tight ? 0.24 : 0.30;
      const sparkW = Math.max(28, Math.min(45, Math.round(w * sparkRatio)));
      strip.style.setProperty('--kexo-kpi-spark-width', String(sparkW) + 'px');
      strip.style.setProperty('--kexo-kpi-spark-right', (tight ? '0px' : '6px'));

      for (let i = 0; i < chips.length; i++) {
        const show = i < visibleCount;
        chips[i].classList.toggle('is-hidden', !show);
        chips[i].setAttribute('aria-hidden', show ? 'false' : 'true');
      }
    }
    function scheduleCondensedKpiOverflowUpdate() {
      if (_condensedOverflowRaf) return;
      const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : function(cb) { return setTimeout(cb, 16); };
      _condensedOverflowRaf = raf(function() {
        _condensedOverflowRaf = 0;
        updateCondensedKpiOverflow();
      });
    }

    // ?????? KPI + date range UI config (stored in /api/settings) ?????????????????????????????????????????????
    var uiSettingsCache = null;
    var uiSettingsFetchedAt = 0;
    var uiSettingsInFlight = null;
    var kpiUiConfigV1 = null;
    var chartsUiConfigV1 = null;
    var _dashboardKpiResizeWired = false;
    var _dashboardKpiResizeTimer = 0;
    var KPI_UI_CFG_LS_KEY = 'kexo:kpi-ui-config:v1';
    var CHARTS_UI_CFG_LS_KEY = 'kexo:charts-ui-config:v1';
    var CHARTS_KPI_BUNDLE_KEYS = ['dashboardCards', 'headerStrip', 'yearlySnapshot'];

    function defaultChartsKpiBundlePalette(bundleKey) {
      var key = String(bundleKey || '').trim().toLowerCase();
      var same = '#66bdb7';
      if (key === 'dashboardcards') {
        same = cssVarColor('--kexo-accent-1', '#4b94e4');
      }
      return { up: '#2fb344', down: '#d63939', same: same, compareLine: '#cccccc' };
    }

    function defaultChartsKpiSparklineConfig(bundleKey) {
      if (bundleKey === 'headerStrip') return { mode: 'line', curve: 'smooth', strokeWidth: 2.15, height: 30, showCompare: false, advancedApexOverride: {} };
      if (bundleKey === 'yearlySnapshot') return { mode: 'line', curve: 'smooth', strokeWidth: 2.55, height: 56, showCompare: false, advancedApexOverride: {} };
      return { mode: 'line', curve: 'straight', strokeWidth: 2.55, height: 50, showCompare: true, compareUsePrimaryColor: false, compareOpacity: 50, advancedApexOverride: {} };
    }

    function defaultChartsKpiDeltaStyle(bundleKey) {
      if (bundleKey === 'headerStrip') return { fontSize: 11, fontWeight: 500, iconSize: 10, fontColor: '', iconColor: '' };
      if (bundleKey === 'yearlySnapshot') return { fontSize: 12, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' };
      return { fontSize: 14, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' };
    }

    function defaultChartsKpiBundle(bundleKey) {
      return {
        sparkline: defaultChartsKpiSparklineConfig(bundleKey),
        deltaStyle: defaultChartsKpiDeltaStyle(bundleKey),
        palette: defaultChartsKpiBundlePalette(bundleKey),
      };
    }

    function isPlainObject(value) {
      return !!value && Object.prototype.toString.call(value) === '[object Object]';
    }

    function deepMergeOptions(base, override) {
      if (!isPlainObject(base) || !isPlainObject(override)) return base;
      Object.keys(override).forEach(function (key) {
        var next = override[key];
        if (Array.isArray(next)) {
          base[key] = next.slice();
          return;
        }
        if (isPlainObject(next)) {
          var cur = isPlainObject(base[key]) ? base[key] : {};
          base[key] = deepMergeOptions(cur, next);
          return;
        }
        base[key] = next;
      });
      return base;
    }

    function normalizeHexColorStrict(v, fallback) {
      var raw = v == null ? '' : String(v).trim().toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
      return fallback;
    }

    function normalizeOptionalHexColorStrict(v) {
      var raw = v == null ? '' : String(v).trim().toLowerCase();
      if (!raw) return '';
      if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
      return '';
    }

    function normalizeChartsKpiBundle(bundleKey, rawBundle) {
      var src = rawBundle && typeof rawBundle === 'object' ? rawBundle : {};
      var def = defaultChartsKpiBundle(bundleKey);
      var spark = src.sparkline && typeof src.sparkline === 'object' ? src.sparkline : {};
      var delta = src.deltaStyle && typeof src.deltaStyle === 'object' ? src.deltaStyle : {};
      var palette = src.palette && typeof src.palette === 'object' ? src.palette : {};
      var mode = String(spark.mode || def.sparkline.mode).trim().toLowerCase();
      if (['line', 'area', 'bar'].indexOf(mode) < 0) mode = def.sparkline.mode;
      var curve = String(spark.curve || def.sparkline.curve).trim().toLowerCase();
      if (['smooth', 'straight', 'stepline'].indexOf(curve) < 0) curve = def.sparkline.curve;
      var strokeWidth = Number(spark.strokeWidth);
      if (!Number.isFinite(strokeWidth)) strokeWidth = Number(def.sparkline.strokeWidth);
      strokeWidth = Math.max(0.5, Math.min(6, strokeWidth));
      var height = Number(spark.height);
      if (!Number.isFinite(height)) height = Number(def.sparkline.height);
      height = Math.max(18, Math.min(120, Math.round(height)));
      var fontSize = Number(delta.fontSize);
      if (!Number.isFinite(fontSize)) fontSize = Number(def.deltaStyle.fontSize);
      fontSize = Math.max(9, Math.min(24, Math.round(fontSize)));
      var iconSize = Number(delta.iconSize);
      if (!Number.isFinite(iconSize)) iconSize = Number(def.deltaStyle.iconSize);
      iconSize = Math.max(8, Math.min(24, Math.round(iconSize)));
      var fontWeight = parseInt(String(delta.fontWeight != null ? delta.fontWeight : def.deltaStyle.fontWeight), 10);
      if (fontWeight !== 400 && fontWeight !== 500) fontWeight = def.deltaStyle.fontWeight;
      var supportsCompare = bundleKey === 'dashboardCards';
      var compareUsePrimaryColor = supportsCompare ? (spark.compareUsePrimaryColor !== false) : false;
      var compareOpacity = Number(spark.compareOpacity);
      if (!Number.isFinite(compareOpacity)) compareOpacity = 50;
      compareOpacity = Math.max(0, Math.min(100, Math.round(compareOpacity)));
      var out = {
        sparkline: {
          mode: mode,
          curve: curve,
          strokeWidth: strokeWidth,
          height: height,
          showCompare: supportsCompare ? !(spark.showCompare === false) : false,
          compareUsePrimaryColor: compareUsePrimaryColor,
          compareOpacity: compareOpacity,
          advancedApexOverride: isPlainObject(spark.advancedApexOverride) ? spark.advancedApexOverride : {},
        },
        deltaStyle: {
          fontSize: fontSize,
          fontWeight: fontWeight,
          iconSize: iconSize,
          fontColor: normalizeOptionalHexColorStrict(delta.fontColor || ''),
          iconColor: normalizeOptionalHexColorStrict(delta.iconColor || ''),
        },
        palette: {
          up: normalizeHexColorStrict(palette.up, def.palette.up),
          down: normalizeHexColorStrict(palette.down, def.palette.down),
          same: normalizeHexColorStrict(palette.same, def.palette.same),
          compareLine: normalizeHexColorStrict(palette.compareLine, def.palette.compareLine),
        },
      };
      if (bundleKey === 'dashboardCards') {
        var same = String(out.palette.same || '').trim().toLowerCase();
        if (same === '#66bdb7') {
          out.palette.same = cssVarColor('--kexo-accent-1', '#4b94e4');
        }
      }
      return out;
    }

    function getChartsKpiBundle(bundleKey) {
      var key = String(bundleKey || '').trim();
      if (CHARTS_KPI_BUNDLE_KEYS.indexOf(key) < 0) key = 'dashboardCards';
      var cfg = chartsUiConfigV1;
      var raw = (cfg && cfg.v === 1 && cfg.kpiBundles && typeof cfg.kpiBundles === 'object')
        ? cfg.kpiBundles[key]
        : null;
      // Guardrail: KPI sparkline/palette/delta style is user-managed in Settings ??? Layout ??? Charts.
      // Keep runtime reading from charts_ui_config_v1; do not hardcode replacement colors/sizes here.
      return normalizeChartsKpiBundle(key, raw);
    }

    function chartsKpiToneColor(bundleKey, dir) {
      var bundle = getChartsKpiBundle(bundleKey);
      var d = String(dir || '').toLowerCase();
      if (d === 'up') return bundle.palette.up;
      if (d === 'down') return bundle.palette.down;
      return bundle.palette.same;
    }

    function chartsKpiCompareLineColor(bundleKey) {
      var bundle = getChartsKpiBundle(bundleKey);
      return bundle.palette.compareLine || '#cccccc';
    }

    // Hydrate KPI prefs from localStorage so disabled KPIs are hidden on first paint.
    try {
      var cachedKpis = safeReadLocalStorageJson(KPI_UI_CFG_LS_KEY);
      if (cachedKpis && cachedKpis.v === 1 && cachedKpis.kpis) {
        kpiUiConfigV1 = cachedKpis;
        try { window.__kexoKpiUiConfigV1 = cachedKpis; } catch (_) {}
      }
    } catch (_) {}

    // Hydrate chart prefs from localStorage so first paint uses the last saved config.
    try {
      var cachedCharts = safeReadLocalStorageJson(CHARTS_UI_CFG_LS_KEY);
      if (cachedCharts && cachedCharts.v === 1 && Array.isArray(cachedCharts.charts)) {
        chartsUiConfigV1 = cachedCharts;
        try { window.__kexoChartsUiConfigV1 = cachedCharts; } catch (_) {}
      }
    } catch (_) {}

    function isChartsMobileViewport() {
      try {
        return !!(window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches);
      } catch (_) {
        return false;
      }
    }

    function shouldHideChartsOnMobile() {
      var cfg = chartsUiConfigV1;
      // Default ON when config is missing/outdated (requested project policy).
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1) return true;
      return cfg.hideOnMobile !== false;
    }

    function applyHideChartsOnMobileClass() {
      var root = null;
      try { root = document.documentElement; } catch (_) { root = null; }
      if (!root || !root.classList) return;
      var on = shouldHideChartsOnMobile();
      var mobile = isChartsMobileViewport();
      root.classList.toggle('kexo-hide-charts-mobile', !!(on && mobile));
    }

    try {
      applyHideChartsOnMobileClass();
      try { applyKpiBundleCssVars(); } catch (_) {}
      window.addEventListener('resize', function() {
        try { applyHideChartsOnMobileClass(); } catch (_) {}
      });
    } catch (_) {}

    function getChartsUiItem(key) {
      var cfg = chartsUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.charts)) return null;
      var k = String(key == null ? '' : key).trim().toLowerCase();
      if (!k) return null;
      for (var i = 0; i < cfg.charts.length; i++) {
        var it = cfg.charts[i];
        if (!it || typeof it !== 'object') continue;
        var ik = it.key != null ? String(it.key).trim().toLowerCase() : '';
        if (ik && ik === k) return it;
      }
      return null;
    }

    function isChartEnabledByUiConfig(key, fallbackEnabled) {
      if (shouldHideChartsOnMobile() && isChartsMobileViewport()) return false;
      var it = getChartsUiItem(key);
      if (it && it.enabled === false) return false;
      return fallbackEnabled !== false;
    }

    function validateChartType(key, mode, fallbackMode) {
      var fb = String(fallbackMode || '').trim().toLowerCase() || 'area';
      var m = String(mode || '').trim().toLowerCase();
      if (!m) m = fb;
      try {
        if (typeof window.kexoChartMeta === 'function') {
          var meta = window.kexoChartMeta(key);
          var allowed = meta && Array.isArray(meta.modes) ? meta.modes.map(function(v) { return String(v).trim().toLowerCase(); }) : [];
          if (allowed.length && allowed.indexOf(m) < 0) {
            if (allowed.indexOf(fb) >= 0) return fb;
            if (meta && meta.defaultMode) return String(meta.defaultMode).trim().toLowerCase();
            return allowed[0];
          }
        }
      } catch (_) {}
      return m || fb;
    }

    function chartModeFromUiConfig(key, fallbackMode) {
      var k = String(key == null ? '' : key).trim().toLowerCase();
      var it = getChartsUiItem(k);
      var m = it && it.mode != null ? String(it.mode).trim().toLowerCase() : '';
      if (k === 'live-online-chart') {
        if (m === 'map-animated' || m === 'map-flat') return m;
        return 'map-flat';
      }
      if (k === 'countries-map-chart') {
        if (m === 'map-animated' || m === 'map-flat') return m;
        return 'map-flat';
      }
      return validateChartType(k, m || fallbackMode, fallbackMode);
    }

    function chartColorsFromUiConfig(key, fallbackColors) {
      var it = getChartsUiItem(key);
      var arr = it && Array.isArray(it.colors) ? it.colors.filter(Boolean).map(function(c) { return String(c).trim(); }).filter(Boolean) : [];
      if (arr.length) return arr;
      return Array.isArray(fallbackColors) ? fallbackColors : [];
    }

    function chartSizePercentFromUiConfig(key, fallbackPercent) {
      var it = getChartsUiItem(key);
      var n = it && it.sizePercent != null ? Number(it.sizePercent) : Number(fallbackPercent);
      if (!Number.isFinite(n)) n = 100;
      n = Math.round(n / 5) * 5;
      if (n < 25) n = 25;
      if (n > 100) n = 100;
      return n;
    }

    function chartPieMetricFromUiConfig(key, fallbackMetric) {
      var it = getChartsUiItem(key);
      var raw = it && it.pieMetric != null ? String(it.pieMetric).trim().toLowerCase() : '';
      if (raw === 'sessions' || raw === 'orders' || raw === 'revenue') return raw;
      var fb = String(fallbackMetric || 'sessions').trim().toLowerCase();
      if (fb === 'sessions' || fb === 'orders' || fb === 'revenue') return fb;
      return 'sessions';
    }

    function defaultChartsLineStyleConfig() {
      return {
        curve: 'smooth',
        strokeWidth: 2.6,
        dashArray: 0,
        markerSize: 3,
        fillOpacity: 0.18,
        gridDash: 3,
        dataLabels: 'auto',
        toolbar: false,
        animations: false,
        icons: false,
        radialCenterLabel: true,
        pieDonut: false,
        pieDonutSize: 66,
        pieLabelPosition: 'auto',
        pieLabelContent: 'percent',
        pieLabelOffset: 16,
        pieCountryFlags: false,
      };
    }

    function normalizeChartStyleConfig(raw) {
      var src = isPlainObject(raw) ? raw : {};
      var def = defaultChartsLineStyleConfig();
      var curve = String(src.curve != null ? src.curve : def.curve).trim().toLowerCase();
      if (curve !== 'smooth' && curve !== 'straight' && curve !== 'stepline') curve = def.curve;
      var dataLabels = String(src.dataLabels != null ? src.dataLabels : def.dataLabels).trim().toLowerCase();
      if (dataLabels !== 'auto' && dataLabels !== 'on' && dataLabels !== 'off') dataLabels = def.dataLabels;
      var pieLabelPosition = String(src.pieLabelPosition != null ? src.pieLabelPosition : def.pieLabelPosition).trim().toLowerCase();
      if (pieLabelPosition !== 'auto' && pieLabelPosition !== 'inside' && pieLabelPosition !== 'outside') pieLabelPosition = def.pieLabelPosition;
      var pieLabelContent = String(src.pieLabelContent != null ? src.pieLabelContent : def.pieLabelContent).trim().toLowerCase();
      if (pieLabelContent !== 'percent' && pieLabelContent !== 'label' && pieLabelContent !== 'label_percent') pieLabelContent = def.pieLabelContent;
      var icons = (src.icons === true) ? true : (src.icons === false) ? false : (def.icons === true);
      function n(v, fb, min, max) {
        var x = Number(v);
        if (!Number.isFinite(x)) x = Number(fb);
        if (!Number.isFinite(x)) x = min;
        if (x < min) x = min;
        if (x > max) x = max;
        return x;
      }
      return {
        curve: curve,
        strokeWidth: n(src.strokeWidth, def.strokeWidth, 0, 8),
        dashArray: n(src.dashArray, def.dashArray, 0, 20),
        markerSize: n(src.markerSize, def.markerSize, 0, 12),
        fillOpacity: n(src.fillOpacity, def.fillOpacity, 0, 1),
        gridDash: n(src.gridDash, def.gridDash, 0, 16),
        dataLabels: dataLabels,
        toolbar: !!src.toolbar,
        animations: src.animations === true,
        icons: icons,
        radialCenterLabel: src.radialCenterLabel !== false,
        pieDonut: !!src.pieDonut,
        pieDonutSize: Math.round(n(src.pieDonutSize, def.pieDonutSize, 30, 90)),
        pieLabelPosition: pieLabelPosition,
        pieLabelContent: pieLabelContent,
        pieLabelOffset: Math.round(n(src.pieLabelOffset, def.pieLabelOffset, -40, 40)),
        pieCountryFlags: !!src.pieCountryFlags,
      };
    }

    function chartStyleFromUiConfig(key) {
      var it = getChartsUiItem(key);
      var raw = it && isPlainObject(it.style) ? it.style : null;
      return normalizeChartStyleConfig(raw || {});
    }

    function chartStyleOverrideFromUiConfig(key, modeHint) {
      var mode = normalizeChartType(String(modeHint || '').trim().toLowerCase() || 'line', 'line');
      if (mode === 'map-animated' || mode === 'map-flat') return null;
      var style = chartStyleFromUiConfig(key);
      var out = {
        chart: {
          toolbar: { show: !!style.toolbar },
          animations: { enabled: !!style.animations }
        },
        grid: { strokeDashArray: style.gridDash }
      };
      if (style.dataLabels === 'on') out.dataLabels = { enabled: true };
      if (style.dataLabels === 'off') out.dataLabels = { enabled: false };
      if (mode === 'pie') {
        var labelOffset = style.pieLabelPosition === 'outside'
          ? Math.max(4, style.pieLabelOffset)
          : (style.pieLabelPosition === 'inside' ? Math.min(0, style.pieLabelOffset) : style.pieLabelOffset);
        out.plotOptions = {
          pie: {
            dataLabels: { offset: labelOffset }
          }
        };
        if (style.pieDonut) {
          out.plotOptions.pie.donut = { size: String(Math.max(30, Math.min(90, Number(style.pieDonutSize) || 66))) + '%' };
        }
      } else if (mode === 'radialbar') {
        if (style.dataLabels === 'on' || style.dataLabels === 'off') {
          out.plotOptions = out.plotOptions || {};
          out.plotOptions.radialBar = out.plotOptions.radialBar || {};
          out.plotOptions.radialBar.dataLabels = out.plotOptions.radialBar.dataLabels || {};
          out.plotOptions.radialBar.dataLabels.value = out.plotOptions.radialBar.dataLabels.value || {};
          out.plotOptions.radialBar.dataLabels.value.show = style.dataLabels === 'on';
        }
        out.fill = { opacity: style.fillOpacity > 0 ? style.fillOpacity : 1 };
      } else {
        out.stroke = {
          show: true,
          curve: style.curve,
          width: mode === 'bar' ? 0 : style.strokeWidth,
          lineCap: 'round',
          dashArray: mode === 'bar' ? 0 : style.dashArray
        };
        out.markers = {
          size: mode === 'line' ? style.markerSize : 0,
          hover: { size: Math.max(4, style.markerSize + 2) }
        };
        if (mode === 'area') {
          out.fill = {
            type: 'gradient',
            gradient: {
              shadeIntensity: 1,
              opacityFrom: style.fillOpacity,
              opacityTo: Math.max(0, style.fillOpacity * 0.35),
              stops: [0, 100]
            }
          };
        } else if (mode === 'bar') {
          out.fill = { type: 'solid', opacity: style.fillOpacity > 0 ? style.fillOpacity : 1 };
        }
      }
      return out;
    }

    function chartAdvancedOverrideFromUiConfig(key, modeHint) {
      var it = getChartsUiItem(key);
      var raw = it && it.advancedApexOverride && typeof it.advancedApexOverride === 'object'
        ? it.advancedApexOverride
        : null;
      var merged = {};
      var styleOverride = chartStyleOverrideFromUiConfig(key, modeHint);
      if (styleOverride && isPlainObject(styleOverride)) deepMergeOptions(merged, styleOverride);
      if (isPlainObject(raw)) deepMergeOptions(merged, raw);
      return Object.keys(merged).length ? merged : null;
    }

    function chartUiConfigSignature(cfg) {
      try { return JSON.stringify(cfg || null); } catch (_) { return ''; }
    }

    function applyKpiBundleCssVars() {
      var root = document && document.documentElement ? document.documentElement : null;
      if (!root || !root.style) return;
      function applyBundleVars(bundleKey, prefix) {
        var bundle = getChartsKpiBundle(bundleKey);
        root.style.setProperty('--kexo-' + prefix + '-kpi-up', bundle.palette.up);
        root.style.setProperty('--kexo-' + prefix + '-kpi-down', bundle.palette.down);
        root.style.setProperty('--kexo-' + prefix + '-kpi-same', bundle.palette.same);
        root.style.setProperty('--kexo-' + prefix + '-kpi-compare-line', bundle.palette.compareLine);
        root.style.setProperty('--kexo-' + prefix + '-kpi-delta-font-size', String(bundle.deltaStyle.fontSize) + 'px');
        root.style.setProperty('--kexo-' + prefix + '-kpi-delta-font-weight', String(bundle.deltaStyle.fontWeight));
        root.style.setProperty('--kexo-' + prefix + '-kpi-delta-icon-size', String(bundle.deltaStyle.iconSize) + 'px');
      }
      applyBundleVars('dashboardCards', 'dashboard');
      applyBundleVars('headerStrip', 'header');
      applyBundleVars('yearlySnapshot', 'snapshot');
      var dash = getChartsKpiBundle('dashboardCards');
      root.style.setProperty('--kexo-kpi-delta-up', dash.palette.up);
      root.style.setProperty('--kexo-kpi-delta-down', dash.palette.down);
      root.style.setProperty('--kexo-kpi-delta-same', dash.palette.same);
      root.style.setProperty('--kexo-kpi-compare-line', dash.palette.compareLine);
    }

    function applyChartsUiConfigV1(cfg) {
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1 || !Array.isArray(cfg.charts)) return false;
      var prevSig = chartUiConfigSignature(chartsUiConfigV1);
      var nextSig = chartUiConfigSignature(cfg);
      chartsUiConfigV1 = cfg;
      try { window.__kexoChartsUiConfigV1 = cfg; } catch (_) {}
      try { safeWriteLocalStorageJson(CHARTS_UI_CFG_LS_KEY, cfg); } catch (_) {}
      try { applyHideChartsOnMobileClass(); } catch (_) {}
      try { applyKpiBundleCssVars(); } catch (_) {}
      return prevSig !== nextSig;
    }

    var chartsUiReRenderTimer = null;
    function scheduleChartsUiReRender() {
      if (chartsUiReRenderTimer) {
        try { clearTimeout(chartsUiReRenderTimer); } catch (_) {}
      }
      chartsUiReRenderTimer = setTimeout(function() {
        chartsUiReRenderTimer = null;
        try {
          if (activeMainTab === 'dashboard') {
            if (typeof refreshDashboard === 'function') refreshDashboard({ force: true });
            return;
          }
          if (activeMainTab === 'stats') {
            refreshStats({ force: true });
            return;
          }
          if (activeMainTab === 'products') {
            refreshProducts({ force: true });
            return;
          }
          if (activeMainTab === 'attribution') {
            try { refreshAttribution({ force: true }); } catch (_) {}
            return;
          }
          if (activeMainTab === 'devices') {
            try { refreshDevices({ force: true }); } catch (_) {}
            return;
          }
          if (activeMainTab === 'browsers') {
            try { refreshBrowsers({ force: true }); } catch (_) {}
            return;
          }
          if (activeMainTab === 'ads') {
            if (window.__adsRefresh) window.__adsRefresh({ force: true });
            return;
          }
          if (activeMainTab === 'spy' || activeMainTab === 'sales' || activeMainTab === 'date') {
            fetchSessions();
            return;
          }
        } catch (_) {}
      }, 80);
    }

    var tablesUiApplyTimer = null;
    function scheduleTablesUiApply() {
      if (tablesUiApplyTimer) {
        try { clearTimeout(tablesUiApplyTimer); } catch (_) {}
      }
      tablesUiApplyTimer = setTimeout(function() {
        tablesUiApplyTimer = null;
        try { applyTablesUiLayoutForPage(); } catch (_) {}
        try {
          window.dispatchEvent(new CustomEvent('kexo:tablesUiConfigApplied', {
            detail: { v: 1 }
          }));
        } catch (_) {}
      }, 80);
    }

    function applyDateRangeUiConfigToSelect(sel) {
      if (!sel) return;
      var cfg = kpiUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.dateRanges)) return;
      var byKey = {};
      cfg.dateRanges.forEach(function(it) {
        if (!it || typeof it !== 'object') return;
        var k = it.key != null ? String(it.key).trim().toLowerCase() : '';
        if (!k) return;
        byKey[k] = it;
      });

      function labelOf(key, fallback) {
        var it = byKey[key] || null;
        var lbl = it && it.label != null ? String(it.label).trim() : '';
        return lbl || fallback || '';
      }
      function enabledOf(key, defaultEnabled) {
        var it = byKey[key] || null;
        if (it && it.enabled === false) return false;
        return defaultEnabled !== false;
      }

      function applyOne(key, fallbackLabel, defaultEnabled, preserveExistingDisabledHidden) {
        var opt = sel.querySelector('option[value="' + key + '"]');
        if (!opt) return;
        opt.textContent = labelOf(key, fallbackLabel);
        var enabled = enabledOf(key, defaultEnabled);
        // Guardrails: never allow disabling Today/Custom via UI config.
        if (key === 'today' || key === 'custom') enabled = true;

        if (!enabled) {
          opt.disabled = true;
          try { opt.hidden = true; } catch (_) {}
          return;
        }
        if (preserveExistingDisabledHidden) return;
        opt.disabled = false;
        try { opt.hidden = false; } catch (_) {}
      }

      applyOne('today', 'Today', true, false);
      // For yesterday, keep availability rules from applyRangeAvailable (floor + rangeAvailable)
      applyOne('yesterday', 'Yesterday', true, true);
      applyOne('7days', 'Last 7 days', true, false);
      applyOne('14days', 'Last 14 days', true, false);
      applyOne('30days', 'Last 30 days', true, false);
      applyOne('custom', 'Custom\u2026', true, false);
    }

    function applyHeaderKpiStripVisibilityByPage(cfg) {
      try {
        var bar = document.getElementById('kexo-kpis');
        if (!bar || !cfg || cfg.v !== 1) return;
        var page = '';
        try {
          page = String(document.body && document.body.getAttribute ? document.body.getAttribute('data-page') : '').trim().toLowerCase();
        } catch (_) { page = ''; }
        if (!page) return;
        var pages = cfg && cfg.headerStrip && cfg.headerStrip.pages && typeof cfg.headerStrip.pages === 'object' ? cfg.headerStrip.pages : null;
        if (!pages) return;
        if (pages[page] === false) bar.style.display = 'none';
        else bar.style.display = '';
      } catch (_) {}
    }

    function applyCondensedKpiUiConfig(cfg) {
      var strip = document.getElementById('kexo-condensed-kpis');
      if (!strip || !cfg || cfg.v !== 1) return;
      var list = cfg && cfg.kpis && Array.isArray(cfg.kpis.header) ? cfg.kpis.header : null;
      if (!list) return;

      var idByKey = {
        orders: 'cond-kpi-orders',
        revenue: 'cond-kpi-revenue',
        profit: 'cond-kpi-profit',
        conv: 'cond-kpi-conv',
        vpv: 'cond-kpi-vpv',
        roas: 'cond-kpi-roas',
        sessions: 'cond-kpi-sessions',
        returning: 'cond-kpi-returning',
        aov: 'cond-kpi-aov',
        cogs: 'cond-kpi-cogs',
        bounce: 'cond-kpi-bounce',
        fulfilled: 'cond-kpi-orders-fulfilled',
        returns: 'cond-kpi-returns',
        items: 'cond-kpi-items-sold',
      };
      var chipByKey = {};
      Object.keys(idByKey).forEach(function(key) {
        var valueEl = document.getElementById(idByKey[key]);
        var chip = valueEl && valueEl.closest ? valueEl.closest('.kexo-kpi-chip') : null;
        if (chip) chipByKey[key] = chip;
      });

      var allChips = Array.prototype.slice.call(strip.querySelectorAll('.kexo-kpi-chip'));
      var seen = new Set();
      var frag = document.createDocumentFragment();

      list.forEach(function(item) {
        if (!item || typeof item !== 'object') return;
        var key = item.key != null ? String(item.key).trim().toLowerCase() : '';
        if (!key) return;
        var chip = chipByKey[key] || null;
        if (!chip) return;
        var labelEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-label') : null;
        if (labelEl && item.label != null) {
          var lbl = String(item.label).trim();
          if (lbl) labelEl.textContent = lbl;
        }
        var enabled = item.enabled !== false;
        if (key === 'profit' && !runtimeProfitKpiAllowed) enabled = false;
        chip.classList.toggle('is-user-disabled', !enabled);
        frag.appendChild(chip);
        seen.add(chip);
      });

      allChips.forEach(function(chip) {
        if (!chip || seen.has(chip)) return;
        try {
          var isProfitChip = !!(chip.querySelector && chip.querySelector('#cond-kpi-profit'));
          if (isProfitChip) chip.classList.toggle('is-user-disabled', !runtimeProfitKpiAllowed);
        } catch (_) {}
        frag.appendChild(chip);
      });

      strip.appendChild(frag);
      scheduleCondensedKpiOverflowUpdate();

      // Options: hide/show common elements via inline style so other logic doesn't flip them back.
      var opt = cfg.options && cfg.options.condensed ? cfg.options.condensed : {};
      var showDelta = opt.showDelta !== false;
      var showProgress = opt.showProgress !== false;
      var showSparkline = opt.showSparkline !== false;
      strip.querySelectorAll('.kexo-kpi-chip').forEach(function(chip) {
        if (!chip) return;
        var deltaEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-delta') : null;
        var progEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-progress') : null;
        var sparkEl = chip.querySelector ? chip.querySelector('.kexo-kpi-chip-sparkline') : null;
        if (deltaEl) deltaEl.style.display = showDelta ? '' : 'none';
        if (progEl) progEl.style.display = showProgress ? '' : 'none';
        if (sparkEl) sparkEl.style.display = showSparkline ? '' : 'none';
      });
    }

    function applyDashboardKpiUiConfig(cfg) {
      var grid = document.getElementById('dash-kpi-grid');
      var midGrid = document.getElementById('dash-kpi-grid-mid');
      var lowerGrid = document.getElementById('dash-kpi-grid-lower');
      if (!grid || !midGrid || !lowerGrid) return;
      var list = cfg && cfg.v === 1 && cfg.kpis && Array.isArray(cfg.kpis.dashboard) ? cfg.kpis.dashboard : null;
      var topCap = 4;
      var desktop = false;
      try {
        desktop = !!(window && window.matchMedia && window.matchMedia('(min-width: 1200px)').matches);
        if (desktop) topCap = 4;
      } catch (_) {}
      var midCap = 4;
      var topVisibleCount = 0;
      var midVisibleCount = 0;

      function pinToLower(key) {
        // Keep special/tall KPI cards out of the top+mid layout so the left KPI stacks
        // align exactly with the 4 overview charts on the right (4 top, 4 mid).
        var k = key != null ? String(key).trim().toLowerCase() : '';
        if (!desktop) return false;
        return k === 'kexo_score';
      }

      var idByKey = {
        revenue: 'dash-kpi-revenue',
        profit: 'dash-kpi-profit',
        orders: 'dash-kpi-orders',
        conv: 'dash-kpi-conv',
        vpv: 'dash-kpi-vpv',
        aov: 'dash-kpi-aov',
        sessions: 'dash-kpi-sessions',
        bounce: 'dash-kpi-bounce',
        returning: 'dash-kpi-returning',
        roas: 'dash-kpi-roas',
        cogs: 'dash-kpi-cogs',
        fulfilled: 'dash-kpi-fulfilled',
        returns: 'dash-kpi-returns',
        items: 'dash-kpi-items',
        kexo_score: 'dash-kpi-kexo-score',
      };
      var defaultKpiOrder = ['revenue', 'profit', 'orders', 'conv', 'vpv', 'aov', 'sessions', 'bounce', 'returning', 'roas', 'kexo_score', 'cogs', 'fulfilled', 'returns', 'items'];
      var colByKey = {};
      var keyByCol = new Map();
      Object.keys(idByKey).forEach(function(key) {
        var valueEl = document.getElementById(idByKey[key]);
        var col = valueEl && valueEl.closest ? valueEl.closest('.col-sm-6') : null;
        if (col) {
          colByKey[key] = col;
          keyByCol.set(col, key);
        }
      });

      var allColsPrimary = Array.prototype.slice.call(grid.children || []).filter(function(el) {
        return el && el.classList && el.classList.contains('col-sm-6');
      });
      var allColsMid = Array.prototype.slice.call(midGrid.children || []).filter(function(el) {
        return el && el.classList && el.classList.contains('col-sm-6');
      });
      var allColsLower = lowerGrid ? Array.prototype.slice.call(lowerGrid.children || []).filter(function(el) {
        return el && el.classList && el.classList.contains('col-sm-6');
      }) : [];
      var allCols = allColsPrimary.concat(allColsMid).concat(allColsLower);
      var seen = new Set();
      var fragPrimary = document.createDocumentFragment();
      var fragMid = document.createDocumentFragment();
      var fragLower = document.createDocumentFragment();

      function chooseBucket(key, enabled) {
        if (!enabled) return 'lower';
        if (pinToLower(key)) return 'lower';
        if (topVisibleCount < topCap) {
          topVisibleCount += 1;
          return 'top';
        }
        if (midVisibleCount < midCap) {
          midVisibleCount += 1;
          return 'mid';
        }
        return 'lower';
      }

      if (list && list.length > 0) {
        list.forEach(function(item) {
          if (!item || typeof item !== 'object') return;
          var key = item.key != null ? String(item.key).trim().toLowerCase() : '';
          if (!key) return;
          var col = colByKey[key] || null;
          if (!col) return;
          var labelEl = col.querySelector ? col.querySelector('.subheader') : null;
          if (labelEl && item.label != null) {
            var lbl = String(item.label).trim();
            if (lbl) labelEl.textContent = lbl;
          }
          var enabled = item.enabled !== false;
          if (key === 'profit' && !runtimeProfitKpiAllowed) enabled = false;
          col.classList.toggle('is-user-disabled', !enabled);
          var bucket = chooseBucket(key, enabled);
          if (bucket === 'top') fragPrimary.appendChild(col);
          else if (bucket === 'mid') fragMid.appendChild(col);
          else fragLower.appendChild(col);
          seen.add(col);
        });
        allCols.forEach(function(col) {
          if (!col || seen.has(col)) return;
          var key = keyByCol && keyByCol.get ? (keyByCol.get(col) || '') : '';
          var enabled = !(key === 'profit' && !runtimeProfitKpiAllowed);
          col.classList.toggle('is-user-disabled', !enabled);
          var bucket = chooseBucket(key, enabled);
          if (bucket === 'top') fragPrimary.appendChild(col);
          else if (bucket === 'mid') fragMid.appendChild(col);
          else fragLower.appendChild(col);
        });
      } else {
        defaultKpiOrder.forEach(function(key) {
          var col = colByKey[key];
          if (!col || seen.has(col)) return;
          var enabled = !(key === 'profit' && !runtimeProfitKpiAllowed);
          col.classList.toggle('is-user-disabled', !enabled);
          var bucket = chooseBucket(key, enabled);
          if (bucket === 'top') fragPrimary.appendChild(col);
          else if (bucket === 'mid') fragMid.appendChild(col);
          else fragLower.appendChild(col);
          seen.add(col);
        });
        allCols.forEach(function(col) {
          if (!col || seen.has(col)) return;
          var key = keyByCol && keyByCol.get ? (keyByCol.get(col) || '') : '';
          var enabled = !(key === 'profit' && !runtimeProfitKpiAllowed);
          col.classList.toggle('is-user-disabled', !enabled);
          var bucket = chooseBucket(key, enabled);
          if (bucket === 'top') fragPrimary.appendChild(col);
          else if (bucket === 'mid') fragMid.appendChild(col);
          else fragLower.appendChild(col);
        });
      }
      grid.appendChild(fragPrimary);
      midGrid.appendChild(fragMid);
      lowerGrid.appendChild(fragLower);

      var showDelta = (cfg && cfg.options && cfg.options.dashboard && cfg.options.dashboard.showDelta === false) ? false : true;
      var deltaEls = Array.prototype.slice.call(grid.querySelectorAll('.dash-kpi-delta'));
      deltaEls = deltaEls.concat(Array.prototype.slice.call(midGrid.querySelectorAll('.dash-kpi-delta')));
      if (lowerGrid) deltaEls = deltaEls.concat(Array.prototype.slice.call(lowerGrid.querySelectorAll('.dash-kpi-delta')));
      deltaEls.forEach(function(el) {
        if (!el) return;
        el.style.display = showDelta ? '' : 'none';
      });
    }

    function isStandardDateRangeKey(key) {
      var k = key != null ? String(key).trim().toLowerCase() : '';
      return k === 'today' || k === 'yesterday' || k === '7days' || k === '14days' || k === '30days' || k === 'custom';
    }

    function ensureDateRangeAllowedByUiConfig() {
      var cfg = kpiUiConfigV1;
      if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.dateRanges)) return;
      if (!isStandardDateRangeKey(dateRange)) return;
      if (dateRange === 'today' || dateRange === 'custom') return;
      var key = String(dateRange || '').trim().toLowerCase();
      var item = cfg.dateRanges.find(function(it) { return it && typeof it === 'object' && String(it.key || '').trim().toLowerCase() === key; }) || null;
      if (item && item.enabled === false) {
        dateRange = 'today';
        try { syncDateSelectOptions(); } catch (_) {}
        try { applyDateRangeChange(); } catch (_) {}
      }
    }

    function applyKpiUiConfigV1(cfg) {
      if (!cfg || typeof cfg !== 'object' || cfg.v !== 1) return;
      if (cfg.headerStrip && typeof cfg.headerStrip.pages === 'object') {
        cfg.headerStrip.pages.dashboard = true;
      } else if (cfg.headerStrip) {
        cfg.headerStrip.pages = cfg.headerStrip.pages || {};
        cfg.headerStrip.pages.dashboard = true;
      } else {
        cfg.headerStrip = { pages: { dashboard: true } };
      }
      kpiUiConfigV1 = cfg;
      try { window.__kexoKpiUiConfigV1 = cfg; } catch (_) {}
      try { safeWriteLocalStorageJson(KPI_UI_CFG_LS_KEY, cfg); } catch (_) {}
      try { applyHeaderKpiStripVisibilityByPage(cfg); } catch (_) {}
      try { applyCondensedKpiUiConfig(cfg); } catch (_) {}
      try { applyDashboardKpiUiConfig(cfg); } catch (_) {}
      if (!_dashboardKpiResizeWired) {
        _dashboardKpiResizeWired = true;
        try {
          window.addEventListener('resize', function () {
            if (_dashboardKpiResizeTimer) {
              try { clearTimeout(_dashboardKpiResizeTimer); } catch (_) {}
            }
            _dashboardKpiResizeTimer = setTimeout(function () {
              _dashboardKpiResizeTimer = 0;
              try {
                if (kpiUiConfigV1 && kpiUiConfigV1.v === 1) applyDashboardKpiUiConfig(kpiUiConfigV1);
              } catch (_) {}
            }, 120);
          });
        } catch (_) {}
      }
      try { syncDateSelectOptions(); } catch (_) {}
      try { ensureDateRangeAllowedByUiConfig(); } catch (_) {}
    }

    // Apply cached KPI settings immediately (before async /api/settings returns).
    try { if (kpiUiConfigV1) applyKpiUiConfigV1(kpiUiConfigV1); } catch (_) {}
    try { window.__applyDashboardKpiUiConfig = function() { applyDashboardKpiUiConfig(kpiUiConfigV1 || null); }; } catch (_) {}

    function ensureUiSettingsLoaded(options) {
      options = options && typeof options === 'object' ? options : {};
      var force = !!options.force;
      var ttlMs = 5 * 60 * 1000;
      if (!force && uiSettingsCache && uiSettingsFetchedAt && (Date.now() - uiSettingsFetchedAt) < ttlMs) {
        if (options.apply && uiSettingsCache.kpiUiConfig) applyKpiUiConfigV1(uiSettingsCache.kpiUiConfig);
        if (options.apply && uiSettingsCache.chartsUiConfig) {
          var changedFromCache = applyChartsUiConfigV1(uiSettingsCache.chartsUiConfig);
          if (changedFromCache) scheduleChartsUiReRender();
        }
        if (options.apply && uiSettingsCache.tablesUiConfig) {
          try { applyTablesUiConfigV1(uiSettingsCache.tablesUiConfig); } catch (_) {}
          try { scheduleTablesUiApply(); } catch (_) {}
        }
        if (options.apply && uiSettingsCache.pageLoaderEnabled) {
          try { applyPageLoaderEnabledV1(uiSettingsCache.pageLoaderEnabled); } catch (_) {}
        }
        if (options.apply && uiSettingsCache.assetOverrides) {
          var cachedUrl = (uiSettingsCache.assetOverrides.saleSound || uiSettingsCache.assetOverrides.sale_sound || '').trim();
          try { window.__kexoSaleSoundOverrideUrl = cachedUrl || ''; } catch (_) {}
          if (typeof window.__kexoApplySaleSoundOverride === 'function') {
            try { window.__kexoApplySaleSoundOverride(cachedUrl ? cachedUrl : null); } catch (_) {}
          }
        }
        return Promise.resolve(uiSettingsCache);
      }
      if (uiSettingsInFlight) return uiSettingsInFlight;
      var url = API + '/api/settings' + (force ? ('?_=' + Date.now()) : '');
      uiSettingsInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 15000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(data) {
          uiSettingsCache = (data && data.ok) ? data : null;
          uiSettingsFetchedAt = Date.now();
          if (options.apply && uiSettingsCache && uiSettingsCache.kpiUiConfig) applyKpiUiConfigV1(uiSettingsCache.kpiUiConfig);
          if (options.apply && uiSettingsCache && uiSettingsCache.chartsUiConfig) {
            var changedFromFetch = applyChartsUiConfigV1(uiSettingsCache.chartsUiConfig);
            if (changedFromFetch) scheduleChartsUiReRender();
          }
          if (options.apply && uiSettingsCache && uiSettingsCache.tablesUiConfig) {
            try { applyTablesUiConfigV1(uiSettingsCache.tablesUiConfig); } catch (_) {}
            try { scheduleTablesUiApply(); } catch (_) {}
          }
          if (options.apply && uiSettingsCache && uiSettingsCache.pageLoaderEnabled) {
            try { applyPageLoaderEnabledV1(uiSettingsCache.pageLoaderEnabled); } catch (_) {}
          }
          if (options.apply && uiSettingsCache && uiSettingsCache.assetOverrides) {
            var url = (uiSettingsCache.assetOverrides.saleSound || uiSettingsCache.assetOverrides.sale_sound || '').trim();
            try { window.__kexoSaleSoundOverrideUrl = url || ''; } catch (_) {}
            if (typeof window.__kexoApplySaleSoundOverride === 'function') {
              try { window.__kexoApplySaleSoundOverride(url ? url : null); } catch (_) {}
            }
          }
          return uiSettingsCache;
        })
        .catch(function() { return null; })
        .finally(function() { uiSettingsInFlight = null; });
      return uiSettingsInFlight;
    }

    try {
      window.addEventListener('kexo:kpiUiConfigUpdated', function(e) {
        var cfg = e && e.detail ? e.detail : null;
        try { applyKpiUiConfigV1(cfg); } catch (_) {}
      });
    } catch (_) {}

    try {
      window.addEventListener('kexo:chartsUiConfigUpdated', function(e) {
        var cfg = e && e.detail ? e.detail : null;
        try {
          var changed = applyChartsUiConfigV1(cfg);
          if (changed) scheduleChartsUiReRender();
        } catch (_) {}
      });
    } catch (_) {}

    try {
      window.addEventListener('kexo:tablesUiConfigUpdated', function(e) {
        var cfg = e && e.detail ? e.detail : null;
        try {
          applyTablesUiConfigV1(cfg);
          scheduleTablesUiApply();
        } catch (_) {}
      });
    } catch (_) {}

    let kpiExpandedExtrasCache = null;
    let kpiExpandedExtrasRange = null;
    let kpiExpandedExtrasFetchedAt = 0;
    let kpiExpandedExtrasInFlight = null;

    function renderExpandedKpiExtras(extras) {
      const condItemsEl = document.getElementById('cond-kpi-items-sold');
      const condFulfilledEl = document.getElementById('cond-kpi-orders-fulfilled');
      const condReturnsEl = document.getElementById('cond-kpi-returns');
      const condCogsEl = document.getElementById('cond-kpi-cogs');
      if (!condItemsEl && !condFulfilledEl && !condReturnsEl && !condCogsEl) return;

      const itemsSold = extras && typeof extras.itemsSold === 'number' ? extras.itemsSold : null;
      const ordersFulfilled = extras && typeof extras.ordersFulfilled === 'number' ? extras.ordersFulfilled : null;
      const returnsAmount = extras && typeof extras.returns === 'number' ? extras.returns : null;
      const cogsAmount = extras && typeof extras.cogs === 'number' ? extras.cogs : null;
      const compare = extras && extras.compare ? extras.compare : null;
      const itemsSoldCompare = compare && typeof compare.itemsSold === 'number' ? compare.itemsSold : null;
      const ordersFulfilledCompare = compare && typeof compare.ordersFulfilled === 'number' ? compare.ordersFulfilled : null;
      const returnsCompare = compare && typeof compare.returns === 'number' ? compare.returns : null;
      const cogsCompare = compare && typeof compare.cogs === 'number' ? compare.cogs : null;

      function formatReturns(v) {
        return formatNegativeCurrencyOrZero(v, false);
      }
      if (condItemsEl) condItemsEl.textContent = itemsSold != null ? formatSessions(itemsSold) : '\u2014';
      if (condFulfilledEl) condFulfilledEl.textContent = ordersFulfilled != null ? formatSessions(ordersFulfilled) : '\u2014';
      if (condReturnsEl) condReturnsEl.textContent = returnsAmount != null ? formatReturns(returnsAmount) : '\u2014';
      if (condCogsEl) condCogsEl.textContent = cogsAmount != null ? formatRevenue(cogsAmount) : '\u2014';
      applyCondensedKpiDelta('items-sold', itemsSold, itemsSoldCompare, false);
      applyCondensedKpiDelta('orders-fulfilled', ordersFulfilled, ordersFulfilledCompare, false);
      applyCondensedKpiDelta('returns', returnsAmount, returnsCompare, true);
      applyCondensedKpiDelta('cogs', cogsAmount, cogsCompare, true);

      function setTone(id, current, baseline, invert) {
        const sparkEl = document.getElementById(id);
        if (!sparkEl) return;
        const cur = (typeof current === 'number' && Number.isFinite(current)) ? current : null;
        const base = (typeof baseline === 'number' && Number.isFinite(baseline)) ? baseline : null;
        if (cur == null || base == null) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        const delta = invert ? (base - cur) : (cur - base);
        if (Math.abs(delta) < 1e-9) {
          sparkEl.removeAttribute('data-tone');
          return;
        }
        const denom = Math.abs(base);
        if (denom > 1e-9) {
          const ratio = delta / denom;
          if (Math.abs(ratio) <= KPI_STABLE_RATIO) {
            sparkEl.removeAttribute('data-tone');
            return;
          }
        }
        sparkEl.setAttribute('data-tone', delta < 0 ? 'down' : 'up');
      }
      setTone('cond-kpi-items-sold-sparkline', itemsSold, itemsSoldCompare, false);
      setTone('cond-kpi-orders-fulfilled-sparkline', ordersFulfilled, ordersFulfilledCompare, false);
      setTone('cond-kpi-returns-sparkline', returnsAmount, returnsCompare, true);
      setTone('cond-kpi-cogs-sparkline', cogsAmount, cogsCompare, true);

      if (!condensedSparklineOverrides || typeof condensedSparklineOverrides !== 'object') condensedSparklineOverrides = {};
      condensedSparklineOverrides['cond-kpi-orders-fulfilled-sparkline'] = (ordersFulfilled != null && ordersFulfilledCompare != null) ? [ordersFulfilledCompare, ordersFulfilled] : null;
      condensedSparklineOverrides['cond-kpi-returns-sparkline'] = (returnsAmount != null && returnsCompare != null) ? [returnsCompare, returnsAmount] : null;
      condensedSparklineOverrides['cond-kpi-cogs-sparkline'] = (cogsAmount != null && cogsCompare != null) ? [cogsCompare, cogsAmount] : null;

      try { renderCondensedSparklines(condensedSeriesCache || sparklineHistorySeriesCache || []); } catch (_) {}

      try { updateCondensedKpiOverflow(); } catch (_) {}
    }

    function fetchExpandedKpiExtras(options = {}) {
      const force = !!options.force;
      const rangeKey = getStatsRange();
      if (!rangeKey) return Promise.resolve(null);
      // Paint from localStorage first to avoid empty KPI boxes on fast navigation.
      if (!force) {
        try {
          const wantHydrate =
            (!kpiExpandedExtrasCache || kpiExpandedExtrasRange !== rangeKey) ||
            (!kpiExpandedExtrasFetchedAt || (Date.now() - kpiExpandedExtrasFetchedAt) > KPI_EXTRAS_CACHE_TTL_MS);
          if (wantHydrate) hydrateExpandedExtrasFromLocalStorage(rangeKey, true);
        } catch (_) {}
      }

      const stale = !kpiExpandedExtrasFetchedAt || (Date.now() - kpiExpandedExtrasFetchedAt) > KPI_EXTRAS_CACHE_TTL_MS;
      if (!force && !stale && kpiExpandedExtrasCache && kpiExpandedExtrasRange === rangeKey) {
        return Promise.resolve(kpiExpandedExtrasCache);
      }
      if (kpiExpandedExtrasInFlight && !force && kpiExpandedExtrasRange === rangeKey) return kpiExpandedExtrasInFlight;
      let url = API + '/api/kpis-expanded-extra?range=' + encodeURIComponent(rangeKey);
      try {
        const shop = getShopForSales();
        if (shop) url += '&shop=' + encodeURIComponent(shop);
      } catch (_) {}
      if (force) url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
      const cacheMode = force ? 'no-store' : 'default';
      kpiExpandedExtrasRange = rangeKey;
      // Extras KPIs can be expensive (Shopify updated-orders scan); allow longer to avoid aborting on cold cache.
      kpiExpandedExtrasInFlight = fetchWithTimeout(url, { credentials: 'same-origin', cache: cacheMode }, 60000)
        .then(function(r) { return (r && r.ok) ? r.json() : null; })
        .then(function(extras) {
          kpiExpandedExtrasCache = extras || null;
          kpiExpandedExtrasFetchedAt = Date.now();
          try { setRangeCacheEntry(KPI_EXTRAS_CACHE_LS_KEY, rangeKey, kpiExpandedExtrasCache, 12); } catch (_) {}
          // Dashboard KPI cards use extras spark series for COGS/Fulfilled/Returns.
          // Once extras arrive, silently re-render the cached dashboard so sparklines appear without a refetch.
          try {
            if (PAGE === 'dashboard' && dashCache && typeof window.refreshDashboard === 'function') {
              window.refreshDashboard({ force: false, silent: true });
            }
          } catch (_) {}
          return kpiExpandedExtrasCache;
        })
        .catch(function() { return null; })
        .finally(function() { kpiExpandedExtrasInFlight = null; });
      return kpiExpandedExtrasInFlight;
    }

    (function initCondensedKpisUi() {
      try { window.addEventListener('resize', function() { scheduleCondensedKpiOverflowUpdate(); }); } catch (_) {}
