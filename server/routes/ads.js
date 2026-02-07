const express = require('express');
const adsService = require('../ads/adsService');
const store = require('../store');
const { rollupRevenueHourly } = require('../ads/adsRevenueRollup');
const { buildGoogleAdsConnectUrl, handleGoogleAdsCallback } = require('../ads/googleAdsOAuth');
const { syncGoogleAdsSpendHourly } = require('../ads/googleAdsSpendSync');

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
    const redirect = result && result.redirect ? String(result.redirect) : '/app/live-visitors';
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

    const rollup = await rollupRevenueHourly({ rangeStartTs: bounds.start, rangeEndTs: bounds.end, source });
    let spend = null;
    try {
      spend = await syncGoogleAdsSpendHourly({ rangeStartTs: bounds.start, rangeEndTs: bounds.end });
    } catch (e) {
      spend = { ok: false, error: e && e.message ? String(e.message).slice(0, 220) : 'spend_sync_failed' };
    }
    res.json({ ok: true, rangeKey: rangeNorm, rangeStartTs: bounds.start, rangeEndTs: bounds.end, rollup, spend });
  } catch (err) {
    console.error('[ads.refresh]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
