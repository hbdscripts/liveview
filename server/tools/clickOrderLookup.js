'use strict';

const Sentry = require('@sentry/node');
const { getDb } = require('../db');
const salesTruth = require('../salesTruth');
const fraudCfg = require('../fraud/config');
const fraudService = require('../fraud/service');
const aiNarrative = require('../fraud/aiNarrative');

function safeStr(v, maxLen = 256) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeJsonParse(raw, fallback) {
  try {
    if (raw == null) return fallback;
    const s = String(raw || '').trim();
    if (!s) return fallback;
    return JSON.parse(s);
  } catch (_) {
    return fallback;
  }
}

function isUuid(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function parsePurchaseKey(v) {
  const s = safeStr(v, 256);
  const low = s.toLowerCase();
  if (low.startsWith('token:')) {
    const token = safeStr(s.slice(6), 128);
    return { purchase_key: s, kind: 'token', checkout_token: token || null, order_id: null };
  }
  if (low.startsWith('order:')) {
    const oid = safeStr(s.slice(6), 64);
    const extracted = salesTruth.extractNumericId(oid);
    return { purchase_key: s, kind: 'order', checkout_token: null, order_id: extracted || oid || null };
  }
  if (low.startsWith('h:')) {
    return { purchase_key: s, kind: 'hash', checkout_token: null, order_id: null };
  }
  return null;
}

function extractOrderId(v) {
  const s = safeStr(v, 256);
  if (!s) return '';
  const extracted = salesTruth.extractNumericId(s);
  return extracted || '';
}

function looksLikeCheckoutToken(v) {
  const s = safeStr(v, 256);
  if (!s) return false;
  if (isUuid(s)) return false;
  if (parsePurchaseKey(s)) return false;
  if (/^\d+$/.test(s)) return false;
  // Shopify checkout tokens are typically short-ish and URL-safe.
  if (s.length < 6 || s.length > 128) return false;
  return /^[a-z0-9._:-]+$/i.test(s);
}

async function getSessionById(sessionId) {
  const sid = safeStr(sessionId, 128);
  if (!sid) return null;
  const db = getDb();
  // Avoid column name collisions by selecting explicit visitor fields.
  return db.get(
    `
    SELECT
      s.*,
      v.device AS device,
      v.returning_count AS returning_count
    FROM sessions s
    LEFT JOIN visitors v ON v.visitor_id = s.visitor_id
    WHERE s.session_id = ?
    LIMIT 1
    `,
    [sid]
  );
}

async function getSessionEventsBySessionId(sessionId, limit = 20) {
  const sid = safeStr(sessionId, 128);
  if (!sid) return [];
  const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.trunc(Number(limit)))) : 20;
  const db = getDb();
  const rows = await db.all(
    `
    SELECT id, session_id, ts, type, path, product_handle, qty_delta, cart_qty, checkout_state_json, meta_json
    FROM events
    WHERE session_id = ?
    ORDER BY ts DESC
    LIMIT ?
    `,
    [sid, n]
  );
  return (Array.isArray(rows) ? rows : []).reverse().map((r) => ({
    ...r,
    ts: r && r.ts != null ? Number(r.ts) : null,
  }));
}

async function getPurchasesBySession(sessionId, limit = 20) {
  const sid = safeStr(sessionId, 128);
  if (!sid) return [];
  const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.trunc(Number(limit)))) : 20;
  const db = getDb();
  const rows = await db.all(
    `
    SELECT purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code
    FROM purchases
    WHERE session_id = ?
    ORDER BY purchased_at DESC
    LIMIT ?
    `,
    [sid, n]
  );
  return Array.isArray(rows) ? rows : [];
}

async function getPurchaseByKey(purchaseKey) {
  const pk = safeStr(purchaseKey, 256);
  if (!pk) return null;
  const db = getDb();
  return db.get(
    `
    SELECT purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code
    FROM purchases
    WHERE purchase_key = ?
    LIMIT 1
    `,
    [pk]
  );
}

