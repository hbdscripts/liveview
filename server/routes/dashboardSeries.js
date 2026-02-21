/**
 * GET /api/dashboard-series?days=7|14|30|90
 * Returns daily time-series data for the dashboard overview charts.
 * Each day includes: revenue, orders, sessions, convRate, aov, bounceRate.
 */
const Sentry = require('@sentry/node');
const { getDb } = require('../db');
const config = require('../config');
const store = require('../store');
const { percentOrNull, ratioOrNull } = require('../metrics');
const salesTruth = require('../salesTruth');
const fx = require('../fx');
const reportCache = require('../reportCache');
const productMetaCache = require('../shopifyProductMetaCache');
const { warnOnReject } = require('../shared/warnReject');

const DASHBOARD_TOP_TABLE_MAX_ROWS = 5;
const DASHBOARD_TRENDING_MAX_ROWS = 5;

let _lineItemsHasLineNet = null; // null unknown, true exists, false missing
let _lineItemsHasLineNetInFlight = null;
async function lineItemsHasLineNet(db) {
  if (_lineItemsHasLineNet === true) return true;
  if (_lineItemsHasLineNet === false) return false;
  if (_lineItemsHasLineNetInFlight) return _lineItemsHasLineNetInFlight;

  _lineItemsHasLineNetInFlight = Promise.resolve()
    .then(() => db.get('SELECT line_net FROM orders_shopify_line_items LIMIT 1'))
    .then(() => {
      _lineItemsHasLineNet = true;
      return true;
    })
    .catch((err) => {
      const msg = String(err && err.message ? err.message : err);
      // Postgres: column "line_net" does not exist
      // SQLite: no such column: line_net
      if (/line_net/i.test(msg) && /(does not exist|no such column|has no column)/i.test(msg)) {
        _lineItemsHasLineNet = false;
        return false;
      }
      throw err;
    })
    .finally(() => {
      _lineItemsHasLineNetInFlight = null;
    });

  return _lineItemsHasLineNetInFlight;
}

let _lineItemsHasOrderProcessedAt = null; // null unknown, true exists, false missing
let _lineItemsHasOrderProcessedAtInFlight = null;
async function lineItemsHasOrderProcessedAt(db) {
  if (_lineItemsHasOrderProcessedAt === true) return true;
  if (_lineItemsHasOrderProcessedAt === false) return false;
  if (_lineItemsHasOrderProcessedAtInFlight) return _lineItemsHasOrderProcessedAtInFlight;

  _lineItemsHasOrderProcessedAtInFlight = Promise.resolve()
    .then(() => db.get('SELECT order_processed_at FROM orders_shopify_line_items LIMIT 1'))
    .then(() => {
      _lineItemsHasOrderProcessedAt = true;
      return true;
    })
    .catch((err) => {
      const msg = String(err && err.message ? err.message : err);
      // Postgres: column "order_processed_at" does not exist
      // SQLite: no such column: order_processed_at
      if (/order_processed_at/i.test(msg) && /(does not exist|no such column|has no column)/i.test(msg)) {
        _lineItemsHasOrderProcessedAt = false;
        return false;
      }
      throw err;
    })
    .finally(() => {
      _lineItemsHasOrderProcessedAtInFlight = null;
    });

  return _lineItemsHasOrderProcessedAtInFlight;
}

// Best-effort truth warmup. Must never block the request path.
let _truthNudgeLastAt = 0;
let _truthNudgeInFlight = false;
function nudgeTruthWarmupDetached(shop, startMs, endMs, scopeKey) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  if (!safeShop) return;
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return;
  const now = Date.now();
  // Throttle: avoid hammering reconcile_state + Shopify API on frequent dashboard polling.
  if ((now - (_truthNudgeLastAt || 0)) < 2 * 60 * 1000) return;
  if (_truthNudgeInFlight) return;
  _truthNudgeLastAt = now;
  _truthNudgeInFlight = true;
  const refundsScope = 'refunds_' + (scopeKey || 'today');
  try {
    if (typeof setImmediate === 'function') {
      setImmediate(() => {
        salesTruth
          .ensureReconciled(safeShop, start, end, scopeKey || 'today')
          .catch(warnOnReject('[dashboardSeries] ensureReconciled'));
        salesTruth
          .ensureRefundsSynced(safeShop, start, end, refundsScope)
          .catch(warnOnReject('[dashboardSeries] ensureRefundsSynced'))
          .finally(() => { _truthNudgeInFlight = false; });
      });
      return;
    }
  } catch (_) {}
  salesTruth
    .ensureReconciled(safeShop, start, end, scopeKey || 'today')
    .catch(warnOnReject('[dashboardSeries] ensureReconciled'));
  salesTruth
    .ensureRefundsSynced(safeShop, start, end, refundsScope)
    .catch(warnOnReject('[dashboardSeries] ensureRefundsSynced'))
    .finally(() => { _truthNudgeInFlight = false; });
}

function sessionFilterForTraffic(trafficMode) {
  if (trafficMode === 'human_only') {
    return config.dbUrl
      ? { sql: ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)', params: [] }
      : { sql: ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)', params: [] };
  }
  return { sql: '', params: [] };
}

function normalizeHandleKey(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toLowerCase();
  return s ? s.slice(0, 128) : '';
}

