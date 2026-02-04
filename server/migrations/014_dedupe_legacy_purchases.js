/**
 * One-time cleanup: remove legacy purchase rows when the same session has a token: or order: row.
 * Migration 008 backfilled legacy:session_id for sessions with has_purchased=1; if we later
 * received checkout_completed with order_id/checkout_token for that session, we had two rows
 * (legacy + token/order) and over-counted. This removes the legacy row so stats dedupe correctly.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  const rows = isPostgres()
    ? await db.all("SELECT DISTINCT session_id FROM purchases WHERE purchase_key LIKE 'token:%' OR purchase_key LIKE 'order:%'")
    : await db.all("SELECT DISTINCT session_id FROM purchases WHERE purchase_key LIKE 'token:%' OR purchase_key LIKE 'order:%'");
  if (!rows || rows.length === 0) return;
  const sessionIds = rows.map((r) => r.session_id).filter(Boolean);
  for (const sessionId of sessionIds) {
    const legacyKey = 'legacy:' + sessionId;
    if (isPostgres()) {
      await db.run('DELETE FROM purchases WHERE purchase_key = $1', [legacyKey]);
    } else {
      await db.run('DELETE FROM purchases WHERE purchase_key = ?', [legacyKey]);
    }
  }
}

module.exports = { up };
