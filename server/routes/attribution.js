/**
 * Acquisition → Attribution API
 *
 * Endpoints:
 * - GET  /api/attribution/report
 * - GET  /api/attribution/prefs
 * - POST /api/attribution/prefs
 * - GET  /api/attribution/config
 * - POST /api/attribution/config
 * - GET  /api/attribution/observed
 * - POST /api/attribution/map
 *
 * Notes:
 * - Fail-open: if config tables are missing, return empty/defaults.
 * - Attribution is persisted at write-time on sessions + orders_shopify.
 */
const crypto = require('crypto');
const Sentry = require('@sentry/node');
const store = require('../store');
const fx = require('../fx');
const { getDb } = require('../db');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');
const {
  normalizeVariantKey,
  readAttributionConfigCached,
  invalidateAttributionConfigCache,
} = require('../attribution/deriveAttribution');

const PREFS_KEY = 'attribution_prefs_v1';

function clampInt(v, { min, max, fallback }) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function trimLower(v, maxLen = 256) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function sanitizeKey(v, { maxLen = 32 } = {}) {
  const s = trimLower(v, maxLen);
  if (!s) return '';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(s)) return '';
  return s;
}

function sanitizeRuleId(v) {
  const s = trimLower(v, 80);
  if (!s) return '';
  if (!/^[a-z0-9][a-z0-9:_-]*$/.test(s)) return '';
  return s;
}

function looksLikeUrl(s) {
  const raw = typeof s === 'string' ? s.trim() : '';
  if (!raw) return false;
  if (raw.startsWith('/assets/') || raw.startsWith('/uploads/') || raw.startsWith('/')) return true;
  return raw.startsWith('https://') || raw.startsWith('http://');
}

function extractFirstSvgMarkup(value) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return '';
  const m = raw.match(/<svg[\s\S]*?<\/svg>/i);
  return m ? String(m[0]) : '';
}

function sanitizeSvgMarkup(value) {
  let svg = extractFirstSvgMarkup(value);
  if (!svg) return '';
  svg = svg.replace(/<\?xml[\s\S]*?\?>/gi, '');
  svg = svg.replace(/<!--[\s\S]*?-->/g, '');
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '');
  svg = svg.replace(/\s(?:href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
  return svg.trim();
}

function sanitizeIconClassString(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const cleaned = raw.replace(/[^a-z0-9 \t\r\n_-]+/gi, ' ').trim().replace(/\s+/g, ' ');
  const tokens = cleaned
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => /^fa[a-z0-9-]*$/i.test(t));
  return tokens.join(' ').slice(0, 256);
}

function normalizeIconSpec(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const svg = sanitizeSvgMarkup(raw);
  if (svg) return svg;
  if (looksLikeUrl(raw)) return raw.slice(0, 2048);
  const cls = sanitizeIconClassString(raw);
  return cls || null;
}

