/**
 * Deterministic fraud scoring (0-100) with explainable flags + safe evidence snapshot.
 *
 * Inputs are DB rows (sessions, affiliate_attribution_sessions) + event summary + config.
 */
const { safeUrlHost, safeUrlParams, hasAny, sanitizeUrlForEvidence } = require('./affiliateAttribution');

function safeJsonParse(raw, fallback) {
  try {
    if (raw == null) return fallback;
    if (typeof raw === 'object') return raw;
    const s = String(raw || '').trim();
    if (!s) return fallback;
    return JSON.parse(s);
  } catch (_) {
    return fallback;
  }
}

function normalizeText(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function flagWeight(cfg, flagKey) {
  const w = cfg && cfg.weights && typeof cfg.weights === 'object' ? cfg.weights : {};
  const n = Number(w[flagKey]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.trunc(n))) : 0;
}

function isHardTrigger(cfg, flagKey) {
  const ht = cfg && Array.isArray(cfg.hardTriggers) ? cfg.hardTriggers : [];
  return ht.includes(flagKey);
}

function scoreToRiskLabel(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'Unknown';
  if (s >= 85) return 'High';
  if (s >= 60) return 'Medium';
  if (s >= 30) return 'Low';
  return 'Low';
}

function detectPaid(attribution, session) {
  const paidFirst = safeJsonParse(attribution && attribution.paid_click_ids_json, {}) || {};
  const last = safeJsonParse(attribution && attribution.last_seen_json, {}) || {};
  const paidLate = last && last.paid_click_ids && typeof last.paid_click_ids === 'object' ? last.paid_click_ids : {};
  const utmMedium = (attribution && attribution.utm_medium) || (session && session.utm_medium) || '';
  const m = String(utmMedium || '').trim().toLowerCase();
  const hasPaidMedium = m === 'cpc' || m === 'ppc' || m === 'paid' || m === 'paid_search';
  return {
    hasPaidClickId: hasAny(paidFirst) || hasAny(paidLate),
    hasPaidMedium,
    paidClickIds: paidFirst,
    paidClickIdsLate: paidLate,
  };
}

function detectAffiliate(attribution, session) {
  const affFirst = safeJsonParse(attribution && attribution.affiliate_click_ids_json, {}) || {};
  const last = safeJsonParse(attribution && attribution.last_seen_json, {}) || {};
  const affLate = last && last.affiliate_click_ids && typeof last.affiliate_click_ids === 'object' ? last.affiliate_click_ids : {};
  const utmMedium = (attribution && attribution.utm_medium) || (session && session.utm_medium) || '';
  const m = String(utmMedium || '').trim().toLowerCase();
  const hasAffMedium = m === 'affiliate' || m === 'affiliates' || m === 'partner';
  return {
    hasAffiliateClickId: hasAny(affFirst) || hasAny(affLate),
    hasAffiliateMedium: hasAffMedium,
    affiliateClickIds: affFirst,
    affiliateClickIdsLate: affLate,
  };
}

function detectSuspiciousReferrer(cfg, attribution, session) {
  const rawRef = (attribution && attribution.referrer) || (session && session.referrer) || '';
  const host = safeUrlHost(String(rawRef || ''));
  const allowlist = cfg && cfg.allowlist && cfg.allowlist.referrerDomains ? cfg.allowlist.referrerDomains : [];
  if (host) {
    const h = String(host).trim().toLowerCase();
    for (const d of allowlist) {
      const dd = String(d || '').trim().toLowerCase();
      if (!dd) continue;
      if (h === dd || h.endsWith('.' + dd)) return { suspicious: false, match: null };
    }
  }
  const sus = cfg && cfg.suspiciousReferrers ? cfg.suspiciousReferrers : {};
  const domains = Array.isArray(sus.domains) ? sus.domains : [];
  const subs = Array.isArray(sus.substrings) ? sus.substrings : [];
  let match = null;
  if (host) {
    for (const d of domains) {
      const dd = String(d || '').trim().toLowerCase();
      if (!dd) continue;
      if (host === dd || host.endsWith('.' + dd)) { match = dd; break; }
    }
  }
  if (!match) {
    const h = host || String(rawRef || '').toLowerCase();
    for (const s of subs) {
      const ss = String(s || '').trim().toLowerCase();
      if (!ss) continue;
      if (h.includes(ss)) { match = ss; break; }
    }
  }
  return { suspicious: !!match, match };
}

