/**
 * One-time split of client/app/00-bootstrap.js into chunked source files.
 * Run from repo root: node scripts/split-app-sources.js
 * Updates client/app/manifest.txt and creates 01-core.js through 15-user-footer-product.js.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const clientApp = path.join(root, 'client', 'app');
const bootstrapPath = path.join(clientApp, '00-bootstrap.js');

// Ranges [start, end) 0-based line indices; end exclusive
const CHUNKS = [
  ['01-core.js', 0, 310],
  ['02-tables-progress.js', 310, 966],
  ['03-grid-drag-table.js', 966, 1347],
  ['04-rows-sticky.js', 1347, 3454],
  ['05-fraud-sales-toast.js', 3454, 4601],
  ['06-products-dropdowns.js', 4601, 4999],
  ['07-type-pagination-watcher.js', 4999, 9280],
  ['08-condensed-kpis.js', 9280, 12112],
  ['09-session-top-rows.js', 12112, 13521],
  ['10-diagnostics-kpi-modal.js', 13521, 13583],
  ['11-traffic-tree-topbar.js', 13583, 13881],
  ['12-main-tabs-mobile.js', 13881, 14662],
  ['13-live-sales.js', 14662, 14878],
  ['14-dashboard.js', 14878, 16130],
  ['15-user-footer-product.js', 16130, 17141],
];

const lines = fs.readFileSync(bootstrapPath, 'utf8').split('\n');

for (const [name, start, end] of CHUNKS) {
  const slice = lines.slice(start, end);
  fs.writeFileSync(path.join(clientApp, name), slice.join('\n') + (slice.length ? '\n' : ''), 'utf8');
  console.log('[split]', name, 'lines', start, '-', end);
}

const manifest = CHUNKS.map(([name]) => name).join('\n') + '\n';
fs.writeFileSync(path.join(clientApp, 'manifest.txt'), manifest, 'utf8');
console.log('[split] manifest.txt updated with', CHUNKS.length, 'files');
