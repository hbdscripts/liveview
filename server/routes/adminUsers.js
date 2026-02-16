/**
 * Admin API: Users approvals + role promotion.
 *
 * Protected by requireMaster middleware at mount time.
 */
const express = require('express');
const users = require('../usersService');
const { getDb } = require('../db');

const router = express.Router();

function normalizeStatus(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (s === 'pending' || s === 'active' || s === 'denied') return s;
  return '';
}

function coerceEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n);
}

async function listShopifyAuthRows(limit = 20) {
  const db = getDb();
  try {
    const rows = await db.all(
      `
        SELECT shop, updated_at
        FROM shop_sessions
        WHERE shop IS NOT NULL AND TRIM(shop) <> ''
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      [Math.max(1, Math.min(100, Number(limit) || 20))]
    );
    return (rows || []).map((row) => {
      const shop = row && row.shop ? String(row.shop).trim().toLowerCase() : '';
      const at = coerceEpochMs(row && row.updated_at);
      return {
        id: `shop:${shop || 'unknown'}`,
        email: shop ? `Shopify (${shop})` : 'Shopify',
        status: 'active',
        role: 'shopify',
        tier: 'n/a',
        created_at: at,
        last_login_at: at,
        last_country: null,
        last_city: null,
        last_device_type: 'shopify',
        last_platform: 'oauth',
        auth_provider: 'shopify',
        shop: shop || null,
      };
    });
  } catch (_) {
    // Table can be missing in early boot/tests; fail-open with no shop sessions.
    return [];
  }
}

function sortRowsByLastSeenDesc(rows) {
  return (rows || []).slice().sort((a, b) => {
    const aSeen = coerceEpochMs(a && (a.last_login_at || a.created_at));
    const bSeen = coerceEpochMs(b && (b.last_login_at || b.created_at));
    if (aSeen !== bSeen) return bSeen - aSeen;
    const aId = a && a.id != null ? String(a.id) : '';
    const bId = b && b.id != null ? String(b.id) : '';
    return bId.localeCompare(aId);
  });
}

router.get('/users', async (req, res) => {
  const status = normalizeStatus(req.query && req.query.status);
  let rows = await users.listUsers({ status: status || undefined });
  if (!status || status === 'active') {
    const shopRows = await listShopifyAuthRows(20);
    rows = sortRowsByLastSeenDesc([...(rows || []), ...shopRows]);
  }
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

