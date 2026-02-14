const Sentry = require('@sentry/node');
const store = require('../store');
const reportCache = require('../reportCache');
const businessSnapshotService = require('../businessSnapshotService');

const SNAPSHOT_CACHE_TTL_MS = 10 * 60 * 1000;
const SNAPSHOT_MIN_YEAR = 2025;

function pad2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '01';
  return String(Math.max(1, Math.trunc(n))).padStart(2, '0');
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

function parseYmdParts(ymd) {
  const s = String(ymd || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}

function formatYmd(year, month, day) {
  return `${String(Math.trunc(Number(year) || 0)).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function normalizeMode(raw) {
  return String(raw || '').trim().toLowerCase() === 'monthly' ? 'monthly' : 'yearly';
}

function normalizeYear(raw, fallbackYear) {
  const y = Number(raw);
  if (!Number.isFinite(y) || y < SNAPSHOT_MIN_YEAR || y > 3000) return String(fallbackYear);
  return String(Math.trunc(y));
}

function normalizeMonth(raw, fallbackMonth) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return String(fallbackMonth || '');
  return s;
}

function resolveSnapshotRangeWindow({ modeRaw, yearRaw, monthRaw, nowMs, timeZone }) {
  const nowYmd = ymdInTimeZone(nowMs, timeZone) || `${new Date(nowMs).getUTCFullYear()}-01-01`;
  const nowParts = parseYmdParts(nowYmd) || { year: new Date(nowMs).getUTCFullYear(), month: 1, day: 1 };

  const mode = normalizeMode(modeRaw);
  const defaultMonth = `${nowParts.year}-${pad2(nowParts.month)}`;
  const selectedMonth = normalizeMonth(monthRaw, defaultMonth);
  const selectedYear = normalizeYear(yearRaw, nowParts.year);

  if (mode === 'monthly') {
    const monthMatch = selectedMonth.match(/^(\d{4})-(\d{2})$/);
    const year = monthMatch ? Number(monthMatch[1]) : nowParts.year;
    const month = monthMatch ? Number(monthMatch[2]) : nowParts.month;
    const fullMonthDays = daysInMonth(year, month);
    const isCurrentMonth = year === nowParts.year && month === nowParts.month;
    const endDay = isCurrentMonth ? Math.min(nowParts.day, fullMonthDays) : fullMonthDays;
    const startYmd = `${String(year)}-${pad2(month)}-01`;
    const endYmd = formatYmd(year, month, endDay);
    return {
      mode,
      selectedYear: String(year),
      selectedMonth: `${String(year)}-${pad2(month)}`,
      rangeKey: `r:${startYmd}:${endYmd}`,
    };
  }

  const y = Number(selectedYear);
  const endDay = Math.min(nowParts.day, daysInMonth(y, nowParts.month));
  const startYmd = `${selectedYear}-01-01`;
  const endYmd = formatYmd(y, nowParts.month, endDay);
  return {
    mode: 'yearly',
    selectedYear,
    selectedMonth,
    rangeKey: `r:${startYmd}:${endYmd}`,
  };
}

async function getBusinessSnapshot(req, res) {
  const modeRaw = req && req.query && req.query.mode != null ? String(req.query.mode) : '';
  const yearRaw = req && req.query && req.query.year != null ? String(req.query.year) : '';
  const monthRaw = req && req.query && req.query.month != null ? String(req.query.month) : '';
  const force = !!(req && req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));
  try {
    const now = Date.now();
    const timeZone = store.resolveAdminTimeZone();
    const window = resolveSnapshotRangeWindow({
      modeRaw,
      yearRaw,
      monthRaw,
      nowMs: now,
      timeZone,
    });
    const bounds = store.getRangeBounds(window.rangeKey, now, timeZone);
    const cached = await reportCache.getOrComputeJson(
      {
        shop: '',
        endpoint: 'business-snapshot',
        rangeKey: window.rangeKey,
        rangeStartTs: bounds.start,
        rangeEndTs: bounds.end,
        params: {
          mode: window.mode,
          year: window.selectedYear,
          month: window.selectedMonth,
          snapshotUiVersion: 'yearly-modal-v2',
        },
        ttlMs: SNAPSHOT_CACHE_TTL_MS,
        force,
      },
      async () => businessSnapshotService.getBusinessSnapshot({
        mode: window.mode,
        year: window.selectedYear,
        month: window.selectedMonth,
      })
    );
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    res.json(cached && cached.ok ? cached.data : null);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'businessSnapshot', mode: modeRaw, year: yearRaw, month: monthRaw } });
    res.status(500).json({ ok: false, error: 'Failed to load business snapshot' });
  }
}

module.exports = {
  getBusinessSnapshot,
};
