(function () {
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('tools', { page: 'tools', tool: 'time-of-day' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('tools', 'init', { tool: 'time-of-day' }); } catch (_) {}

  function qs(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getShopParam() {
    try {
      var p = new URLSearchParams(window.location.search);
      var shop = p.get('shop') || '';
      return shop && /\.myshopify\.com$/i.test(shop) ? shop : '';
    } catch (_) {
      return '';
    }
  }

  function normalizeCountry(v) {
    var s = String(v || '').trim().toUpperCase().slice(0, 2);
    if (!s) return '';
    if (s === 'UK') return 'GB';
    if (!/^[A-Z]{2}$/.test(s)) return '';
    return s;
  }

  function isYmd(v) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());
  }

  function setNote(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
  }

  function countryNameFromIso2(code) {
    var c = String(code || '').trim().toUpperCase().slice(0, 2);
    if (!c) return '';
    try {
      if (typeof Intl !== 'undefined' && Intl.DisplayNames) {
        var dn = new Intl.DisplayNames(['en'], { type: 'region' });
        var out = dn.of(c);
        return out || c;
      }
    } catch (_) {}
    return c;
  }

  function fmtPct(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '\u2014';
    return x.toFixed(1) + '%';
  }

  function formatCount(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '\u2014';
    try { return new Intl.NumberFormat('en').format(Math.round(x)); } catch (_) { return String(Math.round(x)); }
  }

  var state = {
    shop: getShopParam(),
    country_code: '',
    start_ymd: '',
    end_ymd: '',
  };

  var MIN_YMD = '2020-01-01';

  var countryEl = qs('#country-code');
  var countryFlagEl = qs('#country-flag');
  var countryNote = qs('#country-note');
  var startEl = qs('#start-date');
  var endEl = qs('#end-date');
  var dateNote = qs('#date-note');
  var goBtn = qs('#go-btn');
  var goNote = qs('#go-note');
  var resultsEl = qs('#results');

  function setCountryFlag(code) {
    if (!countryFlagEl) return;
    var raw = String(code || '').trim().toLowerCase();
    if (!raw || raw === 'xx' || !/^[a-z]{2}$/.test(raw)) {
      countryFlagEl.className = 'flag flag-xs ms-2 flag-country-xx is-hidden';
      return;
    }
    countryFlagEl.className = 'flag flag-xs ms-2 flag-country-' + raw;
  }

  function updateCountryNote() {
    var cc = normalizeCountry(state.country_code);
    if (!cc) { setCountryFlag(''); setNote(countryNote, 'Optional: leave blank for all countries.'); return; }
    setCountryFlag(cc);
    setNote(countryNote, countryNameFromIso2(cc) + ' \u2022 ' + cc);
  }

  function updateDateNote() {
    if (!state.start_ymd || !state.end_ymd) { setNote(dateNote, ''); return; }
    if (state.start_ymd > state.end_ymd) {
      setNote(dateNote, 'Start date must be on or before end date.');
      return;
    }
    setNote(dateNote, '');
  }

  function updateUi() {
    var ok = isYmd(state.start_ymd) && isYmd(state.end_ymd) && state.start_ymd <= state.end_ymd;
    if (goBtn) goBtn.disabled = !ok;
    if (!state.start_ymd || !state.end_ymd) setNote(goNote, 'Select a start and end date.');
    else if (state.start_ymd > state.end_ymd) setNote(goNote, 'Fix the date range.');
    else setNote(goNote, '');
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
        minDate: MIN_YMD,
        onReady: function (_selectedDates, _dateStr, instance) {
          try {
            if (instance && instance.calendarContainer) instance.calendarContainer.classList.add('kexo-flatpickr-single');
          } catch (_) {}
        },
        onChange: function (selectedDates, dateStr) {
          try { if (typeof onValue === 'function') onValue(dateStr); } catch (_) {}
        },
        onOpen: function () {
          try { el.focus(); } catch (_) {}
        },
      });
      el.addEventListener('click', function () { try { fp.open(); } catch (_) {} });
      return fp;
    } catch (_) {
      return null;
    }
  }

  function renderResults(data) {
    if (!resultsEl) return;
    if (!data) {
      resultsEl.classList.add('is-hidden');
      resultsEl.innerHTML = '';
      return;
    }
    if (!data.ok) {
      resultsEl.classList.remove('is-hidden');
      resultsEl.innerHTML = '<div class="tools-note tools-note--spaced">' + esc(data.error || 'Failed') + '</div>';
      return;
    }

    var rows = Array.isArray(data.rows) ? data.rows : [];
    var summary = '<div class="tools-note tools-note--spaced">Sessions and orders by hour (admin timezone).' +
      (state.country_code ? ' Country filter: ' + esc(normalizeCountry(state.country_code)) + '.' : ' All countries.') +
      '</div>';

    if (!rows.length) {
      resultsEl.classList.remove('is-hidden');
      resultsEl.innerHTML = summary + '<div class="tools-note">No data for this range.</div>';
      return;
    }

    var table = '<div class="table-responsive"><table class="table table-vcenter card-table table-sm">' +
      '<thead><tr><th>Hour</th><th class="text-end">Sessions</th><th class="text-end">Orders</th><th>CR%</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var hour = r.hour != null ? Number(r.hour) : i;
      var sessions = r.sessions != null ? Number(r.sessions) : 0;
      var orders = r.orders != null ? Number(r.orders) : 0;
      var cr = r.cr != null ? r.cr : (sessions > 0 ? (orders / sessions) * 100 : null);
      table += '<tr>' +
        '<td>' + esc(String(hour).padStart(2, '0') + ':00') + '</td>' +
        '<td class="text-end">' + esc(formatCount(sessions)) + '</td>' +
        '<td class="text-end">' + esc(formatCount(orders)) + '</td>' +
        '<td>' + esc(fmtPct(cr)) + '</td>' +
        '</tr>';
    }
    table += '</tbody></table></div>';

    resultsEl.classList.remove('is-hidden');
    resultsEl.innerHTML = summary + table;
  }

  function doGo() {
    if (!isYmd(state.start_ymd) || !isYmd(state.end_ymd) || state.start_ymd > state.end_ymd) return;

    goBtn.disabled = true;
    setNote(goNote, 'Loading\u2026');
    renderResults(null);

    var body = {
      shop: state.shop || undefined,
      country_code: normalizeCountry(state.country_code) || undefined,
      start_ymd: state.start_ymd,
      end_ymd: state.end_ymd,
    };

    fetch('/api/tools/time-of-day', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (data) {
        renderResults(data || { ok: false, error: 'Request failed' });
        setNote(goNote, '');
      })
      .catch(function () {
        renderResults({ ok: false, error: 'Request failed' });
        setNote(goNote, '');
      })
      .finally(function () {
        updateUi();
      });
  }

  function bind() {
    if (countryEl) {
      countryEl.addEventListener('input', function () {
        state.country_code = (countryEl.value || '').trim();
        updateCountryNote();
        updateUi();
      });
      countryEl.addEventListener('change', function () {
        state.country_code = (countryEl.value || '').trim();
        updateCountryNote();
        updateUi();
      });
    }
    if (startEl) {
      attachFlatpickr(startEl, function (dateStr) {
        state.start_ymd = dateStr || '';
        updateDateNote();
        updateUi();
      });
    }
    if (endEl) {
      attachFlatpickr(endEl, function (dateStr) {
        state.end_ymd = dateStr || '';
        updateDateNote();
        updateUi();
      });
    }
    if (goBtn) {
      goBtn.addEventListener('click', function (e) {
        e.preventDefault();
        doGo();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bind();
      updateCountryNote();
      updateDateNote();
      updateUi();
    });
  } else {
    bind();
    updateCountryNote();
    updateDateNote();
    updateUi();
  }
})();
