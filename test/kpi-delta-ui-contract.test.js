const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const kpiUiPath = path.join(root, 'client', 'app', '07-type-pagination-watcher.js');
const dashboardPath = path.join(root, 'client', 'app', '14-dashboard.js');
const appJsPath = path.join(root, 'server', 'public', 'app.js');

test('KPI delta UI contract: baseline-zero and negative baseline handling', () => {
  const src = fs.readFileSync(kpiUiPath, 'utf8');

  // kpiDelta must use abs(baseline) (not baseline itself) so negative baselines are valid.
  assert.ok(
    src.includes('const denom = Math.abs(base);'),
    'kpiDelta should use abs(baseline) as denominator'
  );
  assert.ok(
    /if\s*\(\s*denom\s*<\s*1e-9\s*\)\s*return\s*diff\s*>\s*0\s*\?\s*1\s*:\s*-1\s*;/.test(src),
    'kpiDelta should saturate to ±1 when |baseline|≈0'
  );
  assert.ok(
    !src.includes('if (base <= 0) return diff > 0 ? 1 : -1;'),
    'kpiDelta must not force ±100% for all baselines <= 0'
  );

  // UI must not force "+100%" for baseline=0 cases (sign must be derived from delta).
  assert.ok(
    !src.includes("isNew ? '+100%'"),
    'UI delta text must not use isNew ? +100% override'
  );
});

test('KPI delta UI contract: component delta text uses sign when prev≈0', () => {
  const src = fs.readFileSync(dashboardPath, 'utf8');
  assert.ok(
    src.includes("cur > 0 ? '+100%' : '-100%'"),
    'fmtComponentDeltaText should be sign-aware when prev≈0'
  );
  assert.ok(
    !src.includes("return (Math.abs(cur) < 1e-9) ? '0.0%' : '+100%'"),
    'fmtComponentDeltaText must not always return +100% when prev≈0'
  );
});

test('KPI delta UI contract: bundle does not contain isNew +100% override', () => {
  if (!fs.existsSync(appJsPath)) return;
  const bundle = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(
    !/isNew\?\s*["']\+100%["']/.test(bundle),
    'bundle must not include isNew ? +100% override'
  );
});

