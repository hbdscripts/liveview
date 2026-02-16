/**
 * Devices/UA observed counts.
 *
 * Used by Settings → Theme → Icons to show “Detected Devices” when a device/platform
 * has been observed more than N times (N defaults to 2).
 *
 * Definition: one “click” = one session (first event KEXO knows about).
 */
const { getDb } = require('../db');
const Sentry = require('@sentry/node');
const store = require('../store');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');

function clampInt(v, { min, max, fallback }) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeKey(v, { fallback = 'unknown', maxLen = 32 } = {}) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeCount(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

const OBSERVED_DEVICES_LIMIT_DEFAULT = 500;
const OBSERVED_DEVICES_LIMIT_MAX = 2000;

async function getObservedDevices(req, res) {
  const minClicks = clampInt(req && req.query ? req.query.minClicks : null, { min: 1, max: 1000000, fallback: 2 });
  const includeUnknown = !!(req && req.query && (req.query.includeUnknown === '1' || req.query.includeUnknown === 'true'));
  const limit = clampInt(req && req.query && req.query.limit != null ? req.query.limit : OBSERVED_DEVICES_LIMIT_DEFAULT, { min: 1, max: OBSERVED_DEVICES_LIMIT_MAX, fallback: OBSERVED_DEVICES_LIMIT_DEFAULT });

  const db = getDb();
  try {
    const deviceRows = await db.all(
      `
        SELECT COALESCE(ua_device_type, 'unknown') AS k, COUNT(*) AS n
        FROM sessions
        GROUP BY COALESCE(ua_device_type, 'unknown')
        ORDER BY n DESC
      `
    );
    const platformRows = await db.all(
      `
        SELECT COALESCE(ua_platform, 'other') AS k, COUNT(*) AS n
        FROM sessions
        GROUP BY COALESCE(ua_platform, 'other')
        ORDER BY n DESC
      `
    );
    const modelRows = await db.all(
      `
        SELECT COALESCE(ua_model, 'unknown') AS k, COUNT(*) AS n
        FROM sessions
        GROUP BY COALESCE(ua_model, 'unknown')
        ORDER BY n DESC
      `
    );

    function mapRows(rows) {
      const out = [];
      (rows || []).forEach((r) => {
        const key = normalizeKey(r && r.k != null ? String(r.k) : '', {});
        const clicks = normalizeCount(r && r.n != null ? r.n : 0);
        if (!includeUnknown && key === 'unknown') return;
        if (clicks < minClicks) return;
        out.push({ key, clicks });
      });
      return out.slice(0, limit);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.json({
      ok: true,
      generatedAt: Date.now(),
      minClicks,
      includeUnknown,
      ua_device_type: mapRows(deviceRows),
      ua_platform: mapRows(platformRows),
      ua_model: mapRows(modelRows),
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'devices.observed' } });
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
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

async function aggCurrencyRowsToGbp(rows) {
  const ratesToGbp = await fx.getRatesToGbp();
  const map = new Map(); // device_key -> { orders, revenueGbp }
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r && r.device_key != null ? String(r.device_key).trim().toLowerCase() : '';
    if (!key) continue;
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

function splitDeviceKey(deviceKey) {
  const raw = typeof deviceKey === 'string' ? deviceKey.trim().toLowerCase() : '';
  const parts = raw.split(':');
  const deviceType = parts[0] ? parts[0].trim() : 'unknown';
  const platform = parts[1] ? parts[1].trim() : 'other';
  return {
    device_type: deviceType || 'unknown',
    platform: platform || 'other',
  };
}

async function getDevicesReport(req, res) {
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const rangeKey = normalizeRangeKey(req.query.range, { defaultKey: 'today' });
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);
  const force = !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const db = getDb();
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  const shop = salesTruth.resolveShopForSales('');

  const cached = await reportCache.getOrComputeJson(
    {
      shop: shop || '',
      endpoint: 'devices',
      rangeKey,
      rangeStartTs: bounds.start,
      rangeEndTs: bounds.end,
      params: { reporting },
      ttlMs: 5 * 60 * 1000,
      force,
    },
    async () => {
      const sessionRows = await db.all(
        `
          SELECT
            LOWER(
              COALESCE(
                NULLIF(TRIM(device_key), ''),
                (
                  LOWER(COALESCE(NULLIF(TRIM(ua_device_type), ''), 'unknown')) ||
                  ':' ||
                  LOWER(COALESCE(NULLIF(TRIM(ua_platform), ''), 'other'))
                )
              )
            ) AS device_key,
            COUNT(*) AS sessions
          FROM sessions
          WHERE started_at >= ? AND started_at < ?
            AND (cf_known_bot IS NULL OR cf_known_bot = 0)
          GROUP BY
            LOWER(
              COALESCE(
                NULLIF(TRIM(device_key), ''),
                (
                  LOWER(COALESCE(NULLIF(TRIM(ua_device_type), ''), 'unknown')) ||
                  ':' ||
                  LOWER(COALESCE(NULLIF(TRIM(ua_platform), ''), 'other'))
                )
              )
            )
          ORDER BY sessions DESC
        `,
        [bounds.start, bounds.end]
      );

      const orderRows = await db.all(
        `
          SELECT
            LOWER(COALESCE(NULLIF(TRIM(device_key), ''), 'unknown:other')) AS device_key,
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
            LOWER(COALESCE(NULLIF(TRIM(device_key), ''), 'unknown:other')),
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
        `,
        [shop, bounds.start, bounds.end]
      );

      const sessionsByKey = new Map();
      for (const r of Array.isArray(sessionRows) ? sessionRows : []) {
        const key = r && r.device_key != null ? String(r.device_key).trim().toLowerCase() : '';
        if (!key) continue;
        const n = r && r.sessions != null ? Number(r.sessions) : 0;
        sessionsByKey.set(key, (sessionsByKey.get(key) || 0) + (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0));
      }

      const salesByKey = await aggCurrencyRowsToGbp(orderRows);

      const deviceAgg = new Map(); // device_type -> agg
      const platformAgg = new Map(); // device_type|platform -> agg

      function ensureAgg(map, key) {
        const prev = map.get(key);
        if (prev) return prev;
        const next = { sessions: 0, orders: 0, revenueGbp: 0 };
        map.set(key, next);
        return next;
      }

      for (const [deviceKey, sessions] of sessionsByKey.entries()) {
        const parts = splitDeviceKey(deviceKey);
        const dKey = parts.device_type;
        const pKey = parts.platform;
        ensureAgg(deviceAgg, dKey).sessions += sessions;
        ensureAgg(platformAgg, `${dKey}|${pKey}`).sessions += sessions;
      }
      for (const [deviceKey, sales] of salesByKey.entries()) {
        const parts = splitDeviceKey(deviceKey);
        const dKey = parts.device_type;
        const pKey = parts.platform;
        ensureAgg(deviceAgg, dKey).orders += Number(sales.orders) || 0;
        ensureAgg(deviceAgg, dKey).revenueGbp += Number(sales.revenueGbp) || 0;
        ensureAgg(platformAgg, `${dKey}|${pKey}`).orders += Number(sales.orders) || 0;
        ensureAgg(platformAgg, `${dKey}|${pKey}`).revenueGbp += Number(sales.revenueGbp) || 0;
      }

      const devices = [];
      const deviceKeys = Array.from(deviceAgg.keys());
      deviceKeys.sort((a, b) => (deviceAgg.get(b).sessions - deviceAgg.get(a).sessions) || String(a).localeCompare(String(b)));

      for (const deviceType of deviceKeys) {
        const dAgg = deviceAgg.get(deviceType) || { sessions: 0, orders: 0, revenueGbp: 0 };
        const platforms = [];
        const platformKeys = Array.from(platformAgg.keys())
          .filter((k) => k.split('|')[0] === deviceType)
          .sort((a, b) => (platformAgg.get(b).sessions - platformAgg.get(a).sessions) || String(a).localeCompare(String(b)));
        for (const k of platformKeys) {
          const [, platform] = k.split('|');
          const pAgg = platformAgg.get(k) || { sessions: 0, orders: 0, revenueGbp: 0 };
          const deviceKey = `${deviceType}:${platform}`;
          platforms.push({
            device_key: deviceKey,
            device_type: deviceType,
            platform,
            sessions: pAgg.sessions,
            orders: pAgg.orders,
            revenue_gbp: Math.round((Number(pAgg.revenueGbp) || 0) * 100) / 100,
            conversion_pct: conversionPct(pAgg.orders, pAgg.sessions),
            aov_gbp: aovGbp(pAgg.revenueGbp, pAgg.orders),
          });
        }
        devices.push({
          device_type: deviceType,
          sessions: dAgg.sessions,
          orders: dAgg.orders,
          revenue_gbp: Math.round((Number(dAgg.revenueGbp) || 0) * 100) / 100,
          conversion_pct: conversionPct(dAgg.orders, dAgg.sessions),
          aov_gbp: aovGbp(dAgg.revenueGbp, dAgg.orders),
          platforms,
        });
      }

      return {
        now,
        timeZone,
        range: { key: rangeKey, start: bounds.start, end: bounds.end },
        reporting,
        devices: {
          rows: devices,
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
    devices: { rows: [], chart: { bucket: 'day', stepMs: 24 * 60 * 60 * 1000, buckets: [], series: [] } },
  });
}

module.exports = {
  getObservedDevices,
  getDevicesReport,
};

