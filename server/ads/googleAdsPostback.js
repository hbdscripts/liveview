/**
 * Google Ads postback: enqueue and process UploadClickConversions for Revenue and Profit.
 * Idempotency: (shop, order_id, goal_type). Click-id precedence: gclid -> gbraid -> wbraid.
 * Profit = revenue - configured non-ads costs (excludes ad spend).
 */
const store = require('../store');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig, getResolvedCustomerIds } = require('./adsStore');
const { getConversionGoals } = require('./googleAdsGoals');
const googleAdsClient = require('./googleAdsClient');
const { fetchAccessTokenFromRefreshToken } = require('./googleAdsSpendSync');
const config = require('../config');
const { PROFIT_RULES_V1_KEY } = require('../profitRulesConfig');
const { normalizeProfitRulesConfigV1 } = require('../profitRulesConfig');

const MAX_RETRIES = 5;
const BATCH_SIZE = 1000;
const INITIAL_BACKOFF_MS = 2000;

function pickClickIdFromAttribution(row) {
  const gclid = row && row.gclid ? String(row.gclid).trim() : null;
  if (gclid) return { value: gclid, type: 'gclid' };
  const gbraid = row && row.gbraid ? String(row.gbraid).trim() : null;
  if (gbraid) return { value: gbraid, type: 'gbraid' };
  const wbraid = row && row.wbraid ? String(row.wbraid).trim() : null;
  if (wbraid) return { value: wbraid, type: 'wbraid' };
  return { value: null, type: null };
}

/** Single-order profit deductions (non-ads only): revenue - sum(percent_revenue + fixed_per_order). */
function computeProfitForOrder(revenueGbp, profitRulesConfig) {
  const cfg = normalizeProfitRulesConfigV1(profitRulesConfig);
  if (!cfg || !cfg.enabled || !Array.isArray(cfg.rules)) return revenueGbp;
  let deductions = 0;
  for (const rule of cfg.rules) {
    if (!rule || !rule.enabled) continue;
    const value = Number(rule.value) || 0;
    if (rule.type === 'percent_revenue') {
      deductions += revenueGbp * (value / 100);
    } else if (rule.type === 'fixed_per_order') {
      deductions += value; // 1 order
    }
    // fixed_per_period: not applied per order
  }
  const profit = revenueGbp - (Number.isFinite(deductions) ? deductions : 0);
  return Math.max(0, Number.isFinite(profit) ? Math.round(profit * 100) / 100 : revenueGbp);
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
  const goals = await getConversionGoals(shop);
  const revenueGoal = (goals || []).find((g) => g.goal_type === 'revenue' && g.conversion_action_resource_name);
  const profitGoal = (goals || []).find((g) => g.goal_type === 'profit' && g.conversion_action_resource_name);
  if (!revenueGoal && !profitGoal) {
    return { ok: true, enqueued: 0, issues: 0, message: 'No conversion goals provisioned' };
  }

  const limit = Math.min(Number(options.limit) || 500, 2000);
  const rows = await adsDb.all(
    `SELECT shop, order_id, created_at_ms, currency, revenue_gbp, gclid, gbraid, wbraid
     FROM ads_orders_attributed
     WHERE shop = ?
     ORDER BY created_at_ms DESC
     LIMIT ?`,
    [String(shop).trim().toLowerCase(), limit]
  );

  let enqueued = 0;
  let issuesCreated = 0;
  const now = Date.now();
  let rawProfitRules = null;
  try {
    rawProfitRules = await store.getSetting(PROFIT_RULES_V1_KEY);
  } catch (_) {}

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

    if (revenueGoal && revenueGoal.conversion_action_resource_name) {
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

    if (profitGoal && profitGoal.conversion_action_resource_name) {
      const profitValue = computeProfitForOrder(revenueGbp, rawProfitRules);
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
  const { customerId, loginCustomerId } = getResolvedCustomerIds(cfg);
  if (!customerId) return { ok: false, error: 'Missing customer_id', processed: 0 };

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
    const url = `https://googleads.googleapis.com/${ver}/customers/${encodeURIComponent(customerId)}:uploadClickConversions`;
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
 * Run postback processor once for a shop (enqueue + process batch). Call from scheduler.
 */
async function runPostbackCycle(shop, options = {}) {
  if (!shop || typeof shop !== 'string' || !shop.trim()) return { ok: false, error: 'shop required' };
  const enabled = options.postbackEnabled !== false;
  if (!enabled) return { ok: true, skipped: true, reason: 'postback disabled' };
  const enqueueOut = await enqueueEligibleOrders(shop, { limit: options.enqueueLimit || 500 });
  if (!enqueueOut.ok) return enqueueOut;
  const processOut = await processPostbackBatch(shop, { batchSize: options.batchSize || BATCH_SIZE, validateOnly: options.validateOnly });
  return {
    ok: processOut.ok,
    enqueued: enqueueOut.enqueued,
    processed: processOut.processed || 0,
    error: processOut.error,
    issues: enqueueOut.issues || 0,
  };
}

module.exports = {
  enqueueEligibleOrders,
  processPostbackBatch,
  runPostbackCycle,
  pickClickIdFromAttribution,
  computeProfitForOrder,
};
