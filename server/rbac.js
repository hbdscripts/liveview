/**
 * Role-based access control: canonical permission keys and request→permission mapping.
 * Admin (role === 'admin') bypasses all checks. Non-admin users are gated by tier permissions.
 */
const VALID_TIERS = Object.freeze(['starter', 'growth', 'pro', 'scale']);
const ADMIN_ROLE = 'admin';
const LEGACY_MASTER_ROLE = 'master';

/** All permission keys that can be toggled per tier (pages + settings sections). */
const ALL_PERMISSION_KEYS = Object.freeze([
  // Dashboard pages
  'page.dashboard.overview',
  'page.dashboard.live',
  'page.dashboard.sales',
  'page.dashboard.table',
  // Insights pages
  'page.insights.snapshot',
  'page.insights.countries',
  'page.insights.products',
  'page.insights.variants',
  'page.insights.payment_methods',
  'page.insights.abandoned_carts',
  'page.insights.checkout_funnel',
  // Acquisition pages
  'page.acquisition.attribution',
  'page.acquisition.browsers',
  'page.acquisition.devices',
  // Integrations
  'page.integrations.google_ads',
  // Tools
  'page.tools.compare_conversion_rate',
  'page.tools.shipping_cr',
  'page.tools.click_order_lookup',
  'page.tools.change_pins',
  'page.tools.time_of_day',
  // Settings (general + sections)
  'page.settings',
  'settings.kexo',
  'settings.integrations',
  'settings.layout',
  'settings.attribution',
  'settings.insights',
  'settings.cost_expenses',
  // Granular settings subsections
  'settings.kexo.general',
  'settings.kexo.assets',
  'settings.kexo.icons',
  'settings.kexo.colours',
  'settings.kexo.layout_styling',
  'settings.integrations.shopify',
  'settings.integrations.google_ads',
  'settings.layout.tables',
  'settings.layout.kpis',
  'settings.layout.date_ranges',
  'settings.attribution.mapping',
  'settings.attribution.tree',
  'settings.insights.variants',
  'settings.cost_expenses.cost_sources',
  'settings.cost_expenses.shipping',
  'settings.cost_expenses.rules',
  'settings.cost_expenses.breakdown',
]);

const PERMISSION_KEY_SET = new Set(ALL_PERMISSION_KEYS);
const TIER_SET = new Set(VALID_TIERS);

/**
 * Default permissions for each non-admin tier: all true.
 * Used when seeding role_permissions and when a tier has no row.
 */
function getDefaultPermissionsForTier() {
  const perms = {};
  for (const key of ALL_PERMISSION_KEYS) {
    perms[key] = true;
  }
  return perms;
}

/**
 * Normalize and validate a permission key. Returns the key if valid, else ''.
 */
function validatePermissionKey(key) {
  if (key == null || typeof key !== 'string') return '';
  const k = key.trim();
  return PERMISSION_KEY_SET.has(k) ? k : '';
}

/**
 * Normalize and validate a tier. Returns the tier if valid, else ''.
 */
function validateTier(tier) {
  if (tier == null || typeof tier !== 'string') return '';
  const t = tier.trim().toLowerCase();
  return TIER_SET.has(t) ? t : '';
}

/**
 * Normalize user tier from DB (e.g. 'free' → 'starter' for RBAC).
 */
function normalizeUserTierForRbac(tier) {
  if (tier == null || typeof tier !== 'string') return 'starter';
  const t = tier.trim().toLowerCase();
  if (TIER_SET.has(t)) return t;
  if (t === 'free' || t === '') return 'starter';
  return 'starter';
}

/**
 * Whether the viewer is admin (always allowed).
 */
function isAdminViewer(viewer) {
  if (!viewer || typeof viewer !== 'object') return false;
  const role = (viewer.role != null && viewer.role !== '') ? String(viewer.role).trim().toLowerCase() : '';
  return role === ADMIN_ROLE || role === LEGACY_MASTER_ROLE;
}

/**
 * Get required permission keys for a request (path + method).
 * Returns { any: string[], all: string[] }. If both empty, no permission check needed.
 * Access allowed iff: every key in .all is true AND ( .any is empty OR at least one in .any is true ).
 */
