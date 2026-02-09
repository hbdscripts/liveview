(function () {
  'use strict';

  var DEFAULTS = {
    theme: 'light',
    'theme-primary': '',
    'theme-radius': '1'
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
      // Tabler beta22 uses body class for dark mode
      document.body.classList.toggle('theme-dark', value === 'dark');
      root.setAttribute('data-bs-theme', value || 'light');
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
            '<label class="form-label">Primary color</label>' +
            '<div class="row g-2">' +
              colorCard('theme-primary', '', 'Default') +
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
            '<label class="form-label">Border radius</label>' +
            '<div class="form-selectgroup">' +
              radioCard('theme-radius', '0', 'None') +
              radioCard('theme-radius', '0.5', 'Small') +
              radioCard('theme-radius', '1', 'Default') +
              radioCard('theme-radius', '1.5', 'Large') +
              radioCard('theme-radius', '2', 'Pill') +
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

  // Bind the footer palette button
  function bindFooterButton() {
    var btn = document.getElementById('theme-settings-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      injectOffcanvas();
      var el = document.getElementById('theme-offcanvas');
      if (el && typeof bootstrap !== 'undefined') {
        var offcanvas = bootstrap.Offcanvas.getOrCreateInstance(el);
        offcanvas.show();
      }
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
