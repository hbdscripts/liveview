/**
 * Payment method normaliser (server-side canonical classification).
 *
 * Why this exists:
 * - The legacy "Payment Types" insights grouped by `purchases.payment_gateway`, which produces gateway
 *   strings like "shopify_payments" and can be null -> "unknown". Those are not customer-facing.
 * - This normaliser produces a canonical `payment_method_key` + human label used consistently by
 *   both table + chart, with controlled fallback `other` (never `unknown`).
 *
 * Note on Shopify Payments:
 * - Shopify Payments is a processor/gateway, not the end payment method the customer used.
 * - If we can determine wallet/card brand from evidence (payment method type/name/card brand),
 *   we surface that (Apple Pay, Google Pay, Shop Pay, Visa, Mastercard, Amex, ...).
 * - If we cannot determine it, we fall back to `other`.
 */

function s(v) { try { return v == null ? '' : String(v); } catch (_) { return ''; } }

function flatToken(raw) {
  return s(raw).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function includesAnyFlat(flat, needles) {
  if (!flat) return false;
  for (const n of needles) {
    if (!n) continue;
    if (flat.includes(n)) return true;
  }
  return false;
}

// Payment icons are no longer baked-in; they come from Settings → Icons (asset_overrides) or icon registry fallback.
function methodMeta(key) {
  const k = s(key).trim().toLowerCase();
  if (k === 'visa') return { key: 'visa', label: 'Visa' };
  if (k === 'mastercard') return { key: 'mastercard', label: 'Mastercard' };
  if (k === 'amex') return { key: 'amex', label: 'American Express' };
  if (k === 'maestro') return { key: 'maestro', label: 'Maestro' };
  if (k === 'discover') return { key: 'discover', label: 'Discover' };
  if (k === 'jcb') return { key: 'jcb', label: 'JCB' };
  if (k === 'diners') return { key: 'diners', label: 'Diners Club' };
  if (k === 'unionpay') return { key: 'unionpay', label: 'UnionPay' };
  if (k === 'paypal') return { key: 'paypal', label: 'PayPal' };
  if (k === 'klarna') return { key: 'klarna', label: 'Klarna' };
  // UK canonical label
  if (k === 'clearpay') return { key: 'clearpay', label: 'Clearpay' };
  // Canonicalize Afterpay → Clearpay (UK label)
  if (k === 'afterpay') return { key: 'clearpay', label: 'Clearpay' };
  if (k === 'affirm') return { key: 'affirm', label: 'Affirm' };
  if (k === 'zip') return { key: 'zip', label: 'Zip' };
  if (k === 'sezzle') return { key: 'sezzle', label: 'Sezzle' };
  if (k === 'stripe') return { key: 'stripe', label: 'Stripe' };
  if (k === 'shop_pay') return { key: 'shop_pay', label: 'Shop Pay' };
  if (k === 'apple_pay') return { key: 'apple_pay', label: 'Apple Pay' };
  if (k === 'google_pay') return { key: 'google_pay', label: 'Google Pay' };
  return { key: 'other', label: 'Other' };
}

/**
 * @param {object} input
 * @param {string?} input.gateway - purchases.payment_gateway (pixel best transaction gateway/processor)
 * @param {string?} input.methodType - purchases.payment_method_type
 * @param {string?} input.methodName - purchases.payment_method_name
 * @param {string?} input.cardBrand - purchases.payment_card_brand (when available)
 * @returns {{ key: string, label: string, iconSrc: string|null, iconAlt: string, debug: object }}
 */
function normalizePaymentMethod(input) {
  const gatewayRaw = s(input && input.gateway).trim();
  const methodTypeRaw = s(input && input.methodType).trim();
  const methodNameRaw = s(input && input.methodName).trim();
  const cardBrandRaw = s(input && input.cardBrand).trim();

  const gateway = flatToken(gatewayRaw);
  const methodType = flatToken(methodTypeRaw);
  const methodName = flatToken(methodNameRaw);
  const cardBrand = flatToken(cardBrandRaw);

  const candidates = [cardBrand, methodType, methodName, gateway].filter(Boolean);
  const isShopifyPayments = includesAnyFlat(gateway, ['shopifypayments', 'shopifypayment', 'shopifypay']);

  function any(needles) {
    for (const c of candidates) {
      if (includesAnyFlat(c, needles)) return true;
    }
    return false;
  }

  // Wallets / BNPL first (avoid classifying Apple Pay as "card").
  if (any(['paypal'])) {
    const m = methodMeta('paypal');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['klarna'])) {
    const m = methodMeta('klarna');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['clearpay'])) {
    const m = methodMeta('clearpay');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['afterpay'])) {
    const m = methodMeta('clearpay');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['affirm'])) {
    const m = methodMeta('affirm');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['zip'])) {
    const m = methodMeta('zip');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['sezzle'])) {
    const m = methodMeta('sezzle');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['stripe'])) {
    const m = methodMeta('stripe');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['shoppay', 'shop-pay', 'shop_pay'])) {
    const m = methodMeta('shop_pay');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['applepay', 'apple-pay', 'apple_pay'])) {
    const m = methodMeta('apple_pay');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['googlepay', 'google-pay', 'google_pay', 'gpay'])) {
    const m = methodMeta('google_pay');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }

  // Card brands.
  if (any(['visa'])) {
    const m = methodMeta('visa');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['mastercard', 'mastercarddebit', 'mastercardcredit', 'mastercardprepaid', 'mastercardworld', 'mastercardworldelite', 'master'])) {
    // Guard: treat generic "master" only when the gateway is Shopify Payments or a card context.
    if (any(['mastercard']) || isShopifyPayments || any(['creditcard', 'debitcard', 'card'])) {
      const m = methodMeta('mastercard');
      return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
    }
  }
  if (any(['americanexpress', 'amex'])) {
    const m = methodMeta('amex');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['maestro'])) {
    const m = methodMeta('maestro');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['discover'])) {
    const m = methodMeta('discover');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['diners', 'dinersclub'])) {
    const m = methodMeta('diners');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['jcb'])) {
    const m = methodMeta('jcb');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }
  if (any(['unionpay'])) {
    const m = methodMeta('unionpay');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }

  // Shopify Payments is a gateway; never emit it as a method.
  if (isShopifyPayments) {
    const m = methodMeta('other');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }

  // If it looks like a card but we can't resolve the brand, prefer controlled "Other" (never "unknown").
  if (any(['creditcard', 'debitcard', 'card'])) {
    const m = methodMeta('other');
    return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
  }

  const m = methodMeta('other');
  return { ...m, iconSrc: null, iconAlt: m.label, debug: { gateway: gatewayRaw, methodType: methodTypeRaw, methodName: methodNameRaw, cardBrand: cardBrandRaw } };
}

module.exports = {
  normalizePaymentMethod,
  __private: { flatToken, methodMeta },
};

