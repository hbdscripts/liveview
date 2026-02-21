/**
 * Diagnostics unresolved: create one notification per unresolved item (pixel offline, Google Ads not connected).
 * Repeat daily until fixed. Admin-only notifications.
 */
const { getDb } = require('./db');
const store = require('./store');
const salesTruth = require('./salesTruth');
const adsService = require('./ads/adsService');
const configStatus = require('./routes/configStatus');
const notificationsService = require('./notificationsService');

async function runOnce() {
  try {
    const prefs = await notificationsService.getPreferences();
    if (prefs.diagnostics_unresolved !== true) return;

    const shop = salesTruth.resolveShopForSales('');
    let token = '';
    if (shop) {
      try {
        const db = getDb();
        const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
        token = row && row.access_token ? String(row.access_token) : '';
      } catch (_) {}
    }

    let pixel = { ok: false, installed: null, ingestUrl: null, message: '' };
    try {
      if (shop && token) pixel = await configStatus.fetchShopifyWebPixelIngestUrl(shop, token);
      else if (shop && !token) pixel = { ok: false, installed: null, ingestUrl: null, message: 'No Shopify token' };
    } catch (err) {
      pixel = { ok: false, installed: null, ingestUrl: null, message: err && err.message ? String(err.message).slice(0, 120) : 'pixel_check_failed' };
    }

    let adsStatus = null;
    try {
      adsStatus = await adsService.getStatus(shop);
    } catch (err) {
      adsStatus = { ok: false, error: err && err.message ? String(err.message).slice(0, 120) : 'ads_status_failed' };
    }

    const gaProvider = adsStatus && Array.isArray(adsStatus.providers)
      ? adsStatus.providers.find((p) => p && String(p.key || '').toLowerCase() === 'google_ads')
      : null;
    const gaConnected = !!(gaProvider && gaProvider.connected);

    const unresolved = [];
    if (!(pixel && pixel.installed === true)) {
      unresolved.push({ key: 'pixel', label: 'Kexo Pixel' });
    }
    if (!gaConnected) {
      unresolved.push({ key: 'google_ads', label: 'Google Ads' });
    }

    for (const item of unresolved) {
      await notificationsService.create({
        type: 'diagnostics_unresolved',
        title: 'Unresolved: ' + item.label,
        body: item.label + ' is not connected or not healthy. Check Settings → Diagnostics.',
        link: '/settings?tab=admin&adminTab=diagnostics',
        meta: { key: item.key },
        forAdminOnly: true,
      });
    }
  } catch (err) {
    console.warn('[notifications-diagnostics] runOnce failed:', err && err.message ? err.message : err);
    throw err;
  }
}

module.exports = { runOnce };
