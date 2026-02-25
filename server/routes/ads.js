const Sentry = require('@sentry/node');
const express = require('express');
const adsService = require('../ads/adsService');
const store = require('../store');
const fx = require('../fx');
const salesTruth = require('../salesTruth');
const config = require('../config');
const { buildGoogleAdsConnectUrl, handleGoogleAdsCallback } = require('../ads/googleAdsOAuth');
const { syncGoogleAdsSpendHourly, syncGoogleAdsGeoDaily, syncGoogleAdsDeviceDaily, backfillCampaignIdsFromGclid, testGoogleAdsConnection } = require('../ads/googleAdsSpendSync');
const { syncAttributedOrdersToAdsDb } = require('../ads/adsOrderAttributionSync');
const { setGoogleAdsConfig, getGoogleAdsConfig } = require('../ads/adsStore');
const { provisionGoals, getConversionGoals, listUploadClickConversionActions, attachGoalToConversionAction, clearGoalAttachment, createAndAttachGoalConversionAction } = require('../ads/googleAdsGoals');
const { fetchDiagnostics, getCachedDiagnostics } = require('../ads/googleAdsDiagnostics');
const googleAdsClient = require('../ads/googleAdsClient');
const { getDb } = require('../db');
const businessSnapshotService = require('../businessSnapshotService');
const { normalizeProfitRulesConfigV1 } = require('../profitRulesConfig');
const { pickClickIdFromAttribution, formatConversionDateTime } = require('../ads/googleAdsPostback');

async function setActionOptimization(shop, resourceName, primaryForGoal) {
  return googleAdsClient.setConversionActionPrimaryForGoal(shop, resourceName, primaryForGoal);
}
const { getAdsDb } = require('../ads/adsDb');

const router = express.Router();

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function ymdInTimeZone(ts, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
    const ymd = fmt.format(new Date(Number(ts) || Date.now()));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  } catch (_) {}
  try {
    return new Date(Number(ts) || Date.now()).toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

function computeShippingCostForOrder(countryCode, shippingConfig) {
  const cfg = shippingConfig && typeof shippingConfig === 'object' ? shippingConfig : {};
  const overrides = Array.isArray(cfg.overrides) ? cfg.overrides : [];
  const code = countryCode != null ? String(countryCode).trim().toUpperCase().slice(0, 2) : '';
  for (const o of overrides) {
    if (!o || o.enabled === false) continue;
    const countries = Array.isArray(o.countries) ? o.countries : [];
    if (code && countries.includes(code)) return Math.max(0, Number(o.priceGbp) || 0);
  }
  return Math.max(0, Number(cfg.worldwideDefaultGbp) || 0);
}

function parseYmdParts(ymd) {
  const s = ymd != null ? String(ymd).trim() : '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function daysInMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return 30;
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLeapYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return false;
  if (y % 400 === 0) return true;
  if (y % 100 === 0) return false;
  return y % 4 === 0;
}

function overheadDailyAmountGbp(overhead, dayYmd) {
  const o = overhead && typeof overhead === 'object' ? overhead : {};
  if (o.enabled === false) return 0;
  const amount = Math.max(0, Number(o.amount) || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const ymd = dayYmd != null ? String(dayYmd).trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 0;

  const start = o.date != null ? String(o.date).trim() : '';
  const end = o.end_date != null ? String(o.end_date).trim() : '';
  if (!start || ymd < start) return 0;
  if (end && ymd > end) return 0;

  const kind = o.kind === 'one_off' ? 'one_off' : 'recurring';
  if (kind === 'one_off') return ymd === start ? round2(amount) : 0;

  const freq = o.frequency === 'daily' || o.frequency === 'weekly' || o.frequency === 'monthly' || o.frequency === 'yearly'
    ? o.frequency
    : 'monthly';
  if (freq === 'daily') return round2(amount);
  if (freq === 'weekly') return round2(amount / 7);
  if (freq === 'yearly') {
    const p = parseYmdParts(ymd);
    if (!p) return 0;
    const diy = isLeapYear(p.year) ? 366 : 365;
    return round2(amount / diy);
  }
  // monthly
  const monthlyAllocation = o.monthly_allocation === 'calendar' ? 'calendar' : 'prorate';
  const p = parseYmdParts(ymd);
  const sp = parseYmdParts(start);
  if (!p || !sp) return 0;
  if (monthlyAllocation === 'calendar') {
    const billDay = sp.day || 1;
    const maxDay = daysInMonth(p.year, p.month);
    const occDay = Math.min(Math.max(1, billDay), maxDay);
    return p.day === occDay ? round2(amount) : 0;
  }
  const dim = daysInMonth(p.year, p.month);
  return dim > 0 ? round2(amount / dim) : 0;
}

function orderMatchesAppliesTo(appliesTo, countryCode) {
  const a = appliesTo && typeof appliesTo === 'object' ? appliesTo : {};
  const mode = a.mode != null ? String(a.mode).trim().toLowerCase() : 'all';
  if (mode !== 'countries') return true;
  const list = Array.isArray(a.countries) ? a.countries : [];
  const code = countryCode != null ? String(countryCode).trim().toUpperCase().slice(0, 2) : '';
  if (!code) return false;
  return list.includes(code);
}

function orderRevenueForBasis(order, basis) {
  const b = basis != null ? String(basis).trim().toLowerCase() : '';
  const incl = Number(order && order.revenueGbp) || 0;
  const tax = Number(order && order.taxGbp) || 0;
  const exclTax = round2(incl - tax) || 0;
  const subtotal = Number(order && order.subtotalGbp);
  const exclShipping = Number.isFinite(subtotal) ? (round2(subtotal) || 0) : exclTax;
  if (b === 'order_total_excl_tax' || b === 'excl_tax') return exclTax;
  if (b === 'subtotal_excl_shipping' || b === 'excl_shipping') return exclShipping;
  return incl;
}

function computePerOrderRulesAdjustmentGbp(order, rules, mode) {
  const list = Array.isArray(rules) ? rules : [];
  const matchMode = mode === 'first_match' ? 'first_match' : 'stack';
  const dayYmd = order && order.orderYmd ? String(order.orderYmd) : '';
  let total = 0;
  for (const rule of list) {
    if (!rule || rule.enabled !== true) continue;
    const start = rule.effective_start || rule.start_date || '';
    const end = rule.effective_end || rule.end_date || '';
    if (start && dayYmd && String(dayYmd) < String(start)) continue;
    if (end && dayYmd && String(dayYmd) > String(end)) continue;
    if (!orderMatchesAppliesTo(rule.appliesTo, order && order.countryCode)) continue;
    const value = Number(rule.value) || 0;
    let amt = 0;
    if (rule.type === 'percent_revenue') amt = orderRevenueForBasis(order, rule.revenue_basis) * (value / 100);
    else if (rule.type === 'fixed_per_order') amt = value;
    else if (rule.type === 'fixed_per_item') amt = (Number(order && order.itemsCount) || 0) * value;
    if (!Number.isFinite(amt) || amt === 0) continue;
    const direction = rule.direction != null ? String(rule.direction).trim().toLowerCase() : 'add';
    if (direction === 'subtract') amt *= -1;
    const rounded = round2(amt) || 0;
    if (rounded === 0) continue;
    total += rounded;
    if (matchMode === 'first_match') break;
  }
  return round2(total) || 0;
}

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

router.get('/google/upload-click-actions', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  try {
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const includeRemoved = req.query && req.query.include_removed === '1';
    const out = await listUploadClickConversionActions(shop);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'list failed', actions: [] });
      return;
    }
    const actions = Array.isArray(out.actions) ? out.actions : [];
    const filtered = includeRemoved ? actions : actions.filter((a) => String(a && a.status || '').toUpperCase() !== 'REMOVED');
    res.json({ ok: true, actions: filtered });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.upload-click-actions' } });
    console.error('[ads.google.upload-click-actions]', err);
    res.status(500).json({ ok: false, error: 'Internal error', actions: [] });
  }
});

