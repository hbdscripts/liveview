const config = require('../config');
const fx = require('../fx');
const { getDb, isPostgres } = require('../db');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig, getResolvedCustomerIds, getMissingRefreshTokenError } = require('./adsStore');

function normalizeCustomerId(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return '';
  return s.replace(/[^0-9]/g, '').slice(0, 32);
}

function fmtYmdInTz(tsMs, timeZone) {
  try {
    const d = new Date(Number(tsMs));
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const y = map.year;
    const m = map.month;
    const day = map.day;
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
  } catch (_) {
    return null;
  }
}

function tzOffsetMs(timeZone, utcDate) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcDate);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const y = Number(map.year);
  const m = Number(map.month);
  const d = Number(map.day);
  const h = Number(map.hour);
  const mi = Number(map.minute);
  const s = Number(map.second);
  const localAsUtc = Date.UTC(y, m - 1, d, h, mi, s);
  return localAsUtc - utcDate.getTime();
}

function localYmdHourToUtcMs(ymd, hour, timeZone) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = Number(hour);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d) || !Number.isFinite(h)) return null;

  // Initial guess: treat as UTC, then correct by timezone offset (iterate to handle DST).
  let guess = Date.UTC(y, mo - 1, d, h, 0, 0);
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMs(timeZone, new Date(guess));
    guess = Date.UTC(y, mo - 1, d, h, 0, 0) - off;
  }
  return guess;
}

async function fetchAccessTokenFromRefreshToken(refreshToken) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error('Google refresh_token exchange failed: ' + tokenRes.status + ' ' + errText);
  }

  const data = await tokenRes.json();
  const accessToken = data && data.access_token ? String(data.access_token) : '';
  if (!accessToken) throw new Error('Missing access_token in token response');
  return accessToken;
}

function isLikelyDeprecatedEndpoint404(res, bodyText) {
  if (!res || res.status !== 404) return false;
  const ct = String(res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '').toLowerCase();
  if (ct.includes('text/html')) return true;
  const t = String(bodyText || '').trim().toLowerCase();
  if (!t) return false;
  if (t.startsWith('<!doctype html') || t.startsWith('<html')) return true;
  if (t.includes('error 404') && t.includes('not found')) return true;
  return false;
}

function normalizeApiVersion(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!s) return '';
  if (/^v\d+$/.test(s)) return s;
  if (/^\d+$/.test(s)) return 'v' + s;
  return '';
}

/** Minimal GAQL test: SELECT customer.id FROM customer LIMIT 1. Returns { ok, error?, customerId? }. */
async function testGoogleAdsConnection(shop) {
  const developerToken = (config.googleAdsDeveloperToken || '').trim();
  if (!developerToken) return { ok: false, error: 'Missing GOOGLE_ADS_DEVELOPER_TOKEN' };
  if (!config.googleClientId || !config.googleClientSecret) {
    return { ok: false, error: 'Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' };
  }
  const cfg = await getGoogleAdsConfig(shop);
  const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
  if (!refreshToken) return { ok: false, error: getMissingRefreshTokenError() };
  const { customerId, loginCustomerId } = getResolvedCustomerIds(cfg);
  if (!customerId) return { ok: false, error: 'Missing customer_id (set in OAuth or GOOGLE_ADS_CUSTOMER_ID)' };
  try {
    const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);
    const out = await googleAdsSearch({
      customerId,
      loginCustomerId,
      developerToken,
      accessToken,
      query: 'SELECT customer.id FROM customer LIMIT 1',
    });
    if (!out || !out.ok) {
      return { ok: false, error: (out && out.error) || 'GAQL test failed', attempts: out && out.attempts };
    }
    const first = (out.results && out.results[0]) || null;
    const cid = first && first.customer && first.customer.id != null ? String(first.customer.id) : customerId;
    return { ok: true, customerId: cid };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message).slice(0, 320) : 'test_connection_failed' };
  }
}

function getApiVersionsToTry(options = {}) {
  const hint = normalizeApiVersion(options.apiVersionHint);
  const fromEnv = normalizeApiVersion(config.googleAdsApiVersion);
  const versionsRaw = [
    hint,
    fromEnv,
    'v25',
    'v24',
    'v23',
    'v22',
    'v21',
    'v20',
    'v19',
    'v18',
    'v17',
  ].filter(Boolean);
  return Array.from(new Set(versionsRaw));
}

