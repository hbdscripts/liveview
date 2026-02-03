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

  let ingestUrl;
  const override = (req.query.ingestUrl || (req.body && typeof req.body.ingestUrl === 'string' ? req.body.ingestUrl : '') || '').trim();
  if (override) {
    try {
      const u = new URL(override);
      if (u.protocol !== 'https:') {
        return res.status(400).json({ error: 'ingestUrl must be https' });
      }
      const origin = u.origin;
      const base = u.pathname === '/api/ingest' ? origin : override.replace(/\/+$/, '');
      const normalized = base.endsWith('/api/ingest') ? base : `${base}/api/ingest`;
      const allowed = config.allowedIngestOrigins || [];
      const originAllowed = allowed.length > 0 && allowed.some((o) => {
        const oUrl = (o.startsWith('http') ? o : 'https://' + o).replace(/\/+$/, '');
        try {
          return new URL(oUrl).origin === origin;
        } catch (_) {
          return false;
        }
      });
      if (!originAllowed) {
        return res.status(400).json({
          error: 'ingestUrl origin not allowed. Set ALLOWED_INGEST_ORIGINS (or INGEST_PUBLIC_URL) in Railway.',
        });
      }
      ingestUrl = normalized;
      console.log('[pixel] ensure using override ingestUrl:', ingestUrl);
    } catch (_) {
      return res.status(400).json({ error: 'Invalid ingestUrl' });
    }
  } else {
    const ingestBase = config.ingestPublicUrl && config.ingestPublicUrl.startsWith('http')
      ? config.ingestPublicUrl
      : appUrl;
    ingestUrl = `${ingestBase}/api/ingest`;
    console.log('[pixel] ensure sending ingestUrl:', ingestUrl, '(INGEST_PUBLIC_URL:', !!config.ingestPublicUrl, ')');
  }
  const settings = JSON.stringify({ ingestUrl, ingestSecret });
  console.log('[pixel] ensure pushing settings.ingestUrl:', ingestUrl);
  const escaped = settings.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const graphqlUrl = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

  const listQuery = `query { webPixels(first: 50) { edges { node { id } } } }`;
  const singlePixelQuery = `query { webPixel { id settings } }`;

  try {
    // Prefer singular webPixel (returns current app's pixel when using app access token)
    const singleRes = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': row.access_token,
      },
      body: JSON.stringify({ query: singlePixelQuery }),
    });
    const singleData = await singleRes.json();
    let existingId = singleData?.data?.webPixel?.id || null;

    if (!existingId) {
      const listRes = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': row.access_token,
        },
        body: JSON.stringify({ query: listQuery }),
      });
      const listData = await listRes.json();
      const edges = listData?.data?.webPixels?.edges || [];
      existingId = edges[0]?.node?.id || null;
    }

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
        const msg = (errs[0]?.message || '').toLowerCase();
        const alreadySet = msg.includes('already') || msg.includes('unchanged') || msg.includes('no change');
        if (alreadySet) {
          return res.json({ ok: true, action: 'unchanged', message: 'Pixel settings already set', userErrors: errs });
        }
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
      const taken = createErrs.some((e) => (e.code || '').toUpperCase() === 'TAKEN');
      if (taken) {
        // Pixel already exists; try singular webPixel (current app's pixel) then list
        const singleRetryRes = await fetch(graphqlUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': row.access_token,
          },
          body: JSON.stringify({ query: singlePixelQuery }),
        });
        const singleRetryData = await singleRetryRes.json();
        let retryId = singleRetryData?.data?.webPixel?.id || null;
        if (!retryId) {
          const retryListRes = await fetch(graphqlUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': row.access_token,
            },
            body: JSON.stringify({ query: listQuery }),
          });
          const retryListData = await retryListRes.json();
          const retryEdges = retryListData?.data?.webPixels?.edges || [];
          retryId = retryEdges[0]?.node?.id || null;
        }
        if (retryId) {
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
              variables: { id: retryId, settings },
            }),
          });
          const updateData = await updateRes.json();
          const updateErrs = updateData?.data?.webPixelUpdate?.userErrors || [];
          if (updateErrs.length === 0) {
            return res.json({ ok: true, action: 'updated', webPixel: updateData?.data?.webPixelUpdate?.webPixel });
          }
        }
        return res.json({ ok: true, action: 'already_exists', message: 'Pixel already exists (TAKEN); open app from Shopify Admin to sync URL', userErrors: createErrs });
      }
      console.error('[pixel] webPixelCreate errors:', createErrs);
      return res.status(400).json({ error: 'Failed to create pixel', userErrors: createErrs });
    }
    return res.json({ ok: true, action: 'created', webPixel: createData?.data?.webPixelCreate?.webPixel });
  } catch (err) {
    console.error('[pixel] Error:', err);
    return res.status(502).json({ error: 'Request to Shopify failed' });
  }
}

/**
 * GET /api/pixel/config
 * Returns the ingest URL this server would push when ensure runs (from INGEST_PUBLIC_URL or SHOPIFY_APP_URL).
 * Use this to confirm Railway has INGEST_PUBLIC_URL set before running the update script.
 */
function getPixelConfig(req, res) {
  const appUrl = (config.shopify.appUrl || '').replace(/\/$/, '');
  const ingestBase = config.ingestPublicUrl && config.ingestPublicUrl.startsWith('http')
    ? config.ingestPublicUrl
    : appUrl;
  const ingestUrl = ingestBase ? `${ingestBase}/api/ingest` : null;
  res.json({
    ok: true,
    ingestUrl,
    source: config.ingestPublicUrl && config.ingestPublicUrl.startsWith('http') ? 'INGEST_PUBLIC_URL' : 'SHOPIFY_APP_URL',
  });
}

/**
 * GET /api/pixel/status?shop=xxx.myshopify.com
 * Returns the current ingest URL stored in Shopify for the pixel (so you can verify after ensure).
 */
async function getPixelStatus(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const db = getDb();
  const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
  if (!row || !row.access_token) {
    return res.status(401).json({
      error: 'No access token for this store. Install the app (OAuth) first.',
    });
  }

  const graphqlUrl = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  try {
    const res2 = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': row.access_token,
      },
      body: JSON.stringify({ query: 'query { webPixel { settings } }' }),
    });
    const data = await res2.json();
    const raw = data?.data?.webPixel?.settings;
    if (raw == null || typeof raw !== 'string') {
      return res.json({ ok: true, ingestUrl: null, message: 'No pixel or empty settings' });
    }
    let settings;
    try {
      settings = JSON.parse(raw);
    } catch (_) {
      return res.json({ ok: true, ingestUrl: null, message: 'Settings not valid JSON' });
    }
    const ingestUrl = settings && typeof settings.ingestUrl === 'string' ? settings.ingestUrl : null;
    return res.json({ ok: true, ingestUrl });
  } catch (err) {
    console.error('[pixel] status error:', err);
    return res.status(502).json({ error: 'Request to Shopify failed' });
  }
}

module.exports = { ensurePixel, getPixelStatus, getPixelConfig };
