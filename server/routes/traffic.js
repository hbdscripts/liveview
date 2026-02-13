/**
 * Traffic diagnostics + breakdown:
 * - Sources (smart-categorized): Google Ads/Organic, Bing Ads/Organic, Facebook Ads/Organic, Omnisend, Direct
 * - Traffic type: Desktop/Mobile/Tablet + platforms (Windows/Mac/iPhone/Android/iPad, etc)
 *
 * Persisted UI preferences are stored in settings:
 * - traffic_sources_enabled: JSON array of source keys
 * - traffic_types_enabled: JSON array of type keys
 */
const store = require('../store');
const fx = require('../fx');
const { getDb } = require('../db');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');

const SOURCE_LABELS = {
  google_organic: 'Google Organic',
  google_ads: 'Google Ads',
  bing_organic: 'Bing Organic',
  bing_ads: 'Bing Ads',
  facebook_organic: 'Facebook Organic',
  facebook_ads: 'Facebook Ads',
  omnisend: 'Omnisend',
  direct: 'Direct visitor',
  other: 'Other',
};

const TYPE_LABELS = {
  'device:desktop': 'Desktop',
  'device:mobile': 'Mobile',
  'device:tablet': 'Tablet',
  'platform:windows': 'Windows',
  'platform:mac': 'Mac',
  'platform:linux': 'Linux',
  'platform:chromeos': 'Chrome OS',
  'platform:android': 'Android',
  'platform:ios': 'iOS',
  'platform:other': 'Unknown',
};

const DEFAULT_DEVICE_KEYS = ['device:desktop', 'device:mobile', 'device:tablet'];
const ALLOWED_DEVICE_KEYS = new Set(DEFAULT_DEVICE_KEYS);
const ALLOWED_DEVICES = new Set(['desktop', 'mobile', 'tablet']);

