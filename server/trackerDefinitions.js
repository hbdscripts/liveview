/**
 * Tracker table/metric definitions for the diagnostics modal.
 *
 * Goal: keep reporting consistent and auditable. When adding/changing a dashboard table or metric,
 * update this manifest so /api/config-status can surface what each UI element is using.
 */
const DEFINITIONS_VERSION = 14;
const LAST_UPDATED = '2026-02-07';

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
    ui: { elementIds: ['live-kpi-grid'] },
    endpoint: { method: 'GET', path: '/api/kpis', params: ['range=...', 'force=1 (optional)'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Sessions (human-only filtering in queries)' },
      { kind: 'db', tables: ['orders_shopify', 'reconcile_state'], note: 'Shopify truth cache (paid orders). Pixel purchases are debug-only.' },
      { kind: 'db', tables: ['shopify_sessions_snapshots'], note: 'Optional denominator when sessionsSource=shopify_sessions' },
      { kind: 'shopify', note: 'Orders API sync (throttled) to keep truth current' },
    ],
    columns: [
      { name: 'Revenue', value: 'sales[range] (GBP)', formula: 'SUM(orders_shopify.total_price) converted to GBP (truth; never exceeds Shopify)' },
      { name: 'Conversion', value: 'conversion[range] (%)', formula: 'convertedCount / sessionsCount × 100 (Orders / Sessions)' },
      { name: 'AOV', value: 'aov[range] (GBP)', formula: 'Revenue / convertedCount' },
      { name: 'Sessions', value: 'trafficBreakdown[range].human_sessions', formula: 'sessionsSource=sessions → COUNT(sessions.started_at); sessionsSource=shopify_sessions → ShopifyQL snapshot count (day-like ranges only)' },
      { name: 'Bounce', value: 'bounce[range] (%)', formula: 'single-page sessions / sessions × 100 (human-only)' },
    ],
    math: [
      { name: 'Traffic mode', value: 'human_only (exclude cf_known_bot=1)' },
      { name: 'Time basis', value: 'range bounds are admin timezone day/range (see getRangeBounds)' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: true },
    requiresByReporting: {
      sessionsSource: {
        shopify_sessions: ['shopify_sessions_snapshots'],
      },
    },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'breakdown_country',
    page: 'Countries',
    name: 'Country table',
    ui: { elementIds: ['country-table'] },
    endpoint: { method: 'GET', path: '/api/stats', params: ['range=... (same picker as dashboard)'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Denominator sessions by country (started_at in range, human-only)' },
      { kind: 'db', tables: ['orders_shopify'], note: 'Numerator/revenue from Shopify truth orders, grouped by order country (shipping/billing) parsed from orders_shopify.raw_json' },
      { kind: 'fx', note: 'Revenue converted to GBP (fx.getRatesToGbp)' },
    ],
    columns: [
      { name: 'Country', value: 'sessions.country_code (2-letter ISO; excludes XX)' },
      { name: 'CR', value: 'converted / total', formula: 'Orders / Sessions' },
      { name: 'Orders', value: 'converted', formula: 'COUNT(DISTINCT orders_shopify.order_id) for paid orders in range, grouped by order country' },
      { name: 'Sessions', value: 'total', formula: 'COUNT(sessions) started_at in range, human-only' },
      { name: 'Rev', value: 'revenue (GBP)', formula: 'SUM(order_total) converted to GBP' },
    ],
    math: [
      { name: 'Order country', value: 'Use Shopify order shipping_address.country_code (fallback billing_address.country_code) from orders_shopify.raw_json' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'overview_breakdown_products_table',
    page: 'Overview',
    name: 'Product breakdown table (Title)',
    ui: { elementIds: ['breakdown-product-table', 'breakdown-title-body'] },
    endpoint: { method: 'GET', path: '/api/shopify-leaderboard', params: ['shop=...', 'range=...', 'topProducts/topTypes (optional)', 'force=1 (optional)'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify_line_items'], note: 'Paid line item revenue grouped by product_id (truth line items; rolling 7d in admin TZ)' },
      { kind: 'db', tables: ['reconcile_state', 'reconcile_snapshots'], note: 'Best-effort reconciliation state (route calls salesTruth.ensureReconciled for 7d)' },
      { kind: 'shopify', note: 'Product metadata for product image + product_type (REST /products/{id}.json) when token stored' },
      { kind: 'fx', note: 'Revenue converted to GBP (fx.getRatesToGbp)' },
    ],
    columns: [
      { name: 'Product', value: 'byTitle[]', formula: 'Top products by SUM(line_revenue) over rolling 7d (converted to GBP)' },
      { name: 'Rev', value: 'revenueGbp' },
      { name: 'CR%', value: 'cr' },
    ],
    math: [
      { name: 'Range', value: 'Rolling 7d (startOfDay -6d → now) in admin time zone' },
      { name: 'Truth basis', value: 'Paid, non-test, non-cancelled orders from orders_shopify_line_items' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify_line_items'], shopifyToken: false },
  },
  {
    id: 'overview_breakdown_types_table',
    page: 'Overview',
    name: 'Type breakdown table',
    ui: { elementIds: ['breakdown-type-table', 'breakdown-type-body'] },
    endpoint: { method: 'GET', path: '/api/shopify-leaderboard', params: ['shop=...', 'range=...', 'topProducts/topTypes (optional)', 'force=1 (optional)'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify_line_items'], note: 'Paid line item revenue grouped by product_type via Shopify product metadata' },
      { kind: 'db', tables: ['reconcile_state', 'reconcile_snapshots'], note: 'Best-effort reconciliation state (route calls salesTruth.ensureReconciled for 7d)' },
      { kind: 'shopify', note: 'Product metadata for product_type (REST /products/{id}.json) when token stored' },
      { kind: 'fx', note: 'Revenue converted to GBP (fx.getRatesToGbp)' },
    ],
    columns: [
      { name: 'Type', value: 'byType[]' },
      { name: 'Rev', value: 'revenueGbp' },
      { name: 'CR%', value: 'cr' },
    ],
    math: [
      { name: 'Range', value: 'Rolling 7d (startOfDay -6d → now) in admin time zone' },
      { name: 'Truth basis', value: 'Paid, non-test, non-cancelled orders from orders_shopify_line_items' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify_line_items'], shopifyToken: false },
  },
  {
    id: 'overview_breakdown_finishes_table',
    page: 'Overview',
    name: 'Finish breakdown table',
    ui: { elementIds: ['breakdown-finish-table', 'breakdown-finish-body'] },
    endpoint: { method: 'GET', path: '/api/shopify-finishes', params: ['shop=...', 'range=...', 'force=1 (optional)'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify_line_items'], note: 'Paid line item revenue grouped by inferred finish from variant_title' },
      { kind: 'db', tables: ['reconcile_state', 'reconcile_snapshots'], note: 'Best-effort reconciliation state (route calls salesTruth.ensureReconciled)' },
      { kind: 'shopify', note: 'Used to reconcile truth data when token stored (best results). Without token, table relies on existing DB truth.' },
      { kind: 'fx', note: 'Revenue converted to GBP (fx.getRatesToGbp)' },
    ],
    columns: [
      { name: 'Finish', value: 'Gold | Silver | Vermeil | Solid Silver' },
      { name: 'Rev', value: 'revenueGbp' },
      { name: 'CR%', value: 'cr' },
    ],
    math: [
      { name: 'Finish inference', value: 'Derived from variant_title keywords (normalizeFinishKey in shopifyFinishes route)' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify_line_items'], shopifyToken: false },
  },
  {
    id: 'overview_breakdown_lengths_table',
    page: 'Overview',
    name: 'Length breakdown table',
    ui: { elementIds: ['breakdown-length-table', 'breakdown-length-body'] },
    endpoint: { method: 'GET', path: '/api/shopify-lengths', params: ['shop=...', 'range=...', 'force=1 (optional)'] },
    sources: [
      { kind: 'db', tables: ['orders_shopify_line_items'], note: 'Paid line item revenue grouped by inferred length (inches) from variant_title' },
      { kind: 'db', tables: ['reconcile_state', 'reconcile_snapshots'], note: 'Best-effort reconciliation state (route calls salesTruth.ensureReconciled)' },
      { kind: 'shopify', note: 'Used to reconcile truth data when token stored (best results). Without token, table relies on existing DB truth.' },
      { kind: 'fx', note: 'Revenue converted to GBP (fx.getRatesToGbp)' },
    ],
    columns: [
      { name: 'Length', value: '12" | 13" | … | 21"' },
      { name: 'Rev', value: 'revenueGbp' },
      { name: 'CR%', value: 'cr' },
    ],
    math: [
      { name: 'Length inference', value: 'Derived from variant_title (e.g. 15" Inches) using normalizeLengthInches in shopifyLengths route' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['orders_shopify_line_items'], shopifyToken: false },
  },
  {
    id: 'breakdown_aov_cards',
    page: 'Overview',
    name: 'Average Order Value (AOV) table (by country)',
    ui: { elementIds: ['breakdown-aov-table', 'breakdown-aov-body'] },
    endpoint: { method: 'GET', path: '/api/stats', params: ['range=... (same picker as dashboard)'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Country sessions (human-only) + attributed orders for that country' },
      { kind: 'db', tables: ['purchases'], note: 'ordersSource=pixel: revenue/orders derived from purchases table (deduped)' },
      { kind: 'db', tables: ['purchase_events', 'orders_shopify'], note: 'ordersSource=orders_shopify: revenue/orders via evidence-linked truth orders' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Country (left)', value: 'Flag + country name (left-aligned)' },
      { name: 'AOV (middle)', value: 'aov (GBP)', formula: 'Revenue / Orders, shown in center column' },
      { name: 'Revenue (right)', value: 'revenue (GBP)', formula: 'SUM(order_total) converted to GBP, shown in right column' },
    ],
    math: [
      { name: 'Layout', value: '3-column card: Flag+Country | AOV | Revenue. Sorted by revenue desc. Mobile: swipe pages of 5.' },
      { name: 'Important', value: 'This is derived from the same country rows as the Country table (uses the country.aov and country.revenue fields returned by /api/stats).' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'breakdown_best_geo_products',
    page: 'Countries',
    name: 'Best by GEO table',
    ui: { elementIds: ['best-geo-products-table'] },
    endpoint: { method: 'GET', path: '/api/stats', params: ['range=...'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Country sessions (started_at in range, human-only)' },
      { kind: 'db', tables: ['orders_shopify', 'orders_shopify_line_items'], note: 'Truth orders by order country (shipping/billing from orders_shopify.raw_json) + product revenue from line items' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Country', value: 'sessions.country_code' },
      { name: 'CR', value: 'converted / total', formula: 'Product orders / country sessions' },
      { name: 'Orders', value: 'converted', formula: 'COUNT(DISTINCT order_id) containing the product (truth line items)' },
      { name: 'Sessions', value: 'total', formula: 'COUNT(sessions) started_at in range for that country (human-only)' },
      { name: 'Rev', value: 'revenue (GBP)', formula: 'SUM(line_revenue) converted to GBP' },
    ],
    math: [
      { name: 'Important', value: 'This is NOT “product landing conversion”. It’s orders containing the product per country session.' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions', 'orders_shopify', 'orders_shopify_line_items'], shopifyToken: true },
  },
  {
    id: 'products_best_sellers',
    page: 'Products',
    name: 'Best sellers table',
    ui: { elementIds: ['best-sellers-table'] },
    endpoint: { method: 'GET', path: '/api/shopify-best-sellers', params: ['shop=...', 'range=...', 'page/pageSize'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Product landing sessions (first_path/entry_url → handle, fallback first_product_handle; human-only)' },
      { kind: 'db', tables: ['orders_shopify_line_items'], note: 'Shopify truth product orders/revenue from line items (paid only)' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
    ],
    columns: [
      { name: 'Orders', value: 'orders', formula: 'COUNT(DISTINCT order_id) containing the product (truth line items)' },
      { name: 'Sessions', value: 'clicks', formula: 'COUNT(sessions) that landed on this product (human-only)' },
      { name: 'Rev', value: 'revenue', formula: 'SUM(line_revenue) for the product (truth)' },
      { name: 'CR%', value: 'cr', formula: 'orders / sessions × 100' },
    ],
    math: [
      { name: 'Note', value: 'Orders/Rev are Shopify truth (product line items). Sessions are product landings from our sessions table.' },
      { name: 'Sort', value: 'Ordered by revenue (desc) then orders.' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions', 'orders_shopify_line_items'], shopifyToken: true },
  },
  {
    id: 'products_best_variants',
    page: 'Products',
    name: 'Best variants table',
    ui: { elementIds: ['best-variants-table'] },
    endpoint: { method: 'GET', path: '/api/shopify-best-variants', params: ['shop=...', 'range=...', 'page/pageSize'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Product landing sessions for the parent product handle (first_path/entry_url → handle, fallback first_product_handle; human-only)' },
      { kind: 'db', tables: ['orders_shopify_line_items'], note: 'Shopify truth variant orders/revenue from line items (paid only)' },
      { kind: 'shopify', note: 'Product meta (handle + thumb) via cached Products API' },
    ],
    columns: [
      { name: 'Orders', value: 'orders', formula: 'COUNT(DISTINCT order_id) containing this variant (truth line items)' },
      { name: 'Sessions', value: 'clicks', formula: 'COUNT(product landing sessions for the parent product)' },
      { name: 'Rev', value: 'revenue', formula: 'SUM(line_revenue) for this variant (truth)' },
      { name: 'CR%', value: 'cr', formula: 'orders / sessions × 100' },
    ],
    math: [
      { name: 'Note', value: 'Sessions is per parent product (variants of the same product share the same Sessions denominator).' },
      { name: 'Sort', value: 'Ordered by revenue (desc) then orders.' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions', 'orders_shopify_line_items'], shopifyToken: true },
  },
  {
    id: 'traffic_channels',
    page: 'Traffic',
    name: 'Channels table',
    ui: { elementIds: ['traffic-sources-table'] },
    endpoint: { method: 'GET', path: '/api/traffic', params: ['range=...'] },
    sources: [
      { kind: 'db', tables: ['sessions'], note: 'Sessions grouped by sessions.traffic_source_key (human-only)' },
      { kind: 'db', tables: ['orders_shopify', 'settings', 'traffic_source_meta', 'traffic_source_rules'], note: 'Orders/revenue from Shopify truth orders. Source is derived from orders_shopify.raw_json (landing_site/referring_site) + mapping rules. Enabled channels come from settings.traffic_sources_enabled; labels/icons can be overridden via traffic_source_meta.' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Sessions', value: 'COUNT(sessions) started_at in range (human-only)' },
      { name: 'Orders', value: 'orders', formula: 'COUNT(truth orders) in range for that derived source' },
      { name: 'Rev', value: 'revenueGbp', formula: 'Truth revenue in GBP' },
      { name: 'CR%', value: 'orders / sessions × 100' },
    ],
    math: [
      { name: 'Note', value: 'Orders/Rev are Shopify truth. Sessions come from our sessions table; CR% = Orders / Sessions.' },
      { name: 'Settings', value: 'Visible channels are controlled by settings.traffic_sources_enabled (Settings → Traffic).' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
    requires: { dbTables: ['sessions'], shopifyToken: false },
  },
  {
    id: 'traffic_types',
    page: 'Traffic',
    name: 'Traffic type table (device → platform)',
    ui: { elementIds: ['traffic-types-table'] },
    endpoint: { method: 'GET', path: '/api/traffic', params: ['range=...'] },
    sources: [
      { kind: 'db', tables: ['sessions', 'settings'], note: 'Sessions grouped by ua_device_type + ua_platform (human-only). Enabled device keys come from settings.traffic_types_enabled.' },
      { kind: 'db', tables: ['orders_shopify'], note: 'Orders/revenue from Shopify truth orders, with device/platform derived from orders_shopify.raw_json client_details.user_agent' },
      { kind: 'fx', note: 'Revenue converted to GBP' },
    ],
    columns: [
      { name: 'Sessions', value: 'COUNT(sessions) started_at in range (human-only)' },
      { name: 'Orders', value: 'orders', formula: 'COUNT(truth orders) in range for that device/platform bucket' },
      { name: 'Rev', value: 'revenueGbp', formula: 'Truth revenue in GBP' },
      { name: 'CR%', value: 'orders / sessions × 100' },
    ],
    math: [
      { name: 'Settings', value: 'Visible device types are controlled by settings.traffic_types_enabled (Settings → Traffic).' },
    ],
    respectsReporting: { ordersSource: false, sessionsSource: false },
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
      { name: 'Evidence sessions (today)', value: "purchase_events: COUNT(DISTINCT session_id) where event_type IN ('checkout_completed','checkout_started') (debug only; can be < truth)" },
      { name: 'Shopify CR% (today)', value: 'ShopifyQL conversion_rate (sessions table; matches Shopify Admin)' },
      { name: 'Birdseye CR% (today)', value: 'Truth Orders / Human Sessions × 100 (Birdseye-only comparison)' },
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

