/**
 * GET /api/og-thumb?url=https://www.example.com/path
 * Fetches the URL (allowed: https only; host must be myshopify.com or STORE_MAIN_DOMAIN), parses og:image, redirects to it.
 * Used by dashboard for product thumbnails next to "Last action" links.
 */

const config = require('../config');

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (u.hostname.includes('myshopify.com')) return true;
    if (config.storeMainDomain) {
      const mainHost = new URL(config.storeMainDomain).hostname;
      return u.hostname === mainHost;
    }
    return false;
  } catch (_) {
    return false;
  }
}

async function handleOgThumb(req, res) {
  const rawUrl = (req.query && req.query.url) || '';
  if (!rawUrl || !isAllowedUrl(rawUrl)) {
    res.status(400).send('Invalid or disallowed url');
    return;
  }
  try {
    const resp = await fetch(rawUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveVisitors/1)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      res.status(204).end();
      return;
    }
    const html = await resp.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (match && match[1]) {
      let imgUrl = match[1].trim();
      if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
      try {
        const u = new URL(imgUrl);
        u.searchParams.set('width', '100');
        u.searchParams.set('height', '100');
        if (u.hostname.includes('shopify.com')) u.searchParams.set('crop', 'center');
        imgUrl = u.toString();
      } catch (_) {}
      res.redirect(302, imgUrl);
      return;
    }
  } catch (_) {}
  res.status(204).end();
}

module.exports = { handleOgThumb };
