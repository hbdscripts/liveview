/**
 * Purchases table for order-level dedupe. UNIQUE purchase_key so one order = one row.
 */

const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS purchases (
  purchase_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT,
  purchased_at INTEGER NOT NULL,
  order_total REAL,
  order_currency TEXT,
  order_id TEXT,
  checkout_token TEXT,
  country_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_session ON purchases(session_id);
CREATE INDEX IF NOT EXISTS idx_purchases_purchased_at ON purchases(purchased_at);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS purchases (
  purchase_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  visitor_id TEXT,
  purchased_at BIGINT NOT NULL,
  order_total DOUBLE PRECISION,
  order_currency TEXT,
  order_id TEXT,
  checkout_token TEXT,
  country_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchases_session ON purchases(session_id);
CREATE INDEX IF NOT EXISTS idx_purchases_purchased_at ON purchases(purchased_at);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    const statements = pgSchema.split(';').map((s) => s.trim()).filter(Boolean);
    for (const stmt of statements) {
      await db.run(stmt + ';');
    }
  } else {
    await db.exec(sqliteSchema);
  }

  // Backfill purchases from sessions that already have has_purchased=1 (so stats don't drop to zero)
  const sessions = await db.all(
    'SELECT session_id, visitor_id, purchased_at, order_total, order_currency, country_code FROM sessions WHERE has_purchased = 1'
  );
  for (const s of sessions) {
    const key = 'legacy:' + s.session_id;
    const pt = s.purchased_at != null ? Number(s.purchased_at) : null;
    const ot = s.order_total != null ? Number(s.order_total) : null;
    if (pt == null) continue;
    if (isPostgres()) {
      await db.run(
        `INSERT INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, country_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (purchase_key) DO NOTHING`,
        [key, s.session_id, s.visitor_id || null, pt, ot, s.order_currency || null, s.country_code || null]
      );
    } else {
      await db.run(
        `INSERT OR IGNORE INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, country_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [key, s.session_id, s.visitor_id || null, pt, ot, s.order_currency || null, s.country_code || null]
      );
    }
  }
}

module.exports = { up };
