/**
 * Chart-settings endpoints must be protected by dashboardAuth (same as /api/settings).
 * Regression: /api/chart-settings was added and must be included in dashboardAuth protected paths.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const dashboardAuth = require('../server/middleware/dashboardAuth');
const config = require('../server/config');

function request(port, method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = bodyObj == null ? null : JSON.stringify(bodyObj);
    const req = http.request(
      {
        host: 'localhost',
        port,
        path,
        method,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : {},
      },
      resolve
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('GET /api/chart-settings/:chartKey without auth returns 401', async () => {
  const prevEnv = config.nodeEnv;
  config.nodeEnv = 'production';
  const app = express();
  app.use(express.json());
  app.use(dashboardAuth.middleware);
  app.get('/api/chart-settings/:chartKey', (req, res) => res.status(200).json({ ok: true }));

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  const res = await request(port, 'GET', '/api/chart-settings/dash-chart-overview-30d');
  server.close();
  config.nodeEnv = prevEnv;
  assert.equal(res.statusCode, 401);
});

test('PUT /api/chart-settings/:chartKey without auth returns 401', async () => {
  const prevEnv = config.nodeEnv;
  config.nodeEnv = 'production';
  const app = express();
  app.use(express.json());
  app.use(dashboardAuth.middleware);
  app.put('/api/chart-settings/:chartKey', (req, res) => res.status(200).json({ ok: true }));

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, () => resolve(s));
    s.on('error', reject);
  });
  const port = server.address().port;

  const res = await request(port, 'PUT', '/api/chart-settings/dash-chart-overview-30d', { settings: { key: 'dash-chart-overview-30d' } });
  server.close();
  config.nodeEnv = prevEnv;
  assert.equal(res.statusCode, 401);
});

