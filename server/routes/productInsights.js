/**
 * GET /api/product-insights?handle=...&range=today|yesterday|3d|7d|14d|30d|month|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD&shop=...
 *
 * Returns a product analytics payload for the shared Product modal:
 * - Product metadata (title + images) from Shopify Admin API (best-effort, cached by Shopify).
 * - Orders/revenue from Shopify truth line items (orders_shopify_line_items).
 * - Landings ("clicks") from our sessions table (human-only).
 * - Product views / add-to-cart events from our events table (human-only).
 */
const { getDb } = require('../db');
const store = require('../store');
const salesTruth = require('../salesTruth');
const fx = require('../fx');
const reportCache = require('../reportCache');

const API_VERSION = '2025-01';

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d', '14d', '30d', 'month'];
const VARIANT_COST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const variantCostCache = new Map();

function sleep(ms) {
  const n = Number(ms) || 0;
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, n)));
}

function chunkArray(arr, size) {
  const out = [];
  const n = Math.max(1, Number(size) || 1);
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function parseLegacyVariantId(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(\d+)(?:\D.*)?$/);
  return m && m[1] ? m[1] : '';
}

async function shopifyGraphqlWithRetry(shop, accessToken, query, variables, { maxRetries = 5 } = {}) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status !== 429) return res;
    if (attempt >= maxRetries) return res;
    const retryAfter = res.headers.get('retry-after');
    const waitSeconds = retryAfter ? parseInt(String(retryAfter), 10) : NaN;
    const waitMs = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : 1000;
    await sleep(Math.min(waitMs, 10000));
  }
}

async function fetchVariantUnitCosts(shop, accessToken, variantIds) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop || !accessToken || !Array.isArray(variantIds) || !variantIds.length) return new Map();
  const normalizedIds = Array.from(new Set(variantIds.map(parseLegacyVariantId).filter(Boolean)));
  const result = new Map();
  const missing = [];
  const now = Date.now();

  for (const vid of normalizedIds) {
    const key = `${safeShop}:${vid}`;
    const cached = variantCostCache.get(key);
    if (cached && cached.expiresAt > now && Number.isFinite(cached.amount)) {
      result.set(vid, { amount: Number(cached.amount), currency: cached.currency || 'GBP' });
    } else {
      missing.push(vid);
    }
  }
  if (!missing.length) return result;

  const chunks = chunkArray(missing, 75);
  const query = `
    query VariantUnitCosts($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id
          legacyResourceId
          inventoryItem {
            unitCost {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;

  for (const part of chunks) {
    const gqlIds = part.map((id) => `gid://shopify/ProductVariant/${id}`);
    try {
      const res = await shopifyGraphqlWithRetry(safeShop, accessToken, query, { ids: gqlIds }, { maxRetries: 6 });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.data || !Array.isArray(json.data.nodes)) continue;
      for (const n of json.data.nodes) {
        if (!n || typeof n !== 'object') continue;
        const vid = parseLegacyVariantId(n.legacyResourceId || n.id);
        if (!vid) continue;
        const unitCost = n.inventoryItem && n.inventoryItem.unitCost ? n.inventoryItem.unitCost : null;
        const amount = unitCost && unitCost.amount != null ? Number(unitCost.amount) : NaN;
        const currency = unitCost && unitCost.currencyCode ? String(unitCost.currencyCode).toUpperCase() : 'GBP';
        if (!Number.isFinite(amount)) continue;
        result.set(vid, { amount, currency });
        variantCostCache.set(`${safeShop}:${vid}`, {
          amount,
          currency,
          expiresAt: Date.now() + VARIANT_COST_CACHE_TTL_MS,
        });
      }
    } catch (_) {}
  }

  return result;
}