function titleFromKey(key) {
  const s = String(key || '').trim();
  if (!s) return 'Unknown';
  return s
    .replace(/[:_ -]+/g, ' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.slice(0, 1).toUpperCase() + w.slice(1))
    .join(' ');
}

async function getAttributionPrefsRaw() {
  const raw = await store.getSetting(PREFS_KEY).catch(() => null);
  const parsed = safeJsonParse(raw);
  const prefs = parsed && typeof parsed === 'object' ? parsed : {};
  const enabledOwnerKindsRaw = Array.isArray(prefs.enabledOwnerKinds) ? prefs.enabledOwnerKinds : ['house', 'partner', 'affiliate'];
  const enabledOwnerKinds = enabledOwnerKindsRaw
    .map((k) => trimLower(k, 32))
    .filter((k) => k === 'house' || k === 'partner' || k === 'affiliate');
  const unique = Array.from(new Set(enabledOwnerKinds));
  const includeUnknownObserved = !!prefs.includeUnknownObserved;
  return {
    enabledOwnerKinds: unique.length ? unique : ['house', 'partner', 'affiliate'],
    includeUnknownObserved,
  };
}

async function getAttributionConfigVersion() {
  const db = getDb();
  try {
    const r = await db.get(
      `
        SELECT
          COALESCE((SELECT MAX(updated_at) FROM attribution_channels), 0) AS channels_max,
          COALESCE((SELECT MAX(updated_at) FROM attribution_sources), 0) AS sources_max,
          COALESCE((SELECT MAX(updated_at) FROM attribution_variants), 0) AS variants_max,
          COALESCE((SELECT MAX(updated_at) FROM attribution_rules), 0) AS rules_max,
          COALESCE((SELECT MAX(updated_at) FROM attribution_allowlist), 0) AS allowlist_max
      `
    );
    const a = r && r.channels_max != null ? Number(r.channels_max) : 0;
    const b = r && r.sources_max != null ? Number(r.sources_max) : 0;
    const c = r && r.variants_max != null ? Number(r.variants_max) : 0;
    const d = r && r.rules_max != null ? Number(r.rules_max) : 0;
    const e = r && r.allowlist_max != null ? Number(r.allowlist_max) : 0;
    const updatedAtMax = Math.max(0, a || 0, b || 0, c || 0, d || 0, e || 0);
    return { updatedAtMax };
  } catch (_) {
    return { updatedAtMax: 0 };
  }
}

async function aggCurrencyRowsToGbp(rows, { keyFields }) {
  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map(); // key -> { orders, revenueGbp }
  for (const r of Array.isArray(rows) ? rows : []) {
    const keyParts = (Array.isArray(keyFields) ? keyFields : []).map((f) => (r && r[f] != null ? String(r[f]).trim().toLowerCase() : ''));
    if (keyParts.some((p) => !p)) continue;
    const key = keyParts.join('|');
    const cur = fx.normalizeCurrency(r && r.currency) || 'GBP';
    const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
    const revenue = r && r.revenue != null ? Number(r.revenue) : 0;
    const gbp = fx.convertToGbp(Number.isFinite(revenue) ? revenue : 0, cur, ratesToGbp) || 0;
    const prev = map.get(key) || { orders: 0, revenueGbp: 0 };
    prev.orders += orders;
    prev.revenueGbp += Number.isFinite(gbp) ? gbp : 0;
    map.set(key, prev);
  }
  for (const [k, v] of map.entries()) {
    v.revenueGbp = Math.round((Number(v.revenueGbp) || 0) * 100) / 100;
    map.set(k, v);
  }
  return map;
}

function pct(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function conversionPct(orders, sessions) {
  const o = Number(orders) || 0;
  const s = Number(sessions) || 0;
  if (s <= 0) return null;
  return pct((o / s) * 100);
}

function aovGbp(revenueGbp, orders) {
  const o = Number(orders) || 0;
  const r = Number(revenueGbp) || 0;
  if (o <= 0) return null;
  return Math.round((r / o) * 100) / 100;
}

async function getAttributionReport(req, res) {
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const rangeKey = normalizeRangeKey(req.query.range, { defaultKey: 'today' });
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  const includeUnknownObserved = !!(req.query && (req.query.includeUnknownObserved === '1' || req.query.includeUnknownObserved === 'true'));

  const db = getDb();
  const prefs = await getAttributionPrefsRaw();
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  const shop = salesTruth.resolveShopForSales('');
  const cfgVersion = await getAttributionConfigVersion();

  const cached = await reportCache.getOrComputeJson(
    {
      shop: shop || '',
      endpoint: 'attribution',
      rangeKey,
      rangeStartTs: bounds.start,
      rangeEndTs: bounds.end,
      params: { prefs, reporting, cfgVersion, includeUnknownObserved },
      ttlMs: 5 * 60 * 1000,
      force,
    },
    async () => {
      const cfg = await readAttributionConfigCached().catch(() => null);
      const channelsByKey = cfg && cfg.channelsByKey ? cfg.channelsByKey : new Map();
      const sourcesByKey = cfg && cfg.sourcesByKey ? cfg.sourcesByKey : new Map();
      const variantsByKey = cfg && cfg.variantsByKey ? cfg.variantsByKey : new Map();

      function channelLabel(k) {
        const key = trimLower(k, 32) || 'other';
        const row = channelsByKey.get(key);
        return row && row.label ? String(row.label) : titleFromKey(key);
      }
      function sourceLabel(k) {
        const key = trimLower(k, 32) || 'other';
        const row = sourcesByKey.get(key);
        return row && row.label ? String(row.label) : titleFromKey(key);
      }
      function sourceIconSpec(k) {
        const key = trimLower(k, 32) || 'other';
        const row = sourcesByKey.get(key);
        return row && row.icon_spec != null ? String(row.icon_spec) : null;
      }
      function variantLabel(k) {
        const key = normalizeVariantKey(k) || 'other:house';
        const row = variantsByKey.get(key);
        return row && row.label ? String(row.label) : titleFromKey(key);
      }
      function variantIconSpec(k) {
        const key = normalizeVariantKey(k) || 'other:house';
        const row = variantsByKey.get(key);
        return row && row.icon_spec != null ? String(row.icon_spec) : null;
      }

      const sessionsRows = await db.all(
        `
          SELECT
            LOWER(COALESCE(NULLIF(TRIM(attribution_channel), ''), 'other')) AS channel,
            LOWER(COALESCE(NULLIF(TRIM(attribution_source), ''), 'other')) AS source,
            LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other:house')) AS variant,
            LOWER(COALESCE(NULLIF(TRIM(attribution_owner_kind), ''), 'house')) AS owner_kind,
            COUNT(*) AS sessions
          FROM sessions
          WHERE started_at >= ? AND started_at < ?
            AND (cf_known_bot IS NULL OR cf_known_bot = 0)
          GROUP BY
            LOWER(COALESCE(NULLIF(TRIM(attribution_channel), ''), 'other')),
            LOWER(COALESCE(NULLIF(TRIM(attribution_source), ''), 'other')),
            LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other:house')),
            LOWER(COALESCE(NULLIF(TRIM(attribution_owner_kind), ''), 'house'))
        `,
        [bounds.start, bounds.end]
      );

      const ordersRows = await db.all(
        `
          SELECT
            LOWER(COALESCE(NULLIF(TRIM(attribution_channel), ''), 'other')) AS channel,
            LOWER(COALESCE(NULLIF(TRIM(attribution_source), ''), 'other')) AS source,
            LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other:house')) AS variant,
            LOWER(COALESCE(NULLIF(TRIM(attribution_owner_kind), ''), 'house')) AS owner_kind,
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
            COUNT(*) AS orders,
            SUM(COALESCE(total_price, 0)) AS revenue
          FROM orders_shopify
          WHERE shop = ?
            AND created_at >= ? AND created_at < ?
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
          GROUP BY
            LOWER(COALESCE(NULLIF(TRIM(attribution_channel), ''), 'other')),
            LOWER(COALESCE(NULLIF(TRIM(attribution_source), ''), 'other')),
            LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other:house')),
            LOWER(COALESCE(NULLIF(TRIM(attribution_owner_kind), ''), 'house')),
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
        `,
        [shop, bounds.start, bounds.end]
      );

      const salesByKey = await aggCurrencyRowsToGbp(ordersRows, { keyFields: ['channel', 'source', 'variant', 'owner_kind'] });

      const sessionsByKey = new Map();
      for (const r of Array.isArray(sessionsRows) ? sessionsRows : []) {
        const channel = trimLower(r && r.channel != null ? String(r.channel) : '', 32) || 'other';
        const source = trimLower(r && r.source != null ? String(r.source) : '', 32) || 'other';
        const variant = normalizeVariantKey(r && r.variant != null ? String(r.variant) : '') || 'other:house';
        const ownerKind = trimLower(r && r.owner_kind != null ? String(r.owner_kind) : '', 32) || 'house';
        const key = [channel, source, variant, ownerKind].join('|');
        const n = r && r.sessions != null ? Number(r.sessions) : 0;
        sessionsByKey.set(key, (sessionsByKey.get(key) || 0) + (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0));
      }

      // Build hierarchical rows: channel → source → variant.
      const channelAgg = new Map(); // channel -> agg
      const sourceAgg = new Map(); // channel|source -> agg
      const variantAgg = new Map(); // channel|source|variant|owner_kind -> agg

      function ensureAgg(map, key) {
        const prev = map.get(key);
        if (prev) return prev;
        const next = { sessions: 0, orders: 0, revenueGbp: 0 };
        map.set(key, next);
        return next;
      }

      for (const [key, sessions] of sessionsByKey.entries()) {
        const [channel, source, variant, ownerKind] = key.split('|');
        const vKey = [channel, source, variant, ownerKind].join('|');
        const v = ensureAgg(variantAgg, vKey);
        v.sessions += sessions;
        const sKey = [channel, source].join('|');
        const s = ensureAgg(sourceAgg, sKey);
        s.sessions += sessions;
        const c = ensureAgg(channelAgg, channel);
        c.sessions += sessions;
      }
      for (const [key, sales] of salesByKey.entries()) {
        const [channel, source, variant, ownerKind] = key.split('|');
        const vKey = [channel, source, variant, ownerKind].join('|');
        const v = ensureAgg(variantAgg, vKey);
        v.orders += Number(sales.orders) || 0;
        v.revenueGbp += Number(sales.revenueGbp) || 0;
        const sKey = [channel, source].join('|');
        const s = ensureAgg(sourceAgg, sKey);
        s.orders += Number(sales.orders) || 0;
        s.revenueGbp += Number(sales.revenueGbp) || 0;
        const c = ensureAgg(channelAgg, channel);
        c.orders += Number(sales.orders) || 0;
        c.revenueGbp += Number(sales.revenueGbp) || 0;
      }

      const channelsOut = [];
      const channelKeys = Array.from(channelAgg.keys());
      channelKeys.sort((a, b) => (channelAgg.get(b).sessions - channelAgg.get(a).sessions) || String(a).localeCompare(String(b)));
      for (const channelKey of channelKeys) {
        const cAgg = channelAgg.get(channelKey) || { sessions: 0, orders: 0, revenueGbp: 0 };
        const sourcesOut = [];
        const sourcesForChannel = Array.from(sourceAgg.keys())
          .filter((k) => k.split('|')[0] === channelKey)
          .sort((a, b) => (sourceAgg.get(b).sessions - sourceAgg.get(a).sessions) || String(a).localeCompare(String(b)));
        for (const csKey of sourcesForChannel) {
          const [, sourceKey] = csKey.split('|');
          const sAgg = sourceAgg.get(csKey) || { sessions: 0, orders: 0, revenueGbp: 0 };
          const variantsOut = [];
          const variantsForSource = Array.from(variantAgg.keys())
            .filter((k) => {
              const parts = k.split('|');
              return parts[0] === channelKey && parts[1] === sourceKey;
            })
            .sort((a, b) => (variantAgg.get(b).sessions - variantAgg.get(a).sessions) || String(a).localeCompare(String(b)));
          for (const vKey of variantsForSource) {
            const parts = vKey.split('|');
            const variantKey = parts[2] || 'other:house';
            const ownerKind = parts[3] || 'house';
            if (!includeUnknownObserved && (variantKey === 'other:house' || variantKey === 'unknown:house')) continue;
            const vAgg = variantAgg.get(vKey) || { sessions: 0, orders: 0, revenueGbp: 0 };
            variantsOut.push({
              variant_key: variantKey,
              owner_kind: ownerKind,
              label: variantLabel(variantKey),
              icon_spec: variantIconSpec(variantKey),
              sessions: vAgg.sessions,
              orders: vAgg.orders,
              revenue_gbp: Math.round((Number(vAgg.revenueGbp) || 0) * 100) / 100,
              conversion_pct: conversionPct(vAgg.orders, vAgg.sessions),
              aov_gbp: aovGbp(vAgg.revenueGbp, vAgg.orders),
            });
          }
          sourcesOut.push({
            source_key: sourceKey,
            label: sourceLabel(sourceKey),
            icon_spec: sourceIconSpec(sourceKey),
            sessions: sAgg.sessions,
            orders: sAgg.orders,
            revenue_gbp: Math.round((Number(sAgg.revenueGbp) || 0) * 100) / 100,
            conversion_pct: conversionPct(sAgg.orders, sAgg.sessions),
            aov_gbp: aovGbp(sAgg.revenueGbp, sAgg.orders),
            variants: variantsOut,
          });
        }
        channelsOut.push({
          channel_key: channelKey,
          label: channelLabel(channelKey),
          sessions: cAgg.sessions,
          orders: cAgg.orders,
          revenue_gbp: Math.round((Number(cAgg.revenueGbp) || 0) * 100) / 100,
          conversion_pct: conversionPct(cAgg.orders, cAgg.sessions),
          aov_gbp: aovGbp(cAgg.revenueGbp, cAgg.orders),
          sources: sourcesOut,
        });
      }

      return {
        now,
        timeZone,
        range: { key: rangeKey, start: bounds.start, end: bounds.end },
        reporting,
        prefs,
        attribution: {
          rows: channelsOut,
          chart: { bucket: 'day', stepMs: 24 * 60 * 60 * 1000, buckets: [], series: [] },
        },
      };
    }
  );

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json(cached && cached.ok ? cached.data : {
    now,
    timeZone,
    range: { key: rangeKey, start: bounds.start, end: bounds.end },
    reporting,
    prefs,
    attribution: { rows: [], chart: { bucket: 'day', stepMs: 24 * 60 * 60 * 1000, buckets: [], series: [] } },
  });
}

async function getAttributionPrefs(req, res) {
  const prefs = await getAttributionPrefsRaw();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, prefs });
}

