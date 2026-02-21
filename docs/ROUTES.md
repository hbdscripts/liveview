# Route → handler map

Generated from `server/index.js`. To regenerate: `node scripts/generate-routes-doc.js` (or `npm run docs:routes`).
When adding a route, re-run this script so the doc stays in sync.

## API routes

| Method | Path | Handler |
|--------|------|---------|
| GET | `/` | (inline) |
| GET | `/abandoned-carts` | (inline) |
| GET | `/acquisition` | (inline) |
| USE | `/acquisition` | (mounted router) |
| GET | `/acquisition/` | (inline) |
| GET | `/admin` | (inline) |
| GET | `/ads` | (inline) |
| USE | `/api/abandoned-carts` | server/routes/abandonedCarts.js |
| USE | `/api/admin` | (+ requireMaster) server/routes/adminUsers.js |
| USE | `/api/ads` | server/routes/ads.js |
| GET | `/api/asset-overrides` | server/routes/assets.js (getAssetOverrides) |
| POST | `/api/assets/upload` | (inline) |
| GET | `/api/attribution/config` | server/routes/attribution.js (getAttributionConfig) |
| POST | `/api/attribution/config` | (+ requireMaster) server/routes/attribution.js (postAttributionConfig) |
| POST | `/api/attribution/icons` | (+ requireMaster) server/routes/attribution.js (postAttributionIcons) |
| POST | `/api/attribution/map` | (+ requireMaster) server/routes/attribution.js (postAttributionMap) |
| GET | `/api/attribution/observed` | server/routes/attribution.js (getAttributionObserved) |
| GET | `/api/attribution/prefs` | server/routes/attribution.js (getAttributionPrefs) |
| POST | `/api/attribution/prefs` | (+ requireMaster) server/routes/attribution.js (postAttributionPrefs) |
| GET | `/api/attribution/report` | server/routes/attribution.js (getAttributionReport) |
| DELETE | `/api/attribution/rules/:id` | (+ requireMaster) server/routes/attribution.js (deleteAttributionRule) |
| PATCH | `/api/attribution/rules/:id` | (+ requireMaster) server/routes/attribution.js (patchAttributionRule) |
| GET | `/api/available-days` | server/routes/availableDays.js (getAvailableDays) |
| POST | `/api/bot-blocked` | server/routes/botBlocked.js (postBotBlocked) |
| GET | `/api/browsers/series` | server/routes/browsers.js (getBrowsersSeries) |
| GET | `/api/browsers/table` | server/routes/browsers.js (getBrowsersTable) |
| GET | `/api/business-snapshot` | (+ requireMaster) server/routes/businessSnapshot.js (getBusinessSnapshot) |
| GET | `/api/chart-settings/:chartKey` | server/routes/settings.js (getChartSettings) |
| PUT | `/api/chart-settings/:chartKey` | server/routes/settings.js (putChartSettings) |
| GET | `/api/config-status` | server/routes/configStatus.js |
| GET | `/api/cost-breakdown` | (+ requireMaster) server/routes/costBreakdown.js (getCostBreakdown) |
| GET | `/api/cost/health` | (+ requireMaster) server/routes/costHealth.js (getCostHealth) |
| GET | `/api/dashboard-series` | server/routes/dashboardSeries.js (getDashboardSeries) |
| GET | `/api/devices/observed` | server/routes/devices.js (getObservedDevices) |
| GET | `/api/devices/report` | server/routes/devices.js (getDevicesReport) |
| POST | `/api/edge-blocked` | server/routes/edgeBlocked.js (postEdgeBlocked) |
| GET | `/api/edge-blocked/events` | server/routes/edgeBlocked.js (getEdgeBlockedEvents) |
| GET | `/api/edge-blocked/summary` | server/routes/edgeBlocked.js (getEdgeBlockedSummary) |
| GET | `/api/footer-logo` | server/routes/assets.js (getFooterLogo) |
| USE | `/api/fraud` | server/routes/fraud.js |
| GET | `/api/header-logo` | server/routes/assets.js (getHeaderLogo) |
| USE | `/api/ingest` | (mounted router) |
| GET | `/api/insights-variants` | server/routes/insightsVariants.js (getInsightsVariants) |
| GET | `/api/insights-variants-suggestions` | server/routes/insightsVariantsSuggestions.js (getInsightsVariantsSuggestions) |
| POST | `/api/insights-variants-suggestions/apply` | server/routes/insightsVariantsSuggestions.js (postApplyInsightsVariantsSuggestions) |
| USE | `/api/integrations/google-ads/issues` | server/routes/googleAdsIssues.js |
| GET | `/api/kexo-score` | server/routes/kexoScore.js (getKexoScore) |
| GET | `/api/kexo-score-summary` | server/routes/kexoScoreSummary.js (getKexoScoreSummary) |
| GET | `/api/kpis` | server/routes/kpis.js (getKpis) |
| GET | `/api/kpis-expanded-extra` | server/routes/kpisExpandedExtra.js (getKpisExpandedExtra) |
| GET | `/api/latest-sale` | server/routes/latestSale.js (getLatestSale) |
| GET | `/api/latest-sales` | server/routes/sessions.js (latestSales) |
| GET | `/api/me` | server/routes/me.js |
| GET | `/api/og-thumb` | server/routes/ogThumb.js (handleOgThumb) |
| GET | `/api/page-insights` | server/routes/pageInsights.js (getPageInsights) |
| GET | `/api/payment-methods/catalog` | server/routes/paymentMethods.js (getPaymentMethodsCatalog) |
| GET | `/api/payment-methods/report` | server/routes/paymentMethods.js (getPaymentMethodsReport) |
| GET | `/api/payment-types/series` | server/routes/paymentTypes.js (getPaymentTypesSeries) |
| GET | `/api/payment-types/table` | server/routes/paymentTypes.js (getPaymentTypesTable) |
| GET | `/api/pixel/config` | server/routes/pixel.js (getPixelConfig) |
| GET | `/api/pixel/ensure` | server/routes/pixel.js (ensurePixel) |
| POST | `/api/pixel/ensure` | server/routes/pixel.js (ensurePixel) |
| GET | `/api/pixel/status` | server/routes/pixel.js (getPixelStatus) |
| GET | `/api/product-insights` | server/routes/productInsights.js (getProductInsights) |
| GET | `/api/reconcile-sales` | (+ requireMaster) server/routes/reconcileSales.js (reconcileSales) |
| POST | `/api/reconcile-sales` | (+ requireMaster) server/routes/reconcileSales.js (reconcileSales) |
| GET | `/api/sales-diagnostics` | server/routes/salesDiagnostics.js (getSalesDiagnostics) |
| GET | `/api/sessions` | server/routes/sessions.js (list) |
| GET | `/api/sessions/:id/events` | server/routes/sessions.js (events) |
| GET | `/api/sessions/online-series` | server/routes/sessions.js (onlineSeries) |
| GET | `/api/settings` | server/routes/settings.js (getSettings) |
| POST | `/api/settings` | server/routes/settings.js (postSettings) |
| GET | `/api/settings/profit-rules` | (+ requireMaster) server/routes/settings.js (getProfitRules) |
| PUT | `/api/settings/profit-rules` | (+ requireMaster) server/routes/settings.js (putProfitRules) |
| GET | `/api/shopify-best-sellers` | server/routes/shopifyBestSellers.js (getShopifyBestSellers) |
| GET | `/api/shopify-best-variants` | server/routes/shopifyBestVariants.js (getShopifyBestVariants) |
| GET | `/api/shopify-chain-styles` | server/routes/shopifyChainStyles.js (getShopifyChainStyles) |
| GET | `/api/shopify-finishes` | server/routes/shopifyFinishes.js (getShopifyFinishes) |
| GET | `/api/shopify-leaderboard` | server/routes/shopifyLeaderboard.js (getShopifyLeaderboard) |
| GET | `/api/shopify-lengths` | server/routes/shopifyLengths.js (getShopifyLengths) |
| GET | `/api/shopify-sales` | server/routes/shopifySales.js (getShopifySalesToday) |
| GET | `/api/shopify-sessions` | server/routes/shopifySessions.js (getShopifySessionsToday) |
| GET | `/api/shopify-worst-variants` | server/routes/shopifyWorstVariants.js (getShopifyWorstVariants) |
| GET | `/api/stats` | server/routes/stats.js (getStats) |
| GET | `/api/store-base-url` | (inline) |
| GET | `/api/stream` | server/routes/stream.js |
| GET | `/api/theme-defaults` | server/routes/settings.js (getThemeDefaults) |
| POST | `/api/theme-defaults` | server/routes/settings.js (postThemeDefaults) |
| USE | `/api/tools` | server/routes/tools.js |
| GET | `/api/verify-sales` | server/routes/verifySales.js (verifySales) |
| GET | `/api/version` | (inline) |
| GET | `/api/worst-products` | server/routes/worstProducts.js (getWorstProducts) |
| GET | `/app.css` | (inline) |
| GET | `/app/dashboard` | (inline) |
| GET | `/app/login` | server/routes/login.js (handleGetLogin) |
| GET | `/app/logout` | server/routes/login.js (handleLogout) |
| GET | `/app/register` | server/routes/login.js (handleGetRegister) |
| USE | `/assets` | (mounted router) |
| GET | `/assets/cash-register.mp3` | (inline) |
| GET | `/auth/callback` | (inline) |
| GET | `/auth/google` | server/routes/oauthLogin.js (handleGoogleRedirect) |
| GET | `/auth/google/callback` | server/routes/oauthLogin.js (handleGoogleCallback) |
| POST | `/auth/local/login` | server/routes/localAuth.js (postLogin) |
| POST | `/auth/local/register` | server/routes/localAuth.js (postRegister) |
| GET | `/auth/shopify-login` | server/routes/oauthLogin.js (handleShopifyLoginRedirect) |
| GET | `/auth/shopify-login/callback` | server/routes/oauthLogin.js (handleShopifyLoginCallback) |
| GET | `/auth/shopify/callback` | (inline) |
| GET | `/browsers` | (inline) |
| GET | `/change-pins` | (inline) |
| GET | `/channels` | (inline) |
| GET | `/click-order-lookup` | (inline) |
| GET | `/compare-conversion-rate` | (inline) |
| GET | `/countries` | (inline) |
| GET | `/dashboard` | (inline) |
| USE | `/dashboard` | (mounted router) |
| GET | `/dashboard/` | (inline) |
| GET | `/date` | (inline) |
| GET | `/debug-sentry` | (inline) |
| GET | `/health` | (inline) |
| GET | `/icon-registry.js` | (inline) |
| USE | `/insights` | (mounted router) |
| GET | `/integrations` | (inline) |
| USE | `/integrations` | (mounted router) |
| GET | `/integrations/` | (inline) |
| GET | `/live` | (inline) |
| GET | `/mobile-unsupported` | (inline) |
| GET | `/overview` | (inline) |
| GET | `/payment-methods` | (inline) |
| GET | `/payment-types` | (inline) |
| GET | `/products` | (inline) |
| GET | `/robots.txt` | (inline) |
| GET | `/sales` | (inline) |
| GET | `/settings` | (inline) |
| GET | `/shipping-cr` | (inline) |
| GET | `/theme-vars.css` | server/routes/settings.js (getThemeVarsCss) |
| GET | `/tools` | (inline) |
| USE | `/tools` | (mounted router) |
| GET | `/tools/` | (inline) |
| GET | `/tools/ads` | (inline) |
| GET | `/tools/ads/` | (inline) |
| GET | `/traffic` | (inline) |
| GET | `/traffic/` | (inline) |
| GET | `/traffic/channels` | (inline) |
| GET | `/traffic/channels/` | (inline) |
| GET | `/traffic/device` | (inline) |
| GET | `/traffic/device/` | (inline) |
| GET | `/type` | (inline) |
| GET | `/ui-kit` | (inline) |
| GET | `/upgrade` | (inline) |
| GET | `/variants` | (inline) |

