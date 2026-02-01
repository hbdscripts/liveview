#!/usr/bin/env node
/**
 * Run Shopify CLI: deploy app and extensions (non-interactive for CI/Cursor).
 * Uses --allow-updates so the CLI does not prompt for confirmation.
 * Usage: node scripts/shopify-deploy.js   or   npm run deploy
 * You must be logged in first: shopify auth login (run once).
 */
const { execSync } = require('child_process');
const path = require('path');
const root = path.dirname(path.dirname(__filename));
try {
  execSync('shopify app deploy --allow-updates', {
    stdio: 'inherit',
    cwd: root,
  });
} catch (e) {
  process.exit(e.status ?? 1);
}
