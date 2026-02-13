/**
 * Repository: visitors, sessions, events, settings, purchases.
 * All timestamps in epoch ms.
 */

const crypto = require('crypto');
const { getDb } = require('./db');
const config = require('./config');
const fx = require('./fx');
const salesTruth = require('./salesTruth');
const productMetaCache = require('./shopifyProductMetaCache');
const shopifyQl = require('./shopifyQl');
const reportCache = require('./reportCache');

const ALLOWED_EVENT_TYPES = new Set([
  'page_viewed', 'product_viewed', 'product_added_to_cart', 'product_removed_from_cart',
  'cart_updated', 'cart_viewed', 'checkout_started', 'checkout_completed', 'heartbeat',
]);

const WHITELIST = new Set([
  'visitor_id', 'session_id', 'event_type', 'path', 'product_handle', 'product_title',
  'variant_title', 'quantity_delta', 'price', 'cart_qty', 'cart_value', 'cart_currency',
  'order_total', 'order_currency', 'checkout_started', 'checkout_completed',
  'order_id', 'checkout_token',
  'country_code', 'device', 'network_speed', 'ts', 'customer_privacy_debug',
  'ua_device_type', 'ua_platform', 'ua_model',
  'utm_campaign', 'utm_source', 'utm_medium', 'utm_content',
  'referrer',
  'entry_url',
]);

function sanitize(payload) {
  const out = {};
  for (const key of Object.keys(payload)) {
    if (WHITELIST.has(key)) out[key] = payload[key];
  }
  return out;
}

function truthy(v) {
  if (v === true || v === 1 || v === '1') return true;
  if (typeof v === 'string' && v.trim().toLowerCase() === 'true') return true;
  return false;
}

function isCheckoutStartedPayload(payload) {
  const type = typeof payload?.event_type === 'string' ? payload.event_type : '';
  return truthy(payload?.checkout_started) || type === 'checkout_started';
}

function isCheckoutCompletedPayload(payload) {
  const type = typeof payload?.event_type === 'string' ? payload.event_type : '';
  return truthy(payload?.checkout_completed) || type === 'checkout_completed';
}

function normalizeCountry(value) {
  if (typeof value !== 'string') return null;
  const c = value.trim().toUpperCase();
  if (c.length !== 2 || c === 'XX' || c === 'T1') return null;
  return c;
}

function trimLower(v, maxLen = 256) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const out = s.length > maxLen ? s.slice(0, maxLen) : s;
  return out.toLowerCase();
}

function safeUrlHost(url) {
  if (typeof url !== 'string') return '';
  const raw = url.trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    // Handle schemeless URLs like "example.com/path"
    try {
      return new URL('https://' + raw).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }
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
      // Handle relative/path-only URLs like "/?gclid=..." from Shopify landing_site.
      try {
        return new URL(raw, 'https://example.local').searchParams;
      } catch (_) {
        return null;
      }
    }
  }
}

function extractBsAdsIdsFromEntryUrl(entryUrl) {
  const params = safeUrlParams(entryUrl || '');
  function trimParam(key, maxLen) {
    try {
      const v = params ? params.get(key) : null;
      if (v == null) return null;
      const s = String(v).trim();
      if (!s) return null;
      return s.length > maxLen ? s.slice(0, maxLen) : s;
    } catch (_) {
      return null;
    }
  }
  const bsSourceRaw = trimParam('bs_source', 32);
  const bsSource = bsSourceRaw ? bsSourceRaw.toLowerCase() : null;
  return {
    bsSource,
    bsCampaignId: trimParam('bs_campaign_id', 64),
    bsAdgroupId: trimParam('bs_adgroup_id', 64),
    bsAdId: trimParam('bs_ad_id', 64),
  };
}

let _internalHostsCache = null;
function internalHostSet() {
  if (_internalHostsCache) return _internalHostsCache;
  const set = new Set();
  function addHostFromUrl(url) {
    if (!url || typeof url !== 'string') return;
    try { set.add(new URL(url).hostname.toLowerCase()); } catch (_) {}
  }
  function addHost(host) {
    const h = typeof host === 'string' ? host.trim().toLowerCase() : '';
    if (!h) return;
    // Config may be "domain" or "https://domain"
    try { set.add(new URL(h.startsWith('http') ? h : ('https://' + h)).hostname.toLowerCase()); } catch (_) {}
  }
  addHost(config.shopDomain);
  addHost(config.allowedShopDomain);
  addHostFromUrl(config.storeMainDomain);
  // Brand/store self-referral domains: treat as internal so they map to Direct (not Other).
  // These appear as referrers during redirects / multi-domain setups.
  set.add('heybigday.com');
  set.add('www.heybigday.com');
  set.add('hbdjewellery.com');
  set.add('www.hbdjewellery.com');
  // Shopify checkout/self-referral sources
  set.add('checkout.shopify.com');
  set.add('shopify.com');
  _internalHostsCache = set;
  return set;
}

function isInternalHost(hostname) {
  const host = typeof hostname === 'string' ? hostname.trim().toLowerCase() : '';
  if (!host) return false;
  const set = internalHostSet();
  for (const h of set) {
    if (!h) continue;
    if (host === h) return true;
    if (host.endsWith('.' + h)) return true;
  }
  return false;
}

function isPaidMedium(m) {
  const s = trimLower(m, 64) || '';
  if (!s) return false;
  if (s === 'cpc' || s === 'ppc' || s === 'paid' || s === 'paidsearch' || s === 'paid_search') return true;
  if (s.includes('cpc') || s.includes('ppc') || s.includes('paid')) return true;
  return false;
}

// --- Traffic source mapping (custom sources + icons) ---
const TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_source_platform',
  'utm_creative_format',
  'utm_marketing_tactic',
  'utm_name',
  'utm_cid',
  'utm_referrer',
  'utm_reader',
];
const TRAFFIC_SOURCE_MAP_ALLOWED_PARAM_SET = new Set(TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS);

function normalizeTrafficUtmParam(v) {
  const s = trimLower(v, 64) || '';
  if (!s) return null;
  if (!TRAFFIC_SOURCE_MAP_ALLOWED_PARAM_SET.has(s)) return null;
  return s;
}

function normalizeTrafficUtmValue(v) {
  if (typeof v !== 'string') return null;
  const raw = v.trim();
  if (!raw) return null;
  const clipped = raw.length > 256 ? raw.slice(0, 256) : raw;
  return clipped.toLowerCase();
}

function normalizeTrafficSourceKey(v) {
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!raw) return null;
  let k = raw.replace(/[^a-z0-9:_\-]+/g, '_');
  k = k.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!k) return null;
  if (k.length > 80) k = k.slice(0, 80);
  return k;
}

function normalizeTrafficSourceLabelNorm(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return null;
  const flat = s.replace(/[^a-z0-9]+/g, '');
  if (!flat) return null;
  return flat.slice(0, 128);
}

function trafficSourceLabelNormFromLabelAndKey(label, sourceKey) {
  const lbl = normalizeTrafficSourceLabelNorm(label);
  if (lbl) return lbl;
  const key = normalizeTrafficSourceKey(sourceKey) || '';
  const kflat = key ? key.replace(/[^a-z0-9]+/g, '').slice(0, 126) : '';
  if (!kflat) return null;
  return ('k' + kflat).slice(0, 128);
}

function makeCustomTrafficSourceKeyFromLabel(label) {
  const base = normalizeTrafficSourceKey(label);
  if (!base) return null;
  // Avoid accidental collisions with built-in keys.
  return base.startsWith('custom_') ? base : ('custom_' + base);
}

function extractTrafficUtmTokens({ entryUrl, utmSource, utmMedium, utmCampaign, utmContent } = {}) {
  const out = [];
  const params = safeUrlParams(entryUrl || '');
  function add(param, value) {
    const p = normalizeTrafficUtmParam(param);
    const v = normalizeTrafficUtmValue(value);
    if (!p || !v) return;
    out.push({ param: p, value: v });
  }

  // Prefer values from entry_url query params.
  if (params) {
    for (const p of TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS) {
      const v = params.get(p);
      if (v != null && String(v).trim() !== '') add(p, v);
    }
  }

  // Fallback to stored Shopify pixel UTMs (if entry_url didn't include them).
  add('utm_source', utmSource);
  add('utm_medium', utmMedium);
  add('utm_campaign', utmCampaign);
  add('utm_content', utmContent);

  // Dedupe (preserve order).
  const seen = new Set();
  const deduped = [];
  for (const t of out) {
    const k = t.param + '\0' + t.value;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(t);
  }
  return deduped;
}

function hasAnyUtmInParams(params) {
  if (!params) return false;
  try {
    for (const [k, v] of params.entries()) {
      const kk = String(k || '').trim().toLowerCase();
      if (!kk.startsWith('utm_')) continue;
      if (v != null && String(v).trim() !== '') return true;
    }
  } catch (_) {}
  return false;
}

function makeUnmappedTrafficSourceKeyFromToken(token) {
  const p = token && token.param != null ? String(token.param).trim().toLowerCase() : '';
  const v = token && token.value != null ? String(token.value).trim().toLowerCase() : '';
  if (!p || !v) return null;
  // Keep stable and compact: unmapped:<param>:<value>
  const raw = `unmapped:${p}:${v}`;
  return normalizeTrafficSourceKey(raw);
}

let _trafficSourceMapCache = {
  loadedAt: 0,
  ttlMs: 30 * 1000,
  rulesByParamValue: new Map(), // param -> value -> [source_key]
  metaByKey: new Map(), // source_key -> { label, iconUrl, updatedAt }
  rulesRows: [],
  metaRows: [],
};
let _trafficSourceMapInFlight = null;

function invalidateTrafficSourceMapCache() {
  _trafficSourceMapCache.loadedAt = 0;
  _trafficSourceMapCache.rulesByParamValue = new Map();
  _trafficSourceMapCache.metaByKey = new Map();
  _trafficSourceMapCache.rulesRows = [];
  _trafficSourceMapCache.metaRows = [];
}

async function loadTrafficSourceMapFromDb() {
  const db = getDb();
  try {
    const metaRows = await db.all(
      'SELECT source_key, label, icon_url, updated_at FROM traffic_source_meta ORDER BY updated_at DESC'
    );
    const rulesRows = await db.all(
      'SELECT id, utm_param, utm_value, source_key, created_at FROM traffic_source_rules ORDER BY id ASC'
    );
    const metaByKey = new Map();
    for (const r of metaRows || []) {
      const key = normalizeTrafficSourceKey(r && r.source_key != null ? String(r.source_key) : '') || '';
      if (!key) continue;
      metaByKey.set(key, {
        key,
        label: (r && r.label != null) ? String(r.label) : key,
        iconUrl: (r && r.icon_url != null && String(r.icon_url).trim() !== '') ? String(r.icon_url).trim().slice(0, 2048) : null,
        updatedAt: (r && r.updated_at != null) ? Number(r.updated_at) : null,
      });
    }
    const rulesByParamValue = new Map();
    const cleanedRulesRows = [];
    for (const r of rulesRows || []) {
      const p = normalizeTrafficUtmParam(r && r.utm_param != null ? String(r.utm_param) : '');
      const v = normalizeTrafficUtmValue(r && r.utm_value != null ? String(r.utm_value) : '');
      const k = normalizeTrafficSourceKey(r && r.source_key != null ? String(r.source_key) : '');
      if (!p || !v || !k) continue;
      if (!rulesByParamValue.has(p)) rulesByParamValue.set(p, new Map());
      const byVal = rulesByParamValue.get(p);
      if (!byVal.has(v)) byVal.set(v, []);
      byVal.get(v).push(k);
      cleanedRulesRows.push({
        id: r && r.id != null ? Number(r.id) : null,
        utm_param: p,
        utm_value: v,
        source_key: k,
        created_at: r && r.created_at != null ? Number(r.created_at) : null,
      });
    }
    return { metaRows: metaRows || [], rulesRows: cleanedRulesRows, metaByKey, rulesByParamValue };
  } catch (err) {
    // Fail-open when tables are not present yet (during upgrade) or query fails.
    return { metaRows: [], rulesRows: [], metaByKey: new Map(), rulesByParamValue: new Map(), error: err };
  }
}

async function getTrafficSourceMapConfigCached(options = {}) {
  const force = !!options.force;
  const now = Date.now();
  if (!force && _trafficSourceMapCache.loadedAt && (now - _trafficSourceMapCache.loadedAt) < _trafficSourceMapCache.ttlMs) {
    return _trafficSourceMapCache;
  }
  if (_trafficSourceMapInFlight) return _trafficSourceMapInFlight;
  _trafficSourceMapInFlight = loadTrafficSourceMapFromDb()
    .then((data) => {
      _trafficSourceMapCache.loadedAt = Date.now();
      _trafficSourceMapCache.metaByKey = data.metaByKey || new Map();
      _trafficSourceMapCache.rulesByParamValue = data.rulesByParamValue || new Map();
      _trafficSourceMapCache.rulesRows = data.rulesRows || [];
      _trafficSourceMapCache.metaRows = data.metaRows || [];
      return _trafficSourceMapCache;
    })
    .finally(() => {
      _trafficSourceMapInFlight = null;
    });
  return _trafficSourceMapInFlight;
}

function resolveMappedSourceKeys(tokens, mapConfig) {
  const rulesByParamValue = mapConfig && mapConfig.rulesByParamValue ? mapConfig.rulesByParamValue : new Map();
  const out = [];
  const seen = new Set();
  for (const t of Array.isArray(tokens) ? tokens : []) {
    const p = t && t.param ? String(t.param) : '';
    const v = t && t.value ? String(t.value) : '';
    const byVal = rulesByParamValue.get(p);
    if (!byVal) continue;
    const keys = byVal.get(v);
    if (!Array.isArray(keys) || !keys.length) continue;
    // Newest mapping wins (rules are appended; DB load preserves id ASC order).
    for (let i = keys.length - 1; i >= 0; i--) {
      const kk = normalizeTrafficSourceKey(keys[i]);
      if (!kk) continue;
      if (seen.has(kk)) continue;
      seen.add(kk);
      out.push(kk);
    }
  }
  return out;
}

async function upsertTrafficSourceTokens(tokens, tsMs) {
  const list = Array.isArray(tokens) ? tokens : [];
  if (!list.length) return { ok: true, insertedOrUpdated: 0 };
  const db = getDb();
  const ts = typeof tsMs === 'number' ? tsMs : Date.now();
  const counts = new Map();
  for (const t of list) {
    const p = normalizeTrafficUtmParam(t && t.param);
    const v = normalizeTrafficUtmValue(t && t.value);
    if (!p || !v) continue;
    const key = p + '\x1f' + v;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const rows = Array.from(counts.entries()).map(([key, count]) => {
    const split = key.split('\x1f');
    return { p: split[0], v: split[1], count };
  });
  if (!rows.length) return { ok: true, insertedOrUpdated: 0 };

  const valuesSql = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const params = [];
  rows.forEach((r) => {
    params.push(r.p, r.v, ts, ts, r.count);
  });

  try {
    await db.run(
      `
        INSERT INTO traffic_source_tokens (utm_param, utm_value, first_seen_at, last_seen_at, seen_count)
        VALUES ${valuesSql}
        ON CONFLICT (utm_param, utm_value) DO UPDATE SET
          last_seen_at = CASE
            WHEN excluded.last_seen_at > traffic_source_tokens.last_seen_at THEN excluded.last_seen_at
            ELSE traffic_source_tokens.last_seen_at
          END,
          seen_count = traffic_source_tokens.seen_count + excluded.seen_count
      `,
      params
    );
  } catch (_) {
    // Fail-open (e.g. tables not present yet).
    return { ok: false, insertedOrUpdated: 0 };
  }
  return { ok: true, insertedOrUpdated: rows.length };
}

async function upsertTrafficSourceMeta({ sourceKey, label, iconUrl } = {}) {
  const key = normalizeTrafficSourceKey(sourceKey);
  const lbl = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null;
  const icon = typeof iconUrl === 'string' && iconUrl.trim() ? iconUrl.trim().slice(0, 2048) : null;
  const labelNorm = (key && lbl) ? trafficSourceLabelNormFromLabelAndKey(lbl, key) : null;
  if (!key || !lbl || !labelNorm) return { ok: false, error: 'Missing sourceKey or label' };
  const db = getDb();
  const now = Date.now();
  try {
    // Prevent duplicate source labels (case/spacing/punctuation-insensitive).
    // This keeps identical names grouped into a single Source key.
    try {
      const existing = await db.get(
        'SELECT source_key FROM traffic_source_meta WHERE label_norm = ? AND source_key != ? LIMIT 1',
        [labelNorm, key]
      );
      if (existing && existing.source_key) {
        return {
          ok: false,
          error: `Source label already exists (use ${String(existing.source_key).trim().toLowerCase()})`,
        };
      }
    } catch (_) {
      // Fail open if label_norm column doesn't exist yet (during upgrade).
    }

    await db.run(
      `
        INSERT INTO traffic_source_meta (source_key, label, label_norm, icon_url, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (source_key) DO UPDATE SET
          label = excluded.label,
          label_norm = excluded.label_norm,
          icon_url = excluded.icon_url,
          updated_at = excluded.updated_at
      `,
      [key, lbl, labelNorm, icon, now]
    );
    return { ok: true, sourceKey: key, label: lbl, iconUrl: icon, updatedAt: now };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Failed to upsert meta';
    // Fail open if the schema hasn't been upgraded yet (missing label_norm).
    if (/label_norm/i.test(msg) && (/no such column/i.test(msg) || /does not exist/i.test(msg))) {
      try {
        await db.run(
          `
            INSERT INTO traffic_source_meta (source_key, label, icon_url, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (source_key) DO UPDATE SET
              label = excluded.label,
              icon_url = excluded.icon_url,
              updated_at = excluded.updated_at
          `,
          [key, lbl, icon, now]
        );
        return { ok: true, sourceKey: key, label: lbl, iconUrl: icon, updatedAt: now };
      } catch (e2) {
        return { ok: false, error: e2 && e2.message ? String(e2.message) : msg };
      }
    }
    return { ok: false, error: msg };
  }
}

async function addTrafficSourceRule({ utmParam, utmValue, sourceKey } = {}) {
  const p = normalizeTrafficUtmParam(utmParam);
  const v = normalizeTrafficUtmValue(utmValue);
  const k = normalizeTrafficSourceKey(sourceKey);
  if (!p || !v || !k) return { ok: false, error: 'Missing utmParam, utmValue, or sourceKey' };
  const db = getDb();
  const now = Date.now();
  try {
    await db.run(
      `
        INSERT INTO traffic_source_rules (utm_param, utm_value, source_key, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (utm_param, utm_value, source_key) DO NOTHING
      `,
      [p, v, k, now]
    );
    return { ok: true, utmParam: p, utmValue: v, sourceKey: k, createdAt: now };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : 'Failed to insert rule' };
  }
}

