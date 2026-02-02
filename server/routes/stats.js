/**
 * GET /api/stats – conversion rates (overall, 6h, 12h, 48h, 72h) and sessions by country.
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
