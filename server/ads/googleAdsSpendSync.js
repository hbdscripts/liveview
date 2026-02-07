const config = require('../config');
const fx = require('../fx');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig } = require('./adsStore');

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

async function googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, pageSize = 10000 }) {
  const versionsRaw = [
    (config.googleAdsApiVersion || '').trim(),
    'v19',
    'v18',
    'v17',
  ].filter(Boolean);
  const versions = Array.from(new Set(versionsRaw));

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);

  let lastErr = null;
  for (const ver of versions) {
    const url = `https://googleads.googleapis.com/${encodeURIComponent(ver)}/customers/${encodeURIComponent(customerId)}/googleAds:search`;

    try {
      let completed = false;
      let pageToken = null;
      const results = [];
      while (true) {
        const body = { query, pageSize };
        if (pageToken) body.pageToken = pageToken;

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errText = await res.text();
          if (isLikelyDeprecatedEndpoint404(res, errText)) {
            lastErr = new Error('Google Ads endpoint not found for ' + ver);
            break;
          }
          throw new Error('Google Ads search failed (' + ver + '): ' + res.status + ' ' + errText);
        }

        const data = await res.json();
        const rows = data && Array.isArray(data.results) ? data.results : [];
        for (const r of rows) results.push(r);

        pageToken = data && data.nextPageToken ? String(data.nextPageToken) : '';
        if (!pageToken) {
          completed = true;
          break;
        }
      }

      if (completed) return results;
    } catch (e) {
      lastErr = e;
    }
  }

  throw (lastErr || new Error('Google Ads search failed'));
}

async function fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken }) {
  const query = 'SELECT customer.time_zone, customer.currency_code FROM customer LIMIT 1';
  const rows = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, pageSize: 1 });
  const first = rows && rows[0] ? rows[0] : null;
  const customer = first && first.customer ? first.customer : null;
  return {
    timeZone: customer && customer.timeZone ? String(customer.timeZone) : null,
    currencyCode: customer && customer.currencyCode ? String(customer.currencyCode) : null,
  };
}

