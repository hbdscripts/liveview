const { URL } = require('url');

const config = require('./config');
const { getDb } = require('./db');
const fx = require('./fx');
const {
  classifyTitleForTable,
  normalizeIgnoredTitle,
} = require('./variantInsightsConfig');

const RANGE_KEYS = ['today', 'yesterday', '3d', '7d', '14d', '30d', 'month'];
const BOT_FILTER_SQL = ' AND (s.cf_known_bot IS NULL OR s.cf_known_bot = 0)';
const DIAGNOSTIC_EXAMPLE_LIMIT = 120;

function clampInt(v, fallback, min, max) {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
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

async function getObservedVariantsForValidation({ shop, start, end, maxRows = 2000 } = {}) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const rowLimit = clampInt(maxRows, 2000, 100, 5000);
  if (!safeShop || !safeShop.endsWith('.myshopify.com')) return [];
  const db = getDb();

  if (config.dbUrl) {
    return db.all(
      `
        SELECT
          variant_title,
          COUNT(DISTINCT order_id) AS orders,
          COALESCE(SUM(line_revenue), 0) AS revenue
        FROM orders_shopify_line_items
        WHERE shop = $1
          AND order_created_at >= $2
          AND order_created_at < $3
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND variant_title IS NOT NULL
          AND TRIM(variant_title) != ''
        GROUP BY variant_title
        ORDER BY orders DESC, revenue DESC, variant_title ASC
        LIMIT ${rowLimit}
      `,
      [safeShop, start, end]
    );
  }

  return db.all(
    `
      SELECT
        variant_title,
        COUNT(DISTINCT order_id) AS orders,
        COALESCE(SUM(line_revenue), 0) AS revenue
      FROM orders_shopify_line_items
      WHERE shop = ?
        AND order_created_at >= ?
        AND order_created_at < ?
        AND (order_test IS NULL OR order_test = 0)
        AND order_cancelled_at IS NULL
        AND order_financial_status = 'paid'
        AND variant_title IS NOT NULL
        AND TRIM(variant_title) != ''
      GROUP BY variant_title
      ORDER BY orders DESC, revenue DESC, variant_title ASC
      LIMIT ${rowLimit}
    `,
    [safeShop, start, end]
  );
}

async function getSessionAttributionSummary({ start, end } = {}) {
  const db = getDb();
  const query = `
    SELECT
      COUNT(1) AS total_sessions,
      SUM(CASE WHEN s.entry_url IS NOT NULL AND TRIM(s.entry_url) != '' THEN 1 ELSE 0 END) AS with_entry_url_sessions,
      SUM(CASE WHEN s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%/products/%' THEN 1 ELSE 0 END) AS product_entry_sessions,
      SUM(CASE WHEN s.entry_url IS NOT NULL AND LOWER(s.entry_url) LIKE '%variant=%' THEN 1 ELSE 0 END) AS variant_param_sessions
    FROM sessions s
    WHERE s.started_at >= ${config.dbUrl ? '$1' : '?'}
      AND s.started_at < ${config.dbUrl ? '$2' : '?'}
      ${BOT_FILTER_SQL}
  `;
  const row = config.dbUrl
    ? await db.get(query, [start, end])
    : await db.get(query, [start, end]);
  return {
    totalSessions: toCount(row && row.total_sessions),
    withEntryUrlSessions: toCount(row && row.with_entry_url_sessions),
    productEntrySessions: toCount(row && row.product_entry_sessions),
    variantParamSessions: toCount(row && row.variant_param_sessions),
  };
}

