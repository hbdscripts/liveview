/**
 * GET /api/available-days?days=30
 *
 * Returns which (local) dates have any sessions, for building the custom date picker.
 * Dates are computed in the admin timezone.
 */
const store = require('../store');
const { getDb } = require('../db');
const config = require('../config');
const retentionPolicy = require('../retentionPolicy');

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
  const modeRaw = (req.query.mode || req.query.view || 'charts');
  const mode = typeof modeRaw === 'string' && modeRaw.trim().toLowerCase() === 'drilldown' ? 'drilldown' : 'charts';
  const effectiveTier = await retentionPolicy.getEffectiveRetentionTier(config);
  const limits = retentionPolicy.getTierLimits(effectiveTier);
  const maxDays = mode === 'drilldown' ? limits.drilldownRetentionDays : limits.chartsRetentionDays;
  const defaultDays = Math.min(30, maxDays);
  const days = clampInt(req.query.days || String(defaultDays), defaultDays, 1, maxDays);

  const PLATFORM_START = '2025-02-01';
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

  const rollupSet = new Set();
  if (mode === 'charts' && dateList.length) {
    try {
      const newest = dateList[0];
      const oldest = dateList[dateList.length - 1];
      const rows = await db.all(
        'SELECT DISTINCT ymd FROM daily_rollups WHERE ymd >= ? AND ymd <= ?',
        [oldest, newest]
      );
      for (const r of rows || []) {
        const y = r && r.ymd != null ? String(r.ymd).trim() : '';
        if (y) rollupSet.add(y);
      }
    } catch (_) {}
  }

  const recentCheckCount = Math.max(0, Math.min(dateList.length, limits.drilldownRetentionDays));
  const recentChecks = await Promise.all(
    dateList.slice(0, recentCheckCount).map(async (ymd) => {
      const bounds = store.getRangeBounds('d:' + ymd, nowMs, timeZone);
      const row = await db.get(
        'SELECT 1 AS ok FROM sessions WHERE started_at >= ? AND started_at < ? LIMIT 1',
        [bounds.start, bounds.end]
      );
      return { date: ymd, hasSessions: !!row };
    })
  );
  const recentMap = new Map(recentChecks.map((c) => [c.date, !!c.hasSessions]));

  const checks = dateList.map((ymd, i) => {
    const hasSessions = i < recentCheckCount ? (recentMap.get(ymd) || false) : rollupSet.has(ymd);
    return { date: ymd, hasSessions };
  });

  res.setHeader('Cache-Control', 'private, max-age=60');
  res.setHeader('Vary', 'Cookie');
  res.json({ ok: true, timeZone, mode, limits, days: checks });
}

module.exports = { getAvailableDays };

