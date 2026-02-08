(function () {
  function qs(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtNum(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try { return x.toLocaleString('en-GB'); } catch (_) { return String(x); }
  }
  function fmtPct(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(1) + '%';
  }
  function fmtDeltaPct(ratio) {
    var x = ratio == null ? null : Number(ratio);
    if (x == null || !Number.isFinite(x)) return '—';
    var pct = x * 100;
    var sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(1) + '%';
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
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
  function baseApi() {
    return '';
  }
  function fetchJson(path, opts) {
    return fetch(baseApi() + path, opts || { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        if (!r || !r.ok) return null;
        return r.json().catch(function () { return null; });
      })
      .catch(function () { return null; });
  }

  var back = qs('#tools-back');
  try { if (back) back.href = '/' + (window.location.search || ''); } catch (_) {}

  var eventDateEl = qs('#event-date');
  var dateNote = qs('#date-note');
  var searchEl = qs('#catalog-search');
  var suggestMenu = qs('#suggest-menu');
  var selectedTargetEl = qs('#selected-target');
  var productModeRow = qs('#product-mode-row');
  var variantsRow = qs('#variants-row');
  var variantsList = qs('#variants-list');
  var variantsRefresh = qs('#variants-refresh');
  var variantsSelectAll = qs('#variants-select-all');
  var variantsClear = qs('#variants-clear');
  var compareBtn = qs('#compare-btn');
  var compareNote = qs('#compare-note');
  var resultsEl = qs('#results');

  var state = {
    shop: getShopParam(),
    event_date: '',
    target: null,
    mode: 'product',
    variants: [],
    variantSelected: new Set(),
  };

  var MIN_YMD = '2026-02-08';

  function setNote(el, msg) {
    if (!el) return;
    el.textContent = msg || '';
  }

  function ymdToMs(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return null;
    var d = new Date(ymd + 'T00:00:00.000Z');
    var ms = d.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  function updateDateNote() {
    var ymd = state.event_date;
    if (!ymd) { setNote(dateNote, ''); return; }
    var ev = ymdToMs(ymd);
    if (ev == null) { setNote(dateNote, ''); return; }
    var beforeStart = new Date(ev);
    beforeStart.setUTCDate(beforeStart.getUTCDate() - 30);
    var beforeEnd = new Date(ev);
    beforeEnd.setUTCDate(beforeEnd.getUTCDate() - 1);
    var afterStart = new Date(ev);
    var today = new Date();
    function ymdLocal(d) {
      try { return d.toLocaleDateString('en-CA'); } catch (_) { return ''; }
    }
    setNote(dateNote, 'Before: ' + ymdLocal(beforeStart) + ' to ' + ymdLocal(beforeEnd) + '  |  After: ' + ymdLocal(afterStart) + ' to ' + ymdLocal(today));
  }

  function closeSuggest() {
    if (!suggestMenu) return;
    suggestMenu.classList.remove('open');
    suggestMenu.innerHTML = '';
  }

  function openSuggest() {
    if (!suggestMenu) return;
    suggestMenu.classList.add('open');
  }

  function renderSelectedTarget() {
    if (!selectedTargetEl) return;
    if (!state.target) {
      selectedTargetEl.innerHTML = '';
      if (productModeRow) productModeRow.style.display = 'none';
      if (variantsRow) variantsRow.style.display = 'none';
      return;
    }
    var t = state.target;
    var label = (t.type === 'collection' ? 'Collection' : 'Product') + ': ' + (t.title || t.handle || t.product_id || t.collection_id || '');
    selectedTargetEl.innerHTML = '<span class="tools-pill">' + esc(label) + '<button type="button" id="clear-target" aria-label="Clear">×</button></span>';
    var btn = qs('#clear-target');
    if (btn) {
      btn.addEventListener('click', function () {
        state.target = null;
        state.mode = 'product';
        state.variants = [];
        state.variantSelected = new Set();
        renderSelectedTarget();
        renderVariants();
        updateUi();
        renderResults(null);
      });
    }

    if (t.type === 'product') {
      if (productModeRow) productModeRow.style.display = '';
    } else {
      if (productModeRow) productModeRow.style.display = 'none';
      state.mode = 'collection';
      if (variantsRow) variantsRow.style.display = 'none';
    }
  }

  function currentProductMode() {
    var sel = document.querySelector('input[name="product_mode"]:checked');
    var v = sel && sel.value ? String(sel.value) : 'product';
    return v === 'variants' ? 'variants' : 'product';
  }

  function renderVariants() {
    if (!variantsRow || !variantsList) return;
    if (!state.target || state.target.type !== 'product' || currentProductMode() !== 'variants') {
      variantsRow.style.display = 'none';
      variantsList.innerHTML = '';
      if (variantsSelectAll) variantsSelectAll.disabled = true;
      if (variantsClear) variantsClear.disabled = true;
      return;
    }
    variantsRow.style.display = '';

    if (!state.variants || !state.variants.length) {
      variantsList.innerHTML = '<div class="tools-note">No variants loaded.</div>';
      if (variantsSelectAll) variantsSelectAll.disabled = true;
      if (variantsClear) variantsClear.disabled = true;
      return;
    }

    if (variantsSelectAll) variantsSelectAll.disabled = false;
    if (variantsClear) variantsClear.disabled = false;

    var html = '';
    for (var i = 0; i < state.variants.length; i++) {
      var v = state.variants[i];
      var vid = v.variant_id;
      var name = v.title || vid;
      var checked = state.variantSelected.has(String(vid)) ? ' checked' : '';
      html += '<label style="display:flex;align-items:center;gap:10px;margin:6px 0">' +
        '<input type="checkbox" data-vid="' + esc(vid) + '"' + checked + ' />' +
        '<span>' + esc(name) + '</span>' +
      '</label>';
    }
    variantsList.innerHTML = html;

    variantsList.querySelectorAll('input[type="checkbox"][data-vid]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var vid = cb.getAttribute('data-vid') || '';
        if (!vid) return;
        if (cb.checked) state.variantSelected.add(vid);
        else state.variantSelected.delete(vid);
        updateUi();
      });
    });
  }

  function updateUi() {
    var hasDate = !!state.event_date;
    if (searchEl) searchEl.disabled = !hasDate;

    var hasTarget = !!state.target;
    var mode = state.target && state.target.type === 'product' ? currentProductMode() : (state.target && state.target.type === 'collection' ? 'collection' : '');

    if (compareBtn) {
      compareBtn.disabled = !(hasDate && hasTarget);
    }

    if (mode === 'variants') {
      if (variantsRow) variantsRow.style.display = '';
    }

    if (hasDate && !hasTarget) setNote(compareNote, 'Select a product or collection.');
    else if (!hasDate) setNote(compareNote, 'Select an event date to begin.');
    else setNote(compareNote, '');
  }

  function renderResults(data) {
    if (!resultsEl) return;
    if (!data) {
      resultsEl.style.display = 'none';
      resultsEl.innerHTML = '';
      return;
    }
    if (!data.ok) {
      resultsEl.style.display = '';
      resultsEl.innerHTML = '<div class="tools-note" style="margin-top:12px">' + esc(data.error || 'Failed') + '</div>';
      return;
    }

    if (data.insufficient) {
      resultsEl.style.display = '';
      resultsEl.innerHTML = '<div class="tools-note" style="margin-top:12px">Insufficient data for comparison</div>';
      return;
    }

    var notice = data.notice ? '<div class="tools-note" style="margin-top:10px">' + esc(data.notice) + '</div>' : '';

    var s = data.summary || {};
    var before = s.before || {};
    var after = s.after || {};

    var summaryHtml = '' +
      '<div class="tools-summary">' +
        '<div class="tools-metric"><div class="k">Before CR</div><div class="v">' + fmtPct(before.cr) + '</div></div>' +
        '<div class="tools-metric"><div class="k">After CR</div><div class="v">' + fmtPct(after.cr) + '</div></div>' +
        '<div class="tools-metric"><div class="k">Absolute change</div><div class="v">' + (s.abs_change == null ? '—' : (s.abs_change > 0 ? '+' : '') + s.abs_change.toFixed(1) + '%') + '</div></div>' +
        '<div class="tools-metric"><div class="k">Percentage change</div><div class="v">' + fmtDeltaPct(s.pct_change) + '</div></div>' +
      '</div>' +
      '<div class="tools-note" style="margin-top:10px">Before: ' + fmtNum(before.sessions) + ' sessions, ' + fmtNum(before.orders) + ' orders. After: ' + fmtNum(after.sessions) + ' sessions, ' + fmtNum(after.orders) + ' orders.</div>' +
      notice;

    var variantsHtml = '';
    if (Array.isArray(data.variants) && data.variants.length) {
      var rows = data.variants;
      variantsHtml += '<div class="tools-table-wrap"><table class="tools-table">' +
        '<thead><tr>' +
          '<th>Variant</th>' +
          '<th>Sessions (before)</th>' +
          '<th>Orders (before)</th>' +
          '<th>CR (before)</th>' +
          '<th>Sessions (after)</th>' +
          '<th>Orders (after)</th>' +
          '<th>CR (after)</th>' +
          '<th>% change</th>' +
        '</tr></thead><tbody>';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var b = r.before || {};
        var a = r.after || {};
        variantsHtml += '<tr>' +
          '<td>' + esc(r.variant_name || r.variant_id || '') + '</td>' +
          '<td>' + fmtNum(b.sessions) + '</td>' +
          '<td>' + fmtNum(b.orders) + '</td>' +
          '<td>' + fmtPct(b.cr) + '</td>' +
          '<td>' + fmtNum(a.sessions) + '</td>' +
          '<td>' + fmtNum(a.orders) + '</td>' +
          '<td>' + fmtPct(a.cr) + '</td>' +
          '<td>' + fmtDeltaPct(r.pct_change) + '</td>' +
        '</tr>';
      }
      variantsHtml += '</tbody></table></div>';
    }

    resultsEl.style.display = '';
    resultsEl.innerHTML = summaryHtml + variantsHtml;
  }

  function renderSuggestResults(data) {
    if (!suggestMenu) return;
    if (!data || !data.ok) {
      closeSuggest();
      return;
    }

    var products = Array.isArray(data.products) ? data.products : [];
    var collections = Array.isArray(data.collections) ? data.collections : [];
    if (!products.length && !collections.length) {
      closeSuggest();
      return;
    }

    var html = '';
    function item(kind, obj) {
      var title = obj && obj.title ? obj.title : '';
      var small = kind === 'collection' ? ('Collection') : ('Product');
      return '<button type="button" class="tools-suggest-item" data-kind="' + esc(kind) + '" data-json="' + esc(JSON.stringify(obj)) + '">' +
        '<div class="tools-suggest-kind">' + esc(small) + '</div>' +
        '<div>' + esc(title) + '</div>' +
      '</button>';
    }
    for (var i = 0; i < products.length; i++) html += item('product', products[i]);
    for (var j = 0; j < collections.length; j++) html += item('collection', collections[j]);

    suggestMenu.innerHTML = html;
    openSuggest();

    suggestMenu.querySelectorAll('.tools-suggest-item[data-kind][data-json]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        try {
          var kind = btn.getAttribute('data-kind');
          var obj = JSON.parse(btn.getAttribute('data-json') || '{}');
          if (kind === 'collection') {
            state.target = { type: 'collection', collection_id: obj.collection_id, title: obj.title, handle: obj.handle };
          } else {
            state.target = { type: 'product', product_id: obj.product_id, title: obj.title, handle: obj.handle, created_at: obj.created_at || null };
          }
          state.mode = 'product';
          state.variants = [];
          state.variantSelected = new Set();
          closeSuggest();
          if (searchEl) searchEl.value = '';
          renderSelectedTarget();
          renderVariants();
          updateUi();
          renderResults(null);
        } catch (_) {
          closeSuggest();
        }
      });
    });
  }

  var doSearch = debounce(function () {
    if (!searchEl) return;
    var term = String(searchEl.value || '').trim();
    if (!term || term.length < 2) { closeSuggest(); return; }
    var q = encodeURIComponent(term);
    var shop = state.shop ? '&shop=' + encodeURIComponent(state.shop) : '';
    fetchJson('/api/tools/catalog-search?q=' + q + shop + '&limit=10', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (data) {
        renderSuggestResults(data);
      });
  }, 180);

  if (eventDateEl) {
    eventDateEl.addEventListener('change', function () {
      var next = String(eventDateEl.value || '').trim();
      if (next && /^\d{4}-\d{2}-\d{2}$/.test(next) && next < MIN_YMD) {
        try { eventDateEl.value = MIN_YMD; } catch (_) {}
        next = MIN_YMD;
      }
      state.event_date = next;
      updateDateNote();
      closeSuggest();
      updateUi();
      renderResults(null);
    });
  }

  if (searchEl) {
    searchEl.addEventListener('input', function () {
      doSearch();
    });
    searchEl.addEventListener('focus', function () {
      doSearch();
    });
  }

  document.addEventListener('click', function (e) {
    if (!suggestMenu || !searchEl) return;
    if (suggestMenu.contains(e.target) || searchEl.contains(e.target)) return;
    closeSuggest();
  });

  document.querySelectorAll('input[name="product_mode"]').forEach(function (r) {
    r.addEventListener('change', function () {
      renderVariants();
      updateUi();
      renderResults(null);
      try {
        if (state && state.target && state.target.type === 'product' && currentProductMode() === 'variants') {
          if (!state.variants || !state.variants.length) loadVariants();
        }
      } catch (_) {}
    });
  });

  function loadVariants() {
    if (!state.target || state.target.type !== 'product') return;
    var prefix = state.shop ? ('?shop=' + encodeURIComponent(state.shop)) : '?';
    fetchJson('/api/tools/compare-cr/variants' + prefix + (state.shop ? '&' : '') + 'product_id=' + encodeURIComponent(state.target.product_id), { credentials: 'same-origin', cache: 'no-store' })
      .then(function (data) {
        if (!data || !data.ok) {
          state.variants = [];
          state.variantSelected = new Set();
          renderVariants();
          return;
        }
        state.variants = Array.isArray(data.variants) ? data.variants.map(function (v) {
          var title = '';
          if (v && v.selected_options && v.selected_options.length) {
            title = v.selected_options.map(function (o) {
              var n = o && o.name ? String(o.name) : '';
              var val = o && o.value ? String(o.value) : '';
              if (!val) return '';
              return n ? (n + ': ' + val) : val;
            }).filter(Boolean).join(' / ');
          }
          if (!title) title = (v && v.title ? String(v.title) : '') || (v && v.variant_id ? String(v.variant_id) : '');
          return { variant_id: v.variant_id, title: title };
        }) : [];
        state.variantSelected = new Set();
        renderVariants();
        updateUi();
      });
  }

  if (variantsRefresh) variantsRefresh.addEventListener('click', function () { loadVariants(); });
  if (variantsSelectAll) variantsSelectAll.addEventListener('click', function () {
    state.variantSelected = new Set((state.variants || []).map(function (v) { return String(v.variant_id); }));
    renderVariants();
    updateUi();
  });
  if (variantsClear) variantsClear.addEventListener('click', function () {
    state.variantSelected = new Set();
    renderVariants();
    updateUi();
  });

  function doCompare() {
    if (!state.event_date || !state.target) return;
    var mode = state.target.type === 'collection' ? 'collection' : currentProductMode();
    var variantIds = null;
    if (state.target.type === 'product' && mode === 'variants') {
      variantIds = Array.from(state.variantSelected);
      if (!variantIds.length) variantIds = null;
    }

    compareBtn.disabled = true;
    setNote(compareNote, 'Comparing...');

    var body = {
      shop: state.shop || undefined,
      event_date: state.event_date,
      target: state.target,
      mode: mode,
      variant_ids: variantIds || undefined,
    };

    fetch('/api/tools/compare-cr/compare', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r && r.ok ? r.json().catch(function () { return null; }) : null; })
      .then(function (data) {
        renderResults(data);
        setNote(compareNote, '');
      })
      .catch(function () {
        renderResults({ ok: false, error: 'Request failed' });
        setNote(compareNote, '');
      })
      .finally(function () {
        compareBtn.disabled = !(state.event_date && state.target);
      });
  }

  if (compareBtn) compareBtn.addEventListener('click', function () { doCompare(); });

  updateDateNote();
  renderSelectedTarget();
  renderVariants();
  updateUi();
})();
