/**
 * GET /api/performance/gross-profit?range=30d | ?since=YYYY-MM-DD&until=YYYY-MM-DD
 * Returns product-level gross profit (revenue − line-level COGS − allocated shared costs) for High and Low tables.
 * Shared cost allocation: window shared cost → orders by revenue share → line items by revenue share.
 * Low table = high-revenue products sorted by gross profit ascending (loss/breakeven first).
 * Gated by settings.cost_expenses (caller must enforce).
 */

const Sentry = require('@sentry/node');
const express = require('express');
const store = require('../store');
const salesTruth = require('../salesTruth');
const businessSnapshotService = require('../businessSnapshotService');
const fx = require('../fx');
const { getDb } = require('../db');
const { sleep } = require('../shared/sleep');

const router = express.Router();
const LIMIT = 25;
const HIGH_REVENUE_POOL = 200;
const API_VERSION = '2025-01';
const VARIANT_COST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const variantCostCache = new Map();

function round2(n) {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function safeShopParam(req) {
  const q = req && req.query ? req.query : {};
  const shop = (q.shop != null ? String(q.shop) : '').trim().toLowerCase();
  if (shop && /\.myshopify\.com$/i.test(shop)) return shop;
  return salesTruth.resolveShopForSales(shop || '');
}

function parseLegacyVariantId(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/\/(\d+)(?:\D.*)?$/);
  return m && m[1] ? m[1] : '';
}