function safeJsonParse(str) {
  if (!str || typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch (_) { return null; }
}

function normalizeCountry(raw) {
  const cc = raw != null ? String(raw).trim().toUpperCase().slice(0, 2) : '';
  if (!cc) return 'XX';
  if (cc === 'UK') return 'GB';
  if (!/^[A-Z]{2}$/.test(cc)) return 'XX';
  return cc;
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

function normalizeHandle(v) {
  if (typeof v !== 'string') return null;
  const h = v.trim().toLowerCase();
  if (!h) return null;
  // keep it conservative; Shopify handles are usually <= 255
  return h.slice(0, 128);
}

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (RANGE_KEYS.includes(r) || isDayKey || isRangeKey) return r;
  return 'today';
}

function upgradeImgUrl(rawUrl, width) {
  if (!rawUrl) return rawUrl;
  const w = Number(width);
  const ww = Number.isFinite(w) && w > 0 ? Math.floor(w) : 1000;
  try {
    const u = new URL(String(rawUrl));
    u.searchParams.set('width', String(ww));
    // remove height if present so Shopify can preserve aspect ratio
    if (u.searchParams.has('height')) u.searchParams.delete('height');
    return u.toString();
  } catch (_) {
    // naive fallback: replace width=100 -> width=1000
    return String(rawUrl).replace(/([?&]width=)(\d+)/i, '$1' + String(ww));
  }
}

function toNumericProductId(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  const m = s.match(/gid:\/\/shopify\/Product\/(\d+)$/i);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return s;
}

function handleMatchSql() {
  // We store several possible signals; keep it fast and permissive.
  // NOTE: handle is already normalized lowercase.
  return `
    (
      (s.first_product_handle IS NOT NULL AND LOWER(TRIM(s.first_product_handle)) = ?)
      OR (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE ?)
      OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE ?)
    )
  `;
}

async function fetchShopifyProductByHandle(shop, token, handle) {
  if (!shop || !token || !handle) return null;
  const safeShop = String(shop).trim().toLowerCase();
  const url = `https://${safeShop}/admin/api/${API_VERSION}/graphql.json`;
  const query = `
    query ProductByHandle($handle: String!) {
      productByHandle(handle: $handle) {
        id
        title
        handle
        productType
        totalInventory
        featuredImage { url altText }
        images(first: 20) { nodes { url altText } }
        variants(first: 100) {
          nodes {
            id
            legacyResourceId
            inventoryQuantity
            availableForSale
          }
        }
      }
    }
  `;
  const body = JSON.stringify({ query, variables: { handle } });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body,
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const prod = json && json.data && json.data.productByHandle ? json.data.productByHandle : null;
  if (!prod || !prod.id) return null;
  const gid = String(prod.id);
  const numericId = gid.includes('/') ? gid.split('/').pop() : gid;
  const title = prod.title ? String(prod.title) : '';
  const images = [];
  const seen = new Set();
  const feat = prod.featuredImage && prod.featuredImage.url ? String(prod.featuredImage.url) : '';
  if (feat) {
    const u = feat.trim();
    if (u && !seen.has(u)) { images.push({ url: u, alt: (prod.featuredImage.altText || '') }); seen.add(u); }
  }
  const nodes = prod.images && Array.isArray(prod.images.nodes) ? prod.images.nodes : [];
  for (const n of nodes) {
    const u = n && n.url ? String(n.url).trim() : '';
    if (!u || seen.has(u)) continue;
    images.push({ url: u, alt: (n.altText || '') });
    seen.add(u);
  }
  const variantNodes = prod.variants && Array.isArray(prod.variants.nodes) ? prod.variants.nodes : [];
  let inStockVariants = 0;
  for (const n of variantNodes) {
    if (!n || typeof n !== 'object') continue;
    const q = n.inventoryQuantity != null ? Number(n.inventoryQuantity) : NaN;
    const available = !!n.availableForSale;
    if (available || (Number.isFinite(q) && q > 0)) inStockVariants += 1;
  }
  const totalInventory = prod.totalInventory != null ? Number(prod.totalInventory) : NaN;
  return {
    productId: numericId || null,
    title: title || null,
    handle: prod.handle ? String(prod.handle).trim().toLowerCase() : handle,
    productType: prod.productType ? String(prod.productType).trim() : null,
    inventoryUnits: Number.isFinite(totalInventory) ? Math.trunc(totalInventory) : null,
    inStockVariants: inStockVariants > 0 ? inStockVariants : (variantNodes.length ? 0 : null),
    images,
  };
}

async function fetchShopifyProductById(shop, token, productId) {
  if (!shop || !token || !productId) return null;
  const numericId = toNumericProductId(productId);
  if (!numericId) return null;
  const safeShop = String(shop).trim().toLowerCase();
  const gid = `gid://shopify/Product/${numericId}`;
  const url = `https://${safeShop}/admin/api/${API_VERSION}/graphql.json`;
  const query = `
    query ProductById($id: ID!) {
      node(id: $id) {
        ... on Product {
          id
          title
          handle
          productType
          totalInventory
          featuredImage { url altText }
          images(first: 20) { nodes { url altText } }
          variants(first: 100) {
            nodes {
              id
              legacyResourceId
              inventoryQuantity
              availableForSale
            }
          }
        }
      }
    }
  `;
  const body = JSON.stringify({ query, variables: { id: gid } });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body,
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  const node = json && json.data && json.data.node ? json.data.node : null;
  if (!node || !node.id) return null;
  const prod = node;
  const title = prod.title ? String(prod.title) : '';
  const images = [];
  const seen = new Set();
  const feat = prod.featuredImage && prod.featuredImage.url ? String(prod.featuredImage.url) : '';
  if (feat) {
    const u = feat.trim();
    if (u && !seen.has(u)) { images.push({ url: u, alt: (prod.featuredImage.altText || '') }); seen.add(u); }
  }
  const nodes = prod.images && Array.isArray(prod.images.nodes) ? prod.images.nodes : [];
  for (const n of nodes) {
    const u = n && n.url ? String(n.url).trim() : '';
    if (!u || seen.has(u)) continue;
    images.push({ url: u, alt: (n.altText || '') });
    seen.add(u);
  }
  const variantNodes = prod.variants && Array.isArray(prod.variants.nodes) ? prod.variants.nodes : [];
  let inStockVariants = 0;
  for (const n of variantNodes) {
    if (!n || typeof n !== 'object') continue;
    const q = n.inventoryQuantity != null ? Number(n.inventoryQuantity) : NaN;
    const available = !!n.availableForSale;
    if (available || (Number.isFinite(q) && q > 0)) inStockVariants += 1;
  }
  const totalInventory = prod.totalInventory != null ? Number(prod.totalInventory) : NaN;
  const handle = prod.handle ? String(prod.handle).trim().toLowerCase() : null;
  return {
    productId: numericId || null,
    title: title || null,
    handle,
    productType: prod.productType ? String(prod.productType).trim() : null,
    inventoryUnits: Number.isFinite(totalInventory) ? Math.trunc(totalInventory) : null,
    inStockVariants: inStockVariants > 0 ? inStockVariants : (variantNodes.length ? 0 : null),
    images,
  };
}

async function computeLifetimeProductDetails({ db, shop, productId, accessToken }) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const pid = productId != null ? String(productId).trim() : '';
  if (!db || !safeShop || !pid) {
    return {
      totalSalesLifetime: null,
      totalRevenueLifetimeGbp: null,
      costOfGoodsLifetimeGbp: null,
    };
  }

  const ratesToGbp = await fx.getRatesToGbp();
  let totalSalesLifetime = 0;
  let totalRevenueLifetimeGbp = 0;

  try {
    const rows = await db.all(
      `
        SELECT
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          COUNT(DISTINCT order_id) AS orders,
          COALESCE(SUM(line_revenue), 0) AS revenue
        FROM orders_shopify_line_items
        WHERE shop = ?
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) = ?
        GROUP BY COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
      `,
      [safeShop, pid]
    );
    for (const r of rows || []) {
      const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
      const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
      const gbp = fx.convertToGbp(Number.isFinite(revRaw) ? revRaw : 0, cur, ratesToGbp);
      totalRevenueLifetimeGbp += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
      const o = r && r.orders != null ? Number(r.orders) : 0;
      totalSalesLifetime += Number.isFinite(o) ? Math.trunc(o) : 0;
    }
    totalRevenueLifetimeGbp = Math.round(totalRevenueLifetimeGbp * 100) / 100;
  } catch (_) {
    totalSalesLifetime = null;
    totalRevenueLifetimeGbp = null;
  }

  let costOfGoodsLifetimeGbp = null;
  if (accessToken) {
    try {
      const qtyRows = await db.all(
        `
          SELECT
            TRIM(COALESCE(variant_id, '')) AS variant_id,
            COALESCE(SUM(quantity), 0) AS qty
          FROM orders_shopify_line_items
          WHERE shop = ?
            AND (order_test IS NULL OR order_test = 0)
            AND order_cancelled_at IS NULL
            AND order_financial_status = 'paid'
            AND product_id IS NOT NULL AND TRIM(product_id) = ?
            AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
          GROUP BY TRIM(COALESCE(variant_id, ''))
        `,
        [safeShop, pid]
      );
      const variantIds = Array.from(new Set((qtyRows || []).map((r) => parseLegacyVariantId(r && r.variant_id)).filter(Boolean)));
      if (variantIds.length) {
        const unitCostMap = await fetchVariantUnitCosts(safeShop, accessToken, variantIds);
        let sum = 0;
        let matchedQty = 0;
        for (const row of qtyRows || []) {
          const vid = parseLegacyVariantId(row && row.variant_id);
          const qty = row && row.qty != null ? Number(row.qty) : NaN;
          if (!vid || !Number.isFinite(qty) || qty <= 0) continue;
          const cost = unitCostMap.get(vid);
          if (!cost || !Number.isFinite(Number(cost.amount))) continue;
          const raw = Number(cost.amount) * qty;
          const currency = fx.normalizeCurrency(cost.currency) || 'GBP';
          const gbp = fx.convertToGbp(raw, currency, ratesToGbp);
          if (!Number.isFinite(gbp)) continue;
          sum += gbp;
          matchedQty += qty;
        }
        costOfGoodsLifetimeGbp = matchedQty > 0 ? (Math.round(sum * 100) / 100) : null;
      }
    } catch (_) {
      costOfGoodsLifetimeGbp = null;
    }
  }

  return {
    totalSalesLifetime: totalSalesLifetime != null ? totalSalesLifetime : null,
    totalRevenueLifetimeGbp: totalRevenueLifetimeGbp != null ? totalRevenueLifetimeGbp : null,
    costOfGoodsLifetimeGbp,
  };
}

