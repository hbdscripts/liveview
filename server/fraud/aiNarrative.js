/**
 * Optional AI narrative generation (feature-flagged).
 *
 * - Never blocks dashboards: callers should fire-and-forget.
 * - Never include raw IP, emails, names. Only pass safe evidence snapshot.
 */
const config = require('../config');

let _OpenAI = null;
let _client = null;
let _clientKey = '';

function scoreToRisk(score, threshold) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'Unknown';
  const t = Number(threshold);
  if (Number.isFinite(t) && s >= t + 15) return 'High';
  if (Number.isFinite(t) && s >= t) return 'Medium';
  if (s >= 60) return 'Medium';
  if (s >= 30) return 'Low';
  return 'Low';
}

function flagLabel(flagKey) {
  const k = String(flagKey || '').trim().toLowerCase();
  const map = {
    google_ads_conflict: 'Paid + affiliate conflict',
    no_affiliate_evidence: 'Affiliate hints without evidence',
    duplicate_ip_pattern: 'Repeated activity from same IP hash',
    late_injection: 'Late affiliate injection',
    low_engagement: 'Low engagement before checkout',
    suspicious_referrer: 'Suspicious referrer',
  };
  return map[k] || k;
}

function buildDeterministicSummary({ score, flags, threshold } = {}) {
  const s = Number(score);
  const risk = scoreToRisk(s, threshold);
  const list = Array.isArray(flags) ? flags : [];
  const top = list.slice(0, 4).map(flagLabel);
  const reasons = top.length ? top : ['No strong signals (score derived from weak indicators)'];
  const rec = risk === 'High'
    ? 'Review the attribution evidence. Consider denying affiliate payout if signals indicate paid traffic hijack or late injection.'
    : risk === 'Medium'
      ? 'Review the session attribution and timing. Monitor for repeated patterns before taking action.'
      : 'No immediate action recommended. Keep monitoring for repeated patterns.';
  const summary = `Automated analysis: ${risk} risk (score ${Number.isFinite(s) ? Math.trunc(s) : '—'}).`;
  return { summary, risk_level: risk, key_reasons: reasons, recommended_action: rec };
}

function getOpenAiClient(apiKey) {
  const key = (apiKey || '').trim();
  if (!key) return null;
  if (_client && _clientKey === key) return _client;
  try {
    // Official OpenAI Node SDK (CommonJS).
    // eslint-disable-next-line global-require
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
  // Common: model returns JSON only.
  try { return JSON.parse(s); } catch (_) {}
  // Fallback: extract first {...} block.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = s.slice(start, end + 1);
    try { return JSON.parse(slice); } catch (_) { return null; }
  }
  return null;
}

async function generateAiSummary({ score, flags, evidence, fraudCfg } = {}) {
  const enabled = !!(config.fraudAiEnabled && config.openaiApiKey);
  const provider = fraudCfg && fraudCfg.ai && fraudCfg.ai.provider ? String(fraudCfg.ai.provider).trim().toLowerCase() : 'openai';
  const model = fraudCfg && fraudCfg.ai && fraudCfg.ai.model ? String(fraudCfg.ai.model).trim() : 'gpt-4o-mini';
  const version = fraudCfg && fraudCfg.ai && fraudCfg.ai.version ? String(fraudCfg.ai.version).trim() : 'v1';
  if (!enabled) return { ok: false, reason: 'disabled' };
  if (provider !== 'openai') return { ok: false, reason: 'unsupported_provider' };
  const client = getOpenAiClient(config.openaiApiKey);
  if (!client) return { ok: false, reason: 'missing_client' };

  const threshold = fraudCfg && Number.isFinite(Number(fraudCfg.threshold)) ? Number(fraudCfg.threshold) : 70;
  const fallback = buildDeterministicSummary({ score, flags, threshold });

  // Keep payload small and safe.
  const input = {
    score: Number.isFinite(Number(score)) ? Math.trunc(Number(score)) : null,
    threshold,
    flags: (Array.isArray(flags) ? flags : []).slice(0, 12),
    evidence: evidence && typeof evidence === 'object' ? evidence : {},
  };

  const system = [
    'You are a fraud/abuse analyst for affiliate attribution.',
    'Use ONLY the provided evidence. Do not guess missing data.',
    'Never include raw IP, emails, names, or any PII.',
    'Return JSON only, with keys: summary, risk_level, key_reasons, recommended_action.',
    'summary must be 1-3 sentences, concise and actionable.',
    'risk_level must be one of: Low, Medium, High.',
    'key_reasons must be an array of 2-6 short bullets.',
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
      return { ok: true, ai: { ...fallback }, ai_model: model, ai_version: version, note: 'ai_parse_failed' };
    }
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : fallback.summary;
    const riskLevel = typeof obj.risk_level === 'string' ? obj.risk_level.trim() : fallback.risk_level;
    const keyReasons = Array.isArray(obj.key_reasons) ? obj.key_reasons.map((r) => String(r || '').trim()).filter(Boolean).slice(0, 8) : fallback.key_reasons;
    const rec = typeof obj.recommended_action === 'string' ? obj.recommended_action.trim() : fallback.recommended_action;
    return {
      ok: true,
      ai: {
        summary,
        risk_level: riskLevel,
        key_reasons: keyReasons,
        recommended_action: rec,
      },
      ai_model: model,
      ai_version: version,
    };
  } catch (err) {
    return { ok: true, ai: { ...fallback }, ai_model: model, ai_version: version, note: err && err.message ? String(err.message) : 'ai_failed' };
  }
}

module.exports = {
  buildDeterministicSummary,
  generateAiSummary,
  scoreToRisk,
  flagLabel,
};