async function getTrafficSourceMapVersion() {
  const db = getDb();
  try {
    const meta = await db.get('SELECT MAX(updated_at) AS max_updated_at FROM traffic_source_meta');
    const rules = await db.get('SELECT MAX(created_at) AS max_created_at FROM traffic_source_rules');
    return {
      metaUpdatedAtMax: meta && meta.max_updated_at != null ? Number(meta.max_updated_at) : 0,
      rulesCreatedAtMax: rules && rules.max_created_at != null ? Number(rules.max_created_at) : 0,
    };
  } catch (_) {
    return { metaUpdatedAtMax: 0, rulesCreatedAtMax: 0 };
  }
}

async function deriveTrafficSourceKeyWithMaps({ utmSource, utmMedium, utmCampaign, utmContent, referrer, entryUrl } = {}) {
  const tokens = extractTrafficUtmTokens({ entryUrl, utmSource, utmMedium, utmCampaign, utmContent });
  const mapConfig = await getTrafficSourceMapConfigCached();
  const mappedKeys = resolveMappedSourceKeys(tokens, mapConfig);
  const mappedPrimary = mappedKeys.length ? mappedKeys[0] : null;
  const baseKey = deriveTrafficSourceKey({ utmSource, utmMedium, utmCampaign, utmContent, referrer, entryUrl });
  let unmappedKey = null;
  if (!mappedPrimary && tokens.length) {
    // Only emit an "unmapped" bucket when attribution is detectable but not yet mapped.
    // If baseKey already resolves to a known channel (e.g. google_ads via gclid), keep it.
    const bk = (baseKey || '').trim().toLowerCase();
    if (!bk || bk === 'other' || bk === 'direct') {
      unmappedKey = makeUnmappedTrafficSourceKeyFromToken(tokens[0]);
    }
  }
  return { trafficSourceKey: mappedPrimary || unmappedKey || baseKey || 'direct', mappedKeys };
}

async function backfillTrafficSourceTokensFromSessions({ sinceMs, limitSessions } = {}) {
  const db = getDb();
  const since = typeof sinceMs === 'number' ? sinceMs : (Date.now() - 30 * 24 * 60 * 60 * 1000);
  const limit = typeof limitSessions === 'number' && Number.isFinite(limitSessions) ? Math.max(1, Math.min(200000, Math.floor(limitSessions))) : 20000;
  let scanned = 0;
  let tokensUpserted = 0;
  try {
    const rows = await db.all(
      `
        SELECT entry_url, utm_source, utm_medium, utm_campaign, utm_content, last_seen
        FROM sessions
        WHERE last_seen >= ?
        ORDER BY last_seen DESC
        LIMIT ?
      `,
      [since, limit]
    );
    for (const r of rows || []) {
      scanned++;
      const ts = r && r.last_seen != null ? Number(r.last_seen) : Date.now();
      const tokens = extractTrafficUtmTokens({
        entryUrl: r && r.entry_url != null ? String(r.entry_url) : null,
        utmSource: r && r.utm_source != null ? String(r.utm_source) : null,
        utmMedium: r && r.utm_medium != null ? String(r.utm_medium) : null,
        utmCampaign: r && r.utm_campaign != null ? String(r.utm_campaign) : null,
        utmContent: r && r.utm_content != null ? String(r.utm_content) : null,
      });
      if (!tokens.length) continue;
      const res = await upsertTrafficSourceTokens(tokens, ts);
      tokensUpserted += res && typeof res.insertedOrUpdated === 'number' ? res.insertedOrUpdated : 0;
    }
    return { ok: true, scannedSessions: scanned, tokenUpserts: tokensUpserted, sinceMs: since, limitSessions: limit };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : 'Backfill failed', scannedSessions: scanned, tokenUpserts: tokensUpserted };
  }
}

async function backfillTrafficSourceKeysForRule({ utmParam, utmValue, sinceMs, limitSessions } = {}) {
  const p = normalizeTrafficUtmParam(utmParam);
  const v = normalizeTrafficUtmValue(utmValue);
  if (!p || !v) return { ok: false, error: 'Invalid utmParam or utmValue' };
  const db = getDb();
  const since = typeof sinceMs === 'number' ? sinceMs : (Date.now() - 30 * 24 * 60 * 60 * 1000);
  const limit = typeof limitSessions === 'number' && Number.isFinite(limitSessions) ? Math.max(1, Math.min(200000, Math.floor(limitSessions))) : 50000;

  // Fetch candidate sessions (best-effort narrowing).
  let where = 'last_seen >= ?';
  const params = [since];
  if (p === 'utm_source' || p === 'utm_medium' || p === 'utm_campaign' || p === 'utm_content') {
    where += ` AND LOWER(TRIM(${p})) = ?`;
    params.push(v);
  } else {
    where += ' AND entry_url IS NOT NULL AND LOWER(entry_url) LIKE ?';
    params.push('%' + p + '=%');
  }
  where += ` ORDER BY last_seen DESC LIMIT ?`;
  params.push(limit);

  let scanned = 0;
  let updated = 0;
  const mapConfig = await getTrafficSourceMapConfigCached({ force: true });
  const rows = await db.all(
    `
      SELECT session_id, utm_source, utm_medium, utm_campaign, utm_content, referrer, entry_url, traffic_source_key
      FROM sessions
      WHERE ${where}
    `,
    params
  );
  for (const r of rows || []) {
    scanned++;
    const entryUrl = r && r.entry_url != null ? String(r.entry_url) : null;
    const tokens = extractTrafficUtmTokens({
      entryUrl,
      utmSource: r && r.utm_source != null ? String(r.utm_source) : null,
      utmMedium: r && r.utm_medium != null ? String(r.utm_medium) : null,
      utmCampaign: r && r.utm_campaign != null ? String(r.utm_campaign) : null,
      utmContent: r && r.utm_content != null ? String(r.utm_content) : null,
    });
    // Confirm token is truly present for this session (avoid false positives from LIKE).
    const hasToken = tokens.some((t) => t.param === p && t.value === v);
    if (!hasToken) continue;
    const mappedKeys = resolveMappedSourceKeys(tokens, mapConfig);
    const mappedPrimary = mappedKeys.length ? mappedKeys[0] : null;
    const baseKey = deriveTrafficSourceKey({
      utmSource: r && r.utm_source != null ? String(r.utm_source) : null,
      utmMedium: r && r.utm_medium != null ? String(r.utm_medium) : null,
      utmCampaign: r && r.utm_campaign != null ? String(r.utm_campaign) : null,
      utmContent: r && r.utm_content != null ? String(r.utm_content) : null,
      referrer: r && r.referrer != null ? String(r.referrer) : null,
      entryUrl,
    });
    const nextKey = mappedPrimary || baseKey || 'direct';
    const curKey = r && r.traffic_source_key != null ? String(r.traffic_source_key).trim().toLowerCase() : '';
    if (curKey === nextKey) continue;
    await db.run('UPDATE sessions SET traffic_source_key = ? WHERE session_id = ?', [nextKey, r.session_id]);
    updated++;
  }
  return { ok: true, scannedSessions: scanned, updatedSessions: updated, sinceMs: since, limitSessions: limit, utmParam: p, utmValue: v };
}

/**
 * Derive a stable source key using:
 * - Shopify pixel UTMs (utm_source/utm_medium/etc)
 * - Cloudflare/Worker fallback entry_url/referrer (including click IDs like gclid)
 */
function deriveTrafficSourceKey({ utmSource, utmMedium, utmCampaign, utmContent, referrer, entryUrl } = {}) {
  const us = trimLower(utmSource, 128) || '';
  const um = trimLower(utmMedium, 64) || '';
  const uc = trimLower(utmCampaign, 128) || '';
  const ucon = trimLower(utmContent, 128) || '';

  const refHost = safeUrlHost(referrer || '');
  const entryParams = safeUrlParams(entryUrl || '');

  // Shopify truth often only has UTMs inside landing_site (not in separate utm_* fields).
  // Prefer explicit utm_* fields when available, otherwise fall back to entry URL params.
  const usEff = us || (trimLower(entryParams && entryParams.get('utm_source'), 128) || '');
  const umEff = um || (trimLower(entryParams && entryParams.get('utm_medium'), 64) || '');
  const ucEff = uc || (trimLower(entryParams && entryParams.get('utm_campaign'), 128) || '');
  const uconEff = ucon || (trimLower(entryParams && entryParams.get('utm_content'), 128) || '');

  const bsSource = trimLower(entryParams && entryParams.get('bs_source'), 64) || '';

  const hasGclid = !!(entryParams && (entryParams.get('gclid') || entryParams.get('gbraid') || entryParams.get('wbraid')));
  const hasMsclkid = !!(entryParams && entryParams.get('msclkid'));
  const hasFbclid = !!(entryParams && entryParams.get('fbclid'));
  const paid = isPaidMedium(umEff);

  // 1) Explicit UTMs win (Shopify pixel)
  if (usEff.includes('omnisend') || (umEff === 'email' && (usEff.includes('omnisend') || ucEff.includes('omnisend') || uconEff.includes('omnisend')))) {
    return 'omnisend';
  }
  if (usEff.includes('google') || usEff.includes('googleads') || usEff.includes('adwords')) {
    if (paid || hasGclid) return 'google_ads';
    return 'google_organic';
  }
  if (usEff.includes('bing') || usEff.includes('microsoft')) {
    if (paid || hasMsclkid) return 'bing_ads';
    return 'bing_organic';
  }
  if (usEff.includes('facebook') || usEff === 'fb' || usEff.includes('instagram')) {
    if (paid || hasFbclid) return 'facebook_ads';
    return 'facebook_organic';
  }

  // 2) Click IDs (Cloudflare/Worker entry_url)
  if (hasGclid) return 'google_ads';
  if (hasMsclkid) return 'bing_ads';
  if (hasFbclid) return 'facebook_ads';

  // 2b) Tracking template params (e.g. bs_source=google)
  // These are intentionally treated as paid (ads) signals.
  if (bsSource) {
    if (bsSource.includes('google') || bsSource.includes('adwords') || bsSource.includes('googleads')) return 'google_ads';
    if (bsSource.includes('bing') || bsSource.includes('microsoft')) return 'bing_ads';
    if (bsSource.includes('facebook') || bsSource === 'fb' || bsSource.includes('instagram')) return 'facebook_ads';
  }

  // 3) Referrer host (Cloudflare/Worker fallback)
  if (refHost && !isInternalHost(refHost)) {
    if (refHost.includes('google.')) return 'google_organic';
    if (refHost.endsWith('bing.com') || refHost.endsWith('search.msn.com') || refHost.includes('bing.')) return 'bing_organic';
    if (
      refHost.endsWith('facebook.com') ||
      refHost === 'l.facebook.com' ||
      refHost === 'm.facebook.com' ||
      refHost === 'lm.facebook.com'
    ) {
      return 'facebook_organic';
    }
    return 'other';
  }

  // 4) Direct / internal
  const hasAnyUtm = !!(us || um || uc || ucon) || hasAnyUtmInParams(entryParams);
  if (!hasAnyUtm && (!refHost || isInternalHost(refHost))) return 'direct';
  if (hasAnyUtm) return 'other';
  return 'direct';
}

function normalizeUaDeviceType(v) {
  const s = trimLower(v, 16);
  if (s === 'desktop' || s === 'mobile' || s === 'tablet') return s;
  return null;
}

function normalizeUaPlatform(v) {
  const s = trimLower(v, 16);
  if (!s) return null;
  if (s === 'windows' || s === 'mac' || s === 'ios' || s === 'android' || s === 'chromeos' || s === 'linux' || s === 'other') return s;
  return null;
}

function normalizeUaModel(v) {
  const s = trimLower(v, 16);
  if (s === 'iphone' || s === 'ipad') return s;
  return null;
}

