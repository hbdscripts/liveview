const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSnapshotWindows } = require('../server/businessSnapshotService');

test('range this_month builds previous calendar month partial window', () => {
  const resolved = resolveSnapshotWindows(
    { mode: 'range', preset: 'this_month' },
    '2026-02-16'
  );
  assert.equal(resolved.mode, 'range');
  assert.equal(resolved.preset, 'this_month');
  assert.deepEqual(resolved.currentWindow, { startYmd: '2026-02-01', endYmd: '2026-02-16' });
  assert.deepEqual(resolved.previousWindow, { startYmd: '2026-01-01', endYmd: '2026-01-16' });
});

test('range last_month compares to previous full calendar month', () => {
  const resolved = resolveSnapshotWindows(
    { mode: 'range', preset: 'last_month' },
    '2026-02-16'
  );
  assert.equal(resolved.mode, 'range');
  assert.equal(resolved.preset, 'last_month');
  assert.deepEqual(resolved.currentWindow, { startYmd: '2026-01-01', endYmd: '2026-01-31' });
  assert.deepEqual(resolved.previousWindow, { startYmd: '2025-12-01', endYmd: '2025-12-31' });
});

test('range ytd compares against same span in prior year', () => {
  const resolved = resolveSnapshotWindows(
    { mode: 'range', preset: 'ytd' },
    '2026-07-09'
  );
  assert.equal(resolved.mode, 'range');
  assert.equal(resolved.preset, 'ytd');
  assert.deepEqual(resolved.currentWindow, { startYmd: '2026-01-01', endYmd: '2026-07-09' });
  assert.deepEqual(resolved.previousWindow, { startYmd: '2025-01-01', endYmd: '2025-07-09' });
});

test('range rolling custom compares against immediately preceding equal-length period', () => {
  const resolved = resolveSnapshotWindows(
    {
      mode: 'range',
      preset: 'custom',
      since: '2026-02-10',
      until: '2026-02-20',
    },
    '2026-02-28'
  );
  assert.equal(resolved.mode, 'range');
  assert.equal(resolved.preset, 'custom');
  assert.deepEqual(resolved.currentWindow, { startYmd: '2026-02-10', endYmd: '2026-02-20' });
  assert.deepEqual(resolved.previousWindow, { startYmd: '2026-01-30', endYmd: '2026-02-09' });
});

test('range uses provided since/until and preserves rolling compare semantics for last_30_days', () => {
  const resolved = resolveSnapshotWindows(
    {
      mode: 'range',
      preset: 'last_30_days',
      since: '2026-02-01',
      until: '2026-03-02',
    },
    '2026-03-10'
  );
  assert.equal(resolved.mode, 'range');
  assert.equal(resolved.preset, 'last_30_days');
  assert.deepEqual(resolved.currentWindow, { startYmd: '2026-02-01', endYmd: '2026-03-02' });
  assert.deepEqual(resolved.previousWindow, { startYmd: '2026-01-02', endYmd: '2026-01-31' });
});

test('monthly compatibility remains same-month-vs-previous-year logic', () => {
  const resolved = resolveSnapshotWindows(
    { mode: 'monthly', month: '2026-02' },
    '2026-02-16'
  );
  assert.equal(resolved.mode, 'monthly');
  assert.equal(resolved.selectedMonth, '2026-02');
  assert.deepEqual(resolved.currentWindow, { startYmd: '2026-02-01', endYmd: '2026-02-16' });
  assert.deepEqual(resolved.previousWindow, { startYmd: '2025-02-01', endYmd: '2025-02-16' });
});