async function googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint = '' }) {
  const versions = getApiVersionsToTry({ apiVersionHint });

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);

  const attempts = [];
  let lastErr = null;
  for (const ver of versions) {
    const url = `https://googleads.googleapis.com/${encodeURIComponent(ver)}/customers/${encodeURIComponent(customerId)}/googleAds:searchStream`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      });

      const contentType = String(res.headers && res.headers.get ? (res.headers.get('content-type') || '') : '');

      if (!res.ok) {
        const errText = await res.text();
        const bodySnippet = String(errText || '').slice(0, 380);
        attempts.push({
          version: ver,
          url,
          ok: false,
          status: res.status,
          contentType,
          bodySnippet,
        });
        if (isLikelyDeprecatedEndpoint404(res, errText)) {
          lastErr = new Error('Google Ads endpoint not found for ' + ver);
          continue; // try next version
        }
        // Some unsupported API versions can return non-HTML 404s; try next version.
        if (res.status === 404) {
          lastErr = new Error('Google Ads endpoint not found for ' + ver);
          continue; // try next version
        }
        // 403 "API not enabled" — no point trying other versions
        if (res.status === 403 && errText.includes('Enable it by visiting')) {
          const m = errText.match(/https:\/\/console\.developers\.google\.com\/[^\s"]+/);
          const enableUrl = m ? m[0] : 'https://console.developers.google.com/apis/api/googleads.googleapis.com/overview';
          return {
            ok: false,
            apiVersion: null,
            error: 'Google Ads API is not enabled in your Google Cloud project. Enable it at: ' + enableUrl,
            attempts,
          };
        }
        lastErr = new Error('Google Ads search failed (' + ver + '): ' + res.status + ' ' + bodySnippet);
        break; // do not mask query/auth errors by falling back to older API versions
      }

      attempts.push({ version: ver, url, ok: true, status: res.status, contentType, bodySnippet: null });

      // searchStream returns an array of batch objects, each with a results array
      const data = await res.json();
      const results = [];
      if (Array.isArray(data)) {
        for (const batch of data) {
          const rows = batch && Array.isArray(batch.results) ? batch.results : [];
          for (const r of rows) results.push(r);
        }
      } else if (data && Array.isArray(data.results)) {
        for (const r of data.results) results.push(r);
      }

      return { ok: true, apiVersion: ver, results, attempts };
    } catch (e) {
      const msg = e && e.message ? String(e.message) : 'request_failed';
      attempts.push({
        version: ver,
        url,
        ok: false,
        status: null,
        contentType: null,
        bodySnippet: msg.slice(0, 380),
      });
      lastErr = e;
    }
  }

  return {
    ok: false,
    apiVersion: null,
    error: (lastErr && lastErr.message) ? String(lastErr.message).slice(0, 380) : 'Google Ads search failed',
    attempts,
  };
}

async function fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken }) {
  const query = 'SELECT customer.time_zone, customer.currency_code FROM customer LIMIT 1';
  const out = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query });
  if (!out || !out.ok) {
    return { ok: false, error: (out && out.error) ? out.error : 'Google Ads customer meta query failed', attempts: out && out.attempts ? out.attempts : [] };
  }
  const rows = out.results;
  const first = rows && rows[0] ? rows[0] : null;
  const customer = first && first.customer ? first.customer : null;
  return {
    ok: true,
    apiVersion: out.apiVersion || null,
    attempts: out.attempts || [],
    timeZone: customer && customer.timeZone ? String(customer.timeZone) : null,
    currencyCode: customer && customer.currencyCode ? String(customer.currencyCode) : null,
  };
}