router.post('/google/attach-goal', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const goalType = req.body && req.body.goal_type != null ? String(req.body.goal_type).trim() : '';
    const resourceName = req.body && req.body.resource_name != null ? String(req.body.resource_name).trim() : '';
    const id = req.body && req.body.id != null ? Number(req.body.id) : undefined;
    const out = await attachGoalToConversionAction(shop, goalType, resourceName, id);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'attach failed' });
      return;
    }
    const goals = await getConversionGoals(shop);
    res.json({ ok: true, goals });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.attach-goal' } });
    console.error('[ads.google.attach-goal]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/google/clear-goal', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const goalType = req.body && req.body.goal_type != null ? String(req.body.goal_type).trim() : '';
    const out = await clearGoalAttachment(shop, goalType);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'clear failed' });
      return;
    }
    const goals = await getConversionGoals(shop);
    res.json({ ok: true, goals });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.clear-goal' } });
    console.error('[ads.google.clear-goal]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/google/create-and-attach-goal', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const goalType = req.body && req.body.goal_type != null ? String(req.body.goal_type).trim() : '';
    const actionName = req.body && req.body.action_name != null ? String(req.body.action_name).trim() : '';
    const out = await createAndAttachGoalConversionAction(shop, goalType, actionName);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'create-and-attach failed' });
      return;
    }
    const goals = await getConversionGoals(shop);
    res.json({ ok: true, goals });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.create-and-attach-goal' } });
    console.error('[ads.google.create-and-attach-goal]', err);
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

router.post('/google/set-action-optimization', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const resourceName = req.body && req.body.resource_name != null ? String(req.body.resource_name).trim() : '';
    const primaryForGoal = req.body && req.body.primary_for_goal === true;
    const out = await setActionOptimization(shop, resourceName, primaryForGoal);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error || 'set-action-optimization failed' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.set-action-optimization' } });
    console.error('[ads.google.set-action-optimization]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
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

router.get('/google/profit-preview-samples', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  try {
    const shop = (req.query && req.query.shop != null ? String(req.query.shop).trim() : '') || salesTruth.resolveShopForSales('');
    if (!shop) {
      res.status(400).json({ ok: false, error: 'Missing shop', samples: [] });
      return;
    }
    const adsDb = getAdsDb();
    if (!adsDb) {
      res.status(500).json({ ok: false, error: 'ADS_DB_URL not set', samples: [] });
      return;
    }
    const rows = await adsDb.all(
      `
        SELECT
          order_id,
          created_at_ms,
          currency,
          total_price,
          country_code,
          visitor_country_code,
          visitor_device_type,
          click_id_type,
          click_id_value,
          gclid,
          gbraid,
          wbraid
        FROM ads_orders_attributed
        WHERE shop = ?
          AND created_at_ms IS NOT NULL
          AND (
            click_id_value IS NOT NULL
            OR gclid IS NOT NULL
            OR gbraid IS NOT NULL
            OR wbraid IS NOT NULL
          )
        ORDER BY created_at_ms DESC
        LIMIT 50
      `,
      [shop]
    ).catch(() => []);
    const out = [];
    const seen = new Set();
    for (const r of rows || []) {
      const click = pickClickIdFromAttribution(r);
      if (!click || !click.value) continue;
      const key = String(click.type || '') + ':' + String(click.value || '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        order_id: r && r.order_id != null ? String(r.order_id) : null,
        created_at_ms: r && r.created_at_ms != null ? Number(r.created_at_ms) : null,
        currency: r && r.currency != null ? String(r.currency) : null,
        total_price: r && r.total_price != null ? Number(r.total_price) : null,
        country_code: r && r.country_code != null ? String(r.country_code) : null,
        visitor_country_code: r && r.visitor_country_code != null ? String(r.visitor_country_code) : null,
        visitor_device_type: r && r.visitor_device_type != null ? String(r.visitor_device_type) : null,
        click_id_type: click.type ? String(click.type) : null,
        click_id_value: click.value ? String(click.value) : null,
      });
      if (out.length >= 5) break;
    }
    res.json({ ok: true, samples: out });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.profit-preview-samples' } });
    console.error('[ads.google.profit-preview-samples]', err);
    res.status(500).json({ ok: false, error: 'Internal error', samples: [] });
  }
});

