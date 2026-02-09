/**
 * GET /api/product-insights?handle=...&range=today|yesterday|3d|7d|month|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD&shop=...
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

const API_VERSION = '2025-01';

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d', 'month'];

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
        featuredImage { url altText }
        images(first: 20) { nodes { url altText } }
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
  return {
    productId: numericId || null,
    title: title || null,
    handle: prod.handle ? String(prod.handle).trim().toLowerCase() : handle,
    productType: prod.productType ? String(prod.productType).trim() : null,
    images,
  };
}

async function getProductInsights(req, res) {
  res.setHeader('Cache-Control', 'private, max-age=10');
  res.setHeader('Vary', 'Cookie');

  const handle = normalizeHandle(req.query && req.query.handle ? String(req.query.handle) : '');
  if (!handle) return res.status(400).json({ ok: false, error: 'Missing handle' });

  const rangeKey = normalizeRangeKey(req.query && req.query.range ? req.query.range : 'today');
  const timeZone = store.resolveAdminTimeZone();
  const { start, end } = store.getRangeBounds(rangeKey, Date.now(), timeZone);

  const shopRaw = (req.query && req.query.shop) ? String(req.query.shop).trim().toLowerCase() : '';
  const shop = salesTruth.resolveShopForSales(shopRaw) || salesTruth.resolveShopForSales('') || shopRaw || '';
  const token = shop ? await salesTruth.getAccessToken(shop).catch(() => null) : null;

  const db = getDb();
  const botFilterSql = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';
  const eventsBotFilterSql = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';

  // Product metadata (best-effort)
  let product = null;
  try { product = await fetchShopifyProductByHandle(shop, token, handle); } catch (_) { product = null; }
  const productId = product && product.productId ? String(product.productId) : null;

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
    product,
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

