/**
 * GET/POST /api/settings
 *
 * Small authenticated settings surface for the dashboard (stored in DB settings table).
 * Currently used to toggle pixel session strategy for debugging session count drift.
 */
const store = require('../store');
const { getDb } = require('../db');
const salesTruth = require('../salesTruth');
const { isMasterRequest } = require('../authz');
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
const {
  GOOGLE_ADS_PROFIT_CONFIG_V1_KEY,
  defaultGoogleAdsProfitConfigV1,
  normalizeGoogleAdsProfitConfigV1,
} = require('../googleAdsProfitConfig');
const { getThemeIconGlyphSettingKeys } = require('../shared/icon-registry');
const { normalizeIconSpec } = require('../utils/svgNormalize');
const colorSchemeMap = require('../public/ui/color-scheme-map');

const GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY = 'google_ads_profit_deductions_v1';
const GOOGLE_ADS_ADD_TO_CART_VALUE_KEY = 'google_ads_add_to_cart_value';
const GOOGLE_ADS_POSTBACK_GOALS_KEY = 'google_ads_postback_goals';

function defaultGoogleAdsProfitDeductionsV1() {
  return {
    includeGoogleAdsSpend: false,
    includePaymentFees: false,
    includeShopifyTaxes: false,
    includeShopifyAppBills: false,
    includeShipping: false,
    includeRules: false,
  };
}

function normalizeGoogleAdsProfitDeductionsV1(raw) {
  const parsed = (() => {
    if (raw && typeof raw === 'object') return raw;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (_) {
      return null;
    }
  })();
  const out = defaultGoogleAdsProfitDeductionsV1();
  if (!parsed) return out;
  out.includeGoogleAdsSpend = parsed.includeGoogleAdsSpend === true;
  out.includePaymentFees = parsed.includePaymentFees === true;
  out.includeShopifyTaxes = parsed.includeShopifyTaxes === true;
  out.includeShopifyAppBills = parsed.includeShopifyAppBills === true;
  out.includeShipping = parsed.includeShipping === true;
  out.includeRules = parsed.includeRules === true;
  return out;
}

function defaultGoogleAdsPostbackGoals() {
  return { uploadRevenue: true, uploadProfit: false, uploadAddToCart: false };
}

function normalizeGoogleAdsPostbackGoals(raw) {
  const parsed = (() => {
    if (raw && typeof raw === 'object') return raw;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (_) {
      return null;
    }
  })();
  const out = defaultGoogleAdsPostbackGoals();
  if (!parsed) return out;
  out.uploadRevenue = parsed.uploadRevenue !== false;
  out.uploadProfit = parsed.uploadProfit === true;
  out.uploadAddToCart = parsed.uploadAddToCart === true;
  return out;
}

const PIXEL_SESSION_MODE_KEY = 'pixel_session_mode'; // legacy | shared_ttl
const ASSET_OVERRIDES_KEY = 'asset_overrides'; // JSON object
const KPI_UI_CONFIG_V1_KEY = 'kpi_ui_config_v1'; // JSON object (KPIs + date ranges + options)
const CHARTS_UI_CONFIG_V1_KEY = 'charts_ui_config_v1'; // JSON object (chart type/colors/visibility)
const TABLES_UI_CONFIG_V1_KEY = 'tables_ui_config_v1'; // JSON object (table rows + layout + sticky column sizing)
const SETTINGS_SCOPE_MODE_KEY = 'settings_scope_mode'; // global (shared) | user (disabled for now)
const PAGE_LOADER_ENABLED_V1_KEY = 'page_loader_enabled_v1'; // JSON object (per-page loader overlay enable)
const OVERVIEW_WIDGETS_UI_CONFIG_V1_KEY = 'overview_widgets_ui_config_v1'; // JSON object (Overview 6-widget grid UI prefs)
const CSS_VAR_OVERRIDES_V1_KEY = 'css_var_overrides_v1'; // JSON object (:root CSS var overrides)

const OVERVIEW_WIDGET_KEYS = ['finishes', 'devices', 'browsers', 'abandoned', 'attribution', 'payment_methods'];
const OVERVIEW_WIDGET_KEY_SET = new Set(OVERVIEW_WIDGET_KEYS);
const OVERVIEW_WIDGET_SORT_BY_SET = new Set(['revenue', 'clicks', 'ctr']);

const KPI_UI_KEYS = [
  'orders',
  'revenue',
  'profit',
  'conv',
  'vpv',
  'roas',
  'sessions',
  'returning',
  'aov',
  'cogs',
  'bounce',
  'fulfilled',
  'returns',
  'items',
  'kexo_score',
];
const KPI_UI_KEY_SET = new Set(KPI_UI_KEYS);
const DATE_RANGE_UI_KEYS = ['today', 'yesterday', '7days', '14days', '30days', 'custom'];
const DATE_RANGE_UI_KEY_SET = new Set(DATE_RANGE_UI_KEYS);
const HEADER_KPI_STRIP_PAGE_KEYS = [
  'dashboard',
  'live',
  'sales',
  'date',
  'snapshot',
  'countries',
  'products',
  'abandoned-carts',
  'variants',
  'channels',
  'type',
  'ads',
  'compare-conversion-rate',
  'shipping-cr',
  'click-order-lookup',
  'settings',
];
const HEADER_KPI_STRIP_PAGE_KEY_SET = new Set(HEADER_KPI_STRIP_PAGE_KEYS);

const CHART_UI_KEYS = [
  'dash-chart-overview-30d',
  'dash-chart-finishes-30d',
  'dash-chart-devices-30d',
  'dash-chart-countries-30d',
  'dash-chart-attribution-30d',
  'live-online-chart',
  'sales-overview-chart',
  'date-overview-chart',
  'ads-overview-chart',
  'attribution-chart',
  'devices-chart',
  'products-chart',
  'abandoned-carts-chart',
  'countries-map-chart',
  'payment-methods-chart',
];
const CHART_UI_KEY_SET = new Set(CHART_UI_KEYS);
const CHART_KPI_BUNDLE_KEYS = ['dashboardCards', 'headerStrip', 'yearlySnapshot'];
const CHART_KPI_BUNDLE_KEY_SET = new Set(CHART_KPI_BUNDLE_KEYS);

const CHART_ALLOWED_MODES = Object.freeze({
  'dash-chart-overview-30d': ['line', 'area', 'bar', 'stacked-bar'],
  'dash-chart-finishes-30d': ['radialbar', 'bar-horizontal'],
  'dash-chart-devices-30d': ['bar-horizontal', 'radialbar'],
  'dash-chart-countries-30d': ['bar-horizontal', 'bar', 'bar-distributed', 'radialbar', 'pie', 'donut', 'line', 'area', 'multi-line-labels'],
  'dash-chart-attribution-30d': ['radialbar', 'pie', 'donut'],
  'live-online-chart': ['map-animated'],
  'sales-overview-chart': ['area', 'line', 'bar', 'multi-line-labels'],
  'date-overview-chart': ['area', 'line', 'bar', 'multi-line-labels'],
  'ads-overview-chart': ['bar', 'combo', 'line', 'area', 'multi-line-labels'],
  'attribution-chart': ['line', 'area', 'bar', 'pie', 'multi-line-labels'],
  'devices-chart': ['line', 'area', 'bar', 'pie', 'multi-line-labels'],
  'products-chart': ['line', 'area', 'bar', 'pie', 'multi-line-labels'],
  'abandoned-carts-chart': ['line', 'area', 'bar', 'multi-line-labels'],
  'countries-map-chart': ['map-animated'],
  'payment-methods-chart': ['line', 'area', 'bar', 'multi-line-labels'],
});

// One-time migrations for chart defaults that should never override user choices after the first run.
const CHARTS_UI_DEFAULTS_VERSION = 3;

