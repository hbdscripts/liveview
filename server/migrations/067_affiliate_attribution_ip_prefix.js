/**
 * Affiliate attribution: ip_prefix + velocity-friendly indexes.
 *
 * - ip_prefix: privacy-safe IPv4 /24 or IPv6 /64 for proxy/rotation detection.
 * - Indexes on (ip_hash, first_seen_at), (ua_hash, first_seen_at), (ip_prefix, first_seen_at)
 *   for fraud velocity queries.
 */
const { getDb, isPostgres } = require('../db');

async function up() {
  const db = getDb();

  if (isPostgres()) {
    await db.run('ALTER TABLE affiliate_attribution_sessions ADD COLUMN IF NOT EXISTS ip_prefix TEXT');
  } else {
    try {
      await db.run('ALTER TABLE affiliate_attribution_sessions ADD COLUMN ip_prefix TEXT');
    } catch (e) {
      if (!/duplicate column name/i.test(e && e.message ? String(e.message) : '')) throw e;
    }
  }

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_ip_hash_first_seen ON affiliate_attribution_sessions(ip_hash, first_seen_at)',
    'CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_ua_hash_first_seen ON affiliate_attribution_sessions(ua_hash, first_seen_at)',
    'CREATE INDEX IF NOT EXISTS idx_affiliate_attribution_ip_prefix_first_seen ON affiliate_attribution_sessions(ip_prefix, first_seen_at)',
  ];
  for (const sql of indexes) {
    await db.run(sql).catch(() => null);
  }
}

module.exports = { up };
