/**
 * Build server/public/app.js from client/app/*.js sources.
 * Reads client/app/manifest.txt for ordered list of source files, concatenates,
 * wraps in IIFE, minifies with Terser, adds checksum header. Run: npm run build:app
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const root = path.resolve(__dirname, '..');
const clientAppDir = path.join(root, 'client', 'app');
const manifestPath = path.join(clientAppDir, 'manifest.txt');
const outPath = path.join(root, 'server', 'public', 'app.js');

const IIFE_OPEN = '(function () {\n';
const IIFE_CLOSE = '\n})();\n';

async function main() {
  if (!fs.existsSync(clientAppDir)) {
    console.error('[build-app-js] client/app/ not found. Create it and add manifest.txt with source file names.');
    process.exit(1);
  }
  if (!fs.existsSync(manifestPath)) {
    console.error('[build-app-js] client/app/manifest.txt not found.');
    process.exit(1);
  }

  const manifest = fs
    .readFileSync(manifestPath, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  let body = '';
  for (const file of manifest) {
    if (file.includes('..') || path.isAbsolute(file)) {
      console.error('[build-app-js] invalid manifest entry:', file);
      process.exit(1);
    }
    const full = path.join(clientAppDir, file);
    if (!fs.existsSync(full)) {
      console.error('[build-app-js] missing source:', full);
      process.exit(1);
    }
    body += fs.readFileSync(full, 'utf8');
    if (!body.endsWith('\n')) body += '\n';
  }

  const checksum = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
  const header = '// @generated from client/app - do not edit. Run: npm run build:app\n// checksum: ' + checksum + '\n\n';
  const wrapped = header + IIFE_OPEN + body + IIFE_CLOSE;

  const result = await minify(wrapped, {
    compress: true,
    mangle: false,
    format: { comments: true },
  });
  if (result.error) {
    console.error('[build-app-js] minify error:', result.error);
    process.exit(1);
  }
  const final = (result.code || wrapped).trimEnd() + '\n';

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, final, 'utf8');
  console.log('[build-app-js] wrote', outPath, 'checksum', checksum);
}

main().catch((err) => {
  console.error('[build-app-js]', err);
  process.exit(1);
});