async function postAttributionPrefs(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const next = {};
  if (body.enabledOwnerKinds != null) next.enabledOwnerKinds = body.enabledOwnerKinds;
  if (body.includeUnknownObserved != null) next.includeUnknownObserved = body.includeUnknownObserved;
  try {
    await store.setSetting(PREFS_KEY, JSON.stringify(next));
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? String(e.message) : 'Failed to save' });
  }
  const prefs = await getAttributionPrefsRaw();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, prefs });
}

async function getAttributionConfig(req, res) {
  const db = getDb();
  let channels = [];
  let sources = [];
  let variants = [];
  let rules = [];
  let allowlist = [];
  try { channels = await db.all('SELECT channel_key, label, sort_order, enabled, updated_at FROM attribution_channels ORDER BY sort_order ASC, label ASC'); } catch (_) { channels = []; }
  try { sources = await db.all('SELECT source_key, label, icon_spec, sort_order, enabled, updated_at FROM attribution_sources ORDER BY sort_order ASC, label ASC'); } catch (_) { sources = []; }
  try { variants = await db.all('SELECT variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at FROM attribution_variants ORDER BY sort_order ASC, label ASC'); } catch (_) { variants = []; }
  try { rules = await db.all('SELECT id, label, priority, enabled, variant_key, match_json, created_at, updated_at FROM attribution_rules ORDER BY priority ASC, created_at ASC'); } catch (_) { rules = []; }
  try { allowlist = await db.all('SELECT variant_key, enabled, updated_at FROM attribution_allowlist ORDER BY variant_key ASC'); } catch (_) { allowlist = []; }

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    now: Date.now(),
    config: {
      channels,
      sources,
      variants,
      rules,
      allowlist,
    },
  });
}

