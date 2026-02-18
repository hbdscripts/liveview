/**
 * Optional backfill: populate purchases.payment_method_key/label (and best-effort card brand)
 * for historical rows using the shared normaliser.
 *
 * Safe by default: run with --apply to write changes.
 *
 * Usage:
 * - Dry run: node scripts/backfill-purchases-payment-methods.js
 * - Apply:   node scripts/backfill-purchases-payment-methods.js --apply
 */
const { getDb } = require('../server/db');
const { normalizePaymentMethod } = require('../server/paymentMethods/normalizePaymentMethod');

function hasFlag(name) {
  const n = String(name || '').trim();
  if (!n) return false;
  return process.argv.slice(2).some((a) => String(a || '').trim().toLowerCase() === n.toLowerCase());
}

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }

function isCardBrandKey(k) {
  const key = s(k).trim().toLowerCase();
  return key === 'visa' || key === 'mastercard' || key === 'amex' || key === 'maestro' || key === 'discover' || key === 'jcb' || key === 'diners' || key === 'unionpay';
}

async function main() {
  const apply = hasFlag('--apply');
  const db = getDb();

  const rows = await db.all(
    `
    SELECT purchase_key, payment_gateway, payment_method_type, payment_method_name, payment_card_brand,
           payment_method_key, payment_method_label
    FROM purchases
    WHERE payment_method_key IS NULL OR payment_method_label IS NULL OR payment_method_key = ''
    LIMIT 50000
    `.trim()
  );

  let wouldUpdate = 0;
  let updated = 0;

  for (const r of rows || []) {
    const pk = s(r.purchase_key).trim();
    if (!pk) continue;
    const meta = normalizePaymentMethod({
      gateway: r.payment_gateway,
      methodType: r.payment_method_type,
      methodName: r.payment_method_name,
      cardBrand: r.payment_card_brand,
    });
    const key = meta && meta.key ? String(meta.key) : 'other';
    const label = meta && meta.label ? String(meta.label) : 'Other';
    const nextBrand = (!r.payment_card_brand && isCardBrandKey(key)) ? key : null;

    const nextKey = key || 'other';
    const nextLabel = label || 'Other';
    const needs =
      s(r.payment_method_key).trim() !== nextKey ||
      s(r.payment_method_label).trim() !== nextLabel ||
      (!!nextBrand && !s(r.payment_card_brand).trim());

    if (!needs) continue;
    wouldUpdate += 1;

    if (!apply) continue;
    await db.run(
      `
      UPDATE purchases
         SET payment_method_key = ?,
             payment_method_label = ?,
             payment_card_brand = COALESCE(payment_card_brand, ?)
       WHERE purchase_key = ?
      `.trim(),
      [nextKey, nextLabel, nextBrand, pk]
    );
    updated += 1;
  }

  if (!apply) {
    console.log('[backfill-purchases-payment-methods] dry-run: would update', wouldUpdate, 'rows (scanned', (rows || []).length, ')');
    console.log('[backfill-purchases-payment-methods] re-run with --apply to write changes');
    return;
  }
  console.log('[backfill-purchases-payment-methods] updated', updated, 'rows (scanned', (rows || []).length, ')');
}

main().catch((err) => {
  console.error('[backfill-purchases-payment-methods] failed', err && err.message ? err.message : err);
  process.exitCode = 1;
});

