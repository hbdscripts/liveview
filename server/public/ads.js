(function () {
  if (window.__adsInit) return;
  try { if (typeof window.kexoSetContext === 'function') window.kexoSetContext('ads', { page: 'ads' }); } catch (_) {}
  try { if (typeof window.kexoBreadcrumb === 'function') window.kexoBreadcrumb('ads', 'init', { page: 'ads' }); } catch (_) {}

  /* ── helpers ─────────────────────────────────────────────── */

  function baseApi() {
    try { if (typeof API !== 'undefined') return String(API || ''); } catch (_) {}
    return '';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtNum(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    try { return x.toLocaleString('en-GB'); } catch (_) { return String(Math.round(x)); }
  }

  function fmtMoney(n, currency) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    var cur = currency || 'GBP';
    try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(x); }
    catch (_) { return (cur === 'GBP' ? '£' : '') + String(Math.round(x * 100) / 100); }
  }

  function fmtRoas(n) {
    var x = n == null ? null : Number(n);
    if (x == null || !Number.isFinite(x)) return '—';
    return x.toFixed(2) + 'x';
  }

  function fmtPct(frac, digits) {
    var x = frac == null ? null : Number(frac);
    if (x == null || !Number.isFinite(x)) return '—';
    var d = digits == null ? 1 : Number(digits);
    if (!Number.isFinite(d)) d = 1;
    d = Math.max(0, Math.min(3, Math.round(d)));
    return (x * 100).toFixed(d) + '%';
  }

  function fmtTime(tsMs) {
    if (!tsMs) return '—';
    try { return new Date(Number(tsMs)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return '—'; }
  }

  function fetchJson(path, options) {
    var url = baseApi() + path;
    var opts = options || { credentials: 'same-origin', cache: 'no-store' };
    return fetch(url, opts).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().catch(function () { return null; });
    }).catch(function (err) {
      try { if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'ads.fetchJson', path: path }); } catch (_) {}
      return null;
    });
  }

  function getShopParam() {
    try {
      var m = /[?&]shop=([^&]+)/.exec(window.location.search || '');
      return m && m[1] ? decodeURIComponent(m[1]) : '';
    } catch (_) { return ''; }
  }

  function captureChartError(err, context, extra) {
    try {
      if (typeof window.kexoCaptureError !== 'function') return;
      var payload = { context: context || 'adsChart', page: 'ads' };
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
      }
      window.kexoCaptureError(err, payload);
    } catch (_) {}
  }

  function captureChartMessage(message, context, extra, level) {
    try {
      if (typeof window.kexoCaptureMessage !== 'function') return;
      var payload = { context: context || 'adsChart', page: 'ads' };
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(function (k) { payload[k] = extra[k]; });
      }
      window.kexoCaptureMessage(String(message || ''), payload, level || 'error');
    } catch (_) {}
  }

  function profitClass(v) {
    var x = v != null ? Number(v) : 0;
    if (!Number.isFinite(x) || x === 0) return '';
    return x > 0 ? 'ads-profit-pos' : 'ads-profit-neg';
  }

  function setProfitCellClass(cell, profit) {
    if (!cell || !cell.classList) return;
    var x = profit != null ? Number(profit) : 0;
    cell.classList.remove('ads-profit-pos', 'ads-profit-neg');
    if (!Number.isFinite(x) || x === 0) return;
    cell.classList.add(x > 0 ? 'ads-profit-pos' : 'ads-profit-neg');
  }

  function patchText(el, text) {
    if (!el) return;
    var next = text == null ? '' : String(text);
    if (el.textContent !== next) el.textContent = next;
  }

  var _panelLoaderActive = false;
  var _panelLoaderSilent = false;
  function allowOverlayLoader() {
    try {
      if (typeof window.__kexoIsPageLoaderEnabled === 'function') {
        if (!window.__kexoIsPageLoaderEnabled('ads')) return false;
      }
    } catch (_) {}
    try {
      if (typeof window.__kexoSilentOverlayActive === 'function' && window.__kexoSilentOverlayActive()) return false;
    } catch (_) {}
    return true;
  }
  function getPanelLoaderState() {
    var panel = document.querySelector('.page-body');
    var overlay = document.getElementById('page-body-loader');
    var titleEl = overlay ? overlay.querySelector('.report-build-title') : null;
    var stepEl = document.getElementById('page-body-build-step') || (overlay ? overlay.querySelector('.report-build-step') : null);
    return { panel: panel, overlay: overlay, titleEl: titleEl, stepEl: stepEl };
  }

  function showPanelLoader(title, step) {
    var st = getPanelLoaderState();
    if (!st.panel || !st.overlay) return;
    if (!allowOverlayLoader()) {
      try { if (typeof window.__kexoBeginGlobalReportLoading === 'function') window.__kexoBeginGlobalReportLoading(); } catch (_) {}
      _panelLoaderActive = true;
      _panelLoaderSilent = true;
      return;
    }
    st.panel.classList.add('report-building');
    st.overlay.classList.remove('is-hidden');
    if (title != null) patchText(st.titleEl, String(title));
    if (step != null) patchText(st.stepEl, String(step));
    _panelLoaderActive = true;
    _panelLoaderSilent = false;
  }

  function setPanelLoaderStep(step, title) {
    var st = getPanelLoaderState();
    if (!st.overlay || st.overlay.classList.contains('is-hidden')) return;
    if (title != null) patchText(st.titleEl, String(title));
    if (step != null) patchText(st.stepEl, String(step));
  }

  function hidePanelLoader() {
    var st = getPanelLoaderState();
    if (!st.panel || !st.overlay) return;
    if (_panelLoaderSilent) {
      try { if (typeof window.__kexoEndGlobalReportLoading === 'function') window.__kexoEndGlobalReportLoading(); } catch (_) {}
      _panelLoaderActive = false;
      _panelLoaderSilent = false;
      return;
    }
    st.overlay.classList.add('is-hidden');
    st.panel.classList.remove('report-building');
    _panelLoaderActive = false;
    _panelLoaderSilent = false;
  }

  /* ── sort state ──────────────────────────────────────────── */

  // Column definitions: key, label, getter, format
  // Order: Campaign, Clicks, Impr, Conv, Revenue, Spend, ROAS, Gross
  var COL_DEFS = [
    { key: 'campaign', label: 'Campaign', get: function (c) { return (c.campaignName || c.campaignId || '').toLowerCase(); }, fmt: null },
    { key: 'clicks',   label: 'Clicks',   get: function (c) { return c.clicks || 0; },       fmt: function (v) { return fmtNum(v); } },
    { key: 'impr',     label: 'Impr',     get: function (c) { return c.impressions || 0; },  fmt: function (v) { return fmtNum(v); } },
    { key: 'conv',     label: 'Conv',     get: function (c) { return c.orders || 0; },       fmt: function (v) { return fmtNum(v); } },
    { key: 'sales',    label: 'Revenue',  get: function (c) { return c.revenue || 0; },      fmt: function (v, cur) { return fmtMoney(v, cur); } },
    { key: 'spend',    label: 'Spend',    get: function (c) { return c.spend || 0; },        fmt: function (v, cur) { return fmtMoney(v, cur); } },
    { key: 'roas',     label: 'ROAS',     get: function (c) { return c.roas != null ? c.roas : -Infinity; }, fmt: function (v) { return fmtRoas(v === -Infinity ? null : v); } },
    { key: 'profit',   label: 'Gross',    get: function (c) { return c.profit || 0; },       fmt: function (v, cur) { return fmtMoney(v, cur); } },
  ];

  var sortKey = 'sales';
  var sortDesc = true;
  var adsPage = 1;
  var ADS_ROW_OPTIONS = [20, 30, 40, 50];

  function getAdsRowsStorageKey() {
    return 'kexo:table-rows:v1:ads-root';
  }

  function getAdsHidePausedStorageKey() {
    return 'kexo:ads:hide-paused:v1';
  }

  function getAdsHidePaused() {
    var raw = null;
    try { raw = localStorage.getItem(getAdsHidePausedStorageKey()); } catch (_) { raw = null; }
    var s = raw != null ? String(raw).trim().toLowerCase() : '';
    if (!s) return false;
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }

  function setAdsHidePaused(next) {
    var v = !!next;
    try { localStorage.setItem(getAdsHidePausedStorageKey(), v ? '1' : '0'); } catch (_) {}
    return v;
  }

  function getAdsPageSize() {
    var raw = null;
    try { raw = localStorage.getItem(getAdsRowsStorageKey()); } catch (_) { raw = null; }
    var n = Number(raw);
    if (!Number.isFinite(n)) return 20;
    n = Math.round(n);
    if (ADS_ROW_OPTIONS.indexOf(n) >= 0) return n;
    return 20;
  }

  function clampPage(page, totalPages) {
    var n = Number(page);
    if (!Number.isFinite(n)) n = 1;
    n = Math.round(n);
    return Math.max(1, Math.min(Math.max(1, Number(totalPages) || 1), n));
  }

  function buildPagerHtml(page, totalPages) {
    var fn = null;
    try { fn = window.__kexoBuildPaginationHtml; } catch (_) { fn = null; }
    if (typeof fn === 'function') return fn(page, totalPages);
    var p = Math.max(1, page);
    var tp = Math.max(1, totalPages);
    var h = '<ul class="pagination m-0">';
    h += '<li class="page-item' + (p <= 1 ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p - 1) + '" tabindex="-1" aria-label="Previous">‹</a></li>';
    for (var i = 1; i <= tp; i++) {
      h += '<li class="page-item' + (i === p ? ' active' : '') + '"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
    }
    h += '<li class="page-item' + (p >= tp ? ' disabled' : '') + '"><a class="page-link" href="#" data-page="' + (p + 1) + '" aria-label="Next">›</a></li>';
    h += '</ul>';
    return h;
  }

  function updateAdsPagination(totalRows) {
    var wrap = document.getElementById('ads-pagination');
    if (!wrap) return;
    var pageSize = getAdsPageSize();
    var totalPages = Math.max(1, Math.ceil(Math.max(0, Number(totalRows) || 0) / pageSize));
    adsPage = clampPage(adsPage, totalPages);
    var show = totalPages > 1;
    wrap.classList.toggle('is-hidden', !show);
    if (!show) {
      wrap.innerHTML = '';
      return;
    }
    wrap.innerHTML = buildPagerHtml(adsPage, totalPages);
  }

  (function bindAdsPagination() {
    var wrap = document.getElementById('ads-pagination');
    if (!wrap || wrap.getAttribute('data-ads-pagination-bound') === '1') return;
    wrap.setAttribute('data-ads-pagination-bound', '1');
    wrap.addEventListener('click', function(e) {
      var link = e.target && e.target.closest ? e.target.closest('a[data-page]') : null;
      if (!link) return;
      e.preventDefault();
      if (link.closest('.page-item.disabled') || link.closest('.page-item.active')) return;
      var next = parseInt(link.getAttribute('data-page') || '0', 10);
      if (!next || next < 1) return;
      adsPage = next;
      var root = document.getElementById('ads-root');
      if (root && _lastSummary) render(root, _lastStatus, _lastSummary, _lastRefreshResult);
    });
  })();

  function sortCampaigns(campaigns) {
    var def = null;
    for (var i = 0; i < COL_DEFS.length; i++) { if (COL_DEFS[i].key === sortKey) { def = COL_DEFS[i]; break; } }
    if (!def) return campaigns;
    var dir = sortDesc ? -1 : 1;
    return campaigns.slice().sort(function (a, b) {
      var va = def.get(a), vb = def.get(b);
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * ((va || 0) - (vb || 0));
    });
  }

  /* ── modal ───────────────────────────────────────────────── */

  var adsOverviewChart = null;
  var modalChart = null;
  var chartJsLoading = null;
  var _modalCampaignId = null;
  var _modalCampaignName = null;
  var _modalCustomRangeKey = null;
  var _modalCampaignReqId = 0;
  var _modalRangePicker = null;

  function setModalCustomRangeVisible(show) {
    var inp = document.getElementById('ads-modal-range-custom');
    if (!inp) return;
    inp.style.display = show ? '' : 'none';
  }

  function parseModalCustomRangeKey() {
    var inp = document.getElementById('ads-modal-range-custom');
    var s = inp ? String(inp.value || '').trim() : '';
    if (!s) return null;
    var m = s.match(/(\d{4}-\d{2}-\d{2}).*?(\d{4}-\d{2}-\d{2})/);
    if (!m) return null;
    return 'r:' + m[1] + ':' + m[2];
  }

  function getModalRangeKey() {
    var sel = document.getElementById('ads-modal-range-select');
    var v = sel && sel.value != null ? String(sel.value).trim() : 'page';
    if (!v || v === 'page') return computeRangeKey();
    if (v === 'custom') return _modalCustomRangeKey || parseModalCustomRangeKey() || computeRangeKey();
    return normalizeRangeKeyForApi(v);
  }

  function resetModalRangeUi() {
    var sel = document.getElementById('ads-modal-range-select');
    if (sel) sel.value = 'page';
    var inp = document.getElementById('ads-modal-range-custom');
    if (inp) { inp.value = ''; inp.style.display = 'none'; }
    _modalCustomRangeKey = null;
  }

  function ensureModalRangePicker() {
    var inp = document.getElementById('ads-modal-range-custom');
    if (!inp) return null;
    if (_modalRangePicker) return _modalRangePicker;
    try {
      if (typeof flatpickr === 'undefined') return null;
      _modalRangePicker = flatpickr(inp, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        allowInput: true,
        maxDate: new Date(),
        onClose: function () {
          var key = parseModalCustomRangeKey();
          if (key) {
            _modalCustomRangeKey = key;
            refreshCampaignModal();
          }
        },
      });
      return _modalRangePicker;
    } catch (_) {
      return null;
    }
  }

  function bindModalRangeControls() {
    var sel = document.getElementById('ads-modal-range-select');
    var inp = document.getElementById('ads-modal-range-custom');
    if (sel && sel.getAttribute('data-bound') !== '1') {
      sel.setAttribute('data-bound', '1');
      sel.addEventListener('change', function () {
        var v = sel.value != null ? String(sel.value).trim() : '';
        if (v === 'custom') {
          setModalCustomRangeVisible(true);
          var picker = ensureModalRangePicker();
          try { if (picker && typeof picker.open === 'function') picker.open(); } catch (_) {}
          var key = parseModalCustomRangeKey();
          if (key) {
            _modalCustomRangeKey = key;
            refreshCampaignModal();
          }
          return;
        }
        setModalCustomRangeVisible(false);
        refreshCampaignModal();
      });
    }
    if (inp && inp.getAttribute('data-bound') !== '1') {
      inp.setAttribute('data-bound', '1');
      inp.addEventListener('change', function () {
        var key = parseModalCustomRangeKey();
        if (key) {
          _modalCustomRangeKey = key;
          refreshCampaignModal();
        }
      });
    }
  }

  function refreshCampaignModal() {
    var modal = document.getElementById('ads-campaign-modal');
    if (!modal || !modal.classList.contains('open')) return;
    if (!_modalCampaignId) return;

    var salesEl = document.getElementById('ads-modal-sales');
    if (salesEl) salesEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Loading…</div>';
    var countriesEl = document.getElementById('ads-modal-countries');
    if (countriesEl) countriesEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Loading…</div>';
    var devicesEl = document.getElementById('ads-modal-devices');
    if (devicesEl) devicesEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Loading…</div>';
    var networksEl = document.getElementById('ads-modal-networks');
    if (networksEl) networksEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Loading…</div>';
    var dayEl = document.getElementById('ads-modal-dayparting');
    if (dayEl) dayEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Loading…</div>';

    var countryNoteEl = document.getElementById('ads-modal-country-note');
    if (countryNoteEl) countryNoteEl.textContent = '';
    var deviceNoteEl = document.getElementById('ads-modal-device-note');
    if (deviceNoteEl) deviceNoteEl.textContent = '';
    var networkNoteEl = document.getElementById('ads-modal-network-note');
    if (networkNoteEl) networkNoteEl.textContent = '';
    var dayNoteEl = document.getElementById('ads-modal-dayparting-note');
    if (dayNoteEl) dayNoteEl.textContent = '';

    if (modalChart) { try { modalChart.destroy(); } catch (_) {} modalChart = null; }

    var rangeKey = getModalRangeKey();
    var reqId = ++_modalCampaignReqId;
    var campaignId = _modalCampaignId;
    fetchJson('/api/ads/campaign-detail?range=' + encodeURIComponent(rangeKey) + '&campaignId=' + encodeURIComponent(campaignId))
      .then(function (data) {
        // If another request started, ignore stale results.
        if (reqId !== _modalCampaignReqId) return;
        // If the modal was closed while loading, skip rendering.
        try {
          var m = document.getElementById('ads-campaign-modal');
          if (!m || !m.classList.contains('open')) return;
        } catch (_) {}

        if (!data || !data.ok) {
          if (salesEl) salesEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No data available.</div>';
          if (countriesEl) countriesEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No data available.</div>';
          if (devicesEl) devicesEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No data available.</div>';
          if (networksEl) networksEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No data available.</div>';
          if (dayEl) dayEl.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No data available.</div>';
          return;
        }

        var currency = data.currency || 'GBP';
        ensureChartJs().then(function(ok) {
          try {
            var m2 = document.getElementById('ads-campaign-modal');
            if (!m2 || !m2.classList.contains('open')) return;
          } catch (_) {}
          if (!ok) {
            captureChartMessage('Chart.js failed to load for campaign modal.', 'adsModalChartJsLoad', { chartKey: 'ads-campaign-modal' }, 'error');
            return;
          }
          renderModalChart(data.chart || {}, currency);
        });

        renderModalCountries(data.countries || null, currency);
        renderModalDevices(data.devices || null, currency);
        renderModalNetworks(data.networks || null, currency);
        renderModalDayParting(data.dayParting || null, currency);
        renderModalSales(data.recentSales || [], currency);
      });
  }

  function getChartsUiItem(key) {
    var cfg = null;
    try { cfg = window.__kexoChartsUiConfigV1 || null; } catch (_) { cfg = null; }
    if (!cfg || cfg.v !== 1 || !Array.isArray(cfg.charts)) return null;
    var k = String(key == null ? '' : key).trim().toLowerCase();
    if (!k) return null;
    for (var i = 0; i < cfg.charts.length; i++) {
      var it = cfg.charts[i];
      if (!it || typeof it !== 'object') continue;
      var ik = it.key != null ? String(it.key).trim().toLowerCase() : '';
      if (ik && ik === k) return it;
    }
    return null;
  }

  function isMobileViewport() {
    try {
      return !!(window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches);
    } catch (_) {
      return false;
    }
  }

  function shouldHideChartsOnMobile() {
    var cfg = null;
    try { cfg = window.__kexoChartsUiConfigV1 || null; } catch (_) { cfg = null; }
    // Default ON when config is missing/outdated (project policy).
    if (!cfg || cfg.v !== 1) return true;
    return cfg.hideOnMobile !== false;
  }

  function isChartEnabledByUiConfig(key, fallbackEnabled) {
    if (shouldHideChartsOnMobile() && isMobileViewport()) return false;
    var it = getChartsUiItem(key);
    if (it && it.enabled === false) return false;
    return fallbackEnabled !== false;
  }

  function chartModeFromUiConfig(key, fallbackMode) {
    var it = getChartsUiItem(key);
    var m = it && it.mode != null ? String(it.mode).trim().toLowerCase() : '';
    if (m) return m;
    return String(fallbackMode || '').trim().toLowerCase() || '';
  }

  function chartColorsFromUiConfig(key, fallbackColors) {
    var it = getChartsUiItem(key);
    var arr = it && Array.isArray(it.colors) ? it.colors.filter(Boolean).map(function(c) { return String(c).trim(); }).filter(Boolean) : [];
    if (arr.length) return arr;
    return Array.isArray(fallbackColors) ? fallbackColors : [];
  }

  function isPlainObject(value) {
    return !!value && Object.prototype.toString.call(value) === '[object Object]';
  }

  function deepMergeOptions(base, override) {
    if (!isPlainObject(base) || !isPlainObject(override)) return base;
    Object.keys(override).forEach(function (key) {
      var next = override[key];
      if (Array.isArray(next)) {
        base[key] = next.slice();
        return;
      }
      if (isPlainObject(next)) {
        var cur = isPlainObject(base[key]) ? base[key] : {};
        base[key] = deepMergeOptions(cur, next);
        return;
      }
      base[key] = next;
    });
    return base;
  }

  function defaultChartStyleConfig() {
    return {
      curve: 'smooth',
      strokeWidth: 2.6,
      dashArray: 0,
      markerSize: 3,
      fillOpacity: 0.18,
      gridDash: 3,
      dataLabels: 'auto',
      toolbar: false,
      animations: true,
    };
  }

  function normalizeChartType(value, fallback) {
    var v = String(value || '').trim().toLowerCase();
    if (v === 'multi-line-labels') return 'line';
    if (['area', 'line', 'bar', 'pie', 'combo'].indexOf(v) >= 0) return v;
    return fallback || 'line';
  }

  function normalizeChartStyle(raw) {
    var src = isPlainObject(raw) ? raw : {};
    var def = defaultChartStyleConfig();
    var curve = String(src.curve != null ? src.curve : def.curve).trim().toLowerCase();
    if (curve !== 'smooth' && curve !== 'straight' && curve !== 'stepline') curve = def.curve;
    var labelsMode = String(src.dataLabels != null ? src.dataLabels : def.dataLabels).trim().toLowerCase();
    if (labelsMode !== 'auto' && labelsMode !== 'on' && labelsMode !== 'off') labelsMode = def.dataLabels;
    function n(v, fb, min, max) {
      var x = Number(v);
      if (!Number.isFinite(x)) x = Number(fb);
      if (!Number.isFinite(x)) x = min;
      if (x < min) x = min;
      if (x > max) x = max;
      return x;
    }
    return {
      curve: curve,
      strokeWidth: n(src.strokeWidth, def.strokeWidth, 0, 8),
      dashArray: n(src.dashArray, def.dashArray, 0, 20),
      markerSize: n(src.markerSize, def.markerSize, 0, 12),
      fillOpacity: n(src.fillOpacity, def.fillOpacity, 0, 1),
      gridDash: n(src.gridDash, def.gridDash, 0, 16),
      dataLabels: labelsMode,
      toolbar: !!src.toolbar,
      animations: src.animations !== false,
    };
  }

  function chartStyleOverrideFromUiConfig(key, modeHint) {
    var it = getChartsUiItem(key);
    var style = normalizeChartStyle(it && isPlainObject(it.style) ? it.style : {});
    var mode = normalizeChartType(modeHint || 'line', 'line');
    var out = {
      chart: {
        toolbar: { show: !!style.toolbar },
        animations: { enabled: !!style.animations }
      },
      grid: { strokeDashArray: style.gridDash }
    };
    if (style.dataLabels === 'on') out.dataLabels = { enabled: true };
    if (style.dataLabels === 'off') out.dataLabels = { enabled: false };
    if (mode !== 'pie') {
      out.stroke = {
        show: true,
        curve: style.curve,
        width: mode === 'bar' ? 0 : style.strokeWidth,
        lineCap: 'round',
        dashArray: mode === 'bar' ? 0 : style.dashArray
      };
      out.markers = { size: mode === 'line' ? style.markerSize : 0, hover: { size: Math.max(4, style.markerSize + 2) } };
      if (mode === 'area') {
        out.fill = { type: 'gradient', gradient: { opacityFrom: style.fillOpacity, opacityTo: Math.max(0, style.fillOpacity * 0.35), stops: [0, 100] } };
      } else if (mode === 'bar') {
        out.fill = { type: 'solid', opacity: style.fillOpacity > 0 ? style.fillOpacity : 1 };
      }
    }
    return out;
  }

  function chartAdvancedOverrideFromUiConfig(key, modeHint) {
    var it = getChartsUiItem(key);
    var raw = it && isPlainObject(it.advancedApexOverride) ? it.advancedApexOverride : null;
    var merged = {};
    var styleOverride = chartStyleOverrideFromUiConfig(key, modeHint);
    if (styleOverride && isPlainObject(styleOverride)) deepMergeOptions(merged, styleOverride);
    if (raw) deepMergeOptions(merged, raw);
    return Object.keys(merged).length ? merged : null;
  }

  function shortCampaignLabel(value, maxLen) {
    var raw = value == null ? '' : String(value).trim();
    var cap = Math.max(10, Number(maxLen) || 24);
    if (!raw) return '—';
    if (raw.length <= cap) return raw;
    return raw.slice(0, cap - 1) + '…';
  }

  function clearAdsOverviewChart(message) {
    var el = document.getElementById('ads-overview-chart');
    if (!el) return;
    if (adsOverviewChart) {
      try { adsOverviewChart.destroy(); } catch (_) {}
      adsOverviewChart = null;
    }
    el.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:240px;color:var(--tblr-secondary);font-size:.875rem;">' +
      esc(message || 'No campaign data for this range') +
      '</div>';
    var msg = String(message == null ? '' : message).trim().toLowerCase();
    if (msg && (msg.indexOf('failed') >= 0 || msg.indexOf('error') >= 0)) {
      captureChartMessage(message, 'adsOverviewState', { chartKey: 'ads-overview-chart' }, 'error');
    }
  }

  function renderAdsOverviewChart(summary) {
    var el = document.getElementById('ads-overview-chart');
    if (!el) return;
    if (typeof ApexCharts === 'undefined') {
      // Avoid an unbounded retry loop if the CDN is blocked (adblock/network).
      const tries = (el.__kexoApexWaitTries || 0) + 1;
      el.__kexoApexWaitTries = tries;
      if (tries >= 25) {
        el.__kexoApexWaitTries = 0;
        captureChartMessage('Chart library failed to load.', 'adsOverviewLibraryLoad', { chartKey: 'ads-overview-chart', tries: tries }, 'error');
        clearAdsOverviewChart('Chart library failed to load.');
        return;
      }
      setTimeout(function () { renderAdsOverviewChart(summary); }, 180);
      return;
    }
    try { el.__kexoApexWaitTries = 0; } catch (_) {}
    var chartKey = 'ads-overview-chart';
    if (!isChartEnabledByUiConfig(chartKey, true)) {
      clearAdsOverviewChart('Chart disabled in Settings');
      return;
    }
    var campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns.slice() : [];
    var currency = summary && summary.currency ? String(summary.currency) : 'GBP';
    campaigns = campaigns.filter(Boolean).sort(function (a, b) {
      return (Number((b && b.revenue) || 0) - Number((a && a.revenue) || 0));
    }).slice(0, 8);
    if (!campaigns.length) {
      clearAdsOverviewChart('No campaign data for this range');
      return;
    }

    var categories = campaigns.map(function (c) { return shortCampaignLabel(c.campaignName || c.campaignId || '—', 24); });
    var spendSeries = campaigns.map(function (c) { return Number((c && c.spend) || 0); });
    var salesSeries = campaigns.map(function (c) { return Number((c && c.revenue) || 0); });
    var roasSeries = campaigns.map(function (c) {
      var spend = Number((c && c.spend) || 0);
      var revenue = Number((c && c.revenue) || 0);
      return spend > 0 ? (revenue / spend) : 0;
    });
    var valid = categories.length > 0 && [spendSeries, salesSeries, roasSeries].every(function (arr) {
      return Array.isArray(arr) && arr.length === categories.length && arr.every(function(v) { return Number.isFinite(v); });
    });
    if (!valid) {
      clearAdsOverviewChart('No campaign data for this range');
      return;
    }

    if (adsOverviewChart) {
      try { adsOverviewChart.destroy(); } catch (_) {}
      adsOverviewChart = null;
    }
    el.innerHTML = '';

    try {
      var rawMode = chartModeFromUiConfig(chartKey, 'bar') || 'bar';
      var showEndLabels = rawMode === 'multi-line-labels';
      var mode = rawMode === 'multi-line-labels' ? 'line' : rawMode;
      var palette = chartColorsFromUiConfig(chartKey, ['#3eb3ab', '#ef4444', '#4b94e4']);

      var seriesCfg;
      var fillCfg;
      var profitSeries;
      var barColors;
      if (mode === 'bar') {
        profitSeries = campaigns.map(function (c) {
          var rev = Number((c && c.revenue) || 0);
          var sp = Number((c && c.spend) || 0);
          return rev - sp;
        });
        seriesCfg = [{ name: 'Profit', type: 'bar', data: profitSeries }];
        fillCfg = { type: 'solid', opacity: 1 };
        barColors = profitSeries.map(function (v) { return v >= 0 ? '#22c55e' : '#ef4444'; });
      } else if (mode === 'line') {
        seriesCfg = [
          { name: 'Sales', type: 'line', data: salesSeries },
          { name: 'Spend', type: 'line', data: spendSeries },
          { name: 'ROAS', type: 'line', data: roasSeries },
        ];
        // ApexCharts 4.x can hide line strokes when fill opacity is 0.
        // Keep opacity at 1; line charts still render without an area fill.
        fillCfg = { type: 'solid', opacity: 1 };
      } else if (mode === 'area') {
        seriesCfg = [
          { name: 'Sales', type: 'area', data: salesSeries },
          { name: 'Spend', type: 'area', data: spendSeries },
          { name: 'ROAS', type: 'area', data: roasSeries },
        ];
        fillCfg = { type: ['gradient', 'gradient', 'gradient'], gradient: { opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } };
      } else {
        seriesCfg = [
          { name: 'Sales', type: 'area', data: salesSeries },
          { name: 'Spend', type: 'area', data: spendSeries },
          { name: 'ROAS', type: 'line', data: roasSeries },
        ];
        fillCfg = { type: ['gradient', 'gradient', 'solid'], gradient: { opacityFrom: 0.28, opacityTo: 0.08, stops: [0, 100] } };
      }

      var chartOpts = {
        chart: {
          type: mode === 'bar' ? 'bar' : 'line',
          height: 252,
          fontFamily: 'Inter, sans-serif',
          toolbar: { show: false },
        },
        series: seriesCfg,
        colors: mode === 'bar' ? barColors : palette,
        stroke: mode === 'bar' ? { show: true, width: 0 } : { show: true, width: [2.6, 2.4, 3], curve: 'smooth', lineCap: 'round' },
        fill: fillCfg,
        plotOptions: mode === 'bar' ? {
          bar: { horizontal: true, columnWidth: '70%', borderRadius: 4, distributed: true },
        } : {},
        markers: mode === 'bar' ? { size: 0 } : { size: 3, hover: { size: 5 } },
        dataLabels: (showEndLabels && mode !== 'bar') ? {
          enabled: true,
          formatter: function(val, ctx) {
            try {
              var dp = ctx && ctx.dataPointIndex != null ? Number(ctx.dataPointIndex) : -1;
              var w = ctx && ctx.w ? ctx.w : null;
              var last = w && w.globals && Array.isArray(w.globals.labels) ? (w.globals.labels.length - 1) : -1;
              if (dp !== last) return '';
            } catch (_) { return ''; }
            var idx = ctx && ctx.seriesIndex != null ? Number(ctx.seriesIndex) : 0;
            return idx === 2 ? fmtRoas(val) : fmtMoney(val, currency);
          },
          style: { fontSize: '10px' },
          background: { enabled: true, borderRadius: 4, padding: 3, opacity: 0.85 },
          offsetY: -3,
        } : { enabled: false },
        xaxis: mode === 'bar' ? {
          categories: categories,
          labels: {
            style: { fontSize: '11px' },
            formatter: function (v) { return fmtMoney(Number(v), currency); },
          },
          tickAmount: 6,
        } : {
          categories: categories,
          labels: {
            style: { fontSize: '11px' },
            rotate: -18,
            hideOverlappingLabels: false,
            trim: true,
          },
        },
        yaxis: mode === 'bar' ? {
          labels: { style: { fontSize: '11px' } },
          forceNiceScale: true,
        } : [
          {
            min: 0,
            forceNiceScale: true,
            labels: {
              style: { fontSize: '11px' },
              formatter: function (v) { return fmtMoney(v, currency); },
            },
          },
          {
            min: 0,
            forceNiceScale: true,
            show: false,
            labels: { show: false },
          },
          {
            min: 0,
            opposite: true,
            forceNiceScale: true,
            labels: {
              style: { fontSize: '11px' },
              formatter: function (v) { return fmtRoas(v); },
            },
          }
        ],
        tooltip: {
          shared: mode !== 'bar',
          intersect: mode === 'bar',
          y: {
            formatter: function (v, opts) {
              if (mode === 'bar') return fmtMoney(v, currency);
              var idx = opts && opts.seriesIndex != null ? Number(opts.seriesIndex) : 0;
              return idx === 2 ? fmtRoas(v) : fmtMoney(v, currency);
            },
          },
        },
        legend: {
          position: 'top',
          fontSize: '12px',
          markers: { radius: 10 },
        },
        grid: { borderColor: '#f0f0f0', strokeDashArray: 3 },
      };
      try {
        var adsOverride = chartAdvancedOverrideFromUiConfig(chartKey, mode);
        if (adsOverride && isPlainObject(adsOverride)) {
          chartOpts = deepMergeOptions(chartOpts, adsOverride);
        }
      } catch (_) {}
      adsOverviewChart = new ApexCharts(el, chartOpts);
      var renderPromise = adsOverviewChart.render();
      if (renderPromise && typeof renderPromise.then === 'function') {
        renderPromise.catch(function (err) {
          captureChartError(err || new Error('Ads overview chart rendering failed'), 'adsOverviewRender', { chartKey: 'ads-overview-chart' });
          clearAdsOverviewChart('Chart rendering failed');
        });
      }
    } catch (err) {
      captureChartError(err, 'adsOverviewRender', { chartKey: 'ads-overview-chart' });
      clearAdsOverviewChart('Chart rendering failed');
    }
  }

  function ensureModalDom() {
    if (document.getElementById('ads-campaign-modal')) return;
    var overlay = document.createElement('div');
    overlay.id = 'ads-campaign-modal';
    overlay.className = 'ads-modal-overlay';
    overlay.innerHTML =
      '<div class="ads-modal-box">' +
        '<div class="ads-modal-header">' +
          '<h3 class="ads-modal-title"></h3>' +
          '<button type="button" class="ads-modal-close" aria-label="Close">&times;</button>' +
        '</div>' +
        '<div class="ads-modal-body">' +
          '<div class="ads-modal-range-row">' +
            '<div class="ads-modal-range-label">Range</div>' +
            '<select id="ads-modal-range-select" class="form-select form-select-sm ads-modal-range-select" aria-label="Campaign range">' +
              '<option value="page">Same as page</option>' +
              '<option value="today">Today</option>' +
              '<option value="yesterday">Yesterday</option>' +
              '<option value="7d">Last 7 days</option>' +
              '<option value="14d">Last 14 days</option>' +
              '<option value="30d">Last 30 days</option>' +
              '<option value="month">This month</option>' +
              '<option value="custom">Custom…</option>' +
            '</select>' +
            '<input id="ads-modal-range-custom" class="form-control form-control-sm ads-modal-range-custom" placeholder="YYYY-MM-DD to YYYY-MM-DD" style="display:none" />' +
          '</div>' +
          '<div class="ads-modal-chart-wrap"><canvas id="ads-modal-chart" height="200"></canvas></div>' +
          '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Country performance</h4>' +
          '<div class="text-muted small" id="ads-modal-country-note" style="margin:-4px 0 8px;"></div>' +
          '<div id="ads-modal-countries"></div>' +
          '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Device performance</h4>' +
          '<div class="text-muted small" id="ads-modal-device-note" style="margin:-4px 0 8px;"></div>' +
          '<div id="ads-modal-devices"></div>' +
          '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Network</h4>' +
          '<div class="text-muted small" id="ads-modal-network-note" style="margin:-4px 0 8px;"></div>' +
          '<div id="ads-modal-networks"></div>' +
          '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Day parting</h4>' +
          '<div class="text-muted small" id="ads-modal-dayparting-note" style="margin:-4px 0 8px;"></div>' +
          '<div id="ads-modal-dayparting"></div>' +
          '<h4 style="margin:16px 0 8px;font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">Recent sales</h4>' +
          '<div id="ads-modal-sales"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('.ads-modal-close').addEventListener('click', closeModal);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(); });
    bindModalRangeControls();
  }

  function ensureChartJs() {
    try { if (typeof Chart !== 'undefined') return Promise.resolve(true); } catch (_) {}
    if (chartJsLoading) return chartJsLoading;

    chartJsLoading = new Promise(function(resolve) {
      try {
        // If a tag exists (possibly still loading), attach listeners.
        var existing = document.querySelector('script[data-chart-js="1"]');
        if (existing) {
          try { if (typeof Chart !== 'undefined') { resolve(true); return; } } catch (_) {}
          existing.addEventListener('load', function() { resolve(true); }, { once: true });
          existing.addEventListener('error', function() { resolve(false); }, { once: true });
          return;
        }

        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
        s.async = true;
        s.defer = true;
        s.setAttribute('data-chart-js', '1');
        s.onload = function() {
          try { resolve(typeof Chart !== 'undefined'); } catch (_) { resolve(false); }
        };
        s.onerror = function() { resolve(false); };
        document.head.appendChild(s);
      } catch (_) {
        resolve(false);
      }
    }).finally(function() {
      chartJsLoading = null;
    });

    return chartJsLoading;
  }

  function closeModal() {
    var el = document.getElementById('ads-campaign-modal');
    if (el) el.classList.remove('open');
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} modalChart = null; }
    _modalCampaignId = null;
    _modalCampaignName = null;
    _modalCampaignReqId++;
    resetModalRangeUi();
  }

  function ensureErrorsModalDom() {
    if (document.getElementById('ads-errors-modal')) return;
    var wrap = document.createElement('div');
    wrap.className = 'modal modal-blur';
    wrap.id = 'ads-errors-modal';
    wrap.tabIndex = -1;
    wrap.style.display = 'none';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="dialog">' +
        '<div class="modal-content">' +
          '<div class="modal-header">' +
            '<h5 class="modal-title">Errors detected</h5>' +
            '<button type="button" class="btn-close" id="ads-errors-close" aria-label="Close"></button>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div id="ads-errors-body"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var closeBtn = document.getElementById('ads-errors-close');
    if (closeBtn) closeBtn.addEventListener('click', closeErrorsModal);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeErrorsModal(); });

    // One-time ESC handler.
    try {
      if (!window.__adsErrorsEscBound) {
        window.__adsErrorsEscBound = true;
        document.addEventListener('keydown', function (e) {
          if (!e || e.key !== 'Escape') return;
          closeErrorsModal();
        });
      }
    } catch (_) {}
  }

  function closeErrorsModal() {
    var el = document.getElementById('ads-errors-modal');
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function openErrorsModal(errors, payload) {
    ensureErrorsModalDom();
    var modal = document.getElementById('ads-errors-modal');
    var body = document.getElementById('ads-errors-body');
    if (!modal || !body) return;
    var errs = Array.isArray(errors) ? errors : [];
    var h = '';
    if (!errs.length) {
      h += '<div class="muted" style="padding:12px;text-align:center;">No errors.</div>';
    } else {
      h += '<div class="text-muted small" style="margin-bottom:10px;">' + esc(String(errs.length)) + ' issue(s) detected.</div>';
      h += '<ul class="ads-errors-list">';
      for (var i = 0; i < errs.length; i++) {
        var e = errs[i] || {};
        h += '<li><span class="ads-errors-title">' + esc(e.title || 'Error') + '</span>' +
          (e.detail ? ('<div class="ads-errors-detail">' + esc(e.detail) + '</div>') : '') +
        '</li>';
      }
      h += '</ul>';
    }
    if (payload) {
      h += '<div class="text-muted small" style="margin:14px 0 6px;">Diagnostics</div>';
      h += '<pre class="ads-errors-pre">' + esc(JSON.stringify(payload, null, 2)) + '</pre>';
    }
    body.innerHTML = h;
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  var _auditInFlight = null;
  function ensureAuditModalDom() {
    if (document.getElementById('ads-audit-modal')) return;
    var wrap = document.createElement('div');
    wrap.className = 'modal modal-blur';
    wrap.id = 'ads-audit-modal';
    wrap.tabIndex = -1;
    wrap.style.display = 'none';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="dialog">' +
        '<div class="modal-content">' +
          '<div class="modal-header">' +
            '<h5 class="modal-title">Audit &amp; Coverage</h5>' +
            '<div class="ms-auto d-flex align-items-center gap-2">' +
              '<button type="button" class="btn btn-icon btn-ghost-secondary" id="ads-audit-refresh" title="Refresh" aria-label="Refresh">' +
                '<i class="fa-light fa-rotate-right" aria-hidden="true"></i>' +
              '</button>' +
              '<button type="button" class="btn-close" id="ads-audit-close" aria-label="Close"></button>' +
            '</div>' +
          '</div>' +
          '<div class="modal-body">' +
            '<div id="ads-audit-body"></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var closeBtn = document.getElementById('ads-audit-close');
    if (closeBtn) closeBtn.addEventListener('click', closeAuditModal);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeAuditModal(); });

    var refreshBtn = document.getElementById('ads-audit-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function (e) {
        e.preventDefault();
        fetchAndRenderAudit({ force: true });
      });
    }

    // One-time ESC handler.
    try {
      if (!window.__adsAuditEscBound) {
        window.__adsAuditEscBound = true;
        document.addEventListener('keydown', function (e) {
          if (!e || e.key !== 'Escape') return;
          closeAuditModal();
        });
      }
    } catch (_) {}
  }

  function closeAuditModal() {
    var el = document.getElementById('ads-audit-modal');
    if (!el) return;
    el.classList.remove('show');
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function renderAuditBody(data) {
    var body = document.getElementById('ads-audit-body');
    if (!body) return;
    if (!data || !data.ok) {
      body.innerHTML = '<div class="text-muted small" style="padding:10px;">No audit data available.</div>';
      return;
    }

    var ads = data.googleAds || {};
    var kexo = data.kexo || {};
    var orders = data.orders || {};
    var cov = data.coverage || {};

    var h = '';
    h += '<div class="text-muted small" style="margin-bottom:10px;">Range: <strong>' + esc(data.rangeKey || 'today') + '</strong></div>';

    h += '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">';
    h += '<div><strong>Click → session coverage:</strong> ' + esc(fmtPct(cov.clickToSession, 1)) +
      ' <span class="text-muted">(' + esc(fmtNum(kexo.sessionsWithClickId)) + ' sessions with click id / ' + esc(fmtNum(ads.clicks)) + ' Google clicks)</span></div>';
    h += '<div><strong>Session mapping coverage:</strong> ' + esc(fmtPct(cov.sessionMapping, 1)) +
      ' <span class="text-muted">(' + esc(fmtNum(kexo.sessionsWithCampaignAndClickId)) + ' sessions mapped to campaign / ' + esc(fmtNum(kexo.sessionsWithClickId)) + ' sessions with click id)</span></div>';
    h += '<div><strong>Order attribution coverage:</strong> ' + esc(fmtPct(cov.orderAttribution, 1)) +
      ' <span class="text-muted">(' + esc(fmtNum(orders.ordersWithCampaignId)) + ' orders with campaign id / ' + esc(fmtNum(orders.ordersTotal)) + ' attributed orders)</span></div>';
    if (cov.droppedClicksEstimate != null) {
      h += '<div class="text-muted small">Dropped clicks estimate: ' + esc(fmtNum(cov.droppedClicksEstimate)) + '</div>';
    }
    h += '</div>';

    h += '<div class="text-muted small" style="margin:12px 0 6px;">Raw counts</div>';
    h += '<table class="table table-sm table-vcenter"><tbody>';
    h += '<tr><td class="text-muted">Google spend (GBP)</td><td class="text-end">' + esc(fmtMoney(ads.spendGbp, 'GBP')) + '</td></tr>';
    h += '<tr><td class="text-muted">Google clicks</td><td class="text-end">' + esc(fmtNum(ads.clicks)) + '</td></tr>';
    h += '<tr><td class="text-muted">Google impressions</td><td class="text-end">' + esc(fmtNum(ads.impressions)) + '</td></tr>';
    h += '<tr><td class="text-muted">KEXO human sessions</td><td class="text-end">' + esc(fmtNum(kexo.humanSessions)) + '</td></tr>';
    h += '<tr><td class="text-muted">Sessions with gclid</td><td class="text-end">' + esc(fmtNum(kexo.sessionsWithGclid)) + '</td></tr>';
    h += '<tr><td class="text-muted">Sessions with gbraid</td><td class="text-end">' + esc(fmtNum(kexo.sessionsWithGbraid)) + '</td></tr>';
    h += '<tr><td class="text-muted">Sessions with wbraid</td><td class="text-end">' + esc(fmtNum(kexo.sessionsWithWbraid)) + '</td></tr>';
    h += '<tr><td class="text-muted">Sessions with any click id</td><td class="text-end">' + esc(fmtNum(kexo.sessionsWithClickId)) + '</td></tr>';
    h += '<tr><td class="text-muted">Sessions with campaign id</td><td class="text-end">' + esc(fmtNum(kexo.sessionsWithCampaignId)) + '</td></tr>';
    h += '<tr><td class="text-muted">Attributed orders (Ads DB)</td><td class="text-end">' + esc(fmtNum(orders.ordersTotal)) + '</td></tr>';
    h += '<tr><td class="text-muted">Attributed revenue (GBP)</td><td class="text-end">' + esc(fmtMoney(orders.revenueGbp, 'GBP')) + '</td></tr>';
    h += '</tbody></table>';

    if (Array.isArray(data.notes) && data.notes.length) {
      h += '<div class="text-muted small" style="margin:12px 0 6px;">Notes</div>';
      h += '<ul class="text-muted small" style="margin:0;padding-left:18px;">';
      for (var i = 0; i < data.notes.length; i++) {
        h += '<li>' + esc(String(data.notes[i] || '')) + '</li>';
      }
      h += '</ul>';
    }

    h += '<div class="text-muted small" style="margin:14px 0 6px;">Diagnostics</div>';
    h += '<pre class="ads-errors-pre">' + esc(JSON.stringify(data, null, 2)) + '</pre>';

    body.innerHTML = h;
  }

  function fetchAndRenderAudit(options) {
    ensureAuditModalDom();
    var force = !!(options && options.force);
    var body = document.getElementById('ads-audit-body');
    if (body) body.innerHTML = '<div class="text-muted small" style="padding:10px;">Loading…</div>';
    if (_auditInFlight) return _auditInFlight;
    var rangeKey = computeRangeKey();
    var bust = force ? ('&_=' + Date.now()) : '';
    _auditInFlight = fetchJson('/api/ads/audit?range=' + encodeURIComponent(rangeKey) + bust)
      .then(function (data) {
        renderAuditBody(data);
        return data;
      })
      .catch(function () {
        if (body) body.innerHTML = '<div class="text-danger small" style="padding:10px;">Could not load audit data.</div>';
        return null;
      })
      .finally(function () {
        _auditInFlight = null;
      });
    return _auditInFlight;
  }

  function openAuditModal() {
    ensureAuditModalDom();
    var modal = document.getElementById('ads-audit-modal');
    if (!modal) return;
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    fetchAndRenderAudit({ force: true });
  }

  function fetchIssuesSummary() {
    var shop = getShopParam();
    var path = '/api/integrations/google-ads/issues/summary' + (shop ? '?shop=' + encodeURIComponent(shop) : '');
    fetchJson(path).then(function (data) {
      if (!data || typeof data.open_count !== 'number') return;
      _issuesOpenCount = data.open_count;
      var badge = document.getElementById('ads-issues-badge');
      var countEl = document.getElementById('ads-issues-count');
      if (badge) badge.style.display = _issuesOpenCount > 0 ? 'inline-flex' : 'none';
      if (countEl) countEl.textContent = _issuesOpenCount > 0 ? String(_issuesOpenCount) : '';
    }).catch(function () {});
  }

  function closeIssuesModal() {
    var modal = document.getElementById('ads-issues-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('show');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
  }

  function openIssuesModal() {
    var modal = document.getElementById('ads-issues-modal');
    var body = document.getElementById('ads-issues-modal-body');
    var closeBtn = document.getElementById('ads-issues-modal-close');
    if (!modal || !body) return;
    closeBtn && (closeBtn.onclick = closeIssuesModal);
    body.innerHTML = '<div class="text-muted small">Loading…</div>';
    modal.style.display = 'block';
    modal.classList.add('show');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    var shop = getShopParam();
    var path = '/api/integrations/google-ads/issues' + (shop ? '?shop=' + encodeURIComponent(shop) : '') + '&status=open';
    fetch(baseApi() + path, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var issues = (data && data.issues) ? data.issues : [];
        var h = '';
        if (!issues.length) {
          h = '<div class="text-muted small">No open issues.</div>';
        } else {
          h = '<ul class="list-unstyled mb-0">';
          for (var i = 0; i < issues.length; i++) {
            var it = issues[i] || {};
            var id = it.id;
            var sev = (it.severity || 'error').toLowerCase();
            var msg = esc((it.error_message || it.error_code || 'Issue') + '');
            var goal = it.affected_goal ? esc(it.affected_goal) : '—';
            var fix = it.suggested_fix ? '<div class="small text-muted mt-1">' + esc(it.suggested_fix) + '</div>' : '';
            h += '<li class="border-bottom py-2" data-issue-id="' + esc(String(id || '')) + '">' +
              '<div class="d-flex justify-content-between align-items-start gap-2">' +
              '<div><span class="badge bg-' + (sev === 'warning' ? 'warning' : sev === 'info' ? 'info' : 'danger') + ' me-1">' + esc(it.severity || '') + '</span> ' + goal + '<div class="mt-1">' + msg + '</div>' + fix + '</div>' +
              (id ? ('<button type="button" class="btn btn-sm btn-outline-secondary ads-issue-resolve" data-id="' + esc(String(id)) + '">Resolve</button>') : '') +
              '</div></li>';
          }
          h += '</ul>';
        }
        body.innerHTML = h;
        body.querySelectorAll('.ads-issue-resolve').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            if (!id) return;
            btn.disabled = true;
            var resolvePath = '/api/integrations/google-ads/issues/' + encodeURIComponent(id) + '/resolve';
            if (shop) resolvePath += '?shop=' + encodeURIComponent(shop);
            fetch(baseApi() + resolvePath, {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resolution_note: 'Resolved from Integrations page' }),
            }).then(function () {
              openIssuesModal();
              fetchIssuesSummary();
              if (_lastStatus && _lastSummary) renderActionsBar(_lastStatus, _lastSummary);
            }).catch(function () { btn.disabled = false; });
          });
        });
      })
      .catch(function () {
        body.innerHTML = '<div class="text-danger small">Failed to load issues.</div>';
      });
  }

  function fetchGoalHealth() {
    var shop = getShopParam();
    var path = '/api/ads/google/goal-health' + (shop ? '?shop=' + encodeURIComponent(shop) : '');
    fetchJson(path).then(function (data) {
      if (!data || !data.ok) return;
      var el = document.getElementById('ads-goal-health-content');
      var card = document.getElementById('ads-goal-health-card');
      if (!el || !card) return;
      var goals = Array.isArray(data.goals) ? data.goals : [];
      var hasProvisionedGoal = goals.some(function (g) {
        return !!(g && g.conversion_action_resource_name);
      });
      if (!hasProvisionedGoal) {
        card.style.display = 'none';
        return;
      }
      var c7 = data.coverage_7d || {};
      var c30 = data.coverage_30d || {};
      var rec = data.reconciliation || {};
      var rev7 = (c7.revenue && (c7.revenue.success || 0) + (c7.revenue.pending || 0)) ? (c7.revenue.success + ' success, ' + (c7.revenue.pending || 0) + ' pending') : '—';
      var prof7 = (c7.profit && (c7.profit.success || 0) + (c7.profit.pending || 0)) ? (c7.profit.success + ' success, ' + (c7.profit.pending || 0) + ' pending') : '—';
      el.innerHTML = '<div class="mb-2"><strong>7d</strong> Revenue: ' + rev7 + ' · Profit: ' + prof7 + '</div>' +
        '<div class="mb-2"><strong>30d</strong> Revenue: ' + (c30.revenue ? (c30.revenue.success + ' success, ' + (c30.revenue.pending || 0) + ' pending') : '—') + ' · Profit: ' + (c30.profit ? (c30.profit.success + ' success, ' + (c30.profit.pending || 0) + ' pending') : '—') + '</div>' +
        '<div class="small">Missing click ID: ' + (rec.missing_click_id_orders != null ? rec.missing_click_id_orders : '—') + ' · Failed uploads: ' + (rec.failed_uploads != null ? rec.failed_uploads : '—') + '</div>';
      card.style.display = '';
    }).catch(function () {});
  }

  function openCampaignModal(campaignId, campaignName) {
    ensureModalDom();
    var modal = document.getElementById('ads-campaign-modal');
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} modalChart = null; }
    _modalCampaignId = campaignId != null ? String(campaignId).trim() : '';
    _modalCampaignName = campaignName != null ? String(campaignName) : '';
    if (!_modalCampaignId) return;

    resetModalRangeUi();
    modal.querySelector('.ads-modal-title').textContent = _modalCampaignName || _modalCampaignId || 'Campaign';
    modal.classList.add('open');
    refreshCampaignModal();
  }

  function renderModalChart(chart, currency) {
    if (typeof Chart === 'undefined') return;
    var canvas = document.getElementById('ads-modal-chart');
    if (!canvas) return;
    if (modalChart) { try { modalChart.destroy(); } catch (_) {} }
    try {
      modalChart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: chart.labels || [],
          datasets: [
            {
              label: 'Spend',
              data: chart.spend || [],
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239,68,68,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: 2,
              borderWidth: 2,
            },
            {
              label: 'Sales',
              data: chart.revenue || [],
              borderColor: '#0d9488',
              backgroundColor: 'rgba(13,148,136,0.08)',
              fill: true,
              tension: 0.3,
              pointRadius: 2,
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: {
            legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
            tooltip: {
              backgroundColor: 'rgba(0,0,0,0.8)', titleFont: { size: 12 }, bodyFont: { size: 12 },
              padding: 10, cornerRadius: 6,
              callbacks: {
                label: function (ctx) { return (ctx.dataset.label || '') + ': ' + (ctx.parsed.y != null ? fmtMoney(ctx.parsed.y, currency || 'GBP') : '—'); },
              },
            },
          },
          scales: {
            y: { beginAtZero: true, ticks: { callback: function (v) { return fmtMoney(v, currency || 'GBP'); }, font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.04)' } },
            x: { ticks: { font: { size: 11 }, maxRotation: 0 }, grid: { display: false } },
          },
        },
      });
    } catch (err) {
      captureChartError(err, 'adsCampaignModalChartRender', { chartKey: 'ads-campaign-modal' });
    }
  }

  function renderModalCountries(payload, currency) {
    var el = document.getElementById('ads-modal-countries');
    if (!el) return;
    var noteEl = document.getElementById('ads-modal-country-note');

    var data = (payload && typeof payload === 'object') ? payload : null;
    var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    var meta = (data && data.meta) ? data.meta : null;

    if (noteEl) {
      var parts = [];
      if (meta && meta.locationType) parts.push('Clicks/spend: ' + String(meta.locationType).replace(/_/g, ' ').toLowerCase());
      if (meta && meta.visitorCountryCoverage != null && meta.ordersTotal != null) {
        var cov = fmtPct(meta.visitorCountryCoverage, 0);
        var known = meta.ordersWithVisitorCountry != null ? fmtNum(meta.ordersWithVisitorCountry) : '—';
        var total = meta.ordersTotal != null ? fmtNum(meta.ordersTotal) : '—';
        parts.push('Revenue country coverage: ' + cov + ' (' + known + '/' + total + ' orders)');
      }
      noteEl.textContent = parts.join(' • ');
    }

    if (!data) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No country breakdown available.</div>';
      return;
    }
    if (data.ok === false) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Country breakdown unavailable.</div>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No country breakdown in this period.</div>';
      return;
    }

    var def = (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['ads-modal-countries-table']) || {};
    var tableHtml = typeof buildKexoSettingsTable === 'function'
      ? buildKexoSettingsTable({
          tableClass: (def.tableClass || 'ads-modal-countries-table'),
          columns: (def.columns || []).length ? def.columns : [
            { header: 'Country', headerClass: '' },
            { header: 'Clicks', headerClass: 'text-end' },
            { header: 'Spend', headerClass: 'text-end' },
            { header: 'Orders', headerClass: 'text-end' },
            { header: 'CR%', headerClass: 'text-end' },
            { header: 'Revenue', headerClass: 'text-end' },
            { header: 'ROAS', headerClass: 'text-end' }
          ],
          rows: rows,
          renderRow: function (r) {
            var code = r && r.country ? String(r.country).trim().toUpperCase() : '';
            var cc = code ? code.toLowerCase() : '';
            var flag = (cc && /^[a-z]{2}$/.test(cc)) ? '<span class="flag flag-xs flag-country-' + esc(cc) + '" style="vertical-align:middle;margin-right:4px;" aria-hidden="true"></span>' : '';
            var clicks = r && r.clicks != null ? r.clicks : 0;
            var rev = r && r.revenue != null ? r.revenue : 0;
            var vpv = (clicks > 0 && rev != null) ? (rev / clicks) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            return (
              '<tr>' +
                '<td>' + flag + esc(code || '—') + '</td>' +
                '<td class="text-end">' + esc(fmtNum(clicks)) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(r && r.spend != null ? r.spend : 0, currency || 'GBP')) + '</td>' +
                '<td class="text-end">' + esc(fmtNum(r && r.orders != null ? r.orders : 0)) + '</td>' +
                '<td class="text-end">' + esc(fmtPct(r && r.cr != null ? r.cr : null, 1)) + '</td>' +
                '<td class="text-end">' + esc(vpvStr) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(rev, currency || 'GBP')) + '</td>' +
                '<td class="text-end">' + esc(fmtRoas(r && r.roas != null ? r.roas : null)) + '</td>' +
              '</tr>'
            );
          }
        })
      : (function () {
          var h = '<table class="ads-modal-countries-table"><thead><tr><th>Country</th><th class="text-end">Clicks</th><th class="text-end">Spend</th><th class="text-end">Orders</th><th class="text-end">CR%</th><th class="text-end">VPV</th><th class="text-end">Revenue</th><th class="text-end">ROAS</th></tr></thead><tbody>';
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i] || {};
            var code = r.country ? String(r.country).trim().toUpperCase() : '';
            var cc = code ? code.toLowerCase() : '';
            var flag = (cc && /^[a-z]{2}$/.test(cc)) ? '<span class="flag flag-xs flag-country-' + esc(cc) + '" style="vertical-align:middle;margin-right:4px;" aria-hidden="true"></span>' : '';
            var clicks = r.clicks || 0;
            var vpv = (clicks > 0 && r.revenue != null) ? (r.revenue / clicks) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            h += '<tr><td>' + flag + esc(code || '—') + '</td>' +
              '<td class="text-end">' + esc(fmtNum(clicks)) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.spend || 0, currency || 'GBP')) + '</td>' +
              '<td class="text-end">' + esc(fmtNum(r.orders || 0)) + '</td>' +
              '<td class="text-end">' + esc(fmtPct(r.cr, 1)) + '</td>' +
              '<td class="text-end">' + esc(vpvStr) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.revenue || 0, currency || 'GBP')) + '</td>' +
              '<td class="text-end">' + esc(fmtRoas(r.roas)) + '</td></tr>';
          }
          return h + '</tbody></table>';
        })();

    el.innerHTML = tableHtml;
  }

  function renderModalDevices(payload, currency) {
    var el = document.getElementById('ads-modal-devices');
    if (!el) return;
    var noteEl = document.getElementById('ads-modal-device-note');

    var data = (payload && typeof payload === 'object') ? payload : null;
    var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    var meta = (data && data.meta) ? data.meta : null;

    if (noteEl) {
      var parts = [];
      if (meta && meta.visitorDeviceCoverage != null && meta.ordersTotal != null) {
        var cov = fmtPct(meta.visitorDeviceCoverage, 0);
        var known = meta.ordersWithVisitorDeviceType != null ? fmtNum(meta.ordersWithVisitorDeviceType) : '—';
        var total = meta.ordersTotal != null ? fmtNum(meta.ordersTotal) : '—';
        parts.push('Revenue device coverage: ' + cov + ' (' + known + '/' + total + ' orders)');
      }
      noteEl.textContent = parts.join(' • ');
    }

    if (!data) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No device breakdown available.</div>';
      return;
    }
    if (data.ok === false) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Device breakdown unavailable.</div>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No device breakdown in this period.</div>';
      return;
    }

    var def = (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['ads-modal-devices-table']) || {};
    var tableHtml = typeof buildKexoSettingsTable === 'function'
      ? buildKexoSettingsTable({
          tableClass: (def.tableClass || 'ads-modal-devices-table'),
          columns: (def.columns || []).length ? def.columns : [
            { header: 'Device', headerClass: '' },
            { header: 'Clicks', headerClass: 'text-end' },
            { header: 'Spend', headerClass: 'text-end' },
            { header: 'Orders', headerClass: 'text-end' },
            { header: 'CR%', headerClass: 'text-end' },
            { header: 'Revenue', headerClass: 'text-end' },
            { header: 'ROAS', headerClass: 'text-end' }
          ],
          rows: rows,
          renderRow: function (r) {
            var device = r && r.device ? String(r.device).trim() : '';
            var clicks = r && r.clicks != null ? r.clicks : 0;
            var rev = r && r.revenue != null ? r.revenue : 0;
            var vpv = (clicks > 0 && rev != null) ? (rev / clicks) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            return (
              '<tr>' +
                '<td>' + esc(device || '—') + '</td>' +
                '<td class="text-end">' + esc(fmtNum(clicks)) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(r && r.spend != null ? r.spend : 0, currency || 'GBP')) + '</td>' +
                '<td class="text-end">' + esc(fmtNum(r && r.orders != null ? r.orders : 0)) + '</td>' +
                '<td class="text-end">' + esc(fmtPct(r && r.cr != null ? r.cr : null, 1)) + '</td>' +
                '<td class="text-end">' + esc(vpvStr) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(rev, currency || 'GBP')) + '</td>' +
                '<td class="text-end">' + esc(fmtRoas(r && r.roas != null ? r.roas : null)) + '</td>' +
              '</tr>'
            );
          }
        })
      : (function () {
          var h = '<table class="ads-modal-devices-table"><thead><tr><th>Device</th><th class="text-end">Clicks</th><th class="text-end">Spend</th><th class="text-end">Orders</th><th class="text-end">CR%</th><th class="text-end">VPV</th><th class="text-end">Revenue</th><th class="text-end">ROAS</th></tr></thead><tbody>';
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i] || {};
            var device = r.device ? String(r.device).trim() : '';
            var clicks = r.clicks || 0;
            var vpv = (clicks > 0 && r.revenue != null) ? (r.revenue / clicks) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            h += '<tr><td>' + esc(device || '—') + '</td>' +
              '<td class="text-end">' + esc(fmtNum(clicks)) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.spend || 0, currency || 'GBP')) + '</td>' +
              '<td class="text-end">' + esc(fmtNum(r.orders || 0)) + '</td>' +
              '<td class="text-end">' + esc(fmtPct(r.cr, 1)) + '</td>' +
              '<td class="text-end">' + esc(vpvStr) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.revenue || 0, currency || 'GBP')) + '</td>' +
              '<td class="text-end">' + esc(fmtRoas(r.roas)) + '</td></tr>';
          }
          return h + '</tbody></table>';
        })();

    el.innerHTML = tableHtml;
  }

  function renderModalNetworks(payload, currency) {
    var el = document.getElementById('ads-modal-networks');
    if (!el) return;
    var noteEl = document.getElementById('ads-modal-network-note');

    var data = (payload && typeof payload === 'object') ? payload : null;
    var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    var meta = (data && data.meta) ? data.meta : null;

    if (noteEl) {
      var parts = [];
      if (meta && meta.sessionNetworkCoverage != null && meta.sessionsTotal != null) {
        var covS = fmtPct(meta.sessionNetworkCoverage, 0);
        var knownS = meta.sessionsWithNetwork != null ? fmtNum(meta.sessionsWithNetwork) : '—';
        var totalS = meta.sessionsTotal != null ? fmtNum(meta.sessionsTotal) : '—';
        parts.push('Session network coverage: ' + covS + ' (' + knownS + '/' + totalS + ')');
      }
      if (meta && meta.visitorNetworkCoverage != null && meta.ordersTotal != null) {
        var covO = fmtPct(meta.visitorNetworkCoverage, 0);
        var knownO = meta.ordersWithVisitorNetwork != null ? fmtNum(meta.ordersWithVisitorNetwork) : '—';
        var totalO = meta.ordersTotal != null ? fmtNum(meta.ordersTotal) : '—';
        parts.push('Order network coverage: ' + covO + ' (' + knownO + '/' + totalO + ' orders)');
      }
      parts.push('Codes: g=search, s=partners, d=display, x=pmax, ytv=youtube');
      noteEl.textContent = parts.join(' • ');
    }

    if (!data) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No network breakdown available.</div>';
      return;
    }
    if (data.ok === false) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Network breakdown unavailable.</div>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No network breakdown in this period.</div>';
      return;
    }

    var def = (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['ads-modal-networks-table']) || {};
    var tableHtml = typeof buildKexoSettingsTable === 'function'
      ? buildKexoSettingsTable({
          tableClass: (def.tableClass || 'ads-modal-networks-table'),
          columns: (def.columns || []).length ? def.columns : [
            { header: 'Network', headerClass: '' },
            { header: 'Sessions', headerClass: 'text-end' },
            { header: 'Orders', headerClass: 'text-end' },
            { header: 'CR%', headerClass: 'text-end' },
            { header: 'Revenue', headerClass: 'text-end' }
          ],
          rows: rows,
          renderRow: function (r) {
            var code = r && r.network ? String(r.network).trim().toLowerCase() : '';
            var label = r && r.label ? String(r.label).trim() : '';
            var name = label || (code ? code : '—');
            var title = label && code ? (label + ' (' + code + ')') : name;
            var sess = r && r.sessions != null ? r.sessions : 0;
            var rev = r && r.revenue != null ? r.revenue : 0;
            var vpv = (sess > 0 && rev != null) ? (rev / sess) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            return (
              '<tr>' +
                '<td>' + esc(title || '—') + '</td>' +
                '<td class="text-end">' + esc(fmtNum(sess)) + '</td>' +
                '<td class="text-end">' + esc(fmtNum(r && r.orders != null ? r.orders : 0)) + '</td>' +
                '<td class="text-end">' + esc(fmtPct(r && r.cr != null ? r.cr : null, 1)) + '</td>' +
                '<td class="text-end">' + esc(vpvStr) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(rev, currency || 'GBP')) + '</td>' +
              '</tr>'
            );
          }
        })
      : (function () {
          var h = '<table class="ads-modal-networks-table"><thead><tr><th>Network</th><th class="text-end">Sessions</th><th class="text-end">Orders</th><th class="text-end">CR%</th><th class="text-end">VPV</th><th class="text-end">Revenue</th></tr></thead><tbody>';
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i] || {};
            var code = r.network ? String(r.network).trim().toLowerCase() : '';
            var label = r.label ? String(r.label).trim() : '';
            var title = label && code ? (label + ' (' + code + ')') : (label || code || '—');
            var sess = r.sessions || 0;
            var vpv = (sess > 0 && r.revenue != null) ? (r.revenue / sess) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            h += '<tr><td>' + esc(title) + '</td>' +
              '<td class="text-end">' + esc(fmtNum(sess)) + '</td>' +
              '<td class="text-end">' + esc(fmtNum(r.orders || 0)) + '</td>' +
              '<td class="text-end">' + esc(fmtPct(r.cr, 1)) + '</td>' +
              '<td class="text-end">' + esc(vpvStr) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.revenue || 0, currency || 'GBP')) + '</td></tr>';
          }
          return h + '</tbody></table>';
        })();

    el.innerHTML = tableHtml;
  }

  function renderModalDayParting(payload, currency) {
    var el = document.getElementById('ads-modal-dayparting');
    if (!el) return;
    var noteEl = document.getElementById('ads-modal-dayparting-note');

    var data = (payload && typeof payload === 'object') ? payload : null;
    var rows = (data && Array.isArray(data.rows)) ? data.rows : [];
    var meta = (data && data.meta) ? data.meta : null;

    if (noteEl) {
      var parts = [];
      if (meta && meta.timeZone) parts.push('Timezone: ' + String(meta.timeZone));
      if (meta && meta.bestHour != null && meta.bestRoas != null) {
        var hh = String(meta.bestHour).padStart(2, '0') + ':00';
        parts.push('Best ROAS: ' + hh + ' (' + fmtRoas(meta.bestRoas) + ')');
      }
      noteEl.textContent = parts.join(' • ');
    }

    if (!data) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No day-parting breakdown available.</div>';
      return;
    }
    if (data.ok === false) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">Day-parting breakdown unavailable.</div>';
      return;
    }
    if (!rows.length) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No day-parting data in this period.</div>';
      return;
    }

    var def = (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['ads-modal-dayparting-table']) || {};
    var tableHtml = typeof buildKexoSettingsTable === 'function'
      ? buildKexoSettingsTable({
          tableClass: (def.tableClass || 'ads-modal-dayparting-table'),
          columns: (def.columns || []).length ? def.columns : [
            { header: 'Hour', headerClass: '' },
            { header: 'Clicks', headerClass: 'text-end' },
            { header: 'Spend', headerClass: 'text-end' },
            { header: 'Orders', headerClass: 'text-end' },
            { header: 'CR%', headerClass: 'text-end' },
            { header: 'Revenue', headerClass: 'text-end' },
            { header: 'ROAS', headerClass: 'text-end' }
          ],
          rows: rows,
          renderRow: function (r) {
            var label = r && r.label != null ? String(r.label) : (r && r.hour != null ? (String(r.hour).padStart(2, '0') + ':00') : '');
            var clicks = r && r.clicks != null ? r.clicks : 0;
            var rev = r && r.revenue != null ? r.revenue : 0;
            var vpv = (clicks > 0 && rev != null) ? (rev / clicks) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            return (
              '<tr>' +
                '<td>' + esc(label || '—') + '</td>' +
                '<td class="text-end">' + esc(fmtNum(clicks)) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(r && r.spend != null ? r.spend : 0, currency || 'GBP')) + '</td>' +
                '<td class="text-end">' + esc(fmtNum(r && r.orders != null ? r.orders : 0)) + '</td>' +
                '<td class="text-end">' + esc(fmtPct(r && r.cr != null ? r.cr : null, 1)) + '</td>' +
                '<td class="text-end">' + esc(vpvStr) + '</td>' +
                '<td class="text-end">' + esc(fmtMoney(rev, currency || 'GBP')) + '</td>' +
                '<td class="text-end">' + esc(fmtRoas(r && r.roas != null ? r.roas : null)) + '</td>' +
              '</tr>'
            );
          }
        })
      : (function () {
          var h = '<table class="ads-modal-dayparting-table"><thead><tr><th>Hour</th><th class="text-end">Clicks</th><th class="text-end">Spend</th><th class="text-end">Orders</th><th class="text-end">CR%</th><th class="text-end">VPV</th><th class="text-end">Revenue</th><th class="text-end">ROAS</th></tr></thead><tbody>';
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i] || {};
            var label = r.label != null ? String(r.label) : (r.hour != null ? (String(r.hour).padStart(2, '0') + ':00') : '');
            var clicks = r.clicks || 0;
            var vpv = (clicks > 0 && r.revenue != null) ? (r.revenue / clicks) : null;
            var vpvStr = vpv != null ? fmtMoney(vpv, currency || 'GBP') : '—';
            h += '<tr><td>' + esc(label || '—') + '</td>' +
              '<td class="text-end">' + esc(fmtNum(clicks)) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.spend || 0, currency || 'GBP')) + '</td>' +
              '<td class="text-end">' + esc(fmtNum(r.orders || 0)) + '</td>' +
              '<td class="text-end">' + esc(fmtPct(r.cr, 1)) + '</td>' +
              '<td class="text-end">' + esc(vpvStr) + '</td>' +
              '<td class="text-end">' + esc(fmtMoney(r.revenue || 0, currency || 'GBP')) + '</td>' +
              '<td class="text-end">' + esc(fmtRoas(r.roas)) + '</td></tr>';
          }
          return h + '</tbody></table>';
        })();

    el.innerHTML = tableHtml;
  }

  function renderModalSales(sales, currency) {
    var el = document.getElementById('ads-modal-sales');
    if (!el) return;
    if (!sales.length) {
      el.innerHTML = '<div class="muted" style="padding:12px;text-align:center;">No attributed sales in this period.</div>';
      return;
    }
    var def = (window.KEXO_APP_MODAL_TABLE_DEFS && window.KEXO_APP_MODAL_TABLE_DEFS['ads-modal-sales-table']) || {};
    var tableHtml = typeof buildKexoSettingsTable === 'function'
      ? buildKexoSettingsTable({
          tableClass: (def.tableClass || 'ads-modal-sales-table'),
          columns: (def.columns || []).length ? def.columns : [
            { header: 'Country', headerClass: '' },
            { header: 'Value', headerClass: '' },
            { header: 'Time', headerClass: '' }
          ],
          rows: sales,
          renderRow: function (s) {
            var cc = s.country ? s.country.toLowerCase() : '';
            var flag = (cc && /^[a-z]{2}$/.test(cc)) ? '<span class="flag flag-xs flag-country-' + esc(cc) + '" style="vertical-align:middle;margin-right:4px;" aria-hidden="true"></span>' : '';
            return '<tr><td>' + flag + esc(s.country || '—') + '</td><td>' + esc(fmtMoney(s.value, currency)) + '</td><td>' + esc(fmtTime(s.time)) + '</td></tr>';
          }
        })
      : (function () {
          var h = '<table class="ads-modal-sales-table"><thead><tr><th>Country</th><th>Value</th><th>Time</th></tr></thead><tbody>';
          for (var i = 0; i < sales.length; i++) {
            var s = sales[i];
            var cc = s.country ? s.country.toLowerCase() : '';
            var flag = (cc && /^[a-z]{2}$/.test(cc)) ? '<span class="flag flag-xs flag-country-' + esc(cc) + '" style="vertical-align:middle;margin-right:4px;" aria-hidden="true"></span>' : '';
            h += '<tr><td>' + flag + esc(s.country || '—') + '</td><td>' + esc(fmtMoney(s.value, currency)) + '</td><td>' + esc(fmtTime(s.time)) + '</td></tr>';
          }
          return h + '</tbody></table>';
        })();
    el.innerHTML = tableHtml;
  }

  /* ── inject modal CSS ────────────────────────────────────── */

  function ensureModalCss() {
    if (document.getElementById('ads-modal-css')) return;
    var style = document.createElement('style');
    style.id = 'ads-modal-css';
    style.textContent =
      '.ads-modal-overlay{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.45);align-items:center;justify-content:center;}' +
      '.ads-modal-overlay.open{display:flex;}' +
      '.ads-modal-box{background:var(--card,#fff);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.18);width:90%;max-width:620px;max-height:85vh;overflow:auto;animation:adsFadeIn .18s ease;}' +
      '@keyframes adsFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +
      '.ads-modal-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border,#e5e5e5);}' +
      '.ads-modal-title{margin:0;font-size:15px;font-weight:600;color:var(--text,#333);}' +
      '.ads-modal-close{border:none;background:none;font-size:22px;cursor:pointer;color:var(--muted,#555);padding:0 4px;line-height:1;}' +
      '.ads-modal-close:hover{color:var(--text,#333);}' +
      '.ads-modal-body{padding:18px;}' +
      '.ads-modal-range-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 10px;}' +
      '.ads-modal-range-label{font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--muted,#555);}' +
      '.ads-modal-range-select{min-width:170px;max-width:240px;}' +
      '.ads-modal-range-custom{min-width:210px;max-width:260px;}' +
      '.ads-modal-chart-wrap{position:relative;height:220px;margin-bottom:8px;}' +
      '.ads-modal-sales-table,.ads-modal-countries-table,.ads-modal-devices-table,.ads-modal-networks-table,.ads-modal-dayparting-table{width:100%;border-collapse:collapse;font-size:12px;}' +
      '.ads-modal-sales-table thead th,.ads-modal-countries-table thead th,.ads-modal-devices-table thead th,.ads-modal-networks-table thead th,.ads-modal-dayparting-table thead th{text-align:left;padding:6px 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:var(--tblr-secondary, var(--muted,#555)) !important;border-bottom:1px solid var(--tblr-border-color, var(--border,#e5e5e5));background-color:var(--tblr-bg-surface-secondary,#f8f8f8) !important;}' +
      '.ads-modal-sales-table tbody td,.ads-modal-countries-table tbody td,.ads-modal-devices-table tbody td,.ads-modal-networks-table tbody td,.ads-modal-dayparting-table tbody td{padding:7px 10px;border-bottom:1px solid rgba(0,0,0,0.04);}' +
      '.ads-modal-sales-table tr:last-child td,.ads-modal-countries-table tr:last-child td,.ads-modal-devices-table tr:last-child td,.ads-modal-networks-table tr:last-child td,.ads-modal-dayparting-table tr:last-child td{border-bottom:none;}' +
      '.ads-modal-sales-table th:not(:first-child),.ads-modal-sales-table td:not(:first-child){text-align:center;}' +
      '.ads-modal-countries-table th:not(:first-child),.ads-modal-countries-table td:not(:first-child){text-align:right;}' +
      '.ads-modal-devices-table th:not(:first-child),.ads-modal-devices-table td:not(:first-child){text-align:right;}' +
      '.ads-modal-networks-table th:not(:first-child),.ads-modal-networks-table td:not(:first-child){text-align:right;}' +
      '.ads-modal-dayparting-table th:not(:first-child),.ads-modal-dayparting-table td:not(:first-child){text-align:right;}' +
      '.ads-profit-pos{color:#059669;font-weight:600;}' +
      '.ads-profit-neg{color:#dc2626;font-weight:600;}' +
      '.ads-campaign-row{cursor:pointer;transition:background .12s;}' +
      '.ads-campaign-row--paused{opacity:0.5;}' +
      '.ads-campaign-row:hover{background:rgba(13,148,136,0.04);}' +
      '.ads-loading-wrap{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:220px;padding:32px 12px;gap:12px;text-align:center;}' +
      '.ads-loader-spinner{width:30px;height:30px;border-radius:50%;background:conic-gradient(from 0deg,var(--kexo-accent-1,#4b94e4) 0deg 72deg,var(--kexo-accent-2,#3eb3ab) 72deg 144deg,var(--kexo-accent-3,#f59e34) 144deg 216deg,var(--kexo-accent-4,#8b5cf6) 216deg 288deg,var(--kexo-accent-5,#ef4444) 288deg 360deg);-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3.5px),#000 calc(100% - 3px));mask:radial-gradient(farthest-side,transparent calc(100% - 3.5px),#000 calc(100% - 3px));animation:adsLoaderSpin .9s linear infinite;}' +
      '@keyframes adsLoaderSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
      '.ads-refresh-mini{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:999px;background:rgba(0,0,0,0.04);color:var(--muted,#555);}' +
      'html[data-bs-theme="dark"] .ads-refresh-mini{background:rgba(255,255,255,0.06);}' +
      '@keyframes adsSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}' +
      '.ads-spin{animation:adsSpin 1s linear infinite;transform-origin:50% 50%;}' +
      '.ads-campaign-table{table-layout:fixed;min-width:640px;}' +
      '#ads-footer{overflow-x:auto;-webkit-overflow-scrolling:touch;}' +
      '.ads-campaign-table .grid-cell:nth-child(2){width:80px;}' +
      '.ads-campaign-table .grid-cell:nth-child(3){width:90px;}' +
      '.ads-campaign-table .grid-cell:nth-child(4){width:80px;}' +
      '.ads-campaign-table .grid-cell:nth-child(5){width:110px;}' +
      '.ads-campaign-table .grid-cell:nth-child(6){width:110px;}' +
      '.ads-campaign-table .grid-cell:nth-child(7){width:80px;}' +
      '.ads-campaign-table .grid-cell:nth-child(8){width:110px;}' +
      '@media (max-width:768px){' +
        '.ads-campaign-table .grid-cell:first-child{position:sticky;left:0;z-index:2;min-width:var(--kexo-sticky-col-min-width,72px);width:var(--kexo-sticky-col-width,120px);max-width:var(--kexo-sticky-col-max-width,250px);}' +
        '.ads-campaign-table .grid-row--header .grid-cell:first-child{z-index:3;}' +
        '.ads-campaign-table .ads-totals-row .grid-cell:first-child{z-index:3;}' +
      '}' +
      '.ads-campaign-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.ads-errors-list{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:10px;}' +
      '.ads-errors-title{font-weight:600;}' +
      '.ads-errors-detail{margin-top:2px;color:var(--muted,#555);font-size:12px;white-space:pre-wrap;word-break:break-word;}' +
      // Diagnostics JSON: force readable text even in dark theme (pre box is intentionally light).
      '.ads-errors-pre{font-size:11px;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow:auto;margin:0;padding:10px;background:#f8f8f8;color:#0f172a;border-radius:8px;border:1px solid #e5e5e5;}';
    document.head.appendChild(style);
  }

  /* ── render main table ───────────────────────────────────── */

  var _lastStatus = null;
  var _lastSummary = null;
  var _lastRefreshResult = null;
  var _lastRangeKey = null;
  var _lastFetchedAt = 0;
  var _lastFetchError = null;
  var _isRefreshing = false;
  var _isForceRefreshing = false;
  var _lastErrors = [];
  var _lastErrorsPayload = null;
  var _issuesOpenCount = 0;
  var _issuesSummaryPollTimer = null;

  function renderLoading(root, title, step) {
    if (!root) return;
    ensureModalCss();
    try {
      var actions = document.getElementById('ads-actions');
      var footer = document.getElementById('ads-footer');
      var pager = document.getElementById('ads-pagination');
      var noteEl = document.getElementById('ads-note');
      if (actions) actions.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (pager) { pager.classList.add('is-hidden'); pager.innerHTML = ''; }
      if (noteEl) { noteEl.style.display = 'none'; patchText(noteEl, ''); }
    } catch (_) {}
    root.innerHTML =
      '<div class="ads-loading-wrap">' +
        '<div class="report-build-wrap">' +
          '<div class="ads-loader-spinner" role="status" aria-label="Loading"></div>' +
          '<div class="report-build-title" data-ads-loader-title>' + esc(title || 'Preparing ads') + '</div>' +
          '<div class="report-build-step" data-ads-loader-step>' + esc(step || '') + '</div>' +
        '</div>' +
      '</div>';
  }

  function setLoadingStep(root, step, title) {
    setPanelLoaderStep(step, title);
    if (!root || !root.querySelector) return;
    var stepEl = root.querySelector('[data-ads-loader-step]');
    var titleEl = root.querySelector('[data-ads-loader-title]');
    if (titleEl && title != null) patchText(titleEl, String(title));
    if (stepEl && step != null) patchText(stepEl, String(step));
  }

  function renderLoadError(root, msg) {
    if (!root) return;
    ensureModalCss();
    try {
      var actions = document.getElementById('ads-actions');
      var footer = document.getElementById('ads-footer');
      var pager = document.getElementById('ads-pagination');
      var noteEl = document.getElementById('ads-note');
      if (actions) actions.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (pager) { pager.classList.add('is-hidden'); pager.innerHTML = ''; }
      if (noteEl) { noteEl.style.display = 'none'; patchText(noteEl, ''); }
    } catch (_) {}
    root.innerHTML =
      '<div class="ads-loading-wrap">' +
        '<div class="text-danger fw-semibold">Could not load ads</div>' +
        (msg ? ('<div class="muted small" style="max-width:520px;">' + esc(msg) + '</div>') : '') +
      '</div>';
  }

  function collectErrors(status, summary, refreshResult) {
    var errs = [];
    function push(title, detail) {
      var d = detail != null ? String(detail).trim() : '';
      if (!d) return;
      errs.push({ title: title, detail: d });
    }

    if (_lastFetchError) push('Load failed', _lastFetchError);
    if (!status) push('Status', 'No provider status returned.');
    if (!summary) push('Summary', 'No summary returned.');
    if (summary && summary.ok === false) push('Summary', summary.error || 'Summary failed.');

    var rr = refreshResult || null;
    if (rr) {
      if (rr.ok === false) push('Refresh', rr.error || 'Refresh failed.');
      if (rr.spend && rr.spend.ok === false) push('Spend sync', rr.spend.error || 'Spend sync failed.');
      if (rr.geo && rr.geo.ok === false) push('Geo sync', rr.geo.error || 'Geo sync failed.');
      if (rr.gclidBackfill && rr.gclidBackfill.ok === false) push('GCLID backfill', rr.gclidBackfill.error || 'GCLID backfill failed.');
      if (rr.orderAttribution && rr.orderAttribution.ok === false) push('Order attribution', rr.orderAttribution.error || 'Order attribution failed.');
    }

    return errs;
  }

  function patchSpendProfitRoas(root, summary) {
    if (!root || !summary || !summary.totals) return false;
    var currency = (summary && summary.currency) || 'GBP';
    var campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns : [];
    if (!campaigns.length) return false;

    var map = new Map();
    for (var i = 0; i < campaigns.length; i++) {
      var c = campaigns[i];
      if (!c || !c.campaignId) continue;
      map.set(String(c.campaignId), c);
    }

    var rows = root.querySelectorAll('.ads-campaign-row');
    if (!rows || !rows.length) return false;

    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      if (!row) continue;
      var id = row.getAttribute('data-campaign-id') || '';
      if (!id) continue;
      var c2 = map.get(String(id));
      if (!c2) return false; // campaign set changed -> full rerender

      try {
        var st = c2 && c2.campaignStatus != null ? String(c2.campaignStatus) : '';
        var paused = (st || '').trim().toUpperCase() === 'PAUSED';
        if (row.classList) row.classList.toggle('ads-campaign-row--paused', paused);
      } catch (_) {}

      var cells = row.querySelectorAll('.grid-cell');
      if (!cells || cells.length < 8) return false;

      patchText(cells[1], fmtNum(c2.clicks));
      patchText(cells[2], fmtNum(c2.impressions));
      patchText(cells[3], fmtNum(c2.orders));
      patchText(cells[4], fmtMoney(c2.revenue, currency));
      patchText(cells[5], fmtMoney(c2.spend, currency));
      patchText(cells[6], fmtRoas(c2.roas));

      var pr = c2.profit != null ? Number(c2.profit) : 0;
      patchText(cells[7], fmtMoney(pr, currency));
      setProfitCellClass(cells[7], pr);
    }

    var totals = summary && summary.totals ? summary.totals : null;
    var totalsFooter = document.getElementById('ads-footer');
    var tRow = totalsFooter ? totalsFooter.querySelector('.ads-totals-row') : null;
    if (totals && tRow) {
      var tCells = tRow.querySelectorAll('.grid-cell');
      if (!tCells || tCells.length < 8) return false;
      patchText(tCells[1], fmtNum(totals.clicks));
      patchText(tCells[2], fmtNum(totals.impressions));
      patchText(tCells[3], fmtNum(totals.conversions != null ? totals.conversions : totals.orders));
      patchText(tCells[4], fmtMoney(totals.revenue, currency));
      patchText(tCells[5], fmtMoney(totals.spend, currency));
      patchText(tCells[6], fmtRoas(totals.roas));
      var tProfit = totals.profit != null ? Number(totals.profit) : 0;
      patchText(tCells[7], fmtMoney(tProfit, currency));
      setProfitCellClass(tCells[7], tProfit);
    }

    return true;
  }

  function alertTriangleSvg() {
    return '<i class="fa-light fa-triangle-exclamation" data-icon-key="ads-status-warning" aria-hidden="true"></i>';
  }

  function refreshSvg(extraClass, idAttr) {
    var cls = 'fa-light fa-rotate-right' + (extraClass ? (' ' + extraClass) : '');
    var id = idAttr ? (' id="' + idAttr + '"') : '';
    return '<i' + id + ' class="' + cls + '" data-icon-key="ads-actions-refresh" aria-hidden="true"></i>';
  }

  function connectionStatusSvg(isConnected) {
    if (isConnected) {
      return '<i class="fa-light fa-circle-check" data-icon-key="ads-status-connected" aria-hidden="true"></i>';
    }
    return '<i class="fa-light fa-circle-xmark" data-icon-key="ads-status-disconnected" aria-hidden="true"></i>';
  }

  function ensureActionsPlacement() {
    var actions = document.getElementById('ads-actions');
    var footer = document.getElementById('ads-footer');
    if (!actions || !footer) return;
    var parent = footer.parentNode;
    if (!parent || actions.parentNode !== parent) return;
    if (footer.nextElementSibling === actions) return;
    parent.insertBefore(actions, footer.nextSibling);
  }

  function renderActionsBar(status, summary) {
    ensureActionsPlacement();
    var actions = document.getElementById('ads-actions');
    if (!actions) return;

    var providers = status && status.providers ? status.providers : [];
    var isConnected = !!(providers.length && providers.some(function (p) { return !!(p && p.connected); }));
    var connLabel = isConnected ? 'Connected' : (providers.length ? 'Not connected' : 'No providers configured');
    var hidePaused = false;
    try { hidePaused = getAdsHidePaused(); } catch (_) { hidePaused = false; }

    _lastErrors = collectErrors(status, summary, _lastRefreshResult);
    _lastErrorsPayload = {
      fetchError: _lastFetchError,
      refresh: _lastRefreshResult,
      providers: status && status.providers ? status.providers : null,
      rangeKey: summary && summary.rangeKey ? summary.rangeKey : null,
    };

    var connBtnClass = isConnected ? 'btn-ghost-success' : 'btn-ghost-secondary';

    var issuesOpen = typeof _issuesOpenCount === 'number' ? _issuesOpenCount : 0;
    actions.style.display = '';
    actions.innerHTML =
      '<label class="form-check form-check-inline m-0 me-auto" style="user-select:none;white-space:nowrap;" aria-label="Hide paused campaigns">' +
        '<input class="form-check-input" type="checkbox" id="ads-hide-paused"' + (hidePaused ? ' checked' : '') + '>' +
        '<span class="form-check-label">Hide paused</span>' +
      '</label>' +
      '<button type="button" class="btn btn-icon btn-ghost-secondary" id="ads-issues-badge" style="display:' + (issuesOpen > 0 ? 'inline-flex' : 'none') + ';" title="Unresolved issues" aria-label="Unresolved issues">' +
        '<i class="fa-light fa-triangle-exclamation" data-icon-key="ads-issues-badge" aria-hidden="true"></i>' +
        '<span class="ms-1" id="ads-issues-count">' + (issuesOpen > 0 ? String(issuesOpen) : '') + '</span>' +
      '</button>' +
      '<button type="button" class="btn btn-icon btn-ghost-danger" id="ads-errors-icon" style="display:' + (_lastErrors.length ? 'inline-flex' : 'none') + ';" title="Errors detected" aria-label="Errors detected">' +
        alertTriangleSvg() +
      '</button>' +
      '<span class="btn btn-icon ' + connBtnClass + ' disabled" id="ads-conn-icon" title="' + esc(connLabel) + '" aria-label="' + esc(connLabel) + '">' +
        connectionStatusSvg(isConnected) +
      '</span>' +
      '<button type="button" class="btn btn-icon btn-ghost-secondary" id="ads-refresh-btn" title="Refresh metrics" aria-label="Refresh"' + (_isRefreshing ? ' disabled' : '') + '>' +
        refreshSvg(_isRefreshing ? 'ads-spin' : '', 'ads-refresh-icon') +
      '</button>' +
      '<button type="button" class="btn btn-icon btn-ghost-secondary" id="ads-audit-btn" title="Audit coverage" aria-label="Audit coverage">' +
        '<i class="fa-light fa-circle-info" data-icon-key="ads-actions-audit" aria-hidden="true"></i>' +
      '</button>';

    var rbtn = document.getElementById('ads-refresh-btn');
    if (rbtn) {
      rbtn.addEventListener('click', function () {
        try { window.__adsRefresh && window.__adsRefresh({ force: true }); } catch (_) {}
      });
    }
    var ebtn = document.getElementById('ads-errors-icon');
    if (ebtn) {
      ebtn.addEventListener('click', function () {
        try { openErrorsModal(_lastErrors, _lastErrorsPayload); } catch (_) {}
      });
    }
    var abtn = document.getElementById('ads-audit-btn');
    if (abtn) {
      abtn.addEventListener('click', function () {
        try { openAuditModal(); } catch (_) {}
      });
    }
    var issuesBadge = document.getElementById('ads-issues-badge');
    if (issuesBadge) {
      issuesBadge.addEventListener('click', function () {
        try { openIssuesModal(); } catch (_) {}
      });
    }

    var hcb = document.getElementById('ads-hide-paused');
    if (hcb) {
      hcb.addEventListener('change', function () {
        var next = false;
        try { next = !!hcb.checked; } catch (_) { next = false; }
        setAdsHidePaused(next);
        adsPage = 1;
        var root = document.getElementById('ads-root');
        if (root && _lastSummary) render(root, _lastStatus, _lastSummary, _lastRefreshResult);
      });
    }
  }

  function patchFooterAndNote(status, summary) {
    var noteEl = document.getElementById('ads-note');
    var note = (summary && summary.note) ? String(summary.note) : '';
    if (noteEl) {
      if (note) {
        noteEl.style.display = '';
        patchText(noteEl, note);
      } else {
        noteEl.style.display = 'none';
        patchText(noteEl, '');
      }
    }

    renderActionsBar(status, summary);
  }

  var _adsScrollSyncInited = false;
  function syncFooterScroll() {
    var rootWrap = document.getElementById('ads-root');
    var footerWrap = document.getElementById('ads-footer');
    if (!rootWrap || !footerWrap) return;

    if (!_adsScrollSyncInited) {
      _adsScrollSyncInited = true;
      var syncing = false;
      function sync(from, to) {
        if (syncing) return;
        syncing = true;
        try { to.scrollLeft = from.scrollLeft; } catch (_) {}
        setTimeout(function () { syncing = false; }, 0);
      }
      try {
        rootWrap.addEventListener('scroll', function () { sync(rootWrap, footerWrap); }, { passive: true });
        footerWrap.addEventListener('scroll', function () { sync(footerWrap, rootWrap); }, { passive: true });
      } catch (_) {}
    }

    // Ensure footer aligns to current table scroll offset.
    try { footerWrap.scrollLeft = rootWrap.scrollLeft; } catch (_) {}
  }

  function render(root, status, summary, refreshResult) {
    _lastStatus = status;
    _lastSummary = summary;
    if (refreshResult !== undefined) _lastRefreshResult = refreshResult;
    ensureModalCss();

    var providers = status && status.providers ? status.providers : [];
    var totals = summary && summary.totals ? summary.totals : {};
    var allCampaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns : [];
    var campaigns = allCampaigns;
    var hidePaused = false;
    try { hidePaused = getAdsHidePaused(); } catch (_) { hidePaused = false; }
    if (hidePaused && campaigns && campaigns.length) {
      campaigns = campaigns.filter(function (c) {
        if (!c) return false;
        var st = c.campaignStatus != null ? String(c.campaignStatus) : '';
        return (st || '').trim().toUpperCase() !== 'PAUSED';
      });
    }
    var currency = (summary && summary.currency) || 'GBP';
    var note = (summary && summary.note) ? String(summary.note) : '';
    if (summary && summary.rangeKey) _lastRangeKey = String(summary.rangeKey);

    // Sort campaigns
    campaigns = sortCampaigns(campaigns);
    var pageSize = getAdsPageSize();
    var totalPages = Math.max(1, Math.ceil(campaigns.length / pageSize));
    adsPage = clampPage(adsPage, totalPages);
    updateAdsPagination(campaigns.length);
    var pageStart = (adsPage - 1) * pageSize;
    var pagedCampaigns = campaigns.slice(pageStart, pageStart + pageSize);

    function gridRow(cells, isHeader, cssClass, attrs) {
      var role = isHeader ? 'columnheader' : 'cell';
      var cls = 'grid-row' + (isHeader ? ' grid-row--header' : '') + (cssClass ? ' ' + cssClass : '');
      var h = '<div class="' + cls + '" role="row"' + (attrs || '') + '>';
      for (var i = 0; i < cells.length; i++) {
        var cell = cells[i] || {};
        var cellCls = 'grid-cell' + (cell.cls || '');
        var extra = ' class="' + cellCls + '"';
        if (isHeader && cell.sortKey) {
          var isActive = sortKey === cell.sortKey;
          extra = ' class="grid-cell sortable' +
            (isActive ? (sortDesc ? ' th-sort-desc' : ' th-sort-asc') : '') +
            (cell.cls || '') +
            '" data-sort="' + cell.sortKey + '"';
        }
        h += '<div' + extra + ' role="' + role + '">' + (cell.html != null ? cell.html : cell) + '</div>';
      }
      h += '</div>';
      return h;
    }

    // Sanity-check totals (best-effort): API totals should match sum of campaigns (within rounding tolerance).
    (function auditTotals() {
      try {
        var sum = { spend: 0, impressions: 0, clicks: 0, revenue: 0, profit: 0 };
        for (var i = 0; i < allCampaigns.length; i++) {
          var c = allCampaigns[i] || {};
          sum.spend += Number(c.spend) || 0;
          sum.impressions += Number(c.impressions) || 0;
          sum.clicks += Number(c.clicks) || 0;
          sum.revenue += Number(c.revenue) || 0;
          sum.profit += Number(c.profit) || 0;
        }
        var tolMoney = 0.06; // allow small rounding drift between per-campaign rounding vs totals rounding
        function dm(a, b) { return Math.abs((Number(a) || 0) - (Number(b) || 0)); }
        function di(a, b) { return Math.abs((Math.floor(Number(a) || 0)) - (Math.floor(Number(b) || 0))); }
        var mismatches = [];
        if (dm(sum.spend, totals.spend) > tolMoney) mismatches.push('spend');
        if (dm(sum.revenue, totals.revenue) > tolMoney) mismatches.push('revenue');
        if (dm(sum.profit, totals.profit) > tolMoney) mismatches.push('profit');
        if (di(sum.clicks, totals.clicks) > 0) mismatches.push('clicks');
        if (di(sum.impressions, totals.impressions) > 0) mismatches.push('impressions');
        if (mismatches.length) {
          console.warn('[ads] totals mismatch (api vs sum(campaigns))', { mismatches: mismatches, api: totals, sum: sum });
        }
      } catch (_) {}
    })();

    var bodyHtml = '';

    // Totals row (render in card footer)
    var tProfit = totals.profit != null ? Number(totals.profit) : 0;
    var totalsRowHtml = gridRow([
      { html: '<strong>Total</strong>' },
      { html: esc(fmtNum(totals.clicks)), cls: ' text-end' },
      { html: esc(fmtNum(totals.impressions)), cls: ' text-end' },
      { html: esc(fmtNum(totals.conversions != null ? totals.conversions : totals.orders)), cls: ' text-end' },
      { html: esc(fmtMoney(totals.revenue, currency)), cls: ' text-end' },
      { html: esc(fmtMoney(totals.spend, currency)), cls: ' text-end' },
      { html: esc(fmtRoas(totals.roas)), cls: ' text-end' },
      { html: esc(fmtMoney(tProfit, currency)), cls: ' text-end ' + profitClass(tProfit) },
    ], false, 'ads-totals-row');

    // Campaign rows
    for (var ci = 0; ci < pagedCampaigns.length; ci++) {
      var c = pagedCampaigns[ci];
      if (!c) continue;
      var cName = c.campaignName || c.campaignId || '—';
      var cId = c.campaignId || '';
      var pr = c.profit != null ? Number(c.profit) : 0;
      var cStatus = c.campaignStatus != null ? String(c.campaignStatus) : '';
      var isPaused = (cStatus || '').trim().toUpperCase() === 'PAUSED';
      var rowClass = 'ads-campaign-row' + (isPaused ? ' ads-campaign-row--paused' : '');

      bodyHtml += gridRow([
        { html: '<span class="ads-campaign-name">' + esc(cName) + '</span>' },
        { html: esc(fmtNum(c.clicks)), cls: ' text-end' },
        { html: esc(fmtNum(c.impressions)), cls: ' text-end' },
        { html: esc(fmtNum(c.orders)), cls: ' text-end' },
        { html: esc(fmtMoney(c.revenue, currency)), cls: ' text-end' },
        { html: esc(fmtMoney(c.spend, currency)), cls: ' text-end' },
        { html: esc(fmtRoas(c.roas)), cls: ' text-end' },
        { html: esc(fmtMoney(pr, currency)), cls: ' text-end ' + profitClass(pr) },
      ], false, rowClass, ' data-campaign-id="' + esc(cId) + '" data-campaign-name="' + esc(cName) + '"');
    }

    if (!campaigns.length) {
      var emptyMsg = null;
      if (hidePaused && allCampaigns && allCampaigns.length) {
        emptyMsg = 'Paused campaigns hidden. Uncheck Hide paused to view.';
      } else if (!note) {
        emptyMsg = 'No campaign data yet. Click ↻ to sync.';
      }
      if (emptyMsg) {
        bodyHtml += '<div class="grid-row" role="row"><div class="grid-cell muted" role="cell" style="text-align:center;">' + esc(emptyMsg) + '</div></div>';
      }
    }

    var tableHtml;
    if (typeof window.buildKexoGridTable === 'function' && window.KEXO_TABLE_DEFS && window.KEXO_TABLE_DEFS['ads-campaigns-table']) {
      var adsDef = window.KEXO_TABLE_DEFS['ads-campaigns-table'];
      tableHtml = window.buildKexoGridTable({
        innerOnly: true,
        tableClass: adsDef.tableClass || 'ads-campaign-table',
        ariaLabel: adsDef.ariaLabel || 'Ads campaigns',
        columns: adsDef.columns || [],
        bodyHtml: bodyHtml
      });
    } else {
      var headerCells = COL_DEFS.map(function (d, idx) {
        return { html: d.label, sortKey: d.key, cls: idx === 0 ? '' : ' text-end' };
      });
      tableHtml = '<div class="grid-table ads-campaign-table" role="table" aria-label="Ads campaigns">' +
        '<div class="grid-header kexo-grid-header" role="rowgroup">' + gridRow(headerCells, true) + '</div>' +
        '<div class="grid-body" role="rowgroup">' + bodyHtml + '</div>' +
      '</div>';
    }
    root.innerHTML = tableHtml;

    var totalsFooter = document.getElementById('ads-footer');
    if (totalsFooter) {
      totalsFooter.style.display = '';
      totalsFooter.innerHTML =
        '<div class="grid-table ads-campaign-table" role="table" aria-label="Ads totals">' +
          '<div class="grid-body" role="rowgroup">' + totalsRowHtml + '</div>' +
        '</div>';
    }

    patchFooterAndNote(status, summary);
    syncFooterScroll();
    try { if (typeof window.__kexoRunStickyColumnResize === 'function') window.__kexoRunStickyColumnResize(); } catch (_) {}
    renderAdsOverviewChart(summary);

    // Bind sortable headers
    var headers = root.querySelectorAll('[data-sort]');
    for (var si = 0; si < headers.length; si++) {
      headers[si].addEventListener('click', function (e) {
        var key = e.currentTarget.getAttribute('data-sort');
        if (sortKey === key) { sortDesc = !sortDesc; }
        else { sortKey = key; sortDesc = true; }
        render(root, _lastStatus, _lastSummary);
      });
    }

    // Bind campaign rows (open modal on click)
    var rows = root.querySelectorAll('.ads-campaign-row');
    for (var li = 0; li < rows.length; li++) {
      rows[li].addEventListener('click', function (e) {
        var id = e.currentTarget.getAttribute('data-campaign-id');
        var name = e.currentTarget.getAttribute('data-campaign-name');
        if (id) openCampaignModal(id, name);
      });
    }
  }

  /* ── refresh / init ──────────────────────────────────────── */

  var inFlight = null;
  var autoSyncedEmptyRange = Object.create(null);

  function applyRefreshingUi(refreshing, isForce) {
    _isRefreshing = !!refreshing;
    _isForceRefreshing = !!isForce;
    var btn = document.getElementById('ads-refresh-btn');
    if (btn) {
      btn.disabled = _isRefreshing;
      var svg = document.getElementById('ads-refresh-icon');
      if (svg && svg.classList) {
        svg.classList.remove('ads-spin');
        if (_isRefreshing) svg.classList.add('ads-spin');
      }
    }
  }

  function normalizeRangeKeyForApi(key) {
    var k = (key == null ? '' : String(key)).trim().toLowerCase();
    // UI uses friendly labels (7days/14days/30days) but APIs use 7d/14d/30d.
    if (k === '7days') return '7d';
    if (k === '14days') return '14d';
    if (k === '30days') return '30d';
    return k;
  }

  function computeRangeKey() {
    // Prefer the global date selector so Ads responds to range changes.
    try {
      var sel = document.getElementById('global-date-select');
      if (sel && sel.value) {
        var v = normalizeRangeKeyForApi(sel.value);
        if (v === 'live' || v === 'sales' || v === '1h') return 'today';
        if (!v || v === 'custom') return 'today';
        return v;
      }
    } catch (_) {}

    // Legacy fallbacks (older pages).
    try { if (typeof getStatsRange === 'function') return String(getStatsRange() || 'today'); } catch (_) {}
    try {
      if (typeof dateRange !== 'undefined') {
        var r = normalizeRangeKeyForApi(dateRange);
        if (r === 'live' || r === 'sales' || r === '1h') return 'today';
        if (!r || r === 'custom') return 'today';
        return r;
      }
    } catch (_) {}
    return 'today';
  }

  function fetchSummary(rangeKey, cacheBust) {
    var bust = cacheBust ? ('&_=' + Date.now()) : '';
    return fetchJson('/api/ads/summary?range=' + encodeURIComponent(rangeKey) + bust);
  }

  function refreshAdsBackend(rangeKey) {
    return fetchJson('/api/ads/refresh?range=' + encodeURIComponent(rangeKey), {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'googleads' }),
    });
  }

  function refresh(options) {
    var root = document.getElementById('ads-root');
    if (!root) return Promise.resolve(null);
    if (inFlight) return inFlight;

    var isForce = !!(options && options.force);
    var showPageLoader = !_lastSummary;
    var rangeKey = computeRangeKey();
    var now = Date.now();

    // Soft refresh should not spam requests (tab focus / theme refresh). Keep UX smooth.
    if (!isForce && _lastSummary && _lastRangeKey === rangeKey && _lastFetchedAt && (now - _lastFetchedAt) < 15000) {
      // Ensure footer is visible (in case user navigated before first render)
      try {
        if (!root.innerHTML) render(root, _lastStatus, _lastSummary);
      } catch (_) {}
      return Promise.resolve({ status: _lastStatus, summary: _lastSummary, cached: true });
    }

    _lastFetchError = null;
    var actions = document.getElementById('ads-actions');
    var footer = document.getElementById('ads-footer');
    var noteEl = document.getElementById('ads-note');

    if (showPageLoader) {
      showPanelLoader('Preparing Google Ads', 'Connecting to Google');
      if (actions) actions.style.display = 'none';
      if (footer) footer.style.display = 'none';
      if (noteEl) { noteEl.style.display = 'none'; noteEl.textContent = ''; }
    } else {
      applyRefreshingUi(true, isForce);
    }

    var p = fetchJson('/api/ads/status')
      .then(function(status) {
        if (showPageLoader) setLoadingStep(root, 'Importing campaigns');
        if (isForce) {
          return refreshAdsBackend(rangeKey)
            .then(function(refreshResult) {
              _lastRefreshResult = refreshResult || { ok: false, error: 'refresh_failed' };
              return fetchSummary(rangeKey, true).then(function(summary) {
                return { status: status, summary: summary };
              });
            });
        }
        return fetchSummary(rangeKey, false)
          .then(function(summary) {
            var campaigns = summary && Array.isArray(summary.campaigns) ? summary.campaigns : [];
            var shouldAutoSyncYesterday = (
              rangeKey === 'yesterday' &&
              campaigns.length === 0 &&
              !autoSyncedEmptyRange[rangeKey]
            );
            if (!shouldAutoSyncYesterday) return { status: status, summary: summary };
            autoSyncedEmptyRange[rangeKey] = Date.now();
            if (showPageLoader) setLoadingStep(root, 'Syncing yesterday spend');
            return refreshAdsBackend(rangeKey)
              .then(function(refreshResult) {
                _lastRefreshResult = refreshResult || { ok: false, error: 'refresh_failed' };
                return fetchSummary(rangeKey, true).then(function(summaryAfterSync) {
                  return { status: status, summary: summaryAfterSync || summary };
                });
              })
              .catch(function() {
                return { status: status, summary: summary };
              });
          });
      })
      .then(function (arr) {
      var status = arr && arr.status ? arr.status : null;
      var summary = arr && arr.summary ? arr.summary : null;
      if (!status || !summary) _lastFetchError = 'Failed to load ads data (status/summary).';
      if (summary && summary.rangeKey) _lastRangeKey = String(summary.rangeKey);
      else _lastRangeKey = rangeKey;
      if (summary) _lastFetchedAt = Date.now();
      if (showPageLoader) setLoadingStep(root, 'Loading campaign data');

      applyRefreshingUi(false, false);
      var nextStatus = status || _lastStatus;
      var nextSummary = summary || _lastSummary;
      if (showPageLoader) setLoadingStep(root, 'Analyzing spend');

      var didPatch = false;
      if (nextSummary && _lastSummary) {
        try {
          if (showPageLoader) setLoadingStep(root, 'Analyzing spend');
          didPatch = patchSpendProfitRoas(root, nextSummary);
          patchFooterAndNote(nextStatus, nextSummary);
        } catch (_) { didPatch = false; }
      }

      if (!didPatch) {
        if (showPageLoader) setLoadingStep(root, 'Building profit table');
        render(root, nextStatus, nextSummary, undefined);
      } else {
        _lastStatus = nextStatus;
        _lastSummary = nextSummary;
        try { renderAdsOverviewChart(nextSummary); } catch (_) {}
      }

      var gaConnected = status && status.providers && status.providers.some(function (p) {
        return p && p.key === 'google_ads' && p.connected;
      });
      if (gaConnected) {
        fetchGoalHealth();
      } else {
        var card = document.getElementById('ads-goal-health-card');
        if (card) card.style.display = 'none';
      }
      fetchIssuesSummary();
      return { status: status, summary: summary };
    }).catch(function () {
      _lastFetchError = 'Could not load ads.';
      applyRefreshingUi(false, false);
      if (_lastSummary) {
        try { patchFooterAndNote(_lastStatus, _lastSummary); } catch (_) {}
        try { renderAdsOverviewChart(_lastSummary); } catch (_) {}
      } else {
        if (showPageLoader) setLoadingStep(root, 'Could not load ads');
        if (actions) actions.style.display = 'none';
        if (footer) footer.style.display = 'none';
        var pager = document.getElementById('ads-pagination');
        if (pager) { pager.classList.add('is-hidden'); pager.innerHTML = ''; }
        if (noteEl) { noteEl.style.display = 'none'; noteEl.textContent = ''; }
        renderLoadError(root, _lastFetchError);
        try { clearAdsOverviewChart('Could not load chart'); } catch (_) {}
      }
      return null;
    }).finally(function () {
      if (inFlight === p) inFlight = null;
      if (showPageLoader || _panelLoaderActive) hidePanelLoader();
    });

    inFlight = p;
    return p;
  }

  function handleAdsRowsPerPageChanged(tableId) {
    var id = String(tableId == null ? '' : tableId).trim();
    if (id !== 'ads-root') return;
    adsPage = 1;
    var root = document.getElementById('ads-root');
    if (root && _lastSummary) render(root, _lastStatus, _lastSummary, _lastRefreshResult);
  }

  window.__adsRowsPerPageChanged = handleAdsRowsPerPageChanged;
  try {
    window.addEventListener('kexo:table-rows-changed', function(e) {
      var d = e && e.detail ? e.detail : null;
      if (!d) return;
      handleAdsRowsPerPageChanged(d.tableId);
    });
  } catch (_) {}

  function startIssuesPolling() {
    if (_issuesSummaryPollTimer) return;
    fetchIssuesSummary();
    _issuesSummaryPollTimer = setInterval(fetchIssuesSummary, 60000);
  }
  function stopIssuesPolling() {
    if (_issuesSummaryPollTimer) {
      clearInterval(_issuesSummaryPollTimer);
      _issuesSummaryPollTimer = null;
    }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') startIssuesPolling();
    else stopIssuesPolling();
  });

  window.__adsRefresh = refresh;
  window.__adsInit = function () {
    if (document.visibilityState === 'visible') startIssuesPolling();
    return refresh({ force: false });
  };
})();
