/**
 * KEXO table column definitions — used by kexo-table-builder.js.
 * Keyed by tableId. Sticky min/max from tablesUiConfig (Layout → Tables) applied at runtime.
 */
(function () {
  'use strict';

  var PRODUCT_COLS = [
    { key: 'product', label: 'Product', sortable: false, cellClass: 'bs-product-col', iconKey: 'table-short-product' },
    { key: 'clicks', label: 'Sessions', sortable: false, iconKey: 'table-icon-sessions' },
    { key: 'orders', label: 'Orders', sortable: false, iconKey: 'table-icon-orders' },
    { key: 'cr', label: 'CR%', sortable: false, iconKey: 'table-icon-cr' },
    { key: 'rev', label: 'Rev', sortable: false, iconKey: 'table-icon-revenue' }
  ];

  window.KEXO_TABLE_DEFS = {
    'sessions-table': {
      wrapClass: 'table-scroll-wrap',
      tableClass: 'sessions-table',
      ariaLabel: 'Sessions',
      bodyId: 'table-body',
      columns: [
        { key: 'landing', label: 'Landing Page', iconKey: 'table-short-landing' },
        { key: 'from', label: 'GEO', iconKey: 'table-short-geo' },
        { key: 'source', label: 'Source', cellClass: 'source-cell', iconKey: 'table-short-source' },
        { key: 'device', label: 'Device', iconKey: 'table-short-device' },
        { key: 'cart', label: 'Cart', cellClass: 'cart-value-cell', iconKey: 'table-short-cart' },
        { key: 'arrived', label: 'Arrived', iconKey: 'table-short-arrived' },
        { key: 'last_seen', label: 'Seen', iconKey: 'table-short-seen' },
        { key: 'history', label: 'History', iconKey: 'table-short-history' },
        { key: '', label: 'Consent (debug)', sortable: false, cellClass: 'consent-col is-hidden', iconKey: 'table-short-consent' }
      ]
    },
    'best-sellers-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table best-sellers-table',
      ariaLabel: 'Best sellers',
      bodyId: 'best-sellers-body',
      columns: [
        { key: 'title', label: 'Product', cellClass: 'bs-product-col', iconKey: 'table-short-product', defaultSort: 'rev' },
        { key: 'clicks', label: 'Sessions', iconKey: 'table-icon-clicks' },
        { key: 'orders', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'best-variants-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table best-variants-table',
      ariaLabel: 'Best variants',
      bodyId: 'best-variants-body',
      columns: [
        { key: 'variant', label: 'Product', cellClass: 'bs-product-col', iconKey: 'table-short-product' },
        { key: 'clicks', label: 'Sessions', iconKey: 'table-icon-clicks' },
        { key: 'sales', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'type-necklaces-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table type-products-table',
      ariaLabel: 'Necklaces',
      bodyId: 'type-necklaces-body',
      columns: PRODUCT_COLS
    },
    'type-bracelets-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table type-products-table',
      ariaLabel: 'Bracelets',
      bodyId: 'type-bracelets-body',
      columns: PRODUCT_COLS
    },
    'type-earrings-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table type-products-table',
      ariaLabel: 'Earrings',
      bodyId: 'type-earrings-body',
      columns: PRODUCT_COLS
    },
    'type-sets-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table type-products-table',
      ariaLabel: 'Sets',
      bodyId: 'type-sets-body',
      columns: PRODUCT_COLS
    },
    'type-charms-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table type-products-table',
      ariaLabel: 'Charms',
      bodyId: 'type-charms-body',
      columns: PRODUCT_COLS
    },
    'type-extras-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table type-products-table',
      ariaLabel: 'Extras',
      bodyId: 'type-extras-body',
      columns: PRODUCT_COLS
    },
    'country-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Country',
      bodyId: 'by-country-body',
      columns: [
        { key: 'country', label: 'Country', iconKey: 'table-short-geo' },
        { key: 'clicks', label: 'Sessions', iconKey: 'table-icon-sessions' },
        { key: 'sales', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'best-geo-products-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table geo-products-table',
      ariaLabel: 'Country + Product table',
      bodyId: 'best-geo-products-body',
      columns: [
        { key: 'country', label: 'Country + Product', iconKey: 'table-short-country-product' },
        { key: 'clicks', label: 'Sessions', iconKey: 'table-icon-sessions' },
        { key: 'sales', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'traffic-sources-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Traffic sources',
      bodyId: 'traffic-sources-body',
      emptyMessage: 'Open Settings (footer) → Traffic to choose channels.',
      columns: [
        { key: 'source', label: 'Source', iconKey: 'table-short-source' },
        { key: 'sessions', label: 'Sessions', iconKey: 'table-icon-sessions' },
        { key: 'orders', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'traffic-types-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Traffic types',
      bodyId: 'traffic-types-body',
      emptyMessage: 'Open Settings (footer) → Traffic to choose device types.',
      columns: [
        { key: 'type', label: 'Type', iconKey: 'table-short-type' },
        { key: 'sessions', label: 'Sessions', iconKey: 'table-icon-sessions' },
        { key: 'orders', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'variants-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table best-variants-table',
      columns: [
        { key: 'variant', label: 'Variant', cellClass: 'bs-product-col', iconKey: 'table-icon-variants-variant' },
        { key: 'sessions', label: 'Sessions', iconKey: 'table-icon-variants-sessions' },
        { key: 'orders', label: 'Orders', iconKey: 'table-icon-variants-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-variants-cr' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-variants-revenue', defaultSort: 'rev' }
      ]
    },
    'tsm-sources-grid': {
      wrapClass: '',
      tableClass: 'tsm-table tsm-sources-grid',
      ariaLabel: 'Mapped sources',
      columns: [
        { key: '', label: 'Source', sortable: false },
        { key: '', label: 'Key', sortable: false },
        { key: '', label: 'Icon URL', sortable: false },
        { key: '', label: '', sortable: false }
      ]
    },
    'tsm-tokens-grid': {
      wrapClass: '',
      tableClass: 'tsm-table tsm-tokens-grid',
      ariaLabel: 'Tokens',
      columns: [
        { key: '', label: 'Token', sortable: false },
        { key: '', label: 'Seen', sortable: false },
        { key: '', label: 'Map / existing', sortable: false }
      ]
    },
    'ads-campaigns-table': {
      wrapClass: '',
      tableClass: 'ads-campaign-table',
      ariaLabel: 'Ads campaigns',
      bodyId: 'ads-campaigns-body',
      columns: [
        { key: 'campaign', label: 'Campaign', cellClass: '' },
        { key: 'spend', label: 'Spend', cellClass: ' text-end' },
        { key: 'impr', label: 'Impr', cellClass: ' text-end' },
        { key: 'clicks', label: 'Clicks', cellClass: ' text-end' },
        { key: 'conv', label: 'Conv', cellClass: ' text-end' },
        { key: 'profit', label: 'Profit', cellClass: ' text-end' },
        { key: 'roas', label: 'ROAS', cellClass: ' text-end' },
        { key: 'sales', label: 'Sales', cellClass: ' text-end' }
      ]
    }
  };

  window.KEXO_NATIVE_TABLE_DEFS = {
    'dash-top-products': {
      tableId: 'dash-top-products',
      columns: [
        { header: 'Product', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' }
      ]
    },
    'dash-top-countries': {
      tableId: 'dash-top-countries',
      columns: [
        { header: 'Country', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' }
      ]
    },
    'dash-trending-up': {
      tableId: 'dash-trending-up',
      columns: [
        { header: 'Product', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' }
      ]
    },
    'dash-trending-down': {
      tableId: 'dash-trending-down',
      columns: [
        { header: 'Product', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' }
      ]
    },
    'latest-sales-table': {
      tableId: 'latest-sales-table',
      columns: [
        { header: '', headerClass: 'w-1' },
        { header: 'Product', headerClass: '' },
        { header: 'Ago', headerClass: 'text-end w-1' },
        { header: 'Value', headerClass: 'text-end w-1' }
      ]
    }
  };
})();
