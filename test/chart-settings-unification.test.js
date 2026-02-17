/**
 * Regression checks for chart-settings unification: mode whitelist alignment,
 * legacy mode normalization, and config shape.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const settingsPath = path.join(root, 'server', 'routes', 'settings.js');
const defsPath = path.join(root, 'server', 'public', 'kexo-chart-defs.js');

const CHART_UI_KEYS = [
  'dash-chart-overview-30d',
  'dash-chart-finishes-30d',
  'dash-chart-countries-30d',
  'dash-chart-attribution-30d',
  'live-online-chart',
  'sales-overview-chart',
  'date-overview-chart',
  'ads-overview-chart',
  'attribution-chart',
  'devices-chart',
  'products-chart',
  'abandoned-carts-chart',
  'countries-map-chart',
];

const CANONICAL_MODES = new Set([
  'area', 'bar', 'line', 'multi-line-labels', 'combo', 'stacked-area', 'stacked-bar',
  'radialbar', 'pie', 'donut', 'bar-horizontal', 'bar-distributed',
  'map-animated', 'map-flat',
]);

test('settings.js: CHART_ALLOWED_MODES has an entry for every CHART_UI_KEYS chart', () => {
  const src = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(src.includes('CHART_ALLOWED_MODES'), 'CHART_ALLOWED_MODES must exist');
  for (const key of CHART_UI_KEYS) {
    const quoted = "'" + key + "':";
    assert.ok(src.includes(quoted), `CHART_ALLOWED_MODES must include key: ${key}`);
  }
});

test('settings.js: CHART_MODE_LEGACY_ALIASES exists and maps to canonical modes', () => {
  const src = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(src.includes('CHART_MODE_LEGACY_ALIASES'), 'CHART_MODE_LEGACY_ALIASES must exist');
  assert.ok(src.includes("'bar-horizontal'"), 'legacy alias bar (horizontal) -> bar-horizontal');
  assert.ok(src.includes("'radialbar'"), 'legacy alias radial bar -> radialbar');
  assert.ok(src.includes("'multi-line-labels'"), 'legacy alias multi-line -> multi-line-labels');
});

test('settings.js: normalizeChartModeForKey uses allowed list and legacy aliases', () => {
  const src = fs.readFileSync(settingsPath, 'utf8');
  assert.ok(src.includes('normalizeChartModeForKey'), 'normalizeChartModeForKey must exist');
  assert.ok(src.includes('CHART_MODE_LEGACY_ALIASES[raw]'), 'raw value is normalized via legacy aliases');
  assert.ok(src.includes('allowed.includes(raw)'), 'allowed list is checked');
});

test('kexo-chart-defs.js: KEXO_CHART_DEFS has same chart keys as CHART_UI_KEYS', () => {
  const src = fs.readFileSync(defsPath, 'utf8');
  assert.ok(src.includes('KEXO_CHART_DEFS'), 'KEXO_CHART_DEFS must exist');
  for (const key of CHART_UI_KEYS) {
    const quoted = "'" + key + "':";
    assert.ok(src.includes(quoted), `KEXO_CHART_DEFS must include key: ${key}`);
  }
});

test('kexo-chart-defs.js: CHART_MODE_LABEL has canonical mode labels', () => {
  const src = fs.readFileSync(defsPath, 'utf8');
  assert.ok(src.includes('Vertical Bar'), 'bar label should include Vertical Bar');
  assert.ok(src.includes('bar-horizontal') && src.includes('Horizontal Bar'), 'bar-horizontal label should include Horizontal Bar');
  assert.ok(src.includes('radialbar') && src.includes('Radial Bar'), 'radialbar label should include Radial Bar');
  assert.ok(src.includes('multi-line-labels') && src.includes('Multi Line'), 'multi-line-labels label should include Multi Line');
});
