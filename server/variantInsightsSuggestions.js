const salesTruth = require('./salesTruth');
const fx = require('./fx');
const {
  getVariantOrderRows,
  getVariantSessionCounts,
  fillTitlesForVariantIds,
} = require('./variantInsightsService');

const GRAPHQL_API_VERSION = '2024-01';

function safeStr(v, maxLen = 256) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function slugify(raw, fallback) {
  const s = safeStr(raw, 256)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || (fallback || 'table');
}

function normalizeOptionName(raw) {
  return safeStr(raw, 80).toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeOptionValue(raw) {
  return safeStr(raw, 160).toLowerCase().replace(/\s+/g, ' ').trim();
}

function titleCase(s) {
  const raw = safeStr(s, 120);
  if (!raw) return '';
  return raw
    .split(/\s+/g)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

function pluralizeTableName(optionName) {
  const n = safeStr(optionName, 120);
  const nl = n.toLowerCase();
  if (!n) return n;
  if (nl.endsWith('length') || nl.endsWith('lengths')) {
    return nl.endsWith('lengths') ? n : (n + 's');
  }
  if (nl === 'finish') return 'Finishes';
  if (nl === 'style') return 'Styles';
  if (nl === 'metal') return 'Metals';
  if (nl.endsWith('s')) return n;
  return n + 's';
}

function normalizeDashAndQuotes(s) {
  return String(s || '')
    // dashes
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')
    // double quotes
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    // single quotes / apostrophes
    .replace(/[\u2018\u2019\u201B\u2032]/g, '\'');
}

function extractLengthTokensFromValue(value) {
  const out = [];
  const raw = normalizeDashAndQuotes(value);
  // 18", 18 inches, 18in, 18 inch
  const inchMatches = raw.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*(?:"|inches?|inch|in)\b/gi);
  for (const m of inchMatches) {
    const n = m && m[1] ? String(m[1]) : '';
    if (!n) continue;
    out.push(`${n}"`, `${n} inches`, `${n} inch`, `${n} in`, `${n}in`, `${n}inch`, `${n}inches`);
  }
  // 46cm, 46 cm
  const cmMatches = raw.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*cm\b/gi);
  for (const m of cmMatches) {
    const n = m && m[1] ? String(m[1]) : '';
    if (!n) continue;
    out.push(`${n}cm`, `${n} cm`);
  }
  return out;
}

function suggestIncludeAliasesForValue(optionName, value) {
  const out = [];
  const v = safeStr(value, 200);
  if (!v) return out;
  out.push(v);
  const normalized = normalizeDashAndQuotes(v);
  if (normalized && normalized !== v) out.push(normalized);

  const opt = normalizeOptionName(optionName);
  if (opt.includes('length') || /\bcm\b/i.test(v) || /\bin\b/i.test(v) || v.includes('"')) {
    out.push(...extractLengthTokensFromValue(v));
  }

  // Common numeric metal formatting: "14ct" vs "14 ct"
  const metal = normalized.replace(/\b(\d{1,2})\s*ct\b/gi, '$1 ct');
  if (metal && metal !== normalized) out.push(metal);

  // Parenthesis-free fallback (helps when titles omit extra descriptors)
  const noParens = normalized.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (noParens && noParens !== normalized) out.push(noParens);

  // Final: lowercase tokens are applied during config normalization, but keep as typed for readability.
  // De-dupe while preserving order.
  const seen = new Set();
  const uniq = [];
  for (const item of out) {
    const s = safeStr(item, 200);
    if (!s) continue;
    const key = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  return uniq.slice(0, 25);
}

async function shopifyGraphql(shop, token, query, variables) {
  const safeShop = (shop || '').trim().toLowerCase();
  if (!safeShop || !safeShop.endsWith('.myshopify.com')) return { ok: false, data: null, error: 'invalid_shop' };
  if (!token) return { ok: false, data: null, error: 'missing_token' };
  const url = `https://${safeShop}/admin/api/${GRAPHQL_API_VERSION}/graphql.json`;
  let res;
  let text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, data: null, error: err && err.message ? String(err.message).slice(0, 180) : 'network_error' };
  }
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    return { ok: false, data: null, error: 'invalid_json' };
  }
  if (!res.ok) {
    const msg = json && json.errors && json.errors[0] && json.errors[0].message ? json.errors[0].message : `HTTP ${res.status}`;
    return { ok: false, data: null, error: String(msg).slice(0, 180) };
  }
  if (json && Array.isArray(json.errors) && json.errors.length) {
    const msg = json.errors[0] && json.errors[0].message ? json.errors[0].message : 'graphql_error';
    return { ok: false, data: null, error: String(msg).slice(0, 180) };
  }
  return { ok: true, data: json && json.data ? json.data : null, error: '' };
}

