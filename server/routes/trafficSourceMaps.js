/**
 * Traffic source mapping admin endpoints.
 *
 * - Surfaces "unmapped" UTM tokens (captured from sessions.entry_url).
 * - Allows mapping utm_param+utm_value -> source_key (custom) with label + optional icon URL.
 */
const store = require('../store');
const { getDb } = require('../db');

function clampInt(v, { min, max, fallback }) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeTokenParam(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function normalizeTokenValue(v) {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

async function getTrafficSourceMeta(req, res) {
  const cfg = await store.getTrafficSourceMapConfigCached().catch(() => null);
  const meta = {};
  const metaByKey = cfg && cfg.metaByKey ? cfg.metaByKey : new Map();
  for (const [k, v] of metaByKey.entries()) {
    meta[k] = {
      label: v && v.label != null ? String(v.label) : String(k),
      iconUrl: v && v.iconUrl != null ? v.iconUrl : null,
      updatedAt: v && v.updatedAt != null ? Number(v.updatedAt) : null,
    };
  }
  const rules = (cfg && Array.isArray(cfg.rulesRows) ? cfg.rulesRows : []).map((r) => ({
    utm_param: r.utm_param,
    utm_value: r.utm_value,
    source_key: r.source_key,
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({
    ok: true,
    allowedParams: store.TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS,
    meta,
    rules,
  });
}

async function getTrafficSourceMaps(req, res) {
  const sinceDays = clampInt(req && req.query ? req.query.sinceDays : null, { min: 1, max: 365, fallback: 30 });
  const limitTokens = clampInt(req && req.query ? req.query.limitTokens : null, { min: 1, max: 2000, fallback: 250 });
  const unmappedOnly = !!(req && req.query && (req.query.unmappedOnly === '1' || req.query.unmappedOnly === 'true'));
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;

  const cfg = await store.getTrafficSourceMapConfigCached({ force: true }).catch(() => null);
  const metaByKey = cfg && cfg.metaByKey ? cfg.metaByKey : new Map();
  const rulesRows = cfg && Array.isArray(cfg.rulesRows) ? cfg.rulesRows : [];
  const ruleMap = new Map(); // param\0value -> [source_key]
  for (const r of rulesRows) {
    const k = (r.utm_param || '') + '\0' + (r.utm_value || '');
    if (!ruleMap.has(k)) ruleMap.set(k, []);
    ruleMap.get(k).push(r.source_key);
  }

  const db = getDb();
  let tokenRows = [];
  try {
    tokenRows = await db.all(
      `
        SELECT utm_param, utm_value, first_seen_at, last_seen_at, seen_count
        FROM traffic_source_tokens
        WHERE last_seen_at >= ?
        ORDER BY last_seen_at DESC, seen_count DESC
        LIMIT ?
      `,
      [sinceMs, limitTokens]
    );
  } catch (_) {
    tokenRows = [];
  }

  const tokens = [];
  for (const r of tokenRows || []) {
    const p = normalizeTokenParam(r && r.utm_param != null ? String(r.utm_param) : '');
    const v = normalizeTokenValue(r && r.utm_value != null ? String(r.utm_value) : '');
    if (!p || !v) continue;
    const mapKey = p + '\0' + v;
    const mappedKeys = ruleMap.get(mapKey) || [];
    if (unmappedOnly && mappedKeys.length) continue;
    const mapped = mappedKeys.map((sourceKey) => {
      const meta = metaByKey.get(sourceKey);
      return {
        source_key: sourceKey,
        label: meta && meta.label != null ? String(meta.label) : sourceKey,
        icon_url: meta && meta.iconUrl != null ? meta.iconUrl : null,
      };
    });
    tokens.push({
      utm_param: p,
      utm_value: v,
      first_seen_at: r && r.first_seen_at != null ? Number(r.first_seen_at) : null,
      last_seen_at: r && r.last_seen_at != null ? Number(r.last_seen_at) : null,
      seen_count: r && r.seen_count != null ? Number(r.seen_count) : 0,
      mapped,
    });
  }

  const sources = [];
  for (const [k, v] of metaByKey.entries()) {
    sources.push({
      source_key: k,
      label: v && v.label != null ? String(v.label) : k,
      icon_url: v && v.iconUrl != null ? v.iconUrl : null,
      updated_at: v && v.updatedAt != null ? Number(v.updatedAt) : null,
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({
    ok: true,
    allowedParams: store.TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS,
    sinceDays,
    tokens,
    sources,
    rules: rulesRows,
  });
}

async function mapTokenToSource(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const utmParam = typeof body.utm_param === 'string' ? body.utm_param : '';
  const utmValue = typeof body.utm_value === 'string' ? body.utm_value : '';
  const sourceLabel = typeof body.source_label === 'string' ? body.source_label : '';
  const iconUrl = typeof body.icon_url === 'string' ? body.icon_url : null;
  const explicitKey = typeof body.source_key === 'string' ? body.source_key : null;

  const sourceKey = explicitKey && explicitKey.trim()
    ? explicitKey.trim()
    : store.makeCustomTrafficSourceKeyFromLabel(sourceLabel);

  if (!sourceKey) return res.status(400).json({ ok: false, error: 'Missing source key/label' });

  const metaRes = await store.upsertTrafficSourceMeta({ sourceKey, label: sourceLabel, iconUrl });
  if (!metaRes || metaRes.ok !== true) {
    return res.status(400).json({ ok: false, error: metaRes && metaRes.error ? metaRes.error : 'Failed to save source meta' });
  }

  const ruleRes = await store.addTrafficSourceRule({ utmParam, utmValue, sourceKey });
  if (!ruleRes || ruleRes.ok !== true) {
    return res.status(400).json({ ok: false, error: ruleRes && ruleRes.error ? ruleRes.error : 'Failed to save mapping rule' });
  }

  store.invalidateTrafficSourceMapCache();

  const sinceDays = clampInt(body.since_days, { min: 1, max: 365, fallback: 30 });
  const limitSessions = clampInt(body.limit_sessions, { min: 1, max: 200000, fallback: 50000 });
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const backfill = await store.backfillTrafficSourceKeysForRule({
    utmParam,
    utmValue,
    sinceMs,
    limitSessions,
  }).catch((e) => ({ ok: false, error: e && e.message ? String(e.message) : 'Backfill failed' }));

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({
    ok: true,
    source_key: metaRes.sourceKey,
    meta: metaRes,
    rule: ruleRes,
    backfill,
  });
}

async function upsertSourceMeta(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const sourceKey = typeof body.source_key === 'string' ? body.source_key : '';
  const label = typeof body.label === 'string' ? body.label : '';
  const iconUrl = typeof body.icon_url === 'string' ? body.icon_url : null;
  const metaRes = await store.upsertTrafficSourceMeta({ sourceKey, label, iconUrl });
  if (!metaRes || metaRes.ok !== true) {
    return res.status(400).json({ ok: false, error: metaRes && metaRes.error ? metaRes.error : 'Failed to save meta' });
  }
  store.invalidateTrafficSourceMapCache();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({ ok: true, meta: metaRes });
}

async function backfillTokens(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const sinceDays = clampInt(body.since_days, { min: 1, max: 365, fallback: 30 });
  const limitSessions = clampInt(body.limit_sessions, { min: 1, max: 200000, fallback: 20000 });
  const sinceMs = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
  const r = await store.backfillTrafficSourceTokensFromSessions({ sinceMs, limitSessions });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({ ok: !!(r && r.ok), result: r });
}

module.exports = {
  getTrafficSourceMeta,
  getTrafficSourceMaps,
  mapTokenToSource,
  upsertSourceMeta,
  backfillTokens,
};

