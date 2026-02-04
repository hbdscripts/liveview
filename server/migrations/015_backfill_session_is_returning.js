/**
 * Backfill sessions.is_returning for sessions that existed before migration 013
 * or that were never set. A session is "returning" if the same visitor had at least
 * one other session that started before this session.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const subquery = `
    SELECT s1.session_id FROM sessions s1
    WHERE COALESCE(s1.is_returning, 0) = 0
      AND EXISTS (
        SELECT 1 FROM sessions s2
        WHERE s2.visitor_id = s1.visitor_id
          AND s2.session_id != s1.session_id
          AND s2.started_at < s1.started_at
      )
  `;
  if (isPostgres()) {
    await db.run(`UPDATE sessions SET is_returning = 1 WHERE session_id IN (${subquery})`);
  } else {
    await db.run(`UPDATE sessions SET is_returning = 1 WHERE session_id IN (${subquery})`);
  }
}

module.exports = { up };
