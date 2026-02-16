/**
 * Link Shopify truth orders -> existing fraud evaluations.
 *
 * Keep this module DB-only (no dependency on salesTruth/store) to avoid require cycles.
 */
const { getDb } = require('../db');

let _tablesOk = null;
let _tablesOkAt = 0;
const TABLES_OK_NEGATIVE_TTL_MS = 30 * 1000;

async function tablesOk() {
  const now = Date.now();
  if (_tablesOk === true) return true;
  if (_tablesOk === false && _tablesOkAt && (now - _tablesOkAt) >= 0 && (now - _tablesOkAt) < TABLES_OK_NEGATIVE_TTL_MS) return false;
  try {
    await getDb().get('SELECT 1 FROM fraud_evaluations LIMIT 1');
    _tablesOk = true;
    _tablesOkAt = now;
    return true;
  } catch (_) {
    _tablesOk = false;
    _tablesOkAt = now;
    return false;
  }
}

function trimStr(v, maxLen) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

async function linkOrderIdToCheckoutToken({ orderId, checkoutToken } = {}) {
  if (!(await tablesOk())) return { ok: false, skipped: true };
  const oid = trimStr(orderId, 64);
  const tok = trimStr(checkoutToken, 128);
  if (!oid || !tok) return { ok: false, skipped: true };
  const now = Date.now();
  let linked = 0;
  try {
    const r = await getDb().run(
      `
      UPDATE fraud_evaluations
      SET order_id = COALESCE(order_id, ?),
          updated_at = ?
      WHERE checkout_token = ? AND (order_id IS NULL OR order_id = '')
      `,
      [oid, now, tok]
    );
    linked = r && r.changes ? Number(r.changes) : 0;
  } catch (_) {
    linked = 0;
  }
  return { ok: true, linked };
}

async function ensureOrderEntityEvaluation({ orderId, checkoutToken } = {}) {
  if (!(await tablesOk())) return { ok: false, skipped: true };
  const oid = trimStr(orderId, 64);
  const tok = trimStr(checkoutToken, 128);
  if (!oid || !tok) return { ok: false, skipped: true };

  const db = getDb();
  const existingOrder = await db.get(
    'SELECT eval_id FROM fraud_evaluations WHERE entity_type = ? AND entity_id = ? LIMIT 1',
    ['order', oid]
  );
  if (existingOrder && existingOrder.eval_id) return { ok: true, created: false };

  // Copy best available evaluation linked by checkout_token (prefer purchase).
  const src = await db.get(
    `
    SELECT * FROM fraud_evaluations
    WHERE checkout_token = ?
    ORDER BY
      CASE WHEN entity_type = 'purchase' THEN 0 ELSE 1 END,
      triggered DESC,
      score DESC,
      updated_at DESC
    LIMIT 1
    `,
    [tok]
  );
  if (!src) return { ok: false, skipped: true };

  const now = Date.now();
  await db.run(
    `
    INSERT INTO fraud_evaluations
      (created_at, updated_at, entity_type, entity_id, session_id, visitor_id, order_id, checkout_token,
       score, triggered, flags_json, evidence_json, ai_summary, ai_model, ai_version,
       resolved_status, resolved_by, resolved_note, ip_hash, affiliate_network_hint, affiliate_id_hint)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?, ?)
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      updated_at = EXCLUDED.updated_at,
      session_id = COALESCE(EXCLUDED.session_id, fraud_evaluations.session_id),
      visitor_id = COALESCE(EXCLUDED.visitor_id, fraud_evaluations.visitor_id),
      order_id = COALESCE(EXCLUDED.order_id, fraud_evaluations.order_id),
      checkout_token = COALESCE(EXCLUDED.checkout_token, fraud_evaluations.checkout_token),
      score = EXCLUDED.score,
      triggered = EXCLUDED.triggered,
      flags_json = EXCLUDED.flags_json,
      evidence_json = EXCLUDED.evidence_json,
      ai_summary = COALESCE(fraud_evaluations.ai_summary, EXCLUDED.ai_summary),
      ai_model = COALESCE(fraud_evaluations.ai_model, EXCLUDED.ai_model),
      ai_version = COALESCE(fraud_evaluations.ai_version, EXCLUDED.ai_version),
      ip_hash = COALESCE(EXCLUDED.ip_hash, fraud_evaluations.ip_hash),
      affiliate_network_hint = COALESCE(EXCLUDED.affiliate_network_hint, fraud_evaluations.affiliate_network_hint),
      affiliate_id_hint = COALESCE(EXCLUDED.affiliate_id_hint, fraud_evaluations.affiliate_id_hint)
    `,
    [
      src.created_at != null ? Number(src.created_at) : now,
      now,
      'order',
      oid,
      src.session_id || null,
      src.visitor_id || null,
      oid,
      tok,
      src.score != null ? Number(src.score) : 0,
      src.triggered != null ? Number(src.triggered) : 0,
      src.flags_json || '[]',
      src.evidence_json || null,
      src.ai_summary || null,
      src.ai_model || null,
      src.ai_version || null,
      src.resolved_status || 'open',
      src.resolved_by || null,
      src.resolved_note || null,
      src.ip_hash || null,
      src.affiliate_network_hint || null,
      src.affiliate_id_hint || null,
    ]
  );
  return { ok: true, created: true };
}

async function linkOrderFromTruthOrder({ orderId, checkoutToken } = {}) {
  const oid = trimStr(orderId, 64);
  const tok = trimStr(checkoutToken, 128);
  if (!oid || !tok) return { ok: false, skipped: true };
  const a = await linkOrderIdToCheckoutToken({ orderId: oid, checkoutToken: tok });
  const b = await ensureOrderEntityEvaluation({ orderId: oid, checkoutToken: tok });
  return { ok: true, linked: a && a.linked ? a.linked : 0, ensuredOrderEval: !!(b && b.ok) };
}

module.exports = {
  tablesOk,
  linkOrderIdToCheckoutToken,
  ensureOrderEntityEvaluation,
  linkOrderFromTruthOrder,
};

