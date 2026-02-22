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

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isSettingsPage() {
    try { return !!(document.body && document.body.getAttribute('data-page') === 'settings'); } catch (_) { return false; }
  }

  function buildHelpTrigger(helpText, ariaLabel, extraClass) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kexo-icon-help-trigger' + (extraClass ? (' ' + String(extraClass)) : '') + ' ms-1';
    btn.setAttribute('data-settings-ui-btn', '1');
    btn.setAttribute('data-kexo-help', String(helpText || '').trim());
    btn.setAttribute('aria-label', String(ariaLabel || 'Show description'));
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<i class="kexo-icon-help-trigger-icon" data-icon-key="admin-tab-help-tooltip" aria-hidden="true"></i>';
    return btn;
  }

  function migrateHelpCueNodes(root) {
    if (!root || !root.querySelectorAll) return;
    if (!isSettingsPage()) return;
    root.querySelectorAll('.am-tooltip-cue').forEach(function (cue) {
      if (!cue || !cue.parentNode || !cue.getAttribute) return;
      // Skip if this is already a new-style trigger.
      if (cue.classList && cue.classList.contains('kexo-icon-help-trigger')) return;

      var title = String(cue.getAttribute('title') || '').trim();
      var titledEl = null;
      if (title) titledEl = cue;
      if (!title && cue.closest) {
        titledEl = cue.closest('[title]');
        if (titledEl && titledEl.getAttribute) title = String(titledEl.getAttribute('title') || '').trim();
      }
      if (!title) return;

      var ariaLabel = String(cue.getAttribute('aria-label') || '').trim() || 'Show description';
      var btn = buildHelpTrigger(title, ariaLabel, '');
      try { cue.parentNode.replaceChild(btn, cue); } catch (_) {}
      try { if (titledEl && titledEl.removeAttribute) titledEl.removeAttribute('title'); } catch (_) {}
    });
  }

  function ensureHelpTriggersForTitledLabels(root) {
    if (!root || !root.querySelectorAll) return;
    if (!isSettingsPage()) return;
    var sel = [
      'label[title]',
      'legend[title]',
      'summary[title]',
      'th > span[title]',
      '.form-check-label[title]',
      '.form-label[title]',
      'h1[title], h2[title], h3[title], h4[title], h5[title], h6[title]',
    ].join(',');
    root.querySelectorAll(sel).forEach(function (el) {
      if (!el || !el.getAttribute || !el.appendChild) return;
      var title = String(el.getAttribute('title') || '').trim();
      if (!title) return;
      try {
        if (el.querySelector && el.querySelector('.kexo-icon-help-trigger, .am-tooltip-cue')) return;
      } catch (_) {}
      var aria = (el.textContent || '').replace(/\s+/g, ' ').trim();
      var btn = buildHelpTrigger(title, aria ? ('Help: ' + aria) : 'Show description', '');
      try { el.appendChild(btn); } catch (_) {}
      try { el.removeAttribute('title'); } catch (_) {}
    });
  }

  // Legacy help popover fallback when Bootstrap isn't available.
  var _legacyHelpPopoverEl = null;
  var _legacyHelpPopoverCurrentTrigger = null;
  var _legacyHelpPopoverBound = false;

  function hideLegacyHelpPopover() {
    if (_legacyHelpPopoverEl) {
      _legacyHelpPopoverEl.hidden = true;
      _legacyHelpPopoverEl.removeAttribute('aria-expanded');
    }
    if (_legacyHelpPopoverCurrentTrigger) {
      _legacyHelpPopoverCurrentTrigger.setAttribute('aria-expanded', 'false');
      _legacyHelpPopoverCurrentTrigger = null;
    }
  }

  function bindLegacyHelpPopoverHandlers() {
    if (_legacyHelpPopoverBound) return;
    _legacyHelpPopoverBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideLegacyHelpPopover();
    });
    document.addEventListener('click', function (e) {
      if (!_legacyHelpPopoverEl || _legacyHelpPopoverEl.hidden) return;
      if (_legacyHelpPopoverEl.contains(e.target)) return;
      if (_legacyHelpPopoverCurrentTrigger && _legacyHelpPopoverCurrentTrigger.contains && _legacyHelpPopoverCurrentTrigger.contains(e.target)) return;
      hideLegacyHelpPopover();
    });
  }

  function showLegacyHelpPopover(trigger, text) {
    var t = String(text || '').trim();
    if (!t || !trigger) return;
    if (!_legacyHelpPopoverEl) {
      _legacyHelpPopoverEl = document.createElement('div');
      _legacyHelpPopoverEl.id = 'kexo-help-popover';
      _legacyHelpPopoverEl.setAttribute('role', 'dialog');
      _legacyHelpPopoverEl.setAttribute('aria-label', 'Help');
      _legacyHelpPopoverEl.className = 'kexo-help-popover';
      _legacyHelpPopoverEl.innerHTML = '<div class="kexo-help-popover-content"></div><button type="button" class="kexo-help-popover-close btn-close btn-close-white" aria-label="Close"></button>';
      document.body.appendChild(_legacyHelpPopoverEl);
      _legacyHelpPopoverEl.querySelector('.kexo-help-popover-close').addEventListener('click', function () { hideLegacyHelpPopover(); });
      bindLegacyHelpPopoverHandlers();
    }
    hideLegacyHelpPopover();
    var content = _legacyHelpPopoverEl.querySelector('.kexo-help-popover-content');
    if (content) content.textContent = t;
    _legacyHelpPopoverEl.hidden = false;
    _legacyHelpPopoverEl.setAttribute('aria-expanded', 'true');
    try { trigger.setAttribute('aria-expanded', 'true'); } catch (_) {}
    _legacyHelpPopoverCurrentTrigger = trigger;
    var rect = trigger.getBoundingClientRect();
    var popRect = _legacyHelpPopoverEl.getBoundingClientRect();
    var top = rect.top - popRect.height - 6;
    var left = rect.left + (rect.width / 2) - (popRect.width / 2);
    if (top < 8) top = rect.bottom + 6;
    if (left < 8) left = 8;
    if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
    _legacyHelpPopoverEl.style.top = top + 'px';
    _legacyHelpPopoverEl.style.left = left + 'px';
  }

  function initKexoHelpPopovers(root) {
    if (!root || !root.querySelectorAll) return;
    if (!isSettingsPage()) return;
    var Bootstrap = window.bootstrap || (window.tabler && window.tabler.bootstrap);
    var canBootstrap = !!(Bootstrap && Bootstrap.Popover);
    root.querySelectorAll('[data-kexo-help]').forEach(function (trigger) {
      if (!trigger || !trigger.getAttribute || !trigger.setAttribute) return;
      if (trigger.getAttribute('data-kexo-help-bound') === '1') return;
      trigger.setAttribute('data-kexo-help-bound', '1');
      try { trigger.removeAttribute('title'); } catch (_) {}
      try { trigger.setAttribute('aria-expanded', 'false'); } catch (_) {}

      if (!canBootstrap) {
        // Fallback: keep old behavior (no Bootstrap).
        trigger.setAttribute('role', 'button');
        if (!trigger.hasAttribute('tabindex')) trigger.setAttribute('tabindex', '0');
        trigger.addEventListener('click', function (e) {
          try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          var text = trigger.getAttribute('data-kexo-help') || '';
          if (!text) return;
          showLegacyHelpPopover(trigger, text);
        });
        return;
      }

      var text = String(trigger.getAttribute('data-kexo-help') || '').trim();
      if (!text) return;
      var placement = String(trigger.getAttribute('data-kexo-help-placement') || '').trim() || 'top';
      var contentHtml = '<div class="kexo-icon-help-popover-content">' +
        '<button type="button" class="btn-close kexo-icon-help-popover-close" aria-label="Close"></button>' +
        '<div class="kexo-icon-help-popover-text">' + escapeHtml(text) + '</div></div>';
      try {
        new Bootstrap.Popover(trigger, {
          title: '',
          content: contentHtml,
          html: true,
          trigger: 'click',
          placement: placement,
          customClass: 'kexo-icon-help-popover',
          sanitize: false,
          container: 'body'
        });
      } catch (_) {}
    });

    // One-time global close handler for the shared popover class.
    if (!window.__kexoIconHelpCloseBound) {
      try {
        window.__kexoIconHelpCloseBound = true;
        document.addEventListener('click', function (e) {
          var closeBtn = e.target && e.target.closest ? e.target.closest('.kexo-icon-help-popover .btn-close') : null;
          if (!closeBtn) return;
          var popoverEl = closeBtn.closest('.popover');
          if (!popoverEl || !popoverEl.id) return;
          var trigger = document.querySelector('[aria-describedby="' + popoverEl.id + '"]');
          var BootstrapRef = window.bootstrap || (window.tabler && window.tabler.bootstrap);
          if (trigger && BootstrapRef && BootstrapRef.Popover && BootstrapRef.Popover.getInstance(trigger)) BootstrapRef.Popover.getInstance(trigger).hide();
        });
      } catch (_) {}
    }
  }

  function migrateTitleToHelpPopover(root) {
    if (!root || !root.querySelectorAll) return;
    migrateHelpCueNodes(root);
    ensureHelpTriggersForTitledLabels(root);
  }

  try {
    window.initKexoTooltips = initKexoTooltips;
    window.disposeKexoTooltips = disposeKexoTooltips;
    window.initKexoHelpPopovers = initKexoHelpPopovers;
    window.migrateTitleToHelpPopover = migrateTitleToHelpPopover;
  } catch (_) {}
})();
