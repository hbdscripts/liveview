/**
 * Phase 0 baseline: run CR-related queries for today, yesterday, 7d.
 * Usage: node scripts/cr-baseline-queries.js
 * Paste the output into docs/CR_FIX_BASELINE.md.
 */

require('dotenv').config();
const { getDb } = require('../server/db');
const config = require('../server/config');
const store = require('../server/store');

getDb();

const timeZone = store.resolveAdminTimeZone();
const now = Date.now();

function bounds(key) {
  return store.getRangeBounds(key, now, timeZone);
}

async function run() {
  const db = getDb();

  const windows = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: 'Last 7 days' },
  ];

  for (const { key, label } of windows) {
    const { start, end } = bounds(key);
    console.log('\n--- ' + label + ' (start=' + start + ' end=' + end + ') ---');

    const sessionsStarted = await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ?',
      [start, end]
    );
    const sessionsLastSeen = await db.get(
      'SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= ? AND last_seen < ?',
      [start, end]
    );
    const purchasedCurrent = await db.get(
      `SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? AND started_at < ? AND has_purchased = 1`,
      [start, end]
    );
    const checkoutEvents = await db.get(
      'SELECT COUNT(*) AS n FROM events WHERE type = ? AND ts >= ? AND ts < ?',
      ['checkout_completed', start, end]
    );

    console.log('sessions_started_in_window: ' + (sessionsStarted?.n ?? 0));
    console.log('sessions_last_seen_in_window: ' + (sessionsLastSeen?.n ?? 0));
    console.log('purchased_sessions_in_window (current logic): ' + (purchasedCurrent?.n ?? 0));
    console.log('checkout_completed_events_in_window: ' + (checkoutEvents?.n ?? 0));
  }

  const { start: start7d, end: end7d } = bounds('7d');
  const duplicateCheckout = await db.all(
    `SELECT session_id, COUNT(*) AS n FROM events
     WHERE type = ? AND ts >= ? AND ts < ?
     GROUP BY session_id HAVING COUNT(*) > 1`,
    ['checkout_completed', start7d, end7d]
  );
  console.log('\n--- Duplicate checkout_completed per session_id (7d window) ---');
  if (duplicateCheckout.length === 0) {
    console.log('(none)');
  } else {
    duplicateCheckout.forEach((r) => console.log(r.session_id + ': ' + r.n + ' events'));
  }

  const sessionCutoff = now - config.sessionTtlMinutes * 60 * 1000;
  const abandonedRetentionMs = config.abandonedRetentionHours * 60 * 60 * 1000;
  const abandonedCutoff = now - abandonedRetentionMs;
  const wouldDelete = await db.get(
    `SELECT COUNT(*) AS n FROM sessions
     WHERE last_seen < ? AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)`,
    [sessionCutoff, abandonedCutoff]
  );
  console.log('\n--- Cleanup (current logic): sessions that would be deleted ---');
  console.log('count: ' + (wouldDelete?.n ?? 0));
  console.log('(SESSION_TTL_MINUTES=' + config.sessionTtlMinutes + ', cutoff last_seen < ' + sessionCutoff + ')');

  console.log('\n--- ADMIN_TIMEZONE ---');
  console.log(timeZone);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
