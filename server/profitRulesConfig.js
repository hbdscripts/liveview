const PROFIT_RULES_V1_KEY = 'profit_rules_v1';

const PROFIT_RULE_TYPES = Object.freeze({
  percentRevenue: 'percent_revenue',
  fixedPerOrder: 'fixed_per_order',
  fixedPerPeriod: 'fixed_per_period',
  fixedPerItem: 'fixed_per_item',
});

const PROFIT_RULE_TYPE_SET = new Set(Object.values(PROFIT_RULE_TYPES));

// Per-order rule v2 fields (used by Settings → Costs & Expenses → Per Order).
const PER_ORDER_RULE_CATEGORIES = Object.freeze({
  taxVat: 'tax_vat',
  paymentFees: 'payment_fees',
  packaging: 'packaging',
  handling: 'handling',
  fulfilment: 'fulfilment',
  insurance: 'insurance',
  other: 'other',
});
const PER_ORDER_RULE_CATEGORY_SET = new Set(Object.values(PER_ORDER_RULE_CATEGORIES));

const PER_ORDER_RULE_KINDS = Object.freeze({
  fixedPerOrder: 'fixed_per_order',
  percentOfRevenue: 'percent_of_revenue',
  // Legacy/hidden for backwards compatibility (not offered by default in the UI).
  fixedPerItemLegacy: 'fixed_per_item',
});
const PER_ORDER_RULE_KIND_SET = new Set(Object.values(PER_ORDER_RULE_KINDS));

const PER_ORDER_RULE_DIRECTIONS = Object.freeze({
  add: 'add',
  subtract: 'subtract',
});
const PER_ORDER_RULE_DIRECTION_SET = new Set(Object.values(PER_ORDER_RULE_DIRECTIONS));

const PER_ORDER_RULE_REVENUE_BASIS = Object.freeze({
  orderTotalInclTax: 'order_total_incl_tax',
  orderTotalExclTax: 'order_total_excl_tax',
  subtotalExclShipping: 'subtotal_excl_shipping',
});
const PER_ORDER_RULE_REVENUE_BASIS_SET = new Set(Object.values(PER_ORDER_RULE_REVENUE_BASIS));

function defaultShippingConfig() {
  return {
    enabled: false,
    worldwideDefaultGbp: 0,
    overrides: [],
  };
}

function normalizeShippingOverride(raw, idx) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const countries = Array.isArray(o.countries) ? o.countries : [];
  const seen = new Set();
  const codes = [];
  for (const item of countries) {
    const code = normalizeCountryCode(item);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
    if (codes.length >= 64) break;
  }
  return {
    priority: Math.trunc(clampNumber(o.priority, 1, 1000000, idx + 1)),
    enabled: o.enabled !== false,
    priceGbp: Math.max(0, Number(o.priceGbp) || 0),
    countries: codes,
  };
}

function normalizeShippingConfig(raw) {
  if (!raw || typeof raw !== 'object') return defaultShippingConfig();
  const overrides = Array.isArray(raw.overrides) ? raw.overrides : [];
  const normalized = overrides.slice(0, 64).map((o, i) => normalizeShippingOverride(o, i));
  normalized.sort((a, b) => (a.priority || 0) - (b.priority || 0));
  return {
    enabled: raw.enabled === true,
    worldwideDefaultGbp: Math.max(0, Number(raw.worldwideDefaultGbp) || 0),
    overrides: normalized,
  };
}

function defaultProfitRulesConfigV1() {
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
    cost_expenses: {
      rule_mode: 'stack', // stack | first_match
      per_order_rules: [],
      overheads: [],
      fixed_costs: [],
    },
    rules: [],
    shipping: defaultShippingConfig(),
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeCurrencyCode(value) {
  const raw = value == null ? '' : String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) return 'GBP';
  return raw;
}

function normalizeCountryCode(value) {
  const raw = value == null ? '' : String(value).trim().toUpperCase().slice(0, 2);
  if (!raw) return '';
  const code = raw === 'UK' ? 'GB' : raw;
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return code;
}

