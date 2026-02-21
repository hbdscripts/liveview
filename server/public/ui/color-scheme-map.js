/* KEXO: Color Scheme mapping (single source of truth)
   - Used by Settings → General → Icons & assets → Color Scheme UI
   - Used by server theme-vars output to filter/normalize overrides + migrate legacy keys
*/

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KexoColorSchemeMap = factory();
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  const TABS = {
    colors: { id: 'colors', label: 'Colours' },
    layout: { id: 'layout', label: 'Layout & Styling' },
  };

  const COLOR_ACCORDIONS = {
    accents: { id: 'theme-accents', label: 'Theme Accents', defaultOpen: true },
    headerNav: { id: 'header-nav', label: 'Header & Navigation', defaultOpen: false },
    kpis: { id: 'kpis', label: 'KPIs', defaultOpen: false },
    tabler: { id: 'tabler-semantic', label: 'Tabler Semantic', defaultOpen: false },
    feature: { id: 'feature-tokens', label: 'Feature Tokens', defaultOpen: false },
    grays: { id: 'advanced-grays', label: 'Advanced Grays', defaultOpen: false, advanced: true },
  };

  const LAYOUT_ACCORDIONS = {
    headerNav: { id: 'layout-header-nav', label: 'Header & Navigation', defaultOpen: true },
    corners: { id: 'layout-corners', label: 'Corners', defaultOpen: false },
    customCss: { id: 'layout-custom-css', label: 'Custom CSS', defaultOpen: false },
  };

  // Theme keys (server uses underscores; client uses hyphens).
  const THEME_ACCENT_KEYS = [
    { themeKeyUnderscore: 'theme_accent_1', themeKeyHyphen: 'theme-accent-1', label: 'Accent 1', cssVars: ['--kexo-accent-1', '--kexo-accent-1-rgb'] },
    { themeKeyUnderscore: 'theme_accent_2', themeKeyHyphen: 'theme-accent-2', label: 'Accent 2', cssVars: ['--kexo-accent-2', '--kexo-accent-2-rgb'] },
    { themeKeyUnderscore: 'theme_accent_3', themeKeyHyphen: 'theme-accent-3', label: 'Accent 3', cssVars: ['--kexo-accent-3', '--kexo-accent-3-rgb'] },
    { themeKeyUnderscore: 'theme_accent_4', themeKeyHyphen: 'theme-accent-4', label: 'Accent 4', cssVars: ['--kexo-accent-4', '--kexo-accent-4-rgb'] },
    { themeKeyUnderscore: 'theme_accent_5', themeKeyHyphen: 'theme-accent-5', label: 'Accent 5', cssVars: ['--kexo-accent-5', '--kexo-accent-5-rgb'] },
    { themeKeyUnderscore: 'theme_accent_6', themeKeyHyphen: 'theme-accent-6', label: 'Accent 6', cssVars: ['--kexo-accent-6', '--kexo-accent-6-rgb'] },
  ];

  // CSS variable overrides stored under css_var_overrides_v1 (key is the CSS custom property name).
  // "Leave blank" => variable is unset (not emitted into theme-vars.css).
  const CSS_VAR_OVERRIDES = [
    // Header & Navigation
    { key: '--kexo-header-top-bg', label: 'Top Bar background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id, opaque: true },
    { key: '--kexo-header-top-text-color', label: 'Top Bar text', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-top-menu-bg', label: 'Top Nav background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id, opaque: true },
    { key: '--kexo-top-menu-link-color', label: 'Top Nav link', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-top-menu-dropdown-bg', label: 'Dropdown background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id, opaque: true },
    { key: '--kexo-top-menu-dropdown-link-color', label: 'Dropdown link', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-top-menu-dropdown-icon-color', label: 'Dropdown icon', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-top-menu-border-color', label: 'Top Nav border', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-header-settings-bg', label: 'Settings menu background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id, opaque: true },
    { key: '--kexo-header-settings-text-color', label: 'Settings menu text/icon', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-header-settings-border-color', label: 'Settings menu border', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-header-online-bg', label: 'Online badge background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id, opaque: true },
    { key: '--kexo-header-online-text-color', label: 'Online badge text/icon', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },
    { key: '--kexo-header-online-border-color', label: 'Online badge border', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.headerNav.id },

    // KPIs (base palette)
    { key: '--kexo-kpi-delta-up', label: 'KPI Delta Up', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id },
    { key: '--kexo-kpi-delta-same', label: 'KPI Delta Same', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id },
    { key: '--kexo-kpi-delta-down', label: 'KPI Delta Down', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id },
    { key: '--kexo-kpi-compare-line', label: 'KPI Compare Line', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id },

    // KPIs (per-section overrides, advanced)
    { key: '--kexo-dashboard-kpi-up', label: 'Dashboard: Delta Up', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-dashboard-kpi-same', label: 'Dashboard: Delta Same', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-dashboard-kpi-down', label: 'Dashboard: Delta Down', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-dashboard-kpi-compare-line', label: 'Dashboard: Compare Line', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-header-kpi-up', label: 'Header: Delta Up', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-header-kpi-same', label: 'Header: Delta Same', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-header-kpi-down', label: 'Header: Delta Down', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-header-kpi-compare-line', label: 'Header: Compare Line', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-snapshot-kpi-up', label: 'Snapshot: Delta Up', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-snapshot-kpi-same', label: 'Snapshot: Delta Same', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-snapshot-kpi-down', label: 'Snapshot: Delta Down', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },
    { key: '--kexo-snapshot-kpi-compare-line', label: 'Snapshot: Compare Line', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.kpis.id, advanced: true },

    // Tabler semantic
    { key: '--tblr-primary', label: 'Primary', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-success', label: 'Success', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-warning', label: 'Warning', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-danger', label: 'Danger', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-secondary', label: 'Secondary', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-secondary-color', label: 'Secondary text', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-body-color', label: 'Body text', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-body-bg', label: 'Page background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id, opaque: true },
    { key: '--tblr-border-color', label: 'Border', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-bg-surface', label: 'Surface', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id, opaque: true },
    { key: '--tblr-bg-surface-secondary', label: 'Surface secondary', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id, opaque: true },
    { key: '--tblr-link-color', label: 'Link', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-muted', label: 'Muted text', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-disabled-color', label: 'Disabled', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-border-color-translucent', label: 'Border (translucent)', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id },
    { key: '--tblr-card-bg', label: 'Card background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.tabler.id, opaque: true },

    // Feature tokens
    { key: '--converted-bg', label: 'Converted row background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id, opaque: true },
    { key: '--converted-hover', label: 'Converted row hover background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id, opaque: true },
    { key: '--returning-bg', label: 'Returning row background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id, opaque: true },
    { key: '--badge-returning', label: 'Returning badge', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id },
    { key: '--chip-abandoned', label: 'Abandoned chip', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id },
    { key: '--online-dot-color', label: 'Online pulse dot', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id },
    { key: '--link-fg', label: 'Table link foreground', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id },
    { key: '--side-panel-sale-bg', label: 'Side panel sale background', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id },
    { key: '--top-bar-divider', label: 'Top Bar divider', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.feature.id },

    // Advanced grays (manual overrides)
    { key: '--tblr-gray-50', label: 'Gray 50', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-100', label: 'Gray 100', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-200', label: 'Gray 200', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-300', label: 'Gray 300', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-400', label: 'Gray 400', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-500', label: 'Gray 500', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-600', label: 'Gray 600', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-700', label: 'Gray 700', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-800', label: 'Gray 800', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-900', label: 'Gray 900', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
    { key: '--tblr-gray-950', label: 'Gray 950', tab: TABS.colors.id, accordion: COLOR_ACCORDIONS.grays.id, advanced: true, opaque: true },
  ];

  // Layout/styling theme keys (not stored in css_var_overrides_v1).
  const LAYOUT_THEME_KEYS = [
    { themeKeyUnderscore: 'theme_header_strip_padding', themeKeyHyphen: 'theme-header-strip-padding', label: 'Top Bar padding', tab: TABS.layout.id, accordion: LAYOUT_ACCORDIONS.headerNav.id, cssVars: ['--kexo-header-strip-padding'] },
    { themeKeyUnderscore: 'theme_header_main_shadow', themeKeyHyphen: 'theme-header-main-shadow', label: 'Top Nav box-shadow', tab: TABS.layout.id, accordion: LAYOUT_ACCORDIONS.headerNav.id, cssVars: ['--kexo-top-menu-shadow'] },
    { themeKeyUnderscore: 'theme_menu_hover_opacity', themeKeyHyphen: 'theme-menu-hover-opacity', label: 'Menu hover opacity', tab: TABS.layout.id, accordion: LAYOUT_ACCORDIONS.headerNav.id, cssVars: ['--kexo-menu-hover-bg'] },
    { themeKeyUnderscore: 'theme_menu_hover_color', themeKeyHyphen: 'theme-menu-hover-color', label: 'Menu hover tint', tab: TABS.layout.id, accordion: LAYOUT_ACCORDIONS.headerNav.id, cssVars: ['--kexo-menu-hover-bg'] },
    { themeKeyUnderscore: 'theme_radius', themeKeyHyphen: 'theme-radius', label: 'Corner radius', tab: TABS.layout.id, accordion: LAYOUT_ACCORDIONS.corners.id, cssVars: ['--tblr-border-radius'] },
    { themeKeyUnderscore: 'theme_custom_css', themeKeyHyphen: 'theme-custom-css', label: 'Custom CSS', tab: TABS.layout.id, accordion: LAYOUT_ACCORDIONS.customCss.id, cssVars: [] },
  ];

  const KPI_SEPARATE_PALETTES_KEY = {
    themeKeyUnderscore: 'theme_kpi_separate_palettes',
    themeKeyHyphen: 'theme-kpi-separate-palettes',
  };

  // Legacy theme keys (global theme defaults) that previously controlled header/nav colors.
  // We now treat these as css_var_overrides entries (same outputs), and delete the old theme keys.
  const LEGACY_THEME_COLOR_KEYS_TO_CSS_VARS = {
    theme_header_top_bg: '--kexo-header-top-bg',
    theme_header_top_text_color: '--kexo-header-top-text-color',
    theme_header_main_bg: '--kexo-top-menu-bg',
    theme_header_main_link_color: '--kexo-top-menu-link-color',
    theme_header_main_dropdown_bg: '--kexo-top-menu-dropdown-bg',
    theme_header_main_dropdown_link_color: '--kexo-top-menu-dropdown-link-color',
    theme_header_main_dropdown_icon_color: '--kexo-top-menu-dropdown-icon-color',
    theme_header_main_border_color: '--kexo-top-menu-border-color',
    theme_header_settings_bg: '--kexo-header-settings-bg',
    theme_header_settings_text_color: '--kexo-header-settings-text-color',
    theme_header_settings_border_color: '--kexo-header-settings-border-color',
    theme_header_online_bg: '--kexo-header-online-bg',
    theme_header_online_text_color: '--kexo-header-online-text-color',
    theme_header_online_border_color: '--kexo-header-online-border-color',
    // Legacy shared header text key (if set) previously pushed into multiple vars.
    theme_header_link_color: null,
  };

  // CSS vars that were exposed historically but are now unused/stale.
  const DEAD_CSS_VARS = [
    '--kexo-header-main-bg', // only a fallback to top-menu-bg; remove to reduce duplication
    '--badge-new-fg',
    '--button-hover-bg',
    '--select-arrow',
  ];

  function cssVarOverrideItems() {
    return CSS_VAR_OVERRIDES.slice();
  }

  function cssVarOverrideAllowlist() {
    const out = new Set();
    CSS_VAR_OVERRIDES.forEach((it) => { if (it && it.key) out.add(it.key); });
    return out;
  }

  function isOpaqueVar(name) {
    const key = String(name || '').trim();
    const it = CSS_VAR_OVERRIDES.find((x) => x && x.key === key);
    return !!(it && it.opaque);
  }

  function isKpiPerSectionVar(name) {
    const k = String(name || '').trim();
    return (
      k.indexOf('--kexo-dashboard-kpi-') === 0 ||
      k.indexOf('--kexo-header-kpi-') === 0 ||
      k.indexOf('--kexo-snapshot-kpi-') === 0
    );
  }

  return {
    version: 1,
    tabs: TABS,
    accordions: { colors: COLOR_ACCORDIONS, layout: LAYOUT_ACCORDIONS },
    themeAccents: THEME_ACCENT_KEYS,
    cssVarOverrides: cssVarOverrideItems,
    cssVarOverrideAllowlist,
    layoutThemeKeys: LAYOUT_THEME_KEYS,
    kpiSeparatePalettesKey: KPI_SEPARATE_PALETTES_KEY,
    legacyThemeColorKeysToCssVars: LEGACY_THEME_COLOR_KEYS_TO_CSS_VARS,
    deadCssVars: DEAD_CSS_VARS.slice(),
    isOpaqueVar,
    isKpiPerSectionVar,
  };
});

