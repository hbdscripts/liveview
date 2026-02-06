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

function normalizeColumnName(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s\-]+/g, '_');
}

function getRowValue(row, idx, colName) {
  if (Array.isArray(row)) return row[idx];
  if (!row || typeof row !== 'object') return undefined;
  if (colName && Object.prototype.hasOwnProperty.call(row, colName)) return row[colName];
  if (!colName) return undefined;
  const target = normalizeColumnName(colName);
  for (const key of Object.keys(row)) {
    if (normalizeColumnName(key) === target) return row[key];
  }
  return undefined;
}

function parseNumericValue(val) {
  if (val == null) return null;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  const s = String(val).trim();
  if (!s) return null;
  const cleaned = s.replace(/,/g, '').replace(/%$/, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function normalizeConversionRate(val) {
  const n = parseNumericValue(val);
  if (n == null) return null;
  if (n > 0 && n <= 1) return n * 100;
  return n;
}

function extractSessionsCount(table) {
  if (!table?.rows?.length) return 0;
  const columns = (table.columns || []).map((c) => c && c.name);
  const normalized = columns.map(normalizeColumnName);
  const sessionsIdx = normalized.findIndex((n) => n === 'sessions' || n.includes('sessions'));
  if (sessionsIdx === -1) return null;
  let total = 0;
  for (const row of table.rows || []) {
    const val = getRowValue(row, sessionsIdx, columns[sessionsIdx]);
    const n = parseNumericValue(val);
    if (n != null) total += n;
  }
  return total;
}

async function fetchShopifyQlTable(shop, accessToken, query) {
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
    return { table: null, error: err && err.message ? String(err.message).slice(0, 80) : 'Network error' };
  }

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    return { table: null, error: 'Invalid JSON from Shopify' };
  }
  if (!res.ok) {
    const msg = firstErrorMsg(json) || json?.message || `HTTP ${res.status}`;
    return { table: null, error: String(msg).slice(0, 120) };
  }
  const graphqlError = firstErrorMsg(json);
  if (graphqlError) {
    return { table: null, error: String(graphqlError).slice(0, 120) };
  }
  if (!json?.data?.shopifyqlQuery) {
    return { table: null, error: 'No shopifyqlQuery in response' };
  }
  const q = json.data.shopifyqlQuery;
  if (q.parseErrors?.length) {
    const msg = (q.parseErrors[0] || 'Parse error').slice(0, 120);
    return { table: null, error: msg };
  }
  return { table: q.tableData || null, error: '' };
}

/**
 * Returns { count, error } where count is a number or null, and error is a short message if the request failed.
 */
async function fetchShopifySessionsCount(shop, accessToken, { during = 'today' } = {}) {
  const metrics = await fetchShopifySessionsMetrics(shop, accessToken, { during });
  if (typeof metrics.sessions === 'number') return { count: metrics.sessions, error: '' };
  return { count: null, error: metrics.error || 'Sessions unavailable' };
}

/**
 * Returns { sessions, conversionRate, error } where values are numbers or null.
 */
async function fetchShopifySessionsMetrics(shop, accessToken, { during = 'today' } = {}) {
  const duringSafe = sanitizeDuring(during);
  if (!duringSafe) return { sessions: null, conversionRate: null, error: 'Invalid DURING value' };
  const query = `FROM sessions SHOW sessions, conversion_rate DURING ${duringSafe}`;
  const result = await fetchShopifyQlTable(shop, accessToken, query);
  if (result.error) {
    const fallback = await fetchShopifyQlTable(shop, accessToken, `FROM sessions SHOW sessions DURING ${duringSafe}`);
    if (!fallback.error) {
      const sessions = extractSessionsCount(fallback.table);
      if (typeof sessions === 'number') {
        return { sessions, conversionRate: null, error: result.error };
      }
    }
    return { sessions: null, conversionRate: null, error: result.error };
  }
  const table = result.table;
  if (!table?.rows?.length) return { sessions: 0, conversionRate: null, error: '' };

  const columns = (table.columns || []).map((c) => c && c.name);
  const normalized = columns.map(normalizeColumnName);
  const sessionsIdx = normalized.findIndex((n) => n === 'sessions' || n.includes('sessions'));
  const conversionIdx = normalized.findIndex((n) => n === 'conversion_rate' || n === 'online_store_conversion_rate' || n.includes('conversion_rate'));

  if (sessionsIdx === -1 && conversionIdx === -1) {
    return { sessions: null, conversionRate: null, error: 'Sessions/conversion columns not found' };
  }
  const conversionMissingError = (conversionIdx === -1) ? 'conversion_rate column not found' : '';

  let sessionsTotal = 0;
  let sessionsSeen = false;
  let convWeightedSum = 0;
  let convWeightTotal = 0;
  let convSimpleSum = 0;
  let convCount = 0;

  for (const row of table.rows || []) {
    const sVal = sessionsIdx >= 0 ? getRowValue(row, sessionsIdx, columns[sessionsIdx]) : null;
    const sessions = parseNumericValue(sVal);
    if (sessions != null) {
      sessionsTotal += sessions;
      sessionsSeen = true;
    }

    const cVal = conversionIdx >= 0 ? getRowValue(row, conversionIdx, columns[conversionIdx]) : null;
    const conv = normalizeConversionRate(cVal);
    if (conv != null) {
      convSimpleSum += conv;
      convCount += 1;
      if (sessions != null && sessions > 0) {
        convWeightedSum += conv * sessions;
        convWeightTotal += sessions;
      }
    }
  }

  const conversionRate = convWeightTotal > 0
    ? (convWeightedSum / convWeightTotal)
    : (convCount > 0 ? (convSimpleSum / convCount) : null);

  return {
    sessions: sessionsSeen ? sessionsTotal : (sessionsIdx >= 0 ? 0 : null),
    conversionRate,
    error: conversionMissingError,
  };
}

module.exports = {
  fetchShopifySessionsCount,
  fetchShopifySessionsMetrics,
};

