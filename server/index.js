/**
 * Live Visitors app – Express server, ingest, SSE, admin API, cleanup job.
 * IMPORTANT: instrument.js must be required first so Sentry initializes before anything else.
 */

require('./instrument.js');

const Sentry = require('@sentry/node');
const config = require('./config');
const salesTruth = require('./salesTruth');
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db');
const cleanup = require('./cleanup');

const ingestRouter = require('./routes/ingest');
const streamRouter = require('./routes/stream');
const sessionsRouter = require('./routes/sessions');
const configStatus = require('./routes/configStatus');
const shopifySessions = require('./routes/shopifySessions');
const statsRouter = require('./routes/stats');
const kpisRouter = require('./routes/kpis');
const kpisExpandedExtra = require('./routes/kpisExpandedExtra');
const trafficRouter = require('./routes/traffic');
const trafficSourceMaps = require('./routes/trafficSourceMaps');
const pixelRouter = require('./routes/pixel');
const shopifySales = require('./routes/shopifySales');
const salesDiagnostics = require('./routes/salesDiagnostics');
const verifySales = require('./routes/verifySales');
const reconcileSales = require('./routes/reconcileSales');
const latestSale = require('./routes/latestSale');
const shopifyBestSellers = require('./routes/shopifyBestSellers');
const shopifyBestVariants = require('./routes/shopifyBestVariants');
const shopifyLeaderboard = require('./routes/shopifyLeaderboard');
const shopifyFinishes = require('./routes/shopifyFinishes');
const shopifyLengths = require('./routes/shopifyLengths');
const shopifyChainStyles = require('./routes/shopifyChainStyles');
const shopifyWorstVariants = require('./routes/shopifyWorstVariants');
const insightsVariants = require('./routes/insightsVariants');
const insightsVariantsSuggestions = require('./routes/insightsVariantsSuggestions');
const worstProducts = require('./routes/worstProducts');
const productInsights = require('./routes/productInsights');
const pageInsights = require('./routes/pageInsights');
const adsRouter = require('./routes/ads');
const toolsRouter = require('./routes/tools');
const ogThumb = require('./routes/ogThumb');
const availableDays = require('./routes/availableDays');
const auth = require('./routes/auth');
const login = require('./routes/login');
const oauthLogin = require('./routes/oauthLogin');
const settings = require('./routes/settings');
const dashboardSeries = require('./routes/dashboardSeries');
const dashboardAuth = require('./middleware/dashboardAuth');

const app = express();
const PORT = process.env.PORT || 3000;

// Health check (for Railway/proxy – no auth, no redirects)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// robots.txt – public so crawlers see noindex/Disallow without hitting dashboard auth
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
});

// Log every request (so we can see in Railway logs if the request reached the app)
app.use((req, res, next) => {
  console.log('[Request]', req.method, req.path);
  next();
});

// CORS: ingest allows * (pixel sandbox Origin: null)
app.use('/api/ingest', cors({ origin: true, credentials: false }));
// Ingest JSON parsing must stay strict (public endpoint).
app.use('/api/ingest', express.json({ limit: config.maxEventPayloadBytes }));

app.use('/api/ingest', ingestRouter);

// Mobile support is now enabled; keep route compatibility but do not gate by UA.

// Protect dashboard + admin API: only from Shopify admin (Referer/Origin) or Google OAuth cookie (direct visits)
app.use(dashboardAuth.middleware);

// Body parser for authenticated admin API (Theme defaults can include many keys).
app.use(express.json({ limit: 262144 }));
app.use(express.urlencoded({ extended: true, limit: 262144 }));

