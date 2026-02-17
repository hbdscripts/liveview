const store = require('../store');
const { getDb, isPostgres } = require('../db');
const reportCache = require('../reportCache');

let changePinsSchemaReady = false;
let changePinsSchemaInFlight = null;

async function ensureChangePinsSchema() {
  if (changePinsSchemaReady) return;
  if (changePinsSchemaInFlight) return changePinsSchemaInFlight;
  changePinsSchemaInFlight = (async () => {
    const db = getDb();
    if (isPostgres()) {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS change_pins (
          id SERIAL PRIMARY KEY,
          shop TEXT,
          event_ymd TEXT NOT NULL,
          event_ts BIGINT,
          event_tz TEXT,
          title TEXT NOT NULL,
          kind TEXT,
          magnitude_value DOUBLE PRECISION,
          magnitude_unit TEXT,
          tags_json TEXT,
          tags_text TEXT,
          notes TEXT,
          archived_at BIGINT,
          created_at BIGINT NOT NULL,
          updated_at BIGINT NOT NULL,
          created_by TEXT,
          updated_by TEXT
        );
      `);
      await db.run('CREATE INDEX IF NOT EXISTS idx_change_pins_event_ymd ON change_pins(event_ymd DESC)').catch(() => null);
      await db.run('CREATE INDEX IF NOT EXISTS idx_change_pins_archived_at ON change_pins(archived_at)').catch(() => null);
    } else {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS change_pins (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          shop TEXT,
          event_ymd TEXT NOT NULL,
          event_ts INTEGER,
          event_tz TEXT,
          title TEXT NOT NULL,
          kind TEXT,
          magnitude_value REAL,
          magnitude_unit TEXT,
          tags_json TEXT,
          tags_text TEXT,
          notes TEXT,
          archived_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          created_by TEXT,
          updated_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_change_pins_event_ymd ON change_pins(event_ymd DESC);
        CREATE INDEX IF NOT EXISTS idx_change_pins_archived_at ON change_pins(archived_at);
      `);
    }
    changePinsSchemaReady = true;
  })().finally(() => {
    changePinsSchemaInFlight = null;
  });
  return changePinsSchemaInFlight;
}

function safeStr(v, maxLen = 240) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeYmd(v) {
  const s = v != null ? String(v).trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return s;
}

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numOrNull(v) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function normalizeKind(v) {
  const s = safeStr(v, 32).toLowerCase();
  const allowed = new Set(['pricing', 'ads', 'site', 'ops', 'other']);
  return allowed.has(s) ? s : '';
}

function normalizeHm(v) {
  const s = v != null ? String(v).trim() : '';
  if (!s) return '';
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return '';
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function normalizeTags(raw) {
  const list = Array.isArray(raw)
    ? raw
    : (typeof raw === 'string' ? raw.split(',') : []);
  const out = [];
  const seen = new Set();
  for (const t of list) {
    const s = safeStr(t, 64).toLowerCase().replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 12) break;
  }
  return out;
}

function safeJsonStringify(v, fallback = '[]') {
  try {
    if (v == null) return fallback;
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s : fallback;
  } catch (_) {
    return fallback;
  }
}

function safeJsonParse(v, fallback) {
  try {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    const s = String(v).trim();
    if (!s) return fallback;
    return JSON.parse(s);
  } catch (_) {
    return fallback;
  }
}

// Convert YYYY-MM-DD + HH:MM in an IANA tz to UTC ms.
// Mirrors the logic in store.js (zonedTimeToUtcMs) but kept local for tooling.
function getTimeZoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getTimeZoneOffsetMs(timeZone, date) {
  const parts = getTimeZoneParts(date, timeZone);
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return utc - date.getTime();
}

function zonedTimeToUtcMs(year, month, day, hour, minute, second, timeZone) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffsetMs(timeZone, utcGuess);
  return utcGuess.getTime() - offset;
}

