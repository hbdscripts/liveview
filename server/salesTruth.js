/**
 * Shopify Orders Truth layer.
 *
 * Authoritative sales/orders/revenue come from Shopify Orders API.
 * We cache/upsert into orders_shopify so dashboard stays consistent and fail-open.
 */
const config = require('./config');
const fx = require('./fx');
const { getDb, isPostgres } = require('./db');
const { writeAudit } = require('./audit');
const backup = require('./backup');

const API_VERSION = '2024-01';
const PRE_RECONCILE_BACKUP_TTL_MS = 24 * 60 * 60 * 1000;
const CUSTOMER_FACTS_NULL_RECHECK_TTL_MS = 6 * 60 * 60 * 1000;
let lastPreReconcileBackupAt = 0;
let _lineItemsTableOk = null; // null unknown, true exists, false missing
let _shippingOptionsTableOk = null; // null unknown, true exists, false missing

function truthy(v) {
  return v === true || v === 1 || v === '1' || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeShopDomain(shop) {
  const s = typeof shop === 'string' ? shop.trim().toLowerCase() : '';
  return s && s.endsWith('.myshopify.com') ? s : '';
}

function resolveShopForSales(explicitShop) {
  const fromParam = normalizeShopDomain(explicitShop);
  if (fromParam) return fromParam;
  const a = normalizeShopDomain(config.allowedShopDomain);
  if (a) return a;
  const b = normalizeShopDomain(config.shopDomain);
  if (b) return b;
  return '';
}

function extractNumericId(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v));
  const s = String(v).trim();
  if (!s) return null;
  // Shopify GraphQL gid://shopify/Order/123
  const m = s.match(/\/Order\/(\d+)$/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  return s;
}

function parseMs(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function numOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseFloatSafe(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function normalizeTitle(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || 'Unknown';
}

function normalizeVariantTitle(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return s.toLowerCase() === 'default title' ? null : s;
}

async function lineItemsTableOk() {
  if (_lineItemsTableOk === true) return true;
  if (_lineItemsTableOk === false) return false;
  try {
    await getDb().get('SELECT 1 FROM orders_shopify_line_items LIMIT 1');
    _lineItemsTableOk = true;
    return true;
  } catch (_) {
    _lineItemsTableOk = false;
    return false;
  }
}

async function shippingOptionsTableOk() {
  if (_shippingOptionsTableOk === true) return true;
  if (_shippingOptionsTableOk === false) return false;
  try {
    await getDb().get('SELECT 1 FROM orders_shopify_shipping_options LIMIT 1');
    _shippingOptionsTableOk = true;
    return true;
  } catch (_) {
    _shippingOptionsTableOk = false;
    return false;
  }
}

function normalizeCountryCode(v) {
  const c = v != null ? String(v).trim().toUpperCase().slice(0, 2) : '';
  if (!c) return 'XX';
  if (c === 'UK') return 'GB';
  if (!/^[A-Z]{2}$/.test(c)) return 'XX';
  return c;
}

function orderCountryCode(order) {
  const ship =
    order?.shipping_address?.country_code ??
    order?.shipping_address?.countryCode ??
    order?.shippingAddress?.countryCode ??
    order?.shippingAddress?.country_code ??
    null;
  const bill =
    order?.billing_address?.country_code ??
    order?.billing_address?.countryCode ??
    order?.billingAddress?.countryCode ??
    order?.billingAddress?.country_code ??
    null;
  return normalizeCountryCode(ship || bill);
}

function shippingLabelFromOrder(order) {
  const lines = Array.isArray(order?.shipping_lines) ? order.shipping_lines : [];
  for (const l of lines) {
    const title = l && l.title != null ? String(l.title).trim() : '';
    if (title) return title;
  }
  return 'Unknown';
}

function shippingPriceFromOrder(order) {
  // Prefer presentment currency (matches order.currency in most setups)
  const presentment =
    order?.total_shipping_price_set?.presentment_money?.amount ??
    order?.total_shipping_price_set?.presentmentMoney?.amount ??
    null;
  const presentmentAmt = numOrNull(presentment);
  if (presentmentAmt != null) return presentmentAmt;

  const lines = Array.isArray(order?.shipping_lines) ? order.shipping_lines : [];
  for (const l of lines) {
    const n =
      numOrNull(l?.price) ??
      numOrNull(l?.price_amount) ??
      shopMoneyAmount(l?.price_set?.presentment_money) ??
      shopMoneyAmount(l?.priceSet?.presentmentMoney) ??
      shopMoneyAmount(l?.price_set) ?? // best-effort fallback
      shopMoneyAmount(l?.priceSet) ??
      null;
    if (n != null) return n;
  }

  // Last resort: shop money amount (may be base currency)
  const shopAmt = shopMoneyAmount(order?.total_shipping_price_set);
  return shopAmt != null ? shopAmt : 0;
}

async function upsertOrderShippingOption(shop, order, orderRow) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop || !orderRow || !orderRow.order_id) return { ok: false, reason: 'missing_shop_or_order' };
  if (!(await shippingOptionsTableOk())) return { ok: false, reason: 'no_table' };

  const db = getDb();
  const orderId = String(orderRow.order_id);
  const orderCreatedAt = orderRow.created_at != null ? Number(orderRow.created_at) : null;
  if (orderCreatedAt == null || !Number.isFinite(orderCreatedAt)) return { ok: false, reason: 'missing_created_at' };
  const orderProcessedAt = orderRow.processed_at != null ? Number(orderRow.processed_at) : null;
  const orderUpdatedAt = orderRow.updated_at != null ? Number(orderRow.updated_at) : null;
  const orderFinancialStatus = orderRow.financial_status != null ? String(orderRow.financial_status).trim().toLowerCase() : null;
  const orderCancelledAt = orderRow.cancelled_at != null ? Number(orderRow.cancelled_at) : null;
  const orderTest = orderRow.test != null ? Number(orderRow.test) : null;
  const syncedAt = orderRow.synced_at != null ? Number(orderRow.synced_at) : Date.now();
  const currency = (orderRow.currency != null ? String(orderRow.currency).trim().toUpperCase() : '') || null;

  const label = shippingLabelFromOrder(order);
  const shippingPrice = shippingPriceFromOrder(order);
  const countryCode = orderCountryCode(order);

  await db.run(
    `
      INSERT INTO orders_shopify_shipping_options
        (shop, order_id, order_created_at, order_processed_at, order_updated_at, order_financial_status, order_cancelled_at, order_test,
         order_country_code, currency, shipping_label, shipping_price, synced_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (shop, order_id) DO UPDATE SET
        order_created_at = EXCLUDED.order_created_at,
        order_processed_at = EXCLUDED.order_processed_at,
        order_updated_at = EXCLUDED.order_updated_at,
        order_financial_status = EXCLUDED.order_financial_status,
        order_cancelled_at = EXCLUDED.order_cancelled_at,
        order_test = EXCLUDED.order_test,
        order_country_code = EXCLUDED.order_country_code,
        currency = EXCLUDED.currency,
        shipping_label = EXCLUDED.shipping_label,
        shipping_price = EXCLUDED.shipping_price,
        synced_at = EXCLUDED.synced_at
    `,
    [
      safeShop,
      orderId,
      Math.trunc(orderCreatedAt),
      Number.isFinite(orderProcessedAt) ? Math.trunc(orderProcessedAt) : null,
      Number.isFinite(orderUpdatedAt) ? Math.trunc(orderUpdatedAt) : null,
      orderFinancialStatus,
      Number.isFinite(orderCancelledAt) ? Math.trunc(orderCancelledAt) : null,
      orderTest,
      countryCode,
      currency,
      label,
      shippingPrice,
      Math.trunc(syncedAt),
    ]
  );

  return { ok: true };
}

