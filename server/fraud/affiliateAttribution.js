/**
 * Network-agnostic affiliate / paid click attribution capture.
 *
 * Stores evidence at session-level in affiliate_attribution_sessions.
 * - First-touch fields are immutable once set.
 * - Late/mid-session changes are stored in last_seen_json (rate-limited).
 *
 * Privacy:
 * - Never store raw IP. Store HMAC hashes only (FRAUD_IP_SALT).
 */
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../db');
const fraudConfig = require('./config');

let _tableOk = null; // null unknown, true ok, false missing

function trimStr(v, maxLen = 2048) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function safeUrlParams(url) {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (!raw) return null;
  try {
    return new URL(raw).searchParams;
  } catch (_) {
    try {
      return new URL('https://' + raw).searchParams;
    } catch (_) {
      try {
        return new URL(raw, 'https://example.local').searchParams;
      } catch (_) {
        return null;
      }
    }
  }
}

function safeUrlHost(url) {
  if (typeof url !== 'string') return '';
  const raw = url.trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (_) {
    try {
      return new URL('https://' + raw).hostname.toLowerCase();
    } catch (_) {
      return '';
    }
  }
}

function sanitizeUrlForEvidence(url, keepParamNames) {
  const raw = trimStr(url, 2048);
  if (!raw) return '';
  const keep = Array.isArray(keepParamNames) ? keepParamNames.map((s) => String(s).toLowerCase()) : [];
  const params = safeUrlParams(raw);
  if (!params || keep.length === 0) {
    // Keep only the origin+path (and drop query+fragment) where possible.
    try {
      const u = new URL(raw);
      return u.origin + u.pathname;
    } catch (_) {
      try {
        const u = new URL('https://' + raw);
        return u.origin + u.pathname;
      } catch (_) {
        // If it's relative like "/?x=1", keep as-is but strip query best-effort.
        const q = raw.indexOf('?');
        return q >= 0 ? raw.slice(0, q) : raw;
      }
    }
  }

  try {
    const u = new URL(raw.startsWith('/') ? ('https://example.local' + raw) : (raw.startsWith('http') ? raw : 'https://' + raw));
    // Strip to allowed params only.
    const next = new URL(u.toString());
    next.hash = '';
    next.search = '';
    keep.forEach((k) => {
      try {
        const v = params.get(k);
        if (v == null) return;
        const s = String(v).trim();
        if (!s) return;
        next.searchParams.set(k, s.length > 256 ? s.slice(0, 256) : s);
      } catch (_) {}
    });
    const out = next.toString();
    // If we used example.local base for relative urls, return path+query only.
    if (next.hostname === 'example.local') return next.pathname + (next.search || '');
    return out;
  } catch (_) {
    return raw;
  }
}

function hmacHex(secret, value) {
  if (!secret || !value) return null;
  try {
    return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
  } catch (_) {
    return null;
  }
}

function objectFromParams(params, keys) {
  const out = {};
  if (!params) return out;
  (Array.isArray(keys) ? keys : []).forEach((k) => {
    const key = String(k || '').trim().toLowerCase();
    if (!key) return;
    try {
      const v = params.get(key);
      if (v == null) return;
      const s = String(v).trim();
      if (!s) return;
      out[key] = s.length > 256 ? s.slice(0, 256) : s;
    } catch (_) {}
  });
  return out;
}

function hasAny(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some((k) => obj[k] != null && String(obj[k]).trim() !== '');
}

function normalizeUtmFromPayload(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  function t(v, maxLen = 128) {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }
  return {
    utm_source: t(p.utm_source),
    utm_medium: t(p.utm_medium),
    utm_campaign: t(p.utm_campaign, 256),
    utm_content: t(p.utm_content, 256),
    utm_term: t(p.utm_term, 256),
  };
}

function deriveNetworkHint({ affiliateClickIds = {}, paramToNetwork = {} } = {}) {
  const map = paramToNetwork && typeof paramToNetwork === 'object' ? paramToNetwork : {};
  for (const k of Object.keys(affiliateClickIds || {})) {
    const kk = String(k || '').trim().toLowerCase();
    const hint = map[kk];
    if (hint) return String(hint).trim().toLowerCase().slice(0, 32);
  }
  return null;
}

function deriveAffiliateIdHint({ params, affiliateIdParams = [] } = {}) {
  if (!params) return null;
  for (const k of affiliateIdParams) {
    const key = String(k || '').trim().toLowerCase();
    if (!key) continue;
    try {
      const v = params.get(key);
      if (v == null) continue;
      const s = String(v).trim();
      if (!s) continue;
      return s.length > 128 ? s.slice(0, 128) : s;
    } catch (_) {}
  }
  return null;
}

