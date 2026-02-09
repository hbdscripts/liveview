const express = require('express');
const adsService = require('../ads/adsService');
const store = require('../store');
const salesTruth = require('../salesTruth');
const { buildGoogleAdsConnectUrl, handleGoogleAdsCallback } = require('../ads/googleAdsOAuth');
const { syncGoogleAdsSpendHourly, backfillCampaignIdsFromGclid } = require('../ads/googleAdsSpendSync');
const { syncAttributedOrdersToAdsDb } = require('../ads/adsOrderAttributionSync');

const router = express.Router();

router.get('/google/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const redirect = (req.query && req.query.redirect) ? String(req.query.redirect) : '';
    const out = buildGoogleAdsConnectUrl({ redirect });
    if (!out || !out.ok || !out.url) {
      res.status(400).send((out && out.error) ? String(out.error) : 'OAuth not configured');
      return;
    }
    res.redirect(302, out.url);
  } catch (err) {
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
    console.error('[ads.google.callback]', err);
    res.status(500).send('Internal error');
  }
});

router.get('/status', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const out = await adsService.getStatus();
    res.json(out);
  } catch (err) {
    console.error('[ads.status]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/summary', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    // Ensure Shopify orders are reconciled before building the summary
    try {
      const rangeNorm = adsService.normalizeRangeKey(rangeKey);
      const timeZone = store.resolveAdminTimeZone();
      const bounds = store.getRangeBounds(rangeNorm, Date.now(), timeZone);
      const shop = salesTruth.resolveShopForSales('');
      if (shop) await salesTruth.ensureReconciled(shop, bounds.start, bounds.end, rangeNorm);
    } catch (_) {}
    const out = await adsService.getSummary({ rangeKey });
    res.json(out);
  } catch (err) {
    console.error('[ads.summary]', err);
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
      spend = await syncGoogleAdsSpendHourly({ rangeStartTs: bounds.start, rangeEndTs: bounds.end });
    } catch (e) {
      spend = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'spend_sync_failed' };
    }

    // 2. Backfill campaign IDs on sessions via gclid → click_view mapping
    let gclidBackfill = null;
    try {
      gclidBackfill = await backfillCampaignIdsFromGclid({
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
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

    res.json({ ok: true, rangeKey: rangeNorm, rangeStartTs: bounds.start, rangeEndTs: bounds.end, spend, gclidBackfill, orderAttribution });
  } catch (err) {
    console.error('[ads.refresh]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
