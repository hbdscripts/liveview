const fx = require('../fx');
const crypto = require('crypto');
const store = require('../store');
const salesTruth = require('../salesTruth');
const { getDb } = require('../db');
const { getAdsDb } = require('./adsDb');
const googleAdsClient = require('./googleAdsClient');
const businessSnapshotService = require('../businessSnapshotService');
const { normalizeProfitRulesConfigV1 } = require('../profitRulesConfig');

const GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY = 'google_ads_profit_deductions_v1';
const GOOGLE_ADS_IDENTITY_ENRICHMENT_ENABLED_KEY = 'google_ads_identity_enrichment_enabled';

function normalizeBool(raw, fallback) {
  if (raw == null) return !!fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return !!fallback;
}

function sha256Hex(value) {
  if (!value) return null;
  try {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
  } catch (_) {
    return null;
  }
}

function normalizeEmailForHash(raw) {
  const v = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!v || v.indexOf('@') < 1) return null;
  return v;
}

function normalizePhoneForHash(raw) {
  const v = raw != null ? String(raw).trim() : '';
  if (!v) return null;
  const digits = v.replace(/[^\d]/g, '');
  if (digits.length < 7) return null;
  return digits;
}

function hasOrderMarketingConsent(orderJson) {
  try {
    const buyer = orderJson && Object.prototype.hasOwnProperty.call(orderJson, 'buyer_accepts_marketing') ? orderJson.buyer_accepts_marketing : null;
    if (buyer === true) return true;
    const emailState = orderJson && orderJson.email_marketing_consent && orderJson.email_marketing_consent.state ? String(orderJson.email_marketing_consent.state).trim().toLowerCase() : '';
    if (emailState === 'subscribed') return true;
    const smsState = orderJson && orderJson.sms_marketing_consent && orderJson.sms_marketing_consent.state ? String(orderJson.sms_marketing_consent.state).trim().toLowerCase() : '';
    if (smsState === 'subscribed') return true;
    const cust = orderJson && orderJson.customer ? orderJson.customer : null;
    const custAccepts = cust && Object.prototype.hasOwnProperty.call(cust, 'accepts_marketing') ? cust.accepts_marketing : null;
    if (custAccepts === true) return true;
  } catch (_) {}
  return false;
}

