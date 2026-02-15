/**
 * Admin Fraud API (master-only at mount time).
 *
 * - GET  /api/admin/fraud-config
 * - POST /api/admin/fraud-config
 * - POST /api/admin/fraud-resolution
 */
const express = require('express');
const fraudCfg = require('../fraud/config');
const { getDb } = require('../db');
const dashboardAuth = require('../middleware/dashboardAuth');

const router = express.Router();

function getCookie(req, name) {
  const raw = req.get('Cookie') || req.get('cookie') || '';
  const parts = raw.split(';').map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim().replace(/^\"(.*)\"$/, '$1'));
    }
  }
  return undefined;
}

function safeEmailFromOauthCookie(req) {
  try {
    const cookieValue = getCookie(req, dashboardAuth.OAUTH_COOKIE_NAME);
    const session = cookieValue ? dashboardAuth.readOauthSession(cookieValue) : null;
    if (session && session.email) return session.email;
  } catch (_) {}
  return '';
}

router.get('/fraud-config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const r = await fraudCfg.readFraudConfig({ allowCache: false }).catch(() => null);
  if (!r) return res.json({ ok: true, fromDb: false, config: fraudCfg.defaultFraudConfigV1() });
  return res.json({ ok: true, fromDb: !!r.fromDb, config: r.config });
});

router.post('/fraud-config', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const next = Object.prototype.hasOwnProperty.call(body, 'config') ? body.config : body;
  const normalized = fraudCfg.normalizeFraudConfigV1(next);
  let json = '';
  try { json = JSON.stringify(normalized); } catch (_) { json = ''; }
  if (!json || json.length > 150000) return res.status(400).json({ ok: false, error: 'Config too large' });

  try {
    const r = await fraudCfg.writeFraudConfig(normalized);
    if (!r || !r.ok) return res.status(500).json({ ok: false, error: 'Failed to save fraud config' });
    return res.json({ ok: true, config: r.config });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save fraud config' });
  }
});

router.post('/fraud-resolution', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const status = String(body.resolved_status || body.resolvedStatus || '').trim().toLowerCase();
  const allowed = new Set(['open', 'reviewed', 'ignored', 'denied', 'approved']);
  if (!allowed.has(status)) return res.status(400).json({ ok: false, error: 'Invalid resolved_status' });
  const note = body.resolved_note != null ? String(body.resolved_note) : (body.note != null ? String(body.note) : '');
  const resolvedBy = safeEmailFromOauthCookie(req) || (body.resolved_by != null ? String(body.resolved_by) : '');
  const now = Date.now();

  const evalIdRaw = body.eval_id != null ? body.eval_id : body.evalId;
  const evalId = evalIdRaw != null ? parseInt(String(evalIdRaw), 10) : NaN;

  const entityType = body.entity_type != null ? String(body.entity_type).trim().toLowerCase() : '';
  const entityId = body.entity_id != null ? String(body.entity_id).trim() : '';

  try {
    let r = null;
    if (Number.isFinite(evalId) && evalId > 0) {
      r = await getDb().run(
        'UPDATE fraud_evaluations SET resolved_status = ?, resolved_by = ?, resolved_note = ?, updated_at = ? WHERE eval_id = ?',
        [status, resolvedBy || null, note || null, now, evalId]
      );
    } else if (entityType && entityId) {
      r = await getDb().run(
        'UPDATE fraud_evaluations SET resolved_status = ?, resolved_by = ?, resolved_note = ?, updated_at = ? WHERE entity_type = ? AND entity_id = ?',
        [status, resolvedBy || null, note || null, now, entityType, entityId]
      );
    } else {
      return res.status(400).json({ ok: false, error: 'Missing eval_id or entity_type+entity_id' });
    }
    const changes = r && r.changes ? Number(r.changes) : 0;
    return res.json({ ok: true, changes });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to update resolution' });
  }
});

module.exports = router;

