/**
 * One-time cleanup: remove h: purchase rows when the same session has a token: or order: row
 * with the same order_total and order_currency in the same 15-min bucket (so we don't double-count).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run(`
      DELETE FROM purchases a
      WHERE a.purchase_key LIKE 'h:%'
        AND EXISTS (
          SELECT 1 FROM purchases b
          WHERE (b.purchase_key LIKE 'token:%' OR b.purchase_key LIKE 'order:%')
            AND b.session_id = a.session_id
            AND (b.order_total IS NOT DISTINCT FROM a.order_total)
            AND (b.order_currency IS NOT DISTINCT FROM a.order_currency)
            AND FLOOR(b.purchased_at/900000.0) = FLOOR(a.purchased_at/900000.0)
        )
    `);
  } else {
    await db.run(`
      DELETE FROM purchases
      WHERE purchase_key LIKE 'h:%'
        AND EXISTS (
          SELECT 1 FROM purchases p2
          WHERE (p2.purchase_key LIKE 'token:%' OR p2.purchase_key LIKE 'order:%')
            AND p2.session_id = purchases.session_id
            AND (p2.order_total IS purchases.order_total OR (p2.order_total IS NULL AND purchases.order_total IS NULL))
            AND (p2.order_currency IS purchases.order_currency OR (p2.order_currency IS NULL AND purchases.order_currency IS NULL))
            AND CAST(p2.purchased_at/900000 AS INTEGER) = CAST(purchases.purchased_at/900000 AS INTEGER)
        )
    `);
  }
}

module.exports = { up };
