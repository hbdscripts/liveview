const Sentry = require('@sentry/node');
const businessSnapshotService = require('../businessSnapshotService');

async function getBusinessSnapshot(req, res) {
  const modeRaw = req && req.query && req.query.mode != null ? String(req.query.mode) : '';
  const yearRaw = req && req.query && req.query.year != null ? String(req.query.year) : '';
  const monthRaw = req && req.query && req.query.month != null ? String(req.query.month) : '';
  try {
    const payload = await businessSnapshotService.getBusinessSnapshot({ mode: modeRaw, year: yearRaw, month: monthRaw });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    res.json(payload);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'businessSnapshot', mode: modeRaw, year: yearRaw, month: monthRaw } });
    res.status(500).json({ ok: false, error: 'Failed to load business snapshot' });
  }
}

module.exports = {
  getBusinessSnapshot,
};
