/**
 * Cost & Expenses settings – master-only panel.
 * Loads/saves profit rules (GET/PUT /api/settings/profit-rules).
 * Shipping tab (worldwide + overrides), Rules tab (profit rules table + form).
 */
(function () {
  'use strict';

  if (window.__kexoCostExpensesInit) return;
  var root = document.getElementById('settings-panel-cost-expenses');
  if (!root) return;
  window.__kexoCostExpensesInit = true;

  var API = (typeof window !== 'undefined' && window.API) ? String(window.API || '') : '';
  var state = {
    config: null,
    editingRuleId: '',
    uiBound: false,
    loadInFlight: null,
  };

  function fetchJson(url, opts) {
    opts = opts || {};
    return fetch(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body,
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (r) {
      if (opts.raw) return r;
      var ct = r.headers.get('content-type') || '';
      if (ct.indexOf('application/json') !== -1) return r.json();
      return r.text().then(function (t) { throw new Error(t || r.status); });
    });
  }

  function esc(s) {
    if (s == null) return '';
    var str = String(s);
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function normalizeCountryCode(v) {
    var raw = (v == null ? '' : String(v).trim()).toUpperCase().slice(0, 2);
    if (!raw) return '';
    return raw === 'UK' ? 'GB' : raw;
  }

  function defaultConfig() {
    return {
      enabled: false,
      currency: 'GBP',
      integrations: {
        includeGoogleAdsSpend: false,
        includeShopifyAppBills: false,
        includePaymentFees: false,
        includeKlarnaFees: false,
      },
      rules: [],
      shipping: { enabled: false, worldwideDefaultGbp: 0, overrides: [] },
    };
  }

  function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') return defaultConfig();
    var c = defaultConfig();
    c.enabled = raw.enabled === true;
    if (typeof raw.currency === 'string') c.currency = raw.currency;
    if (raw.integrations && typeof raw.integrations === 'object') {
      c.integrations = {
        includeGoogleAdsSpend: raw.integrations.includeGoogleAdsSpend === true,
        includeShopifyAppBills: raw.integrations.includeShopifyAppBills === true,
        includePaymentFees: raw.integrations.includePaymentFees === true,
        includeKlarnaFees: raw.integrations.includeKlarnaFees === true,
      };
    }
    if (Array.isArray(raw.rules)) {
      c.rules = raw.rules.slice(0, 200).map(function (r, i) {
        var rule = r && typeof r === 'object' ? r : {};
        return {
          id: (rule.id && String(rule.id).trim()) || 'rule_' + (i + 1),
          name: (rule.name && String(rule.name).trim()) || 'Expense',
          type: ['percent_revenue', 'fixed_per_order', 'fixed_per_period'].indexOf(rule.type) !== -1 ? rule.type : 'percent_revenue',
          value: Math.max(0, Number(rule.value) || 0),
          enabled: rule.enabled !== false,
          sort: Math.max(1, Math.trunc(Number(rule.sort) || (i + 1))),
          appliesTo: (rule.appliesTo && rule.appliesTo.mode === 'countries' && Array.isArray(rule.appliesTo.countries))
            ? { mode: 'countries', countries: rule.appliesTo.countries.slice(0, 64) }
            : { mode: 'all', countries: [] },
        };
      });
      c.rules.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    }
    if (raw.shipping && typeof raw.shipping === 'object') {
      c.shipping = {
        enabled: raw.shipping.enabled === true,
        worldwideDefaultGbp: Math.max(0, Number(raw.shipping.worldwideDefaultGbp) || 0),
        overrides: (Array.isArray(raw.shipping.overrides) ? raw.shipping.overrides : []).slice(0, 64).map(function (o, i) {
          var ov = o && typeof o === 'object' ? o : {};
          var countries = Array.isArray(ov.countries) ? ov.countries : [];
          var seen = {};
          var codes = [];
          for (var j = 0; j < countries.length && codes.length < 64; j++) {
            var code = normalizeCountryCode(countries[j]);
            if (code && !seen[code]) { seen[code] = true; codes.push(code); }
          }
          return {
            priority: Math.max(1, Math.trunc(Number(ov.priority) || (i + 1))),
            enabled: ov.enabled !== false,
            priceGbp: Math.max(0, Number(ov.priceGbp) || 0),
            countries: codes,
          };
        }),
      };
      c.shipping.overrides.sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    }
    return c;
  }

  function setMsg(text, ok) {
    var el = document.getElementById('cost-expenses-msg');
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('text-success', 'text-danger');
    if (ok === true) el.classList.add('text-success');
    if (ok === false) el.classList.add('text-danger');
  }

  function syncExcludedHints() {
    var shippingToggle = document.getElementById('cost-expenses-shipping-enabled');
    var rulesToggle = document.getElementById('cost-expenses-rules-enabled');
    var shippingHint = document.getElementById('cost-expenses-shipping-excluded-hint');
    var rulesHint = document.getElementById('cost-expenses-rules-excluded-hint');

    var shippingIncluded = !!(shippingToggle && shippingToggle.checked === true);
    var rulesIncluded = !!(rulesToggle && rulesToggle.checked === true);

    if (shippingHint) shippingHint.classList.toggle('is-hidden', !shippingToggle || shippingIncluded);
    if (rulesHint) rulesHint.classList.toggle('is-hidden', !rulesToggle || rulesIncluded);
  }

  function renderShippingOverrides() {
    var wrap = document.getElementById('cost-expenses-shipping-overrides-wrap');
    var dupWarn = document.getElementById('cost-expenses-shipping-dup-warn');
    if (!wrap) return;
    var overrides = (state.config && state.config.shipping && state.config.shipping.overrides) ? state.config.shipping.overrides : [];
    var countryToFirst = {};
    var dupCountries = [];
    overrides.forEach(function (ov, idx) {
      (ov.countries || []).forEach(function (cc) {
        if (!countryToFirst[cc]) countryToFirst[cc] = idx + 1;
        else if (dupCountries.indexOf(cc) === -1) dupCountries.push(cc);
      });
    });
    if (dupWarn) {
      if (dupCountries.length) {
        dupWarn.textContent = 'Duplicate country in overrides (first match wins): ' + dupCountries.join(', ');
        dupWarn.classList.remove('is-hidden');
      } else {
        dupWarn.textContent = '';
        dupWarn.classList.add('is-hidden');
      }
    }
    var html = '';
    overrides.forEach(function (ov, idx) {
      var countriesStr = (ov.countries || []).join(', ');
      html += '<tr data-override-idx="' + idx + '">' +
        '<td>' +
          '<input type="number" class="form-control form-control-sm kexo-ce-override-priority" min="1" value="' + (ov.priority || idx + 1) + '" data-override-priority placeholder="1" aria-label="Priority" />' +
        '</td>' +
        '<td class="text-center">' +
          '<label class="form-check form-switch mb-0 d-inline-flex align-items-center justify-content-center" aria-label="Override enabled">' +
            '<input type="checkbox" class="form-check-input" data-override-enabled ' + (ov.enabled !== false ? 'checked' : '') + ' />' +
          '</label>' +
        '</td>' +
        '<td>' +
          '<input type="number" class="form-control form-control-sm kexo-ce-override-price" min="0" step="0.01" value="' + (ov.priceGbp != null ? ov.priceGbp : 0) + '" data-override-price placeholder="e.g. 4.99" aria-label="Price (GBP)" />' +
        '</td>' +
        '<td>' +
          '<input type="text" class="form-control form-control-sm kexo-ce-override-countries" value="' + esc(countriesStr) + '" data-override-countries placeholder="e.g. GB, IE, FR" title="Comma-separated ISO2 country codes" aria-label="Countries" />' +
        '</td>' +
        '<td class="text-end">' +
          '<button type="button" class="btn btn-sm btn-ghost-danger" data-override-remove>Remove</button>' +
        '</td>' +
        '</tr>';
    });
    wrap.innerHTML = html || '<tr><td colspan="5" class="text-muted small">No overrides yet.</td></tr>';
  }

  function readShippingFromUi() {
    var overrides = [];
    var rows = root.querySelectorAll('[data-override-idx]');
    rows.forEach(function (row) {
      var pri = parseInt(row.querySelector('[data-override-priority]').value, 10) || 1;
      var en = row.querySelector('[data-override-enabled]').checked;
      var price = parseFloat(row.querySelector('[data-override-price]').value, 10) || 0;
      var raw = (row.querySelector('[data-override-countries]').value || '').trim();
      var codes = raw.split(/[\s,]+/).map(normalizeCountryCode).filter(Boolean);
      var seen = {};
      var countries = [];
      codes.forEach(function (c) { if (!seen[c]) { seen[c] = true; countries.push(c); } });
      overrides.push({ priority: pri, enabled: en, priceGbp: price, countries: countries });
    });
    overrides.sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    var worldwide = parseFloat(document.getElementById('cost-expenses-shipping-worldwide').value, 10) || 0;
    var enabled = document.getElementById('cost-expenses-shipping-enabled').checked === true;
    return { enabled: enabled, worldwideDefaultGbp: Math.max(0, worldwide), overrides: overrides };
  }

  function ruleTypeLabel(type) {
    if (type === 'fixed_per_order') return 'Fixed per order';
    if (type === 'fixed_per_period') return 'Fixed per period';
    return 'Percent of revenue';
  }

  function ruleValueLabel(rule) {
    if (!rule) return '—';
    var v = Number(rule.value);
    if (!Number.isFinite(v)) return '—';
    if (rule.type === 'percent_revenue') return v.toFixed(2).replace(/\.00$/, '') + '%';
    return '£' + v.toFixed(2);
  }

  function renderRulesTable() {
    var tbody = document.getElementById('cost-expenses-rules-table-body');
    if (!tbody) return;
    var rules = (state.config && state.config.rules) ? state.config.rules : [];
    if (!rules.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No rules yet.</td></tr>';
      return;
    }
    var html = '';
    rules.forEach(function (rule, idx) {
      var countryLabel = (rule.appliesTo && rule.appliesTo.mode === 'countries' && rule.appliesTo.countries && rule.appliesTo.countries.length)
        ? rule.appliesTo.countries.join(', ')
        : 'ALL';
      html += '<tr data-rule-id="' + esc(rule.id) + '">' +
        '<td>' + esc(rule.name || 'Expense') + '</td>' +
        '<td>' + esc(ruleTypeLabel(rule.type)) + '</td>' +
        '<td class="text-end">' + esc(ruleValueLabel(rule)) + '</td>' +
        '<td class="text-center">' + esc(countryLabel) + '</td>' +
        '<td class="text-center"><input type="checkbox" data-rule-enabled data-rule-id="' + esc(rule.id) + '" ' + (rule.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
        '<button type="button" class="btn btn-sm btn-ghost-secondary" data-rule-edit data-rule-id="' + esc(rule.id) + '">Edit</button> ' +
        '<button type="button" class="btn btn-sm btn-ghost-danger" data-rule-delete data-rule-id="' + esc(rule.id) + '">Delete</button>' +
        '</td></tr>';
    });
    tbody.innerHTML = html;
  }

  function applyConfigToInputs() {
    if (!state.config) return;
    var cfg = state.config;
    var googleAds = document.getElementById('cost-expenses-google-ads');
    var paymentFees = document.getElementById('cost-expenses-payment-fees');
    var appBills = document.getElementById('cost-expenses-app-bills');
    var rulesEnabledEl = document.getElementById('cost-expenses-rules-enabled');
    if (googleAds) googleAds.checked = !!(cfg.integrations && cfg.integrations.includeGoogleAdsSpend);
    if (paymentFees) paymentFees.checked = !!(cfg.integrations && cfg.integrations.includePaymentFees);
    if (appBills) appBills.checked = !!(cfg.integrations && cfg.integrations.includeShopifyAppBills);
    if (rulesEnabledEl) rulesEnabledEl.checked = cfg.enabled === true;

    var worldwideEl = document.getElementById('cost-expenses-shipping-worldwide');
    var shippingEnabledEl = document.getElementById('cost-expenses-shipping-enabled');
    if (worldwideEl) worldwideEl.value = (cfg.shipping && cfg.shipping.worldwideDefaultGbp != null) ? cfg.shipping.worldwideDefaultGbp : 0;
    if (shippingEnabledEl) shippingEnabledEl.checked = !!(cfg.shipping && cfg.shipping.enabled);
    syncExcludedHints();
  }

  function setActiveSubTab(sub, opts) {
    var s = String(sub || '').trim().toLowerCase();
    if (s !== 'cost-sources' && s !== 'shipping' && s !== 'rules' && s !== 'breakdown') return;
    var o = opts && typeof opts === 'object' ? opts : {};
    document.querySelectorAll('[data-settings-cost-expenses-tab]').forEach(function (btn) {
      var btnSub = String(btn.getAttribute('data-settings-cost-expenses-tab') || '').trim().toLowerCase();
      var isActive = btnSub === s;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.settings-cost-expenses-panel').forEach(function (panel) {
      var controlId = panel.getAttribute('aria-labelledby');
      var control = controlId ? document.getElementById(controlId) : null;
      var panelSub = control && control.getAttribute('data-settings-cost-expenses-tab');
      panel.classList.toggle('active', String(panelSub || '').trim().toLowerCase() === s);
    });
    if (o.updateUrl) {
      var params = new URLSearchParams(window.location.search || '');
      params.set('costExpensesTab', s);
      if (params.get('tab') !== 'cost-expenses') params.set('tab', 'cost-expenses');
      var next = window.location.pathname + '?' + params.toString() + (window.location.hash || '');
      try { window.history.replaceState(null, '', next); } catch (_) {}
    }
    try {
      if (window && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('kexo:costExpensesTabChanged', { detail: { key: s } }));
      }
    } catch (_) {}
  }

  function getRuleById(id) {
    var rules = (state.config && state.config.rules) ? state.config.rules : [];
    for (var i = 0; i < rules.length; i++) {
      if (String(rules[i].id) === String(id)) return rules[i];
    }
    return null;
  }

  function showRuleForm(rule) {
    state.editingRuleId = rule ? rule.id : '';
    var wrap = document.getElementById('cost-expenses-rules-form-wrap');
    if (wrap) wrap.classList.remove('is-hidden');
    document.getElementById('cost-expenses-rule-id').value = state.editingRuleId;
    document.getElementById('cost-expenses-rule-name').value = rule ? (rule.name || '') : '';
    document.getElementById('cost-expenses-rule-type').value = rule ? (rule.type || 'percent_revenue') : 'percent_revenue';
    document.getElementById('cost-expenses-rule-value').value = rule && rule.value != null ? rule.value : '';
    document.getElementById('cost-expenses-rule-country').value = (rule && rule.appliesTo && rule.appliesTo.mode === 'countries' && rule.appliesTo.countries)
      ? rule.appliesTo.countries.join(',')
      : '';
    document.getElementById('cost-expenses-rule-sort').value = rule && rule.sort != null ? rule.sort : (state.config.rules.length + 1);
    document.getElementById('cost-expenses-rule-enabled').checked = rule ? (rule.enabled !== false) : true;
  }

  function hideRuleForm() {
    state.editingRuleId = '';
    var wrap = document.getElementById('cost-expenses-rules-form-wrap');
    if (wrap) wrap.classList.add('is-hidden');
  }

  function readRuleForm() {
    var name = (document.getElementById('cost-expenses-rule-name').value || '').trim();
    if (!name) return { ok: false, error: 'Name required' };
    var type = document.getElementById('cost-expenses-rule-type').value || 'percent_revenue';
    var value = parseFloat(document.getElementById('cost-expenses-rule-value').value, 10);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Value must be ≥ 0' };
    var sort = Math.max(1, parseInt(document.getElementById('cost-expenses-rule-sort').value, 10) || 1);
    var countryRaw = (document.getElementById('cost-expenses-rule-country').value || '').trim();
    var appliesTo = { mode: 'all', countries: [] };
    if (countryRaw) {
      var codes = countryRaw.split(/[\s,]+/).map(normalizeCountryCode).filter(Boolean);
      if (codes.length) appliesTo = { mode: 'countries', countries: codes.slice(0, 64) };
    }
    var id = state.editingRuleId || ('rule_' + Date.now());
    return {
      ok: true,
      rule: {
        id: id,
        name: name.slice(0, 80),
        type: type,
        value: value,
        enabled: document.getElementById('cost-expenses-rule-enabled').checked,
        sort: sort,
        appliesTo: appliesTo,
      },
    };
  }

  function saveRuleFromForm() {
    var parsed = readRuleForm();
    if (!parsed.ok) {
      var msgEl = document.getElementById('cost-expenses-rules-msg');
      if (msgEl) { msgEl.textContent = parsed.error; msgEl.classList.remove('is-hidden'); }
      return;
    }
    if (!state.config.rules) state.config.rules = [];
    var idx = state.config.rules.findIndex(function (r) { return String(r.id) === String(parsed.rule.id); });
    if (idx !== -1) state.config.rules[idx] = parsed.rule;
    else state.config.rules.push(parsed.rule);
    state.config.rules.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    renderRulesTable();
    hideRuleForm();
    var msgEl = document.getElementById('cost-expenses-rules-msg');
    if (msgEl) { msgEl.textContent = 'Rule saved in draft.'; msgEl.classList.remove('is-hidden'); }
  }

  function bindUi() {
    if (state.uiBound) return;
    state.uiBound = true;

    var saveBtn = document.getElementById('cost-expenses-save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        state.config = state.config || defaultConfig();
        state.config.integrations.includeGoogleAdsSpend = document.getElementById('cost-expenses-google-ads').checked;
        state.config.integrations.includePaymentFees = document.getElementById('cost-expenses-payment-fees').checked;
        state.config.integrations.includeShopifyAppBills = document.getElementById('cost-expenses-app-bills').checked;
        state.config.enabled = document.getElementById('cost-expenses-rules-enabled').checked;
        state.config.shipping = readShippingFromUi();
        setMsg('Saving...', true);
        fetchJson(API + '/api/settings/profit-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profitRules: state.config }),
        }).then(function (payload) {
          state.config = normalizeConfig(payload && payload.profitRules);
          setMsg('Saved.', true);
          renderShippingOverrides();
          renderRulesTable();
          syncExcludedHints();
        }).catch(function () {
          setMsg('Failed to save.', false);
        });
      });
    }

    var addOverrideBtn = document.getElementById('cost-expenses-shipping-add-override');
    if (addOverrideBtn) addOverrideBtn.addEventListener('click', function () {
      state.config = state.config || defaultConfig();
      if (!state.config.shipping) state.config.shipping = { enabled: false, worldwideDefaultGbp: 0, overrides: [] };
      if (!state.config.shipping.overrides) state.config.shipping.overrides = [];
      state.config.shipping.overrides.push({
        priority: state.config.shipping.overrides.length + 1,
        enabled: true,
        priceGbp: 0,
        countries: [],
      });
      renderShippingOverrides();
    });

    root.addEventListener('change', function (e) {
      var target = e.target;
      if (target && (target.id === 'cost-expenses-shipping-enabled' || target.id === 'cost-expenses-rules-enabled')) {
        syncExcludedHints();
      }
      if (target && (target.getAttribute('data-override-priority') !== null || target.getAttribute('data-override-enabled') !== null || target.getAttribute('data-override-price') !== null || target.getAttribute('data-override-countries') !== null)) {
        state.config = state.config || defaultConfig();
        state.config.shipping = readShippingFromUi();
        renderShippingOverrides();
      }
    });
    root.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-override-remove') !== null) {
        var row = t.closest('[data-override-idx]');
        if (row) {
          state.config = state.config || defaultConfig();
          var sh = readShippingFromUi();
          var idx = parseInt(row.getAttribute('data-override-idx'), 10);
          if (Number.isFinite(idx) && idx >= 0 && idx < (sh.overrides || []).length) {
            sh.overrides.splice(idx, 1);
          }
          state.config.shipping = sh;
          renderShippingOverrides();
        }
      }
      if (t.getAttribute('data-rule-edit') !== null) {
        var id = t.getAttribute('data-rule-id');
        showRuleForm(getRuleById(id));
      }
      if (t.getAttribute('data-rule-delete') !== null) {
        var id = t.getAttribute('data-rule-id');
        state.config.rules = state.config.rules.filter(function (r) { return String(r.id) !== String(id); });
        renderRulesTable();
        hideRuleForm();
      }
      if (t.getAttribute('data-rule-enabled') !== null) {
        var id = t.getAttribute('data-rule-id');
        var rule = getRuleById(id);
        if (rule) rule.enabled = t.checked;
      }
    });

    var addRuleBtn = document.getElementById('cost-expenses-rules-add-btn');
    var saveRuleBtn = document.getElementById('cost-expenses-rule-save-btn');
    var cancelRuleBtn = document.getElementById('cost-expenses-rule-cancel-btn');
    if (addRuleBtn) addRuleBtn.addEventListener('click', function () { showRuleForm(null); });
    if (saveRuleBtn) saveRuleBtn.addEventListener('click', saveRuleFromForm);
    if (cancelRuleBtn) cancelRuleBtn.addEventListener('click', hideRuleForm);

    document.querySelectorAll('[data-settings-cost-expenses-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sub = (btn.getAttribute('data-settings-cost-expenses-tab') || '').trim().toLowerCase();
        if (sub !== 'cost-sources' && sub !== 'shipping' && sub !== 'rules' && sub !== 'breakdown') return;
        setActiveSubTab(sub, { updateUrl: true });
      });
    });

    // Apply initial sub-tab from URL for direct loads / cached settings-page.
    try {
      var params = new URLSearchParams(window.location.search || '');
      var initial = String(params.get('costExpensesTab') || '').trim().toLowerCase();
      if (initial === 'cost-sources' || initial === 'shipping' || initial === 'rules' || initial === 'breakdown') setActiveSubTab(initial, { updateUrl: false });
      else setActiveSubTab('cost-sources', { updateUrl: false });
    } catch (_) {}
  }

  function load() {
    if (state.loadInFlight) return state.loadInFlight;
    state.loadInFlight = fetchJson(API + '/api/settings/profit-rules').then(function (configPayload) {
      state.config = normalizeConfig(configPayload && configPayload.profitRules);
      applyConfigToInputs();
      renderShippingOverrides();
      renderRulesTable();
      bindUi();
      try {
        if (typeof window.initKexoTooltips === 'function') window.initKexoTooltips(root);
      } catch (_) {}
    }).catch(function () {
      setMsg('Failed to load.', false);
      state.config = defaultConfig();
      applyConfigToInputs();
      renderShippingOverrides();
      renderRulesTable();
      bindUi();
    }).finally(function () {
      state.loadInFlight = null;
    });
    return state.loadInFlight;
  }

  window.initCostExpensesSettings = function () {
    load();
  };
  try { window.__kexoCostExpensesSetActiveSubTab = setActiveSubTab; } catch (_) {}

  // Always bind the UI once so buttons/tabs work even if Settings init is cached/broken.
  try { bindUi(); } catch (_) {}

  // Fail-safe: direct loads to /settings?tab=cost-expenses should initialize even if script order changes.
  try {
    var params = new URLSearchParams(window.location.search || '');
    var tab = String(params.get('tab') || '').trim().toLowerCase();
    if (tab === 'cost-expenses') {
      try { window.initCostExpensesSettings(); } catch (_) {}
      var sub = String(params.get('costExpensesTab') || '').trim().toLowerCase();
      if (sub === 'shipping' || sub === 'rules' || sub === 'breakdown') setActiveSubTab(sub, { updateUrl: false });
    }
  } catch (_) {}
})();
