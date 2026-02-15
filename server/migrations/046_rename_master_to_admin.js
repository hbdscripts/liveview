/**
 * Rename legacy role 'master' -> 'admin' in users table.
 *
 * Safe:
 * - UPDATE only, no deletes.
 * - Idempotent.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  try {
    if (isPostgres()) {
      await db.run(`UPDATE users SET role = 'admin' WHERE role = 'master'`);
      return;
    }
    await db.exec(`UPDATE users SET role = 'admin' WHERE role = 'master'`);
  } catch (_) {
    // Fail-open: older installs may not have users table yet.
  }
}

module.exports = { up };

