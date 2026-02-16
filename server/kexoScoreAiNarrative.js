/**
 * Optional AI narration for Kexo Score summary.
 * Uses ONLY provided context; never invents facts. Returns JSON: summary, key_drivers[], recommendation, links[].
 * Falls back to deterministic summary when AI disabled/unavailable/parse fails.
 */
const config = require('./config');

let _OpenAI = null;
let _client = null;
let _clientKey = '';

function getOpenAiClient(apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return null;
  if (_client && _clientKey === key) return _client;
  try {
    _OpenAI = _OpenAI || require('openai');
  } catch (_) {
    _OpenAI = null;
  }
  if (!_OpenAI) return null;
  try {
    _client = new _OpenAI({ apiKey: key });
    _clientKey = key;
    return _client;
  } catch (_) {
    _client = null;
    _clientKey = '';
    return null;
  }
}

function extractJsonObject(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) {}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
  }
  return null;
}

/**
 * Build deterministic summary from context/drivers (no AI).
 * Avoids repeating metric deltas already visible in bars; surfaces 2–4 strongest drivers from product/attribution/ads; recommendation keyed to dominant negative driver.
 * @param {{ context?: object, drivers?: object }} payload
 * @returns {{ summary: string, key_drivers: string[], recommendation: string, links: string[] }}
 */
function buildDeterministicSummary({ context, drivers } = {}) {
  const components = (context && context.components) || [];
  const product = (drivers && drivers.product) || [];
  const attribution = (drivers && drivers.attribution) || [];
  const ads = (drivers && drivers.ads) || [];

  const key_drivers = [];
  const fmtDeltaGbp = (d) => {
    const n = Number(d);
    if (!Number.isFinite(n)) return '';
    const sign = n >= 0 ? '+' : '';
    return ` (${sign}£${Math.abs(Math.round(n))} vs prior)`;
  };
  const fmtDeltaNum = (d) => {
    const n = Number(d);
    if (!Number.isFinite(n)) return '';
    const sign = n >= 0 ? '+' : '';
    return ` (${sign}${Math.round(n)} vs prior)`;
  };
  const productWithDelta = product
    .filter((p) => (p.deltaRevenue != null || p.deltaOrders != null))
    .map((p) => ({
      ...p,
      absDelta: Math.abs(Number(p.deltaRevenue) || 0) || Math.abs(Number(p.deltaOrders) || 0),
    }))
    .sort((a, b) => b.absDelta - a.absDelta);
  for (const p of productWithDelta.slice(0, 2)) {
    const name = (p.title || p.product_id || 'Product').toString().trim().slice(0, 60);
    const d = p.deltaRevenue != null ? p.deltaRevenue : p.deltaOrders;
    key_drivers.push(`Product: ${name}${p.deltaRevenue != null ? fmtDeltaGbp(p.deltaRevenue) : fmtDeltaNum(p.deltaOrders)}`);
  }
  const attrWithDelta = attribution
    .filter((a) => (a.deltaRevenue != null || a.deltaOrders != null))
    .map((a) => ({ ...a, absDelta: Math.abs(Number(a.deltaRevenue) || 0) }))
    .sort((a, b) => b.absDelta - a.absDelta);
  for (const a of attrWithDelta.slice(0, 1)) {
    const name = (a.variant || a.channel || 'Attribution').toString().trim().slice(0, 50);
    key_drivers.push(`Attribution: ${name}${a.deltaRevenue != null ? fmtDeltaGbp(a.deltaRevenue) : fmtDeltaNum(a.deltaOrders)}`);
  }
  const adsWithDelta = ads
    .filter((a) => (a.deltaRevenue != null || a.deltaRoas != null))
    .map((a) => ({ ...a, absDelta: Math.abs(Number(a.deltaRevenue) || 0) }))
    .sort((a, b) => b.absDelta - a.absDelta);
  for (const a of adsWithDelta.slice(0, 1)) {
    const name = (a.campaign_name || a.campaign_id || 'Ads').toString().trim().slice(0, 50);
    const delta = a.deltaRevenue != null ? fmtDeltaGbp(a.deltaRevenue) : (a.deltaRoas != null ? fmtDeltaNum(a.deltaRoas) : '');
    key_drivers.push(`Ads: ${name}${delta}`);
  }
  const finalDrivers = key_drivers.slice(0, 4);
  if (!finalDrivers.length) {
    finalDrivers.push('Compare current vs prior period in the breakdown below.');
  }

  let dominantNegative = null;
  if (productWithDelta.length && (Number(productWithDelta[0].deltaRevenue) || 0) < 0) {
    dominantNegative = 'product';
  } else if (attrWithDelta.length && (Number(attrWithDelta[0].deltaRevenue) || 0) < 0) {
    dominantNegative = 'attribution';
  } else if (adsWithDelta.length && (Number(adsWithDelta[0].deltaRevenue) || 0) < 0) {
    dominantNegative = 'ads';
  }
  const scoreComp = components.find((c) => c.key === 'revenue') || components[0];
  const scorePct = scoreComp && scoreComp.changeScore != null ? Number(scoreComp.changeScore) : null;
  let recommendation = 'Review the metric breakdown and product/attribution movers below.';
  if (dominantNegative === 'product') {
    recommendation = 'Focus on top product movers; consider promotions or inventory for declining products.';
  } else if (dominantNegative === 'attribution') {
    recommendation = 'Focus on attribution movers; review channel and source performance.';
  } else if (dominantNegative === 'ads') {
    recommendation = 'Review ads performance; adjust bids or creative for underperforming campaigns.';
  } else if (scorePct != null) {
    if (scorePct < 45) recommendation = 'Focus on top product and attribution movers below; consider promotions or inventory for declining products.';
    else if (scorePct > 55) recommendation = 'Momentum is positive; double down on top-performing products and channels.';
    else recommendation = 'Review product and attribution breakdown to find quick wins.';
  }

  const summary = finalDrivers.length
    ? `Strongest movers: ${finalDrivers[0].toLowerCase()}${finalDrivers.length > 1 ? '; ' + finalDrivers.slice(1, 2).join('; ') : ''}.`
    : 'Summary based on current vs prior period.';

  return {
    summary,
    key_drivers: finalDrivers,
    recommendation,
    links: [],
  };
}

