/**
 * Acquisition attribution derivation (single source of truth).
 *
 * - Read attribution config from DB tables (cached).
 * - Derive attribution from signals (UTMs, click IDs, referrer, entry URL params).
 * - Record observed tokens to attribution_observed for mapping UI (best-effort; fail-open).
 *
 * Non-negotiable: explicit `kexo_attr=<variant_key>` only wins when allowlisted and then uses
 * confidence = "explicit_param".
 */
const { getDb } = require('../db');

const CONFIG_CACHE_TTL_MS = 60 * 1000;

let _configCache = null;
let _configCacheAt = 0;
let _configCacheInFlight = null;

function trimLower(v, maxLen) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return '';
  const lim = typeof maxLen === 'number' ? maxLen : 256;
  return s.length > lim ? s.slice(0, lim) : s;
}

function normalizeVariantKey(raw) {
  const s = raw == null ? '' : String(raw);
  const out = s.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
  return out.length > 120 ? out.slice(0, 120) : out;
}

function normalizeOwnerKind(raw) {
  const s = trimLower(raw, 32);
  if (s === 'affiliate' || s === 'partner' || s === 'house') return s;
  return 'house';
}

function safeUrlHost(urlRaw) {
  const raw = typeof urlRaw === 'string' ? urlRaw.trim() : '';
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

/** True if referrer host is internal/self (store, Shopify checkout, etc.) — treat as no referrer for classification. */
function isInternalReferrerHost(referrerHost, entryUrl) {
  const host = typeof referrerHost === 'string' ? referrerHost.trim().toLowerCase() : '';
  if (!host) return false;
  const entryHost = safeUrlHost(entryUrl);
  if (entryHost && (host === entryHost || host.endsWith('.' + entryHost))) return true;
  if (host === 'checkout.shopify.com' || host === 'shopify.com') return true;
  if (host === 'myshopify.com' || host.endsWith('.myshopify.com')) return true;
  return false;
}

function safeParseUrl(urlRaw) {
  const raw = typeof urlRaw === 'string' ? urlRaw.trim() : '';
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch (_) {
    try {
      return new URL('https://' + raw);
    } catch (_) {
      return null;
    }
  }
}

function parseEntryUrlParams(entryUrl) {
  const u = safeParseUrl(entryUrl);
  if (!u) return { params: {}, paramNames: [], paramPairs: [] };
  const params = {};
  const names = [];
  const pairs = [];
  try {
    for (const [k, v] of u.searchParams.entries()) {
      const key = trimLower(String(k || ''), 80);
      const val = trimLower(String(v || ''), 256);
      if (!key) continue;
      if (!Object.prototype.hasOwnProperty.call(params, key)) params[key] = [];
      params[key].push(val);
    }
  } catch (_) {}
  Object.keys(params).forEach((k) => {
    names.push(k);
    const vals = Array.isArray(params[k]) ? params[k] : [];
    vals.forEach((v) => {
      if (v == null || v === '') return;
      pairs.push(k + '=' + v);
    });
  });
  names.sort();
  return { params, paramNames: names, paramPairs: pairs };
}

function extractClickIds(entryParams) {
  const p = entryParams && entryParams.params ? entryParams.params : {};
  function first(key) {
    const arr = p[key];
    if (!Array.isArray(arr) || !arr.length) return '';
    return trimLower(arr[0], 256);
  }
  return {
    gclid: first('gclid'),
    msclkid: first('msclkid'),
    fbclid: first('fbclid'),
    ttclid: first('ttclid'),
    twclid: first('twclid'),
    wbraid: first('wbraid'),
    gbraid: first('gbraid'),
    yclid: first('yclid'),
  };
}

function looksPaidMedium(medium) {
  const m = trimLower(medium, 64);
  if (!m) return false;
  return m === 'cpc' || m === 'ppc' || m === 'paid' || m.indexOf('paid_') === 0 || m.indexOf('paid-') === 0 ||
    m.indexOf('cpc') >= 0 || m.indexOf('ppc') >= 0;
}

function looksEmailMedium(medium) {
  const m = trimLower(medium, 64);
  return !!(m && (m === 'email' || m.indexOf('email') >= 0));
}

function looksSmsMedium(medium) {
  const m = trimLower(medium, 64);
  return !!(m && (m === 'sms' || m.indexOf('sms') >= 0 || m.indexOf('text') >= 0));
}

function sourceKeyFromUtmSource(utmSource) {
  const s = trimLower(utmSource, 128);
  if (!s) return '';
  if (s.indexOf('google') >= 0) return 'google';
  if (s.indexOf('bing') >= 0) return 'bing';
  if (s.indexOf('meta') >= 0 || s.indexOf('facebook') >= 0 || s.indexOf('instagram') >= 0) return 'meta';
  if (s.indexOf('tiktok') >= 0) return 'tiktok';
  if (s.indexOf('pinterest') >= 0) return 'pinterest';
  if (s.indexOf('omnisend') >= 0) return 'omnisend';
  if (s.indexOf('klaviyo') >= 0) return 'klaviyo';
  return '';
}

function inferMetaFromVariantKey(variantKey) {
  const key = normalizeVariantKey(variantKey);
  if (!key) return { channel_key: 'other', source_key: 'other', owner_kind: 'house', partner_id: null, network: null };
  const parts = key.split(':').filter(Boolean);
  const head = parts[0] || '';
  const kind = parts[1] || '';
  const id = parts[2] || '';

  function owner() {
    if (kind === 'affiliate') return 'affiliate';
    if (kind === 'partner') return 'partner';
    return 'house';
  }

  if (head === 'google_ads') return { channel_key: 'paid_search', source_key: 'google', owner_kind: owner(), partner_id: id || null, network: null };
  if (head === 'google_organic') return { channel_key: 'organic_search', source_key: 'google', owner_kind: 'house', partner_id: null, network: null };
  if (head === 'bing_ads') return { channel_key: 'paid_search', source_key: 'bing', owner_kind: owner(), partner_id: id || null, network: null };
  if (head === 'bing_organic') return { channel_key: 'organic_search', source_key: 'bing', owner_kind: 'house', partner_id: null, network: null };
  if (head === 'meta_ads') return { channel_key: 'paid_social', source_key: 'meta', owner_kind: owner(), partner_id: id || null, network: null };
  if (head === 'meta_organic') return { channel_key: 'organic_social', source_key: 'meta', owner_kind: 'house', partner_id: null, network: null };
  if (head === 'omnisend') return { channel_key: 'email', source_key: 'omnisend', owner_kind: 'house', partner_id: null, network: null };
  if (head === 'klaviyo') return { channel_key: 'email', source_key: 'klaviyo', owner_kind: 'house', partner_id: null, network: null };
  if (head === 'affiliate') return { channel_key: 'affiliate', source_key: 'other', owner_kind: 'affiliate', partner_id: kind || null, network: null };
  if (head === 'direct') return { channel_key: 'direct', source_key: 'direct', owner_kind: 'house', partner_id: null, network: null };
  if (head === 'other') return { channel_key: 'other', source_key: 'other', owner_kind: 'house', partner_id: null, network: null };
  return { channel_key: 'other', source_key: 'other', owner_kind: 'house', partner_id: null, network: null };
}

function matchListAny(valueOrList, anyList) {
  const any = Array.isArray(anyList) ? anyList : [];
  if (!any.length) return true;
  const values = Array.isArray(valueOrList) ? valueOrList : [valueOrList];
  const hay = values.map((v) => trimLower(String(v == null ? '' : v), 512)).filter(Boolean);
  if (!hay.length) return false;
  return any.some((t) => {
    const needle = trimLower(String(t == null ? '' : t), 512);
    if (!needle) return false;
    return hay.indexOf(needle) >= 0;
  });
}

function matchListNone(valueOrList, noneList) {
  const none = Array.isArray(noneList) ? noneList : [];
  if (!none.length) return true;
  const values = Array.isArray(valueOrList) ? valueOrList : [valueOrList];
  const hay = values.map((v) => trimLower(String(v == null ? '' : v), 512)).filter(Boolean);
  if (!hay.length) return true;
  return none.every((t) => {
    const needle = trimLower(String(t == null ? '' : t), 512);
    if (!needle) return true;
    return hay.indexOf(needle) < 0;
  });
}

function ruleMatches(match, ctx) {
  const m = match && typeof match === 'object' ? match : {};
  const keys = Object.keys(m);
  if (!keys.length) return false;
  for (const field of keys) {
    const cond = m[field] && typeof m[field] === 'object' ? m[field] : {};
    const any = Array.isArray(cond.any) ? cond.any : [];
    const none = Array.isArray(cond.none) ? cond.none : [];
    const v = ctx && Object.prototype.hasOwnProperty.call(ctx, field) ? ctx[field] : null;
    if (!matchListAny(v, any)) return false;
    if (!matchListNone(v, none)) return false;
  }
  return true;
}

async function readAttributionConfigFromDb() {
  const db = getDb();
  const now = Date.now();
  let channels = [];
  let sources = [];
  let variants = [];
  let rules = [];
  let allowlist = [];
  try {
    channels = await db.all('SELECT channel_key, label, sort_order, enabled, updated_at FROM attribution_channels ORDER BY sort_order ASC, label ASC');
    sources = await db.all('SELECT source_key, label, icon_spec, sort_order, enabled, updated_at FROM attribution_sources ORDER BY sort_order ASC, label ASC');
    variants = await db.all('SELECT variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at FROM attribution_variants ORDER BY sort_order ASC, label ASC');
    rules = await db.all('SELECT id, label, priority, enabled, variant_key, match_json, created_at, updated_at FROM attribution_rules ORDER BY priority ASC, created_at ASC');
    allowlist = await db.all('SELECT variant_key, enabled, updated_at FROM attribution_allowlist ORDER BY variant_key ASC');
  } catch (_) {
    channels = [];
    sources = [];
    variants = [];
    rules = [];
    allowlist = [];
  }

  const channelsByKey = new Map();
  (channels || []).forEach((r) => {
    const k = trimLower(r && r.channel_key != null ? String(r.channel_key) : '', 32);
    if (!k) return;
    channelsByKey.set(k, {
      key: k,
      label: r && r.label != null ? String(r.label) : k,
      sort_order: r && r.sort_order != null ? Number(r.sort_order) : 0,
      enabled: !!Number(r && r.enabled),
      updated_at: r && r.updated_at != null ? Number(r.updated_at) : now,
    });
  });

  const sourcesByKey = new Map();
  (sources || []).forEach((r) => {
    const k = trimLower(r && r.source_key != null ? String(r.source_key) : '', 32);
    if (!k) return;
    sourcesByKey.set(k, {
      key: k,
      label: r && r.label != null ? String(r.label) : k,
      icon_spec: r && r.icon_spec != null ? String(r.icon_spec) : null,
      sort_order: r && r.sort_order != null ? Number(r.sort_order) : 0,
      enabled: !!Number(r && r.enabled),
      updated_at: r && r.updated_at != null ? Number(r.updated_at) : now,
    });
  });

  const variantsByKey = new Map();
  (variants || []).forEach((r) => {
    const k = normalizeVariantKey(r && r.variant_key != null ? String(r.variant_key) : '');
    if (!k) return;
    variantsByKey.set(k, {
      key: k,
      label: r && r.label != null ? String(r.label) : k,
      channel_key: trimLower(r && r.channel_key != null ? String(r.channel_key) : '', 32) || 'other',
      source_key: trimLower(r && r.source_key != null ? String(r.source_key) : '', 32) || 'other',
      owner_kind: normalizeOwnerKind(r && r.owner_kind != null ? String(r.owner_kind) : ''),
      partner_id: r && r.partner_id != null && String(r.partner_id).trim() ? String(r.partner_id).trim().slice(0, 128) : null,
      network: r && r.network != null && String(r.network).trim() ? String(r.network).trim().slice(0, 32) : null,
      icon_spec: r && r.icon_spec != null ? String(r.icon_spec) : null,
      sort_order: r && r.sort_order != null ? Number(r.sort_order) : 0,
      enabled: !!Number(r && r.enabled),
      updated_at: r && r.updated_at != null ? Number(r.updated_at) : now,
    });
  });

  const parsedRules = [];
  (rules || []).forEach((r) => {
    const id = trimLower(r && r.id != null ? String(r.id) : '', 80);
    const variantKey = normalizeVariantKey(r && r.variant_key != null ? String(r.variant_key) : '');
    if (!id || !variantKey) return;
    let match = {};
    try {
      match = r && r.match_json ? JSON.parse(String(r.match_json)) : {};
      if (!match || typeof match !== 'object') match = {};
    } catch (_) {
      match = {};
    }
    parsedRules.push({
      id,
      label: r && r.label != null ? String(r.label) : id,
      priority: r && r.priority != null ? Number(r.priority) : 0,
      enabled: !!Number(r && r.enabled),
      variant_key: variantKey,
      match,
      created_at: r && r.created_at != null ? Number(r.created_at) : now,
      updated_at: r && r.updated_at != null ? Number(r.updated_at) : now,
    });
  });
  parsedRules.sort((a, b) => (Number(a.priority) - Number(b.priority)) || (Number(a.created_at) - Number(b.created_at)) || String(a.id).localeCompare(String(b.id)));

  const allowlisted = new Map();
  (allowlist || []).forEach((r) => {
    const k = normalizeVariantKey(r && r.variant_key != null ? String(r.variant_key) : '');
    if (!k) return;
    allowlisted.set(k, !!Number(r && r.enabled));
  });

  return {
    channelsByKey,
    sourcesByKey,
    variantsByKey,
    rules: parsedRules,
    allowlistedVariants: allowlisted,
  };
}

function invalidateAttributionConfigCache() {
  _configCache = null;
  _configCacheAt = 0;
  _configCacheInFlight = null;
}

async function readAttributionConfigCached(opts = {}) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (!force && _configCache && (now - _configCacheAt) < CONFIG_CACHE_TTL_MS) return _configCache;
  if (!force && _configCacheInFlight) return _configCacheInFlight;
  _configCacheInFlight = Promise.resolve()
    .then(() => readAttributionConfigFromDb())
    .then((cfg) => {
      _configCache = cfg;
      _configCacheAt = Date.now();
      return cfg;
    })
    .catch(() => {
      const fallback = {
        channelsByKey: new Map(),
        sourcesByKey: new Map(),
        variantsByKey: new Map(),
        rules: [],
        allowlistedVariants: new Map(),
      };
      _configCache = fallback;
      _configCacheAt = Date.now();
      return fallback;
    })
    .finally(() => {
      _configCacheInFlight = null;
    });
  return _configCacheInFlight;
}

