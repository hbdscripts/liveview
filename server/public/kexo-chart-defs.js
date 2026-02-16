/**
 * KEXO chart definitions — used by kexo-chart-builder.js and Settings → Layout → Charts.
 * Keyed by chartKey. Modes/colors from chartsUiConfig (Layout → Charts) applied at runtime.
 */
(function () {
  'use strict';

  var CHART_MODE_LABEL = {
    'map-animated': 'Map (animated)',
    'map-flat': 'Map (flat)',
    area: 'Area',
    line: 'Line',
    bar: 'Bar',
    pie: 'Pie',
    combo: 'Multiple (combo)',
    'multi-line-labels': 'Multiple line + labels',
  };

  window.KEXO_CHART_DEFS = {
    'dash-chart-revenue': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue'], defaultMode: 'area', height: 200 },
    'dash-chart-orders': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Orders'], defaultMode: 'area', height: 200 },
    'dash-chart-conv': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Kexo', 'Shopify (if available)'], defaultMode: 'area', height: 200, pct: true },
    'dash-chart-sessions': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Sessions'], defaultMode: 'area', height: 200 },
    'dash-chart-adspend': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue', 'Ad spend'], defaultMode: 'area', height: 200 },
    'live-online-chart': { modes: ['map-animated', 'map-flat'], series: ['Online now'], defaultMode: 'map-flat', height: 220 },
    'sales-overview-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue'], defaultMode: 'area', height: 220 },
    'date-overview-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Sessions', 'Orders'], defaultMode: 'area', height: 220 },
    'ads-overview-chart': { modes: ['bar', 'combo', 'line', 'area', 'multi-line-labels'], series: ['Profit', 'Sales', 'Spend', 'ROAS'], defaultMode: 'bar', height: 240 },
    'attribution-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true, defaultMode: 'line', height: 320 },
    'devices-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true, defaultMode: 'line', height: 320 },
    'products-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Revenue'], defaultMode: 'line', height: 280 },
    'countries-map-chart': { modes: ['map-animated', 'map-flat'], series: ['Accent'], defaultMode: 'map-flat', height: 320 },
    'abandoned-carts-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Abandoned'], defaultMode: 'line', height: 280 },
  };

  window.KEXO_CHART_MODE_LABEL = CHART_MODE_LABEL;

  function chartMeta(key) {
    var k = String(key || '').trim().toLowerCase();
    return window.KEXO_CHART_DEFS[k] || { modes: ['line', 'area'], series: [], defaultMode: 'line', height: 200 };
  }

  window.kexoChartMeta = chartMeta;
})();
