/**
 * Sales Truth + Evidence tables.
 *
 * - orders_shopify: authoritative Shopify Orders snapshot (truth) keyed by (shop, order_id)
 * - purchase_events: append-only pixel evidence (checkout_completed etc.)
 * - reconcile_state: reconcile throttling + health state
 * - audit_log: append-only ops log (backups, reconcile runs, verification)
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS orders_shopify (
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_name TEXT,
  created_at INTEGER NOT NULL,
  processed_at INTEGER,
  financial_status TEXT,
  cancelled_at INTEGER,
  test INTEGER,
  currency TEXT,
  total_price REAL,
  subtotal_price REAL,
  total_tax REAL,
  total_discounts REAL,
  total_shipping REAL,
  customer_id TEXT,
  checkout_token TEXT,
  updated_at INTEGER,
  synced_at INTEGER NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (shop, order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_created_at ON orders_shopify(shop, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_checkout_token ON orders_shopify(shop, checkout_token);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_updated_at ON orders_shopify(shop, updated_at);

CREATE TABLE IF NOT EXISTS purchase_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  page_url TEXT,
  referrer TEXT,
  checkout_token TEXT,
  order_id TEXT,
  currency TEXT,
  total_price REAL,
  cf_known_bot INTEGER,
  cf_country TEXT,
  cf_asn TEXT,
  cf_colo TEXT,
  cf_verified_bot_category TEXT,
  event_group_key TEXT,
  linked_order_id TEXT,
  link_reason TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_received_at ON purchase_events(shop, received_at);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_occurred_at ON purchase_events(shop, occurred_at);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_checkout_token ON purchase_events(shop, checkout_token);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_order_id ON purchase_events(shop, order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_linked_order_id ON purchase_events(shop, linked_order_id);

CREATE TABLE IF NOT EXISTS reconcile_state (
  shop TEXT NOT NULL,
  scope TEXT NOT NULL,
  last_success_at INTEGER,
  last_attempt_at INTEGER,
  last_error TEXT,
  cursor_json TEXT,
  PRIMARY KEY (shop, scope)
);

CREATE TABLE IF NOT EXISTS audit_log (
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS orders_shopify (
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_name TEXT,
  created_at BIGINT NOT NULL,
  processed_at BIGINT,
  financial_status TEXT,
  cancelled_at BIGINT,
  test INTEGER,
  currency TEXT,
  total_price DOUBLE PRECISION,
  subtotal_price DOUBLE PRECISION,
  total_tax DOUBLE PRECISION,
  total_discounts DOUBLE PRECISION,
  total_shipping DOUBLE PRECISION,
  customer_id TEXT,
  checkout_token TEXT,
  updated_at BIGINT,
  synced_at BIGINT NOT NULL,
  raw_json TEXT,
  PRIMARY KEY (shop, order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_created_at ON orders_shopify(shop, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_checkout_token ON orders_shopify(shop, checkout_token);
CREATE INDEX IF NOT EXISTS idx_orders_shopify_shop_updated_at ON orders_shopify(shop, updated_at);

CREATE TABLE IF NOT EXISTS purchase_events (
  id BIGSERIAL PRIMARY KEY,
  shop TEXT NOT NULL,
  occurred_at BIGINT NOT NULL,
  received_at BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  page_url TEXT,
  referrer TEXT,
  checkout_token TEXT,
  order_id TEXT,
  currency TEXT,
  total_price DOUBLE PRECISION,
  cf_known_bot INTEGER,
  cf_country TEXT,
  cf_asn TEXT,
  cf_colo TEXT,
  cf_verified_bot_category TEXT,
  event_group_key TEXT,
  linked_order_id TEXT,
  link_reason TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_received_at ON purchase_events(shop, received_at);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_occurred_at ON purchase_events(shop, occurred_at);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_checkout_token ON purchase_events(shop, checkout_token);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_order_id ON purchase_events(shop, order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_events_shop_linked_order_id ON purchase_events(shop, linked_order_id);

CREATE TABLE IF NOT EXISTS reconcile_state (
  shop TEXT NOT NULL,
  scope TEXT NOT NULL,
  last_success_at BIGINT,
  last_attempt_at BIGINT,
  last_error TEXT,
  cursor_json TEXT,
  PRIMARY KEY (shop, scope)
);

CREATE TABLE IF NOT EXISTS audit_log (
  ts BIGINT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
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
}

module.exports = { up };