function parseYmd(s) {
  const str = String(s || '').trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

async function shopifyGraphqlWithRetry(shop, accessToken, query, variables, { maxRetries = 6 } = {}) {
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
  const chunkSize = 75;
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
  for (let i = 0; i < missing.length; i += chunkSize) {
    const part = missing.slice(i, i + chunkSize);
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

router.get('/gross-profit', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    if (!shop) {
      return res.status(400).json({ ok: false, error: 'missing_shop' });
    }

    const q = req.query || {};
    const sinceYmd = parseYmd(q.since);
    const untilYmd = parseYmd(q.until);
    let rangeKey;
    if (sinceYmd && untilYmd) {
      rangeKey = `r:${sinceYmd}:${untilYmd}`;
    } else {
      const rangeRaw = (q.range != null) ? String(q.range).trim() : '30d';
      const allowed = new Set(['today', 'yesterday', '7d', '14d', '30d']);
      rangeKey = allowed.has(rangeRaw.toLowerCase()) ? rangeRaw.toLowerCase() : '30d';
    }

    const nowMs = Date.now();
    const timeZone = store.resolveAdminTimeZone();
    const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
    const startMs = bounds && Number.isFinite(bounds.start) ? bounds.start : nowMs;
    const endMs = bounds && Number.isFinite(bounds.end) ? bounds.end : nowMs;
    if (!(endMs > startMs)) {
      return res.status(400).json({ ok: false, error: 'invalid_range' });
    }

    const token = await salesTruth.getAccessToken(shop).catch(() => null);
    const [costBreakdown, lineRows] = await Promise.all([
      businessSnapshotService.getCostBreakdown({ rangeKey }),
      getLineItemsInRange(shop, startMs, endMs),
    ]);

    const ratesToGbp = await fx.getRatesToGbp();
    const orderRevenueGbp = new Map();
    let windowRevenueGbp = 0;
    for (const row of lineRows || []) {
      const oid = row && row.order_id != null ? String(row.order_id) : '';
      const cur = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
      const lineRev = Number(row && row.line_revenue) || 0;
      const gbp = fx.convertToGbp(Number.isFinite(lineRev) ? lineRev : 0, cur, ratesToGbp);
      if (!oid || !Number.isFinite(gbp)) continue;
      const prev = orderRevenueGbp.get(oid) || 0;
      orderRevenueGbp.set(oid, round2(prev + gbp));
      windowRevenueGbp += gbp;
    }
    windowRevenueGbp = round2(windowRevenueGbp);

    if (windowRevenueGbp <= 0) {
      const totalCost = (costBreakdown && costBreakdown.totals && costBreakdown.totals.active_total != null)
        ? round2(Number(costBreakdown.totals.active_total)) : 0;
      return res.json({
        ok: true,
        rangeKey,
        high: [],
        low: [],
        meta: { windowRevenue: 0, totalCost, productCount: 0 },
      });
    }

    const cogsItem = Array.isArray(costBreakdown && costBreakdown.items) ? costBreakdown.items.find((i) => i && i.key === 'cogs') : null;
    const cogsAmount = cogsItem && cogsItem.active ? round2(Number(cogsItem.amount) || 0) : 0;
    const activeTotal = (costBreakdown && costBreakdown.totals && costBreakdown.totals.active_total != null)
      ? round2(Number(costBreakdown.totals.active_total)) : 0;
    const sharedCost = Math.max(0, round2(activeTotal - cogsAmount));

    const variantIds = [];
    for (const row of lineRows || []) {
      const vid = row && row.variant_id != null ? parseLegacyVariantId(String(row.variant_id)) : '';
      if (vid) variantIds.push(vid);
    }
    const unitCostMap = token ? await fetchVariantUnitCosts(shop, token, variantIds) : new Map();

    const orderCostById = new Map();
    for (const [oid, rev] of orderRevenueGbp.entries()) {
      const cost = sharedCost * (rev / windowRevenueGbp);
      orderCostById.set(oid, round2(cost));
    }

    const byProduct = new Map();
    for (const row of lineRows || []) {
      const orderId = row && row.order_id != null ? String(row.order_id) : '';
      const productId = (row && row.product_id != null) ? String(row.product_id).trim() : '';
      const title = (row && row.title != null) ? String(row.title).trim() : '';
      const variantId = row && row.variant_id != null ? parseLegacyVariantId(String(row.variant_id)) : '';
      const quantity = Number(row && row.quantity) || 0;
      const cur = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
      const lineRevRaw = Number(row && row.line_revenue) || 0;
      const lineRevGbp = fx.convertToGbp(Number.isFinite(lineRevRaw) ? lineRevRaw : 0, cur, ratesToGbp);
      const lineRev = round2(lineRevGbp);
      const orderRev = orderRevenueGbp.get(orderId) || 0;
      const orderAlloc = orderCostById.get(orderId) || 0;
      const lineAlloc = orderRev > 0 ? round2(orderAlloc * (lineRev / orderRev)) : 0;
      let lineCogsGbp = 0;
      if (variantId && quantity > 0 && unitCostMap.has(variantId)) {
        const uc = unitCostMap.get(variantId);
        const raw = (Number(uc.amount) || 0) * quantity;
        const cc = fx.normalizeCurrency(uc.currency) || 'GBP';
        lineCogsGbp = round2(fx.convertToGbp(raw, cc, ratesToGbp));
      }
      const lineCost = round2(lineCogsGbp + lineAlloc);
      const key = productId || '(no product)';
      const curP = byProduct.get(key) || { product_id: productId, title: title || key, revenue: 0, cost: 0 };
      curP.revenue = round2(curP.revenue + lineRev);
      curP.cost = round2(curP.cost + lineCost);
      byProduct.set(key, curP);
    }

    const products = [];
    for (const [, v] of byProduct.entries()) {
      const grossProfit = round2(v.revenue - v.cost);
      products.push({
        product_id: v.product_id,
        title: v.title,
        revenue_gbp: v.revenue,
        cost_gbp: v.cost,
        gross_profit_gbp: grossProfit,
      });
    }

    const byProfitDesc = [...products].sort((a, b) => (b.gross_profit_gbp != null ? b.gross_profit_gbp : 0) - (a.gross_profit_gbp != null ? a.gross_profit_gbp : 0));
    const high = byProfitDesc.slice(0, LIMIT);

    const byRevenueDesc = [...products].sort((a, b) => (b.revenue_gbp != null ? b.revenue_gbp : 0) - (a.revenue_gbp != null ? a.revenue_gbp : 0));
    const highRevenuePool = byRevenueDesc.slice(0, HIGH_REVENUE_POOL);
    highRevenuePool.sort((a, b) => {
      const pa = a.gross_profit_gbp != null ? a.gross_profit_gbp : 0;
      const pb = b.gross_profit_gbp != null ? b.gross_profit_gbp : 0;
      if (pa !== pb) return pa - pb;
      return (b.revenue_gbp != null ? b.revenue_gbp : 0) - (a.revenue_gbp != null ? a.revenue_gbp : 0);
    });
    const low = highRevenuePool.slice(0, LIMIT);

    res.json({
      ok: true,
      rangeKey,
      high,
      low,
      meta: {
        windowRevenue: windowRevenueGbp,
        totalCost: activeTotal,
        productCount: products.length,
      },
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'performance.gross-profit' } });
    console.error('[performance.gross-profit]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

async function getLineItemsInRange(shop, startMs, endMs) {
  const db = getDb();
  try {
    return await db.all(
      `
      SELECT li.order_id, li.product_id, li.title, li.variant_id, li.quantity,
             COALESCE(NULLIF(TRIM(li.currency), ''), 'GBP') AS currency,
             COALESCE(li.line_net, li.line_revenue, li.quantity * li.unit_price, 0) AS line_revenue
      FROM orders_shopify_line_items li
      INNER JOIN orders_shopify o ON o.shop = li.shop AND o.order_id = li.order_id
        AND (COALESCE(o.processed_at, o.created_at) >= ? AND COALESCE(o.processed_at, o.created_at) < ?)
        AND (o.test IS NULL OR o.test = 0)
        AND o.cancelled_at IS NULL
        AND o.financial_status = 'paid'
      WHERE li.shop = ?
      `,
      [startMs, endMs, shop]
    );
  } catch (_) {
    return [];
  }
}

module.exports = router;
