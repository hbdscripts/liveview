/**
 * Single config module – the only place that reads process.env.
 * Validates required vars and exports a typed config object.
 * For limited local mode (no Shopify install), only INGEST_SECRET is optional.
 */

const requiredForFullRun = [
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
  const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
  if (mode === 'production') {
    for (const key of requiredForFullRun) {
      if (!process.env[key] || process.env[key].trim() === '') {
        throw new Error(`Missing required env: ${key}`);
      }
    }
  }
  // INGEST_SECRET: required for ingest to accept events; optional for local UI-only
  if (!process.env.INGEST_SECRET && process.env.INGEST_SECRET !== '') {
    // Allow empty for local dev without pixel
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
};

module.exports = config;