// Admin API
app.get('/api/stream', streamRouter);
app.get('/api/sessions', sessionsRouter.list);
app.get('/api/sessions/online-series', sessionsRouter.onlineSeries);
app.get('/api/sessions/:id/events', sessionsRouter.events);
app.get('/api/config-status', configStatus);
app.get('/api/settings', settings.getSettings);
app.post('/api/settings', settings.postSettings);
app.get('/api/theme-defaults', settings.getThemeDefaults);
app.post('/api/theme-defaults', settings.postThemeDefaults);
// Server-injected theme variables (prevents first-paint header flash).
app.get('/theme-vars.css', settings.getThemeVarsCss);
app.post('/api/bot-blocked', require('./routes/botBlocked').postBotBlocked);
app.get('/api/stats', statsRouter.getStats);
app.get('/api/kpis', kpisRouter.getKpis);
app.get('/api/kpis-expanded-extra', kpisExpandedExtra.getKpisExpandedExtra);
app.get('/api/traffic', trafficRouter.getTraffic);
app.post('/api/traffic-prefs', trafficRouter.setTrafficPrefs);
app.get('/api/traffic-source-meta', trafficSourceMaps.getTrafficSourceMeta);
app.get('/api/traffic-source-maps', trafficSourceMaps.getTrafficSourceMaps);
app.post('/api/traffic-source-maps/map', trafficSourceMaps.mapTokenToSource);
app.post('/api/traffic-source-maps/meta', trafficSourceMaps.upsertSourceMeta);
app.post('/api/traffic-source-maps/backfill', trafficSourceMaps.backfillTokens);
app.get('/api/sales-diagnostics', salesDiagnostics.getSalesDiagnostics);
app.get('/api/reconcile-sales', reconcileSales.reconcileSales);
app.post('/api/reconcile-sales', reconcileSales.reconcileSales);
app.get('/api/verify-sales', verifySales.verifySales);
app.get('/api/pixel/ensure', pixelRouter.ensurePixel);
app.post('/api/pixel/ensure', pixelRouter.ensurePixel);
app.get('/api/pixel/status', pixelRouter.getPixelStatus);
app.get('/api/pixel/config', pixelRouter.getPixelConfig);
app.get('/api/latest-sale', latestSale.getLatestSale);
app.get('/api/shopify-sales', shopifySales.getShopifySalesToday);
app.get('/api/shopify-sessions', shopifySessions.getShopifySessionsToday);
app.get('/api/shopify-best-sellers', shopifyBestSellers.getShopifyBestSellers);
app.get('/api/shopify-best-variants', shopifyBestVariants.getShopifyBestVariants);
app.get('/api/shopify-leaderboard', shopifyLeaderboard.getShopifyLeaderboard);
app.get('/api/shopify-finishes', shopifyFinishes.getShopifyFinishes);
app.get('/api/shopify-lengths', shopifyLengths.getShopifyLengths);
app.get('/api/shopify-chain-styles', shopifyChainStyles.getShopifyChainStyles);
app.get('/api/shopify-worst-variants', shopifyWorstVariants.getShopifyWorstVariants);
app.get('/api/insights-variants', insightsVariants.getInsightsVariants);
app.get('/api/insights-variants-suggestions', insightsVariantsSuggestions.getInsightsVariantsSuggestions);
app.post('/api/insights-variants-suggestions/apply', insightsVariantsSuggestions.postApplyInsightsVariantsSuggestions);
app.get('/api/worst-products', worstProducts.getWorstProducts);
app.get('/api/product-insights', productInsights.getProductInsights);
app.get('/api/page-insights', pageInsights.getPageInsights);
app.get('/api/og-thumb', ogThumb.handleOgThumb);
app.get('/api/available-days', availableDays.getAvailableDays);
app.get('/api/dashboard-series', dashboardSeries.getDashboardSeries);
// Ads feature area: mounted as a router to keep Ads endpoints self-contained.
app.use('/api/ads', adsRouter);
app.use('/api/tools', toolsRouter);
const pkg = require(path.join(__dirname, '..', 'package.json'));
app.get('/api/me', (req, res) => {
  const raw = (req.get('Cookie') || '').split(';').map(s => s.trim());
  const oauthPart = raw.find(p => p.startsWith(dashboardAuth.OAUTH_COOKIE_NAME + '='));
  if (!oauthPart) return res.json({ email: null });
  try {
    const val = decodeURIComponent(oauthPart.split('=').slice(1).join('=').replace(/^"(.*)"$/, '$1'));
    const data = JSON.parse(Buffer.from(val, 'base64url').toString('utf8'));
    const email = (data.email || '').trim();
    res.json({ email, initial: email ? email[0].toUpperCase() : 'K' });
  } catch (_) { res.json({ email: null }); }
});
app.get('/api/store-base-url', (req, res) => {
  const domain = (config.shopDomain || '').trim().toLowerCase();
  const baseUrl = !domain ? '' : (domain.startsWith('http') ? domain : 'https://' + domain.replace(/^\.+/, ''));
  const mainBaseUrl = config.storeMainDomain || baseUrl;
  const assetsBaseUrl = config.assetsBaseUrl || '';
  const shopDisplayDomain = (() => {
    let out = '';
    if (config.shopDisplayDomain) out = config.shopDisplayDomain;
    else if (config.storeMainDomain) {
      try {
        const h = new URL(config.storeMainDomain).hostname;
        out = (h || '').replace(/^www\./, '') || '';
      } catch (_) {}
    } else {
      const sd = (config.shopDomain || '').trim();
      if (sd && !sd.endsWith('.myshopify.com')) out = sd;
      else if (sd && sd.endsWith('.myshopify.com')) {
        const base = sd.replace(/\.myshopify\.com$/i, '');
        out = base ? base + '.com' : '';
      }
    }
    // Fallback when derived value is empty or a Shopify handle (e.g. 943925-c1.com)
    if (!out || /^\d[\d-]*\.com$/.test(out)) return 'hbdjewellery.com';
    return out;
  })();
  const shopFromTruth = (() => {
    try {
      const s = salesTruth.resolveShopForSales('');
      return s && s.endsWith('.myshopify.com') ? s : '';
    } catch (_) {
      return '';
    }
  })();
  const shopForSalesRaw = (config.shopDomain || config.allowedShopDomain || '').trim().toLowerCase();
  const shopForSales = shopFromTruth || (shopForSalesRaw && shopForSalesRaw.endsWith('.myshopify.com') ? shopForSalesRaw : '');
  res.json({ baseUrl, mainBaseUrl, assetsBaseUrl, shopForSales, shopDisplayDomain });
});