function defaultChartStyleConfig() {
  return {
    curve: 'smooth',
    strokeWidth: 2.6,
    dashArray: 0,
    markerSize: 3,
    fillOpacity: 0.18,
    gridDash: 3,
    dataLabels: 'auto',
    bucketMode: 'all',
    barColumnWidth: 60,
    barHeight: 60,
    radialThickness: 42,
    toolbar: false,
    animations: false,
    icons: false,
    showLabels: true,
    bottomLabels: true,
    radialCenterLabel: true,
    pieDonut: false,
    pieDonutSize: 66,
    pieLabelPosition: 'auto',
    pieLabelContent: 'percent',
    pieLabelOffset: 16,
    pieCountryFlags: false,
    mapShowTooltip: true,
    mapDraggable: true,
    mapZoomButtons: true,
    mapShowEmptyCaption: true,
    mapFit: 'cover',
    mapInactiveOpacity: 0.09,
    mapInactiveColor: '',
    mapStageBrowseColor: '',
    mapStageCartColor: '',
    mapStageCheckoutColor: '',
    mapStagePurchaseColor: '',
    mapMetric: 'auto',
  };
}

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
      general: {
        dateLabelFormat: 'dmy',
        returnsRefundsAttribution: 'processing_date',
      },
    },
    headerStrip: {
      pages: {
        dashboard: true,
        live: true,
        sales: true,
        date: true,
        snapshot: true,
        countries: true,
        products: true,
        'abandoned-carts': true,
        variants: true,
        attribution: true,
        devices: true,
        ads: true,
        'compare-conversion-rate': true,
        'shipping-cr': true,
        'click-order-lookup': true,
        settings: false,
      },
    },
    kpis: {
      header: [
        { key: 'orders', label: 'Orders', enabled: true },
        { key: 'revenue', label: 'Revenue', enabled: true },
        { key: 'profit', label: 'Profit', enabled: true },
        { key: 'conv', label: 'Conversion Rate', enabled: true },
        { key: 'vpv', label: 'Value per Visit', enabled: false },
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
        { key: 'profit', label: 'Profit', enabled: true },
        { key: 'orders', label: 'Orders', enabled: true },
        { key: 'conv', label: 'Conversion Rate', enabled: true },
        { key: 'vpv', label: 'Value per Visit', enabled: false },
        { key: 'aov', label: 'Average Order Value', enabled: true },
        { key: 'sessions', label: 'Sessions', enabled: true },
        { key: 'bounce', label: 'Bounce Rate', enabled: true },
        { key: 'returning', label: 'Returning', enabled: true },
        { key: 'roas', label: 'ADS ROAS', enabled: true },
        { key: 'kexo_score', label: 'Kexo Score', enabled: true },
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
  const withStyle = (item, styleOverride) => ({
    ...item,
    sizePercent: Number.isFinite(Number(item && item.sizePercent)) ? Math.round(Number(item.sizePercent)) : 100,
    style: { ...defaultChartStyleConfig(), ...(styleOverride && typeof styleOverride === 'object' ? styleOverride : {}) },
  });
  return {
    v: 1,
    defaultsVersion: CHARTS_UI_DEFAULTS_VERSION,
    hideOnMobile: false,
    // Guardrail: charts + KPI bundle UI defaults are user-owned via Settings and normalized below.
    // Keep these defaults/allowed lists aligned with kexo-chart-defs.js and settings-page.js.
    charts: [
      withStyle(
        { key: 'dash-chart-overview-30d', label: 'Dashboard · 7 Day Overview', enabled: true, mode: 'area', sizePercent: 80, colors: ['#3eb3ab', '#ef4444'], advancedApexOverride: {} },
        { animations: false, bucketMode: 'all', dataLabels: 'off', barColumnWidth: 60, strokeWidth: 2.6 }
      ),
      withStyle(
        { key: 'dash-chart-finishes-30d', label: 'Dashboard · Finishes (7 Days)', enabled: true, mode: 'radialbar', sizePercent: 100, colors: ['#f59e34', '#94a3b8', '#8b5cf6', '#4b94e4', '#3eb3ab'], advancedApexOverride: {} },
        { animations: false, radialThickness: 42, barHeight: 60 }
      ),
      withStyle(
        { key: 'dash-chart-devices-30d', label: 'Dashboard · Devices (7 Days)', enabled: true, mode: 'bar-horizontal', dimension: 'device', sizePercent: 80, colors: ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'], advancedApexOverride: {} },
        { animations: false, icons: true, showLabels: true, barHeight: 54, radialThickness: 42 }
      ),
      withStyle(
        { key: 'dash-chart-attribution-30d', label: 'Dashboard · Attribution (7 Days)', enabled: true, mode: 'donut', sizePercent: 70, colors: ['#4b94e4', '#3eb3ab', '#f59e34', '#8b5cf6', '#ef4444'], advancedApexOverride: {} },
        { animations: false, icons: true, bottomLabels: true, pieDonut: true, pieDonutSize: 64, pieLabelPosition: 'outside', pieLabelContent: 'label', pieLabelOffset: 18 }
      ),
      withStyle({ key: 'live-online-chart', label: 'Dashboard · Live Online', enabled: true, mode: 'map-animated', colors: ['#16a34a'], advancedApexOverride: {} }),
      withStyle({ key: 'sales-overview-chart', label: 'Dashboard · Sales Trend', enabled: true, mode: 'area', colors: ['#0d9488'], advancedApexOverride: {} }),
      withStyle({ key: 'date-overview-chart', label: 'Dashboard · Sessions & Orders Trend', enabled: true, mode: 'area', colors: ['#4b94e4', '#f59e34'], advancedApexOverride: {} }),
      withStyle({ key: 'ads-overview-chart', label: 'Integrations · Google Ads Overview', enabled: true, mode: 'bar', colors: ['#3eb3ab', '#ef4444', '#4b94e4'], advancedApexOverride: {} }),
      withStyle({ key: 'attribution-chart', label: 'Acquisition · Attribution', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions', advancedApexOverride: {} }),
      withStyle({ key: 'devices-chart', label: 'Acquisition · Devices', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions', advancedApexOverride: {} }),
      withStyle({ key: 'products-chart', label: 'Insights · Products', enabled: true, mode: 'line', colors: ['#3eb3ab', '#4b94e4', '#f59e34', '#8b5cf6', '#ef4444', '#22c55e'], advancedApexOverride: {} }),
      withStyle({ key: 'abandoned-carts-chart', label: 'Insights · Abandoned Carts', enabled: true, mode: 'line', colors: ['#ef4444'], advancedApexOverride: {} }),
      withStyle({ key: 'countries-map-chart', label: 'Insights · Countries Map', enabled: true, mode: 'map-animated', colors: ['#3eb3ab'], advancedApexOverride: {} }),
    ],
    kpiBundles: {
      dashboardCards: {
        sparkline: { mode: 'line', curve: 'straight', strokeWidth: 2.55, height: 50, showCompare: true, compareUsePrimaryColor: false, compareOpacity: 50, advancedApexOverride: {} },
        deltaStyle: { fontSize: 14, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' },
        palette: { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' },
      },
      headerStrip: {
        sparkline: { mode: 'line', curve: 'smooth', strokeWidth: 2.15, height: 30, showCompare: false, advancedApexOverride: {} },
        deltaStyle: { fontSize: 11, fontWeight: 500, iconSize: 10, fontColor: '', iconColor: '' },
        palette: { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' },
      },
      yearlySnapshot: {
        sparkline: { mode: 'line', curve: 'smooth', strokeWidth: 2.55, height: 56, showCompare: false, advancedApexOverride: {} },
        deltaStyle: { fontSize: 12, fontWeight: 500, iconSize: 12, fontColor: '', iconColor: '' },
        palette: { up: '#2fb344', down: '#d63939', same: '#66bdb7', compareLine: '#cccccc' },
      },
    },
  };
}

function defaultTablesUiConfigV1() {
  return {
    v: 1,
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
            rows: { default: 5, options: [5] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'dash-top-countries',
            name: 'Top Countries',
            tableClass: 'dashboard',
            zone: 'dashboard-top-countries',
            order: 2,
            inGrid: true,
            rows: { default: 5, options: [5] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'dash-trending-up',
            name: 'Trending Up',
            tableClass: 'dashboard',
            zone: 'dashboard-trending-up',
            order: 3,
            inGrid: true,
            rows: { default: 5, options: [5] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'dash-trending-down',
            name: 'Trending Down',
            tableClass: 'dashboard',
            zone: 'dashboard-trending-down',
            order: 4,
            inGrid: true,
            rows: { default: 5, options: [5] },
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
            rows: { default: 15, options: [15, 20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'best-geo-products-table',
            name: 'Country + Product',
            tableClass: 'live',
            zone: 'countries-products',
            order: 2,
            inGrid: true,
            rows: { default: 15, options: [15, 20, 30, 40, 50] },
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
        key: 'variants',
        label: 'Insights · Variants',
        tables: [
          {
            id: 'insights-variants-tables',
            name: 'Variant tables',
            tableClass: 'product',
            zone: 'variants-insights',
            order: 1,
            inGrid: true,
            rows: { default: 5, options: [5, 10] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'abandoned-carts',
        label: 'Insights · Abandoned Carts',
        tables: [
          {
            id: 'abandoned-carts-countries-table',
            name: 'Countries',
            tableClass: 'live',
            zone: 'abandoned-carts-countries',
            order: 1,
            inGrid: true,
            rows: { default: 5, options: [5] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'abandoned-carts-country-products-table',
            name: 'Country + Product',
            tableClass: 'live',
            zone: 'abandoned-carts-country-products',
            order: 2,
            inGrid: true,
            rows: { default: 5, options: [5] },
            sticky: { minWidth: null, maxWidth: null },
          },
          {
            id: 'sessions-table',
            name: 'Sessions',
            tableClass: 'live',
            zone: 'abandoned-carts-sessions',
            order: 3,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'payment-types',
        label: 'Insights · Payment Methods',
        tables: [
          {
            id: 'payment-types-table',
            name: 'Payment Methods',
            tableClass: 'live',
            zone: 'payment-types-main',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'attribution',
        label: 'Acquisition · Attribution',
        tables: [
          {
            id: 'attribution-table',
            name: 'Attribution',
            tableClass: 'live',
            zone: 'attribution-main',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'devices',
        label: 'Acquisition · Devices',
        tables: [
          {
            id: 'devices-table',
            name: 'Devices',
            tableClass: 'live',
            zone: 'devices-main',
            order: 1,
            inGrid: false,
            rows: { default: 20, options: [20, 30, 40, 50] },
            sticky: { minWidth: null, maxWidth: null },
          },
        ],
      },
      {
        key: 'browsers',
        label: 'Acquisition · Browsers',
        tables: [
          {
            id: 'browsers-table',
            name: 'Browsers',
            tableClass: 'live',
            zone: 'browsers-main',
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

function normalizeDateLabelFormat(v, fallback) {
  const fb = String(fallback || '').trim().toLowerCase() === 'mdy' ? 'mdy' : 'dmy';
  const raw = String(v || '').trim().toLowerCase();
  return raw === 'mdy' ? 'mdy' : fb;
}

const RETURNS_REFUNDS_ATTRIBUTION_VALUES = Object.freeze(['processing_date', 'original_sale_date']);
function normalizeReturnsRefundsAttribution(v, fallback) {
  const fb = (fallback && RETURNS_REFUNDS_ATTRIBUTION_VALUES.includes(fallback)) ? fallback : 'processing_date';
  const raw = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return RETURNS_REFUNDS_ATTRIBUTION_VALUES.includes(raw) ? raw : fb;
}

// Legacy mode values that may have been saved before canonical naming; map to canonical mode.
const CHART_MODE_LEGACY_ALIASES = Object.freeze({
  'bar (horizontal)': 'bar-horizontal',
  'horizontal bar': 'bar-horizontal',
  'bar horizontal': 'bar-horizontal',
  'vertical bar': 'bar',
  'radial bar': 'radialbar',
  'multi line': 'multi-line-labels',
  'multi-line': 'multi-line-labels',
  'stacked area': 'stacked-area',
  'stacked bar': 'stacked-bar',
});

function normalizeChartModeForKey(key, value, fallback) {
  const k = String(key || '').trim().toLowerCase();
  let raw = value == null ? '' : String(value).trim().toLowerCase();
  raw = CHART_MODE_LEGACY_ALIASES[raw] || raw;
  const allowed = CHART_ALLOWED_MODES[k] || null;
  if (allowed && allowed.includes(raw)) return raw;
  const fb = fallback == null ? '' : String(fallback).trim().toLowerCase();
  const fbNorm = CHART_MODE_LEGACY_ALIASES[fb] || fb;
  if (allowed && allowed.includes(fbNorm)) return fbNorm;
  // Extremely defensive: pick first allowed or a safe fallback.
  if (allowed && allowed.length) return allowed[0];
  return 'line';
}

function normalizeDashboardBreakdownDimension(value, fallback) {
  const fbRaw = fallback == null ? '' : String(fallback).trim().toLowerCase();
  const fb =
    fbRaw === 'browser' || fbRaw === 'payment_method'
      ? fbRaw
      : 'device';
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (!raw) return fb;
  if (raw === 'device' || raw === 'devices' || raw === 'platform' || raw === 'platforms') return 'device';
  if (raw === 'browser' || raw === 'browsers') return 'browser';
  if (
    raw === 'payment_method' ||
    raw === 'payment_methods' ||
    raw === 'payment-method' ||
    raw === 'payment-methods' ||
    raw === 'paymentmethod' ||
    raw === 'paymentmethods' ||
    raw === 'payment types' ||
    raw === 'payment type' ||
    raw === 'payment_types' ||
    raw === 'payment_type'
  ) return 'payment_method';
  return fb;
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
        // Guardrail: Dashboard Top Products, Countries, Trending Up/Down are always 5 rows, no pagination.
        if (id === 'dash-top-products' || id === 'dash-top-countries' || id === 'dash-trending-up' || id === 'dash-trending-down') {
          table.rows = { default: 5, options: [5] };
        }

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

function normalizeChartsList(rawList, defaults, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const migrateDashboardOverview = !!opts.migrateDashboardOverview;
  const migrateMapZoomButtons = !!opts.migrateMapZoomButtons;
  const byKey = {};
  for (const d of defaults) byKey[d.key] = d;
  const out = [];
  const seen = new Set();
  function migrateDashboardOverviewMode(key, mode) {
    // Migration: the dashboard overview mini charts used to default to `pie`.
    // New defaults: radialbar / bar-horizontal / donut, plus overview `area`.
    if (key === 'dash-chart-finishes-30d' && mode === 'pie') return 'radialbar';
    if (key === 'dash-chart-countries-30d' && mode === 'pie') return 'bar-horizontal';
    if (key === 'dash-chart-attribution-30d' && mode === 'pie') return 'donut';
    if (key === 'dash-chart-overview-30d' && mode === 'bar') return 'area';
    return mode;
  }
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const key = item.key != null ? String(item.key).trim().toLowerCase() : '';
      if (!CHART_UI_KEY_SET.has(key)) continue;
      if (seen.has(key)) continue;
      const def = byKey[key] || { key, label: key, enabled: true, mode: 'line', colors: [] };
      let mode = normalizeChartModeForKey(key, item.mode, def.mode);
      if (migrateDashboardOverview) mode = migrateDashboardOverviewMode(key, mode);
      const normalized = {
        key,
        label: normalizeText(item.label, def.label),
        enabled: normalizeBool(item.enabled, def.enabled),
        mode,
        sizePercent: normalizeSizePercent(item.sizePercent, def.sizePercent != null ? def.sizePercent : 100),
        colors: normalizeColorList(item.colors, def.colors),
        style: normalizeChartStyle(item.style, def.style || defaultChartStyleConfig()),
        advancedApexOverride: normalizeApexOverrideObject(item.advancedApexOverride, def.advancedApexOverride || {}),
      };
      if (migrateMapZoomButtons && (key === 'live-online-chart' || key === 'countries-map-chart')) {
        // Migration: zoom buttons should be visible by default for maps.
        normalized.style = { ...(normalized.style || {}), mapZoomButtons: true };
      }
      if (key === 'dash-chart-devices-30d') {
        normalized.dimension = normalizeDashboardBreakdownDimension(item.dimension, def.dimension || 'device');
      }
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

function normalizeHexColor(value, fallback) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : fallback;
}

function normalizeOptionalHexColor(value) {
  const raw = value == null ? '' : String(value).trim().toLowerCase();
  if (!raw) return '';
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : '';
}

function parseBoundedNumber(value, fallback, min, max) {
  let n = Number(value);
  if (!Number.isFinite(n)) n = Number(fallback);
  if (!Number.isFinite(n)) n = min;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function normalizeSizePercent(value, fallback) {
  let n = parseBoundedNumber(value, fallback != null ? fallback : 100, 25, 100);
  n = Math.round(n / 5) * 5;
  if (n < 25) n = 25;
  if (n > 100) n = 100;
  return n;
}

function sanitizeApexOverrideValue(value, depth) {
  if (depth > 6) return undefined;
  if (value == null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 80).map((it) => sanitizeApexOverrideValue(it, depth + 1)).filter((it) => it !== undefined);
  }
  if (t === 'object') {
    const out = {};
    const entries = Object.entries(value).slice(0, 80);
    for (const [k, v] of entries) {
      const key = k == null ? '' : String(k).trim();
      if (!key) continue;
      const cleaned = sanitizeApexOverrideValue(v, depth + 1);
      if (cleaned === undefined) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return undefined;
}

function normalizeApexOverrideObject(raw, fallback) {
  const fb = fallback && typeof fallback === 'object' && !Array.isArray(fallback) ? fallback : {};
  let obj = raw;
  if (typeof raw === 'string') {
    const txt = raw.trim();
    if (!txt) return fb;
    try {
      obj = JSON.parse(txt);
    } catch (_) {
      return fb;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fb;
  const cleaned = sanitizeApexOverrideValue(obj, 0);
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) return fb;
  return cleaned;
}

function normalizeChartStyle(raw, fallback) {
  const def = fallback && typeof fallback === 'object' ? fallback : defaultChartStyleConfig();
  const src = raw && typeof raw === 'object' ? raw : {};
  const curveRaw = String(src.curve != null ? src.curve : def.curve).trim().toLowerCase();
  const dataLabelsRaw = String(src.dataLabels != null ? src.dataLabels : def.dataLabels).trim().toLowerCase();
  const bucketModeRaw = String(src.bucketMode != null ? src.bucketMode : def.bucketMode).trim().toLowerCase();
  const pieLabelPositionRaw = String(src.pieLabelPosition != null ? src.pieLabelPosition : def.pieLabelPosition).trim().toLowerCase();
  const pieLabelContentRaw = String(src.pieLabelContent != null ? src.pieLabelContent : def.pieLabelContent).trim().toLowerCase();
  const mapFitRaw = String(src.mapFit != null ? src.mapFit : def.mapFit).trim().toLowerCase();
  const mapFit = (mapFitRaw === 'contain' || mapFitRaw === 'cover') ? mapFitRaw : String(def.mapFit || 'cover');
  return {
    curve: ['smooth', 'straight', 'stepline'].includes(curveRaw) ? curveRaw : String(def.curve || 'smooth'),
    strokeWidth: parseBoundedNumber(src.strokeWidth, def.strokeWidth != null ? def.strokeWidth : 2.6, 0, 8),
    dashArray: parseBoundedNumber(src.dashArray, def.dashArray != null ? def.dashArray : 0, 0, 20),
    markerSize: parseBoundedNumber(src.markerSize, def.markerSize != null ? def.markerSize : 3, 0, 12),
    fillOpacity: parseBoundedNumber(src.fillOpacity, def.fillOpacity != null ? def.fillOpacity : 0.18, 0, 1),
    gridDash: parseBoundedNumber(src.gridDash, def.gridDash != null ? def.gridDash : 3, 0, 16),
    dataLabels: ['auto', 'on', 'off'].includes(dataLabelsRaw) ? dataLabelsRaw : String(def.dataLabels || 'auto'),
    bucketMode: ['all', 'latest'].includes(bucketModeRaw) ? bucketModeRaw : String(def.bucketMode || 'all'),
    barColumnWidth: Math.round(parseBoundedNumber(src.barColumnWidth, def.barColumnWidth != null ? def.barColumnWidth : 60, 10, 100)),
    barHeight: Math.round(parseBoundedNumber(src.barHeight, def.barHeight != null ? def.barHeight : 60, 10, 100)),
    radialThickness: Math.round(parseBoundedNumber(src.radialThickness, def.radialThickness != null ? def.radialThickness : 42, 8, 90)),
    toolbar: normalizeBool(src.toolbar, def.toolbar === true),
    animations: normalizeBool(src.animations, def.animations !== false),
    icons: normalizeBool(src.icons, def.icons === true),
    showLabels: normalizeBool(src.showLabels, def.showLabels !== false),
    bottomLabels: normalizeBool(src.bottomLabels, def.bottomLabels !== false),
    radialCenterLabel: normalizeBool(src.radialCenterLabel, def.radialCenterLabel !== false),
    pieDonut: normalizeBool(src.pieDonut, def.pieDonut === true),
    pieDonutSize: Math.round(parseBoundedNumber(src.pieDonutSize, def.pieDonutSize != null ? def.pieDonutSize : 66, 30, 90)),
    pieLabelPosition: ['auto', 'inside', 'outside'].includes(pieLabelPositionRaw) ? pieLabelPositionRaw : String(def.pieLabelPosition || 'auto'),
    pieLabelContent: ['percent', 'label', 'label_percent'].includes(pieLabelContentRaw) ? pieLabelContentRaw : String(def.pieLabelContent || 'percent'),
    pieLabelOffset: Math.round(parseBoundedNumber(src.pieLabelOffset, def.pieLabelOffset != null ? def.pieLabelOffset : 16, -40, 40)),
    pieCountryFlags: normalizeBool(src.pieCountryFlags, def.pieCountryFlags === true),
    mapShowTooltip: normalizeBool(src.mapShowTooltip, def.mapShowTooltip !== false),
    mapDraggable: normalizeBool(src.mapDraggable, def.mapDraggable !== false),
    mapZoomButtons: normalizeBool(src.mapZoomButtons, def.mapZoomButtons === true),
    mapShowEmptyCaption: normalizeBool(src.mapShowEmptyCaption, def.mapShowEmptyCaption !== false),
    mapFit,
    mapInactiveOpacity: parseBoundedNumber(src.mapInactiveOpacity, def.mapInactiveOpacity != null ? def.mapInactiveOpacity : 0.09, 0, 1),
    mapInactiveColor: normalizeOptionalHexColor(src.mapInactiveColor || ''),
    mapStageBrowseColor: normalizeOptionalHexColor(src.mapStageBrowseColor || ''),
    mapStageCartColor: normalizeOptionalHexColor(src.mapStageCartColor || ''),
    mapStageCheckoutColor: normalizeOptionalHexColor(src.mapStageCheckoutColor || ''),
    mapStagePurchaseColor: normalizeOptionalHexColor(src.mapStagePurchaseColor || ''),
    mapMetric: ['auto', 'revenue', 'orders'].includes(String(src.mapMetric != null ? src.mapMetric : def.mapMetric).trim().toLowerCase())
      ? String(src.mapMetric != null ? src.mapMetric : def.mapMetric).trim().toLowerCase()
      : 'auto',
  };
}

function normalizeChartsKpiBundle(bundleKey, raw, fallback) {
  const def = fallback && typeof fallback === 'object' ? fallback : {};
  const src = raw && typeof raw === 'object' ? raw : {};
  const sparkDef = def.sparkline && typeof def.sparkline === 'object' ? def.sparkline : {};
  const deltaDef = def.deltaStyle && typeof def.deltaStyle === 'object' ? def.deltaStyle : {};
  const paletteDef = def.palette && typeof def.palette === 'object' ? def.palette : {};
  const sparkSrc = src.sparkline && typeof src.sparkline === 'object' ? src.sparkline : {};
  const deltaSrc = src.deltaStyle && typeof src.deltaStyle === 'object' ? src.deltaStyle : {};
  const paletteSrc = src.palette && typeof src.palette === 'object' ? src.palette : {};
  const modeRaw = String(sparkSrc.mode != null ? sparkSrc.mode : sparkDef.mode || 'line').trim().toLowerCase();
  const mode = ['line', 'area', 'bar'].includes(modeRaw) ? modeRaw : String(sparkDef.mode || 'line');
  const curveRaw = String(sparkSrc.curve != null ? sparkSrc.curve : sparkDef.curve || 'smooth').trim().toLowerCase();
  const curve = ['smooth', 'straight', 'stepline'].includes(curveRaw) ? curveRaw : String(sparkDef.curve || 'smooth');
  const fontWeightRaw = parseInt(String(deltaSrc.fontWeight != null ? deltaSrc.fontWeight : deltaDef.fontWeight || 500), 10);
  const fontWeight = (fontWeightRaw === 400 || fontWeightRaw === 500) ? fontWeightRaw : 500;
  const supportsCompare = bundleKey === 'dashboardCards';
  const out = {
    sparkline: {
      mode,
      curve,
      strokeWidth: parseBoundedNumber(sparkSrc.strokeWidth, sparkDef.strokeWidth != null ? sparkDef.strokeWidth : 2.55, 0.5, 6),
      height: Math.round(parseBoundedNumber(sparkSrc.height, sparkDef.height != null ? sparkDef.height : 50, 18, 120)),
      showCompare: supportsCompare ? normalizeBool(sparkSrc.showCompare, sparkDef.showCompare !== false) : false,
      compareUsePrimaryColor: supportsCompare ? normalizeBool(sparkSrc.compareUsePrimaryColor, sparkDef.compareUsePrimaryColor !== false) : false,
      compareOpacity: Math.round(parseBoundedNumber(sparkSrc.compareOpacity, sparkDef.compareOpacity != null ? sparkDef.compareOpacity : 50, 0, 100)),
      advancedApexOverride: normalizeApexOverrideObject(sparkSrc.advancedApexOverride, sparkDef.advancedApexOverride || {}),
    },
    deltaStyle: {
      fontSize: Math.round(parseBoundedNumber(deltaSrc.fontSize, deltaDef.fontSize != null ? deltaDef.fontSize : 14, 9, 24)),
      fontWeight,
      iconSize: Math.round(parseBoundedNumber(deltaSrc.iconSize, deltaDef.iconSize != null ? deltaDef.iconSize : 12, 8, 24)),
      fontColor: normalizeOptionalHexColor(deltaSrc.fontColor),
      iconColor: normalizeOptionalHexColor(deltaSrc.iconColor),
    },
    palette: {
      up: normalizeHexColor(paletteSrc.up, paletteDef.up || '#2fb344'),
      down: normalizeHexColor(paletteSrc.down, paletteDef.down || '#d63939'),
      same: normalizeHexColor(paletteSrc.same, paletteDef.same || '#66bdb7'),
      compareLine: normalizeHexColor(paletteSrc.compareLine, paletteDef.compareLine || '#cccccc'),
    },
  };
  if (bundleKey === 'dashboardCards') {
    // Migration: older defaults used a primary-color compare line (opacity) which reads like a filled area.
    // New default: dashed grey compare line.
    if (out.sparkline && out.sparkline.showCompare && out.sparkline.compareUsePrimaryColor === true && out.sparkline.compareOpacity === 50) {
      out.sparkline.compareUsePrimaryColor = false;
    }
  }
  return out;
}

function normalizeChartsKpiBundles(rawBundles, defaults) {
  const src = rawBundles && typeof rawBundles === 'object' ? rawBundles : {};
  const defs = defaults && typeof defaults === 'object' ? defaults : {};
  const out = {};
  for (const key of CHART_KPI_BUNDLE_KEYS) {
    if (!CHART_KPI_BUNDLE_KEY_SET.has(key)) continue;
    out[key] = normalizeChartsKpiBundle(key, src[key], defs[key]);
  }
  return out;
}

function normalizeChartsUiConfigV1(raw) {
  const def = defaultChartsUiConfigV1();
  const obj = safeJsonParseObject(raw);
  if (!obj || obj.v !== 1) return def;
  const rawDefaultsVersion = Number.parseInt(String(obj.defaultsVersion != null ? obj.defaultsVersion : ''), 10);
  const defaultsVersion = Number.isFinite(rawDefaultsVersion) && rawDefaultsVersion >= 0 ? rawDefaultsVersion : 0;
  const shouldMigrateDashboardOverview = defaultsVersion < 2;
  const shouldMigrateMapZoomButtons = defaultsVersion < 3;
  return {
    v: 1,
    defaultsVersion: Math.max(defaultsVersion, CHARTS_UI_DEFAULTS_VERSION),
    hideOnMobile: normalizeBool(obj.hideOnMobile, def.hideOnMobile),
    charts: normalizeChartsList(obj.charts, def.charts, { migrateDashboardOverview: shouldMigrateDashboardOverview, migrateMapZoomButtons: shouldMigrateMapZoomButtons }),
    kpiBundles: normalizeChartsKpiBundles(obj.kpiBundles, def.kpiBundles),
  };
}

function normalizeKpiList(rawList, defaults) {
  const byKey = {};
  for (const d of defaults) {
    byKey[d.key] = {
      key: d.key,
      label: d.label,
      enabled: !!d.enabled,
    };
  }
  const out = [];
  const seen = new Set();
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue;
      const key = item.key != null ? String(item.key).trim().toLowerCase() : '';
      if (!KPI_UI_KEY_SET.has(key)) continue;
      if (seen.has(key)) continue;
      const def = byKey[key] || { key, label: key, enabled: true };
      const normalized = {
        key,
        label: normalizeText(item.label, def.label),
        enabled: normalizeBool(item.enabled, def.enabled),
      };
      out.push(normalized);
      seen.add(key);
    }
  }
  for (const d of defaults) {
    if (seen.has(d.key)) continue;
    const normalized = { key: d.key, label: d.label, enabled: !!d.enabled };
    out.push(normalized);
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
  const generalOptions = options.general && typeof options.general === 'object' ? options.general : {};
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
      general: {
        dateLabelFormat: normalizeDateLabelFormat(generalOptions.dateLabelFormat, def.options.general.dateLabelFormat),
        returnsRefundsAttribution: normalizeReturnsRefundsAttribution(generalOptions.returnsRefundsAttribution, def.options.general.returnsRefundsAttribution),
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

function defaultPageLoaderEnabledV1() {
  return {
    v: 1,
    pages: {
      dashboard: true,
      live: true,
      sales: true,
      date: true,
      snapshot: true,
      countries: true,
      products: true,
      variants: true,
      'abandoned-carts': true,
      channels: true,
      type: true,
      ads: true,
      'compare-conversion-rate': true,
      'shipping-cr': true,
      settings: true,
      upgrade: false,
      // Always disabled (admin should never show the overlay loader).
      admin: false,
    },
  };
}

function normalizePageLoaderEnabledV1(raw) {
  const base = defaultPageLoaderEnabledV1();
  const out = { v: 1, pages: { ...base.pages } };
  if (!raw) return out;
  let parsed = null;
  try {
    parsed = (typeof raw === 'string') ? JSON.parse(raw) : raw;
  } catch (_) {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  if (Number(parsed.v) !== 1) return out;
  const pages = parsed.pages && typeof parsed.pages === 'object' ? parsed.pages : null;
  if (!pages) return out;
  for (const key of Object.keys(out.pages)) {
    if (!Object.prototype.hasOwnProperty.call(pages, key)) continue;
    out.pages[key] = pages[key] === false ? false : true;
  }
  out.pages.settings = false;
  out.pages.admin = false;
  return out;
}

function defaultOverviewWidgetsUiConfigV1() {
  const widgets = {};
  for (const key of OVERVIEW_WIDGET_KEYS) {
    widgets[key] = {
      sortBy: 'revenue',
      color: '',
      ...(key === 'finishes' ? { groupBy: 'finishes' } : {}),
    };
  }
  return { v: 1, order: [...OVERVIEW_WIDGET_KEYS], widgets };
}

function normalizeCssVarName(raw) {
  const name = raw == null ? '' : String(raw).trim();
  if (!name) return null;
  if (name.length > 64) return null;
  if (!/^--[a-zA-Z0-9._-]+$/.test(name)) return null;
  return name;
}

function normalizeCssVarOverrideValue(raw) {
  const v = raw == null ? '' : String(raw).trim();
  if (!v) return '';
  if (v.length > 150) return '';
  if (/[;\r\n{}]/.test(v)) return '';
  if (/^var\(--[a-zA-Z0-9._-]+\)$/.test(v)) return v;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v;
  if (/^(rgb|hsl)a?\(/i.test(v)) return v;
  if (/^color-mix\(/.test(v)) return v;
  if (v.toLowerCase() === 'currentcolor') return 'currentColor';
  if (v.toLowerCase() === 'transparent') return 'transparent';
  if (/^[a-z-]+$/i.test(v)) return v;
  return '';
}

function defaultCssVarOverridesV1() {
  return { v: 1, vars: {} };
}

function normalizeCssVarOverridesV1(raw) {
  const parsed = (() => {
    if (raw && typeof raw === 'object') return raw;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (_) {
      return null;
    }
  })();
  const out = defaultCssVarOverridesV1();
  if (!parsed) return out;
  if (Number(parsed.v) !== 1) return out;
  const vars = parsed.vars && typeof parsed.vars === 'object' ? parsed.vars : null;
  if (!vars) return out;
  const allow = (colorSchemeMap && typeof colorSchemeMap.cssVarOverrideAllowlist === 'function')
    ? colorSchemeMap.cssVarOverrideAllowlist()
    : null;
  const dead = new Set(Array.isArray(colorSchemeMap && colorSchemeMap.deadCssVars) ? colorSchemeMap.deadCssVars : []);
  const next = {};
  let count = 0;
  for (const k of Object.keys(vars)) {
    if (count >= 120) break;
    const name = normalizeCssVarName(k);
    if (!name) continue;
    if (dead.has(name)) continue;
    if (allow && !allow.has(name)) continue;
    const isOpaque = !!(colorSchemeMap && typeof colorSchemeMap.isOpaqueVar === 'function' && colorSchemeMap.isOpaqueVar(name));
    const val = isOpaque ? normalizeOpaqueCssColor(vars[k], '') : normalizeCssVarOverrideValue(vars[k]);
    if (!val) continue;
    next[name] = val;
    count++;
  }
  out.vars = next;
  return out;
}

function normalizeOverviewWidgetsUiConfigV1(raw) {
  const parsed = (() => {
    if (raw && typeof raw === 'object') return raw;
    if (!raw || typeof raw !== 'string') return null;
    try {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' ? obj : null;
    } catch (_) {
      return null;
    }
  })();
  const out = defaultOverviewWidgetsUiConfigV1();
  if (!parsed) return out;
  if (Number(parsed.v) !== 1) return out;

  // Order
  try {
    const list = Array.isArray(parsed.order) ? parsed.order : null;
    if (list && list.length) {
      const seen = new Set();
      const next = [];
      for (const k of list) {
        const key = k == null ? '' : String(k).trim().toLowerCase();
        if (!OVERVIEW_WIDGET_KEY_SET.has(key)) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(key);
      }
      if (next.length === OVERVIEW_WIDGET_KEYS.length) out.order = next;
    }
  } catch (_) {}

  // Per-widget options
  const widgets = parsed.widgets && typeof parsed.widgets === 'object' ? parsed.widgets : null;
  if (widgets) {
    for (const key of OVERVIEW_WIDGET_KEYS) {
      const row = widgets[key] && typeof widgets[key] === 'object' ? widgets[key] : null;
      if (!row) continue;
      if (Object.prototype.hasOwnProperty.call(row, 'sortBy')) {
        const sortBy = row.sortBy == null ? '' : String(row.sortBy).trim().toLowerCase();
        if (OVERVIEW_WIDGET_SORT_BY_SET.has(sortBy)) out.widgets[key].sortBy = sortBy;
      }
      if (Object.prototype.hasOwnProperty.call(row, 'color')) {
        out.widgets[key].color = normalizeCssVarOverrideValue(row.color) || '';
      }
      if (key === 'finishes' && Object.prototype.hasOwnProperty.call(row, 'groupBy')) {
        const g = row.groupBy == null ? '' : String(row.groupBy).trim().toLowerCase();
        if (g) out.widgets.finishes.groupBy = g;
      }
    }
  }
  return out;
}

async function readSettingsKeyMap(keys) {
  const list = Array.isArray(keys) ? keys.map((k) => (k == null ? '' : String(k))).filter(Boolean) : [];
  if (!list.length) return {};
  const placeholders = list.map(() => '?').join(', ');
  const db = getDb();
  const rows = await db.all(
    `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
    list
  );
  const map = {};
  for (const row of rows || []) {
    const k = row && row.key != null ? String(row.key) : '';
    if (!k) continue;
    map[k] = row && row.value != null ? String(row.value) : '';
  }
  return map;
}

async function readSettingsPayload() {
  let pixelSessionMode = 'legacy';
  const adminTimezone = store.resolveAdminTimeZone();
  let assetOverrides = {};
  let kpiUiConfig = defaultKpiUiConfigV1();
  let chartsUiConfig = defaultChartsUiConfigV1();
  let tablesUiConfig = defaultTablesUiConfigV1();
  let profitRules = defaultProfitRulesConfigV1();
  let googleAdsProfitConfig = defaultGoogleAdsProfitConfigV1();
  let googleAdsProfitDeductions = defaultGoogleAdsProfitDeductionsV1();
  let googleAdsAddToCartValue = 1;
  let googleAdsPostbackGoals = defaultGoogleAdsPostbackGoals();
  let insightsVariantsConfig = defaultVariantsConfigV1();
  let settingsScopeMode = 'global';
  let pageLoaderEnabled = defaultPageLoaderEnabledV1();
  let overviewWidgetsUiConfig = defaultOverviewWidgetsUiConfigV1();
  let cssVarOverridesV1 = defaultCssVarOverridesV1();
  let rawMap = {};
  const GOOGLE_ADS_POSTBACK_ENABLED_KEY = 'google_ads_postback_enabled';
  try {
    rawMap = await readSettingsKeyMap([
      PIXEL_SESSION_MODE_KEY,
      SETTINGS_SCOPE_MODE_KEY,
      PAGE_LOADER_ENABLED_V1_KEY,
      ASSET_OVERRIDES_KEY,
      KPI_UI_CONFIG_V1_KEY,
      CHARTS_UI_CONFIG_V1_KEY,
      TABLES_UI_CONFIG_V1_KEY,
      OVERVIEW_WIDGETS_UI_CONFIG_V1_KEY,
      CSS_VAR_OVERRIDES_V1_KEY,
      PROFIT_RULES_V1_KEY,
      GOOGLE_ADS_PROFIT_CONFIG_V1_KEY,
      GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY,
      GOOGLE_ADS_ADD_TO_CART_VALUE_KEY,
      GOOGLE_ADS_POSTBACK_GOALS_KEY,
      VARIANTS_CONFIG_KEY,
      GOOGLE_ADS_POSTBACK_ENABLED_KEY,
    ]);
  } catch (_) {
    rawMap = {};
  }
  try {
    pixelSessionMode = normalizePixelSessionMode(rawMap[PIXEL_SESSION_MODE_KEY]);
  } catch (_) {}
  try {
    const rawScope = rawMap[SETTINGS_SCOPE_MODE_KEY];
    const normalizedScope = normalizeSettingsScopeMode(rawScope);
    settingsScopeMode = normalizedScope;
    // Persist the default once so the DB reflects the current project policy.
    const rawNorm = rawScope == null ? '' : String(rawScope).trim().toLowerCase();
    if (!rawNorm || rawNorm !== normalizedScope) {
      await store.setSetting(SETTINGS_SCOPE_MODE_KEY, normalizedScope);
    }
  } catch (_) {}
  try {
    const raw = rawMap[ASSET_OVERRIDES_KEY];
    const parsed = safeJsonParseObject(raw);
    if (parsed) assetOverrides = parsed;
  } catch (_) {}
  try {
    const raw = rawMap[KPI_UI_CONFIG_V1_KEY];
    kpiUiConfig = normalizeKpiUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[CHARTS_UI_CONFIG_V1_KEY];
    chartsUiConfig = normalizeChartsUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[TABLES_UI_CONFIG_V1_KEY];
    tablesUiConfig = normalizeTablesUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[OVERVIEW_WIDGETS_UI_CONFIG_V1_KEY];
    overviewWidgetsUiConfig = normalizeOverviewWidgetsUiConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[CSS_VAR_OVERRIDES_V1_KEY];
    cssVarOverridesV1 = normalizeCssVarOverridesV1(raw);
    // One-time-ish cleanup: if normalization drops legacy/dead keys, persist the cleaned payload.
    try {
      const cleaned = JSON.stringify(cssVarOverridesV1);
      const rawStr = raw != null ? String(raw).trim() : '';
      if (cleaned && cleaned !== rawStr) {
        // Avoid writing an empty object back over an empty DB value.
        if (rawStr || (cssVarOverridesV1 && cssVarOverridesV1.vars && Object.keys(cssVarOverridesV1.vars).length)) {
          await store.setSetting(CSS_VAR_OVERRIDES_V1_KEY, cleaned);
        }
      }
    } catch (_) {}
  } catch (_) {}
  try {
    const raw = rawMap[PROFIT_RULES_V1_KEY];
    profitRules = normalizeProfitRulesConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[GOOGLE_ADS_PROFIT_CONFIG_V1_KEY];
    googleAdsProfitConfig = normalizeGoogleAdsProfitConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY];
    googleAdsProfitDeductions = normalizeGoogleAdsProfitDeductionsV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[GOOGLE_ADS_ADD_TO_CART_VALUE_KEY];
    if (raw != null && raw !== '') {
      const n = Number(raw);
      googleAdsAddToCartValue = Number.isFinite(n) && n >= 0 ? n : 1;
    }
  } catch (_) {}
  try {
    const raw = rawMap[GOOGLE_ADS_POSTBACK_GOALS_KEY];
    googleAdsPostbackGoals = normalizeGoogleAdsPostbackGoals(raw);
  } catch (_) {}
  try {
    const raw = rawMap[VARIANTS_CONFIG_KEY];
    insightsVariantsConfig = normalizeVariantsConfigV1(raw);
  } catch (_) {}
  try {
    const raw = rawMap[PAGE_LOADER_ENABLED_V1_KEY];
    pageLoaderEnabled = normalizePageLoaderEnabledV1(raw);
  } catch (_) { pageLoaderEnabled = defaultPageLoaderEnabledV1(); }
  let googleAdsPostbackEnabled = false;
  try {
    const raw = rawMap[GOOGLE_ADS_POSTBACK_ENABLED_KEY];
    googleAdsPostbackEnabled = raw === 'true' || raw === '1';
  } catch (_) {}
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  return {
    ok: true,
    settingsScopeMode,
    adminTimezone,
    pixelSessionMode,
    sharedSessionTtlMinutes: 30,
    assetOverrides,
    reporting,
    kpiUiConfig,
    chartsUiConfig,
    tablesUiConfig,
    overviewWidgetsUiConfig,
    cssVarOverridesV1,
    profitRules,
    googleAdsProfitConfig,
    googleAdsProfitDeductions,
    googleAdsAddToCartValue,
    googleAdsPostbackGoals,
    insightsVariantsConfig,
    pageLoaderEnabled,
    googleAdsPostbackEnabled,
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
  const wantsAdminOnlyWrite =
    Object.prototype.hasOwnProperty.call(body, 'settingsScopeMode') ||
    Object.prototype.hasOwnProperty.call(body, 'adminTimezone') ||
    Object.prototype.hasOwnProperty.call(body, 'pixelSessionMode') ||
    Object.prototype.hasOwnProperty.call(body, 'reporting');
  const wantsPlanLockedAssetsWrite = (() => {
    const patch = body.assetOverrides && typeof body.assetOverrides === 'object' ? body.assetOverrides : null;
    if (!patch) return false;
    const keys = Object.keys(patch || {});
    if (!keys.length) return false;
    const locked = new Set([
      'favicon',
      'logo',
      'footerlogo',
      'footer_logo',
      'loginlogo',
      'login_logo',
      'kexologofullcolor',
      'kexo_logo_fullcolor',
    ]);
    return keys.some((k) => locked.has(String(k || '').trim().toLowerCase()));
  })();
  if (wantsAdminOnlyWrite || wantsPlanLockedAssetsWrite) {
    let isMaster = false;
    try { isMaster = await isMasterRequest(req); } catch (_) { isMaster = false; }
    if (!isMaster) {
      if (wantsAdminOnlyWrite) return res.status(403).json({ ok: false, error: 'Forbidden' });
      if (wantsPlanLockedAssetsWrite) return res.status(402).json({ ok: false, error: 'upgrade_required', upgradeUrl: '/upgrade' });
    }
  }

  // Settings scope (global/shared only for now)
  if (Object.prototype.hasOwnProperty.call(body, 'settingsScopeMode')) {
    try {
      const normalized = normalizeSettingsScopeMode(body.settingsScopeMode);
      await store.setSetting(SETTINGS_SCOPE_MODE_KEY, normalized);
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save setting scope' });
    }
  }

  // Admin timezone (IANA name, used for date bounds and display).
  if (Object.prototype.hasOwnProperty.call(body, 'adminTimezone')) {
    try {
      await store.setAdminTimeZone(body.adminTimezone);
    } catch (err) {
      const msg = err && err.message ? String(err.message) : 'Invalid timezone';
      return res.status(400).json({ ok: false, error: 'invalid_timezone', message: msg });
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

  function isIconLikeAssetOverrideKey(rawKey) {
    const key = rawKey == null ? '' : String(rawKey).trim().toLowerCase();
    if (!key) return false;
    if (/^payment_[a-z0-9_]+$/.test(key)) return true;
    if (/^variant_rule_[a-z0-9_-]+__[a-z0-9_-]+$/.test(key)) return true;
    if (/^variant_icon_[a-z0-9_-]+$/.test(key)) return true;
    if (/^overview_widget_[a-z0-9_-]+$/.test(key)) return true;
    return false;
  }

  async function normalizeAssetOverridesPatch(rawPatch) {
    const patch = rawPatch && typeof rawPatch === 'object' ? rawPatch : {};
    const out = {};
    for (const key of Object.keys(patch || {})) {
      const rawValue = patch[key];
      if (!isIconLikeAssetOverrideKey(key)) {
        out[key] = rawValue;
        continue;
      }
      if (rawValue == null || String(rawValue).trim() === '') {
        out[key] = '';
        continue;
      }
      const iconSpec = await normalizeIconSpec(rawValue, { fetchRemoteSvg: true, timeoutMs: 5000 });
      out[key] = iconSpec || '';
    }
    return out;
  }

  // Asset overrides (merge with existing)
  if (body.assetOverrides && typeof body.assetOverrides === 'object') {
    try {
      let existing = {};
      const raw = await store.getSetting(ASSET_OVERRIDES_KEY);
      if (raw && typeof raw === 'string') {
        try { existing = JSON.parse(raw) || {}; } catch (_) {}
      }
      const normalizedPatch = await normalizeAssetOverridesPatch(body.assetOverrides);
      const merged = { ...existing, ...normalizedPatch };
      // Purge removed icon sections (Overview Widgets + Variant value icons)
      for (const k of Object.keys(merged)) {
        if (k.startsWith('overview_widget_') || k.startsWith('variant_icon_')) {
          delete merged[k];
        }
      }
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

  // Google Ads postback (enable/disable)
  if (Object.prototype.hasOwnProperty.call(body, 'googleAdsPostbackEnabled')) {
    try {
      const v = body.googleAdsPostbackEnabled === true || body.googleAdsPostbackEnabled === 'true' || body.googleAdsPostbackEnabled === '1';
      await store.setSetting('google_ads_postback_enabled', v ? 'true' : 'false');
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save postback setting' });
    }
  }

  // Google Ads profit config (v1) – used for Profit conversion uploads
  if (Object.prototype.hasOwnProperty.call(body, 'googleAdsProfitConfig')) {
    try {
      if (body.googleAdsProfitConfig == null) {
        await store.setSetting(GOOGLE_ADS_PROFIT_CONFIG_V1_KEY, '');
      } else {
        const normalized = normalizeGoogleAdsProfitConfigV1(body.googleAdsProfitConfig);
        const json = JSON.stringify(normalized);
        if (json.length > 5000) throw new Error('Google Ads profit config too large');
        await store.setSetting(GOOGLE_ADS_PROFIT_CONFIG_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save Google Ads profit config' });
    }
  }

  // Google Ads profit deductions (v1) – which costs to subtract for Profit upload value
  if (Object.prototype.hasOwnProperty.call(body, 'googleAdsProfitDeductions')) {
    try {
      if (body.googleAdsProfitDeductions == null) {
        await store.setSetting(GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY, '');
      } else {
        const normalized = normalizeGoogleAdsProfitDeductionsV1(body.googleAdsProfitDeductions);
        const json = JSON.stringify(normalized);
        if (json.length > 2000) throw new Error('Google Ads profit deductions too large');
        await store.setSetting(GOOGLE_ADS_PROFIT_DEDUCTIONS_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save Google Ads profit deductions' });
    }
  }

  // Google Ads Add to Cart conversion value
  if (Object.prototype.hasOwnProperty.call(body, 'googleAdsAddToCartValue')) {
    try {
      const v = body.googleAdsAddToCartValue;
      const n = v != null && v !== '' ? Number(v) : 1;
      const val = Number.isFinite(n) && n >= 0 ? Math.min(1000000, n) : 1;
      await store.setSetting(GOOGLE_ADS_ADD_TO_CART_VALUE_KEY, String(val));
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save Add to Cart value' });
    }
  }

  // Google Ads postback goals – which goals to upload (revenue / profit / add_to_cart)
  if (Object.prototype.hasOwnProperty.call(body, 'googleAdsPostbackGoals')) {
    try {
      if (body.googleAdsPostbackGoals == null) {
        await store.setSetting(GOOGLE_ADS_POSTBACK_GOALS_KEY, '');
      } else {
        const normalized = normalizeGoogleAdsPostbackGoals(body.googleAdsPostbackGoals);
        const json = JSON.stringify(normalized);
        if (json.length > 500) throw new Error('Google Ads postback goals too large');
        await store.setSetting(GOOGLE_ADS_POSTBACK_GOALS_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save Google Ads postback goals' });
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

  // Overview widgets UI config (v1)
  if (Object.prototype.hasOwnProperty.call(body, 'overviewWidgetsUiConfig')) {
    try {
      if (body.overviewWidgetsUiConfig == null) {
        await store.setSetting(OVERVIEW_WIDGETS_UI_CONFIG_V1_KEY, '');
      } else {
        const normalized = normalizeOverviewWidgetsUiConfigV1(body.overviewWidgetsUiConfig);
        const json = JSON.stringify(normalized);
        if (json.length > 30000) throw new Error('Overview widgets config too large');
        await store.setSetting(OVERVIEW_WIDGETS_UI_CONFIG_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save overview widgets config' });
    }
  }

  // CSS variable overrides (v1) – runtime :root overrides (colours, palette)
  if (Object.prototype.hasOwnProperty.call(body, 'cssVarOverridesV1')) {
    try {
      if (body.cssVarOverridesV1 == null) {
        await store.setSetting(CSS_VAR_OVERRIDES_V1_KEY, '');
      } else {
        const normalized = normalizeCssVarOverridesV1(body.cssVarOverridesV1);
        const json = JSON.stringify(normalized);
        if (json.length > 20000) throw new Error('CSS var overrides too large');
        await store.setSetting(CSS_VAR_OVERRIDES_V1_KEY, json);
      }
    } catch (err) {
      return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save colours' });
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
const THEME_ICON_GLYPH_KEYS = getThemeIconGlyphSettingKeys();
const THEME_BASE_KEYS = [
  'theme',
  'theme_accent_1',
  'theme_accent_2',
  'theme_accent_3',
  'theme_accent_4',
  'theme_accent_5',
  'theme_accent_6',
  'theme_radius',
  'theme_font',
  'theme_base',
  'theme_preference_mode',
  'theme_kpi_separate_palettes',
  'theme_header_main_border',
  'theme_header_main_shadow',
  'theme_header_settings_label',
  'theme_header_settings_radius',
  'theme_header_settings_border',
  'theme_header_online_radius',
  'theme_header_online_border',
  'theme_header_logo_url',
  'theme_menu_hover_opacity',
  'theme_menu_hover_color',
  'theme_header_strip_padding',
  'theme_custom_css',
  'theme_icon_default',
  'theme_icon_topnav',
  'theme_icon_dropdown',
  'theme_icon_settings_menu',
  'theme_icon_table_heading',
  'theme_icon_size',
  'theme_icon_color',
  'theme_icon_overrides_json',
];
const THEME_KEYS = THEME_BASE_KEYS.concat(THEME_ICON_GLYPH_KEYS);

const THEME_COLOR_SCHEME_MIGRATION_V1_KEY = 'theme_color_scheme_migration_v1';
let didThemeColorSchemeMigrationThisProcess = false;

async function migrateLegacyThemeHeaderColorsToCssVarOverridesOnce() {
  // Migrates legacy theme_* header/nav color keys -> css_var_overrides_v1 and clears the legacy keys.
  // This keeps user values working after the Settings UI moved to CSS variable overrides.
  try {
    const marker = await store.getSetting(THEME_COLOR_SCHEME_MIGRATION_V1_KEY);
    if (String(marker || '').trim() === '1') return;
  } catch (_) {}

  const legacyMap = (colorSchemeMap && colorSchemeMap.legacyThemeColorKeysToCssVars && typeof colorSchemeMap.legacyThemeColorKeysToCssVars === 'object')
    ? colorSchemeMap.legacyThemeColorKeysToCssVars
    : {};
  const legacyKeys = Object.keys(legacyMap || {});
  if (!legacyKeys.length) {
    try { await store.setSetting(THEME_COLOR_SCHEME_MIGRATION_V1_KEY, '1'); } catch (_) {}
    return;
  }

  const legacyVals = {};
  let hasAny = false;
  for (const k of legacyKeys) {
    try {
      const raw = await store.getSetting('theme_' + k);
      const val = raw != null ? String(raw).trim() : '';
      if (!val) continue;
      legacyVals[k] = val;
      hasAny = true;
    } catch (_) {}
  }
  if (!hasAny) {
    try { await store.setSetting(THEME_COLOR_SCHEME_MIGRATION_V1_KEY, '1'); } catch (_) {}
    return;
  }

  let cfg = defaultCssVarOverridesV1();
  try {
    const rawOverrides = await store.getSetting(CSS_VAR_OVERRIDES_V1_KEY);
    cfg = normalizeCssVarOverridesV1(rawOverrides);
  } catch (_) {
    cfg = defaultCssVarOverridesV1();
  }
  const nextVars = { ...(cfg && cfg.vars && typeof cfg.vars === 'object' ? cfg.vars : {}) };

  function setOverrideIfMissing(cssVarName, rawValue) {
    const name = normalizeCssVarName(cssVarName);
    if (!name) return;
    if (Object.prototype.hasOwnProperty.call(nextVars, name)) return;
    const isOpaque = !!(colorSchemeMap && typeof colorSchemeMap.isOpaqueVar === 'function' && colorSchemeMap.isOpaqueVar(name));
    const normalized = isOpaque ? normalizeOpaqueCssColor(rawValue, '') : normalizeCssVarOverrideValue(rawValue);
    if (!normalized) return;
    nextVars[name] = normalized;
  }

  for (const themeKey of Object.keys(legacyVals)) {
    const mapped = legacyMap[themeKey];
    const val = legacyVals[themeKey];
    if (!val) continue;
    if (mapped) {
      setOverrideIfMissing(mapped, val);
      continue;
    }
    // Special legacy key: theme_header_link_color previously fanned out to multiple outputs.
    if (themeKey === 'theme_header_link_color') {
      setOverrideIfMissing('--kexo-header-top-text-color', val);
      setOverrideIfMissing('--kexo-top-menu-link-color', val);
    }
  }

  cfg.vars = nextVars;
  try {
    await store.setSetting(CSS_VAR_OVERRIDES_V1_KEY, JSON.stringify(cfg));
  } catch (_) {}

  // Clear legacy theme keys (so they don't linger in storage).
  for (const k of Object.keys(legacyVals)) {
    try { await store.setSetting('theme_' + k, ''); } catch (_) {}
  }

  try { await store.setSetting(THEME_COLOR_SCHEME_MIGRATION_V1_KEY, '1'); } catch (_) {}
}

async function getThemeDefaults(req, res) {
  const result = { ok: true };
  try {
    await migrateLegacyThemeHeaderColorsToCssVarOverridesOnce();
    const dbKeys = THEME_KEYS.map((k) => 'theme_' + k);
    const map = await readSettingsKeyMap(dbKeys);
    for (const key of THEME_KEYS) {
      const dbKey = 'theme_' + key;
      const raw = map[dbKey];
      result[key] = raw != null ? String(raw) : '';
    }
  } catch (_) {
    for (const key of THEME_KEYS) result[key] = '';
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(result);
}

async function postThemeDefaults(req, res) {
  const body = req && req.body && typeof req.body === 'object' ? req.body : {};
  if (Object.prototype.hasOwnProperty.call(body, 'theme_header_logo_url')) {
    let isMaster = false;
    try { isMaster = await isMasterRequest(req); } catch (_) { isMaster = false; }
    if (!isMaster) return res.status(402).json({ ok: false, error: 'upgrade_required', upgradeUrl: '/upgrade' });
  }
  try {
    // Patch semantics: only update provided keys (prevents large payload requirements
    // and avoids wiping other keys when partial payloads are sent).
    for (const key of Object.keys(body)) {
      if (!THEME_KEYS.includes(key)) continue;
      let val = body[key] != null ? String(body[key]).trim() : '';
      if (key.indexOf('icon_glyph_') === 0) {
        const normalizedIconSpec = await normalizeIconSpec(body[key], { fetchRemoteSvg: true, timeoutMs: 5000 });
        val = normalizedIconSpec || '';
      }
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

function normalizeOpaqueCssColor(value, fallback) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return fallback;

  // Disallow alpha formats (these create the “overlay/see-through header” effect).
  // - #RRGGBBAA / #RGBA
  // - rgba(...) / hsla(...)
  // - modern rgb(... / <alpha>) / hsl(... / <alpha>)
  if (/^#([0-9a-f]{4}|[0-9a-f]{8})$/i.test(raw)) return fallback;
  if (/^(rgba|hsla)\(/i.test(raw)) return fallback;
  if (/^(rgb|hsl)\(/i.test(raw) && raw.indexOf('/') !== -1) return fallback;
  if (/^color-mix\(/i.test(raw)) return fallback;

  // Accept opaque hex (expand short form to 6-digit for downstream RGB parsing).
  const hex3 = /^#([0-9a-f]{3})$/i.exec(raw);
  if (hex3) {
    const h = hex3[1];
    return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (/^#([0-9a-f]{6})$/i.test(raw)) return raw;

  // Accept rgb()/hsl() (no slash alpha form) and named colors.
  if (/^(rgb|hsl)\(/i.test(raw)) return raw;
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
  if (!didThemeColorSchemeMigrationThisProcess) {
    didThemeColorSchemeMigrationThisProcess = true;
    try { await migrateLegacyThemeHeaderColorsToCssVarOverridesOnce(); } catch (_) { didThemeColorSchemeMigrationThisProcess = false; }
  }
  const FALLBACKS = {
    theme_accent_1: '#4b94e4',
    theme_radius: '1',
    theme_font: 'sans',
    theme_base: 'slate',
    theme_kpi_separate_palettes: '0',
    theme_header_main_border: 'show',
    theme_header_main_shadow: '2px 2px 2px #eee',
    theme_header_settings_label: 'show',
    theme_header_settings_radius: '.375rem',
    theme_header_settings_border: 'show',
    theme_header_online_radius: '.375rem',
    theme_header_online_border: 'show',
    theme_menu_hover_opacity: '8',
    theme_menu_hover_color: 'black',
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
    radiusKey,
    fontKey,
    baseKey,
    iconSize,
    iconColor,
    kpiSeparatePalettesRaw,
    mainBorderMode,
    mainShadow,
    settingsLabelMode,
    settingsRadius,
    settingsBorderMode,
    menuHoverOpacity,
    menuHoverColor,
    onlineRadius,
    onlineBorderMode,
    stripPadding,
  ] = await Promise.all([
    Promise.resolve(accent1),
    getThemeKey('theme_radius', FALLBACKS.theme_radius),
    getThemeKey('theme_font', FALLBACKS.theme_font),
    getThemeKey('theme_base', FALLBACKS.theme_base),
    getThemeKey('theme_icon_size', ''),
    getThemeKey('theme_icon_color', ''),
    getThemeKey('theme_kpi_separate_palettes', FALLBACKS.theme_kpi_separate_palettes),
    getThemeKey('theme_header_main_border', FALLBACKS.theme_header_main_border),
    getThemeKey('theme_header_main_shadow', FALLBACKS.theme_header_main_shadow),
    getThemeKey('theme_header_settings_label', FALLBACKS.theme_header_settings_label),
    getThemeKey('theme_header_settings_radius', FALLBACKS.theme_header_settings_radius),
    getThemeKey('theme_header_settings_border', FALLBACKS.theme_header_settings_border),
    getThemeKey('theme_menu_hover_opacity', FALLBACKS.theme_menu_hover_opacity),
    getThemeKey('theme_menu_hover_color', FALLBACKS.theme_menu_hover_color),
    getThemeKey('theme_header_online_radius', FALLBACKS.theme_header_online_radius),
    getThemeKey('theme_header_online_border', FALLBACKS.theme_header_online_border),
    getThemeKey('theme_header_strip_padding', FALLBACKS.theme_header_strip_padding),
  ]);

  const accent1Hex = normalizeOpaqueCssColor(accent1, FALLBACKS.theme_accent_1);
  void _skip;
  const mainBorder = normalizeCssToggle(mainBorderMode, 'show');
  const settingsBorder = normalizeCssToggle(settingsBorderMode, 'show');
  const onlineBorder = normalizeCssToggle(onlineBorderMode, 'show');
  const labelMode = normalizeCssToggle(settingsLabelMode, 'show');
  const kpiSeparatePalettes = normalizeCssToggle(kpiSeparatePalettesRaw, 'hide') === 'show';

  const [a2, a3, a4, a5, a6] = await Promise.all([
    getThemeKey('theme_accent_2', '#3eb3ab'),
    getThemeKey('theme_accent_3', '#f59e34'),
    getThemeKey('theme_accent_4', '#e4644b'),
    getThemeKey('theme_accent_5', '#6681e8'),
    getThemeKey('theme_accent_6', '#8395aa'),
  ]);

  const accent2Hex = normalizeOpaqueCssColor(a2, '#3eb3ab');
  const accent3Hex = normalizeOpaqueCssColor(a3, '#f59e34');
  const accent4Hex = normalizeOpaqueCssColor(a4, '#e4644b');
  const accent5Hex = normalizeOpaqueCssColor(a5, '#6681e8');
  const accent6Hex = normalizeOpaqueCssColor(a6, '#8395aa');

  function hexToRgbString(hex) {
    const raw = String(hex || '').trim();
    if (!/^#([0-9a-f]{6})$/i.test(raw)) return '';
    const r = parseInt(raw.slice(1, 3), 16);
    const g = parseInt(raw.slice(3, 5), 16);
    const b = parseInt(raw.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }

  const primaryRgb = hexToRgbString(accent1Hex) || '32,107,196';

  // Header/nav color defaults are derived from Accent 1, with optional CSS var overrides.
  const HEADER_TEXT_DEFAULT = '#1f2937';
  const DEFAULT_BORDER = '#e6e7e9';
  const headerTopBg = accent1Hex;
  const headerTopText = HEADER_TEXT_DEFAULT;
  const topMenuBg = accent1Hex;
  const topMenuLink = HEADER_TEXT_DEFAULT;
  const topMenuDropdownBg = accent1Hex;
  const topMenuDropdownLink = HEADER_TEXT_DEFAULT;
  const topMenuDropdownIcon = HEADER_TEXT_DEFAULT;
  const topMenuBorderColor = DEFAULT_BORDER;
  const settingsBg = accent1Hex;
  const settingsText = HEADER_TEXT_DEFAULT;
  const settingsBorderColor = DEFAULT_BORDER;
  const onlineBg = accent1Hex;
  const onlineText = HEADER_TEXT_DEFAULT;
  const onlineBorderColor = DEFAULT_BORDER;

  // Radius/font/base (Tabler variables) from global theme defaults.
  const RADIUS_MAP = { '0': '0', '0.5': '.25rem', '1': '.375rem', '1.5': '.5rem', '2': '2rem' };
  const radiusVal = RADIUS_MAP[String(radiusKey || '').trim()] || '';
  const FONT_MAP = {
    sans: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    comic: '"Comic Sans MS", "Comic Sans", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  };
  const fontVal = FONT_MAP[String(fontKey || '').trim()] || '';
  const BASES = {
    slate: { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617' },
    gray: { 50:'#f9fafb',100:'#f3f4f6',200:'#e5e7eb',300:'#d1d5db',400:'#9ca3af',500:'#6b7280',600:'#4b5563',700:'#374151',800:'#1f2937',900:'#111827',950:'#030712' },
    zinc: { 50:'#fafafa',100:'#f4f4f5',200:'#e4e4e7',300:'#d4d4d8',400:'#a1a1aa',500:'#71717a',600:'#52525b',700:'#3f3f46',800:'#27272a',900:'#18181b',950:'#09090b' },
    neutral: { 50:'#fafafa',100:'#f5f5f5',200:'#e5e5e5',300:'#d4d4d4',400:'#a3a3a3',500:'#737373',600:'#525252',700:'#404040',800:'#262626',900:'#171717',950:'#0a0a0a' },
    stone: { 50:'#fafaf9',100:'#f5f5f4',200:'#e7e5e4',300:'#d6d3d1',400:'#a8a29e',500:'#78716c',600:'#57534e',700:'#44403c',800:'#292524',900:'#1c1917',950:'#0c0a09' },
  };
  const basePalette = BASES[String(baseKey || '').trim()] || null;

  const radiusLines = (() => {
    if (!radiusVal) return '';
    const sm = radiusVal === '0' ? '0' : `calc(${radiusVal} * .75)`;
    const lg = radiusVal === '0' ? '0' : `calc(${radiusVal} * 1.5)`;
    const xl = radiusVal === '0' ? '0' : `calc(${radiusVal} * 3)`;
    return [
      `--tblr-border-radius:${radiusVal};`,
      `--tblr-border-radius-sm:${sm};`,
      `--tblr-border-radius-lg:${lg};`,
      `--tblr-border-radius-xl:${xl};`,
      `--radius:${radiusVal};`,
    ].join('\n');
  })();

  const fontLines = fontVal ? [`--tblr-font-sans-serif:${fontVal};`, `--bs-body-font-family:${fontVal};`].join('\n') : '';

  const rawIconSize = iconSize != null ? String(iconSize).trim() : '';
  const safeIconSize = rawIconSize && rawIconSize.length < 32 && !/[;{}\r\n]/.test(rawIconSize) ? rawIconSize : '';
  const safeIconColor = normalizeCssColor(iconColor, '');

  const baseLines = basePalette ? Object.keys(basePalette).map((k) => `--tblr-gray-${k}:${basePalette[k]};`) : [];

  let cssVarOverridesV1 = defaultCssVarOverridesV1();
  try {
    const rawOverrides = await store.getSetting(CSS_VAR_OVERRIDES_V1_KEY);
    cssVarOverridesV1 = normalizeCssVarOverridesV1(rawOverrides);
  } catch (_) {
    cssVarOverridesV1 = defaultCssVarOverridesV1();
  }
  const overrideLines = [];
  try {
    const vars = cssVarOverridesV1 && cssVarOverridesV1.vars && typeof cssVarOverridesV1.vars === 'object' ? cssVarOverridesV1.vars : {};
    const allow = (colorSchemeMap && typeof colorSchemeMap.cssVarOverrideAllowlist === 'function')
      ? colorSchemeMap.cssVarOverrideAllowlist()
      : null;
    const dead = new Set(Array.isArray(colorSchemeMap && colorSchemeMap.deadCssVars) ? colorSchemeMap.deadCssVars : []);
    for (const name of Object.keys(vars)) {
      const safeName = normalizeCssVarName(name);
      if (!safeName) continue;
      if (dead.has(safeName)) continue;
      if (allow && !allow.has(safeName)) continue;
      if (!kpiSeparatePalettes && colorSchemeMap && typeof colorSchemeMap.isKpiPerSectionVar === 'function' && colorSchemeMap.isKpiPerSectionVar(safeName)) continue;
      const isOpaque = !!(colorSchemeMap && typeof colorSchemeMap.isOpaqueVar === 'function' && colorSchemeMap.isOpaqueVar(safeName));
      const safeVal = isOpaque ? normalizeOpaqueCssColor(vars[name], '') : normalizeCssVarOverrideValue(vars[name]);
      if (!safeVal) continue;
      overrideLines.push(`${safeName}:${safeVal};`);
    }
  } catch (_) {}

  const css = [
    '/* KEXO: server-injected theme variables (header + top menu) */',
    ':root{',
    `--kexo-accent-1:${accent1Hex};`,
    `--kexo-accent-2:${accent2Hex};`,
    `--kexo-accent-3:${accent3Hex};`,
    `--kexo-accent-4:${accent4Hex};`,
    `--kexo-accent-5:${accent5Hex};`,
    `--kexo-accent-6:${accent6Hex};`,
    `--tblr-primary:${accent1Hex};`,
    `--tblr-primary-rgb:${primaryRgb};`,
    `--kexo-header-strip-padding:${stripPadding && stripPadding.length < 80 ? stripPadding : '0 5px'};`,
    `--kexo-header-top-bg:${headerTopBg};`,
    `--kexo-header-top-text-color:${headerTopText};`,
    `--kexo-top-menu-bg:${topMenuBg};`,
    `--kexo-top-menu-link-color:${topMenuLink};`,
    `--kexo-top-menu-dropdown-bg:${topMenuDropdownBg};`,
    `--kexo-top-menu-dropdown-link-color:${topMenuDropdownLink};`,
    `--kexo-top-menu-dropdown-icon-color:${topMenuDropdownIcon};`,
    `--kexo-top-menu-border-width:${mainBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-top-menu-border-color:${mainBorder === 'hide' ? 'transparent' : topMenuBorderColor};`,
    `--kexo-top-menu-shadow:${normalizeCssShadow(mainShadow, FALLBACKS.theme_header_main_shadow)};`,

    `--kexo-header-settings-bg:${settingsBg};`,
    `--kexo-header-settings-text-color:${settingsText};`,
    `--kexo-header-settings-radius:${normalizeCssRadius(settingsRadius, FALLBACKS.theme_header_settings_radius)};`,
    `--kexo-header-settings-border-width:${settingsBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-header-settings-border-color:${settingsBorderColor};`,
    `--kexo-header-settings-label-display:${labelMode === 'hide' ? 'none' : 'inline'};`,
    `--kexo-header-settings-icon-gap:${labelMode === 'hide' ? '0' : '.35rem'};`,
    radiusLines,
    fontLines,
    (safeIconSize ? `--kexo-theme-icon-size:${safeIconSize};` : ''),
    (safeIconColor ? `--kexo-theme-icon-color:${safeIconColor};` : ''),
    ...baseLines,

    (() => {
      const hovOp = Math.min(100, Math.max(0, parseFloat(menuHoverOpacity) || 0)) / 100;
      const isWhite = String(menuHoverColor || '').trim().toLowerCase() === 'white';
      const r = isWhite ? 255 : 0;
      const g = isWhite ? 255 : 0;
      const b = isWhite ? 255 : 0;
      return `--kexo-menu-hover-bg:rgba(${r},${g},${b},${hovOp.toFixed(2)});`;
    })(),

    `--kexo-header-online-bg:${onlineBg};`,
    `--kexo-header-online-text-color:${onlineText};`,
    `--kexo-header-online-radius:${normalizeCssRadius(onlineRadius, FALLBACKS.theme_header_online_radius)};`,
    `--kexo-header-online-border-width:${onlineBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-header-online-border-color:${onlineBorderColor};`,
    ...overrideLines,
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

    // Optional: hide ALL charts on mobile. This is controlled by the html class so it can
    // toggle at runtime (no reload) and so per-chart disabled rules still work normally.
    rules.push('@media (max-width: 991.98px){html.kexo-hide-charts-mobile [data-kexo-chart-key]{display:none!important;}}');

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
      profit: 'cond-kpi-profit-sparkline',
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
      profit: 'dash-kpi-profit',
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
      kexo_score: 'dash-kpi-kexo-score',
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
      // Dashboard cards are direct children of #dash-kpi-grid, #dash-kpi-grid-mid, or #dash-kpi-grid-lower.
      rules.push(`#dash-kpi-grid > .col-sm-6:has(#${valueId}),#dash-kpi-grid-mid > .col-sm-6:has(#${valueId}),#dash-kpi-grid-lower > .col-sm-6:has(#${valueId}){display:none!important;}`);
    });

    if (rules.length) {
      kpisCss = ['/* KEXO: server-injected KPI visibility */', ...rules, ''].join('\n');
    }
  } catch (_) {}

  res.setHeader('Cache-Control', 'no-store');
  let themeCustomCss = '';
  try {
    const raw = await getThemeKey('theme_custom_css', '');
    const txt = raw != null ? String(raw) : '';
    if (txt.trim()) {
      themeCustomCss = ['/* KEXO: theme custom css */', txt.trim(), ''].join('\n');
    }
  } catch (_) {
    themeCustomCss = '';
  }

  const extraCss = [chartsCss, kpisCss, themeCustomCss].filter(Boolean).join('\n');
  res.type('text/css').send(css + (extraCss ? ('\n' + extraCss) : ''));
}

const CHART_SETTINGS_BODY_LIMIT = 80000;

function isOnlineMapChartKey(key) {
  const k = String(key || '').trim().toLowerCase();
  return k === 'live-online-chart' || k === 'countries-map-chart';
}

function pickSharedOnlineMapStyleFields(style) {
  const s = style && typeof style === 'object' ? style : {};
  const out = {};
  [
    'fillOpacity',
    'mapShowTooltip',
    'mapDraggable',
    'mapZoomButtons',
    'mapShowEmptyCaption',
    'mapFit',
    'mapInactiveOpacity',
    'mapInactiveColor',
    'mapStageBrowseColor',
    'mapStageCartColor',
    'mapStageCheckoutColor',
    'mapStagePurchaseColor',
  ].forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(s, k)) out[k] = s[k];
  });
  return out;
}

async function getChartSettings(req, res) {
  try {
    const chartKey = (req.params.chartKey || '').trim().toLowerCase();
    if (!chartKey || !CHART_UI_KEY_SET.has(chartKey)) {
      return res.status(400).json({ ok: false, error: 'Invalid chart key' });
    }
    const raw = await store.getSetting(CHARTS_UI_CONFIG_V1_KEY);
    const cfg = normalizeChartsUiConfigV1(raw);
    const def = defaultChartsUiConfigV1();
    const entry = (cfg.charts || []).find((c) => c && c.key === chartKey);
    const defaultEntry = (def.charts || []).find((c) => c && c.key === chartKey) || {
      key: chartKey,
      label: chartKey,
      enabled: true,
      mode: 'line',
      sizePercent: 100,
      colors: ['#3eb3ab'],
      style: defaultChartStyleConfig(),
      advancedApexOverride: {},
    };
    let settings = entry || defaultEntry;
    // Online map settings are shared across /live, /overview, /countries.
    if (isOnlineMapChartKey(chartKey)) {
      const liveKey = 'live-online-chart';
      const liveEntry = (cfg.charts || []).find((c) => c && c.key === liveKey) || (def.charts || []).find((c) => c && c.key === liveKey) || null;
      const src = liveEntry || settings;
      const sharedStyle = pickSharedOnlineMapStyleFields(src && src.style);
      const mergedStyle = { ...(settings.style || defaultChartStyleConfig()), ...sharedStyle };
      const mergedColors = Array.isArray(src && src.colors) && src.colors.length ? src.colors : settings.colors;
      settings = { ...settings, colors: mergedColors, style: mergedStyle };
    }
    return res.json({ ok: true, chartKey, settings });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? String(e.message) : 'Failed to load chart settings' });
  }
}

async function putChartSettings(req, res) {
  try {
    const chartKey = (req.params.chartKey || '').trim().toLowerCase();
    if (!chartKey || !CHART_UI_KEY_SET.has(chartKey)) {
      return res.status(400).json({ ok: false, error: 'Invalid chart key' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const settings = body.settings && typeof body.settings === 'object' ? body.settings : {};
    const raw = await store.getSetting(CHARTS_UI_CONFIG_V1_KEY);
    const cfg = normalizeChartsUiConfigV1(raw);
    const def = defaultChartsUiConfigV1();
    const defEntry = (def.charts || []).find((c) => c && c.key === chartKey);
    const existingIdx = (cfg.charts || []).findIndex((c) => c && c.key === chartKey);
    const merged = { ...(existingIdx >= 0 ? cfg.charts[existingIdx] : defEntry), ...settings };
    const normalizedList = normalizeChartsList([merged], def.charts || [], {});
    const normalizedOne = normalizedList[0];
    if (!normalizedOne || normalizedOne.key !== chartKey) {
      return res.status(400).json({ ok: false, error: 'Normalization failed' });
    }
    const nextCharts = [...(cfg.charts || [])];
    if (existingIdx >= 0) nextCharts[existingIdx] = normalizedOne;
    else nextCharts.push(normalizedOne);

    // Keep Online map settings shared between live-online-chart and countries-map-chart.
    if (isOnlineMapChartKey(chartKey)) {
      const siblingKey = chartKey === 'live-online-chart' ? 'countries-map-chart' : 'live-online-chart';
      const siblingIdx = nextCharts.findIndex((c) => c && c.key === siblingKey);
      const siblingDef = (def.charts || []).find((c) => c && c.key === siblingKey) || null;
      const siblingBase = siblingIdx >= 0 ? nextCharts[siblingIdx] : siblingDef;
      if (siblingBase) {
        const sharedStyle = pickSharedOnlineMapStyleFields(normalizedOne.style);
        const siblingMerged = {
          ...siblingBase,
          colors: Array.isArray(normalizedOne.colors) ? normalizedOne.colors.slice() : siblingBase.colors,
          style: { ...(siblingBase.style || defaultChartStyleConfig()), ...sharedStyle },
        };
        const sibNormalized = normalizeChartsList([siblingMerged], def.charts || [], {})[0];
        if (sibNormalized && sibNormalized.key === siblingKey) {
          if (siblingIdx >= 0) nextCharts[siblingIdx] = sibNormalized;
          else nextCharts.push(sibNormalized);
        }
      }
    }

    const nextCfg = { ...cfg, charts: nextCharts };
    const json = JSON.stringify(nextCfg);
    if (json.length > CHART_SETTINGS_BODY_LIMIT) {
      return res.status(413).json({ ok: false, error: 'Chart config too large' });
    }
    await store.setSetting(CHARTS_UI_CONFIG_V1_KEY, json);
    return res.json({ ok: true, chartsUiConfig: nextCfg });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message ? String(e.message) : 'Failed to save chart settings' });
  }
}

module.exports = {
  getSettings,
  postSettings,
  getProfitRules,
  putProfitRules,
  getChartSettings,
  putChartSettings,
  normalizePixelSessionMode,
  PIXEL_SESSION_MODE_KEY,
  getThemeDefaults,
  postThemeDefaults,
  getThemeVarsCss,
  THEME_KEYS,
  THEME_ICON_GLYPH_KEYS,
};

