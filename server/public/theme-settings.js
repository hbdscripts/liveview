(function () {
  'use strict';

  var DEFAULTS = {
    theme: 'light',
    // Default primary is green (#2fb344) to match Tabler preview; stored value overrides.
    'theme-primary': 'green',
    'theme-radius': '1',
    'theme-font': 'sans',
    'theme-base': 'slate',
  };

  var KEYS = Object.keys(DEFAULTS);

  // Primary color map: name → [hex, r, g, b]
  var PRIMARY_COLORS = {
    blue:   ['#206bc4', '32,107,196'],
    azure:  ['#4299e1', '66,153,225'],
    indigo: ['#4263eb', '66,99,235'],
    purple: ['#ae3ec9', '174,62,201'],
    pink:   ['#d6336c', '214,51,108'],
    red:    ['#d63939', '214,57,57'],
    orange: ['#f76707', '247,103,7'],
    yellow: ['#f59f00', '245,159,0'],
    lime:   ['#74b816', '116,184,22'],
    green:  ['#2fb344', '47,179,68'],
    teal:   ['#0ca678', '12,166,120'],
    cyan:   ['#17a2b8', '23,162,184']
  };

  // Border radius scale → CSS value
  var RADIUS_MAP = {
    '0': '0',
    '0.5': '.25rem',
    '1': '.375rem',
    '1.5': '.5rem',
    '2': '2rem'
  };

  // Font family map
  var FONT_FAMILIES = {
    sans: 'Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
    serif: 'Georgia, Cambria, \"Times New Roman\", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace',
    comic: '\"Comic Sans MS\", \"Comic Sans\", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
  };

  // Gray palette map (Tabler uses --tblr-gray-50..950)
  var BASE_PALETTES = {
    slate:  { 50:'#f8fafc',100:'#f1f5f9',200:'#e2e8f0',300:'#cbd5e1',400:'#94a3b8',500:'#64748b',600:'#475569',700:'#334155',800:'#1e293b',900:'#0f172a',950:'#020617' },
    gray:   { 50:'#f9fafb',100:'#f3f4f6',200:'#e5e7eb',300:'#d1d5db',400:'#9ca3af',500:'#6b7280',600:'#4b5563',700:'#374151',800:'#1f2937',900:'#111827',950:'#030712' },
    zinc:   { 50:'#fafafa',100:'#f4f4f5',200:'#e4e4e7',300:'#d4d4d8',400:'#a1a1aa',500:'#71717a',600:'#52525b',700:'#3f3f46',800:'#27272a',900:'#18181b',950:'#09090b' },
    neutral:{ 50:'#fafafa',100:'#f5f5f5',200:'#e5e5e5',300:'#d4d4d4',400:'#a3a3a3',500:'#737373',600:'#525252',700:'#404040',800:'#262626',900:'#171717',950:'#0a0a0a' },
    stone:  { 50:'#fafaf9',100:'#f5f5f4',200:'#e7e5e4',300:'#d6d3d1',400:'#a8a29e',500:'#78716c',600:'#57534e',700:'#44403c',800:'#292524',900:'#1c1917',950:'#0c0a09' }
  };

  function getStored(key) {
    try { return localStorage.getItem('tabler-' + key); } catch (_) { return null; }
  }
  function setStored(key, val) {
    try { localStorage.setItem('tabler-' + key, val); } catch (_) {}
  }
  function removeStored(key) {
    try { localStorage.removeItem('tabler-' + key); } catch (_) {}
  }

  function applyTheme(key, value) {
    var root = document.documentElement;
    if (key === 'theme') {
      // Tabler uses data-bs-theme (Bootstrap 5.3). Keep a legacy body class for older CSS hooks.
      document.body.classList.toggle('theme-dark', value === 'dark');
      root.setAttribute('data-bs-theme', value || 'light');
      root.classList.remove('theme-dark-early');
    } else if (key === 'theme-primary') {
      var color = PRIMARY_COLORS[value];
      if (color) {
        root.style.setProperty('--tblr-primary', color[0]);
        root.style.setProperty('--tblr-primary-rgb', color[1]);
      } else {
        root.style.removeProperty('--tblr-primary');
        root.style.removeProperty('--tblr-primary-rgb');
      }
    } else if (key === 'theme-radius') {
      var r = RADIUS_MAP[value];
      if (r != null) {
        root.style.setProperty('--tblr-border-radius', r);
        root.style.setProperty('--tblr-border-radius-sm', r === '0' ? '0' : 'calc(' + r + ' * .75)');
        root.style.setProperty('--tblr-border-radius-lg', r === '0' ? '0' : 'calc(' + r + ' * 1.5)');
        root.style.setProperty('--tblr-border-radius-xl', r === '0' ? '0' : 'calc(' + r + ' * 3)');
      } else {
        root.style.removeProperty('--tblr-border-radius');
        root.style.removeProperty('--tblr-border-radius-sm');
        root.style.removeProperty('--tblr-border-radius-lg');
        root.style.removeProperty('--tblr-border-radius-xl');
      }
    } else if (key === 'theme-font') {
      var ff = FONT_FAMILIES[value];
      if (ff) {
        root.style.setProperty('--tblr-font-sans-serif', ff);
        root.style.setProperty('--bs-body-font-family', ff);
      } else {
        root.style.removeProperty('--tblr-font-sans-serif');
        root.style.removeProperty('--bs-body-font-family');
      }
    } else if (key === 'theme-base') {
      var palette = BASE_PALETTES[value];
      if (!palette) {
        ['50','100','200','300','400','500','600','700','800','900','950'].forEach(function(k) {
          root.style.removeProperty('--tblr-gray-' + k);
        });
        return;
      }
      Object.keys(palette).forEach(function(k) {
        root.style.setProperty('--tblr-gray-' + k, palette[k]);
      });
    }
  }

  // Apply stored settings immediately (before paint)
  function restoreAll() {
    KEYS.forEach(function (key) {
      var val = getStored(key);
      if (val !== null) {
        applyTheme(key, val);
      }
    });
  }

  // Fetch server defaults for first-time visitors (no localStorage yet)
  function fetchDefaults() {
    var hasAny = KEYS.some(function (k) { return getStored(k) !== null; });
    if (hasAny) return;

    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) return;
        KEYS.forEach(function (key) {
          var dbKey = key.replace(/-/g, '_');
          var val = data[dbKey] || data[key];
          if (val) {
            setStored(key, val);
            applyTheme(key, val);
          }
        });
        syncUI();
      })
      .catch(function () {});
  }

  // Save to server as default for all users
  function saveToServer() {
    var payload = {};
    KEYS.forEach(function (key) {
      var dbKey = key.replace(/-/g, '_');
      payload[dbKey] = getStored(key) || DEFAULTS[key];
    });
    var base = '';
    try { if (typeof API !== 'undefined') base = String(API || ''); } catch (_) {}
    fetch(base + '/api/theme-defaults', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(function () {});
  }

  // Sync UI radio buttons to current stored values
  function syncUI() {
    var form = document.getElementById('theme-settings-form');
    if (!form) return;
    KEYS.forEach(function (key) {
      var val = getStored(key) || DEFAULTS[key];
      var radios = form.querySelectorAll('[name="' + key + '"]');
      radios.forEach(function (r) {
        r.checked = (r.value === val);
      });
    });
  }

  // Build the offcanvas HTML and inject into page
  function injectOffcanvas() {
    if (document.getElementById('theme-offcanvas')) return;

    var html = '<div class="offcanvas offcanvas-end" tabindex="-1" id="theme-offcanvas" aria-labelledby="theme-offcanvas-label">' +
      '<div class="offcanvas-header">' +
        '<h2 class="offcanvas-title" id="theme-offcanvas-label">Theme Settings</h2>' +
        '<button type="button" class="btn-close" data-bs-dismiss="offcanvas" aria-label="Close"></button>' +
      '</div>' +
      '<div class="offcanvas-body">' +
        '<form id="theme-settings-form">' +

          '<div class="mb-4">' +
            '<label class="form-label">Color mode</label>' +
            '<div class="form-selectgroup">' +
              radioCard('theme', 'light', 'Light') +
              radioCard('theme', 'dark', 'Dark') +
            '</div>' +
          '</div>' +

          '<div class="mb-4">' +
            '<label class="form-label">Color scheme</label>' +
            '<div class="row g-2">' +
              colorCard('theme-primary', 'blue', 'Blue') +
              colorCard('theme-primary', 'azure', 'Azure') +
              colorCard('theme-primary', 'indigo', 'Indigo') +
              colorCard('theme-primary', 'purple', 'Purple') +
              colorCard('theme-primary', 'pink', 'Pink') +
              colorCard('theme-primary', 'red', 'Red') +
              colorCard('theme-primary', 'orange', 'Orange') +
              colorCard('theme-primary', 'yellow', 'Yellow') +
              colorCard('theme-primary', 'lime', 'Lime') +
              colorCard('theme-primary', 'green', 'Green') +
              colorCard('theme-primary', 'teal', 'Teal') +
              colorCard('theme-primary', 'cyan', 'Cyan') +
            '</div>' +
          '</div>' +

          '<div class="mb-4">' +
            '<label class="form-label">Font family</label>' +
            '<div class="form-selectgroup">' +
              radioCard('theme-font', 'sans', 'Sans-serif') +
              radioCard('theme-font', 'serif', 'Serif') +
              radioCard('theme-font', 'mono', 'Monospace') +
              radioCard('theme-font', 'comic', 'Comic') +
            '</div>' +
          '</div>' +

          '<div class="mb-4">' +
            '<label class="form-label">Theme base</label>' +
            '<div class="form-selectgroup">' +
              radioCard('theme-base', 'slate', 'Slate') +
              radioCard('theme-base', 'gray', 'Gray') +
              radioCard('theme-base', 'zinc', 'Zinc') +
              radioCard('theme-base', 'neutral', 'Neutral') +
              radioCard('theme-base', 'stone', 'Stone') +
            '</div>' +
          '</div>' +

          '<div class="mb-4">' +
            '<label class="form-label">Corner radius</label>' +
            '<div class="form-selectgroup">' +
              radioCard('theme-radius', '0', '0') +
              radioCard('theme-radius', '0.5', '0.5') +
              radioCard('theme-radius', '1', '1') +
              radioCard('theme-radius', '1.5', '1.5') +
              radioCard('theme-radius', '2', '2') +
            '</div>' +
          '</div>' +

        '</form>' +
        '<div class="d-flex gap-2">' +
          '<button type="button" class="btn btn-primary flex-fill" id="theme-save-defaults">Save as default</button>' +
          '<button type="button" class="btn btn-outline-secondary" id="theme-reset">Reset</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.body.insertAdjacentHTML('beforeend', html);

    // Bind form changes — apply immediately on selection
    var form = document.getElementById('theme-settings-form');
    form.addEventListener('change', function (e) {
      var name = e.target.name;
      var val = e.target.value;
      setStored(name, val);
      applyTheme(name, val);
    });

    // Save as default
    document.getElementById('theme-save-defaults').addEventListener('click', function () {
      saveToServer();
      var btn = this;
      btn.textContent = 'Saved!';
      btn.classList.replace('btn-primary', 'btn-success');
      setTimeout(function () {
        btn.textContent = 'Save as default';
        btn.classList.replace('btn-success', 'btn-primary');
      }, 1500);
    });

    // Reset
    document.getElementById('theme-reset').addEventListener('click', function () {
      KEYS.forEach(function (key) {
        removeStored(key);
        applyTheme(key, DEFAULTS[key]);
      });
      syncUI();
    });

    syncUI();
  }

  function radioCard(name, value, label) {
    var id = 'theme-opt-' + name + '-' + (value || 'default');
    return '<label class="form-selectgroup-item flex-fill">' +
      '<input type="radio" name="' + name + '" value="' + value + '" class="form-selectgroup-input" id="' + id + '">' +
      '<div class="form-selectgroup-label d-flex align-items-center justify-content-center p-2">' +
        '<span class="form-selectgroup-label-content">' + label + '</span>' +
      '</div>' +
    '</label>';
  }

  function colorCard(name, value, label) {
    var color = PRIMARY_COLORS[value];
    var swatch = color ? '<span class="avatar avatar-xs rounded-circle me-2" style="background:' + color[0] + '"></span>' : '';
    var id = 'theme-opt-' + name + '-' + (value || 'default');
    return '<div class="col-4">' +
      '<label class="form-selectgroup-item flex-fill">' +
        '<input type="radio" name="' + name + '" value="' + value + '" class="form-selectgroup-input" id="' + id + '">' +
        '<div class="form-selectgroup-label d-flex align-items-center p-2">' +
          swatch +
          '<span class="form-selectgroup-label-content" style="font-size:.8125rem">' + label + '</span>' +
        '</div>' +
      '</label>' +
    '</div>';
  }

  // Open the theme offcanvas
  function openThemePanel() {
    injectOffcanvas();
    var el = document.getElementById('theme-offcanvas');
    if (el && typeof bootstrap !== 'undefined') {
      var offcanvas = bootstrap.Offcanvas.getOrCreateInstance(el);
      offcanvas.show();
    }
  }

  // Bind the sidebar + footer theme buttons
  function bindFooterButton() {
    var sidebarBtn = document.getElementById('theme-settings-btn');
    if (sidebarBtn) sidebarBtn.addEventListener('click', openThemePanel);

    // Footer theme button(s)
    document.querySelectorAll('.footer-theme-btn').forEach(function (btn) {
      btn.addEventListener('click', openThemePanel);
    });
  }

  // Init
  restoreAll();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindFooterButton();
      fetchDefaults();
    });
  } else {
    bindFooterButton();
    fetchDefaults();
  }
})();
