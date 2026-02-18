const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeShippingCostFromSummary,
  computeCostBreakdownTotals,
} = require('../server/businessSnapshotService');

test('computeShippingCostFromSummary: override replaces default (not additive)', () => {
  const summary = {
    byCountry: new Map([
      ['GB', { orders: 14 }],
      ['US', { orders: 4 }],
    ]),
  };
  const shippingConfig = {
    enabled: true,
    worldwideDefaultGbp: 10,
    overrides: [
      { enabled: true, priceGbp: 2.8, countries: ['GB'] },
    ],
  };
  const total = computeShippingCostFromSummary(summary, shippingConfig);
  assert.equal(total, 79.2);
});

test('computeCostBreakdownTotals: excludes detail rows to prevent double counting', () => {
  const items = [
    { key: 'shipping', active: true, amount: 79.2 },
    { key: 'shipping_override_1', parent_key: 'shipping', is_detail: true, active: true, amount: 39.2 },
    { key: 'shipping_default', parent_key: 'shipping', is_detail: true, active: true, amount: 40.0 },
    { key: 'rules', active: true, amount: 10.0 },
    { key: 'rule_a', parent_key: 'rules', is_detail: true, active: true, amount: 10.0 },
  ];
  const totals = computeCostBreakdownTotals(items);
  assert.deepEqual(totals, { activeTotal: 89.2, inactiveTotal: 0 });
});

