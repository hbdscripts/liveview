/**
 * GET /api/shopify-sessions?shop=xxx.myshopify.com
 * Returns today's session count from Shopify (ShopifyQL) so the dashboard can align with Shopify.
 */

const { getDb } = require('../db');
const { fetchShopifySessionsToday } = require('./configStatus');
const store = require('../store');

async function getShopifySessionsToday(req, res) {
  const shop = (req.query.shop || '').trim().toLowerCase();
  if (!shop || !shop.endsWith('.myshopify.com')) {
    return res.status(400).json({ error: 'Missing or invalid shop (e.g. ?shop=store.myshopify.com)' });
  }

  const db = getDb();
  const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
  if (!row || !row.access_token) {
    return res.status(401).json({
      error: 'No access token for this store. Install the app (complete OAuth) first.',
    });
  }

  try {
    const result = await fetchShopifySessionsToday(shop, row.access_token);
    if (typeof result.count === 'number') {
      // Append snapshot (today). Fail-open if table doesn't exist.
      try {
        const timeZone = store.resolveAdminTimeZone();
        const nowMs = Date.now();
        const bounds = store.getRangeBounds('today', nowMs, timeZone);
        const dayYmd = new Date(bounds.start).toLocaleDateString('en-CA', { timeZone });
        await store.saveShopifySessionsSnapshot({
          shop,
          snapshotKey: 'today',
          dayYmd,
          sessionsCount: result.count,
          fetchedAt: nowMs,
        });
      } catch (_) {}
      return res.json({ sessionsToday: result.count });
    }
    return res.status(502).json({ error: result.error || 'Shopify sessions unavailable' });
  } catch (err) {
    console.error('[shopify-sessions]', err);
    return res.status(500).json({ error: 'Failed to fetch Shopify sessions' });
  }
}

module.exports = { getShopifySessionsToday };