async function postAttributionConfig(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const cfg = body && body.config && typeof body.config === 'object' ? body.config : body;
  const now = Date.now();

  const nextChannels = Array.isArray(cfg.channels) ? cfg.channels : [];
  const nextSources = Array.isArray(cfg.sources) ? cfg.sources : [];
  const nextVariants = Array.isArray(cfg.variants) ? cfg.variants : [];
  const nextRules = Array.isArray(cfg.rules) ? cfg.rules : [];
  const nextAllowlist = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];

  const channels = nextChannels
    .map((r) => ({
      channel_key: sanitizeKey(r && r.channel_key != null ? r.channel_key : r && r.key != null ? r.key : '', { maxLen: 32 }),
      label: (r && r.label != null ? String(r.label) : '').trim().slice(0, 80) || null,
      sort_order: clampInt(r && r.sort_order != null ? r.sort_order : r && r.sortOrder != null ? r.sortOrder : 0, { min: -1000000, max: 1000000, fallback: 0 }),
      enabled: (r && r.enabled === false) ? 0 : 1,
      updated_at: now,
    }))
    .filter((r) => r.channel_key && r.label);

  const sources = nextSources
    .map((r) => ({
      source_key: sanitizeKey(r && r.source_key != null ? r.source_key : r && r.key != null ? r.key : '', { maxLen: 32 }),
      label: (r && r.label != null ? String(r.label) : '').trim().slice(0, 80) || null,
      icon_spec: normalizeIconSpec(r && r.icon_spec != null ? r.icon_spec : r && r.iconSpec != null ? r.iconSpec : null),
      sort_order: clampInt(r && r.sort_order != null ? r.sort_order : r && r.sortOrder != null ? r.sortOrder : 0, { min: -1000000, max: 1000000, fallback: 0 }),
      enabled: (r && r.enabled === false) ? 0 : 1,
      updated_at: now,
    }))
    .filter((r) => r.source_key && r.label);

  const variants = nextVariants
    .map((r) => {
      const variantKey = normalizeVariantKey(r && (r.variant_key != null ? r.variant_key : (r.key != null ? r.key : '')));
      return {
        variant_key: variantKey,
        label: (r && r.label != null ? String(r.label) : '').trim().slice(0, 120) || null,
        channel_key: sanitizeKey(r && r.channel_key != null ? r.channel_key : r && r.channelKey != null ? r.channelKey : '', { maxLen: 32 }) || 'other',
        source_key: sanitizeKey(r && r.source_key != null ? r.source_key : r && r.sourceKey != null ? r.sourceKey : '', { maxLen: 32 }) || 'other',
        owner_kind: trimLower(r && r.owner_kind != null ? r.owner_kind : r && r.ownerKind != null ? r.ownerKind : '', 32) || 'house',
        partner_id: r && r.partner_id != null && String(r.partner_id).trim() ? String(r.partner_id).trim().slice(0, 128) : null,
        network: r && r.network != null && String(r.network).trim() ? String(r.network).trim().slice(0, 32) : null,
        icon_spec: normalizeIconSpec(r && r.icon_spec != null ? r.icon_spec : r && r.iconSpec != null ? r.iconSpec : null),
        sort_order: clampInt(r && r.sort_order != null ? r.sort_order : r && r.sortOrder != null ? r.sortOrder : 0, { min: -1000000, max: 1000000, fallback: 0 }),
        enabled: (r && r.enabled === false) ? 0 : 1,
        updated_at: now,
      };
    })
    .filter((r) => r.variant_key && r.label);

  const rules = nextRules
    .map((r) => {
      const id = sanitizeRuleId(r && (r.id != null ? r.id : (r.rule_id != null ? r.rule_id : '')));
      const variantKey = normalizeVariantKey(r && (r.variant_key != null ? r.variant_key : (r.variantKey != null ? r.variantKey : '')));
      const label = (r && r.label != null ? String(r.label) : '').trim().slice(0, 120) || null;
      const match = r && r.match_json != null ? r.match_json : (r && r.match != null ? r.match : null);
      const matchObj = typeof match === 'string' ? safeJsonParse(match) : (match && typeof match === 'object' ? match : {});
      let matchJson = '{}';
      try { matchJson = JSON.stringify(matchObj && typeof matchObj === 'object' ? matchObj : {}); } catch (_) { matchJson = '{}'; }
      return {
        id: id || '',
        label: label || (id || 'Rule'),
        priority: clampInt(r && r.priority != null ? r.priority : 1000, { min: -1000000, max: 1000000, fallback: 1000 }),
        enabled: (r && r.enabled === false) ? 0 : 1,
        variant_key: variantKey,
        match_json: matchJson,
        created_at: now,
        updated_at: now,
      };
    })
    .filter((r) => r.id && r.variant_key);

  const allowlist = nextAllowlist
    .map((r) => ({
      variant_key: normalizeVariantKey(r && (r.variant_key != null ? r.variant_key : (r.key != null ? r.key : ''))),
      enabled: (r && r.enabled === false) ? 0 : 1,
      updated_at: now,
    }))
    .filter((r) => r.variant_key);

  const db = getDb();

  async function deleteRowsNotIn(table, col, keys) {
    const list = Array.isArray(keys) ? keys.map((k) => (k != null ? String(k) : '')).map((k) => k.trim()).filter(Boolean) : [];
    if (!list.length) {
      await db.run(`DELETE FROM ${table}`);
      return;
    }
    const ph = list.map(() => '?').join(', ');
    await db.run(`DELETE FROM ${table} WHERE ${col} NOT IN (${ph})`, list);
  }

  try {
    // Upsert new config first (avoid deleting the old config before inserts succeed).
    for (const r of channels) {
      await db.run(
        `
          INSERT INTO attribution_channels (channel_key, label, sort_order, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (channel_key) DO UPDATE SET
            label = EXCLUDED.label,
            sort_order = EXCLUDED.sort_order,
            enabled = EXCLUDED.enabled,
            updated_at = EXCLUDED.updated_at
        `,
        [r.channel_key, r.label, r.sort_order, r.enabled, r.updated_at]
      );
    }
    for (const r of sources) {
      await db.run(
        `
          INSERT INTO attribution_sources (source_key, label, icon_spec, sort_order, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (source_key) DO UPDATE SET
            label = EXCLUDED.label,
            icon_spec = EXCLUDED.icon_spec,
            sort_order = EXCLUDED.sort_order,
            enabled = EXCLUDED.enabled,
            updated_at = EXCLUDED.updated_at
        `,
        [r.source_key, r.label, r.icon_spec, r.sort_order, r.enabled, r.updated_at]
      );
    }
    for (const r of variants) {
      await db.run(
        `
          INSERT INTO attribution_variants (variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (variant_key) DO UPDATE SET
            label = EXCLUDED.label,
            channel_key = EXCLUDED.channel_key,
            source_key = EXCLUDED.source_key,
            owner_kind = EXCLUDED.owner_kind,
            partner_id = EXCLUDED.partner_id,
            network = EXCLUDED.network,
            icon_spec = EXCLUDED.icon_spec,
            sort_order = EXCLUDED.sort_order,
            enabled = EXCLUDED.enabled,
            updated_at = EXCLUDED.updated_at
        `,
        [r.variant_key, r.label, r.channel_key, r.source_key, r.owner_kind, r.partner_id, r.network, r.icon_spec, r.sort_order, r.enabled, r.updated_at]
      );
    }
    for (const r of rules) {
      await db.run(
        `
          INSERT INTO attribution_rules (id, label, priority, enabled, variant_key, match_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            priority = EXCLUDED.priority,
            enabled = EXCLUDED.enabled,
            variant_key = EXCLUDED.variant_key,
            match_json = EXCLUDED.match_json,
            updated_at = EXCLUDED.updated_at
        `,
        [r.id, r.label, r.priority, r.enabled, r.variant_key, r.match_json, r.created_at, r.updated_at]
      );
    }
    for (const r of allowlist) {
      await db.run(
        `
          INSERT INTO attribution_allowlist (variant_key, enabled, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (variant_key) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            updated_at = EXCLUDED.updated_at
        `,
        [r.variant_key, r.enabled, r.updated_at]
      );
    }

    // Then remove stale rows that were not present in the submitted config.
    await deleteRowsNotIn('attribution_allowlist', 'variant_key', allowlist.map((r) => r.variant_key));
    await deleteRowsNotIn('attribution_rules', 'id', rules.map((r) => r.id));
    await deleteRowsNotIn('attribution_variants', 'variant_key', variants.map((r) => r.variant_key));
    await deleteRowsNotIn('attribution_sources', 'source_key', sources.map((r) => r.source_key));
    await deleteRowsNotIn('attribution_channels', 'channel_key', channels.map((r) => r.channel_key));
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'attribution.config.save' } });
    return res.status(500).json({ ok: false, error: 'Failed to save config' });
  }

  invalidateAttributionConfigCache();
  const out = await (async () => {
    try {
      const channelsOut = await db.all('SELECT channel_key, label, sort_order, enabled, updated_at FROM attribution_channels ORDER BY sort_order ASC, label ASC');
      const sourcesOut = await db.all('SELECT source_key, label, icon_spec, sort_order, enabled, updated_at FROM attribution_sources ORDER BY sort_order ASC, label ASC');
      const variantsOut = await db.all('SELECT variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at FROM attribution_variants ORDER BY sort_order ASC, label ASC');
      const rulesOut = await db.all('SELECT id, label, priority, enabled, variant_key, match_json, created_at, updated_at FROM attribution_rules ORDER BY priority ASC, created_at ASC');
      const allowOut = await db.all('SELECT variant_key, enabled, updated_at FROM attribution_allowlist ORDER BY variant_key ASC');
      return { channels: channelsOut, sources: sourcesOut, variants: variantsOut, rules: rulesOut, allowlist: allowOut };
    } catch (_) {
      return { channels: [], sources: [], variants: [], rules: [], allowlist: [] };
    }
  })();

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, now: Date.now(), config: out });
}

