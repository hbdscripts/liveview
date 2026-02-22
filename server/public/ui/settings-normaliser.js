(function () {
  'use strict';

  // Settings/Admin UI normaliser (runtime guardrails).
  // Idempotent + memory-safe: panel-level attributes prevent repeated destructive changes.

  var SETTINGS_PANEL_SELECTOR = '[id^="settings-"][id*="-panel-"]:not([id^="settings-panel-"]), [id^="admin-panel-"]';
  var SETTINGS_PANEL_WRAP_CLASS = 'settings-panel-wrap';
  var SETTINGS_PANEL_NORMALISE_ATTR = 'data-settings-ui-normalised';
  var SETTINGS_PANEL_HEADER_STRIPPED_ATTR = 'data-settings-ui-first-header-stripped';
  var SETTINGS_PANEL_OBSERVER_ATTR = 'data-settings-ui-observer';

  function isElement(node) {
    return !!(node && node.nodeType === 1 && node.querySelector);
  }

  function safeMatches(el, selector) {
    if (!el || !el.matches) return false;
    try { return el.matches(selector); } catch (_) { return false; }
  }

  function getPanelWrap(panelEl) {
    if (!panelEl || !panelEl.querySelector) return null;
    var direct = null;
    try { direct = panelEl.querySelector(':scope > .' + SETTINGS_PANEL_WRAP_CLASS); } catch (_) { direct = null; }
    if (direct) return direct;
    return panelEl.querySelector('.' + SETTINGS_PANEL_WRAP_CLASS) || null;
  }

  function ensurePanelWrap(panelEl) {
    if (!isElement(panelEl)) return null;
    var wrap = null;
    try { wrap = panelEl.querySelector(':scope > .' + SETTINGS_PANEL_WRAP_CLASS); } catch (_) { wrap = null; }
    if (!wrap) {
      var existing = panelEl.querySelector('.' + SETTINGS_PANEL_WRAP_CLASS);
      if (existing) {
        wrap = existing;
        try { panelEl.insertBefore(wrap, panelEl.firstChild); } catch (_) {}
      } else {
        wrap = document.createElement('div');
        wrap.className = SETTINGS_PANEL_WRAP_CLASS;
        panelEl.insertBefore(wrap, panelEl.firstChild);
      }
    }
    // Ensure ALL direct children (except wrap) are inside the wrap.
    var toMove = [];
    try {
      Array.prototype.slice.call(panelEl.childNodes || []).forEach(function (n) {
        if (!n) return;
        if (n === wrap) return;
        if (n.nodeType === 3 && !String(n.nodeValue || '').trim()) return; // whitespace
        toMove.push(n);
      });
    } catch (_) {}
    toMove.forEach(function (n) { try { wrap.appendChild(n); } catch (_) {} });
    return wrap;
  }

  function flattenNestedPanelWraps(wrap) {
    if (!wrap || !wrap.querySelectorAll) return;
    var inner;
    while (true) {
      try { inner = wrap.querySelector('.' + SETTINGS_PANEL_WRAP_CLASS); } catch (_) { inner = null; }
      if (!inner || inner === wrap) break;
      try {
        while (inner.firstChild) wrap.appendChild(inner.firstChild);
        if (inner.parentNode) inner.parentNode.removeChild(inner);
      } catch (_) { break; }
    }
  }

  function removeClassPrefix(el, prefix) {
    if (!el || !el.classList) return;
    var p = String(prefix || '');
    if (!p) return;
    Array.prototype.slice.call(el.classList).forEach(function (c) {
      if (c && c.indexOf(p) === 0) el.classList.remove(c);
    });
  }

  function normaliseGridLayouts(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;

    // Collapse CSS grids used for vertical stacks into flex-column.
    wrap.querySelectorAll('.d-grid:not([data-settings-ui-grid])').forEach(function (grid) {
      if (!grid || !grid.classList) return;
      grid.setAttribute('data-settings-ui-grid', '1');
      var gap = 'gap-3';
      try {
        Array.prototype.slice.call(grid.classList).forEach(function (c) {
          if (!c) return;
          var m = /^gap-(\d)$/.exec(c);
          if (m) gap = 'gap-' + m[1];
        });
      } catch (_) {}
      grid.classList.remove('d-grid');
      grid.classList.add('d-flex', 'flex-column', gap);
    });

    // Collapse Bootstrap grid rows into predictable single-column stacks.
    wrap.querySelectorAll('.row:not([data-settings-ui-row])').forEach(function (row) {
      if (!row || !row.classList) return;
      row.setAttribute('data-settings-ui-row', '1');

      var kids = Array.prototype.slice.call(row.children || []);
      if (!kids.length) {
        row.classList.remove('row');
        removeClassPrefix(row, 'g-');
        return;
      }

      var isInline = row.classList.contains('align-items-center') || kids.some(function (k) { return k && k.classList && k.classList.contains('col-auto'); });
      var gap = 'gap-3';
      try {
        Array.prototype.slice.call(row.classList).forEach(function (c) {
          if (!c) return;
          var m = /^g-(\d)$/.exec(c);
          if (m) gap = 'gap-' + m[1];
        });
      } catch (_) {}

      // Convert the row container itself.
      row.classList.remove('row');
      removeClassPrefix(row, 'g-');
      removeClassPrefix(row, 'row-cols-');
      if (isInline) row.classList.add('d-flex', 'flex-wrap', 'align-items-center', gap);
      else row.classList.add('d-flex', 'flex-column', gap);

      // Normalise columns.
      kids.forEach(function (col) {
        if (!col || !col.classList) return;
        col.classList.remove('col', 'col-auto');
        removeClassPrefix(col, 'col-');
        if (isInline) col.classList.add('w-auto');
        else col.classList.add('w-100');
        // If this column is only a wrapper around a single card/section, unwrap it to reduce nesting.
        try {
          if (!isInline && col.children && col.children.length === 1) {
            var only = col.children[0];
            if (only && only.classList && (only.classList.contains('card') || only.classList.contains('accordion') || only.classList.contains('table-responsive'))) {
              row.insertBefore(only, col);
              col.parentNode.removeChild(col);
            }
          }
        } catch (_) {}
      });
    });
  }

  function ensureCardBody(cardEl) {
    if (!isElement(cardEl)) return null;
    var body = null;
    try { body = cardEl.querySelector(':scope > .card-body'); } catch (_) { body = null; }
    if (!body) body = cardEl.querySelector('.card-body');
    if (body) return body;
    body = document.createElement('div');
    body.className = 'card-body';
    var first = cardEl.firstElementChild;
    if (first) cardEl.insertBefore(body, first.nextSibling);
    else cardEl.appendChild(body);
    return body;
  }

  function isTitleNode(el) {
    if (!isElement(el)) return false;
    if (el.classList && el.classList.contains('card-title')) return true;
    var tag = String(el.tagName || '').toUpperCase();
    return tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6';
  }

  function stripFirstCardHeaderInPanel(panelEl) {
    if (!isElement(panelEl)) return false;
    if (panelEl.getAttribute(SETTINGS_PANEL_HEADER_STRIPPED_ATTR) === '1') return false;
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap) return false;

    // Only strip the header on the FIRST card in the panel. If the first card has no header,
    // we must NOT touch later cards (2nd/3rd/etc headers must remain).
    var firstCard = null;
    try { firstCard = wrap.querySelector(':scope > .card'); } catch (_) { firstCard = null; }
    if (!firstCard) {
      try { firstCard = wrap.querySelector('.card'); } catch (_) { firstCard = null; }
    }
    if (!firstCard || !firstCard.classList || !firstCard.classList.contains('card')) return false;

    var firstHeader = null;
    try { firstHeader = firstCard.querySelector(':scope > .card-header'); } catch (_) { firstHeader = null; }
    if (!firstHeader || !firstHeader.parentElement) {
      panelEl.setAttribute(SETTINGS_PANEL_HEADER_STRIPPED_ATTR, '1');
      return false;
    }

    var headerChildren = Array.prototype.slice.call(firstHeader.children || []);
    var titleEls = headerChildren.filter(isTitleNode);
    var controlEls = headerChildren.filter(function (el) { return el && !isTitleNode(el); });
    // Also remove any nested title nodes (handles wrapped header layouts).
    try {
      Array.prototype.slice.call(firstHeader.querySelectorAll('.card-title, h1, h2, h3, h4, h5, h6')).forEach(function (t) {
        if (titleEls.indexOf(t) === -1) titleEls.push(t);
      });
    } catch (_) {}

    // If the header is title-only, remove it entirely.
    if (controlEls.length === 0) {
      try { firstHeader.parentNode.removeChild(firstHeader); } catch (_) {}
      panelEl.setAttribute(SETTINGS_PANEL_HEADER_STRIPPED_ATTR, '1');
      return true;
    }

    // Preserve non-title controls by moving them into the top of the card body.
    var body = ensureCardBody(firstCard);
    if (body) {
      var controlsWrap = document.createElement('div');
      controlsWrap.className = 'settings-card-controls d-flex align-items-center flex-wrap gap-2 mb-3';
      controlEls.forEach(function (el) { try { controlsWrap.appendChild(el); } catch (_) {} });
      // Ensure we don't preserve a duplicated title inside moved controls.
      try {
        Array.prototype.slice.call(controlsWrap.querySelectorAll('.card-title, h1, h2, h3, h4, h5, h6')).forEach(function (t) {
          try { t.parentNode && t.parentNode.removeChild(t); } catch (_) {}
        });
      } catch (_) {}
      try { body.insertBefore(controlsWrap, body.firstChild); } catch (_) { try { body.appendChild(controlsWrap); } catch (_) {} }
    }

    // Remove any title elements left behind, then remove header container.
    titleEls.forEach(function (el) { try { el.parentNode && el.parentNode.removeChild(el); } catch (_) {} });
    try { firstHeader.parentNode.removeChild(firstHeader); } catch (_) {}

    panelEl.setAttribute(SETTINGS_PANEL_HEADER_STRIPPED_ATTR, '1');
    return true;
  }

  function flattenWrapperCards(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;

    var cards = [];
    try { cards = Array.prototype.slice.call(wrap.querySelectorAll(':scope > .card')); } catch (_) { cards = []; }

    cards.forEach(function (card) {
      if (!isElement(card) || !card.classList) return;
      if (card.classList.contains('settings-flat-card')) return;

      // Never flatten cards that still have a header — those are intentional sections.
      var header = null;
      try { header = card.querySelector(':scope > .card-header'); } catch (_) { header = null; }
      if (header) return;

      var body = null;
      try { body = card.querySelector(':scope > .card-body'); } catch (_) { body = null; }
      if (!body) return;

      // Flatten only "wrapper cards" that contain nested containers (cards/accordions/grids).
      // This avoids the "container inside container inside container" look where every wrapper adds
      // its own border + padding on top of the Settings tab frame.
      var hasNestedContainer = false;
      try {
        hasNestedContainer = !!body.querySelector('.accordion, .settings-layout-accordion, .settings-responsive-grid, .table-responsive, .card');
      } catch (_) { hasNestedContainer = false; }

      if (!hasNestedContainer) return;

      try { card.classList.add('settings-flat-card'); } catch (_) {}
      try { body.classList.add('settings-flat-card-body'); } catch (_) {}
    });
  }

  function normaliseHeadingsAndSpacing(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;
    // Loose headings: ensure consistent spacing and avoid touching tabs/accordion edges.
    wrap.querySelectorAll(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6').forEach(function (h) {
      if (!h || !h.classList) return;
      if (h.getAttribute('data-settings-ui-heading') === '1') return;
      h.setAttribute('data-settings-ui-heading', '1');
      h.classList.add('settings-panel-heading');
      h.classList.remove('mb-0', 'mb-1');
      if (!h.classList.contains('mb-2')) h.classList.add('mb-2');
    });
  }

  function ensureReadOnlyHint(el, hintText) {
    if (!isElement(el)) return;
    var existing = null;
    try { existing = el.parentElement && el.parentElement.querySelector ? el.parentElement.querySelector('.form-hint.settings-readonly-hint') : null; } catch (_) { existing = null; }
    if (existing) return;
    var hint = document.createElement('div');
    hint.className = 'form-hint settings-readonly-hint';
    hint.textContent = hintText || 'Read-only — set via environment config.';
    try { el.insertAdjacentElement('afterend', hint); } catch (_) { try { el.parentElement && el.parentElement.appendChild(hint); } catch (_) {} }
  }

  function removeReadOnlyHints(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;
    try {
      wrap.querySelectorAll('.form-hint.settings-readonly-hint').forEach(function (el) {
        try { el.parentNode && el.parentNode.removeChild(el); } catch (_) {}
      });
    } catch (_) {}
  }

  function removeDeadCardHeaderChevrons(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;
    // Accordion chevrons only belong in accordion headers, not in card headers.
    try {
      wrap.querySelectorAll('.card-header .kexo-settings-accordion-chevron').forEach(function (ch) {
        try { ch.parentNode && ch.parentNode.removeChild(ch); } catch (_) {}
      });
    } catch (_) {}
  }

  function removeCardCollapseToggles(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;
    // Remove chevron collapse toggle buttons from all cards in Settings panels.
    try {
      wrap.querySelectorAll('.kexo-card-collapse-toggle').forEach(function (btn) {
        try { btn.parentNode && btn.parentNode.removeChild(btn); } catch (_) {}
      });
    } catch (_) {}
  }

  function normaliseButtonsAndForms(panelEl) {
    var wrap = getPanelWrap(panelEl) || panelEl;
    if (!wrap || !wrap.querySelectorAll) return;

    // Remove any previously injected read-only hints (avoid duplicate/unstyled "Read-only…" text).
    removeReadOnlyHints(panelEl);

    // Read-only fields must look read-only (Tabler plaintext + hint).
    wrap.querySelectorAll('input[readonly], textarea[readonly], select[disabled], input[disabled], textarea[disabled]').forEach(function (field) {
      if (!field || !field.classList) return;
      if (field.getAttribute('data-settings-ui-ro') === '1') return;
      field.setAttribute('data-settings-ui-ro', '1');
      var isEnvReadOnly = field.classList.contains('kexo-readonly-field') || field.getAttribute('aria-readonly') === 'true' || field.hasAttribute('readonly');
      if (isEnvReadOnly && (field.tagName || '').toUpperCase() === 'INPUT') {
        field.classList.remove('form-control');
        field.classList.add('form-control-plaintext', 'settings-readonly-plaintext');
        try { field.readOnly = true; } catch (_) {}
        try { field.setAttribute('aria-readonly', 'true'); } catch (_) {}
      } else if (field.hasAttribute('disabled')) {
        // Disabled fields should look disabled; do not add redundant read-only hint text.
      }
    });

    // Button class normalisation (Tabler conventions).
    wrap.querySelectorAll('button, a.btn').forEach(function (btn) {
      if (!btn || !btn.classList) return;
      if (btn.getAttribute('data-settings-ui-btn') === '1') return;
      btn.setAttribute('data-settings-ui-btn', '1');

      if (btn.classList.contains('btn-ghost-secondary')) {
        btn.classList.remove('btn-ghost-secondary');
        btn.classList.add('btn-secondary');
      }
      if (btn.classList.contains('btn-ghost-danger')) {
        btn.classList.remove('btn-ghost-danger');
        btn.classList.add('btn-danger');
      }

      if (btn.classList.contains('btn-secondary-outline')) {
        btn.classList.remove('btn-secondary-outline');
        btn.classList.add('btn-secondary');
      }

      // Contract: no outline buttons. Convert outline variants to solid.
      ['primary', 'secondary', 'danger', 'success', 'warning', 'info', 'light', 'dark'].forEach(function (v) {
        var outline = 'btn-outline-' + v;
        if (btn.classList.contains(outline)) {
          btn.classList.remove(outline);
          btn.classList.add('btn-' + v);
        }
      });

      var text = '';
      try { text = String(btn.textContent || '').trim().toLowerCase(); } catch (_) { text = ''; }
      var isPrimaryAction = text === 'save' || text === 'apply' || text === 'update' || text === 'save settings';
      if (isPrimaryAction) {
        btn.classList.remove(
          'btn-outline-primary',
          'btn-outline-secondary',
          'btn-outline-danger',
          'btn-outline-success',
          'btn-outline-warning',
          'btn-outline-info',
          'btn-outline-light',
          'btn-outline-dark',
          'btn-secondary',
          'btn-secondary-outline',
          'btn-success',
          'btn-danger'
        );
        btn.classList.add('btn-primary');
      }

      if (!btn.classList.contains('btn-sm') && !btn.classList.contains('btn-lg')) {
        btn.classList.add('btn-md');
      }
    });
  }

  function normaliseSettingsPanel(panelEl) {
    if (!isElement(panelEl)) return;
    var wrap = ensurePanelWrap(panelEl);
    if (wrap) flattenNestedPanelWraps(wrap);
    normaliseGridLayouts(panelEl);
    stripFirstCardHeaderInPanel(panelEl);
    flattenWrapperCards(panelEl);
    removeDeadCardHeaderChevrons(panelEl);
    removeCardCollapseToggles(panelEl);
    normaliseHeadingsAndSpacing(panelEl);
    normaliseButtonsAndForms(panelEl);
    try { panelEl.setAttribute(SETTINGS_PANEL_NORMALISE_ATTR, '1'); } catch (_) {}
  }

  function reportNormaliserError(where, err, extra) {
    try { console.warn('[settings-normaliser]', where, err); } catch (_) {}
    try {
      if (window.kexoSentry && typeof window.kexoSentry.captureException === 'function') {
        var ctx = Object.assign({ context: 'settings.normaliser.' + String(where || 'unknown') }, (extra && typeof extra === 'object') ? extra : {});
        window.kexoSentry.captureException(err, ctx, 'warning');
      }
    } catch (_) {}
  }

  function normaliseAllSettingsPanels(rootEl) {
    var scope = isElement(rootEl) ? rootEl : document;
    var panels = [];
    try { panels = Array.prototype.slice.call(scope.querySelectorAll(SETTINGS_PANEL_SELECTOR)); } catch (e) { panels = []; reportNormaliserError('querySelectorAll', e, { selector: SETTINGS_PANEL_SELECTOR }); }
    panels.forEach(function (p) {
      try {
        normaliseSettingsPanel(p);
      } catch (e) {
        reportNormaliserError('normaliseSettingsPanel', e, { panelId: (p && p.id) ? String(p.id) : '' });
      }
    });
    // Second pass: flatten nested wraps so no wrap contains another .settings-panel-wrap.
    panels.forEach(function (p) {
      try {
        var w = getPanelWrap(p);
        if (w) flattenNestedPanelWraps(w);
      } catch (e) {
        reportNormaliserError('flattenNestedPanelWraps', e, { panelId: (p && p.id) ? String(p.id) : '' });
      }
    });
  }

  function wireSettingsUiMutationObserver() {
    if (document.documentElement.getAttribute(SETTINGS_PANEL_OBSERVER_ATTR) === '1') return;
    document.documentElement.setAttribute(SETTINGS_PANEL_OBSERVER_ATTR, '1');

    var container = document.querySelector('.col-lg-9') || document.querySelector('.page-body') || document.body;
    if (!container || typeof MutationObserver === 'undefined') return;

    var pending = new Set();
    var scheduled = false;

    function flush() {
      scheduled = false;
      try {
        pending.forEach(function (p) {
          try {
            normaliseSettingsPanel(p);
          } catch (e) {
            reportNormaliserError('observer.normaliseSettingsPanel', e, { panelId: (p && p.id) ? String(p.id) : '' });
          }
        });
      } finally {
        pending.clear();
      }
    }

    function scheduleFlush() {
      if (scheduled) return;
      scheduled = true;
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(flush);
      else setTimeout(flush, 0);
    }

    function queue(panel) {
      if (!isElement(panel)) return;
      pending.add(panel);
      scheduleFlush();
    }

    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (!m || !m.addedNodes) return;
        Array.prototype.slice.call(m.addedNodes).forEach(function (n) {
          if (!isElement(n)) return;
          if (safeMatches(n, SETTINGS_PANEL_SELECTOR)) {
            queue(n);
            return;
          }
          var parentPanel = null;
          try { parentPanel = n.closest(SETTINGS_PANEL_SELECTOR); } catch (_) { parentPanel = null; }
          if (parentPanel) queue(parentPanel);
        });
      });
    });
    try { obs.observe(container, { childList: true, subtree: true }); } catch (e) { reportNormaliserError('observer.observe', e); }
    try {
      window.addEventListener('beforeunload', function () {
        try { obs.disconnect(); } catch (e) { reportNormaliserError('observer.disconnect', e); }
      });
    } catch (_) {}
  }

  window.KexoSettingsUiNormaliser = {
    SETTINGS_PANEL_SELECTOR: SETTINGS_PANEL_SELECTOR,
    ensurePanelWrap: ensurePanelWrap,
    normaliseGridLayouts: normaliseGridLayouts,
    stripFirstCardHeaderInPanel: stripFirstCardHeaderInPanel,
    flattenWrapperCards: flattenWrapperCards,
    normaliseHeadingsAndSpacing: normaliseHeadingsAndSpacing,
    normaliseButtonsAndForms: normaliseButtonsAndForms,
    normaliseSettingsPanel: normaliseSettingsPanel,
    normaliseAllSettingsPanels: normaliseAllSettingsPanels,
    wireSettingsUiMutationObserver: wireSettingsUiMutationObserver,
  };
})();

