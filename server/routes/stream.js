/**
 * GET /api/stream – SSE for admin. Auth via Shopify session (or skip for local dev).
 */

const sse = require('../sse');

function streamRouter(req, res, next) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sse.addClient(res);
}

module.exports = streamRouter;
