        if (!tableEl || !tableEl.querySelector) return;
        var headerRow = tableEl.querySelector('.grid-row--header');
        var headerCells = headerRow ? headerRow.querySelectorAll('.grid-cell') : [];
        var labels = Array.from(headerCells).map(function(c) {
          var a = c.getAttribute('aria-label');
          if (a) return a.trim();
          var long = c.querySelector('.th-label-long');
          if (long && long.textContent) return long.textContent.trim();
          return (c.textContent || '').trim();
        });
        if (labels.length === 0) return;
        tableEl.querySelectorAll('.grid-body .grid-row').forEach(function(row) {
          var cells = row.querySelectorAll('.grid-cell:not(.span-all)');
          cells.forEach(function(cell, i) {
            if (labels[i]) cell.setAttribute('data-label', labels[i]);
          });
        });
      }
      function observeGridBodies() {
        document.querySelectorAll('.grid-table .grid-body').forEach(function(body) {
          if (body._gridLabelsObserved) return;
          body._gridLabelsObserved = true;
          syncLabels(body.closest('.grid-table'));
          var mo = new MutationObserver(function() {
            syncLabels(body.closest('.grid-table'));
          });
          mo.observe(body, { childList: true, subtree: true });
        });
      }
      function run() {
        observeGridBodies();
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
      setTimeout(run, 800);
      setTimeout(run, 2000);
    })();

    (function initHorizontalDragScroll() {
      var WRAP_SELECTOR = '.table-scroll-wrap, .country-table-wrap, .table-responsive, .tools-table-wrap';

      function shouldIgnoreTarget(target) {
        if (!target || !target.closest) return false;
        return !!target.closest('a, button, input, select, textarea, label, [role="button"], [data-no-drag-scroll]');
      }

      function setDragEnabledClass(wrap) {
        if (!wrap) return;
        var canDrag = (wrap.scrollWidth || 0) > ((wrap.clientWidth || 0) + 1);
        wrap.classList.toggle('is-drag-scroll', !!canDrag);
      }

      function shouldSkipStickyScrollClass(wrap) {
        if (!wrap || !wrap.querySelector) return true;
        return !!wrap.querySelector('#latest-sales-table');
      }

      function updateStickyScrollClass(wrap) {
        if (!wrap || shouldSkipStickyScrollClass(wrap)) return;
        var scrolled = (wrap.scrollLeft || 0) > 0;
        wrap.classList.toggle('kexo-sticky-scrolled', scrolled);
      }

      function bind(wrap) {
        if (!wrap || wrap.getAttribute('data-drag-scroll-bound') === '1') return;
        wrap.setAttribute('data-drag-scroll-bound', '1');
        setDragEnabledClass(wrap);

        if (!shouldSkipStickyScrollClass(wrap)) {
          updateStickyScrollClass(wrap);
          wrap.addEventListener('scroll', function() { updateStickyScrollClass(wrap); }, { passive: true });
        }

        var startX = 0;
        var startScrollLeft = 0;
        var dragging = false;
        var moved = false;

        wrap.addEventListener('pointerdown', function(e) {
          if (!e) return;
          var pt = String(e.pointerType || '').toLowerCase();
          if (pt === 'mouse' && e.button !== 0) return;
          var scrollbarHidden = (getComputedStyle(wrap).getPropertyValue('scrollbar-width') || '').trim() === 'none';
          if ((e.pointerType || '') === 'touch' && !scrollbarHidden) return; // native swipe when scrollbar visible; when hidden (mobile/emulation), run our drag
          if (!wrap.classList.contains('is-drag-scroll')) return;
          if (shouldIgnoreTarget(e.target)) return;
          dragging = true;
          moved = false;
          startX = e.clientX;
          startScrollLeft = wrap.scrollLeft;
          wrap.classList.add('is-dragging');
          try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
        });

        wrap.addEventListener('pointermove', function(e) {
          if (!dragging) return;
          var dx = e.clientX - startX;
          if (!moved && Math.abs(dx) > 3) moved = true;
          wrap.scrollLeft = startScrollLeft - dx;
          if (moved) e.preventDefault();
        });

        function endDrag(e) {
          if (!dragging) return;
          dragging = false;
          wrap.classList.remove('is-dragging');
          try { if (e && e.pointerId != null) wrap.releasePointerCapture(e.pointerId); } catch (_) {}
        }

        wrap.addEventListener('pointerup', endDrag);
        wrap.addEventListener('pointercancel', endDrag);
        wrap.addEventListener('pointerleave', function(e) {
          if (!dragging) return;
          if (e && e.buttons === 1) return;
          endDrag(e);
        });

        if (typeof ResizeObserver !== 'undefined') {
          try {
            var ro = new ResizeObserver(function() {
              setDragEnabledClass(wrap);
              if (!shouldSkipStickyScrollClass(wrap)) updateStickyScrollClass(wrap);
            });
            ro.observe(wrap);
            wrap._dragScrollObserver = ro;
          } catch (_) {}
        }
      }

      function run() {
        document.querySelectorAll(WRAP_SELECTOR).forEach(function(wrap) { bind(wrap); });
      }

      var resizeTid;
      function refreshAll() {
        document.querySelectorAll(WRAP_SELECTOR).forEach(function(wrap) {
          if (wrap.getAttribute('data-drag-scroll-bound') !== '1') return;
          setDragEnabledClass(wrap);
          if (!shouldSkipStickyScrollClass(wrap)) updateStickyScrollClass(wrap);
        });
      }
      window.addEventListener('resize', function() {
        clearTimeout(resizeTid);
        resizeTid = setTimeout(refreshAll, 80);
      });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
      } else {
        run();
      }
      setTimeout(run, 700);
      setTimeout(run, 1800);
    })();

    (function initTableCardCollapse() {
      var STORAGE_PREFIX = 'kexo:table-collapse:v1';
      var CARD_SELECTOR = '.card';
      var TABLE_CONTENT_SELECTOR = '.table-scroll-wrap, .country-table-wrap, .table-responsive, .grid-table, table';
      var CHART_CONTENT_SELECTOR = '.dash-chart-wrap, [id^="dash-chart-"], #live-online-chart, #sessions-overview-chart, #ads-overview-chart, #attribution-chart, #devices-chart, #products-chart, #countries-map-chart';
      var HEADER_SELECTOR = '.card-header';

      function getPageScope() {
        var page = '';
        try { page = (document.body && document.body.getAttribute('data-page')) || ''; } catch (_) { page = ''; }
        if (page) return String(page).trim().toLowerCase();
        var path = '';
        try { path = (window.location && window.location.pathname) ? String(window.location.pathname) : ''; } catch (_) { path = ''; }
        path = path.replace(/^\/+/, '').trim().toLowerCase();
        return path || 'dashboard';
      }

      function slugify(value) {
        return String(value == null ? '' : value)
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'table-card';
      }

      function getDirectHeader(card) {
        if (!card || !card.querySelector) return null;
        var header = null;
        try { header = card.querySelector(':scope > .card-header'); } catch (_) { header = null; }
        if (header) return header;
        header = card.querySelector(HEADER_SELECTOR);
        if (header) return header;
        header = card.querySelector(':scope .kexo-widget-head');
        return header || null;
      }

      function hasTableContent(card) {
        if (!card || !card.querySelector) return false;
        if (card.querySelector(TABLE_CONTENT_SELECTOR)) return true;
        if (card.querySelector(CHART_CONTENT_SELECTOR)) return true;
        return false;
      }

      function hasChartContent(card) {
        if (!card || !card.querySelector) return false;
        return !!card.querySelector(CHART_CONTENT_SELECTOR);
      }

      function isChartOnlyCard(card) {
        if (!card) return false;
        if (card.dataset && card.dataset.tableId) return false;
        // Product Insights modal Revenue/Demand cards keep collapse chevrons (not gear)
        if (card.dataset && card.dataset.collapseId && String(card.dataset.collapseId).indexOf('product-insights-') === 0) return false;
        var wrap = card.closest ? card.closest('[data-kexo-chart-key]') : null;
        if (wrap) return true;
        return hasChartContent(card) && !card.querySelector(TABLE_CONTENT_SELECTOR);
      }

      function getCollapseId(card, index) {
        if (!card || !card.dataset) return 'table-card-' + String(index || 0);
        if (card.dataset.collapseId) return card.dataset.collapseId;
        var id = '';
        if (card.id) id = String(card.id).trim();
        if (!id) {
          var titleEl = card.querySelector('.card-header .card-title') || card.querySelector('.kexo-widget-title');
          var title = titleEl ? String(titleEl.textContent || '').trim() : '';
          if (title) id = slugify(title) + '-' + String(index || 0);
        }
        if (!id) id = 'table-card-' + String(index || 0);
        card.dataset.collapseId = id;
        return id;
      }

      function getStorageKey(card, index) {
        return STORAGE_PREFIX + ':' + getPageScope() + ':' + getCollapseId(card, index);
      }

      function refreshIconTheme() {
        try {
          window.dispatchEvent(new CustomEvent('kexo:icon-theme-changed'));
          if (window.KexoIconTheme && typeof window.KexoIconTheme.refresh === 'function') window.KexoIconTheme.refresh();
        } catch (_) {}
      }

      function setCollapseChevron(button, collapsed) {
        if (!button || !button.querySelector) return;
        var icon = button.querySelector('.kexo-card-collapse-chevron');
        if (!icon) return;
        var isCollapsed = !!collapsed;
        var glyph = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
        var key = isCollapsed ? 'card-collapse-collapsed' : 'card-collapse-expanded';
        icon.setAttribute('data-icon-key', key);
        icon.className = 'kexo-card-collapse-chevron fa-light ' + glyph;
        refreshIconTheme();
      }

      function setCollapsed(card, button, collapsed, persist, storageKey) {
        if (!card) return;
        var isCollapsed = !!collapsed;
        card.classList.toggle('kexo-card-collapsed', isCollapsed);
        if (button) {
          button.classList.toggle('is-collapsed', isCollapsed);
          button.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
          button.setAttribute('aria-label', isCollapsed ? 'Expand section' : 'Collapse section');
          button.title = isCollapsed ? 'Expand section' : 'Collapse section';
          setCollapseChevron(button, isCollapsed);
        }
        if (persist && storageKey) {
          try { sessionStorage.setItem(storageKey, isCollapsed ? '1' : '0'); } catch (_) {}
        }
      }

      function restoreCollapsed(card, button, storageKey) {
        var raw = null;
        try { raw = sessionStorage.getItem(storageKey); } catch (_) { raw = null; }
        if (raw == null) {
          // Keep any default collapsed state already present in the DOM (useful for
          // dynamically-inserted cards like modals).
          var already = !!(card && card.classList && card.classList.contains('kexo-card-collapsed'));
          setCollapsed(card, button, already, false, storageKey);
          return;
        }
        setCollapsed(card, button, raw === '1', false, storageKey);
      }

      function ensureToggle(card, index) {
        if (!card || card.getAttribute('data-no-card-collapse') === '1') return;
        if (!hasTableContent(card)) return;
        var header = getDirectHeader(card);
        if (!header) return;

        if (card.dataset && card.dataset.tableId) {
          if (header.querySelector('.kexo-builder-icon-link')) return;
          var tableId = String(card.dataset.tableId || '').trim();
          var pageKey = getPageScope();
          var titleEl = card.querySelector('.card-header .card-title') || card.querySelector('.kexo-widget-title');
          var cardTitle = (titleEl && titleEl.textContent) ? String(titleEl.textContent).trim() : tableId;
          var link = document.createElement('button');
          link.type = 'button';
          link.className = 'kexo-builder-icon-link';
          link.title = 'Table settings';
          link.setAttribute('aria-label', 'Table settings');
          link.innerHTML = '<i class="fa-light fa-gear" data-icon-key="table-builder-icon" aria-hidden="true"></i>';
          link.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (tableId === 'ads-root') {
              window.location.href = '/settings?tab=integrations&integrationsTab=googleads';
              return;
            }
            if (typeof window.KexoLayoutShortcuts !== 'undefined' && typeof window.KexoLayoutShortcuts.openTableModal === 'function') {
              window.KexoLayoutShortcuts.openTableModal({ pageKey: pageKey, tableId: tableId, cardTitle: cardTitle });
            }
          });
          var headRight = header.querySelector(':scope > .kexo-widget-head-right');
          if (headRight) {
            headRight.appendChild(link);
          } else {
            var actions = header.querySelector(':scope > .card-actions');
            if (!actions) {
              actions = document.createElement('div');
              actions.className = 'card-actions d-flex align-items-center gap-2 ms-auto';
              header.appendChild(actions);
            }
            actions.appendChild(link);
          }
          return;
        }

        if (isChartOnlyCard(card)) {
          var existingChartLink = header.querySelector('.kexo-builder-icon-link');
          var existingCollapse = header.querySelector('.kexo-card-collapse-toggle');
          if (existingCollapse) existingCollapse.remove();
          if (existingChartLink) return;
          var chartWrap = card.closest ? card.closest('[data-kexo-chart-key]') : null;
          var chartKey = (card.dataset && card.dataset.kexoChartKey) ? String(card.dataset.kexoChartKey).trim().toLowerCase() : (chartWrap && chartWrap.getAttribute('data-kexo-chart-key')) ? String(chartWrap.getAttribute('data-kexo-chart-key')).trim().toLowerCase() : '';
          if (!chartKey) return;
          var chartTitleEl = card.querySelector('.card-header .card-title') || card.querySelector('.kexo-widget-title');
          var chartCardTitle = (chartTitleEl && chartTitleEl.textContent) ? String(chartTitleEl.textContent).trim() : chartKey;
          var chartLink = document.createElement('button');
          chartLink.type = 'button';
          chartLink.className = 'kexo-builder-icon-link';
          chartLink.title = 'Chart settings';
          chartLink.setAttribute('aria-label', 'Chart settings');
          chartLink.setAttribute('data-kexo-chart-settings-key', chartKey);
          chartLink.innerHTML = '<i class="fa-light fa-gear" data-icon-key="chart-builder-icon" aria-hidden="true"></i>';
          chartLink.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            // Back-compat: if delegation doesn't run for any reason, open via unified builder directly.
            if (window.KexoChartSettingsBuilder && typeof window.KexoChartSettingsBuilder.openModal === 'function') {
              window.KexoChartSettingsBuilder.openModal({ chartKey: chartKey, cardTitle: chartCardTitle });
              return;
            }
            if (typeof window.KexoLayoutShortcuts !== 'undefined' && typeof window.KexoLayoutShortcuts.openChartModal === 'function') {
              window.KexoLayoutShortcuts.openChartModal({ chartKey: chartKey, cardTitle: chartCardTitle });
            }
          });
          var chartHeadRight = header.querySelector(':scope > .kexo-widget-head-right');
          if (chartHeadRight) {
            chartHeadRight.appendChild(chartLink);
          } else {
            var chartActions = header.querySelector(':scope > .card-actions');
            if (!chartActions) {
              chartActions = document.createElement('div');
              chartActions.className = 'card-actions d-flex align-items-center gap-2 ms-auto';
              header.appendChild(chartActions);
            }
            chartActions.appendChild(chartLink);
          }
          return;
        }

        var storageKey = getStorageKey(card, index);
        var btn = header.querySelector('.kexo-card-collapse-toggle');
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-icon btn-ghost-secondary kexo-card-collapse-toggle';
          btn.innerHTML = '<i class="kexo-card-collapse-chevron fa-light fa-chevron-down" data-icon-key="card-collapse-expanded" aria-hidden="true"></i>';
          var actions = null;
          try { actions = header.querySelector(':scope > .card-actions'); } catch (_) { actions = null; }
          if (actions && actions.parentElement === header) {
            header.appendChild(btn);
          } else {
            btn.classList.add('ms-auto');
            header.appendChild(btn);
          }
        }
        if (btn.getAttribute('data-collapse-bound') !== '1') {
          btn.setAttribute('data-collapse-bound', '1');
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            var next = !card.classList.contains('kexo-card-collapsed');
            setCollapsed(card, btn, next, true, storageKey);
          });
        }
        restoreCollapsed(card, btn, storageKey);
      }

      function run(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var cards = scope.querySelectorAll(CARD_SELECTOR);
        cards.forEach(function(card, idx) { ensureToggle(card, idx); });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { run(document); });
      } else {
        run(document);
      }

      var gridDocObserver = null;
      function initGridDocObserver() {
        if (gridDocObserver) return;
        try {
          gridDocObserver = new MutationObserver(function(muts) {
            muts.forEach(function(m) {
              (m.addedNodes || []).forEach(function(n) {
                if (!(n instanceof Element)) return;
                run(n);
              });
            });
          });
          gridDocObserver.observe(document.documentElement, { childList: true, subtree: true });
          if (typeof registerCleanup === 'function') {
            registerCleanup(function() {
              try { if (gridDocObserver && typeof gridDocObserver.disconnect === 'function') gridDocObserver.disconnect(); } catch (_) {}
              gridDocObserver = null;
            });
          }
        } catch (_) {}
      }
      try { window.__kexoInitGridDocObserver = initGridDocObserver; } catch (_) {}
      initGridDocObserver();

      try { window.addEventListener('hashchange', function() { setTimeout(function() { run(document); }, 0); }); } catch (_) {}
      setTimeout(function() { run(document); }, 800);
      setTimeout(function() { run(document); }, 1800);
    })();

    (function initTableRowsPerPageControls() {
      var CARD_SELECTOR = '.card[data-table-class][data-table-id]';
