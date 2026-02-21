const Sentry = require('@sentry/node');
const { getDb } = require('../db');
const store = require('../store');
const fx = require('../fx');
const { normalizeRangeKey } = require('../rangeKey');
const { percentOrNull, ratioOrNull } = require('../metrics');
const { normalizePaymentMethod } = require('../paymentMethods/normalizePaymentMethod');
const { canonicalPaymentKey, paymentLabelForKey, commonPaymentMethods, ORDERED_KEYS } = require('../paymentMethods/catalog');
const reportCache = require('../reportCache');

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }

function safeRangeKey(raw) {
  // Keep consistent with other insights endpoints.
  const allowed = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);
  return normalizeRangeKey(raw, { defaultKey: 'today', allowed, allowCustomDay: true, allowCustomRange: true, allowFriendlyDays: true });
}

function dayKeyUtc(ms) {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return null;
  try { return new Date(n).toISOString().slice(0, 10); } catch (_) { return null; }
}

function dayStartUtcMs(ms) {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return null;
  try {
    const d = new Date(n);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  } catch (_) {
    return null;
  }
}

function hourStartMs(ms) {
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n)) return null;
  try {
    const d = new Date(n);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
  } catch (_) {
    return null;
  }
}

function buildDayCategories(startMs, endMs) {
  const start = dayStartUtcMs(startMs);
  const end = dayStartUtcMs(endMs);
  if (start == null || end == null) return [];
  const out = [];
  // end is exclusive; include the start day, stop before end day.
  for (let t = start; t < end; t += 24 * 60 * 60 * 1000) {
    const k = dayKeyUtc(t);
    if (k) out.push(k);
  }
  // Ensure at least one bucket for very small ranges.
  if (!out.length) {
    const k = dayKeyUtc(startMs);
    if (k) out.push(k);
  }
  return out;
}

function isHourlyRange(rangeKey, startMs, endMs) {
  const k = s(rangeKey).trim().toLowerCase();
  if (k === 'today' || k === 'yesterday') return true;
  const span = Number(endMs) - Number(startMs);
  return Number.isFinite(span) && span > 0 && span <= (36 * 60 * 60 * 1000);
}

function buildHourCategories(startMs, endMs, timeZone) {
  const start = hourStartMs(startMs);
  const end = hourStartMs(endMs);
  if (start == null || end == null) return [];
  const out = [];
  for (let t = start; t < end; t += 60 * 60 * 1000) {
    try {
      if (timeZone) {
        out.push(new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }));
      } else {
        out.push(new Date(t).toISOString().slice(11, 16));
      }
    } catch (_) {
      out.push(new Date(t).toISOString().slice(11, 16));
    }
  }
  if (out.length < 2) {
    // Ensure at least two buckets so ApexCharts can draw a line.
    out.push(out[0] || '00:00');
  }
  return out;
}

function normText(raw, maxLen) {
  const out = s(raw).trim();
  if (!out) return null;
  if (typeof maxLen === 'number' && maxLen > 0 && out.length > maxLen) return out.slice(0, maxLen);
  return out;
}

function paymentKeyFromParts(row) {
  const meta = normalizePaymentMethod({
    gateway: row && row.payment_gateway,
    methodType: row && row.payment_method_type,
    methodName: row && row.payment_method_name,
    cardBrand: row && row.payment_card_brand,
  });
  return meta && meta.key ? String(meta.key) : 'other';
}

function paymentMetaFromParts(row) {
  const meta = normalizePaymentMethod({
    gateway: row && row.payment_gateway,
    methodType: row && row.payment_method_type,
    methodName: row && row.payment_method_name,
    cardBrand: row && row.payment_card_brand,
  });
  return meta || { key: 'other', label: 'Other', iconSrc: null, iconAlt: 'Other', debug: {} };
}

function applyPaymentIconOverride(meta, overrides) {
  if (!meta) return meta;
  const base = { ...meta, iconSrc: null, iconSpec: '' };
  if (!overrides || typeof overrides !== 'object') return base;
  const key = meta.key ? String(meta.key).trim() : '';
  if (!key) return base;
  const override = overrides['payment_' + key];
  const spec = override != null ? String(override).trim() : '';
  if (!spec) return base;
  if (/^(https?:\/\/|\/\/|\/)/i.test(spec)) return { ...base, iconSrc: spec, iconSpec: spec };
  return { ...base, iconSpec: spec };
}

