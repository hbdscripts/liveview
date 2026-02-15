const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const iconRegistry = require('../server/shared/icon-registry');
const settingsRoute = require('../server/routes/settings');

test('icon registry: required active keys are present', () => {
  const defaults = iconRegistry.ICON_GLYPH_DEFAULTS || {};
  const missing = (iconRegistry.REQUIRED_ACTIVE_ICON_KEYS || []).filter((key) => !Object.prototype.hasOwnProperty.call(defaults, key));
  assert.deepEqual(missing, [], 'missing required active icon keys in canonical registry');
});

test('theme whitelist: icon glyph keys are generated from canonical registry', () => {
  const expected = iconRegistry.getThemeIconGlyphSettingKeys().slice().sort();
  const actual = (settingsRoute.THEME_KEYS || [])
    .filter((key) => String(key).startsWith('theme_icon_glyph_'))
    .slice()
    .sort();
  assert.deepEqual(actual, expected, 'backend theme icon whitelist drifted from canonical icon registry');
});

test('legacy keys are marked and do not overlap with required active keys', () => {
  const legacyMap = iconRegistry.LEGACY_THEME_ICON_KEYS || {};
  const required = new Set(iconRegistry.REQUIRED_ACTIVE_ICON_KEYS || []);
  const overlaps = Object.keys(legacyMap).filter((key) => !!legacyMap[key] && required.has(key));
  assert.deepEqual(overlaps, [], 'required active keys must never be marked as legacy');
});

test('frontend icon scripts consume shared registry payload', () => {
  const themeSettingsJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'public', 'theme-settings.js'), 'utf8');
  const fontawesomeIconsJs = fs.readFileSync(path.join(__dirname, '..', 'server', 'public', 'fontawesome-icons.js'), 'utf8');
  assert.match(themeSettingsJs, /window\.KexoIconRegistry/, 'theme-settings.js must read from window.KexoIconRegistry');
  assert.match(fontawesomeIconsJs, /window\.KexoIconRegistry/, 'fontawesome-icons.js must read from window.KexoIconRegistry');
  assert.doesNotMatch(themeSettingsJs, /var\s+ICON_GLYPH_DEFAULTS\s*=\s*\{/, 'theme-settings.js should not define a local icon glyph defaults object literal');
  assert.doesNotMatch(fontawesomeIconsJs, /var\s+ICON_GLYPH_DEFAULTS\s*=\s*\{/, 'fontawesome-icons.js should not define a local icon glyph defaults object literal');
});
