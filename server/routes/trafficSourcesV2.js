/**
 * Traffic sources v2 (Variants-style) suggestions + diagnostics.
 *
 * - GET  /api/traffic-sources-v2/suggestions
 * - POST /api/traffic-sources-v2/suggestions/apply
 * - GET  /api/traffic-sources-v2/diagnostics
 *
 * Note: These endpoints are best-effort and must fail-open if affiliate_attribution_sessions
 * or token tables are not present yet.
 */
const Sentry = require('@sentry/node');
const store = require('../store');
const { getDb } = require('../db');
const {
  TRAFFIC_SOURCES_CONFIG_KEY,
  defaultTrafficSourcesConfigV1,
  normalizeTrafficSourcesConfigV1,
  normalizeTrafficSourcesConfigForSave,
  validateTrafficSourcesConfigStructure,
  buildTrafficSourceContext,
  matchTrafficSource,
  stableIdFromConfig,
} = require('../trafficSourcesConfig');

function clampInt(v, { min, max, fallback }) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
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

function normStr(v, maxLen = 256) {
  const s = v == null ? '' : String(v).trim();
  if (!s) return '';
  const low = s.toLowerCase();
  return low.length > maxLen ? low.slice(0, maxLen) : low;
}

function titleizeToken(v) {
  const s = (v || '').trim();
  if (!s) return '';
  return s
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function parseJsonKeys(rawJson) {
  const out = new Set();
  try {
    if (!rawJson) return out;
    const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    if (!parsed || typeof parsed !== 'object') return out;
    for (const k of Object.keys(parsed)) {
      const kk = normStr(k, 64);
      if (kk) out.add(kk);
    }
  } catch (_) {}
  return out;
}

function deriveChannelFromEvidence({ paidKeys, utmSource, utmMedium } = {}) {
  const hasAny = (set, keys) => keys.some((k) => set && set.has(k));
  if (hasAny(paidKeys, ['gclid', 'gbraid', 'wbraid'])) return 'google_ads';
  if (hasAny(paidKeys, ['msclkid'])) return 'bing_ads';
  if (hasAny(paidKeys, ['fbclid'])) return 'facebook_ads';
  if (hasAny(paidKeys, ['ttclid'])) return 'tiktok_ads';
  if (hasAny(paidKeys, ['twclid'])) return 'twitter_ads';

  const us = normStr(utmSource, 128);
  const um = normStr(utmMedium, 64);
  const paid = um === 'cpc' || um === 'ppc' || um === 'paid' || um === 'paid_search' || um === 'paidsearch';
  if (paid && (us.includes('google') || us.includes('adwords') || us.includes('googleads'))) return 'google_ads';
  if (paid && (us.includes('bing') || us.includes('microsoft'))) return 'bing_ads';
  if (paid && (us.includes('facebook') || us === 'fb' || us.includes('instagram'))) return 'facebook_ads';
  return 'unknown';
}

function iconSpecForChannel(channel) {
  const c = String(channel || '').trim().toLowerCase();
  if (c === 'google_ads') return 'fa-brands fa-google';
  if (c === 'bing_ads') return 'fa-brands fa-microsoft';
  if (c === 'facebook_ads') return 'fa-brands fa-facebook';
  if (c === 'tiktok_ads') return 'fa-brands fa-tiktok';
  if (c === 'twitter_ads') return 'fa-brands fa-x-twitter';
  return 'fa-light fa-link';
}

function buildSuggestionKey({ channel, networkHint } = {}) {
  const ch = String(channel || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  const net = String(networkHint || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
  if (!ch) return '';
  if (net) return `${ch}_affiliate_${net}`.slice(0, 80);
  return `${ch}_affiliate`.slice(0, 80);
}

function mergeSeedSourcesIntoConfig(baseConfigRaw, seedSourcesRaw) {
  const base = normalizeTrafficSourcesConfigV1(baseConfigRaw);
  const incomingCfg = normalizeTrafficSourcesConfigForSave({ v: 1, sources: Array.isArray(seedSourcesRaw) ? seedSourcesRaw : [] });
  const seeds = Array.isArray(incomingCfg.sources) ? incomingCfg.sources : [];

  const sources = Array.isArray(base.sources) ? base.sources.slice() : [];
  const byKey = new Map();
  let maxOrder = 0;
  for (const s of sources) {
    if (!s || !s.key) continue;
    const k = String(s.key).trim().toLowerCase();
    byKey.set(k, s);
    const o = Number(s.order);
    if (Number.isFinite(o) && o > maxOrder) maxOrder = o;
  }

  function stableWhenFingerprint(rule) {
    const when = rule && rule.when && typeof rule.when === 'object' ? rule.when : {};
    const keys = Object.keys(when).sort();
    const pairs = keys.map((k) => {
      const v = when[k] || {};
      const any = Array.isArray(v.any) ? v.any.slice().sort() : [];
      const none = Array.isArray(v.none) ? v.none.slice().sort() : [];
      return `${k}:any=${any.join('|')};none=${none.join('|')}`;
    });
    return pairs.join('||');
  }

  for (const seed of seeds) {
    if (!seed || !seed.key) continue;
    const key = String(seed.key).trim().toLowerCase();
    const existing = byKey.get(key) || null;
    if (!existing) {
      maxOrder += 1;
      sources.push({
        key: seed.key,
        label: seed.label,
        enabled: seed.enabled !== false,
        order: maxOrder,
        iconSpec: seed.iconSpec || '',
        rules: Array.isArray(seed.rules) ? seed.rules : [],
      });
      byKey.set(key, sources[sources.length - 1]);
      continue;
    }

    // Enable if seed is enabled.
    if (seed.enabled === true) existing.enabled = true;
    // Fill icon if empty.
    if ((!existing.iconSpec || !String(existing.iconSpec).trim()) && seed.iconSpec) existing.iconSpec = seed.iconSpec;

    const existingRules = Array.isArray(existing.rules) ? existing.rules : [];
    const existingRuleIds = new Set(existingRules.map((r) => (r && r.id ? String(r.id).trim().toLowerCase() : '')).filter(Boolean));
    const existingFingerprints = new Set(existingRules.map(stableWhenFingerprint).filter(Boolean));
    const additions = [];

    for (const r of (Array.isArray(seed.rules) ? seed.rules : [])) {
      if (!r) continue;
      const fp = stableWhenFingerprint(r);
      if (fp && existingFingerprints.has(fp)) continue;

      let rid = r.id ? String(r.id) : '';
      let ridKey = rid.trim().toLowerCase();
      if (!ridKey || existingRuleIds.has(ridKey)) {
        const baseId = String(r.label || 'rule').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'rule';
        ridKey = baseId;
        let i = 2;
        while (existingRuleIds.has(ridKey)) {
          ridKey = `${baseId}_${i}`;
          i += 1;
        }
        rid = ridKey;
      }
      existingRuleIds.add(ridKey);
      if (fp) existingFingerprints.add(fp);
      additions.push({
        id: rid,
        label: r.label || r.id || 'Rule',
        enabled: r.enabled !== false,
        when: r.when && typeof r.when === 'object' ? r.when : {},
      });
    }

    existing.rules = existingRules.concat(additions);
  }

  return normalizeTrafficSourcesConfigForSave({ v: 1, sources });
}

async function getTrafficSourcesV2Suggestions(req, res) {
  const sinceDays = clampInt(req && req.query ? req.query.sinceDays : null, { min: 1, max: 365, fallback: 30 });
  const limitRows = clampInt(req && req.query ? req.query.limitRows : null, { min: 100, max: 200000, fallback: 20000 });
  const limitTokens = clampInt(req && req.query ? req.query.limitTokens : null, { min: 1, max: 2000, fallback: 250 });
  const minGroupSessions = clampInt(req && req.query ? req.query.minGroupSessions : null, { min: 1, max: 100000, fallback: 3 });
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  let currentCfg = defaultTrafficSourcesConfigV1();
  try {
    const raw = await store.getSetting(TRAFFIC_SOURCES_CONFIG_KEY).catch(() => null);
    currentCfg = normalizeTrafficSourcesConfigV1(raw);
  } catch (_) {}
  const configId = stableIdFromConfig(currentCfg);

  const suggestions = [];
  const groups = new Map(); // key -> aggregate
  const db = getDb();

  try {
    const rows = await db.all(
      `
        SELECT a.session_id, a.first_seen_at, a.source_kind, a.affiliate_network_hint,
               a.paid_click_ids_json, a.affiliate_click_ids_json,
               a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.utm_term,
               s.has_purchased, s.order_total, s.order_currency
        FROM affiliate_attribution_sessions a
        LEFT JOIN sessions s ON s.session_id = a.session_id
        WHERE a.first_seen_at >= ?
        ORDER BY a.first_seen_at DESC
        LIMIT ?
      `,
      [sinceMs, limitRows]
    );
    for (const r of rows || []) {
      const sourceKind = normStr(r && r.source_kind, 32) || 'unknown';
      const network = normStr(r && r.affiliate_network_hint, 64) || '';
      const paidKeys = parseJsonKeys(r && r.paid_click_ids_json);
      const channel = deriveChannelFromEvidence({
        paidKeys,
        utmSource: r && r.utm_source,
        utmMedium: r && r.utm_medium,
      });
      const gk = `${channel}\0${sourceKind}\0${network}`;
      if (!groups.has(gk)) {
        groups.set(gk, {
          channel,
          sourceKind,
          network,
          sessions: 0,
          converted: 0,
          examples: [],
          utmSourceCounts: new Map(),
          utmMediumCounts: new Map(),
        });
      }
      const g = groups.get(gk);
      g.sessions += 1;
      if (r && r.has_purchased) g.converted += 1;
      const us = normStr(r && r.utm_source, 128);
      const um = normStr(r && r.utm_medium, 64);
      if (us) g.utmSourceCounts.set(us, (g.utmSourceCounts.get(us) || 0) + 1);
      if (um) g.utmMediumCounts.set(um, (g.utmMediumCounts.get(um) || 0) + 1);
      if (g.examples.length < 4) {
        g.examples.push({
          session_id: r && r.session_id ? String(r.session_id) : '',
          utm_source: r && r.utm_source != null ? String(r.utm_source) : '',
          utm_medium: r && r.utm_medium != null ? String(r.utm_medium) : '',
          utm_campaign: r && r.utm_campaign != null ? String(r.utm_campaign) : '',
        });
      }
    }
  } catch (err) {
    // Fail-open when table does not exist yet.
    Sentry.captureException(err, { extra: { route: 'trafficSourcesV2.suggestions', stage: 'affiliate_rows' } });
  }

  // Build affiliate suggestions: network-specific sources for paid-click channels.
  for (const g of groups.values()) {
    if (!g || g.sessions < minGroupSessions) continue;
    if (g.sourceKind !== 'affiliate') continue;
    if (!g.network) continue;
    if (g.channel === 'unknown') continue;

    const key = buildSuggestionKey({ channel: g.channel, networkHint: g.network });
    if (!key) continue;
    const channelLabel = g.channel === 'google_ads' ? 'Google Ads'
      : (g.channel === 'bing_ads' ? 'Bing Ads'
        : (g.channel === 'facebook_ads' ? 'Facebook Ads' : titleizeToken(g.channel)));
    const label = `${channelLabel} (Affiliate: ${titleizeToken(g.network) || g.network})`;
    const clickParams = g.channel === 'google_ads' ? ['gclid', 'gbraid', 'wbraid']
      : (g.channel === 'bing_ads' ? ['msclkid']
        : (g.channel === 'facebook_ads' ? ['fbclid'] : []));

    suggestions.push({
      id: `source:${key}`,
      kind: 'source',
      label,
      stats: { sessions: g.sessions, converted: g.converted },
      seedSource: {
        key,
        label,
        enabled: true,
        order: 0,
        iconSpec: iconSpecForChannel(g.channel),
        rules: [
          {
            id: 'affiliate_network_paid_click',
            label: 'Affiliate network + paid click',
            enabled: true,
            when: {
              source_kind: { any: ['affiliate'] },
              affiliate_network_hint: { any: [g.network] },
              param_names: clickParams.length ? { any: clickParams } : undefined,
            },
          },
        ].filter(Boolean),
      },
      examples: g.examples,
    });
  }

  // Token suggestions: expose top observed UTM tokens for manual mapping.
  let tokens = [];
  try {
    const tokenRows = await db.all(
      `
        SELECT utm_param, utm_value, first_seen_at, last_seen_at, seen_count
        FROM traffic_source_tokens
        WHERE last_seen_at >= ?
        ORDER BY seen_count DESC, last_seen_at DESC
        LIMIT ?
      `,
      [sinceMs, limitTokens]
    );
    tokens = (tokenRows || []).map((r) => ({
      utm_param: r && r.utm_param != null ? String(r.utm_param) : '',
      utm_value: r && r.utm_value != null ? String(r.utm_value) : '',
      first_seen_at: r && r.first_seen_at != null ? Number(r.first_seen_at) : null,
      last_seen_at: r && r.last_seen_at != null ? Number(r.last_seen_at) : null,
      seen_count: r && r.seen_count != null ? Number(r.seen_count) : 0,
    })).filter((t) => t.utm_param && t.utm_value);
  } catch (_) {
    tokens = [];
  }

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Vary', 'Cookie');
  res.json({
    ok: true,
    generatedAt: Date.now(),
    sinceDays,
    limitRows,
    minGroupSessions,
    configId,
    suggestions,
    tokens,
  });
}

async function postApplyTrafficSourcesV2Suggestions(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).set('Allow', 'POST').end();
  }
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const seedSources = Array.isArray(body.seedSources) ? body.seedSources : (Array.isArray(body.seed_sources) ? body.seed_sources : []);

  let existingCfg = defaultTrafficSourcesConfigV1();
  try {
    const raw = await store.getSetting(TRAFFIC_SOURCES_CONFIG_KEY).catch(() => null);
    existingCfg = normalizeTrafficSourcesConfigV1(raw);
  } catch (_) {}

  try {
    const merged = mergeSeedSourcesIntoConfig(existingCfg, seedSources);
    const structureValidation = validateTrafficSourcesConfigStructure(merged);
    if (!structureValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: 'traffic_sources_config_invalid',
        message: 'Traffic Sources settings are invalid. Fix the listed issues and try again.',
        details: { stage: 'structure', errors: structureValidation.errors || [] },
      });
    }
    const json = JSON.stringify(merged);
    if (json.length > 200000) throw new Error('Traffic sources config too large');
    await store.setSetting(TRAFFIC_SOURCES_CONFIG_KEY, json);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, trafficSourcesConfig: merged, configId: stableIdFromConfig(merged) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'apply_failed' });
  }
}

