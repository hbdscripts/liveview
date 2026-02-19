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
  /** If set, pixel Ingest URL uses this (e.g. https://ingest.kexo.io) so traffic goes through Cloudflare. Otherwise SHOPIFY_APP_URL + /api/ingest. */
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
  /** Optional override for local/dev/test SQLite file path (relative or absolute). */
  sqliteDbPath: (getEnv('SQLITE_DB_PATH', '') || '').trim(),
  adsDbUrl: getEnv('ADS_DB_URL', ''),
  trackingDefaultEnabled: getBool('TRACKING_DEFAULT_ENABLED', true),
  maxEventsPerSession: getInt('MAX_EVENTS_PER_SESSION', 50),
  maxEventPayloadBytes: getInt('MAX_EVENT_PAYLOAD_BYTES', 8192),
  rateLimitEventsPerMinute: getInt('RATE_LIMIT_EVENTS_PER_MINUTE', 120),
  sentryDsn: getEnv('SENTRY_DSN', ''),
  /** Fraud: used to HMAC-hash IP/UA (never store raw IP). */
  fraudIpSalt: (getEnv('FRAUD_IP_SALT', '') || '').trim(),
  /** Fraud: enable optional AI narrative generation (never blocks UI). */
  fraudAiEnabled: getBool('FRAUD_AI_ENABLED', false),
  /** Kexo Score: enable optional AI summary in score modal (never blocks UI). */
  kexoAiEnabled: getBool('KEXO_AI_ENABLED', false),
  /** Kexo Score AI model (e.g. gpt-4o-mini). */
  kexoAiModel: (getEnv('KEXO_AI_MODEL', '') || '').trim() || 'gpt-4o-mini',
  /** Fraud AI provider secret (do not store in DB). */
  openaiApiKey: (getEnv('OPENAI_API_KEY', '') || '').trim(),
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
  /** When true, use OAuth "Sign in with Google" flow. When false, use GOOGLE_ADS_REFRESH_TOKEN from env. Default OFF so env token is used unless OAuth explicitly enabled. */
  googleAdsOAuthEnabled: getBool('GOOGLE_ADS_OAUTH_ENABLED', false),
  /** Refresh token from env (used when GOOGLE_ADS_OAUTH_ENABLED is false). */
  googleAdsRefreshToken: (getEnv('GOOGLE_ADS_REFRESH_TOKEN', '') || '').trim(),
  /** Single allowed shop domain for "Login with Shopify" (e.g. mystore.myshopify.com) */
  allowedShopDomain: getEnv('ALLOWED_SHOP_DOMAIN', '').trim().toLowerCase(),
  /** Storefront domain for og:image thumbnails when dashboard opened without ?shop= (e.g. mystore.myshopify.com) */
  shopDomain: getEnv('SHOP_DOMAIN', '').trim().toLowerCase() || (getEnv('ALLOWED_SHOP_DOMAIN', '') || '').trim().toLowerCase(),
  /** Display domain for sidebar badge (e.g. hbdjewellery.com). When set, overrides storeMainDomain/shopDomain for badge display. */
  shopDisplayDomain: (getEnv('SHOP_DISPLAY_DOMAIN', '') || '').trim().toLowerCase().replace(/^www\./, ''),
  /** Main/public store URL for product images and links (e.g. https://www.hbdjewellery.com or STORE_MAIN_DOMAIN env). When set, dashboard uses this for og-thumb and last-action links. */
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
  /** Cloudflare R2 (S3-compatible) storage for uploaded branding assets (logos/favicon). */
  r2: {
    accountId: (getEnv('R2_ACCOUNT_ID', '') || '').trim(),
    accessKeyId: (getEnv('R2_ACCESS_KEY_ID', '') || '').trim(),
    secretAccessKey: (getEnv('R2_SECRET_ACCESS_KEY', '') || '').trim(),
    bucket: (getEnv('R2_BUCKET', '') || '').trim(),
    /** Public base URL (no trailing slash) where uploaded objects are accessible. */
    publicBaseUrl: (function() {
      const v = (getEnv('R2_PUBLIC_BASE_URL', '') || '').trim();
      if (!v) return '';
      return v.startsWith('http') ? v.replace(/\/+$/, '') : 'https://' + v.replace(/^\.+/, '').replace(/\/+$/, '');
    })(),
  },
  /** Secret to sign OAuth session cookie (defaults to DASHBOARD_SECRET) */
  oauthCookieSecret: (getEnv('OAUTH_COOKIE_SECRET', '') || getEnv('DASHBOARD_SECRET', '')),
  /** Traffic mode for stats: all | human_only (default all). When human_only, exclude cf_known_bot=1. */
  trafficMode: (getEnv('TRAFFIC_MODE', 'all') === 'human_only' ? 'human_only' : 'all'),
  enableGrowthTableRetention: getBool('ENABLE_GROWTH_TABLE_RETENTION', false),
  reportCacheRetentionDays: getInt('REPORT_CACHE_RETENTION_DAYS', 30),
  auditLogRetentionDays: getInt('AUDIT_LOG_RETENTION_DAYS', 90),
  reconcileSnapshotsRetentionDays: getInt('RECONCILE_SNAPSHOTS_RETENTION_DAYS', 365),
  /** Server port (default 3000). */
  port: getInt('PORT', 3000),
  /** NODE_ENV (development | production | test). */
  nodeEnv: getEnv('NODE_ENV', 'development'),
  /** When true (and nodeEnv is production), send Cache-Control headers for static assets. Set INCLUDE_CACHE=0 to disable. */
  includeCache: (function () {
    if (getEnv('NODE_ENV', 'development') !== 'production') return false;
    const v = getEnv('INCLUDE_CACHE', '1');
    return v !== '0' && v !== 'false';
  })(),
  /** Asset version for HTML ?v= (Railway/Git/commit env). */
  assetVersion: (function () {
    return (
      getEnv('RAILWAY_GIT_COMMIT_SHA', '') ||
      getEnv('RAILWAY_GIT_COMMIT_HASH', '') ||
      getEnv('GIT_COMMIT', '') ||
      getEnv('COMMIT_SHA', '') ||
      getEnv('SOURCE_VERSION', '') ||
      ''
    ).trim().slice(0, 12) || undefined;
  })(),
  /** Full git SHA for /api/version deploy proof (prefer explicit GIT_SHA when provided). */
  gitSha: (function () {
    const v = (
      getEnv('GIT_SHA', '') ||
      getEnv('RAILWAY_GIT_COMMIT_SHA', '') ||
      getEnv('RAILWAY_GIT_COMMIT_HASH', '') ||
      getEnv('GIT_COMMIT', '') ||
      getEnv('COMMIT_SHA', '') ||
      getEnv('SOURCE_VERSION', '') ||
      ''
    ).trim();
    // Safety: avoid unexpectedly huge envs.
    return v ? v.slice(0, 64) : '';
  })(),
  /** Disable scheduled jobs when set to 1 or true. */
  disableFraudBackfill: getBool('DISABLE_FRAUD_BACKFILL', false),
  disableScheduledTruthSync: getBool('DISABLE_SCHEDULED_TRUTH_SYNC', false),
  disableScheduledBackups: getBool('DISABLE_SCHEDULED_BACKUPS', false),
  disableScheduledAdsSync: getBool('DISABLE_SCHEDULED_ADS_SYNC', false),
  disableScheduledPostback: getBool('DISABLE_SCHEDULED_POSTBACK', false),
  /** Sales truth reconcile cadence for "today" (seconds). 60–120 recommended. */
  salesTruthReconcileMinIntervalSeconds: getInt('SALES_TRUTH_RECONCILE_MIN_INTERVAL_SECONDS', 90),
  /** Debug perf: when 1, dashboard-series can send timing to external ingest. */
  kexoDebugPerf: getEnv('KEXO_DEBUG_PERF', '') === '1',
  kexoDebugPerfRunId: (getEnv('KEXO_DEBUG_PERF_RUN_ID', '') || '').trim().slice(0, 32) || 'baseline',
};

module.exports = config;