async function getSetting(key) {
  const db = getDb();
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

async function setSetting(key, value) {
  const db = getDb();
  if (config.dbUrl) {
    await db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
  } else {
    await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  }
}

// Reporting sources (used to switch between Shopify truth vs pixel-derived reporting)
const REPORTING_ORDERS_SOURCE_KEY = 'reporting_orders_source'; // orders_shopify | pixel
const REPORTING_SESSIONS_SOURCE_KEY = 'reporting_sessions_source'; // sessions | shopify_sessions

function normalizeReportingOrdersSource(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  // Guardrail: reporting must never exceed Shopify. Pixel-derived purchases remain debug-only.
  if (s === 'orders_shopify') return s;
  return null;
}

function normalizeReportingSessionsSource(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  if (s === 'sessions' || s === 'shopify_sessions') return s;
  return null;
}

async function getReportingConfig() {
  const rawOrders = await getSetting(REPORTING_ORDERS_SOURCE_KEY);
  const rawSessions = await getSetting(REPORTING_SESSIONS_SOURCE_KEY);
  const ordersSource = normalizeReportingOrdersSource(rawOrders) || 'orders_shopify';
  const sessionsSource = normalizeReportingSessionsSource(rawSessions) || 'sessions';
  return { ordersSource, sessionsSource };
}

async function isTrackingEnabled() {
  const v = await getSetting('tracking_enabled');
  if (v === null) return config.trackingDefaultEnabled;
  return v === 'true' || v === '1';
}

async function getVisitor(visitorId) {
  const db = getDb();
  return db.get('SELECT * FROM visitors WHERE visitor_id = ?', [visitorId]);
}

async function upsertVisitor(payload) {
  const db = getDb();
  const now = payload.ts || Date.now();
  const normalizedCountry = normalizeCountry(payload.country_code);
  const existing = await db.get('SELECT visitor_id, last_seen, first_seen FROM visitors WHERE visitor_id = ?', [payload.visitor_id]);
  const isReturning = existing ? (now - existing.last_seen > config.returningGapMinutes * 60 * 1000) : false;
  const returningCount = existing ? (existing.returning_count || 0) + (isReturning ? 1 : 0) : 0;
  const firstSeen = existing && existing.first_seen != null ? existing.first_seen : now;

  if (config.dbUrl) {
    await db.run(`
      INSERT INTO visitors (visitor_id, first_seen, last_seen, last_country, device, network_speed, is_returning, returning_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (visitor_id) DO UPDATE SET
        last_seen = $3, last_country = COALESCE($4, visitors.last_country), device = COALESCE($5, visitors.device),
        network_speed = COALESCE($6, visitors.network_speed), is_returning = $7, returning_count = $8
    `, [
      payload.visitor_id,
      firstSeen,
      now,
      normalizedCountry,
      payload.device ?? null,
      payload.network_speed ?? null,
      isReturning ? 1 : 0,
      returningCount,
    ]);
  } else {
    if (existing) {
      await db.run(`
        UPDATE visitors SET last_seen = ?, last_country = COALESCE(?, last_country), device = COALESCE(?, device),
        network_speed = COALESCE(?, network_speed), is_returning = ?, returning_count = ? WHERE visitor_id = ?
      `, [now, normalizedCountry, payload.device, payload.network_speed, isReturning ? 1 : 0, returningCount, payload.visitor_id]);
    } else {
      await db.run(`
        INSERT INTO visitors (visitor_id, first_seen, last_seen, last_country, device, network_speed, is_returning, returning_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [payload.visitor_id, now, now, normalizedCountry, payload.device ?? null, payload.network_speed ?? null, 0, 0]);
    }
  }
  return { isReturning };
}

async function getSession(sessionId) {
  const db = getDb();
  return db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
}

function parseCfContext(cfContext) {
  if (!cfContext) return { cfKnownBot: null, cfVerifiedBotCategory: null, cfCountry: null, cfColo: null, cfAsn: null };
  const knownBot = cfContext.cf_known_bot;
  const cfKnownBot = knownBot === '1' || knownBot === true ? 1 : (knownBot === '0' || knownBot === false ? 0 : null);
  return {
    cfKnownBot,
    cfVerifiedBotCategory: cfContext.cf_verified_bot_category && String(cfContext.cf_verified_bot_category).trim() ? String(cfContext.cf_verified_bot_category).trim().slice(0, 128) : null,
    cfCountry: cfContext.cf_country && String(cfContext.cf_country).trim().length === 2 ? String(cfContext.cf_country).trim().toUpperCase() : null,
    cfColo: cfContext.cf_colo && String(cfContext.cf_colo).trim() ? String(cfContext.cf_colo).trim().slice(0, 32) : null,
    cfAsn: cfContext.cf_asn != null && String(cfContext.cf_asn).trim() ? String(cfContext.cf_asn).trim().slice(0, 32) : null,
  };
}

async function upsertSession(payload, visitorIsReturning, cfContext) {
  const db = getDb();
  const now = payload.ts || Date.now();
  const existing = await db.get('SELECT * FROM sessions WHERE session_id = ?', [payload.session_id]);
  const normalizedCountry = normalizeCountry(payload.country_code);
  const cf = parseCfContext(cfContext);
  const checkoutCompleted = isCheckoutCompletedPayload(payload);
  const checkoutStarted = isCheckoutStartedPayload(payload);
  let purchasedAt = typeof existing?.purchased_at === 'number' ? existing.purchased_at : null;
  if (checkoutCompleted && !purchasedAt) {
    purchasedAt = now;
  }

  let cartQty = payload.cart_qty;
  if (cartQty === undefined && existing) cartQty = existing.cart_qty;
  if (cartQty === undefined) cartQty = 0;

  let isCheckingOut = existing?.is_checking_out || (checkoutStarted ? 1 : 0) || 0;
  let checkoutStartedAt = existing?.checkout_started_at || (checkoutStarted ? now : null);
  if (checkoutCompleted) {
    isCheckingOut = 0;
    checkoutStartedAt = null;
  }
  if (checkoutStarted) {
    isCheckingOut = 1;
    checkoutStartedAt = now;
  }
  const checkoutWindowMs = config.checkoutStartedWindowMinutes * 60 * 1000;
  if (checkoutStartedAt && (now - checkoutStartedAt) > checkoutWindowMs) {
    isCheckingOut = 0;
  }

  const hasPurchased = existing?.has_purchased || (checkoutCompleted ? 1 : 0) || 0;
  const lastPath = payload.path ?? existing?.last_path ?? null;
  const lastProductHandle = payload.product_handle ?? existing?.last_product_handle ?? null;

  let cartValue = payload.cart_value;
  if (cartValue === undefined && existing?.cart_value != null) cartValue = existing.cart_value;
  if (typeof cartValue === 'string') cartValue = parseFloat(cartValue);
  if (typeof cartValue !== 'number' || Number.isNaN(cartValue)) cartValue = null;
  const cartCurrency = typeof payload.cart_currency === 'string' ? payload.cart_currency : (existing?.cart_currency ?? null);

  let orderTotal = payload.order_total;
  let orderCurrency = payload.order_currency;
  if (checkoutCompleted && (payload.order_total != null || payload.order_currency != null)) {
    if (typeof payload.order_total === 'number') orderTotal = payload.order_total;
    else if (typeof payload.order_total === 'string') {
      const parsed = parseFloat(payload.order_total);
      if (!Number.isNaN(parsed)) orderTotal = parsed;
    }
    if (typeof payload.order_currency === 'string') orderCurrency = payload.order_currency;
  }
  if (orderTotal === undefined && existing?.order_total != null) orderTotal = existing.order_total;
  if (orderCurrency === undefined && existing?.order_currency) orderCurrency = existing.order_currency;
  if (typeof orderTotal !== 'number' || Number.isNaN(orderTotal)) orderTotal = null;
  if (typeof orderCurrency !== 'string') orderCurrency = null;

  const trimUtm = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const utmCampaign = trimUtm(payload.utm_campaign) ?? existing?.utm_campaign ?? null;
  const utmSource = trimUtm(payload.utm_source) ?? existing?.utm_source ?? null;
  const utmMedium = trimUtm(payload.utm_medium) ?? existing?.utm_medium ?? null;
  const utmContent = trimUtm(payload.utm_content) ?? existing?.utm_content ?? null;

  const trimUrl = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2048) : null);
  const referrer = trimUrl(payload.referrer) ?? existing?.referrer ?? null;
  const hasExistingReferrer = existing?.referrer != null && String(existing.referrer).trim() !== '';
  const updateReferrer = hasExistingReferrer ? null : (trimUrl(payload.referrer) ?? null);

  const entryUrl = trimUrl(payload.entry_url) ?? existing?.entry_url ?? null;
  const hasExistingEntryUrl = existing?.entry_url != null && String(existing.entry_url).trim() !== '';
  const updateEntryUrl = hasExistingEntryUrl ? null : (trimUrl(payload.entry_url) ?? null);

  const bsExistingSource = existing?.bs_source != null && String(existing.bs_source).trim() !== '' ? String(existing.bs_source).trim() : null;
  const bsExistingCampaignId = existing?.bs_campaign_id != null && String(existing.bs_campaign_id).trim() !== '' ? String(existing.bs_campaign_id).trim() : null;
  const bsExistingAdgroupId = existing?.bs_adgroup_id != null && String(existing.bs_adgroup_id).trim() !== '' ? String(existing.bs_adgroup_id).trim() : null;
  const bsExistingAdId = existing?.bs_ad_id != null && String(existing.bs_ad_id).trim() !== '' ? String(existing.bs_ad_id).trim() : null;
  const bsFromUrl = extractBsAdsIdsFromEntryUrl(updateEntryUrl || entryUrl || '');
  const bsSource = bsExistingSource || bsFromUrl.bsSource || null;
  const bsCampaignId = bsExistingCampaignId || bsFromUrl.bsCampaignId || null;
  const bsAdgroupId = bsExistingAdgroupId || bsFromUrl.bsAdgroupId || null;
  const bsAdId = bsExistingAdId || bsFromUrl.bsAdId || null;
  const updateBsSource = bsExistingSource ? null : (bsFromUrl.bsSource || null);
  const updateBsCampaignId = bsExistingCampaignId ? null : (bsFromUrl.bsCampaignId || null);
  const updateBsAdgroupId = bsExistingAdgroupId ? null : (bsFromUrl.bsAdgroupId || null);
  const updateBsAdId = bsExistingAdId ? null : (bsFromUrl.bsAdId || null);

  // Capture UTM tokens once per session (when we first record entry_url) so the admin UI can surface "unmapped" sources.
  if (updateEntryUrl) {
    const tokens = extractTrafficUtmTokens({ entryUrl: updateEntryUrl, utmSource, utmMedium, utmCampaign, utmContent });
    await upsertTrafficSourceTokens(tokens, now);
  }

  const derivedSource = await deriveTrafficSourceKeyWithMaps({
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    referrer,
    entryUrl,
  });
  const trafficSourceKey = derivedSource && derivedSource.trafficSourceKey ? derivedSource.trafficSourceKey : null;
  const uaDeviceType = normalizeUaDeviceType(payload.ua_device_type);
  const uaPlatform = normalizeUaPlatform(payload.ua_platform);
  const uaModel = normalizeUaModel(payload.ua_model);

  const cfKnownBot = cf.cfKnownBot != null ? cf.cfKnownBot : null;
  const cfVerifiedBotCategory = cf.cfVerifiedBotCategory;
  const cfCountry = cf.cfCountry;
  const cfColo = cf.cfColo;
  const cfAsn = cf.cfAsn;
  const isReturningSession = visitorIsReturning ? 1 : 0;

  if (!existing) {
    if (config.dbUrl) {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, is_returning, traffic_source_key, ua_device_type, ua_platform, ua_model, bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id)
        VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 0, NULL, NULL, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36)
        ON CONFLICT (session_id) DO UPDATE SET
          visitor_id = EXCLUDED.visitor_id,
          started_at = EXCLUDED.started_at,
          last_seen = EXCLUDED.last_seen,
          last_path = EXCLUDED.last_path,
          last_product_handle = EXCLUDED.last_product_handle,
          first_path = EXCLUDED.first_path,
          first_product_handle = EXCLUDED.first_product_handle,
          cart_qty = EXCLUDED.cart_qty,
          cart_value = EXCLUDED.cart_value,
          cart_currency = EXCLUDED.cart_currency,
          order_total = EXCLUDED.order_total,
          order_currency = EXCLUDED.order_currency,
          country_code = EXCLUDED.country_code,
          utm_campaign = EXCLUDED.utm_campaign,
          utm_source = EXCLUDED.utm_source,
          utm_medium = EXCLUDED.utm_medium,
          utm_content = EXCLUDED.utm_content,
          referrer = EXCLUDED.referrer,
          entry_url = EXCLUDED.entry_url,
          is_checking_out = EXCLUDED.is_checking_out,
          checkout_started_at = EXCLUDED.checkout_started_at,
          has_purchased = EXCLUDED.has_purchased,
          purchased_at = EXCLUDED.purchased_at,
          is_abandoned = EXCLUDED.is_abandoned,
          abandoned_at = EXCLUDED.abandoned_at,
          recovered_at = EXCLUDED.recovered_at,
          cf_known_bot = EXCLUDED.cf_known_bot,
          cf_verified_bot_category = EXCLUDED.cf_verified_bot_category,
          cf_country = EXCLUDED.cf_country,
          cf_colo = EXCLUDED.cf_colo,
          cf_asn = EXCLUDED.cf_asn,
          traffic_source_key = COALESCE(EXCLUDED.traffic_source_key, sessions.traffic_source_key),
          ua_device_type = COALESCE(EXCLUDED.ua_device_type, sessions.ua_device_type),
          ua_platform = COALESCE(EXCLUDED.ua_platform, sessions.ua_platform),
          ua_model = COALESCE(EXCLUDED.ua_model, sessions.ua_model),
          bs_source = COALESCE(EXCLUDED.bs_source, sessions.bs_source),
          bs_campaign_id = COALESCE(EXCLUDED.bs_campaign_id, sessions.bs_campaign_id),
          bs_adgroup_id = COALESCE(EXCLUDED.bs_adgroup_id, sessions.bs_adgroup_id),
          bs_ad_id = COALESCE(EXCLUDED.bs_ad_id, sessions.bs_ad_id)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, isReturningSession, trafficSourceKey, uaDeviceType, uaPlatform, uaModel, bsSource, bsCampaignId, bsAdgroupId, bsAdId]);
    } else {
      await db.run(`
        INSERT INTO sessions (session_id, visitor_id, started_at, last_seen, last_path, last_product_handle, first_path, first_product_handle, cart_qty, cart_value, cart_currency, order_total, order_currency, country_code, utm_campaign, utm_source, utm_medium, utm_content, referrer, entry_url, is_checking_out, checkout_started_at, has_purchased, purchased_at, is_abandoned, abandoned_at, recovered_at, cf_known_bot, cf_verified_bot_category, cf_country, cf_colo, cf_asn, is_returning, traffic_source_key, ua_device_type, ua_platform, ua_model, bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [payload.session_id, payload.visitor_id, now, now, lastPath, lastProductHandle, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, referrer, entryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, cfKnownBot, cfVerifiedBotCategory, cfCountry, cfColo, cfAsn, isReturningSession, trafficSourceKey, uaDeviceType, uaPlatform, uaModel, bsSource, bsCampaignId, bsAdgroupId, bsAdId]);
    }
  } else {
    const cfUpdates = [];
    const cfParams = [];
    let p = config.dbUrl ? 27 : 0;
    if (cfKnownBot != null) {
      cfUpdates.push(config.dbUrl ? `cf_known_bot = $${++p}` : 'cf_known_bot = ?');
      cfParams.push(cfKnownBot);
    }
    if (cfVerifiedBotCategory !== undefined && cfVerifiedBotCategory !== null) {
      cfUpdates.push(config.dbUrl ? `cf_verified_bot_category = $${++p}` : 'cf_verified_bot_category = ?');
      cfParams.push(cfVerifiedBotCategory);
    }
    if (cfCountry !== undefined && cfCountry !== null) {
      cfUpdates.push(config.dbUrl ? `cf_country = $${++p}` : 'cf_country = ?');
      cfParams.push(cfCountry);
    }
    if (cfColo !== undefined && cfColo !== null) {
      cfUpdates.push(config.dbUrl ? `cf_colo = $${++p}` : 'cf_colo = ?');
      cfParams.push(cfColo);
    }
    if (cfAsn !== undefined && cfAsn !== null) {
      cfUpdates.push(config.dbUrl ? `cf_asn = $${++p}` : 'cf_asn = ?');
      cfParams.push(cfAsn);
    }
    const cfSet = cfUpdates.length ? ', ' + cfUpdates.join(', ') : '';
    const sessionIdPlaceholder = config.dbUrl ? '$' + (28 + cfParams.length) : '?';
    if (config.dbUrl) {
      await db.run(`
        UPDATE sessions SET last_seen = $1, last_path = COALESCE($2, last_path), last_product_handle = COALESCE($3, last_product_handle),
        cart_qty = $4, cart_value = COALESCE($5, cart_value), cart_currency = COALESCE($6, cart_currency),
        order_total = COALESCE($7, order_total), order_currency = COALESCE($8, order_currency),
        country_code = COALESCE($9, country_code), utm_campaign = COALESCE($10, utm_campaign), utm_source = COALESCE($11, utm_source), utm_medium = COALESCE($12, utm_medium), utm_content = COALESCE($13, utm_content),
        referrer = COALESCE($14, referrer),
        entry_url = COALESCE($15, entry_url),
        is_checking_out = $16, checkout_started_at = $17, has_purchased = $18, purchased_at = COALESCE($19, purchased_at),
        traffic_source_key = COALESCE($20, traffic_source_key),
        ua_device_type = COALESCE($21, ua_device_type),
        ua_platform = COALESCE($22, ua_platform),
        ua_model = COALESCE($23, ua_model),
        bs_source = COALESCE($24, bs_source),
        bs_campaign_id = COALESCE($25, bs_campaign_id),
        bs_adgroup_id = COALESCE($26, bs_adgroup_id),
        bs_ad_id = COALESCE($27, bs_ad_id)
        ${cfSet}
        WHERE session_id = ${sessionIdPlaceholder}
      `, [now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, updateReferrer, updateEntryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, trafficSourceKey, uaDeviceType, uaPlatform, uaModel, updateBsSource, updateBsCampaignId, updateBsAdgroupId, updateBsAdId, ...cfParams, payload.session_id]);
    } else {
      const placeholders = [now, lastPath, lastProductHandle, cartQty, cartValue, cartCurrency, orderTotal, orderCurrency, normalizedCountry, utmCampaign, utmSource, utmMedium, utmContent, updateReferrer, updateEntryUrl, isCheckingOut, checkoutStartedAt, hasPurchased, purchasedAt, trafficSourceKey, uaDeviceType, uaPlatform, uaModel, updateBsSource, updateBsCampaignId, updateBsAdgroupId, updateBsAdId, ...cfParams, payload.session_id];
      await db.run(`
        UPDATE sessions SET last_seen = ?, last_path = COALESCE(?, last_path), last_product_handle = COALESCE(?, last_product_handle),
        cart_qty = ?, cart_value = COALESCE(?, cart_value), cart_currency = COALESCE(?, cart_currency),
        order_total = COALESCE(?, order_total), order_currency = COALESCE(?, order_currency),
        country_code = COALESCE(?, country_code), utm_campaign = COALESCE(?, utm_campaign), utm_source = COALESCE(?, utm_source), utm_medium = COALESCE(?, utm_medium), utm_content = COALESCE(?, utm_content),
        referrer = COALESCE(?, referrer),
        entry_url = COALESCE(?, entry_url),
        is_checking_out = ?, checkout_started_at = ?, has_purchased = ?, purchased_at = COALESCE(?, purchased_at),
        traffic_source_key = COALESCE(?, traffic_source_key),
        ua_device_type = COALESCE(?, ua_device_type),
        ua_platform = COALESCE(?, ua_platform),
        ua_model = COALESCE(?, ua_model),
        bs_source = COALESCE(?, bs_source),
        bs_campaign_id = COALESCE(?, bs_campaign_id),
        bs_adgroup_id = COALESCE(?, bs_adgroup_id),
        bs_ad_id = COALESCE(?, bs_ad_id)
        ${cfSet}
        WHERE session_id = ?
      `, placeholders);
    }
  }

  await maybeMarkAbandoned(payload.session_id);
  return { sessionId: payload.session_id, visitorId: payload.visitor_id };
}

async function maybeMarkAbandoned(sessionId) {
  const db = getDb();
  const session = await db.get('SELECT * FROM sessions WHERE session_id = ?', [sessionId]);
  if (!session || session.has_purchased || session.is_abandoned) return;
  if (session.cart_qty <= 0) return;
  const cutoff = Date.now() - config.abandonedWindowMinutes * 60 * 1000;
  if (session.last_seen < cutoff) {
    if (config.dbUrl) {
      await db.run('UPDATE sessions SET is_abandoned = 1, abandoned_at = ? WHERE session_id = ?', [Date.now(), sessionId]);
    } else {
      await db.run('UPDATE sessions SET is_abandoned = 1, abandoned_at = ? WHERE session_id = ?', [Date.now(), sessionId]);
    }
  }
}

async function insertEvent(sessionId, payload) {
  const db = getDb();
  const ts = payload.ts || Date.now();
  const type = payload.event_type || 'heartbeat';
  if (!ALLOWED_EVENT_TYPES.has(type)) return;

  const checkoutStarted = isCheckoutStartedPayload(payload);
  const checkoutCompleted = isCheckoutCompletedPayload(payload);
  const checkoutState = (payload.checkout_started != null || payload.checkout_completed != null || checkoutStarted || checkoutCompleted)
    ? JSON.stringify({ checkout_started: checkoutStarted, checkout_completed: checkoutCompleted })
    : null;
  const meta = payload.customer_privacy_debug ? JSON.stringify(payload.customer_privacy_debug) : null;

  if (config.dbUrl) {
    const r = await db.run(`
      INSERT INTO events (session_id, ts, type, path, product_handle, qty_delta, cart_qty, checkout_state_json, meta_json)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [sessionId, ts, type, payload.path ?? null, payload.product_handle ?? null, payload.quantity_delta ?? null, payload.cart_qty ?? null, checkoutState, meta]);
  } else {
    await db.run(`
      INSERT INTO events (session_id, ts, type, path, product_handle, qty_delta, cart_qty, checkout_state_json, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [sessionId, ts, type, payload.path ?? null, payload.product_handle ?? null, payload.quantity_delta ?? null, payload.cart_qty ?? null, checkoutState, meta]);
  }
}

function computePurchaseKey(payload, sessionId) {
  function normalizeCheckoutToken(v) {
    // IMPORTANT: do NOT String() non-strings (can become "[object Object]" and collapse dedupe).
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 128 ? s.slice(0, 128) : s;
  }
  function normalizeOrderId(v) {
    // Prefer numeric Shopify order id. Ignore objects (String(obj) => "[object Object]").
    if (v == null) return null;
    const t = typeof v;
    if (t !== 'string' && t !== 'number') return null;
    const extracted = salesTruth.extractNumericId(v);
    const s = extracted != null ? String(extracted).trim() : '';
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 64 ? s.slice(0, 64) : s;
  }

  const orderId = normalizeOrderId(payload.order_id);
  const token = normalizeCheckoutToken(payload.checkout_token);
  // Prefer checkout_token because Shopify can emit checkout_completed once before order_id exists,
  // and again after the order is created. Both events share the same checkout_token.
  if (token) return 'token:' + token;
  if (orderId) return 'order:' + orderId;
  // 15-min bucket so multiple checkout_completed events for same order (e.g. thank-you reload) dedupe
  const tsNum = payload.ts != null ? Number(payload.ts) : NaN;
  const ts = Number.isFinite(tsNum) ? tsNum : Date.now();
  const round15Min = Math.floor(ts / (15 * 60000));
  const cur = typeof payload.order_currency === 'string' ? payload.order_currency.trim() : '';
  const tot = payload.order_total != null ? String(payload.order_total) : '';
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + round15Min + '|' + sessionId).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function insertPurchase(payload, sessionId, countryCode) {
  if (!isCheckoutCompletedPayload(payload)) return;
  const db = getDb();
  const tsNum = payload.ts != null ? Number(payload.ts) : NaN;
  const now = Number.isFinite(tsNum) ? tsNum : Date.now();
  const purchaseKey = computePurchaseKey(payload, sessionId);
  const orderTotal = payload.order_total != null ? (typeof payload.order_total === 'number' ? payload.order_total : parseFloat(payload.order_total)) : null;
  const orderCurrency = typeof payload.order_currency === 'string' && payload.order_currency.trim() ? payload.order_currency.trim() : null;
  // Keep stored fields consistent with computePurchaseKey (avoid "[object Object]" junk).
  const orderId = (function () {
    if (payload.order_id == null) return null;
    const t = typeof payload.order_id;
    if (t !== 'string' && t !== 'number') return null;
    const extracted = salesTruth.extractNumericId(payload.order_id);
    const s = extracted != null ? String(extracted).trim() : '';
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 64 ? s.slice(0, 64) : s;
  })();
  const checkoutToken = (function () {
    if (typeof payload.checkout_token !== 'string') return null;
    const s = payload.checkout_token.trim();
    if (!s) return null;
    const low = s.toLowerCase();
    if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
    return s.length > 128 ? s.slice(0, 128) : s;
  })();
  const country = normalizeCountry(countryCode) || null;

  if (config.dbUrl) {
    await db.run(`
      INSERT INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (purchase_key) DO NOTHING
    `, [purchaseKey, sessionId, payload.visitor_id ?? null, now, Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country]);
  } else {
    await db.run(`
      INSERT OR IGNORE INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [purchaseKey, sessionId, payload.visitor_id ?? null, now, Number.isNaN(orderTotal) ? null : orderTotal, orderCurrency, orderId, checkoutToken, country]);
  }
  // Never delete purchase rows (project rule: no DB deletes without backup). Dedupe is done in stats queries only.
}

/** "Today (24h)" tab: last 24 hours. "All (60 min)" tab: last 60 min. Cleanup uses SESSION_RETENTION_DAYS. */
const TODAY_WINDOW_MINUTES = 24 * 60;
const ALL_SESSIONS_WINDOW_MINUTES = 60;

async function listSessions(filter) {
  const db = getDb();
  const now = Date.now();
  const todayCutoff = now - TODAY_WINDOW_MINUTES * 60 * 1000;
  const activeCutoff = now - config.activeWindowMinutes * 60 * 1000;
  const recentCutoff = now - config.recentWindowMinutes * 60 * 1000;
  const allCutoff = now - ALL_SESSIONS_WINDOW_MINUTES * 60 * 1000;
  const abandonedRetentionMs = config.abandonedRetentionHours * 60 * 60 * 1000;
  const abandonedCutoff = now - abandonedRetentionMs;

  let sql = `
    SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
      COALESCE(s.country_code, v.last_country) AS session_country,
      v.device, v.network_speed
    FROM sessions s
    LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE 1=1
  `;
  const params = [];
  let idx = 0;
  const ph = () => (config.dbUrl ? `$${++idx}` : '?');

  if (filter === 'today') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(todayCutoff);
  } else if (filter === 'converted') {
    sql += ` AND s.has_purchased = 1 AND s.purchased_at >= ${ph()}`;
    params.push(todayCutoff);
  } else if (filter === 'active') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(activeCutoff);
    const arrivedCutoff = now - config.liveArrivedWindowMinutes * 60 * 1000;
    sql += ` AND s.started_at >= ${ph()}`;
    params.push(arrivedCutoff);
  } else if (filter === 'recent') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(recentCutoff);
  } else if (filter === 'abandoned') {
    sql += ` AND s.is_abandoned = 1 AND s.abandoned_at >= ${ph()}`;
    params.push(abandonedCutoff);
  } else if (filter === 'all') {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(allCutoff);
  } else {
    sql += ` AND s.last_seen >= ${ph()}`;
    params.push(now - config.sessionTtlMinutes * 60 * 1000);
  }

  sql += ' ORDER BY s.last_seen DESC';
  const rows = await db.all(sql, params);

  return rows.map(r => {
    const countryCode = (r.session_country || r.country_code || 'XX').toUpperCase().slice(0, 2);
    const out = { ...r, country_code: countryCode };
    delete out.session_country;
    delete out.visitor_is_returning;
    out.is_returning = (r.is_returning != null ? r.is_returning : r.visitor_is_returning) ? 1 : 0;
    out.started_at = r.started_at != null ? Number(r.started_at) : null;
    out.last_seen = r.last_seen != null ? Number(r.last_seen) : null;
    out.purchased_at = r.purchased_at != null ? Number(r.purchased_at) : null;
    out.checkout_started_at = r.checkout_started_at != null ? Number(r.checkout_started_at) : null;
    out.abandoned_at = r.abandoned_at != null ? Number(r.abandoned_at) : null;
    out.recovered_at = r.recovered_at != null ? Number(r.recovered_at) : null;
    return out;
  });
}

/** Count of sessions currently "online" (active window: last_seen and started_at within config windows). Used for Online display regardless of date range. */
async function getActiveSessionCount() {
  const db = getDb();
  const now = Date.now();
  const activeCutoff = now - config.activeWindowMinutes * 60 * 1000;
  const arrivedCutoff = now - config.liveArrivedWindowMinutes * 60 * 1000;
  const row = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= $1 AND started_at >= $2', [activeCutoff, arrivedCutoff])
    : await db.get('SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= ? AND started_at >= ?', [activeCutoff, arrivedCutoff]);
  return row ? Number(row.n) || 0 : 0;
}

/**
 * Time-bucketed active-online series for live chart.
 * Returns bucketed counts using the same active/arrived windows as listSessions('active').
 */
async function getActiveSessionSeries(minutes = 10, stepMinutes = 1) {
  const db = getDb();
  const safeStepMinutes = Math.max(1, Math.min(15, parseInt(String(stepMinutes || 1), 10) || 1));
  const safeMinutes = Math.max(safeStepMinutes * 2, Math.min(60, parseInt(String(minutes || 10), 10) || 10));
  const stepMs = safeStepMinutes * 60 * 1000;
  const bucketCount = Math.max(2, Math.floor(safeMinutes / safeStepMinutes));
  const end = Math.floor(Date.now() / stepMs) * stepMs;
  const start = end - (bucketCount - 1) * stepMs;
  const activeWindowMs = config.activeWindowMinutes * 60 * 1000;
  const arrivedWindowMs = config.liveArrivedWindowMinutes * 60 * 1000;

  let rows = [];
  if (config.dbUrl) {
    rows = await db.all(
      `WITH buckets AS (
         SELECT generate_series($1::bigint, $2::bigint, $3::bigint) AS ts
       )
       SELECT b.ts::bigint AS ts,
              COUNT(s.session_id)::bigint AS online
       FROM buckets b
       LEFT JOIN sessions s
         ON COALESCE(s.started_at, 0) <= b.ts
        AND COALESCE(s.last_seen, s.started_at, 0) >= (b.ts - $4::bigint)
        AND COALESCE(s.started_at, 0) >= (b.ts - $5::bigint)
       GROUP BY b.ts
       ORDER BY b.ts ASC`,
      [start, end, stepMs, activeWindowMs, arrivedWindowMs]
    );
  } else {
    rows = await db.all(
      `WITH RECURSIVE buckets(ts, n) AS (
         SELECT ? AS ts, 0
         UNION ALL
         SELECT ts + ?, n + 1
         FROM buckets
         WHERE n + 1 < ?
       )
       SELECT b.ts AS ts,
              COUNT(s.session_id) AS online
       FROM buckets b
       LEFT JOIN sessions s
         ON COALESCE(s.started_at, 0) <= b.ts
        AND COALESCE(s.last_seen, s.started_at, 0) >= (b.ts - ?)
        AND COALESCE(s.started_at, 0) >= (b.ts - ?)
       GROUP BY b.ts
       ORDER BY b.ts ASC`,
      [start, stepMs, bucketCount, activeWindowMs, arrivedWindowMs]
    );
  }

  return (rows || []).map((r) => {
    const ts = r && r.ts != null ? Number(r.ts) : null;
    const online = r && r.online != null ? Number(r.online) : 0;
    return {
      ts: Number.isFinite(ts) ? ts : null,
      online: Number.isFinite(online) ? Math.max(0, Math.trunc(online)) : 0,
    };
  }).filter((p) => Number.isFinite(p.ts));
}

async function getSessionEvents(sessionId, limit = 20) {
  const db = getDb();
  const rows = await db.all(
    'SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?',
    [sessionId, limit]
  );
  return rows.reverse().map(r => ({
    ...r,
    ts: r.ts != null ? Number(r.ts) : null,
  }));
}

/** When trafficMode is human_only, exclude sessions with cf_known_bot = 1. No bot score used. */
function sessionFilterForTraffic(trafficMode) {
  if (trafficMode === 'human_only') {
    return config.dbUrl
      ? { sql: ' AND (sessions.cf_known_bot IS NULL OR sessions.cf_known_bot = 0)', params: [] }
      : { sql: ' AND (sessions.cf_known_bot IS NULL OR sessions.cf_known_bot = 0)', params: [] };
  }
  return { sql: '', params: [] };
}

const DEFAULT_RANGE_KEYS = ['today', 'yesterday'];
const SALES_ROLLING_WINDOWS = [
  { key: '3h', ms: 3 * 60 * 60 * 1000 },
  { key: '6h', ms: 6 * 60 * 60 * 1000 },
  { key: '12h', ms: 12 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
];
const CONVERSION_ROLLING_WINDOWS = [
  { key: '3h', ms: 3 * 60 * 60 * 1000 },
  { key: '6h', ms: 6 * 60 * 60 * 1000 },
  { key: '12h', ms: 12 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
];

function resolveAdminTimeZone() {
  const tz = config.adminTimezone || 'Europe/London';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz }).format(new Date());
    return tz;
  } catch (_) {
    return 'Europe/London';
  }
}

function getTimeZoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getTimeZoneOffsetMs(timeZone, date) {
  const parts = getTimeZoneParts(date, timeZone);
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utc - date.getTime();
}

function zonedTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  return utcGuess.getTime() - offset;
}

function addDaysToParts(parts, deltaDays) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function startOfDayUtcMs(parts, timeZone) {
  return zonedTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
}

function getRangeBounds(rangeKey, nowMs, timeZone) {
  const todayParts = getTimeZoneParts(new Date(nowMs), timeZone);
  const startToday = startOfDayUtcMs(todayParts, timeZone);
  // Custom day: d:YYYY-MM-DD (in admin timezone)
  if (typeof rangeKey === 'string' && rangeKey.startsWith('d:')) {
    const m = rangeKey.match(/^d:(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10);
      const day = parseInt(m[3], 10);
      if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const start = zonedTimeToUtcMs(year, month, day, 0, 0, 0, timeZone);
        const nextParts = addDaysToParts({ year, month, day }, 1);
        const endFull = zonedTimeToUtcMs(nextParts.year, nextParts.month, nextParts.day, 0, 0, 0, timeZone);
        const isToday = year === todayParts.year && month === todayParts.month && day === todayParts.day;
        const end = isToday ? nowMs : endFull;
        // Clamp future dates.
        if (start >= nowMs) return { start: nowMs, end: nowMs };
        return { start, end: Math.max(start, end) };
      }
    }
  }
  // Custom range: r:YYYY-MM-DD:YYYY-MM-DD (inclusive, admin timezone)
  if (typeof rangeKey === 'string' && rangeKey.startsWith('r:')) {
    const m = rangeKey.match(/^r:(\d{4})-(\d{2})-(\d{2}):(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const sy = parseInt(m[1], 10);
      const sm = parseInt(m[2], 10);
      const sd = parseInt(m[3], 10);
      const ey = parseInt(m[4], 10);
      const em = parseInt(m[5], 10);
      const ed = parseInt(m[6], 10);
      if (
        Number.isFinite(sy) && Number.isFinite(sm) && Number.isFinite(sd) && sm >= 1 && sm <= 12 && sd >= 1 && sd <= 31 &&
        Number.isFinite(ey) && Number.isFinite(em) && Number.isFinite(ed) && em >= 1 && em <= 12 && ed >= 1 && ed <= 31
      ) {
        const aYmd = `${m[1]}-${m[2]}-${m[3]}`;
        const bYmd = `${m[4]}-${m[5]}-${m[6]}`;
        const useAForStart = aYmd <= bYmd;
        const startY = useAForStart ? sy : ey;
        const startM = useAForStart ? sm : em;
        const startD = useAForStart ? sd : ed;
        const endY = useAForStart ? ey : sy;
        const endM = useAForStart ? em : sm;
        const endD = useAForStart ? ed : sd;

        const start = zonedTimeToUtcMs(startY, startM, startD, 0, 0, 0, timeZone);
        const endNextParts = addDaysToParts({ year: endY, month: endM, day: endD }, 1);
        const endFull = zonedTimeToUtcMs(endNextParts.year, endNextParts.month, endNextParts.day, 0, 0, 0, timeZone);
        const endIsToday = endY === todayParts.year && endM === todayParts.month && endD === todayParts.day;
        let end = endIsToday ? nowMs : endFull;

        // Clamp future end.
        if (end > nowMs) end = nowMs;

        // Clamp future start.
        if (start >= nowMs) return { start: nowMs, end: nowMs };
        return { start, end: Math.max(start, end) };
      }
    }
  }
  if (rangeKey === '1h') {
    return { start: nowMs - 60 * 60 * 1000, end: nowMs };
  }
  if (rangeKey === 'today') {
    const start = startToday >= nowMs ? nowMs - 24 * 60 * 60 * 1000 : startToday;
    return { start, end: nowMs };
  }
  if (rangeKey === 'yesterday') {
    const yParts = addDaysToParts(todayParts, -1);
    return { start: startOfDayUtcMs(yParts, timeZone), end: startToday };
  }
  if (rangeKey === '3d') {
    const startParts = addDaysToParts(todayParts, -2);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === '7d') {
    const startParts = addDaysToParts(todayParts, -6);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === '14d') {
    const startParts = addDaysToParts(todayParts, -13);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === '30d') {
    const startParts = addDaysToParts(todayParts, -29);
    return { start: startOfDayUtcMs(startParts, timeZone), end: nowMs };
  }
  if (rangeKey === 'month') {
    const startOfMonth = zonedTimeToUtcMs(todayParts.year, todayParts.month, 1, 0, 0, 0, timeZone);
    return { start: startOfMonth, end: nowMs };
  }
  return { start: nowMs, end: nowMs };
}

// Platform start date: never return data before Feb 1 2025
const PLATFORM_START_MS = zonedTimeToUtcMs(2025, 2, 1, 0, 0, 0, 'Europe/London');
const _origGetRangeBounds = getRangeBounds;
getRangeBounds = function(rangeKey, nowMs, timeZone) {
  const bounds = _origGetRangeBounds(rangeKey, nowMs, timeZone);
  if (bounds.start < PLATFORM_START_MS) bounds.start = PLATFORM_START_MS;
  if (bounds.end < PLATFORM_START_MS) bounds.end = PLATFORM_START_MS;
  return bounds;
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymdFromParts(parts) {
  if (!parts) return '';
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return String(y).padStart(4, '0') + '-' + pad2(m) + '-' + pad2(d);
}

function ymdFromMs(ms, timeZone) {
  const parts = getTimeZoneParts(new Date(ms), timeZone);
  return ymdFromParts(parts);
}

function listYmdsInBounds(startMs, endMs, timeZone) {
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const startParts = getTimeZoneParts(new Date(start), timeZone);
  const endParts = getTimeZoneParts(new Date(Math.max(start, end - 1)), timeZone);
  let cur = { year: startParts.year, month: startParts.month, day: startParts.day };
  const last = { year: endParts.year, month: endParts.month, day: endParts.day };
  const out = [];
  for (let guard = 0; guard < 400; guard++) {
    const ymd = ymdFromParts(cur);
    if (ymd) out.push(ymd);
    if (cur.year === last.year && cur.month === last.month && cur.day === last.day) break;
    cur = addDaysToParts(cur, 1);
  }
  return out;
}

async function saveShopifySessionsSnapshot({ shop, snapshotKey, dayYmd, sessionsCount, fetchedAt } = {}) {
  const db = getDb();
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const ymd = typeof dayYmd === 'string' ? dayYmd.trim() : '';
  const snapKey = snapshotKey != null ? String(snapshotKey).trim().slice(0, 64) : null;
  const count = sessionsCount != null ? parseInt(String(sessionsCount), 10) : NaN;
  const at = fetchedAt != null ? Number(fetchedAt) : Date.now();
  if (!safeShop) return { ok: false, error: 'missing_shop' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return { ok: false, error: 'invalid_day' };
  if (!Number.isFinite(count) || count < 0) return { ok: false, error: 'invalid_count' };
  if (!Number.isFinite(at) || at <= 0) return { ok: false, error: 'invalid_fetched_at' };
  try {
    await db.run(
      `INSERT INTO shopify_sessions_snapshots (snapshot_key, shop, day_ymd, sessions_count, fetched_at)
       VALUES (?, ?, ?, ?, ?)`,
      [snapKey, safeShop, ymd, count, at]
    );
  } catch (_) {
    // Fail-open if table doesn't exist yet.
  }
  return { ok: true };
}

async function getLatestShopifySessionsSnapshot(shop, dayYmd) {
  const db = getDb();
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const ymd = typeof dayYmd === 'string' ? dayYmd.trim() : '';
  if (!safeShop || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  try {
    const row = await db.get(
      `SELECT sessions_count, fetched_at
       FROM shopify_sessions_snapshots
       WHERE shop = ? AND day_ymd = ?
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [safeShop, ymd]
    );
    if (!row) return null;
    const count = row.sessions_count != null ? Number(row.sessions_count) : null;
    const fetchedAt = row.fetched_at != null ? Number(row.fetched_at) : null;
    return { sessionsCount: Number.isFinite(count) ? count : null, fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : null };
  } catch (_) {
    return null;
  }
}

const SHOPIFY_SESSIONS_TODAY_REFRESH_MS = 5 * 60 * 1000;
const shopifySessionsFetchInflight = new Map(); // shop|ymd -> Promise<number|null>

async function fetchShopifySessionsCountForDay(shop, dayYmd, timeZone, { snapshotKey } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayYmd || ''))) return null;
  const token = await salesTruth.getAccessToken(safeShop);
  if (!token) return null;
  const tz = timeZone || resolveAdminTimeZone();
  const todayYmd = ymdFromMs(Date.now(), tz);
  const during = String(dayYmd) === todayYmd ? 'today' : String(dayYmd);
  const result = await shopifyQl.fetchShopifySessionsCount(safeShop, token, { during });
  if (typeof result.count !== 'number') return null;
  const fetchedAt = Date.now();
  await saveShopifySessionsSnapshot({
    shop: safeShop,
    snapshotKey: snapshotKey != null ? snapshotKey : ('d:' + String(dayYmd)),
    dayYmd: String(dayYmd),
    sessionsCount: result.count,
    fetchedAt,
  });
  return result.count;
}

