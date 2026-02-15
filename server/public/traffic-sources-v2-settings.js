/**
 * Settings → Sources (v2)
 *
 * Variants-style rule editor backed by /api/settings (trafficSourcesConfig)
 * + /api/traffic-sources-v2/* endpoints (suggestions/diagnostics).
 */
(function () {
  'use strict';

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

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj || null)); } catch (_) { return null; }
  }

  function normalizeKeyLike(s) {
    var raw = s == null ? '' : String(s);
    var out = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
    return out;
  }

  function normalizeTokenListFromText(rawText) {
    var raw = rawText == null ? '' : String(rawText);
    var parts = raw.split(/[,|\n\r]+/g).map(function (s) { return (s || '').trim(); }).filter(Boolean);
    var seen = new Set();
    var out = [];
    parts.forEach(function (p) {
      var t = p.toLowerCase().replace(/\s+/g, ' ').slice(0, 256);
      if (!t) return;
      if (seen.has(t)) return;
      seen.add(t);
      out.push(t);
    });
    return out;
  }

  function tokenListToText(list) {
    var arr = Array.isArray(list) ? list : [];
    return arr.map(function (s) { return String(s || '').trim(); }).filter(Boolean).join(', ');
  }

  function looksLikeUrl(s) {
    var v = (s || '').trim();
    return /^https?:\/\//i.test(v) || /^\/\//.test(v) || v[0] === '/';
  }

  function looksLikeSvg(s) {
    var v = (s || '').trim();
    return /^<svg[\s>]/i.test(v);
  }

  function renderIconSpecHtml(iconSpec, label) {
    var spec = (iconSpec || '').trim();
    var safeLabel = label ? String(label) : '';
    var t = safeLabel ? ' title="' + escapeHtml(safeLabel) + '"' : '';
    if (!spec) return '<span class="tsv2-icon-preview tsv2-icon-empty"' + t + ' aria-hidden="true"></span>';
    if (looksLikeSvg(spec)) {
      // Best-effort: server also validates on save.
      return '<span class="tsv2-icon-preview tsv2-icon-svg"' + t + ' aria-hidden="true">' + spec + '</span>';
    }
    if (looksLikeUrl(spec)) {
      return '<img class="tsv2-icon-preview tsv2-icon-img" src="' + escapeHtml(spec) + '" alt="' + escapeHtml(safeLabel) + '" width="20" height="20"' + t + '>';
    }
    return '<i class="tsv2-icon-preview tsv2-icon-fa ' + escapeHtml(spec) + '"' + t + ' aria-hidden="true"></i>';
  }

  function fetchSettings() {
    return fetch(API + '/api/settings', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function saveTrafficSourcesConfig(cfg) {
    return fetch(API + '/api/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trafficSourcesConfig: cfg }),
    }).then(function (r) { return r.json(); });
  }

  function fetchSuggestions(params) {
    var p = params || {};
    var sinceDays = clampInt(p.sinceDays, 30, 1, 365);
    var url = API + '/api/traffic-sources-v2/suggestions?sinceDays=' + encodeURIComponent(String(sinceDays));
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function applySuggestions(seedSources) {
    return fetch(API + '/api/traffic-sources-v2/suggestions/apply', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedSources: seedSources || [] }),
    }).then(function (r) { return r.ok ? r.json() : r.json().catch(function () { return null; }); });
  }

  function fetchDiagnostics(params) {
    var p = params || {};
    var sinceDays = clampInt(p.sinceDays, 30, 1, 365);
    var url = API + '/api/traffic-sources-v2/diagnostics?sinceDays=' + encodeURIComponent(String(sinceDays));
    return fetch(url, { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function makeId(prefix) {
    var p = prefix || 'id';
    var rand = Math.random().toString(16).slice(2, 10);
    return p + '_' + Date.now().toString(36) + '_' + rand;
  }

  var RULE_FIELDS = [
    { key: 'source_kind', label: 'source_kind' },
    { key: 'affiliate_network_hint', label: 'affiliate_network_hint' },
    { key: 'affiliate_id_hint', label: 'affiliate_id_hint' },
    { key: 'param_names', label: 'param_names (query keys + click-id keys)' },
    { key: 'param_pairs', label: 'param_pairs (key=value from entry_url)' },
    { key: 'utm_source', label: 'utm_source' },
    { key: 'utm_medium', label: 'utm_medium' },
    { key: 'utm_campaign', label: 'utm_campaign' },
    { key: 'utm_content', label: 'utm_content' },
    { key: 'utm_term', label: 'utm_term' },
    { key: 'referrer_host', label: 'referrer_host' },
    { key: 'traffic_source_key_v1', label: 'traffic_source_key_v1 (legacy)' },
  ];

  function readConfigFromDom(root) {
    var cfg = { v: 1, sources: [] };
    var sourceEls = root.querySelectorAll('[data-tsv2-source]');
    sourceEls.forEach(function (srcEl, idx) {
      var labelEl = srcEl.querySelector('[data-field="source-label"]');
      var keyEl = srcEl.querySelector('[data-field="source-key"]');
      var enabledEl = srcEl.querySelector('[data-field="source-enabled"]');
      var orderEl = srcEl.querySelector('[data-field="source-order"]');
      var iconEl = srcEl.querySelector('[data-field="source-iconSpec"]');
      var keyRaw = keyEl ? String(keyEl.value || '') : '';
      var key = normalizeKeyLike(keyRaw) || ('source_' + (idx + 1));
      var label = labelEl ? String(labelEl.value || '').trim() : '';
      var enabled = enabledEl ? !!enabledEl.checked : true;
      var order = orderEl ? clampInt(orderEl.value, idx + 1, 0, 999999) : (idx + 1);
      var iconSpec = iconEl ? String(iconEl.value || '').trim() : '';
      var out = { key: key, label: label, enabled: enabled, order: order, iconSpec: iconSpec, rules: [] };

      var ruleEls = srcEl.querySelectorAll('[data-tsv2-rule]');
      ruleEls.forEach(function (ruleEl, rIdx) {
        var ridEl = ruleEl.querySelector('[data-field="rule-id"]');
        var rlabelEl = ruleEl.querySelector('[data-field="rule-label"]');
        var renEl = ruleEl.querySelector('[data-field="rule-enabled"]');
        var rid = ridEl ? String(ridEl.value || '').trim() : '';
        if (!rid) rid = makeId('rule');
        var rlabel = rlabelEl ? String(rlabelEl.value || '').trim() : ('Rule ' + (rIdx + 1));
        var renabled = renEl ? !!renEl.checked : true;
        var when = {};
        RULE_FIELDS.forEach(function (f) {
          var anyEl = ruleEl.querySelector('[data-cond-field="' + f.key + '"][data-cond-kind="any"]');
          var noneEl = ruleEl.querySelector('[data-cond-field="' + f.key + '"][data-cond-kind="none"]');
          var anyList = normalizeTokenListFromText(anyEl ? anyEl.value : '');
          var noneList = normalizeTokenListFromText(noneEl ? noneEl.value : '');
          if (anyList.length || noneList.length) when[f.key] = { any: anyList, none: noneList };
        });
        out.rules.push({ id: rid, label: rlabel, enabled: renabled, when: when });
      });

      cfg.sources.push(out);
    });
    return cfg;
  }

  function renderSourcesHtml(cfg) {
    var sources = (cfg && Array.isArray(cfg.sources)) ? cfg.sources : [];
    if (!sources.length) {
      return '<div class="text-secondary">No sources yet. Click <strong>Add source</strong> to create one, or use <strong>Suggestions</strong>.</div>';
    }

    function fieldRow(fieldKey, fieldLabel, anyVal, noneVal) {
      return '' +
        '<tr>' +
          '<td class="text-nowrap"><code>' + escapeHtml(fieldLabel || fieldKey) + '</code></td>' +
          '<td><textarea class="form-control font-monospace tsv2-cond" rows="1" data-cond-field="' + escapeHtml(fieldKey) + '" data-cond-kind="any" placeholder="comma-separated tokens">' + escapeHtml(anyVal || '') + '</textarea></td>' +
          '<td><textarea class="form-control font-monospace tsv2-cond" rows="1" data-cond-field="' + escapeHtml(fieldKey) + '" data-cond-kind="none" placeholder="comma-separated tokens">' + escapeHtml(noneVal || '') + '</textarea></td>' +
        '</tr>';
    }

    function renderRule(rule, ruleIdx) {
      var r = rule || {};
      var when = (r.when && typeof r.when === 'object') ? r.when : {};
      var rows = RULE_FIELDS.map(function (f) {
        var cond = when[f.key] || {};
        var anyText = tokenListToText(cond.any);
        var noneText = tokenListToText(cond.none);
        return fieldRow(f.key, f.label, anyText, noneText);
      }).join('');
      var rid = (r.id || '');
      return '' +
        '<div class="card card-sm mb-2" data-tsv2-rule data-rule-idx="' + ruleIdx + '">' +
          '<div class="card-body">' +
            '<div class="d-flex align-items-center gap-2 flex-wrap mb-2">' +
              '<input type="text" class="form-control form-control-sm font-monospace tsv2-rule-id" style="max-width:220px" data-field="rule-id" value="' + escapeHtml(rid) + '" placeholder="rule id" />' +
              '<input type="text" class="form-control form-control-sm flex-fill" data-field="rule-label" value="' + escapeHtml(r.label || '') + '" placeholder="Rule label" />' +
              '<label class="form-check form-check-inline mb-0">' +
                '<input class="form-check-input" type="checkbox" data-field="rule-enabled" ' + ((r.enabled === false) ? '' : 'checked') + '>' +
                '<span class="form-check-label">Enabled</span>' +
              '</label>' +
              '<button type="button" class="btn btn-outline-danger btn-sm" data-action="delete-rule">Delete rule</button>' +
            '</div>' +
            '<div class="table-responsive">' +
              '<table class="table table-sm table-vcenter mb-0">' +
                '<thead><tr><th style="width:220px">Field</th><th>Include (any)</th><th>Exclude (none)</th></tr></thead>' +
                '<tbody>' + rows + '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    function renderSource(src, idx) {
      var s = src || {};
      var iconPreview = renderIconSpecHtml(s.iconSpec || '', s.label || s.key || '');
      var rules = Array.isArray(s.rules) ? s.rules : [];
      var rulesHtml = rules.map(renderRule).join('') || '<div class="text-secondary">No rules yet. Click <strong>Add rule</strong>.</div>';
      return '' +
        '<div class="card mb-3" data-tsv2-source data-source-idx="' + idx + '">' +
          '<div class="card-body">' +
            '<div class="d-flex align-items-center gap-2 flex-wrap mb-3">' +
              iconPreview +
              '<input type="text" class="form-control" data-field="source-label" value="' + escapeHtml(s.label || '') + '" placeholder="Source label" />' +
              '<input type="text" class="form-control font-monospace" style="max-width:240px" data-field="source-key" value="' + escapeHtml(s.key || '') + '" placeholder="source_key" />' +
              '<input type="number" class="form-control" style="max-width:110px" data-field="source-order" value="' + escapeHtml(String(s.order != null ? s.order : (idx + 1))) + '" title="Order" />' +
              '<label class="form-check form-check-inline mb-0">' +
                '<input class="form-check-input" type="checkbox" data-field="source-enabled" ' + ((s.enabled === false) ? '' : 'checked') + '>' +
                '<span class="form-check-label">Enabled</span>' +
              '</label>' +
              '<button type="button" class="btn btn-outline-danger btn-sm" data-action="delete-source">Delete source</button>' +
            '</div>' +

            '<div class="row g-2 mb-3">' +
              '<div class="col-12 col-lg-8">' +
                '<label class="form-label mb-1">Icon (Font Awesome classes, inline SVG, or image URL)</label>' +
                '<textarea class="form-control font-monospace" rows="2" data-field="source-iconSpec" placeholder="fa-brands fa-google OR &lt;svg&gt;...&lt;/svg&gt; OR https://...">' + escapeHtml(s.iconSpec || '') + '</textarea>' +
              '</div>' +
              '<div class="col-12 col-lg-4">' +
                '<label class="form-label mb-1">&nbsp;</label>' +
                '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                  '<button type="button" class="btn btn-outline-secondary" data-action="upload-icon">Upload image</button>' +
                  '<input type="file" class="d-none" accept="image/png,image/webp,image/jpeg,image/jpg,image/x-icon,image/vnd.microsoft.icon" data-field="icon-file" />' +
                  '<button type="button" class="btn btn-outline-secondary" data-action="refresh-icon-preview">Refresh preview</button>' +
                '</div>' +
                '<div class="form-hint mt-2">Uploads use slot <code>other</code> and return a URL.</div>' +
              '</div>' +
            '</div>' +

            '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">' +
              '<h4 class="mb-0">Rules</h4>' +
              '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                '<button type="button" class="btn btn-outline-primary btn-sm" data-action="add-rule">Add rule</button>' +
              '</div>' +
            '</div>' +
            rulesHtml +
          '</div>' +
        '</div>';
    }

    return sources.map(renderSource).join('');
  }

  function renderRootSkeletonHtml() {
    return '' +
      '<div class="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">' +
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
          '<button type="button" class="btn btn-outline-primary" data-action="add-source">Add source</button>' +
          '<button type="button" class="btn btn-outline-primary" data-action="open-suggestions">Suggestions</button>' +
          '<button type="button" class="btn btn-outline-primary" data-action="open-diagnostics">Diagnostics</button>' +
          '<button type="button" class="btn btn-outline-secondary" data-action="open-legacy-v1">Legacy (v1)</button>' +
          '<button type="button" class="btn btn-outline-danger" data-action="reset-defaults">Reset defaults</button>' +
        '</div>' +
        '<div class="d-flex align-items-center gap-2 flex-wrap">' +
          '<button type="button" class="btn btn-success" data-action="save-config">Save</button>' +
        '</div>' +
      '</div>' +
      '<div class="form-hint mb-3" data-tsv2-msg></div>' +
      '<div data-tsv2-sources>' +
        '<div class="dm-loading-spinner"><div class="report-build-wrap"><div class="spinner-border text-primary" role="status"></div><div class="report-build-title">Loading sources…</div></div></div>' +
      '</div>' +
      '<div class="modal fade" tabindex="-1" data-tsv2-modal="suggestions" aria-hidden="true">' +
        '<div class="modal-dialog modal-xl modal-dialog-scrollable">' +
          '<div class="modal-content">' +
            '<div class="modal-header"><h3 class="modal-title">Source suggestions</h3><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
            '<div class="modal-body">' +
              '<div class="text-secondary mb-2">These are auto-generated suggestions from recent sessions and affiliate attribution evidence. Nothing is applied until you click Apply.</div>' +
              '<div data-tsv2-suggestions-body class="dm-json-pre" style="white-space:normal">Loading…</div>' +
            '</div>' +
            '<div class="modal-footer d-flex justify-content-between flex-wrap gap-2">' +
              '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                '<label class="form-label mb-0">Since days</label>' +
                '<input type="number" class="form-control" style="max-width:110px" data-field="suggestions-sinceDays" value="30" min="1" max="365" />' +
                '<button type="button" class="btn btn-outline-secondary" data-action="refresh-suggestions">Refresh</button>' +
              '</div>' +
              '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                '<button type="button" class="btn btn-primary" data-action="apply-suggestions" disabled>Apply selected</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="modal fade" tabindex="-1" data-tsv2-modal="diagnostics" aria-hidden="true">' +
        '<div class="modal-dialog modal-lg modal-dialog-scrollable">' +
          '<div class="modal-content">' +
            '<div class="modal-header"><h3 class="modal-title">Source diagnostics</h3><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
            '<div class="modal-body"><div data-tsv2-diagnostics-body class="dm-json-pre" style="white-space:normal">Loading…</div></div>' +
            '<div class="modal-footer d-flex justify-content-between flex-wrap gap-2">' +
              '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                '<label class="form-label mb-0">Since days</label>' +
                '<input type="number" class="form-control" style="max-width:110px" data-field="diagnostics-sinceDays" value="30" min="1" max="365" />' +
                '<button type="button" class="btn btn-outline-secondary" data-action="refresh-diagnostics">Refresh</button>' +
              '</div>' +
              '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function initTrafficSourcesV2Settings(opts) {
    var rootId = opts && opts.rootId ? String(opts.rootId) : 'settings-traffic-source-mapping-root';
    var root = document.getElementById(rootId);
    if (!root) return;
    if (root.getAttribute('data-tsv2-init') === '1') return;
    root.setAttribute('data-tsv2-init', '1');

    root.classList.add('tsv2-root');
    root.innerHTML = renderRootSkeletonHtml();

    var msgEl = root.querySelector('[data-tsv2-msg]');
    var sourcesEl = root.querySelector('[data-tsv2-sources]');
    var draft = null;
    var suggestionsPayload = null;

    function setMsg(text, ok) {
      if (!msgEl) return;
      msgEl.textContent = text || '';
      if (ok === true) msgEl.className = 'form-hint mb-3 text-success';
      else if (ok === false) msgEl.className = 'form-hint mb-3 text-danger';
      else msgEl.className = 'form-hint mb-3 text-secondary';
    }

    function renderSources() {
      if (!sourcesEl) return;
      sourcesEl.innerHTML = renderSourcesHtml(draft || { v: 1, sources: [] });
    }

    function loadInitialConfig() {
      var initial = opts && opts.initialConfig ? deepClone(opts.initialConfig) : null;
      if (initial && initial.v === 1) {
        draft = initial;
        renderSources();
        return Promise.resolve();
      }
      return fetchSettings().then(function (data) {
        if (!data || !data.ok) throw new Error('Failed to load settings');
        draft = deepClone(data.trafficSourcesConfig || { v: 1, sources: [] }) || { v: 1, sources: [] };
        renderSources();
      }).catch(function (err) {
        setMsg(err && err.message ? String(err.message) : 'Failed to load sources', false);
        draft = { v: 1, sources: [] };
        renderSources();
      });
    }

    function refreshIconPreviewForSource(sourceEl) {
      if (!sourceEl) return;
      var iconEl = sourceEl.querySelector('[data-field="source-iconSpec"]');
      var labelEl = sourceEl.querySelector('[data-field="source-label"]');
      var preview = sourceEl.querySelector('.tsv2-icon-preview');
      if (!preview) return;
      var spec = iconEl ? String(iconEl.value || '').trim() : '';
      var lbl = labelEl ? String(labelEl.value || '').trim() : '';
      preview.outerHTML = renderIconSpecHtml(spec, lbl);
    }

    function uploadIconForSource(sourceEl, file) {
      if (!sourceEl || !file) return Promise.reject(new Error('Missing file'));
      var fd = new FormData();
      fd.append('file', file);
      var url = API + '/api/assets/upload?slot=other';
      return fetch(url, { method: 'POST', credentials: 'same-origin', body: fd })
        .then(function (r) { return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, json: j }; }); })
        .then(function (res) {
          if (!res || !res.json || res.json.ok !== true || !res.json.url) {
            var err = res && res.json && res.json.error ? String(res.json.error) : 'Upload failed';
            throw new Error(err);
          }
          var iconEl = sourceEl.querySelector('[data-field="source-iconSpec"]');
          if (iconEl) iconEl.value = String(res.json.url);
          refreshIconPreviewForSource(sourceEl);
          return res.json.url;
        });
    }

    function openModal(name) {
      var el = root.querySelector('[data-tsv2-modal="' + name + '"]');
      if (!el || typeof bootstrap === 'undefined') return null;
      var m = bootstrap.Modal.getOrCreateInstance(el);
      m.show();
      return m;
    }

    function renderSuggestionsPayload(payload) {
      var body = root.querySelector('[data-tsv2-suggestions-body]');
      var applyBtn = root.querySelector('[data-action="apply-suggestions"]');
      if (!body) return;
      suggestionsPayload = payload;
      if (!payload) {
        body.innerHTML = '<div class="text-secondary">Loading…</div>';
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      if (payload.ok !== true) {
        body.innerHTML = '<div class="text-danger">Failed to load suggestions.</div>';
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      var list = Array.isArray(payload.suggestions) ? payload.suggestions : [];
      if (!list.length) {
        body.innerHTML = '<div class="text-secondary">No suggestions found for this range.</div>';
        if (applyBtn) applyBtn.disabled = true;
        return;
      }
      var html = '' +
        '<div class="list-group">';
      list.forEach(function (sug, idx) {
        var label = sug && sug.label ? String(sug.label) : ('Suggestion ' + (idx + 1));
        var id = sug && sug.id ? String(sug.id) : ('sug-' + idx);
        var stats = sug && sug.stats ? sug.stats : null;
        var statText = stats ? (' · ' + (stats.sessions || 0) + ' sessions' + (stats.converted ? (', ' + stats.converted + ' converted') : '')) : '';
        html += '' +
          '<label class="list-group-item d-flex align-items-start gap-2">' +
            '<input class="form-check-input mt-1" type="checkbox" data-suggestion-id="' + escapeHtml(id) + '">' +
            '<div class="flex-fill">' +
              '<div class="fw-semibold">' + escapeHtml(label) + '<span class="text-secondary fw-normal">' + escapeHtml(statText) + '</span></div>' +
              '<div class="text-secondary small">' + escapeHtml(id) + '</div>' +
            '</div>' +
          '</label>';
      });
      html += '</div>';
      html += '<hr class="my-3">';
      html += '<div class="text-secondary small">Top observed UTM tokens (for manual mapping):</div>';
      var tokens = Array.isArray(payload.tokens) ? payload.tokens.slice(0, 30) : [];
      if (tokens.length) {
        html += '<ul class="mt-2 mb-0 small">';
        tokens.forEach(function (t) {
          html += '<li><code>' + escapeHtml(t.utm_param) + '</code>=' + escapeHtml(t.utm_value) + ' <span class="text-secondary">(' + escapeHtml(String(t.seen_count || 0)) + ')</span></li>';
        });
        html += '</ul>';
      } else {
        html += '<div class="text-secondary small mt-2">No recent tokens.</div>';
      }
      body.innerHTML = html;

      if (applyBtn) {
        applyBtn.disabled = true;
        body.querySelectorAll('input[type="checkbox"][data-suggestion-id]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            var any = body.querySelector('input[type="checkbox"][data-suggestion-id]:checked');
            applyBtn.disabled = !any;
          });
        });
      }
    }

    function renderDiagnosticsPayload(payload) {
      var body = root.querySelector('[data-tsv2-diagnostics-body]');
      if (!body) return;
      if (!payload) {
        body.innerHTML = '<div class="text-secondary">Loading…</div>';
        return;
      }
      if (payload.ok !== true) {
        body.innerHTML = '<div class="text-danger">Failed to load diagnostics.</div>';
        return;
      }
      var totals = payload.totals || {};
      var bySource = Array.isArray(payload.bySource) ? payload.bySource : [];
      var unmatchedTop = Array.isArray(payload.unmatchedTop) ? payload.unmatchedTop : [];
      var html = '' +
        '<div class="mb-3">' +
          '<div><strong>Total sessions</strong> ' + escapeHtml(String(totals.totalSessions || 0)) + '</div>' +
          '<div><strong>Matched</strong> ' + escapeHtml(String(totals.matchedSessions || 0)) + '</div>' +
          '<div><strong>Unmatched</strong> ' + escapeHtml(String(totals.unmatchedSessions || 0)) + '</div>' +
        '</div>';

      if (!bySource.length) {
        html += '<div class="text-secondary mb-3">No matched sessions in this window.</div>';
      } else {
        html += '<div class="table-responsive mb-3"><table class="table table-sm table-vcenter">' +
          '<thead><tr><th>Source</th><th class="text-end">Sessions</th><th class="text-end">Converted</th></tr></thead><tbody>';
        bySource.slice(0, 50).forEach(function (r) {
          html += '<tr>' +
            '<td><span class="text-secondary small me-2"><code>' + escapeHtml(r.key) + '</code></span>' + escapeHtml(r.label || r.key) + '</td>' +
            '<td class="text-end">' + escapeHtml(String(r.sessions || 0)) + '</td>' +
            '<td class="text-end">' + escapeHtml(String(r.converted || 0)) + '</td>' +
          '</tr>';
        });
        html += '</tbody></table></div>';
      }

      if (unmatchedTop.length) {
        html += '<div class="text-secondary small mb-2">Top unmatched signatures</div>';
        html += '<div class="table-responsive"><table class="table table-sm table-vcenter mb-0">' +
          '<thead><tr><th>Signature</th><th class="text-end">Sessions</th></tr></thead><tbody>';
        unmatchedTop.slice(0, 30).forEach(function (u) {
          html += '<tr>' +
            '<td><code>' + escapeHtml(u.signature || '') + '</code></td>' +
            '<td class="text-end">' + escapeHtml(String(u.sessions || 0)) + '</td>' +
          '</tr>';
        });
        html += '</tbody></table></div>';
      }
      body.innerHTML = html;
    }

    // Event delegation
    root.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
      if (!btn) return;
      var action = String(btn.getAttribute('data-action') || '').trim();
      if (!action) return;

      if (action === 'save-config') {
        try {
          var cfg = readConfigFromDom(root);
          setMsg('Saving…', null);
          saveTrafficSourcesConfig(cfg).then(function (data) {
            if (!data || data.ok !== true) throw new Error((data && data.error) ? String(data.error) : 'Save failed');
            draft = deepClone(data.trafficSourcesConfig || cfg) || cfg;
            renderSources();
            setMsg('Saved.', true);
          }).catch(function (err) {
            setMsg(err && err.message ? String(err.message) : 'Save failed', false);
          });
        } catch (err) {
          setMsg(err && err.message ? String(err.message) : 'Save failed', false);
        }
        return;
      }

      if (action === 'add-source') {
        var cfg2 = readConfigFromDom(root);
        cfg2.sources = Array.isArray(cfg2.sources) ? cfg2.sources : [];
        cfg2.sources.push({
          key: 'custom_' + makeId('source').slice(-8),
          label: '',
          enabled: true,
          order: cfg2.sources.length + 1,
          iconSpec: '',
          rules: [],
        });
        draft = cfg2;
        renderSources();
        return;
      }

      if (action === 'delete-source') {
        var srcEl = btn.closest('[data-tsv2-source]');
        if (!srcEl) return;
        var idx = parseInt(String(srcEl.getAttribute('data-source-idx') || ''), 10);
        var cfg3 = readConfigFromDom(root);
        cfg3.sources = Array.isArray(cfg3.sources) ? cfg3.sources : [];
        if (isFinite(idx) && idx >= 0 && idx < cfg3.sources.length) cfg3.sources.splice(idx, 1);
        draft = cfg3;
        renderSources();
        return;
      }

      if (action === 'add-rule') {
        var srcEl2 = btn.closest('[data-tsv2-source]');
        if (!srcEl2) return;
        var idx2 = parseInt(String(srcEl2.getAttribute('data-source-idx') || ''), 10);
        var cfg4 = readConfigFromDom(root);
        cfg4.sources = Array.isArray(cfg4.sources) ? cfg4.sources : [];
        if (!isFinite(idx2) || idx2 < 0 || idx2 >= cfg4.sources.length) return;
        var s = cfg4.sources[idx2];
        s.rules = Array.isArray(s.rules) ? s.rules : [];
        s.rules.push({ id: makeId('rule'), label: '', enabled: true, when: {} });
        draft = cfg4;
        renderSources();
        return;
      }

      if (action === 'delete-rule') {
        var ruleEl = btn.closest('[data-tsv2-rule]');
        var srcEl3 = btn.closest('[data-tsv2-source]');
        if (!ruleEl || !srcEl3) return;
        var sIdx = parseInt(String(srcEl3.getAttribute('data-source-idx') || ''), 10);
        var rIdx = parseInt(String(ruleEl.getAttribute('data-rule-idx') || ''), 10);
        var cfg5 = readConfigFromDom(root);
        cfg5.sources = Array.isArray(cfg5.sources) ? cfg5.sources : [];
        if (!isFinite(sIdx) || sIdx < 0 || sIdx >= cfg5.sources.length) return;
        var ss = cfg5.sources[sIdx];
        ss.rules = Array.isArray(ss.rules) ? ss.rules : [];
        if (isFinite(rIdx) && rIdx >= 0 && rIdx < ss.rules.length) ss.rules.splice(rIdx, 1);
        draft = cfg5;
        renderSources();
        return;
      }

      if (action === 'refresh-icon-preview') {
        var srcEl4 = btn.closest('[data-tsv2-source]');
        if (!srcEl4) return;
        refreshIconPreviewForSource(srcEl4);
        return;
      }

      if (action === 'upload-icon') {
        var srcEl5 = btn.closest('[data-tsv2-source]');
        if (!srcEl5) return;
        var fileInput = srcEl5.querySelector('[data-field="icon-file"]');
        if (!fileInput) return;
        fileInput.value = '';
        fileInput.click();
        return;
      }

      if (action === 'open-legacy-v1') {
        try {
          var details = document.getElementById('settings-sources-legacy-details');
          if (details) details.open = true;
          if (typeof window.initTrafficSourceMapping === 'function') {
            window.initTrafficSourceMapping({ rootId: 'settings-traffic-source-mapping-legacy-root' });
          }
          if (details && details.scrollIntoView) details.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (_) {}
        return;
      }

      if (action === 'open-suggestions') {
        openModal('suggestions');
        // Load suggestions lazily
        var sinceEl = root.querySelector('[data-field="suggestions-sinceDays"]');
        var since = sinceEl ? clampInt(sinceEl.value, 30, 1, 365) : 30;
        renderSuggestionsPayload(null);
        fetchSuggestions({ sinceDays: since }).then(renderSuggestionsPayload);
        return;
      }

      if (action === 'refresh-suggestions') {
        var sinceEl2 = root.querySelector('[data-field="suggestions-sinceDays"]');
        var since2 = sinceEl2 ? clampInt(sinceEl2.value, 30, 1, 365) : 30;
        renderSuggestionsPayload(null);
        fetchSuggestions({ sinceDays: since2 }).then(renderSuggestionsPayload);
        return;
      }

      if (action === 'apply-suggestions') {
        var bodyEl = root.querySelector('[data-tsv2-suggestions-body]');
        if (!bodyEl || !suggestionsPayload || suggestionsPayload.ok !== true) return;
        var selected = [];
        bodyEl.querySelectorAll('input[type="checkbox"][data-suggestion-id]:checked').forEach(function (cb) {
          selected.push(String(cb.getAttribute('data-suggestion-id') || '').trim());
        });
        if (!selected.length) return;
        var seeds = [];
        (Array.isArray(suggestionsPayload.suggestions) ? suggestionsPayload.suggestions : []).forEach(function (s) {
          if (!s || !s.id) return;
          if (selected.indexOf(String(s.id)) === -1) return;
          if (s.seedSource) seeds.push(s.seedSource);
        });
        if (!seeds.length) return;
        var applyBtn = root.querySelector('[data-action="apply-suggestions"]');
        if (applyBtn) applyBtn.disabled = true;
        applySuggestions(seeds).then(function (res) {
          if (!res || res.ok !== true) throw new Error((res && res.error) ? String(res.error) : 'Apply failed');
          draft = deepClone(res.trafficSourcesConfig || res.traffic_sources_config || null) || draft;
          renderSources();
          setMsg('Applied suggestions (saved). Review and adjust as needed.', true);
        }).catch(function (err) {
          setMsg(err && err.message ? String(err.message) : 'Apply failed', false);
        }).finally(function () {
          if (applyBtn) applyBtn.disabled = false;
        });
        return;
      }

      if (action === 'open-diagnostics') {
        openModal('diagnostics');
        var sinceEl3 = root.querySelector('[data-field="diagnostics-sinceDays"]');
        var since3 = sinceEl3 ? clampInt(sinceEl3.value, 30, 1, 365) : 30;
        renderDiagnosticsPayload(null);
        fetchDiagnostics({ sinceDays: since3 }).then(renderDiagnosticsPayload);
        return;
      }

      if (action === 'refresh-diagnostics') {
        var sinceEl4 = root.querySelector('[data-field="diagnostics-sinceDays"]');
        var since4 = sinceEl4 ? clampInt(sinceEl4.value, 30, 1, 365) : 30;
        renderDiagnosticsPayload(null);
        fetchDiagnostics({ sinceDays: since4 }).then(renderDiagnosticsPayload);
        return;
      }

      if (action === 'reset-defaults') {
        if (!confirm('Reset Sources to defaults? This will not save until you click Save.')) return;
        fetchSettings().then(function (data) {
          // Server always returns defaults when key missing; mimic by clearing locally.
          // We request defaults by saving null then reloading.
          return saveTrafficSourcesConfig(null).then(function (saved) {
            if (!saved || saved.ok !== true) throw new Error('Reset failed');
            draft = deepClone(saved.trafficSourcesConfig || { v: 1, sources: [] }) || { v: 1, sources: [] };
            renderSources();
            setMsg('Reset to defaults. Saved.', true);
          });
        }).catch(function (err) {
          setMsg(err && err.message ? String(err.message) : 'Reset failed', false);
        });
        return;
      }
    });

    // file input change handler (delegated via capture)
    root.addEventListener('change', function (e) {
      var input = e.target && e.target.matches ? (e.target.matches('input[type="file"][data-field="icon-file"]') ? e.target : null) : null;
      if (!input) return;
      var srcEl = input.closest('[data-tsv2-source]');
      if (!srcEl) return;
      var file = input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      setMsg('Uploading icon…', null);
      uploadIconForSource(srcEl, file)
        .then(function () { setMsg('Icon uploaded. Click Save to persist.', true); })
        .catch(function (err) { setMsg(err && err.message ? String(err.message) : 'Upload failed', false); });
    }, true);

    // iconSpec live preview (best-effort)
    root.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (t.matches('[data-field="source-iconSpec"]') || t.matches('[data-field="source-label"]')) {
        var srcEl = t.closest('[data-tsv2-source]');
        if (!srcEl) return;
        refreshIconPreviewForSource(srcEl);
      }
    }, true);

    loadInitialConfig().then(function () { setMsg('', null); });
  }

  try { window.initTrafficSourcesV2Settings = initTrafficSourcesV2Settings; } catch (_) {}
})();

