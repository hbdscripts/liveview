const crypto = require('crypto');

const TRAFFIC_SOURCES_CONFIG_KEY = 'traffic_sources_config_v1';
const TRAFFIC_SOURCES_CONFIG_VERSION = 1;

function defaultTrafficSourcesConfigV1() {
  // Keep defaults small but useful: distinguish affiliate-driven paid clicks from house ads.
  // Users can refine into per-network/per-campaign sources later via Settings → Sources.
  return {
    v: TRAFFIC_SOURCES_CONFIG_VERSION,
    sources: [
      {
        key: 'google_ads_affiliate',
        label: 'Google Ads (Affiliate)',
        enabled: true,
        order: 10,
        iconSpec: 'fa-brands fa-google',
        rules: [
          {
            id: 'affiliate_gclid',
            label: 'Affiliate + gclid',
            enabled: true,
            when: {
              source_kind: { any: ['affiliate'] },
              param_names: { any: ['gclid', 'gbraid', 'wbraid'] },
            },
          },
        ],
      },
      {
        key: 'google_ads_house',
        label: 'Google Ads (House)',
        enabled: true,
        order: 11,
        iconSpec: 'fa-brands fa-google',
        rules: [
          {
            id: 'house_gclid',
            label: 'Not affiliate + gclid',
            enabled: true,
            when: {
              source_kind: { none: ['affiliate'] },
              param_names: { any: ['gclid', 'gbraid', 'wbraid'] },
            },
          },
        ],
      },
      {
        key: 'bing_ads_affiliate',
        label: 'Bing Ads (Affiliate)',
        enabled: true,
        order: 20,
        iconSpec: 'fa-brands fa-microsoft',
        rules: [
          {
            id: 'affiliate_msclkid',
            label: 'Affiliate + msclkid',
            enabled: true,
            when: {
              source_kind: { any: ['affiliate'] },
              param_names: { any: ['msclkid'] },
            },
          },
        ],
      },
      {
        key: 'bing_ads_house',
        label: 'Bing Ads (House)',
        enabled: true,
        order: 21,
        iconSpec: 'fa-brands fa-microsoft',
        rules: [
          {
            id: 'house_msclkid',
            label: 'Not affiliate + msclkid',
            enabled: true,
            when: {
              source_kind: { none: ['affiliate'] },
              param_names: { any: ['msclkid'] },
            },
          },
        ],
      },
      {
        key: 'facebook_ads_affiliate',
        label: 'Facebook Ads (Affiliate)',
        enabled: true,
        order: 30,
        iconSpec: 'fa-brands fa-facebook',
        rules: [
          {
            id: 'affiliate_fbclid',
            label: 'Affiliate + fbclid',
            enabled: true,
            when: {
              source_kind: { any: ['affiliate'] },
              param_names: { any: ['fbclid'] },
            },
          },
        ],
      },
      {
        key: 'facebook_ads_house',
        label: 'Facebook Ads (House)',
        enabled: true,
        order: 31,
        iconSpec: 'fa-brands fa-facebook',
        rules: [
          {
            id: 'house_fbclid',
            label: 'Not affiliate + fbclid',
            enabled: true,
            when: {
              source_kind: { none: ['affiliate'] },
              param_names: { any: ['fbclid'] },
            },
          },
        ],
      },
    ],
  };
}