async function getShopifySessionsCountForBounds(shop, startMs, endMs, timeZone, { fetchIfMissing = false } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return null;
  const tz = timeZone || resolveAdminTimeZone();
  const ymds = listYmdsInBounds(startMs, endMs, tz);
  if (!ymds.length) return 0;

  const todayYmd = ymdFromMs(Date.now(), tz);
  const latestByYmd = await Promise.all(
    ymds.map(async (ymd) => ({ ymd, latest: await getLatestShopifySessionsSnapshot(safeShop, ymd) }))
  );
  let total = 0;
  const missingYmds = [];

  for (const { ymd, latest } of latestByYmd) {
    const isToday = ymd === todayYmd;
    const freshEnough = latest && typeof latest.sessionsCount === 'number' && (!isToday || (latest.fetchedAt && (Date.now() - latest.fetchedAt) < SHOPIFY_SESSIONS_TODAY_REFRESH_MS));
    if (freshEnough) {
      total += Number(latest.sessionsCount) || 0;
    } else {
      if (!fetchIfMissing) return null;
      missingYmds.push(ymd);
    }
  }

  if (!missingYmds.length) return total;

  const fetchedCounts = await Promise.all(
    missingYmds.map(async (ymd) => {
      const inflightKey = safeShop + '|' + ymd;
      let p = shopifySessionsFetchInflight.get(inflightKey);
      if (!p) {
        p = fetchShopifySessionsCountForDay(safeShop, ymd, tz).catch(() => null).finally(() => {
          if (shopifySessionsFetchInflight.get(inflightKey) === p) shopifySessionsFetchInflight.delete(inflightKey);
        });
        shopifySessionsFetchInflight.set(inflightKey, p);
      }
      return p;
    })
  );

  for (const fetched of fetchedCounts) {
    if (typeof fetched === 'number') total += fetched;
    else return null;
  }
  return total;
}

