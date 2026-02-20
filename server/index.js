/**
 * Live Visitors app – Express server, ingest, SSE, admin API, cleanup job.
 * IMPORTANT: instrument.js must be required first so Sentry initializes before anything else.
 */

const sentry = require('./instrument.js');

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
const versionRoute = require('./routes/version');
const shopifySessions = require('./routes/shopifySessions');
const statsRouter = require('./routes/stats');
const kpisRouter = require('./routes/kpis');
const kpisExpandedExtra = require('./routes/kpisExpandedExtra');
const kexoScoreRouter = require('./routes/kexoScore');
const kexoScoreSummaryRouter = require('./routes/kexoScoreSummary');
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
const devicesRouter = require('./routes/devices');
const attributionRouter = require('./routes/attribution');
const abandonedCarts = require('./routes/abandonedCarts');
const adsRouter = require('./routes/ads');
const googleAdsIssuesRouter = require('./routes/googleAdsIssues');
const toolsRouter = require('./routes/tools');
const fraudRouter = require('./routes/fraud');
const ogThumb = require('./routes/ogThumb');
const availableDays = require('./routes/availableDays');
const auth = require('./routes/auth');
const login = require('./routes/login');
const oauthLogin = require('./routes/oauthLogin');
const localAuth = require('./routes/localAuth');
const me = require('./routes/me');
const settings = require('./routes/settings');
const assets = require('./routes/assets');
const dashboardSeries = require('./routes/dashboardSeries');
const businessSnapshot = require('./routes/businessSnapshot');
const costHealth = require('./routes/costHealth');
const costBreakdown = require('./routes/costBreakdown');
const dashboardAuth = require('./middleware/dashboardAuth');
const requireMaster = require('./middleware/requireMaster');
const { isMasterRequest } = require('./authz');
const adminUsersApi = require('./routes/adminUsers');
const adminControlsApi = require('./routes/adminControls');
const adminFraudApi = require('./routes/adminFraud');
const { getBrowserRegistryPayload } = require('./shared/icon-registry');

const app = express();
const PORT = config.port;

function warnBackgroundFailure(tag, err) {
  try {
    console.warn(tag, err && err.message ? String(err.message).slice(0, 220) : err);
  } catch (_) {}
  try {
    if (sentry && typeof sentry.captureException === 'function') {
      sentry.captureException(err, { context: 'background', tag: String(tag || '').slice(0, 120) }, 'warning');
    }
  } catch (_) {}
}

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
app.get('/api/latest-sales', sessionsRouter.latestSales);
app.use('/api/fraud', fraudRouter);
app.get('/api/config-status', configStatus);
app.get('/api/settings', settings.getSettings);
app.post('/api/settings', settings.postSettings);
app.get('/api/settings/profit-rules', requireMaster.middleware, settings.getProfitRules);
  app.put('/api/settings/profit-rules', requireMaster.middleware, settings.putProfitRules);
  app.get('/api/chart-settings/:chartKey', settings.getChartSettings);
  app.put('/api/chart-settings/:chartKey', settings.putChartSettings);
