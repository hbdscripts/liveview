const PROFIT_RULES_V1_KEY = 'profit_rules_v1';

const PROFIT_RULE_TYPES = Object.freeze({
  percentRevenue: 'percent_revenue',
  fixedPerOrder: 'fixed_per_order',
  fixedPerPeriod: 'fixed_per_period',
  fixedPerItem: 'fixed_per_item',
});

const PROFIT_RULE_TYPE_SET = new Set(Object.values(PROFIT_RULE_TYPES));

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
  const type = (() => {
    const t = raw.type == null ? '' : String(raw.type).trim().toLowerCase();
    if (t === PROFIT_RULE_TYPES.fixedPerItem) return PROFIT_RULE_TYPES.fixedPerItem;
    if (t === PROFIT_RULE_TYPES.fixedPerOrder) return PROFIT_RULE_TYPES.fixedPerOrder;
    return PROFIT_RULE_TYPES.percentRevenue;
  })();
  return {
    id: normalizeRuleId(raw.id, idx),
    name: normalizeRuleName(raw.name, 'Expense'),
    appliesTo: normalizeAppliesTo(raw.appliesTo),
    type,
    value: normalizeRuleValue(raw.value),
    revenue_basis: normalizeRevenueBasis(raw.revenue_basis),
    start_date: normalizeYmd(raw.start_date, '2000-01-01'),
    end_date: normalizeYmd(raw.end_date, ''),
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
    };
  }
  return out;
}

function hasEnabledProfitRules(config) {
  if (!config || typeof config !== 'object' || config.enabled !== true) return false;
  const ce = config.cost_expenses && typeof config.cost_expenses === 'object' ? config.cost_expenses : null;
  const perOrder = ce && Array.isArray(ce.per_order_rules) ? ce.per_order_rules : [];
  const overheads = ce && Array.isArray(ce.overheads) ? ce.overheads : [];
  if (perOrder.some((r) => r && r.enabled === true)) return true;
  if (overheads.some((o) => o && o.enabled === true)) return true;
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
