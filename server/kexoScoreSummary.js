/**
 * Kexo Score summary context builder (deterministic, no AI).
 * Uses same current/previous bounds as store.getKexoScore().
 * Builds product movers, attribution movers, and ads campaign movers for the score modal.
 */
const store = require('./store');
const salesTruth = require('./salesTruth');
const { getDb } = require('./db');
const config = require('./config');
const fx = require('./fx');
const { getAdsDb } = require('./ads/adsDb');

const TOP_PRODUCT_DOWN = 5;
const TOP_PRODUCT_UP = 3;
const TOP_ATTRIBUTION = 5;
const TOP_ADS = 5;

async function getProductMovers(range, compare) {
  const shop = salesTruth.resolveShopForSales('');
  if (!shop || !range || !compare) return { current: [], previous: [], movers: [] };

  const db = getDb();
  const isPg = !!config.dbUrl;
  const [startCur, endCur] = [Number(range.start), Number(range.end)];
  const [startPrev, endPrev] = [Number(compare.start), Number(compare.end)];
  if (!Number.isFinite(startCur) || !Number.isFinite(endCur) || endCur <= startCur) return { current: [], previous: [], movers: [] };
  if (!Number.isFinite(startPrev) || !Number.isFinite(endPrev) || endPrev <= startPrev) return { current: [], previous: [], movers: [] };

  const sql = isPg
    ? `SELECT TRIM(product_id) AS product_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, MAX(title) AS title,
         COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(line_revenue), 0) AS revenue, COALESCE(SUM(quantity), 0) AS items
         FROM orders_shopify_line_items
         WHERE shop = $1 AND order_created_at >= $2 AND order_created_at < $3
         AND (order_test IS NULL OR order_test = 0) AND order_cancelled_at IS NULL AND order_financial_status = 'paid'
         AND product_id IS NOT NULL AND TRIM(product_id) != '' AND title IS NOT NULL AND TRIM(title) != ''
         GROUP BY TRIM(product_id), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')`
    : `SELECT TRIM(product_id) AS product_id, COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, MAX(title) AS title,
         COUNT(DISTINCT order_id) AS orders, COALESCE(SUM(line_revenue), 0) AS revenue, COALESCE(SUM(quantity), 0) AS items
         FROM orders_shopify_line_items
         WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
         AND (order_test IS NULL OR order_test = 0) AND order_cancelled_at IS NULL AND order_financial_status = 'paid'
         AND product_id IS NOT NULL AND TRIM(product_id) != '' AND title IS NOT NULL AND TRIM(title) != ''
         GROUP BY TRIM(product_id), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')`;

  const paramsCur = isPg ? [shop, startCur, endCur] : [shop, startCur, endCur];
  const paramsPrev = isPg ? [shop, startPrev, endPrev] : [shop, startPrev, endPrev];

  const [rowsCur, rowsPrev] = await Promise.all([
    db.all(sql, paramsCur),
    db.all(sql, paramsPrev),
  ]);

  const ratesToGbp = await fx.getRatesToGbp();
  function toGbpByProduct(rows) {
    const byProduct = new Map();
    for (const r of rows || []) {
      const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
      if (!pid) continue;
      const title = r && r.title != null ? String(r.title).trim() : '';
      const cur = fx.normalizeCurrency(r && r.currency) || 'GBP';
      const rev = r && r.revenue != null ? Number(r.revenue) : 0;
      const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp) || 0;
      const orders = r && r.orders != null ? Math.max(0, Math.floor(Number(r.orders))) : 0;
      const items = r && r.items != null ? Math.max(0, Math.floor(Number(r.items))) : 0;
      const prev = byProduct.get(pid) || { product_id: pid, title: '', revenueGbp: 0, orders: 0, items: 0 };
      prev.revenueGbp += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
      prev.orders += orders;
      prev.items += items;
      if (!prev.title && title) prev.title = title;
      byProduct.set(pid, prev);
    }
    return Array.from(byProduct.values()).map((p) => ({
      product_id: p.product_id,
      title: p.title,
      revenueGbp: Math.round((p.revenueGbp || 0) * 100) / 100,
      orders: p.orders,
      items: p.items,
    }));
  }

  const current = toGbpByProduct(rowsCur);
  const previous = toGbpByProduct(rowsPrev);
  const prevMap = new Map(previous.map((p) => [p.product_id, p]));

  const movers = [];
  for (const c of current) {
    const p = prevMap.get(c.product_id);
    const prevRev = p ? p.revenueGbp : 0;
    const prevOrd = p ? p.orders : 0;
    const prevItems = p ? p.items : 0;
    movers.push({
      product_id: c.product_id,
      title: c.title,
      revenueGbpCur: c.revenueGbp,
      revenueGbpPrev: prevRev,
      deltaRevenue: Math.round((c.revenueGbp - prevRev) * 100) / 100,
      ordersCur: c.orders,
      ordersPrev: prevOrd,
      deltaOrders: c.orders - prevOrd,
      itemsCur: c.items,
      itemsPrev: prevItems,
      deltaItems: c.items - prevItems,
    });
  }
  movers.sort((a, b) => a.deltaRevenue - b.deltaRevenue);
  const down = movers.filter((m) => m.deltaRevenue < 0).slice(0, TOP_PRODUCT_DOWN);
  const up = movers.filter((m) => m.deltaRevenue > 0).slice(-TOP_PRODUCT_UP).reverse();
  return { current, previous, movers: [...down, ...up].slice(0, TOP_PRODUCT_DOWN + TOP_PRODUCT_UP) };
}

