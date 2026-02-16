/**
 * Tests for server/attribution/deriveAttribution.js.
 *
 * Covers: gclid-only, UTM-only, referrer-only, affiliate+gclid, allowlisted/non-allowlisted
 * kexo_attr, internal referrer/direct, and edge cases (conflicting signals, malformed params,
 * multiple click IDs).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

async function withTempDb(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-derive-attr-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const prev = process.env.SQLITE_DB_PATH;
  process.env.SQLITE_DB_PATH = dbPath;
  try {
    const { getDb } = require('../server/db');
    const { up: up001 } = require('../server/migrations/001_initial');
    const { up: up009 } = require('../server/migrations/009_cf_traffic');
    const { up: up017 } = require('../server/migrations/017_sales_truth_and_evidence');
    const { up: up050 } = require('../server/migrations/050_acquisition_attribution');
    await up001();
    await up009();
    await up017();
    await up050();
    return await fn(getDb());
  } finally {
    process.env.SQLITE_DB_PATH = prev;
    try { fs.rmSync(tmpDir, { recursive: true }); } catch (_) {}
  }
}

test('deriveAttribution: gclid-only → google_ads / paid_search', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: 'https://example.com/?gclid=abc123',
      referrer: '',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.equal(out.source, 'google');
    assert.equal(out.channel, 'paid_search');
    assert.ok(out.variant === 'google_ads:house' || out.variant?.includes('google'));
    assert.ok(out.confidence === 'heuristic' || out.confidence === 'rules');
  });
});

test('deriveAttribution: UTM-only (source/medium) → heuristic channel/source', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: '',
      referrer: '',
      utm_source: 'newsletter',
      utm_medium: 'email',
      utm_campaign: 'summer',
    });
    assert.ok(out);
    assert.equal(out.channel, 'email');
    assert.ok(out.source);
    assert.ok(out.confidence === 'heuristic' || out.confidence === 'rules');
  });
});

test('deriveAttribution: referrer-only (external host) → other', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: '',
      referrer: 'https://twitter.com/someone',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.equal(out.source, 'other');
    assert.ok(out.confidence === 'heuristic' || out.confidence === 'direct');
  });
});

test('deriveAttribution: no signals → direct', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: '',
      referrer: '',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.equal(out.variant, 'direct:house');
    assert.equal(out.confidence, 'direct');
    assert.equal(out.source, 'direct');
  });
});

test('deriveAttribution: allowlisted kexo_attr wins', async () => {
  await withTempDb(async (db) => {
    const now = Date.now();
    await db.run(
      `INSERT OR REPLACE INTO attribution_allowlist (variant_key, enabled, updated_at) VALUES (?, 1, ?)`,
      ['my_campaign:affiliate', now]
    );
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: 'https://example.com/?kexo_attr=my_campaign%3Aaffiliate',
      referrer: '',
      utm_source: 'google',
      utm_medium: 'cpc',
    });
    assert.ok(out);
    assert.equal(out.confidence, 'explicit_param');
    assert.ok(out.variant === 'my_campaign:affiliate' || out.variant?.includes('my_campaign'));
  });
});

test('deriveAttribution: non-allowlisted kexo_attr ignored', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: 'https://example.com/?kexo_attr=random_variant',
      referrer: '',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.notEqual(out.confidence, 'explicit_param');
    assert.equal(out.variant, 'direct:house');
    assert.equal(out.confidence, 'direct');
  });
});

test('deriveAttribution: internal referrer (no UTM) → referral/other or direct', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: '',
      referrer: 'https://checkout.shopify.com/',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.ok(out.variant);
    assert.ok(out.confidence === 'heuristic' || out.confidence === 'direct');
    assert.ok(out.source === 'other' || out.source === 'direct');
  });
});

test('deriveAttribution: edge case – malformed entry_url', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: 'not-a-url-???',
      referrer: '',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.equal(out.variant, 'direct:house');
    assert.equal(out.confidence, 'direct');
  });
});

test('deriveAttribution: edge case – multiple click IDs (gclid wins over msclkid in URL)', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({
      entry_url: 'https://example.com/?gclid=g1&msclkid=m1',
      referrer: '',
      utm_source: '',
      utm_medium: '',
    });
    assert.ok(out);
    assert.equal(out.source, 'google');
    assert.equal(out.channel, 'paid_search');
  });
});

test('deriveAttribution: edge case – empty string vs missing inputs', async () => {
  await withTempDb(async () => {
    const { deriveAttribution, invalidateAttributionConfigCache } = require('../server/attribution/deriveAttribution');
    invalidateAttributionConfigCache();
    const out = await deriveAttribution({});
    assert.ok(out);
    assert.equal(out.variant, 'direct:house');
    assert.equal(out.confidence, 'direct');
  });
});
