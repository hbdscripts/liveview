/**
 * Run migrations. Usage: node server/migrate.js
 */
require('dotenv').config();
const { getDb } = require('./db');
const { up: up001 } = require('./migrations/001_initial');
const { up: up002 } = require('./migrations/002_shop_sessions');
const { up: up003 } = require('./migrations/003_cart_order_money');
const { up: up004 } = require('./migrations/004_session_stats_fields');
const { up: up005 } = require('./migrations/005_utm_campaign');

async function main() {
  const db = getDb();
  await up001();
  await up002();
  await up003();
  await up004();
  await up005();
  console.log('Migrations complete.');
  db.close?.();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
