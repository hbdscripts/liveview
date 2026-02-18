const PROFIT_RULES_V1_KEY = 'profit_rules_v1';

const PROFIT_RULE_TYPES = Object.freeze({
  percentRevenue: 'percent_revenue',
  fixedPerOrder: 'fixed_per_order',
  fixedPerPeriod: 'fixed_per_period',
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
  return out;
}

function hasEnabledProfitRules(config) {
  if (!config || typeof config !== 'object' || config.enabled !== true) return false;
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
