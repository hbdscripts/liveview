/**
 * Focused tests: Google Ads postback idempotency/click-id/profit, issues API scoping, diagnostics parsing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const googleAdsPostback = require('../server/ads/googleAdsPostback');

test('pickClickIdFromAttribution: prefers gclid over gbraid over wbraid', () => {
  const { pickClickIdFromAttribution } = googleAdsPostback;
  assert.deepEqual(pickClickIdFromAttribution({ gclid: 'g1', gbraid: 'gb1', wbraid: 'wb1' }), { value: 'g1', type: 'gclid' });
  assert.deepEqual(pickClickIdFromAttribution({ gbraid: 'gb1', wbraid: 'wb1' }), { value: 'gb1', type: 'gbraid' });
  assert.deepEqual(pickClickIdFromAttribution({ wbraid: 'wb1' }), { value: 'wb1', type: 'wbraid' });
  assert.deepEqual(pickClickIdFromAttribution({}), { value: null, type: null });
  assert.deepEqual(pickClickIdFromAttribution({ gclid: '  g1  ' }), { value: 'g1', type: 'gclid' });
});

test('computeProfitForOrder: no config or disabled returns revenue', () => {
  const { computeProfitForOrder } = googleAdsPostback;
  assert.strictEqual(computeProfitForOrder(100, null), 100);
  assert.strictEqual(computeProfitForOrder(100, {}), 100);
  // costs-mode is currently a fail-open path (returns revenue).
  assert.strictEqual(computeProfitForOrder(100, { v: 1, mode: 'costs' }), 100);
  assert.strictEqual(computeProfitForOrder(100, { v: 1, mode: 'simple', simple: { percent_of_revenue: 0, fixed_per_order_gbp: 0 } }), 100);
});

test('computeProfitForOrder: simple mode percent + fixed deductions', () => {
  const { computeProfitForOrder } = googleAdsPostback;
  const config = {
    v: 1,
    mode: 'simple',
    simple: { percent_of_revenue: 10, fixed_per_order_gbp: 5 },
  };
  const profit = computeProfitForOrder(100, config);
  assert.strictEqual(profit, 85); // 100 - 10 - 5
});

test('computeProfitForOrder: simple mode supports fixed-only deductions', () => {
  const { computeProfitForOrder } = googleAdsPostback;
  const config = {
    v: 1,
    mode: 'simple',
    simple: { percent_of_revenue: 0, fixed_per_order_gbp: 3 },
  };
  assert.strictEqual(computeProfitForOrder(100, config), 97);
});

test('computeProfitForOrder: profit floored at zero', () => {
  const { computeProfitForOrder } = googleAdsPostback;
  const config = {
    v: 1,
    mode: 'simple',
    simple: { percent_of_revenue: 0, fixed_per_order_gbp: 150 },
  };
  assert.strictEqual(computeProfitForOrder(100, config), 0);
});

test('issues API GET /summary returns ok and counts', async () => {
  const issuesRouter = require('../server/routes/googleAdsIssues');
  const app = express();
  app.use(express.json());
  app.use('/issues', issuesRouter);
  const http = require('http');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: 'localhost', port, path: '/issues/summary', method: 'GET' },
        (r) => {
          let body = '';
          r.on('data', (c) => (body += c));
          r.on('end', () => resolve({ statusCode: r.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true);
    assert.ok(typeof data.open_count === 'number');
    assert.ok(typeof data.total_count === 'number');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
