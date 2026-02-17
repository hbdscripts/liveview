      const refreshBtn = document.getElementById('config-refresh-btn');
      const reconcileBtn = document.getElementById('config-reconcile-btn');
      const rangeSel = document.getElementById('diagnostics-overview-range');
      if (rangeSel) rangeSel.addEventListener('change', function() {
        setDiagnosticsActionMsg('Loading overview???', true);
        try { refreshConfigStatus({ force: true, preserveView: true }); } catch (_) {}
      });
      if (refreshBtn) refreshBtn.addEventListener('click', function() {
        setDiagnosticsActionMsg('Refreshing diagnostics???', true);
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

    (function initTrafficTypeTree() {
      const body = document.getElementById('traffic-types-body');
