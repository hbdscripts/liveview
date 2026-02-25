/**
 * Daily rollups (Phase 1): compute compact session/bounce components per day.
 *
 * Stored in `daily_rollups`:
 * - total_sessions, human_sessions, known_bot_sessions
 * - single_page_sessions (for bounce numerator)
 *
 * These rollups allow long-range charts/KPIs even after raw events are pruned.
 */
const { getDb } = require('./db');
const store = require('./store');

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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

function sessionFilterSqlForTrafficMode(trafficMode, sessionAlias = 's') {
  const mode = (trafficMode || '').toString().trim().toLowerCase();
  const a = sessionAlias || 's';
  const botSql = ` AND (${a}.cf_known_bot IS NULL OR ${a}.cf_known_bot = 0)`;
  const fraudSql = ` AND NOT EXISTS (
    SELECT 1 FROM fraud_evaluations fe
    WHERE fe.entity_type = 'session'
      AND fe.entity_id = ${a}.session_id
      AND fe.triggered = 1
  )`;
  if (mode === 'human_safe') return botSql + fraudSql;
  if (mode === 'human_only') return botSql;
  return '';
}

async function readExistingRollup(ymd, trafficMode) {
  const db = getDb();
  try {
    return await db.get(
      'SELECT * FROM daily_rollups WHERE ymd = ? AND traffic_mode = ? LIMIT 1',
      [String(ymd || ''), String(trafficMode || '')]
    );
  } catch (_) {
    return null;
  }
}

async function upsertDailyRollupForYmd(ymdRaw, trafficModeRaw, options = {}) {
  const ymd = String(ymdRaw || '').trim();
  const trafficMode = String(trafficModeRaw || '').trim().toLowerCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return { ok: false, error: 'invalid_ymd' };
  if (!trafficMode) return { ok: false, error: 'invalid_traffic_mode' };

  const db = getDb();
  const timeZone = options.timeZone || store.resolveAdminTimeZone();
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();

  const bounds = store.getRangeBounds('d:' + ymd, nowMs, timeZone);
  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : NaN;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return { ok: false, error: 'invalid_bounds' };

  const filterSql = sessionFilterSqlForTrafficMode(trafficMode, 's');

  const totalRow = await db.get(
    'SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ? AND s.started_at < ?',
    [start, end]
  );
  const humanRow = await db.get(
    'SELECT COUNT(*) AS n FROM sessions s WHERE s.started_at >= ? AND s.started_at < ?' + filterSql,
    [start, end]
  );

  const total = Math.max(0, Math.trunc(num(totalRow && totalRow.n, 0)));
  const human = Math.max(0, Math.trunc(num(humanRow && humanRow.n, 0)));
  const knownBot = Math.max(0, total - human);

  const singlePageRow = await db.get(
    `
      SELECT COUNT(*) AS n FROM (
        SELECT s.session_id
        FROM sessions s
        JOIN events e ON e.session_id = s.session_id
        WHERE s.started_at >= ? AND s.started_at < ? ${filterSql}
          AND e.type = 'page_viewed'
        GROUP BY s.session_id
        HAVING COUNT(*) = 1
      ) t
    `,
    [start, end]
  );
  const singlePage = Math.max(0, Math.trunc(num(singlePageRow && singlePageRow.n, 0)));

  const computedAt = nowMs;
  await db.run(
    `
      INSERT INTO daily_rollups (
        ymd, traffic_mode,
        total_sessions, human_sessions, known_bot_sessions,
        single_page_sessions,
        computed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (ymd, traffic_mode) DO UPDATE SET
        total_sessions = EXCLUDED.total_sessions,
        human_sessions = EXCLUDED.human_sessions,
        known_bot_sessions = EXCLUDED.known_bot_sessions,
        single_page_sessions = EXCLUDED.single_page_sessions,
        computed_at = EXCLUDED.computed_at
    `,
    [ymd, trafficMode, total, human, knownBot, singlePage, computedAt]
  );

  return { ok: true, ymd, trafficMode, total_sessions: total, human_sessions: human, known_bot_sessions: knownBot, single_page_sessions: singlePage, computed_at: computedAt };
}

async function ensureDailyRollupsForBounds(bounds, trafficMode, options = {}) {
  const timeZone = options.timeZone || store.resolveAdminTimeZone();
  const maxDays = Math.max(1, Math.min(90, parseInt(String(options.maxDays || 14), 10) || 14));
  const onlyMissing = options.onlyMissing !== false;
  const direction = (options.direction || 'oldest').toString().toLowerCase() === 'newest' ? 'newest' : 'oldest';

  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : NaN;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return { ok: false, error: 'invalid_bounds' };

  const ymdStart = ymdInTimeZone(start, timeZone);
  const ymdEnd = ymdInTimeZone(Math.max(start, end - 1), timeZone);
  if (!ymdStart || !ymdEnd) return { ok: false, error: 'invalid_ymd_bounds' };

  // Iterate by day using store helpers (timezone-aware). Guarded in store, plus our own maxDays cap.
  let ymds = [];
  try {
    ymds = store.listYmdsInBounds(start, end, timeZone);
  } catch (_) {
    ymds = [];
  }
  if (!Array.isArray(ymds) || ymds.length === 0) return { ok: true, computed: 0, skipped: 0, ymdStart, ymdEnd };

  if (direction === 'newest') ymds = ymds.slice().reverse();
  const slice = ymds.slice(0, maxDays);

  let computed = 0;
  let skipped = 0;
  const results = [];
  for (const ymd of slice) {
    if (onlyMissing) {
      const existing = await readExistingRollup(ymd, trafficMode);
      if (existing) {
        skipped += 1;
        continue;
      }
    }
    const r = await upsertDailyRollupForYmd(ymd, trafficMode, { timeZone });
    if (r && r.ok) {
      computed += 1;
      results.push(r);
    }
  }

  return { ok: true, computed, skipped, ymdStart, ymdEnd, results };
}

async function fetchDailyRollupsForBounds(bounds, trafficMode, options = {}) {
  const timeZone = options.timeZone || store.resolveAdminTimeZone();
  const start = bounds && Number.isFinite(Number(bounds.start)) ? Number(bounds.start) : NaN;
  const end = bounds && Number.isFinite(Number(bounds.end)) ? Number(bounds.end) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return [];

  const ymdStart = ymdInTimeZone(start, timeZone);
  const ymdEnd = ymdInTimeZone(Math.max(start, end - 1), timeZone);
  if (!ymdStart || !ymdEnd) return [];

  const db = getDb();
  try {
    return await db.all(
      `
        SELECT ymd, traffic_mode, total_sessions, human_sessions, known_bot_sessions, single_page_sessions, computed_at
        FROM daily_rollups
        WHERE traffic_mode = ?
          AND ymd >= ?
          AND ymd <= ?
        ORDER BY ymd ASC
      `,
      [String(trafficMode || ''), ymdStart, ymdEnd]
    );
  } catch (_) {
    return [];
  }
}

module.exports = {
  upsertDailyRollupForYmd,
  ensureDailyRollupsForBounds,
  fetchDailyRollupsForBounds,
  ymdInTimeZone,
};

