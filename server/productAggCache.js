/**
 * Product/variant aggregation cache for Shopify truth orders.
 *
 * Best sellers + best variants both iterate all orders in a range and parse raw_json line_items.
 * This cache dedupes that work across endpoints and concurrent requests.
 */
const { getDb } = require('./db');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_KEYS = 25;

const cache = new Map(); // key -> { fetchedAt, ttlMs, inflight, data }

function keyFor(shop, startMs, endMs) {
  const s = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const start = startMs != null ? String(startMs) : '';
  const end = endMs != null ? String(endMs) : '';
  return s + '|' + start + '|' + end;
}

function clampTtl(ttlMs) {
  const n = typeof ttlMs === 'number' ? ttlMs : Number(ttlMs);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MS;
  return Math.max(10 * 1000, Math.min(60 * 60 * 1000, Math.trunc(n)));
}

function cleanupIfNeeded() {
  if (cache.size <= MAX_CACHE_KEYS) return;
  // Drop oldest entries.
  const entries = Array.from(cache.entries());
  entries.sort((a, b) => (a[1]?.fetchedAt || 0) - (b[1]?.fetchedAt || 0));
  const toDrop = Math.max(1, cache.size - MAX_CACHE_KEYS);
  for (let i = 0; i < toDrop; i++) cache.delete(entries[i][0]);
}

function parseFloatSafe(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function parseIntSafe(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizeTitle(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || 'Unknown';
}

function normalizeVariantTitle(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return s.toLowerCase() === 'default title' ? null : s;
}

async function computeAgg(shop, startMs, endMs) {
  const db = getDb();
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  if (!safeShop) return { ok: true, totalOrders: 0, products: [], variants: [] };
  const start = Number(startMs);
  const end = Number(endMs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { ok: true, totalOrders: 0, products: [], variants: [] };
  }

  const rows = await db.all(
    `
      SELECT order_id, raw_json
      FROM orders_shopify
      WHERE shop = ? AND created_at >= ? AND created_at < ?
        AND (test IS NULL OR test = 0)
        AND cancelled_at IS NULL
        AND financial_status = 'paid'
    `,
    [safeShop, start, end]
  );

  const productAgg = new Map(); // product_id -> { product_id, title, orders, revenue }
  const variantAgg = new Map(); // variant_id -> { variant_id, product_id, title, variant_title, orders, revenue }
  let totalOrders = 0;

  for (const r of rows || []) {
    totalOrders += 1;
    let order = null;
    try {
      order = r && r.raw_json ? JSON.parse(r.raw_json) : null;
    } catch (_) {
      order = null;
    }
    const lineItems = order && Array.isArray(order.line_items) ? order.line_items : [];
    if (!lineItems.length) continue;

    const seenProducts = new Set();
    const seenVariants = new Set();
    for (const li of lineItems) {
      const productId = li && li.product_id != null ? String(li.product_id) : '';
      const variantId = li && li.variant_id != null ? String(li.variant_id) : '';
      if (!productId) continue;

      const qty = Math.max(0, parseIntSafe(li && li.quantity != null ? li.quantity : 0, 0));
      const price = parseFloatSafe(li && li.price != null ? li.price : 0);
      const lineTotal = qty * price;
      const title = normalizeTitle(li && li.title);

      let p = productAgg.get(productId);
      if (!p) {
        p = { product_id: productId, title, orders: 0, revenue: 0 };
        productAgg.set(productId, p);
      }
      p.revenue += lineTotal;
      if (!seenProducts.has(productId)) {
        seenProducts.add(productId);
        p.orders += 1;
      }

      if (variantId) {
        const vtitle = normalizeVariantTitle(li && li.variant_title);
        let v = variantAgg.get(variantId);
        if (!v) {
          v = { variant_id: variantId, product_id: productId, title, variant_title: vtitle, orders: 0, revenue: 0 };
          variantAgg.set(variantId, v);
        }
        v.revenue += lineTotal;
        if (!seenVariants.has(variantId)) {
          seenVariants.add(variantId);
          v.orders += 1;
        }
      }
    }
  }

  const products = Array.from(productAgg.values()).map((p) => ({
    product_id: p.product_id,
    title: p.title,
    orders: p.orders,
    revenue: Math.round((Number(p.revenue) || 0) * 100) / 100,
  }));
  const variants = Array.from(variantAgg.values()).map((v) => ({
    variant_id: v.variant_id,
    product_id: v.product_id,
    title: v.title,
    variant_title: v.variant_title,
    orders: v.orders,
    revenue: Math.round((Number(v.revenue) || 0) * 100) / 100,
  }));

  return { ok: true, totalOrders, products, variants };
}

async function getAgg(shop, startMs, endMs, { ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const ttl = clampTtl(ttlMs);
  const k = keyFor(shop, startMs, endMs);
  const now = Date.now();
  const entry = cache.get(k);
  if (!force && entry && entry.data && (now - (entry.fetchedAt || 0)) < ttl) {
    return entry.data;
  }
  if (!force && entry && entry.inflight) {
    return entry.inflight;
  }

  const inflight = computeAgg(shop, startMs, endMs)
    .then((data) => {
      const safe = data && typeof data === 'object' ? data : { ok: true, totalOrders: 0, products: [], variants: [] };
      cache.set(k, { fetchedAt: Date.now(), ttlMs: ttl, inflight: null, data: safe });
      cleanupIfNeeded();
      return safe;
    })
    .catch((err) => {
      // Fail-open: serve last known-good if we have it.
      const cur = cache.get(k);
      if (cur && cur.data) return cur.data;
      throw err;
    })
    .finally(() => {
      const cur = cache.get(k);
      if (cur && cur.inflight === inflight) {
        cache.set(k, { ...cur, inflight: null });
      }
    });

  cache.set(k, { fetchedAt: entry ? entry.fetchedAt : 0, ttlMs: ttl, inflight, data: entry ? entry.data : null });
  cleanupIfNeeded();
  return inflight;
}

module.exports = { getAgg };

