/**
 * GET /api/pixel/ensure?shop=xxx.myshopify.com
 * Creates or updates the Live Visitors web pixel on the store using the shop's access token.
 * Called automatically when the dashboard loads with ?shop= so merchants don't run mutations manually.
 */

const config = require('../config');
const { getDb, isPostgres } = require('../db');

const API_VERSION = '2024-01';

async function shopifyGraphql(shop, accessToken, query, variables) {
  const graphqlUrl = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(`Shopify GraphQL request failed (HTTP ${res.status})`);
    err.httpStatus = res.status;
    err.bodyText = text;
    err.bodyJson = json;
    throw err;
  }

  if (json && Array.isArray(json.errors) && json.errors.length > 0) {
    const err = new Error('Shopify GraphQL returned errors');
    err.graphqlErrors = json.errors;
    err.bodyJson = json;
    throw err;
  }

  if (!json || typeof json !== 'object' || !('data' in json)) {
    const err = new Error('Shopify GraphQL returned an unexpected response');
    err.bodyText = text;
    err.bodyJson = json;
    throw err;
  }

  return json;
}

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
  const settingsObj = { ingestUrl, ingestSecret };
  console.log('[pixel] ensure pushing settings.ingestUrl:', ingestUrl);

  const listQuery = `query { webPixels(first: 50) { edges { node { id settings } } } }`;
  const singlePixelQuery = `query { webPixel { id } }`;

  function parseSettingsFromNode(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object' && raw !== null) return raw;
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  try {
    // Prefer singular webPixel (returns current app's pixel when using app access token)
    const singleData = await shopifyGraphql(shop, row.access_token, singlePixelQuery);
    let existingId = singleData?.data?.webPixel?.id || null;

    if (!existingId) {
      const listData = await shopifyGraphql(shop, row.access_token, listQuery);
      const edges = listData?.data?.webPixels?.edges || [];
      // If we have to fall back to listing, try to pick the pixel that looks like ours
      for (const edge of edges) {
        const node = edge?.node;
        const parsed = parseSettingsFromNode(node?.settings);
        if (!node?.id || !parsed || typeof parsed !== 'object') continue;
        const hasSecret = typeof parsed.ingestSecret === 'string' && parsed.ingestSecret === ingestSecret;
        const hasUrl = typeof parsed.ingestUrl === 'string' && parsed.ingestUrl.includes('/api/ingest');
        if (hasSecret || hasUrl) {
          existingId = node.id;
          break;
        }
      }

      if (!existingId) {
        existingId = edges[0]?.node?.id || null;
      }
    }

    if (existingId) {
      const updateData = await shopifyGraphql(shop, row.access_token, `mutation($id: ID!, $settings: JSON!) {
        webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
          userErrors { code field message }
          webPixel { id }
        }
      }`, { id: existingId, settings: settingsObj });

      const updatePayload = updateData?.data?.webPixelUpdate;
      if (!updatePayload) {
        return res.status(502).json({
          error: 'Shopify returned an unexpected response for webPixelUpdate',
        });
      }
      const errs = updateData?.data?.webPixelUpdate?.userErrors || [];
      if (errs.length > 0) {
        const msg = (errs[0]?.message || '').toLowerCase();
        const alreadySet = msg.includes('already') || msg.includes('unchanged') || msg.includes('no change');
        if (alreadySet) {
          return res.json({ ok: true, action: 'unchanged', ingestUrl, message: 'Pixel settings already set', userErrors: errs });
        }
        console.error('[pixel] webPixelUpdate errors:', errs);
        return res.status(400).json({ error: 'Failed to update pixel', userErrors: errs });
      }
      return res.json({ ok: true, action: 'updated', ingestUrl, webPixel: updatePayload?.webPixel || null });
    }

    const createData = await shopifyGraphql(shop, row.access_token, `mutation($settings: JSON!) {
      webPixelCreate(webPixel: { settings: $settings }) {
        userErrors { code field message }
        webPixel { id }
      }
    }`, { settings: settingsObj });

    const createPayload = createData?.data?.webPixelCreate;
    if (!createPayload) {
      return res.status(502).json({
        error: 'Shopify returned an unexpected response for webPixelCreate',
      });
    }
    const createErrs = createData?.data?.webPixelCreate?.userErrors || [];
    if (createErrs.length > 0) {
      const taken = createErrs.some((e) => (e.code || '').toUpperCase() === 'TAKEN');
      if (taken) {
        // Pixel already exists; try singular webPixel (current app's pixel) then list
        const singleRetryData = await shopifyGraphql(shop, row.access_token, singlePixelQuery);
        let retryId = singleRetryData?.data?.webPixel?.id || null;
        if (!retryId) {
          const retryListData = await shopifyGraphql(shop, row.access_token, listQuery);
          const retryEdges = retryListData?.data?.webPixels?.edges || [];
          for (const edge of retryEdges) {
            const node = edge?.node;
            const parsed = parseSettingsFromNode(node?.settings);
            if (!node?.id || !parsed || typeof parsed !== 'object') continue;
            const hasSecret = typeof parsed.ingestSecret === 'string' && parsed.ingestSecret === ingestSecret;
            const hasUrl = typeof parsed.ingestUrl === 'string' && parsed.ingestUrl.includes('/api/ingest');
            if (hasSecret || hasUrl) {
              retryId = node.id;
              break;
            }
          }
          if (!retryId) retryId = retryEdges[0]?.node?.id || null;
        }
        if (retryId) {
          const updateData = await shopifyGraphql(shop, row.access_token, `mutation($id: ID!, $settings: JSON!) {
            webPixelUpdate(id: $id, webPixel: { settings: $settings }) {
              userErrors { code field message }
              webPixel { id }
            }
          }`, { id: retryId, settings: settingsObj });
          const updateErrs = updateData?.data?.webPixelUpdate?.userErrors || [];
          if (updateErrs.length === 0) {
            return res.json({ ok: true, action: 'updated', ingestUrl, webPixel: updateData?.data?.webPixelUpdate?.webPixel || null });
          }
        }
        return res.status(409).json({
          error: 'Pixel already exists (TAKEN) but could not be updated',
          message: 'Open the app from Shopify Admin to re-sync, or reinstall the app to refresh permissions.',
          userErrors: createErrs,
        });
      }
      console.error('[pixel] webPixelCreate errors:', createErrs);
      return res.status(400).json({ error: 'Failed to create pixel', userErrors: createErrs });
    }
    return res.json({ ok: true, action: 'created', ingestUrl, webPixel: createPayload?.webPixel || null });
  } catch (err) {
    const maybeErrors = err && err.graphqlErrors ? err.graphqlErrors : null;
    console.error('[pixel] Error:', err && err.message ? err.message : err, maybeErrors || '');
    return res.status(502).json({
      error: 'Request to Shopify failed',
      message: err && err.message ? err.message : undefined,
      graphqlErrors: maybeErrors || undefined,
      httpStatus: err && err.httpStatus ? err.httpStatus : undefined,
    });
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
    const data = await shopifyGraphql(shop, row.access_token, 'query { webPixel { settings } }');
    const raw = data?.data?.webPixel?.settings;
    if (raw == null) {
      return res.json({ ok: true, ingestUrl: null, message: 'No pixel or empty settings' });
    }
    const settings = typeof raw === 'object' && raw !== null ? raw : (() => { try { return JSON.parse(raw); } catch (_) { return null; } })();
    if (!settings || typeof settings !== 'object') {
      return res.json({ ok: true, ingestUrl: null, message: 'Settings not valid JSON' });
    }
    const ingestUrl = typeof settings.ingestUrl === 'string' ? settings.ingestUrl : null;
    return res.json({ ok: true, ingestUrl });
  } catch (err) {
    const maybeErrors = err && err.graphqlErrors ? err.graphqlErrors : null;
    console.error('[pixel] status error:', err && err.message ? err.message : err, maybeErrors || '');
    return res.status(502).json({
      error: 'Request to Shopify failed',
      message: err && err.message ? err.message : undefined,
      graphqlErrors: maybeErrors || undefined,
      httpStatus: err && err.httpStatus ? err.httpStatus : undefined,
    });
  }
}

module.exports = { ensurePixel, getPixelStatus, getPixelConfig };
