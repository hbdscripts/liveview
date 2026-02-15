/**
 * Devices/UA observed counts.
 *
 * Used by Settings → Theme → Icons to show “Detected Devices” when a device/platform
 * has been observed more than N times (N defaults to 2).
 *
 * Definition: one “click” = one session (first event KEXO knows about).
 */
const { getDb } = require('../db');
const Sentry = require('@sentry/node');

function clampInt(v, { min, max, fallback }) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

function normalizeKey(v, { fallback = 'unknown', maxLen = 32 } = {}) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeCount(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

async function getObservedDevices(req, res) {
  const minClicks = clampInt(req && req.query ? req.query.minClicks : null, { min: 1, max: 1000000, fallback: 2 });
  const includeUnknown = !!(req && req.query && (req.query.includeUnknown === '1' || req.query.includeUnknown === 'true'));

  const db = getDb();
  try {
    const deviceRows = await db.all(
      `
        SELECT COALESCE(ua_device_type, 'unknown') AS k, COUNT(*) AS n
        FROM sessions
        GROUP BY COALESCE(ua_device_type, 'unknown')
        ORDER BY n DESC
      `
    );
    const platformRows = await db.all(
      `
        SELECT COALESCE(ua_platform, 'unknown') AS k, COUNT(*) AS n
        FROM sessions
        GROUP BY COALESCE(ua_platform, 'unknown')
        ORDER BY n DESC
      `
    );
    const modelRows = await db.all(
      `
        SELECT COALESCE(ua_model, 'unknown') AS k, COUNT(*) AS n
        FROM sessions
        GROUP BY COALESCE(ua_model, 'unknown')
        ORDER BY n DESC
      `
    );

    function mapRows(rows) {
      const out = [];
      (rows || []).forEach((r) => {
        const key = normalizeKey(r && r.k != null ? String(r.k) : '', {});
        const clicks = normalizeCount(r && r.n != null ? r.n : 0);
        if (!includeUnknown && key === 'unknown') return;
        if (clicks < minClicks) return;
        out.push({ key, clicks });
      });
      return out;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Cookie');
    res.json({
      ok: true,
      generatedAt: Date.now(),
      minClicks,
      includeUnknown,
      ua_device_type: mapRows(deviceRows),
      ua_platform: mapRows(platformRows),
      ua_model: mapRows(modelRows),
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'devices.observed' } });
    try { console.error(err); } catch (_) {}
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

module.exports = {
  getObservedDevices,
};

