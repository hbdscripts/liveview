/**
 * Google Ads postback: enqueue and process UploadClickConversions for Revenue and Profit.
 * Idempotency: (shop, order_id, goal_type). Click-id precedence: gclid -> gbraid -> wbraid.
 * Profit = revenue - configured non-ads costs (excludes ad spend).
 */
const store = require('../store');
const fx = require('../fx');
const { getDb } = require('../db');
const { getAdsDb } = require('./adsDb');
const { getGoogleAdsConfig, getResolvedCustomerIds, setGoogleAdsCustomerTimeZone } = require('./adsStore');
const { getConversionGoals } = require('./googleAdsGoals');
const googleAdsClient = require('./googleAdsClient');
const { fetchAccessTokenFromRefreshToken } = require('./googleAdsSpendSync');
const config = require('../config');
const businessSnapshotService = require('../businessSnapshotService');

const GOOGLE_ADS_ADD_TO_CART_VALUE_KEY = 'google_ads_add_to_cart_value';
const GOOGLE_ADS_BEGIN_CHECKOUT_VALUE_KEY = 'google_ads_begin_checkout_value';
const GOOGLE_ADS_POSTBACK_GOALS_KEY = 'google_ads_postback_goals';
const GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY = 'google_ads_profit_deductions_v1';
const GOOGLE_ADS_UPLOAD_CONFIDENCE_MIN_KEY = 'google_ads_upload_confidence_min';
const GOOGLE_ADS_ALLOW_TIER_C_UPLOADS_KEY = 'google_ads_allow_tier_c_uploads';
const GOOGLE_ADS_EVENT_UPLOAD_CONFIDENCE_MIN_KEY = 'google_ads_event_upload_confidence_min';
const GOOGLE_ADS_ADJUSTMENTS_ENABLED_KEY = 'google_ads_adjustments_enabled';
const GOOGLE_ADS_CART_DATA_MERCHANT_ID_KEY = 'google_ads_cart_data_merchant_id';
const GOOGLE_ADS_CART_DATA_FEED_COUNTRY_KEY = 'google_ads_cart_data_feed_country';
const GOOGLE_ADS_CART_DATA_FEED_LANGUAGE_KEY = 'google_ads_cart_data_feed_language';
const GOOGLE_ADS_CART_DATA_GOALS_KEY = 'google_ads_cart_data_goals';

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

