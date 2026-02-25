/**
 * Lint client/app sources which are concatenated fragments (not standalone-valid JS).
 * We build an in-memory bundle using client/app/manifest.txt ordering (same as build:app),
 * wrap it in an IIFE, then run ESLint on the resulting code.
 */
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const root = path.resolve(__dirname, '..');
const clientAppDir = path.join(root, 'client', 'app');
const manifestPath = path.join(clientAppDir, 'manifest.txt');

const IIFE_OPEN = '(function () {\n';
const IIFE_CLOSE = '\n})();\n';

function readManifest() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error('[lint-client-app] client/app/manifest.txt not found');
  }
  return fs
    .readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildBundleFromManifest(manifest) {
  let body = '';
  for (const file of manifest) {
    if (file.includes('..') || path.isAbsolute(file)) {
      throw new Error('[lint-client-app] invalid manifest entry: ' + file);
    }
    const full = path.join(clientAppDir, file);
    if (!fs.existsSync(full)) {
      throw new Error('[lint-client-app] missing source: ' + full);
    }
    let src = fs.readFileSync(full, 'utf8');
    src = src.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    body += src;
    if (!body.endsWith('\n')) body += '\n';
  }
  return IIFE_OPEN + body + IIFE_CLOSE;
}

async function main() {
  if (!fs.existsSync(clientAppDir)) {
    throw new Error('[lint-client-app] client/app/ not found');
  }

  const manifest = readManifest();
  const bundle = buildBundleFromManifest(manifest);

  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintText(bundle, {
    filePath: path.join(clientAppDir, '__lint_bundle__.js'),
  });

  const formatter = await eslint.loadFormatter('stylish');
  const out = formatter.format(results);
  if (out && out.trim()) process.stdout.write(out + '\n');

  const errorCount = results.reduce((sum, r) => sum + (r.errorCount || 0), 0);
  process.exitCode = errorCount > 0 ? 1 : 0;
}

main().catch((err) => {
  // Keep output single and actionable for CI.
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});

