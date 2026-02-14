const Sentry = require('@sentry/node');
const express = require('express');
const { getDb } = require('../db');
const store = require('../store');
const fx = require('../fx');
const { percentOrNull, roundTo } = require('../metrics');
const salesTruth = require('../salesTruth');
const shopifyLandingMeta = require('../shopifyLandingMeta');

const router = express.Router();

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function isCustomDayKey(v) {
  return typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
}

function isCustomRangeKey(v) {
  return typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
}

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  // UI uses 7days/14days/30days in some places; normalize to server keys.
  if (r === '7days') return '7d';
  if (r === '14days') return '14d';
  if (r === '30days') return '30d';
  if (ALLOWED_RANGE.has(r) || isCustomDayKey(r) || isCustomRangeKey(r)) return r;
  return 'today';
}

function normalizeMode(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'checkout' || s === 'checkouts') return 'checkout';
  return 'cart';
}

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeCurrency(code) {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  if (!c) return fx.BASE;
  return c.slice(0, 8);
}

function pickBucket(startMs, endMs) {
  const span = Math.max(0, Number(endMs) - Number(startMs));
  // Hour buckets for single-day / small ranges. Otherwise day-by-day.
  if (span <= 36 * 60 * 60 * 1000) return { bucket: 'hour', stepMs: 60 * 60 * 1000 };
  return { bucket: 'day', stepMs: 24 * 60 * 60 * 1000 };
}

function sessionCountryExpr(alias) {
  const a = alias ? String(alias).trim() : 's';
  return `UPPER(SUBSTR(COALESCE(NULLIF(TRIM(${a}.country_code), ''), NULLIF(TRIM(${a}.cf_country), ''), 'XX'), 1, 2))`;
}

function handleExpr(alias) {
  const a = alias ? String(alias).trim() : 's';
  return `LOWER(TRIM(${a}.first_product_handle))`;
}

function buildOrPairsWhere(pairs, leftSql, rightSql, baseParamIndex) {
  // Returns: { sql: "(left=? AND right=?) OR ...", params: [..] } but leaves placeholdering to DB adapter.
  // baseParamIndex is unused (kept for readability with other modules).
  const list = Array.isArray(pairs) ? pairs : [];
  const parts = [];
  const params = [];
  for (const p of list) {
    if (!p) continue;
    const l = p.left != null ? String(p.left) : '';
    const r = p.right != null ? String(p.right) : '';
    if (!l || !r) continue;
    parts.push(`(${leftSql} = ? AND ${rightSql} = ?)`);
    params.push(l, r);
  }
  return { sql: parts.length ? '(' + parts.join(' OR ') + ')' : '', params };
}

function resolveBoundsFromReq(req) {
  const now = Date.now();
  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '');
  const tzRaw = req && req.query ? (req.query.timezone || req.query.timeZone || '') : '';
  const tz = (typeof tzRaw === 'string' && tzRaw.trim()) ? tzRaw.trim() : store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, tz);
  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : now;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : now;
  return { now, rangeKey, tz, start: Math.min(start, end), end: Math.max(start, end) };
}

function abandonedModeSql(mode) {
  return mode === 'checkout'
    ? `AND s.checkout_started_at IS NOT NULL`
    : `AND COALESCE(s.cart_qty, 0) > 0`;
}

async function sumToGbp(amount, currency, ratesToGbp) {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n) || n === 0) return 0;
  const cur = normalizeCurrency(currency);
  const gbp = fx.convertToGbp(n, cur, ratesToGbp);
  return typeof gbp === 'number' && Number.isFinite(gbp) ? gbp : 0;
}