function handleFromPath(path) {
  if (typeof path !== 'string') return '';
  const m = path.match(/^\/products\/([^/?#]+)/i);
  return m ? normalizeHandleKey(m[1]) : '';
}

function handleFromUrl(url) {
  if (typeof url !== 'string') return '';
  const raw = url.trim();
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
    normalizeHandleKey(row && row.first_product_handle) ||
    handleFromUrl(row && row.entry_url) ||
    ''
  );
}

function normalizeCountryKey(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim().toUpperCase();
  return s ? s.slice(0, 2) : '';
}

function uniqueNonEmpty(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const s = raw != null ? String(raw) : '';
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

async function inferSingleShopFromTable(db, tableName, orderByColumn) {
  try {
    const rows = await db.all(
      `
        SELECT LOWER(TRIM(shop)) AS shop, MAX(${orderByColumn}) AS last_seen
        FROM ${tableName}
        WHERE shop IS NOT NULL AND TRIM(shop) != ''
        GROUP BY LOWER(TRIM(shop))
        ORDER BY last_seen DESC
        LIMIT 2
      `
    );
    if (Array.isArray(rows) && rows.length === 1 && rows[0] && rows[0].shop) {
      return String(rows[0].shop).trim().toLowerCase();
    }
  } catch (_) {}
  return '';
}

async function resolveDashboardShop(db) {
  const configured = salesTruth.resolveShopForSales('');
  if (configured) return configured;

  // Fail-open fallback: if env shop vars are unset, infer shop only when a single
  // unambiguous shop exists in persisted auth/orders tables.
  const fromSessions = await inferSingleShopFromTable(db, 'shop_sessions', 'updated_at');
  if (fromSessions) return fromSessions;

  const fromOrders = await inferSingleShopFromTable(db, 'orders_shopify', 'created_at');
  if (fromOrders) return fromOrders;

  return '';
}

function inPlaceholders(count, startIndex) {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (!n) return '';
  if (config.dbUrl) {
    const base = Math.max(1, Math.trunc(Number(startIndex) || 1));
    const parts = [];
    for (let i = 0; i < n; i++) parts.push('$' + (base + i));
    return parts.join(', ');
  }
  return new Array(n).fill('?').join(', ');
}

function crPct(orders, sessions) {
  return percentOrNull(orders, sessions, { decimals: 1 });
}

function isReturningOrderRow(row) {
  if (!row || typeof row !== 'object') return false;
  const coc = row.customer_orders_count != null ? Number(row.customer_orders_count) : NaN;
  if (Number.isFinite(coc)) return coc > 1;
  const createdAt = row.created_at != null ? Number(row.created_at) : NaN;
  const firstPaidOrderAt = row.first_paid_order_at != null ? Number(row.first_paid_order_at) : NaN;
  return Number.isFinite(createdAt) && Number.isFinite(firstPaidOrderAt) && firstPaidOrderAt < createdAt;
}

/** Returns { [dayLabel]: amountGbp } for refunds in range, bucketed by attribution (processing_date → refund_created_at, original_sale_date → order_processed_at). */
async function fetchRefundsPerDay(db, shop, dayBounds, overallStart, overallEnd, attribution, ratesToGbp) {
  const out = {};
  for (const d of dayBounds) out[d.label] = 0;
  if (!shop || !dayBounds.length) return out;
  const useSaleDate = attribution === 'original_sale_date';
  const tsCol = useSaleDate ? 'order_processed_at' : 'refund_created_at';
  let rows = [];
  try {
    const sql = config.dbUrl
      ? `SELECT ${tsCol} AS ts, currency, amount FROM orders_shopify_refunds WHERE shop = $1 AND ${tsCol} IS NOT NULL AND ${tsCol} >= $2 AND ${tsCol} < $3`
      : `SELECT ${tsCol} AS ts, currency, amount FROM orders_shopify_refunds WHERE shop = ? AND ${tsCol} IS NOT NULL AND ${tsCol} >= ? AND ${tsCol} < ?`;
    rows = await db.all(sql, [shop, overallStart, overallEnd]);
  } catch (_) {
    return out;
  }
  for (const r of rows || []) {
    const ts = Number(r.ts);
    if (!Number.isFinite(ts)) continue;
    let dayLabel = null;
    for (const db_day of dayBounds) {
      if (ts >= db_day.start && ts < db_day.end) {
        dayLabel = db_day.label;
        break;
      }
    }
    if (!dayLabel) continue;
    const amount = parseFloat(r.amount);
    const currency = (r.currency || 'GBP').toUpperCase();
    const gbp = Number.isFinite(amount) ? fx.convertToGbp(amount, currency, ratesToGbp) : 0;
    out[dayLabel] = (out[dayLabel] || 0) + gbp;
  }
  return out;
}

function parseReturnsRefundsAttributionFromKpiConfig(rawKpiConfig) {
  if (!rawKpiConfig || typeof rawKpiConfig !== 'string') return 'processing_date';
  try {
    const obj = JSON.parse(rawKpiConfig);
    const v = obj && obj.options && obj.options.general && obj.options.general.returnsRefundsAttribution;
    if (v === 'original_sale_date' || v === 'processing_date') return v;
  } catch (_) {}
  return 'processing_date';
}

async function fetchPaidOrderRowsWithReturningFacts(db, shop, startMs, endMs) {
  if (!shop) return [];
  // Bucket by processed_at (sale date); filter by processed_at when present else created_at for range.
  const withFactsSql = config.dbUrl
    ? `SELECT o.order_id, o.total_price, o.currency, o.created_at, o.processed_at, o.customer_orders_count, o.customer_id, f.first_paid_order_at
       FROM orders_shopify o
       LEFT JOIN customer_order_facts f ON f.shop = o.shop AND f.customer_id = o.customer_id
       WHERE o.shop = $1 AND (COALESCE(o.processed_at, o.created_at) >= $2 AND COALESCE(o.processed_at, o.created_at) < $3)
         AND (o.test IS NULL OR o.test = 0) AND o.cancelled_at IS NULL AND o.financial_status = 'paid'`
    : `SELECT o.order_id, o.total_price, o.currency, o.created_at, o.processed_at, o.customer_orders_count, o.customer_id, f.first_paid_order_at
       FROM orders_shopify o
       LEFT JOIN customer_order_facts f ON f.shop = o.shop AND f.customer_id = o.customer_id
       WHERE o.shop = ? AND (COALESCE(o.processed_at, o.created_at) >= ? AND COALESCE(o.processed_at, o.created_at) < ?)
         AND (o.test IS NULL OR o.test = 0) AND o.cancelled_at IS NULL AND o.financial_status = 'paid'`;
  const fallbackSql = config.dbUrl
    ? `SELECT o.order_id, o.total_price, o.currency, o.created_at, o.processed_at, o.customer_orders_count, o.customer_id, NULL AS first_paid_order_at
       FROM orders_shopify o
       WHERE o.shop = $1 AND (COALESCE(o.processed_at, o.created_at) >= $2 AND COALESCE(o.processed_at, o.created_at) < $3)
         AND (o.test IS NULL OR o.test = 0) AND o.cancelled_at IS NULL AND o.financial_status = 'paid'`
    : `SELECT o.order_id, o.total_price, o.currency, o.created_at, o.processed_at, o.customer_orders_count, o.customer_id, NULL AS first_paid_order_at
       FROM orders_shopify o
       WHERE o.shop = ? AND (COALESCE(o.processed_at, o.created_at) >= ? AND COALESCE(o.processed_at, o.created_at) < ?)
         AND (o.test IS NULL OR o.test = 0) AND o.cancelled_at IS NULL AND o.financial_status = 'paid'`;
  try {
    return await db.all(withFactsSql, [shop, startMs, endMs]);
  } catch (_) {
    return await db.all(fallbackSql, [shop, startMs, endMs]);
  }
}

async function fetchSessionCountsByProductHandle(db, startMs, endMs, handles, filter) {
  const out = new Map();
  const keys = uniqueNonEmpty((handles || []).map(normalizeHandleKey)).filter(Boolean);
  if (!keys.length) return out;

  const filterSql = String(filter && filter.sql ? filter.sql : '').replace(/\bs\./g, 's.').replace(/sessions\./g, 's.');
  const filterParams = (filter && Array.isArray(filter.params)) ? filter.params : [];

  const phStart = config.dbUrl ? '$1' : '?';
  const phEnd = config.dbUrl ? '$2' : '?';

  // Prefer the same "product landing" handle resolution logic as other product reports:
  // first_path (/products/<handle>), else first_product_handle, else entry_url.
  const rows = await db.all(
    `
      SELECT s.first_path, s.first_product_handle, s.entry_url
      FROM sessions s
      WHERE s.started_at >= ${phStart} AND s.started_at < ${phEnd}
        ${filterSql}
        AND (
          (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
          OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
          OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
        )
    `,
    [startMs, endMs, ...filterParams]
  );

  const keySet = new Set(keys);
  for (const r of rows || []) {
    const h = handleFromSessionRow(r);
    if (!h || !keySet.has(h)) continue;
    out.set(h, (out.get(h) || 0) + 1);
  }
  return out;
}

async function fetchSessionCountsByCountryCode(db, startMs, endMs, countries, filter) {
  const out = new Map();
  const keys = uniqueNonEmpty((countries || []).map(normalizeCountryKey)).filter(Boolean);
  if (!keys.length) return out;

  const filterSql = String(filter && filter.sql ? filter.sql : '').replace(/\bs\./g, 's.').replace(/sessions\./g, 's.');
  const filterParams = (filter && Array.isArray(filter.params)) ? filter.params : [];

  const phStart = config.dbUrl ? '$1' : '?';
  const phEnd = config.dbUrl ? '$2' : '?';
  const inPh = inPlaceholders(keys.length, 3);

  const expr = `UPPER(SUBSTR(COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(s.cf_country), ''), 'XX'), 1, 2))`;

  const rows = await db.all(
    `
      SELECT ${expr} AS country, COUNT(*) AS n
      FROM sessions s
      WHERE s.started_at >= ${phStart} AND s.started_at < ${phEnd}
        AND ${expr} IN (${inPh})
        ${filterSql}
      GROUP BY ${expr}
    `,
    [startMs, endMs, ...keys, ...filterParams]
  );
  for (const r of rows || []) {
    const k = r && r.country != null ? normalizeCountryKey(String(r.country)) : '';
    if (!k) continue;
    out.set(k, Number(r.n) || 0);
  }
  return out;
}

async function fetchSessionCountsByProductHandleAll(db, startMs, endMs, filter) {
  const out = new Map();

  const filterSql = String(filter && filter.sql ? filter.sql : '').replace(/\bs\./g, 's.').replace(/sessions\./g, 's.');
  const filterParams = (filter && Array.isArray(filter.params)) ? filter.params : [];

  const phStart = config.dbUrl ? '$1' : '?';
  const phEnd = config.dbUrl ? '$2' : '?';

  // Prefer the same "product landing" handle resolution logic as other product reports:
  // first_path (/products/<handle>), else first_product_handle, else entry_url.
  const rows = await db.all(
    `
      SELECT s.first_path, s.first_product_handle, s.entry_url
      FROM sessions s
      WHERE s.started_at >= ${phStart} AND s.started_at < ${phEnd}
        ${filterSql}
        AND (
          (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
          OR (s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != '')
          OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
        )
    `,
    [startMs, endMs, ...filterParams]
  );

  for (const r of rows || []) {
    const h = handleFromSessionRow(r);
    if (!h) continue;
    out.set(h, (out.get(h) || 0) + 1);
  }
  return out;
}

async function fetchSessionCountsByCountryCodeAll(db, startMs, endMs, filter) {
  const out = new Map();

  const filterSql = String(filter && filter.sql ? filter.sql : '').replace(/\bs\./g, 's.').replace(/sessions\./g, 's.');
  const filterParams = (filter && Array.isArray(filter.params)) ? filter.params : [];

  const phStart = config.dbUrl ? '$1' : '?';
  const phEnd = config.dbUrl ? '$2' : '?';

  const expr = `UPPER(SUBSTR(COALESCE(NULLIF(TRIM(s.country_code), ''), NULLIF(TRIM(s.cf_country), ''), 'XX'), 1, 2))`;

  const rows = await db.all(
    `
      SELECT ${expr} AS country, COUNT(*) AS n
      FROM sessions s
      WHERE s.started_at >= ${phStart} AND s.started_at < ${phEnd}
        ${filterSql}
      GROUP BY ${expr}
    `,
    [startMs, endMs, ...filterParams]
  );

  for (const r of rows || []) {
    let k = r && r.country != null ? normalizeCountryKey(String(r.country)) : '';
    if (!k) continue;
    if (k === 'UK') k = 'GB';
    out.set(k, Number(r.n) || 0);
  }
  return out;
}

function titleFromHandle(handle) {
  const h = typeof handle === 'string' ? handle.trim() : '';
  if (!h) return '';
  return h
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(function(w) {
      const s = String(w || '').trim();
      if (!s) return '';
      return s.charAt(0).toUpperCase() + s.slice(1);
    })
    .filter(Boolean)
    .join(' ')
    .slice(0, 180);
}

function handleGuessFromTitle(title) {
  const t = typeof title === 'string' ? title.trim().toLowerCase() : '';
  if (!t) return '';
  const slug = t
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 128);
  return normalizeHandleKey(slug);
}

function fillTopProductsWithSessionsFallback(topProducts, sessionsByHandleAll, { limit = DASHBOARD_TOP_TABLE_MAX_ROWS } = {}) {
  const out = Array.isArray(topProducts) ? topProducts.slice() : [];
  const lim = Math.max(0, Math.trunc(Number(limit) || DASHBOARD_TOP_TABLE_MAX_ROWS));
  if (lim <= 0) return [];

  const seen = new Set();
  for (const p of out) {
    const h = normalizeHandleKey(p && p.handle != null ? String(p.handle) : '');
    if (h) seen.add(h);
    else {
      const guess = handleGuessFromTitle(p && p.title != null ? String(p.title) : '');
      if (guess) seen.add(guess);
    }
  }

  // Fill remaining slots with the highest-clicked product handles (sessions), excluding anything already shown.
  if (out.length < lim && sessionsByHandleAll && typeof sessionsByHandleAll.entries === 'function') {
    const candidates = [];
    for (const entry of sessionsByHandleAll.entries()) {
      const h = normalizeHandleKey(entry && entry[0] != null ? String(entry[0]) : '');
      const n = Number(entry && entry[1]) || 0;
      if (!h || !(n > 0)) continue;
      if (seen.has(h)) continue;
      candidates.push({ handle: h, sessions: n });
    }
    candidates.sort(function(a, b) {
      if (b.sessions !== a.sessions) return b.sessions - a.sessions;
      if (a.handle < b.handle) return -1;
      if (a.handle > b.handle) return 1;
      return 0;
    });
    for (const c of candidates) {
      if (out.length >= lim) break;
      out.push({
        product_id: null,
        title: titleFromHandle(c.handle) || 'Unknown',
        handle: c.handle,
        revenue: 0,
        orders: 0,
        thumb_url: null,
      });
      seen.add(c.handle);
    }
  }

  const map = sessionsByHandleAll && typeof sessionsByHandleAll.get === 'function' ? sessionsByHandleAll : null;
  return out.slice(0, lim).map(function(p) {
    const h = normalizeHandleKey(p && p.handle != null ? String(p.handle) : '');
    const sessions = (h && map) ? (map.get(h) || 0) : 0;
    const revenue = Number(p && p.revenue) || 0;
    const orders = Number(p && p.orders) || 0;
    return {
      ...p,
      sessions,
      cr: crPct(orders, sessions),
      vpv: ratioOrNull(revenue, sessions, { decimals: 2 }),
    };
  });
}

/** Await product meta for top products so thumbs/handles are available on first load and when switching range. */
async function fetchProductMetaMap(shop, token, productIds) {
  const metaMap = new Map();
  if (!shop || !token || !Array.isArray(productIds) || productIds.length === 0) return metaMap;
  const ids = productIds.filter(Boolean);
  if (!ids.length) return metaMap;
  const metaPromises = ids.map((pid) =>
    productMetaCache.getProductMeta(shop, token, pid).catch(() => ({ ok: false }))
  );
  const metaResults = await Promise.all(metaPromises);
  ids.forEach((pid, i) => {
    const meta = metaResults[i];
    if (meta && meta.ok) metaMap.set(String(pid), meta);
  });
  return metaMap;
}

function fillTopCountriesWithSessionsFallback(topCountries, sessionsByCountryAll, { limit = DASHBOARD_TOP_TABLE_MAX_ROWS } = {}) {
  const out = Array.isArray(topCountries) ? topCountries.slice() : [];
  const lim = Math.max(0, Math.trunc(Number(limit) || DASHBOARD_TOP_TABLE_MAX_ROWS));
  if (lim <= 0) return [];

  const seen = new Set();
  for (const c of out) {
    let cc = normalizeCountryKey(c && (c.country_code != null ? String(c.country_code) : (c.country != null ? String(c.country) : '')));
    if (!cc) continue;
    if (cc === 'UK') cc = 'GB';
    seen.add(cc);
  }

  if (out.length < lim && sessionsByCountryAll && typeof sessionsByCountryAll.entries === 'function') {
    const candidates = [];
    for (const entry of sessionsByCountryAll.entries()) {
      let cc = normalizeCountryKey(entry && entry[0] != null ? String(entry[0]) : '');
      const n = Number(entry && entry[1]) || 0;
      if (!cc || !(n > 0)) continue;
      if (cc === 'UK') cc = 'GB';
      if (seen.has(cc)) continue;
      candidates.push({ country: cc, sessions: n });
    }
    candidates.sort(function(a, b) {
      if (b.sessions !== a.sessions) return b.sessions - a.sessions;
      if (a.country < b.country) return -1;
      if (a.country > b.country) return 1;
      return 0;
    });
    for (const c of candidates) {
      if (out.length >= lim) break;
      out.push({
        country: c.country,
        country_code: c.country,
        revenue: 0,
        orders: 0,
      });
      seen.add(c.country);
    }
  }

  const map = sessionsByCountryAll && typeof sessionsByCountryAll.get === 'function' ? sessionsByCountryAll : null;
  return out.slice(0, lim).map(function(c) {
    let cc = normalizeCountryKey(c && (c.country_code != null ? String(c.country_code) : (c.country != null ? String(c.country) : '')));
    if (cc === 'UK') cc = 'GB';
    const sessions = (cc && map) ? (map.get(cc) || 0) : 0;
    const revenue = Number(c && c.revenue) || 0;
    const orders = Number(c && c.orders) || 0;
    return {
      ...c,
      country: cc || (c && c.country) || null,
      country_code: cc || (c && c.country_code) || null,
      sessions,
      cr: crPct(orders, sessions),
      vpv: ratioOrNull(revenue, sessions, { decimals: 2 }),
    };
  });
}

async function attachCrToTopProducts(db, startMs, endMs, filter, topProducts) {
  const list = Array.isArray(topProducts) ? topProducts : [];
  const handles = list.map(p => normalizeHandleKey(p && p.handle != null ? String(p.handle) : '')).filter(Boolean);
  const sessionsByHandle = handles.length ? await fetchSessionCountsByProductHandle(db, startMs, endMs, handles, filter) : new Map();
  return list.map(function(p) {
    const h = normalizeHandleKey(p && p.handle != null ? String(p.handle) : '');
    const sessions = h ? (sessionsByHandle.get(h) || 0) : 0;
    const revenue = Number(p && p.revenue) || 0;
    return {
      ...p,
      sessions,
      cr: crPct(Number(p && p.orders) || 0, sessions),
      vpv: ratioOrNull(revenue, sessions, { decimals: 2 }),
    };
  });
}

async function attachCrToTopCountries(db, startMs, endMs, filter, topCountries) {
  const list = Array.isArray(topCountries) ? topCountries : [];
  const codes = list.map(c => normalizeCountryKey(c && c.country != null ? String(c.country) : '')).filter(Boolean);
  const sessionsByCountry = codes.length ? await fetchSessionCountsByCountryCode(db, startMs, endMs, codes, filter) : new Map();
  return list.map(function(c) {
    const cc = normalizeCountryKey(c && c.country != null ? String(c.country) : '');
    const sessions = cc ? (sessionsByCountry.get(cc) || 0) : 0;
    const revenue = Number(c && c.revenue) || 0;
    return {
      ...c,
      sessions,
      cr: crPct(Number(c && c.orders) || 0, sessions),
      vpv: ratioOrNull(revenue, sessions, { decimals: 2 }),
    };
  });
}

async function fetchSessionsAndBouncesByDayBounds(db, dayBounds, overallStart, overallEnd, filter) {
  const sessionsPerDay = {};
  const bouncePerDay = {};
  for (const d of Array.isArray(dayBounds) ? dayBounds : []) {
    sessionsPerDay[d.label] = 0;
    bouncePerDay[d.label] = 0;
  }
  if (!dayBounds || !dayBounds.length) return { sessionsPerDay, bouncePerDay };

  // Ensure the filter applies to the correct aliases (s / s2). (Filter currently uses `s.`.)
  const filterOuter = String(filter && filter.sql ? filter.sql : '')
    .replace(/sessions\./g, 's.')
    .replace(/\bs\./g, 's.');
  const filterS2 = String(filter && filter.sql ? filter.sql : '')
    .replace(/sessions\./g, 's2.')
    .replace(/\bs\./g, 's2.');
  const filterParams = (filter && Array.isArray(filter.params)) ? filter.params : [];

  // Single-pass conditional aggregation across all day bounds.
  const cols = [];
  // IMPORTANT: parameter order must match placeholder order.
  // The CASE WHEN aggregates in SELECT come BEFORE the subquery/WHERE placeholders.
  const params = [];
  for (let i = 0; i < dayBounds.length; i++) {
    cols.push(`COALESCE(SUM(CASE WHEN s.started_at >= ? AND s.started_at < ? THEN 1 ELSE 0 END), 0) AS sessions_${i}`);
    cols.push(`COALESCE(SUM(CASE WHEN s.started_at >= ? AND s.started_at < ? AND COALESCE(pv.pv, 0) = 1 THEN 1 ELSE 0 END), 0) AS bounces_${i}`);
    params.push(dayBounds[i].start, dayBounds[i].end, dayBounds[i].start, dayBounds[i].end);
  }
  // pv subquery range, then outer sessions range (and any filter params for each scope).
  params.push(
    overallStart, overallEnd, ...filterParams,
    overallStart, overallEnd, ...filterParams
  );

  const row = await db.get(
    `
      SELECT ${cols.join(', ')}
      FROM sessions s
      LEFT JOIN (
        SELECT e.session_id AS session_id, COUNT(*) AS pv
        FROM events e
        JOIN sessions s2 ON s2.session_id = e.session_id
        WHERE e.type = 'page_viewed'
          AND s2.started_at >= ? AND s2.started_at < ?
          ${filterS2}
        GROUP BY e.session_id
      ) pv ON pv.session_id = s.session_id
      WHERE s.started_at >= ? AND s.started_at < ?
      ${filterOuter}
    `,
    params
  );

  for (let i = 0; i < dayBounds.length; i++) {
    const label = dayBounds[i].label;
    sessionsPerDay[label] = row ? (Number(row[`sessions_${i}`]) || 0) : 0;
    bouncePerDay[label] = row ? (Number(row[`bounces_${i}`]) || 0) : 0;
  }
  return { sessionsPerDay, bouncePerDay };
}

async function fetchUnitsSoldByDayBounds(db, shop, dayBounds, overallStart, overallEnd) {
  const unitsPerDay = {};
  for (const d of Array.isArray(dayBounds) ? dayBounds : []) {
    unitsPerDay[d.label] = 0;
  }
  if (!shop || !dayBounds || !dayBounds.length) return unitsPerDay;

  // Single-pass conditional aggregation across all day bounds.
  const cols = [];
  // IMPORTANT: parameter order must match placeholder order.
  // The CASE WHEN aggregates in SELECT come BEFORE the WHERE placeholders.
  const params = [];
  for (let i = 0; i < dayBounds.length; i++) {
    cols.push(`COALESCE(SUM(CASE WHEN li.order_created_at >= ? AND li.order_created_at < ? THEN li.quantity ELSE 0 END), 0) AS units_${i}`);
    params.push(dayBounds[i].start, dayBounds[i].end);
  }
  params.push(shop, overallStart, overallEnd);

  const row = await db.get(
    `
      SELECT ${cols.join(', ')}
      FROM orders_shopify_line_items li
      WHERE li.shop = ? AND li.order_created_at >= ? AND li.order_created_at < ?
        AND (li.order_test IS NULL OR li.order_test = 0)
        AND li.order_cancelled_at IS NULL
        AND li.order_financial_status IN ('paid', 'partially_paid')
    `,
    params
  );

  for (let i = 0; i < dayBounds.length; i++) {
    const label = dayBounds[i].label;
    const v = row ? Number(row[`units_${i}`]) : 0;
    unitsPerDay[label] = Number.isFinite(v) ? Math.trunc(v) : 0;
  }
  return unitsPerDay;
}

async function getDashboardSeries(req, res) {
  const rangeRaw = (typeof req.query.range === 'string' ? req.query.range : '').trim().toLowerCase();
  const normalizeRange = (rk) => {
    const r = (rk == null ? '' : String(rk)).trim().toLowerCase();
    if (r === '7days') return '7d';
    if (r === '14days') return '14d';
    if (r === '30days') return '30d';
    return r;
  };
  const requestedRange = normalizeRange(rangeRaw);
  const isDayKey = requestedRange && /^d:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const isRangeKey = requestedRange && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(requestedRange);
  const allowedRange = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month', '1h']);
  const rangeKey = (allowedRange.has(requestedRange) || isDayKey || isRangeKey) ? requestedRange : '';

  let bucketHint = 'day';
  if (rangeKey) {
    let isSingleDay = rangeKey === 'today' || rangeKey === 'yesterday' || isDayKey;
    if (!isSingleDay && isRangeKey) {
      const m = String(rangeKey).match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
      if (m && m[1] && m[2] && m[1] === m[2]) isSingleDay = true;
    }
    bucketHint = isSingleDay ? 'hour' : 'day';
  }

  const daysRaw = parseInt(req.query.days, 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 && daysRaw <= 90 ? daysRaw : 7;
  const force = !!(req.query.force === '1' || req.query.force === 'true' || req.query._);
  const trafficMode = 'human_only';
  const trendingPresetRaw = (typeof req.query.trendingPreset === 'string' ? req.query.trendingPreset : '').trim().toLowerCase();
  const trendingPreset = ['today', 'yesterday', '3d', '7d', '14d'].indexOf(trendingPresetRaw) >= 0 ? trendingPresetRaw : null;
  const trendingDaysRaw = parseInt(req.query.trendingDays, 10);
  const trendingDays = [3, 7, 14].indexOf(trendingDaysRaw) >= 0 ? trendingDaysRaw : null;

  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Vary', 'Cookie');

  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const todayBounds = store.getRangeBounds('today', now, timeZone);
  let bounds = rangeKey ? store.getRangeBounds(rangeKey, now, timeZone) : null;

  // Optional clip for partial-day compare (e.g. yesterday up to same time-of-day as today).
  // `endMs` is inclusive-exclusive, same as bounds.end semantics.
  const endMsRaw = req.query.endMs;
  const endMsParsed = (typeof endMsRaw === 'string' || typeof endMsRaw === 'number') ? Number(endMsRaw) : NaN;
  const endMs = Number.isFinite(endMsParsed) ? endMsParsed : null;
  if (rangeKey && bounds && endMs != null && Number.isFinite(Number(bounds.start)) && Number.isFinite(Number(bounds.end))) {
    const start = Number(bounds.start);
    const end = Number(bounds.end);
    const maxEnd = Math.min(end, now);
    const clampedEnd = Math.max(start, Math.min(endMs, maxEnd));
    bounds = { ...bounds, end: clampedEnd };
  }

  if (rangeKey && bucketHint === 'day' && bounds && Number.isFinite(Number(bounds.start)) && Number.isFinite(Number(bounds.end))) {
    const spanMs = Number(bounds.end) - Number(bounds.start);
    const spanDays = spanMs > 0 ? Math.ceil(spanMs / (24 * 60 * 60 * 1000)) : 0;
    if (spanDays >= 56) bucketHint = 'week';
  }

  try {
    const _dbgOn = config.kexoDebugPerf;
    const _t0 = _dbgOn ? Date.now() : 0;
    const rangeEnd = rangeKey ? bounds.end : now;
    const rangeEndForCache = (rangeKey === 'today' || rangeKey === 'yesterday' || endMs != null) && Number.isFinite(rangeEnd)
      ? Math.floor(rangeEnd / (60 * 1000)) * (60 * 1000)
      : rangeEnd;
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'dashboard-series',
        rangeKey: rangeKey ? ('range_' + rangeKey + '_' + bucketHint) : ('days_' + days),
        rangeStartTs: rangeKey ? bounds.start : todayBounds.start,
        rangeEndTs: rangeEnd,
        params: rangeKey
          ? { trafficMode, rangeKey, bucket: bucketHint, rangeEndTs: rangeEndForCache, trendingPreset: trendingPreset || undefined, trendingDays: trendingDays != null ? trendingDays : undefined }
          : { trafficMode, days, bucket: 'day' },
        ttlMs: 5 * 60 * 1000,
        force,
      },
      () => rangeKey
        ? computeDashboardSeriesForBounds(bounds, now, timeZone, trafficMode, bucketHint, rangeKey, trendingPreset || trendingDays)
        : computeDashboardSeries(days, now, timeZone, trafficMode)
    );
    if (_dbgOn) {
      const ms = Math.max(0, Date.now() - (_t0 || 0));
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a370db6d-7333-4112-99f8-dd4bc899a89b',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/routes/dashboardSeries.js:getDashboardSeries',message:'dashboard series served',data:{ms_total:ms,cacheHit:!!(cached&&cached.cacheHit),rangeKey:rangeKey||'',bucket:bucketHint||'',days:days,force:!!force,endMs:endMs!=null?Number(endMs):null},timestamp:Date.now(),runId:config.kexoDebugPerfRunId,hypothesisId:'H4'} )}).catch(()=>{});
      // #endregion
    }
    res.json(cached && cached.ok ? cached.data : { series: [], topProducts: [], topCountries: [], trendingUp: [], trendingDown: [] });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'dashboard-series', days, rangeKey, endMs } });
    console.error('[dashboard-series]', err);
    res.status(500).json({ error: 'Internal error' });
  }
}

