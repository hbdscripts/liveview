/**
 * Cache Shopify product metadata (handle + main image URL + product_type) to avoid repeated Admin API calls
 * for best-sellers/best-variants tables.
 */
const API_VERSION = '2025-01';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_KEYS = 500;

const cache = new Map(); // key -> { fetchedAt, ttlMs, inflight, data }

function keyFor(shop, productId) {
  const s = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const pid = productId != null ? String(productId).trim() : '';
  return s + '|' + pid;
}

function clampTtl(ttlMs) {
  const n = typeof ttlMs === 'number' ? ttlMs : Number(ttlMs);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MS;
  return Math.max(60 * 1000, Math.min(48 * 60 * 60 * 1000, Math.trunc(n)));
}

function cleanupIfNeeded() {
  if (cache.size <= MAX_CACHE_KEYS) return;
  const entries = Array.from(cache.entries());
  entries.sort((a, b) => (a[1]?.fetchedAt || 0) - (b[1]?.fetchedAt || 0));
  const toDrop = Math.max(1, cache.size - MAX_CACHE_KEYS);
  for (let i = 0; i < toDrop; i++) cache.delete(entries[i][0]);
}

async function fetchProductMeta(shop, token, productId) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const pid = productId != null ? String(productId).trim() : '';
  if (!safeShop || !pid || !token) return { ok: false, handle: null, thumb_url: null, product_type: null };
  const url = `https://${safeShop}/admin/api/${API_VERSION}/products/${encodeURIComponent(pid)}.json`;
  const res = await fetch(url, { headers: { 'X-Shopify-Access-Token': token } });
  if (!res.ok) return { ok: false, handle: null, thumb_url: null, product_type: null };
  const json = await res.json().catch(() => ({}));
  const prod = json && json.product ? json.product : {};
  const img = prod.image || (Array.isArray(prod.images) && prod.images[0]) || null;
  const thumbUrl = img && (img.src || img.url) ? (img.src || img.url) : null;
  const handle = (prod.handle && String(prod.handle).trim()) || null;
  const productType = (prod.product_type && String(prod.product_type).trim()) || null;
  return { ok: true, handle, thumb_url: thumbUrl, product_type: productType };
}

async function getProductMeta(shop, token, productId, { ttlMs = DEFAULT_TTL_MS, force = false } = {}) {
  const ttl = clampTtl(ttlMs);
  const k = keyFor(shop, productId);
  const now = Date.now();
  const entry = cache.get(k);
  if (!force && entry && entry.data && (now - (entry.fetchedAt || 0)) < ttl) return entry.data;
  if (!force && entry && entry.inflight) return entry.inflight;

  const inflight = fetchProductMeta(shop, token, productId)
    .then((data) => {
      const safe = data && typeof data === 'object'
        ? data
        : { ok: false, handle: null, thumb_url: null, product_type: null };
      cache.set(k, { fetchedAt: Date.now(), ttlMs: ttl, inflight: null, data: safe });
      cleanupIfNeeded();
      return safe;
    })
    .catch(() => {
      const cur = cache.get(k);
      if (cur && cur.data) return cur.data;
      return { ok: false, handle: null, thumb_url: null, product_type: null };
    })
    .finally(() => {
      const cur = cache.get(k);
      if (cur && cur.inflight === inflight) cache.set(k, { ...cur, inflight: null });
    });

  cache.set(k, { fetchedAt: entry ? entry.fetchedAt : 0, ttlMs: ttl, inflight, data: entry ? entry.data : null });
  cleanupIfNeeded();
  return inflight;
}

module.exports = { getProductMeta };

