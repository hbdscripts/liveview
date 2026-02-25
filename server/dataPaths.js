/**
 * Runtime data paths (SQLite db + backups).
 *
 * Goal: do not write operational DB/backups into the repo workspace.
 * Default data dir: ~/.kexo (override via KEXO_DATA_DIR).
 *
 * Backward compat:
 * - If a legacy repo-root DB exists (./live_visitors.sqlite) and the new path doesn't,
 *   copy the DB (and -wal/-shm if present) into the data dir on first boot.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');

function resolveDataDir() {
  const raw = (config.dataDir || '').trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  const home = (() => {
    try { return os.homedir ? os.homedir() : ''; } catch (_) { return ''; }
  })();
  if (home) return path.join(home, '.kexo');
  // Last-resort: prefer outside the repo root.
  return path.resolve(process.cwd(), '..', '.kexo');
}

function ensureDirExists(dirPath) {
  try { fs.mkdirSync(dirPath, { recursive: true }); } catch (_) {}
}

function resolveLegacyRepoSqlitePath() {
  return path.join(process.cwd(), 'live_visitors.sqlite');
}

function resolveSqliteDbPath() {
  const rawPath = (config.sqliteDbPath || '').trim();
  if (rawPath) {
    if (rawPath === ':memory:') return rawPath;
    return path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);
  }

  const dir = resolveDataDir();
  ensureDirExists(dir);
  const dest = path.join(dir, 'live_visitors.sqlite');

  // One-time migration from legacy repo-root path to data dir.
  migrateLegacySqliteIfNeeded(dest);

  return dest;
}

function migrateLegacySqliteIfNeeded(destPath) {
  try {
    if (!destPath || destPath === ':memory:') return;
    if (fs.existsSync(destPath)) return;
    const legacy = resolveLegacyRepoSqlitePath();
    if (!fs.existsSync(legacy)) return;

    fs.copyFileSync(legacy, destPath);
    // Copy WAL/SHM when present so the new DB starts consistent with previous WAL mode.
    ['-wal', '-shm'].forEach((suffix) => {
      try {
        const src = legacy + suffix;
        const dst = destPath + suffix;
        if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
      } catch (_) {}
    });
  } catch (_) {}
}

function resolveSqliteBackupsDir() {
  const dir = path.join(resolveDataDir(), 'backups');
  ensureDirExists(dir);
  return dir;
}

module.exports = {
  resolveDataDir,
  resolveLegacyRepoSqlitePath,
  resolveSqliteDbPath,
  resolveSqliteBackupsDir,
  ensureDirExists,
};

