/**
 * Settings → Attribution → Mapped tree
 *
 * Shows Channel → Source → Variant → Rule hierarchy with icon editing.
 * - GET  /api/attribution/config
 * - POST /api/attribution/icons (patch icon_spec for sources/variants)
 *
 * Fail-open: never hard-fail; no page overlay loader.
 */
(function () {
  'use strict';

  try {
    if (!document || !document.body) return;
    if (String(document.body.getAttribute('data-page') || '').trim().toLowerCase() !== 'settings') return;
  } catch (_) {
    return;
  }

  var API = '';
  try { if (typeof window !== 'undefined' && window.API) API = String(window.API || ''); } catch (_) {}

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function trimLower(v, maxLen) {
    var s = v == null ? '' : String(v);
    s = s.trim().toLowerCase();
    if (!s) return '';
    var lim = typeof maxLen === 'number' ? maxLen : 256;
    return s.length > lim ? s.slice(0, lim) : s;
  }

  function normalizeVariantKey(v) {
    var s = v == null ? '' : String(v);
    s = s.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) return '';
    return s.length > 120 ? s.slice(0, 120) : s;
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = typeof timeoutMs === 'number' && isFinite(timeoutMs) ? timeoutMs : 20000;
    if (typeof AbortController === 'undefined') return fetch(url, options);
    var ctrl = new AbortController();
    var id = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, ms);
    var opts = Object.assign({}, options || {}, { signal: ctrl.signal });
    return fetch(url, opts).finally(function () { try { clearTimeout(id); } catch (_) {} });
  }

  function apiGetJson(url) {
    return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function apiPostJson(url, payload) {
    return fetchWithTimeout(url, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }, 25000)
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (r && r.ok) return body;
          return { ok: false, status: r && r.status, error: (body && body.error) || (r && r.status === 403 ? 'Admin only' : 'Request failed') };
        });
      })
      .catch(function () { return { ok: false, status: 0, error: 'Request failed' }; });
  }

  function apiPatchJson(url, payload) {
    return fetchWithTimeout(url, {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    }, 25000)
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          if (r && r.ok) return body;
          return { ok: false, status: r && r.status, error: (body && body.error) || (r && r.status === 403 ? 'Admin only' : 'Request failed') };
        });
      })
      .catch(function () { return { ok: false, status: 0, error: 'Request failed' }; });
  }

  function fetchConfig() {
    return apiGetJson(API + '/api/attribution/config');
  }

  function saveIcons(payload) {
    return apiPostJson(API + '/api/attribution/icons', payload);
  }

  function moveRule(ruleId, destVariantKey) {
    var id = trimLower(ruleId, 80);
    var variantKey = normalizeVariantKey(destVariantKey);
    if (!id || !variantKey) return Promise.resolve({ ok: false, status: 0, error: 'Missing rule id or destination' });
    return apiPatchJson(API + '/api/attribution/rules/' + encodeURIComponent(id), { variant_key: variantKey });
  }

  function titleFromKey(key) {
    var s = String(key || '').trim();
    if (!s) return 'Unknown';
    return s.replace(/[:_ -]+/g, ' ').trim().split(/\s+/g).filter(Boolean)
      .map(function (w) { return w.slice(0, 1).toUpperCase() + w.slice(1); }).join(' ');
  }

  function sanitizeSvgMarkup(markup) {
    var s = markup == null ? '' : String(markup);
    s = s.trim();
    if (!/^<svg[\s>]/i.test(s)) return '';
    // drop scripts + foreignObject
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    // drop inline event handlers
    s = s.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    // drop javascript: hrefs
    s = s.replace(/\s(href|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '');
    return s;
  }

  function iconSpecToPreviewHtml(spec, label) {
    var s = spec != null ? String(spec).trim() : '';
    var l = label != null ? String(label).trim() : '';
    if (!s) return '<span class="text-muted small">—</span>';
    if (/^<svg[\s>]/i.test(s)) {
      var safeSvg = sanitizeSvgMarkup(s);
      if (!safeSvg) return '<span class="text-muted small">—</span>';
      return '<span class="am-tree-icon-preview" title="' + escapeHtml(l) + '">' + safeSvg + '</span>';
    }
    if (/^(https?:\/\/|\/\/|\/)/i.test(s)) return '<span class="am-tree-icon-preview"><img src="' + escapeHtml(s) + '" alt="" width="20" height="20" style="vertical-align:middle"></span>';
    return '<span class="am-tree-icon-preview" title="' + escapeHtml(l) + '"><i class="' + escapeHtml(s) + '" aria-hidden="true"></i></span>';
  }

  function buildTreeModel(config) {
    var channels = Array.isArray(config.channels) ? config.channels : [];
    var sources = Array.isArray(config.sources) ? config.sources : [];
    var variants = Array.isArray(config.variants) ? config.variants : [];
    var rules = Array.isArray(config.rules) ? config.rules : [];

    var sourcesByKey = {};
    sources.forEach(function (r) {
      var k = trimLower(r && r.source_key != null ? r.source_key : (r && r.key != null ? r.key : ''), 32);
      if (k) sourcesByKey[k] = r;
    });

    var rulesByVariant = {};
    rules.forEach(function (r) {
      var vk = normalizeVariantKey(r && (r.variant_key != null ? r.variant_key : ''));
      if (!vk) return;
      if (!rulesByVariant[vk]) rulesByVariant[vk] = [];
      rulesByVariant[vk].push(r);
    });

    var channelList = [];
    var seenChannel = {};
    var variantsByChannelSource = {};

    variants.forEach(function (v) {
      var ch = trimLower(v && v.channel_key != null ? v.channel_key : '', 32) || 'other';
      var src = trimLower(v && v.source_key != null ? v.source_key : '', 32) || 'other';
      if (!seenChannel[ch]) {
        seenChannel[ch] = true;
        channelList.push(ch);
      }
      var key = ch + '|' + src;
      if (!variantsByChannelSource[key]) variantsByChannelSource[key] = [];
      variantsByChannelSource[key].push(v);
    });

    channelList.sort();
    var channelRows = [];
    channelList.forEach(function (channelKey) {
      var channelLabel = (channels.find(function (c) { return trimLower(c && c.channel_key, 32) === channelKey; }) || {}).label;
      if (!channelLabel) channelLabel = titleFromKey(channelKey);
      var sourceKeys = [];
      var srcSeen = {};
      Object.keys(variantsByChannelSource).forEach(function (k) {
        var parts = k.split('|');
        if (parts[0] === channelKey && parts[1] && !srcSeen[parts[1]]) {
          srcSeen[parts[1]] = true;
          sourceKeys.push(parts[1]);
        }
      });
      sourceKeys.sort();
      var sourceRows = [];
      sourceKeys.forEach(function (sourceKey) {
        var sourceRow = sourcesByKey[sourceKey] || {};
        var sourceLabel = sourceRow.label || titleFromKey(sourceKey);
        var sourceIcon = sourceRow.icon_spec != null ? String(sourceRow.icon_spec) : '';
        var variantList = variantsByChannelSource[channelKey + '|' + sourceKey] || [];
        variantList.sort(function (a, b) {
          var la = (a && a.label) ? String(a.label) : (a && a.variant_key) ? String(a.variant_key) : '';
          var lb = (b && b.label) ? String(b.label) : (b && b.variant_key) ? String(b.variant_key) : '';
          return la.localeCompare(lb);
        });
        var variantRows = [];
        variantList.forEach(function (variant) {
          var vk = normalizeVariantKey(variant && (variant.variant_key != null ? variant.variant_key : ''));
          var vLabel = (variant && variant.label) ? String(variant.label) : titleFromKey(vk);
          var vIcon = (variant && variant.icon_spec != null) ? String(variant.icon_spec) : '';
          var ruleList = rulesByVariant[vk] || [];
          variantRows.push({
            type: 'variant',
            variant_key: vk,
            label: vLabel,
            icon_spec: vIcon,
            rules: ruleList,
          });
        });
        sourceRows.push({
          type: 'source',
          source_key: sourceKey,
          label: sourceLabel,
          icon_spec: sourceIcon,
          variants: variantRows,
        });
      });
      channelRows.push({
        type: 'channel',
        channel_key: channelKey,
        label: channelLabel,
        sources: sourceRows,
      });
    });
    return channelRows;
  }

  var _state = {
    rootId: '',
    rootEl: null,
    config: null,
    treeModel: null,
    expanded: {}, // 'channel:key' -> true, 'source:ch|src' -> true
  };

  function toggleExpanded(k) {
    _state.expanded[k] = !_state.expanded[k];
  }

  function isExpanded(k) {
    if (Object.prototype.hasOwnProperty.call(_state.expanded, k)) return !!_state.expanded[k];
    return String(k || '').indexOf('c:') === 0;
  }

  function setAllExpanded(open) {
    var expand = !!open;
    var next = {};
    var model = Array.isArray(_state.treeModel) ? _state.treeModel : [];
    model.forEach(function (channel) {
      var channelKey = 'c:' + String(channel && channel.channel_key != null ? channel.channel_key : '');
      next[channelKey] = expand;
      (channel && Array.isArray(channel.sources) ? channel.sources : []).forEach(function (source) {
        var sourceKey = 's:' + String(channel && channel.channel_key != null ? channel.channel_key : '') + '|' + String(source && source.source_key != null ? source.source_key : '');
        next[sourceKey] = expand;
        (source && Array.isArray(source.variants) ? source.variants : []).forEach(function (variant) {
          var variantKey = 'v:' + String(variant && variant.variant_key != null ? variant.variant_key : '');
          next[variantKey] = expand;
        });
      });
    });
    _state.expanded = next;
  }

  function renderRuleRow(rule, variantKey) {
    var id = (rule && rule.id) ? String(rule.id) : '';
    var label = (rule && rule.label) ? String(rule.label) : '';
    var match = (rule && rule.match_json) ? rule.match_json : (rule && rule.match ? JSON.stringify(rule.match) : '{}');
    var matchStr = typeof match === 'string' ? match : JSON.stringify(match);
    var summary = matchStr.length > 60 ? matchStr.slice(0, 57) + '…' : matchStr;
    var vk = normalizeVariantKey(variantKey);
    return '<div class="am-tree-row am-tree-rule">' +
      '<span class="am-tree-pad am-tree-pad-3"></span>' +
      '<span class="am-tree-cell"><code class="small">' + escapeHtml(id || '—') + '</code></span>' +
      '<span class="am-tree-cell text-secondary small">' + escapeHtml(label || '—') + '</span>' +
      '<span class="am-tree-cell text-muted small" title="' + escapeHtml(matchStr) + '">' + escapeHtml(summary) + '</span>' +
      '<span class="am-tree-cell text-end"><button type="button" class="btn btn-outline-secondary btn-sm" data-am-tree-action="move-rule" data-rule-id="' + escapeHtml(id) + '" data-current-variant-key="' + escapeHtml(vk) + '">Edit</button></span>' +
      '</div>';
  }

  function renderVariantRow(variant, channelKey, sourceKey) {
    var vk = variant.variant_key || '';
    var label = variant.label || titleFromKey(vk);
    var iconSpec = variant.icon_spec != null ? String(variant.icon_spec) : '';
    var ruleCount = Array.isArray(variant.rules) ? variant.rules.length : 0;
    var expandedKey = 'v:' + vk;
    var isOpen = isExpanded(expandedKey);
    var ruleRows = (variant.rules || []).map(function (r) { return renderRuleRow(r, vk); }).join('');
    return '<div class="am-tree-node am-tree-variant" data-variant-key="' + escapeHtml(vk) + '">' +
      '<div class="am-tree-row am-tree-variant-head">' +
      '<span class="am-tree-pad am-tree-pad-2"></span>' +
      '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>' +
      '<span class="am-tree-cell am-tree-label">' + iconSpecToPreviewHtml(iconSpec, label) + ' <strong>' + escapeHtml(label) + '</strong> <code class="small">' + escapeHtml(vk) + '</code></span>' +
      '<span class="am-tree-cell text-muted small">' + String(ruleCount) + ' rule(s)</span>' +
      '<span class="am-tree-cell d-flex align-items-center gap-2 justify-content-end">' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" data-am-tree-action="edit-variant" data-variant-key="' + escapeHtml(vk) + '" data-current-channel-key="' + escapeHtml(channelKey || '') + '" data-current-source-key="' + escapeHtml(sourceKey || '') + '" data-label="' + escapeHtml(label) + '">Edit</button>' +
        '<button type="button" class="btn btn-outline-secondary btn-sm am-tree-edit-icon-btn" data-am-tree-edit-toggle="variant" data-key="' + escapeHtml(vk) + '" title="Edit icon">Edit icon</button>' +
      '</span>' +
      '</div>' +
      '<div class="am-tree-variant-icon-edit mt-1 mb-2" data-am-tree-edit="variant" data-variant-key="' + escapeHtml(vk) + '" data-am-tree-label="' + escapeHtml(label) + '" style="display:none">' +
      '<div class="row g-2 align-items-start">' +
      '<div class="col-12 col-md-7">' +
      '<textarea class="form-control form-control-sm am-tree-icon-input font-monospace" rows="3" spellcheck="false" placeholder="fa-solid fa-bolt  OR  /assets/icon.png  OR  <svg ...>">' + escapeHtml(iconSpec) + '</textarea>' +
      '<div class="form-hint small">Font Awesome class, image URL/path, or inline SVG. Saved icons sync with Settings → Kexo → Icons.</div>' +
      '</div>' +
      '<div class="col-12 col-md-5">' +
      '<div class="am-tree-icon-live-preview" data-am-tree-live-preview="1">' + iconSpecToPreviewHtml(iconSpec, label) + '</div>' +
      '</div>' +
      '<div class="col-12 d-flex align-items-center gap-2">' +
      '<button type="button" class="btn btn-outline-primary btn-sm am-tree-icon-save" data-kind="variant" data-key="' + escapeHtml(vk) + '">Save</button>' +
      '<button type="button" class="btn btn-outline-secondary btn-sm am-tree-icon-reset" data-kind="variant" data-key="' + escapeHtml(vk) + '">Reset</button>' +
      '<span class="am-tree-save-msg small text-secondary ms-auto" data-am-tree-save-msg="1"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="am-tree-children' + (isOpen ? '' : ' is-hidden') + '" data-am-tree-children="' + escapeHtml(expandedKey) + '">' +
      ruleRows +
      '</div>' +
      '</div>';
  }

  function renderSourceRow(source, channelKey) {
    var sk = source.source_key || '';
    var label = source.label || titleFromKey(sk);
    var iconSpec = source.icon_spec != null ? String(source.icon_spec) : '';
    var expandedKey = 's:' + channelKey + '|' + sk;
    var isOpen = isExpanded(expandedKey);
    var variantHtml = (source.variants || []).map(function (v) { return renderVariantRow(v, channelKey, sk); }).join('');
    return '<div class="am-tree-node am-tree-source" data-source-key="' + escapeHtml(sk) + '">' +
      '<div class="am-tree-row am-tree-source-head">' +
      '<span class="am-tree-pad am-tree-pad-1"></span>' +
      '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>' +
      '<span class="am-tree-cell am-tree-label">' + iconSpecToPreviewHtml(iconSpec, label) + ' <strong>' + escapeHtml(label) + '</strong> <code class="small">' + escapeHtml(sk) + '</code></span>' +
      '<span class="am-tree-cell d-flex align-items-center gap-2 justify-content-end">' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" data-am-tree-action="edit-source" data-source-key="' + escapeHtml(sk) + '" data-current-channel-key="' + escapeHtml(channelKey || '') + '" data-label="' + escapeHtml(label) + '">Edit</button>' +
        '<button type="button" class="btn btn-outline-secondary btn-sm am-tree-edit-icon-btn" data-am-tree-edit-toggle="source" data-key="' + escapeHtml(sk) + '" title="Edit icon">Edit icon</button>' +
      '</span>' +
      '</div>' +
      '<div class="am-tree-source-icon-edit mt-1 mb-2" data-am-tree-edit="source" data-source-key="' + escapeHtml(sk) + '" data-am-tree-label="' + escapeHtml(label) + '" style="display:none">' +
      '<div class="row g-2 align-items-start">' +
      '<div class="col-12 col-md-7">' +
      '<textarea class="form-control form-control-sm am-tree-icon-input font-monospace" rows="3" spellcheck="false" placeholder="fa-brands fa-google  OR  /assets/icon.png  OR  <svg ...>">' + escapeHtml(iconSpec) + '</textarea>' +
      '<div class="form-hint small">Font Awesome class, image URL/path, or inline SVG. Saved icons sync with Settings → Kexo → Icons.</div>' +
      '</div>' +
      '<div class="col-12 col-md-5">' +
      '<div class="am-tree-icon-live-preview" data-am-tree-live-preview="1">' + iconSpecToPreviewHtml(iconSpec, label) + '</div>' +
      '</div>' +
      '<div class="col-12 d-flex align-items-center gap-2">' +
      '<button type="button" class="btn btn-outline-primary btn-sm am-tree-icon-save" data-kind="source" data-key="' + escapeHtml(sk) + '">Save</button>' +
      '<button type="button" class="btn btn-outline-secondary btn-sm am-tree-icon-reset" data-kind="source" data-key="' + escapeHtml(sk) + '">Reset</button>' +
      '<span class="am-tree-save-msg small text-secondary ms-auto" data-am-tree-save-msg="1"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="am-tree-children' + (isOpen ? '' : ' is-hidden') + '" data-am-tree-children="' + escapeHtml(expandedKey) + '">' +
      variantHtml +
      '</div>' +
      '</div>';
  }

  function renderChannelRow(channel) {
    var ck = channel.channel_key || '';
    var label = channel.label || titleFromKey(ck);
    var expandedKey = 'c:' + ck;
    var isOpen = isExpanded(expandedKey);
    var sourceHtml = (channel.sources || []).map(function (s) { return renderSourceRow(s, ck); }).join('');
    return '<div class="am-tree-node am-tree-channel" data-channel-key="' + escapeHtml(ck) + '">' +
      '<div class="am-tree-row am-tree-channel-head">' +
      '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>' +
      '<span class="am-tree-cell am-tree-label"><strong>' + escapeHtml(label) + '</strong> <code class="small">' + escapeHtml(ck) + '</code></span>' +
      '</div>' +
      '<div class="am-tree-children' + (isOpen ? '' : ' is-hidden') + '" data-am-tree-children="' + escapeHtml(expandedKey) + '">' +
      sourceHtml +
      '</div>' +
      '</div>';
  }

  function renderTree(root, model) {
    if (!model || !model.length) {
      root.innerHTML = '<p class="text-secondary mb-0">No channels or variants yet. Use the Mapping tab to create mappings.</p>';
      return;
    }
    var html = '<div class="am-tree mb-0">' +
      '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">' +
      '<p class="text-secondary small mb-0">Use <strong>Edit icon</strong> on a Source or Variant row. SVG paste works best in the textarea. Changes sync with Settings → Kexo → Icons.</p>' +
      '<div class="btn-group btn-group-sm" role="group" aria-label="Tree display controls">' +
      '<button type="button" class="btn btn-outline-secondary" data-am-tree-action="expand-all">Expand all</button>' +
      '<button type="button" class="btn btn-outline-secondary" data-am-tree-action="collapse-all">Collapse all</button>' +
      '</div>' +
      '</div>' +
      model.map(function (ch) { return renderChannelRow(ch); }).join('') +
      '</div>';
    root.innerHTML = html;
  }

  var _moveModalBackdropEl = null;

  function ensureMoveModal() {
    var existing = document.getElementById('am-rule-move-modal');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.innerHTML = '' +
      '<div class="modal fade" id="am-rule-move-modal" tabindex="-1" aria-hidden="true" aria-label="Edit attribution rule">' +
        '<div class="modal-dialog modal-dialog-centered">' +
          '<div class="modal-content">' +
            '<div class="modal-header">' +
              '<h5 class="modal-title">Edit rule</h5>' +
              '<button type="button" class="btn-close" data-am-move-close aria-label="Close"></button>' +
            '</div>' +
            '<div class="modal-body">' +
              '<div class="text-secondary small mb-2">This affects new sessions; historical data requires reprocess/backfill.</div>' +
              '<div class="mb-2"><div class="small text-secondary">Rule</div><div><code id="am-move-rule-id">—</code></div></div>' +
              '<div class="mb-3">' +
                '<label class="form-label" for="am-move-dest-variant">Destination</label>' +
                '<select class="form-select" id="am-move-dest-variant"></select>' +
              '</div>' +
              '<div class="form-hint" id="am-move-msg"></div>' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn btn-outline-secondary" data-am-move-close>Cancel</button>' +
              '<button type="button" class="btn btn-primary" id="am-move-confirm">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var modalEl = wrap.firstChild;
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function getBootstrapModal(modalEl) {
    try {
      if (typeof bootstrap === 'undefined' || !bootstrap.Modal) return null;
      return bootstrap.Modal.getOrCreateInstance(modalEl);
    } catch (_) {
      return null;
    }
  }

  function closeMoveModal(modalEl) {
    var modal = getBootstrapModal(modalEl);
    if (modal) {
      modal.hide();
      try {
        if (_moveModalBackdropEl && _moveModalBackdropEl.parentNode) _moveModalBackdropEl.parentNode.removeChild(_moveModalBackdropEl);
        _moveModalBackdropEl = null;
      } catch (_) {}
      return;
    }
    modalEl.classList.remove('show');
    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');
    try {
      document.body.classList.remove('modal-open');
      if (_moveModalBackdropEl && _moveModalBackdropEl.parentNode) _moveModalBackdropEl.parentNode.removeChild(_moveModalBackdropEl);
      _moveModalBackdropEl = null;
    } catch (_) {}
  }

  function openMoveModal(ruleId, currentVariantKey) {
    var rid = trimLower(ruleId, 80);
    var curVk = normalizeVariantKey(currentVariantKey);
    if (!rid) return;
    var modalEl = ensureMoveModal();
    if (!modalEl) return;

    modalEl.setAttribute('data-am-move-rule-id', rid);
    modalEl.setAttribute('data-am-move-current-variant-key', curVk || '');

    var idEl = modalEl.querySelector('#am-move-rule-id');
    if (idEl) idEl.textContent = rid;
    var msgEl = modalEl.querySelector('#am-move-msg');
    if (msgEl) { msgEl.textContent = ''; msgEl.className = 'form-hint'; }

    var selectEl = modalEl.querySelector('#am-move-dest-variant');
    if (selectEl) {
      var cfg = _state && _state.config && _state.config.config ? _state.config.config : null;
      var channels = cfg && Array.isArray(cfg.channels) ? cfg.channels : [];
      var sources = cfg && Array.isArray(cfg.sources) ? cfg.sources : [];
      var variants = cfg && Array.isArray(cfg.variants) ? cfg.variants : [];

      var channelLabelByKey = {};
      channels.forEach(function (c) {
        var k = trimLower(c && c.channel_key, 32);
        if (k) channelLabelByKey[k] = (c && c.label) ? String(c.label) : titleFromKey(k);
      });
      var sourceLabelByKey = {};
      sources.forEach(function (s) {
        var k = trimLower(s && s.source_key, 32);
        if (k) sourceLabelByKey[k] = (s && s.label) ? String(s.label) : titleFromKey(k);
      });

      var items = variants
        .map(function (v) {
          var vk = normalizeVariantKey(v && (v.variant_key != null ? v.variant_key : v.key));
          if (!vk) return null;
          var ch = trimLower(v && v.channel_key, 32) || 'other';
          var src = trimLower(v && v.source_key, 32) || 'other';
          var vLabel = (v && v.label) ? String(v.label) : titleFromKey(vk);
          var chLabel = channelLabelByKey[ch] || titleFromKey(ch);
          var srcLabel = sourceLabelByKey[src] || titleFromKey(src);
          return { key: vk, label: chLabel + ' \u2192 ' + srcLabel + ' \u2192 ' + vLabel + ' (' + vk + ')' };
        })
        .filter(Boolean)
        .sort(function (a, b) { return String(a.label).localeCompare(String(b.label)); });

      selectEl.innerHTML = items.map(function (it) {
        return '<option value="' + escapeHtml(it.key) + '">' + escapeHtml(it.label) + '</option>';
      }).join('');
      try { selectEl.value = curVk || (items[0] ? items[0].key : ''); } catch (_) {}
    }

    if (modalEl.getAttribute('data-am-move-wired') !== '1') {
      modalEl.setAttribute('data-am-move-wired', '1');
      modalEl.addEventListener('click', function (e) {
        var t = e && e.target ? e.target : null;
        var closeBtn = t && t.closest ? t.closest('[data-am-move-close]') : null;
        if (closeBtn) {
          e.preventDefault();
          closeMoveModal(modalEl);
        }
      });

      var confirmBtn = modalEl.querySelector('#am-move-confirm');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          var rid = trimLower(modalEl.getAttribute('data-am-move-rule-id') || '', 80);
          var curVk = normalizeVariantKey(modalEl.getAttribute('data-am-move-current-variant-key') || '');
          var sel = modalEl.querySelector('#am-move-dest-variant');
          var dest = normalizeVariantKey(sel ? sel.value : '');
          var msgEl = modalEl.querySelector('#am-move-msg');
          function setMsg(text, cls) {
            if (!msgEl) return;
            msgEl.textContent = text || '';
            msgEl.className = 'form-hint ' + (cls || '');
          }
          if (!rid || !dest) {
            setMsg('Choose a destination.', 'text-danger');
            return;
          }
          if (dest === curVk) {
            closeMoveModal(modalEl);
            return;
          }
          try { confirmBtn.disabled = true; } catch (_) {}
          setMsg('Saving\u2026', 'text-secondary');
          moveRule(rid, dest).then(function (resp) {
            if (resp && resp.ok) {
              setMsg('Saved.', 'text-success');
              setTimeout(function () {
                closeMoveModal(modalEl);
                _state.config = null;
                loadAndRender();
              }, 250);
            } else {
              setMsg((resp && resp.error) ? String(resp.error) : 'Save failed', 'text-danger');
            }
          }).finally(function () {
            try { confirmBtn.disabled = false; } catch (_) {}
          });
        });
      }
    }

    var modal = getBootstrapModal(modalEl);
    if (modal) {
      modal.show();
      return;
    }
    modalEl.style.display = 'block';
    modalEl.classList.add('show');
    modalEl.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
    if (!_moveModalBackdropEl || !_moveModalBackdropEl.parentNode) {
      _moveModalBackdropEl = document.createElement('div');
      _moveModalBackdropEl.className = 'modal-backdrop fade show';
      _moveModalBackdropEl.setAttribute('aria-hidden', 'true');
      _moveModalBackdropEl.addEventListener('click', function () { closeMoveModal(modalEl); });
      document.body.appendChild(_moveModalBackdropEl);
    }
  }

  var _assignModalBackdropEl = null;

  function ensureChannelAssignModal() {
    var existing = document.getElementById('am-channel-assign-modal');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.innerHTML = '' +
      '<div class="modal fade" id="am-channel-assign-modal" tabindex="-1" aria-hidden="true" aria-label="Edit attribution channel">' +
        '<div class="modal-dialog modal-dialog-centered">' +
          '<div class="modal-content">' +
            '<div class="modal-header">' +
              '<h5 class="modal-title">Edit channel</h5>' +
              '<button type="button" class="btn-close" data-am-assign-close aria-label="Close"></button>' +
            '</div>' +
            '<div class="modal-body">' +
              '<div class="text-secondary small mb-2">Assign to an existing channel, or create a new one.</div>' +
              '<div class="mb-2">' +
                '<div class="small text-secondary" id="am-assign-kind">Item</div>' +
                '<div><code id="am-assign-key">—</code> <span class="text-secondary small" id="am-assign-label"></span></div>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label" for="am-assign-channel-select">Channel</label>' +
                '<select class="form-select" id="am-assign-channel-select"></select>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label" for="am-assign-new-channel">Or create new channel</label>' +
                '<input class="form-control" id="am-assign-new-channel" placeholder="e.g. Organic Social" />' +
                '<div class="form-hint">If provided, a new channel is created and the item is assigned to it.</div>' +
              '</div>' +
              '<div class="form-hint" id="am-assign-msg"></div>' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button type="button" class="btn btn-outline-secondary" data-am-assign-close>Cancel</button>' +
              '<button type="button" class="btn btn-primary" id="am-assign-confirm">Save</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    var modalEl = wrap.firstChild;
    document.body.appendChild(modalEl);
    return modalEl;
  }

  function closeChannelAssignModal(modalEl) {
    var modal = getBootstrapModal(modalEl);
    if (modal) {
      modal.hide();
      try {
        if (_assignModalBackdropEl && _assignModalBackdropEl.parentNode) _assignModalBackdropEl.parentNode.removeChild(_assignModalBackdropEl);
        _assignModalBackdropEl = null;
      } catch (_) {}
      return;
    }
    modalEl.classList.remove('show');
    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');
    try {
      document.body.classList.remove('modal-open');
      if (_assignModalBackdropEl && _assignModalBackdropEl.parentNode) _assignModalBackdropEl.parentNode.removeChild(_assignModalBackdropEl);
      _assignModalBackdropEl = null;
    } catch (_) {}
  }

  function normalizeChannelKeyFromLabel(label) {
    var raw = label == null ? '' : String(label);
    raw = raw.trim();
    if (!raw) return '';
    var k = raw.toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/_{2,}/g, '_');
    if (!k) return '';
    if (!/^[a-z0-9]/.test(k)) k = 'c_' + k;
    if (k.length > 32) k = k.slice(0, 32).replace(/_+$/g, '');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(k)) return '';
    return k;
  }

  function uniqueChannelKey(baseKey, channels) {
    var base = trimLower(baseKey, 32);
    if (!base) return '';
    var used = {};
    (channels || []).forEach(function (c) {
      var k = trimLower(c && c.channel_key, 32);
      if (k) used[k] = true;
    });
    if (!used[base]) return base;
    for (var i = 2; i < 1000; i++) {
      var suffix = '_' + String(i);
      var k2 = base;
      if (k2.length + suffix.length > 32) k2 = k2.slice(0, 32 - suffix.length);
      k2 = k2 + suffix;
      if (!used[k2]) return k2;
    }
    return '';
  }

  function saveAttributionConfig(cfg) {
    return apiPostJson(API + '/api/attribution/config', { config: cfg });
  }

  function openChannelAssignModal(opts) {
    var kind = opts && opts.kind ? String(opts.kind).trim().toLowerCase() : '';
    var key = opts && opts.key != null ? String(opts.key).trim() : '';
    var label = opts && opts.label != null ? String(opts.label).trim() : '';
    var currentChannelKey = opts && opts.currentChannelKey != null ? String(opts.currentChannelKey).trim().toLowerCase() : '';
    if (!kind || !key) return;
    if (kind !== 'source' && kind !== 'variant') return;

    var modalEl = ensureChannelAssignModal();
    if (!modalEl) return;

    modalEl.setAttribute('data-am-assign-kind', kind);
    modalEl.setAttribute('data-am-assign-key', key);
    modalEl.setAttribute('data-am-assign-current-channel', currentChannelKey || '');

    var kindEl = modalEl.querySelector('#am-assign-kind');
    var keyEl = modalEl.querySelector('#am-assign-key');
    var labelEl = modalEl.querySelector('#am-assign-label');
    if (kindEl) kindEl.textContent = kind === 'source' ? 'Source' : 'Variant';
    if (keyEl) keyEl.textContent = key;
    if (labelEl) labelEl.textContent = label ? ('— ' + label) : '';

    var msgEl = modalEl.querySelector('#am-assign-msg');
    function setMsg(text, cls) {
      if (!msgEl) return;
      msgEl.textContent = text || '';
      msgEl.className = 'form-hint ' + (cls || '');
    }
    setMsg('', '');

    var cfg = _state && _state.config && _state.config.config ? _state.config.config : null;
    var channels = cfg && Array.isArray(cfg.channels) ? cfg.channels.slice() : [];
    channels.sort(function (a, b) {
      var ao = a && typeof a.sort_order === 'number' ? a.sort_order : 0;
      var bo = b && typeof b.sort_order === 'number' ? b.sort_order : 0;
      if (ao !== bo) return ao - bo;
      return String((a && a.label) || '').localeCompare(String((b && b.label) || ''));
    });

    var selectEl = modalEl.querySelector('#am-assign-channel-select');
    if (selectEl) {
      selectEl.innerHTML = channels.map(function (c) {
        var ck = trimLower(c && c.channel_key, 32) || 'other';
        var cl = (c && c.label) ? String(c.label) : titleFromKey(ck);
        return '<option value="' + escapeHtml(ck) + '">' + escapeHtml(cl + ' (' + ck + ')') + '</option>';
      }).join('');
      try { selectEl.value = currentChannelKey || (channels[0] ? trimLower(channels[0].channel_key, 32) : 'other'); } catch (_) {}
    }

    var newChannelEl = modalEl.querySelector('#am-assign-new-channel');
    if (newChannelEl) newChannelEl.value = '';

    if (modalEl.getAttribute('data-am-assign-wired') !== '1') {
      modalEl.setAttribute('data-am-assign-wired', '1');
      modalEl.addEventListener('click', function (e) {
        var t = e && e.target ? e.target : null;
        var closeBtn = t && t.closest ? t.closest('[data-am-assign-close]') : null;
        if (closeBtn) {
          e.preventDefault();
          closeChannelAssignModal(modalEl);
        }
      });

      var confirmBtn = modalEl.querySelector('#am-assign-confirm');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', function () {
          var kind = String(modalEl.getAttribute('data-am-assign-kind') || '').trim().toLowerCase();
          var key = String(modalEl.getAttribute('data-am-assign-key') || '').trim();
          var currentCh = String(modalEl.getAttribute('data-am-assign-current-channel') || '').trim().toLowerCase();
          var sel = modalEl.querySelector('#am-assign-channel-select');
          var newLabel = '';
          var newInput = modalEl.querySelector('#am-assign-new-channel');
          if (newInput) newLabel = String(newInput.value || '').trim();

          var cfg = _state && _state.config && _state.config.config ? _state.config.config : null;
          if (!cfg) {
            setMsg('Config not loaded yet.', 'text-danger');
            return;
          }

          var nextCfg = {
            channels: Array.isArray(cfg.channels) ? cfg.channels.map(function (c) { return Object.assign({}, c); }) : [],
            sources: Array.isArray(cfg.sources) ? cfg.sources.map(function (s) { return Object.assign({}, s); }) : [],
            variants: Array.isArray(cfg.variants) ? cfg.variants.map(function (v) { return Object.assign({}, v); }) : [],
            rules: Array.isArray(cfg.rules) ? cfg.rules.map(function (r) { return Object.assign({}, r); }) : [],
            allowlist: Array.isArray(cfg.allowlist) ? cfg.allowlist.map(function (a) { return Object.assign({}, a); }) : [],
          };

          var channelKey = '';
          if (newLabel) {
            var base = normalizeChannelKeyFromLabel(newLabel);
            if (!base) {
              setMsg('New channel name is invalid.', 'text-danger');
              return;
            }
            channelKey = uniqueChannelKey(base, nextCfg.channels);
            if (!channelKey) {
              setMsg('Could not create a unique channel key.', 'text-danger');
              return;
            }
            var exists = nextCfg.channels.some(function (c) { return trimLower(c && c.channel_key, 32) === channelKey; });
            if (!exists) {
              var maxSort = 0;
              nextCfg.channels.forEach(function (c) {
                var n = c && c.sort_order != null ? Number(c.sort_order) : 0;
                if (Number.isFinite(n)) maxSort = Math.max(maxSort, n);
              });
              nextCfg.channels.push({ channel_key: channelKey, label: newLabel.slice(0, 80), sort_order: maxSort + 1, enabled: 1 });
            }
          } else {
            channelKey = sel ? String(sel.value || '').trim().toLowerCase() : '';
          }

          if (!channelKey) {
            setMsg('Choose a channel.', 'text-danger');
            return;
          }
          if (channelKey === currentCh) {
            closeChannelAssignModal(modalEl);
            return;
          }

          var changed = 0;
          if (kind === 'variant') {
            var vk = normalizeVariantKey(key);
            nextCfg.variants.forEach(function (v) {
              if (normalizeVariantKey(v && v.variant_key) === vk) {
                v.channel_key = channelKey;
                changed++;
              }
            });
          } else if (kind === 'source') {
            var sk = trimLower(key, 32);
            nextCfg.variants.forEach(function (v) {
              if (trimLower(v && v.source_key, 32) === sk) {
                v.channel_key = channelKey;
                changed++;
              }
            });
          }

          if (!changed) {
            setMsg('Nothing to update.', 'text-danger');
            return;
          }

          setMsg('Saving…', 'text-secondary');
          try { confirmBtn.disabled = true; } catch (_) {}
          saveAttributionConfig(nextCfg).then(function (resp) {
            if (resp && resp.ok) {
              setMsg('Saved.', 'text-success');
              setTimeout(function () {
                closeChannelAssignModal(modalEl);
                _state.config = null;
                loadAndRender();
              }, 250);
            } else {
              setMsg((resp && resp.error) ? String(resp.error) : 'Save failed', 'text-danger');
            }
          }).finally(function () {
            try { confirmBtn.disabled = false; } catch (_) {}
          });
        });
      }
    }

    var modal = getBootstrapModal(modalEl);
    if (modal) {
      modal.show();
      return;
    }
    modalEl.style.display = 'block';
    modalEl.classList.add('show');
    modalEl.setAttribute('aria-hidden', 'false');
    try { document.body.classList.add('modal-open'); } catch (_) {}
    if (!_assignModalBackdropEl || !_assignModalBackdropEl.parentNode) {
      _assignModalBackdropEl = document.createElement('div');
      _assignModalBackdropEl.className = 'modal-backdrop fade show';
      _assignModalBackdropEl.setAttribute('aria-hidden', 'true');
      _assignModalBackdropEl.addEventListener('click', function () { closeChannelAssignModal(modalEl); });
      document.body.appendChild(_assignModalBackdropEl);
    }
  }

  function wireTree(root) {
    if (!root || root.getAttribute('data-am-tree-wired') === '1') return;
    root.setAttribute('data-am-tree-wired', '1');

    root.addEventListener('click', function (e) {
      var target = e && e.target ? e.target : null;
      var treeAction = target && target.closest ? target.closest('[data-am-tree-action]') : null;
      if (treeAction) {
        e.preventDefault();
        var action = String(treeAction.getAttribute('data-am-tree-action') || '').trim().toLowerCase();
        if (action === 'move-rule') {
          var rid = treeAction.getAttribute('data-rule-id') || '';
          var curVk = treeAction.getAttribute('data-current-variant-key') || '';
          openMoveModal(rid, curVk);
          return;
        }
        if (action === 'edit-source') {
          var sk = treeAction.getAttribute('data-source-key') || '';
          var curCh = treeAction.getAttribute('data-current-channel-key') || '';
          var lbl = treeAction.getAttribute('data-label') || '';
          openChannelAssignModal({ kind: 'source', key: sk, label: lbl, currentChannelKey: curCh });
          return;
        }
        if (action === 'edit-variant') {
          var vk = treeAction.getAttribute('data-variant-key') || '';
          var curCh2 = treeAction.getAttribute('data-current-channel-key') || '';
          var lbl2 = treeAction.getAttribute('data-label') || '';
          openChannelAssignModal({ kind: 'variant', key: vk, label: lbl2, currentChannelKey: curCh2 });
          return;
        }
        if (action === 'expand-all') {
          setAllExpanded(true);
          renderTree(root, _state.treeModel);
          return;
        }
        if (action === 'collapse-all') {
          setAllExpanded(false);
          renderTree(root, _state.treeModel);
          return;
        }
      }

      var toggle = target && target.closest ? target.closest('[data-am-tree-toggle]') : null;
      if (toggle) {
        e.preventDefault();
        var key = toggle.getAttribute('data-am-tree-toggle');
        if (!key) return;
        toggleExpanded(key);
        var node = toggle.closest('.am-tree-node');
        var children = node ? node.querySelector('.am-tree-children') : null;
        var icon = toggle.querySelector('i.fa-chevron-right, i.fa-chevron-down');
        if (children) {
          children.classList.toggle('is-hidden', !isExpanded(key));
        }
        if (icon) {
          icon.className = 'fa fa-chevron-' + (isExpanded(key) ? 'down' : 'right') + ' small';
        }
        toggle.setAttribute('aria-expanded', isExpanded(key) ? 'true' : 'false');
        return;
      }

      var editBtn = target && target.closest ? target.closest('[data-am-tree-edit-toggle]') : null;
      if (editBtn) {
        e.preventDefault();
        var node = editBtn.closest('.am-tree-source, .am-tree-variant');
        if (!node) return;
        var editEl = node.querySelector('[data-am-tree-edit]');
        if (editEl) {
          var visible = editEl.style.display !== 'none';
          root.querySelectorAll('[data-am-tree-edit]').forEach(function (el) { el.style.display = 'none'; });
          editEl.style.display = visible ? 'none' : 'block';

          var input = editEl.querySelector('.am-tree-icon-input');
          var preview = editEl.querySelector('[data-am-tree-live-preview]');
          if (input && preview) {
            var lbl = editEl.getAttribute('data-am-tree-label') || '';
            preview.innerHTML = iconSpecToPreviewHtml(input.value, lbl);
          }
          var msgEl = editEl.querySelector('[data-am-tree-save-msg]');
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'am-tree-save-msg small text-secondary ms-auto';
          }
        }
        return;
      }

      var saveBtn = target && target.closest ? target.closest('.am-tree-icon-save') : null;
      if (saveBtn) {
        e.preventDefault();
        var kind = saveBtn.getAttribute('data-kind');
        var keyVal = saveBtn.getAttribute('data-key');
        var editDiv = saveBtn.closest('[data-am-tree-edit]');
        var input = editDiv ? editDiv.querySelector('.am-tree-icon-input') : null;
        var newSpec = input ? String(input.value || '').trim() : '';
        var msgEl = editDiv ? editDiv.querySelector('[data-am-tree-save-msg]') : null;
        function setMsg(text, cls) {
          if (!msgEl) return;
          msgEl.textContent = text || '';
          msgEl.className = 'am-tree-save-msg small ' + (cls || 'text-secondary') + ' ms-auto';
        }
        var payload = { sources: [], variants: [] };
        if (kind === 'source') {
          payload.sources = [{ source_key: keyVal, icon_spec: newSpec || null }];
        } else if (kind === 'variant') {
          payload.variants = [{ variant_key: keyVal, icon_spec: newSpec || null }];
        }
        setMsg('Saving…', 'text-secondary');
        try { saveBtn.disabled = true; } catch (_) {}
        saveIcons(payload).then(function (res) {
          if (res && res.ok) {
            setMsg('Saved', 'text-success');
            try { window.dispatchEvent(new CustomEvent('kexo:attribution-icons-updated')); } catch (_) {}
            setTimeout(function () {
              _state.config = null;
              loadAndRender();
            }, 250);
          } else {
            setMsg((res && res.error) ? String(res.error) : 'Save failed', 'text-danger');
          }
          try { saveBtn.disabled = false; } catch (_) {}
        });
        return;
      }

      var resetBtn = target && target.closest ? target.closest('.am-tree-icon-reset') : null;
      if (resetBtn) {
        e.preventDefault();
        var editDiv = resetBtn.closest('[data-am-tree-edit]');
        var input = editDiv ? editDiv.querySelector('.am-tree-icon-input') : null;
        if (input && _state.config && _state.config.config) {
          var kind = resetBtn.getAttribute('data-kind');
          var keyVal = resetBtn.getAttribute('data-key');
          if (kind === 'source') {
            var s = (_state.config.config.sources || []).find(function (r) { return trimLower(r && r.source_key, 32) === trimLower(keyVal, 32); });
            input.value = (s && s.icon_spec != null) ? String(s.icon_spec) : '';
          } else if (kind === 'variant') {
            var v = (_state.config.config.variants || []).find(function (r) { return normalizeVariantKey(r && r.variant_key) === normalizeVariantKey(keyVal); });
            input.value = (v && v.icon_spec != null) ? String(v.icon_spec) : '';
          }
        }
        if (editDiv) {
          var preview = editDiv.querySelector('[data-am-tree-live-preview]');
          var lbl = editDiv.getAttribute('data-am-tree-label') || '';
          if (input && preview) preview.innerHTML = iconSpecToPreviewHtml(input.value, lbl);
          var msgEl = editDiv.querySelector('[data-am-tree-save-msg]');
          if (msgEl) {
            msgEl.textContent = '';
            msgEl.className = 'am-tree-save-msg small text-secondary ms-auto';
          }
        }
        return;
      }
    });

    root.addEventListener('input', function (e) {
      var target = e && e.target ? e.target : null;
      var input = target && target.closest ? target.closest('.am-tree-icon-input') : null;
      if (!input) return;
      var editDiv = input.closest ? input.closest('[data-am-tree-edit]') : null;
      if (!editDiv) return;
      var preview = editDiv.querySelector('[data-am-tree-live-preview]');
      if (!preview) return;
      var lbl = editDiv.getAttribute('data-am-tree-label') || '';
      preview.innerHTML = iconSpecToPreviewHtml(input.value, lbl);
    });
  }

  function loadAndRender() {
    var root = _state.rootEl;
    if (!root) return;
    root.innerHTML = '<div class="report-build-wrap"><div class="spinner-border text-primary" role="status"></div><div class="report-build-title">loading mapped tree</div></div>';
    fetchConfig().then(function (res) {
      if (!res || !res.ok || !res.config) {
        root.innerHTML = '<p class="text-secondary mb-0">Could not load attribution config.</p>';
        return;
      }
      _state.config = res;
      _state.treeModel = buildTreeModel(res.config);
      renderTree(root, _state.treeModel);
      wireTree(root);
    }).catch(function () {
      root.innerHTML = '<p class="text-secondary mb-0">Could not load attribution config.</p>';
    });
  }

  function initAttributionTreeView(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var rootId = o.rootId ? String(o.rootId) : 'settings-attribution-tree-root';
    var root = document.getElementById(rootId);
    if (!root) return;
    if (root.getAttribute('data-kexo-am-tree-bound') === '1') {
      loadAndRender();
      return;
    }
    root.setAttribute('data-kexo-am-tree-bound', '1');
    _state.rootId = rootId;
    _state.rootEl = root;
    loadAndRender();

    try {
      window.addEventListener('kexo:attribution-icons-updated', function () {
        if (_state.rootEl && document.getElementById(_state.rootId) && document.querySelector('#settings-attribution-panel-tree.active')) {
          loadAndRender();
        }
      });
    } catch (_) {}
  }

  try { window.initAttributionTreeView = initAttributionTreeView; } catch (_) {}
})();
