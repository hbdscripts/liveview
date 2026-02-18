/**
 * Purchases: persist payment method metadata from pixel checkout_completed.
 *
 * Privacy note: these fields must never contain PAN fragments or raw payment identifiers.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = [
    'payment_gateway',
    'payment_method_name',
    'payment_method_type',
  ];

  if (isPostgres()) {
    for (const col of cols) {
      await db.run(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_purchases_payment_gateway ON purchases(payment_gateway) WHERE payment_gateway IS NOT NULL'
    ).catch(() => null);
  } else {
    for (const col of cols) {
      try {
        await db.run(`ALTER TABLE purchases ADD COLUMN ${col} TEXT`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_purchases_payment_gateway ON purchases(payment_gateway)').catch(() => null);
  }
}

module.exports = { up };

