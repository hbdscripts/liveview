const fx = require('../fx');
const store = require('../store');
const salesTruth = require('../salesTruth');
const { getDb } = require('../db');
const { getAdsDb } = require('./adsDb');

function normalizeSource(v) {
  const s = v != null ? String(v).trim().toLowerCase() : '';
  return s || null;
}

function normalizeCountryCode(v) {
  const s = v != null ? String(v).trim().toUpperCase() : '';
  if (s.length !== 2) return null;
  if (s === 'XX' || s === 'T1') return null;
  return s;
}

function safeUrlParams(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    return new URL(raw).searchParams;
  } catch (_) {
    // Handle schemeless URLs like "example.com/path"
    try {
      return new URL('https://' + raw).searchParams;
    } catch (_) {
      // Handle relative/path-only URLs like "/?gclid=..." from Shopify landing_site.
      try {
        return new URL(raw, 'https://example.local').searchParams;
      } catch (_) {
        return null;
      }
    }
  }
}

function trimParam(params, key, maxLen = 256) {
  try {
    const v = params ? params.get(key) : null;
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  } catch (_) {
    return null;
  }
}

function extractGclidLike(params) {
  // Prefer gclid, but also allow iOS privacy click IDs.
  const gclid = trimParam(params, 'gclid', 256);
  const gbraid = trimParam(params, 'gbraid', 256);
  const wbraid = trimParam(params, 'wbraid', 256);
  return { gclid, gbraid, wbraid };
}

function pickClickId(gclidLike) {
  const gl = gclidLike || {};
  if (gl.gclid) return { id: String(gl.gclid).trim(), kind: 'gclid' };
  if (gl.gbraid) return { id: String(gl.gbraid).trim(), kind: 'gbraid' };
  if (gl.wbraid) return { id: String(gl.wbraid).trim(), kind: 'wbraid' };
  return { id: null, kind: null };
}

