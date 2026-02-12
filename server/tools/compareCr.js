const store = require('../store');
const { getDb } = require('../db');
const salesTruth = require('../salesTruth');
const reportCache = require('../reportCache');
const {
  VARIANTS_CONFIG_KEY,
  normalizeVariantsConfigV1,
  classifyTitleForTable,
  normalizeIgnoredTitle,
} = require('../variantInsightsConfig');

const GRAPHQL_API_VERSION = '2024-01';

function safeStr(v, maxLen = 256) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function extractGidId(gid, type) {
  const s = gid != null ? String(gid).trim() : '';
  if (!s) return null;
  const re = new RegExp(`/${type}/(\\d+)$`);
  const m = s.match(re);
  if (m) return m[1];
  if (/^\\d+$/.test(s)) return s;
  return null;
}

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeHandle(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!s) return null;
  return s.slice(0, 128);
}

function handleFromPath(path) {
  if (typeof path !== 'string') return null;
  const m = path.match(/^\/products\/([^/?#]+)/i);
  return m ? normalizeHandle(m[1]) : null;
}

function handleFromUrl(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return handleFromPath(u.pathname || '');
  } catch (_) {
    return handleFromPath(raw);
  }
}

function handleFromSessionRow(row) {
  return (
    handleFromPath(row && row.first_path) ||
    normalizeHandle(row && row.first_product_handle) ||
    handleFromUrl(row && row.entry_url)
  );
}

function parseYmd(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function ymdAddDays(ymd, deltaDays) {
  const base = parseYmd(ymd);
  if (!base) return null;
  const d = new Date(base + 'T00:00:00.000Z');
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (Number(deltaDays) || 0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function gidForProductId(productId) {
  const s = safeStr(productId, 64);
  if (!s) return '';
  if (s.startsWith('gid://')) return s;
  return `gid://shopify/Product/${s}`;
}

function gidForCollectionId(collectionId) {
  const s = safeStr(collectionId, 64);
  if (!s) return '';
  if (s.startsWith('gid://')) return s;
  return `gid://shopify/Collection/${s}`;
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

async function catalogSearch({ shop, q, limit = 10 } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const token = safeShop ? await salesTruth.getAccessToken(safeShop) : '';
  if (!safeShop || !token) return { ok: false, error: 'missing_shop_or_token', products: [], collections: [] };
  const term = safeStr(q, 80);
  if (!term) return { ok: true, products: [], collections: [] };
  const n = clampInt(limit, 10, 1, 15);

  const query = `query($qp: String!, $qc: String!, $n: Int!) {
    products(first: $n, query: $qp) {
      nodes { id legacyResourceId title handle createdAt }
    }
    collections(first: $n, query: $qc) {
      nodes { id legacyResourceId title handle updatedAt }
    }
  }`;

  const qp = `title:*${term}*`;
  const qc = `title:*${term}*`;
  const gql = await shopifyGraphql(safeShop, token, query, { qp, qc, n });
  if (!gql.ok) return { ok: false, error: gql.error || 'search_failed', products: [], collections: [] };

  const products = (gql.data && gql.data.products && Array.isArray(gql.data.products.nodes)) ? gql.data.products.nodes : [];
  const collections = (gql.data && gql.data.collections && Array.isArray(gql.data.collections.nodes)) ? gql.data.collections.nodes : [];

  return {
    ok: true,
    products: products.map((p) => ({
      product_id: (
        p && p.legacyResourceId != null
          ? String(p.legacyResourceId)
          : extractGidId(p && p.id, 'Product')
      ) || '',
      title: safeStr(p && p.title, 160) || 'Untitled',
      handle: normalizeHandle(p && p.handle) || null,
      created_at: p && p.createdAt ? String(p.createdAt) : null,
    })).filter((p) => !!p.product_id),
    collections: collections.map((c) => ({
      collection_id: (
        c && c.legacyResourceId != null
          ? String(c.legacyResourceId)
          : extractGidId(c && c.id, 'Collection')
      ) || '',
      title: safeStr(c && c.title, 160) || 'Untitled',
      handle: normalizeHandle(c && c.handle) || null,
      updated_at: c && c.updatedAt ? String(c.updatedAt) : null,
    })).filter((c) => !!c.collection_id),
  };
}

async function getProductVariants({ shop, productId } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const token = safeShop ? await salesTruth.getAccessToken(safeShop) : '';
  if (!safeShop || !token) return { ok: false, error: 'missing_shop_or_token', variants: [], product: null };
  const gid = gidForProductId(productId);
  if (!gid) return { ok: false, error: 'missing_product_id', variants: [], product: null };

  const query = `query($id: ID!) {
    product(id: $id) {
      id
      legacyResourceId
      title
      handle
      createdAt
      variants(first: 250) {
        nodes {
          id
          legacyResourceId
          title
          selectedOptions { name value }
        }
      }
    }
  }`;

  const gql = await shopifyGraphql(safeShop, token, query, { id: gid });
  if (!gql.ok || !gql.data || !gql.data.product) return { ok: false, error: gql.error || 'product_not_found', variants: [], product: null };

  const p = gql.data.product;
  const vars = p.variants && Array.isArray(p.variants.nodes) ? p.variants.nodes : [];
  return {
    ok: true,
    product: {
      product_id: p.legacyResourceId != null ? String(p.legacyResourceId) : null,
      title: safeStr(p.title, 160) || 'Untitled',
      handle: normalizeHandle(p.handle) || null,
      created_at: p.createdAt ? String(p.createdAt) : null,
    },
    variants: vars.map((v) => ({
      variant_id: (
        v && v.legacyResourceId != null
          ? String(v.legacyResourceId)
          : extractGidId(v && v.id, 'ProductVariant')
      ) || null,
      title: safeStr(v && v.title, 200) || 'Variant',
      selected_options: Array.isArray(v && v.selectedOptions)
        ? v.selectedOptions
          .map((o) => ({ name: safeStr(o && o.name, 80), value: safeStr(o && o.value, 120) }))
          .filter((o) => !!o.name && !!o.value)
        : [],
    })).filter((v) => !!v.variant_id),
  };
}

function normalizeLooseToken(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

function scoreTableForOptionNames(table, optionNames) {
  const set = optionNames instanceof Set ? optionNames : new Set();
  if (!set.size) return 0;
  const name = normalizeLooseToken(table && table.name);
  const aliases = Array.isArray(table && table.aliases) ? table.aliases.map(normalizeLooseToken).filter(Boolean) : [];
  const hay = new Set([name, ...aliases].filter(Boolean));
  let score = 0;
  for (const n of set) {
    if (!n) continue;
    if (hay.has(n)) score += 1;
  }
  return score;
}

async function getProductMappedVariantGroups({ shop, productId, tableId } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  if (!safeShop) return { ok: false, error: 'missing_shop' };
  const pid = safeStr(productId, 64);
  if (!pid) return { ok: false, error: 'missing_product_id' };

  const rawCfg = await store.getSetting(VARIANTS_CONFIG_KEY).catch(() => null);
  const cfg = normalizeVariantsConfigV1(rawCfg);
  const enabledTables = Array.isArray(cfg && cfg.tables)
    ? cfg.tables.filter((t) => t && t.enabled && Array.isArray(t.rules) && t.rules.length)
    : [];

  if (!enabledTables.length) {
    return {
      ok: false,
      error: 'no_variant_mappings',
      message: 'No variant mapping tables configured. Open Settings → Insights → Variants.',
      tables: [],
      table_id: null,
      groups: [],
    };
  }

  const vars = await getProductVariants({ shop: safeShop, productId: pid });
  if (!vars.ok) return { ok: false, error: vars.error || 'variants_fetch_failed' };
  const product = vars.product || null;
  const variants = Array.isArray(vars.variants) ? vars.variants : [];

  const optionNames = new Set();
  for (const v of variants) {
    for (const o of (Array.isArray(v && v.selected_options) ? v.selected_options : [])) {
      const n = normalizeLooseToken(o && o.name);
      if (n) optionNames.add(n);
    }
  }

  const requested = normalizeLooseToken(tableId);
  let selected = null;
  if (requested) {
    selected = enabledTables.find((t) => normalizeLooseToken(t && t.id) === requested) || null;
  }
  if (!selected) {
    let best = enabledTables[0];
    let bestScore = -1;
    for (const t of enabledTables) {
      const score = scoreTableForOptionNames(t, optionNames);
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    selected = best || enabledTables[0];
  }

  const ignoredSet = new Set(Array.isArray(selected && selected.ignored) ? selected.ignored.map(normalizeIgnoredTitle).filter(Boolean) : []);

  const groupsByRuleId = new Map();
  let outOfScopeCount = 0;
  let unmappedCount = 0;
  let ignoredCount = 0;
  const unmappedExamples = [];
  const outOfScopeExamples = [];
  const ignoredExamples = [];

  for (const v of variants) {
    const vid = safeStr(v && v.variant_id, 64);
    if (!vid) continue;
    const title = safeStr(v && v.title, 240) || vid;

    if (ignoredSet.has(normalizeIgnoredTitle(title))) {
      ignoredCount += 1;
      if (ignoredExamples.length < 10) ignoredExamples.push({ variant_id: vid, title });
      continue;
    }

    const classified = classifyTitleForTable(selected, title);
    if (!classified || !classified.kind) continue;

    if (classified.kind === 'out_of_scope') {
      outOfScopeCount += 1;
      if (outOfScopeExamples.length < 10) outOfScopeExamples.push({ variant_id: vid, title });
      continue;
    }

    if (classified.kind === 'unmapped') {
      unmappedCount += 1;
      if (unmappedExamples.length < 10) unmappedExamples.push({ variant_id: vid, title });
      continue;
    }

    if (classified.kind === 'matched' && classified.rule) {
      const rid = safeStr(classified.rule.id, 120) || '';
      if (!rid) continue;
      const label = safeStr(classified.rule.label, 200) || rid;
      const cur = groupsByRuleId.get(rid) || { group_id: rid, label, variant_count: 0 };
      cur.variant_count += 1;
      groupsByRuleId.set(rid, cur);
    }
  }

  const groups = Array.from(groupsByRuleId.values()).sort((a, b) => {
    const an = String(a && a.label ? a.label : a && a.group_id ? a.group_id : '');
    const bn = String(b && b.label ? b.label : b && b.group_id ? b.group_id : '');
    return an.localeCompare(bn);
  });

  return {
    ok: true,
    shop: safeShop,
    product,
    tables: enabledTables.map((t) => ({
      id: safeStr(t && t.id, 120),
      name: safeStr(t && t.name, 120),
      aliases: Array.isArray(t && t.aliases) ? t.aliases.slice(0, 12) : [],
      enabled: !!(t && t.enabled),
      rule_count: Array.isArray(t && t.rules) ? t.rules.length : 0,
    })),
    table_id: safeStr(selected && selected.id, 120),
    table_name: safeStr(selected && selected.name, 160),
    groups,
    coverage: {
      total_variants: variants.length,
      mapped_variants: groups.reduce((sum, g) => sum + (Number(g && g.variant_count) || 0), 0),
      unmapped_variants: unmappedCount,
      out_of_scope_variants: outOfScopeCount,
      ignored_variants: ignoredCount,
    },
    unmapped_examples: unmappedExamples,
    out_of_scope_examples: outOfScopeExamples,
    ignored_examples: ignoredExamples,
  };
}

async function getCollectionProducts({ shop, collectionId, maxProducts = 5000 } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const token = safeShop ? await salesTruth.getAccessToken(safeShop) : '';
  if (!safeShop || !token) return { ok: false, error: 'missing_shop_or_token', collection: null, products: [] };
  const gid = gidForCollectionId(collectionId);
  if (!gid) return { ok: false, error: 'missing_collection_id', collection: null, products: [] };

  const cap = clampInt(maxProducts, 5000, 1, 5000);
  const out = [];
  let cursor = null;
  for (let guard = 0; guard < 30; guard++) {
    const query = `query($id: ID!, $after: String) {
      collection(id: $id) {
        id
        legacyResourceId
        title
        handle
        products(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id legacyResourceId title handle createdAt }
        }
      }
    }`;
    const gql = await shopifyGraphql(safeShop, token, query, { id: gid, after: cursor });
    if (!gql.ok) return { ok: false, error: gql.error || 'collection_fetch_failed', collection: null, products: [] };
    const col = gql.data && gql.data.collection ? gql.data.collection : null;
    if (!col) return { ok: false, error: 'collection_not_found', collection: null, products: [] };
    const nodes = col.products && Array.isArray(col.products.nodes) ? col.products.nodes : [];
    for (const p of nodes) {
      if (out.length >= cap) break;
      out.push({
        product_id: (
          p && p.legacyResourceId != null
            ? String(p.legacyResourceId)
            : extractGidId(p && p.id, 'Product')
        ) || '',
        title: safeStr(p && p.title, 160) || 'Untitled',
        handle: normalizeHandle(p && p.handle) || null,
        created_at: p && p.createdAt ? String(p.createdAt) : null,
      });
    }
    const pageInfo = col.products && col.products.pageInfo ? col.products.pageInfo : null;
    const hasNext = !!(pageInfo && pageInfo.hasNextPage);
    cursor = pageInfo && pageInfo.endCursor ? String(pageInfo.endCursor) : null;
    if (!hasNext || out.length >= cap) {
      return {
        ok: true,
        collection: {
          collection_id: col.legacyResourceId != null ? String(col.legacyResourceId) : null,
          title: safeStr(col.title, 160) || 'Untitled',
          handle: normalizeHandle(col.handle) || null,
        },
        products: out,
        truncated: out.length >= cap,
      };
    }
  }
  return { ok: false, error: 'collection_pagination_limit', collection: null, products: [] };
}

async function countLandingSessionsForHandle({ shop, startMs, endMs, handle } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const db = getDb();
  const h = normalizeHandle(handle);
  if (!safeShop || !h) return 0;

  const rows = await db.get(
    `
      SELECT COUNT(*) AS n
      FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ?
        AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)
        AND (
          (s.first_product_handle IS NOT NULL AND LOWER(TRIM(s.first_product_handle)) = ?)
          OR (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE ?)
          OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE ?)
        )
    `,
    [
      Math.trunc(Number(startMs) || 0),
      Math.trunc(Number(endMs) || 0),
      h,
      `/products/${h}%`,
      `%/products/${h}%`,
    ]
  );
  return rows && rows.n != null ? Number(rows.n) || 0 : 0;
}

function extractVariantIdFromUrl(url) {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;
  let params = null;
  try {
    params = new URL(raw).searchParams;
  } catch (_) {
    try {
      params = new URL(raw, 'https://example.local').searchParams;
    } catch (_) {
      params = null;
    }
  }
  if (!params) return null;
  const v = params.get('variant');
  if (!v) return null;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return null;
  return s;
}

async function countVariantLandingSessions({ startMs, endMs, handle, variantIdSet } = {}) {
  const db = getDb();
  const h = normalizeHandle(handle);
  const set = variantIdSet instanceof Set ? variantIdSet : new Set();
  if (!h || !set.size) return new Map();
  const sessionRows = await db.all(
    `
      SELECT s.first_path, s.first_product_handle, s.entry_url
      FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ?
        AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)
        AND s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%variant=%'
        AND (
          (s.first_product_handle IS NOT NULL AND LOWER(TRIM(s.first_product_handle)) = ?)
          OR (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE ?)
          OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE ?)
        )
    `,
    [
      Math.trunc(Number(startMs) || 0),
      Math.trunc(Number(endMs) || 0),
      h,
      `/products/${h}%`,
      `%/products/${h}%`,
    ]
  );
  const out = new Map();
  for (const r of sessionRows || []) {
    const entry = r && r.entry_url != null ? String(r.entry_url) : '';
    const vid = extractVariantIdFromUrl(entry);
    if (!vid || !set.has(vid)) continue;
    out.set(vid, (out.get(vid) || 0) + 1);
  }
  return out;
}

async function countLandingSessionsByHandleSetScan({ startMs, endMs, handleSet } = {}) {
  const db = getDb();
  const set = handleSet instanceof Set ? handleSet : new Set();
  if (!set.size) return 0;

  const start = Math.trunc(Number(startMs) || 0);
  const end = Math.trunc(Number(endMs) || 0);

  let total = 0;

  const grouped = await db.all(
    `
      SELECT LOWER(TRIM(s.first_product_handle)) AS handle, COUNT(*) AS n
      FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ?
        AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)
        AND s.first_product_handle IS NOT NULL AND TRIM(s.first_product_handle) != ''
      GROUP BY LOWER(TRIM(s.first_product_handle))
    `,
    [start, end]
  );
  for (const r of grouped || []) {
    const h = normalizeHandle(r && r.handle != null ? String(r.handle) : '');
    if (!h || !set.has(h)) continue;
    const n = r && r.n != null ? Number(r.n) || 0 : 0;
    total += n;
  }

  const fallbackRows = await db.all(
    `
      SELECT s.first_path, s.entry_url
      FROM sessions s
      WHERE s.started_at >= ? AND s.started_at < ?
        AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)
        AND (s.first_product_handle IS NULL OR TRIM(s.first_product_handle) = '')
        AND (
          (s.first_path IS NOT NULL AND LOWER(s.first_path) LIKE '/products/%')
          OR (s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%')
        )
    `,
    [start, end]
  );
  for (const r of fallbackRows || []) {
    const h = handleFromSessionRow(r);
    if (!h || !set.has(h)) continue;
    total += 1;
  }

  return total;
}

async function countOrdersForProductId({ shop, startMs, endMs, productId } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const db = getDb();
  const pid = safeStr(productId, 64);
  if (!safeShop || !pid) return 0;
  const row = await db.get(
    `
      SELECT COUNT(DISTINCT order_id) AS n
      FROM orders_shopify_line_items
      WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
        AND (order_test IS NULL OR order_test = 0)
        AND order_cancelled_at IS NULL
        AND order_financial_status = 'paid'
        AND product_id IS NOT NULL AND TRIM(product_id) = ?
    `,
    [safeShop, Math.trunc(Number(startMs) || 0), Math.trunc(Number(endMs) || 0), pid]
  );
  return row && row.n != null ? Number(row.n) || 0 : 0;
}

async function countOrdersByVariantIds({ shop, startMs, endMs, productId, variantIds } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const db = getDb();
  const pid = safeStr(productId, 64);
  const vids = Array.isArray(variantIds) ? variantIds.map((v) => safeStr(v, 64)).filter(Boolean) : [];
  if (!safeShop || !pid || !vids.length) return new Map();

  const out = new Map();
  const CHUNK = 200;
  for (let i = 0; i < vids.length; i += CHUNK) {
    const slice = vids.slice(i, i + CHUNK);
    const inSql = slice.map(() => '?').join(', ');
    const rows = await db.all(
      `
        SELECT TRIM(variant_id) AS variant_id, COUNT(DISTINCT order_id) AS orders
        FROM orders_shopify_line_items
        WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) = ?
          AND variant_id IS NOT NULL AND TRIM(variant_id) IN (${inSql})
        GROUP BY TRIM(variant_id)
      `,
      [safeShop, Math.trunc(Number(startMs) || 0), Math.trunc(Number(endMs) || 0), pid, ...slice]
    );
    for (const r of rows || []) {
      const vid = r && r.variant_id != null ? String(r.variant_id).trim() : '';
      if (!vid) continue;
      const orders = r && r.orders != null ? Number(r.orders) || 0 : 0;
      out.set(vid, (out.get(vid) || 0) + orders);
    }
  }
  return out;
}

async function countOrdersForProductIdsDistinct({ shop, startMs, endMs, productIds } = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const db = getDb();
  const pids = Array.isArray(productIds) ? productIds.map((v) => safeStr(v, 64)).filter(Boolean) : [];
  if (!safeShop || !pids.length) return 0;

  const orderSet = new Set();
  const CHUNK = 300;
  for (let i = 0; i < pids.length; i += CHUNK) {
    const slice = pids.slice(i, i + CHUNK);
    const inSql = slice.map(() => '?').join(', ');
    const rows = await db.all(
      `
        SELECT DISTINCT order_id
        FROM orders_shopify_line_items
        WHERE shop = ? AND order_created_at >= ? AND order_created_at < ?
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND product_id IS NOT NULL AND TRIM(product_id) IN (${inSql})
      `,
      [safeShop, Math.trunc(Number(startMs) || 0), Math.trunc(Number(endMs) || 0), ...slice]
    );
    for (const r of rows || []) {
      const oid = r && r.order_id != null ? String(r.order_id).trim() : '';
      if (oid) orderSet.add(oid);
    }
  }
  return orderSet.size;
}

function metricBlock({ sessions, orders } = {}) {
  const s = sessions != null ? Number(sessions) : 0;
  const o = orders != null ? Number(orders) : 0;
  const sessionsOut = Number.isFinite(s) ? Math.max(0, Math.trunc(s)) : 0;
  const ordersOut = Number.isFinite(o) ? Math.max(0, Math.trunc(o)) : 0;
  const cr = sessionsOut > 0 ? Math.round((ordersOut / sessionsOut) * 1000) / 10 : null;
  return {
    sessions: sessionsOut,
    orders: ordersOut,
    cr,
  };
}

function pctChange(before, after) {
  const b = typeof before === 'number' ? before : null;
  const a = typeof after === 'number' ? after : null;
  if (b == null || a == null) return null;
  if (!Number.isFinite(b) || !Number.isFinite(a)) return null;
  if (b === 0) return null;
  return (a - b) / b;
}

async function compareConversionRate({
  shop,
  eventDateYmd,
  target,
  mode,
  variantIds,
  variantMapping,
} = {}) {
  const safeShop = salesTruth.resolveShopForSales(shop || '');
  const eventYmd = parseYmd(eventDateYmd);
  if (!safeShop) return { ok: false, error: 'missing_shop' };
  if (!eventYmd) return { ok: false, error: 'missing_event_date' };
  const tgt = target && typeof target === 'object' ? target : null;
  const targetType = tgt && tgt.type ? String(tgt.type) : '';

  const tz = store.resolveAdminTimeZone();
  const nowMs = Date.now();

  const afterStartBounds = store.getRangeBounds('d:' + eventYmd, nowMs, tz);
  const afterStart = afterStartBounds.start;
  const afterEnd = nowMs;

  const beforeStartYmd = ymdAddDays(eventYmd, -30);
  const beforeStartBounds = store.getRangeBounds('d:' + beforeStartYmd, nowMs, tz);
  let beforeStart = beforeStartBounds.start;
  const beforeEnd = afterStart;

  let notice = '';

  const vm = (variantMapping && typeof variantMapping === 'object') ? variantMapping : null;
  const cacheKeyParams = {
    shop: safeShop,
    eventDateYmd: eventYmd,
    target: tgt,
    mode: mode || '',
    variantIds: Array.isArray(variantIds) ? variantIds.slice().sort() : null,
    variantMapping: vm
      ? {
        table_id: safeStr(vm.table_id, 120) || null,
        group_ids: Array.isArray(vm.group_ids) ? vm.group_ids.map((v) => safeStr(v, 120)).filter(Boolean).sort() : null,
      }
      : null,
  };

  const cached = await reportCache.getOrComputeJson(
    {
      shop: safeShop,
      endpoint: 'tools-compare-cr',
      rangeKey: 'd:' + eventYmd,
      rangeStartTs: beforeStart,
      rangeEndTs: afterEnd,
      params: cacheKeyParams,
      ttlMs: 5 * 60 * 1000,
      force: false,
    },
    async () => {
      let product = null;
      let collection = null;
      let handles = [];
      let productIds = [];

      if (targetType === 'product') {
        const pid = safeStr(tgt && tgt.product_id, 64);
        const handle = normalizeHandle(tgt && tgt.handle);
        const title = safeStr(tgt && tgt.title, 160) || null;
        const createdAtIso = tgt && tgt.created_at ? String(tgt.created_at) : null;
        let createdAtMs = null;
        if (createdAtIso) {
          const ms = Date.parse(createdAtIso);
          if (Number.isFinite(ms)) createdAtMs = ms;
        }
        if (!pid || !handle) return { ok: false, error: 'missing_product' };
        product = { product_id: pid, handle, title, created_at: createdAtIso };
        handles = [handle];
        productIds = [pid];

        if (createdAtMs != null && createdAtMs > beforeStart) {
          beforeStart = createdAtMs;
          notice = 'Product did not exist for full comparison window.';
        }
      } else if (targetType === 'collection') {
        const cid = safeStr(tgt && tgt.collection_id, 64);
        const title = safeStr(tgt && tgt.title, 160) || null;
        if (!cid) return { ok: false, error: 'missing_collection' };

        const fetched = await getCollectionProducts({ shop: safeShop, collectionId: cid });
        if (!fetched.ok) return { ok: false, error: fetched.error || 'collection_fetch_failed' };
        collection = { collection_id: cid, title };
        handles = (fetched.products || []).map((p) => normalizeHandle(p && p.handle)).filter(Boolean);
        productIds = (fetched.products || []).map((p) => safeStr(p && p.product_id, 64)).filter(Boolean);
      } else {
        return { ok: false, error: 'invalid_target' };
      }

      try {
        await salesTruth.ensureReconciled(safeShop, beforeStart, afterEnd, 'tools_compare_cr');
      } catch (_) {}

      let sessionsBefore = 0;
      let sessionsAfter = 0;
      if (targetType === 'product') {
        sessionsBefore = await countLandingSessionsForHandle({ shop: safeShop, startMs: beforeStart, endMs: beforeEnd, handle: handles[0] });
        sessionsAfter = await countLandingSessionsForHandle({ shop: safeShop, startMs: afterStart, endMs: afterEnd, handle: handles[0] });
      } else {
        const set = new Set(handles.map((h) => normalizeHandle(h)).filter(Boolean));
        sessionsBefore = await countLandingSessionsByHandleSetScan({ startMs: beforeStart, endMs: beforeEnd, handleSet: set });
        sessionsAfter = await countLandingSessionsByHandleSetScan({ startMs: afterStart, endMs: afterEnd, handleSet: set });
      }

      let ordersBefore = 0;
      let ordersAfter = 0;

      if (targetType === 'product') {
        ordersBefore = await countOrdersForProductId({ shop: safeShop, startMs: beforeStart, endMs: beforeEnd, productId: productIds[0] });
        ordersAfter = await countOrdersForProductId({ shop: safeShop, startMs: afterStart, endMs: afterEnd, productId: productIds[0] });
      } else {
        ordersBefore = await countOrdersForProductIdsDistinct({ shop: safeShop, startMs: beforeStart, endMs: beforeEnd, productIds });
        ordersAfter = await countOrdersForProductIdsDistinct({ shop: safeShop, startMs: afterStart, endMs: afterEnd, productIds });
      }

      const before = metricBlock({ sessions: sessionsBefore, orders: ordersBefore });
      const after = metricBlock({ sessions: sessionsAfter, orders: ordersAfter });

      const insufficient = (before.sessions <= 0 || after.sessions <= 0);

      let variantsOut = null;
      const m = (mode || '').toLowerCase();
      if (targetType === 'product' && m === 'variants') {
        const vars = await getProductVariants({ shop: safeShop, productId: productIds[0] });
        if (!vars.ok) return { ok: false, error: vars.error || 'variants_fetch_failed' };
        const allVariants = Array.isArray(vars.variants) ? vars.variants : [];
        const selected = Array.isArray(variantIds) && variantIds.length
          ? new Set(variantIds.map((v) => safeStr(v, 64)).filter(Boolean))
          : null;
        const variants = selected
          ? allVariants.filter((v) => v && v.variant_id && selected.has(String(v.variant_id)))
          : allVariants;

        const vids = variants.map((v) => safeStr(v && v.variant_id, 64)).filter(Boolean);
        const variantIdSet = new Set(vids);
        const beforeSessionsByVid = await countVariantLandingSessions({ startMs: beforeStart, endMs: beforeEnd, handle: handles[0], variantIdSet });
        const afterSessionsByVid = await countVariantLandingSessions({ startMs: afterStart, endMs: afterEnd, handle: handles[0], variantIdSet });
        const beforeByVid = await countOrdersByVariantIds({ shop: safeShop, startMs: beforeStart, endMs: beforeEnd, productId: productIds[0], variantIds: vids });
        const afterByVid = await countOrdersByVariantIds({ shop: safeShop, startMs: afterStart, endMs: afterEnd, productId: productIds[0], variantIds: vids });

        variantsOut = variants.map((v) => {
          const vid = safeStr(v && v.variant_id, 64);
          const nameParts = [];
          if (v && v.selected_options && v.selected_options.length) {
            for (const o of v.selected_options) {
              const oname = safeStr(o && o.name, 60);
              const val = safeStr(o && o.value, 80);
              if (!val) continue;
              nameParts.push(oname ? (oname + ': ' + val) : val);
            }
          }
          const variantName = nameParts.length ? nameParts.join(' / ') : (safeStr(v && v.title, 200) || vid);
          const bOrders = beforeByVid && beforeByVid.has(vid) ? beforeByVid.get(vid) : 0;
          const aOrders = afterByVid && afterByVid.has(vid) ? afterByVid.get(vid) : 0;
          const bSessions = beforeSessionsByVid && beforeSessionsByVid.has(vid) ? beforeSessionsByVid.get(vid) : 0;
          const aSessions = afterSessionsByVid && afterSessionsByVid.has(vid) ? afterSessionsByVid.get(vid) : 0;
          const b = metricBlock({ sessions: bSessions, orders: bOrders });
          const a = metricBlock({ sessions: aSessions, orders: aOrders });
          return {
            variant_id: vid,
            variant_name: variantName,
            before: b,
            after: a,
            abs_change: (b.cr != null && a.cr != null) ? (a.cr - b.cr) : null,
            pct_change: pctChange(b.cr, a.cr),
          };
        });
      }

      if (targetType === 'product' && m === 'mapped') {
        const rawCfg = await store.getSetting(VARIANTS_CONFIG_KEY).catch(() => null);
        const cfg = normalizeVariantsConfigV1(rawCfg);
        const tables = Array.isArray(cfg && cfg.tables)
          ? cfg.tables.filter((t) => t && t.enabled && Array.isArray(t.rules) && t.rules.length)
          : [];
        if (!tables.length) {
          variantsOut = [];
          notice = (notice ? (notice + ' ') : '') + 'No variant label mappings configured. Open Settings → Insights → Variants to create or suggest mappings.';
        } else {

          const tableIdReq = safeStr(vm && vm.table_id, 120).trim().toLowerCase();
          let table = tableIdReq
            ? (tables.find((t) => String(t.id || '').trim().toLowerCase() === tableIdReq) || null)
            : (tables[0] || null);
          if (!table) {
            variantsOut = [];
            notice = (notice ? (notice + ' ') : '') + 'Variant label mapping table not found.';
          } else {
            if (tableIdReq && String(table.id || '').trim().toLowerCase() !== tableIdReq) {
              notice = (notice ? (notice + ' ') : '') + 'Requested mapping table not found; using the first enabled table.';
            }

            const wanted = Array.isArray(vm && vm.group_ids)
              ? new Set(vm.group_ids.map((x) => safeStr(x, 120)).filter(Boolean))
              : null;

            const vars = await getProductVariants({ shop: safeShop, productId: productIds[0] });
            if (!vars.ok) return { ok: false, error: vars.error || 'variants_fetch_failed' };
            const allVariants = Array.isArray(vars.variants) ? vars.variants : [];

            const ignoredSet = new Set(Array.isArray(table && table.ignored) ? table.ignored.map((t) => normalizeIgnoredTitle(t)).filter(Boolean) : []);

            const groupsByRuleId = new Map(); // rule_id -> { rule_id, label, variant_ids: [] }
            let unmappedCount = 0;
            let outOfScopeCount = 0;
            let ignoredCount = 0;
            for (const v of allVariants) {
              const vid = safeStr(v && v.variant_id, 64);
              if (!vid) continue;
              const title = safeStr(v && v.title, 240) || vid;
              if (ignoredSet.has(normalizeIgnoredTitle(title))) {
                ignoredCount += 1;
                continue;
              }
              const classified = classifyTitleForTable(table, title);
              if (classified && classified.kind === 'matched' && classified.rule) {
                const rid = safeStr(classified.rule.id, 120) || '';
                if (!rid) continue;
                if (wanted && wanted.size && !wanted.has(rid)) continue;
                const label = safeStr(classified.rule.label, 200) || rid;
                const cur = groupsByRuleId.get(rid) || { rule_id: rid, label, variant_ids: [] };
                cur.variant_ids.push(vid);
                groupsByRuleId.set(rid, cur);
              } else if (classified && classified.kind === 'unmapped') {
                unmappedCount += 1;
              } else if (classified && classified.kind === 'out_of_scope') {
                outOfScopeCount += 1;
              }
            }

            const groups = Array.from(groupsByRuleId.values()).sort((a, b) => String(a.label || a.rule_id).localeCompare(String(b.label || b.rule_id)));
            const allVids = Array.from(new Set(groups.flatMap((g) => g.variant_ids || []))).filter(Boolean);
            const variantIdSet = new Set(allVids);

            if (!groups.length) {
              variantsOut = [];
              notice = (notice ? (notice + ' ') : '') + `No variants matched your "${table.name}" mappings.`;
              if (unmappedCount > 0) {
                notice += ` (${unmappedCount} unmapped variants)`;
              }
            } else {
              notice = (notice ? (notice + ' ') : '') + `Variant labels: "${table.name}".`;
              if (unmappedCount > 0) notice += ` ${unmappedCount} unmapped variants.`;
              if (ignoredCount > 0) notice += ` ${ignoredCount} ignored.`;
              if (outOfScopeCount > 0) notice += ` ${outOfScopeCount} out of scope.`;

              const beforeSessionsByVid = await countVariantLandingSessions({ startMs: beforeStart, endMs: beforeEnd, handle: handles[0], variantIdSet });
              const afterSessionsByVid = await countVariantLandingSessions({ startMs: afterStart, endMs: afterEnd, handle: handles[0], variantIdSet });
              const beforeByVid = await countOrdersByVariantIds({ shop: safeShop, startMs: beforeStart, endMs: beforeEnd, productId: productIds[0], variantIds: allVids });
              const afterByVid = await countOrdersByVariantIds({ shop: safeShop, startMs: afterStart, endMs: afterEnd, productId: productIds[0], variantIds: allVids });

              variantsOut = groups.map((g) => {
                let bSessions = 0;
                let aSessions = 0;
                let bOrders = 0;
                let aOrders = 0;
                for (const vid of (g.variant_ids || [])) {
                  bSessions += beforeSessionsByVid && beforeSessionsByVid.has(vid) ? beforeSessionsByVid.get(vid) : 0;
                  aSessions += afterSessionsByVid && afterSessionsByVid.has(vid) ? afterSessionsByVid.get(vid) : 0;
                  bOrders += beforeByVid && beforeByVid.has(vid) ? beforeByVid.get(vid) : 0;
                  aOrders += afterByVid && afterByVid.has(vid) ? afterByVid.get(vid) : 0;
                }
                const b = metricBlock({ sessions: bSessions, orders: bOrders });
                const a = metricBlock({ sessions: aSessions, orders: aOrders });
                return {
                  variant_id: g.rule_id,
                  variant_name: g.label,
                  before: b,
                  after: a,
                  abs_change: (b.cr != null && a.cr != null) ? (a.cr - b.cr) : null,
                  pct_change: pctChange(b.cr, a.cr),
                };
              });
            }
          }
        }
      }

      const summary = {
        before,
        after,
        abs_change: (before.cr != null && after.cr != null) ? (after.cr - before.cr) : null,
        pct_change: pctChange(before.cr, after.cr),
      };

      return {
        ok: true,
        shop: safeShop,
        target: targetType === 'product' ? { type: 'product', ...product } : { type: 'collection', ...collection },
        mode: m || 'product',
        notice: notice || null,
        range: {
          before: { start: beforeStart, end: beforeEnd },
          after: { start: afterStart, end: afterEnd },
        },
        insufficient,
        summary,
        variants: variantsOut,
      };
    }
  );

  return cached && cached.ok ? cached.data : { ok: false, error: 'cache_failed' };
}

module.exports = {
  catalogSearch,
  getProductVariants,
  getProductMappedVariantGroups,
  compareConversionRate,
};