function detectBotSignals(session) {
  const flags = [];
  if (session && (session.cf_known_bot === 1 || session.cf_known_bot === '1' || session.cf_known_bot === true)) {
    flags.push('cf_known_bot');
  }
  const vbc = session && (session.cf_verified_bot_category || session.cf_verified_bot_category === '1');
  if (vbc && String(vbc).trim()) {
    flags.push('cf_verified_bot_category');
  }
  return flags;
}

function detectDatacenterAsn(cfg, session) {
  const asnList = cfg && cfg.datacenterAsn && Array.isArray(cfg.datacenterAsn.asns) ? cfg.datacenterAsn.asns : [];
  if (!asnList.length || !session || (session.cf_asn != null && session.cf_asn === '')) return [];
  const raw = session.cf_asn;
  const normalized = raw != null ? String(raw).replace(/^AS/i, '').trim() : '';
  if (!normalized) return [];
  const set = new Set(asnList.map((a) => String(a != null ? a : '').replace(/^AS/i, '').trim()).filter(Boolean));
  return set.has(normalized) ? ['datacenter_asn'] : [];
}

function detectAllowDenyList(cfg, attribution, session) {
  const flags = [];
  const denylist = cfg && cfg.denylist ? cfg.denylist : { affiliateIds: [], referrerDomains: [] };
  const affIds = Array.isArray(denylist.affiliateIds) ? denylist.affiliateIds.map((a) => String(a || '').trim().toLowerCase()).filter(Boolean) : [];
  const refDomains = Array.isArray(denylist.referrerDomains) ? denylist.referrerDomains.map((d) => String(d || '').trim().toLowerCase()).filter(Boolean) : [];
  if (affIds.length) {
    const hint = (attribution && attribution.affiliate_id_hint) || (session && session.utm_source) || '';
    const val = String(hint || '').trim().toLowerCase();
    if (val && affIds.includes(val)) flags.push('affiliate_denylisted');
  }
  if (refDomains.length) {
    const rawRef = (attribution && attribution.referrer) || (session && session.referrer) || '';
    const host = safeUrlHost(String(rawRef || ''));
    const val = host ? String(host).trim().toLowerCase() : '';
    if (val) {
      const match = refDomains.some((d) => val === d || val.endsWith('.' + d));
      if (match) flags.push('referrer_denylisted');
    }
  }
  return flags;
}

