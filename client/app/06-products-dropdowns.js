      const btn = document.getElementById('products-leaderboard-btn');
      const menu = document.getElementById('products-leaderboard-menu');
      const root = document.getElementById('products-leaderboard-dropdown');
      if (!btn || !menu || !root) return;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleProductsLeaderboardMenu();
      });
      menu.addEventListener('click', function(e) {
        const t = e && e.target ? e.target : null;
        const opt = t && t.closest ? t.closest('.aov-cards-title-option') : null;
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        setProductsLeaderboardView(opt.getAttribute('data-view') || '', { force: false });
      });
      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        if (target && root.contains && root.contains(target)) return;
        closeProductsLeaderboardMenu();
      });
      document.addEventListener('keydown', function(e) {
        if (!e || e.key !== 'Escape') return;
        closeProductsLeaderboardMenu();
      });
    })();

    function normalizeProductsVariantCardsView(v) {
      const s = v != null ? String(v).trim().toLowerCase() : '';
      if (s === 'lengths' || s === 'length') return 'lengths';
      return 'finishes';
    }

    function labelForProductsVariantCardsView(view) {
      return normalizeProductsVariantCardsView(view) === 'lengths' ? 'Variant Length' : 'Variant Finish';
    }

    function updateProductsVariantCardsDropdownUi() {
      const view = normalizeProductsVariantCardsView(productsVariantCardsView);
      const labelEl = document.getElementById('products-variant-cards-label');
      const grid = document.getElementById('finishes-cards-grid');
      const wrap = document.getElementById('finishes-cards-wrap');
      const menu = document.getElementById('products-variant-cards-menu');
      if (labelEl) labelEl.textContent = labelForProductsVariantCardsView(view);
      if (grid) grid.setAttribute('data-cards-view', view);
      if (wrap) wrap.setAttribute('data-cards-view', view);
      if (menu) {
        const opts = menu.querySelectorAll('.aov-cards-title-option');
        opts.forEach(function(el) {
          const v = normalizeProductsVariantCardsView(el && el.getAttribute ? el.getAttribute('data-view') : '');
          el.setAttribute('aria-current', v === view ? 'true' : 'false');
        });
      }
    }

    function closeProductsVariantCardsMenu() {
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      if (menu) {
        menu.classList.remove('open');
        menu.setAttribute('aria-hidden', 'true');
      }
    }

    function toggleProductsVariantCardsMenu() {
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      if (!btn || !menu) return;
      const open = btn.getAttribute('aria-expanded') === 'true';
      if (open) {
        closeProductsVariantCardsMenu();
      } else {
        btn.setAttribute('aria-expanded', 'true');
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
      }
    }

    function setProductsVariantCardsView(nextView, options = {}) {
      const force = !!(options && options.force);
      const view = normalizeProductsVariantCardsView(nextView);
      productsVariantCardsView = view;
      try { sessionStorage.setItem(PRODUCTS_VARIANT_CARDS_VIEW_KEY, view); } catch (_) {}
      updateProductsVariantCardsDropdownUi();
      closeProductsVariantCardsMenu();
      if (activeMainTab !== 'breakdown' && activeMainTab !== 'products') return;
      if (view === 'lengths') {
        if (lengthsCache) renderLengths(lengthsCache);
        fetchLengths({ force }).catch(function() {});
      } else {
        if (finishesCache) renderFinishes(finishesCache);
        fetchFinishes({ force }).catch(function() {});
      }
    }

    (function initProductsVariantCardsDropdown() {
      updateProductsVariantCardsDropdownUi();
      const btn = document.getElementById('products-variant-cards-btn');
      const menu = document.getElementById('products-variant-cards-menu');
      const root = document.getElementById('products-variant-cards-dropdown');
      if (!btn || !menu || !root) return;
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleProductsVariantCardsMenu();
      });
      menu.addEventListener('click', function(e) {
        const t = e && e.target ? e.target : null;
        const opt = t && t.closest ? t.closest('.aov-cards-title-option') : null;
        if (!opt) return;
        e.preventDefault();
        e.stopPropagation();
        setProductsVariantCardsView(opt.getAttribute('data-view') || '', { force: false });
      });
      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        if (target && root.contains && root.contains(target)) return;
        closeProductsVariantCardsMenu();
      });
      document.addEventListener('keydown', function(e) {
        if (!e || e.key !== 'Escape') return;
        closeProductsVariantCardsMenu();
      });
    })();

    function fetchProductsLeaderboard(options = {}) {
      const force = !!options.force;
      var shop = getShopParam() || shopForSalesFallback || null;
      if (!shop) {
        leaderboardLoading = false;
        leaderboardCache = null;
        renderProductsLeaderboard(null);
        return Promise.resolve(null);
      }
      leaderboardLoading = true;
      if (!leaderboardCache) renderProductsLeaderboard(null);
      let url = API + '/api/shopify-leaderboard?shop=' + encodeURIComponent(shop) +
        '&topProducts=' + encodeURIComponent(String(PRODUCTS_LEADERBOARD_FETCH_LIMIT)) +
        '&topTypes=' + encodeURIComponent(String(PRODUCTS_LEADERBOARD_FETCH_LIMIT)) +
        '&range=' + encodeURIComponent(getStatsRange());
      if (force) url += '&_=' + Date.now();
      return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          leaderboardCache = data;
          leaderboardLoading = false;
          renderProductsLeaderboard(data);
          renderAllTypeTables(data);
          return data;
        })
        .catch(function() { leaderboardCache = null; leaderboardLoading = false; renderProductsLeaderboard(null); renderAllTypeTables(null); return null; })
        .finally(function() { leaderboardLoading = false; });
    }

    function productsLeaderboardIsMobile() {
      return !!(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    function productsLeaderboardIsMedium() {
      return !!(window.matchMedia && window.matchMedia('(max-width: 980px)').matches);
    }

    function productsLeaderboardColumnsForView(view) {
      const v = normalizeProductsLeaderboardView(view);
      const isMobile = productsLeaderboardIsMobile();
      const isMedium = !isMobile && productsLeaderboardIsMedium();
      if (v === 'type') {
        if (isMobile) return 1;
        if (isMedium) return 2;
        return 4;
      }
      // v === 'title'
      if (isMobile) return 2;
      if (isMedium) return 4;
      return 6;
    }

    function productsLeaderboardMaxItems() {
      return productsLeaderboardIsMobile() ? 4 : 12;
    }

    function sliceProductsLeaderboardEven(list, view) {
      const arr = Array.isArray(list) ? list : [];
      const cols = productsLeaderboardColumnsForView(view);
      const max = productsLeaderboardMaxItems();
      const target = Math.min(arr.length, max);
      if (target <= 0) return [];
      if (cols <= 1 || target < cols) return arr.slice(0, target);
      const even = target - (target % cols);
      return arr.slice(0, even || target);
    }

    function renderProductsLeaderboard(data) {
      const view = normalizeProductsLeaderboardView(productsLeaderboardView);
      const grid = document.getElementById('leaderboard-cards-grid');
      if (!grid) return;
      grid.setAttribute('data-leaderboard-view', view);

      const hasData = !!(data && data.ok);
      const listAll = hasData ? (view === 'type' ? (data.byType || []) : (data.byTitle || [])) : [];
      const list = sliceProductsLeaderboardEven(listAll, view);

      if (!hasData || !listAll.length) {
        if (leaderboardLoading) {
          grid.innerHTML = '<div class="aov-card aov-card-empty aov-card--leaderboard-loading"><span class="inline-spinner" aria-hidden="true"></span><span>Building leaderboards...</span></div>';
        } else {
          grid.innerHTML = '<div class="aov-card aov-card-empty">No data</div>';
        }
        return;
      }

      if (view === 'type') {
        grid.innerHTML = list.map(function(row) {
          const label = row && (row.label || row.key) ? String(row.label || row.key) : 'Unknown';
          const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
          const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
          const cr = crPillHtml(row && row.cr);
          return '<div class="aov-card aov-card--leaderboard aov-card--leaderboard-type">' +
              '<div class="aov-card-left"><span class="aov-card-name leaderboard-type-name">' + escapeHtml(label || 'Unknown') + '</span></div>' +
              '<div class="aov-card-value"><span class="aov-card-value-main">' + escapeHtml(value) + '</span>' + cr + '</div>' +
            '</div>';
        }).join('');
        return;
      }

      // view === 'title'
      const mainBase = getMainBaseUrl();
      grid.innerHTML = list.map(function(row) {
        const title = row && row.title != null ? String(row.title) : 'Product';
        const handle = row && row.handle ? String(row.handle) : '';
        const productId = (row && row.product_id) ? String(row.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        const thumb = row && row.thumb_url ? String(row.thumb_url) : '';
        const rev = row && row.revenueGbp != null ? Number(row.revenueGbp) : 0;
        const value = formatMoneyCompact(Number.isFinite(rev) ? rev : 0, 'GBP') || '\u00A30';
        const cr = crPillHtml(row && row.cr);
        const productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        const canOpen = handle || (productId && /^\d+$/.test(productId));
        const thumbInner = '<span class="thumb-wrap">' +
            (thumb
              ? '<img class="landing-thumb" src="' + escapeHtml(hotImgSquare(thumb) || thumb) + '" alt="" loading="lazy" onerror="this.remove()">'
              : '') +
          '</span>';
        const img = canOpen
          ? '<a class="leaderboard-thumb-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener" aria-label="Open product: ' + escapeHtml(title || 'Product') + '"' +
            (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
            (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
            (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
            (thumb ? (' data-product-thumb="' + escapeHtml(thumb) + '"') : '') +
          '>' + thumbInner + '</a>'
          : thumbInner;
        return '<div class="aov-card aov-card--leaderboard aov-card--leaderboard-title">' +
            '<div class="aov-card-left">' +
              img +
              '<span class="aov-card-name sr-only">' + escapeHtml(title || 'Product') + '</span>' +
            '</div>' +
            '<div class="aov-card-value"><span class="aov-card-value-main">' + escapeHtml(value) + '</span>' + cr + '</div>' +
          '</div>';
      }).join('');
    }

    // ?????? Product Type Tables (Necklaces, Bracelets, Earrings, Sets, Charms, Extras) ??????
    function setHiddenById(id, hidden) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('is-hidden', !!hidden);
    }

    var TYPE_TABLE_DEFS = [
      { id: 'necklaces', keys: ['necklaces', 'necklace'] },
      { id: 'bracelets', keys: ['bracelets', 'bracelet'] },
      { id: 'earrings',  keys: ['earrings', 'earring'] },
      { id: 'sets',      keys: ['jewellery sets', 'jewellery set', 'jewelry sets', 'jewelry set', 'sets', 'set'] },
      { id: 'charms',    keys: ['charms', 'charm'] },
      { id: 'extras',    keys: ['extras', 'extra'] },
    ];
    function getTypeTablePageSize(def) {
      var id = def && def.id ? ('type-' + def.id + '-table') : '';
      return getTableRowsPerPage(id, 'product');
    }
    var typeTablePages = {};
    TYPE_TABLE_DEFS.forEach(function(d) { typeTablePages[d.id] = 1; });

    function getTypeProducts(data, def) {
      if (!data || !data.productsByType) return [];
      var out = [];
      for (var i = 0; i < def.keys.length; i++) {
        var arr = data.productsByType[def.keys[i]];
        if (Array.isArray(arr)) out = out.concat(arr);
      }
      return out;
    }

    function renderTypeTable(data, def) {
      var tbody = document.getElementById('type-' + def.id + '-body');
      if (!tbody) return;
      var rows = getTypeProducts(data, def);
      var sessionsTotal = 0;
      for (var i = 0; i < rows.length; i++) sessionsTotal += Number(rows[i] && rows[i].sessions) || 0;
      var hideCard = !leaderboardLoading && sessionsTotal <= 0;
      setHiddenById('stats-type-' + def.id, hideCard);
      if (hideCard) {
        tbody.innerHTML = '';
        updateCardPagination('type-' + def.id, 1, 1);
        return;
      }
      if (!rows.length) {
        tbody.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + (leaderboardLoading ? 'Loading\u2026' : 'No data') + '</div></div>';
        updateCardPagination('type-' + def.id, 1, 1);
        return;
      }
      var pageSize = getTypeTablePageSize(def);
      var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      var page = clampPage(typeTablePages[def.id] || 1, totalPages);
      typeTablePages[def.id] = page;
      updateCardPagination('type-' + def.id, page, totalPages);
      var start = (page - 1) * pageSize;
      var pageRows = rows.slice(start, start + pageSize);
      const mainBase = getMainBaseUrl();
      tbody.innerHTML = pageRows.map(function(r) {
        var title = r && r.title ? String(r.title) : '???';
        var orders = r && r.orders != null ? Number(r.orders) : 0;
        var sessions = r && r.sessions != null ? Number(r.sessions) : 0;
        var revNum = r && r.revenueGbp != null ? Number(r.revenueGbp) : null;
        if (!Number.isFinite(revNum)) revNum = null;
        var rev = revNum != null ? formatRevenueTableHtml(revNum) : '???';
        var cr = r && r.cr != null ? pct(r.cr) : '???';
        var vpvNum = (revNum != null && sessions > 0) ? (revNum / sessions) : null;
        var vpv = (vpvNum != null && Number.isFinite(vpvNum)) ? formatRevenue(vpvNum) : '\u2014';
        var handle = r && r.handle ? String(r.handle) : '';
        var productId = (r && r.product_id) ? String(r.product_id).replace(/^gid:\/\/shopify\/Product\//i, '').trim() : '';
        var productUrl = (mainBase && handle) ? (mainBase + '/products/' + encodeURIComponent(handle)) : '#';
        var canOpen = handle || (productId && /^\d+$/.test(productId));
        var nameInner = canOpen
          ? (
              '<a class="kexo-product-link js-product-modal-link" href="' + escapeHtml(productUrl) + '" target="_blank" rel="noopener"' +
                (handle ? (' data-product-handle="' + escapeHtml(handle) + '"') : '') +
                (productId && /^\d+$/.test(productId) ? (' data-product-id="' + escapeHtml(productId) + '"') : '') +
                (title ? (' data-product-title="' + escapeHtml(title) + '"') : '') +
              '>' + escapeHtml(title) + '</a>'
            )
          : escapeHtml(title);
        var name = '<span class="bs-name" title="' + escapeHtml(title) + '">' + nameInner + '</span>';
        return '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell">' + name + '</div></div>' +
          '<div class="grid-cell" role="cell">' + formatSessions(sessions) + '</div>' +
          '<div class="grid-cell" role="cell">' + formatSessions(orders) + '</div>' +
          '<div class="grid-cell" role="cell">' + cr + '</div>' +
          '<div class="grid-cell" role="cell">' + vpv + '</div>' +
          '<div class="grid-cell" role="cell">' + rev + '</div>' +
        '</div>';
      }).join('');
    }

    function renderAllTypeTables(data) {
      TYPE_TABLE_DEFS.forEach(function(def) { renderTypeTable(data, def); });
      // If every type table is hidden (0 sessions), hide the whole row.
      try {
        var rowWrap = document.getElementById('products-type-tables-row');
        if (rowWrap) {
          var anyVisible = false;
          for (var i = 0; i < TYPE_TABLE_DEFS.length; i++) {
            var id = TYPE_TABLE_DEFS[i] && TYPE_TABLE_DEFS[i].id ? String(TYPE_TABLE_DEFS[i].id) : '';
            if (!id) continue;
            var card = document.getElementById('stats-type-' + id);
            if (card && !card.classList.contains('is-hidden')) { anyVisible = true; break; }
          }
          rowWrap.classList.toggle('is-hidden', !anyVisible);
        }
        var note = document.getElementById('products-hidden-tables-note');
        if (note) {
          var hiddenCount = 0;
          for (var i = 0; i < TYPE_TABLE_DEFS.length; i++) {
            var id = TYPE_TABLE_DEFS[i] && TYPE_TABLE_DEFS[i].id ? String(TYPE_TABLE_DEFS[i].id) : '';
            if (!id) continue;
            var card = document.getElementById('stats-type-' + id);
            if (card && card.classList.contains('is-hidden')) hiddenCount++;
          }
          note.style.display = hiddenCount > 0 ? '' : 'none';
        }
      } catch (_) {}
    }

    (function initTypeTablePagination() {
      TYPE_TABLE_DEFS.forEach(function(def) {
        var wrap = document.getElementById('type-' + def.id + '-pagination');
        if (!wrap) return;
        wrap.addEventListener('click', function(e) {
          var link = e.target.closest('a[data-page]');
          if (!link) return;
          e.preventDefault();
          if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
          var pg = parseInt(link.dataset.page, 10);
          if (!pg || pg < 1) return;
          typeTablePages[def.id] = pg;
          renderTypeTable(leaderboardCache, def);
        });
      });
    })();

    (function initProductsLeaderboardResizeWatcher() {
      let raf = null;
