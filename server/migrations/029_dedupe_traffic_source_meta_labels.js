/**
 * Traffic source meta: prevent duplicate labels (normalize + unique), and merge existing duplicates.
 *
 * Goal:
 * - Treat identical source names (case/spacing/punctuation-insensitive) as the same Source.
 * - Merge duplicate `traffic_source_meta` rows by label into a single canonical `source_key`.
 * - Update `sessions.traffic_source_key` + `traffic_source_rules.source_key` to the canonical key.
 * - Backup rows before deletes (non-destructive safety).
 *
 * Notes:
 * - This migration is designed to be idempotent (runs on every startup).
 * - Works for both SQLite and Postgres.
 */
const { getDb, isPostgres } = require('../db');

function normalizeFlatLabel(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return '';
  // "Google Ads" == "googleads" == "GoogleAds"
  const flat = s.replace(/[^a-z0-9]+/g, '');
  return flat.slice(0, 128);
}

function flatFromKey(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return '';
  return s.replace(/[^a-z0-9]+/g, '').slice(0, 128);
}

function labelNormFromLabelAndKey(label, sourceKey) {
  const flat = normalizeFlatLabel(label);
  if (flat) return flat;
  const k = flatFromKey(sourceKey);
  return k ? ('k' + k).slice(0, 128) : '';
}

function builtInTrafficSourceKeyFromFlatLabel(flat) {
  if (!flat) return null;
  if (flat === 'googleads' || flat === 'adwords' || flat === 'googleadwords') return 'google_ads';
  if (flat === 'googleorganic') return 'google_organic';
  if (flat === 'bingads' || flat === 'microsoftads' || flat === 'microsoftadvertising') return 'bing_ads';
  if (flat === 'bingorganic') return 'bing_organic';
  if (flat === 'facebookads' || flat === 'fbads' || flat === 'instagramads') return 'facebook_ads';
  if (flat === 'facebookorganic' || flat === 'fborganic' || flat === 'instagramorganic') return 'facebook_organic';
  if (flat === 'omnisend') return 'omnisend';
  if (flat === 'direct' || flat === 'directvisitor') return 'direct';
  if (flat === 'other') return 'other';
  return null;
}

function placeholders(n) {
  return Array.from({ length: n }).map(() => '?').join(',');
}

