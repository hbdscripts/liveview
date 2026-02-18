/**
 * Settings → Costs & profit → Cost Breakdown tab.
 * Fetches /api/cost-breakdown?range=today|yesterday|7d|30d and renders active/inactive totals.
 */
(function () {
  'use strict';

  if (window.__kexoCostBreakdownInit) return;
  var panel = document.getElementById('settings-cost-expenses-panel-breakdown');
  if (!panel) return;
  window.__kexoCostBreakdownInit = true;

  var API = (typeof window !== 'undefined' && window.API) ? String(window.API || '') : '';

  var state = {
    uiBound: false,
    range: '7d',
    controller: null,
    reqId: 0,
    active: false,
  };

  function esc(s) {
    if (s == null) return '';
    var str = String(s);
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setMsg(text, tone) {
    var el = document.getElementById('cost-breakdown-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('text-success', 'text-danger', 'text-muted');
    if (tone === 'ok') el.classList.add('text-success');
    else if (tone === 'err') el.classList.add('text-danger');
    else if (tone === 'muted') el.classList.add('text-muted');
  }

  function formatAmount(amount, currency) {
    var n = Number(amount);
    var cur = currency != null ? String(currency).toUpperCase() : 'GBP';
    if (!Number.isFinite(n)) return '—';
    if (cur === 'GBP') {
      try {
        if (typeof window.formatRevenue === 'function') return window.formatRevenue(n) || ('£' + n.toFixed(2));
      } catch (_) {}
      return '£' + n.toFixed(2);
    }
    return n.toFixed(2) + ' ' + cur;
  }

  function setRangeUi(nextRange) {
    state.range = nextRange;
    panel.querySelectorAll('[data-cost-breakdown-range]').forEach(function (btn) {
      var r = String(btn.getAttribute('data-cost-breakdown-range') || '').trim().toLowerCase();
      var isActive = r === nextRange;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function abortInFlight() {
    try { if (state.controller) state.controller.abort(); } catch (_) {}
    state.controller = null;
  }

  function render(payload) {
    var tbody = document.getElementById('cost-breakdown-table-body');
    var totalActiveEl = document.getElementById('cost-breakdown-total-active');
    var totalInactiveEl = document.getElementById('cost-breakdown-total-inactive');
    if (!tbody) return;

    var items = payload && Array.isArray(payload.items) ? payload.items : [];
    var totals = payload && payload.totals && typeof payload.totals === 'object' ? payload.totals : {};
    var currency = totals && totals.currency ? String(totals.currency) : 'GBP';

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted small">No items returned.</td></tr>';
      if (totalActiveEl) totalActiveEl.textContent = '—';
      if (totalInactiveEl) totalInactiveEl.textContent = '—';
      return;
    }

    var html = '';
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var label = it.label != null ? String(it.label) : '';
      var active = it.active === true;
      var statusLabel = active ? 'Active' : 'Inactive';
      var badgeCls = active ? 'bg-success-lt' : 'bg-secondary-lt';
      var amount = formatAmount(it.amount, it.currency || currency);
      var notes = it.notes != null ? String(it.notes) : '';
      var rowCls = active ? '' : 'text-muted opacity-75';
      html += '<tr class="' + rowCls + '">' +
        '<td>' + esc(label) + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + esc(statusLabel) + '</span></td>' +
        '<td class="text-end">' + esc(amount) + '</td>' +
        '<td class="text-muted small">' + esc(notes) + '</td>' +
      '</tr>';
    });

    tbody.innerHTML = html || '<tr><td colspan="4" class="text-muted small">No items returned.</td></tr>';
    if (totalActiveEl) totalActiveEl.textContent = formatAmount(totals.active_total, currency);
    if (totalInactiveEl) totalInactiveEl.textContent = formatAmount(totals.inactive_total, currency);
  }

  function fetchBreakdown() {
    if (!state.active) return;
    abortInFlight();
    var ctrl = null;
    try { ctrl = new AbortController(); } catch (_) { ctrl = null; }
    state.controller = ctrl;
    state.reqId += 1;
    var myId = state.reqId;
    setMsg('Loading…', 'muted');

    var url = API + '/api/cost-breakdown?range=' + encodeURIComponent(state.range || '7d');
    return fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('application/json') === -1) return r.text().then(function (t) { throw new Error(t || r.status); });
      return r.json();
    }).then(function (payload) {
      if (myId !== state.reqId) return;
      if (!payload || payload.ok !== true) throw new Error('bad_payload');
      setMsg('', 'muted');
      render(payload);
    }).catch(function (err) {
      if (myId !== state.reqId) return;
      if (err && (err.name === 'AbortError' || String(err.message || '').toLowerCase() === 'aborted')) return;
      setMsg('Failed to load breakdown.', 'err');
    }).finally(function () {
      if (myId === state.reqId) state.controller = null;
    });
  }

  function bindUi() {
    if (state.uiBound) return;
    state.uiBound = true;

    var group = document.getElementById('cost-breakdown-range-group');
    if (group) {
      group.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.getAttribute) return;
        var r = String(t.getAttribute('data-cost-breakdown-range') || '').trim().toLowerCase();
        if (!r) return;
        if (r !== 'today' && r !== 'yesterday' && r !== '7d' && r !== '30d') return;
        if (r === state.range) return;
        setRangeUi(r);
        fetchBreakdown();
      });
    }

    window.addEventListener('kexo:costExpensesTabChanged', function (e) {
      var key = e && e.detail && e.detail.key != null ? String(e.detail.key).trim().toLowerCase() : '';
      state.active = key === 'breakdown';
      if (!state.active) {
        abortInFlight();
        return;
      }
      fetchBreakdown();
    });
  }

  // Init
  bindUi();
  setRangeUi(state.range);
  state.active = panel.classList.contains('active');
  if (state.active) fetchBreakdown();
})();