/** List sessions in a date range with pagination. Used by Live tab when Today/Yesterday/3d/7d/1h/Sales is selected. */
async function listSessionsByRange(rangeKey, timeZone, limit, offset) {
  const db = getDb();
  const now = Date.now();
  const tz = timeZone || resolveAdminTimeZone();
  const isSales = rangeKey === 'sales';
  // Sales is a "Today" sub-view: show only converted sessions in today's date bounds (admin TZ).
  const boundsKey = isSales ? 'today' : rangeKey;
  const bounds = getRangeBounds(boundsKey, now, tz);
  const { start, end } = bounds;
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
  const offsetNum = Math.max(parseInt(offset, 10) || 0, 0);

  // Last Hour: filter by activity (last_seen) so we show sessions active in the last hour, not only sessions that started in the last hour
  const useLastSeen = rangeKey === '1h';
  const timeCol = isSales ? 's.purchased_at' : (useLastSeen ? 's.last_seen' : 's.started_at');
  const purchasedFilterSql = isSales ? ' AND s.has_purchased = 1' : '';

  const baseSql = `
    SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
      COALESCE(s.country_code, v.last_country) AS session_country,
      v.device, v.network_speed
    FROM sessions s
    LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
    WHERE ${timeCol} >= ${config.dbUrl ? '$1' : '?'} AND ${timeCol} < ${config.dbUrl ? '$2' : '?'}${purchasedFilterSql}
  `;
  const baseParams = [start, end];

  const countSql = config.dbUrl
    ? 'SELECT COUNT(*) AS n FROM sessions s WHERE ' + timeCol + ' >= $1 AND ' + timeCol + ' < $2' + purchasedFilterSql
    : 'SELECT COUNT(*) AS n FROM sessions s WHERE ' + timeCol + ' >= ? AND ' + timeCol + ' < ?' + purchasedFilterSql;
  const countRow = await db.get(countSql, [start, end]);
  const total = (countRow && countRow.n != null) ? Number(countRow.n) : 0;

  const orderBy = isSales ? ' ORDER BY s.purchased_at DESC, s.last_seen DESC' : ' ORDER BY s.last_seen DESC';
  const orderLimitOffset = orderBy + ' LIMIT ' + (config.dbUrl ? '$3' : '?') + ' OFFSET ' + (config.dbUrl ? '$4' : '?');
  const rows = config.dbUrl
    ? await db.all(baseSql + orderLimitOffset, [...baseParams, limitNum, offsetNum])
    : await db.all(baseSql + orderLimitOffset, [...baseParams, limitNum, offsetNum]);

  const sessions = rows.map(r => {
    const countryCode = (r.session_country || r.country_code || 'XX').toUpperCase().slice(0, 2);
    const out = { ...r, country_code: countryCode };
    delete out.session_country;
    delete out.visitor_is_returning;
    out.is_returning = (r.is_returning != null ? r.is_returning : r.visitor_is_returning) ? 1 : 0;
    out.started_at = r.started_at != null ? Number(r.started_at) : null;
    out.last_seen = r.last_seen != null ? Number(r.last_seen) : null;
    out.purchased_at = r.purchased_at != null ? Number(r.purchased_at) : null;
    out.checkout_started_at = r.checkout_started_at != null ? Number(r.checkout_started_at) : null;
    out.abandoned_at = r.abandoned_at != null ? Number(r.abandoned_at) : null;
    out.recovered_at = r.recovered_at != null ? Number(r.recovered_at) : null;
    return out;
  });

  return { sessions, total };
}

/** Latest converted sessions by purchased_at desc. Used for /dashboard/live "Latest sales" widget. */
async function listLatestSales(limit = 5) {
  const db = getDb();
  const lim = Math.max(1, Math.min(50, parseInt(String(limit), 10) || 5));
  const rows = await db.all(
    config.dbUrl
      ? `
        SELECT
          s.session_id,
          s.purchased_at,
          s.order_total,
          s.order_currency,
          s.last_product_handle,
          s.first_product_handle,
          COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(v.last_country), ''), NULLIF(TRIM(s.cf_country), '')) AS session_country
        FROM sessions s
        LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
        WHERE s.has_purchased = 1 AND s.purchased_at IS NOT NULL
        ORDER BY s.purchased_at DESC
        LIMIT $1
      `
      : `
        SELECT
          s.session_id,
          s.purchased_at,
          s.order_total,
          s.order_currency,
          s.last_product_handle,
          s.first_product_handle,
          COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(v.last_country), ''), NULLIF(TRIM(s.cf_country), '')) AS session_country
        FROM sessions s
        LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
        WHERE s.has_purchased = 1 AND s.purchased_at IS NOT NULL
        ORDER BY s.purchased_at DESC
        LIMIT ?
      `,
    [lim]
  );
  const shop = salesTruth.resolveShopForSales('');
  let ratesToGbp = null;
  try { ratesToGbp = await fx.getRatesToGbp(); } catch (_) { ratesToGbp = null; }

  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }

  function safeStr(v, maxLen = 256) {
    if (v == null) return '';
    const s = String(v).trim();
    if (!s) return '';
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  function numOrNull(v) {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function round2(n) {
    const v = typeof n === 'number' ? n : Number(n);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 100) / 100;
  }

  function parseTopProductTitleFromOrderRawJson(rawJson) {
    const order = safeJsonParse(rawJson);
    const items = order && Array.isArray(order.line_items) ? order.line_items : [];
    let best = null;
    for (const li of items) {
      const title = safeStr(li && li.title, 256);
      if (!title) continue;
      const qtyRaw = li && li.quantity != null ? li.quantity : 1;
      const qty = (() => {
        const n = typeof qtyRaw === 'number' ? qtyRaw : parseInt(String(qtyRaw), 10);
        return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
      })();
      const priceRaw =
        (li && li.price != null ? li.price : null) ??
        li?.price_set?.shop_money?.amount ??
        li?.priceSet?.shopMoney?.amount ??
        null;
      const unit = numOrNull(priceRaw) ?? 0;
      const lineTotal = unit * qty;
      if (!Number.isFinite(lineTotal)) continue;
      if (!best || lineTotal > best.lineTotal || (lineTotal === best.lineTotal && unit > best.unit)) {
        best = { title, unit, qty, lineTotal };
      }
    }
    return best && best.title ? best.title : '';
  }

  const purchaseLinkCache = new Map(); // session_id -> { order_id, checkout_token, order_total, order_currency } | null
  const truthOrderCache = new Map(); // key -> order row | null

  async function getLatestPurchaseLink(sessionId) {
    const sid = String(sessionId || '').trim();
    if (!sid) return null;
    if (purchaseLinkCache.has(sid)) return purchaseLinkCache.get(sid);
    let row = null;
    try {
      row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, checkout_token, order_total, order_currency
            FROM purchases
            WHERE session_id = $1
            ORDER BY purchased_at DESC
            LIMIT 1
          `
          : `
            SELECT order_id, checkout_token, order_total, order_currency
            FROM purchases
            WHERE session_id = ?
            ORDER BY purchased_at DESC
            LIMIT 1
          `,
        [sid]
      );
    } catch (_) {
      row = null;
    }
    purchaseLinkCache.set(sid, row || null);
    return row || null;
  }

  async function getTruthOrderByOrderId(orderId) {
    const oid = safeStr(orderId, 64);
    if (!shop || !oid) return null;
    const key = 'order:' + oid;
    if (truthOrderCache.has(key)) return truthOrderCache.get(key);
    let row = null;
    try {
      row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = $1 AND order_id = $2
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            LIMIT 1
          `
          : `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = ? AND order_id = ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            LIMIT 1
          `,
        [shop, oid]
      );
    } catch (_) {
      row = null;
    }
    truthOrderCache.set(key, row || null);
    return row || null;
  }

  async function getTruthOrderByCheckoutToken(checkoutToken) {
    const token = safeStr(checkoutToken, 128);
    if (!shop || !token) return null;
    const key = 'token:' + token;
    if (truthOrderCache.has(key)) return truthOrderCache.get(key);
    let row = null;
    try {
      row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = $1 AND checkout_token = $2
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            ORDER BY created_at DESC
            LIMIT 1
          `
          : `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = ? AND checkout_token = ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
            ORDER BY created_at DESC
            LIMIT 1
          `,
        [shop, token]
      );
    } catch (_) {
      row = null;
    }
    truthOrderCache.set(key, row || null);
    return row || null;
  }

  async function findTruthOrderForSession(sessionId, purchasedAtMs, orderTotal, orderCurrency) {
    if (!shop) return null;
    const purchase = await getLatestPurchaseLink(sessionId);
    const directOrderId = safeStr(purchase && purchase.order_id, 64);
    const directToken = safeStr(purchase && purchase.checkout_token, 128);
    if (directOrderId) {
      const byId = await getTruthOrderByOrderId(directOrderId);
      if (byId) return byId;
    }
    if (directToken) {
      const byToken = await getTruthOrderByCheckoutToken(directToken);
      if (byToken) return byToken;
    }

    // Heuristic match: nearest paid truth order around purchased_at with matching currency + total.
    const ts = numOrNull(purchasedAtMs);
    const total = numOrNull(orderTotal);
    const cur = fx.normalizeCurrency(orderCurrency) || 'GBP';
    if (ts == null || total == null) return null;
    const WINDOW_MS = 2 * 60 * 60 * 1000;
    const start = Math.max(0, Math.trunc(ts - WINDOW_MS));
    const end = Math.trunc(ts + WINDOW_MS);
    const tol = 0.05;
    try {
      const row = await db.get(
        config.dbUrl
          ? `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = $1
              AND created_at >= $2 AND created_at <= $3
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
              AND total_price IS NOT NULL
              AND ABS(total_price - $4) <= $5
              AND COALESCE(NULLIF(TRIM(currency), ''), 'GBP') = $6
            ORDER BY ABS(created_at - $7) ASC
            LIMIT 1
          `
          : `
            SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price, raw_json, created_at
            FROM orders_shopify
            WHERE shop = ?
              AND created_at >= ? AND created_at <= ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
              AND total_price IS NOT NULL
              AND ABS(total_price - ?) <= ?
              AND COALESCE(NULLIF(TRIM(currency), ''), 'GBP') = ?
            ORDER BY ABS(created_at - ?) ASC
            LIMIT 1
          `,
        config.dbUrl
          ? [shop, start, end, total, tol, cur, ts]
          : [shop, start, end, total, tol, cur, ts]
      );
      return row || null;
    } catch (_) {
      return null;
    }
  }

  const out = [];
  for (const r of rows || []) {
    const sessionId = r && r.session_id != null ? String(r.session_id) : null;
    if (!sessionId) continue;
    const rawCountry = (r && r.session_country != null) ? String(r.session_country) : '';
    const cc = (rawCountry || 'XX').toUpperCase().slice(0, 2) || 'XX';
    const cur = (r && r.order_currency != null) ? String(r.order_currency).trim().toUpperCase() : '';
    const totalRaw = (r && r.order_total != null) ? (typeof r.order_total === 'number' ? r.order_total : parseFloat(String(r.order_total))) : null;
    const total = (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) ? totalRaw : null;
    const purchasedAtRaw = (r && r.purchased_at != null) ? (typeof r.purchased_at === 'number' ? r.purchased_at : Number(r.purchased_at)) : null;
    const purchasedAt = (typeof purchasedAtRaw === 'number' && Number.isFinite(purchasedAtRaw)) ? purchasedAtRaw : null;
    const lastHandle = (r && r.last_product_handle != null) ? String(r.last_product_handle).trim() : '';
    const firstHandle = (r && r.first_product_handle != null) ? String(r.first_product_handle).trim() : '';

    const purchaseLink = await getLatestPurchaseLink(sessionId);
    const purchaseTotal = numOrNull(purchaseLink && purchaseLink.order_total);
    const baseTotal = total != null ? total : purchaseTotal;
    const baseCur = fx.normalizeCurrency(cur) || fx.normalizeCurrency(purchaseLink && purchaseLink.order_currency) || null;

    // Prefer truth order enrichment when available.
    let productTitle = null;
    let orderTotalGbp = null;
    const truth = await findTruthOrderForSession(sessionId, purchasedAt, baseTotal, baseCur);
    if (truth) {
      try {
        const title = parseTopProductTitleFromOrderRawJson(truth && truth.raw_json != null ? String(truth.raw_json) : '');
        productTitle = title ? title : null;
      } catch (_) {
        productTitle = null;
      }
      const truthTotal = numOrNull(truth && truth.total_price);
      const truthCur = fx.normalizeCurrency(truth && truth.currency) || 'GBP';
      const gbp = (truthTotal != null) ? fx.convertToGbp(truthTotal, truthCur, ratesToGbp) : null;
      orderTotalGbp = round2(gbp);
    } else if (baseTotal != null) {
      const gbp = fx.convertToGbp(baseTotal, baseCur || 'GBP', ratesToGbp);
      orderTotalGbp = round2(gbp);
    }

    out.push({
      session_id: sessionId,
      country_code: cc,
      purchased_at: purchasedAt,
      order_total: baseTotal,
      order_currency: baseCur || null,
      order_total_gbp: orderTotalGbp,
      product_title: productTitle,
      last_product_handle: lastHandle || null,
      first_product_handle: firstHandle || null,
    });
  }
  return out;
}

function purchaseDedupeKeySql(alias = '') {
  // Prefer checkout_token, then order_id. For rows without either (h: hash), dedupe by session+total+currency+15min.
  const p = alias ? alias + '.' : '';
  const bucket = config.dbUrl
    ? `FLOOR(${p}purchased_at/900000.0)::bigint`
    : `CAST(${p}purchased_at/900000 AS INTEGER)`;
  return `CASE WHEN NULLIF(TRIM(${p}checkout_token), '') IS NOT NULL THEN TRIM(${p}checkout_token) WHEN NULLIF(TRIM(${p}order_id), '') IS NOT NULL THEN TRIM(${p}order_id) ELSE ${p}session_id || '_' || COALESCE(CAST(${p}order_total AS TEXT), '0') || '_' || COALESCE(NULLIF(TRIM(${p}order_currency), ''), 'GBP') || '_' || ${bucket} END`;
}

/** SQL AND clause: exclude h: rows when a token/order row exists for same (session, total, currency, 15min bucket). Prevents double-counting without deleting data. */
function purchaseFilterExcludeDuplicateH(alias) {
  const p = alias || 'p';
  const bucketCmp = config.dbUrl
    ? `FLOOR(p2.purchased_at/900000.0) = FLOOR(${p}.purchased_at/900000.0)`
    : `CAST(p2.purchased_at/900000 AS INTEGER) = CAST(${p}.purchased_at/900000 AS INTEGER)`;
  const sameRow = config.dbUrl
    ? `(p2.order_total IS NOT DISTINCT FROM ${p}.order_total) AND (p2.order_currency IS NOT DISTINCT FROM ${p}.order_currency)`
    : `(p2.order_total IS ${p}.order_total OR (p2.order_total IS NULL AND ${p}.order_total IS NULL)) AND (p2.order_currency IS ${p}.order_currency OR (p2.order_currency IS NULL AND ${p}.order_currency IS NULL))`;
  return ` AND (
    (NULLIF(TRIM(${p}.checkout_token), '') IS NOT NULL OR NULLIF(TRIM(${p}.order_id), '') IS NOT NULL)
    OR (${p}.purchase_key LIKE 'h:%' AND NOT EXISTS (
      SELECT 1 FROM purchases p2
      WHERE (NULLIF(TRIM(p2.checkout_token), '') IS NOT NULL OR NULLIF(TRIM(p2.order_id), '') IS NOT NULL)
        AND p2.session_id = ${p}.session_id AND ${sameRow} AND ${bucketCmp}
    ))
  )`;
}

async function getPixelSalesSummary(start, end) {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT
        COALESCE(NULLIF(TRIM(order_currency), ''), 'GBP') AS currency,
        COUNT(*) AS orders,
        COALESCE(SUM(order_total), 0) AS revenue
      FROM purchases p
      WHERE purchased_at >= ? AND purchased_at < ?
        ${purchaseFilterExcludeDuplicateH('p')}
      GROUP BY currency
    `,
    [start, end]
  );
  const ratesToGbp = await fx.getRatesToGbp();
  let orderCount = 0;
  let revenueGbp = 0;
  const revenueByCurrency = {};
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
    const rev = r && r.revenue != null ? Number(r.revenue) : 0;
    const revNum = Number.isFinite(rev) ? rev : 0;
    orderCount += orders;
    revenueByCurrency[cur] = Math.round(revNum * 100) / 100;
    const gbp = fx.convertToGbp(revNum, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) revenueGbp += gbp;
  }
  revenueGbp = Math.round(revenueGbp * 100) / 100;
  return { orderCount, revenueGbp, revenueByCurrency };
}

