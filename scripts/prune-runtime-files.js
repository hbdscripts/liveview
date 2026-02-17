const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  process.exit(0);
}

const removeTargets = [
  '.cursor',
  '.github',
  'docs',
  'extensions',
  'workers',
  'client',
  'config',
  '.env.example',
  'README.md',
  'INSTALL.md',
  'shopify.app.toml',
  '.gitignore',
  '.git',
];

const removeScriptFiles = [
  'scripts/configure-pixel.js',
  'scripts/cr-baseline-queries.js',
  'scripts/generate-ingest-secret.js',
  'scripts/shopify-deploy.js',
  'scripts/shopify-link.js',
  'scripts/update-pixel-ingest-url.js',
];

function removePath(relativePath) {
  const fullPath = path.join(root, relativePath);
  try {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } catch (_) {
    // Ignore removal errors to avoid breaking production startup.
  }
}

removeTargets.forEach(removePath);
removeScriptFiles.forEach(removePath);
