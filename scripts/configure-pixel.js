#!/usr/bin/env node
/**
 * Print the GraphQL mutation to set the Live Visitors pixel settings (Ingest URL, Ingest Secret).
 * Run: node scripts/configure-pixel.js
 * Then run "shopify app dev", open the GraphiQL URL, paste the mutation, and execute it.
 * There is no "Extensions → Configuration" in Dev Dashboard; settings are set via this API.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const appUrl = (process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
const ingestPublicUrl = (process.env.INGEST_PUBLIC_URL || '').replace(/\/$/, '');
const ingestSecret = process.env.INGEST_SECRET || '';

if (!appUrl || !appUrl.startsWith('http')) {
  console.error('Set SHOPIFY_APP_URL in .env (e.g. https://app.kexo.io)');
  process.exit(1);
}
if (!ingestSecret) {
  console.error('Set INGEST_SECRET in .env (run: node scripts/generate-ingest-secret.js)');
  process.exit(1);
}

const ingestBase = ingestPublicUrl && ingestPublicUrl.startsWith('http') ? ingestPublicUrl : appUrl;
const ingestUrl = `${ingestBase}/api/ingest`;
const settingsJson = JSON.stringify({ ingestUrl, ingestSecret });
const escaped = settingsJson.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const mutation = `mutation {
  webPixelCreate(webPixel: { settings: "${escaped}" }) {
    userErrors { code field message }
    webPixel { id settings }
  }
}`;

console.log('# Paste this mutation into GraphiQL (e.g. when running "shopify app dev") and run it.\n');
console.log(mutation);
console.log('\n# If the pixel already exists, use webPixelUpdate with the pixel id instead of webPixelCreate.');
