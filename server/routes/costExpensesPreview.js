/**
 * POST /api/cost-expenses/per-order-preview – master-only preview for Settings → Cost & Expenses → Rules.
 * Query: range=today|7d|30d
 * Body: { profitRules, draftRule }
 */
const businessSnapshotService = require('../businessSnapshotService');

const ALLOWED_RANGE = new Set(['today', '7d', '30d']);

async function postPerOrderPreview(req, res) {
  const raw = req && req.query && req.query.range != null ? String(req.query.range).trim().toLowerCase() : '';
  const rangeKey = ALLOWED_RANGE.has(raw) ? raw : '7d';
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const profitRules = Object.prototype.hasOwnProperty.call(body, 'profitRules') ? body.profitRules : body;
  const draftRule = Object.prototype.hasOwnProperty.call(body, 'draftRule') ? body.draftRule : null;
  try {
    const payload = await businessSnapshotService.previewPerOrderRuleImpact({ rangeKey, profitRules, draftRule });
    res.setHeader('Cache-Control', 'no-store');
    res.json(payload && typeof payload === 'object' ? payload : { ok: false, error: 'bad_payload' });
  } catch (_) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: 'cost_expenses_preview_failed' });
  }
}

module.exports = { postPerOrderPreview };

