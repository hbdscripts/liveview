/**
 * Run a single "daily" backup with retention.
 *
 * Intended for Railway Cron (or manual runs):
 *   node server/runDailyBackup.js
 */
require('dotenv').config();
const { getDb } = require('./db');
const backup = require('./backup');
const { writeAudit } = require('./audit');

async function main() {
  // Open DB early.
  getDb();

  const meta = await backup.backup({
    label: 'daily',
    tables: ['orders_shopify', 'purchases', 'purchase_events', 'sessions'],
    retention: { keep: 7 },
  });

  try {
    await writeAudit('system', 'backup', { when: 'manual_daily_backup', ...meta });
  } catch (_) {}

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, meta }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

