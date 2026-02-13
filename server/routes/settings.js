/**
 * GET/POST /api/settings
 *
 * Small authenticated settings surface for the dashboard (stored in DB settings table).
 * Currently used to toggle pixel session strategy for debugging session count drift.
 */
const store = require('../store');
const salesTruth = require('../salesTruth');
const {
  VARIANTS_CONFIG_KEY,
  defaultVariantsConfigV1,
  normalizeVariantsConfigV1,
  normalizeVariantsConfigForSave,
  normalizeIgnoredTitle,
  validateConfigStructure,
  validateConfigAgainstVariants,
} = require('../variantInsightsConfig');
const { getObservedVariantsForValidation } = require('../variantInsightsService');
const {
  PROFIT_RULES_V1_KEY,
  defaultProfitRulesConfigV1,
  normalizeProfitRulesConfigV1,
} = require('../profitRulesConfig');

const PIXEL_SESSION_MODE_KEY = 'pixel_session_mode'; // legacy | shared_ttl
const ASSET_OVERRIDES_KEY = 'asset_overrides'; // JSON object
const KPI_UI_CONFIG_V1_KEY = 'kpi_ui_config_v1'; // JSON object (KPIs + date ranges + options)
const CHARTS_UI_CONFIG_V1_KEY = 'charts_ui_config_v1'; // JSON object (chart type/colors/visibility)
const TABLES_UI_CONFIG_V1_KEY = 'tables_ui_config_v1'; // JSON object (table rows + layout + sticky column sizing)
const SETTINGS_SCOPE_MODE_KEY = 'settings_scope_mode'; // global (shared) | user (disabled for now)

const KPI_UI_KEYS = [
  'orders',
  'revenue',
  'conv',
  'roas',
  'sessions',
  'returning',
  'aov',
  'cogs',
  'bounce',
  'fulfilled',
  'returns',
  'items',
];
const KPI_UI_KEY_SET = new Set(KPI_UI_KEYS);
const DATE_RANGE_UI_KEYS = ['today', 'yesterday', '7days', '14days', '30days', 'custom'];
const DATE_RANGE_UI_KEY_SET = new Set(DATE_RANGE_UI_KEYS);
const HEADER_KPI_STRIP_PAGE_KEYS = [
  'dashboard',
  'live',
  'sales',
  'date',
  'countries',
  'products',
  'variants',
  'channels',
  'type',
  'ads',
  'compare-conversion-rate',
  'shipping-cr',
  'settings',
];
const HEADER_KPI_STRIP_PAGE_KEY_SET = new Set(HEADER_KPI_STRIP_PAGE_KEYS);

const CHART_UI_KEYS = [
  'dash-chart-revenue',
  'dash-chart-orders',
  'dash-chart-conv',
  'dash-chart-sessions',
  'dash-chart-adspend',
  'live-online-chart',
  'sales-overview-chart',
  'date-overview-chart',
  'ads-overview-chart',
  'channels-chart',
  'type-chart',
  'products-chart',
  'countries-map-chart',
];
const CHART_UI_KEY_SET = new Set(CHART_UI_KEYS);

const CHART_ALLOWED_MODES = Object.freeze({
  'dash-chart-revenue': ['area', 'line', 'bar', 'multi-line-labels'],
  'dash-chart-orders': ['area', 'line', 'bar', 'multi-line-labels'],
  'dash-chart-conv': ['area', 'line', 'bar', 'multi-line-labels'],
  'dash-chart-sessions': ['area', 'line', 'bar', 'multi-line-labels'],
  'dash-chart-adspend': ['area', 'line', 'bar', 'multi-line-labels'],
  'live-online-chart': ['map-animated', 'map-flat'],
  'sales-overview-chart': ['area', 'line', 'bar', 'multi-line-labels'],
  'date-overview-chart': ['area', 'line', 'bar', 'multi-line-labels'],
  'ads-overview-chart': ['combo', 'line', 'area', 'multi-line-labels'],
  'channels-chart': ['line', 'area', 'bar', 'pie', 'multi-line-labels'],
  'type-chart': ['line', 'area', 'bar', 'pie', 'multi-line-labels'],
  'products-chart': ['line', 'area', 'bar', 'pie', 'multi-line-labels'],
  'countries-map-chart': ['map-animated', 'map-flat'],
});

function defaultKpiUiConfigV1() {
  return {
    v: 1,
    options: {
      condensed: {
        showDelta: true,
        showProgress: true,
        showSparkline: true,
      },
      dashboard: {
        showDelta: true,
      },
    },
    headerStrip: {
      pages: {
        dashboard: true,
        live: true,
        sales: true,
        date: true,
        countries: true,
        products: true,
        variants: true,
        channels: true,
        type: true,
        ads: true,
        'compare-conversion-rate': true,
        'shipping-cr': true,
        settings: false,
      },
    },
    kpis: {
      header: [
        { key: 'orders', label: 'Orders', enabled: true },
        { key: 'revenue', label: 'Revenue', enabled: true },
        { key: 'conv', label: 'Conversion Rate', enabled: true },
        { key: 'roas', label: 'ADS ROAS', enabled: true },
        { key: 'sessions', label: 'Sessions', enabled: true },
        { key: 'returning', label: 'Returning', enabled: true },
        { key: 'aov', label: 'AOV', enabled: true },
        { key: 'cogs', label: 'COGS', enabled: true },
        { key: 'bounce', label: 'Bounce Rate', enabled: true },
        { key: 'fulfilled', label: 'Fulfilled', enabled: true },
        { key: 'returns', label: 'Returns', enabled: true },
        { key: 'items', label: 'Items ordered', enabled: true },
      ],
      dashboard: [
        { key: 'revenue', label: 'Revenue', enabled: true },
        { key: 'orders', label: 'Orders', enabled: true },
        { key: 'conv', label: 'Conversion Rate', enabled: true },
        { key: 'aov', label: 'Average Order Value', enabled: true },
        { key: 'sessions', label: 'Sessions', enabled: true },
        { key: 'bounce', label: 'Bounce Rate', enabled: true },
        { key: 'returning', label: 'Returning', enabled: true },
        { key: 'roas', label: 'ADS ROAS', enabled: true },
        { key: 'cogs', label: 'COGS', enabled: true },
        { key: 'fulfilled', label: 'Fulfilled', enabled: true },
        { key: 'returns', label: 'Returns', enabled: true },
        { key: 'items', label: 'Items ordered', enabled: true },
      ],
    },
    dateRanges: [
      { key: 'today', label: 'Today', enabled: true },
      { key: 'yesterday', label: 'Yesterday', enabled: true },
      { key: '7days', label: 'Last 7 days', enabled: true },
      { key: '14days', label: 'Last 14 days', enabled: true },
      { key: '30days', label: 'Last 30 days', enabled: true },
      { key: 'custom', label: 'Custom\u2026', enabled: true },
    ],
  };
}

