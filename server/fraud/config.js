/**
 * Fraud config stored in DB (fraud_config table).
 *
 * - Fail-open: if table/key missing, return defaults.
 * - Cached in-memory for short TTL to reduce DB reads (live view refreshes often).
 */
const { getDb } = require('../db');

const FRAUD_CONFIG_KEY = 'fraud_config_v1';
const CACHE_TTL_MS = 30 * 1000;

let _cache = null; // { at: number, config: object, fromDb: boolean }
let _tableOk = null; // null unknown, true ok, false missing

function uniqLowerStrings(arr, { max = 200 } = {}) {
  const out = [];
  const seen = new Set();
  (Array.isArray(arr) ? arr : []).forEach((v) => {
    const s = (typeof v === 'string' ? v : String(v || '')).trim().toLowerCase();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    if (out.length < max) out.push(s);
  });
  return out;
}

function clampInt(n, { min = 0, max = 100, fallback = 0 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function defaultFraudConfigV1() {
  return {
    v: 1,
    threshold: 70,
    hardTriggers: ['google_ads_conflict', 'duplicate_ip_pattern', 'no_affiliate_evidence'],
    weights: {
      google_ads_conflict: 50,
      no_affiliate_evidence: 40,
      duplicate_ip_pattern: 30,
      late_injection: 30,
      low_engagement: 20,
      suspicious_referrer: 15,
    },
    known: {
      paidClickIdParams: [
        'gclid', 'msclkid', 'fbclid', 'gbraid', 'wbraid', 'ttclid', 'twclid', 'li_fat_id',
      ],
      affiliateClickIdParams: [
        'clickid', 'irclickid', 'sclkid', 'aff_id', 'affiliate_id', 'ref', 'refid', 'subid', 'sid', 'cid',
        'cjevent', 'awc', 'clickref', 'awinmid', 'awinaffid', 'rakutenid', 'rpid', 'partner', 'partnerid',
        'sca_ref', 'coupon',
      ],
      affiliateIdParams: [
        'aff_id', 'affiliate_id', 'partnerid', 'partner_id', 'publisher_id', 'pubid',
      ],
    },
    networkHints: {
      paramToNetwork: {
        sca_ref: 'uppromote',
        irclickid: 'impact',
        cjevent: 'cj',
        awc: 'awin',
      },
    },
    suspiciousReferrers: {
      domains: [
        'coupert.com',
        'couponfollow.com',
        'rakuten.com',
        'topcashback.co.uk',
      ],
      substrings: ['coupon', 'voucher', 'deal', 'promo', 'discount', 'cashback'],
    },
    duplicateIp: {
      windowHours: 6,
      minTriggered: 3,
    },
    lowEngagement: {
      maxPageViews: 1,
      maxTotalEvents: 4,
    },
    lateInjection: {
      maxMsBeforeCheckout: 3 * 60 * 1000,
    },
    allowlist: {
      affiliateIds: [],
      referrerDomains: [],
    },
    denylist: {
      affiliateIds: [],
      referrerDomains: [],
    },
    ai: {
      enabled: false,
      provider: 'openai',
      model: 'gpt-4o-mini',
      version: 'v1',
    },
  };
}

function normalizeFraudConfigV1(input) {
  const base = defaultFraudConfigV1();
  let parsed = null;
  try {
    parsed = (typeof input === 'string') ? JSON.parse(input) : input;
  } catch (_) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Number(parsed.v) !== 1) return base;

  const out = { ...base };
  out.threshold = clampInt(parsed.threshold, { min: 0, max: 100, fallback: base.threshold });

  // weights
  out.weights = { ...base.weights };
  if (parsed.weights && typeof parsed.weights === 'object') {
    for (const k of Object.keys(out.weights)) {
      if (!Object.prototype.hasOwnProperty.call(parsed.weights, k)) continue;
      out.weights[k] = clampInt(parsed.weights[k], { min: 0, max: 100, fallback: out.weights[k] });
    }
  }

  // hard triggers
  out.hardTriggers = uniqLowerStrings(parsed.hardTriggers, { max: 50 }).filter((k) => Object.prototype.hasOwnProperty.call(out.weights, k));
  if (!out.hardTriggers.length) out.hardTriggers = base.hardTriggers.slice();

  // known params
  out.known = { ...base.known };
  out.known.paidClickIdParams = uniqLowerStrings(parsed.known && parsed.known.paidClickIdParams, { max: 200 });
  if (!out.known.paidClickIdParams.length) out.known.paidClickIdParams = base.known.paidClickIdParams.slice();
  out.known.affiliateClickIdParams = uniqLowerStrings(parsed.known && parsed.known.affiliateClickIdParams, { max: 300 });
  if (!out.known.affiliateClickIdParams.length) out.known.affiliateClickIdParams = base.known.affiliateClickIdParams.slice();
  out.known.affiliateIdParams = uniqLowerStrings(parsed.known && parsed.known.affiliateIdParams, { max: 100 });
  if (!out.known.affiliateIdParams.length) out.known.affiliateIdParams = base.known.affiliateIdParams.slice();

  // hints
  out.networkHints = { ...base.networkHints };
  out.networkHints.paramToNetwork = { ...base.networkHints.paramToNetwork };
  const p2n = parsed.networkHints && parsed.networkHints.paramToNetwork && typeof parsed.networkHints.paramToNetwork === 'object'
    ? parsed.networkHints.paramToNetwork
    : null;
  if (p2n) {
    for (const k of Object.keys(p2n)) {
      const kk = String(k || '').trim().toLowerCase();
      const vv = String(p2n[k] || '').trim().toLowerCase();
      if (!kk || !vv) continue;
      out.networkHints.paramToNetwork[kk] = vv.slice(0, 32);
    }
  }

  // suspicious referrers
  out.suspiciousReferrers = { ...base.suspiciousReferrers };
  out.suspiciousReferrers.domains = uniqLowerStrings(parsed.suspiciousReferrers && parsed.suspiciousReferrers.domains, { max: 200 });
  if (!out.suspiciousReferrers.domains.length) out.suspiciousReferrers.domains = base.suspiciousReferrers.domains.slice();
  out.suspiciousReferrers.substrings = uniqLowerStrings(parsed.suspiciousReferrers && parsed.suspiciousReferrers.substrings, { max: 200 });
  if (!out.suspiciousReferrers.substrings.length) out.suspiciousReferrers.substrings = base.suspiciousReferrers.substrings.slice();

  // duplicate IP
  out.duplicateIp = { ...base.duplicateIp };
  if (parsed.duplicateIp && typeof parsed.duplicateIp === 'object') {
    out.duplicateIp.windowHours = clampInt(parsed.duplicateIp.windowHours, { min: 1, max: 168, fallback: base.duplicateIp.windowHours });
    out.duplicateIp.minTriggered = clampInt(parsed.duplicateIp.minTriggered, { min: 2, max: 50, fallback: base.duplicateIp.minTriggered });
  }

  // low engagement
  out.lowEngagement = { ...base.lowEngagement };
  if (parsed.lowEngagement && typeof parsed.lowEngagement === 'object') {
    out.lowEngagement.maxPageViews = clampInt(parsed.lowEngagement.maxPageViews, { min: 0, max: 20, fallback: base.lowEngagement.maxPageViews });
    out.lowEngagement.maxTotalEvents = clampInt(parsed.lowEngagement.maxTotalEvents, { min: 0, max: 100, fallback: base.lowEngagement.maxTotalEvents });
  }

  // late injection
  out.lateInjection = { ...base.lateInjection };
  if (parsed.lateInjection && typeof parsed.lateInjection === 'object') {
    const ms = Number(parsed.lateInjection.maxMsBeforeCheckout);
    out.lateInjection.maxMsBeforeCheckout = Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60 * 60 * 1000) : base.lateInjection.maxMsBeforeCheckout;
  }

  // allow/deny lists
  out.allowlist = { ...base.allowlist };
  out.denylist = { ...base.denylist };
  out.allowlist.affiliateIds = uniqLowerStrings(parsed.allowlist && parsed.allowlist.affiliateIds, { max: 500 });
  out.allowlist.referrerDomains = uniqLowerStrings(parsed.allowlist && parsed.allowlist.referrerDomains, { max: 500 });
  out.denylist.affiliateIds = uniqLowerStrings(parsed.denylist && parsed.denylist.affiliateIds, { max: 500 });
  out.denylist.referrerDomains = uniqLowerStrings(parsed.denylist && parsed.denylist.referrerDomains, { max: 500 });

  // AI (no secrets here)
  out.ai = { ...base.ai };
  if (parsed.ai && typeof parsed.ai === 'object') {
    out.ai.enabled = parsed.ai.enabled === true;
    const provider = String(parsed.ai.provider || base.ai.provider).trim().toLowerCase();
    out.ai.provider = provider || base.ai.provider;
    const model = String(parsed.ai.model || base.ai.model).trim();
    out.ai.model = model ? model.slice(0, 64) : base.ai.model;
    const ver = String(parsed.ai.version || base.ai.version).trim();
    out.ai.version = ver ? ver.slice(0, 32) : base.ai.version;
  }

  return out;
}

