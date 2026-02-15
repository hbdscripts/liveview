const store = require('../store');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const { normalizeRangeKey } = require('../rangeKey');
const {
  VARIANTS_CONFIG_KEY,
  normalizeVariantsConfigV1,
  normalizeVariantsConfigForSave,
  validateConfigStructure,
  validateConfigAgainstVariants,
} = require('../variantInsightsConfig');
const { RANGE_KEYS, getObservedVariantsForValidation } = require('../variantInsightsService');
const { buildVariantMappingSuggestions } = require('../variantInsightsSuggestions');

function safeJsonParseObject(raw) {
  try {
    if (!raw) return null;
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') return parsed;
    return null;
  } catch (_) {
    return null;
  }
}

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function uniqueByLower(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const s = item == null ? '' : String(item).trim();
    const k = s.toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function mergeSeedTablesIntoConfig(baseConfig, seedTables) {
  const base = baseConfig && typeof baseConfig === 'object' ? baseConfig : { v: 1, tables: [] };
  const incoming = Array.isArray(seedTables) ? seedTables : [];
  const tables = Array.isArray(base.tables) ? base.tables.slice() : [];
  const byId = new Map();
  const byNameOrAlias = new Map();
  for (const t of tables) {
    if (!t || !t.id) continue;
    const idKey = String(t.id).trim().toLowerCase();
    byId.set(idKey, t);
    const nameKey = String(t.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (nameKey && !byNameOrAlias.has(nameKey)) byNameOrAlias.set(nameKey, t);
    const aliases = Array.isArray(t.aliases) ? t.aliases : [];
    for (const a of aliases) {
      const ak = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!ak) continue;
      if (!byNameOrAlias.has(ak)) byNameOrAlias.set(ak, t);
    }
  }

  let maxOrder = 0;
  for (const t of tables) {
    const o = Number(t && t.order);
    if (Number.isFinite(o) && o > maxOrder) maxOrder = o;
  }

  for (const seed of incoming) {
    if (!seed || !seed.id) continue;
    const idKey = String(seed.id).trim().toLowerCase();
    let existing = byId.get(idKey) || null;
    if (!existing) {
      const candidates = [];
      const seedNameKey = String(seed.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (seedNameKey) candidates.push(seedNameKey);
      const seedAliases = Array.isArray(seed.aliases) ? seed.aliases : [];
      for (const a of seedAliases) {
        const ak = String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (ak) candidates.push(ak);
      }
      for (const k of candidates) {
        if (!k) continue;
        const hit = byNameOrAlias.get(k);
        if (hit) {
          existing = hit;
          break;
        }
      }
    }
    if (!existing) {
      maxOrder += 1;
      tables.push({
        id: seed.id,
        name: seed.name || seed.id,
        enabled: seed.enabled !== false,
        order: maxOrder,
        aliases: Array.isArray(seed.aliases) ? seed.aliases : [],
        rules: Array.isArray(seed.rules) ? seed.rules : [],
        ignored: Array.isArray(seed.ignored) ? seed.ignored : [],
      });
      continue;
    }

    // Merge table aliases additively (helps map multiple Shopify option labels to one table).
    const existingAliases = Array.isArray(existing.aliases) ? existing.aliases : [];
    const seedAliases = Array.isArray(seed.aliases) ? seed.aliases : [];
    existing.aliases = uniqueByLower(existingAliases.concat(seedAliases));

    // Merge rules additively (do not delete existing).
    const existingRules = Array.isArray(existing.rules) ? existing.rules : [];
    const existingByLabel = new Map();
    for (const er of existingRules) {
      if (!er) continue;
      const labelKey = String(er.label || er.id || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (!labelKey) continue;
      if (!existingByLabel.has(labelKey)) existingByLabel.set(labelKey, er);
    }
    const existingIncludeFingerprints = new Set(
      existingRules.map((r) => {
        const inc = Array.isArray(r && r.include) ? r.include : [];
        return inc.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).sort().join('|');
      }).filter(Boolean)
    );
    const existingRuleIds = new Set(existingRules.map((r) => (r && r.id ? String(r.id).trim().toLowerCase() : '')).filter(Boolean));
    const additions = [];
    for (const r of (Array.isArray(seed.rules) ? seed.rules : [])) {
      if (!r) continue;
      const inc = Array.isArray(r.include) ? r.include : [];
      const exc = Array.isArray(r.exclude) ? r.exclude : [];

      // If a rule with the same output label already exists, merge aliases into it (avoid duplicate rows like "Gold" twice).
      const seedLabelKey = String(r.label || r.id || '').trim().toLowerCase().replace(/\s+/g, ' ');
      const byLabel = seedLabelKey ? existingByLabel.get(seedLabelKey) : null;
      if (byLabel) {
        const mergedInc = uniqueByLower([...(Array.isArray(byLabel.include) ? byLabel.include : []), ...inc]);
        const mergedExc = uniqueByLower([...(Array.isArray(byLabel.exclude) ? byLabel.exclude : []), ...exc]);
        byLabel.include = mergedInc;
        byLabel.exclude = mergedExc;
        continue;
      }
      const fp = inc.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean).sort().join('|');
      if (fp && existingIncludeFingerprints.has(fp)) continue;
      let rid = r.id ? String(r.id) : '';
      let ridKey = rid.trim().toLowerCase();
      if (!ridKey || existingRuleIds.has(ridKey)) {
        // Ensure stable-ish IDs without colliding; fallback to label.
        const baseId = String(r.label || 'rule').trim();
        rid = baseId
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 80) || 'rule';
        ridKey = rid;
        let i = 2;
        while (existingRuleIds.has(ridKey)) {
          ridKey = `${rid}-${i}`;
          i += 1;
        }
        rid = ridKey;
      }
      existingRuleIds.add(ridKey);
      additions.push({
        id: rid,
        label: r.label || r.id || 'Rule',
        include: uniqueByLower(inc),
        exclude: uniqueByLower(exc),
      });
    }
    existing.rules = existingRules.concat(additions);

    // If seed explicitly enables the table, enable it.
    if (seed.enabled === true) existing.enabled = true;
  }

  return { ...base, v: 1, tables };
}