## Page routes (URL → HTML)

| Path | File |
|------|------|
| `/acquisition/attribution` | `server/public/acquisition/attribution.html` |
| `/acquisition/browsers` | `server/public/acquisition/browsers.html` |
| `/acquisition/devices` | `server/public/acquisition/devices.html` |
| `/dashboard/live` | `server/public/dashboard/live.html` |
| `/dashboard/overview` | `server/public/dashboard/overview.html` |
| `/dashboard/sales` | `server/public/dashboard/sales.html` |
| `/dashboard/table` | `server/public/dashboard/table.html` |
| `/insights/abandoned-carts` | `server/public/insights/abandoned-carts.html` |
| `/insights/countries` | `server/public/insights/countries.html` |
| `/insights/payment-methods` | `server/public/insights/payment-types.html` |
| `/insights/products` | `server/public/insights/products.html` |
| `/insights/snapshot` | `server/public/insights/snapshot.html` |
| `/insights/variants` | `server/public/insights/variants.html` |
| `/integrations/google-ads` | `server/public/integrations/google-ads.html` |
| `/tools/change-pins` | `server/public/tools/change-pins.html` |
| `/tools/click-order-lookup` | `server/public/tools/click-order-lookup.html` |
| `/tools/compare-conversion-rate` | `server/public/tools/compare-conversion-rate.html` |
| `/tools/shipping-cr` | `server/public/tools/shipping-cr.html` |
| `/ui-kit` | `server/public/ui-kit.html` |
| `/upgrade` | `server/public/upgrade.html` |
