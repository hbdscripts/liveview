/**
 * Regression: RBAC middleware must never throw when dashboardAuth.requiresAuth is missing/undefined.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMiddleware } = require('../server/middleware/rbacMiddleware');

test('middleware does not throw when requiresAuth is missing', async () => {
  const middleware = createMiddleware({});
  const req = { path: '/api/settings', method: 'GET', get: () => '' };
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  const res = { status: () => res, json: () => {}, redirect: () => {} };
  await middleware(req, res, next);
  assert.ok(nextCalled, 'next() must be called when requiresAuth is missing');
});
