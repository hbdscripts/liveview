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
    bar: 'Vertical Bar',
    'bar-horizontal': 'Horizontal Bar',
    'bar-distributed': 'Distributed Bar',
    radialbar: 'Radial Bar',
    pie: 'Pie',
    donut: 'Donut',
    combo: 'Combo',
    'multi-line-labels': 'Multi Line',
    'stacked-area': 'Stacked Area',
    'stacked-bar': 'Stacked Bar',
  };

  window.KEXO_CHART_DEFS = {
    'dash-chart-overview-30d': { modes: ['area', 'bar', 'line', 'multi-line-labels', 'combo', 'stacked-area', 'stacked-bar'], series: ['Revenue', 'Cost', 'Profit'], defaultMode: 'area', height: 420 },
    'dash-chart-finishes-30d': { modes: ['radialbar'], series: ['Revenue by finish'], defaultMode: 'radialbar', height: 240, colorSlots: 5 },
    'dash-chart-countries-30d': { modes: ['bar-horizontal', 'bar', 'bar-distributed', 'radialbar', 'pie', 'donut', 'line', 'area', 'multi-line-labels'], series: ['Revenue by country'], defaultMode: 'bar-horizontal', height: 240, colorSlots: 5 },
    'dash-chart-devices-30d': { modes: ['bar-horizontal'], series: ['Sessions by platform'], defaultMode: 'bar-horizontal', height: 240, colorSlots: 5 },
    'dash-chart-attribution-30d': { modes: ['donut'], series: ['Revenue by source'], defaultMode: 'donut', height: 240, colorSlots: 5, capabilities: { icons: true } },
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
