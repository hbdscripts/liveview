/**
 * Retention policy (Phase 1): charts/KPIs from rollups, drilldowns from raw events/sessions.
 *
 * This module is the source-of-truth for retention windows and tier normalization.
 * Phase 2 will replace the global/effective tier with per-shop plans.
 */
const { getDb } = require('./db');

const VALID_RETENTION_TIERS = Object.freeze(['starter', 'growth', 'scale', 'max']);

// Order is important: we pick the "max" tier across multiple sources safely.
const TIER_RANK = Object.freeze({
  starter: 1,
  growth: 2,
  scale: 3,
  max: 4,
});

function normalizeRetentionTier(raw) {
  const s = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!s) return null;
  if (s === 'starter' || s === 'growth' || s === 'scale' || s === 'max') return s;
  // Legacy/placeholder plan names used elsewhere in the codebase/UI.
  if (s === 'free') return 'starter';
  if (s === 'pro') return 'max';
  if (s === 'business') return 'max';
  if (s === 'enterprise') return 'max';
  return null;
}

function maxTier(a, b) {
  const na = normalizeRetentionTier(a);
  const nb = normalizeRetentionTier(b);
  if (!na) return nb || null;
  if (!nb) return na || null;
  return (TIER_RANK[na] >= TIER_RANK[nb]) ? na : nb;
}

function getTierLimits(tierRaw) {
  const tier = normalizeRetentionTier(tierRaw) || 'starter';
  if (tier === 'starter') return { tier, chartsRetentionDays: 7, drilldownRetentionDays: 7 };
  if (tier === 'growth') return { tier, chartsRetentionDays: 90, drilldownRetentionDays: 30 };
  if (tier === 'scale') return { tier, chartsRetentionDays: 548, drilldownRetentionDays: 60 }; // 1.5y ≈ 548d
  return { tier: 'max', chartsRetentionDays: 1095, drilldownRetentionDays: 90 }; // 3y = 1095d
}

async function getHighestActiveUserTier() {
  // Phase 1: single-install tier. Safest default is to pick the highest tier among active users.
  // If there are no users (or table missing), return null and caller decides fallback.
  try {
    const db = getDb();
    const rows = await db.all(`SELECT tier FROM users WHERE status = 'active'`);
    let best = null;
    for (const r of rows || []) {
      best = maxTier(best, r && r.tier != null ? r.tier : null);
    }
    return best;
  } catch (_) {
    return null;
  }
}

let _cachedEffective = null;
let _cachedEffectiveAt = 0;
const EFFECTIVE_TIER_CACHE_MS = 5 * 60 * 1000;

async function getEffectiveRetentionTier(config) {
  // Resolution order (fail-safe / prevents accidental deletion):
  // - explicit env/config override
  // - highest tier among active users
  // - default starter
  const now = Date.now();
  if (_cachedEffective && (now - _cachedEffectiveAt) < EFFECTIVE_TIER_CACHE_MS) return _cachedEffective;

  const envTier =
    normalizeRetentionTier(config && (config.retentionTier || config.planTier)) ||
    normalizeRetentionTier(process.env.RETENTION_TIER) ||
    normalizeRetentionTier(process.env.PLAN_TIER) ||
    normalizeRetentionTier(process.env.BILLING_TIER);

  let tier = envTier;
  if (!tier) {
    const userTier = await getHighestActiveUserTier();
    tier = userTier || null;
  }

  _cachedEffective = tier || 'starter';
  _cachedEffectiveAt = now;
  return _cachedEffective;
}

module.exports = {
  VALID_RETENTION_TIERS,
  normalizeRetentionTier,
  maxTier,
  getTierLimits,
  getEffectiveRetentionTier,
};

