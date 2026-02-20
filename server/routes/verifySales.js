/**
 * GET /api/verify-sales?shop=xxx.myshopify.com
 *
 * Verifies (Shopify fetched) vs (DB truth orders_shopify) for:
 * 1) Today so far (Europe/London midnight → now)
 * 2) Last 1 hour
 * 3) Yesterday (full day Europe/London)
 *
 * Writes results into audit_log. Fail-open: if Shopify fetch fails, returns error indicators.
 */
const store = require('../store');
const salesTruth = require('../salesTruth');
const revenueNetSales = require('../revenueNetSales');
const { writeAudit } = require('../audit');
const { getDb } = require('../db');

function round2(n) {
  const x = typeof n === 'number' ? n : Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

async function verifySales(req, res) {
  const shop = salesTruth.resolveShopForSales(req.query.shop || '');
  if (!shop) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const useSnapshot = String(req.query.source || '').trim().toLowerCase() === 'snapshot' ||
    req.query.snapshot === '1' || req.query.snapshot === 'true';

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const ranges = [
    { key: 'today', label: 'today', bounds: store.getRangeBounds('today', nowMs, timeZone) },
    { key: '1h', label: 'last_1h', bounds: store.getRangeBounds('1h', nowMs, timeZone) },
    { key: 'yesterday', label: 'yesterday', bounds: store.getRangeBounds('yesterday', nowMs, timeZone) },
  ];

  const results = [];
  const db = getDb();
  for (const r of ranges) {
    let start = r.bounds.start;
    let end = r.bounds.end;
    let shopify = null;
    let dbTruth = null;
    let diff = null;
    let pixel = null;
    let diffPixel = null;
    let error = null;
    try {
      // Optionally: use latest reconcile snapshot for this range start (no Shopify fetch).
      if (useSnapshot) {
        try {
          const snap = await db.get(
            `
              SELECT scope, range_start_ts, range_end_ts, shopify_order_count, shopify_revenue_gbp, fetched_at
              FROM reconcile_snapshots
              WHERE shop = ? AND range_start_ts = ?
              ORDER BY fetched_at DESC
              LIMIT 1
            `,
            [shop, start]
          );
          if (snap && snap.shopify_order_count != null && snap.shopify_revenue_gbp != null) {
            start = snap.range_start_ts != null ? Number(snap.range_start_ts) : start;
            end = snap.range_end_ts != null ? Number(snap.range_end_ts) : end;
            shopify = {
              source: 'reconcile_snapshot',
              scope: snap.scope || '',
              fetchedAt: snap.fetched_at != null ? Number(snap.fetched_at) : null,
              orderCount: Number(snap.shopify_order_count) || 0,
              revenueGbp: round2(Number(snap.shopify_revenue_gbp) || 0),
            };
          }
        } catch (_) {}
      }

      // Default: fetch Shopify totals without mutating orders_shopify.
      if (!shopify) {
        const s = await salesTruth.fetchShopifyOrdersSummary(shop, start, end);
        if (!s || s.ok !== true) {
          error = s && s.error ? String(s.error) : 'Shopify fetch failed';
        } else {
          shopify = {
            source: 'shopify_api',
            orderCount: s.orderCount || 0,
            revenueGbp: round2(s.revenueGbp || 0),
            revenueByCurrency: s.revenueByCurrency || {},
            fetched: s.fetched || 0,
          };
        }
      }

      const orderCount = await salesTruth.getTruthOrderCount(shop, start, end);
      const revenueGbp = await salesTruth.getTruthSalesTotalGbp(shop, start, end);
      const rawKpi = await store.getSetting('kpi_ui_config_v1');
      const attribution = revenueNetSales.parseReturnsRefundsAttribution(rawKpi);
      const { totalSalesGbp: totalSalesNetOfRefunds, refundsGbp } = await salesTruth.getTruthTotalSalesNetOfRefunds(shop, start, end, attribution);
      const returningCustomerCount = await salesTruth.getTruthReturningCustomerCount(shop, start, end);
      const returningRevenueGbp = await salesTruth.getTruthReturningRevenueGbp(shop, start, end);
      dbTruth = {
        orderCount,
        revenueGbp,
        totalSalesNetOfRefunds: round2(totalSalesNetOfRefunds),
        refundsGbp: round2(refundsGbp),
        returningCustomerCount,
        returningRevenueGbp,
      };

      // Pixel-derived totals (purchases table, deduped in query).
      try {
        const p = await store.getPixelSalesSummary(start, end);
        pixel = {
          orderCount: typeof p.orderCount === 'number' ? p.orderCount : null,
          revenueGbp: typeof p.revenueGbp === 'number' ? p.revenueGbp : null,
          label: 'pixel-derived (purchases)',
        };
      } catch (_) {
        pixel = { orderCount: null, revenueGbp: null, label: 'pixel-derived (purchases)' };
      }

      if (shopify && dbTruth && typeof shopify.orderCount === 'number' && typeof shopify.revenueGbp === 'number') {
        diff = {
          orderCount: (dbTruth.orderCount || 0) - (shopify.orderCount || 0),
          revenueGbp: round2((dbTruth.revenueGbp || 0) - (shopify.revenueGbp || 0)),
          // Returning diffs are not computed in verify-only mode (no customer-history fetch).
          returningCustomerCount: null,
          returningRevenueGbp: null,
        };
        if (pixel && typeof pixel.orderCount === 'number' && typeof pixel.revenueGbp === 'number') {
          diffPixel = {
            orderCount: (pixel.orderCount || 0) - (shopify.orderCount || 0),
            revenueGbp: round2((pixel.revenueGbp || 0) - (shopify.revenueGbp || 0)),
          };
        }
      }
    } catch (e) {
      error = e && e.message ? String(e.message) : 'verify_failed';
    }
    results.push({
      range: { key: r.key, start, end, source: useSnapshot ? 'snapshot_or_shopify' : 'shopify' },
      shopify,
      dbTruth,
      diff,
      pixel,
      diffPixel,
      ok: !!(diff && diff.orderCount === 0 && diff.revenueGbp === 0),
      error,
    });
  }

  await writeAudit('system', 'verify_sales', {
    shop,
    timeZone,
    nowMs,
    useSnapshot,
    results,
  });

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.json({ shop, timeZone, nowMs, results });
}

module.exports = { verifySales };