async function syncGoogleAdsSpendHourly(options = {}) {
  try {
    const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
    const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;

    if (!rangeStartTs || !rangeEndTs || !Number.isFinite(rangeStartTs) || !Number.isFinite(rangeEndTs)) {
      return { ok: false, error: 'Missing rangeStartTs/rangeEndTs' };
    }

    const adsDb = getAdsDb();
    if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

    const developerToken = (config.googleAdsDeveloperToken || '').trim();
    if (!developerToken) return { ok: false, error: 'Missing GOOGLE_ADS_DEVELOPER_TOKEN' };

    if (!config.googleClientId || !config.googleClientSecret) {
      return { ok: false, error: 'Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' };
    }

    const cfg = await getGoogleAdsConfig(options.shop);
    const { customerId, loginCustomerId } = getResolvedCustomerIds(cfg);
    if (!customerId) return { ok: false, error: 'Missing GOOGLE_ADS_CUSTOMER_ID or customer_id in OAuth config' };
    const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
    if (!refreshToken) return { ok: false, error: getMissingRefreshTokenError() };

    const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);

    const meta = await fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken });
    if (!meta || !meta.ok) {
      return {
        ok: false,
        stage: 'customer_meta',
        error: meta && meta.error ? String(meta.error) : 'Google Ads customer meta query failed',
        attempts: meta && meta.attempts ? meta.attempts : [],
      };
    }

    const accountTz = meta.timeZone || 'UTC';
    const accountCur = fx.normalizeCurrency(meta.currencyCode) || 'GBP';

    const startYmd = fmtYmdInTz(rangeStartTs, accountTz);
    const endYmd = fmtYmdInTz(rangeEndTs - 1, accountTz);
    if (!startYmd || !endYmd) return { ok: false, error: 'Failed to compute date range in account time zone' };

    const query =
      "SELECT segments.date, segments.hour, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value " +
      "FROM campaign " +
      `WHERE segments.date >= '${startYmd}' AND segments.date <= '${endYmd}' AND campaign.status != 'REMOVED'`;

    const out = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint: meta.apiVersion || '' });
    if (!out || !out.ok) {
      return {
        ok: false,
        stage: 'spend_query',
        error: out && out.error ? String(out.error) : 'Google Ads spend query failed',
        attempts: out && out.attempts ? out.attempts : [],
      };
    }
    const rows = out.results;

    const ratesToGbp = await fx.getRatesToGbp();

  const grouped = new Map();
  for (const r of rows || []) {
    const seg = r && r.segments ? r.segments : null;
    const dateStr = seg && seg.date ? String(seg.date) : '';
    const hour = seg && seg.hour != null ? Number(seg.hour) : null;
    const camp = r && r.campaign ? r.campaign : null;
    const metrics = r && r.metrics ? r.metrics : null;

    const campaignId = camp && camp.id != null ? String(camp.id) : '';
    const campaignName = camp && camp.name != null ? String(camp.name) : '';
    const campaignStatus = camp && camp.status ? String(camp.status) : '';
    const channelType = camp && camp.advertisingChannelType ? String(camp.advertisingChannelType) : '';
    const adgroupId = '_all_';
    const adgroupName = '';
    if (!dateStr || hour == null || !campaignId) continue;

    const hourUtcMs = localYmdHourToUtcMs(dateStr, hour, accountTz);
    if (!hourUtcMs || !Number.isFinite(hourUtcMs)) continue;
    if (hourUtcMs < rangeStartTs || hourUtcMs >= rangeEndTs) continue;

    const costMicros = metrics && metrics.costMicros != null ? Number(metrics.costMicros) : 0;
    const clicks = metrics && metrics.clicks != null ? Number(metrics.clicks) : 0;
    const impressions = metrics && metrics.impressions != null ? Number(metrics.impressions) : 0;
    const conversions = metrics && metrics.conversions != null ? Number(metrics.conversions) : 0;
    const conversionsValue = metrics && metrics.conversionsValue != null ? Number(metrics.conversionsValue) : 0;

    const cost = Number.isFinite(costMicros) ? costMicros : 0;
    const spend = cost / 1_000_000;
    const spendGbp = fx.convertToGbp(spend, accountCur, ratesToGbp);
    const convValGbp = fx.convertToGbp(Number.isFinite(conversionsValue) ? conversionsValue : 0, accountCur, ratesToGbp);

    const key = String(hourUtcMs) + '\0' + campaignId + '\0' + adgroupId;
    const cur = grouped.get(key) || {
      hourUtcMs,
      campaignId,
      campaignName: '',
      campaignStatus: '',
      adgroupId,
      adgroupName: '',
      costMicros: 0,
      spendGbp: 0,
      clicks: 0,
      impressions: 0,
      conversions: 0,
      conversionsValueGbp: 0,
    };
    if (campaignName && !cur.campaignName) cur.campaignName = campaignName;
    if (campaignStatus && !cur.campaignStatus) cur.campaignStatus = campaignStatus;
    if (adgroupName && !cur.adgroupName) cur.adgroupName = adgroupName;
    cur.costMicros += cost;
    cur.spendGbp += (typeof spendGbp === 'number' && Number.isFinite(spendGbp)) ? spendGbp : 0;
    cur.clicks += Number.isFinite(clicks) ? clicks : 0;
    cur.impressions += Number.isFinite(impressions) ? impressions : 0;
    cur.conversions += Number.isFinite(conversions) ? conversions : 0;
    cur.conversionsValueGbp += (typeof convValGbp === 'number' && Number.isFinite(convValGbp)) ? convValGbp : 0;
    grouped.set(key, cur);
  }

  const now = Date.now();
  let upserts = 0;
  for (const v of grouped.values()) {
    const spendGbp = Math.round((Number(v.spendGbp) || 0) * 100) / 100;
    const clicks = Math.max(0, Math.floor(Number(v.clicks) || 0));
    const impressions = Math.max(0, Math.floor(Number(v.impressions) || 0));
    const costMicros = Math.max(0, Math.floor(Number(v.costMicros) || 0));
    const conv = Math.round((Number(v.conversions) || 0) * 100) / 100;
    const convVal = Math.round((Number(v.conversionsValueGbp) || 0) * 100) / 100;

    await adsDb.run(
      `
        INSERT INTO google_ads_spend_hourly (provider, hour_ts, customer_id, campaign_id, adgroup_id, cost_micros, spend_gbp, clicks, impressions, campaign_name, campaign_status, adgroup_name, conversions, conversions_value_gbp, updated_at)
        VALUES (?, TO_TIMESTAMP(?/1000.0), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider, hour_ts, campaign_id, adgroup_id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id,
          cost_micros = EXCLUDED.cost_micros,
          spend_gbp = EXCLUDED.spend_gbp,
          clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          campaign_name = COALESCE(NULLIF(EXCLUDED.campaign_name, ''), google_ads_spend_hourly.campaign_name),
          campaign_status = COALESCE(NULLIF(EXCLUDED.campaign_status, ''), google_ads_spend_hourly.campaign_status),
          adgroup_name = COALESCE(NULLIF(EXCLUDED.adgroup_name, ''), google_ads_spend_hourly.adgroup_name),
          conversions = EXCLUDED.conversions,
          conversions_value_gbp = EXCLUDED.conversions_value_gbp,
          updated_at = EXCLUDED.updated_at
      `,
      ['google_ads', v.hourUtcMs, customerId, v.campaignId, v.adgroupId, costMicros, spendGbp, clicks, impressions, v.campaignName || '', v.campaignStatus || '', v.adgroupName || '', conv, convVal, now]
    );
    upserts++;
  }

    return {
      ok: true,
      rangeStartTs,
      rangeEndTs,
      provider: 'google_ads',
      apiVersion: out.apiVersion || meta.apiVersion || null,
      customerId,
      loginCustomerId: loginCustomerId || null,
      accountTimeZone: accountTz,
      accountCurrency: accountCur,
      scannedRows: Array.isArray(rows) ? rows.length : 0,
      scannedGroups: grouped.size,
      upserts,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message).slice(0, 380) : 'spend_sync_failed' };
  }
}

