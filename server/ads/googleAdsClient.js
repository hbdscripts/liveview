/**
 * Google Ads API client: credentials, GAQL search, redacted errors.
 * Token exchange and search delegate to googleAdsSpendSync.
 */
const { getGoogleAdsConfig, getResolvedCustomerIds } = require('./adsStore');
const config = require('../config');
const {
  fetchAccessTokenFromRefreshToken,
  googleAdsSearch,
  getApiVersionsToTry,
} = require('./googleAdsSpendSync');

function redactError(err) {
  if (!err || typeof err !== 'object') return err;
  const msg = err.message != null ? String(err.message) : String(err);
  const redacted = msg
    .replace(/\b(ya29\.[A-Za-z0-9_-]+)/g, '[REDACTED_ACCESS_TOKEN]')
    .replace(/\b(1\/[A-Za-z0-9_-]+)/g, '[REDACTED_REFRESH_TOKEN]');
  return redacted !== msg ? new Error(redacted) : err;
}

/**
 * Resolve credentials for a shop: access token, customer ids, developer token.
 * @param {string} [shop]
 * @returns {Promise<{ accessToken, customerId, loginCustomerId, developerToken, apiVersion? }|null>}
 */
async function getCredentials(shop) {
  const developerToken = (config.googleAdsDeveloperToken || '').trim();
  if (!developerToken) return null;
  const cfg = await getGoogleAdsConfig(shop);
  const { customerId, loginCustomerId, conversionCustomerId } = getResolvedCustomerIds(cfg);
  if (!customerId) return null;
  const targetCustomerId = conversionCustomerId || customerId;
  const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
  if (!refreshToken) return null;
  try {
    const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);
    return { accessToken, customerId, conversionCustomerId, targetCustomerId, loginCustomerId, developerToken };
  } catch (e) {
    throw redactError(e);
  }
}

/**
 * Run GAQL search (searchStream). Returns { ok, results, apiVersion, error, attempts }.
 * @param {string} [shop]
 * @param {string} query
 * @param {{ apiVersionHint?: string }} [options]
 */
async function search(shop, query, options = {}) {
  const creds = await getCredentials(shop);
  if (!creds) {
    return { ok: false, error: 'Missing credentials or not connected', results: [], attempts: [] };
  }
  try {
    const out = await googleAdsSearch({
      customerId: creds.targetCustomerId || creds.customerId,
      loginCustomerId: creds.loginCustomerId,
      developerToken: creds.developerToken,
      accessToken: creds.accessToken,
      query: String(query || ''),
      apiVersionHint: options.apiVersionHint || '',
    });
    if (out && out.error) out.error = redactError(new Error(out.error)).message;
    return out;
  } catch (e) {
    return {
      ok: false,
      error: redactError(e).message,
      results: [],
      attempts: [],
    };
  }
}

/**
 * Call Google Ads REST mutate for conversion actions.
 * POST .../v{N}/customers/{customer_id}/conversionActions:mutate
 * Operations may be { create: object } or { updateMask: string, update: object }.
 * @param {string} [shop]
 * @param {Array<{ create?: object, updateMask?: string, update?: object }>} operations
 * @returns {Promise<{ ok: boolean, results?: object[], error?: string }>}
 */
async function mutateConversionActions(shop, operations) {
  const creds = await getCredentials(shop);
  if (!creds) {
    return { ok: false, error: 'Missing credentials or not connected' };
  }
  const versions = getApiVersionsToTry({});
  for (const ver of versions) {
    const url = `https://googleads.googleapis.com/${encodeURIComponent(ver)}/customers/${encodeURIComponent(creds.targetCustomerId || creds.customerId)}/conversionActions:mutate`;
    const headers = {
      Authorization: `Bearer ${creds.accessToken}`,
      'developer-token': creds.developerToken,
      'Content-Type': 'application/json',
    };
    if (creds.loginCustomerId) headers['login-customer-id'] = String(creds.loginCustomerId);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ operations }),
      });
      const text = await res.text();
      if (!res.ok) {
        const errMsg = (text && text.length < 500 ? text : text.slice(0, 400) + '...').replace(/\b(ya29\.[A-Za-z0-9_-]+)/g, '[REDACTED]');
        if (res.status === 404 && versions.indexOf(ver) < versions.length - 1) continue;
        return { ok: false, error: `mutate failed (${ver}): ${res.status} ${errMsg}` };
      }
      let data = {};
      try {
        data = JSON.parse(text || '{}');
      } catch (_) {}
      const results = (data && data.results) || [];
      return { ok: true, results, apiVersion: ver };
    } catch (e) {
      if (versions.indexOf(ver) < versions.length - 1) continue;
      return { ok: false, error: redactError(e).message };
    }
  }
  return { ok: false, error: 'conversionActions:mutate not available for any API version' };
}

/**
 * Set primary_for_goal on a conversion action (optimization: Primary vs Secondary).
 * @param {string} [shop]
 * @param {string} resourceName - e.g. customers/123/conversionActions/456
 * @param {boolean} primaryForGoal
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function setConversionActionPrimaryForGoal(shop, resourceName, primaryForGoal) {
  if (!resourceName || typeof resourceName !== 'string' || !resourceName.trim()) {
    return { ok: false, error: 'resource_name required' };
  }
  const operations = [
    {
      updateMask: 'primary_for_goal',
      update: {
        resourceName: String(resourceName).trim(),
        primaryForGoal: Boolean(primaryForGoal),
      },
    },
  ];
  const out = await mutateConversionActions(shop, operations);
  if (!out.ok) return { ok: false, error: out.error };
  return { ok: true };
}

/**
 * Fetch Google Ads customer timezone (IANA name), e.g. "Europe/London".
 * @param {string} [shop]
 * @returns {Promise<{ ok: boolean, timeZone?: string, error?: string }>}
 */
async function fetchCustomerTimeZone(shop) {
  const out = await search(shop, 'SELECT customer.time_zone FROM customer LIMIT 1');
  if (!out || !out.ok) return { ok: false, error: (out && out.error) || 'timezone query failed' };
  const first = (out.results && out.results[0]) || null;
  const tz = first && first.customer && first.customer.timeZone != null ? String(first.customer.timeZone).trim() : '';
  if (!tz) return { ok: false, error: 'customer.time_zone not returned' };
  return { ok: true, timeZone: tz };
}

module.exports = {
  getCredentials,
  search,
  mutateConversionActions,
  setConversionActionPrimaryForGoal,
  fetchCustomerTimeZone,
  redactError,
};
