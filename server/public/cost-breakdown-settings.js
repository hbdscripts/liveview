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
    range: 'today',
    controller: null,
    reqId: 0,
    active: false,
    audit: false,
    hideInactive: true,
    lastPayload: null,
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
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function syncHideInactiveTileClass() {
    if (!panel || !panel.classList) return;
    panel.classList.toggle('settings-cost-breakdown-hide-inactive-tile', state.hideInactive === true);
  }

  function setMsg(text, tone) {
    var el = document.getElementById('cost-breakdown-msg');
    if (!el) return;
    el.classList.remove('text-success', 'text-danger', 'text-muted');
    if (tone === 'err') {
      el.classList.add('text-danger');
      el.innerHTML = (text || 'Failed to load') + ' <button type="button" class="btn btn-sm" data-cost-breakdown-retry>Retry</button>';
      return;
    }
    if (tone === 'ok') el.classList.add('text-success');
    else if (tone === 'muted') el.classList.add('text-muted');
    el.textContent = text || '';
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

    var itemsAll = payload && Array.isArray(payload.items) ? payload.items : [];
    var items = itemsAll;
    if (state.hideInactive === true) {
      items = itemsAll.filter(function (it) { return !!(it && it.active === true); });
    }
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
    var childrenByParent = {};
    var maxAmountLen = 0;
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var pk = it.parent_key != null ? String(it.parent_key) : '';
      if (!pk) return;
      childrenByParent[pk] = true;
    });
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var amt = formatAmount(it.amount, it.currency || currency);
      var s = amt != null ? String(amt) : '';
      if (s && s.length > maxAmountLen) maxAmountLen = s.length;
    });
    // Keep the width tight so child arrows don't drift left.
    var clampedLen = Math.max(6, Math.min(16, Number(maxAmountLen) || 0));
    try {
      for (var i = 6; i <= 16; i++) tbody.classList.remove('settings-cost-breakdown-amount-ch-' + i);
      tbody.classList.add('settings-cost-breakdown-amount-ch-' + clampedLen);
    } catch (_) {}
    items.forEach(function (it) {
      if (!it || typeof it !== 'object') return;
      var label = it.label != null ? String(it.label) : '';
      var isDetail = it.is_detail === true || it.parent_key != null;
      var active = it.active === true;
      var statusLabel = active ? 'Active' : 'Inactive';
      var badgeCls = active ? 'bg-success-lt' : 'bg-secondary-lt';
      var amount = formatAmount(it.amount, it.currency || currency);
      var amountText = esc(amount);
      var amountHtml = isDetail
        ? (
          '<span class="settings-cost-breakdown-amount-text settings-cost-breakdown-amount-text-child">' +
            '<i class="fa-thin fa-arrow-turn-down-right settings-cost-breakdown-child-icon" aria-hidden="true"></i>' +
            amountText +
          '</span>'
        )
        : ('<span class="settings-cost-breakdown-amount-text">' + amountText + '</span>');
      var notes = it.notes != null ? String(it.notes) : '';
      var notesTrim = notes.replace(/\s+/g, ' ').trim();
      var notesHtml = isDetail
        ? (notesTrim
          ? ('<div class="settings-cost-breakdown-notes-help"><span class="am-tooltip-cue" aria-label="Notes" title="' + escAttr(notesTrim) + '"></span></div>')
          : '')
        : esc(notes);
      var rowCls = active ? '' : 'text-muted opacity-75';
      if (isDetail) rowCls = (rowCls ? rowCls + ' ' : '') + 'table-light d-none';
      rowCls = (rowCls ? rowCls + ' ' : '') + (isDetail ? 'settings-cost-breakdown-row-detail' : 'settings-cost-breakdown-row-parent');
      var key = it.key != null ? String(it.key) : '';
      var parentKey = it.parent_key != null ? String(it.parent_key) : '';
      var hasChildren = !isDetail && key && childrenByParent[key] === true;
      var toggleBtn = hasChildren
        ? (
          '<button type="button" class="settings-cost-breakdown-children-toggle" data-cost-breakdown-children-toggle="' + esc(key) + '" aria-expanded="false" aria-label="Toggle breakdown">' +
            '<i class="fa-thin fa-chevron-right" aria-hidden="true"></i>' +
          '</button>'
        )
        : '';
      var baseLabel = isDetail
        ? ('<div class="ps-4 settings-cost-breakdown-child-label">' + esc(label) + '</div>')
        : (hasChildren
          ? ('<span class="settings-cost-breakdown-parent-label">' + toggleBtn + '<span>' + esc(label) + '</span></span>')
          : esc(label));
      var hasCustomDetails = !!(it.details && Array.isArray(it.details) && it.details.length && key);
      var auditTxt = (auditOn && !isDetail && key) ? buildAuditDetailText(key) : '';
      var canAuditDetail = !!auditTxt;
      var btn = hasCustomDetails
        ? (' <button type="button" class="btn btn-sm btn-ghost-secondary py-0 px-1 ms-2 settings-cost-breakdown-detail-btn" data-cost-breakdown-detail-toggle="' + esc(key) + '" aria-expanded="false">View details</button>')
        : (canAuditDetail
          ? (' <button type="button" class="btn btn-sm btn-ghost-secondary py-0 px-1 ms-2 settings-cost-breakdown-detail-btn" data-cost-breakdown-detail-toggle="' + esc(key) + '" aria-expanded="false">Details</button>')
          : '');
      var labelHtml = isDetail ? (baseLabel.replace('</div>', btn + '</div>')) : (baseLabel + btn);
      html += '<tr class="' + rowCls + '"' + (isDetail && parentKey ? (' data-cost-breakdown-parent="' + esc(parentKey) + '"') : '') + '>' +
        '<td>' + labelHtml + '</td>' +
        '<td><span class="badge ' + badgeCls + '">' + esc(statusLabel) + '</span></td>' +
        '<td class="text-end">' + amountHtml + '</td>' +
        '<td class="text-muted small">' + notesHtml + '</td>' +
      '</tr>';

      if (hasCustomDetails) {
        var rows = Array.isArray(it.details) ? it.details : [];
        var inner = '';
        inner += '<div class="ps-4 settings-cost-breakdown-detail-inner">';
        inner += '<div class="small fw-semibold mb-1">Contributing rules</div>';
        inner += '<div class="table-responsive">';
        inner += '<table class="table table-sm table-borderless table-vcenter mb-0 settings-cost-breakdown-detail-table">';
        inner += '<thead><tr><th>Rule</th><th>Country</th><th>Dates</th><th>Value</th></tr></thead><tbody>';
        rows.slice(0, 50).forEach(function (r) {
          if (!r || typeof r !== 'object') return;
          inner += '<tr>' +
            '<td>' + esc(r.name != null ? String(r.name) : '') + '</td>' +
            '<td>' + esc(r.country != null ? String(r.country) : '') + '</td>' +
            '<td>' + esc(r.dates != null ? String(r.dates) : '') + '</td>' +
            '<td>' + esc(r.value != null ? String(r.value) : '') + '</td>' +
          '</tr>';
        });
        inner += '</tbody></table></div></div>';

        html += '<tr class="d-none" data-cost-breakdown-detail-row="' + esc(key) + '">' +
          '<td colspan="4" class="border-0 bg-transparent pt-0">' + inner + '</td>' +
        '</tr>';
      } else if (canAuditDetail) {
        if (auditTxt) {
          html += '<tr class="d-none" data-cost-breakdown-detail-row="' + esc(key) + '">' +
            '<td colspan="4" class="border-0 bg-transparent pt-0">' +
              '<div class="ps-4 settings-cost-breakdown-detail-inner">' +
                '<pre class="m-0 small settings-cost-breakdown-audit-pre">' + esc(auditTxt) + '</pre>' +
              '</div>' +
            '</td>' +
          '</tr>';
        }
      }
    });

    tbody.innerHTML = html || '<tr><td colspan="4" class="text-muted small">No items returned.</td></tr>';
    try {
      if (typeof window.migrateTitleToHelpPopover === 'function') window.migrateTitleToHelpPopover(tbody);
      if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(tbody);
    } catch (_) {}
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

    var url = API + '/api/cost-breakdown?range=' + encodeURIComponent(state.range || 'today') + (state.audit ? '&audit=1' : '');
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
      state.lastPayload = payload;
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

    var hideInactiveToggle = document.getElementById('cost-breakdown-hide-inactive');
    if (hideInactiveToggle) {
      state.hideInactive = hideInactiveToggle.checked === true;
      hideInactiveToggle.addEventListener('change', function () {
        state.hideInactive = hideInactiveToggle.checked === true;
        syncHideInactiveTileClass();
        if (state.lastPayload) render(state.lastPayload);
      });
    }

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

    panel.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-cost-breakdown-retry') !== null) {
        fetchBreakdown();
      }
    });

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
        if (!t) return;

        // Child rows toggle (collapse/expand)
        var toggleBtn = (t.closest && t.closest('[data-cost-breakdown-children-toggle]')) ? t.closest('[data-cost-breakdown-children-toggle]') : null;
        if (toggleBtn && toggleBtn.getAttribute) {
          var pk = toggleBtn.getAttribute('data-cost-breakdown-children-toggle');
          if (pk) {
            var safeParent = String(pk).replace(/"/g, '\\"');
            var rows = tbody.querySelectorAll('tr[data-cost-breakdown-parent="' + safeParent + '"]');
            if (rows && rows.length) {
              var anyHidden = false;
              try { anyHidden = rows[0].classList.contains('d-none'); } catch (_) { anyHidden = false; }
              rows.forEach(function (r) {
                if (!r || !r.classList) return;
                r.classList.toggle('d-none', !anyHidden);
              });
              try { toggleBtn.setAttribute('aria-expanded', anyHidden ? 'true' : 'false'); } catch (_) {}
            }
          }
          return;
        }

        // Audit details toggle
        var detailBtn = (t.closest && t.closest('[data-cost-breakdown-detail-toggle]')) ? t.closest('[data-cost-breakdown-detail-toggle]') : null;
        if (!detailBtn || !detailBtn.getAttribute) return;
        var k = detailBtn.getAttribute('data-cost-breakdown-detail-toggle');
        if (!k) return;
        var safeKey = String(k).replace(/"/g, '\\"');
        var row = tbody.querySelector('tr[data-cost-breakdown-detail-row="' + safeKey + '"]');
        if (!row) return;
        var isHidden = row.classList.contains('d-none');
        row.classList.toggle('d-none', !isHidden);
        try { detailBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false'); } catch (_) {}
      });
    }
  }

  // Init
  bindUi();
  syncHideInactiveTileClass();
  setRangeUi(state.range);
  state.audit = isAuditEnabled();
  state.active = panel.classList.contains('active');
  if (state.active) fetchBreakdown();
})();

