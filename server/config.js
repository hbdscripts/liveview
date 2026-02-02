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
    scopes: getEnv('SHOPIFY_SCOPES', 'read_products,read_orders'),
  },
  ingestSecret: getEnv('INGEST_SECRET', ''),
  adminTimezone: getEnv('ADMIN_TIMEZONE', 'Europe/London'),
  activeWindowMinutes: getInt('ACTIVE_WINDOW_MINUTES', 5),
  recentWindowMinutes: getInt('RECENT_WINDOW_MINUTES', 15),
  sessionTtlMinutes: getInt('SESSION_TTL_MINUTES', 60),
  abandonedWindowMinutes: getInt('ABANDONED_WINDOW_MINUTES', 15),
  abandonedRetentionHours: getInt('ABANDONED_RETENTION_HOURS', 24),
  returningGapMinutes: getInt('RETURNING_GAP_MINUTES', 30),
  checkoutStartedWindowMinutes: getInt('CHECKOUT_STARTED_WINDOW_MINUTES', 15),
  dbUrl: getEnv('DB_URL', ''),
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
  /** Single allowed shop domain for "Login with Shopify" (e.g. mystore.myshopify.com) */
  allowedShopDomain: getEnv('ALLOWED_SHOP_DOMAIN', '').trim().toLowerCase(),
  /** Secret to sign OAuth session cookie (defaults to DASHBOARD_SECRET) */
  oauthCookieSecret: (getEnv('OAUTH_COOKIE_SECRET', '') || getEnv('DASHBOARD_SECRET', '')),
};

module.exports = config;
