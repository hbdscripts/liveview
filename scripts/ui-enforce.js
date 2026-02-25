/**
 * UI enforcement: fail if inline styles or <style> tags exist in HTML under server/public or client/app.
 * Run: npm run ui:check
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const serverPublic = path.join(root, 'server', 'public');
const clientApp = path.join(root, 'client', 'app');

function* walkHtml(dir, skipDir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDir && full === path.join(serverPublic, 'partials', 'ui')) continue;
      yield* walkHtml(full, skipDir);
    } else if (e.isFile() && e.name.endsWith('.html')) {
      yield full;
    }
  }
}

function checkFile(filePath) {
  const rel = path.relative(root, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];
  if (content.indexOf('style="') >= 0) violations.push('style="');
  if (content.indexOf('<style') >= 0) violations.push('<style');
  return violations.length ? { rel, violations } : null;
}

function checkCustomCssContract() {
  const filePath = path.join(serverPublic, 'custom.css');
  if (!fs.existsSync(filePath)) return null;
  const rel = path.relative(root, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  const violations = [];
  if (/^\s*\.page\s*\{/m.test(content)) {
    violations.push('forbidden: bare `.page { ... }` rule in custom.css');
  }
  return violations.length ? { rel, violations } : null;
}

function main() {
  const results = [];
  for (const f of walkHtml(serverPublic, true)) {
    const r = checkFile(f);
    if (r) results.push(r);
  }
  for (const f of walkHtml(clientApp, false)) {
    const r = checkFile(f);
    if (r) results.push(r);
  }
  const cssContract = checkCustomCssContract();
  if (cssContract) results.push(cssContract);
  if (results.length === 0) {
    console.log('[ui-enforce] OK: no inline styles or <style> in HTML, and custom.css contract holds.');
    process.exit(0);
  }
  console.error('[ui-enforce] FAIL: UI contract violations found:');
  results.forEach(({ rel, violations }) => {
    console.error('  ' + rel + ': ' + violations.join(', '));
  });
  process.exit(1);
}

main();
