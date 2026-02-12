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

function orderCountryCodeFromRawJson(rawJson) {
  const raw = safeJsonParse(rawJson);
  if (!raw || typeof raw !== 'object') return 'XX';
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

function shippingLinesFromRaw(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const lines = raw.shipping_lines || raw.shippingLines || raw.shippingLinesV2 || null;
  return Array.isArray(lines) ? lines : [];
}

function shippingLabelFromRaw(raw) {
  const lines = shippingLinesFromRaw(raw);
  for (const l of lines) {
    const title = safeStr(l && (l.title ?? l.name), 200);
    if (title) return title;
  }
  return '';
}

function numOrNull(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function shippingPriceFromRaw(raw) {
  const lines = shippingLinesFromRaw(raw);
  // Prefer numeric 'price' / 'price_amount' on the first line when present.
  for (const l of lines) {
    const n =
      numOrNull(l && l.price) ??
      numOrNull(l && l.price_amount) ??
      numOrNull(l && l.amount);
    if (n != null) return n;

    const money =
      l?.price_set?.shop_money?.amount ??
      l?.price_set?.presentment_money?.amount ??
      l?.priceSet?.shopMoney?.amount ??
      l?.priceSet?.presentmentMoney?.amount ??
      null;
    const fromSet = numOrNull(money);
    if (fromSet != null) return fromSet;
  }
  return null;
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
      try {
        await salesTruth.ensureReconciled(safeShop, startMs, endMs, 'tools_shipping_cr');
      } catch (_) {}

      const db = getDb();
      const rows = await db.all(
        `
          SELECT order_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, total_shipping, raw_json
          FROM orders_shopify
          WHERE shop = ?
            AND (
              (processed_at IS NOT NULL AND processed_at >= ? AND processed_at < ?)
              OR (processed_at IS NULL AND created_at >= ? AND created_at < ?)
            )
            AND (test IS NULL OR test = 0)
            AND cancelled_at IS NULL
            AND financial_status = 'paid'
        `,
        [safeShop, startMs, endMs, startMs, endMs]
      );

      const agg = new Map(); // key -> { label, shipping_price, currency, orders }
      let totalOrders = 0;

      for (const r of rows || []) {
        const rawJson = r && r.raw_json != null ? String(r.raw_json) : '';
        const orderCc = orderCountryCodeFromRawJson(rawJson);
        if (orderCc !== cc) continue;

        totalOrders += 1;

        const raw = safeJsonParse(rawJson);
        const label = safeStr(shippingLabelFromRaw(raw) || 'Unknown', 220);

        const cur = normalizeCurrency(r && r.currency != null ? r.currency : (raw && raw.currency ? raw.currency : null)) || 'GBP';
        const totalShip = numOrNull(r && r.total_shipping != null ? r.total_shipping : null);
        const fromRaw = shippingPriceFromRaw(raw);
        const price = round2(totalShip != null ? totalShip : (fromRaw != null ? fromRaw : 0));

        const key = `${label}\0${cur}\0${price.toFixed(2)}`;
        const curRow = agg.get(key) || { label, currency: cur, shipping_price: price, orders: 0 };
        curRow.orders += 1;
        agg.set(key, curRow);
      }

      const outRows = Array.from(agg.values())
        .map((x) => ({
          label: x.label,
          currency: x.currency,
          shipping_price: x.shipping_price,
          orders: x.orders,
          cr_pct: pct(x.orders, totalOrders),
        }))
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

