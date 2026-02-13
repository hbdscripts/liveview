const crypto = require('crypto');

const VARIANTS_CONFIG_KEY = 'insights_variants_config_v1';
const VARIANTS_CONFIG_VERSION = 1;

const FINISH_RULES = [
  {
    id: 'solid_silver',
    label: 'Solid Silver',
    include: ['solid silver'],
    exclude: ['sterling silver', '925 silver', '925 sterling silver'],
  },
  {
    id: 'gold',
    label: 'Gold',
    include: ['18k gold', '18ct gold', '14ct gold', 'gold'],
    exclude: ['gold vermeil'],
  },
  {
    id: 'silver',
    label: 'Silver',
    include: ['925 sterling silver', 'sterling silver', '925 silver', 'silver'],
    exclude: ['solid silver'],
  },
  {
    id: 'vermeil',
    label: 'Vermeil',
    include: ['gold vermeil', 'vermeil'],
    exclude: [],
  },
];

function buildLengthRules() {
  const out = [];
  for (let n = 12; n <= 21; n += 1) {
    out.push({
      id: `${n}in`,
      label: `${n}"`,
      include: [`${n}"`, `${n} inches`, `${n} inch`, `${n} in`],
      exclude: [],
    });
  }
  return out;
}

const STYLE_RULES = [
  { id: 'style_1', label: 'Style 1', include: ['style 1'], exclude: [] },
  { id: 'style_2', label: 'Style 2', include: ['style 2'], exclude: [] },
  { id: 'style_3', label: 'Style 3', include: ['style 3'], exclude: [] },
  { id: 'satellite', label: 'Satellite', include: ['satellite'], exclude: [] },
  { id: 'belcher', label: 'Belcher', include: ['belcher'], exclude: [] },
  { id: 'anchor', label: 'Anchor', include: ['anchor'], exclude: [] },
];

function defaultVariantsConfigV1() {
  return {
    v: VARIANTS_CONFIG_VERSION,
    tables: [],
  };
}

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

function slugify(input, fallback) {
  const raw = input == null ? '' : String(input);
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  if (slug) return slug;
  return fallback || 'table';
}

function normalizeLabel(input, fallback) {
  const raw = input == null ? '' : String(input);
  const s = raw.trim().replace(/\s+/g, ' ').slice(0, 80);
  return s || (fallback || '');
}

function normalizeToken(raw) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.slice(0, 120);
}