async function upsertObservedToken(db, tokenType, tokenValue, nowMs, sampleEntryUrl) {
  const t = trimLower(tokenType, 48);
  const v = trimLower(tokenValue, 256);
  if (!t || !v) return;
  const url = typeof sampleEntryUrl === 'string' && sampleEntryUrl.trim() ? String(sampleEntryUrl).trim().slice(0, 2048) : null;
  try {
    await db.run(
      `
        INSERT INTO attribution_observed (token_type, token_value, first_seen_at, last_seen_at, seen_count, sample_entry_url)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (token_type, token_value) DO UPDATE SET
          last_seen_at = excluded.last_seen_at,
          seen_count = attribution_observed.seen_count + 1,
          sample_entry_url = COALESCE(attribution_observed.sample_entry_url, excluded.sample_entry_url)
      `,
      [t, v, nowMs, nowMs, 1, url]
    );
  } catch (_) {}
}

async function deriveAttribution(inputs = {}) {
  const nowMs = inputs && Number.isFinite(Number(inputs.now_ms)) ? Number(inputs.now_ms) : Date.now();
  const entryUrl = inputs && typeof inputs.entry_url === 'string' ? inputs.entry_url.trim().slice(0, 2048) : '';
  const referrer = inputs && typeof inputs.referrer === 'string' ? inputs.referrer.trim().slice(0, 2048) : '';
  const utmSource = trimLower(inputs && inputs.utm_source != null ? String(inputs.utm_source) : '', 256) || '';
  const utmMedium = trimLower(inputs && inputs.utm_medium != null ? String(inputs.utm_medium) : '', 256) || '';
  const utmCampaign = trimLower(inputs && inputs.utm_campaign != null ? String(inputs.utm_campaign) : '', 256) || '';
  const utmContent = trimLower(inputs && inputs.utm_content != null ? String(inputs.utm_content) : '', 256) || '';
  const utmTerm = trimLower(inputs && inputs.utm_term != null ? String(inputs.utm_term) : '', 256) || '';

  const entry = parseEntryUrlParams(entryUrl);
  const clickIds = extractClickIds(entry);
  const referrerHost = safeUrlHost(referrer);
  const effectiveReferrerHost = isInternalReferrerHost(referrerHost, entryUrl) ? '' : referrerHost;

  const cfg = await readAttributionConfigCached().catch(() => null);
  const variantsByKey = cfg && cfg.variantsByKey ? cfg.variantsByKey : new Map();
  const allowlistedVariants = cfg && cfg.allowlistedVariants ? cfg.allowlistedVariants : new Map();
  const rules = cfg && Array.isArray(cfg.rules) ? cfg.rules : [];

  const ctx = {
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
    utm_content: utmContent,
    utm_term: utmTerm,
    referrer_host: referrerHost,
    param_names: entry.paramNames,
    param_pairs: entry.paramPairs,
  };

  const db = getDb();
  // Observed tokens (best-effort) for mapping UI.
  upsertObservedToken(db, 'referrer_host', referrerHost, nowMs, entryUrl);
  upsertObservedToken(db, 'utm_source', utmSource, nowMs, entryUrl);
  upsertObservedToken(db, 'utm_medium', utmMedium, nowMs, entryUrl);
  upsertObservedToken(db, 'utm_campaign', utmCampaign, nowMs, entryUrl);
  upsertObservedToken(db, 'utm_content', utmContent, nowMs, entryUrl);
  upsertObservedToken(db, 'utm_term', utmTerm, nowMs, entryUrl);
  // Useful click-id hints for mapping.
  Object.keys(clickIds || {}).forEach((k) => {
    const v = clickIds[k];
    if (v) {
      upsertObservedToken(db, 'param_name', k, nowMs, entryUrl);
      upsertObservedToken(db, 'param_pair', k + '=' + v, nowMs, entryUrl);
    }
  });

  function resolveVariantMeta(variantKey) {
    const k = normalizeVariantKey(variantKey);
    const row = variantsByKey.get(k);
    if (row && row.enabled !== false) {
      return {
        variant: k,
        channel_key: row.channel_key || 'other',
        source_key: row.source_key || 'other',
        owner_kind: normalizeOwnerKind(row.owner_kind),
        partner_id: row.partner_id || null,
        network: row.network || null,
      };
    }
    const inferred = inferMetaFromVariantKey(k);
    return {
      variant: k || 'other:house',
      channel_key: inferred.channel_key || 'other',
      source_key: inferred.source_key || 'other',
      owner_kind: normalizeOwnerKind(inferred.owner_kind),
      partner_id: inferred.partner_id || null,
      network: inferred.network || null,
    };
  }

  // 1) Explicit param (allowlisted only)
  let explicitRaw = '';
  try {
    const v = entry && entry.params && entry.params.kexo_attr ? entry.params.kexo_attr : null;
    explicitRaw = Array.isArray(v) && v.length ? String(v[0] || '') : '';
  } catch (_) { explicitRaw = ''; }
  const explicitVariantKey = normalizeVariantKey(explicitRaw);
  if (explicitVariantKey) {
    upsertObservedToken(db, 'kexo_attr', explicitVariantKey, nowMs, entryUrl);
    const allow = allowlistedVariants && allowlistedVariants.get(explicitVariantKey) === true;
    if (allow) {
      const meta = resolveVariantMeta(explicitVariantKey);
      return {
        channel: meta.channel_key,
        source: meta.source_key,
        variant: meta.variant,
        owner_kind: meta.owner_kind,
        partner_id: meta.partner_id,
        network: meta.network,
        confidence: 'explicit_param',
        evidence_json: {
          winner: 'explicit_param',
          explicit: { variant_key: explicitVariantKey, allowlisted: true },
          inputs: { entry_url: entryUrl || null, referrer: referrer || null, utm_source: utmSource || null, utm_medium: utmMedium || null, utm_campaign: utmCampaign || null, utm_content: utmContent || null, utm_term: utmTerm || null },
          referrer_host: referrerHost || null,
          click_ids: clickIds,
        },
      };
    }
  }

  // 2) Rules (priority order)
  for (const rule of rules) {
    if (!rule || rule.enabled !== true) continue;
    if (!rule.match || typeof rule.match !== 'object') continue;
    if (!ruleMatches(rule.match, ctx)) continue;
    const meta = resolveVariantMeta(rule.variant_key);
    return {
      channel: meta.channel_key,
      source: meta.source_key,
      variant: meta.variant,
      owner_kind: meta.owner_kind,
      partner_id: meta.partner_id,
      network: meta.network,
      confidence: 'rules',
      evidence_json: {
        winner: 'rules',
        rule: { id: rule.id, variant_key: rule.variant_key, priority: rule.priority },
        explicit: explicitVariantKey ? { variant_key: explicitVariantKey, allowlisted: allowlistedVariants.get(explicitVariantKey) === true } : null,
        inputs: { entry_url: entryUrl || null, referrer: referrer || null, utm_source: utmSource || null, utm_medium: utmMedium || null, utm_campaign: utmCampaign || null, utm_content: utmContent || null, utm_term: utmTerm || null },
        referrer_host: referrerHost || null,
        click_ids: clickIds,
      },
    };
  }

  // 3) Heuristics
  const hasAnyUtm = !!(utmSource || utmMedium || utmCampaign || utmContent || utmTerm);
  const hasAnyClickId = !!(clickIds && (clickIds.gclid || clickIds.msclkid || clickIds.fbclid || clickIds.ttclid || clickIds.twclid || clickIds.wbraid || clickIds.gbraid || clickIds.yclid));
  const isDirect = !hasAnyUtm && !hasAnyClickId && !effectiveReferrerHost;
  if (isDirect) {
    const meta = resolveVariantMeta('direct:house');
    return {
      channel: meta.channel_key,
      source: meta.source_key,
      variant: meta.variant,
      owner_kind: meta.owner_kind,
      partner_id: meta.partner_id,
      network: meta.network,
      confidence: 'direct',
      evidence_json: {
        winner: 'direct',
        inputs: { entry_url: entryUrl || null, referrer: referrer || null },
      },
    };
  }

  // Email/SMS are explicit.
  if (looksEmailMedium(utmMedium)) {
    const src = sourceKeyFromUtmSource(utmSource) || 'other';
    const meta = resolveVariantMeta((src === 'omnisend' || src === 'klaviyo') ? (src + ':house') : 'other:house');
    return {
      channel: 'email',
      source: src,
      variant: meta.variant,
      owner_kind: meta.owner_kind,
      partner_id: meta.partner_id,
      network: meta.network,
      confidence: 'heuristic',
      evidence_json: { winner: 'heuristic', kind: 'email', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null }, click_ids: clickIds },
    };
  }
  if (looksSmsMedium(utmMedium)) {
    return {
      channel: 'sms',
      source: 'other',
      variant: 'other:house',
      owner_kind: 'house',
      partner_id: null,
      network: null,
      confidence: 'heuristic',
      evidence_json: { winner: 'heuristic', kind: 'sms', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null }, click_ids: clickIds },
    };
  }

  // Paid search/social by click IDs and/or utm_medium.
  const srcHint = sourceKeyFromUtmSource(utmSource);
  if (clickIds && (clickIds.gclid || clickIds.wbraid || clickIds.gbraid || (srcHint === 'google' && looksPaidMedium(utmMedium)))) {
    const meta = resolveVariantMeta('google_ads:house');
    return {
      channel: 'paid_search',
      source: 'google',
      variant: meta.variant,
      owner_kind: meta.owner_kind,
      partner_id: meta.partner_id,
      network: meta.network,
      confidence: 'heuristic',
      evidence_json: { winner: 'heuristic', kind: 'google_ads', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null }, click_ids: clickIds },
    };
  }
  if (clickIds && (clickIds.msclkid || (srcHint === 'bing' && looksPaidMedium(utmMedium)))) {
    const meta = resolveVariantMeta('bing_ads:house');
    return {
      channel: 'paid_search',
      source: 'bing',
      variant: meta.variant,
      owner_kind: meta.owner_kind,
      partner_id: meta.partner_id,
      network: meta.network,
      confidence: 'heuristic',
      evidence_json: { winner: 'heuristic', kind: 'bing_ads', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null }, click_ids: clickIds },
    };
  }
  if (clickIds && (clickIds.fbclid || (srcHint === 'meta' && looksPaidMedium(utmMedium)))) {
    const meta = resolveVariantMeta('meta_ads:house');
    return {
      channel: 'paid_social',
      source: 'meta',
      variant: meta.variant,
      owner_kind: meta.owner_kind,
      partner_id: meta.partner_id,
      network: meta.network,
      confidence: 'heuristic',
      evidence_json: { winner: 'heuristic', kind: 'meta_ads', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null }, click_ids: clickIds },
    };
  }

  // Organic search
  if (utmMedium === 'organic' || utmMedium.indexOf('organic') >= 0) {
    if (srcHint === 'google') {
      const meta = resolveVariantMeta('google_organic:house');
      return { channel: 'organic_search', source: 'google', variant: meta.variant, owner_kind: meta.owner_kind, partner_id: meta.partner_id, network: meta.network, confidence: 'heuristic', evidence_json: { winner: 'heuristic', kind: 'google_organic', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null } } };
    }
    if (srcHint === 'bing') {
      const meta = resolveVariantMeta('bing_organic:house');
      return { channel: 'organic_search', source: 'bing', variant: meta.variant, owner_kind: meta.owner_kind, partner_id: meta.partner_id, network: meta.network, confidence: 'heuristic', evidence_json: { winner: 'heuristic', kind: 'bing_organic', inputs: { utm_source: utmSource || null, utm_medium: utmMedium || null } } };
    }
  }

  // Referral (last resort when external referrer is present and we have no UTMs)
  if (effectiveReferrerHost && !hasAnyUtm && !hasAnyClickId) {
    return {
      channel: 'referral',
      source: 'other',
      variant: 'other:house',
      owner_kind: 'house',
      partner_id: null,
      network: null,
      confidence: 'heuristic',
      evidence_json: { winner: 'heuristic', kind: 'referral', referrer_host: referrerHost },
    };
  }

  // Fallback
  return {
    channel: 'other',
    source: 'other',
    variant: 'other:house',
    owner_kind: 'house',
    partner_id: null,
    network: null,
    confidence: 'unknown',
    evidence_json: {
      winner: 'unknown',
      explicit: explicitVariantKey ? { variant_key: explicitVariantKey, allowlisted: allowlistedVariants.get(explicitVariantKey) === true } : null,
      inputs: { entry_url: entryUrl || null, referrer: referrer || null, utm_source: utmSource || null, utm_medium: utmMedium || null, utm_campaign: utmCampaign || null, utm_content: utmContent || null, utm_term: utmTerm || null },
      referrer_host: referrerHost || null,
      click_ids: clickIds,
    },
  };
}

module.exports = {
  normalizeVariantKey,
  invalidateAttributionConfigCache,
  readAttributionConfigCached,
  deriveAttribution,
};

