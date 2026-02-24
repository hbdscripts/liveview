/**
 * Admin Controls API (master-only at mount time).
 *
 * - GET  /api/admin/controls
 * - PUT  /api/admin/controls
 *
 * Per-page loaders UI: overlay (on-page loader) and top-strip loader, independently toggled.
 */
const express = require('express');
const store = require('../store');

const router = express.Router();

const PAGE_LOADERS_UI_V1_KEY = 'page_loaders_ui_v1';
const PAGE_LOADER_ENABLED_V1_KEY_LEGACY = 'page_loader_enabled_v1';

const LOADER_PAGE_KEYS = [
  'dashboard',
  'live',
  'sales',
  'date',
  'snapshot',
  'countries',
  'products',
  'variants',
  'abandoned-carts',
  'attribution',
  'devices',
  'ads',
  'compare-conversion-rate',
  'shipping-cr',
  'click-order-lookup',
  'change-pins',
  'time-of-day',
  'settings',
  'upgrade',
  'admin',
];

function defaultPageLoadersUiV1() {
  const pages = {};
  for (const key of LOADER_PAGE_KEYS) {
    const locked = key === 'settings' || key === 'upgrade' || key === 'admin';
    const overlay = locked ? false : key !== 'snapshot';
    const strip = locked ? false : true;
    pages[key] = { overlay, strip };
  }
  return { v: 1, pages };
}

function normalizePageLoadersUiV1(input) {
  const base = defaultPageLoadersUiV1();
  const out = { v: 1, pages: {} };
  for (const key of LOADER_PAGE_KEYS) {
    out.pages[key] = { ...base.pages[key] };
  }
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
  for (const key of LOADER_PAGE_KEYS) {
    const p = pages[key];
    if (!p || typeof p !== 'object') continue;
    if (key === 'settings' || key === 'upgrade' || key === 'admin') {
      out.pages[key] = { overlay: false, strip: false };
      continue;
    }
    out.pages[key].overlay = p.overlay === false ? false : true;
    out.pages[key].strip = p.strip === false ? false : true;
  }
  return out;
}

function migrateFromLegacyPageLoaderEnabled(legacy) {
  if (!legacy || typeof legacy !== 'object' || Number(legacy.v) !== 1) return null;
  const legacyPages = legacy.pages && typeof legacy.pages === 'object' ? legacy.pages : null;
  if (!legacyPages) return null;
  const out = defaultPageLoadersUiV1();
  const keyMap = {
    channels: 'attribution',
    type: 'devices',
  };
  for (const key of LOADER_PAGE_KEYS) {
    const legacyKey = keyMap[key] || key;
    const enabled = legacyPages[legacyKey] !== false;
    if (key === 'settings' || key === 'upgrade' || key === 'admin') continue;
    out.pages[key].overlay = enabled;
    out.pages[key].strip = true;
  }
  return out;
}

async function readConfig() {
  try {
    let raw = await store.getSetting(PAGE_LOADERS_UI_V1_KEY);
    if (!raw || raw.trim() === '') {
      const legacyRaw = await store.getSetting(PAGE_LOADER_ENABLED_V1_KEY_LEGACY);
      const legacy = legacyRaw ? (() => { try { return JSON.parse(legacyRaw); } catch (_) { return null; } })() : null;
      const migrated = migrateFromLegacyPageLoaderEnabled(legacy);
      if (migrated) {
        const json = JSON.stringify(migrated);
        await store.setSetting(PAGE_LOADERS_UI_V1_KEY, json);
        return migrated;
      }
    }
    return normalizePageLoadersUiV1(raw);
  } catch (_) {
    return defaultPageLoadersUiV1();
  }
}

router.get('/controls', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const pageLoadersUi = await readConfig();
  res.json({ ok: true, pageLoadersUi });
});

router.put('/controls', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'PUT') return res.status(405).set('Allow', 'PUT').end();

  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const normalized = normalizePageLoadersUiV1(body.pageLoadersUi);

  try {
    const json = JSON.stringify(normalized);
    if (json.length > 50000) throw new Error('page_loaders_ui_v1 too large');
    await store.setSetting(PAGE_LOADERS_UI_V1_KEY, json);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save controls' });
  }

  res.json({ ok: true, pageLoadersUi: normalized });
});

module.exports = router;
