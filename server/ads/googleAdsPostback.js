/**
 * Google Ads postback: enqueue and process UploadClickConversions for Revenue and Profit.
 * Idempotency: (shop, order_id, goal_type). Click-id precedence: gclid -> gbraid -> wbraid.
 * Profit = revenue - configured non-ads costs (excludes ad spend).
 */
const store = require('../store');
const { getDb } = require('../db');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig, getResolvedCustomerIds } = require('./adsStore');
const { getConversionGoals } = require('./googleAdsGoals');
const googleAdsClient = require('./googleAdsClient');
const { fetchAccessTokenFromRefreshToken } = require('./googleAdsSpendSync');
const config = require('../config');
const businessSnapshotService = require('../businessSnapshotService');

const GOOGLE_ADS_ADD_TO_CART_VALUE_KEY = 'google_ads_add_to_cart_value';
const GOOGLE_ADS_POSTBACK_GOALS_KEY = 'google_ads_postback_goals';
const GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY = 'google_ads_profit_deductions_v1';

const MAX_RETRIES = 5;
const BATCH_SIZE = 1000;
const INITIAL_BACKOFF_MS = 2000;

function pickClickIdFromAttribution(row) {
  const t = row && row.click_id_type ? String(row.click_id_type).trim().toLowerCase() : null;
  const v = row && row.click_id_value ? String(row.click_id_value).trim() : null;
  if (v && (t === 'gclid' || t === 'gbraid' || t === 'wbraid')) return { value: v, type: t };
  const gclid = row && row.gclid ? String(row.gclid).trim() : null;
  if (gclid) return { value: gclid, type: 'gclid' };
  const gbraid = row && row.gbraid ? String(row.gbraid).trim() : null;
  if (gbraid) return { value: gbraid, type: 'gbraid' };
  const wbraid = row && row.wbraid ? String(row.wbraid).trim() : null;
  if (wbraid) return { value: wbraid, type: 'wbraid' };
  return { value: null, type: null };
}

/**
 * Single-order profit conversion value (GBP) via allocation model: profit = revenue - (revenue / windowRevenue) * windowCost.
 * Uses googleAdsProfitDeductions toggles; does not mutate profit_rules_v1.
 */
function computeProfitForOrderAllocation(orderRevenueGbp, windowRevenueGbp, windowCostGbp) {
  const rev = Number(orderRevenueGbp) || 0;
  const wRev = Number(windowRevenueGbp) || 0;
  const wCost = Number(windowCostGbp) || 0;
  if (!Number.isFinite(rev) || rev <= 0) return 0;
  if (!Number.isFinite(wRev) || wRev <= 0) return Math.max(0, Math.round(rev * 100) / 100);
  const allocatedCost = (rev / wRev) * wCost;
  const profit = rev - (Number.isFinite(allocatedCost) ? allocatedCost : 0);
  return Math.max(0, Number.isFinite(profit) ? Math.round(profit * 100) / 100 : Math.round(rev * 100) / 100);
}

/**
 * Legacy/simple profit value (GBP) for a single order.
 *
 * Fail-open by design: when config is missing/invalid/disabled/unsupported, return revenue.
 *
 * Supported:
 * - mode: "simple" with percent_of_revenue and/or fixed_per_order_gbp deductions.
 */
function computeProfitForOrder(orderRevenueGbp, configRaw) {
  const rev = Number(orderRevenueGbp) || 0;
  const roundedRev = Number.isFinite(rev) ? Math.round(rev * 100) / 100 : 0;
  if (!Number.isFinite(roundedRev) || roundedRev <= 0) return 0;
  const cfg = configRaw && typeof configRaw === 'object' ? configRaw : null;
  if (!cfg) return roundedRev;

  const mode = (cfg.mode != null ? String(cfg.mode) : '').trim().toLowerCase();
  if (!mode || mode === 'costs') return roundedRev;
  if (mode !== 'simple') return roundedRev;

  const simple = cfg.simple && typeof cfg.simple === 'object' ? cfg.simple : {};
  const pct = Number(simple.percent_of_revenue) || 0;
  const fixed = Number(simple.fixed_per_order_gbp) || 0;
  const pctDeduction = (Number.isFinite(pct) && pct > 0) ? (roundedRev * (pct / 100)) : 0;
  const profit = roundedRev - (Number.isFinite(pctDeduction) ? pctDeduction : 0) - (Number.isFinite(fixed) ? fixed : 0);
  return Math.max(0, Number.isFinite(profit) ? Math.round(profit * 100) / 100 : 0);
}

