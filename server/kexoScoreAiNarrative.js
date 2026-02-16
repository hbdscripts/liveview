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
 * @param {{ context?: object, drivers?: object }} payload
 * @returns {{ summary: string, key_drivers: string[], recommendation: string, links: string[] }}
 */
function buildDeterministicSummary({ context, drivers } = {}) {
  const components = (context && context.components) || [];
  const product = (drivers && drivers.product) || [];
  const attribution = (drivers && drivers.attribution) || [];
  const ads = (drivers && drivers.ads) || [];

  const bullets = [];
  for (const c of components.slice(0, 4)) {
    const cur = c.value != null ? Number(c.value) : null;
    const prev = c.previous != null ? Number(c.previous) : null;
    if (cur != null && prev != null && prev !== 0) {
      const pct = Math.round(((cur - prev) / prev) * 100);
      const dir = pct >= 0 ? 'up' : 'down';
      bullets.push(`${c.label} is ${dir} ${Math.abs(pct)}% vs prior period.`);
    }
  }
  if (product.length) {
    const topDown = product.filter((p) => (p.deltaRevenue || 0) < 0).slice(0, 2);
    if (topDown.length) {
      bullets.push(`Product revenue down: ${topDown.map((p) => (p.title || p.product_id || '')).slice(0, 1).join(', ')}.`);
    }
  }
  if (attribution.length) {
    const top = attribution.filter((a) => (a.deltaRevenue || 0) !== 0).slice(0, 1);
    if (top.length) {
      bullets.push(`Attribution: ${top[0].variant} revenue ${(top[0].deltaRevenue || 0) >= 0 ? 'up' : 'down'} vs prior.`);
    }
  }
  if (ads.length) {
    const top = ads.filter((a) => (a.deltaRevenue || 0) !== 0).slice(0, 1);
    if (top.length) {
      bullets.push(`Ads: ${top[0].campaign_name || top[0].campaign_id} revenue ${(top[0].deltaRevenue || 0) >= 0 ? 'up' : 'down'}.`);
    }
  }
  const key_drivers = bullets.length ? bullets.slice(0, 4) : ['Compare current vs prior period in the breakdown below.'];

  const scoreComp = components.find((c) => c.key === 'revenue') || components[0];
  const rec = scoreComp && scoreComp.changeScore != null
    ? (scoreComp.changeScore < 45
      ? 'Focus on top product and attribution movers below; consider promotions or inventory for declining products.'
      : scoreComp.changeScore > 55
        ? 'Momentum is positive; double down on top-performing products and channels.'
        : 'Review product and attribution breakdown to find quick wins.')
    : 'Review the metric breakdown and product/attribution movers below.';

  const summary = key_drivers.length
    ? `Kexo Score summary: ${key_drivers[0].toLowerCase()} ${key_drivers.length > 1 ? ' ' + key_drivers.slice(1, 2).join(' ') : ''}.`
    : 'Summary based on current vs prior period.';

  return {
    summary,
    key_drivers,
    recommendation: rec,
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
