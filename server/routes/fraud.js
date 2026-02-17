/**
 * Fraud APIs (auth-protected by dashboardAuth middleware).
 *
 * - GET /api/fraud/markers?entityType=session|order&ids=a,b,c
 * - GET /api/fraud/detail?entityType=session|order&entityId=...
 *
 * Fail-open:
 * - If fraud tables are missing, markers returns triggered:false for all ids.
 */
const express = require('express');
const Sentry = require('@sentry/node');
const { getDb } = require('../db');
const fraudCfg = require('../fraud/config');
const fraudService = require('../fraud/service');
const aiNarrative = require('../fraud/aiNarrative');
const { warnOnReject } = require('../shared/warnReject');

const router = express.Router();

const MARKER_TTL_MS = 30 * 1000;
const markerCache = new Map(); // key -> { exp, value }

function cacheGet(key) {
  const hit = markerCache.get(key);
  if (!hit) return null;
  if (hit.exp != null && hit.exp < Date.now()) {
    markerCache.delete(key);
    return null;
  }
  return hit.value || null;
}

function cacheSet(key, value) {
  markerCache.set(key, { exp: Date.now() + MARKER_TTL_MS, value });
  // Simple pruning
  if (markerCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of markerCache.entries()) {
      if (v && v.exp != null && v.exp < now) markerCache.delete(k);
      if (markerCache.size <= 4000) break;
    }
  }
}

function parseIds(raw) {
  const s = typeof raw === 'string' ? raw : '';
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const v = p.length > 128 ? p.slice(0, 128) : p;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 200) break;
  }
  return out;
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

router.get('/markers', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const entityType = String(req.query.entityType || '').trim().toLowerCase();
  const allowed = new Set(['session', 'order']);
  if (!allowed.has(entityType)) return res.status(400).json({ error: 'Invalid entityType' });
  const ids = parseIds(req.query.ids);
  if (!ids.length) return res.json({});

  // If tables are missing, fail-open with no triggers.
  const ok = await fraudService.tablesOk().catch(() => false);
  if (!ok) {
    const out = {};
    ids.forEach((id) => { out[id] = { ok: true, available: false, has_eval: false, triggered: false, score: null, flags: [] }; });
    return res.json(out);
  }

  const out = {};
  const missing = [];
  for (const id of ids) {
    const key = entityType + ':' + id;
    const cached = cacheGet(key);
    if (cached) {
      out[id] = cached;
      continue;
    }
    missing.push(id);
  }

  if (missing.length) {
    try {
      const ph = '(' + missing.map(() => '?').join(',') + ')';
      const rows = await getDb().all(
        `SELECT entity_id, triggered, score, flags_json
         FROM fraud_evaluations
         WHERE entity_type = ? AND entity_id IN ${ph}`,
        [entityType, ...missing]
      );
      const byId = new Map();
      (rows || []).forEach((r) => {
        if (!r || r.entity_id == null) return;
        const id = String(r.entity_id);
        byId.set(id, {
          ok: true,
          available: true,
          has_eval: true,
          triggered: Number(r.triggered) === 1,
          score: r.score != null ? Math.max(0, Math.min(100, Math.trunc(Number(r.score) || 0))) : 0,
          flags: Array.isArray(safeJsonParse(r.flags_json, [])) ? safeJsonParse(r.flags_json, []) : [],
        });
      });

      missing.forEach((id) => {
        const v = byId.get(id) || { ok: true, available: true, has_eval: false, triggered: false, score: null, flags: [] };
        out[id] = v;
        cacheSet(entityType + ':' + id, v);
      });
    } catch (err) {
      Sentry.captureException(err, { extra: { route: 'fraud.markers', entityType } });
      // Fail-open: treat as no markers.
      missing.forEach((id) => { out[id] = { ok: false, available: true, has_eval: false, triggered: false, score: null, flags: [] }; });
    }
  }

  return res.json(out);
});

router.get('/detail', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const entityType = String(req.query.entityType || '').trim().toLowerCase();
  const allowed = new Set(['session', 'order']);
  if (!allowed.has(entityType)) return res.status(400).json({ error: 'Invalid entityType' });
  const entityId = String(req.query.entityId || '').trim();
  if (!entityId) return res.status(400).json({ error: 'Missing entityId' });

  const ok = await fraudService.tablesOk().catch(() => false);
  if (!ok) return res.status(503).json({ error: 'Fraud system unavailable' });

  try {
    const row = await getDb().get(
      'SELECT * FROM fraud_evaluations WHERE entity_type = ? AND entity_id = ? LIMIT 1',
      [entityType, entityId]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });

    const cfg = await fraudCfg.readFraudConfig({ allowCache: true }).then((r) => r.config).catch(() => fraudCfg.defaultFraudConfigV1());
    const threshold = cfg && Number.isFinite(Number(cfg.threshold)) ? Number(cfg.threshold) : 70;

    const flags = safeJsonParse(row.flags_json, []);
    const evidence = safeJsonParse(row.evidence_json, {});
    const aiSummary = row.ai_summary != null ? String(row.ai_summary) : '';
    const aiUsed = !!(aiSummary && aiSummary.trim());

    const deterministic = aiNarrative.buildDeterministicSummary({ score: row.score, flags, threshold });
    const analysis = aiUsed
      ? { ...deterministic, summary: aiSummary.trim(), ai_used: true }
      : { ...deterministic, ai_used: false };

    // If AI is enabled and missing, attempt a background generation (do not await).
    try {
      const aiEnabled = !!(cfg && cfg.ai && cfg.ai.enabled === true);
      if (!aiUsed && aiEnabled && Number(row.triggered) === 1 && row.session_id) {
        aiNarrative.generateAiSummary({ score: row.score, flags, evidence, fraudCfg: cfg })
          .then((r) => fraudService.updateAiSummaryForSession(String(row.session_id), r))
          .catch(warnOnReject('[fraud] aiNarrative.generateAiSummary'));
      }
    } catch (_) {}

    return res.json({
      ok: true,
      entityType,
      entityId,
      evaluation: {
        eval_id: row.eval_id,
        created_at: row.created_at != null ? Number(row.created_at) : null,
        updated_at: row.updated_at != null ? Number(row.updated_at) : null,
        score: row.score != null ? Math.max(0, Math.min(100, Math.trunc(Number(row.score) || 0))) : 0,
        triggered: Number(row.triggered) === 1,
        flags: Array.isArray(flags) ? flags : [],
        evidence: evidence && typeof evidence === 'object' ? evidence : {},
        ai_summary: aiUsed ? aiSummary.trim() : null,
        ai_model: row.ai_model || null,
        ai_version: row.ai_version || null,
        resolved_status: row.resolved_status || 'open',
        resolved_by: row.resolved_by || null,
        resolved_note: row.resolved_note || null,
      },
      analysis,
      links: {
        session_id: row.session_id || null,
        order_id: row.order_id || null,
        checkout_token: row.checkout_token || null,
      },
    });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'fraud.detail', entityType } });
    return res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;

