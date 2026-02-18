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
    audit: false,
  };

  function isAuditEnabled() {
    try {
      var s = (window && window.location && window.location.search) ? String(window.location.search) : '';
      return /(?:^|[?&])audit=1(?:&|$)/.test(s) || /(?:^|[?&])audit=true(?:&|$)/.test(s);
    } catch (_) {
      return false;
    }
  }

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
    var auditDebug = payload && payload.audit_debug && typeof payload.audit_debug === 'object' ? payload.audit_debug : null;
    var auditOn = !!auditDebug;

    function buildAuditDetailText(itemKey) {
      var key = itemKey != null ? String(itemKey) : '';
      if (!key || !auditDebug) return '';

      if (key === 'cogs') {
        var lines = (auditDebug.cogs && Array.isArray(auditDebug.cogs.lines)) ? auditDebug.cogs.lines : [];
        if (!lines.length) return 'No COGS lines available.';
        var out = ['variant_id\tqty\tunit_cost\tcurrency\tfx_rate\tline_total_gbp'];
        lines.forEach(function (r) {
          if (!r) return;
          out.push(
            String(r.variant_id || '') + '\t' +
            String(r.qty || 0) + '\t' +
            (r.unit_cost == null ? '—' : Number(r.unit_cost).toFixed(4)) + '\t' +
            String(r.currency || 'GBP') + '\t' +
            (r.fx_rate == null ? '—' : Number(r.fx_rate).toFixed(6)) + '\t' +
            (r.line_total_gbp == null ? '—' : Number(r.line_total_gbp).toFixed(2))
          );
        });
        return out.join('\n');
      }

      if (key === 'google_ads') {
        var days = (auditDebug.ads && Array.isArray(auditDebug.ads.days)) ? auditDebug.ads.days : [];
        if (!days.length) return 'No Google Ads daily rows.';
        var out2 = ['day\tspend_gbp\tclicks\tdaily_total'];
        days.forEach(function (d) {
          if (!d) return;
          out2.push(
            String(d.day || '') + '\t' +
            Number(d.spend_gbp || 0).toFixed(2) + '\t' +
            String(d.clicks || 0) + '\t' +
            Number(d.daily_total || 0).toFixed(2)
          );
        });
        return out2.join('\n');
      }

      if (key === 'transaction_fees' || key === 'shopify_app_bills') {
        var tx = (auditDebug.payment_fees_and_app_bills && Array.isArray(auditDebug.payment_fees_and_app_bills.tx))
          ? auditDebug.payment_fees_and_app_bills.tx
          : [];
        var want = key === 'transaction_fees' ? 'payment_fee' : 'app_bill';
        var filtered = tx.filter(function (r) { return r && String(r.classification || '').indexOf(want) >= 0; });
        if (!filtered.length) return want === 'payment_fee' ? 'No fee transactions in range.' : 'No app bill transactions in range.';
        var out3 = ['tx_id\tprocessed_at\tclassification\tamount_gbp\tfee_gbp\tnet_gbp'];
        filtered.forEach(function (r) {
          out3.push(
            String(r.tx_id || '') + '\t' +
            String(r.processed_at || '') + '\t' +
            String(r.classification || '') + '\t' +
            Number(r.amount_gbp || 0).toFixed(2) + '\t' +
            Number(r.fee_gbp || 0).toFixed(2) + '\t' +
            Number(r.net_gbp || 0).toFixed(2)
          );
        });
        return out3.join('\n');
      }

      if (key === 'tax') {
        var rows = (auditDebug.tax && Array.isArray(auditDebug.tax.rows)) ? auditDebug.tax.rows : [];
        if (!rows.length) return 'No tax rows in range.';
        var out4 = ['order_id\tcreated_at\tcurrency\ttotal_tax\tfx_rate\ttax_gbp'];
        rows.forEach(function (r) {
          if (!r) return;
          out4.push(
            String(r.order_id || '') + '\t' +
            String(r.created_at || '') + '\t' +
            String(r.currency || 'GBP') + '\t' +
            Number(r.total_tax || 0).toFixed(2) + '\t' +
            (r.fx_rate == null ? '—' : Number(r.fx_rate).toFixed(6)) + '\t' +
            Number(r.tax_gbp || 0).toFixed(2)
          );
        });
        return out4.join('\n');
      }

      if (key === 'shipping') {
        var parts = [];
        var def = auditDebug.shipping && auditDebug.shipping.worldwide_default_gbp != null ? Number(auditDebug.shipping.worldwide_default_gbp) : 0;
        parts.push('Worldwide default: £' + def.toFixed(2));
        var ovs = (auditDebug.shipping && Array.isArray(auditDebug.shipping.overrides_enabled)) ? auditDebug.shipping.overrides_enabled : [];
        if (ovs.length) {
          parts.push('Enabled overrides:');
          ovs.forEach(function (o, idx) {
            if (!o) return;
            var cs = Array.isArray(o.countries) ? o.countries.join(', ') : '';
            parts.push('- £' + Number(o.price_gbp || 0).toFixed(2) + ' for ' + (cs || '(no countries)'));
          });
        } else {
          parts.push('Enabled overrides: (none)');
        }
        var per = (auditDebug.shipping && Array.isArray(auditDebug.shipping.per_country)) ? auditDebug.shipping.per_country : [];
        if (per.length) {
          parts.push('');
          parts.push('country\torders\tused_price_gbp\tprice_source\tsubtotal_gbp');
          per.forEach(function (r) {
            if (!r) return;
            parts.push(
              String(r.country || '') + '\t' +
              String(r.orders || 0) + '\t' +
              Number(r.used_price_gbp || 0).toFixed(2) + '\t' +
              String(r.price_source || '') + '\t' +
              Number(r.subtotal_gbp || 0).toFixed(2)
            );
          });
        }
        return parts.join('\n');
      }

      if (key === 'rules') {
        var rr = (auditDebug.rules && Array.isArray(auditDebug.rules.lines)) ? auditDebug.rules.lines : [];
        if (!rr.length) return 'No enabled rules in range.';
        var out5 = ['id\tlabel\tapplies_to\ttype\tvalue\tscoped_revenue_gbp\tscoped_orders\tcomputed_deduction_gbp'];
        rr.forEach(function (r) {
          if (!r) return;
          var scope = (r.applies_to && r.applies_to.join) ? r.applies_to.join(', ') : String(r.applies_to || 'ALL');
          out5.push(
            String(r.id || '') + '\t' +
            String(r.label || '') + '\t' +
            scope + '\t' +
            String(r.type || '') + '\t' +
            Number(r.value || 0).toFixed(2) + '\t' +
            Number(r.scoped_revenue_gbp || 0).toFixed(2) + '\t' +
            String(r.scoped_orders || 0) + '\t' +
            Number(r.computed_deduction_gbp || 0).toFixed(2)
          );
        });
        return out5.join('\n');
      }

      return '';
    }

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
      var isDetail = it.is_detail === true || it.parent_key != null;
      var active = it.active === true;
      var statusLabel = active ? 'Active' : 'Inactive';
      var badgeCls = active ? 'bg-success-lt' : 'bg-secondary-lt';
      var amount = formatAmount(it.amount, it.currency || currency);
      var notes = it.notes != null ? String(it.notes) : '';
      var rowCls = active ? '' : 'text-muted opacity-75';
      if (isDetail) rowCls = (rowCls ? rowCls + ' ' : '') + 'table-light';
      var baseLabel = isDetail ? ('<div class="ps-4">' + esc(label) + '</div>') : esc(label);
      var key = it.key != null ? String(it.key) : '';
      var canDetail = auditOn && !isDetail && key;
      var btn = canDetail
        ? (' <button type="button" class="btn btn-sm btn-outline-secondary py-0 px-2 ms-2" data-cost-breakdown-detail-toggle="' + esc(key) + '" aria-expanded="false">Details</button>')
        : '';
      var labelHtml = baseLabel + btn;
      html += '<tr class="' + rowCls + '">' +
        '<td>' + labelHtml + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + esc(statusLabel) + '</span></td>' +
        '<td class="text-end">' + esc(amount) + '</td>' +
        '<td class="text-muted small">' + esc(notes) + '</td>' +
      '</tr>';

      if (canDetail) {
        var txt = buildAuditDetailText(key);
        if (txt) {
          html += '<tr class="d-none" data-cost-breakdown-detail-row="' + esc(key) + '">' +
            '<td colspan="4">' +
              '<div class="small border rounded bg-light p-2" style="max-height:220px; overflow:auto;">' +
                '<pre class="m-0 small" style="white-space:pre; tab-size:2;">' + esc(txt) + '</pre>' +
              '</div>' +
            '</td>' +
          '</tr>';
        }
      }
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

    var url = API + '/api/cost-breakdown?range=' + encodeURIComponent(state.range || '7d') + (state.audit ? '&audit=1' : '');
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

    // Audit details toggle (event delegation so it works after rerender).
    var tbody = document.getElementById('cost-breakdown-table-body');
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var t = e && e.target ? e.target : null;
        if (!t || !t.getAttribute) return;
        var k = t.getAttribute('data-cost-breakdown-detail-toggle');
        if (!k) return;
        var safeKey = String(k).replace(/"/g, '\\"');
        var row = tbody.querySelector('tr[data-cost-breakdown-detail-row="' + safeKey + '"]');
        if (!row) return;
        var isHidden = row.classList.contains('d-none');
        row.classList.toggle('d-none', !isHidden);
        try { t.setAttribute('aria-expanded', isHidden ? 'true' : 'false'); } catch (_) {}
      });
    }
  }

  // Init
  bindUi();
  setRangeUi(state.range);
  state.audit = isAuditEnabled();
  state.active = panel.classList.contains('active');
  if (state.active) fetchBreakdown();
})();

