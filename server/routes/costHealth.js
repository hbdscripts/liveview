/**
 * GET /api/cost/health – master-only cost integration health for Settings → Cost & Expenses.
 * Returns status per source: Google Ads, Shopify Payments, Shopify Fees, app bills, COGS.
 */

const { getDb } = require('../db');
const salesTruth = require('../salesTruth');
const adsService = require('../ads/adsService');
const businessSnapshotService = require('../businessSnapshotService');
const store = require('../store');

const HEALTH_TIMEOUT_MS = 8000;

function withTimeout(promise, ms, fallback) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('timeout')), ms)
  );
  return Promise.race([promise, timeout]).catch(() => fallback);
}

async function getShopAndToken(shopParam) {
  const shop = salesTruth.resolveShopForSales(shopParam || '');
  if (!shop) return { shop: null, token: null, scope: '' };
  const db = getDb();
  let token = '';
  let scope = '';
  try {
    const row = await db.get('SELECT access_token, scope FROM shop_sessions WHERE shop = ?', [shop]);
    token = row && row.access_token ? String(row.access_token) : '';
    scope = row && typeof row.scope === 'string' ? String(row.scope) : '';
  } catch (_) {}
  return { shop, token, scope };
}

async function googleAdsHealth(shop) {
  const status = { status: 'unknown', statusText: '—' };
  if (!shop) {
    status.status = 'missing';
    status.statusText = 'No shop';
    return status;
  }
  try {
    const adsStatus = await adsService.getStatus(shop);
    const connected = adsStatus && adsStatus.providers && adsStatus.providers[0]
      ? !!adsStatus.providers[0].connected
      : false;
    status.status = connected ? 'connected' : 'offline';
    status.statusText = connected ? 'Connected' : 'Not connected';

    const adsDb = require('../ads/adsDb').getAdsDb();
    if (adsDb && connected) {
      try {
        const row = await adsDb.get(
          `SELECT MAX(hour_ts) AS max_ts FROM google_ads_spend_hourly WHERE provider = 'google_ads' LIMIT 1`
        );
        const maxTs = row && row.max_ts != null ? row.max_ts : null;
        if (maxTs) {
          const ageHours = (Date.now() / 1000 - Number(maxTs)) / 3600;
          if (ageHours > 168) status.statusText = 'Connected; last spend data >7d ago';
          else status.statusText = 'Connected; spend data recent';
        }
      } catch (_) {}
    }
  } catch (err) {
    status.status = 'error';
    status.statusText = (err && err.message) ? String(err.message).slice(0, 80) : 'Check failed';
  }
  return status;
}

function scopeIncludes(scopeStr, fragment) {
  const s = (scopeStr || '').toLowerCase();
  const f = (fragment || '').toLowerCase();
  if (!f) return false;
  const parts = s.split(/[\s,]+/).filter(Boolean);
  return parts.some((p) => p.includes(f) || f.includes(p));
}

function scopeHasBalance(scopeStr) {
  return scopeIncludes(scopeStr, 'read_shopify_payments') || scopeIncludes(scopeStr, 'balance');
}