function getPlatformStartMs(nowMs, timeZone) {
  try {
    const b = store.getRangeBounds('d:2025-02-01', nowMs, timeZone);
    return b && Number.isFinite(Number(b.start)) ? Number(b.start) : 0;
  } catch (_) {
    return 0;
  }
}

function getCompareWindow(rangeKey, bounds, nowMs, timeZone) {
  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : nowMs;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : nowMs;
  const platformStartMs = getPlatformStartMs(nowMs, timeZone);
  const periodLengthMs = end - start;

  let compareStart = start;
  let compareEnd = start;
  if (rangeKey === 'today') {
    // Today up to X -> yesterday up to X (time-of-day aligned in admin timezone)
    const todayBounds = store.getRangeBounds('today', nowMs, timeZone);
    const yesterdayBounds = store.getRangeBounds('yesterday', nowMs, timeZone);
    const todayStart = todayBounds && Number.isFinite(Number(todayBounds.start)) ? Number(todayBounds.start) : start;
    const yStart = yesterdayBounds && Number.isFinite(Number(yesterdayBounds.start)) ? Number(yesterdayBounds.start) : (start - 24 * 60 * 60 * 1000);
    const yEnd = yesterdayBounds && Number.isFinite(Number(yesterdayBounds.end)) ? Number(yesterdayBounds.end) : start;
    const elapsed = Math.max(0, end - todayStart);
    compareStart = yStart;
    compareEnd = Math.min(yEnd, yStart + elapsed);
  } else {
    compareStart = start - periodLengthMs;
    compareEnd = start;
  }

  if (platformStartMs && compareStart < platformStartMs) compareStart = platformStartMs;
  if (platformStartMs && compareEnd < platformStartMs) compareEnd = platformStartMs;
  if (!(compareEnd > compareStart)) return null;
  return { start: compareStart, end: compareEnd };
}

