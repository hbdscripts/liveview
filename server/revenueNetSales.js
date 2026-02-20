/**
 * Helpers for Net sales (line_net − refunds) and returns/refunds attribution.
 * Used by product/variant reports and dashboard.
 */
const config = require('./config');
const fx = require('./fx');

function parseReturnsRefundsAttribution(rawKpiConfig) {
  if (!rawKpiConfig || typeof rawKpiConfig !== 'string') return 'processing_date';
  try {
    const obj = JSON.parse(rawKpiConfig);
    const v = obj && obj.options && obj.options.general && obj.options.general.returnsRefundsAttribution;
    if (v === 'original_sale_date' || v === 'processing_date') return v;
  } catch (_) {}
  return 'processing_date';
}

/**
 * Return refund totals by product_id in GBP for the given range.
 * attribution: 'processing_date' → refund_created_at, 'original_sale_date' → order_processed_at
 */
async function getRefundTotalsByProductIdGbp(db, shop, startMs, endMs, attribution) {
  const useSaleDate = attribution === 'original_sale_date';
  const tsCol = useSaleDate ? 'order_processed_at' : 'refund_created_at';
  const map = new Map(); // product_id -> gbp
  if (!shop || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return map;
  try {
    const sql = config.dbUrl
      ? `SELECT product_id, currency, SUM(subtotal) AS total FROM orders_shopify_refund_line_items
         WHERE shop = $1 AND ${tsCol} IS NOT NULL AND ${tsCol} >= $2 AND ${tsCol} < $3 AND product_id IS NOT NULL AND TRIM(product_id) != ''
         GROUP BY product_id, currency`
      : `SELECT product_id, currency, SUM(subtotal) AS total FROM orders_shopify_refund_line_items
         WHERE shop = ? AND ${tsCol} IS NOT NULL AND ${tsCol} >= ? AND ${tsCol} < ? AND product_id IS NOT NULL AND TRIM(product_id) != ''
         GROUP BY product_id, currency`;
    const rows = await db.all(sql, [shop, startMs, endMs]);
    const ratesToGbp = await fx.getRatesToGbp();
    for (const r of rows || []) {
      const pid = r && r.product_id != null ? String(r.product_id).trim() : '';
      if (!pid) continue;
      const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
      const amt = Number(r && r.total != null ? r.total : 0) || 0;
      const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
      const gbpNum = Number.isFinite(gbp) ? gbp : 0;
      map.set(pid, (map.get(pid) || 0) + gbpNum);
    }
  } catch (_) {}
  return map;
}

/**
 * Return refund totals by variant_id in GBP for the given range.
 */
async function getRefundTotalsByVariantIdGbp(db, shop, startMs, endMs, attribution) {
  const useSaleDate = attribution === 'original_sale_date';
  const tsCol = useSaleDate ? 'order_processed_at' : 'refund_created_at';
  const map = new Map();
  if (!shop || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return map;
  try {
    const sql = config.dbUrl
      ? `SELECT variant_id, currency, SUM(subtotal) AS total FROM orders_shopify_refund_line_items
         WHERE shop = $1 AND ${tsCol} IS NOT NULL AND ${tsCol} >= $2 AND ${tsCol} < $3 AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
         GROUP BY variant_id, currency`
      : `SELECT variant_id, currency, SUM(subtotal) AS total FROM orders_shopify_refund_line_items
         WHERE shop = ? AND ${tsCol} IS NOT NULL AND ${tsCol} >= ? AND ${tsCol} < ? AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
         GROUP BY variant_id, currency`;
    const rows = await db.all(sql, [shop, startMs, endMs]);
    const ratesToGbp = await fx.getRatesToGbp();
    for (const r of rows || []) {
      const vid = r && r.variant_id != null ? String(r.variant_id).trim() : '';
      if (!vid) continue;
      const cur = fx.normalizeCurrency(r && r.currency != null ? String(r.currency) : '') || 'GBP';
      const amt = Number(r && r.total != null ? r.total : 0) || 0;
      const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
      const gbpNum = Number.isFinite(gbp) ? gbp : 0;
      map.set(vid, (map.get(vid) || 0) + gbpNum);
    }
  } catch (_) {}
  return map;
}

module.exports = {
  parseReturnsRefundsAttribution,
  getRefundTotalsByProductIdGbp,
  getRefundTotalsByVariantIdGbp,
};