app.get('/api/theme-defaults', settings.getThemeDefaults);
app.post('/api/theme-defaults', settings.postThemeDefaults);
app.get('/api/asset-overrides', assets.getAssetOverrides);
app.get('/api/header-logo', assets.getHeaderLogo);
app.get('/api/footer-logo', assets.getFooterLogo);
app.post(
  '/api/assets/upload',
  (req, res, next) => {
    assets.uploadSingle(req, res, (err) => {
      if (!err) return next();
      const code = err && err.code ? String(err.code) : '';
      if (code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ ok: false, error: 'Upload file too large (max 10MB for sale sound, 2MB for images)' });
      }
      return res.status(400).json({
        ok: false,
        error: err && err.message ? String(err.message) : 'Upload failed',
      });
    });
  },
  assets.postUploadAsset
);
app.get('/api/devices/observed', devicesRouter.getObservedDevices);
app.get('/api/devices/report', devicesRouter.getDevicesReport);
app.get('/api/browsers/series', require('./routes/browsers').getBrowsersSeries);
app.get('/api/browsers/table', require('./routes/browsers').getBrowsersTable);
app.get('/api/attribution/report', attributionRouter.getAttributionReport);
app.get('/api/attribution/prefs', attributionRouter.getAttributionPrefs);
app.post('/api/attribution/prefs', requireMaster.middleware, attributionRouter.postAttributionPrefs);
app.get('/api/attribution/config', attributionRouter.getAttributionConfig);
app.post('/api/attribution/config', requireMaster.middleware, attributionRouter.postAttributionConfig);
app.get('/api/attribution/observed', attributionRouter.getAttributionObserved);
app.post('/api/attribution/map', requireMaster.middleware, attributionRouter.postAttributionMap);
app.patch('/api/attribution/rules/:id', requireMaster.middleware, attributionRouter.patchAttributionRule);
app.post('/api/attribution/icons', requireMaster.middleware, attributionRouter.postAttributionIcons);
// Server-injected theme variables (prevents first-paint header flash).
app.get('/theme-vars.css', settings.getThemeVarsCss);
app.get('/icon-registry.js', (req, res) => {
  const payload = getBrowserRegistryPayload();
  const js =
    '(function(){' +
    'window.KexoIconRegistry={registry:' + JSON.stringify(payload) + '};' +
    '})();';
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/javascript').send(js);
});
app.post('/api/bot-blocked', require('./routes/botBlocked').postBotBlocked);
app.post('/api/edge-blocked', require('./routes/edgeBlocked').postEdgeBlocked);
app.get('/api/edge-blocked/summary', requireMaster.middleware, require('./routes/edgeBlocked').getEdgeBlockedSummary);
app.get('/api/edge-blocked/events', requireMaster.middleware, require('./routes/edgeBlocked').getEdgeBlockedEvents);
app.get('/api/stats', statsRouter.getStats);
app.get('/api/kpis', kpisRouter.getKpis);
app.get('/api/kpis-expanded-extra', kpisExpandedExtra.getKpisExpandedExtra);
app.get('/api/kexo-score', kexoScoreRouter.getKexoScore);
app.get('/api/kexo-score-summary', kexoScoreSummaryRouter.getKexoScoreSummary);
app.get('/api/sales-diagnostics', salesDiagnostics.getSalesDiagnostics);
app.get('/api/reconcile-sales', requireMaster.middleware, reconcileSales.reconcileSales);
app.post('/api/reconcile-sales', requireMaster.middleware, reconcileSales.reconcileSales);
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
app.get('/api/payment-types/series', require('./routes/paymentTypes').getPaymentTypesSeries);
app.get('/api/payment-types/table', require('./routes/paymentTypes').getPaymentTypesTable);
app.get('/api/payment-methods/report', require('./routes/paymentMethods').getPaymentMethodsReport);
app.get('/api/insights-variants-suggestions', insightsVariantsSuggestions.getInsightsVariantsSuggestions);
app.post('/api/insights-variants-suggestions/apply', insightsVariantsSuggestions.postApplyInsightsVariantsSuggestions);
app.get('/api/worst-products', worstProducts.getWorstProducts);
app.get('/api/product-insights', productInsights.getProductInsights);
app.get('/api/page-insights', pageInsights.getPageInsights);
// Abandoned carts insights (cart vs checkout modes)
app.use('/api/abandoned-carts', abandonedCarts);
app.get('/api/og-thumb', ogThumb.handleOgThumb);
app.get('/api/available-days', availableDays.getAvailableDays);
app.get('/api/dashboard-series', dashboardSeries.getDashboardSeries);
app.get('/api/business-snapshot', requireMaster.middleware, businessSnapshot.getBusinessSnapshot);
app.get('/api/cost/health', requireMaster.middleware, costHealth.getCostHealth);
app.get('/api/cost-breakdown', requireMaster.middleware, costBreakdown.getCostBreakdown);
// Ads feature area: mounted as a router to keep Ads endpoints self-contained.
app.use('/api/ads', adsRouter);
app.use('/api/integrations/google-ads/issues', googleAdsIssuesRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/admin', requireMaster.middleware, adminUsersApi);
app.use('/api/admin', requireMaster.middleware, adminControlsApi);
app.use('/api/admin', requireMaster.middleware, adminFraudApi);
const pkg = require(path.join(__dirname, '..', 'package.json'));
app.get('/api/me', me);
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
app.get('/app/register', login.handleGetRegister);
app.get('/app/logout', login.handleLogout);

// OAuth login: Google and "Login with Shopify"
app.get('/auth/google', oauthLogin.handleGoogleRedirect);
app.get('/auth/google/callback', oauthLogin.handleGoogleCallback);
app.get('/auth/shopify-login', oauthLogin.handleShopifyLoginRedirect);
app.get('/auth/shopify-login/callback', oauthLogin.handleShopifyLoginCallback);

// Local auth: email/password (pending approvals)
app.post('/auth/local/register', localAuth.postRegister);
app.post('/auth/local/login', localAuth.postLogin);

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

// Sale chime asset shim: keep legacy /assets URL working even when local file is absent.
app.get('/assets/cash-register.mp3', (req, res) => {
  res.redirect(307, 'https://cdn.shopify.com/s/files/1/0847/7261/8587/files/cash-register.mp3?v=1770171264');
});

// Admin UI (embedded dashboard static assets)
app.use(express.static(path.join(__dirname, 'public'), {
  redirect: false,
  setHeaders: (res, filePath) => {
    // Some embed contexts can hold onto old JS even when HTML is versioned.
    // Force revalidation for the main dashboard bundles so deploys take effect immediately.
    try {
      const base = path.basename(String(filePath || ''));
      const noStore = new Set([
        'app.js',
        'kexo-chart-defs.js',
        'kexo-chart-builder.js',
        'kexo-table-builder.js',
        'kexo-table-defs.js',
        'theme-settings.js',
        'settings-page.js',
      ]);
      if (noStore.has(base)) {
        res.setHeader('Cache-Control', 'no-store');
      }
    } catch (_) {}
  }
}));
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
  if (config.assetVersion) return config.assetVersion;
  try {
    const base = path.join(__dirname, 'public');
    const files = [
      'app.js',
      'custom.css',
      'tabler-theme.css',
      'theme-settings.js',
      'settings-page.js',
      'diagnostics-modal.css',
      'sentry-helpers.js',
      'partials/head-theme.html',
      'partials/header.html',
      'partials/page-body-start.html',
      'partials/page-body-end.html',
      'partials/footer.html',
    ];
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
const versionHandler = versionRoute.makeHandler({ pkg, config, assetVersion: ASSET_VERSION });
app.get('/api/version', versionHandler);

function applyAssetVersionToHtml(html) {
  if (!ASSET_VERSION) return html;
  const v = encodeURIComponent(String(ASSET_VERSION));
  return String(html || '').replace(/\b(href|src)="(\/(?!assets\/)[^"?]+\.(?:css|js))"/g, (_m, attr, url) => {
    return `${attr}="${url}?v=${v}"`;
  });
}

