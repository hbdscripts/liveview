/* eslint-disable no-console */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readText(rel) {
  const p = path.join(__dirname, '..', rel);
  return fs.readFileSync(p, 'utf8');
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

  if (!process.exitCode) ok('OK');
}

main();