async function getAttributionMovers(range, compare) {
  const shop = salesTruth.resolveShopForSales('');
  if (!shop || !range || !compare) return { current: [], previous: [], movers: [] };

  const db = getDb();
  const isPg = !!config.dbUrl;
  const [startCur, endCur] = [Number(range.start), Number(range.end)];
  const [startPrev, endPrev] = [Number(compare.start), Number(compare.end)];
  if (!Number.isFinite(startCur) || !Number.isFinite(endCur) || endCur <= startCur) return { current: [], previous: [], movers: [] };
  if (!Number.isFinite(startPrev) || !Number.isFinite(endPrev) || endPrev <= startPrev) return { current: [], previous: [], movers: [] };

  const sql = isPg
    ? `SELECT LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other')) AS variant,
         COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
         COUNT(*) AS orders, SUM(COALESCE(total_price, 0)) AS revenue
         FROM orders_shopify
         WHERE shop = $1 AND created_at >= $2 AND created_at < $3
         AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'
         GROUP BY LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other')), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')`
    : `SELECT LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other')) AS variant,
         COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
         COUNT(*) AS orders, SUM(COALESCE(total_price, 0)) AS revenue
         FROM orders_shopify
         WHERE shop = ? AND created_at >= ? AND created_at < ?
         AND (test IS NULL OR test = 0) AND cancelled_at IS NULL AND financial_status = 'paid'
         GROUP BY LOWER(COALESCE(NULLIF(TRIM(attribution_variant), ''), 'other')), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')`;

  let rowsCur = [];
  let rowsPrev = [];
  try {
    [rowsCur, rowsPrev] = await Promise.all([
      db.all(sql, isPg ? [shop, startCur, endCur] : [shop, startCur, endCur]),
      db.all(sql, isPg ? [shop, startPrev, endPrev] : [shop, startPrev, endPrev]),
    ]);
  } catch (_) {
    return { current: [], previous: [], movers: [] };
  }

  const ratesToGbp = await fx.getRatesToGbp();
  function toGbpByVariant(rows) {
    const map = new Map();
    for (const r of rows || []) {
      const v = r && r.variant != null ? String(r.variant).trim().toLowerCase() : 'other';
      const cur = fx.normalizeCurrency(r && r.currency) || 'GBP';
      const rev = r && r.revenue != null ? Number(r.revenue) : 0;
      const gbp = fx.convertToGbp(Number.isFinite(rev) ? rev : 0, cur, ratesToGbp) || 0;
      const orders = r && r.orders != null ? Math.max(0, Math.floor(Number(r.orders))) : 0;
      const prev = map.get(v) || { variant: v, revenueGbp: 0, orders: 0 };
      prev.revenueGbp += (typeof gbp === 'number' && Number.isFinite(gbp)) ? gbp : 0;
      prev.orders += orders;
      map.set(v, prev);
    }
    return Array.from(map.values()).map((x) => ({
      variant: x.variant,
      revenueGbp: Math.round((x.revenueGbp || 0) * 100) / 100,
      orders: x.orders,
    }));
  }

  const current = toGbpByVariant(rowsCur);
  const previous = toGbpByVariant(rowsPrev);
  const prevMap = new Map(previous.map((p) => [p.variant, p]));

  const movers = [];
  for (const c of current) {
    const p = prevMap.get(c.variant);
    const prevRev = p ? p.revenueGbp : 0;
    const prevOrd = p ? p.orders : 0;
    movers.push({
      variant: c.variant,
      revenueGbpCur: c.revenueGbp,
      revenueGbpPrev: prevRev,
      deltaRevenue: Math.round((c.revenueGbp - prevRev) * 100) / 100,
      ordersCur: c.orders,
      ordersPrev: prevOrd,
      deltaOrders: c.orders - prevOrd,
    });
  }
  movers.sort((a, b) => a.deltaRevenue - b.deltaRevenue);
  const down = movers.filter((m) => m.deltaRevenue < 0).slice(0, TOP_ATTRIBUTION);
  const up = movers.filter((m) => m.deltaRevenue > 0).slice(-TOP_ATTRIBUTION).reverse();
  return { current, previous, movers: [...down, ...up] };
}

