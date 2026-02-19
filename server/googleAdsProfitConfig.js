const GOOGLE_ADS_PROFIT_CONFIG_V1_KEY = 'google_ads_profit_config_v1';

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function defaultGoogleAdsProfitConfigV1() {
  return {
    v: 1,
    mode: 'simple', // simple | costs
    simple: {
      percent_of_revenue: 0,
      fixed_per_order_gbp: 0,
    },
  };
}

function normalizeGoogleAdsProfitConfigV1(raw) {
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

  const out = defaultGoogleAdsProfitConfigV1();
  if (!parsed) return out;

  const mode = parsed.mode != null ? String(parsed.mode).trim().toLowerCase() : out.mode;
  out.mode = (mode === 'costs') ? 'costs' : 'simple';

  const simple = parsed.simple && typeof parsed.simple === 'object' ? parsed.simple : {};
  out.simple = {
    percent_of_revenue: clampNumber(simple.percent_of_revenue, 0, 100, 0),
    fixed_per_order_gbp: clampNumber(simple.fixed_per_order_gbp, 0, 1000000000, 0),
  };

  return out;
}

module.exports = {
  GOOGLE_ADS_PROFIT_CONFIG_V1_KEY,
  defaultGoogleAdsProfitConfigV1,
  normalizeGoogleAdsProfitConfigV1,
};

