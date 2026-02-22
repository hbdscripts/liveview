/**
 * Ensure docs/ROUTES.md is in sync with server/index.js.
 * Run: npm test (includes this file).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'scripts', 'generate-routes-doc.js');

test('docs/ROUTES.md is up to date with server/index.js', () => {
  try {
    execSync(`node "${script}" --check`, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    assert.fail('docs/ROUTES.md is out of date. Run: npm run docs:routes');
  }
});
