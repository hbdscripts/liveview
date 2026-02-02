/**
 * Add cart_value, cart_currency, order_total, order_currency to sessions
 * for displaying £ in dashboard (cart value column and sales by country).
 */

const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cart_value DOUBLE PRECISION');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS cart_currency TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS order_total DOUBLE PRECISION');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS order_currency TEXT');
  } else {
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN cart_value REAL');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN cart_currency TEXT');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN order_total REAL');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
    try {
      await db.run('ALTER TABLE sessions ADD COLUMN order_currency TEXT');
    } catch (e) {
      if (!/duplicate column name/i.test(e.message)) throw e;
    }
  }
}

module.exports = { up };