async function getPixelSalesTotalGbp(start, end) {
  const s = await getPixelSalesSummary(start, end);
  return s && typeof s.revenueGbp === 'number' ? s.revenueGbp : 0;
}

async function getPixelOrderCount(start, end) {
  const s = await getPixelSalesSummary(start, end);
  return s && typeof s.orderCount === 'number' ? s.orderCount : 0;
}

async function getPixelReturningRevenueGbp(start, end) {
  const db = getDb();
  const rows = await db.all(
    `
      SELECT
        COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS currency,
        COALESCE(SUM(p.order_total), 0) AS revenue
      FROM purchases p
      INNER JOIN sessions s ON s.session_id = p.session_id
      WHERE p.purchased_at >= ? AND p.purchased_at < ?
        AND s.is_returning = 1
        ${purchaseFilterExcludeDuplicateH('p')}
      GROUP BY currency
    `,
    [start, end]
  );
  const ratesToGbp = await fx.getRatesToGbp();
  let revenueGbp = 0;
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const rev = r && r.revenue != null ? Number(r.revenue) : 0;
    const revNum = Number.isFinite(rev) ? rev : 0;
    const gbp = fx.convertToGbp(revNum, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) revenueGbp += gbp;
  }
  return Math.round(revenueGbp * 100) / 100;
}

function isDayLikeRangeKey(key) {
  if (!key || typeof key !== 'string') return false;
  const k = key.trim().toLowerCase();
  if (k === 'today' || k === 'yesterday' || k === '3d' || k === '7d' || k === '14d' || k === '30d' || k === 'month') return true;
  if (/^d:\d{4}-\d{2}-\d{2}$/.test(k)) return true;
  const m = k.match(/^r:(\d{4})-(\d{2})-(\d{2}):(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  // Shopify sessions snapshots are day-based; cap to avoid huge on-demand backfills.
  const a = Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 12, 0, 0);
  const b = Date.UTC(parseInt(m[4], 10), parseInt(m[5], 10) - 1, parseInt(m[6], 10), 12, 0, 0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const days = Math.floor(Math.abs(b - a) / 86400000) + 1;
  return days > 0 && days <= 90;
}

/** Total sales in range. Dedupe in query only; never delete rows. */
async function getSalesTotal(start, end, options = {}) {
  // Guardrail: report sales from Shopify truth only (never exceed Shopify).
  // Truth: Shopify Orders API cached in orders_shopify.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthSalesTotalGbp(shop, start, end);
}

/** Revenue from returning-customer sessions only (sessions.is_returning = 1). Same dedupe and GBP conversion as getSalesTotal. */
async function getReturningRevenue(start, end, options = {}) {
  // Guardrail: report sales from Shopify truth only (never exceed Shopify).
  // Truth-based returning revenue: customers with a prior paid order before start.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningRevenueGbp(shop, start, end);
}

/** Count of truth orders from returning customers in range. */
async function getReturningOrderCount(start, end, options = {}) {
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningOrderCount(shop, start, end);
}

/** Count of unique truth customers who are returning in range. */
async function getReturningCustomerCount(start, end, options = {}) {
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthReturningCustomerCount(shop, start, end);
}

async function getConversionRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const sessionsSource = options?.reporting?.sessionsSource || 'sessions';
  const rangeKey = typeof options.rangeKey === 'string' ? options.rangeKey : '';
  const timeZone = options.timeZone || resolveAdminTimeZone();

  let t = null;
  if (sessionsSource === 'shopify_sessions' && isDayLikeRangeKey(rangeKey)) {
    const shop = salesTruth.resolveShopForSales('');
    if (shop) {
      t = await getShopifySessionsCountForBounds(shop, start, end, timeZone, { fetchIfMissing: true });
    }
  }
  if (t == null) {
    const total = config.dbUrl
      ? await db.get(
        'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql,
        [start, end, ...filter.params]
      )
      : await db.get(
        'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql,
        [start, end, ...filter.params]
      );
    t = total?.n ?? 0;
  }
  // Guardrail: conversion must be based on Shopify truth orders (never exceed Shopify).
  // Definition used across Breakdown/Traffic/Product tables: Orders / Sessions × 100.
  const convertedOrders = await getConvertedCount(start, end, options);
  return t > 0 ? Math.round((convertedOrders / t) * 1000) / 10 : null;
}

/** Product-only sessions: landed on a product page (not homepage, collection, etc). */
const PRODUCT_LANDING_SQL = " AND (first_path LIKE '/products/%' OR (first_product_handle IS NOT NULL AND TRIM(COALESCE(first_product_handle, '')) != ''))";

async function getProductConversionRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  // Keep sessions. prefixes so we can safely re-alias (s.) in joined queries.
  const productFilter = filter.sql + PRODUCT_LANDING_SQL;
  const total = config.dbUrl
    ? await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + productFilter,
      [start, end, ...filter.params]
    )
    : await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + productFilter,
      [start, end, ...filter.params]
    );
  const t = total?.n ?? 0;
  if (t <= 0) return null;

  // Guardrail: conversions must be Shopify truth (never exceed Shopify).
  // Approximation: count truth orders whose first landing page was a product page (landing_site contains "/products/").
  // This avoids relying on pixel evidence linkage which can be incomplete under blockers.
  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return null;
  const orderRows = config.dbUrl
    ? await db.all(
      `
        SELECT raw_json
        FROM orders_shopify
        WHERE shop = $1
          AND created_at >= $2 AND created_at < $3
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    )
    : await db.all(
      `
        SELECT raw_json
        FROM orders_shopify
        WHERE shop = ?
          AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    );
  let c = 0;
  for (const r of orderRows || []) {
    const raw = safeJsonParse(r && r.raw_json != null ? String(r.raw_json) : '');
    if (!raw || typeof raw !== 'object') continue;
    const landing = raw?.landing_site ?? raw?.landingSite ?? raw?.landing_site_ref ?? raw?.landingSiteRef ?? null;
    const s = landing != null ? String(landing) : '';
    if (s && s.toLowerCase().includes('/products/')) c++;
  }
  return t > 0 ? Math.round((c / t) * 1000) / 10 : null;
}

/** Sessions and revenue by country (truth). Includes 'XX' for unknown order/session country. */
async function getCountryStats(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  function normalizeCountryOrXX(value) {
    const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (!s) return 'XX';
    const code = s.slice(0, 2);
    if (!/^[A-Z]{2}$/.test(code)) return 'XX';
    return code;
  }
  const conversionRows = config.dbUrl
    ? await db.all(`
      SELECT COALESCE(NULLIF(TRIM(country_code), ''), 'XX') AS country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= $1 AND started_at < $2
        ${filter.sql.replace(/sessions\./g, '')}
      GROUP BY COALESCE(NULLIF(TRIM(country_code), ''), 'XX')
    `, [start, end, ...filter.params])
    : await db.all(`
      SELECT COALESCE(NULLIF(TRIM(country_code), ''), 'XX') AS country_code, COUNT(*) AS total
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
        ${filter.sql.replace(/sessions\./g, '')}
      GROUP BY COALESCE(NULLIF(TRIM(country_code), ''), 'XX')
    `, [start, end, ...filter.params]);

  // Guardrail: conversions + revenue must be Shopify truth (never exceed Shopify).
  // Attribution basis: Shopify order country (shipping/billing) rather than pixel-evidence linkage.
  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  function orderCountryCodeFromRawJson(rawJson) {
    const raw = safeJsonParse(rawJson);
    if (!raw || typeof raw !== 'object') return null;
    const ship =
      raw?.shipping_address?.country_code ??
      raw?.shipping_address?.countryCode ??
      raw?.shippingAddress?.countryCode ??
      raw?.shippingAddress?.country_code ??
      null;
    const bill =
      raw?.billing_address?.country_code ??
      raw?.billing_address?.countryCode ??
      raw?.billingAddress?.countryCode ??
      raw?.billingAddress?.country_code ??
      null;
    return normalizeCountryOrXX(ship || bill);
  }

  const shop = salesTruth.resolveShopForSales('');
  let purchaseAgg = [];
  if (shop) {
    const orders = config.dbUrl
      ? await db.all(
        `
          SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price AS revenue, raw_json
          FROM orders_shopify
          WHERE shop = $1
            AND created_at >= $2 AND created_at < $3
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
            AND total_price IS NOT NULL
        `,
        [shop, start, end]
      )
      : await db.all(
        `
          SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_price AS revenue, raw_json
          FROM orders_shopify
          WHERE shop = ?
            AND created_at >= ? AND created_at < ?
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
            AND total_price IS NOT NULL
        `,
        [shop, start, end]
      );
    const byCountryCurrency = new Map(); // "CC|CUR" -> { country_code, currency, converted, revenue }
    for (const o of orders || []) {
      const cc = orderCountryCodeFromRawJson(o && o.raw_json != null ? String(o.raw_json) : '') || 'XX';
      const cur = fx.normalizeCurrency(o && o.currency != null ? String(o.currency) : '') || 'GBP';
      const rev = o && o.revenue != null ? Number(o.revenue) : 0;
      const amt = Number.isFinite(rev) ? rev : 0;
      const key = cc + '|' + cur;
      const curRow = byCountryCurrency.get(key) || { country_code: cc, currency: cur, converted: 0, revenue: 0 };
      curRow.converted += 1;
      curRow.revenue += amt;
      byCountryCurrency.set(key, curRow);
    }
    purchaseAgg = Array.from(byCountryCurrency.values()).map((r) => ({
      country_code: r.country_code,
      currency: r.currency,
      converted: r.converted,
      revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
    }));
  }

  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map();
  for (const row of conversionRows) {
    const code = normalizeCountryOrXX(row && row.country_code != null ? String(row.country_code) : '');
    map.set(code, {
      country_code: code,
      total: Number(row.total) || 0,
      converted: Number(row.converted) || 0,
      revenue: 0,
    });
  }

  // Sum converted counts and convert revenue to GBP across currencies.
  for (const row of purchaseAgg || []) {
    const code = normalizeCountryOrXX(row && row.country_code != null ? String(row.country_code) : '');
    const current = map.get(code) || { country_code: code, total: 0, converted: 0, revenue: 0 };
    const converted = Number(row.converted) || 0;
    const revenue = row.revenue != null ? Number(row.revenue) : 0;
    const cur = fx.normalizeCurrency(row.currency) || 'GBP';
    current.converted += converted;
    const gbp = fx.convertToGbp(revenue, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) current.revenue += gbp;
    map.set(code, current);
  }

  const out = Array.from(map.values()).map(r => {
    const revenue = Math.round((Number(r.revenue) || 0) * 100) / 100;
    const converted = r.converted || 0;
    const aov = converted > 0 ? Math.round((revenue / converted) * 100) / 100 : null;
    return {
      country_code: r.country_code,
      conversion: r.total > 0 ? Math.round((r.converted / r.total) * 1000) / 10 : null,
      revenue,
      total: r.total,
      converted,
      aov,
    };
  });
  out.sort((a, b) => (b.revenue - a.revenue) || (b.converted - a.converted) || (b.total - a.total));
  return out.slice(0, 20);
}

/**
 * Best GEO Products: top revenue products by country + product.
 *
 * Attribution:
 * - Country comes from Shopify truth orders (shipping/billing country parsed from orders_shopify.raw_json).
 * - Revenue comes from orders_shopify_line_items (truth line-item facts).
 *
 * Output rows:
 * - country_code, product_id, product_title, product_handle, product_thumb_url,
 *   conversion (pct), converted (orders), total (sessions), revenue (GBP)
 */
