const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const versionRoute = require('../server/routes/version');

function requestJson(port, method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: 'localhost', port, method, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json = null;
        try {
          json = body ? JSON.parse(body) : null;
        } catch (_) {}
        resolve({ statusCode: res.statusCode, json, raw: body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/version includes git_sha and build_env', async () => {
  const app = express();
  const handler = versionRoute.makeHandler({
    pkg: { version: '9.9.9-test' },
    assetVersion: 'asset-123',
    config: { nodeEnv: 'production', sentryDsn: '', gitSha: '' },
  });
  app.get('/api/version', handler);

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  try {
    const res = await requestJson(port, 'GET', '/api/version');
    assert.equal(res.statusCode, 200);
    assert.ok(res.json && typeof res.json === 'object', 'expected JSON payload');
    assert.equal(res.json.ok, true);
    assert.equal(res.json.version, '9.9.9-test');
    assert.ok(Object.prototype.hasOwnProperty.call(res.json, 'git_sha'));
    assert.equal(typeof res.json.git_sha, 'string');
    assert.ok(res.json.git_sha.length > 0);
    assert.ok(res.json.build_env === 'production' || res.json.build_env === 'development');
  } finally {
    server.close();
  }
});