async function syncGoogleAdsSpendHourly(options = {}) {
  const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
  const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;

  if (!rangeStartTs || !rangeEndTs || !Number.isFinite(rangeStartTs) || !Number.isFinite(rangeEndTs)) {
    return { ok: false, error: 'Missing rangeStartTs/rangeEndTs' };
  }

  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

  const developerToken = (config.googleAdsDeveloperToken || '').trim();
  const loginCustomerId = normalizeCustomerId(config.googleAdsLoginCustomerId);
  const customerId = normalizeCustomerId(config.googleAdsCustomerId);
  if (!developerToken) return { ok: false, error: 'Missing GOOGLE_ADS_DEVELOPER_TOKEN' };
  if (!customerId) return { ok: false, error: 'Missing GOOGLE_ADS_CUSTOMER_ID' };

  if (!config.googleClientId || !config.googleClientSecret) {
    return { ok: false, error: 'Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET' };
  }

  const cfg = await getGoogleAdsConfig();
  const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
  if (!refreshToken) return { ok: false, error: 'Google Ads not connected (missing refresh_token). Run /api/ads/google/connect' };

  const accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);

  const meta = await fetchCustomerMeta({ customerId, loginCustomerId, developerToken, accessToken });
  const accountTz = meta.timeZone || 'UTC';
  const accountCur = fx.normalizeCurrency(meta.currencyCode) || 'GBP';

  const startYmd = fmtYmdInTz(rangeStartTs, accountTz);
  const endYmd = fmtYmdInTz(rangeEndTs - 1, accountTz);
  if (!startYmd || !endYmd) return { ok: false, error: 'Failed to compute date range in account time zone' };

  const query =
    "SELECT segments.date, segments.hour, campaign.id, ad_group.id, metrics.cost_micros, metrics.clicks, metrics.impressions " +
    "FROM ad_group " +
    `WHERE segments.date >= '${startYmd}' AND segments.date <= '${endYmd}'`;

  const rows = await googleAdsSearch({ customerId, loginCustomerId, developerToken, accessToken, query, pageSize: 10000 });

  const ratesToGbp = await fx.getRatesToGbp();

  const grouped = new Map();
  for (const r of rows || []) {
    const seg = r && r.segments ? r.segments : null;
    const dateStr = seg && seg.date ? String(seg.date) : '';
    const hour = seg && seg.hour != null ? Number(seg.hour) : null;
    const camp = r && r.campaign ? r.campaign : null;
    const ag = r && r.adGroup ? r.adGroup : null;
    const metrics = r && r.metrics ? r.metrics : null;

    const campaignId = camp && camp.id != null ? String(camp.id) : '';
    const adgroupId = ag && ag.id != null ? String(ag.id) : '';
    if (!dateStr || hour == null || !campaignId || !adgroupId) continue;

    const hourUtcMs = localYmdHourToUtcMs(dateStr, hour, accountTz);
    if (!hourUtcMs || !Number.isFinite(hourUtcMs)) continue;
    if (hourUtcMs < rangeStartTs || hourUtcMs >= rangeEndTs) continue;

    const costMicros = metrics && metrics.costMicros != null ? Number(metrics.costMicros) : 0;
    const clicks = metrics && metrics.clicks != null ? Number(metrics.clicks) : 0;
    const impressions = metrics && metrics.impressions != null ? Number(metrics.impressions) : 0;

    const cost = Number.isFinite(costMicros) ? costMicros : 0;
    const spend = cost / 1_000_000;
    const spendGbp = fx.convertToGbp(spend, accountCur, ratesToGbp);

    const key = String(hourUtcMs) + '\0' + campaignId + '\0' + adgroupId;
    const cur = grouped.get(key) || {
      hourUtcMs,
      campaignId,
      adgroupId,
      costMicros: 0,
      spendGbp: 0,
      clicks: 0,
      impressions: 0,
    };
    cur.costMicros += cost;
    cur.spendGbp += (typeof spendGbp === 'number' && Number.isFinite(spendGbp)) ? spendGbp : 0;
    cur.clicks += Number.isFinite(clicks) ? clicks : 0;
    cur.impressions += Number.isFinite(impressions) ? impressions : 0;
    grouped.set(key, cur);
  }

  const now = Date.now();
  let upserts = 0;
  for (const v of grouped.values()) {
    const spendGbp = Math.round((Number(v.spendGbp) || 0) * 100) / 100;
    const clicks = Math.max(0, Math.floor(Number(v.clicks) || 0));
    const impressions = Math.max(0, Math.floor(Number(v.impressions) || 0));
    const costMicros = Math.max(0, Math.floor(Number(v.costMicros) || 0));

    await adsDb.run(
      `
        INSERT INTO google_ads_spend_hourly (provider, hour_ts, customer_id, campaign_id, adgroup_id, cost_micros, spend_gbp, clicks, impressions, updated_at)
        VALUES (?, TO_TIMESTAMP(?/1000.0), ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (provider, hour_ts, campaign_id, adgroup_id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id,
          cost_micros = EXCLUDED.cost_micros,
          spend_gbp = EXCLUDED.spend_gbp,
          clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          updated_at = EXCLUDED.updated_at
      `,
      ['google_ads', v.hourUtcMs, customerId, v.campaignId, v.adgroupId, costMicros, spendGbp, clicks, impressions, now]
    );
    upserts++;
  }

  return {
    ok: true,
    rangeStartTs,
    rangeEndTs,
    provider: 'google_ads',
    customerId,
    loginCustomerId: loginCustomerId || null,
    accountTimeZone: accountTz,
    accountCurrency: accountCur,
    scannedRows: Array.isArray(rows) ? rows.length : 0,
    scannedGroups: grouped.size,
    upserts,
  };
}

module.exports = {
  syncGoogleAdsSpendHourly,
};