function getRequiredPermissionsForRequest(req) {
  const pathname = (req && req.path) ? String(req.path) : '';
  const method = (req && req.method) ? String(req.method).toUpperCase() : '';
  const empty = { any: [], all: [] };

  // Settings subpages: require page.settings + granular subsection (all-of)
  const settingsSubMap = [
    ['/settings/kexo/general', 'settings.kexo.general'],
    ['/settings/kexo/assets', 'settings.kexo.assets'],
    ['/settings/kexo/icons', 'settings.kexo.icons'],
    ['/settings/kexo/colours', 'settings.kexo.colours'],
    ['/settings/kexo/theme-display', 'settings.kexo.colours'],
    ['/settings/kexo/layout-styling', 'settings.kexo.layout_styling'],
    ['/settings/integrations/shopify', 'settings.integrations.shopify'],
    ['/settings/integrations/googleads', 'settings.integrations.google_ads'],
    ['/settings/layout/tables', 'settings.layout.tables'],
    ['/settings/layout/kpis', 'settings.layout.kpis'],
    ['/settings/layout/date-ranges', 'settings.layout.date_ranges'],
    ['/settings/attribution/mapping', 'settings.attribution.mapping'],
    ['/settings/attribution/tree', 'settings.attribution.tree'],
    ['/settings/insights/variants', 'settings.insights.variants'],
    ['/settings/insights', 'settings.insights.variants'],
    ['/settings/cost-expenses/cost-sources', 'settings.cost_expenses.cost_sources'],
    ['/settings/cost-expenses/shipping', 'settings.cost_expenses.shipping'],
    ['/settings/cost-expenses/rules', 'settings.cost_expenses.rules'],
    ['/settings/cost-expenses/breakdown', 'settings.cost_expenses.breakdown'],
  ];
  for (const [path, perm] of settingsSubMap) {
    if (pathname === path || pathname.startsWith(path + '/') || pathname.startsWith(path + '?')) {
      return { any: [], all: ['page.settings', perm] };
    }
  }
  if (pathname === '/settings' || pathname.startsWith('/settings/') || pathname.startsWith('/settings?')) {
    return { any: ['page.settings'], all: [] };
  }

  // Page routes (exact or prefix match) — any one grants
  const pageMap = [
    ['/dashboard/overview', 'page.dashboard.overview'],
    ['/dashboard/live', 'page.dashboard.live'],
    ['/dashboard/sales', 'page.dashboard.sales'],
    ['/dashboard/table', 'page.dashboard.table'],
    ['/insights/snapshot', 'page.insights.snapshot'],
    ['/insights/countries', 'page.insights.countries'],
    ['/insights/products', 'page.insights.products'],
    ['/insights/variants', 'page.insights.variants'],
    ['/insights/payment-types', 'page.insights.payment_methods'],
    ['/insights/payment-methods', 'page.insights.payment_methods'],
    ['/insights/abandoned-carts', 'page.insights.abandoned_carts'],
    ['/insights/checkout-funnel', 'page.insights.checkout_funnel'],
    ['/acquisition/attribution', 'page.acquisition.attribution'],
    ['/acquisition/browsers', 'page.acquisition.browsers'],
    ['/acquisition/devices', 'page.acquisition.devices'],
    ['/integrations/google-ads', 'page.integrations.google_ads'],
    ['/tools/compare-conversion-rate', 'page.tools.compare_conversion_rate'],
    ['/tools/shipping-cr', 'page.tools.shipping_cr'],
    ['/tools/click-order-lookup', 'page.tools.click_order_lookup'],
    ['/tools/change-pins', 'page.tools.change_pins'],
    ['/tools/time-of-day', 'page.tools.time_of_day'],
    ['/performance', 'settings.cost_expenses'],
  ];
  for (const [path, perm] of pageMap) {
    if (pathname === path || pathname.startsWith(path + '/') || pathname.startsWith(path + '?')) {
      return { any: [perm], all: [] };
    }
  }

  // Legacy flat redirects
  const legacyPageMap = [
    ['/overview', 'page.dashboard.overview'],
    ['/live', 'page.dashboard.live'],
    ['/sales', 'page.dashboard.sales'],
    ['/date', 'page.dashboard.table'],
    ['/countries', 'page.insights.countries'],
    ['/products', 'page.insights.products'],
    ['/variants', 'page.insights.variants'],
    ['/payment-types', 'page.insights.payment_methods'],
    ['/payment-methods', 'page.insights.payment_methods'],
    ['/abandoned-carts', 'page.insights.abandoned_carts'],
    ['/checkout-funnel', 'page.insights.checkout_funnel'],
    ['/channels', 'page.acquisition.attribution'],
    ['/type', 'page.acquisition.devices'],
    ['/browsers', 'page.acquisition.browsers'],
    ['/ads', 'page.integrations.google_ads'],
    ['/compare-conversion-rate', 'page.tools.compare_conversion_rate'],
    ['/shipping-cr', 'page.tools.shipping_cr'],
    ['/click-order-lookup', 'page.tools.click_order_lookup'],
    ['/change-pins', 'page.tools.change_pins'],
    ['/time-of-day', 'page.tools.time_of_day'],
    ['/performance', 'settings.cost_expenses'],
  ];
  for (const [path, perm] of legacyPageMap) {
    if (pathname === path) return { any: [perm], all: [] };
  }

  // API routes: any one grants
  if (pathname.startsWith('/api/')) {
    const apiPerms = [];
    if (pathname === '/api/stats' || pathname === '/api/kpis' || pathname.startsWith('/api/kpis') ||
        pathname === '/api/dashboard-series' || pathname === '/api/available-days') {
      apiPerms.push('page.dashboard.overview');
    }
    if (pathname.startsWith('/api/sessions') || pathname === '/api/stream' || pathname === '/api/latest-sales') {
      apiPerms.push('page.dashboard.live');
    }
    if (pathname === '/api/shopify-sales' || pathname === '/api/latest-sale') {
      apiPerms.push('page.dashboard.sales');
    }
    if (pathname.startsWith('/api/shopify-') && pathname !== '/api/shopify-sessions' && pathname !== '/api/shopify-sales') {
      apiPerms.push('page.dashboard.table');
    }
    if (pathname === '/api/insights-variants' || pathname.startsWith('/api/insights-variants')) {
      apiPerms.push('page.insights.variants');
    }
    if (pathname.startsWith('/api/payment-types') || pathname.startsWith('/api/payment-methods')) {
      apiPerms.push('page.insights.payment_methods');
    }
    if (pathname.startsWith('/api/abandoned-carts')) {
      apiPerms.push('page.insights.abandoned_carts');
    }
    if (pathname.startsWith('/api/insights/checkout-funnel')) {
      apiPerms.push('page.insights.checkout_funnel');
    }
    if (pathname === '/api/product-insights' || pathname === '/api/page-insights' || pathname === '/api/worst-products') {
      apiPerms.push('page.insights.products');
    }
    if (pathname.startsWith('/api/attribution')) {
      apiPerms.push('page.acquisition.attribution');
    }
    if (pathname.startsWith('/api/browsers')) {
      apiPerms.push('page.acquisition.browsers');
    }
    if (pathname.startsWith('/api/devices')) {
      apiPerms.push('page.acquisition.devices');
    }
    if (pathname.startsWith('/api/ads') || pathname.startsWith('/api/integrations/google-ads')) {
      apiPerms.push('page.integrations.google_ads');
    }
    if (pathname.startsWith('/api/tools')) {
      apiPerms.push('page.tools.compare_conversion_rate', 'page.tools.shipping_cr', 'page.tools.click_order_lookup', 'page.tools.change_pins', 'page.tools.time_of_day');
    }
    if (pathname.startsWith('/api/performance')) {
      apiPerms.push('settings.cost_expenses');
    }
    if (pathname === '/api/settings' || pathname.startsWith('/api/settings') ||
        pathname.startsWith('/api/chart-settings') || pathname === '/api/config-status' ||
        pathname.startsWith('/api/assets') || pathname === '/api/asset-overrides' ||
        pathname === '/api/theme-defaults' || pathname === '/api/header-logo' || pathname === '/api/footer-logo') {
      apiPerms.push('page.settings');
    }
    if (pathname.startsWith('/api/kexo-score') || pathname === '/api/sales-diagnostics') {
      apiPerms.push('page.dashboard.overview');
    }
    if (apiPerms.length) {
      return { any: [...new Set(apiPerms)], all: [] };
    }
    return empty;
  }

  return empty;
}

