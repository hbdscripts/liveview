const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function clearModule(relPath) {
  try {
    delete require.cache[require.resolve(relPath)];
  } catch (_) {}
}

function makeJsonRes() {
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return res;
    },
    json(payload) {
      jsonBody = payload;
      return res;
    },
  };
  return {
    res,
    getStatus: () => statusCode,
    getJson: () => jsonBody,
  };
}

test('auth callback rejects stale oauth timestamp before hmac work', async () => {
  const prevKey = process.env.SHOPIFY_API_KEY;
  const prevSecret = process.env.SHOPIFY_API_SECRET;

  process.env.SHOPIFY_API_KEY = 'test_key';
  process.env.SHOPIFY_API_SECRET = 'test_secret';

  clearModule('../server/config');
  clearModule('../server/routes/auth');

  const { handleCallback } = require('../server/routes/auth');

  let statusCode = 200;
  let body = '';
  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    send(payload) {
      body = String(payload || '');
      return res;
    },
  };

  await handleCallback(
    {
      query: {
        code: 'code',
        shop: 'example.myshopify.com',
        hmac: 'not-used-for-stale-ts',
        timestamp: '1',
      },
    },
    res
  );

  assert.equal(statusCode, 400);
  assert.match(body, /Expired or invalid OAuth timestamp/i);

  if (prevKey == null) delete process.env.SHOPIFY_API_KEY;
  else process.env.SHOPIFY_API_KEY = prevKey;
  if (prevSecret == null) delete process.env.SHOPIFY_API_SECRET;
  else process.env.SHOPIFY_API_SECRET = prevSecret;

  clearModule('../server/routes/auth');
  clearModule('../server/config');
});

test('attribution config save does not wipe tables unless clearAll is explicit', async () => {
  const prevDbPath = process.env.SQLITE_DB_PATH;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kexo-attr-config-test-'));
  process.env.SQLITE_DB_PATH = path.join(tmpDir, 'live_visitors.attr.config.test.sqlite');

  clearModule('../server/db');
  clearModule('../server/routes/attribution');
  clearModule('../server/store');
  clearModule('../server/reportCache');
  clearModule('../server/attribution/deriveAttribution');

  const { getDb } = require('../server/db');
  const { up: up001 } = require('../server/migrations/001_initial');
  const { up: up050 } = require('../server/migrations/050_acquisition_attribution');
  const { up: up058 } = require('../server/migrations/058_attribution_tags');

  let db = null;
  try {
    await up001();
    await up050();
    await up058();

    db = getDb();
    const now = Date.now();
    await db.run(
      'INSERT OR REPLACE INTO attribution_channels (channel_key, label, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?)',
      ['paid_search', 'Paid Search', 10, 1, now]
    );
    const baseline = await db.get('SELECT COUNT(1) AS n FROM attribution_channels');
    const baselineCount = Number(baseline && baseline.n) || 0;

    const { postAttributionConfig } = require('../server/routes/attribution');

    // Empty arrays without clearAll should NOT wipe existing rows.
    {
      const out = makeJsonRes();
      await postAttributionConfig(
        {
          body: {
            config: { channels: [], sources: [], variants: [], tags: [], rules: [], allowlist: [] },
          },
        },
        out.res
      );
      assert.equal(out.getStatus(), 200);
      assert.equal(out.getJson() && out.getJson().ok, true);
      const keep = await db.get('SELECT COUNT(1) AS n FROM attribution_channels');
      assert.equal(Number(keep && keep.n), baselineCount);
    }

    // Explicit clearAll should wipe the table when arrays are empty.
    {
      const out = makeJsonRes();
      await postAttributionConfig(
        {
          body: {
            config: { clearAll: true, channels: [], sources: [], variants: [], tags: [], rules: [], allowlist: [] },
          },
        },
        out.res
      );
      assert.equal(out.getStatus(), 200);
      assert.equal(out.getJson() && out.getJson().ok, true);
      const cleared = await db.get('SELECT COUNT(1) AS n FROM attribution_channels');
      assert.equal(Number(cleared && cleared.n), 0);
    }
  } finally {
    try { if (db && typeof db.close === 'function') await db.close(); } catch (_) {}
    if (prevDbPath == null) delete process.env.SQLITE_DB_PATH;
    else process.env.SQLITE_DB_PATH = prevDbPath;

    clearModule('../server/routes/attribution');
    clearModule('../server/db');
    clearModule('../server/store');
    clearModule('../server/reportCache');
    clearModule('../server/attribution/deriveAttribution');

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('notifications patch rejects no-op payloads with no_actionable_fields', async () => {
  clearModule('../server/authz');
  clearModule('../server/routes/notifications');
  clearModule('../server/notificationsService');

  const authz = require('../server/authz');
  const notificationsService = require('../server/notificationsService');
  const origGetRequestEmail = authz.getRequestEmail;
  const origMarkRead = notificationsService.markRead;
  const origMarkArchived = notificationsService.markArchived;

  let sideEffectCalls = 0;
  authz.getRequestEmail = () => 'admin@example.com';
  notificationsService.markRead = async () => { sideEffectCalls += 1; };
  notificationsService.markArchived = async () => { sideEffectCalls += 1; };

  clearModule('../server/routes/notifications');
  const notificationsRoute = require('../server/routes/notifications');

  const out = makeJsonRes();
  await notificationsRoute.patchOne(
    {
      params: { id: 'notif-1' },
      body: {},
    },
    out.res
  );

  assert.equal(out.getStatus(), 400);
  assert.equal(out.getJson() && out.getJson().error, 'no_actionable_fields');
  assert.equal(sideEffectCalls, 0);

  authz.getRequestEmail = origGetRequestEmail;
  notificationsService.markRead = origMarkRead;
  notificationsService.markArchived = origMarkArchived;

  clearModule('../server/routes/notifications');
});