async function getVariantOrderRows({ shop, start, end } = {}) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  if (!safeShop || !safeShop.endsWith('.myshopify.com')) return [];
  const db = getDb();

  if (config.dbUrl) {
    return db.all(
      `
        SELECT
          TRIM(variant_id) AS variant_id,
          MAX(variant_title) AS variant_title,
          COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
          COUNT(DISTINCT order_id) AS orders,
          COALESCE(SUM(line_revenue), 0) AS revenue
        FROM orders_shopify_line_items
        WHERE shop = $1
          AND order_created_at >= $2
          AND order_created_at < $3
          AND (order_test IS NULL OR order_test = 0)
          AND order_cancelled_at IS NULL
          AND order_financial_status = 'paid'
          AND variant_id IS NOT NULL
          AND TRIM(variant_id) != ''
          AND variant_title IS NOT NULL
          AND TRIM(variant_title) != ''
        GROUP BY TRIM(variant_id), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
      `,
      [safeShop, start, end]
    );
  }

  return db.all(
    `
      SELECT
        TRIM(variant_id) AS variant_id,
        MAX(variant_title) AS variant_title,
        COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency,
        COUNT(DISTINCT order_id) AS orders,
        COALESCE(SUM(line_revenue), 0) AS revenue
      FROM orders_shopify_line_items
      WHERE shop = ?
        AND order_created_at >= ?
        AND order_created_at < ?
        AND (order_test IS NULL OR order_test = 0)
        AND order_cancelled_at IS NULL
        AND order_financial_status = 'paid'
        AND variant_id IS NOT NULL
        AND TRIM(variant_id) != ''
        AND variant_title IS NOT NULL
        AND TRIM(variant_title) != ''
      GROUP BY TRIM(variant_id), COALESCE(NULLIF(TRIM(currency), ''), 'GBP')
    `,
    [safeShop, start, end]
  );
}

async function getVariantSessionCounts({ start, end } = {}) {
  const db = getDb();
  const rows = config.dbUrl
    ? await db.all(
      `
        SELECT s.entry_url
        FROM sessions s
        WHERE s.started_at >= $1
          AND s.started_at < $2
          ${BOT_FILTER_SQL}
          AND s.entry_url IS NOT NULL
          AND LOWER(s.entry_url) LIKE '%variant=%'
      `,
      [start, end]
    )
    : await db.all(
      `
        SELECT s.entry_url
        FROM sessions s
        WHERE s.started_at >= ?
          AND s.started_at < ?
          ${BOT_FILTER_SQL}
          AND s.entry_url IS NOT NULL
          AND LOWER(s.entry_url) LIKE '%variant=%'
      `,
      [start, end]
    );

  const out = new Map();
  for (const r of rows || []) {
    const entry = r && r.entry_url != null ? String(r.entry_url) : '';
    const variantId = extractVariantIdFromUrl(entry);
    if (!variantId) continue;
    out.set(variantId, (out.get(variantId) || 0) + 1);
  }
  return out;
}

async function fillTitlesForVariantIds({ shop, variantIds } = {}) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const ids = Array.isArray(variantIds) ? variantIds.map((v) => String(v || '').trim()).filter(Boolean) : [];
  const out = new Map();
  if (!safeShop || !safeShop.endsWith('.myshopify.com') || !ids.length) return out;
  const db = getDb();
  const chunkSize = 300;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    if (!chunk.length) continue;
    if (config.dbUrl) {
      const placeholders = chunk.map((_, idx) => `$${idx + 2}`).join(', ');
      const rows = await db.all(
        `
          SELECT TRIM(variant_id) AS variant_id, MAX(variant_title) AS variant_title
          FROM orders_shopify_line_items
          WHERE shop = $1
            AND variant_id IS NOT NULL
            AND TRIM(variant_id) IN (${placeholders})
            AND variant_title IS NOT NULL
            AND TRIM(variant_title) != ''
          GROUP BY TRIM(variant_id)
        `,
        [safeShop, ...chunk]
      );
      for (const r of rows || []) {
        const id = r && r.variant_id != null ? String(r.variant_id).trim() : '';
        const title = r && r.variant_title != null ? String(r.variant_title).trim() : '';
        if (id && title) out.set(id, title);
      }
      continue;
    }

    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db.all(
      `
        SELECT TRIM(variant_id) AS variant_id, MAX(variant_title) AS variant_title
        FROM orders_shopify_line_items
        WHERE shop = ?
          AND variant_id IS NOT NULL
          AND TRIM(variant_id) IN (${placeholders})
          AND variant_title IS NOT NULL
          AND TRIM(variant_title) != ''
        GROUP BY TRIM(variant_id)
      `,
      [safeShop, ...chunk]
    );
    for (const r of rows || []) {
      const id = r && r.variant_id != null ? String(r.variant_id).trim() : '';
      const title = r && r.variant_title != null ? String(r.variant_title).trim() : '';
      if (id && title) out.set(id, title);
    }
  }

  return out;
}