async function shopifyBalanceLookup(shop, token, scope) {
  const base = { status: 'unknown', statusText: '—' };
  if (!shop || !token) {
    const missing = { ...base, status: 'missing', statusText: 'No shop or token' };
    return { payment: { ...missing }, shopifyFees: { ...missing }, appBills: { ...missing } };
  }
  if (!scopeHasBalance(scope)) {
    return {
      payment: { ...base, status: 'scope_missing', statusText: 'Scope missing' },
      shopifyFees: { ...base, status: 'scope_missing', statusText: 'Scope missing' },
      appBills: { ...base, status: 'scope_missing', statusText: 'Scope missing' },
    };
  }
  const timeZone = store.resolveAdminTimeZone();
  const now = new Date();
  const since = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
  const sinceYmd = since.toLocaleDateString('en-CA', { timeZone });
  const untilYmd = now.toLocaleDateString('en-CA', { timeZone });
  try {
    const result = await withTimeout(
      businessSnapshotService.readShopifyBalanceCostsGbp(shop, token, sinceYmd, untilYmd, timeZone),
      HEALTH_TIMEOUT_MS,
      { available: false, error: 'timeout' }
    );
    if (result && result.available === true) {
      const hasPayment = (result.paymentFeesTotalGbp || 0) > 0;
      const hasShopify = (result.shopifyFeesTotalGbp || result.klarnaFeesTotalGbp || 0) > 0;
      const hasApp = (result.appBillsTotalGbp || 0) > 0;
      const text = 'Connected' + (hasPayment || hasShopify || hasApp ? '; data in last 30d' : '');
      return {
        payment: { status: 'ok', statusText: text },
        shopifyFees: { status: 'ok', statusText: text },
        appBills: { status: 'ok', statusText: text },
      };
    }
    const errText = (result && result.error) ? String(result.error) : 'No recent data';
    return {
      payment: { status: 'error', statusText: errText },
      shopifyFees: { status: 'error', statusText: errText },
      appBills: { status: 'error', statusText: errText },
    };
  } catch (err) {
    const errText = (err && err.message) ? String(err.message).slice(0, 80) : 'Lookup failed';
    return {
      payment: { status: 'error', statusText: errText },
      shopifyFees: { status: 'error', statusText: errText },
      appBills: { status: 'error', statusText: errText },
    };
  }
}

async function cogsHealth(shop, token) {
  const status = { status: 'unknown', statusText: '—' };
  if (!shop || !token) {
    status.status = 'missing';
    status.statusText = 'No shop or token';
    return status;
  }
  const db = getDb();
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  let lineItemsWithVariant = 0;
  try {
    const rows = await db.all(
      `SELECT variant_id FROM orders_shopify_line_items
       WHERE shop = ? AND order_created_at >= ?
         AND (order_test IS NULL OR order_test = 0)
         AND order_cancelled_at IS NULL
         AND order_financial_status IN ('paid','partially_paid')
         AND variant_id IS NOT NULL AND TRIM(variant_id) != ''
       LIMIT 500`,
      [shop, thirtyDaysAgo]
    );
    for (const r of rows || []) {
      const vid = (r && r.variant_id != null) ? String(r.variant_id).trim() : '';
      if (vid) lineItemsWithVariant += 1;
    }
  } catch (_) {
    status.status = 'error';
    status.statusText = 'DB error';
    return status;
  }
  if (lineItemsWithVariant === 0) {
    status.status = 'no_data';
    status.statusText = 'No recent line items with variant ID';
    return status;
  }
  status.status = 'ok';
  status.statusText = lineItemsWithVariant + ' line items with variant ID (30d); unit costs from Shopify when set';
  return status;
}

async function getCostHealth(req, res) {
  const shopParam = (req.query && req.query.shop) ? String(req.query.shop).trim() : '';
  const { shop, token, scope } = await getShopAndToken(shopParam);

  const [googleAds, balanceLookup, cogsResult] = await Promise.all([
    googleAdsHealth(shop),
    shopifyBalanceLookup(shop, token, scope),
    cogsHealth(shop, token),
  ]);

  const sources = {
    googleAds: { status: googleAds.status, statusText: googleAds.statusText },
    shopifyPayments: { status: balanceLookup.payment.status, statusText: balanceLookup.payment.statusText },
    shopifyFees: { status: balanceLookup.shopifyFees.status, statusText: balanceLookup.shopifyFees.statusText },
    appBills: { status: balanceLookup.appBills.status, statusText: balanceLookup.appBills.statusText },
    cogs: { status: cogsResult.status, statusText: cogsResult.statusText },
  };

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, sources });
}

module.exports = { getCostHealth };
