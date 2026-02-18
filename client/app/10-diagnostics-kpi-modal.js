      const refreshBtn = document.getElementById('config-refresh-btn');
      const reconcileBtn = document.getElementById('config-reconcile-btn');
      const rangeSel = document.getElementById('diagnostics-overview-range');
      if (rangeSel) rangeSel.addEventListener('change', function() {
        setDiagnosticsActionMsg('Loading overview\u2026', true);
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      });
      if (refreshBtn) refreshBtn.addEventListener('click', function() {
        setDiagnosticsActionMsg('Refreshing diagnostics\u2026', true);
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      });
      if (reconcileBtn) reconcileBtn.addEventListener('click', function() { try { reconcileSalesTruth({}); } catch (_) {} });
      if (openBtn && openBtn.tagName === 'A') {
        try { openBtn.setAttribute('href', '/settings'); } catch (_) {}
      }
    })();

    (function initKpiCompareModal() {
      const modal = document.getElementById('kpi-compare-modal');
      const refreshBtn = document.getElementById('kpi-compare-refresh-btn');
      const closeBtn = document.getElementById('kpi-compare-close-btn');
      const kickerEl = document.getElementById('kpi-compare-kicker');
      if (!modal) return;

      function kickerForKey(key) {
        const k = key ? String(key).trim().toLowerCase() : '';
        if (k === 'sessions') return 'Sessions';
        if (k === 'aov') return 'AOV';
        return 'Conversion rate';
      }

      function open(key) {
        activeKpiCompareKey = key ? String(key).trim().toLowerCase() : 'conv';
        if (kickerEl) kickerEl.textContent = kickerForKey(activeKpiCompareKey);
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      }
      function close() { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }

      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('.kpi-compare-open-btn[data-kpi-compare]') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const key = (btn.getAttribute('data-kpi-compare') || '').trim().toLowerCase();
        open(key || 'conv');
      });

      if (refreshBtn) refreshBtn.addEventListener('click', function() { try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {} });
      if (closeBtn) closeBtn.addEventListener('click', close);
      modal.addEventListener('click', function(e) { if (e.target === modal) close(); });
      document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (!modal.classList.contains('open')) return;
        close();
      });
    })();

    (function initEdgeBlocksModal() {
      const BTN_SEL = '.kexo-edge-blocks-open-btn';
      const MODAL_ID = 'edge-blocks-modal';
      const RANGE_ID = 'edge-blocks-range-select';
      const REFRESH_ID = 'edge-blocks-refresh-btn';

      let modalEl = null;
      let modalApi = null;
      let abort = null;
      let activeRange = '24h';
      let activeReason = '';
      let activeCountry = '';
      let activeAsn = '';
      let activeQ = '';

      function isAdmin() {
        try {
          if (typeof window.__kexoGetEffectiveViewer === 'function') {
            const v = window.__kexoGetEffectiveViewer();
            return !!(v && v.isAdmin);
          }
        } catch (_) {}
        try { return !!window.__kexoEffectiveIsAdmin || !!window.__kexoIsMasterUser; } catch (_) { return false; }
      }

      function enableButtons() {
        try {
          const ok = isAdmin();
          const list = document.querySelectorAll ? document.querySelectorAll(BTN_SEL) : [];
          (list || []).forEach(function(btn) {
            if (!btn) return;
            try { btn.disabled = !ok; } catch (_) {}
            try { btn.setAttribute('aria-disabled', ok ? 'false' : 'true'); } catch (_) {}
            try { btn.title = ok ? 'Open edge blocks' : 'Admin only'; } catch (_) {}
          });
        } catch (_) {}
      }

      function safeJson(url, signal) {
        return fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: signal }).then(function(r) { return r.json(); });
      }

      function esc(v) { try { return escapeHtml(String(v == null ? '' : v)); } catch (_) { return ''; } }

      function formatWhen(ts) {
        const n = ts != null ? Number(ts) : NaN;
        if (!Number.isFinite(n)) return '\u2014';
        try { if (typeof formatTs === 'function') return formatTs(n); } catch (_) {}
        try { return new Date(n).toLocaleString('en-GB'); } catch (_) { return String(n); }
      }

      function normaliseRange(v) {
        const k = v ? String(v).trim().toLowerCase() : '';
        return k === '7d' ? '7d' : '24h';
      }

      function sinceForRange(rangeKey) {
        const now = Date.now();
        return rangeKey === '7d' ? (now - 7 * 24 * 60 * 60 * 1000) : (now - 24 * 60 * 60 * 1000);
      }

      function cleanupInflight() {
        try { if (abort) abort.abort(); } catch (_) {}
        abort = null;
      }

      function ensureModal() {
        if (modalEl) return;
        modalEl = document.getElementById(MODAL_ID);
        if (!modalEl) {
          modalEl = document.createElement('div');
          modalEl.id = MODAL_ID;
          modalEl.className = 'modal modal-blur fade';
          modalEl.tabIndex = -1;
          modalEl.setAttribute('aria-hidden', 'true');
          modalEl.innerHTML =
            '<div class="modal-dialog modal-xl modal-dialog-centered" role="dialog">' +
              '<div class="modal-content">' +
                '<div class="modal-header">' +
                  '<div class="d-flex align-items-center gap-3">' +
                    '<h5 class="modal-title mb-0">Edge blocks</h5>' +
                    '<select class="form-select form-select-sm" id="' + esc(RANGE_ID) + '" aria-label="Range">' +
                      '<option value="24h">24h</option>' +
                      '<option value="7d">7d</option>' +
                    '</select>' +
                  '</div>' +
                  '<div class="d-flex align-items-center gap-2">' +
                    '<button type="button" class="btn btn-icon btn-ghost-secondary" id="' + esc(REFRESH_ID) + '" aria-label="Refresh edge blocks" title="Refresh">' +
                      '<i class="fa-light fa-rotate-right" aria-hidden="true"></i>' +
                      '<span>Refresh</span>' +
                    '</button>' +
                    '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
                  '</div>' +
                '</div>' +
                '<div class="modal-body">' +
                  '<div class="text-secondary small mb-2" id="edge-blocks-updated">\u2014</div>' +
                  '<div class="row g-3 mb-3" id="edge-blocks-cards">' +
                    '<div class="col-12 col-md-4"><div class="card card-sm"><div class="card-body"><div class="text-secondary">Total blocked</div><div class="h1 mb-0" id="edge-blocks-total">\u2014</div></div></div></div>' +
                    '<div class="col-12 col-md-4"><div class="card card-sm"><div class="card-body"><div class="text-secondary">Bots dropped</div><div class="h1 mb-0" id="edge-blocks-bots">\u2014</div></div></div></div>' +
                    '<div class="col-12 col-md-4"><div class="card card-sm"><div class="card-body"><div class="text-secondary">Junk dropped</div><div class="h1 mb-0" id="edge-blocks-junk">\u2014</div></div></div></div>' +
                  '</div>' +
                  '<ul class="nav nav-tabs" role="tablist">' +
                    '<li class="nav-item" role="presentation"><button class="nav-link active" data-bs-toggle="tab" data-bs-target="#edge-blocks-summary-tab" type="button" role="tab">Summary</button></li>' +
                    '<li class="nav-item" role="presentation"><button class="nav-link" data-bs-toggle="tab" data-bs-target="#edge-blocks-events-tab" type="button" role="tab">Recent events</button></li>' +
                  '</ul>' +
                  '<div class="tab-content pt-3">' +
                    '<div class="tab-pane fade show active" id="edge-blocks-summary-tab" role="tabpanel">' +
                      '<div class="row g-3">' +
                        '<div class="col-12 col-lg-6"><div class="card"><div class="card-header"><h3 class="card-title">By reason</h3></div><div class="table-responsive"><table class="table table-sm table-vcenter card-table"><thead><tr><th>Reason</th><th class="text-end">Count</th></tr></thead><tbody id="edge-blocks-by-reason"></tbody></table></div></div></div>' +
                        '<div class="col-12 col-lg-6"><div class="card"><div class="card-header"><h3 class="card-title">By country</h3></div><div class="table-responsive"><table class="table table-sm table-vcenter card-table"><thead><tr><th>Country</th><th class="text-end">Count</th></tr></thead><tbody id="edge-blocks-by-country"></tbody></table></div></div></div>' +
                        '<div class="col-12 col-lg-6"><div class="card"><div class="card-header"><h3 class="card-title">By ASN</h3></div><div class="table-responsive"><table class="table table-sm table-vcenter card-table"><thead><tr><th>ASN</th><th class="text-end">Count</th></tr></thead><tbody id="edge-blocks-by-asn"></tbody></table></div></div></div>' +
                        '<div class="col-12 col-lg-6"><div class="card"><div class="card-header"><h3 class="card-title">By verified bot category</h3></div><div class="table-responsive"><table class="table table-sm table-vcenter card-table"><thead><tr><th>Category</th><th class="text-end">Count</th></tr></thead><tbody id="edge-blocks-by-botcat"></tbody></table></div></div></div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="tab-pane fade" id="edge-blocks-events-tab" role="tabpanel">' +
                      '<div class="row g-2 align-items-end mb-2">' +
                        '<div class="col-12 col-md-3"><label class="form-label">Reason</label><input class="form-control" id="edge-blocks-filter-reason" placeholder="e.g. bot" /></div>' +
                        '<div class="col-12 col-md-2"><label class="form-label">Country</label><input class="form-control" id="edge-blocks-filter-country" placeholder="GB" /></div>' +
                        '<div class="col-12 col-md-2"><label class="form-label">ASN</label><input class="form-control" id="edge-blocks-filter-asn" placeholder="e.g. 12345" /></div>' +
                        '<div class="col-12 col-md-5"><label class="form-label">Search</label><input class="form-control" id="edge-blocks-filter-q" placeholder="UA, origin, referer, path\u2026" /></div>' +
                      '</div>' +
                      '<div class="table-responsive">' +
                        '<table class="table table-sm table-vcenter">' +
                          '<thead><tr><th>Time</th><th>Reason</th><th>Result</th><th>Country</th><th>ASN</th><th>UA</th><th>Origin</th><th>Ray</th></tr></thead>' +
                          '<tbody id="edge-blocks-events-body"></tbody>' +
                        '</table>' +
                      '</div>' +
                      '<div class="text-secondary small mt-2" id="edge-blocks-events-meta">\u2014</div>' +
                    '</div>' +
                  '</div>' +
                '</div>' +
                '<div class="modal-footer">' +
                  '<button type="button" class="btn btn-primary" data-bs-dismiss="modal">Close</button>' +
                '</div>' +
              '</div>' +
            '</div>';
          document.body.appendChild(modalEl);
        }

        try {
          if (window.bootstrap && window.bootstrap.Modal) {
            modalApi = window.bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: true, keyboard: true, focus: true });
            modalEl.addEventListener('hidden.bs.modal', function() { cleanupInflight(); });
          }
        } catch (_) {}

        const rangeSel = document.getElementById(RANGE_ID);
        if (rangeSel) {
          rangeSel.addEventListener('change', function() {
            activeRange = normaliseRange(rangeSel.value);
            refresh();
          });
        }
        const refreshBtn = document.getElementById(REFRESH_ID);
        if (refreshBtn) refreshBtn.addEventListener('click', function() { refresh(); });

        function bindInput(id, apply) {
          const el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('input', function() { apply(el.value); });
        }
        bindInput('edge-blocks-filter-reason', function(v) { activeReason = (v || '').trim(); });
        bindInput('edge-blocks-filter-country', function(v) { activeCountry = (v || '').trim(); });
        bindInput('edge-blocks-filter-asn', function(v) { activeAsn = (v || '').trim(); });
        bindInput('edge-blocks-filter-q', function(v) { activeQ = (v || '').trim(); });
        ['edge-blocks-filter-reason', 'edge-blocks-filter-country', 'edge-blocks-filter-asn', 'edge-blocks-filter-q'].forEach(function(id) {
          const el = document.getElementById(id);
          if (!el) return;
          el.addEventListener('keydown', function(e) { if (e && e.key === 'Enter') refresh(); });
        });
      }

      function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
      }

      function renderCounts(tbodyId, rows, keyName) {
        const body = document.getElementById(tbodyId);
        if (!body) return;
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) {
          body.innerHTML = '<tr><td class="text-secondary" colspan="2">\u2014</td></tr>';
          return;
        }
        body.innerHTML = list.slice(0, 50).map(function(r) {
          const k = r && r[keyName] != null ? String(r[keyName]) : '';
          const n = r && r.count != null ? Number(r.count) : 0;
          return '<tr><td>' + esc(k) + '</td><td class="text-end">' + esc((Number.isFinite(n) ? n : 0)) + '</td></tr>';
        }).join('');
      }

      function renderEvents(rows) {
        const body = document.getElementById('edge-blocks-events-body');
        if (!body) return;
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) {
          body.innerHTML = '<tr><td class="text-secondary" colspan="8">\u2014</td></tr>';
          return;
        }
        body.innerHTML = list.slice(0, 200).map(function(r) {
          const ua = r && r.ua != null ? String(r.ua) : '';
          const origin = r && r.origin != null ? String(r.origin) : '';
          return (
            '<tr>' +
              '<td class="text-secondary">' + esc(formatWhen(r.created_at)) + '</td>' +
              '<td>' + esc(r.blocked_reason || '') + '</td>' +
              '<td class="text-secondary">' + esc(r.edge_result || '') + '</td>' +
              '<td>' + esc(r.country || '') + '</td>' +
              '<td class="text-secondary">' + esc(r.asn || '') + '</td>' +
              '<td class="text-secondary" title="' + esc(ua) + '">' + esc(ua.length > 38 ? (ua.slice(0, 38) + '\u2026') : ua) + '</td>' +
              '<td class="text-secondary" title="' + esc(origin) + '">' + esc(origin.length > 28 ? (origin.slice(0, 28) + '\u2026') : origin) + '</td>' +
              '<td class="text-secondary">' + esc(r.ray_id || '') + '</td>' +
            '</tr>'
          );
        }).join('');
      }

      function setLoading() {
        setText('edge-blocks-updated', 'Loading\u2026');
        setText('edge-blocks-total', '\u2014');
        setText('edge-blocks-bots', '\u2014');
        setText('edge-blocks-junk', '\u2014');
        renderCounts('edge-blocks-by-reason', [], 'blocked_reason');
        renderCounts('edge-blocks-by-country', [], 'country');
        renderCounts('edge-blocks-by-asn', [], 'asn');
        renderCounts('edge-blocks-by-botcat', [], 'verified_bot_category');
        renderEvents([]);
        setText('edge-blocks-events-meta', '\u2014');
      }

      function refresh() {
        if (!modalEl) return;
        cleanupInflight();
        abort = new AbortController();
        const signal = abort.signal;
        const rk = normaliseRange(activeRange);
        const since = sinceForRange(rk);
        const summaryUrl = API + '/api/edge-blocked/summary?range=' + encodeURIComponent(rk);
        let eventsUrl = API + '/api/edge-blocked/events?limit=200&since=' + encodeURIComponent(String(since));
        if (activeReason) eventsUrl += '&blocked_reason=' + encodeURIComponent(activeReason);
        if (activeCountry) eventsUrl += '&country=' + encodeURIComponent(activeCountry);
        if (activeAsn) eventsUrl += '&asn=' + encodeURIComponent(activeAsn);
        if (activeQ) eventsUrl += '&q=' + encodeURIComponent(activeQ);

        setLoading();
        Promise.all([safeJson(summaryUrl, signal), safeJson(eventsUrl, signal)])
          .then(function(parts) {
            const summary = parts && parts[0] ? parts[0] : null;
            const events = parts && parts[1] ? parts[1] : null;
            if (!summary || summary.ok !== true) throw new Error('Failed to load summary');
            if (!events || events.ok !== true) throw new Error('Failed to load events');

            const t = summary.totals || {};
            setText('edge-blocks-total', t.blocked != null ? String(t.blocked) : '\u2014');
            setText('edge-blocks-bots', t.bots != null ? String(t.bots) : '\u2014');
            setText('edge-blocks-junk', t.junk != null ? String(t.junk) : '\u2014');
            setText('edge-blocks-updated', 'Updated ' + formatWhen(Date.now()) + ' \u00b7 Range ' + rk);

            renderCounts('edge-blocks-by-reason', summary.by_reason, 'blocked_reason');
            renderCounts('edge-blocks-by-country', summary.by_country, 'country');
            renderCounts('edge-blocks-by-asn', summary.by_asn, 'asn');
            renderCounts('edge-blocks-by-botcat', summary.by_verified_bot_category, 'verified_bot_category');

            renderEvents(events.events || []);
            setText('edge-blocks-events-meta', 'Showing ' + String((events.events || []).length) + ' events since ' + formatWhen(events.since));
          })
          .catch(function(err) {
            if (signal && signal.aborted) return;
            setText('edge-blocks-updated', 'Failed to load edge blocks: ' + (err && err.message ? String(err.message) : 'error'));
          });
      }

      function open(rangeKey) {
        ensureModal();
        enableButtons();
        if (!isAdmin()) return;
        activeRange = normaliseRange(rangeKey);
        const rangeSel = document.getElementById(RANGE_ID);
        if (rangeSel) rangeSel.value = activeRange;
        try { if (modalApi && typeof modalApi.show === 'function') modalApi.show(); } catch (_) {}
        refresh();
      }

      document.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest(BTN_SEL) : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        const rk = btn.getAttribute('data-edge-blocks-range') || '24h';
        open(rk);
      });

      try { window.addEventListener('kexo:viewer-changed', function() { enableButtons(); }); } catch (_) {}
      enableButtons();
    })();

    (function initTrafficTypeTree() {
      const body = document.getElementById('traffic-types-body');