function sortRowsByRevenue(rows) {
  rows.sort((a, b) => {
    const rev = (Number(b.revenue) || 0) - (Number(a.revenue) || 0);
    if (rev !== 0) return rev;
    const ord = (Number(b.orders) || 0) - (Number(a.orders) || 0);
    if (ord !== 0) return ord;
    const ses = (Number(b.sessions) || 0) - (Number(a.sessions) || 0);
    if (ses !== 0) return ses;
    const av = a && a.variant ? String(a.variant).toLowerCase() : '';
    const bv = b && b.variant ? String(b.variant).toLowerCase() : '';
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
}

async function buildVariantsInsightTables({ shop, start, end, variantsConfig } = {}) {
  const safeShop = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  const configObj = variantsConfig && typeof variantsConfig === 'object'
    ? variantsConfig
    : { v: 1, tables: [] };
  const tables = Array.isArray(configObj.tables) ? configObj.tables.filter((t) => t && t.enabled) : [];
  if (!safeShop || !safeShop.endsWith('.myshopify.com') || !tables.length) {
    return { tables: [], diagnostics: [], attribution: null };
  }

  const orderRows = await getVariantOrderRows({ shop: safeShop, start, end });
  const attributionBase = await getSessionAttributionSummary({ start, end });
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

  // Include sessions-only variants as denominator candidates.
  const missingVariantIds = [];
  for (const [variantId, sessions] of sessionsByVariant.entries()) {
    const current = byVariant.get(variantId);
    if (current) {
      current.sessions = sessions;
      continue;
    }
    missingVariantIds.push(variantId);
    byVariant.set(variantId, {
      variant_id: variantId,
      variant_title: '',
      orders: 0,
      revenue: 0,
      sessions,
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

  const diagnostics = [];
  const outTables = [];

  for (const table of tables) {
    const rowMap = new Map();
    const ignored = [];
    const resolved = [];
    const outOfScope = [];
    const unmapped = [];
    const ambiguous = [];
    const ignoredSet = new Set(
      (Array.isArray(table && table.ignored) ? table.ignored : [])
        .map((entry) => normalizeIgnoredTitle(entry))
        .filter(Boolean)
    );
    const mappedTotals = { sessions: 0, orders: 0, revenue: 0 };
    const resolvedTotals = { sessions: 0, orders: 0, revenue: 0 };
    const ignoredTotals = { sessions: 0, orders: 0, revenue: 0 };
    const outOfScopeTotals = { sessions: 0, orders: 0, revenue: 0 };
    const unmappedTotals = { sessions: 0, orders: 0, revenue: 0 };
    const ambiguousTotals = { sessions: 0, orders: 0, revenue: 0 };
    for (const variant of byVariant.values()) {
      const title = variant && variant.variant_title ? String(variant.variant_title) : '';
      if (ignoredSet.has(normalizeIgnoredTitle(title))) {
        ignored.push({
          variant_id: variant.variant_id,
          variant_title: title || `Variant ${variant.variant_id}`,
          sessions: variant.sessions || 0,
          orders: variant.orders || 0,
          revenue: Math.round((Number(variant.revenue) || 0) * 100) / 100,
        });
        ignoredTotals.sessions += variant.sessions || 0;
        ignoredTotals.orders += variant.orders || 0;
        ignoredTotals.revenue += variant.revenue || 0;
        continue;
      }
      const classified = classifyTitleForTable(table, title);
      if (classified.kind === 'out_of_scope') {
        outOfScope.push({
          variant_id: variant.variant_id,
          variant_title: title || `Variant ${variant.variant_id}`,
          sessions: variant.sessions || 0,
          orders: variant.orders || 0,
          revenue: Math.round((Number(variant.revenue) || 0) * 100) / 100,
        });
        outOfScopeTotals.sessions += variant.sessions || 0;
        outOfScopeTotals.orders += variant.orders || 0;
        outOfScopeTotals.revenue += variant.revenue || 0;
        continue;
      }
      if (classified.kind === 'matched') {
        const rule = classified.rule;
        const key = rule.id;
        const label = rule.label;
        const current = rowMap.get(key) || {
          key,
          variant: label,
          sessions: 0,
          orders: 0,
          revenue: 0,
        };
        current.sessions += variant && variant.sessions != null ? Number(variant.sessions) || 0 : 0;
        current.orders += variant && variant.orders != null ? Number(variant.orders) || 0 : 0;
        current.revenue += variant && variant.revenue != null ? Number(variant.revenue) || 0 : 0;
        rowMap.set(key, current);
        mappedTotals.sessions += variant && variant.sessions != null ? Number(variant.sessions) || 0 : 0;
        mappedTotals.orders += variant && variant.orders != null ? Number(variant.orders) || 0 : 0;
        mappedTotals.revenue += variant && variant.revenue != null ? Number(variant.revenue) || 0 : 0;
        if (classified.resolved) {
          resolved.push({
            variant_id: variant.variant_id,
            variant_title: title || `Variant ${variant.variant_id}`,
            sessions: variant.sessions || 0,
            orders: variant.orders || 0,
            revenue: Math.round((Number(variant.revenue) || 0) * 100) / 100,
            chosen: rule && rule.label ? String(rule.label) : '',
            matches: Array.isArray(classified.matches)
              ? classified.matches.map((m) => ({ id: m.id, label: m.label }))
              : [],
          });
          resolvedTotals.sessions += variant.sessions || 0;
          resolvedTotals.orders += variant.orders || 0;
          resolvedTotals.revenue += variant.revenue || 0;
        }
      } else if (classified.kind === 'unmapped') {
        unmapped.push({
          variant_id: variant.variant_id,
          variant_title: title || `Variant ${variant.variant_id}`,
          sessions: variant.sessions || 0,
          orders: variant.orders || 0,
          revenue: Math.round((Number(variant.revenue) || 0) * 100) / 100,
        });
        unmappedTotals.sessions += variant.sessions || 0;
        unmappedTotals.orders += variant.orders || 0;
        unmappedTotals.revenue += variant.revenue || 0;
      } else if (classified.kind === 'ambiguous') {
        ambiguous.push({
          variant_id: variant.variant_id,
          variant_title: title || `Variant ${variant.variant_id}`,
          sessions: variant.sessions || 0,
          orders: variant.orders || 0,
          revenue: Math.round((Number(variant.revenue) || 0) * 100) / 100,
          matches: classified.matches.map((m) => ({ id: m.id, label: m.label })),
        });
        ambiguousTotals.sessions += variant.sessions || 0;
        ambiguousTotals.orders += variant.orders || 0;
        ambiguousTotals.revenue += variant.revenue || 0;
      }
    }

    const rows = [];
    for (const row of rowMap.values()) {
      const sessions = Number(row.sessions) || 0;
      const orders = Number(row.orders) || 0;
      const revenue = Math.round((Number(row.revenue) || 0) * 100) / 100;
      if (sessions <= 0 && orders <= 0 && revenue <= 0) continue;
      rows.push({
        key: row.key,
        variant: row.variant,
        sessions,
        orders,
        cr: sessions > 0 ? Math.round((orders / sessions) * 1000) / 10 : null,
        revenue,
      });
    }
    sortRowsByRevenue(rows);

    outOfScope.sort((a, b) => (b.orders - a.orders) || (b.sessions - a.sessions) || (b.revenue - a.revenue));
    resolved.sort((a, b) => (b.orders - a.orders) || (b.sessions - a.sessions) || (b.revenue - a.revenue));
    ignored.sort((a, b) => (b.orders - a.orders) || (b.sessions - a.sessions) || (b.revenue - a.revenue));
    unmapped.sort((a, b) => (b.orders - a.orders) || (b.sessions - a.sessions) || (b.revenue - a.revenue));
    ambiguous.sort((a, b) => (b.orders - a.orders) || (b.sessions - a.sessions) || (b.revenue - a.revenue));

    diagnostics.push({
      tableId: table.id,
      tableName: table.name,
      resolvedCount: resolved.length,
      ignoredCount: ignored.length,
      outOfScopeCount: outOfScope.length,
      unmappedCount: unmapped.length,
      ambiguousCount: ambiguous.length,
      exampleLimit: DIAGNOSTIC_EXAMPLE_LIMIT,
      totals: {
        mapped: {
          sessions: Math.round(mappedTotals.sessions),
          orders: Math.round(mappedTotals.orders),
          revenue: Math.round((mappedTotals.revenue || 0) * 100) / 100,
        },
        resolved: {
          sessions: Math.round(resolvedTotals.sessions),
          orders: Math.round(resolvedTotals.orders),
          revenue: Math.round((resolvedTotals.revenue || 0) * 100) / 100,
        },
        ignored: {
          sessions: Math.round(ignoredTotals.sessions),
          orders: Math.round(ignoredTotals.orders),
          revenue: Math.round((ignoredTotals.revenue || 0) * 100) / 100,
        },
        outOfScope: {
          sessions: Math.round(outOfScopeTotals.sessions),
          orders: Math.round(outOfScopeTotals.orders),
          revenue: Math.round((outOfScopeTotals.revenue || 0) * 100) / 100,
        },
        unmapped: {
          sessions: Math.round(unmappedTotals.sessions),
          orders: Math.round(unmappedTotals.orders),
          revenue: Math.round((unmappedTotals.revenue || 0) * 100) / 100,
        },
        ambiguous: {
          sessions: Math.round(ambiguousTotals.sessions),
          orders: Math.round(ambiguousTotals.orders),
          revenue: Math.round((ambiguousTotals.revenue || 0) * 100) / 100,
        },
      },
      resolvedExamples: resolved.slice(0, DIAGNOSTIC_EXAMPLE_LIMIT),
      ignoredExamples: ignored.slice(0, DIAGNOSTIC_EXAMPLE_LIMIT),
      outOfScopeExamples: outOfScope.slice(0, DIAGNOSTIC_EXAMPLE_LIMIT),
      unmappedExamples: unmapped.slice(0, DIAGNOSTIC_EXAMPLE_LIMIT),
      ambiguousExamples: ambiguous.slice(0, DIAGNOSTIC_EXAMPLE_LIMIT),
    });

    outTables.push({
      id: table.id,
      name: table.name,
      order: table.order,
      icon: table.icon || '',
      rows,
    });
  }

  outTables.sort((a, b) => {
    const ao = Number.isFinite(a && a.order) ? a.order : 0;
    const bo = Number.isFinite(b && b.order) ? b.order : 0;
    if (ao !== bo) return ao - bo;
    const an = a && a.name ? String(a.name).toLowerCase() : '';
    const bn = b && b.name ? String(b.name).toLowerCase() : '';
    if (an < bn) return -1;
    if (an > bn) return 1;
    return 0;
  });

  let validVariantParamSessions = 0;
  for (const count of sessionsByVariant.values()) validVariantParamSessions += toCount(count);
  const productEntrySessions = toCount(attributionBase && attributionBase.productEntrySessions);
  const attribution = {
    totalSessions: toCount(attributionBase && attributionBase.totalSessions),
    withEntryUrlSessions: toCount(attributionBase && attributionBase.withEntryUrlSessions),
    productEntrySessions,
    variantParamSessions: toCount(attributionBase && attributionBase.variantParamSessions),
    variantParamSessionsValid: validVariantParamSessions,
    variantParamCoveragePct: productEntrySessions > 0
      ? Math.round((validVariantParamSessions / productEntrySessions) * 1000) / 10
      : null,
  };

  return { tables: outTables, diagnostics, attribution };
}

module.exports = {
  RANGE_KEYS,
  extractVariantIdFromUrl,
  // Internal helpers exposed for suggestion engine & diagnostics.
  getVariantOrderRows,
  getVariantSessionCounts,
  fillTitlesForVariantIds,
  getObservedVariantsForValidation,
  buildVariantsInsightTables,
};
