/**
 * KEXO chart definitions — used by kexo-chart-builder.js and Settings → Layout → Charts.
 * Keyed by chartKey. Modes/colors from chartsUiConfig (Layout → Charts) applied at runtime.
 */
(function () {
  'use strict';

  var CHART_MODE_LABEL = {
    'map-animated': 'Map (animated)',
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
    'dash-chart-overview-30d': {
      modes: ['line', 'area', 'bar', 'stacked-bar'],
      series: ['Revenue', 'Cost', 'Profit'],
      defaultMode: 'area',
      height: 420,
      capabilities: {
        controls: [
          {
            type: 'select',
            field: 'timeseriesScope',
            label: 'Timeseries scope',
            hint: 'Full range shows all buckets; Latest shows only the newest bucket.',
            options: [
              { value: 'full', label: 'Full range' },
              { value: 'latest', label: 'Latest bucket' },
            ],
            default: 'full'
          },
          {
            type: 'select',
            field: 'dataLabels',
            label: 'Data-point labels',
            hint: 'Show on hover uses tooltips only; Always show draws labels on the chart.',
            options: [
              { value: 'off', label: 'Show on hover' },
              { value: 'on', label: 'Always show' },
            ],
            default: 'off'
          },
          {
            type: 'range',
            field: 'strokeWidth',
            label: 'Stroke width',
            unit: 'px',
            min: 0.5,
            max: 6,
            step: 0.1,
            modes: ['line', 'area'],
            default: 2.6
          },
          {
            type: 'range',
            field: 'barColumnWidth',
            label: 'Bar column width',
            unit: '%',
            min: 20,
            max: 95,
            step: 1,
            modes: ['bar', 'stacked-bar'],
            default: 60
          },
          {
            type: 'range',
            field: 'gridDash',
            label: 'Grid',
            hint: '0 hides the grid.',
            unit: '',
            min: 0,
            max: 8,
            step: 1,
            default: 3
          },
        ]
      }
    },
    'dash-chart-finishes-30d': {
      modes: ['radialbar', 'bar-horizontal'],
      series: ['Revenue by finish'],
      defaultMode: 'radialbar',
      height: 240,
      colorSlots: 5,
      capabilities: {
        controls: [
          {
            type: 'toggle',
            field: 'radialCenterLabel',
            invert: true,
            label: 'Remove centre label',
            hint: 'Hides the label/value in the middle of the radial chart.',
            modes: ['radialbar'],
            default: true
          },
          {
            type: 'range',
            field: 'radialThickness',
            label: 'Radial thickness',
            unit: '%',
            min: 10,
            max: 80,
            step: 1,
            modes: ['radialbar'],
            default: 42
          },
          {
            type: 'range',
            field: 'barHeight',
            label: 'Bar thickness',
            unit: '%',
            min: 20,
            max: 90,
            step: 1,
            modes: ['bar-horizontal'],
            default: 60
          },
        ]
      }
    },
    'dash-chart-countries-30d': { modes: ['bar-horizontal', 'bar', 'bar-distributed', 'radialbar', 'pie', 'donut', 'line', 'area', 'multi-line-labels'], series: ['Revenue by country'], defaultMode: 'bar-horizontal', height: 240, colorSlots: 5 },
    'dash-chart-devices-30d': {
      modes: ['bar-horizontal', 'radialbar'],
      series: ['Sessions by platform'],
      defaultMode: 'bar-horizontal',
      height: 240,
      colorSlots: 5,
      capabilities: {
        controls: [
          {
            type: 'toggle',
            field: 'icons',
            invert: true,
            label: 'Remove icons',
            hint: 'Hides the icons next to each bar.',
            modes: ['bar-horizontal'],
            default: true
          },
          {
            type: 'toggle',
            field: 'showLabels',
            label: 'Show labels',
            hint: 'Shows the label text next to each bar.',
            modes: ['bar-horizontal'],
            default: true
          },
          {
            type: 'range',
            field: 'barHeight',
            label: 'Bar thickness',
            unit: '%',
            min: 20,
            max: 90,
            step: 1,
            modes: ['bar-horizontal'],
            default: 54
          },
          {
            type: 'range',
            field: 'radialThickness',
            label: 'Radial thickness',
            unit: '%',
            min: 10,
            max: 80,
            step: 1,
            modes: ['radialbar'],
            default: 42
          },
        ]
      }
    },
    'dash-chart-attribution-30d': {
      modes: ['radialbar', 'pie', 'donut'],
      series: ['Revenue by source'],
      defaultMode: 'donut',
      height: 240,
      colorSlots: 5,
      capabilities: {
        controls: [
          {
            type: 'toggle',
            field: 'bottomLabels',
            invert: true,
            label: 'Remove bottom labels',
            hint: 'Hides the labels shown underneath the chart.',
            default: true
          },
          {
            type: 'toggle',
            field: 'radialCenterLabel',
            invert: true,
            label: 'Remove centre label',
            hint: 'Hides the label/value in the middle of the radial chart.',
            modes: ['radialbar'],
            default: true
          },
          {
            type: 'range',
            field: 'radialThickness',
            label: 'Radial thickness',
            unit: '%',
            min: 10,
            max: 80,
            step: 1,
            modes: ['radialbar'],
            default: 42
          },
        ]
      }
    },
    'live-online-chart': {
      modes: ['map-animated'],
      series: ['Online now'],
      defaultMode: 'map-animated',
      height: 220,
      capabilities: {
        controls: [
          { type: 'toggle', field: 'mapShowTooltip', label: 'Tooltips on hover', default: true },
          { type: 'toggle', field: 'mapDraggable', label: 'Drag/pan map', default: true },
          { type: 'toggle', field: 'mapZoomButtons', label: 'Zoom buttons', default: true },
          { type: 'toggle', field: 'mapShowEmptyCaption', label: "Show 'No live activity yet' caption", default: true },
        ],
      },
    },
    'sales-overview-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Revenue'], defaultMode: 'area', height: 220 },
    'date-overview-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Sessions', 'Orders'], defaultMode: 'area', height: 220 },
    'ads-overview-chart': { modes: ['bar', 'combo', 'line', 'area', 'multi-line-labels'], series: ['Profit', 'Sales', 'Spend', 'ROAS'], defaultMode: 'bar', height: 240 },
    'attribution-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true, defaultMode: 'line', height: 320 },
    'devices-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true, defaultMode: 'line', height: 320 },
    'browsers-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Sessions', 'Orders', 'Revenue'], pieMetric: true, defaultMode: 'line', height: 320, capabilities: { icons: true } },
    'products-chart': { modes: ['line', 'area', 'bar', 'pie', 'multi-line-labels'], series: ['Revenue'], defaultMode: 'line', height: 280 },
    'countries-map-chart': {
      modes: ['map-animated'],
      series: ['Online now'],
      defaultMode: 'map-animated',
      height: 320,
      capabilities: {
        controls: [
          { type: 'toggle', field: 'mapShowTooltip', label: 'Tooltips on hover', default: true },
          { type: 'toggle', field: 'mapDraggable', label: 'Drag/pan map', default: true },
          { type: 'toggle', field: 'mapZoomButtons', label: 'Zoom buttons', default: true },
          { type: 'toggle', field: 'mapShowEmptyCaption', label: "Show 'No live activity yet' caption", default: true },
        ],
      },
    },
    'abandoned-carts-chart': { modes: ['area', 'line', 'bar', 'multi-line-labels'], series: ['Abandoned'], defaultMode: 'line', height: 280 },
    'payment-methods-chart': { modes: ['line', 'area', 'bar', 'multi-line-labels'], series: ['Revenue'], defaultMode: 'line', height: 320, colorSlots: 8 },
  };

  window.KEXO_CHART_MODE_LABEL = CHART_MODE_LABEL;

  function chartMeta(key) {
    var k = String(key || '').trim().toLowerCase();
    return window.KEXO_CHART_DEFS[k] || { modes: ['line', 'area'], series: [], defaultMode: 'line', height: 200 };
  }

  window.kexoChartMeta = chartMeta;
})();
