function toFiniteNumberOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampInt(n, min, max, fallback) {
  const v = Math.trunc(toFiniteNumberOrNull(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function roundTo(n, decimals) {
  const v = toFiniteNumberOrNull(n);
  if (v == null) return null;
  const d = clampInt(decimals, 0, 6, 0);
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

/**
 * Returns a percentage (0..∞) or null when denominator <= 0 / invalid.
 *
 * - Numerator invalid -> treated as 0.
 * - Denominator invalid / <=0 -> null (undefined rate).
 * - Negative raw values -> null.
 * - Optional clamping can be used for "bounded" percentages.
 */
function percentOrNull(numerator, denominator, options = {}) {
  const n = toFiniteNumberOrNull(numerator);
  const d = toFiniteNumberOrNull(denominator);
  if (d == null || d <= 0) return null;
  const raw = ((n == null ? 0 : n) / d) * 100;
  if (!Number.isFinite(raw) || raw < 0) return null;

  const decimals = options && options.decimals != null ? options.decimals : 1;
  let v = raw;

  const clampMin = toFiniteNumberOrNull(options && options.clampMin);
  const clampMax = toFiniteNumberOrNull(options && options.clampMax);
  if (clampMin != null) v = Math.max(clampMin, v);
  if (clampMax != null) v = Math.min(clampMax, v);

  return roundTo(v, decimals);
}

module.exports = {
  toFiniteNumberOrNull,
  roundTo,
  percentOrNull,
};