// Shopify OAuth (install flow)
app.get('/auth/callback', (req, res) => auth.handleCallback(req, res));
app.get('/auth/shopify/callback', (req, res) => auth.handleCallback(req, res));

// Dashboard login (no auth required for these paths)
app.get('/app/login', login.handleGetLogin);
app.get('/app/logout', login.handleLogout);

// OAuth login: Google and "Login with Shopify"
app.get('/auth/google', oauthLogin.handleGoogleRedirect);
app.get('/auth/google/callback', oauthLogin.handleGoogleCallback);
app.get('/auth/shopify-login', oauthLogin.handleShopifyLoginRedirect);
app.get('/auth/shopify-login/callback', oauthLogin.handleShopifyLoginCallback);

// Allow embedding in Shopify admin (fixes "admin.shopify.com refused to connect"); keep private from search/AI
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com 'self'"
  );
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});

// Block docs/markdown paths from being served in production.
app.use((req, res, next) => {
  const p = req.path || '';
  if (p.startsWith('/docs') || /\.md$/i.test(p)) {
    res.status(404).end();
    return;
  }
  next();
});

// Public master stylesheet (login + auth loading pages need it without dashboard auth).
app.get('/app.css', (req, res) => {
  res.type('text/css');
  res.sendFile(path.join(__dirname, 'public', 'app.css'));
});

// Admin UI (embedded dashboard static assets)
app.use(express.static(path.join(__dirname, 'public'), { redirect: false }));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

function getCookie(req, name) {
  const raw = req.get('Cookie') || req.get('cookie') || '';
  const parts = raw.split(';').map((s) => s.trim());
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq > 0 && p.slice(0, eq).trim() === name) {
      return decodeURIComponent(p.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1'));
    }
  }
  return undefined;
}

function isLoggedIn(req) {
  const oauthCookie = getCookie(req, dashboardAuth.OAUTH_COOKIE_NAME);
  return !!(oauthCookie && dashboardAuth.verifyOauthSession(oauthCookie));
}

