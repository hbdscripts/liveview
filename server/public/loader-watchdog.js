(function () {
  'use strict';

  // Mobile page-loader watchdog:
  // - Detects the "timeframe" determinate loader stalling (commonly on Overview mobile first-load)
  // - Sends a single Sentry message with context + in-flight API calls
  // - Forces the overlay to close after a hard timeout so the site doesn't look "stuck"

  if (typeof window === 'undefined') return;
  if (window.__kexoLoaderWatchdogWired) return;
  window.__kexoLoaderWatchdogWired = true;

  function isMobile() {
    try { return !!(window.matchMedia && window.matchMedia('(max-width: 991.98px)').matches); } catch (_) { return false; }
  }

  function now() { return Date.now(); }

  var inflight = new Map();
  var nextReqId = 1;

  function wrapFetchForInflightTracking() {
    if (window.__kexoLoaderWatchdogFetchWrapped) return;
    var orig = typeof window.fetch === 'function' ? window.fetch : null;
    if (!orig) return;
    window.__kexoLoaderWatchdogFetchWrapped = true;

    window.fetch = function (url, opts) {
      var id = String(nextReqId++);
      var urlStr = '';
      try { urlStr = (typeof url === 'string') ? url : (url && url.url) ? String(url.url) : ''; } catch (_) { urlStr = ''; }
      var method = '';
      try { method = (opts && opts.method) ? String(opts.method) : 'GET'; } catch (_) { method = 'GET'; }
      var startedAt = now();
      inflight.set(id, { id: id, url: urlStr, method: method, startedAt: startedAt });

      var p;
      try {
        p = orig.apply(this, arguments);
      } catch (e) {
        inflight.delete(id);
        throw e;
      }
      if (!p || typeof p.then !== 'function') {
        inflight.delete(id);
        return p;
      }
      return p.finally(function () { inflight.delete(id); });
    };
  }

  function getInflightSummary(limit) {
    var n = Number(limit);
    if (!Number.isFinite(n) || n < 1) n = 8;
    var rows = Array.from(inflight.values());
    rows.sort(function (a, b) { return (a.startedAt || 0) - (b.startedAt || 0); });
    return rows.slice(0, n).map(function (r) {
      var ageMs = now() - (Number(r.startedAt) || now());
      return {
        method: r.method || 'GET',
        url: String(r.url || '').slice(0, 600),
        ageMs: ageMs,
      };
    });
  }

  function hasClass(el, cls) {
    try { return !!(el && el.classList && el.classList.contains(cls)); } catch (_) { return false; }
  }

  function hideLoaderOverlay() {
    var overlay = document.getElementById('page-body-loader');
    if (overlay) {
      try { overlay.classList.add('is-hidden'); } catch (_) {}
      try { overlay.classList.remove('timeframe-overlay'); } catch (_) {}
      try {
        var ind = overlay.querySelector('.page-loader-progress:not(.page-loader-progress--determinate)');
        if (ind) ind.style.display = '';
      } catch (_) {}
    }
    try {
      var det = document.getElementById('page-body-loader-determinate');
      if (det) det.style.display = 'none';
      var detBar = document.getElementById('page-body-loader-determinate-bar');
      if (detBar) { detBar.style.width = '0%'; detBar.setAttribute('aria-valuenow', 0); }
    } catch (_) {}

    try {
      var scope = document.querySelector('.page-body');
      if (scope) scope.classList.remove('report-building');
    } catch (_) {}
    try { document.body.classList.remove('kexo-report-loading'); } catch (_) {}
  }

  function captureStall(kind, ctx) {
    // Prefer the shared Sentry helper if present.
    try {
      if (typeof window.kexoCaptureMessage === 'function') {
        window.kexoCaptureMessage(kind, ctx || {}, 'error');
        return;
      }
    } catch (_) {}
    try {
      if (window.Sentry && typeof window.Sentry.captureMessage === 'function') {
        window.Sentry.captureMessage(kind, { level: 'error', extra: ctx || {} });
      }
    } catch (_) {}
  }

  // Start only on mobile; desktop already tends to self-heal.
  if (!isMobile()) return;

  wrapFetchForInflightTracking();

  var lastVisibleAt = 0;
  var lastProgressAt = 0;
  var lastProgressVal = null;
  var reportedForSession = false;
  var forcedCloseForSession = false;

  // Tuning:
  // - "stall": progress unchanged for this long while overlay is visible
  // - "hard": overlay visible for this long -> force close so user can use the site
  var STALL_MS = 12000;
  var HARD_MS = 30000;

  function tick() {
    var overlay = document.getElementById('page-body-loader');
    if (!overlay) return;
    var visible = !hasClass(overlay, 'is-hidden');
    if (!visible) {
      lastVisibleAt = 0;
      lastProgressAt = 0;
      lastProgressVal = null;
      reportedForSession = false;
      forcedCloseForSession = false;
      return;
    }

    if (!lastVisibleAt) lastVisibleAt = now();

    var stepText = '';
    try {
      var stepEl = document.getElementById('page-body-build-step');
      stepText = stepEl ? String(stepEl.textContent || '').trim() : '';
    } catch (_) { stepText = ''; }

    var pct = null;
    try {
      var bar = document.getElementById('page-body-loader-determinate-bar');
      if (bar) {
        var raw = bar.getAttribute('aria-valuenow');
        var v = raw != null ? Number(raw) : NaN;
        if (Number.isFinite(v)) pct = v;
      }
    } catch (_) { pct = null; }

    if (pct != null) {
      if (lastProgressVal == null || pct !== lastProgressVal) {
        lastProgressVal = pct;
        lastProgressAt = now();
      } else if (!lastProgressAt) {
        lastProgressAt = now();
      }
    }

    var visibleFor = now() - lastVisibleAt;
    var stalledFor = lastProgressAt ? (now() - lastProgressAt) : visibleFor;

    if (!reportedForSession && lastProgressVal != null && lastProgressVal > 0 && lastProgressVal < 100 && stalledFor >= STALL_MS) {
      reportedForSession = true;
      captureStall('kexo_loader_stalled', {
        page: (document.body && document.body.getAttribute('data-page')) || '',
        href: String(window.location && window.location.href ? window.location.href : ''),
        ua: String(navigator && navigator.userAgent ? navigator.userAgent : ''),
        viewport: { w: window.innerWidth || 0, h: window.innerHeight || 0, dpr: window.devicePixelRatio || 1 },
        progressPct: lastProgressVal,
        stalledForMs: stalledFor,
        visibleForMs: visibleFor,
        stepText: stepText,
        overlayClass: overlay && overlay.className ? String(overlay.className) : '',
        bodyClass: document.body && document.body.className ? String(document.body.className) : '',
        inflight: getInflightSummary(10),
        online: (typeof navigator !== 'undefined' && navigator) ? navigator.onLine : null,
      });
    }

    if (!forcedCloseForSession && visibleFor >= HARD_MS) {
      forcedCloseForSession = true;
      captureStall('kexo_loader_forced_close', {
        page: (document.body && document.body.getAttribute('data-page')) || '',
        href: String(window.location && window.location.href ? window.location.href : ''),
        progressPct: lastProgressVal,
        visibleForMs: visibleFor,
        stepText: stepText,
        inflight: getInflightSummary(10),
      });
      hideLoaderOverlay();
    }
  }

  try { setInterval(tick, 1000); } catch (_) {}
})();

