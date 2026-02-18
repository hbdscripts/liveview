/**
 * Purchases: persist canonical payment method classification.
 *
 * Fields:
 * - payment_card_brand: raw-ish card brand token (e.g. visa/mastercard/amex) when available.
 * - payment_method_key: canonical key (e.g. visa, paypal, apple_pay, other).
 * - payment_method_label: canonical human label (e.g. Visa, PayPal, Apple Pay, Other).
 *
 * Privacy note: these fields must never contain PAN fragments or raw payment identifiers.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const cols = [
    'payment_card_brand',
    'payment_method_key',
    'payment_method_label',
  ];

  if (isPostgres()) {
    for (const col of cols) {
      await db.run(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS ${col} TEXT`);
    }
    await db.run(
      'CREATE INDEX IF NOT EXISTS idx_purchases_payment_method_key ON purchases(payment_method_key) WHERE payment_method_key IS NOT NULL'
    ).catch(() => null);
  } else {
    for (const col of cols) {
      try {
        await db.run(`ALTER TABLE purchases ADD COLUMN ${col} TEXT`);
      } catch (e) {
        if (!/duplicate column name/i.test(e.message)) throw e;
      }
    }
    await db.run('CREATE INDEX IF NOT EXISTS idx_purchases_payment_method_key ON purchases(payment_method_key)').catch(() => null);
  }
}

module.exports = { up };

