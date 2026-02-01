/**
 * GET /api/stream – SSE for admin. Auth via Shopify session (or skip for local dev).
 */

const sse = require('../sse');
const config = require('../config');

function streamRouter(req, res, next) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sse.addClient(res);

  const interval = setInterval(() => sse.heartbeat(), 30000);
  res.on('close', () => clearInterval(interval));
}

module.exports = streamRouter;