async function getProductInsights(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=10');
  res.setHeader('Vary', 'Cookie');

  const handleRaw = normalizeHandle(req.query && req.query.handle ? String(req.query.handle) : '');
  const productIdRaw = req.query && req.query.product_id != null ? String(req.query.product_id).trim() : '';
  if (!handleRaw && !productIdRaw) return res.status(400).json({ ok: false, error: 'Missing handle or product_id' });

  const rangeKey = normalizeRangeKey(req.query && req.query.range ? req.query.range : 'today');
  const timeZone = store.resolveAdminTimeZone();
  const { start, end } = store.getRangeBounds(rangeKey, Date.now(), timeZone);

  const shopRaw = (req.query && req.query.shop) ? String(req.query.shop).trim().toLowerCase() : '';
  const shop = salesTruth.resolveShopForSales(shopRaw) || salesTruth.resolveShopForSales('') || shopRaw || '';
  const token = shop ? await salesTruth.getAccessToken(shop).catch(() => null) : null;

  const db = getDb();
  const botFilterSql = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';
  const eventsBotFilterSql = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';

  // Product metadata (best-effort): handle takes precedence; if missing, resolve from product_id
  let product = null;
  let handle = handleRaw;
  if (handle) {
    try { product = await fetchShopifyProductByHandle(shop, token, handle); } catch (_) { product = null; }
  }
  if (!product && productIdRaw && token) {
    try { product = await fetchShopifyProductById(shop, token, productIdRaw); } catch (_) { product = null; }
    if (product && product.handle) handle = product.handle;
  }
  const productId = product && product.productId ? String(product.productId) : (productIdRaw ? toNumericProductId(productIdRaw) : null);
  let details = {
    inventoryUnits: product && product.inventoryUnits != null ? Number(product.inventoryUnits) : null,
    inStockVariants: product && product.inStockVariants != null ? Number(product.inStockVariants) : null,
    totalSalesLifetime: null,
    totalRevenueLifetimeGbp: null,
    costOfGoodsLifetimeGbp: null,
  };
  if (shop && productId) {
    try {
      const cache = await reportCache.getOrComputeJson(
        {
          shop,
          endpoint: 'product-insights-details-lifetime',
          rangeKey: 'lifetime',
          rangeStartTs: 0,
          rangeEndTs: 0,
          params: { productId, handle, v: 1 },
          ttlMs: 6 * 60 * 60 * 1000,
        },
        async () => computeLifetimeProductDetails({ db, shop, productId, accessToken: token })
      );
      const fromCache = cache && cache.ok && cache.data ? cache.data : null;
      if (fromCache && typeof fromCache === 'object') {
        details = {
          ...details,
          totalSalesLifetime: fromCache.totalSalesLifetime != null ? Number(fromCache.totalSalesLifetime) : null,
          totalRevenueLifetimeGbp: fromCache.totalRevenueLifetimeGbp != null ? Number(fromCache.totalRevenueLifetimeGbp) : null,
          costOfGoodsLifetimeGbp: fromCache.costOfGoodsLifetimeGbp != null ? Number(fromCache.costOfGoodsLifetimeGbp) : null,
        };
      }
    } catch (_) {}
  }

  // Sales (Shopify truth line items)
  const ratesToGbp = await fx.getRatesToGbp();
  let revenueGbp = 0;
  let orders = 0;
  let units = 0;
  let salesRows = [];
  if (shop && productId) {
    try {
      salesRows = await db.all(
        `
          SELECT
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
            COUNT(DISTINCT order_id) AS orders,
            COALESCE(SUM(line_revenue), 0) AS revenue,
            COALESCE(SUM(quantity), 0) AS units
          FROM orders_shopify_line_items
          WHERE shop = ?
            AND order_created_at >= ? AND order_created_at < ?
            AND (order_test IS NULL OR order_test = 0)
            AND order_cancelled_at IS NULL
            AND order_financial_status = 'paid'
            AND product_id IS NOT NULL AND TRIM(product_id) = ?
          GROUP BY COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
        `,
        [shop, start, end, productId]
      );
    } catch (e) {
      console.warn('[product-insights] sales query failed:', e && e.message ? e.message : e);
      salesRows = [];
    }
  }
  for (const r of salesRows || []) {
    const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
    const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
    const gbp = fx.convertToGbp(Number.isFinite(revRaw) ? revRaw : 0, cur, ratesToGbp);
    revenueGbp += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
    const o = r && r.orders != null ? Number(r.orders) : 0;
    orders += Number.isFinite(o) ? Math.trunc(o) : 0;
    const u = r && r.units != null ? Number(r.units) : 0;
    units += Number.isFinite(u) ? Math.trunc(u) : 0;
  }
  revenueGbp = Math.round(revenueGbp * 100) / 100;

  // Top countries by product revenue (Shopify truth orders -> order country).
  let topCountries = [];
  if (shop && productId) {
    try {
      const rows = await db.all(
        `
          SELECT
            o.order_id AS order_id,
            MAX(o.raw_json) AS raw_json,
            COALESCE(NULLIF(TRIM(li.currency), ''), 'GBP') AS currency,
            COALESCE(SUM(li.line_revenue), 0) AS revenue
          FROM orders_shopify_line_items li
          INNER JOIN orders_shopify o
            ON o.shop = li.shop AND o.order_id = li.order_id
          WHERE li.shop = ?
            AND li.order_created_at >= ? AND li.order_created_at < ?
            AND (li.order_test IS NULL OR li.order_test = 0)
            AND li.order_cancelled_at IS NULL
            AND li.order_financial_status = 'paid'
            AND li.product_id IS NOT NULL AND TRIM(li.product_id) = ?
            AND o.created_at >= ? AND o.created_at < ?
            AND (o.test IS NULL OR o.test = 0)
            AND o.cancelled_at IS NULL
            AND o.financial_status = 'paid'
          GROUP BY o.order_id, COALESCE(NULLIF(TRIM(li.currency), ''), 'GBP')
        `,
        [shop, start, end, productId, start, end]
      );

      const orderCountry = new Map(); // order_id -> CC
      const byCountry = new Map(); // CC -> { country_code, orderIds:Set, revenueGbp }
      for (const r of rows || []) {
        const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
        if (!oid) continue;
        let cc = orderCountry.get(oid);
        if (!cc) {
          cc = orderCountryCodeFromRawJson(r && r.raw_json != null ? String(r.raw_json) : '');
          orderCountry.set(oid, cc);
        }
        if (!cc || cc === 'XX') continue;

        const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
        const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
        const gbp = fx.convertToGbp(Number.isFinite(revRaw) ? revRaw : 0, cur, ratesToGbp);
        const gbpAmt = (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;

        const curRow = byCountry.get(cc) || { country_code: cc, orderIds: new Set(), revenueGbp: 0 };
        curRow.orderIds.add(oid);
        curRow.revenueGbp += gbpAmt;
        byCountry.set(cc, curRow);
      }

      topCountries = Array.from(byCountry.values())
        .map((r) => ({
          country_code: r.country_code,
          orders: r.orderIds ? r.orderIds.size : 0,
          revenueGbp: Math.round((Number(r.revenueGbp) || 0) * 100) / 100,
        }))
        .sort((a, b) => (b.revenueGbp - a.revenueGbp) || (b.orders - a.orders));
      topCountries = topCountries.slice(0, 5);
    } catch (e) {
      console.warn('[product-insights] top countries query failed:', e && e.message ? e.message : e);
      topCountries = [];
    }
  }

  // Clicks / landings (sessions whose first page was that product)
  let clicks = 0;
  try {
    const likePath = '/products/' + handle + '%';
    const likeUrl = '%/products/' + handle + '%';
    const row = await db.get(
      `
        SELECT COUNT(*) AS c
        FROM sessions s
        WHERE s.started_at >= ? AND s.started_at < ?
          ${botFilterSql}
          AND ${handleMatchSql()}
      `,
      [start, end, handle, likePath, likeUrl]
    );
    clicks = row && row.c != null ? Number(row.c) || 0 : 0;
  } catch (_) {
    clicks = 0;
  }

  // Events for this product
  const eventTypes = ['product_viewed', 'product_added_to_cart', 'product_removed_from_cart', 'checkout_started', 'checkout_completed'];
  const eventsByType = {};
  eventTypes.forEach((t) => { eventsByType[t] = 0; });
  try {
    const rows = await db.all(
      `
        SELECT e.type AS type, COUNT(*) AS c
        FROM events e
        INNER JOIN sessions s ON s.session_id = e.session_id
        WHERE e.ts >= ? AND e.ts < ?
          ${eventsBotFilterSql}
          AND e.product_handle IS NOT NULL AND LOWER(TRIM(e.product_handle)) = ?
          AND e.type IN (${eventTypes.map(() => '?').join(',')})
        GROUP BY e.type
      `,
      [start, end, handle, ...eventTypes]
    );
    for (const r of rows || []) {
      const t = r && r.type ? String(r.type) : '';
      if (!t) continue;
      const n = r && r.c != null ? Number(r.c) : 0;
      eventsByType[t] = Number.isFinite(n) ? Math.trunc(n) : 0;
    }
  } catch (_) {}

  const views = eventsByType.product_viewed || 0;
  const addToCart = eventsByType.product_added_to_cart || 0;
  const checkoutStarted = eventsByType.checkout_started || 0;

  // Series: bucket hourly for day ranges; daily otherwise.
  const isHourly = rangeKey === 'today' || rangeKey === 'yesterday' || rangeKey.startsWith('d:');
  const bucketMs = isHourly ? 3600000 : 86400000;
  const maxBuckets = isHourly ? 48 : 60;
  const bucketCount = Math.max(1, Math.min(maxBuckets, Math.ceil((end - start) / bucketMs)));

  function initSeries() {
    const points = [];
    for (let i = 0; i < bucketCount; i++) {
      points.push({
        ts: start + i * bucketMs,
        revenueGbp: 0,
        orders: 0,
        units: 0,
        clicks: 0,
        views: 0,
        addToCart: 0,
      });
    }
    return points;
  }

  const series = initSeries();

  // Sales series (by bucket index) from line items.
  if (shop && productId) {
    try {
      const rows = await db.all(
        `
          SELECT
            ${require('../db').isPostgres()
              ? `FLOOR((order_created_at - ?)/(?::double precision))::bigint`
              : `CAST((order_created_at - ?)/? AS INTEGER)`
            } AS bi,
            COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
            COUNT(DISTINCT order_id) AS orders,
            COALESCE(SUM(line_revenue), 0) AS revenue,
            COALESCE(SUM(quantity), 0) AS units
          FROM orders_shopify_line_items
          WHERE shop = ?
            AND order_created_at >= ? AND order_created_at < ?
            AND (order_test IS NULL OR order_test = 0)
            AND order_cancelled_at IS NULL
            AND order_financial_status = 'paid'
            AND product_id IS NOT NULL AND TRIM(product_id) = ?
          GROUP BY bi, COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
        `,
        [start, bucketMs, shop, start, end, productId]
      );
      for (const r of rows || []) {
        const bi = r && r.bi != null ? Number(r.bi) : null;
        if (bi == null || !Number.isFinite(bi) || bi < 0 || bi >= series.length) continue;
        const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
        const revRaw = r && r.revenue != null ? Number(r.revenue) : 0;
        const gbp = fx.convertToGbp(Number.isFinite(revRaw) ? revRaw : 0, cur, ratesToGbp);
        series[bi].revenueGbp += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
        const o = r && r.orders != null ? Number(r.orders) : 0;
        series[bi].orders += Number.isFinite(o) ? Math.trunc(o) : 0;
        const u = r && r.units != null ? Number(r.units) : 0;
        series[bi].units += Number.isFinite(u) ? Math.trunc(u) : 0;
      }
      for (const p of series) {
        p.revenueGbp = Math.round((Number(p.revenueGbp) || 0) * 100) / 100;
      }
    } catch (e) {
      console.warn('[product-insights] sales series failed:', e && e.message ? e.message : e);
    }
  }

  // Clicks series (sessions)
  try {
    const likePath = '/products/' + handle + '%';
    const likeUrl = '%/products/' + handle + '%';
    const rows = await db.all(
      `
        SELECT
          ${require('../db').isPostgres()
            ? `FLOOR((s.started_at - ?)/(?::double precision))::bigint`
            : `CAST((s.started_at - ?)/? AS INTEGER)`
          } AS bi,
          COUNT(*) AS c
        FROM sessions s
        WHERE s.started_at >= ? AND s.started_at < ?
          ${botFilterSql}
          AND ${handleMatchSql()}
        GROUP BY bi
      `,
      [start, bucketMs, start, end, handle, likePath, likeUrl]
    );
    for (const r of rows || []) {
      const bi = r && r.bi != null ? Number(r.bi) : null;
      if (bi == null || !Number.isFinite(bi) || bi < 0 || bi >= series.length) continue;
      const n = r && r.c != null ? Number(r.c) : 0;
      series[bi].clicks += Number.isFinite(n) ? Math.trunc(n) : 0;
    }
  } catch (_) {}

  // Events series
  try {
    const rows = await db.all(
      `
        SELECT
          ${require('../db').isPostgres()
            ? `FLOOR((e.ts - ?)/(?::double precision))::bigint`
            : `CAST((e.ts - ?)/? AS INTEGER)`
          } AS bi,
          e.type AS type,
          COUNT(*) AS c
        FROM events e
        INNER JOIN sessions s ON s.session_id = e.session_id
        WHERE e.ts >= ? AND e.ts < ?
          ${eventsBotFilterSql}
          AND e.product_handle IS NOT NULL AND LOWER(TRIM(e.product_handle)) = ?
          AND e.type IN ('product_viewed', 'product_added_to_cart')
        GROUP BY bi, e.type
      `,
      [start, bucketMs, start, end, handle]
    );
    for (const r of rows || []) {
      const bi = r && r.bi != null ? Number(r.bi) : null;
      if (bi == null || !Number.isFinite(bi) || bi < 0 || bi >= series.length) continue;
      const t = r && r.type ? String(r.type) : '';
      const n = r && r.c != null ? Number(r.c) : 0;
      const v = Number.isFinite(n) ? Math.trunc(n) : 0;
      if (t === 'product_viewed') series[bi].views += v;
      if (t === 'product_added_to_cart') series[bi].addToCart += v;
    }
  } catch (_) {}

  // Derived metrics
  const cr = clicks > 0 ? Math.round((orders / clicks) * 10000) / 100 : null;
  const atcRate = views > 0 ? Math.round((addToCart / views) * 10000) / 100 : null;
  const revPerClick = clicks > 0 ? Math.round((revenueGbp / clicks) * 100) / 100 : null;
  const revPerView = views > 0 ? Math.round((revenueGbp / views) * 100) / 100 : null;

  // Ensure product images include a larger variant
  if (product && Array.isArray(product.images)) {
    product.images = product.images.map((img) => ({
      url: upgradeImgUrl(img && img.url ? img.url : '', 1000),
      thumb: upgradeImgUrl(img && img.url ? img.url : '', 120),
      alt: img && img.alt ? String(img.alt) : '',
    })).filter((img) => !!img.url);
  }

  return res.json({
    ok: true,
    kind: 'product',
    handle,
    rangeKey,
    rangeStartTs: start,
    rangeEndTs: end,
    timeZone,
    currency: 'GBP',
    links: {
      adminProductUrl: (shop && productId) ? (`https://${shop}/admin/products/${encodeURIComponent(String(productId))}`) : null,
    },
    product,
    details,
    topCountries,
    metrics: {
      revenueGbp,
      orders,
      units,
      clicks,
      views,
      addToCart,
      checkoutStarted,
      cr,
      atcRate,
      revPerClick,
      revPerView,
    },
    series: {
      isHourly,
      bucketMs,
      points: series,
    },
  });
}

module.exports = { getProductInsights };

