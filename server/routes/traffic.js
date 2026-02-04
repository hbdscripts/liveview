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

const SOURCE_LABELS = {
  google_organic: 'Google Organic',
  google_ads: 'Google Ads',
  bing_organic: 'Bing Organic',
  bing_ads: 'Bing Ads',
  facebook_organic: 'Facebook Organic',
  facebook_ads: 'Facebook Ads',
  omnisend: 'Omnisend',
  direct: 'Direct visitor',
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

async function getPrefs() {
  const rawSources = await store.getSetting('traffic_sources_enabled');
  const rawTypes = await store.getSetting('traffic_types_enabled');
  const sources = sanitizeKeyList(safeJsonParse(rawSources) || []);
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
  return { sourcesEnabled: sources, typesEnabled: types };
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
  const rangeKeyRaw = typeof req.query.range === 'string' ? req.query.range : '';
  const allowedRange = new Set(['today', 'yesterday', '3d', '7d']);
  const rangeKey = allowedRange.has(rangeKeyRaw) ? rangeKeyRaw : 'today';
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  const db = getDb();
  const prefs = await getPrefs();

  // --- Available Sources (last 30d) ---
  const since30d = now - 30 * 24 * 60 * 60 * 1000;
  const availableSources = await db.all(
    `
      SELECT traffic_source_key AS key, COUNT(*) AS sessions, MAX(last_seen) AS last_seen
      FROM sessions
      WHERE last_seen >= ?
        AND traffic_source_key IS NOT NULL AND TRIM(traffic_source_key) != ''
        ${humanOnlyClause('sessions')}
      GROUP BY traffic_source_key
      ORDER BY sessions DESC
    `,
    [since30d]
  );

  // --- Source breakdown (range) ---
  const sessionsBySourceRows = await db.all(
    `
      SELECT traffic_source_key AS key, COUNT(*) AS sessions
      FROM sessions
      WHERE started_at >= ? AND started_at < ?
        AND traffic_source_key IS NOT NULL AND TRIM(traffic_source_key) != ''
        ${humanOnlyClause('sessions')}
      GROUP BY traffic_source_key
    `,
    [bounds.start, bounds.end]
  );
  const sessionsBySource = new Map();
  for (const r of sessionsBySourceRows || []) {
    const k = r && r.key != null ? String(r.key).trim() : '';
    if (!k) continue;
    sessionsBySource.set(k, Number(r.sessions) || 0);
  }

  const shop = salesTruth.resolveShopForSales('');
  let salesBySource = new Map();
  if (shop) {
    const salesRows = await db.all(
      `
        SELECT traffic_source_key, currency, COUNT(*) AS orders, COALESCE(SUM(revenue), 0) AS revenue
        FROM (
          SELECT DISTINCT
            s.traffic_source_key AS traffic_source_key,
            COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency,
            o.order_id AS order_id,
            o.total_price AS revenue
          FROM purchase_events pe
          INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
          INNER JOIN sessions s ON s.session_id = pe.session_id
          WHERE pe.shop = ?
            AND pe.event_type = 'checkout_completed'
            AND o.created_at >= ? AND o.created_at < ?
            AND s.traffic_source_key IS NOT NULL AND TRIM(s.traffic_source_key) != ''
            ${humanOnlyClause('s')}
            AND (o.test IS NULL OR o.test = 0)
            AND o.cancelled_at IS NULL
            AND o.financial_status = 'paid'
        ) t
        GROUP BY traffic_source_key, currency
      `,
      [shop, bounds.start, bounds.end]
    );
    salesBySource = await aggCurrencyRowsToGbp(salesRows, { keyField: 'traffic_source_key' });
  }

  const sourceRows = (prefs.sourcesEnabled || []).map((key) => {
    const sessions = sessionsBySource.get(key) || 0;
    const sales = salesBySource.get(key) || { orders: 0, revenueGbp: 0 };
    const orders = Number(sales.orders) || 0;
    const revenueGbp = Number(sales.revenueGbp) || 0;
    return {
      key,
      label: labelForSourceKey(key),
      sessions,
      orders,
      revenueGbp,
      conversionPct: conversionPct(orders, sessions),
    };
  });

  // --- Available Types (last 30d) ---
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

  // --- Type breakdown (range): device -> platform ---
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

  // --- Type breakdown (range): sales ---
  let salesByPair = new Map();
  if (shop) {
    const salesPairRows = await db.all(
      `
        SELECT pair_key, currency, COUNT(*) AS orders, COALESCE(SUM(revenue), 0) AS revenue
        FROM (
          SELECT DISTINCT
            (
              COALESCE(NULLIF(TRIM(s.ua_device_type), ''), 'unknown')
              || '|' ||
              COALESCE(NULLIF(TRIM(s.ua_platform), ''), 'other')
            ) AS pair_key,
            COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency,
            o.order_id AS order_id,
            o.total_price AS revenue
          FROM purchase_events pe
          INNER JOIN orders_shopify o ON o.shop = pe.shop AND o.order_id = pe.linked_order_id
          INNER JOIN sessions s ON s.session_id = pe.session_id
          WHERE pe.shop = ?
            AND pe.event_type = 'checkout_completed'
            AND o.created_at >= ? AND o.created_at < ?
            ${humanOnlyClause('s')}
            AND (o.test IS NULL OR o.test = 0)
            AND o.cancelled_at IS NULL
            AND o.financial_status = 'paid'
        ) t
        GROUP BY pair_key, currency
      `,
      [shop, bounds.start, bounds.end]
    );
    salesByPair = await aggCurrencyRowsToGbp(salesPairRows, { keyField: 'pair_key' });
  }

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

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({
    now,
    timeZone,
    range: { key: rangeKey, start: bounds.start, end: bounds.end },
    prefs,
    sources: {
      enabled: prefs.sourcesEnabled,
      available: (availableSources || []).map((r) => ({
        key: String(r.key || '').trim().toLowerCase(),
        label: labelForSourceKey(r.key),
        sessions: Number(r.sessions) || 0,
        last_seen: toNum(r.last_seen),
      })),
      rows: sourceRows,
    },
    types: {
      enabled: prefs.typesEnabled,
      available: availableTypes,
      rows: typeRows,
    },
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