async function syncGoogleAdsGeoDaily(options = {}) {
  try {
    const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
    const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;

    if (!rangeStartTs || !rangeEndTs || !Number.isFinite(rangeStartTs) || !Number.isFinite(rangeEndTs)) {
      return { ok: false, error: 'Missing rangeStartTs/rangeEndTs' };
    }

    const adsDb = getAdsDb();
    if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

    const developerToken = (config.googleAdsDeveloperToken || '').trim();
    if (!developerToken) return { ok: false, error: 'Missing GOOGLE_ADS_DEVELOPER_TOKEN' };

    if (!config.googleClientId || !config.googleClientSecret) {
      return { ok: false, error: 'Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' };
    }

    const cfg = await getGoogleAdsConfig(options.shop);
    const { customerId, loginCustomerId } = getResolvedCustomerIds(cfg);
    if (!customerId) return { ok: false, error: 'Missing GOOGLE_ADS_CUSTOMER_ID or customer_id in OAuth config' };
    const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
    if (!refreshToken) return { ok: false, error: getMissingRefreshTokenError() };

    const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);

    const meta = await fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken });
    if (!meta || !meta.ok) {
      return {
        ok: false,
        stage: 'customer_meta',
        error: meta && meta.error ? String(meta.error) : 'Google Ads customer meta query failed',
        attempts: meta && meta.attempts ? meta.attempts : [],
      };
    }

    const accountTz = meta.timeZone || 'UTC';
    const accountCur = fx.normalizeCurrency(meta.currencyCode) || 'GBP';

    const startYmd = fmtYmdInTz(rangeStartTs, accountTz);
    const endYmd = fmtYmdInTz(rangeEndTs - 1, accountTz);
    if (!startYmd || !endYmd) return { ok: false, error: 'Failed to compute date range in account time zone' };

    const query =
      "SELECT segments.date, campaign.id, campaign.name, geographic_view.country_criterion_id, geographic_view.location_type, " +
      "metrics.cost_micros, metrics.clicks, metrics.impressions " +
      "FROM geographic_view " +
      `WHERE segments.date >= '${startYmd}' AND segments.date <= '${endYmd}'`;

    const out = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint: meta.apiVersion || '' });
    if (!out || !out.ok) {
      return {
        ok: false,
        stage: 'geo_query',
        error: out && out.error ? String(out.error) : 'Google Ads geographic_view query failed',
        attempts: out && out.attempts ? out.attempts : [],
      };
    }

    const rows = out.results || [];
    const ratesToGbp = await fx.getRatesToGbp();

    const grouped = new Map();
    const criterionIds = new Set();
    for (const r of rows || []) {
      const seg = r && r.segments ? r.segments : null;
      const dayYmd = seg && seg.date ? String(seg.date) : '';
      const camp = r && r.campaign ? r.campaign : null;
      const gv = r && r.geographicView ? r.geographicView : null;
      const metrics = r && r.metrics ? r.metrics : null;

      const campaignId = camp && camp.id != null ? String(camp.id) : '';
      const campaignName = camp && camp.name != null ? String(camp.name) : '';
      const countryCriterionIdRaw = gv && gv.countryCriterionId != null ? String(gv.countryCriterionId) : '';
      const countryCriterionId = countryCriterionIdRaw.replace(/[^0-9]/g, '');
      const locationType = gv && gv.locationType ? String(gv.locationType) : '';
      if (!dayYmd || !campaignId || !countryCriterionId || !locationType) continue;

      const costMicros = metrics && metrics.costMicros != null ? Number(metrics.costMicros) : 0;
      const clicks = metrics && metrics.clicks != null ? Number(metrics.clicks) : 0;
      const impressions = metrics && metrics.impressions != null ? Number(metrics.impressions) : 0;

      const cost = Number.isFinite(costMicros) ? costMicros : 0;
      const cl = Number.isFinite(clicks) ? clicks : 0;
      const im = Number.isFinite(impressions) ? impressions : 0;

      const key = dayYmd + '\0' + campaignId + '\0' + countryCriterionId + '\0' + locationType;
      const cur = grouped.get(key) || {
        dayYmd,
        campaignId,
        campaignName: '',
        countryCriterionId,
        locationType,
        costMicros: 0,
        clicks: 0,
        impressions: 0,
      };
      if (campaignName && !cur.campaignName) cur.campaignName = campaignName;
      cur.costMicros += cost;
      cur.clicks += cl;
      cur.impressions += im;
      grouped.set(key, cur);
      criterionIds.add(countryCriterionId);
    }

    function chunkArray(list, size) {
      const arr = Array.isArray(list) ? list : [];
      const n = Math.max(1, Math.min(200, Math.floor(Number(size) || 0) || 0)) || 80;
      const out = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    }

    // Fetch geo_target_constant mappings (criterion id -> ISO2 country code)
    const idToCountryCode = new Map();
    const idsList = Array.from(criterionIds).map((id) => String(id).replace(/[^0-9]/g, '')).filter(Boolean);
    for (const chunk of chunkArray(idsList, 80)) {
      if (!chunk.length) continue;
      const query =
        "SELECT geo_target_constant.id, geo_target_constant.country_code, geo_target_constant.name, geo_target_constant.target_type " +
        "FROM geo_target_constant " +
        `WHERE geo_target_constant.id IN (${chunk.join(', ')})`;
      const out2 = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint: out.apiVersion || meta.apiVersion || '' });
      if (!out2 || !out2.ok) {
        return {
          ok: false,
          stage: 'geo_target_constant',
          error: out2 && out2.error ? String(out2.error) : 'geo_target_constant query failed',
          attempts: out2 && out2.attempts ? out2.attempts : [],
        };
      }
      for (const r of out2.results || []) {
        const gtc = r && r.geoTargetConstant ? r.geoTargetConstant : null;
        const id = gtc && gtc.id != null ? String(gtc.id).replace(/[^0-9]/g, '') : '';
        const cc = gtc && gtc.countryCode ? String(gtc.countryCode).trim().toUpperCase() : '';
        if (!id) continue;
        if (cc && cc.length === 2) idToCountryCode.set(id, cc);
      }
    }

    const now = Date.now();
    let upserts = 0;
    for (const v of grouped.values()) {
      const spend = (Number(v.costMicros) || 0) / 1_000_000;
      const spendGbp = fx.convertToGbp(spend, accountCur, ratesToGbp);
      const spendGbpRounded = (typeof spendGbp === 'number' && Number.isFinite(spendGbp)) ? Math.round(spendGbp * 100) / 100 : 0;
      const clicks = Math.max(0, Math.floor(Number(v.clicks) || 0));
      const impressions = Math.max(0, Math.floor(Number(v.impressions) || 0));
      const costMicros = Math.max(0, Math.floor(Number(v.costMicros) || 0));
      const countryCode = idToCountryCode.get(String(v.countryCriterionId)) || null;

      await adsDb.run(
        `
          INSERT INTO google_ads_geo_daily
            (provider, day_ymd, customer_id, campaign_id, campaign_name, country_criterion_id, country_code, location_type, cost_micros, spend_gbp, clicks, impressions, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (provider, day_ymd, campaign_id, country_criterion_id, location_type) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            campaign_name = COALESCE(NULLIF(EXCLUDED.campaign_name, ''), google_ads_geo_daily.campaign_name),
            country_code = COALESCE(NULLIF(EXCLUDED.country_code, ''), google_ads_geo_daily.country_code),
            cost_micros = EXCLUDED.cost_micros,
            spend_gbp = EXCLUDED.spend_gbp,
            clicks = EXCLUDED.clicks,
            impressions = EXCLUDED.impressions,
            updated_at = EXCLUDED.updated_at
        `,
        [
          'google_ads',
          v.dayYmd,
          customerId,
          v.campaignId,
          v.campaignName || '',
          v.countryCriterionId,
          countryCode,
          v.locationType,
          costMicros,
          spendGbpRounded,
          clicks,
          impressions,
          now,
        ]
      );
      upserts++;
    }

    return {
      ok: true,
      rangeStartTs,
      rangeEndTs,
      provider: 'google_ads',
      apiVersion: out.apiVersion || meta.apiVersion || null,
      customerId,
      loginCustomerId: loginCustomerId || null,
      accountTimeZone: accountTz,
      accountCurrency: accountCur,
      scannedRows: Array.isArray(rows) ? rows.length : 0,
      scannedGroups: grouped.size,
      mappedCountries: idToCountryCode.size,
      upserts,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message).slice(0, 380) : 'geo_sync_failed' };
  }
}

