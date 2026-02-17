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
    sourceMetaByKey: {}, // source_key -> { label, icon_spec }
    variantMetaByKey: {}, // variant_key -> { label, icon_spec }
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
      var key = normalizeVariantKey(row && (row.variant_key != null ? row.variant_key : row.key));
      var label = row && row.label != null ? String(row.label) : '';
      return { key: key, label: label };
    }).filter(function (it) { return it && it.key; });
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
      var key = normalizeVariantKey(r && (r.variant_key != null ? r.variant_key : r.key));
      if (!key) return;
      vMap[key] = {
        label: (r && r.label != null) ? String(r.label) : key,
        icon_spec: (r && r.icon_spec != null) ? String(r.icon_spec) : '',
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
        '<h4 class="mb-2" title="Tokens captured from visitor sessions (UTMs, referrer host, click IDs). Filter by type, set Min seen to hide rare values, then click Use to map a token to an attribution variant.">Observed tokens <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></h4>' +
        '<div class="row g-2 align-items-end">' +
          '<div class="col-12 col-md-3">' +
            '<label class="form-label" for="am-token-type" title="Filter the list: utm_source/medium/campaign, referrer_host, param_name (click IDs like gclid), param_pair, or kexo_attr (explicit URL param).">Token type <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
            '<select class="form-select" id="am-token-type">' +
              '<option value="">All</option>' +
              '<option value="utm_source">utm_source</option>' +
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
            '<label class="form-label" for="am-min-seen" title="Only show tokens seen at least this many times. Increase to focus on common traffic sources.">Min seen <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
            '<input class="form-control" id="am-min-seen" type="number" min="1" max="1000000" value="2" />' +
          '</div>' +
          '<div class="col-6 col-md-2">' +
            '<label class="form-label" for="am-limit" title="Max number of tokens to load. Higher values may be slower.">Limit <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
            '<input class="form-control" id="am-limit" type="number" min="10" max="5000" value="500" />' +
          '</div>' +
          '<div class="col-12 col-md-auto">' +
            '<button type="button" class="btn btn-outline-primary" data-am-action="refresh-observed" title="Reload observed tokens from the database.">Refresh</button>' +
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

      '<div class="card card-sm mb-3">' +
        '<div class="card-header"><h4 class="card-title mb-0" title="Map a selected token to an attribution variant. Sessions with that token will be attributed to the variant (Channel + Source + Ownership).">Create mapping <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></h4></div>' +
        '<div class="card-body">' +
          '<div class="row g-2">' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" title="The token you selected from the table. Click Use on a row above to select.">Token <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<input class="form-control" id="am-selected-token" type="text" value="Select a token above" readonly />' +
            '</div>' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-variant-key" title="Format: source:ownership (e.g. google_ads:house, my_affiliate:affiliate). Use built-ins like google_ads:house or create custom keys.">Variant key <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-variant-key" list="am-variants-list" placeholder="e.g. google_ads:house" />' +
              '<datalist id="am-variants-list"></datalist>' +
            '</div>' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-priority" title="Rule priority (lower = higher). Rules are evaluated in priority order; first match wins.">Priority <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<input class="form-control" id="am-priority" type="number" value="1000" min="-1000000" max="1000000" />' +
            '</div>' +

            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-variant-label" title="Human-readable label for the variant (e.g. Google Ads). Shown in Acquisition reports.">Variant label (optional) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<input class="form-control" id="am-variant-label" type="text" placeholder="e.g. Google Ads" />' +
            '</div>' +
            '<div class="col-6 col-md-2">' +
              '<label class="form-label" for="am-channel-key" title="High-level channel: paid_search, organic_search, email, affiliate, direct, other.">Channel <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-channel-key" type="text" placeholder="paid_search" />' +
            '</div>' +
            '<div class="col-6 col-md-2">' +
              '<label class="form-label" for="am-source-key" title="Traffic source: google, bing, meta, omnisend, direct, other.">Source <span id="am-source-icon-preview" class="ms-1" aria-hidden="true"></span> <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<input class="form-control font-monospace" id="am-source-key" type="text" placeholder="google" />' +
            '</div>' +
            '<div class="col-12 col-md-4">' +
              '<label class="form-label" for="am-owner-kind" title="house (owned), partner (co-marketing), or affiliate (third-party). Affects reporting and fraud signals.">Ownership <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<select class="form-select" id="am-owner-kind">' +
                '<option value="house" selected>house</option>' +
                '<option value="partner">partner</option>' +
                '<option value="affiliate">affiliate</option>' +
              '</select>' +
            '</div>' +

            '<div class="col-12 col-md-6">' +
              '<label class="form-label" for="am-source-icon-spec" title="Optional: seed the source icon (icon_spec) only if it is blank. This will not overwrite an existing icon.">Source icon (optional, set if blank) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<textarea class="form-control font-monospace" id="am-source-icon-spec" rows="2" spellcheck="false" placeholder="fa-brands fa-google  OR  /assets/icon.png  OR  <svg ...>"></textarea>' +
              '<div class="form-hint small">Only applied when the source has no icon yet.</div>' +
              '<div id="am-source-icon-input-preview" class="am-map-icon-live-preview mt-1"></div>' +
            '</div>' +
            '<div class="col-12 col-md-6">' +
              '<label class="form-label" for="am-variant-icon-spec" title="Optional: seed the variant icon (icon_spec) only if it is blank. This will not overwrite an existing icon.">Variant icon (optional, set if blank) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></label>' +
              '<textarea class="form-control font-monospace" id="am-variant-icon-spec" rows="2" spellcheck="false" placeholder="fa-solid fa-bolt  OR  /assets/icon.png  OR  <svg ...>"></textarea>' +
              '<div class="form-hint small">Only applied when the variant has no icon yet. Leaving blank is fine.</div>' +
              '<div id="am-variant-icon-input-preview" class="am-map-icon-live-preview mt-1"></div>' +
            '</div>' +
          '</div>' +
          '<div class="d-flex align-items-center gap-2 flex-wrap mt-3">' +
            '<button type="button" class="btn btn-primary" data-am-action="map-token" title="Save this rule. New sessions with the token will be attributed to the variant.">Create mapping</button>' +
            '<button type="button" class="btn btn-outline-secondary" data-am-action="clear-selected" title="Deselect the current token.">Clear</button>' +
            '<span id="am-map-msg" class="form-hint"></span>' +
          '</div>' +
          '<div class="text-secondary small mt-2">' +
            '<div><strong>Note:</strong> mapping <code>kexo_attr</code> adds the variant to the allowlist (explicit param only wins when allowlisted).</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<details class="mb-0">' +
        '<summary class="text-secondary" title="Edit the raw config (channels, sources, variants, rules, allowlist). Use Reload to discard edits, Save config to apply.">Advanced: edit full config (JSON) <i class="fa-thin fa-circle-info text-secondary ms-1 am-tooltip-cue" style="font-size:0.85em" aria-hidden="true"></i></summary>' +
        '<div class="mt-2">' +
          '<textarea class="form-control font-monospace" id="am-config-json" rows="14" spellcheck="false" placeholder="{\\n  &quot;channels&quot;: [],\\n  &quot;sources&quot;: [],\\n  &quot;variants&quot;: [],\\n  &quot;rules&quot;: [],\\n  &quot;allowlist&quot;: []\\n}"></textarea>' +
          '<div class="d-flex align-items-center gap-2 flex-wrap mt-2">' +
            '<button type="button" class="btn btn-outline-primary" data-am-action="reload-config" title="Discard JSON edits and reload from database.">Reload</button>' +
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

  function renderConfigText(cfg) {
    var ta = document.getElementById('am-config-json');
    if (!ta) return;
    var configObj = cfg && cfg.config ? cfg.config : (cfg && cfg.ok && cfg.config ? cfg.config : (cfg && cfg.config ? cfg.config : cfg));
    if (cfg && cfg.ok === true && cfg.config) configObj = cfg.config;
    if (cfg && cfg.ok === true && cfg.config == null && cfg.config !== false && cfg.config !== 0) configObj = cfg.config;
    if (!configObj || typeof configObj !== 'object') configObj = { channels: [], sources: [], variants: [], rules: [], allowlist: [] };
    try {
      ta.value = JSON.stringify(configObj, null, 2);
    } catch (_) {
      ta.value = '';
    }
  }

  function renderObservedTable(rows) {
    var body = document.getElementById('am-observed-body');
    if (!body) return;
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="text-secondary">No observed tokens yet.</td></tr>';
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
            '<button type="button" class="btn btn-sm btn-outline-secondary" data-am-action="select-token" data-token-type="' + escapeHtml(trimLower(t, 48)) + '" data-token-value="' + escapeHtml(trimLower(v, 256)) + '">Use</button>' +
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
        buildIconMetaMaps({ channels: [], sources: [], variants: [], rules: [], allowlist: [] });
        renderVariantsDatalist([]);
        renderConfigText({ config: { channels: [], sources: [], variants: [], rules: [], allowlist: [] } });
        updateSourceIconPreview();
        setHint('am-config-msg', 'Could not load config (will fail open).', false);
        return null;
      }
      _state.config = payload.config || null;
      buildIconMetaMaps(payload.config || {});
      renderVariantsDatalist(variantsFromConfig(payload.config || {}));
      renderConfigText(payload);
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

  var _amTooltipTimer = null;
  var _amTooltipEl = null;
  var _amTooltipCurrentEl = null;

  function initAmTooltips(root) {
    if (!root || !root.querySelector) return;
    root.classList.add('am-has-tooltips');
    if (!document.getElementById('am-tooltip-styles')) {
      var s = document.createElement('style');
      s.id = 'am-tooltip-styles';
      s.textContent = '.am-has-tooltips [title], .am-has-tooltips [data-am-title] { cursor: help; }';
      document.head.appendChild(s);
    }
    if (!_amTooltipEl) {
      _amTooltipEl = document.createElement('div');
      _amTooltipEl.id = 'am-tooltip-popup';
      _amTooltipEl.setAttribute('role', 'tooltip');
      _amTooltipEl.style.cssText = 'position:fixed;z-index:9999;max-width:320px;padding:8px 10px;background:#1e293b;color:#e2e8f0;font-size:13px;line-height:1.4;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.25);pointer-events:none;opacity:0;transition:opacity 0.15s ease;';
      document.body.appendChild(_amTooltipEl);
    }
    function restoreCurrent() {
      if (_amTooltipCurrentEl && _amTooltipCurrentEl.getAttribute('data-am-title')) {
        _amTooltipCurrentEl.setAttribute('title', _amTooltipCurrentEl.getAttribute('data-am-title'));
        _amTooltipCurrentEl.removeAttribute('data-am-title');
      }
      _amTooltipCurrentEl = null;
    }
    function show(el) {
      var title = el && el.getAttribute ? el.getAttribute('title') : '';
      if (!title) return;
      restoreCurrent();
      _amTooltipEl.textContent = title;
      el.setAttribute('data-am-title', title);
      el.removeAttribute('title');
      _amTooltipCurrentEl = el;
      _amTooltipEl.style.opacity = '1';
      var rect = el.getBoundingClientRect();
      var ttRect = _amTooltipEl.getBoundingClientRect();
      var top = rect.top - ttRect.height - 6;
      var left = rect.left + (rect.width / 2) - (ttRect.width / 2);
      if (top < 8) top = rect.bottom + 6;
      if (left < 8) left = 8;
      if (left + ttRect.width > window.innerWidth - 8) left = window.innerWidth - ttRect.width - 8;
      _amTooltipEl.style.top = top + 'px';
      _amTooltipEl.style.left = left + 'px';
    }
    function hide() {
      restoreCurrent();
      _amTooltipEl.style.opacity = '0';
    }
    function findTitleTarget(el) {
      for (var n = el; n && n !== root; n = n.parentNode) {
        if (n.getAttribute && n.getAttribute('title')) return n;
      }
      return null;
    }
    root.addEventListener('mouseenter', function (e) {
      var target = findTitleTarget(e.target);
      if (!target) return;
      clearTimeout(_amTooltipTimer);
      _amTooltipTimer = setTimeout(function () { show(target); }, 200);
    }, true);
    root.addEventListener('mouseleave', function (e) {
      clearTimeout(_amTooltipTimer);
      _amTooltipTimer = null;
      hide();
    }, true);
    root.addEventListener('focusin', function (e) {
      var target = findTitleTarget(e.target);
      if (!target) return;
      clearTimeout(_amTooltipTimer);
      _amTooltipTimer = setTimeout(function () { show(target); }, 150);
    }, true);
    root.addEventListener('focusout', function (e) {
      clearTimeout(_amTooltipTimer);
      _amTooltipTimer = null;
      hide();
    }, true);
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

    renderSkeleton(root);
    initAmTooltips(root);
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
        renderSelected();
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
        var vLabelEl = document.getElementById('am-variant-label');
        var chEl = document.getElementById('am-channel-key');
        var srcEl = document.getElementById('am-source-key');
        var ownerEl = document.getElementById('am-owner-kind');

        var variantKey = normalizeVariantKey(variantKeyEl ? variantKeyEl.value : '');
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

        var variantLabel = vLabelEl ? String(vLabelEl.value || '').trim().slice(0, 120) : '';
        if (variantLabel) payload.variant_label = variantLabel;
        var channelKey = normalizeKeyLike(chEl ? chEl.value : '', 32);
        if (channelKey) payload.channel_key = channelKey;
        var sourceKey = normalizeKeyLike(srcEl ? srcEl.value : '', 32);
        if (sourceKey) payload.source_key = sourceKey;
        var ownerKind = trimLower(ownerEl ? ownerEl.value : '', 32);
        if (ownerKind) payload.owner_kind = ownerKind;

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
          // Refresh both lists (best-effort).
          loadConfigAndRender();
          loadObservedAndRender();
        });
        return;
      }
    });

    root.addEventListener('input', function (e) {
      var t = e && e.target ? e.target : null;
      if (!t) return;
      if (t.id === 'am-source-key') {
        updateSourceIconPreview();
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

