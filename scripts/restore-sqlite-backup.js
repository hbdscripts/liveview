/**
 * Restore SQLite DB from a backup file (opt-in, destructive).
 *
 * Usage:
 *   RESTORE_SQLITE_BACKUP=1 node scripts/restore-sqlite-backup.js <path-to-backup.sqlite>
 *
 * Requires RESTORE_SQLITE_BACKUP=1. Stops if the app DB path is missing or backup path
 * is not under server/backups/ (or cwd). Copies backup over the live DB file.
 * Operator should stop the app before running.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const backupsDir = path.join(root, 'server', 'backups');
const livePath = path.join(root, 'live_visitors.sqlite');

function main() {
  if (process.env.RESTORE_SQLITE_BACKUP !== '1' && process.env.RESTORE_SQLITE_BACKUP !== 'true') {
    console.error('Restore is opt-in. Set RESTORE_SQLITE_BACKUP=1 and run again.');
    process.exit(1);
  }

  const backupArg = process.argv[2];
  if (!backupArg || typeof backupArg !== 'string') {
    console.error('Usage: RESTORE_SQLITE_BACKUP=1 node scripts/restore-sqlite-backup.js <path-to-backup.sqlite>');
    console.error('Example: RESTORE_SQLITE_BACKUP=1 node scripts/restore-sqlite-backup.js server/backups/live_visitors_pre_reconcile_20260216_120000.sqlite');
    process.exit(1);
  }

  const backupPath = path.isAbsolute(backupArg) ? backupArg : path.join(root, backupArg);
  const normalizedBackup = path.normalize(backupPath);
  const normalizedBackupsDir = path.normalize(backupsDir);
  const normalizedRoot = path.normalize(root);

  if (!normalizedBackup.startsWith(normalizedRoot)) {
    console.error('Backup path must be under project root.');
    process.exit(1);
  }

  try {
    if (!fs.existsSync(backupPath)) {
      console.error('Backup file not found:', backupPath);
      process.exit(1);
    }
    const stat = fs.statSync(backupPath);
    if (!stat.isFile()) {
      console.error('Backup path is not a file:', backupPath);
      process.exit(1);
    }

    // Copy backup over live (overwrites).
    fs.copyFileSync(backupPath, livePath);
    console.log('Restored', backupPath, '->', livePath);
  } catch (err) {
    console.error('Restore failed:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();
