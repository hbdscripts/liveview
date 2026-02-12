const store = require('../store');
const { getDb } = require('../db');
const reportCache = require('../reportCache');
const salesTruth = require('../salesTruth');

function safeStr(v, maxLen = 240) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeCountry(code) {
  const c = code != null ? String(code).trim().toUpperCase().slice(0, 2) : '';
  if (!c) return 'XX';
  if (c === 'UK') return 'GB';
  if (!/^[A-Z]{2}$/.test(c)) return 'XX';
  return c;
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function numOrNull(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeCurrency(code) {
  const c = code != null ? String(code).trim().toUpperCase() : '';
  if (!c) return null;
  return c.slice(0, 8);
}

function round2(n) {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function pct(numerator, denominator) {
  const a = Number(numerator) || 0;
  const b = Number(denominator) || 0;
  if (!(b > 0)) return null;
  return Math.round((a / b) * 1000) / 10; // 1dp
}

function parseYmd(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

async function getShippingOptionsByCountry({
  shop,
  countryCode,
  startYmd,
  endYmd,
} = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return { ok: false, error: 'missing_shop' };

  const cc = normalizeCountry(countryCode);
  if (cc === 'XX') return { ok: false, error: 'invalid_country' };

  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  if (!start || !end) return { ok: false, error: 'invalid_dates' };

  const tz = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const rangeKey = `r:${start}:${end}`;
  const bounds = store.getRangeBounds(rangeKey, nowMs, tz);
  const startMs = bounds && Number.isFinite(bounds.start) ? Number(bounds.start) : nowMs;
  const endMs = bounds && Number.isFinite(bounds.end) ? Number(bounds.end) : nowMs;
  if (!(endMs > startMs)) {
    return { ok: false, error: 'empty_range', range: { start: startMs, end: endMs } };
  }

  const cacheKeyParams = { shop: safeShop, country: cc, startYmd: start, endYmd: end };

  const cached = await reportCache.getOrComputeJson(
    {
      shop: safeShop,
      endpoint: 'tools-shipping-cr',
      rangeKey,
      rangeStartTs: startMs,
      rangeEndTs: endMs,
      params: cacheKeyParams,
      ttlMs: 5 * 60 * 1000,
      force: false,
    },
    async () => {
      const db = getDb();
      // Fast path: aggregate from shipping options fact table (pure SQL; no JSON parsing).
      let aggRows = [];
      try {
        aggRows = await db.all(
          `
            SELECT
              COALESCE(NULLIF(TRIM(shipping_label), ''), 'Unknown') AS label,
              COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
              COALESCE(shipping_price, 0) AS shipping_price,
              COUNT(*) AS orders
            FROM orders_shopify_shipping_options
            WHERE shop = ?
              AND order_country_code = ?
              AND (order_test IS NULL OR order_test = 0)
              AND order_cancelled_at IS NULL
              AND order_financial_status = 'paid'
              AND (
                (order_processed_at IS NOT NULL AND order_processed_at >= ? AND order_processed_at < ?)
                OR (order_processed_at IS NULL AND order_created_at >= ? AND order_created_at < ?)
              )
            GROUP BY COALESCE(NULLIF(TRIM(shipping_label), ''), 'Unknown'),
                     COALESCE(NULLIF(TRIM(currency), ''), 'GBP'),
                     COALESCE(shipping_price, 0)
            ORDER BY orders DESC
          `,
          [safeShop, cc, startMs, endMs, startMs, endMs]
        );
      } catch (_) {
        aggRows = [];
      }

      const totalOrders = (aggRows || []).reduce((sum, r) => sum + (r && r.orders != null ? Number(r.orders) || 0 : 0), 0);
      const outRows = (aggRows || [])
        .map((r) => {
          const label = safeStr(r && r.label != null ? r.label : 'Unknown', 220) || 'Unknown';
          const currency = normalizeCurrency(r && r.currency != null ? r.currency : null) || 'GBP';
          const price = round2(r && r.shipping_price != null ? r.shipping_price : 0);
          const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
          return {
            label,
            currency,
            shipping_price: price,
            orders,
            cr_pct: pct(orders, totalOrders),
          };
        })
        .sort((a, b) => (b.orders - a.orders) || (String(a.label).localeCompare(String(b.label))) || ((a.shipping_price || 0) - (b.shipping_price || 0)));

      return {
        ok: true,
        shop: safeShop,
        country_code: cc,
        range: { start: startMs, end: endMs },
        total_orders: totalOrders,
        rows: outRows,
      };
    }
  );

  return cached && cached.ok ? cached.data : { ok: false, error: 'cache_failed' };
}

module.exports = {
  getShippingOptionsByCountry,
};

