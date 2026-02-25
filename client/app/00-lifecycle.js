  (function initKexoLifecycleCoordinator() {
    // Single global lifecycle wiring for resume/focus/pageshow, with dedupe + per-handler throttling.
    // This keeps KPIs/datasets fresh without multiple modules each binding global listeners.
    try {
      if (window.kexoLifecycle && window.kexoLifecycle.__kexoLifecycleV1) return;
    } catch (_) {}

    var _handlers = Object.create(null); // key -> entry
    var _keysSorted = [];
    var _hiddenHandlers = Object.create(null); // key -> entry
    var _hiddenKeysSorted = [];

    var _lastHiddenAt = 0;
    var _lastHiddenPerfAt = 0;
    var _lastBlurAt = 0;
    var _lastBlurPerfAt = 0;
    var _lastResumeAt = 0;
    var _lastResumePerfAt = 0;
    var _lastResumeSource = '';
    var _globalMinIntervalMs = 900;

    function nowMs() { return Date.now(); }
    function perfNowMs() {
      try { return (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? performance.now() : 0; } catch (_) { return 0; }
    }
    function isVisibleNow() {
      try { return document.visibilityState === 'visible'; } catch (_) { return true; }
    }

    function setHiddenAt(ts) {
      _lastHiddenAt = ts || nowMs();
      try { window.__kexoLastHiddenAt = _lastHiddenAt; } catch (_) {}
      var pn = perfNowMs();
      if (pn > 0) _lastHiddenPerfAt = pn;
    }

    function setBlurAt(ts) {
      _lastBlurAt = ts || nowMs();
      var pn = perfNowMs();
      if (pn > 0) _lastBlurPerfAt = pn;
    }

    function sortKeys() {
      try {
        _keysSorted = Object.keys(_handlers).sort(function (a, b) {
          var pa = (_handlers[a] && Number(_handlers[a].priority)) || 0;
          var pb = (_handlers[b] && Number(_handlers[b].priority)) || 0;
          if (pa !== pb) return pb - pa;
          return a < b ? -1 : a > b ? 1 : 0;
        });
      } catch (_) {
        _keysSorted = Object.keys(_handlers);
      }
    }

    function sortHiddenKeys() {
      try {
        _hiddenKeysSorted = Object.keys(_hiddenHandlers).sort(function (a, b) {
          var pa = (_hiddenHandlers[a] && Number(_hiddenHandlers[a].priority)) || 0;
          var pb = (_hiddenHandlers[b] && Number(_hiddenHandlers[b].priority)) || 0;
          if (pa !== pb) return pb - pa;
          return a < b ? -1 : a > b ? 1 : 0;
        });
      } catch (_) {
        _hiddenKeysSorted = Object.keys(_hiddenHandlers);
      }
    }

    function emitResume(source, ev, extra) {
      if (!isVisibleNow()) return;
      var t = nowMs();
      var pn = perfNowMs();
      if (pn > 0) {
        if (_lastResumePerfAt && (pn - _lastResumePerfAt) < _globalMinIntervalMs) return;
        _lastResumePerfAt = pn;
      } else {
        if (_lastResumeAt && (t - _lastResumeAt) < _globalMinIntervalMs) return;
      }
      _lastResumeAt = t;
      _lastResumeSource = source || 'unknown';

      var awayAt = Math.max(_lastHiddenAt || 0, _lastBlurAt || 0);
      var idleMs = awayAt ? Math.max(0, t - awayAt) : 0;
      if (pn > 0) {
        var awayPerfAt = Math.max(_lastHiddenPerfAt || 0, _lastBlurPerfAt || 0);
        if (awayPerfAt > 0) idleMs = Math.max(0, pn - awayPerfAt);
      }
      var ctx = Object.assign(
        {
          source: _lastResumeSource,
          at: t,
          idleMs: idleMs,
          visible: true,
          persisted: !!(ev && ev.persisted),
          event: ev || null,
        },
        extra || {}
      );

      for (let i = 0; i < _keysSorted.length; i++) {
        let k = _keysSorted[i];
        let entry = _handlers[k];
        if (!entry || typeof entry.fn !== 'function') continue;

        if (entry.inFlight) continue;
        if (entry.minIntervalMs && entry.lastRunAt && (t - entry.lastRunAt) < entry.minIntervalMs) continue;
        if (entry.minIdleMs && idleMs < entry.minIdleMs) continue;

        entry.lastRunAt = t;
        try {
          var ret = entry.fn(ctx);
          if (ret && typeof ret.then === 'function') {
            entry.inFlight = ret;
            ret.then(
              function () { entry.inFlight = null; },
              function () { entry.inFlight = null; }
            );
          }
        } catch (err) {
          try {
            if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'lifecycle.resume', source: ctx.source, key: k });
          } catch (_) {}
        }
      }
    }

    function emitHidden(source, ev, extra) {
      if (isVisibleNow()) return;
      var t = nowMs();
      var ctx = Object.assign(
        {
          source: source || 'hidden',
          at: t,
          visible: false,
          persisted: !!(ev && ev.persisted),
          event: ev || null,
        },
        extra || {}
      );
      for (let i = 0; i < _hiddenKeysSorted.length; i++) {
        let k = _hiddenKeysSorted[i];
        let entry = _hiddenHandlers[k];
        if (!entry || typeof entry.fn !== 'function') continue;
        try {
          entry.fn(ctx);
        } catch (err) {
          try {
            if (typeof window.kexoCaptureError === 'function') window.kexoCaptureError(err, { context: 'lifecycle.hidden', source: ctx.source, key: k });
          } catch (_) {}
        }
      }
    }

    function onVisibilityChange(ev) {
      if (!isVisibleNow()) {
        setHiddenAt(nowMs());
        return emitHidden('visibility', ev);
      }
      emitResume('visibility', ev);
    }

    function onFocus(ev) {
      if (!isVisibleNow()) return;
      emitResume('focus', ev);
    }

    function onBlur() {
      setBlurAt(nowMs());
    }

    function onPageShow(ev) {
      if (!ev || !ev.persisted) return;
      emitResume('pageshow', ev);
    }

    function onPageHide(ev) {
      setHiddenAt(nowMs());
      emitHidden('pagehide', ev);
    }

    try {
      document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
      window.addEventListener('focus', onFocus, { passive: true });
      window.addEventListener('blur', onBlur, { passive: true });
      window.addEventListener('pageshow', onPageShow, { passive: true });
      window.addEventListener('pagehide', onPageHide, { passive: true });
    } catch (_) {}

    function onResume(fn, opts) {
      var o = opts && typeof opts === 'object' ? opts : {};
      var key = o.key != null ? String(o.key).trim() : '';
      if (!key) key = 'resume:' + String(Math.random()).slice(2);
      _handlers[key] = {
        key: key,
        fn: fn,
        priority: Number(o.priority) || 0,
        minIntervalMs: Math.max(0, Number(o.minIntervalMs) || 0),
        minIdleMs: Math.max(0, Number(o.minIdleMs) || 0),
        lastRunAt: 0,
        inFlight: null,
      };
      sortKeys();
      return function () { offResume(key); };
    }

    function offResume(key) {
      var k = key != null ? String(key).trim() : '';
      if (!k) return;
      if (_handlers[k]) delete _handlers[k];
      sortKeys();
    }

    function onHidden(fn, opts) {
      var o = opts && typeof opts === 'object' ? opts : {};
      var key = o.key != null ? String(o.key).trim() : '';
      if (!key) key = 'hidden:' + String(Math.random()).slice(2);
      _hiddenHandlers[key] = {
        key: key,
        fn: fn,
        priority: Number(o.priority) || 0,
      };
      sortHiddenKeys();
      return function () { offHidden(key); };
    }

    function offHidden(key) {
      var k = key != null ? String(key).trim() : '';
      if (!k) return;
      if (_hiddenHandlers[k]) delete _hiddenHandlers[k];
      sortHiddenKeys();
    }

    try {
      window.kexoLifecycle = {
        __kexoLifecycleV1: 1,
        onResume: onResume,
        offResume: offResume,
        onHidden: onHidden,
        offHidden: offHidden,
        triggerResume: function (source) { emitResume(source || 'manual', null, { manual: true }); },
        getLastHiddenAt: function () { return _lastHiddenAt || 0; },
        getLastResumeAt: function () { return _lastResumeAt || 0; },
        getLastResumeSource: function () { return _lastResumeSource || ''; },
      };
    } catch (_) {}
  })();

