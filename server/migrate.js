/**
 * Run migrations. Usage: node server/migrate.js
 */
require('dotenv').config();
const { getDb } = require('./db');
const { up } = require('./migrations/001_initial');

async function main() {
  const db = getDb();
  await up();
  console.log('Migrations complete.');
  db.close?.();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