function titleCase(s) {
  return String(s || '')
    .replace(/[_:\-]+/g, ' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function safeJsonParse(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

function sanitizeKeyList(arr, { max = 200, maxLen = 80 } = {}) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) continue;
    if (s.length > maxLen) continue;
    if (!/^[a-z0-9:_\-]+$/i.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function chooseTrafficSeriesBucket(bounds, rangeKey) {
  const rk = String(rangeKey || '').trim().toLowerCase();
  const spanMs = Math.max(0, Number(bounds && bounds.end) - Number(bounds && bounds.start));
  // Today / Yesterday (and short custom ranges) look better as hourly points.
  if (rk === 'today' || rk === 'yesterday' || spanMs <= (2 * DAY_MS + 6 * HOUR_MS)) {
    return { bucket: 'hour', stepMs: HOUR_MS };
  }
  return { bucket: 'day', stepMs: DAY_MS };
}

function buildBucketStarts(bounds, stepMs) {
  const start = Number(bounds && bounds.start) || 0;
  const end = Number(bounds && bounds.end) || 0;
  const step = Math.max(1, Number(stepMs) || DAY_MS);
  const out = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;
  for (let ts = start; ts < end; ts += step) out.push(ts);
  return out;
}

async function fetchBucketedSessionCounts(db, { bounds, stepMs, keySql, extraWhereSql = '' } = {}) {
  const start = Number(bounds && bounds.start) || 0;
  const end = Number(bounds && bounds.end) || 0;
  const step = Math.max(1, Number(stepMs) || DAY_MS);
  if (!db || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const extra = extraWhereSql ? ` AND (${extraWhereSql})` : '';
  const rows = await db.all(
    `
      WITH base AS (
        SELECT
          CAST((sessions.started_at - ?) / ? AS INTEGER) AS bucket,
          ${keySql} AS key
        FROM sessions
        WHERE sessions.started_at >= ? AND sessions.started_at < ?
          AND (sessions.cf_known_bot IS NULL OR sessions.cf_known_bot = 0)
          ${extra}
      )
      SELECT bucket, LOWER(TRIM(COALESCE(key, ''))) AS key, COUNT(*) AS sessions
      FROM base
      WHERE key IS NOT NULL AND TRIM(key) != ''
      GROUP BY bucket, LOWER(TRIM(COALESCE(key, '')))
      ORDER BY bucket ASC
    `,
    [start, step, start, end]
  );
  return Array.isArray(rows) ? rows : [];
}

function buildTopSessionSeries({ buckets, rows, allowedKeys, labelForKey, maxSeries = 5 } = {}) {
  const bucketCount = Array.isArray(buckets) ? buckets.length : 0;
  const allowed = sanitizeKeyList(allowedKeys || [], { max: 500 });
  const allowSet = new Set(allowed.map((k) => String(k).trim().toLowerCase()));
  if (!bucketCount || allowSet.size === 0) return [];

  const dataByKey = new Map(); // key -> Array(bucketCount)
  for (const k of allowSet) dataByKey.set(k, Array.from({ length: bucketCount }, () => 0));

  for (const r of Array.isArray(rows) ? rows : []) {
    const key = (r && r.key != null) ? String(r.key).trim().toLowerCase() : '';
    if (!key || !allowSet.has(key)) continue;
    const b = r && r.bucket != null ? Number(r.bucket) : NaN;
    if (!Number.isFinite(b) || b < 0 || b >= bucketCount) continue;
    const n = r && r.sessions != null ? Number(r.sessions) : 0;
    const arr = dataByKey.get(key);
    if (!arr) continue;
    arr[b] = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    dataByKey.set(key, arr);
  }

  const series = [];
  for (const key of allowSet) {
    const arr = dataByKey.get(key) || [];
    let total = 0;
    for (let i = 0; i < arr.length; i++) total += Number(arr[i]) || 0;
    if (total <= 0) continue;
    series.push({
      key,
      label: typeof labelForKey === 'function' ? labelForKey(key) : key,
      totalSessions: total,
      sessions: arr,
    });
  }

  series.sort((a, b) => (Number(b.totalSessions) || 0) - (Number(a.totalSessions) || 0));
  return series.slice(0, Math.max(1, Math.min(20, Number(maxSeries) || 5)));
}

async function getPrefs() {
  const rawSources = await store.getSetting('traffic_sources_enabled');
  const rawTypes = await store.getSetting('traffic_types_enabled');
  const parsedSources = safeJsonParse(rawSources);
  const sources = sanitizeKeyList(parsedSources || []);
  const sourcesExplicitEmpty = Array.isArray(parsedSources) && parsedSources.length === 0;
  const parsedTypes = safeJsonParse(rawTypes);
  let types = sanitizeKeyList(parsedTypes || []);
  const filtered = types.filter((k) => ALLOWED_DEVICE_KEYS.has(k));
  if (filtered.length) {
    types = filtered;
  } else {
    const explicitEmpty = Array.isArray(parsedTypes) && parsedTypes.length === 0;
    if (explicitEmpty) types = [];
    else if (rawTypes == null || parsedTypes == null) types = DEFAULT_DEVICE_KEYS.slice();
    else if (types.length) types = DEFAULT_DEVICE_KEYS.slice(); // upgrade old (platform/model) selections
    else types = [];
  }
  return { sourcesEnabled: sources, typesEnabled: types, sourcesExplicitEmpty };
}

async function setPrefs({ sourcesEnabled, typesEnabled } = {}) {
  if (sourcesEnabled) {
    await store.setSetting('traffic_sources_enabled', JSON.stringify(sanitizeKeyList(sourcesEnabled)));
  }
  if (typesEnabled) {
    const cleaned = sanitizeKeyList(typesEnabled);
    const deviceOnly = cleaned.filter((k) => ALLOWED_DEVICE_KEYS.has(k));
    await store.setSetting('traffic_types_enabled', JSON.stringify(deviceOnly));
  }
}

function humanOnlyClause(alias = '') {
  const a = alias ? alias + '.' : '';
  return ` AND (${a}cf_known_bot IS NULL OR ${a}cf_known_bot = 0)`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function aggCurrencyRowsToGbp(rows, { keyField }) {
  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map(); // key -> { orders, revenueGbp }
  for (const r of rows || []) {
    const key = (r && r[keyField] != null) ? String(r[keyField]).trim() : '';
    if (!key) continue;
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const orders = r.orders != null ? Number(r.orders) || 0 : 0;
    const revenue = r.revenue != null ? Number(r.revenue) : 0;
    const gbp = fx.convertToGbp(Number.isFinite(revenue) ? revenue : 0, cur, ratesToGbp) || 0;
    const prev = map.get(key) || { orders: 0, revenueGbp: 0 };
    prev.orders += orders;
    prev.revenueGbp += Number.isFinite(gbp) ? gbp : 0;
    map.set(key, prev);
  }
  // round
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

function typeKeyToFilter(typeKey) {
  const k = String(typeKey || '').trim().toLowerCase();
  const idx = k.indexOf(':');
  if (idx === -1) return null;
  const dim = k.slice(0, idx);
  const val = k.slice(idx + 1);
  if (!val) return null;
  if (dim === 'device') return { dim: 'ua_device_type', val };
  if (dim === 'platform') return { dim: 'ua_platform', val };
  if (dim === 'model') return { dim: 'ua_model', val };
  return null;
}

function labelForSourceKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return SOURCE_LABELS[k] || titleCase(k);
}

function labelForTypeKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return TYPE_LABELS[k] || titleCase(k);
}

async function getTraffic(req, res) {
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const rangeKeyRaw = typeof req.query.range === 'string' ? req.query.range.trim().toLowerCase() : '';
  const allowedRange = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d']);
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(rangeKeyRaw);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(rangeKeyRaw);
  const rangeKey = (allowedRange.has(rangeKeyRaw) || isDayKey || isRangeKey) ? rangeKeyRaw : 'today';
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const db = getDb();
  const prefs = await getPrefs();
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  const shop = salesTruth.resolveShopForSales('');
  const sourceMapVersion = await store.getTrafficSourceMapVersion().catch(() => ({ metaUpdatedAtMax: 0, rulesCreatedAtMax: 0 }));

  const cached = await reportCache.getOrComputeJson(
    {
      shop: shop || '',
      endpoint: 'traffic',
      rangeKey,
      rangeStartTs: bounds.start,
      rangeEndTs: bounds.end,
      params: { prefs, reporting, sourceMapVersion },
      ttlMs: 5 * 60 * 1000,
      force,
    },
    async () => {
      const t0 = Date.now();
      const sourceMapCfg = await store.getTrafficSourceMapConfigCached().catch(() => null);
      const sourceMetaByKey = sourceMapCfg && sourceMapCfg.metaByKey ? sourceMapCfg.metaByKey : new Map();
      function labelForKey(key) {
        const k = String(key || '').trim().toLowerCase();
        if (!k) return '—';
        const meta = sourceMetaByKey.get(k);
        if (meta && meta.label != null && String(meta.label).trim() !== '') return String(meta.label);
        return labelForSourceKey(k);
      }
      function iconUrlForKey(key) {
        const k = String(key || '').trim().toLowerCase();
        if (!k) return null;
        const meta = sourceMetaByKey.get(k);
        return meta && meta.iconUrl != null ? meta.iconUrl : null;
      }
      const DIRECT_REFERRER_HOSTS = ['heybigday.com', 'hbdjewellery.com'];
      function effectiveSourceKeySql(alias = '') {
        const a = alias ? alias + '.' : '';
        const ref = `LOWER(COALESCE(${a}referrer, ''))`;
        const refMatch = DIRECT_REFERRER_HOSTS.map((h) => `${ref} LIKE '%${h}%'`).join(' OR ');
        const keyNorm = `LOWER(TRIM(COALESCE(${a}traffic_source_key, '')))`;
        return `CASE WHEN ${keyNorm} = 'other' AND (${refMatch}) THEN 'direct' ELSE ${keyNorm} END`;
      }
      let msAvailSources = 0;
      let msSessionsBySource = 0;
      let msSalesBySource = 0;
      let msAvailTypes = 0;
      let msSessionsByPair = 0;
      let msSalesByPair = 0;
      let msBuild = 0;

      // --- Available Sources (last 30d) ---
      const since30d = now - 30 * 24 * 60 * 60 * 1000;
      const tAvail0 = Date.now();
      const sourceKeyExpr = effectiveSourceKeySql('sessions');
      const availableSources = await db.all(
        `
          SELECT ${sourceKeyExpr} AS key, COUNT(*) AS sessions, MAX(last_seen) AS last_seen
          FROM sessions
          WHERE last_seen >= ?
            AND traffic_source_key IS NOT NULL AND TRIM(traffic_source_key) != ''
            ${humanOnlyClause('sessions')}
          GROUP BY key
          ORDER BY sessions DESC
        `,
        [since30d]
      );
      msAvailSources = Date.now() - tAvail0;

      // Ensure enabled sources always appear in the picker (even if 0 sessions in last 30d).
      const availableSourceMap = new Map();
      for (const r of availableSources || []) {
        const key = String(r && r.key != null ? r.key : '').trim().toLowerCase();
        if (!key) continue;
        availableSourceMap.set(key, {
          key,
          label: labelForKey(key),
          icon_url: iconUrlForKey(key),
          sessions: Number(r.sessions) || 0,
          last_seen: toNum(r.last_seen),
        });
      }
      for (const k of prefs.sourcesEnabled || []) {
        const key = String(k || '').trim().toLowerCase();
        if (!key) continue;
        if (availableSourceMap.has(key)) continue;
        availableSourceMap.set(key, {
          key,
          label: labelForKey(key),
          icon_url: iconUrlForKey(key),
          sessions: 0,
          last_seen: null,
        });
      }
      const availableSourcesMerged = Array.from(availableSourceMap.values())
        .sort((a, b) => (Number(b.sessions) - Number(a.sessions)) || ((Number(b.last_seen) || 0) - (Number(a.last_seen) || 0)) || String(a.label).localeCompare(String(b.label)));

      // Default selection: if no channels are saved yet, show the top 5 available.
      const sourcesEnabled = Array.isArray(prefs.sourcesEnabled) ? prefs.sourcesEnabled.slice() : [];
      const sourcesEnabledEffective = (!sourcesEnabled.length && !prefs.sourcesExplicitEmpty)
        ? availableSourcesMerged
          .map((r) => (r && r.key != null ? String(r.key).trim().toLowerCase() : ''))
          .filter(Boolean)
          .slice(0, 5)
        : sourcesEnabled;
      const prefsEffective = { ...prefs, sourcesEnabled: sourcesEnabledEffective };

      // --- Source breakdown (range) ---
      const tSessionsBySource0 = Date.now();
      const rangeSourceKeyExpr = effectiveSourceKeySql('sessions');
      const sessionsBySourceRows = await db.all(
        `
          SELECT ${rangeSourceKeyExpr} AS key, COUNT(*) AS sessions
          FROM sessions
          WHERE started_at >= ? AND started_at < ?
            AND traffic_source_key IS NOT NULL AND TRIM(traffic_source_key) != ''
            ${humanOnlyClause('sessions')}
          GROUP BY key
        `,
        [bounds.start, bounds.end]
      );
      const sessionsBySource = new Map();
      for (const r of sessionsBySourceRows || []) {
        const k = r && r.key != null ? String(r.key).trim().toLowerCase() : '';
        if (!k) continue;
        sessionsBySource.set(k, Number(r.sessions) || 0);
      }
      msSessionsBySource = Date.now() - tSessionsBySource0;

      const tSalesBySource0 = Date.now();
      let salesBySource = new Map();
      let salesByPairTruth = new Map(); // pair_key ("device|platform") -> { orders, revenueGbp }
      if (shop) {
        // Keep truth cache warm for this range (throttled inside salesTruth).
        try { await salesTruth.ensureReconciled(shop, bounds.start, bounds.end, `traffic_${rangeKey}`); } catch (_) {}

        function safeJsonParse(str) {
          if (!str || typeof str !== 'string') return null;
          try { return JSON.parse(str); } catch (_) { return null; }
        }
        function parseTrafficTypeFromUaString(uaRaw) {
          const ua = typeof uaRaw === 'string' ? uaRaw.trim() : '';
          if (!ua) return { uaDeviceType: 'unknown', uaPlatform: 'other', uaModel: null };
          const s = ua.toLowerCase();
          const isIphone = /\biphone\b/.test(s) || /\bipod\b/.test(s);
          const isIpad = /\bipad\b/.test(s) || (/\bmacintosh\b/.test(s) && /\bmobile\b/.test(s) && !isIphone);
          const isAndroid = /\bandroid\b/.test(s);

          let uaDeviceType = 'desktop';
          if (isIpad || /\btablet\b/.test(s) || (isAndroid && !/\bmobile\b/.test(s))) uaDeviceType = 'tablet';
          else if (/\bmobi\b/.test(s) || isIphone || isAndroid) uaDeviceType = 'mobile';

          let uaPlatform = 'other';
          if (isIphone || isIpad || /\bipod\b/.test(s)) uaPlatform = 'ios';
          else if (isAndroid) uaPlatform = 'android';
          else if (/\bwindows\b/.test(s)) uaPlatform = 'windows';
          else if (/\bmacintosh\b|\bmac os\b|\bmac os x\b/.test(s)) uaPlatform = 'mac';
          else if (/\bcros\b/.test(s)) uaPlatform = 'chromeos';
          else if (/\blinux\b|\bubuntu\b|\bfedora\b/.test(s)) uaPlatform = 'linux';

          let uaModel = null;
          if (isIphone) uaModel = 'iphone';
          else if (isIpad) uaModel = 'ipad';

          return { uaDeviceType, uaPlatform, uaModel };
        }

        const ratesToGbp = await fx.getRatesToGbp();
        const orders = await db.all(
          `
            SELECT
              order_id,
              COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
              total_price AS total_price,
              raw_json
            FROM orders_shopify
            WHERE shop = ?
              AND created_at >= ? AND created_at < ?
              AND (test IS NULL OR test = 0)
              AND cancelled_at IS NULL
              AND financial_status = 'paid'
          `,
          [shop, bounds.start, bounds.end]
        );

        for (const o of orders || []) {
          const cur = fx.normalizeCurrency(o && o.currency) || 'GBP';
          const amtRaw = o && o.total_price != null ? Number(o.total_price) : 0;
          const amt = Number.isFinite(amtRaw) ? amtRaw : 0;
          const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
          const gbpAmt = typeof gbp === 'number' && Number.isFinite(gbp) ? gbp : 0;

          const raw = safeJsonParse(o && o.raw_json != null ? String(o.raw_json) : '') || null;
          const landingSite = raw ? (raw.landing_site ?? raw.landingSite ?? raw.landing_site_ref ?? raw.landingSiteRef ?? null) : null;
          const referringSite = raw ? (raw.referring_site ?? raw.referringSite ?? null) : null;
          const uaStr = raw ? (raw?.client_details?.user_agent ?? raw?.client_details?.userAgent ?? raw?.clientDetails?.userAgent ?? raw?.clientDetails?.user_agent ?? null) : null;

          // Source key from Shopify truth (landing/referrer) + our mapping rules.
          let sourceKey = 'direct';
          try {
            const derived = await store.deriveTrafficSourceKeyWithMaps({
              utmSource: null,
              utmMedium: null,
              utmCampaign: null,
              utmContent: null,
              referrer: referringSite != null ? String(referringSite) : null,
              entryUrl: landingSite != null ? String(landingSite) : null,
            });
            if (derived && derived.trafficSourceKey) sourceKey = String(derived.trafficSourceKey).trim().toLowerCase() || 'direct';
          } catch (_) {}

          const prev = salesBySource.get(sourceKey) || { orders: 0, revenueGbp: 0 };
          prev.orders += 1;
          prev.revenueGbp += gbpAmt;
          salesBySource.set(sourceKey, prev);

          // Device/platform from Shopify truth (client_details.user_agent).
          const tt = parseTrafficTypeFromUaString(uaStr);
          const device = (tt.uaDeviceType || 'unknown').trim().toLowerCase();
          const platform = (tt.uaPlatform || 'other').trim().toLowerCase();
          const pairKey = device + '|' + platform;
          const prevPair = salesByPairTruth.get(pairKey) || { orders: 0, revenueGbp: 0 };
          prevPair.orders += 1;
          prevPair.revenueGbp += gbpAmt;
          salesByPairTruth.set(pairKey, prevPair);
        }

        // Round revenue and normalize keys to lower-case for consistent lookups.
        const nextSource = new Map();
        for (const [k, v] of salesBySource.entries()) {
          const kk = String(k || '').trim().toLowerCase();
          if (!kk) continue;
          nextSource.set(kk, { orders: Number(v.orders) || 0, revenueGbp: Math.round((Number(v.revenueGbp) || 0) * 100) / 100 });
        }
        salesBySource = nextSource;
        const nextPair = new Map();
        for (const [k, v] of salesByPairTruth.entries()) {
          const kk = String(k || '').trim().toLowerCase();
          if (!kk) continue;
          nextPair.set(kk, { orders: Number(v.orders) || 0, revenueGbp: Math.round((Number(v.revenueGbp) || 0) * 100) / 100 });
        }
        salesByPairTruth = nextPair;
      }
      // Normalize keys to lower-case for consistent lookups.
      if (salesBySource && typeof salesBySource.entries === 'function') {
        const next = new Map();
        for (const [k, v] of salesBySource.entries()) {
          const kk = String(k || '').trim().toLowerCase();
          if (!kk) continue;
          next.set(kk, v);
        }
        salesBySource = next;
      }
      msSalesBySource = Date.now() - tSalesBySource0;

      const sourceRows = (prefsEffective.sourcesEnabled || []).map((key) => {
        const sessions = sessionsBySource.get(key) || 0;
        const sales = salesBySource.get(key) || { orders: 0, revenueGbp: 0 };
        const orders = Number(sales.orders) || 0;
        const revenueGbp = Number(sales.revenueGbp) || 0;
        return {
          key,
          label: labelForKey(key),
          icon_url: iconUrlForKey(key),
          sessions,
          orders,
          revenueGbp,
          conversionPct: conversionPct(orders, sessions),
        };
      });

      // --- Available Types (last 30d) ---
      const tAvailTypes0 = Date.now();
      const sessionsByDevice30 = await db.all(
        `
          SELECT ua_device_type AS key, COUNT(*) AS sessions, MAX(last_seen) AS last_seen
          FROM sessions
          WHERE last_seen >= ?
            AND ua_device_type IS NOT NULL AND TRIM(ua_device_type) != ''
            ${humanOnlyClause('sessions')}
          GROUP BY ua_device_type
        `,
        [since30d]
      );

      // Build an "available" list only for keys we actually have
      const availableTypes = [];
      function pushAvailType(typeKey, sessions, lastSeen) {
        if (!sessions || sessions <= 0) return;
        availableTypes.push({ key: typeKey, label: labelForTypeKey(typeKey), sessions, last_seen: toNum(lastSeen) });
      }
      const device30 = new Map((sessionsByDevice30 || []).map(r => [String(r.key || '').trim().toLowerCase(), r]));
      for (const k of ['desktop', 'mobile', 'tablet']) {
        const r = device30.get(k);
        pushAvailType('device:' + k, Number(r?.sessions) || 0, r?.last_seen);
      }
      availableTypes.sort((a, b) => (b.sessions - a.sessions) || ((b.last_seen || 0) - (a.last_seen || 0)));
      msAvailTypes = Date.now() - tAvailTypes0;

      // --- Type breakdown (range): device -> platform ---
      const tSessionsByPair0 = Date.now();
      const sessionsByPairRows = await db.all(
        `
          SELECT
            COALESCE(NULLIF(TRIM(ua_device_type), ''), 'unknown') AS device,
            COALESCE(NULLIF(TRIM(ua_platform), ''), 'other') AS platform,
            COUNT(*) AS sessions
          FROM sessions
          WHERE started_at >= ? AND started_at < ?
            ${humanOnlyClause('sessions')}
          GROUP BY device, platform
        `,
        [bounds.start, bounds.end]
      );
      const sessionsByPair = new Map(); // "device|platform" -> sessions
      const platformsByDevice = new Map(); // device -> Set(platform)
      for (const r of sessionsByPairRows || []) {
        const device = r && r.device != null ? String(r.device).trim().toLowerCase() : '';
        const platform = r && r.platform != null ? String(r.platform).trim().toLowerCase() : '';
        if (!device || !platform) continue;
        const sessions = Number(r.sessions) || 0;
        sessionsByPair.set(device + '|' + platform, sessions);
        if (!platformsByDevice.has(device)) platformsByDevice.set(device, new Set());
        platformsByDevice.get(device).add(platform);
      }
      msSessionsByPair = Date.now() - tSessionsByPair0;

      // --- Type breakdown (range): sales ---
      const tSalesByPair0 = Date.now();
      let salesByPair = new Map();
      // Truth-only sales by type is computed from orders_shopify above (salesByPairTruth) so it cannot exceed Shopify.
      if (shop && salesByPairTruth && typeof salesByPairTruth.entries === 'function') {
        salesByPair = salesByPairTruth;
      }
      msSalesByPair = Date.now() - tSalesByPair0;

      const tBuild0 = Date.now();
      const platformOrder = {
        desktop: ['windows', 'mac', 'linux', 'chromeos', 'other'],
        mobile: ['ios', 'android', 'other'],
        tablet: ['ios', 'android', 'other'],
      };
      const enabledDevices = (prefs.typesEnabled || [])
        .map((k) => (String(k || '').toLowerCase().startsWith('device:') ? String(k).toLowerCase().slice('device:'.length) : ''))
        .filter((d) => ALLOWED_DEVICES.has(d));

      const typeRows = enabledDevices.map((device) => {
        const base = platformOrder[device] ? platformOrder[device].slice() : ['other'];
        const extras = Array.from(platformsByDevice.get(device) || [])
          .map((p) => String(p || '').trim().toLowerCase())
          .filter((p) => p && base.indexOf(p) === -1);
        extras.sort();
        const platforms = base.concat(extras);

        const children = platforms.map((platform) => {
          const pairKey = device + '|' + platform;
          const sessions = sessionsByPair.get(pairKey) || 0;
          const sales = salesByPair.get(pairKey) || { orders: 0, revenueGbp: 0 };
          const orders = Number(sales.orders) || 0;
          const revenueGbp = Number(sales.revenueGbp) || 0;
          return {
            key: 'platform:' + platform,
            platform,
            label: labelForTypeKey('platform:' + platform),
            sessions,
            orders,
            revenueGbp,
            conversionPct: conversionPct(orders, sessions),
          };
        });

        const totals = children.reduce(
          (acc, r) => {
            acc.sessions += Number(r.sessions) || 0;
            acc.orders += Number(r.orders) || 0;
            acc.revenueGbp += Number(r.revenueGbp) || 0;
            return acc;
          },
          { sessions: 0, orders: 0, revenueGbp: 0 }
        );
        totals.revenueGbp = Math.round((Number(totals.revenueGbp) || 0) * 100) / 100;
        return {
          key: 'device:' + device,
          device,
          label: labelForTypeKey('device:' + device),
          sessions: totals.sessions,
          orders: totals.orders,
          revenueGbp: totals.revenueGbp,
          conversionPct: conversionPct(totals.orders, totals.sessions),
          children,
        };
      });
      msBuild = Date.now() - tBuild0;

      // --- Chart series (time trend) ---
      const bucketCfg = chooseTrafficSeriesBucket(bounds, rangeKey);
      const buckets = buildBucketStarts(bounds, bucketCfg.stepMs);
      let sourcesChart = { bucket: bucketCfg.bucket, stepMs: bucketCfg.stepMs, buckets, series: [] };
      let typesChart = { bucket: bucketCfg.bucket, stepMs: bucketCfg.stepMs, buckets, series: [] };
      try {
        if ((prefsEffective.sourcesEnabled || []).length && buckets.length) {
          const srcCounts = await fetchBucketedSessionCounts(db, {
            bounds,
            stepMs: bucketCfg.stepMs,
            keySql: rangeSourceKeyExpr,
            extraWhereSql: "sessions.traffic_source_key IS NOT NULL AND TRIM(sessions.traffic_source_key) != ''",
          });
          sourcesChart.series = buildTopSessionSeries({
            buckets,
            rows: srcCounts,
            allowedKeys: prefsEffective.sourcesEnabled,
            labelForKey,
            maxSeries: 5,
          });
        }
      } catch (_) {}
      try {
        if (enabledDevices.length && buckets.length) {
          const typeCounts = await fetchBucketedSessionCounts(db, {
            bounds,
            stepMs: bucketCfg.stepMs,
            keySql: "LOWER(COALESCE(NULLIF(TRIM(sessions.ua_device_type), ''), 'unknown'))",
          });
          typesChart.series = buildTopSessionSeries({
            buckets,
            rows: typeCounts,
            allowedKeys: enabledDevices,
            labelForKey: (device) => labelForTypeKey('device:' + String(device || '').trim().toLowerCase()),
            maxSeries: 5,
          });
        }
      } catch (_) {}

      const t1 = Date.now();
      const totalMs = t1 - t0;
      if (req.query && (req.query.timing === '1' || totalMs > 1500)) {
        console.log(
          '[traffic] range=%s ms_total=%s ms_availSources=%s ms_sessionsBySource=%s ms_salesBySource=%s ms_availTypes=%s ms_sessionsByPair=%s ms_salesByPair=%s ms_build=%s',
          rangeKey,
          totalMs,
          msAvailSources,
          msSessionsBySource,
          msSalesBySource,
          msAvailTypes,
          msSessionsByPair,
          msSalesByPair,
          msBuild
        );
      }

      return {
        now,
        timeZone,
        range: { key: rangeKey, start: bounds.start, end: bounds.end },
        reporting,
        prefs: prefsEffective,
        sources: {
          enabled: prefsEffective.sourcesEnabled,
          available: availableSourcesMerged,
          rows: sourceRows,
          chart: sourcesChart,
        },
        types: {
          enabled: prefs.typesEnabled,
          available: availableTypes,
          rows: typeRows,
          chart: typesChart,
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
    sources: { enabled: prefs.sourcesEnabled, available: [], rows: [], chart: { bucket: 'day', stepMs: DAY_MS, buckets: [], series: [] } },
    types: { enabled: prefs.typesEnabled, available: [], rows: [], chart: { bucket: 'day', stepMs: DAY_MS, buckets: [], series: [] } },
  });
}

async function setTrafficPrefs(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const nextSources = body.sourcesEnabled != null ? body.sourcesEnabled : null;
  const nextTypes = body.typesEnabled != null ? body.typesEnabled : null;
  if (nextSources == null && nextTypes == null) {
    return res.status(400).json({ error: 'Missing sourcesEnabled or typesEnabled' });
  }
  try {
    await setPrefs({
      sourcesEnabled: nextSources == null ? null : nextSources,
      typesEnabled: nextTypes == null ? null : nextTypes,
    });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? String(e.message) : 'Failed to save' });
  }
  const prefs = await getPrefs();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, prefs });
}

module.exports = { getTraffic, setTrafficPrefs };

