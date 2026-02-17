/**
 * Change Pins: persisted timeline annotations (tools + dashboard overlays).
 *
 * Table: change_pins
 * - event_ymd: date in admin TZ (YYYY-MM-DD)
 * - event_ts: UTC ms timestamp (optional but used for hourly markers)
 * - archived_at: nullable; prefer archive over delete
 */
const { getDb, isPostgres } = require('../db');

function safeJsonStringify(v, fallback = '[]') {
  try {
    if (v == null) return fallback;
    const s = JSON.stringify(v);
    return typeof s === 'string' ? s : fallback;
  } catch (_) {
    return fallback;
  }
}

async function up() {
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

  // Seed: only insert if empty (single-tenant friendly; safe noop when already used).
  try {
    const exists = await db.get('SELECT id FROM change_pins LIMIT 1', []);
    if (exists) return;
  } catch (_) {
    // If the select fails for any reason, skip seeding.
    return;
  }

  try {
    const now = Date.now();
    const eventYmd = '2026-02-16';
    const eventTz = 'Europe/London';
    // 12:40 on 16/02/2026 in Europe/London (GMT in Feb) -> UTC.
    const eventTs = Date.parse('2026-02-16T12:40:00.000Z');
    const title = 'Google auto discounts ceiling 22%';
    const kind = 'ads';
    const magnitudeValue = 22;
    const magnitudeUnit = '%';
    const tags = ['google', 'auto-discounts'];
    const tagsText = tags.join(' ').toLowerCase();
    const notes = 'Ceiling increased to 22% (was 15%). Time: 12:40 on 16/02/2026.';

    await db.run(
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
        '',
        eventYmd,
        Number.isFinite(eventTs) ? eventTs : null,
        eventTz,
        title,
        kind,
        magnitudeValue,
        magnitudeUnit,
        safeJsonStringify(tags, '[]'),
        tagsText,
        notes,
        now,
        now,
        'system',
        'system',
      ]
    );
  } catch (_) {
    // Ignore seed failures.
  }
}

module.exports = { up };