function normalizeAppliesTo(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const modeRaw = raw.mode == null ? '' : String(raw.mode).trim().toLowerCase();
  if (modeRaw === 'countries') {
    const seen = new Set();
    const countries = [];
    const list = Array.isArray(raw.countries) ? raw.countries : [];
    for (const item of list) {
      const code = normalizeCountryCode(item);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      countries.push(code);
      if (countries.length >= 64) break;
    }
    if (countries.length) return { mode: 'countries', countries };
  }
  return { mode: 'all', countries: [] };
}

function normalizeRuleType(value, fallback) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (PROFIT_RULE_TYPE_SET.has(raw)) return raw;
  return PROFIT_RULE_TYPE_SET.has(fallback) ? fallback : PROFIT_RULE_TYPES.percentRevenue;
}

function normalizeRuleName(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return fallback || 'Expense';
  return raw.slice(0, 80);
}

function normalizeRuleId(value, idx) {
  const raw = value == null ? '' : String(value).trim();
  if (raw) return raw.slice(0, 64);
  return 'rule_' + String(idx + 1);
}

function normalizeRuleNotes(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  return raw.slice(0, 400);
}

function normalizeRuleValue(value) {
  return clampNumber(value, 0, 1000000000, 0);
}

function normalizeRuleSort(value, idx) {
  return Math.trunc(clampNumber(value, -1000000, 1000000, idx + 1));
}

function normalizeRuleEnabled(value, fallback) {
  if (typeof value === 'boolean') return value;
  return typeof fallback === 'boolean' ? fallback : true;
}

function normalizeRule(rawRule, idx) {
  const raw = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const type = normalizeRuleType(raw.type, PROFIT_RULE_TYPES.percentRevenue);
  return {
    id: normalizeRuleId(raw.id, idx),
    name: normalizeRuleName(raw.name, 'Expense'),
    appliesTo: normalizeAppliesTo(raw.appliesTo),
    type,
    value: normalizeRuleValue(raw.value),
    notes: normalizeRuleNotes(raw.notes),
    enabled: normalizeRuleEnabled(raw.enabled, true),
    sort: normalizeRuleSort(raw.sort, idx + 1),
  };
}

function normalizeRuleMode(value) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (raw === 'first_match' || raw === 'first-match' || raw === 'first') return 'first_match';
  return 'stack';
}

function normalizeRevenueBasis(value) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (raw === 'excl_tax' || raw === 'excl-tax') return 'excl_tax';
  if (raw === 'excl_shipping' || raw === 'excl-shipping') return 'excl_shipping';
  return 'incl_tax';
}

function normalizePerOrderCategory(value, fallback) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (PER_ORDER_RULE_CATEGORY_SET.has(raw)) return raw;
  if (PER_ORDER_RULE_CATEGORY_SET.has(fallback)) return fallback;
  return PER_ORDER_RULE_CATEGORIES.other;
}

function normalizePerOrderDirection(value, fallback) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (raw === 'minus' || raw === 'reduce') return PER_ORDER_RULE_DIRECTIONS.subtract;
  if (PER_ORDER_RULE_DIRECTION_SET.has(raw)) return raw;
  if (PER_ORDER_RULE_DIRECTION_SET.has(fallback)) return fallback;
  return PER_ORDER_RULE_DIRECTIONS.add;
}

function normalizePerOrderKind(value, fallbackLegacyType) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (PER_ORDER_RULE_KIND_SET.has(raw)) return raw;

  // Back-compat: accept legacy `type` values.
  const t = fallbackLegacyType == null ? '' : String(fallbackLegacyType).trim().toLowerCase();
  if (t === PROFIT_RULE_TYPES.fixedPerItem) return PER_ORDER_RULE_KINDS.fixedPerItemLegacy;
  if (t === PROFIT_RULE_TYPES.fixedPerOrder) return PER_ORDER_RULE_KINDS.fixedPerOrder;
  if (t === PROFIT_RULE_TYPES.percentRevenue) return PER_ORDER_RULE_KINDS.percentOfRevenue;
  return PER_ORDER_RULE_KINDS.percentOfRevenue;
}