function gidForVariantId(variantId) {
  const s = safeStr(variantId, 64);
  if (!s) return '';
  if (s.startsWith('gid://')) return s;
  return `gid://shopify/ProductVariant/${s}`;
}

function extractGidId(gid, type) {
  const s = gid != null ? String(gid).trim() : '';
  if (!s) return null;
  const re = new RegExp(`/${type}/(\\d+)$`);
  const m = s.match(re);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return null;
}

async function fetchVariantMetaByIds(shop, token, variantIds, { max = 800 } = {}) {
  const ids = Array.isArray(variantIds) ? variantIds.map((v) => safeStr(v, 64)).filter(Boolean) : [];
  const list = ids.slice(0, Math.max(0, max | 0));
  const out = new Map(); // variant_id -> { product_id, product_handle, product_title, selected_options }
  if (!list.length) return out;
  const chunkSize = 75;
  for (let i = 0; i < list.length; i += chunkSize) {
    const chunk = list.slice(i, i + chunkSize).map(gidForVariantId).filter(Boolean);
    if (!chunk.length) continue;
    const query = `query($ids: [ID!]!) {\n  nodes(ids: $ids) {\n    ... on ProductVariant {\n      id\n      legacyResourceId\n      title\n      selectedOptions { name value }\n      product { id legacyResourceId handle title }\n    }\n  }\n}`;
    const gql = await shopifyGraphql(shop, token, query, { ids: chunk });
    if (!gql.ok) return { ok: false, error: gql.error || 'variants_fetch_failed', meta: out };
    const nodes = gql.data && Array.isArray(gql.data.nodes) ? gql.data.nodes : [];
    for (const node of nodes) {
      if (!node) continue;
      const vid = node.legacyResourceId != null ? safeStr(node.legacyResourceId, 64) : extractGidId(node.id, 'ProductVariant');
      if (!vid) continue;
      const product = node.product || null;
      const pid = product && product.legacyResourceId != null ? safeStr(product.legacyResourceId, 64) : extractGidId(product && product.id, 'Product');
      const selected = Array.isArray(node.selectedOptions)
        ? node.selectedOptions
          .map((o) => ({ name: safeStr(o && o.name, 80), value: safeStr(o && o.value, 160) }))
          .filter((o) => !!o.name && !!o.value)
        : [];
      out.set(vid, {
        product_id: pid || null,
        product_handle: safeStr(product && product.handle, 120) || null,
        product_title: safeStr(product && product.title, 160) || null,
        variant_title: safeStr(node.title, 200) || null,
        selected_options: selected,
      });
    }
  }
  return { ok: true, error: '', meta: out };
}

function toCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function roundMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

