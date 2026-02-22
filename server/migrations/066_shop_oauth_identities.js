/**
 * Track Shopify OAuth logins by staff email per shop.
 * This lets Admin → Users show one row per Shopify staff identity instead of one per shop.
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS shop_oauth_identities (
  shop TEXT NOT NULL,
  email TEXT NOT NULL,
  shopify_user_id INTEGER,
  first_oauth_at INTEGER NOT NULL,
  last_oauth_at INTEGER NOT NULL,
  login_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (shop, email)
);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS shop_oauth_identities (
  shop TEXT NOT NULL,
  email TEXT NOT NULL,
  shopify_user_id BIGINT,
  first_oauth_at BIGINT NOT NULL,
  last_oauth_at BIGINT NOT NULL,
  login_count BIGINT NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (shop, email)
);
`;

async function up() {
  const db = getDb();
  if (isPostgres()) {
    await db.run(pgSchema.trim());
  } else {
    await db.exec(sqliteSchema);
  }
}

module.exports = { up };

