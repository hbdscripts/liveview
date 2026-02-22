function sleep(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, n));
}

module.exports = { sleep };

