/**
 * Settings ? Attribution ? Mapped tree
 *
 * Shows Channel ? Source ? Variant ? Rule hierarchy with icon editing.
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
    if (!s) return '';
    if (/^<svg[\s>]/i.test(s)) {
      var safeSvg = sanitizeSvgMarkup(s);
      if (!safeSvg) return '';
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
          var vIcon = (variant && variant.icon_spec != null && String(variant.icon_spec).trim()) ? String(variant.icon_spec) : sourceIcon;
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
    var summary = matchStr.length > 60 ? matchStr.slice(0, 57) + '?' : matchStr;
    var vk = normalizeVariantKey(variantKey);
    return '<div class="am-tree-row am-tree-rule">' +
      '<span class="am-tree-pad am-tree-pad-3"></span>' +
      '<span class="am-tree-cell"><code class="small">' + escapeHtml(id || '?') + '</code></span>' +
      '<span class="am-tree-cell text-secondary small">' + escapeHtml(label || '?') + '</span>' +
      '<span class="am-tree-cell text-muted small" title="' + escapeHtml(matchStr) + '">' + escapeHtml(summary) + '</span>' +
      '<span class="am-tree-cell text-end"><button type="button" class="btn btn-outline-secondary btn-sm" data-am-tree-action="move-rule" data-rule-id="' + escapeHtml(id) + '" data-current-variant-key="' + escapeHtml(vk) + '">Edit rule</button></span>' +
      '</div>';
  }

  function renderVariantRow(variant, channelKey, sourceKey, sourceIconSpec) {
    var vk = variant.variant_key || '';
    var label = variant.label || titleFromKey(vk);
    var explicitIcon = variant.icon_spec != null ? String(variant.icon_spec) : '';
    var iconSpec = (explicitIcon && explicitIcon.trim()) ? explicitIcon : (sourceIconSpec || '');
    var ruleCount = Array.isArray(variant.rules) ? variant.rules.length : 0;
    var hasRules = ruleCount > 0;
    var expandedKey = 'v:' + vk;
    var isOpen = isExpanded(expandedKey);
    var ruleRows = (variant.rules || []).map(function (r) { return renderRuleRow(r, vk); }).join('');
    var toggleHtml = hasRules
      ? '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>'
      : '<span class="am-tree-toggle-spacer"></span>';
    return '<div class="am-tree-node am-tree-variant" data-variant-key="' + escapeHtml(vk) + '">' +
      '<div class="am-tree-row am-tree-variant-head">' +
      '<span class="am-tree-pad am-tree-pad-2"></span>' +
      toggleHtml +
      '<span class="am-tree-cell am-tree-label">' + iconSpecToPreviewHtml(iconSpec, label) + ' <strong>' + escapeHtml(label) + '</strong> <code class="small">' + escapeHtml(vk) + '</code></span>' +
      '<span class="am-tree-cell text-muted small">' + String(ruleCount) + ' rule(s)</span>' +
      '<span class="am-tree-cell d-flex align-items-center gap-2 justify-content-end">' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" data-am-tree-action="edit-variant" data-variant-key="' + escapeHtml(vk) + '" data-current-channel-key="' + escapeHtml(channelKey || '') + '" data-current-source-key="' + escapeHtml(sourceKey || '') + '" data-label="' + escapeHtml(label) + '" data-icon-spec="' + escapeHtml(explicitIcon) + '">Edit variant</button>' +
      '</span>' +
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
    var hasVariants = Array.isArray(source.variants) && source.variants.length > 0;
    var expandedKey = 's:' + channelKey + '|' + sk;
    var isOpen = isExpanded(expandedKey);
    var variantHtml = (source.variants || []).map(function (v) { return renderVariantRow(v, channelKey, sk, iconSpec); }).join('');
    var toggleHtml = hasVariants
      ? '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>'
      : '<span class="am-tree-toggle-spacer"></span>';
    return '<div class="am-tree-node am-tree-source" data-source-key="' + escapeHtml(sk) + '">' +
      '<div class="am-tree-row am-tree-source-head">' +
      '<span class="am-tree-pad am-tree-pad-1"></span>' +
      toggleHtml +
      '<span class="am-tree-cell am-tree-label">' + iconSpecToPreviewHtml(iconSpec, label) + ' <strong>' + escapeHtml(label) + '</strong> <code class="small">' + escapeHtml(sk) + '</code></span>' +
      '<span class="am-tree-cell d-flex align-items-center gap-2 justify-content-end">' +
        '<button type="button" class="btn btn-outline-secondary btn-sm" data-am-tree-action="edit-source" data-source-key="' + escapeHtml(sk) + '" data-current-channel-key="' + escapeHtml(channelKey || '') + '" data-label="' + escapeHtml(label) + '" data-icon-spec="' + escapeHtml(iconSpec) + '">Edit source</button>' +
      '</span>' +
      '</div>' +
      '<div class="am-tree-children' + (isOpen ? '' : ' is-hidden') + '" data-am-tree-children="' + escapeHtml(expandedKey) + '">' +
      variantHtml +
      '</div>' +
      '</div>';
  }

  function renderChannelRow(channel) {
    var ck = channel.channel_key || '';
    var label = channel.label || titleFromKey(ck);
    var hasSources = Array.isArray(channel.sources) && channel.sources.length > 0;
    var expandedKey = 'c:' + ck;
    var isOpen = isExpanded(expandedKey);
    var sourceHtml = (channel.sources || []).map(function (s) { return renderSourceRow(s, ck); }).join('');
    var toggleHtml = hasSources
      ? '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
        '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>'
      : '<span class="am-tree-toggle-spacer"></span>';
    return '<div class="am-tree-node am-tree-channel" data-channel-key="' + escapeHtml(ck) + '">' +
      '<div class="am-tree-row am-tree-channel-head">' +
      toggleHtml +
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
      '<p class="text-secondary small mb-0">Use <strong>Edit source</strong> / <strong>Edit variant</strong> to change channel + icon. Use <strong>Edit rule</strong> to move rules between variants.</p>' +
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
              '<div class="mb-2"><div class="small text-secondary">Rule</div><div><code id="am-move-rule-id">?</code></div></div>' +
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
      '<div class="modal fade" id="am-channel-assign-modal" tabindex="-1" aria-hidden="true" aria-label="Edit attribution item">' +
        '<div class="modal-dialog modal-dialog-centered">' +
          '<div class="modal-content">' +
            '<div class="modal-header">' +
              '<h5 class="modal-title" id="am-assign-title">Edit</h5>' +
              '<button type="button" class="btn-close" data-am-assign-close aria-label="Close"></button>' +
            '</div>' +
            '<div class="modal-body">' +
              '<div class="text-secondary small mb-2" id="am-assign-desc">Edit this item.</div>' +
              '<div class="mb-2">' +
                '<div class="small text-secondary" id="am-assign-kind">Item</div>' +
                '<div><code id="am-assign-key">?</code> <span class="text-secondary small" id="am-assign-label"></span></div>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label" for="am-assign-channel-select" id="am-assign-channel-label">Channel</label>' +
                '<select class="form-select" id="am-assign-channel-select"></select>' +
              '</div>' +
              '<div class="mb-3">' +
                '<label class="form-label" for="am-assign-new-channel" id="am-assign-new-channel-label">Or create new channel</label>' +
                '<input class="form-control" id="am-assign-new-channel" placeholder="e.g. Organic Social" />' +
                '<div class="form-hint" id="am-assign-new-channel-hint">If provided, a new channel is created and the item is assigned to it.</div>' +
              '</div>' +
              '<div class="mb-3" id="am-assign-icon-block">' +
                '<label class="form-label" for="am-assign-icon-spec" id="am-assign-icon-label">Icon</label>' +
                '<textarea class="form-control form-control-sm font-monospace" id="am-assign-icon-spec" rows="3" spellcheck="false" placeholder="fa-brands fa-google  OR  /assets/icon.png  OR  <svg ...>"></textarea>' +
                '<div class="form-hint small">Font Awesome class, image URL/path, or inline SVG.</div>' +
                '<div class="am-tree-icon-live-preview mt-2" id="am-assign-icon-preview"></div>' +
                '<div class="d-flex align-items-center gap-2 mt-2">' +
                  '<button type="button" class="btn btn-outline-secondary btn-sm" id="am-assign-icon-reset">Reset icon</button>' +
                '</div>' +
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
    var currentIconSpec = opts && opts.currentIconSpec != null ? String(opts.currentIconSpec).trim() : '';
    if (!kind || !key) return;
    if (kind !== 'source' && kind !== 'variant') return;

    var modalEl = ensureChannelAssignModal();
    if (!modalEl) return;

    modalEl.setAttribute('data-am-assign-kind', kind);
    modalEl.setAttribute('data-am-assign-key', key);
    modalEl.setAttribute('data-am-assign-current-channel', currentChannelKey || '');
    modalEl.setAttribute('data-am-assign-current-icon', currentIconSpec || '');

    var titleEl = modalEl.querySelector('#am-assign-title');
    var descEl = modalEl.querySelector('#am-assign-desc');
    var kindEl = modalEl.querySelector('#am-assign-kind');
    var keyEl = modalEl.querySelector('#am-assign-key');
    var labelEl = modalEl.querySelector('#am-assign-label');
    var channelLabelEl = modalEl.querySelector('#am-assign-channel-label');
    var newChannelLabelEl = modalEl.querySelector('#am-assign-new-channel-label');
    var newChannelHintEl = modalEl.querySelector('#am-assign-new-channel-hint');
    if (kind === 'source') {
      if (titleEl) titleEl.textContent = 'Edit source';
      if (descEl) descEl.textContent = 'Assign this source to a channel and optionally set its icon.';
      if (channelLabelEl) channelLabelEl.textContent = 'Channel for this source';
      if (newChannelLabelEl) newChannelLabelEl.textContent = 'Or create new channel';
      if (newChannelHintEl) newChannelHintEl.textContent = 'If provided, a new channel is created and the source is assigned to it.';
    } else {
      if (titleEl) titleEl.textContent = 'Edit variant';
      if (descEl) descEl.textContent = 'Assign this variant to a channel and optionally set its icon. Icon inherits from source when empty.';
      if (channelLabelEl) channelLabelEl.textContent = 'Channel for this variant';
      if (newChannelLabelEl) newChannelLabelEl.textContent = 'Or create new channel';
      if (newChannelHintEl) newChannelHintEl.textContent = 'If provided, a new channel is created and the variant is assigned to it.';
    }
    if (kindEl) kindEl.textContent = kind === 'source' ? 'Source' : 'Variant';
    if (keyEl) keyEl.textContent = key;
    if (labelEl) labelEl.textContent = label ? ('? ' + label) : '';

    var iconSpecEl = modalEl.querySelector('#am-assign-icon-spec');
    var iconPreviewEl = modalEl.querySelector('#am-assign-icon-preview');
    if (iconSpecEl) iconSpecEl.value = currentIconSpec;
    if (iconPreviewEl) iconPreviewEl.innerHTML = iconSpecToPreviewHtml(currentIconSpec, label);

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

    var iconResetBtn = modalEl.querySelector('#am-assign-icon-reset');
    if (iconResetBtn) {
      iconResetBtn.onclick = function () {
        var cur = modalEl.getAttribute('data-am-assign-current-icon') || '';
        var spec = modalEl.querySelector('#am-assign-icon-spec');
        var prev = modalEl.querySelector('#am-assign-icon-preview');
        if (spec) spec.value = cur;
        if (prev) prev.innerHTML = iconSpecToPreviewHtml(cur, label);
      };
    }
    var iconSpecInput = modalEl.querySelector('#am-assign-icon-spec');
    if (iconSpecInput) {
      iconSpecInput.oninput = function () {
        var prev = modalEl.querySelector('#am-assign-icon-preview');
        if (prev) prev.innerHTML = iconSpecToPreviewHtml(iconSpecInput.value, label);
      };
    }

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
          var currentIcon = String(modalEl.getAttribute('data-am-assign-current-icon') || '').trim();
          var sel = modalEl.querySelector('#am-assign-channel-select');
          var newLabel = '';
          var newInput = modalEl.querySelector('#am-assign-new-channel');
          if (newInput) newLabel = String(newInput.value || '').trim();
          var iconSpecInput = modalEl.querySelector('#am-assign-icon-spec');
          var newIconSpec = iconSpecInput ? String(iconSpecInput.value || '').trim() : '';

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
          var channelUnchanged = channelKey === currentCh;
          var iconUnchanged = newIconSpec === currentIcon;
          if (channelUnchanged && iconUnchanged) {
            closeChannelAssignModal(modalEl);
            return;
          }

          var changed = 0;
          if (kind === 'variant') {
            var vk = normalizeVariantKey(key);
            nextCfg.variants.forEach(function (v) {
              if (normalizeVariantKey(v && v.variant_key) === vk) {
                if (!channelUnchanged) v.channel_key = channelKey;
                v.icon_spec = newIconSpec || null;
                changed++;
              }
            });
          } else if (kind === 'source') {
            var sk = trimLower(key, 32);
            if (!channelUnchanged) {
              nextCfg.variants.forEach(function (v) {
                if (trimLower(v && v.source_key, 32) === sk) {
                  v.channel_key = channelKey;
                  changed++;
                }
              });
            }
            var srcUpdated = false;
            nextCfg.sources.forEach(function (s) {
              if (trimLower(s && s.source_key, 32) === sk) {
                s.icon_spec = newIconSpec || null;
                srcUpdated = true;
              }
            });
            if (srcUpdated) changed++;
          }

          if (!changed) {
            setMsg('Nothing to update.', 'text-danger');
            return;
          }

          setMsg('Saving?', 'text-secondary');
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
          var iconSpec = treeAction.getAttribute('data-icon-spec') || '';
          openChannelAssignModal({ kind: 'source', key: sk, label: lbl, currentChannelKey: curCh, currentIconSpec: iconSpec });
          return;
        }
        if (action === 'edit-variant') {
          var vk = treeAction.getAttribute('data-variant-key') || '';
          var curCh2 = treeAction.getAttribute('data-current-channel-key') || '';
          var lbl2 = treeAction.getAttribute('data-label') || '';
          var iconSpec2 = treeAction.getAttribute('data-icon-spec') || '';
          openChannelAssignModal({ kind: 'variant', key: vk, label: lbl2, currentChannelKey: curCh2, currentIconSpec: iconSpec2 });
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