async function upsertOrderLineItems(shop, order, orderRow) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop || !orderRow || !orderRow.order_id) return { ok: false, inserted: 0, updated: 0, rows: 0, reason: 'missing_shop_or_order' };
  if (!(await lineItemsTableOk())) return { ok: false, inserted: 0, updated: 0, rows: 0, reason: 'no_table' };
  const items = order && Array.isArray(order.line_items) ? order.line_items : [];
  if (!items.length) return { ok: true, inserted: 0, updated: 0, rows: 0 };

  const orderId = String(orderRow.order_id);
  const orderCreatedAt = orderRow.created_at != null ? Number(orderRow.created_at) : null;
  if (orderCreatedAt == null || !Number.isFinite(orderCreatedAt)) return { ok: false, inserted: 0, updated: 0, rows: 0, reason: 'missing_created_at' };
  const currency = orderRow.currency != null ? String(orderRow.currency).trim() : null;
  const orderUpdatedAt = orderRow.updated_at != null ? Number(orderRow.updated_at) : null;
  const orderFinancialStatus = orderRow.financial_status != null ? String(orderRow.financial_status).trim().toLowerCase() : null;
  const orderCancelledAt = orderRow.cancelled_at != null ? Number(orderRow.cancelled_at) : null;
  const orderTest = orderRow.test != null ? Number(orderRow.test) : null;
  const syncedAt = orderRow.synced_at != null ? Number(orderRow.synced_at) : Date.now();

  const cols = [
    'shop',
    'line_item_id',
    'order_id',
    'order_created_at',
    'order_updated_at',
    'order_financial_status',
    'order_cancelled_at',
    'order_test',
    'currency',
    'product_id',
    'variant_id',
    'quantity',
    'unit_price',
    'line_revenue',
    'title',
    'variant_title',
    'synced_at',
  ];

  const db = getDb();
  const CHUNK = 50; // keep under SQLite parameter limits
  let rows = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    for (const li of chunk) {
      const lineItemId = extractNumericId(li?.id);
      if (!lineItemId) continue;
      const productId = extractNumericId(li?.product_id);
      const variantId = extractNumericId(li?.variant_id);
      const qtyRaw = intOrNull(li?.quantity);
      const qty = qtyRaw != null && Number.isFinite(qtyRaw) ? Math.max(0, Math.trunc(qtyRaw)) : 0;
      const unitPrice = parseFloatSafe(li?.price);
      const lineRevenue = qty * unitPrice;
      const title = normalizeTitle(li?.title);
      const variantTitle = normalizeVariantTitle(li?.variant_title);

      values.push('(' + cols.map(() => '?').join(',') + ')');
      params.push(
        safeShop,
        String(lineItemId),
        orderId,
        Math.trunc(orderCreatedAt),
        Number.isFinite(orderUpdatedAt) ? Math.trunc(orderUpdatedAt) : null,
        orderFinancialStatus,
        Number.isFinite(orderCancelledAt) ? Math.trunc(orderCancelledAt) : null,
        orderTest,
        currency || null,
        productId ? String(productId) : null,
        variantId ? String(variantId) : null,
        qty,
        unitPrice,
        lineRevenue,
        title,
        variantTitle,
        Math.trunc(syncedAt),
      );
      rows += 1;
    }
    if (!values.length) continue;

    await db.run(
      `
      INSERT INTO orders_shopify_line_items (${cols.join(', ')})
      VALUES ${values.join(', ')}
      ON CONFLICT (shop, line_item_id) DO UPDATE SET
        order_id = EXCLUDED.order_id,
        order_created_at = EXCLUDED.order_created_at,
        order_updated_at = EXCLUDED.order_updated_at,
        order_financial_status = EXCLUDED.order_financial_status,
        order_cancelled_at = EXCLUDED.order_cancelled_at,
        order_test = EXCLUDED.order_test,
        currency = EXCLUDED.currency,
        product_id = EXCLUDED.product_id,
        variant_id = EXCLUDED.variant_id,
        quantity = EXCLUDED.quantity,
        unit_price = EXCLUDED.unit_price,
        line_revenue = EXCLUDED.line_revenue,
        title = EXCLUDED.title,
        variant_title = EXCLUDED.variant_title,
        synced_at = EXCLUDED.synced_at
      `,
      params
    );
  }

  return { ok: true, rows };
}

function shopMoneyAmount(setObj) {
  const amt =
    setObj?.shop_money?.amount ??
    setObj?.shopMoney?.amount ??
    setObj?.amount ??
    null;
  return numOrNull(amt);
}

async function getAccessToken(shop) {
  const db = getDb();
  const row = await db.get('SELECT access_token FROM shop_sessions WHERE shop = ?', [shop]);
  return row && row.access_token ? String(row.access_token) : '';
}

async function upsertCustomerOrderFact(shop, customerId, firstPaidOrderAtMs, checkedAtMs) {
  const db = getDb();
  const safeShop = resolveShopForSales(shop);
  if (!safeShop || !customerId) return;
  const cid = String(customerId).trim();
  if (!cid) return;
  const firstMs = firstPaidOrderAtMs != null ? Number(firstPaidOrderAtMs) : null;
  const checkedMs = checkedAtMs != null ? Number(checkedAtMs) : Date.now();
  try {
    if (isPostgres()) {
      await db.run(
        `INSERT INTO customer_order_facts (shop, customer_id, first_paid_order_at, checked_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (shop, customer_id)
         DO UPDATE SET first_paid_order_at = EXCLUDED.first_paid_order_at, checked_at = EXCLUDED.checked_at`,
        [safeShop, cid, firstMs, checkedMs]
      );
    } else {
      await db.run(
        'INSERT OR REPLACE INTO customer_order_facts (shop, customer_id, first_paid_order_at, checked_at) VALUES (?, ?, ?, ?)',
        [safeShop, cid, firstMs, checkedMs]
      );
    }
  } catch (_) {
    // Fail-open: if table doesn't exist yet, ignore.
  }
}

async function ensureCustomerOrderFactsForCustomers(shop, accessToken, customerIds, beforeMs, { maxCustomers = 250 } = {}) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop || !accessToken) return { ok: false, checked: 0, fetched: 0, stored: 0, errors: 0, reason: 'missing_shop_or_token' };
  const db = getDb();
  const boundaryMs = beforeMs != null ? Number(beforeMs) : Date.now();
  const boundaryIso = new Date(boundaryMs).toISOString();

  // If table isn't present yet, skip (fail-open).
  try {
    await db.get('SELECT 1 FROM customer_order_facts LIMIT 1');
  } catch (_) {
    return { ok: false, checked: 0, fetched: 0, stored: 0, errors: 0, reason: 'no_customer_order_facts_table' };
  }

  const uniq = Array.from(new Set((customerIds || []).map((c) => (c == null ? '' : String(c).trim())).filter(Boolean)));
  const list = uniq.slice(0, Math.max(0, maxCustomers | 0));

  let checked = 0;
  let fetched = 0;
  let stored = 0;
  let errors = 0;

  for (const cid of list) {
    checked += 1;
    let prevFirstPaidAt = null;
    try {
      const existing = await db.get(
        'SELECT first_paid_order_at, checked_at FROM customer_order_facts WHERE shop = ? AND customer_id = ?',
        [safeShop, cid]
      );
      prevFirstPaidAt = existing && existing.first_paid_order_at != null ? Number(existing.first_paid_order_at) : null;
      if (prevFirstPaidAt != null && Number.isFinite(prevFirstPaidAt) && prevFirstPaidAt < boundaryMs) continue;

      const prevCheckedAt = existing && existing.checked_at != null ? Number(existing.checked_at) : null;
      // If we have never found a prior paid order yet (null), avoid rechecking too frequently.
      if ((prevFirstPaidAt == null || !Number.isFinite(prevFirstPaidAt)) && prevCheckedAt && (Date.now() - prevCheckedAt) < CUSTOMER_FACTS_NULL_RECHECK_TTL_MS) continue;
    } catch (_) {
      // continue; we'll try fetch + insert anyway
    }

    try {
      const url = priorPaidOrderForCustomerBeforeApiUrl(safeShop, cid, boundaryIso);
      const res = await shopifyFetchWithRetry(url, accessToken, { maxRetries: 6 });
      const text = await res.text();
      if (!res.ok) {
        errors += 1;
        continue;
      }
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      const order = json && Array.isArray(json.orders) ? json.orders[0] : null;
      const priorPaidOrderAt = parseMs(order?.created_at);
      let nextFirstPaidAt = prevFirstPaidAt;
      if (priorPaidOrderAt != null && (nextFirstPaidAt == null || !Number.isFinite(nextFirstPaidAt) || priorPaidOrderAt < nextFirstPaidAt)) {
        nextFirstPaidAt = priorPaidOrderAt;
      }
      await upsertCustomerOrderFact(safeShop, cid, nextFirstPaidAt, Date.now());
      fetched += 1;
      stored += 1;
    } catch (_) {
      errors += 1;
    }
  }

  try {
    if (fetched > 0 || errors > 0) {
      await writeAudit('system', 'ensure_customer_order_facts', { shop: safeShop, checked, fetched, stored, errors, boundaryMs });
    }
  } catch (_) {}

  return { ok: true, checked, fetched, stored, errors };
}