function kindToLegacyType(kind) {
  const k = kind == null ? '' : String(kind).trim().toLowerCase();
  if (k === PER_ORDER_RULE_KINDS.fixedPerItemLegacy) return PROFIT_RULE_TYPES.fixedPerItem;
  if (k === PER_ORDER_RULE_KINDS.fixedPerOrder) return PROFIT_RULE_TYPES.fixedPerOrder;
  return PROFIT_RULE_TYPES.percentRevenue;
}

function normalizePerOrderRevenueBasis(value, fallback) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  // New canonical values.
  if (PER_ORDER_RULE_REVENUE_BASIS_SET.has(raw)) return raw;

  // Back-compat: accept legacy values.
  if (raw === 'incl_tax' || raw === 'incl-tax') return PER_ORDER_RULE_REVENUE_BASIS.orderTotalInclTax;
  if (raw === 'excl_tax' || raw === 'excl-tax') return PER_ORDER_RULE_REVENUE_BASIS.orderTotalExclTax;
  if (raw === 'excl_shipping' || raw === 'excl-shipping') return PER_ORDER_RULE_REVENUE_BASIS.subtotalExclShipping;

  const fb = fallback == null ? '' : String(fallback).trim().toLowerCase();
  if (PER_ORDER_RULE_REVENUE_BASIS_SET.has(fb)) return fb;
  return PER_ORDER_RULE_REVENUE_BASIS.orderTotalInclTax;
}

function normalizeCountryScope(value, fallbackAppliesTo) {
  const toAll = () => ({ country_scope: 'ALL', appliesTo: { mode: 'all', countries: [] } });
  const fromCountries = (countries) => {
    const seen = new Set();
    const out = [];
    for (const item of countries || []) {
      const code = normalizeCountryCode(item);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      out.push(code);
      if (out.length >= 64) break;
    }
    if (!out.length) return toAll();
    return { country_scope: out, appliesTo: { mode: 'countries', countries: out } };
  };

  if (value === 'ALL') return toAll();
  if (Array.isArray(value)) return fromCountries(value);
  if (typeof value === 'string') {
    const raw = value.trim().toUpperCase();
    if (!raw || raw === 'ALL') return toAll();
    // Allow comma/space separated strings as a convenience.
    const parts = raw.split(/[\s,]+/).filter(Boolean);
    return fromCountries(parts);
  }
  if (value && typeof value === 'object') {
    // Allow appliesTo-style objects.
    const mode = value.mode == null ? '' : String(value.mode).trim().toLowerCase();
    if (mode === 'countries' && Array.isArray(value.countries)) return fromCountries(value.countries);
    if (mode === 'all') return toAll();
  }
  if (fallbackAppliesTo && typeof fallbackAppliesTo === 'object') {
    const fb = normalizeAppliesTo(fallbackAppliesTo);
    if (fb.mode === 'countries') return fromCountries(fb.countries);
    return toAll();
  }
  return toAll();
}

function categoryLabel(category) {
  const c = String(category || '').trim().toLowerCase();
  if (c === PER_ORDER_RULE_CATEGORIES.taxVat) return 'Tax / VAT';
  if (c === PER_ORDER_RULE_CATEGORIES.paymentFees) return 'Payment fees';
  if (c === PER_ORDER_RULE_CATEGORIES.packaging) return 'Packaging';
  if (c === PER_ORDER_RULE_CATEGORIES.handling) return 'Handling';
  if (c === PER_ORDER_RULE_CATEGORIES.fulfilment) return 'Fulfilment';
  if (c === PER_ORDER_RULE_CATEGORIES.insurance) return 'Insurance';
  return 'Other';
}