async function syncGoogleAdsDeviceDaily(options = {}) {
  try {
    const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
    const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;

    if (!rangeStartTs || !rangeEndTs || !Number.isFinite(rangeStartTs) || !Number.isFinite(rangeEndTs)) {
      return { ok: false, error: 'Missing rangeStartTs/rangeEndTs' };
    }

    const adsDb = getAdsDb();
    if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

    const developerToken = (config.googleAdsDeveloperToken || '').trim();
    if (!developerToken) return { ok: false, error: 'Missing GOOGLE_ADS_DEVELOPER_TOKEN' };

    if (!config.googleClientId || !config.googleClientSecret) {
      return { ok: false, error: 'Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' };
    }

    const cfg = await getGoogleAdsConfig(options.shop);
    const { customerId, loginCustomerId } = getResolvedCustomerIds(cfg);
    if (!customerId) return { ok: false, error: 'Missing GOOGLE_ADS_CUSTOMER_ID or customer_id in OAuth config' };
    const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
    if (!refreshToken) return { ok: false, error: getMissingRefreshTokenError() };

    const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);

    const meta = await fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken });
    if (!meta || !meta.ok) {
      return {
        ok: false,
        stage: 'customer_meta',
        error: meta && meta.error ? String(meta.error) : 'Google Ads customer meta query failed',
        attempts: meta && meta.attempts ? meta.attempts : [],
      };
    }

    const accountTz = meta.timeZone || 'UTC';
    const accountCur = fx.normalizeCurrency(meta.currencyCode) || 'GBP';

    const startYmd = fmtYmdInTz(rangeStartTs, accountTz);
    const endYmd = fmtYmdInTz(rangeEndTs - 1, accountTz);
    if (!startYmd || !endYmd) return { ok: false, error: 'Failed to compute date range in account time zone' };

    const query =
      "SELECT segments.date, segments.device, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions " +
      "FROM campaign " +
      `WHERE segments.date >= '${startYmd}' AND segments.date <= '${endYmd}'`;

    const out = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint: meta.apiVersion || '' });
    if (!out || !out.ok) {
      return {
        ok: false,
        stage: 'device_query',
        error: out && out.error ? String(out.error) : 'Google Ads device query failed',
        attempts: out && out.attempts ? out.attempts : [],
      };
    }

    const rows = out.results || [];
    const ratesToGbp = await fx.getRatesToGbp();

    const grouped = new Map();
    for (const r of rows || []) {
      const seg = r && r.segments ? r.segments : null;
      const dayYmd = seg && seg.date ? String(seg.date) : '';
      const device = seg && seg.device ? String(seg.device) : '';

      const camp = r && r.campaign ? r.campaign : null;
      const metrics = r && r.metrics ? r.metrics : null;

      const campaignId = camp && camp.id != null ? String(camp.id) : '';
      const campaignName = camp && camp.name != null ? String(camp.name) : '';
      if (!dayYmd || !campaignId || !device) continue;

      const costMicros = metrics && metrics.costMicros != null ? Number(metrics.costMicros) : 0;
      const clicks = metrics && metrics.clicks != null ? Number(metrics.clicks) : 0;
      const impressions = metrics && metrics.impressions != null ? Number(metrics.impressions) : 0;

      const cost = Number.isFinite(costMicros) ? costMicros : 0;
      const cl = Number.isFinite(clicks) ? clicks : 0;
      const im = Number.isFinite(impressions) ? impressions : 0;

      const key = dayYmd + '\0' + campaignId + '\0' + device;
      const cur = grouped.get(key) || {
        dayYmd,
        campaignId,
        campaignName: '',
        device,
        costMicros: 0,
        clicks: 0,
        impressions: 0,
      };
      if (campaignName && !cur.campaignName) cur.campaignName = campaignName;
      cur.costMicros += cost;
      cur.clicks += cl;
      cur.impressions += im;
      grouped.set(key, cur);
    }

    const now = Date.now();
    let upserts = 0;
    for (const v of grouped.values()) {
      const spend = (Number(v.costMicros) || 0) / 1_000_000;
      const spendGbp = fx.convertToGbp(spend, accountCur, ratesToGbp);
      const spendGbpRounded = (typeof spendGbp === 'number' && Number.isFinite(spendGbp)) ? Math.round(spendGbp * 100) / 100 : 0;
      const clicks = Math.max(0, Math.floor(Number(v.clicks) || 0));
      const impressions = Math.max(0, Math.floor(Number(v.impressions) || 0));
      const costMicros = Math.max(0, Math.floor(Number(v.costMicros) || 0));

      await adsDb.run(
        `
          INSERT INTO google_ads_device_daily
            (provider, day_ymd, customer_id, campaign_id, campaign_name, device, cost_micros, spend_gbp, clicks, impressions, updated_at)
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (provider, day_ymd, campaign_id, device) DO UPDATE SET
            customer_id = EXCLUDED.customer_id,
            campaign_name = COALESCE(NULLIF(EXCLUDED.campaign_name, ''), google_ads_device_daily.campaign_name),
            cost_micros = EXCLUDED.cost_micros,
            spend_gbp = EXCLUDED.spend_gbp,
            clicks = EXCLUDED.clicks,
            impressions = EXCLUDED.impressions,
            updated_at = EXCLUDED.updated_at
        `,
        [
          'google_ads',
          v.dayYmd,
          customerId,
          v.campaignId,
          v.campaignName || '',
          v.device,
          costMicros,
          spendGbpRounded,
          clicks,
          impressions,
          now,
        ]
      );
      upserts++;
    }

    return {
      ok: true,
      rangeStartTs,
      rangeEndTs,
      provider: 'google_ads',
      apiVersion: out.apiVersion || meta.apiVersion || null,
      customerId,
      loginCustomerId: loginCustomerId || null,
      accountTimeZone: accountTz,
      accountCurrency: accountCur,
      scannedRows: Array.isArray(rows) ? rows.length : 0,
      scannedGroups: grouped.size,
      upserts,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message).slice(0, 380) : 'device_sync_failed' };
  }
}

