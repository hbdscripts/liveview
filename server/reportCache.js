const crypto = require('crypto');
const { getDb, isPostgres } = require('./db');

let _tableOk = null; // null unknown, true exists, false missing

function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t !== 'object') return JSON.stringify(String(value));
  if (Array.isArray(value)) return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') +
    '}'
  );
}

function hashParams(params) {
  const s = stableStringify(params || {});
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 32);
}

async function tableOk() {
  if (_tableOk === true) return true;
  if (_tableOk === false) return false;
  try {
    await getDb().get('SELECT 1 FROM report_cache LIMIT 1');
    _tableOk = true;
    return true;
  } catch (_) {
    _tableOk = false;
    return false;
  }
}

function normalizeKeyPart(v) {
  return (v == null ? '' : String(v)).trim().toLowerCase();
}

function buildCacheKey({ shop, endpoint, rangeKey, rangeStartTs, paramsHash: ph } = {}) {
  const s = normalizeKeyPart(shop);
  const e = normalizeKeyPart(endpoint);
  const r = normalizeKeyPart(rangeKey);
  const start = Number(rangeStartTs);
  const startKey = Number.isFinite(start) ? String(Math.trunc(start)) : '';
  const h = normalizeKeyPart(ph);
  return [s, e, r, startKey, h].join('|');
}

async function getOrComputeJson(
  {
    shop,
    endpoint,
    rangeKey,
    rangeStartTs,
    rangeEndTs,
    params,
    ttlMs = 10 * 60 * 1000,
    force = false,
  } = {},
  computeFn
) {
  const now = Date.now();
  const ttl = Math.max(5 * 1000, Math.min(60 * 60 * 1000, Number(ttlMs) || 0));
  const sShop = normalizeKeyPart(shop);
  const sEndpoint = normalizeKeyPart(endpoint);
  const sRange = normalizeKeyPart(rangeKey);
  const start = Number(rangeStartTs);
  const end = Number(rangeEndTs);
  const ph = hashParams(params || {});
  const key = buildCacheKey({ shop: sShop, endpoint: sEndpoint, rangeKey: sRange, rangeStartTs: start, paramsHash: ph });

  if (!force && (await tableOk())) {
    try {
      const row = await getDb().get('SELECT json, computed_at, ttl_ms FROM report_cache WHERE cache_key = ?', [key]);
      const computedAt = row && row.computed_at != null ? Number(row.computed_at) : null;
      const ttlStored = row && row.ttl_ms != null ? Number(row.ttl_ms) : null;
      const fresh =
        computedAt != null &&
        Number.isFinite(computedAt) &&
        ttlStored != null &&
        Number.isFinite(ttlStored) &&
        (now - computedAt) >= 0 &&
        (now - computedAt) < ttlStored;
      if (fresh && row && typeof row.json === 'string') {
        try {
          return { ok: true, cacheHit: true, data: JSON.parse(row.json) };
        } catch (_) {
          // treat as cache miss
        }
      }
    } catch (_) {
      // fail-open: compute
    }
  }

  const data = await computeFn();

  if (await tableOk()) {
    try {
      const json = JSON.stringify(data ?? null);
      await getDb().run(
        `
        INSERT INTO report_cache
          (cache_key, shop, endpoint, range_key, range_start_ts, range_end_ts, params_hash, computed_at, ttl_ms, json)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (cache_key) DO UPDATE SET
          shop = EXCLUDED.shop,
          endpoint = EXCLUDED.endpoint,
          range_key = EXCLUDED.range_key,
          range_start_ts = EXCLUDED.range_start_ts,
          range_end_ts = EXCLUDED.range_end_ts,
          params_hash = EXCLUDED.params_hash,
          computed_at = EXCLUDED.computed_at,
          ttl_ms = EXCLUDED.ttl_ms,
          json = EXCLUDED.json
        `,
        [
          key,
          sShop,
          sEndpoint,
          sRange,
          Number.isFinite(start) ? Math.trunc(start) : 0,
          Number.isFinite(end) ? Math.trunc(end) : 0,
          ph,
          now,
          Math.trunc(ttl),
          json,
        ]
      );
    } catch (_) {
      // fail-open
    }
  }

  return { ok: true, cacheHit: false, data };
}

const DASHBOARD_SERIES_ENDPOINT = 'dashboard-series';

async function invalidateDashboardSeries() {
  if (!(await tableOk())) return;
  try {
    const db = getDb();
    if (isPostgres()) {
      await db.run(`DELETE FROM report_cache WHERE endpoint = $1`, [DASHBOARD_SERIES_ENDPOINT]);
    } else {
      await db.run(`DELETE FROM report_cache WHERE endpoint = ?`, [DASHBOARD_SERIES_ENDPOINT]);
    }
  } catch (_) {
    // fail-open: cache invalidation is best-effort
  }
}

module.exports = {
  stableStringify,
  hashParams,
  buildCacheKey,
  getOrComputeJson,
  invalidateDashboardSeries,
};

