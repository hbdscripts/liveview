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
    editingPerOrderId: '',
    editingOverheadId: '',
    editingFixedCostId: '',
    uiBound: false,
    loadInFlight: null,
    previewRange: '7d',
    previewReqId: 0,
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
      if (ct.indexOf('application/json') !== -1) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var msg =
              (j && (j.message || j.error)) ? String(j.message || j.error) :
              (r.status ? ('HTTP ' + String(r.status)) : 'Request failed');
            var err = new Error(msg);
            err.status = r.status;
            err.body = j;
            throw err;
          }
          return j;
        });
      }
      return r.text().then(function (t) {
        if (!r.ok) throw new Error(t || r.status);
        return t;
      });
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

  function ymdTodayLocal() {
    try { return new Date().toLocaleDateString('en-CA'); } catch (_) {}
    try { return new Date().toISOString().slice(0, 10); } catch (_) {}
    return '';
  }

  function defaultCostExpensesModel() {
    return { rule_mode: 'stack', per_order_rules: [], overheads: [], fixed_costs: [] };
  }

  function normalizeFixedCost(raw, idx) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var id = (r.id && String(r.id).trim()) || ('fc_' + String(idx + 1));
    var name = (r.name && String(r.name).trim()) || 'Fixed cost';
    return {
      id: id.slice(0, 64),
      name: name.slice(0, 80),
      amount_per_day: Math.max(0, Number(r.amount_per_day) || 0),
      enabled: r.enabled !== false,
    };
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
        includeShopifyTaxes: false,
      },
      cost_expenses: defaultCostExpensesModel(),
      rules: [], // legacy (kept for backwards compatibility)
      shipping: { enabled: false, worldwideDefaultGbp: 0, overrides: [] },
    };
  }

  function normalizeYmd(value, fallback) {
    var raw = value == null ? '' : String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return fallback == null ? '' : String(fallback);
  }

  function normalizeAppliesTo(raw) {
    var r = raw && typeof raw === 'object' ? raw : {};
    if (r.mode === 'countries' && Array.isArray(r.countries)) {
      var seen = {};
      var countries = [];
      for (var i = 0; i < r.countries.length && countries.length < 64; i++) {
        var code = normalizeCountryCode(r.countries[i]);
        if (code && !seen[code]) { seen[code] = true; countries.push(code); }
      }
      if (countries.length) return { mode: 'countries', countries: countries };
    }
    return { mode: 'all', countries: [] };
  }

  function normalizePerOrderRule(rawRule, idx, defaults) {
    var raw = rawRule && typeof rawRule === 'object' ? rawRule : {};
    var d = defaults && typeof defaults === 'object' ? defaults : {};
    var id = (raw.id && String(raw.id).trim()) || (d.id && String(d.id).trim()) || ('por_' + String(idx + 1));
    var name = (raw.name && String(raw.name).trim()) || (d.name && String(d.name).trim()) || 'Expense';
    var type = (raw.type && String(raw.type).trim()) || (d.type && String(d.type).trim()) || 'percent_revenue';
    if (['percent_revenue', 'fixed_per_order', 'fixed_per_item'].indexOf(type) === -1) type = 'percent_revenue';
    var revenueBasis = (raw.revenue_basis && String(raw.revenue_basis).trim()) || (d.revenue_basis && String(d.revenue_basis).trim()) || 'incl_tax';
    if (['incl_tax', 'excl_tax', 'excl_shipping'].indexOf(revenueBasis) === -1) revenueBasis = 'incl_tax';
    var startDate = normalizeYmd(raw.start_date, d.start_date || '2000-01-01');
    var endDate = normalizeYmd(raw.end_date, d.end_date || '');
    var enabled = raw.enabled !== false;
    var sort = Math.max(1, Math.trunc(Number(raw.sort) || Number(d.sort) || (idx + 1)));
    return {
      id: id.slice(0, 64),
      name: name.slice(0, 80),
      type: type,
      value: Math.max(0, Number(raw.value) || 0),
      revenue_basis: revenueBasis,
      start_date: startDate,
      end_date: endDate,
      enabled: enabled,
      sort: sort,
      appliesTo: normalizeAppliesTo(raw.appliesTo || d.appliesTo),
    };
  }

  function normalizeOverhead(rawOverhead, idx, defaults) {
    var raw = rawOverhead && typeof rawOverhead === 'object' ? rawOverhead : {};
    var d = defaults && typeof defaults === 'object' ? defaults : {};
    var id = (raw.id && String(raw.id).trim()) || (d.id && String(d.id).trim()) || ('oh_' + String(idx + 1));
    var name = (raw.name && String(raw.name).trim()) || (d.name && String(d.name).trim()) || 'Overhead';
    var kind = (raw.kind && String(raw.kind).trim()) || (d.kind && String(d.kind).trim()) || 'recurring';
    if (kind !== 'one_off' && kind !== 'recurring') kind = 'recurring';
    var freq = (raw.frequency && String(raw.frequency).trim()) || (d.frequency && String(d.frequency).trim()) || 'monthly';
    if (['daily', 'weekly', 'monthly', 'yearly'].indexOf(freq) === -1) freq = 'monthly';
    var monthlyAllocation = (raw.monthly_allocation && String(raw.monthly_allocation).trim()) || (d.monthly_allocation && String(d.monthly_allocation).trim()) || 'prorate';
    if (monthlyAllocation !== 'calendar' && monthlyAllocation !== 'prorate') monthlyAllocation = 'prorate';
    var dateOrStart = normalizeYmd(raw.date || raw.start_date, d.date || d.start_date || '2000-01-01');
    var endDate = normalizeYmd(raw.end_date, d.end_date || '');
    var enabled = raw.enabled !== false;
    return {
      id: id.slice(0, 64),
      name: name.slice(0, 80),
      kind: kind,
      amount: Math.max(0, Number(raw.amount) || 0),
      date: dateOrStart,
      end_date: endDate,
      frequency: freq,
      monthly_allocation: monthlyAllocation,
      notes: (raw.notes && String(raw.notes).trim().slice(0, 400)) || '',
      enabled: enabled,
      appliesTo: normalizeAppliesTo(raw.appliesTo || d.appliesTo),
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
        includeShopifyTaxes: raw.integrations.includeShopifyTaxes === true,
      };
    }
    var ce = raw.cost_expenses && typeof raw.cost_expenses === 'object' ? raw.cost_expenses : null;
    if (ce) {
      c.cost_expenses.rule_mode = ce.rule_mode === 'first_match' ? 'first_match' : 'stack';
      c.cost_expenses.per_order_rules = (Array.isArray(ce.per_order_rules) ? ce.per_order_rules : []).slice(0, 200).map(function (r, i) {
        return normalizePerOrderRule(r, i);
      });
      c.cost_expenses.per_order_rules.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
      c.cost_expenses.overheads = (Array.isArray(ce.overheads) ? ce.overheads : []).slice(0, 200).map(function (o, i) {
        return normalizeOverhead(o, i);
      });
      c.cost_expenses.overheads.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      c.cost_expenses.fixed_costs = (Array.isArray(ce.fixed_costs) ? ce.fixed_costs : []).slice(0, 200).map(function (f, i) {
        return normalizeFixedCost(f, i);
      });
      c.cost_expenses.fixed_costs.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    } else if (Array.isArray(raw.rules)) {
      // Legacy fallback: map old rules into the new model.
      var legacy = raw.rules.slice(0, 200);
      c.cost_expenses.rule_mode = 'stack';
      legacy.forEach(function (r, i) {
        var rule = r && typeof r === 'object' ? r : {};
        var type = ['percent_revenue', 'fixed_per_order', 'fixed_per_period'].indexOf(rule.type) !== -1 ? rule.type : 'percent_revenue';
        if (type === 'fixed_per_period') {
          c.cost_expenses.overheads.push(normalizeOverhead({
            id: rule.id,
            name: rule.name,
            kind: 'recurring',
            amount: rule.value,
            frequency: 'monthly',
            monthly_allocation: 'prorate',
            date: '2000-01-01',
            end_date: '',
            enabled: rule.enabled !== false,
            appliesTo: rule.appliesTo,
            notes: 'Migrated from legacy fixed per period rule. Review dates/frequency.',
          }, i));
        } else {
          c.cost_expenses.per_order_rules.push(normalizePerOrderRule({
            id: rule.id,
            name: rule.name,
            type: type,
            value: rule.value,
            revenue_basis: 'incl_tax',
            start_date: '2000-01-01',
            end_date: '',
            enabled: rule.enabled !== false,
            sort: rule.sort,
            appliesTo: rule.appliesTo,
          }, i));
        }
      });
      c.cost_expenses.per_order_rules.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    }

    // Keep a legacy view for any older UI consumers.
    c.rules = (c.cost_expenses.per_order_rules || []).map(function (r) {
      return {
        id: r.id,
        name: r.name,
        type: r.type === 'fixed_per_item' ? 'fixed_per_order' : r.type,
        value: r.value,
        enabled: r.enabled !== false,
        sort: r.sort,
        appliesTo: r.appliesTo,
      };
    });
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
    if (!c.cost_expenses.fixed_costs) c.cost_expenses.fixed_costs = [];
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
          '<input type="text" class="form-control form-control-sm kexo-ce-override-countries" value="' + esc(countriesStr) + '" data-override-countries placeholder="e.g. GB, IE, FR" aria-label="Countries" />' +
        '</td>' +
        '<td class="text-end">' +
          '<button type="button" class="btn btn-danger btn-sm" data-override-remove>Remove</button>' +
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

  function formatMoneyGbp(amount) {
    var n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    try { if (typeof window.formatRevenue === 'function') return window.formatRevenue(n) || ('£' + n.toFixed(2)); } catch (_) {}
    return '£' + n.toFixed(2);
  }

  function perOrderTypeLabel(type) {
    if (type === 'fixed_per_order') return 'Fixed per order';
    if (type === 'fixed_per_item') return 'Fixed per item';
    return '% of revenue';
  }

  function revenueBasisLabel(basis) {
    if (basis === 'excl_tax') return 'Excl tax';
    if (basis === 'excl_shipping') return 'Excl shipping';
    return 'Incl tax';
  }

  function perOrderValueLabel(rule) {
    if (!rule) return '—';
    var v = Number(rule.value);
    if (!Number.isFinite(v)) return '—';
    if (rule.type === 'percent_revenue') return v.toFixed(2).replace(/\.00$/, '') + '%';
    return formatMoneyGbp(v);
  }

  function scopeLabel(appliesTo) {
    var a = appliesTo && typeof appliesTo === 'object' ? appliesTo : {};
    if (a.mode === 'countries' && Array.isArray(a.countries) && a.countries.length) return a.countries.join(', ');
    return 'ALL';
  }

  function renderPerOrderRulesTable() {
    var tbody = document.getElementById('cost-expenses-per-order-table-body');
    if (!tbody) return;
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.per_order_rules)
      ? state.config.cost_expenses.per_order_rules
      : [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No per-order rules yet.</td></tr>';
      return;
    }
    var html = '';
    list.forEach(function (rule) {
      var basis = rule && rule.type === 'percent_revenue' ? revenueBasisLabel(rule.revenue_basis) : '—';
      html += '<tr data-per-order-id="' + esc(rule.id) + '">' +
        '<td>' + esc(rule.name || 'Expense') + '</td>' +
        '<td>' + esc(perOrderTypeLabel(rule.type)) + '</td>' +
        '<td class="text-end">' + esc(perOrderValueLabel(rule)) + '</td>' +
        '<td>' + esc(basis) + '</td>' +
        '<td>' + esc(rule.start_date || '—') + '</td>' +
        '<td>' + esc(rule.end_date || '—') + '</td>' +
        '<td>' + esc(scopeLabel(rule.appliesTo)) + '</td>' +
        '<td class="text-center"><input type="checkbox" data-per-order-enabled data-per-order-id="' + esc(rule.id) + '" ' + (rule.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
          '<button type="button" class="btn btn-sm" data-per-order-edit data-per-order-id="' + esc(rule.id) + '">Edit</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-per-order-delete data-per-order-id="' + esc(rule.id) + '">Delete</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  function overheadTypeLabel(kind) {
    return kind === 'one_off' ? 'One-off' : 'Recurring';
  }

  function overheadFrequencyLabel(o) {
    if (!o || o.kind !== 'recurring') return '—';
    var f = o.frequency || 'monthly';
    if (f === 'daily') return 'Daily';
    if (f === 'weekly') return 'Weekly';
    if (f === 'yearly') return 'Yearly';
    return 'Monthly';
  }

  function renderOverheadsTable() {
    var tbody = document.getElementById('cost-expenses-overheads-table-body');
    if (!tbody) return;
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.overheads)
      ? state.config.cost_expenses.overheads
      : [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No overheads yet.</td></tr>';
      return;
    }
    var html = '';
    list.forEach(function (o) {
      html += '<tr data-overhead-id="' + esc(o.id) + '">' +
        '<td>' + esc(o.name || 'Overhead') + '</td>' +
        '<td>' + esc(overheadTypeLabel(o.kind)) + '</td>' +
        '<td class="text-end">' + esc(formatMoneyGbp(o.amount)) + '</td>' +
        '<td>' + esc(o.date || '—') + '</td>' +
        '<td>' + esc(o.end_date || '—') + '</td>' +
        '<td>' + esc(overheadFrequencyLabel(o)) + '</td>' +
        '<td>' + esc(scopeLabel(o.appliesTo)) + '</td>' +
        '<td class="text-center"><input type="checkbox" data-overhead-enabled data-overhead-id="' + esc(o.id) + '" ' + (o.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
          '<button type="button" class="btn btn-sm" data-overhead-edit data-overhead-id="' + esc(o.id) + '">Edit</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-overhead-delete data-overhead-id="' + esc(o.id) + '">Delete</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderFixedCostsTable() {
    var tbody = document.getElementById('cost-expenses-fixed-costs-table-body');
    if (!tbody) return;
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.fixed_costs)
      ? state.config.cost_expenses.fixed_costs
      : [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No fixed costs yet.</td></tr>';
      return;
    }
    var html = '';
    list.forEach(function (f) {
      html += '<tr data-fixed-cost-id="' + esc(f.id) + '">' +
        '<td>' + esc(f.name || 'Fixed cost') + '</td>' +
        '<td class="text-end">' + esc(formatMoneyGbp(f.amount_per_day)) + '/day</td>' +
        '<td class="text-center"><input type="checkbox" data-fixed-cost-enabled data-fixed-cost-id="' + esc(f.id) + '" ' + (f.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
          '<button type="button" class="btn btn-sm" data-fixed-cost-edit data-fixed-cost-id="' + esc(f.id) + '">Edit</button> ' +
          '<button type="button" class="btn btn-danger btn-sm" data-fixed-cost-delete data-fixed-cost-id="' + esc(f.id) + '">Delete</button>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  function buildConfigFromDom() {
    var cfg = state.config ? JSON.parse(JSON.stringify(state.config)) : defaultConfig();
    cfg.integrations = cfg.integrations || {};
    var ga = document.getElementById('cost-expenses-google-ads');
    var pf = document.getElementById('cost-expenses-payment-fees');
    var ab = document.getElementById('cost-expenses-app-bills');
    var tax = document.getElementById('cost-expenses-tax');
    var rules = document.getElementById('cost-expenses-rules-enabled');
    cfg.integrations.includeGoogleAdsSpend = !!(ga && ga.checked);
    cfg.integrations.includePaymentFees = !!(pf && pf.checked);
    cfg.integrations.includeShopifyAppBills = !!(ab && ab.checked);
    cfg.integrations.includeShopifyTaxes = !!(tax && tax.checked);
    cfg.enabled = !!(rules && rules.checked);
    cfg.shipping = readShippingFromUi();
    if (!cfg.cost_expenses) cfg.cost_expenses = defaultCostExpensesModel();
    var modeEl = document.getElementById('cost-expenses-rule-mode');
    cfg.cost_expenses.rule_mode = (modeEl && String(modeEl.value) === 'first_match') ? 'first_match' : 'stack';
    return cfg;
  }

  function applyConfigToInputs() {
    if (!state.config) return;
    var cfg = state.config;
    var googleAds = document.getElementById('cost-expenses-google-ads');
    var paymentFees = document.getElementById('cost-expenses-payment-fees');
    var appBills = document.getElementById('cost-expenses-app-bills');
    var taxEl = document.getElementById('cost-expenses-tax');
    var rulesEnabledEl = document.getElementById('cost-expenses-rules-enabled');
    if (googleAds) googleAds.checked = !!(cfg.integrations && cfg.integrations.includeGoogleAdsSpend);
    if (paymentFees) paymentFees.checked = !!(cfg.integrations && cfg.integrations.includePaymentFees);
    if (appBills) appBills.checked = !!(cfg.integrations && cfg.integrations.includeShopifyAppBills);
    if (taxEl) taxEl.checked = !!(cfg.integrations && cfg.integrations.includeShopifyTaxes);
    if (rulesEnabledEl) rulesEnabledEl.checked = cfg.enabled === true;

    var worldwideEl = document.getElementById('cost-expenses-shipping-worldwide');
    var shippingEnabledEl = document.getElementById('cost-expenses-shipping-enabled');
    if (worldwideEl) worldwideEl.value = (cfg.shipping && cfg.shipping.worldwideDefaultGbp != null) ? cfg.shipping.worldwideDefaultGbp : 0;
    if (shippingEnabledEl) shippingEnabledEl.checked = !!(cfg.shipping && cfg.shipping.enabled);
    var modeEl = document.getElementById('cost-expenses-rule-mode');
    if (modeEl) modeEl.value = (cfg.cost_expenses && cfg.cost_expenses.rule_mode === 'first_match') ? 'first_match' : 'stack';
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

  function setSectionMsg(elId, text, ok) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text || '';
    el.classList.remove('is-hidden', 'text-success', 'text-danger', 'text-muted');
    el.classList.add('form-hint', 'mb-2');
    if (!text) { el.classList.add('is-hidden'); return; }
    if (ok === true) el.classList.add('text-success');
    else if (ok === false) el.classList.add('text-danger');
    else el.classList.add('text-muted');
  }

  function markDraftChanged() {
    try {
      if (typeof window.__kexoSettingsDraftChanged === 'function') window.__kexoSettingsDraftChanged();
    } catch (_) {}
  }

  function getPerOrderRuleById(id) {
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.per_order_rules)
      ? state.config.cost_expenses.per_order_rules
      : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function getOverheadById(id) {
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.overheads)
      ? state.config.cost_expenses.overheads
      : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function getFixedCostById(id) {
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.fixed_costs)
      ? state.config.cost_expenses.fixed_costs
      : [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function syncPerOrderRevenueBasisEnabled() {
    var typeEl = document.getElementById('cost-expenses-per-order-type');
    var basisEl = document.getElementById('cost-expenses-per-order-revenue-basis');
    if (!typeEl || !basisEl) return;
    var type = String(typeEl.value || '').trim();
    var enable = type === 'percent_revenue';
    basisEl.disabled = !enable;
  }

  function setPerOrderPreviewRangeUi(rangeKey) {
    state.previewRange = rangeKey;
    root.querySelectorAll('[data-ce-per-order-preview-range]').forEach(function (btn) {
      var r = String(btn.getAttribute('data-ce-per-order-preview-range') || '').trim().toLowerCase();
      var isActive = r === rangeKey;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  function setPerOrderPreviewText(text) {
    var el = document.getElementById('cost-expenses-per-order-preview');
    if (!el) return;
    el.textContent = text || '';
  }

  function showPerOrderForm(rule) {
    state.editingPerOrderId = rule ? String(rule.id) : '';
    var wrap = document.getElementById('cost-expenses-per-order-form-wrap');
    if (wrap) wrap.classList.remove('is-hidden');

    document.getElementById('cost-expenses-per-order-id').value = state.editingPerOrderId;
    document.getElementById('cost-expenses-per-order-name').value = rule ? (rule.name || '') : '';
    document.getElementById('cost-expenses-per-order-type').value = rule ? (rule.type || 'percent_revenue') : 'percent_revenue';
    document.getElementById('cost-expenses-per-order-value').value = rule && rule.value != null ? rule.value : '';
    document.getElementById('cost-expenses-per-order-revenue-basis').value = rule ? (rule.revenue_basis || 'incl_tax') : 'incl_tax';
    document.getElementById('cost-expenses-per-order-start').value = rule ? (rule.start_date || '') : (ymdTodayLocal() || '');
    document.getElementById('cost-expenses-per-order-end').value = rule ? (rule.end_date || '') : '';
    document.getElementById('cost-expenses-per-order-country').value = (rule && rule.appliesTo && rule.appliesTo.mode === 'countries' && rule.appliesTo.countries)
      ? rule.appliesTo.countries.join(',')
      : '';
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.per_order_rules)
      ? state.config.cost_expenses.per_order_rules
      : [];
    document.getElementById('cost-expenses-per-order-sort').value = rule && rule.sort != null ? rule.sort : (list.length + 1);
    document.getElementById('cost-expenses-per-order-enabled').checked = rule ? (rule.enabled !== false) : true;

    syncPerOrderRevenueBasisEnabled();
    setPerOrderPreviewRangeUi('7d');
    setPerOrderPreviewText('Estimated impact will appear here.');
    setSectionMsg('cost-expenses-per-order-msg', '', null);
  }

  function hidePerOrderForm() {
    state.editingPerOrderId = '';
    var wrap = document.getElementById('cost-expenses-per-order-form-wrap');
    if (wrap) wrap.classList.add('is-hidden');
  }

  function readPerOrderForm() {
    var name = (document.getElementById('cost-expenses-per-order-name').value || '').trim();
    if (!name) return { ok: false, error: 'Name required' };
    var startYmd = (document.getElementById('cost-expenses-per-order-start').value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return { ok: false, error: 'Start date required' };
    var endYmd = (document.getElementById('cost-expenses-per-order-end').value || '').trim();
    if (endYmd && !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return { ok: false, error: 'End date must be a date' };
    if (endYmd && endYmd < startYmd) return { ok: false, error: 'End date must be after start date' };

    var type = String(document.getElementById('cost-expenses-per-order-type').value || 'percent_revenue').trim();
    if (['percent_revenue', 'fixed_per_order', 'fixed_per_item'].indexOf(type) === -1) type = 'percent_revenue';
    var revenueBasis = String(document.getElementById('cost-expenses-per-order-revenue-basis').value || 'incl_tax').trim();
    if (['incl_tax', 'excl_tax', 'excl_shipping'].indexOf(revenueBasis) === -1) revenueBasis = 'incl_tax';

    var value = parseFloat(document.getElementById('cost-expenses-per-order-value').value, 10);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Value must be ≥ 0' };
    var sort = Math.max(1, parseInt(document.getElementById('cost-expenses-per-order-sort').value, 10) || 1);
    var countryRaw = (document.getElementById('cost-expenses-per-order-country').value || '').trim();
    var appliesTo = { mode: 'all', countries: [] };
    if (countryRaw && countryRaw.toUpperCase() !== 'ALL') {
      var codes = countryRaw.split(/[\s,]+/).map(normalizeCountryCode).filter(Boolean);
      if (codes.length) appliesTo = { mode: 'countries', countries: codes.slice(0, 64) };
    }
    var id = state.editingPerOrderId || ('por_' + Date.now());
    return {
      ok: true,
      rule: normalizePerOrderRule({
        id: id,
        name: name,
        type: type,
        value: value,
        revenue_basis: revenueBasis,
        start_date: startYmd,
        end_date: endYmd,
        enabled: document.getElementById('cost-expenses-per-order-enabled').checked,
        sort: sort,
        appliesTo: appliesTo,
      }, 0),
    };
  }

  function savePerOrderFromForm() {
    state.config = state.config || defaultConfig();
    if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
    if (!Array.isArray(state.config.cost_expenses.per_order_rules)) state.config.cost_expenses.per_order_rules = [];

    var parsed = readPerOrderForm();
    if (!parsed.ok) {
      setSectionMsg('cost-expenses-per-order-msg', parsed.error, false);
      return;
    }
    var list = state.config.cost_expenses.per_order_rules;
    var idx = list.findIndex(function (r) { return String(r.id) === String(parsed.rule.id); });
    if (idx !== -1) list[idx] = parsed.rule;
    else list.push(parsed.rule);
    list.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
    renderPerOrderRulesTable();
    hidePerOrderForm();
    setSectionMsg('cost-expenses-per-order-msg', 'Rule saved in draft. Press Save Settings below to apply.', true);
    markDraftChanged();
  }

  function syncOverheadFormUi() {
    var kindEl = document.getElementById('cost-expenses-overhead-kind');
    var freqEl = document.getElementById('cost-expenses-overhead-frequency');
    var allocEl = document.getElementById('cost-expenses-overhead-monthly-allocation');
    if (!kindEl || !freqEl || !allocEl) return;
    var kind = String(kindEl.value || '').trim();
    var recurring = kind === 'recurring';
    freqEl.disabled = !recurring;
    allocEl.disabled = !recurring || String(freqEl.value || '') !== 'monthly';
  }

  function showOverheadForm(overhead) {
    state.editingOverheadId = overhead ? String(overhead.id) : '';
    var wrap = document.getElementById('cost-expenses-overheads-form-wrap');
    if (wrap) wrap.classList.remove('is-hidden');

    document.getElementById('cost-expenses-overhead-id').value = state.editingOverheadId;
    document.getElementById('cost-expenses-overhead-name').value = overhead ? (overhead.name || '') : '';
    document.getElementById('cost-expenses-overhead-kind').value = overhead ? (overhead.kind || 'recurring') : 'recurring';
    document.getElementById('cost-expenses-overhead-amount').value = overhead && overhead.amount != null ? overhead.amount : '';
    document.getElementById('cost-expenses-overhead-date').value = overhead ? (overhead.date || '') : (ymdTodayLocal() || '');
    document.getElementById('cost-expenses-overhead-end').value = overhead ? (overhead.end_date || '') : '';
    document.getElementById('cost-expenses-overhead-frequency').value = overhead ? (overhead.frequency || 'monthly') : 'monthly';
    document.getElementById('cost-expenses-overhead-monthly-allocation').value = overhead ? (overhead.monthly_allocation || 'prorate') : 'prorate';
    document.getElementById('cost-expenses-overhead-country').value = (overhead && overhead.appliesTo && overhead.appliesTo.mode === 'countries' && overhead.appliesTo.countries)
      ? overhead.appliesTo.countries.join(',')
      : '';
    document.getElementById('cost-expenses-overhead-notes').value = overhead ? (overhead.notes || '') : '';
    document.getElementById('cost-expenses-overhead-enabled').checked = overhead ? (overhead.enabled !== false) : true;

    syncOverheadFormUi();
    setSectionMsg('cost-expenses-overheads-msg', '', null);
  }

  function hideOverheadForm() {
    state.editingOverheadId = '';
    var wrap = document.getElementById('cost-expenses-overheads-form-wrap');
    if (wrap) wrap.classList.add('is-hidden');
  }

  function readOverheadForm() {
    var name = (document.getElementById('cost-expenses-overhead-name').value || '').trim();
    if (!name) return { ok: false, error: 'Name required' };
    var amount = parseFloat(document.getElementById('cost-expenses-overhead-amount').value, 10);
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Amount must be ≥ 0' };
    var kind = String(document.getElementById('cost-expenses-overhead-kind').value || 'recurring').trim();
    if (kind !== 'one_off' && kind !== 'recurring') kind = 'recurring';

    var date = (document.getElementById('cost-expenses-overhead-date').value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Date / start is required' };
    var endYmd = (document.getElementById('cost-expenses-overhead-end').value || '').trim();
    if (endYmd && !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return { ok: false, error: 'End date must be a date' };
    if (endYmd && endYmd < date) return { ok: false, error: 'End date must be after start date' };

    var freq = String(document.getElementById('cost-expenses-overhead-frequency').value || 'monthly').trim();
    if (['daily', 'weekly', 'monthly', 'yearly'].indexOf(freq) === -1) freq = 'monthly';
    var alloc = String(document.getElementById('cost-expenses-overhead-monthly-allocation').value || 'prorate').trim();
    if (alloc !== 'calendar' && alloc !== 'prorate') alloc = 'prorate';

    var countryRaw = (document.getElementById('cost-expenses-overhead-country').value || '').trim();
    var appliesTo = { mode: 'all', countries: [] };
    if (countryRaw && countryRaw.toUpperCase() !== 'ALL') {
      var codes = countryRaw.split(/[\s,]+/).map(normalizeCountryCode).filter(Boolean);
      if (codes.length) appliesTo = { mode: 'countries', countries: codes.slice(0, 64) };
    }

    var id = state.editingOverheadId || ('oh_' + Date.now());
    return {
      ok: true,
      overhead: normalizeOverhead({
        id: id,
        name: name,
        kind: kind,
        amount: amount,
        date: date,
        end_date: endYmd,
        frequency: freq,
        monthly_allocation: alloc,
        notes: (document.getElementById('cost-expenses-overhead-notes').value || '').trim(),
        enabled: document.getElementById('cost-expenses-overhead-enabled').checked,
        appliesTo: appliesTo,
      }, 0),
    };
  }

  function saveOverheadFromForm() {
    state.config = state.config || defaultConfig();
    if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
    if (!Array.isArray(state.config.cost_expenses.overheads)) state.config.cost_expenses.overheads = [];

    var parsed = readOverheadForm();
    if (!parsed.ok) {
      setSectionMsg('cost-expenses-overheads-msg', parsed.error, false);
      return;
    }
    var list = state.config.cost_expenses.overheads;
    var idx = list.findIndex(function (o) { return String(o.id) === String(parsed.overhead.id); });
    if (idx !== -1) list[idx] = parsed.overhead;
    else list.push(parsed.overhead);
    list.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    renderOverheadsTable();
    hideOverheadForm();
    setSectionMsg('cost-expenses-overheads-msg', 'Overhead saved in draft. Press Save Settings below to apply.', true);
    markDraftChanged();
  }

  function showFixedCostForm(fc) {
    state.editingFixedCostId = fc ? String(fc.id) : '';
    var wrap = document.getElementById('cost-expenses-fixed-cost-form-wrap');
    if (wrap) wrap.classList.remove('is-hidden');

    document.getElementById('cost-expenses-fixed-cost-id').value = state.editingFixedCostId;
    document.getElementById('cost-expenses-fixed-cost-name').value = fc ? (fc.name || '') : '';
    document.getElementById('cost-expenses-fixed-cost-amount').value = fc && fc.amount_per_day != null ? fc.amount_per_day : '';
    document.getElementById('cost-expenses-fixed-cost-enabled').checked = fc ? (fc.enabled !== false) : true;
    setSectionMsg('cost-expenses-fixed-costs-msg', '', null);
  }

  function hideFixedCostForm() {
    state.editingFixedCostId = '';
    var wrap = document.getElementById('cost-expenses-fixed-cost-form-wrap');
    if (wrap) wrap.classList.add('is-hidden');
  }

  function saveFixedCostFromForm() {
    state.config = state.config || defaultConfig();
    if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
    if (!Array.isArray(state.config.cost_expenses.fixed_costs)) state.config.cost_expenses.fixed_costs = [];

    var name = (document.getElementById('cost-expenses-fixed-cost-name').value || '').trim();
    if (!name) {
      setSectionMsg('cost-expenses-fixed-costs-msg', 'Name required', false);
      return;
    }
    var amount = parseFloat(document.getElementById('cost-expenses-fixed-cost-amount').value, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      setSectionMsg('cost-expenses-fixed-costs-msg', 'Amount per day must be ≥ 0', false);
      return;
    }
    var id = state.editingFixedCostId || ('fc_' + Date.now());
    var fixedCost = normalizeFixedCost({
      id: id,
      name: name,
      amount_per_day: amount,
      enabled: document.getElementById('cost-expenses-fixed-cost-enabled').checked,
    }, 0);

    var list = state.config.cost_expenses.fixed_costs;
    var idx = list.findIndex(function (f) { return String(f.id) === String(fixedCost.id); });
    if (idx !== -1) list[idx] = fixedCost;
    else list.push(fixedCost);
    list.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    renderFixedCostsTable();
    hideFixedCostForm();
    setSectionMsg('cost-expenses-fixed-costs-msg', 'Fixed cost saved in draft. Press Save Settings below to apply.', true);
    markDraftChanged();
  }

  function runPerOrderPreview(rangeKey) {
    var r = String(rangeKey || '').trim().toLowerCase();
    if (r !== 'today' && r !== '7d' && r !== '30d') r = '7d';
    setPerOrderPreviewRangeUi(r);

    var parsed = readPerOrderForm();
    if (!parsed.ok) {
      setPerOrderPreviewText(parsed.error);
      return;
    }

    var reqId = ++state.previewReqId;
    setPerOrderPreviewText('Loading…');
    fetchJson(API + '/api/cost-expenses/per-order-preview?range=' + encodeURIComponent(r), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profitRules: state.config,
        draftRule: parsed.rule,
      }),
    }).then(function (payload) {
      if (reqId !== state.previewReqId) return;
      if (!payload || payload.ok !== true) {
        setPerOrderPreviewText('Preview unavailable.');
        return;
      }
      var amt = payload && payload.totalGbp != null ? Number(payload.totalGbp) : NaN;
      if (!Number.isFinite(amt)) {
        setPerOrderPreviewText('Preview unavailable.');
        return;
      }
      setPerOrderPreviewText('Estimated per-order rules impact: ' + formatMoneyGbp(amt) + ' (' + (r === '7d' ? '7 days' : r === '30d' ? '30 days' : 'today') + ').');
    }).catch(function () {
      if (reqId !== state.previewReqId) return;
      setPerOrderPreviewText('Preview unavailable.');
    });
  }

  function bindUi() {
    if (state.uiBound) return;
    state.uiBound = true;

    // Saving is via the global footer Save only; no in-panel save button.

    var reloadBtn = document.getElementById('cost-expenses-reload-btn');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        try { hidePerOrderForm(); } catch (_) {}
        try { hideOverheadForm(); } catch (_) {}
        try { hideFixedCostForm(); } catch (_) {}
        state.loadInFlight = null;
        load();
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
      markDraftChanged();
    });

    var addPerOrderBtn = document.getElementById('cost-expenses-per-order-add-btn');
    var savePerOrderBtn = document.getElementById('cost-expenses-per-order-save-btn');
    var cancelPerOrderBtn = document.getElementById('cost-expenses-per-order-cancel-btn');
    if (addPerOrderBtn) addPerOrderBtn.addEventListener('click', function () { showPerOrderForm(null); });
    if (savePerOrderBtn) savePerOrderBtn.addEventListener('click', savePerOrderFromForm);
    if (cancelPerOrderBtn) cancelPerOrderBtn.addEventListener('click', hidePerOrderForm);

    var addOverheadBtn = document.getElementById('cost-expenses-overheads-add-btn');
    var saveOverheadBtn = document.getElementById('cost-expenses-overhead-save-btn');
    var cancelOverheadBtn = document.getElementById('cost-expenses-overhead-cancel-btn');
    if (addOverheadBtn) addOverheadBtn.addEventListener('click', function () { showOverheadForm(null); });
    if (saveOverheadBtn) saveOverheadBtn.addEventListener('click', saveOverheadFromForm);
    if (cancelOverheadBtn) cancelOverheadBtn.addEventListener('click', hideOverheadForm);

    var addFixedCostBtn = document.getElementById('cost-expenses-fixed-cost-add-btn');
    var saveFixedCostBtn = document.getElementById('cost-expenses-fixed-cost-save-btn');
    var cancelFixedCostBtn = document.getElementById('cost-expenses-fixed-cost-cancel-btn');
    if (addFixedCostBtn) addFixedCostBtn.addEventListener('click', function () { showFixedCostForm(null); });
    if (saveFixedCostBtn) saveFixedCostBtn.addEventListener('click', saveFixedCostFromForm);
    if (cancelFixedCostBtn) cancelFixedCostBtn.addEventListener('click', hideFixedCostForm);

    root.addEventListener('change', function (e) {
      var target = e.target;
      if (target && (target.id === 'cost-expenses-shipping-enabled' || target.id === 'cost-expenses-rules-enabled')) {
        syncExcludedHints();
      }
      if (target && target.id === 'cost-expenses-rule-mode') {
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.rule_mode = String(target.value) === 'first_match' ? 'first_match' : 'stack';
      }
      if (target && target.id === 'cost-expenses-per-order-type') {
        syncPerOrderRevenueBasisEnabled();
      }
      if (target && (target.id === 'cost-expenses-overhead-kind' || target.id === 'cost-expenses-overhead-frequency')) {
        syncOverheadFormUi();
      }
      if (target && (target.getAttribute('data-override-priority') !== null || target.getAttribute('data-override-enabled') !== null || target.getAttribute('data-override-price') !== null || target.getAttribute('data-override-countries') !== null)) {
        state.config = state.config || defaultConfig();
        state.config.shipping = readShippingFromUi();
        renderShippingOverrides();
      }
      if (target && target.getAttribute('data-per-order-enabled') !== null) {
        var id = target.getAttribute('data-per-order-id');
        var rule = getPerOrderRuleById(id);
        if (rule) rule.enabled = target.checked === true;
      }
      if (target && target.getAttribute('data-overhead-enabled') !== null) {
        var id2 = target.getAttribute('data-overhead-id');
        var oh = getOverheadById(id2);
        if (oh) oh.enabled = target.checked === true;
      }
      if (target && target.getAttribute('data-fixed-cost-enabled') !== null) {
        var id3 = target.getAttribute('data-fixed-cost-id');
        var fc = getFixedCostById(id3);
        if (fc) fc.enabled = target.checked === true;
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
          markDraftChanged();
        }
      }
      if (t.getAttribute('data-per-order-edit') !== null) {
        var id = t.getAttribute('data-per-order-id');
        showPerOrderForm(getPerOrderRuleById(id));
      }
      if (t.getAttribute('data-per-order-delete') !== null) {
        var id = t.getAttribute('data-per-order-id');
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.per_order_rules = (state.config.cost_expenses.per_order_rules || []).filter(function (r) { return String(r.id) !== String(id); });
        renderPerOrderRulesTable();
        hidePerOrderForm();
        markDraftChanged();
      }
      if (t.getAttribute('data-overhead-edit') !== null) {
        var id = t.getAttribute('data-overhead-id');
        showOverheadForm(getOverheadById(id));
      }
      if (t.getAttribute('data-overhead-delete') !== null) {
        var id = t.getAttribute('data-overhead-id');
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.overheads = (state.config.cost_expenses.overheads || []).filter(function (o) { return String(o.id) !== String(id); });
        renderOverheadsTable();
        hideOverheadForm();
        markDraftChanged();
      }
      if (t.getAttribute('data-fixed-cost-edit') !== null) {
        var id = t.getAttribute('data-fixed-cost-id');
        showFixedCostForm(getFixedCostById(id));
      }
      if (t.getAttribute('data-fixed-cost-delete') !== null) {
        var id = t.getAttribute('data-fixed-cost-id');
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.fixed_costs = (state.config.cost_expenses.fixed_costs || []).filter(function (f) { return String(f.id) !== String(id); });
        renderFixedCostsTable();
        hideFixedCostForm();
        markDraftChanged();
      }
      if (t.getAttribute('data-ce-per-order-preview-range') !== null) {
        var r = t.getAttribute('data-ce-per-order-preview-range');
        runPerOrderPreview(r);
      }
    });

    document.querySelectorAll('[data-settings-cost-expenses-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sub = (btn.getAttribute('data-settings-cost-expenses-tab') || '').trim().toLowerCase();
        if (sub !== 'cost-sources' && sub !== 'shipping' && sub !== 'rules' && sub !== 'breakdown') return;
        setActiveSubTab(sub, { updateUrl: true });
      });
    });

    // Apply initial sub-tab from URL (path first, then query) for direct loads / cached settings-page.
    try {
      var initial = '';
      var pathMatch = /^\/settings\/cost-expenses\/([^/]+)$/.exec((window.location.pathname || '').replace(/\/+$/, ''));
      if (pathMatch && pathMatch[1]) {
        initial = String(pathMatch[1]).trim().toLowerCase();
      }
      if (!initial) {
        var params = new URLSearchParams(window.location.search || '');
        initial = String(params.get('costExpensesTab') || '').trim().toLowerCase();
      }
      if (initial === 'cost-sources' || initial === 'shipping' || initial === 'rules' || initial === 'breakdown') setActiveSubTab(initial, { updateUrl: false });
      else setActiveSubTab('cost-sources', { updateUrl: false });
    } catch (_) {}
  }

  function saveCostExpensesToApi() {
    var config = buildConfigFromDom();
    return fetchJson(API + '/api/settings/profit-rules', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profitRules: config }),
    }).then(function (payload) {
      if (!payload || payload.ok !== true || !payload.profitRules) throw new Error('Save failed');
      state.config = normalizeConfig(payload && payload.profitRules);
      applyConfigToInputs();
      renderShippingOverrides();
      renderPerOrderRulesTable();
      renderOverheadsTable();
      renderFixedCostsTable();
      hidePerOrderForm();
      hideOverheadForm();
      hideFixedCostForm();
      syncExcludedHints();
      if (typeof window.__kexoSetSettingsDraftBaseline === 'function') window.__kexoSetSettingsDraftBaseline('cost-expenses', buildConfigFromDom());
      return { ok: true };
    }).catch(function (err) {
      try {
        var msg = (err && err.message) ? String(err.message) : 'Save failed';
        if (typeof window.__kexoSettingsShowError === 'function') window.__kexoSettingsShowError('Cost & Expenses save failed. ' + msg);
      } catch (_) {}
      return { ok: false };
    });
  }

  function load() {
    if (state.loadInFlight) return state.loadInFlight;
    var payload = typeof window !== 'undefined' && window.__kexoSettingsPayload;
    if (payload && payload.profitRules != null && !state.config) {
      state.config = normalizeConfig(payload.profitRules);
      applyConfigToInputs();
      renderShippingOverrides();
      renderPerOrderRulesTable();
      renderOverheadsTable();
      renderFixedCostsTable();
      bindUi();
      if (typeof window.__kexoSetSettingsDraftBaseline === 'function') window.__kexoSetSettingsDraftBaseline('cost-expenses', buildConfigFromDom());
      markDraftChanged();
      try {
        if (typeof window.migrateTitleToHelpPopover === 'function') window.migrateTitleToHelpPopover(root);
        if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(root);
      } catch (_) {}
      return Promise.resolve();
    }
    state.loadInFlight = fetchJson(API + '/api/settings/profit-rules').then(function (configPayload) {
      if (!configPayload || configPayload.ok !== true || !configPayload.profitRules) throw new Error('Failed to load');
      state.config = normalizeConfig(configPayload && configPayload.profitRules);
      applyConfigToInputs();
      renderShippingOverrides();
      renderPerOrderRulesTable();
      renderOverheadsTable();
      renderFixedCostsTable();
      bindUi();
      if (typeof window.__kexoSetSettingsDraftBaseline === 'function') window.__kexoSetSettingsDraftBaseline('cost-expenses', buildConfigFromDom());
      markDraftChanged();
      try {
        if (typeof window.migrateTitleToHelpPopover === 'function') window.migrateTitleToHelpPopover(root);
        if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(root);
      } catch (_) {}
    }).catch(function (err) {
      try {
        var msg = (err && err.message) ? String(err.message) : 'Failed to load';
        if (typeof window.__kexoSettingsShowError === 'function') window.__kexoSettingsShowError('Cost & Expenses failed to load. ' + msg);
      } catch (_) {}
      state.config = defaultConfig();
      applyConfigToInputs();
      renderShippingOverrides();
      renderPerOrderRulesTable();
      renderOverheadsTable();
      renderFixedCostsTable();
      bindUi();
      if (typeof window.__kexoSetSettingsDraftBaseline === 'function') window.__kexoSetSettingsDraftBaseline('cost-expenses', buildConfigFromDom());
      markDraftChanged();
      try {
        if (typeof window.migrateTitleToHelpPopover === 'function') window.migrateTitleToHelpPopover(root);
        if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(root);
      } catch (_) {}
    }).finally(function () {
      state.loadInFlight = null;
    });
    return state.loadInFlight;
  }

  window.initCostExpensesSettings = function () {
    load();
  };
  try { window.__kexoCostExpensesSetActiveSubTab = setActiveSubTab; } catch (_) {}
  window.__kexoCostExpensesReadDom = buildConfigFromDom;
  window.__kexoCostExpensesApply = function (config) {
    state.config = normalizeConfig(config);
    applyConfigToInputs();
    renderShippingOverrides();
    renderPerOrderRulesTable();
    renderOverheadsTable();
    renderFixedCostsTable();
  };
  window.__kexoCostExpensesSave = saveCostExpensesToApi;

  // Always bind the UI once so buttons/tabs work even if Settings init is cached/broken.
  try { bindUi(); } catch (_) {}

  // Fail-safe: direct loads to /settings/cost-expenses/* or legacy ?tab=cost-expenses should initialize even if script order changes.
  try {
    var pathMatch = /^\/settings\/cost-expenses\/([^/]+)$/.exec((window.location.pathname || '').replace(/\/+$/, ''));
    var isCostExpensesPath = pathMatch && pathMatch[1];
    if (!isCostExpensesPath) {
      var params = new URLSearchParams(window.location.search || '');
      isCostExpensesPath = String(params.get('tab') || '').trim().toLowerCase() === 'cost-expenses';
    }
    if (isCostExpensesPath) {
      try { window.initCostExpensesSettings(); } catch (_) {}
      var sub = pathMatch && pathMatch[1] ? String(pathMatch[1]).trim().toLowerCase() : '';
      if (!sub) {
        var params = new URLSearchParams(window.location.search || '');
        sub = String(params.get('costExpensesTab') || '').trim().toLowerCase();
      }
      if (sub === 'shipping' || sub === 'rules' || sub === 'breakdown') setActiveSubTab(sub, { updateUrl: false });
    }
  } catch (_) {}
})();
