/**
 * One-time cleanup: remove h: purchase rows when the same session has a token: or order: row
 * with the same order_total and order_currency in the same 15-min bucket (so we don't double-count).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  // IMPORTANT: non-destructive migrations only.
  // We never delete from purchases in migrations or runtime (see .cursor/rules/no-delete-without-backup.mdc).
  // Dedupe is handled in stats queries and via canonical Shopify truth tables.
  return;
}

module.exports = { up };
