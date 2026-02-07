const express = require('express');
const adsService = require('../ads/adsService');
const store = require('../store');
const { rollupRevenueHourly } = require('../ads/adsRevenueRollup');
const { buildGoogleAdsConnectUrl, handleGoogleAdsCallback } = require('../ads/googleAdsOAuth');
const { syncGoogleAdsSpendHourly, backfillCampaignIdsFromGclid } = require('../ads/googleAdsSpendSync');

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
    const out = await adsService.getSummary({ rangeKey });
    res.json(out);
  } catch (err) {
    console.error('[ads.summary]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
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

    // 3. Revenue rollup (now picks up sessions with newly-backfilled campaign IDs)
    const rollup = await rollupRevenueHourly({ rangeStartTs: bounds.start, rangeEndTs: bounds.end, source });

    res.json({ ok: true, rangeKey: rangeNorm, rangeStartTs: bounds.start, rangeEndTs: bounds.end, spend, gclidBackfill, rollup });
  } catch (err) {
    console.error('[ads.refresh]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