function looksLikeGoogleAds({ bsSource, utmSource, gclidLike } = {}) {
  if (gclidLike && (gclidLike.gclid || gclidLike.gbraid || gclidLike.wbraid)) return true;
  const a = (bsSource || '').toLowerCase();
  const b = (utmSource || '').toLowerCase();
  const s = a || b;
  if (!s) return false;
  return s.includes('google') || s.includes('adwords') || s.includes('googleads');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function looksLikeGoogleAdsSource(v) {
  const s = v != null ? String(v).trim().toLowerCase() : '';
  if (!s) return false;
  return s.includes('googleads') || s === 'google' || s.includes('adwords') || s.includes('google');
}

async function getGclidMappingCached(adsDb, cache, gclid) {
  const key = gclid != null ? String(gclid).trim() : '';
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  try {
    const row = await adsDb.get(
      'SELECT campaign_id, adgroup_id FROM gclid_campaign_cache WHERE gclid = ? LIMIT 1',
      [key]
    );
    const out = row && row.campaign_id ? { campaignId: String(row.campaign_id), adgroupId: row.adgroup_id ? String(row.adgroup_id) : null } : null;
    cache.set(key, out);
    return out;
  } catch (_) {
    cache.set(key, null);
    return null;
  }
}

function deriveAttributionFromUrl(url, { adsDb = null, gclidCache = null } = {}) {
  const landingSite = typeof url === 'string' ? url.trim() : '';
  if (!landingSite) return { ok: false };

  const bsIds = store.extractBsAdsIdsFromEntryUrl(landingSite);
  if (bsIds && bsIds.bsCampaignId) {
    return {
      ok: true,
      bsSource: bsIds.bsSource || null,
      campaignId: String(bsIds.bsCampaignId),
      adgroupId: bsIds.bsAdgroupId ? String(bsIds.bsAdgroupId) : '_all_',
      adId: bsIds.bsAdId ? String(bsIds.bsAdId) : null,
      gclid: null,
      attributionMethod: 'url.bs_campaign_id',
    };
  }

  const params = safeUrlParams(landingSite);
  const utmSource = trimParam(params, 'utm_source', 64);
  const utmId = trimParam(params, 'utm_id', 64);
  if (utmId && /^\d{4,}$/.test(utmId)) {
    return {
      ok: true,
      bsSource: bsIds && bsIds.bsSource ? bsIds.bsSource : (utmSource ? utmSource.toLowerCase() : null),
      campaignId: utmId,
      adgroupId: '_all_',
      adId: null,
      gclid: null,
      attributionMethod: 'url.utm_id',
    };
  }

  const utmCampaign = trimParam(params, 'utm_campaign', 128);
  if (utmCampaign && /^\d{4,}$/.test(utmCampaign)) {
    return {
      ok: true,
      bsSource: bsIds && bsIds.bsSource ? bsIds.bsSource : (utmSource ? utmSource.toLowerCase() : null),
      campaignId: utmCampaign,
      adgroupId: '_all_',
      adId: null,
      gclid: null,
      attributionMethod: 'url.utm_campaign_numeric',
    };
  }

  const gclidLike = extractGclidLike(params);
  const gclid = gclidLike.gclid || null;

  return {
    ok: true,
    bsSource: bsIds && bsIds.bsSource ? bsIds.bsSource : (utmSource ? utmSource.toLowerCase() : null),
    campaignId: null,
    adgroupId: null,
    adId: null,
    gclid,
    gclidLike,
    attributionMethod: 'url.no_campaign',
    // Mapping via cache handled by caller (async)
  };
}

/**
 * Sync Shopify truth orders into Ads DB with campaign attribution.
 *
 * Writes one row per order into ads DB table `ads_orders_attributed` so Ads reporting can be served
 * from Ads DB only (no report-time joins to the main DB).
 */
async function syncAttributedOrdersToAdsDb(options = {}) {
  const rangeStartTs = options.rangeStartTs != null ? Number(options.rangeStartTs) : null;
  const rangeEndTs = options.rangeEndTs != null ? Number(options.rangeEndTs) : null;
  const source = normalizeSource(options.source) || 'googleads';

  if (!rangeStartTs || !rangeEndTs || !Number.isFinite(rangeStartTs) || !Number.isFinite(rangeEndTs) || rangeEndTs <= rangeStartTs) {
    return { ok: false, error: 'Missing/invalid rangeStartTs/rangeEndTs' };
  }

  const shop = salesTruth.resolveShopForSales(options.shop || '');
  if (!shop) return { ok: false, error: 'No shop configured' };

  const db = getDb();
  if (!db) return { ok: false, error: 'Main DB not available' };

  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set' };

  // 1) Load Shopify truth orders for this range.
  const orders = await db.all(
    `
      SELECT shop, order_id, order_name, created_at, currency, total_price, checkout_token, raw_json
      FROM orders_shopify
      WHERE shop = ?
        AND created_at >= ? AND created_at < ?
        AND (test IS NULL OR test = 0)
        AND cancelled_at IS NULL
        AND financial_status = 'paid'
      ORDER BY created_at ASC
    `,
    [shop, rangeStartTs, rangeEndTs]
  );

  if (!orders || !orders.length) {
    return { ok: true, shop, rangeStartTs, rangeEndTs, source, scannedOrders: 0, upserts: 0, attributed: 0, unattributed: 0 };
  }

  const ratesToGbp = await fx.getRatesToGbp();
  const gclidCache = new Map();

  const parsed = [];
  const needEvidence = [];

  for (const row of orders) {
    const orderId = row && row.order_id != null ? String(row.order_id).trim() : '';
    const createdAtMs = row && row.created_at != null ? Number(row.created_at) : null;
    if (!orderId || createdAtMs == null || !Number.isFinite(createdAtMs)) continue;

    const currencyRaw = row && row.currency != null ? String(row.currency).trim() : '';
    const currency = fx.normalizeCurrency(currencyRaw) || 'GBP';
    const totalPrice = row && row.total_price != null ? Number(row.total_price) : 0;
    const totalNum = Number.isFinite(totalPrice) ? totalPrice : 0;
    const gbp = fx.convertToGbp(totalNum, currency, ratesToGbp);
    const revenueGbp = (typeof gbp === 'number' && Number.isFinite(gbp)) ? Math.round(gbp * 100) / 100 : 0;

    let orderJson = null;
    try { orderJson = row && typeof row.raw_json === 'string' ? JSON.parse(row.raw_json) : null; } catch (_) { orderJson = null; }
    const landingSite = (orderJson && (orderJson.landing_site || orderJson.landingSite)) ? String(orderJson.landing_site || orderJson.landingSite).trim() : '';
    const params = safeUrlParams(landingSite);

    const bsIds = store.extractBsAdsIdsFromEntryUrl(landingSite);
    const utmSource = trimParam(params, 'utm_source', 64);
    const gclidLike = extractGclidLike(params);
    const picked = pickClickId(gclidLike);
    const clickId = picked && picked.id ? String(picked.id) : null;
    const clickKind = picked && picked.kind ? String(picked.kind) : null;
    const sourceHint = (bsIds && bsIds.bsSource) ? bsIds.bsSource : (utmSource ? utmSource.toLowerCase() : null);

    // Country code (best-effort): shipping_address, then billing_address.
    const cc =
      normalizeCountryCode(orderJson?.shipping_address?.country_code) ||
      normalizeCountryCode(orderJson?.billing_address?.country_code) ||
      null;

    const urlAttrib = deriveAttributionFromUrl(landingSite);
    let campaignId = urlAttrib && urlAttrib.campaignId ? String(urlAttrib.campaignId).trim() : null;
    let adgroupId = urlAttrib && urlAttrib.adgroupId ? String(urlAttrib.adgroupId).trim() : null;
    let adId = urlAttrib && urlAttrib.adId ? String(urlAttrib.adId).trim() : null;
    let gclid = clickId || (urlAttrib && urlAttrib.gclid ? String(urlAttrib.gclid).trim() : null);
    let attributionMethod = urlAttrib && urlAttrib.attributionMethod ? String(urlAttrib.attributionMethod) : null;
    let isGoogleAds = looksLikeGoogleAds({ bsSource: sourceHint, utmSource, gclidLike });

    // If URL had a gclid but no explicit campaign, try cache mapping.
    if (!campaignId && gclid) {
      const mapping = await getGclidMappingCached(adsDb, gclidCache, gclid);
      if (mapping && mapping.campaignId) {
        campaignId = mapping.campaignId;
        adgroupId = mapping.adgroupId || adgroupId || '_all_';
        attributionMethod = 'landing_site.' + (clickKind || 'click_id') + '_cache';
        isGoogleAds = true;
      } else {
        attributionMethod = attributionMethod || ('landing_site.' + (clickKind || 'click_id') + '_unmapped');
      }
    }

    const out = {
      shop,
      orderId,
      createdAtMs,
      currency,
      totalPrice: Math.round(totalNum * 100) / 100,
      revenueGbp,
      // Source is established from landing_site when possible, otherwise evidence may fill it in later.
      source: isGoogleAds ? source : null,
      campaignId: campaignId || null,
      adgroupId: adgroupId || (campaignId ? '_all_' : null),
      adId: adId || null,
      gclid: gclid || null,
      countryCode: cc,
      sessionId: null,
      visitorCountryCode: null,
      visitorDeviceType: null,
      attributionMethod: attributionMethod || (campaignId ? 'landing_site' : null),
      landingSite: landingSite || null,
      checkoutToken: row && row.checkout_token ? String(row.checkout_token).trim() : null,
    };

    parsed.push(out);
    // Evidence can link orders -> sessions for attribution + visitor-location geo.
    // Limit lookups to checkout orders (best-effort proxy for online orders that have pixel evidence).
    if (out.checkoutToken && (out.source === source || !out.campaignId || !out.source)) needEvidence.push(out);
  }

  // 2) Evidence fallback: purchase_events (linked_order_id) -> sessions (bs_campaign_id).
  const orderIdToEvidence = new Map();
  if (needEvidence.length) {
    const orderIds = Array.from(new Set(needEvidence.map(o => o.orderId).filter(Boolean)));
    for (const ids of chunk(orderIds, 500)) {
      const placeholders = ids.map(() => '?').join(',');
      const rows = await db.all(
        `
          SELECT linked_order_id, session_id, page_url, occurred_at
          FROM purchase_events
          WHERE shop = ?
            AND linked_order_id IN (${placeholders})
          ORDER BY occurred_at DESC
        `,
        [shop, ...ids]
      );
      for (const r of rows || []) {
        const oid = r && r.linked_order_id != null ? String(r.linked_order_id).trim() : '';
        if (!oid) continue;
        if (orderIdToEvidence.has(oid)) continue; // keep most recent (query is DESC)
        orderIdToEvidence.set(oid, {
          sessionId: r && r.session_id != null ? String(r.session_id).trim() : null,
          pageUrl: r && r.page_url != null ? String(r.page_url).trim() : null,
        });
      }
    }

    // Fallback: if evidence wasn't linked yet, also try lookup by checkout_token.
    const missing = needEvidence.filter(o => o && o.orderId && o.checkoutToken && !orderIdToEvidence.has(o.orderId));
    const tokens = Array.from(new Set(missing.map(o => o.checkoutToken).filter(Boolean)));
    for (const tks of chunk(tokens, 500)) {
      const placeholders = tks.map(() => '?').join(',');
      const rows = await db.all(
        `
          SELECT checkout_token, session_id, page_url, occurred_at
          FROM purchase_events
          WHERE shop = ?
            AND checkout_token IN (${placeholders})
          ORDER BY occurred_at DESC
        `,
        [shop, ...tks]
      );
      const tokenToRow = new Map();
      for (const r of rows || []) {
        const tk = r && r.checkout_token != null ? String(r.checkout_token).trim() : '';
        if (!tk) continue;
        if (tokenToRow.has(tk)) continue; // keep most recent
        tokenToRow.set(tk, r);
      }
      for (const o of missing) {
        if (!o || !o.orderId || !o.checkoutToken) continue;
        if (orderIdToEvidence.has(o.orderId)) continue;
        const r = tokenToRow.get(o.checkoutToken);
        if (!r) continue;
        orderIdToEvidence.set(o.orderId, {
          sessionId: r && r.session_id != null ? String(r.session_id).trim() : null,
          pageUrl: r && r.page_url != null ? String(r.page_url).trim() : null,
        });
      }
    }
  }

  const sessionIds = [];
  for (const ev of orderIdToEvidence.values()) {
    if (ev && ev.sessionId) sessionIds.push(ev.sessionId);
  }
  const uniqueSessionIds = Array.from(new Set(sessionIds));
  const sessionMap = new Map();
  for (const ids of chunk(uniqueSessionIds, 800)) {
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.all(
      `SELECT session_id, visitor_id, started_at, country_code, cf_country, ua_device_type, bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id, utm_source, entry_url FROM sessions WHERE session_id IN (${placeholders})`,
      ids
    );
    for (const r of rows || []) {
      const sid = r && r.session_id != null ? String(r.session_id).trim() : '';
      if (!sid) continue;
      sessionMap.set(sid, {
        visitorId: r && r.visitor_id != null ? String(r.visitor_id).trim() : null,
        startedAt: r && r.started_at != null ? Number(r.started_at) : null,
        countryCode: r && r.country_code != null ? String(r.country_code).trim().toUpperCase() : null,
        cfCountry: r && r.cf_country != null ? String(r.cf_country).trim().toUpperCase() : null,
        uaDeviceType: r && r.ua_device_type != null ? String(r.ua_device_type).trim().toLowerCase() : null,
        bsSource: r && r.bs_source != null ? String(r.bs_source).trim().toLowerCase() : null,
        bsCampaignId: r && r.bs_campaign_id != null ? String(r.bs_campaign_id).trim() : null,
        bsAdgroupId: r && r.bs_adgroup_id != null ? String(r.bs_adgroup_id).trim() : null,
        bsAdId: r && r.bs_ad_id != null ? String(r.bs_ad_id).trim() : null,
        utmSource: r && r.utm_source != null ? String(r.utm_source).trim().toLowerCase() : null,
        entryUrl: r && r.entry_url != null ? String(r.entry_url).trim() : null,
      });
    }
  }

  let attributed = 0;
  let unattributed = 0;

  async function findLastGoogleAdsClickForVisitor(visitorId, beforeMs) {
    const vid = visitorId != null ? String(visitorId).trim() : '';
    const before = beforeMs != null ? Number(beforeMs) : null;
    if (!vid || before == null || !Number.isFinite(before)) return null;

    const WINDOW_DAYS = 30;
    const minMs = before - WINDOW_DAYS * 24 * 60 * 60 * 1000;

    try {
      const row = await db.get(
        `
          SELECT
            session_id,
            started_at,
            country_code,
            cf_country,
            ua_device_type,
            bs_source,
            utm_source,
            bs_campaign_id,
            bs_adgroup_id,
            bs_ad_id,
            entry_url
          FROM sessions
          WHERE visitor_id = ?
            AND started_at >= ? AND started_at < ?
            AND NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL
          ORDER BY started_at DESC
          LIMIT 1
        `,
        [vid, minMs, before]
      );
      if (!row || !row.bs_campaign_id) return null;
      const bsSource = row.bs_source != null ? String(row.bs_source).trim().toLowerCase() : '';
      const utmSource = row.utm_source != null ? String(row.utm_source).trim().toLowerCase() : '';
      const entryUrl = row.entry_url != null ? String(row.entry_url).trim() : '';
      const params = safeUrlParams(entryUrl);
      const gl = extractGclidLike(params);
      if (!looksLikeGoogleAds({ bsSource, utmSource, gclidLike: gl }) && !looksLikeGoogleAdsSource(bsSource) && !looksLikeGoogleAdsSource(utmSource)) {
        return null;
      }
      const visitorCountryCode =
        normalizeCountryCode(row && row.country_code != null ? row.country_code : null) ||
        normalizeCountryCode(row && row.cf_country != null ? row.cf_country : null) ||
        null;
      const visitorDeviceType = (row && row.ua_device_type != null) ? String(row.ua_device_type).trim().toLowerCase() : null;
      return {
        sessionId: row && row.session_id != null ? String(row.session_id).trim() : null,
        startedAt: row.started_at != null ? Number(row.started_at) : null,
        bsCampaignId: row.bs_campaign_id != null ? String(row.bs_campaign_id).trim() : null,
        bsAdgroupId: row.bs_adgroup_id != null ? String(row.bs_adgroup_id).trim() : null,
        bsAdId: row.bs_ad_id != null ? String(row.bs_ad_id).trim() : null,
        visitorCountryCode,
        visitorDeviceType,
      };
    } catch (_) {
      return null;
    }
  }

  // Apply evidence attribution (and establish source when landing_site didn't include it).
  for (const o of parsed) {
    if (!o) continue;
    const ev = orderIdToEvidence.get(o.orderId);
    const sess = ev && ev.sessionId ? sessionMap.get(ev.sessionId) : null;

    // Persist visitor-location geo when we can link to a session.
    if (ev && ev.sessionId && !o.sessionId) o.sessionId = ev.sessionId;
    if (sess && !o.visitorCountryCode) {
      const vcc = normalizeCountryCode(sess.countryCode) || normalizeCountryCode(sess.cfCountry) || null;
      if (vcc) o.visitorCountryCode = vcc;
    }
    if (sess && !o.visitorDeviceType) {
      const dt = sess.uaDeviceType ? String(sess.uaDeviceType).trim().toLowerCase() : '';
      if (dt) o.visitorDeviceType = dt;
    }

    // If we already have campaign + source, we only needed the session linkage above.
    if (o.campaignId && o.source) continue;

    if (!o.source) {
      const sessSource = sess && sess.bsSource ? String(sess.bsSource) : '';
      const evAttrib = ev && ev.pageUrl ? deriveAttributionFromUrl(ev.pageUrl) : null;
      const evUtmSource = evAttrib && evAttrib.bsSource ? String(evAttrib.bsSource) : '';
      const gclidLike = evAttrib && evAttrib.gclidLike ? evAttrib.gclidLike : null;
      if (looksLikeGoogleAds({ bsSource: sessSource, utmSource: evUtmSource, gclidLike })) {
        o.source = source;
        if (!o.attributionMethod) o.attributionMethod = 'purchase_events.source';
      }
    }

    if (sess && sess.bsCampaignId && !o.campaignId) {
      o.campaignId = sess.bsCampaignId;
      o.adgroupId = sess.bsAdgroupId || '_all_';
      o.adId = sess.bsAdId || null;
      o.attributionMethod = 'purchase_events.session.bs_campaign_id';
      attributed++;
      continue;
    }

    // If session has click ids in entry_url (gclid/gbraid/wbraid) but bs_campaign_id wasn't filled, use cache.
    if (!o.campaignId && sess && sess.entryUrl) {
      const sp = safeUrlParams(sess.entryUrl);
      const gl = extractGclidLike(sp);
      const picked = pickClickId(gl);
      if (picked && picked.id) {
        o.gclid = o.gclid || picked.id;
        const mapping = await getGclidMappingCached(adsDb, gclidCache, picked.id);
        if (mapping && mapping.campaignId) {
          o.campaignId = mapping.campaignId;
          o.adgroupId = mapping.adgroupId || '_all_';
          if (!o.attributionMethod) o.attributionMethod = 'purchase_events.session.' + (picked.kind || 'click_id') + '_cache';
          attributed++;
          continue;
        }
      }
    }

    // Carry-over (last Google Ads click): attribute direct/returning purchases that lost UTMs on the purchase session.
    if (!o.campaignId && sess && sess.visitorId) {
      const last = await findLastGoogleAdsClickForVisitor(sess.visitorId, o.createdAtMs);
      if (last && last.bsCampaignId) {
        o.source = o.source || source;
        o.campaignId = last.bsCampaignId;
        o.adgroupId = last.bsAdgroupId || '_all_';
        o.adId = last.bsAdId || null;
        if (last.sessionId && !o.sessionId) o.sessionId = last.sessionId;
        if (last.visitorCountryCode && !o.visitorCountryCode) o.visitorCountryCode = last.visitorCountryCode;
        if (last.visitorDeviceType && !o.visitorDeviceType) o.visitorDeviceType = last.visitorDeviceType;
        o.attributionMethod = 'visitor.last_ads_click';
        attributed++;
        continue;
      }
    }

    // Fallback: parse page_url for tracking params.
    const pageUrl = ev && ev.pageUrl ? ev.pageUrl : null;
    if (pageUrl) {
      const urlAttrib = deriveAttributionFromUrl(pageUrl);
      if (urlAttrib && urlAttrib.campaignId) {
        o.campaignId = urlAttrib.campaignId;
        o.adgroupId = urlAttrib.adgroupId || '_all_';
        o.adId = urlAttrib.adId || null;
        o.attributionMethod = 'purchase_events.page_url.' + (urlAttrib.attributionMethod || 'url');
        attributed++;
        continue;
      }
      const picked = pickClickId(urlAttrib && urlAttrib.gclidLike ? urlAttrib.gclidLike : null);
      const clickId = picked && picked.id ? picked.id : (urlAttrib && urlAttrib.gclid ? urlAttrib.gclid : null);
      if (!o.campaignId && clickId) {
        o.gclid = o.gclid || clickId;
        const mapping = await getGclidMappingCached(adsDb, gclidCache, clickId);
        if (mapping && mapping.campaignId) {
          o.campaignId = mapping.campaignId;
          o.adgroupId = mapping.adgroupId || '_all_';
          o.attributionMethod = 'purchase_events.page_url.' + ((picked && picked.kind) ? picked.kind : 'click_id') + '_cache';
          attributed++;
          continue;
        }
      }
    }

    if (o.source && !o.campaignId) unattributed++;
  }

  // 3) Upsert to Ads DB.
  const now = Date.now();
  let upserts = 0;
  for (const o of parsed) {
    if (!o || !o.source) continue; // only persist this provider’s attributed universe
    await adsDb.run(
      `
        INSERT INTO ads_orders_attributed
          (shop, order_id, created_at_ms, currency, total_price, revenue_gbp, source, campaign_id, adgroup_id, ad_id, gclid, country_code, attribution_method, landing_site, session_id, visitor_country_code, visitor_device_type, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (shop, order_id) DO UPDATE SET
          created_at_ms = EXCLUDED.created_at_ms,
          currency = EXCLUDED.currency,
          total_price = EXCLUDED.total_price,
          revenue_gbp = EXCLUDED.revenue_gbp,
          source = COALESCE(NULLIF(EXCLUDED.source, ''), ads_orders_attributed.source),
          campaign_id = COALESCE(NULLIF(EXCLUDED.campaign_id, ''), ads_orders_attributed.campaign_id),
          adgroup_id = COALESCE(NULLIF(EXCLUDED.adgroup_id, ''), ads_orders_attributed.adgroup_id),
          ad_id = COALESCE(NULLIF(EXCLUDED.ad_id, ''), ads_orders_attributed.ad_id),
          gclid = COALESCE(NULLIF(EXCLUDED.gclid, ''), ads_orders_attributed.gclid),
          country_code = COALESCE(NULLIF(EXCLUDED.country_code, ''), ads_orders_attributed.country_code),
          session_id = COALESCE(NULLIF(EXCLUDED.session_id, ''), ads_orders_attributed.session_id),
          visitor_country_code = COALESCE(NULLIF(EXCLUDED.visitor_country_code, ''), ads_orders_attributed.visitor_country_code),
          visitor_device_type = COALESCE(NULLIF(EXCLUDED.visitor_device_type, ''), ads_orders_attributed.visitor_device_type),
          attribution_method = COALESCE(NULLIF(EXCLUDED.attribution_method, ''), ads_orders_attributed.attribution_method),
          landing_site = COALESCE(NULLIF(EXCLUDED.landing_site, ''), ads_orders_attributed.landing_site),
          updated_at = EXCLUDED.updated_at
      `,
      [
        o.shop,
        o.orderId,
        Math.trunc(o.createdAtMs),
        o.currency || null,
        o.totalPrice != null ? Number(o.totalPrice) : null,
        o.revenueGbp != null ? Number(o.revenueGbp) : 0,
        o.source || null,
        o.campaignId || null,
        o.adgroupId || null,
        o.adId || null,
        o.gclid || null,
        o.countryCode || null,
        o.attributionMethod || null,
        o.landingSite || null,
        o.sessionId || null,
        o.visitorCountryCode || null,
        o.visitorDeviceType || null,
        now,
      ]
    );
    upserts++;
  }

  const persisted = parsed.filter(o => o && o.source).length;
  const persistedAttributed = parsed.filter(o => o && o.source && o.campaignId).length;

  return {
    ok: true,
    shop,
    rangeStartTs,
    rangeEndTs,
    source,
    scannedOrders: orders.length,
    persistedOrders: persisted,
    attributedOrders: persistedAttributed,
    unattributedOrders: Math.max(0, persisted - persistedAttributed),
    upserts,
  };
}

module.exports = {
  syncAttributedOrdersToAdsDb,
};

