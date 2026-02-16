/**
 * Backfill fraud_evaluations from purchase_events evidence (best-effort).
 *
 * Why:
 * - Fraud evaluations are created on ingest checkout_completed.
 * - Some environments have purchase_events (and even purchases) backfilled/reconciled without
 *   running the fraud scorer, which makes the UI show "Fraud scoring unavailable".
 *
 * This job:
 * - Only INSERT/UPSERTs into fraud_evaluations (no deletes).
 * - Runs in small chunks and marks completion in settings.
 * - Fail-open: errors never crash the process.
 */
'use strict';

const { getDb, isPostgres } = require('../db');
const fraudService = require('./service');

const DONE_FLAG_KEY = 'fraud_backfill_evaluations_from_evidence_v1_done_at';
const SINCE_DAYS = 120;
const CHUNK_SIZE = 200;
const MAX_TOTAL = 4000;

let _inFlight = false;

async function tableExists(tableName) {
  try {
    await getDb().get(`SELECT 1 FROM ${tableName} LIMIT 1`);
    return true;
  } catch (_) {
    return false;
  }
}

async function getSetting(key) {
  try {
    const row = await getDb().get('SELECT value FROM settings WHERE key = ? LIMIT 1', [String(key)]);
    return row && row.value != null ? String(row.value) : null;
  } catch (_) {
    return null;
  }
}

async function setSetting(key, value) {
  const k = String(key);
  const v = String(value);
  try {
    if (isPostgres()) {
      await getDb().run(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        [k, v]
      );
    } else {
      await getDb().run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [k, v]);
    }
  } catch (_) {}
}

async function countMissingSince(sinceMs) {
  try {
    const row = await getDb().get(
      `
      SELECT COUNT(*) AS n
      FROM purchase_events pe
      INNER JOIN sessions s ON s.session_id = pe.session_id
      LEFT JOIN fraud_evaluations fe
        ON fe.entity_type = 'session' AND fe.entity_id = pe.session_id
      WHERE pe.event_type = 'checkout_completed'
        AND pe.occurred_at >= ?
        AND fe.eval_id IS NULL
      `,
      [sinceMs]
    );
    return row && row.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    return 0;
  }
}

async function fetchMissingChunkSince(sinceMs, limit) {
  try {
    const rows = await getDb().all(
      `
      SELECT
        pe.id,
        pe.occurred_at,
        pe.received_at,
        pe.session_id,
        pe.checkout_token,
        pe.order_id,
        pe.currency,
        pe.total_price
      FROM purchase_events pe
      INNER JOIN sessions s ON s.session_id = pe.session_id
      LEFT JOIN fraud_evaluations fe
        ON fe.entity_type = 'session' AND fe.entity_id = pe.session_id
      WHERE pe.event_type = 'checkout_completed'
        AND pe.occurred_at >= ?
        AND fe.eval_id IS NULL
      ORDER BY pe.occurred_at DESC, pe.id DESC
      LIMIT ?
      `,
      [sinceMs, Math.max(1, Math.min(2000, Number(limit) || CHUNK_SIZE))]
    );
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function runOnce({ reason = 'startup' } = {}) {
  if (_inFlight) return { ok: true, skipped: true, reason: 'in_flight' };
  _inFlight = true;
  const startedAt = Date.now();

  try {
    // Only run when core tables exist.
    const settingsOk = await tableExists('settings');
    if (!settingsOk) return { ok: false, skipped: true, reason: 'settings_missing' };

    const done = await getSetting(DONE_FLAG_KEY);
    if (done) return { ok: true, skipped: true, reason: 'already_done', done_at: done };

    const tablesOk = await fraudService.tablesOk().catch(() => false);
    if (!tablesOk) return { ok: false, skipped: true, reason: 'fraud_tables_missing' };

    const peOk = await tableExists('purchase_events');
    const sessionsOk = await tableExists('sessions');
    if (!peOk || !sessionsOk) return { ok: false, skipped: true, reason: 'evidence_tables_missing' };

    const sinceMs = Date.now() - SINCE_DAYS * 24 * 60 * 60 * 1000;
    const before = await countMissingSince(sinceMs);
    if (!before) {
      await setSetting(DONE_FLAG_KEY, String(Date.now()));
      return { ok: true, done: true, missing_before: 0, processed: 0, created: 0 };
    }

    let processed = 0;
    let created = 0;

    while (processed < MAX_TOTAL) {
      const chunk = await fetchMissingChunkSince(sinceMs, CHUNK_SIZE);
      if (!chunk.length) break;

      for (const r of chunk) {
        if (processed >= MAX_TOTAL) break;
        const sessionId = r && r.session_id != null ? String(r.session_id).trim() : '';
        if (!sessionId) continue;

        const occurredAt = r && r.occurred_at != null ? Number(r.occurred_at) : NaN;
        const receivedAt = r && r.received_at != null ? Number(r.received_at) : Date.now();

        const payload = {
          ts: Number.isFinite(occurredAt) ? occurredAt : Date.now(),
          event_type: 'checkout_completed',
          checkout_token: r && r.checkout_token != null ? String(r.checkout_token) : null,
          order_id: r && r.order_id != null ? String(r.order_id) : null,
          order_currency: r && r.currency != null ? String(r.currency) : null,
          order_total: r && r.total_price != null ? Number(r.total_price) : null,
        };

        processed += 1;
        const out = await fraudService
          .evaluateCheckoutCompleted({ sessionId, payload, receivedAtMs: Number.isFinite(receivedAt) ? receivedAt : Date.now() })
          .catch(() => null);
        if (out && out.ok) created += 1;
      }

      // Small yield to avoid locking the event loop too long.
      await new Promise((r) => setTimeout(r, 10));
    }

    const after = await countMissingSince(sinceMs);
    const doneNow = after === 0;
    if (doneNow) await setSetting(DONE_FLAG_KEY, String(Date.now()));

    try {
      console.log(
        '[fraud.backfill]',
        'reason=%s sinceDays=%s missingBefore=%s processed=%s created=%s missingAfter=%s elapsedMs=%s',
        String(reason),
        SINCE_DAYS,
        before,
        processed,
        created,
        after,
        Date.now() - startedAt
      );
    } catch (_) {}

    return {
      ok: true,
      done: doneNow,
      missing_before: before,
      missing_after: after,
      processed,
      created,
      elapsed_ms: Date.now() - startedAt,
    };
  } finally {
    _inFlight = false;
  }
}

module.exports = { runOnce };

