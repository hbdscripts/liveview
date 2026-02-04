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
    `, [retentionCutoff, retentionCutoff, abandonedCutoff]);
    await db.run(`
      DELETE FROM sessions
      WHERE last_seen < ? AND started_at < ?
      AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)
    `, [retentionCutoff, retentionCutoff, abandonedCutoff]);
  }

  // Per session: keep only last maxEventsPerSession events (one DELETE per session that has excess)
  const sessions = await db.all('SELECT session_id FROM sessions');
  const maxEvents = config.maxEventsPerSession;
  if (config.dbUrl) {
    for (const row of sessions) {
      await db.run(
        'DELETE FROM events WHERE session_id = $1 AND id NOT IN (SELECT id FROM events WHERE session_id = $1 ORDER BY ts DESC LIMIT $2)',
        [row.session_id, maxEvents]
      );
    }
  } else {
    for (const row of sessions) {
      await db.run(
        'DELETE FROM events WHERE session_id = ? AND id NOT IN (SELECT id FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?)',
        [row.session_id, row.session_id, maxEvents]
      );
    }
  }
}

module.exports = { run };
