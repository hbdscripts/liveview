const Sentry = require('@sentry/node');
const express = require('express');
const salesTruth = require('../salesTruth');
const compareCr = require('../tools/compareCr');
const shippingCr = require('../tools/shippingCr');

const router = express.Router();

function safeShopParam(req) {
  const raw = req && req.query && req.query.shop != null ? String(req.query.shop).trim().toLowerCase() : '';
  const resolved = salesTruth.resolveShopForSales(raw);
  return resolved || raw;
}

router.get('/catalog-search', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const q = req && req.query && req.query.q != null ? String(req.query.q) : '';
    const out = await compareCr.catalogSearch({ shop, q, limit: req.query.limit });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.catalog-search' } });
    console.error('[tools.catalog-search]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/compare-cr/variants', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const productId = req && req.query && req.query.product_id != null ? String(req.query.product_id) : '';
    const out = await compareCr.getProductVariants({ shop, productId });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.compare-cr.variants' } });
    console.error('[tools.compare-cr.variants]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/compare-cr/mapped-groups', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = safeShopParam(req);
    const productId = req && req.query && req.query.product_id != null ? String(req.query.product_id) : '';
    const tableId = req && req.query && req.query.table_id != null ? String(req.query.table_id) : '';
    const out = await compareCr.getProductMappedVariantGroups({ shop, productId, tableId });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.compare-cr.mapped-groups' } });
    console.error('[tools.compare-cr.mapped-groups]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/compare-cr/compare', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = (req && req.body && req.body.shop != null) ? String(req.body.shop).trim().toLowerCase() : safeShopParam(req);
    const eventDate = req && req.body && req.body.event_date != null ? String(req.body.event_date) : '';
    const target = req && req.body && req.body.target ? req.body.target : null;
    const mode = req && req.body && req.body.mode != null ? String(req.body.mode) : '';
    const variantIds = req && req.body && Array.isArray(req.body.variant_ids) ? req.body.variant_ids : null;
    const variantMapping = req && req.body && req.body.variant_mapping && typeof req.body.variant_mapping === 'object'
      ? req.body.variant_mapping
      : null;

    const out = await compareCr.compareConversionRate({
      shop,
      eventDateYmd: eventDate,
      target,
      mode,
      variantIds,
      variantMapping,
    });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.compare-cr.compare' } });
    console.error('[tools.compare-cr.compare]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/shipping-cr/labels', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  try {
    const shop = (req && req.body && req.body.shop != null) ? String(req.body.shop).trim().toLowerCase() : safeShopParam(req);
    const countryCode = (req && req.body && req.body.country_code != null) ? String(req.body.country_code) : '';
    const startYmd = (req && req.body && req.body.start_ymd != null) ? String(req.body.start_ymd) : '';
    const endYmd = (req && req.body && req.body.end_ymd != null) ? String(req.body.end_ymd) : '';

    const out = await shippingCr.getShippingOptionsByCountry({
      shop,
      countryCode,
      startYmd,
      endYmd,
    });
    res.json(out);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'tools.shipping-cr.labels' } });
    console.error('[tools.shipping-cr.labels]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
