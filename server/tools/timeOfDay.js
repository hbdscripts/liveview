/**
 * Time of Day tool: sessions and orders by hour (admin timezone), optional country filter.
 * Output: Hour (0–23), Sessions, Orders, CR%.
 */

const store = require('../store');
const { getDb, isPostgres } = require('../db');
const salesTruth = require('../salesTruth');

function safeStr(v, maxLen = 64) {
  if (v == null) return '';
  const s = String(v).trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function parseYmd(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

function normalizeCountry(code) {
  const c = code != null ? String(code).trim().toUpperCase().slice(0, 2) : '';
  if (!c) return '';
  if (c === 'UK') return 'GB';
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return c;
}

function hourInTimezone(ms, timeZone) {
  if (ms == null || !Number.isFinite(Number(ms))) return null;
  try {
    const str = new Date(Number(ms)).toLocaleString('en-CA', { timeZone, hour: '2-digit', hour12: false });
    const h = parseInt(str, 10);
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h : null;
  } catch (_) {
    return null;
  }
}

/**
 * @param {{ shop?: string, countryCode?: string, startYmd: string, endYmd: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string, rows?: Array<{ hour: number, sessions: number, orders: number, cr: number | null }> }>}
 */
async function getTimeOfDay({ shop, countryCode, startYmd, endYmd } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return { ok: false, error: 'missing_shop' };

  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  if (!start || !end) return { ok: false, error: 'invalid_dates' };
  if (start > end) return { ok: false, error: 'invalid_dates' };

  const tz = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const rangeKey = `r:${start}:${end}`;
  const bounds = store.getRangeBounds(rangeKey, nowMs, tz);
  const startMs = bounds && Number.isFinite(bounds.start) ? Number(bounds.start) : null;
  const endMs = bounds && Number.isFinite(bounds.end) ? Number(bounds.end) : null;
  if (startMs == null || endMs == null || !(endMs > startMs)) {
    return { ok: false, error: 'empty_range' };
  }

  const country = normalizeCountry(countryCode);
  const db = getDb();
  const pg = isPostgres();

  const sessionFilter = '(cf_known_bot = 0 OR cf_known_bot IS NULL)';
  const countryFilter = country ? (pg ? " AND country_code = $3" : " AND country_code = ?") : '';
  const sessionParams = country ? [startMs, endMs, country] : [startMs, endMs];
  const sessionSql = pg
    ? `SELECT started_at FROM sessions WHERE started_at >= $1 AND started_at < $2 AND ${sessionFilter}${countryFilter}`
    : `SELECT started_at FROM sessions WHERE started_at >= ? AND started_at < ? AND ${sessionFilter}${countryFilter}`;

  let sessionRows = [];
  try {
    sessionRows = await db.all(sessionSql, sessionParams);
  } catch (err) {
    return { ok: false, error: 'sessions_query_failed' };
  }

  const orderSql = pg
    ? `SELECT created_at FROM orders_shopify WHERE shop = $1 AND created_at >= $2 AND created_at < $3 AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
    : `SELECT created_at FROM orders_shopify WHERE shop = ? AND created_at >= ? AND created_at < ? AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`;
  const orderParams = [safeShop, startMs, endMs];

  let orderRows = [];
  try {
    orderRows = await db.all(orderSql, orderParams);
  } catch (err) {
    return { ok: false, error: 'orders_query_failed' };
  }

  const sessionsByHour = Array(24).fill(0);
  const ordersByHour = Array(24).fill(0);

  for (const r of sessionRows || []) {
    const ms = r && r.started_at != null ? Number(r.started_at) : null;
    const h = hourInTimezone(ms, tz);
    if (h != null) sessionsByHour[h]++;
  }
  for (const r of orderRows || []) {
    const ms = r && r.created_at != null ? Number(r.created_at) : null;
    const h = hourInTimezone(ms, tz);
    if (h != null) ordersByHour[h]++;
  }

  const rows = [];
  for (let h = 0; h < 24; h++) {
    const sessions = sessionsByHour[h] || 0;
    const orders = ordersByHour[h] || 0;
    const cr = sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null;
    rows.push({ hour: h, sessions, orders, cr });
  }

  return { ok: true, rows };
}

module.exports = {
  getTimeOfDay,
};
