const store = require('../store');
const config = require('../config');
const { getDb } = require('../db');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig } = require('./adsStore');

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (ALLOWED_RANGE.has(r) || isDayKey || isRangeKey) return r;
  return 'today';
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

async function getStatus() {
  const adsDb = getAdsDb();
  const providerCfg = await getGoogleAdsConfig();
  const refreshToken = providerCfg && providerCfg.refresh_token ? String(providerCfg.refresh_token).trim() : '';

  const customerIdRaw = config.googleAdsCustomerId != null ? String(config.googleAdsCustomerId) : '';
  const loginCustomerIdRaw = config.googleAdsLoginCustomerId != null ? String(config.googleAdsLoginCustomerId) : '';
  const developerToken = config.googleAdsDeveloperToken != null ? String(config.googleAdsDeveloperToken).trim() : '';

  const customerId = customerIdRaw.replace(/[^0-9]/g, '').slice(0, 32);
  const loginCustomerId = loginCustomerIdRaw.replace(/[^0-9]/g, '').slice(0, 32);

  const configured = !!(adsDb && developerToken && customerId);
  const connected = !!(configured && refreshToken);

  return {
    ok: true,
    providers: [
      {
        key: 'google_ads',
        label: 'Google Ads',
        connected,
        configured,
        adsDb: !!adsDb,
        customerId: customerId || null,
        loginCustomerId: loginCustomerId || null,
        hasRefreshToken: !!refreshToken,
        hasDeveloperToken: !!developerToken,
      },
    ],
  };
}

