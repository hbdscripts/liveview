/**
 * Acquisition → Attribution + Devices (persisted at write-time).
 *
 * - New config tables:
 *   - attribution_channels, attribution_sources, attribution_variants
 *   - attribution_rules (rule-based mapping)
 *   - attribution_allowlist (explicit kexo_attr allowlist)
 *   - attribution_observed (observed unmapped tokens for mapping UI)
 * - Persisted fields (sessions + orders_shopify):
 *   - attribution_* + device_key
 */
const { getDb, isPostgres } = require('../db');

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS attribution_channels (
  channel_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_channels_enabled_order ON attribution_channels(enabled, sort_order);

CREATE TABLE IF NOT EXISTS attribution_sources (
  source_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon_spec TEXT,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_sources_enabled_order ON attribution_sources(enabled, sort_order);

CREATE TABLE IF NOT EXISTS attribution_variants (
  variant_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  owner_kind TEXT NOT NULL,
  partner_id TEXT,
  network TEXT,
  icon_spec TEXT,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_variants_enabled_order ON attribution_variants(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_attribution_variants_channel_source ON attribution_variants(channel_key, source_key);

CREATE TABLE IF NOT EXISTS attribution_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  variant_key TEXT NOT NULL,
  match_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_rules_enabled_priority ON attribution_rules(enabled, priority);

CREATE TABLE IF NOT EXISTS attribution_allowlist (
  variant_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_allowlist_enabled ON attribution_allowlist(enabled);

CREATE TABLE IF NOT EXISTS attribution_observed (
  token_type TEXT NOT NULL,
  token_value TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  seen_count INTEGER NOT NULL,
  sample_entry_url TEXT,
  PRIMARY KEY (token_type, token_value)
);
CREATE INDEX IF NOT EXISTS idx_attribution_observed_last_seen ON attribution_observed(last_seen_at, seen_count);
`;

const pgSchema = `
CREATE TABLE IF NOT EXISTS attribution_channels (
  channel_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_channels_enabled_order ON attribution_channels(enabled, sort_order);

CREATE TABLE IF NOT EXISTS attribution_sources (
  source_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon_spec TEXT,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_sources_enabled_order ON attribution_sources(enabled, sort_order);

CREATE TABLE IF NOT EXISTS attribution_variants (
  variant_key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  channel_key TEXT NOT NULL,
  source_key TEXT NOT NULL,
  owner_kind TEXT NOT NULL,
  partner_id TEXT,
  network TEXT,
  icon_spec TEXT,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_variants_enabled_order ON attribution_variants(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_attribution_variants_channel_source ON attribution_variants(channel_key, source_key);

CREATE TABLE IF NOT EXISTS attribution_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  priority INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  variant_key TEXT NOT NULL,
  match_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_rules_enabled_priority ON attribution_rules(enabled, priority);

CREATE TABLE IF NOT EXISTS attribution_allowlist (
  variant_key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attribution_allowlist_enabled ON attribution_allowlist(enabled);

CREATE TABLE IF NOT EXISTS attribution_observed (
  token_type TEXT NOT NULL,
  token_value TEXT NOT NULL,
  first_seen_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  seen_count INTEGER NOT NULL,
  sample_entry_url TEXT,
  PRIMARY KEY (token_type, token_value)
);
CREATE INDEX IF NOT EXISTS idx_attribution_observed_last_seen ON attribution_observed(last_seen_at, seen_count);
`;

async function safeAddColumnSqlite(db, table, column, type) {
  try {
    await db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (!/duplicate column name/i.test(msg)) throw e;
  }
}

async function seedDefaults(db) {
  const now = Date.now();
  const channels = [
    ['paid_search', 'Paid search', 10],
    ['organic_search', 'Organic search', 20],
    ['paid_social', 'Paid social', 30],
    ['organic_social', 'Organic social', 40],
    ['email', 'Email', 50],
    ['sms', 'SMS', 60],
    ['affiliate', 'Affiliate', 70],
    ['referral', 'Referral', 80],
    ['direct', 'Direct', 90],
    ['other', 'Other', 999],
  ];
  const sources = [
    ['google', 'Google', null, 10],
    ['bing', 'Bing', null, 20],
    ['meta', 'Meta', null, 30],
    ['tiktok', 'TikTok', null, 40],
    ['pinterest', 'Pinterest', null, 50],
    ['omnisend', 'Omnisend', null, 60],
    ['klaviyo', 'Klaviyo', null, 70],
    ['direct', 'Direct', null, 90],
    ['other', 'Other', null, 999],
  ];
  const variants = [
    ['direct:house', 'Direct', 'direct', 'direct', 'house', null, null, null, 10],
    ['google_organic:house', 'Google (organic)', 'organic_search', 'google', 'house', null, null, null, 20],
    ['google_ads:house', 'Google Ads', 'paid_search', 'google', 'house', null, null, null, 30],
    ['meta_ads:house', 'Meta Ads', 'paid_social', 'meta', 'house', null, null, null, 40],
    ['meta_organic:house', 'Meta (organic)', 'organic_social', 'meta', 'house', null, null, null, 50],
    ['other:house', 'Other', 'other', 'other', 'house', null, null, null, 999],
  ];

  if (isPostgres()) {
    for (const [k, label, sortOrder] of channels) {
      await db.run(
        `
          INSERT INTO attribution_channels (channel_key, label, sort_order, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (channel_key) DO NOTHING
        `,
        [k, label, sortOrder, 1, now]
      );
    }
    for (const [k, label, iconSpec, sortOrder] of sources) {
      await db.run(
        `
          INSERT INTO attribution_sources (source_key, label, icon_spec, sort_order, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (source_key) DO NOTHING
        `,
        [k, label, iconSpec, sortOrder, 1, now]
      );
    }
    for (const [k, label, channelKey, sourceKey, ownerKind, partnerId, network, iconSpec, sortOrder] of variants) {
      await db.run(
        `
          INSERT INTO attribution_variants (variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (variant_key) DO NOTHING
        `,
        [k, label, channelKey, sourceKey, ownerKind, partnerId, network, iconSpec, sortOrder, 1, now]
      );
    }
  } else {
    for (const [k, label, sortOrder] of channels) {
      await db.run(
        'INSERT OR IGNORE INTO attribution_channels (channel_key, label, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?)',
        [k, label, sortOrder, 1, now]
      );
    }
    for (const [k, label, iconSpec, sortOrder] of sources) {
      await db.run(
        'INSERT OR IGNORE INTO attribution_sources (source_key, label, icon_spec, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [k, label, iconSpec, sortOrder, 1, now]
      );
    }
    for (const [k, label, channelKey, sourceKey, ownerKind, partnerId, network, iconSpec, sortOrder] of variants) {
      await db.run(
        'INSERT OR IGNORE INTO attribution_variants (variant_key, label, channel_key, source_key, owner_kind, partner_id, network, icon_spec, sort_order, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [k, label, channelKey, sourceKey, ownerKind, partnerId, network, iconSpec, sortOrder, 1, now]
      );
    }
  }
}

async function up() {
  const db = getDb();

  if (isPostgres()) {
    // Execute full schema in one pass; avoids fragile semicolon splitting.
    await db.exec(pgSchema);
  } else {
    await db.exec(sqliteSchema);
  }

  // Persisted fields on sessions + orders_shopify (write-time derived).
  if (isPostgres()) {
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS device_key TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_channel TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_source TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_variant TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_owner_kind TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_partner_id TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_network TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_confidence TEXT');
    await db.run('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS attribution_evidence_json TEXT');

    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS device_key TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_channel TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_source TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_variant TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_owner_kind TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_partner_id TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_network TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_confidence TEXT');
    await db.run('ALTER TABLE orders_shopify ADD COLUMN IF NOT EXISTS attribution_evidence_json TEXT');
  } else {
    await safeAddColumnSqlite(db, 'sessions', 'device_key', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_channel', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_source', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_variant', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_owner_kind', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_partner_id', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_network', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_confidence', 'TEXT');
    await safeAddColumnSqlite(db, 'sessions', 'attribution_evidence_json', 'TEXT');

    await safeAddColumnSqlite(db, 'orders_shopify', 'device_key', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_channel', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_source', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_variant', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_owner_kind', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_partner_id', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_network', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_confidence', 'TEXT');
    await safeAddColumnSqlite(db, 'orders_shopify', 'attribution_evidence_json', 'TEXT');
  }

  // Performance indexes (best-effort; safe to re-run).
  await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at_device_key_bot ON sessions(started_at, device_key, cf_known_bot)').catch(() => null);
  await db.run('CREATE INDEX IF NOT EXISTS idx_sessions_started_at_attribution_variant_bot ON sessions(started_at, attribution_variant, attribution_owner_kind, cf_known_bot)').catch(() => null);

  // Seed defaults (best-effort).
  await seedDefaults(db).catch(() => null);
}

module.exports = { up };

