(function () {
  'use strict';

  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('tools', { page: 'tools', tool: 'change-pins' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('tools', 'init', { tool: 'change-pins' }); } catch (_) {}

  // Keep consistent with app.js defaults.
  const tz = 'Europe/London';

  function qs(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeStr(v) { return String(v == null ? '' : v).trim(); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function isHm(s) { return /^(\d{2}):(\d{2})$/.test(String(s || '')); }

  function fmtNum(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try { return x.toLocaleString('en-GB'); } catch (_) { return String(x); }
  }
  function fmtMoney(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try { return (typeof window.formatRevenue === 'function') ? window.formatRevenue(x) : ('£' + x.toFixed(2)); } catch (_) { return '£' + x.toFixed(2); }
  }
  function fmtPct(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(1) + '%';
  }
  function fmtRatioDelta(r) {
    var x = r == null ? null : Number(r);
    if (x == null || !Number.isFinite(x)) return '—';
    var pct = x * 100;
    var sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(1) + '%';
  }
  function stripDeltaGlyphs(text) {
    return String(text == null ? '' : text)
      .replace(/[▲▼△▽▴▾▵▿↑↓⬆⬇]/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function dateFromMs(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n)) return null;
    return new Date(n);
  }
  function ymdInTzFromMs(ms) {
    var d = dateFromMs(ms);
    if (!d) return '';
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); } catch (_) { return ''; }
  }
  function hmInTzFromMs(ms) {
    var d = dateFromMs(ms);
    if (!d) return '';
    try { return d.toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }); } catch (_) { return ''; }
  }
  function dmyInTzFromMs(ms) {
    var d = dateFromMs(ms);
    if (!d) return '';
    try { return d.toLocaleDateString('en-GB', { timeZone: tz }); } catch (_) { return ''; }
  }
  function dmyFromYmd(ymd) {
    var s = String(ymd || '');
    if (!isYmd(s)) return '';
    var parts = s.split('-');
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function attachFlatpickr(el, onValue) {
    if (!el) return null;
    if (typeof flatpickr === 'undefined') return null;
    try {
      var fp = flatpickr(el, {
        dateFormat: 'Y-m-d',
        allowInput: true,
        clickOpens: true,
        disableMobile: true,
        onReady: function (_selectedDates, _dateStr, instance) {
          try { if (instance && instance.calendarContainer) instance.calendarContainer.classList.add('kexo-flatpickr-single'); } catch (_) {}
        },
        onChange: function (_selectedDates, dateStr) {
          try { if (typeof onValue === 'function') onValue(String(dateStr || '')); } catch (_) {}
        },
      });
      el.addEventListener('click', function () { try { fp.open(); } catch (_) {} });
      return fp;
    } catch (_) {
      return null;
    }
  }

  function fetchJson(path, opts) {
    return fetch(path, opts || { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
      .catch(function (err) {
        try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'tools.changePins.fetch', path: path }); } catch (_) {}
        return null;
      });
  }

  var state = {
    pins: [],
    selected: null,
    effect: null,
    view: 'list', // list | detail
    detailSubview: 'stats', // stats | edit (when view === detail)
    loading: false,
  };

  var els = {
    gridWrap: qs('#tool-change-pins-grid'),
    // create
    date: qs('#pin-date'),
    time: qs('#pin-time'),
    dateNote: qs('#pin-date-note'),
    title: qs('#pin-title'),
    kind: qs('#pin-kind'),
    magVal: qs('#pin-mag-val'),
    magUnit: qs('#pin-mag-unit'),
    tags: qs('#pin-tags'),
    notes: qs('#pin-notes'),
    saveBtn: qs('#pin-save-btn'),
    saveNote: qs('#pin-save-note'),
    // list
    filterFrom: qs('#filter-from'),
    filterTo: qs('#filter-to'),
    filterQ: qs('#filter-q'),
    filterKind: qs('#filter-kind'),
    filterArchived: qs('#filter-archived'),
    filterRefresh: qs('#filter-refresh'),
    pinsNote: qs('#pins-note'),
    pinsTable: qs('#pins-table'),
    // detail
    detailCard: qs('#tool-change-pins-detail'),
    detailBack: qs('#pin-detail-back'),
    detailTitle: qs('#pin-detail-title'),
    detailStatsView: qs('#detail-stats-view'),
    detailEditView: qs('#detail-edit-view'),
    editBtn: qs('#pin-edit-btn'),
    editDate: qs('#edit-date'),
    editTime: qs('#edit-time'),
    editDateNote: qs('#edit-date-note'),
    editTitle: qs('#edit-title'),
    editKind: qs('#edit-kind'),
    editMagVal: qs('#edit-mag-val'),
    editMagUnit: qs('#edit-mag-unit'),
    editTags: qs('#edit-tags'),
    editNotes: qs('#edit-notes'),
    updateBtn: qs('#pin-update-btn'),
    archiveBtn: qs('#pin-archive-btn'),
    unarchiveBtn: qs('#pin-unarchive-btn'),
    // effect (stats + edit each have a results div)
    effectPreset: qs('#effect-preset'),
    effectCustomDaysWrap: qs('#effect-custom-days-wrap'),
    effectCustomDays: qs('#effect-custom-days'),
    effectRefresh: qs('#effect-refresh'),
    effectNote: qs('#effect-note'),
    effectResultsStats: qs('#effect-results-stats'),
    effectResultsEdit: qs('#effect-results-edit'),
    compareTip: qs('#effect-compare-tip'),
    filtersToggle: qs('#pins-filters-toggle'),
    filtersRow: qs('#pins-filters-row'),
  };

  function refreshIconTheme() {
    try {
      window.dispatchEvent(new CustomEvent('kexo:icon-theme-changed'));
      if (window.KexoIconTheme && typeof window.KexoIconTheme.refresh === 'function') window.KexoIconTheme.refresh();
    } catch (_) {}
  }

  function setCollapseChevron(iconEl, collapsed) {
    if (!iconEl || !iconEl.setAttribute) return;
    var isCollapsed = !!collapsed;
    var glyph = isCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
    var key = isCollapsed ? 'card-collapse-collapsed' : 'card-collapse-expanded';
    iconEl.setAttribute('data-icon-key', key);
    iconEl.className = 'kexo-card-collapse-chevron fa-light ' + glyph;
    refreshIconTheme();
  }

  function setCardCollapsed(card, collapsed) {
    if (!card || !card.classList) return;
    var isCollapsed = !!collapsed;
    card.classList.toggle('kexo-card-collapsed', isCollapsed);
    var btn = null;
    try { btn = card.querySelector('[data-tools-collapse-toggle="1"]'); } catch (_) { btn = null; }
    if (btn) {
      btn.classList.toggle('is-collapsed', isCollapsed);
      btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', isCollapsed ? 'Expand section' : 'Collapse section');
      btn.title = isCollapsed ? 'Expand section' : 'Collapse section';
      try {
        var icon = btn.querySelector('.kexo-card-collapse-chevron');
        setCollapseChevron(icon, isCollapsed);
      } catch (_) {}
    }
  }

  function bindToolsCollapsibles() {
    try {
      document.querySelectorAll('.tools-card[data-tools-collapsible="1"]').forEach(function (card) {
        if (!card || card.getAttribute('data-tools-collapsible-bound') === '1') return;
        card.setAttribute('data-tools-collapsible-bound', '1');
        var header = null;
        try { header = card.querySelector(':scope > .card-header'); } catch (_) { header = null; }
        if (!header) return;

        function shouldIgnoreTarget(t) {
          if (!t || !t.closest) return false;
          return !!t.closest('a,button,input,select,textarea,label,[role="button"],[data-no-card-collapse]');
        }

        header.addEventListener('click', function (e) {
          var target = e && e.target ? e.target : null;
          if (shouldIgnoreTarget(target)) return;
          e.preventDefault();
          setCardCollapsed(card, !card.classList.contains('kexo-card-collapsed'));
        });

        var btn = card.querySelector('[data-tools-collapse-toggle="1"]');
        if (btn && btn.getAttribute('data-tools-collapse-bound') !== '1') {
          btn.setAttribute('data-tools-collapse-bound', '1');
          btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            setCardCollapsed(card, !card.classList.contains('kexo-card-collapsed'));
          });
        }
      });
    } catch (_) {}
  }

  function bindPinsFiltersToggle() {
    var btn = els.filtersToggle;
    var row = els.filtersRow;
    if (!btn || !row) return;
    if (btn.getAttribute('data-filters-bound') === '1') return;
    btn.setAttribute('data-filters-bound', '1');
    function setOpen(open) {
      row.classList.toggle('is-hidden', !open);
      btn.textContent = open ? 'Hide filters' : 'Show filters';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    setOpen(false);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      setOpen(row.classList.contains('is-hidden'));
    });
  }

  function ensureTooltip(el) {
    if (!el) return null;
    try {
      if (window.bootstrap && window.bootstrap.Tooltip) {
        return window.bootstrap.Tooltip.getOrCreateInstance(el, { html: true, container: document.body, trigger: 'hover focus' });
      }
    } catch (_) {}
    return null;
  }

  function setCompareTooltipHtml(html) {
    var el = els.compareTip;
    if (!el) return;
    var text = '';
    try {
      if (html && typeof html === 'string') {
        var div = document.createElement('div');
        div.innerHTML = html;
        text = (div.textContent || div.innerText || '').trim();
      }
      el.setAttribute('title', text);
    } catch (_) {}
  }

  function toFiniteNumber(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function fmtPp(deltaPctPoints) {
    var n = toFiniteNumber(deltaPctPoints);
    if (n == null) return '—';
    var sign = n > 0 ? '+' : (n < 0 ? '−' : '');
    return sign + Math.abs(n).toFixed(1) + 'pp';
  }

  function buildConclusion(payload) {
    var before = payload && payload.before ? payload.before : {};
    var after = payload && payload.after ? payload.after : {};
    var d = payload && payload.delta ? payload.delta : {};
    var bSessions = toFiniteNumber(before.sessions);
    var aSessions = toFiniteNumber(after.sessions);
    var bOrders = toFiniteNumber(before.orders);
    var aOrders = toFiniteNumber(after.orders);
    var hasSessions = bSessions != null && aSessions != null;
    var hasOrders = bOrders != null && aOrders != null;
    var enough = true;
    if (!hasSessions && !hasOrders) enough = false;
    if (hasSessions && (bSessions < 100 || aSessions < 100)) enough = false;
    if (hasOrders && (bOrders < 5 || aOrders < 5)) enough = false;
    if (!enough) return 'Conclusion: Not enough data';

    var revAbs = toFiniteNumber(d && d.revenue && d.revenue.abs);
    var revPct = toFiniteNumber(d && d.revenue && d.revenue.pct);
    var ordAbs = toFiniteNumber(d && d.orders && d.orders.abs);
    var ordPct = toFiniteNumber(d && d.orders && d.orders.pct);
    var sesAbs = toFiniteNumber(d && d.sessions && d.sessions.abs);
    var sesPct = toFiniteNumber(d && d.sessions && d.sessions.pct);
    var convAbs = toFiniteNumber(d && d.conversion && d.conversion.abs);
    var convPct = toFiniteNumber(d && d.conversion && d.conversion.pct);
    var aovAbs = toFiniteNumber(d && d.aov && d.aov.abs);
    var roasAbs = toFiniteNumber(d && d.roas && d.roas.abs);

    function pickTone() {
      if (revAbs != null && revAbs !== 0) return revAbs > 0 ? 'positive' : 'negative';
      if (ordAbs != null && ordAbs !== 0) return ordAbs > 0 ? 'positive' : 'negative';
      if (convAbs != null && convAbs !== 0) return convAbs > 0 ? 'positive' : 'negative';
      return 'mixed';
    }
    var tone = pickTone();

    function metricReasonParts() {
      var parts = [];
      if (revAbs != null && revAbs !== 0) parts.push('Revenue ' + (revAbs > 0 ? 'up' : 'down') + ' ' + stripDeltaGlyphs(fmtMoney(revAbs)) + (revPct != null ? (' (' + stripDeltaGlyphs(fmtRatioDelta(revPct)) + ')') : ''));
      if (ordAbs != null && ordAbs !== 0) parts.push('Orders ' + (ordAbs > 0 ? 'up' : 'down') + ' ' + stripDeltaGlyphs(fmtNum(ordAbs)) + (ordPct != null ? (' (' + stripDeltaGlyphs(fmtRatioDelta(ordPct)) + ')') : ''));
      if (convAbs != null && convAbs !== 0) parts.push('Conversion ' + (convAbs > 0 ? 'up' : 'down') + ' ' + fmtPp(convAbs));
      if (sesAbs != null && sesAbs !== 0) parts.push('Sessions ' + (sesAbs > 0 ? 'up' : 'down') + ' ' + stripDeltaGlyphs(fmtNum(sesAbs)) + (sesPct != null ? (' (' + stripDeltaGlyphs(fmtRatioDelta(sesPct)) + ')') : ''));
      if (aovAbs != null && aovAbs !== 0) parts.push('AOV ' + (aovAbs > 0 ? 'up' : 'down') + ' ' + stripDeltaGlyphs(fmtMoney(aovAbs)));
      if (roasAbs != null && roasAbs !== 0) parts.push('ROAS ' + (roasAbs > 0 ? 'up' : 'down') + ' ' + stripDeltaGlyphs(String(roasAbs.toFixed(2))) + 'x');
      return parts;
    }

    var parts = metricReasonParts();
    // Keep the conclusion short: pick up to 3 strongest signals (revenue/orders/conversion/sessions).
    var ordered = [];
    ['Revenue', 'Orders', 'Conversion', 'Sessions', 'AOV', 'ROAS'].forEach(function (key) {
      var hit = parts.find(function (p) { return p.indexOf(key + ' ') === 0; });
      if (hit) ordered.push(hit);
    });
    var why = ordered.slice(0, 3).join('. ');
    if (!why) why = 'No meaningful change detected in the selected window.';

    if (tone === 'positive') return 'Conclusion: Positive. ' + why;
    if (tone === 'negative') return 'Conclusion: Negative. ' + why;
    return 'Conclusion: Mixed. ' + why;
  }

  function clampInt(v, fallback, min, max) {
    var n = parseInt(String(v), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function hmToMinutes(hm) {
    var s = String(hm || '').trim();
    var m = s.match(/^(\d{2}):(\d{2})$/);
    if (!m) return null;
    var hh = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return (hh * 60) + mm;
  }

  function pinEventHmInTz(pin) {
    try {
      if (pin && pin.event_ts) return hmInTzFromMs(pin.event_ts);
    } catch (_) {}
    return '';
  }

  function isTodayPresetAllowedForPin(pin) {
    // If pin time-of-day is known and occurs after current time-of-day, Today is not comparable yet.
    var pinHm = pinEventHmInTz(pin);
    if (!pinHm) return true;
    var nowHm = hmInTzFromMs(Date.now());
    var pinM = hmToMinutes(pinHm);
    var nowM = hmToMinutes(nowHm);
    if (pinM == null || nowM == null) return true;
    return pinM <= nowM;
  }

  function applyCompareUiConstraints() {
    if (!els.effectPreset) return;
    var pin = state.selected;
    var allowToday = isTodayPresetAllowedForPin(pin);
    try {
      var opt = els.effectPreset.querySelector('option[value="today"]');
      if (opt) {
        opt.disabled = !allowToday;
        opt.title = !allowToday
          ? 'Not available yet: this pin time is later than the current time-of-day'
          : '';
      }
    } catch (_) {}
    if (!allowToday && els.effectPreset.value === 'today') {
      els.effectPreset.value = 'yesterday';
    }
  }

  function applyCustomDaysVisibility() {
    if (!els.effectPreset) return;
    var isCustom = String(els.effectPreset.value || '') === 'custom';
    if (els.effectCustomDaysWrap) els.effectCustomDaysWrap.classList.toggle('is-hidden', !isCustom);
    if (isCustom && els.effectCustomDays) {
      var cur = clampInt(els.effectCustomDays.value, 7, 1, 60);
      els.effectCustomDays.value = String(cur);
    }
  }

  function setNote(el, msg, isError) {
    if (!el) return;
    el.textContent = msg || '';
    if (el === els.saveNote || el === els.effectNote || el === els.pinsNote || el === els.dateNote || el === els.editDateNote) {
      el.className = 'tools-note' + (msg ? ' ' + (isError ? 'text-danger' : 'text-muted') : '');
    }
  }

  function updateCreateUi() {
    var ok = isYmd(els.date && els.date.value) && !!safeStr(els.title && els.title.value);
    if (els.saveBtn) els.saveBtn.disabled = !ok;
  }

  function collectCreatePayload() {
    var ymd = safeStr(els.date && els.date.value);
    var hm = safeStr(els.time && els.time.value);
    if (!isHm(hm)) hm = '';
    var title = safeStr(els.title && els.title.value);
    var kind = safeStr(els.kind && els.kind.value);
    var notes = safeStr(els.notes && els.notes.value);
    return {
      event_ymd: ymd,
      event_hm: hm || undefined,
      title: title,
      kind: kind || undefined,
      notes: notes || undefined,
    };
  }

  function clearCreateForm() {
    try { if (els.title) els.title.value = ''; } catch (_) {}
    try { if (els.kind) els.kind.value = ''; } catch (_) {}
    try { if (els.notes) els.notes.value = ''; } catch (_) {}
    updateCreateUi();
  }

  function renderPinsTable(pins) {
    if (!els.pinsTable) return;
    var list = Array.isArray(pins) ? pins : [];
    if (!list.length) {
      els.pinsTable.innerHTML = '' +
        '<div class="text-center py-4">' +
          '<h3 class="mb-1">No Pins Found</h3>' +
          '<div class="text-muted">Future saved pins will display here</div>' +
        '</div>';
      return;
    }
    var html = '';
    html += '<div class="tools-table-wrap">';
    html += '<table class="tools-table table table-sm table-vcenter">';
    html += '<thead><tr>' +
      '<th style="min-width:120px">Date</th>' +
      '<th style="min-width:80px">Time</th>' +
      '<th style="min-width:320px">Title</th>' +
      '<th style="min-width:90px">Kind</th>' +
      '<th style="min-width:90px">Status</th>' +
      '<th class="text-end" style="min-width:110px">View Stats</th>' +
    '</tr></thead><tbody>';
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var id = p.id;
      var ymd = p.event_ymd || '';
      var time = p.event_ts ? hmInTzFromMs(p.event_ts) : '';
      var status = p.archived_at ? 'Archived' : 'Active';
      var isSel = state.selected && state.selected.id === id;
      html += '<tr data-pin-id="' + esc(id) + '" tabindex="0" role="button" aria-label="View stats for pin: ' + esc(p.title || '') + '" style="cursor:pointer;' + (isSel ? 'background:rgba(15,23,42,0.03);' : '') + '">' +
        '<td data-label="Date">' + esc(ymd) + '</td>' +
        '<td data-label="Time">' + esc(time || '') + '</td>' +
        '<td data-label="Title"><strong style="font-weight:600">' + esc(p.title || '') + '</strong></td>' +
        '<td data-label="Kind">' + esc(p.kind || '') + '</td>' +
        '<td data-label="Status">' + esc(status) + '</td>' +
        '<td class="text-end" data-label="View Stats"><button class="btn btn-sm btn-ghost-secondary" type="button" data-pin-action="view" data-pin-id="' + esc(id) + '">View Stats</button></td>' +
      '</tr>';
    }
    html += '</tbody></table></div>';
    els.pinsTable.innerHTML = html;
  }

  function currentFilters() {
    return {
      from_ymd: safeStr(els.filterFrom && els.filterFrom.value) || undefined,
      to_ymd: safeStr(els.filterTo && els.filterTo.value) || undefined,
      q: safeStr(els.filterQ && els.filterQ.value) || undefined,
      kind: safeStr(els.filterKind && els.filterKind.value) || undefined,
      include_archived: (els.filterArchived && els.filterArchived.checked) ? '1' : undefined,
    };
  }

  function buildListUrl() {
    var f = currentFilters();
    var p = [];
    if (f.from_ymd && isYmd(f.from_ymd)) p.push('from_ymd=' + encodeURIComponent(f.from_ymd));
    if (f.to_ymd && isYmd(f.to_ymd)) p.push('to_ymd=' + encodeURIComponent(f.to_ymd));
    if (f.q) p.push('q=' + encodeURIComponent(f.q));
    if (f.kind) p.push('kind=' + encodeURIComponent(f.kind));
    if (f.include_archived) p.push('include_archived=1');
    p.push('limit=200');
    return '/api/tools/change-pins' + (p.length ? ('?' + p.join('&')) : '');
  }

  function loadPins() {
    if (state.loading) return;
    state.loading = true;
    setNote(els.pinsNote, 'Loading…', false);
    fetchJson(buildListUrl(), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (data) {
        if (!data || !data.ok) {
          state.pins = [];
          setNote(els.pinsNote, 'Failed to load pins.', true);
          renderPinsTable([]);
          return;
        }
        state.pins = Array.isArray(data.pins) ? data.pins : [];
        setNote(els.pinsNote, state.pins.length ? ('Loaded ' + state.pins.length + ' pins.') : 'No pins found.', false);
        // Keep selected if it still exists
        if (state.selected) {
          var again = state.pins.find(function (p) { return p && p.id === state.selected.id; });
          if (again) state.selected = again;
          else state.selected = null;
        }
        renderPinsTable(state.pins);
        var showDetail = state.view === 'detail' && !!state.selected;
        if (!showDetail) state.view = 'list';
        applyView();
        if (showDetail) renderSelectedDetail();
      })
      .finally(function () {
        state.loading = false;
      });
  }

  function applyView() {
    var showDetail = state.view === 'detail' && !!state.selected;
    if (!showDetail) state.view = 'list';
    if (els.gridWrap) els.gridWrap.classList.toggle('is-hidden', showDetail);
    if (els.detailCard) els.detailCard.classList.toggle('is-hidden', !showDetail);
    if (showDetail && els.detailCard) {
      try { setCardCollapsed(els.detailCard, false); } catch (_) {}
    }
    if (!showDetail) {
      if (els.effectResultsStats) els.effectResultsStats.innerHTML = '';
      if (els.effectResultsEdit) els.effectResultsEdit.innerHTML = '';
    } else {
      applyDetailSubview();
    }
  }

  function applyDetailSubview() {
    var showEdit = state.detailSubview === 'edit';
    if (els.detailStatsView) els.detailStatsView.classList.toggle('is-hidden', showEdit);
    if (els.detailEditView) els.detailEditView.classList.toggle('is-hidden', !showEdit);
  }

  function hideDetail() {
    state.view = 'list';
    applyView();
  }

  function selectPin(pin) {
    state.selected = pin;
    state.view = 'detail';
    state.detailSubview = 'stats';
    renderPinsTable(state.pins);
    applyView();
    renderSelectedDetail();
    applyCompareUiConstraints();
    applyCustomDaysVisibility();
    refreshEffect();
  }

  function selectPinById(id) {
    var pinId = String(id || '').trim();
    if (!pinId) return;
    var pin = state.pins.find(function (x) { return String(x && x.id) === pinId; });
    if (pin) selectPin(pin);
  }

  function backToList() {
    state.view = 'list';
    applyView();
  }

  function setDetailArchivedUi(pin) {
    var isArchived = !!(pin && pin.archived_at);
    if (els.archiveBtn) els.archiveBtn.classList.toggle('is-hidden', isArchived);
    if (els.unarchiveBtn) els.unarchiveBtn.classList.toggle('is-hidden', !isArchived);
  }

  function renderSelectedDetail() {
    var pin = state.selected;
    if (!pin || !els.detailCard) { hideDetail(); return; }
    setDetailArchivedUi(pin);

    if (els.detailTitle) els.detailTitle.textContent = pin.title || '';

    try { if (els.editDate) els.editDate.value = pin.event_ymd || ''; } catch (_) {}
    try { if (els.editTime) els.editTime.value = pin.event_ts ? hmInTzFromMs(pin.event_ts) : ''; } catch (_) {}
    try { if (els.editTitle) els.editTitle.value = pin.title || ''; } catch (_) {}
    try { if (els.editKind) els.editKind.value = pin.kind || ''; } catch (_) {}
    try { if (els.editNotes) els.editNotes.value = pin.notes || ''; } catch (_) {}

    applyDetailSubview();
  }

  function collectEditPatch() {
    var ymd = safeStr(els.editDate && els.editDate.value);
    var hm = safeStr(els.editTime && els.editTime.value);
    if (!isHm(hm)) hm = '';
    var title = safeStr(els.editTitle && els.editTitle.value);
    var kind = safeStr(els.editKind && els.editKind.value);
    var notes = safeStr(els.editNotes && els.editNotes.value);
    return {
      event_ymd: ymd,
      event_hm: hm || undefined,
      title: title,
      kind: kind || undefined,
      notes: notes || '',
    };
  }

  function refreshEffect() {
    if (!state.selected) return;
    var pinId = state.selected.id;
    var preset = els.effectPreset ? safeStr(els.effectPreset.value) : '7';
    var params = [];
    if (preset === 'today') {
      params.push('preset=today');
    } else if (preset === 'yesterday') {
      params.push('preset=yesterday');
    } else if (preset === 'custom') {
      var d = clampInt(els.effectCustomDays ? els.effectCustomDays.value : '', 7, 1, 60);
      params.push('preset=window');
      params.push('window_days=' + encodeURIComponent(String(d)));
    } else {
      var win = clampInt(preset, 7, 1, 60);
      params.push('preset=window');
      params.push('window_days=' + encodeURIComponent(String(win)));
    }
    setNote(els.effectNote, 'Loading…', false);
    if (els.effectResultsStats) els.effectResultsStats.innerHTML = '';
    if (els.effectResultsEdit) els.effectResultsEdit.innerHTML = '';
    fetchJson('/api/tools/change-pins/' + encodeURIComponent(String(pinId)) + '/effect' + (params.length ? ('?' + params.join('&')) : ''), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (data) {
        if (!data || !data.ok) {
          setNote(els.effectNote, 'Failed to load effect.', true);
          if (els.effectResultsStats) els.effectResultsStats.innerHTML = '';
          if (els.effectResultsEdit) els.effectResultsEdit.innerHTML = '';
          return;
        }
        setNote(els.effectNote, '', false);
        state.effect = data;
        renderEffect(data);
      });
  }

  function renderEffect(payload) {
    if (!els.effectResultsStats && !els.effectResultsEdit) return;
    var before = payload.before || {};
    var after = payload.after || {};
    var d = payload.delta || {};
    function metric(label, beforeVal, afterVal, deltaAbs, deltaPct, fmt) {
      var f = fmt || function (x) { return x == null ? '—' : String(x); };
      var absN = (deltaAbs != null && Number.isFinite(Number(deltaAbs))) ? Number(deltaAbs) : null;
      var absTxtRaw = absN != null ? (absN > 0 ? '+' : '') + (fmt === fmtMoney ? fmtMoney(absN) : fmt(absN)) : '—';
      var pctTxtRaw = fmtRatioDelta(deltaPct);
      var absTxt = stripDeltaGlyphs(absTxtRaw);
      var pctTxt = stripDeltaGlyphs(pctTxtRaw);
      var deltaClass = absN == null ? 'tools-delta-neutral' : (absN > 0 ? 'tools-delta-pos' : (absN < 0 ? 'tools-delta-neg' : 'tools-delta-neutral'));
      var hasBefore = beforeVal != null && beforeVal !== '' && String(beforeVal).trim() !== '' && String(beforeVal).trim() !== '0.0%';
      var hasDelta = absN != null || (deltaPct != null && Number.isFinite(Number(deltaPct)));
      var beforeLine = (!hasBefore && !hasDelta) ? 'No data for compared time' : ('<span class="tools-ba-label">Before:</span> <span class="tools-ba-value">' + esc(f(beforeVal)) + '</span> <span class="' + deltaClass + '">' + esc(absTxt) + '</span> <span class="' + deltaClass + '">(' + esc(pctTxt) + ')</span>');
      return '' +
        '<div class="tools-metric">' +
          '<div class="k">' + esc(label) + '</div>' +
          '<div class="v">' + esc(f(afterVal)) + '</div>' +
          '<div class="tools-note tools-note--tight">' + beforeLine + '</div>' +
        '</div>';
    }

    var html = '';
    function fmtRange(r) {
      if (!r) return '';
      var kind = r.kind != null ? String(r.kind).trim().toLowerCase() : '';
      var a = r.start_ymd != null ? String(r.start_ymd) : '';
      var b = r.end_ymd != null ? String(r.end_ymd) : '';
      var endHm = r.end_hm != null ? String(r.end_hm) : '';
      if (kind === 'partial_day') {
        return a + (endHm ? (' (00:00 → ' + endHm + ')') : '');
      }
      if (kind === 'day') return a || b;
      if (a && b) return a + ' → ' + b;
      return a || b || '';
    }

    var preset = payload && payload.preset != null ? String(payload.preset).trim().toLowerCase() : '';
    var hint = '';
    if (preset === 'today') hint = 'Today compares elapsed time (00:00 → now) vs the pin day (00:00 → same time-of-day).';
    else if (preset === 'yesterday') {
      var pinYmd = payload && payload.pin && payload.pin.event_ymd != null ? String(payload.pin.event_ymd) : '';
      var afterYmd = payload && payload.ranges && payload.ranges.after && payload.ranges.after.start_ymd != null ? String(payload.ranges.after.start_ymd) : '';
      if (pinYmd && afterYmd && pinYmd === afterYmd) {
        hint = 'Pin was added yesterday, so Yesterday compares the day before yesterday vs yesterday.';
      } else {
        hint = 'Yesterday compares the full day of yesterday vs the full day the pin was added.';
      }
    }
    else if (preset === 'window') hint = 'Window compares a fixed number of days before vs after the pin date.';

    var beforeRange = payload.ranges && payload.ranges.before ? fmtRange(payload.ranges.before) : '';
    var afterRange = payload.ranges && payload.ranges.after ? fmtRange(payload.ranges.after) : '';
    var tipHtml = '' +
      (hint ? ('<div><strong>' + esc(hint) + '</strong></div>') : '') +
      '<div>Before: ' + esc(beforeRange) + '</div>' +
      '<div>After: ' + esc(afterRange) + '</div>';
    setCompareTooltipHtml(tipHtml);

    html += '<div class="tools-note tools-note--tight"><strong>' + esc(buildConclusion(payload)) + '</strong></div>';
    html += '<div class="tools-summary">';
    html += metric('Revenue', before.revenue, after.revenue, d.revenue && d.revenue.abs, d.revenue && d.revenue.pct, fmtMoney);
    html += metric('Orders', before.orders, after.orders, d.orders && d.orders.abs, d.orders && d.orders.pct, fmtNum);
    html += metric('Sessions', before.sessions, after.sessions, d.sessions && d.sessions.abs, d.sessions && d.sessions.pct, fmtNum);
    html += metric('Conversion', before.conversion, after.conversion, d.conversion && d.conversion.abs, d.conversion && d.conversion.pct, fmtPct);
    html += '</div>';
    html += '<div class="tools-summary" style="margin-top:10px;grid-template-columns:repeat(2,1fr)">';
    html += metric('AOV', before.aov, after.aov, d.aov && d.aov.abs, d.aov && d.aov.pct, fmtMoney);
    html += metric('ROAS', before.roas, after.roas, d.roas && d.roas.abs, d.roas && d.roas.pct, function (x) {
      var n = x == null ? null : Number(x);
      if (n == null || !Number.isFinite(n)) return '—';
      return n.toFixed(2) + 'x';
    });
    html += '</div>';
    if (els.effectResultsStats) els.effectResultsStats.innerHTML = html;
    if (els.effectResultsEdit) els.effectResultsEdit.innerHTML = html;
  }

  function init() {
    try { bindToolsCollapsibles(); } catch (_) {}
    try { bindPinsFiltersToggle(); } catch (_) {}

    attachFlatpickr(els.date, function () { updateCreateUi(); });
    attachFlatpickr(els.filterFrom, function () {});
    attachFlatpickr(els.filterTo, function () {});
    attachFlatpickr(els.editDate, function () {});

    if (els.time) {
      // Default to current time rounded down to 5 minutes.
      try {
        var now = new Date();
        var mm = Math.floor(now.getMinutes() / 5) * 5;
        var hh = now.getHours();
        els.time.value = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
      } catch (_) {}
    }

    updateCreateUi();
    if (els.title) els.title.addEventListener('input', updateCreateUi);
    if (els.date) els.date.addEventListener('change', updateCreateUi);

    if (els.saveBtn) els.saveBtn.addEventListener('click', function () {
      var payload = collectCreatePayload();
      if (!isYmd(payload.event_ymd) || !payload.title) {
        setNote(els.saveNote, 'Enter an event date and title.', true);
        return;
      }
      els.saveBtn.disabled = true;
      setNote(els.saveNote, 'Saving…', false);
      fetchJson('/api/tools/change-pins', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function (data) {
        if (!data || !data.ok) {
          setNote(els.saveNote, (data && data.error) ? String(data.error) : 'Save failed.', true);
          updateCreateUi();
          return;
        }
        setNote(els.saveNote, 'Saved.', false);
        clearCreateForm();
        loadPins();
        try { if (data.pin) selectPin(data.pin); } catch (_) {}
        setTimeout(function () { setNote(els.saveNote, '', false); }, 1200);
      });
    });

    if (els.filterRefresh) els.filterRefresh.addEventListener('click', function () { loadPins(); });
    if (els.filterQ) els.filterQ.addEventListener('keydown', function (e) { if (e && e.key === 'Enter') loadPins(); });

    if (els.detailBack) els.detailBack.addEventListener('click', function () { backToList(); });

    if (els.editBtn) els.editBtn.addEventListener('click', function () {
      state.detailSubview = 'edit';
      applyDetailSubview();
      if (state.effect) renderEffect(state.effect);
    });

    if (els.effectPreset) {
      els.effectPreset.addEventListener('change', function () {
        applyCustomDaysVisibility();
        applyCompareUiConstraints();
        refreshEffect();
      });
    }
    if (els.effectCustomDays) {
      els.effectCustomDays.addEventListener('change', function () {
        applyCustomDaysVisibility();
        if (els.effectPreset && els.effectPreset.value === 'custom') refreshEffect();
      });
      els.effectCustomDays.addEventListener('keydown', function (e) {
        if (!e || e.key !== 'Enter') return;
        try { e.preventDefault(); } catch (_) {}
        applyCustomDaysVisibility();
        if (els.effectPreset && els.effectPreset.value === 'custom') refreshEffect();
      });
    }
    if (els.effectRefresh) els.effectRefresh.addEventListener('click', function () { refreshEffect(); });

    if (els.pinsTable) {
      els.pinsTable.addEventListener('click', function (e) {
        var t = e && e.target ? e.target : null;
        if (!t || !t.closest) return;
        var actionBtn = t.closest('[data-pin-action="view"]');
        if (actionBtn) {
          try { e.preventDefault(); } catch (_) {}
          try { e.stopPropagation(); } catch (_) {}
          selectPinById(actionBtn.getAttribute('data-pin-id'));
          return;
        }
        var tr = t.closest('tr[data-pin-id]');
        if (tr) selectPinById(tr.getAttribute('data-pin-id'));
      });
      els.pinsTable.addEventListener('keydown', function (e) {
        var key = e && e.key ? String(e.key) : '';
        if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
        var t = e && e.target ? e.target : null;
        if (!t || !t.closest) return;
        if (t.matches && t.matches('button, a, input, select, textarea')) return;
        var tr = t.closest('tr[data-pin-id]');
        if (!tr) return;
        try { e.preventDefault(); } catch (_) {}
        selectPinById(tr.getAttribute('data-pin-id'));
      });
    }

    if (els.updateBtn) els.updateBtn.addEventListener('click', function () {
      if (!state.selected) return;
      var patch = collectEditPatch();
      if (!isYmd(patch.event_ymd) || !patch.title) {
        setNote(els.editDateNote, 'Event date and title are required.', true);
        return;
      }
      els.updateBtn.disabled = true;
      setNote(els.editDateNote, 'Saving…', false);
      fetchJson('/api/tools/change-pins/' + encodeURIComponent(String(state.selected.id)), {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }).then(function (data) {
        if (!data || !data.ok) {
          setNote(els.editDateNote, (data && data.error) ? String(data.error) : 'Save failed.', true);
          els.updateBtn.disabled = false;
          return;
        }
        setNote(els.editDateNote, 'Saved.', false);
        state.selected = data.pin;
        state.detailSubview = 'stats';
        loadPins();
        renderSelectedDetail();
        refreshEffect();
        setTimeout(function () { setNote(els.editDateNote, '', false); }, 1000);
      }).finally(function () {
        setTimeout(function () { if (els.updateBtn) els.updateBtn.disabled = false; }, 400);
      });
    });

    if (els.archiveBtn) els.archiveBtn.addEventListener('click', function () {
      if (!state.selected) return;
      fetchJson('/api/tools/change-pins/' + encodeURIComponent(String(state.selected.id)) + '/archive', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
        .then(function (data) {
          if (data && data.ok && data.pin) {
            state.selected = data.pin;
            setDetailArchivedUi(state.selected);
            loadPins();
          }
        });
    });
    if (els.unarchiveBtn) els.unarchiveBtn.addEventListener('click', function () {
      if (!state.selected) return;
      fetchJson('/api/tools/change-pins/' + encodeURIComponent(String(state.selected.id)) + '/unarchive', { method: 'POST', credentials: 'same-origin', cache: 'no-store' })
        .then(function (data) {
          if (data && data.ok && data.pin) {
            state.selected = data.pin;
            setDetailArchivedUi(state.selected);
            loadPins();
          }
        });
    });
    applyCompareUiConstraints();
    applyCustomDaysVisibility();

    loadPins();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

