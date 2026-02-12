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
  validateConfigStructure,
  validateConfigAgainstVariants,
} = require('../variantInsightsConfig');
const { getObservedVariantsForValidation } = require('../variantInsightsService');

const PIXEL_SESSION_MODE_KEY = 'pixel_session_mode'; // legacy | shared_ttl
const ASSET_OVERRIDES_KEY = 'asset_overrides'; // JSON object
const KPI_UI_CONFIG_V1_KEY = 'kpi_ui_config_v1'; // JSON object (KPIs + date ranges + options)
const CHARTS_UI_CONFIG_V1_KEY = 'charts_ui_config_v1'; // JSON object (chart type/colors/visibility)
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
  'live-online-chart': ['bar', 'line', 'area', 'multi-line-labels'],
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
      { key: 'live-online-chart', label: 'Dashboard · Live Online', enabled: true, mode: 'bar', colors: ['#16a34a'] },
      { key: 'sales-overview-chart', label: 'Dashboard · Sales Trend', enabled: true, mode: 'area', colors: ['#0d9488'] },
      { key: 'date-overview-chart', label: 'Dashboard · Sessions & Orders Trend', enabled: true, mode: 'area', colors: ['#4b94e4', '#f59e34'] },
      { key: 'ads-overview-chart', label: 'Integrations · Google Ads Overview', enabled: true, mode: 'combo', colors: ['#3eb3ab', '#ef4444', '#4b94e4'] },
      { key: 'channels-chart', label: 'Traffic · Channels', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions' },
      { key: 'type-chart', label: 'Traffic · Device & Platform', enabled: true, mode: 'line', colors: ['#4b94e4', '#f59e34', '#3eb3ab', '#8b5cf6', '#ef4444', '#22c55e'], pieMetric: 'sessions' },
      { key: 'products-chart', label: 'Insights · Products', enabled: true, mode: 'line', colors: ['#3eb3ab', '#4b94e4', '#f59e34', '#8b5cf6', '#ef4444', '#22c55e'] },
      { key: 'countries-map-chart', label: 'Insights · Countries Map', enabled: true, mode: 'map-animated', colors: ['#3eb3ab'] },
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

function normalizeKpiUiConfigV1(raw) {
  const def = defaultKpiUiConfigV1();
  const obj = safeJsonParseObject(raw);
  if (!obj || obj.v !== 1) return def;
  const options = obj.options && typeof obj.options === 'object' ? obj.options : {};
  const condensed = options.condensed && typeof options.condensed === 'object' ? options.condensed : {};
  const dashboard = options.dashboard && typeof options.dashboard === 'object' ? options.dashboard : {};
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
          return res.status(400).json({
            ok: false,
            error: 'insights_variants_config_invalid',
            message: 'Some variants are unmapped or ambiguous. Update aliases and try again.',
            details: {
              stage: 'coverage',
              observedCount: Array.isArray(observed) ? observed.length : 0,
              tables: coverageValidation.tables || [],
            },
          });
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
  res.json(await readSettingsPayload());
}

// ── Theme defaults (shared across all logins) ──────────────────────────────
// Must match the keys used by `server/public/theme-settings.js` (hyphens converted to underscores).
const THEME_KEYS = [
  'theme',
  'theme_primary',
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
  'theme_header_settings_menu_bg',
  'theme_header_settings_menu_link_color',
  'theme_header_settings_menu_icon_color',
  'theme_header_settings_menu_border_color',
  'theme_header_settings_menu_radius',
  'theme_header_online_bg',
  'theme_header_online_text_color',
  'theme_header_online_radius',
  'theme_header_online_border',
  'theme_header_online_border_color',
  'theme_header_logo_url',
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
    theme_header_top_bg: '#ffffff',
    theme_header_top_text_color: '#1f2937',
    theme_header_main_bg: '#ffffff',
    theme_header_main_link_color: '#1f2937',
    theme_header_main_dropdown_bg: '#ffffff',
    theme_header_main_dropdown_link_color: '#1f2937',
    theme_header_main_dropdown_icon_color: '#1f2937',
    theme_header_main_border: 'show',
    theme_header_main_border_color: '#e6e7e9',
    theme_header_main_shadow: '2px 2px 2px #eee',
    theme_header_settings_label: 'show',
    theme_header_settings_bg: '#ffffff',
    theme_header_settings_text_color: '#1f2937',
    theme_header_settings_radius: '.375rem',
    theme_header_settings_border: 'show',
    theme_header_settings_border_color: '#e6e7e9',
    theme_header_settings_menu_bg: '#ffffff',
    theme_header_settings_menu_link_color: '#1f2937',
    theme_header_settings_menu_icon_color: '#1f2937',
    theme_header_settings_menu_border_color: '#e6e7e9',
    theme_header_settings_menu_radius: '.375rem',
    theme_header_online_bg: '#f8fafc',
    theme_header_online_text_color: '#1f2937',
    theme_header_online_radius: '.375rem',
    theme_header_online_border: 'show',
    theme_header_online_border_color: '#e6e7e9',
  };

  function getThemeKey(key, fallback) {
    // Theme defaults are stored under `theme_${key}` (see /api/theme-defaults).
    return store.getSetting('theme_' + key).then((v) => {
      const raw = v == null ? '' : String(v).trim();
      return raw ? raw : fallback;
    }).catch(() => fallback);
  }

  const [
    topBg,
    topText,
    mainBg,
    mainLink,
    ddBg,
    ddLink,
    ddIcon,
    mainBorderMode,
    mainBorderColor,
    mainShadow,
    settingsLabelMode,
    settingsBg,
    settingsText,
    settingsRadius,
    settingsBorderMode,
    settingsBorderColor,
    settingsMenuBg,
    settingsMenuLink,
    settingsMenuIcon,
    settingsMenuBorderColor,
    settingsMenuRadius,
    onlineBg,
    onlineText,
    onlineRadius,
    onlineBorderMode,
    onlineBorderColor,
  ] = await Promise.all([
    getThemeKey('theme_header_top_bg', FALLBACKS.theme_header_top_bg),
    getThemeKey('theme_header_top_text_color', FALLBACKS.theme_header_top_text_color),
    getThemeKey('theme_header_main_bg', FALLBACKS.theme_header_main_bg),
    getThemeKey('theme_header_main_link_color', FALLBACKS.theme_header_main_link_color),
    getThemeKey('theme_header_main_dropdown_bg', FALLBACKS.theme_header_main_dropdown_bg),
    getThemeKey('theme_header_main_dropdown_link_color', FALLBACKS.theme_header_main_dropdown_link_color),
    getThemeKey('theme_header_main_dropdown_icon_color', FALLBACKS.theme_header_main_dropdown_icon_color),
    getThemeKey('theme_header_main_border', FALLBACKS.theme_header_main_border),
    getThemeKey('theme_header_main_border_color', FALLBACKS.theme_header_main_border_color),
    getThemeKey('theme_header_main_shadow', FALLBACKS.theme_header_main_shadow),
    getThemeKey('theme_header_settings_label', FALLBACKS.theme_header_settings_label),
    getThemeKey('theme_header_settings_bg', FALLBACKS.theme_header_settings_bg),
    getThemeKey('theme_header_settings_text_color', FALLBACKS.theme_header_settings_text_color),
    getThemeKey('theme_header_settings_radius', FALLBACKS.theme_header_settings_radius),
    getThemeKey('theme_header_settings_border', FALLBACKS.theme_header_settings_border),
    getThemeKey('theme_header_settings_border_color', FALLBACKS.theme_header_settings_border_color),
    getThemeKey('theme_header_settings_menu_bg', FALLBACKS.theme_header_settings_menu_bg),
    getThemeKey('theme_header_settings_menu_link_color', FALLBACKS.theme_header_settings_menu_link_color),
    getThemeKey('theme_header_settings_menu_icon_color', FALLBACKS.theme_header_settings_menu_icon_color),
    getThemeKey('theme_header_settings_menu_border_color', FALLBACKS.theme_header_settings_menu_border_color),
    getThemeKey('theme_header_settings_menu_radius', FALLBACKS.theme_header_settings_menu_radius),
    getThemeKey('theme_header_online_bg', FALLBACKS.theme_header_online_bg),
    getThemeKey('theme_header_online_text_color', FALLBACKS.theme_header_online_text_color),
    getThemeKey('theme_header_online_radius', FALLBACKS.theme_header_online_radius),
    getThemeKey('theme_header_online_border', FALLBACKS.theme_header_online_border),
    getThemeKey('theme_header_online_border_color', FALLBACKS.theme_header_online_border_color),
  ]);

  const mainBorder = normalizeCssToggle(mainBorderMode, 'show');
  const settingsBorder = normalizeCssToggle(settingsBorderMode, 'show');
  const onlineBorder = normalizeCssToggle(onlineBorderMode, 'show');
  const labelMode = normalizeCssToggle(settingsLabelMode, 'show');

  const css = [
    '/* KEXO: server-injected theme variables (header + top menu) */',
    ':root{',
    `--kexo-header-top-bg:${normalizeCssColor(topBg, FALLBACKS.theme_header_top_bg)};`,
    `--kexo-header-top-text-color:${normalizeCssColor(topText, FALLBACKS.theme_header_top_text_color)};`,
    `--kexo-header-main-bg:${normalizeCssColor(mainBg, FALLBACKS.theme_header_main_bg)};`,
    `--kexo-top-menu-bg:${normalizeCssColor(mainBg, FALLBACKS.theme_header_main_bg)};`,
    `--kexo-top-menu-link-color:${normalizeCssColor(mainLink, FALLBACKS.theme_header_main_link_color)};`,
    `--kexo-top-menu-dropdown-bg:${normalizeCssColor(ddBg, FALLBACKS.theme_header_main_dropdown_bg)};`,
    `--kexo-top-menu-dropdown-link-color:${normalizeCssColor(ddLink, FALLBACKS.theme_header_main_dropdown_link_color)};`,
    `--kexo-top-menu-dropdown-icon-color:${normalizeCssColor(ddIcon, FALLBACKS.theme_header_main_dropdown_icon_color)};`,
    `--kexo-top-menu-border-width:${mainBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-top-menu-border-color:${normalizeCssColor(mainBorderColor, FALLBACKS.theme_header_main_border_color)};`,
    `--kexo-top-menu-shadow:${normalizeCssShadow(mainShadow, FALLBACKS.theme_header_main_shadow)};`,

    `--kexo-header-settings-bg:${normalizeCssColor(settingsBg, FALLBACKS.theme_header_settings_bg)};`,
    `--kexo-header-settings-text-color:${normalizeCssColor(settingsText, FALLBACKS.theme_header_settings_text_color)};`,
    `--kexo-header-settings-radius:${normalizeCssRadius(settingsRadius, FALLBACKS.theme_header_settings_radius)};`,
    `--kexo-header-settings-border-width:${settingsBorder === 'hide' ? '0px' : '1px'};`,
    `--kexo-header-settings-border-color:${normalizeCssColor(settingsBorderColor, FALLBACKS.theme_header_settings_border_color)};`,
    `--kexo-header-settings-label-display:${labelMode === 'hide' ? 'none' : 'inline'};`,
    `--kexo-header-settings-icon-gap:${labelMode === 'hide' ? '0' : '.35rem'};`,

    `--kexo-header-settings-menu-bg:${normalizeCssColor(settingsMenuBg, FALLBACKS.theme_header_settings_menu_bg)};`,
    `--kexo-header-settings-menu-link-color:${normalizeCssColor(settingsMenuLink, FALLBACKS.theme_header_settings_menu_link_color)};`,
    `--kexo-header-settings-menu-icon-color:${normalizeCssColor(settingsMenuIcon, FALLBACKS.theme_header_settings_menu_icon_color)};`,
    `--kexo-header-settings-menu-border-color:${normalizeCssColor(settingsMenuBorderColor, FALLBACKS.theme_header_settings_menu_border_color)};`,
    `--kexo-header-settings-menu-radius:${normalizeCssRadius(settingsMenuRadius, FALLBACKS.theme_header_settings_menu_radius)};`,

    `--kexo-header-online-bg:${normalizeCssColor(onlineBg, FALLBACKS.theme_header_online_bg)};`,
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

  res.setHeader('Cache-Control', 'no-store');
  res.type('text/css').send(css + (chartsCss ? ('\n' + chartsCss) : ''));
}

module.exports = {
  getSettings,
  postSettings,
  normalizePixelSessionMode,
  PIXEL_SESSION_MODE_KEY,
  getThemeDefaults,
  postThemeDefaults,
  getThemeVarsCss,
};

