const test = require('node:test');
const assert = require('node:assert/strict');

function clearModule(relPath) {
  try {
    delete require.cache[require.resolve(relPath)];
  } catch (_) {}
}

function makeJsonRes() {
  let statusCode = 200;
  let body = null;
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return res;
    },
    json(payload) {
      body = payload;
      return res;
    },
  };
  return {
    res,
    getStatus: () => statusCode,
    getJson: () => body,
  };
}

test('theme defaults include theme_inline_edits_v1 key', () => {
  clearModule('../server/routes/settings');
  const settingsRoute = require('../server/routes/settings');
  assert.ok(Array.isArray(settingsRoute.THEME_KEYS), 'THEME_KEYS exported');
  assert.ok(
    settingsRoute.THEME_KEYS.includes('theme_inline_edits_v1'),
    'theme inline edits key is persisted by theme defaults route'
  );
});

test('postThemeDefaults persists inline edits draft payload', async () => {
  clearModule('../server/store');
  clearModule('../server/routes/settings');

  const store = require('../server/store');
  const originalSetSettingsBulk = store.setSettingsBulk;

  let capturedEntries = null;
  store.setSettingsBulk = async function (entries) {
    capturedEntries = Array.isArray(entries) ? entries.slice() : entries;
  };

  const settingsRoute = require('../server/routes/settings');
  const out = makeJsonRes();
  const draftRaw = [
    '{',
    '  "v": 1,',
    '  "scope": "settings",',
    '  "ops": [',
    '    { "op": "setClass", "selector": "#settings-ga-signin-btn", "to": "btn btn-primary btn-md" }',
    '  ]',
    '}',
  ].join('\n');

  try {
    await settingsRoute.postThemeDefaults(
      {
        body: {
          theme_inline_edits_v1: draftRaw,
        },
      },
      out.res
    );
  } finally {
    store.setSettingsBulk = originalSetSettingsBulk;
    clearModule('../server/routes/settings');
    clearModule('../server/store');
  }

  assert.equal(out.getStatus(), 200);
  assert.equal(out.getJson() && out.getJson().ok, true);
  assert.ok(Array.isArray(capturedEntries), 'settings write batch captured');
  assert.ok(
    capturedEntries.some(function (row) {
      return Array.isArray(row) && row[0] === 'theme_theme_inline_edits_v1' && String(row[1] || '').includes('"scope": "settings"');
    }),
    'theme inline edits draft saved with theme_ prefix'
  );
});