/**
 * Check if the viewer is allowed given required { any, all } and effective permission map.
 * Admin always allowed. If both any and all are empty, allowed.
 * Otherwise: every key in .all must be true, and ( .any empty OR at least one in .any true ).
 */
function isAllowed(viewer, required, effectivePerms) {
  if (isAdminViewer(viewer)) return true;
  const anyList = required && Array.isArray(required.any) ? required.any : [];
  const allList = required && Array.isArray(required.all) ? required.all : [];
  if (anyList.length === 0 && allList.length === 0) return true;
  if (!effectivePerms || typeof effectivePerms !== 'object') return false;
  for (const key of allList) {
    if (effectivePerms[key] !== true) return false;
  }
  if (anyList.length === 0) return true;
  for (const key of anyList) {
    if (effectivePerms[key] === true) return true;
  }
  return false;
}

module.exports = {
  VALID_TIERS,
  ADMIN_ROLE,
  LEGACY_MASTER_ROLE,
  ALL_PERMISSION_KEYS,
  PERMISSION_KEY_SET,
  TIER_SET,
  getDefaultPermissionsForTier,
  validatePermissionKey,
  validateTier,
  normalizeUserTierForRbac,
  isAdminViewer,
  getRequiredPermissionsForRequest,
  isAllowed,
};
