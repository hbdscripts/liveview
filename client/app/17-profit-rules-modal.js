/**
 * Dashboard: Profit Rules modal opener (Cost Settings shortcut).
 * Reuses the same modal markup/IDs as Snapshot, but runs only on dashboard pages.
 */
(function () {
  'use strict';

  function bodyPage() {
    try { return String(document.body && document.body.getAttribute('data-page') || ''); } catch (_) { return ''; }
  }
  if (bodyPage() !== 'dashboard') return;

  function esc(str) {
    try {
      var div = document.createElement('div');
      div.textContent = str == null ? '' : String(str);
      return div.innerHTML;
    } catch (_) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  function fetchJson(url, opts) {
    return fetch(url, opts || {})
      .then(function (r) { return (r && r.ok) ? r.json() : null; })
      .catch(function () { return null; });
  }

  var state = {
    open: false,
    backdrop: null,
    rulesDraft: null,
    editingRuleId: '',
  };

  function openModal() {
    var modal = document.getElementById('profit-rules-modal');
    if (!modal) return;
    if (state.open) return;
    state.open = true;
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop fade show';
    backdrop.addEventListener('click', closeModal);
    document.body.appendChild(backdrop);
    state.backdrop = backdrop;
  }

  function closeModal() {
    var modal = document.getElementById('profit-rules-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    if (state.backdrop && state.backdrop.parentNode) {
      state.backdrop.parentNode.removeChild(state.backdrop);
    }
    state.backdrop = null;
    state.open = false;
    document.body.classList.remove('modal-open');
  }

  function createRuleId() {
    return 'rule_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function normalizeCountryCode(value) {
    var raw = String(value || '').trim().toUpperCase().slice(0, 2);
    if (!raw) return '';
    var cc = raw === 'UK' ? 'GB' : raw;
    if (!/^[A-Z]{2}$/.test(cc)) return '';
    return cc;
  }

  function normalizeRulesPayload(payload) {
    var src = payload && typeof payload === 'object' ? payload : {};
    var list = Array.isArray(src.rules) ? src.rules : [];
    var out = {
      enabled: !!src.enabled,
      currency: 'GBP',
      integrations: {
        includeGoogleAdsSpend: !!(src.integrations && src.integrations.includeGoogleAdsSpend === true),
        includeShopifyAppBills: false,
        includePaymentFees: !!(src.integrations && src.integrations.includePaymentFees === true),
        includeKlarnaFees: !!(src.integrations && src.integrations.includeKlarnaFees === true),
        includeShopifyTaxes: !!(src.integrations && src.integrations.includeShopifyTaxes === true),
      },
      rules: [],
    };
    for (var i = 0; i < list.length; i += 1) {
      var row = list[i] && typeof list[i] === 'object' ? list[i] : {};
      var appliesMode = row.appliesTo && row.appliesTo.mode === 'countries' ? 'countries' : 'all';
      var countries = (appliesMode === 'countries' && Array.isArray(row.appliesTo && row.appliesTo.countries))
        ? row.appliesTo.countries.map(normalizeCountryCode).filter(Boolean)
        : [];
      out.rules.push({
        id: row.id ? String(row.id) : createRuleId(),
        name: row.name ? String(row.name) : 'Expense',
        type: row.type ? String(row.type) : 'percent_revenue',
        value: Number.isFinite(Number(row.value)) ? Number(row.value) : 0,
        enabled: row.enabled !== false,
        sort: Number.isFinite(Number(row.sort)) ? Math.trunc(Number(row.sort)) : (i + 1),
        appliesTo: (appliesMode === 'countries' && countries.length)
          ? { mode: 'countries', countries: countries.slice(0, 64) }
          : { mode: 'all', countries: [] },
      });
    }
    out.rules.sort(function (a, b) { return (Number(a.sort) || 0) - (Number(b.sort) || 0); });
    return out;
  }

  function setMessage(text, isOk) {
    var el = document.getElementById('profit-rules-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-hidden', !text);
    el.classList.toggle('text-success', !!isOk);
    el.classList.toggle('text-danger', isOk === false);
  }

  function sortDraft() {
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return;
    state.rulesDraft.rules.sort(function (a, b) {
      var sa = Number(a && a.sort != null ? a.sort : 0) || 0;
      var sb = Number(b && b.sort != null ? b.sort : 0) || 0;
      if (sa !== sb) return sa - sb;
      return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    });
  }

  function reindexDraft() {
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return;
    sortDraft();
    state.rulesDraft.rules.forEach(function (rule, idx) {
      if (!rule) return;
      rule.sort = idx + 1;
    });
  }

  function getRuleById(ruleId) {
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return null;
    return state.rulesDraft.rules.find(function (rule) { return String(rule && rule.id || '') === String(ruleId || ''); }) || null;
  }

  function ruleTypeLabel(type) {
    if (type === 'fixed_per_order') return 'Fixed per order';
    if (type === 'fixed_per_period') return 'Fixed per period';
    return 'Percent of revenue';
  }

  function ruleValueLabel(rule) {
    if (!rule) return '-';
    var value = Number(rule.value);
    if (!Number.isFinite(value)) return '-';
    if (rule.type === 'percent_revenue') return value.toFixed(2).replace(/\.00$/, '') + '%';
    return '\u00a3' + value.toFixed(2);
  }

  function renderRulesList() {
    var bodyEl = document.getElementById('profit-rules-table-body');
    if (!bodyEl) return;
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules) || !state.rulesDraft.rules.length) {
      bodyEl.innerHTML = '<tr><td colspan="6" class="text-muted">No rules yet.</td></tr>';
      return;
    }
    sortDraft();
    var html = '';
    state.rulesDraft.rules.forEach(function (rule, idx) {
      var countryLabel = rule && rule.appliesTo && rule.appliesTo.mode === 'countries'
        ? ((rule.appliesTo.countries || []).join(', ') || '-')
        : 'ALL';
      html += '' +
        '<tr data-rule-id="' + esc(rule.id || '') + '">' +
          '<td>' + esc(rule.name || 'Expense') + '</td>' +
          '<td>' + esc(ruleTypeLabel(rule.type)) + '</td>' +
          '<td class="text-end">' + esc(ruleValueLabel(rule)) + '</td>' +
          '<td class="text-center">' + esc(countryLabel) + '</td>' +
          '<td class="text-center">' +
            '<input type="checkbox" data-pr-action="toggle-enabled" data-rule-id="' + esc(rule.id || '') + '"' + (rule.enabled ? ' checked' : '') + ' />' +
          '</td>' +
          '<td class="text-end text-nowrap">' +
            '<button type="button" class="btn btn-sm btn-ghost-secondary" data-pr-action="move-up" data-rule-id="' + esc(rule.id || '') + '"' + (idx <= 0 ? ' disabled' : '') + '>Up</button> ' +
            '<button type="button" class="btn btn-sm btn-ghost-secondary" data-pr-action="move-down" data-rule-id="' + esc(rule.id || '') + '"' + (idx >= state.rulesDraft.rules.length - 1 ? ' disabled' : '') + '>Down</button> ' +
            '<button type="button" class="btn btn-sm btn-ghost-secondary" data-pr-action="edit" data-rule-id="' + esc(rule.id || '') + '">Edit</button> ' +
            '<button type="button" class="btn btn-sm btn-ghost-danger" data-pr-action="delete" data-rule-id="' + esc(rule.id || '') + '">Delete</button>' +
          '</td>' +
        '</tr>';
    });
    bodyEl.innerHTML = html;
  }

  function hideForm() {
    var panel = document.getElementById('profit-rules-form-wrap');
    if (panel) panel.classList.add('is-hidden');
    state.editingRuleId = '';
    var idEl = document.getElementById('profit-rule-id');
    if (idEl) idEl.value = '';
  }

  function showForm(rule) {
    var panel = document.getElementById('profit-rules-form-wrap');
    if (panel) panel.classList.remove('is-hidden');
    state.editingRuleId = rule ? String(rule.id || '') : '';
    var idEl = document.getElementById('profit-rule-id');
    var nameEl = document.getElementById('profit-rule-name');
    var typeEl = document.getElementById('profit-rule-type');
    var valueEl = document.getElementById('profit-rule-value');
    var countryEl = document.getElementById('profit-rule-country');
    var sortEl = document.getElementById('profit-rule-sort');
    var enabledEl = document.getElementById('profit-rule-enabled');
    if (idEl) idEl.value = state.editingRuleId;
    if (nameEl) nameEl.value = rule ? (rule.name || '') : '';
    if (typeEl) typeEl.value = rule ? (rule.type || 'percent_revenue') : 'percent_revenue';
    if (valueEl) valueEl.value = rule && rule.value != null ? String(Number(rule.value) || 0) : '';
    if (countryEl) countryEl.value = (rule && rule.appliesTo && rule.appliesTo.mode === 'countries')
      ? ((rule.appliesTo.countries || []).join(','))
      : '';
    if (sortEl) sortEl.value = rule && Number.isFinite(Number(rule.sort)) ? String(Math.trunc(Number(rule.sort))) : String((state.rulesDraft && state.rulesDraft.rules ? state.rulesDraft.rules.length + 1 : 1));
    if (enabledEl) enabledEl.checked = rule ? (rule.enabled !== false) : true;
  }

  function readForm() {
    var nameEl = document.getElementById('profit-rule-name');
    var typeEl = document.getElementById('profit-rule-type');
    var valueEl = document.getElementById('profit-rule-value');
    var countryEl = document.getElementById('profit-rule-country');
    var sortEl = document.getElementById('profit-rule-sort');
    var enabledEl = document.getElementById('profit-rule-enabled');
    var name = String(nameEl && nameEl.value || '').trim();
    if (!name) return { ok: false, error: 'Rule name is required.' };
    var type = String(typeEl && typeEl.value || '').trim();
    if (['percent_revenue', 'fixed_per_order', 'fixed_per_period'].indexOf(type) < 0) {
      return { ok: false, error: 'Rule type is invalid.' };
    }
    var value = Number(valueEl && valueEl.value);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Value must be 0 or higher.' };
    var sort = Math.max(1, Math.trunc(Number(sortEl && sortEl.value) || 1));
    var countryRaw = String(countryEl && countryEl.value || '').trim();
    var appliesTo = { mode: 'all', countries: [] };
    if (countryRaw) {
      var countries = countryRaw.split(/[,\s]+/).map(normalizeCountryCode).filter(Boolean);
      if (!countries.length) return { ok: false, error: 'Use valid 2-letter ISO country codes.' };
      var unique = [];
      var seen = {};
      countries.forEach(function (cc) {
        if (!cc || seen[cc]) return;
        seen[cc] = true;
        unique.push(cc);
      });
      appliesTo = { mode: 'countries', countries: unique.slice(0, 64) };
    }
    return {
      ok: true,
      rule: {
        id: state.editingRuleId || createRuleId(),
        name: name.slice(0, 80),
        type: type,
        value: value,
        enabled: enabledEl ? !!enabledEl.checked : true,
        sort: sort,
        appliesTo: appliesTo,
      },
    };
  }

  function saveRuleDraft() {
    var parsed = readForm();
    if (!parsed.ok) {
      setMessage(parsed.error, false);
      return;
    }
    if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) {
      state.rulesDraft = normalizeRulesPayload(null);
    }
    var existing = getRuleById(parsed.rule.id);
    if (existing) {
      existing.name = parsed.rule.name;
      existing.type = parsed.rule.type;
      existing.value = parsed.rule.value;
      existing.enabled = parsed.rule.enabled;
      existing.sort = parsed.rule.sort;
      existing.appliesTo = parsed.rule.appliesTo;
    } else {
      state.rulesDraft.rules.push(parsed.rule);
    }
    reindexDraft();
    renderRulesList();
    hideForm();
    setMessage('Rule saved in draft.', true);
  }

  function setTab(tab) {
    var key = tab === 'integrations' ? 'integrations' : 'rules';
    document.querySelectorAll('[data-pr-tab]').forEach(function (btn) {
      if (!btn || !btn.classList) return;
      var v = String(btn.getAttribute('data-pr-tab') || '');
      btn.classList.toggle('active', v === key);
    });
    var rulesPane = document.getElementById('profit-rules-tab-rules');
    var integrationsPane = document.getElementById('profit-rules-tab-integrations');
    if (rulesPane) rulesPane.classList.toggle('is-hidden', key !== 'rules');
    if (integrationsPane) integrationsPane.classList.toggle('is-hidden', key !== 'integrations');
  }

  function applyDraftToUi() {
    var enabledToggle = document.getElementById('profit-rules-enabled');
    var adsToggle = document.getElementById('profit-rules-include-google-ads');
    var paymentFeesToggle = document.getElementById('profit-rules-include-payment-fees');
    var klarnaFeesToggle = document.getElementById('profit-rules-include-klarna-fees');
    var taxToggle = document.getElementById('profit-rules-include-tax');
    if (enabledToggle) enabledToggle.checked = !!(state.rulesDraft && state.rulesDraft.enabled);
    if (adsToggle) adsToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includeGoogleAdsSpend);
    if (paymentFeesToggle) paymentFeesToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includePaymentFees);
    if (klarnaFeesToggle) klarnaFeesToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includeKlarnaFees);
    if (taxToggle) taxToggle.checked = !!(state.rulesDraft && state.rulesDraft.integrations && state.rulesDraft.integrations.includeShopifyTaxes);
  }

  function readTogglesIntoDraft() {
    if (!state.rulesDraft) state.rulesDraft = normalizeRulesPayload(null);
    var enabledToggle = document.getElementById('profit-rules-enabled');
    var adsToggle = document.getElementById('profit-rules-include-google-ads');
    var paymentFeesToggle = document.getElementById('profit-rules-include-payment-fees');
    var klarnaFeesToggle = document.getElementById('profit-rules-include-klarna-fees');
    var taxToggle = document.getElementById('profit-rules-include-tax');
    state.rulesDraft.enabled = enabledToggle ? !!enabledToggle.checked : !!state.rulesDraft.enabled;
    if (!state.rulesDraft.integrations || typeof state.rulesDraft.integrations !== 'object') {
      state.rulesDraft.integrations = { includeGoogleAdsSpend: false, includeShopifyAppBills: false, includePaymentFees: false, includeKlarnaFees: false, includeShopifyTaxes: false };
    }
    state.rulesDraft.integrations.includeGoogleAdsSpend = adsToggle ? !!adsToggle.checked : !!state.rulesDraft.integrations.includeGoogleAdsSpend;
    state.rulesDraft.integrations.includeShopifyAppBills = false;
    state.rulesDraft.integrations.includePaymentFees = paymentFeesToggle ? !!paymentFeesToggle.checked : !!state.rulesDraft.integrations.includePaymentFees;
    state.rulesDraft.integrations.includeKlarnaFees = klarnaFeesToggle ? !!klarnaFeesToggle.checked : !!state.rulesDraft.integrations.includeKlarnaFees;
    state.rulesDraft.integrations.includeShopifyTaxes = taxToggle ? !!taxToggle.checked : !!state.rulesDraft.integrations.includeShopifyTaxes;
  }

  function loadRules(force) {
    var url = (typeof API !== 'undefined' ? API : '') + '/api/settings/profit-rules';
    if (force) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + '_=' + Date.now();
    }
    return fetchJson(url).then(function (payload) {
      state.rulesDraft = normalizeRulesPayload(payload && payload.profitRules ? payload.profitRules : null);
      applyDraftToUi();
      renderRulesList();
      hideForm();
      return state.rulesDraft;
    });
  }

  function saveRules() {
    readTogglesIntoDraft();
    reindexDraft();
    setMessage('Saving...', true);
    var url = (typeof API !== 'undefined' ? API : '') + '/api/settings/profit-rules';
    return fetchJson(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profitRules: state.rulesDraft }),
      credentials: 'same-origin',
    }).then(function (payload) {
      state.rulesDraft = normalizeRulesPayload(payload && payload.profitRules ? payload.profitRules : state.rulesDraft);
      applyDraftToUi();
      renderRulesList();
      hideForm();
      setMessage('Profit rules saved.', true);
      try { window.dispatchEvent(new CustomEvent('kexo:profitRulesUpdated')); } catch (_) {}
      return payload;
    }).catch(function () {
      setMessage('Failed to save profit rules.', false);
      return null;
    });
  }

  function bind() {
    var modal = document.getElementById('profit-rules-modal');
    if (!modal) return;

    var openBtn = document.getElementById('dash-cost-settings-btn');
    if (openBtn && openBtn.getAttribute('data-kexo-profit-bound') !== '1') {
      openBtn.setAttribute('data-kexo-profit-bound', '1');
      openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        try {
          var url = '/settings?tab=cost-expenses&costExpensesTab=rules';
          if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') window.location.assign(url);
          else window.location.href = url;
        } catch (_) {}
      });
    }

    var chartBtn = document.querySelector('[data-kexo-chart-settings-key="dash-chart-overview-30d"]');
    if (chartBtn && chartBtn.getAttribute('data-kexo-chart-settings-bound') !== '1') {
      chartBtn.setAttribute('data-kexo-chart-settings-bound', '1');
      chartBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (window.KexoLayoutShortcuts && typeof window.KexoLayoutShortcuts.openChartModal === 'function') {
            window.KexoLayoutShortcuts.openChartModal({ chartKey: 'dash-chart-overview-30d', cardTitle: 'Overview' });
          }
        } catch (_) {}
      });
    }

    var closeBtn = document.getElementById('profit-rules-close-btn');
    var dismissBtn = document.getElementById('profit-rules-dismiss-btn');
    var saveBtn = document.getElementById('profit-rules-save-btn');
    var addBtn = document.getElementById('profit-rules-add-btn');
    var formSaveBtn = document.getElementById('profit-rule-save-btn');
    var formCancelBtn = document.getElementById('profit-rule-cancel-btn');
    var tableBody = document.getElementById('profit-rules-table-body');

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (dismissBtn) dismissBtn.addEventListener('click', closeModal);
    if (saveBtn) saveBtn.addEventListener('click', saveRules);
    if (addBtn) addBtn.addEventListener('click', function () { showForm(null); });
    if (formSaveBtn) formSaveBtn.addEventListener('click', saveRuleDraft);
    if (formCancelBtn) formCancelBtn.addEventListener('click', hideForm);

    document.querySelectorAll('[data-pr-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = String(btn.getAttribute('data-pr-tab') || '');
        setTab(tab);
      });
    });

    if (tableBody) {
      tableBody.addEventListener('click', function (event) {
        var target = event && event.target ? event.target : null;
        if (!target || !target.getAttribute) return;
        var action = String(target.getAttribute('data-pr-action') || '');
        var ruleId = String(target.getAttribute('data-rule-id') || '');
        if (!action || !ruleId) return;
        if (!state.rulesDraft || !Array.isArray(state.rulesDraft.rules)) return;
        if (action === 'edit') {
          showForm(getRuleById(ruleId));
          return;
        }
        if (action === 'delete') {
          state.rulesDraft.rules = state.rulesDraft.rules.filter(function (rule) { return String(rule && rule.id || '') !== ruleId; });
          reindexDraft();
          renderRulesList();
          hideForm();
          return;
        }
        if (action === 'move-up' || action === 'move-down') {
          sortDraft();
          var idx = state.rulesDraft.rules.findIndex(function (rule) { return String(rule && rule.id || '') === ruleId; });
          if (idx < 0) return;
          var swapWith = action === 'move-up' ? idx - 1 : idx + 1;
          if (swapWith < 0 || swapWith >= state.rulesDraft.rules.length) return;
          var tmp = state.rulesDraft.rules[idx];
          state.rulesDraft.rules[idx] = state.rulesDraft.rules[swapWith];
          state.rulesDraft.rules[swapWith] = tmp;
          reindexDraft();
          renderRulesList();
        }
      });
      tableBody.addEventListener('change', function (event) {
        var target = event && event.target ? event.target : null;
        if (!target || !target.getAttribute) return;
        var action = String(target.getAttribute('data-pr-action') || '');
        if (action !== 'toggle-enabled') return;
        var ruleId = String(target.getAttribute('data-rule-id') || '');
        var rule = getRuleById(ruleId);
        if (!rule) return;
        rule.enabled = !!target.checked;
      });
    }

    document.addEventListener('keydown', function (event) {
      if (!state.open) return;
      var key = String(event && (event.key || event.code) || '');
      if (key === 'Escape') closeModal();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