router.get('/series', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  const mode = normalizeMode(req && req.query ? req.query.mode : '');
  const { rangeKey, tz, start, end } = resolveBoundsFromReq(req);
  Sentry.addBreadcrumb({ category: 'api', message: 'abandonedCarts.series', data: { rangeKey, mode } });

  try {
    const { bucket, stepMs } = pickBucket(start, end);
    const bucketCount = Math.max(1, Math.min(4000, Math.ceil((end - start) / stepMs)));
    const db = getDb();

    const rows = await db.all(
      `
        SELECT
          ((s.abandoned_at - ?) / ?) AS bucket,
          COALESCE(NULLIF(TRIM(s.cart_currency), ''), ?) AS currency,
          COUNT(*) AS abandoned,
          COALESCE(SUM(COALESCE(s.cart_value, 0)), 0) AS value_sum
        FROM sessions s
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
        GROUP BY bucket, currency
        ORDER BY bucket ASC
      `,
      [start, stepMs, fx.BASE, start, end]
    );

    const ratesToGbp = await fx.getRatesToGbp().catch(() => null);
    const points = new Array(bucketCount).fill(null).map((_, i) => ({
      ts: start + i * stepMs,
      abandoned: 0,
      abandoned_value_gbp: 0,
    }));

    for (const r of rows || []) {
      const b = r && r.bucket != null ? Number(r.bucket) : NaN;
      if (!Number.isFinite(b)) continue;
      const idx = Math.max(0, Math.trunc(b));
      if (idx < 0 || idx >= points.length) continue;
      const abandoned = r && r.abandoned != null ? Number(r.abandoned) : 0;
      const sum = r && r.value_sum != null ? Number(r.value_sum) : 0;
      const cur = normalizeCurrency(r && r.currency != null ? String(r.currency) : fx.BASE);
      points[idx].abandoned += Number.isFinite(abandoned) ? Math.max(0, Math.trunc(abandoned)) : 0;
      points[idx].abandoned_value_gbp += await sumToGbp(Number.isFinite(sum) ? sum : 0, cur, ratesToGbp);
    }

    let totalAbandonedGbp = 0;
    for (const p of points) totalAbandonedGbp += Number(p.abandoned_value_gbp) || 0;
    totalAbandonedGbp = roundTo(totalAbandonedGbp, 2) || 0;

    // Round per-point values for stable tooltips.
    points.forEach((p) => { p.abandoned_value_gbp = roundTo(p.abandoned_value_gbp, 2) || 0; });

    res.json({
      rangeKey,
      mode,
      bucket,
      start,
      end,
      totalAbandonedGbp,
      series: points,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'abandonedCarts.series', rangeKey, mode } });
    console.error('[abandoned-carts.series]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/top-countries', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  const mode = normalizeMode(req && req.query ? req.query.mode : '');
  const limit = clampInt(req && req.query ? req.query.limit : null, 5, 1, 20);
  const { rangeKey, start, end } = resolveBoundsFromReq(req);
  Sentry.addBreadcrumb({ category: 'api', message: 'abandonedCarts.topCountries', data: { rangeKey, mode, limit } });

  try {
    const db = getDb();
    const countrySql = sessionCountryExpr('s');

    const top = await db.all(
      `
        SELECT ${countrySql} AS country, COUNT(*) AS abandoned
        FROM sessions s
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
        GROUP BY ${countrySql}
        ORDER BY abandoned DESC
        LIMIT ?
      `,
      [start, end, limit]
    );

    const countries = (top || [])
      .map((r) => (r && r.country != null ? String(r.country).trim().toUpperCase().slice(0, 2) : ''))
      .filter(Boolean);
    if (!countries.length) {
      return res.json({ rangeKey, mode, rows: [] });
    }

    const inPh = new Array(countries.length).fill('?').join(', ');
    const baseParams = [start, end, ...countries];

    // Abandoned value (by currency) for the top countries.
    const valRows = await db.all(
      `
        SELECT ${countrySql} AS country,
               COALESCE(NULLIF(TRIM(s.cart_currency), ''), ?) AS currency,
               COALESCE(SUM(COALESCE(s.cart_value, 0)), 0) AS value_sum
        FROM sessions s
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
          AND ${countrySql} IN (${inPh})
        GROUP BY ${countrySql}, currency
      `,
      [fx.BASE, ...baseParams]
    );

    // Checkout starts in range (context metric).
    const checkoutRows = await db.all(
      `
        SELECT ${countrySql} AS country, COUNT(*) AS checkout_sessions
        FROM sessions s
        WHERE s.checkout_started_at IS NOT NULL
          AND s.checkout_started_at >= ? AND s.checkout_started_at < ?
          AND ${countrySql} IN (${inPh})
        GROUP BY ${countrySql}
      `,
      [start, end, ...countries]
    );

    // Denominator for % abandoned:
    // - cart mode: sessions with carts started in range (started_at bounds)
    // - checkout mode: checkout sessions (above)
    let denomByCountry = new Map();
    if (mode === 'cart') {
      const cartRows = await db.all(
        `
          SELECT ${countrySql} AS country, COUNT(*) AS cart_sessions
          FROM sessions s
          WHERE s.started_at >= ? AND s.started_at < ?
            AND COALESCE(s.cart_qty, 0) > 0
            AND ${countrySql} IN (${inPh})
          GROUP BY ${countrySql}
        `,
        [start, end, ...countries]
      );
      denomByCountry = new Map((cartRows || []).map((r) => [String(r.country || '').toUpperCase().slice(0, 2), Number(r.cart_sessions) || 0]));
    } else {
      denomByCountry = new Map((checkoutRows || []).map((r) => [String(r.country || '').toUpperCase().slice(0, 2), Number(r.checkout_sessions) || 0]));
    }

    const checkoutByCountry = new Map((checkoutRows || []).map((r) => [String(r.country || '').toUpperCase().slice(0, 2), Number(r.checkout_sessions) || 0]));

    const ratesToGbp = await fx.getRatesToGbp().catch(() => null);
    const valueByCountry = new Map(); // country -> gbp sum
    for (const r of valRows || []) {
      const cc = r && r.country != null ? String(r.country).toUpperCase().slice(0, 2) : '';
      if (!cc) continue;
      const cur = normalizeCurrency(r && r.currency != null ? String(r.currency) : fx.BASE);
      const sum = r && r.value_sum != null ? Number(r.value_sum) : 0;
      const gbp = await sumToGbp(Number.isFinite(sum) ? sum : 0, cur, ratesToGbp);
      valueByCountry.set(cc, (valueByCountry.get(cc) || 0) + gbp);
    }

    const rows = (top || []).map((r) => {
      const cc = r && r.country != null ? String(r.country).toUpperCase().slice(0, 2) : 'XX';
      const abandoned = r && r.abandoned != null ? Math.max(0, Math.trunc(Number(r.abandoned) || 0)) : 0;
      const checkoutSessions = checkoutByCountry.get(cc) || 0;
      const denom = denomByCountry.get(cc) || 0;
      const pct = percentOrNull(abandoned, denom, { decimals: 1 });
      const value = roundTo(valueByCountry.get(cc) || 0, 2) || 0;
      return {
        country: cc || 'XX',
        abandoned,
        abandoned_pct: pct,
        checkout_sessions: Math.max(0, Math.trunc(checkoutSessions)),
        abandoned_value_gbp: value,
      };
    });

    res.json({ rangeKey, mode, rows });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'abandonedCarts.topCountries', rangeKey, mode } });
    console.error('[abandoned-carts.top-countries]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/top-country-products', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  const mode = normalizeMode(req && req.query ? req.query.mode : '');
  const limit = clampInt(req && req.query ? req.query.limit : null, 5, 1, 20);
  const { rangeKey, start, end } = resolveBoundsFromReq(req);
  Sentry.addBreadcrumb({ category: 'api', message: 'abandonedCarts.topCountryProducts', data: { rangeKey, mode, limit } });

  try {
    const db = getDb();
    const countrySql = sessionCountryExpr('s');
    const hSql = handleExpr('s');

    const top = await db.all(
      `
        SELECT ${countrySql} AS country, ${hSql} AS handle, COUNT(*) AS abandoned
        FROM sessions s
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
          AND s.first_product_handle IS NOT NULL
          AND TRIM(s.first_product_handle) != ''
        GROUP BY ${countrySql}, ${hSql}
        ORDER BY abandoned DESC
        LIMIT ?
      `,
      [start, end, limit]
    );

    const pairs = (top || []).map((r) => ({
      country: r && r.country != null ? String(r.country).toUpperCase().slice(0, 2) : '',
      handle: r && r.handle != null ? String(r.handle).trim().toLowerCase().slice(0, 128) : '',
      abandoned: r && r.abandoned != null ? Math.max(0, Math.trunc(Number(r.abandoned) || 0)) : 0,
    })).filter((p) => p.country && p.handle);

    if (!pairs.length) {
      return res.json({ rangeKey, mode, rows: [] });
    }

    const wherePairs = buildOrPairsWhere(
      pairs.map((p) => ({ left: p.country, right: p.handle })),
      countrySql,
      hSql
    );

    const ratesToGbp = await fx.getRatesToGbp().catch(() => null);

    // Abandoned value sums (by currency) for each (country, handle).
    const valRows = await db.all(
      `
        SELECT ${countrySql} AS country,
               ${hSql} AS handle,
               COALESCE(NULLIF(TRIM(s.cart_currency), ''), ?) AS currency,
               COALESCE(SUM(COALESCE(s.cart_value, 0)), 0) AS value_sum
        FROM sessions s
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
          AND s.first_product_handle IS NOT NULL
          AND TRIM(s.first_product_handle) != ''
          AND ${wherePairs.sql}
        GROUP BY ${countrySql}, ${hSql}, currency
      `,
      [fx.BASE, start, end, ...wherePairs.params]
    );

    const valueByKey = new Map(); // "CC|handle" -> gbp sum
    for (const r of valRows || []) {
      const cc = r && r.country != null ? String(r.country).toUpperCase().slice(0, 2) : '';
      const handle = r && r.handle != null ? String(r.handle).trim().toLowerCase().slice(0, 128) : '';
      if (!cc || !handle) continue;
      const cur = normalizeCurrency(r && r.currency != null ? String(r.currency) : fx.BASE);
      const sum = r && r.value_sum != null ? Number(r.value_sum) : 0;
      const gbp = await sumToGbp(Number.isFinite(sum) ? sum : 0, cur, ratesToGbp);
      const key = cc + '|' + handle;
      valueByKey.set(key, (valueByKey.get(key) || 0) + gbp);
    }

    // Checkout starts for each (country, handle) in range (context metric + checkout-mode denominator).
    const checkoutRows = await db.all(
      `
        SELECT ${countrySql} AS country, ${hSql} AS handle, COUNT(*) AS checkout_sessions
        FROM sessions s
        WHERE s.first_product_handle IS NOT NULL
          AND TRIM(s.first_product_handle) != ''
          AND s.checkout_started_at IS NOT NULL
          AND s.checkout_started_at >= ? AND s.checkout_started_at < ?
          AND ${wherePairs.sql}
        GROUP BY ${countrySql}, ${hSql}
      `,
      [start, end, ...wherePairs.params]
    );
    const checkoutByKey = new Map((checkoutRows || []).map((r) => {
      const cc = r && r.country != null ? String(r.country).toUpperCase().slice(0, 2) : '';
      const h = r && r.handle != null ? String(r.handle).trim().toLowerCase().slice(0, 128) : '';
      const k = cc && h ? (cc + '|' + h) : '';
      return [k, k ? (Number(r.checkout_sessions) || 0) : 0];
    }).filter((e) => e[0]));

    // Denominator for % abandoned:
    // - cart mode: sessions with carts started in range (started_at bounds) for the (country, handle)
    // - checkout mode: checkout sessions (above)
    let denomByKey = new Map();
    if (mode === 'cart') {
      const cartRows = await db.all(
        `
          SELECT ${countrySql} AS country, ${hSql} AS handle, COUNT(*) AS cart_sessions
          FROM sessions s
          WHERE s.first_product_handle IS NOT NULL
            AND TRIM(s.first_product_handle) != ''
            AND s.started_at >= ? AND s.started_at < ?
            AND COALESCE(s.cart_qty, 0) > 0
            AND ${wherePairs.sql}
          GROUP BY ${countrySql}, ${hSql}
        `,
        [start, end, ...wherePairs.params]
      );
      denomByKey = new Map((cartRows || []).map((r) => {
        const cc = r && r.country != null ? String(r.country).toUpperCase().slice(0, 2) : '';
        const h = r && r.handle != null ? String(r.handle).trim().toLowerCase().slice(0, 128) : '';
        const k = cc && h ? (cc + '|' + h) : '';
        return [k, k ? (Number(r.cart_sessions) || 0) : 0];
      }).filter((e) => e[0]));
    } else {
      denomByKey = checkoutByKey;
    }

    // Resolve product titles for the top handles (best-effort).
    const shop = salesTruth.resolveShopForSales('');
    let accessToken = '';
    try { accessToken = shop ? await salesTruth.getAccessToken(shop) : ''; } catch (_) { accessToken = ''; }
    accessToken = typeof accessToken === 'string' ? accessToken.trim() : '';
    const titleByHandle = new Map();
    if (shop && accessToken) {
      const uniqueHandles = Array.from(new Set(pairs.map((p) => p.handle))).slice(0, 20);
      await Promise.all(uniqueHandles.map(async (h) => {
        const t = await shopifyLandingMeta.getProductTitleByHandle(shop, accessToken, h);
        if (t) titleByHandle.set(h, String(t).trim().slice(0, 256));
      }));
    }

    const rows = pairs.map((p) => {
      const key = p.country + '|' + p.handle;
      const checkoutSessions = checkoutByKey.get(key) || 0;
      const denom = denomByKey.get(key) || 0;
      const pct = percentOrNull(p.abandoned, denom, { decimals: 1 });
      const value = roundTo(valueByKey.get(key) || 0, 2) || 0;
      const title = titleByHandle.get(p.handle) || p.handle;
      return {
        country: p.country,
        product_handle: p.handle,
        product_title: title,
        abandoned: p.abandoned,
        abandoned_pct: pct,
        checkout_sessions: Math.max(0, Math.trunc(checkoutSessions)),
        abandoned_value_gbp: value,
      };
    });

    res.json({ rangeKey, mode, rows });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'abandonedCarts.topCountryProducts', rangeKey, mode } });
    console.error('[abandoned-carts.top-country-products]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/sessions', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const mode = normalizeMode(req && req.query ? req.query.mode : '');
  const limit = clampInt(req && req.query ? req.query.limit : null, 20, 1, 100);
  const offset = clampInt(req && req.query ? req.query.offset : null, 0, 0, 1_000_000);
  const { rangeKey, start, end } = resolveBoundsFromReq(req);
  Sentry.addBreadcrumb({ category: 'api', message: 'abandonedCarts.sessions', data: { rangeKey, mode, limit, offset } });

  try {
    const db = getDb();
    const countrySql = sessionCountryExpr('s');

    const countRow = await db.get(
      `
        SELECT COUNT(*) AS n
        FROM sessions s
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
      `,
      [start, end]
    );
    const total = countRow && countRow.n != null ? Number(countRow.n) || 0 : 0;

    const rows = await db.all(
      `
        SELECT s.*, v.is_returning AS visitor_is_returning, v.returning_count,
          COALESCE(s.country_code, v.last_country) AS session_country,
          v.device, v.network_speed
        FROM sessions s
        LEFT JOIN visitors v ON s.visitor_id = v.visitor_id
        WHERE s.abandoned_at >= ? AND s.abandoned_at < ?
          AND s.has_purchased = 0
          AND s.is_abandoned = 1
          ${abandonedModeSql(mode)}
        ORDER BY s.abandoned_at DESC, s.last_seen DESC
        LIMIT ? OFFSET ?
      `,
      [start, end, limit, offset]
    );

    const sessions = (rows || []).map((r) => {
      const countryCode = (r && (r.session_country || r.country_code || r.cf_country) ? String(r.session_country || r.country_code || r.cf_country) : 'XX')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      const out = { ...r, country_code: countryCode || 'XX' };
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

    await shopifyLandingMeta.enrichSessionsWithLandingTitles(sessions);
    res.json({ sessions, total });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'abandonedCarts.sessions', rangeKey, mode } });
    console.error('[abandoned-carts.sessions]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;