async function getSummary(options = {}) {
  const rangeKey = normalizeRangeKey(options.rangeKey);
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  const source = options.source != null ? String(options.source).trim().toLowerCase() : 'googleads';
  const provider = options.provider != null ? String(options.provider).trim().toLowerCase() : 'google_ads';

  const adsDb = getAdsDb();
  if (!adsDb) {
    return {
      ok: true,
      rangeKey,
      rangeStartTs: bounds.start,
      rangeEndTs: bounds.end,
      currency: 'GBP',
      totals: {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        profit: 0,
        roas: null,
      },
      campaigns: [],
      note: 'ADS_DB_URL not set.',
    };
  }

  // Revenue — Shopify truth orders attributed into Ads DB (no main DB joins at query time).
  let revRows = [];
  try {
    const revFilterSql = source ? ' AND source = ?' : '';
    const revParams = source ? [bounds.start, bounds.end, source] : [bounds.start, bounds.end];
    revRows = await adsDb.all(
      `
        SELECT
          campaign_id,
          COALESCE(NULLIF(TRIM(adgroup_id), ''), '_all_') AS adgroup_id,
          COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp,
          COUNT(*) AS orders
        FROM ads_orders_attributed
        WHERE created_at_ms >= ? AND created_at_ms < ?${revFilterSql}
          AND campaign_id IS NOT NULL AND TRIM(campaign_id) != ''
        GROUP BY campaign_id, COALESCE(NULLIF(TRIM(adgroup_id), ''), '_all_')
      `,
      revParams
    );
  } catch (e) {
    console.warn('[ads.summary] failed to read ads_orders_attributed (non-fatal):', e && e.message ? e.message : e);
    revRows = [];
  }

  // Spend (Google Ads rollups) — now also includes Google conversion data
  const spendFilterSql = provider ? ' AND provider = ?' : '';
  const spendParams = provider ? [bounds.start, bounds.end, provider] : [bounds.start, bounds.end];
  const spendRows = await adsDb.all(
    `
      SELECT
        provider,
        campaign_id,
        adgroup_id,
        COALESCE(SUM(spend_gbp), 0) AS spend_gbp,
        COALESCE(SUM(clicks), 0) AS clicks,
        COALESCE(SUM(impressions), 0) AS impressions,
        COALESCE(SUM(conversions), 0) AS conversions,
        COALESCE(SUM(conversions_value_gbp), 0) AS conversions_value_gbp,
        MAX(campaign_name) AS campaign_name,
        MAX(adgroup_name) AS adgroup_name
      FROM google_ads_spend_hourly
      WHERE hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)${spendFilterSql}
      GROUP BY provider, campaign_id, adgroup_id
    `,
    spendParams
  );

  const campaignMap = new Map();
  function ensureCampaign(id) {
    const key = id != null ? String(id) : '';
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        campaignId: key,
        campaignName: '',
        revenue: 0,
        orders: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        profit: 0,
        roas: null,
        adgroups: new Map(),
      });
    }
    return campaignMap.get(key);
  }
  function ensureAdgroup(camp, id) {
    const key = id != null ? String(id) : '';
    if (!camp.adgroups.has(key)) {
      camp.adgroups.set(key, {
        adgroupId: key,
        adgroupName: '',
        revenue: 0,
        orders: 0,
        spend: 0,
        clicks: 0,
        impressions: 0,
        profit: 0,
        roas: null,
      });
    }
    return camp.adgroups.get(key);
  }

  // Apply KEXO-attributed revenue (from purchases → sessions rollup)
  for (const r of revRows || []) {
    const campaignId = r && r.campaign_id != null ? String(r.campaign_id) : '';
    const adgroupId = r && r.adgroup_id != null ? String(r.adgroup_id) : '';
    if (!campaignId) continue;
    const camp = ensureCampaign(campaignId);
    const ag = ensureAdgroup(camp, adgroupId || '_all_');

    const revenue = r && r.revenue_gbp != null ? Number(r.revenue_gbp) : 0;
    const orders = r && r.orders != null ? Number(r.orders) : 0;
    const rev = Number.isFinite(revenue) ? revenue : 0;
    const ord = Number.isFinite(orders) ? orders : 0;

    camp.revenue += rev;
    camp.orders += ord;
    ag.revenue += rev;
    ag.orders += ord;
  }

  // Apply spend (Google Ads)
  for (const r of spendRows || []) {
    const campaignId = r && r.campaign_id != null ? String(r.campaign_id) : '';
    const adgroupId = r && r.adgroup_id != null ? String(r.adgroup_id) : '';
    if (!campaignId || !adgroupId) continue;
    const camp = ensureCampaign(campaignId);
    const ag = ensureAdgroup(camp, adgroupId);

    const spend = r && r.spend_gbp != null ? Number(r.spend_gbp) : 0;
    const clicks = r && r.clicks != null ? Number(r.clicks) : 0;
    const impressions = r && r.impressions != null ? Number(r.impressions) : 0;
    const sp = Number.isFinite(spend) ? spend : 0;
    const cl = Number.isFinite(clicks) ? clicks : 0;
    const im = Number.isFinite(impressions) ? impressions : 0;

    if (r.campaign_name && !camp.campaignName) camp.campaignName = String(r.campaign_name);
    if (r.adgroup_name && !ag.adgroupName) ag.adgroupName = String(r.adgroup_name);

    camp.spend += sp;
    camp.clicks += cl;
    camp.impressions += im;
    ag.spend += sp;
    ag.clicks += cl;
    ag.impressions += im;
  }

  // Finalize
  let totalsRevenue = 0;
  let totalsSpend = 0;
  let totalsClicks = 0;
  let totalsImpressions = 0;
  let totalsOrders = 0;

  const campaigns = [];
  for (const c of campaignMap.values()) {
    c.profit = c.revenue - c.spend;
    c.roas = c.spend > 0 ? (c.revenue / c.spend) : null;
    totalsRevenue += c.revenue;
    totalsSpend += c.spend;
    totalsClicks += c.clicks;
    totalsImpressions += c.impressions;
    totalsOrders += c.orders;

    const adgroups = Array.from(c.adgroups.values()).map((ag) => {
      ag.profit = ag.revenue - ag.spend;
      ag.roas = ag.spend > 0 ? (ag.revenue / ag.spend) : null;
      return ag;
    });
    // spend desc by default
    adgroups.sort((a, b) => (b.spend || 0) - (a.spend || 0));
    campaigns.push({
      campaignId: c.campaignId,
      campaignName: c.campaignName || '',
      revenue: Math.round(c.revenue * 100) / 100,
      orders: Math.floor(c.orders || 0),
      spend: Math.round(c.spend * 100) / 100,
      clicks: Math.floor(c.clicks || 0),
      impressions: Math.floor(c.impressions || 0),
      profit: Math.round(c.profit * 100) / 100,
      roas: c.roas,
      adgroups,
    });
  }
  campaigns.sort((a, b) => (b.spend || 0) - (a.spend || 0));

  const note = (!revRows || !revRows.length) && (!spendRows || !spendRows.length)
    ? 'No spend data yet. Google Ads spend sync runs in the background — ensure Google Ads is connected. Sales are attributed from Shopify truth orders via tracking params (bs_campaign_id/utm_id/gclid).'
    : ((!revRows || !revRows.length) && (spendRows && spendRows.length)
      ? 'Spend is synced from Google Ads. No attributed Shopify orders found for this range yet — check landing_site has bs_campaign_id/utm_id or gclid cache is working.'
      : null);

  return {
    ok: true,
    rangeKey,
    rangeStartTs: bounds.start,
    rangeEndTs: bounds.end,
    currency: 'GBP',
    totals: {
      spend: Math.round(totalsSpend * 100) / 100,
      impressions: Math.floor(totalsImpressions || 0),
      clicks: Math.floor(totalsClicks || 0),
      conversions: Math.floor(totalsOrders || 0),
      revenue: Math.round(totalsRevenue * 100) / 100,
      profit: Math.round((totalsRevenue - totalsSpend) * 100) / 100,
      roas: totalsSpend > 0 ? (totalsRevenue / totalsSpend) : null,
    },
    campaigns,
    orders: Math.floor(totalsOrders || 0),
    note,
  };
}

