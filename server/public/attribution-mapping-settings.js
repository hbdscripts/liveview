/**
 * Settings → Attribution mapping
 *
 * Backed by:
 * - GET  /api/attribution/config
 * - POST /api/attribution/config
 * - GET  /api/attribution/observed
 * - POST /api/attribution/map
 *
 * Non-negotiables:
 * - Fail-open: Settings must never hard-fail if config tables are missing.
 * - Settings page must never show the page-body overlay loader.
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
    return div.innerHTML.replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function clampInt(v, fallback, min, max) {
    var n = parseInt(String(v), 10);
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function trimLower(v, maxLen) {
    var s = v == null ? '' : String(v);
    s = s.trim().toLowerCase();
    if (!s) return '';
    var lim = typeof maxLen === 'number' ? maxLen : 256;
    return s.length > lim ? s.slice(0, lim) : s;
  }

  function normalizeKeyLike(v, maxLen) {
    var s = v == null ? '' : String(v);
    s = s.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) return '';
    var lim = typeof maxLen === 'number' ? maxLen : 32;
    return s.length > lim ? s.slice(0, lim) : s;
  }

  function normalizeVariantKey(v) {
    var s = v == null ? '' : String(v);
    s = s.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) return '';
    return s.length > 120 ? s.slice(0, 120) : s;
  }

  function normalizeBaseVariantKey(v) {
    var k = normalizeVariantKey(v);
    if (!k) return '';
    var m = k.match(/^(.*?):(house|affiliate|partner)(?::.*)?$/);
    if (m && m[1]) return normalizeVariantKey(m[1]) || k;
    return k;
  }

  function safeJsonParse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var ms = typeof timeoutMs === 'number' && isFinite(timeoutMs) ? timeoutMs : 20000;
    if (typeof AbortController === 'undefined') {
      return fetch(url, options);
    }
    var ctrl = new AbortController();
    var id = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, ms);
    var opts = Object.assign({}, options || {}, { signal: ctrl.signal });
    return fetch(url, opts).finally(function () { try { clearTimeout(id); } catch (_) {} });
  }

  function apiGetJson(url) {
    return fetchWithTimeout(url, { credentials: 'same-origin', cache: 'no-store' }, 25000)
      .then(function (r) { return r && r.ok ? r.json() : null; })
      .catch(function (err) {
        try { console.warn('[attribution-mapping] apiGetJson failed', url, err); } catch (_) {}
        try {
          if (window.kexoSentry && typeof window.kexoSentry.captureException === 'function') {
            window.kexoSentry.captureException(err, { context: 'attributionMapping.apiGetJson', url: String(url || '') }, 'warning');
          }
        } catch (_) {}
        return null;
      });
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
        return r.json().catch(function (err) {
          try { console.warn('[attribution-mapping] apiPostJson invalid json', url, r && r.status, err); } catch (_) {}
          try {
            if (window.kexoSentry && typeof window.kexoSentry.captureException === 'function') {
              window.kexoSentry.captureException(err, { context: 'attributionMapping.apiPostJson.invalidJson', url: String(url || ''), status: r && r.status }, 'warning');
            }
          } catch (_) {}
          return null;
        }).then(function (body) {
          if (r && r.ok) return body;
          return { ok: false, status: r && r.status, error: (body && body.error) || (r && r.status === 403 ? 'Admin only' : 'Request failed') };
        });
      })
      .catch(function (err) {
        try { console.warn('[attribution-mapping] apiPostJson failed', url, err); } catch (_) {}
        try {
          if (window.kexoSentry && typeof window.kexoSentry.captureException === 'function') {
            window.kexoSentry.captureException(err, { context: 'attributionMapping.apiPostJson', url: String(url || '') }, 'warning');
          }
        } catch (_) {}
        return { ok: false, status: 0, error: 'Request failed' };
      });
  }

  function fetchConfig() {
    return apiGetJson(API + '/api/attribution/config');
  }

  function saveConfig(cfg) {
    return apiPostJson(API + '/api/attribution/config', { config: cfg || {} });
  }

  function fetchObserved(params) {
    var p = params && typeof params === 'object' ? params : {};
    var limit = clampInt(p.limit, 500, 10, 5000);
    var minSeen = clampInt(p.minSeen, 2, 1, 1000000);
    var tokenType = trimLower(p.tokenType, 48);
    var url = API + '/api/attribution/observed?limit=' + encodeURIComponent(String(limit)) + '&minSeen=' + encodeURIComponent(String(minSeen));
    if (tokenType) url += '&tokenType=' + encodeURIComponent(tokenType);
    return apiGetJson(url);
  }

  function mapToken(payload) {
    return apiPostJson(API + '/api/attribution/map', payload || {});
  }

  var _state = {
    rootId: '',
    rootEl: null,
    config: null,
    observed: [],
    selected: null, // { token_type, token_value }
    mappedTokenKeys: {}, // "token_type|token_value" -> true
    sourceMetaByKey: {}, // source_key -> { label, icon_spec }
    variantMetaByKey: {}, // variant_key -> { label, icon_spec, channel_key, source_key }
  };

  function setHint(id, text, ok) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'form-hint ' + (ok ? 'text-success' : (text ? 'text-danger' : ''));
  }

  function variantsFromConfig(cfg) {
    var v = cfg && cfg.variants && Array.isArray(cfg.variants) ? cfg.variants : [];
    return v.map(function (row) {
      var key = normalizeBaseVariantKey(row && (row.variant_key != null ? row.variant_key : row.key));
      var label = row && row.label != null ? String(row.label) : '';
      return { key: key, label: label };
    }).filter(function (it) { return it && it.key; });
  }

  function channelsFromConfig(cfg) {
    var channels = cfg && cfg.channels && Array.isArray(cfg.channels) ? cfg.channels : [];
    var variants = cfg && cfg.variants && Array.isArray(cfg.variants) ? cfg.variants : [];
    var order = [];
    var labels = {};

    function add(key, label) {
      var k = normalizeKeyLike(key, 32);
      if (!k) return;
      if (!labels[k]) labels[k] = label != null ? String(label) : '';
      if (order.indexOf(k) === -1) order.push(k);
    }

    channels.forEach(function (row) {
      add(row && (row.channel_key != null ? row.channel_key : row.key), row && row.label);
    });
    variants.forEach(function (row) {
      add(row && (row.channel_key != null ? row.channel_key : row.channelKey), '');
    });

    return order.map(function (k) { return { key: k, label: labels[k] || '' }; });
  }

  function sourcesFromConfig(cfg) {
    var sources = cfg && cfg.sources && Array.isArray(cfg.sources) ? cfg.sources : [];
    var variants = cfg && cfg.variants && Array.isArray(cfg.variants) ? cfg.variants : [];
    var order = [];
    var labels = {};

    function add(key, label) {
      var k = normalizeKeyLike(key, 32);
      if (!k) return;
      if (!labels[k]) labels[k] = label != null ? String(label) : '';
      if (order.indexOf(k) === -1) order.push(k);
    }

    sources.forEach(function (row) {
      add(row && (row.source_key != null ? row.source_key : row.key), row && row.label);
    });
    variants.forEach(function (row) {
      add(row && (row.source_key != null ? row.source_key : row.sourceKey), '');
    });

    return order.map(function (k) { return { key: k, label: labels[k] || '' }; });
  }

  function tagsFromConfig(cfg) {
    var tags = cfg && cfg.tags && Array.isArray(cfg.tags) ? cfg.tags : [];
    var rules = cfg && cfg.rules && Array.isArray(cfg.rules) ? cfg.rules : [];
    var order = [];
    var labels = {};

    function add(key, label) {
      var k = normalizeKeyLike(key, 120);
      if (!k) return;
      if (!labels[k]) labels[k] = label != null ? String(label) : '';
      if (order.indexOf(k) === -1) order.push(k);
    }

    tags.forEach(function (row) {
      add(row && (row.tag_key != null ? row.tag_key : row.key), row && row.label);
    });
    rules.forEach(function (row) {
      add(row && (row.tag_key != null ? row.tag_key : row.tagKey), '');
    });

    return order.map(function (k) { return { key: k, label: labels[k] || '' }; });
  }

  function sanitizeSvgMarkup(markup) {
    var s = markup == null ? '' : String(markup);
    s = s.trim();
    if (!/^<svg[\s>]/i.test(s)) return '';
    s = s.replace(/<\?xml[\s\S]*?\?>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
    s = s.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/\s(?:href|xlink:href)\s*=\s*("javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi, '');
    return s.trim();
  }

  function iconSpecToPreviewHtml(spec, label) {
    var s = spec != null ? String(spec).trim() : '';
    var l = label != null ? String(label).trim() : '';
    if (!s) return '<span class="text-muted small">—</span>';
    if (/^<svg[\s>]/i.test(s)) {
      var safeSvg = sanitizeSvgMarkup(s);
      if (!safeSvg) return '<span class="text-muted small">—</span>';
      return '<span class="am-map-icon-preview" title="' + escapeHtml(l) + '">' + safeSvg + '</span>';
    }
    if (/^(https?:\/\/|\/\/|\/)/i.test(s)) return '<span class="am-map-icon-preview"><img src="' + escapeHtml(s) + '" alt="" width="20" height="20" style="vertical-align:middle"></span>';
    return '<span class="am-map-icon-preview" title="' + escapeHtml(l) + '"><i class="' + escapeHtml(s) + '" aria-hidden="true"></i></span>';
  }

  function buildIconMetaMaps(cfg) {
    var config = cfg && typeof cfg === 'object' ? cfg : {};
    var sources = Array.isArray(config.sources) ? config.sources : [];
    var variants = Array.isArray(config.variants) ? config.variants : [];
    var sMap = {};
    var vMap = {};
    sources.forEach(function (r) {
      var key = normalizeKeyLike(r && (r.source_key != null ? r.source_key : r.key), 32);
      if (!key) return;
      sMap[key] = {
        label: (r && r.label != null) ? String(r.label) : key,
        icon_spec: (r && r.icon_spec != null) ? String(r.icon_spec) : '',
      };
    });
    variants.forEach(function (r) {
      var key = normalizeBaseVariantKey(r && (r.variant_key != null ? r.variant_key : r.key));
      if (!key) return;
      vMap[key] = {
        label: (r && r.label != null) ? String(r.label) : key,
        icon_spec: (r && r.icon_spec != null) ? String(r.icon_spec) : '',
        channel_key: normalizeKeyLike(r && (r.channel_key != null ? r.channel_key : r.channelKey), 32),
        source_key: normalizeKeyLike(r && (r.source_key != null ? r.source_key : r.sourceKey), 32),
      };
    });
    _state.sourceMetaByKey = sMap;
    _state.variantMetaByKey = vMap;
  }

  function updateSourceIconPreview() {
    var prevEl = document.getElementById('am-source-icon-preview');
    if (!prevEl) return;
    var srcEl = document.getElementById('am-source-key');
    var sourceKey = normalizeKeyLike(srcEl ? srcEl.value : '', 32);
    if (!sourceKey) {
      prevEl.innerHTML = '<span class="text-muted small">—</span>';
      return;
    }
    var meta = _state.sourceMetaByKey && _state.sourceMetaByKey[sourceKey] ? _state.sourceMetaByKey[sourceKey] : null;
    var iconSpec = meta && meta.icon_spec ? String(meta.icon_spec) : '';
    var label = meta && meta.label ? String(meta.label) : sourceKey;
    prevEl.innerHTML = iconSpecToPreviewHtml(iconSpec, label);
  }

  function updateIconInputPreview(inputId, previewId, label) {
    var input = document.getElementById(inputId);
    var out = document.getElementById(previewId);
    if (!out) return;
    var spec = input ? String(input.value || '') : '';
    out.innerHTML = iconSpecToPreviewHtml(spec, label || '');
  }

  function renderSkeleton(root) {
    root.innerHTML = '' +
      '<div class="mb-3">' +
        '<h4 class="mb-2" title="Tokens captured from visitor sessions (UTMs, referrer host, click IDs). Filter by type, set Min seen to hide rare values, then click Use to map a token to an attribution variant.">Observed tokens <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i> <a href=\"#\" class=\"link-primary small ms-2\" data-am-action=\"refresh-observed\" title=\"Reload observed tokens from the database.\">Refresh</a></h4>' +
        '<div class="row g-2 align-items-end">' +
          '<div class="col-12 col-md-3">' +
            '<label class="form-label" for="am-token-type" title="Filter the list: utm_source/medium/campaign, referrer_host, param_name (click IDs like gclid), param_pair, or kexo_attr (explicit URL param).">Token type <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
            '<select class="form-select" id="am-token-type">' +
              '<option value="">All types</option>' +
              '<option value="utm_source" selected>source (utm_source)</option>' +
              '<option value="utm_medium">utm_medium</option>' +
              '<option value="utm_campaign">utm_campaign</option>' +
              '<option value="utm_content">utm_content</option>' +
              '<option value="utm_term">utm_term</option>' +
              '<option value="referrer_host">referrer_host</option>' +
              '<option value="param_name">param_name</option>' +
              '<option value="param_pair">param_pair</option>' +
              '<option value="kexo_attr">kexo_attr</option>' +
            '</select>' +
          '</div>' +
          '<div class="col-6 col-md-2">' +
            '<label class="form-label" for="am-min-seen" title="Only show tokens seen at least this many times. Increase to focus on common traffic sources.">Min seen <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
            '<input class="form-control" id="am-min-seen" type="number" min="1" max="1000000" value="2" />' +
          '</div>' +
          '<div class="col-6 col-md-2">' +
            '<label class="form-label" for="am-limit" title="Max number of tokens to load. Higher values may be slower.">Limit <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
            '<input class="form-control" id="am-limit" type="number" min="10" max="5000" value="500" />' +
          '</div>' +
          '<div class="col-12 col-md-auto">' +
            '<label class="form-check mb-0">' +
              '<input class="form-check-input" type="checkbox" id="am-show-mapped" />' +
              '<span class="form-check-label">Show mapped</span>' +
            '</label>' +
          '</div>' +
          '<div class="col-12 col-md-auto">' +
            '<span id="am-observed-msg" class="form-hint"></span>' +
          '</div>' +
        '</div>' +
        '<div class="table-responsive mt-2">' +
          '<table class="table table-sm table-vcenter card-table">' +
            '<thead><tr>' +
              '<th style="width:120px" title="Token type: utm_*, referrer_host, param_name, param_pair, or kexo_attr.">Type</th>' +
              '<th title="The actual value (e.g. utm_source=google, referrer_host=twitter.com).">Value</th>' +
              '<th class="text-end" style="width:90px" title="How many sessions had this token.">Seen</th>' +
              '<th style="width:180px" title="Most recent session timestamp.">Last seen</th>' +
              '<th style="width:110px"></th>' +
            '</tr></thead>' +
            '<tbody id="am-observed-body">' +
              '<tr><td colspan="5" class="text-secondary">Loading…</td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +

      '<div class="card card-sm mb-3" id="am-create-mapping-card">' +
        '<div class="card-header"><h4 class="card-title mb-0" title="Map a selected token to an attribution variant. Sessions with that token will be attributed to the variant (Channel + Variant), with an optional Tag for nested reporting.">Create mapping <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></h4></div>' +
        '<div class="card-body">' +
          '<div class="row g-2">' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" title="The token you selected from the table. Click Use on a row above to select.">Token <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control" id="am-selected-token" type="text" value="Select a token above" readonly />' +
            '</div>' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-variant-key" title="Variant key (e.g. google_ads). This is the second tier under Channel.">Variant key <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-variant-key" list="am-variants-list" placeholder="e.g. google_ads" />' +
              '<datalist id="am-variants-list"></datalist>' +
            '</div>' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-priority" title="Rule priority (lower = higher). Rules are evaluated in priority order; first match wins.">Priority <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control" id="am-priority" type="number" value="1000" min="-1000000" max="1000000" />' +
            '</div>' +

            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-tag-key" title="Optional Tag (third tier) for nested reporting. Only shows as a sub-row when explicitly set.">Tag (optional) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-tag-key" type="text" list="am-tags-list" placeholder="e.g. affiliate_1" />' +
              '<datalist id="am-tags-list"></datalist>' +
            '</div>' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-variant-label" title="Human-readable label for the variant (e.g. Google Ads). Shown in Acquisition reports.">Variant label (optional) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control" id="am-variant-label" type="text" placeholder="e.g. Google Ads" />' +
            '</div>' +
            '<div class="col-6 col-md-2">' +
              '<label class="form-label" for="am-channel-key" title="High-level channel: paid_search, organic_search, email, affiliate, direct, other.">Channel <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-channel-key" type="text" list="am-channels-list" placeholder="paid_search" />' +
              '<datalist id="am-channels-list"></datalist>' +
            '</div>' +
            '<div class="col-6 col-md-2">' +
              '<label class="form-label" for="am-source-key" title="Traffic source: google, bing, meta, omnisend, direct, other.">Source <span id="am-source-icon-preview" class="ms-1" aria-hidden="true"></span> <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-source-key" type="text" list="am-sources-list" placeholder="google" />' +
              '<datalist id="am-sources-list"></datalist>' +
            '</div>' +

            '<div class="col-12 col-md-6">' +
              '<label class="form-label" for="am-source-icon-spec" title="Optional: seed the source icon (icon_spec) only if it is blank. This will not overwrite an existing icon.">Source icon (optional, set if blank) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<textarea class="form-control font-monospace" id="am-source-icon-spec" rows="2" spellcheck="false" placeholder="fa-brands fa-google  OR  /assets/icon.png  OR  <svg ...>"></textarea>' +
              '<div class="form-hint small">Only applied when the source has no icon yet.</div>' +
              '<div id="am-source-icon-input-preview" class="am-map-icon-live-preview mt-1"></div>' +
            '</div>' +
            '<div class="col-12 col-md-6">' +
              '<label class="form-label" for="am-variant-icon-spec" title="Optional: seed the variant icon (icon_spec) only if it is blank. This will not overwrite an existing icon.">Variant icon (optional, set if blank) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></label>' +
              '<textarea class="form-control font-monospace" id="am-variant-icon-spec" rows="2" spellcheck="false" placeholder="fa-solid fa-bolt  OR  /assets/icon.png  OR  <svg ...>"></textarea>' +
              '<div class="form-hint small">Only applied when the variant has no icon yet. Leaving blank is fine.</div>' +
              '<div id="am-variant-icon-input-preview" class="am-map-icon-live-preview mt-1"></div>' +
            '</div>' +
          '</div>' +
          '<div class="d-flex align-items-center gap-2 flex-wrap mt-3">' +
            '<button type="button" class="btn btn-primary" data-am-action="map-token" title="Save this rule. New sessions with the token will be attributed to the variant.">Create mapping</button>' +
            '<button type="button" class="btn btn-ghost-secondary" data-am-action="clear-selected" title="Deselect the current token.">Clear</button>' +
            '<span id="am-map-msg" class="form-hint"></span>' +
          '</div>' +
          '<div class="text-secondary small mt-2">' +
            '<div><strong>Note:</strong> mapping <code>kexo_attr</code> adds the variant to the allowlist (explicit param only wins when allowlisted).</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<details class="mb-0">' +
        '<summary class="text-secondary" title="Edit the raw config (channels, sources, variants, rules, allowlist). Use Reload to discard edits, Save config to apply.">Advanced: edit full config (JSON) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" aria-hidden="true"></i></summary>' +
        '<div class="mt-2">' +
          '<textarea class="form-control font-monospace" id="am-config-json" rows="14" spellcheck="false" placeholder="{\\n  &quot;channels&quot;: [],\\n  &quot;sources&quot;: [],\\n  &quot;variants&quot;: [],\\n  &quot;tags&quot;: [],\\n  &quot;rules&quot;: [],\\n  &quot;allowlist&quot;: []\\n}"></textarea>' +
          '<div class="d-flex align-items-center gap-2 flex-wrap mt-2">' +
            '<button type="button" class="btn btn-ghost-secondary" data-am-action="reload-config" title="Discard JSON edits and reload from database.">Reload</button>' +
            '<button type="button" class="btn btn-success" data-am-action="save-config" title="Replace the entire config with the JSON. Use with caution.">Save config</button>' +
            '<span id="am-config-msg" class="form-hint"></span>' +
          '</div>' +
          '<div class="text-secondary small mt-2">Saving replaces the config tables with the submitted payload.</div>' +
        '</div>' +
      '</details>';
  }

  function renderVariantsDatalist(list) {
    var dl = document.getElementById('am-variants-list');
    if (!dl) return;
    var items = Array.isArray(list) ? list : [];
    dl.innerHTML = items.map(function (it) {
      var key = it && it.key ? String(it.key) : '';
      if (!key) return '';
      var label = it && it.label ? String(it.label) : '';
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label || key) + '</option>';
    }).join('');
  }

  function renderChannelsDatalist(list) {
    var dl = document.getElementById('am-channels-list');
    if (!dl) return;
    var items = Array.isArray(list) ? list : [];
    dl.innerHTML = items.map(function (it) {
      var key = it && it.key ? String(it.key) : '';
      if (!key) return '';
      var label = it && it.label ? String(it.label) : '';
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label || key) + '</option>';
    }).join('');
  }

  function renderSourcesDatalist(list) {
    var dl = document.getElementById('am-sources-list');
    if (!dl) return;
    var items = Array.isArray(list) ? list : [];
    dl.innerHTML = items.map(function (it) {
      var key = it && it.key ? String(it.key) : '';
      if (!key) return '';
      var label = it && it.label ? String(it.label) : '';
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label || key) + '</option>';
    }).join('');
  }

  function renderTagsDatalist(list) {
    var dl = document.getElementById('am-tags-list');
    if (!dl) return;
    var items = Array.isArray(list) ? list : [];
    dl.innerHTML = items.map(function (it) {
      var key = it && it.key ? String(it.key) : '';
      if (!key) return '';
      var label = it && it.label ? String(it.label) : '';
      return '<option value="' + escapeHtml(key) + '">' + escapeHtml(label || key) + '</option>';
    }).join('');
  }

  function renderConfigText(cfg) {
    var ta = document.getElementById('am-config-json');
    if (!ta) return;
    var configObj = cfg && cfg.config ? cfg.config : (cfg && cfg.ok && cfg.config ? cfg.config : (cfg && cfg.config ? cfg.config : cfg));
    if (cfg && cfg.ok === true && cfg.config) configObj = cfg.config;
    if (cfg && cfg.ok === true && cfg.config == null && cfg.config !== false && cfg.config !== 0) configObj = cfg.config;
    if (!configObj || typeof configObj !== 'object') configObj = { channels: [], sources: [], variants: [], tags: [], rules: [], allowlist: [] };
    try {
      ta.value = JSON.stringify(configObj, null, 2);
    } catch (_) {
      ta.value = '';
    }
  }

  function tokenKey(tokenType, tokenValue) {
    var t = trimLower(tokenType, 48);
    var v = trimLower(tokenValue, 256);
    if (!t || !v) return '';
    return t + '|' + v;
  }

  function collectMatchValues(matchNode) {
    if (matchNode == null) return [];
    if (Array.isArray(matchNode)) return matchNode;
    if (typeof matchNode === 'string' || typeof matchNode === 'number' || typeof matchNode === 'boolean') return [matchNode];
    if (typeof matchNode !== 'object') return [];
    if (Array.isArray(matchNode.any)) return matchNode.any;
    if (Array.isArray(matchNode.in)) return matchNode.in;
    if (matchNode.eq != null) return [matchNode.eq];
    if (matchNode.value != null) return [matchNode.value];
    return [];
  }

  function addMappedTokenKey(map, tokenType, tokenValue) {
    var k = tokenKey(tokenType, tokenValue);
    if (!k) return;
    map[k] = true;
  }

  function rebuildMappedTokenLookup(cfg) {
    var next = {};
    var rules = cfg && Array.isArray(cfg.rules) ? cfg.rules : [];
    var allowlist = cfg && Array.isArray(cfg.allowlist) ? cfg.allowlist : [];

    rules.forEach(function (rule) {
      var raw = rule && (rule.match_json != null ? rule.match_json : rule.match);
      var match = typeof raw === 'string' ? safeJsonParse(raw) : raw;
      if (!match || typeof match !== 'object') return;

      collectMatchValues(match.utm_source).forEach(function (v) { addMappedTokenKey(next, 'utm_source', v); });
      collectMatchValues(match.utm_medium).forEach(function (v) { addMappedTokenKey(next, 'utm_medium', v); });
      collectMatchValues(match.utm_campaign).forEach(function (v) { addMappedTokenKey(next, 'utm_campaign', v); });
      collectMatchValues(match.utm_content).forEach(function (v) { addMappedTokenKey(next, 'utm_content', v); });
      collectMatchValues(match.utm_term).forEach(function (v) { addMappedTokenKey(next, 'utm_term', v); });
      collectMatchValues(match.referrer_host).forEach(function (v) { addMappedTokenKey(next, 'referrer_host', v); });
      collectMatchValues(match.param_names).forEach(function (v) { addMappedTokenKey(next, 'param_name', v); });
      collectMatchValues(match.param_pairs).forEach(function (v) { addMappedTokenKey(next, 'param_pair', v); });
      collectMatchValues(match.kexo_attr).forEach(function (v) { addMappedTokenKey(next, 'kexo_attr', v); });
    });

    // Common kexo_attr flow uses variant key in URL and allowlist.
    allowlist.forEach(function (row) {
      var enabled = row && row.enabled != null ? Number(row.enabled) : 1;
      if (!isFinite(enabled) || enabled !== 0) {
        addMappedTokenKey(next, 'kexo_attr', row && row.variant_key);
      }
    });

    _state.mappedTokenKeys = next;
  }

  function isMappedObservedRow(row) {
    var k = tokenKey(row && row.token_type, row && row.token_value);
    if (!k) return false;
    return !!(_state.mappedTokenKeys && _state.mappedTokenKeys[k]);
  }

  function scrollToMappingFields() {
    var card = document.getElementById('am-create-mapping-card');
    if (card && typeof card.scrollIntoView === 'function') {
      try { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { try { card.scrollIntoView(); } catch (_) {} }
    }
    var focusEl = document.getElementById('am-variant-key') || document.getElementById('am-source-key');
    if (focusEl) {
      setTimeout(function () {
        try { focusEl.focus(); } catch (_) {}
      }, 180);
    }
  }

  function renderObservedTable(rows) {
    var body = document.getElementById('am-observed-body');
    if (!body) return;
    var list = Array.isArray(rows) ? rows.slice() : [];
    var showMappedEl = document.getElementById('am-show-mapped');
    var showMapped = !!(showMappedEl && showMappedEl.checked);
    if (!showMapped) list = list.filter(function (row) { return !isMappedObservedRow(row); });
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-secondary">' + (showMapped ? 'No observed tokens yet.' : 'No unmapped tokens found. Enable "Show mapped" to view already-mapped items.') + '</td></tr>';
      return;
    }
    body.innerHTML = list.map(function (r) {
      var t = r && r.token_type != null ? String(r.token_type) : '';
      var v = r && r.token_value != null ? String(r.token_value) : '';
      var seen = r && typeof r.seen_count === 'number' ? r.seen_count : (r && r.seen_count != null ? Number(r.seen_count) : 0);
      var last = r && r.last_seen_at != null ? Number(r.last_seen_at) : null;
      var lastTxt = last && isFinite(last) ? new Date(last).toLocaleString('en-GB') : '—';
      return '' +
        '<tr>' +
          '<td><code>' + escapeHtml(t || '—') + '</code></td>' +
          '<td class="text-break">' + escapeHtml(v || '—') + '</td>' +
          '<td class="text-end">' + escapeHtml(String(seen || 0)) + '</td>' +
          '<td>' + escapeHtml(lastTxt) + '</td>' +
          '<td class="text-end">' +
            '<button type="button" class="btn btn-sm btn-ghost-secondary" data-am-action="select-token" data-token-type="' + escapeHtml(trimLower(t, 48)) + '" data-token-value="' + escapeHtml(trimLower(v, 256)) + '">Use</button>' +
          '</td>' +
        '</tr>';
    }).join('');
  }

  function renderSelected() {
    var sel = _state.selected;
    var tokenEl = document.getElementById('am-selected-token');
    if (tokenEl) {
      if (!sel) tokenEl.value = 'Select a token above';
      else tokenEl.value = String(sel.token_type) + '=' + String(sel.token_value);
    }
  }

  function loadConfigAndRender() {
    setHint('am-config-msg', 'Loading…', true);
    return fetchConfig().then(function (payload) {
      if (!payload || payload.ok !== true) {
        _state.config = null;
        rebuildMappedTokenLookup({ channels: [], sources: [], variants: [], tags: [], rules: [], allowlist: [] });
        buildIconMetaMaps({ channels: [], sources: [], variants: [], tags: [], rules: [], allowlist: [] });
        renderVariantsDatalist([]);
        renderChannelsDatalist([]);
        renderSourcesDatalist([]);
        renderTagsDatalist([]);
        renderConfigText({ config: { channels: [], sources: [], variants: [], tags: [], rules: [], allowlist: [] } });
        if (_state.observed && _state.observed.length) renderObservedTable(_state.observed);
        updateSourceIconPreview();
        setHint('am-config-msg', 'Could not load config (will fail open).', false);
        return null;
      }
      _state.config = payload.config || null;
      rebuildMappedTokenLookup(payload.config || {});
      buildIconMetaMaps(payload.config || {});
      renderVariantsDatalist(variantsFromConfig(payload.config || {}));
      renderChannelsDatalist(channelsFromConfig(payload.config || {}));
      renderSourcesDatalist(sourcesFromConfig(payload.config || {}));
      renderTagsDatalist(tagsFromConfig(payload.config || {}));
      renderConfigText(payload);
      if (_state.observed && _state.observed.length) renderObservedTable(_state.observed);
      updateSourceIconPreview();
      setHint('am-config-msg', 'Loaded.', true);
      setTimeout(function () { setHint('am-config-msg', '', true); }, 1200);
      return payload;
    });
  }

  function loadObservedAndRender() {
    var tokenTypeEl = document.getElementById('am-token-type');
    var minSeenEl = document.getElementById('am-min-seen');
    var limitEl = document.getElementById('am-limit');
    var tokenType = tokenTypeEl ? trimLower(tokenTypeEl.value, 48) : '';
    var minSeen = clampInt(minSeenEl ? minSeenEl.value : null, 2, 1, 1000000);
    var limit = clampInt(limitEl ? limitEl.value : null, 500, 10, 5000);
    setHint('am-observed-msg', 'Loading…', true);
    return fetchObserved({ tokenType: tokenType, minSeen: minSeen, limit: limit }).then(function (payload) {
      if (!payload || payload.ok !== true) {
        _state.observed = [];
        renderObservedTable([]);
        setHint('am-observed-msg', 'Could not load observed tokens.', false);
        return null;
      }
      _state.observed = Array.isArray(payload.observed) ? payload.observed : [];
      renderObservedTable(_state.observed);
      setHint('am-observed-msg', 'Loaded.', true);
      setTimeout(function () { setHint('am-observed-msg', '', true); }, 1200);
      return payload;
    });
  }

  function readSelectedFromButton(btn) {
    var tokenType = trimLower(btn.getAttribute('data-token-type') || '', 48);
    var tokenValue = trimLower(btn.getAttribute('data-token-value') || '', 256);
    if (!tokenType || !tokenValue) return null;
    return { token_type: tokenType, token_value: tokenValue };
  }

  function maybeAutofillSourceKeyFromSelected(selected) {
    if (!selected || selected.token_type !== 'utm_source') return;
    var srcKeyEl = document.getElementById('am-source-key');
    if (!srcKeyEl) return;
    var current = '';
    try { current = String(srcKeyEl.value || '').trim(); } catch (_) { current = ''; }
    var prevAuto = '';
    try { prevAuto = String(srcKeyEl.getAttribute('data-am-autofill') || '').trim().toLowerCase(); } catch (_) { prevAuto = ''; }
    // Only overwrite if the field is empty OR it was previously auto-filled by a prior "Use" click.
    if (current && prevAuto !== 'utm_source') {
      try { updateSourceIconPreview(); } catch (_) {}
      return;
    }
    try {
      srcKeyEl.value = normalizeKeyLike(selected.token_value, 32);
      srcKeyEl.setAttribute('data-am-autofill', 'utm_source');
    } catch (_) {}
    try { updateSourceIconPreview(); } catch (_) {}
  }

  function maybeAutofillFromVariantKey() {
    var variantKeyEl = document.getElementById('am-variant-key');
    if (!variantKeyEl) return;
    var vKey = normalizeBaseVariantKey(variantKeyEl.value);
    if (!vKey) return;
    var meta = _state.variantMetaByKey && _state.variantMetaByKey[vKey] ? _state.variantMetaByKey[vKey] : null;
    if (!meta) return;

    var vLabelEl = document.getElementById('am-variant-label');
    var chEl = document.getElementById('am-channel-key');
    var srcEl = document.getElementById('am-source-key');

    var variantLabel = meta && meta.label != null ? String(meta.label).trim().slice(0, 120) : '';
    var channelKey = meta && meta.channel_key ? normalizeKeyLike(meta.channel_key, 32) : '';
    var sourceKey = meta && meta.source_key ? normalizeKeyLike(meta.source_key, 32) : '';

    function maybeFill(el, value, tag) {
      if (!el || !value) return;
      var current = '';
      try { current = String(el.value || '').trim(); } catch (_) { current = ''; }
      var prevAuto = '';
      try { prevAuto = String(el.getAttribute('data-am-autofill') || '').trim().toLowerCase(); } catch (_) { prevAuto = ''; }
      if (current && prevAuto !== String(tag).toLowerCase()) return;
      try {
        el.value = value;
        el.setAttribute('data-am-autofill', String(tag));
      } catch (_) {}
    }

    // Only overwrite if empty OR it was previously auto-filled by a prior variant match.
    maybeFill(vLabelEl, variantLabel, 'variant');
    maybeFill(chEl, channelKey, 'variant');

    // For Source, do not override a prior utm_source autofill or user edits.
    if (srcEl) {
      var srcCurrent = '';
      try { srcCurrent = String(srcEl.value || '').trim(); } catch (_) { srcCurrent = ''; }
      var srcPrevAuto = '';
      try { srcPrevAuto = String(srcEl.getAttribute('data-am-autofill') || '').trim().toLowerCase(); } catch (_) { srcPrevAuto = ''; }
      if (!srcCurrent || srcPrevAuto === 'variant') {
        maybeFill(srcEl, sourceKey, 'variant');
        try { updateSourceIconPreview(); } catch (_) {}
      }
    }
  }

  function initAttributionMappingSettings(opts) {
    var o = opts && typeof opts === 'object' ? opts : {};
    var rootId = o.rootId ? String(o.rootId) : 'settings-attribution-mapping-root';
    var root = document.getElementById(rootId);
    if (!root) return;
    if (root.getAttribute('data-kexo-am-bound') === '1') return;
    root.setAttribute('data-kexo-am-bound', '1');

    _state.rootId = rootId;
    _state.rootEl = root;
    _state.selected = null;
    _state.config = null;
    _state.observed = [];
    _state.mappedTokenKeys = {};

    renderSkeleton(root);
    if (typeof window.initKexoTooltips === 'function') window.initKexoTooltips(root);
    renderSelected();
    updateSourceIconPreview();
    updateIconInputPreview('am-source-icon-spec', 'am-source-icon-input-preview', 'Source icon');
    updateIconInputPreview('am-variant-icon-spec', 'am-variant-icon-input-preview', 'Variant icon');

    root.addEventListener('click', function (e) {
      var t = e && e.target ? e.target : null;
      var btn = t && t.closest ? t.closest('[data-am-action]') : null;
      if (!btn) return;
      var action = String(btn.getAttribute('data-am-action') || '').trim().toLowerCase();
      if (!action) return;
      e.preventDefault();

      if (action === 'refresh-observed') {
        loadObservedAndRender();
        return;
      }
      if (action === 'reload-config') {
        loadConfigAndRender();
        return;
      }
      if (action === 'select-token') {
        _state.selected = readSelectedFromButton(btn);
        maybeAutofillSourceKeyFromSelected(_state.selected);
        renderSelected();
        scrollToMappingFields();
        setHint('am-map-msg', '', true);
        return;
      }
      if (action === 'clear-selected') {
        _state.selected = null;
        renderSelected();
        setHint('am-map-msg', '', true);
        return;
      }
      if (action === 'save-config') {
        var ta = document.getElementById('am-config-json');
        var raw = ta ? String(ta.value || '') : '';
        var parsed = safeJsonParse(raw);
        if (!parsed || typeof parsed !== 'object') {
          setHint('am-config-msg', 'Invalid JSON.', false);
          return;
        }
        setHint('am-config-msg', 'Saving…', true);
        saveConfig(parsed).then(function (resp) {
          if (!resp || resp.ok !== true) {
            setHint('am-config-msg', resp && resp.status === 403 ? 'Admin only. You don\'t have permission to change attribution config.' : (resp && resp.error ? String(resp.error) : 'Failed to save config.'), false);
            return;
          }
          setHint('am-config-msg', 'Saved.', true);
          loadConfigAndRender();
        });
        return;
      }
      if (action === 'map-token') {
        var sel = _state.selected;
        if (!sel || !sel.token_type || !sel.token_value) {
          setHint('am-map-msg', 'Select an observed token first.', false);
          return;
        }
        var variantKeyEl = document.getElementById('am-variant-key');
        var prioEl = document.getElementById('am-priority');
        var tagEl = document.getElementById('am-tag-key');
        var vLabelEl = document.getElementById('am-variant-label');
        var chEl = document.getElementById('am-channel-key');
        var srcEl = document.getElementById('am-source-key');

        var variantKey = normalizeBaseVariantKey(variantKeyEl ? variantKeyEl.value : '');
        if (!variantKey) {
          setHint('am-map-msg', 'Variant key is required.', false);
          return;
        }
        var payload = {
          token_type: sel.token_type,
          token_value: sel.token_value,
          variant_key: variantKey,
          priority: clampInt(prioEl ? prioEl.value : null, 1000, -1000000, 1000000),
        };

        var tagKey = normalizeKeyLike(tagEl ? tagEl.value : '', 120);
        if (tagKey) payload.tag_key = tagKey;

        var variantLabel = vLabelEl ? String(vLabelEl.value || '').trim().slice(0, 120) : '';
        if (variantLabel) payload.variant_label = variantLabel;
        var channelKey = normalizeKeyLike(chEl ? chEl.value : '', 32);
        if (channelKey) payload.channel_key = channelKey;
        var sourceKey = normalizeKeyLike(srcEl ? srcEl.value : '', 32);
        if (sourceKey) payload.source_key = sourceKey;

        var srcIconEl = document.getElementById('am-source-icon-spec');
        var varIconEl = document.getElementById('am-variant-icon-spec');
        var srcIcon = srcIconEl ? String(srcIconEl.value || '').trim() : '';
        var varIcon = varIconEl ? String(varIconEl.value || '').trim() : '';
        if (srcIcon) payload.source_icon_spec = srcIcon;
        if (varIcon) payload.variant_icon_spec = varIcon;

        setHint('am-map-msg', 'Saving…', true);
        mapToken(payload).then(function (resp) {
          if (!resp || resp.ok !== true) {
            var err = resp && resp.status === 403 ? 'Admin only. You don\'t have permission to add mappings.' : (resp && resp.error ? String(resp.error) : 'Failed to map token.');
            setHint('am-map-msg', err, false);
            return;
          }
          setHint('am-map-msg', 'Mapped.', true);
          _state.selected = null;
          var srcIconEl = document.getElementById('am-source-icon-spec');
          var varIconEl = document.getElementById('am-variant-icon-spec');
          if (srcIconEl) { srcIconEl.value = ''; updateIconInputPreview('am-source-icon-spec', 'am-source-icon-input-preview', 'Source icon'); }
          if (varIconEl) { varIconEl.value = ''; updateIconInputPreview('am-variant-icon-spec', 'am-variant-icon-input-preview', 'Variant icon'); }
          renderSelected();
          loadConfigAndRender();
          loadObservedAndRender();
        });
        return;
      }
    });

    root.addEventListener('input', function (e) {
      var t = e && e.target ? e.target : null;
      if (!t) return;
      if (t.id === 'am-variant-key') {
        maybeAutofillFromVariantKey();
        return;
      }
      if (t.id === 'am-source-key') {
        // If the user edits this field, stop treating it as auto-filled.
        try { t.removeAttribute('data-am-autofill'); } catch (_) {}
        updateSourceIconPreview();
        return;
      }
      if (t.id === 'am-channel-key' || t.id === 'am-variant-label') {
        try { t.removeAttribute('data-am-autofill'); } catch (_) {}
        return;
      }
      if (t.id === 'am-source-icon-spec') {
        updateIconInputPreview('am-source-icon-spec', 'am-source-icon-input-preview', 'Source icon');
        return;
      }
      if (t.id === 'am-variant-icon-spec') {
        updateIconInputPreview('am-variant-icon-spec', 'am-variant-icon-input-preview', 'Variant icon');
        return;
      }
      if (t.id === 'am-show-mapped') {
        renderObservedTable(_state.observed);
        return;
      }
    });

    // Initial load (best-effort).
    Promise.resolve()
      .then(function () { return loadConfigAndRender(); })
      .then(function () { return loadObservedAndRender(); })
      .finally(function () {
        renderSelected();
      });
  }

  try { window.initAttributionMappingSettings = initAttributionMappingSettings; } catch (_) {}
})();

