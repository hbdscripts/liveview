/**
 * Admin Controls API (master-only at mount time).
 *
 * - GET  /api/admin/controls
 * - PUT  /api/admin/controls
 *
 * Currently used for per-page loader overlay enable/disable.
 */
const express = require('express');
const store = require('../store');

const router = express.Router();

const PAGE_LOADER_ENABLED_V1_KEY = 'page_loader_enabled_v1';

function defaultPageLoaderEnabledV1() {
  return {
    v: 1,
    pages: {
      dashboard: true,
      live: true,
      sales: true,
      date: true,
      countries: true,
      products: true,
      variants: true,
      'abandoned-carts': true,
      channels: true,
      type: true,
      ads: true,
      'compare-conversion-rate': true,
      'shipping-cr': true,
      settings: true,
      upgrade: false,
      admin: false,
    },
  };
}

function normalizePageLoaderEnabledV1(input) {
  const base = defaultPageLoaderEnabledV1();
  const out = { v: 1, pages: { ...base.pages } };
  if (!input) return out;
  let parsed = null;
  try {
    parsed = (typeof input === 'string') ? JSON.parse(input) : input;
  } catch (_) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  if (Number(parsed.v) !== 1) return out;
  const pages = parsed.pages && typeof parsed.pages === 'object' ? parsed.pages : null;
  if (!pages) return out;
  for (const key of Object.keys(out.pages)) {
    if (!Object.prototype.hasOwnProperty.call(pages, key)) continue;
    out.pages[key] = pages[key] === false ? false : true;
  }
  out.pages.admin = false;
  return out;
}

async function readConfig() {
  try {
    const raw = await store.getSetting(PAGE_LOADER_ENABLED_V1_KEY);
    return normalizePageLoaderEnabledV1(raw);
  } catch (_) {
    return defaultPageLoaderEnabledV1();
  }
}

router.get('/controls', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pageLoaderEnabled = await readConfig();
  res.json({ ok: true, pageLoaderEnabled });
});

router.put('/controls', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'PUT') return res.status(405).set('Allow', 'PUT').end();

  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const normalized = normalizePageLoaderEnabledV1(body.pageLoaderEnabled);

  try {
    const json = JSON.stringify(normalized);
    if (json.length > 50000) throw new Error('page_loader_enabled_v1 too large');
    await store.setSetting(PAGE_LOADER_ENABLED_V1_KEY, json);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save controls' });
  }

  res.json({ ok: true, pageLoaderEnabled: normalized });
});

module.exports = router;