async function getAdsCampaignMovers(range, compare) {
  const adsDb = getAdsDb();
  if (!adsDb || !range || !compare) return { current: [], previous: [], movers: [] };

  const [startCur, endCur] = [Number(range.start), Number(range.end)];
  const [startPrev, endPrev] = [Number(compare.start), Number(compare.end)];
  if (!Number.isFinite(startCur) || !Number.isFinite(endCur) || endCur <= startCur) return { current: [], previous: [], movers: [] };
  if (!Number.isFinite(startPrev) || !Number.isFinite(endPrev) || endPrev <= startPrev) return { current: [], previous: [], movers: [] };

  const revSql = `SELECT campaign_id,
    (ARRAY_AGG(campaign_name ORDER BY updated_at DESC NULLS LAST) FILTER (WHERE campaign_name IS NOT NULL AND TRIM(campaign_name) != ''))[1] AS campaign_name,
    COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp, COUNT(*) AS orders
    FROM ads_orders_attributed
    WHERE created_at_ms >= ? AND created_at_ms < ?
    AND campaign_id IS NOT NULL AND TRIM(campaign_id) != ''
    GROUP BY campaign_id`;
  const spendSql = `SELECT campaign_id,
    (ARRAY_AGG(campaign_name ORDER BY updated_at DESC NULLS LAST) FILTER (WHERE campaign_name IS NOT NULL AND TRIM(campaign_name) != ''))[1] AS campaign_name,
    COALESCE(SUM(spend_gbp), 0) AS spend_gbp
    FROM google_ads_spend_hourly
    WHERE hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
    AND campaign_id IS NOT NULL AND TRIM(campaign_id) != ''
    GROUP BY campaign_id`;

  let revCur = []; let revPrev = []; let spendCur = []; let spendPrev = [];
  try {
    [revCur, revPrev, spendCur, spendPrev] = await Promise.all([
      adsDb.all(revSql, [startCur, endCur]),
      adsDb.all(revSql, [startPrev, endPrev]),
      adsDb.all(spendSql, [startCur, endCur]),
      adsDb.all(spendSql, [startPrev, endPrev]),
    ]);
  } catch (_) {
    return { current: [], previous: [], movers: [] };
  }

  function mergeCampaigns(revRows, spendRows) {
    const map = new Map();
    for (const r of revRows || []) {
      const id = r && r.campaign_id != null ? String(r.campaign_id).trim() : '';
      if (!id) continue;
      const name = r && r.campaign_name != null ? String(r.campaign_name).trim() : '';
      map.set(id, {
        campaign_id: id,
        campaign_name: name,
        revenueGbp: Number(r.revenue_gbp) || 0,
        orders: Math.floor(Number(r.orders) || 0),
        spendGbp: 0,
      });
    }
    for (const s of spendRows || []) {
      const id = s && s.campaign_id != null ? String(s.campaign_id).trim() : '';
      if (!id) continue;
      const name = s && s.campaign_name != null ? String(s.campaign_name).trim() : '';
      const existing = map.get(id);
      if (existing) {
        existing.spendGbp = Number(s.spend_gbp) || 0;
        if (!existing.campaign_name && name) existing.campaign_name = name;
      } else {
        map.set(id, {
          campaign_id: id,
          campaign_name: name,
          revenueGbp: 0,
          orders: 0,
          spendGbp: Number(s.spend_gbp) || 0,
        });
      }
    }
    return Array.from(map.values()).map((x) => ({
      campaign_id: x.campaign_id,
      campaign_name: x.campaign_name,
      revenueGbp: Math.round((x.revenueGbp || 0) * 100) / 100,
      orders: x.orders,
      spendGbp: Math.round((x.spendGbp || 0) * 100) / 100,
      roas: (x.spendGbp > 0 && x.revenueGbp != null) ? Math.round((x.revenueGbp / x.spendGbp) * 100) / 100 : null,
    }));
  }

  const current = mergeCampaigns(revCur, spendCur);
  const previous = mergeCampaigns(revPrev, spendPrev);
  const prevMap = new Map(previous.map((p) => [p.campaign_id, p]));

  const movers = [];
  for (const c of current) {
    const p = prevMap.get(c.campaign_id);
    const prevRev = p ? p.revenueGbp : 0;
    const prevSpend = p ? p.spendGbp : 0;
    const prevRoas = p && p.spendGbp > 0 ? p.revenueGbp / p.spendGbp : null;
    movers.push({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      revenueGbpCur: c.revenueGbp,
      revenueGbpPrev: prevRev,
      deltaRevenue: Math.round((c.revenueGbp - prevRev) * 100) / 100,
      spendGbpCur: c.spendGbp,
      spendGbpPrev: prevSpend,
      deltaSpend: Math.round((c.spendGbp - prevSpend) * 100) / 100,
      roasCur: c.roas,
      roasPrev: prevRoas,
      deltaRoas: c.roas != null && prevRoas != null ? Math.round((c.roas - prevRoas) * 100) / 100 : null,
    });
  }
  movers.sort((a, b) => (b.deltaRevenue || 0) - (a.deltaRevenue || 0));
  return { current, previous, movers: movers.slice(0, TOP_ADS) };
}

