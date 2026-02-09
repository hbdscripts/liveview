const store = require('../store');
const config = require('../config');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig } = require('./adsStore');

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', 'month']);

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  const isDayKey = /^d:\d{4}-\d{2}-\d{2}$/.test(r);
  const isRangeKey = /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(r);
  if (ALLOWED_RANGE.has(r) || isDayKey || isRangeKey) return r;
  return 'today';
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

  return {
    ok: true,
    campaignId,
    rangeKey,
    currency,
    chart,
    recentSales: recentSales.slice(0, 10),
  };
}

module.exports = {
  normalizeRangeKey,
  getStatus,
  getSummary,
  getCampaignDetail,
};
