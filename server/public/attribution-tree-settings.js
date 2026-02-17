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

  function fetchConfig() {
    return apiGetJson(API + '/api/attribution/config');
  }

  function saveIcons(payload) {
    return apiPostJson(API + '/api/attribution/icons', payload);
  }

  function titleFromKey(key) {
    var s = String(key || '').trim();
    if (!s) return 'Unknown';
    return s.replace(/[:_ -]+/g, ' ').trim().split(/\s+/g).filter(Boolean)
      .map(function (w) { return w.slice(0, 1).toUpperCase() + w.slice(1); }).join(' ');
  }

  function iconSpecToPreviewHtml(spec, label) {
    var s = spec != null ? String(spec).trim() : '';
    var l = label != null ? String(label).trim() : '';
    if (!s) return '<span class="text-muted small">—</span>';
    if (/^<svg[\s>]/i.test(s)) return '<span class="am-tree-icon-preview" title="' + escapeHtml(l) + '">' + s + '</span>';
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
    return _state.expanded[k] !== false;
  }

  function renderRuleRow(rule) {
    var id = (rule && rule.id) ? String(rule.id) : '';
    var label = (rule && rule.label) ? String(rule.label) : '';
    var match = (rule && rule.match_json) ? rule.match_json : (rule && rule.match ? JSON.stringify(rule.match) : '{}');
    var matchStr = typeof match === 'string' ? match : JSON.stringify(match);
    var summary = matchStr.length > 60 ? matchStr.slice(0, 57) + '…' : matchStr;
    return '<div class="am-tree-row am-tree-rule">' +
      '<span class="am-tree-pad am-tree-pad-3"></span>' +
      '<span class="am-tree-cell"><code class="small">' + escapeHtml(id || '—') + '</code></span>' +
      '<span class="am-tree-cell text-secondary small">' + escapeHtml(label || '—') + '</span>' +
      '<span class="am-tree-cell text-muted small" title="' + escapeHtml(matchStr) + '">' + escapeHtml(summary) + '</span>' +
      '</div>';
  }

  function renderVariantRow(variant, channelKey, sourceKey) {
    var vk = variant.variant_key || '';
    var label = variant.label || titleFromKey(vk);
    var iconSpec = variant.icon_spec != null ? String(variant.icon_spec) : '';
    var ruleCount = Array.isArray(variant.rules) ? variant.rules.length : 0;
    var expandedKey = 'v:' + vk;
    var isOpen = isExpanded(expandedKey);
    var ruleRows = (variant.rules || []).map(function (r) { return renderRuleRow(r); }).join('');
    return '<div class="am-tree-node am-tree-variant" data-variant-key="' + escapeHtml(vk) + '">' +
      '<div class="am-tree-row am-tree-variant-head">' +
      '<span class="am-tree-pad am-tree-pad-2"></span>' +
      '<button type="button" class="am-tree-toggle btn btn-link btn-sm p-0 me-1" data-am-tree-toggle="' + escapeHtml(expandedKey) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '">' +
      '<i class="fa fa-chevron-' + (isOpen ? 'down' : 'right') + ' small" aria-hidden="true"></i></button>' +
      '<span class="am-tree-cell am-tree-label">' + iconSpecToPreviewHtml(iconSpec, label) + ' <strong>' + escapeHtml(label) + '</strong> <code class="small">' + escapeHtml(vk) + '</code></span>' +
      '<span class="am-tree-cell text-muted small">' + String(ruleCount) + ' rule(s)</span>' +
      '</div>' +
      '<div class="am-tree-variant-icon-edit mt-1 mb-2" data-am-tree-edit="variant" data-variant-key="' + escapeHtml(vk) + '" style="display:none">' +
      '<div class="input-group input-group-sm"><input type="text" class="form-control form-control-sm am-tree-icon-input" placeholder="Font Awesome class or image URL" value="' + escapeHtml(iconSpec) + '">' +
      '<button type="button" class="btn btn-outline-primary btn-sm am-tree-icon-save" data-kind="variant" data-key="' + escapeHtml(vk) + '">Save</button>' +
      '<button type="button" class="btn btn-outline-secondary btn-sm am-tree-icon-reset" data-kind="variant" data-key="' + escapeHtml(vk) + '">Reset</button></div>' +
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
      '</div>' +
      '<div class="am-tree-source-icon-edit mt-1 mb-2" data-am-tree-edit="source" data-source-key="' + escapeHtml(sk) + '" style="display:none">' +
      '<div class="input-group input-group-sm"><input type="text" class="form-control form-control-sm am-tree-icon-input" placeholder="Font Awesome class or image URL" value="' + escapeHtml(iconSpec) + '">' +
      '<button type="button" class="btn btn-outline-primary btn-sm am-tree-icon-save" data-kind="source" data-key="' + escapeHtml(sk) + '">Save</button>' +
      '<button type="button" class="btn btn-outline-secondary btn-sm am-tree-icon-reset" data-kind="source" data-key="' + escapeHtml(sk) + '">Reset</button></div>' +
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
      '<p class="text-secondary small mb-2">Expand a channel or source to edit icons for sources and variants. Changes sync with Settings → Kexo → Icons.</p>' +
      model.map(function (ch) { return renderChannelRow(ch); }).join('') +
      '</div>';
    root.innerHTML = html;
  }

  function wireTree(root) {
    if (!root || root.getAttribute('data-am-tree-wired') === '1') return;
    root.setAttribute('data-am-tree-wired', '1');

    root.addEventListener('click', function (e) {
      var target = e && e.target ? e.target : null;
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

      var labelCell = target && target.closest ? target.closest('.am-tree-channel-head .am-tree-label, .am-tree-source-head .am-tree-label, .am-tree-variant-head .am-tree-label') : null;
      if (labelCell) {
        var node = labelCell.closest('.am-tree-channel, .am-tree-source, .am-tree-variant');
        if (!node) return;
        var editEl = node.querySelector('[data-am-tree-edit]');
        if (editEl) {
          var visible = editEl.style.display !== 'none';
          root.querySelectorAll('[data-am-tree-edit]').forEach(function (el) { el.style.display = 'none'; });
          editEl.style.display = visible ? 'none' : 'block';
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
        var newSpec = input ? input.value.trim() : '';
        var payload = { sources: [], variants: [] };
        if (kind === 'source') {
          payload.sources = [{ source_key: keyVal, icon_spec: newSpec || null }];
        } else if (kind === 'variant') {
          payload.variants = [{ variant_key: keyVal, icon_spec: newSpec || null }];
        }
        saveIcons(payload).then(function (res) {
          if (res && res.ok) {
            _state.config = null;
            loadAndRender();
            try { window.dispatchEvent(new CustomEvent('kexo:attribution-icons-updated')); } catch (_) {}
          }
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
