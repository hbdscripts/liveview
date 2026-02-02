/**
 * Live Visitors Web Pixel – strict sandbox.
 * Uses browser.localStorage/sessionStorage (async), init/event.context/event.data only.
 * No /cart.js; cart_qty from init.data.cart + deltas. No consent gating.
 */

import { register } from '@shopify/web-pixels-extension';

const VISITOR_KEY = 'lv_visitor';
const SESSION_KEY = 'lv_session';
const VISITOR_DAYS = 30;
const HEARTBEAT_MS = 30000;

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
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

function utmCampaignFromContext(ctx) {
  const href = ctx?.document?.location?.href ?? ctx?.location?.href;
  if (typeof href !== 'string') return null;
  try {
    const u = new URL(href);
    const v = u.searchParams.get('utm_campaign');
    return v && v.trim() ? v.trim() : null;
  } catch (_) {
    return null;
  }
}

register(({ analytics, init, browser, settings }) => {
  if (!browser?.localStorage || !browser?.sessionStorage) return;
  if (!settings?.ingestUrl || !settings?.ingestSecret) return;

  const ingestUrl = settings.ingestUrl.replace(/\/$/, '');
  const ingestSecret = settings.ingestSecret;
  let visitorId = null;
  let sessionId = null;
  let cartQty = 0;
  let cartValue = null;
  let cartCurrency = null;
  let lastPath = pathFromContext(init?.context) || '/';
  let lastUtmCampaign = null;
  let heartbeatTimer = null;

  function cartMoneyFromCart(cart) {
    const cost = cart?.cost?.totalAmount;
    const amount = typeof cost?.amount === 'number' ? cost.amount : null;
    const code = typeof cost?.currencyCode === 'string' ? cost.currencyCode : (init?.data?.shop?.paymentSettings?.currencyCode ?? null);
    return { cart_value: amount, cart_currency: code };
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
      .then(() => getSessionId())
      .then(sid => {
        if (!sid) {
          sessionId = uuid();
          return setSessionId(sessionId);
        }
        sessionId = sid;
      });
  }

  function payload(eventType, extra = {}) {
    const ts = Date.now();
    lastPath = extra.path ?? pathFromContext(init?.context) ?? lastPath;
    const utm = extra.utm_campaign !== undefined ? extra.utm_campaign : utmCampaignFromContext(init?.context);
    if (utm !== undefined && utm !== null) lastUtmCampaign = utm;
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
    if (lastUtmCampaign != null) out.utm_campaign = lastUtmCampaign;
    return out;
  }

  function send(payload) {
    try {
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

  ensureIds().then(() => {
    const cart = init?.data?.cart;
    cartQty = cart?.totalQuantity ?? 0;
    if (typeof cartQty !== 'number') cartQty = 0;
    const money = cartMoneyFromCart(cart);
    cartValue = money.cart_value;
    cartCurrency = money.cart_currency;
    lastPath = pathFromContext(init?.context) || '/';
    const utm = utmCampaignFromContext(init?.context);
    if (utm != null) lastUtmCampaign = utm;
    send(payload('page_viewed', { cart_qty: cartQty, cart_value: cartValue, cart_currency: cartCurrency }));
    startHeartbeat();
  }).catch(() => {});

  analytics.subscribe('page_viewed', (event) => {
    try {
      lastPath = pathFromContext(event?.context) || pathFromContext(init?.context) || lastPath;
      const utm = utmCampaignFromContext(event?.context) ?? utmCampaignFromContext(init?.context);
      if (utm != null) lastUtmCampaign = utm;
      send(payload('page_viewed'));
    } catch (_) {}
  });

  analytics.subscribe('product_viewed', (event) => {
    try {
      lastPath = pathFromContext(event?.context) || lastPath;
      const utm = utmCampaignFromContext(event?.context) ?? utmCampaignFromContext(init?.context);
      if (utm != null) lastUtmCampaign = utm;
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
      const totalPrice = checkout?.totalPrice;
      const orderTotal = typeof totalPrice?.amount === 'number' ? totalPrice.amount : null;
      const orderCurrency = checkout?.currencyCode ?? totalPrice?.currencyCode ?? null;
      send(payload('checkout_completed', {
        checkout_completed: true,
        order_total: orderTotal,
        order_currency: orderCurrency,
      }));
    } catch (_) {}
  });
});
