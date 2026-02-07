const config = require('../config');

let _pool = null;

function getAdsPool() {
  if (_pool) return _pool;
  const url = config.adsDbUrl && String(config.adsDbUrl).trim() ? String(config.adsDbUrl).trim() : '';
  if (!url) return null;
  const { Pool } = require('pg');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

function toPg(sql, params) {
  let i = 0;
  const out = String(sql || '').replace(/\?/g, () => `$${++i}`);
  return [out, params];
}

function getAdsDb() {
  const pool = getAdsPool();
  if (!pool) return null;
  return {
    run: (sql, params = []) => {
      const [q, p] = toPg(sql, params);
      return pool.query(q, p).then((r) => ({ lastID: r.rows[0]?.id, changes: r.rowCount }));
    },
    get: (sql, params = []) => {
      const [q, p] = toPg(sql, params);
      return pool.query(q, p).then((r) => r.rows[0] || null);
    },
    all: (sql, params = []) => {
      const [q, p] = toPg(sql, params);
      return pool.query(q, p).then((r) => r.rows);
    },
    exec: (sql) => pool.query(sql).then(() => {}),
    close: () => pool.end(),
  };
}

module.exports = {
  getAdsDb,
  getAdsPool,
};
