/**
 * Attribution mutation endpoints require admin (requireMaster); unauthenticated or non-admin get 403.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const requireMaster = require('../server/middleware/requireMaster');
const attributionRouter = require('../server/routes/attribution');

test('POST /api/attribution/prefs without admin returns 403', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/attribution/prefs', requireMaster.middleware, attributionRouter.postAttributionPrefs);

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ enabledOwnerKinds: ['house'] });
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: '/api/attribution/prefs',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      resolve
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  server.close();
  assert.equal(res.statusCode, 403, 'expected 403 for POST /api/attribution/prefs without admin');
});

test('POST /api/attribution/config without admin returns 403', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/attribution/config', requireMaster.middleware, attributionRouter.postAttributionConfig);

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({});
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: '/api/attribution/config',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      resolve
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  server.close();
  assert.equal(res.statusCode, 403, 'expected 403 for POST /api/attribution/config without admin');
});

test('POST /api/attribution/map without admin returns 403', async () => {
  const app = express();
  app.use(express.json());
  app.post('/api/attribution/map', requireMaster.middleware, attributionRouter.postAttributionMap);

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  const res = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ tokenType: 'gclid', variantKey: 'test' });
    const req = http.request(
      {
        host: 'localhost',
        port,
        path: '/api/attribution/map',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      resolve
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  server.close();
  assert.equal(res.statusCode, 403, 'expected 403 for POST /api/attribution/map without admin');
});
