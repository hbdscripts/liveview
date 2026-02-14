const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeRangeKey } = require('../server/rangeKey');

test('normalizeRangeKey: maps friendly UI keys + accepts custom keys', () => {
  assert.equal(normalizeRangeKey('7days'), '7d');
  assert.equal(normalizeRangeKey('14days'), '14d');
  assert.equal(normalizeRangeKey('30days'), '30d');

  assert.equal(normalizeRangeKey('today'), 'today');
  assert.equal(normalizeRangeKey('MONTH'), 'month');

  assert.equal(normalizeRangeKey('d:2026-02-14'), 'd:2026-02-14');
  assert.equal(normalizeRangeKey('r:2026-02-01:2026-02-14'), 'r:2026-02-01:2026-02-14');
});

test('normalizeRangeKey: respects allowed set', () => {
  assert.equal(normalizeRangeKey('30days', { allowed: new Set(['today', 'yesterday', '7d']), defaultKey: 'today' }), 'today');
  assert.equal(normalizeRangeKey('7days', { allowed: ['7d'], defaultKey: 'today' }), '7d');
});

