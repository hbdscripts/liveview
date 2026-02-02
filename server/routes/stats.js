/**
 * GET /api/stats – sales + conversion ranges (UK midnight) and country stats.
 */

const store = require('../store');

function getStats(req, res, next) {
  store.getStats()
    .then(data => res.json(data))
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Internal error' });
    });
}

module.exports = { getStats };
