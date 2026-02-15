/**
 * Admin API: Users approvals + role promotion.
 *
 * Protected by requireMaster middleware at mount time.
 */
const express = require('express');
const users = require('../usersService');

const router = express.Router();

function normalizeStatus(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'pending' || s === 'active' || s === 'denied') return s;
  return '';
}

router.get('/users', async (req, res) => {
  const status = normalizeStatus(req.query && req.query.status);
  const rows = await users.listUsers({ status: status || undefined });
  res.json({ ok: true, users: rows || [] });
});

router.post('/users/:id/approve', async (req, res) => {
  const id = req.params && req.params.id;
  const r = await users.approveUser(id, null, { now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'approve_failed' });
  res.json({ ok: true });
});

router.post('/users/:id/deny', async (req, res) => {
  const id = req.params && req.params.id;
  const r = await users.denyUser(id, null, { now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'deny_failed' });
  res.json({ ok: true });
});

async function promoteAdmin(req, res) {
  const id = req.params && req.params.id;
  const r = await users.promoteToAdmin(id, null, { now: Date.now() });
  if (!r || r.ok !== true) return res.status(400).json({ ok: false, error: (r && r.error) || 'promote_failed' });
  res.json({ ok: true });
}

router.post('/users/:id/promote-admin', promoteAdmin);
// Backwards-compatible alias
router.post('/users/:id/promote-master', promoteAdmin);

module.exports = router;

