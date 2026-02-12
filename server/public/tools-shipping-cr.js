(function () {
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('tools', { page: 'tools', tool: 'shipping-cr' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('tools', 'init', { tool: 'shipping-cr' }); } catch (_) {}

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

  function formatMoney(amount, currency) {
    var n = typeof amount === 'number' ? amount : Number(amount);
    var cur = String(currency || '').trim().toUpperCase();
    if (!Number.isFinite(n)) return '—';
    if (!cur) return n.toFixed(2);
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: cur }).format(n);
    } catch (_) {
      return cur + ' ' + n.toFixed(2);
    }
  }

  function fmtPct(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(1) + '%';
  }

  function formatCount(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try { return new Intl.NumberFormat('en').format(Math.round(x)); } catch (_) { return String(Math.round(x)); }
  }

  var state = {
    shop: getShopParam(),
    country_code: '',
    start_ymd: '',
    end_ymd: '',
  };

  var MIN_YMD = '2025-02-01';

  var countryEl = qs('#country-code');
  var countryFlagEl = qs('#country-flag');
  var countryNote = qs('#country-note');
  var startEl = qs('#start-date');
  var endEl = qs('#end-date');
  var dateNote = qs('#date-note');
  var goBtn = qs('#go-btn');
  var goNote = qs('#go-note');
  var backfillBtn = qs('#backfill-btn');
  var backfillNote = qs('#backfill-note');
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
    if (!cc) { setCountryFlag(''); setNote(countryNote, ''); return; }
    setCountryFlag(cc);
    setNote(countryNote, countryNameFromIso2(cc) + ' • ' + cc);
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
    var cc = normalizeCountry(state.country_code);
    var ok = !!cc && isYmd(state.start_ymd) && isYmd(state.end_ymd) && state.start_ymd <= state.end_ymd;
    if (goBtn) goBtn.disabled = !ok;
    if (backfillBtn) backfillBtn.disabled = !ok;
    if (!cc) setNote(goNote, 'Enter a 2-letter country code (e.g. AU).');
    else if (!state.start_ymd || !state.end_ymd) setNote(goNote, 'Select a start and end date.');
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
          // Make sure click anywhere opens even if focus behavior differs.
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

    var cc = normalizeCountry(data.country_code || state.country_code);
    var countryName = countryNameFromIso2(cc);
    var totalOrders = (data.total_orders != null ? Number(data.total_orders) : 0) || 0;
    var checkoutStartedSessions = (data.checkout_started_sessions != null ? Number(data.checkout_started_sessions) : 0) || 0;
    var rows = Array.isArray(data.rows) ? data.rows : [];

    var summary = '<div class="tools-note tools-note--spaced"><strong>' + esc(countryName) + '</strong> • ' + esc(cc) +
      ' — ' + esc(formatCount(totalOrders)) + (totalOrders === 1 ? ' order' : ' orders') +
      ' • ' + esc(formatCount(checkoutStartedSessions)) + (checkoutStartedSessions === 1 ? ' checkout-started session' : ' checkout-started sessions') +
      '</div>';

    if (!rows.length) {
      resultsEl.classList.remove('is-hidden');
      resultsEl.innerHTML = summary + '<div class="tools-note">No shipping options found for this filter.</div>';
      return;
    }

    var table = '' +
      '<div class="tools-table-wrap">' +
        '<table class="tools-table table table-vcenter">' +
          '<thead><tr>' +
            '<th>Country</th>' +
            '<th>Shipping label</th>' +
            '<th>Shipping price</th>' +
            '<th class="text-end">Sessions</th>' +
            '<th>CR%</th>' +
          '</tr></thead><tbody>';

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i] || {};
      var label = r.label != null ? String(r.label) : '';
      var cur = r.currency != null ? String(r.currency) : '';
      var price = r.shipping_price != null ? Number(r.shipping_price) : null;
      var pct = r.cr_pct;
      table += '<tr>' +
        '<td>' + esc(countryName) + '</td>' +
        '<td>' + esc(label || '—') + '</td>' +
        '<td>' + esc(formatMoney(price, cur)) + '</td>' +
        '<td class="text-end">' + esc(formatCount(checkoutStartedSessions)) + '</td>' +
        '<td>' + esc(fmtPct(pct)) + '</td>' +
      '</tr>';
    }
    table += '</tbody></table></div>';

    resultsEl.classList.remove('is-hidden');
    resultsEl.innerHTML = summary + table;
  }

  function doGo() {
    var cc = normalizeCountry(state.country_code);
    if (!cc || !isYmd(state.start_ymd) || !isYmd(state.end_ymd) || state.start_ymd > state.end_ymd) return;

    goBtn.disabled = true;
    setNote(goNote, 'Loading…');
    renderResults(null);

    var body = {
      shop: state.shop || undefined,
      country_code: cc,
      start_ymd: state.start_ymd,
      end_ymd: state.end_ymd,
    };

    fetch('/api/tools/shipping-cr/labels', {
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

  var backfillPollTimer = null;
  function clearBackfillPoll() {
    if (backfillPollTimer) {
      clearInterval(backfillPollTimer);
      backfillPollTimer = null;
    }
  }

  function pollBackfill(jobId) {
    if (!jobId) return;
    clearBackfillPoll();
    setNote(backfillNote, 'Backfill running…');
    backfillPollTimer = setInterval(function () {
      fetch('/api/tools/shipping-cr/backfill/status?job_id=' + encodeURIComponent(jobId), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
        .then(function (data) {
          var job = data && data.ok && data.job ? data.job : null;
          if (!job) return;
          var done = !!job.done;
          var running = !!job.running;
          var total = job.progress_total != null ? Number(job.progress_total) || 0 : 0;
          var doneN = job.progress_done != null ? Number(job.progress_done) || 0 : 0;
          var pct = total > 0 ? Math.min(100, Math.max(0, Math.round((doneN / total) * 100))) : 0;
          if (job.error) {
            setNote(backfillNote, 'Backfill failed: ' + String(job.error));
            clearBackfillPoll();
            updateUi();
            return;
          }
          if (done && !running) {
            setNote(backfillNote, 'Backfill complete. Re-running report…');
            clearBackfillPoll();
            try { doGo(); } catch (_) {}
            return;
          }
          setNote(backfillNote, 'Backfill running… ' + String(doneN) + '/' + String(total) + ' chunks (' + String(pct) + '%)');
        })
        .catch(function () {});
    }, 2000);
  }

  function startBackfill() {
    var cc = normalizeCountry(state.country_code);
    if (!cc || !isYmd(state.start_ymd) || !isYmd(state.end_ymd) || state.start_ymd > state.end_ymd) return;
    if (backfillBtn) backfillBtn.disabled = true;
    setNote(backfillNote, 'Starting backfill…');
    var body = {
      shop: state.shop || undefined,
      start_ymd: state.start_ymd,
      end_ymd: state.end_ymd,
      step_days: 14,
    };
    fetch('/api/tools/shipping-cr/backfill/start', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (data) {
        if (!data || !data.ok || !data.job_id) {
          setNote(backfillNote, 'Failed to start backfill.');
          updateUi();
          return;
        }
        var jobId = String(data.job_id);
        try { sessionStorage.setItem('kexo:shipping-cr:backfillJobId', jobId); } catch (_) {}
        pollBackfill(jobId);
      })
      .catch(function () {
        setNote(backfillNote, 'Failed to start backfill.');
        updateUi();
      });
  }

  if (countryEl) {
    countryEl.addEventListener('input', function () {
      var next = String(countryEl.value || '');
      state.country_code = next;
      updateCountryNote();
      updateUi();
      renderResults(null);
    });
    countryEl.addEventListener('blur', function () {
      var cc = normalizeCountry(countryEl.value);
      if (cc) {
        try { countryEl.value = cc; } catch (_) {}
        state.country_code = cc;
      }
      updateCountryNote();
      updateUi();
    });
  }

  function clampMinDateStr(next) {
    var v = String(next || '').trim();
    if (v && isYmd(v) && v < MIN_YMD) return MIN_YMD;
    return v;
  }

  attachFlatpickr(startEl, function (ymd) {
    state.start_ymd = clampMinDateStr(ymd) || '';
    updateDateNote();
    updateUi();
    renderResults(null);
  });
  attachFlatpickr(endEl, function (ymd) {
    state.end_ymd = clampMinDateStr(ymd) || '';
    updateDateNote();
    updateUi();
    renderResults(null);
  });

  if (startEl) {
    startEl.addEventListener('change', function () {
      state.start_ymd = clampMinDateStr(startEl.value) || '';
      updateDateNote();
      updateUi();
      renderResults(null);
    });
  }

  if (endEl) {
    endEl.addEventListener('change', function () {
      state.end_ymd = clampMinDateStr(endEl.value) || '';
      updateDateNote();
      updateUi();
      renderResults(null);
    });
  }

  if (goBtn) goBtn.addEventListener('click', function () { doGo(); });
  if (backfillBtn) backfillBtn.addEventListener('click', function () { startBackfill(); });

  try {
    var existingJob = sessionStorage.getItem('kexo:shipping-cr:backfillJobId');
    if (existingJob) pollBackfill(String(existingJob));
  } catch (_) {}

  updateCountryNote();
  updateDateNote();
  updateUi();
  renderResults(null);
})();

