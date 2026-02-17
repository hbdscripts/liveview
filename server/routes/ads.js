const Sentry = require('@sentry/node');
const express = require('express');
const adsService = require('../ads/adsService');
const store = require('../store');
const salesTruth = require('../salesTruth');
const { buildGoogleAdsConnectUrl, handleGoogleAdsCallback } = require('../ads/googleAdsOAuth');
const { syncGoogleAdsSpendHourly, syncGoogleAdsGeoDaily, syncGoogleAdsDeviceDaily, backfillCampaignIdsFromGclid, testGoogleAdsConnection } = require('../ads/googleAdsSpendSync');
const { syncAttributedOrdersToAdsDb } = require('../ads/adsOrderAttributionSync');
const { setGoogleAdsConfig } = require('../ads/adsStore');
const { provisionGoals, getConversionGoals } = require('../ads/googleAdsGoals');
const { fetchDiagnostics, getCachedDiagnostics } = require('../ads/googleAdsDiagnostics');
const { getAdsDb } = require('../ads/adsDb');

const router = express.Router();

router.get('/google/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const redirect = (req.query && req.query.redirect) ? String(req.query.redirect) : '';
    const shop = (req.query && req.query.shop) ? String(req.query.shop).trim() : '';
    const customerId = (req.query && req.query.customer_id) != null ? String(req.query.customer_id) : undefined;
    const loginCustomerId = (req.query && req.query.login_customer_id) != null ? String(req.query.login_customer_id) : undefined;
    const conversionCustomerId = (req.query && req.query.conversion_customer_id) != null ? String(req.query.conversion_customer_id) : undefined;
    const out = buildGoogleAdsConnectUrl({ redirect, shop, customer_id: customerId, login_customer_id: loginCustomerId, conversion_customer_id: conversionCustomerId });
    if (!out || !out.ok || !out.url) {
      res.status(400).send((out && out.error) ? String(out.error) : 'OAuth not configured');
      return;
    }
    res.redirect(302, out.url);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.connect' } });
    console.error('[ads.google.connect]', err);
    res.status(500).send('Internal error');
  }
});

router.get('/google/callback', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const result = await handleGoogleAdsCallback(req.query || {});
    const redirect = result && result.redirect ? String(result.redirect) : '/';
    if (!result || !result.ok) {
      const e = result && result.error ? String(result.error) : 'oauth_failed';
      res.redirect(302, redirect + (redirect.includes('?') ? '&' : '?') + 'ads_oauth=' + encodeURIComponent(e));
      return;
    }
    res.redirect(302, redirect + (redirect.includes('?') ? '&' : '?') + 'ads_oauth=ok');
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.callback' } });
    console.error('[ads.google.callback]', err);
    res.status(500).send('Internal error');
  }
});