/** Parse gclid/gbraid/wbraid from entry_url when session columns are empty. Precedence: gclid -> gbraid -> wbraid. */
function parseClickIdsFromEntryUrl(entryUrl) {
  if (!entryUrl || typeof entryUrl !== 'string' || !entryUrl.trim()) return { value: null, type: null };
  let params;
  try {
    const url = entryUrl.trim();
    if (/^https?:\/\//i.test(url)) params = new URL(url).searchParams;
    else params = new URL(url, 'https://example.local').searchParams;
  } catch (_) {
    return { value: null, type: null };
  }
  const gclid = params.get('gclid'); if (gclid && String(gclid).trim()) return { value: String(gclid).trim(), type: 'gclid' };
  const gbraid = params.get('gbraid'); if (gbraid && String(gbraid).trim()) return { value: String(gbraid).trim(), type: 'gbraid' };
  const wbraid = params.get('wbraid'); if (wbraid && String(wbraid).trim()) return { value: String(wbraid).trim(), type: 'wbraid' };
  return { value: null, type: null };
}

/** Resolve click ID from row: session columns first, then parse from entry_url if missing. */
function resolveClickId(row) {
  const fromCols = pickClickIdFromAttribution(row);
  if (fromCols.value) return fromCols;
  const entryUrl = row && row.entry_url != null ? String(row.entry_url).trim() : '';
  return parseClickIdsFromEntryUrl(entryUrl);
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
 * Legacy/simple profit computation used by tests and some callers:
 * - If config missing/disabled/unknown → revenue (fail-open).
 * - mode=simple: profit = revenue - (percent_of_revenue%) - fixed_per_order_gbp (floored at 0).
 */
function computeProfitForOrder(orderRevenueGbp, profitRulesV1) {
  const revenue = Number(orderRevenueGbp);
  if (!Number.isFinite(revenue) || revenue <= 0) return 0;
  const cfg = profitRulesV1 && typeof profitRulesV1 === 'object' ? profitRulesV1 : null;
  if (!cfg) return Math.round(revenue * 100) / 100;

  const mode = cfg && cfg.mode != null ? String(cfg.mode).trim().toLowerCase() : '';
  if (mode !== 'simple') return Math.round(revenue * 100) / 100;

  const simple = cfg && cfg.simple && typeof cfg.simple === 'object' ? cfg.simple : {};
  const pct = Number(simple.percent_of_revenue);
  const fixed = Number(simple.fixed_per_order_gbp);
  const pctDeduction = Number.isFinite(pct) && pct > 0 ? (revenue * pct) / 100 : 0;
  const fixedDeduction = Number.isFinite(fixed) && fixed > 0 ? fixed : 0;
  const profit = revenue - pctDeduction - fixedDeduction;
  return Math.max(0, Math.round((Number.isFinite(profit) ? profit : revenue) * 100) / 100);
}

function normalizeTier(raw, fallback = 'B') {
  const s = raw != null ? String(raw).trim().toUpperCase() : '';
  if (s === 'A' || s === 'B' || s === 'C') return s;
  if (s === 'TIER A' || s === 'TIER_A') return 'A';
  if (s === 'TIER B' || s === 'TIER_B') return 'B';
  if (s === 'TIER C' || s === 'TIER_C') return 'C';
  return fallback;
}

function normalizeBool(raw, fallback = false) {
  if (raw === true) return true;
  if (raw === false) return false;
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!s) return fallback;
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on') return true;
  if (s === '0' || s === 'false' || s === 'no' || s === 'n' || s === 'off') return false;
  return fallback;
}

function tierScore(tier) {
  const t = normalizeTier(tier, 'B');
  if (t === 'A') return 3;
  if (t === 'B') return 2;
  if (t === 'C') return 1;
  return 0;
}

function isTierAllowed(tier, minTier, allowTierC) {
  const t = normalizeTier(tier, 'B');
  const min = normalizeTier(minTier, 'B');
  if (t === 'C' && allowTierC !== true) return false;
  return tierScore(t) >= tierScore(min);
}

function isValidIanaTimeZone(tz) {
  const s = tz != null ? String(tz).trim() : '';
  if (!s) return false;
  try {
    // Throws on unknown timezones (Node/ICU).
    new Intl.DateTimeFormat('en-CA', { timeZone: s }).format(new Date());
    return true;
  } catch (_) {
    return false;
  }
}

async function resolveCustomerTimeZone(shop) {
  const normShop = String(shop || '').trim().toLowerCase();
  let tz = '';
  try {
    const cfg = await getGoogleAdsConfig(normShop);
    if (cfg && cfg.customer_time_zone != null) tz = String(cfg.customer_time_zone).trim();
  } catch (_) {}
  if (tz && isValidIanaTimeZone(tz)) return { ok: true, timeZone: tz, source: 'stored' };

  try {
    const fetched = await googleAdsClient.fetchCustomerTimeZone(normShop);
    const next = fetched && fetched.ok && fetched.timeZone != null ? String(fetched.timeZone).trim() : '';
    if (next && isValidIanaTimeZone(next)) {
      try { await setGoogleAdsCustomerTimeZone(normShop, next); } catch (_) {}
      return { ok: true, timeZone: next, source: 'api' };
    }
  } catch (_) {}

  try {
    const adsDb = getAdsDb();
    if (adsDb && normShop) {
      await recordIssue(adsDb, normShop, {
        source: 'postback',
        severity: 'warning',
        affected_goal: null,
        error_code: 'MISSING_CUSTOMER_TIME_ZONE',
        error_message: 'Google Ads customer timezone is missing; using UTC for conversion timestamps.',
        suggested_fix: 'Refresh Google Ads connection details so Kexo can read customer.time_zone.',
        first_seen_at: Date.now(),
        last_seen_at: Date.now(),
      });
    }
  } catch (_) {}

  return { ok: false, timeZone: 'UTC', source: 'fallback' };
}

/**
 * Build Merchant Center product id for cart data: shopify_{feedCountry}_{product_id}_{variant_id}.
 * @param {string} feedCountry - e.g. GB
 * @param {string|number} productId
 * @param {string|number} variantId
 * @returns {string}
 */
function buildMerchantCenterProductId(feedCountry, productId, variantId) {
  const country = (feedCountry != null && String(feedCountry).trim()) ? String(feedCountry).trim().toUpperCase().slice(0, 2) : 'GB';
  const pid = (productId != null && String(productId).trim() !== '') ? String(productId).trim() : '';
  const vid = (variantId != null && String(variantId).trim() !== '') ? String(variantId).trim() : '';
  return `shopify_${country}_${pid}_${vid}`;
}

/**
 * Build CartData for a Shopify order from orders_shopify + orders_shopify_line_items.
 * @param {string} shop
 * @param {string} orderId - Shopify order id (numeric or gid)
 * @param {{ feedCountry: string, feedLanguage: string, merchantId: string }} opts
 * @returns {Promise<{ cartData?: object, error?: string, reason?: string }>}
 */
async function buildCartDataForOrder(shop, orderId, opts = {}) {
  const mainDb = getDb();
  if (!mainDb) return { error: 'no_db', reason: 'Main DB not available' };
  const feedCountry = (opts.feedCountry != null && String(opts.feedCountry).trim()) ? String(opts.feedCountry).trim().toUpperCase().slice(0, 2) : 'GB';
  const feedLanguage = (opts.feedLanguage != null && String(opts.feedLanguage).trim()) ? String(opts.feedLanguage).trim().toUpperCase().slice(0, 2) : 'EN';
  const merchantId = opts.merchantId != null ? String(opts.merchantId).trim() : '';
  const normShop = String(shop || '').trim().toLowerCase();
  if (!normShop || !orderId || typeof orderId !== 'string' || !orderId.trim()) {
    return { error: 'invalid_args', reason: 'shop and order_id required' };
  }
  const orderIdTrim = orderId.trim();
  const orderIdNum = orderIdTrim.replace(/^gid:\/\/shopify\/Order\/|\D/g, '') || orderIdTrim;
  let orderRow;
  try {
    orderRow = await mainDb.get(
      `SELECT order_id, currency, total_discounts FROM orders_shopify WHERE shop = ? AND (order_id = ? OR order_id = ?) AND financial_status IN ('paid', 'partially_refunded') AND cancelled_at IS NULL LIMIT 1`,
      [normShop, orderIdTrim, orderIdNum]
    );
  } catch (e) {
    return { error: 'db_error', reason: (e && e.message) || 'order lookup failed' };
  }
  if (!orderRow) return { error: 'order_not_found', reason: 'Order not found or not paid' };
  const currency = orderRow.currency != null ? String(orderRow.currency).trim() : '';
  if (!currency) return { error: 'no_currency', reason: 'Order has no currency' };
  let lineRows;
  try {
    lineRows = await mainDb.all(
      `SELECT product_id, variant_id, quantity, unit_price FROM orders_shopify_line_items WHERE shop = ? AND order_id IN (?, ?)`,
      [normShop, orderRow.order_id, orderIdNum]
    );
  } catch (e) {
    return { error: 'db_error', reason: (e && e.message) || 'line items lookup failed' };
  }
  if (!lineRows || !lineRows.length) return { error: 'no_line_items', reason: 'No line items for order' };
  const items = [];
  for (const row of lineRows) {
    const productId = row.product_id != null ? String(row.product_id).trim() : '';
    const variantId = row.variant_id != null ? String(row.variant_id).trim() : '';
    if (!productId || !variantId) continue;
    const quantity = Math.max(1, parseInt(row.quantity, 10) || 1);
    const unitPrice = Number(row.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) continue;
    items.push({
      product_id: buildMerchantCenterProductId(feedCountry, productId, variantId),
      quantity,
      unit_price: unitPrice,
    });
  }
  if (!items.length) return { error: 'no_valid_items', reason: 'No valid line items with product_id and variant_id' };
  const cartData = {
    feed_country_code: feedCountry,
    feed_language_code: feedLanguage,
    local_transaction_cost: Number.isFinite(Number(orderRow.total_discounts)) && Number(orderRow.total_discounts) >= 0 ? Number(orderRow.total_discounts) : 0,
    items,
  };
  const mid = parseInt(merchantId, 10);
  if (Number.isFinite(mid) && mid > 0) cartData.merchant_id = mid;
  return { cartData };
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

  let uploadMinTier = 'B';
  let allowTierCUploads = false;
  try {
    const [rawMin, rawAllowC] = await Promise.all([
      store.getSetting(GOOGLE_ADS_UPLOAD_CONFIDENCE_MIN_KEY),
      store.getSetting(GOOGLE_ADS_ALLOW_TIER_C_UPLOADS_KEY),
    ]);
    uploadMinTier = normalizeTier(rawMin, 'B');
    allowTierCUploads = normalizeBool(rawAllowC, false);
  } catch (_) {}

  const goals = await getConversionGoals(shop);
  const revenueGoal = (goals || []).find((g) => g.goal_type === 'revenue' && (g.custom_goal_resource_name || g.conversion_action_resource_name));
  const profitGoal = (goals || []).find((g) => g.goal_type === 'profit' && (g.custom_goal_resource_name || g.conversion_action_resource_name));
  if (!revenueGoal && !profitGoal) {
    try {
      const normShop = String(shop || '').trim().toLowerCase();
      if (normShop) {
        await recordIssue(adsDb, normShop, {
          source: 'postback',
          severity: 'warning',
          affected_goal: null,
          error_code: 'MISSING_CONVERSION_ACTION',
          error_message: 'No conversion actions are provisioned for Revenue, Profit, Add to Cart, or Begin Checkout uploads.',
          suggested_fix: 'Go to Settings → Admin → Google Ads, open Conversion actions, and click “Provision Kexo actions”.',
          first_seen_at: Date.now(),
          last_seen_at: Date.now(),
        });
      }
    } catch (_) {}
    return { ok: true, enqueued: 0, issues: 0, message: 'No conversion goals provisioned' };
  }

  const limit = Math.min(Number(options.limit) || 500, 2000);
  const rows = await adsDb.all(
    `SELECT shop, order_id, created_at_ms, currency, revenue_gbp, profit_gbp, profit_version, click_id_type, click_id_value, gclid, gbraid, wbraid, attribution_confidence, attribution_source
     FROM ads_orders_attributed
     WHERE shop = ?
     ORDER BY created_at_ms DESC
     LIMIT ?`,
    [String(shop).trim().toLowerCase(), limit]
  );

  let enqueued = 0;
  let issuesCreated = 0;
  const now = Date.now();

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

    const tier = normalizeTier(row && row.attribution_confidence != null ? row.attribution_confidence : null, 'B');
    const tierSource = row && row.attribution_source != null ? String(row.attribution_source).trim() : '';
    if (!isTierAllowed(tier, uploadMinTier, allowTierCUploads)) {
      await recordIssue(adsDb, shopNorm, {
        source: 'postback',
        severity: 'warning',
        affected_goal: 'revenue',
        error_code: 'LOW_CONFIDENCE_ATTRIBUTION_SKIPPED',
        error_message: `Order ${orderId} skipped (tier ${tier}${tierSource ? `, source ${tierSource}` : ''}, click ${click.type})`,
        suggested_fix: 'If this is intentional, lower the attribution confidence threshold (Tier C is off by default).',
        first_seen_at: now,
        last_seen_at: now,
      });
      issuesCreated++;
      continue;
    }

    const tz = options && options.customerTimeZone ? String(options.customerTimeZone) : 'UTC';
    const conversionDateTime = formatConversionDateTime(createdAtMs, tz) || `${new Date(createdAtMs).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;

    const revenueResource = (revenueGoal && (revenueGoal.custom_goal_resource_name || revenueGoal.conversion_action_resource_name) || '').trim();
    if (postbackGoals.uploadRevenue && revenueResource) {
      const inserted = await insertJobIfNotExists(adsDb, {
        shop: shopNorm,
        order_id: orderId,
        goal_type: 'revenue',
        conversion_action_resource_name: revenueResource,
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

    const profitResource = (profitGoal && (profitGoal.custom_goal_resource_name || profitGoal.conversion_action_resource_name) || '').trim();
    if (postbackGoals.uploadProfit && profitResource) {
      const profitValue = row && row.profit_gbp != null ? Number(row.profit_gbp) : null;
      if (!Number.isFinite(profitValue)) {
        await recordIssue(adsDb, shopNorm, {
          source: 'postback',
          severity: 'warning',
          affected_goal: 'profit',
          error_code: 'PROFIT_NOT_COMPUTABLE',
          error_message: `Order ${orderId} has no frozen profit_gbp (profit_version=${row && row.profit_version ? String(row.profit_version) : 'null'})`,
          suggested_fix: 'Check profit deductions config and ensure cost sources are available; profit uploads will resume once profit_gbp is computed.',
          first_seen_at: now,
          last_seen_at: now,
        });
        issuesCreated++;
        continue;
      }
      const inserted = await insertJobIfNotExists(adsDb, {
        shop: shopNorm,
        order_id: orderId,
        goal_type: 'profit',
        conversion_action_resource_name: profitResource,
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
    uploadBeginCheckout: parsed && parsed.uploadBeginCheckout === true,
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
  const addToCartGoal = (goals || []).find((g) => g.goal_type === 'add_to_cart' && (g.custom_goal_resource_name || g.conversion_action_resource_name));
  if (!addToCartGoal) return { ok: true, enqueued: 0, message: 'No add_to_cart goal provisioned' };

  let eventMinTier = 'B';
  try {
    const raw = await store.getSetting(GOOGLE_ADS_EVENT_UPLOAD_CONFIDENCE_MIN_KEY);
    eventMinTier = normalizeTier(raw, 'B');
  } catch (_) {}

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
    `SELECT e.id AS event_id, e.ts, s.gclid, s.gbraid, s.wbraid, s.entry_url
     FROM events e
     INNER JOIN sessions s ON s.session_id = e.session_id
     WHERE e.type = 'product_added_to_cart'
       AND ((s.gclid IS NOT NULL AND s.gclid != '')
         OR (s.gbraid IS NOT NULL AND s.gbraid != '')
         OR (s.wbraid IS NOT NULL AND s.wbraid != '')
         OR (s.entry_url IS NOT NULL AND s.entry_url != ''))
     ORDER BY e.ts DESC
     LIMIT ?`,
    [limit]
  );

  const addToCartResource = (addToCartGoal.custom_goal_resource_name || addToCartGoal.conversion_action_resource_name || '').trim();
  if (!addToCartResource) return { ok: true, enqueued: 0, message: 'No conversion action for add_to_cart' };

  const now = Date.now();
  let enqueued = 0;
  for (const row of rows || []) {
    const eventId = row && row.event_id != null ? row.event_id : null;
    const ts = row && row.ts != null ? Number(row.ts) : null;
    if (eventId == null || !ts) continue;
    const click = resolveClickId(row);
    if (!click.value) continue;
    const eventTier = 'B';
    if (!isTierAllowed(eventTier, eventMinTier, false)) continue;
    const tz = options && options.customerTimeZone ? String(options.customerTimeZone) : 'UTC';
    const conversionDateTime = formatConversionDateTime(ts, tz) || `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
    const orderId = `atc:${eventId}`;
    const inserted = await insertJobIfNotExists(adsDb, {
      shop: shopNorm,
      order_id: orderId,
      goal_type: 'add_to_cart',
      conversion_action_resource_name: addToCartResource,
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

/**
 * Enqueue begin_checkout jobs from main DB events (checkout_started) joined to sessions for click ID.
 * Synthetic order_id = bco:${event_id}. Value from google_ads_begin_checkout_value (default 1).
 */
async function enqueueBeginCheckoutEvents(shop, options = {}) {
  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set', enqueued: 0 };
  const goals = await getConversionGoals(shop);
  const beginCheckoutGoal = (goals || []).find((g) => g.goal_type === 'begin_checkout' && (g.custom_goal_resource_name || g.conversion_action_resource_name));
  if (!beginCheckoutGoal) return { ok: true, enqueued: 0, message: 'No begin_checkout goal provisioned' };

  let eventMinTier = 'B';
  try {
    const raw = await store.getSetting(GOOGLE_ADS_EVENT_UPLOAD_CONFIDENCE_MIN_KEY);
    eventMinTier = normalizeTier(raw, 'B');
  } catch (_) {}

  let rawGoals = null;
  try {
    rawGoals = await store.getSetting(GOOGLE_ADS_POSTBACK_GOALS_KEY);
  } catch (_) {}
  const postbackGoals = normalizePostbackGoals(rawGoals);
  if (!postbackGoals.uploadBeginCheckout) return { ok: true, enqueued: 0, message: 'Begin Checkout upload disabled' };

  let beginCheckoutValue = 1;
  try {
    const v = await store.getSetting(GOOGLE_ADS_BEGIN_CHECKOUT_VALUE_KEY);
    if (v != null && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) beginCheckoutValue = n;
    }
  } catch (_) {}

  const db = getDb();
  if (!db) return { ok: false, error: 'Main DB not available', enqueued: 0 };
  const limit = Math.min(Number(options.limit) || 500, 2000);
  const shopNorm = String(shop || '').trim().toLowerCase();
  if (!shopNorm) return { ok: true, enqueued: 0 };

  const rows = await db.all(
    `SELECT e.id AS event_id, e.ts, s.gclid, s.gbraid, s.wbraid, s.entry_url
     FROM events e
     INNER JOIN sessions s ON s.session_id = e.session_id
     WHERE e.type = 'checkout_started'
       AND ((s.gclid IS NOT NULL AND s.gclid != '')
         OR (s.gbraid IS NOT NULL AND s.gbraid != '')
         OR (s.wbraid IS NOT NULL AND s.wbraid != '')
         OR (s.entry_url IS NOT NULL AND s.entry_url != ''))
     ORDER BY e.ts DESC
     LIMIT ?`,
    [limit]
  );

  const resourceName = (beginCheckoutGoal.custom_goal_resource_name || beginCheckoutGoal.conversion_action_resource_name || '').trim();
  if (!resourceName) return { ok: true, enqueued: 0, message: 'No conversion action for begin_checkout' };

  const now = Date.now();
  let enqueued = 0;
  for (const row of rows || []) {
    const eventId = row && row.event_id != null ? row.event_id : null;
    const ts = row && row.ts != null ? Number(row.ts) : null;
    if (eventId == null || !ts) continue;
    const click = resolveClickId(row);
    if (!click.value) continue;
    const eventTier = 'B';
    if (!isTierAllowed(eventTier, eventMinTier, false)) continue;
    const tz = options && options.customerTimeZone ? String(options.customerTimeZone) : 'UTC';
    const conversionDateTime = formatConversionDateTime(ts, tz) || `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
    const orderId = `bco:${eventId}`;
    const inserted = await insertJobIfNotExists(adsDb, {
      shop: shopNorm,
      order_id: orderId,
      goal_type: 'begin_checkout',
      conversion_action_resource_name: resourceName,
      conversion_date_time: conversionDateTime,
      conversion_value: beginCheckoutValue,
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
    const source = payload.source || 'postback';
    const severity = payload.severity || 'error';
    const affectedGoal = payload.affected_goal || null;
    const errorCode = payload.error_code || null;
    const errorMessage = payload.error_message || null;
    const suggestedFix = payload.suggested_fix || null;
    const firstSeenAt = payload.first_seen_at || now;
    const lastSeenAt = payload.last_seen_at || now;

    // Reduce spam: if an identical open issue already exists, bump last_seen_at/updated_at instead of inserting.
    const existing = await adsDb.get(
      `SELECT id, first_seen_at
       FROM google_ads_issues
       WHERE shop = ?
         AND status = 'open'
         AND COALESCE(error_code, '') = COALESCE(?, '')
         AND COALESCE(affected_goal, '') = COALESCE(?, '')
         AND COALESCE(error_message, '') = COALESCE(?, '')
       LIMIT 1`,
      [shop, errorCode, affectedGoal, errorMessage]
    );
    if (existing && existing.id != null) {
      const persistedFirst = existing.first_seen_at != null ? Number(existing.first_seen_at) : null;
      const nextFirst = Number.isFinite(persistedFirst) ? Math.min(persistedFirst, firstSeenAt) : firstSeenAt;
      await adsDb.run(
        `UPDATE google_ads_issues
         SET source = ?,
             severity = ?,
             suggested_fix = COALESCE(?, suggested_fix),
             first_seen_at = ?,
             last_seen_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [source, severity, suggestedFix, nextFirst, lastSeenAt, now, existing.id]
      );
      return;
    }

    await adsDb.run(
      `INSERT INTO google_ads_issues (shop, source, severity, status, affected_goal, error_code, error_message, suggested_fix, first_seen_at, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop, source, severity, affectedGoal, errorCode, errorMessage, suggestedFix, firstSeenAt, lastSeenAt, now, now]
    );
  } catch (_) {}
}

async function upsertAdjustmentJob(adsDb, job) {
  const now = Date.now();
  try {
    await adsDb.run(
      `INSERT INTO google_ads_conversion_adjustment_jobs
         (shop, original_order_id, goal_type, conversion_action_resource_name, adjustment_type, adjustment_time_ms, new_value, currency_code, status, retry_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
       ON CONFLICT (shop, original_order_id, goal_type) DO UPDATE SET
         conversion_action_resource_name = EXCLUDED.conversion_action_resource_name,
         adjustment_type = EXCLUDED.adjustment_type,
         adjustment_time_ms = EXCLUDED.adjustment_time_ms,
         new_value = EXCLUDED.new_value,
         currency_code = EXCLUDED.currency_code,
         status = CASE
           WHEN google_ads_conversion_adjustment_jobs.status = 'success'
             AND google_ads_conversion_adjustment_jobs.adjustment_type = EXCLUDED.adjustment_type
             AND COALESCE(google_ads_conversion_adjustment_jobs.new_value, -1) = COALESCE(EXCLUDED.new_value, -1)
           THEN 'success'
           ELSE 'pending'
         END,
         retry_count = CASE
           WHEN google_ads_conversion_adjustment_jobs.status = 'success'
             AND google_ads_conversion_adjustment_jobs.adjustment_type = EXCLUDED.adjustment_type
             AND COALESCE(google_ads_conversion_adjustment_jobs.new_value, -1) = COALESCE(EXCLUDED.new_value, -1)
           THEN google_ads_conversion_adjustment_jobs.retry_count
           ELSE 0
         END,
         last_error = CASE
           WHEN google_ads_conversion_adjustment_jobs.status = 'success'
             AND google_ads_conversion_adjustment_jobs.adjustment_type = EXCLUDED.adjustment_type
             AND COALESCE(google_ads_conversion_adjustment_jobs.new_value, -1) = COALESCE(EXCLUDED.new_value, -1)
           THEN google_ads_conversion_adjustment_jobs.last_error
           ELSE NULL
         END,
         next_retry_at = CASE
           WHEN google_ads_conversion_adjustment_jobs.status = 'success'
             AND google_ads_conversion_adjustment_jobs.adjustment_type = EXCLUDED.adjustment_type
             AND COALESCE(google_ads_conversion_adjustment_jobs.new_value, -1) = COALESCE(EXCLUDED.new_value, -1)
           THEN google_ads_conversion_adjustment_jobs.next_retry_at
           ELSE NULL
         END,
         updated_at = EXCLUDED.updated_at`,
      [
        job.shop,
        job.original_order_id,
        job.goal_type,
        job.conversion_action_resource_name,
        job.adjustment_type,
        job.adjustment_time_ms,
        job.new_value,
        job.currency_code,
        now,
        now,
      ]
    );
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Enqueue conversion adjustment jobs for refunds/cancels (revenue + profit).
 * Idempotency: (shop, original_order_id, goal_type).
 */
async function enqueueConversionAdjustments(shop, options = {}) {
  const adsDb = getAdsDb();
  const db = getDb();
  const normShop = String(shop || '').trim().toLowerCase();
  if (!adsDb || !db || !normShop) return { ok: true, enqueued: 0, skipped: true };

  const limit = Math.min(Number(options.limit) || 1000, 5000);
  const lookbackDays = Math.min(Math.max(Number(options.lookbackDays) || 90, 7), 365);
  const now = Date.now();
  const cutoff = now - lookbackDays * 24 * 60 * 60 * 1000;

  let refundRows = [];
  try {
    refundRows = await db.all(
      `SELECT order_id, SUM(amount) AS refunded_amount, MAX(refund_created_at) AS last_refund_at, MAX(currency) AS currency
       FROM orders_shopify_refunds
       WHERE shop = ? AND refund_created_at >= ?
       GROUP BY order_id
       ORDER BY last_refund_at DESC
       LIMIT ?`,
      [normShop, cutoff, limit]
    );
  } catch (_) {
    refundRows = [];
  }

  let cancelRows = [];
  try {
    cancelRows = await db.all(
      `SELECT order_id, cancelled_at
       FROM orders_shopify
       WHERE shop = ? AND cancelled_at IS NOT NULL AND cancelled_at >= ?
       ORDER BY cancelled_at DESC
       LIMIT ?`,
      [normShop, cutoff, limit]
    );
  } catch (_) {
    cancelRows = [];
  }

  if ((!refundRows || !refundRows.length) && (!cancelRows || !cancelRows.length)) {
    return { ok: true, enqueued: 0 };
  }

  const orderMeta = new Map();
  for (const r of refundRows || []) {
    const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
    if (!oid) continue;
    orderMeta.set(oid, {
      refunded_amount: r && r.refunded_amount != null ? Number(r.refunded_amount) : 0,
      last_refund_at: r && r.last_refund_at != null ? Number(r.last_refund_at) : null,
      currency: r && r.currency != null ? String(r.currency).trim().toUpperCase() : '',
      cancelled_at: null,
    });
  }
  for (const r of cancelRows || []) {
    const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
    if (!oid) continue;
    const existing = orderMeta.get(oid) || { refunded_amount: 0, last_refund_at: null, currency: '', cancelled_at: null };
    existing.cancelled_at = r && r.cancelled_at != null ? Number(r.cancelled_at) : existing.cancelled_at;
    orderMeta.set(oid, existing);
  }

  const orderIds = Array.from(orderMeta.keys());
  const latestJobs = new Map();
  for (let i = 0; i < orderIds.length; i += 500) {
    const chunk = orderIds.slice(i, i + 500);
    const placeholders = chunk.map(() => '?').join(', ');
    let rows = [];
    try {
      rows = await adsDb.all(
        `SELECT order_id, goal_type, conversion_action_resource_name, conversion_value, currency_code, created_at
         FROM google_ads_postback_jobs
         WHERE shop = ? AND status = 'success'
           AND goal_type IN ('revenue', 'profit')
           AND order_id IN (${placeholders})`,
        [normShop, ...chunk]
      );
    } catch (_) {
      rows = [];
    }
    for (const r of rows || []) {
      const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
      const goal = r && r.goal_type != null ? String(r.goal_type).trim().toLowerCase() : '';
      if (!oid || (goal !== 'revenue' && goal !== 'profit')) continue;
      const key = `${oid}:${goal}`;
      const ts = r && r.created_at != null ? Number(r.created_at) : 0;
      const prev = latestJobs.get(key);
      const prevTs = prev && prev.created_at != null ? Number(prev.created_at) : -1;
      if (!prev || ts > prevTs) latestJobs.set(key, r);
    }
  }

  const ratesToGbp = await fx.getRatesToGbp().catch(() => ({}));
  let enqueued = 0;
  for (const [orderId, meta] of orderMeta.entries()) {
    const revenueJob = latestJobs.get(`${orderId}:revenue`);
    if (!revenueJob) continue;
    const origRevenue = revenueJob && revenueJob.conversion_value != null ? Number(revenueJob.conversion_value) : null;
    if (!Number.isFinite(origRevenue) || origRevenue <= 0) continue;

    const refundAmt = meta && meta.refunded_amount != null ? Number(meta.refunded_amount) : 0;
    const refundCurrency = (meta && meta.currency) ? String(meta.currency) : (revenueJob && revenueJob.currency_code ? String(revenueJob.currency_code).trim().toUpperCase() : 'GBP');
    const refundedGbpRaw = fx.convertToGbp((Number.isFinite(refundAmt) && refundAmt > 0) ? refundAmt : 0, refundCurrency, ratesToGbp);
    const refundedGbp = (typeof refundedGbpRaw === 'number' && Number.isFinite(refundedGbpRaw)) ? refundedGbpRaw : 0;
    const newRevenue = Math.max(0, Math.round((origRevenue - refundedGbp) * 100) / 100);

    const cancelledAt = meta && meta.cancelled_at != null && Number.isFinite(Number(meta.cancelled_at)) ? Number(meta.cancelled_at) : null;
    const lastRefundAt = meta && meta.last_refund_at != null && Number.isFinite(Number(meta.last_refund_at)) ? Number(meta.last_refund_at) : null;
    const adjustmentTimeMs = lastRefundAt || cancelledAt || now;
    const adjType = (cancelledAt || newRevenue <= 0) ? 'RETRACT' : 'RESTATEMENT';
    if (!cancelledAt && refundedGbp <= 0) continue;

    const revenueJobAction = revenueJob && revenueJob.conversion_action_resource_name ? String(revenueJob.conversion_action_resource_name).trim() : '';
    if (revenueJobAction) {
      const ok = await upsertAdjustmentJob(adsDb, {
        shop: normShop,
        original_order_id: orderId,
        goal_type: 'revenue',
        conversion_action_resource_name: revenueJobAction,
        adjustment_type: adjType,
        adjustment_time_ms: adjustmentTimeMs,
        new_value: adjType === 'RESTATEMENT' ? newRevenue : null,
        currency_code: revenueJob && revenueJob.currency_code ? String(revenueJob.currency_code).trim().toUpperCase() : 'GBP',
      });
      if (ok) enqueued++;
    }

    const profitJob = latestJobs.get(`${orderId}:profit`);
    const profitJobAction = profitJob && profitJob.conversion_action_resource_name ? String(profitJob.conversion_action_resource_name).trim() : '';
    if (profitJob && profitJobAction) {
      const origProfit = profitJob && profitJob.conversion_value != null ? Number(profitJob.conversion_value) : null;
      const newProfit = (Number.isFinite(origProfit) && origRevenue > 0) ? Math.max(0, Math.round((origProfit * (newRevenue / origRevenue)) * 100) / 100) : 0;
      const ok = await upsertAdjustmentJob(adsDb, {
        shop: normShop,
        original_order_id: orderId,
        goal_type: 'profit',
        conversion_action_resource_name: profitJobAction,
        adjustment_type: adjType,
        adjustment_time_ms: adjustmentTimeMs,
        new_value: adjType === 'RESTATEMENT' ? newProfit : null,
        currency_code: profitJob && profitJob.currency_code ? String(profitJob.currency_code).trim().toUpperCase() : 'GBP',
      });
      if (ok) enqueued++;
    }
  }

  return { ok: true, enqueued };
}

/**
 * Process conversion adjustment jobs (refund/cancel restatements/retractions).
 */
async function processAdjustmentBatch(shop, options = {}) {
  const adsDb = getAdsDb();
  if (!adsDb) return { ok: false, error: 'ADS_DB_URL not set', processed: 0 };
  const batchSize = Math.min(Number(options.batchSize) || 200, 2000);
  const cfg = await getGoogleAdsConfig(shop);
  const refreshToken = cfg && cfg.refresh_token ? String(cfg.refresh_token) : '';
  if (!refreshToken) return { ok: false, error: 'Not connected', processed: 0 };
  const { customerId, loginCustomerId, conversionCustomerId } = getResolvedCustomerIds(cfg);
  if (!customerId) return { ok: false, error: 'Missing customer_id', processed: 0 };
  const targetCustomerId = conversionCustomerId || customerId;

  const jobs = await adsDb.all(
    `SELECT id, shop, original_order_id, goal_type, conversion_action_resource_name, adjustment_type, adjustment_time_ms, new_value, currency_code, retry_count
     FROM google_ads_conversion_adjustment_jobs
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
  const tz = options && options.customerTimeZone ? String(options.customerTimeZone) : 'UTC';

  const adjustments = [];
  for (const j of jobs) {
    const adjType = j && j.adjustment_type ? String(j.adjustment_type).trim().toUpperCase() : '';
    const apiType = adjType === 'RETRACT' ? 'RETRACTION' : adjType === 'RESTATEMENT' ? 'RESTATEMENT' : 'RESTATEMENT';
    const whenMs = j && j.adjustment_time_ms != null ? Number(j.adjustment_time_ms) : Date.now();
    const adjustmentDateTime = formatConversionDateTime(whenMs, tz) || `${new Date(whenMs).toISOString().slice(0, 19).replace('T', ' ')}+00:00`;
    const payload = {
      conversion_action: j.conversion_action_resource_name,
      adjustment_type: apiType,
      adjustment_date_time: adjustmentDateTime,
      order_id: j.original_order_id,
    };
    if (apiType === 'RESTATEMENT') {
      const v = j && j.new_value != null ? Number(j.new_value) : null;
      if (Number.isFinite(v)) {
        payload.restatement_value = {
          adjusted_value: v,
          currency_code: j.currency_code,
        };
      }
    }
    adjustments.push(payload);
  }

  let lastErr = null;
  for (const ver of versions) {
    const url = `https://googleads.googleapis.com/${ver}/customers/${encodeURIComponent(targetCustomerId)}:uploadConversionAdjustments`;
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
          conversion_adjustments: adjustments,
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
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        const result = results[i] || null;
        const errDetail = partialFailures.find((d) => d && d.field_path_elements && d.field_path_elements.some((e) => e.index && Number(e.index) === i));
        const errMsg = (errDetail && errDetail.message) || (result && result.error && result.error.message) || null;
        const ignorable = errMsg && /already retracted|already restated|DUPLICATE|already uploaded/i.test(errMsg);

        await adsDb.run(
          `INSERT INTO google_ads_conversion_adjustment_attempts (job_id, attempt_number, http_status, response_body, error_message, attempted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [job.id, (job.retry_count || 0) + 1, res.status, text.slice(0, 2000), errMsg ? errMsg.slice(0, 500) : null, now]
        );

        if (errMsg && !ignorable) {
          const nextRetry = (job.retry_count || 0) + 1 >= MAX_RETRIES ? null : now + INITIAL_BACKOFF_MS * Math.pow(2, job.retry_count || 0);
          await adsDb.run(
            `UPDATE google_ads_conversion_adjustment_jobs SET status = ?, retry_count = retry_count + 1, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
            [nextRetry ? 'retry' : 'failed', errMsg.slice(0, 500), nextRetry, now, job.id]
          );
          await recordIssue(adsDb, job.shop, {
            source: 'postback',
            severity: 'error',
            affected_goal: job.goal_type,
            error_code: 'ADJUSTMENT_UPLOAD_FAILED',
            error_message: errMsg.slice(0, 300),
            suggested_fix: 'Check original order_id + conversion action; retry later.',
            first_seen_at: now,
            last_seen_at: now,
          });
        } else {
          await adsDb.run(
            `UPDATE google_ads_conversion_adjustment_jobs SET status = 'success', last_error = NULL, next_retry_at = NULL, updated_at = ? WHERE id = ?`,
            [now, job.id]
          );
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
      `INSERT INTO google_ads_conversion_adjustment_attempts (job_id, attempt_number, http_status, error_message, attempted_at) VALUES (?, ?, ?, ?, ?)`,
      [job.id, (job.retry_count || 0) + 1, null, lastErr ? lastErr.slice(0, 500) : null, now]
    );
    const nextRetry = (job.retry_count || 0) + 1 >= MAX_RETRIES ? null : now + INITIAL_BACKOFF_MS * Math.pow(2, job.retry_count || 0);
    await adsDb.run(
      `UPDATE google_ads_conversion_adjustment_jobs SET status = ?, retry_count = retry_count + 1, last_error = ?, next_retry_at = ?, updated_at = ? WHERE id = ?`,
      [nextRetry ? 'retry' : 'failed', lastErr ? lastErr.slice(0, 500) : null, nextRetry, now, job.id]
    );
  }
  return { ok: false, error: lastErr || 'upload failed', processed: jobs.length };
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

  let cartDataMerchantId = '';
  let cartDataFeedCountry = 'GB';
  let cartDataFeedLanguage = 'EN';
  const cartDataGoals = { revenue: false, profit: false, add_to_cart: false, begin_checkout: false };
  try {
    const [rawMerchant, rawCountry, rawLang, rawGoals] = await Promise.all([
      store.getSetting(GOOGLE_ADS_CART_DATA_MERCHANT_ID_KEY),
      store.getSetting(GOOGLE_ADS_CART_DATA_FEED_COUNTRY_KEY),
      store.getSetting(GOOGLE_ADS_CART_DATA_FEED_LANGUAGE_KEY),
      store.getSetting(GOOGLE_ADS_CART_DATA_GOALS_KEY),
    ]);
    if (rawMerchant != null && String(rawMerchant).trim() !== '') cartDataMerchantId = String(rawMerchant).trim().slice(0, 64);
    if (rawCountry != null && String(rawCountry).trim() !== '') cartDataFeedCountry = String(rawCountry).trim().toUpperCase().slice(0, 2) || 'GB';
    if (rawLang != null && String(rawLang).trim() !== '') cartDataFeedLanguage = String(rawLang).trim().toUpperCase().slice(0, 2) || 'EN';
    if (rawGoals != null && String(rawGoals).trim() !== '') {
      try {
        const parsed = JSON.parse(String(rawGoals));
        if (parsed && typeof parsed === 'object') {
          if (parsed.revenue === true) cartDataGoals.revenue = true;
          if (parsed.profit === true) cartDataGoals.profit = true;
          if (parsed.add_to_cart === true) cartDataGoals.add_to_cart = true;
          if (parsed.begin_checkout === true) cartDataGoals.begin_checkout = true;
        }
      } catch (_) {}
    }
  } catch (_) {}

  const conversions = [];
  const cartDataOpts = { feedCountry: cartDataFeedCountry, feedLanguage: cartDataFeedLanguage, merchantId: cartDataMerchantId };
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
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

    const isPurchaseGoal = j.goal_type === 'revenue' || j.goal_type === 'profit';
    const includeCartData = isPurchaseGoal && cartDataGoals[j.goal_type] === true && !String(j.order_id || '').startsWith('bco:');
    if (includeCartData) {
      const built = await buildCartDataForOrder(shop, j.order_id, cartDataOpts);
      if (built.cartData) {
        c.cart_data = built.cartData;
      } else if (built.error) {
        await recordIssue(adsDb, j.shop, {
          source: 'postback',
          severity: 'warning',
          affected_goal: j.goal_type,
          error_code: 'CART_DATA_SKIPPED',
          error_message: built.reason || built.error || 'Cart data not attached',
          suggested_fix: 'Check order and line items; cart data is optional.',
          first_seen_at: Date.now(),
          last_seen_at: Date.now(),
        });
      }
    }
    conversions.push(c);
  }

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
 * Run postback processor once for a shop (enqueue orders + add-to-cart + begin-checkout + process batch). Call from scheduler.
 */
async function runPostbackCycle(shop, options = {}) {
  if (!shop || typeof shop !== 'string' || !shop.trim()) return { ok: false, error: 'shop required' };
  const enabled = options.postbackEnabled !== false;
  if (!enabled) return { ok: true, skipped: true, reason: 'postback disabled' };
  const tzOut = await resolveCustomerTimeZone(shop);
  const customerTimeZone = tzOut && tzOut.timeZone ? tzOut.timeZone : 'UTC';
  const enqueueOut = await enqueueEligibleOrders(shop, { limit: options.enqueueLimit || 500, customerTimeZone });
  if (!enqueueOut.ok) return enqueueOut;
  const atcOut = await enqueueAddToCartEvents(shop, { limit: options.enqueueLimit || 500, customerTimeZone });
  const bcoOut = await enqueueBeginCheckoutEvents(shop, { limit: options.enqueueLimit || 500, customerTimeZone });
  const totalEnqueued = (enqueueOut.enqueued || 0) + (atcOut.enqueued || 0) + (bcoOut.enqueued || 0);
  const processOut = await processPostbackBatch(shop, { batchSize: options.batchSize || BATCH_SIZE, validateOnly: options.validateOnly });
  let adjustmentsEnqueued = 0;
  let adjustmentsProcessed = 0;
  let adjustmentsOk = true;
  try {
    const rawEnabled = await store.getSetting(GOOGLE_ADS_ADJUSTMENTS_ENABLED_KEY);
    const enabled = normalizeBool(rawEnabled, true);
    if (enabled) {
      const enq = await enqueueConversionAdjustments(shop, { limit: options.adjustmentsEnqueueLimit || 1000, lookbackDays: options.adjustmentsLookbackDays || 90 });
      if (enq && enq.enqueued) adjustmentsEnqueued = Number(enq.enqueued) || 0;
      const proc = await processAdjustmentBatch(shop, { batchSize: options.adjustmentsBatchSize || 200, customerTimeZone, validateOnly: options.validateOnly });
      adjustmentsOk = !!(proc && proc.ok);
      adjustmentsProcessed = proc && proc.processed != null ? Number(proc.processed) : 0;
    }
  } catch (_) {
    adjustmentsOk = false;
  }
  return {
    ok: processOut.ok,
    enqueued: totalEnqueued,
    processed: processOut.processed || 0,
    error: processOut.error,
    issues: enqueueOut.issues || 0,
    adjustments_enqueued: adjustmentsEnqueued,
    adjustments_processed: adjustmentsProcessed,
    adjustments_ok: adjustmentsOk,
  };
}

module.exports = {
  enqueueEligibleOrders,
  enqueueAddToCartEvents,
  enqueueBeginCheckoutEvents,
  processPostbackBatch,
  runPostbackCycle,
  pickClickIdFromAttribution,
  parseClickIdsFromEntryUrl,
  resolveClickId,
  normalizeTier,
  isTierAllowed,
  formatConversionDateTime,
  computeProfitForOrder,
  computeProfitForOrderAllocation,
  buildMerchantCenterProductId,
  buildCartDataForOrder,
};