// Static assets are cached aggressively in some embed contexts (e.g. Shopify admin + CDN).
// Version local CSS/JS URLs in rendered HTML so deploys don't produce "new HTML + old JS/CSS" mismatches.
const ASSET_VERSION = (() => {
  try {
    const envCommit = String(
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT_HASH ||
      process.env.GIT_COMMIT ||
      process.env.COMMIT_SHA ||
      process.env.SOURCE_VERSION ||
      ''
    ).trim();
    if (envCommit) return envCommit.slice(0, 12);
  } catch (_) {}

  try {
    const base = path.join(__dirname, 'public');
    const files = ['app.js', 'custom.css', 'tabler-theme.css', 'theme-settings.js', 'diagnostics-modal.css', 'sentry-helpers.js'];
    const stamps = files.map((f) => {
      const stat = fs.statSync(path.join(base, f));
      return Math.trunc(stat.mtimeMs).toString(36);
    });
    return stamps.join('.');
  } catch (_) {}

  try {
    return String((pkg && pkg.version) || '0.0.0');
  } catch (_) {}

  return String(Date.now());
})();

// Expose a deploy/version signal for clients (helps recover from long-idle tabs + embed caching).
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const payload = {
    version: String((pkg && pkg.version) || '0.0.0'),
    assetVersion: ASSET_VERSION ? String(ASSET_VERSION) : null,
  };
  const dsn = (config.sentryDsn || '').trim();
  if (dsn) payload.sentryDsn = dsn;
  res.json(payload);
});

function applyAssetVersionToHtml(html) {
  if (!ASSET_VERSION) return html;
  const v = encodeURIComponent(String(ASSET_VERSION));
  return String(html || '').replace(/\b(href|src)="(\/(?!assets\/)[^"?]+\.(?:css|js))"/g, (_m, attr, url) => {
    return `${attr}="${url}?v=${v}"`;
  });
}

// Simple server-side include: <!--#include partials/header.html-->
const _includeCache = {};
const _includeCacheEnabled =
  process.env.NODE_ENV === 'production' &&
  !(process.env.INCLUDE_CACHE === '0' || process.env.INCLUDE_CACHE === 'false');

function safeResolveIncludePath(file) {
  const rel = file != null ? String(file).trim() : '';
  if (!rel) return null;
  // Disallow path traversal / absolute paths.
  if (rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) return null;
  const base = path.resolve(path.join(__dirname, 'public'));
  const full = path.resolve(path.join(__dirname, 'public', rel));
  if (!full.startsWith(base + path.sep) && full !== base) return null;
  return full;
}

function resolveIncludes(html, depth = 0) {
  if (depth > 10) return String(html || '');
  return String(html || '').replace(/<!--#include\s+([\w./%-]+)\s*-->/g, (_, file) => {
    try {
      const fileKey = file != null ? String(file) : '';
      const full = safeResolveIncludePath(fileKey);
      if (!full) {
        console.warn('[includes] blocked include path:', fileKey);
        return `<!-- include blocked: ${fileKey} -->`;
      }
      if (_includeCacheEnabled && _includeCache[fileKey]) return _includeCache[fileKey];
      const content = fs.readFileSync(full, 'utf8');
      const resolved = resolveIncludes(content, depth + 1);
      if (_includeCacheEnabled) _includeCache[fileKey] = resolved;
      return resolved;
    } catch (err) {
      console.error('[includes] failed to read include:', file, err && err.message ? err.message : err);
      return `<!-- include missing: ${file} -->`;
    }
  });
}

function applySentryTemplate(html) {
  const dsn = (config.sentryDsn || '').trim();
  const dsnJson = JSON.stringify(dsn);
  return String(html || '').replace(/\{\{SENTRY_DSN\}\}/g, dsnJson);
}

function sendPage(res, filename) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const filePath = path.join(__dirname, 'public', filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  let html = resolveIncludes(raw);
  html = applySentryTemplate(html);
  res.type('html').send(applyAssetVersionToHtml(html));
}

function appendOriginalQuery(targetPath, req) {
  const original = String((req && req.originalUrl) || '');
  const qIndex = original.indexOf('?');
  if (qIndex < 0) return targetPath;
  const query = original.slice(qIndex + 1);
  if (!query) return targetPath;
  return targetPath + (targetPath.includes('?') ? '&' : '?') + query;
}