router.post('/google/disconnect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || (req.query && req.query.shop != null ? String(req.query.shop).trim() : '') || salesTruth.resolveShopForSales('');
    await setGoogleAdsConfig({}, shop);
    res.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.disconnect' } });
    console.error('[ads.google.disconnect]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/google/test-connection', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const out = await testGoogleAdsConnection(shop);
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.test-connection' } });
    console.error('[ads.google.test-connection]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/google/goals', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const goals = await getConversionGoals(shop);
    res.json({ ok: true, goals });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.goals' } });
    console.error('[ads.google.goals]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/google/provision-goals', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || (req.query && req.query.shop != null ? String(req.query.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const out = await provisionGoals(shop);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'provision failed' });
      return;
    }
    const goals = await getConversionGoals(shop);
    res.json({ ok: true, goals: out.goals, persisted: goals });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.provision-goals' } });
    console.error('[ads.google.provision-goals]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/google/diagnostics', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const fresh = req.query && req.query.fresh === '1';
    if (fresh) {
      const out = await fetchDiagnostics(shop, { cache: true });
      res.json(out);
      return;
    }
    const cached = await getCachedDiagnostics(shop);
    if (cached) {
      res.json({ ok: true, clientSummary: cached.clientSummary, actionSummaries: cached.actionSummaries, fetched_at: cached.fetched_at, cached: true });
      return;
    }
    const out = await fetchDiagnostics(shop, { cache: true });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.diagnostics' } });
    console.error('[ads.google.diagnostics]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/google/goal-health', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const normShop = String(shop || '').trim().toLowerCase();
    const db = getAdsDb();
    const goals = await getConversionGoals(shop);
    const coverage7d = { revenue: { queued: 0, success: 0, failure: 0, pending: 0 }, profit: { queued: 0, success: 0, failure: 0, pending: 0 } };
    const coverage30d = { revenue: { queued: 0, success: 0, failure: 0, pending: 0 }, profit: { queued: 0, success: 0, failure: 0, pending: 0 } };
    let missingClickIdCount = 0;
    let failedUploadCount = 0;
    if (db && normShop) {
      const now = Date.now();
      const ms7d = 7 * 24 * 60 * 60 * 1000;
      const ms30d = 30 * 24 * 60 * 60 * 1000;
      const cutoff7d = now - ms7d;
      const cutoff30d = now - ms30d;
      for (const goal of ['revenue', 'profit']) {
        const r7 = await db.all(
          `SELECT status, COUNT(*) AS c FROM google_ads_postback_jobs WHERE shop = ? AND goal_type = ? AND created_at >= ? GROUP BY status`,
          [normShop, goal, cutoff7d]
        );
        for (const r of r7 || []) {
          const c = Number(r.c) || 0;
          if (r.status === 'pending' || r.status === 'retry') coverage7d[goal].pending += c;
          else if (r.status === 'success') coverage7d[goal].success += c;
          else if (r.status === 'failed') coverage7d[goal].failure += c;
        }
        const r30 = await db.all(
          `SELECT status, COUNT(*) AS c FROM google_ads_postback_jobs WHERE shop = ? AND goal_type = ? AND created_at >= ? GROUP BY status`,
          [normShop, goal, cutoff30d]
        );
        for (const r of r30 || []) {
          const c = Number(r.c) || 0;
          if (r.status === 'pending' || r.status === 'retry') coverage30d[goal].pending += c;
          else if (r.status === 'success') coverage30d[goal].success += c;
          else if (r.status === 'failed') coverage30d[goal].failure += c;
        }
      }
      const missingRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open' AND error_code = 'MISSING_CLICK_ID'`,
        [normShop]
      );
      missingClickIdCount = missingRow && missingRow.c != null ? Number(missingRow.c) : 0;
      const failedRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open' AND error_code = 'UPLOAD_FAILED'`,
        [normShop]
      );
      failedUploadCount = failedRow && failedRow.c != null ? Number(failedRow.c) : 0;
    }
    const diagnostics = await getCachedDiagnostics(shop);
    res.json({
      ok: true,
      goals,
      coverage_7d: coverage7d,
      coverage_30d: coverage30d,
      reconciliation: { missing_click_id_orders: missingClickIdCount, failed_uploads: failedUploadCount },
      diagnostics: diagnostics ? { clientSummary: diagnostics.clientSummary, actionSummaries: diagnostics.actionSummaries, fetched_at: diagnostics.fetched_at } : null,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.goal-health' } });
    console.error('[ads.google.goal-health]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const out = await adsService.getStatus(shop);
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.status' } });
    console.error('[ads.status]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/summary', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    // Kick off Shopify truth reconcile in the background (summary should return fast).
    // Fresh orders will appear once the scheduled jobs run / next refresh happens.
    try {
      const rangeNorm = adsService.normalizeRangeKey(rangeKey);
      const timeZone = store.resolveAdminTimeZone();
      const bounds = store.getRangeBounds(rangeNorm, Date.now(), timeZone);
      const shop = salesTruth.resolveShopForSales('');
      if (shop) salesTruth.ensureReconciled(shop, bounds.start, bounds.end, rangeNorm).catch(() => {});
    } catch (_) {}
    const out = await adsService.getSummary({ rangeKey });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.summary', rangeKey } });
    console.error('[ads.summary]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/audit', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    const out = await adsService.getAudit({ rangeKey });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.audit' } });
    console.error('[ads.audit]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/debug-landing-sites', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const mainDb = require('../db').getDb();
    if (!mainDb) return res.json({ ok: false, error: 'No main DB' });
    const rows = await mainDb.all(
      `SELECT order_id, order_name, total_price, currency, created_at, raw_json
       FROM orders_shopify
       WHERE financial_status IN ('paid', 'partially_refunded')
         AND cancelled_at IS NULL
       ORDER BY created_at DESC
       LIMIT 20`
    );
    const samples = (rows || []).map(r => {
      let landingSite = '', referringSite = '';
      try {
        const json = typeof r.raw_json === 'string' ? JSON.parse(r.raw_json) : null;
        landingSite = (json && (json.landing_site || json.landingSite)) || '';
        referringSite = (json && (json.referring_site || json.referringSite)) || '';
      } catch (_) {}
      const bsIds = store.extractBsAdsIdsFromEntryUrl(landingSite);
      const gclidMatch = String(landingSite).match(/[?&]gclid=([^&]+)/);
      // Also try the broader campaign extraction (utm_id, utm_campaign)
      let utmCampaignId = null;
      try {
        let params = null;
        try { params = new URL(landingSite).searchParams; } catch (_) {
          try { params = new URL(landingSite, 'https://x.local').searchParams; } catch (_) {}
        }
        if (params) {
          utmCampaignId = (params.get('utm_id') || '').trim() || (params.get('utm_campaign') || '').trim() || null;
        }
      } catch (_) {}
      return {
        orderId: r.order_id,
        orderName: r.order_name,
        totalPrice: r.total_price,
        currency: r.currency,
        createdAt: r.created_at,
        landingSite,
        referringSite,
        extractedBsIds: bsIds,
        utmCampaignId,
        hasGclid: !!gclidMatch,
        gclid: gclidMatch ? decodeURIComponent(gclidMatch[1]).slice(0, 20) + '...' : null,
      };
    });
    res.json({ ok: true, count: samples.length, samples });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.debug-landing-sites' } });
    console.error('[ads.debug-landing-sites]', err);
    res.status(500).json({ ok: false, error: String(err.message).slice(0, 200) });
  }
});

router.get('/campaign-detail', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    const campaignId = req && req.query ? req.query.campaignId : '';
    const out = await adsService.getCampaignDetail({ rangeKey, campaignId });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.campaign-detail' } });
    console.error('[ads.campaign-detail]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/refresh', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  res.status(405).json({
    ok: false,
    error: 'Method not allowed',
    hint: 'Use POST /api/ads/refresh?range=7d (optionally JSON body: {"source":"googleads"}).',
  });
});

router.post('/refresh', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    const rangeNorm = adsService.normalizeRangeKey(rangeKey);
    const now = Date.now();
    const timeZone = store.resolveAdminTimeZone();
    const bounds = store.getRangeBounds(rangeNorm, now, timeZone);

    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const source = body && body.source != null ? String(body.source).trim().toLowerCase() : 'googleads';
    const shop = salesTruth.resolveShopForSales('');

    // 0. Reconcile Shopify orders so fresh sales appear in ads attribution
    try {
      if (shop) {
        await salesTruth.ensureReconciled(shop, bounds.start, bounds.end, rangeNorm);
      }
    } catch (e) {
      console.warn('[ads.refresh] order reconcile failed (non-fatal):', e && e.message ? e.message : e);
    }

    // 1. Sync spend from Google Ads API
    let spend = null;
    try {
      spend = await syncGoogleAdsSpendHourly({ rangeStartTs: bounds.start, rangeEndTs: bounds.end, shop });
    } catch (e) {
      spend = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'spend_sync_failed' };
    }

    // 1b. Sync geo (country) metrics from Google Ads API
    let geo = null;
    try {
      geo = await syncGoogleAdsGeoDaily({ rangeStartTs: bounds.start, rangeEndTs: bounds.end, shop });
    } catch (e) {
      geo = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'geo_sync_failed' };
    }

    // 1c. Sync device metrics from Google Ads API
    let device = null;
    try {
      device = await syncGoogleAdsDeviceDaily({ rangeStartTs: bounds.start, rangeEndTs: bounds.end, shop });
    } catch (e) {
      device = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'device_sync_failed' };
    }

    // 2. Backfill campaign IDs on sessions via gclid → click_view mapping
    let gclidBackfill = null;
    try {
      gclidBackfill = await backfillCampaignIdsFromGclid({
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        shop,
        apiVersion: spend && spend.apiVersion ? spend.apiVersion : '',
      });
    } catch (e) {
      gclidBackfill = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'gclid_backfill_failed' };
    }

    // 3. Attribute Shopify truth orders -> Ads DB (so Ads summary can be served without main DB joins)
    let orderAttribution = null;
    try {
      orderAttribution = await syncAttributedOrdersToAdsDb({
        shop,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        source,
      });
    } catch (e) {
      orderAttribution = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'order_attribution_failed' };
    }

    res.json({ ok: true, rangeKey: rangeNorm, rangeStartTs: bounds.start, rangeEndTs: bounds.end, spend, geo, device, gclidBackfill, orderAttribution });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.refresh' } });
    console.error('[ads.refresh]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