async function getObservedVariantStats({ shop, start, end, maxVariants = 450 } = {}) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  if (!safeShop || !safeShop.endsWith('.myshopify.com')) return [];

  const orderRows = await getVariantOrderRows({ shop: safeShop, start, end });
  const sessionsByVariant = await getVariantSessionCounts({ start, end });
  const ratesToGbp = await fx.getRatesToGbp();

  const byVariant = new Map();
  for (const row of orderRows || []) {
    const variantId = row && row.variant_id != null ? String(row.variant_id).trim() : '';
    if (!variantId) continue;
    const cur = fx.normalizeCurrency(row && row.currency != null ? String(row.currency) : '') || 'GBP';
    const revRaw = row && row.revenue != null ? Number(row.revenue) : 0;
    const revGbp = fx.convertToGbp(Number.isFinite(revRaw) ? revRaw : 0, cur, ratesToGbp);
    const amount = Number.isFinite(revGbp) ? revGbp : 0;
    const ordersRaw = row && row.orders != null ? Number(row.orders) : 0;
    const orders = Number.isFinite(ordersRaw) ? Math.max(0, Math.trunc(ordersRaw)) : 0;
    const title = row && row.variant_title != null ? String(row.variant_title).trim() : '';
    const current = byVariant.get(variantId) || {
      variant_id: variantId,
      variant_title: title || '',
      orders: 0,
      revenue: 0,
      sessions: 0,
    };
    current.orders += orders;
    current.revenue += amount;
    if (!current.variant_title && title) current.variant_title = title;
    byVariant.set(variantId, current);
  }

  const missingVariantIds = [];
  for (const [variantId, sessions] of sessionsByVariant.entries()) {
    const current = byVariant.get(variantId);
    if (current) {
      current.sessions = toCount(sessions);
      continue;
    }
    missingVariantIds.push(variantId);
    byVariant.set(variantId, {
      variant_id: variantId,
      variant_title: '',
      orders: 0,
      revenue: 0,
      sessions: toCount(sessions),
    });
  }

  if (missingVariantIds.length) {
    const titles = await fillTitlesForVariantIds({ shop: safeShop, variantIds: missingVariantIds });
    for (const variantId of missingVariantIds) {
      if (!titles.has(variantId)) continue;
      const current = byVariant.get(variantId);
      if (!current) continue;
      current.variant_title = titles.get(variantId);
    }
  }

  const list = Array.from(byVariant.values()).map((v) => ({
    variant_id: v.variant_id,
    variant_title: v.variant_title || '',
    sessions: toCount(v.sessions),
    orders: toCount(v.orders),
    revenue: roundMoney(v.revenue),
  }));

  list.sort((a, b) => (b.orders - a.orders) || (b.sessions - a.sessions) || (b.revenue - a.revenue) || String(a.variant_id).localeCompare(String(b.variant_id)));
  return list.slice(0, Math.max(50, Math.min(1500, maxVariants | 0)));
}

function ensureUniqueRuleId(base, taken, fallbackPrefix) {
  const start = slugify(base, fallbackPrefix || 'rule');
  if (!taken.has(start)) {
    taken.add(start);
    return start;
  }
  let i = 2;
  while (taken.has(`${start}-${i}`)) i += 1;
  const next = `${start}-${i}`;
  taken.add(next);
  return next;
}

function ensureUniqueTableId(base, taken) {
  const start = slugify(base, 'table');
  if (!taken.has(start)) {
    taken.add(start);
    return start;
  }
  let i = 2;
  while (taken.has(`${start}-${i}`)) i += 1;
  const next = `${start}-${i}`;
  taken.add(next);
  return next;
}

function defaultTableNameForOption(optionName) {
  const raw = safeStr(optionName, 120);
  if (!raw) return 'Variant Option';
  const pretty = titleCase(raw);
  return pluralizeTableName(pretty);
}