// Simple server-side include: <!--#include partials/header.html-->
const _includeCache = {};
const _includeCacheEnabled = config.nodeEnv === 'production' && config.includeCache;

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

function stripAdminMarkupFromSettings(html) {
  return String(html || '')
    .replace(/<!-- KEXO_ADMIN_NAV_START -->[\s\S]*?<!-- KEXO_ADMIN_NAV_END -->/g, '')
    .replace(/<!-- KEXO_ADMIN_PANEL_START -->[\s\S]*?<!-- KEXO_ADMIN_PANEL_END -->/g, '')
    .replace(/<!-- KEXO_ADMIN_SCRIPT_START -->[\s\S]*?<!-- KEXO_ADMIN_SCRIPT_END -->/g, '')
    .replace(/<!-- KEXO_COST_EXPENSES_NAV_START -->[\s\S]*?<!-- KEXO_COST_EXPENSES_NAV_END -->/g, '')
    .replace(/<!-- KEXO_COST_EXPENSES_PANEL_START -->[\s\S]*?<!-- KEXO_COST_EXPENSES_PANEL_END -->/g, '')
    .replace(/<!-- KEXO_COST_EXPENSES_SCRIPT_START -->[\s\S]*?<!-- KEXO_COST_EXPENSES_SCRIPT_END -->/g, '');
}

/** Parse tab from query and return valid main tab key. Mirrors settings-page.js logic. */
function getSettingsInitialTabFromQuery(queryOrObj) {
  const params = queryOrObj && typeof queryOrObj === 'object' && !(queryOrObj instanceof URLSearchParams)
    ? new URLSearchParams(queryOrObj)
    : new URLSearchParams(typeof queryOrObj === 'string' ? queryOrObj : '');
  let rawTab = String(params.get('tab') || '').trim().toLowerCase();
  if (rawTab === 'sources') rawTab = 'attribution';
  if (rawTab === 'general' || rawTab === 'assets' || rawTab === 'theme') rawTab = 'kexo';
  if (rawTab === 'charts' || rawTab === 'kpis') rawTab = 'layout';
  const allowed = new Set(['kexo', 'integrations', 'attribution', 'insights', 'layout', 'cost-expenses', 'admin']);
  if (!allowed.has(rawTab)) return 'kexo';
  return rawTab;
}

