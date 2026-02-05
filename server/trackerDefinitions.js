/**
 * Tracker table/metric definitions for the diagnostics modal.
 *
 * Goal: keep reporting consistent and auditable. When adding/changing a dashboard table or metric,
 * update this manifest so /api/config-status can surface what each UI element is using.
 */
const DEFINITIONS_VERSION = 1;
const LAST_UPDATED = '2026-02-05';

/**
 * NOTE: Keep this as data (not executable logic) so it remains easy to review.
 * `config-status` will attach runtime checks (DB tables present, token stored, etc).
 */
const TRACKER_TABLE_DEFINITIONS = [
  {
    id: 'home_sessions_table',
    page: 'Home',
    name: 'Sessions table (live / paginated)',
    ui: { elementIds: ['sessions-table'] },
    endpoint: {
      method: 'GET',
      path: '/api/sessions',
      params: [
        'filter=active|today|recent|abandoned|converted|all',
        'range=today|yesterday|3d|7d|1h|d:YYYY-MM-DD|r:YYYY-MM-DD:YYYY-MM-DD',
        'timezone/timeZone',
        'limit, offset',
      ],
    },
    sources: [
      { kind: 'db', tables: ['sessions', 'visitors'], note: 'Sessions list + returning flags' },
      { kind: 'db', tables: ['events'], note: 'Used for session history + side panel' },
      { kind: 'pixel', note: 'Populates sessions/events via /api/ingest' },
    ],
    columns: [
      { name: 'Landing Page', value: 'sessions.first_path / sessions.first_product_handle (set on first event)' },
      { name: 'GEO', value: 'sessions.country_code (or visitors.last_country fallback in API)' },
      { name: 'Source', value: 'sessions.traffic_source_key (mapped from UTMs/referrer rules)' },
      { name: 'Device', value: 'sessions.ua_device_type + ua_platform (derived from ingest User-Agent)' },
      { name: 'Cart', value: 'sessions.cart_qty + sessions.cart_value (from pixel cart events)' },
      { name: 'Arrived', value: 'sessions.started_at' },
      { name: 'Seen', value: 'sessions.last_seen' },
      { name: 'History', value: 'events(type/path/product_handle/qty_delta/checkout_state_json)' },
    ],
    math: [],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions', 'visitors', 'events'], shopifyToken: false },
  },
  {
    id: 'kpi_grid',
    page: 'Home',
    name: 'Top KPI grid',
    ui: { elementIds: ['kpi-grid'] },
    endpoint: { method: 'GET', path: '/api/kpis', params: ['range=...', 'force=1 (optional)'] },
    sources: [
      { kind: 'db', tables: ['sessions', 'purchases'], note: 'Sessions + pixel-derived purchases when ordersSource=pixel' },
      { kind: 'db', tables: ['orders_shopify', 'reconcile_state'], note: 'Shopify truth cache when ordersSource=orders_shopify' },
      { kind: 'db', tables: ['shopify_sessions_snapshots'], note: 'Optional denominator when sessionsSource=shopify_sessions' },
      { kind: 'shopify', note: 'Orders API sync (throttled) when ordersSource=orders_shopify' },
    ],
    columns: [
      { name: 'Revenue', value: 'sales[range] (GBP)', formula: 'ordersSource=pixel → SUM(purchases.order_total); else → SUM(orders_shopify.total_price)' },
      { name: 'Conversion', value: 'conversion[range] (%)', formula: 'convertedCount / sessionsCount × 100' },
      { name: 'AOV', value: 'aov[range] (GBP)', formula: 'Revenue / convertedCount' },
      { name: 'Sessions', value: 'trafficBreakdown[range].human_sessions', formula: 'sessionsSource=sessions → COUNT(sessions.started_at); sessionsSource=shopify_sessions → ShopifyQL snapshot count (day-like ranges only)' },
      { name: 'Bounce', value: 'bounce[range] (%)', formula: 'single-page sessions / sessions × 100 (human-only)' },
    ],
    math: [
      { name: 'Traffic mode', value: 'human_only (exclude cf_known_bot=1)' },
      { name: 'Time basis', value: 'range bounds are admin timezone day/range (see getRangeBounds)' },
    ],
    respectsReporting: { ordersSource: true, sessionsSource: true },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'breakdown_country',
    page: 'Breakdown',
    name: 'Country table',
    ui: { elementIds: ['country-table'] },
    endpoint: { method: 'GET', path: '/api/stats', params: ['range=... (same picker as dashboard)'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Denominator sessions by country (started_at in range, human-only)' },
      { kind: 'db', tables: ['purchases'], note: 'ordersSource=pixel: numerator/revenue by purchase.country_code' },
      { kind: 'db', tables: ['purchase_events', 'orders_shopify'], note: 'ordersSource=orders_shopify: numerator/revenue via evidence-linked truth orders' },
      { kind: 'fx', note: 'Revenue converted to GBP (fx.getRatesToGbp)' },
    ],
    columns: [
      { name: 'Country', value: 'sessions.country_code (2-letter ISO; excludes XX)' },
      { name: 'CR', value: 'converted / total', formula: 'Orders / Sessions' },
      { name: 'Orders', value: 'converted', formula: 'ordersSource=pixel → deduped purchases; else → DISTINCT orders_shopify.order_id linked via purchase_events' },
      { name: 'Sessions', value: 'total', formula: 'COUNT(sessions) started_at in range, human-only' },
      { name: 'Rev', value: 'revenue (GBP)', formula: 'SUM(order_total) converted to GBP' },
    ],
    math: [
      { name: 'Deduping (pixel)', value: 'Exclude duplicate h: rows when token/order rows exist (purchaseFilterExcludeDuplicateH)' },
      { name: 'Attribution (truth)', value: 'Only orders with linked purchase_events are attributable (coverage can be < 100%)' },
    ],
    respectsReporting: { ordersSource: true, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'breakdown_best_geo_products',
    page: 'Breakdown',
    name: 'Best by GEO table',
    ui: { elementIds: ['best-geo-products-table'] },
    endpoint: { method: 'GET', path: '/api/stats', params: ['range=...'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Country sessions (started_at in range, human-only)' },
      { kind: 'db', tables: ['purchase_events', 'orders_shopify_line_items'], note: 'Truth attribution via linked evidence; product revenue from line items' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Country', value: 'sessions.country_code' },
      { name: 'CR', value: 'converted / total', formula: 'Product orders / country sessions' },
      { name: 'Orders', value: 'converted', formula: 'COUNT(DISTINCT order_id) containing the product (truth, linked evidence only)' },
      { name: 'Sessions', value: 'total', formula: 'COUNT(sessions) started_at in range for that country (human-only)' },
      { name: 'Rev', value: 'revenue (GBP)', formula: 'SUM(line_revenue) converted to GBP' },
    ],
    math: [
      { name: 'Important', value: 'This is NOT “product landing conversion”. It’s orders for the product per country session (truth attribution).' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions', 'purchase_events', 'orders_shopify_line_items'], shopifyToken: true },
  },
  {
    id: 'products_best_sellers',
    page: 'Products',
    name: 'Best sellers table',
    ui: { elementIds: ['best-sellers-table'] },
    endpoint: { method: 'GET', path: '/api/shopify-best-sellers', params: ['shop=...', 'range=...', 'page/pageSize/sort/dir'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify', 'orders_shopify_line_items'], note: 'Truth orders + line item revenue (paid only)' },
      { kind: 'db', tables: ['sessions'], note: 'Landings = sessions that started on the product handle (human-only)' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
    ],
    columns: [
      { name: 'Sales', value: 'orders', formula: 'COUNT(DISTINCT order_id) containing this product (paid orders)' },
      { name: 'Landings', value: 'clicks', formula: 'COUNT(sessions) where first_product_handle = product.handle (human-only)' },
      { name: 'Rev', value: 'revenue', formula: 'SUM(line_revenue) (native currency in DB; rendered as GBP in endpoint)' },
      { name: 'Order share%', value: 'cr', formula: 'orders / totalOrders × 100' },
    ],
    math: [
      { name: 'Important', value: 'Order share% is not conversion. It’s share of all paid orders in range.' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify', 'orders_shopify_line_items', 'sessions'], shopifyToken: true },
  },
  {
    id: 'products_worst_products',
    page: 'Products',
    name: 'Worst products table',
    ui: { elementIds: ['worst-products-table'] },
    endpoint: { method: 'GET', path: '/api/worst-products', params: ['range=...', 'page/pageSize'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Landings: sessions that started on /products/... (human-only)' },
      { kind: 'db', tables: ['purchases'], note: 'ordersSource=pixel: purchases joined to sessions' },
      { kind: 'db', tables: ['purchase_events', 'orders_shopify_line_items'], note: 'ordersSource=orders_shopify: evidence-linked truth revenue per session/order' },
      { kind: 'fx', note: 'Revenue converted to GBP for display' },
    ],
    columns: [
      { name: 'Landings', value: 'clicks', formula: 'COUNT(product-landing sessions)' },
      { name: 'Sales', value: 'converted', formula: 'COUNT(orders attributed to those sessions)' },
      { name: 'Rev', value: 'revenue', formula: 'Attributed revenue (GBP)' },
      { name: 'CR%', value: 'conversion', formula: 'converted / clicks × 100' },
    ],
    math: [
      { name: 'Minimum traffic', value: 'Only includes products with >= 3 landings (MIN_CLICKS)' },
    ],
    respectsReporting: { ordersSource: true, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'products_best_variants',
    page: 'Products',
    name: 'Best variants table',
    ui: { elementIds: ['best-variants-table'] },
    endpoint: { method: 'GET', path: '/api/shopify-best-variants', params: ['shop=...', 'range=...', 'page/pageSize'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify', 'orders_shopify_line_items'], note: 'Truth orders + variant line item revenue' },
      { kind: 'db', tables: ['sessions'], note: 'Landings: sessions that started on the product handle (human-only)' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
    ],
    columns: [
      { name: 'Sales', value: 'orders', formula: 'COUNT(DISTINCT order_id) containing this variant' },
      { name: 'Landings', value: 'clicks', formula: 'COUNT(sessions) where first_product_handle = product.handle (human-only)' },
      { name: 'Rev', value: 'revenue', formula: 'SUM(line_revenue) for the variant' },
      { name: 'Order share%', value: '(UI)', formula: 'orders / totalOrders × 100' },
    ],
    math: [
      { name: 'Important', value: 'Order share% is not conversion. It’s share of all paid orders in range.' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify', 'orders_shopify_line_items', 'sessions'], shopifyToken: true },
  },
  {
    id: 'products_worst_variants',
    page: 'Products',
    name: 'Worst variants table',
    ui: { elementIds: ['worst-variants-table'] },
    endpoint: { method: 'GET', path: '/api/shopify-worst-variants', params: ['shop=...', 'range=...', 'page/pageSize'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify', 'orders_shopify_line_items'], note: 'Truth orders + variant line item revenue' },
      { kind: 'db', tables: ['sessions'], note: 'Landings: sessions that started on the product handle (human-only)' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
    ],
    columns: [
      { name: 'Sales', value: 'orders', formula: 'COUNT(DISTINCT order_id) containing this variant' },
      { name: 'Landings', value: 'clicks', formula: 'COUNT(sessions) where first_product_handle = product.handle (human-only)' },
      { name: 'Rev', value: 'revenue', formula: 'SUM(line_revenue) for the variant' },
      { name: 'Order share%', value: '(UI)', formula: 'orders / totalOrders × 100' },
    ],
    math: [
      { name: 'Important', value: 'Order share% is not conversion. It’s share of all paid orders in range.' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify', 'orders_shopify_line_items', 'sessions'], shopifyToken: true },
  },
  {
    id: 'traffic_channels',
    page: 'Traffic',
    name: 'Channels table',
    ui: { elementIds: ['traffic-sources-table'] },
    endpoint: { method: 'GET', path: '/api/traffic', params: ['range=...'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Sessions grouped by sessions.traffic_source_key (human-only)' },
      { kind: 'db', tables: ['purchases'], note: 'ordersSource=pixel: purchases joined to sessions for attribution' },
      { kind: 'db', tables: ['purchase_events', 'orders_shopify'], note: 'ordersSource=orders_shopify: evidence-linked truth orders attributed to sessions' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Sessions', value: 'COUNT(sessions) started_at in range (human-only)' },
      { name: 'Orders', value: 'orders', formula: 'Attributed orders in range' },
      { name: 'Rev', value: 'revenueGbp', formula: 'Attributed revenue in GBP' },
      { name: 'CR%', value: 'orders / sessions × 100' },
    ],
    math: [
      { name: 'Attribution', value: 'Truth mode requires linked evidence; unmapped sources or missing evidence reduce coverage.' },
    ],
    respectsReporting: { ordersSource: true, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'traffic_types',
    page: 'Traffic',
    name: 'Traffic type table (device → platform)',
    ui: { elementIds: ['traffic-types-table'] },
    endpoint: { method: 'GET', path: '/api/traffic', params: ['range=...'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Sessions grouped by ua_device_type + ua_platform (human-only)' },
      { kind: 'db', tables: ['purchases'], note: 'ordersSource=pixel: purchases joined to sessions' },
      { kind: 'db', tables: ['purchase_events', 'orders_shopify'], note: 'ordersSource=orders_shopify: evidence-linked truth orders attributed to sessions' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Sessions', value: 'COUNT(sessions) started_at in range (human-only)' },
      { name: 'Orders', value: 'orders', formula: 'Attributed orders in range' },
      { name: 'Rev', value: 'revenueGbp', formula: 'Attributed revenue in GBP' },
      { name: 'CR%', value: 'orders / sessions × 100' },
    ],
    math: [],
    respectsReporting: { ordersSource: true, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'diagnostics_modal',
    page: 'Diagnostics',
    name: 'Diagnostics modal (comparison + technical details + definitions)',
    ui: { elementIds: ['config-modal'] },
    endpoint: { method: 'GET', path: '/api/config-status', params: ['shop=... (optional)'] },
    sources: [
      { kind: 'db', tables: ['settings', 'shop_sessions', 'sessions', 'purchase_events', 'purchases', 'orders_shopify'], note: 'Health + drift + reporting config' },
      { kind: 'shopify', note: 'ShopifyQL sessions + Web Pixel settings (when token stored)' },
    ],
    columns: [],
    math: [
      { name: 'Shopify Sessions (today)', value: 'ShopifyQL: FROM sessions SHOW sessions DURING today' },
      { name: 'Birdseye Sessions (today)', value: 'sessions started today (human sessions if cf_known_bot tagging exists)' },
      { name: 'Truth Orders/Revenue', value: 'orders_shopify paid orders (all channels)' },
      { name: 'Checkout-token Orders/Revenue', value: 'orders_shopify paid orders where checkout_token is set (online-store proxy)' },
      { name: 'Pixel Orders/Revenue', value: 'purchases table (deduped) from checkout_completed evidence' },
      { name: 'Evidence (checkout_completed)', value: 'purchase_events rows (append-only) + link coverage to truth' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['settings'], shopifyToken: false },
  },
];

module.exports = {
  DEFINITIONS_VERSION,
  LAST_UPDATED,
  TRACKER_TABLE_DEFINITIONS,
};

