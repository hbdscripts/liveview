/**
 * GET /api/stats – sales + conversion ranges (UK midnight) and country stats.
 * Human-only (exclude cf_known_bot=1); bots are blocked at the edge.
 */

const store = require('../store');

function getStats(req, res, next) {
  const trafficMode = 'human_only';
  // Stats refresh cadence: manual or every 15 minutes (client). Match with 15 min private cache.
  res.setHeader('Cache-Control', 'private, max-age=900');
  res.setHeader('Vary', 'Cookie');
  store.getStats({ trafficMode })
    .then(data => res.json(data))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { getStats };