async function backfillEvidenceLinksForOrder(shop, orderId, checkoutToken) {
  const db = getDb();
  if (!shop || !orderId) return 0;
  let linked = 0;
  try {
    const r1 = await db.run(
      `UPDATE purchase_events SET linked_order_id = ?, link_reason = COALESCE(link_reason, 'order_id_late')
       WHERE shop = ? AND linked_order_id IS NULL AND order_id = ?`,
      [orderId, shop, orderId]
    );
    linked += r1 && r1.changes ? Number(r1.changes) : 0;
  } catch (_) {}
  if (checkoutToken) {
    try {
      const r2 = await db.run(
        `UPDATE purchase_events SET linked_order_id = ?, link_reason = COALESCE(link_reason, 'checkout_token_late')
         WHERE shop = ? AND linked_order_id IS NULL AND checkout_token = ?`,
        [orderId, shop, checkoutToken]
      );
      linked += r2 && r2.changes ? Number(r2.changes) : 0;
    } catch (_) {}
  }
  return linked;
}

function parseNextPageUrl(linkHeader) {
  if (!linkHeader || typeof linkHeader !== 'string') return null;
  if (!(linkHeader.includes('rel="next"') || linkHeader.includes('rel=next'))) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="?next"?/);
  return match ? match[1] : null;
}

async function shopifyFetchWithRetry(url, accessToken, { maxRetries = 5 } = {}) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    const res = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });

    if (res.status !== 429) return res;

    const retryAfter = res.headers.get('retry-after');
    const waitSeconds = retryAfter ? parseInt(String(retryAfter), 10) : NaN;
    const waitMs = Number.isFinite(waitSeconds) && waitSeconds > 0 ? waitSeconds * 1000 : 1000;
    if (attempt >= maxRetries) return res;
    await sleep(Math.min(waitMs, 10000));
  }
}

function ordersApiUrl(shop, createdMinIso, createdMaxIso) {
  const fields = [
    'id',
    'name',
    'order_number',
    'created_at',
    'processed_at',
    'updated_at',
    'financial_status',
    'cancelled_at',
    'test',
    'currency',
    'total_price',
    'subtotal_price',
    'total_tax',
    'total_discounts',
    'total_shipping_price_set',
    'shipping_lines',
    'landing_site',
    'referring_site',
    'client_details',
    'shipping_address',
    'billing_address',
    'customer',
    'checkout_token',
    'line_items',
  ].join(',');
  const qs =
    'status=any' +
    '&financial_status=paid' +
    '&created_at_min=' + encodeURIComponent(createdMinIso) +
    '&created_at_max=' + encodeURIComponent(createdMaxIso) +
    '&limit=250' +
    '&fields=' + encodeURIComponent(fields);
  return `https://${shop}/admin/api/${API_VERSION}/orders.json?${qs}`;
}

function ordersApiUrlForFinancialStatus(shop, createdMinIso, createdMaxIso, financialStatus, fieldsCsv) {
  const fs = (fieldsCsv && String(fieldsCsv).trim()) ? String(fieldsCsv).trim() : 'id,created_at,financial_status,cancelled_at,test,fulfillment_status';
  const status = (financialStatus && String(financialStatus).trim()) ? String(financialStatus).trim() : 'any';
  const qs =
    'status=any' +
    '&financial_status=' + encodeURIComponent(status) +
    '&created_at_min=' + encodeURIComponent(createdMinIso) +
    '&created_at_max=' + encodeURIComponent(createdMaxIso) +
    '&limit=250' +
    '&fields=' + encodeURIComponent(fs);
  return `https://${shop}/admin/api/${API_VERSION}/orders.json?${qs}`;
}

function priorPaidOrderForCustomerBeforeApiUrl(shop, customerId, beforeIso) {
  const fields = [
    'id',
    'name',
    'order_number',
    'created_at',
    'processed_at',
    'updated_at',
    'financial_status',
    'cancelled_at',
    'test',
    'currency',
    'total_price',
    'subtotal_price',
    'total_tax',
    'total_discounts',
    'total_shipping_price_set',
    'shipping_lines',
    'landing_site',
    'referring_site',
    'client_details',
    'customer',
    'checkout_token',
  ].join(',');
  const qs =
    'status=any' +
    '&financial_status=paid' +
    '&customer_id=' + encodeURIComponent(String(customerId || '').trim()) +
    '&created_at_max=' + encodeURIComponent(String(beforeIso || '').trim()) +
    '&limit=1' +
    '&fields=' + encodeURIComponent(fields);
  return `https://${shop}/admin/api/${API_VERSION}/orders.json?${qs}`;
}

function orderToRow(shop, order, syncedAtMs) {
  const orderId = extractNumericId(order?.id);
  const checkoutToken = order?.checkout_token != null ? String(order.checkout_token).trim() : '';
  const customerId = extractNumericId(order?.customer?.id);
  const customerOrdersCount = intOrNull(order?.customer?.orders_count);
  return {
    shop,
    order_id: orderId,
    order_name: (order?.name != null ? String(order.name) : null),
    created_at: parseMs(order?.created_at),
    processed_at: parseMs(order?.processed_at),
    updated_at: parseMs(order?.updated_at),
    financial_status: (order?.financial_status != null ? String(order.financial_status) : null),
    cancelled_at: parseMs(order?.cancelled_at),
    test: order?.test === true ? 1 : 0,
    currency: (order?.currency != null ? String(order.currency) : null),
    total_price: numOrNull(order?.total_price),
    subtotal_price: numOrNull(order?.subtotal_price),
    total_tax: numOrNull(order?.total_tax),
    total_discounts: numOrNull(order?.total_discounts),
    total_shipping: shopMoneyAmount(order?.total_shipping_price_set),
    customer_id: customerId,
    customer_orders_count: customerOrdersCount,
    checkout_token: checkoutToken || null,
    synced_at: syncedAtMs,
    raw_json: (() => {
      try { return JSON.stringify(order); } catch (_) { return null; }
    })(),
  };
}

async function getExistingOrderMeta(shop, orderId) {
  const db = getDb();
  try {
    return await db.get(
      'SELECT updated_at, synced_at, customer_orders_count, raw_json FROM orders_shopify WHERE shop = ? AND order_id = ?',
      [shop, orderId]
    );
  } catch (_) {
    // Backwards-compatible fallback (older schema).
    return db.get(
      'SELECT updated_at, synced_at, raw_json FROM orders_shopify WHERE shop = ? AND order_id = ?',
      [shop, orderId]
    );
  }
}

