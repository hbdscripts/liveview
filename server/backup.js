/**
 * Backup helper (required before schema changes / reconciliation).
 *
 * SQLite: copy DB file to server/backups/ with timestamp.
 * Postgres: create backup tables via CREATE TABLE ... AS SELECT * ...
 *
 * NOTE: This module does NOT log to console; callers should record to audit_log.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getDb, isPostgres } = require('./db');

function pad2(n) {
  return String(n).padStart(2, '0');
}

function timestampUtc() {
  const d = new Date();
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    '_' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds())
  );
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function exists(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function sqliteDbPath() {
  // Must match server/db.js (SQLite default).
  return path.join(process.cwd(), 'live_visitors.sqlite');
}

async function copySqliteDb(label) {
  const src = sqliteDbPath();
  if (!(await exists(src))) return null;
  const backupsDir = path.join(__dirname, 'backups');
  await ensureDir(backupsDir);
  const ts = timestampUtc();
  const safeLabel = (label && String(label).trim()) ? String(label).trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32) : 'backup';
  const dest = path.join(backupsDir, `live_visitors_${safeLabel}_${ts}.sqlite`);
  await fs.promises.copyFile(src, dest);
  let sizeBytes = null;
  try {
    const st = await fs.promises.stat(dest);
    sizeBytes = st && typeof st.size === 'number' ? st.size : null;
  } catch (_) {}
  return { engine: 'sqlite', src, dest, ts, sizeBytes };
}

function safeLabelForSqlite(label) {
  return (label && String(label).trim())
    ? String(label).trim().replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32)
    : 'backup';
}

function safeLabelForPostgres(label) {
  return (label && String(label).trim())
    ? String(label).trim().replace(/[^a-z0-9_-]+/gi, '_').slice(0, 24)
    : 'backup';
}

function isSafeIdent(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

async function tableExistsPostgres(tableName) {
  const db = getDb();
  // to_regclass returns null if missing. Works in Postgres.
  const row = await db.get('SELECT to_regclass(?) AS reg', [tableName]);
  return !!(row && row.reg);
}

async function createPostgresBackupTable(tableName, label) {
  if (!isSafeIdent(tableName)) throw new Error('Unsafe table name: ' + tableName);
  const db = getDb();
  const ts = timestampUtc();
  const safeLabel = safeLabelForPostgres(label);
  const backupName = `${tableName}_backup_${safeLabel}_${ts}`.replace(/-/g, '_');
  // CREATE TABLE AS SELECT is safe and works without pg_dump.
  await db.run(`CREATE TABLE ${backupName} AS SELECT * FROM ${tableName}`);
  return { engine: 'postgres', table: tableName, backupTable: backupName, ts };
}

async function pruneSqliteBackups({ label, keep = 7 } = {}) {
  const backupsDir = path.join(__dirname, 'backups');
  const safeLabel = safeLabelForSqlite(label);
  const prefix = `live_visitors_${safeLabel}_`;
  let files = [];
  try {
    files = await fs.promises.readdir(backupsDir);
  } catch (_) {
    return { ok: true, deleted: [], keep };
  }
  const matches = (files || [])
    .filter((f) => typeof f === 'string' && f.startsWith(prefix) && f.endsWith('.sqlite'))
    .slice()
    // Filename includes sortable UTC timestamp; descending = newest first.
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const keepN = Math.min(Math.max(parseInt(String(keep), 10) || 7, 1), 50);
  const toDelete = matches.slice(keepN);
  const deleted = [];
  for (const f of toDelete) {
    const full = path.join(backupsDir, f);
    try {
      await fs.promises.unlink(full);
      deleted.push(full);
    } catch (_) {}
  }
  return { ok: true, deleted, keep: keepN };
}

async function prunePostgresBackupTables({ tables, label, keep = 7 } = {}) {
  const db = getDb();
  const safeLabel = safeLabelForPostgres(label).replace(/-/g, '_');
  const keepN = Math.min(Math.max(parseInt(String(keep), 10) || 7, 1), 50);
  const deleted = [];
  for (const base of Array.isArray(tables) ? tables : []) {
    if (!isSafeIdent(base)) continue;
    const prefix = `${base}_backup_${safeLabel}_`;
    try {
      const rows = await db.all(
        `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE ? ORDER BY tablename DESC`,
        [prefix + '%']
      );
      const names = (rows || []).map((r) => r && r.tablename ? String(r.tablename) : '').filter(Boolean);
      const toDrop = names.slice(keepN);
      for (const name of toDrop) {
        if (!isSafeIdent(name)) continue;
        try {
          await db.run(`DROP TABLE IF EXISTS ${name}`);
          deleted.push(name);
        } catch (_) {}
      }
    } catch (_) {}
  }
  return { ok: true, deleted, keep: keepN };
}

/**
 * Backup core tables before applying new schema or running reconciliation.
 * Returns metadata suitable for writing into audit_log.
 */
async function backup({ label = 'pre', tables = null, retention = null } = {}) {
  if (isPostgres()) {
    const requested = Array.isArray(tables) && tables.length ? tables : ['purchases', 'sessions', 'events', 'shop_sessions'];
    const out = [];
    for (const t of requested) {
      try {
        const ok = await tableExistsPostgres(t);
        if (!ok) continue;
        out.push(await createPostgresBackupTable(t, label));
      } catch (_) {
        // Fail-open for individual tables; continue backing up others.
      }
    }
    let pruned = null;
    try {
      const keep = retention && retention.keep != null ? retention.keep : null;
      if (keep != null) pruned = await prunePostgresBackupTables({ tables: requested, label, keep });
    } catch (_) {
      pruned = null;
    }
    return { engine: 'postgres', label, backups: out, pruned, ts: timestampUtc() };
  }
  const fileBackup = await copySqliteDb(label);
  let pruned = null;
  try {
    const keep = retention && retention.keep != null ? retention.keep : null;
    if (keep != null) pruned = await pruneSqliteBackups({ label, keep });
  } catch (_) {
    pruned = null;
  }
  return { engine: 'sqlite', label, backup: fileBackup, pruned, ts: timestampUtc() };
}

/**
 * Run a one-time backup right before introducing orders_shopify (schema change).
 */
async function backupBeforeTruthSchemaCreate() {
  // Only run when orders_shopify doesn't exist yet.
  const db = getDb();
  let existsOrders = false;
  try {
    if (isPostgres()) {
      existsOrders = await tableExistsPostgres('orders_shopify');
    } else {
      const row = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", ['orders_shopify']);
      existsOrders = !!row;
    }
  } catch (_) {
    existsOrders = false;
  }
  if (existsOrders) return null;
  return backup({ label: 'pre_truth_schema', tables: ['purchases', 'sessions', 'events', 'shop_sessions'] });
}

module.exports = {
  backup,
  backupBeforeTruthSchemaCreate,
  sqliteDbPath,
};

