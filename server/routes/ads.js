const Sentry = require('@sentry/node');
const express = require('express');
const adsService = require('../ads/adsService');
const store = require('../store');
const salesTruth = require('../salesTruth');
const config = require('../config');
const { buildGoogleAdsConnectUrl, handleGoogleAdsCallback } = require('../ads/googleAdsOAuth');
const { syncGoogleAdsSpendHourly, syncGoogleAdsGeoDaily, syncGoogleAdsDeviceDaily, backfillCampaignIdsFromGclid, testGoogleAdsConnection } = require('../ads/googleAdsSpendSync');
const { syncAttributedOrdersToAdsDb } = require('../ads/adsOrderAttributionSync');
const { setGoogleAdsConfig } = require('../ads/adsStore');
const { provisionGoals, getConversionGoals } = require('../ads/googleAdsGoals');
const { fetchDiagnostics, getCachedDiagnostics } = require('../ads/googleAdsDiagnostics');
const googleAdsClient = require('../ads/googleAdsClient');
const { getAdsDb } = require('../ads/adsDb');

const router = express.Router();

router.get('/google/connect', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!config.googleAdsOAuthEnabled) {
      res.status(400).send('OAuth disabled. Set GOOGLE_ADS_OAUTH_ENABLED=1 to use Sign in with Google.');
      return;
    }
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
    function maybeAddParam(path, key, value) {
      const raw = path != null ? String(path) : '/';
      const k = key != null ? String(key) : '';
      const v = value != null ? String(value) : '';
      if (!k || !v) return raw;
      try {
        const u = new URL(raw, 'http://kexo.local');
        if (!u.searchParams.get(k)) u.searchParams.set(k, v);
        return u.pathname + (u.search || '') + (u.hash || '');
      } catch (_) {
        if (raw.indexOf(k + '=') >= 0) return raw;
        return raw + (raw.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(v);
      }
    }
    function setParam(path, key, value) {
      const raw = path != null ? String(path) : '/';
      const k = key != null ? String(key) : '';
      const v = value != null ? String(value) : '';
      if (!k) return raw;
      try {
        const u = new URL(raw, 'http://kexo.local');
        u.searchParams.set(k, v);
        return u.pathname + (u.search || '') + (u.hash || '');
      } catch (_) {
        return raw + (raw.includes('?') ? '&' : '?') + encodeURIComponent(k) + '=' + encodeURIComponent(v);
      }
    }

    const result = await handleGoogleAdsCallback(req.query || {});
    let redirect = result && result.redirect ? String(result.redirect) : '/';
    const shop = result && result.shop ? String(result.shop).trim().toLowerCase() : '';
    if (shop) redirect = maybeAddParam(redirect, 'shop', shop);
    if (!result || !result.ok) {
      const e = result && result.error ? String(result.error) : 'oauth_failed';
      res.redirect(302, setParam(redirect, 'ads_oauth', e));
      return;
    }
    res.redirect(302, setParam(redirect, 'ads_oauth', 'ok'));
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

router.get('/google/conversion-actions', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const out = await googleAdsClient.search(
      shop,
      `SELECT conversion_action.resource_name, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.primary_for_goal
       FROM conversion_action
       WHERE conversion_action.name LIKE 'Kexo%'`
    );
    if (!out || !out.ok) {
      const err = (out && out.error) ? String(out.error) : 'query failed';
      if (err.includes('Missing credentials') || err.includes('not connected')) {
        return res.json({ ok: true, actions: [] });
      }
      res.status(400).json({ ok: false, error: err, actions: [] });
      return;
    }
    const diag = await getCachedDiagnostics(shop);
    const summaries = diag && Array.isArray(diag.actionSummaries) ? diag.actionSummaries : [];
    const byName = new Map();
    for (const s of summaries) {
      const name = s && s.conversion_action_name ? String(s.conversion_action_name) : '';
      if (!name) continue;
      byName.set(name, s);
    }
    const actions = (out.results || []).map((r) => {
      const a = r && r.conversionAction ? r.conversionAction : {};
      const name = a.name != null ? String(a.name) : '';
      const sum = byName.get(name) || null;
      return {
        resource_name: a.resourceName || null,
        name: name || null,
        status: a.status || null,
        category: a.category || null,
        primary_for_goal: a.primaryForGoal === true,
        last_upload_date_time: sum && sum.last_upload_date_time ? String(sum.last_upload_date_time) : null,
      };
    });
    res.json({ ok: true, actions });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.conversion-actions' } });
    console.error('[ads.google.conversion-actions]', err);
    res.status(500).json({ ok: false, error: 'Internal error', actions: [] });
  }
});

