#!/usr/bin/env node
/**
 * Generate docs/ROUTES.md from server/index.js.
 * Run: node scripts/generate-routes-doc.js
 * Optional: npm run docs:routes (add to package.json scripts).
 */

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'server', 'index.js');
const outPath = path.join(__dirname, '..', 'docs', 'ROUTES.md');
const src = fs.readFileSync(indexPath, 'utf8');

// Build map: variable name -> route file (e.g. kpisRouter -> server/routes/kpis.js)
const varToFile = {};
const requireRe = /const\s+(\w+)\s*=\s*require\s*\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)/g;
let m;
while ((m = requireRe.exec(src)) !== null) {
  varToFile[m[1]] = `server/routes/${m[2]}.js`;
}
// Middleware and other requires
const middlewareRe = /const\s+(\w+)\s*=\s*require\s*\(\s*['"]\.\/middleware\/([^'"]+)['"]\s*\)/g;
while ((m = middlewareRe.exec(src)) !== null) {
  varToFile[m[1]] = `server/middleware/${m[2]}.js`;
}

function resolveHandler(handlerStr) {
  if (!handlerStr) return '';
  const s = handlerStr.trim();
  // Inline require('./routes/xxx').method (may appear after requireMaster.middleware,)
  const inlineRe = /require\s*\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)(?:\.(\w+))?/;
  const inline = s.match(inlineRe);
  if (inline) {
    const file = `server/routes/${inline[1]}.js`;
    return inline[2] ? `${file} (${inline[2]})` : file;
  }
  // requireMaster.middleware, handler (inline require is resolved per-line above)
  if (s.includes('requireMaster.middleware')) return '(+ requireMaster)';
  // varName.method or varName
  const dot = s.indexOf('.');
  const varName = dot >= 0 ? s.slice(0, dot) : s.split(/[,\s)]/)[0];
  const file = varToFile[varName];
  if (file) {
    const method = dot >= 0 ? s.slice(dot + 1).split(/[(\s]/)[0] : '';
    return method ? `${file} (${method})` : file;
  }
  return '';
}

const apiRoutes = [];
const pageRoutes = [];

// Inline require in a line (for handler resolution when args contain parentheses)
function findInlineRouteInLine(line) {
  const inlineRe = /require\s*\(\s*['"]\.\/routes\/([^'"]+)['"]\s*\)(?:\.(\w+))?/;
  const found = line.match(inlineRe);
  if (found) return `server/routes/${found[1]}.js${found[2] ? ' (' + found[2] + ')' : ''}`;
  return null;
}

// app.METHOD('/path', handler) or app.METHOD('/path', middleware, handler)
const appMethodRe = /app\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
while ((m = appMethodRe.exec(src)) !== null) {
  const method = m[1].toUpperCase();
  const routePath = m[2];
  const lineStart = m.index;
  const lineEnd = src.indexOf('\n', lineStart);
  const line = lineEnd >= 0 ? src.slice(lineStart, lineEnd) : src.slice(lineStart);
  const inlineFile = findInlineRouteInLine(line);
  const handlerPart = line.slice(m[0].length).replace(/\)\s*;?\s*$/, '').trim();
  const resolved = inlineFile || resolveHandler(handlerPart.replace(/\s*,\s*requireMaster\.middleware\s*,?\s*/, ' ').trim());
  apiRoutes.push({ method, path: routePath, handler: resolved || '(inline)' });
}

// app.use('/path', handler)
const appUseRe = /app\.use\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g;
while ((m = appUseRe.exec(src)) !== null) {
  const routePath = m[1];
  const handlerPart = m[2].trim();
  const resolved = resolveHandler(handlerPart.replace(/\s*,\s*requireMaster\.middleware\s*,?\s*/, ' '));
  apiRoutes.push({ method: 'USE', path: routePath, handler: resolved || '(mounted router)' });
}

// *Router.get('/subpath', sendPage(res, 'file.html'))
const sendPageRe = /sendPage\s*\(\s*res\s*,\s*['"]([^'"]+\.html)['"]\s*\)/g;
while ((m = sendPageRe.exec(src)) !== null) {
  const htmlFile = m[1];
  pageRoutes.push(htmlFile);
}

// Router mounts: app.use('/dashboard', dashboardPagesRouter) then dashboardPagesRouter.get('/overview', ...)
// We already have sendPage extractions; map prefix from context. From the file we see:
// dashboardPagesRouter -> /dashboard, insightsPagesRouter -> /insights, etc.
const routerPrefixes = [
  ['dashboardPagesRouter', '/dashboard'],
  ['insightsPagesRouter', '/insights'],
  ['acquisitionPagesRouter', '/acquisition'],
  ['integrationsPagesRouter', '/integrations'],
  ['toolsPagesRouter', '/tools'],
];
const pagePathByFile = {};
const sendPageRe2 = /(\w+PagesRouter)\.get\s*\(\s*['"]([^'"]+)['"]\s*,\s*\([^)]*\)\s*=>\s*sendPage\s*\(\s*res\s*,\s*['"]([^'"]+)['"]\s*\)/g;
while ((m = sendPageRe2.exec(src)) !== null) {
  const routerName = m[1];
  const subPath = m[2];
  const htmlFile = m[3];
  const prefix = routerPrefixes.find(([name]) => name === routerName);
  const pathPrefix = prefix ? prefix[1] : '';
  const fullPath = pathPrefix + subPath;
  pagePathByFile[htmlFile] = fullPath;
}
// Settings and other single pages
if (src.includes("sendPage(res, 'upgrade.html')")) pagePathByFile['upgrade.html'] = '/upgrade';
if (src.includes("sendPage(res, 'ui-kit.html')")) pagePathByFile['ui-kit.html'] = '/ui-kit';

// Dedupe and sort API routes (path then method)
const seen = new Set();
const apiUnique = apiRoutes.filter((r) => {
  const key = `${r.method}\t${r.path}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
apiUnique.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

// Build markdown
const lines = [
  '# Route → handler map',
  '',
  'Generated from `server/index.js`. To regenerate: `node scripts/generate-routes-doc.js` (or `npm run docs:routes`).',
  'When adding a route, re-run this script so the doc stays in sync.',
  '',
  '## API routes',
  '',
  '| Method | Path | Handler |',
  '|--------|------|---------|',
];

for (const r of apiUnique) {
  lines.push(`| ${r.method} | \`${r.path}\` | ${r.handler} |`);
}

lines.push('', '## Page routes (URL → HTML)', '', '| Path | File |', '|------|------|');

const sortedPages = Object.entries(pagePathByFile).sort((a, b) => a[1].localeCompare(b[1]));
for (const [file, urlPath] of sortedPages) {
  lines.push(`| \`${urlPath}\` | \`server/public/${file}\` |`);
}
// Add any sendPage we found but didn't map (fallback)
for (const file of pageRoutes) {
  if (!pagePathByFile[file]) {
    lines.push(`| (see index.js) | \`server/public/${file}\` |`);
  }
}

lines.push('');

const outBody = lines.join('\n');
const checkMode = process.argv.includes('--check');

if (checkMode) {
  let existing = '';
  try {
    existing = fs.readFileSync(outPath, 'utf8');
  } catch (_) {}
  if (existing !== outBody) {
    console.error('docs/ROUTES.md is out of date. Run: npm run docs:routes');
    process.exit(1);
  }
  console.log('docs/ROUTES.md is up to date');
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, outBody, 'utf8');
console.log('Wrote', outPath);