async function buildVariantMappingSuggestions({ shop, start, end, maxVariants = 450 } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '') || salesTruth.resolveShopForSales('') || safeStr(shop, 120).toLowerCase();
  if (!safeShop || !safeShop.endsWith('.myshopify.com')) {
    return { ok: false, error: 'invalid_shop', suggestions: [], observed: { variants: 0 } };
  }
  const token = await salesTruth.getAccessToken(safeShop).catch(() => '');
  if (!token) {
    return { ok: false, error: 'missing_shopify_token', suggestions: [], observed: { variants: 0 } };
  }

  const observed = await getObservedVariantStats({ shop: safeShop, start, end, maxVariants });
  const variantIds = observed.map((v) => v.variant_id).filter(Boolean);
  const metaRes = await fetchVariantMetaByIds(safeShop, token, variantIds, { max: maxVariants });
  if (!metaRes.ok) {
    return { ok: false, error: metaRes.error || 'shopify_fetch_failed', suggestions: [], observed: { variants: observed.length } };
  }
  const meta = metaRes.meta;

  const optionGroups = new Map(); // optionKey -> { name, samples, totals, values: Map }
  for (const v of observed) {
    const vid = v && v.variant_id ? String(v.variant_id) : '';
    if (!vid) continue;
    const m = meta.get(vid);
    if (!m || !Array.isArray(m.selected_options) || !m.selected_options.length) continue;
    for (const opt of m.selected_options) {
      const name = safeStr(opt && opt.name, 80);
      const value = safeStr(opt && opt.value, 160);
      if (!name || !value) continue;
      const nameNorm = normalizeOptionName(name);
      const valueNorm = normalizeOptionValue(value);
      if (!nameNorm || !valueNorm) continue;
      if (nameNorm === 'title' && valueNorm === 'default title') continue;

      const group = optionGroups.get(nameNorm) || {
        optionKey: nameNorm,
        optionName: name,
        optionNameCandidates: new Map(),
        totals: { sessions: 0, orders: 0, revenue: 0, variants: 0, values: 0 },
        values: new Map(), // valueNorm -> { value, totals }
      };
      group.optionNameCandidates.set(name, (group.optionNameCandidates.get(name) || 0) + 1);
      group.totals.sessions += toCount(v.sessions);
      group.totals.orders += toCount(v.orders);
      group.totals.revenue += Number(v.revenue) || 0;
      group.totals.variants += 1;
      const vv = group.values.get(valueNorm) || {
        valueKey: valueNorm,
        value,
        totals: { sessions: 0, orders: 0, revenue: 0, variants: 0 },
      };
      vv.totals.sessions += toCount(v.sessions);
      vv.totals.orders += toCount(v.orders);
      vv.totals.revenue += Number(v.revenue) || 0;
      vv.totals.variants += 1;
      group.values.set(valueNorm, vv);
      optionGroups.set(nameNorm, group);
    }
  }

  // Pick most common display name per option group.
  for (const g of optionGroups.values()) {
    let bestName = g.optionName;
    let bestCount = 0;
    for (const [candidate, count] of g.optionNameCandidates.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestName = candidate;
      }
    }
    g.optionName = bestName;
    g.totals.values = g.values.size;
    g.totals.revenue = roundMoney(g.totals.revenue);
  }

  const sortedGroups = Array.from(optionGroups.values())
    .filter((g) => (g && g.values && g.values.size >= 2))
    .sort((a, b) => (b.totals.sessions - a.totals.sessions) || (b.totals.orders - a.totals.orders) || (b.totals.revenue - a.totals.revenue) || a.optionKey.localeCompare(b.optionKey));

  const suggestionIdTaken = new Set();
  const suggestions = [];
  let order = 1;
  for (const g of sortedGroups.slice(0, 12)) {
    const tableName = defaultTableNameForOption(g.optionName);
    const tableId = ensureUniqueTableId(tableName, suggestionIdTaken);
    const ruleTaken = new Set();
    const valuesSorted = Array.from(g.values.values()).sort((a, b) => (b.totals.sessions - a.totals.sessions) || (b.totals.orders - a.totals.orders) || (b.totals.revenue - a.totals.revenue) || a.valueKey.localeCompare(b.valueKey));
    const rules = valuesSorted.map((entry, idx) => {
      const label = safeStr(entry.value, 200) || (`Value ${idx + 1}`);
      const rid = ensureUniqueRuleId(label, ruleTaken, 'rule');
      return {
        id: rid,
        label,
        include: suggestIncludeAliasesForValue(g.optionName, label),
        exclude: [],
      };
    });
    const preview = valuesSorted.slice(0, 8).map((v) => safeStr(v.value, 120)).filter(Boolean);
    const suggestion = {
      suggestionId: `option:${tableId}`,
      kind: 'option_table',
      option: {
        name: g.optionName,
        key: g.optionKey,
        distinctValues: g.values.size,
        previewValues: preview,
      },
      impact: {
        sessions: toCount(g.totals.sessions),
        orders: toCount(g.totals.orders),
        revenue: roundMoney(g.totals.revenue),
        variants: toCount(g.totals.variants),
      },
      table: {
        id: tableId,
        name: tableName,
        enabled: true,
        order: order,
        rules,
        ignored: [],
      },
    };
    suggestions.push(suggestion);
    order += 1;
  }

  return {
    ok: true,
    error: '',
    observed: { variants: observed.length },
    suggestions,
  };
}

module.exports = {
  buildVariantMappingSuggestions,
  // exposed for tests/diagnostics
  suggestIncludeAliasesForValue,
};