router.post('/google/provision-goals', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || (req.query && req.query.shop != null ? String(req.query.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const requestedGoals = Array.isArray(req.body && req.body.goals) ? req.body.goals : undefined;
    const out = await provisionGoals(shop, requestedGoals);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'provision failed' });
      return;
    }
    const persistedGoals = await getConversionGoals(shop);
    res.json({ ok: true, goals: out.goals, persisted: persistedGoals });
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
    const coverage24h = { revenue: { queued: 0, success: 0, failure: 0, pending: 0 }, profit: { queued: 0, success: 0, failure: 0, pending: 0 } };
    const coverage7d = { revenue: { queued: 0, success: 0, failure: 0, pending: 0 }, profit: { queued: 0, success: 0, failure: 0, pending: 0 } };
    const coverage30d = { revenue: { queued: 0, success: 0, failure: 0, pending: 0 }, profit: { queued: 0, success: 0, failure: 0, pending: 0 } };
    let missingClickIdCount = 0;
    let failedUploadCount = 0;
    let rejectedUploadCount = 0;
    let jobsQueued = 0;
    let lastRunAt = null;
    let eligibleOrders24h = 0;
    let uploadedOrders24h = 0;
    let eligibleOrders7d = 0;
    let uploadedOrders7d = 0;
    let eligibleOrders30d = 0;
    let uploadedOrders30d = 0;
    if (db && normShop) {
      const now = Date.now();
      const ms24h = 24 * 60 * 60 * 1000;
      const ms7d = 7 * 24 * 60 * 60 * 1000;
      const ms30d = 30 * 24 * 60 * 60 * 1000;
      const cutoff24h = now - ms24h;
      const cutoff7d = now - ms7d;
      const cutoff30d = now - ms30d;
      const coverageRows = await db.all(
        `
          SELECT
            goal_type,
            status,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS c24,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS c7,
            SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS c30
          FROM google_ads_postback_jobs
          WHERE shop = ?
            AND goal_type IN ('revenue', 'profit')
            AND created_at >= ?
          GROUP BY goal_type, status
        `,
        [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
      );
      for (const r of coverageRows || []) {
        const goal = r && r.goal_type ? String(r.goal_type) : '';
        if (!goal || !coverage24h[goal] || !coverage7d[goal] || !coverage30d[goal]) continue;
        const status = r && r.status != null ? String(r.status) : '';
        const c24 = r && r.c24 != null ? Number(r.c24) : 0;
        const c7 = r && r.c7 != null ? Number(r.c7) : 0;
        const c30 = r && r.c30 != null ? Number(r.c30) : 0;
        if (status === 'pending' || status === 'retry') {
          coverage24h[goal].pending += c24 || 0;
          coverage7d[goal].pending += c7 || 0;
          coverage30d[goal].pending += c30 || 0;
        } else if (status === 'success') {
          coverage24h[goal].success += c24 || 0;
          coverage7d[goal].success += c7 || 0;
          coverage30d[goal].success += c30 || 0;
        } else if (status === 'failed') {
          coverage24h[goal].failure += c24 || 0;
          coverage7d[goal].failure += c7 || 0;
          coverage30d[goal].failure += c30 || 0;
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
      rejectedUploadCount = failedUploadCount;

      const queuedRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_postback_jobs WHERE shop = ? AND status IN ('pending', 'retry')`,
        [normShop]
      );
      jobsQueued = queuedRow && queuedRow.c != null ? Number(queuedRow.c) : 0;

      const lastRunRow = await db.get(
        `SELECT MAX(a.attempted_at) AS ts
         FROM google_ads_postback_attempts a
         INNER JOIN google_ads_postback_jobs j ON j.id = a.job_id
         WHERE j.shop = ?`,
        [normShop]
      );
      lastRunAt = lastRunRow && lastRunRow.ts != null ? Number(lastRunRow.ts) : null;

      const eligibleRow = await db.get(
        `
          SELECT
            COUNT(DISTINCT CASE WHEN created_at_ms >= ? THEN order_id END) AS c24,
            COUNT(DISTINCT CASE WHEN created_at_ms >= ? THEN order_id END) AS c7,
            COUNT(DISTINCT CASE WHEN created_at_ms >= ? THEN order_id END) AS c30
          FROM ads_orders_attributed
          WHERE shop = ? AND created_at_ms >= ?
            AND (
              (gclid IS NOT NULL AND TRIM(gclid) != '')
              OR (gbraid IS NOT NULL AND TRIM(gbraid) != '')
              OR (wbraid IS NOT NULL AND TRIM(wbraid) != '')
            )
        `,
        [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
      );
      eligibleOrders24h = eligibleRow && eligibleRow.c24 != null ? Number(eligibleRow.c24) : 0;
      eligibleOrders7d = eligibleRow && eligibleRow.c7 != null ? Number(eligibleRow.c7) : 0;
      eligibleOrders30d = eligibleRow && eligibleRow.c30 != null ? Number(eligibleRow.c30) : 0;

      const uploadedRow = await db.get(
        `
          SELECT
            COUNT(DISTINCT CASE WHEN created_at >= ? THEN order_id END) AS c24,
            COUNT(DISTINCT CASE WHEN created_at >= ? THEN order_id END) AS c7,
            COUNT(DISTINCT CASE WHEN created_at >= ? THEN order_id END) AS c30
          FROM google_ads_postback_jobs
          WHERE shop = ? AND created_at >= ? AND status = 'success'
        `,
        [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
      );
      uploadedOrders24h = uploadedRow && uploadedRow.c24 != null ? Number(uploadedRow.c24) : 0;
      uploadedOrders7d = uploadedRow && uploadedRow.c7 != null ? Number(uploadedRow.c7) : 0;
      uploadedOrders30d = uploadedRow && uploadedRow.c30 != null ? Number(uploadedRow.c30) : 0;
    }
    const diagnostics = await getCachedDiagnostics(shop);
    const coveragePercent24h = eligibleOrders24h > 0 ? Math.round((uploadedOrders24h / eligibleOrders24h) * 1000) / 10 : null;
    const coveragePercent7d = eligibleOrders7d > 0 ? Math.round((uploadedOrders7d / eligibleOrders7d) * 1000) / 10 : null;
    const coveragePercent30d = eligibleOrders30d > 0 ? Math.round((uploadedOrders30d / eligibleOrders30d) * 1000) / 10 : null;
    res.json({
      ok: true,
      goals,
      coverage_24h: coverage24h,
      coverage_7d: coverage7d,
      coverage_30d: coverage30d,
      reconciliation: { missing_click_id_orders: missingClickIdCount, failed_uploads: failedUploadCount, rejected_uploads: rejectedUploadCount },
      jobs_queued: jobsQueued,
      last_run_at: lastRunAt,
      coverage_percent_24h: coveragePercent24h,
      coverage_percent_7d: coveragePercent7d,
      coverage_percent_30d: coveragePercent30d,
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