async function getAudit(options = {}) {
  const rangeKey = normalizeRangeKey(options.rangeKey);
  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);

  const source = options.source != null ? String(options.source).trim().toLowerCase() : 'googleads';
  const provider = options.provider != null ? String(options.provider).trim().toLowerCase() : 'google_ads';

  // 1) Google Ads totals (Ads DB)
  const adsDb = getAdsDb();
  let adsTotals = {
    spendGbp: 0,
    clicks: 0,
    impressions: 0,
    conversions: 0,
    conversionsValueGbp: 0,
    ok: !!adsDb,
    note: adsDb ? null : 'ADS_DB_URL not set.',
  };
  if (adsDb) {
    try {
      const row = await adsDb.get(
        `
          SELECT
            COALESCE(SUM(spend_gbp), 0) AS spend_gbp,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(conversions), 0) AS conversions,
            COALESCE(SUM(conversions_value_gbp), 0) AS conversions_value_gbp
          FROM google_ads_spend_hourly
          WHERE hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
            AND provider = ?
        `,
        [bounds.start, bounds.end, provider]
      );
      adsTotals = {
        ...adsTotals,
        spendGbp: row && row.spend_gbp != null ? Number(row.spend_gbp) || 0 : 0,
        clicks: row && row.clicks != null ? Number(row.clicks) || 0 : 0,
        impressions: row && row.impressions != null ? Number(row.impressions) || 0 : 0,
        conversions: row && row.conversions != null ? Number(row.conversions) || 0 : 0,
        conversionsValueGbp: row && row.conversions_value_gbp != null ? Number(row.conversions_value_gbp) || 0 : 0,
      };
    } catch (e) {
      adsTotals = { ...adsTotals, ok: false, note: e && e.message ? String(e.message).slice(0, 220) : 'ads_totals_failed' };
    }
  }

  // 2) KEXO sessions (main DB)
  const db = getDb();
  let kexo = {
    ok: true,
    humanSessions: 0,
    sessionsWithGclid: 0,
    sessionsWithGbraid: 0,
    sessionsWithWbraid: 0,
    sessionsWithClickId: 0,
    sessionsWithCampaignId: 0,
    sessionsWithCampaignAndClickId: 0,
    sessionsWithGoogleCampaignId: 0,
  };
  try {
    const row = await db.get(
      `
        SELECT
          COUNT(*) AS human_sessions,
          COALESCE(SUM(CASE WHEN entry_url LIKE '%gclid=%' THEN 1 ELSE 0 END), 0) AS sessions_with_gclid,
          COALESCE(SUM(CASE WHEN entry_url LIKE '%gbraid=%' THEN 1 ELSE 0 END), 0) AS sessions_with_gbraid,
          COALESCE(SUM(CASE WHEN entry_url LIKE '%wbraid=%' THEN 1 ELSE 0 END), 0) AS sessions_with_wbraid,
          COALESCE(SUM(CASE WHEN (entry_url LIKE '%gclid=%' OR entry_url LIKE '%gbraid=%' OR entry_url LIKE '%wbraid=%') THEN 1 ELSE 0 END), 0) AS sessions_with_click_id,
          COALESCE(SUM(CASE WHEN NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL THEN 1 ELSE 0 END), 0) AS sessions_with_campaign_id,
          COALESCE(SUM(CASE WHEN NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL AND (entry_url LIKE '%gclid=%' OR entry_url LIKE '%gbraid=%' OR entry_url LIKE '%wbraid=%') THEN 1 ELSE 0 END), 0) AS sessions_with_campaign_and_click_id,
          COALESCE(SUM(CASE WHEN NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL AND LOWER(TRIM(COALESCE(bs_source, ''))) LIKE '%google%' THEN 1 ELSE 0 END), 0) AS sessions_with_google_campaign_id
        FROM sessions
        WHERE started_at >= ? AND started_at < ?
          AND (cf_known_bot IS NULL OR cf_known_bot = 0)
      `,
      [bounds.start, bounds.end]
    );
    kexo = {
      ...kexo,
      humanSessions: row && row.human_sessions != null ? Number(row.human_sessions) || 0 : 0,
      sessionsWithGclid: row && row.sessions_with_gclid != null ? Number(row.sessions_with_gclid) || 0 : 0,
      sessionsWithGbraid: row && row.sessions_with_gbraid != null ? Number(row.sessions_with_gbraid) || 0 : 0,
      sessionsWithWbraid: row && row.sessions_with_wbraid != null ? Number(row.sessions_with_wbraid) || 0 : 0,
      sessionsWithClickId: row && row.sessions_with_click_id != null ? Number(row.sessions_with_click_id) || 0 : 0,
      sessionsWithCampaignId: row && row.sessions_with_campaign_id != null ? Number(row.sessions_with_campaign_id) || 0 : 0,
      sessionsWithCampaignAndClickId: row && row.sessions_with_campaign_and_click_id != null ? Number(row.sessions_with_campaign_and_click_id) || 0 : 0,
      sessionsWithGoogleCampaignId: row && row.sessions_with_google_campaign_id != null ? Number(row.sessions_with_google_campaign_id) || 0 : 0,
    };
  } catch (e) {
    kexo = { ...kexo, ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'sessions_audit_failed' };
  }

  // 3) Ads-attributed orders (Ads DB)
  let orders = {
    ok: !!adsDb,
    ordersTotal: 0,
    ordersWithCampaignId: 0,
    revenueGbp: 0,
    note: adsDb ? null : 'ADS_DB_URL not set.',
  };
  if (adsDb) {
    try {
      const row = await adsDb.get(
        `
          SELECT
            COUNT(*) AS orders_total,
            COALESCE(SUM(CASE WHEN campaign_id IS NOT NULL AND TRIM(campaign_id) != '' THEN 1 ELSE 0 END), 0) AS orders_with_campaign_id,
            COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp
          FROM ads_orders_attributed
          WHERE created_at_ms >= ? AND created_at_ms < ?
            AND source = ?
        `,
        [bounds.start, bounds.end, source]
      );
      orders = {
        ...orders,
        ordersTotal: row && row.orders_total != null ? Number(row.orders_total) || 0 : 0,
        ordersWithCampaignId: row && row.orders_with_campaign_id != null ? Number(row.orders_with_campaign_id) || 0 : 0,
        revenueGbp: row && row.revenue_gbp != null ? Number(row.revenue_gbp) || 0 : 0,
      };
    } catch (e) {
      orders = { ...orders, ok: false, note: e && e.message ? String(e.message).slice(0, 220) : 'orders_audit_failed' };
    }
  }

  function ratio(a, b) {
    const x = Number(a);
    const y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y) || y <= 0) return null;
    return x / y;
  }

  const clickToSession = ratio(kexo.sessionsWithClickId, adsTotals.clicks);
  const sessionMapping = ratio(kexo.sessionsWithCampaignAndClickId, kexo.sessionsWithClickId);
  const orderAttribution = ratio(orders.ordersWithCampaignId, orders.ordersTotal);

  return {
    ok: true,
    rangeKey,
    rangeStartTs: bounds.start,
    rangeEndTs: bounds.end,
    googleAds: adsTotals,
    kexo,
    orders,
    coverage: {
      clickToSession,
      sessionMapping,
      orderAttribution,
      droppedClicksEstimate: (Number.isFinite(adsTotals.clicks) && Number.isFinite(kexo.sessionsWithClickId))
        ? Math.max(0, Math.floor(adsTotals.clicks) - Math.floor(kexo.sessionsWithClickId))
        : null,
    },
    notes: [
      'Click→session coverage compares Google Ads click totals vs KEXO sessions containing gclid/gbraid/wbraid in entry_url (human-only).',
      'Clicks and sessions are not perfectly 1:1 (re-clicks, redirects, privacy constraints). Use as a coverage indicator, not an absolute truth table.',
    ],
  };
}

