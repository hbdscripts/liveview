/**
 * One-time cleanup: remove legacy purchase rows when the same session has a token: or order: row.
 * Migration 008 backfilled legacy:session_id for sessions with has_purchased=1; if we later
 * received checkout_completed with order_id/checkout_token for that session, we had two rows
 * (legacy + token/order) and over-counted. This removes the legacy row so stats dedupe correctly.
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  // IMPORTANT: non-destructive migrations only.
  // We never delete from purchases in migrations or runtime (see .cursor/rules/no-delete-without-backup.mdc).
  // Dedupe is handled in stats queries and via canonical Shopify truth tables.
  return;
}

module.exports = { up };
