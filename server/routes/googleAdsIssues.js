/**
 * Google Ads issues API: summary, list, resolve.
 * Scoped by shop; responses redacted (no tokens/PII).
 */
const Sentry = require('@sentry/node');
const express = require('express');
const salesTruth = require('../salesTruth');
const { getAdsDb } = require('../ads/adsDb');

const router = express.Router();

function resolveShop(req) {
  const q = req.query && req.query.shop != null ? String(req.query.shop).trim() : '';
  return q || salesTruth.resolveShopForSales('');
}

function redactIssue(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  delete out.raw;
  if (out.error_message && typeof out.error_message === 'string') {
    out.error_message = out.error_message
      .replace(/\b(ya29\.[A-Za-z0-9_-]+)/g, '[REDACTED]')
      .replace(/\b(1\/[A-Za-z0-9_-]+)/g, '[REDACTED]');
  }
  return out;
}

router.get('/summary', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=30');
  try {
    const shop = resolveShop(req);
    if (!shop) {
      res.json({ ok: true, open_count: 0, total_count: 0 });
      return;
    }
    const db = getAdsDb();
    if (!db) {
      res.json({ ok: true, open_count: 0, total_count: 0 });
      return;
    }
    const normShop = String(shop).trim().toLowerCase();
    const openRow = await db.get(
      `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ? AND status = 'open'`,
      [normShop]
    );
    const totalRow = await db.get(
      `SELECT COUNT(*) AS c FROM google_ads_issues WHERE shop = ?`,
      [normShop]
    );
    const open_count = openRow && openRow.c != null ? Number(openRow.c) : 0;
    const total_count = totalRow && totalRow.c != null ? Number(totalRow.c) : 0;
    res.json({ ok: true, open_count, total_count });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'google-ads.issues.summary' } });
    console.error('[google-ads.issues.summary]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'private, max-age=15');
  try {
    const shop = resolveShop(req);
    const status = (req.query && req.query.status) != null ? String(req.query.status).trim().toLowerCase() : '';
    const limit = Math.min(Number(req.query && req.query.limit) || 50, 100);
    const db = getAdsDb();
    if (!db) {
      res.json({ ok: true, issues: [] });
      return;
    }
    const normShop = String(shop || '').trim().toLowerCase();
    let sql = `SELECT id, shop, source, severity, status, affected_goal, error_code, error_message, suggested_fix, first_seen_at, last_seen_at, resolved_at, resolution_note, created_at, updated_at FROM google_ads_issues WHERE shop = ?`;
    const params = [normShop];
    if (status === 'open' || status === 'resolved') {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY last_seen_at DESC LIMIT ?`;
    params.push(limit);
    const rows = await db.all(sql, params);
    const issues = (rows || []).map((r) => redactIssue(r));
    res.json({ ok: true, issues });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'google-ads.issues.list' } });
    console.error('[google-ads.issues.list]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

router.post('/:id/resolve', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const id = req.params && req.params.id != null ? String(req.params.id).trim() : '';
    const resolutionNote = (req.body && req.body.resolution_note != null) ? String(req.body.resolution_note).trim() : null;
    const shop = resolveShop(req) || (req.body && req.body.shop != null ? String(req.body.shop).trim() : '');
    if (!id || !/^\d+$/.test(id)) {
      res.status(400).json({ ok: false, error: 'Invalid issue id' });
      return;
    }
    const db = getAdsDb();
    if (!db) {
      res.status(503).json({ ok: false, error: 'Ads DB not available' });
      return;
    }
    const normShop = String(shop).trim().toLowerCase();
    const now = Date.now();
    const result = await db.run(
      `UPDATE google_ads_issues SET status = 'resolved', resolved_at = ?, resolution_note = ?, updated_at = ? WHERE id = ? AND shop = ?`,
      [now, resolutionNote || null, now, id, normShop]
    );
    if (!result || result.changes === 0) {
      res.status(404).json({ ok: false, error: 'Issue not found or shop mismatch' });
      return;
    }
    res.json({ ok: true, id: Number(id), resolved_at: now });
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'google-ads.issues.resolve' } });
    console.error('[google-ads.issues.resolve]', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

module.exports = router;
