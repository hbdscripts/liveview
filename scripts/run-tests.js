'use strict';

/**
 * Run node --test with discovered test files. Used so npm test works on both
 * Windows and Linux/CI where shell glob expansion differs (CI passes globs
 * literally and Node does not expand them).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

function findFiles(dir, suffix) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  const out = [];
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(suffix)) out.push(full);
    }
  }
  walk(dir);
  return out;
}

const testFiles = findFiles(path.join(root, 'test'), '.test.js');
const specFiles = findFiles(path.join(root, 'tests'), '.spec.js');
const files = [...testFiles, ...specFiles];

if (files.length === 0) {
  console.error('run-tests: no test files found under test/ or tests/');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
});
process.exit(result.status === null ? 1 : result.status);
