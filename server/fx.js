/**
 * FX helper: convert totals to GBP for reporting.
 *
 * Why:
 * - Shopify can emit checkout totals in the customer's currency (multi-currency).
 * - Our dashboard formats money as GBP (£), so we must convert before aggregating.
 *
 * Notes:
 * - Uses free, unauthenticated rate sources.
 * - Rates are cached in-memory (per process) and are NOT historical.
 */

const BASE = 'GBP';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

let cache = {
  fetchedAt: 0,
  gbpTo: null, // { USD: 1.27, HUF: 450.12, ... } meaning 1 GBP = X <currency>
  source: null,
};
let inflight = null;

function normalizeCurrency(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return c.slice(0, 8);
}

async function fetchGbpToRatesFromFrankfurter() {
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(BASE)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Frankfurter HTTP ' + res.status);
  const data = await res.json();
  if (!data || typeof data !== 'object' || !data.rates || typeof data.rates !== 'object') {
    throw new Error('Frankfurter invalid payload');
  }
  return { gbpTo: data.rates, source: 'frankfurter' };
}

async function fetchGbpToRatesFromOpenErApi() {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(BASE)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('open.er-api HTTP ' + res.status);
  const data = await res.json();
  const rates = data && typeof data === 'object' ? data.rates : null;
  if (!rates || typeof rates !== 'object') throw new Error('open.er-api invalid payload');
  return { gbpTo: rates, source: 'open.er-api' };
}

async function getGbpToRates() {
  const now = Date.now();
  if (cache.gbpTo && (now - cache.fetchedAt) < TTL_MS) return cache.gbpTo;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      try {
        const out = await fetchGbpToRatesFromFrankfurter();
        cache = { fetchedAt: Date.now(), gbpTo: out.gbpTo, source: out.source };
        return cache.gbpTo;
      } catch (e1) {
        const out = await fetchGbpToRatesFromOpenErApi();
        cache = { fetchedAt: Date.now(), gbpTo: out.gbpTo, source: out.source };
        return cache.gbpTo;
      }
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function getRatesToGbp() {
  const gbpTo = await getGbpToRates();
  const toGbp = { [BASE]: 1 };
  if (gbpTo && typeof gbpTo === 'object') {
    for (const [curRaw, rateRaw] of Object.entries(gbpTo)) {
      const cur = normalizeCurrency(curRaw);
      const rate = typeof rateRaw === 'number' ? rateRaw : Number(rateRaw);
      if (!cur || !Number.isFinite(rate) || rate <= 0) continue;
      if (cur === BASE) { toGbp[BASE] = 1; continue; }
      // If 1 GBP = rate <cur>, then 1 <cur> = 1/rate GBP.
      toGbp[cur] = 1 / rate;
    }
  }
  return toGbp;
}

function convertToGbp(amount, currency, ratesToGbp) {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  const cur = normalizeCurrency(currency) || BASE;
  if (cur === BASE) return n;
  const rate = ratesToGbp && typeof ratesToGbp === 'object' ? ratesToGbp[cur] : null;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return n * rate;
}

function getFxCacheInfo() {
  return { ...cache };
}

module.exports = {
  BASE,
  normalizeCurrency,
  getRatesToGbp,
  convertToGbp,
  getFxCacheInfo,
};

