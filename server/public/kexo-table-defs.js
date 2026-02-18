/**
 * KEXO table column definitions — used by kexo-table-builder.js.
 * Keyed by tableId. Sticky min/max from tablesUiConfig (Layout → Tables) applied at runtime.
 */
(function () {
  'use strict';

  var PRODUCT_COLS = [
    { key: 'product', label: 'Product', sortable: false, cellClass: 'bs-product-col', iconKey: 'table-short-product' },
    { key: 'clicks', label: 'Sessions', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-sessions' },
    { key: 'orders', label: 'Orders', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-orders' },
    { key: 'cr', label: 'CR%', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-cr' },
    { key: 'vpv', label: 'VPV', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-vpv' },
    { key: 'rev', label: 'Rev', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-revenue' }
  ];

  window.KEXO_TABLE_DEFS = {
    'sessions-table': {
      wrapClass: 'table-scroll-wrap',
      tableClass: 'sessions-table',
      ariaLabel: 'Sessions',
      bodyId: 'table-body',
      columns: [
        { key: 'landing', label: 'Page', cellClass: 'landing-cell', iconKey: 'table-short-landing' },
        { key: 'compliance', label: '', ariaLabel: 'Compliance', sortable: false, cellClass: 'compliance-cell' },
        { key: 'from', label: 'GEO', iconKey: 'table-short-geo' },
        { key: 'source', label: 'Source', cellClass: 'source-cell', iconKey: 'table-short-source' },
        { key: 'device', label: 'Device', iconKey: 'table-short-device' },
        { key: 'cart', label: 'Cart', cellClass: 'cart-value-cell', iconKey: 'table-short-cart' },
        { key: 'arrived', label: 'Arrived', iconKey: 'table-short-arrived' },
        { key: 'last_seen', label: 'Seen', iconKey: 'table-short-seen' },
        { key: 'actions', label: 'Actions', sortable: false },
        { key: 'exit', label: 'Exit', sortable: false },
        { key: 'history', label: 'Visits', iconKey: 'table-short-history' },
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
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
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
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
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
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
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
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'abandoned-carts-countries-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table abandoned-carts-countries-table',
      ariaLabel: 'Abandoned carts by country',
      bodyId: 'abandoned-carts-countries-body',
      columns: [
        { key: 'country', label: 'Country', sortable: false, iconKey: 'table-short-geo' },
        { key: 'abandoned', label: 'Abandoned', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-sessions' },
        { key: 'checkout', label: 'Checkout', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-orders' },
        { key: 'pct', label: '% Abandoned', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Value', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-revenue' }
      ]
    },
    'abandoned-carts-country-products-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table abandoned-carts-country-products-table',
      ariaLabel: 'Abandoned carts by country + product',
      bodyId: 'abandoned-carts-country-products-body',
      columns: [
        { key: 'country', label: 'Country + Product', sortable: false, iconKey: 'table-short-country-product' },
        { key: 'abandoned', label: 'Abandoned', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-sessions' },
        { key: 'checkout', label: 'Checkout', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-orders' },
        { key: 'pct', label: '% Abandoned', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-cr' },
        { key: 'rev', label: 'Value', sortable: false, cellClass: 'text-end', iconKey: 'table-icon-revenue' }
      ]
    },
    'attribution-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Attribution',
      bodyId: 'attribution-body',
      emptyMessage: 'No attribution data.',
      columns: [
        { key: 'attribution', label: 'Attribution', iconKey: 'table-short-source' },
        { key: 'sessions', label: 'Sessions', iconKey: 'table-icon-sessions' },
        { key: 'orders', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-cr' },
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'devices-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Devices',
      bodyId: 'devices-body',
      emptyMessage: 'No device data.',
      columns: [
        { key: 'device', label: 'Device', iconKey: 'table-short-type' },
        { key: 'sessions', label: 'Sessions', iconKey: 'table-icon-sessions' },
        { key: 'orders', label: 'Orders', iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', iconKey: 'table-icon-cr' },
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-revenue' }
      ]
    },
    'browsers-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Browsers',
      bodyId: 'browsers-body',
      emptyMessage: 'No browser data.',
      columns: [
        { key: 'browser', label: 'Browser', sortable: false },
        { key: 'sessions', label: 'Sessions', sortable: false, iconKey: 'table-icon-sessions' },
        { key: 'carts', label: 'Carts', sortable: false },
        { key: 'orders', label: 'Orders', sortable: false, iconKey: 'table-icon-orders' },
        { key: 'cr', label: 'CR%', sortable: false, iconKey: 'table-icon-cr' },
        { key: 'vpv', label: 'VPV', sortable: false, iconKey: 'table-icon-vpv' },
        { key: 'rev', label: 'Rev', sortable: false, iconKey: 'table-icon-revenue' },
        { key: 'aov', label: 'AOV', sortable: false }
      ]
    },
    'payment-types-table': {
      wrapClass: 'country-table-wrap',
      tableClass: 'by-country-table',
      ariaLabel: 'Payment methods',
      bodyId: 'payment-types-body',
      emptyMessage: 'No payment methods.',
      columns: [
        { key: 'payment', label: 'Payment', sortable: false },
        { key: 'icon', label: '', sortable: false, cellClass: 'kexo-payments-icon-col kexo-payment-method-icon-cell' },
        { key: 'sessions', label: 'Sessions', sortable: false, iconKey: 'table-icon-sessions', cellClass: 'text-center' },
        { key: 'carts', label: 'Carts', sortable: false, cellClass: 'text-end' },
        { key: 'orders', label: 'Orders', sortable: false, iconKey: 'table-icon-orders', cellClass: 'text-end' },
        { key: 'cr', label: 'CR%', sortable: false, iconKey: 'table-icon-cr', cellClass: 'text-end' },
        { key: 'vpv', label: 'VPV', sortable: false, iconKey: 'table-icon-vpv', cellClass: 'text-end' },
        { key: 'rev', label: 'Rev', sortable: false, iconKey: 'table-icon-revenue', cellClass: 'text-end' },
        { key: 'aov', label: 'AOV', sortable: false, cellClass: 'text-end' }
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
        { key: 'vpv', label: 'VPV', iconKey: 'table-icon-vpv' },
        { key: 'rev', label: 'Rev', iconKey: 'table-icon-variants-revenue', defaultSort: 'rev' }
      ]
    },
    'ads-campaigns-table': {
      wrapClass: '',
      tableClass: 'ads-campaign-table',
      ariaLabel: 'Ads campaigns',
      bodyId: 'ads-campaigns-body',
      columns: [
        { key: 'campaign', label: 'Campaign', cellClass: '' },
        { key: 'clicks', label: 'Clicks', cellClass: ' text-end' },
        { key: 'impr', label: 'Impr', cellClass: ' text-end' },
        { key: 'conv', label: 'Conv', cellClass: ' text-end' },
        { key: 'sales', label: 'Revenue', cellClass: ' text-end' },
        { key: 'spend', label: 'Spend', cellClass: ' text-end' },
        { key: 'roas', label: 'ROAS', cellClass: ' text-end' },
        { key: 'profit', label: 'Gross', cellClass: ' text-end' }
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
        { header: 'CR%', headerClass: 'text-end w-1' },
        { header: 'VPV', headerClass: 'text-end w-1' }
      ]
    },
    'dash-top-countries': {
      tableId: 'dash-top-countries',
      columns: [
        { header: 'Country', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' },
        { header: 'VPV', headerClass: 'text-end w-1' }
      ]
    },
    'dash-trending-up': {
      tableId: 'dash-trending-up',
      columns: [
        { header: 'Product', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' },
        { header: 'VPV', headerClass: 'text-end w-1' }
      ]
    },
    'dash-trending-down': {
      tableId: 'dash-trending-down',
      columns: [
        { header: 'Product', headerClass: '' },
        { header: 'Revenue', headerClass: 'text-end w-1' },
        { header: 'Orders', headerClass: 'text-end w-1' },
        { header: 'CR%', headerClass: 'text-end w-1' },
        { header: 'VPV', headerClass: 'text-end w-1' }
      ]
    },
    'latest-sales-table': {
      tableId: 'latest-sales-table',
      noHeader: true,
      columns: [
        { header: '', headerClass: 'w-1' },
        { header: 'Product', headerClass: '' },
        { header: 'Ago', headerClass: 'text-end w-1' },
        { header: 'Value', headerClass: 'text-end w-1' }
      ]
    }
  };

  window.KEXO_TOOLS_TABLE_DEFS = {
    'tools-compare-cr-table': {
      tableClass: 'tools-table table table-sm table-vcenter',
      wrapClass: 'tools-table-wrap',
      columns: [
        { header: 'Variant', headerClass: '' },
        { header: 'Sessions (before)', headerClass: '' },
        { header: 'Orders (before)', headerClass: '' },
        { header: 'CR (before)', headerClass: '' },
        { header: 'Sessions (after)', headerClass: '' },
        { header: 'Orders (after)', headerClass: '' },
        { header: 'CR (after)', headerClass: '' },
        { header: '% change', headerClass: '' }
      ]
    },
    'tools-shipping-cr-table': {
      tableClass: 'tools-table table table-vcenter',
      wrapClass: 'tools-table-wrap',
      columns: [
        { header: 'Country', headerClass: '' },
        { header: 'Shipping label', headerClass: '' },
        { header: 'Paid shipping', headerClass: '' },
        { header: 'Set shipping', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'CR%', headerClass: '' }
      ]
    }
  };

  window.KEXO_VARIANTS_MODAL_TABLE_DEFS = {
    'variants-issues-table': {
      columns: [
        { header: 'Variant title', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'Rev', headerClass: 'text-end' },
        { header: 'Matched rules', headerClass: '' },
        { header: 'Actions', headerClass: 'text-end' }
      ],
      columnsNoMatches: [
        { header: 'Variant title', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'Rev', headerClass: 'text-end' },
        { header: 'Actions', headerClass: 'text-end' }
      ]
    },
    'variants-top-unmapped-table': {
      columns: [
        { header: 'Variant', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'Rev', headerClass: 'text-end' }
      ]
    },
    'variants-all-stats-totals-table': {
      columns: [
        { header: 'Table', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'Rev', headerClass: 'text-end' }
      ]
    },
    'variants-all-stats-coverage-table': {
      columns: [
        { header: 'Table', headerClass: '' },
        { header: 'Total Sessions', headerClass: 'text-end' },
        { header: 'In Scope Sessions', headerClass: 'text-end' },
        { header: 'Mapped', headerClass: 'text-end' },
        { header: 'Ignored', headerClass: 'text-end' },
        { header: 'Out Of Scope', headerClass: 'text-end' },
        { header: 'Unmapped', headerClass: 'text-end' },
        { header: 'Resolved In Mapped', headerClass: 'text-end' },
        { header: 'Mapped %', headerClass: 'text-end' },
        { header: 'Mapped+Ignored %', headerClass: 'text-end' }
      ]
    }
  };

  window.KEXO_SETTINGS_MODAL_TABLE_DEFS = {
    'settings-ignore-list-table': {
      columns: [
        { header: 'Table', headerClass: '' },
        { header: 'Ignored variant title', headerClass: '' },
        { header: 'Actions', headerClass: 'text-end' }
      ]
    },
    'settings-merge-rules-table': {
      columns: [
        { header: 'Output', headerClass: '' },
        { header: 'Include aliases', headerClass: '' },
        { header: 'Actions', headerClass: 'text-end w-1' }
      ]
    },
    'settings-kpis-table': {
      columns: [
        { header: 'On', headerClass: 'w-1' },
        { header: 'Label', headerClass: '' },
        { header: 'Key', headerClass: 'text-muted' },
        { header: 'Order', headerClass: 'text-end w-1' }
      ]
    },
    'settings-date-ranges-table': {
      columns: [
        { header: 'On', headerClass: 'w-1' },
        { header: 'Label', headerClass: '' },
        { header: 'Key', headerClass: 'text-muted' },
        { header: 'Order', headerClass: 'text-end w-1' }
      ]
    }
  };

  window.KEXO_APP_MODAL_TABLE_DEFS = {
    'diagnostics-kv-table': {
      columns: [
        { header: 'Metric', headerClass: 'text-secondary' },
        { header: 'Value', headerClass: 'text-end' }
      ]
    },
    'profit-rules-table': {
      columns: [
        { header: 'Rule name', headerClass: '' },
        { header: 'Applies to', headerClass: '' },
        { header: 'Type', headerClass: '' },
        { header: 'Value', headerClass: '' },
        { header: 'Priority', headerClass: '' },
        { header: 'Enabled', headerClass: '' },
        { header: 'Actions', headerClass: '' }
      ]
    },
    'product-insights-metrics-table': {
      columns: [
        { header: 'Metric', headerClass: '' },
        { header: 'Value', headerClass: 'text-end' }
      ]
    },
    'ads-modal-sales-table': {
      tableClass: 'ads-modal-sales-table',
      columns: [
        { header: 'Country', headerClass: '' },
        { header: 'Value', headerClass: '' },
        { header: 'Time', headerClass: '' }
      ]
    },
    'ads-modal-countries-table': {
      tableClass: 'ads-modal-countries-table',
      columns: [
        { header: 'Country', headerClass: '' },
        { header: 'Clicks', headerClass: 'text-end' },
        { header: 'Spend', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'CR%', headerClass: 'text-end' },
        { header: 'VPV', headerClass: 'text-end' },
        { header: 'Revenue', headerClass: 'text-end' },
        { header: 'ROAS', headerClass: 'text-end' }
      ]
    },
    'ads-modal-devices-table': {
      tableClass: 'ads-modal-devices-table',
      columns: [
        { header: 'Device', headerClass: '' },
        { header: 'Clicks', headerClass: 'text-end' },
        { header: 'Spend', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'CR%', headerClass: 'text-end' },
        { header: 'VPV', headerClass: 'text-end' },
        { header: 'Revenue', headerClass: 'text-end' },
        { header: 'ROAS', headerClass: 'text-end' }
      ]
    },
    'ads-modal-networks-table': {
      tableClass: 'ads-modal-networks-table',
      columns: [
        { header: 'Network', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'CR%', headerClass: 'text-end' },
        { header: 'VPV', headerClass: 'text-end' },
        { header: 'Revenue', headerClass: 'text-end' }
      ]
    },
    'ads-modal-dayparting-table': {
      tableClass: 'ads-modal-dayparting-table',
      columns: [
        { header: 'Hour', headerClass: '' },
        { header: 'Clicks', headerClass: 'text-end' },
        { header: 'Spend', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'CR%', headerClass: 'text-end' },
        { header: 'VPV', headerClass: 'text-end' },
        { header: 'Revenue', headerClass: 'text-end' },
        { header: 'ROAS', headerClass: 'text-end' }
      ]
    }
  };

  window.KEXO_BREAKDOWN_TABLE_DEFS = {
    'breakdown-aov-table': { columns: [{ key: 'country', label: 'Country' }, { key: 'revenue', label: 'Rev' }, { key: 'aov', label: 'AOV' }, { key: 'conversion', label: 'CR%' }] },
    'breakdown-product-table': { columns: [{ key: 'product', label: 'Product' }, { key: 'rev', label: 'Rev' }, { key: 'cr', label: 'CR%' }] },
    'breakdown-type-table': { columns: [{ key: 'type', label: 'Type' }, { key: 'rev', label: 'Rev' }, { key: 'cr', label: 'CR%' }] },
    'breakdown-finish-table': { columns: [{ key: 'finish', label: 'Finish' }, { key: 'rev', label: 'Rev' }, { key: 'cr', label: 'CR%' }] },
    'breakdown-length-table': { columns: [{ key: 'length', label: 'Length' }, { key: 'rev', label: 'Rev' }, { key: 'cr', label: 'CR%' }] },
    'breakdown-chainstyle-table': { columns: [{ key: 'chainstyle', label: 'Chain style' }, { key: 'rev', label: 'Rev' }, { key: 'cr', label: 'CR%' }] }
  };
})();