function buildEvidence({ cfg, session, attribution, checkout, eventSummary, paid, aff, flags, score, triggered }) {
  const known = cfg && cfg.known ? cfg.known : {};
  const keepParams = Array.from(new Set([...(known.paidClickIdParams || []), ...(known.affiliateClickIdParams || []), 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']));
  const last = safeJsonParse(attribution && attribution.last_seen_json, {}) || {};
  const entryUrl = (attribution && attribution.landing_url) || (session && session.entry_url) || '';
  const ref = (attribution && attribution.referrer) || (session && session.referrer) || '';
  const safeEntry = sanitizeUrlForEvidence(String(entryUrl || ''), keepParams);
  const safeRef = sanitizeUrlForEvidence(String(ref || ''), keepParams);
  const safeLateUrl = last && last.landing_url ? sanitizeUrlForEvidence(String(last.landing_url || ''), keepParams) : '';

  const ipHash = attribution && attribution.ip_hash ? String(attribution.ip_hash) : (checkout && checkout.ip_hash ? String(checkout.ip_hash) : '');
  const uaHash = attribution && attribution.ua_hash ? String(attribution.ua_hash) : '';

  return {
    evidence_version: 'v1',
    score,
    triggered,
    risk_label: scoreToRiskLabel(score),
    flags: flags.slice(),
    entity: {
      session_id: session && session.session_id != null ? String(session.session_id) : null,
      visitor_id: session && session.visitor_id != null ? String(session.visitor_id) : (attribution && attribution.visitor_id ? String(attribution.visitor_id) : null),
      order_id: checkout && checkout.order_id ? String(checkout.order_id) : (session && session.order_id ? String(session.order_id) : null),
      checkout_token: checkout && checkout.checkout_token ? String(checkout.checkout_token) : null,
    },
    attribution: {
      source_kind: attribution && attribution.source_kind ? String(attribution.source_kind) : null,
      affiliate_network_hint: attribution && attribution.affiliate_network_hint ? String(attribution.affiliate_network_hint) : null,
      affiliate_id_hint: attribution && attribution.affiliate_id_hint ? String(attribution.affiliate_id_hint) : null,
      utm_source: (attribution && attribution.utm_source) || (session && session.utm_source) || null,
      utm_medium: (attribution && attribution.utm_medium) || (session && session.utm_medium) || null,
      utm_campaign: (attribution && attribution.utm_campaign) || (session && session.utm_campaign) || null,
      utm_content: (attribution && attribution.utm_content) || (session && session.utm_content) || null,
      utm_term: attribution && attribution.utm_term ? String(attribution.utm_term) : null,
      landing_url: safeEntry || null,
      referrer: safeRef || null,
      paid_click_ids: hasAny(paid.paidClickIds) ? paid.paidClickIds : undefined,
      affiliate_click_ids: hasAny(aff.affiliateClickIds) ? aff.affiliateClickIds : undefined,
      late: (safeLateUrl || hasAny(paid.paidClickIdsLate) || hasAny(aff.affiliateClickIdsLate)) ? {
        seen_at: last && last.seen_at != null ? Number(last.seen_at) : null,
        landing_url: safeLateUrl || null,
        paid_click_ids: hasAny(paid.paidClickIdsLate) ? paid.paidClickIdsLate : undefined,
        affiliate_click_ids: hasAny(aff.affiliateClickIdsLate) ? aff.affiliateClickIdsLate : undefined,
      } : undefined,
    },
    signals: {
      has_paid: !!(paid.hasPaidClickId || paid.hasPaidMedium),
      has_paid_click_id: !!paid.hasPaidClickId,
      has_affiliate: !!(aff.hasAffiliateClickId || aff.hasAffiliateMedium),
      has_affiliate_click_id: !!aff.hasAffiliateClickId,
    },
    session: {
      country_code: normalizeText(session && (session.country_code || session.cf_country), 2),
      device: normalizeText(session && (session.device || ''), 32),
      ua_device_type: normalizeText(session && session.ua_device_type, 16),
      ua_platform: normalizeText(session && session.ua_platform, 16),
      ua_model: normalizeText(session && session.ua_model, 16),
      cf_known_bot: session && (session.cf_known_bot === 1 || session.cf_known_bot === '1' || session.cf_known_bot === true) ? 1 : 0,
      cf_verified_bot_category: session && session.cf_verified_bot_category ? String(session.cf_verified_bot_category).slice(0, 64) : null,
      cf_asn: session && session.cf_asn != null ? String(session.cf_asn).slice(0, 32) : null,
    },
    engagement: {
      total_events: eventSummary && eventSummary.total_events != null ? Number(eventSummary.total_events) : 0,
      page_views: eventSummary && eventSummary.page_views != null ? Number(eventSummary.page_views) : 0,
      product_views: eventSummary && eventSummary.product_views != null ? Number(eventSummary.product_views) : 0,
      add_to_cart: eventSummary && eventSummary.add_to_cart != null ? Number(eventSummary.add_to_cart) : 0,
      first_event_at: eventSummary && eventSummary.first_event_at != null ? Number(eventSummary.first_event_at) : null,
      checkout_started_at: eventSummary && eventSummary.checkout_started_at != null ? Number(eventSummary.checkout_started_at) : (session && session.checkout_started_at != null ? Number(session.checkout_started_at) : null),
      checkout_completed_at: checkout && checkout.occurred_at != null ? Number(checkout.occurred_at) : null,
      ms_to_checkout_started: (function () {
        const a = session && session.started_at != null ? Number(session.started_at) : null;
        const b = eventSummary && eventSummary.checkout_started_at != null ? Number(eventSummary.checkout_started_at) : (session && session.checkout_started_at != null ? Number(session.checkout_started_at) : null);
        return (a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && b >= a) ? (b - a) : null;
      })(),
      ms_to_checkout_completed: (function () {
        const a = session && session.started_at != null ? Number(session.started_at) : null;
        const b = checkout && checkout.occurred_at != null ? Number(checkout.occurred_at) : null;
        return (a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && b >= a) ? (b - a) : null;
      })(),
    },
    network: {
      ip_hash_prefix: ipHash ? ipHash.slice(0, 12) : null,
      ua_hash_prefix: uaHash ? uaHash.slice(0, 12) : null,
    },
  };
}

/**
 * Compute score + flags. The caller can add extra flags (e.g. duplicate_ip_pattern) before finalizing.
 */
function scoreDeterministic({ cfg, session, attribution, checkout, eventSummary, extraFlags = [] } = {}) {
  const flags = [];
  const paid = detectPaid(attribution, session);
  const aff = detectAffiliate(attribution, session);

  // Denylist (hard triggers)
  detectAllowDenyList(cfg, attribution, session).forEach((f) => {
    if (!flags.includes(f)) flags.push(f);
  });

  // Bot / edge signals
  detectBotSignals(session).forEach((f) => {
    if (!flags.includes(f)) flags.push(f);
  });

  // Datacenter ASN
  detectDatacenterAsn(cfg, session).forEach((f) => {
    if (!flags.includes(f)) flags.push(f);
  });

  // High severity: paid + affiliate present
  if ((paid.hasPaidClickId || paid.hasPaidMedium) && (aff.hasAffiliateClickId || aff.hasAffiliateMedium)) {
    flags.push('google_ads_conflict');
  }

  // High severity: affiliate hints but no click evidence
  const netHint = attribution && attribution.affiliate_network_hint ? String(attribution.affiliate_network_hint).trim().toLowerCase() : '';
  const affHint = attribution && attribution.affiliate_id_hint ? String(attribution.affiliate_id_hint).trim() : '';
  if ((netHint || affHint || aff.hasAffiliateMedium) && !aff.hasAffiliateClickId) {
    flags.push('no_affiliate_evidence');
  }

  // Late injection: affiliate click ids seen only in last_seen_json close to checkout
  const last = safeJsonParse(attribution && attribution.last_seen_json, {}) || {};
  const lateAff = last && last.affiliate_click_ids && typeof last.affiliate_click_ids === 'object' ? last.affiliate_click_ids : {};
  const lateSeenAt = last && last.seen_at != null ? Number(last.seen_at) : null;
  const checkoutAt = checkout && checkout.occurred_at != null ? Number(checkout.occurred_at) : null;
  const maxLateMs = cfg && cfg.lateInjection && Number.isFinite(Number(cfg.lateInjection.maxMsBeforeCheckout))
    ? Number(cfg.lateInjection.maxMsBeforeCheckout)
    : (3 * 60 * 1000);
  if (!aff.hasAffiliateClickId && hasAny(lateAff) && lateSeenAt != null && checkoutAt != null && Number.isFinite(lateSeenAt) && Number.isFinite(checkoutAt)) {
    const dt = checkoutAt - lateSeenAt;
    if (dt >= 0 && dt <= maxLateMs) flags.push('late_injection');
  }

  // Medium: low engagement before checkout
  const totalEvents = eventSummary && eventSummary.total_events != null ? Number(eventSummary.total_events) : 0;
  const pageViews = eventSummary && eventSummary.page_views != null ? Number(eventSummary.page_views) : 0;
  const maxPv = cfg && cfg.lowEngagement ? Number(cfg.lowEngagement.maxPageViews) : 1;
  const maxEv = cfg && cfg.lowEngagement ? Number(cfg.lowEngagement.maxTotalEvents) : 4;
  if ((Number.isFinite(pageViews) && pageViews <= maxPv) || (Number.isFinite(totalEvents) && totalEvents <= maxEv)) {
    // Only apply when we actually have a checkout context (checkout_completed).
    if (checkout && checkout.occurred_at != null) flags.push('low_engagement');
  }

  // Medium: suspicious referrer patterns
  const sus = detectSuspiciousReferrer(cfg, attribution, session);
  if (sus.suspicious) flags.push('suspicious_referrer');

  // Allow extra flags from caller (e.g. duplicate_ip_pattern)
  (Array.isArray(extraFlags) ? extraFlags : []).forEach((f) => {
    const k = String(f || '').trim().toLowerCase();
    if (k && !flags.includes(k)) flags.push(k);
  });

  // Score
  let score = 0;
  flags.forEach((k) => { score += flagWeight(cfg, k); });
  score = Math.max(0, Math.min(100, Math.trunc(score)));

  const threshold = cfg && Number.isFinite(Number(cfg.threshold)) ? Number(cfg.threshold) : 70;
  const triggered = score >= threshold || flags.some((k) => isHardTrigger(cfg, k));

  const evidence = buildEvidence({ cfg, session, attribution, checkout, eventSummary, paid, aff, flags, score, triggered });
  return { score, flags, triggered, evidence };
}

module.exports = {
  safeJsonParse,
  scoreToRiskLabel,
  scoreDeterministic,
};

