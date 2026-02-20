/**
 * Audit: find data-icon-key values in client/app and server/public
 * and report which are not in the canonical icon registry (ICON_GLYPH_DEFAULTS).
 * Keys that are dynamic (e.g. payment-method-*, overview-widget-*) are allowed
 * and not reported as missing.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const iconRegistry = require(path.join(repoRoot, 'server', 'shared', 'icon-registry'));
const registryKeys = new Set(Object.keys(iconRegistry.ICON_GLYPH_DEFAULTS || {}));

// Dynamic key patterns that are covered by Icons page (asset_overrides / allowlist)
const DYNAMIC_PATTERNS = [
  /^payment-method-[a-z0-9_-]+$/i,
  /^overview-widget-[a-z0-9_-]+$/i,
  /^type-device-[a-z0-9_-]+$/i,
  /^type-platform-[a-z0-9_-]+$/i,
  /^type-browser-[a-z0-9_-]+$/i,
];

function isDynamicKey(key) {
  const k = String(key).trim();
  if (!k || k.endsWith('-') || /[\s+]/.test(k)) return true; // concatenated or partial
  return DYNAMIC_PATTERNS.some((re) => re.test(k));
}

function extractIconKeys(content) {
  const keys = new Set();
  const re = /data-icon-key\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    keys.add(m[1].trim());
  }
  const re2 = /data-icon-key="\s*'\s*\+\s*escapeHtml\([^)]+\)\s*\+/g;
  // Dynamic keys like escapeHtml(iconKey) are not extracted literally; skip.
  return keys;
}

function walkDir(dir, ext, out) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walkDir(full, ext, out);
      else if (e.isFile() && (ext === null || full.endsWith(ext))) out.push(full);
    }
  } catch (_) {}
}

const clientApp = path.join(repoRoot, 'client', 'app');
const serverPublic = path.join(repoRoot, 'server', 'public');
const files = [];
walkDir(clientApp, '.js', files);
walkDir(serverPublic, '.js', files);

const foundKeys = new Set();
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  extractIconKeys(content).forEach((k) => foundKeys.add(k));
}

const missing = [];
const dynamic = [];
for (const k of foundKeys) {
  if (isDynamicKey(k)) {
    dynamic.push(k);
    continue;
  }
  if (!registryKeys.has(k)) missing.push(k);
}

missing.sort();
if (missing.length > 0) {
  console.log('Icon keys used in UI but not in ICON_GLYPH_DEFAULTS:');
  missing.forEach((k) => console.log('  ', k));
  process.exitCode = 1;
} else {
  console.log('All non-dynamic icon keys used in UI are in the registry.');
}
if (dynamic.length > 0) {
  console.log('Dynamic keys (covered by Icons page allowlist):', dynamic.length);
}