function defaultChartsUiConfigV1() {
  return {
    v: 1,
    charts: [
      { key: 'dash-chart-revenue', label: 'Dashboard · Revenue', enabled: true, mode: 'area', colors: ['#3eb3ab'] },
      { key: 'dash-chart-orders', label: 'Dashboard · Orders', enabled: true, mode: 'area', colors: ['#3b82f6'] },
      { key: 'dash-chart-conv', label: 'Dashboard · Conversion Rate', enabled: true, mode: 'area', colors: ['#8b5cf6', '#5c6ac4'] },
      { key: 'dash-chart-sessions', label: 'Dashboard · Sessions', enabled: true, mode: 'area', colors: ['#f59e0b'] },
      { key: 'dash-chart-adspend', label: 'Dashboard · Revenue vs Ad Spend', enabled: true, mode: 'area', colors: ['#3eb3ab', '#ef4444'] },
      { key: 'live-online-chart', label: 'Dashboard · Live Online', enabled: true, mode: 'map-animated', colors: ['#16a34a'] },
      { key: 'sales-overview-chart', label: 'Dashboard · Sales Trend', enabled: true, mode: 'area', colors: ['#0d9488'] },
      { key: 'date-overview-chart', label: 'Dashboard · Sessions & Orders Trend', enabled: true, mode: 'area', colors: ['#4b94e4', '#f59e34'] },
      { key: 'ads-overview-chart', label: 'Integrations · Google Ads Overview', enabled: true, mode: 'combo', colors: ['#3eb3ab', '#ef4444', '#4b94e4'] },
      { key: 'channels-chart', label: 'Traffic · Channels', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions' },
      { key: 'type-chart', label: 'Traffic · Device & Platform', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions' },
      { key: 'products-chart', label: 'Insights · Products', enabled: true, mode: 'line', colors: ['#3eb3ab', '#4b94e4', '#f59e34', '#8b5cf6', '#ef4444', '#22c55e'] },
      { key: 'countries-map-chart', label: 'Insights · Countries Map', enabled: true, mode: 'map-flat', colors: ['#3eb3ab'] },
    ],
  };
}

function defaultTablesUiConfigV1() {
  return {
    v: 1,
    shared: {
      convertedRowColors: {
        iconColor: '#2f7d50',
        iconBackground: '#f0f8f1',
        stickyBackground: '#ffffff',
        convertedBackground: '#f9fcfa',
      },
    },
    pages: [
      {
        key: 'dashboard',
        label: 'Dashboard · Overview',
        tables: [
          {
            id: 'dash-top-products',
            name: 'Top Products',
            tableClass: 'dashboard',
            zone: 'dashboard-top-products',
            order: 1,
            inGrid: true,
            rows: { default: 5, options: [5, 10] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'dash-top-countries',
            name: 'Top Countries',
            tableClass: 'dashboard',
            zone: 'dashboard-top-countries',
            order: 2,
            inGrid: true,
            rows: { default: 5, options: [5, 10] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'dash-trending-up',
            name: 'Trending Up',
            tableClass: 'dashboard',
            zone: 'dashboard-trending-up',
            order: 3,
            inGrid: true,
            rows: { default: 5, options: [5, 10] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'dash-trending-down',
            name: 'Trending Down',
            tableClass: 'dashboard',
            zone: 'dashboard-trending-down',
            order: 4,
            inGrid: true,
            rows: { default: 5, options: [5, 10] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'live',
        label: 'Dashboard · Live View',
        tables: [
          {
            id: 'latest-sales-table',
            name: 'Latest sales',
            tableClass: 'dashboard',
            zone: 'live-latest-sales',
            order: 1,
            inGrid: true,
            rows: { default: 5, options: [5] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'sessions-table',
            name: 'Sessions',
            tableClass: 'live',
            zone: 'live-sessions',
            order: 2,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'sales',
        label: 'Dashboard · Recent Sales',
        tables: [
          {
            id: 'sessions-table',
            name: 'Sessions',
            tableClass: 'live',
            zone: 'sales-sessions',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'date',
        label: 'Dashboard · Table View',
        tables: [
          {
            id: 'sessions-table',
            name: 'Sessions',
            tableClass: 'live',
            zone: 'date-sessions',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'countries',
        label: 'Insights · Countries',
        tables: [
          {
            id: 'country-table',
            name: 'Country',
            tableClass: 'live',
            zone: 'countries-main',
            order: 1,
            inGrid: true,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'best-geo-products-table',
            name: 'Country + Product',
            tableClass: 'live',
            zone: 'countries-products',
            order: 2,
            inGrid: true,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'products',
        label: 'Insights · Products',
        tables: [
          {
            id: 'best-sellers-table',
            name: 'Best Sellers',
            tableClass: 'product',
            zone: 'products-best-sellers',
            order: 1,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'best-variants-table',
            name: 'Variant',
            tableClass: 'product',
            zone: 'products-best-variants',
            order: 2,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'type-necklaces-table',
            name: 'Necklaces',
            tableClass: 'product',
            zone: 'products-type-necklaces',
            order: 3,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'type-bracelets-table',
            name: 'Bracelets',
            tableClass: 'product',
            zone: 'products-type-bracelets',
            order: 4,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'type-earrings-table',
            name: 'Earrings',
            tableClass: 'product',
            zone: 'products-type-earrings',
            order: 5,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'type-sets-table',
            name: 'Jewelry Sets',
            tableClass: 'product',
            zone: 'products-type-sets',
            order: 6,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'type-charms-table',
            name: 'Charms',
            tableClass: 'product',
            zone: 'products-type-charms',
            order: 7,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'type-extras-table',
            name: 'Extras',
            tableClass: 'product',
            zone: 'products-type-extras',
            order: 8,
            inGrid: true,
            rows: { default: 10, options: [10, 15, 20] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'channels',
        label: 'Traffic · Channels',
        tables: [
          {
            id: 'traffic-sources-table',
            name: 'Channels',
            tableClass: 'live',
            zone: 'channels-main',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'type',
        label: 'Traffic · Device & Platform',
        tables: [
          {
            id: 'traffic-types-table',
            name: 'Device & Platform',
            tableClass: 'live',
            zone: 'type-main',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'ads',
        label: 'Integrations · Google Ads',
        tables: [
          {
            id: 'ads-root',
            name: 'Google Ads',
            tableClass: 'live',
            zone: 'ads-main',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
    ],
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

function normalizeText(v, fallback) {
  const s = v == null ? '' : String(v);
  const t = s.trim();
  return t ? t.slice(0, 80) : (fallback || '');
}

function normalizeBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  return !!fallback;
}

function normalizeChartModeForKey(key, value, fallback) {
  const k = String(key || '').trim().toLowerCase();
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  const allowed = CHART_ALLOWED_MODES[k] || null;
  if (allowed && allowed.includes(raw)) return raw;
  const fb = fallback == null ? '' : String(fallback).trim().toLowerCase();
  if (allowed && allowed.includes(fb)) return fb;
  // Extremely defensive: pick first allowed or a safe fallback.
  if (allowed && allowed.length) return allowed[0];
  return 'line';
}

function normalizeColorList(rawList, defaults) {
  const out = [];
  const max = 6;
  const list = Array.isArray(rawList) ? rawList : (typeof rawList === 'string' ? rawList.split(',') : []);
  for (const item of list) {
    if (out.length >= max) break;
    const c = normalizeCssColor(item, '');
    if (!c) continue;
    out.push(c);
  }
  const def = Array.isArray(defaults) ? defaults : [];
  if (!out.length) return def.slice(0, max);
  // Fill missing slots from defaults so series colors remain stable.
  for (let i = out.length; i < def.length && i < max; i++) {
    const c = normalizeCssColor(def[i], '');
    if (c) out[i] = c;
  }
  return out.slice(0, max);
}

function normalizePieMetric(v, fallback) {
  const raw = v == null ? '' : String(v).trim().toLowerCase();
  if (raw === 'sessions' || raw === 'orders' || raw === 'revenue') return raw;
  const fb = fallback == null ? '' : String(fallback).trim().toLowerCase();
  if (fb === 'sessions' || fb === 'orders' || fb === 'revenue') return fb;
  return 'sessions';
}

function normalizeTablesUiConfigV1(raw) {
  const def = defaultTablesUiConfigV1();
  const obj = safeJsonParseObject(raw);
  if (!obj || obj.v !== 1) return def;

  const out = JSON.parse(JSON.stringify(def));
  const pageByKey = {};
  for (const p of out.pages) {
    if (!p || typeof p !== 'object') continue;
    const key = p.key != null ? String(p.key).trim().toLowerCase() : '';
    if (!key) continue;
    pageByKey[key] = p;
    const tableById = {};
    for (const t of (Array.isArray(p.tables) ? p.tables : [])) {
      if (!t || typeof t !== 'object') continue;
      const id = t.id != null ? String(t.id).trim().toLowerCase() : '';
      if (!id) continue;
      tableById[id] = t;
    }
    p._tableById = tableById; // internal
  }

  const ABS_MIN = 72;
  const ABS_MAX = 420;

  function normalizeRowOptions(rawList, defaults) {
    const defList = Array.isArray(defaults) ? defaults : [];
    const list = Array.isArray(rawList) ? rawList : (typeof rawList === 'string' ? rawList.split(',') : []);
    const outList = [];
    const seen = new Set();
    for (const item of list) {
      const n = Math.trunc(Number(item));
      if (!Number.isFinite(n) || n <= 0 || n > 200) continue;
      if (seen.has(n)) continue;
      seen.add(n);
      outList.push(n);
      if (outList.length >= 12) break;
    }
    outList.sort((a, b) => a - b);
    return outList.length ? outList : defList.slice(0, 12);
  }

  function pickDefaultRows(rawDefault, options, fallback) {
    const opts = Array.isArray(options) ? options : [];
    const n = Math.trunc(Number(rawDefault));
    if (Number.isFinite(n) && opts.includes(n)) return n;
    const fb = Math.trunc(Number(fallback));
    if (Number.isFinite(fb) && opts.includes(fb)) return fb;
    return opts.length ? opts[0] : (Number.isFinite(fb) ? fb : 20);
  }

  function normalizeStickyWidth(rawValue) {
    if (rawValue == null || rawValue === '') return null;
    const n = Math.trunc(Number(rawValue));
    if (!Number.isFinite(n)) return null;
    return Math.max(ABS_MIN, Math.min(ABS_MAX, n));
  }

  const defColors = (
    def &&
    def.shared &&
    def.shared.convertedRowColors &&
    typeof def.shared.convertedRowColors === 'object'
  ) ? def.shared.convertedRowColors : {};
  const rawColors = (
    obj &&
    obj.shared &&
    obj.shared.convertedRowColors &&
    typeof obj.shared.convertedRowColors === 'object'
  ) ? obj.shared.convertedRowColors : {};
  out.shared = {
    convertedRowColors: {
      iconColor: normalizeCssColor(rawColors.iconColor, defColors.iconColor || '#2f7d50'),
      iconBackground: normalizeCssColor(rawColors.iconBackground, defColors.iconBackground || '#f0f8f1'),
      stickyBackground: normalizeCssColor(rawColors.stickyBackground, defColors.stickyBackground || '#ffffff'),
      convertedBackground: normalizeCssColor(rawColors.convertedBackground, defColors.convertedBackground || '#f9fcfa'),
    },
  };

  if (Array.isArray(obj.pages)) {
    for (const rawPage of obj.pages) {
      if (!rawPage || typeof rawPage !== 'object') continue;
      const key = rawPage.key != null ? String(rawPage.key).trim().toLowerCase() : '';
      if (!key) continue;
      const page = pageByKey[key];
      if (!page) continue;
      const tableById = page._tableById || {};
      const rawTables = Array.isArray(rawPage.tables) ? rawPage.tables : [];
      for (const rawTable of rawTables) {
        if (!rawTable || typeof rawTable !== 'object') continue;
        const id = rawTable.id != null ? String(rawTable.id).trim().toLowerCase() : '';
        if (!id) continue;
        const table = tableById[id];
        if (!table) continue;

        table.name = normalizeText(rawTable.name, table.name || id);
        table.inGrid = normalizeBool(rawTable.inGrid, table.inGrid);

        const defaultRowOptions = table.rows && Array.isArray(table.rows.options) ? table.rows.options : [20];
        const nextOptions = normalizeRowOptions(rawTable.rows && rawTable.rows.options, defaultRowOptions);
        const nextDefault = pickDefaultRows(rawTable.rows && rawTable.rows.default, nextOptions, table.rows && table.rows.default);
        table.rows = { default: nextDefault, options: nextOptions };

        const minWidth = normalizeStickyWidth(rawTable.sticky && rawTable.sticky.minWidth);
        const maxWidth = normalizeStickyWidth(rawTable.sticky && rawTable.sticky.maxWidth);
        let min = minWidth;
        let max = maxWidth;
        if (min != null && max != null && max < min) {
          const tmp = max;
          max = min;
          min = tmp;
        }
        table.sticky = { minWidth: min, maxWidth: max };

        const orderRaw = Math.trunc(Number(rawTable.order));
        table.order = Number.isFinite(orderRaw) && orderRaw > 0 ? orderRaw : table.order;
      }
    }
  }

  // Clean up internal indices + re-sequence orders per page.
  for (const p of out.pages) {
    if (!p || typeof p !== 'object') continue;
    const tables = Array.isArray(p.tables) ? p.tables : [];
    delete p._tableById;
    tables.sort((a, b) => {
      const ao = Number(a && a.order) || 0;
      const bo = Number(b && b.order) || 0;
      if (ao !== bo) return ao - bo;
      const an = a && a.name ? String(a.name).toLowerCase() : '';
      const bn = b && b.name ? String(b.name).toLowerCase() : '';
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    for (let i = 0; i < tables.length; i++) {
      if (!tables[i] || typeof tables[i] !== 'object') continue;
      tables[i].order = i + 1;
    }
  }

  // Stable page ordering (by label)
  out.pages.sort((a, b) => {
    const al = a && a.label ? String(a.label).toLowerCase() : '';
    const bl = b && b.label ? String(b.label).toLowerCase() : '';
    if (al < bl) return -1;
    if (al > bl) return 1;
    return 0;
  });

  return out;
}

function normalizeChartsList(rawList, defaults) {
  const byKey = {};
  for (const d of defaults) byKey[d.key] = d;
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const key = item.key != null ? String(item.key).trim().toLowerCase() : '';
      if (!CHART_UI_KEY_SET.has(key)) continue;
      if (seen.has(key)) continue;
      const def = byKey[key] || { key, label: key, enabled: true, mode: 'line', colors: [] };
      const mode = normalizeChartModeForKey(key, item.mode, def.mode);
      const normalized = {
        key,
        label: normalizeText(item.label, def.label),
        enabled: normalizeBool(item.enabled, def.enabled),
        mode,
        colors: normalizeColorList(item.colors, def.colors),
      };
      // Optional: pie metric (only meaningful for pie-capable charts)
      if ((CHART_ALLOWED_MODES[key] || []).includes('pie')) {
        normalized.pieMetric = normalizePieMetric(item.pieMetric, def.pieMetric || 'sessions');
      }
      out.push(normalized);
      seen.add(key);
    }
  }
  for (const d of defaults) {
    if (seen.has(d.key)) continue;
    out.push({ ...d });
  }
  return out;
}

function normalizeChartsUiConfigV1(raw) {
  const def = defaultChartsUiConfigV1();
  const obj = safeJsonParseObject(raw);
  if (!obj || obj.v !== 1) return def;
  return {
    v: 1,
    charts: normalizeChartsList(obj.charts, def.charts),
  };
}

function normalizeKpiList(rawList, defaults) {
  const byKey = {};
  for (const d of defaults) byKey[d.key] = { key: d.key, label: d.label, enabled: !!d.enabled };
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const key = item.key != null ? String(item.key).trim().toLowerCase() : '';
      if (!KPI_UI_KEY_SET.has(key)) continue;
      if (seen.has(key)) continue;
      const def = byKey[key] || { key, label: key, enabled: true };
      out.push({
        key,
        label: normalizeText(item.label, def.label),
        enabled: normalizeBool(item.enabled, def.enabled),
      });
      seen.add(key);
    }
  }
  for (const d of defaults) {
    if (seen.has(d.key)) continue;
    out.push({ key: d.key, label: d.label, enabled: !!d.enabled });
  }
  return out;
}

function normalizeDateRangeList(rawList, defaults) {
  const byKey = {};
  for (const d of defaults) byKey[d.key] = { key: d.key, label: d.label, enabled: !!d.enabled };
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const key = item.key != null ? String(item.key).trim().toLowerCase() : '';
      if (!DATE_RANGE_UI_KEY_SET.has(key)) continue;
      if (seen.has(key)) continue;
      const def = byKey[key] || { key, label: key, enabled: true };
      out.push({
        key,
        label: normalizeText(item.label, def.label),
        enabled: normalizeBool(item.enabled, def.enabled),
      });
      seen.add(key);
    }
  }
  for (const d of defaults) {
    if (seen.has(d.key)) continue;
    out.push({ key: d.key, label: d.label, enabled: !!d.enabled });
  }
  // Guardrails: never allow disabling Today/Custom.
  for (const it of out) {
    if (!it || typeof it !== 'object') continue;
    if (it.key === 'today' || it.key === 'custom') it.enabled = true;
  }
  return out;
}

function normalizeHeaderKpiStripPages(rawPages, defaultsObj) {
  const defaults = defaultsObj && typeof defaultsObj === 'object' ? defaultsObj : {};
  const obj = rawPages && typeof rawPages === 'object' ? rawPages : {};
  const out = {};
  for (const key of HEADER_KPI_STRIP_PAGE_KEYS) {
    if (!HEADER_KPI_STRIP_PAGE_KEY_SET.has(key)) continue;
    out[key] = normalizeBool(obj[key], normalizeBool(defaults[key], true));
  }
  return out;
}

function normalizeKpiUiConfigV1(raw) {
  const def = defaultKpiUiConfigV1();
  const obj = safeJsonParseObject(raw);
  if (!obj || obj.v !== 1) return def;
  const options = obj.options && typeof obj.options === 'object' ? obj.options : {};
  const condensed = options.condensed && typeof options.condensed === 'object' ? options.condensed : {};
  const dashboard = options.dashboard && typeof options.dashboard === 'object' ? options.dashboard : {};
  const headerStrip = obj.headerStrip && typeof obj.headerStrip === 'object' ? obj.headerStrip : {};
  const headerStripPages = normalizeHeaderKpiStripPages(headerStrip.pages, def.headerStrip.pages);
  const kpis = obj.kpis && typeof obj.kpis === 'object' ? obj.kpis : {};
  const header = normalizeKpiList(kpis.header, def.kpis.header);
  const dash = normalizeKpiList(kpis.dashboard, def.kpis.dashboard);
  const dateRanges = normalizeDateRangeList(obj.dateRanges, def.dateRanges);
  return {
    v: 1,
    options: {
      condensed: {
        showDelta: normalizeBool(condensed.showDelta, def.options.condensed.showDelta),
        showProgress: normalizeBool(condensed.showProgress, def.options.condensed.showProgress),
        showSparkline: normalizeBool(condensed.showSparkline, def.options.condensed.showSparkline),
      },
      dashboard: {
        showDelta: normalizeBool(dashboard.showDelta, def.options.dashboard.showDelta),
      },
    },
    headerStrip: {
      pages: headerStripPages,
    },
    kpis: {
      header,
      dashboard: dash,
    },
    dateRanges,
  };
}

function normalizePixelSessionMode(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  if (s === 'shared_ttl' || s === 'shared' || s === 'sharedttl') return 'shared_ttl';
  return 'legacy';
}

function normalizeSettingsScopeMode(v) {
  const s = v == null ? '' : String(v).trim().toLowerCase();
  // We intentionally lock scope to shared/global until user-selected settings are implemented.
  if (s === 'global' || s === 'shared') return 'global';
  return 'global';
}

async function readSettingsPayload() {
  let pixelSessionMode = 'legacy';
  let assetOverrides = {};
  let kpiUiConfig = defaultKpiUiConfigV1();
  let chartsUiConfig = defaultChartsUiConfigV1();
  let tablesUiConfig = defaultTablesUiConfigV1();
  let profitRules = defaultProfitRulesConfigV1();
  let insightsVariantsConfig = defaultVariantsConfigV1();
  let settingsScopeMode = 'global';
  try {
    pixelSessionMode = normalizePixelSessionMode(await store.getSetting(PIXEL_SESSION_MODE_KEY));
  } catch (_) {}
  try {
    const rawScope = await store.getSetting(SETTINGS_SCOPE_MODE_KEY);
    const normalizedScope = normalizeSettingsScopeMode(rawScope);
    settingsScopeMode = normalizedScope;
    // Persist the default once so the DB reflects the current project policy.
    const rawNorm = rawScope == null ? '' : String(rawScope).trim().toLowerCase();
    if (!rawNorm || rawNorm !== normalizedScope) {
      await store.setSetting(SETTINGS_SCOPE_MODE_KEY, normalizedScope);
    }
  } catch (_) {}
  try {
    const raw = await store.getSetting(ASSET_OVERRIDES_KEY);
    const parsed = safeJsonParseObject(raw);
    if (parsed) assetOverrides = parsed;
  } catch (_) {}
  try {
    const raw = await store.getSetting(KPI_UI_CONFIG_V1_KEY);
    kpiUiConfig = normalizeKpiUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = await store.getSetting(CHARTS_UI_CONFIG_V1_KEY);
    chartsUiConfig = normalizeChartsUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = await store.getSetting(TABLES_UI_CONFIG_V1_KEY);
    tablesUiConfig = normalizeTablesUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = await store.getSetting(PROFIT_RULES_V1_KEY);
    profitRules = normalizeProfitRulesConfigV1(raw);
  } catch (_) {}
  try {
    const raw = await store.getSetting(VARIANTS_CONFIG_KEY);
    insightsVariantsConfig = normalizeVariantsConfigV1(raw);
  } catch (_) {}
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  return {
    ok: true,
    settingsScopeMode,
    pixelSessionMode,
    sharedSessionTtlMinutes: 30,
    assetOverrides,
    reporting,
    kpiUiConfig,
    chartsUiConfig,
    tablesUiConfig,
    profitRules,
    insightsVariantsConfig,
  };
}

async function getSettings(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await readSettingsPayload());
}

async function postSettings(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).set('Allow', 'POST').end();
  }
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  let insightsVariantsWarnings = null;

  // Settings scope (global/shared only for now)
  if (Object.prototype.hasOwnProperty.call(body, 'settingsScopeMode')) {
    try {
      const normalized = normalizeSettingsScopeMode(body.settingsScopeMode);
      await store.setSetting(SETTINGS_SCOPE_MODE_KEY, normalized);
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save setting scope' });
    }
  }

  // Pixel session mode
  try {
    const hasPixelModeField =
      Object.prototype.hasOwnProperty.call(body, 'pixelSessionMode') ||
      Object.prototype.hasOwnProperty.call(body, 'sharedSessionFixEnabled');
    if (hasPixelModeField) {
      let nextMode = body.pixelSessionMode;
      if (typeof nextMode === 'boolean') nextMode = nextMode ? 'shared_ttl' : 'legacy';
      if (typeof body.sharedSessionFixEnabled === 'boolean') nextMode = body.sharedSessionFixEnabled ? 'shared_ttl' : 'legacy';
      const normalized = normalizePixelSessionMode(nextMode);
      await store.setSetting(PIXEL_SESSION_MODE_KEY, normalized);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save setting' });
  }

  // Reporting config (orders source, sessions source)
  if (body.reporting && typeof body.reporting === 'object') {
    const ord = body.reporting.ordersSource;
    const sess = body.reporting.sessionsSource;
    try {
      if (ord === 'orders_shopify') await store.setSetting('reporting_orders_source', 'orders_shopify');
      if (sess === 'sessions' || sess === 'shopify_sessions') await store.setSetting('reporting_sessions_source', sess);
    } catch (_) {}
  }

  // Asset overrides (merge with existing)
  if (body.assetOverrides && typeof body.assetOverrides === 'object') {
    try {
      let existing = {};
      const raw = await store.getSetting(ASSET_OVERRIDES_KEY);
      if (raw && typeof raw === 'string') {
        try { existing = JSON.parse(raw) || {}; } catch (_) {}
      }
      const merged = { ...existing, ...body.assetOverrides };
      await store.setSetting(ASSET_OVERRIDES_KEY, JSON.stringify(merged));
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save asset overrides' });
    }
  }

  // KPI + date range UI config (v1)
  if (Object.prototype.hasOwnProperty.call(body, 'kpiUiConfig')) {
    try {
      if (body.kpiUiConfig == null) {
        await store.setSetting(KPI_UI_CONFIG_V1_KEY, '');
      } else {
        const normalized = normalizeKpiUiConfigV1(body.kpiUiConfig);
        const json = JSON.stringify(normalized);
        if (json.length > 50000) throw new Error('KPI UI config too large');
        await store.setSetting(KPI_UI_CONFIG_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save KPI UI config' });
    }
  }

  // Charts UI config (v1)
  if (Object.prototype.hasOwnProperty.call(body, 'chartsUiConfig')) {
    try {
      if (body.chartsUiConfig == null) {
        await store.setSetting(CHARTS_UI_CONFIG_V1_KEY, '');
      } else {
        const normalized = normalizeChartsUiConfigV1(body.chartsUiConfig);
        const json = JSON.stringify(normalized);
        if (json.length > 80000) throw new Error('Charts UI config too large');
        await store.setSetting(CHARTS_UI_CONFIG_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save charts config' });
    }
  }

  // Tables UI config (v1)
  if (Object.prototype.hasOwnProperty.call(body, 'tablesUiConfig')) {
    try {
      if (body.tablesUiConfig == null) {
        await store.setSetting(TABLES_UI_CONFIG_V1_KEY, '');
      } else {
        const normalized = normalizeTablesUiConfigV1(body.tablesUiConfig);
        const json = JSON.stringify(normalized);
        if (json.length > 120000) throw new Error('Tables UI config too large');
        await store.setSetting(TABLES_UI_CONFIG_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save tables config' });
    }
  }

  // Profit rules config (v1)
  if (Object.prototype.hasOwnProperty.call(body, 'profitRules')) {
    try {
      if (body.profitRules == null) {
        await store.setSetting(PROFIT_RULES_V1_KEY, '');
      } else {
        const normalized = normalizeProfitRulesConfigV1(body.profitRules);
        const json = JSON.stringify(normalized);
        if (json.length > 120000) throw new Error('Profit rules config too large');
        await store.setSetting(PROFIT_RULES_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save profit rules config' });
    }
  }

  // Fast-path ignore add from Insights -> Variants mapping modal.
  if (body.insightsVariantsIgnore && typeof body.insightsVariantsIgnore === 'object') {
    try {
      const tableId = String(body.insightsVariantsIgnore.tableId || '').trim().toLowerCase();
      const normalizedTitle = normalizeIgnoredTitle(body.insightsVariantsIgnore.variantTitle);
      if (!tableId || !normalizedTitle) {
        return res.status(400).json({
          ok: false,
          error: 'insights_variants_ignore_invalid',
          message: 'Both tableId and variantTitle are required to ignore a variant title.',
        });
      }

      const existingRaw = await store.getSetting(VARIANTS_CONFIG_KEY).catch(() => null);
      const existingCfg = normalizeVariantsConfigV1(existingRaw);
      const table = Array.isArray(existingCfg.tables)
        ? existingCfg.tables.find((t) => t && String(t.id || '').trim().toLowerCase() === tableId)
        : null;
      if (!table) {
        return res.status(404).json({
          ok: false,
          error: 'insights_variants_table_not_found',
          message: `Table "${tableId}" was not found in variants settings.`,
        });
      }

      const ignored = Array.isArray(table.ignored)
        ? table.ignored.map((entry) => normalizeIgnoredTitle(entry)).filter(Boolean)
        : [];
      if (!ignored.includes(normalizedTitle)) ignored.push(normalizedTitle);
      table.ignored = ignored;

      const normalizedCfg = normalizeVariantsConfigForSave(existingCfg);
      const json = JSON.stringify(normalizedCfg);
      if (json.length > 120000) throw new Error('Variants config too large');
      await store.setSetting(VARIANTS_CONFIG_KEY, json);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err && err.message ? String(err.message) : 'Failed to persist variants ignore rule',
      });
    }
  }

  // Variants insights config (v1)
  if (Object.prototype.hasOwnProperty.call(body, 'insightsVariantsConfig')) {
    try {
      const normalized = body.insightsVariantsConfig == null
        ? defaultVariantsConfigV1()
        : normalizeVariantsConfigForSave(body.insightsVariantsConfig);

      const structureValidation = validateConfigStructure(normalized);
      if (!structureValidation.ok) {
        return res.status(400).json({
          ok: false,
          error: 'insights_variants_config_invalid',
          message: 'Variants settings are invalid. Fix the listed issues and try again.',
          details: {
            stage: 'structure',
            errors: structureValidation.errors || [],
          },
        });
      }

      const shop = salesTruth.resolveShopForSales('');
      if (shop && shop.endsWith('.myshopify.com')) {
        const now = Date.now();
        const lookbackMs = 365 * 24 * 60 * 60 * 1000;
        const observed = await getObservedVariantsForValidation({
          shop,
          start: now - lookbackMs,
          end: now,
          maxRows: 5000,
        });
        const coverageValidation = validateConfigAgainstVariants(normalized, observed, { maxExamples: 40 });
        if (!coverageValidation.ok) {
          insightsVariantsWarnings = {
            stage: 'coverage',
            observedCount: Array.isArray(observed) ? observed.length : 0,
            tables: coverageValidation.tables || [],
          };
        }
      }

      const json = JSON.stringify(normalized);
      if (json.length > 120000) throw new Error('Variants config too large');
      await store.setSetting(VARIANTS_CONFIG_KEY, json);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: err && err.message ? String(err.message) : 'Failed to save variants config',
      });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  const payload = await readSettingsPayload();
  if (insightsVariantsWarnings) payload.insightsVariantsWarnings = insightsVariantsWarnings;
  res.json(payload);
}

async function getProfitRules(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  let profitRules = defaultProfitRulesConfigV1();
  try {
    const raw = await store.getSetting(PROFIT_RULES_V1_KEY);
    profitRules = normalizeProfitRulesConfigV1(raw);
  } catch (_) {}
  res.json({ ok: true, profitRules });
}

async function putProfitRules(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).set('Allow', 'PUT').end();
  }
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  const payload = Object.prototype.hasOwnProperty.call(body, 'profitRules') ? body.profitRules : body;
  try {
    const normalized = normalizeProfitRulesConfigV1(payload);
    const json = JSON.stringify(normalized);
    if (json.length > 120000) throw new Error('Profit rules config too large');
    await store.setSetting(PROFIT_RULES_V1_KEY, json);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ ok: true, profitRules: normalized });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? String(err.message) : 'Failed to save profit rules config',
    });
  }
}

// ── Theme defaults (shared across all logins) ──────────────────────────────
// Must match the keys used by `server/public/theme-settings.js` (hyphens converted to underscores).
const THEME_KEYS = [
  'theme',
  'theme_accent_1',
  'theme_accent_2',
  'theme_accent_3',
  'theme_accent_4',
  'theme_accent_5',
  'theme_radius',
  'theme_font',
  'theme_base',
  'theme_preference_mode',
  'theme_header_top_bg',
  'theme_header_top_text_color',
  'theme_header_main_bg',
  'theme_header_link_color',
  'theme_header_main_link_color',
  'theme_header_main_dropdown_bg',
  'theme_header_main_dropdown_link_color',
  'theme_header_main_dropdown_icon_color',
  'theme_header_main_border',
  'theme_header_main_border_color',
  'theme_header_main_shadow',
  'theme_header_settings_label',
  'theme_header_settings_bg',
  'theme_header_settings_text_color',
  'theme_header_settings_radius',
  'theme_header_settings_border',
  'theme_header_settings_border_color',
  'theme_header_online_bg',
  'theme_header_online_text_color',
  'theme_header_online_radius',
  'theme_header_online_border',
  'theme_header_online_border_color',
  'theme_header_logo_url',
  'theme_strip_opacity_filter',
  'theme_menu_opacity_filter',
  'theme_menu_hover_opacity',
  'theme_menu_hover_color',
  'theme_header_strip_border',
  'theme_header_strip_padding',
  'theme_custom_css',
  'theme_icon_default',
  'theme_icon_topnav',
  'theme_icon_dropdown',
  'theme_icon_settings_menu',
  'theme_icon_table_heading',
  'theme_icon_size',
  'theme_icon_color',
  'theme_icon_glyph_mobile_menu',
  'theme_icon_glyph_mobile_date',
  'theme_icon_glyph_topnav_date_chevron',
  'theme_icon_glyph_nav_toggle_dashboard',
  'theme_icon_glyph_nav_toggle_breakdown',
  'theme_icon_glyph_nav_toggle_traffic',
  'theme_icon_glyph_nav_toggle_integrations',
  'theme_icon_glyph_nav_toggle_tools',
  'theme_icon_glyph_nav_toggle_settings',
  'theme_icon_glyph_header_business_snapshot',
  'theme_icon_glyph_nav_item_overview',
  'theme_icon_glyph_nav_item_live',
  'theme_icon_glyph_nav_item_sales',
  'theme_icon_glyph_nav_item_table',
  'theme_icon_glyph_nav_item_countries',
  'theme_icon_glyph_nav_item_products',
  'theme_icon_glyph_nav_item_variants',
  'theme_icon_glyph_nav_item_channels',
  'theme_icon_glyph_nav_item_type',
  'theme_icon_glyph_nav_item_ads',
  'theme_icon_glyph_nav_item_tools',
  'theme_icon_glyph_nav_item_settings',
  'theme_icon_glyph_nav_item_refresh',
  'theme_icon_glyph_nav_item_sound_on',
  'theme_icon_glyph_nav_item_sound_off',
  'theme_icon_glyph_nav_item_theme',
  'theme_icon_glyph_nav_item_signout',
  'theme_icon_glyph_table_icon_cr',
  'theme_icon_glyph_table_icon_orders',
  'theme_icon_glyph_table_icon_sessions',
  'theme_icon_glyph_table_icon_revenue',
  'theme_icon_glyph_table_icon_clicks',
  'theme_icon_glyph_table_icon_variants_variant',
  'theme_icon_glyph_table_icon_variants_sessions',
  'theme_icon_glyph_table_icon_variants_orders',
  'theme_icon_glyph_table_icon_variants_cr',
  'theme_icon_glyph_table_icon_variants_revenue',
  'theme_icon_glyph_settings_tab_general',
  'theme_icon_glyph_settings_tab_theme',
  'theme_icon_glyph_settings_tab_assets',
  'theme_icon_glyph_settings_tab_data_reporting',
  'theme_icon_glyph_settings_tab_integrations',
  'theme_icon_glyph_settings_tab_sources',
  'theme_icon_glyph_settings_tab_kpis',
  'theme_icon_glyph_settings_tab_insights',
  'theme_icon_glyph_settings_tab_diagnostics',
  'theme_icon_glyph_settings_diagnostics_refresh',
  'theme_icon_glyph_settings_diagnostics_reconcile',
  'theme_icon_glyph_footer_refresh',
  'theme_icon_glyph_footer_sound',
  'theme_icon_glyph_footer_theme',
  'theme_icon_glyph_footer_settings',
  'theme_icon_glyph_footer_signout',
  'theme_icon_glyph_footer_last_sale_show',
  'theme_icon_glyph_footer_last_sale_hide',
  'theme_icon_glyph_side_panel_close',
  'theme_icon_glyph_side_panel_activity',
  'theme_icon_glyph_side_panel_details',
  'theme_icon_glyph_side_panel_source',
  'theme_icon_glyph_side_panel_network',
  'theme_icon_glyph_kpi_compare_refresh',
  'theme_icon_glyph_kpi_compare_close',
  'theme_icon_glyph_kpi_compare_date_info',
  'theme_icon_glyph_sale_toast_time',
  'theme_icon_glyph_live_landing_entry',
  'theme_icon_glyph_live_landing_exit',
  'theme_icon_glyph_live_bought_overlay',
  'theme_icon_glyph_dash_kpi_delta_up',
  'theme_icon_glyph_dash_kpi_delta_down',
  'theme_icon_glyph_dash_kpi_delta_flat',
  'theme_icon_glyph_pagination_prev',
  'theme_icon_glyph_pagination_next',
  'theme_icon_glyph_breakdown_placeholder_image',
  'theme_icon_glyph_breakdown_icon_image',
  'theme_icon_glyph_breakdown_icon_star',
  'theme_icon_glyph_breakdown_icon_chart_column',
  'theme_icon_glyph_breakdown_icon_link',
  'theme_icon_glyph_type_device_desktop',
  'theme_icon_glyph_type_device_mobile',
  'theme_icon_glyph_type_device_tablet',
  'theme_icon_glyph_type_device_unknown',
  'theme_icon_glyph_type_platform_ios',
  'theme_icon_glyph_type_platform_android',
  'theme_icon_glyph_type_platform_windows',
  'theme_icon_glyph_type_platform_linux',
  'theme_icon_glyph_type_platform_unknown',
  'theme_icon_glyph_diag_copy',
  'theme_icon_glyph_diag_tab_sales',
  'theme_icon_glyph_diag_tab_compare',
  'theme_icon_glyph_diag_tab_traffic',
  'theme_icon_glyph_diag_tab_pixel',
  'theme_icon_glyph_diag_tab_googleads',
  'theme_icon_glyph_diag_tab_shopify',
  'theme_icon_glyph_diag_tab_system',
  'theme_icon_glyph_diag_tab_definitions',
  'theme_icon_glyph_ads_status_warning',
  'theme_icon_glyph_ads_status_connected',
  'theme_icon_glyph_ads_status_disconnected',
  'theme_icon_glyph_ads_actions_refresh',
  'theme_icon_glyph_card_collapse_expanded',
  'theme_icon_glyph_card_collapse_collapsed',
  'theme_icon_glyph_chart_type_area',
  'theme_icon_glyph_chart_type_bar',
  'theme_icon_glyph_chart_type_line',
  'theme_icon_glyph_table_short_geo',
  'theme_icon_glyph_table_short_country_product',
  'theme_icon_glyph_table_short_source',
  'theme_icon_glyph_table_short_landing',
  'theme_icon_glyph_table_short_device',
  'theme_icon_glyph_table_short_cart',
  'theme_icon_glyph_table_short_arrived',
  'theme_icon_glyph_table_short_seen',
  'theme_icon_glyph_table_short_history',
  'theme_icon_glyph_table_short_type',
  'theme_icon_glyph_table_short_product',
  'theme_icon_glyph_table_short_consent',
  'theme_icon_glyph_card_title_online',
  'theme_icon_glyph_card_title_revenue',
  'theme_icon_glyph_card_title_orders',
  'theme_icon_glyph_card_title_conversion',
  'theme_icon_glyph_card_title_sessions',
  'theme_icon_glyph_card_title_countries',
  'theme_icon_glyph_card_title_products',
  'theme_icon_glyph_card_title_channels',
  'theme_icon_glyph_card_title_type',
  'theme_icon_glyph_card_title_ads',
  'theme_icon_glyph_card_title_tools',
  'theme_icon_glyph_card_title_settings',
  'theme_icon_glyph_card_title_date',
  'theme_icon_glyph_card_title_dashboard',
  'theme_icon_glyph_card_title_traffic',
  'theme_icon_glyph_card_title_trending_up',
  'theme_icon_glyph_card_title_trending_down',
  'theme_icon_glyph_card_title_chart',
  'theme_icon_glyph_online_status_indicator',
];

async function getThemeDefaults(req, res) {
  const result = { ok: true };
  for (const key of THEME_KEYS) {
    try { result[key] = (await store.getSetting('theme_' + key)) || ''; } catch (_) { result[key] = ''; }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
}

async function postThemeDefaults(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  try {
    // Patch semantics: only update provided keys (prevents large payload requirements
    // and avoids wiping other keys when partial payloads are sent).
    for (const key of Object.keys(body)) {
      if (!THEME_KEYS.includes(key)) continue;
      const val = body[key] != null ? String(body[key]).trim() : '';
      await store.setSetting('theme_' + key, val);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save theme' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
}

function normalizeCssColor(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return fallback;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw)) return raw;
  if (/^(rgb|hsl)a?\(/i.test(raw)) return raw;
  if (raw.toLowerCase() === 'currentcolor') return 'currentColor';
  if (/^[a-z-]+$/i.test(raw)) return raw;
  return fallback;
}

function normalizeCssRadius(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return fallback;
  if (raw === '0') return '0';
  if (/^\d+(\.\d+)?(px|rem|em|%)$/.test(raw)) return raw;
  if (/^\d+(\.\d+)?$/.test(raw)) return raw + 'px';
  return fallback;
}

function normalizeCssShadow(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === 'none') return 'none';
  if (raw.length > 120) return fallback;
  if (/[;\r\n{}]/.test(raw)) return fallback;
  return raw;
}

function normalizeCssToggle(value, fallback) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (raw === 'hide' || raw === 'off' || raw === 'false' || raw === '0') return 'hide';
  if (raw === 'show' || raw === 'on' || raw === 'true' || raw === '1') return 'show';
  return fallback === 'hide' ? 'hide' : 'show';
}

async function getThemeVarsCss(req, res) {
  const FALLBACKS = {
    theme_accent_1: '#4b94e4',
    theme_header_top_text_color: '#1f2937',
    theme_header_main_link_color: '#1f2937',
    theme_header_main_dropdown_link_color: '#1f2937',
    theme_header_main_dropdown_icon_color: '#1f2937',
    theme_header_main_border: 'show',
    theme_header_main_border_color: '#e6e7e9',
    theme_header_main_shadow: '2px 2px 2px #eee',
    theme_header_settings_label: 'show',
    theme_header_settings_text_color: '#1f2937',
    theme_header_settings_radius: '.375rem',
    theme_header_settings_border: 'show',
    theme_header_settings_border_color: '#e6e7e9',
    theme_header_online_text_color: '#1f2937',
    theme_header_online_radius: '.375rem',
    theme_header_online_border: 'show',
    theme_header_online_border_color: '#e6e7e9',
    theme_strip_opacity_filter: '0',
    theme_menu_opacity_filter: '0',
    theme_menu_hover_opacity: '8',
    theme_menu_hover_color: 'black',
    theme_header_strip_border: 'show',
    theme_header_strip_padding: '0 5px',
  };

  function getThemeKey(key, fallback) {
    return store.getSetting('theme_' + key).then((v) => {
      const raw = v == null ? '' : String(v).trim();
      return raw ? raw : fallback;
    }).catch(() => fallback);
  }

  const legacyPrimary = await getThemeKey('theme_primary', '');
  const accent1Raw = await getThemeKey('theme_accent_1', FALLBACKS.theme_accent_1);
  const accent1 = accent1Raw && /^#?[0-9a-f]{6}$/i.test(accent1Raw.trim())
    ? (accent1Raw.trim().charAt(0) === '#' ? accent1Raw.trim() : '#' + accent1Raw.trim())
    : (legacyPrimary && { blue: '#4b94e4', teal: '#3eb3ab', orange: '#f59e34', green: '#3eb3ab' }[legacyPrimary.trim().toLowerCase()]) || FALLBACKS.theme_accent_1;

  const [
    _skip,
    topText,
    mainLink,
    ddLink,
    ddIcon,
    mainBorderMode,
    mainBorderColor,
    mainShadow,
    settingsLabelMode,
    settingsText,
    settingsRadius,
    settingsBorderMode,
    settingsBorderColor,
    menuHoverOpacity,
    menuHoverColor,
    onlineText,
    onlineRadius,
    onlineBorderMode,
    onlineBorderColor,
    stripOpacity,
    menuOpacity,
    stripBorderMode,
    stripPadding,
  ] = await Promise.all([
    Promise.resolve(accent1),
    getThemeKey('theme_header_top_text_color', FALLBACKS.theme_header_top_text_color),
    getThemeKey('theme_header_main_link_color', FALLBACKS.theme_header_main_link_color),
    getThemeKey('theme_header_main_dropdown_link_color', FALLBACKS.theme_header_main_dropdown_link_color),
    getThemeKey('theme_header_main_dropdown_icon_color', FALLBACKS.theme_header_main_dropdown_icon_color),
    getThemeKey('theme_header_main_border', FALLBACKS.theme_header_main_border),
    getThemeKey('theme_header_main_border_color', FALLBACKS.theme_header_main_border_color),
    getThemeKey('theme_header_main_shadow', FALLBACKS.theme_header_main_shadow),
    getThemeKey('theme_header_settings_label', FALLBACKS.theme_header_settings_label),
    getThemeKey('theme_header_settings_text_color', FALLBACKS.theme_header_settings_text_color),
    getThemeKey('theme_header_settings_radius', FALLBACKS.theme_header_settings_radius),
    getThemeKey('theme_header_settings_border', FALLBACKS.theme_header_settings_border),
    getThemeKey('theme_header_settings_border_color', FALLBACKS.theme_header_settings_border_color),
    getThemeKey('theme_menu_hover_opacity', FALLBACKS.theme_menu_hover_opacity),
    getThemeKey('theme_menu_hover_color', FALLBACKS.theme_menu_hover_color),
    getThemeKey('theme_header_online_text_color', FALLBACKS.theme_header_online_text_color),
    getThemeKey('theme_header_online_radius', FALLBACKS.theme_header_online_radius),
    getThemeKey('theme_header_online_border', FALLBACKS.theme_header_online_border),
    getThemeKey('theme_header_online_border_color', FALLBACKS.theme_header_online_border_color),
    getThemeKey('theme_strip_opacity_filter', FALLBACKS.theme_strip_opacity_filter),
    getThemeKey('theme_menu_opacity_filter', FALLBACKS.theme_menu_opacity_filter),
    getThemeKey('theme_header_strip_border', FALLBACKS.theme_header_strip_border),
    getThemeKey('theme_header_strip_padding', FALLBACKS.theme_header_strip_padding),
  ]);

  const accent1Hex = normalizeCssColor(accent1, FALLBACKS.theme_accent_1);
  void _skip;
  const mainBorder = normalizeCssToggle(mainBorderMode, 'show');
  const settingsBorder = normalizeCssToggle(settingsBorderMode, 'show');
  const onlineBorder = normalizeCssToggle(onlineBorderMode, 'show');
  const stripBorder = normalizeCssToggle(stripBorderMode, 'show');
  const labelMode = normalizeCssToggle(settingsLabelMode, 'show');

  const stripOpacityVal = Math.min(100, Math.max(0, parseFloat(stripOpacity) || 0)) / 100;
  const menuOpacityVal = Math.min(100, Math.max(0, parseFloat(menuOpacity) || 0)) / 100;

  const [a2, a3, a4, a5] = await Promise.all([
    getThemeKey('theme_accent_2', '#3eb3ab'),
    getThemeKey('theme_accent_3', '#f59e34'),
    getThemeKey('theme_accent_4', '#8b5cf6'),
    getThemeKey('theme_accent_5', '#ef4444'),
  ]);

  const css = [
    '/* KEXO: server-injected theme variables (header + top menu) */',
    ':root{',
    `--kexo-accent-1:${accent1Hex};`,
    `--kexo-accent-2:${normalizeCssColor(a2, '#3eb3ab')};`,
    `--kexo-accent-3:${normalizeCssColor(a3, '#f59e34')};`,
    `--kexo-accent-4:${normalizeCssColor(a4, '#8b5cf6')};`,
    `--kexo-accent-5:${normalizeCssColor(a5, '#ef4444')};`,
    `--kexo-strip-opacity-filter:${stripOpacityVal.toFixed(2)};`,
    `--kexo-menu-opacity-filter:${menuOpacityVal.toFixed(2)};`,
    `--kexo-header-strip-border-width:${stripBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-header-strip-padding:${stripPadding && stripPadding.length < 80 ? stripPadding : '0 5px'};`,
    `--kexo-header-top-bg:${accent1Hex};`,
    `--kexo-header-top-text-color:${normalizeCssColor(topText, FALLBACKS.theme_header_top_text_color)};`,
    `--kexo-header-main-bg:${accent1Hex};`,
    `--kexo-top-menu-bg:${accent1Hex};`,
    `--kexo-top-menu-link-color:${normalizeCssColor(mainLink, FALLBACKS.theme_header_main_link_color)};`,
    `--kexo-top-menu-dropdown-bg:${accent1Hex};`,
    `--kexo-top-menu-dropdown-link-color:${normalizeCssColor(ddLink, FALLBACKS.theme_header_main_dropdown_link_color)};`,
    `--kexo-top-menu-dropdown-icon-color:${normalizeCssColor(ddIcon, FALLBACKS.theme_header_main_dropdown_icon_color)};`,
    `--kexo-top-menu-border-width:${mainBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-top-menu-border-color:${accent1Hex};`,
    `--kexo-top-menu-shadow:${normalizeCssShadow(mainShadow, FALLBACKS.theme_header_main_shadow)};`,

    `--kexo-header-settings-bg:${accent1Hex};`,
    `--kexo-header-settings-text-color:${normalizeCssColor(settingsText, FALLBACKS.theme_header_settings_text_color)};`,
    `--kexo-header-settings-radius:${normalizeCssRadius(settingsRadius, FALLBACKS.theme_header_settings_radius)};`,
    `--kexo-header-settings-border-width:${settingsBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-header-settings-border-color:${accent1Hex};`,
    `--kexo-header-settings-label-display:${labelMode === 'hide' ? 'none' : 'inline'};`,
    `--kexo-header-settings-icon-gap:${labelMode === 'hide' ? '0' : '.35rem'};`,

    (() => {
      const hovOp = Math.min(100, Math.max(0, parseFloat(menuHoverOpacity) || 0)) / 100;
      const isWhite = String(menuHoverColor || '').trim().toLowerCase() === 'white';
      const r = isWhite ? 255 : 0;
      const g = isWhite ? 255 : 0;
      const b = isWhite ? 255 : 0;
      return `--kexo-menu-hover-bg:rgba(${r},${g},${b},${hovOp.toFixed(2)});`;
    })(),

    `--kexo-header-online-bg:${accent1Hex};`,
    `--kexo-header-online-text-color:${normalizeCssColor(onlineText, FALLBACKS.theme_header_online_text_color)};`,
    `--kexo-header-online-radius:${normalizeCssRadius(onlineRadius, FALLBACKS.theme_header_online_radius)};`,
    `--kexo-header-online-border-width:${onlineBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-header-online-border-color:${normalizeCssColor(onlineBorderColor, FALLBACKS.theme_header_online_border_color)};`,
    '}',
    '',
  ].join('\n');

  // Chart visibility (hide disabled chart cards before paint).
  let chartsCss = '';
  try {
    const raw = await store.getSetting(CHARTS_UI_CONFIG_V1_KEY);
    const cfg = normalizeChartsUiConfigV1(raw);
    const disabled = (cfg && cfg.v === 1 && Array.isArray(cfg.charts)) ? cfg.charts.filter((c) => c && c.enabled === false) : [];
    const rules = [];
    disabled.forEach((c) => {
      const key = c && c.key != null ? String(c.key).trim().toLowerCase() : '';
      if (!key) return;
      if (key === 'countries-map-chart') return; // Keep map card visible so runtime can show disabled/no-data/error state.
      // NOTE: HTML uses data-kexo-chart-key="<key>" on the wrapper we want to hide.
      rules.push(`[data-kexo-chart-key="${key}"]{display:none!important;}`);
    });

    // Dashboard overview: when one of a pair is disabled, expand the remaining chart to full width.
    function enabled(key) {
      const k = String(key || '').trim().toLowerCase();
      const it = (cfg && Array.isArray(cfg.charts)) ? cfg.charts.find((x) => x && String(x.key || '').trim().toLowerCase() === k) : null;
      return !(it && it.enabled === false);
    }
    function maybeFullWidth(a, b) {
      const aOn = enabled(a);
      const bOn = enabled(b);
      if (aOn && !bOn) {
        rules.push(`[data-kexo-chart-key="${String(a).trim().toLowerCase()}"]{flex:0 0 auto!important;width:100%!important;max-width:100%!important;}`);
      } else if (bOn && !aOn) {
        rules.push(`[data-kexo-chart-key="${String(b).trim().toLowerCase()}"]{flex:0 0 auto!important;width:100%!important;max-width:100%!important;}`);
      }
    }
    maybeFullWidth('dash-chart-revenue', 'dash-chart-orders');
    maybeFullWidth('dash-chart-conv', 'dash-chart-sessions');

    if (rules.length) {
      chartsCss = ['/* KEXO: server-injected chart visibility */', ...rules, ''].join('\n');
    }
  } catch (_) {}

  // Condensed KPI visibility (hide disabled chips before paint).
  let kpisCss = '';
  try {
    const raw = await store.getSetting(KPI_UI_CONFIG_V1_KEY);
    const cfg = normalizeKpiUiConfigV1(raw);
    const disabled = (cfg && cfg.v === 1 && cfg.kpis && Array.isArray(cfg.kpis.header))
      ? cfg.kpis.header.filter((k) => k && k.enabled === false)
      : [];
    const sparklineIdByKey = {
      orders: 'cond-kpi-orders-sparkline',
      revenue: 'cond-kpi-revenue-sparkline',
      conv: 'cond-kpi-conv-sparkline',
      roas: 'cond-kpi-roas-sparkline',
      sessions: 'cond-kpi-sessions-sparkline',
      returning: 'cond-kpi-returning-sparkline',
      aov: 'cond-kpi-aov-sparkline',
      cogs: 'cond-kpi-cogs-sparkline',
      bounce: 'cond-kpi-bounce-sparkline',
      fulfilled: 'cond-kpi-orders-fulfilled-sparkline',
      returns: 'cond-kpi-returns-sparkline',
      items: 'cond-kpi-items-sold-sparkline',
    };
    const dashboardValueIdByKey = {
      revenue: 'dash-kpi-revenue',
      orders: 'dash-kpi-orders',
      conv: 'dash-kpi-conv',
      aov: 'dash-kpi-aov',
      sessions: 'dash-kpi-sessions',
      bounce: 'dash-kpi-bounce',
      returning: 'dash-kpi-returning',
      roas: 'dash-kpi-roas',
      cogs: 'dash-kpi-cogs',
      fulfilled: 'dash-kpi-fulfilled',
      returns: 'dash-kpi-returns',
      items: 'dash-kpi-items',
    };
    const rules = [];
    disabled.forEach((k) => {
      const key = k && k.key != null ? String(k.key).trim().toLowerCase() : '';
      const sparklineId = sparklineIdByKey[key];
      if (!sparklineId) return;
      // Match the exact chip by an always-present child id.
      rules.push(`#kexo-condensed-kpis .kexo-kpi-chip:has(> #${sparklineId}){display:none!important;}`);
    });

    // Dashboard overview KPI cards: hide disabled cards before app.js reorders/relabels.
    const disabledDashboard = (cfg && cfg.v === 1 && cfg.kpis && Array.isArray(cfg.kpis.dashboard))
      ? cfg.kpis.dashboard.filter((k) => k && k.enabled === false)
      : [];
    disabledDashboard.forEach((k) => {
      const key = k && k.key != null ? String(k.key).trim().toLowerCase() : '';
      const valueId = dashboardValueIdByKey[key];
      if (!valueId) return;
      // Dashboard cards are direct children of #dash-kpi-grid and can be matched via their value id.
      rules.push(`#dash-kpi-grid > .col-sm-6:has(#${valueId}){display:none!important;}`);
    });

    if (rules.length) {
      kpisCss = ['/* KEXO: server-injected KPI visibility */', ...rules, ''].join('\n');
    }
  } catch (_) {}

  res.setHeader('Cache-Control', 'no-store');
  const extraCss = [chartsCss, kpisCss].filter(Boolean).join('\n');
  res.type('text/css').send(css + (extraCss ? ('\n' + extraCss) : ''));
}

module.exports = {
  getSettings,
  postSettings,
  getProfitRules,
  putProfitRules,
  normalizePixelSessionMode,
  PIXEL_SESSION_MODE_KEY,
  getThemeDefaults,
  postThemeDefaults,
  getThemeVarsCss,
};

