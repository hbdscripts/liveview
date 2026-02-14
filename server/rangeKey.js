/**
 * Shared range key normalization for API endpoints.
 *
 * UI uses friendly keys like "7days" but server bounds use "7d".
 * Many endpoints also accept custom keys:
 * - d:YYYY-MM-DD
 * - r:YYYY-MM-DD:YYYY-MM-DD
 */

const DEFAULT_ALLOWED = new Set(['today', 'yesterday', '3d', '7d', '14d', '30d', 'month']);

function isCustomDayKey(v) {
  return typeof v === 'string' && /^d:\d{4}-\d{2}-\d{2}$/.test(v);
}

function isCustomRangeKey(v) {
  return typeof v === 'string' && /^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(v);
}

function normalizeFriendlyDaysKey(r) {
  if (r === '7days') return '7d';
  if (r === '14days') return '14d';
  if (r === '30days') return '30d';
  return r;
}

/**
 * Normalize a raw `range` query param into an allowed key.
 *
 * @param {any} raw
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.allowed] Allowed canonical keys (case-insensitive).
 * @param {string} [opts.defaultKey]
 * @param {boolean} [opts.allowCustomDay]
 * @param {boolean} [opts.allowCustomRange]
 * @param {boolean} [opts.allowFriendlyDays]
 */
function normalizeRangeKey(raw, opts = {}) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const defaultKey = options.defaultKey != null ? String(options.defaultKey).trim().toLowerCase() : 'today';
  const allowCustomDay = options.allowCustomDay !== false;
  const allowCustomRange = options.allowCustomRange !== false;
  const allowFriendlyDays = options.allowFriendlyDays !== false;

  const allowedInput = options.allowed != null ? options.allowed : DEFAULT_ALLOWED;
  const allowed = allowedInput instanceof Set
    ? new Set(Array.from(allowedInput).map((k) => String(k).trim().toLowerCase()).filter(Boolean))
    : new Set((Array.isArray(allowedInput) ? allowedInput : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean));

  let r = raw != null ? String(raw).trim().toLowerCase() : '';
  if (!r) return defaultKey || 'today';
  if (allowFriendlyDays) r = normalizeFriendlyDaysKey(r);

  if (allowed.size ? allowed.has(r) : DEFAULT_ALLOWED.has(r)) return r;
  if (allowCustomDay && isCustomDayKey(r)) return r;
  if (allowCustomRange && isCustomRangeKey(r)) return r;
  return defaultKey || 'today';
}

module.exports = {
  DEFAULT_ALLOWED,
  isCustomDayKey,
  isCustomRangeKey,
  normalizeRangeKey,
};