function normalizeTokenList(rawList) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(rawList)) return out;
  for (const item of rawList) {
    const token = normalizeToken(item);
    if (!token) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

function normalizeIgnoredTitle(raw) {
  const s = raw == null ? '' : String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  return s.slice(0, 512);
}

function normalizeIgnoredList(rawList) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(rawList)) return out;
  for (const item of rawList) {
    const title = normalizeIgnoredTitle(item);
    if (!title) continue;
    if (seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
}

function normalizeRule(rawRule, index) {
  const obj = rawRule && typeof rawRule === 'object' ? rawRule : {};
  const label = normalizeLabel(obj.label, `Rule ${index + 1}`);
  const id = slugify(obj.id || label, `rule-${index + 1}`);
  const include = normalizeTokenList(obj.include);
  const exclude = normalizeTokenList(obj.exclude);
  return { id, label, include, exclude };
}

function normalizeRules(rawRules) {
  const out = [];
  const seen = new Set();
  if (!Array.isArray(rawRules)) return out;
  for (let i = 0; i < rawRules.length; i += 1) {
    const normalized = normalizeRule(rawRules[i], i);
    if (!normalized.include.length) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

function normalizeTable(rawTable, index) {
  const obj = rawTable && typeof rawTable === 'object' ? rawTable : {};
  const name = normalizeLabel(obj.name, `Table ${index + 1}`);
  const id = slugify(obj.id || name, `table-${index + 1}`);
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const orderRaw = Number(obj.order);
  const order = Number.isFinite(orderRaw) ? Math.max(0, Math.trunc(orderRaw)) : index + 1;
  const aliases = normalizeTokenList(obj.aliases);
  const icon = (obj.icon == null ? '' : String(obj.icon)).trim().replace(/\s+/g, ' ').slice(0, 120);
  const rules = normalizeRules(obj.rules);
  const ignored = normalizeIgnoredList(obj.ignored);
  return { id, name, enabled, order, aliases, icon, rules, ignored };
}

function sortTablesByOrderThenName(a, b) {
  const ao = Number.isFinite(a && a.order) ? a.order : 0;
  const bo = Number.isFinite(b && b.order) ? b.order : 0;
  if (ao !== bo) return ao - bo;
  const an = a && a.name ? String(a.name).toLowerCase() : '';
  const bn = b && b.name ? String(b.name).toLowerCase() : '';
  if (an < bn) return -1;
  if (an > bn) return 1;
  return 0;
}

function normalizeVariantsConfigV1(raw) {
  const defaults = defaultVariantsConfigV1();
  const parsed = safeJsonParseObject(raw);
  if (!parsed || parsed.v !== VARIANTS_CONFIG_VERSION) return defaults;

  const rawTables = Array.isArray(parsed.tables) ? parsed.tables : [];
  const tables = [];
  const seen = new Set();
  for (let i = 0; i < rawTables.length; i += 1) {
    const table = normalizeTable(rawTables[i], i);
    if (!table.id) continue;
    if (seen.has(table.id)) continue;
    seen.add(table.id);
    tables.push(table);
  }

  tables.sort(sortTablesByOrderThenName);
  return {
    v: VARIANTS_CONFIG_VERSION,
    tables,
  };
}

function normalizeVariantsConfigForSave(raw) {
  const parsed = safeJsonParseObject(raw);
  if (!parsed) return defaultVariantsConfigV1();
  const merged = normalizeVariantsConfigV1(parsed);
  return merged;
}

function normalizeTitle(rawTitle) {
  const raw = rawTitle == null ? '' : String(rawTitle).trim().toLowerCase().slice(0, 512);
  const normalized = ` ${raw.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return { raw, normalized };
}

function tokenMatches(title, tokenRaw) {
  const token = normalizeToken(tokenRaw);
  if (!token) return false;
  // If token is plain alnum words, match against normalized boundaries for safer hits.
  if (/^[a-z0-9 ]+$/.test(token)) {
    return title.normalized.includes(` ${token} `);
  }
  // Otherwise, match in the raw lowered title.
  return title.raw.includes(token);
}

function ruleMatchesTitle(rule, preparedTitle) {
  if (!rule || !Array.isArray(rule.include) || !rule.include.length) return false;
  let hasInclude = false;
  for (const inc of rule.include) {
    if (tokenMatches(preparedTitle, inc)) {
      hasInclude = true;
      break;
    }
  }
  if (!hasInclude) return false;
  for (const exc of (Array.isArray(rule.exclude) ? rule.exclude : [])) {
    if (tokenMatches(preparedTitle, exc)) return false;
  }
  return true;
}

function ruleSpecificityForTitle(rule, preparedTitle) {
  if (!rule || !Array.isArray(rule.include) || !rule.include.length) return 0;
  let best = 0;
  for (const incRaw of rule.include) {
    const inc = normalizeToken(incRaw);
    if (!inc) continue;
    if (!tokenMatches(preparedTitle, inc)) continue;
    const score = inc.replace(/\s+/g, '').length;
    if (score > best) best = score;
  }
  return best;
}

function tableKind(table) {
  const id = table && table.id ? String(table.id).toLowerCase() : '';
  const name = table && table.name ? String(table.name).toLowerCase() : '';
  const aliases = Array.isArray(table && table.aliases) ? table.aliases.map((a) => String(a || '')).join(' ') : '';
  const key = `${id} ${name} ${aliases}`.toLowerCase();
  if (key.includes('length')) return 'length';
  if (key.includes('style')) return 'style';
  if (key.includes('finish') || key.includes('metal')) return 'finish';
  return 'generic';
}

function tableHasAnyRuleTokenMatch(table, preparedTitle) {
  const rules = Array.isArray(table && table.rules) ? table.rules : [];
  for (const rule of rules) {
    const include = Array.isArray(rule && rule.include) ? rule.include : [];
    for (const tokenRaw of include) {
      if (tokenMatches(preparedTitle, tokenRaw)) return true;
    }
  }
  return false;
}

function isTitleInScopeForTable(table, preparedTitle) {
  const kind = tableKind(table);
  if (kind === 'generic') return true;
  const raw = preparedTitle && preparedTitle.raw ? String(preparedTitle.raw) : '';
  const normalized = preparedTitle && preparedTitle.normalized ? String(preparedTitle.normalized) : ' ';
  const hasRuleToken = tableHasAnyRuleTokenMatch(table, preparedTitle);
  if (hasRuleToken) return true;

  if (kind === 'length') {
    if (/\b\d{1,2}(?:\.\d+)?\s*(?:"|inches?|inch|in|cm|mm)\b/i.test(raw)) return true;
    if (/\b\d{1,2}(?:\.\d+)?\s*-\s*\d{1,2}(?:\.\d+)?\s*(?:"|inches?|inch|in|cm|mm)\b/i.test(raw)) return true;
    return false;
  }

  if (kind === 'style') {
    if (normalized.includes(' style ')) return true;
    return false;
  }

  if (kind === 'finish') {
    if (/\b(gold|silver|vermeil|sterling|solid)\b/i.test(raw)) return true;
    return false;
  }

  return true;
}

function classifyTitleForTable(table, variantTitle) {
  const prepared = normalizeTitle(variantTitle);
  if (!isTitleInScopeForTable(table, prepared)) {
    return { kind: 'out_of_scope', matches: [] };
  }
  const rules = Array.isArray(table && table.rules) ? table.rules : [];
  const matches = [];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!ruleMatchesTitle(rule, prepared)) continue;
    matches.push({
      rule,
      index: i,
      specificity: ruleSpecificityForTitle(rule, prepared),
    });
  }
  if (matches.length === 0) {
    return { kind: 'unmapped', matches: [] };
  }
  matches.sort((a, b) => {
    const spec = (Number(b.specificity) || 0) - (Number(a.specificity) || 0);
    if (spec !== 0) return spec;
    return (Number(a.index) || 0) - (Number(b.index) || 0);
  });
  const winner = matches[0];
  return {
    kind: 'matched',
    rule: winner.rule,
    resolved: matches.length > 1,
    specificity: winner.specificity || 0,
    matches: matches.map((entry) => entry.rule),
  };
}

function configHash(config) {
  const json = JSON.stringify(config || {});
  return crypto.createHash('sha1').update(json).digest('hex');
}

function validateConfigStructure(config) {
  const out = {
    ok: true,
    errors: [],
  };
  const tables = Array.isArray(config && config.tables) ? config.tables : [];
  // Empty config is valid (allows fresh installs to start blank and seed via suggestions).
  if (!tables.length) return out;
  for (const table of tables) {
    if (!table || !table.id) {
      out.ok = false;
      out.errors.push({ code: 'table_missing_id', message: 'A table is missing an ID.' });
      continue;
    }
    if (!table.name) {
      out.ok = false;
      out.errors.push({ code: 'table_missing_name', tableId: table.id, message: 'Table name is required.' });
    }
    const seenRuleIds = new Set();
    for (const rule of (Array.isArray(table.rules) ? table.rules : [])) {
      if (!rule || !rule.id) continue;
      if (seenRuleIds.has(rule.id)) {
        out.ok = false;
        out.errors.push({
          code: 'duplicate_rule_id',
          tableId: table.id,
          ruleId: rule.id,
          message: `Duplicate rule ID "${rule.id}" in table "${table.name}".`,
        });
      }
      seenRuleIds.add(rule.id);
      if (!Array.isArray(rule.include) || !rule.include.length) {
        out.ok = false;
        out.errors.push({
          code: 'rule_missing_include',
          tableId: table.id,
          ruleId: rule.id,
          message: `Rule "${rule.label || rule.id}" in "${table.name}" needs at least one include alias.`,
        });
      }
    }
  }
  return out;
}

function validateConfigAgainstVariants(config, observedVariants, options = {}) {
  const maxExamples = Number.isFinite(options.maxExamples) ? Math.max(1, Math.trunc(options.maxExamples)) : 30;
  const tables = Array.isArray(config && config.tables) ? config.tables.filter((t) => t && t.enabled) : [];
  const observed = Array.isArray(observedVariants) ? observedVariants : [];
  const result = {
    ok: true,
    tables: [],
  };

  for (const table of tables) {
    const unmapped = [];
    const resolved = [];
    const ambiguous = [];
    const ignored = [];
    const outOfScope = [];
    const ignoredSet = new Set(normalizeIgnoredList(table && table.ignored));
    for (const row of observed) {
      const title = row && row.variant_title != null ? String(row.variant_title) : '';
      if (ignoredSet.has(normalizeIgnoredTitle(title))) {
        ignored.push({
          variant_title: title,
          orders: row && row.orders != null ? Number(row.orders) || 0 : 0,
          revenue: row && row.revenue != null ? Number(row.revenue) || 0 : 0,
        });
        continue;
      }
      const classified = classifyTitleForTable(table, title);
      if (classified.kind === 'out_of_scope') {
        outOfScope.push({
          variant_title: title,
          orders: row && row.orders != null ? Number(row.orders) || 0 : 0,
          revenue: row && row.revenue != null ? Number(row.revenue) || 0 : 0,
        });
      } else
      if (classified.kind === 'unmapped') {
        unmapped.push({
          variant_title: title,
          orders: row && row.orders != null ? Number(row.orders) || 0 : 0,
          revenue: row && row.revenue != null ? Number(row.revenue) || 0 : 0,
        });
      } else if (classified.kind === 'matched' && classified.resolved) {
        resolved.push({
          variant_title: title,
          orders: row && row.orders != null ? Number(row.orders) || 0 : 0,
          revenue: row && row.revenue != null ? Number(row.revenue) || 0 : 0,
          chosen: classified.rule && classified.rule.label ? String(classified.rule.label) : '',
          matches: Array.isArray(classified.matches)
            ? classified.matches.map((r) => ({ id: r.id, label: r.label }))
            : [],
        });
      } else if (classified.kind === 'ambiguous') {
        ambiguous.push({
          variant_title: title,
          orders: row && row.orders != null ? Number(row.orders) || 0 : 0,
          revenue: row && row.revenue != null ? Number(row.revenue) || 0 : 0,
          matches: classified.matches.map((r) => ({
            id: r.id,
            label: r.label,
          })),
        });
      }
    }

    ignored.sort((a, b) => (b.orders - a.orders) || (b.revenue - a.revenue));
    outOfScope.sort((a, b) => (b.orders - a.orders) || (b.revenue - a.revenue));
    resolved.sort((a, b) => (b.orders - a.orders) || (b.revenue - a.revenue));
    unmapped.sort((a, b) => (b.orders - a.orders) || (b.revenue - a.revenue));
    ambiguous.sort((a, b) => (b.orders - a.orders) || (b.revenue - a.revenue));

    const tableResult = {
      tableId: table.id,
      tableName: table.name,
      ignoredCount: ignored.length,
      outOfScopeCount: outOfScope.length,
      resolvedCount: resolved.length,
      unmappedCount: unmapped.length,
      ambiguousCount: ambiguous.length,
      ignoredExamples: ignored.slice(0, maxExamples),
      outOfScopeExamples: outOfScope.slice(0, maxExamples),
      resolvedExamples: resolved.slice(0, maxExamples),
      unmappedExamples: unmapped.slice(0, maxExamples),
      ambiguousExamples: ambiguous.slice(0, maxExamples),
    };
    result.tables.push(tableResult);
    if (tableResult.unmappedCount > 0) {
      result.ok = false;
    }
  }

  return result;
}

module.exports = {
  VARIANTS_CONFIG_KEY,
  VARIANTS_CONFIG_VERSION,
  defaultVariantsConfigV1,
  normalizeVariantsConfigV1,
  normalizeVariantsConfigForSave,
  normalizeIgnoredTitle,
  normalizeIgnoredList,
  classifyTitleForTable,
  configHash,
  validateConfigStructure,
  validateConfigAgainstVariants,
};
