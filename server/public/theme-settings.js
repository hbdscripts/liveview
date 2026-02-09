(function () {
  'use strict';

  var DEFAULTS = {
    theme: 'light',
    'theme-base': '',
    'theme-primary': '',
    'theme-radius': '1'
  };

  var KEYS = Object.keys(DEFAULTS);

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
    if (key === 'theme') {
      document.documentElement.setAttribute('data-bs-theme', value || 'light');
    } else {
      if (value) {
        document.documentElement.setAttribute('data-bs-' + key, value);
      } else {
        document.documentElement.removeAttribute('data-bs-' + key);
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
            '<div class="row g-2">' +
              radioCard('theme', 'light', 'Light') +
              radioCard('theme', 'dark', 'Dark') +
            '</div>' +
          '</div>' +

          '<div class="mb-4">' +
            '<label class="form-label">Color scheme</label>' +
            '<div class="row g-2">' +
              radioCard('theme-base', '', 'Default') +
              radioCard('theme-base', 'slate', 'Slate') +
              radioCard('theme-base', 'gray', 'Gray') +
              radioCard('theme-base', 'zinc', 'Zinc') +
              radioCard('theme-base', 'neutral', 'Neutral') +
              radioCard('theme-base', 'stone', 'Stone') +
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
            '<div class="row g-2">' +
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

    // Bind form changes
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
      setTimeout(function () { btn.textContent = 'Save as default'; }, 1500);
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
    return '<div class="col-6">' +
      '<label class="form-selectgroup-item flex-fill">' +
        '<input type="radio" name="' + name + '" value="' + value + '" class="form-selectgroup-input" id="' + id + '">' +
        '<div class="form-selectgroup-label d-flex align-items-center p-2">' +
          '<span class="form-selectgroup-label-content">' + label + '</span>' +
        '</div>' +
      '</label>' +
    '</div>';
  }

  function colorCard(name, value, label) {
    var swatch = value ? '<span class="avatar avatar-xs rounded-circle me-2" style="background:var(--tblr-' + (value || 'primary') + ')"></span>' : '';
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
