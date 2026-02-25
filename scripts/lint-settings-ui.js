'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function readText(rel) {
  const p = path.join(__dirname, '..', rel);
  return fs.readFileSync(p, 'utf8');
}

function listFilesRecursive(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

function fail(msg) {
  console.error(`[lint-settings-ui] ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.log(`[lint-settings-ui] ${msg}`);
}

function main() {
  const settingsHtml = readText('server/public/settings.html');
  const settingsPageJs = readText('server/public/settings-page.js');

  // 1) Contract assets must be included on /settings.
  if (!settingsHtml.includes('href="/settings-ui.css"')) fail('settings.html must include `/settings-ui.css`.');
  if (!settingsHtml.includes('src="/ui/settings-normaliser.js"')) fail('settings.html must include `/ui/settings-normaliser.js` before settings-page.js.');
  if (!settingsHtml.includes('src="/ui/settings-ui.js"')) fail('settings.html should include `/ui/settings-ui.js` (builder helpers).');

  // 2) No inline styles in Settings template.
  if (/\sstyle="/i.test(settingsHtml)) fail('Inline `style="..."` found in settings.html (forbidden).');
  if (/<style[\s>]/i.test(settingsHtml)) fail('<style> tag found in settings.html (forbidden).');

  // 2b) Settings nav must use canonical path URLs, not query-style.
  if (settingsHtml.includes('href="/settings?tab=')) fail('settings.html must not contain query-style Settings links (href="/settings?tab=..."); use canonical paths e.g. /settings/kexo/icons.');

  // 3) settings-page.js must rely on the shared normaliser module (no drift back into the monolith).
  if (settingsPageJs.includes('data-settings-ui-first-header-stripped')) fail('settings-page.js contains normaliser internals; use `server/public/ui/settings-normaliser.js`.');
  if (settingsPageJs.includes('SETTINGS_PANEL_SELECTOR')) fail('settings-page.js contains normaliser internals; use `server/public/ui/settings-normaliser.js`.');
  if (!settingsPageJs.includes('window.KexoSettingsUiNormaliser')) fail('settings-page.js must call into `window.KexoSettingsUiNormaliser`.');

  // 4) Files must exist.
  const normaliserPath = path.join(__dirname, '..', 'server/public/ui/settings-normaliser.js');
  const builderPath = path.join(__dirname, '..', 'server/public/ui/settings-ui.js');
  const cssPath = path.join(__dirname, '..', 'server/public/settings-ui.css');
  if (!fs.existsSync(normaliserPath)) fail('Missing `server/public/ui/settings-normaliser.js`.');
  if (!fs.existsSync(builderPath)) fail('Missing `server/public/ui/settings-ui.js`.');
  if (!fs.existsSync(cssPath)) fail('Missing `server/public/settings-ui.css`.');

  // 5) Top-level Settings panels must be siblings under #settings-main-content.
  // If a panel isn't closed in the HTML, subsequent panels become nested and appear blank when tabs switch.
  try {
    const dom = new JSDOM(settingsHtml);
    const doc = dom.window.document;
    const main = doc.getElementById('settings-main-content');
    if (!main) fail('settings.html must contain `#settings-main-content`.');
    const allPanels = Array.from(doc.querySelectorAll('.settings-panel'));
    const directPanels = Array.from(doc.querySelectorAll('#settings-main-content > .settings-panel'));
    if (allPanels.length !== directPanels.length) {
      const offenders = allPanels
        .filter((p) => p && p.parentElement !== main)
        .map((p) => {
          const id = p && p.id ? p.id : '(no id)';
          const parent = p && p.parentElement ? (p.parentElement.id ? `#${p.parentElement.id}` : p.parentElement.tagName) : '(no parent)';
          return `${id} parent=${parent}`;
        })
        .slice(0, 20);
      fail(`Settings panels must be direct children of #settings-main-content. Nested panels found: ${offenders.join(', ')}`);
    }

    // 6) Contract: no <h2> anywhere inside Settings/Admin accordions.
    const h2InAccordions = doc.querySelectorAll('.settings-panel .accordion h2');
    if (h2InAccordions.length) {
      fail(`Forbidden <h2> found inside Settings/Admin accordions in settings.html (found ${h2InAccordions.length}). Use <h4 class="accordion-header"> for accordion headers.`);
    }
  } catch (e) {
    fail(`Failed to parse settings.html for panel structure: ${e && e.message ? e.message : String(e)}`);
  }

  // 7) Contract: generated accordion headers must not use <h2>.
  // This catches string-built accordion markup in client/app/** before it ships.
  try {
    const appDir = path.join(__dirname, '..', 'client', 'app');
    const files = listFilesRecursive(appDir).filter((p) => p.endsWith('.js'));
    const re = /<h2\b[^>]*\baccordion-header\b/i;
    for (const p of files) {
      const txt = fs.readFileSync(p, 'utf8');
      if (re.test(txt)) {
        fail(`Forbidden <h2> used as an accordion header in ${path.relative(path.join(__dirname, '..'), p)} (use <h4 class="accordion-header">).`);
      }
    }
  } catch (e) {
    fail(`Failed to scan client/app/** for forbidden accordion <h2>: ${e && e.message ? e.message : String(e)}`);
  }

  if (!process.exitCode) ok('OK');
}

main();