function ymdAddDays(ymd, deltaDays) {
  const s = safeYmd(ymd);
  if (!s) return '';
  const d = new Date(s + 'T00:00:00.000Z');
  if (!Number.isFinite(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + (Number(deltaDays) || 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdTodayInTz(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (_) {
    try {
      return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (_) {
      return '';
    }
  }
}

function serializePinRow(r) {
  const tags = normalizeTags(safeJsonParse(r && r.tags_json, []));
  return {
    id: r && r.id != null ? Number(r.id) : null,
    shop: r && r.shop != null ? String(r.shop) : '',
    event_ymd: r && r.event_ymd ? String(r.event_ymd) : '',
    event_ts: r && r.event_ts != null ? Number(r.event_ts) : null,
    event_tz: r && r.event_tz ? String(r.event_tz) : null,
    title: r && r.title ? String(r.title) : '',
    kind: r && r.kind ? String(r.kind) : null,
    magnitude_value: r && r.magnitude_value != null ? Number(r.magnitude_value) : null,
    magnitude_unit: r && r.magnitude_unit ? String(r.magnitude_unit) : null,
    tags,
    notes: r && r.notes ? String(r.notes) : null,
    archived_at: r && r.archived_at != null ? Number(r.archived_at) : null,
    created_at: r && r.created_at != null ? Number(r.created_at) : null,
    updated_at: r && r.updated_at != null ? Number(r.updated_at) : null,
    created_by: r && r.created_by ? String(r.created_by) : null,
    updated_by: r && r.updated_by ? String(r.updated_by) : null,
  };
}

async function createPin(input = {}, viewer = {}) {
  await ensureChangePinsSchema();
  const db = getDb();
  const tz = store.resolveAdminTimeZone();
  const now = Date.now();

  const eventYmd = safeYmd(input.event_ymd);
  if (!eventYmd) return { ok: false, error: 'invalid_event_ymd' };

  const title = safeStr(input.title, 120);
  if (!title) return { ok: false, error: 'missing_title' };

  const kind = normalizeKind(input.kind) || null;
  const magnitudeValue = numOrNull(input.magnitude_value);
  const magnitudeUnit = safeStr(input.magnitude_unit, 16) || null;
  const tags = normalizeTags(input.tags);
  const tagsJson = safeJsonStringify(tags, '[]');
  const tagsText = tags.join(' ');
  const notes = safeStr(input.notes, 2000) || null;
  const shop = safeStr(input.shop, 120) || '';

  const eventHm = normalizeHm(input.event_hm);
  const eventTsRaw = numOrNull(input.event_ts);
  const eventTs = (eventTsRaw != null && eventTsRaw > 0)
    ? Math.trunc(eventTsRaw)
    : (eventHm ? (() => {
      const parts = eventYmd.split('-').map((x) => parseInt(x, 10));
      if (parts.length !== 3) return null;
      const year = parts[0];
      const month = parts[1];
      const day = parts[2];
      const hm = eventHm.split(':').map((x) => parseInt(x, 10));
      const hh = hm[0];
      const mm = hm[1];
      const ms = zonedTimeToUtcMs(year, month, day, hh, mm, 0, tz);
      return Number.isFinite(ms) ? ms : null;
    })() : null);

  const createdBy = viewer && viewer.email ? safeStr(viewer.email, 180) : null;

  if (isPostgres()) {
    const row = await db.get(
      `
        INSERT INTO change_pins (
          shop, event_ymd, event_ts, event_tz,
          title, kind, magnitude_value, magnitude_unit,
          tags_json, tags_text, notes,
          archived_at, created_at, updated_at, created_by, updated_by
        ) VALUES (
          ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          NULL, ?, ?, ?, ?
        )
        RETURNING *
      `,
      [
        shop,
        eventYmd,
        eventTs,
        tz,
        title,
        kind,
        magnitudeValue,
        magnitudeUnit,
        tagsJson,
        tagsText,
        notes,
        now,
        now,
        createdBy,
        createdBy,
      ]
    );
    return { ok: true, pin: serializePinRow(row) };
  }

  const r = await db.run(
    `
      INSERT INTO change_pins (
        shop, event_ymd, event_ts, event_tz,
        title, kind, magnitude_value, magnitude_unit,
        tags_json, tags_text, notes,
        archived_at, created_at, updated_at, created_by, updated_by
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        NULL, ?, ?, ?, ?
      )
    `,
    [
      shop,
      eventYmd,
      eventTs,
      tz,
      title,
      kind,
      magnitudeValue,
      magnitudeUnit,
      tagsJson,
      tagsText,
      notes,
      now,
      now,
      createdBy,
      createdBy,
    ]
  );

  const row = await db.get('SELECT * FROM change_pins WHERE id = ? LIMIT 1', [r && r.lastID != null ? r.lastID : null]);
  return { ok: true, pin: serializePinRow(row) };
}

async function listPins(query = {}) {
  await ensureChangePinsSchema();
  const db = getDb();
  const fromYmd = safeYmd(query.from_ymd);
  const toYmd = safeYmd(query.to_ymd);
  const q = safeStr(query.q, 240).toLowerCase();
  const kind = normalizeKind(query.kind);
  const includeArchived = String(query.include_archived || '') === '1' || String(query.include_archived || '') === 'true';
  const limit = clampInt(query.limit, 50, 1, 200);
  const offset = clampInt(query.offset, 0, 0, 20000);

  const where = [];
  const params = [];

  if (!includeArchived) where.push('archived_at IS NULL');
  if (fromYmd) { where.push('event_ymd >= ?'); params.push(fromYmd); }
  if (toYmd) { where.push('event_ymd <= ?'); params.push(toYmd); }
  if (kind) { where.push('LOWER(COALESCE(kind, \'\')) = ?'); params.push(kind); }
  if (q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(COALESCE(notes, \'\')) LIKE ? OR LOWER(COALESCE(tags_text, \'\')) LIKE ?)');
    const like = '%' + q.replace(/[%_]/g, (m) => '\\' + m) + '%';
    params.push(like, like, like);
  }

  const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
  const rows = await db.all(
    `
      SELECT *
      FROM change_pins
      ${whereSql}
      ORDER BY event_ymd DESC, COALESCE(event_ts, 0) DESC, id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );
  const pins = (Array.isArray(rows) ? rows : []).map(serializePinRow);
  return { ok: true, pins, limit, offset };
}

async function getPinById(id) {
  await ensureChangePinsSchema();
  const db = getDb();
  const pinId = parseInt(String(id), 10);
  if (!Number.isFinite(pinId) || pinId <= 0) return { ok: false, error: 'invalid_id' };
  const row = await db.get('SELECT * FROM change_pins WHERE id = ? LIMIT 1', [pinId]);
  if (!row) return { ok: false, error: 'not_found' };
  return { ok: true, pin: serializePinRow(row), row };
}

async function patchPin(id, patch = {}, viewer = {}) {
  await ensureChangePinsSchema();
  const db = getDb();
  const pinId = parseInt(String(id), 10);
  if (!Number.isFinite(pinId) || pinId <= 0) return { ok: false, error: 'invalid_id' };

  const existing = await db.get('SELECT * FROM change_pins WHERE id = ? LIMIT 1', [pinId]);
  if (!existing) return { ok: false, error: 'not_found' };

  const tz = store.resolveAdminTimeZone();
  const now = Date.now();

  const next = {
    event_ymd: patch.event_ymd != null ? safeYmd(patch.event_ymd) : (existing.event_ymd ? String(existing.event_ymd) : ''),
    event_ts: patch.event_ts != null ? numOrNull(patch.event_ts) : (existing.event_ts != null ? Number(existing.event_ts) : null),
    title: patch.title != null ? safeStr(patch.title, 120) : (existing.title ? String(existing.title) : ''),
    kind: patch.kind != null ? (normalizeKind(patch.kind) || null) : (existing.kind != null ? String(existing.kind) : null),
    magnitude_value: patch.magnitude_value !== undefined ? numOrNull(patch.magnitude_value) : (existing.magnitude_value != null ? Number(existing.magnitude_value) : null),
    magnitude_unit: patch.magnitude_unit != null ? (safeStr(patch.magnitude_unit, 16) || null) : (existing.magnitude_unit != null ? String(existing.magnitude_unit) : null),
    notes: patch.notes != null ? (safeStr(patch.notes, 2000) || null) : (existing.notes != null ? String(existing.notes) : null),
  };

  const eventHm = normalizeHm(patch.event_hm);
  if (patch.event_hm != null && eventHm && next.event_ymd) {
    const parts = next.event_ymd.split('-').map((x) => parseInt(x, 10));
    const hm = eventHm.split(':').map((x) => parseInt(x, 10));
    const ms = zonedTimeToUtcMs(parts[0], parts[1], parts[2], hm[0], hm[1], 0, tz);
    if (Number.isFinite(ms)) next.event_ts = ms;
  }

  const tags = patch.tags != null ? normalizeTags(patch.tags) : normalizeTags(safeJsonParse(existing.tags_json, []));
  const tagsJson = safeJsonStringify(tags, '[]');
  const tagsText = tags.join(' ');

  if (!next.event_ymd) return { ok: false, error: 'invalid_event_ymd' };
  if (!next.title) return { ok: false, error: 'missing_title' };

  const updatedBy = viewer && viewer.email ? safeStr(viewer.email, 180) : null;

  await db.run(
    `
      UPDATE change_pins
      SET
        event_ymd = ?,
        event_ts = ?,
        event_tz = ?,
        title = ?,
        kind = ?,
        magnitude_value = ?,
        magnitude_unit = ?,
        tags_json = ?,
        tags_text = ?,
        notes = ?,
        updated_at = ?,
        updated_by = ?
      WHERE id = ?
    `,
    [
      next.event_ymd,
      next.event_ts != null ? Math.trunc(next.event_ts) : null,
      tz,
      next.title,
      next.kind,
      next.magnitude_value,
      next.magnitude_unit,
      tagsJson,
      tagsText,
      next.notes,
      now,
      updatedBy,
      pinId,
    ]
  );

  const row = await db.get('SELECT * FROM change_pins WHERE id = ? LIMIT 1', [pinId]);
  return { ok: true, pin: serializePinRow(row) };
}

async function setArchived(id, archived, viewer = {}) {
  await ensureChangePinsSchema();
  const db = getDb();
  const pinId = parseInt(String(id), 10);
  if (!Number.isFinite(pinId) || pinId <= 0) return { ok: false, error: 'invalid_id' };
  const row = await db.get('SELECT id FROM change_pins WHERE id = ? LIMIT 1', [pinId]);
  if (!row) return { ok: false, error: 'not_found' };
  const now = Date.now();
  const updatedBy = viewer && viewer.email ? safeStr(viewer.email, 180) : null;
  await db.run(
    'UPDATE change_pins SET archived_at = ?, updated_at = ?, updated_by = ? WHERE id = ?',
    [archived ? now : null, now, updatedBy, pinId]
  );
  const out = await db.get('SELECT * FROM change_pins WHERE id = ? LIMIT 1', [pinId]);
  return { ok: true, pin: serializePinRow(out) };
}

function pickMetric(kpis, rangeKey) {
  const rk = String(rangeKey || '');
  const revenue = kpis && kpis.sales && kpis.sales[rk] != null ? Number(kpis.sales[rk]) : null;
  const orders = kpis && kpis.convertedCount && kpis.convertedCount[rk] != null ? Number(kpis.convertedCount[rk]) : null;
  const sessions = kpis && kpis.trafficBreakdown && kpis.trafficBreakdown[rk] && kpis.trafficBreakdown[rk].human_sessions != null
    ? Number(kpis.trafficBreakdown[rk].human_sessions)
    : null;
  const conversion = kpis && kpis.conversion && kpis.conversion[rk] != null ? Number(kpis.conversion[rk]) : null;
  const aov = kpis && kpis.aov && kpis.aov[rk] != null ? Number(kpis.aov[rk]) : null;
  const roas = kpis && kpis.roas && kpis.roas[rk] != null ? Number(kpis.roas[rk]) : null;
  return { revenue, orders, sessions, conversion, aov, roas };
}

function delta(a, b) {
  const av = typeof a === 'number' && Number.isFinite(a) ? a : null;
  const bv = typeof b === 'number' && Number.isFinite(b) ? b : null;
  const abs = (av != null && bv != null) ? (bv - av) : null;
  const pct = (av != null && bv != null && av !== 0) ? ((bv - av) / av) : null;
  return { abs, pct };
}

async function getPinEffect(id, opts = {}) {
  const pin = await getPinById(id);
  if (!pin.ok) return pin;

  const windowDays = clampInt(opts.window_days, 7, 1, 60);
  const eventYmd = pin.pin.event_ymd;
  if (!eventYmd) return { ok: false, error: 'missing_event_ymd' };

  const beforeStart = ymdAddDays(eventYmd, -windowDays);
  const beforeEnd = ymdAddDays(eventYmd, -1);
  const afterStart = eventYmd;
  const afterEnd = ymdAddDays(eventYmd, windowDays - 1);
  if (!beforeStart || !beforeEnd || !afterStart || !afterEnd) return { ok: false, error: 'invalid_window' };

  const beforeKey = `r:${beforeStart}:${beforeEnd}`;
  const afterKey = `r:${afterStart}:${afterEnd}`;

  const cacheTtlMs = 2 * 60 * 1000;
  const cached = await reportCache.getOrComputeJson(
    {
      shop: '',
      endpoint: 'tools-change-pins-effect',
      rangeKey: afterKey,
      rangeStartTs: 0,
      rangeEndTs: 0,
      params: { pinId: Number(pin.pin.id) || 0, beforeKey, afterKey, windowDays },
      ttlMs: cacheTtlMs,
      force: false,
    },
    async () => {
      const [beforeKpis, afterKpis] = await Promise.all([
        store.getKpis({ trafficMode: 'human_only', rangeKey: beforeKey, force: false }),
        store.getKpis({ trafficMode: 'human_only', rangeKey: afterKey, force: false }),
      ]);

      const before = pickMetric(beforeKpis, beforeKey);
      const after = pickMetric(afterKpis, afterKey);

      return {
        ok: true,
        pin: pin.pin,
        window_days: windowDays,
        ranges: {
          before: { rangeKey: beforeKey, start_ymd: beforeStart, end_ymd: beforeEnd },
          after: { rangeKey: afterKey, start_ymd: afterStart, end_ymd: afterEnd },
        },
        before,
        after,
        delta: {
          revenue: delta(before.revenue, after.revenue),
          orders: delta(before.orders, after.orders),
          sessions: delta(before.sessions, after.sessions),
          conversion: delta(before.conversion, after.conversion),
          aov: delta(before.aov, after.aov),
          roas: delta(before.roas, after.roas),
        },
      };
    }
  );

  return cached && cached.ok ? cached.data : { ok: false, error: 'cache_failed' };
}

async function listRecentPins(opts = {}) {
  await ensureChangePinsSchema();
  const db = getDb();
  const tz = store.resolveAdminTimeZone();
  const days = clampInt(opts.days, 120, 1, 400);
  const today = ymdTodayInTz(tz);
  if (!today) return { ok: true, pins: [] };
  const from = ymdAddDays(today, -(days - 1));
  if (!from) return { ok: true, pins: [] };

  const rows = await db.all(
    `
      SELECT *
      FROM change_pins
      WHERE archived_at IS NULL
        AND event_ymd >= ?
        AND event_ymd <= ?
      ORDER BY event_ymd ASC, COALESCE(event_ts, 0) ASC, id ASC
    `,
    [from, today]
  );
  const pins = (Array.isArray(rows) ? rows : []).map(serializePinRow);
  return { ok: true, pins, from_ymd: from, to_ymd: today, tz };
}

module.exports = {
  createPin,
  listPins,
  patchPin,
  setArchived,
  getPinEffect,
  listRecentPins,
  // exposed for tests/other tools
  _normalizeTags: normalizeTags,
};