async function insertOrder(row) {
  const db = getDb();
  if (isPostgres()) {
    await db.run(
      `
      INSERT INTO orders_shopify
        (shop, order_id, order_name, created_at, processed_at, financial_status, cancelled_at, test, currency,
         total_price, subtotal_price, total_tax, total_discounts, total_shipping, customer_id, customer_orders_count, checkout_token,
         updated_at, synced_at, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?)
      ON CONFLICT (shop, order_id) DO NOTHING
      `,
      [
        row.shop,
        row.order_id,
        row.order_name,
        row.created_at,
        row.processed_at,
        row.financial_status,
        row.cancelled_at,
        row.test,
        row.currency,
        row.total_price,
        row.subtotal_price,
        row.total_tax,
        row.total_discounts,
        row.total_shipping,
        row.customer_id,
        row.customer_orders_count,
        row.checkout_token,
        row.updated_at,
        row.synced_at,
        row.raw_json,
      ]
    );
  } else {
    await db.run(
      `
      INSERT OR IGNORE INTO orders_shopify
        (shop, order_id, order_name, created_at, processed_at, financial_status, cancelled_at, test, currency,
         total_price, subtotal_price, total_tax, total_discounts, total_shipping, customer_id, customer_orders_count, checkout_token,
         updated_at, synced_at, raw_json)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?)
      `,
      [
        row.shop,
        row.order_id,
        row.order_name,
        row.created_at,
        row.processed_at,
        row.financial_status,
        row.cancelled_at,
        row.test,
        row.currency,
        row.total_price,
        row.subtotal_price,
        row.total_tax,
        row.total_discounts,
        row.total_shipping,
        row.customer_id,
        row.customer_orders_count,
        row.checkout_token,
        row.updated_at,
        row.synced_at,
        row.raw_json,
      ]
    );
  }
}

async function updateOrder(row) {
  const db = getDb();
  await db.run(
    `
    UPDATE orders_shopify SET
      order_name = ?,
      created_at = ?,
      processed_at = ?,
      financial_status = ?,
      cancelled_at = ?,
      test = ?,
      currency = ?,
      total_price = ?,
      subtotal_price = ?,
      total_tax = ?,
      total_discounts = ?,
      total_shipping = ?,
      customer_id = ?,
      customer_orders_count = ?,
      checkout_token = ?,
      updated_at = ?,
      synced_at = ?,
      raw_json = ?
    WHERE shop = ? AND order_id = ?
    `,
    [
      row.order_name,
      row.created_at,
      row.processed_at,
      row.financial_status,
      row.cancelled_at,
      row.test,
      row.currency,
      row.total_price,
      row.subtotal_price,
      row.total_tax,
      row.total_discounts,
      row.total_shipping,
      row.customer_id,
      row.customer_orders_count,
      row.checkout_token,
      row.updated_at,
      row.synced_at,
      row.raw_json,
      row.shop,
      row.order_id,
    ]
  );
}

async function upsertOrder(row) {
  if (!row || !row.shop || !row.order_id || row.created_at == null) return { inserted: 0, updated: 0 };
  const existing = await getExistingOrderMeta(row.shop, row.order_id);
  if (!existing) {
    await insertOrder(row);
    return { inserted: 1, updated: 0 };
  }
  const prevUpdated = existing.updated_at != null ? Number(existing.updated_at) : null;
  const nextUpdated = row.updated_at != null ? Number(row.updated_at) : null;
  const prevOrdersCount = existing.customer_orders_count != null ? Number(existing.customer_orders_count) : null;
  const nextOrdersCount = row.customer_orders_count != null ? Number(row.customer_orders_count) : null;
  const missingDerived = prevOrdersCount == null && nextOrdersCount != null;
  const prevRaw = existing && typeof existing.raw_json === 'string' ? existing.raw_json : '';
  const nextRaw = row && typeof row.raw_json === 'string' ? row.raw_json : '';
  const prevHasAddresses = !!(prevRaw && (prevRaw.includes('"shipping_address"') || prevRaw.includes('"billing_address"') || prevRaw.includes('"shippingAddress"') || prevRaw.includes('"billingAddress"')));
  const nextHasAddresses = !!(nextRaw && (nextRaw.includes('"shipping_address"') || nextRaw.includes('"billing_address"') || nextRaw.includes('"shippingAddress"') || nextRaw.includes('"billingAddress"')));
  const missingAddressFields = !prevHasAddresses && nextHasAddresses;
  const prevHasAttribution = !!(prevRaw && (prevRaw.includes('"landing_site"') || prevRaw.includes('"landingSite"') || prevRaw.includes('"referring_site"') || prevRaw.includes('"referringSite"') || prevRaw.includes('"client_details"') || prevRaw.includes('"clientDetails"')));
  const nextHasAttribution = !!(nextRaw && (nextRaw.includes('"landing_site"') || nextRaw.includes('"landingSite"') || nextRaw.includes('"referring_site"') || nextRaw.includes('"referringSite"') || nextRaw.includes('"client_details"') || nextRaw.includes('"clientDetails"')));
  const missingAttributionFields = !prevHasAttribution && nextHasAttribution;
  const shouldUpdate = missingDerived || missingAddressFields || missingAttributionFields || (prevUpdated == null || nextUpdated == null ? true : nextUpdated !== prevUpdated);
  if (shouldUpdate) {
    await updateOrder(row);
    return { inserted: 0, updated: 1 };
  }
  // Still refresh synced_at so health reflects recent success.
  await getDb().run('UPDATE orders_shopify SET synced_at = ? WHERE shop = ? AND order_id = ?', [row.synced_at, row.shop, row.order_id]);
  return { inserted: 0, updated: 0 };
}

async function upsertReconcileState(shop, scope, patch) {
  const db = getDb();
  const safeShop = resolveShopForSales(shop);
  if (!safeShop || !scope) return;
  const scopeKey = String(scope).slice(0, 64);
  const current = await db.get('SELECT * FROM reconcile_state WHERE shop = ? AND scope = ?', [safeShop, scopeKey]);
  // IMPORTANT: patch values must be able to clear fields (set NULL).
  // Do not use ?? here because passing { last_error: null } should overwrite the prior value.
  const next = {
    shop: safeShop,
    scope: scopeKey,
    last_success_at: Object.prototype.hasOwnProperty.call(patch, 'last_success_at') ? patch.last_success_at : (current?.last_success_at ?? null),
    last_attempt_at: Object.prototype.hasOwnProperty.call(patch, 'last_attempt_at') ? patch.last_attempt_at : (current?.last_attempt_at ?? null),
    last_error: Object.prototype.hasOwnProperty.call(patch, 'last_error') ? patch.last_error : (current?.last_error ?? null),
    cursor_json: Object.prototype.hasOwnProperty.call(patch, 'cursor_json') ? patch.cursor_json : (current?.cursor_json ?? null),
  };
  if (current) {
    await db.run(
      'UPDATE reconcile_state SET last_success_at = ?, last_attempt_at = ?, last_error = ?, cursor_json = ? WHERE shop = ? AND scope = ?',
      [next.last_success_at, next.last_attempt_at, next.last_error, next.cursor_json, next.shop, next.scope]
    );
  } else {
    await db.run(
      'INSERT INTO reconcile_state (shop, scope, last_success_at, last_attempt_at, last_error, cursor_json) VALUES (?, ?, ?, ?, ?, ?)',
      [next.shop, next.scope, next.last_success_at, next.last_attempt_at, next.last_error, next.cursor_json]
    );
  }
}

