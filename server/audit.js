/**
 * Append-only audit log helper.
 *
 * IMPORTANT: This must fail-open (never break the app if audit_log doesn't exist yet).
 */
const { getDb } = require('./db');

function safeJson(value, maxLen = 20000) {
  try {
    const s = JSON.stringify(value ?? null);
    if (typeof s === 'string' && s.length > maxLen) return s.slice(0, maxLen) + '…';
    return s;
  } catch (_) {
    return null;
  }
}

async function writeAudit(actor, action, details) {
  const db = getDb();
  const ts = Date.now();
  const a = (actor && String(actor).trim()) ? String(actor).trim().slice(0, 64) : 'system';
  const act = (action && String(action).trim()) ? String(action).trim().slice(0, 128) : 'unknown';
  const detailsJson = safeJson(details);
  try {
    await db.run(
      'INSERT INTO audit_log (ts, actor, action, details_json) VALUES (?, ?, ?, ?)',
      [ts, a, act, detailsJson]
    );
  } catch (_) {
    // Fail-open: audit_log may not exist yet (first startup before migration 017).
  }
}

module.exports = { writeAudit };

