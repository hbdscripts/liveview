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

  // Revenue (Birdseye rollups)
  const revFilterSql = source ? ' AND source = ?' : '';
  const revParams = source ? [bounds.start, bounds.end, source] : [bounds.start, bounds.end];
  const revRows = await adsDb.all(
    `
      SELECT
        source,
        campaign_id,
        adgroup_id,
        COALESCE(SUM(revenue_gbp), 0) AS revenue_gbp,
        COALESCE(SUM(orders), 0) AS orders
      FROM bs_revenue_hourly
      WHERE hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)${revFilterSql}
      GROUP BY source, campaign_id, adgroup_id
    `,
    revParams
  );

  // Spend (Google Ads rollups)
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
        COALESCE(SUM(impressions), 0) AS impressions
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

  // Apply revenue
  for (const r of revRows || []) {
    const campaignId = r && r.campaign_id != null ? String(r.campaign_id) : '';
    const adgroupId = r && r.adgroup_id != null ? String(r.adgroup_id) : '';
    if (!campaignId || !adgroupId) continue;
    const camp = ensureCampaign(campaignId);
    const ag = ensureAdgroup(camp, adgroupId);

    const revenue = r && r.revenue_gbp != null ? Number(r.revenue_gbp) : 0;
    const orders = r && r.orders != null ? Number(r.orders) : 0;
    const rev = Number.isFinite(revenue) ? revenue : 0;
    const ord = Number.isFinite(orders) ? orders : 0;

    camp.revenue += rev;
    camp.orders += ord;
    ag.revenue += rev;
    ag.orders += ord;
  }

  // Apply spend
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
    ? 'No rollup/spend data yet. Run /api/ads/refresh to backfill revenue rollups.'
    : null;

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
      conversions: null,
      revenue: Math.round(totalsRevenue * 100) / 100,
      profit: Math.round((totalsRevenue - totalsSpend) * 100) / 100,
      roas: totalsSpend > 0 ? (totalsRevenue / totalsSpend) : null,
    },
    campaigns,
    orders: Math.floor(totalsOrders || 0),
    note,
  };
}

module.exports = {
  normalizeRangeKey,
  getStatus,
  getSummary,
};