function deriveSourceKind({ utmMedium, paidClickIds, affiliateClickIds } = {}) {
  const m = (utmMedium || '').toString().trim().toLowerCase();
  const hasPaid = hasAny(paidClickIds) || m === 'cpc' || m === 'ppc' || m === 'paid' || m === 'paid_search';
  const hasAff = hasAny(affiliateClickIds) || m === 'affiliate' || m === 'affiliates' || m === 'partner';
  if (hasAff) return 'affiliate';
  if (hasPaid) return 'paid';
  if (m || (utmMedium == null && hasAny(paidClickIds) === false && hasAny(affiliateClickIds) === false)) {
    // If there's any UTM at all, treat as organic/other; otherwise could be direct.
    return (m || '').length ? 'organic' : 'direct';
  }
  return 'unknown';
}

async function tableOk() {
  if (_tableOk === true) return true;
  if (_tableOk === false) return false;
  try {
    await getDb().get('SELECT 1 FROM affiliate_attribution_sessions LIMIT 1');
    _tableOk = true;
    return true;
  } catch (_) {
    _tableOk = false;
    return false;
  }
}

async function upsertFromIngest({
  sessionId,
  visitorId,
  payload,
  requestUrl, // best-effort current page URL from headers/worker
  clientIp,
  userAgent,
  nowMs = Date.now(),
} = {}) {
  const sid = typeof sessionId === 'string' ? sessionId.trim() : String(sessionId || '').trim();
  const vid = typeof visitorId === 'string' ? visitorId.trim() : (payload && typeof payload.visitor_id === 'string' ? payload.visitor_id.trim() : '');
  if (!sid || !(await tableOk())) return { ok: false, skipped: true };

  const cfg = await fraudConfig.readFraudConfig({ allowCache: true }).then((r) => r.config).catch(() => fraudConfig.defaultFraudConfigV1());
  const known = cfg && cfg.known ? cfg.known : {};
  const keepParams = Array.from(new Set([...(known.paidClickIdParams || []), ...(known.affiliateClickIdParams || []), 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']));

  const firstUrlRaw = trimStr(payload && payload.entry_url, 2048) || '';
  const currentUrlRaw = trimStr(requestUrl, 2048) || '';

  const firstParams = safeUrlParams(firstUrlRaw);
  const currentParams = safeUrlParams(currentUrlRaw);

  const utmPayload = normalizeUtmFromPayload(payload);
  const utmFromFirst = {
    utm_source: utmPayload.utm_source || (firstParams ? (firstParams.get('utm_source') || null) : null),
    utm_medium: utmPayload.utm_medium || (firstParams ? (firstParams.get('utm_medium') || null) : null),
    utm_campaign: utmPayload.utm_campaign || (firstParams ? (firstParams.get('utm_campaign') || null) : null),
    utm_content: utmPayload.utm_content || (firstParams ? (firstParams.get('utm_content') || null) : null),
    utm_term: utmPayload.utm_term || (firstParams ? (firstParams.get('utm_term') || null) : null),
  };

  const paidClickIdsFirst = objectFromParams(firstParams, known.paidClickIdParams || []);
  const affiliateClickIdsFirst = objectFromParams(firstParams, known.affiliateClickIdParams || []);
  const affiliateIdHint = deriveAffiliateIdHint({ params: firstParams, affiliateIdParams: known.affiliateIdParams || [] });
  const networkHint = deriveNetworkHint({ affiliateClickIds: affiliateClickIdsFirst, paramToNetwork: (cfg.networkHints && cfg.networkHints.paramToNetwork) || {} }) || null;

  const sourceKind = deriveSourceKind({
    utmMedium: utmFromFirst.utm_medium,
    paidClickIds: paidClickIdsFirst,
    affiliateClickIds: affiliateClickIdsFirst,
  });

  const salt = config.fraudIpSalt || '';
  const ipHash = hmacHex(salt, trimStr(clientIp, 128)) || null;
  const uaHash = hmacHex(salt, trimStr(userAgent, 512)) || null;

  const landingUrl = sanitizeUrlForEvidence(firstUrlRaw || currentUrlRaw, keepParams);
  const referrer = sanitizeUrlForEvidence(trimStr(payload && payload.referrer, 2048), keepParams);

  // Current URL may contain late injection params (best-effort, rate-limited).
  const paidClickIdsCurrent = objectFromParams(currentParams, known.paidClickIdParams || []);
  const affiliateClickIdsCurrent = objectFromParams(currentParams, known.affiliateClickIdParams || []);
  const lateNetworkHint = deriveNetworkHint({ affiliateClickIds: affiliateClickIdsCurrent, paramToNetwork: (cfg.networkHints && cfg.networkHints.paramToNetwork) || {} }) || null;
  const lateAffiliateIdHint = deriveAffiliateIdHint({ params: currentParams, affiliateIdParams: known.affiliateIdParams || [] });

  const db = getDb();
  let existing = null;
  try {
    existing = await db.get('SELECT * FROM affiliate_attribution_sessions WHERE session_id = ? LIMIT 1', [sid]);
  } catch (_) {
    return { ok: false, skipped: true };
  }

  if (!existing) {
    const paidJson = hasAny(paidClickIdsFirst) ? JSON.stringify(paidClickIdsFirst) : null;
    const affJson = hasAny(affiliateClickIdsFirst) ? JSON.stringify(affiliateClickIdsFirst) : null;
    await db.run(
      `
      INSERT INTO affiliate_attribution_sessions
        (session_id, visitor_id, first_seen_at, source_kind,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term,
         paid_click_ids_json, affiliate_click_ids_json,
         affiliate_network_hint, affiliate_id_hint,
         landing_url, referrer, ip_hash, ua_hash,
         last_seen_at, last_seen_json, evidence_version, updated_at)
      VALUES
        (?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?,
         ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?)
      `,
      [
        sid,
        vid || null,
        nowMs,
        sourceKind,
        utmFromFirst.utm_source,
        utmFromFirst.utm_medium,
        utmFromFirst.utm_campaign,
        utmFromFirst.utm_content,
        utmFromFirst.utm_term,
        paidJson,
        affJson,
        networkHint,
        affiliateIdHint,
        landingUrl || '',
        referrer || null,
        ipHash,
        uaHash,
        null,
        null,
        'v1',
        nowMs,
      ]
    );
    return { ok: true, inserted: true };
  }

  // Update only last_seen blob (first-touch columns remain immutable).
  const prevLastSeenAt = existing.last_seen_at != null ? Number(existing.last_seen_at) : null;
  if (prevLastSeenAt != null && Number.isFinite(prevLastSeenAt) && (nowMs - prevLastSeenAt) >= 0 && (nowMs - prevLastSeenAt) < 60 * 1000) {
    return { ok: true, inserted: false, updated: false, rateLimited: true };
  }

  // Detect new signals present in current URL but absent in first-touch.
  let firstPaid = {};
  let firstAff = {};
  try { firstPaid = existing.paid_click_ids_json ? JSON.parse(String(existing.paid_click_ids_json)) : {}; } catch (_) { firstPaid = {}; }
  try { firstAff = existing.affiliate_click_ids_json ? JSON.parse(String(existing.affiliate_click_ids_json)) : {}; } catch (_) { firstAff = {}; }

  function diffNew(cur, first) {
    const out = {};
    for (const k of Object.keys(cur || {})) {
      const v = cur[k];
      if (v == null || String(v).trim() === '') continue;
      if (first && first[k] != null && String(first[k]).trim() !== '') continue;
      out[k] = v;
    }
    return out;
  }

  const newPaid = diffNew(paidClickIdsCurrent, firstPaid);
  const newAff = diffNew(affiliateClickIdsCurrent, firstAff);
  const hasNew = hasAny(newPaid) || hasAny(newAff);
  if (!hasNew) return { ok: true, inserted: false, updated: false };

  const lastSeen = {
    seen_at: nowMs,
    landing_url: sanitizeUrlForEvidence(currentUrlRaw, keepParams) || '',
    paid_click_ids: hasAny(newPaid) ? newPaid : undefined,
    affiliate_click_ids: hasAny(newAff) ? newAff : undefined,
    affiliate_network_hint: lateNetworkHint || undefined,
    affiliate_id_hint: lateAffiliateIdHint || undefined,
  };
  const lastSeenJson = JSON.stringify(lastSeen);
  await db.run(
    'UPDATE affiliate_attribution_sessions SET last_seen_at = ?, last_seen_json = ?, updated_at = ? WHERE session_id = ?',
    [nowMs, lastSeenJson, nowMs, sid]
  );
  return { ok: true, inserted: false, updated: true };
}

module.exports = {
  sanitizeUrlForEvidence,
  safeUrlHost,
  safeUrlParams,
  hasAny,
  upsertFromIngest,
};

