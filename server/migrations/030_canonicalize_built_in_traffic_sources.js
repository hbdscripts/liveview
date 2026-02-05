/**
 * Canonicalize built-in traffic sources (google_ads, bing_ads, direct, etc).
 *
 * Why:
 * - It’s possible to end up with a custom source key whose label is identical to a built-in channel
 *   (e.g. a custom key labeled “Bing Ads”), while sessions derived from click IDs (msclkid) still use `bing_ads`.
 * - That splits reporting across two keys and looks like a “duplicate source”.
 *
 * What this migration does:
 * - For any `traffic_source_meta` row whose normalized label matches a built-in key,
 *   merge that source_key INTO the built-in key by:
 *   - updating `sessions.traffic_source_key`
 *   - updating `traffic_source_rules.source_key` (handling unique conflicts)
 *   - moving enabled prefs (`settings.traffic_sources_enabled`)
 *   - backing up deleted rows, then deleting the old meta row
 *
 * Idempotent: safe to run on every startup.
 */
const { getDb, isPostgres } = require('../db');

function normalizeFlatLabel(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return '';
  return s.replace(/[^a-z0-9]+/g, '').slice(0, 128);
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

  const now = Date.now();
  const metaRows = await db.all('SELECT source_key, label, label_norm, icon_url, updated_at FROM traffic_source_meta');
  const byKey = new Map();
  for (const r of metaRows || []) {
    const key = r && r.source_key != null ? String(r.source_key).trim().toLowerCase() : '';
    if (!key) continue;
    const label = r && r.label != null ? String(r.label) : key;
    const labelNorm = r && r.label_norm != null ? String(r.label_norm) : '';
    const ln = labelNorm && labelNorm.trim() ? String(labelNorm).trim() : normalizeFlatLabel(label);
    byKey.set(key, {
      source_key: key,
      label,
      label_norm: ln,
      icon_url: r && r.icon_url != null ? String(r.icon_url) : null,
      updated_at: r && r.updated_at != null ? Number(r.updated_at) : null,
    });
  }

  const mergeMap = new Map(); // old -> canonical

  for (const [oldKey, row] of byKey.entries()) {
    const ln = row && row.label_norm ? String(row.label_norm) : '';
    const canonical = builtInTrafficSourceKeyFromFlatLabel(ln);
    if (!canonical) continue;
    const canonicalKey = String(canonical).trim().toLowerCase();
    if (!canonicalKey || canonicalKey === oldKey) continue;

    // Ensure canonical meta exists (after deleting old row if needed to satisfy unique label constraints).
    const existingCanon = await db.get('SELECT source_key, label, icon_url, updated_at FROM traffic_source_meta WHERE source_key = ? LIMIT 1', [canonicalKey]);
    if (!existingCanon) {
      // Backup old meta before delete.
      await db.run(
        `
          INSERT INTO traffic_source_meta_dedupe_backup (backup_at, source_key, label, label_norm, icon_url, updated_at, dedupe_to_key)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [now, oldKey, row.label || oldKey, ln || null, row.icon_url || null, row.updated_at != null ? row.updated_at : null, canonicalKey]
      );

      // Re-point sessions + rules first (no FK constraints).
      try { await db.run('UPDATE sessions SET traffic_source_key = ? WHERE traffic_source_key = ?', [canonicalKey, oldKey]); } catch (_) {}

      // Re-point rules (delete conflicts).
      try {
        const canonPairs = new Set();
        const canonRules = await db.all('SELECT utm_param, utm_value FROM traffic_source_rules WHERE source_key = ?', [canonicalKey]);
        for (const r of canonRules || []) {
          const p = r && r.utm_param != null ? String(r.utm_param) : '';
          const v = r && r.utm_value != null ? String(r.utm_value) : '';
          if (!p || !v) continue;
          canonPairs.add(p + '\0' + v);
        }
        const oldRules = await db.all('SELECT id, utm_param, utm_value, created_at FROM traffic_source_rules WHERE source_key = ? ORDER BY id ASC', [oldKey]);
        for (const r of oldRules || []) {
          const id = r && r.id != null ? Number(r.id) : null;
          const p = r && r.utm_param != null ? String(r.utm_param) : '';
          const v = r && r.utm_value != null ? String(r.utm_value) : '';
          const createdAt = r && r.created_at != null ? Number(r.created_at) : null;
          if (!id || !p || !v) continue;
          const pair = p + '\0' + v;
          if (canonPairs.has(pair)) {
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
            canonPairs.add(pair);
          }
        }
      } catch (_) {}

      // Delete old meta row so we can insert canonical with this label_norm under a unique index.
      try { await db.run('DELETE FROM traffic_source_meta WHERE source_key = ?', [oldKey]); } catch (_) {}

      // Create canonical meta using old label/icon. Keep label_norm = ln.
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
        [canonicalKey, row.label || canonicalKey, ln || normalizeFlatLabel(row.label || canonicalKey), row.icon_url || null, now]
      );
    } else {
      // Canonical row exists: merge old into it (backup + repoint + delete).
      await db.run(
        `
          INSERT INTO traffic_source_meta_dedupe_backup (backup_at, source_key, label, label_norm, icon_url, updated_at, dedupe_to_key)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [now, oldKey, row.label || oldKey, ln || null, row.icon_url || null, row.updated_at != null ? row.updated_at : null, canonicalKey]
      );
      try { await db.run('UPDATE sessions SET traffic_source_key = ? WHERE traffic_source_key = ?', [canonicalKey, oldKey]); } catch (_) {}
      try {
        const canonPairs = new Set();
        const canonRules = await db.all('SELECT utm_param, utm_value FROM traffic_source_rules WHERE source_key = ?', [canonicalKey]);
        for (const r of canonRules || []) {
          const p = r && r.utm_param != null ? String(r.utm_param) : '';
          const v = r && r.utm_value != null ? String(r.utm_value) : '';
          if (!p || !v) continue;
          canonPairs.add(p + '\0' + v);
        }
        const oldRules = await db.all('SELECT id, utm_param, utm_value, created_at FROM traffic_source_rules WHERE source_key = ? ORDER BY id ASC', [oldKey]);
        for (const r of oldRules || []) {
          const id = r && r.id != null ? Number(r.id) : null;
          const p = r && r.utm_param != null ? String(r.utm_param) : '';
          const v = r && r.utm_value != null ? String(r.utm_value) : '';
          const createdAt = r && r.created_at != null ? Number(r.created_at) : null;
          if (!id || !p || !v) continue;
          const pair = p + '\0' + v;
          if (canonPairs.has(pair)) {
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
            canonPairs.add(pair);
          }
        }
      } catch (_) {}

      // If canonical meta has no icon_url and old does, carry it over.
      try {
        if (row.icon_url && (!existingCanon.icon_url || !String(existingCanon.icon_url).trim())) {
          await db.run('UPDATE traffic_source_meta SET icon_url = ?, updated_at = ? WHERE source_key = ?', [row.icon_url, now, canonicalKey]);
        }
      } catch (_) {}
      try { await db.run('DELETE FROM traffic_source_meta WHERE source_key = ?', [oldKey]); } catch (_) {}
    }

    mergeMap.set(oldKey, canonicalKey);
  }

  try { await rewriteEnabledSourcesSetting(db, mergeMap); } catch (_) {}
}

module.exports = { up };

