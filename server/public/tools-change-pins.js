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
    loading: false,
  };

  var els = {
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
    // detail/edit
    detailCard: qs('#tool-change-pins-detail'),
    detailSubtitle: qs('#pin-detail-subtitle'),
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
    // effect
    effectWindow: qs('#effect-window'),
    effectRefresh: qs('#effect-refresh'),
    effectNote: qs('#effect-note'),
    effectResults: qs('#effect-results'),
  };

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
    var magVal = safeStr(els.magVal && els.magVal.value);
    var magUnit = safeStr(els.magUnit && els.magUnit.value) || '%';
    var tags = safeStr(els.tags && els.tags.value);
    var notes = safeStr(els.notes && els.notes.value);
    return {
      event_ymd: ymd,
      event_hm: hm || undefined,
      title: title,
      kind: kind || undefined,
      magnitude_value: magVal ? Number(magVal) : undefined,
      magnitude_unit: magVal ? magUnit : undefined,
      tags: tags || undefined,
      notes: notes || undefined,
    };
  }

  function clearCreateForm() {
    try { if (els.title) els.title.value = ''; } catch (_) {}
    try { if (els.kind) els.kind.value = ''; } catch (_) {}
    try { if (els.magVal) els.magVal.value = ''; } catch (_) {}
    try { if (els.magUnit) els.magUnit.value = '%'; } catch (_) {}
    try { if (els.tags) els.tags.value = ''; } catch (_) {}
    try { if (els.notes) els.notes.value = ''; } catch (_) {}
    updateCreateUi();
  }

  function renderPinsTable(pins) {
    if (!els.pinsTable) return;
    var list = Array.isArray(pins) ? pins : [];
    if (!list.length) {
      els.pinsTable.innerHTML = '<div class="tools-note tools-note--spaced">No pins found.</div>';
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
      '<th style="min-width:140px">Tags</th>' +
      '<th style="min-width:90px">Status</th>' +
    '</tr></thead><tbody>';
    for (var i = 0; i < list.length; i++) {
      var p = list[i] || {};
      var id = p.id;
      var ymd = p.event_ymd || '';
      var time = p.event_ts ? hmInTzFromMs(p.event_ts) : '';
      var tags = Array.isArray(p.tags) ? p.tags.join(', ') : '';
      var status = p.archived_at ? 'Archived' : 'Active';
      var isSel = state.selected && state.selected.id === id;
      html += '<tr data-pin-id="' + esc(id) + '" style="cursor:pointer;' + (isSel ? 'background:rgba(15,23,42,0.03);' : '') + '">' +
        '<td>' + esc(ymd) + '</td>' +
        '<td>' + esc(time || '') + '</td>' +
        '<td><strong style="font-weight:600">' + esc(p.title || '') + '</strong></td>' +
        '<td>' + esc(p.kind || '') + '</td>' +
        '<td>' + esc(tags) + '</td>' +
        '<td>' + esc(status) + '</td>' +
      '</tr>';
    }
    html += '</tbody></table></div>';
    els.pinsTable.innerHTML = html;

    els.pinsTable.querySelectorAll('tr[data-pin-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        var id = tr.getAttribute('data-pin-id');
        if (!id) return;
        var pin = state.pins.find(function (x) { return String(x && x.id) === String(id); });
        if (pin) selectPin(pin);
      });
    });
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
        if (state.selected) {
          renderSelectedDetail();
        } else {
          hideDetail();
        }
      })
      .finally(function () {
        state.loading = false;
      });
  }

  function hideDetail() {
    if (!els.detailCard) return;
    els.detailCard.classList.add('is-hidden');
    if (els.effectResults) els.effectResults.innerHTML = '';
  }

  function selectPin(pin) {
    state.selected = pin;
    renderPinsTable(state.pins);
    renderSelectedDetail();
    refreshEffect();
  }

  function setDetailArchivedUi(pin) {
    var isArchived = !!(pin && pin.archived_at);
    if (els.archiveBtn) els.archiveBtn.classList.toggle('is-hidden', isArchived);
    if (els.unarchiveBtn) els.unarchiveBtn.classList.toggle('is-hidden', !isArchived);
  }

  function renderSelectedDetail() {
    var pin = state.selected;
    if (!pin || !els.detailCard) { hideDetail(); return; }
    els.detailCard.classList.remove('is-hidden');
    setDetailArchivedUi(pin);

    var subtitle = pin.event_ymd || '';
    if (pin.event_ts) subtitle += ' · ' + hmInTzFromMs(pin.event_ts);
    if (els.detailSubtitle) els.detailSubtitle.textContent = subtitle;

    try { if (els.editDate) els.editDate.value = pin.event_ymd || ''; } catch (_) {}
    try { if (els.editTime) els.editTime.value = pin.event_ts ? hmInTzFromMs(pin.event_ts) : ''; } catch (_) {}
    try { if (els.editTitle) els.editTitle.value = pin.title || ''; } catch (_) {}
    try { if (els.editKind) els.editKind.value = pin.kind || ''; } catch (_) {}
    try { if (els.editMagVal) els.editMagVal.value = (pin.magnitude_value != null ? String(pin.magnitude_value) : ''); } catch (_) {}
    try { if (els.editMagUnit) els.editMagUnit.value = (pin.magnitude_unit || '%'); } catch (_) {}
    try { if (els.editTags) els.editTags.value = (Array.isArray(pin.tags) ? pin.tags.join(', ') : ''); } catch (_) {}
    try { if (els.editNotes) els.editNotes.value = pin.notes || ''; } catch (_) {}
  }

  function collectEditPatch() {
    var ymd = safeStr(els.editDate && els.editDate.value);
    var hm = safeStr(els.editTime && els.editTime.value);
    if (!isHm(hm)) hm = '';
    var title = safeStr(els.editTitle && els.editTitle.value);
    var kind = safeStr(els.editKind && els.editKind.value);
    var magVal = safeStr(els.editMagVal && els.editMagVal.value);
    var magUnit = safeStr(els.editMagUnit && els.editMagUnit.value) || '%';
    var tags = safeStr(els.editTags && els.editTags.value);
    var notes = safeStr(els.editNotes && els.editNotes.value);
    return {
      event_ymd: ymd,
      event_hm: hm || undefined,
      title: title,
      kind: kind || undefined,
      magnitude_value: magVal ? Number(magVal) : null,
      magnitude_unit: magVal ? magUnit : null,
      tags: tags || '',
      notes: notes || '',
    };
  }

  function refreshEffect() {
    if (!state.selected) return;
    var pinId = state.selected.id;
    var w = els.effectWindow ? safeStr(els.effectWindow.value) : '7';
    var win = Number(w) || 7;
    setNote(els.effectNote, 'Loading…', false);
    if (els.effectResults) els.effectResults.innerHTML = '';
    fetchJson('/api/tools/change-pins/' + encodeURIComponent(String(pinId)) + '/effect?window_days=' + encodeURIComponent(String(win)), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (data) {
        if (!data || !data.ok) {
          setNote(els.effectNote, 'Failed to load effect.', true);
          if (els.effectResults) els.effectResults.innerHTML = '';
          return;
        }
        setNote(els.effectNote, '', false);
        renderEffect(data);
      });
  }

  function renderEffect(payload) {
    if (!els.effectResults) return;
    var before = payload.before || {};
    var after = payload.after || {};
    var d = payload.delta || {};
    function metric(label, beforeVal, afterVal, deltaAbs, deltaPct, fmt) {
      var f = fmt || function (x) { return x == null ? '—' : String(x); };
      var absTxt = deltaAbs != null && Number.isFinite(Number(deltaAbs)) ? (Number(deltaAbs) > 0 ? '+' : '') + (fmt === fmtMoney ? fmtMoney(deltaAbs) : fmt(deltaAbs)) : '—';
      var pctTxt = fmtRatioDelta(deltaPct);
      return '' +
        '<div class="tools-metric">' +
          '<div class="k">' + esc(label) + '</div>' +
          '<div class="v">' + esc(f(afterVal)) + '</div>' +
          '<div class="tools-note tools-note--tight">Before: ' + esc(f(beforeVal)) + ' · Δ ' + esc(absTxt) + ' (' + esc(pctTxt) + ')</div>' +
        '</div>';
    }

    var html = '';
    html += '<div class="tools-note tools-note--spaced">Before: ' + esc(payload.ranges && payload.ranges.before ? (payload.ranges.before.start_ymd + ' → ' + payload.ranges.before.end_ymd) : '') +
      ' · After: ' + esc(payload.ranges && payload.ranges.after ? (payload.ranges.after.start_ymd + ' → ' + payload.ranges.after.end_ymd) : '') +
      '</div>';
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
    els.effectResults.innerHTML = html;
  }

  function init() {
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

    if (els.effectRefresh) els.effectRefresh.addEventListener('click', function () { refreshEffect(); });

    loadPins();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

