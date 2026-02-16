/**
 * Ensures server/public/app.js is in sync with client/app sources (checksum match).
 * Fails if sources were edited but `npm run build:app` was not run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const clientAppDir = path.join(root, 'client', 'app');
const manifestPath = path.join(clientAppDir, 'manifest.txt');
const appJsPath = path.join(root, 'server', 'public', 'app.js');

test('app.js checksum matches client/app sources (run npm run build:app if failed)', () => {
  if (!fs.existsSync(clientAppDir) || !fs.existsSync(manifestPath)) {
    assert.fail('client/app/ or manifest.txt missing; cannot verify checksum');
  }
  const manifest = fs
    .readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  let body = '';
  for (const file of manifest) {
    const full = path.join(clientAppDir, file);
    assert.ok(fs.existsSync(full), 'missing source: ' + file);
    body += fs.readFileSync(full, 'utf8');
    if (!body.endsWith('\n')) body += '\n';
  }
  const expectedChecksum = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);

  assert.ok(fs.existsSync(appJsPath), 'server/public/app.js missing');
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');
  const match = appJsContent.match(/\/\/\s*checksum:\s*([a-f0-9]+)/i);
  assert.ok(match, 'app.js has no checksum comment (run npm run build:app)');
  const actualChecksum = (match[1] || '').trim().toLowerCase();
  assert.equal(
    actualChecksum,
    expectedChecksum.toLowerCase(),
    'app.js checksum does not match client/app sources — run npm run build:app'
  );
});