async function getTrafficSourcesV2Diagnostics(req, res) {
  const sinceDays = clampInt(req && req.query ? req.query.sinceDays : null, { min: 1, max: 365, fallback: 30 });
  const limitSessions = clampInt(req && req.query ? req.query.limitSessions : null, { min: 100, max: 200000, fallback: 50000 });
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  let cfg = defaultTrafficSourcesConfigV1();
  try {
    const raw = await store.getSetting(TRAFFIC_SOURCES_CONFIG_KEY).catch(() => null);
    cfg = normalizeTrafficSourcesConfigV1(raw);
  } catch (_) {}

  const db = getDb();
  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT s.session_id, s.last_seen, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
               s.entry_url, s.referrer, s.traffic_source_key, s.has_purchased,
               a.source_kind, a.affiliate_network_hint, a.affiliate_id_hint, a.paid_click_ids_json, a.affiliate_click_ids_json
        FROM sessions s
        LEFT JOIN affiliate_attribution_sessions a ON a.session_id = s.session_id
        WHERE s.last_seen >= ?
        ORDER BY s.last_seen DESC
        LIMIT ?
      `,
      [sinceMs, limitSessions]
    );
  } catch (err) {
    // Fail-open if affiliate table missing; retry without join.
    try {
      rows = await db.all(
        `
          SELECT s.session_id, s.last_seen, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content, s.utm_term,
                 s.entry_url, s.referrer, s.traffic_source_key, s.has_purchased
          FROM sessions s
          WHERE s.last_seen >= ?
          ORDER BY s.last_seen DESC
          LIMIT ?
        `,
        [sinceMs, limitSessions]
      );
    } catch (e2) {
      // Fail-open if utm_term column missing (pre-migration); retry without utm_term.
      if (/utm_term|column.*does not exist/i.test(e2 && e2.message)) {
        try {
          rows = await db.all(
            `
              SELECT s.session_id, s.last_seen, s.utm_source, s.utm_medium, s.utm_campaign, s.utm_content,
                     s.entry_url, s.referrer, s.traffic_source_key, s.has_purchased
              FROM sessions s
              WHERE s.last_seen >= ?
              ORDER BY s.last_seen DESC
              LIMIT ?
            `,
            [sinceMs, limitSessions]
          );
          if (rows && rows.length) rows = rows.map(r => ({ ...r, utm_term: null }));
        } catch (e3) {
          Sentry.captureException(e3, { extra: { route: 'trafficSourcesV2.diagnostics' } });
          rows = [];
        }
      } else {
        Sentry.captureException(e2, { extra: { route: 'trafficSourcesV2.diagnostics' } });
        rows = [];
      }
    }
  }

  const byKey = new Map();
  const unmatchedBySig = new Map(); // signature -> { sessions, exampleSessionId }
  let total = 0;
  let matched = 0;
  let unmatched = 0;

  for (const r of rows || []) {
    total += 1;
    const ctx = buildTrafficSourceContext({ session: r, affiliate: r });
    const m = matchTrafficSource(ctx, cfg);
    if (m && m.kind === 'matched' && m.key) {
      matched += 1;
      const k = String(m.key);
      if (!byKey.has(k)) byKey.set(k, { key: k, label: m.label || k, sessions: 0, converted: 0 });
      const agg = byKey.get(k);
      agg.sessions += 1;
      if (r && r.has_purchased) agg.converted += 1;
    } else {
      unmatched += 1;
      try {
        const parts = [];
        if (ctx.utm_source) parts.push(`utm_source=${ctx.utm_source}`);
        if (ctx.utm_medium) parts.push(`utm_medium=${ctx.utm_medium}`);
        if (ctx.utm_campaign) parts.push(`utm_campaign=${ctx.utm_campaign}`);
        if (!parts.length && ctx.traffic_source_key_v1) parts.push(`v1=${ctx.traffic_source_key_v1}`);
        if (!parts.length && ctx.referrer_host) parts.push(`ref=${ctx.referrer_host}`);
        const sig = parts.length ? parts.join(' ') : 'unmatched';
        const prev = unmatchedBySig.get(sig) || { signature: sig, sessions: 0, exampleSessionId: null };
        prev.sessions += 1;
        if (!prev.exampleSessionId && r && r.session_id) prev.exampleSessionId = String(r.session_id);
        unmatchedBySig.set(sig, prev);
      } catch (_) {}
    }
  }

  const bySource = Array.from(byKey.values()).sort((a, b) => (b.sessions || 0) - (a.sessions || 0));
  const unmatchedTop = Array.from(unmatchedBySig.values())
    .sort((a, b) => (Number(b.sessions) || 0) - (Number(a.sessions) || 0))
    .slice(0, 30);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  res.json({
    ok: true,
    generatedAt: Date.now(),
    sinceDays,
    limitSessions,
    totals: { totalSessions: total, matchedSessions: matched, unmatchedSessions: unmatched },
    bySource,
    unmatchedTop,
  });
}

module.exports = {
  getTrafficSourcesV2Suggestions,
  postApplyTrafficSourcesV2Suggestions,
  getTrafficSourcesV2Diagnostics,
};