async function getCampaignDetail(options = {}) {
  const rangeKey = normalizeRangeKey(options.rangeKey);
  const campaignId = options.campaignId != null ? String(options.campaignId).trim() : '';
  if (!campaignId) return { ok: false, error: 'Missing campaignId' };

  const now = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, timeZone);
  const currency = 'GBP';
  const source = options.source != null ? String(options.source).trim().toLowerCase() : 'googleads';

  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

  // Hourly spend for this campaign
  const spendHourly = await adsDb.all(
    `SELECT
       EXTRACT(EPOCH FROM hour_ts)::bigint * 1000 AS ts,
       COALESCE(SUM(spend_gbp), 0) AS spend,
       COALESCE(SUM(clicks), 0) AS clicks,
       COALESCE(SUM(impressions), 0) AS impressions
     FROM google_ads_spend_hourly
     WHERE hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
       AND campaign_id = ?
     GROUP BY hour_ts
     ORDER BY hour_ts ASC`,
    [bounds.start, bounds.end, campaignId]
  );

  // Revenue series for this campaign: Shopify truth orders attributed into Ads DB.
  let revenueHourly = new Map();
  try {
    const rows = await adsDb.all(
      `SELECT
         EXTRACT(EPOCH FROM DATE_TRUNC('hour', TO_TIMESTAMP(created_at_ms/1000.0)))::bigint * 1000 AS ts,
         COALESCE(SUM(revenue_gbp), 0) AS revenue
       FROM ads_orders_attributed
       WHERE created_at_ms >= ? AND created_at_ms < ?
         AND source = ?
         AND campaign_id = ?
       GROUP BY DATE_TRUNC('hour', TO_TIMESTAMP(created_at_ms/1000.0))
       ORDER BY ts ASC`,
      [bounds.start, bounds.end, source, campaignId]
    );
    for (const r of rows || []) {
      if (r && r.ts) revenueHourly.set(Number(r.ts), Number(r.revenue) || 0);
    }
  } catch (e) {
    console.warn('[ads.campaign-detail] failed to read ads_orders_attributed (non-fatal):', e && e.message ? e.message : e);
  }

  // Recent attributed sales list: Shopify truth orders attributed into Ads DB.
  let recentSales = [];
  try {
    const rows = await adsDb.all(
      `SELECT
         order_id,
         created_at_ms,
         revenue_gbp,
         country_code
       FROM ads_orders_attributed
       WHERE created_at_ms >= ? AND created_at_ms < ?
         AND source = ?
         AND campaign_id = ?
       ORDER BY created_at_ms DESC
       LIMIT 30`,
      [bounds.start, bounds.end, source, campaignId]
    );
    for (const r of rows || []) {
      const ts = r && r.created_at_ms != null ? Number(r.created_at_ms) : 0;
      const value = r && r.revenue_gbp != null ? Number(r.revenue_gbp) : 0;
      const oid = r && r.order_id ? String(r.order_id) : '';
      const id = oid || '';
      recentSales.push({
        orderId: id,
        orderName: id,
        country: r && r.country_code ? String(r.country_code).toUpperCase() : '',
        value: Number.isFinite(value) ? Math.round(value * 100) / 100 : 0,
        currency,
        time: Number.isFinite(ts) ? ts : 0,
      });
    }
  } catch (e) {
    console.warn('[ads.campaign-detail] failed to fetch recent orders (non-fatal):', e && e.message ? e.message : e);
    recentSales = [];
  }

  // Build aligned hourly arrays for chart
  const allTs = new Set();
  for (const r of spendHourly || []) {
    if (r && r.ts) allTs.add(Number(r.ts));
  }
  for (const ts of revenueHourly.keys()) {
    allTs.add(ts);
  }
  const sortedTs = Array.from(allTs).sort((a, b) => a - b);
  const spendByTs = new Map();
  for (const r of spendHourly || []) {
    spendByTs.set(Number(r.ts), Number(r.spend) || 0);
  }

  const chart = {
    labels: sortedTs.map(function (ts) {
      try { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }); } catch (_) { return String(ts); }
    }),
    spend: sortedTs.map(function (ts) { return Math.round((spendByTs.get(ts) || 0) * 100) / 100; }),
    revenue: sortedTs.map(function (ts) { return Math.round((revenueHourly.get(ts) || 0) * 100) / 100; }),
  };

  // Country performance: Google Ads geo clicks/spend + KEXO-attributed orders/revenue.
  const startYmd = fmtYmdInTz(bounds.start, timeZone);
  const endYmd = fmtYmdInTz(Math.max(bounds.start, bounds.end - 1), timeZone);

  let countries = { ok: true, rows: [], meta: { locationType: 'LOCATION_OF_PRESENCE', startYmd, endYmd, ordersTotal: 0, ordersWithVisitorCountry: 0, visitorCountryCoverage: null } };
  try {
    const byCode = new Map();
    function ensure(code) {
      const key = code != null ? String(code).trim().toUpperCase() : '';
      const safe = key && key !== '_UNKNOWN_' ? key : '_unknown_';
      if (!byCode.has(safe)) {
        byCode.set(safe, { country: safe, clicks: 0, impressions: 0, spend: 0, orders: 0, revenue: 0, cr: null, roas: null });
      }
      return byCode.get(safe);
    }

    // Geo clicks/spend by country (default: location of presence).
    let geoRows = [];
    if (startYmd && endYmd) {
      geoRows = await adsDb.all(
        `
          SELECT
            COALESCE(NULLIF(TRIM(country_code), ''), '_unknown_') AS country_code,
            COALESCE(SUM(spend_gbp), 0) AS spend_gbp,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(impressions), 0) AS impressions
          FROM google_ads_geo_daily
          WHERE provider = ?
            AND campaign_id = ?
            AND day_ymd >= ? AND day_ymd <= ?
            AND location_type = ?
          GROUP BY COALESCE(NULLIF(TRIM(country_code), ''), '_unknown_')
        `,
        ['google_ads', campaignId, startYmd, endYmd, 'LOCATION_OF_PRESENCE']
      );
    }
    for (const r of geoRows || []) {
      const code = r && r.country_code != null ? String(r.country_code).trim().toUpperCase() : '_unknown_';
      const it = ensure(code);
      it.spend += r && r.spend_gbp != null ? Number(r.spend_gbp) || 0 : 0;
      it.clicks += r && r.clicks != null ? Number(r.clicks) || 0 : 0;
      it.impressions += r && r.impressions != null ? Number(r.impressions) || 0 : 0;
    }

    // Revenue/orders by visitor (session) country.
    const revRows = await adsDb.all(
      `
        SELECT
          COALESCE(NULLIF(TRIM(visitor_country_code), ''), '_unknown_') AS country_code,
          COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp,
          COUNT(*) AS orders
        FROM ads_orders_attributed
        WHERE created_at_ms >= ? AND created_at_ms < ?
          AND source = ?
          AND campaign_id = ?
        GROUP BY COALESCE(NULLIF(TRIM(visitor_country_code), ''), '_unknown_')
      `,
      [bounds.start, bounds.end, source, campaignId]
    );
    let ordersTotal = 0;
    let ordersWithVisitorCountry = 0;
    for (const r of revRows || []) {
      const code = r && r.country_code != null ? String(r.country_code).trim().toUpperCase() : '_unknown_';
      const it = ensure(code);
      const ord = r && r.orders != null ? Number(r.orders) || 0 : 0;
      const rev = r && r.revenue_gbp != null ? Number(r.revenue_gbp) || 0 : 0;
      it.orders += ord;
      it.revenue += rev;
      ordersTotal += ord;
      if (code && code !== '_UNKNOWN_' && code !== '_unknown_') ordersWithVisitorCountry += ord;
    }

    // Finalize derived metrics
    const rows = Array.from(byCode.values()).map((it) => {
      const clicks = Number(it.clicks) || 0;
      const spend = Number(it.spend) || 0;
      const orders = Number(it.orders) || 0;
      const revenue = Number(it.revenue) || 0;
      const cr = clicks > 0 ? (orders / clicks) : null;
      const roas = spend > 0 ? (revenue / spend) : null;
      return {
        country: it.country === '_unknown_' ? '' : it.country,
        clicks: Math.floor(clicks),
        impressions: Math.floor(Number(it.impressions) || 0),
        spend: Math.round(spend * 100) / 100,
        orders: Math.floor(orders),
        revenue: Math.round(revenue * 100) / 100,
        cr,
        roas,
      };
    });
    rows.sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || (b.spend || 0) - (a.spend || 0) || (b.clicks || 0) - (a.clicks || 0));

    countries = {
      ok: true,
      rows,
      meta: {
        locationType: 'LOCATION_OF_PRESENCE',
        startYmd,
        endYmd,
        ordersTotal: Math.floor(ordersTotal || 0),
        ordersWithVisitorCountry: Math.floor(ordersWithVisitorCountry || 0),
        visitorCountryCoverage: ordersTotal > 0 ? (ordersWithVisitorCountry / ordersTotal) : null,
      }
    };
  } catch (e) {
    countries = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'countries_failed', rows: [], meta: { locationType: 'LOCATION_OF_PRESENCE', startYmd, endYmd } };
  }

  // Device performance: Google Ads clicks/spend by segments.device + KEXO-attributed orders/revenue by visitor_device_type.
  let devices = { ok: true, rows: [], meta: { startYmd, endYmd, ordersTotal: 0, ordersWithVisitorDeviceType: 0, visitorDeviceCoverage: null } };
  try {
    function normalizeDeviceKey(raw) {
      const v = raw != null ? String(raw).trim().toUpperCase() : '';
      if (!v) return 'other';
      if (v === 'DESKTOP') return 'desktop';
      if (v === 'MOBILE') return 'mobile';
      if (v === 'TABLET') return 'tablet';
      return 'other';
    }
    function normalizeVisitorDeviceKey(raw) {
      const v = raw != null ? String(raw).trim().toLowerCase() : '';
      if (v === 'desktop' || v === 'mobile' || v === 'tablet') return v;
      return 'other';
    }
    function labelFor(key) {
      if (key === 'desktop') return 'Desktop';
      if (key === 'mobile') return 'Mobile';
      if (key === 'tablet') return 'Tablet';
      return 'Other';
    }

    const byDevice = new Map();
    function ensure(key) {
      const k = key || 'other';
      if (!byDevice.has(k)) {
        byDevice.set(k, { deviceKey: k, clicks: 0, impressions: 0, spend: 0, orders: 0, revenue: 0, cr: null, roas: null });
      }
      return byDevice.get(k);
    }

    // Google Ads clicks/spend by device (segments.device)
    let devRows = [];
    if (startYmd && endYmd) {
      devRows = await adsDb.all(
        `
          SELECT
            COALESCE(NULLIF(TRIM(device), ''), '_unknown_') AS device,
            COALESCE(SUM(spend_gbp), 0) AS spend_gbp,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(impressions), 0) AS impressions
          FROM google_ads_device_daily
          WHERE provider = ?
            AND campaign_id = ?
            AND day_ymd >= ? AND day_ymd <= ?
          GROUP BY COALESCE(NULLIF(TRIM(device), ''), '_unknown_')
        `,
        ['google_ads', campaignId, startYmd, endYmd]
      );
    }
    for (const r of devRows || []) {
      const key = normalizeDeviceKey(r && r.device != null ? r.device : null);
      const it = ensure(key);
      it.spend += r && r.spend_gbp != null ? Number(r.spend_gbp) || 0 : 0;
      it.clicks += r && r.clicks != null ? Number(r.clicks) || 0 : 0;
      it.impressions += r && r.impressions != null ? Number(r.impressions) || 0 : 0;
    }

    // Revenue/orders by visitor device type (from linked sessions)
    const revRows = await adsDb.all(
      `
        SELECT
          COALESCE(NULLIF(TRIM(visitor_device_type), ''), '_unknown_') AS device,
          COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp,
          COUNT(*) AS orders
        FROM ads_orders_attributed
        WHERE created_at_ms >= ? AND created_at_ms < ?
          AND source = ?
          AND campaign_id = ?
        GROUP BY COALESCE(NULLIF(TRIM(visitor_device_type), ''), '_unknown_')
      `,
      [bounds.start, bounds.end, source, campaignId]
    );
    let ordersTotal = 0;
    let ordersWithVisitorDeviceType = 0;
    for (const r of revRows || []) {
      const raw = r && r.device != null ? String(r.device).trim().toLowerCase() : '';
      const key = normalizeVisitorDeviceKey(raw);
      const it = ensure(key);
      const ord = r && r.orders != null ? Number(r.orders) || 0 : 0;
      const rev = r && r.revenue_gbp != null ? Number(r.revenue_gbp) || 0 : 0;
      it.orders += ord;
      it.revenue += rev;
      ordersTotal += ord;
      if (raw && raw !== '_unknown_') ordersWithVisitorDeviceType += ord;
    }

    const rows = Array.from(byDevice.values()).map((it) => {
      const clicks = Number(it.clicks) || 0;
      const spend = Number(it.spend) || 0;
      const orders = Number(it.orders) || 0;
      const revenue = Number(it.revenue) || 0;
      const cr = clicks > 0 ? (orders / clicks) : null;
      const roas = spend > 0 ? (revenue / spend) : null;
      return {
        device: labelFor(it.deviceKey),
        deviceKey: it.deviceKey,
        clicks: Math.floor(clicks),
        impressions: Math.floor(Number(it.impressions) || 0),
        spend: Math.round(spend * 100) / 100,
        orders: Math.floor(orders),
        revenue: Math.round(revenue * 100) / 100,
        cr,
        roas,
      };
    });
    rows.sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || (b.spend || 0) - (a.spend || 0) || (b.clicks || 0) - (a.clicks || 0));

    devices = {
      ok: true,
      rows,
      meta: {
        startYmd,
        endYmd,
        ordersTotal: Math.floor(ordersTotal || 0),
        ordersWithVisitorDeviceType: Math.floor(ordersWithVisitorDeviceType || 0),
        visitorDeviceCoverage: ordersTotal > 0 ? (ordersWithVisitorDeviceType / ordersTotal) : null,
      },
    };
  } catch (e) {
    devices = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'devices_failed', rows: [], meta: { startYmd, endYmd } };
  }

  // Network performance: ValueTrack `{network}` (captured into sessions.bs_network) + KEXO-attributed orders/revenue by visitor_network.
  let networks = {
    ok: true,
    rows: [],
    meta: {
      startYmd,
      endYmd,
      sessionsTotal: 0,
      sessionsWithNetwork: 0,
      sessionNetworkCoverage: null,
      ordersTotal: 0,
      ordersWithVisitorNetwork: 0,
      visitorNetworkCoverage: null,
    }
  };
  try {
    function normalizeNetworkKey(raw) {
      const s = raw != null ? String(raw).trim().toLowerCase() : '';
      if (!s) return '_unknown_';
      // ValueTrack codes: g/s/d/x/ytv/vp/gtv/e...
      return s.length > 16 ? s.slice(0, 16) : s;
    }
    function labelFor(code) {
      const c = normalizeNetworkKey(code);
      if (c === 'g') return 'Google search';
      if (c === 's') return 'Search partners';
      if (c === 'd') return 'Display';
      if (c === 'x') return 'Performance Max';
      if (c === 'ytv') return 'YouTube';
      if (c === 'vp') return 'Video partners';
      if (c === 'gtv') return 'Google TV';
      if (c === 'e') return 'App (engagement)';
      if (c === '_unknown_') return 'Unknown';
      return 'Other';
    }

    const byNetwork = new Map();
    function ensure(key) {
      const k = normalizeNetworkKey(key);
      if (!byNetwork.has(k)) {
        byNetwork.set(k, { network: k, label: labelFor(k), sessions: 0, orders: 0, revenue: 0, cr: null });
      }
      return byNetwork.get(k);
    }

    // Sessions by network for this campaign (main DB).
    let sessRows = [];
    try {
      const db = getDb();
      sessRows = await db.all(
        `
          SELECT
            COALESCE(NULLIF(TRIM(bs_network), ''), '_unknown_') AS network,
            COUNT(*) AS sessions
          FROM sessions
          WHERE started_at >= ? AND started_at < ?
            AND bs_campaign_id = ?
            AND LOWER(TRIM(COALESCE(bs_source, ''))) = ?
          GROUP BY COALESCE(NULLIF(TRIM(bs_network), ''), '_unknown_')
        `,
        [bounds.start, bounds.end, campaignId, 'googleads']
      );
    } catch (e) {
      // Non-fatal: if sessions query fails, still render order-based network rows.
      sessRows = [];
    }

    let sessionsTotal = 0;
    let sessionsWithNetwork = 0;
    for (const r of sessRows || []) {
      const key = normalizeNetworkKey(r && r.network != null ? r.network : null);
      const s = r && r.sessions != null ? Number(r.sessions) || 0 : 0;
      const it = ensure(key);
      it.sessions += s;
      sessionsTotal += s;
      if (key && key !== '_unknown_') sessionsWithNetwork += s;
    }

    // Revenue/orders by visitor network (Ads DB).
    const ordRows = await adsDb.all(
      `
        SELECT
          COALESCE(NULLIF(TRIM(visitor_network), ''), '_unknown_') AS network,
          COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp,
          COUNT(*) AS orders
        FROM ads_orders_attributed
        WHERE created_at_ms >= ? AND created_at_ms < ?
          AND source = ?
          AND campaign_id = ?
        GROUP BY COALESCE(NULLIF(TRIM(visitor_network), ''), '_unknown_')
      `,
      [bounds.start, bounds.end, source, campaignId]
    );

    let ordersTotal = 0;
    let ordersWithVisitorNetwork = 0;
    for (const r of ordRows || []) {
      const key = normalizeNetworkKey(r && r.network != null ? r.network : null);
      const ord = r && r.orders != null ? Number(r.orders) || 0 : 0;
      const rev = r && r.revenue_gbp != null ? Number(r.revenue_gbp) || 0 : 0;
      const it = ensure(key);
      it.orders += ord;
      it.revenue += rev;
      ordersTotal += ord;
      if (key && key !== '_unknown_') ordersWithVisitorNetwork += ord;
    }

    const rows = Array.from(byNetwork.values()).map((it) => {
      const sessions = Number(it.sessions) || 0;
      const orders = Number(it.orders) || 0;
      const revenue = Number(it.revenue) || 0;
      return {
        network: it.network === '_unknown_' ? '' : it.network,
        label: it.label || labelFor(it.network),
        sessions: Math.floor(sessions),
        orders: Math.floor(orders),
        revenue: Math.round(revenue * 100) / 100,
        cr: sessions > 0 ? (orders / sessions) : null,
      };
    });
    rows.sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || (b.sessions || 0) - (a.sessions || 0) || (b.orders || 0) - (a.orders || 0));

    networks = {
      ok: true,
      rows,
      meta: {
        startYmd,
        endYmd,
        sessionsTotal: Math.floor(sessionsTotal || 0),
        sessionsWithNetwork: Math.floor(sessionsWithNetwork || 0),
        sessionNetworkCoverage: sessionsTotal > 0 ? (sessionsWithNetwork / sessionsTotal) : null,
        ordersTotal: Math.floor(ordersTotal || 0),
        ordersWithVisitorNetwork: Math.floor(ordersWithVisitorNetwork || 0),
        visitorNetworkCoverage: ordersTotal > 0 ? (ordersWithVisitorNetwork / ordersTotal) : null,
      }
    };
  } catch (e) {
    networks = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'networks_failed', rows: [], meta: { startYmd, endYmd } };
  }

  // Day parting: group by hour-of-day in admin/store timezone.
  let dayParting = { ok: true, rows: [], meta: { timeZone, bestHour: null, bestRoas: null } };
  try {
    const spendRows = await adsDb.all(
      `
        SELECT
          EXTRACT(HOUR FROM (hour_ts AT TIME ZONE ?))::int AS hour,
          COALESCE(SUM(spend_gbp), 0) AS spend_gbp,
          COALESCE(SUM(clicks), 0) AS clicks,
          COALESCE(SUM(impressions), 0) AS impressions
        FROM google_ads_spend_hourly
        WHERE hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
          AND campaign_id = ?
        GROUP BY EXTRACT(HOUR FROM (hour_ts AT TIME ZONE ?))
        ORDER BY hour ASC
      `,
      [timeZone, bounds.start, bounds.end, campaignId, timeZone]
    );
    const revRows = await adsDb.all(
      `
        SELECT
          EXTRACT(HOUR FROM (TO_TIMESTAMP(created_at_ms/1000.0) AT TIME ZONE ?))::int AS hour,
          COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp,
          COUNT(*) AS orders
        FROM ads_orders_attributed
        WHERE created_at_ms >= ? AND created_at_ms < ?
          AND source = ?
          AND campaign_id = ?
        GROUP BY EXTRACT(HOUR FROM (TO_TIMESTAMP(created_at_ms/1000.0) AT TIME ZONE ?))
        ORDER BY hour ASC
      `,
      [timeZone, bounds.start, bounds.end, source, campaignId, timeZone]
    );

    const byHour = new Map();
    for (let h = 0; h < 24; h++) {
      byHour.set(h, { hour: h, clicks: 0, impressions: 0, spend: 0, orders: 0, revenue: 0, cr: null, roas: null });
    }
    for (const r of spendRows || []) {
      const h = r && r.hour != null ? Number(r.hour) : null;
      if (h == null || !Number.isFinite(h) || h < 0 || h > 23) continue;
      const it = byHour.get(h);
      it.spend += r && r.spend_gbp != null ? Number(r.spend_gbp) || 0 : 0;
      it.clicks += r && r.clicks != null ? Number(r.clicks) || 0 : 0;
      it.impressions += r && r.impressions != null ? Number(r.impressions) || 0 : 0;
    }
    for (const r of revRows || []) {
      const h = r && r.hour != null ? Number(r.hour) : null;
      if (h == null || !Number.isFinite(h) || h < 0 || h > 23) continue;
      const it = byHour.get(h);
      it.revenue += r && r.revenue_gbp != null ? Number(r.revenue_gbp) || 0 : 0;
      it.orders += r && r.orders != null ? Number(r.orders) || 0 : 0;
    }

    let bestHour = null;
    let bestRoas = null;
    const rows = Array.from(byHour.values()).map((it) => {
      const clicks = Number(it.clicks) || 0;
      const spend = Number(it.spend) || 0;
      const orders = Number(it.orders) || 0;
      const revenue = Number(it.revenue) || 0;
      const cr = clicks > 0 ? (orders / clicks) : null;
      const roas = spend > 0 ? (revenue / spend) : null;
      if (roas != null) {
        if (bestRoas == null || roas > bestRoas) {
          bestRoas = roas;
          bestHour = it.hour;
        }
      }
      return {
        hour: it.hour,
        label: String(it.hour).padStart(2, '0') + ':00',
        clicks: Math.floor(clicks),
        impressions: Math.floor(Number(it.impressions) || 0),
        spend: Math.round(spend * 100) / 100,
        orders: Math.floor(orders),
        revenue: Math.round(revenue * 100) / 100,
        cr,
        roas,
      };
    });

    dayParting = {
      ok: true,
      rows,
      meta: { timeZone, bestHour, bestRoas },
    };
  } catch (e) {
    dayParting = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'day_parting_failed', rows: [], meta: { timeZone } };
  }

  return {
    ok: true,
    campaignId,
    rangeKey,
    currency,
    chart,
    countries,
    devices,
    networks,
    dayParting,
    recentSales: recentSales.slice(0, 10),
  };
}

module.exports = {
  normalizeRangeKey,
  getStatus,
  getSummary,
  getAudit,
  getCampaignDetail,
};
