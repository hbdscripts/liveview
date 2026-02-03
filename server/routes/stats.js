/**
 * GET /api/stats – sales + conversion ranges (UK midnight) and country stats.
 * Query: ?traffic=human for human-only (exclude cf_known_bot=1). Default uses TRAFFIC_MODE env.
 */

const config = require('../config');
const store = require('../store');

function getStats(req, res, next) {
  const trafficMode = req.query.traffic === 'human' ? 'human_only' : config.trafficMode;
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
