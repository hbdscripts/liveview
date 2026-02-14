const test = require('node:test');
const assert = require('node:assert/strict');

const { percentOrNull, roundTo } = require('../server/metrics');

test('roundTo rounds to requested decimals', () => {
  assert.equal(roundTo(1.234, 2), 1.23);
  assert.equal(roundTo(1.235, 2), 1.24);
  assert.equal(roundTo('2.5', 0), 3);
  assert.equal(roundTo(null, 2), null);
});

test('percentOrNull returns null when denominator is invalid/<=0', () => {
  assert.equal(percentOrNull(1, 0), null);
  assert.equal(percentOrNull(1, -1), null);
  assert.equal(percentOrNull(1, null), null);
  assert.equal(percentOrNull(1, 'nope'), null);
});

test('percentOrNull computes and rounds percentages', () => {
  assert.equal(percentOrNull(5, 10), 50);
  assert.equal(percentOrNull(1, 3), 33.3);
  assert.equal(percentOrNull('5', '10'), 50);
});

test('percentOrNull supports optional clamping', () => {
  assert.equal(percentOrNull(2, 1, { clampMax: 100 }), 100);
  assert.equal(percentOrNull(2, 1, { clampMin: 250 }), 250);
});

