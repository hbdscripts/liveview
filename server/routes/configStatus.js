/**
 * GET /api/config-status – non-sensitive config for admin panel.
 */

const config = require('../config');
const store = require('../store');

function configStatus(req, res, next) {
  const hasShopify = !!(config.shopify.apiKey && config.shopify.apiSecret);
  const hasAppUrl = !!config.shopify.appUrl;
  const hasIngestSecret = !!config.ingestSecret;
  const ingestUrl = `${config.shopify.appUrl.replace(/\/$/, '')}/api/ingest`;

  store.isTrackingEnabled()
    .then(enabled => {
      res.json({
        shopify: { configured: hasShopify },
        appUrl: { configured: hasAppUrl, value: config.shopify.appUrl },
        ingestSecret: { configured: hasIngestSecret },
        ingestUrl,
        trackingEnabled: enabled,
        adminTimezone: config.adminTimezone,
        sentry: { configured: !!(config.sentryDsn && config.sentryDsn.trim()) },
      });
    })
    .catch(() => {
      res.json({
        shopify: { configured: hasShopify },
        appUrl: { configured: hasAppUrl, value: config.shopify.appUrl },
        ingestSecret: { configured: hasIngestSecret },
        ingestUrl,
        trackingEnabled: config.trackingDefaultEnabled,
        adminTimezone: config.adminTimezone,
        sentry: { configured: !!(config.sentryDsn && config.sentryDsn.trim()) },
      });
    });
}

module.exports = configStatus;