/**
 * Build summary context and drivers for the Kexo Score modal.
 * @param {{ rangeKey: string, force?: boolean }} options
 * @returns {Promise<{ ok: boolean, context?: object, drivers?: object }>}
 */
async function buildSummaryContext(options = {}) {
  const rangeKey = (options.rangeKey && String(options.rangeKey).trim()) || 'today';
  const force = !!options.force;

  let scoreResult;
  try {
    scoreResult = await store.getKexoScore({ rangeKey, force });
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : 'getKexoScore failed' };
  }

  if (!scoreResult || !scoreResult.range) {
    return { ok: false, error: 'missing score or range' };
  }

  const range = scoreResult.range;
  const compare = scoreResult.compare || null;
  const components = scoreResult.components || [];

  const [productMovers, attributionMovers, adsMovers] = await Promise.all([
    getProductMovers(range, compare || { start: 0, end: 0 }),
    getAttributionMovers(range, compare || { start: 0, end: 0 }),
    getAdsCampaignMovers(range, compare || { start: 0, end: 0 }),
  ]);

  const context = {
    rangeKey,
    range: { start: range.start, end: range.end },
    compare: compare ? { start: compare.start, end: compare.end } : null,
    components,
    productMovers,
    attributionMovers,
    adsMovers,
    adsIntegrated: !!scoreResult.adsIntegrated,
  };

  const drivers = {
    product: (productMovers.movers || []).slice(0, TOP_PRODUCT_DOWN + TOP_PRODUCT_UP),
    attribution: (attributionMovers.movers || []).slice(0, TOP_ATTRIBUTION),
    ads: (adsMovers.movers || []).slice(0, TOP_ADS),
  };

  return { ok: true, context, drivers };
}

module.exports = {
  buildSummaryContext,
  getProductMovers,
  getAttributionMovers,
  getAdsCampaignMovers,
};