async function readAssetOverrides() {
  let assetOverrides = {};
  try {
    const raw = await store.getSetting('asset_overrides');
    if (raw && typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) assetOverrides = parsed;
    }
  } catch (_) {}
  return assetOverrides;
}

/**
 * Payment Methods insight report.
 *
 * Returns a single payload used by BOTH table + chart, so the UI doesn't need to
 * double-fetch or duplicate transforms.
 */
async function getPaymentMethodsReport(req, res) {
  Sentry.addBreadcrumb({ category: 'api', message: 'payment-methods.report', data: { range: req?.query?.range } });
  const range = safeRangeKey(req.query && req.query.range);
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const db = getDb();
  const force = !!(req?.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  const assetOverrides = await readAssetOverrides();

  try {
    const ttlMs = (range === 'today' || range === 'yesterday') ? (2 * 60 * 1000) : (15 * 60 * 1000);
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'payment-methods.report',
        rangeKey: 'range_' + range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { range, timeZone },
        ttlMs,
        force,
      },
      async () => {
        const [ratesToGbp, totalSessionsRow, rowsCounts, rowsCarts, rowsRevenue, rowsSeries] = await Promise.all([
          fx.getRatesToGbp().catch(() => null),
          db.get(
            `
            SELECT COUNT(*) AS sessions
            FROM sessions
            WHERE started_at >= ? AND started_at < ?
              AND (cf_known_bot IS NULL OR cf_known_bot = 0)
            `.trim(),
            [start, end]
          ).catch(() => null),
          db.all(
            `
            SELECT
              COALESCE(NULLIF(TRIM(p.payment_gateway), ''), NULL) AS payment_gateway,
              COALESCE(NULLIF(TRIM(p.payment_method_type), ''), NULL) AS payment_method_type,
              COALESCE(NULLIF(TRIM(p.payment_method_name), ''), NULL) AS payment_method_name,
              COALESCE(NULLIF(TRIM(p.payment_card_brand), ''), NULL) AS payment_card_brand,
              COUNT(DISTINCT p.purchase_key) AS orders,
              COUNT(DISTINCT p.session_id) AS sessions
            FROM purchases p
            WHERE p.purchased_at >= ? AND p.purchased_at < ?
              ${store.purchaseFilterExcludeDuplicateH('p')}
              ${store.purchaseFilterExcludeTokenWhenOrderExists('p')}
            GROUP BY 1, 2, 3, 4
            `.trim(),
            [start, end]
          ),
          db.all(
            `
            SELECT
              COALESCE(NULLIF(TRIM(p.payment_gateway), ''), NULL) AS payment_gateway,
              COALESCE(NULLIF(TRIM(p.payment_method_type), ''), NULL) AS payment_method_type,
              COALESCE(NULLIF(TRIM(p.payment_method_name), ''), NULL) AS payment_method_name,
              COALESCE(NULLIF(TRIM(p.payment_card_brand), ''), NULL) AS payment_card_brand,
              COUNT(DISTINCT CASE WHEN (COALESCE(s.cart_qty, 0) > 0 OR COALESCE(s.cart_value, 0) > 0) THEN p.session_id ELSE NULL END) AS carts
            FROM purchases p
            LEFT JOIN sessions s ON s.session_id = p.session_id
            WHERE p.purchased_at >= ? AND p.purchased_at < ?
              ${store.purchaseFilterExcludeDuplicateH('p')}
              ${store.purchaseFilterExcludeTokenWhenOrderExists('p')}
            GROUP BY 1, 2, 3, 4
            `.trim(),
            [start, end]
          ),
          db.all(
            `
            SELECT
              COALESCE(NULLIF(TRIM(p.payment_gateway), ''), NULL) AS payment_gateway,
              COALESCE(NULLIF(TRIM(p.payment_method_type), ''), NULL) AS payment_method_type,
              COALESCE(NULLIF(TRIM(p.payment_method_name), ''), NULL) AS payment_method_name,
              COALESCE(NULLIF(TRIM(p.payment_card_brand), ''), NULL) AS payment_card_brand,
              COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS order_currency,
              SUM(p.order_total) AS revenue
            FROM purchases p
            WHERE p.purchased_at >= ? AND p.purchased_at < ? AND p.order_total IS NOT NULL
              ${store.purchaseFilterExcludeDuplicateH('p')}
              ${store.purchaseFilterExcludeTokenWhenOrderExists('p')}
            GROUP BY 1, 2, 3, 4, 5
            `.trim(),
            [start, end]
          ),
          db.all(
            `
            SELECT
              p.purchased_at,
              COALESCE(NULLIF(TRIM(p.payment_gateway), ''), NULL) AS payment_gateway,
              COALESCE(NULLIF(TRIM(p.payment_method_type), ''), NULL) AS payment_method_type,
              COALESCE(NULLIF(TRIM(p.payment_method_name), ''), NULL) AS payment_method_name,
              COALESCE(NULLIF(TRIM(p.payment_card_brand), ''), NULL) AS payment_card_brand,
              COALESCE(NULLIF(TRIM(p.order_currency), ''), 'GBP') AS order_currency,
              p.order_total
            FROM purchases p
            WHERE p.purchased_at >= ? AND p.purchased_at < ? AND p.order_total IS NOT NULL
              ${store.purchaseFilterExcludeDuplicateH('p')}
              ${store.purchaseFilterExcludeTokenWhenOrderExists('p')}
            `.trim(),
            [start, end]
          ),
        ]);

        const totalSessions = totalSessionsRow && totalSessionsRow.sessions != null ? Number(totalSessionsRow.sessions) : 0;
        const totalTrafficSessions = Number.isFinite(totalSessions) && totalSessions > 0 ? totalSessions : 0;

        // carts + revenue maps by canonical key
        const cartsByKey = new Map();
        for (const r of rowsCarts || []) {
          const k = paymentKeyFromParts(r);
          const n = r && r.carts != null ? Number(r.carts) : 0;
          cartsByKey.set(k, (cartsByKey.get(k) || 0) + (Number.isFinite(n) ? n : 0));
        }

        const revenueByKey = new Map();
        for (const r of rowsRevenue || []) {
          const k = paymentKeyFromParts(r);
          const cur = s(r.order_currency).trim().toUpperCase() || 'GBP';
          const amt = r && r.revenue != null ? Number(r.revenue) : null;
          if (!Number.isFinite(amt)) continue;
          const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
          if (gbp == null) continue;
          revenueByKey.set(k, (revenueByKey.get(k) || 0) + gbp);
        }

        // rows: aggregate counts into canonical keys, then compute derived metrics
        const metaByKey = new Map();
        const agg = new Map(); // key -> { sessions, orders }
        for (const r of rowsCounts || []) {
          const m = applyPaymentIconOverride(paymentMetaFromParts(r), assetOverrides);
          const k = m.key || 'other';
          metaByKey.set(k, {
            key: k,
            label: m.label || 'Other',
            iconSrc: m.iconSrc || null,
            iconSpec: m.iconSpec || '',
            iconAlt: m.iconAlt || (m.label || 'Other'),
          });
          const orders = r && r.orders != null ? Number(r.orders) : 0;
          const sessions = r && r.sessions != null ? Number(r.sessions) : 0;
          const prev = agg.get(k) || { sessions: 0, orders: 0 };
          prev.sessions += Number.isFinite(sessions) ? sessions : 0;
          prev.orders += Number.isFinite(orders) ? orders : 0;
          agg.set(k, prev);
        }

        const outRows = [];
        let totalPurchaserSessions = 0;
        let totalOrders = 0;
        let totalRevenue = 0;
        for (const [k, base] of agg.entries()) {
          totalPurchaserSessions += (base.sessions || 0);
          totalOrders += (base.orders || 0);
          totalRevenue += (revenueByKey.get(k) || 0);
        }

        for (const [k, base] of agg.entries()) {
          const sessions = base.sessions || 0;
          const orders = base.orders || 0;
          const carts = cartsByKey.get(k) || 0;
          const revenue = revenueByKey.get(k) || 0;

          // For each payment method, use purchase-derived denominators (not all traffic sessions),
          // so methods aren't penalized by sessions that never saw that option (e.g. country availability).
          const orderShare = percentOrNull(orders, totalOrders, { decimals: 1, clampMax: 100 });
          const revPerPurchaserSession = ratioOrNull(revenue, sessions, { decimals: 2 });
          const aov = ratioOrNull(revenue, orders, { decimals: 2 });
          const meta = metaByKey.get(k) || { key: k, label: k, iconSrc: null, iconSpec: '', iconAlt: k };

          outRows.push({
            key: meta.key,
            label: meta.label,
            iconSrc: meta.iconSrc,
            iconSpec: meta.iconSpec || '',
            iconAlt: meta.iconAlt,
            sessions,
            carts,
            orders,
            cr: orderShare, // back-compat field: shown in UI as % column
            vpv: revPerPurchaserSession, // back-compat field: shown as £ value column
            revenue: Number.isFinite(revenue) ? revenue : 0,
            aov,
          });
        }

        outRows.sort((a, b) => {
          const ar = typeof a.revenue === 'number' ? a.revenue : 0;
          const br = typeof b.revenue === 'number' ? b.revenue : 0;
          if (br !== ar) return br - ar;
          const bo = (b.orders || 0) - (a.orders || 0);
          if (bo) return bo;
          return (b.sessions || 0) - (a.sessions || 0);
        });

        // series: revenue for top methods (by total revenue)
        const hourly = isHourlyRange(range, start, end);
        const categories = hourly ? buildHourCategories(start, end, timeZone) : buildDayCategories(start, end);
        const idxByDay = hourly ? null : new Map();
        if (idxByDay) categories.forEach((d, i) => idxByDay.set(d, i));

        const totals = new Map(); // key -> total revenue gbp
        const seriesMap = new Map(); // key -> data[]
        function ensureSeries(key) {
          if (seriesMap.has(key)) return seriesMap.get(key);
          const arr = new Array(categories.length).fill(0);
          seriesMap.set(key, arr);
          return arr;
        }

        // Reuse a raw-combo cache to avoid repeatedly normalising identical strings.
        const comboCache = new Map(); // comboKey -> { key, label, iconSrc, iconAlt }
        function comboMeta(r) {
          const comboKey =
            normText(r && r.payment_gateway, 64) + '|' +
            normText(r && r.payment_method_type, 32) + '|' +
            normText(r && r.payment_method_name, 96) + '|' +
            normText(r && r.payment_card_brand, 32);
          if (comboCache.has(comboKey)) return comboCache.get(comboKey);
          const meta = applyPaymentIconOverride(paymentMetaFromParts(r), assetOverrides);
          const out = {
            key: meta.key || 'other',
            label: meta.label || 'Other',
            iconSrc: meta.iconSrc || null,
            iconSpec: meta.iconSpec || '',
            iconAlt: meta.iconAlt || (meta.label || 'Other'),
          };
          comboCache.set(comboKey, out);
          metaByKey.set(out.key, out);
          return out;
        }

        for (const r of rowsSeries || []) {
          const ts = r && r.purchased_at != null ? Number(r.purchased_at) : NaN;
          if (!Number.isFinite(ts)) continue;
          let i = -1;
          if (hourly) {
            i = Math.floor((ts - start) / (60 * 60 * 1000));
            if (!Number.isFinite(i)) continue;
            if (i < 0) continue;
            if (i >= categories.length) i = categories.length - 1;
          } else {
            const day = dayKeyUtc(ts);
            if (!day || !idxByDay || !idxByDay.has(day)) continue;
            i = idxByDay.get(day);
          }
          const amt = r && r.order_total != null ? Number(r.order_total) : NaN;
          if (!Number.isFinite(amt)) continue;
          const cur = s(r.order_currency).trim().toUpperCase() || 'GBP';
          const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
          if (gbp == null) continue;
          const meta = comboMeta(r);
          const arr = ensureSeries(meta.key);
          arr[i] += gbp;
          totals.set(meta.key, (totals.get(meta.key) || 0) + gbp);
        }

        const topKeys = Array.from(totals.entries())
          .sort((a, b) => (b[1] || 0) - (a[1] || 0))
          .slice(0, 8)
          .map(([k]) => k);

        const series = topKeys.map((k) => {
          const meta = metaByKey.get(k) || { key: k, label: k, iconSrc: null, iconSpec: '', iconAlt: k };
          const data = ensureSeries(k).map((v) => {
            const n = typeof v === 'number' ? v : Number(v);
            return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
          });
          return {
            key: meta.key,
            label: meta.label,
            iconSrc: meta.iconSrc,
            iconSpec: meta.iconSpec || '',
            iconAlt: meta.iconAlt,
            data,
          };
        });

        return {
          ok: true,
          range,
          start,
          end,
          currency: 'GBP',
          totalTrafficSessions,
          totalPurchaserSessions,
          totalOrders,
          totalRevenue: Math.round((Number(totalRevenue) || 0) * 100) / 100,
          categories,
          series,
          rows: outRows.slice(0, 40),
        };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { ok: false, error: 'Failed to load payment methods report' });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'payment-methods.report', range } });
    console.error('[payment-methods.report]', err);
    return res.status(500).json({ ok: false, error: 'Failed to load payment methods report' });
  }
}