function redirectWithQuery(statusCode, targetPath) {
  return (req, res) => {
    res.redirect(statusCode, appendOriginalQuery(targetPath, req));
  };
}

app.get('/mobile-unsupported', redirectWithQuery(302, '/dashboard/overview'));

// Canonical page routes (folder-style URLs)
const dashboardPagesRouter = express.Router();
dashboardPagesRouter.get('/overview', (req, res) => sendPage(res, 'dashboard/overview.html'));
dashboardPagesRouter.get('/live', (req, res) => sendPage(res, 'dashboard/live.html'));
dashboardPagesRouter.get('/sales', (req, res) => sendPage(res, 'dashboard/sales.html'));
dashboardPagesRouter.get('/table', (req, res) => sendPage(res, 'dashboard/table.html'));

const insightsPagesRouter = express.Router();
insightsPagesRouter.get('/countries', (req, res) => sendPage(res, 'insights/countries.html'));
insightsPagesRouter.get('/products', (req, res) => sendPage(res, 'insights/products.html'));
insightsPagesRouter.get('/variants', (req, res) => sendPage(res, 'insights/variants.html'));

const trafficPagesRouter = express.Router();
trafficPagesRouter.get('/channels', (req, res) => sendPage(res, 'traffic/channels.html'));
trafficPagesRouter.get('/device', (req, res) => sendPage(res, 'traffic/device.html'));

const integrationsPagesRouter = express.Router();
integrationsPagesRouter.get('/google-ads', (req, res) => sendPage(res, 'integrations/google-ads.html'));

const toolsPagesRouter = express.Router();
toolsPagesRouter.get('/compare-conversion-rate', (req, res) => sendPage(res, 'tools/compare-conversion-rate.html'));

// Base folder routes should canonicalize to leaf pages (avoid automatic /path -> /path/ redirects).
app.get('/dashboard', redirectWithQuery(301, '/dashboard/overview'));
app.get('/dashboard/', redirectWithQuery(301, '/dashboard/overview'));
app.get('/traffic', redirectWithQuery(301, '/traffic/channels'));
app.get('/traffic/', redirectWithQuery(301, '/traffic/channels'));
app.get('/integrations', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/integrations/', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/tools', redirectWithQuery(301, '/tools/compare-conversion-rate'));
app.get('/tools/', redirectWithQuery(301, '/tools/compare-conversion-rate'));

app.use('/dashboard', dashboardPagesRouter);
app.use('/insights', insightsPagesRouter);
app.use('/traffic', trafficPagesRouter);
app.use('/integrations', integrationsPagesRouter);
app.use('/tools', toolsPagesRouter);
app.get('/tools/ads', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/tools/ads/', redirectWithQuery(301, '/integrations/google-ads'));

// Legacy/flat dashboard URLs -> canonical folder routes.
app.get('/app/dashboard', redirectWithQuery(301, '/dashboard/overview'));
app.get('/live', redirectWithQuery(301, '/dashboard/live'));
app.get('/sales', redirectWithQuery(301, '/dashboard/sales'));
app.get('/date', redirectWithQuery(301, '/dashboard/table'));
app.get('/overview', redirectWithQuery(301, '/dashboard/overview'));
app.get('/countries', redirectWithQuery(301, '/insights/countries'));
app.get('/products', redirectWithQuery(301, '/insights/products'));
app.get('/variants', redirectWithQuery(301, '/insights/variants'));
app.get('/channels', redirectWithQuery(301, '/traffic/channels'));
app.get('/type', redirectWithQuery(301, '/traffic/device'));
app.get('/ads', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/compare-conversion-rate', redirectWithQuery(301, '/tools/compare-conversion-rate'));
app.get('/settings', (req, res) => sendPage(res, 'settings.html'));

// App URL: if shop + hmac (no code), OAuth when no session else show dashboard in iframe; else redirect to overview
app.get('/', async (req, res, next) => {
  try {
    await auth.handleAppUrl(req, res, next);
    if (res.headersSent) return;
    if (res.locals && res.locals.renderEmbeddedDashboard) {
      return sendPage(res, 'dashboard/overview.html');
    }
    if (isLoggedIn(req)) {
      return res.redirect(302, '/dashboard/overview');
    }
    return res.redirect(302, '/app/login');
  } catch (err) {
    next(err);
  }
});

// Test route: trigger a Sentry event (only when SENTRY_DSN is set)
if (config.sentryDsn && config.sentryDsn.trim() !== '') {
  app.get('/debug-sentry', () => {
    throw new Error('My first Sentry error!');
  });
}

// Sentry Express error handler (after all controllers, before other error middleware)
Sentry.setupExpressErrorHandler(app);

// Fallthrough error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).send('Internal server error');
});

