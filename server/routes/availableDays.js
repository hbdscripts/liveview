/**
 * GET /api/available-days?days=30
 *
 * Returns which (local) dates have any sessions, for building the custom date picker.
 * Dates are computed in the admin timezone.
 */
const store = require('../store');
const { getDb } = require('../db');

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function ymdFromMs(ms, timeZone) {
  const dt = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(dt);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const y = map.year || '1970';
  const m = map.month || '01';
  const d = map.day || '01';
  return `${y}-${m}-${d}`;
}

async function getAvailableDays(req, res) {
  const db = getDb();
  const nowMs = Date.now();
  const timeZone = store.resolveAdminTimeZone();
  const days = clampInt(req.query.days || '30', 30, 1, 30);

  const PLATFORM_START = '2026-02-01';
  const dateList = [];
  const seen = new Set();
  for (let i = 0; i < days; i++) {
    const ms = nowMs - i * 24 * 60 * 60 * 1000;
    const ymd = ymdFromMs(ms, timeZone);
    if (ymd < PLATFORM_START) continue;
    if (seen.has(ymd)) continue;
    seen.add(ymd);
    dateList.push(ymd);
  }

  const checks = await Promise.all(
    dateList.map(async (ymd) => {
      const bounds = store.getRangeBounds('d:' + ymd, nowMs, timeZone);
      const row = await db.get(
        'SELECT 1 AS ok FROM sessions WHERE started_at >= ? AND started_at < ? LIMIT 1',
        [bounds.start, bounds.end]
      );
      return { date: ymd, hasSessions: !!row };
    })
  );

  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  res.json({ ok: true, timeZone, days: checks });
}

module.exports = { getAvailableDays };