async function getPaymentMethodsCatalog(req, res) {
  const db = getDb();
  try {
    const rows = await db.all(
      `
      SELECT
        COALESCE(NULLIF(TRIM(payment_method_key), ''), NULL) AS payment_method_key,
        COALESCE(NULLIF(TRIM(payment_method_label), ''), NULL) AS payment_method_label,
        COALESCE(NULLIF(TRIM(payment_gateway), ''), NULL) AS payment_gateway,
        COALESCE(NULLIF(TRIM(payment_method_type), ''), NULL) AS payment_method_type,
        COALESCE(NULLIF(TRIM(payment_method_name), ''), NULL) AS payment_method_name,
        COALESCE(NULLIF(TRIM(payment_card_brand), ''), NULL) AS payment_card_brand,
        COUNT(*) AS rows
      FROM purchases
      GROUP BY 1, 2, 3, 4, 5, 6
      `.trim()
    ).catch(() => []);

    const byKey = new Map();
    const seenInDb = new Set();
    for (const r of rows || []) {
      const rawKey = r && r.payment_method_key != null ? String(r.payment_method_key).trim() : '';
      const rawLabel = r && r.payment_method_label != null ? String(r.payment_method_label).trim() : '';
      const key = rawKey
        ? canonicalPaymentKey(rawKey)
        : (function () {
          const meta = normalizePaymentMethod({
            gateway: r && r.payment_gateway,
            methodType: r && r.payment_method_type,
            methodName: r && r.payment_method_name,
            cardBrand: r && r.payment_card_brand,
          });
          return canonicalPaymentKey(meta && meta.key ? meta.key : 'other');
        })();
      const label = rawLabel || paymentLabelForKey(key);
      seenInDb.add(key);
      if (!byKey.has(key)) byKey.set(key, { key, label, seenInDb: true });
    }

    for (const m of commonPaymentMethods()) {
      if (!byKey.has(m.key)) byKey.set(m.key, { key: m.key, label: m.label, seenInDb: false });
    }

    const ordered = [];
    const pushed = new Set();
    for (const k of ORDERED_KEYS) {
      if (!byKey.has(k)) continue;
      ordered.push(byKey.get(k));
      pushed.add(k);
    }
    const extras = Array.from(byKey.values())
      .filter((r) => !pushed.has(r.key))
      .sort((a, b) => String(a.label || a.key).localeCompare(String(b.label || b.key)));
    const methods = ordered.concat(extras);

    const assetOverrides = await readAssetOverrides();
    let seeded = 0;
    const merged = { ...assetOverrides };
    methods.forEach((m) => {
      const overrideKey = 'payment_' + String(m.key);
      if (!Object.prototype.hasOwnProperty.call(merged, overrideKey)) {
        merged[overrideKey] = '';
        seeded += 1;
      }
    });
    if (seeded > 0) {
      try { await store.setSetting('asset_overrides', JSON.stringify(merged)); } catch (_) {}
    }

    const finalOverrides = seeded > 0 ? merged : assetOverrides;
    const out = methods.map((m) => {
      const k = 'payment_' + String(m.key);
      const iconSpec = finalOverrides && Object.prototype.hasOwnProperty.call(finalOverrides, k)
        ? String(finalOverrides[k] == null ? '' : finalOverrides[k])
        : '';
      return {
        key: m.key,
        label: m.label,
        seenInDb: !!m.seenInDb,
        iconSpec,
      };
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, methods: out, seeded });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'payment-methods.catalog' } });
    return res.status(500).json({ ok: false, error: 'Failed to load payment methods catalog' });
  }
}

module.exports = { getPaymentMethodsReport, getPaymentMethodsCatalog };

