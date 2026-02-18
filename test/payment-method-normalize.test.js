const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizePaymentMethod } = require('../server/paymentMethods/normalizePaymentMethod');

test('normalizePaymentMethod: never returns unknown/shopify_payments', () => {
  const cases = [
    { gateway: null, methodType: null, methodName: null, cardBrand: null },
    { gateway: 'unknown', methodType: '', methodName: '', cardBrand: '' },
    { gateway: 'shopify_payments', methodType: 'card', methodName: 'credit card', cardBrand: null },
    { gateway: 'shopify_payments', methodType: null, methodName: 'Shopify Payments', cardBrand: null },
  ];
  for (const input of cases) {
    const out = normalizePaymentMethod(input);
    assert.ok(out && typeof out === 'object');
    assert.ok(out.key);
    assert.notEqual(out.key, 'unknown');
    assert.notEqual(out.key, 'shopify_payments');
    assert.notEqual(out.label.toLowerCase(), 'unknown');
    assert.notEqual(out.label.toLowerCase(), 'shopify_payments');
  }
});

test('normalizePaymentMethod: Shopify Payments card brand resolves to brand', () => {
  const visa = normalizePaymentMethod({ gateway: 'shopify_payments', methodType: 'card', methodName: 'card', cardBrand: 'visa' });
  assert.equal(visa.key, 'visa');
  assert.equal(visa.label, 'Visa');
});

test('normalizePaymentMethod: wallet methods resolve correctly', () => {
  const apple = normalizePaymentMethod({ gateway: 'shopify_payments', methodType: 'apple_pay', methodName: 'Apple Pay', cardBrand: null });
  assert.equal(apple.key, 'apple_pay');
  assert.equal(apple.label, 'Apple Pay');

  const google = normalizePaymentMethod({ gateway: 'shopify_payments', methodType: 'google-pay', methodName: 'Google Pay', cardBrand: null });
  assert.equal(google.key, 'google_pay');
  assert.equal(google.label, 'Google Pay');

  const shopPay = normalizePaymentMethod({ gateway: 'shopify_payments', methodType: 'shop_pay', methodName: 'Shop Pay', cardBrand: null });
  assert.equal(shopPay.key, 'shop_pay');
  assert.equal(shopPay.label, 'Shop Pay');
});

test('normalizePaymentMethod: PayPal/Klarna/Clearpay resolve correctly', () => {
  const pp = normalizePaymentMethod({ gateway: 'paypal', methodType: null, methodName: 'PayPal', cardBrand: null });
  assert.equal(pp.key, 'paypal');
  assert.equal(pp.label, 'PayPal');

  const kl = normalizePaymentMethod({ gateway: 'klarna', methodType: null, methodName: 'Klarna', cardBrand: null });
  assert.equal(kl.key, 'klarna');
  assert.equal(kl.label, 'Klarna');

  const cp = normalizePaymentMethod({ gateway: 'afterpay', methodType: null, methodName: 'Afterpay', cardBrand: null });
  assert.equal(cp.key, 'clearpay');
  assert.equal(cp.label, 'Clearpay');
});