async function recordAdsIssue(adsDb, shop, payload) {
  const now = Date.now();
  try {
    const source = payload.source || 'attribution_sync';
    const severity = payload.severity || 'warning';
    const affectedGoal = payload.affected_goal || null;
    const errorCode = payload.error_code || null;
    const errorMessage = payload.error_message || null;
    const suggestedFix = payload.suggested_fix || null;
    const firstSeenAt = payload.first_seen_at || now;
    const lastSeenAt = payload.last_seen_at || now;

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

/**
 * Only treat as Google Ads when a click-id exists (gclid/gbraid/wbraid).
 * Prevents tinkered URLs (utm_source=google, bs_campaign_id, etc.) from creating fake Google Ads attribution.
 */
function looksLikeGoogleAds({ gclidLike } = {}) {
  return !!(gclidLike && (gclidLike.gclid || gclidLike.gbraid || gclidLike.wbraid));
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function ymdInTimeZone(ts, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const ymd = fmt.format(new Date(Number(ts) || Date.now()));
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  } catch (_) {}
  try {
    return new Date(Number(ts) || Date.now()).toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

function computeProfitForOrderAllocation(orderRevenueGbp, windowRevenueGbp, windowCostGbp) {
  const rev = Number(orderRevenueGbp) || 0;
  const wRev = Number(windowRevenueGbp) || 0;
  const wCost = Number(windowCostGbp) || 0;
  if (!Number.isFinite(rev) || rev <= 0) return 0;
  if (!Number.isFinite(wRev) || wRev <= 0) return Math.max(0, round2(rev));
  const allocatedCost = (rev / wRev) * wCost;
  const profit = rev - (Number.isFinite(allocatedCost) ? allocatedCost : 0);
  return Math.max(0, round2(Number.isFinite(profit) ? profit : rev));
}

function computeShippingCostForOrder(countryCode, shippingConfig) {
  const cfg = shippingConfig && typeof shippingConfig === 'object' ? shippingConfig : {};
  const overrides = Array.isArray(cfg.overrides) ? cfg.overrides : [];
  const code = countryCode != null ? String(countryCode).trim().toUpperCase().slice(0, 2) : '';
  for (const o of overrides) {
    if (!o || o.enabled === false) continue;
    const countries = Array.isArray(o.countries) ? o.countries : [];
    if (code && countries.includes(code)) {
      return Math.max(0, Number(o.priceGbp) || 0);
    }
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
    if (!Number.isFinite(amt) || amt === 0) {
      if (matchMode === 'first_match') continue;
      else continue;
    }
    const direction = rule.direction != null ? String(rule.direction).trim().toLowerCase() : 'add';
    if (direction === 'subtract') amt *= -1;
    const rounded = round2(amt) || 0;
    if (rounded === 0) {
      if (matchMode === 'first_match') continue;
      else continue;
    }
    total += rounded;
    if (matchMode === 'first_match') break;
  }
  return round2(total) || 0;
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
  const timeZone = store.resolveAdminTimeZone();
  let identityEnabled = false;
  let identityConsentMissing = false;
  try {
    const raw = await store.getSetting(GOOGLE_ADS_IDENTITY_ENRICHMENT_ENABLED_KEY);
    identityEnabled = normalizeBool(raw, false);
  } catch (_) {}

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
  const perOrderRules = Array.isArray(ce.per_order_rules) ? ce.per_order_rules.filter((r) => r && r.enabled === true) : [];
  const overheads = Array.isArray(ce.overheads) ? ce.overheads.filter((o) => o && o.enabled === true) : [];
  const fixedCosts = Array.isArray(ce.fixed_costs) ? ce.fixed_costs.filter((f) => f && f.enabled === true) : [];
  const fixedPerDay = fixedCosts.reduce((acc, f) => acc + (Number(f && f.amount_per_day) || 0), 0);

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
    const orderYmd = ymdInTimeZone(createdAtMs, timeZone) || new Date(createdAtMs).toISOString().slice(0, 10);
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
    const landingSite = (orderJson && (orderJson.landing_site || orderJson.landingSite)) ? String(orderJson.landing_site || orderJson.landingSite).trim() : '';
    const params = safeUrlParams(landingSite);

    const bsIds = store.extractBsAdsIdsFromEntryUrl(landingSite);
    const utmSource = trimParam(params, 'utm_source', 64);
    const gclidLike = extractGclidLike(params);
    const picked = pickClickId(gclidLike);
    const clickIdValue = picked && picked.id ? String(picked.id).trim() : null;
    const clickIdType = picked && picked.kind ? String(picked.kind).trim() : null;
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
    const gclid = gclidLike && gclidLike.gclid ? String(gclidLike.gclid).trim() : (urlAttrib && urlAttrib.gclid ? String(urlAttrib.gclid).trim() : null);
    const gbraid = gclidLike && gclidLike.gbraid ? String(gclidLike.gbraid).trim() : null;
    const wbraid = gclidLike && gclidLike.wbraid ? String(gclidLike.wbraid).trim() : null;
    let attributionMethod = urlAttrib && urlAttrib.attributionMethod ? String(urlAttrib.attributionMethod) : null;
    let isGoogleAds = looksLikeGoogleAds({ gclidLike });

    // When click-id exists, prefer gclid_campaign_cache over URL-provided campaign (guard against tampered bs_campaign_id/utm_id).
    if (gclid) {
      const mapping = await getGclidMappingCached(adsDb, gclidCache, gclid);
      if (mapping && mapping.campaignId) {
        campaignId = mapping.campaignId;
        adgroupId = mapping.adgroupId || adgroupId || '_all_';
        attributionMethod = 'landing_site.gclid_cache';
        isGoogleAds = true;
      } else {
        attributionMethod = attributionMethod || 'landing_site.gclid_unmapped';
      }
    }

    let identityHashesPresent = null;
    let identityQualityScore = null;
    let identityEmailSha256 = null;
    let identityPhoneSha256 = null;
    if (identityEnabled) {
      const hasConsent = hasOrderMarketingConsent(orderJson);
      if (!hasConsent) {
        identityConsentMissing = true;
        identityHashesPresent = 0;
        identityQualityScore = 0;
      } else {
        const emailRaw = (orderJson && orderJson.email) || (orderJson && orderJson.customer && orderJson.customer.email) || null;
        const phoneRaw = (orderJson && orderJson.phone) || (orderJson && orderJson.customer && orderJson.customer.phone) || null;
        const normEmail = normalizeEmailForHash(emailRaw);
        const normPhone = normalizePhoneForHash(phoneRaw);
        identityEmailSha256 = normEmail ? sha256Hex(normEmail) : null;
        identityPhoneSha256 = normPhone ? sha256Hex(normPhone) : null;
        const score = (identityEmailSha256 ? 1 : 0) + (identityPhoneSha256 ? 1 : 0);
        identityQualityScore = score;
        identityHashesPresent = score > 0 ? 1 : 0;
      }
    }

    const out = {
      shop,
      orderId,
      createdAtMs,
      currency,
      totalPrice: Math.round(totalNum * 100) / 100,
      revenueGbp,
      orderYmd,
      taxGbp,
      subtotalGbp,
      itemsCount,
      identityHashesPresent,
      identityQualityScore,
      identityEmailSha256,
      identityPhoneSha256,
      // Source is established from landing_site when possible, otherwise evidence may fill it in later.
      source: isGoogleAds ? source : null,
      campaignId: campaignId || null,
      adgroupId: adgroupId || (campaignId ? '_all_' : null),
      adId: adId || null,
      gclid: gclid || null,
      gbraid: gbraid || null,
      wbraid: wbraid || null,
      clickIdType: clickIdType || null,
      clickIdValue: clickIdValue || null,
      attributionConfidence: clickIdValue ? 'A' : null,
      attributionSource: clickIdValue ? 'order_landing_site' : null,
      attributionDebug: clickIdValue ? 'click-id from landing_site' : null,
      countryCode: cc,
      sessionId: null,
      visitorCountryCode: null,
      visitorDeviceType: null,
      visitorNetwork: null,
      attributionMethod: attributionMethod || (campaignId ? 'landing_site' : null),
      landingSite: landingSite || null,
      checkoutToken: row && row.checkout_token ? String(row.checkout_token).trim() : null,
      profitGbp: null,
      profitVersion: null,
      profitComponents: null,
      profitComputedAtMs: null,
    };

    parsed.push(out);
    // Evidence can link orders -> sessions for attribution + visitor-location geo.
    // Limit lookups to checkout orders (best-effort proxy for online orders that have pixel evidence).
    if (out.checkoutToken && (out.source === source || !out.campaignId || !out.source)) needEvidence.push(out);
  }

  if (identityEnabled && identityConsentMissing) {
    try {
      await recordAdsIssue(adsDb, String(shop || '').trim().toLowerCase(), {
        source: 'attribution_sync',
        severity: 'warning',
        affected_goal: null,
        error_code: 'IDENTITY_CONSENT_MISSING',
        error_message: 'Identity enrichment enabled but Shopify order consent is missing; identity hashes were not stored.',
        suggested_fix: 'Disable identity enrichment unless you have consent; otherwise ensure Shopify order marketing consent fields are present.',
        first_seen_at: Date.now(),
        last_seen_at: Date.now(),
      });
    } catch (_) {}
  }

  // Profit freeze: compute deterministic profit per order and store it on ads_orders_attributed.
  // This must be fail-open and fast: allocate day-level costs by revenue share, and clamp at 0.
  try {
    const PROFIT_VERSION = 'v1';
    const profitComputedAtMs = Date.now();
    const revenueByYmd = new Map();
    const dayKeys = new Set();
    for (const o of parsed) {
      if (!o || !o.orderYmd) continue;
      const ymd = String(o.orderYmd);
      dayKeys.add(ymd);
      revenueByYmd.set(ymd, (Number(revenueByYmd.get(ymd)) || 0) + (Number(o.revenueGbp) || 0));
    }

    async function readAdsSpendByYmd(startMs, endMs, tz) {
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

    const startYmd = ymdInTimeZone(rangeStartTs, timeZone) || new Date(rangeStartTs).toISOString().slice(0, 10);
    const endYmd = ymdInTimeZone(Math.max(rangeStartTs, rangeEndTs - 1), timeZone) || new Date(Math.max(rangeStartTs, rangeEndTs - 1)).toISOString().slice(0, 10);
    const needShopifyCosts = !!(deductionToggles.includePaymentFees || deductionToggles.includeShopifyAppBills);
    let shopifyCosts = { available: !needShopifyCosts, paymentFeesByYmd: new Map(), appBillsByYmd: new Map(), error: '' };
    if (needShopifyCosts) {
      const token = await salesTruth.getAccessToken(shop).catch(() => '');
      shopifyCosts = await businessSnapshotService.readShopifyBalanceCostsGbp(shop, token, startYmd, endYmd, timeZone).catch(() => ({
        available: false,
        error: 'shopify_cost_lookup_failed',
        paymentFeesByYmd: new Map(),
        appBillsByYmd: new Map(),
      }));
    }

    const adsSpendByYmd = deductionToggles.includeGoogleAdsSpend
      ? await readAdsSpendByYmd(rangeStartTs, rangeEndTs, timeZone)
      : new Map();

    const overheadByYmd = new Map();
    if (deductionToggles.includeRules && overheads.length) {
      for (const ymd of dayKeys.values()) {
        let total = 0;
        for (const oh of overheads) total += overheadDailyAmountGbp(oh, ymd);
        overheadByYmd.set(String(ymd), round2(total) || 0);
      }
    }

    for (const o of parsed) {
      if (!o) continue;
      const ymd = o.orderYmd != null ? String(o.orderYmd) : '';
      const dayRev = Number(revenueByYmd.get(ymd)) || 0;
      const rev = Number(o.revenueGbp) || 0;
      const share = dayRev > 0 && Number.isFinite(rev) ? (rev / dayRev) : 0;
      if (!Number.isFinite(share) || share < 0) continue;

      const components = {};
      let cost = 0;

      if (deductionToggles.includeGoogleAdsSpend) {
        const daySpend = Number(adsSpendByYmd.get(ymd)) || 0;
        const alloc = round2(daySpend * share) || 0;
        components.google_ads_spend_alloc_gbp = alloc;
        cost += alloc;
      }
      if (deductionToggles.includePaymentFees) {
        if (!shopifyCosts || shopifyCosts.available !== true) {
          o.profitGbp = null;
          o.profitVersion = PROFIT_VERSION;
          o.profitComponents = JSON.stringify({ ok: false, missing: 'payment_fees', error: shopifyCosts && shopifyCosts.error ? String(shopifyCosts.error).slice(0, 180) : 'shopify_costs_unavailable' });
          o.profitComputedAtMs = profitComputedAtMs;
          continue;
        }
        const dayFees = Number(shopifyCosts.paymentFeesByYmd && shopifyCosts.paymentFeesByYmd.get ? shopifyCosts.paymentFeesByYmd.get(ymd) : 0) || 0;
        const alloc = round2(dayFees * share) || 0;
        components.payment_fees_alloc_gbp = alloc;
        cost += alloc;
      }
      if (deductionToggles.includeShopifyAppBills) {
        if (!shopifyCosts || shopifyCosts.available !== true) {
          o.profitGbp = null;
          o.profitVersion = PROFIT_VERSION;
          o.profitComponents = JSON.stringify({ ok: false, missing: 'shopify_app_bills', error: shopifyCosts && shopifyCosts.error ? String(shopifyCosts.error).slice(0, 180) : 'shopify_costs_unavailable' });
          o.profitComputedAtMs = profitComputedAtMs;
          continue;
        }
        const dayBills = Number(shopifyCosts.appBillsByYmd && shopifyCosts.appBillsByYmd.get ? shopifyCosts.appBillsByYmd.get(ymd) : 0) || 0;
        const alloc = round2(dayBills * share) || 0;
        components.shopify_app_bills_alloc_gbp = alloc;
        cost += alloc;
      }
      if (deductionToggles.includeShopifyTaxes) {
        const tax = Number(o.taxGbp) || 0;
        components.shopify_tax_gbp = round2(tax) || 0;
        cost += Number(components.shopify_tax_gbp) || 0;
      }
      if (deductionToggles.includeShipping) {
        const ship = computeShippingCostForOrder(o.countryCode, shippingConfig);
        components.shipping_cost_gbp = round2(ship) || 0;
        cost += Number(components.shipping_cost_gbp) || 0;
      }
      if (deductionToggles.includeRules) {
        const rulesAdj = computePerOrderRulesAdjustmentGbp(o, perOrderRules, ce && ce.rule_mode);
        const overheadDay = Number(overheadByYmd.get(ymd)) || 0;
        const overheadAlloc = round2(overheadDay * share) || 0;
        const fixedAlloc = round2(Number(fixedPerDay || 0) * share) || 0;
        components.rules_per_order_gbp = rulesAdj;
        components.overhead_alloc_gbp = overheadAlloc;
        components.fixed_costs_alloc_gbp = fixedAlloc;
        cost += (Number(rulesAdj) || 0) + (Number(overheadAlloc) || 0) + (Number(fixedAlloc) || 0);
      }

      const profit = round2(rev - cost) || 0;
      o.profitGbp = Math.max(0, Number.isFinite(profit) ? profit : 0);
      o.profitVersion = PROFIT_VERSION;
      o.profitComponents = JSON.stringify({
        ok: true,
        ymd,
        revenue_gbp: round2(rev) || 0,
        cost_gbp: round2(cost) || 0,
        toggles: deductionToggles,
        components,
      }).slice(0, 4000);
      o.profitComputedAtMs = profitComputedAtMs;
    }
  } catch (_) {}

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
      `SELECT session_id, visitor_id, started_at, country_code, cf_country, ua_device_type, bs_source, bs_campaign_id, bs_adgroup_id, bs_ad_id, bs_network, utm_source, entry_url FROM sessions WHERE session_id IN (${placeholders})`,
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
        bsNetwork: r && r.bs_network != null ? String(r.bs_network).trim().toLowerCase() : null,
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
            bs_network,
            entry_url
          FROM sessions
          WHERE visitor_id = ?
            AND started_at >= ? AND started_at < ?
            AND (
              NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL
              OR (entry_url IS NOT NULL AND (entry_url LIKE '%gclid=%' OR entry_url LIKE '%gbraid=%' OR entry_url LIKE '%wbraid=%'))
            )
          ORDER BY started_at DESC
          LIMIT 1
        `,
        [vid, minMs, before]
      );
      if (!row) return null;
      const entryUrl = row.entry_url != null ? String(row.entry_url).trim() : '';
      const params = safeUrlParams(entryUrl);
      const gl = extractGclidLike(params);
      if (!looksLikeGoogleAds({ gclidLike: gl })) return null;
      const visitorCountryCode =
        normalizeCountryCode(row && row.country_code != null ? row.country_code : null) ||
        normalizeCountryCode(row && row.cf_country != null ? row.cf_country : null) ||
        null;
      const visitorDeviceType = (row && row.ua_device_type != null) ? String(row.ua_device_type).trim().toLowerCase() : null;
      const visitorNetwork = (row && row.bs_network != null) ? String(row.bs_network).trim().toLowerCase() : null;
      return {
        sessionId: row && row.session_id != null ? String(row.session_id).trim() : null,
        startedAt: row.started_at != null ? Number(row.started_at) : null,
        bsCampaignId: row.bs_campaign_id != null ? String(row.bs_campaign_id).trim() : null,
        bsAdgroupId: row.bs_adgroup_id != null ? String(row.bs_adgroup_id).trim() : null,
        bsAdId: row.bs_ad_id != null ? String(row.bs_ad_id).trim() : null,
        entryUrl,
        visitorCountryCode,
        visitorDeviceType,
        visitorNetwork,
      };
    } catch (_) {
      return null;
    }
  }

  async function findFirstGoogleAdsClickForVisitor(visitorId, beforeMs) {
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
            bs_network,
            entry_url
          FROM sessions
          WHERE visitor_id = ?
            AND started_at >= ? AND started_at < ?
            AND (
              NULLIF(TRIM(bs_campaign_id), '') IS NOT NULL
              OR (entry_url IS NOT NULL AND (entry_url LIKE '%gclid=%' OR entry_url LIKE '%gbraid=%' OR entry_url LIKE '%wbraid=%'))
            )
          ORDER BY started_at ASC
          LIMIT 1
        `,
        [vid, minMs, before]
      );
      if (!row) return null;
      const entryUrl = row.entry_url != null ? String(row.entry_url).trim() : '';
      const params = safeUrlParams(entryUrl);
      const gl = extractGclidLike(params);
      if (!looksLikeGoogleAds({ gclidLike: gl })) return null;
      const visitorCountryCode =
        normalizeCountryCode(row && row.country_code != null ? row.country_code : null) ||
        normalizeCountryCode(row && row.cf_country != null ? row.cf_country : null) ||
        null;
      const visitorDeviceType = (row && row.ua_device_type != null) ? String(row.ua_device_type).trim().toLowerCase() : null;
      const visitorNetwork = (row && row.bs_network != null) ? String(row.bs_network).trim().toLowerCase() : null;
      return {
        sessionId: row && row.session_id != null ? String(row.session_id).trim() : null,
        startedAt: row.started_at != null ? Number(row.started_at) : null,
        bsCampaignId: row.bs_campaign_id != null ? String(row.bs_campaign_id).trim() : null,
        bsAdgroupId: row.bs_adgroup_id != null ? String(row.bs_adgroup_id).trim() : null,
        bsAdId: row.bs_ad_id != null ? String(row.bs_ad_id).trim() : null,
        entryUrl,
        visitorCountryCode,
        visitorDeviceType,
        visitorNetwork,
      };
    } catch (_) {
      return null;
    }
  }

  /** Resolve campaign/adgroup from a first/last click result: prefer gclid_campaign_cache when entry_url has gclid. */
  async function resolveCampaignFromClickResult(clickResult, adsDbRef, gclidCacheRef) {
    if (!clickResult || !clickResult.entryUrl) {
      return {
        campaignId: clickResult && clickResult.bsCampaignId ? clickResult.bsCampaignId : null,
        adgroupId: clickResult && clickResult.bsAdgroupId ? clickResult.bsAdgroupId : null,
      };
    }
    const params = safeUrlParams(clickResult.entryUrl);
    const gl = params ? extractGclidLike(params) : null;
    const gclid = gl && gl.gclid ? String(gl.gclid).trim() : null;
    if (gclid) {
      const mapping = await getGclidMappingCached(adsDbRef, gclidCacheRef, gclid);
      if (mapping && mapping.campaignId) {
        return { campaignId: mapping.campaignId, adgroupId: mapping.adgroupId || null };
      }
    }
    return {
      campaignId: clickResult.bsCampaignId || null,
      adgroupId: clickResult.bsAdgroupId || null,
    };
  }

  // Apply evidence attribution (and establish source when landing_site didn't include it).
  for (const o of parsed) {
    if (!o) continue;
    const ev = orderIdToEvidence.get(o.orderId);
    const sess = ev && ev.sessionId ? sessionMap.get(ev.sessionId) : null;

    // Attribution confidence: prefer click-id on the order itself (handled earlier),
    // then purchase_events.page_url (Tier A), then the linked session.entry_url (Tier B).
    if (!o.clickIdValue && ev && ev.pageUrl) {
      const params = safeUrlParams(ev.pageUrl);
      const gl = params ? extractGclidLike(params) : null;
      const picked = pickClickId(gl);
      const gclid = gl && gl.gclid ? String(gl.gclid).trim() : null;
      const gbraid = gl && gl.gbraid ? String(gl.gbraid).trim() : null;
      const wbraid = gl && gl.wbraid ? String(gl.wbraid).trim() : null;
      if (gclid) o.gclid = o.gclid || gclid;
      if (gbraid) o.gbraid = o.gbraid || gbraid;
      if (wbraid) o.wbraid = o.wbraid || wbraid;
      if (picked && picked.id) {
        o.clickIdValue = String(picked.id).trim();
        o.clickIdType = picked && picked.kind ? String(picked.kind).trim() : null;
        o.attributionConfidence = o.attributionConfidence || 'A';
        o.attributionSource = o.attributionSource || 'purchase_event_page_url';
        o.attributionDebug = o.attributionDebug || 'click-id from purchase_events.page_url';
      }
    }
    if (!o.clickIdValue && sess && sess.entryUrl) {
      const sp = safeUrlParams(sess.entryUrl);
      const gl = extractGclidLike(sp);
      const picked = pickClickId(gl);
      const gclid = gl && gl.gclid ? String(gl.gclid).trim() : null;
      const gbraid = gl && gl.gbraid ? String(gl.gbraid).trim() : null;
      const wbraid = gl && gl.wbraid ? String(gl.wbraid).trim() : null;
      if (gclid) o.gclid = o.gclid || gclid;
      if (gbraid) o.gbraid = o.gbraid || gbraid;
      if (wbraid) o.wbraid = o.wbraid || wbraid;
      if (picked && picked.id) {
        o.clickIdValue = String(picked.id).trim();
        o.clickIdType = picked && picked.kind ? String(picked.kind).trim() : null;
        o.attributionConfidence = o.attributionConfidence || 'B';
        o.attributionSource = o.attributionSource || 'purchase_event_session';
        o.attributionDebug = o.attributionDebug || 'click-id from purchase_events.session.entry_url';
      }
    }

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
    if (sess && !o.visitorNetwork) {
      const nn = sess.bsNetwork ? String(sess.bsNetwork).trim().toLowerCase() : '';
      if (nn) o.visitorNetwork = nn;
    }

    // If we already have campaign + source, we only needed the session linkage above.
    if (o.campaignId && o.source) continue;

    if (!o.source) {
      const evAttrib = ev && ev.pageUrl ? deriveAttributionFromUrl(ev.pageUrl) : null;
      const gclidLike = evAttrib && evAttrib.gclidLike ? evAttrib.gclidLike : null;
      if (looksLikeGoogleAds({ gclidLike })) {
        o.source = source;
        if (!o.attributionMethod) o.attributionMethod = 'purchase_events.source';
      }
      if (!o.clickIdValue && gclidLike) {
        const picked = pickClickId(gclidLike);
        if (picked && picked.id) {
          o.clickIdValue = String(picked.id).trim();
          o.clickIdType = picked.kind ? String(picked.kind).trim() : null;
          if (gclidLike.gclid) o.gclid = o.gclid || String(gclidLike.gclid).trim();
          if (gclidLike.gbraid) o.gbraid = o.gbraid || String(gclidLike.gbraid).trim();
          if (gclidLike.wbraid) o.wbraid = o.wbraid || String(gclidLike.wbraid).trim();
          o.attributionConfidence = o.attributionConfidence || 'A';
          o.attributionSource = o.attributionSource || 'purchase_event_page_url';
          o.attributionDebug = o.attributionDebug || 'click-id from purchase_events.page_url';
        }
      }
    }

    // Only copy session bs_campaign_id when session has a click-id (guard against tinkered URLs).
    if (sess && sess.bsCampaignId && !o.campaignId && sess.entryUrl) {
      const sessParams = safeUrlParams(sess.entryUrl);
      const sessGclidLike = sessParams ? extractGclidLike(sessParams) : null;
      if (looksLikeGoogleAds({ gclidLike: sessGclidLike })) {
        o.campaignId = sess.bsCampaignId;
        o.adgroupId = sess.bsAdgroupId || '_all_';
        o.adId = sess.bsAdId || null;
        o.attributionMethod = 'purchase_events.session.bs_campaign_id';
        attributed++;
        continue;
      }
    }

    // If session has click ids in entry_url (gclid/gbraid/wbraid) but bs_campaign_id wasn't filled, use cache.
    if (!o.campaignId && sess && sess.entryUrl) {
      const sp = safeUrlParams(sess.entryUrl);
      const gl = extractGclidLike(sp);
      const picked = pickClickId(gl);
      const gclid = gl && gl.gclid ? String(gl.gclid).trim() : null;
      const gbraid = gl && gl.gbraid ? String(gl.gbraid).trim() : null;
      const wbraid = gl && gl.wbraid ? String(gl.wbraid).trim() : null;
      if (gclid) o.gclid = o.gclid || gclid;
      if (gbraid) o.gbraid = o.gbraid || gbraid;
      if (wbraid) o.wbraid = o.wbraid || wbraid;
      if (!o.clickIdValue && picked && picked.id) {
        o.clickIdValue = String(picked.id).trim();
        o.clickIdType = picked && picked.kind ? String(picked.kind).trim() : null;
        o.attributionConfidence = o.attributionConfidence || 'B';
        o.attributionSource = o.attributionSource || 'purchase_event_session';
        o.attributionDebug = o.attributionDebug || 'click-id from purchase_events.session.entry_url';
      }
      if (gclid) {
        const mapping = await getGclidMappingCached(adsDb, gclidCache, gclid);
        if (mapping && mapping.campaignId) {
          o.campaignId = mapping.campaignId;
          o.adgroupId = mapping.adgroupId || '_all_';
          if (!o.attributionMethod) o.attributionMethod = 'purchase_events.session.gclid_cache';
          attributed++;
          continue;
        }
      }
    }

    // Carry-over (last Google Ads click): attribute direct/returning purchases that lost UTMs on the purchase session.
    if (!o.campaignId && sess && sess.visitorId) {
      const last = await findLastGoogleAdsClickForVisitor(sess.visitorId, o.createdAtMs);
      if (last) {
        const resolved = await resolveCampaignFromClickResult(last, adsDb, gclidCache);
        o.source = o.source || source;
        if (resolved && resolved.campaignId) {
          o.campaignId = resolved.campaignId;
          o.adgroupId = resolved.adgroupId || '_all_';
        } else if (last.bsCampaignId) {
          o.campaignId = last.bsCampaignId;
          o.adgroupId = last.bsAdgroupId || '_all_';
        }
        o.adId = last.bsAdId || null;
        if (!o.clickIdValue && last.entryUrl) {
          const params = safeUrlParams(last.entryUrl);
          const gl = params ? extractGclidLike(params) : null;
          const picked = pickClickId(gl);
          const gclid = gl && gl.gclid ? String(gl.gclid).trim() : null;
          const gbraid = gl && gl.gbraid ? String(gl.gbraid).trim() : null;
          const wbraid = gl && gl.wbraid ? String(gl.wbraid).trim() : null;
          if (gclid) o.gclid = o.gclid || gclid;
          if (gbraid) o.gbraid = o.gbraid || gbraid;
          if (wbraid) o.wbraid = o.wbraid || wbraid;
          if (picked && picked.id) {
            o.clickIdValue = String(picked.id).trim();
            o.clickIdType = picked && picked.kind ? String(picked.kind).trim() : null;
            o.attributionConfidence = o.attributionConfidence || 'C';
            o.attributionSource = o.attributionSource || 'visitor_fallback';
            o.attributionDebug = o.attributionDebug || 'click-id from visitor last ads click (30d)';
          }
        }
        if (last.sessionId && !o.sessionId) o.sessionId = last.sessionId;
        if (last.visitorCountryCode && !o.visitorCountryCode) o.visitorCountryCode = last.visitorCountryCode;
        if (last.visitorDeviceType && !o.visitorDeviceType) o.visitorDeviceType = last.visitorDeviceType;
        if (last.visitorNetwork && !o.visitorNetwork) o.visitorNetwork = last.visitorNetwork;
        o.attributionMethod = 'visitor.last_ads_click';
        attributed++;
        continue;
      }
    }

    // Fallback: parse page_url for tracking params. Only use URL campaignId when page has click-id (guard against tinkered params).
    const pageUrl = ev && ev.pageUrl ? ev.pageUrl : null;
    if (pageUrl) {
      const urlAttrib = deriveAttributionFromUrl(pageUrl);
      const gl = urlAttrib && urlAttrib.gclidLike ? urlAttrib.gclidLike : null;
      if (urlAttrib && urlAttrib.campaignId && looksLikeGoogleAds({ gclidLike: gl })) {
        o.campaignId = urlAttrib.campaignId;
        o.adgroupId = urlAttrib.adgroupId || '_all_';
        o.adId = urlAttrib.adId || null;
        o.attributionMethod = 'purchase_events.page_url.' + (urlAttrib.attributionMethod || 'url');
        attributed++;
        continue;
      }
      const picked = pickClickId(gl);
      const gclid = gl && gl.gclid ? String(gl.gclid).trim() : (urlAttrib && urlAttrib.gclid ? String(urlAttrib.gclid).trim() : null);
      const gbraid = gl && gl.gbraid ? String(gl.gbraid).trim() : null;
      const wbraid = gl && gl.wbraid ? String(gl.wbraid).trim() : null;
      if (gclid) o.gclid = o.gclid || gclid;
      if (gbraid) o.gbraid = o.gbraid || gbraid;
      if (wbraid) o.wbraid = o.wbraid || wbraid;
      if (!o.clickIdValue && picked && picked.id) {
        o.clickIdValue = String(picked.id).trim();
        o.clickIdType = picked && picked.kind ? String(picked.kind).trim() : null;
      }
      if (!o.campaignId && gclid) {
        const mapping = await getGclidMappingCached(adsDb, gclidCache, gclid);
        if (mapping && mapping.campaignId) {
          o.campaignId = mapping.campaignId;
          o.adgroupId = mapping.adgroupId || '_all_';
          o.attributionMethod = 'purchase_events.page_url.gclid_cache';
          attributed++;
          continue;
        }
      }
    }

    if (o.source && !o.campaignId) unattributed++;
  }

  // Verified campaign-id fallback (no click-id):
  // Some Shopify checkouts lose gclid/gbraid/wbraid; to avoid “spend-only” reports while still
  // guarding against random/tinkered numeric IDs, only allow UTMs/bs_campaign_id attribution
  // when the campaign_id is confirmed to exist in the connected Google Ads account.
  try {
    const candidateIds = new Set();
    for (const o of parsed) {
      if (!o || o.source) continue;
      const cid = o.campaignId != null ? String(o.campaignId).trim() : '';
      if (cid && /^\d+$/.test(cid)) candidateIds.add(cid);

      // Also consider the linked session’s bs_campaign_id (common when order.landing_site loses params).
      const sid = o.sessionId != null ? String(o.sessionId).trim() : '';
      const sess = sid ? sessionMap.get(sid) : null;
      const scid = sess && sess.bsCampaignId != null ? String(sess.bsCampaignId).trim() : '';
      if (scid && /^\d+$/.test(scid)) candidateIds.add(scid);
    }

    if (candidateIds.size) {
      const ids = Array.from(candidateIds);
      const verified = new Set();

      const normShop = String(shop || '').trim().toLowerCase();
      const providerKey = 'google_ads';

      // 1) Fast local verification (Ads DB): campaign cache + spend history.
      for (const idChunk of chunk(ids, 200)) {
        const safeIds = (idChunk || []).map((v) => String(v).trim()).filter((v) => /^\d+$/.test(v));
        if (!safeIds.length) continue;
        const placeholders = safeIds.map(() => '?').join(', ');

        // Cache table (if present)
        try {
          const rows = await adsDb.all(
            `
              SELECT campaign_id
              FROM google_ads_campaign_cache
              WHERE shop = ? AND provider = ? AND campaign_id IN (${placeholders})
                AND campaign_name IS NOT NULL AND TRIM(campaign_name) != ''
            `,
            [normShop, providerKey, ...safeIds]
          );
          for (const r of rows || []) {
            const id = r && r.campaign_id != null ? String(r.campaign_id).trim() : '';
            if (id) verified.add(id);
          }
        } catch (_) {}

        // Spend history table
        try {
          const rows = await adsDb.all(
            `
              SELECT campaign_id
              FROM google_ads_spend_hourly
              WHERE provider = ? AND campaign_id IN (${placeholders})
                AND campaign_name IS NOT NULL AND TRIM(campaign_name) != ''
              GROUP BY campaign_id
            `,
            [providerKey, ...safeIds]
          );
          for (const r of rows || []) {
            const id = r && r.campaign_id != null ? String(r.campaign_id).trim() : '';
            if (id) verified.add(id);
          }
        } catch (_) {}
      }

      // 2) API verification for any remaining IDs (best-effort)
      const unresolved = ids.filter((id) => !verified.has(String(id)));
      for (const idChunk of chunk(unresolved, 50)) {
        const safeIds = (idChunk || []).map((v) => String(v).trim()).filter((v) => /^\d+$/.test(v));
        if (!safeIds.length) continue;
        const q = `SELECT campaign.id FROM campaign WHERE campaign.id IN (${safeIds.join(', ')})`;
        const out = await googleAdsClient.search(shop, q);
        if (!out || !out.ok) continue;
        for (const r of out.results || []) {
          const id = r && r.campaign && r.campaign.id != null ? String(r.campaign.id).trim() : '';
          if (id) verified.add(id);
        }
      }

      for (const o of parsed) {
        if (!o || o.source) continue;
        let cid = o.campaignId != null ? String(o.campaignId).trim() : '';
        if (!cid || !/^\d+$/.test(cid)) {
          const sid = o.sessionId != null ? String(o.sessionId).trim() : '';
          const sess = sid ? sessionMap.get(sid) : null;
          const scid = sess && sess.bsCampaignId != null ? String(sess.bsCampaignId).trim() : '';
          if (scid && /^\d+$/.test(scid)) cid = scid;
        }
        if (!cid || !verified.has(cid)) continue;
        o.source = source;
        if (!o.campaignId) o.campaignId = cid;
        if (!o.adgroupId) o.adgroupId = '_all_';
        o.attributionMethod = o.attributionMethod || 'campaign_id.verified';
      }
    }
  } catch (e) {
    console.warn('[ads.orders] campaign-id verification failed (non-fatal):', e && e.message ? e.message : e);
  }

  // First/last click (30d) per order for attribution model switch: use visitor-linked session when available.
  for (const o of parsed) {
    if (!o) continue;
    const ev = orderIdToEvidence.get(o.orderId);
    const sess = ev && ev.sessionId ? sessionMap.get(ev.sessionId) : null;
    if (sess && sess.visitorId) {
      const first = await findFirstGoogleAdsClickForVisitor(sess.visitorId, o.createdAtMs);
      const last = await findLastGoogleAdsClickForVisitor(sess.visitorId, o.createdAtMs);
      const firstResolved = await resolveCampaignFromClickResult(first, adsDb, gclidCache);
      const lastResolved = await resolveCampaignFromClickResult(last, adsDb, gclidCache);
      o.campaignIdFirstClick = firstResolved.campaignId || null;
      o.adgroupIdFirstClick = firstResolved.adgroupId || (firstResolved.campaignId ? '_all_' : null);
      o.campaignIdLastClick = lastResolved.campaignId || null;
      o.adgroupIdLastClick = lastResolved.adgroupId || (lastResolved.campaignId ? '_all_' : null);
      o.attributionModelFirstMethod = first ? 'visitor.first_ads_click' : null;
      o.attributionModelLastMethod = last ? 'visitor.last_ads_click' : null;
    } else {
      o.campaignIdFirstClick = o.campaignId || null;
      o.adgroupIdFirstClick = o.adgroupId || null;
      o.campaignIdLastClick = o.campaignId || null;
      o.adgroupIdLastClick = o.adgroupId || null;
      o.attributionModelFirstMethod = null;
      o.attributionModelLastMethod = null;
    }
  }

  // 3) Upsert to Ads DB.
  const now = Date.now();
  let upserts = 0;
  for (const o of parsed) {
    if (!o) continue; // only persist this provider’s attributed universe
    await adsDb.run(
      `
        INSERT INTO ads_orders_attributed
          (shop, order_id, created_at_ms, currency, total_price, revenue_gbp, profit_gbp, profit_version, profit_components, profit_computed_at_ms, identity_hashes_present, identity_quality_score, identity_email_sha256, identity_phone_sha256, source, campaign_id, adgroup_id, ad_id, gclid, gbraid, wbraid, click_id_type, click_id_value, country_code, attribution_method, attribution_confidence, attribution_source, attribution_debug, landing_site, session_id, visitor_country_code, visitor_device_type, visitor_network, campaign_id_first_click, adgroup_id_first_click, campaign_id_last_click, adgroup_id_last_click, attribution_model_first_method, attribution_model_last_method, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (shop, order_id) DO UPDATE SET
          created_at_ms = EXCLUDED.created_at_ms,
          currency = EXCLUDED.currency,
          total_price = EXCLUDED.total_price,
          revenue_gbp = EXCLUDED.revenue_gbp,
          profit_gbp = CASE
            WHEN ads_orders_attributed.profit_gbp IS NOT NULL AND ads_orders_attributed.profit_version = EXCLUDED.profit_version THEN ads_orders_attributed.profit_gbp
            ELSE EXCLUDED.profit_gbp
          END,
          profit_version = CASE
            WHEN ads_orders_attributed.profit_gbp IS NOT NULL AND ads_orders_attributed.profit_version = EXCLUDED.profit_version THEN ads_orders_attributed.profit_version
            ELSE EXCLUDED.profit_version
          END,
          profit_components = CASE
            WHEN ads_orders_attributed.profit_gbp IS NOT NULL AND ads_orders_attributed.profit_version = EXCLUDED.profit_version THEN ads_orders_attributed.profit_components
            ELSE EXCLUDED.profit_components
          END,
          profit_computed_at_ms = CASE
            WHEN ads_orders_attributed.profit_gbp IS NOT NULL AND ads_orders_attributed.profit_version = EXCLUDED.profit_version THEN ads_orders_attributed.profit_computed_at_ms
            ELSE EXCLUDED.profit_computed_at_ms
          END,
          identity_hashes_present = EXCLUDED.identity_hashes_present,
          identity_quality_score = EXCLUDED.identity_quality_score,
          identity_email_sha256 = EXCLUDED.identity_email_sha256,
          identity_phone_sha256 = EXCLUDED.identity_phone_sha256,
          source = EXCLUDED.source,
          campaign_id = EXCLUDED.campaign_id,
          adgroup_id = EXCLUDED.adgroup_id,
          ad_id = EXCLUDED.ad_id,
          gclid = EXCLUDED.gclid,
          gbraid = EXCLUDED.gbraid,
          wbraid = EXCLUDED.wbraid,
          click_id_type = EXCLUDED.click_id_type,
          click_id_value = EXCLUDED.click_id_value,
          country_code = EXCLUDED.country_code,
          session_id = EXCLUDED.session_id,
          visitor_country_code = EXCLUDED.visitor_country_code,
          visitor_device_type = EXCLUDED.visitor_device_type,
          visitor_network = EXCLUDED.visitor_network,
          campaign_id_first_click = EXCLUDED.campaign_id_first_click,
          adgroup_id_first_click = EXCLUDED.adgroup_id_first_click,
          campaign_id_last_click = EXCLUDED.campaign_id_last_click,
          adgroup_id_last_click = EXCLUDED.adgroup_id_last_click,
          attribution_model_first_method = EXCLUDED.attribution_model_first_method,
          attribution_model_last_method = EXCLUDED.attribution_model_last_method,
          attribution_method = EXCLUDED.attribution_method,
          attribution_confidence = EXCLUDED.attribution_confidence,
          attribution_source = EXCLUDED.attribution_source,
          attribution_debug = EXCLUDED.attribution_debug,
          landing_site = EXCLUDED.landing_site,
          updated_at = EXCLUDED.updated_at
      `,
      [
        o.shop,
        o.orderId,
        Math.trunc(o.createdAtMs),
        o.currency || null,
        o.totalPrice != null ? Number(o.totalPrice) : null,
        o.revenueGbp != null ? Number(o.revenueGbp) : 0,
        o.profitGbp != null ? Number(o.profitGbp) : null,
        o.profitVersion || null,
        o.profitComponents || null,
        o.profitComputedAtMs != null ? Number(o.profitComputedAtMs) : null,
        o.identityHashesPresent != null ? Number(o.identityHashesPresent) : null,
        o.identityQualityScore != null ? Number(o.identityQualityScore) : null,
        o.identityEmailSha256 || null,
        o.identityPhoneSha256 || null,
        o.source || null,
        o.campaignId || null,
        o.adgroupId || null,
        o.adId || null,
        o.gclid || null,
        o.gbraid || null,
        o.wbraid || null,
        o.clickIdType || null,
        o.clickIdValue || null,
        o.countryCode || null,
        o.attributionMethod || null,
        o.attributionConfidence || null,
        o.attributionSource || null,
        o.attributionDebug || null,
        o.landingSite || null,
        o.sessionId || null,
        o.visitorCountryCode || null,
        o.visitorDeviceType || null,
        o.visitorNetwork || null,
        o.campaignIdFirstClick || null,
        o.adgroupIdFirstClick || null,
        o.campaignIdLastClick || null,
        o.adgroupIdLastClick || null,
        o.attributionModelFirstMethod || null,
        o.attributionModelLastMethod || null,
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