async function tableOk() {
  if (_tableOk === true) return true;
  if (_tableOk === false) return false;
  try {
    await getDb().get('SELECT 1 FROM fraud_config LIMIT 1');
    _tableOk = true;
    return true;
  } catch (_) {
    _tableOk = false;
    return false;
  }
}

async function readFraudConfig({ allowCache = true } = {}) {
  const now = Date.now();
  if (allowCache && _cache && (now - _cache.at) >= 0 && (now - _cache.at) < CACHE_TTL_MS) {
    return { ok: true, fromDb: _cache.fromDb, config: _cache.config };
  }

  const base = defaultFraudConfigV1();
  if (!(await tableOk())) {
    _cache = { at: now, fromDb: false, config: base };
    return { ok: true, fromDb: false, config: base };
  }

  try {
    const row = await getDb().get('SELECT value_json FROM fraud_config WHERE key = ? LIMIT 1', [FRAUD_CONFIG_KEY]);
    const cfg = normalizeFraudConfigV1(row && row.value_json ? row.value_json : null);
    const fromDb = !!(row && row.value_json);
    _cache = { at: now, fromDb, config: cfg };
    return { ok: true, fromDb, config: cfg };
  } catch (_) {
    _cache = { at: now, fromDb: false, config: base };
    return { ok: true, fromDb: false, config: base };
  }
}

async function writeFraudConfig(nextConfig) {
  const normalized = normalizeFraudConfigV1(nextConfig);
  const now = Date.now();
  if (!(await tableOk())) return { ok: false, error: 'fraud_config table missing' };
  const json = JSON.stringify(normalized);
  await getDb().run(
    `
    INSERT INTO fraud_config (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET
      value_json = EXCLUDED.value_json,
      updated_at = EXCLUDED.updated_at
    `,
    [FRAUD_CONFIG_KEY, json, now]
  );
  _cache = { at: now, fromDb: true, config: normalized };
  return { ok: true, config: normalized };
}

module.exports = {
  FRAUD_CONFIG_KEY,
  defaultFraudConfigV1,
  normalizeFraudConfigV1,
  readFraudConfig,
  writeFraudConfig,
};