async function fetchProductAggByProductId(db, shop, startMs, endMs) {
  if (!shop) return [];
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];
  try {
    return await db.all(
      config.dbUrl
        ? `SELECT COALESCE(NULLIF(TRIM(li.product_id), ''), ('title:' || LOWER(TRIM(COALESCE(li.title, ''))))) AS product_key,
                  NULLIF(TRIM(li.product_id), '') AS product_id,
                  MAX(NULLIF(TRIM(li.title), '')) AS title,
                  COALESCE(SUM(li.line_revenue), 0) AS revenue,
                  COUNT(DISTINCT li.order_id) AS orders
           FROM orders_shopify_line_items li
           WHERE li.shop = $1 AND li.order_created_at >= $2 AND li.order_created_at < $3
             AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status IN ('paid', 'partially_paid')
             AND (
               (li.product_id IS NOT NULL AND TRIM(li.product_id) != '')
               OR (li.title IS NOT NULL AND TRIM(li.title) != '')
             )
           GROUP BY COALESCE(NULLIF(TRIM(li.product_id), ''), ('title:' || LOWER(TRIM(COALESCE(li.title, '')))))`
        : `SELECT COALESCE(NULLIF(TRIM(li.product_id), ''), ('title:' || LOWER(TRIM(COALESCE(li.title, ''))))) AS product_key,
                  NULLIF(TRIM(li.product_id), '') AS product_id,
                  MAX(NULLIF(TRIM(li.title), '')) AS title,
                  COALESCE(SUM(li.line_revenue), 0) AS revenue,
                  COUNT(DISTINCT li.order_id) AS orders
           FROM orders_shopify_line_items li
           WHERE li.shop = ? AND li.order_created_at >= ? AND li.order_created_at < ?
             AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status IN ('paid', 'partially_paid')
             AND (
               (li.product_id IS NOT NULL AND TRIM(li.product_id) != '')
               OR (li.title IS NOT NULL AND TRIM(li.title) != '')
             )
           GROUP BY COALESCE(NULLIF(TRIM(li.product_id), ''), ('title:' || LOWER(TRIM(COALESCE(li.title, '')))))`,
      [shop, start, end]
    );
  } catch (e) {
    if (e && typeof e.message === 'string') console.error('[dashSeries] fetchProductAggByProductId err', e.message);
    return [];
  }
}

function rawTopRowsToTrendingAggRows(rawRows) {
  const out = [];
  for (const r of (Array.isArray(rawRows) ? rawRows : [])) {
    const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
    const title = r && r.title != null ? String(r.title).trim() : '';
    const pkey = pid || (title ? ('title:' + title.toLowerCase()) : '');
    if (!pkey) continue;
    out.push({
      product_key: pkey,
      product_id: pid || null,
      title: title || 'Unknown',
      revenue: Math.round((Number(r && r.revenue) || 0) * 100) / 100,
      orders: Number(r && r.orders) || 0,
    });
  }
  return out;
}

