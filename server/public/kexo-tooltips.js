/**
 * Shared tooltip helper for Settings/Admin. Single popup, delegated listeners,
 * single-init per root, optional dispose. Matches Attribution look/behavior.
 */
(function () {
  'use strict';

  var _tooltipEl = null;
  var _tooltipTimer = null;
  var _tooltipCurrentEl = null;
  var _boundRoots = [];

  function restoreCurrent() {
    if (_tooltipCurrentEl && _tooltipCurrentEl.getAttribute && _tooltipCurrentEl.getAttribute('data-kexo-title')) {
      _tooltipCurrentEl.setAttribute('title', _tooltipCurrentEl.getAttribute('data-kexo-title'));
      _tooltipCurrentEl.removeAttribute('data-kexo-title');
    }
    _tooltipCurrentEl = null;
  }

  function show(el) {
    var title = el && el.getAttribute ? el.getAttribute('title') : '';
    if (!title) return;
    restoreCurrent();
    _tooltipEl.textContent = title;
    el.setAttribute('data-kexo-title', title);
    el.removeAttribute('title');
    _tooltipCurrentEl = el;
    _tooltipEl.style.opacity = '1';
    var rect = el.getBoundingClientRect();
    var ttRect = _tooltipEl.getBoundingClientRect();
    var top = rect.top - ttRect.height - 6;
    var left = rect.left + (rect.width / 2) - (ttRect.width / 2);
    if (top < 8) top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (left + ttRect.width > window.innerWidth - 8) left = window.innerWidth - ttRect.width - 8;
    _tooltipEl.style.top = top + 'px';
    _tooltipEl.style.left = left + 'px';
  }

  function hide() {
    restoreCurrent();
    _tooltipEl.style.opacity = '0';
  }

  function findTitleTarget(root, el) {
    for (var n = el; n && n !== root; n = n.parentNode) {
      if (n.getAttribute && n.getAttribute('title')) return n;
    }
    return null;
  }

  function hasBoundAncestor(root) {
    for (var n = root && root.parentNode; n; n = n.parentNode) {
      if (n.getAttribute && n.getAttribute('data-kexo-tooltips-bound') === '1') return true;
    }
    return false;
  }

  function initKexoTooltips(root) {
    if (!root || !root.querySelector) return;
    if (hasBoundAncestor(root)) return;
    if (root.getAttribute && root.getAttribute('data-kexo-tooltips-bound') === '1') return;
    root.setAttribute('data-kexo-tooltips-bound', '1');
    root.classList.add('kexo-has-tooltips');

    if (!document.getElementById('kexo-tooltip-styles')) {
      var s = document.createElement('style');
      s.id = 'kexo-tooltip-styles';
      s.textContent = '.kexo-has-tooltips [title], .kexo-has-tooltips [data-kexo-title] { cursor: help; }';
      document.head.appendChild(s);
    }
    if (!_tooltipEl) {
      _tooltipEl = document.createElement('div');
      _tooltipEl.id = 'kexo-tooltip-popup';
      _tooltipEl.setAttribute('role', 'tooltip');
      _tooltipEl.style.cssText = 'position:fixed;z-index:9999;max-width:320px;padding:8px 10px;background:#1e293b;color:#e2e8f0;font-size:13px;line-height:1.4;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.25);pointer-events:none;opacity:0;transition:opacity 0.15s ease;';
      document.body.appendChild(_tooltipEl);
    }

    function onEnter(e) {
      var target = findTitleTarget(root, e.target);
      if (!target) return;
      clearTimeout(_tooltipTimer);
      _tooltipTimer = setTimeout(function () { show(target); }, 200);
    }
    function onLeave() {
      clearTimeout(_tooltipTimer);
      _tooltipTimer = null;
      hide();
    }
    function onFocusIn(e) {
      var target = findTitleTarget(root, e.target);
      if (!target) return;
      clearTimeout(_tooltipTimer);
      _tooltipTimer = setTimeout(function () { show(target); }, 150);
    }
    function onFocusOut() {
      clearTimeout(_tooltipTimer);
      _tooltipTimer = null;
      hide();
    }

    root.addEventListener('mouseenter', onEnter, true);
    root.addEventListener('mouseleave', onLeave, true);
    root.addEventListener('focusin', onFocusIn, true);
    root.addEventListener('focusout', onFocusOut, true);

    _boundRoots.push({
      root: root,
      onEnter: onEnter,
      onLeave: onLeave,
      onFocusIn: onFocusIn,
      onFocusOut: onFocusOut,
    });
  }

  function disposeKexoTooltips(root) {
    if (!root) return;
    for (var i = 0; i < _boundRoots.length; i++) {
      if (_boundRoots[i].root === root) {
        root.removeEventListener('mouseenter', _boundRoots[i].onEnter, true);
        root.removeEventListener('mouseleave', _boundRoots[i].onLeave, true);
        root.removeEventListener('focusin', _boundRoots[i].onFocusIn, true);
        root.removeEventListener('focusout', _boundRoots[i].onFocusOut, true);
        root.classList.remove('kexo-has-tooltips');
        root.removeAttribute('data-kexo-tooltips-bound');
        if (_tooltipCurrentEl && root.contains(_tooltipCurrentEl)) hide();
        _boundRoots.splice(i, 1);
        return;
      }
    }
  }

  try {
    window.initKexoTooltips = initKexoTooltips;
    window.disposeKexoTooltips = disposeKexoTooltips;
  } catch (_) {}
})();
