/**
 * Token bucket rate limit per key (visitor_id / session_id).
 * RATE_LIMIT_EVENTS_PER_MINUTE per key.
 */

const config = require('./config');

const buckets = new Map();
const refillRate = config.rateLimitEventsPerMinute / 60;
const capacity = config.rateLimitEventsPerMinute;

// Prevent unbounded growth: prune inactive keys (fail-open).
const PRUNE_AFTER_SECONDS = 10 * 60; // drop keys unused for 10 minutes
const PRUNE_MIN_INTERVAL_SECONDS = 60; // prune at most once per minute
const MAX_BUCKETS = 50_000; // hard cap as a safety valve
let lastPruneAt = 0;

function maybePrune(nowSec) {
  if (buckets.size === 0) return;
  if (buckets.size < 2_000) return; // small maps are cheap; skip
  if ((nowSec - lastPruneAt) < PRUNE_MIN_INTERVAL_SECONDS) return;
  lastPruneAt = nowSec;
  try {
    // 1) Drop inactive keys.
    for (const [k, b] of buckets) {
      const last = b && typeof b.last === 'number' ? b.last : 0;
      if (!last || (nowSec - last) > PRUNE_AFTER_SECONDS) buckets.delete(k);
    }
    // 2) Safety valve: if still huge, drop oldest.
    if (buckets.size > MAX_BUCKETS) {
      const entries = Array.from(buckets.entries());
      entries.sort((a, b) => (a[1]?.last || 0) - (b[1]?.last || 0));
      const toDrop = buckets.size - MAX_BUCKETS;
      for (let i = 0; i < toDrop; i++) buckets.delete(entries[i][0]);
    }
  } catch (_) {
    // ignore
  }
}

function consume(key) {
  const now = Date.now() / 1000;
  maybePrune(now);
  if (!buckets.has(key)) {
    buckets.set(key, { tokens: capacity - 1, last: now });
    return true;
  }
  const b = buckets.get(key);
  const elapsed = now - b.last;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillRate);
  b.last = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

module.exports = { consume };
