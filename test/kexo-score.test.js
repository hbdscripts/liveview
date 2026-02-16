const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('getKexoScore returns shape { score, band, components, rangeKey } and band is 20|40|60|80|100', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-score-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'kexo_score.test.sqlite');
  delete process.env.DB_URL;
  delete process.env.ADS_DB_URL;

  const { getDb } = require('../server/db');
  const { up: up001 } = require('../server/migrations/001_initial');
  const { up: up002 } = require('../server/migrations/002_shop_sessions');
  const { up: up004 } = require('../server/migrations/004_session_stats_fields');
  const { up: up007 } = require('../server/migrations/007_first_path');
  const { up: up009 } = require('../server/migrations/009_cf_traffic');
  const { up: up011 } = require('../server/migrations/011_entry_url');
  const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');

  await up001();
  await up002();
  await up004();
  await up007();
  await up009();
  await up011();
  await up017();

  const store = require('../server/store');
  const result = await store.getKexoScore({ rangeKey: '7d' });

  assert.ok(result && typeof result === 'object', 'returns object');
  assert.ok(typeof result.score === 'number' && Number.isFinite(result.score), 'score is number');
  assert.ok(result.score >= 0 && result.score <= 100, 'score in [0, 100]');
  const validBands = [20, 40, 60, 80, 100];
  assert.ok(validBands.includes(result.band), 'band is 20|40|60|80|100');
  assert.ok(Array.isArray(result.components), 'components is array');
  assert.equal(result.rangeKey, '7d', 'rangeKey preserved');
  assert.ok(typeof result.adsIntegrated === 'boolean', 'adsIntegrated is boolean');

  result.components.forEach((c, i) => {
    assert.ok(c && typeof c === 'object', `components[${i}] is object`);
    assert.ok(typeof c.key === 'string', `components[${i}].key`);
    assert.ok(typeof c.label === 'string', `components[${i}].label`);
    assert.ok(typeof c.score === 'number' && c.score >= 0 && c.score <= 100, `components[${i}].score 0-100`);
    assert.ok(c.weight === undefined || (typeof c.weight === 'number' && c.weight >= 0), `components[${i}].weight`);
  });

  // Today windows must be same-time aligned: compare2 should be day-before same-time
  // (strictly earlier than compare.start), not a rolling window ending at compare.start.
  const realNow = Date.now;
  try {
    Date.now = () => Date.UTC(2026, 1, 16, 13, 30, 0); // 2026-02-16 13:30:00 UTC
    const today = await store.getKexoScore({ rangeKey: 'today' });
    assert.ok(today && today.compare && today.compare2, 'today score includes compare and compare2 windows');
    const lenCompare = Number(today.compare.end) - Number(today.compare.start);
    const lenCompare2 = Number(today.compare2.end) - Number(today.compare2.start);
    assert.ok(lenCompare > 0 && lenCompare2 > 0, 'compare windows have positive duration');
    assert.ok(Math.abs(lenCompare - lenCompare2) < 1000, 'compare and compare2 durations are aligned');
    assert.ok(Number(today.compare2.end) < Number(today.compare.start), 'compare2 ends before compare starts (day-before same-time)');
  } finally {
    Date.now = realNow;
  }

  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
});

test('buildSummaryContext returns { ok, context, drivers } with expected shape', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-summary-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'kexo_summary.test.sqlite');
  delete process.env.DB_URL;
  delete process.env.ADS_DB_URL;

  const { getDb } = require('../server/db');
  const { up: up001 } = require('../server/migrations/001_initial');
  const { up: up002 } = require('../server/migrations/002_shop_sessions');
  const { up: up004 } = require('../server/migrations/004_session_stats_fields');
  const { up: up007 } = require('../server/migrations/007_first_path');
  const { up: up009 } = require('../server/migrations/009_cf_traffic');
  const { up: up011 } = require('../server/migrations/011_entry_url');
  const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');

  await up001();
  await up002();
  await up004();
  await up007();
  await up009();
  await up011();
  await up017();

  const kexoScoreSummary = require('../server/kexoScoreSummary');
  const result = await kexoScoreSummary.buildSummaryContext({ rangeKey: '7d' });

  assert.ok(result && typeof result === 'object', 'returns object');
  assert.equal(result.ok, true, 'ok is true');
  assert.ok(result.context && typeof result.context === 'object', 'context is object');
  assert.ok(Array.isArray(result.context.components), 'context.components is array');
  assert.ok(result.context.range && typeof result.context.range === 'object', 'context.range');
  assert.ok(result.drivers && typeof result.drivers === 'object', 'drivers is object');
  assert.ok(Array.isArray(result.drivers.product), 'drivers.product is array');
  assert.ok(Array.isArray(result.drivers.attribution), 'drivers.attribution is array');
  assert.ok(Array.isArray(result.drivers.ads), 'drivers.ads is array');

  try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
});

test('generateAiNarrative returns stable shape (deterministic when AI disabled)', async () => {
  const kexoScoreAiNarrative = require('../server/kexoScoreAiNarrative');
  const narrative = await kexoScoreAiNarrative.generateAiNarrative({
    context: { components: [{ key: 'revenue', label: 'Revenue', value: 1000, previous: 800 }], rangeKey: '7d' },
    drivers: { product: [], attribution: [], ads: [] },
  });
  assert.ok(narrative && typeof narrative === 'object', 'returns object');
  assert.ok(typeof narrative.summary === 'string', 'summary is string');
  assert.ok(Array.isArray(narrative.key_drivers), 'key_drivers is array');
  assert.ok(typeof narrative.recommendation === 'string', 'recommendation is string');
  assert.ok(narrative.links === undefined || Array.isArray(narrative.links), 'links optional array');
});
