/**
 * Fraud evaluation service.
 *
 * - Triggered on checkout_completed ingest (and optionally on truth linking).
 * - Stores evaluations in fraud_evaluations (unique per entity_type+entity_id).
 * - Fail-open: if tables are missing or any query fails, do not throw upstream.
 */
const crypto = require('crypto');
const { getDb } = require('../db');
const fraudConfig = require('./config');
const attributionCapture = require('./affiliateAttribution');
const { scoreDeterministic } = require('./scorer');
const aiNarrative = require('./aiNarrative');

let _tablesOk = null; // null unknown, true ok, false missing/unknown
let _tablesOkAt = 0;
const TABLES_OK_NEGATIVE_TTL_MS = 30 * 1000;
let _aiInFlightBySession = new Map();

function trimStr(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

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
  const s = String(v).trim();
  if (!s) return null;
  const extracted = (function extractNumericId(raw) {
    const ss = String(raw == null ? '' : raw).trim();
    if (!ss) return null;
    const m = ss.match(/(\d{6,})/);
    return m ? m[1] : null;
  })(s);
  const out = extracted || s;
  const low = out.toLowerCase();
  if (low === 'null' || low === 'undefined' || low === 'true' || low === 'false' || low === '[object object]') return null;
  return out.length > 64 ? out.slice(0, 64) : out;
}

function computeFallbackEntityId({ sessionId, occurredAtMs, orderCurrency, orderTotal } = {}) {
  const ts = typeof occurredAtMs === 'number' && Number.isFinite(occurredAtMs) ? occurredAtMs : Date.now();
  const bucket15 = Math.floor(ts / (15 * 60 * 1000));
  const cur = typeof orderCurrency === 'string' ? orderCurrency.trim() : '';
  const tot = orderTotal != null ? String(orderTotal) : '';
  const sid = typeof sessionId === 'string' ? sessionId : String(sessionId || '');
  const hash = crypto.createHash('sha256').update(cur + '|' + tot + '|' + bucket15 + '|' + sid).digest('hex').slice(0, 32);
  return 'h:' + hash;
}

async function tablesOk() {
  const now = Date.now();
  if (_tablesOk === true) return true;
  if (_tablesOk === false && _tablesOkAt && (now - _tablesOkAt) >= 0 && (now - _tablesOkAt) < TABLES_OK_NEGATIVE_TTL_MS) {
    return false;
  }
  try {
    await getDb().get('SELECT 1 FROM fraud_evaluations LIMIT 1');
    await getDb().get('SELECT 1 FROM affiliate_attribution_sessions LIMIT 1');
    _tablesOk = true;
    _tablesOkAt = now;
    return true;
  } catch (_) {
    _tablesOk = false;
    _tablesOkAt = now;
    return false;
  }
}

async function getSessionRow(sessionId) {
  return getDb().get('SELECT * FROM sessions WHERE session_id = ? LIMIT 1', [sessionId]);
}

async function getAttributionRow(sessionId) {
  return getDb().get('SELECT * FROM affiliate_attribution_sessions WHERE session_id = ? LIMIT 1', [sessionId]);
}

async function getEventSummary(sessionId) {
  const row = await getDb().get(
    `
    SELECT
      COUNT(*) AS total_events,
      SUM(CASE WHEN type = 'page_viewed' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN type = 'product_viewed' THEN 1 ELSE 0 END) AS product_views,
      SUM(CASE WHEN type = 'product_added_to_cart' THEN 1 ELSE 0 END) AS add_to_cart,
      MIN(ts) AS first_event_at,
      MAX(ts) AS last_event_at,
      MIN(CASE WHEN type = 'checkout_started' THEN ts END) AS checkout_started_at
    FROM events
    WHERE session_id = ?
    `,
    [sessionId]
  );
  return row || {
    total_events: 0,
    page_views: 0,
    product_views: 0,
    add_to_cart: 0,
    first_event_at: null,
    last_event_at: null,
    checkout_started_at: null,
  };
}

async function countTriggeredByIp(ipHash, sinceMs) {
  if (!ipHash) return 0;
  const row = await getDb().get(
    'SELECT COUNT(*) AS n FROM fraud_evaluations WHERE triggered = 1 AND ip_hash = ? AND created_at >= ?',
    [ipHash, sinceMs]
  );
  return row ? Number(row.n) || 0 : 0;
}