/** Format conversion_date_time for Google Ads: "yyyy-mm-dd hh:mm:ss+|-hh:mm" (account TZ). */
function formatConversionDateTime(createdAtMs, accountTimeZone = 'UTC') {
  const d = new Date(Number(createdAtMs));
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: accountTimeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    const str = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
    const offset = getTimezoneOffset(accountTimeZone, d);
    return str + offset;
  } catch (_) {
    return null;
  }
}

function getTimezoneOffset(tz, date) {
  try {
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    const local = new Date(date.toLocaleString('en-US', { timeZone: tz }));
    const min = (local - utc) / 60000;
    const sign = min >= 0 ? '+' : '-';
    const abs = Math.abs(min);
    const h = Math.floor(abs / 60);
    const m = Math.round(abs % 60);
    return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } catch (_) {
    return '+00:00';
  }
}

/**
 * Enqueue dual-goal jobs for eligible attributed orders (revenue + profit).
 * Skips orders without click id; records issue for missing click id when order is otherwise eligible.
 */
async function enqueueEligibleOrders(shop, options = {}) {
  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set', enqueued: 0, issues: 0 };
  let rawPostbackGoals = null;
  try {
    rawPostbackGoals = await store.getSetting(GOOGLE_ADS_POSTBACK_GOALS_KEY);
  } catch (_) {}
  const postbackGoals = normalizePostbackGoals(rawPostbackGoals);

  const goals = await getConversionGoals(shop);
  const revenueGoal = (goals || []).find((g) => g.goal_type === 'revenue' && g.conversion_action_resource_name);
  const profitGoal = (goals || []).find((g) => g.goal_type === 'profit' && g.conversion_action_resource_name);
  if (!revenueGoal && !profitGoal) {
    try {
      const normShop = String(shop || '').trim().toLowerCase();
      if (normShop) {
        await recordIssue(adsDb, normShop, {
          source: 'postback',
          severity: 'warning',
          affected_goal: null,
          error_code: 'MISSING_CONVERSION_ACTION',
          error_message: 'No conversion actions are provisioned for Revenue/Profit uploads.',
          suggested_fix: 'Go to Settings → Integrations → Google Ads and click “Provision conversion actions”.',
          first_seen_at: Date.now(),
          last_seen_at: Date.now(),
        });
      }
    } catch (_) {}
    return { ok: true, enqueued: 0, issues: 0, message: 'No conversion goals provisioned' };
  }

  const limit = Math.min(Number(options.limit) || 500, 2000);
  const rows = await adsDb.all(
    `SELECT shop, order_id, created_at_ms, currency, revenue_gbp, click_id_type, click_id_value, gclid, gbraid, wbraid
     FROM ads_orders_attributed
     WHERE shop = ?
     ORDER BY created_at_ms DESC
     LIMIT ?`,
    [String(shop).trim().toLowerCase(), limit]
  );

  let enqueued = 0;
  let issuesCreated = 0;
  const now = Date.now();
  let profitDeductions = null;
  try {
    const raw = await store.getSetting(GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY);
    if (raw && typeof raw === 'object') profitDeductions = raw;
    else if (typeof raw === 'string' && raw.trim()) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') profitDeductions = o;
    }
  } catch (_) {}
  const deductionToggles = profitDeductions && typeof profitDeductions === 'object' ? {
    includeGoogleAdsSpend: profitDeductions.includeGoogleAdsSpend === true,
    includePaymentFees: profitDeductions.includePaymentFees === true,
    includeShopifyTaxes: profitDeductions.includeShopifyTaxes === true,
    includeShopifyAppBills: profitDeductions.includeShopifyAppBills === true,
    includeShipping: profitDeductions.includeShipping === true,
    includeRules: profitDeductions.includeRules === true,
  } : {};

  let windowRevenueGbp = 0;
  let windowCostGbp = 0;
  if (profitGoal && postbackGoals.uploadProfit && rows && rows.length > 0) {
    const minMs = Math.min(...rows.map((r) => Number(r.created_at_ms)).filter(Number.isFinite));
    const maxMs = Math.max(...rows.map((r) => Number(r.created_at_ms)).filter(Number.isFinite));
    const windowStart = Number.isFinite(minMs) ? minMs : now - 90 * 24 * 60 * 60 * 1000;
    const windowEnd = Number.isFinite(maxMs) ? maxMs : now;
    try {
      const win = await businessSnapshotService.getRevenueAndCostForGoogleAdsPostback(
        String(shop).trim().toLowerCase(),
        windowStart,
        windowEnd,
        deductionToggles
      );
      windowRevenueGbp = Number(win.revenueGbp) || 0;
      windowCostGbp = Number(win.costGbp) || 0;
    } catch (_) {}
  }

  for (const row of rows || []) {
    const orderId = row && row.order_id ? String(row.order_id).trim() : '';
    const shopNorm = row && row.shop ? String(row.shop).trim().toLowerCase() : '';
    const revenueGbp = row && row.revenue_gbp != null ? Number(row.revenue_gbp) : 0;
    const createdAtMs = row && row.created_at_ms != null ? Number(row.created_at_ms) : null;
    const currency = (row && row.currency) ? String(row.currency).trim().toUpperCase() : 'GBP';
    if (!orderId || !shopNorm || !Number.isFinite(revenueGbp) || !createdAtMs) continue;

    const click = pickClickIdFromAttribution(row);
    if (!click.value) {
      await recordIssue(adsDb, shopNorm, {
        source: 'postback',
        severity: 'warning',
        affected_goal: 'revenue',
        error_code: 'MISSING_CLICK_ID',
        error_message: `Order ${orderId} has no gclid/gbraid/wbraid`,
        suggested_fix: 'Ensure landing URL or attribution includes a Google click ID.',
        first_seen_at: now,
        last_seen_at: now,
      });
      issuesCreated++;
      continue;
    }

    const conversionDateTime = formatConversionDateTime(createdAtMs) || `${new Date(createdAtMs).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;

    if (postbackGoals.uploadRevenue && revenueGoal && revenueGoal.conversion_action_resource_name) {
      const inserted = await insertJobIfNotExists(adsDb, {
        shop: shopNorm,
        order_id: orderId,
        goal_type: 'revenue',
        conversion_action_resource_name: revenueGoal.conversion_action_resource_name,
        conversion_date_time: conversionDateTime,
        conversion_value: revenueGbp,
        currency_code: currency,
        click_id_type: click.type,
        click_id_value: click.value,
        created_at: now,
        updated_at: now,
      });
      if (inserted) enqueued++;
    }

    if (postbackGoals.uploadProfit && profitGoal && profitGoal.conversion_action_resource_name) {
      const profitValue = computeProfitForOrderAllocation(revenueGbp, windowRevenueGbp, windowCostGbp);
      const inserted = await insertJobIfNotExists(adsDb, {
        shop: shopNorm,
        order_id: orderId,
        goal_type: 'profit',
        conversion_action_resource_name: profitGoal.conversion_action_resource_name,
        conversion_date_time: conversionDateTime,
        conversion_value: profitValue,
        currency_code: currency,
        click_id_type: click.type,
        click_id_value: click.value,
        created_at: now,
        updated_at: now,
      });
      if (inserted) enqueued++;
    }
  }

  return { ok: true, enqueued, issues: issuesCreated };
}

async function insertJobIfNotExists(adsDb, job) {
  try {
    const r = await adsDb.run(
      `INSERT INTO google_ads_postback_jobs (shop, order_id, goal_type, conversion_action_resource_name, conversion_date_time, conversion_value, currency_code, click_id_type, click_id_value, status, retry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT (shop, order_id, goal_type) DO NOTHING`,
      [
        job.shop,
        job.order_id,
        job.goal_type,
        job.conversion_action_resource_name,
        job.conversion_date_time,
        job.conversion_value,
        job.currency_code,
        job.click_id_type,
        job.click_id_value,
        job.created_at,
        job.updated_at,
      ]
    );
    return (r && r.changes) ? r.changes > 0 : false;
  } catch (_) {
    return false;
  }
}

/** Normalize postback goals from stored JSON. */
function normalizePostbackGoals(raw) {
  let parsed = null;
  if (raw && typeof raw === 'object') parsed = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') parsed = o;
    } catch (_) {}
  }
  return {
    uploadRevenue: parsed && parsed.uploadRevenue !== false,
    uploadProfit: parsed && parsed.uploadProfit === true,
    uploadAddToCart: parsed && parsed.uploadAddToCart === true,
  };
}

/**
 * Enqueue add_to_cart jobs from main DB events (product_added_to_cart) joined to sessions for gclid/gbraid/wbraid.
 * Synthetic order_id = atc:${event_id}. Value from googleAdsAddToCartValue (default 1).
 */
async function enqueueAddToCartEvents(shop, options = {}) {
  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set', enqueued: 0 };
  const goals = await getConversionGoals(shop);
  const addToCartGoal = (goals || []).find((g) => g.goal_type === 'add_to_cart' && g.conversion_action_resource_name);
  if (!addToCartGoal) return { ok: true, enqueued: 0, message: 'No add_to_cart goal provisioned' };

  let rawGoals = null;
  try {
    rawGoals = await store.getSetting(GOOGLE_ADS_POSTBACK_GOALS_KEY);
  } catch (_) {}
  const postbackGoals = normalizePostbackGoals(rawGoals);
  if (!postbackGoals.uploadAddToCart) return { ok: true, enqueued: 0, message: 'Add to Cart upload disabled' };

  let addToCartValue = 1;
  try {
    const v = await store.getSetting(GOOGLE_ADS_ADD_TO_CART_VALUE_KEY);
    if (v != null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) addToCartValue = n;
    }
  } catch (_) {}

  const db = getDb();
  if (!db) return { ok: false, error: 'Main DB not available', enqueued: 0 };
  const limit = Math.min(Number(options.limit) || 500, 2000);
  const shopNorm = String(shop || '').trim().toLowerCase();
  if (!shopNorm) return { ok: true, enqueued: 0 };

  const rows = await db.all(
    `SELECT e.id AS event_id, e.ts, s.gclid, s.gbraid, s.wbraid
     FROM events e
     INNER JOIN sessions s ON s.session_id = e.session_id
     WHERE e.type = 'product_added_to_cart'
       AND ((s.gclid IS NOT NULL AND s.gclid != '')
         OR (s.gbraid IS NOT NULL AND s.gbraid != '')
         OR (s.wbraid IS NOT NULL AND s.wbraid != ''))
     ORDER BY e.ts DESC
     LIMIT ?`,
    [limit]
  );

  const now = Date.now();
  let enqueued = 0;
  for (const row of rows || []) {
    const eventId = row && row.event_id != null ? row.event_id : null;
    const ts = row && row.ts != null ? Number(row.ts) : null;
    if (eventId == null || !ts) continue;
    const click = pickClickIdFromAttribution(row);
    if (!click.value) continue;
    const conversionDateTime = formatConversionDateTime(ts) || `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
    const orderId = `atc:${eventId}`;
    const inserted = await insertJobIfNotExists(adsDb, {
      shop: shopNorm,
      order_id: orderId,
      goal_type: 'add_to_cart',
      conversion_action_resource_name: addToCartGoal.conversion_action_resource_name,
      conversion_date_time: conversionDateTime,
      conversion_value: addToCartValue,
      currency_code: 'GBP',
      click_id_type: click.type,
      click_id_value: click.value,
      created_at: now,
      updated_at: now,
    });
    if (inserted) enqueued++;
  }
  return { ok: true, enqueued };
}

