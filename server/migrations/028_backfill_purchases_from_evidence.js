/**
 * Backfill purchases from purchase_events evidence (one-time).
 *
 * Why: older ingest could insert purchase_events but fail/undercount purchases when checkout_token/order_id
 * were non-strings (e.g. "[object Object]") and purchase_key collisions caused only 1 row.
 *
 * This migration is safe:
 * - INSERT-only (no deletes)
 * - idempotent via a settings flag + ON CONFLICT/IGNORE
 * - purchased_at uses the original occurred_at timestamp (backdated)
 */
const { getDb, isPostgres } = require('../db');
const salesTruth = require('../salesTruth');

const FLAG_KEY = 'backfill_purchases_from_evidence_v1_done_at';

function normalizeCheckoutToken(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
  return s.length > 128 ? s.slice(0, 128) : s;
}

function normalizeOrderId(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t !== 'string' && t !== 'number') return null;
  const extracted = salesTruth.extractNumericId(v);
  const s = extracted != null ? String(extracted).trim() : '';
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
  return s.length > 64 ? s.slice(0, 64) : s;
}

function computePurchaseKeyFromEvidenceRow(row) {
  const token = normalizeCheckoutToken(row.checkout_token);
  const orderId = normalizeOrderId(row.order_id);
  if (token) return 'token:' + token;
  if (orderId) return 'order:' + orderId;
  const occurredAt = row.occurred_at != null ? Number(row.occurred_at) : NaN;
  const ts = Number.isFinite(occurredAt) ? occurredAt : Date.now();
  const bucket15 = Math.floor(ts / 900000);
  const cur = typeof row.currency === 'string' ? row.currency.trim() : '';
  const tot = row.total_price != null ? String(row.total_price) : '';
  const sid = row.session_id != null ? String(row.session_id) : '';
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + bucket15 + '|' + sid).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function getSetting(db, key) {
  try {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
    return row ? row.value : null;
  } catch (_) {
    return null;
  }
}

async function setSetting(db, key, value) {
  try {
    if (isPostgres()) {
      await db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', [key, String(value)]);
    } else {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
    }
  } catch (_) {}
}

async function up() {
  const db = getDb();

  // One-time flag (skip on subsequent startups).
  const existingFlag = await getSetting(db, FLAG_KEY);
  if (existingFlag) return;

  // Ensure required tables exist (fail-open).
  try { await db.get('SELECT 1 FROM purchase_events LIMIT 1'); } catch (_) { return; }
  try { await db.get('SELECT 1 FROM purchases LIMIT 1'); } catch (_) { return; }

  // Backfill recent evidence. (Bounded to avoid heavy startup on large DBs.)
  const now = Date.now();
  const SINCE_DAYS = 120;
  const sinceMs = now - SINCE_DAYS * 24 * 60 * 60 * 1000;

  let rows = [];
  try {
    rows = await db.all(
      `
        SELECT
          pe.occurred_at,
          pe.session_id,
          pe.visitor_id,
          pe.checkout_token,
          pe.order_id,
          pe.currency,
          pe.total_price,
          s.country_code AS session_country
        FROM purchase_events pe
        LEFT JOIN sessions s ON s.session_id = pe.session_id
        WHERE pe.event_type = 'checkout_completed'
          AND pe.occurred_at >= ?
        ORDER BY pe.occurred_at ASC
      `,
      [sinceMs]
    );
  } catch (_) {
    return;
  }

  let inserted = 0;
  for (const r of rows || []) {
    const purchaseKey = computePurchaseKeyFromEvidenceRow(r);
    const sessionId = r.session_id != null ? String(r.session_id).trim() : '';
    if (!sessionId) continue;
    const visitorId = r.visitor_id != null ? String(r.visitor_id).trim() : null;
    const occurredAt = r.occurred_at != null ? Number(r.occurred_at) : NaN;
    const purchasedAt = Number.isFinite(occurredAt) ? occurredAt : now;
    const orderTotal = r.total_price != null ? Number(r.total_price) : null;
    const orderCurrency = typeof r.currency === 'string' && r.currency.trim() ? r.currency.trim() : null;
    const orderId = normalizeOrderId(r.order_id);
    const checkoutToken = normalizeCheckoutToken(r.checkout_token);
    const countryCode = (typeof r.session_country === 'string' && r.session_country.trim()) ? r.session_country.trim().toUpperCase().slice(0, 2) : null;

    try {
      if (isPostgres()) {
        const result = await db.run(
          `
            INSERT INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (purchase_key) DO NOTHING
          `,
          [purchaseKey, sessionId, visitorId, purchasedAt, Number.isFinite(orderTotal) ? orderTotal : null, orderCurrency, orderId, checkoutToken, countryCode]
        );
        inserted += result && result.changes ? Number(result.changes) || 0 : 0;
      } else {
        const result = await db.run(
          `
            INSERT OR IGNORE INTO purchases (purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [purchaseKey, sessionId, visitorId, purchasedAt, Number.isFinite(orderTotal) ? orderTotal : null, orderCurrency, orderId, checkoutToken, countryCode]
        );
        inserted += result && result.changes ? Number(result.changes) || 0 : 0;
      }
    } catch (_) {
      // fail-open: backfill shouldn't block startup
    }
  }

  try {
    console.log('[migrate] backfill purchases from evidence: sinceDays=%s rows=%s inserted=%s', SINCE_DAYS, rows.length || 0, inserted);
  } catch (_) {}

  await setSetting(db, FLAG_KEY, String(now));
}

module.exports = { up };

