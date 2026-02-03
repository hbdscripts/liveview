#!/usr/bin/env node
/**
 * Call the deployed app's /api/pixel/ensure to update the Shopify pixel's ingest URL.
 * Optionally verify by calling /api/pixel/status to show what URL is stored in Shopify.
 *
 * Prerequisites:
 * - Set INGEST_PUBLIC_URL in Railway (e.g. https://lv-ingest.hbdjewellery.com), redeploy.
 * - App must have an access token for the shop (install/OAuth done).
 *
 * Usage:
 *   node scripts/update-pixel-ingest-url.js STORENAME.myshopify.com [APP_URL]
 *   node scripts/update-pixel-ingest-url.js STORENAME.myshopify.com APP_URL --verify   (only show current URL, no update)
 *
 * If APP_URL is omitted, SHOPIFY_APP_URL from .env is used.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify');
const clean = args.filter((a) => a !== '--verify');
const shop = (clean[0] || process.env.SHOP_DOMAIN || '').trim().toLowerCase();
const appUrlRaw = (clean[1] || process.env.SHOPIFY_APP_URL || '').trim().replace(/\/$/, '');

if (!shop || !shop.endsWith('.myshopify.com')) {
  console.error('Usage: node scripts/update-pixel-ingest-url.js STORENAME.myshopify.com [APP_URL] [--verify]');
  console.error('  --verify  only show current pixel ingest URL from Shopify (no update)');
  process.exit(1);
}

if (!appUrlRaw || !appUrlRaw.startsWith('http')) {
  console.error('Set APP_URL as second argument or SHOPIFY_APP_URL in .env');
  process.exit(1);
}

function fetchConfig() {
  const url = `${appUrlRaw}/api/pixel/config`;
  return fetch(url, { method: 'GET' }).then((r) => r.json().then((body) => ({ status: r.status, body })));
}

function fetchStatus() {
  const statusUrl = `${appUrlRaw}/api/pixel/status?shop=${encodeURIComponent(shop)}`;
  return fetch(statusUrl, { method: 'GET' })
    .then((r) => r.json().then((body) => ({ status: r.status, body })));
}

function runEnsure() {
  const ensureUrl = `${appUrlRaw}/api/pixel/ensure?shop=${encodeURIComponent(shop)}`;
  console.log('Calling:', ensureUrl);
  console.log('(Ensure uses INGEST_PUBLIC_URL from the server; set it in Railway and redeploy first.)\n');
  return fetch(ensureUrl, { method: 'GET' })
    .then((r) => r.json().then((body) => ({ status: r.status, body })));
}

function main() {
  if (verifyOnly) {
    fetchStatus()
      .then(({ status, body }) => {
        if (status !== 200 || !body.ok) {
          console.error('Error:', status, body.error || body);
          process.exit(1);
        }
        console.log('Current pixel ingest URL (from Shopify):', body.ingestUrl ?? '(none or not set)');
        if (body.message) console.log(body.message);
      })
      .catch((err) => {
        console.error('Request failed:', err.message);
        process.exit(1);
      });
    return;
  }

  let expectedIngestUrl = '';
  fetchConfig()
    .then(({ status, body }) => {
      if (status !== 200 || !body.ok) {
        console.error('Could not read server config:', body);
        process.exit(1);
      }
      const url = body.ingestUrl || '';
      expectedIngestUrl = url;
      const isCf = url.includes('lv-ingest') || (url && !url.includes('railway'));
      console.log('Server would push:', url || '(none)');
      console.log('Source:', body.source || 'unknown');
      if (!isCf && url) {
        console.warn('\nWARNING: Server does not have INGEST_PUBLIC_URL set – pixel will get Railway URL.');
        console.warn('Set INGEST_PUBLIC_URL in Railway (e.g. https://lv-ingest.yourdomain.com), redeploy, then run this again.\n');
      }
      return runEnsure();
    })
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
      return fetchStatus();
    })
    .then((result) => {
      if (!result) return;
      const { status, body } = result;
      if (status === 200 && body.ok) {
        const current = body.ingestUrl ?? '(none)';
        console.log('\nVerified – current pixel ingest URL in Shopify:', current);
        if (expectedIngestUrl && current !== expectedIngestUrl && current !== '(none)') {
          console.warn('\nMismatch: server said it would push', expectedIngestUrl, 'but Shopify has', current);
          console.warn('If using multiple replicas, ensure INGEST_PUBLIC_URL is set and redeploy so every instance has it. Check Railway logs for [pixel] ensure sending ingestUrl.');
        }
      }
    })
    .catch((err) => {
      console.error('Request failed:', err.message);
      process.exit(1);
    });
}

main();
