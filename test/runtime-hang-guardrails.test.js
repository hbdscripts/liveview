/**
 * Guardrails for production "spinner/hang" regressions.
 *
 * These tests intentionally check source-level invariants that previously caused
 * whole-site request stalls under load.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'server', 'db.js');
const storePath = path.join(root, 'server', 'store.js');
const salesTruthPath = path.join(root, 'server', 'salesTruth.js');

function readSource(filePath) {
  assert.ok(fs.existsSync(filePath), `missing source file: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function extractFunctionSource(source, fnName) {
  const asyncMarker = `async function ${fnName}(`;
  const syncMarker = `function ${fnName}(`;
  let start = source.indexOf(asyncMarker);
  if (start < 0) start = source.indexOf(syncMarker);
  assert.ok(start >= 0, `function not found: ${fnName}`);
  // Avoid matching `{}` defaults inside parameter lists; seek the body opener after `)`.
  const sigClose = source.indexOf(')', start);
  assert.ok(sigClose >= 0, `function signature not found: ${fnName}`);
  const braceStart = source.indexOf('{', sigClose);
  assert.ok(braceStart >= 0, `function body not found: ${fnName}`);

  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  assert.ok(depth === 0, `unterminated function body: ${fnName}`);
  return source.slice(start, i);
}

test('Postgres transactions are request-scoped (no global tx client leakage)', () => {
  const src = readSource(dbPath);
  assert.match(src, /AsyncLocalStorage/, 'db.js must use AsyncLocalStorage for tx scoping');
  assert.doesNotMatch(src, /_pgTxClient/, 'global _pgTxClient must not be used');
  assert.match(src, /_pgTxStorage\.run\(client,\s*async\s*\(\)\s*=>\s*fn\(\)\)/, 'transaction must run inside async-local context');
});

test('getKpis does not block on sales truth reconciliation', () => {
  const src = readSource(storePath);
  const getKpisSrc = extractFunctionSource(src, 'getKpis');
  assert.doesNotMatch(
    getKpisSrc,
    /await\s+salesTruth\.ensureReconciled\s*\(/,
    'getKpis must not await salesTruth.ensureReconciled'
  );
  assert.match(
    getKpisSrc,
    /salesTruth\.ensureReconciled\([\s\S]*?\)\.catch\(/,
    'getKpis should keep truth warm in background with .catch()'
  );
});

test('reconcileRange keeps pre-reconcile backup non-blocking', () => {
  const src = readSource(salesTruthPath);
  const reconcileRangeSrc = extractFunctionSource(src, 'reconcileRange');
  assert.doesNotMatch(
    reconcileRangeSrc,
    /await\s+backup\.backup\s*\(/,
    'reconcileRange must not await backup.backup in request-adjacent path'
  );
  assert.match(
    reconcileRangeSrc,
    /_preReconcileBackupInFlight\s*=\s*Promise\.resolve\(\)/,
    'reconcileRange should schedule backup asynchronously with in-flight guard'
  );
});
