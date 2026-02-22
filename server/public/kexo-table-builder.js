/**
 * KEXO shared table builder — single source of truth for table markup.
 * All tables (data tables, settings config tables) should use these builders.
 */
(function () {
  'use strict';

  function escapeHtml(str) {
    if (str == null) return '';
    try {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    } catch (_) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  }

  /**
   * Build grid-table (data tables with sticky/resize).
   * config: { wrapClass, wrapId, tableId, tableClass, ariaLabel, columns, bodyId, emptyMessage, innerOnly }
   * columns: [{ key, label, sortable, cellClass, ariaLabel, iconKey, defaultSort }]
   * innerOnly: if true, return only the grid-table div (no wrapper) for injection into existing container
   * bodyHtml: optional pre-built body HTML; when provided, used instead of placeholder row
   */
  function buildKexoGridTable(config) {
    var c = config || {};
    var wrapClass = c.wrapClass || 'country-table-wrap';
    var wrapId = c.wrapId || '';
    var innerOnly = c.innerOnly === true;
    var customBodyHtml = c.bodyHtml;
    var tableId = c.tableId || '';
    var tableClass = c.tableClass || 'grid-table';
    var ariaLabel = c.ariaLabel || '';
    var columns = Array.isArray(c.columns) ? c.columns : [];
    var bodyId = c.bodyId || (tableId ? tableId + '-body' : '');
    var emptyMessage = c.emptyMessage != null ? String(c.emptyMessage) : 'Loading…';

    var wrapAttrs = ' class="' + escapeHtml(wrapClass) + '"';
    if (wrapId) wrapAttrs += ' id="' + escapeHtml(wrapId) + '"';

    var tableAttrs = ' class="grid-table ' + escapeHtml(tableClass) + '" role="table"';
    if (tableId) tableAttrs += ' id="' + escapeHtml(tableId) + '"';
    if (ariaLabel) tableAttrs += ' aria-label="' + escapeHtml(ariaLabel) + '"';
    if (c.virtualizeRows === true) tableAttrs += ' data-kexo-virtualize="1"';

    var headerCells = '';
    columns.forEach(function (col) {
      var key = col.key != null ? String(col.key).trim() : '';
      var label = col.label != null ? String(col.label) : '';
      var sortable = col.sortable !== false && key;
      var cellClass = (col.cellClass || '') + (sortable ? ' sortable' : '');
      var aria = col.ariaLabel != null ? String(col.ariaLabel) : label;
      var defaultSort = col.defaultSort || '';

      var cellAttrs = ' class="grid-cell' + (cellClass ? ' ' + escapeHtml(cellClass.trim()) : '') + '" role="columnheader"';
      if (sortable) {
        cellAttrs += ' data-sort="' + escapeHtml(key) + '" aria-sort="none" tabindex="0"';
      }
      if (aria) cellAttrs += ' aria-label="' + escapeHtml(aria) + '"';

      headerCells += '<div' + cellAttrs + '>' +
        '<span class="th-label-long">' + escapeHtml(label) + '</span>' +
        '</div>';
    });

    var bodyContent = customBodyHtml != null ? customBodyHtml : (
      '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">' + escapeHtml(emptyMessage) + '</div></div>'
    );
    var bodyHtml = '<div' + (bodyId ? ' id="' + escapeHtml(bodyId) + '"' : '') + ' class="grid-body" role="rowgroup">' +
      bodyContent +
      '</div>';

    var tableHtml = '<div' + tableAttrs + '>' +
      '<div class="grid-header kexo-grid-header" role="rowgroup">' +
        '<div class="grid-row grid-row--header" role="row">' + headerCells + '</div>' +
      '</div>' +
      bodyHtml +
    '</div>';

    if (innerOnly) return tableHtml;
    return '<div' + wrapAttrs + '>' + tableHtml + '</div>';
  }

  /**
   * Build native table (dashboard overview, Latest sales).
   * config: { tableId, columns, bodyId }
   * columns: [{ header, headerClass }]
   */
  function buildKexoNativeTable(config) {
    var c = config || {};
    var tableId = c.tableId || '';
    var columns = Array.isArray(c.columns) ? c.columns : [];
    var bodyId = c.bodyId || '';
    var tableClass = c.tableClass || 'table table-vcenter card-table';
    var ariaLabel = c.ariaLabel || '';
    var noHeader = !!(c.noHeader);

    var theadHtml = '';
    if (!noHeader) {
      var thCells = '';
      columns.forEach(function (col) {
        var hdr = col.header != null ? String(col.header) : '';
        var cls = col.headerClass != null ? ' class="' + escapeHtml(String(col.headerClass).trim()) + '"' : '';
        thCells += '<th' + cls + '>' + escapeHtml(hdr) + '</th>';
      });
      theadHtml = '<thead><tr>' + thCells + '</tr></thead>';
    }

    var tbodyAttrs = bodyId ? ' id="' + escapeHtml(bodyId) + '"' : '';
    var tableAttrs = ' class="' + escapeHtml(tableClass) + '"';
    if (tableId) tableAttrs += ' id="' + escapeHtml(tableId) + '"';
    if (ariaLabel) tableAttrs += ' aria-label="' + escapeHtml(ariaLabel) + '"';

    return '<div class="table-responsive">' +
      '<table' + tableAttrs + '>' +
        theadHtml +
        '<tbody' + tbodyAttrs + '></tbody>' +
      '</table>' +
    '</div>';
  }

  /**
   * Build settings config table (Charts, KPIs, Date ranges).
   * config: { tableClass, columns, renderRow }
   * columns: [{ header, headerClass }]
   * renderRow(item) returns <tr>...</tr> HTML for each row
   */
  function buildKexoSettingsTable(config) {
    var c = config || {};
    var tableClass = c.tableClass || 'table table-sm table-vcenter mb-0';
    var wrapClass = c.wrapClass || 'table-responsive overflow-x-auto';
    var columns = Array.isArray(c.columns) ? c.columns : [];
    var rows = Array.isArray(c.rows) ? c.rows : [];
    var rowKey = c.rowKey || 'key';
    var renderRow = typeof c.renderRow === 'function' ? c.renderRow : null;

    var thCells = '';
    columns.forEach(function (col) {
      var hdr = col.header != null ? String(col.header) : '';
      var cls = col.headerClass != null ? ' class="' + escapeHtml(String(col.headerClass).trim()) + '"' : '';
      thCells += '<th' + cls + '>' + escapeHtml(hdr) + '</th>';
    });

    var bodyRows = '';
    if (renderRow) {
      rows.forEach(function (item) {
        bodyRows += renderRow(item);
      });
    } else if (c.bodyHtml) {
      bodyRows = c.bodyHtml;
    }

    return '<div class="' + escapeHtml(wrapClass) + '">' +
      '<table class="' + escapeHtml(tableClass) + '">' +
        '<thead><tr>' + thCells + '</tr></thead>' +
        '<tbody>' + bodyRows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  window.buildKexoGridTable = buildKexoGridTable;
  window.buildKexoNativeTable = buildKexoNativeTable;
  window.buildKexoSettingsTable = buildKexoSettingsTable;
  window.kexoTableBuilderEscapeHtml = escapeHtml;
})();
