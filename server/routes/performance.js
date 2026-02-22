/**
 * GET /api/performance/gross-profit?range=30d
 * Returns product-level gross profit (revenue − allocated costs) for High and Low tables.
 * Cost allocation: window cost → orders by revenue share → line items by revenue share.
 * Gated by settings.cost_expenses (caller must enforce).
 */

const Sentry = require('@sentry/node');
const express = require('express');
const store = require('../store');
const salesTruth = require('../salesTruth');
const businessSnapshotService = require('../businessSnapshotService');
const { getDb } = require('../db');

const router = express.Router();
const LIMIT = 25;

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

router.get('/gross-profit', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=120');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    if (!shop) {
      return res.status(400).json({ ok: false, error: 'missing_shop' });
    }

    const rangeRaw = (req.query && req.query.range != null) ? String(req.query.range).trim() : '30d';
    const allowed = new Set(['today', 'yesterday', '7d', '14d', '30d']);
    const rangeKey = allowed.has(rangeRaw.toLowerCase()) ? rangeRaw.toLowerCase() : '30d';

    const nowMs = Date.now();
    const timeZone = store.resolveAdminTimeZone();
    const bounds = store.getRangeBounds(rangeKey, nowMs, timeZone);
    const startMs = bounds && Number.isFinite(bounds.start) ? bounds.start : nowMs;
    const endMs = bounds && Number.isFinite(bounds.end) ? bounds.end : nowMs;
    if (!(endMs > startMs)) {
      return res.status(400).json({ ok: false, error: 'invalid_range' });
    }

    const [costBreakdown, windowRevenueGbp, orderRows, lineRows] = await Promise.all([
      businessSnapshotService.getCostBreakdown({ rangeKey }),
      salesTruth.getTruthCheckoutSalesTotalGbp(shop, startMs, endMs),
      getOrdersWithRevenue(shop, startMs, endMs),
      getLineItemsInRange(shop, startMs, endMs),
    ]);

    const totalCost = (costBreakdown && costBreakdown.totals && Number(costBreakdown.totals.active_total) != null)
      ? round2(Number(costBreakdown.totals.active_total)) : 0;
    const windowRevenue = round2(Number(windowRevenueGbp) || 0);
    if (windowRevenue <= 0) {
      return res.json({
        ok: true,
        rangeKey,
        high: [],
        low: [],
        meta: { windowRevenue: 0, totalCost, productCount: 0 },
      });
    }

    const orderRevenueById = new Map();
    for (const r of orderRows || []) {
      const oid = r && r.order_id != null ? String(r.order_id) : '';
      const rev = Number(r && r.order_revenue) || 0;
      if (oid) orderRevenueById.set(oid, round2(rev));
    }

    const orderCostById = new Map();
    let allocated = 0;
    for (const [oid, rev] of orderRevenueById.entries()) {
      const cost = totalCost * (rev / windowRevenue);
      orderCostById.set(oid, round2(cost));
      allocated += cost;
    }

    const byProduct = new Map();
    for (const row of lineRows || []) {
      const orderId = row && row.order_id != null ? String(row.order_id) : '';
      const productId = (row && row.product_id != null) ? String(row.product_id).trim() : '';
      const title = (row && row.title != null) ? String(row.title).trim() : '';
      const lineRev = round2(Number(row && row.line_revenue) || 0);
      const orderRev = orderRevenueById.get(orderId) || 0;
      const orderCost = orderCostById.get(orderId) || 0;
      const lineCost = orderRev > 0 ? round2(orderCost * (lineRev / orderRev)) : 0;
      const key = productId || '(no product)';
      const cur = byProduct.get(key) || { product_id: productId, title: title || key, revenue: 0, cost: 0 };
      cur.revenue = round2(cur.revenue + lineRev);
      cur.cost = round2(cur.cost + lineCost);
      byProduct.set(key, cur);
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
    products.sort((a, b) => (b.gross_profit_gbp != null ? b.gross_profit_gbp : 0) - (a.gross_profit_gbp != null ? a.gross_profit_gbp : 0));
    const high = products.slice(0, LIMIT);
    const low = products.slice(-LIMIT).reverse();

    res.json({
      ok: true,
      rangeKey,
      high,
      low,
      meta: {
        windowRevenue,
        totalCost,
        productCount: products.length,
      },
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'performance.gross-profit' } });
    console.error('[performance.gross-profit]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

async function getOrdersWithRevenue(shop, startMs, endMs) {
  const db = getDb();
  try {
    return await db.all(
      `
      SELECT o.order_id,
             COALESCE(SUM(li.line_net), 0) AS order_revenue
      FROM orders_shopify o
      LEFT JOIN orders_shopify_line_items li ON li.shop = o.shop AND li.order_id = o.order_id
      WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
        AND (o.test IS NULL OR o.test = 0)
        AND o.cancelled_at IS NULL
        AND o.financial_status = 'paid'
      GROUP BY o.order_id
      `,
      [shop, startMs, endMs]
    );
  } catch (_) {
    return [];
  }
}

async function getLineItemsInRange(shop, startMs, endMs) {
  const db = getDb();
  try {
    return await db.all(
      `
      SELECT li.order_id, li.product_id, li.title,
             COALESCE(li.line_net, li.quantity * li.unit_price, 0) AS line_revenue
      FROM orders_shopify_line_items li
      INNER JOIN orders_shopify o ON o.shop = li.shop AND o.order_id = li.order_id
        AND o.created_at >= ? AND o.created_at < ?
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