async function getReconcileState(shop, scope) {
  const db = getDb();
  const safeShop = resolveShopForSales(shop);
  const scopeKey = String(scope || 'today').slice(0, 64);
  if (!safeShop) return null;
  try {
    return await db.get('SELECT * FROM reconcile_state WHERE shop = ? AND scope = ?', [safeShop, scopeKey]);
  } catch (_) {
    return null;
  }
}

function reconcileMinIntervalMs() {
  const v = process.env.SALES_TRUTH_RECONCILE_MIN_INTERVAL_SECONDS;
  const n = v != null ? parseInt(String(v), 10) : NaN;
  const seconds = Number.isFinite(n) && n > 0 ? n : 90;
  return seconds * 1000;
}

async function shouldReconcile(shop, scope) {
  const state = await getReconcileState(shop, scope);
  const now = Date.now();
  const lastSuccess = state?.last_success_at != null ? Number(state.last_success_at) : null;
  const lastAttempt = state?.last_attempt_at != null ? Number(state.last_attempt_at) : null;
  if (lastSuccess != null && Number.isFinite(lastSuccess)) {
    const age = now - lastSuccess;
    if (age >= 0 && age < reconcileMinIntervalMs()) {
      return { ok: false, reason: 'throttled', state };
    }
  }
  // Prevent concurrent (duplicate) reconciles when multiple endpoints refresh at once.
  // If an attempt started recently and we don't have a newer success yet, treat as in-flight.
  if (lastAttempt != null && Number.isFinite(lastAttempt)) {
    const attemptAge = now - lastAttempt;
    const inFlightWindow = Math.max(30 * 1000, reconcileMinIntervalMs());
    const successIsNewer = (lastSuccess != null && Number.isFinite(lastSuccess) && lastSuccess >= lastAttempt);
    if (!successIsNewer && attemptAge >= 0 && attemptAge < inFlightWindow) {
      return { ok: false, reason: 'in_flight', state };
    }
  }
  return { ok: true, reason: 'stale_or_missing', state };
}

