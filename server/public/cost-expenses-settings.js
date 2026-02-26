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
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizeCountryCode(v) {
    var raw = (v == null ? '' : String(v).trim()).toUpperCase().slice(0, 2);
    if (!raw) return '';
    return raw === 'UK' ? 'GB' : raw;
  }

  function detectTablerFlagsCssOnce() {
    try {
      if (!document || !document.documentElement) return;
      if (document.documentElement.getAttribute('data-kexo-flags-css') != null) return;
      var t = document.createElement('span');
      t.className = 'flag flag-xs flag-country-gb visually-hidden';
      t.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(t);
      var bg = '';
      try { bg = (window.getComputedStyle && window.getComputedStyle(t) ? window.getComputedStyle(t).backgroundImage : '') || ''; } catch (_) {}
      try { if (t.parentElement) t.parentElement.removeChild(t); } catch (_) {}
      document.documentElement.setAttribute('data-kexo-flags-css', (bg && bg !== 'none') ? '1' : '0');
    } catch (_) {}
  }
  detectTablerFlagsCssOnce();

  function hasTablerFlagsCss() {
    try {
      return !!(document && document.documentElement && document.documentElement.getAttribute('data-kexo-flags-css') === '1');
    } catch (_) {
      return false;
    }
  }

  function ymdTodayLocal() {
    try { return new Date().toLocaleDateString('en-CA'); } catch (_) {}
    try { return new Date().toISOString().slice(0, 10); } catch (_) {}
    return '';
  }

  function defaultCostExpensesModel() {
    return {
      rule_mode: 'stack',
      // These toggles control which groups are included in profit calculations (app-only).
      include_per_order_rules: true,
      include_overheads: true,
      include_fixed_costs: true,
      per_order_rules: [],
      overheads: [],
      fixed_costs: [],
    };
  }

  function normalizeFixedCost(raw, idx) {
    var r = raw && typeof raw === 'object' ? raw : {};
    var id = (r.id && String(r.id).trim()) || ('fc_' + String(idx + 1));
    var name = (r.name && String(r.name).trim()) || 'Fixed cost';
    var freqRaw = r.frequency == null ? '' : String(r.frequency).trim().toLowerCase();
    var frequency = (freqRaw === 'daily' || freqRaw === 'weekly' || freqRaw === 'monthly' || freqRaw === 'yearly') ? freqRaw : 'daily';
    var rawAmount = (r.amount != null) ? r.amount : r.amount_per_day;
    var amount = Math.max(0, Number(rawAmount) || 0);
    var DAYS_PER_YEAR = 365.25;
    var DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
    var amount_per_day = (function () {
      // Back-compat: config may only have amount_per_day (daily) and no explicit frequency.
      if ((r.amount == null) && (r.frequency == null) && (r.amount_per_day != null)) return Math.max(0, Number(r.amount_per_day) || 0);
      if (frequency === 'weekly') return amount / 7;
      if (frequency === 'monthly') return amount / DAYS_PER_MONTH;
      if (frequency === 'yearly') return amount / DAYS_PER_YEAR;
      return amount; // daily
    })();
    var effectiveStart = normalizeYmd(r.effective_start || r.start_date, '');
    return {
      id: id.slice(0, 64),
      name: name.slice(0, 80),
      amount: amount,
      frequency: frequency,
      amount_per_day: Math.max(0, Number(amount_per_day) || 0),
      effective_start: effectiveStart || null,
      start_date: effectiveStart || '',
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
        includeCostOfGoods: true,
      },
      cost_expenses: defaultCostExpensesModel(),
      rules: [], // legacy (kept for backwards compatibility)
      shipping: { enabled: false, worldwideDefaultGbp: 0, worldwideDefaultAmount: 0, worldwideDefaultCurrency: 'GBP', overrides: [] },
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
    var category = (raw.category && String(raw.category).trim().toLowerCase()) || (d.category && String(d.category).trim().toLowerCase()) || 'other';
    if (['tax_vat', 'payment_fees', 'packaging', 'handling', 'fulfilment', 'insurance', 'other'].indexOf(category) === -1) category = 'other';

    var kindRaw = (raw.kind && String(raw.kind).trim().toLowerCase()) || '';
    var legacyType = (raw.type && String(raw.type).trim()) || (d.type && String(d.type).trim()) || '';
    var kind = kindRaw;
    if (kind !== 'fixed_per_order' && kind !== 'percent_of_revenue' && kind !== 'fixed_per_item') {
      var lt = String(legacyType || '').trim().toLowerCase();
      if (lt === 'fixed_per_order') kind = 'fixed_per_order';
      else if (lt === 'fixed_per_item') kind = 'fixed_per_item';
      else kind = 'percent_of_revenue';
    }

    var direction = (raw.direction && String(raw.direction).trim().toLowerCase()) || (d.direction && String(d.direction).trim().toLowerCase()) || 'add';
    if (direction !== 'add' && direction !== 'subtract') direction = 'add';

    var revenueBasisRaw = (raw.revenue_basis && String(raw.revenue_basis).trim().toLowerCase()) || (d.revenue_basis && String(d.revenue_basis).trim().toLowerCase()) || '';
    var revenueBasis = revenueBasisRaw;
    if (revenueBasis === 'incl_tax') revenueBasis = 'order_total_incl_tax';
    if (revenueBasis === 'excl_tax') revenueBasis = 'order_total_excl_tax';
    if (revenueBasis === 'excl_shipping') revenueBasis = 'subtotal_excl_shipping';
    if (['order_total_incl_tax', 'order_total_excl_tax', 'subtotal_excl_shipping'].indexOf(revenueBasis) === -1) revenueBasis = 'order_total_incl_tax';

    var effectiveStart = normalizeYmd(raw.effective_start || raw.start_date, d.effective_start || d.start_date || '2000-01-01');
    var effectiveEnd = normalizeYmd(raw.effective_end || raw.end_date, d.effective_end || d.end_date || '');

    var enabled = raw.enabled !== false;
    var sort = Math.max(1, Math.trunc(Number(raw.sort) || Number(d.sort) || (idx + 1)));

    // Country scope: 'ALL' or list of codes.
    var countryScope = raw.country_scope != null ? raw.country_scope : (d.country_scope != null ? d.country_scope : null);
    var countries = [];
    if (Array.isArray(countryScope)) {
      var seen = {};
      for (var i = 0; i < countryScope.length && countries.length < 64; i++) {
        var cc = normalizeCountryCode(countryScope[i]);
        if (cc && !seen[cc]) { seen[cc] = true; countries.push(cc); }
      }
    } else if (countryScope && String(countryScope).trim().toUpperCase() !== 'ALL') {
      var parts = String(countryScope).split(/[\s,]+/).map(normalizeCountryCode).filter(Boolean);
      var seen2 = {};
      for (var j = 0; j < parts.length && countries.length < 64; j++) {
        if (!seen2[parts[j]]) { seen2[parts[j]] = true; countries.push(parts[j]); }
      }
    } else if (raw.appliesTo || d.appliesTo) {
      var a = normalizeAppliesTo(raw.appliesTo || d.appliesTo);
      if (a.mode === 'countries' && Array.isArray(a.countries)) countries = a.countries.slice(0, 64);
    }
    var normalizedCountryScope = countries.length ? countries : 'ALL';
    var appliesTo = countries.length ? { mode: 'countries', countries: countries } : { mode: 'all', countries: [] };

    var breakdownLabelRaw = (raw.breakdown_label && String(raw.breakdown_label).trim()) || (d.breakdown_label && String(d.breakdown_label).trim()) || '';
    var breakdown_label = breakdownLabelRaw;
    if (!breakdown_label) {
      if (category === 'tax_vat') breakdown_label = (countries.length === 1 && countries[0] === 'GB') ? 'UK VAT' : 'VAT';
      else if (category === 'payment_fees') breakdown_label = 'Payment fees';
      else if (category === 'packaging') breakdown_label = 'Packaging';
      else if (category === 'handling') breakdown_label = 'Handling';
      else if (category === 'fulfilment') breakdown_label = 'Fulfilment';
      else if (category === 'insurance') breakdown_label = 'Insurance';
      else breakdown_label = name;
    }

    // Legacy type mapping (engine/server still accepts this).
    var type = kind === 'fixed_per_order' ? 'fixed_per_order' : kind === 'fixed_per_item' ? 'fixed_per_item' : 'percent_revenue';
    return {
      id: id.slice(0, 64),
      name: name.slice(0, 80),
      category: category,
      breakdown_label: breakdown_label.slice(0, 80),
      kind: kind,
      direction: direction,
      type: type,
      value: Math.max(0, Number(raw.value) || 0),
      revenue_basis: revenueBasis,
      effective_start: effectiveStart,
      effective_end: effectiveEnd || null,
      country_scope: normalizedCountryScope,
      start_date: effectiveStart,
      end_date: effectiveEnd,
      enabled: enabled,
      sort: sort,
      appliesTo: appliesTo,
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
        includeCostOfGoods: Object.prototype.hasOwnProperty.call(raw.integrations, 'includeCostOfGoods')
          ? raw.integrations.includeCostOfGoods === true
          : true,
      };
    }
    var ce = raw.cost_expenses && typeof raw.cost_expenses === 'object' ? raw.cost_expenses : null;
    if (ce) {
      c.cost_expenses.rule_mode = ce.rule_mode === 'first_match' ? 'first_match' : 'stack';
      // New: per-group include flags (default on if missing).
      c.cost_expenses.include_per_order_rules = ce.include_per_order_rules !== false;
      c.cost_expenses.include_overheads = ce.include_overheads !== false;
      c.cost_expenses.include_fixed_costs = ce.include_fixed_costs !== false;
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
      c.cost_expenses.include_per_order_rules = true;
      c.cost_expenses.include_overheads = true;
      c.cost_expenses.include_fixed_costs = true;
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
      var sh = raw.shipping;
      var amount = sh.worldwideDefaultAmount != null ? Math.max(0, Number(sh.worldwideDefaultAmount) || 0) : Math.max(0, Number(sh.worldwideDefaultGbp) || 0);
      var currency = (sh.worldwideDefaultCurrency && String(sh.worldwideDefaultCurrency).trim()) ? String(sh.worldwideDefaultCurrency).trim().toUpperCase().slice(0, 8) : 'GBP';
      if (['GBP', 'EUR', 'USD'].indexOf(currency) === -1) currency = 'GBP';
      c.shipping = {
        enabled: sh.enabled === true,
        worldwideDefaultGbp: currency === 'GBP' ? amount : 0,
        worldwideDefaultAmount: amount,
        worldwideDefaultCurrency: currency,
        overrides: (Array.isArray(sh.overrides) ? sh.overrides : []).slice(0, 64).map(function (o, i) {
          var ov = o && typeof o === 'object' ? o : {};
          var label = String(ov.label || '').trim();
          if (label.length > 60) label = label.slice(0, 60);
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
            label: label,
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
    var perOrderToggle = document.getElementById('cost-expenses-rules-per-order-enabled');
    var overheadsToggle = document.getElementById('cost-expenses-rules-overheads-enabled');
    var fixedToggle = document.getElementById('cost-expenses-rules-fixed-enabled');
    var shippingHint = document.getElementById('cost-expenses-shipping-excluded-hint');
    var rulesHint = document.getElementById('cost-expenses-rules-excluded-hint');

    var shippingIncluded = !!(shippingToggle && shippingToggle.checked === true);
    var perOrderIncluded = !!(perOrderToggle && perOrderToggle.checked === true);
    var overheadsIncluded = !!(overheadsToggle && overheadsToggle.checked === true);
    var fixedIncluded = !!(fixedToggle && fixedToggle.checked === true);

    if (shippingHint) shippingHint.classList.toggle('is-hidden', !shippingToggle || shippingIncluded);
    if (rulesHint) {
      if (!perOrderToggle || !overheadsToggle || !fixedToggle) {
        rulesHint.textContent = 'Rules are currently excluded from Cost sources.';
        rulesHint.classList.toggle('is-hidden', true);
      } else {
        var excluded = [];
        if (!perOrderIncluded) excluded.push('Per Order');
        if (!overheadsIncluded) excluded.push('Overheads');
        if (!fixedIncluded) excluded.push('Fixed');
        if (!excluded.length) {
          rulesHint.textContent = 'Rules are currently excluded from Cost sources.';
          rulesHint.classList.add('is-hidden');
        } else {
          rulesHint.textContent = 'Some cost rules are excluded from Cost sources: ' + excluded.join(', ') + '.';
          rulesHint.classList.remove('is-hidden');
        }
      }
    }
  }

  function renderShippingOverrides() {
    var wrap = document.getElementById('cost-expenses-shipping-overrides-wrap');
    var dupWarn = document.getElementById('cost-expenses-shipping-dup-warn');
    if (!wrap) return;
    ensureShippingOverridesHeader(wrap);
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
      var labelStr = (ov.label || '').trim();
      var countriesFlags = countryCodesToFlagStackHtml(ov.countries || [], (ov.countries && ov.countries.length) ? 'Countries' : 'All countries');
      var pri = ov.priority || idx + 1;
      var price = ov.priceGbp != null ? ov.priceGbp : 0;
      var en = ov.enabled !== false;
      html += '<tr data-override-idx="' + idx + '">' +
        '<td>' + esc(String(pri)) + '</td>' +
        '<td class="text-center">' + (en ? 'On' : 'Off') + '</td>' +
        '<td>' + esc(labelStr || '—') + '</td>' +
        '<td>' + esc(formatMoneyGbp(price)) + '</td>' +
        '<td><span class="kexo-ce-override-countries-display">' + countriesFlags + (countriesStr ? (' <span class="text-secondary">' + esc(countriesStr) + '</span>') : '') + '</span></td>' +
        '<td class="text-end">' +
          '<div class="d-inline-flex gap-1 flex-nowrap kexo-table-actions" aria-label="Override actions">' +
            '<button type="button" class="btn btn-sm kexo-icon-action-btn" data-shipping-override-edit data-override-idx="' + idx + '" aria-label="Edit override" title="Edit">' +
              '<i data-icon-key="admin-tab-table-row-edit" aria-hidden="true"></i>' +
            '</button>' +
            '<button type="button" class="btn btn-danger btn-sm kexo-icon-action-btn" data-override-remove aria-label="Remove override" title="Remove">' +
              '<i data-icon-key="admin-tab-table-row-delete" aria-hidden="true"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
        '</tr>';
    });
    wrap.innerHTML = html || '<tr><td colspan="6" class="text-muted small">No overrides yet.</td></tr>';
    bindFlagStackHoverTooltips(wrap);
  }

  function ensureShippingOverridesHeader(bodyWrap) {
    try {
      var table = bodyWrap && bodyWrap.closest ? bodyWrap.closest('table') : null;
      var tr = table ? table.querySelector('thead tr') : null;
      if (!tr) return;
      var ths = Array.prototype.slice.call(tr.querySelectorAll('th') || []);
      var hasLabel = ths.some(function (th) { return String(th.textContent || '').trim().toLowerCase() === 'label'; });
      if (hasLabel) return;
      var onTh = ths.find ? ths.find(function (th) { return String(th.textContent || '').trim().toLowerCase() === 'on'; }) : null;
      var ref = onTh ? onTh.nextElementSibling : (ths[2] || null);
      var th = document.createElement('th');
      th.textContent = 'Label';
      if (ref) tr.insertBefore(th, ref);
      else tr.appendChild(th);
    } catch (_) {}
  }

  var shippingOverrideModalApi = null;
  function ensureShippingOverrideModal() {
    if (shippingOverrideModalApi) return shippingOverrideModalApi;
    var el = document.getElementById('cost-expenses-shipping-override-modal');
    if (!el) return null;
    var Bootstrap = window.bootstrap || (window.tabler && window.tabler.bootstrap);
    if (!(Bootstrap && Bootstrap.Modal)) return null;
    try {
      shippingOverrideModalApi = Bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, focus: true, keyboard: true });
    } catch (_) {
      shippingOverrideModalApi = null;
    }
    return shippingOverrideModalApi;
  }

  function renderShippingOverrideCountryChips(codes) {
    var chips = document.getElementById('cost-expenses-shipping-override-country-chips');
    if (!chips) return;
    var list = Array.isArray(codes) ? codes : [];
    var seen = {};
    var html = '';
    list.forEach(function (c) {
      var code = normalizeCountryCode(c);
      if (!code || seen[code]) return;
      seen[code] = true;
      var name = regionDisplayName(code) || '';
      var title = name ? (name + ' (' + code + ')') : code;
      html +=
        '<span class="badge bg-secondary-lt text-secondary kexo-country-chip" data-country-code="' + esc(code) + '" title="' + esc(title) + '">' +
          countryCodeToFlagHtml(code, name || code) +
          '<span class="kexo-country-chip-code">' + esc(code) + '</span>' +
          (name ? ('<span class="kexo-country-chip-name d-none d-md-inline">' + esc(name) + '</span>') : '') +
          '<button type="button" class="btn-close ms-1 kexo-country-chip-remove" aria-label="Remove ' + esc(code) + '" data-shipping-override-country-remove="' + esc(code) + '"></button>' +
        '</span>';
    });
    chips.innerHTML = html || '<span class="text-muted small">No countries selected.</span>';
  }

  function renderShippingOverrideCountrySuggest(query) {
    var el = document.getElementById('cost-expenses-shipping-override-country-suggest');
    if (!el) return;
    var items = buildCountrySuggestions(query, 12);
    try {
      var chips = document.getElementById('cost-expenses-shipping-override-country-chips');
      if (chips) {
        var selected = {};
        chips.querySelectorAll('[data-country-code]').forEach(function (chip) {
          var cc = normalizeCountryCode(chip.getAttribute('data-country-code'));
          if (cc) selected[cc] = true;
        });
        items = items.filter(function (it) { return it && it.code && !selected[it.code]; });
      }
    } catch (_) {}
    if (!items.length) {
      el.innerHTML = '';
      el.classList.add('is-hidden');
      return;
    }
    var html = '';
    items.forEach(function (it) {
      var label = (it.code || '') + (it.name ? (' — ' + it.name) : '');
      var flagHtml = countryCodeToFlagHtml(it.code, it.name || it.code);
      html +=
        '<button type="button" class="kexo-country-suggest-item" role="option" data-shipping-override-country-suggest-code="' + esc(it.code) + '" title="' + esc(label) + '">' +
          flagHtml +
          '<span class="kexo-country-suggest-code">' + esc(it.code) + '</span>' +
          (it.name ? ('<span class="kexo-country-suggest-name">' + esc(it.name) + '</span>') : '') +
        '</button>';
    });
    el.innerHTML = html;
    el.classList.remove('is-hidden');
  }

  function hideShippingOverrideCountrySuggest() {
    var el = document.getElementById('cost-expenses-shipping-override-country-suggest');
    if (el) { el.innerHTML = ''; el.classList.add('is-hidden'); }
  }

  function readShippingOverrideCountryCodesFromChips() {
    var chips = document.getElementById('cost-expenses-shipping-override-country-chips');
    var out = [];
    if (!chips) return out;
    chips.querySelectorAll('[data-country-code]').forEach(function (el) {
      var code = normalizeCountryCode(el.getAttribute('data-country-code'));
      if (code && out.indexOf(code) === -1) out.push(code);
    });
    return out;
  }

  function addShippingOverrideCountryFromText(rawText) {
    var code = resolveCountryCodeFromFreeText(rawText);
    if (!code) return { ok: false, error: 'Enter a valid country code or name (e.g. GB, CH, United Kingdom).' };
    var existing = readShippingOverrideCountryCodesFromChips();
    if (existing.indexOf(code) >= 0) return { ok: true };
    if (existing.length >= 64) return { ok: false, error: 'Maximum 64 countries per override.' };
    existing.push(code);
    existing.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    renderShippingOverrideCountryChips(existing);
    return { ok: true };
  }

  function showShippingOverrideForm(idx) {
    state.config = state.config || defaultConfig();
    state.config.shipping = readShippingFromUi();
    var overrides = (state.config.shipping && state.config.shipping.overrides) ? state.config.shipping.overrides : [];
    var ov = overrides[idx];
    if (!ov) return;
    document.getElementById('cost-expenses-shipping-override-idx').value = String(idx);
    document.getElementById('cost-expenses-shipping-override-priority').value = ov.priority || idx + 1;
    document.getElementById('cost-expenses-shipping-override-enabled').checked = ov.enabled !== false;
    document.getElementById('cost-expenses-shipping-override-label').value = (ov.label || '').trim();
    document.getElementById('cost-expenses-shipping-override-price').value = ov.priceGbp != null ? ov.priceGbp : 0;
    renderShippingOverrideCountryChips(ov.countries || []);
    var input = document.getElementById('cost-expenses-shipping-override-country-input');
    if (input) input.value = '';
    hideShippingOverrideCountrySuggest();
    var modal = ensureShippingOverrideModal();
    if (modal) modal.show();
  }

  function hideShippingOverrideForm() {
    var modal = ensureShippingOverrideModal();
    if (modal) modal.hide();
  }

  function saveShippingOverrideFromForm() {
    var idxEl = document.getElementById('cost-expenses-shipping-override-idx');
    var idx = parseInt(idxEl && idxEl.value, 10);
    if (!Number.isFinite(idx) || idx < 0) return;
    state.config = state.config || defaultConfig();
    if (!state.config.shipping) state.config.shipping = { enabled: false, worldwideDefaultGbp: 0, worldwideDefaultAmount: 0, worldwideDefaultCurrency: 'GBP', overrides: [] };
    if (!Array.isArray(state.config.shipping.overrides)) state.config.shipping.overrides = [];
    var ov = state.config.shipping.overrides[idx];
    if (!ov) return;
    var pri = parseInt(document.getElementById('cost-expenses-shipping-override-priority').value, 10) || 1;
    var en = document.getElementById('cost-expenses-shipping-override-enabled').checked !== false;
    var label = String((document.getElementById('cost-expenses-shipping-override-label').value || '').trim()).slice(0, 60);
    var price = parseFloat(document.getElementById('cost-expenses-shipping-override-price').value, 10) || 0;
    var countries = readShippingOverrideCountryCodesFromChips();
    ov.priority = pri;
    ov.enabled = en;
    ov.label = label;
    ov.priceGbp = price;
    ov.countries = countries;
    state.config.shipping.overrides.sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    hideShippingOverrideForm();
    renderShippingOverrides();
    markDraftChanged();
  }

  function readShippingFromUi() {
    var configOverrides = (state.config && state.config.shipping && state.config.shipping.overrides) ? state.config.shipping.overrides : [];
    var overrides = configOverrides.map(function (ov, idx) {
      return {
        priority: ov.priority || idx + 1,
        enabled: ov.enabled !== false,
        label: String(ov.label || '').trim().slice(0, 60),
        priceGbp: ov.priceGbp != null ? ov.priceGbp : 0,
        countries: Array.isArray(ov.countries) ? ov.countries.slice() : []
      };
    });
    overrides.sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); });
    var worldwideEl = document.getElementById('cost-expenses-shipping-worldwide');
    var currencyBtn = document.getElementById('cost-expenses-shipping-currency-btn');
    var shippingEnabledEl = document.getElementById('cost-expenses-shipping-enabled');
    var amount = worldwideEl ? parseFloat(worldwideEl.value, 10) || 0 : 0;
    var currency = (currencyBtn && currencyBtn.textContent) ? String(currencyBtn.textContent).trim().toUpperCase().slice(0, 8) : 'GBP';
    if (['GBP', 'EUR', 'USD'].indexOf(currency) === -1) currency = 'GBP';
    var enabled = shippingEnabledEl ? shippingEnabledEl.checked === true : false;
    return {
      enabled: enabled,
      worldwideDefaultGbp: currency === 'GBP' ? Math.max(0, amount) : (state.config && state.config.shipping && state.config.shipping.worldwideDefaultGbp != null ? state.config.shipping.worldwideDefaultGbp : 0),
      worldwideDefaultAmount: Math.max(0, amount),
      worldwideDefaultCurrency: currency,
      overrides: overrides
    };
  }

  function formatMoneyGbp(amount) {
    var n = Number(amount);
    if (!Number.isFinite(n)) return '—';
    try { if (typeof window.formatRevenue === 'function') return window.formatRevenue(n) || ('£' + n.toFixed(2)); } catch (_) {}
    return '£' + n.toFixed(2);
  }

  function fixedCostUnitLabel(freq) {
    var f = String(freq || '').trim().toLowerCase();
    if (f === 'weekly') return 'week';
    if (f === 'monthly') return 'month';
    if (f === 'yearly') return 'year';
    return 'day';
  }

  function formatYmdHuman(ymd) {
    var s = String(ymd || '').trim();
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s || '—';
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function scopeLabel(appliesTo) {
    var a = appliesTo && typeof appliesTo === 'object' ? appliesTo : {};
    if (a.mode === 'countries' && Array.isArray(a.countries) && a.countries.length) return a.countries.join(', ');
    return 'ALL';
  }

  function scopeFlagsHtml(appliesTo) {
    var a = appliesTo && typeof appliesTo === 'object' ? appliesTo : {};
    var codes = (a.mode === 'countries' && Array.isArray(a.countries) && a.countries.length) ? a.countries : [];
    return '<span class="kexo-scope-flags">' + countryCodesToFlagStackHtml(codes, codes.length ? 'Countries' : 'All countries') + '</span>';
  }

  function perOrderScopeFlagsHtml(ruleLike) {
    var r = ruleLike && typeof ruleLike === 'object' ? ruleLike : {};
    var codes = (r.country_scope === 'ALL' || !Array.isArray(r.country_scope) || !r.country_scope.length) ? [] : r.country_scope;
    return '<span class="kexo-scope-flags">' + countryCodesToFlagStackHtml(codes, codes.length ? 'Countries' : 'All countries') + '</span>';
  }

  function renderPerOrderRulesTable() {
    var tbody = document.getElementById('cost-expenses-per-order-table-body');
    if (!tbody) return;
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.per_order_rules)
      ? state.config.cost_expenses.per_order_rules
      : [];
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-muted">No per-order rules yet.</td></tr>';
      return;
    }
    var html = '';
    list.forEach(function (rule) {
      var r = rule && typeof rule === 'object' ? rule : {};
      var category = perOrderCategoryLabel(r.category);
      var breakdown = (r.breakdown_label || '').trim() || '—';
      var scope = (r.country_scope === 'ALL' || !Array.isArray(r.country_scope) || !r.country_scope.length) ? 'All' : r.country_scope.join(', ');
      var scopeFlags = perOrderScopeFlagsHtml(r);
      var start = String(r.effective_start || r.start_date || '').trim();
      var end = String(r.effective_end || r.end_date || '').trim();
      var starts = start && start === (ymdTodayLocal() || '') ? 'starts now' : (start ? ('starts ' + formatYmdHuman(start)) : 'starts now');
      var ends = end ? ('ends ' + formatYmdHuman(end)) : '';
      var effect = String(r.direction || '').trim().toLowerCase() === 'subtract' ? 'Credit' : 'Deduct';
      var summary = effect + ' ' + perOrderValueExpr(r) + ' · ' + scope + ' · ' + starts + (ends ? (' · ' + ends) : '');
      html += '<tr data-per-order-id="' + esc(rule.id) + '">' +
        '<td>' + esc(rule.name || 'Expense') + '</td>' +
        '<td>' + esc(category) + '</td>' +
        '<td>' + esc(breakdown) + '</td>' +
        '<td class="text-muted small">' + scopeFlags + esc(summary) + '</td>' +
        '<td class="text-end">' + esc(String(rule.sort != null ? rule.sort : '—')) + '</td>' +
        '<td class="text-center"><input type="checkbox" data-per-order-enabled data-per-order-id="' + esc(rule.id) + '" ' + (rule.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
          '<div class="d-inline-flex gap-1 flex-nowrap kexo-table-actions" aria-label="Rule actions">' +
            '<button type="button" class="btn btn-sm kexo-icon-action-btn" data-per-order-edit data-per-order-id="' + esc(rule.id) + '" aria-label="Edit rule" title="Edit">' +
              '<i data-icon-key="admin-tab-table-row-edit" aria-hidden="true"></i>' +
            '</button>' +
            '<button type="button" class="btn btn-danger btn-sm kexo-icon-action-btn" data-per-order-delete data-per-order-id="' + esc(rule.id) + '" aria-label="Delete rule" title="Delete">' +
              '<i data-icon-key="admin-tab-table-row-delete" aria-hidden="true"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
    bindFlagStackHoverTooltips(tbody);
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
        '<td>' + scopeFlagsHtml(o.appliesTo) + esc(scopeLabel(o.appliesTo)) + '</td>' +
        '<td class="text-center"><input type="checkbox" data-overhead-enabled data-overhead-id="' + esc(o.id) + '" ' + (o.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
          '<div class="d-inline-flex gap-1 flex-nowrap kexo-table-actions" aria-label="Overhead actions">' +
            '<button type="button" class="btn btn-sm kexo-icon-action-btn" data-overhead-edit data-overhead-id="' + esc(o.id) + '" aria-label="Edit overhead" title="Edit">' +
              '<i data-icon-key="admin-tab-table-row-edit" aria-hidden="true"></i>' +
            '</button>' +
            '<button type="button" class="btn btn-danger btn-sm kexo-icon-action-btn" data-overhead-delete data-overhead-id="' + esc(o.id) + '" aria-label="Delete overhead" title="Delete">' +
              '<i data-icon-key="admin-tab-table-row-delete" aria-hidden="true"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
    bindFlagStackHoverTooltips(tbody);
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
      var unit = fixedCostUnitLabel(f && f.frequency);
      var amt = (f && f.amount != null) ? f.amount : (f && f.amount_per_day != null ? f.amount_per_day : 0);
      html += '<tr data-fixed-cost-id="' + esc(f.id) + '">' +
        '<td>' + esc(f.name || 'Fixed cost') + '</td>' +
        '<td class="text-end">' + esc(formatMoneyGbp(amt)) + '/' + esc(unit) + '</td>' +
        '<td class="text-center"><input type="checkbox" data-fixed-cost-enabled data-fixed-cost-id="' + esc(f.id) + '" ' + (f.enabled ? 'checked' : '') + ' /></td>' +
        '<td class="text-end">' +
          '<div class="d-inline-flex gap-1 flex-nowrap kexo-table-actions" aria-label="Fixed cost actions">' +
            '<button type="button" class="btn btn-sm kexo-icon-action-btn" data-fixed-cost-edit data-fixed-cost-id="' + esc(f.id) + '" aria-label="Edit fixed cost" title="Edit">' +
              '<i data-icon-key="admin-tab-table-row-edit" aria-hidden="true"></i>' +
            '</button>' +
            '<button type="button" class="btn btn-danger btn-sm kexo-icon-action-btn" data-fixed-cost-delete data-fixed-cost-id="' + esc(f.id) + '" aria-label="Delete fixed cost" title="Delete">' +
              '<i data-icon-key="admin-tab-table-row-delete" aria-hidden="true"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  function buildConfigFromDom() {
    var cfg = state.config ? JSON.parse(JSON.stringify(state.config)) : defaultConfig();
    cfg.integrations = cfg.integrations || {};
    var ga = document.getElementById('cost-expenses-google-ads');
    var cogs = document.getElementById('cost-expenses-cost-of-goods');
    var pf = document.getElementById('cost-expenses-payment-fees');
    var ab = document.getElementById('cost-expenses-app-bills');
    var tax = document.getElementById('cost-expenses-tax');
    cfg.integrations.includeGoogleAdsSpend = !!(ga && ga.checked);
    cfg.integrations.includeCostOfGoods = !!(cogs && cogs.checked);
    cfg.integrations.includePaymentFees = !!(pf && pf.checked);
    cfg.integrations.includeShopifyAppBills = !!(ab && ab.checked);
    cfg.integrations.includeShopifyTaxes = !!(tax && tax.checked);
    if (!cfg.cost_expenses) cfg.cost_expenses = defaultCostExpensesModel();
    var perOrder = document.getElementById('cost-expenses-rules-per-order-enabled');
    var overheads = document.getElementById('cost-expenses-rules-overheads-enabled');
    var fixed = document.getElementById('cost-expenses-rules-fixed-enabled');
    cfg.cost_expenses.include_per_order_rules = !!(perOrder && perOrder.checked);
    cfg.cost_expenses.include_overheads = !!(overheads && overheads.checked);
    cfg.cost_expenses.include_fixed_costs = !!(fixed && fixed.checked);
    cfg.shipping = readShippingFromUi();
    var modeEl = document.getElementById('cost-expenses-rule-mode');
    cfg.cost_expenses.rule_mode = (modeEl && String(modeEl.value) === 'first_match') ? 'first_match' : 'stack';
    // Global enable: if any cost source is toggled on, profit KPIs can be computed.
    // (Historically this was coupled to a single "Custom Rules" toggle; we now derive it.)
    cfg.enabled = !!(
      cfg.integrations.includeGoogleAdsSpend ||
      cfg.integrations.includeCostOfGoods ||
      cfg.integrations.includePaymentFees ||
      cfg.integrations.includeShopifyAppBills ||
      cfg.integrations.includeShopifyTaxes ||
      (cfg.shipping && cfg.shipping.enabled === true) ||
      (cfg.cost_expenses && cfg.cost_expenses.include_per_order_rules) ||
      (cfg.cost_expenses && cfg.cost_expenses.include_overheads) ||
      (cfg.cost_expenses && cfg.cost_expenses.include_fixed_costs)
    );
    return cfg;
  }

  function applyConfigToInputs() {
    if (!state.config) return;
    var cfg = state.config;
    var googleAds = document.getElementById('cost-expenses-google-ads');
    var cogs = document.getElementById('cost-expenses-cost-of-goods');
    var paymentFees = document.getElementById('cost-expenses-payment-fees');
    var appBills = document.getElementById('cost-expenses-app-bills');
    var taxEl = document.getElementById('cost-expenses-tax');
    if (googleAds) googleAds.checked = !!(cfg.integrations && cfg.integrations.includeGoogleAdsSpend);
    if (cogs) cogs.checked = cfg.integrations && Object.prototype.hasOwnProperty.call(cfg.integrations, 'includeCostOfGoods')
      ? !!cfg.integrations.includeCostOfGoods
      : true;
    if (paymentFees) paymentFees.checked = !!(cfg.integrations && cfg.integrations.includePaymentFees);
    if (appBills) appBills.checked = !!(cfg.integrations && cfg.integrations.includeShopifyAppBills);
    if (taxEl) taxEl.checked = !!(cfg.integrations && cfg.integrations.includeShopifyTaxes);
    var perOrderEl = document.getElementById('cost-expenses-rules-per-order-enabled');
    var overheadsEl = document.getElementById('cost-expenses-rules-overheads-enabled');
    var fixedEl = document.getElementById('cost-expenses-rules-fixed-enabled');
    if (perOrderEl) perOrderEl.checked = !!(cfg.cost_expenses && cfg.cost_expenses.include_per_order_rules);
    if (overheadsEl) overheadsEl.checked = !!(cfg.cost_expenses && cfg.cost_expenses.include_overheads);
    if (fixedEl) fixedEl.checked = !!(cfg.cost_expenses && cfg.cost_expenses.include_fixed_costs);

    var worldwideEl = document.getElementById('cost-expenses-shipping-worldwide');
    var currencyBtn = document.getElementById('cost-expenses-shipping-currency-btn');
    var shippingEnabledEl = document.getElementById('cost-expenses-shipping-enabled');
    var amount = (cfg.shipping && cfg.shipping.worldwideDefaultAmount != null) ? cfg.shipping.worldwideDefaultAmount : ((cfg.shipping && cfg.shipping.worldwideDefaultGbp != null) ? cfg.shipping.worldwideDefaultGbp : 0);
    var currency = (cfg.shipping && cfg.shipping.worldwideDefaultCurrency) ? String(cfg.shipping.worldwideDefaultCurrency).trim().toUpperCase().slice(0, 8) : 'GBP';
    if (['GBP', 'EUR', 'USD'].indexOf(currency) === -1) currency = 'GBP';
    if (worldwideEl) worldwideEl.value = amount;
    if (currencyBtn) currencyBtn.textContent = currency;
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

  function perOrderCategoryLabel(category) {
    var c = String(category || '').trim().toLowerCase();
    if (c === 'tax_vat') return 'Tax / VAT';
    if (c === 'payment_fees') return 'Payment fees';
    if (c === 'packaging') return 'Packaging';
    if (c === 'handling') return 'Handling';
    if (c === 'fulfilment') return 'Fulfilment';
    if (c === 'insurance') return 'Insurance';
    return 'Other';
  }

  function perOrderRevenueBasisLabel(basis) {
    var b = String(basis || '').trim().toLowerCase();
    if (b === 'order_total_excl_tax' || b === 'excl_tax') return 'Order total excl tax';
    if (b === 'subtotal_excl_shipping' || b === 'excl_shipping') return 'Order total excl shipping';
    return 'Order total incl tax';
  }

  function setRadioValue(name, value) {
    var want = String(value || '');
    var els = root.querySelectorAll('input[type="radio"][name="' + String(name).replace(/"/g, '\\"') + '"]');
    for (var i = 0; i < els.length; i++) {
      if (!els[i]) continue;
      els[i].checked = String(els[i].value || '') === want;
    }
  }

  function readCheckedRadioValue(name) {
    var els = root.querySelectorAll('input[type="radio"][name="' + String(name).replace(/"/g, '\\"') + '"]');
    for (var i = 0; i < els.length; i++) {
      if (els[i] && els[i].checked === true) return String(els[i].value || '');
    }
    return '';
  }

  function countryCodeToFlagHtml(code, label) {
    var cc = normalizeCountryCode(code);
    var raw = cc ? String(cc).toLowerCase() : '';
    if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
      return '<span class="kexo-flag-fallback" aria-hidden="true"><i class="fa-light fa-globe"></i></span>';
    }
    var safeLabel = label != null ? escAttr(String(label)) : '';
    var titleAttr = safeLabel ? (' title="' + safeLabel + '"') : '';
    if (hasTablerFlagsCss()) {
      return '<span class="flag flag-xs kexo-flag-inline flag-country-' + escAttr(raw) + '"' + titleAttr + ' aria-hidden="true"></span>';
    }
    var cdn = 'https://cdn.jsdelivr.net/npm/@tabler/core@1.4.0/dist/img/flags/' + raw + '.svg';
    return '<img class="kexo-flag-img kexo-flag-inline" src="' + escAttr(cdn) + '" alt="" loading="lazy" decoding="async"' + titleAttr + ' aria-hidden="true" />';
  }

  function normalizeCountryCodesList(list, limit) {
    var max = Math.max(0, Math.min(128, parseInt(limit, 10) || 64));
    var arr = Array.isArray(list) ? list : [];
    var seen = {};
    var out = [];
    for (var i = 0; i < arr.length && out.length < max; i++) {
      var cc = normalizeCountryCode(arr[i]);
      if (!cc || seen[cc]) continue;
      seen[cc] = true;
      out.push(cc);
    }
    return out;
  }

  function buildCountryFlagsTooltipHtml(codes) {
    var list = normalizeCountryCodesList(codes, 64);
    if (!list.length) {
      return '<div class="kexo-flag-stack-tooltip-title">All countries</div>';
    }
    var items = '';
    list.forEach(function (cc) {
      var name = regionDisplayName(cc) || cc;
      var flagHtml = countryCodeToFlagHtml(cc, name);
      items += '<div class="kexo-flag-stack-tooltip-item">' + flagHtml + '<span class="kexo-flag-stack-tooltip-name">' + esc(name) + '</span></div>';
    });
    return '<div class="kexo-flag-stack-tooltip-list">' + items + '</div>';
  }

  function countryCodesToFlagStackHtml(codes, emptyAriaLabel) {
    var list = normalizeCountryCodesList(codes, 64);
    var show = list.slice(0, 3);
    var aria = list.length ? list.join(', ') : (String(emptyAriaLabel || 'All countries') || 'All countries');
    var cls = 'kexo-flag-stack kexo-flag-stack--' + (show.length || 0);
    var html = '<span class="' + cls + '" data-kexo-flag-stack="1" data-kexo-country-codes="' + escAttr(list.join(',')) + '" role="img" aria-label="' + escAttr(aria) + '" tabindex="0">';
    if (!show.length) {
      html += '<span class="kexo-flag-stack-item kexo-flag-stack-item--globe" aria-hidden="true"><i class="fa-light fa-globe"></i></span>';
      html += '</span>';
      return html;
    }
    for (var i = 0; i < show.length; i++) {
      var cc = show[i];
      var name = regionDisplayName(cc) || cc;
      var pos = (i === 0 ? 'is-1' : i === 1 ? 'is-2' : 'is-3');
      html += '<span class="kexo-flag-stack-item ' + pos + '">' + countryCodeToFlagHtml(cc, name) + '</span>';
    }
    html += '</span>';
    return html;
  }

  var _flagsPopoverEl = null;
  var _flagsPopoverBound = false;
  var _flagsPopoverTrigger = null;
  var _flagsPopoverHideTimer = null;

  function hideFlagsPopover() {
    if (_flagsPopoverHideTimer) {
      try { clearTimeout(_flagsPopoverHideTimer); } catch (_) {}
      _flagsPopoverHideTimer = null;
    }
    if (!_flagsPopoverEl) return;
    try { _flagsPopoverEl.hidden = true; } catch (_) {}
    try { _flagsPopoverEl.setAttribute('aria-expanded', 'false'); } catch (_) {}
    try { if (_flagsPopoverTrigger) _flagsPopoverTrigger.setAttribute('aria-expanded', 'false'); } catch (_) {}
    _flagsPopoverTrigger = null;
  }

  function ensureFlagsPopoverEl() {
    if (_flagsPopoverEl) return _flagsPopoverEl;
    _flagsPopoverEl = document.createElement('div');
    _flagsPopoverEl.id = 'kexo-flags-popover';
    _flagsPopoverEl.className = 'kexo-help-popover kexo-flags-popover';
    _flagsPopoverEl.setAttribute('role', 'tooltip');
    _flagsPopoverEl.hidden = true;
    _flagsPopoverEl.innerHTML = '<div class="kexo-help-popover-content"></div><button type="button" class="kexo-help-popover-close btn-close btn-close-white" aria-label="Close"></button>';
    document.body.appendChild(_flagsPopoverEl);
    try {
      _flagsPopoverEl.querySelector('.kexo-help-popover-close').addEventListener('click', hideFlagsPopover);
      _flagsPopoverEl.addEventListener('mouseenter', function () {
        if (_flagsPopoverHideTimer) {
          try { clearTimeout(_flagsPopoverHideTimer); } catch (_) {}
          _flagsPopoverHideTimer = null;
        }
      });
      _flagsPopoverEl.addEventListener('mouseleave', hideFlagsPopover);
    } catch (_) {}
    if (!_flagsPopoverBound) {
      _flagsPopoverBound = true;
      document.addEventListener('keydown', function (e) {
        if (e && e.key === 'Escape') hideFlagsPopover();
      });
      window.addEventListener('resize', hideFlagsPopover);
      document.addEventListener('scroll', hideFlagsPopover, true);
      document.addEventListener('mousedown', function (e) {
        if (!_flagsPopoverEl || _flagsPopoverEl.hidden) return;
        if (_flagsPopoverEl.contains(e.target)) return;
        if (_flagsPopoverTrigger && _flagsPopoverTrigger.contains && _flagsPopoverTrigger.contains(e.target)) return;
        hideFlagsPopover();
      });
    }
    return _flagsPopoverEl;
  }

  function showFlagsPopoverFor(triggerEl) {
    if (!triggerEl || !triggerEl.getAttribute) return;
    var raw = String(triggerEl.getAttribute('data-kexo-country-codes') || '').trim();
    var codes = raw ? raw.split(',').map(normalizeCountryCode).filter(Boolean) : [];
    if (codes.length <= 1) return;
    ensureFlagsPopoverEl();
    hideFlagsPopover();
    if (!_flagsPopoverEl) return;
    var content = _flagsPopoverEl.querySelector('.kexo-help-popover-content');
    if (content) content.innerHTML = buildCountryFlagsTooltipHtml(codes);
    _flagsPopoverEl.hidden = false;
    _flagsPopoverEl.setAttribute('aria-expanded', 'true');
    try { triggerEl.setAttribute('aria-expanded', 'true'); } catch (_) {}
    _flagsPopoverTrigger = triggerEl;
    try {
      var rect = triggerEl.getBoundingClientRect();
      var popRect = _flagsPopoverEl.getBoundingClientRect();
      var top = rect.top - popRect.height - 6;
      var left = rect.left + (rect.width / 2) - (popRect.width / 2);
      if (top < 8) top = rect.bottom + 6;
      if (left < 8) left = 8;
      if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
      _flagsPopoverEl.style.top = top + 'px';
      _flagsPopoverEl.style.left = left + 'px';
    } catch (_) {}
  }

  function scheduleHideFlagsPopover() {
    if (_flagsPopoverHideTimer) {
      try { clearTimeout(_flagsPopoverHideTimer); } catch (_) {}
      _flagsPopoverHideTimer = null;
    }
    _flagsPopoverHideTimer = setTimeout(function () {
      if (_flagsPopoverEl && !_flagsPopoverEl.matches(':hover')) hideFlagsPopover();
    }, 120);
  }

  function bindFlagStackHoverTooltips(container) {
    if (!container || !container.querySelectorAll) return;
    container.querySelectorAll('[data-kexo-flag-stack="1"]').forEach(function (el) {
      if (!el || !el.getAttribute || !el.addEventListener) return;
      if (el.getAttribute('data-kexo-flag-stack-bound') === '1') return;
      el.setAttribute('data-kexo-flag-stack-bound', '1');
      el.addEventListener('mouseenter', function () { showFlagsPopoverFor(el); });
      el.addEventListener('mouseleave', scheduleHideFlagsPopover);
      el.addEventListener('focus', function () { showFlagsPopoverFor(el); });
      el.addEventListener('blur', scheduleHideFlagsPopover);
    });
  }

  var __kexoRegionDisplayNames = null;
  function regionDisplayName(code) {
    var cc = normalizeCountryCode(code);
    if (!cc) return '';
    try {
      if (!__kexoRegionDisplayNames && typeof Intl !== 'undefined' && Intl.DisplayNames) {
        __kexoRegionDisplayNames = new Intl.DisplayNames(['en'], { type: 'region' });
      }
      if (__kexoRegionDisplayNames && typeof __kexoRegionDisplayNames.of === 'function') {
        var name = __kexoRegionDisplayNames.of(cc);
        return name ? String(name) : '';
      }
    } catch (_) {}
    if (cc === 'GB') return 'United Kingdom';
    return '';
  }

  var __kexoRegionCodes = null;
  function getRegionCodes() {
    if (__kexoRegionCodes) return __kexoRegionCodes.slice();
    var out = [];
    try {
      if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
        out = Intl.supportedValuesOf('region') || [];
      }
    } catch (_) {
      out = [];
    }
    // Robust fallback: some browsers/environments lack Intl.supportedValuesOf('region').
    // Use a complete ISO-3166 alpha-2 list so all countries are selectable.
    var ISO3166_ALPHA2_FALLBACK = [
      'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
      'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
      'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
      'DE','DJ','DK','DM','DO','DZ',
      'EC','EE','EG','EH','ER','ES','ET',
      'FI','FJ','FK','FM','FO','FR',
      'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
      'HK','HM','HN','HR','HT','HU',
      'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM','JO','JP',
      'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
      'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
      'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
      'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
      'OM',
      'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
      'QA',
      'RE','RO','RS','RU','RW',
      'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
      'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
      'UA','UG','UM','US','UY','UZ',
      'VA','VC','VE','VG','VI','VN','VU',
      'WF','WS',
      'YE','YT',
      'ZA','ZM','ZW',
    ];
    if (!Array.isArray(out) || !out.length) out = ISO3166_ALPHA2_FALLBACK.slice();
    // Merge in fallback to guard against partial Intl lists (rare).
    try {
      if (Array.isArray(out) && out.length) {
        var merged = out.slice();
        ISO3166_ALPHA2_FALLBACK.forEach(function (cc) { merged.push(cc); });
        out = merged;
      }
    } catch (_) {}
    var seen = {};
    var cleaned = [];
    out.forEach(function (c) {
      var cc = normalizeCountryCode(c);
      if (!cc || seen[cc]) return;
      if (!/^[A-Z]{2}$/.test(cc)) return;
      seen[cc] = true;
      cleaned.push(cc);
    });
    cleaned.sort(function (a, b) { return a.localeCompare(b); });
    __kexoRegionCodes = cleaned.slice();
    return __kexoRegionCodes.slice();
  }

  function buildCountrySuggestions(query, limit) {
    var qRaw = query == null ? '' : String(query);
    var q = qRaw.trim().toLowerCase();
    var max = Math.max(1, Math.min(50, parseInt(limit, 10) || 12));
    var codes = getRegionCodes();
    var scored = [];

    // Alias: UK → GB (common user expectation)
    if (q === 'uk') q = 'gb';

    // Default suggestions when empty.
    var preferred = ['GB', 'IE', 'US', 'CA', 'AU', 'NZ', 'FR', 'DE', 'ES', 'IT', 'NL'];
    if (!q) {
      preferred.forEach(function (cc) {
        var name = regionDisplayName(cc) || '';
        scored.push({ code: cc, name: name, score: 0 });
      });
    } else {
      codes.forEach(function (cc) {
        var name = regionDisplayName(cc) || '';
        var codeLc = cc.toLowerCase();
        var nameLc = name.toLowerCase();
        var score = 9999;
        if (codeLc === q) score = 0;
        else if (codeLc.indexOf(q) === 0) score = 1;
        else if (nameLc.indexOf(q) === 0) score = 2;
        else if (nameLc.indexOf(q) >= 0) score = 3;
        if (score < 9999) scored.push({ code: cc, name: name, score: score });
      });
    }

    var seen = {};
    var out = [];
    scored.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      if (a.code !== b.code) return a.code.localeCompare(b.code);
      return 0;
    });
    for (var i = 0; i < scored.length && out.length < max; i++) {
      var item = scored[i];
      if (!item || !item.code || seen[item.code]) continue;
      seen[item.code] = true;
      out.push({ code: item.code, name: item.name || '' });
    }
    return out;
  }

  function renderCountrySuggestList(query) {
    var el = document.getElementById('cost-expenses-per-order-country-suggest');
    if (!el) return;
    var items = buildCountrySuggestions(query, 12);
    // Hide already-selected countries from suggestions.
    try {
      var chips = document.getElementById('cost-expenses-per-order-country-chips');
      if (chips) {
        var selected = {};
        chips.querySelectorAll('[data-country-code]').forEach(function (chip) {
          var cc = normalizeCountryCode(chip.getAttribute('data-country-code'));
          if (cc) selected[cc] = true;
        });
        items = items.filter(function (it) { return it && it.code && !selected[it.code]; });
      }
    } catch (_) {}
    if (!items.length) {
      el.innerHTML = '';
      el.classList.add('is-hidden');
      return;
    }
    var html = '';
    items.forEach(function (it) {
      var label = (it.code || '') + (it.name ? (' — ' + it.name) : '');
      var flagHtml = countryCodeToFlagHtml(it.code, it.name || it.code);
      html +=
        '<button type="button" class="kexo-country-suggest-item" role="option" data-ce-country-suggest-code="' + esc(it.code) + '" title="' + esc(label) + '">' +
          flagHtml +
          '<span class="kexo-country-suggest-code">' + esc(it.code) + '</span>' +
          (it.name ? ('<span class="kexo-country-suggest-name">' + esc(it.name) + '</span>') : '') +
        '</button>';
    });
    el.innerHTML = html;
    el.classList.remove('is-hidden');
  }

  function hideCountrySuggestList() {
    var el = document.getElementById('cost-expenses-per-order-country-suggest');
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('is-hidden');
  }

  function readPerOrderCountryCodesFromChips() {
    var chips = document.getElementById('cost-expenses-per-order-country-chips');
    var out = [];
    if (!chips) return out;
    chips.querySelectorAll('[data-country-code]').forEach(function (el) {
      var code = normalizeCountryCode(el.getAttribute('data-country-code'));
      if (code && out.indexOf(code) === -1) out.push(code);
    });
    return out;
  }

  function setPerOrderCountryCodes(next) {
    var list = Array.isArray(next) ? next : [];
    var seen = {};
    var codes = [];
    list.forEach(function (c) {
      var cc = normalizeCountryCode(c);
      if (!cc || seen[cc]) return;
      seen[cc] = true;
      codes.push(cc);
    });
    codes.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    renderPerOrderCountryChips(codes);
    var hidden = document.getElementById('cost-expenses-per-order-country');
    if (hidden) hidden.value = codes.join(',');
  }

  function resolveCountryCodeFromFreeText(rawText) {
    var raw = rawText == null ? '' : String(rawText).trim();
    if (!raw) return '';
    // If the user typed an ISO2 code (or a code prefix like "GB — United Kingdom"), use that.
    if (/^[A-Za-z]{2}(\b|[^A-Za-z])/.test(raw)) {
      var cc = normalizeCountryCode(raw);
      var all = getRegionCodes();
      if (cc && all.indexOf(cc) >= 0) return cc;
      // Allow UK alias even if Intl list is missing GB for some reason.
      if (cc === 'GB') return 'GB';
    }
    // Otherwise, treat as a name search and take the best match.
    var best = buildCountrySuggestions(raw, 1);
    return best && best[0] && best[0].code ? String(best[0].code) : '';
  }

  function maybeSuggestVatBreakdownLabel(countryCodes) {
    try {
      var catEl = document.getElementById('cost-expenses-per-order-category');
      var blEl = document.getElementById('cost-expenses-per-order-breakdown-label');
      var cat = catEl ? String(catEl.value || '').trim().toLowerCase() : '';
      var cur = blEl ? String(blEl.value || '').trim() : '';
      var list = Array.isArray(countryCodes) ? countryCodes : [];
      if (cat === 'tax_vat' && blEl && (!cur || cur === 'VAT' || cur === 'UK VAT')) {
        blEl.value = (list.length === 1 && list[0] === 'GB') ? 'UK VAT' : 'VAT';
      }
    } catch (_) {}
  }

  function addPerOrderCountryFromText(rawText) {
    var code = resolveCountryCodeFromFreeText(rawText);
    if (!code) {
      return { ok: false, error: 'Pick a country from the list, or enter a valid ISO2 code (e.g. GB).' };
    }
    var existing = readPerOrderCountryCodesFromChips();
    if (existing.indexOf(code) === -1) existing.push(code);
    existing.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    setPerOrderCountryCodes(existing);
    maybeSuggestVatBreakdownLabel(existing);
    hideCountrySuggestList();
    return { ok: true, codes: existing };
  }

  function renderPerOrderCountryChips(codes) {
    var chips = document.getElementById('cost-expenses-per-order-country-chips');
    if (!chips) return;
    var list = Array.isArray(codes) ? codes : [];
    var seen = {};
    var html = '';
    list.forEach(function (c) {
      var code = normalizeCountryCode(c);
      if (!code || seen[code]) return;
      seen[code] = true;
      var name = regionDisplayName(code) || '';
      var title = name ? (name + ' (' + code + ')') : code;
      html +=
        '<span class="badge bg-secondary-lt text-secondary kexo-country-chip" data-country-code="' + esc(code) + '" title="' + esc(title) + '">' +
          countryCodeToFlagHtml(code, name || code) +
          '<span class="kexo-country-chip-code">' + esc(code) + '</span>' +
          (name ? ('<span class="kexo-country-chip-name d-none d-md-inline">' + esc(name) + '</span>') : '') +
          '<button type="button" class="btn-close ms-1 kexo-country-chip-remove" aria-label="Remove ' + esc(code) + '" data-country-remove="' + esc(code) + '"></button>' +
        '</span>';
    });
    chips.innerHTML = html || '<span class="text-muted small">No countries selected.</span>';
  }

  function readPerOrderCountryScopeFromUi() {
    var mode = readCheckedRadioValue('cost-expenses-per-order-country-mode') || 'all';
    if (mode !== 'countries') return { ok: true, scope: 'ALL', countries: [] };
    var chips = document.getElementById('cost-expenses-per-order-country-chips');
    var codes = [];
    if (chips) {
      chips.querySelectorAll('[data-country-code]').forEach(function (el) {
        var code = normalizeCountryCode(el.getAttribute('data-country-code'));
        if (code && codes.indexOf(code) === -1) codes.push(code);
      });
    }
    if (!codes.length) return { ok: false, error: 'Select at least one country (or choose All countries).' };
    return { ok: true, scope: codes.slice(0, 64), countries: codes.slice(0, 64) };
  }

  function syncPerOrderDatesUi() {
    var startMode = readCheckedRadioValue('cost-expenses-per-order-start-mode') || 'now';
    var endMode = readCheckedRadioValue('cost-expenses-per-order-end-mode') || 'never';
    var startDate = document.getElementById('cost-expenses-per-order-start-date');
    var endDate = document.getElementById('cost-expenses-per-order-end-date');
    if (startDate) startDate.classList.toggle('is-hidden', startMode !== 'date');
    if (endDate) endDate.classList.toggle('is-hidden', endMode !== 'date');
  }

  function syncPerOrderCountryUi() {
    var mode = readCheckedRadioValue('cost-expenses-per-order-country-mode') || 'all';
    var wrap = document.getElementById('cost-expenses-per-order-country-selected-wrap');
    if (wrap) wrap.classList.toggle('is-hidden', mode !== 'countries');
    if (mode !== 'countries') hideCountrySuggestList();
    var catEl = document.getElementById('cost-expenses-per-order-category');
    var nudgeEl = document.getElementById('cost-expenses-per-order-country-nudge');
    var cat = catEl ? String(catEl.value || '').trim().toLowerCase() : '';
    if (nudgeEl) nudgeEl.classList.toggle('is-hidden', !(cat === 'tax_vat' && mode !== 'countries'));
  }

  function syncPerOrderKindUi() {
    var kindEl = document.getElementById('cost-expenses-per-order-kind');
    var basisWrap = document.getElementById('cost-expenses-per-order-revenue-basis-wrap');
    var valueLabel = document.getElementById('cost-expenses-per-order-value-label');
    var valueEl = document.getElementById('cost-expenses-per-order-value');
    var warnEl = document.getElementById('cost-expenses-per-order-value-warn');
    if (!kindEl || !basisWrap || !valueLabel || !valueEl) return;

    var kind = String(kindEl.value || '').trim().toLowerCase();
    var isPercent = kind === 'percent_of_revenue';
    basisWrap.classList.toggle('is-hidden', !isPercent);

    var labelText = isPercent
      ? 'Percentage (%)'
      : (kind === 'fixed_per_item' ? 'Amount per item (£)' : 'Amount per order (£)');
    var helpText = isPercent
      ? 'This percentage is applied to the selected revenue basis (use Effect to choose deduct vs credit).'
      : (kind === 'fixed_per_item'
        ? 'This amount is applied for each item (legacy). Use Effect to choose deduct vs credit.'
        : 'This amount is applied to every matched order (use Effect to choose deduct vs credit).');
    valueEl.placeholder = isPercent ? '20' : (kind === 'fixed_per_item' ? '0.10' : '0.35');

    // Keep the Settings help popover trigger stable and update its content.
    var trigger = valueLabel.querySelector('.kexo-icon-help-trigger');
    if (trigger) {
      try {
        Array.prototype.slice.call(valueLabel.childNodes || []).forEach(function (n) {
          if (n !== trigger) valueLabel.removeChild(n);
        });
        valueLabel.insertBefore(document.createTextNode(labelText + ' '), trigger);
      } catch (_) {}
      try { trigger.setAttribute('data-kexo-help', helpText); } catch (_) {}
      try { trigger.setAttribute('aria-label', 'Help: ' + labelText); } catch (_) {}
      try {
        var BootstrapRef = window.bootstrap || (window.tabler && window.tabler.bootstrap);
        if (BootstrapRef && BootstrapRef.Popover && BootstrapRef.Popover.getInstance && BootstrapRef.Popover.getInstance(trigger)) {
          BootstrapRef.Popover.getInstance(trigger).dispose();
        }
        trigger.removeAttribute('data-kexo-help-bound');
        if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(valueLabel);
      } catch (_) {}
    } else {
      // Fallback: rely on title → help popover migration.
      try {
        valueLabel.textContent = labelText + ' ';
        valueLabel.setAttribute('title', helpText);
        if (typeof window.migrateTitleToHelpPopover === 'function') window.migrateTitleToHelpPopover(valueLabel);
        if (typeof window.initKexoHelpPopovers === 'function') window.initKexoHelpPopovers(valueLabel);
      } catch (_) {}
    }

    if (warnEl) {
      warnEl.classList.add('is-hidden');
      warnEl.textContent = '';
      if (isPercent) {
        var v = parseFloat(valueEl.value, 10);
        if (Number.isFinite(v) && v > 1000) {
          warnEl.textContent = 'That’s an unusually high percentage. If this is intentional, you can still save it.';
          warnEl.classList.remove('is-hidden');
        }
      }
    }
  }

  function perOrderFormatPercent(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '0%';
    return n.toFixed(2).replace(/\.00$/, '') + '%';
  }

  function perOrderValueExpr(rule) {
    var r = rule && typeof rule === 'object' ? rule : {};
    var kind = String(r.kind || '').trim().toLowerCase();
    var v = Number(r.value);
    var amount = Number.isFinite(v) ? v : 0;
    if (kind === 'percent_of_revenue') return perOrderFormatPercent(amount) + ' of ' + perOrderRevenueBasisLabel(r.revenue_basis);
    if (kind === 'fixed_per_item') return formatMoneyGbp(amount) + ' per item';
    return formatMoneyGbp(amount) + ' per order';
  }

  function perOrderScopeLabel(rule) {
    var r = rule && typeof rule === 'object' ? rule : {};
    if (r.country_scope === 'ALL' || !Array.isArray(r.country_scope) || !r.country_scope.length) return 'All';
    return r.country_scope.join(', ');
  }

  function perOrderDatesLabel(rule) {
    var r = rule && typeof rule === 'object' ? rule : {};
    var now = ymdTodayLocal() || '';
    var s = String(r.effective_start || r.start_date || '').trim();
    var e = String(r.effective_end || r.end_date || '').trim();
    var starts = (!s || (now && s === now)) ? 'starts now' : ('starts ' + s);
    var ends = e ? ('ends ' + e) : 'never ends';
    return starts + ', ' + ends;
  }

  function updatePerOrderLiveSummary() {
    var el = document.getElementById('cost-expenses-per-order-live-summary');
    if (!el) return;
    var parsed = readPerOrderForm({ allowDraft: true });
    if (!parsed.ok) {
      el.textContent = parsed.error || 'Summary will appear here.';
      return;
    }
    var r = parsed.rule;
    el.textContent =
      'Category: ' + perOrderCategoryLabel(r.category) +
      ' - ' +
      (String(r.direction || '').trim().toLowerCase() === 'subtract' ? 'Credits ' : 'Deducts ') +
      perOrderValueExpr(r) +
      ' (' + perOrderScopeLabel(r) + ', ' + perOrderDatesLabel(r) + ')';
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

  var perOrderModalApi = null;
  var perOrderModalWired = false;
  function ensurePerOrderModal() {
    if (perOrderModalApi) return perOrderModalApi;
    var el = document.getElementById('cost-expenses-per-order-modal');
    if (!el) return null;
    var Bootstrap = window.bootstrap || (window.tabler && window.tabler.bootstrap);
    if (!(Bootstrap && Bootstrap.Modal)) return null;
    try {
      perOrderModalApi = Bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, focus: true, keyboard: true });
    } catch (_) {
      perOrderModalApi = null;
    }
    if (perOrderModalApi && !perOrderModalWired) {
      perOrderModalWired = true;
      try {
        el.addEventListener('hidden.bs.modal', function () {
          try { state.editingPerOrderId = ''; } catch (_) {}
          try { setSectionMsg('cost-expenses-per-order-msg', '', null); } catch (_) {}
        });
      } catch (_) {}
    }
    return perOrderModalApi;
  }

  var overheadModalApi = null;
  var overheadModalWired = false;
  function ensureOverheadModal() {
    if (overheadModalApi) return overheadModalApi;
    var Bootstrap = window.bootstrap || (window.tabler && window.tabler.bootstrap);
    if (!(Bootstrap && Bootstrap.Modal)) return null;
    var el = document.getElementById('cost-expenses-overhead-modal');
    if (!el) {
      try {
        el = document.createElement('div');
        el.className = 'modal modal-blur fade';
        el.id = 'cost-expenses-overhead-modal';
        el.tabIndex = -1;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
          '<div class="modal-dialog modal-lg modal-dialog-centered" role="dialog">' +
            '<div class="modal-content">' +
              '<div class="modal-header">' +
                '<h5 class="modal-title" id="cost-expenses-overhead-modal-title">Overhead</h5>' +
                '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
              '</div>' +
              '<div class="modal-body" id="cost-expenses-overheads-modal-body"></div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(el);
      } catch (_) {
        el = null;
      }
      try {
        var body = el ? el.querySelector('#cost-expenses-overheads-modal-body') : null;
        var msg = document.getElementById('cost-expenses-overheads-msg');
        var form = document.getElementById('cost-expenses-overheads-form-wrap');
        if (msg && body) body.appendChild(msg);
        if (form && body) body.appendChild(form);
        if (form) form.classList.remove('is-hidden');
      } catch (_) {}
    }
    if (!el) return null;
    try {
      overheadModalApi = Bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, focus: true, keyboard: true });
    } catch (_) {
      overheadModalApi = null;
    }
    if (overheadModalApi && !overheadModalWired) {
      overheadModalWired = true;
      try {
        el.addEventListener('hidden.bs.modal', function () {
          try { state.editingOverheadId = ''; } catch (_) {}
          try { setSectionMsg('cost-expenses-overheads-msg', '', null); } catch (_) {}
          try {
            var form = document.getElementById('cost-expenses-overheads-form-wrap');
            if (form) form.classList.add('is-hidden');
          } catch (_) {}
        });
      } catch (_) {}
    }
    return overheadModalApi;
  }

  var fixedCostModalApi = null;
  var fixedCostModalWired = false;
  function ensureFixedCostModal() {
    if (fixedCostModalApi) return fixedCostModalApi;
    var Bootstrap = window.bootstrap || (window.tabler && window.tabler.bootstrap);
    if (!(Bootstrap && Bootstrap.Modal)) return null;
    var el = document.getElementById('cost-expenses-fixed-cost-modal');
    if (!el) {
      try {
        el = document.createElement('div');
        el.className = 'modal modal-blur fade';
        el.id = 'cost-expenses-fixed-cost-modal';
        el.tabIndex = -1;
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-hidden', 'true');
        el.innerHTML =
          '<div class="modal-dialog modal-lg modal-dialog-centered" role="dialog">' +
            '<div class="modal-content">' +
              '<div class="modal-header">' +
                '<h5 class="modal-title" id="cost-expenses-fixed-cost-modal-title">Fixed cost</h5>' +
                '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
              '</div>' +
              '<div class="modal-body" id="cost-expenses-fixed-costs-modal-body"></div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(el);
      } catch (_) {
        el = null;
      }
      try {
        var body = el ? el.querySelector('#cost-expenses-fixed-costs-modal-body') : null;
        var msg = document.getElementById('cost-expenses-fixed-costs-msg');
        var form = document.getElementById('cost-expenses-fixed-cost-form-wrap');
        if (msg && body) body.appendChild(msg);
        if (form && body) body.appendChild(form);
        if (form) form.classList.remove('is-hidden');
      } catch (_) {}
    }
    if (!el) return null;
    try {
      fixedCostModalApi = Bootstrap.Modal.getOrCreateInstance(el, { backdrop: true, focus: true, keyboard: true });
    } catch (_) {
      fixedCostModalApi = null;
    }
    if (fixedCostModalApi && !fixedCostModalWired) {
      fixedCostModalWired = true;
      try {
        el.addEventListener('hidden.bs.modal', function () {
          try { state.editingFixedCostId = ''; } catch (_) {}
          try { setSectionMsg('cost-expenses-fixed-costs-msg', '', null); } catch (_) {}
          try {
            var form = document.getElementById('cost-expenses-fixed-cost-form-wrap');
            if (form) form.classList.add('is-hidden');
          } catch (_) {}
        });
      } catch (_) {}
    }
    return fixedCostModalApi;
  }

  function showPerOrderForm(rule) {
    state.editingPerOrderId = rule ? String(rule.id) : '';
    var titleEl = document.getElementById('cost-expenses-per-order-modal-title');
    if (titleEl) titleEl.textContent = rule ? 'Edit per-order rule' : 'Add per-order rule';

    document.getElementById('cost-expenses-per-order-id').value = state.editingPerOrderId;
    document.getElementById('cost-expenses-per-order-category').value = rule ? (rule.category || 'other') : 'other';
    document.getElementById('cost-expenses-per-order-name').value = rule ? (rule.name || '') : '';
    document.getElementById('cost-expenses-per-order-breakdown-label').value = rule ? (rule.breakdown_label || '') : '';

    var kindEl = document.getElementById('cost-expenses-per-order-kind');
    var kind = rule ? (rule.kind || '') : '';
    var k = String(kind || '').trim().toLowerCase();
    if (!k && rule && rule.type) {
      k = String(rule.type || '').trim().toLowerCase() === 'fixed_per_order' ? 'fixed_per_order'
        : String(rule.type || '').trim().toLowerCase() === 'fixed_per_item' ? 'fixed_per_item'
        : 'percent_of_revenue';
    }
    if (k === 'fixed_per_item' && kindEl && !kindEl.querySelector('option[value="fixed_per_item"]')) {
      kindEl.insertAdjacentHTML('beforeend', '<option value="fixed_per_item">Fixed - per item (legacy)</option>');
    }
    if (kindEl) kindEl.value = (k === 'percent_of_revenue' || k === 'fixed_per_order' || k === 'fixed_per_item') ? k : 'fixed_per_order';

    document.getElementById('cost-expenses-per-order-direction').value =
      rule && String(rule.direction || '').trim().toLowerCase() === 'subtract' ? 'subtract' : 'add';
    document.getElementById('cost-expenses-per-order-value').value = rule && rule.value != null ? rule.value : '';
    document.getElementById('cost-expenses-per-order-revenue-basis').value = rule ? (rule.revenue_basis || 'order_total_incl_tax') : 'order_total_incl_tax';

    var nowYmd = ymdTodayLocal() || '';
    var start = rule ? (rule.effective_start || rule.start_date || '') : '';
    var end = rule ? (rule.effective_end || rule.end_date || '') : '';
    if (!start) start = nowYmd;
    setRadioValue('cost-expenses-per-order-start-mode', start === nowYmd ? 'now' : 'date');
    document.getElementById('cost-expenses-per-order-start-date').value = start || nowYmd;
    setRadioValue('cost-expenses-per-order-end-mode', end ? 'date' : 'never');
    document.getElementById('cost-expenses-per-order-end-date').value = end || '';

    var codes = [];
    if (rule && Array.isArray(rule.country_scope)) codes = rule.country_scope.slice(0, 64);
    else if (rule && rule.appliesTo && rule.appliesTo.mode === 'countries' && Array.isArray(rule.appliesTo.countries)) codes = rule.appliesTo.countries.slice(0, 64);
    setRadioValue('cost-expenses-per-order-country-mode', codes.length ? 'countries' : 'all');
    renderPerOrderCountryChips(codes);
    document.getElementById('cost-expenses-per-order-country').value = codes.length ? codes.join(',') : '';
    var list = state.config && state.config.cost_expenses && Array.isArray(state.config.cost_expenses.per_order_rules)
      ? state.config.cost_expenses.per_order_rules
      : [];
    document.getElementById('cost-expenses-per-order-sort').value = rule && rule.sort != null ? rule.sort : (list.length + 1);
    document.getElementById('cost-expenses-per-order-enabled').checked = rule ? (rule.enabled !== false) : true;

    syncPerOrderDatesUi();
    syncPerOrderCountryUi();
    syncPerOrderKindUi();
    setPerOrderPreviewRangeUi('7d');
    setPerOrderPreviewText('Estimated impact will appear here.');
    updatePerOrderLiveSummary();
    setSectionMsg('cost-expenses-per-order-msg', '', null);

    var modal = ensurePerOrderModal();
    if (modal) {
      try { modal.show(); } catch (_) {}
    }
  }

  function hidePerOrderForm() {
    state.editingPerOrderId = '';
    setSectionMsg('cost-expenses-per-order-msg', '', null);
    var modal = ensurePerOrderModal();
    if (modal) {
      try { modal.hide(); } catch (_) {}
    }
  }

  function readPerOrderForm(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var category = String(document.getElementById('cost-expenses-per-order-category').value || 'other').trim().toLowerCase();
    if (['tax_vat', 'payment_fees', 'packaging', 'handling', 'fulfilment', 'insurance', 'other'].indexOf(category) === -1) category = 'other';

    var name = (document.getElementById('cost-expenses-per-order-name').value || '').trim();
    if (!name) return { ok: false, error: 'Rule name is required' };

    var breakdownLabel = (document.getElementById('cost-expenses-per-order-breakdown-label').value || '').trim();

    var kind = String(document.getElementById('cost-expenses-per-order-kind').value || 'fixed_per_order').trim().toLowerCase();
    if (kind !== 'fixed_per_order' && kind !== 'percent_of_revenue' && kind !== 'fixed_per_item') kind = 'fixed_per_order';

    var direction = String(document.getElementById('cost-expenses-per-order-direction').value || 'add').trim().toLowerCase();
    if (direction !== 'add' && direction !== 'subtract') direction = 'add';

    var value = parseFloat(document.getElementById('cost-expenses-per-order-value').value, 10);
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'Value must be ≥ 0' };

    var revenueBasis = String(document.getElementById('cost-expenses-per-order-revenue-basis').value || 'order_total_incl_tax').trim();
    if (['order_total_incl_tax', 'order_total_excl_tax', 'subtotal_excl_shipping'].indexOf(revenueBasis) === -1) revenueBasis = 'order_total_incl_tax';
    if (kind === 'percent_of_revenue' && !revenueBasis) return { ok: false, error: 'Revenue basis is required for percent rules' };

    var nowYmd = ymdTodayLocal() || '';
    var startMode = readCheckedRadioValue('cost-expenses-per-order-start-mode') || 'now';
    var startYmd = startMode === 'date'
      ? String(document.getElementById('cost-expenses-per-order-start-date').value || '').trim()
      : nowYmd;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) return { ok: false, error: 'Start date is required' };

    var endMode = readCheckedRadioValue('cost-expenses-per-order-end-mode') || 'never';
    var endYmd = endMode === 'date'
      ? String(document.getElementById('cost-expenses-per-order-end-date').value || '').trim()
      : '';
    if (endYmd && !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return { ok: false, error: 'End date must be a date' };
    if (endYmd && endYmd < startYmd) return { ok: false, error: 'End date cannot be earlier than start date' };

    var country = readPerOrderCountryScopeFromUi();
    if (!country.ok) return { ok: false, error: country.error };

    var sort = Math.max(1, parseInt(document.getElementById('cost-expenses-per-order-sort').value, 10) || 1);
    var enabled = document.getElementById('cost-expenses-per-order-enabled').checked === true;

    if (!breakdownLabel) {
      if (category === 'tax_vat') breakdownLabel = (country.countries.length === 1 && country.countries[0] === 'GB') ? 'UK VAT' : 'VAT';
      else if (category === 'payment_fees') breakdownLabel = 'Payment fees';
      else if (category === 'packaging') breakdownLabel = 'Packaging';
      else if (category === 'handling') breakdownLabel = 'Handling';
      else if (category === 'fulfilment') breakdownLabel = 'Fulfilment';
      else if (category === 'insurance') breakdownLabel = 'Insurance';
      else breakdownLabel = name;
    }

    var id = state.editingPerOrderId || ('por_' + Date.now());
    var rawRule = {
      id: id,
      category: category,
      name: name,
      breakdown_label: breakdownLabel,
      kind: kind,
      direction: direction,
      value: value,
      revenue_basis: revenueBasis,
      effective_start: startYmd,
      effective_end: endYmd || null,
      country_scope: country.scope,
      enabled: enabled,
      sort: sort,
    };
    var normalized = normalizePerOrderRule(rawRule, 0);
    if (o.allowDraft) return { ok: true, rule: normalized };
    return { ok: true, rule: normalized };
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
    setSectionMsg('cost-expenses-per-order-msg', 'Saving…', null);
    markDraftChanged();
    saveCostExpensesToApi().then(function (res) {
      if (res && res.ok === true) setSectionMsg('cost-expenses-per-order-msg', 'Saved.', true);
      else setSectionMsg('cost-expenses-per-order-msg', 'Save failed. Your rule is kept in draft; use Save Settings below to retry.', false);
    });
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
    var modal = ensureOverheadModal();
    var titleEl = document.getElementById('cost-expenses-overhead-modal-title');
    if (titleEl) titleEl.textContent = overhead ? 'Edit overhead' : 'Add overhead';
    try {
      var wrap = document.getElementById('cost-expenses-overheads-form-wrap');
      if (wrap) wrap.classList.remove('is-hidden');
    } catch (_) {}

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

    if (modal) {
      try { modal.show(); } catch (_) {}
    }
  }

  function hideOverheadForm() {
    state.editingOverheadId = '';
    setSectionMsg('cost-expenses-overheads-msg', '', null);
    var modal = ensureOverheadModal();
    if (modal) {
      try { modal.hide(); } catch (_) {}
    }
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
    setSectionMsg('cost-expenses-overheads-msg', 'Saving…', null);
    markDraftChanged();
    saveCostExpensesToApi().then(function (res) {
      if (res && res.ok === true) setSectionMsg('cost-expenses-overheads-msg', 'Saved.', true);
      else setSectionMsg('cost-expenses-overheads-msg', 'Save failed. Your overhead is kept in draft; use Save Settings below to retry.', false);
    });
  }

  function showFixedCostForm(fc) {
    state.editingFixedCostId = fc ? String(fc.id) : '';
    var modal = ensureFixedCostModal();
    var titleEl = document.getElementById('cost-expenses-fixed-cost-modal-title');
    if (titleEl) titleEl.textContent = fc ? 'Edit fixed cost' : 'Add fixed cost';
    try {
      var wrap = document.getElementById('cost-expenses-fixed-cost-form-wrap');
      if (wrap) wrap.classList.remove('is-hidden');
    } catch (_) {}

    document.getElementById('cost-expenses-fixed-cost-id').value = state.editingFixedCostId;
    document.getElementById('cost-expenses-fixed-cost-name').value = fc ? (fc.name || '') : '';
    document.getElementById('cost-expenses-fixed-cost-amount').value = fc && (fc.amount != null) ? fc.amount : (fc && fc.amount_per_day != null ? fc.amount_per_day : '');
    try { document.getElementById('cost-expenses-fixed-cost-frequency').value = fc && fc.frequency ? String(fc.frequency) : 'daily'; } catch (_) {}
    try {
      var startRaw = fc ? (fc.effective_start || fc.start_date || '') : '';
      var nowYmd = ymdTodayLocal() || '';
      document.getElementById('cost-expenses-fixed-cost-start').value = fc ? String(startRaw || '') : (nowYmd || '');
    } catch (_) {}
    document.getElementById('cost-expenses-fixed-cost-enabled').checked = fc ? (fc.enabled !== false) : true;
    setSectionMsg('cost-expenses-fixed-costs-msg', '', null);

    if (modal) {
      try { modal.show(); } catch (_) {}
    }
  }

  function hideFixedCostForm() {
    state.editingFixedCostId = '';
    setSectionMsg('cost-expenses-fixed-costs-msg', '', null);
    var modal = ensureFixedCostModal();
    if (modal) {
      try { modal.hide(); } catch (_) {}
    }
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
      setSectionMsg('cost-expenses-fixed-costs-msg', 'Amount must be ≥ 0', false);
      return;
    }
    var freqRaw = '';
    try { freqRaw = String(document.getElementById('cost-expenses-fixed-cost-frequency').value || '').trim().toLowerCase(); } catch (_) { freqRaw = ''; }
    var frequency = (freqRaw === 'daily' || freqRaw === 'weekly' || freqRaw === 'monthly' || freqRaw === 'yearly') ? freqRaw : 'daily';
    var startYmd = '';
    try { startYmd = String(document.getElementById('cost-expenses-fixed-cost-start').value || '').trim(); } catch (_) { startYmd = ''; }
    if (startYmd && !/^\d{4}-\d{2}-\d{2}$/.test(startYmd)) {
      setSectionMsg('cost-expenses-fixed-costs-msg', 'Start date must be a date', false);
      return;
    }
    var id = state.editingFixedCostId || ('fc_' + Date.now());
    var fixedCost = normalizeFixedCost({
      id: id,
      name: name,
      amount: amount,
      frequency: frequency,
      effective_start: startYmd || null,
      start_date: startYmd || '',
      enabled: document.getElementById('cost-expenses-fixed-cost-enabled').checked,
    }, 0);

    var list = state.config.cost_expenses.fixed_costs;
    var idx = list.findIndex(function (f) { return String(f.id) === String(fixedCost.id); });
    if (idx !== -1) list[idx] = fixedCost;
    else list.push(fixedCost);
    list.sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    renderFixedCostsTable();
    hideFixedCostForm();
    setSectionMsg('cost-expenses-fixed-costs-msg', 'Saving…', null);
    markDraftChanged();
    saveCostExpensesToApi().then(function (res) {
      if (res && res.ok === true) setSectionMsg('cost-expenses-fixed-costs-msg', 'Saved.', true);
      else setSectionMsg('cost-expenses-fixed-costs-msg', 'Save failed. Your fixed cost is kept in draft; use Save Settings below to retry.', false);
    });
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
        try { hideShippingOverrideForm(); } catch (_) {}
        state.loadInFlight = null;
        load();
      });
    }

    var shippingOverrideSaveBtn = document.getElementById('cost-expenses-shipping-override-save-btn');
    if (shippingOverrideSaveBtn) shippingOverrideSaveBtn.addEventListener('click', saveShippingOverrideFromForm);

    var shippingCountryInput = document.getElementById('cost-expenses-shipping-override-country-input');
    var shippingCountryAddBtn = document.getElementById('cost-expenses-shipping-override-country-add-btn');
    if (shippingCountryInput && shippingCountryAddBtn) {
      shippingCountryInput.addEventListener('focus', function () {
        try { renderShippingOverrideCountrySuggest(shippingCountryInput.value || ''); } catch (_) {}
      });
      shippingCountryInput.addEventListener('input', function () {
        try { renderShippingOverrideCountrySuggest(shippingCountryInput.value || ''); } catch (_) {}
      });
      shippingCountryInput.addEventListener('keydown', function (ev) {
        if (ev && (ev.key === 'Enter' || ev.keyCode === 13)) {
          try { ev.preventDefault(); } catch (_) {}
          try { shippingCountryAddBtn.click(); } catch (_) {}
          return;
        }
        if (ev && (ev.key === 'Escape' || ev.keyCode === 27)) {
          try { ev.preventDefault(); } catch (_) {}
          hideShippingOverrideCountrySuggest();
        }
      });
      shippingCountryAddBtn.addEventListener('click', function () {
        var raw = shippingCountryInput ? String(shippingCountryInput.value || '') : '';
        var res = addShippingOverrideCountryFromText(raw);
        if (!res.ok) return;
        if (shippingCountryInput) shippingCountryInput.value = '';
      });
    }

    var addOverrideBtn = document.getElementById('cost-expenses-shipping-add-override');
    if (addOverrideBtn) addOverrideBtn.addEventListener('click', function () {
      state.config = state.config || defaultConfig();
      var sh = readShippingFromUi();
      if (!sh || typeof sh !== 'object') sh = { enabled: false, worldwideDefaultGbp: 0, worldwideDefaultAmount: 0, worldwideDefaultCurrency: 'GBP', overrides: [] };
      if (!Array.isArray(sh.overrides)) sh.overrides = [];
      sh.overrides.push({
        priority: sh.overrides.length + 1,
        enabled: true,
        label: '',
        priceGbp: 0,
        countries: [],
      });
      state.config.shipping = sh;
      renderShippingOverrides();
      markDraftChanged();
    });

    var addPerOrderBtn = document.getElementById('cost-expenses-per-order-add-btn');
    var savePerOrderBtn = document.getElementById('cost-expenses-per-order-save-btn');
    var cancelPerOrderBtn = document.getElementById('cost-expenses-per-order-cancel-btn');
    if (addPerOrderBtn) addPerOrderBtn.addEventListener('click', function () { showPerOrderForm(null); });
    if (savePerOrderBtn) savePerOrderBtn.addEventListener('click', savePerOrderFromForm);
    if (cancelPerOrderBtn) cancelPerOrderBtn.addEventListener('click', hidePerOrderForm);
    var countryInput = document.getElementById('cost-expenses-per-order-country-input');
    var countryAddBtn = document.getElementById('cost-expenses-per-order-country-add-btn');
    if (countryInput && countryAddBtn) {
      countryInput.addEventListener('focus', function () {
        try { renderCountrySuggestList(countryInput.value || ''); } catch (_) {}
      });
      countryInput.addEventListener('input', function () {
        try { renderCountrySuggestList(countryInput.value || ''); } catch (_) {}
      });
      countryInput.addEventListener('keydown', function (ev) {
        if (ev && (ev.key === 'Enter' || ev.keyCode === 13)) {
          try { ev.preventDefault(); } catch (_) {}
          try { countryAddBtn.click(); } catch (_) {}
          return;
        }
        if (ev && (ev.key === 'Escape' || ev.keyCode === 27)) {
          try { ev.preventDefault(); } catch (_) {}
          hideCountrySuggestList();
        }
      });
    }

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
      if (target && (
        target.id === 'cost-expenses-shipping-enabled' ||
        target.id === 'cost-expenses-rules-per-order-enabled' ||
        target.id === 'cost-expenses-rules-overheads-enabled' ||
        target.id === 'cost-expenses-rules-fixed-enabled'
      )) {
        syncExcludedHints();
      }
      if (target && target.id === 'cost-expenses-rule-mode') {
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.rule_mode = String(target.value) === 'first_match' ? 'first_match' : 'stack';
      }
      if (target && (
        target.id === 'cost-expenses-per-order-category' ||
        target.id === 'cost-expenses-per-order-name' ||
        target.id === 'cost-expenses-per-order-breakdown-label' ||
        target.id === 'cost-expenses-per-order-kind' ||
        target.id === 'cost-expenses-per-order-direction' ||
        target.id === 'cost-expenses-per-order-value' ||
        target.id === 'cost-expenses-per-order-revenue-basis' ||
        target.id === 'cost-expenses-per-order-start-date' ||
        target.id === 'cost-expenses-per-order-end-date' ||
        target.id === 'cost-expenses-per-order-sort' ||
        target.id === 'cost-expenses-per-order-enabled' ||
        (target.name === 'cost-expenses-per-order-start-mode') ||
        (target.name === 'cost-expenses-per-order-end-mode') ||
        (target.name === 'cost-expenses-per-order-country-mode')
      )) {
        if (target.id === 'cost-expenses-per-order-kind') syncPerOrderKindUi();
        if (target.id === 'cost-expenses-per-order-value') syncPerOrderKindUi();
        if (target.id === 'cost-expenses-per-order-category') {
          // Apply lightweight preset defaults.
          try {
            var cat = String(target.value || '').trim().toLowerCase();
            if (cat === 'tax_vat') {
              document.getElementById('cost-expenses-per-order-kind').value = 'percent_of_revenue';
              document.getElementById('cost-expenses-per-order-direction').value = 'add';
              document.getElementById('cost-expenses-per-order-revenue-basis').value = 'order_total_excl_tax';
            } else if (cat === 'payment_fees') {
              document.getElementById('cost-expenses-per-order-kind').value = 'percent_of_revenue';
              document.getElementById('cost-expenses-per-order-direction').value = 'add';
              document.getElementById('cost-expenses-per-order-revenue-basis').value = 'order_total_incl_tax';
            } else if (cat === 'packaging') {
              document.getElementById('cost-expenses-per-order-kind').value = 'fixed_per_order';
              document.getElementById('cost-expenses-per-order-direction').value = 'add';
            }
          } catch (_) {}
          syncPerOrderKindUi();
          syncPerOrderCountryUi();

          // Suggest breakdown label only when blank (preset-style).
          try {
            var blEl = document.getElementById('cost-expenses-per-order-breakdown-label');
            var cur = blEl ? String(blEl.value || '').trim() : '';
            if (blEl && !cur) {
              var country = readPerOrderCountryScopeFromUi();
              var countries = (country && country.ok && Array.isArray(country.countries)) ? country.countries : [];
              var nextLabel = '';
              if (cat === 'tax_vat') nextLabel = (countries.length === 1 && countries[0] === 'GB') ? 'UK VAT' : 'VAT';
              else if (cat === 'payment_fees') nextLabel = 'Payment fees';
              else if (cat === 'packaging') nextLabel = 'Packaging';
              else if (cat === 'handling') nextLabel = 'Handling';
              else if (cat === 'fulfilment') nextLabel = 'Fulfilment';
              else if (cat === 'insurance') nextLabel = 'Insurance';
              if (nextLabel) blEl.value = nextLabel;
            }
          } catch (_) {}
        }
        if (target.name === 'cost-expenses-per-order-start-mode' || target.name === 'cost-expenses-per-order-end-mode') syncPerOrderDatesUi();
        if (target.name === 'cost-expenses-per-order-country-mode') syncPerOrderCountryUi();
        updatePerOrderLiveSummary();
      }
      if (target && (target.id === 'cost-expenses-overhead-kind' || target.id === 'cost-expenses-overhead-frequency')) {
        syncOverheadFormUi();
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

    // Live preview summary should update as the user types.
    root.addEventListener('input', function (e) {
      var target = e && e.target ? e.target : null;
      if (!target || !target.id) return;
      if (
        target.id === 'cost-expenses-per-order-name' ||
        target.id === 'cost-expenses-per-order-breakdown-label' ||
        target.id === 'cost-expenses-per-order-value' ||
        target.id === 'cost-expenses-per-order-start-date' ||
        target.id === 'cost-expenses-per-order-end-date'
      ) {
        if (target.id === 'cost-expenses-per-order-value') syncPerOrderKindUi();
        updatePerOrderLiveSummary();
      }
    });
    root.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.nodeType !== 1) t = t.parentElement;
      if (!t) return;

      var currencyItem = t.closest ? t.closest('a[data-currency]') : null;
      if (currencyItem && currencyItem.closest('#settings-cost-expenses-panel-shipping')) {
        var currency = currencyItem.getAttribute('data-currency');
        if (currency && ['GBP', 'EUR', 'USD'].indexOf(currency) !== -1) {
          try { e.preventDefault(); } catch (_) {}
          var btn = document.getElementById('cost-expenses-shipping-currency-btn');
          if (btn) {
            btn.textContent = currency;
            markDraftChanged();
          }
        }
        return;
      }

      // Country suggest list: click outside closes it.
      try {
        var countryWrap = document.getElementById('cost-expenses-per-order-country-selected-wrap');
        if (countryWrap && !countryWrap.contains(t)) hideCountrySuggestList();
        var shippingFormWrap = document.getElementById('cost-expenses-shipping-override-form-wrap');
        if (shippingFormWrap && !shippingFormWrap.contains(t)) hideShippingOverrideCountrySuggest();
      } catch (_) {}

      var shippingOverrideSuggestBtn = t.closest ? t.closest('[data-shipping-override-country-suggest-code]') : null;
      if (shippingOverrideSuggestBtn) {
        var pick = shippingOverrideSuggestBtn.getAttribute('data-shipping-override-country-suggest-code');
        var res = addShippingOverrideCountryFromText(pick);
        if (res.ok) {
          var input = document.getElementById('cost-expenses-shipping-override-country-input');
          if (input) input.value = '';
          hideShippingOverrideCountrySuggest();
        }
        return;
      }
      var shippingOverrideRemoveBtn = t.closest ? t.closest('[data-shipping-override-country-remove]') : null;
      if (shippingOverrideRemoveBtn) {
        var removeCode = normalizeCountryCode(shippingOverrideRemoveBtn.getAttribute('data-shipping-override-country-remove'));
        var existing = readShippingOverrideCountryCodesFromChips();
        var next = existing.filter(function (c2) { return c2 && c2 !== removeCode; });
        renderShippingOverrideCountryChips(next);
        return;
      }

      var shippingOverrideEditBtn = t.closest ? t.closest('[data-shipping-override-edit]') : null;
      if (shippingOverrideEditBtn) {
        var idx = parseInt(shippingOverrideEditBtn.getAttribute('data-override-idx'), 10);
        if (Number.isFinite(idx) && idx >= 0) showShippingOverrideForm(idx);
      }

      var overrideRemoveBtn = t.closest ? t.closest('[data-override-remove]') : null;
      if (overrideRemoveBtn) {
        var row = overrideRemoveBtn.closest('[data-override-idx]');
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

      var perOrderEditBtn = t.closest ? t.closest('[data-per-order-edit]') : null;
      if (perOrderEditBtn) {
        var id = perOrderEditBtn.getAttribute('data-per-order-id');
        showPerOrderForm(getPerOrderRuleById(id));
      }

      var perOrderDeleteBtn = t.closest ? t.closest('[data-per-order-delete]') : null;
      if (perOrderDeleteBtn) {
        var id = perOrderDeleteBtn.getAttribute('data-per-order-id');
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.per_order_rules = (state.config.cost_expenses.per_order_rules || []).filter(function (r) { return String(r.id) !== String(id); });
        renderPerOrderRulesTable();
        hidePerOrderForm();
        markDraftChanged();
      }

      var overheadEditBtn = t.closest ? t.closest('[data-overhead-edit]') : null;
      if (overheadEditBtn) {
        var id = overheadEditBtn.getAttribute('data-overhead-id');
        showOverheadForm(getOverheadById(id));
      }

      var overheadDeleteBtn = t.closest ? t.closest('[data-overhead-delete]') : null;
      if (overheadDeleteBtn) {
        var id = overheadDeleteBtn.getAttribute('data-overhead-id');
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.overheads = (state.config.cost_expenses.overheads || []).filter(function (o) { return String(o.id) !== String(id); });
        renderOverheadsTable();
        hideOverheadForm();
        markDraftChanged();
      }

      var fixedCostEditBtn = t.closest ? t.closest('[data-fixed-cost-edit]') : null;
      if (fixedCostEditBtn) {
        var id = fixedCostEditBtn.getAttribute('data-fixed-cost-id');
        showFixedCostForm(getFixedCostById(id));
      }

      var fixedCostDeleteBtn = t.closest ? t.closest('[data-fixed-cost-delete]') : null;
      if (fixedCostDeleteBtn) {
        var id = fixedCostDeleteBtn.getAttribute('data-fixed-cost-id');
        state.config = state.config || defaultConfig();
        if (!state.config.cost_expenses) state.config.cost_expenses = defaultCostExpensesModel();
        state.config.cost_expenses.fixed_costs = (state.config.cost_expenses.fixed_costs || []).filter(function (f) { return String(f.id) !== String(id); });
        renderFixedCostsTable();
        hideFixedCostForm();
        markDraftChanged();
      }

      var previewBtn = t.closest ? t.closest('[data-ce-per-order-preview-range]') : null;
      if (previewBtn && previewBtn.getAttribute) {
        var r = previewBtn.getAttribute('data-ce-per-order-preview-range');
        runPerOrderPreview(r);
      }

      // Country chips (add/remove)
      var suggestCountryBtn = t.closest ? t.closest('[data-ce-country-suggest-code]') : null;
      if (suggestCountryBtn) {
        var input = document.getElementById('cost-expenses-per-order-country-input');
        var pick = suggestCountryBtn.getAttribute('data-ce-country-suggest-code');
        var res = addPerOrderCountryFromText(pick);
        if (!res.ok) {
          setSectionMsg('cost-expenses-per-order-msg', res.error, false);
          return;
        }
        setSectionMsg('cost-expenses-per-order-msg', '', null);
        if (input) input.value = '';
        updatePerOrderLiveSummary();
        return;
      }
      var addCountryBtn = t.closest ? t.closest('#cost-expenses-per-order-country-add-btn') : null;
      if (addCountryBtn) {
        var input = document.getElementById('cost-expenses-per-order-country-input');
        var raw = input ? String(input.value || '') : '';
        var res = addPerOrderCountryFromText(raw);
        if (!res.ok) {
          setSectionMsg('cost-expenses-per-order-msg', res.error, false);
          return;
        }
        setSectionMsg('cost-expenses-per-order-msg', '', null);
        if (input) input.value = '';
        updatePerOrderLiveSummary();
        return;
      }
      if (t.getAttribute('data-country-remove') !== null) {
        var removeCode = normalizeCountryCode(t.getAttribute('data-country-remove'));
        var existing = readPerOrderCountryCodesFromChips();
        var next = existing.filter(function (c2) { return c2 && c2 !== removeCode; });
        setPerOrderCountryCodes(next);
        maybeSuggestVatBreakdownLabel(next);
        updatePerOrderLiveSummary();
        return;
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
      hideShippingOverrideForm();
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
