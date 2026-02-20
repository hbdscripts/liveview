function s(v) {
  try { return v == null ? '' : String(v); } catch (_) { return ''; }
}

const LABEL_BY_KEY = Object.freeze({
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  maestro: 'Maestro',
  jcb: 'JCB',
  diners: 'Diners Club',
  unionpay: 'UnionPay',
  paypal: 'PayPal',
  klarna: 'Klarna',
  clearpay: 'Clearpay',
  afterpay: 'Afterpay',
  affirm: 'Affirm',
  zip: 'Zip',
  sezzle: 'Sezzle',
  stripe: 'Stripe',
  shop_pay: 'Shop Pay',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  ideal: 'iDEAL',
  sofort: 'Sofort',
  bancontact: 'Bancontact',
  eps: 'EPS',
  p24: 'Przelewy24',
  giropay: 'Giropay',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  cod: 'Cash On Delivery',
  other: 'Other',
});

const ORDERED_KEYS = Object.freeze([
  'visa',
  'mastercard',
  'amex',
  'discover',
  'maestro',
  'jcb',
  'diners',
  'unionpay',
  'paypal',
  'klarna',
  'clearpay',
  'afterpay',
  'affirm',
  'zip',
  'sezzle',
  'stripe',
  'shop_pay',
  'apple_pay',
  'google_pay',
  'ideal',
  'sofort',
  'bancontact',
  'eps',
  'p24',
  'giropay',
  'bank_transfer',
  'cash',
  'cod',
  'other',
]);

function titleizeKey(key) {
  const raw = s(key).trim().replace(/[_-]+/g, ' ');
  if (!raw) return 'Other';
  return raw.replace(/\b\w/g, (m) => m.toUpperCase());
}

function canonicalPaymentKey(raw) {
  const v = s(raw).trim().toLowerCase();
  if (!v) return 'other';
  const compact = v.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!compact) return 'other';
  if (compact === 'american_express' || compact === 'americanexpress') return 'amex';
  if (compact === 'diners_club' || compact === 'dinersclub') return 'diners';
  if (compact === 'shop_pay' || compact === 'shopify_pay' || compact === 'shoppay') return 'shop_pay';
  if (compact === 'apple_pay' || compact === 'applepay') return 'apple_pay';
  if (compact === 'google_pay' || compact === 'googlepay' || compact === 'gpay') return 'google_pay';
  if (compact === 'banktransfer' || compact === 'wire_transfer' || compact === 'wire') return 'bank_transfer';
  if (compact === 'cash_on_delivery') return 'cod';
  if (compact === 'przelewy24') return 'p24';
  return compact;
}

function paymentLabelForKey(key) {
  const k = canonicalPaymentKey(key);
  return LABEL_BY_KEY[k] || titleizeKey(k);
}

function commonPaymentMethods() {
  return ORDERED_KEYS.map((k) => ({ key: k, label: paymentLabelForKey(k) }));
}

module.exports = {
  canonicalPaymentKey,
  paymentLabelForKey,
  commonPaymentMethods,
  ORDERED_KEYS,
  LABEL_BY_KEY,
};