async function getBestGeoProducts(start, end, options = {}) {
  const MAX_BEST_GEO_ROWS = 200;
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return [];
  const token = await salesTruth.getAccessToken(shop);

  // Guardrail: use Shopify truth orders + line items (no pixel-evidence linkage) so totals match Shopify.
  function safeJsonParse(str) {
    if (!str || typeof str !== 'string') return null;
    try { return JSON.parse(str); } catch (_) { return null; }
  }
  function orderCountryCodeFromRawJson(rawJson) {
    const raw = safeJsonParse(rawJson);
    if (!raw || typeof raw !== 'object') return null;
    const ship =
      raw?.shipping_address?.country_code ??
      raw?.shipping_address?.countryCode ??
      raw?.shippingAddress?.countryCode ??
      raw?.shippingAddress?.country_code ??
      null;
    const bill =
      raw?.billing_address?.country_code ??
      raw?.billing_address?.countryCode ??
      raw?.billingAddress?.countryCode ??
      raw?.billingAddress?.country_code ??
      null;
    return normalizeCountry(ship || bill);
  }

  function normalizeHandle(v) {
    if (typeof v !== 'string') return '';
    return v.trim().toLowerCase().slice(0, 128);
  }

  function handleFromPath(pathValue) {
    if (typeof pathValue !== 'string') return '';
    const m = pathValue.match(/^\/products\/([^/?#]+)/i);
    return m ? normalizeHandle(m[1]) : '';
  }

  function handleFromUrl(urlValue) {
    if (typeof urlValue !== 'string') return '';
    const raw = urlValue.trim();
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return handleFromPath(u.pathname || '');
    } catch (_) {
      return handleFromPath(raw);
    }
  }

  function handleFromSessionRow(row) {
    return (
      handleFromPath(row && row.first_path) ||
      normalizeHandle(row && row.first_product_handle) ||
      handleFromUrl(row && row.entry_url) ||
      ''
    );
  }

  // Sessions used as denominator are now country + product handle specific.
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');
  const sessionLandingRows = config.dbUrl
    ? await db.all(
      `
        SELECT
          s.country_code AS country_code,
          s.first_path AS first_path,
          s.first_product_handle AS first_product_handle,
          s.entry_url AS entry_url
        FROM sessions s
        WHERE s.started_at >= $1 AND s.started_at < $2
          AND s.country_code IS NOT NULL AND s.country_code != '' AND s.country_code != 'XX'
          ${filterAlias}
          AND (
            (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
            OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
            OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
          )
      `,
      [start, end, ...filter.params]
    )
    : await db.all(
      `
        SELECT
          s.country_code AS country_code,
          s.first_path AS first_path,
          s.first_product_handle AS first_product_handle,
          s.entry_url AS entry_url
        FROM sessions s
        WHERE s.started_at >= ? AND s.started_at < ?
          AND s.country_code IS NOT NULL AND s.country_code != '' AND s.country_code != 'XX'
          ${filterAlias}
          AND (
            (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
            OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
            OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
          )
      `,
      [start, end, ...filter.params]
    );

  // Truth orders -> country (shipping/billing).
  const orderRows = config.dbUrl
    ? await db.all(
      `
        SELECT order_id, raw_json
        FROM orders_shopify
        WHERE shop = $1
          AND created_at >= $2 AND created_at < $3
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    )
    : await db.all(
      `
        SELECT order_id, raw_json
        FROM orders_shopify
        WHERE shop = ?
          AND created_at >= ? AND created_at < ?
          AND (test IS NULL OR test = 0)
          AND cancelled_at IS NULL
          AND financial_status = 'paid'
      `,
      [shop, start, end]
    );
  const orderCountry = new Map(); // order_id -> CC
  for (const o of orderRows || []) {
    const oid = o && o.order_id != null ? String(o.order_id).trim() : '';
    if (!oid) continue;
    const cc = orderCountryCodeFromRawJson(o && o.raw_json != null ? String(o.raw_json) : '');
    if (!cc || cc === 'XX') continue;
    orderCountry.set(oid, cc);
  }

  // Line items (truth revenue per product) for those orders in range.
  const liRows = config.dbUrl
    ? await db.all(
      `
        SELECT
          order_id,
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          product_id,
          title,
          line_revenue AS revenue
        FROM orders_shopify_line_items
        WHERE shop = $1
          AND order_created_at >= $2 AND order_created_at < $3
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) != ''
          AND title IS NOT NULL AND TRIM(title) != ''
      `,
      [shop, start, end]
    )
    : await db.all(
      `
        SELECT
          order_id,
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          product_id,
          title,
          line_revenue AS revenue
        FROM orders_shopify_line_items
        WHERE shop = ?
          AND order_created_at >= ? AND order_created_at < ?
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) != ''
          AND title IS NOT NULL AND TRIM(title) != ''
      `,
      [shop, start, end]
    );

  const ratesToGbp = await fx.getRatesToGbp();
  const byCountryProduct = new Map(); // "CC|PID" -> { country_code, product_id, title, orderIds:Set, revenueGbp }
  for (const r of liRows || []) {
    const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
    if (!oid) continue;
    const cc = orderCountry.get(oid);
    if (!cc) continue;
    const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
    if (!pid) continue;
    const title = r && r.title != null ? String(r.title).trim() : '';
    const cur = fx.normalizeCurrency(r && r.currency) || 'GBP';
    const rev = r && r.revenue != null ? Number(r.revenue) : 0;
    const amt = Number.isFinite(rev) ? rev : 0;
    const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
    const gbpAmt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;

    const key = cc + '|' + pid;
    const curRow = byCountryProduct.get(key) || { country_code: cc, product_id: pid, title: title || null, orderIds: new Set(), revenueGbp: 0 };
    curRow.orderIds.add(oid);
    curRow.revenueGbp += gbpAmt;
    if (!curRow.title && title) curRow.title = title;
    byCountryProduct.set(key, curRow);
  }

  // Group products by country and keep a stable sort within each country.
  const byCountryList = new Map(); // CC -> rows[]
  for (const v of byCountryProduct.values()) {
    const list = byCountryList.get(v.country_code) || [];
    list.push(v);
    byCountryList.set(v.country_code, list);
  }
  for (const [cc, list] of byCountryList.entries()) {
    list.sort((a, b) => (b.revenueGbp - a.revenueGbp) || (b.orderIds.size - a.orderIds.size));
    byCountryList.set(cc, list);
  }

  // Fetch product meta (handle + thumb) for the selected products.
  const metaByProduct = new Map();
  if (token) {
    const selected = new Set();
    for (const list of byCountryList.values()) {
      for (const v of list || []) {
        if (v && v.product_id) selected.add(v.product_id);
      }
    }
    const uniqIds = Array.from(selected.values()).filter(Boolean);
    await Promise.all(
      uniqIds.map(async (pid) => {
        try {
          const meta = await productMetaCache.getProductMeta(shop, token, pid);
          if (meta && meta.ok) metaByProduct.set(pid, meta);
        } catch (_) {}
      })
    );
  }

  const selectedCountryHandlePairs = new Set();
  for (const [cc, list] of byCountryList.entries()) {
    for (const v of list || []) {
      const pid = v && v.product_id ? String(v.product_id) : '';
      const meta = pid && metaByProduct.has(pid) ? metaByProduct.get(pid) : null;
      const handle = meta && meta.handle ? normalizeHandle(String(meta.handle)) : '';
      if (!handle) continue;
      selectedCountryHandlePairs.add(`${cc}|${handle}`);
    }
  }

  const clicksByCountryHandle = new Map();
  for (const row of sessionLandingRows || []) {
    const cc = normalizeCountry(row && row.country_code);
    if (!cc || cc === 'XX') continue;
    const handle = handleFromSessionRow(row);
    if (!handle) continue;
    const pairKey = `${cc}|${handle}`;
    if (!selectedCountryHandlePairs.has(pairKey)) continue;
    clicksByCountryHandle.set(pairKey, (clicksByCountryHandle.get(pairKey) || 0) + 1);
  }

  const out = [];
  for (const [cc, list] of byCountryList.entries()) {
    for (const v of list || []) {
      const pid = v.product_id;
      const meta = pid && metaByProduct.has(pid) ? metaByProduct.get(pid) : null;
      const handle = meta && meta.handle ? String(meta.handle).trim() : '';
      const normalizedHandle = normalizeHandle(handle);
      const thumbUrl = meta && meta.thumb_url ? String(meta.thumb_url).trim() : '';
      const converted = v.orderIds ? v.orderIds.size : 0;
      const revenue = Math.round((Number(v.revenueGbp) || 0) * 100) / 100;
      const clicks = normalizedHandle ? (clicksByCountryHandle.get(`${cc}|${normalizedHandle}`) || 0) : 0;
      const conversion = clicks > 0 ? Math.round((converted / clicks) * 1000) / 10 : null;
      out.push({
        country_code: cc,
        product_id: pid || null,
        product_title: v.title || null,
        product_handle: handle || null,
        product_thumb_url: thumbUrl || null,
        conversion,
        total: clicks,
        converted,
        revenue,
      });
    }
  }
  // Keep stable ordering: highest revenue first.
  out.sort((a, b) => (b.revenue - a.revenue) || (b.converted - a.converted) || (b.total - a.total));
  return out.slice(0, MAX_BEST_GEO_ROWS);
}

async function getSessionCountsFromSessionsTable(start, end, options = {}) {
  const db = getDb();
  const totalRow = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2', [start, end])
    : await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?', [start, end]);
  const filter = sessionFilterForTraffic(options.trafficMode || config.trafficMode || 'all');
  const humanRow = config.dbUrl
    ? await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql, [start, end, ...filter.params])
    : await db.get('SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql, [start, end, ...filter.params]);
  const total = totalRow ? Number(totalRow.n) || 0 : 0;
  const human = humanRow ? Number(humanRow.n) || 0 : 0;
  return { total_sessions: total, human_sessions: human, known_bot_sessions: total - human };
}

async function getSessionCounts(start, end, options = {}) {
  const sessionsSource = options?.reporting?.sessionsSource || 'sessions';
  const rangeKey = typeof options.rangeKey === 'string' ? options.rangeKey : '';
  const timeZone = options.timeZone || resolveAdminTimeZone();
  if (sessionsSource !== 'shopify_sessions' || !isDayLikeRangeKey(rangeKey)) {
    return getSessionCountsFromSessionsTable(start, end, options);
  }
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return getSessionCountsFromSessionsTable(start, end, options);
  const n = await getShopifySessionsCountForBounds(shop, start, end, timeZone, { fetchIfMissing: true });
  if (typeof n === 'number' && Number.isFinite(n)) {
    return { total_sessions: n, human_sessions: n, known_bot_sessions: null };
  }
  return { total_sessions: null, human_sessions: null, known_bot_sessions: null };
}

async function getConvertedCount(start, end, options = {}) {
  // Guardrail: report order counts from Shopify truth only (never exceed Shopify).
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return 0;
  return salesTruth.getTruthOrderCount(shop, start, end);
}

/**
 * Session-based conversions (Shopify-style): count sessions that had >=1 purchase in the range.
 * Shopify's "conversion rate" uses sessions that completed checkout, not raw order count.
 *
 * Falls back to order-count when required tables are missing (older installs).
 */
async function getConvertedSessionCount(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');
  const db = getDb();

  const ordersSource = options?.reporting?.ordersSource || 'orders_shopify';
  if (ordersSource === 'pixel') {
    try {
      const row = config.dbUrl
        ? await db.get(
          `
            SELECT COUNT(*) AS n FROM (
              SELECT DISTINCT s.session_id AS session_id
              FROM sessions s
              INNER JOIN purchases p ON p.session_id = s.session_id
              WHERE s.started_at >= $1 AND s.started_at < $2
                ${filterAlias}
                AND p.purchased_at >= $3 AND p.purchased_at < $4
                ${purchaseFilterExcludeDuplicateH('p')}
            ) t
          `,
          [start, end, start, end, ...filter.params]
        )
        : await db.get(
          `
            SELECT COUNT(*) AS n FROM (
              SELECT DISTINCT s.session_id AS session_id
              FROM sessions s
              INNER JOIN purchases p ON p.session_id = s.session_id
              WHERE s.started_at >= ? AND s.started_at < ?
                ${filterAlias}
                AND p.purchased_at >= ? AND p.purchased_at < ?
                ${purchaseFilterExcludeDuplicateH('p')}
            ) t
          `,
          [start, end, start, end, ...filter.params]
        );
      return row?.n != null ? Number(row.n) || 0 : 0;
    } catch (_) {
      // Older installs might not have purchases table; fall back to order-count behavior.
      return getConvertedCount(start, end, options);
    }
  }

  // Truth-backed conversions attributed to sessions via linked purchase evidence.
  const shop = salesTruth.resolveShopForSales('');
  if (!shop) return getConvertedCount(start, end, options);
  try {
    const row = config.dbUrl
      ? await db.get(
        `
          SELECT COUNT(*) AS n FROM (
            SELECT DISTINCT s.session_id AS session_id
            FROM sessions s
            INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = $1
            INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
            WHERE s.started_at >= $2 AND s.started_at < $3
              ${filterAlias}
              AND pe.event_type IN ('checkout_completed', 'checkout_started')
              AND pe.occurred_at >= $4 AND pe.occurred_at < $5
              AND o.created_at >= $4 AND o.created_at < $5
              AND (o.test IS NULL OR o.test = 0)
              AND o.cancelled_at IS NULL
              AND o.financial_status = 'paid'
          ) t
        `,
        [shop, start, end, start, end, ...filter.params]
      )
      : await db.get(
        `
          SELECT COUNT(*) AS n FROM (
            SELECT DISTINCT s.session_id AS session_id
            FROM sessions s
            INNER JOIN purchase_events pe ON pe.session_id = s.session_id AND pe.shop = ?
            INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
            WHERE s.started_at >= ? AND s.started_at < ?
              ${filterAlias}
              AND pe.event_type IN ('checkout_completed', 'checkout_started')
              AND pe.occurred_at >= ? AND pe.occurred_at < ?
              AND o.created_at >= ? AND o.created_at < ?
              AND (o.test IS NULL OR o.test = 0)
              AND o.cancelled_at IS NULL
              AND o.financial_status = 'paid'
          ) t
        `,
        [shop, start, end, start, end, start, end, ...filter.params]
      );
    return row?.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    // If purchase evidence tables don't exist yet, keep legacy behavior instead of returning 0/null.
    return getConvertedCount(start, end, options);
  }
}

function aovFromSalesAndCount(sales, count) {
  if (count == null || count <= 0 || sales == null) return null;
  return Math.round((sales / count) * 100) / 100;
}

/** Bounce rate: (single-page sessions / total sessions) × 100. Industry standard: single-page = session with exactly one page_viewed (user left without a second page). */
async function getBounceRate(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const filterAlias = filter.sql.replace(/sessions\./g, 's.');
  const db = getDb();
  const singlePageRow = config.dbUrl
    ? await db.get(`
      SELECT COUNT(*) AS n FROM sessions s
      WHERE s.started_at >= $1 AND s.started_at < $2 ${filterAlias}
      AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = 'page_viewed') = 1
    `, [start, end, ...filter.params])
    : await db.get(`
      SELECT COUNT(*) AS n FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ? ${filterAlias}
      AND (SELECT COUNT(*) FROM events e WHERE e.session_id = s.session_id AND e.type = 'page_viewed') = 1
    `, [start, end, ...filter.params]);
  const breakdown = await getSessionCountsFromSessionsTable(start, end, options);
  const total = breakdown.human_sessions ?? 0;
  const singlePage = singlePageRow ? Number(singlePageRow.n) || 0 : 0;
  if (total <= 0) return null;
  return Math.round((singlePage / total) * 1000) / 10;
}

async function getStats(options = {}) {
  const trafficMode = options.trafficMode === 'human_only' ? 'human_only' : (config.trafficMode || 'all');
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const reporting = await getReportingConfig();
  const opts = { trafficMode, timeZone, reporting };
  const requestedRangeRaw =
    typeof options.rangeKey === 'string' ? options.rangeKey :
      (typeof options.range === 'string' ? options.range : '');
  const requestedRange = requestedRangeRaw ? String(requestedRangeRaw).trim().toLowerCase() : '';
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['3d', '7d', '14d', '30d', 'month']);
  const rangeKeys = DEFAULT_RANGE_KEYS.slice();
  if (requestedRange && !rangeKeys.includes(requestedRange) && (isDayKey || isRangeKey || allowedLegacy.has(requestedRange))) {
    rangeKeys.push(requestedRange);
  }
  const ranges = {};
  for (const key of rangeKeys) {
    ranges[key] = getRangeBounds(key, now, timeZone);
  }
  // Guardrail: ensure Shopify truth cache is fresh for the ranges we will report.
  const salesShop = salesTruth.resolveShopForSales('');
  let salesTruthTodaySync = null;
  if (salesShop) {
    // Always reconcile Today with scope='today' (also ensures returning-customer facts).
    try {
      salesTruthTodaySync = await salesTruth.ensureReconciled(salesShop, ranges.today.start, ranges.today.end, 'today');
    } catch (_) {
      salesTruthTodaySync = { ok: false, error: 'reconcile_failed' };
    }

    // Reconcile other ranges (skip ranges fully contained inside another requested range).
    const others = rangeKeys
      .map((key) => ({ key, start: ranges[key]?.start, end: ranges[key]?.end }))
      .filter((r) => r && r.key && r.key !== 'today' && typeof r.start === 'number' && Number.isFinite(r.start) && typeof r.end === 'number' && Number.isFinite(r.end) && r.end > r.start);
    const needed = [];
    for (const r of others) {
      const contained = others.some((o) => o !== r && o.start <= r.start && o.end >= r.end);
      if (!contained) needed.push(r);
    }
    for (const r of needed) {
      const scopeKey = ('stats_' + String(r.key || 'range')).slice(0, 64);
      try { await salesTruth.ensureReconciled(salesShop, r.start, r.end, scopeKey); } catch (_) {}
    }
  }
  // Run all stats queries in one parallel batch to avoid N+1 (many sequential DB round-trips). Fixes NODE-1.
  const [
    salesByRangeEntries,
    returningRevenueByRangeEntries,
    conversionByRangeEntries,
    productConversionByRangeEntries,
    countryByRangeEntries,
    bestGeoProductsByRangeEntries,
    salesRollingEntries,
    conversionRollingEntries,
    convertedCountByRangeEntries,
    convertedCountRollingEntries,
    trafficBreakdownEntries,
    bounceByRangeEntries,
    yesterdayOk,
    salesTruthHealth,
  ] = await Promise.all([
    Promise.all(rangeKeys.map(async key => [key, await getSalesTotal(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getReturningRevenue(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getConversionRate(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getProductConversionRate(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getCountryStats(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getBestGeoProducts(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(SALES_ROLLING_WINDOWS.map(async w => [w.key, await getSalesTotal(now - w.ms, now, { ...opts, rangeKey: w.key })])),
    Promise.all(CONVERSION_ROLLING_WINDOWS.map(async w => [w.key, await getConversionRate(now - w.ms, now, { ...opts, rangeKey: w.key })])),
    Promise.all(rangeKeys.map(async key => [key, await getConvertedCount(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(SALES_ROLLING_WINDOWS.map(async w => [w.key, await getConvertedCount(now - w.ms, now, { ...opts, rangeKey: w.key })])),
    Promise.all(rangeKeys.map(async key => [key, await getSessionCounts(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    Promise.all(rangeKeys.map(async key => [key, await getBounceRate(ranges[key].start, ranges[key].end, { ...opts, rangeKey: key })])),
    rangeHasSessions(ranges.yesterday.start, ranges.yesterday.end, opts),
    (salesShop ? salesTruth.getTruthHealth(salesShop || '', 'today') : Promise.resolve(null)),
  ]);
  const salesByRange = Object.fromEntries(salesByRangeEntries);
  const returningRevenueByRange = Object.fromEntries(returningRevenueByRangeEntries);
  const conversionByRange = Object.fromEntries(conversionByRangeEntries);
  const productConversionByRange = Object.fromEntries(productConversionByRangeEntries);
  const countryByRange = Object.fromEntries(countryByRangeEntries);
  const bestGeoProductsByRange = Object.fromEntries(bestGeoProductsByRangeEntries);
  const salesRolling = Object.fromEntries(salesRollingEntries);
  const conversionRolling = Object.fromEntries(conversionRollingEntries);
  const convertedCountByRange = Object.fromEntries(convertedCountByRangeEntries);
  const convertedCountRolling = Object.fromEntries(convertedCountRollingEntries);
  const trafficBreakdown = Object.fromEntries(trafficBreakdownEntries);
  const bounceByRange = Object.fromEntries(bounceByRangeEntries);
  const aovByRange = {};
  for (const key of rangeKeys) {
    aovByRange[key] = aovFromSalesAndCount(salesByRange[key], convertedCountByRange[key]);
  }
  const aovRolling = {};
  for (const key of Object.keys(salesRolling)) {
    aovRolling[key] = aovFromSalesAndCount(salesRolling[key], convertedCountRolling[key]);
  }
  const rangeAvailable = {
    today: true,
    yesterday: yesterdayOk,
  };
  return {
    sales: { ...salesByRange, rolling: salesRolling },
    returningRevenue: { ...returningRevenueByRange },
    conversion: { ...conversionByRange, rolling: conversionRolling },
    productConversion: productConversionByRange,
    country: countryByRange,
    bestGeoProducts: bestGeoProductsByRange,
    aov: { ...aovByRange, rolling: aovRolling },
    bounce: bounceByRange,
    revenueToday: salesByRange.today ?? 0,
    reporting,
    salesTruth: {
      shop: salesShop || '',
      todaySync: salesTruthTodaySync,
      health: salesTruthHealth,
    },
    rangeAvailable,
    convertedCount: convertedCountByRange,
    trafficMode,
    trafficBreakdown,
  };
}

/**
 * Lightweight KPI payload for the top grid (no country/product breakdown).
 * Returns a stats-shaped object but only for a single range key.
 */
async function getKpis(options = {}) {
  const trafficMode = options.trafficMode === 'human_only' ? 'human_only' : (config.trafficMode || 'all');
  const force = !!options.force;
  const now = Date.now();
  const timeZone = resolveAdminTimeZone();
  const reporting = await getReportingConfig();
  const opts = { trafficMode, timeZone, reporting };

  const requestedRangeRaw =
    typeof options.rangeKey === 'string' ? options.rangeKey :
      (typeof options.range === 'string' ? options.range : '');
  const requestedRange = requestedRangeRaw ? String(requestedRangeRaw).trim().toLowerCase() : '';
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedLegacy = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
  const rangeKey = (DEFAULT_RANGE_KEYS.includes(requestedRange) || isDayKey || isRangeKey || allowedLegacy.has(requestedRange))
    ? requestedRange
    : 'today';

  const bounds = getRangeBounds(rangeKey, now, timeZone);

  async function getAdSpendGbp(startMs, endMs) {
    try {
      const adsDb = require('./ads/adsDb');
      if (!adsDb || typeof adsDb.getAdsPool !== 'function') return null;
      const pool = adsDb.getAdsPool();
      if (!pool) return null;
      const start = Number(startMs);
      const end = Number(endMs);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return null;
      const startSec = start / 1000;
      const endSec = end / 1000;
      const r = await pool.query(
        'SELECT COALESCE(SUM(spend_gbp), 0) AS spend_gbp FROM google_ads_spend_hourly WHERE hour_ts >= to_timestamp($1) AND hour_ts < to_timestamp($2)',
        [startSec, endSec]
      );
      const v = r && r.rows && r.rows[0] ? Number(r.rows[0].spend_gbp) : null;
      return (typeof v === 'number' && Number.isFinite(v)) ? Math.round(v * 100) / 100 : null;
    } catch (_) {
      return null;
    }
  }

  function cacheSlowMetric(metricKey, start, end, cacheRangeKey, computeFn) {
    const rk = typeof cacheRangeKey === 'string' ? cacheRangeKey : rangeKey;
    return reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'kpis_slow_' + String(metricKey || 'metric'),
        rangeKey: rk,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { trafficMode, rangeKey: rk },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      computeFn
    ).then((r) => (r && r.ok ? r.data : null));
  }

  // Guardrail: ensure Shopify truth cache is fresh for this range.
  // For 'today' we block so KPIs reflect latest; for yesterday/other ranges we fire-and-forget
  // so the response returns quickly (avoids ~25s timeout when reconcile is slow).
  const salesShop = salesTruth.resolveShopForSales('');
  let salesTruthSync = null;
  if (salesShop) {
    const scopeKey = rangeKey === 'today' ? 'today' : ('kpis_' + String(rangeKey || 'range')).slice(0, 64);
    if (rangeKey === 'today') {
      try {
        salesTruthSync = await salesTruth.ensureReconciled(salesShop, bounds.start, bounds.end, scopeKey);
      } catch (_) {
        salesTruthSync = { ok: false, error: 'reconcile_failed' };
      }
    } else {
      salesTruth.ensureReconciled(salesShop, bounds.start, bounds.end, scopeKey).catch(() => {});
      salesTruthSync = null;
    }
  }

  const yesterdayBounds = getRangeBounds('yesterday', now, timeZone);
  const [
    salesVal,
    returningRevenueVal,
    returningOrderCountVal,
    returningCustomerCountVal,
    convertedCountVal,
    trafficBreakdownVal,
    bounceVal,
    adSpendVal,
    yesterdayOk,
    salesTruthHealth,
  ] = await Promise.all([
    getSalesTotal(bounds.start, bounds.end, { ...opts, rangeKey }),
    getReturningRevenue(bounds.start, bounds.end, { ...opts, rangeKey }),
    getReturningOrderCount(bounds.start, bounds.end, { ...opts, rangeKey }),
    cacheSlowMetric(
      'returningCustomerCount',
      bounds.start,
      bounds.end,
      rangeKey,
      () => getReturningCustomerCount(bounds.start, bounds.end, { ...opts, rangeKey })
    ),
    getConvertedCount(bounds.start, bounds.end, { ...opts, rangeKey }),
    getSessionCounts(bounds.start, bounds.end, { ...opts, rangeKey }),
    cacheSlowMetric(
      'bounce',
      bounds.start,
      bounds.end,
      rangeKey,
      () => getBounceRate(bounds.start, bounds.end, { ...opts, rangeKey })
    ),
    cacheSlowMetric(
      'adSpend',
      bounds.start,
      bounds.end,
      rangeKey,
      () => getAdSpendGbp(bounds.start, bounds.end)
    ),
    rangeHasSessions(yesterdayBounds.start, yesterdayBounds.end, opts),
    (salesShop ? salesTruth.getTruthHealth(salesShop || '', rangeKey === 'today' ? 'today' : ('kpis_' + String(rangeKey || 'r')).slice(0, 64)) : Promise.resolve(null)),
  ]);

  // Avoid duplicate work: conversion rate is derived from already-fetched orders + session counts.
  const sessionsForConv = trafficBreakdownVal && typeof trafficBreakdownVal.human_sessions === 'number'
    ? trafficBreakdownVal.human_sessions
    : null;
  const ordersForConv = (typeof convertedCountVal === 'number' && Number.isFinite(convertedCountVal)) ? convertedCountVal : null;
  const conversionVal = (sessionsForConv != null && Number.isFinite(sessionsForConv) && sessionsForConv > 0 && ordersForConv != null)
    ? (Math.round((ordersForConv / sessionsForConv) * 1000) / 10)
    : null;

  const roasVal = (typeof salesVal === 'number' && Number.isFinite(salesVal) && typeof adSpendVal === 'number' && Number.isFinite(adSpendVal) && adSpendVal > 0)
    ? (Math.round((salesVal / adSpendVal) * 100) / 100)
    : null;

  let compare = null;
  // Compute previous-period comparison for all date ranges
  {
    const periodLengthMs = bounds.end - bounds.start;
    let compareStart, compareEnd;
    if (rangeKey === 'today') {
      // Today up to now → yesterday up to same time-of-day
      const nowParts = getTimeZoneParts(new Date(now), timeZone);
      const yesterdayParts = addDaysToParts(nowParts, -1);
      compareStart = startOfDayUtcMs(yesterdayParts, timeZone);
      const sameTimeYesterday = zonedTimeToUtcMs(
        yesterdayParts.year, yesterdayParts.month, yesterdayParts.day,
        nowParts.hour, nowParts.minute, nowParts.second, timeZone
      );
      const todayStart = startOfDayUtcMs(nowParts, timeZone);
      compareEnd = Math.max(compareStart, Math.min(sameTimeYesterday, todayStart));
    } else {
      // All other ranges: shift back by the period length
      compareStart = bounds.start - periodLengthMs;
      compareEnd = bounds.start;
    }
    // Clamp to platform start
    if (compareStart < PLATFORM_START_MS) compareStart = PLATFORM_START_MS;
    if (compareEnd < PLATFORM_START_MS) compareEnd = PLATFORM_START_MS;
    if (compareEnd > compareStart) {
      const compareOpts = { ...opts, rangeKey: rangeKey === 'today' ? 'yesterday' : rangeKey };
      const [
        compareSales,
        compareReturning,
        compareReturningOrderCount,
        compareReturningCustomerCount,
        compareConvertedCount,
        compareBreakdown,
        compareBounce,
        compareAdSpend,
      ] = await Promise.all([
        getSalesTotal(compareStart, compareEnd, compareOpts),
        getReturningRevenue(compareStart, compareEnd, compareOpts),
        getReturningOrderCount(compareStart, compareEnd, compareOpts),
        cacheSlowMetric(
          'returningCustomerCount',
          compareStart,
          compareEnd,
          compareOpts.rangeKey,
          () => getReturningCustomerCount(compareStart, compareEnd, compareOpts)
        ),
        getConvertedCount(compareStart, compareEnd, compareOpts),
        getSessionCounts(compareStart, compareEnd, compareOpts),
        cacheSlowMetric(
          'bounce',
          compareStart,
          compareEnd,
          compareOpts.rangeKey,
          () => getBounceRate(compareStart, compareEnd, compareOpts)
        ),
        cacheSlowMetric(
          'adSpend',
          compareStart,
          compareEnd,
          compareOpts.rangeKey,
          () => getAdSpendGbp(compareStart, compareEnd)
        ),
      ]);

      const compareSessionsForConv = compareBreakdown && typeof compareBreakdown.human_sessions === 'number'
        ? compareBreakdown.human_sessions
        : null;
      const compareOrdersForConv = (typeof compareConvertedCount === 'number' && Number.isFinite(compareConvertedCount)) ? compareConvertedCount : null;
      const compareConversion = (compareSessionsForConv != null && Number.isFinite(compareSessionsForConv) && compareSessionsForConv > 0 && compareOrdersForConv != null)
        ? (Math.round((compareOrdersForConv / compareSessionsForConv) * 1000) / 10)
        : null;

      const compareRoas = (typeof compareSales === 'number' && Number.isFinite(compareSales) && typeof compareAdSpend === 'number' && Number.isFinite(compareAdSpend) && compareAdSpend > 0)
        ? (Math.round((compareSales / compareAdSpend) * 100) / 100)
        : null;

      compare = {
        sales: compareSales,
        returningRevenue: compareReturning,
        returningOrderCount: compareReturningOrderCount,
        returningCustomerCount: compareReturningCustomerCount,
        conversion: compareConversion,
        aov: aovFromSalesAndCount(compareSales, compareConvertedCount),
        bounce: compareBounce,
        adSpend: compareAdSpend,
        roas: compareRoas,
        convertedCount: compareConvertedCount,
        trafficBreakdown: compareBreakdown,
        range: { start: compareStart, end: compareEnd },
      };
    }
  }

  const aovVal = aovFromSalesAndCount(salesVal, convertedCountVal);
  const rangeAvailable = {
    today: true,
    yesterday: yesterdayOk,
  };

  return {
    sales: { [rangeKey]: salesVal },
    returningRevenue: { [rangeKey]: returningRevenueVal },
    returningOrderCount: { [rangeKey]: returningOrderCountVal },
    returningCustomerCount: { [rangeKey]: returningCustomerCountVal },
    conversion: { [rangeKey]: conversionVal },
    aov: { [rangeKey]: aovVal },
    bounce: { [rangeKey]: bounceVal },
    convertedCount: { [rangeKey]: convertedCountVal },
    adSpend: { [rangeKey]: adSpendVal },
    roas: { [rangeKey]: roasVal },
    compare,
    trafficMode,
    trafficBreakdown: { [rangeKey]: trafficBreakdownVal },
    reporting,
    salesTruth: {
      shop: salesShop || '',
      todaySync: salesTruthSync,
      health: salesTruthHealth,
    },
    rangeAvailable,
  };
}

async function rangeHasSessions(start, end, options = {}) {
  const trafficMode = options.trafficMode || config.trafficMode || 'all';
  const filter = sessionFilterForTraffic(trafficMode);
  const db = getDb();
  const row = config.dbUrl
    ? await db.get('SELECT 1 FROM sessions WHERE started_at >= $1 AND started_at < $2' + filter.sql + ' LIMIT 1', [start, end, ...filter.params])
    : await db.get('SELECT 1 FROM sessions WHERE started_at >= ? AND started_at < ?' + filter.sql + ' LIMIT 1', [start, end, ...filter.params]);
  return !!row;
}

function validateEventType(type) {
  return ALLOWED_EVENT_TYPES.has(type);
}

module.exports = {
  sanitize,
  getSetting,
  setSetting,
  getReportingConfig,
  isTrackingEnabled,
  getVisitor,
  upsertVisitor,
  getSession,
  upsertSession,
  insertPurchase,
  insertEvent,
  listSessions,
  listSessionsByRange,
  listLatestSales,
  getActiveSessionCount,
  getActiveSessionSeries,
  getSessionEvents,
  // Traffic source mapping (custom sources)
  TRAFFIC_SOURCE_MAP_ALLOWED_PARAMS,
  getTrafficSourceMapConfigCached,
  invalidateTrafficSourceMapCache,
  getTrafficSourceMapVersion,
  deriveTrafficSourceKeyWithMaps,
  upsertTrafficSourceMeta,
  addTrafficSourceRule,
  makeCustomTrafficSourceKeyFromLabel,
  backfillTrafficSourceTokensFromSessions,
  backfillTrafficSourceKeysForRule,
  // Reporting helpers (pixel vs truth)
  getPixelSalesSummary,
  getPixelSalesTotalGbp,
  getPixelOrderCount,
  // Shopify sessions snapshots (for optional Shopify sessions denominator)
  saveShopifySessionsSnapshot,
  getLatestShopifySessionsSnapshot,
  getStats,
  getKpis,
  getRangeBounds,
  resolveAdminTimeZone,
  // Shared SQL helpers for pixel dedupe
  purchaseDedupeKeySql,
  purchaseFilterExcludeDuplicateH,
  validateEventType,
  ALLOWED_EVENT_TYPES,
  extractBsAdsIdsFromEntryUrl,
};
