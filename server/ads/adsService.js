const store = require('../store');
const config = require('../config');
const { getDb } = require('../db');
const fx = require('../fx');
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

  // Revenue — match confirmed Shopify orders to campaigns via landing_site URL
  const mainDb = getDb();
  let revRows = [];
  if (mainDb) {
    // Fetch confirmed orders with their raw_json (contains landing_site)
    const orders = await mainDb.all(
      `SELECT order_id, total_price, currency, raw_json
       FROM orders_shopify
       WHERE created_at >= ? AND created_at < ?
         AND financial_status IN ('paid', 'partially_refunded')
         AND cancelled_at IS NULL`,
      [bounds.start, bounds.end]
    );

    // Load gclid→campaign cache from ads DB
    let gclidCache = new Map();
    try {
      const cacheRows = await adsDb.all('SELECT gclid, campaign_id, adgroup_id FROM gclid_campaign_cache');
      for (const cr of cacheRows || []) {
        if (cr.gclid && cr.campaign_id) gclidCache.set(cr.gclid, { campaignId: String(cr.campaign_id), adgroupId: cr.adgroup_id || '_all_' });
      }
    } catch (_) {}

    // Match each order to a campaign via landing_site
    const ratesToGbp = await fx.getRatesToGbp();
    const merged = new Map();
    const seenOrderIds = new Set();
    for (const o of orders || []) {
      const oid = o && o.order_id ? String(o.order_id) : '';
      if (!oid || seenOrderIds.has(oid)) continue;

      let landingSite = '';
      try {
        const json = typeof o.raw_json === 'string' ? JSON.parse(o.raw_json) : null;
        landingSite = (json && (json.landing_site || json.landingSite)) || '';
      } catch (_) {}
      if (!landingSite) continue;

      // Try direct bs_campaign_id from landing URL
      const bsIds = store.extractBsAdsIdsFromEntryUrl(landingSite);
      let campaignId = bsIds.bsCampaignId || '';
      let adgroupId = bsIds.bsAdgroupId || '_all_';

      // Fallback: extract gclid and look up in cache
      if (!campaignId) {
        const gclidMatch = String(landingSite).match(/[?&]gclid=([^&]+)/);
        const gclid = gclidMatch ? decodeURIComponent(gclidMatch[1]).trim() : '';
        if (gclid) {
          const mapping = gclidCache.get(gclid);
          if (mapping) {
            campaignId = mapping.campaignId;
            adgroupId = mapping.adgroupId || '_all_';
          }
        }
      }
      if (!campaignId) continue;

      seenOrderIds.add(oid);
      const currency = fx.normalizeCurrency(o.currency) || 'GBP';
      const rawPrice = o.total_price != null ? Number(o.total_price) : 0;
      const priceGbp = fx.convertToGbp(Number.isFinite(rawPrice) ? rawPrice : 0, currency, ratesToGbp);

      const key = campaignId + '\0' + adgroupId;
      const cur = merged.get(key) || { campaign_id: campaignId, adgroup_id: adgroupId, revenue_gbp: 0, orders: 0 };
      cur.revenue_gbp += (typeof priceGbp === 'number' && Number.isFinite(priceGbp)) ? priceGbp : 0;
      cur.orders += 1;
      merged.set(key, cur);
    }
    revRows = Array.from(merged.values());
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

  // Apply live revenue (from main DB purchases → sessions)
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

  // Apply spend + Google conversion revenue (as fallback when bs_revenue_hourly is empty for a campaign)
  for (const r of spendRows || []) {
    const campaignId = r && r.campaign_id != null ? String(r.campaign_id) : '';
    const adgroupId = r && r.adgroup_id != null ? String(r.adgroup_id) : '';
    if (!campaignId || !adgroupId) continue;
    const camp = ensureCampaign(campaignId);
    const ag = ensureAdgroup(camp, adgroupId);

    const spend = r && r.spend_gbp != null ? Number(r.spend_gbp) : 0;
    const clicks = r && r.clicks != null ? Number(r.clicks) : 0;
    const impressions = r && r.impressions != null ? Number(r.impressions) : 0;
    const conv = r && r.conversions != null ? Number(r.conversions) : 0;
    const convVal = r && r.conversions_value_gbp != null ? Number(r.conversions_value_gbp) : 0;
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

    // Use Google conversion revenue if no Kexo-attributed revenue exists for this campaign
    const gcv = Number.isFinite(convVal) ? convVal : 0;
    const gc = Number.isFinite(conv) ? conv : 0;
    if (gcv > 0 && camp.revenue === 0) {
      camp.revenue += gcv;
      camp.orders += Math.round(gc);
      ag.revenue += gcv;
      ag.orders += Math.round(gc);
    }
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
    ? 'No spend data yet. Click ↻ to sync Google Ads. Revenue is attributed live via tracking params (bs_campaign_id).'
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

  // Attributed orders for this campaign (from orders_shopify via landing_site)
  const mainDb = getDb();
  let recentSales = [];
  let revenueHourly = new Map();

  if (mainDb) {
    const orders = await mainDb.all(
      `SELECT order_id, order_name, total_price, currency, created_at, raw_json
       FROM orders_shopify
       WHERE created_at >= ? AND created_at < ?
         AND financial_status IN ('paid', 'partially_refunded')
         AND cancelled_at IS NULL
       ORDER BY created_at DESC`,
      [bounds.start, bounds.end]
    );

    let gclidCache = new Map();
    try {
      const cacheRows = await adsDb.all('SELECT gclid, campaign_id, adgroup_id FROM gclid_campaign_cache');
      for (const cr of cacheRows || []) {
        if (cr.gclid && cr.campaign_id) gclidCache.set(cr.gclid, { campaignId: String(cr.campaign_id), adgroupId: cr.adgroup_id || '_all_' });
      }
    } catch (_) {}

    const ratesToGbp = await fx.getRatesToGbp();
    const seenOrderIds = new Set();

    for (const o of orders || []) {
      const oid = o && o.order_id ? String(o.order_id) : '';
      if (!oid || seenOrderIds.has(oid)) continue;

      let json = null;
      let landingSite = '';
      try {
        json = typeof o.raw_json === 'string' ? JSON.parse(o.raw_json) : null;
        landingSite = (json && (json.landing_site || json.landingSite)) || '';
      } catch (_) {}
      if (!landingSite) continue;

      const bsIds = store.extractBsAdsIdsFromEntryUrl(landingSite);
      let matchedCampaignId = bsIds.bsCampaignId || '';

      if (!matchedCampaignId) {
        const gclidMatch = String(landingSite).match(/[?&]gclid=([^&]+)/);
        const gclid = gclidMatch ? decodeURIComponent(gclidMatch[1]).trim() : '';
        if (gclid) {
          const mapping = gclidCache.get(gclid);
          if (mapping) matchedCampaignId = mapping.campaignId;
        }
      }
      if (matchedCampaignId !== campaignId) continue;

      seenOrderIds.add(oid);
      const cur = fx.normalizeCurrency(o.currency) || 'GBP';
      const rawPrice = o.total_price != null ? Number(o.total_price) : 0;
      const priceGbp = fx.convertToGbp(Number.isFinite(rawPrice) ? rawPrice : 0, cur, ratesToGbp);
      const rev = (typeof priceGbp === 'number' && Number.isFinite(priceGbp)) ? priceGbp : 0;

      // Country from shipping/billing address
      let country = '';
      if (json) {
        const addr = json.shipping_address || json.shippingAddress || json.billing_address || json.billingAddress || {};
        country = addr.country_code || addr.countryCode || addr.country || '';
      }

      // Bucket into hourly for graph
      const createdAt = o.created_at != null ? Number(o.created_at) : 0;
      const hourTs = Math.floor(createdAt / 3600000) * 3600000;
      const prev = revenueHourly.get(hourTs) || 0;
      revenueHourly.set(hourTs, prev + rev);

      // Collect for recent sales list
      recentSales.push({
        orderId: oid,
        orderName: o.order_name || oid,
        country: country ? String(country).toUpperCase() : '',
        value: Math.round(rev * 100) / 100,
        currency,
        time: createdAt,
      });
    }
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
