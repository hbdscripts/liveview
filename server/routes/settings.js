/**
 * GET/POST /api/settings
 *
 * Small authenticated settings surface for the dashboard (stored in DB settings table).
 * Currently used to toggle pixel session strategy for debugging session count drift.
 */
const store = require('../store');

const PIXEL_SESSION_MODE_KEY = 'pixel_session_mode'; // legacy | shared_ttl

function normalizePixelSessionMode(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  if (s === 'shared_ttl' || s === 'shared' || s === 'sharedttl') return 'shared_ttl';
  return 'legacy';
}

async function getSettings(req, res) {
  let pixelSessionMode = 'legacy';
  try {
    pixelSessionMode = normalizePixelSessionMode(await store.getSetting(PIXEL_SESSION_MODE_KEY));
  } catch (_) {}
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    pixelSessionMode,
    sharedSessionTtlMinutes: 30,
  });
}

async function postSettings(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).set('Allow', 'POST').end();
  }
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};

  // Accept either explicit mode or a boolean convenience field.
  let nextMode = body.pixelSessionMode;
  if (typeof nextMode === 'boolean') nextMode = nextMode ? 'shared_ttl' : 'legacy';
  if (typeof body.sharedSessionFixEnabled === 'boolean') nextMode = body.sharedSessionFixEnabled ? 'shared_ttl' : 'legacy';

  const normalized = normalizePixelSessionMode(nextMode);
  try {
    await store.setSetting(PIXEL_SESSION_MODE_KEY, normalized);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save setting' });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, pixelSessionMode: normalized });
}

// ── Theme defaults (shared across all logins) ──────────────────────────────
// Must match the keys used by `server/public/theme-settings.js` (hyphens converted to underscores).
const THEME_KEYS = [
  'theme',
  'theme_primary',
  'theme_radius',
  // KEXO extensions (optional)
  'kexo_topbar',
  'kexo_nav_active',
];

async function getThemeDefaults(req, res) {
  const result = { ok: true };
  for (const key of THEME_KEYS) {
    try { result[key] = (await store.getSetting('theme_' + key)) || ''; } catch (_) { result[key] = ''; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
}

async function postThemeDefaults(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  try {
    for (const key of THEME_KEYS) {
      const val = body[key] != null ? String(body[key]).trim() : '';
      await store.setSetting('theme_' + key, val);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save theme' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
}

module.exports = {
  getSettings,
  postSettings,
  normalizePixelSessionMode,
  PIXEL_SESSION_MODE_KEY,
  getThemeDefaults,
  postThemeDefaults,
};

