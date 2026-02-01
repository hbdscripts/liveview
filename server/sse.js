/**
 * SSE broadcast: maintain list of admin clients and push session updates.
 */

const clients = new Set();

function addClient(res) {
  clients.add(res);
  res.on('close', () => clients.delete(res));
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