async function upsertEvaluation(e) {
  const db = getDb();
  const now = Date.now();
  const createdAt = typeof e.created_at === 'number' && Number.isFinite(e.created_at) ? Math.trunc(e.created_at) : now;
  const updatedAt = typeof e.updated_at === 'number' && Number.isFinite(e.updated_at) ? Math.trunc(e.updated_at) : now;
  const flagsJson = typeof e.flags_json === 'string' ? e.flags_json : JSON.stringify(Array.isArray(e.flags) ? e.flags : []);
  const evidenceJson = typeof e.evidence_json === 'string' ? e.evidence_json : (e.evidence != null ? JSON.stringify(e.evidence) : null);
  const triggered = e.triggered ? 1 : 0;

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
      ip_hash = COALESCE(EXCLUDED.ip_hash, fraud_evaluations.ip_hash),
      affiliate_network_hint = COALESCE(EXCLUDED.affiliate_network_hint, fraud_evaluations.affiliate_network_hint),
      affiliate_id_hint = COALESCE(EXCLUDED.affiliate_id_hint, fraud_evaluations.affiliate_id_hint)
    `,
    [
      createdAt,
      updatedAt,
      e.entity_type,
      e.entity_id,
      e.session_id || null,
      e.visitor_id || null,
      e.order_id || null,
      e.checkout_token || null,
      Math.max(0, Math.min(100, Math.trunc(Number(e.score) || 0))),
      triggered,
      flagsJson,
      evidenceJson,
      e.ai_summary || null,
      e.ai_model || null,
      e.ai_version || null,
      e.resolved_status || 'open',
      e.resolved_by || null,
      e.resolved_note || null,
      e.ip_hash || null,
      e.affiliate_network_hint || null,
      e.affiliate_id_hint || null,
    ]
  );
}

async function updateAiSummaryForSession(sessionId, { ai, ai_model, ai_version } = {}) {
  if (!sessionId || !ai || !ai.summary) return;
  const db = getDb();
  const now = Date.now();
  const summary = String(ai.summary || '').trim();
  if (!summary) return;
  await db.run(
    `
    UPDATE fraud_evaluations
    SET ai_summary = COALESCE(ai_summary, ?),
        ai_model = COALESCE(ai_model, ?),
        ai_version = COALESCE(ai_version, ?),
        updated_at = ?
    WHERE session_id = ? AND (ai_summary IS NULL OR ai_summary = '')
    `,
    [summary, ai_model || null, ai_version || null, now, sessionId]
  );
}

function buildSyntheticAttributionFromSession(sessionRow, cfg) {
  const s = sessionRow || {};
  const known = cfg && cfg.known ? cfg.known : {};
  const keepParams = Array.from(new Set([...(known.paidClickIdParams || []), ...(known.affiliateClickIdParams || []), 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']));
  const entry = typeof s.entry_url === 'string' ? s.entry_url : '';
  const ref = typeof s.referrer === 'string' ? s.referrer : '';
  const params = attributionCapture.safeUrlParams(entry);
  const paid = {};
  const aff = {};
  (known.paidClickIdParams || []).forEach((k) => {
    const kk = String(k || '').trim().toLowerCase();
    if (!kk || !params) return;
    try { const v = params.get(kk); if (v) paid[kk] = String(v).slice(0, 256); } catch (_) {}
  });
  (known.affiliateClickIdParams || []).forEach((k) => {
    const kk = String(k || '').trim().toLowerCase();
    if (!kk || !params) return;
    try { const v = params.get(kk); if (v) aff[kk] = String(v).slice(0, 256); } catch (_) {}
  });
  return {
    session_id: s.session_id,
    visitor_id: s.visitor_id,
    source_kind: 'unknown',
    utm_source: s.utm_source || null,
    utm_medium: s.utm_medium || null,
    utm_campaign: s.utm_campaign || null,
    utm_content: s.utm_content || null,
    utm_term: null,
    paid_click_ids_json: Object.keys(paid).length ? JSON.stringify(paid) : null,
    affiliate_click_ids_json: Object.keys(aff).length ? JSON.stringify(aff) : null,
    affiliate_network_hint: null,
    affiliate_id_hint: null,
    landing_url: attributionCapture.sanitizeUrlForEvidence(entry, keepParams),
    referrer: attributionCapture.sanitizeUrlForEvidence(ref, keepParams),
    ip_hash: null,
    ua_hash: null,
    last_seen_at: null,
    last_seen_json: null,
  };
}

async function evaluateCheckoutCompleted({
  sessionId,
  payload,
  receivedAtMs = Date.now(),
} = {}) {
  if (!sessionId) return { ok: false, skipped: true };
  if (!(await tablesOk())) return { ok: false, skipped: true };

  const cfg = await fraudConfig.readFraudConfig({ allowCache: true }).then((r) => r.config).catch(() => fraudConfig.defaultFraudConfigV1());

  const occurredAtMs = (payload && payload.ts != null && Number.isFinite(Number(payload.ts))) ? Number(payload.ts) : receivedAtMs;
  const checkoutToken = normalizeCheckoutToken(payload && payload.checkout_token);
  const orderId = normalizeOrderId(payload && payload.order_id);
  const orderCurrency = trimStr(payload && payload.order_currency, 16);
  const orderTotal = payload && payload.order_total != null ? Number(payload.order_total) : null;

  const session = await getSessionRow(sessionId);
  if (!session) return { ok: false, skipped: true };

  let attribution = await getAttributionRow(sessionId);
  if (!attribution) attribution = buildSyntheticAttributionFromSession(session, cfg);

  const eventSummary = await getEventSummary(sessionId);

  // Duplicate IP pattern (computed via indexed lookup).
  const ipHash = attribution && attribution.ip_hash ? String(attribution.ip_hash) : null;
  const dup = cfg && cfg.duplicateIp ? cfg.duplicateIp : {};
  const windowHours = Number.isFinite(Number(dup.windowHours)) ? Number(dup.windowHours) : 6;
  const minTriggered = Number.isFinite(Number(dup.minTriggered)) ? Number(dup.minTriggered) : 3;
  let extraFlags = [];
  let dupTriggeredCount = null;
  if (ipHash) {
    const since = occurredAtMs - (windowHours * 60 * 60 * 1000);
    const n = await countTriggeredByIp(ipHash, since);
    dupTriggeredCount = n;
    if (n >= minTriggered) extraFlags.push('duplicate_ip_pattern');
  }

  const checkoutCtx = {
    occurred_at: occurredAtMs,
    checkout_token: checkoutToken,
    order_id: orderId,
    order_total: Number.isFinite(Number(orderTotal)) ? Number(orderTotal) : null,
    order_currency: orderCurrency || null,
    ip_hash: ipHash || null,
  };

  const scored = scoreDeterministic({
    cfg,
    session,
    attribution,
    checkout: checkoutCtx,
    eventSummary,
    extraFlags,
  });
  try {
    if (scored && scored.evidence && typeof scored.evidence === 'object' && dupTriggeredCount != null) {
      if (!scored.evidence.signals || typeof scored.evidence.signals !== 'object') scored.evidence.signals = {};
      scored.evidence.signals.duplicate_ip_triggered_recent = dupTriggeredCount;
      scored.evidence.signals.duplicate_ip_window_hours = windowHours;
    }
  } catch (_) {}

  const now = Date.now();
  const flagsJson = JSON.stringify(scored.flags || []);
  const evidenceJson = JSON.stringify(scored.evidence || null);

  const common = {
    created_at: occurredAtMs,
    updated_at: now,
    session_id: sessionId,
    visitor_id: session.visitor_id || attribution.visitor_id || null,
    order_id: orderId || null,
    checkout_token: checkoutToken || null,
    score: scored.score,
    triggered: scored.triggered ? 1 : 0,
    flags_json: flagsJson,
    evidence_json: evidenceJson,
    ip_hash: ipHash,
    affiliate_network_hint: attribution && attribution.affiliate_network_hint ? String(attribution.affiliate_network_hint) : null,
    affiliate_id_hint: attribution && attribution.affiliate_id_hint ? String(attribution.affiliate_id_hint) : null,
  };

  // Session evaluation (used by sessions table icon + modal).
  await upsertEvaluation({
    ...common,
    entity_type: 'session',
    entity_id: String(sessionId),
  });

  // Purchase evaluation (checkout_token/order_id/h: fallback).
  const purchaseEntityId = checkoutToken || orderId || computeFallbackEntityId({
    sessionId,
    occurredAtMs,
    orderCurrency,
    orderTotal,
  });
  await upsertEvaluation({
    ...common,
    entity_type: 'purchase',
    entity_id: String(purchaseEntityId),
  });

  // Order evaluation if order_id is known at checkout time.
  if (orderId) {
    await upsertEvaluation({
      ...common,
      entity_type: 'order',
      entity_id: String(orderId),
    });
  }

  // AI narrative generation (optional, async, only for triggered).
  try {
    const aiEnabled = !!(cfg && cfg.ai && cfg.ai.enabled === true);
    if (scored.triggered && aiEnabled && !_aiInFlightBySession.has(sessionId)) {
      const p = aiNarrative.generateAiSummary({ score: scored.score, flags: scored.flags, evidence: scored.evidence, fraudCfg: cfg })
        .then(async (r) => {
          if (r && r.ok && r.ai && r.ai.summary) {
            await updateAiSummaryForSession(sessionId, r);
          }
        })
        .catch(() => {})
        .finally(() => {
          _aiInFlightBySession.delete(sessionId);
        });
      _aiInFlightBySession.set(sessionId, p);
    }
  } catch (_) {}

  return { ok: true, score: scored.score, triggered: scored.triggered, flags: scored.flags || [] };
}

module.exports = {
  tablesOk,
  evaluateCheckoutCompleted,
  upsertEvaluation,
  updateAiSummaryForSession,
  normalizeCheckoutToken,
  normalizeOrderId,
};

