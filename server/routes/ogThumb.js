/**
 * GET /api/og-thumb?url=https://store.myshopify.com/path
 * Fetches the URL (allowed: https only, host must contain myshopify.com), parses og:image, redirects to it.
 * Used by dashboard for 40x40 thumbnails next to "Last action" links.
 */

function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.includes('myshopify.com');
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
      res.status(502).send('Upstream error');
      return;
    }
    const html = await resp.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (match && match[1]) {
      let imgUrl = match[1].trim();
      if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
      res.redirect(302, imgUrl);
      return;
    }
  } catch (_) {}
  res.status(204).end();
}

module.exports = { handleOgThumb };
