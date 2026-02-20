/**
 * Attribution simplification: optional Tags (no ownership/house tier).
 *
 * Adds:
 * - attribution_tags (config)
 * - attribution_rules.tag_key (nullable)
 * - sessions.attribution_tag, orders_shopify.attribution_tag (nullable)
 *
 * Migrates:
 * - attribution_variants schema to drop ownership fields (owner_kind/partner_id/network)
 * - best-effort normalization of legacy variant keys like "*:house" into "*"
 *
 * Notes:
 * - SQLite cannot drop columns; we rebuild the `attribution_variants` table.
 * - Sessions/orders keep legacy ownership columns (if present) but the app stops using them.
 */
const { getDb, isPostgres } = require('../db');

function trimLower(v, maxLen = 256) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normalizeKeyLike(v, maxLen = 120) {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function splitLegacyVariantKey(raw) {
  const key = normalizeKeyLike(raw, 120);
  if (!key) return { variant_key: '', tag_key: '' };

  const m = key.match(/^(.*?):(house|affiliate|partner)(?::(.*))?$/);
  if (!m) return { variant_key: key, tag_key: '' };

  const base = normalizeKeyLike(m[1], 120);
  const kind = trimLower(m[2], 32);
  const rest = normalizeKeyLike(m[3] || '', 120);

  if (!base) return { variant_key: key, tag_key: '' };
  if (kind === 'house') return { variant_key: base, tag_key: '' };

  // For legacy affiliate/partner keys, treat the suffix as the initial tag.
  const tag = rest || kind;
  return { variant_key: base, tag_key: tag };
}

async function safeAddColumnSqlite(db, table, column, type) {
  try {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}

async function tableHasColumn(db, table, column) {
  const t = String(table || '').trim();
  const c = String(column || '').trim();
  if (!t || !c) return false;
  try {
    const row = await db.get(`SELECT ${c} FROM ${t} LIMIT 1`);
    return !!row || row === null;
  } catch (_) {
    return false;
  }
}

async function rebuildAttributionVariantsTableSqlite(db) {
  const hasOwnerKind = await tableHasColumn(db, 'attribution_variants', 'owner_kind');
  if (!hasOwnerKind) return;

  let rows = [];
  try {
    rows = await db.all('SELECT variant_key, label, channel_key, source_key, icon_spec, sort_order, enabled, updated_at FROM attribution_variants');
  } catch (_) {
    rows = [];
  }

  await db.run('ALTER TABLE attribution_variants RENAME TO attribution_variants_old');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS attribution_variants (
      variant_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      channel_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      icon_spec TEXT,
      sort_order INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attribution_variants_enabled_order ON attribution_variants(enabled, sort_order);
    CREATE INDEX IF NOT EXISTS idx_attribution_variants_channel_source ON attribution_variants(channel_key, source_key);
  `);

  const now = Date.now();
  for (const r of rows || []) {
    const { variant_key: baseKey } = splitLegacyVariantKey(r && r.variant_key);
    if (!baseKey) continue;
    const label = (r && r.label != null ? String(r.label) : '').trim() || baseKey;
    const channelKey = trimLower(r && r.channel_key != null ? r.channel_key : '', 32) || 'other';
    const sourceKey = trimLower(r && r.source_key != null ? r.source_key : '', 32) || 'other';
    const iconSpec = r && r.icon_spec != null ? String(r.icon_spec) : null;
    const sortOrder = r && r.sort_order != null ? Number(r.sort_order) : 0;
    const enabled = r && r.enabled != null ? Number(r.enabled) : 1;
    const updatedAt = r && r.updated_at != null ? Number(r.updated_at) : now;
    try {
      await db.run(
        'INSERT OR IGNORE INTO attribution_variants (variant_key, label, channel_key, source_key, icon_spec, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [baseKey, label, channelKey, sourceKey, iconSpec, sortOrder, enabled, updatedAt]
      );
    } catch (_) {}
  }

  try { await db.run('DROP TABLE attribution_variants_old'); } catch (_) {}
}

async function rebuildAttributionVariantsTablePg(db) {
  const hasOwnerKind = await tableHasColumn(db, 'attribution_variants', 'owner_kind');
  if (!hasOwnerKind) return;

  let rows = [];
  try {
    rows = await db.all('SELECT variant_key, label, channel_key, source_key, icon_spec, sort_order, enabled, updated_at FROM attribution_variants');
  } catch (_) {
    rows = [];
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS attribution_variants_v2 (
      variant_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      channel_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      icon_spec TEXT,
      sort_order INTEGER NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attribution_variants_v2_enabled_order ON attribution_variants_v2(enabled, sort_order);
    CREATE INDEX IF NOT EXISTS idx_attribution_variants_v2_channel_source ON attribution_variants_v2(channel_key, source_key);
  `);

  const now = Date.now();
  for (const r of rows || []) {
    const { variant_key: baseKey } = splitLegacyVariantKey(r && r.variant_key);
    if (!baseKey) continue;
    const label = (r && r.label != null ? String(r.label) : '').trim() || baseKey;
    const channelKey = trimLower(r && r.channel_key != null ? r.channel_key : '', 32) || 'other';
    const sourceKey = trimLower(r && r.source_key != null ? r.source_key : '', 32) || 'other';
    const iconSpec = r && r.icon_spec != null ? String(r.icon_spec) : null;
    const sortOrder = r && r.sort_order != null ? Number(r.sort_order) : 0;
    const enabled = r && r.enabled != null ? Number(r.enabled) : 1;
    const updatedAt = r && r.updated_at != null ? Number(r.updated_at) : now;
    try {
      await db.run(
        `
          INSERT INTO attribution_variants_v2 (variant_key, label, channel_key, source_key, icon_spec, sort_order, enabled, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (variant_key) DO NOTHING
        `,
        [baseKey, label, channelKey, sourceKey, iconSpec, sortOrder, enabled, updatedAt]
      );
    } catch (_) {}
  }

  await db.exec('DROP TABLE attribution_variants');
  await db.exec('ALTER TABLE attribution_variants_v2 RENAME TO attribution_variants');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_attribution_variants_enabled_order ON attribution_variants(enabled, sort_order)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_attribution_variants_channel_source ON attribution_variants(channel_key, source_key)');
}

async function normalizeLegacyRuleVariantKeys(db) {
  const hasTagKey = await tableHasColumn(db, 'attribution_rules', 'tag_key');
  if (!hasTagKey) return;

  let rules = [];
  try {
    rules = await db.all('SELECT id, variant_key, tag_key FROM attribution_rules');
  } catch (_) {
    rules = [];
  }
  const now = Date.now();
  for (const r of rules || []) {
    const id = r && r.id != null ? String(r.id) : '';
    if (!id) continue;
    const existingTag = trimLower(r && r.tag_key != null ? r.tag_key : '', 120);
    const { variant_key: baseKey, tag_key: derivedTag } = splitLegacyVariantKey(r && r.variant_key);
    if (!baseKey) continue;
    const nextTag = existingTag || derivedTag || null;
    try {
      if (isPostgres()) {
        await db.run('UPDATE attribution_rules SET variant_key = $1, tag_key = $2, updated_at = $3 WHERE id = $4', [baseKey, nextTag, now, id]);
      } else {
        await db.run('UPDATE attribution_rules SET variant_key = ?, tag_key = ?, updated_at = ? WHERE id = ?', [baseKey, nextTag, now, id]);
      }
    } catch (_) {}
  }
}

async function normalizeLegacyAllowlistVariantKeys(db) {
  let rows = [];
  try {
    rows = await db.all('SELECT variant_key, enabled, updated_at FROM attribution_allowlist');
  } catch (_) {
    rows = [];
  }
  if (!rows.length) return;

  const now = Date.now();
  for (const r of rows || []) {
    const oldKey = normalizeKeyLike(r && r.variant_key, 120);
    if (!oldKey) continue;
    const { variant_key: baseKey } = splitLegacyVariantKey(oldKey);
    if (!baseKey || baseKey === oldKey) continue;
    const enabled = r && r.enabled != null ? Number(r.enabled) : 1;
    const updatedAt = r && r.updated_at != null ? Number(r.updated_at) : now;
    try {
      if (isPostgres()) {
        await db.run(
          `
            INSERT INTO attribution_allowlist (variant_key, enabled, updated_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (variant_key) DO UPDATE SET
              enabled = EXCLUDED.enabled,
              updated_at = EXCLUDED.updated_at
          `,
          [baseKey, enabled, updatedAt]
        );
        await db.run('DELETE FROM attribution_allowlist WHERE variant_key = $1', [oldKey]);
      } else {
        await db.run(
          `
            INSERT INTO attribution_allowlist (variant_key, enabled, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT (variant_key) DO UPDATE SET
              enabled = excluded.enabled,
              updated_at = excluded.updated_at
          `,
          [baseKey, enabled, updatedAt]
        );
        await db.run('DELETE FROM attribution_allowlist WHERE variant_key = ?', [oldKey]);
      }
    } catch (_) {}
  }
}

async function up() {
  const db = getDb();
  const now = Date.now();

  // 1) Tags config table.
  if (isPostgres()) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS attribution_tags (
        tag_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        icon_spec TEXT,
        sort_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attribution_tags_enabled_order ON attribution_tags(enabled, sort_order);
    `);
  } else {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS attribution_tags (
        tag_key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        icon_spec TEXT,
        sort_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_attribution_tags_enabled_order ON attribution_tags(enabled, sort_order);
    `);
  }

  // 2) Extend rules with optional tag_key.
  if (isPostgres()) {
    await db.run('ALTER TABLE attribution_rules ADD COLUMN IF NOT EXISTS tag_key TEXT').catch(() => null);
    await db.run('CREATE INDEX IF NOT EXISTS idx_attribution_rules_tag_key ON attribution_rules(tag_key) WHERE tag_key IS NOT NULL').catch(() => null);
  } else {
    await safeAddColumnSqlite(db, 'attribution_rules', 'tag_key', 'TEXT');
    await db.run('CREATE INDEX IF NOT EXISTS idx_attribution_rules_tag_key ON attribution_rules(tag_key)').catch(() => null);
  }

  // 3) Persisted tag on sessions + orders_shopify.
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_tag TEXT').catch(() => null);
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_tag TEXT').catch(() => null);
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at_attribution_tag_bot ON sessions(started_at, attribution_tag, cf_known_bot)').catch(() => null);
  } else {
    await safeAddColumnSqlite(db, 'sessions', 'attribution_tag', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_tag', 'TEXT');
    await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at_attribution_tag_bot ON sessions(started_at, attribution_tag, cf_known_bot)').catch(() => null);
  }

  // 4) Rebuild variants config table to drop ownership fields and normalize legacy keys.
  if (isPostgres()) await rebuildAttributionVariantsTablePg(db);
  else await rebuildAttributionVariantsTableSqlite(db);

  // 5) Normalize legacy references.
  await normalizeLegacyRuleVariantKeys(db);
  await normalizeLegacyAllowlistVariantKeys(db);

  // 6) Ensure a default "Direct" variant exists.
  try {
    if (isPostgres()) {
      await db.run(
        `
          INSERT INTO attribution_variants (variant_key, label, channel_key, source_key, icon_spec, sort_order, enabled, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (variant_key) DO NOTHING
        `,
        ['direct', 'Direct', 'direct', 'direct', null, 10, 1, now]
      );
    } else {
      await db.run(
        'INSERT OR IGNORE INTO attribution_variants (variant_key, label, channel_key, source_key, icon_spec, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['direct', 'Direct', 'direct', 'direct', null, 10, 1, now]
      );
    }
  } catch (_) {}
}

module.exports = { up };

