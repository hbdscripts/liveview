/**
 * GET /api/pixel/ensure?shop=xxx.myshopify.com
 * Creates or updates the Live Visitors web pixel on the store using the shop's access token.
 * Called automatically when the dashboard loads with ?shop= so merchants don't run mutations manually.
 */

const config = require('../config');
const { getDb, isPostgres } = require('../db');

const API_VERSION = '2024-01';

async function ensurePixel(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const appUrl = (config.shopify.appUrl || '').replace(/\/$/, '');
  const ingestSecret = (config.ingestSecret || '').trim();
  if (!appUrl.startsWith('http') || !ingestSecret) {
    return res.status(500).json({ error: 'App not configured (SHOPIFY_APP_URL and INGEST_SECRET required)' });
  }

  const db = getDb();
  const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
  if (!row || !row.access_token) {
    return res.status(401).json({
      error: 'No access token for this store. Install the app (complete OAuth) first, then open the app again.',
    });
  }

  const ingestUrl = `${appUrl}/api/ingest`;
  const settings = JSON.stringify({ ingestUrl, ingestSecret });
  const escaped = settings.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const graphqlUrl = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  try {
    // Check if pixel already exists (our app has one web pixel extension)
    const listRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': row.access_token,
      },
      body: JSON.stringify({
        query: `query { webPixels(first: 10) { edges { node { id } } } }`,
      }),
    });
    const listData = await listRes.json();
    const edges = listData?.data?.webPixels?.edges || [];
    const existingId = edges[0]?.node?.id || null;

    if (existingId) {
      const updateRes = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': row.access_token,
        },
        body: JSON.stringify({
          query: `mutation($id: ID!, $settings: String!) {
            webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
              userErrors { code field message }
              webPixel { id settings }
            }
          }`,
          variables: { id: existingId, settings },
        }),
      });
      const updateData = await updateRes.json();
      const errs = updateData?.data?.webPixelUpdate?.userErrors || [];
      if (errs.length > 0) {
        console.error('[pixel] webPixelUpdate errors:', errs);
        return res.status(400).json({ error: 'Failed to update pixel', userErrors: errs });
      }
      return res.json({ ok: true, action: 'updated', webPixel: updateData?.data?.webPixelUpdate?.webPixel });
    }

    const createRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': row.access_token,
      },
      body: JSON.stringify({
        query: `mutation { webPixelCreate(webPixel: { settings: "${escaped}" }) {
          userErrors { code field message }
          webPixel { id settings }
        } }`,
      }),
    });
    const createData = await createRes.json();
    const createErrs = createData?.data?.webPixelCreate?.userErrors || [];
    if (createErrs.length > 0) {
      console.error('[pixel] webPixelCreate errors:', createErrs);
      return res.status(400).json({ error: 'Failed to create pixel', userErrors: createErrs });
    }
    return res.json({ ok: true, action: 'created', webPixel: createData?.data?.webPixelCreate?.webPixel });
  } catch (err) {
    console.error('[pixel] Error:', err);
    return res.status(502).json({ error: 'Request to Shopify failed' });
  }
}

module.exports = { ensurePixel };