function extractGclid(url) {
  if (!url) return null;
  try {
    const m = String(url).match(/[?&]gclid=([^&]+)/);
    return m ? decodeURIComponent(m[1]).trim() : null;
  } catch (_) { return null; }
}

function extractParam(url, key) {
  if (!url || !key) return null;
  const k = String(key).trim();
  if (!k) return null;
  try {
    const re = new RegExp('[?&]' + k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '=([^&]+)');
    const m = String(url).match(re);
    return m ? decodeURIComponent(m[1]).trim() : null;
  } catch (_) {
    return null;
  }
}

function extractClickIds(url) {
  return {
    gclid: extractParam(url, 'gclid'),
    gbraid: extractParam(url, 'gbraid'),
    wbraid: extractParam(url, 'wbraid'),
  };
}

async function backfillCampaignIdsFromGclid(options = {}) {
  try {
    const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
    const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;
    if (!rangeStartTs || !rangeEndTs) return { ok: false, error: 'Missing range' };

    const db = getDb();
    if (!db) return { ok: false, error: 'Main DB not available' };

    const adsDb = getAdsDb();
    if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

    const developerToken = (config.googleAdsDeveloperToken || '').trim();
    if (!developerToken) return { ok: false, error: 'Missing Google Ads credentials' };

    const cfg = await getGoogleAdsConfig(options.shop);
    const { customerId, loginCustomerId } = getResolvedCustomerIds(cfg);
    if (!customerId) return { ok: false, error: 'Missing GOOGLE_ADS_CUSTOMER_ID or customer_id in OAuth config' };
    const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
    if (!refreshToken) return { ok: false, error: getMissingRefreshTokenError() };

    const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);
    const apiVersion = options.apiVersion || '';

    // Step 0: Repair any sessions previously backfilled with bs_source='google' (should be 'googleads')
    await db.run(
      `UPDATE sessions SET bs_source = ? WHERE LOWER(TRIM(bs_source)) = ? AND NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL`,
      ['googleads', 'google']
    );

    // Step 1: Find sessions with a click id in entry_url but no bs_campaign_id
    const sessions = await db.all(
      `SELECT session_id, entry_url, started_at FROM sessions
       WHERE (entry_url LIKE ? OR entry_url LIKE ? OR entry_url LIKE ?)
         AND (bs_campaign_id IS NULL OR TRIM(bs_campaign_id) = '')
         AND started_at >= ? AND started_at < ?
       LIMIT 5000`,
      ['%gclid=%', '%gbraid=%', '%wbraid=%', rangeStartTs, rangeEndTs]
    );

    if (!sessions || !sessions.length) {
      return { ok: true, sessionsScanned: 0, updated: 0, message: 'No sessions with click ids need backfill' };
    }

    // Step 2: Extract click ids (gclid/gbraid/wbraid)
    const clickIdToSessions = new Map(); // clickId -> sessionIds[]
    const sessionIdToClickIds = new Map(); // sessionId -> clickIds[]
    const gclidIds = new Set();
    const braidIds = new Set();
    for (const s of sessions) {
      const ids = extractClickIds(s && s.entry_url ? s.entry_url : '');
      const sid = s && s.session_id != null ? String(s.session_id) : '';
      if (!sid) continue;
      const clickIds = [];
      for (const k of ['gclid', 'gbraid', 'wbraid']) {
        const v = ids && ids[k] ? String(ids[k]).trim() : '';
        if (!v) continue;
        clickIds.push(v);
        const arr = clickIdToSessions.get(v) || [];
        arr.push(sid);
        clickIdToSessions.set(v, arr);
        if (k === 'gclid') gclidIds.add(v);
        else braidIds.add(v);
      }
      if (clickIds.length) sessionIdToClickIds.set(sid, clickIds);
    }

    if (!clickIdToSessions.size) {
      return { ok: true, sessionsScanned: sessions.length, updated: 0, message: 'No valid click ids extracted' };
    }

    // Step 3: Query click_view from Google Ads API (ClickView requires a single-day filter).
    const meta = await fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken });
    const accountTz = (meta && meta.ok && meta.timeZone) ? meta.timeZone : 'UTC';
    const startYmd = fmtYmdInTz(rangeStartTs, accountTz);
    const endYmd = fmtYmdInTz(rangeEndTs - 1, accountTz);
    if (!startYmd || !endYmd) {
      return {
        ok: false,
        stage: 'click_view',
        sessionsScanned: sessions.length,
        clickIdsCount: clickIdToSessions.size,
        gclidCount: gclidIds.size,
        braidCount: braidIds.size,
        error: 'Failed to compute date range in Ads account time zone',
      };
    }

    function gaqlStringLiteral(value) {
      const s = value != null ? String(value) : '';
      // GAQL supports single-quoted strings; escape single quotes by doubling.
      return "'" + s.replace(/'/g, "''") + "'";
    }

    function chunkArray(list, size) {
      const arr = Array.isArray(list) ? list : [];
      const n = Math.max(1, Math.min(200, Math.floor(Number(size) || 0) || 0)) || 80;
      const out = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    }

    function ymdRangeInclusive(a, b, maxDays) {
      const out = [];
      const aa = String(a || '').trim();
      const bb = String(b || '').trim();
      const start = Date.parse(aa + 'T00:00:00Z');
      const end = Date.parse(bb + 'T00:00:00Z');
      if (!Number.isFinite(start) || !Number.isFinite(end)) return out;
      const limit = (typeof maxDays === 'number' && Number.isFinite(maxDays)) ? Math.max(1, Math.min(366, Math.trunc(maxDays))) : 62;
      const step = 86400000;
      let cur = start;
      for (let i = 0; i < limit && cur <= end; i++) {
        out.push(new Date(cur).toISOString().slice(0, 10));
        cur += step;
      }
      return out;
    }

    const apiHint = apiVersion || (meta && meta.apiVersion) || '';

    // Step 4: Build click_id → campaign map (best-effort: gclid only via ClickView).
    const clickIdCampaignMap = new Map(); // gclid -> { campaignId, adgroupId }
    let clickViewRows = 0;
    let usedApiVersion = null;

    // First pass: bucket gclids by the session start day (in Ads account time zone).
    const dayToGclids = new Map(); // YYYY-MM-DD -> Set(gclid)
    for (const s of sessions) {
      const sid = s && s.session_id != null ? String(s.session_id) : '';
      if (!sid) continue;
      const clickIds = sessionIdToClickIds.get(sid) || [];
      if (!clickIds.length) continue;
      const startedAt = (s && s.started_at != null) ? Number(s.started_at) : NaN;
      const dayYmd = (Number.isFinite(startedAt) && startedAt > 0) ? (fmtYmdInTz(startedAt, accountTz) || startYmd) : startYmd;
      if (!dayYmd) continue;
      let set = dayToGclids.get(dayYmd);
      if (!set) { set = new Set(); dayToGclids.set(dayYmd, set); }
      for (const id of clickIds) {
        if (!gclidIds.has(id)) continue;
        set.add(id);
      }
    }

    const dayKeys = Array.from(dayToGclids.keys()).sort();
    for (const dayYmd of dayKeys) {
      const ids = Array.from(dayToGclids.get(dayYmd) || []);
      if (!ids.length) continue;
      for (const chunk of chunkArray(ids, 80)) {
        const query =
          "SELECT click_view.gclid, campaign.id, ad_group.id " +
          "FROM click_view " +
          `WHERE segments.date = ${gaqlStringLiteral(dayYmd)} AND click_view.gclid IN (${chunk.map(gaqlStringLiteral).join(', ')})`;
        const out = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint: apiHint });
        if (!out || !out.ok) {
          return {
            ok: false,
            stage: 'click_view',
            sessionsScanned: sessions.length,
            clickIdsCount: clickIdToSessions.size,
            gclidCount: gclidIds.size,
            braidCount: braidIds.size,
            day: dayYmd,
            error: (out && out.error) ? String(out.error).slice(0, 300) : 'click_view query failed',
            attempts: (out && out.attempts) ? out.attempts : undefined,
          };
        }
        if (!usedApiVersion && out.apiVersion) usedApiVersion = out.apiVersion;
        clickViewRows += Array.isArray(out.results) ? out.results.length : 0;
        for (const r of out.results || []) {
          const cv = r && r.clickView ? r.clickView : null;
          const gclid = cv && cv.gclid ? String(cv.gclid).trim() : '';
          const campId = r && r.campaign && r.campaign.id != null ? String(r.campaign.id) : '';
          const agId = r && r.adGroup && r.adGroup.id != null ? String(r.adGroup.id) : '_all_';
          if (!gclid || !campId) continue;
          if (!clickIdCampaignMap.has(gclid)) {
            clickIdCampaignMap.set(gclid, { campaignId: campId, adgroupId: agId });
          }
        }
      }
    }

    // Second pass: for any remaining gclids, scan each day in the selected range.
    const remaining = new Set();
    for (const id of gclidIds) {
      if (!clickIdCampaignMap.has(id)) remaining.add(id);
    }
    if (remaining.size) {
      const daysInRange = ymdRangeInclusive(startYmd, endYmd, 62);
      for (const dayYmd of daysInRange) {
        if (!remaining.size) break;
        const ids = Array.from(remaining);
        for (const chunk of chunkArray(ids, 80)) {
          const query =
            "SELECT click_view.gclid, campaign.id, ad_group.id " +
            "FROM click_view " +
            `WHERE segments.date = ${gaqlStringLiteral(dayYmd)} AND click_view.gclid IN (${chunk.map(gaqlStringLiteral).join(', ')})`;
          const out = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, apiVersionHint: apiHint });
          if (!out || !out.ok) {
            return {
              ok: false,
              stage: 'click_view',
              sessionsScanned: sessions.length,
              clickIdsCount: clickIdToSessions.size,
              gclidCount: gclidIds.size,
              braidCount: braidIds.size,
              day: dayYmd,
              error: (out && out.error) ? String(out.error).slice(0, 300) : 'click_view query failed',
              attempts: (out && out.attempts) ? out.attempts : undefined,
            };
          }
          if (!usedApiVersion && out.apiVersion) usedApiVersion = out.apiVersion;
          clickViewRows += Array.isArray(out.results) ? out.results.length : 0;
          for (const r of out.results || []) {
            const cv = r && r.clickView ? r.clickView : null;
            const gclid = cv && cv.gclid ? String(cv.gclid).trim() : '';
            const campId = r && r.campaign && r.campaign.id != null ? String(r.campaign.id) : '';
            const agId = r && r.adGroup && r.adGroup.id != null ? String(r.adGroup.id) : '_all_';
            if (!gclid || !campId) continue;
            if (!clickIdCampaignMap.has(gclid)) {
              clickIdCampaignMap.set(gclid, { campaignId: campId, adgroupId: agId });
            }
            if (remaining.has(gclid)) remaining.delete(gclid);
          }
        }
      }
    }

    // Step 4b: Persist click_id→campaign mappings to ads DB cache for order attribution
    const cacheNow = Date.now();
    for (const [clickId, mapping] of clickIdCampaignMap) {
      try {
        await adsDb.run(
          `INSERT INTO gclid_campaign_cache (gclid, campaign_id, adgroup_id, cached_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (gclid) DO UPDATE SET campaign_id = EXCLUDED.campaign_id, adgroup_id = EXCLUDED.adgroup_id, cached_at = EXCLUDED.cached_at`,
          [clickId, mapping.campaignId, mapping.adgroupId, cacheNow]
        );
      } catch (_) {}
    }

    // Step 5: Update sessions
    let updated = 0;
    for (const [clickId, sessionIds] of clickIdToSessions) {
      const mapping = clickIdCampaignMap.get(clickId);
      if (!mapping) continue;

      for (const sessionId of sessionIds) {
        await db.run(
          `UPDATE sessions SET
             bs_source = COALESCE(NULLIF(TRIM(bs_source), ''), ?),
             bs_campaign_id = ?,
             bs_adgroup_id = COALESCE(NULLIF(TRIM(bs_adgroup_id), ''), ?)
           WHERE session_id = ? AND (bs_campaign_id IS NULL OR TRIM(bs_campaign_id) = '')`,
          ['googleads', mapping.campaignId, mapping.adgroupId, sessionId]
        );
        updated++;
      }
    }

    return {
      ok: true,
      sessionsScanned: sessions.length,
      clickIdsCount: clickIdToSessions.size,
      gclidCount: gclidIds.size,
      braidCount: braidIds.size,
      apiVersion: usedApiVersion || null,
      clickViewRows,
      clickIdsMapped: clickIdCampaignMap.size,
      gclidsMapped: clickIdCampaignMap.size,
      gclidsUnmapped: (typeof remaining !== 'undefined' && remaining && typeof remaining.size === 'number') ? remaining.size : undefined,
      updated,
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? String(e.message).slice(0, 380) : 'gclid_backfill_failed' };
  }
}

module.exports = {
  syncGoogleAdsSpendHourly,
  syncGoogleAdsGeoDaily,
  syncGoogleAdsDeviceDaily,
  backfillCampaignIdsFromGclid,
  testGoogleAdsConnection,
  getApiVersionsToTry,
  fetchAccessTokenFromRefreshToken,
  googleAdsSearch,
};
