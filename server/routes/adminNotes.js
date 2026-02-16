/**
 * Admin Notes API (master-only at mount).
 * GET  /api/admin/notes  - list recent notes (default limit 50)
 * POST /api/admin/notes  - create a note (body: { body: string, created_by?: string })
 */
const express = require('express');
const { getDb, isPostgres } = require('../db');

const router = express.Router();
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_BODY_LENGTH = 4096;

router.get('/notes', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
    const db = getDb();
    const rows = await db.all(
      'SELECT id, body, created_at, created_by FROM admin_notes ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    res.json({ notes: rows || [] });
  } catch (err) {
    console.error('[admin/notes] list', err);
    res.status(500).json({ error: 'Failed to list notes' });
  }
});

router.post('/notes', express.json(), async (req, res) => {
  try {
    const body = (req.body && req.body.body != null) ? String(req.body.body).trim() : '';
    if (!body) {
      return res.status(400).json({ error: 'body is required' });
    }
    if (body.length > MAX_BODY_LENGTH) {
      return res.status(400).json({ error: 'body too long' });
    }
    const createdBy = (req.body && req.body.created_by != null) ? String(req.body.created_by).trim() : null;
    const createdAt = Date.now();
    const db = getDb();
    if (isPostgres()) {
      const r = await db.run(
        'INSERT INTO admin_notes (body, created_at, created_by) VALUES ($1, $2, $3) RETURNING id',
        [body, createdAt, createdBy || null]
      );
      const id = r && (r.lastID != null || r.lastID === 0) ? r.lastID : null;
      res.status(201).json({ id: id != null ? Number(id) : null, body, created_at: createdAt, created_by: createdBy || null });
    } else {
      const r = await db.run(
        'INSERT INTO admin_notes (body, created_at, created_by) VALUES (?, ?, ?)',
        [body, createdAt, createdBy || null]
      );
      const id = r && r.lastID != null ? r.lastID : null;
      res.status(201).json({ id: id != null ? Number(id) : null, body, created_at: createdAt, created_by: createdBy || null });
    }
  } catch (err) {
    console.error('[admin/notes] create', err);
    res.status(500).json({ error: 'Failed to create note' });
  }
});

module.exports = router;
