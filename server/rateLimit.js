/**
 * Token bucket rate limit per key (visitor_id / session_id).
 * RATE_LIMIT_EVENTS_PER_MINUTE per key.
 */

const config = require('./config');

const buckets = new Map();
const refillRate = config.rateLimitEventsPerMinute / 60;
const capacity = config.rateLimitEventsPerMinute;

function consume(key) {
  const now = Date.now() / 1000;
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
