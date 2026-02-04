/**
 * ShopifyQL helpers (GraphQL) used for diagnostics/snapshots.
 *
 * NOTE: Keep this module dependency-light (no store.js import) to avoid circular deps.
 */
const GRAPHQL_API_VERSION = '2025-10'; // shopifyqlQuery available from 2025-10

function firstErrorMsg(json) {
  const err = json?.errors?.[0];
  if (err && typeof err.message === 'string') return err.message;
  return null;
}

function sanitizeDuring(during) {
  const d = typeof during === 'string' ? during.trim() : '';
  if (!d) return null;
  const dl = d.toLowerCase();
  if (dl === 'today' || dl === 'yesterday') return dl;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return null;
}

/**
 * Returns { count, error } where count is a number or null, and error is a short message if the request failed.
 */
async function fetchShopifySessionsCount(shop, accessToken, { during = 'today' } = {}) {
  const duringSafe = sanitizeDuring(during);
  if (!duringSafe) return { count: null, error: 'Invalid DURING value' };
  const query = `FROM sessions SHOW sessions DURING ${duringSafe}`;
  const graphqlUrl = `https://${shop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`;
  let res;
  let text;
  try {
    res = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: `query($q: String!) { shopifyqlQuery(query: $q) { tableData { columns { name } rows } parseErrors } }`,
        variables: { q: query },
      }),
    });
    text = await res.text();
  } catch (err) {
    return { count: null, error: err && err.message ? String(err.message).slice(0, 80) : 'Network error' };
  }

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    return { count: null, error: 'Invalid JSON from Shopify' };
  }
  if (!res.ok) {
    const msg = firstErrorMsg(json) || json?.message || `HTTP ${res.status}`;
    return { count: null, error: String(msg).slice(0, 120) };
  }
  const graphqlError = firstErrorMsg(json);
  if (graphqlError) {
    return { count: null, error: String(graphqlError).slice(0, 120) };
  }
  if (!json?.data?.shopifyqlQuery) {
    return { count: null, error: 'No shopifyqlQuery in response' };
  }
  const q = json.data.shopifyqlQuery;
  if (q.parseErrors?.length) {
    const msg = (q.parseErrors[0] || 'Parse error').slice(0, 120);
    return { count: null, error: msg };
  }
  const table = q.tableData;
  if (!table?.rows?.length) return { count: 0, error: '' };
  const columns = (table.columns || []).map((c) => c.name);
  const sessionsIdx = columns.findIndex((n) => String(n).toLowerCase().includes('sessions'));
  if (sessionsIdx === -1) return { count: null, error: 'Sessions column not found' };
  let total = 0;
  for (const row of table.rows) {
    const val = Array.isArray(row) ? row[sessionsIdx] : row[columns[sessionsIdx]];
    const n = typeof val === 'number' ? val : parseInt(String(val || '').replace(/,/g, ''), 10);
    if (Number.isFinite(n)) total += n;
  }
  return { count: total, error: '' };
}

module.exports = {
  fetchShopifySessionsCount,
};