function defaultBreakdownLabel({ category, country_scope, name } = {}) {
  const c = String(category || '').trim().toLowerCase();
  const scope = country_scope === 'ALL' ? [] : (Array.isArray(country_scope) ? country_scope : []);
  if (c === PER_ORDER_RULE_CATEGORIES.taxVat) {
    if (scope.length === 1 && scope[0] === 'GB') return 'UK VAT';
    return 'VAT';
  }
  if (c === PER_ORDER_RULE_CATEGORIES.paymentFees) return 'Payment fees';
  if (c === PER_ORDER_RULE_CATEGORIES.packaging) return 'Packaging';
  if (c === PER_ORDER_RULE_CATEGORIES.handling) return 'Handling';
  if (c === PER_ORDER_RULE_CATEGORIES.fulfilment) return 'Fulfilment';
  if (c === PER_ORDER_RULE_CATEGORIES.insurance) return 'Insurance';
  const n = name == null ? '' : String(name).trim();
  return n || categoryLabel(c);
}

function normalizeBreakdownLabel(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (raw) return raw.slice(0, 80);
  const fb = fallback == null ? '' : String(fallback).trim();
  if (fb) return fb.slice(0, 80);
  return '';
}

function normalizeYmd(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const fb = fallback == null ? '' : String(fallback).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(fb)) return fb;
  return '';
}

function ymdTodayUtc() {
  try { return new Date().toISOString().slice(0, 10); } catch (_) { return '2000-01-01'; }
}

function normalizePerOrderRule(rawRule, idx) {
  const raw = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const category = normalizePerOrderCategory(raw.category, PER_ORDER_RULE_CATEGORIES.other);
  const kind = normalizePerOrderKind(raw.kind, raw.type);
  const direction = normalizePerOrderDirection(raw.direction, PER_ORDER_RULE_DIRECTIONS.add);
  const countryScope = normalizeCountryScope(raw.country_scope != null ? raw.country_scope : raw.appliesTo, raw.appliesTo);
  const effectiveStart = normalizeYmd(raw.effective_start != null ? raw.effective_start : raw.start_date, '2000-01-01');
  const effectiveEnd = normalizeYmd(raw.effective_end != null ? raw.effective_end : raw.end_date, '');

  const revenue_basis =
    kind === PER_ORDER_RULE_KINDS.percentOfRevenue
      ? normalizePerOrderRevenueBasis(raw.revenue_basis, PER_ORDER_RULE_REVENUE_BASIS.orderTotalInclTax)
      : normalizePerOrderRevenueBasis(raw.revenue_basis, PER_ORDER_RULE_REVENUE_BASIS.orderTotalInclTax);

  const name = normalizeRuleName(raw.name, 'Expense');
  const breakdownFallback = defaultBreakdownLabel({ category, country_scope: countryScope.country_scope, name });
  const breakdown_label = normalizeBreakdownLabel(raw.breakdown_label, breakdownFallback);

  return {
    id: normalizeRuleId(raw.id, idx),
    name,
    category,
    breakdown_label,
    kind,
    direction,
    value: normalizeRuleValue(raw.value),
    revenue_basis,
    effective_start: effectiveStart,
    effective_end: effectiveEnd || null,
    country_scope: countryScope.country_scope,
    // Legacy/engine fields (kept for compatibility).
    appliesTo: countryScope.appliesTo,
    type: kindToLegacyType(kind),
    start_date: effectiveStart,
    end_date: effectiveEnd,
    enabled: normalizeRuleEnabled(raw.enabled, true),
    sort: normalizeRuleSort(raw.sort, idx + 1),
    notes: normalizeRuleNotes(raw.notes),
  };
}

