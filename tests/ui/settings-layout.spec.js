const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function readText(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

function firstCardInWrap(wrap) {
  if (!wrap) return null;
  try { return wrap.querySelector(':scope > .card') || wrap.querySelector('.card'); } catch (_) { return null; }
}

test('Settings/Admin panels satisfy UI contract after normalisation', () => {
  const html = readText('server/public/settings.html');
  const normaliserJs = readText('server/public/ui/settings-normaliser.js');

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable' });
  dom.window.eval(normaliserJs);

  const api = dom.window.KexoSettingsUiNormaliser;
  assert.ok(api && typeof api.normaliseAllSettingsPanels === 'function', 'normaliser must expose normaliseAllSettingsPanels');

  const doc = dom.window.document;

  // Capture header counts pre-normalisation to ensure we remove ONLY the first header.
  const panelsBefore = Array.from(doc.querySelectorAll(api.SETTINGS_PANEL_SELECTOR));
  const before = new Map();
  for (const p of panelsBefore) {
    const wrap = p; // pre-normalisation wrap may not exist
    const headers = p.querySelectorAll('.card > .card-header').length;
    const firstCard = p.querySelector('.card');
    const firstHasHeader = !!(firstCard && firstCard.querySelector(':scope > .card-header'));
    before.set(p, { headers, firstHasHeader });
  }

  api.normaliseAllSettingsPanels(doc.body);

  const panels = Array.from(doc.querySelectorAll(api.SETTINGS_PANEL_SELECTOR));
  assert.ok(panels.length > 0, 'expected at least one Settings/Admin sub-panel');

  for (const panel of panels) {
    const wrap = panel.querySelector(':scope > .settings-panel-wrap');
    assert.ok(wrap, `${panel.id || '<no id>'}: missing direct .settings-panel-wrap`);

    // No grids inside panel content after normalisation.
    assert.equal(wrap.querySelectorAll('.row').length, 0, `${panel.id}: .row found inside settings-panel-wrap`);
    assert.equal(wrap.querySelectorAll('.d-grid').length, 0, `${panel.id}: .d-grid found inside settings-panel-wrap`);
    for (const el of Array.from(wrap.querySelectorAll('*'))) {
      const classes = Array.from(el.classList || []);
      const hasCol = classes.some((c) => /^col-/.test(c));
      assert.equal(hasCol, false, `${panel.id}: col-* class found after normalisation (${classes.join(' ')})`);
    }

    // First card header is removed; later headers remain.
    const fc = firstCardInWrap(wrap);
    if (fc) {
      const fcHeader = fc.querySelector(':scope > .card-header');
      assert.equal(!!fcHeader, false, `${panel.id}: first card header was not removed`);
    }

    const beforeInfo = before.get(panel);
    if (beforeInfo && beforeInfo.headers > 0) {
      const afterHeaders = panel.querySelectorAll('.card > .card-header').length;
      const expected = beforeInfo.firstHasHeader ? Math.max(0, beforeInfo.headers - 1) : beforeInfo.headers;
      assert.equal(afterHeaders, expected, `${panel.id}: expected ${expected} card headers after normalisation, got ${afterHeaders}`);
    }
  }

  // Read-only env-backed fields must look read-only (visual + non-editable).
  const ro = Array.from(doc.querySelectorAll('.kexo-readonly-field'));
  assert.ok(ro.length > 0, 'expected at least one .kexo-readonly-field in settings.html');
  for (const f of ro) {
    assert.ok(f.classList.contains('form-control-plaintext'), 'readonly field should be form-control-plaintext');
  }

  // Spot-check: Shopify panel keeps Truth Sync/Pixel headers after stripping Shopify Auth.
  const shopifyPanel = doc.getElementById('settings-integrations-panel-shopify');
  if (shopifyPanel) {
    assert.ok(shopifyPanel.querySelectorAll('.card > .card-header').length >= 2, 'Shopify panel should keep later card headers (Truth Sync/Pixel)');
  }

  // Spot-check: Google Ads panel keeps Diagnostics header after stripping Connection.
  const gaPanel = doc.getElementById('settings-integrations-panel-googleads');
  if (gaPanel) {
    assert.ok(gaPanel.querySelectorAll('#settings-ga-diagnostics-card > .card-header').length === 1, 'Google Ads Diagnostics card header must remain');
  }

  // Primary actions should be btn-primary.
  const saveButtons = Array.from(doc.querySelectorAll('button')).filter((b) => String(b.textContent || '').trim() === 'Save');
  assert.ok(saveButtons.length > 0, 'expected at least one Save button');
  for (const b of saveButtons) assert.ok(b.classList.contains('btn-primary'), 'Save button should be .btn-primary');
});

