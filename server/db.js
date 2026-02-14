/**
 * DB abstraction: SQLite (default) or Postgres via DB_URL.
 * Single place for all DB access; exposes run, get, all.
 */

const config = require('./config');
const path = require('path');

let db;

function getDb() {
  if (db) return db;
  if (config.dbUrl && config.dbUrl.trim() !== '') {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: config.dbUrl });
    function toPg(sql, params) {
      let i = 0;
      const out = sql.replace(/\?/g, () => `$${++i}`);
      return [out, params];
    }
    db = {
      run: (sql, params = []) => {
        const [q, p] = toPg(sql, params);
        return pool.query(q, p).then(r => ({ lastID: r.rows[0]?.id, changes: r.rowCount }));
      },
      get: (sql, params = []) => {
        const [q, p] = toPg(sql, params);
        return pool.query(q, p).then(r => r.rows[0] || null);
      },
      all: (sql, params = []) => {
        const [q, p] = toPg(sql, params);
        return pool.query(q, p).then(r => r.rows);
      },
      exec: (sql) => pool.query(sql).then(() => {}),
      close: () => pool.end(),
    };
    return db;
  }
  const Database = require('better-sqlite3');
  const rawPath = (config.sqliteDbPath || '').trim();
  const dbPath = rawPath
    ? (rawPath === ':memory:' ? rawPath : (path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath)))
    : path.join(process.cwd(), 'live_visitors.sqlite');
  const sqlite = new Database(dbPath);
  // Performance: WAL mode for concurrent reads/writes, larger cache, mmap I/O
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('cache_size = -32000');
  sqlite.pragma('mmap_size = 268435456');
  db = {
    run: (sql, params = []) => {
      const result = sqlite.prepare(sql).run(...params);
      return Promise.resolve({ lastID: result.lastInsertRowid, changes: result.changes });
    },
    get: (sql, params = []) => Promise.resolve(sqlite.prepare(sql).get(...params) || null),
    all: (sql, params = []) => Promise.resolve(sqlite.prepare(sql).all(...params)),
    exec: (sql) => { sqlite.exec(sql); return Promise.resolve(); },
    close: () => { sqlite.close(); },
  };
  return db;
}

function isPostgres() {
  return !!(config.dbUrl && config.dbUrl.trim() !== '');
}

module.exports = { getDb, isPostgres };
