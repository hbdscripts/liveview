/**
 * TTL cleanup: purge old sessions only when BOTH last_seen and started_at are older than retention
 * (so stats windows for yesterday/3d/7d stay stable). Except abandoned within retention.
 */

const { getDb } = require('./db');
const config = require('./config');
const backup = require('./backup');
const { writeAudit } = require('./audit');

const DAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_RETENTION_SETTING_KEY = 'growth_retention_last_run';
const GROWTH_RETENTION_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
let inflight = null;

function clampDays(v, fallback, min = 1, max = 3650) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

async function getSetting(db, key) {
  try {
    const row = await db.get('SELECT value FROM settings WHERE key = ? LIMIT 1', [key]);
    return row && row.value != null ? row.value : null;
  } catch (_) {
    return null;
  }
}

async function setSetting(db, key, value) {
  try {
    await db.run(
      `
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value
      `,
      [key, value]
    );
  } catch (_) {}
}

async function pruneGrowthTables(db, now) {
  if (!config.enableGrowthTableRetention) return null;

  const lastRaw = await getSetting(db, GROWTH_RETENTION_SETTING_KEY);
  const last = lastRaw != null ? parseInt(String(lastRaw), 10) : null;
  if (last != null && Number.isFinite(last) && (now - last) >= 0 && (now - last) < GROWTH_RETENTION_MIN_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: 'recent', lastRunAt: last };
  }

  const reportDays = clampDays(config.reportCacheRetentionDays, 30);
  const auditDays = clampDays(config.auditLogRetentionDays, 90);
  const snapDays = clampDays(config.reconcileSnapshotsRetentionDays, 365);
  const cutoffs = {
    reportCacheComputedAtLt: now - reportDays * DAY_MS,
    auditLogTsLt: now - auditDays * DAY_MS,
    reconcileSnapshotsFetchedAtLt: now - snapDays * DAY_MS,
  };

  let backupMeta = null;
  try {
    backupMeta = await backup.backup({
      label: 'retention',
      tables: ['report_cache', 'audit_log', 'reconcile_snapshots'],
      retention: { keep: 7 },
    });
  } catch (e) {
    try {
      await writeAudit('system', 'retention_backup_error', {
        when: 'pre_prune',
        error: e && e.message ? String(e.message).slice(0, 220) : 'backup_failed',
      });
    } catch (_) {}
    return { ok: false, error: 'backup_failed' };
  }

  const backedUpTables = new Set();
  let backupOk = false;
  if (backupMeta && backupMeta.engine === 'sqlite') {
    backupOk = !!backupMeta.backup;
    if (backupOk) {
      backedUpTables.add('report_cache');
      backedUpTables.add('audit_log');
      backedUpTables.add('reconcile_snapshots');
    }
  } else if (backupMeta && backupMeta.engine === 'postgres') {
    for (const b of Array.isArray(backupMeta.backups) ? backupMeta.backups : []) {
      const t = b && b.table != null ? String(b.table).trim() : '';
      if (t) backedUpTables.add(t);
    }
    backupOk = backedUpTables.size > 0;
  }

  if (!backupOk) {
    try {
      await writeAudit('system', 'retention_backup_skipped', { when: 'pre_prune', now, backupMeta });
    } catch (_) {}
    return { ok: false, skipped: true, reason: 'backup_missing' };
  }

  await setSetting(db, GROWTH_RETENTION_SETTING_KEY, String(now));

  const deleted = {
    report_cache: null,
    audit_log: null,
    reconcile_snapshots: null,
  };

  if (backedUpTables.has('report_cache')) {
    try {
      const r = await db.run('DELETE FROM report_cache WHERE computed_at < ?', [cutoffs.reportCacheComputedAtLt]);
      deleted.report_cache = r && r.changes != null ? Number(r.changes) || 0 : 0;
    } catch (_) {}
  }
  if (backedUpTables.has('audit_log')) {
    try {
      const r = await db.run('DELETE FROM audit_log WHERE ts < ?', [cutoffs.auditLogTsLt]);
      deleted.audit_log = r && r.changes != null ? Number(r.changes) || 0 : 0;
    } catch (_) {}
  }
  if (backedUpTables.has('reconcile_snapshots')) {
    try {
      const r = await db.run('DELETE FROM reconcile_snapshots WHERE fetched_at < ?', [cutoffs.reconcileSnapshotsFetchedAtLt]);
      deleted.reconcile_snapshots = r && r.changes != null ? Number(r.changes) || 0 : 0;
    } catch (_) {}
  }

  try {
    await writeAudit('system', 'retention_prune', {
      now,
      cutoffs,
      deleted,
      backupMeta,
    });
  } catch (_) {}

  return { ok: true, now, cutoffs, deleted };
}

async function run() {
  if (inflight) return inflight;
  inflight = runOnce().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runOnce() {
  const db = getDb();
  const now = Date.now();
  const retentionMs = config.sessionRetentionDays * 24 * 60 * 60 * 1000;
  const retentionCutoff = now - retentionMs;
  const abandonedRetentionMs = config.abandonedRetentionHours * 60 * 60 * 1000;
  const abandonedCutoff = now - abandonedRetentionMs;

  // Delete only when BOTH last_seen and started_at are older than retention; except abandoned within retention
  if (config.dbUrl) {
    await db.run(`
      DELETE FROM events WHERE session_id IN (
        SELECT session_id FROM sessions
        WHERE last_seen < $1 AND started_at < $1
        AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < $2)
      )
    `, [retentionCutoff, abandonedCutoff]);
    await db.run(`
      DELETE FROM sessions
      WHERE last_seen < $1 AND started_at < $1
      AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < $2)
    `, [retentionCutoff, abandonedCutoff]);
  } else {
    await db.run(`
      DELETE FROM events WHERE session_id IN (
        SELECT session_id FROM sessions
        WHERE last_seen < ? AND started_at < ?
        AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)
      )
    `, [retentionCutoff, retentionCutoff, abandonedCutoff]);
    await db.run(`
      DELETE FROM sessions
      WHERE last_seen < ? AND started_at < ?
      AND (is_abandoned = 0 OR abandoned_at IS NULL OR abandoned_at < ?)
    `, [retentionCutoff, retentionCutoff, abandonedCutoff]);
  }

  const maxEvents = parseInt(String(config.maxEventsPerSession), 10);
  if (Number.isFinite(maxEvents) && maxEvents > 0) {
    if (config.dbUrl) {
      await db.run(
        `
          DELETE FROM events
          WHERE id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts DESC, id DESC) AS rn
              FROM events
            ) ranked
            WHERE ranked.rn > $1
          )
        `,
        [maxEvents]
      );
    } else {
      await db.run(
        `
          DELETE FROM events
          WHERE id IN (
            SELECT id FROM (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY ts DESC, id DESC) AS rn
              FROM events
            ) ranked
            WHERE ranked.rn > ?
          )
        `,
        [maxEvents]
      );
    }
  }

  try {
    await pruneGrowthTables(db, now);
  } catch (_) {}
}

module.exports = { run };
