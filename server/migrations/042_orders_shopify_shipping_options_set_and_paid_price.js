/**
 * Shipping CR: store both "set/listed" and "paid" shipping prices (presentment currency).
 *
 * Why:
 * - `shipping_price` is useful but can be ambiguous when shipping discounts apply.
 * - Shopify exposes both the listed rate and the discounted/paid value on shipping_lines.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE orders_shopify_shipping_options ADD COLUMN IF NOT EXISTS shipping_price_set DOUBLE PRECISION');
    await db.run('ALTER TABLE orders_shopify_shipping_options ADD COLUMN IF NOT EXISTS shipping_price_paid DOUBLE PRECISION');
    return;
  }

  try {
    await db.run('ALTER TABLE orders_shopify_shipping_options ADD COLUMN shipping_price_set REAL');
  } catch (e) {
    if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
  }

  try {
    await db.run('ALTER TABLE orders_shopify_shipping_options ADD COLUMN shipping_price_paid REAL');
  } catch (e) {
    if (!/duplicate column name/i.test(String(e && e.message ? e.message : e))) throw e;
  }
}

module.exports = { up };

