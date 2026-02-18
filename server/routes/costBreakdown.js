/**
 * GET /api/cost-breakdown – master-only cost breakdown for Settings → Costs & profit → Cost Breakdown.
 * Query: range=today|yesterday|7d|30d
 */
const businessSnapshotService = require('../businessSnapshotService');

const ALLOWED_RANGE = new Set(['today', 'yesterday', '7d', '30d']);

async function getCostBreakdown(req, res) {
  const raw = req && req.query && req.query.range != null ? String(req.query.range).trim().toLowerCase() : '';
  const rangeKey = ALLOWED_RANGE.has(raw) ? raw : '7d';
  try {
    const payload = await businessSnapshotService.getCostBreakdown({ rangeKey });
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload && typeof payload === 'object' ? payload : { ok: false, error: 'bad_payload' });
  } catch (_) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: 'cost_breakdown_failed' });
  }
}

module.exports = { getCostBreakdown };