// Migrate on startup
const { up: up001 } = require('./migrations/001_initial');
const { up: up002 } = require('./migrations/002_shop_sessions');
const { up: up003 } = require('./migrations/003_cart_order_money');
const { up: up004 } = require('./migrations/004_session_stats_fields');
const { up: up005 } = require('./migrations/005_utm_campaign');
const { up: up006 } = require('./migrations/006_utm_source_medium_content');
const { up: up007 } = require('./migrations/007_first_path');
const { up: up008 } = require('./migrations/008_purchases');
const { up: up009 } = require('./migrations/009_cf_traffic');
const { up: up010 } = require('./migrations/010_referrer');
const { up: up011 } = require('./migrations/011_entry_url');
const { up: up012 } = require('./migrations/012_bot_block_counts');
const { up: up013 } = require('./migrations/013_session_is_returning');
const { up: up014 } = require('./migrations/014_dedupe_legacy_purchases');
const { up: up015 } = require('./migrations/015_backfill_session_is_returning');
const { up: up016 } = require('./migrations/016_dedupe_h_purchases');
const { up: up017 } = require('./migrations/017_sales_truth_and_evidence');
const { up: up018 } = require('./migrations/018_orders_shopify_returning_fields');
const { up: up019 } = require('./migrations/019_customer_order_facts');
const { up: up020 } = require('./migrations/020_bot_block_counts_updated_at');
const { up: up021 } = require('./migrations/021_sessions_traffic_fields');
const { up: up022 } = require('./migrations/022_report_indexes');
const { up: up023 } = require('./migrations/023_reconcile_snapshots');
const { up: up024 } = require('./migrations/024_shopify_sessions_snapshots');
const { up: up025 } = require('./migrations/025_orders_shopify_line_items');
const { up: up026 } = require('./migrations/026_report_cache');
const { up: up027 } = require('./migrations/027_traffic_source_maps');
const { up: up028 } = require('./migrations/028_backfill_purchases_from_evidence');
const { up: up029 } = require('./migrations/029_dedupe_traffic_source_meta_labels');
const { up: up030 } = require('./migrations/030_canonicalize_built_in_traffic_sources');
const { up: up031 } = require('./migrations/031_orders_shopify_line_items_variant_title_index');
const { up: up032 } = require('./migrations/032_sessions_bs_ads_fields');
const { up: up033 } = require('./migrations/033_sessions_landing_composite_index');
const { up: up034 } = require('./migrations/034_perf_indexes_more');
const { up: up035 } = require('./migrations/035_growth_retention_indexes');
const { up: up036 } = require('./migrations/036_tools_compare_cr_indexes');
const { up: up037 } = require('./migrations/037_perf_composite_indexes_wal');
const { up: up038 } = require('./migrations/038_perf_indexes_events_traffic');
const backup = require('./backup');
const { writeAudit } = require('./audit');
const { runAdsMigrations } = require('./ads/adsMigrate');

