/**
 * POST /api/bot-blocked
 * Called by the Cloudflare Worker when it blocks a bot at the edge.
 * Header X-Internal-Secret must match INGEST_SECRET so only our Worker can increment.
 * Increments today's count (admin timezone) so config panel can show "Bots blocked: X".
 */

const config = require('../config');
const store = require('../store');
const { getDb, isPostgres } = require('../db');

let ensuredTable = false;
async function ensureBotBlockCountsTable(db) {
  if (ensuredTable) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS bot_block_counts (
        date TEXT PRIMARY KEY,
        "count" INTEGER NOT NULL DEFAULT 0
      );
    `.trim());
    ensuredTable = true;
  } catch (_) {
    // fail-open: request will surface the insert error
  }
}

function todayDateStr() {
  const timeZone = store.resolveAdminTimeZone();
  const todayBounds = store.getRangeBounds('today', Date.now(), timeZone);
  return new Date(todayBounds.start).toLocaleDateString('en-CA', { timeZone }); // YYYY-MM-DD
}

async function postBotBlocked(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).set('Allow', 'POST').end();
  }

  const secret = (req.get('x-internal-secret') || req.get('X-Internal-Secret') || '').trim();
  if (!secret || secret !== config.ingestSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dateStr = todayDateStr();
  const db = getDb();

  try {
    await ensureBotBlockCountsTable(db);
    if (isPostgres()) {
      await db.run(
        'INSERT INTO bot_block_counts (date, "count") VALUES ($1, 1) ON CONFLICT (date) DO UPDATE SET "count" = bot_block_counts."count" + 1',
        [dateStr]
      );
    } else {
      await db.run(
        'INSERT INTO bot_block_counts (date, "count") VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET "count" = "count" + 1',
        [dateStr]
      );
    }
    return res.status(204).end();
  } catch (err) {
    console.error('[bot-blocked]', err);
    return res.status(500).json({ error: 'Failed to record block' });
  }
}

module.exports = { postBotBlocked };
