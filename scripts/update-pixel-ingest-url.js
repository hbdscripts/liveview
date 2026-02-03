#!/usr/bin/env node
/**
 * Call the deployed app's /api/pixel/ensure to update the Shopify pixel's ingest URL.
 * The app uses INGEST_PUBLIC_URL (or SHOPIFY_APP_URL) to build the URL; the pixel is updated via Shopify GraphQL.
 *
 * Prerequisites:
 * - Set INGEST_PUBLIC_URL in Railway (e.g. https://lv-ingest.hbdjewellery.com), redeploy.
 * - App must have an access token for the shop (install/OAuth done).
 *
 * Usage:
 *   node scripts/update-pixel-ingest-url.js STORENAME.myshopify.com
 *   node scripts/update-pixel-ingest-url.js STORENAME.myshopify.com https://liveview-production.up.railway.app
 *
 * If APP_URL is omitted, SHOPIFY_APP_URL from .env is used (so you can point at deployed or local).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const shop = (process.argv[2] || process.env.SHOP_DOMAIN || '').trim().toLowerCase();
const appUrlRaw = (process.argv[3] || process.env.SHOPIFY_APP_URL || '').trim().replace(/\/$/, '');

if (!shop || !shop.endsWith('.myshopify.com')) {
  console.error('Usage: node scripts/update-pixel-ingest-url.js STORENAME.myshopify.com [APP_URL]');
  console.error('Example: node scripts/update-pixel-ingest-url.js hbdjewellery.myshopify.com https://liveview-production.up.railway.app');
  process.exit(1);
}

if (!appUrlRaw || !appUrlRaw.startsWith('http')) {
  console.error('Set APP_URL as second argument or SHOPIFY_APP_URL in .env');
  process.exit(1);
}

const ensureUrl = `${appUrlRaw}/api/pixel/ensure?shop=${encodeURIComponent(shop)}`;

console.log('Calling:', ensureUrl);
console.log('(Ensure uses INGEST_PUBLIC_URL from the server; set it in Railway and redeploy first.)\n');

fetch(ensureUrl, { method: 'GET' })
  .then((r) => r.json().then((body) => ({ status: r.status, body })))
  .then(({ status, body }) => {
    if (status !== 200) {
      console.error('Error:', status, body);
      process.exit(1);
    }
    if (body.error) {
      console.error('Error:', body.error);
      if (body.userErrors && body.userErrors.length) console.error(body.userErrors);
      process.exit(1);
    }
    console.log('OK:', body.action || 'updated', body);
  })
  .catch((err) => {
    console.error('Request failed:', err.message);
    process.exit(1);
  });
