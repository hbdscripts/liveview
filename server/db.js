/**
 * DB abstraction: SQLite (default) or Postgres via DB_URL.
 * Single place for all DB access; exposes run, get, all, exec, transaction.
 */

const config = require('./config');
const { AsyncLocalStorage } = require('async_hooks');
const dataPaths = require('./dataPaths');

let db;
let _pgPool = null;
const _pgTxStorage = new AsyncLocalStorage();

function toPg(sql, params) {
  const text = String(sql == null ? '' : sql);
  let idx = 0;
  let out = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      out += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle) {
      out += ch;
      if (ch === "'" && next === "'") {
        out += "'";
        i += 1;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      out += ch;
      if (ch === '"' && next === '"') {
        out += '"';
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    if (ch === '-' && next === '-') {
      out += '--';
      i += 1;
      inLineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '/*';
      i += 1;
      inBlockComment = true;
      continue;
    }
    if (ch === "'") {
      out += ch;
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      out += ch;
      inDouble = true;
      continue;
    }
    if (ch === '?') {
      idx += 1;
      out += `$${idx}`;
      continue;
    }
    out += ch;
  }
  return [out, params];
}

function getDb() {
  if (db) return db;
  if (config.dbUrl && config.dbUrl.trim() !== '') {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: config.dbUrl });
    _pgPool = pool;
    function pgTarget() {
      return _pgTxStorage.getStore() || pool;
    }
    db = {
      run: (sql, params = []) => {
        const [q, p] = toPg(sql, params);
        const target = pgTarget();
        return target.query(q, p).then(r => {
          const hasReturning = /\breturning\b/i.test(q);
          let lastID = null;
          if (hasReturning && Array.isArray(r.rows) && r.rows.length > 0 && r.rows[0] && typeof r.rows[0] === 'object') {
            if (Object.prototype.hasOwnProperty.call(r.rows[0], 'id')) {
              lastID = r.rows[0].id;
            } else {
              const keys = Object.keys(r.rows[0]);
              lastID = keys.length ? r.rows[0][keys[0]] : null;
            }
          }
          return { lastID, changes: r.rowCount };
        });
      },
      get: (sql, params = []) => {
        const [q, p] = toPg(sql, params);
        const target = pgTarget();
        return target.query(q, p).then(r => r.rows[0] || null);
      },
      all: (sql, params = []) => {
        const [q, p] = toPg(sql, params);
        const target = pgTarget();
        return target.query(q, p).then(r => r.rows);
      },
      exec: (sql) => {
        const target = pgTarget();
        return target.query(sql).then(() => {});
      },
      close: () => pool.end(),
      transaction: async (fn) => {
        const ambient = _pgTxStorage.getStore();
        if (ambient) {
          // Nested transactions are flattened into the existing transaction scope.
          return fn();
        }
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await _pgTxStorage.run(client, async () => fn());
          await client.query('COMMIT');
          return result;
        } catch (err) {
          try { await client.query('ROLLBACK'); } catch (_) {}
          throw err;
        } finally {
          client.release();
        }
      },
    };
    return db;
  }
  const Database = require('better-sqlite3');
  const dbPath = dataPaths.resolveSqliteDbPath();
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
    transaction: async (fn) => {
      const database = getDb();
      await database.run('BEGIN');
      try {
        const result = await fn();
        await database.run('COMMIT');
        return result;
      } catch (err) {
        try { await database.run('ROLLBACK'); } catch (_) {}
        throw err;
      }
    },
  };
  return db;
}

function isPostgres() {
  return !!(config.dbUrl && config.dbUrl.trim() !== '');
}

module.exports = { getDb, isPostgres };