async function reconcileRange(shop, startMs, endMs, scope = 'range') {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return { ok: false, error: 'No shop configured', inserted: 0, updated: 0, fetched: 0 };

  const token = await getAccessToken(safeShop);
  if (!token) return { ok: false, error: 'No access token for shop', inserted: 0, updated: 0, fetched: 0 };

  // Required: backup before reconciliation (but avoid backing up on every refresh).
  try {
    const now = Date.now();
    if (!lastPreReconcileBackupAt || (now - lastPreReconcileBackupAt) > PRE_RECONCILE_BACKUP_TTL_MS) {
      await backup.backup({
        label: 'pre_reconcile',
        tables: ['orders_shopify', 'purchase_events', 'purchases', 'sessions'],
        retention: { keep: 7 },
      });
      lastPreReconcileBackupAt = now;
      await writeAudit('system', 'backup', { when: 'pre_reconcile', shop: safeShop, ts: now });
    }
  } catch (_) {
    // Fail-open: backup issues should not block truth reconciliation.
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const firstUrl = ordersApiUrl(safeShop, startIso, endIso);
  const now = Date.now();

  await upsertReconcileState(safeShop, scope, { last_attempt_at: now, last_error: null });

  let fetched = 0;
  let inserted = 0;
  let updated = 0;
  let evidenceLinked = 0;
  let lineItemsRows = 0;
  let shippingOptionsRows = 0;
  let shopifyOrderCount = 0;
  const shopifyRevenueByCurrency = new Map(); // currency -> number
  const customerIdsInRange = new Set(); // customer_id strings present in fetched orders
  let nextUrl = firstUrl;

  try {
    while (nextUrl) {
      const res = await shopifyFetchWithRetry(nextUrl, token, { maxRetries: 6 });
      const text = await res.text();
      if (!res.ok) {
        const err = { status: res.status, body: text ? String(text).slice(0, 500) : '' };
        throw Object.assign(new Error(`Shopify Orders API error (HTTP ${res.status})`), { details: err });
      }
      let json;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      const orders = json && Array.isArray(json.orders) ? json.orders : [];
      for (const order of orders) {
        fetched += 1;
        const row = orderToRow(safeShop, order, Date.now());
        // Shopify-fetched summary (truth source). Keep filters aligned with reporting:
        // exclude test orders + cancelled orders, and keep paid only.
        const status = row.financial_status != null ? String(row.financial_status).trim().toLowerCase() : '';
        const reportable = (row.test == null || Number(row.test) === 0) && row.cancelled_at == null && status === 'paid';
        if (reportable) {
          if (row.customer_id) customerIdsInRange.add(String(row.customer_id));
          shopifyOrderCount += 1;
          const cur = (row.currency && String(row.currency).trim()) ? String(row.currency).trim().toUpperCase() : 'GBP';
          const amt = row.total_price != null ? Number(row.total_price) : 0;
          if (Number.isFinite(amt) && amt !== 0) {
            shopifyRevenueByCurrency.set(cur, (shopifyRevenueByCurrency.get(cur) || 0) + amt);
          }
        }
        const r = await upsertOrder(row);
        inserted += r.inserted;
        updated += r.updated;
        try {
          const li = await upsertOrderLineItems(safeShop, order, row);
          if (li && li.ok && li.rows) lineItemsRows += Number(li.rows) || 0;
        } catch (_) {
          // Fail-open: line-items facts are an optimization; do not block reconciliation.
        }
        try {
          const so = await upsertOrderShippingOption(safeShop, order, row);
          if (so && so.ok) shippingOptionsRows += 1;
        } catch (_) {
          // Fail-open: shipping option facts are an optimization; do not block reconciliation.
        }
        evidenceLinked += await backfillEvidenceLinksForOrder(safeShop, row.order_id, row.checkout_token);
      }
      nextUrl = parseNextPageUrl(res.headers.get('link'));
    }
    // Convert Shopify-fetched revenue to GBP using the same FX helper the dashboard uses.
    const ratesToGbp = await fx.getRatesToGbp();
    let shopifyRevenueGbp = 0;
    for (const [cur, amt] of shopifyRevenueByCurrency.entries()) {
      const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
      if (typeof gbp === 'number' && Number.isFinite(gbp)) shopifyRevenueGbp += gbp;
    }
    shopifyRevenueGbp = Math.round(shopifyRevenueGbp * 100) / 100;

    // Returning customers require customer history. We keep a small truth cache (first paid order per customer)
    // populated lazily from Shopify Orders API (read_orders).
    const shouldEnsureFacts = scope === 'today' || String(scope || '').startsWith('verify_');
    let factsResult = null;
    if (shouldEnsureFacts && customerIdsInRange.size > 0) {
      try {
        factsResult = await ensureCustomerOrderFactsForCustomers(
          safeShop,
          token,
          Array.from(customerIdsInRange),
          startMs,
          { maxCustomers: scope === 'today' ? 200 : 400 }
        );
      } catch (_) {
        factsResult = { ok: false, reason: 'ensure_failed' };
      }
    }

    let returning = null;
    try {
      const rows = await getTruthReturningRevenueRows(safeShop, startMs, endMs);
      const revenueGbp = await sumRowsToGbp(rows);
      const revenueByCurrency = {};
      for (const r of rows || []) {
        const cur = (r && r.currency != null) ? String(r.currency).trim().toUpperCase() : 'GBP';
        const total = r && r.total != null ? Number(r.total) : 0;
        if (!cur) continue;
        revenueByCurrency[cur] = Math.round((Number(total) || 0) * 100) / 100;
      }
      const customerCount = await getTruthReturningCustomerCount(safeShop, startMs, endMs);
      const orderCount = await getTruthReturningOrderCount(safeShop, startMs, endMs);
      returning = { customerCount, orderCount, revenueGbp, revenueByCurrency };
    } catch (_) {
      returning = { customerCount: 0, orderCount: 0, revenueGbp: 0, revenueByCurrency: {} };
    }

    await upsertReconcileState(safeShop, scope, { last_success_at: Date.now(), last_error: null });
    await writeAudit('system', 'reconcile_orders_shopify', {
      shop: safeShop,
      scope,
      startMs,
      endMs,
      fetched,
      inserted,
      updated,
      evidenceLinked,
      lineItemsRows,
      shippingOptionsRows,
      customerFacts: factsResult,
      shopify: {
        orderCount: shopifyOrderCount,
        revenueGbp: shopifyRevenueGbp,
        revenueByCurrency: Object.fromEntries(Array.from(shopifyRevenueByCurrency.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        returning,
      },
    });
    // Append-only reconcile snapshot (audit trail). Fail-open if table doesn't exist yet.
    try {
      const db = getDb();
      const fetchedAt = Date.now();
      const scopeKey = String(scope || 'range').slice(0, 64);
      await db.run(
        `INSERT INTO reconcile_snapshots
          (shop, scope, range_start_ts, range_end_ts, shopify_order_count, shopify_revenue_gbp, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [safeShop, scopeKey, startMs, endMs, shopifyOrderCount, shopifyRevenueGbp, fetchedAt]
      );
    } catch (_) {}
    return {
      ok: true,
      inserted,
      updated,
      fetched,
      shippingOptionsRows,
      shopify: {
        orderCount: shopifyOrderCount,
        revenueGbp: shopifyRevenueGbp,
        revenueByCurrency: Object.fromEntries(Array.from(shopifyRevenueByCurrency.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        returning,
      },
    };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Reconcile failed';
    const details = err && err.details ? err.details : null;
    await upsertReconcileState(safeShop, scope, { last_error: details ? msg + ' ' + safeJson(details) : msg, last_attempt_at: Date.now() });
    await writeAudit('system', 'reconcile_orders_shopify_error', {
      shop: safeShop,
      scope,
      startMs,
      endMs,
      error: msg,
      details,
    });
    return { ok: false, error: msg, inserted, updated, fetched };
  }
}

/**
 * Verify-only: fetch Shopify Orders API totals without mutating orders_shopify.
 * Returns { ok, orderCount, revenueGbp, revenueByCurrency, fetched, error }.
 */
async function fetchShopifyOrdersSummary(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return { ok: false, error: 'No shop configured', orderCount: 0, revenueGbp: 0, fetched: 0, revenueByCurrency: {} };
  const token = await getAccessToken(safeShop);
  if (!token) return { ok: false, error: 'No access token for shop', orderCount: 0, revenueGbp: 0, fetched: 0, revenueByCurrency: {} };

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const firstUrl = ordersApiUrl(safeShop, startIso, endIso);

  let fetched = 0;
  let orderCount = 0;
  const revenueByCurrency = new Map(); // currency -> number
  let nextUrl = firstUrl;

  try {
    while (nextUrl) {
      const res = await shopifyFetchWithRetry(nextUrl, token, { maxRetries: 6 });
      const text = await res.text();
      if (!res.ok) {
        const err = { status: res.status, body: text ? String(text).slice(0, 500) : '' };
        throw Object.assign(new Error(`Shopify Orders API error (HTTP ${res.status})`), { details: err });
      }
      let json;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      const orders = json && Array.isArray(json.orders) ? json.orders : [];
      for (const order of orders) {
        fetched += 1;
        const row = orderToRow(safeShop, order, Date.now());
        const status = row.financial_status != null ? String(row.financial_status).trim().toLowerCase() : '';
        const reportable = (row.test == null || Number(row.test) === 0) && row.cancelled_at == null && status === 'paid';
        if (!reportable) continue;
        orderCount += 1;
        const cur = (row.currency && String(row.currency).trim()) ? String(row.currency).trim().toUpperCase() : 'GBP';
        const amt = row.total_price != null ? Number(row.total_price) : 0;
        if (Number.isFinite(amt) && amt !== 0) {
          revenueByCurrency.set(cur, (revenueByCurrency.get(cur) || 0) + amt);
        }
      }
      nextUrl = parseNextPageUrl(res.headers.get('link'));
    }

    const ratesToGbp = await fx.getRatesToGbp();
    let revenueGbp = 0;
    for (const [cur, amt] of revenueByCurrency.entries()) {
      const gbp = fx.convertToGbp(amt, cur, ratesToGbp);
      if (typeof gbp === 'number' && Number.isFinite(gbp)) revenueGbp += gbp;
    }
    revenueGbp = Math.round(revenueGbp * 100) / 100;

    return {
      ok: true,
      fetched,
      orderCount,
      revenueGbp,
      revenueByCurrency: Object.fromEntries(Array.from(revenueByCurrency.entries()).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Verify fetch failed';
    return { ok: false, error: msg, fetched, orderCount, revenueGbp: 0, revenueByCurrency: Object.fromEntries(Array.from(revenueByCurrency.entries())) };
  }
}

/**
 * On-demand (cached by callers): compute fulfillment + returns counts for a range.
 * - ordersFulfilled: count of paid orders where fulfillment_status === 'fulfilled'
 * - returns: count of orders in refunded/partially_refunded status
 *
 * These are not used for Sales truth calculations (which remain paid-only).
 */
async function fetchShopifyFulfillmentAndReturnsCounts(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return { ok: false, error: 'No shop configured', ordersFulfilled: 0, returns: 0, fetched: 0 };
  const token = await getAccessToken(safeShop);
  if (!token) return { ok: false, error: 'No access token for shop', ordersFulfilled: 0, returns: 0, fetched: 0 };

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  const fields = 'id,created_at,financial_status,cancelled_at,test,fulfillment_status';

  async function countForFinancialStatus(financialStatus, predicate) {
    let fetched = 0;
    let count = 0;
    let nextUrl = ordersApiUrlForFinancialStatus(safeShop, startIso, endIso, financialStatus, fields);
    while (nextUrl) {
      const res = await shopifyFetchWithRetry(nextUrl, token, { maxRetries: 6 });
      const text = await res.text();
      if (!res.ok) {
        const err = { status: res.status, body: text ? String(text).slice(0, 500) : '' };
        throw Object.assign(new Error(`Shopify Orders API error (HTTP ${res.status})`), { details: err });
      }
      let json;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      const orders = json && Array.isArray(json.orders) ? json.orders : [];
      for (const order of orders) {
        fetched += 1;
        const row = orderToRow(safeShop, order, Date.now());
        if (!(row.test == null || Number(row.test) === 0)) continue;
        if (row.cancelled_at != null) continue;
        if (predicate && !predicate(order, row)) continue;
        count += 1;
      }
      nextUrl = parseNextPageUrl(res.headers.get('link'));
    }
    return { fetched, count };
  }

  try {
    const fulfilled = await countForFinancialStatus('paid', (order) => {
      const s = order && order.fulfillment_status != null ? String(order.fulfillment_status).trim().toLowerCase() : '';
      return s === 'fulfilled';
    });
    const refunded = await countForFinancialStatus('refunded', () => true);
    const partially = await countForFinancialStatus('partially_refunded', () => true);
    return {
      ok: true,
      fetched: (fulfilled.fetched || 0) + (refunded.fetched || 0) + (partially.fetched || 0),
      ordersFulfilled: fulfilled.count || 0,
      returns: (refunded.count || 0) + (partially.count || 0),
    };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : 'Fetch failed';
    return { ok: false, error: msg, ordersFulfilled: 0, returns: 0, fetched: 0 };
  }
}

function safeJson(value, maxLen = 5000) {
  try {
    const s = JSON.stringify(value ?? null);
    if (typeof s === 'string' && s.length > maxLen) return s.slice(0, maxLen) + '…';
    return s;
  } catch (_) {
    return null;
  }
}

async function reconcileToday(shop, { nowMs = Date.now() } = {}) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return { ok: false, error: 'No shop configured' };
  // Europe/London boundaries are computed in store.js; callers should pass start/end.
  // Here we treat "today" as [00:00 London, now] by using ADMIN_TIMEZONE via store.getRangeBounds.
  // To avoid circular deps, the caller computes the range.
  return { ok: false, error: 'Call reconcileRange with explicit bounds (avoid cycles)' };
}

async function getTruthOrderCount(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return 0;
  const db = getDb();
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM orders_shopify
     WHERE shop = ? AND created_at >= ? AND created_at < ?
       AND (test IS NULL OR test = 0)
       AND cancelled_at IS NULL
       AND financial_status = 'paid'`,
    [safeShop, startMs, endMs]
  );
  return row ? Number(row.n) || 0 : 0;
}

/**
 * "Checkout-token" truth orders: a proxy for online-store checkout orders.
 * Many non-checkout channels (POS/manual/subscription renewals) won't have a checkout_token.
 * Useful for apples-to-apples comparisons with Shopify "sessions" and pixel checkout_completed evidence.
 */
async function getTruthCheckoutOrderCount(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return 0;
  const db = getDb();
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM orders_shopify
     WHERE shop = ? AND created_at >= ? AND created_at < ?
       AND (test IS NULL OR test = 0)
       AND cancelled_at IS NULL
       AND financial_status = 'paid'
       AND checkout_token IS NOT NULL AND TRIM(checkout_token) != ''`,
    [safeShop, startMs, endMs]
  );
  return row ? Number(row.n) || 0 : 0;
}

async function getTruthSalesRows(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return [];
  const db = getDb();
  return db.all(
    `SELECT COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, COALESCE(SUM(total_price), 0) AS total
     FROM orders_shopify
     WHERE shop = ? AND created_at >= ? AND created_at < ?
       AND (test IS NULL OR test = 0)
       AND cancelled_at IS NULL
       AND financial_status = 'paid'
     GROUP BY currency`,
    [safeShop, startMs, endMs]
  );
}

async function getTruthCheckoutSalesRows(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return [];
  const db = getDb();
  return db.all(
    `SELECT COALESCE(NULLIF(TRIM(currency), ''), 'GBP') AS currency, COALESCE(SUM(total_price), 0) AS total
     FROM orders_shopify
     WHERE shop = ? AND created_at >= ? AND created_at < ?
       AND (test IS NULL OR test = 0)
       AND cancelled_at IS NULL
       AND financial_status = 'paid'
       AND checkout_token IS NOT NULL AND TRIM(checkout_token) != ''
     GROUP BY currency`,
    [safeShop, startMs, endMs]
  );
}

async function sumRowsToGbp(rows) {
  const ratesToGbp = await fx.getRatesToGbp();
  let sum = 0;
  for (const r of rows || []) {
    const cur = fx.normalizeCurrency(r.currency) || 'GBP';
    const total = r.total != null ? Number(r.total) : 0;
    if (!Number.isFinite(total) || total === 0) continue;
    const gbp = fx.convertToGbp(total, cur, ratesToGbp);
    if (typeof gbp === 'number' && Number.isFinite(gbp)) sum += gbp;
  }
  return Math.round(sum * 100) / 100;
}

async function getTruthSalesTotalGbp(shop, startMs, endMs) {
  const rows = await getTruthSalesRows(shop, startMs, endMs);
  return sumRowsToGbp(rows);
}

async function getTruthCheckoutSalesTotalGbp(shop, startMs, endMs) {
  const rows = await getTruthCheckoutSalesRows(shop, startMs, endMs);
  return sumRowsToGbp(rows);
}

async function getTruthReturningRevenueRows(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return [];
  const db = getDb();
  // Prefer Shopify-provided customer.orders_count (stored on each order payload) when present.
  // When orders_count is missing, fall back to customer_order_facts (if available) or "prior paid order in DB".
  const sqlPreferOrdersCountWithFacts = `
    SELECT COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency, COALESCE(SUM(o.total_price), 0) AS total
    FROM orders_shopify o
    LEFT JOIN customer_order_facts f ON f.shop = o.shop AND f.customer_id = o.customer_id
    WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
      AND (o.test IS NULL OR o.test = 0)
      AND o.cancelled_at IS NULL
      AND o.financial_status = 'paid'
      AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
      AND (
        (o.customer_orders_count IS NOT NULL AND o.customer_orders_count >= 2)
        OR (
          o.customer_orders_count IS NULL AND (
            (f.first_paid_order_at IS NOT NULL AND f.first_paid_order_at < ?)
            OR EXISTS (
              SELECT 1 FROM orders_shopify p
              WHERE p.shop = o.shop AND p.customer_id = o.customer_id
                AND (p.test IS NULL OR p.test = 0)
                AND p.cancelled_at IS NULL
                AND p.financial_status = 'paid'
                AND p.created_at < ?
            )
          )
        )
      )
    GROUP BY currency
  `;

  const sqlPreferOrdersCount = `
    SELECT COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency, COALESCE(SUM(o.total_price), 0) AS total
    FROM orders_shopify o
    WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
      AND (o.test IS NULL OR o.test = 0)
      AND o.cancelled_at IS NULL
      AND o.financial_status = 'paid'
      AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
      AND (
        (o.customer_orders_count IS NOT NULL AND o.customer_orders_count >= 2)
        OR (
          o.customer_orders_count IS NULL AND EXISTS (
            SELECT 1 FROM orders_shopify p
            WHERE p.shop = o.shop AND p.customer_id = o.customer_id
              AND (p.test IS NULL OR p.test = 0)
              AND p.cancelled_at IS NULL
              AND p.financial_status = 'paid'
              AND p.created_at < ?
          )
        )
      )
    GROUP BY currency
  `;
  try {
    return await db.all(sqlPreferOrdersCountWithFacts, [safeShop, startMs, endMs, startMs, startMs]);
  } catch (_) {
    // Fall through (no customer_order_facts table, or older schema).
  }
  try {
    return await db.all(sqlPreferOrdersCount, [safeShop, startMs, endMs, startMs]);
  } catch (e) {
    // Backwards-compatible fallback (older schema without customer_orders_count).
    return db.all(
      `
      SELECT COALESCE(NULLIF(TRIM(o.currency), ''), 'GBP') AS currency, COALESCE(SUM(o.total_price), 0) AS total
      FROM orders_shopify o
      WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
        AND (o.test IS NULL OR o.test = 0)
        AND o.cancelled_at IS NULL
        AND o.financial_status = 'paid'
        AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
        AND EXISTS (
          SELECT 1 FROM orders_shopify p
          WHERE p.shop = o.shop AND p.customer_id = o.customer_id
            AND (p.test IS NULL OR p.test = 0)
            AND p.cancelled_at IS NULL
            AND p.financial_status = 'paid'
            AND p.created_at < ?
        )
      GROUP BY currency
      `,
      [safeShop, startMs, endMs, startMs]
    );
  }
}

async function getTruthReturningRevenueGbp(shop, startMs, endMs) {
  const rows = await getTruthReturningRevenueRows(shop, startMs, endMs);
  return sumRowsToGbp(rows);
}

async function getTruthReturningOrderCount(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return 0;
  const db = getDb();
  const sqlPreferOrdersCountWithFacts = `
    SELECT COUNT(*) AS n
    FROM orders_shopify o
    LEFT JOIN customer_order_facts f ON f.shop = o.shop AND f.customer_id = o.customer_id
    WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
      AND (o.test IS NULL OR o.test = 0)
      AND o.cancelled_at IS NULL
      AND o.financial_status = 'paid'
      AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
      AND (
        (o.customer_orders_count IS NOT NULL AND o.customer_orders_count >= 2)
        OR (
          o.customer_orders_count IS NULL AND (
            (f.first_paid_order_at IS NOT NULL AND f.first_paid_order_at < ?)
            OR EXISTS (
              SELECT 1 FROM orders_shopify p
              WHERE p.shop = o.shop AND p.customer_id = o.customer_id
                AND (p.test IS NULL OR p.test = 0)
                AND p.cancelled_at IS NULL
                AND p.financial_status = 'paid'
                AND p.created_at < ?
            )
          )
        )
      )
  `;
  const sqlPreferOrdersCount = `
    SELECT COUNT(*) AS n
    FROM orders_shopify o
    WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
      AND (o.test IS NULL OR o.test = 0)
      AND o.cancelled_at IS NULL
      AND o.financial_status = 'paid'
      AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
      AND (
        (o.customer_orders_count IS NOT NULL AND o.customer_orders_count >= 2)
        OR (
          o.customer_orders_count IS NULL AND EXISTS (
            SELECT 1 FROM orders_shopify p
            WHERE p.shop = o.shop AND p.customer_id = o.customer_id
              AND (p.test IS NULL OR p.test = 0)
              AND p.cancelled_at IS NULL
              AND p.financial_status = 'paid'
              AND p.created_at < ?
          )
        )
      )
  `;
  try {
    const row = await db.get(sqlPreferOrdersCountWithFacts, [safeShop, startMs, endMs, startMs, startMs]);
    return row && row.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    // Fall through (no customer_order_facts table, or older schema).
  }
  try {
    const row = await db.get(sqlPreferOrdersCount, [safeShop, startMs, endMs, startMs]);
    return row && row.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    // Backwards-compatible fallback (older schema).
    const row = await db.get(
      `
      SELECT COUNT(*) AS n
      FROM orders_shopify o
      WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
        AND (o.test IS NULL OR o.test = 0)
        AND o.cancelled_at IS NULL
        AND o.financial_status = 'paid'
        AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
        AND EXISTS (
          SELECT 1 FROM orders_shopify p
          WHERE p.shop = o.shop AND p.customer_id = o.customer_id
            AND (p.test IS NULL OR p.test = 0)
            AND p.cancelled_at IS NULL
            AND p.financial_status = 'paid'
            AND p.created_at < ?
        )
      `,
      [safeShop, startMs, endMs, startMs]
    );
    return row && row.n != null ? Number(row.n) || 0 : 0;
  }
}

async function getTruthReturningCustomerCount(shop, startMs, endMs) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return 0;
  const db = getDb();
  const sqlPreferOrdersCountWithFacts = `
    SELECT COUNT(DISTINCT o.customer_id) AS n
    FROM orders_shopify o
    LEFT JOIN customer_order_facts f ON f.shop = o.shop AND f.customer_id = o.customer_id
    WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
      AND (o.test IS NULL OR o.test = 0)
      AND o.cancelled_at IS NULL
      AND o.financial_status = 'paid'
      AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
      AND (
        (o.customer_orders_count IS NOT NULL AND o.customer_orders_count >= 2)
        OR (
          o.customer_orders_count IS NULL AND (
            (f.first_paid_order_at IS NOT NULL AND f.first_paid_order_at < ?)
            OR EXISTS (
              SELECT 1 FROM orders_shopify p
              WHERE p.shop = o.shop AND p.customer_id = o.customer_id
                AND (p.test IS NULL OR p.test = 0)
                AND p.cancelled_at IS NULL
                AND p.financial_status = 'paid'
                AND p.created_at < ?
            )
          )
        )
      )
  `;

  const sqlPreferOrdersCount = `
    SELECT COUNT(DISTINCT o.customer_id) AS n
    FROM orders_shopify o
    WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
      AND (o.test IS NULL OR o.test = 0)
      AND o.cancelled_at IS NULL
      AND o.financial_status = 'paid'
      AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
      AND (
        (o.customer_orders_count IS NOT NULL AND o.customer_orders_count >= 2)
        OR (
          o.customer_orders_count IS NULL AND EXISTS (
            SELECT 1 FROM orders_shopify p
            WHERE p.shop = o.shop AND p.customer_id = o.customer_id
              AND (p.test IS NULL OR p.test = 0)
              AND p.cancelled_at IS NULL
              AND p.financial_status = 'paid'
              AND p.created_at < ?
          )
        )
      )
  `;
  try {
    const row = await db.get(sqlPreferOrdersCountWithFacts, [safeShop, startMs, endMs, startMs, startMs]);
    return row && row.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    // Fall through (no customer_order_facts table, or older schema).
  }
  try {
    const row = await db.get(sqlPreferOrdersCount, [safeShop, startMs, endMs, startMs]);
    return row && row.n != null ? Number(row.n) || 0 : 0;
  } catch (_) {
    // Backwards-compatible fallback (older schema).
    const row = await db.get(
      `
      SELECT COUNT(DISTINCT o.customer_id) AS n
      FROM orders_shopify o
      WHERE o.shop = ? AND o.created_at >= ? AND o.created_at < ?
        AND (o.test IS NULL OR o.test = 0)
        AND o.cancelled_at IS NULL
        AND o.financial_status = 'paid'
        AND o.customer_id IS NOT NULL AND TRIM(o.customer_id) != ''
        AND EXISTS (
          SELECT 1 FROM orders_shopify p
          WHERE p.shop = o.shop AND p.customer_id = o.customer_id
            AND (p.test IS NULL OR p.test = 0)
            AND p.cancelled_at IS NULL
            AND p.financial_status = 'paid'
            AND p.created_at < ?
        )
      `,
      [safeShop, startMs, endMs, startMs]
    );
    return row && row.n != null ? Number(row.n) || 0 : 0;
  }
}

async function getTruthHealth(shop, scope = 'today') {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return { ok: false, error: 'No shop configured', shop: '' };
  const state = await getReconcileState(safeShop, scope);
  const lastSuccessAt = state?.last_success_at != null ? Number(state.last_success_at) : null;
  const lastAttemptAt = state?.last_attempt_at != null ? Number(state.last_attempt_at) : null;
  const lastError = state?.last_error != null ? String(state.last_error) : '';
  const now = Date.now();
  const staleMs = lastSuccessAt != null ? Math.max(0, now - lastSuccessAt) : null;
  return {
    ok: !!lastSuccessAt && !lastError,
    shop: safeShop,
    scope,
    lastSuccessAt,
    lastAttemptAt,
    lastError,
    staleMs,
  };
}

/**
 * Ensure orders_shopify has been reconciled for a given range.
 * - Throttled by reconcile_state(scope)
 * - Fail-open: on errors, returns ok=false but does not throw
 */
async function ensureReconciled(shop, startMs, endMs, scope) {
  const safeShop = resolveShopForSales(shop);
  if (!safeShop) return { ok: false, skipped: true, reason: 'no_shop' };
  const gate = await shouldReconcile(safeShop, scope);
  if (!gate.ok) return { ok: true, skipped: true, reason: gate.reason, state: gate.state };
  return reconcileRange(safeShop, startMs, endMs, scope);
}

module.exports = {
  resolveShopForSales,
  getAccessToken,
  ensureReconciled,
  reconcileRange,
  fetchShopifyOrdersSummary,
  fetchShopifyFulfillmentAndReturnsCounts,
  shouldReconcile,
  getTruthOrderCount,
  getTruthCheckoutOrderCount,
  getTruthSalesTotalGbp,
  getTruthCheckoutSalesTotalGbp,
  getTruthReturningRevenueGbp,
  getTruthReturningOrderCount,
  getTruthReturningCustomerCount,
  getTruthHealth,
  extractNumericId,
};

