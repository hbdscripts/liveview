/**
 * Single config module – the only place that reads process.env.
 * Validates required vars and exports a typed config object.
 * Fail-open: app boots even if Shopify vars are missing; dashboard and ingest still work.
 */

const requiredForShopify = [
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_APP_URL',
];

function getEnv(name, defaultValue) {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  return defaultValue;
}

function getInt(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

function getBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === '') return defaultValue;
  return v === 'true' || v === '1';
}

function validate() {
  const missing = requiredForShopify.filter(
    (key) => !process.env[key] || String(process.env[key]).trim() === ''
  );
  if (missing.length > 0) {
    console.warn(
      '[config] Missing Shopify env (dashboard/ingest still work):',
      missing.join(', ')
    );
  }
}

validate();

const config = {
  shopify: {
    apiKey: getEnv('SHOPIFY_API_KEY', ''),
    apiSecret: getEnv('SHOPIFY_API_SECRET', ''),
    appUrl: getEnv('SHOPIFY_APP_URL', 'http://localhost:3000'),
    scopes: getEnv('SHOPIFY_SCOPES', 'read_products,read_orders,read_all_orders,write_pixels,read_customer_events,read_reports'),
  },
  ingestSecret: getEnv('INGEST_SECRET', ''),
  /** If set, pixel Ingest URL uses this (e.g. https://lv-ingest.hbdjewellery.com) so traffic goes through Cloudflare. Otherwise SHOPIFY_APP_URL + /api/ingest. */
  ingestPublicUrl: getEnv('INGEST_PUBLIC_URL', '').replace(/\/$/, ''),
  /** Allowed origins for ?ingestUrl= on ensure (INGEST_PUBLIC_URL + ALLOWED_INGEST_ORIGINS). Used so script can pass URL and replicas without env still accept it. */
  allowedIngestOrigins: (function () {
    const fromPublic = (getEnv('INGEST_PUBLIC_URL', '') || '').trim();
    const fromEnv = (getEnv('ALLOWED_INGEST_ORIGINS', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const list = [...(fromPublic.startsWith('http') ? [fromPublic.replace(/\/$/, '')] : []), ...fromEnv];
    return [...new Set(list)];
  })(),
  adminTimezone: getEnv('ADMIN_TIMEZONE', 'Europe/London'),
  activeWindowMinutes: getInt('ACTIVE_WINDOW_MINUTES', 5),
  /** Live dashboard: only show sessions that arrived within this many minutes (so long-lived tabs don't stay forever). */
  liveArrivedWindowMinutes: getInt('LIVE_ARRIVED_WINDOW_MINUTES', 60),
  recentWindowMinutes: getInt('RECENT_WINDOW_MINUTES', 15),
  sessionTtlMinutes: getInt('SESSION_TTL_MINUTES', 24 * 60),
  /** Retention in days for stats stability; cleanup deletes only when BOTH last_seen and started_at are older than this */
  sessionRetentionDays: getInt('SESSION_RETENTION_DAYS', 30),
  abandonedWindowMinutes: getInt('ABANDONED_WINDOW_MINUTES', 15),
  abandonedRetentionHours: getInt('ABANDONED_RETENTION_HOURS', 24),
  returningGapMinutes: getInt('RETURNING_GAP_MINUTES', 30),
  checkoutStartedWindowMinutes: getInt('CHECKOUT_STARTED_WINDOW_MINUTES', 15),
  dbUrl: getEnv('DB_URL', ''),
  adsDbUrl: getEnv('ADS_DB_URL', ''),
  trackingDefaultEnabled: getBool('TRACKING_DEFAULT_ENABLED', true),
  maxEventsPerSession: getInt('MAX_EVENTS_PER_SESSION', 50),
  maxEventPayloadBytes: getInt('MAX_EVENT_PAYLOAD_BYTES', 8192),
  rateLimitEventsPerMinute: getInt('RATE_LIMIT_EVENTS_PER_MINUTE', 120),
  sentryDsn: getEnv('SENTRY_DSN', ''),
  dashboardSecret: getEnv('DASHBOARD_SECRET', ''),
  /** If set, dashboard is allowed without password only when Referer starts with this (e.g. https://admin.shopify.com/store/943925-c1) */
  allowedAdminRefererPrefix: getEnv('ALLOWED_ADMIN_REFERER_PREFIX', ''),
  /** For OAuth login splash: Google */
  googleClientId: getEnv('GOOGLE_CLIENT_ID', ''),
  googleClientSecret: getEnv('GOOGLE_CLIENT_SECRET', ''),
  /** Comma-separated emails allowed to sign in with Google (e.g. you@example.com) */
  allowedGoogleEmails: (getEnv('ALLOWED_GOOGLE_EMAILS', '') || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean),
  googleAdsDeveloperToken: getEnv('GOOGLE_ADS_DEVELOPER_TOKEN', ''),
  googleAdsLoginCustomerId: getEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', ''),
  googleAdsCustomerId: getEnv('GOOGLE_ADS_CUSTOMER_ID', ''),
  googleAdsApiVersion: getEnv('GOOGLE_ADS_API_VERSION', ''),
  /** Single allowed shop domain for "Login with Shopify" (e.g. mystore.myshopify.com) */
  allowedShopDomain: getEnv('ALLOWED_SHOP_DOMAIN', '').trim().toLowerCase(),
  /** Storefront domain for og:image thumbnails when dashboard opened without ?shop= (e.g. mystore.myshopify.com) */
  shopDomain: getEnv('SHOP_DOMAIN', '').trim().toLowerCase() || (getEnv('ALLOWED_SHOP_DOMAIN', '') || '').trim().toLowerCase(),
  /** Main/public store URL for product images and links (e.g. https://www.hbdjewellery.com). When set, dashboard uses this for og-thumb and last-action links. */
  storeMainDomain: (function() {
    const v = (getEnv('STORE_MAIN_DOMAIN', '') || '').trim();
    if (!v) return '';
    return v.startsWith('http') ? v.replace(/\/+$/, '') : 'https://' + v.replace(/^\.+/, '').replace(/\/+$/, '');
  })(),
  /** Base URL for dashboard assets (favicon, checkout.webp, cash-register.mp3, adwords.png). When set, dashboard loads these from this URL to save app bandwidth. No trailing slash. */
  assetsBaseUrl: (function() {
    const v = (getEnv('ASSETS_BASE_URL', '') || '').trim();
    if (!v) return '';
    return v.startsWith('http') ? v.replace(/\/+$/, '') : 'https://' + v.replace(/^\.+/, '').replace(/\/+$/, '');
  })(),
  /** Secret to sign OAuth session cookie (defaults to DASHBOARD_SECRET) */
  oauthCookieSecret: (getEnv('OAUTH_COOKIE_SECRET', '') || getEnv('DASHBOARD_SECRET', '')),
  /** Traffic mode for stats: all | human_only (default all). When human_only, exclude cf_known_bot=1. */
  trafficMode: (getEnv('TRAFFIC_MODE', 'all') === 'human_only' ? 'human_only' : 'all'),
  enableGrowthTableRetention: getBool('ENABLE_GROWTH_TABLE_RETENTION', false),
  reportCacheRetentionDays: getInt('REPORT_CACHE_RETENTION_DAYS', 30),
  auditLogRetentionDays: getInt('AUDIT_LOG_RETENTION_DAYS', 90),
  reconcileSnapshotsRetentionDays: getInt('RECONCILE_SNAPSHOTS_RETENTION_DAYS', 365),
};

module.exports = config;
