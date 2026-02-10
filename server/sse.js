/**
 * SSE broadcast: maintain list of admin clients and push session updates.
 */

const clients = new Set();
let heartbeatTimer = null;

function removeClient(res) {
  clients.delete(res);
  if (clients.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => heartbeat(), 30000);
}

function addClient(res) {
  clients.add(res);
  ensureHeartbeat();
  const cleanup = () => removeClient(res);
  res.on('close', cleanup);
  res.on('error', cleanup);
  res.on('aborted', cleanup);
}

function broadcast(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  for (const res of clients) {
    try {
      res.write(`data: ${msg}\n\n`);
    } catch (_) {
      clients.delete(res);
    }
  }
}

function heartbeat() {
  for (const res of clients) {
    try {
      res.write(': ping\n\n');
    } catch (_) {
      clients.delete(res);
    }
  }
}

module.exports = { addClient, broadcast, heartbeat };
