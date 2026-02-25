'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeTier,
  isTierAllowed,
  formatConversionDateTime,
  parseClickIdsFromEntryUrl,
} = require('../server/ads/googleAdsPostback');

test('normalizeTier handles canonical + alias values', () => {
  assert.equal(normalizeTier('A', 'B'), 'A');
  assert.equal(normalizeTier('b', 'A'), 'B');
  assert.equal(normalizeTier('tier c', 'B'), 'C');
  assert.equal(normalizeTier('TIER_A', 'B'), 'A');
  assert.equal(normalizeTier('', 'B'), 'B');
  assert.equal(normalizeTier(null, 'B'), 'B');
});

test('isTierAllowed enforces confidence gating', () => {
  assert.equal(isTierAllowed('A', 'B', false), true);
  assert.equal(isTierAllowed('B', 'B', false), true);
  assert.equal(isTierAllowed('C', 'B', false), false);
  assert.equal(isTierAllowed('C', 'C', true), true);
  assert.equal(isTierAllowed('B', 'A', false), false);
});

test('formatConversionDateTime returns account-TZ local time with offset', () => {
  const ts = Date.parse('2026-01-15T00:00:00.000Z');
  const utc = formatConversionDateTime(ts, 'UTC');
  const ny = formatConversionDateTime(ts, 'America/New_York');

  assert.equal(utc, '2026-01-15 00:00:00+00:00');
  assert.equal(ny, '2026-01-14 19:00:00-05:00');
});

test('parseClickIdsFromEntryUrl extracts gclid/gbraid/wbraid', () => {
  const out = parseClickIdsFromEntryUrl('https://example.com/?gclid=TEST_GCLID&gbraid=TEST_GBRAID&wbraid=TEST_WBRAID');
  assert.deepEqual(out, { value: 'TEST_GCLID', type: 'gclid' });
});

