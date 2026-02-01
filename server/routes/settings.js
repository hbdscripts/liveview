/**
 * GET /api/settings/tracking
 * PUT /api/settings/tracking – body: { enabled: true|false }
 */

const store = require('../store');

function getTracking(req, res, next) {
  store.isTrackingEnabled()
    .then(enabled => res.json({ enabled }))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

function putTracking(req, res, next) {
  const enabled = req.body && (req.body.enabled === true || req.body.enabled === 'true');
  store.setSetting('tracking_enabled', enabled ? 'true' : 'false')
    .then(() => res.json({ enabled }))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { getTracking, putTracking };
