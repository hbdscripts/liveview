/**
 * Live Visitors Web Pixel – strict sandbox.
 * Uses browser.localStorage/sessionStorage (async), init/event.context/event.data only.
 * No /cart.js; cart_qty from init.data.cart + deltas. No consent gating.
 */

import { register } from '@shopify/web-pixels-extension';

const VISITOR_KEY = 'lv_visitor';
const SESSION_KEY = 'lv_session';
const SHARED_SESSION_KEY = 'lv_session_shared';
const VISITOR_DAYS = 30;
const SESSION_TTL_MINUTES = 30;
const SHARED_SESSION_TOUCH_MIN_MS = 15000;
const HEARTBEAT_MS = 30000;

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

function sessionModeFromSettings(settings) {
  const raw = settings && (settings.sessionMode ?? settings.session_mode);
  if (typeof raw === 'boolean') return raw ? 'shared_ttl' : 'legacy';
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'shared_ttl' || s === 'shared' || s === 'sharedttl') return 'shared_ttl';
  return 'legacy';
}

function pathFromContext(ctx) {
  const loc = ctx?.document?.location || ctx?.location;
  if (loc?.pathname) return loc.pathname;
  if (typeof loc?.href === 'string') {
    try {
      const u = new URL(loc.href);
      return u.pathname || '/';
    } catch (_) {}
  }
  return '/';
}

// Prefer visitor's browser locale (navigator.language); do NOT use shop.countryCode – that's the store's country and would label every visitor the same.
function countryFromInit(init) {
  const nav = init?.context?.navigator;
  const lang = nav?.languages?.[0] || nav?.language;
  if (typeof lang === 'string' && /^[a-z]{2}-[A-Z]{2}$/i.test(lang)) {
    const cc = lang.split('-')[1];
    if (cc && cc.length === 2) return cc.toUpperCase();
  }
  return 'XX';
}

function deviceFromContext(ctx) {
  const w = ctx?.window;
  if (w && typeof w.innerWidth === 'number') return w.innerWidth < 768 ? 'mobile' : 'desktop';
  return 'unknown';
}

function utmParamsFromContext(ctx) {
  const href = ctx?.document?.location?.href ?? ctx?.location?.href;
  if (typeof href !== 'string') return {};
  try {
    const u = new URL(href);
    const get = (key) => {
      const v = u.searchParams.get(key);
      return v && v.trim() ? v.trim() : null;
    };
    return {
      utm_source: get('utm_source'),
      utm_campaign: get('utm_campaign'),
      utm_medium: get('utm_medium'),
      utm_content: get('utm_content'),
    };
  } catch (_) {
    return {};
  }
}

function referrerFromContext(ctx) {
  const ref = ctx?.document?.referrer;
  if (typeof ref !== 'string' || !ref.trim()) return null;
  return ref.trim();
}