/**
 * Generate AI or deterministic summary for Kexo Score modal.
 * @param {{ context: object, drivers: object }} payload
 * @returns {Promise<{ ok: boolean, summary?: string, key_drivers?: string[], recommendation?: string, links?: string[], ai_model?: string, note?: string }>}
 */
async function generateAiNarrative({ context, drivers } = {}) {
  const fallback = buildDeterministicSummary({ context, drivers });
  const enabled = !!(config.kexoAiEnabled && config.openaiApiKey);
  const model = (config.kexoAiModel || 'gpt-4o-mini').trim() || 'gpt-4o-mini';

  if (!enabled) {
    return {
      ok: true,
      summary: fallback.summary,
      key_drivers: fallback.key_drivers,
      recommendation: fallback.recommendation,
      links: fallback.links || [],
      note: 'deterministic',
    };
  }

  const client = getOpenAiClient(config.openaiApiKey);
  if (!client) {
    return {
      ok: true,
      ...fallback,
      note: 'deterministic',
    };
  }

  const input = {
    context: context && typeof context === 'object' ? context : {},
    drivers: drivers && typeof drivers === 'object' ? drivers : {},
  };

  const system = [
    'You are a concise analyst for a Kexo Score dashboard (revenue, orders, conversion, ROAS).',
    'Use ONLY the provided context and drivers. Do not invent numbers or facts.',
    'Return JSON only, with keys: summary, key_drivers, recommendation, links.',
    'summary: 1-3 sentences explaining why the score/metrics are up or down.',
    'key_drivers: array of 2-4 short bullet strings (product, attribution, or ads movers from the data).',
    'recommendation: one short sentence on where to focus next.',
    'links: optional array of strings (can be empty).',
  ].join(' ');

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(input) },
      ],
    });
    const text = resp && resp.choices && resp.choices[0] && resp.choices[0].message ? resp.choices[0].message.content : '';
    const obj = extractJsonObject(text);
    if (!obj || typeof obj !== 'object') {
      return { ok: true, ...fallback, ai_model: model, note: 'ai_parse_failed' };
    }
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : fallback.summary;
    const key_drivers = Array.isArray(obj.key_drivers)
      ? obj.key_drivers.map((d) => String(d || '').trim()).filter(Boolean).slice(0, 6)
      : fallback.key_drivers;
    const recommendation = typeof obj.recommendation === 'string' ? obj.recommendation.trim() : fallback.recommendation;
    const links = Array.isArray(obj.links) ? obj.links.map((l) => String(l || '').trim()).filter(Boolean).slice(0, 4) : (fallback.links || []);
    return {
      ok: true,
      summary,
      key_drivers,
      recommendation,
      links,
      ai_model: model,
    };
  } catch (err) {
    return {
      ok: true,
      ...fallback,
      ai_model: model,
      note: err && err.message ? String(err.message) : 'ai_failed',
    };
  }
}

module.exports = {
  buildDeterministicSummary,
  generateAiNarrative,
};
