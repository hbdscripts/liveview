/**
 * TTL cleanup: purge old sessions only when BOTH last_seen and started_at are older than retention
 * (so stats windows for yesterday/3d/7d stay stable). Except abandoned within retention.
 */

const { getDb } = require('./db');
const config = require('./config');

async function run() {
  const db = getDb();
  const now = Date.now();
  const retentionMs = config.sessionRetentionDays * 24 * 60 * 60 * 1000;
  const retentionCutoff = now - retentionMs;
  const abandonedRetentionMs = config.abandonedRetentionHours * 60 * 60 * 1000;
  const abandonedCutoff = now - abandonedRetentionMs;

  // Delete only when BOTH last_seen and started_at are older than retention; except abandoned within retention
  if (config.dbUrl) {
    await db.run(`
      DELETE FROM events WHERE session_id IN (
        SELECT session_id FROM sessions
        WHERE last_seen < $1 AND started_at < $1
        AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < $2)
      )
    `, [retentionCutoff, abandonedCutoff]);
    await db.run(`
      DELETE FROM sessions
      WHERE last_seen < $1 AND started_at < $1
      AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < $2)
    `, [retentionCutoff, abandonedCutoff]);
  } else {
    await db.run(`
      DELETE FROM events WHERE session_id IN (
        SELECT session_id FROM sessions
        WHERE last_seen < ? AND started_at < ?
        AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)
      )
    `, [retentionCutoff, abandonedCutoff]);
    await db.run(`
      DELETE FROM sessions
      WHERE last_seen < ? AND started_at < ?
      AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)
    `, [retentionCutoff, abandonedCutoff]);
  }

  // Per session: keep only last MAX_EVENTS_PER_SESSION events (delete older ones)
  const sessions = await db.all('SELECT session_id FROM sessions');
  const maxEvents = config.maxEventsPerSession;
  for (const row of sessions) {
    const events = await db.all(
      config.dbUrl ? 'SELECT id FROM events WHERE session_id = $1 ORDER BY ts DESC' : 'SELECT id FROM events WHERE session_id = ? ORDER BY ts DESC',
      [row.session_id]
    );
    if (events.length > maxEvents) {
      const keepIds = events.slice(0, maxEvents).map(e => e.id);
      const ph = keepIds.map((_, i) => (config.dbUrl ? `$${i + 2}` : '?')).join(',');
      const params = config.dbUrl ? [row.session_id, ...keepIds] : [row.session_id, ...keepIds];
      const sql = config.dbUrl
        ? `DELETE FROM events WHERE session_id = $1 AND id NOT IN (${ph})`
        : `DELETE FROM events WHERE session_id = ? AND id NOT IN (${ph})`;
      await db.run(sql, params);
    }
  }
}

module.exports = { run };