function normalizeOverhead(rawOverhead, idx) {
  const raw = rawOverhead && typeof rawOverhead === 'object' ? rawOverhead : {};
  const kindRaw = raw.kind == null ? '' : String(raw.kind).trim().toLowerCase();
  const kind = (kindRaw === 'one_off' || kindRaw === 'one-off') ? 'one_off' : 'recurring';
  const freqRaw = raw.frequency == null ? '' : String(raw.frequency).trim().toLowerCase();
  const frequency = (freqRaw === 'daily' || freqRaw === 'weekly' || freqRaw === 'monthly' || freqRaw === 'yearly') ? freqRaw : 'monthly';
  const allocRaw = raw.monthly_allocation == null ? '' : String(raw.monthly_allocation).trim().toLowerCase();
  const monthly_allocation = allocRaw === 'calendar' ? 'calendar' : 'prorate';
  return {
    id: normalizeRuleId(raw.id, idx).replace(/^rule_/, 'oh_'),
    name: normalizeRuleName(raw.name, 'Overhead'),
    kind,
    amount: normalizeRuleValue(raw.amount),
    date: normalizeYmd(raw.date || raw.start_date, ymdTodayUtc()),
    end_date: normalizeYmd(raw.end_date, ''),
    frequency,
    monthly_allocation,
    enabled: normalizeRuleEnabled(raw.enabled, true),
    appliesTo: normalizeAppliesTo(raw.appliesTo),
    notes: normalizeRuleNotes(raw.notes),
  };
}

function normalizeFixedCost(raw, idx) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const id = normalizeRuleId(r.id, idx).replace(/^rule_/, 'fc_');
  const freqRaw = r.frequency == null ? '' : String(r.frequency).trim().toLowerCase();
  const frequency = (freqRaw === 'daily' || freqRaw === 'weekly' || freqRaw === 'monthly' || freqRaw === 'yearly') ? freqRaw : 'daily';
  const rawAmount = r.amount != null ? r.amount : r.amount_per_day;
  const amount = Math.max(0, Number(rawAmount) || 0);
  const DAYS_PER_YEAR = 365.25;
  const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
  const amount_per_day = (() => {
    // Back-compat: if config only has amount_per_day and no explicit frequency, keep as-is.
    if ((r.amount == null) && (r.frequency == null) && (r.amount_per_day != null)) return Math.max(0, Number(r.amount_per_day) || 0);
    if (frequency === 'weekly') return amount / 7;
    if (frequency === 'monthly') return amount / DAYS_PER_MONTH;
    if (frequency === 'yearly') return amount / DAYS_PER_YEAR;
    return amount; // daily
  })();
  return {
    id: id.slice(0, 64),
    name: normalizeRuleName(r.name, 'Fixed cost'),
    amount,
    frequency,
    amount_per_day: Math.max(0, Number(amount_per_day) || 0),
    enabled: normalizeRuleEnabled(r.enabled, true),
  };
}

