#!/usr/bin/env node
/**
 * Run Shopify CLI: link this project to your app using SHOPIFY_API_KEY from .env.
 * Non-interactive when SHOPIFY_API_KEY is set.
 * Usage: node scripts/shopify-link.js   or   npm run config:link
 */
require('dotenv').config({ path: require('path').join(require('path').dirname(__dirname), '.env') });
const { execSync } = require('child_process');
const clientId = process.env.SHOPIFY_API_KEY || process.env.SHOPIFY_CLIENT_ID;
if (!clientId || !clientId.trim()) {
  console.error('Set SHOPIFY_API_KEY (or SHOPIFY_CLIENT_ID) in .env, then run again.');
  process.exit(1);
}
try {
  execSync(`shopify app config link --client-id "${clientId.trim()}"`, {
    stdio: 'inherit',
    cwd: require('path').dirname(__dirname),
  });
} catch (e) {
  process.exit(e.status ?? 1);
}