register(({ analytics, init, browser, settings }) => {
  if (!browser?.localStorage || !browser?.sessionStorage) return;
  if (!settings?.ingestUrl || !settings?.ingestSecret) return;

  const ingestUrl = settings.ingestUrl.replace(/\/$/, '');
  const ingestSecret = settings.ingestSecret;
  const sessionMode = sessionModeFromSettings(settings); // legacy (default) | shared_ttl
  let visitorId = null;
  let sessionId = null;
  let sharedSessionStartedAt = null;
  let sharedSessionLastWriteAt = 0;
  let cartQty = 0;
  let cartValue = null;
  let cartCurrency = null;
  let lastPath = pathFromContext(init?.context) || '/';
  let lastUtm = { utm_source: null, utm_campaign: null, utm_medium: null, utm_content: null };
  let lastReferrer = null;
  let heartbeatTimer = null;

  function parseAmount(v) {
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  }

  function cartMoneyFromCart(cart) {
    const cost = cart?.cost?.totalAmount;
    let amount = parseAmount(cost?.amount);
    const code = typeof cost?.currencyCode === 'string' ? cost.currencyCode : (init?.data?.shop?.paymentSettings?.currencyCode ?? null);
    if (amount == null && Array.isArray(cart?.lines) && cart.lines.length > 0) {
      amount = cart.lines.reduce((sum, line) => {
        const lineAmount = parseAmount(line?.cost?.totalAmount?.amount);
        return sum + (typeof lineAmount === 'number' ? lineAmount : 0);
      }, 0);
    }
    return { cart_value: amount ?? null, cart_currency: code };
  }

  function getVisitorId() {
    return browser.localStorage.getItem(VISITOR_KEY).then(raw => {
      if (!raw) return null;
      try {
        const o = JSON.parse(raw);
        const lastSeen = o.lastSeen || 0;
        if (Date.now() - lastSeen > VISITOR_DAYS * 24 * 60 * 60 * 1000) return null;
        return o.id || null;
      } catch (_) {
        return null;
      }
    });
  }

  function setVisitorId(id, createdAt, lastSeen) {
    return browser.localStorage.setItem(VISITOR_KEY, JSON.stringify({ id, createdAt, lastSeen }));
  }

  function getSessionId() {
    return browser.sessionStorage.getItem(SESSION_KEY).then(id => id || null);
  }

  function setSessionId(id) {
    return browser.sessionStorage.setItem(SESSION_KEY, id);
  }

  function getSharedSession() {
    return browser.localStorage.getItem(SHARED_SESSION_KEY).then(raw => {
      if (!raw) return null;
      try {
        const o = JSON.parse(raw);
        if (!o || typeof o !== 'object') return null;
        const id = typeof o.id === 'string' ? o.id.trim() : '';
        if (!id) return null;
        const startedAt = o.startedAt != null ? Number(o.startedAt) : NaN;
        const lastSeen = o.lastSeen != null ? Number(o.lastSeen) : NaN;
        return {
          id,
          startedAt: Number.isFinite(startedAt) ? startedAt : null,
          lastSeen: Number.isFinite(lastSeen) ? lastSeen : null,
        };
      } catch (_) {
        return null;
      }
    });
  }

  function persistSharedSession(id, startedAt, lastSeen, { force = false } = {}) {
    const now = typeof lastSeen === 'number' && isFinite(lastSeen) ? lastSeen : Date.now();
    if (!force && sharedSessionLastWriteAt && (now - sharedSessionLastWriteAt) < SHARED_SESSION_TOUCH_MIN_MS) {
      return Promise.resolve();
    }
    sharedSessionLastWriteAt = now;
    const sAt = (typeof startedAt === 'number' && isFinite(startedAt)) ? startedAt : now;
    const obj = { id, startedAt: sAt, lastSeen: now };
    return browser.localStorage.setItem(SHARED_SESSION_KEY, JSON.stringify(obj)).catch(() => {});
  }

  function ensureLegacySessionId() {
    return getSessionId().then(sid => {
      if (!sid) {
        sessionId = uuid();
        return setSessionId(sessionId);
      }
      sessionId = sid;
    });
  }

  function ensureSharedSessionId() {
    const now = Date.now();
    const ttlMs = SESSION_TTL_MINUTES * 60 * 1000;
    return getSharedSession()
      .then(prev => {
        const prevId = prev && prev.id ? prev.id : null;
        const prevStartedAt = prev && typeof prev.startedAt === 'number' ? prev.startedAt : null;
        const prevLastSeen = prev && typeof prev.lastSeen === 'number' ? prev.lastSeen : null;
        const valid = !!(prevId && prevLastSeen && isFinite(prevLastSeen) && (now - prevLastSeen) <= ttlMs);
        if (valid) {
          sessionId = prevId;
          sharedSessionStartedAt = (prevStartedAt != null && isFinite(prevStartedAt) && prevStartedAt <= now) ? prevStartedAt : now;
          return persistSharedSession(sessionId, sharedSessionStartedAt, now, { force: true });
        }
        sessionId = uuid();
        sharedSessionStartedAt = now;
        return persistSharedSession(sessionId, now, now, { force: true });
      })
      .then(() => {
        // Also keep sessionStorage in sync so toggling back to legacy doesn't immediately fork.
        return setSessionId(sessionId).catch(() => {});
      })
      .catch(() => ensureLegacySessionId());
  }

  function touchSharedSession() {
    if (sessionMode !== 'shared_ttl' || !sessionId) return;
    const now = Date.now();
    // Best-effort: keep shared session alive while tab is open.
    persistSharedSession(sessionId, sharedSessionStartedAt || now, now).catch(() => {});
  }

  function ensureIds() {
    return getVisitorId()
      .then(vid => {
        if (vid) {
          visitorId = vid;
          return browser.localStorage.getItem(VISITOR_KEY).then(raw => {
            try {
              const o = JSON.parse(raw || '{}');
              return setVisitorId(vid, o.createdAt || Date.now(), Date.now());
            } catch (_) {
              return setVisitorId(vid, Date.now(), Date.now());
            }
          });
        }
        visitorId = uuid();
        return setVisitorId(visitorId, Date.now(), Date.now());
      })
      .then(() => (sessionMode === 'shared_ttl' ? ensureSharedSessionId() : ensureLegacySessionId()));
  }

  function payload(eventType, extra = {}) {
    const ts = Date.now();
    lastPath = extra.path ?? pathFromContext(init?.context) ?? lastPath;
    const fromCtx = utmParamsFromContext(init?.context);
    if (extra.utm_source !== undefined && extra.utm_source != null) lastUtm.utm_source = extra.utm_source;
    else if (fromCtx.utm_source != null) lastUtm.utm_source = fromCtx.utm_source;
    if (extra.utm_campaign !== undefined && extra.utm_campaign != null) lastUtm.utm_campaign = extra.utm_campaign;
    else if (fromCtx.utm_campaign != null) lastUtm.utm_campaign = fromCtx.utm_campaign;
    if (extra.utm_medium !== undefined && extra.utm_medium != null) lastUtm.utm_medium = extra.utm_medium;
    else if (fromCtx.utm_medium != null) lastUtm.utm_medium = fromCtx.utm_medium;
    if (extra.utm_content !== undefined && extra.utm_content != null) lastUtm.utm_content = extra.utm_content;
    else if (fromCtx.utm_content != null) lastUtm.utm_content = fromCtx.utm_content;
    const country = extra.country_code ?? countryFromInit(init);
    const device = extra.device ?? deviceFromContext(init?.context);
    const out = {
      event_type: eventType,
      visitor_id: visitorId,
      session_id: sessionId,
      ts,
      path: lastPath,
      country_code: country,
      device,
      network_speed: 'unknown',
      cart_qty: cartQty,
      cart_value: extra.cart_value !== undefined ? extra.cart_value : cartValue,
      cart_currency: extra.cart_currency !== undefined ? extra.cart_currency : cartCurrency,
      ...extra,
    };
    if (lastUtm.utm_source != null) out.utm_source = lastUtm.utm_source;
    if (lastUtm.utm_campaign != null) out.utm_campaign = lastUtm.utm_campaign;
    if (lastUtm.utm_medium != null) out.utm_medium = lastUtm.utm_medium;
    if (lastUtm.utm_content != null) out.utm_content = lastUtm.utm_content;
    if (lastReferrer != null) out.referrer = lastReferrer;
    return out;
  }

  function send(payload) {
    try {
      touchSharedSession();
      fetch(ingestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ingest-Secret': ingestSecret,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch (_) {}
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (visitorId && sessionId) {
        send(payload('heartbeat'));
      }
    }, HEARTBEAT_MS);
  }

  function updateUtmFromContext(ctx) {
    const u = utmParamsFromContext(ctx);
    if (u.utm_source != null) lastUtm.utm_source = u.utm_source;
    if (u.utm_campaign != null) lastUtm.utm_campaign = u.utm_campaign;
    if (u.utm_medium != null) lastUtm.utm_medium = u.utm_medium;
    if (u.utm_content != null) lastUtm.utm_content = u.utm_content;
  }
  function updateReferrerFromContext(ctx) {
    const ref = referrerFromContext(ctx);
    if (ref != null) lastReferrer = ref;
  }

  ensureIds().then(() => {
    const cart = init?.data?.cart;
    cartQty = cart?.totalQuantity ?? 0;
    if (typeof cartQty !== 'number') cartQty = 0;
    const money = cartMoneyFromCart(cart);
    cartValue = money.cart_value;
    cartCurrency = money.cart_currency;
    lastPath = pathFromContext(init?.context) || '/';
    updateUtmFromContext(init?.context);
    updateReferrerFromContext(init?.context);
    send(payload('page_viewed', { cart_qty: cartQty, cart_value: cartValue, cart_currency: cartCurrency }));
    startHeartbeat();
  }).catch(() => {});

  analytics.subscribe('page_viewed', (event) => {
    try {
      lastPath = pathFromContext(event?.context) || pathFromContext(init?.context) || lastPath;
      updateUtmFromContext(event?.context);
      updateUtmFromContext(init?.context);
      updateReferrerFromContext(event?.context);
      updateReferrerFromContext(init?.context);
      send(payload('page_viewed'));
    } catch (_) {}
  });

  analytics.subscribe('product_viewed', (event) => {
    try {
      lastPath = pathFromContext(event?.context) || lastPath;
      updateUtmFromContext(event?.context);
      updateUtmFromContext(init?.context);
      const handle = event?.data?.productVariant?.product?.handle ?? event?.data?.product?.handle;
      const path = pathFromContext(event?.context) || lastPath;
      const match = path.match(/\/products\/([^/?#]+)/);
      const productHandle = handle || (match ? match[1] : null);
      send(payload('product_viewed', { product_handle: productHandle }));
    } catch (_) {}
  });

  analytics.subscribe('product_added_to_cart', (event) => {
    try {
      const qty = event?.data?.cartLine?.quantity ?? 1;
      cartQty = Math.max(0, (cartQty || 0) + qty);
      lastPath = pathFromContext(event?.context) || lastPath;
      const cart = event?.data?.cart;
      if (cart?.totalQuantity != null) cartQty = cart.totalQuantity;
      const money = cartMoneyFromCart(cart);
      if (money.cart_value != null) cartValue = money.cart_value;
      if (money.cart_currency != null) cartCurrency = money.cart_currency;
      send(payload('product_added_to_cart', { quantity_delta: qty, cart_qty: cartQty, cart_value: cartValue, cart_currency: cartCurrency }));
    } catch (_) {}
  });

  analytics.subscribe('product_removed_from_cart', (event) => {
    try {
      const qty = event?.data?.cartLine?.quantity ?? 1;
      cartQty = Math.max(0, (cartQty || 0) - qty);
      lastPath = pathFromContext(event?.context) || lastPath;
      const cart = event?.data?.cart;
      if (cart?.totalQuantity != null) cartQty = cart.totalQuantity;
      const money = cartMoneyFromCart(cart);
      if (money.cart_value != null) cartValue = money.cart_value;
      if (money.cart_currency != null) cartCurrency = money.cart_currency;
      send(payload('product_removed_from_cart', { quantity_delta: -qty, cart_qty: cartQty, cart_value: cartValue, cart_currency: cartCurrency }));
    } catch (_) {}
  });

  analytics.subscribe('cart_viewed', (event) => {
    try {
      lastPath = pathFromContext(event?.context) || lastPath;
      const cart = event?.data?.cart;
      if (cart?.totalQuantity != null) cartQty = cart.totalQuantity;
      const money = cartMoneyFromCart(cart);
      if (money.cart_value != null) cartValue = money.cart_value;
      if (money.cart_currency != null) cartCurrency = money.cart_currency;
      send(payload('cart_viewed', { cart_value: cartValue, cart_currency: cartCurrency }));
    } catch (_) {}
  });

  analytics.subscribe('checkout_started', (event) => {
    try {
      lastPath = pathFromContext(event?.context) || lastPath;
      send(payload('checkout_started', { checkout_started: true }));
    } catch (_) {}
  });

  analytics.subscribe('checkout_completed', (event) => {
    try {
      const checkout = event?.data?.checkout;
      let orderTotal = null;
      const totalPrice = checkout?.totalPrice ?? checkout?.subtotalPrice;
      orderTotal = parseAmount(totalPrice?.amount);
      if (orderTotal == null && Array.isArray(checkout?.transactions) && checkout.transactions.length > 0) {
        const sum = checkout.transactions.reduce((acc, t) => {
          const amt = parseAmount(t?.amount?.amount);
          return acc + (typeof amt === 'number' ? amt : 0);
        }, 0);
        if (sum > 0) orderTotal = sum;
      }
      const orderCurrency = checkout?.currencyCode ?? totalPrice?.currencyCode ?? null;
      // IMPORTANT: only send string-ish identifiers. Avoid String(object) => "[object Object]" which
      // can collapse server-side dedupe into a single purchase.
      const orderId = (function () {
        const raw = checkout?.order?.id;
        if (raw == null) return null;
        if (typeof raw === 'string') return raw.trim() || null;
        if (typeof raw === 'number' && isFinite(raw)) return String(raw);
        return null;
      })();
      const checkoutToken = (function () {
        const raw = checkout?.token;
        if (raw == null) return null;
        if (typeof raw !== 'string') return null;
        const s = raw.trim();
        if (!s) return null;
        return s;
      })();
      send(payload('checkout_completed', {
        checkout_completed: true,
        order_total: orderTotal,
        order_currency: orderCurrency,
        order_id: orderId,
        checkout_token: checkoutToken,
      }));
    } catch (_) {}
  });
});