async function migrateAndStart() {
  // Open DB early so backups can inspect/operate.
  getDb();

  // Required: backup before introducing the Sales Truth schema (first deploy only).
  const preBackup = await backup.backupBeforeTruthSchemaCreate();

  await up001();
  await up002();
  await up003();
  await up004();
  await up005();
  await up006();
  await up007();
  await up008();
  await up009();
  await up010();
  await up011();
  await up012();
  await up013();
  await up014();
  await up015();
  await up016();
  await up017();
  await up018();
  await up019();
  await up020();
  await up021();
  await up022();
  await up023();
  await up024();
  await up025();
  await up026();
  await up027();
  await up028();
  await up029();
  await up030();
  await up031();
  await up032();
  await up033();
  await up034();
  await up035();
  await up036();
  await up037();
  await up038();

  try {
    const r = await runAdsMigrations();
    if (r && r.skipped) console.log('[ads.migrate] skipped:', r.reason);
    else console.log('[ads.migrate] applied:', r && r.applied != null ? r.applied : 0);
  } catch (e) {
    console.error('[ads.migrate] failed (continuing):', e);
  }

  if (preBackup) {
    await writeAudit('system', 'backup', {
      when: 'startup_pre_truth_schema',
      ...preBackup,
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kexo app listening on http://0.0.0.0:${PORT}`);
    console.log('Dashboard: /dashboard/overview');
    console.log('Ingest: POST /api/ingest (header: X-Ingest-Secret or Authorization: Bearer <secret>)');

    // Restore correctness ASAP: reconcile today's Shopify orders into orders_shopify (fail-open; throttled).
    setTimeout(() => {
      try {
        const store = require('./store');
        const salesTruth = require('./salesTruth');
        const shop = salesTruth.resolveShopForSales('');
        if (!shop) return;
        const tz = store.resolveAdminTimeZone();
        const nowMs = Date.now();
        const bounds = store.getRangeBounds('today', nowMs, tz);
        salesTruth.ensureReconciled(shop, bounds.start, bounds.end, 'today').catch(() => {});
      } catch (_) {}
    }, 1000);

    // Daily backups (fail-open). Retain last 7.
    (function scheduleDailyBackups() {
      if (process.env.DISABLE_SCHEDULED_BACKUPS === '1' || process.env.DISABLE_SCHEDULED_BACKUPS === 'true') return;
      const DAY_MS = 24 * 60 * 60 * 1000;
      const TABLES = ['orders_shopify', 'purchases', 'purchase_events', 'sessions'];
      async function runOnce() {
        try {
          const meta = await backup.backup({ label: 'daily', tables: TABLES, retention: { keep: 7 } });
          await writeAudit('system', 'backup', { when: 'scheduled_daily', ...meta });
        } catch (err) {
          try {
            await writeAudit('system', 'backup_error', {
              when: 'scheduled_daily',
              error: err && err.message ? String(err.message).slice(0, 220) : 'backup_failed',
            });
          } catch (_) {}
        }
      }
      // Run shortly after boot, then every 24h.
      setTimeout(() => { runOnce().catch(() => {}); }, 15000);
      setInterval(() => { runOnce().catch(() => {}); }, DAY_MS);
    })();
  });
}

migrateAndStart().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

// TTL cleanup every 2 minutes
setInterval(() => {
  cleanup.run().catch(err => console.error('Cleanup error:', err));
}, 2 * 60 * 1000);

// Ads spend sync runs in the background so the Ads table can refresh without wiping UI.
(function scheduleAdsSync() {
  if (process.env.DISABLE_SCHEDULED_ADS_SYNC === '1' || process.env.DISABLE_SCHEDULED_ADS_SYNC === 'true') return;

  const store = require('./store');
  const { syncGoogleAdsSpendHourly, backfillCampaignIdsFromGclid } = require('./ads/googleAdsSpendSync');
  const { syncAttributedOrdersToAdsDb } = require('./ads/adsOrderAttributionSync');
  const { getAdsDb } = require('./ads/adsDb');

  const SPEND_SYNC_MS = 5 * 60 * 1000;
  const GCLID_BACKFILL_MS = 30 * 60 * 1000;
  const ATTR_SYNC_MS = 5 * 60 * 1000;
  const ATTR_BACKFILL_MS = 30 * 60 * 1000;

  let spendInFlight = false;
  let gclidInFlight = false;
  let attrInFlight = false;

  function resolveBounds(rangeKey) {
    const now = Date.now();
    const timeZone = store.resolveAdminTimeZone();
    const bounds = store.getRangeBounds(rangeKey, now, timeZone);
    return { rangeStartTs: bounds.start, rangeEndTs: bounds.end };
  }

  async function runSpendSync(rangeKey) {
    if (spendInFlight) return;
    spendInFlight = true;
    try {
      const adsDb = getAdsDb();
      if (!adsDb) return; // ADS_DB_URL not set — skip silently
      const { rangeStartTs, rangeEndTs } = resolveBounds(rangeKey);
      const spend = await syncGoogleAdsSpendHourly({ rangeStartTs, rangeEndTs });
      if (spend && spend.ok) console.log('[ads-sync] spend:', spend.upserts, 'upserts', spend.apiVersion ? '(' + spend.apiVersion + ')' : '');
      else console.warn('[ads-sync] spend failed:', spend && spend.error ? spend.error : 'failed');
    } catch (err) {
      console.error('[ads-sync] spend error:', err && err.message ? err.message : err);
    } finally {
      spendInFlight = false;
    }
  }

  async function runGclidBackfill(rangeKey) {
    if (gclidInFlight) return;
    gclidInFlight = true;
    try {
      const adsDb = getAdsDb();
      if (!adsDb) return;
      const { rangeStartTs, rangeEndTs } = resolveBounds(rangeKey);
      const out = await backfillCampaignIdsFromGclid({ rangeStartTs, rangeEndTs });
      if (out && out.ok) console.log('[ads-sync] gclid backfill:', out.updated || 0, 'updated');
      else console.warn('[ads-sync] gclid backfill failed:', out && out.error ? out.error : 'failed');
    } catch (err) {
      console.error('[ads-sync] gclid backfill error:', err && err.message ? err.message : err);
    } finally {
      gclidInFlight = false;
    }
  }

  async function runOrderAttribution(rangeKey, reasonKey) {
    if (attrInFlight) return;
    attrInFlight = true;
    try {
      const adsDb = getAdsDb();
      if (!adsDb) return;
      const shop = salesTruth.resolveShopForSales('');
      if (!shop) return;
      const { rangeStartTs, rangeEndTs } = resolveBounds(rangeKey);

      try {
        await salesTruth.ensureReconciled(shop, rangeStartTs, rangeEndTs, reasonKey || ('ads_sync_' + rangeKey));
      } catch (e) {
        console.warn('[ads-sync] reconcile failed (non-fatal):', e && e.message ? String(e.message).slice(0, 220) : e);
      }

      const out = await syncAttributedOrdersToAdsDb({ shop, rangeStartTs, rangeEndTs, source: 'googleads' });
      if (out && out.ok) {
        console.log('[ads-sync] attribution:', out.upserts || 0, 'upserts', '(' + rangeKey + ')');
      } else {
        console.warn('[ads-sync] attribution failed:', out && out.error ? out.error : 'failed');
      }
    } catch (err) {
      console.error('[ads-sync] attribution error:', err && err.message ? err.message : err);
    } finally {
      attrInFlight = false;
    }
  }

  // Bootstrap: backfill a wider window once, then keep recent spend fresh.
  setTimeout(() => { runSpendSync('7d').catch(() => {}); }, 30 * 1000);
  setInterval(() => { runSpendSync('3d').catch(() => {}); }, SPEND_SYNC_MS);

  // GCLID → campaign cache: less frequent (used for attribution fallbacks).
  setTimeout(() => { runGclidBackfill('7d').catch(() => {}); }, 45 * 1000);
  setInterval(() => { runGclidBackfill('7d').catch(() => {}); }, GCLID_BACKFILL_MS);

  // Order attribution into Ads DB: keep today's orders fresh frequently; backfill weekly window less often.
  setTimeout(() => { runOrderAttribution('7d', 'ads_sync_boot_7d').catch(() => {}); }, 75 * 1000);
  setInterval(() => { runOrderAttribution('today', 'ads_sync_today').catch(() => {}); }, ATTR_SYNC_MS);
  setInterval(() => { runOrderAttribution('7d', 'ads_sync_7d').catch(() => {}); }, ATTR_BACKFILL_MS);
})();