function normalizeProfitRulesConfigV1(raw) {
  const parsed = (() => {
    if (raw && typeof raw === 'object') return raw;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (_) {
      return null;
    }
  })();
  if (!parsed) return defaultProfitRulesConfigV1();

  const out = defaultProfitRulesConfigV1();
  out.enabled = typeof parsed.enabled === 'boolean' ? parsed.enabled : out.enabled;
  out.currency = normalizeCurrencyCode(parsed.currency);
  try {
    const integ = parsed.integrations && typeof parsed.integrations === 'object' ? parsed.integrations : {};
    out.integrations = {
      includeGoogleAdsSpend: integ && integ.includeGoogleAdsSpend === true,
      includeShopifyAppBills: integ && integ.includeShopifyAppBills === true,
      includePaymentFees: integ && integ.includePaymentFees === true,
      includeKlarnaFees: integ && integ.includeKlarnaFees === true,
      includeShopifyTaxes: integ && integ.includeShopifyTaxes === true,
    };
  } catch (_) {
    out.integrations = {
      includeGoogleAdsSpend: false,
      includeShopifyAppBills: false,
      includePaymentFees: false,
      includeKlarnaFees: false,
      includeShopifyTaxes: false,
    };
  }

  const list = Array.isArray(parsed.rules) ? parsed.rules : [];
  const normalized = [];
  for (let i = 0; i < list.length; i++) {
    normalized.push(normalizeRule(list[i], i));
    if (normalized.length >= 200) break;
  }
  normalized.sort((a, b) => {
    const sa = Number(a.sort) || 0;
    const sb = Number(b.sort) || 0;
    if (sa !== sb) return sa - sb;
    return String(a.id).localeCompare(String(b.id));
  });
  out.rules = normalized;
  out.shipping = normalizeShippingConfig(parsed.shipping);

  // New model: cost_expenses.per_order_rules + cost_expenses.overheads (+ rule_mode).
  const ce = parsed.cost_expenses && typeof parsed.cost_expenses === 'object' ? parsed.cost_expenses : null;
  if (ce) {
    const por = Array.isArray(ce.per_order_rules) ? ce.per_order_rules : [];
    const oh = Array.isArray(ce.overheads) ? ce.overheads : [];
    const fc = Array.isArray(ce.fixed_costs) ? ce.fixed_costs : [];
    out.cost_expenses = {
      rule_mode: normalizeRuleMode(ce.rule_mode),
      per_order_rules: por.slice(0, 200).map((r, i) => normalizePerOrderRule(r, i)).sort((a, b) => {
        const sa = Number(a.sort) || 0;
        const sb = Number(b.sort) || 0;
        if (sa !== sb) return sa - sb;
        return String(a.id).localeCompare(String(b.id));
      }),
      overheads: oh.slice(0, 200).map((r, i) => normalizeOverhead(r, i)).sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''))
      ),
      fixed_costs: fc.slice(0, 200).map((r, i) => normalizeFixedCost(r, i)).sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''))
      ),
    };
  } else {
    // Legacy migration: map fixed_per_period → overheads; keep existing rules always-on.
    const per_order_rules = [];
    const overheads = [];
    for (let i = 0; i < normalized.length; i += 1) {
      const r = normalized[i];
      if (!r) continue;
      if (r.type === PROFIT_RULE_TYPES.fixedPerPeriod) {
        overheads.push(normalizeOverhead({
          id: r.id,
          name: r.name,
          kind: 'recurring',
          amount: r.value,
          frequency: 'monthly',
          monthly_allocation: 'prorate',
          date: ymdTodayUtc(),
          end_date: '',
          enabled: r.enabled !== false,
          appliesTo: r.appliesTo,
          notes: (r.notes ? String(r.notes).trim() + ' ' : '') + 'Migrated from legacy fixed per period rule. Review dates/frequency.',
        }, i));
      } else {
        per_order_rules.push(normalizePerOrderRule({
          id: r.id,
          name: r.name,
          appliesTo: r.appliesTo,
          type: r.type,
          value: r.value,
          revenue_basis: 'incl_tax',
          start_date: '2000-01-01',
          end_date: '',
          enabled: r.enabled !== false,
          sort: r.sort,
          notes: r.notes,
        }, i));
      }
    }
    out.cost_expenses = {
      rule_mode: 'stack',
      per_order_rules: per_order_rules.sort((a, b) => {
        const sa = Number(a.sort) || 0;
        const sb = Number(b.sort) || 0;
        if (sa !== sb) return sa - sb;
        return String(a.id).localeCompare(String(b.id));
      }),
      overheads: overheads.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      fixed_costs: [],
    };
  }
  return out;
}

function hasEnabledProfitRules(config) {
  if (!config || typeof config !== 'object' || config.enabled !== true) return false;
  const ce = config.cost_expenses && typeof config.cost_expenses === 'object' ? config.cost_expenses : null;
  const perOrder = ce && Array.isArray(ce.per_order_rules) ? ce.per_order_rules : [];
  const overheads = ce && Array.isArray(ce.overheads) ? ce.overheads : [];
  const fixedCosts = ce && Array.isArray(ce.fixed_costs) ? ce.fixed_costs : [];
  if (perOrder.some((r) => r && r.enabled === true)) return true;
  if (overheads.some((o) => o && o.enabled === true)) return true;
  if (fixedCosts.some((f) => f && f.enabled === true)) return true;
  const rules = Array.isArray(config.rules) ? config.rules : [];
  return rules.some((rule) => rule && rule.enabled === true);
}

module.exports = {
  PROFIT_RULES_V1_KEY,
  PROFIT_RULE_TYPES,
  defaultProfitRulesConfigV1,
  normalizeCountryCode,
  normalizeProfitRulesConfigV1,
  hasEnabledProfitRules,
};