async function getAttributionObserved(req, res) {
  const db = getDb();
  const limit = clampInt(req && req.query ? req.query.limit : null, { min: 10, max: 5000, fallback: 500 });
  const minSeen = clampInt(req && req.query ? req.query.minSeen : null, { min: 1, max: 1000000, fallback: 2 });
  const tokenType = trimLower(req && req.query ? req.query.tokenType : '', 48);

  let rows = [];
  try {
    if (tokenType) {
      rows = await db.all(
        `
          SELECT token_type, token_value, first_seen_at, last_seen_at, seen_count, sample_entry_url
          FROM attribution_observed
          WHERE token_type = ? AND seen_count >= ?
          ORDER BY last_seen_at DESC
          LIMIT ?
        `,
        [tokenType, minSeen, limit]
      );
    } else {
      rows = await db.all(
        `
          SELECT token_type, token_value, first_seen_at, last_seen_at, seen_count, sample_entry_url
          FROM attribution_observed
          WHERE seen_count >= ?
          ORDER BY last_seen_at DESC
          LIMIT ?
        `,
        [minSeen, limit]
      );
    }
  } catch (_) {
    rows = [];
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, now: Date.now(), observed: rows });
}

function stableRuleId(prefix, obj) {
  const json = (() => {
    try { return JSON.stringify(obj || {}); } catch (_) { return ''; }
  })();
  const h = crypto.createHash('sha256').update(json).digest('hex').slice(0, 10);
  return sanitizeRuleId(`${prefix}_${h}`) || `${prefix}_${h}`;
}

