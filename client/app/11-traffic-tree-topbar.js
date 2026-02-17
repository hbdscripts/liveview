      if (!body) return;
      body.addEventListener('click', function(e) {
        const target = e && e.target ? e.target : null;
        const btn = target && target.closest ? target.closest('.traffic-type-toggle') : null;
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const device = (btn.getAttribute('data-device') || '').trim().toLowerCase();
        if (!device) return;
        if (!trafficTypeExpanded || typeof trafficTypeExpanded !== 'object') {
          // First click: snapshot current groups as all-open, then toggle the clicked one
          trafficTypeExpanded = {};
          document.querySelectorAll('.traffic-type-parent[data-device]').forEach(function(row) {
            var d = (row.getAttribute('data-device') || '').trim().toLowerCase();
            if (d) trafficTypeExpanded[d] = true;
          });
        }
        const nextOpen = !trafficTypeExpanded[device];
        trafficTypeExpanded[device] = nextOpen;
        btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        body.querySelectorAll('.grid-row.traffic-type-child[data-parent="' + device + '"]').forEach(function(tr) {
          tr.classList.toggle('is-hidden', !nextOpen);
        });
      });
    })();

      (function initDevicesTree() {
        const body = document.getElementById('devices-body');
        if (!body) return;
        body.addEventListener('click', function(e) {
          const target = e && e.target ? e.target : null;
          const btn = target && target.closest ? target.closest('.devices-toggle[data-device-type]') : null;
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          const deviceType = (btn.getAttribute('data-device-type') || '').trim().toLowerCase();
          if (!deviceType) return;
          if (!devicesExpanded || typeof devicesExpanded !== 'object') {
            devicesExpanded = {};
            body.querySelectorAll('.devices-parent[data-device-type]').forEach(function(row) {
              var d = (row.getAttribute('data-device-type') || '').trim().toLowerCase();
              if (d) devicesExpanded[d] = true;
            });
          }
          const nextOpen = !devicesExpanded[deviceType];
          devicesExpanded[deviceType] = nextOpen;
          btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
          body.querySelectorAll('.grid-row.devices-child[data-parent="' + deviceType + '"]').forEach(function(tr) {
            tr.classList.toggle('is-hidden', !nextOpen);
          });
        });
      })();

      (function initAttributionTree() {
        const body = document.getElementById('attribution-body');
        if (!body) return;
        body.addEventListener('click', function(e) {
          const target = e && e.target ? e.target : null;
          const channelBtn = target && target.closest ? target.closest('.attribution-channel-toggle[data-channel]') : null;
          if (channelBtn) {
            e.preventDefault();
            e.stopPropagation();
            const chKey = (channelBtn.getAttribute('data-channel') || '').trim().toLowerCase();
            if (!chKey) return;
            if (!attributionExpandedChannels || typeof attributionExpandedChannels !== 'object') {
              attributionExpandedChannels = {};
              body.querySelectorAll('.attribution-channel-parent[data-channel]').forEach(function(row) {
                var k = (row.getAttribute('data-channel') || '').trim().toLowerCase();
                if (k) attributionExpandedChannels[k] = true;
              });
            }
            const nextOpen = !attributionExpandedChannels[chKey];
            attributionExpandedChannels[chKey] = nextOpen;
            channelBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
            body.querySelectorAll('.grid-row.attribution-source-row[data-parent="' + chKey + '"]').forEach(function(tr) {
              tr.classList.toggle('is-hidden', !nextOpen);
            });
            body.querySelectorAll('.grid-row.attribution-variant-row[data-channel="' + chKey + '"]').forEach(function(tr) {
              if (!nextOpen) {
                tr.classList.add('is-hidden');
                return;
              }
              const src = (tr.getAttribute('data-source') || '').trim().toLowerCase();
              const k = chKey + '|' + (src || 'other');
              let srcOpen = true;
              if (attributionExpandedSources && typeof attributionExpandedSources === 'object' && Object.prototype.hasOwnProperty.call(attributionExpandedSources, k)) {
                srcOpen = !!attributionExpandedSources[k];
              }
              tr.classList.toggle('is-hidden', !srcOpen);
            });
            return;
          }

          const sourceBtn = target && target.closest ? target.closest('.attribution-source-toggle[data-channel][data-source]') : null;
          if (!sourceBtn) return;
          e.preventDefault();
          e.stopPropagation();
          const ch = (sourceBtn.getAttribute('data-channel') || '').trim().toLowerCase();
          const src = (sourceBtn.getAttribute('data-source') || '').trim().toLowerCase();
          if (!ch || !src) return;
          if (!attributionExpandedSources || typeof attributionExpandedSources !== 'object') {
            attributionExpandedSources = {};
            body.querySelectorAll('.attribution-source-row[data-channel][data-source]').forEach(function(row) {
              var c = (row.getAttribute('data-channel') || '').trim().toLowerCase();
              var s = (row.getAttribute('data-source') || '').trim().toLowerCase();
              if (c && s) attributionExpandedSources[c + '|' + s] = true;
            });
          }
          const key = ch + '|' + src;
          const nextOpen = !attributionExpandedSources[key];
          attributionExpandedSources[key] = nextOpen;
          sourceBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
          const channelOpen = !(attributionExpandedChannels && typeof attributionExpandedChannels === 'object' && Object.prototype.hasOwnProperty.call(attributionExpandedChannels, ch)) || !!attributionExpandedChannels[ch];
          body.querySelectorAll('.grid-row.attribution-variant-row[data-parent="' + key + '"]').forEach(function(tr) {
            tr.classList.toggle('is-hidden', !(channelOpen && nextOpen));
          });
        });
      })();

    (function initTopBar() {
      try { saleMuted = sessionStorage.getItem(SALE_MUTED_KEY) === 'true'; } catch (_) { saleMuted = false; }
      try { saleAudio = new Audio(); } catch (_) { saleAudio = null; }
      if (saleAudio) {
        try { saleAudio.preload = 'auto'; } catch (_) {}
        try {
          window.__kexoApplySaleSoundOverride = function(url) {
            try { window.__kexoSaleSoundOverrideUrl = (url && String(url).trim()) || ''; } catch (_) {}
            if (typeof setSaleAudioSrc === 'function') {
              setSaleAudioSrc(typeof getCashRegisterMp3Url === 'function' ? getCashRegisterMp3Url() : (API || '') + '/assets/cash-register.mp3');
            }
          };
          window.__kexoPreviewSaleSound = function(url) {
            if (!saleAudio) return Promise.reject(new Error('Sale audio unavailable'));
            var nextUrl = url != null ? String(url).trim() : '';
            if (!nextUrl) {
              nextUrl = (typeof getCashRegisterMp3Url === 'function')
                ? getCashRegisterMp3Url()
                : ((API || '') + '/assets/cash-register.mp3');
            }
            var prevSrc = '';
            try { prevSrc = String(saleAudio.currentSrc || saleAudio.src || '').trim(); } catch (_) { prevSrc = ''; }
            if (nextUrl) {
              try { setSaleAudioSrc(nextUrl); } catch (_) {}
            }
            try { primeSaleAudio(); } catch (_) {}
            try { saleAudio.muted = false; } catch (_) {}
            try { saleAudio.currentTime = 0; } catch (_) {}
            var played = null;
            try {
              played = saleAudio.play();
            } catch (err) {
              if (prevSrc && nextUrl && prevSrc !== nextUrl) {
                try { setSaleAudioSrc(prevSrc); } catch (_) {}
              }
              return Promise.reject(err);
            }
            function restoreSrc() {
              if (prevSrc && nextUrl && prevSrc !== nextUrl) {
                try { setSaleAudioSrc(prevSrc); } catch (_) {}
              }
            }
            if (played && typeof played.finally === 'function') {
              return played.finally(restoreSrc);
            }
            restoreSrc();
            return Promise.resolve();
          };
        } catch (_) {}
        try { setSaleAudioSrc(typeof getCashRegisterMp3Url === 'function' ? getCashRegisterMp3Url() : (API || '') + '/assets/cash-register.mp3'); } catch (_) {}
        // Prime/unlock audio on the first user interaction so sale sounds can play later.
        (function primeOnFirstGesture() {
          function prime() { try { primeSaleAudio(); } catch (_) {} }
          document.addEventListener('pointerdown', prime, { once: true, capture: true });
          document.addEventListener('touchstart', prime, { once: true, capture: true });
          document.addEventListener('keydown', prime, { once: true, capture: true });
          document.addEventListener('click', prime, { once: true, capture: true });
        })();
      }
      function syncFooterAudioMute(muted) {
        document.querySelectorAll('.footer-audio-btn, .footer-settings-audio').forEach(function(btn) {
          btn.classList.toggle('muted', muted);
          var iconOn = btn.querySelector('.sound-icon-on');
          var iconOff = btn.querySelector('.sound-icon-off');
          if (iconOn) iconOn.classList.toggle('is-hidden', muted);
          if (iconOff) iconOff.classList.toggle('is-hidden', !muted);
        });
      }
      const muteBtn = document.getElementById('audio-mute-btn');
      const iconOn = muteBtn && muteBtn.querySelector('.sound-icon-on');
      const iconOff = muteBtn && muteBtn.querySelector('.sound-icon-off');
      if (muteBtn) {
        if (iconOn) iconOn.classList.toggle('is-hidden', saleMuted);
        if (iconOff) iconOff.classList.toggle('is-hidden', !saleMuted);
        muteBtn.classList.toggle('muted', saleMuted);
        syncFooterAudioMute(saleMuted);
        muteBtn.addEventListener('click', function() {
          saleMuted = !saleMuted;
          try { sessionStorage.setItem(SALE_MUTED_KEY, String(saleMuted)); } catch (_) {}
          if (iconOn) iconOn.classList.toggle('is-hidden', saleMuted);
          if (iconOff) iconOff.classList.toggle('is-hidden', !saleMuted);
          muteBtn.classList.toggle('muted', saleMuted);
          syncFooterAudioMute(saleMuted);
          if (!saleMuted) {
            // User gesture: unlock audio so future sale sounds work.
            try { primeSaleAudio(); } catch (_) {}
          }
        });
      }
      try {
        window.addEventListener('kexo:sale-sound-updated', function(e) {
          var url = (e && e.detail && e.detail.url) ? String(e.detail.url).trim() : '';
          if (typeof window.__kexoApplySaleSoundOverride === 'function') {
            window.__kexoApplySaleSoundOverride(url || null);
          }
        });
      } catch (_) {}
      // Test sale sound: add ?cha=ching to the URL. Plays once when sound is on; if autoplay blocked, plays on first click.
      (function testChaChing() {
        if (new URLSearchParams(window.location.search).get('cha') !== 'ching' || !saleAudio) return;
        function playTest() {
          if (saleMuted) return;
          saleAudio.currentTime = 0;
          saleAudio.play().catch(function() {});
        }
        playTest();
        document.body.addEventListener('click', function once() {
          document.body.removeEventListener('click', once);
          playTest();
        }, { once: true });
      })();
      const dateSelect = document.getElementById('global-date-select');
      if (dateSelect) {
        mountDesktopDatePickerIntoPageHeader();
        try {
          const syncHeaderDatePlacement = function() { mountDesktopDatePickerIntoPageHeader(); };
          window.addEventListener('resize', syncHeaderDatePlacement, { passive: true });
          window.addEventListener('orientationchange', syncHeaderDatePlacement);
          window.addEventListener('pageshow', syncHeaderDatePlacement);
        } catch (_) {}
        syncDateSelectOptions();
        applyRangeAvailable({ today: true, yesterday: true });
        updateLiveViewTitle();
        updateRowsPerPageVisibility();
        dateSelect.addEventListener('change', function() {
          const next = String(this.value || '').trim().toLowerCase();
          try {
            const opt = this.querySelector('option[value="' + next + '"]');
            if (opt && opt.disabled) {
              this.value = 'today';
              return;
            }
          } catch (_) {}
          if (next === 'custom') {
            openCustomDateModal();
            // Revert the select so "Custom" can be selected again.
            syncDateSelectOptions();
            return;
          }
          // Handle standard date ranges
          if (next === 'today' || next === 'yesterday' || next === '7days' || next === '14days' || next === '30days') {
            dateRange = next;
            applyDateRangeChange();
            return;
          }
          // Defensive: allow selecting an applied range key if present.
          if (isCustomRangeKey(next)) {
            dateRange = next;
            applyDateRangeChange();
          }
        });
        initCustomDateModal();
        initHeaderDateMenu();
        try { ensureUiSettingsLoaded({ apply: true }); } catch (_) {}
      }
      (function initTableTitleTabs() {
        const tabsWrap = document.getElementById('table-title-tabs');
        if (!tabsWrap) return;
        function setRangeFromTab(range) {
          dateRange = range;
          if (dateRange === 'sales' || dateRange === '1h') {
            const sel = document.getElementById('global-date-select');
            if (sel) sel.value = 'today';
          }
          lastOnlineCount = null;
          countryPage = 1;
          updateLiveViewTitle();
          updateRowsPerPageVisibility();
          refreshKpis({ force: true });
          updateKpis();
          fetchSessions();
          updateNextUpdateUi();
        }
        document.querySelectorAll('#table-title-tabs button[data-range]').forEach(function(btn) {
          btn.addEventListener('click', function() { setRangeFromTab(btn.getAttribute('data-range')); });
        });
      })();
      (function initMainTabs() {
        const TAB_KEY = 'kexo-main-tab';