/** Apply correct settings panel and nav active state from URL so direct links show the right tab immediately (no flash). */
function applySettingsInitialTab(html, queryOrObj, hasAdminNav, hasCostExpensesNav) {
  const tab = getSettingsInitialTabFromQuery(queryOrObj);
  if (tab === 'admin' && !hasAdminNav) return html;
  if (tab === 'cost-expenses' && !hasCostExpensesNav) return html;
  const navClass = 'list-group-item list-group-item-action d-flex align-items-center';
  const navClassActive = navClass + ' active';
  let out = String(html || '')
    .replace(/\bid="settings-panel-kexo"\s+class="settings-panel active"/, 'id="settings-panel-kexo" class="settings-panel"')
    .replace(/\bid="settings-panel-integrations"\s+class="settings-panel"/, tab === 'integrations' ? 'id="settings-panel-integrations" class="settings-panel active"' : 'id="settings-panel-integrations" class="settings-panel"')
    .replace(/\bid="settings-panel-attribution"\s+class="settings-panel"/, tab === 'attribution' ? 'id="settings-panel-attribution" class="settings-panel active"' : 'id="settings-panel-attribution" class="settings-panel"')
    .replace(/\bid="settings-panel-insights"\s+class="settings-panel"/, tab === 'insights' ? 'id="settings-panel-insights" class="settings-panel active"' : 'id="settings-panel-insights" class="settings-panel"')
    .replace(/\bid="settings-panel-layout"\s+class="settings-panel"/, tab === 'layout' ? 'id="settings-panel-layout" class="settings-panel active"' : 'id="settings-panel-layout" class="settings-panel"')
    .replace(/\bid="settings-panel-cost-expenses"\s+class="settings-panel"/, tab === 'cost-expenses' ? 'id="settings-panel-cost-expenses" class="settings-panel active"' : 'id="settings-panel-cost-expenses" class="settings-panel"')
    .replace(/\bid="settings-panel-admin"\s+class="settings-panel[^"]*"/, tab === 'admin' ? 'id="settings-panel-admin" class="settings-panel active kexo-admin-only"' : 'id="settings-panel-admin" class="settings-panel kexo-admin-only"')
    .replace(/\bid="settings-panel-kexo"\s+class="settings-panel"/, tab === 'kexo' ? 'id="settings-panel-kexo" class="settings-panel active"' : 'id="settings-panel-kexo" class="settings-panel"');
  // Nav: add active to the correct parent tab link
  const navIds = ['kexo', 'integrations', 'layout', 'attribution', 'insights', 'cost-expenses', 'admin'];
  for (const id of navIds) {
    if (id === 'admin' && !hasAdminNav) continue;
    if (id === 'cost-expenses' && !hasCostExpensesNav) continue;
    const needle = `id="settings-tab-${id}" class="${navClass}"`;
    const replacement = `id="settings-tab-${id}" class="${tab === id ? navClassActive : navClass}"`;
    out = out.replace(needle, replacement);
  }
  return out;
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
insightsPagesRouter.get('/snapshot', (req, res) => sendPage(res, 'insights/snapshot.html'));
insightsPagesRouter.get('/countries', (req, res) => sendPage(res, 'insights/countries.html'));
insightsPagesRouter.get('/products', (req, res) => sendPage(res, 'insights/products.html'));
insightsPagesRouter.get('/variants', (req, res) => sendPage(res, 'insights/variants.html'));
insightsPagesRouter.get('/payment-types', (req, res) => sendPage(res, 'insights/payment-types.html'));
// Alias: keep /payment-types working but allow canonical naming in UI/links.
insightsPagesRouter.get('/payment-methods', (req, res) => sendPage(res, 'insights/payment-types.html'));
insightsPagesRouter.get('/abandoned-carts', (req, res) => sendPage(res, 'insights/abandoned-carts.html'));

const acquisitionPagesRouter = express.Router();
acquisitionPagesRouter.get('/attribution', (req, res) => sendPage(res, 'acquisition/attribution.html'));
acquisitionPagesRouter.get('/browsers', (req, res) => sendPage(res, 'acquisition/browsers.html'));
acquisitionPagesRouter.get('/devices', (req, res) => sendPage(res, 'acquisition/devices.html'));

const integrationsPagesRouter = express.Router();
integrationsPagesRouter.get('/google-ads', (req, res) => sendPage(res, 'integrations/google-ads.html'));

const toolsPagesRouter = express.Router();
toolsPagesRouter.get('/compare-conversion-rate', (req, res) => sendPage(res, 'tools/compare-conversion-rate.html'));
toolsPagesRouter.get('/shipping-cr', (req, res) => sendPage(res, 'tools/shipping-cr.html'));
toolsPagesRouter.get('/click-order-lookup', (req, res) => sendPage(res, 'tools/click-order-lookup.html'));
toolsPagesRouter.get('/change-pins', (req, res) => sendPage(res, 'tools/change-pins.html'));

// Base folder routes should canonicalize to leaf pages (avoid automatic /path -> /path/ redirects).
app.get('/dashboard', redirectWithQuery(301, '/dashboard/overview'));
app.get('/dashboard/', redirectWithQuery(301, '/dashboard/overview'));
app.get('/acquisition', redirectWithQuery(301, '/acquisition/attribution'));
app.get('/acquisition/', redirectWithQuery(301, '/acquisition/attribution'));
// Legacy Traffic routes -> Acquisition
app.get('/traffic', redirectWithQuery(301, '/acquisition/attribution'));
app.get('/traffic/', redirectWithQuery(301, '/acquisition/attribution'));
app.get('/traffic/channels', redirectWithQuery(301, '/acquisition/attribution'));
app.get('/traffic/channels/', redirectWithQuery(301, '/acquisition/attribution'));
app.get('/traffic/device', redirectWithQuery(301, '/acquisition/devices'));
app.get('/traffic/device/', redirectWithQuery(301, '/acquisition/devices'));
app.get('/integrations', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/integrations/', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/tools', redirectWithQuery(301, '/tools/compare-conversion-rate'));
app.get('/tools/', redirectWithQuery(301, '/tools/compare-conversion-rate'));

app.use('/dashboard', dashboardPagesRouter);
app.use('/insights', insightsPagesRouter);
app.use('/acquisition', acquisitionPagesRouter);
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
app.get('/payment-types', redirectWithQuery(301, '/insights/payment-types'));
app.get('/payment-methods', redirectWithQuery(301, '/insights/payment-methods'));
app.get('/abandoned-carts', redirectWithQuery(301, '/insights/abandoned-carts'));
app.get('/channels', redirectWithQuery(301, '/acquisition/attribution'));
app.get('/type', redirectWithQuery(301, '/acquisition/devices'));
app.get('/browsers', redirectWithQuery(301, '/acquisition/browsers'));
app.get('/ads', redirectWithQuery(301, '/integrations/google-ads'));
app.get('/compare-conversion-rate', redirectWithQuery(301, '/tools/compare-conversion-rate'));
app.get('/shipping-cr', redirectWithQuery(301, '/tools/shipping-cr'));
app.get('/click-order-lookup', redirectWithQuery(301, '/tools/click-order-lookup'));
app.get('/change-pins', redirectWithQuery(301, '/tools/change-pins'));
app.get('/settings', async (req, res, next) => {
  try {
    const isMaster = await isMasterRequest(req);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const filePath = path.join(__dirname, 'public', 'settings.html');
    const raw = fs.readFileSync(filePath, 'utf8');
    let html = resolveIncludes(raw);
    html = applySentryTemplate(html);
    if (!isMaster) html = stripAdminMarkupFromSettings(html);
    const hasAdminNav = html.includes('id="settings-tab-admin"');
    const hasCostExpensesNav = html.includes('id="settings-tab-cost-expenses"');
    html = applySettingsInitialTab(html, req.query, hasAdminNav, hasCostExpensesNav);
    res.type('html').send(applyAssetVersionToHtml(html));
  } catch (err) {
    next(err);
  }
});
app.get('/upgrade', (req, res) => sendPage(res, 'upgrade.html'));
app.get('/ui-kit', (req, res) => sendPage(res, 'ui-kit.html'));
app.get('/admin', async (req, res, next) => {
  try {
    const isMaster = await isMasterRequest(req);
    const params = new URLSearchParams(req.query || '');
    const legacyTab = String(params.get('tab') || '').trim().toLowerCase();
    const adminTab = (legacyTab === 'controls' || legacyTab === 'diagnostics' || legacyTab === 'users') ? legacyTab : 'controls';
    if (isMaster) {
      return res.redirect(302, '/settings?tab=admin&adminTab=' + encodeURIComponent(adminTab));
    }
    return res.redirect(302, '/settings?tab=kexo');
  } catch (err) {
    next(err);
  }
});

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
const { up: up039 } = require('./migrations/039_active_sessions_last_seen_started_at_index');
const { up: up040 } = require('./migrations/040_orders_shopify_processed_at_paid_index');
const { up: up041 } = require('./migrations/041_orders_shopify_shipping_options');
const { up: up042 } = require('./migrations/042_orders_shopify_shipping_options_set_and_paid_price');
const { up: up043 } = require('./migrations/043_business_snapshot_perf_indexes');
const { up: up044 } = require('./migrations/044_backfill_first_product_handle');
const { up: up045 } = require('./migrations/045_users');
const { up: up046 } = require('./migrations/046_rename_master_to_admin');
const { up: up047 } = require('./migrations/047_affiliate_attribution_and_fraud');
const { up: up048 } = require('./migrations/048_sessions_bs_network');
const { up: up049 } = require('./migrations/049_sessions_utm_term');
const { up: up050 } = require('./migrations/050_acquisition_attribution');
const { up: up051 } = require('./migrations/051_admin_notes');
const { up: up052 } = require('./migrations/052_change_pins');
const { up: up053 } = require('./migrations/053_sessions_click_ids');
const { up: up054 } = require('./migrations/054_sessions_city_browser');
const { up: up055 } = require('./migrations/055_purchases_payment_method');
const { up: up056 } = require('./migrations/056_edge_block_events');
const { up: up057 } = require('./migrations/057_purchases_payment_method_key');
const { up: up058 } = require('./migrations/058_attribution_tags');
const backup = require('./backup');
const { writeAudit } = require('./audit');
const { runAdsMigrations } = require('./ads/adsMigrate');

const APP_MIGRATIONS = [
  ['001_initial', up001],
  ['002_shop_sessions', up002],
  ['003_cart_order_money', up003],
  ['004_session_stats_fields', up004],
  ['005_utm_campaign', up005],
  ['006_utm_source_medium_content', up006],
  ['007_first_path', up007],
  ['008_purchases', up008],
  ['009_cf_traffic', up009],
  ['010_referrer', up010],
  ['011_entry_url', up011],
  ['012_bot_block_counts', up012],
  ['013_session_is_returning', up013],
  ['014_dedupe_legacy_purchases', up014],
  ['015_backfill_session_is_returning', up015],
  ['016_dedupe_h_purchases', up016],
  ['017_sales_truth_and_evidence', up017],
  ['018_orders_shopify_returning_fields', up018],
  ['019_customer_order_facts', up019],
  ['020_bot_block_counts_updated_at', up020],
  ['021_sessions_traffic_fields', up021],
  ['022_report_indexes', up022],
  ['023_reconcile_snapshots', up023],
  ['024_shopify_sessions_snapshots', up024],
  ['025_orders_shopify_line_items', up025],
  ['026_report_cache', up026],
  ['027_traffic_source_maps', up027],
  ['028_backfill_purchases_from_evidence', up028],
  ['029_dedupe_traffic_source_meta_labels', up029],
  ['030_canonicalize_built_in_traffic_sources', up030],
  ['031_orders_shopify_line_items_variant_title_index', up031],
  ['032_sessions_bs_ads_fields', up032],
  ['033_sessions_landing_composite_index', up033],
  ['034_perf_indexes_more', up034],
  ['035_growth_retention_indexes', up035],
  ['036_tools_compare_cr_indexes', up036],
  ['037_perf_composite_indexes_wal', up037],
  ['038_perf_indexes_events_traffic', up038],
  ['039_active_sessions_last_seen_started_at_index', up039],
  ['040_orders_shopify_processed_at_paid_index', up040],
  ['041_orders_shopify_shipping_options', up041],
  ['042_orders_shopify_shipping_options_set_and_paid_price', up042],
  ['043_business_snapshot_perf_indexes', up043],
  ['044_backfill_first_product_handle', up044],
  ['045_users', up045],
  ['046_rename_master_to_admin', up046],
  ['047_affiliate_attribution_and_fraud', up047],
  ['048_sessions_bs_network', up048],
  ['049_sessions_utm_term', up049],
  ['050_acquisition_attribution', up050],
  ['051_admin_notes', up051],
  ['052_change_pins', up052],
  ['053_sessions_click_ids', up053],
  ['054_sessions_city_browser', up054],
  ['055_purchases_payment_method', up055],
  ['056_edge_block_events', up056],
  ['057_purchases_payment_method_key', up057],
  ['058_attribution_tags', up058],
];

async function ensureAppMigrationsTable(db) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS app_migrations (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )`
  );
}

async function isAppMigrationApplied(db, id) {
  const row = await db.get('SELECT id FROM app_migrations WHERE id = ?', [id]);
  return !!row;
}

async function markAppMigrationApplied(db, id) {
  const now = Date.now();
  await db.run(
    'INSERT INTO app_migrations (id, applied_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING',
    [id, now]
  );
}

async function runAppMigrations(db) {
  await ensureAppMigrationsTable(db);
  for (const [id, up] of APP_MIGRATIONS) {
    const applied = await isAppMigrationApplied(db, id);
    if (applied) continue;
    await up();
    await markAppMigrationApplied(db, id);
  }
}

async function migrateAndStart() {
  // Open DB early so backups can inspect/operate.
  const db = getDb();

  // Required: backup before introducing the Sales Truth schema (first deploy only).
  const preBackup = await backup.backupBeforeTruthSchemaCreate();

  await runAppMigrations(db);

  try {
    const r = await runAdsMigrations();
    if (r && r.skipped) console.log('[ads.migrate] skipped:', r.reason);
    else console.log('[ads.migrate] applied:', r && r.applied != null ? r.applied : 0);
  } catch (e) {
    warnBackgroundFailure('[ads.migrate] failed (continuing):', e);
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
        salesTruth.ensureReconciled(shop, bounds.start, bounds.end, 'today').catch((err) => {
          warnBackgroundFailure('[truth-sync] startup reconcile failed:', err);
        });
      } catch (_) {}
    }, 1000);

    // Best-effort fraud catch-up: if purchases were backfilled/reconciled from evidence, ensure
    // we also have fraud_evaluations rows so the drawer can show a score (fail-open).
    setTimeout(() => {
      if (config.disableFraudBackfill) return;
      try {
        const fraudBackfill = require('./fraud/backfillFromEvidence');
        fraudBackfill.runOnce({ reason: 'startup' }).catch((err) => {
          warnBackgroundFailure('[fraud-backfill] startup run failed:', err);
        });
      } catch (_) {}
    }, 5000);

    // Warm long-range Shopify truth in the background so 7/14/30d reports are instant from our DB.
    (function warmSalesTruthRanges() {
      if (config.disableScheduledTruthSync) return;
      let inFlight = false;
      async function runOnce(rangeKey) {
        if (inFlight) return;
        inFlight = true;
        try {
          const store = require('./store');
          const salesTruth = require('./salesTruth');
          const shop = salesTruth.resolveShopForSales('');
          if (!shop) return;
          const tz = store.resolveAdminTimeZone();
          const nowMs = Date.now();
          const bounds = store.getRangeBounds(rangeKey, nowMs, tz);
          const scopeKey = salesTruth.scopeForRangeKey(rangeKey, 'range');
          await salesTruth.ensureReconciled(shop, bounds.start, bounds.end, scopeKey);
        } catch (err) {
          warnBackgroundFailure('[truth-sync] warmup failed:', err);
        } finally {
          inFlight = false;
        }
      }
      // Backfill a wider window shortly after boot (throttled inside salesTruth).
      setTimeout(() => {
        runOnce('30d').catch((err) => {
          warnBackgroundFailure('[truth-sync] warmup run failed:', err);
        });
      }, 20 * 1000);
    })();

    // Daily backups (fail-open). Retain last 7.
    (function scheduleDailyBackups() {
      if (config.disableScheduledBackups) return;
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
      setTimeout(() => {
        runOnce().catch((err) => {
          warnBackgroundFailure('[backup] startup daily run failed:', err);
        });
      }, 15000);
      setInterval(() => {
        runOnce().catch((err) => {
          warnBackgroundFailure('[backup] scheduled daily run failed:', err);
        });
      }, DAY_MS);
    })();
  });
}

migrateAndStart().catch(err => {
  console.error('Migration failed:', err);
  try {
    if (sentry && typeof sentry.captureException === 'function') {
      sentry.captureException(err, { context: 'startup.migrateAndStart' }, 'fatal');
    }
  } catch (_) {}
  process.exit(1);
});

// TTL cleanup every 2 minutes
setInterval(() => {
  cleanup.run().catch(err => warnBackgroundFailure('[cleanup] run failed:', err));
}, 2 * 60 * 1000);

// Ads spend sync runs in the background so the Ads table can refresh without wiping UI.
(function scheduleAdsSync() {
  if (config.disableScheduledAdsSync) return;

  const store = require('./store');
  const { syncGoogleAdsSpendHourly, syncGoogleAdsGeoDaily, syncGoogleAdsDeviceDaily, backfillCampaignIdsFromGclid } = require('./ads/googleAdsSpendSync');
  const { syncAttributedOrdersToAdsDb } = require('./ads/adsOrderAttributionSync');
  const { getAdsDb } = require('./ads/adsDb');

  const SPEND_SYNC_MS = 5 * 60 * 1000;
  const GEO_SYNC_MS = 60 * 60 * 1000;
  const DEVICE_SYNC_MS = 60 * 60 * 1000;
  const GCLID_BACKFILL_MS = 30 * 60 * 1000;
  const ATTR_SYNC_MS = 5 * 60 * 1000;
  const ATTR_BACKFILL_MS = 30 * 60 * 1000;

  let spendInFlight = false;
  let geoInFlight = false;
  let deviceInFlight = false;
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
      warnBackgroundFailure('[ads-sync] spend error:', err);
    } finally {
      spendInFlight = false;
    }
  }

  async function runGeoSync(rangeKey) {
    if (geoInFlight) return;
    geoInFlight = true;
    try {
      const adsDb = getAdsDb();
      if (!adsDb) return; // ADS_DB_URL not set — skip silently
      const { rangeStartTs, rangeEndTs } = resolveBounds(rangeKey);
      const out = await syncGoogleAdsGeoDaily({ rangeStartTs, rangeEndTs });
      if (out && out.ok) console.log('[ads-sync] geo:', out.upserts || 0, 'upserts', out.apiVersion ? '(' + out.apiVersion + ')' : '');
      else console.warn('[ads-sync] geo failed:', out && out.error ? out.error : 'failed');
    } catch (err) {
      warnBackgroundFailure('[ads-sync] geo error:', err);
    } finally {
      geoInFlight = false;
    }
  }

  async function runDeviceSync(rangeKey) {
    if (deviceInFlight) return;
    deviceInFlight = true;
    try {
      const adsDb = getAdsDb();
      if (!adsDb) return; // ADS_DB_URL not set — skip silently
      const { rangeStartTs, rangeEndTs } = resolveBounds(rangeKey);
      const out = await syncGoogleAdsDeviceDaily({ rangeStartTs, rangeEndTs });
      if (out && out.ok) console.log('[ads-sync] device:', out.upserts || 0, 'upserts', out.apiVersion ? '(' + out.apiVersion + ')' : '');
      else console.warn('[ads-sync] device failed:', out && out.error ? out.error : 'failed');
    } catch (err) {
      warnBackgroundFailure('[ads-sync] device error:', err);
    } finally {
      deviceInFlight = false;
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
      warnBackgroundFailure('[ads-sync] gclid backfill error:', err);
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
      warnBackgroundFailure('[ads-sync] attribution error:', err);
    } finally {
      attrInFlight = false;
    }
  }

  // Bootstrap: backfill a wider window once, then keep recent spend fresh.
  setTimeout(() => {
    runSpendSync('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] spend bootstrap failed:', err);
    });
  }, 30 * 1000);
  setInterval(() => {
    runSpendSync('3d').catch((err) => {
      warnBackgroundFailure('[ads-sync] spend scheduled failed:', err);
    });
  }, SPEND_SYNC_MS);

  // Geo (country) metrics: less frequent; keep recent window fresh.
  setTimeout(() => {
    runGeoSync('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] geo bootstrap failed:', err);
    });
  }, 60 * 1000);
  setInterval(() => {
    runGeoSync('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] geo scheduled failed:', err);
    });
  }, GEO_SYNC_MS);

  // Device metrics: less frequent; keep recent window fresh.
  setTimeout(() => {
    runDeviceSync('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] device bootstrap failed:', err);
    });
  }, 70 * 1000);
  setInterval(() => {
    runDeviceSync('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] device scheduled failed:', err);
    });
  }, DEVICE_SYNC_MS);

  // GCLID → campaign cache: less frequent (used for attribution fallbacks).
  setTimeout(() => {
    runGclidBackfill('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] gclid bootstrap failed:', err);
    });
  }, 45 * 1000);
  setInterval(() => {
    runGclidBackfill('7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] gclid scheduled failed:', err);
    });
  }, GCLID_BACKFILL_MS);

  // Order attribution into Ads DB: keep today's orders fresh frequently; backfill weekly window less often.
  setTimeout(() => {
    runOrderAttribution('7d', 'ads_sync_boot_7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] attribution bootstrap failed:', err);
    });
  }, 75 * 1000);
  setInterval(() => {
    runOrderAttribution('today', 'ads_sync_today').catch((err) => {
      warnBackgroundFailure('[ads-sync] attribution today failed:', err);
    });
  }, ATTR_SYNC_MS);
  setInterval(() => {
    runOrderAttribution('7d', 'ads_sync_7d').catch((err) => {
      warnBackgroundFailure('[ads-sync] attribution 7d failed:', err);
    });
  }, ATTR_BACKFILL_MS);
})();

// Google Ads postback: UploadClickConversions for Revenue/Profit (default off; enable in settings).
(function schedulePostbackSync() {
  if (config.disableScheduledPostback) return;
  const POSTBACK_MS = 5 * 60 * 1000;
  let postbackInFlight = false;
  async function runPostbackOnce() {
    if (postbackInFlight) return;
    postbackInFlight = true;
    try {
      const store = require('./store');
      const salesTruth = require('./salesTruth');
      const shop = salesTruth.resolveShopForSales('');
      if (!shop) return;
      const enabled = await store.getSetting('google_ads_postback_enabled');
      if (!enabled || String(enabled).toLowerCase() !== 'true') return;
      const { runPostbackCycle } = require('./ads/googleAdsPostback');
      await runPostbackCycle(shop, { postbackEnabled: true });
    } catch (err) {
      warnBackgroundFailure('[postback] run failed:', err);
    } finally {
      postbackInFlight = false;
    }
  }
  setTimeout(() => runPostbackOnce().catch(() => {}), 60 * 1000);
  setInterval(() => runPostbackOnce().catch(() => {}), POSTBACK_MS);
})();
