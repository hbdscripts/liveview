(function () {
  'use strict';

  if (!document.body || document.body.getAttribute('data-page') !== 'variants') return;
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('variants', { page: 'variants' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('variants', 'init', { page: 'variants' }); } catch (_) {}

  var API = '';
  try {
    if (typeof window !== 'undefined' && window.API) API = String(window.API || '');
  } catch (_) {}

  var state = {
    shop: '',
    tables: [],
    loading: false,
    loaded: false,
    ignoreSaving: false,
    lastPayload: null,
  };

  var DEFAULT_VARIANTS_TABLE_ICON = 'fa-solid fa-grid-round';

  function dismissGlobalPageLoader() {
    try {
      var overlay = document.getElementById('page-body-loader');
      if (overlay) overlay.classList.add('is-hidden');
    } catch (_) {}
    try {
      var pageBody = document.querySelector('.page-body');
      if (pageBody) {
        pageBody.classList.remove('report-building');
        pageBody.style.minHeight = '';
      }
    } catch (_) {}
  }

  function escapeHtml(value) {
    if (value == null) return '';
    var div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML.replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getShopFromQuery() {
    try {
      var m = /[?&]shop=([^&]+)/.exec(window.location.search || '');
      return m && m[1] ? decodeURIComponent(m[1]) : '';
    } catch (_) {
      return '';
    }
  }

  function getRangeKey() {
    var el = document.getElementById('global-date-select');
    if (!el || !el.value) return 'today';
    return String(el.value).trim().toLowerCase() || 'today';
  }

  function rowsStorageKey(tableId) {
    var id = String(tableId || '').trim().toLowerCase();
    var resolved = (id.indexOf('variants-table-') === 0) ? 'insights-variants-tables' : id;
    return 'kexo:table-rows:v1:' + resolved;
  }

  function rowsPerPageForTable(tableId) {
    var fallback = 5;
    try {
      var raw = localStorage.getItem(rowsStorageKey(tableId));
      var n = parseInt(String(raw || ''), 10);
      if (n === 5 || n === 10) return n;
    } catch (_) {}
    return fallback;
  }

  function buildTableCard(table) {
    var safeId = String(table.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    var tableId = 'variants-table-' + safeId;
    var bodyId = 'variants-body-' + safeId;
    var wrapId = 'variants-wrap-' + safeId;
    var paginationId = 'variants-pagination-' + safeId;
    var cardId = 'stats-variants-' + safeId;
    var title = table.name || table.id || 'Variant Table';
    var iconClass = String((table && table.icon ? table.icon : '') || '').trim().replace(/\s+/g, ' ') || DEFAULT_VARIANTS_TABLE_ICON;
    var diag = table && table.diagnostics ? table.diagnostics : null;
    var unmappedCount = diag && Number(diag.unmappedCount) ? Number(diag.unmappedCount) : 0;
    var ambiguousCount = diag && Number(diag.ambiguousCount) ? Number(diag.ambiguousCount) : 0;
    var hasWarnings = unmappedCount > 0 || ambiguousCount > 0;
    var warningText = hasWarnings
      ? ('Mappings issue: ' + String(unmappedCount) + ' unmapped, ' + String(ambiguousCount) + ' ambiguous')
      : '';

    var variantsDef = (typeof window.KEXO_TABLE_DEFS !== 'undefined' && window.KEXO_TABLE_DEFS['variants-table'])
      ? window.KEXO_TABLE_DEFS['variants-table'] : null;
    var tableHtml = (typeof window.buildKexoGridTable === 'function' && variantsDef)
      ? window.buildKexoGridTable({
          wrapClass: variantsDef.wrapClass || 'country-table-wrap',
          wrapId: wrapId,
          tableId: tableId,
          tableClass: variantsDef.tableClass || 'by-country-table best-variants-table',
          ariaLabel: title,
          columns: variantsDef.columns || [],
          bodyId: bodyId,
          emptyMessage: 'Loading…'
        })
      : ('<div class="country-table-wrap" id="' + escapeHtml(wrapId) + '"><div id="' + escapeHtml(tableId) + '" class="grid-table by-country-table best-variants-table" role="table" aria-label="' + escapeHtml(title) + '"><div class="grid-header kexo-grid-header" role="rowgroup"><div class="grid-row grid-row--header" role="row"><div class="grid-cell bs-product-col sortable" role="columnheader" data-sort="variant" aria-sort="none" tabindex="0" aria-label="Variant"><span class="th-label-long">Variant</span><span class="th-label-short"></span></div><div class="grid-cell sortable" role="columnheader" data-sort="sessions" aria-sort="none" tabindex="0" aria-label="Sessions"><span class="th-label-long">Sessions</span><span class="th-label-short"></span></div><div class="grid-cell sortable" role="columnheader" data-sort="orders" aria-sort="none" tabindex="0" aria-label="Orders"><span class="th-label-long">Orders</span><span class="th-label-short"></span></div><div class="grid-cell sortable" role="columnheader" data-sort="cr" aria-sort="none" tabindex="0" aria-label="CR%"><span class="th-label-long">CR%</span><span class="th-label-short"></span></div><div class="grid-cell sortable" role="columnheader" data-sort="rev" aria-sort="descending" tabindex="0" aria-label="Rev"><span class="th-label-long">Rev</span><span class="th-label-short"></span></div></div></div><div id="' + escapeHtml(bodyId) + '" class="grid-body" role="rowgroup"><div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">Loading…</div></div></div></div></div>');

    return '' +
      '<div class="stats-card card" id="' + escapeHtml(cardId) + '" data-table-class="dashboard" data-table-zone="variants-' + escapeHtml(safeId) + '" data-table-id="' + escapeHtml(tableId) + '">' +
        '<div class="card-header d-flex align-items-center flex-wrap gap-2">' +
          '<div class="d-flex align-items-center flex-wrap gap-2 variants-card-heading">' +
            '<h3 class="card-title mb-0"><i class="' + escapeHtml(iconClass) + ' me-2 text-secondary variants-table-icon" aria-hidden="true"></i>' + escapeHtml(title) + '</h3>' +
            (hasWarnings
              ? '<button type="button" class="badge bg-dark-lt border-0 variants-issues-trigger" data-table-safe-id="' + escapeHtml(safeId) + '" title="' + escapeHtml(warningText) + '">' + escapeHtml(String(unmappedCount + ambiguousCount)) + ' mapping issues</button>'
              : '') +
          '</div>' +
        '</div>' +
        tableHtml +
        '<div class="card-footer d-flex align-items-center justify-content-center is-hidden" id="' + escapeHtml(paginationId) + '" aria-label="' + escapeHtml(title) + ' pagination"></div>' +
      '</div>';
  }

  function formatInt(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Math.max(0, Math.trunc(n)).toLocaleString();
  }

  function formatPct(value) {
    if (value == null) return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(1) + '%';
  }

  function formatMoney(value) {
    if (value == null) return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return '&pound;' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatCoveragePct(part, total) {
    var p = Number(part);
    var t = Number(total);
    if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return '—';
    return ((p / t) * 100).toFixed(1) + '%';
  }

  function normalizeIgnoredTitle(raw) {
    return String(raw == null ? '' : raw).trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 512);
  }

  function readJsonSafeResponse(response) {
    return response.text().then(function (text) {
      var json = null;
      try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
      return { response: response, json: json, text: text || '' };
    });
  }

  function setIssuesStatus(message, isError) {
    var el = document.getElementById('variants-issues-status');
    if (!el) return;
    el.textContent = message || '';
    el.className = isError ? 'small text-danger mb-2' : 'small text-secondary mb-2';
  }

  function bucketTotals(diag, bucketName) {
    var totals = diag && diag.totals ? diag.totals : {};
    var bucket = totals && totals[bucketName] ? totals[bucketName] : {};
    return {
      sessions: Number(bucket.sessions) || 0,
      orders: Number(bucket.orders) || 0,
      revenue: Number(bucket.revenue) || 0,
    };
  }

  function summarizeTableDiagnostic(diag) {
    var mapped = bucketTotals(diag, 'mapped');
    var resolved = bucketTotals(diag, 'resolved');
    var ignored = bucketTotals(diag, 'ignored');
    var outOfScope = bucketTotals(diag, 'outOfScope');
    var unmapped = bucketTotals(diag, 'unmapped');
    var ambiguous = bucketTotals(diag, 'ambiguous');
    var totalSessions = mapped.sessions + ignored.sessions + outOfScope.sessions + unmapped.sessions + ambiguous.sessions;
    var totalOrders = mapped.orders + ignored.orders + outOfScope.orders + unmapped.orders + ambiguous.orders;
    var totalRevenue = mapped.revenue + ignored.revenue + outOfScope.revenue + unmapped.revenue + ambiguous.revenue;
    var inScopeSessions = Math.max(0, totalSessions - outOfScope.sessions);
    return {
      tableId: diag && diag.tableId ? String(diag.tableId) : '',
      tableName: diag && diag.tableName ? String(diag.tableName) : (diag && diag.tableId ? String(diag.tableId) : 'Table'),
      mapped: mapped,
      resolved: resolved,
      ignored: ignored,
      outOfScope: outOfScope,
      unmapped: unmapped,
      ambiguous: ambiguous,
      inScopeSessions: inScopeSessions,
      totalSessions: totalSessions,
      totalOrders: totalOrders,
      totalRevenue: totalRevenue,
    };
  }

  var issuesModalBackdropEl = null;
  function closeIssuesModal() {
    var modal = document.getElementById('variants-issues-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (issuesModalBackdropEl && issuesModalBackdropEl.parentNode) {
      issuesModalBackdropEl.parentNode.removeChild(issuesModalBackdropEl);
    }
    issuesModalBackdropEl = null;
  }

  function ensureIssuesModalBackdrop() {
    if (issuesModalBackdropEl && issuesModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    issuesModalBackdropEl = el;
  }

  function renderIssueRows(items, includeMatches, tableId) {
    var list = Array.isArray(items) ? items : [];
    if (!list.length) return '<div class="text-secondary">No examples.</div>';
    var def = (window.KEXO_VARIANTS_MODAL_TABLE_DEFS && window.KEXO_VARIANTS_MODAL_TABLE_DEFS['variants-issues-table']) || {};
    var columns = includeMatches ? (def.columns || []) : (def.columnsNoMatches || []);
    if (!columns.length) {
      columns = includeMatches
        ? [
            { header: 'Variant title', headerClass: '' },
            { header: 'Sessions', headerClass: 'text-end' },
            { header: 'Orders', headerClass: 'text-end' },
            { header: 'Rev', headerClass: 'text-end' },
            { header: 'Matched rules', headerClass: '' },
            { header: 'Actions', headerClass: 'text-end' }
          ]
        : [
            { header: 'Variant title', headerClass: '' },
            { header: 'Sessions', headerClass: 'text-end' },
            { header: 'Orders', headerClass: 'text-end' },
            { header: 'Rev', headerClass: 'text-end' },
            { header: 'Actions', headerClass: 'text-end' }
          ];
    }
    return buildKexoSettingsTable({
      tableClass: 'table table-sm table-vcenter mb-0',
      columns: columns,
      rows: list,
      renderRow: function (item) {
        var title = item && item.variant_title ? String(item.variant_title) : 'Unknown variant';
        var sessions = item && item.sessions != null ? formatInt(item.sessions) : '0';
        var orders = item && item.orders != null ? formatInt(item.orders) : '0';
        var revenue = item && item.revenue != null ? formatMoney(item.revenue) : '£0';
        var matches = '';
        if (includeMatches) {
          var rawMatches = Array.isArray(item && item.matches) ? item.matches : [];
          matches = rawMatches.map(function (m) {
            if (!m) return '';
            return m.label || m.id || '';
          }).filter(Boolean).join(', ');
        }
        return '<tr>' +
          '<td>' + escapeHtml(title) + '</td>' +
          '<td class="text-end">' + escapeHtml(sessions) + '</td>' +
          '<td class="text-end">' + escapeHtml(orders) + '</td>' +
          '<td class="text-end">' + revenue + '</td>' +
          (includeMatches ? '<td>' + escapeHtml(matches || '—') + '</td>' : '') +
          '<td class="text-end"><button type="button" class="btn btn-link btn-sm p-0 variants-ignore-link" data-ignore-table-id="' + escapeHtml(String(tableId || '')) + '" data-ignore-title="' + escapeHtml(title) + '">Ignore</button></td>' +
        '</tr>';
      }
    });
  }

  function openIssuesModal(tableState) {
    var modal = document.getElementById('variants-issues-modal');
    var titleEl = document.getElementById('variants-issues-title');
    var bodyEl = document.getElementById('variants-issues-body');
    if (!modal || !titleEl || !bodyEl || !tableState) return;
    closeAllStatsModal();

    var diag = tableState.diagnostics || {};
    var tableName = tableState.name || tableState.id || 'Variants';
    var tableId = tableState.id || '';
    var unmapped = Array.isArray(diag.unmappedExamples) ? diag.unmappedExamples : [];
    var ambiguous = Array.isArray(diag.ambiguousExamples) ? diag.ambiguousExamples : [];
    var totals = diag && diag.totals ? diag.totals : {};
    var mappedTotals = totals && totals.mapped ? totals.mapped : {};
    var ignoredTotals = totals && totals.ignored ? totals.ignored : {};
    var outOfScopeTotals = totals && totals.outOfScope ? totals.outOfScope : {};
    var unmappedTotals = totals && totals.unmapped ? totals.unmapped : {};
    var ambiguousTotals = totals && totals.ambiguous ? totals.ambiguous : {};
    var totalSessions = (Number(mappedTotals.sessions) || 0) + (Number(ignoredTotals.sessions) || 0) + (Number(outOfScopeTotals.sessions) || 0) + (Number(unmappedTotals.sessions) || 0) + (Number(ambiguousTotals.sessions) || 0);
    var totalOrders = (Number(mappedTotals.orders) || 0) + (Number(ignoredTotals.orders) || 0) + (Number(outOfScopeTotals.orders) || 0) + (Number(unmappedTotals.orders) || 0) + (Number(ambiguousTotals.orders) || 0);
    var totalRevenue = (Number(mappedTotals.revenue) || 0) + (Number(ignoredTotals.revenue) || 0) + (Number(outOfScopeTotals.revenue) || 0) + (Number(unmappedTotals.revenue) || 0) + (Number(ambiguousTotals.revenue) || 0);
    var mappedCr = (Number(mappedTotals.sessions) || 0) > 0
      ? ((Number(mappedTotals.orders) || 0) / Number(mappedTotals.sessions) * 100).toFixed(1) + '%'
      : '—';
    var exampleLimit = Number(diag.exampleLimit) || 0;
    var ignoredCount = Number(diag.ignoredCount) || 0;
    var unmappedCount = Number(diag.unmappedCount) || 0;
    var ambiguousCount = Number(diag.ambiguousCount) || 0;

    titleEl.textContent = tableName + ' mapping issues';
    bodyEl.innerHTML = '' +
      '<div id="variants-issues-status" class="small text-secondary mb-2"></div>' +
      '<div class="mb-3">' +
        '<div class="fw-semibold mb-1">Coverage snapshot for this table</div>' +
        '<div class="text-secondary small">High CR can happen when mapped coverage is low (orders/sessions outside mapped rules are excluded from rows).</div>' +
      '</div>' +
      '<div class="row g-2 mb-3">' +
        '<div class="col-12 col-md-3"><div class="border rounded p-2"><div class="text-muted small">Mapped sessions</div><div class="fw-semibold">' + escapeHtml(formatInt(mappedTotals.sessions || 0)) + ' <span class="text-muted small">(' + escapeHtml(formatCoveragePct(mappedTotals.sessions || 0, totalSessions)) + ')</span></div></div></div>' +
        '<div class="col-12 col-md-3"><div class="border rounded p-2"><div class="text-muted small">Mapped orders</div><div class="fw-semibold">' + escapeHtml(formatInt(mappedTotals.orders || 0)) + ' <span class="text-muted small">(' + escapeHtml(formatCoveragePct(mappedTotals.orders || 0, totalOrders)) + ')</span></div></div></div>' +
        '<div class="col-12 col-md-3"><div class="border rounded p-2"><div class="text-muted small">Mapped revenue</div><div class="fw-semibold">' + formatMoney(mappedTotals.revenue || 0) + ' <span class="text-muted small">(' + escapeHtml(formatCoveragePct(mappedTotals.revenue || 0, totalRevenue)) + ')</span></div></div></div>' +
        '<div class="col-12 col-md-3"><div class="border rounded p-2"><div class="text-muted small">Ignored sessions</div><div class="fw-semibold">' + escapeHtml(formatInt(ignoredTotals.sessions || 0)) + ' <span class="text-muted small">(' + escapeHtml(formatCoveragePct(ignoredTotals.sessions || 0, totalSessions)) + ')</span></div></div></div>' +
      '</div>' +
      '<div class="mb-3"><span class="badge bg-primary-lt me-2">Current mapped CR: ' + escapeHtml(mappedCr) + '</span><span class="badge bg-dark-lt me-2">' + escapeHtml(String(ignoredCount)) + ' ignored</span><span class="badge bg-warning-lt text-warning me-2">' + escapeHtml(String(unmappedCount)) + ' unmapped</span><span class="badge bg-warning-lt text-warning">' + escapeHtml(String(ambiguousCount)) + ' ambiguous</span></div>' +
      '<h4 class="mb-2">Unmapped variants</h4>' +
      renderIssueRows(unmapped, false, tableId) +
      (unmappedCount > unmapped.length && exampleLimit > 0 ? '<div class="text-muted small mt-2">Showing top ' + escapeHtml(String(unmapped.length)) + ' of ' + escapeHtml(String(unmappedCount)) + ' unmapped variants.</div>' : '') +
      '<h4 class="mb-2 mt-4">Ambiguous variants</h4>' +
      renderIssueRows(ambiguous, true, tableId) +
      (ambiguousCount > ambiguous.length && exampleLimit > 0 ? '<div class="text-muted small mt-2">Showing top ' + escapeHtml(String(ambiguous.length)) + ' of ' + escapeHtml(String(ambiguousCount)) + ' ambiguous variants.</div>' : '');

    ensureIssuesModalBackdrop();
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
    setIssuesStatus('', false);
  }

  var allStatsModalBackdropEl = null;
  function closeAllStatsModal() {
    var modal = document.getElementById('variants-all-stats-modal');
    if (!modal) return;
    modal.classList.remove('show');
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    try { document.body.classList.remove('modal-open'); } catch (_) {}
    if (allStatsModalBackdropEl && allStatsModalBackdropEl.parentNode) {
      allStatsModalBackdropEl.parentNode.removeChild(allStatsModalBackdropEl);
    }
    allStatsModalBackdropEl = null;
  }

  function ensureAllStatsModalBackdrop() {
    if (allStatsModalBackdropEl && allStatsModalBackdropEl.parentNode) return;
    var el = document.createElement('div');
    el.className = 'modal-backdrop fade show';
    document.body.appendChild(el);
    allStatsModalBackdropEl = el;
  }

  function buildAllStatsModalHtml(payload) {
    var data = payload && typeof payload === 'object' ? payload : {};
    var diagnostics = Array.isArray(data.diagnostics) ? data.diagnostics : [];
    if (!diagnostics.length) return '<div class="text-secondary">No diagnostics available for this range yet.</div>';
    var summaries = diagnostics.map(function (diag) { return summarizeTableDiagnostic(diag); });
    var attribution = data && data.attribution ? data.attribution : null;
    var attributionHtml = '';
    if (attribution) {
      var productEntrySessions = Number(attribution.productEntrySessions) || 0;
      var variantParamValidSessions = Number(attribution.variantParamSessionsValid) || 0;
      var coveragePct = attribution.variantParamCoveragePct != null
        ? String(Number(attribution.variantParamCoveragePct).toFixed(1)) + '%'
        : '—';
      attributionHtml = '' +
        '<div class="mb-3 p-2 border rounded">' +
          '<div class="fw-semibold mb-1">Session attribution coverage</div>' +
          '<div class="text-secondary small mb-2">Default option traffic often lacks ?variant=. This can undercount mapped sessions for default length/style.</div>' +
          '<div class="d-flex flex-wrap gap-2">' +
            '<span class="badge bg-dark-lt">Product entry sessions: ' + escapeHtml(formatInt(productEntrySessions)) + '</span>' +
            '<span class="badge bg-dark-lt">Valid ?variant sessions: ' + escapeHtml(formatInt(variantParamValidSessions)) + '</span>' +
            '<span class="badge bg-dark-lt">Coverage: ' + escapeHtml(coveragePct) + '</span>' +
          '</div>' +
        '</div>';
    }

    var defTotals = (window.KEXO_VARIANTS_MODAL_TABLE_DEFS && window.KEXO_VARIANTS_MODAL_TABLE_DEFS['variants-all-stats-totals-table']) || {};
    var defCoverage = (window.KEXO_VARIANTS_MODAL_TABLE_DEFS && window.KEXO_VARIANTS_MODAL_TABLE_DEFS['variants-all-stats-coverage-table']) || {};
    var totalsTableHtml = buildKexoSettingsTable({
      tableClass: 'table table-sm table-vcenter mb-0',
      columns: (defTotals.columns || []).length ? defTotals.columns : [
        { header: 'Table', headerClass: '' },
        { header: 'Sessions', headerClass: 'text-end' },
        { header: 'Orders', headerClass: 'text-end' },
        { header: 'Rev', headerClass: 'text-end' }
      ],
      rows: summaries,
      renderRow: function (row) {
        return '<tr>' +
          '<td>' + escapeHtml(row.tableName) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.totalSessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.totalOrders)) + '</td>' +
          '<td class="text-end">' + formatMoney(row.totalRevenue) + '</td>' +
        '</tr>';
      }
    });
    var coverageTableHtml = buildKexoSettingsTable({
      tableClass: 'table table-sm table-vcenter mb-0',
      columns: (defCoverage.columns || []).length ? defCoverage.columns : [
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
      ],
      rows: summaries,
      renderRow: function (row) {
        var mappedPct = row.inScopeSessions > 0
          ? ((row.mapped.sessions / row.inScopeSessions) * 100).toFixed(1) + '%'
          : '—';
        var mappedPlusIgnoredPct = row.inScopeSessions > 0
          ? (((row.mapped.sessions + row.ignored.sessions) / row.inScopeSessions) * 100).toFixed(1) + '%'
          : '—';
        return '<tr>' +
          '<td>' + escapeHtml(row.tableName) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.totalSessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.inScopeSessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.mapped.sessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.ignored.sessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.outOfScope.sessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.unmapped.sessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(formatInt(row.resolved.sessions)) + '</td>' +
          '<td class="text-end">' + escapeHtml(mappedPct) + '</td>' +
          '<td class="text-end">' + escapeHtml(mappedPlusIgnoredPct) + '</td>' +
        '</tr>';
      }
    });

    function renderTopUnmappedBySessions(diag) {
      var d = diag && typeof diag === 'object' ? diag : {};
      var list = Array.isArray(d.unmappedExamples) ? d.unmappedExamples.slice() : [];
      if (!list.length) return '';
      list.sort(function (a, b) {
        var sa = Number(a && a.sessions) || 0;
        var sb = Number(b && b.sessions) || 0;
        if (sb !== sa) return sb - sa;
        var oa = Number(a && a.orders) || 0;
        var ob = Number(b && b.orders) || 0;
        if (ob !== oa) return ob - oa;
        return String(a && a.variant_title || '').localeCompare(String(b && b.variant_title || ''));
      });
      var top = list.slice(0, 12);
      if (!top.length) return '';
      var def = (window.KEXO_VARIANTS_MODAL_TABLE_DEFS && window.KEXO_VARIANTS_MODAL_TABLE_DEFS['variants-top-unmapped-table']) || {};
      var tableHtml = buildKexoSettingsTable({
        tableClass: 'table table-sm table-vcenter mb-0',
        columns: (def.columns || []).length ? def.columns : [
          { header: 'Variant', headerClass: '' },
          { header: 'Sessions', headerClass: 'text-end' },
          { header: 'Orders', headerClass: 'text-end' },
          { header: 'Rev', headerClass: 'text-end' }
        ],
        rows: top,
        renderRow: function (it) {
          var title = it && it.variant_title ? String(it.variant_title) : 'Unknown variant';
          var vid = it && it.variant_id ? String(it.variant_id) : '';
          var sessions = formatInt(it && it.sessions != null ? it.sessions : 0);
          var orders = formatInt(it && it.orders != null ? it.orders : 0);
          var revenue = formatMoney(it && it.revenue != null ? it.revenue : 0);
          return '<tr>' +
            '<td>' + escapeHtml(title) + (vid ? '<div class="text-secondary small"><code>' + escapeHtml(vid) + '</code></div>' : '') + '</td>' +
            '<td class="text-end">' + escapeHtml(sessions) + '</td>' +
            '<td class="text-end">' + escapeHtml(orders) + '</td>' +
            '<td class="text-end">' + revenue + '</td>' +
          '</tr>';
        }
      });
      var tableName = d.tableName || d.tableId || 'Table';
      var unmappedCount = Number(d.unmappedCount) || top.length;
      return '<details class="mb-2">' +
        '<summary class="fw-semibold">' + escapeHtml(tableName) + ' \u00b7 ' + escapeHtml(String(unmappedCount)) + ' unmapped</summary>' +
        '<div class="mt-2">' + tableHtml + '</div>' +
      '</details>';
    }

    var topUnmappedHtml = diagnostics
      .map(function (d) { return renderTopUnmappedBySessions(d); })
      .filter(Boolean)
      .join('');
    if (topUnmappedHtml) {
      topUnmappedHtml = '' +
        '<h4 class="mb-2 mt-4">Top Unmapped (by sessions)</h4>' +
        '<div class="text-secondary small mb-2">These are the highest-session unmapped examples for each table in this range.</div>' +
        topUnmappedHtml;
    }
    return attributionHtml +
      '<h4 class="mb-2">All Variant Totals</h4>' +
      '<div class="mb-3">' + totalsTableHtml + '</div>' +
      '<h4 class="mb-2">Mapped Coverage (Sessions)</h4>' +
      '<div>' + coverageTableHtml + '</div>' +
      '<div class="text-secondary small mt-2">Mapped % uses in-scope sessions only. Mapped+Ignored % can be useful when you intentionally ignore outliers. Resolved In Mapped is a subset of Mapped sessions where multiple rules matched and the system auto-chose the most specific alias.</div>' +
      topUnmappedHtml;
  }

  function openAllStatsModal() {
    var modal = document.getElementById('variants-all-stats-modal');
    var body = document.getElementById('variants-all-stats-body');
    if (!modal || !body) return;
    closeIssuesModal();
    body.innerHTML = buildAllStatsModalHtml(state.lastPayload || {});
    ensureAllStatsModalBackdrop();
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
  }

  function cmpText(a, b, dir) {
    var aa = a == null ? '' : String(a).toLowerCase();
    var bb = b == null ? '' : String(b).toLowerCase();
    if (aa === bb) return 0;
    if (dir === 'asc') return aa < bb ? -1 : 1;
    return aa < bb ? 1 : -1;
  }

  function cmpNum(a, b, dir) {
    var aa = Number(a);
    var bb = Number(b);
    var av = Number.isFinite(aa) ? aa : null;
    var bv = Number.isFinite(bb) ? bb : null;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return 0;
    return dir === 'asc' ? (av - bv) : (bv - av);
  }

  function clampPage(page, totalPages) {
    var n = Number(page);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(Math.max(1, Math.trunc(n)), Math.max(1, Math.trunc(totalPages || 1)));
  }

  function buildPagination(page, totalPages) {
    try {
      if (typeof window.__kexoBuildPaginationHtml === 'function') {
        return window.__kexoBuildPaginationHtml(page, totalPages);
      }
    } catch (_) {}
    return '';
  }

  function updateSortHeaders(tableId, sortBy, sortDir) {
    var root = document.getElementById(tableId);
    if (!root) return;
    root.querySelectorAll('.grid-cell.sortable').forEach(function (th) {
      var col = (th.getAttribute('data-sort') || '').trim();
      var active = col === sortBy;
      th.classList.remove('th-sort-asc', 'th-sort-desc');
      th.setAttribute('aria-sort', active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
      if (active) th.classList.add(sortDir === 'asc' ? 'th-sort-asc' : 'th-sort-desc');
    });
  }

  function renderTableRows(tableState) {
    var safeId = tableState.safeId;
    var tableId = 'variants-table-' + safeId;
    var bodyId = 'variants-body-' + safeId;
    var paginationId = 'variants-pagination-' + safeId;
    var body = document.getElementById(bodyId);
    var paginationWrap = document.getElementById(paginationId);
    if (!body) return;

    var rows = Array.isArray(tableState.rows) ? tableState.rows.slice() : [];
    var sortBy = tableState.sortBy || 'rev';
    var sortDir = tableState.sortDir === 'asc' ? 'asc' : 'desc';
    rows.sort(function (a, b) {
      if (sortBy === 'variant') return cmpText(a && a.variant, b && b.variant, sortDir);
      if (sortBy === 'sessions') return cmpNum(a && a.sessions, b && b.sessions, sortDir) || cmpNum(a && a.revenue, b && b.revenue, 'desc');
      if (sortBy === 'orders') return cmpNum(a && a.orders, b && b.orders, sortDir) || cmpNum(a && a.revenue, b && b.revenue, 'desc');
      if (sortBy === 'cr') return cmpNum(a && a.cr, b && b.cr, sortDir) || cmpNum(a && a.orders, b && b.orders, 'desc');
      return cmpNum(a && a.revenue, b && b.revenue, sortDir) || cmpNum(a && a.orders, b && b.orders, 'desc');
    });

    if (!rows.length) {
      body.innerHTML = '<div class="grid-row" role="row"><div class="grid-cell empty span-all" role="cell">No mapped data in this range</div></div>';
      if (paginationWrap) {
        paginationWrap.classList.add('is-hidden');
        paginationWrap.innerHTML = '';
      }
      updateSortHeaders(tableId, sortBy, sortDir);
      return;
    }

    var pageSize = rowsPerPageForTable(tableId);
    var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    tableState.page = clampPage(tableState.page || 1, totalPages);
    var start = (tableState.page - 1) * pageSize;
    var pageRows = rows.slice(start, start + pageSize);

    body.innerHTML = pageRows.map(function (row) {
      return '' +
        '<div class="grid-row" role="row">' +
          '<div class="grid-cell bs-product-col" role="cell"><div class="product-cell"><span class="bs-name" title="' + escapeHtml(row.variant || '—') + '">' + escapeHtml(row.variant || '—') + '</span></div></div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatInt(row.sessions)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatInt(row.orders)) + '</div>' +
          '<div class="grid-cell" role="cell">' + escapeHtml(formatPct(row.cr)) + '</div>' +
          '<div class="grid-cell" role="cell">' + formatMoney(row.revenue) + '</div>' +
        '</div>';
    }).join('');

    if (paginationWrap) {
      if (totalPages > 1) {
        paginationWrap.classList.remove('is-hidden');
        paginationWrap.innerHTML = buildPagination(tableState.page, totalPages);
      } else {
        paginationWrap.classList.add('is-hidden');
        paginationWrap.innerHTML = '';
      }
    }
    updateSortHeaders(tableId, sortBy, sortDir);
  }

  function bindTableInteractions(tableState) {
    var safeId = tableState.safeId;
    var tableId = 'variants-table-' + safeId;
    var paginationId = 'variants-pagination-' + safeId;
    var tableEl = document.getElementById(tableId);
    var paginationEl = document.getElementById(paginationId);
    if (!tableEl || tableEl.getAttribute('data-variants-bound') === '1') return;

    tableEl.setAttribute('data-variants-bound', '1');
    tableEl.querySelectorAll('.grid-cell.sortable').forEach(function (th) {
      function activate() {
        var col = (th.getAttribute('data-sort') || '').trim().toLowerCase();
        if (!col) return;
        if (tableState.sortBy === col) {
          tableState.sortDir = tableState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          tableState.sortBy = col;
          tableState.sortDir = col === 'variant' ? 'asc' : 'desc';
        }
        tableState.page = 1;
        renderTableRows(tableState);
      }
      th.addEventListener('click', function (e) {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        activate();
      });
      th.addEventListener('keydown', function (e) {
        if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        activate();
      });
    });

    if (paginationEl && paginationEl.getAttribute('data-variants-bound') !== '1') {
      paginationEl.setAttribute('data-variants-bound', '1');
      paginationEl.addEventListener('click', function (e) {
        var link = e && e.target && e.target.closest ? e.target.closest('a[data-page]') : null;
        if (!link) return;
        e.preventDefault();
        if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
        var next = parseInt(String(link.getAttribute('data-page') || ''), 10);
        if (!Number.isFinite(next) || next < 1) return;
        tableState.page = next;
        renderTableRows(tableState);
      });
    }
  }

  function renderAllTables(payload) {
    var root = document.getElementById('variants-tables-row');
    if (!root) return;
    closeIssuesModal();
    state.lastPayload = payload && typeof payload === 'object' ? payload : { tables: [], diagnostics: [], attribution: null };
    var tables = payload && Array.isArray(payload.tables) ? payload.tables : [];
    if (!tables.length) {
      root.innerHTML = '' +
        '<div class="stats-card card" data-no-card-collapse="1">' +
          '<div class="card-header"><h3 class="card-title">Variants</h3></div>' +
          '<div class="card-body text-secondary">' +
            '<div>No enabled variant tables. Open Settings → Insights → Variants to configure tables.</div>' +
            '<a class="btn btn-sm btn-primary text-white mt-3" href="/settings?tab=insights">Configure variants</a>' +
          '</div>' +
        '</div>';
      dismissGlobalPageLoader();
      try { window.dispatchEvent(new CustomEvent('kexo:table-rows-changed')); } catch (_) {}
      return;
    }

    var diagById = {};
    var diagnostics = payload && Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
    diagnostics.forEach(function (d) {
      var id = d && d.tableId ? String(d.tableId).trim().toLowerCase() : '';
      if (!id) return;
      diagById[id] = d;
    });

    state.tables = tables.map(function (t) {
      var safeId = String(t && t.id ? t.id : '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
      var tableId = t && t.id ? String(t.id).trim().toLowerCase() : '';
      return {
        id: t.id,
        safeId: safeId,
        name: t.name || t.id || 'Variant Table',
        icon: t && t.icon ? String(t.icon) : '',
        rows: Array.isArray(t.rows) ? t.rows.slice() : [],
        diagnostics: tableId && diagById[tableId] ? diagById[tableId] : null,
        sortBy: 'rev',
        sortDir: 'desc',
        page: 1,
      };
    });

    root.innerHTML = state.tables.map(function (t) { return buildTableCard(t); }).join('');
    state.tables.forEach(function (t) {
      bindTableInteractions(t);
      renderTableRows(t);
    });
    dismissGlobalPageLoader();
    try { window.dispatchEvent(new CustomEvent('kexo:table-rows-changed')); } catch (_) {}
    try { window.dispatchEvent(new CustomEvent('kexo:variant-cards-rendered')); } catch (_) {}
  }

  function setLoadingUi(on) {
    var note = document.getElementById('variants-loading-note');
    if (!note) return;
    note.textContent = on ? 'Loading variant tables…' : 'Ready';
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = Number(timeoutMs);
    var timeout = Number.isFinite(ms) && ms > 0 ? Math.trunc(ms) : 25000;
    if (typeof AbortController === 'undefined') {
      return Promise.race([
        fetch(url, options || {}),
        new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('Request timed out')); }, timeout);
        }),
      ]);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () {
      try { controller.abort(); } catch (_) {}
    }, timeout);
    var opts = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  function persistIgnoreEntry(tableId, variantTitle) {
    var tableKey = String(tableId || '').trim().toLowerCase();
    var titleKey = normalizeIgnoredTitle(variantTitle);
    if (!tableKey || !titleKey) return Promise.resolve(false);
    if (state.ignoreSaving) return Promise.resolve(false);
    state.ignoreSaving = true;
    setIssuesStatus('Saving ignore entry...', false);

    return fetchWithTimeout((API || '') + '/api/settings', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        insightsVariantsIgnore: {
          tableId: tableKey,
          variantTitle: variantTitle,
        },
      }),
    }, 30000)
      .then(readJsonSafeResponse)
      .then(function (result) {
        var response = result && result.response ? result.response : null;
        var data = result ? result.json : null;
        if (!response || !response.ok || !data || !data.ok) {
          var msg = data && (data.message || data.error) ? String(data.message || data.error) : 'Ignore save failed';
          throw new Error(msg);
        }
        return refreshVariants({ force: true }).then(function () {
          var tableState = state.tables.find(function (t) {
            return t && String(t.id || '').trim().toLowerCase() === tableKey;
          });
          if (!tableState) {
            closeIssuesModal();
            return true;
          }
          openIssuesModal(tableState);
          setIssuesStatus('Ignored and refreshed.', false);
          return true;
        });
      })
      .catch(function (err) {
        try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'variants.ignoreSave', page: 'variants' }); } catch (_) {}
        setIssuesStatus(err && err.message ? String(err.message) : 'Ignore save failed', true);
        return false;
      })
      .finally(function () {
        state.ignoreSaving = false;
      });
  }

  function fetchShopFallback() {
    return fetch((API || '') + '/api/store-base-url', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var shop = data && data.shopForSales ? String(data.shopForSales).trim().toLowerCase() : '';
        return shop;
      })
      .catch(function () { return ''; });
  }

  function refreshVariants(options) {
    var opts = options && typeof options === 'object' ? options : {};
    var force = !!opts.force;
    if (state.loading) return Promise.resolve(null);
    state.loading = true;
    setLoadingUi(true);

    var ensureShop = state.shop
      ? Promise.resolve(state.shop)
      : Promise.resolve(getShopFromQuery() || '').then(function (shop) {
        if (shop) return shop;
        return fetchShopFallback();
      });

    return ensureShop
      .then(function (shop) {
        state.shop = shop || '';
        if (!state.shop || !/\.myshopify\.com$/i.test(state.shop)) {
          renderAllTables({ tables: [] });
          return null;
        }
        var url = (API || '') + '/api/insights-variants?shop=' + encodeURIComponent(state.shop) +
          '&range=' + encodeURIComponent(getRangeKey());
        if (force) url += '&_=' + Date.now();
        return fetchWithTimeout(url, { credentials: 'same-origin', cache: force ? 'no-store' : 'default' }, 30000)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            renderAllTables(data || { tables: [] });
            state.loaded = true;
            return data;
          });
      })
      .catch(function (err) {
        try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'variants.fetch', page: 'variants' }); } catch (_) {}
        renderAllTables({ tables: [] });
        return null;
      })
      .finally(function () {
        state.loading = false;
        dismissGlobalPageLoader();
      });
  }

  function bindGlobalListeners() {
    var root = document.getElementById('variants-tables-row');
    if (root && root.getAttribute('data-variants-issues-bound') !== '1') {
      root.setAttribute('data-variants-issues-bound', '1');
      root.addEventListener('click', function (e) {
        var btn = e && e.target && e.target.closest ? e.target.closest('.variants-issues-trigger[data-table-safe-id]') : null;
        if (!btn) return;
        var safeId = btn.getAttribute('data-table-safe-id') || '';
        if (!safeId) return;
        var tableState = state.tables.find(function (t) { return t && t.safeId === safeId; });
        if (!tableState) return;
        openIssuesModal(tableState);
      });
    }

    var modal = document.getElementById('variants-issues-modal');
    if (modal && modal.getAttribute('data-variants-modal-bound') !== '1') {
      modal.setAttribute('data-variants-modal-bound', '1');
      modal.addEventListener('click', function (e) {
        if (!e || !e.target) return;
        var ignoreBtn = e.target.closest ? e.target.closest('.variants-ignore-link[data-ignore-table-id][data-ignore-title]') : null;
        if (ignoreBtn) {
          e.preventDefault();
          var tableId = ignoreBtn.getAttribute('data-ignore-table-id') || '';
          var title = ignoreBtn.getAttribute('data-ignore-title') || '';
          persistIgnoreEntry(tableId, title);
          return;
        }
        if (e.target === modal) closeIssuesModal();
        var closeBtn = e.target.closest ? e.target.closest('[data-close-variants-issues]') : null;
        if (closeBtn) closeIssuesModal();
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!modal.classList.contains('show')) return;
        closeIssuesModal();
      });
    }

    var allStatsBtn = document.getElementById('variants-all-stats-btn');
    if (allStatsBtn && allStatsBtn.getAttribute('data-variants-bound') !== '1') {
      allStatsBtn.setAttribute('data-variants-bound', '1');
      allStatsBtn.addEventListener('click', function () {
        openAllStatsModal();
      });
    }

    var allStatsModal = document.getElementById('variants-all-stats-modal');
    if (allStatsModal && allStatsModal.getAttribute('data-variants-modal-bound') !== '1') {
      allStatsModal.setAttribute('data-variants-modal-bound', '1');
      allStatsModal.addEventListener('click', function (e) {
        if (!e || !e.target) return;
        if (e.target === allStatsModal) {
          closeAllStatsModal();
          return;
        }
        var closeBtn = e.target.closest ? e.target.closest('[data-close-variants-all-stats]') : null;
        if (closeBtn) closeAllStatsModal();
      });
      document.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Escape') return;
        if (!allStatsModal.classList.contains('show')) return;
        closeAllStatsModal();
      });
    }

    var dateSelect = document.getElementById('global-date-select');
    if (dateSelect && dateSelect.getAttribute('data-variants-bound') !== '1') {
      dateSelect.setAttribute('data-variants-bound', '1');
      dateSelect.addEventListener('change', function () {
        refreshVariants({ force: true });
      });
    }

    var refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn && refreshBtn.getAttribute('data-variants-bound') !== '1') {
      refreshBtn.setAttribute('data-variants-bound', '1');
      refreshBtn.addEventListener('click', function () {
        setTimeout(function () { refreshVariants({ force: true }); }, 0);
      });
    }

    window.addEventListener('kexo:table-rows-changed', function (evt) {
      var detail = evt && evt.detail ? evt.detail : null;
      var tableId = detail && detail.tableId ? String(detail.tableId) : '';
      if (!tableId || tableId.indexOf('variants-table-') !== 0) return;
      var safeId = tableId.replace(/^variants-table-/, '');
      var tableState = state.tables.find(function (t) { return t && t.safeId === safeId; });
      if (!tableState) return;
      tableState.page = 1;
      renderTableRows(tableState);
    });
  }

  function init() {
    try { window.__refreshVariantsInsights = refreshVariants; } catch (_) {}
    dismissGlobalPageLoader();
    bindGlobalListeners();
    refreshVariants({ force: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
