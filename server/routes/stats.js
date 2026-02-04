/**
 * GET /api/stats – sales + conversion ranges (UK midnight) and country stats.
 * Human-only (exclude cf_known_bot=1); bots are blocked at the edge.
 */

const store = require('../store');

function getStats(req, res, next) {
  const trafficMode = 'human_only';
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  store.getStats({ trafficMode })
    .then(data => res.json(data))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { getStats };