async function postAttributionMap(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const tokenType = trimLower(body.token_type != null ? body.token_type : body.tokenType, 48);
  const tokenValue = trimLower(body.token_value != null ? body.token_value : body.tokenValue, 256);
  const variantKey = normalizeVariantKey(body.variant_key != null ? body.variant_key : body.variantKey);
  const priority = clampInt(body.priority, { min: -1000000, max: 1000000, fallback: 1000 });

  if (!tokenType || !tokenValue || !variantKey) {
    return res.status(400).json({ ok: false, error: 'Missing token_type, token_value, or variant_key' });
  }

  const allowedTypes = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'referrer_host',
    'param_name',
    'param_pair',
    'kexo_attr',
  ]);
  if (!allowedTypes.has(tokenType)) {
    return res.status(400).json({ ok: false, error: 'Unsupported token_type' });
  }

  const db = getDb();
  const now = Date.now();

  // Ensure variant exists (best-effort, minimal defaults).
  try {
    const label = (body.variant_label != null ? String(body.variant_label) : (body.label != null ? String(body.label) : '')).trim().slice(0, 120) || titleFromKey(variantKey);
    const channelKey = sanitizeKey(body.channel_key != null ? body.channel_key : body.channelKey, { maxLen: 32 }) || 'other';
    const sourceKey = sanitizeKey(body.source_key != null ? body.source_key : body.sourceKey, { maxLen: 32 }) || 'other';
    const ownerKind = trimLower(body.owner_kind != null ? body.owner_kind : body.ownerKind, 32) || 'house';
    const partnerId = body.partner_id != null && String(body.partner_id).trim() ? String(body.partner_id).trim().slice(0, 128) : null;
    const network = body.network != null && String(body.network).trim() ? String(body.network).trim().slice(0, 32) : null;
    const iconSpec = normalizeIconSpec(body.icon_spec != null ? body.icon_spec : body.iconSpec);
    const sortOrder = clampInt(body.sort_order != null ? body.sort_order : body.sortOrder, { min: -1000000, max: 1000000, fallback: 1000 });
    await db.run(
      `
        INSERT INTO attribution_variants (variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (variant_key) DO UPDATE SET
          label = EXCLUDED.label,
          channel_key = EXCLUDED.channel_key,
          source_key = EXCLUDED.source_key,
          owner_kind = EXCLUDED.owner_kind,
          partner_id = EXCLUDED.partner_id,
          network = EXCLUDED.network,
          icon_spec = EXCLUDED.icon_spec,
          sort_order = EXCLUDED.sort_order,
          enabled = EXCLUDED.enabled,
          updated_at = EXCLUDED.updated_at
      `,
      [variantKey, label, channelKey, sourceKey, ownerKind, partnerId, network, iconSpec, sortOrder, 1, now]
    );
  } catch (_) {}

  try {
    if (tokenType === 'kexo_attr') {
      await db.run(
        `
          INSERT INTO attribution_allowlist (variant_key, enabled, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT (variant_key) DO UPDATE SET
            enabled = EXCLUDED.enabled,
            updated_at = EXCLUDED.updated_at
        `,
        [variantKey, 1, now]
      );
    } else {
      const match = {};
      if (tokenType === 'utm_source') match.utm_source = { any: [tokenValue] };
      else if (tokenType === 'utm_medium') match.utm_medium = { any: [tokenValue] };
      else if (tokenType === 'utm_campaign') match.utm_campaign = { any: [tokenValue] };
      else if (tokenType === 'utm_content') match.utm_content = { any: [tokenValue] };
      else if (tokenType === 'utm_term') match.utm_term = { any: [tokenValue] };
      else if (tokenType === 'referrer_host') match.referrer_host = { any: [tokenValue] };
      else if (tokenType === 'param_name') match.param_names = { any: [tokenValue] };
      else if (tokenType === 'param_pair') match.param_pairs = { any: [tokenValue] };

      const idPrefix = `map_${tokenType}`;
      const id = stableRuleId(idPrefix, { tokenType, tokenValue, variantKey, match });
      const label = (body.rule_label != null ? String(body.rule_label) : '').trim().slice(0, 120) || `Map ${tokenType}=${tokenValue}`;
      const matchJson = JSON.stringify(match);
      await db.run(
        `
          INSERT INTO attribution_rules (id, label, priority, enabled, variant_key, match_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET
            label = EXCLUDED.label,
            priority = EXCLUDED.priority,
            enabled = EXCLUDED.enabled,
            variant_key = EXCLUDED.variant_key,
            match_json = EXCLUDED.match_json,
            updated_at = EXCLUDED.updated_at
        `,
        [id, label, priority, 1, variantKey, matchJson, now, now]
      );
    }
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'attribution.map', tokenType } });
    return res.status(500).json({ ok: false, error: 'Failed to map token' });
  }

  invalidateAttributionConfigCache();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
}

module.exports = {
  getAttributionReport,
  getAttributionPrefs,
  postAttributionPrefs,
  getAttributionConfig,
  postAttributionConfig,
  getAttributionObserved,
  postAttributionMap,
};

