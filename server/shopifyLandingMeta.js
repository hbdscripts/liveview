/**
 * Resolve landing page titles from Shopify: product title, collection title.
 * Used for sessions table sticky column - no more Home/Collection/All mapping.
 */
const salesTruth = require('./salesTruth');

const API_VERSION = '2025-01';

function normalizeHandle(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return null;
  return s.replace(/^\/+/, '').split('#')[0].split('?')[0].trim().slice(0, 128);
}

function productHandleFromPath(path) {
  if (typeof path !== 'string') return null;
  const m = String(path).trim().match(/^\/products\/([^/?#]+)/i);
  return m ? normalizeHandle(m[1]) : null;
}

function collectionHandleFromPath(path) {
  if (typeof path !== 'string') return null;
  const m = String(path).trim().match(/^\/collections\/([^/?#]+)/i);
  return m ? normalizeHandle(m[1]) : null;
}

function pathFromSession(s) {
  const first = (s && s.first_path != null && s.first_path !== '') ? String(s.first_path).trim() : '';
  const last = (s && s.last_path != null && s.last_path !== '') ? String(s.last_path).trim() : '';
  const handle = normalizeHandle(s && s.first_product_handle) || normalizeHandle(s && s.last_product_handle);
  if (first) return first;
  if (handle) return '/products/' + handle;
  if (last) return last;
  return '/';
}

function normalizePath(path) {
  let p = typeof path === 'string' ? path.trim() : '';
  if (!p) return '/';
  try { if (/^https?:\/\//i.test(p)) p = new URL(p).pathname || '/'; } catch (_) {}
  p = (p || '').split('#')[0].split('?')[0];
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+$/, '');
  return p === '' ? '/' : p;
}

async function shopifyGraphql(shop, token, query, variables) {
  const safeShop = (shop || '').trim().toLowerCase();
  if (!safeShop || !safeShop.endsWith('.myshopify.com')) return { ok: false, data: null };
  if (!token) return { ok: false, data: null };
  const url = `https://${safeShop}/admin/api/${API_VERSION}/graphql.json`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json.errors && json.errors.length)) return { ok: false, data: null };
    return { ok: true, data: json && json.data ? json.data : null };
  } catch (_) {
    return { ok: false, data: null };
  }
}

async function getProductTitleByHandle(shop, token, handle) {
  if (!handle) return null;
  const h = normalizeHandle(handle);
  if (!h) return null;
  const gql = await shopifyGraphql(shop, token, `
    query($handle: String!) {
      productByHandle(handle: $handle) { title seo { title } }
    }
  `, { handle: h });
  const prod = gql.ok && gql.data && gql.data.productByHandle ? gql.data.productByHandle : null;
  if (!prod) return null;
  const t = (prod.title && String(prod.title).trim()) || null;
  if (t) return t;
  const meta = (prod.seo && prod.seo.title && String(prod.seo.title).trim()) || null;
  return meta || null;
}

async function getCollectionTitleByHandle(shop, token, handle) {
  if (!handle) return null;
  const h = normalizeHandle(handle);
  if (!h) return null;
  const gql = await shopifyGraphql(shop, token, `
    query($handle: String!) {
      collectionByHandle(handle: $handle) { title seo { title } }
    }
  `, { handle: h });
  const col = gql.ok && gql.data && gql.data.collectionByHandle ? gql.data.collectionByHandle : null;
  if (!col) return null;
  const t = (col.title && String(col.title).trim()) || null;
  if (t) return t;
  const meta = (col.seo && col.seo.title && String(col.seo.title).trim()) || null;
  return meta || null;
}

/**
 * Resolve landing title for a path: product title, collection title, or path as fallback.
 * For /, /cart, /orders we return the path (no "Home", "Cart", "Viewed Order").
 */
async function getLandingTitleForPath(shop, token, path) {
  const p = normalizePath(path || '/');
  const productHandle = productHandleFromPath(p);
  const collectionHandle = collectionHandleFromPath(p);
  if (productHandle) {
    const title = await getProductTitleByHandle(shop, token, productHandle);
    if (title) return title;
    return productHandle; // fallback to handle when API fails
  }
  if (collectionHandle) {
    const title = await getCollectionTitleByHandle(shop, token, collectionHandle);
    if (title) return title;
    return collectionHandle; // fallback to handle when API fails
  }
  return p; // /, /cart, /orders, /pages/x etc - show path as-is
}

/**
 * Batch resolve landing titles for sessions. Fetches unique product/collection handles
 * and maps back. Limits to 50 unique handles per type to avoid rate limits.
 */
async function enrichSessionsWithLandingTitles(sessions, { shop, token } = {}) {
  if (!sessions || !Array.isArray(sessions) || !sessions.length) return;
  const safeShop = shop || salesTruth.resolveShopForSales('');
  const accessToken = safeShop ? await salesTruth.getAccessToken(safeShop) : '';
  if (!safeShop || !accessToken) return;

  const productHandles = new Set();
  const collectionHandles = new Set();
  const pathBySession = new Map();

  for (const s of sessions) {
    const path = pathFromSession(s);
    const norm = normalizePath(path);
    pathBySession.set(s, norm);
    const ph = productHandleFromPath(norm);
    const ch = collectionHandleFromPath(norm);
    if (ph) productHandles.add(ph);
    if (ch) collectionHandles.add(ch);
  }

  const productTitles = new Map();
  const collectionTitles = new Map();
  const toFetch = (set, max) => Array.from(set).slice(0, max);
  const productList = toFetch(productHandles, 50);
  const collectionList = toFetch(collectionHandles, 50);

  await Promise.all([
    ...productList.map(async (h) => {
      const t = await getProductTitleByHandle(safeShop, accessToken, h);
      if (t) productTitles.set(h, t);
    }),
    ...collectionList.map(async (h) => {
      const t = await getCollectionTitleByHandle(safeShop, accessToken, h);
      if (t) collectionTitles.set(h, t);
    }),
  ]);

  for (const s of sessions) {
    const path = pathBySession.get(s) || '/';
    const productHandle = productHandleFromPath(path);
    const collectionHandle = collectionHandleFromPath(path);
    let title = null;
    if (productHandle) {
      title = productTitles.get(productHandle) || productHandle;
    } else if (collectionHandle) {
      title = collectionTitles.get(collectionHandle) || collectionHandle;
    } else {
      title = path;
    }
    s.landing_title = (title && String(title).trim()) || path;
  }
}

module.exports = {
  getProductTitleByHandle,
  getCollectionTitleByHandle,
  getLandingTitleForPath,
  enrichSessionsWithLandingTitles,
  pathFromSession,
  productHandleFromPath,
  collectionHandleFromPath,
  normalizePath,
};
