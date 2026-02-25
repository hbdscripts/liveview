/**
 * Drop Postgres in-DB backup tables created by server/backup.js.
 *
 * Usage:
 *   DB_URL=... node server/tools/dropPostgresBackupTables.js --dry-run
 *   DB_URL=... node server/tools/dropPostgresBackupTables.js --drop
 *
 * Optional:
 *   --like "%_backup_%"      (default)
 *   --limit 5000            (default 5000)
 *
 * Safety:
 * - Only drops tables in public schema matching the LIKE pattern.
 * - Only drops tables whose names are safe identifiers.
 * - Dry-run prints the tables it would drop and total estimated size.
 */
require('dotenv').config();
const { getDb, isPostgres } = require('../db');
const config = require('../config');

function parseArgs(argv) {
  const out = { dryRun: false, drop: false, like: '%_backup_%', limit: 5000 };
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] || '');
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--drop') out.drop = true;
    else if (a === '--like') out.like = String(args[i + 1] || out.like), i += 1;
    else if (a === '--limit') out.limit = Math.max(1, Math.min(50000, parseInt(String(args[i + 1] || out.limit), 10) || out.limit)), i += 1;
  }
  if (!out.dryRun && !out.drop) out.dryRun = true;
  if (out.dryRun && out.drop) out.drop = false;
  return out;
}

function isSafeIdent(name) {
  return typeof name === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!config.dbUrl || !String(config.dbUrl).trim()) {
    console.error('Missing DB_URL.');
    process.exit(2);
  }
  if (!isPostgres()) {
    console.error('This tool is Postgres-only (DB_URL must point to Postgres).');
    process.exit(2);
  }

  const db = getDb();
  const like = String(args.like || '%_backup_%');
  const limit = args.limit;

  const rows = await db.all(
    `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename LIKE $1
      ORDER BY tablename ASC
      LIMIT ${limit}
    `,
    [like]
  );
  const names = (rows || []).map((r) => (r && r.tablename != null ? String(r.tablename) : '')).filter(Boolean);
  const safeNames = names.filter(isSafeIdent);
  const unsafeNames = names.filter((n) => !isSafeIdent(n));

  // Estimate total size of these tables (best-effort).
  let totalBytes = 0;
  try {
    if (safeNames.length) {
      const sizeRows = await db.all(
        `
          SELECT relname, pg_total_relation_size(quote_ident(relname)) AS bytes
          FROM pg_class
          WHERE relname = ANY($1)
        `,
        [safeNames]
      );
      for (const r of sizeRows || []) {
        totalBytes += (r && r.bytes != null) ? Number(r.bytes) || 0 : 0;
      }
    }
  } catch (_) {}

  const mb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
  console.log(JSON.stringify({
    ok: true,
    mode: args.drop ? 'drop' : 'dry-run',
    like,
    limit,
    found: names.length,
    safe: safeNames.length,
    unsafe: unsafeNames.length,
    estimatedTotalMB: mb,
    sample: safeNames.slice(0, 25),
    unsafeSample: unsafeNames.slice(0, 5),
  }, null, 2));

  if (!args.drop) return;

  let dropped = 0;
  for (const t of safeNames) {
    await db.run(`DROP TABLE IF EXISTS ${t}`);
    dropped += 1;
  }
  console.log(JSON.stringify({ ok: true, dropped }, null, 2));
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});

