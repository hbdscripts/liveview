/**
 * Fetch offline conversion upload diagnostics (client + conversion action summaries).
 * Caches results in google_ads_diagnostics_cache for quick UI polling.
 */
const { getAdsDb } = require('./adsDb');
const googleAdsClient = require('./googleAdsClient');

const CLIENT_SUMMARY_QUERY =
  'SELECT offline_conversion_upload_client_summary.resource_name, ' +
  'offline_conversion_upload_client_summary.client, ' +
  'offline_conversion_upload_client_summary.status, ' +
  'offline_conversion_upload_client_summary.last_upload_date_time, ' +
  'offline_conversion_upload_client_summary.total_event_count, ' +
  'offline_conversion_upload_client_summary.successful_event_count, ' +
  'offline_conversion_upload_client_summary.pending_event_count, ' +
  'offline_conversion_upload_client_summary.success_rate, ' +
  'offline_conversion_upload_client_summary.pending_rate ' +
  'FROM offline_conversion_upload_client_summary';

const ACTION_SUMMARY_QUERY =
  'SELECT offline_conversion_upload_conversion_action_summary.conversion_action, ' +
  'offline_conversion_upload_conversion_action_summary.conversion_action_name, ' +
  'offline_conversion_upload_conversion_action_summary.client, ' +
  'offline_conversion_upload_conversion_action_summary.status, ' +
  'offline_conversion_upload_conversion_action_summary.last_upload_date_time, ' +
  'offline_conversion_upload_conversion_action_summary.total_event_count, ' +
  'offline_conversion_upload_conversion_action_summary.successful_event_count, ' +
  'offline_conversion_upload_conversion_action_summary.pending_event_count, ' +
  'offline_conversion_upload_conversion_action_summary.success_rate, ' +
  'offline_conversion_upload_conversion_action_summary.pending_rate ' +
  'FROM offline_conversion_upload_conversion_action_summary';

/**
 * Fetch client-level offline conversion upload summary.
 * @param {string} [shop]
 * @returns {Promise<{ ok: boolean, rows?: object[], error?: string }>}
 */
async function fetchClientSummary(shop) {
  const out = await googleAdsClient.search(shop, CLIENT_SUMMARY_QUERY);
  if (!out || !out.ok) {
    return { ok: false, error: (out && out.error) || 'client summary query failed', rows: [] };
  }
  const rows = (out.results || []).map((r) => {
    const s = r && r.offlineConversionUploadClientSummary ? r.offlineConversionUploadClientSummary : {};
    return {
      resource_name: s.resourceName,
      client: s.client,
      status: s.status,
      last_upload_date_time: s.lastUploadDateTime,
      total_event_count: s.totalEventCount != null ? Number(s.totalEventCount) : null,
      successful_event_count: s.successfulEventCount != null ? Number(s.successfulEventCount) : null,
      pending_event_count: s.pendingEventCount != null ? Number(s.pendingEventCount) : null,
      success_rate: s.successRate != null ? Number(s.successRate) : null,
      pending_rate: s.pendingRate != null ? Number(s.pendingRate) : null,
    };
  });
  return { ok: true, rows };
}

/**
 * Fetch conversion-action-level offline conversion upload summary.
 * @param {string} [shop]
 * @returns {Promise<{ ok: boolean, rows?: object[], error?: string }>}
 */
async function fetchActionSummaries(shop) {
  const out = await googleAdsClient.search(shop, ACTION_SUMMARY_QUERY);
  if (!out || !out.ok) {
    return { ok: false, error: (out && out.error) || 'action summary query failed', rows: [] };
  }
  const rows = (out.results || []).map((r) => {
    const s = r && r.offlineConversionUploadConversionActionSummary ? r.offlineConversionUploadConversionActionSummary : {};
    return {
      conversion_action: s.conversionAction,
      conversion_action_name: s.conversionActionName,
      client: s.client,
      status: s.status,
      last_upload_date_time: s.lastUploadDateTime,
      total_event_count: s.totalEventCount != null ? Number(s.totalEventCount) : null,
      successful_event_count: s.successfulEventCount != null ? Number(s.successfulEventCount) : null,
      pending_event_count: s.pendingEventCount != null ? Number(s.pendingEventCount) : null,
      success_rate: s.successRate != null ? Number(s.successRate) : null,
      pending_rate: s.pendingRate != null ? Number(s.pendingRate) : null,
    };
  });
  return { ok: true, rows };
}

/**
 * Fetch both client and action summaries and optionally cache.
 * @param {string} [shop]
 * @param {{ cache?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, clientSummary?: object[], actionSummaries?: object[], error?: string }>}
 */
async function fetchDiagnostics(shop, options = {}) {
  const clientOut = await fetchClientSummary(shop);
  const actionOut = await fetchActionSummaries(shop);
  const ok = clientOut.ok && actionOut.ok;
  const payload = {
    ok,
    clientSummary: clientOut.ok ? clientOut.rows : [],
    actionSummaries: actionOut.ok ? actionOut.rows : [],
    error: !clientOut.ok ? clientOut.error : !actionOut.ok ? actionOut.error : null,
  };
  if (options.cache !== false && shop && (clientOut.ok || actionOut.ok)) {
    const db = getAdsDb();
    if (db) {
      const now = Date.now();
      const clientJson = JSON.stringify(payload.clientSummary || []);
      const actionJson = JSON.stringify(payload.actionSummaries || []);
      const normShop = String(shop).trim().toLowerCase();
      await db.run(
        `INSERT INTO google_ads_diagnostics_cache (shop, client_summary_json, action_summaries_json, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (shop) DO UPDATE SET
           client_summary_json = EXCLUDED.client_summary_json,
           action_summaries_json = EXCLUDED.action_summaries_json,
           fetched_at = EXCLUDED.fetched_at`,
        [normShop, clientJson, actionJson, now]
      ).catch(() => {});
    }
  }
  return payload;
}

/**
 * Read cached diagnostics for a shop.
 * @param {string} shop
 * @returns {Promise<{ clientSummary: object[], actionSummaries: object[], fetched_at: number }|null>}
 */
async function getCachedDiagnostics(shop) {
  const db = getAdsDb();
  if (!db || !shop) return null;
  const normShop = String(shop).trim().toLowerCase();
  const row = await db.get(
    'SELECT client_summary_json, action_summaries_json, fetched_at FROM google_ads_diagnostics_cache WHERE shop = ?',
    [normShop]
  );
  if (!row) return null;
  let clientSummary = [];
  let actionSummaries = [];
  try {
    if (row.client_summary_json) clientSummary = JSON.parse(row.client_summary_json);
  } catch (_) {}
  try {
    if (row.action_summaries_json) actionSummaries = JSON.parse(row.action_summaries_json);
  } catch (_) {}
  return {
    clientSummary: Array.isArray(clientSummary) ? clientSummary : [],
    actionSummaries: Array.isArray(actionSummaries) ? actionSummaries : [],
    fetched_at: row.fetched_at != null ? Number(row.fetched_at) : 0,
  };
}

module.exports = {
  fetchClientSummary,
  fetchActionSummaries,
  fetchDiagnostics,
  getCachedDiagnostics,
};
