/**
 * GET/POST /api/settings
 *
 * Small authenticated settings surface for the dashboard (stored in DB settings table).
 * Currently used to toggle pixel session strategy for debugging session count drift.
 */
const store = require('../store');

const PIXEL_SESSION_MODE_KEY = 'pixel_session_mode'; // legacy | shared_ttl
const ASSET_OVERRIDES_KEY = 'asset_overrides'; // JSON object
const KPI_UI_CONFIG_V1_KEY = 'kpi_ui_config_v1'; // JSON object (KPIs + date ranges + options)

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

async function readSettingsPayload() {
  let pixelSessionMode = 'legacy';
  let assetOverrides = {};
  let kpiUiConfig = defaultKpiUiConfigV1();
  try {
    pixelSessionMode = normalizePixelSessionMode(await store.getSetting(PIXEL_SESSION_MODE_KEY));
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
  const reporting = await store.getReportingConfig().catch(() => ({ ordersSource: 'orders_shopify', sessionsSource: 'sessions' }));
  return {
    ok: true,
    pixelSessionMode,
    sharedSessionTtlMinutes: 30,
    assetOverrides,
    reporting,
    kpiUiConfig,
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
  'theme_header_main_bg',
  'theme_header_link_color',
  'theme_header_settings_label',
  'theme_header_settings_border',
  'theme_header_settings_border_color',
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
  'theme_icon_glyph_settings_tab_general',
  'theme_icon_glyph_settings_tab_theme',
  'theme_icon_glyph_settings_tab_assets',
  'theme_icon_glyph_settings_tab_data_reporting',
  'theme_icon_glyph_settings_tab_integrations',
  'theme_icon_glyph_settings_tab_sources',
  'theme_icon_glyph_settings_tab_kpis',
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
    for (const key of THEME_KEYS) {
      const val = body[key] != null ? String(body[key]).trim() : '';
      await store.setSetting('theme_' + key, val);
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? String(err.message) : 'Failed to save theme' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
}

module.exports = {
  getSettings,
  postSettings,
  normalizePixelSessionMode,
  PIXEL_SESSION_MODE_KEY,
  getThemeDefaults,
  postThemeDefaults,
};