async function recordIssue(adsDb, shop, payload) {
  const now = Date.now();
  try {
    await adsDb.run(
      `INSERT INTO google_ads_issues (shop, source, severity, status, affected_goal, error_code, error_message, suggested_fix, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shop,
        payload.source || 'postback',
        payload.severity || 'error',
        payload.affected_goal || null,
        payload.error_code || null,
        payload.error_message || null,
        payload.suggested_fix || null,
        payload.first_seen_at || now,
        payload.last_seen_at || now,
        now,
        now,
      ]
    );
  } catch (_) {}
}

/**
 * Process a batch of pending/retry jobs: call UploadClickConversions, record attempts, update status.
 */
async function processPostbackBatch(shop, options = {}) {
  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set', processed: 0 };
  const batchSize = Math.min(Number(options.batchSize) || BATCH_SIZE, 2000);
  const cfg = await getGoogleAdsConfig(shop);
  const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
  if (!refreshToken) return { ok: false, error: 'Not connected', processed: 0 };
  const { customerId, loginCustomerId, conversionCustomerId } = getResolvedCustomerIds(cfg);
  if (!customerId) return { ok: false, error: 'Missing customer_id', processed: 0 };
  const targetCustomerId = conversionCustomerId || customerId;

  const jobs = await adsDb.all(
    `SELECT id, shop, order_id, goal_type, conversion_action_resource_name, conversion_date_time, conversion_value, currency_code, click_id_type, click_id_value, retry_count
     FROM google_ads_postback_jobs
     WHERE shop = ? AND status IN ('pending', 'retry') AND (next_retry_at IS NULL OR next_retry_at <= ?)
     ORDER BY id ASC
     LIMIT ?`,
    [String(shop).trim().toLowerCase(), Date.now(), batchSize]
  );
  if (!jobs || !jobs.length) return { ok: true, processed: 0 };

  let accessToken;
  try {
    accessToken = await fetchAccessTokenFromRefreshToken(refreshToken);
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'token_failed', processed: 0 };
  }

  const developerToken = (config.googleAdsDeveloperToken || '').trim();
  const versions = ['v17', 'v16', 'v15'];
  const jobId = Date.now();
  const conversions = jobs.map((j) => {
    const c = {
      conversion_action: j.conversion_action_resource_name,
      conversion_date_time: j.conversion_date_time,
      conversion_value: j.conversion_value,
      currency_code: j.currency_code,
      order_id: j.order_id,
    };
    if (j.click_id_type === 'gclid') c.gclid = j.click_id_value;
    else if (j.click_id_type === 'gbraid') c.gbraid = j.click_id_value;
    else if (j.click_id_type === 'wbraid') c.wbraid = j.click_id_value;
    return c;
  });

  let lastErr = null;
  for (const ver of versions) {
    const url = `https://googleads.googleapis.com/${ver}/customers/${encodeURIComponent(targetCustomerId)}:uploadClickConversions`;
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    };
    if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversions,
          partial_failure: true,
          job_id: jobId,
          validate_only: options.validateOnly === true,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = `${res.status} ${text.slice(0, 300)}`;
        if (res.status === 404) continue;
        break;
      }
      let data = {};
      try {
        data = JSON.parse(text || '{}');
      } catch (_) {}

      const now = Date.now();
      const partialFailures = (data && data.partial_failure_error && data.partial_failure_error.details) || [];
      const results = (data && data.results) || [];
      const indexToJob = jobs.reduce((acc, j, i) => {
        acc[i] = j;
        return acc;
      }, {});

      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const result = results[i] || null;
        const errDetail = partialFailures.find((d) => d && d.field_path_elements && d.field_path_elements.some((e) => e.index && Number(e.index) === i));
        const errMsg = (errDetail && errDetail.message) || (result && result.error && result.error.message) || null;
        const isDuplicate = errMsg && /DUPLICATE_ORDER_ID|already uploaded/i.test(errMsg);

        await adsDb.run(
          `INSERT INTO google_ads_postback_attempts (job_id, attempt_number, http_status, response_body, error_message, attempted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [job.id, (job.retry_count || 0) + 1, res.status, text.slice(0, 2000), errMsg ? errMsg.slice(0, 500) : null, now]
        );

        if (errMsg && !isDuplicate) {
          const nextRetry = (job.retry_count || 0) + 1 >= MAX_RETRIES ? null : now + INITIAL_BACKOFF_MS * Math.pow(2, job.retry_count || 0);
          await adsDb.run(
            `UPDATE google_ads_postback_jobs SET status = ?, retry_count = retry_count + 1, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
            [nextRetry ? 'retry' : 'failed', errMsg.slice(0, 500), nextRetry, now, job.id]
          );
          await recordIssue(adsDb, job.shop, {
            source: 'postback',
            severity: 'error',
            affected_goal: job.goal_type,
            error_code: 'UPLOAD_FAILED',
            error_message: errMsg.slice(0, 300),
            suggested_fix: 'Check conversion action and click ID; retry later.',
            first_seen_at: now,
            last_seen_at: now,
          });
        } else {
          await adsDb.run(
            `UPDATE google_ads_postback_jobs SET status = ?, last_error = NULL, next_retry_at = NULL, updated_at = ?, job_id = ? WHERE id = ?`,
            [isDuplicate ? 'success' : 'success', now, jobId, job.id]
          );
          if (isDuplicate) {
            await recordIssue(adsDb, job.shop, {
              source: 'postback',
              severity: 'info',
              affected_goal: job.goal_type,
              error_code: 'DUPLICATE_ORDER_ID',
              error_message: `Order ${job.order_id} already uploaded (success-with-warning).`,
              suggested_fix: null,
              first_seen_at: now,
              last_seen_at: now,
            });
          }
        }
      }

      return { ok: true, processed: jobs.length, apiVersion: ver, partialFailures: partialFailures.length };
    } catch (e) {
      lastErr = e && e.message ? e.message : String(e);
    }
  }

  const now = Date.now();
  for (const job of jobs) {
    await adsDb.run(
      `INSERT INTO google_ads_postback_attempts (job_id, attempt_number, http_status, error_message, attempted_at) VALUES (?, ?, ?, ?, ?)`,
      [job.id, (job.retry_count || 0) + 1, null, lastErr ? lastErr.slice(0, 500) : null, now]
    );
    const nextRetry = (job.retry_count || 0) + 1 >= MAX_RETRIES ? null : now + INITIAL_BACKOFF_MS * Math.pow(2, job.retry_count || 0);
    await adsDb.run(
      `UPDATE google_ads_postback_jobs SET status = ?, retry_count = retry_count + 1, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
      [nextRetry ? 'retry' : 'failed', lastErr ? lastErr.slice(0, 500) : null, nextRetry, now, job.id]
    );
  }
  return { ok: false, error: lastErr || 'upload failed', processed: jobs.length };
}

/**
 * Run postback processor once for a shop (enqueue orders + enqueue add-to-cart + process batch). Call from scheduler.
 */
async function runPostbackCycle(shop, options = {}) {
  if (!shop || typeof shop !== 'string' || !shop.trim()) return { ok: false, error: 'shop required' };
  const enabled = options.postbackEnabled !== false;
  if (!enabled) return { ok: true, skipped: true, reason: 'postback disabled' };
  const enqueueOut = await enqueueEligibleOrders(shop, { limit: options.enqueueLimit || 500 });
  if (!enqueueOut.ok) return enqueueOut;
  const atcOut = await enqueueAddToCartEvents(shop, { limit: options.enqueueLimit || 500 });
  const totalEnqueued = (enqueueOut.enqueued || 0) + (atcOut.enqueued || 0);
  const processOut = await processPostbackBatch(shop, { batchSize: options.batchSize || BATCH_SIZE, validateOnly: options.validateOnly });
  return {
    ok: processOut.ok,
    enqueued: totalEnqueued,
    processed: processOut.processed || 0,
    error: processOut.error,
    issues: enqueueOut.issues || 0,
  };
}

module.exports = {
  enqueueEligibleOrders,
  enqueueAddToCartEvents,
  processPostbackBatch,
  runPostbackCycle,
  pickClickIdFromAttribution,
  computeProfitForOrder,
  computeProfitForOrderAllocation,
};