router.post('/google/profit-preview', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    function normalizeIdList(list) {
      const arr = Array.isArray(list) ? list : [];
      const out = [];
      const seen = new Set();
      for (const raw of arr) {
        const v = raw != null ? String(raw).trim().slice(0, 64) : '';
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        out.push(v);
        if (out.length >= 500) break;
      }
      return out;
    }

    function normalizeDeductions(raw) {
      const d = raw && typeof raw === 'object' ? raw : {};
      const hasNew =
        Object.prototype.hasOwnProperty.call(d, 'includePerOrderRules') ||
        Object.prototype.hasOwnProperty.call(d, 'includeOverheads') ||
        Object.prototype.hasOwnProperty.call(d, 'includeFixedCosts') ||
        Object.prototype.hasOwnProperty.call(d, 'excludedPerOrderRuleIds') ||
        Object.prototype.hasOwnProperty.call(d, 'excludedOverheadIds') ||
        Object.prototype.hasOwnProperty.call(d, 'excludedFixedCostIds') ||
        Object.prototype.hasOwnProperty.call(d, 'perOrderRuleExclusions') ||
        Object.prototype.hasOwnProperty.call(d, 'overheadExclusions') ||
        Object.prototype.hasOwnProperty.call(d, 'fixedCostExclusions');
      const legacyRules = d.includeRules === true;
      return {
        includeGoogleAdsSpend: d.includeGoogleAdsSpend === true,
        includePaymentFees: d.includePaymentFees === true,
        includeShopifyTaxes: d.includeShopifyTaxes === true,
        includeShopifyAppBills: d.includeShopifyAppBills === true,
        includeShipping: d.includeShipping === true,
        includePerOrderRules: d.includePerOrderRules === true || (!hasNew && legacyRules),
        includeOverheads: d.includeOverheads === true || (!hasNew && legacyRules),
        includeFixedCosts: d.includeFixedCosts === true || (!hasNew && legacyRules),
        excludedPerOrderRuleIds: normalizeIdList(d.excludedPerOrderRuleIds || d.perOrderRuleExclusions),
        excludedOverheadIds: normalizeIdList(d.excludedOverheadIds || d.overheadExclusions),
        excludedFixedCostIds: normalizeIdList(d.excludedFixedCostIds || d.fixedCostExclusions),
      };
    }

    async function readAdsSpendByYmd(adsDb, startMs, endMs, tz) {
      const byYmd = new Map();
      let rows = [];
      try {
        rows = await adsDb.all(
          `
            SELECT
              (EXTRACT(EPOCH FROM DATE_TRUNC('day', hour_ts)) * 1000)::BIGINT AS day_ms,
              COALESCE(SUM(spend_gbp), 0) AS spend_gbp
            FROM google_ads_spend_hourly
            WHERE provider = 'google_ads'
              AND hour_ts >= TO_TIMESTAMP(?/1000.0) AND hour_ts < TO_TIMESTAMP(?/1000.0)
            GROUP BY day_ms
            ORDER BY day_ms ASC
          `,
          [Number(startMs), Number(endMs)]
        );
      } catch (_) {
        return byYmd;
      }
      for (const r of rows || []) {
        const ms = r && r.day_ms != null ? Number(r.day_ms) : NaN;
        const spend = r && r.spend_gbp != null ? Number(r.spend_gbp) : 0;
        if (!Number.isFinite(ms)) continue;
        const ymd = ymdInTimeZone(ms, tz) || null;
        if (!ymd) continue;
        byYmd.set(ymd, (Number(byYmd.get(ymd)) || 0) + (Number.isFinite(spend) ? spend : 0));
      }
      return byYmd;
    }

    const shop = (req.body && req.body.shop != null ? String(req.body.shop).trim() : '') || (req.query && req.query.shop != null ? String(req.query.shop).trim() : '') || salesTruth.resolveShopForSales('');
    const clickId = req.body && req.body.click_id != null ? String(req.body.click_id).trim() : '';
    if (!shop) return res.status(400).json({ ok: false, error: 'Missing shop' });
    if (!clickId) return res.status(400).json({ ok: false, error: 'Missing click_id' });
    if (clickId.length > 256) return res.status(400).json({ ok: false, error: 'click_id too long' });

    const adsDb = getAdsDb();
    if (!adsDb) return res.status(500).json({ ok: false, error: 'ADS_DB_URL not set' });
    const db = getDb();
    if (!db) return res.status(500).json({ ok: false, error: 'Main DB not available' });

    const deductions = normalizeDeductions(req.body && req.body.deductions ? req.body.deductions : null);
    const timeZone = store.resolveAdminTimeZone();

    const orderRow = await adsDb.get(
      `
        SELECT *
        FROM ads_orders_attributed
        WHERE shop = ?
          AND (
            click_id_value = ?
            OR gclid = ?
            OR gbraid = ?
            OR wbraid = ?
          )
        ORDER BY created_at_ms DESC
        LIMIT 1
      `,
      [shop, clickId, clickId, clickId, clickId]
    );
    if (!orderRow) {
      return res.json({ ok: true, found: false, error: 'No matching attributed order found for that click ID.' });
    }

    const orderId = orderRow && orderRow.order_id != null ? String(orderRow.order_id).trim() : '';
    const createdAtMs = orderRow && orderRow.created_at_ms != null ? Number(orderRow.created_at_ms) : null;
    const revenueGbp = orderRow && orderRow.revenue_gbp != null ? Number(orderRow.revenue_gbp) : null;
    const currency = fx.normalizeCurrency(orderRow && orderRow.currency != null ? String(orderRow.currency) : '') || 'GBP';
    if (!orderId || createdAtMs == null || !Number.isFinite(createdAtMs)) {
      return res.json({ ok: true, found: false, error: 'Matched order row is missing order_id/created_at_ms.' });
    }

    let shopifyOrder = null;
    try {
      shopifyOrder = await db.get(
        `SELECT raw_json, currency, total_price
         FROM orders_shopify
         WHERE shop = ? AND order_id = ?
         LIMIT 1`,
        [shop, orderId]
      );
    } catch (_) {
      shopifyOrder = null;
    }

    const ratesToGbp = await fx.getRatesToGbp();
    let orderJson = null;
    try { orderJson = shopifyOrder && typeof shopifyOrder.raw_json === 'string' ? JSON.parse(shopifyOrder.raw_json) : null; } catch (_) { orderJson = null; }

    const totalTaxRaw =
      (orderJson && (orderJson.total_tax != null ? orderJson.total_tax : (orderJson.totalTax != null ? orderJson.totalTax : (orderJson.current_total_tax != null ? orderJson.current_total_tax : orderJson.currentTotalTax)))) != null
        ? Number(orderJson.total_tax != null ? orderJson.total_tax : (orderJson.totalTax != null ? orderJson.totalTax : (orderJson.current_total_tax != null ? orderJson.current_total_tax : orderJson.currentTotalTax)))
        : 0;
    const taxGbpRaw = fx.convertToGbp(Number.isFinite(totalTaxRaw) ? totalTaxRaw : 0, currency, ratesToGbp);
    const taxGbp = (typeof taxGbpRaw === 'number' && Number.isFinite(taxGbpRaw)) ? round2(taxGbpRaw) : 0;
    const subtotalRaw =
      (orderJson && (orderJson.subtotal_price != null ? orderJson.subtotal_price : (orderJson.subtotalPrice != null ? orderJson.subtotalPrice : (orderJson.current_subtotal_price != null ? orderJson.current_subtotal_price : orderJson.currentSubtotalPrice)))) != null
        ? Number(orderJson.subtotal_price != null ? orderJson.subtotal_price : (orderJson.subtotalPrice != null ? orderJson.subtotalPrice : (orderJson.current_subtotal_price != null ? orderJson.current_subtotal_price : orderJson.currentSubtotalPrice)))
        : null;
    const subtotalGbpRaw = subtotalRaw != null ? fx.convertToGbp(Number.isFinite(subtotalRaw) ? subtotalRaw : 0, currency, ratesToGbp) : null;
    const subtotalGbp = (typeof subtotalGbpRaw === 'number' && Number.isFinite(subtotalGbpRaw)) ? round2(subtotalGbpRaw) : null;
    const itemsCount = (() => {
      const items = orderJson && Array.isArray(orderJson.line_items) ? orderJson.line_items : [];
      let count = 0;
      for (const it of items) {
        const q = parseInt(it && it.quantity != null ? it.quantity : 0, 10);
        if (!Number.isFinite(q) || q <= 0) continue;
        count += q;
        if (count > 500000) break;
      }
      return count;
    })();
    const cc =
      (orderJson && orderJson.shipping_address && orderJson.shipping_address.country_code != null ? String(orderJson.shipping_address.country_code) : '') ||
      (orderJson && orderJson.billing_address && orderJson.billing_address.country_code != null ? String(orderJson.billing_address.country_code) : '') ||
      (orderRow && orderRow.country_code != null ? String(orderRow.country_code) : '');
    const countryCode = cc ? String(cc).trim().toUpperCase().slice(0, 2) : null;

    const orderYmd = ymdInTimeZone(createdAtMs, timeZone) || new Date(createdAtMs).toISOString().slice(0, 10);
    const rev = Number.isFinite(revenueGbp) ? round2(revenueGbp) : (shopifyOrder && Number.isFinite(Number(shopifyOrder.total_price)) ? round2(fx.convertToGbp(Number(shopifyOrder.total_price), currency, ratesToGbp) || 0) : 0);

    // Revenue share for the admin-local day (best-effort; queries a 72h window and groups in JS).
    const windowStart = createdAtMs - 36 * 60 * 60 * 1000;
    const windowEnd = createdAtMs + 36 * 60 * 60 * 1000;
    let dayRev = 0;
    try {
      const rows = await adsDb.all(
        `SELECT created_at_ms, revenue_gbp
         FROM ads_orders_attributed
         WHERE shop = ?
           AND created_at_ms >= ? AND created_at_ms < ?
         LIMIT 50000`,
        [shop, windowStart, windowEnd]
      );
      for (const r of rows || []) {
        const ms = r && r.created_at_ms != null ? Number(r.created_at_ms) : NaN;
        if (!Number.isFinite(ms)) continue;
        const ymd = ymdInTimeZone(ms, timeZone);
        if (ymd !== orderYmd) continue;
        const rg = r && r.revenue_gbp != null ? Number(r.revenue_gbp) : 0;
        if (Number.isFinite(rg)) dayRev += rg;
      }
    } catch (_) {}
    dayRev = round2(dayRev) || 0;
    const share = dayRev > 0 && Number.isFinite(rev) ? (rev / dayRev) : 0;

    let profitRules = null;
    try {
      const raw = await store.getSetting('profit_rules_v1');
      profitRules = normalizeProfitRulesConfigV1(raw);
    } catch (_) {
      profitRules = normalizeProfitRulesConfigV1(null);
    }
    const shippingConfig = profitRules && profitRules.shipping && typeof profitRules.shipping === 'object'
      ? profitRules.shipping
      : { enabled: false, worldwideDefaultGbp: 0, overrides: [] };
    const ce = profitRules && profitRules.cost_expenses && typeof profitRules.cost_expenses === 'object'
      ? profitRules.cost_expenses
      : { rule_mode: 'stack', per_order_rules: [], overheads: [], fixed_costs: [] };

    const perOrderExclude = new Set(deductions.excludedPerOrderRuleIds || []);
    const overheadExclude = new Set(deductions.excludedOverheadIds || []);
    const fixedExclude = new Set(deductions.excludedFixedCostIds || []);
    const perOrderRules = Array.isArray(ce.per_order_rules)
      ? ce.per_order_rules.filter((r) => r && r.enabled === true && !perOrderExclude.has(String(r.id)))
      : [];
    const overheads = Array.isArray(ce.overheads)
      ? ce.overheads.filter((o) => o && o.enabled === true && !overheadExclude.has(String(o.id)))
      : [];
    const fixedCosts = Array.isArray(ce.fixed_costs)
      ? ce.fixed_costs.filter((f) => f && f.enabled === true && !fixedExclude.has(String(f.id)))
      : [];

    const components = {};
    let cost = 0;

    if (deductions.includeGoogleAdsSpend) {
      const adsSpendByYmd = await readAdsSpendByYmd(adsDb, windowStart, windowEnd, timeZone);
      const daySpend = Number(adsSpendByYmd.get(orderYmd)) || 0;
      const alloc = round2(daySpend * share) || 0;
      components.google_ads_spend_alloc_gbp = alloc;
      cost += alloc;
    }

    const needShopifyCosts = !!(deductions.includePaymentFees || deductions.includeShopifyAppBills);
    let shopifyCosts = { available: !needShopifyCosts, paymentFeesByYmd: new Map(), appBillsByYmd: new Map(), error: '' };
    if (needShopifyCosts) {
      const token = await salesTruth.getAccessToken(shop).catch(() => '');
      shopifyCosts = await businessSnapshotService.readShopifyBalanceCostsGbp(shop, token, orderYmd, orderYmd, timeZone).catch(() => ({
        available: false,
        error: 'shopify_cost_lookup_failed',
        paymentFeesByYmd: new Map(),
        appBillsByYmd: new Map(),
      }));
    }

    const missing = [];
    if (deductions.includePaymentFees) {
      if (!shopifyCosts || shopifyCosts.available !== true) missing.push('payment_fees');
      else {
        const dayFees = Number(shopifyCosts.paymentFeesByYmd && shopifyCosts.paymentFeesByYmd.get ? shopifyCosts.paymentFeesByYmd.get(orderYmd) : 0) || 0;
        const alloc = round2(dayFees * share) || 0;
        components.payment_fees_alloc_gbp = alloc;
        cost += alloc;
      }
    }
    if (deductions.includeShopifyAppBills) {
      if (!shopifyCosts || shopifyCosts.available !== true) missing.push('shopify_app_bills');
      else {
        const dayBills = Number(shopifyCosts.appBillsByYmd && shopifyCosts.appBillsByYmd.get ? shopifyCosts.appBillsByYmd.get(orderYmd) : 0) || 0;
        const alloc = round2(dayBills * share) || 0;
        components.shopify_app_bills_alloc_gbp = alloc;
        cost += alloc;
      }
    }

    if (deductions.includeShopifyTaxes) {
      components.shopify_tax_gbp = round2(taxGbp) || 0;
      cost += Number(components.shopify_tax_gbp) || 0;
    }
    if (deductions.includeShipping) {
      const ship = computeShippingCostForOrder(countryCode, shippingConfig);
      components.shipping_cost_gbp = round2(ship) || 0;
      cost += Number(components.shipping_cost_gbp) || 0;
    }
    const orderForRules = { revenueGbp: rev, taxGbp, subtotalGbp, itemsCount, countryCode, orderYmd };
    if (deductions.includePerOrderRules) {
      const rulesAdj = computePerOrderRulesAdjustmentGbp(orderForRules, perOrderRules, ce && ce.rule_mode);
      components.rules_per_order_gbp = rulesAdj;
      cost += (Number(rulesAdj) || 0);
    }
    if (deductions.includeOverheads) {
      let overheadDay = 0;
      for (const oh of overheads) overheadDay += overheadDailyAmountGbp(oh, orderYmd);
      const overheadAlloc = round2(overheadDay * share) || 0;
      components.overhead_alloc_gbp = overheadAlloc;
      cost += (Number(overheadAlloc) || 0);
    }
    if (deductions.includeFixedCosts) {
      let fixedDay = 0;
      for (const f of fixedCosts) {
        const start = (f && (f.effective_start || f.start_date)) ? String(f.effective_start || f.start_date) : '';
        if (start && String(orderYmd) < start) continue;
        fixedDay += (Number(f && f.amount_per_day) || 0);
      }
      const fixedAlloc = round2(fixedDay * share) || 0;
      components.fixed_costs_alloc_gbp = fixedAlloc;
      cost += (Number(fixedAlloc) || 0);
    }

    const preview = (() => {
      if (missing.length) {
        return {
          ok: false,
          missing,
          revenue_gbp: round2(rev) || 0,
          cost_gbp: null,
          profit_gbp: null,
          day_revenue_gbp: dayRev,
          revenue_share: Number.isFinite(share) ? share : null,
          components,
        };
      }
      const costGbp = round2(cost) || 0;
      const profit = round2((Number(rev) || 0) - costGbp) || 0;
      return {
        ok: true,
        revenue_gbp: round2(rev) || 0,
        cost_gbp: costGbp,
        profit_gbp: Math.max(0, Number.isFinite(profit) ? profit : 0),
        day_revenue_gbp: dayRev,
        revenue_share: Number.isFinite(share) ? share : null,
        components,
      };
    })();

    const goals = await getConversionGoals(shop).catch(() => []);
    const profitGoal = Array.isArray(goals) ? goals.find((g) => g && String(g.goal_type || '') === 'profit') : null;
    const profitResource = profitGoal && (profitGoal.custom_goal_resource_name || profitGoal.conversion_action_resource_name)
      ? String(profitGoal.custom_goal_resource_name || profitGoal.conversion_action_resource_name).trim()
      : null;

    const gaCfg = await getGoogleAdsConfig(shop).catch(() => null);
    const customerTimeZone = gaCfg && gaCfg.customer_time_zone ? String(gaCfg.customer_time_zone).trim() : 'UTC';
    const conversionDateTime = formatConversionDateTime(createdAtMs, customerTimeZone) || `${new Date(createdAtMs).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
    const click = pickClickIdFromAttribution(orderRow);

    res.json({
      ok: true,
      found: true,
      shop,
      click_id: clickId,
      order: {
        order_id: orderId,
        created_at_ms: createdAtMs,
        currency,
        country_code: countryCode,
        attribution_confidence: orderRow && orderRow.attribution_confidence != null ? String(orderRow.attribution_confidence) : null,
        attribution_source: orderRow && orderRow.attribution_source != null ? String(orderRow.attribution_source) : null,
        click_id_type: click && click.type ? String(click.type) : null,
        click_id_value: click && click.value ? String(click.value) : null,
      },
      deductions,
      preview,
      google_ads_payload: {
        goal_type: 'profit',
        conversion_action_resource_name: profitResource,
        conversion_date_time: conversionDateTime,
        conversion_value: preview && preview.ok ? preview.profit_gbp : null,
        currency_code: currency,
        click_id_type: click && click.type ? String(click.type) : null,
        click_id_value: click && click.value ? String(click.value) : null,
        customer_time_zone: customerTimeZone,
      },
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.google.profit-preview' } });
    console.error('[ads.google.profit-preview]', err);
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
    function normalizeTier(raw, fallback) {
      const v = raw != null ? String(raw).trim().toUpperCase() : '';
      if (v === 'A' || v === 'B' || v === 'C') return v;
      return fallback || 'B';
    }
    function normalizeBool(raw, fallback) {
      if (raw == null) return !!fallback;
      const v = String(raw).trim().toLowerCase();
      if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
      if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
      return !!fallback;
    }
    const shop = (req.query && req.query.shop) != null ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const normShop = String(shop || '').trim().toLowerCase();
    const db = getAdsDb();
    const goals = await getConversionGoals(shop);
    const goalKeys = ['revenue', 'profit', 'add_to_cart', 'begin_checkout'];
    const emptyCoverage = () => ({ queued: 0, success: 0, failure: 0, pending: 0 });
    const coverage24h = Object.fromEntries(goalKeys.map((k) => [k, emptyCoverage()]));
    const coverage7d = Object.fromEntries(goalKeys.map((k) => [k, emptyCoverage()]));
    const coverage30d = Object.fromEntries(goalKeys.map((k) => [k, emptyCoverage()]));
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
    let paidOrders24h = 0;
    let paidOrders7d = 0;
    let paidOrders30d = 0;
    let attributedOrders24h = 0;
    let attributedOrders7d = 0;
    let attributedOrders30d = 0;
    let uploadMinTier = 'B';
    let allowTierCUploads = false;
    let missingCustomerTimeZoneCount = 0;
    let lowConfidenceSkippedCount = 0;
    let profitNotComputableCount = 0;
    let adjustmentFailedCount = 0;
    let attributionTiers24h = { A: 0, B: 0, C: 0 };
    let attributionTiers7d = { A: 0, B: 0, C: 0 };
    let attributionTiers30d = { A: 0, B: 0, C: 0 };
    let adjustmentsQueued = 0;
    let adjustmentsLastRunAt = null;
    let adjustmentsByStatus = { pending: 0, retry: 0, success: 0, failed: 0 };
    try {
      uploadMinTier = normalizeTier(await store.getSetting('google_ads_upload_confidence_min'), 'B');
    } catch (_) {}
    try {
      allowTierCUploads = normalizeBool(await store.getSetting('google_ads_allow_tier_c_uploads'), false);
    } catch (_) {}
    if (db && normShop) {
      const now = Date.now();
      const ms24h = 24 * 60 * 60 * 1000;
      const ms7d = 7 * 24 * 60 * 60 * 1000;
      const ms30d = 30 * 24 * 60 * 60 * 1000;
      const cutoff24h = now - ms24h;
      const cutoff7d = now - ms7d;
      const cutoff30d = now - ms30d;

      try {
        const mainDb = require('../db').getDb();
        if (mainDb) {
          const paidRow = await mainDb.get(
            `
              SELECT
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS c24,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS c7,
                SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS c30
              FROM orders_shopify
              WHERE shop = ? AND created_at >= ?
                AND (test IS NULL OR test = 0)
                AND cancelled_at IS NULL
                AND financial_status IN ('paid', 'partially_refunded')
            `,
            [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
          ).catch(() => null);
          paidOrders24h = paidRow && paidRow.c24 != null ? Number(paidRow.c24) : 0;
          paidOrders7d = paidRow && paidRow.c7 != null ? Number(paidRow.c7) : 0;
          paidOrders30d = paidRow && paidRow.c30 != null ? Number(paidRow.c30) : 0;
        }
      } catch (_) {}

      const attributedRow = await db.get(
        `
          SELECT
            COUNT(DISTINCT CASE WHEN created_at_ms >= ? THEN order_id END) AS c24,
            COUNT(DISTINCT CASE WHEN created_at_ms >= ? THEN order_id END) AS c7,
            COUNT(DISTINCT CASE WHEN created_at_ms >= ? THEN order_id END) AS c30
          FROM ads_orders_attributed
          WHERE shop = ? AND created_at_ms >= ? AND source = 'googleads'
        `,
        [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
      ).catch(() => null);
      attributedOrders24h = attributedRow && attributedRow.c24 != null ? Number(attributedRow.c24) : 0;
      attributedOrders7d = attributedRow && attributedRow.c7 != null ? Number(attributedRow.c7) : 0;
      attributedOrders30d = attributedRow && attributedRow.c30 != null ? Number(attributedRow.c30) : 0;
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
            AND goal_type IN ('revenue', 'profit', 'add_to_cart', 'begin_checkout')
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
      const missingTzRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open' AND error_code = 'MISSING_CUSTOMER_TIME_ZONE'`,
        [normShop]
      );
      missingCustomerTimeZoneCount = missingTzRow && missingTzRow.c != null ? Number(missingTzRow.c) : 0;
      const lowConfRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open' AND error_code = 'LOW_CONFIDENCE_ATTRIBUTION_SKIPPED'`,
        [normShop]
      );
      lowConfidenceSkippedCount = lowConfRow && lowConfRow.c != null ? Number(lowConfRow.c) : 0;
      const profitRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open' AND error_code = 'PROFIT_NOT_COMPUTABLE'`,
        [normShop]
      );
      profitNotComputableCount = profitRow && profitRow.c != null ? Number(profitRow.c) : 0;
      const adjustmentFailRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open' AND error_code = 'ADJUSTMENT_UPLOAD_FAILED'`,
        [normShop]
      );
      adjustmentFailedCount = adjustmentFailRow && adjustmentFailRow.c != null ? Number(adjustmentFailRow.c) : 0;
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

      const allowedTiers = (() => {
        const order = ['A', 'B', 'C'];
        const idx = order.indexOf(uploadMinTier);
        const slice = idx >= 0 ? order.slice(0, idx + 1) : ['A', 'B'];
        if (!allowTierCUploads) return slice.filter((t) => t !== 'C');
        return slice;
      })();
      const confidenceClause = allowedTiers.length ? `AND COALESCE(attribution_confidence, 'B') IN (${allowedTiers.map((t) => `'${t}'`).join(', ')})` : 'AND 1=0';

      let eligibleRow = await db.get(
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
            ${confidenceClause}
        `,
        [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
      ).catch(() => null);
      if (!eligibleRow) {
        eligibleRow = await db.get(
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
        ).catch(() => null);
      }
      eligibleOrders24h = eligibleRow && eligibleRow.c24 != null ? Number(eligibleRow.c24) : 0;
      eligibleOrders7d = eligibleRow && eligibleRow.c7 != null ? Number(eligibleRow.c7) : 0;
      eligibleOrders30d = eligibleRow && eligibleRow.c30 != null ? Number(eligibleRow.c30) : 0;

      const tierRow = await db.get(
        `
          SELECT
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'A' THEN 1 ELSE 0 END) AS a24,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'B' THEN 1 ELSE 0 END) AS b24,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'C' THEN 1 ELSE 0 END) AS c24,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'A' THEN 1 ELSE 0 END) AS a7,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'B' THEN 1 ELSE 0 END) AS b7,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'C' THEN 1 ELSE 0 END) AS c7,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'A' THEN 1 ELSE 0 END) AS a30,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'B' THEN 1 ELSE 0 END) AS b30,
            SUM(CASE WHEN created_at_ms >= ? AND COALESCE(attribution_confidence, 'B') = 'C' THEN 1 ELSE 0 END) AS c30
          FROM ads_orders_attributed
          WHERE shop = ? AND created_at_ms >= ?
            AND (
              (gclid IS NOT NULL AND TRIM(gclid) != '')
              OR (gbraid IS NOT NULL AND TRIM(gbraid) != '')
              OR (wbraid IS NOT NULL AND TRIM(wbraid) != '')
            )
        `,
        [cutoff24h, cutoff24h, cutoff24h, cutoff7d, cutoff7d, cutoff7d, cutoff30d, cutoff30d, cutoff30d, normShop, cutoff30d]
      ).catch(() => null);
      attributionTiers24h = { A: tierRow && tierRow.a24 != null ? Number(tierRow.a24) : 0, B: tierRow && tierRow.b24 != null ? Number(tierRow.b24) : 0, C: tierRow && tierRow.c24 != null ? Number(tierRow.c24) : 0 };
      attributionTiers7d = { A: tierRow && tierRow.a7 != null ? Number(tierRow.a7) : 0, B: tierRow && tierRow.b7 != null ? Number(tierRow.b7) : 0, C: tierRow && tierRow.c7 != null ? Number(tierRow.c7) : 0 };
      attributionTiers30d = { A: tierRow && tierRow.a30 != null ? Number(tierRow.a30) : 0, B: tierRow && tierRow.b30 != null ? Number(tierRow.b30) : 0, C: tierRow && tierRow.c30 != null ? Number(tierRow.c30) : 0 };

      const uploadedRow = await db.get(
        `
          SELECT
            COUNT(DISTINCT CASE WHEN created_at >= ? THEN order_id END) AS c24,
            COUNT(DISTINCT CASE WHEN created_at >= ? THEN order_id END) AS c7,
            COUNT(DISTINCT CASE WHEN created_at >= ? THEN order_id END) AS c30
          FROM google_ads_postback_jobs
          WHERE shop = ? AND created_at >= ? AND status = 'success' AND goal_type = 'revenue'
        `,
        [cutoff24h, cutoff7d, cutoff30d, normShop, cutoff30d]
      );
      uploadedOrders24h = uploadedRow && uploadedRow.c24 != null ? Number(uploadedRow.c24) : 0;
      uploadedOrders7d = uploadedRow && uploadedRow.c7 != null ? Number(uploadedRow.c7) : 0;
      uploadedOrders30d = uploadedRow && uploadedRow.c30 != null ? Number(uploadedRow.c30) : 0;

      const adjQueuedRow = await db.get(
        `SELECT COUNT(*) AS c FROM google_ads_conversion_adjustment_jobs WHERE shop = ? AND status IN ('pending', 'retry')`,
        [normShop]
      ).catch(() => null);
      adjustmentsQueued = adjQueuedRow && adjQueuedRow.c != null ? Number(adjQueuedRow.c) : 0;
      const adjStatusRows = await db.all(
        `SELECT status, COUNT(*) AS c FROM google_ads_conversion_adjustment_jobs WHERE shop = ? GROUP BY status`,
        [normShop]
      ).catch(() => []);
      for (const r of adjStatusRows || []) {
        const st = r && r.status != null ? String(r.status) : '';
        const c = r && r.c != null ? Number(r.c) : 0;
        if (!st) continue;
        if (st === 'pending' || st === 'retry' || st === 'success' || st === 'failed') adjustmentsByStatus[st] = c;
      }
      const adjLastRunRow = await db.get(
        `SELECT MAX(a.attempted_at) AS ts
         FROM google_ads_conversion_adjustment_attempts a
         INNER JOIN google_ads_conversion_adjustment_jobs j ON j.id = a.job_id
         WHERE j.shop = ?`,
        [normShop]
      ).catch(() => null);
      adjustmentsLastRunAt = adjLastRunRow && adjLastRunRow.ts != null ? Number(adjLastRunRow.ts) : null;
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
      upload_policy: { confidence_min: uploadMinTier, allow_tier_c_uploads: allowTierCUploads },
      attribution_tiers_24h: attributionTiers24h,
      attribution_tiers_7d: attributionTiers7d,
      attribution_tiers_30d: attributionTiers30d,
      reconciliation: {
        missing_click_id_orders: missingClickIdCount,
        missing_customer_time_zone: missingCustomerTimeZoneCount,
        low_confidence_skipped: lowConfidenceSkippedCount,
        profit_not_computable: profitNotComputableCount,
        failed_uploads: failedUploadCount,
        rejected_uploads: rejectedUploadCount,
        adjustment_upload_failed: adjustmentFailedCount,
      },
      jobs_queued: jobsQueued,
      last_run_at: lastRunAt,
      adjustments: { jobs_queued: adjustmentsQueued, by_status: adjustmentsByStatus, last_run_at: adjustmentsLastRunAt },
      shopify_paid_orders_24h: paidOrders24h,
      shopify_paid_orders_7d: paidOrders7d,
      shopify_paid_orders_30d: paidOrders30d,
      attributed_orders_24h: attributedOrders24h,
      attributed_orders_7d: attributedOrders7d,
      attributed_orders_30d: attributedOrders30d,
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
    const shop = (req && req.query && req.query.shop != null) ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const attributionModel = (req && req.query && req.query.attributionModel != null) ? String(req.query.attributionModel).trim().toLowerCase() : 'default';
    // Kick off Shopify truth reconcile in the background (summary should return fast).
    // Fresh orders will appear once the scheduled jobs run / next refresh happens.
    try {
      const rangeNorm = adsService.normalizeRangeKey(rangeKey);
      const timeZone = store.resolveAdminTimeZone();
      const bounds = store.getRangeBounds(rangeNorm, Date.now(), timeZone);
      if (shop) salesTruth.ensureReconciled(shop, bounds.start, bounds.end, rangeNorm).catch(() => {});
    } catch (_) {}
    const out = await adsService.getSummary({ rangeKey, shop, attributionModel });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.summary', rangeKey } });
    console.error('[ads.summary]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/other-revenue/drilldown', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    const shop = (req && req.query && req.query.shop != null) ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const utmSource = req && req.query && req.query.utmSource != null ? String(req.query.utmSource).trim() : '';
    const out = await adsService.getOtherRevenueDrilldownByUtmSource({ rangeKey, shop, utmSource });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.other-revenue.drilldown' } });
    console.error('[ads.other-revenue.drilldown]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/other-revenue', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const rangeKey = req && req.query ? req.query.range : '';
    const shop = (req && req.query && req.query.shop != null) ? String(req.query.shop).trim() : salesTruth.resolveShopForSales('');
    const out = await adsService.getOtherRevenueByUtmSource({ rangeKey, shop });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'ads.other-revenue' } });
    console.error('[ads.other-revenue]', err);
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
    const attributionModel = req && req.query && req.query.attributionModel != null ? String(req.query.attributionModel).trim() : '';
    const out = await adsService.getCampaignDetail({ rangeKey, campaignId, attributionModel });
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