function normalizeRange(rangeRaw) {
  return normalizeRangeKey(rangeRaw || '30d', { defaultKey: '30d', allowed: RANGE_KEYS });
}

async function getInsightsVariantsSuggestions(req, res) {
  const rawShop = (req.query.shop || '').trim().toLowerCase();
  const shop = salesTruth.resolveShopForSales(rawShop) || salesTruth.resolveShopForSales('') || rawShop;
  const range = normalizeRange(req.query.range);
  const refresh = !!(req.query && (req.query.refresh === '1' || req.query.refresh === 'true'));
  const force = refresh || !!(req.query && (req.query.force === '1' || req.query.force === 'true' || req.query._));

  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ ok: false, error: 'invalid_shop', message: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);
  const maxVariants = clampInt(req.query.maxVariants, 450, 50, 1500);

  try {
    const cached = await reportCache.getOrComputeJson(
      {
        shop,
        endpoint: 'insights-variants-suggestions',
        rangeKey: range,
        rangeStartTs: start,
        rangeEndTs: end,
        params: { maxVariants },
        ttlMs: 10 * 60 * 1000,
        force,
      },
      async () => {
        if (refresh) {
          try {
            const truthScope = salesTruth.scopeForRangeKey(range, 'range');
            if (range === 'today') {
              await salesTruth.ensureReconciled(shop, start, end, truthScope);
            } else {
              salesTruth.ensureReconciled(shop, start, end, truthScope).catch(() => {});
            }
          } catch (_) {}
        }

        const suggestions = await buildVariantMappingSuggestions({ shop, start, end, maxVariants });
        return {
          ok: true,
          shop,
          range,
          start,
          end,
          suggestions: suggestions && Array.isArray(suggestions.suggestions) ? suggestions.suggestions : [],
          observed: suggestions && suggestions.observed ? suggestions.observed : { variants: 0 },
          notice: suggestions && suggestions.ok ? null : (suggestions && suggestions.error ? suggestions.error : 'suggestions_unavailable'),
        };
      }
    );

    res.setHeader('Cache-Control', 'private, max-age=600');
    res.setHeader('Vary', 'Cookie');
    return res.json(cached && cached.ok ? cached.data : { ok: true, shop, range, start, end, suggestions: [], observed: { variants: 0 }, notice: 'cache_failed' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'suggestions_failed' });
  }
}

async function postApplyInsightsVariantsSuggestions(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).set('Allow', 'POST').end();
  }
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const rawShop = (body.shop || '').trim().toLowerCase();
  const shop = salesTruth.resolveShopForSales(rawShop) || salesTruth.resolveShopForSales('') || rawShop;
  const range = normalizeRange(body.range);
  const timeZone = store.resolveAdminTimeZone();
  const nowMs = Date.now();
  const { start, end } = store.getRangeBounds(range, nowMs, timeZone);

  const baseConfig = safeJsonParseObject(body.baseConfig) || null;
  const seedTables = Array.isArray(body.seedTables) ? body.seedTables : [];
  const merged = mergeSeedTablesIntoConfig(baseConfig || normalizeVariantsConfigV1(await store.getSetting(VARIANTS_CONFIG_KEY).catch(() => null)), seedTables);
  const normalized = normalizeVariantsConfigForSave(merged);

  const structureValidation = validateConfigStructure(normalized);
  if (!structureValidation.ok) {
    return res.status(400).json({
      ok: false,
      error: 'insights_variants_config_invalid',
      message: 'Variants settings are invalid. Fix the listed issues and try again.',
      details: { stage: 'structure', errors: structureValidation.errors || [] },
    });
  }

  // Non-blocking coverage validation (warnings only).
  let warnings = null;
  try {
    if (shop && shop.endsWith('.myshopify.com')) {
      const observed = await getObservedVariantsForValidation({
        shop,
        start: Date.now() - 365 * 24 * 60 * 60 * 1000,
        end: Date.now(),
        maxRows: 5000,
      });
      const coverage = validateConfigAgainstVariants(normalized, observed, { maxExamples: 40 });
      if (coverage && !coverage.ok) {
        warnings = {
          stage: 'coverage',
          observedCount: Array.isArray(observed) ? observed.length : 0,
          tables: coverage.tables || [],
        };
      }
    }
  } catch (_) {}

  try {
    const json = JSON.stringify(normalized);
    if (json.length > 120000) throw new Error('Variants config too large');
    await store.setSetting(VARIANTS_CONFIG_KEY, json);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save variants config' });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    ok: true,
    shop,
    range,
    start,
    end,
    insightsVariantsConfig: normalized,
    warnings,
  });
}

module.exports = {
  getInsightsVariantsSuggestions,
  postApplyInsightsVariantsSuggestions,
};

