(function () {
  'use strict';

  // Settings UI builder helpers (Tabler-first). Exposed on window for plain script usage.
  // These helpers intentionally avoid custom layout patterns; they only compose Tabler classes.

  var PANEL_WRAP_CLASS = 'settings-panel-wrap';

  function isEl(n) {
    return !!(n && n.nodeType === 1 && n.classList);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    var a = attrs && typeof attrs === 'object' ? attrs : {};
    Object.keys(a).forEach(function (k) {
      var v = a[k];
      if (v == null) return;
      if (k === 'class') node.className = String(v);
      else if (k === 'text') node.textContent = String(v);
      else if (k === 'html') node.innerHTML = String(v);
      else node.setAttribute(k, String(v));
    });
    (Array.isArray(children) ? children : (children ? [children] : [])).forEach(function (c) {
      if (c == null) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else if (c && c.nodeType) node.appendChild(c);
    });
    return node;
  }

  function panelWrap(panelEl) {
    if (!isEl(panelEl)) return null;
    var wrap = null;
    try { wrap = panelEl.querySelector(':scope > .' + PANEL_WRAP_CLASS); } catch (_) { wrap = null; }
    if (!wrap) {
      wrap = el('div', { class: PANEL_WRAP_CLASS });
      panelEl.insertBefore(wrap, panelEl.firstChild);
    }
    // Move direct children (except wrap) into wrap.
    var nodes = [];
    try {
      Array.prototype.slice.call(panelEl.childNodes || []).forEach(function (n) {
        if (!n) return;
        if (n === wrap) return;
        if (n.nodeType === 3 && !String(n.nodeValue || '').trim()) return;
        nodes.push(n);
      });
    } catch (_) {}
    nodes.forEach(function (n) { try { wrap.appendChild(n); } catch (_) {} });
    return wrap;
  }

  function actionsRow(children) {
    return el('div', { class: 'd-flex align-items-center gap-2 flex-wrap' }, children || []);
  }

  function loadingState(text) {
    return el('div', { class: 'd-flex align-items-center gap-2 text-secondary' }, [
      el('div', { class: 'spinner-border spinner-border-sm text-primary', role: 'status', 'aria-hidden': 'true' }),
      el('div', { text: text || 'Loading…' }),
    ]);
  }

  function errorState(message, opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var wrap = el('div', { class: 'alert alert-danger mb-0' }, [
      el('div', { class: 'fw-semibold mb-1', text: o.title || 'Failed to load' }),
      el('div', { class: 'text-secondary small mb-2', text: message || 'Something went wrong.' }),
    ]);
    if (typeof o.onRetry === 'function') {
      var btn = el('button', { type: 'button', class: 'btn btn-sm btn-danger', text: o.retryLabel || 'Retry' });
      btn.addEventListener('click', function () { try { o.onRetry(); } catch (_) {} });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function formRow(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var labelText = o.label != null ? String(o.label) : '';
    var hintText = o.hint != null ? String(o.hint) : '';
    var id = o.id != null ? String(o.id) : '';
    var inputEl = o.inputEl && o.inputEl.nodeType ? o.inputEl : null;
    var row = el('div', { class: 'mb-3' });
    if (labelText) {
      row.appendChild(el('label', { class: 'form-label', for: id || undefined, text: labelText }));
    }
    if (inputEl) row.appendChild(inputEl);
    if (hintText) row.appendChild(el('div', { class: 'form-hint', text: hintText }));
    return row;
  }

  function card(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var cls = 'card card-sm' + (o.className ? (' ' + String(o.className)) : '');
    var c = el('div', { class: cls });
    // Intentionally avoid authoring card headers in Settings. Tabs/accordion headers act as section headers.
    var body = el('div', { class: 'card-body' }, o.body || []);
    c.appendChild(body);
    return c;
  }

  window.KexoSettingsUi = {
    el: el,
    panelWrap: panelWrap,
    card: card,
    formRow: formRow,
    actionsRow: actionsRow,
    loadingState: loadingState,
    errorState: errorState,
  };
})();