async function ensureLabelNormColumn(db) {
  if (isPostgres()) {
    await db.run('ALTER TABLE traffic_source_meta ADD COLUMN IF NOT EXISTS label_norm TEXT');
    return;
  }
  try {
    await db.run('ALTER TABLE traffic_source_meta ADD COLUMN label_norm TEXT');
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}

async function ensureBackupTables(db) {
  const metaBackup = `
    CREATE TABLE IF NOT EXISTS traffic_source_meta_dedupe_backup (
      backup_at BIGINT NOT NULL,
      source_key TEXT NOT NULL,
      label TEXT NOT NULL,
      label_norm TEXT,
      icon_url TEXT,
      updated_at BIGINT,
      dedupe_to_key TEXT
    );
  `;
  const rulesBackup = `
    CREATE TABLE IF NOT EXISTS traffic_source_rules_dedupe_backup (
      backup_at BIGINT NOT NULL,
      id BIGINT,
      utm_param TEXT NOT NULL,
      utm_value TEXT NOT NULL,
      source_key TEXT NOT NULL,
      created_at BIGINT,
      dedupe_to_key TEXT
    );
  `;
  if (isPostgres()) {
    await db.run(metaBackup);
    await db.run(rulesBackup);
  } else {
    await db.exec(metaBackup);
    await db.exec(rulesBackup);
  }
}

async function ensureUniqueIndex(db) {
  const idx = 'CREATE UNIQUE INDEX IF NOT EXISTS uq_traffic_source_meta_label_norm ON traffic_source_meta(label_norm)';
  if (isPostgres()) return db.run(idx);
  return db.exec(idx);
}

async function backfillLabelNorm(db) {
  const rows = await db.all('SELECT source_key, label, label_norm FROM traffic_source_meta');
  let updated = 0;
  for (const r of rows || []) {
    const key = r && r.source_key != null ? String(r.source_key) : '';
    const label = r && r.label != null ? String(r.label) : '';
    if (!key || !label) continue;
    const want = labelNormFromLabelAndKey(label, key);
    const have = r && r.label_norm != null ? String(r.label_norm) : '';
    if (!want || have === want) continue;
    await db.run('UPDATE traffic_source_meta SET label_norm = ? WHERE source_key = ?', [want, key]);
    updated += 1;
  }
  return { updated };
}

async function dedupeByLabelNorm(db) {
  // Find duplicate label_norm groups.
  const dupRows = await db.all(
    `
      SELECT label_norm, COUNT(*) AS n
      FROM traffic_source_meta
      WHERE label_norm IS NOT NULL AND TRIM(label_norm) != ''
      GROUP BY label_norm
      HAVING COUNT(*) > 1
    `
  );
  const norms = (dupRows || [])
    .map((r) => (r && r.label_norm != null ? String(r.label_norm) : ''))
    .filter(Boolean);
  if (!norms.length) return { ok: true, mergedGroups: 0, mergedKeys: 0, map: new Map() };

  // Load meta rows once.
  const metaRows = await db.all('SELECT source_key, label, label_norm, icon_url, updated_at FROM traffic_source_meta');
  const byNorm = new Map(); // label_norm -> [{...}]
  for (const r of metaRows || []) {
    const ln = r && r.label_norm != null ? String(r.label_norm) : '';
    if (!ln) continue;
    if (!byNorm.has(ln)) byNorm.set(ln, []);
    byNorm.get(ln).push({
      source_key: r && r.source_key != null ? String(r.source_key).trim().toLowerCase() : '',
      label: r && r.label != null ? String(r.label) : '',
      label_norm: ln,
      icon_url: r && r.icon_url != null ? String(r.icon_url) : null,
      updated_at: r && r.updated_at != null ? Number(r.updated_at) : null,
    });
  }

  const mergeMap = new Map(); // oldKey -> canonicalKey
  let mergedGroups = 0;
  let mergedKeys = 0;
  const now = Date.now();

  for (const ln of norms) {
    const group = byNorm.get(ln) || [];
    const keys = group.map((g) => g.source_key).filter(Boolean);
    if (keys.length < 2) continue;

    // Compute usage (sessions + rules) for keys in this group.
    const sessionsByKey = new Map();
    try {
      const sessRows = await db.all(
        `SELECT traffic_source_key AS source_key, COUNT(*) AS n FROM sessions WHERE traffic_source_key IN (${placeholders(keys.length)}) GROUP BY traffic_source_key`,
        keys
      );
      for (const r of sessRows || []) {
        const k = r && r.source_key != null ? String(r.source_key).trim().toLowerCase() : '';
        if (!k) continue;
        sessionsByKey.set(k, r && r.n != null ? Number(r.n) || 0 : 0);
      }
    } catch (_) {}

    const rulesByKey = new Map();
    try {
      const ruleRows = await db.all(
        `SELECT source_key, COUNT(*) AS n FROM traffic_source_rules WHERE source_key IN (${placeholders(keys.length)}) GROUP BY source_key`,
        keys
      );
      for (const r of ruleRows || []) {
        const k = r && r.source_key != null ? String(r.source_key).trim().toLowerCase() : '';
        if (!k) continue;
        rulesByKey.set(k, r && r.n != null ? Number(r.n) || 0 : 0);
      }
    } catch (_) {}

    function usageScore(k) {
      const s = sessionsByKey.has(k) ? (sessionsByKey.get(k) || 0) : 0;
      const rr = rulesByKey.has(k) ? (rulesByKey.get(k) || 0) : 0;
      // Sessions dominate; rules are secondary signal.
      return s * 1000000 + rr;
    }

    // Prefer built-in keys for known sources (so future mappings don't re-split).
    const builtIn = builtInTrafficSourceKeyFromFlatLabel(ln);
    let canonicalKey = builtIn ? builtIn : '';
    if (!canonicalKey) {
      canonicalKey = keys
        .slice()
        .sort((a, b) => (usageScore(b) - usageScore(a)) || (String(a).localeCompare(String(b))))
        [0];
    }
    canonicalKey = String(canonicalKey || '').trim().toLowerCase();
    if (!canonicalKey) continue;

    // If canonical key doesn't exist yet, create it (using the most-used row as label/icon baseline).
    if (!keys.includes(canonicalKey)) {
      const primary = group
        .slice()
        .sort((a, b) => (usageScore(b.source_key) - usageScore(a.source_key)) || ((b.updated_at || 0) - (a.updated_at || 0)))[0];
      const label = primary && primary.label ? String(primary.label) : canonicalKey;
      const iconUrl = primary && primary.icon_url != null ? String(primary.icon_url) : null;
      await db.run(
        `
          INSERT INTO traffic_source_meta (source_key, label, label_norm, icon_url, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (source_key) DO UPDATE SET
            label = excluded.label,
            label_norm = excluded.label_norm,
            icon_url = COALESCE(excluded.icon_url, traffic_source_meta.icon_url),
            updated_at = excluded.updated_at
        `,
        [canonicalKey, label, ln, iconUrl, now]
      );
    }

    // Build a set of canonical token pairs (utm_param\0utm_value) to avoid rule unique violations.
    const canonicalPairs = new Set();
    try {
      const canonRules = await db.all('SELECT utm_param, utm_value FROM traffic_source_rules WHERE source_key = ?', [canonicalKey]);
      for (const r of canonRules || []) {
        const p = r && r.utm_param != null ? String(r.utm_param) : '';
        const v = r && r.utm_value != null ? String(r.utm_value) : '';
        if (!p || !v) continue;
        canonicalPairs.add(p + '\0' + v);
      }
    } catch (_) {}

    let groupMerged = false;

    for (const oldKey of keys) {
      if (!oldKey || oldKey === canonicalKey) continue;

      // Backup meta row (once) before delete.
      const meta = group.find((g) => g.source_key === oldKey);
      if (meta) {
        await db.run(
          `
            INSERT INTO traffic_source_meta_dedupe_backup (backup_at, source_key, label, label_norm, icon_url, updated_at, dedupe_to_key)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          [now, oldKey, meta.label || oldKey, meta.label_norm || null, meta.icon_url || null, meta.updated_at != null ? meta.updated_at : null, canonicalKey]
        );
      }

      // Re-point sessions.
      try {
        await db.run('UPDATE sessions SET traffic_source_key = ? WHERE traffic_source_key = ?', [canonicalKey, oldKey]);
      } catch (_) {}

      // Re-point rules (delete any that would conflict).
      try {
        const oldRules = await db.all(
          'SELECT id, utm_param, utm_value, created_at FROM traffic_source_rules WHERE source_key = ? ORDER BY id ASC',
          [oldKey]
        );
        for (const r of oldRules || []) {
          const id = r && r.id != null ? Number(r.id) : null;
          const p = r && r.utm_param != null ? String(r.utm_param) : '';
          const v = r && r.utm_value != null ? String(r.utm_value) : '';
          const createdAt = r && r.created_at != null ? Number(r.created_at) : null;
          if (!id || !p || !v) continue;
          const pair = p + '\0' + v;
          if (canonicalPairs.has(pair)) {
            await db.run(
              `
                INSERT INTO traffic_source_rules_dedupe_backup (backup_at, id, utm_param, utm_value, source_key, created_at, dedupe_to_key)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `,
              [now, id, p, v, oldKey, createdAt, canonicalKey]
            );
            await db.run('DELETE FROM traffic_source_rules WHERE id = ?', [id]);
          } else {
            await db.run('UPDATE traffic_source_rules SET source_key = ? WHERE id = ?', [canonicalKey, id]);
            canonicalPairs.add(pair);
          }
        }
      } catch (_) {}

      // Delete meta row.
      try {
        await db.run('DELETE FROM traffic_source_meta WHERE source_key = ?', [oldKey]);
      } catch (_) {}

      mergeMap.set(oldKey, canonicalKey);
      mergedKeys += 1;
      groupMerged = true;
    }

    if (groupMerged) {
      mergedGroups += 1;
      groupMerged = false;
    }
  }

  return { ok: true, mergedGroups, mergedKeys, map: mergeMap };
}

async function rewriteEnabledSourcesSetting(db, mergeMap) {
  if (!mergeMap || typeof mergeMap.get !== 'function' || mergeMap.size === 0) return { ok: true, changed: false };
  try {
    const row = await db.get('SELECT value FROM settings WHERE key = ?', ['traffic_sources_enabled']);
    const raw = row && row.value != null ? String(row.value) : '';
    if (!raw) return { ok: true, changed: false };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
    const arr = Array.isArray(parsed) ? parsed : [];
    const out = [];
    const seen = new Set();
    for (const v of arr) {
      const k0 = typeof v === 'string' ? v.trim().toLowerCase() : '';
      if (!k0) continue;
      const k = mergeMap.has(k0) ? mergeMap.get(k0) : k0;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    const next = JSON.stringify(out);
    if (next === raw) return { ok: true, changed: false };
    if (isPostgres()) {
      await db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['traffic_sources_enabled', next]);
    } else {
      await db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['traffic_sources_enabled', next]);
    }
    return { ok: true, changed: true };
  } catch (_) {
    return { ok: false, changed: false };
  }
}

async function up() {
  const db = getDb();
  await ensureLabelNormColumn(db);
  await ensureBackupTables(db);
  await backfillLabelNorm(db);
  const dedupeRes = await dedupeByLabelNorm(db);
  try { await rewriteEnabledSourcesSetting(db, dedupeRes && dedupeRes.map ? dedupeRes.map : new Map()); } catch (_) {}
  await backfillLabelNorm(db); // ensure canonical rows created have label_norm
  await ensureUniqueIndex(db);
}

module.exports = { up };

