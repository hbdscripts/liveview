(function () {
  'use strict';

  if (typeof window === 'undefined') return;

  var MAX_OPS = 240;
  var CAPTURE_BODY_CLASS = 'kexo-inline-capture-active';
  var SELECTED_CLASS = 'kexo-inline-capture-selected';

  var draft = emptyDraft();
  var enabled = false;
  var capturing = false;
  var selectedElement = null;
  var selectedSelector = '';
  var observer = null;
  var applyTimer = null;
  var documentClickWired = false;
  var ui = null;
  var onDraftChange = null;

  var SELECTOR_ATTRS = [
    'data-settings-kexo-tab',
    'data-settings-layout-tab',
    'data-settings-admin-tab',
    'data-settings-attribution-tab',
    'data-kexo-css-var',
    'data-kexo-chart-key',
    'data-theme-subtab',
    'data-theme-color-subtab',
    'data-theme-icon-help-key',
    'name',
  ];

  function emptyDraft() {
    return { v: 1, scope: 'settings', ops: [] };
  }

  function cloneDraft(raw) {
    try { return JSON.parse(JSON.stringify(raw || emptyDraft())); } catch (_) { return emptyDraft(); }
  }

  function escapeCssIdent(raw) {
    var value = raw == null ? '' : String(raw);
    if (!value) return '';
    try {
      if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    } catch (_) {}
    return value.replace(/[^a-zA-Z0-9_-]/g, function (ch) {
      return '\\' + ch.charCodeAt(0).toString(16) + ' ';
    });
  }

  function escapeAttrValue(raw) {
    return String(raw == null ? '' : raw).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function normalizeClassList(raw) {
    return String(raw == null ? '' : raw).split(/\s+/).filter(Boolean).join(' ');
  }

  function normalizeSelector(raw) {
    var selector = String(raw == null ? '' : raw).trim();
    if (!selector) return '';
    if (selector.length > 420) return '';
    return selector;
  }

  function normalizeCssProp(raw) {
    var key = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!key) return '';
    if (key.length > 64) return '';
    if (!/^[a-z][a-z0-9-]*$/.test(key)) return '';
    return key;
  }

  function normalizeCssValue(raw) {
    var value = String(raw == null ? '' : raw).trim();
    if (!value) return '';
    if (value.length > 180) return '';
    if (/[<>{}\r\n]/.test(value)) return '';
    return value;
  }

  function parseStyleDeclText(raw) {
    var out = {};
    var text = String(raw == null ? '' : raw);
    if (!text.trim()) return out;
    var parts = text.split(';');
    parts.forEach(function (chunk) {
      var pair = String(chunk || '');
      if (!pair.trim()) return;
      var idx = pair.indexOf(':');
      if (idx <= 0) return;
      var key = normalizeCssProp(pair.slice(0, idx));
      var value = normalizeCssValue(pair.slice(idx + 1));
      if (!key || !value) return;
      out[key] = value;
    });
    return out;
  }

  function formatStyleDeclText(decl) {
    if (!decl || typeof decl !== 'object') return '';
    var rows = [];
    Object.keys(decl).forEach(function (prop) {
      var key = normalizeCssProp(prop);
      var value = normalizeCssValue(decl[prop]);
      if (!key || !value) return;
      rows.push(key + ': ' + value + ';');
    });
    return rows.join('\n');
  }

  function normalizeDeclObject(raw) {
    if (!raw || typeof raw !== 'object') return {};
    var out = {};
    Object.keys(raw).forEach(function (prop) {
      var key = normalizeCssProp(prop);
      var value = normalizeCssValue(raw[prop]);
      if (!key || !value) return;
      out[key] = value;
    });
    return out;
  }

  function normalizeOp(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var op = String(raw.op || '').trim();
    var selector = normalizeSelector(raw.selector);
    if (!selector) return null;
    if (op === 'setClass') {
      return {
        op: 'setClass',
        selector: selector,
        from: normalizeClassList(raw.from),
        to: normalizeClassList(raw.to),
      };
    }
    if (op === 'setStyle') {
      var decl = normalizeDeclObject(raw.decl);
      if (!Object.keys(decl).length) return null;
      return {
        op: 'setStyle',
        selector: selector,
        decl: decl,
      };
    }
    return null;
  }

  function normalizeDraft(raw) {
    var parsed = raw;
    if (typeof parsed === 'string') {
      var txt = String(parsed || '').trim();
      if (!txt) return emptyDraft();
      try { parsed = JSON.parse(txt); } catch (_) { return emptyDraft(); }
    }
    if (!parsed || typeof parsed !== 'object') return emptyDraft();
    var opsIn = Array.isArray(parsed.ops) ? parsed.ops : [];
    var map = new Map();
    opsIn.forEach(function (row) {
      var normalized = normalizeOp(row);
      if (!normalized) return;
      map.set(normalized.op + '|' + normalized.selector, normalized);
    });
    var ops = Array.from(map.values());
    if (ops.length > MAX_OPS) ops = ops.slice(ops.length - MAX_OPS);
    return {
      v: 1,
      scope: 'settings',
      ops: ops,
    };
  }

  function stringifyDraft(nextDraft) {
    var normalized = normalizeDraft(nextDraft);
    if (!normalized.ops.length) return '';
    try { return JSON.stringify(normalized, null, 2); } catch (_) { return ''; }
  }

  function isSettingsPage() {
    try { return document.body && document.body.getAttribute('data-page') === 'settings'; } catch (_) { return false; }
  }

  function isElement(node) {
    return !!(node && node.nodeType === 1 && node.tagName);
  }

  function isSettingsTarget(el) {
    if (!isElement(el) || !isSettingsPage() || !el.closest) return false;
    try {
      return !!el.closest('#settings-page, #settings-main, #settings-theme-panel, [id^="settings-"], [id^="admin-panel-"]');
    } catch (_) {
      return false;
    }
  }

  function querySelectorSafe(selector) {
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  function querySelectorAllSafe(selector) {
    try { return document.querySelectorAll(selector); } catch (_) { return []; }
  }

  function selectorIsUnique(selector, el) {
    var nodes = querySelectorAllSafe(selector);
    return !!(nodes && nodes.length === 1 && nodes[0] === el);
  }

  function nthOfType(el) {
    if (!el || !el.parentElement) return 1;
    var parent = el.parentElement;
    var tag = String(el.tagName || '').toLowerCase();
    if (!tag) return 1;
    var idx = 0;
    var kids = parent.children || [];
    for (var i = 0; i < kids.length; i += 1) {
      var child = kids[i];
      if (!child || String(child.tagName || '').toLowerCase() !== tag) continue;
      idx += 1;
      if (child === el) return idx;
    }
    return 1;
  }

  function pickStableClassToken(el) {
    if (!el || !el.classList) return '';
    var ignore = /^(active|show|hide|collapsed|open|selected|disabled|btn|col-|row|mb-|mt-|ms-|me-|p-|px-|py-|g-|gap-|d-|w-|h-|text-|bg-)/;
    var classes = Array.prototype.slice.call(el.classList || []);
    for (var i = 0; i < classes.length; i += 1) {
      var token = String(classes[i] || '').trim();
      if (!token) continue;
      if (token.length > 48) continue;
      if (ignore.test(token)) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(token)) continue;
      return token;
    }
    return '';
  }

  function buildStableSelector(el) {
    if (!isElement(el)) return '';
    if (el.id) return '#' + escapeCssIdent(el.id);

    for (var i = 0; i < SELECTOR_ATTRS.length; i += 1) {
      var attr = SELECTOR_ATTRS[i];
      var value = '';
      try { value = el.getAttribute ? String(el.getAttribute(attr) || '').trim() : ''; } catch (_) { value = ''; }
      if (!value) continue;
      if (value.length > 120) continue;
      var tag = String(el.tagName || '').toLowerCase();
      var selector = tag + '[' + attr + '="' + escapeAttrValue(value) + '"]';
      if (selectorIsUnique(selector, el)) return selector;
    }

    var parts = [];
    var cursor = el;
    var steps = 0;
    while (cursor && cursor.nodeType === 1 && steps < 7) {
      var part = '';
      if (cursor.id) {
        part = '#' + escapeCssIdent(cursor.id);
        parts.unshift(part);
        break;
      }
      var tagName = String(cursor.tagName || '').toLowerCase();
      if (!tagName) break;
      part = tagName;
      var stableClass = pickStableClassToken(cursor);
      if (stableClass) part += '.' + escapeCssIdent(stableClass);
      else part += ':nth-of-type(' + nthOfType(cursor) + ')';
      parts.unshift(part);
      var candidate = parts.join(' > ');
      if (selectorIsUnique(candidate, el)) return candidate;
      cursor = cursor.parentElement;
      steps += 1;
    }
    var fallback = parts.join(' > ');
    if (fallback && selectorIsUnique(fallback, el)) return fallback;
    return '';
  }

  function clearSelectionHighlight() {
    if (selectedElement && selectedElement.classList) {
      try { selectedElement.classList.remove(SELECTED_CLASS); } catch (_) {}
    }
  }

  function setSelection(el, selector) {
    clearSelectionHighlight();
    selectedElement = el || null;
    selectedSelector = selector || '';
    if (selectedElement && selectedElement.classList) {
      try { selectedElement.classList.add(SELECTED_CLASS); } catch (_) {}
    }
    if (ui && ui.selectorInput) ui.selectorInput.value = selectedSelector || '';
    updateButtonState();
  }

  function setStatus(message, isError) {
    if (!ui || !ui.statusEl) return;
    var msg = message == null ? '' : String(message);
    ui.statusEl.textContent = msg;
    ui.statusEl.classList.remove('text-danger', 'text-success', 'text-secondary');
    if (!msg) return;
    ui.statusEl.classList.add(isError ? 'text-danger' : 'text-success');
  }

  function setEditorOpen(isOpen) {
    if (!ui || !ui.editorWrap) return;
    if (isOpen) ui.editorWrap.removeAttribute('hidden');
    else ui.editorWrap.setAttribute('hidden', 'hidden');
  }

  function updateDraftTextarea() {
    if (!ui || !ui.draftTextarea) return;
    ui.draftTextarea.value = stringifyDraft(draft);
  }

  function emitDraftChange(meta) {
    updateDraftTextarea();
    if (typeof onDraftChange === 'function') {
      try { onDraftChange(stringifyDraft(draft), meta || {}); } catch (_) {}
    }
    scheduleApply();
  }

  function updateButtonState() {
    if (!ui) return;
    if (ui.startBtn) ui.startBtn.disabled = !enabled;
    if (ui.stopBtn) ui.stopBtn.disabled = !capturing;
    if (ui.applyBtn) ui.applyBtn.disabled = !enabled || !selectedSelector;
    if (ui.clearBtn) ui.clearBtn.disabled = !draft.ops.length;
  }

  function setCapturing(next) {
    capturing = !!next;
    if (document.body) {
      try { document.body.classList.toggle(CAPTURE_BODY_CLASS, capturing); } catch (_) {}
    }
    updateButtonState();
  }

  function applyOp(op) {
    if (!op || !op.selector) return;
    var el = querySelectorSafe(op.selector);
    if (!el || !isSettingsTarget(el)) return;
    if (op.op === 'setClass') {
      var classText = normalizeClassList(op.to);
      if (normalizeClassList(el.className || '') !== classText) el.className = classText;
      return;
    }
    if (op.op === 'setStyle') {
      var decl = normalizeDeclObject(op.decl);
      var props = Object.keys(decl);
      for (var i = 0; i < props.length; i += 1) {
        var prop = props[i];
        var value = decl[prop];
        try { el.style.setProperty(prop, value); } catch (_) {}
      }
    }
  }

  function applyDraftNow() {
    if (!isSettingsPage()) return;
    if (!draft || !Array.isArray(draft.ops)) return;
    draft.ops.forEach(function (op) { applyOp(op); });
  }

  function scheduleApply() {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(function () { applyDraftNow(); }, 60);
  }

  function upsertOp(op) {
    if (!op) return;
    var key = op.op + '|' + op.selector;
    var foundIdx = -1;
    for (var i = 0; i < draft.ops.length; i += 1) {
      var row = draft.ops[i];
      if (!row) continue;
      if ((row.op + '|' + row.selector) === key) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx >= 0) draft.ops[foundIdx] = op;
    else draft.ops.push(op);
    if (draft.ops.length > MAX_OPS) draft.ops = draft.ops.slice(draft.ops.length - MAX_OPS);
  }

  function removeOp(opName, selector) {
    draft.ops = draft.ops.filter(function (row) {
      if (!row) return false;
      return !(row.op === opName && row.selector === selector);
    });
  }

  function onCaptureClick(event) {
    if (!capturing || !enabled) return;
    var target = event && event.target ? event.target : null;
    if (!target || !target.closest) return;
    if (ui && ui.root && ui.root.contains(target)) return;

    var pick = target.closest('[id], [name], button, a, input, select, textarea, label, th, td, tr, li, div, span');
    if (!pick || !isSettingsTarget(pick)) return;

    event.preventDefault();
    event.stopPropagation();

    var selector = buildStableSelector(pick);
    if (!selector) {
      setStatus('Could not build a stable selector for that element.', true);
      return;
    }
    setSelection(pick, selector);
    if (ui.classInput) ui.classInput.value = normalizeClassList(pick.className || '');
    if (ui.styleInput) ui.styleInput.value = formatStyleDeclText(parseStyleDeclText(pick.getAttribute('style') || ''));
    setEditorOpen(true);
    setStatus('Element selected. Edit class/style and click Capture edit.', false);
  }

  function applyCapturedEdit() {
    if (!enabled) {
      setStatus('Enable edit mode first.', true);
      return;
    }
    if (!selectedSelector) {
      setStatus('Select an element while capture is active.', true);
      return;
    }
    var nextClass = normalizeClassList(ui && ui.classInput ? ui.classInput.value : '');
    var styleDecl = parseStyleDeclText(ui && ui.styleInput ? ui.styleInput.value : '');

    upsertOp({
      op: 'setClass',
      selector: selectedSelector,
      from: normalizeClassList(selectedElement && selectedElement.className ? selectedElement.className : ''),
      to: nextClass,
    });

    if (Object.keys(styleDecl).length) {
      upsertOp({
        op: 'setStyle',
        selector: selectedSelector,
        decl: styleDecl,
      });
    } else {
      removeOp('setStyle', selectedSelector);
    }

    applyDraftNow();
    emitDraftChange({ source: 'capture' });
    setStatus('Captured edit for ' + selectedSelector + '.', false);
    updateButtonState();
  }

  function clearDraftOps(meta) {
    draft = emptyDraft();
    setSelection(null, '');
    clearSelectionHighlight();
    if (ui && ui.classInput) ui.classInput.value = '';
    if (ui && ui.styleInput) ui.styleInput.value = '';
    setEditorOpen(false);
    emitDraftChange(meta || { source: 'clear' });
    setStatus('Captured edits cleared.', false);
    updateButtonState();
  }

  function wireObserver() {
    if (observer || !window.MutationObserver || !document.body) return;
    observer = new MutationObserver(function () {
      scheduleApply();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function wireDocumentClick() {
    if (documentClickWired) return;
    documentClickWired = true;
    document.addEventListener('click', onCaptureClick, true);
  }

  function setDraftFromRaw(raw, opts) {
    draft = normalizeDraft(raw);
    updateDraftTextarea();
    updateButtonState();
    if (!opts || opts.applyNow !== false) scheduleApply();
    if (opts && opts.skipNotify) return;
    emitDraftChange({
      source: (opts && opts.source) ? String(opts.source) : 'external',
      skipSave: !!(opts && opts.skipSave),
    });
  }

  function getDraftRaw() {
    return stringifyDraft(draft);
  }

  function readDraft() {
    return cloneDraft(draft);
  }

  function startCapture() {
    if (!enabled) {
      setStatus('Enable edit mode first.', true);
      return;
    }
    setCapturing(true);
    setStatus('Capture started. Click a Settings/Admin element to select it.', false);
  }

  function stopCapture() {
    setCapturing(false);
    setStatus('Capture stopped.', false);
  }

  function init(opts) {
    if (!isSettingsPage()) return;
    var nextOpts = opts && typeof opts === 'object' ? opts : {};
    ui = {
      root: nextOpts.root || null,
      enableInput: nextOpts.enableInput || null,
      startBtn: nextOpts.startBtn || null,
      stopBtn: nextOpts.stopBtn || null,
      clearBtn: nextOpts.clearBtn || null,
      applyBtn: nextOpts.applyBtn || null,
      selectorInput: nextOpts.selectorInput || null,
      classInput: nextOpts.classInput || null,
      styleInput: nextOpts.styleInput || null,
      editorWrap: nextOpts.editorWrap || null,
      draftTextarea: nextOpts.draftTextarea || null,
      statusEl: nextOpts.statusEl || null,
    };
    onDraftChange = typeof nextOpts.onDraftChange === 'function' ? nextOpts.onDraftChange : null;

    var initialDraft = Object.prototype.hasOwnProperty.call(nextOpts, 'initialDraft')
      ? nextOpts.initialDraft
      : (ui.draftTextarea ? ui.draftTextarea.value : '');
    draft = normalizeDraft(initialDraft);

    enabled = !!(ui.enableInput && ui.enableInput.checked);
    setCapturing(false);
    setEditorOpen(false);

    if (ui.enableInput && ui.enableInput.getAttribute('data-kexo-inline-wired') !== '1') {
      ui.enableInput.setAttribute('data-kexo-inline-wired', '1');
      ui.enableInput.addEventListener('change', function () {
        enabled = !!ui.enableInput.checked;
        if (!enabled) setCapturing(false);
        updateButtonState();
        setStatus(enabled ? 'Edit mode enabled.' : 'Edit mode disabled.', false);
      });
    }
    if (ui.startBtn && ui.startBtn.getAttribute('data-kexo-inline-wired') !== '1') {
      ui.startBtn.setAttribute('data-kexo-inline-wired', '1');
      ui.startBtn.addEventListener('click', function (e) {
        e.preventDefault();
        startCapture();
      });
    }
    if (ui.stopBtn && ui.stopBtn.getAttribute('data-kexo-inline-wired') !== '1') {
      ui.stopBtn.setAttribute('data-kexo-inline-wired', '1');
      ui.stopBtn.addEventListener('click', function (e) {
        e.preventDefault();
        stopCapture();
      });
    }
    if (ui.clearBtn && ui.clearBtn.getAttribute('data-kexo-inline-wired') !== '1') {
      ui.clearBtn.setAttribute('data-kexo-inline-wired', '1');
      ui.clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        clearDraftOps({ source: 'clear' });
      });
    }
    if (ui.applyBtn && ui.applyBtn.getAttribute('data-kexo-inline-wired') !== '1') {
      ui.applyBtn.setAttribute('data-kexo-inline-wired', '1');
      ui.applyBtn.addEventListener('click', function (e) {
        e.preventDefault();
        applyCapturedEdit();
      });
    }

    wireDocumentClick();
    wireObserver();
    updateDraftTextarea();
    updateButtonState();
    scheduleApply();
  }

  var api = {
    init: init,
    startCapture: startCapture,
    stopCapture: stopCapture,
    clearDraft: clearDraftOps,
    setDraftFromRaw: setDraftFromRaw,
    getDraftRaw: getDraftRaw,
    readDraft: readDraft,
    applyDraftNow: applyDraftNow,
    __test: {
      normalizeDraft: normalizeDraft,
      stringifyDraft: stringifyDraft,
      parseStyleDeclText: parseStyleDeclText,
    },
  };

  window.KexoSettingsInlineEdits = api;
})();
