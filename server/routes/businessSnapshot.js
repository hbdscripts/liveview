const Sentry = require('@sentry/node');
const businessSnapshotService = require('../businessSnapshotService');

async function getBusinessSnapshot(req, res) {
  const yearRaw = req && req.query && req.query.year != null ? String(req.query.year) : '';
  try {
    const payload = await businessSnapshotService.getBusinessSnapshot({ year: yearRaw });
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Vary', 'Cookie');
    res.json(payload);
  } catch (err) {
    Sentry.captureException(err, { extra: { route: 'businessSnapshot', year: yearRaw } });
    res.status(500).json({ ok: false, error: 'Failed to load business snapshot' });
  }
}

module.exports = {
  getBusinessSnapshot,
};