async function getPurchasesByOrderId(orderId, limit = 10) {
  const oid = safeStr(orderId, 64);
  if (!oid) return [];
  const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.trunc(Number(limit)))) : 10;
  const db = getDb();
  // Note: purchases.order_id is not indexed; keep LIMIT small.
  const rows = await db.all(
    `
    SELECT purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code
    FROM purchases
    WHERE order_id = ?
    ORDER BY purchased_at DESC
    LIMIT ?
    `,
    [oid, n]
  );
  return Array.isArray(rows) ? rows : [];
}

async function getPurchasesByCheckoutToken(checkoutToken, limit = 10) {
  const token = safeStr(checkoutToken, 128);
  if (!token) return [];
  const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.trunc(Number(limit)))) : 10;
  const db = getDb();
  // Note: purchases.checkout_token is not indexed; keep LIMIT small.
  const rows = await db.all(
    `
    SELECT purchase_key, session_id, visitor_id, purchased_at, order_total, order_currency, order_id, checkout_token, country_code
    FROM purchases
    WHERE checkout_token = ?
    ORDER BY purchased_at DESC
    LIMIT ?
    `,
    [token, n]
  );
  return Array.isArray(rows) ? rows : [];
}

async function getAttributionBySession(sessionId) {
  const sid = safeStr(sessionId, 128);
  if (!sid) return null;
  const db = getDb();
  const row = await db.get('SELECT * FROM affiliate_attribution_sessions WHERE session_id = ? LIMIT 1', [sid]);
  if (!row) return null;
  return {
    ...row,
    paid_click_ids: safeJsonParse(row.paid_click_ids_json, null),
    affiliate_click_ids: safeJsonParse(row.affiliate_click_ids_json, null),
    last_seen: safeJsonParse(row.last_seen_json, null),
    // Keep raw JSON fields too for debugging.
  };
}

async function getTruthOrderByOrderId(shop, orderId) {
  const safeShop = safeStr(shop, 255);
  const oid = safeStr(orderId, 64);
  if (!safeShop || !oid) return null;
  const db = getDb();
  const row = await db.get(
    `
    SELECT
      shop, order_id, order_name, created_at, processed_at, financial_status, cancelled_at, test,
      currency, total_price, subtotal_price, total_tax, total_discounts, total_shipping,
      customer_id, checkout_token, updated_at, synced_at
    FROM orders_shopify
    WHERE shop = ? AND order_id = ?
    LIMIT 1
    `,
    [safeShop, oid]
  );
  return row || null;
}