function safeJsonParseObject(raw) {
  try {
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

function slugify(input, fallback) {
  const raw = input == null ? '' : String(input);
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  if (slug) return slug;
  return fallback || 'source';
}

function normalizeLabel(input, fallback) {
  const raw = input == null ? '' : String(input);
  const s = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
  return s || (fallback || '');
}

function normalizeToken(raw) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.slice(0, 256);
}

function normalizeTokenList(rawList) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(rawList)) return out;
  for (const item of rawList) {
    const token = normalizeToken(item);
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function normalizeIconSpec(raw) {
  const s = raw == null ? '' : String(raw).trim();
  if (!s) return '';
  // Inline SVG markup
  if (/^<svg[\s>]/i.test(s)) {
    const clipped = s.length > 12000 ? s.slice(0, 12000) : s;
    // Minimal safety: reject obvious scripting hooks.
    if (/<script[\s>]/i.test(clipped)) return '';
    if (/\son[a-z]+\s*=/i.test(clipped)) return '';
    if (/javascript:/i.test(clipped)) return '';
    if (!/<\/svg>\s*$/i.test(clipped)) return '';
    return clipped;
  }
  // Image URL (uploads live here)
  if (/^(https?:\/\/|\/\/|\/)/i.test(s)) {
    if (s.length > 2048) return '';
    if (/[<>"'\r\n\t ]/.test(s)) return '';
    return s;
  }
  // Font Awesome class string (or future icon class systems)
  return s.replace(/\s+/g, ' ').slice(0, 160);
}

function normalizeCondition(rawCond) {
  const obj = rawCond && typeof rawCond === 'object' ? rawCond : {};
  const any = normalizeTokenList(obj.any);
  const none = normalizeTokenList(obj.none);
  return { any, none };
}

const RULE_FIELDS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'referrer_host',
  'param_names',
  'param_pairs',
  'source_kind',
  'affiliate_network_hint',
  'affiliate_id_hint',
  'traffic_source_key_v1',
];

function normalizeRule(rawRule, index) {
  const obj = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const label = normalizeLabel(obj.label, `Rule ${index + 1}`);
  const id = slugify(obj.id || label, `rule_${index + 1}`);
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const whenRaw = (obj.when && typeof obj.when === 'object') ? obj.when : (obj.match && typeof obj.match === 'object' ? obj.match : {});
  const when = {};
  for (const f of RULE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(whenRaw, f)) continue;
    when[f] = normalizeCondition(whenRaw[f]);
  }
  return { id, label, enabled, when };
}

function normalizeRules(rawRules) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(rawRules)) return out;
  for (let i = 0; i < rawRules.length; i += 1) {
    const r = normalizeRule(rawRules[i], i);
    if (!r.id) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function normalizeSource(rawSource, index) {
  const obj = rawSource && typeof rawSource === 'object' ? rawSource : {};
  const label = normalizeLabel(obj.label || obj.name, `Source ${index + 1}`);
  const key = slugify(obj.key || obj.id || label, `source_${index + 1}`);
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const orderRaw = Number(obj.order);
  const order = Number.isFinite(orderRaw) ? Math.max(0, Math.trunc(orderRaw)) : index + 1;
  const iconSpec = normalizeIconSpec(obj.iconSpec ?? obj.icon_spec ?? obj.icon ?? '');
  const rules = normalizeRules(obj.rules);
  return { key, label, enabled, order, iconSpec, rules };
}

function sortSourcesByOrderThenLabel(a, b) {
  const ao = Number.isFinite(a && a.order) ? a.order : 0;
  const bo = Number.isFinite(b && b.order) ? b.order : 0;
  if (ao !== bo) return ao - bo;
  const al = a && a.label ? String(a.label).toLowerCase() : '';
  const bl = b && b.label ? String(b.label).toLowerCase() : '';
  if (al < bl) return -1;
  if (al > bl) return 1;
  return 0;
}

function normalizeTrafficSourcesConfigV1(raw) {
  const defaults = defaultTrafficSourcesConfigV1();
  const parsed = safeJsonParseObject(raw);
  if (!parsed || parsed.v !== TRAFFIC_SOURCES_CONFIG_VERSION) return defaults;

  const rawSources = Array.isArray(parsed.sources) ? parsed.sources : [];
  const sources = [];
  const seen = new Set();
  for (let i = 0; i < rawSources.length; i += 1) {
    const s = normalizeSource(rawSources[i], i);
    if (!s.key) continue;
    if (seen.has(s.key)) continue;
    seen.add(s.key);
    sources.push(s);
  }
  sources.sort(sortSourcesByOrderThenLabel);

  return { v: TRAFFIC_SOURCES_CONFIG_VERSION, sources };
}

function normalizeTrafficSourcesConfigForSave(raw) {
  const parsed = safeJsonParseObject(raw);
  if (!parsed) return defaultTrafficSourcesConfigV1();
  return normalizeTrafficSourcesConfigV1(parsed);
}

function validateTrafficSourcesConfigStructure(config) {
  const errors = [];
  const cfg = config && typeof config === 'object' ? config : null;
  if (!cfg || Number(cfg.v) !== TRAFFIC_SOURCES_CONFIG_VERSION) {
    errors.push('Invalid config version.');
    return { ok: false, errors };
  }
  const sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  if (!Array.isArray(cfg.sources)) errors.push('sources must be an array.');
  const keys = new Set();
  for (const s of sources) {
    if (!s || typeof s !== 'object') { errors.push('Invalid source row.'); continue; }
    const key = typeof s.key === 'string' ? s.key.trim().toLowerCase() : '';
    if (!key) { errors.push('Source key is required.'); continue; }
    if (keys.has(key)) errors.push(`Duplicate source key: ${key}`);
    keys.add(key);
    if (!s.label || !String(s.label).trim()) errors.push(`Source ${key} is missing label.`);
    if (s.rules != null && !Array.isArray(s.rules)) errors.push(`Source ${key} rules must be an array.`);
    for (const r of (Array.isArray(s.rules) ? s.rules : [])) {
      if (!r || typeof r !== 'object') { errors.push(`Source ${key} has invalid rule.`); continue; }
      if (!r.id || !String(r.id).trim()) errors.push(`Source ${key} has a rule missing id.`);
      if (r.when != null && typeof r.when !== 'object') errors.push(`Source ${key} rule ${String(r.id || '')} has invalid when.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function safeUrlParams(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    return new URL(raw).searchParams;
  } catch (_) {
    try {
      return new URL('https://' + raw).searchParams;
    } catch (_) {
      try {
        return new URL(raw, 'https://example.local').searchParams;
      } catch (_) {
        return null;
      }
    }
  }
}

function safeUrlHost(url) {
  if (typeof url !== 'string') return '';
  const raw = url.trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    try {
      return new URL('https://' + raw).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }
}

function normalizeTextValue(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  return s.slice(0, 2048);
}

function normalizeTokenForEq(raw) {
  const s = normalizeToken(raw);
  if (!s) return { mode: 'contains', value: '' };
  if (s.startsWith('eq:')) return { mode: 'eq', value: s.slice(3).trim() };
  if (s[0] === '=' && s.length > 1) return { mode: 'eq', value: s.slice(1).trim() };
  return { mode: 'contains', value: s };
}

function tokenMatchesText(rawValue, tokenRaw) {
  const val = normalizeTextValue(rawValue);
  const t = normalizeTokenForEq(tokenRaw);
  if (!val || !t.value) return false;
  if (t.mode === 'eq') return val === t.value;

  // Boundary-safe match when token is plain words.
  if (/^[a-z0-9 ]+$/.test(t.value)) {
    const normalized = ` ${val.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
    return normalized.includes(` ${t.value} `);
  }
  return val.includes(t.value);
}

function tokenMatchesSet(set, tokenRaw) {
  const t = normalizeTokenForEq(tokenRaw);
  if (!t.value) return false;
  const v = t.value;
  if (t.mode === 'eq') return set && typeof set.has === 'function' ? set.has(v) : false;
  // For sets, treat contains as exact key hit (stable param names).
  return set && typeof set.has === 'function' ? set.has(v) : false;
}

function ruleMatchesContext(rule, ctx) {
  if (!rule || !rule.when || typeof rule.when !== 'object') return false;
  for (const field of Object.keys(rule.when)) {
    const cond = rule.when[field];
    const any = Array.isArray(cond && cond.any) ? cond.any : [];
    const none = Array.isArray(cond && cond.none) ? cond.none : [];

    const val = ctx[field];
    const isSetField = val && typeof val.has === 'function';

    if (any.length) {
      let okAny = false;
      for (const t of any) {
        if (isSetField ? tokenMatchesSet(val, t) : tokenMatchesText(val, t)) { okAny = true; break; }
      }
      if (!okAny) return false;
    }
    if (none.length) {
      for (const t of none) {
        if (isSetField ? tokenMatchesSet(val, t) : tokenMatchesText(val, t)) return false;
      }
    }
  }
  return true;
}

function ruleSpecificity(rule, ctx) {
  if (!rule || !rule.when || typeof rule.when !== 'object') return 0;
  let constraints = 0;
  let tokenScore = 0;
  for (const field of Object.keys(rule.when)) {
    const cond = rule.when[field];
    const any = Array.isArray(cond && cond.any) ? cond.any : [];
    const none = Array.isArray(cond && cond.none) ? cond.none : [];
    if (any.length) constraints += 1;
    if (none.length) constraints += 1;

    const val = ctx[field];
    const isSetField = val && typeof val.has === 'function';
    if (any.length) {
      let best = 0;
      for (const t of any) {
        const tn = normalizeTokenForEq(t);
        const candidateLen = tn.value ? tn.value.replace(/\s+/g, '').length : 0;
        const hit = isSetField ? tokenMatchesSet(val, t) : tokenMatchesText(val, t);
        if (!hit) continue;
        if (candidateLen > best) best = candidateLen;
      }
      tokenScore += best;
    }
  }
  // Heavily bias toward more constrained rules.
  return constraints * 1000 + tokenScore;
}

function buildTrafficSourceContext({ session, affiliate } = {}) {
  const s = session && typeof session === 'object' ? session : {};
  const a = affiliate && typeof affiliate === 'object' ? affiliate : {};

  const entryUrl = (s.entry_url ?? s.entryUrl ?? '').toString();
  const params = safeUrlParams(entryUrl);
  const paramNames = new Set();
  const paramPairs = new Set();
  if (params) {
    try {
      for (const [k, v] of params.entries()) {
        const kk = normalizeToken(k);
        if (kk) paramNames.add(kk);
        const vv = normalizeToken(v);
        if (kk && vv) paramPairs.add(`${kk}=${vv}`.slice(0, 512));
      }
    } catch (_) {}
  }

  // Include click-id keys from affiliate attribution evidence (if present).
  function addKeysFromJson(rawJson) {
    try {
      if (!rawJson) return;
      const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
      if (!parsed || typeof parsed !== 'object') return;
      for (const k of Object.keys(parsed)) {
        const kk = normalizeToken(k);
        if (kk) paramNames.add(kk);
      }
    } catch (_) {}
  }
  addKeysFromJson(a.paid_click_ids_json || a.paidClickIdsJson);
  addKeysFromJson(a.affiliate_click_ids_json || a.affiliateClickIdsJson);

  return {
    utm_source: normalizeTextValue(s.utm_source ?? s.utmSource),
    utm_medium: normalizeTextValue(s.utm_medium ?? s.utmMedium),
    utm_campaign: normalizeTextValue(s.utm_campaign ?? s.utmCampaign),
    utm_content: normalizeTextValue(s.utm_content ?? s.utmContent),
    utm_term: normalizeTextValue(s.utm_term ?? s.utmTerm),
    referrer_host: safeUrlHost((s.referrer ?? s.referrerUrl ?? '') || ''),
    param_names: paramNames,
    param_pairs: paramPairs,
    source_kind: normalizeTextValue(a.source_kind ?? a.sourceKind),
    affiliate_network_hint: normalizeTextValue(a.affiliate_network_hint ?? a.affiliateNetworkHint),
    affiliate_id_hint: normalizeTextValue(a.affiliate_id_hint ?? a.affiliateIdHint),
    traffic_source_key_v1: normalizeTextValue(s.traffic_source_key ?? s.trafficSourceKey),
  };
}

function matchTrafficSource(ctx, config) {
  const cfg = normalizeTrafficSourcesConfigV1(config);
  const sources = Array.isArray(cfg.sources) ? cfg.sources : [];
  const matches = [];
  let globalIndex = 0;
  for (const src of sources) {
    if (!src || src.enabled === false) { globalIndex += 1000; continue; }
    const rules = Array.isArray(src.rules) ? src.rules : [];
    for (let i = 0; i < rules.length; i += 1) {
      const r = rules[i];
      const idx = globalIndex + i;
      if (!r || r.enabled === false) continue;
      if (!ruleMatchesContext(r, ctx)) continue;
      const spec = ruleSpecificity(r, ctx);
      matches.push({ source: src, rule: r, specificity: spec, index: idx });
    }
    globalIndex += 1000;
  }

  if (!matches.length) return { kind: 'unmatched' };
  matches.sort((a, b) => {
    const spec = (Number(b.specificity) || 0) - (Number(a.specificity) || 0);
    if (spec !== 0) return spec;
    return (Number(a.index) || 0) - (Number(b.index) || 0);
  });
  const winner = matches[0];
  return {
    kind: 'matched',
    key: winner.source && winner.source.key ? String(winner.source.key) : '',
    label: winner.source && winner.source.label ? String(winner.source.label) : '',
    iconSpec: winner.source && winner.source.iconSpec ? String(winner.source.iconSpec) : '',
    resolved: matches.length > 1,
    specificity: winner.specificity,
    ruleId: winner.rule && winner.rule.id ? String(winner.rule.id) : '',
  };
}

function stableIdFromConfig(config) {
  const json = JSON.stringify(config || {});
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  return hash.slice(0, 16);
}

module.exports = {
  TRAFFIC_SOURCES_CONFIG_KEY,
  TRAFFIC_SOURCES_CONFIG_VERSION,
  defaultTrafficSourcesConfigV1,
  normalizeTrafficSourcesConfigV1,
  normalizeTrafficSourcesConfigForSave,
  validateTrafficSourcesConfigStructure,
  buildTrafficSourceContext,
  matchTrafficSource,
  normalizeIconSpec,
  stableIdFromConfig,
};