async function fetchTrendingProducts(db, shop, nowBounds, prevBounds, filter) {
  if (!shop || !nowBounds || !prevBounds) return { trendingUp: [], trendingDown: [] };
  let nowRows = await fetchProductAggByProductId(db, shop, nowBounds.start, nowBounds.end);
  let prevRows = await fetchProductAggByProductId(db, shop, prevBounds.start, prevBounds.end);
  if (!nowRows.length || !prevRows.length) {
    try {
      const ratesToGbp = await fx.getRatesToGbp();
      const fallbackLimit = Math.max(20, DASHBOARD_TRENDING_MAX_ROWS * 4);
      if (!nowRows.length) {
        const rawNow = await fallbackTopProductsFromOrdersRawJson(db, shop, nowBounds.start, nowBounds.end, ratesToGbp, {
          limit: fallbackLimit,
          maxOrders: 2000,
        });
        const nowFallback = rawTopRowsToTrendingAggRows(rawNow);
        if (nowFallback.length) nowRows = nowFallback;
      }
      if (!prevRows.length) {
        const rawPrev = await fallbackTopProductsFromOrdersRawJson(db, shop, prevBounds.start, prevBounds.end, ratesToGbp, {
          limit: fallbackLimit,
          maxOrders: 2000,
        });
        const prevFallback = rawTopRowsToTrendingAggRows(rawPrev);
        if (prevFallback.length) prevRows = prevFallback;
      }
    } catch (_) {}
  }

  const nowMap = new Map();
  const prevMap = new Map();
  nowRows.forEach(function(r) {
    const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
    const pkey = r && r.product_key != null ? String(r.product_key).trim() : '';
    const id = pid || pkey;
    if (!id) return;
    nowMap.set(id, {
      product_id: pid || null,
      title: r.title || 'Unknown',
      revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
      orders: Number(r.orders) || 0,
    });
  });
  prevRows.forEach(function(r) {
    const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
    const pkey = r && r.product_key != null ? String(r.product_key).trim() : '';
    const id = pid || pkey;
    if (!id) return;
    prevMap.set(id, {
      product_id: pid || null,
      title: r.title || 'Unknown',
      revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
      orders: Number(r.orders) || 0,
    });
  });

  const allPids = new Set();
  nowMap.forEach(function(_, k) { allPids.add(k); });
  prevMap.forEach(function(_, k) { allPids.add(k); });

  const TRENDING_PCT_MIN_PREV = 0.01; // minimum revenuePrev to compute % growth; below that treat as "new"
  const base = [];
  allPids.forEach(function(pid) {
    const n = nowMap.get(pid) || { product_id: pid, title: 'Unknown', revenue: 0, orders: 0 };
    const p = prevMap.get(pid) || { product_id: pid, title: n.title || 'Unknown', revenue: 0, orders: 0 };
    const prevRev = Number(p.revenue) || 0;
    const deltaRev = (Number(n.revenue) || 0) - prevRev;
    const deltaRevenue = Math.round(deltaRev * 100) / 100;
    let pctGrowth = null;
    if (prevRev >= TRENDING_PCT_MIN_PREV) {
      pctGrowth = Math.round((deltaRev / prevRev) * 1000) / 10;
    } else if (deltaRev > 0.005) {
      pctGrowth = 999; // "new" or near-zero prev: treat as high % growth for sort
    } else if (deltaRev < -0.005) {
      pctGrowth = -999;
    } else {
      pctGrowth = 0;
    }
    base.push({
      product_id: n.product_id || p.product_id || null,
      title: n.title || p.title || 'Unknown',
      revenueNow: n.revenue,
      revenuePrev: p.revenue,
      ordersNow: n.orders,
      ordersPrev: p.orders,
      deltaRevenue,
      deltaOrders: (n.orders - p.orders) || 0,
      pctGrowth,
    });
  });

  // Trending by % growth (so list differs from "top by revenue" — surfaces fast growers).
  const up = base
    .filter(function(r) { return r.deltaRevenue > 0.005; })
    .sort(function(a, b) {
      const byPct = (b.pctGrowth != null ? b.pctGrowth : -Infinity) - (a.pctGrowth != null ? a.pctGrowth : -Infinity);
      if (byPct !== 0) return byPct;
      return (b.deltaRevenue || 0) - (a.deltaRevenue || 0);
    })
    .slice(0, DASHBOARD_TRENDING_MAX_ROWS);
  const down = base
    .filter(function(r) { return r.deltaRevenue < -0.005; })
    .sort(function(a, b) {
      const byPct = (a.pctGrowth != null ? a.pctGrowth : Infinity) - (b.pctGrowth != null ? b.pctGrowth : Infinity);
      if (byPct !== 0) return byPct;
      return (a.deltaRevenue || 0) - (b.deltaRevenue || 0);
    })
    .slice(0, DASHBOARD_TRENDING_MAX_ROWS);
  const candidateIds = new Set();
  up.forEach(function(r) { if (r.product_id) candidateIds.add(String(r.product_id).trim()); });
  down.forEach(function(r) { if (r.product_id) candidateIds.add(String(r.product_id).trim()); });

  let token = null;
  const metaMap = new Map();
  const missingMetaIds = [];
  if (candidateIds.size) {
    const productIds = Array.from(candidateIds);
    productIds.forEach(function(pid) {
      const cached = productMetaCache.peekProductMeta(shop, pid);
      if (cached && cached.ok) metaMap.set(String(pid), cached);
      else missingMetaIds.push(String(pid));
    });
  }
  // Await product meta for trending rows so titles/handles show immediately (no ID→name flash).
  if (missingMetaIds.length) {
    try { token = await salesTruth.getAccessToken(shop); } catch (_) { token = null; }
    if (token) {
      const toFetch = missingMetaIds.slice(0, 10);
      const metas = await Promise.all(
        toFetch.map((pid) =>
          productMetaCache.getProductMeta(shop, token, pid).catch(() => ({ ok: false, handle: null, title: null, thumb_url: null, product_type: null }))
        )
      );
      toFetch.forEach((pid, i) => {
        const m = metas[i];
        if (m && m.ok) metaMap.set(String(pid), m);
      });
    }
  }

  base.forEach(function(r) {
    const meta = metaMap.get(r.product_id ? String(r.product_id).trim() : '');
    r.thumb_url = meta && meta.thumb_url ? String(meta.thumb_url) : null;
    r.handle = meta && meta.handle ? String(meta.handle) : null;
    if ((!r.title || r.title === 'Unknown') && meta && meta.title) r.title = String(meta.title);
    if (!r.title || r.title === 'Unknown') {
      const pid = r.product_id ? String(r.product_id).trim() : '';
      r.title = pid ? ('Product ' + pid.replace(/^gid:\/\/shopify\/Product\//i, '')) : 'Unknown';
    }
  });

  try {
    const handles = uniqueNonEmpty(
      base.filter(function(r) { return candidateIds.has(r.product_id ? String(r.product_id).trim() : ''); })
        .map(function(r) { return normalizeHandleKey(r && r.handle != null ? String(r.handle) : ''); })
    ).filter(Boolean);
    const sessionsNowByHandle = handles.length
      ? await fetchSessionCountsByProductHandle(db, nowBounds.start, nowBounds.end, handles, filter)
      : new Map();
    const sessionsPrevByHandle = handles.length
      ? await fetchSessionCountsByProductHandle(db, prevBounds.start, prevBounds.end, handles, filter)
      : new Map();
    base.forEach(function(r) {
      const h = normalizeHandleKey(r && r.handle != null ? String(r.handle) : '');
      const sessionsNow = h ? (sessionsNowByHandle.get(h) || 0) : null;
      const sessionsPrev = h ? (sessionsPrevByHandle.get(h) || 0) : null;
      r.sessionsNow = sessionsNow;
      r.sessionsPrev = sessionsPrev;
      r.cr = sessionsNow == null ? null : crPct(Number(r && r.ordersNow) || 0, sessionsNow);
      r.vpv = ratioOrNull(r.revenueNow, sessionsNow, { decimals: 2 });
    });
  } catch (_) {}

  return { trendingUp: up, trendingDown: down };
}

async function fallbackTopProductsFromOrdersRawJson(db, shop, startMs, endMs, ratesToGbp, { limit = 5, maxOrders = 400 } = {}) {
  if (!shop) return [];
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];
  const lim = Math.max(1, Math.min(20, parseInt(String(limit), 10) || 5));
  const cap = Math.max(50, Math.min(2000, parseInt(String(maxOrders), 10) || 400));
  try {
    const rows = await db.all(
      config.dbUrl
        ? `SELECT order_id, raw_json, currency
           FROM orders_shopify
           WHERE shop = $1 AND created_at >= $2 AND created_at < $3
             AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status IN ('paid', 'partially_paid')
           ORDER BY created_at DESC
           LIMIT ${cap}`
        : `SELECT order_id, raw_json, currency
           FROM orders_shopify
           WHERE shop = ? AND created_at >= ? AND created_at < ?
             AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status IN ('paid', 'partially_paid')
           ORDER BY created_at DESC
           LIMIT ${cap}`,
      [shop, start, end]
    );
    const agg = new Map();
    for (const r of (rows || [])) {
      const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
      const currency = (r && r.currency ? String(r.currency) : 'GBP').toUpperCase();
      let json = null;
      try { json = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json; } catch (_) { json = null; }
      const lineItems = json && Array.isArray(json.line_items) ? json.line_items : (json && Array.isArray(json.lineItems) ? json.lineItems : []);
      for (const li of (lineItems || [])) {
        const pid = li && li.product_id != null ? String(li.product_id).trim() : '';
        const title = li && li.title != null ? String(li.title).trim() : '';
        const key = pid || ('title:' + title);
        if (!key || key === 'title:') continue;
        const qty = li && li.quantity != null ? Number(li.quantity) : 1;
        const unit = li && li.price != null ? Number(li.price) : (li && li.price_set && li.price_set.shop_money && li.price_set.shop_money.amount != null ? Number(li.price_set.shop_money.amount) : 0);
        const revenue = (Number.isFinite(qty) ? qty : 1) * (Number.isFinite(unit) ? unit : 0);
        const gbpVal = Number.isFinite(revenue) ? fx.convertToGbp(revenue, currency, ratesToGbp) : 0;
        const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
        const cur = agg.get(key) || { product_id: pid || null, title: title || null, revenue: 0, orderIds: new Set() };
        cur.revenue += gbp;
        if (oid) cur.orderIds.add(oid);
        if (!cur.title && title) cur.title = title;
        if (!cur.product_id && pid) cur.product_id = pid;
        agg.set(key, cur);
      }
    }
    const out = Array.from(agg.values())
      .map(function(p) {
        return {
          product_id: p.product_id || null,
          title: p.title || 'Unknown',
          revenue: Math.round((Number(p.revenue) || 0) * 100) / 100,
          orders: p.orderIds ? p.orderIds.size : 0,
        };
      })
      .sort(function(a, b) { return b.revenue - a.revenue; })
      .slice(0, lim);
    return out;
  } catch (_) {
    return [];
  }
}

async function computeDashboardSeries(days, nowMs, timeZone, trafficMode) {
  const db = getDb();
  const shop = await resolveDashboardShop(db);
  const filter = sessionFilterForTraffic(trafficMode);

  // Platform start date: never show data before Feb 1 2025
  const PLATFORM_START = '2025-02-01';

  // Build day boundaries
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const todayParts = parseDateParts(fmt.format(new Date(nowMs)));
  const dayBounds = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
    d.setUTCDate(d.getUTCDate() - i);
    const parts = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    const label = String(parts.year).padStart(4, '0') + '-' +
      String(parts.month).padStart(2, '0') + '-' +
      String(parts.day).padStart(2, '0');
    if (label < PLATFORM_START) continue; // skip dates before platform start
    const startMs = zonedTimeToUtcMs(parts.year, parts.month, parts.day, 0, 0, 0, timeZone);
    let endMs;
    if (i === 0) {
      endMs = nowMs; // today: up to now
    } else {
      const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
      next.setUTCDate(next.getUTCDate() + 1);
      endMs = zonedTimeToUtcMs(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0, timeZone);
    }
    dayBounds.push({ label, start: startMs, end: endMs });
  }

  if (!dayBounds.length) {
    return { days: 0, series: [], topProducts: [], topCountries: [], trendingUp: [], trendingDown: [], summary: {} };
  }

  const overallStart = dayBounds[0].start;
  const overallEnd = dayBounds[dayBounds.length - 1].end;

  // Keep Shopify truth "today" warm in the background (non-blocking).
  // Full-range reconciliation can be slow; reports should remain responsive.
  if (shop) {
    try {
      const today = store.getRangeBounds('today', Date.now(), timeZone);
      nudgeTruthWarmupDetached(shop, today.start, today.end, 'today');
    } catch (_) {}
  }

  // Fetch sessions + bounces across all days in one pass (avoid per-day loops).
  const sb = await fetchSessionsAndBouncesByDayBounds(db, dayBounds, overallStart, overallEnd, filter);
  const sessionsPerDay = sb.sessionsPerDay || {};
  const bouncePerDay = sb.bouncePerDay || {};

  // Fetch orders + revenue per day from Shopify truth (Total sales: bucket by processed_at, subtract refunds)
  const ratesToGbp = await fx.getRatesToGbp();
  const revenuePerDay = {};
  const ordersPerDay = {};
  const returningCustomersSetByDay = {};
  let newCustomerOrders = 0, returningCustomerOrders = 0;
  const rawKpi = await store.getSetting('kpi_ui_config_v1');
  const returnsRefundsAttribution = parseReturnsRefundsAttributionFromKpiConfig(rawKpi);
  if (shop) {
    const orderRows = await fetchPaidOrderRowsWithReturningFacts(db, shop, overallStart, overallEnd);
    for (const row of orderRows) {
      const saleAt = Number(row.processed_at != null ? row.processed_at : row.created_at);
      let dayLabel = null;
      for (const db_day of dayBounds) {
        if (saleAt >= db_day.start && saleAt < db_day.end) {
          dayLabel = db_day.label;
          break;
        }
      }
      if (!dayLabel) continue;
      const price = parseFloat(row.total_price);
      const currency = (row.currency || 'GBP').toUpperCase();
      const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
      const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
      revenuePerDay[dayLabel] = (revenuePerDay[dayLabel] || 0) + gbp;
      ordersPerDay[dayLabel] = (ordersPerDay[dayLabel] || 0) + 1;
      const isReturning = isReturningOrderRow(row);
      const cid = row && row.customer_id != null ? String(row.customer_id).trim() : '';
      if (isReturning && cid) {
        if (!returningCustomersSetByDay[dayLabel]) returningCustomersSetByDay[dayLabel] = new Set();
        returningCustomersSetByDay[dayLabel].add(cid);
      }
      if (isReturning) returningCustomerOrders += 1;
      else newCustomerOrders += 1;
    }
    const refundsPerDay = await fetchRefundsPerDay(db, shop, dayBounds, overallStart, overallEnd, returnsRefundsAttribution, ratesToGbp);
    for (const db_day of dayBounds) {
      const refundGbp = refundsPerDay[db_day.label] || 0;
      revenuePerDay[db_day.label] = Math.max(0, (revenuePerDay[db_day.label] || 0) - refundGbp);
    }
  }

  // Fetch Shopify sessions per day (from shopify_sessions_snapshots)
  const shopifySessionsPerDay = {};
  if (shop) {
    try {
      const dayLabels = dayBounds.map(d => d.label);
      const shopifyRows = await db.all(
        config.dbUrl
          ? `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = $1 AND day_ymd >= $2 AND day_ymd <= $3
             GROUP BY day_ymd`
          : `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = ? AND day_ymd >= ? AND day_ymd <= ?`,
        [shop, dayLabels[0], dayLabels[dayLabels.length - 1]]
      );
      for (const r of shopifyRows) {
        shopifySessionsPerDay[r.day_ymd] = Number(r.sessions_count) || 0;
      }
    } catch (_) {}
  }

  // Build series
  const series = dayBounds.map(function(db_day) {
    const sessions = sessionsPerDay[db_day.label] || 0;
    const orders = ordersPerDay[db_day.label] || 0;
    const revenue = Math.round((revenuePerDay[db_day.label] || 0) * 100) / 100;
    const convRate = percentOrNull(orders, sessions, { decimals: 1 });
    const shopifySessions = shopifySessionsPerDay[db_day.label] || 0;
    const shopifyConvRate = percentOrNull(orders, shopifySessions, { decimals: 1 });
    const aov = ratioOrNull(revenue, orders, { decimals: 2 });
    const bounced = bouncePerDay[db_day.label] || 0;
    const bounceRate = percentOrNull(bounced, sessions, { decimals: 1, clampMax: 100 });
    return {
      date: db_day.label,
      revenue,
      orders,
      sessions,
      convRate,
      shopifyConvRate,
      returningCustomerOrders: returningCustomersSetByDay[db_day.label] ? returningCustomersSetByDay[db_day.label].size : 0,
      aov,
      bounceRate,
    };
  });

  // Top products (last N days)
  let topProducts = [];
  if (shop) {
    try {
      const hasLineNet = await lineItemsHasLineNet(db);
      const revenueExpr = hasLineNet
        ? 'COALESCE(SUM(COALESCE(li.line_net, li.line_revenue)), 0)'
        : 'COALESCE(SUM(li.line_revenue), 0)';
      const hasProcessedAt = await lineItemsHasOrderProcessedAt(db);
      const tsExpr = hasProcessedAt ? 'COALESCE(li.order_processed_at, li.order_created_at)' : 'li.order_created_at';
      const productRows = await db.all(
        config.dbUrl
          ? `SELECT TRIM(li.product_id) AS product_id, MAX(NULLIF(TRIM(li.title), '')) AS title, ${revenueExpr} AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = $1 AND (${tsExpr} >= $2 AND ${tsExpr} < $3)
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status IN ('paid', 'partially_paid')
               AND li.product_id IS NOT NULL AND TRIM(li.product_id) != ''
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT ${DASHBOARD_TOP_TABLE_MAX_ROWS}`
          : `SELECT TRIM(li.product_id) AS product_id, MAX(NULLIF(TRIM(li.title), '')) AS title, ${revenueExpr} AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = ? AND (${tsExpr} >= ? AND ${tsExpr} < ?)
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status IN ('paid', 'partially_paid')
               AND li.product_id IS NOT NULL AND TRIM(li.product_id) != ''
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT ${DASHBOARD_TOP_TABLE_MAX_ROWS}`,
        [shop, overallStart, overallEnd]
      );
      let token = null;
      try { token = await salesTruth.getAccessToken(shop); } catch (_) {}
      const productIds = productRows.map(r => r.product_id).filter(Boolean);
      const metaMap = await fetchProductMetaMap(shop, token, productIds);
      topProducts = productRows.map(function(r) {
        const pid = r.product_id ? String(r.product_id) : '';
        const meta = metaMap.get(pid);
        return {
          product_id: pid || null,
          title: r.title || (meta && meta.title ? String(meta.title) : null) || 'Unknown',
          handle: meta && meta.handle ? String(meta.handle) : null,
          revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
          orders: Number(r.orders) || 0,
          thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
        };
      });
      if (!topProducts.length) {
        const rawTop = await fallbackTopProductsFromOrdersRawJson(db, shop, overallStart, overallEnd, ratesToGbp, { limit: DASHBOARD_TOP_TABLE_MAX_ROWS });
        if (rawTop && rawTop.length) {
          let fallbackToken = token;
          if (!fallbackToken) {
            try { fallbackToken = await salesTruth.getAccessToken(shop); } catch (_) {}
          }
          const fallbackIds = rawTop.map((r) => r.product_id).filter(Boolean);
          const fallbackMetaMap = await fetchProductMetaMap(shop, fallbackToken, fallbackIds);
          topProducts = rawTop.map(function(r) {
            const pid = r.product_id ? String(r.product_id) : '';
            const meta = fallbackMetaMap.get(pid);
            return {
              title: r.title || (meta && meta.title ? String(meta.title) : null) || 'Unknown',
              handle: meta && meta.handle ? String(meta.handle) : null,
              revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
              orders: Number(r.orders) || 0,
              thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
            };
          });
        }
      }
    } catch (e) {
      if (e && typeof e.message === 'string') console.error('[dashSeries] topProducts err', e.message);
    }
  }

  let sessionsByHandleAll = new Map();
  try { sessionsByHandleAll = await fetchSessionCountsByProductHandleAll(db, overallStart, overallEnd, filter); } catch (_) {}
  topProducts = fillTopProductsWithSessionsFallback(topProducts, sessionsByHandleAll, { limit: DASHBOARD_TOP_TABLE_MAX_ROWS });

  // Top countries by revenue
  let topCountries = [];
  if (shop) {
    try {
      const countryRows = await db.all(
        config.dbUrl
          ? `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = $1 AND created_at >= $2 AND created_at < $3
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
          : `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = ? AND created_at >= ? AND created_at < ?
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`,
        [shop, overallStart, overallEnd]
      );
      const countryMap = {};
      for (const r of countryRows) {
        let cc = 'XX';
        try {
          const json = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json;
          cc = (json && json.shipping_address && json.shipping_address.country_code) ||
               (json && json.billing_address && json.billing_address.country_code) || 'XX';
        } catch (_) {}
        cc = String(cc).toUpperCase().slice(0, 2) || 'XX';
        if (cc === 'UK') cc = 'GB';
        const price = parseFloat(r.total_price);
        const currency = (r.currency || 'GBP').toUpperCase();
        const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
        const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
        if (!countryMap[cc]) countryMap[cc] = { revenue: 0, orders: 0 };
        countryMap[cc].revenue += gbp;
        countryMap[cc].orders += 1;
      }
      topCountries = Object.entries(countryMap)
        .map(function(entry) {
          const code = entry[0];
          return { country: code, country_code: code, revenue: Math.round(entry[1].revenue * 100) / 100, orders: entry[1].orders };
        })
        .sort(function(a, b) { return b.revenue - a.revenue; })
        .slice(0, DASHBOARD_TOP_TABLE_MAX_ROWS);
    } catch (_) {}
  }

  let sessionsByCountryAll = new Map();
  try { sessionsByCountryAll = await fetchSessionCountsByCountryCodeAll(db, overallStart, overallEnd, filter); } catch (_) {}
  topCountries = fillTopCountriesWithSessionsFallback(topCountries, sessionsByCountryAll, { limit: DASHBOARD_TOP_TABLE_MAX_ROWS });

  // Trending up/down vs previous equivalent period
  let trendingUp = [];
  let trendingDown = [];
  if (shop) {
    const nowBounds = { start: overallStart, end: overallEnd };
    const prevBounds = { start: Math.max(getPlatformStartMs(nowMs, timeZone), overallStart - (overallEnd - overallStart)), end: overallStart };
    try {
      const t = await fetchTrendingProducts(db, shop, nowBounds, prevBounds, filter);
      trendingUp = t && t.trendingUp ? t.trendingUp : [];
      trendingDown = t && t.trendingDown ? t.trendingDown : [];
    } catch (_) {}
  }

  // Ad spend per day (if ads DB available)
  let adSpendPerDay = {};
  try {
    const adsDb = require('../ads/adsDb');
    if (adsDb && typeof adsDb.getAdsPool === 'function') {
      const pool = adsDb.getAdsPool();
      if (pool) {
        const spendRows = await pool.query(
          `SELECT (hour_ts AT TIME ZONE 'UTC')::date::text AS day, COALESCE(SUM(spend_gbp), 0) AS spend_gbp
           FROM google_ads_spend_hourly
           WHERE (hour_ts AT TIME ZONE 'UTC')::date >= $1::date AND (hour_ts AT TIME ZONE 'UTC')::date <= $2::date
           GROUP BY (hour_ts AT TIME ZONE 'UTC')::date
           ORDER BY day`,
          [dayBounds[0].label, dayBounds[dayBounds.length - 1].label]
        );
        if (spendRows && spendRows.rows) {
          for (const r of spendRows.rows) {
            adSpendPerDay[r.day] = Math.round((Number(r.spend_gbp) || 0) * 100) / 100;
          }
        }
      }
    }
  } catch (_) {}

  // Merge ad spend into series
  for (const s of series) {
    s.adSpend = adSpendPerDay[s.date] || 0;
  }

  // Device breakdown (desktop vs mobile vs tablet)
  let desktopSessions = 0, mobileSessions = 0;
  try {
    const ph = config.dbUrl ? ['$1', '$2'] : ['?', '?'];
    const deviceRows = await db.all(
      'SELECT LOWER(COALESCE(s.ua_device_type, \'unknown\')) AS device, COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filter.sql.replace(/sessions\./g, 's.') + ' GROUP BY LOWER(COALESCE(s.ua_device_type, \'unknown\'))',
      [overallStart, overallEnd, ...filter.params]
    );
    for (const r of deviceRows) {
      const d = (r.device || '').trim();
      if (d === 'desktop') desktopSessions += Number(r.n) || 0;
      else if (d === 'mobile' || d === 'tablet') mobileSessions += Number(r.n) || 0;
    }
  } catch (_) {}

  // Returning/new order counts are accumulated from the same order rows used for series.

  // Summary totals
  let totalRevenue = 0, totalOrders = 0, totalSessions = 0, totalAdSpend = 0, totalBounced = 0;
  let aovHigh = 0, aovLow = Infinity;
  for (const s of series) {
    totalRevenue += s.revenue;
    totalOrders += s.orders;
    totalSessions += s.sessions;
    totalAdSpend += s.adSpend;
    totalBounced += (bouncePerDay[s.date] || 0);
    if (s.orders > 0) {
      if (s.aov > aovHigh) aovHigh = s.aov;
      if (s.aov < aovLow) aovLow = s.aov;
    }
  }
  if (!Number.isFinite(aovLow) || aovLow === Infinity) aovLow = 0;
  const avgConvRate = percentOrNull(totalOrders, totalSessions, { decimals: 1 });
  const avgAov = ratioOrNull(totalRevenue, totalOrders, { decimals: 2 });
  const bounceRate = percentOrNull(totalBounced, totalSessions, { decimals: 1, clampMax: 100 });
  const roas = ratioOrNull(totalRevenue, totalAdSpend, { decimals: 2 });

  return {
    days,
    series,
    topProducts,
    topCountries,
    trendingUp,
    trendingDown,
    bucket: 'day',
    summary: {
      revenue: Math.round(totalRevenue * 100) / 100,
      orders: totalOrders,
      sessions: totalSessions,
      convRate: avgConvRate,
      aov: avgAov,
      aovHigh: Math.round(aovHigh * 100) / 100,
      aovLow: Math.round(aovLow * 100) / 100,
      bounceRate,
      adSpend: Math.round(totalAdSpend * 100) / 100,
      roas,
      desktopSessions,
      mobileSessions,
      newCustomerOrders,
      returningCustomerOrders,
    },
  };
}

function ymdFromMsInTz(ms, timeZone) {
  // en-GB: DD/MM/YYYY
  const s = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const parts = parseDateParts(s);
  return String(parts.year).padStart(4, '0') + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
}

function partsFromYmd(ymd) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

function addDaysToParts(parts, deltaDays) {
  const d = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function ymdFromParts(parts) {
  const y = String(parts.year).padStart(4, '0');
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hourLabelFromParts(parts, hour) {
  const ymd = ymdFromParts(parts);
  const hh = String(Math.max(0, Math.min(23, Number(hour) || 0))).padStart(2, '0');
  return `${ymd} ${hh}:00`;
}

function hourMinuteLabelFromParts(parts, hour, minute) {
  const ymd = ymdFromParts(parts);
  const hh = String(Math.max(0, Math.min(23, Number(hour) || 0))).padStart(2, '0');
  const mm = String(Math.max(0, Math.min(59, Number(minute) || 0))).padStart(2, '0');
  return `${ymd} ${hh}:${mm}`;
}

async function computeDashboardSeriesForBounds(bounds, nowMs, timeZone, trafficMode, bucketHint, rangeKey, trendingPresetOrDays) {
  const db = getDb();
  const shop = await resolveDashboardShop(db);
  const filter = sessionFilterForTraffic(trafficMode);

  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : nowMs;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : nowMs;
  if (!(end > start)) {
    return { days: 0, series: [], topProducts: [], topCountries: [], trendingUp: [], trendingDown: [], summary: {} };
  }

  const startYmd = ymdFromMsInTz(start, timeZone);
  const endYmd = ymdFromMsInTz(Math.max(start, end - 1), timeZone);
  const startParts = partsFromYmd(startYmd);
  const endParts = partsFromYmd(endYmd);
  if (!startParts || !endParts) {
    return { days: 0, series: [], topProducts: [], topCountries: [], trendingUp: [], trendingDown: [], summary: {} };
  }

  const dayBounds = [];
  let cur = { year: startParts.year, month: startParts.month, day: startParts.day };
  const lastYmd = endYmd;
  while (true) {
    const label = ymdFromParts(cur);
    const startMsFull = zonedTimeToUtcMs(cur.year, cur.month, cur.day, 0, 0, 0, timeZone);
    const next = addDaysToParts(cur, 1);
    const endMsFull = zonedTimeToUtcMs(next.year, next.month, next.day, 0, 0, 0, timeZone);
    const dayStart = Math.max(startMsFull, start);
    const dayEnd = Math.min(endMsFull, end);
    if (dayEnd > dayStart) {
      dayBounds.push({ label, start: dayStart, end: dayEnd });
    }
    if (label === lastYmd) break;
    cur = next;
  }

  let bucket = (bucketHint === 'hour') ? 'hour' : (bucketHint === 'week' ? 'week' : 'day');
  let bucketBounds = dayBounds;
  if (bucket === 'hour' && dayBounds.length === 1) {
    const elapsedHours = (end - start) / (60 * 60 * 1000);
    let bucketMinutes = 60;
    if (elapsedHours < 4) bucketMinutes = 15;
    else if (elapsedHours < 8) bucketMinutes = 30;

    const minuteSteps = bucketMinutes === 15 ? [0, 15, 30, 45] : bucketMinutes === 30 ? [0, 30] : [0];
    const hourBounds = [];
    for (let h = 0; h < 24; h++) {
      for (const m of minuteSteps) {
        const mEnd = m + bucketMinutes;
        const hEnd = mEnd >= 60 ? h + 1 : h;
        const mEndNorm = mEnd >= 60 ? mEnd - 60 : mEnd;
        const hStartFull = zonedTimeToUtcMs(startParts.year, startParts.month, startParts.day, h, m, 0, timeZone);
        const hEndFull = zonedTimeToUtcMs(startParts.year, startParts.month, startParts.day, hEnd, mEndNorm, 0, timeZone);
        const hStart = Math.max(hStartFull, start);
        const hEndClamped = Math.min(hEndFull, end);
        if (hEndClamped > hStart) {
          const label = bucketMinutes === 60 ? hourLabelFromParts(startParts, h) : hourMinuteLabelFromParts(startParts, h, m);
          hourBounds.push({ label, start: hStart, end: hEndClamped });
        }
      }
    }
    if (hourBounds.length >= 2) {
      bucketBounds = hourBounds;
    } else {
      bucket = 'day';
      bucketBounds = dayBounds;
    }
  } else if (bucket === 'week' && dayBounds.length > 1) {
    const weekBounds = [];
    let wk = { year: startParts.year, month: startParts.month, day: startParts.day };
    while (true) {
      const label = ymdFromParts(wk);
      const wkStartFull = zonedTimeToUtcMs(wk.year, wk.month, wk.day, 0, 0, 0, timeZone);
      const wkEndParts = addDaysToParts(wk, 7);
      const wkEndFull = zonedTimeToUtcMs(wkEndParts.year, wkEndParts.month, wkEndParts.day, 0, 0, 0, timeZone);
      const wkStart = Math.max(wkStartFull, start);
      const wkEnd = Math.min(wkEndFull, end);
      if (wkEnd > wkStart) {
        weekBounds.push({ label, start: wkStart, end: wkEnd });
      }
      if (!(wkEndFull < end)) break;
      wk = wkEndParts;
    }
    if (weekBounds.length >= 2) {
      bucketBounds = weekBounds;
    } else {
      bucket = 'day';
      bucketBounds = dayBounds;
    }
  }

  if (!bucketBounds.length) {
    return { days: 0, series: [], topProducts: [], topCountries: [], trendingUp: [], trendingDown: [], summary: {} };
  }

  const overallStart = start;
  const overallEnd = end;

  // Keep Shopify truth "today" warm in the background (non-blocking).
  // Full-range reconciliation can be slow; reports should remain responsive.
  if (shop) {
    try {
      const today = store.getRangeBounds('today', Date.now(), timeZone);
      nudgeTruthWarmupDetached(shop, today.start, today.end, 'today');
    } catch (_) {}
  }

  const sb = await fetchSessionsAndBouncesByDayBounds(db, bucketBounds, overallStart, overallEnd, filter);
  const sessionsPerDay = sb.sessionsPerDay || {};
  const bouncePerDay = sb.bouncePerDay || {};
  const unitsPerDay = shop ? await fetchUnitsSoldByDayBounds(db, shop, bucketBounds, overallStart, overallEnd) : {};

  // Fetch orders + revenue per day from Shopify truth (Total sales: bucket by processed_at, subtract refunds)
  const ratesToGbp = await fx.getRatesToGbp();
  const revenuePerDay = {};
  const ordersPerDay = {};
  const returningCustomersSetByDay = {};
  let newCustomerOrders = 0, returningCustomerOrders = 0;
  const rawKpi = await store.getSetting('kpi_ui_config_v1');
  const returnsRefundsAttribution = parseReturnsRefundsAttributionFromKpiConfig(rawKpi);
  if (shop) {
    const orderRows = await fetchPaidOrderRowsWithReturningFacts(db, shop, overallStart, overallEnd);
    for (const row of orderRows) {
      const saleAt = Number(row.processed_at != null ? row.processed_at : row.created_at);
      let dayLabel = null;
      for (const db_day of bucketBounds) {
        if (saleAt >= db_day.start && saleAt < db_day.end) {
          dayLabel = db_day.label;
          break;
        }
      }
      if (!dayLabel) continue;
      const price = parseFloat(row.total_price);
      const currency = (row.currency || 'GBP').toUpperCase();
      const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
      const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
      revenuePerDay[dayLabel] = (revenuePerDay[dayLabel] || 0) + gbp;
      ordersPerDay[dayLabel] = (ordersPerDay[dayLabel] || 0) + 1;
      const isReturning = isReturningOrderRow(row);
      const cid = row && row.customer_id != null ? String(row.customer_id).trim() : '';
      if (isReturning && cid) {
        if (!returningCustomersSetByDay[dayLabel]) returningCustomersSetByDay[dayLabel] = new Set();
        returningCustomersSetByDay[dayLabel].add(cid);
      }
      if (isReturning) returningCustomerOrders += 1;
      else newCustomerOrders += 1;
    }
    const refundsPerDay = await fetchRefundsPerDay(db, shop, bucketBounds, overallStart, overallEnd, returnsRefundsAttribution, ratesToGbp);
    for (const db_day of bucketBounds) {
      const refundGbp = refundsPerDay[db_day.label] || 0;
      revenuePerDay[db_day.label] = Math.max(0, (revenuePerDay[db_day.label] || 0) - refundGbp);
    }
  }

  // Fetch Shopify sessions per day (from shopify_sessions_snapshots)
  const shopifySessionsPerDay = {};
  if (shop && bucket === 'day') {
    try {
      const dayLabels = bucketBounds.map(d => d.label);
      const shopifyRows = await db.all(
        config.dbUrl
          ? `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = $1 AND day_ymd >= $2 AND day_ymd <= $3
             GROUP BY day_ymd`
          : `SELECT day_ymd, MAX(sessions_count) AS sessions_count
             FROM shopify_sessions_snapshots
             WHERE shop = ? AND day_ymd >= ? AND day_ymd <= ?`,
        [shop, dayLabels[0], dayLabels[dayLabels.length - 1]]
      );
      for (const r of shopifyRows) {
        shopifySessionsPerDay[r.day_ymd] = Number(r.sessions_count) || 0;
      }
    } catch (_) {}
  }

  const series = bucketBounds.map(function(db_day) {
    const sessions = sessionsPerDay[db_day.label] || 0;
    const orders = ordersPerDay[db_day.label] || 0;
    const revenue = Math.round((revenuePerDay[db_day.label] || 0) * 100) / 100;
    const units = unitsPerDay[db_day.label] || 0;
    const convRate = percentOrNull(orders, sessions, { decimals: 1 });
    const shopifySessions = bucket === 'day' ? (shopifySessionsPerDay[db_day.label] || 0) : 0;
    const shopifyConvRate = percentOrNull(orders, shopifySessions, { decimals: 1 });
    const aov = ratioOrNull(revenue, orders, { decimals: 2 });
    const bounced = bouncePerDay[db_day.label] || 0;
    const bounceRate = percentOrNull(bounced, sessions, { decimals: 1, clampMax: 100 });
    return {
      date: db_day.label,
      revenue,
      orders,
      units,
      sessions,
      convRate,
      shopifyConvRate,
      returningCustomerOrders: returningCustomersSetByDay[db_day.label] ? returningCustomersSetByDay[db_day.label].size : 0,
      aov,
      bounceRate,
    };
  });

  // Top products (range)
  let topProducts = [];
  if (shop) {
    try {
      const hasLineNet = await lineItemsHasLineNet(db);
      const revenueExpr = hasLineNet
        ? 'COALESCE(SUM(COALESCE(li.line_net, li.line_revenue)), 0)'
        : 'COALESCE(SUM(li.line_revenue), 0)';
      const hasProcessedAt = await lineItemsHasOrderProcessedAt(db);
      const tsExpr = hasProcessedAt ? 'COALESCE(li.order_processed_at, li.order_created_at)' : 'li.order_created_at';
      const productRows = await db.all(
        config.dbUrl
          ? `SELECT TRIM(li.product_id) AS product_id, MAX(NULLIF(TRIM(li.title), '')) AS title, ${revenueExpr} AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = $1 AND (${tsExpr} >= $2 AND ${tsExpr} < $3)
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status IN ('paid', 'partially_paid')
               AND li.product_id IS NOT NULL AND TRIM(li.product_id) != ''
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT ${DASHBOARD_TOP_TABLE_MAX_ROWS}`
          : `SELECT TRIM(li.product_id) AS product_id, MAX(NULLIF(TRIM(li.title), '')) AS title, ${revenueExpr} AS revenue, COUNT(DISTINCT li.order_id) AS orders
             FROM orders_shopify_line_items li
             WHERE li.shop = ? AND (${tsExpr} >= ? AND ${tsExpr} < ?)
               AND (li.order_test IS NULL OR li.order_test = 0) AND li.order_cancelled_at IS NULL AND li.order_financial_status IN ('paid', 'partially_paid')
               AND li.product_id IS NOT NULL AND TRIM(li.product_id) != ''
             GROUP BY TRIM(li.product_id)
             ORDER BY revenue DESC
             LIMIT ${DASHBOARD_TOP_TABLE_MAX_ROWS}`,
        [shop, overallStart, overallEnd]
      );
      let token = null;
      try { token = await salesTruth.getAccessToken(shop); } catch (_) {}
      const productIds = productRows.map(r => r.product_id).filter(Boolean);
      const metaMap = await fetchProductMetaMap(shop, token, productIds);
      topProducts = productRows.map(function(r) {
        const pid = r.product_id ? String(r.product_id) : '';
        const meta = metaMap.get(pid);
        return {
          product_id: pid || null,
          title: r.title || (meta && meta.title ? String(meta.title) : null) || 'Unknown',
          handle: meta && meta.handle ? String(meta.handle) : null,
          revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
          orders: Number(r.orders) || 0,
          thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
        };
      });
      if (!topProducts.length) {
        const rawTop = await fallbackTopProductsFromOrdersRawJson(db, shop, overallStart, overallEnd, ratesToGbp, { limit: DASHBOARD_TOP_TABLE_MAX_ROWS });
        if (rawTop && rawTop.length) {
          let fallbackToken = token;
          if (!fallbackToken) {
            try { fallbackToken = await salesTruth.getAccessToken(shop); } catch (_) {}
          }
          const fallbackIds = rawTop.map((r) => r.product_id).filter(Boolean);
          const fallbackMetaMap = await fetchProductMetaMap(shop, fallbackToken, fallbackIds);
          topProducts = rawTop.map(function(r) {
            const pid = r.product_id ? String(r.product_id) : '';
            const meta = fallbackMetaMap.get(pid);
            return {
              title: r.title || (meta && meta.title ? String(meta.title) : null) || 'Unknown',
              handle: meta && meta.handle ? String(meta.handle) : null,
              revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
              orders: Number(r.orders) || 0,
              thumb_url: meta && meta.thumb_url ? String(meta.thumb_url) : null,
            };
          });
        }
      }
    } catch (e) {
      if (e && typeof e.message === 'string') console.error('[dashSeries] topProducts err', e.message);
    }
  }

  let sessionsByHandleAll = new Map();
  try { sessionsByHandleAll = await fetchSessionCountsByProductHandleAll(db, overallStart, overallEnd, filter); } catch (_) {}
  topProducts = fillTopProductsWithSessionsFallback(topProducts, sessionsByHandleAll, { limit: DASHBOARD_TOP_TABLE_MAX_ROWS });

  // Top countries by revenue (range)
  let topCountries = [];
  if (shop) {
    try {
      const countryRows = await db.all(
        config.dbUrl
          ? `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = $1 AND created_at >= $2 AND created_at < $3
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`
          : `SELECT raw_json, total_price, currency
             FROM orders_shopify
             WHERE shop = ? AND created_at >= ? AND created_at < ?
               AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'`,
        [shop, overallStart, overallEnd]
      );
      const countryMap = {};
      for (const r of countryRows) {
        let cc = 'XX';
        try {
          const json = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : r.raw_json;
          cc = (json && json.shipping_address && json.shipping_address.country_code) ||
               (json && json.billing_address && json.billing_address.country_code) || 'XX';
        } catch (_) {}
        cc = String(cc).toUpperCase().slice(0, 2) || 'XX';
        if (cc === 'UK') cc = 'GB';
        const price = parseFloat(r.total_price);
        const currency = (r.currency || 'GBP').toUpperCase();
        const gbpVal = Number.isFinite(price) ? fx.convertToGbp(price, currency, ratesToGbp) : 0;
        const gbp = (typeof gbpVal === 'number' && Number.isFinite(gbpVal)) ? gbpVal : 0;
        if (!countryMap[cc]) countryMap[cc] = { revenue: 0, orders: 0 };
        countryMap[cc].revenue += gbp;
        countryMap[cc].orders += 1;
      }
      topCountries = Object.entries(countryMap)
        .map(function(entry) {
          const code = entry[0];
          return { country: code, country_code: code, revenue: Math.round(entry[1].revenue * 100) / 100, orders: entry[1].orders };
        })
        .sort(function(a, b) { return b.revenue - a.revenue; })
        .slice(0, DASHBOARD_TOP_TABLE_MAX_ROWS);
    } catch (_) {}
  }

  let sessionsByCountryAll = new Map();
  try { sessionsByCountryAll = await fetchSessionCountsByCountryCodeAll(db, overallStart, overallEnd, filter); } catch (_) {}
  topCountries = fillTopCountriesWithSessionsFallback(topCountries, sessionsByCountryAll, { limit: DASHBOARD_TOP_TABLE_MAX_ROWS });

  // Trending up/down vs previous equivalent period (preset: today, yesterday, 3d, 7d, 14d or legacy 3,7,14)
  let trendingUp = [];
  let trendingDown = [];
  if (shop) {
    let nowBounds = { start: overallStart, end: overallEnd };
    let prevBounds = getCompareWindow(rangeKey, { start: overallStart, end: overallEnd }, nowMs, timeZone);
    const preset = typeof trendingPresetOrDays === 'string' ? trendingPresetOrDays.trim().toLowerCase() : '';
    const numericDays = typeof trendingPresetOrDays === 'number' && [3, 7, 14].indexOf(trendingPresetOrDays) >= 0
      ? trendingPresetOrDays
      : (preset === '3d' ? 3 : preset === '7d' ? 7 : preset === '14d' ? 14 : null);
    if (preset === 'today') {
      const todayBounds = store.getRangeBounds('today', nowMs, timeZone);
      if (todayBounds && Number.isFinite(todayBounds.start) && Number.isFinite(todayBounds.end)) {
        nowBounds = { start: todayBounds.start, end: Math.min(todayBounds.end, nowMs) };
        prevBounds = getCompareWindow('today', nowBounds, nowMs, timeZone);
      }
    } else if (preset === 'yesterday') {
      const yesterdayBounds = store.getRangeBounds('yesterday', nowMs, timeZone);
      if (yesterdayBounds && Number.isFinite(yesterdayBounds.start) && Number.isFinite(yesterdayBounds.end)) {
        nowBounds = { start: yesterdayBounds.start, end: yesterdayBounds.end };
        prevBounds = getCompareWindow('yesterday', nowBounds, nowMs, timeZone);
      }
    } else if (numericDays != null) {
      const dayMs = 24 * 60 * 60 * 1000;
      const trendEnd = overallEnd;
      const trendStart = trendEnd - numericDays * dayMs;
      const platformStart = getPlatformStartMs(nowMs, timeZone);
      const prevEnd = trendStart;
      const prevStart = Math.max(platformStart || 0, prevEnd - numericDays * dayMs);
      if (prevEnd > prevStart && trendEnd > trendStart) {
        nowBounds = { start: trendStart, end: trendEnd };
        prevBounds = { start: prevStart, end: prevEnd };
      }
    }
    if (prevBounds) {
      try {
        const t = await fetchTrendingProducts(db, shop, nowBounds, prevBounds, filter);
        trendingUp = t && t.trendingUp ? t.trendingUp : [];
        trendingDown = t && t.trendingDown ? t.trendingDown : [];
      } catch (e) {
        if (e && typeof e.message === 'string') console.error('[dashSeries] trending err', e.message);
      }
    }
  }

  // Ad spend per bucket (hour/day/week): allocate hourly spend across bucket windows.
  let adSpendByBucketLabel = {};
  for (const b of bucketBounds) adSpendByBucketLabel[b.label] = 0;
  try {
    const adsDb = require('../ads/adsDb');
    if (adsDb && typeof adsDb.getAdsPool === 'function') {
      const pool = adsDb.getAdsPool();
      if (pool) {
        const startSec = overallStart / 1000;
        const endSec = overallEnd / 1000;
        const queryStart = startSec - 3600; // include the prior hour for partial-hour buckets
        const spendRows = await pool.query(
          `SELECT EXTRACT(EPOCH FROM date_trunc('hour', hour_ts))::bigint AS hour_sec,
                  COALESCE(SUM(spend_gbp), 0) AS spend_gbp
           FROM google_ads_spend_hourly
           WHERE hour_ts >= to_timestamp($1) AND hour_ts < to_timestamp($2)
           GROUP BY 1
           ORDER BY 1`,
          [queryStart, endSec]
        );
        if (spendRows && spendRows.rows) {
          for (const r of spendRows.rows) {
            const hourStartMs = (Number(r.hour_sec) || 0) * 1000;
            const hourEndMs = hourStartMs + 60 * 60 * 1000;
            const spend = Number(r.spend_gbp) || 0;
            if (!(spend > 0)) continue;
            for (const b of bucketBounds) {
              const overlapStart = Math.max(hourStartMs, b.start);
              const overlapEnd = Math.min(hourEndMs, b.end);
              const overlapMs = overlapEnd - overlapStart;
              if (!(overlapMs > 0)) continue;
              adSpendByBucketLabel[b.label] += spend * (overlapMs / (60 * 60 * 1000));
            }
          }
        }
      }
    }
  } catch (_) {}
  for (const s of series) {
    const v = adSpendByBucketLabel[s.date] || 0;
    s.adSpend = Math.round(v * 100) / 100;
  }

  // Device breakdown (desktop vs mobile vs tablet)
  let desktopSessions = 0, mobileSessions = 0;
  try {
    const ph = config.dbUrl ? ['$1', '$2'] : ['?', '?'];
    const deviceRows = await db.all(
      'SELECT LOWER(COALESCE(s.ua_device_type, \'unknown\')) AS device, COUNT(*) AS n FROM sessions s WHERE s.started_at >= ' + ph[0] + ' AND s.started_at < ' + ph[1] + filter.sql.replace(/sessions\./g, 's.') + ' GROUP BY LOWER(COALESCE(s.ua_device_type, \'unknown\'))',
      [overallStart, overallEnd, ...filter.params]
    );
    for (const r of deviceRows) {
      const d = (r.device || '').trim();
      if (d === 'desktop') desktopSessions += Number(r.n) || 0;
      else if (d === 'mobile' || d === 'tablet') mobileSessions += Number(r.n) || 0;
    }
  } catch (_) {}

  // Returning/new order counts are accumulated from the same order rows used for series.

  // Summary totals
  let totalRevenue = 0, totalOrders = 0, totalSessions = 0, totalAdSpend = 0, totalBounced = 0;
  let aovHigh = 0, aovLow = Infinity;
  for (const s of series) {
    totalRevenue += s.revenue;
    totalOrders += s.orders;
    totalSessions += s.sessions;
    totalAdSpend += s.adSpend;
    totalBounced += (bouncePerDay[s.date] || 0);
    if (s.orders > 0) {
      if (s.aov > aovHigh) aovHigh = s.aov;
      if (s.aov < aovLow) aovLow = s.aov;
    }
  }
  if (!Number.isFinite(aovLow) || aovLow === Infinity) aovLow = 0;
  const avgConvRate = percentOrNull(totalOrders, totalSessions, { decimals: 1 });
  const avgAov = ratioOrNull(totalRevenue, totalOrders, { decimals: 2 });
  const bounceRate = percentOrNull(totalBounced, totalSessions, { decimals: 1, clampMax: 100 });
  const roas = ratioOrNull(totalRevenue, totalAdSpend, { decimals: 2 });

  return {
    days: dayBounds.length,
    series,
    topProducts,
    topCountries,
    trendingUp,
    trendingDown,
    bucket,
    summary: {
      revenue: Math.round(totalRevenue * 100) / 100,
      orders: totalOrders,
      sessions: totalSessions,
      convRate: avgConvRate,
      aov: avgAov,
      aovHigh: Math.round(aovHigh * 100) / 100,
      aovLow: Math.round(aovLow * 100) / 100,
      bounceRate,
      adSpend: Math.round(totalAdSpend * 100) / 100,
      roas,
      desktopSessions,
      mobileSessions,
      newCustomerOrders,
      returningCustomerOrders,
    },
  };
}

function parseDateParts(formatted) {
  // en-GB: DD/MM/YYYY
  const parts = formatted.split('/');
  return {
    day: parseInt(parts[0], 10),
    month: parseInt(parts[1], 10),
    year: parseInt(parts[2], 10),
  };
}

function getTimeZoneOffsetMs(timeZone, date) {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC', hourCycle: 'h23' });
  const tzStr = date.toLocaleString('en-US', { timeZone, hourCycle: 'h23' });
  const utc = new Date(utcStr);
  const tz = new Date(tzStr);
  return utc - tz;
}

function zonedTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  return utcGuess.getTime() - offset;
}

module.exports = { getDashboardSeries };