async function getTruthOrderByCheckoutToken(shop, checkoutToken) {
  const safeShop = safeStr(shop, 255);
  const token = safeStr(checkoutToken, 128);
  if (!safeShop || !token) return null;
  const db = getDb();
  const row = await db.get(
    `
    SELECT
      shop, order_id, order_name, created_at, processed_at, financial_status, cancelled_at, test,
      currency, total_price, subtotal_price, total_tax, total_discounts, total_shipping,
      customer_id, checkout_token, updated_at, synced_at
    FROM orders_shopify
    WHERE shop = ? AND checkout_token = ?
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [safeShop, token]
  );
  return row || null;
}

async function getPurchaseEventsByOrderId(shop, orderId, limit = 10) {
  const safeShop = safeStr(shop, 255);
  const oid = safeStr(orderId, 64);
  if (!safeShop || !oid) return [];
  const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.trunc(Number(limit)))) : 10;
  const db = getDb();
  const rows = await db.all(
    `
    SELECT
      id, shop, occurred_at, received_at, event_type, visitor_id, session_id,
      page_url, referrer, checkout_token, order_id, currency, total_price,
      cf_known_bot, cf_country, cf_asn, cf_colo, cf_verified_bot_category,
      event_group_key, linked_order_id, link_reason
    FROM purchase_events
    WHERE shop = ? AND order_id = ?
    ORDER BY occurred_at DESC, received_at DESC
    LIMIT ?
    `,
    [safeShop, oid, n]
  );
  return Array.isArray(rows) ? rows : [];
}

async function getPurchaseEventsByCheckoutToken(shop, checkoutToken, limit = 10) {
  const safeShop = safeStr(shop, 255);
  const token = safeStr(checkoutToken, 128);
  if (!safeShop || !token) return [];
  const n = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(50, Math.trunc(Number(limit)))) : 10;
  const db = getDb();
  const rows = await db.all(
    `
    SELECT
      id, shop, occurred_at, received_at, event_type, visitor_id, session_id,
      page_url, referrer, checkout_token, order_id, currency, total_price,
      cf_known_bot, cf_country, cf_asn, cf_colo, cf_verified_bot_category,
      event_group_key, linked_order_id, link_reason
    FROM purchase_events
    WHERE shop = ? AND checkout_token = ?
    ORDER BY occurred_at DESC, received_at DESC
    LIMIT ?
    `,
    [safeShop, token, n]
  );
  return Array.isArray(rows) ? rows : [];
}

function normalizeFraudRow(row, threshold) {
  const flags = Array.isArray(safeJsonParse(row.flags_json, [])) ? safeJsonParse(row.flags_json, []) : [];
  const evidence = safeJsonParse(row.evidence_json, {});
  const aiSummary = row.ai_summary != null ? String(row.ai_summary) : '';
  const aiUsed = !!(aiSummary && aiSummary.trim());
  const deterministic = aiNarrative.buildDeterministicSummary({ score: row.score, flags, threshold });
  const analysis = aiUsed
    ? { ...deterministic, summary: aiSummary.trim(), ai_used: true }
    : { ...deterministic, ai_used: false };
  return {
    evaluation: {
      eval_id: row.eval_id,
      created_at: row.created_at != null ? Number(row.created_at) : null,
      updated_at: row.updated_at != null ? Number(row.updated_at) : null,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      score: row.score != null ? Math.max(0, Math.min(100, Math.trunc(Number(row.score) || 0))) : 0,
      triggered: Number(row.triggered) === 1,
      flags,
      evidence: evidence && typeof evidence === 'object' ? evidence : {},
      ai_summary: aiUsed ? aiSummary.trim() : null,
      ai_model: row.ai_model || null,
      ai_version: row.ai_version || null,
      resolved_status: row.resolved_status || 'open',
      resolved_by: row.resolved_by || null,
      resolved_note: row.resolved_note || null,
      ip_hash: row.ip_hash || null,
      affiliate_network_hint: row.affiliate_network_hint || null,
      affiliate_id_hint: row.affiliate_id_hint || null,
    },
    analysis,
    links: {
      session_id: row.session_id || null,
      order_id: row.order_id || null,
      checkout_token: row.checkout_token || null,
    },
  };
}

async function getFraudRowByEntity(entityType, entityId) {
  const et = safeStr(entityType, 16).toLowerCase();
  const eid = safeStr(entityId, 256);
  if (!et || !eid) return null;
  const db = getDb();
  return db.get('SELECT * FROM fraud_evaluations WHERE entity_type = ? AND entity_id = ? LIMIT 1', [et, eid]);
}

async function getFraudRowByOrderId(orderId) {
  const oid = safeStr(orderId, 64);
  if (!oid) return null;
  const db = getDb();
  return db.get(
    `
    SELECT * FROM fraud_evaluations
    WHERE order_id = ?
    ORDER BY triggered DESC, updated_at DESC
    LIMIT 1
    `,
    [oid]
  );
}

async function getFraudRowByCheckoutToken(checkoutToken) {
  const token = safeStr(checkoutToken, 128);
  if (!token) return null;
  const db = getDb();
  return db.get(
    `
    SELECT * FROM fraud_evaluations
    WHERE checkout_token = ?
    ORDER BY triggered DESC, updated_at DESC
    LIMIT 1
    `,
    [token]
  );
}

async function maybeKickAiSummary(row, cfg, threshold) {
  try {
    if (!row) return;
    const aiEnabled = !!(cfg && cfg.ai && cfg.ai.enabled === true);
    if (!aiEnabled) return;
    if (Number(row.triggered) !== 1) return;
    if (!row.session_id) return;
    const hasAi = row.ai_summary != null && String(row.ai_summary || '').trim() !== '';
    if (hasAi) return;

    const flags = Array.isArray(safeJsonParse(row.flags_json, [])) ? safeJsonParse(row.flags_json, []) : [];
    const evidence = safeJsonParse(row.evidence_json, {});
    aiNarrative.generateAiSummary({ score: row.score, flags, evidence, fraudCfg: cfg })
      .then((r) => fraudService.updateAiSummaryForSession(String(row.session_id), r))
      .catch(() => {});
  } catch (_) {}
}

async function getFraudBundle({ sessionId, orderId, checkoutToken, purchaseKey, shop } = {}) {
  const ok = await fraudService.tablesOk().catch(() => false);
  if (!ok) return { ok: false, available: false };

  const cfg = await fraudCfg.readFraudConfig({ allowCache: true }).then((r) => r.config).catch(() => fraudCfg.defaultFraudConfigV1());
  const threshold = cfg && Number.isFinite(Number(cfg.threshold)) ? Number(cfg.threshold) : 70;

  const out = {
    ok: true,
    available: true,
    threshold,
    session: null,
    purchase: null,
    order: null,
  };

  const sid = safeStr(sessionId, 128);
  const oid = safeStr(orderId, 64);
  const token = safeStr(checkoutToken, 128);
  const pk = safeStr(purchaseKey, 256);

  const sessionRow = sid ? await getFraudRowByEntity('session', sid) : null;
  const orderRow = oid ? await getFraudRowByEntity('order', oid) : null;

  // Purchase rows: entity_id might be checkout_token, order_id, or h: hash. Also accept purchase_key variations.
  const purchaseCandidates = [];
  if (token) purchaseCandidates.push(token);
  if (oid) purchaseCandidates.push(oid);
  if (pk) {
    purchaseCandidates.push(pk);
    const parsed = parsePurchaseKey(pk);
    if (parsed && parsed.checkout_token) purchaseCandidates.push(parsed.checkout_token);
    if (parsed && parsed.order_id) purchaseCandidates.push(parsed.order_id);
  }
  const uniq = Array.from(new Set(purchaseCandidates.map((x) => String(x)).filter(Boolean))).slice(0, 6);
  let purchaseRow = null;
  if (uniq.length) {
    const ph = '(' + uniq.map(() => '?').join(',') + ')';
    try {
      purchaseRow = await getDb().get(
        `
        SELECT * FROM fraud_evaluations
        WHERE entity_type = 'purchase' AND entity_id IN ${ph}
        ORDER BY triggered DESC, updated_at DESC
        LIMIT 1
        `,
        uniq
      );
    } catch (_) {
      purchaseRow = null;
    }
  }

  if (sessionRow) { out.session = normalizeFraudRow(sessionRow, threshold); maybeKickAiSummary(sessionRow, cfg, threshold); }
  if (purchaseRow) { out.purchase = normalizeFraudRow(purchaseRow, threshold); maybeKickAiSummary(purchaseRow, cfg, threshold); }
  if (orderRow) { out.order = normalizeFraudRow(orderRow, threshold); maybeKickAiSummary(orderRow, cfg, threshold); }

  // If orderId is missing but token exists, try to find an order eval by order_id column.
  if (!out.order && oid) {
    const r = await getFraudRowByOrderId(oid).catch(() => null);
    if (r) { out.order = normalizeFraudRow(r, threshold); maybeKickAiSummary(r, cfg, threshold); }
  }

  // If session is missing but we have token/order, try to discover a related row.
  if (!out.session && (oid || token)) {
    const r = token
      ? await getFraudRowByCheckoutToken(token).catch(() => null)
      : await getFraudRowByOrderId(oid).catch(() => null);
    if (r) { out.session = normalizeFraudRow(r, threshold); maybeKickAiSummary(r, cfg, threshold); }
  }

  return out;
}

async function lookup({ q, shop } = {}) {
  const rawQ = safeStr(q, 256);
  if (!rawQ) return { ok: false, error: 'missing_q' };

  const safeShop = salesTruth.resolveShopForSales(safeStr(shop, 255)) || '';

  const resolved = {
    kind: '',
    session_id: null,
    visitor_id: null,
    purchase_key: null,
    checkout_token: null,
    order_id: null,
  };

  let session = null;
  let purchases = [];
  let purchase = null;
  let attribution = null;
  let truthOrder = null;
  let purchaseEvents = [];
  let events = [];

  try {
    // 1) Direct session id lookup (fast, indexed).
    session = await getSessionById(rawQ);
    if (session) {
      resolved.kind = isUuid(rawQ) ? 'session_uuid' : 'session_id';
      resolved.session_id = String(session.session_id);
      resolved.visitor_id = session.visitor_id != null ? String(session.visitor_id) : null;
    }

    // 2) Purchase key lookup (fast, PK).
    const pkParsed = parsePurchaseKey(rawQ);
    if (!session) {
      purchase = pkParsed ? await getPurchaseByKey(pkParsed.purchase_key) : null;
      if (purchase) {
        resolved.kind = 'purchase_key';
        resolved.purchase_key = String(purchase.purchase_key);
        resolved.session_id = purchase.session_id != null ? String(purchase.session_id) : null;
        resolved.visitor_id = purchase.visitor_id != null ? String(purchase.visitor_id) : null;
        resolved.checkout_token = purchase.checkout_token != null ? String(purchase.checkout_token) : null;
        resolved.order_id = purchase.order_id != null ? String(purchase.order_id) : null;
        session = resolved.session_id ? await getSessionById(resolved.session_id) : null;
      } else if (pkParsed) {
        resolved.kind = pkParsed.kind === 'token' ? 'purchase_key_token' : pkParsed.kind === 'order' ? 'purchase_key_order' : 'purchase_key_hash';
        resolved.purchase_key = pkParsed.purchase_key;
        if (pkParsed.checkout_token) resolved.checkout_token = pkParsed.checkout_token;
        if (pkParsed.order_id) resolved.order_id = pkParsed.order_id;
      }
    }

    // 3) Order id lookup.
    if (!session && !purchase) {
      const oid = extractOrderId(rawQ);
      if (oid) {
        resolved.kind = 'order_id';
        resolved.order_id = oid;
        // Prefer fraud row to discover session_id.
        const fr = await getFraudRowByEntity('order', oid).catch(() => null);
        if (fr && fr.session_id) {
          resolved.session_id = String(fr.session_id);
          resolved.visitor_id = fr.visitor_id != null ? String(fr.visitor_id) : null;
          resolved.checkout_token = fr.checkout_token != null ? String(fr.checkout_token) : null;
          session = await getSessionById(resolved.session_id);
        }
        if (!session) {
          const ps = await getPurchasesByOrderId(oid, 5).catch(() => []);
          if (ps && ps.length) {
            purchase = ps[0] || null;
            resolved.purchase_key = purchase && purchase.purchase_key ? String(purchase.purchase_key) : null;
            resolved.session_id = purchase && purchase.session_id ? String(purchase.session_id) : null;
            resolved.visitor_id = purchase && purchase.visitor_id ? String(purchase.visitor_id) : null;
            resolved.checkout_token = purchase && purchase.checkout_token ? String(purchase.checkout_token) : null;
            session = resolved.session_id ? await getSessionById(resolved.session_id) : null;
          }
        }
      }
    }

    // 4) Checkout token lookup.
    if (!session && !purchase && looksLikeCheckoutToken(rawQ)) {
      resolved.kind = 'checkout_token';
      resolved.checkout_token = rawQ;
      const fr = await getFraudRowByCheckoutToken(rawQ).catch(() => null);
      if (fr) {
        resolved.session_id = fr.session_id != null ? String(fr.session_id) : null;
        resolved.visitor_id = fr.visitor_id != null ? String(fr.visitor_id) : null;
        resolved.order_id = fr.order_id != null ? String(fr.order_id) : null;
      }
      const ps = await getPurchasesByCheckoutToken(rawQ, 5).catch(() => []);
      if (ps && ps.length) {
        purchase = ps[0] || null;
        if (purchase && purchase.purchase_key) resolved.purchase_key = String(purchase.purchase_key);
        if (!resolved.session_id && purchase && purchase.session_id) resolved.session_id = String(purchase.session_id);
        if (!resolved.visitor_id && purchase && purchase.visitor_id) resolved.visitor_id = String(purchase.visitor_id);
        if (!resolved.order_id && purchase && purchase.order_id) resolved.order_id = String(purchase.order_id);
      }
      if (resolved.session_id) session = await getSessionById(resolved.session_id);
    }

    // Hydrate related purchases + attribution.
    if (resolved.session_id) {
      purchases = await getPurchasesBySession(resolved.session_id, 20).catch(() => []);
      if (!purchase && purchases.length) purchase = purchases[0] || null;
      if (!resolved.purchase_key && purchase && purchase.purchase_key) resolved.purchase_key = String(purchase.purchase_key);
      if (!resolved.checkout_token && purchase && purchase.checkout_token) resolved.checkout_token = String(purchase.checkout_token);
      if (!resolved.order_id && purchase && purchase.order_id) resolved.order_id = String(purchase.order_id);
      if (!resolved.visitor_id && purchase && purchase.visitor_id) resolved.visitor_id = String(purchase.visitor_id);
      attribution = await getAttributionBySession(resolved.session_id).catch(() => null);
      events = await getSessionEventsBySessionId(resolved.session_id, 20).catch(() => []);
    }

    // Truth order + purchase events (requires shop).
    if (safeShop) {
      if (resolved.order_id) truthOrder = await getTruthOrderByOrderId(safeShop, resolved.order_id).catch(() => null);
      if (!truthOrder && resolved.checkout_token) truthOrder = await getTruthOrderByCheckoutToken(safeShop, resolved.checkout_token).catch(() => null);

      if (resolved.order_id) purchaseEvents = await getPurchaseEventsByOrderId(safeShop, resolved.order_id, 10).catch(() => []);
      if (!purchaseEvents.length && resolved.checkout_token) purchaseEvents = await getPurchaseEventsByCheckoutToken(safeShop, resolved.checkout_token, 10).catch(() => []);
    }

    const fraud = await getFraudBundle({
      sessionId: resolved.session_id,
      orderId: resolved.order_id,
      checkoutToken: resolved.checkout_token,
      purchaseKey: resolved.purchase_key,
      shop: safeShop,
    }).catch(() => ({ ok: false, available: false }));

    return {
      ok: true,
      q: rawQ,
      shop: safeShop || null,
      resolved,
      events: Array.isArray(events) ? events : [],
      session: session || null,
      purchases: purchases || [],
      attribution: attribution || null,
      fraud,
      truth_order: truthOrder || null,
      purchase_events: purchaseEvents || [],
    };
  } catch (err) {
    Sentry.captureException(err, { extra: { tool: 'click-order-lookup', q: rawQ } });
    return { ok: false, error: 'Internal error' };
  }
}

module.exports = { lookup };

