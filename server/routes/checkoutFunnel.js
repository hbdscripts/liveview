/**
 * GET /api/insights/checkout-funnel – checkout funnel counts (sessions → cart → checkout started → purchased).
 * Query: range, timezone, traffic (optional).
 */
const Sentry = require('@sentry/node');
const express = require('express');
const store = require('../store');
const config = require('../config');

const router = express.Router();

const ALLOWED_RANGE = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function isCustomDayKey(v) {
  return typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
}

function isCustomRangeKey(v) {
  return typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
}

function normalizeRangeKey(raw) {
  const r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return 'today';
  if (r === '7days') return '7d';
  if (r === '14days') return '14d';
  if (r === '30days') return '30d';
  if (ALLOWED_RANGE.has(r) || isCustomDayKey(r) || isCustomRangeKey(r)) return r;
  return 'today';
}

function normalizeTraffic(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'human_only' || s === 'human_safe' || s === 'all') return s;
  return config.trafficMode || 'all';
}

function resolveBoundsFromReq(req) {
  const now = Date.now();
  const rangeKey = normalizeRangeKey(req && req.query ? req.query.range : '');
  const tzRaw = req && req.query ? (req.query.timezone || req.query.timeZone || '') : '';
  const tz = (typeof tzRaw === 'string' && tzRaw.trim()) ? tzRaw.trim() : store.resolveAdminTimeZone();
  const bounds = store.getRangeBounds(rangeKey, now, tz);
  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : now;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : now;
  return { now, rangeKey, tz, start: Math.min(start, end), end: Math.max(start, end) };
}

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  const trafficMode = normalizeTraffic(req && req.query ? req.query.traffic : '');
  const { rangeKey, start, end } = resolveBoundsFromReq(req);
  Sentry.addBreadcrumb({ category: 'api', message: 'checkoutFunnel.get', data: { rangeKey, trafficMode } });

  try {
    const data = await store.getCheckoutFunnelCounts(start, end, { trafficMode });
    const steps = [
      { key: 'sessions', label: 'Sessions', count: data.sessions, conversionFromPrevious: null },
      { key: 'cart', label: 'Added to cart', count: data.cart, conversionFromPrevious: data.conversionToCart },
      { key: 'checkout_started', label: 'Checkout started', count: data.checkoutStarted, conversionFromPrevious: data.conversionToCheckout },
      { key: 'purchased', label: 'Purchased', count: data.purchased, conversionFromPrevious: data.conversionToPurchase },
    ];
    res.json({
      rangeKey,
      start,
      end,
      steps,
      sessions: data.sessions,
      cart: data.cart,
      checkoutStarted: data.checkoutStarted,
      purchased: data.purchased,
      conversionToCart: data.conversionToCart,
      conversionToCheckout: data.conversionToCheckout,
      conversionToPurchase: data.conversionToPurchase,
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'checkoutFunnel.get', rangeKey } });
    console.error('[checkout-funnel]', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
